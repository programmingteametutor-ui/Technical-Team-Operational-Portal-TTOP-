"use strict";
/** Copying the store to worker threads and merging their changes back. */
const { WorkbookData, SheetData, Row } = require("./store");

const plainRow = (r) => (r ? { v: r.v, f: r.f, d: r.d, x: r.x } : null);
const toRow = (o) => (o ? new Row(o.v, o.f, o.d, o.x) : undefined);

function storeToSnapshot(store) {
  return {
    workbooks: [...store.workbooks.values()].map(wb => ({
      id: wb.id, key: wb.key, title: wb.title, timeZone: wb.timeZone,
      sheets: wb.sheets.map(s => ({
        sheetId: s.sheetId, name: s.name, maxRows: s.maxRows, maxCols: s.maxCols, frozenRows: s.frozenRows,
        frozenCols: s.frozenCols, hidden: s.hidden, rows: s.rows.map(plainRow)
      }))
    })),
    props: [...store.props].map(([p, m]) => [p, [...m]]),
    triggers: store.triggers
  };
}

function snapshotToStore(snap, store) {
  for (const w of snap.workbooks) {
    const wb = new WorkbookData(w);
    for (const s of w.sheets) {
      const sd = new SheetData(Object.assign({}, s, { rows: s.rows.map(toRow) }));
      sd.workbook = wb;
      wb.sheets.push(sd);
    }
    store.addWorkbook(wb);
  }
  for (const [p, entries] of snap.props) store.props.set(p, new Map(entries));
  store.triggers = snap.triggers || [];
}

function changesToTransfer(changes) {
  if (!changes) return null;
  const sheets = [];
  for (const [sd, e] of changes.sheets) {
    const item = {
      wbId: sd.workbook.id, sheetId: sd.sheetId, position: sd.workbook.sheets.indexOf(sd),
      meta: { name: sd.name, maxRows: sd.maxRows, maxCols: sd.maxCols, frozenRows: sd.frozenRows, frozenCols: sd.frozenCols, hidden: sd.hidden },
      full: e.full
    };
    if (e.full) item.rows = sd.rows.map(plainRow);
    else item.rowChanges = [...e.rows].map(i => [i, plainRow(sd.rows[i])]);
    sheets.push(item);
  }
  return {
    sheets,
    deleted: changes.deleted.map(sd => ({ wbId: sd.workbook ? sd.workbook.id : null, sheetId: sd.sheetId })),
    props: changes.props
  };
}

/** Apply a worker's changes to the main store inside the current journal. */
function applyTransfer(store, t) {
  const j = store.journal;
  for (const d of t.deleted) {
    const wb = store.workbook(d.wbId); if (!wb) continue;
    const i = wb.sheets.findIndex(s => s.sheetId === d.sheetId);
    if (i < 0) continue;
    j.touchWorkbookOrder(wb);
    j.deletedSheets.push({ sheet: wb.sheets[i], workbook: wb, index: i });
    wb.sheets.splice(i, 1);
  }
  for (const s of t.sheets) {
    const wb = store.workbook(s.wbId); if (!wb) continue;
    let sd = wb.sheets.find(x => x.sheetId === s.sheetId);
    if (!sd) {
      sd = new SheetData({ sheetId: s.sheetId, name: s.meta.name });
      sd.workbook = wb;
      j.touchWorkbookOrder(wb);
      wb.sheets.splice(Math.min(s.position, wb.sheets.length), 0, sd);
      j.createdSheets.add(sd);
    }
    j.touchMeta(sd);
    Object.assign(sd, s.meta);
    if (s.full) { j.touchStructure(sd); sd.rows = s.rows.map(toRow); }
    else for (const [i, r] of s.rowChanges) { j.touchRow(sd, i); sd.rows[i] = toRow(r); }
  }
  for (const p of t.props) {
    const m = store.properties(p.project);
    j.touchProp(p.project, p.key, m.get(p.key));
    if (p.value === null) m.delete(p.key); else m.set(p.key, p.value);
  }
}

module.exports = { storeToSnapshot, snapshotToStore, changesToTransfer, applyTransfer };
