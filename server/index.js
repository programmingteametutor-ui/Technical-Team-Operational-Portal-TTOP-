"use strict";
process.env.TZ = process.env.TZ || "Asia/Kolkata";

/**
 * Dhruva Team Portal server.
 *
 *   GET  /                      the portal (same "Working Portal.html", unchanged)
 *   POST /                      portal doPost (Coverage Desk export endpoint)
 *   POST /api/run               google.script.run calls from the portal page
 *   GET|POST /exec/<project>    web-app endpoint of any Apps Script project
 *   GET  /sheets                sheet editor (replaces editing the Google Sheets directly)
 *   /api/sheets/*               sheet editor API (portal login, admin roles)
 *   GET  /healthz               health check
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { Store } = require("./store");
const { Runtime } = require("./runtime");
const { FileAdapter, SupabaseAdapter } = require("./persistence");
const { makeUiSink } = require("./ui");
const { createSpreadsheetApp } = require("./gas/spreadsheet");

const ROOT = path.resolve(__dirname, "..");
loadDotEnv(path.join(ROOT, ".env"));

const PORT = Number(process.env.PORT || 8080);
const PUBLIC_URL = (process.env.PUBLIC_URL || "http://localhost:" + PORT).replace(/\/$/, "");
const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, "config", "projects.json"), "utf8"));
const EDITOR_ROLES = String(process.env.SHEET_EDITOR_ROLES || "SUPER_ADMIN,ADMIN").toUpperCase().split(",").map(s => s.trim()).filter(Boolean);
const EDITOR_EMAILS = String(process.env.SHEET_EDITOR_EMAILS || "").toLowerCase().split(",").map(s => s.trim()).filter(Boolean);
const MAX_BODY = 50 * 1024 * 1024;
// Portal functions that run on a worker thread so a long operation does not
// freeze the portal for other users (Google ran executions in parallel).
const LONG_RUNNING = new Set(CONFIG.longRunningFunctions || []);

const log = console;
const store = new Store();
const adapter = process.env.SUPABASE_URL
  ? new SupabaseAdapter({ url: process.env.SUPABASE_URL, serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY, schema: process.env.SUPABASE_SCHEMA })
  : process.env.VERCEL ? null : new FileAdapter(path.resolve(ROOT, process.env.DATA_DIR || "data"));

const runtime = new Runtime({
  store, config: CONFIG, appsScriptDir: path.join(ROOT, "portals", "dhruva"),
  publicUrl: PUBLIC_URL, ownerEmail: process.env.OWNER_EMAIL || "", timeZone: CONFIG.timeZone,
  adapter,
  mailer: sendMail, logger: log
});
runtime.onTriggersChanged = () => { adapter.saveTriggers(store.triggers).catch(e => log.error("[triggers] save failed:", e.message)); };

/* ------------------------------------------------------------------ */
/* Portal page                                                         */
/* ------------------------------------------------------------------ */
const PORTAL = "portal";
let portalAllowList = null; // functions the portal page may call (those referenced in its HTML)

function computeAllowList() {
  const proj = runtime.projects.get(PORTAL);
  const html = Object.values(proj.htmlFiles).join("\n");
  const c = withJournal(() => runtime.createContext(PORTAL, {}));
  const names = vm.runInContext("Object.keys(globalThis).filter(function(k){ return typeof globalThis[k] === 'function'; })", c.ctx);
  return new Set(names.filter(n => !/_$/.test(n) && new RegExp("\\b" + n + "\\s*\\(").test(html)));
}
function withJournal(fn) {
  const { journal, nested } = store.begin();
  try { return fn(); } finally { if (!nested) { journal.rollback(); store.end(journal); } }
}

async function servePortal(req, res) {
  const r = await runtime.run(PORTAL, "doGet", JSON.stringify([requestEvent(req)]), {
    transform: (out) => (out && out.__out ? Object.assign({}, out.__out) : out && typeof out.getContent === "function" ? { content: out.getContent() } : out)
  });
  await r.persisted.catch(() => {});
  if (!r.ok) return sendHtml(res, 500, "<h1>Portal error</h1><pre>" + esc(r.error && r.error.message) + "</pre>");
  sendHtml(res, 200, buildPage(r.value || {}));
}
function buildPage(out) {
  let html = String(out.content || "");
  const head = [
    '<script src="/gas-client.js"></script>',
    out.title ? "<title>" + esc(out.title) + "</title>" : "",
    ...(out.meta || []).map(([n, c]) => '<meta name="' + esc(n) + '" content="' + esc(c) + '">'),
    out.favicon ? '<link rel="icon" href="' + esc(out.favicon) + '">' : ""
  ].join("\n");
  if (/<head[^>]*>/i.test(html)) html = html.replace(/<head[^>]*>/i, m => m + "\n" + head);
  else html = head + html;
  return html;
}

const GAS_CLIENT = fs.readFileSync(path.join(__dirname, "gas-client.js"), "utf8");

/* ------------------------------------------------------------------ */
/* google.script.run                                                   */
/* ------------------------------------------------------------------ */
async function apiRun(req, res) {
  const body = await readJson(req);
  const fn = String(body.fn || "");
  if (!/^[A-Za-z_$][\w$]*$/.test(fn) || /_$/.test(fn) || (process.env.GAS_ALLOW_ALL_PUBLIC !== "1" && !portalAllowList.has(fn))) {
    return sendJson(res, 200, { ok: false, error: { name: "ScriptError", message: "Script function not found: " + fn } });
  }
  const args = Array.isArray(body.args) ? body.args : [];
  const r = LONG_RUNNING.has(fn)
    ? await runtime.executeInWorker(PORTAL, fn, JSON.stringify(args), { serialize: true })
    : await runtime.run(PORTAL, fn, JSON.stringify(args), { transform: serializeForClient });
  if (LONG_RUNNING.has(fn) && r.ok) r.value = serializeForClient(r.value);
  if (r.timing) {
    const t = r.timing;
    res.setHeader("Server-Timing", [
      "queue;dur=" + t.queue, "refresh;dur=" + t.refresh + ';desc="' + t.refreshRows + ' rows"', "run;dur=" + t.run,
      "save;dur=" + t.save + ';desc="' + t.saveRows + ' rows"', "after;dur=" + t.after, "attempts;desc=" + t.attempts,
      // startup of this server copy; bootwait > 0 means this request waited for it
      "bootwait;dur=" + (req.bootWait || 0),
      "boot;dur=" + bootInfo.ms + ';desc="' + bootInfo.rows + " rows, " + bootInfo.tabs + " tabs, " +
        Object.entries(bootInfo.steps).map(([k, v]) => k + " " + v).join(" / ") + '"'
    ].join(", "));
    const total = t.queue + t.refresh + t.run + t.save + t.after;
    if (total > 3000) log.warn("[slow] " + fn + " " + total + " ms: queue " + t.queue + ", refresh " + t.refresh + " (" + t.refreshRows + " rows), run " + t.run + ", save " + t.save + " (" + t.saveRows + " rows), after " + t.after + ", attempts " + t.attempts);
  }
  try { await r.persisted; }
  catch (e) { return sendJson(res, 200, { ok: false, error: { name: "Error", message: "Saving to the database failed. Please try again. (" + e.message + ")" } }); }
  if (!r.ok) {
    if (process.env.DEBUG_GAS_ERRORS === "1" || !(r.error && /^[A-Z0-9_]+(\|.*)?$/.test(String(r.error.message)))) log.warn("[portal] " + fn + " threw: " + ((r.error && r.error.stack) || r.error));
    return sendJson(res, 200, { ok: false, error: { name: (r.error && r.error.name) || "Error", message: errorMessage(r.error) } });
  }
  sendJson(res, 200, r.value === undefined ? { ok: true, undef: true } : { ok: true, value: r.value });
}

/**
 * google.script.run only transports primitives, plain objects and arrays.
 * As in Apps Script, a return value that contains a Date arrives as null.
 */
function serializeForClient(value) {
  if (value === undefined) return undefined;
  let hasDate = false;
  const json = JSON.stringify(value, function (k, v) {
    if (this[k] && Object.prototype.toString.call(this[k]) === "[object Date]") hasDate = true;
    return v;
  });
  if (hasDate) { log.warn("[portal] function returned a Date; the client receives null (Apps Script behaviour)"); return null; }
  return json === undefined ? null : JSON.parse(json);
}
function errorMessage(e) {
  if (!e) return "Unknown error";
  return String(e.message !== undefined ? e.message : e);
}

/* ------------------------------------------------------------------ */
/* Web-app endpoints (doGet/doPost) for every project                  */
/* ------------------------------------------------------------------ */
async function serveExec(project, req, res) {
  const body = req.method === "POST" ? await readBody(req) : "";
  const url = PUBLIC_URL + "/exec/" + project + (req.url.includes("?") ? "?" + req.url.split("?")[1] : "");
  let result;
  const r = await runtime.run(project, null, null, {
    run: (c) => {
      const env = c.env;
      result = runtime.dispatchUrl(url, { method: req.method.toLowerCase(), payload: body, contentType: req.headers["content-type"] }, env);
      return null;
    }
  });
  await r.persisted.catch(() => {});
  if (!result) return sendJson(res, 404, { ok: false, error: "NOT_FOUND" });
  res.writeHead(result.code, { "Content-Type": (result.headers["Content-Type"] || "text/plain") + "; charset=utf-8" });
  res.end(result.text);
}

/* ------------------------------------------------------------------ */
/* Sheet editor API                                                    */
/* ------------------------------------------------------------------ */
async function editorAuth(req) {
  const token = String(req.headers["x-portal-token"] || "");
  if (!token) return null;
  const r = await runtime.run(PORTAL, "PA_validateSession_", JSON.stringify([token]), { transform: v => JSON.parse(JSON.stringify(v || {})) });
  await r.persisted.catch(() => {});
  const a = r.ok ? r.value : null;
  if (!a || !a.ok) return null;
  const u = a.user || {}, ac = a.accessContext || {};
  const roles = new Set([ac.realRole, ac.currentRole, ac.role, u.accessRole, u.role, ...(u.roles || []), ...(ac.roles || [])].filter(Boolean).map(s => String(s).toUpperCase()));
  const email = String(u.email || ac.realEmail || "").toLowerCase();
  const allowed = EDITOR_EMAILS.includes(email) || [...roles].some(r => EDITOR_ROLES.includes(r));
  return allowed ? { email, roles: [...roles] } : { email, roles: [...roles], denied: true };
}

function editText(v) {
  if (v === "" || v === null || v === undefined) return "";
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  return null; // dates / strings: use display text
}

async function apiSheets(req, res, sub) {
  const user = await editorAuth(req);
  if (!user) return sendJson(res, 401, { ok: false, error: "Sign in to the portal first (this page uses your portal session)." });
  if (user.denied) return sendJson(res, 403, { ok: false, error: "Your portal role cannot edit sheet data. Allowed roles: " + EDITOR_ROLES.join(", ") });
  const url = new URL(req.url, "http://x");

  if (sub === "workbooks") {
    return sendJson(res, 200, { ok: true, user, workbooks: [...store.workbooks.values()].map(wb => ({
      id: wb.id, title: wb.title, key: wb.key,
      sheets: wb.sheets.map(s => ({ name: s.name, rows: s.lastRow(), cols: s.lastCol(), maxRows: s.maxRows, maxCols: s.maxCols, frozenRows: s.frozenRows, hidden: s.hidden }))
    })) });
  }
  if (sub === "data") {
    const wb = store.workbook(url.searchParams.get("id"));
    const sd = wb && wb.sheets.find(s => s.name === url.searchParams.get("sheet"));
    if (!sd) return sendJson(res, 404, { ok: false, error: "Sheet not found" });
    const from = Math.max(1, Number(url.searchParams.get("from") || 1));
    const to = Math.min(Math.max(sd.lastRow(), 1), Number(url.searchParams.get("to") || from + 199));
    const cols = Math.max(sd.lastCol(), 1);
    const rows = withJournal(() => {
      const { app } = createSpreadsheetApp(editorEnv());
      const range = app.openById(wb.id).getSheetByName(sd.name).getRange(from, 1, Math.max(1, to - from + 1), cols);
      const disp = range.getDisplayValues();
      return disp.map((line, i) => {
        const r = sd.rows[from - 1 + i];
        return { n: from + i, d: Array.from(line), e: Array.from(line, (dv, c) => { const t = editText(r ? r.v[c] : ""); return t === null ? dv : t; }) };
      });
    });
    return sendJson(res, 200, { ok: true, from, to, lastRow: sd.lastRow(), cols, rows });
  }
  const body = await readJson(req);
  if (sub === "edit") return sendJson(res, 200, await editorEdit(body, user));
  if (sub === "menus") return sendJson(res, 200, await editorMenus(body));
  if (sub === "run") return sendJson(res, 200, await editorRunMenu(body, user));
  sendJson(res, 404, { ok: false, error: "Unknown endpoint" });
}

function editorEnv() {
  return { store, project: "_editor", realm: { Object, Array, Date, Error, JSON, RegExp }, sheetUrl: (id) => PUBLIC_URL + "/sheets/#" + id, warn: () => {} };
}

/**
 * Apply an edit made in the sheet editor, then fire the same edit triggers
 * Google Sheets would fire (simple onEdit of the bound project and installable
 * onEdit triggers on that spreadsheet).
 * body: { id, sheet, action: "set"|"insertRows"|"deleteRows"|"clear", row, col, values, count }
 */
async function editorEdit(body, user) {
  const wb = store.workbook(body.id);
  const sd = wb && wb.sheets.find(s => s.name === body.sheet);
  if (!sd) return { ok: false, error: "Sheet not found" };
  const logs = [];
  let editInfo = null;
  const r = await runtime.run(PORTAL, null, null, {
    activeUserEmail: user.email,
    run: () => {
      const { app } = createSpreadsheetApp(editorEnv());
      const sheet = app.openById(wb.id).getSheetByName(sd.name);
      const row = Number(body.row), col = Number(body.col || 1);
      if (body.action === "insertRows") { sheet.insertRowsAfter(Math.max(0, row - 1), Number(body.count || 1)); return null; }
      if (body.action === "deleteRows") { sheet.deleteRows(row, Number(body.count || 1)); return null; }
      const values = body.values || [[""]];
      const range = sheet.getRange(row, col, values.length, Math.max(...values.map(l => l.length)));
      const padded = values.map(l => { const a = l.slice(); while (a.length < range.getNumColumns()) a.push(""); return a; });
      const oldValue = range.getNumRows() === 1 && range.getNumColumns() === 1 ? range.getValue() : undefined;
      if (body.action === "clear") range.clearContent(); else range.setValues(padded);
      editInfo = { row, col, numRows: range.getNumRows(), numCols: range.getNumColumns(), oldValue };
      return null;
    }
  });
  if (!r.ok) { await r.persisted.catch(() => {}); return { ok: false, error: errorMessage(r.error) }; }
  await r.persisted;
  const triggerResults = [];
  if (editInfo) {
    await adapter.loadTriggers(store).catch(() => {});
    for (const t of runtime.editTriggerTargets(wb.id)) {
      const tr = await runtime.run(t.project, null, null, {
        activeUserEmail: user.email,
        run: (c) => {
          if (typeof c.sandbox[t.handler] !== "function") return "skipped";
          c.sandbox.__gas_edit = JSON.stringify({ id: wb.id, sheet: sd.name, editInfo, simple: t.simple, uid: t.id || null, email: user.email });
          return vm.runInContext(
            "(function(){ var a = JSON.parse(__gas_edit); var ss = SpreadsheetApp.openById(a.id); var sh = ss.getSheetByName(a.sheet);" +
            " var range = sh.getRange(a.editInfo.row, a.editInfo.col, a.editInfo.numRows, a.editInfo.numCols);" +
            " var e = { range: range, source: ss, authMode: a.simple ? ScriptApp.AuthMode.LIMITED : ScriptApp.AuthMode.FULL, triggerUid: a.uid," +
            "   user: { getEmail: function(){ return a.email; }, toString: function(){ return a.email; } } };" +
            " if (a.editInfo.numRows === 1 && a.editInfo.numColumns === 1 || (a.editInfo.numRows === 1 && a.editInfo.numCols === 1)) {" +
            "   var v = range.getValue(); if (v !== '') e.value = typeof v === 'string' ? v : range.getDisplayValue();" +
            "   if (a.editInfo.oldValue !== undefined && a.editInfo.oldValue !== '') e.oldValue = String(a.editInfo.oldValue); }" +
            " " + t.handler + "(e); return 'ran'; })()", c.ctx, { timeout: 330000 });
        }
      });
      try { await tr.persisted; } catch (e) { /* logged */ }
      triggerResults.push({ project: t.project, handler: t.handler, status: tr.ok ? tr.value : "error", error: tr.ok ? undefined : errorMessage(tr.error) });
      logs.push(...tr.logs.filter(l => l.level !== "debug").slice(-50));
    }
  }
  return { ok: true, triggers: triggerResults, logs: logs.map(l => "[" + l.project + "] " + l.msg) };
}

function boundProjects(spreadsheetId) {
  return [...runtime.projects.values()].filter(p => p.boundSpreadsheetId === spreadsheetId).map(p => p.name);
}
async function editorMenus(body) {
  const out = [];
  for (const project of boundProjects(body.id)) {
    const sink = makeUiSink([]);
    const r = await runtime.run(project, null, null, {
      uiSink: sink,
      run: (c) => { if (typeof c.sandbox.onOpen === "function") vm.runInContext("onOpen({authMode: ScriptApp.AuthMode.FULL})", c.ctx, { timeout: 30000 }); return null; }
    });
    for (const m of sink.menus) out.push(Object.assign({ project }, m));
    if (!r.ok) log.warn("[menus] onOpen failed for " + project + ": " + errorMessage(r.error));
  }
  return { ok: true, menus: out };
}
async function editorRunMenu(body, user) {
  const project = String(body.project || "");
  if (!boundProjects(body.id).includes(project)) return { ok: false, error: "Project is not bound to this spreadsheet" };
  const fn = String(body.fn || "");
  if (!/^[A-Za-z_$][\w$.]*$/.test(fn)) return { ok: false, error: "Bad function name" };
  const sink = makeUiSink(Array.isArray(body.answers) ? body.answers : []);
  const r = await runtime.run(project, fn, "[]", { uiSink: sink, activeUserEmail: user.email });
  try { await r.persisted; } catch (e) { return { ok: false, error: "Saving to the database failed: " + e.message }; }
  return {
    ok: r.ok || !!r.uiRequest, needInput: r.uiRequest || null, error: r.ok || r.uiRequest ? undefined : errorMessage(r.error),
    alerts: sink.alerts, toasts: sink.toasts, dialogs: sink.dialogs,
    logs: r.logs.filter(l => l.level !== "debug").slice(-200).map(l => "[" + l.level + "] " + l.msg)
  };
}

/* ------------------------------------------------------------------ */
/* Time-based triggers                                                 */
/* ------------------------------------------------------------------ */
/**
 * Once a minute (Supabase pg_cron calls /app/cron, see supabase/app_schedule.sql):
 * Dhruva's time-based triggers and the shared candidates/clients sync.
 * On Vercel nothing runs between requests, so this replaces in-process timers.
 */
let cronRunning = false;
async function cronTick() {
  if (cronRunning) return { ok: true, skipped: "already running" };
  cronRunning = true;
  const out = { ok: true, triggers: [], masters: null };
  try {
    await adapter.loadTriggers(store);
    const now = Date.now();
    let changed = false;
    for (const t of store.triggers.filter(t => t.type === "CLOCK")) {
      const m = t.meta || (t.meta = {});
      if (!dueNow(m, now)) continue;
      m.lastRun = now; changed = true;
      if (m.once) store.triggers.splice(store.triggers.indexOf(t), 1);
      await adapter.saveTriggers(store.triggers);   // claim it before running
      const d = new Date(now);
      const ev = { authMode: "FULL", triggerUid: t.id, year: d.getFullYear(), month: d.getMonth() + 1, "day-of-month": d.getDate(), hour: d.getHours(), minute: d.getMinutes(), second: d.getSeconds(), timezone: CONFIG.timeZone };
      const r = await runtime.run(t.project, t.handler, JSON.stringify([ev]));
      out.triggers.push({ project: t.project, handler: t.handler, ok: r.ok });
      if (!r.ok) log.error("[trigger] " + t.project + "." + t.handler + " failed: " + errorMessage(r.error));
    }
    if (changed) await adapter.saveTriggers(store.triggers);
    const plan = await masters.tick();
    out.masters = plan ? { mode: masters.mode(), applied: plan.applied, errors: plan.errors.length } : null;
    // refresh the start-up snapshot every 15 minutes when data has changed
    if (store.lastSeq > snapState.seq && Date.now() - snapState.at > 15 * 60e3) out.snapshot = await saveSnapshot("scheduled");
  } catch (e) { out.ok = false; out.error = e.message; log.error("[cron] " + e.message); }
  finally { cronRunning = false; }
  return out;
}
function dueNow(m, now) {
  if (m.at) return now >= m.at;
  const every = m.everyMs || 0;
  if (!every) return false;
  const last = m.lastRun || 0;
  if (m.atHour !== undefined && every >= 86400000) {
    const d = new Date(now);
    if (d.getHours() !== Number(m.atHour)) return false;
    if (m.nearMinute !== undefined && d.getMinutes() < Number(m.nearMinute)) return false;
    return now - last >= every - 3600000;
  }
  return now - last >= every;
}

/* ------------------------------------------------------------------ */
/* Email                                                               */
/* ------------------------------------------------------------------ */
async function sendMail(m) {
  const from = process.env.MAIL_FROM || "";
  const fromHeader = m.name && from && !/</.test(from) ? m.name + " <" + from + ">" : from;
  if (process.env.RESEND_API_KEY) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + process.env.RESEND_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ from: fromHeader, to: m.to.split(",").map(s => s.trim()), cc: m.cc || undefined, bcc: m.bcc || undefined, reply_to: m.replyTo || undefined, subject: m.subject, html: m.html || undefined, text: m.text || undefined })
    });
    if (!res.ok) throw new Error("Resend " + res.status + ": " + (await res.text()).slice(0, 300));
    return;
  }
  if (process.env.MAIL_WEBHOOK_URL) {
    const res = await fetch(process.env.MAIL_WEBHOOK_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.assign({ from: fromHeader }, m)) });
    if (!res.ok) throw new Error("Mail webhook " + res.status);
    return;
  }
  log.warn("[mail] No mail provider configured (RESEND_API_KEY or MAIL_WEBHOOK_URL). Email NOT sent:\n  To: " + m.to + "\n  Subject: " + m.subject + "\n  " + m.text.replace(/\n/g, "\n  "));
}

/* ------------------------------------------------------------------ */
/* HTTP plumbing                                                       */
/* ------------------------------------------------------------------ */
function requestEvent(req) {
  const u = new URL(req.url, "http://x");
  const parameter = Object.fromEntries(u.searchParams);
  return { parameter, parameters: Object.fromEntries([...u.searchParams.keys()].map(k => [k, u.searchParams.getAll(k)])), queryString: u.search.slice(1), contextPath: "", contentLength: -1 };
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on("data", (c) => { size += c.length; if (size > MAX_BODY) { reject(new Error("Body too large")); req.destroy(); } else chunks.push(c); });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}
async function readJson(req) { const t = await readBody(req); return t ? JSON.parse(t) : {}; }
function sendJson(res, code, obj) { const s = JSON.stringify(obj); res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }); res.end(s); }
function sendHtml(res, code, html) { res.writeHead(code, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }); res.end(html); }
function esc(s) { return String(s === undefined ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
}

/* ------------------------------------------------------------------ */
/* Combined app: sign-in, roles, TTOP hosting, Dhruva SSO, shared masters */
/* ------------------------------------------------------------------ */
const { createAuth, httpError } = require("./app/auth");
const { createTtop } = require("./app/ttop");
const { createDhruvaSso } = require("./app/dhruva");
const { createMasters } = require("./app/masters");
const rest = (method, p, body, headers) => adapter.req(method, p, body, headers);
let auth = null, masters = null, admin = null;
const { createAdmin } = require("./app/admin");
const CSV_JS = "window.parseCsv = " + require("./app/csvimport").parseCsv.toString() + ";";
const ttop = createTtop({ root: ROOT, log });
const sso = createDhruvaSso({ runtime, store });
const SECURE_COOKIE = /^https:/i.test(PUBLIC_URL);

function redirect(res, to) { res.writeHead(302, { Location: to, "Cache-Control": "no-store" }); res.end(); }
/** Page gate: signed in + allowed to open this portal, else back to the home page. */
async function pageGate(req, res, portal) {
  const u = await auth.current(req);
  if (u && auth.canOpen(u, portal)) return u;
  redirect(res, "/?next=" + encodeURIComponent("/" + portal + "/"));
  return null;
}
/** API gate for Dhruva calls (google.script.run, sheet editor). */
async function dhruvaApiGate(req, res) {
  const u = await auth.current(req);
  if (u && auth.canOpen(u, "dhruva")) return u;
  sendJson(res, u ? 403 : 401, { ok: false, error: { name: "AppAuth", message: u ? "APP_NO_DHRUVA_ACCESS" : "APP_SIGNED_OUT" } });
  return null;
}

async function appApi(req, res, sub) {
  if (sub === "login" && req.method === "POST") {
    const body = await readJson(req);
    const email = await auth.emailFromSupabaseToken(String(body.access_token || ""));
    if (!email) return sendJson(res, 401, { ok: false, error: "Sign-in expired. Please sign in again." });
    const u = await auth.getUser(email);
    if (!u) return sendJson(res, 403, { ok: false, error: "Not set up in the portal" });
    res.setHeader("Set-Cookie", auth.makeCookie(email, SECURE_COOKIE));
    rest("PATCH", "app_users?email=eq." + encodeURIComponent(email), { last_login_at: new Date().toISOString() }, { Prefer: "return=minimal" }).catch(() => {});
    const t = masters.tickIfStale(120000); if (t) await t;
    return sendJson(res, 200, { ok: true, user: publicUser(u) });
  }
  if (sub === "logout") { res.setHeader("Set-Cookie", auth.clearCookie()); return sendJson(res, 200, { ok: true }); }
  const me = await auth.current(req);
  if (!me) return sendJson(res, 401, { ok: false, error: "Signed out" });
  if (sub === "me") return sendJson(res, 200, { ok: true, user: publicUser(me) });
  if (sub === "dhruva-session") {
    if (!auth.canOpen(me, "dhruva")) return sendJson(res, 403, { ok: false, error: "You do not have access to the Dhruva portal" });
    const cur = req.method === "POST" ? String((await readJson(req)).current || "") : String(new URL(req.url, "http://x").searchParams.get("current") || "");
    const r = await sso.session(me, cur);
    return r.error ? sendJson(res, 403, { ok: false, error: r.error }) : sendJson(res, 200, { ok: true, token: r.token });
  }
  if (sub === "users") {
    if (me.role === "user") return sendJson(res, 403, { ok: false, error: "Not allowed" });
    try {
      if (req.method === "GET") {
        const all = await auth.loadUsers(true);
        const list = [...all.values()]
          .filter(u => me.role === "super_admin" || (u.portals || []).some(p => me.portals.includes(p)))
          .map(u => {
            const d = sso.dhruvaRoles(u.email);
            const problem = d.known && d.active && auth.canOpen(u, "dhruva") ? sso.ceilingProblem(u, d) : null;
            return Object.assign(publicUser(u), { active: u.active, lastLogin: u.last_login_at || null, canEdit: auth.mayManage(me, u, u), dhruva: { known: d.known, active: d.active, roles: d.roles, problem } });
          });
        return sendJson(res, 200, { ok: true, users: list });
      }
      if (req.method === "POST") { const u = await auth.saveUser(me, await readJson(req)); return sendJson(res, 200, { ok: true, user: publicUser(u) }); }
      if (req.method === "DELETE") { await auth.deleteUser(me, new URL(req.url, "http://x").searchParams.get("email")); return sendJson(res, 200, { ok: true }); }
    } catch (e) { return sendJson(res, e.status || 500, { ok: false, error: e.message }); }
  }
  if (sub === "signups") {
    if (me.role === "user") return sendJson(res, 403, { ok: false, error: "Not allowed" });
    return sendJson(res, 200, { ok: true, signups: await admin.pendingSignups() });
  }
  if (sub === "overview" || sub === "import" || sub === "dhruva-setup") {
    if (me.role !== "super_admin") return sendJson(res, 403, { ok: false, error: "Super admins only" });
    try {
      if (sub === "overview") return sendJson(res, 200, Object.assign({ ok: true }, await admin.overview()));
      if (sub === "import") {
        if (req.method === "GET") return sendJson(res, 200, { ok: true, targets: admin.importTargets(), data: await admin.dataStatus() });
        const b = await readJson(req);
        if (b.action === "chunk") return sendJson(res, 200, await admin.importChunk(b));
        if (b.action === "apply") {
          const out = await admin.importApply(b, me);
          if (/^V2 User (Access|Roles)$/.test(out.tab)) await seedDhruvaUsers().catch(e => log.error("[import] adding Dhruva users: " + e.message));
          return sendJson(res, 200, out);
        }
        return sendJson(res, 400, { ok: false, error: "Unknown action" });
      }
      if (req.method === "GET") return sendJson(res, 200, Object.assign({ ok: true, properties: admin.listProperties() }, admin.setupStatus()));
      const b = await readJson(req);
      if (b.action === "run") return sendJson(res, 200, await admin.runSetup(me));
      if (b.action === "set") return sendJson(res, 200, await admin.setProperty(b, me));
      return sendJson(res, 400, { ok: false, error: "Unknown action" });
    } catch (e) {
      if (!e.status) log.error("[admin] " + sub + ": " + (e.stack || e));
      return sendJson(res, e.status || 500, { ok: false, error: e.message });
    }
  }
  if (sub === "masters") {
    if (me.role !== "super_admin") return sendJson(res, 403, { ok: false, error: "Super admins only" });
    if (req.method === "POST") {
      const b = await readJson(req);
      if (b.mode) await masters.setMode(b.mode, me.email);
      if (b.run || b.mode) await masters.tick();
    }
    if (!masters.report()) await masters.reconcile(false).catch(() => {});
    return sendJson(res, 200, { ok: true, mode: await masters.getMode(), report: masters.report() });
  }
  sendJson(res, 404, { ok: false, error: "Not found" });
}
function publicUser(u) { return { email: u.email, name: u.name || "", role: u.role, portals: u.role === "super_admin" ? ["ttop", "dhruva"] : (u.portals || []) }; }

/** SUPER_ADMIN_EMAILS: people who are always super admins (needed on a new, empty database). */
async function ensureSuperAdmins() {
  const want = String(process.env.SUPER_ADMIN_EMAILS || "").toLowerCase().split(",").map(s => s.trim()).filter(e => /^[^@\s]+@[^@\s]+$/.test(e));
  if (!want.length) return;
  const all = await auth.loadUsers(true);
  const rows = want.filter(e => !all.has(e) || all.get(e).role !== "super_admin" || !all.get(e).active)
    .map(e => ({ email: e, name: (all.get(e) && all.get(e).name) || null, role: "super_admin", portals: ["ttop", "dhruva"], active: true, updated_by: "SUPER_ADMIN_EMAILS" }));
  if (!rows.length) return;
  await rest("POST", "app_users?on_conflict=email", rows, { Prefer: "resolution=merge-duplicates,return=minimal" });
  await auth.loadUsers(true);
  log.log("[boot] super admins from SUPER_ADMIN_EMAILS: " + rows.map(r => r.email).join(", "));
}

/** First start with Dhruva data: add Dhruva's active users to app_users (merged with TTOP's). */
async function seedDhruvaUsers() {
  const done = await rest("GET", "app_state?key=eq.dhruva_users_seeded&select=value");
  if (done.length) return;
  const dUsers = sso.dhruvaUsers();
  const pb = store.workbook("1Q5pRPoLsSjfxuRfEUZW2zZqrURYPzzbbPO6_8r9CLCk");
  const rolesTab = pb && pb.sheets.find(x => x.name === "V2 User Roles");
  if (!dUsers.length || !rolesTab || rolesTab.lastRow() < 2) return;   // Dhruva user tabs not there yet (e.g. mid CSV import): try again later
  const all = await auth.loadUsers(true);
  const rank = { user: 1, admin: 2, super_admin: 3 };
  const rows = [];
  for (const d of dUsers) {
    const mapped = d.roles.includes("SUPER_ADMIN") ? "super_admin" : d.roles.includes("ADMIN") ? "admin" : "user";
    const ex = all.get(d.email);
    const role = ex && rank[ex.role] > rank[mapped] ? ex.role : mapped;
    const portals = [...new Set([...(ex ? ex.portals : []), "dhruva"])];
    rows.push({ email: d.email, name: (ex && ex.name) || d.name || null, role, portals, active: true, updated_by: "seed: dhruva" });
  }
  if (rows.length) await rest("POST", "app_users?on_conflict=email", rows, { Prefer: "resolution=merge-duplicates,return=minimal" });
  await rest("POST", "app_state?on_conflict=key", [{ key: "dhruva_users_seeded", value: new Date().toISOString() }], { Prefer: "resolution=merge-duplicates,return=minimal" });
  await auth.loadUsers(true);
  log.log("[boot] added " + rows.length + " Dhruva users to app_users");
}

async function handle(req, res) {
  const p = req.url.split("?")[0];
  try {
    if (p === "/healthz") return sendJson(res, 200, { ok: true, workbooks: store.workbooks.size });
    if (p === "/gas-client.js") { res.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "no-cache" }); return res.end(GAS_CLIENT); }
    // home page
    if (p === "/" && req.method === "GET") return sendHtml(res, 200, fs.readFileSync(path.join(ROOT, "public", "app.html"), "utf8"));
    if (p === "/app/csv.js") { res.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "no-cache" }); return res.end(CSV_JS); }
    if (p === "/app/cron") {
      const want = process.env.CRON_SECRET;
      if (!want || String(req.headers.authorization || "") !== "Bearer " + want) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      return sendJson(res, 200, await cronTick());
    }
    let m = /^\/app\/api\/([\w-]+)$/.exec(p);
    if (m) return await appApi(req, res, m[1]);
    // Dhruva portal
    if ((p === "/dhruva" || p === "/dhruva/") && req.method === "GET") { if (await pageGate(req, res, "dhruva")) return await servePortal(req, res); return; }
    if ((p === "/" || p === "/exec" || p === "/dhruva/") && req.method === "POST") return await serveExec(PORTAL, req, res);  // Dhruva doPost (Coverage Desk export)
    if (p === "/api/run" && req.method === "POST") { if (await dhruvaApiGate(req, res)) return await apiRun(req, res); return; }
    m = /^\/exec\/([\w-]+)$/.exec(p);
    if (m && runtime.projects.has(m[1])) return await serveExec(m[1], req, res);
    if (p === "/sheets" || p === "/sheets/") { if (await pageGate(req, res, "dhruva")) return sendHtml(res, 200, fs.readFileSync(path.join(ROOT, "public", "sheets.html"), "utf8")); return; }
    m = /^\/api\/sheets\/(\w+)$/.exec(p);
    if (m) { if (await dhruvaApiGate(req, res)) return await apiSheets(req, res, m[1]); return; }
    // TTOP portal (page gated; its data is protected by TTOP's own row-level security)
    if (p === "/ttop" || p === "/ttop/" || p === "/ttop/index.html") { if (await pageGate(req, res, "ttop")) ttop.serveStatic(req, res, p); return; }
    if (ttop.serveStatic(req, res, p)) return;
    if (p.startsWith("/api/") && await ttop.serveApi(req, res, p, readBody)) return;
    sendJson(res, 404, { ok: false, error: "Not found" });
  } catch (e) {
    log.error("[http] " + req.method + " " + p + ":", e && e.stack || e);
    if (!res.headersSent) sendJson(res, 500, { ok: false, error: { message: String(e && e.message || e) } });
  }
}
const server = http.createServer((req, res) => { ready().then(() => handle(req, res), (e) => sendJson(res, 500, { ok: false, error: "Server failed to start: " + e.message })); });

/** One-time start of this server copy (on Vercel: the first request of a new instance). */
let readyPromise = null;
function ready() {
  if (!readyPromise) readyPromise = init().catch((e) => { readyPromise = null; throw e; });
  return readyPromise;
}
/**
 * Snapshot of Dhruva's data in Supabase Storage, so a new server copy starts from one
 * file instead of reading every row through the database API (see persistence.js).
 * Built inside the action lane, so it never contains a half-saved action.
 */
const snapState = { busy: false, seq: -1, at: 0 };
async function saveSnapshot(reason) {
  if (typeof adapter.buildSnapshot !== "function" || process.env.APP_SNAPSHOT === "0" || snapState.busy) return null;
  snapState.busy = true;
  try {
    const t = Date.now();
    const { body, seq } = await runtime.exclusive(async () => { await runtime.sync(true); return adapter.buildSnapshot(store); });
    const bytes = await adapter.uploadSnapshot(body);
    snapState.seq = seq; snapState.at = Date.now();
    log.log("[snapshot] saved (" + reason + "): up to save " + seq + ", " + Math.round(bytes / 1024) + " KB in " + (Date.now() - t) + " ms");
    return { seq, bytes };
  } catch (e) {
    log.warn("[snapshot] not saved (" + reason + "): " + e.message);
    return null;
  } finally { snapState.busy = false; }
}

/** How this server copy started (sent in Server-Timing so a slow first request can be explained). */
const bootInfo = { ms: 0, steps: {}, rows: 0, tabs: 0 };
async function init() {
  const t0 = Date.now();
  let ts = t0;
  const step = (name) => { const now = Date.now(); bootInfo.steps[name] = now - ts; ts = now; };
  if (!process.env.SUPABASE_URL) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  auth = createAuth({
    supabaseUrl: process.env.SUPABASE_URL.replace(/\/$/, ""), serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    anonKey: process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, secret: process.env.APP_SECRET, rest, log
  });
  runtime.loadProjects();
  step("scripts");
  const info = await adapter.load(store, CONFIG);
  step("data");
  if (info) {
    bootInfo.rows = info.rows; bootInfo.tabs = info.sheets;
    if (info.stats) bootInfo.steps["(data from " + info.stats.from + ": " + info.stats.requests + " requests, " + Math.round(info.stats.bytes / 1024) + " KB" +
      (info.snapshot ? ", " + info.snapshot.behind + " changes since" : "") + ", decode ms"] = info.stats.decodeMs;
    // keep the snapshot useful: write one after a full load, or when it has fallen behind
    if (info.snapshot) {
      snapState.seq = Number(info.snapshot.seq); snapState.at = Number(info.snapshot.at);
      if (info.snapshot.behind > 2000 || Date.now() - snapState.at > 6 * 3600e3) saveSnapshot("start: snapshot behind").catch(() => {});
    } else if (info.stats) {
      saveSnapshot("start: no snapshot yet").catch(() => {});
    }
  }
  // Route the Apps Script web-app URLs stored in Script Properties to the matching project
  for (const e of (info && info.exportLog) || []) {
    const mm = /\/macros\/s\/([A-Za-z0-9_-]+)\//.exec(e.web_app_url || "");
    if (mm && runtime.projects.has(e.project)) CONFIG.deployments[mm[1]] = e.project;
  }
  for (const [id, w] of Object.entries(CONFIG.workbooks)) if (!store.workbook(id)) log.warn("[boot] workbook " + w.title + " (" + id + ") has no data yet - run the Dhruva export first");
  portalAllowList = computeAllowList();
  step("allowlist");
  log.log("[boot] loaded " + store.workbooks.size + " Dhruva workbooks" + (info ? " (" + info.sheets + " tabs, " + info.rows + " rows)" : "") + " in " + (Date.now() - t0) + " ms; Dhruva portal exposes " + portalAllowList.size + " functions");
  await ensureSuperAdmins().catch(e => log.error("[boot] SUPER_ADMIN_EMAILS: " + e.message));
  step("superadmins");
  await seedDhruvaUsers().catch(e => log.error("[boot] could not add Dhruva users to app_users: " + e.message));
  step("users");
  masters = createMasters({ runtime, store, rest, log });
  admin = createAdmin({ runtime, store, rest, log });
  runtime.afterCommit = (changes) => masters.onDhruvaChanges(changes);
  step("rest");
  bootInfo.ms = Date.now() - t0;
  log.log("[boot] ready in " + bootInfo.ms + " ms: " + JSON.stringify(bootInfo.steps));
}
/** Local / VM mode (`npm start`): listen and run the once-a-minute work in-process. */
async function main() {
  await ready();
  const iv = setInterval(() => cronTick().catch(() => {}), 60000); iv.unref();
  setTimeout(() => cronTick().catch(() => {}), 5000).unref();
  server.listen(PORT, () => log.log("[boot] Interview Operations Portal running at " + PUBLIC_URL + "  (home /, TTOP /ttop/, Dhruva /dhruva/)"));
}
if (require.main === module) main().catch(e => { log.error(e); process.exit(1); });

/** Vercel entry: api/index.js calls this for every request. */
async function vercelHandler(req, res) {
  const t = Date.now();
  try {
    await ready();
    req.bootWait = Date.now() - t;
  }
  catch (e) { log.error("[boot] " + (e && e.stack || e)); return sendJson(res, 500, { ok: false, error: "Server failed to start: " + e.message }); }
  return handle(req, res);
}

module.exports = { server, store, runtime, main, ready, handle, vercelHandler, cronTick, serializeForClient, buildPage, get auth() { return auth; }, get masters() { return masters; } };
