"use strict";
/**
 * Super admin dashboard: figures from both portals, sign-up requests,
 * CSV import into Dhruva tabs, and Dhruva first-time setup.
 */
const crypto = require("crypto");
const { SheetData } = require("../store");
const csv = require("./csvimport");

const WB = {
  puneCalls: "1BD_XIhQW6d4w4dnrcM17wYgv6hZqdx7mTsAIYgUOC7M",   // Call Tracker
  hydCalls: "1pDKLkZc4mCU7pcTWG-aYgovj7DJjF7C77292JyQ3zwU",    // HYD Incentive Tracker
  punePrivate: "1Q5pRPoLsSjfxuRfEUZW2zZqrURYPzzbbPO6_8r9CLCk", // Incentive Backend - Private
  hydPrivate: "1fl1mcQTmlYhTKgb2qmw-nWHSEFmMVxMLOUiXY2JsB0w",  // HYD Incentive Backend - Private
  control: "1FD5pShmQaqszrcqi1UHXGlsJQBuKPnxJXKFvj7iwjus",     // Interview Portal Control
  team: "1UudfZfeBBkEwBQeWUwx77R4gl26wYZ1rKKZWCM_SHq4"         // Incentive tracker
};
const MAX_IMPORT_ROWS = 200000;

function createAdmin({ runtime, store, rest, log }) {
  /* ------------------------------ helpers ------------------------------ */
  function table(wbId, tab) {
    const wb = store.workbook(wbId);
    const sd = wb && wb.sheets.find(s => s.name === tab);
    if (!sd || !sd.rows[0]) return null;
    const h = new Map();
    sd.rows[0].v.forEach((c, i) => { const k = String(c || "").trim(); if (k && !h.has(k)) h.set(k, i); });
    const rows = [];
    for (let i = 1; i < sd.rows.length; i++) { const r = sd.rows[i]; if (r && !r.isEmpty()) rows.push(r.v); }
    return { col: (name) => (h.has(name) ? h.get(name) : -1), rows };
  }
  const dayKey = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  const asDate = (v) => (v instanceof Date ? v : (typeof v === "string" && v && !isNaN(Date.parse(v)) ? new Date(v) : null));
  const num = (v) => (typeof v === "number" ? v : Number(String(v || "").replace(/[^\d.-]/g, "")) || 0);

  function teamCalls(wbId, today) {
    const t = table(wbId, "Portal Call Status");
    const out = { today: [], byStatus: {}, recorded: 0 };
    if (!t) return out;
    const cU = t.col("Updated At"), cK = t.col("Date Key"), cT = t.col("Interview Text"), cH = t.col("Assigned Handler"), cS = t.col("Call Status");
    for (const r of t.rows) {
      const d = asDate(r[cU]) || asDate(r[cK]);
      if (!d || dayKey(d) !== today) continue;
      const st = String(r[cS] || "Open");
      out.byStatus[st] = (out.byStatus[st] || 0) + 1;
      out.today.push({ text: String(r[cT] || ""), handler: String(r[cH] || ""), status: st });
    }
    out.recorded = out.today.length;
    out.today = out.today.slice(0, 60);
    return out;
  }
  function pending(wbId, tabs) {
    const out = {};
    for (const [label, tab] of tabs) {
      const t = table(wbId, tab);
      if (!t) continue;
      const c = t.col("Request Status");
      out[label] = c < 0 ? 0 : t.rows.filter(r => String(r[c] || "").trim().toLowerCase() === "pending").length;
    }
    return out;
  }
  function incentives(wbId, now) {
    const t = table(wbId, "Incentive Tracker");
    const out = { monthAmount: 0, monthCount: 0, pendingAmount: 0, pendingCount: 0, byHandler: [] };
    if (!t) return out;
    const cD = t.col("Promotion Date"), cA = t.col("Amount"), cS = t.col("Status"), cH = t.col("Handler"), cT = t.col("Incentive Type");
    const hm = new Map();
    for (const r of t.rows) {
      const amt = num(r[cA]);
      if (String(r[cS] || "").trim().toLowerCase() === "pending") { out.pendingAmount += amt; out.pendingCount++; }
      const d = asDate(r[cD]);
      if (d && d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()) {
        out.monthAmount += amt; out.monthCount++;
        const h = String(r[cH] || "—");
        const e = hm.get(h) || { handler: h, amount: 0, promotions: 0, selections: 0 };
        e.amount += amt; if (/selection/i.test(String(r[cT]))) e.selections++; else e.promotions++;
        hm.set(h, e);
      }
    }
    out.byHandler = [...hm.values()].sort((a, b) => b.amount - a.amount).slice(0, 8);
    return out;
  }
  function count(wbId, tab) { const t = table(wbId, tab); return t ? t.rows.length : 0; }
  function actionLog(wbId, tab, team) {
    const t = table(wbId, tab);
    if (!t) return [];
    const c = (n) => t.col(n);
    return t.rows.map(r => ({ team, at: asDate(r[c("Timestamp")]), who: String(r[c("Actor Email")] || ""), action: String(r[c("Action")] || ""), detail: String(r[c("New Value")] || r[c("Target ID")] || "") }))
      .filter(x => x.at);
  }

  /* ------------------------------ dashboard ------------------------------ */
  async function overview() {
    const now = new Date();
    const today = dayKey(now);
    const dhruva = {
      pune: {
        calls: teamCalls(WB.puneCalls, today),
        pending: pending(WB.punePrivate, [["Call outcomes", "Call Outcome Requests"], ["Reassignments", "Call Reassignment Requests"], ["Outcome corrections", "Call Outcome Correction Requests"], ["Selections", "Selection Requests"]]),
        incentives: incentives(WB.punePrivate, now),
        recoveryExceptions: count(WB.punePrivate, "Recovery Exceptions"),
        recoverySuggestions: count(WB.punePrivate, "Promotion Recovery")
      },
      hyd: {
        calls: teamCalls(WB.hydCalls, today),
        pending: pending(WB.hydPrivate, [["Call outcomes", "HYD Call Outcome Requests"], ["Reassignments", "HYD Call Reassignment Requests"], ["Outcome corrections", "HYD Call Outcome Correction Requests"], ["Selections", "HYD Selection Requests"]]),
        incentives: incentives(WB.hydPrivate, now),
        recoveryExceptions: count(WB.hydPrivate, "Recovery Exceptions"),
        recoverySuggestions: count(WB.hydPrivate, "Promotion Recovery")
      },
      masters: { candidates: count(WB.control, "Candidate Master"), clients: count(WB.control, "Client Master") },
      activity: [...actionLog(WB.punePrivate, "Portal Action Log", "Pune"), ...actionLog(WB.hydPrivate, "HYD Portal Action Log", "HYD")]
        .sort((a, b) => b.at - a.at).slice(0, 12),
      data: await dataStatus()
    };
    let ttop = null, ttopError = null;
    try { ttop = await rest("POST", "rpc/app_dashboard_ttop", { p_today: today }); }
    catch (e) { ttopError = e.message; }
    let users = null;
    try {
      const all = await rest("GET", "app_users?select=email,role,portals,active,last_login_at");
      const since = Date.now() - 7 * 86400000;
      users = {
        total: all.filter(u => u.active).length,
        superAdmins: all.filter(u => u.active && u.role === "super_admin").length,
        admins: all.filter(u => u.active && u.role === "admin").length,
        users: all.filter(u => u.active && u.role === "user").length,
        activeWeek: all.filter(u => u.last_login_at && Date.parse(u.last_login_at) > since).length,
        pending: (await pendingSignups()).length
      };
    } catch (e) { users = { error: e.message }; }
    return { today, generatedAt: now.toISOString(), ttop, ttopError, dhruva, users };
  }

  async function dataStatus() {
    let last = [];
    try { last = await rest("GET", "app_imports?select=spreadsheet_id,tab,at,rows_in,by_email&order=at.desc&limit=500"); } catch (e) { /* table missing before migration 6 */ }
    const lastBy = new Map();
    for (const x of last) { const k = x.spreadsheet_id + "\u0000" + x.tab; if (!lastBy.has(k)) lastBy.set(k, x); }
    const prof = csv.profiles().workbooks;
    return [...store.workbooks.values()].map(wb => {
      const expected = Object.keys((prof[wb.id] && prof[wb.id].tabs) || {});
      const tabs = wb.sheets.map(s => {
        const li = lastBy.get(wb.id + "\u0000" + s.name);
        return { name: s.name, rows: s.lastRow(), imported: li ? li.at : null, by: li ? li.by_email : null };
      });
      for (const n of expected) if (!wb.sheets.some(s => s.name === n)) tabs.push({ name: n, rows: 0, missing: true });
      // a tab that is empty in Google too is not reported as missing data
      const hadData = (n) => { const t = prof[wb.id] && prof[wb.id].tabs[n]; return !t || t.cols.some(Boolean); };
      tabs.forEach(t => { t.expectEmpty = !t.rows && !hadData(t.name); });
      return { id: wb.id, title: wb.title, tabs, rows: tabs.reduce((a, t) => a + t.rows, 0), empty: tabs.filter(t => !t.rows && !t.expectEmpty).length };
    });
  }

  /* ------------------------------ sign-ups ------------------------------ */
  async function pendingSignups() {
    try { return (await rest("POST", "rpc/app_pending_signups", {})) || []; }
    catch (e) { return []; }
  }

  /* ------------------------------ CSV import ------------------------------ */
  function importTargets() {
    const prof = csv.profiles().workbooks;
    return [...store.workbooks.values()].map(wb => ({
      id: wb.id, title: wb.title,
      tabs: [...new Set([...wb.sheets.map(s => s.name), ...Object.keys((prof[wb.id] && prof[wb.id].tabs) || {})])]
        .map(name => { const sd = wb.sheets.find(s => s.name === name); return { name, rows: sd ? sd.lastRow() : 0, header: sd && sd.rows[0] ? sd.rows[0].d || sd.rows[0].v.map(String) : null, profiled: !!(prof[wb.id] && prof[wb.id].tabs[name]) }; })
    }));
  }

  async function importChunk(b) {
    const id = String(b.importId || "");
    if (!/^[\w-]{8,64}$/.test(id)) throw httpErr(400, "Bad import id");
    if (!Array.isArray(b.rows)) throw httpErr(400, "rows missing");
    await rest("POST", "app_import_chunks?on_conflict=import_id,n", [{ import_id: id, n: Number(b.n) || 0, rows: b.rows }], { Prefer: "resolution=merge-duplicates,return=minimal" });
    return { ok: true };
  }

  /**
   * Replace a Dhruva tab with the CSV rows (row 1 = header). The rows come
   * inline (small files) or from earlier chunks.
   */
  async function importApply(b, me) {
    const wb = store.workbook(b.spreadsheetId);
    if (!wb) throw httpErr(400, "Unknown spreadsheet");
    const tab = String(b.tab || "").trim();
    if (!tab || tab.length > 100 || /[\[\]*?:\\/]/.test(tab)) throw httpErr(400, "Bad tab name");
    let rows = Array.isArray(b.rows) ? b.rows : null;
    if (!rows) {
      const id = String(b.importId || "");
      const parts = await rest("GET", "app_import_chunks?select=n,rows&import_id=eq." + encodeURIComponent(id) + "&order=n");
      if (parts.length !== Number(b.chunks)) throw httpErr(400, "Upload incomplete (" + parts.length + " of " + b.chunks + " parts arrived). Please try this file again.");
      rows = [].concat(...parts.map(p => p.rows));
    }
    if (rows.length > MAX_IMPORT_ROWS) throw httpErr(400, "Too many rows");
    if (b.totalRows !== undefined && rows.length !== Number(b.totalRows)) throw httpErr(400, "Row count mismatch - please upload the file again");
    rows = rows.map(r => (Array.isArray(r) ? r.map(x => (x === null || x === undefined ? "" : String(x))) : []));
    const conv = csv.convertRows(wb.id, tab, rows);
    const existing = wb.sheets.find(s => s.name === tab);
    const before = existing ? existing.lastRow() : 0;

    const r = await runtime.run("portal", null, null, {
      activeUserEmail: me.email,
      run: () => {
        const j = store.journal;
        let sd = wb.sheets.find(s => s.name === tab);
        if (!sd) {
          const p = conv.profile;
          const sheetId = p && p.sheetId && !wb.sheets.some(s => s.sheetId === p.sheetId) ? p.sheetId : wb.nextSheetId();
          sd = new SheetData({ sheetId, name: tab, maxRows: 1000, maxCols: 26, frozenRows: p ? p.frozenRows : 0 });
          sd.workbook = wb;
          j.touchWorkbookOrder(wb);
          // place it where it sits in Google (by the profiled tab order)
          const prof = csv.profiles().workbooks[wb.id];
          const order = prof ? Object.entries(prof.tabs).sort((a, b) => a[1].index - b[1].index).map(x => x[0]) : [];
          const want = order.indexOf(tab);
          let at = wb.sheets.length;
          if (want >= 0) { at = wb.sheets.findIndex(s => { const k = order.indexOf(s.name); return k > want; }); if (at < 0) at = wb.sheets.length; }
          wb.sheets.splice(at, 0, sd);
          j.createdSheets.add(sd);
        } else {
          j.touchStructure(sd);
          j.touchMeta(sd);
        }
        sd.rows = conv.rows;
        sd.maxRows = Math.max(sd.maxRows, conv.rows.length + 1, conv.profile ? 0 : 1000);
        sd.maxCols = Math.max(sd.maxCols, conv.maxCols, conv.profile ? conv.profile.maxCols || 0 : 0);
        return null;
      }
    });
    try { await r.persisted; } catch (e) { /* reported below */ }
    if (!r.ok) throw httpErr(500, (r.error && r.error.message) || "Import failed");
    const rec = { by_email: me.email, file_name: String(b.fileName || "").slice(0, 200), spreadsheet_id: wb.id, tab, rows_in: conv.rows.filter(Boolean).length, rows_before: before, dates: conv.stats.dates, numbers: conv.stats.numbers, note: conv.stats.unprofiled ? "new tab layout: values read as typed text" : null };
    await rest("POST", "app_imports", [rec], { Prefer: "return=minimal" }).catch(e => log.warn("[import] log failed: " + e.message));
    if (b.importId) await rest("DELETE", "app_import_chunks?import_id=eq." + encodeURIComponent(String(b.importId))).catch(() => {});
    return { ok: true, workbook: wb.title, tab, rows: rec.rows_in, before, dates: rec.dates, numbers: rec.numbers, unprofiled: conv.stats.unprofiled, created: !existing };
  }

  /* ------------------------------ Dhruva setup ------------------------------ */
  const WB_PROPS = [
    ["portal", "PIM_CONTROL_WORKBOOK_ID", WB.control],
    ["portal", "PORTAL_TEAM_HYD_OPERATIONS_ID", WB.hydCalls],
    ["portal", "PORTAL_TEAM_HYD_PRIVATE_ID", WB.hydPrivate],
    ["portal", "CALL_SCHEDULER_BRIDGE_URL", "internal://pune-call-tracker"],
    ["portal", "INCENTIVE_BRIDGE_URL", "internal://pune-private-backend"],
    ["portal", "PORTAL_TEAM_HYD_SCHEDULER_BRIDGE_URL", "internal://hyd-call-tracker"],
    ["portal", "PORTAL_TEAM_HYD_INCENTIVE_BRIDGE_URL", "internal://hyd-private-backend"],
    ["pune-private-backend", "PROMOTION_IDENTITY_CONTROL_WORKBOOK_ID", WB.control],
    ["hyd-private-backend", "PROMOTION_IDENTITY_CONTROL_WORKBOOK_ID", WB.control],
    ["hyd-private-backend", "HYD_OPERATIONS_SPREADSHEET_ID", WB.hydCalls],
    ["hyd-private-backend", "HYD_PRIVATE_BACKEND_ID", WB.hydPrivate],
    ["hyd-call-tracker", "CENTRAL_ADMIN_SPREADSHEET_ID", WB.punePrivate],
    ["hyd-call-tracker", "TEAM_OPERATIONS_SPREADSHEET_ID", WB.hydCalls]
  ];
  // each pair must hold the same secret on both sides of a bridge
  const SECRET_PAIRS = [
    [["portal", "CALL_SCHEDULER_BRIDGE_SECRET"], ["pune-call-tracker", "PORTAL_SCHEDULER_BRIDGE_SECRET"]],
    [["portal", "INCENTIVE_BRIDGE_SECRET"], ["pune-private-backend", "PORTAL_INCENTIVE_BRIDGE_SECRET"]],
    [["portal", "PORTAL_TEAM_HYD_SCHEDULER_BRIDGE_SECRET"], ["hyd-call-tracker", "PORTAL_SCHEDULER_BRIDGE_SECRET"]],
    [["portal", "PORTAL_TEAM_HYD_INCENTIVE_BRIDGE_SECRET"], ["hyd-private-backend", "PORTAL_INCENTIVE_BRIDGE_SECRET"]],
    [["pune-incentives", "PORTAL_INCENTIVE_BRIDGE_SECRET"]]
  ];
  const EDIT_TRIGGERS = [["pune-private-backend", "setupSharedTeamSelectionTrigger", "selectionDateSharedEdit"], ["hyd-private-backend", "setupSharedTeamSelectionTrigger", "selectionDateSharedEdit"]];
  const prop = (p, k) => { const m = store.props.get(p); return m && m.has(k) ? m.get(k) : null; };
  const isSecret = (k) => /SECRET/.test(k);

  function setupStatus() {
    const checks = [];
    for (const [p, k, v] of WB_PROPS) { const cur = prop(p, k); checks.push({ project: p, key: k, ok: !!cur, value: cur || "", recommended: v }); }
    for (const pair of SECRET_PAIRS) {
      const vals = pair.map(([p, k]) => prop(p, k));
      const ok = vals.every(Boolean) && vals.every(v => v === vals[0]);
      for (const [p, k] of pair) checks.push({ project: p, key: k, ok, secret: true, value: prop(p, k) ? "set" : "", note: ok ? "" : pair.length > 1 ? "must match " + pair.filter(x => x[1] !== k || x[0] !== p).map(x => x[0] + " " + x[1]).join(", ") : "" });
    }
    const triggers = EDIT_TRIGGERS.map(([p, , h]) => ({ project: p, handler: h, ok: store.triggers.some(t => t.project === p && t.handler === h) }));
    return { checks, triggers, ready: checks.every(c => c.ok) && triggers.every(t => t.ok) };
  }

  async function runSetup(me) {
    const r = await runtime.run("portal", null, null, {
      activeUserEmail: me.email,
      run: () => {
        const j = store.journal;
        const set = (p, k, v) => { const m = store.properties(p); j.touchProp(p, k, m.has(k) ? m.get(k) : undefined); m.set(k, v); };
        for (const [p, k, v] of WB_PROPS) if (!prop(p, k)) set(p, k, v);
        for (const pair of SECRET_PAIRS) {
          const have = pair.map(([p, k]) => prop(p, k)).find(Boolean);
          const vals = pair.map(([p, k]) => prop(p, k));
          if (vals.every(Boolean) && vals.every(v => v === vals[0])) continue;
          const secret = have || crypto.randomBytes(24).toString("base64url");
          for (const [p, k] of pair) if (prop(p, k) !== secret) set(p, k, secret);
        }
        return null;
      }
    });
    try { await r.persisted; } catch (e) { /* reported below */ }
    if (!r.ok) throw httpErr(500, (r.error && r.error.message) || "Setup failed");
    const ran = [];
    for (const [p, fn, h] of EDIT_TRIGGERS) {
      if (store.triggers.some(t => t.project === p && t.handler === h)) continue;
      const t = await runtime.run(p, fn, "[]", { activeUserEmail: me.email });
      try { await t.persisted; } catch (e) { /* logged */ }
      ran.push({ project: p, fn, ok: t.ok, error: t.ok ? undefined : String(t.error && t.error.message) });
    }
    if (runtime.onTriggersChanged) await Promise.resolve(runtime.onTriggersChanged());
    return Object.assign({ ok: true, ran }, setupStatus());
  }

  async function setProperty(b, me) {
    const p = String(b.project || ""), k = String(b.key || "");
    if (!runtime.projects.has(p)) throw httpErr(400, "Unknown project");
    if (!/^[A-Za-z0-9_.-]{1,200}$/.test(k)) throw httpErr(400, "Bad key");
    const v = b.value === null || b.value === undefined ? null : String(b.value);
    const r = await runtime.run(p, null, null, {
      activeUserEmail: me.email,
      run: () => { const m = store.properties(p); store.journal.touchProp(p, k, m.has(k) ? m.get(k) : undefined); if (v === null) m.delete(k); else m.set(k, v); return null; }
    });
    try { await r.persisted; } catch (e) { /* reported */ }
    if (!r.ok) throw httpErr(500, (r.error && r.error.message) || "Save failed");
    return { ok: true };
  }
  function listProperties() {
    const out = [];
    for (const p of runtime.projects.keys()) {
      const m = store.props.get(p) || new Map();
      for (const [k, v] of m) {
        if (/^PORTAL_(CURRENT_ROLE|TEAM_VIEW|SESSION|INCENTIVE_SCAN_JOB)_|^PIB_|SESSION_/.test(k)) continue; // per-session/working entries
        out.push({ project: p, key: k, value: isSecret(k) ? "••••••" : String(v).slice(0, 300), secret: isSecret(k) });
      }
    }
    return out.sort((a, b) => (a.project + a.key).localeCompare(b.project + b.key));
  }

  return { overview, pendingSignups, importTargets, importChunk, importApply, setupStatus, runSetup, setProperty, listProperties, dataStatus };
}

function httpErr(status, msg) { const e = new Error(msg); e.status = status; return e; }

module.exports = { createAdmin };
