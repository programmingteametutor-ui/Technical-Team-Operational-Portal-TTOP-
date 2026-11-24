"use strict";
/**
 * Persistence adapters.
 *   SupabaseAdapter – production: tables gs_workbooks / gs_sheets / gs_rows /
 *                     gs_script_properties / gs_triggers (see supabase/migrations).
 *   FileAdapter     – local development / tests: one JSON file per workbook.
 *
 * Row encoding (same in both): { v: [...], f: [...]|null, d: [...]|null, x: [...]|null }
 *   v – cell values; dates are encoded as {"$d": "<ISO timestamp>"}
 *   f – number format per cell ("@", "dd-MMM-yyyy", "₹#,##0", …)
 *   d – display strings captured during import (dropped once a cell changes)
 *   x – formulas captured during import (kept for reference, not evaluated)
 */
const fs = require("fs");
const path = require("path");
const { WorkbookData, SheetData, Row } = require("./store");

/* ------------------------------ encoding ------------------------------ */
function encodeCell(v) {
  if (v instanceof Date) return { $d: v.toISOString() };
  if (v === undefined || v === null) return "";
  return v;
}
function decodeCell(v) {
  if (v && typeof v === "object" && v.$d) return new Date(v.$d);
  if (v === null || v === undefined) return "";
  return v;
}
function trimArr(a, empty) {
  if (!a) return null;
  let n = a.length;
  while (n > 0 && empty(a[n - 1])) n--;
  return n ? a.slice(0, n) : null;
}
function encodeRow(r) {
  if (!r) return null;
  const v = trimArr(r.v.map(encodeCell), x => x === "") || [];
  const f = trimArr(r.f ? Array.from(r.f, x => x || null) : null, x => !x);
  const d = r.d ? trimArr(Array.from(r.d, x => (x === undefined ? null : x)), x => x === null) : null;
  const x = r.x ? trimArr(Array.from(r.x, y => y || null), y => !y) : null;
  if (!v.length && !f && !x) return null;
  return { v, f, d, x };
}
function decodeRow(o) {
  if (!o) return undefined;
  return new Row(
    (o.v || []).map(decodeCell),
    o.f ? o.f.map(x => x || null) : null,
    o.d ? o.d.map(x => (x === null ? undefined : x)) : null,
    o.x ? o.x.map(x => x || undefined) : null
  );
}

/* ------------------------------ FileAdapter ------------------------------ */
class FileAdapter {
  constructor(dir) { this.dir = dir; fs.mkdirSync(dir, { recursive: true }); }
  async load(store, config) {
    for (const f of fs.readdirSync(this.dir).filter(f => f.endsWith(".json") && !f.startsWith("_"))) {
      const o = JSON.parse(fs.readFileSync(path.join(this.dir, f), "utf8"));
      const wb = new WorkbookData({ id: o.id, key: (config.workbooks[o.id] || {}).key, title: o.title, timeZone: o.timeZone });
      for (const s of o.sheets) {
        const sd = new SheetData({ sheetId: s.sheetId, name: s.name, maxRows: s.maxRows, maxCols: s.maxCols, frozenRows: s.frozenRows, frozenCols: s.frozenCols, hidden: s.hidden });
        sd.workbook = wb;
        for (const [k, r] of Object.entries(s.rows || {})) sd.rows[Number(k) - 1] = decodeRow(r);
        wb.sheets.push(sd);
      }
      store.addWorkbook(wb);
    }
    const pf = path.join(this.dir, "_properties.json");
    if (fs.existsSync(pf)) for (const [proj, kv] of Object.entries(JSON.parse(fs.readFileSync(pf, "utf8")))) {
      const m = store.properties(proj); for (const [k, v] of Object.entries(kv)) m.set(k, v);
    }
    const tf = path.join(this.dir, "_triggers.json");
    if (fs.existsSync(tf)) store.triggers = JSON.parse(fs.readFileSync(tf, "utf8"));
    this.store = store;
  }
  async save(changes) {
    const wbs = new Set();
    for (const s of changes.sheets.keys()) wbs.add(s.workbook);
    for (const s of changes.deleted) if (s.workbook) wbs.add(s.workbook);
    for (const wb of wbs) this.writeWorkbook(wb);
    if (changes.props.length) this.writeProps();
  }
  writeWorkbook(wb) {
    const o = { id: wb.id, title: wb.title, timeZone: wb.timeZone, sheets: wb.sheets.map((s, i) => {
      const rows = {};
      s.rows.forEach((r, idx) => { const e = encodeRow(r); if (e) rows[idx + 1] = e; });
      return { name: s.name, sheetId: s.sheetId, index: i, maxRows: s.maxRows, maxCols: s.maxCols, frozenRows: s.frozenRows, frozenCols: s.frozenCols, hidden: s.hidden, rows };
    }) };
    const tmp = path.join(this.dir, wb.id + ".json.tmp");
    fs.writeFileSync(tmp, JSON.stringify(o));
    fs.renameSync(tmp, path.join(this.dir, wb.id + ".json"));
  }
  writeProps() {
    const o = {};
    for (const [p, m] of this.store.props) o[p] = Object.fromEntries(m);
    fs.writeFileSync(path.join(this.dir, "_properties.json"), JSON.stringify(o, null, 1));
  }
  async saveTriggers(triggers) { fs.writeFileSync(path.join(this.dir, "_triggers.json"), JSON.stringify(triggers, null, 1)); }
  async loadTriggers() {}
  async refresh() { return { rows: 0 }; }               // one process: nothing to pick up
  async commit(store, changes) { await this.save(changes); return 0; }
}

/* ------------------------------ SupabaseAdapter ------------------------------ */
class SupabaseAdapter {
  constructor({ url, serviceKey, schema }) {
    if (!url || !serviceKey) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
    this.url = url.replace(/\/$/, "");
    this.key = serviceKey;
    this.schema = schema || "public";
    this.chunk = Number(process.env.SUPABASE_SAVE_CHUNK || 500);
  }
  headers(extra) {
    return Object.assign({
      apikey: this.key, Authorization: "Bearer " + this.key, "Content-Type": "application/json",
      "Accept-Profile": this.schema, "Content-Profile": this.schema
    }, extra || {});
  }
  async req(method, p, body, extra) {
    for (let attempt = 1; ; attempt++) {
      let res;
      try {
        res = await fetch(this.url + "/rest/v1/" + p, { method, headers: this.headers(extra), body: body === undefined ? undefined : JSON.stringify(body) });
      } catch (e) {
        if (attempt < 4) { await sleep(500 * attempt); continue; }
        throw e;
      }
      const text = await res.text();
      if (!res.ok) {
        if (res.status >= 500 && attempt < 4) { await sleep(500 * attempt); continue; }
        throw new Error("Supabase " + method + " " + p.split("?")[0] + " -> " + res.status + ": " + text.slice(0, 500));
      }
      return text ? JSON.parse(text) : null;
    }
  }
  async selectAll(table, query, pageSize) {
    const out = [];
    pageSize = pageSize || 1000;
    for (let from = 0; ; from += pageSize) {
      const page = await this.req("GET", table + "?" + query, undefined, { Range: from + "-" + (from + pageSize - 1), "Range-Unit": "items" });
      out.push(...page);
      if (page.length < pageSize) break;
    }
    return out;
  }
  /**
   * Full load (a new server copy starting). Reads the save counter first, so the
   * first refresh afterwards picks up anything saved while loading.
   */
  async load(store, config) {
    const startSeq = Number(((await this.req("GET", "gs_counter?select=v&id=eq.1"))[0] || {}).v || 0);
    const wbs = await this.selectAll("gs_workbooks", "select=*&order=spreadsheet_id");
    const sheets = await this.selectAll("gs_sheets", "select=*&order=spreadsheet_id,position");
    for (const w of wbs) store.addWorkbook(new WorkbookData({ id: w.spreadsheet_id, key: w.key, title: w.title, timeZone: w.time_zone }));
    const list = [];
    for (const s of sheets) {
      const wb = store.workbook(s.spreadsheet_id);
      if (!wb) continue;
      const sd = new SheetData({ pk: s.id, sheetId: s.sheet_id, name: s.name, maxRows: s.max_rows, maxCols: s.max_cols, frozenRows: s.frozen_rows, frozenCols: s.frozen_cols, hidden: s.hidden, meta: s.meta, sver: s.sver });
      sd.workbook = wb;
      wb.sheets.push(sd);
      list.push(sd);
    }
    // rows: several tabs in parallel, each paged by row number
    let n = 0;
    const loadSheet = async (sd) => {
      for (let after = 0; ;) {
        const page = await this.req("GET", "gs_rows?select=row_num,v,f,d,x,seq&sheet_pk=eq." + sd.pk + "&row_num=gt." + after + "&order=row_num&limit=1000");
        for (const r of page) { sd.rows[r.row_num - 1] = decodeRow(r); sd.seqs.set(r.row_num - 1, Number(r.seq)); }
        n += page.length;
        if (page.length < 1000) return;
        after = page[page.length - 1].row_num;
      }
    };
    const queue = list.slice();
    await Promise.all(Array.from({ length: Number(process.env.SUPABASE_LOAD_PARALLEL || 8) }, async () => { while (queue.length) await loadSheet(queue.shift()); }));
    const props = await this.selectAll("gs_script_properties", "select=project,key,value,seq");
    for (const p of props) {
      if (p.value !== null) store.properties(p.project).set(p.key, p.value);
      seqMap(store, p.project).set(p.key, Number(p.seq));
    }
    const { CACHES } = require("./gas/services");
    for (const c of await this.selectAll("gs_cache", "select=project,key,value,expires_at&expires_at=gt." + encodeURIComponent(new Date().toISOString()))) {
      let m = CACHES.get(c.project); if (!m) { m = new Map(); CACHES.set(c.project, m); }
      m.set(c.key, { v: c.value, exp: new Date(c.expires_at).getTime() });
    }
    await this.loadTriggers(store);
    let exportLog = [];
    try { exportLog = await this.selectAll("gs_export_log", "select=project,web_app_url,script_id,spreadsheet_id"); } catch (e) { /* optional */ }
    store.lastSeq = startSeq;
    this.store = store;
    return { rows: n, sheets: sheets.length, workbooks: wbs.length, exportLog };
  }
  async loadTriggers(store) {
    store.triggers = (await this.selectAll("gs_triggers", "select=*")).map(t => ({ id: t.id, project: t.project, handler: t.handler, type: t.event_type, source_id: t.source_id, meta: t.meta || {} }));
  }

  /** Bring this copy up to date with everything other copies saved (one call). */
  async refresh(store) {
    const c = await this.req("POST", "rpc/gs_changes", { p_seq: store.lastSeq });
    const maxSeq = Number(c.max_seq);
    // tabs: create / update / remove; a replaced tab (new sver) is cleared before its rows are applied
    const byPk = new Map();
    for (const wb of store.workbooks.values()) for (const sd of wb.sheets) if (sd.pk) byPk.set(sd.pk, sd);
    const seen = new Set();
    const cleared = new Set();
    const order = new Map();
    for (const s of c.sheets || []) {
      let wb = store.workbook(s.spreadsheet_id);
      if (!wb) { wb = store.addWorkbook(new WorkbookData({ id: s.spreadsheet_id, title: s.spreadsheet_id })); }
      let sd = byPk.get(Number(s.pk));
      if (!sd) {
        sd = new SheetData({ pk: Number(s.pk), sheetId: s.sheet_id, name: s.name, sver: s.sver });
        sd.workbook = wb; wb.sheets.push(sd); byPk.set(sd.pk, sd);
      } else if (Number(s.sver) !== sd.sver) { sd.rows = []; sd.seqs = new Map(); cleared.add(sd); }
      Object.assign(sd, { sheetId: s.sheet_id, name: s.name, maxRows: s.max_rows, maxCols: s.max_cols, frozenRows: s.frozen_rows, frozenCols: s.frozen_cols, hidden: s.hidden, sver: Number(s.sver) });
      seen.add(sd.pk);
      order.set(sd, s.position);
    }
    if ((c.sheets || []).length) {
      for (const wb of store.workbooks.values()) {
        wb.sheets = wb.sheets.filter(sd => !sd.pk || seen.has(sd.pk));
        wb.sheets.sort((a, b) => (order.get(a) || 0) - (order.get(b) || 0));
      }
    }
    for (const [pk, rowNum, v, f, d, x, seq] of c.rows || []) {
      const sd = byPk.get(Number(pk));
      if (!sd) continue;
      const r = decodeRow({ v, f, d, x });
      sd.rows[rowNum - 1] = r && !r.isEmpty() ? r : undefined;
      sd.seqs.set(rowNum - 1, Number(seq));
    }
    for (const [project, key, value, seq] of c.props || []) {
      if (value === null) store.properties(project).delete(key); else store.properties(project).set(key, value);
      seqMap(store, project).set(key, Number(seq));
    }
    const { CACHES } = require("./gas/services");
    for (const [project, key, value, exp] of c.cache || []) {
      let m = CACHES.get(project); if (!m) { m = new Map(); CACHES.set(project, m); }
      if (value === null) m.delete(key); else m.set(key, { v: value, exp: Number(exp) });
    }
    store.lastSeq = Math.max(store.lastSeq, maxSeq);
    return { rows: (c.rows || []).length, props: (c.props || []).length, cleared: cleared.size };
  }

  /**
   * Save one action's changes atomically. Throws an error with .conflict = true
   * when another copy saved one of the same rows/properties first.
   */
  async commit(store, changes, force) {
    const sheets = [];
    const keyOf = new Map();
    let k = 0;
    for (const [sd, e] of changes.sheets) {
      const key = "s" + (k++);
      keyOf.set(key, { sd, e });
      const position = sd.workbook.sheets.indexOf(sd);
      const item = {
        key, pk: sd.pk, spreadsheet_id: sd.workbook.id, sheet_id: sd.sheetId, name: sd.name, position,
        max_rows: sd.maxRows, max_cols: sd.maxCols, frozen_rows: sd.frozenRows, frozen_cols: sd.frozenCols, hidden: sd.hidden,
        full: !!e.full || !sd.pk, expect_sver: sd.sver, rows: []
      };
      if (item.full) {
        sd.rows.forEach((r, i) => { const enc = encodeRow(r); if (enc) item.rows.push(Object.assign({ row_num: i + 1 }, enc)); });
      } else {
        for (const i of [...e.rows].sort((a, b) => a - b)) {
          const enc = encodeRow(sd.rows[i]) || { v: [], f: null, d: null, x: null };
          const exp = sd.seqs.has(i) ? sd.seqs.get(i) : null;
          item.rows.push(Object.assign({ row_num: i + 1, expect_seq: exp }, enc));
        }
      }
      sheets.push(item);
    }
    const props = changes.props.map(p => ({ project: p.project, key: p.key, value: p.value, expect_seq: seqMap(store, p.project).has(p.key) ? seqMap(store, p.project).get(p.key) : null }));
    const payload = { force: !!force, sheets, deleted: changes.deleted.filter(sd => sd.pk).map(sd => sd.pk), props, cache: lastPerKey(changes.cache || [], c => c.project + "\u0000" + c.key) };
    let out;
    try { out = await this.req("POST", "rpc/gs_commit", { p: payload }); }
    catch (e) {
      if (/GS_CONFLICT/.test(e.message)) { const c = new Error(e.message.replace(/^.*?(GS_CONFLICT[^"]*).*$/s, "$1")); c.conflict = true; throw c; }
      throw e;
    }
    const seq = Number(out.seq);
    for (const s of out.sheets || []) {
      const { sd, e } = keyOf.get(s.key);
      const full = !!e.full || !sd.pk;
      sd.pk = Number(s.pk); sd.sver = Number(s.sver);
      if (full) { sd.seqs = new Map(); sd.rows.forEach((r, i) => { if (encodeRow(r)) sd.seqs.set(i, seq); }); }
      else for (const i of e.rows) sd.seqs.set(i, seq);
    }
    for (const p of changes.props) seqMap(store, p.project).set(p.key, seq);
    return seq;
  }

  /** Older path, still used by tools and tests: save without checks. */
  async save(changes) { return this.commit(this.store, changes, true); }

  async saveTriggers(triggers) {
    await this.req("POST", "rpc/gs_replace_triggers", { p_triggers: triggers.map(t => ({ id: t.id, project: t.project, handler: t.handler, event_type: t.type, source_id: t.source_id, meta: t.meta || {} })) });
  }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
/** Keep the last entry per key (one save may touch the same cache key twice). */
function lastPerKey(list, keyFn) {
  const m = new Map();
  for (const x of list) { const k = keyFn(x); m.delete(k); m.set(k, x); }
  return [...m.values()];
}
function seqMap(store, project) { let m = store.propSeqs.get(project); if (!m) { m = new Map(); store.propSeqs.set(project, m); } return m; }

module.exports = { FileAdapter, SupabaseAdapter, encodeRow, decodeRow, encodeCell, decodeCell };
