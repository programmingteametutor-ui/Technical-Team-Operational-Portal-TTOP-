"use strict";
/**
 * Date / number formatting and value parsing that mirrors Google Sheets +
 * Apps Script behaviour closely enough for the portal's logic:
 *   - Utilities.formatDate (Java SimpleDateFormat patterns)
 *   - Sheets number formats used for getDisplayValues()
 *   - Sheets "user entered value" parsing for strings written by setValue(s)
 *
 * The process runs with TZ=Asia/Kolkata (the spreadsheets' and scripts' time
 * zone), so JS Date local time == spreadsheet local time.
 */

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const MONTHS_SHORT = MONTHS.map(m => m.slice(0, 3));
const DAYS = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const DAYS_SHORT = DAYS.map(d => d.slice(0, 3));

const pad = (n, w) => String(Math.abs(n)).padStart(w, "0");

/* ------------------------------------------------------------------ */
/* Time zone helpers                                                   */
/* ------------------------------------------------------------------ */

const dtfCache = new Map();
function partsInZone(date, tz) {
  date = new Date(date.getTime());
  const fixed = parseFixedOffset(tz);
  if (fixed !== null) {
    const d = new Date(date.getTime() + fixed * 60000);
    return {
      y: d.getUTCFullYear(), M: d.getUTCMonth() + 1, d: d.getUTCDate(),
      H: d.getUTCHours(), m: d.getUTCMinutes(), s: d.getUTCSeconds(),
      S: d.getUTCMilliseconds(), dow: d.getUTCDay(), offset: fixed
    };
  }
  let zone = tz || "Asia/Kolkata";
  let f = dtfCache.get(zone);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat("en-US", {
        timeZone: zone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric",
        hour: "numeric", minute: "numeric", second: "numeric", weekday: "short"
      });
    } catch (e) {
      zone = "Asia/Kolkata";
      f = new Intl.DateTimeFormat("en-US", {
        timeZone: zone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric",
        hour: "numeric", minute: "numeric", second: "numeric", weekday: "short"
      });
    }
    dtfCache.set(tz, f);
  }
  const o = {};
  for (const p of f.formatToParts(date)) o[p.type] = p.value;
  const y = Number(o.year), M = Number(o.month), d = Number(o.day);
  const H = Number(o.hour) % 24, m = Number(o.minute), s = Number(o.second);
  const asUtc = Date.UTC(y, M - 1, d, H, m, s);
  const offset = Math.round((asUtc - (date.getTime() - date.getMilliseconds())) / 60000);
  return { y, M, d, H, m, s, S: date.getMilliseconds(), dow: DAYS_SHORT.indexOf(o.weekday), offset };
}

function parseFixedOffset(tz) {
  if (!tz) return null;
  const t = String(tz).trim();
  if (/^(GMT|UTC|Z)$/i.test(t)) return 0;
  const m = /^(?:GMT|UTC)?\s*([+-])(\d{1,2})(?::?(\d{2}))?$/i.exec(t);
  if (!m) return null;
  return (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] || 0));
}

function offsetStr(min, colon) {
  const sign = min < 0 ? "-" : "+";
  const a = Math.abs(min);
  return sign + pad(Math.floor(a / 60), 2) + (colon ? ":" : "") + pad(a % 60, 2);
}

/* ------------------------------------------------------------------ */
/* Utilities.formatDate  (Java SimpleDateFormat)                       */
/* ------------------------------------------------------------------ */

function formatJavaDate(date, tz, pattern) {
  if (!date || typeof date.getTime !== "function" || Object.prototype.toString.call(date) !== "[object Date]" || isNaN(date.getTime())) {
    throw new Error("Exception: The parameters (" + typeof date + ",String,String) don't match the method signature for Utilities.formatDate.");
  }
  const p = partsInZone(date, tz);
  let out = "";
  const s = String(pattern);
  for (let i = 0; i < s.length;) {
    const ch = s[i];
    if (ch === "'") {
      if (s[i + 1] === "'") { out += "'"; i += 2; continue; }
      const end = s.indexOf("'", i + 1);
      out += s.slice(i + 1, end < 0 ? s.length : end);
      i = end < 0 ? s.length : end + 1;
      continue;
    }
    if (!/[A-Za-z]/.test(ch)) { out += ch; i++; continue; }
    let n = 1;
    while (s[i + n] === ch) n++;
    i += n;
    switch (ch) {
      case "y": case "Y": case "u":
        if (ch === "u") { out += String(p.dow === 0 ? 7 : p.dow); break; }
        out += n === 2 ? pad(p.y % 100, 2) : pad(p.y, Math.max(n, 1)); break;
      case "M": case "L":
        out += n >= 4 ? MONTHS[p.M - 1] : n === 3 ? MONTHS_SHORT[p.M - 1] : pad(p.M, n); break;
      case "d": out += pad(p.d, n); break;
      case "D": {
        const doy = Math.floor((Date.UTC(p.y, p.M - 1, p.d) - Date.UTC(p.y, 0, 1)) / 86400000) + 1;
        out += pad(doy, n); break;
      }
      case "E": out += n >= 4 ? DAYS[p.dow] : DAYS_SHORT[p.dow]; break;
      case "a": out += p.H < 12 ? "AM" : "PM"; break;
      case "H": out += pad(p.H, n); break;
      case "k": out += pad(p.H === 0 ? 24 : p.H, n); break;
      case "K": out += pad(p.H % 12, n); break;
      case "h": out += pad(p.H % 12 === 0 ? 12 : p.H % 12, n); break;
      case "m": out += pad(p.m, n); break;
      case "s": out += pad(p.s, n); break;
      case "S": out += pad(p.S, 3).slice(0, Math.max(n, 3)).padEnd(n, "0"); break;
      case "z": out += n >= 4 ? zoneLong(tz, p.offset) : zoneShort(tz, p.offset); break;
      case "Z": out += offsetStr(p.offset, false); break;
      case "X": out += p.offset === 0 ? "Z" : n === 1 ? offsetStr(p.offset, false).slice(0, 3) : offsetStr(p.offset, n >= 3); break;
      default: out += ch.repeat(n);
    }
  }
  return out;
}

function zoneShort(tz, offset) {
  if (tz === "Asia/Kolkata" || tz === "Asia/Calcutta" || tz === "IST") return "IST";
  if (offset === 0) return "GMT";
  return "GMT" + offsetStr(offset, true);
}
function zoneLong(tz, offset) {
  if (tz === "Asia/Kolkata" || tz === "Asia/Calcutta" || tz === "IST") return "India Standard Time";
  return zoneShort(tz, offset);
}

/* ------------------------------------------------------------------ */
/* Sheets number formats -> display string                             */
/* ------------------------------------------------------------------ */

const DEFAULT_DATETIME_FORMAT = "M/d/yyyy H:mm:ss";
const DEFAULT_DATE_FORMAT = "M/d/yyyy";
const DEFAULT_TIME_FORMAT = "h:mm:ss AM/PM";

function isDateFormat(fmt) {
  if (!fmt || fmt === "@" || /^general$/i.test(fmt)) return false;
  const stripped = fmt.replace(/"[^"]*"/g, "").replace(/\\./g, "");
  return /[dDyYhHsS]|m{3,}|M/.test(stripped) && !/[#0]/.test(stripped.replace(/\.0+/g, ""));
}

function formatSheetsDate(date, fmt) {
  const y = date.getFullYear(), M = date.getMonth() + 1, d = date.getDate();
  const H = date.getHours(), mi = date.getMinutes(), s = date.getSeconds(), ms = date.getMilliseconds();
  const dow = date.getDay();
  const ampm = /AM\/PM|am\/pm|A\/P|a\/p/.test(fmt);
  const tokens = [];
  for (let i = 0; i < fmt.length;) {
    const ch = fmt[i];
    if (ch === '"') {
      const end = fmt.indexOf('"', i + 1);
      tokens.push({ lit: fmt.slice(i + 1, end < 0 ? fmt.length : end) });
      i = end < 0 ? fmt.length : end + 1; continue;
    }
    if (ch === "\\") { tokens.push({ lit: fmt[i + 1] || "" }); i += 2; continue; }
    if (/^(AM\/PM|am\/pm)/.test(fmt.slice(i))) { tokens.push({ t: "ampm", upper: fmt[i] === "A" }); i += 5; continue; }
    if (/^(A\/P|a\/p)/.test(fmt.slice(i))) { tokens.push({ t: "ap", upper: fmt[i] === "A" }); i += 3; continue; }
    const lower = ch.toLowerCase();
    if ("dmyhs".includes(lower)) {
      let n = 1;
      while (fmt[i + n] && fmt[i + n].toLowerCase() === lower) n++;
      tokens.push({ t: lower, n, upperM: ch === "M" });
      i += n; continue;
    }
    if (ch === "." && /^\.0+/.test(fmt.slice(i))) {
      const n = /^\.0+/.exec(fmt.slice(i))[0].length - 1;
      tokens.push({ t: "frac", n }); i += n + 1; continue;
    }
    tokens.push({ lit: ch }); i++;
  }
  // Resolve m = minutes when adjacent to h or s (ignoring literals)
  const fieldIdx = tokens.map((t, i) => (t.t ? i : -1)).filter(i => i >= 0);
  fieldIdx.forEach((ti, k) => {
    const t = tokens[ti];
    if (t.t !== "m" || t.n > 2) return;
    if (t.upperM) { t.month = true; return; }
    const prev = k > 0 ? tokens[fieldIdx[k - 1]] : null;
    const next = k < fieldIdx.length - 1 ? tokens[fieldIdx[k + 1]] : null;
    t.month = !((prev && prev.t === "h") || (next && next.t === "s"));
  });
  let out = "";
  for (const t of tokens) {
    if (t.lit !== undefined) { out += t.lit; continue; }
    switch (t.t) {
      case "d":
        out += t.n === 1 ? String(d) : t.n === 2 ? pad(d, 2) : t.n === 3 ? DAYS_SHORT[dow] : DAYS[dow]; break;
      case "m":
        if (t.n >= 3 || t.month) {
          out += t.n === 1 ? String(M) : t.n === 2 ? pad(M, 2) : t.n === 3 ? MONTHS_SHORT[M - 1] : t.n === 5 ? MONTHS[M - 1][0] : MONTHS[M - 1];
        } else out += t.n === 1 ? String(mi) : pad(mi, 2);
        break;
      case "y": out += t.n <= 2 ? pad(y % 100, 2) : String(y); break;
      case "h": {
        const hh = ampm ? (H % 12 === 0 ? 12 : H % 12) : H;
        out += t.n === 1 ? String(hh) : pad(hh, 2); break;
      }
      case "s": out += t.n === 1 ? String(s) : pad(s, 2); break;
      case "frac": out += "." + pad(ms, 3).slice(0, t.n).padEnd(t.n, "0"); break;
      case "ampm": { const v = H < 12 ? "AM" : "PM"; out += t.upper ? v : v.toLowerCase(); break; }
      case "ap": { const v = H < 12 ? "A" : "P"; out += t.upper ? v : v.toLowerCase(); break; }
    }
  }
  return out;
}

function formatGeneralNumber(n) {
  if (!isFinite(n)) return String(n);
  if (Number.isInteger(n) && Math.abs(n) < 1e15) return String(n);
  const abs = Math.abs(n);
  if (abs !== 0 && (abs >= 1e15 || abs < 1e-9)) return n.toExponential(2).toUpperCase().replace("E+", "E+");
  return String(Number(n.toPrecision(11)));
}

function formatSheetsNumber(n, fmt) {
  const section = String(fmt).split(";");
  let f = section[0];
  let neg = n < 0;
  if (neg && section[1] !== undefined) { f = section[1]; }
  const percent = /%/.test(f.replace(/"[^"]*"/g, ""));
  let val = Math.abs(n) * (percent ? 100 : 1);
  const m = /[#0,]*(?:\.[0#]+)?/.exec(f.replace(/"[^"]*"/g, m0 => "\u0000".repeat(m0.length)));
  // locate numeric pattern
  const numMatch = /[#0][#0,]*(\.[0#]+)?|\.[0#]+/.exec(f);
  if (!numMatch) return f.replace(/"/g, "");
  const pat = numMatch[0];
  const decPart = (pat.split(".")[1] || "");
  const minDec = (decPart.match(/0/g) || []).length;
  const maxDec = decPart.length;
  const grouping = pat.includes(",");
  const intPat = pat.split(".")[0].replace(/,/g, "");
  const minInt = (intPat.match(/0/g) || []).length;
  let str = val.toFixed(maxDec);
  let [ip, dp = ""] = str.split(".");
  while (dp.length > minDec && dp.endsWith("0")) dp = dp.slice(0, -1);
  if (ip === "0" && minInt === 0 && dp) ip = "";
  ip = ip.padStart(minInt, "0");
  if (grouping) ip = ip.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const num = ip + (dp ? "." + dp : "");
  const prefix = f.slice(0, numMatch.index).replace(/"([^"]*)"/g, "$1").replace(/\\(.)/g, "$1").replace(/\[\$([^\]-]*)[^\]]*\]/g, "$1");
  const suffix = f.slice(numMatch.index + pat.length).replace(/"([^"]*)"/g, "$1").replace(/\\(.)/g, "$1").replace(/\[\$([^\]-]*)[^\]]*\]/g, "$1");
  const sign = neg && section[1] === undefined && Number(num.replace(/,/g, "")) !== 0 ? "-" : "";
  return sign + prefix + num + suffix;
}

/** Display string for a stored cell value given its number format. */
function displayValue(value, fmt) {
  if (value === null || value === undefined || value === "") return "";
  if (value instanceof Date) {
    if (isNaN(value.getTime())) return "";
    let f = fmt && isDateFormat(fmt) ? fmt : null;
    if (!f) f = DEFAULT_DATETIME_FORMAT;
    return formatSheetsDate(value, f);
  }
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "number") {
    if (!fmt || /^general$/i.test(fmt) || fmt === "@") return formatGeneralNumber(value);
    if (isDateFormat(fmt)) return formatSheetsDate(serialToDate(value), fmt);
    try { return formatSheetsNumber(value, fmt); } catch (e) { return formatGeneralNumber(value); }
  }
  return String(value);
}

/* ------------------------------------------------------------------ */
/* Serial numbers                                                      */
/* ------------------------------------------------------------------ */
// Sheets epoch 1899-12-30 local time
function serialToDate(serial) {
  const days = Math.floor(serial);
  const frac = serial - days;
  const d = new Date(1899, 11, 30, 0, 0, 0, 0);
  d.setDate(d.getDate() + days);
  d.setMilliseconds(Math.round(frac * 86400000));
  return d;
}

/* ------------------------------------------------------------------ */
/* Parsing user-entered strings, as Sheets does on setValue(s)         */
/* ------------------------------------------------------------------ */

const MON_IDX = {};
MONTHS.forEach((m, i) => { MON_IDX[m.toLowerCase()] = i; MON_IDX[m.slice(0, 3).toLowerCase()] = i; });
MON_IDX["sept"] = 8;

function validDate(y, mo, d, h, mi, s) {
  if (mo < 0 || mo > 11 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null;
  const dt = new Date(y, mo, d, h, mi, s, 0);
  if (dt.getMonth() !== mo || dt.getDate() !== d) return null;
  return dt;
}

function parseTime(str) {
  if (!str) return { h: 0, m: 0, s: 0, has: false };
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*([AaPp]\.?[Mm]\.?)?$/.exec(str.trim());
  if (!m) return null;
  let h = Number(m[1]);
  const ap = m[4] ? m[4][0].toUpperCase() : "";
  if (ap) { if (h < 1 || h > 12) return null; if (ap === "P" && h !== 12) h += 12; if (ap === "A" && h === 12) h = 0; }
  return { h, m: Number(m[2]), s: Number(m[3] || 0), has: true, ampm: !!ap, secs: m[3] !== undefined };
}

/**
 * Returns { value, format } for a user-entered string, following Sheets'
 * en_US parsing. Returns null when the string stays text.
 */
function parseUserEntered(str) {
  const t = str.trim();
  if (t === "") return null;
  if (/^(true|false)$/i.test(t)) return { value: /^true$/i.test(t), format: null };
  if (/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(t)) {
    // Sheets keeps leading-zero codes like "007" as numbers too (7); mirror that.
    const n = Number(t);
    if (isFinite(n)) return { value: n, format: null };
  }
  if (/^[+-]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) return { value: Number(t.replace(/,/g, "")), format: "#,##0" + (t.includes(".") ? ".00" : "") };
  if (/^[+-]?(\d+\.?\d*|\.\d+)%$/.test(t)) return { value: Number(t.slice(0, -1)) / 100, format: "0" + (t.includes(".") ? ".00" : "") + "%" };
  if (/^-?\$\s?\d{1,3}(,?\d{3})*(\.\d+)?$/.test(t)) return { value: Number(t.replace(/[$,\s]/g, "")), format: "\"$\"#,##0.00" };

  let m;
  // M/d/yyyy [time]   or M/d/yy
  if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})(?:\s+(.+))?$/.exec(t))) {
    const tm = parseTime(m[4]);
    if (!tm) return null;
    let y = Number(m[3]); if (m[3].length === 2) y += y < 30 ? 2000 : 1900;
    const dt = validDate(y, Number(m[1]) - 1, Number(m[2]), tm.h, tm.m, tm.s);
    if (!dt) return null;
    return { value: dt, format: tm.has ? DEFAULT_DATETIME_FORMAT : DEFAULT_DATE_FORMAT };
  }
  // M/d (current year)
  if ((m = /^(\d{1,2})\/(\d{1,2})$/.exec(t))) {
    const dt = validDate(new Date().getFullYear(), Number(m[1]) - 1, Number(m[2]), 0, 0, 0);
    return dt ? { value: dt, format: DEFAULT_DATE_FORMAT } : null;
  }
  // yyyy-MM-dd [time] / yyyy/MM/dd
  if ((m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](.+))?$/.exec(t))) {
    const tm = parseTime(m[4]);
    if (!tm) return null;
    const dt = validDate(Number(m[1]), Number(m[2]) - 1, Number(m[3]), tm.h, tm.m, tm.s);
    if (!dt) return null;
    return { value: dt, format: tm.has ? "yyyy-mm-dd H:mm:ss" : "yyyy-mm-dd" };
  }
  // d-MMM-yyyy / d MMM yyyy / d-MMM-yy
  if ((m = /^(\d{1,2})[- ]([A-Za-z]{3,9})\.?[- ,]+(\d{2}|\d{4})(?:\s+(.+))?$/.exec(t))) {
    const mo = MON_IDX[m[2].toLowerCase()];
    if (mo === undefined) return null;
    const tm = parseTime(m[4]); if (!tm) return null;
    let y = Number(m[3]); if (m[3].length === 2) y += y < 30 ? 2000 : 1900;
    const dt = validDate(y, mo, Number(m[1]), tm.h, tm.m, tm.s);
    if (!dt) return null;
    return { value: dt, format: tm.has ? "d-mmm-yyyy H:mm:ss" : "d-mmm-yyyy" };
  }
  // MMM d, yyyy
  if ((m = /^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})(?:\s+(.+))?$/.exec(t))) {
    const mo = MON_IDX[m[1].toLowerCase()];
    if (mo === undefined) return null;
    const tm = parseTime(m[4]); if (!tm) return null;
    const dt = validDate(Number(m[3]), mo, Number(m[2]), tm.h, tm.m, tm.s);
    if (!dt) return null;
    return { value: dt, format: tm.has ? "mmm d, yyyy H:mm:ss" : "mmm d, yyyy" };
  }
  // time only
  const tm = parseTime(t);
  if (tm && tm.has) {
    const dt = new Date(1899, 11, 30, tm.h, tm.m, tm.s, 0);
    return { value: dt, format: tm.ampm ? (tm.secs ? "h:mm:ss AM/PM" : "h:mm AM/PM") : "H:mm:ss" };
  }
  return null;
}

module.exports = {
  formatJavaDate, displayValue, parseUserEntered, serialToDate, isDateFormat,
  formatSheetsDate, formatSheetsNumber, DEFAULT_DATETIME_FORMAT, DEFAULT_DATE_FORMAT
};
