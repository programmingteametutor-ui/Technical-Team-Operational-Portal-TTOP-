"use strict";
/**
 * SpreadsheetApp emulation over the in-memory Store.
 * Implements the methods the Dhruva portal projects use, with Google Sheets
 * semantics (1-based rows/cols, value parsing, display values, getLastRow…).
 */
const { SheetData, Row } = require("../store");
const F = require("./format");

/* ------------------------------------------------------------------ */
/* A1 helpers                                                          */
/* ------------------------------------------------------------------ */
function colToLetters(c) {
  let s = "";
  while (c > 0) { const m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = Math.floor((c - 1) / 26); }
  return s;
}
function lettersToCol(l) {
  let c = 0;
  for (const ch of l.toUpperCase()) c = c * 26 + (ch.charCodeAt(0) - 64);
  return c;
}
function parseA1(a1, sheet) {
  const ref = String(a1).trim().replace(/\$/g, "");
  const m = /^([A-Za-z]*)(\d*)(?::([A-Za-z]*)(\d*))?$/.exec(ref);
  if (!m || (!m[1] && !m[2])) throw new Error("Exception: Range not found");
  const maxRows = Math.max(sheet.maxRows, 1), maxCols = Math.max(sheet.maxCols, 1);
  let r1 = m[2] ? Number(m[2]) : 1;
  let c1 = m[1] ? lettersToCol(m[1]) : 1;
  let r2, c2;
  if (m[3] !== undefined || m[4] !== undefined) {
    r2 = m[4] ? Number(m[4]) : maxRows;
    c2 = m[3] ? lettersToCol(m[3]) : maxCols;
    if (!m[2] && m[1]) r1 = 1;        // "A:B"
    if (!m[1] && m[2]) { c1 = 1; }    // "2:5"
    if (!m[3] && m[4] && m[1]) c2 = c1 === lettersToCol(m[1]) && !m[3] ? maxCols : c2; // "A2:5" rare
  } else {
    r2 = r1; c2 = c1;
  }
  return { row: Math.min(r1, r2), col: Math.min(c1, c2), numRows: Math.abs(r2 - r1) + 1, numCols: Math.abs(c2 - c1) + 1 };
}

/* ------------------------------------------------------------------ */
/* Value conversion                                                    */
/* ------------------------------------------------------------------ */
function cloneOut(v, env) {
  if (v === undefined || v === null) return "";
  if (v instanceof Date) return env ? new env.realm.Date(v.getTime()) : new Date(v.getTime());
  return v;
}

/** Convert a value written by a script into the stored value (+ implied format). */
function toStored(input, currentFormat, ctx) {
  if (input === null || input === undefined) return { value: "" };
  // Values coming from another vm context fail `instanceof Date` checks; detect structurally.
  if (isDateLike(input)) {
    const t = input.getTime();
    if (isNaN(t)) return { value: "" };
    return { value: new Date(t), format: currentFormat && F.isDateFormat(currentFormat) ? undefined : F.DEFAULT_DATETIME_FORMAT, keepIfSet: true };
  }
  const type = typeof input;
  if (type === "number") {
    if (!isFinite(input)) return { value: "#NUM!" };
    return { value: input };
  }
  if (type === "boolean") return { value: input };
  if (type === "string") {
    if (input === "") return { value: "" };
    if (currentFormat === "@") return { value: input };
    if (input[0] === "'") return { value: input.slice(1) };
    if (input[0] === "=" && input.length > 1) {
      if (ctx && ctx.warn) ctx.warn("Formula written as text (formulas are not evaluated): " + input.slice(0, 80));
      return { value: input };
    }
    const parsed = F.parseUserEntered(input);
    if (parsed) return { value: parsed.value, format: parsed.format || undefined, keepIfSet: true };
    return { value: input };
  }
  if (Array.isArray(input)) return { value: String(input) };
  return { value: String(input) };
}
function isDateLike(v) {
  return v instanceof Date || (v && typeof v === "object" && Object.prototype.toString.call(v) === "[object Date]");
}

/* ------------------------------------------------------------------ */
/* Factory                                                             */
/* ------------------------------------------------------------------ */
function createSpreadsheetApp(env) {
  const { store, project } = env;
  const journal = () => {
    if (!store.journal) throw new Error("Internal: no active execution journal");
    return store.journal;
  };

  const sheetObjs = new WeakMap();
  const ssObjs = new WeakMap();

  function wrapSS(wb) {
    let o = ssObjs.get(wb);
    if (!o) { o = makeSpreadsheet(wb); ssObjs.set(wb, o); }
    return o;
  }
  function wrapSheet(sd) {
    let o = sheetObjs.get(sd);
    if (!o) { o = makeSheet(sd); sheetObjs.set(sd, o); }
    return o;
  }
  function liveCheck(sd) {
    if (!sd.workbook || !sd.workbook.sheets.includes(sd)) throw new env.realm.Error("Exception: The sheet has been deleted.");
  }

  /* ------------------------- cell primitives ------------------------- */
  function getRow(sd, idx) { return sd.rows[idx]; }
  function ensureRow(sd, idx) {
    let r = sd.rows[idx];
    if (!r) { r = new Row(); sd.rows[idx] = r; }
    return r;
  }
  function cellFormat(sd, r, c) {
    const row = sd.rows[r - 1];
    if (!row || !row.f) return null;
    return row.f[c - 1] || null;
  }
  function growTo(sd, row, col) {
    if (row > sd.maxRows || col > sd.maxCols) {
      journal().touchMeta(sd);
      if (row > sd.maxRows) sd.maxRows = row;
      if (col > sd.maxCols) sd.maxCols = col;
    }
  }
  function writeCell(sd, r, c, input, opts) {
    const j = journal();
    j.touchRow(sd, r - 1);
    const row = ensureRow(sd, r - 1);
    const fmt = row.f ? row.f[c - 1] || null : null;
    const st = toStored(input, fmt, env);
    // Same value over a plain cell (no formula): Google shows it unchanged, so keep its imported display text
    const same = !(row.x && row.x[c - 1]) && sameCell(row.v[c - 1], st.value);
    while (row.v.length < c - 1) row.v.push("");
    row.v[c - 1] = st.value;
    if (row.d && !same) row.d[c - 1] = undefined;
    if (row.x) row.x[c - 1] = undefined;
    if (st.format !== undefined && !(opts && opts.noFormat)) {
      if (!fmt || !st.keepIfSet || (st.value instanceof Date && !F.isDateFormat(fmt))) {
        if (!row.f) row.f = [];
        row.f[c - 1] = st.format;
      }
    }
  }
  function sameCell(a, b) {
    const empty = (v) => v === "" || v === null || v === undefined;
    if (empty(a) || empty(b)) return empty(a) && empty(b);
    if (a instanceof Date || b instanceof Date) return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
    return a === b;
  }
  function readValue(sd, r, c) {
    const row = sd.rows[r - 1];
    if (!row) return "";
    return cloneOut(row.v[c - 1], env);
  }
  function readDisplay(sd, r, c) {
    const row = sd.rows[r - 1];
    if (!row) return "";
    if (row.d && row.d[c - 1] !== undefined && row.d[c - 1] !== null) return String(row.d[c - 1]);
    const v = row.v[c - 1];
    return F.displayValue(v, row.f ? row.f[c - 1] : null);
  }

  /* ------------------------------ Range ------------------------------ */
  function makeRange(sd, row, col, numRows, numCols) {
    if (!(row >= 1) || !(col >= 1)) throw new env.realm.Error("Exception: Range not found");
    if (numRows < 1) throw new env.realm.Error("Exception: The number of rows in the range must be at least 1.");
    if (numCols < 1) throw new env.realm.Error("Exception: The number of columns in the range must be at least 1.");
    row = Math.floor(row); col = Math.floor(col); numRows = Math.floor(numRows); numCols = Math.floor(numCols);
    const R = {
      getSheet: () => wrapSheet(sd),
      getRow: () => row, getRowIndex: () => row,
      getColumn: () => col, getColumnIndex: () => col,
      getNumRows: () => numRows, getHeight: () => numRows,
      getNumColumns: () => numCols, getWidth: () => numCols,
      getLastRow: () => row + numRows - 1,
      getLastColumn: () => col + numCols - 1,
      getA1Notation: () => {
        const a = colToLetters(col) + row;
        if (numRows === 1 && numCols === 1) return a;
        return a + ":" + colToLetters(col + numCols - 1) + (row + numRows - 1);
      },
      getGridId: () => sd.sheetId,
      getValues: () => { liveCheck(sd); const out = new env.realm.Array(); for (let r = 0; r < numRows; r++) { const a = new env.realm.Array(numCols); for (let c = 0; c < numCols; c++) a[c] = readValue(sd, row + r, col + c); out.push(a); } return out; },
      getDisplayValues: () => { liveCheck(sd); const out = new env.realm.Array(); for (let r = 0; r < numRows; r++) { const a = new env.realm.Array(numCols); for (let c = 0; c < numCols; c++) a[c] = readDisplay(sd, row + r, col + c); out.push(a); } return out; },
      getValue: () => { liveCheck(sd); return readValue(sd, row, col); },
      getDisplayValue: () => { liveCheck(sd); return readDisplay(sd, row, col); },
      getFormula: () => { const r = sd.rows[row - 1]; return (r && r.x && r.x[col - 1]) || ""; },
      getFormulas: () => { const out = new env.realm.Array(); for (let r = 0; r < numRows; r++) { const rr = sd.rows[row - 1 + r]; const a = new env.realm.Array(); for (let c = 0; c < numCols; c++) a.push((rr && rr.x && rr.x[col - 1 + c]) || ""); out.push(a); } return out; },
      setValues: (values) => {
        liveCheck(sd);
        if (!Array.isArray(values)) throw new env.realm.Error("Exception: The parameters (" + typeof values + ") don't match the method signature for SpreadsheetApp.Range.setValues.");
        if (values.length !== numRows) throw new env.realm.Error("Exception: The number of rows in the data does not match the number of rows in the range. The data has " + values.length + " but the range has " + numRows + ".");
        for (let r = 0; r < numRows; r++) {
          const line = values[r];
          if (!Array.isArray(line)) throw new env.realm.Error("Exception: The parameters (number[]) don't match the method signature for SpreadsheetApp.Range.setValues.");
          if (line.length !== numCols) throw new env.realm.Error("Exception: The number of columns in the data does not match the number of columns in the range. The data has " + line.length + " but the range has " + numCols + ".");
        }
        growTo(sd, row + numRows - 1, col + numCols - 1);
        for (let r = 0; r < numRows; r++) for (let c = 0; c < numCols; c++) writeCell(sd, row + r, col + c, values[r][c]);
        return R.__self;
      },
      setValue: (value) => {
        liveCheck(sd);
        growTo(sd, row + numRows - 1, col + numCols - 1);
        for (let r = 0; r < numRows; r++) for (let c = 0; c < numCols; c++) writeCell(sd, row + r, col + c, value);
        return R.__self;
      },
      setFormula: (f) => R.setValue(f),
      setFormulas: (fs) => R.setValues(fs),
      clearContent: () => { clearRange(sd, row, col, numRows, numCols, true, false); return R.__self; },
      clearContents: () => R.clearContent(),
      clear: (opts) => {
        const contentsOnly = opts && opts.contentsOnly; const formatOnly = opts && opts.formatOnly;
        clearRange(sd, row, col, numRows, numCols, !formatOnly, !contentsOnly);
        return R.__self;
      },
      clearFormat: () => { clearRange(sd, row, col, numRows, numCols, false, true); return R.__self; },
      clearFormats: () => R.clearFormat(),
      clearDataValidations: () => R,
      clearNote: () => R,
      isBlank: () => { for (let r = 0; r < numRows; r++) for (let c = 0; c < numCols; c++) { const v = readValue(sd, row + r, col + c); if (v !== "") return false; } return true; },
      getNumberFormat: () => cellFormat(sd, row, col) || "General",
      getNumberFormats: () => { const out = new env.realm.Array(); for (let r = 0; r < numRows; r++) { const a = new env.realm.Array(); for (let c = 0; c < numCols; c++) a.push(cellFormat(sd, row + r, col + c) || "General"); out.push(a); } return out; },
      setNumberFormat: (fmt) => { setFormats(sd, row, col, numRows, numCols, () => fmt); return R.__self; },
      setNumberFormats: (fmts) => { setFormats(sd, row, col, numRows, numCols, (r, c) => fmts[r][c]); return R.__self; },
      offset: (ro, co, nr, nc) => makeRange(sd, row + ro, col + co, nr === undefined ? numRows : nr, nc === undefined ? numCols : nc),
      getCell: (r, c) => makeRange(sd, row + r - 1, col + c - 1, 1, 1),
      sort: (spec) => { sortRange(sd, row, col, numRows, numCols, spec); return R.__self; },
      copyTo: (dest, opt) => { copyRange(sd, row, col, numRows, numCols, dest, opt); return R.__self; },
      copyValuesToRange: (sheet, c1, c2, r1, r2) => { const vals = R.getValues(); sheet.getRange(r1, c1, numRows, numCols).setValues(vals); },
      createTextFinder: (text) => makeTextFinder(sd, text, row, col, numRows, numCols),
      activate: () => R,
      getMergedRanges: () => [],
      getDataValidation: () => null,
      getDataValidations: () => { const out = []; for (let r = 0; r < numRows; r++) out.push(new Array(numCols).fill(null)); return out; },
      getBackground: () => "#ffffff",
      getBackgrounds: () => { const out = []; for (let r = 0; r < numRows; r++) out.push(new Array(numCols).fill("#ffffff")); return out; },
      getFontWeight: () => "normal",
      getFontColor: () => "#000000",
      getNote: () => "",
      getNotes: () => { const out = []; for (let r = 0; r < numRows; r++) out.push(new Array(numCols).fill("")); return out; },
      getRichTextValue: () => null,
      getDataSourceUrl: () => "",
      getFilter: () => null,
      toString: () => "Range"
    };
    return chainable(R, "Range");
  }

  function clearRange(sd, row, col, numRows, numCols, values, formats) {
    const j = journal();
    const last = Math.min(row + numRows - 1, sd.rows.length);
    for (let r = row; r <= last; r++) {
      const rr = sd.rows[r - 1];
      if (!rr) continue;
      j.touchRow(sd, r - 1);
      for (let c = col; c < col + numCols; c++) {
        if (values) { if (c - 1 < rr.v.length) rr.v[c - 1] = ""; if (rr.d) rr.d[c - 1] = undefined; if (rr.x) rr.x[c - 1] = undefined; }
        if (formats && rr.f) rr.f[c - 1] = null;
      }
      trimRow(rr);
      if (rr.isEmpty()) sd.rows[r - 1] = undefined;
    }
  }
  function trimRow(rr) {
    while (rr.v.length && (rr.v[rr.v.length - 1] === "" || rr.v[rr.v.length - 1] === undefined)) rr.v.pop();
  }
  function setFormats(sd, row, col, numRows, numCols, fn) {
    const j = journal();
    growTo(sd, row + numRows - 1, col + numCols - 1);
    for (let r = 0; r < numRows; r++) {
      j.touchRow(sd, row - 1 + r);
      const rr = ensureRow(sd, row - 1 + r);
      if (!rr.f) rr.f = [];
      for (let c = 0; c < numCols; c++) {
        const f = fn(r, c);
        const nf = !f || /^general$/i.test(f) ? null : String(f);
        if ((rr.f[col - 1 + c] || null) === nf) continue;   // format unchanged: display unchanged
        rr.f[col - 1 + c] = nf;
        if (rr.d) rr.d[col - 1 + c] = undefined;
      }
    }
  }
  function sortKey(v) {
    if (v === "" || v === null || v === undefined) return [4, 0];
    if (typeof v === "number") return [0, v];
    if (v instanceof Date) return [0, (v.getTime() - new Date(1899, 11, 30).getTime()) / 86400000];
    if (typeof v === "boolean") return [2, v ? 1 : 0];
    return [1, String(v).toLowerCase()];
  }
  function sortRange(sd, row, col, numRows, numCols, spec) {
    let specs = Array.isArray(spec) ? spec : [spec];
    specs = specs.map(s => (typeof s === "number" ? { column: s, ascending: true } : { column: s.column, ascending: s.ascending !== false }));
    const j = journal();
    const lines = [];
    for (let r = 0; r < numRows; r++) {
      j.touchRow(sd, row - 1 + r);
      const rr = sd.rows[row - 1 + r];
      lines.push({
        v: Array.from({ length: numCols }, (_, c) => (rr ? rr.v[col - 1 + c] : "")),
        f: Array.from({ length: numCols }, (_, c) => (rr && rr.f ? rr.f[col - 1 + c] : null)),
        d: Array.from({ length: numCols }, (_, c) => (rr && rr.d ? rr.d[col - 1 + c] : undefined))
      });
    }
    lines.sort((a, b) => {
      for (const s of specs) {
        const ka = sortKey(a.v[s.column - col]), kb = sortKey(b.v[s.column - col]);
        if (ka[0] === 4 && kb[0] === 4) continue;
        if (ka[0] === 4) return 1; if (kb[0] === 4) return -1; // blanks always last
        let d = ka[0] - kb[0];
        if (!d) d = ka[1] < kb[1] ? -1 : ka[1] > kb[1] ? 1 : 0;
        if (d) return s.ascending ? d : -d;
      }
      return 0;
    });
    lines.forEach((ln, r) => {
      const rr = ensureRow(sd, row - 1 + r);
      for (let c = 0; c < numCols; c++) {
        while (rr.v.length < col - 1 + c) rr.v.push("");
        rr.v[col - 1 + c] = ln.v[c] === undefined ? "" : ln.v[c];
        if (ln.f[c] || rr.f) { if (!rr.f) rr.f = []; rr.f[col - 1 + c] = ln.f[c]; }
        if (ln.d[c] !== undefined || rr.d) { if (!rr.d) rr.d = []; rr.d[col - 1 + c] = ln.d[c]; }
      }
      trimRow(rr);
    });
  }
  function copyRange(sd, row, col, numRows, numCols, dest, opt) {
    const vals = []; const fmts = [];
    for (let r = 0; r < numRows; r++) {
      const rr = sd.rows[row - 1 + r];
      vals.push(Array.from({ length: numCols }, (_, c) => { const v = rr ? rr.v[col - 1 + c] : ""; return v instanceof Date ? new Date(v.getTime()) : (v === undefined ? "" : v); }));
      fmts.push(Array.from({ length: numCols }, (_, c) => (rr && rr.f ? rr.f[col - 1 + c] : null)));
    }
    const target = dest.getSheet().getRange(dest.getRow(), dest.getColumn(), numRows, numCols);
    const formatOnly = opt && opt.formatOnly;
    if (!formatOnly) {
      // copy raw stored values without re-parsing
      const tsd = target.getSheet().__data;
      growTo(tsd, dest.getRow() + numRows - 1, dest.getColumn() + numCols - 1);
      for (let r = 0; r < numRows; r++) for (let c = 0; c < numCols; c++) {
        journal().touchRow(tsd, dest.getRow() - 2 + r + 1);
        const rr = ensureRow(tsd, dest.getRow() - 1 + r);
        while (rr.v.length < dest.getColumn() - 1 + c) rr.v.push("");
        rr.v[dest.getColumn() - 1 + c] = vals[r][c];
        if (rr.d) rr.d[dest.getColumn() - 1 + c] = undefined;
      }
    }
    if (!(opt && opt.contentsOnly)) target.setNumberFormats(fmts.map(l => l.map(f => f || "General")));
  }
  function makeTextFinder(sd, text, row, col, numRows, numCols) {
    let matchCase = false, entire = false, regex = false, cursor = -1;
    const find = () => {
      const res = [];
      const nr = numRows === undefined ? Math.max(sd.lastRow(), 0) : numRows;
      const nc = numCols === undefined ? Math.max(sd.lastCol(), 0) : numCols;
      const r0 = row || 1, c0 = col || 1;
      let re = null;
      if (regex) re = new RegExp(entire ? "^(?:" + text + ")$" : text, matchCase ? "" : "i");
      const needle = matchCase ? String(text) : String(text).toLowerCase();
      for (let r = r0; r < r0 + nr; r++) {
        if (!sd.rows[r - 1]) continue;
        for (let c = c0; c < c0 + nc; c++) {
          let hay = readDisplay(sd, r, c);
          if (hay === "") continue;
          let ok;
          if (re) ok = re.test(hay);
          else { if (!matchCase) hay = hay.toLowerCase(); ok = entire ? hay === needle : hay.indexOf(needle) >= 0; }
          if (ok) res.push([r, c]);
        }
      }
      return res;
    };
    const T = {
      matchCase: (b) => { matchCase = !!b; return T; },
      matchEntireCell: (b) => { entire = !!b; return T; },
      useRegularExpression: (b) => { regex = !!b; return T; },
      matchFormulaText: () => T, ignoreDiacritics: () => T,
      findAll: () => env.realm.Array.from(find().map(([r, c]) => makeRange(sd, r, c, 1, 1))),
      findNext: () => { const all = find(); cursor++; if (cursor >= all.length) return null; const [r, c] = all[cursor]; return makeRange(sd, r, c, 1, 1); },
      findPrevious: () => { const all = find(); cursor--; if (cursor < 0) return null; const [r, c] = all[cursor]; return makeRange(sd, r, c, 1, 1); },
      replaceAllWith: (rep) => { const all = find(); for (const [r, c] of all) { const v = readDisplay(sd, r, c); makeRange(sd, r, c, 1, 1).setValue(regex ? v.replace(new RegExp(text, matchCase ? "g" : "gi"), rep) : v.split(text).join(rep)); } return all.length; },
      getCurrentMatch: () => null
    };
    return T;
  }

  /* ------------------------------ Sheet ------------------------------ */
  function makeSheet(sd) {
    const S = {
      __data: sd,
      getName: () => sd.name,
      getSheetName: () => sd.name,
      setName: (n) => {
        liveCheck(sd);
        n = String(n);
        if (sd.workbook.sheets.some(s => s !== sd && s.name.toLowerCase() === n.toLowerCase())) throw new env.realm.Error('Exception: A sheet with the name "' + n + '" already exists. Please enter another name.');
        journal().touchMeta(sd); sd.name = n; return S.__self;
      },
      getSheetId: () => sd.sheetId,
      getIndex: () => sd.workbook.sheets.indexOf(sd) + 1,
      getParent: () => wrapSS(sd.workbook),
      getType: () => "GRID",
      getRange: (a, b, c, d) => {
        liveCheck(sd);
        if (typeof a === "string") {
          let ref = a;
          const bang = a.lastIndexOf("!");
          if (bang >= 0) ref = a.slice(bang + 1);
          const p = parseA1(ref, sd);
          return makeRange(sd, p.row, p.col, p.numRows, p.numCols);
        }
        return makeRange(sd, a, b, c === undefined ? 1 : c, d === undefined ? 1 : d);
      },
      getRangeList: (list) => {
        const ranges = list.map(a => S.getRange(a));
        const RL = { getRanges: () => ranges };
        return chainable(RL, "RangeList", (name, args) => { ranges.forEach(r => r[name] && r[name](...args)); return RL.__self; });
      },
      getDataRange: () => { liveCheck(sd); return makeRange(sd, 1, 1, Math.max(sd.lastRow(), 1), Math.max(sd.lastCol(), 1)); },
      getLastRow: () => { liveCheck(sd); return sd.lastRow(); },
      getLastColumn: () => { liveCheck(sd); return sd.lastCol(); },
      getMaxRows: () => sd.maxRows,
      getMaxColumns: () => sd.maxCols,
      getFrozenRows: () => sd.frozenRows,
      getFrozenColumns: () => sd.frozenCols,
      setFrozenRows: (n) => { journal().touchMeta(sd); sd.frozenRows = Number(n) || 0; return S.__self; },
      setFrozenColumns: (n) => { journal().touchMeta(sd); sd.frozenCols = Number(n) || 0; return S.__self; },
      isSheetHidden: () => sd.hidden,
      hideSheet: () => { journal().touchMeta(sd); sd.hidden = true; return S.__self; },
      showSheet: () => { journal().touchMeta(sd); sd.hidden = false; return S.__self; },
      activate: () => S,
      appendRow: (arr) => {
        liveCheck(sd);
        if (!Array.isArray(arr)) throw new env.realm.Error("Exception: The parameters don't match the method signature for SpreadsheetApp.Sheet.appendRow.");
        const r = sd.lastRow() + 1;
        growTo(sd, r, arr.length);
        arr.forEach((v, i) => writeCell(sd, r, i + 1, v));
        return S.__self;
      },
      clear: (opts) => {
        liveCheck(sd);
        const contentsOnly = opts && opts.contentsOnly;
        const formatOnly = opts && opts.formatOnly;
        journal().touchStructure(sd);
        if (!contentsOnly && !formatOnly) sd.rows = [];
        else clearRange(sd, 1, 1, sd.rows.length, Math.max(sd.maxCols, 1), !formatOnly, !contentsOnly);
        return S.__self;
      },
      clearContents: () => { liveCheck(sd); journal().touchStructure(sd); clearRange(sd, 1, 1, sd.rows.length, Math.max(sd.maxCols, sd.lastCol(), 1), true, false); return S.__self; },
      clearFormats: () => { liveCheck(sd); journal().touchStructure(sd); clearRange(sd, 1, 1, sd.rows.length, Math.max(sd.maxCols, 1), false, true); return S.__self; },
      clearConditionalFormatRules: () => S,
      insertRowsAfter: (after, n) => { insertRows(sd, after, n); return S.__self; },
      insertRowAfter: (after) => { insertRows(sd, after, 1); return S.__self; },
      insertRowsBefore: (before, n) => { insertRows(sd, before - 1, n); return S.__self; },
      insertRowBefore: (before) => { insertRows(sd, before - 1, 1); return S.__self; },
      insertRows: (before, n) => { insertRows(sd, before - 1, n === undefined ? 1 : n); return S.__self; },
      deleteRow: (r) => { deleteRows(sd, r, 1); return S.__self; },
      deleteRows: (r, n) => { deleteRows(sd, r, n); return S.__self; },
      insertColumnsAfter: (after, n) => { insertCols(sd, after, n); return S.__self; },
      insertColumnAfter: (after) => { insertCols(sd, after, 1); return S.__self; },
      insertColumnsBefore: (before, n) => { insertCols(sd, before - 1, n); return S.__self; },
      insertColumnBefore: (before) => { insertCols(sd, before - 1, 1); return S.__self; },
      insertColumns: (before, n) => { insertCols(sd, before - 1, n === undefined ? 1 : n); return S.__self; },
      deleteColumn: (c) => { deleteCols(sd, c, 1); return S.__self; },
      deleteColumns: (c, n) => { deleteCols(sd, c, n); return S.__self; },
      sort: (column, ascending) => {
        const fr = sd.frozenRows || 0;
        const lr = sd.lastRow();
        if (lr > fr) sortRange(sd, fr + 1, 1, lr - fr, Math.max(sd.lastCol(), 1), { column, ascending: ascending !== false });
        return S.__self;
      },
      createTextFinder: (text) => makeTextFinder(sd, text),
      getFilter: () => null,
      getConditionalFormatRules: () => [],
      getProtections: () => [],
      getCharts: () => [],
      getNamedRanges: () => [],
      getDataRange_: undefined,
      copyTo: (targetSS) => {
        const twb = targetSS.__data;
        let base = "Copy of " + sd.name, name = base, i = 1;
        while (twb.sheets.some(s => s.name === name)) name = base + " " + (++i);
        const ns = addSheet(twb, name, twb.sheets.length);
        ns.maxRows = sd.maxRows; ns.maxCols = sd.maxCols; ns.frozenRows = sd.frozenRows;
        ns.rows = sd.rows.map(r => (r ? r.clone() : r));
        return wrapSheet(ns);
      },
      protect: () => chainable({}, "Protection"),
      toString: () => "Sheet"
    };
    return chainable(S, "Sheet");
  }

  function insertRows(sd, after, n) {
    liveCheck(sd);
    n = Number(n); after = Number(after);
    if (!(n >= 1)) throw new env.realm.Error("Exception: The number of rows to insert must be at least 1.");
    journal().touchStructure(sd); journal().touchMeta(sd);
    while (sd.rows.length < after) sd.rows.push(undefined);
    sd.rows.splice(after, 0, ...new Array(n).fill(undefined));
    sd.maxRows += n;
  }
  function deleteRows(sd, start, n) {
    liveCheck(sd);
    start = Number(start); n = Number(n);
    if (start < 1 || start + n - 1 > sd.maxRows) throw new env.realm.Error("Exception: Those rows are out of bounds.");
    if (sd.maxRows - n < 1) throw new env.realm.Error("Exception: You can't delete all the rows on the sheet.");
    journal().touchStructure(sd); journal().touchMeta(sd);
    sd.rows.splice(start - 1, n);
    sd.maxRows -= n;
  }
  function insertCols(sd, after, n) {
    liveCheck(sd);
    journal().touchStructure(sd); journal().touchMeta(sd);
    for (const r of sd.rows) {
      if (!r) continue;
      const ins = (arr, fill) => { if (!arr) return; while (arr.length < after) arr.push(fill); arr.splice(after, 0, ...new Array(n).fill(fill)); };
      ins(r.v, ""); ins(r.f, null); ins(r.d, undefined); ins(r.x, undefined);
      trimRow(r);
    }
    sd.maxCols += n;
  }
  function deleteCols(sd, start, n) {
    liveCheck(sd);
    journal().touchStructure(sd); journal().touchMeta(sd);
    for (let i = 0; i < sd.rows.length; i++) {
      const r = sd.rows[i];
      if (!r) continue;
      for (const arr of [r.v, r.f, r.d, r.x]) if (arr) arr.splice(start - 1, n);
      if (r.isEmpty()) sd.rows[i] = undefined;
    }
    sd.maxCols = Math.max(1, sd.maxCols - n);
  }

  function addSheet(wb, name, index) {
    const sd = new SheetData({ sheetId: wb.nextSheetId(), name, maxRows: 1000, maxCols: 26 });
    sd.workbook = wb;
    journal().touchWorkbookOrder(wb);
    wb.sheets.splice(index === undefined ? wb.sheets.length : Math.max(0, Math.min(index, wb.sheets.length)), 0, sd);
    journal().createdSheets.add(sd);
    return sd;
  }

  /* --------------------------- Spreadsheet --------------------------- */
  function makeSpreadsheet(wb) {
    const SS = {
      __data: wb,
      getId: () => wb.id,
      getName: () => wb.title,
      rename: (n) => { wb.title = String(n); },
      getUrl: () => env.sheetUrl(wb.id),
      getSpreadsheetTimeZone: () => wb.timeZone,
      getSpreadsheetLocale: () => "en_US",
      getSheets: () => env.realm.Array.from(wb.sheets.map(wrapSheet)),
      getNumSheets: () => wb.sheets.length,
      getSheetByName: (name) => { const s = wb.sheets.find(x => x.name === String(name)); return s ? wrapSheet(s) : null; },
      getSheetById: (id) => { const s = wb.sheets.find(x => x.sheetId === Number(id)); return s ? wrapSheet(s) : null; },
      getActiveSheet: () => (wb.sheets[0] ? wrapSheet(wb.sheets[0]) : null),
      setActiveSheet: (s) => s,
      getActiveRange: () => null,
      getRange: (a1) => {
        const bang = String(a1).lastIndexOf("!");
        if (bang < 0) return SS.getActiveSheet().getRange(a1);
        const name = String(a1).slice(0, bang).replace(/^'|'$/g, "").replace(/''/g, "'");
        const s = SS.getSheetByName(name);
        if (!s) throw new env.realm.Error("Exception: Range not found");
        return s.getRange(String(a1).slice(bang + 1));
      },
      getRangeByName: () => null,
      insertSheet: (a, b) => {
        let name, index;
        if (typeof a === "number") index = a;
        else { name = a; index = typeof b === "number" ? b : undefined; }
        if (name === undefined || name === null || name === "") {
          let i = wb.sheets.length + 1; while (wb.sheets.some(s => s.name === "Sheet" + i)) i++; name = "Sheet" + i;
        }
        name = String(name);
        if (wb.sheets.some(s => s.name.toLowerCase() === name.toLowerCase())) throw new env.realm.Error('Exception: A sheet with the name "' + name + '" already exists. Please enter another name.');
        return wrapSheet(addSheet(wb, name, index));
      },
      deleteSheet: (sheet) => {
        const sd = sheet.__data;
        const i = wb.sheets.indexOf(sd);
        if (i < 0) throw new env.realm.Error("Exception: The sheet has been deleted.");
        if (wb.sheets.length === 1) throw new env.realm.Error("Exception: You can't remove all the sheets in a document.");
        journal().touchWorkbookOrder(wb);
        wb.sheets.splice(i, 1);
        journal().deletedSheets.push({ sheet: sd, workbook: wb, index: i });
      },
      moveActiveSheet: () => {},
      toast: (msg) => { if (env.uiSink) env.uiSink.toast(String(msg)); },
      getOwner: () => ({ getEmail: () => env.ownerEmail }),
      getEditors: () => [],
      addEditor: () => SS, addViewer: () => SS,
      flush: () => {},
      toString: () => "Spreadsheet"
    };
    return chainable(SS, "Spreadsheet");
  }

  /* --------------------------- SpreadsheetApp --------------------------- */
  const app = {
    openById: (id) => {
      const wb = store.workbook(String(id));
      if (!wb) throw new env.realm.Error("Exception: Unexpected error while getting the method or property openById on object SpreadsheetApp.");
      return wrapSS(wb);
    },
    openByUrl: (url) => {
      const m = /\/d\/([A-Za-z0-9_-]+)/.exec(String(url));
      return app.openById(m ? m[1] : url);
    },
    getActive: () => {
      if (!env.boundSpreadsheetId) return null;
      const wb = store.workbook(env.boundSpreadsheetId);
      return wb ? wrapSS(wb) : null;
    },
    getActiveSpreadsheet: () => app.getActive(),
    getActiveSheet: () => { const ss = app.getActive(); return ss ? ss.getActiveSheet() : null; },
    getActiveRange: () => null,
    setActiveSpreadsheet: () => {},
    flush: () => {},
    getUi: () => {
      if (!env.uiSink) throw new env.realm.Error("Exception: Cannot call SpreadsheetApp.getUi() from this context.");
      return env.uiSink.ui;
    },
    newDataValidation: () => builder({ __validation: true }),
    newConditionalFormatRule: () => builder({}),
    newTextStyle: () => builder({}),
    newRichTextValue: () => builder({ getText: () => "" }),
    newFilterCriteria: () => builder({}),
    create: (name) => { throw new env.realm.Error("SpreadsheetApp.create is not supported in the Supabase runtime (" + name + ")."); },
    BorderStyle: { DOTTED: "DOTTED", DASHED: "DASHED", SOLID: "SOLID", SOLID_MEDIUM: "SOLID_MEDIUM", SOLID_THICK: "SOLID_THICK", DOUBLE: "DOUBLE" },
    WrapStrategy: { WRAP: "WRAP", OVERFLOW: "OVERFLOW", CLIP: "CLIP" },
    DataValidationCriteria: new Proxy({}, { get: (_, k) => String(k) }),
    BooleanCriteria: new Proxy({}, { get: (_, k) => String(k) }),
    ProtectionType: { RANGE: "RANGE", SHEET: "SHEET" },
    Dimension: { ROWS: "ROWS", COLUMNS: "COLUMNS" },
    Direction: { UP: "UP", DOWN: "DOWN", PREVIOUS: "PREVIOUS", NEXT: "NEXT" },
    CopyPasteType: { PASTE_NORMAL: "PASTE_NORMAL", PASTE_VALUES: "PASTE_VALUES", PASTE_FORMAT: "PASTE_FORMAT" },
    ColorType: { RGB: "RGB" },
    SheetType: { GRID: "GRID" }
  };
  return { app, wrapSS, wrapSheet };
}

/** Builders (validation rules, text styles…): every method chains; build() returns a token. */
function builder(result) {
  const p = new Proxy({}, {
    get(_, prop) {
      if (typeof prop !== "string" || prop === "then" || prop === "toJSON") return undefined;
      if (prop === "build") return () => result;
      if (prop === "copy") return () => p;
      return () => p;
    }
  });
  return p;
}

/**
 * Wrap an API object so that formatting-only methods we don't model
 * (setFontWeight, setBackground, setColumnWidth, autoResizeColumns, …)
 * succeed as no-ops and keep method chaining working.
 */
const NOOP_PREFIXES = /^(set|auto|hide|show|merge|break|apply|remove|unhide|expand|collapse|add|uncheck|check|insertCheckboxes|trim|randomize|shift|group|ungroup|protect|activate|update)/;
function chainable(obj, typeName, forward) {
  const proxy = new Proxy(obj, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (typeof prop !== "string") return undefined;
      if (prop === "then" || prop === "toJSON") return undefined;
      if (NOOP_PREFIXES.test(prop)) {
        return forward ? (...args) => forward(prop, args) : () => proxy;
      }
      return () => { throw new Error("Not implemented in the Supabase runtime: " + typeName + "." + prop + "()"); };
    }
  });
  Object.defineProperty(obj, "__self", { value: proxy, enumerable: false });
  return proxy;
}

module.exports = { createSpreadsheetApp, colToLetters, lettersToCol, parseA1, toStored, isDateLike };
