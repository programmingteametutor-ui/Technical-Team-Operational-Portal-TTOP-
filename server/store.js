"use strict";
/**
 * In-memory workbook store with change journal.
 *
 * Google Sheets is a single shared, synchronous store; the Apps Script code
 * relies on synchronous reads/writes. We keep the whole dataset in memory
 * (loaded from Supabase at boot), let scripts run synchronously against it,
 * and persist every execution's changes to Supabase before answering the
 * request (write-through).
 */

const MAX_CELLS = 10000000; // same limit Google Sheets has per spreadsheet

class Row {
  constructor(v, f, d, x) {
    this.v = v || [];   // values: string | number | boolean | Date | ""
    this.f = f || null; // number formats per cell (string|null)
    this.d = d || null; // display strings captured at import (until cell changes)
    this.x = x || null; // formulas captured at import (not evaluated)
  }
  clone() {
    return new Row(
      this.v.map(c => (c instanceof Date ? new Date(c.getTime()) : c)),
      this.f ? this.f.slice() : null,
      this.d ? this.d.slice() : null,
      this.x ? this.x.slice() : null
    );
  }
  isEmpty() {
    return !this.v.some(c => c !== "" && c !== null && c !== undefined) &&
      !(this.f && this.f.some(Boolean)) && !(this.x && this.x.some(Boolean));
  }
}

class SheetData {
  constructor(o) {
    this.pk = o.pk || null;               // Supabase gs_sheets.id
    this.sheetId = o.sheetId;             // Google numeric sheet id (gid)
    this.name = o.name;
    this.maxRows = o.maxRows || 1000;
    this.maxCols = o.maxCols || 26;
    this.frozenRows = o.frozenRows || 0;
    this.frozenCols = o.frozenCols || 0;
    this.hidden = !!o.hidden;
    this.meta = o.meta || {};
    this.rows = o.rows || [];             // index = row-1
    this.seqs = new Map();                // row index -> save number last seen in the database
    this.sver = o.sver || 1;              // structure version (bumped when the tab is replaced)
    this.workbook = null;
  }
  lastRow() {
    for (let i = this.rows.length - 1; i >= 0; i--) {
      const r = this.rows[i];
      if (r && r.v.some(c => c !== "" && c !== null && c !== undefined)) return i + 1;
    }
    return 0;
  }
  lastCol() {
    let max = 0;
    for (const r of this.rows) {
      if (!r) continue;
      for (let c = r.v.length - 1; c >= max; c--) {
        const v = r.v[c];
        if (v !== "" && v !== null && v !== undefined) { max = c + 1; break; }
      }
    }
    return max;
  }
}

class WorkbookData {
  constructor(o) {
    this.id = o.id;           // spreadsheet id
    this.key = o.key || o.id; // friendly key
    this.title = o.title || "Untitled spreadsheet";
    this.timeZone = o.timeZone || "Asia/Kolkata";
    this.sheets = [];
  }
  nextSheetId() {
    let id;
    do { id = Math.floor(Math.random() * 2000000000) + 1; }
    while (this.sheets.some(s => s.sheetId === id));
    return id;
  }
}

/**
 * Journal of one top-level execution (a portal call, a bridge call nested in
 * it, an editor edit, a menu run or a trigger). Records which rows/sheets
 * changed so they can be persisted, and the original state so the execution
 * can be rolled back when a menu function needs user input and is replayed.
 */
class Journal {
  constructor(store) {
    this.store = store;
    this.rowChanges = new Map();   // SheetData -> Map(rowIndex -> original Row|undefined)
    this.fullSheets = new Map();   // SheetData -> original snapshot (structural change)
    this.metaSheets = new Set();
    this.createdSheets = new Set();
    this.deletedSheets = [];       // {sheet, workbook, index}
    this.props = new Map();        // project -> Map(key -> original value|undefined)
    this.workbookOrder = new Set();
    this.cache = new Map();        // "ns\u0000key" -> {ns, key, orig}
  }
  touchCache(ns, key, orig) {
    const k = ns + "\u0000" + key;
    if (!this.cache.has(k)) this.cache.set(k, { ns, key, orig: orig ? Object.assign({}, orig) : undefined });
  }
  touchRow(sheet, idx) {
    if (this.fullSheets.has(sheet) || this.createdSheets.has(sheet)) return;
    let m = this.rowChanges.get(sheet);
    if (!m) { m = new Map(); this.rowChanges.set(sheet, m); }
    if (!m.has(idx)) m.set(idx, sheet.rows[idx] ? sheet.rows[idx].clone() : undefined);
  }
  touchStructure(sheet) {
    if (this.fullSheets.has(sheet) || this.createdSheets.has(sheet)) return;
    // restore rows changed so far, then snapshot whole sheet
    const snap = {
      rows: sheet.rows.map(r => (r ? r.clone() : r)),
      maxRows: sheet.maxRows, maxCols: sheet.maxCols
    };
    const m = this.rowChanges.get(sheet);
    if (m) for (const [i, orig] of m) snap.rows[i] = orig ? orig.clone() : undefined;
    this.rowChanges.delete(sheet);
    this.fullSheets.set(sheet, snap);
  }
  touchMeta(sheet) {
    if (!this.metaSheets.has(sheet)) {
      this.metaSheets.add(sheet);
      if (!sheet._metaOrig) sheet._metaOrig = {
        name: sheet.name, frozenRows: sheet.frozenRows, frozenCols: sheet.frozenCols,
        hidden: sheet.hidden, maxRows: sheet.maxRows, maxCols: sheet.maxCols
      };
    }
  }
  touchWorkbookOrder(wb) {
    if (!this.workbookOrder.has(wb)) { this.workbookOrder.add(wb); wb._orderOrig = wb.sheets.slice(); }
  }
  touchProp(project, key, orig) {
    let m = this.props.get(project);
    if (!m) { m = new Map(); this.props.set(project, m); }
    if (!m.has(key)) m.set(key, orig);
  }
  isEmpty() {
    return !this.rowChanges.size && !this.fullSheets.size && !this.metaSheets.size &&
      !this.createdSheets.size && !this.deletedSheets.length && !this.props.size && !this.workbookOrder.size && !this.cache.size;
  }

  rollback() {
    for (const [sheet, m] of this.rowChanges) for (const [i, orig] of m) sheet.rows[i] = orig;
    for (const [sheet, snap] of this.fullSheets) {
      sheet.rows = snap.rows; sheet.maxRows = snap.maxRows; sheet.maxCols = snap.maxCols;
    }
    for (const sheet of this.metaSheets) {
      if (sheet._metaOrig) Object.assign(sheet, sheet._metaOrig);
      delete sheet._metaOrig;
    }
    for (const wb of this.workbookOrder) { wb.sheets = wb._orderOrig; delete wb._orderOrig; }
    for (const s of this.createdSheets) {
      const wb = s.workbook; const i = wb.sheets.indexOf(s); if (i >= 0) wb.sheets.splice(i, 1);
    }
    for (const d of this.deletedSheets) {
      if (!d.workbook.sheets.includes(d.sheet)) d.workbook.sheets.splice(d.index, 0, d.sheet);
    }
    for (const [project, m] of this.props) {
      const p = this.store.properties(project);
      for (const [k, orig] of m) { if (orig === undefined) p.delete(k); else p.set(k, orig); }
    }
    const { CACHES } = require("./gas/services");
    for (const c of this.cache.values()) {
      let m = CACHES.get(c.ns); if (!m) { m = new Map(); CACHES.set(c.ns, m); }
      if (c.orig) m.set(c.key, c.orig); else m.delete(c.key);
    }
    this.clear();
  }
  clear() {
    for (const s of this.metaSheets) delete s._metaOrig;
    for (const wb of this.workbookOrder) delete wb._orderOrig;
    this.rowChanges.clear(); this.fullSheets.clear(); this.metaSheets.clear();
    this.createdSheets.clear(); this.deletedSheets = []; this.props.clear(); this.workbookOrder.clear(); this.cache.clear();
  }

  /** Build the persistence change set. */
  changeSet() {
    const sheets = new Map(); // SheetData -> {full, rows:Set}
    const add = (s) => { let e = sheets.get(s); if (!e) { e = { full: false, rows: new Set(), meta: false }; sheets.set(s, e); } return e; };
    // Rows written back unchanged (scripts often rewrite whole ranges) are not saved
    for (const [s, m] of this.rowChanges) {
      const changed = [...m].filter(([i, orig]) => !sameRow(orig, s.rows[i])).map(([i]) => i);
      if (changed.length) { const e = add(s); for (const i of changed) e.rows.add(i); }
    }
    for (const s of this.fullSheets.keys()) add(s).full = true;
    for (const s of this.createdSheets) add(s).full = true;
    for (const s of this.metaSheets) add(s).meta = true;
    for (const wb of this.workbookOrder) for (const s of wb.sheets) add(s).meta = true;
    const deleted = this.deletedSheets.filter(d => !d.workbook.sheets.includes(d.sheet) && !this.createdSheets.has(d.sheet)).map(d => d.sheet);
    for (const s of deleted) sheets.delete(s);
    // drop sheets that are no longer attached (created then deleted)
    for (const s of [...sheets.keys()]) if (!s.workbook.sheets.includes(s)) sheets.delete(s);
    const props = [];
    for (const [project, m] of this.props) {
      const p = this.store.properties(project);
      for (const k of m.keys()) props.push({ project, key: k, value: p.has(k) ? p.get(k) : null });
    }
    const { CACHES } = require("./gas/services");
    const cache = [];
    for (const c of this.cache.values()) {
      const e = (CACHES.get(c.ns) || new Map()).get(c.key);
      cache.push({ project: c.ns, key: c.key, value: e ? e.v : null, expires_ms: e ? e.exp : Date.now() });
    }
    return { sheets, deleted, props, cache };
  }
}

/** Same stored content (values, formats, captured display, formulas)? Empty cells compare equal. */
function sameRow(a, b) {
  const ea = !a || a.isEmpty(), eb = !b || b.isEmpty();
  if (ea || eb) return ea && eb && sameList(a && a.d, b && b.d);
  return sameList(a.v, b.v) && sameList(a.f, b.f) && sameList(a.d, b.d) && sameList(a.x, b.x);
}
function sameList(a, b) {
  const n = Math.max(a ? a.length : 0, b ? b.length : 0);
  for (let i = 0; i < n; i++) {
    const x = a ? a[i] : undefined, y = b ? b[i] : undefined;
    const ex = x === "" || x === null || x === undefined, ey = y === "" || y === null || y === undefined;
    if (ex || ey) { if (ex && ey) continue; return false; }
    if (x instanceof Date || y instanceof Date) { if (!(x instanceof Date && y instanceof Date && x.getTime() === y.getTime())) return false; continue; }
    if (x !== y) return false;
  }
  return true;
}

class Store {
  constructor() {
    this.workbooks = new Map(); // id -> WorkbookData
    this.props = new Map();     // project -> Map
    this.triggers = [];         // {id, project, handler, type, source_id, interval_minutes, meta}
    this.propSeqs = new Map();  // project -> Map(key -> save number last seen)
    this.lastSeq = 0;           // everything saved up to this number is in memory
    this.journal = null;        // active journal (executions are synchronous)
  }
  workbook(id) { return this.workbooks.get(String(id)) || null; }
  addWorkbook(wb) { this.workbooks.set(wb.id, wb); return wb; }
  properties(project) {
    let m = this.props.get(project);
    if (!m) { m = new Map(); this.props.set(project, m); }
    return m;
  }
  begin() {
    if (this.journal) return { journal: this.journal, nested: true };
    this.journal = new Journal(this);
    return { journal: this.journal, nested: false };
  }
  end(j) { if (this.journal === j) this.journal = null; }
}

module.exports = { Store, WorkbookData, SheetData, Row, Journal, MAX_CELLS };
