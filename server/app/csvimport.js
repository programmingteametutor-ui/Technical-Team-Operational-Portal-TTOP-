"use strict";
/**
 * CSV import for Dhruva tabs.
 *
 * Google Sheets' "Download > CSV" gives the text shown on screen, not the
 * underlying values: dates come out as "24-Aug-2026" or "7/1/2026 Wednesday",
 * amounts as "₹3,900". Dhruva's logic reads real dates and numbers, so each cell
 * is turned back into the value Google held, using config/tab-profiles.json
 * (which kinds of value each column held, and in which display format).
 * Tabs or columns without a profile are read the way Google reads typed text.
 */
const path = require("path");
const F = require("../gas/format");
const { Row } = require("../store");

let PROFILES = null;
function profiles() {
  if (!PROFILES) { try { PROFILES = require(path.join(__dirname, "..", "..", "config", "tab-profiles.json")); } catch (e) { PROFILES = { workbooks: {} }; } }
  return PROFILES;
}
function tabProfile(spreadsheetId, tab) {
  const w = profiles().workbooks[spreadsheetId];
  return (w && w.tabs[tab]) || null;
}

/* ------------------------------ CSV text ------------------------------ */
function parseCsv(text) {
  text = String(text || "").replace(/^\uFEFF/, "");
  const rows = []; let row = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cur); cur = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cur); rows.push(row); row = []; cur = "";
    } else cur += ch;
  }
  if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

/* ------------------------- dates in a display format ------------------------- */
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const fmtCache = new Map();
function compileFormat(fmt) {
  if (fmtCache.has(fmt)) return fmtCache.get(fmt);
  const tokens = [];
  for (let i = 0; i < fmt.length;) {
    const ch = fmt[i];
    if (ch === '"') { const end = fmt.indexOf('"', i + 1); tokens.push({ lit: fmt.slice(i + 1, end < 0 ? fmt.length : end) }); i = end < 0 ? fmt.length : end + 1; continue; }
    if (ch === "\\") { tokens.push({ lit: fmt[i + 1] || "" }); i += 2; continue; }
    if (/^(AM\/PM|am\/pm)/.test(fmt.slice(i))) { tokens.push({ t: "ampm" }); i += 5; continue; }
    if (/^(A\/P|a\/p)/.test(fmt.slice(i))) { tokens.push({ t: "ap" }); i += 3; continue; }
    const lower = ch.toLowerCase();
    if ("dmyhs".includes(lower)) {
      let n = 1; while (fmt[i + n] && fmt[i + n].toLowerCase() === lower) n++;
      tokens.push({ t: lower, n, upperM: ch === "M" }); i += n; continue;
    }
    if (ch === "." && /^\.0+/.test(fmt.slice(i))) { const n = /^\.0+/.exec(fmt.slice(i))[0].length - 1; tokens.push({ t: "frac", n }); i += n + 1; continue; }
    tokens.push({ lit: ch }); i++;
  }
  const fields = tokens.map((t, i) => (t.t ? i : -1)).filter(i => i >= 0);
  fields.forEach((ti, k) => {
    const t = tokens[ti];
    if (t.t !== "m" || t.n > 2) return;
    if (t.upperM) { t.month = true; return; }
    const prev = k > 0 ? tokens[fields[k - 1]] : null, next = k < fields.length - 1 ? tokens[fields[k + 1]] : null;
    t.month = !((prev && prev.t === "h") || (next && next.t === "s"));
  });
  const parts = [], groups = [];
  for (const t of tokens) {
    if (t.lit !== undefined) { parts.push(t.lit.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+")); continue; }
    switch (t.t) {
      case "d": if (t.n >= 3) { parts.push("[A-Za-z]+"); } else { parts.push("(\\d{1,2})"); groups.push("day"); } break;
      case "m":
        if (t.n >= 3) { parts.push("([A-Za-z]+)"); groups.push("monthName"); }
        else if (t.month) { parts.push("(\\d{1,2})"); groups.push("month"); }
        else { parts.push("(\\d{1,2})"); groups.push("minute"); }
        break;
      case "y": parts.push(t.n <= 2 ? "(\\d{2})" : "(\\d{4})"); groups.push(t.n <= 2 ? "year2" : "year"); break;
      case "h": parts.push("(\\d{1,2})"); groups.push("hour"); break;
      case "s": parts.push("(\\d{1,2})"); groups.push("second"); break;
      case "frac": parts.push("(\\d+)"); groups.push("ms"); break;
      case "ampm": parts.push("([AaPp][Mm])"); groups.push("ampm"); break;
      case "ap": parts.push("([AaPp])"); groups.push("ampm"); break;
    }
  }
  const c = { re: new RegExp("^\\s*" + parts.join("") + "\\s*$", "i"), groups };
  fmtCache.set(fmt, c);
  return c;
}
function parseDate(text, fmt, yearHint) {
  const c = compileFormat(fmt);
  const m = c.re.exec(text);
  if (!m) return null;
  const v = { day: 1, month: 1, year: yearHint || new Date().getFullYear(), hour: 0, minute: 0, second: 0, ms: 0, ampm: null };
  c.groups.forEach((g, i) => {
    const s = m[i + 1];
    if (g === "monthName") { const k = MONTHS.indexOf(s.slice(0, 3).toLowerCase()); if (k < 0) v.bad = true; v.month = k + 1; }
    else if (g === "year2") v.year = 2000 + Number(s);
    else if (g === "ampm") v.ampm = s[0].toUpperCase();
    else v[g] = Number(s);
  });
  if (v.bad) return null;
  if (v.ampm === "P" && v.hour < 12) v.hour += 12;
  if (v.ampm === "A" && v.hour === 12) v.hour = 0;
  const d = new Date(v.year, v.month - 1, v.day, v.hour, v.minute, v.second, v.ms);
  if (d.getMonth() !== v.month - 1 || d.getDate() !== v.day) return null;
  return d;
}

/* ------------------------------ one cell ------------------------------ */
const sorted = (o) => Object.entries(o || {}).sort((a, b) => b[1] - a[1]).map(x => x[0]);
function columnRules(p) {
  if (!p) return null;
  const total = Object.values(p.types).reduce((a, b) => a + b, 0) || 1;
  const share = (t) => (p.types[t] || 0) / total;
  const years = sorted(p.years);
  return {
    date: share("date") > 0 ? sorted(p.dateFormats) : null,
    number: share("number") > 0 ? sorted(p.numberFormats) : null,
    bool: share("bool") > 0,
    textOnly: share("text") === 1,
    textFormat: p.text > 0 && p.text >= (p.types.text || 0) * 0.5,
    year: years.length ? Number(years[0]) : null
  };
}
const NUM_RE = /^\s*[-+]?[^\d\s.-]*\s*[-+]?(\d{1,3}(,\d{3})+|\d+)?(\.\d+)?\s*%?\s*$/;
function parseNumber(text) {
  const t = String(text).trim();
  if (!t || !/\d/.test(t) || !NUM_RE.test(t)) return null;
  const neg = /^\s*-|^\(.*\)$/.test(t) || /^[^\d]*-/.test(t);
  let n = Number(t.replace(/[^\d.]/g, ""));
  if (!isFinite(n)) return null;
  if (/%\s*$/.test(t)) n = n / 100;
  return neg ? -n : n;
}

const sameText = (a, b) => String(a).replace(/\s+/g, " ").trim() === String(b).replace(/\s+/g, " ").trim();

/** Returns { v, f } for one CSV cell. */
function convertCell(text, rules) {
  if (text === "" || text === null || text === undefined) return { v: "" };
  const s = String(text);
  if (!rules) {
    if (s[0] === "'") return { v: s.slice(1) };
    const p = F.parseUserEntered(s);
    return p ? { v: p.value, f: p.format || null } : { v: s };
  }
  if (rules.textOnly) return { v: s, f: rules.textFormat ? "@" : null };
  if (rules.date) {
    let first = null;
    for (const fmt of rules.date) {
      const d = parseDate(s, fmt, rules.year);
      if (!d) continue;
      if (sameText(F.displayValue(d, fmt), s)) return { v: d, f: fmt };   // the format Google used
      if (!first) first = { v: d, f: fmt };
    }
    if (first) return first;
    // Text in a format the column didn't show before (e.g. a time added before download)
    const p = /\d/.test(s) && F.parseUserEntered(s);
    if (p && p.value instanceof Date) return { v: p.value, f: p.format || rules.date[0] };
  }
  if (rules.number) {
    const n = parseNumber(s);
    if (n !== null) {
      const fmt = rules.number.find(f => sameText(F.displayValue(n, f || null), s));
      return { v: n, f: (fmt !== undefined ? fmt : rules.number[0]) || null };
    }
  }
  if (rules.bool && /^(true|false)$/i.test(s.trim())) return { v: /^true$/i.test(s.trim()) };
  return { v: s, f: rules.textFormat ? "@" : null };
}

/**
 * Turn CSV rows (arrays of strings, row 1 first) into stored rows for a tab.
 * Keeps the CSV text as the display text, so the tab looks exactly like Google.
 */
function convertRows(spreadsheetId, tab, csvRows) {
  const prof = tabProfile(spreadsheetId, tab);
  const rules = prof ? prof.cols.map(columnRules) : [];
  const out = [];
  let maxCols = 0, stats = { cells: 0, dates: 0, numbers: 0, unprofiled: !prof };
  csvRows.forEach((line, ri) => {
    let n = line.length;
    while (n > 0 && (line[n - 1] === "" || line[n - 1] === undefined)) n--;
    if (!n) { out[ri] = undefined; return; }
    const v = [], f = [], d = [];
    let anyFmt = false;
    for (let ci = 0; ci < n; ci++) {
      const text = line[ci] === undefined ? "" : String(line[ci]);
      const c = convertCell(text, prof ? (rules[ci] || { textOnly: false, date: null, number: null, bool: false, textFormat: false }) : null);
      v.push(c.v); f.push(c.f || null); d.push(text);
      if (c.f) anyFmt = true;
      if (text !== "") stats.cells++;
      if (c.v instanceof Date) stats.dates++; else if (typeof c.v === "number") stats.numbers++;
    }
    maxCols = Math.max(maxCols, n);
    out[ri] = new Row(v, anyFmt ? f : null, d, null);
  });
  return { rows: out, maxCols, profile: prof ? { index: prof.index, sheetId: prof.sheetId, frozenRows: prof.frozenRows, maxCols: prof.maxCols } : null, stats };
}

/** Match a Google CSV file name ("<Spreadsheet> - <Tab>.csv") to a workbook and tab. */
function matchFileName(fileName, workbooks) {
  const base = String(fileName || "").replace(/\.csv$/i, "").replace(/\s+\(\d+\)$/, "").trim();
  let best = null;
  for (const wb of workbooks) {
    const title = String(wb.title || "");
    if (!base.toLowerCase().startsWith(title.toLowerCase() + " - ")) continue;
    if (best && best.wb.title.length >= title.length) continue;
    best = { wb, tab: base.slice(title.length + 3) };
  }
  if (!best) return null;
  const tabs = best.wb.tabs || [];
  const exact = tabs.find(t => t === best.tab) || tabs.find(t => t.toLowerCase() === best.tab.toLowerCase());
  return { spreadsheetId: best.wb.id, tab: exact || best.tab, known: !!exact };
}

module.exports = { parseCsv, convertRows, convertCell, parseDate, tabProfile, profiles, matchFileName, columnRules };
