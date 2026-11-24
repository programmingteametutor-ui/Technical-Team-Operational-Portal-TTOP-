"use strict";
/**
 * Apps Script runtime.
 *
 * Each Apps Script project (portal, call trackers, private backends) keeps its
 * original source files unchanged. For every execution we create a fresh V8
 * context (Apps Script also starts every server call with fresh globals),
 * install the emulated services, run the project's files and call the
 * requested function.
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { createSpreadsheetApp } = require("./gas/spreadsheet");
const S = require("./gas/services");

const EXEC_TIMEOUT_MS = Number(process.env.GAS_EXEC_TIMEOUT_MS || 360000);

class UiInputNeeded extends Error {
  constructor(request) { super("UI_INPUT_NEEDED"); this.request = request; }
}

class Runtime {
  constructor({ store, config, appsScriptDir, publicUrl, ownerEmail, timeZone, adapter, mailer, logger }) {
    this.store = store;
    this.config = config;
    this.dir = appsScriptDir;
    this.publicUrl = (publicUrl || "").replace(/\/$/, "");
    this.ownerEmail = ownerEmail || "";
    this.timeZone = timeZone || "Asia/Kolkata";
    this.adapter = adapter;   // refresh(store) / commit(store, changes, force); null inside worker threads
    this.mailer = mailer;     // async (mail) => void
    this.log = logger || console;
    this.projects = new Map();
    this.debugLogs = /^(1|true|yes)$/i.test(process.env.DEBUG_GAS_LOGS || "");
    this.lane = Promise.resolve();   // one action at a time in this server copy
    // A page fires several calls at once; within this window only the first one
    // asks Supabase for other copies' changes (saves stay conflict-checked: see run()).
    this.freshMs = Number(process.env.GAS_REFRESH_WINDOW_MS ?? 1500);
    this.syncedAt = 0;
  }

  /** Pick up what other server copies saved; skipped when done within freshMs, unless forced. */
  async sync(force) {
    if (!this.adapter) return null;
    if (!force && this.freshMs > 0 && Date.now() - this.syncedAt < this.freshMs) return null;
    const started = Date.now();   // the data is current as of when the request left
    const info = await this.adapter.refresh(this.store);
    this.syncedAt = started;
    return info || {};
  }

  /* ------------------------------ loading ------------------------------ */
  loadProjects() {
    for (const [name, p] of Object.entries(this.config.projects)) {
      const dir = path.join(this.dir, p.dir);
      const all = fs.readdirSync(dir);
      const order = p.fileOrder || [];
      const jsFiles = all.filter(f => /\.(js|gs)$/.test(f))
        .sort((a, b) => {
          const ia = order.indexOf(a), ib = order.indexOf(b);
          if (ia >= 0 || ib >= 0) return (ia < 0 ? 1e9 : ia) - (ib < 0 ? 1e9 : ib);
          return a.localeCompare(b);
        });
      const htmlFiles = {};
      for (const f of all.filter(f => /\.html$/.test(f))) htmlFiles[f.replace(/\.html$/, "")] = fs.readFileSync(path.join(dir, f), "utf8");
      const scripts = jsFiles.map(f => new vm.Script(fs.readFileSync(path.join(dir, f), "utf8"), { filename: path.join(p.dir, f) }));
      this.projects.set(name, { name, ...p, jsFiles, scripts, htmlFiles });
    }
  }

  projectForUrl(url) {
    const u = String(url);
    let m = /^internal:\/\/([^/?#]+)/.exec(u);
    if (m && this.projects.has(m[1])) return m[1];
    m = /\/macros\/s\/([A-Za-z0-9_-]+)\/(exec|dev)/.exec(u);
    if (m) {
      const dep = (this.config.deployments || {})[m[1]];
      if (dep && this.projects.has(dep)) return dep;
      for (const [name, p] of this.projects) if ((p.deploymentIds || []).includes(m[1])) return name;
    }
    if (this.publicUrl && u.startsWith(this.publicUrl + "/exec/")) {
      const name = u.slice((this.publicUrl + "/exec/").length).split(/[/?#]/)[0];
      if (this.projects.has(name)) return name;
    }
    return null;
  }

  /* ------------------------------ contexts ------------------------------ */
  createContext(projectName, opts) {
    const proj = this.projects.get(projectName);
    if (!proj) throw new Error("Unknown Apps Script project: " + projectName);
    const sandbox = {};
    const ctx = vm.createContext(sandbox, { name: projectName });
    const realm = vm.runInContext("({Object, Array, Date, Error, JSON, RegExp})", ctx);
    const env = {
      store: this.store, project: projectName, realm, timeZone: this.timeZone,
      ownerEmail: this.ownerEmail, activeUserEmail: (opts && opts.activeUserEmail) || "",
      boundSpreadsheetId: proj.boundSpreadsheetId || null,
      scriptId: proj.scriptId || projectName,
      serviceUrl: this.publicUrl ? this.publicUrl + (proj.webApp ? "/" : "/exec/" + projectName) : "",
      uiSink: (opts && opts.uiSink) || null,
      logs: (opts && opts.logs) || [],
      mailQueue: (opts && opts.mailQueue) || [],
      sheetUrl: (id) => (this.publicUrl || "") + "/sheets/#" + encodeURIComponent(id),
      warn: (msg) => env.log("warn", msg),
      log: (level, msg) => {
        env.logs.push({ level, msg, project: projectName, at: new Date().toISOString() });
        if (env.logs.length > 2000) env.logs.splice(0, env.logs.length - 2000);
        if (this.debugLogs || level === "error") this.log[level === "debug" ? "log" : level === "warn" ? "warn" : level === "error" ? "error" : "log"]("[" + projectName + "] " + msg);
      },
      readHtmlFile: (name) => {
        const n = String(name).replace(/\.html$/, "");
        if (!(n in proj.htmlFiles)) throw new realm.Error("Exception: No HTML file named " + name + " was found.");
        return proj.htmlFiles[n];
      },
      evalTemplate: (src) => src,
      dispatchUrl: (url, o) => this.dispatchUrl(url, o, env),
      lockHeldElsewhere: () => !!(this.workerLockHeld && this.workerLockHeld(projectName)),
      saveTrigger: (t) => this.saveTrigger(t),
      deleteTrigger: (id) => this.deleteTrigger(id)
    };
    const ss = createSpreadsheetApp(env);
    const { Logger, console: gasConsole } = S.createLogger(env);
    const { MailApp, GmailApp } = S.createMail(env);
    Object.assign(sandbox, {
      SpreadsheetApp: ss.app,
      PropertiesService: S.createPropertiesService(env),
      CacheService: S.createCacheService(env),
      LockService: S.createLockService(env),
      Utilities: S.createUtilities(env),
      Session: S.createSession(env),
      Logger, console: gasConsole,
      MailApp, GmailApp,
      UrlFetchApp: S.createUrlFetchApp(env),
      ScriptApp: S.createScriptApp(env),
      HtmlService: S.createHtmlService(env),
      ContentService: S.createContentService(env),
      DriveApp: unsupported(realm, "DriveApp"),
      DocumentApp: unsupported(realm, "DocumentApp"),
      FormApp: unsupported(realm, "FormApp"),
      CalendarApp: unsupported(realm, "CalendarApp"),
      Browser: { Buttons: { OK: "ok", OK_CANCEL: "ok_cancel", YES_NO: "yes_no", YES_NO_CANCEL: "yes_no_cancel" }, msgBox: (...a) => (opts && opts.uiSink ? opts.uiSink.ui.alert(...a) : "ok"), inputBox: () => "cancel" }
    });
    sandbox.globalThis = sandbox;
    for (const script of proj.scripts) script.runInContext(ctx, { timeout: 60000 });
    return { ctx, env, sandbox, realm, ss };
  }

  callIn(c, fnName, argsJson) {
    c.sandbox.__gas_fn = fnName;
    c.sandbox.__gas_args = argsJson || "[]";
    return vm.runInContext(
      "(function(){ var f = globalThis[__gas_fn]; if (typeof f !== 'function') { try { f = eval(__gas_fn); } catch (e) {} }" +
      " if (typeof f !== 'function') throw new Error('Script function not found: ' + __gas_fn);" +
      " return f.apply(null, JSON.parse(__gas_args)); })()",
      c.ctx, { timeout: EXEC_TIMEOUT_MS }
    );
  }

  /* ------------------------------ executions ------------------------------ */
  /**
   * Run `fn(args)` in `project` as a top-level execution.
   * Returns { ok, value, error, logs, mails, persisted: Promise }.
   */
  execute(project, fn, argsJson, opts) {
    opts = opts || {};
    const { journal, nested } = this.store.begin();
    if (nested) throw new Error("Internal: nested top-level execution");
    const logs = [], mailQueue = [];
    let value, error = null, uiRequest = null;
    try {
      const c = this.createContext(project, { logs, mailQueue, uiSink: opts.uiSink, activeUserEmail: opts.activeUserEmail });
      if (opts.prepare) opts.prepare(c);
      value = fn ? this.callIn(c, fn, argsJson) : opts.run(c);
      if (opts.transform) value = opts.transform(value, c);
    } catch (e) {
      if (e instanceof UiInputNeeded || (e && e.message === "UI_INPUT_NEEDED" && e.request)) uiRequest = e.request;
      else error = e;
    }
    // scripts may catch the UI signal in their own try/catch; the sink remembers it
    if (!uiRequest && opts.uiSink && opts.uiSink.pending) uiRequest = opts.uiSink.pending;
    if (uiRequest) {
      journal.rollback();
      this.store.end(journal);
      return { ok: false, uiRequest, logs, mails: [], persisted: Promise.resolve() };
    }
    const changes = journal.changeSet();
    this.store.end(journal);
    if (error) logs.push({ level: "error", msg: String((error && error.stack) || error), project });
    if (opts.keepJournal) return { ok: !error, value, error, logs, mails: mailQueue, changes, journal, persisted: Promise.resolve() };
    journal.clear();
    return { ok: !error, value, error, logs, mails: mailQueue, changes, persisted: Promise.resolve() };
  }

  /** Run fn on this copy's lane: actions never overlap inside one server copy. */
  exclusive(fn) {
    const p = this.lane.then(fn);
    this.lane = p.catch(() => {});
    return p;
  }

  /**
   * The normal way to run an action:
   *   1. pick up what other server copies saved (skipped if this copy did so in the
   *      last freshMs; a save is still refused if another copy changed the same rows)
   *   2. run the Apps Script function (synchronously, as in Google)
   *   3. save its changes atomically; if another copy changed the same rows in the
   *      meantime, undo, refresh (always) and run the action again (up to 5 times)
   * Like Apps Script, changes made before an error are still saved.
   */
  async run(project, fn, argsJson, opts) {
    opts = opts || {};
    let committed = null;
    // where the time goes (sent to the browser as a Server-Timing header)
    const tm = { queue: 0, refresh: 0, refreshRows: 0, run: 0, save: 0, saveRows: 0, after: 0, attempts: 0 };
    const t0 = Date.now();
    const r = await this.exclusive(async () => {
      tm.queue = Date.now() - t0;
      for (let attempt = 1; ; attempt++) {
        tm.attempts = attempt;
        let t = Date.now();
        const info = await this.sync(attempt > 1);
        tm.refresh += Date.now() - t; if (info) tm.refreshRows += info.rows || 0;
        t = Date.now();
        const x = this.execute(project, fn, argsJson, Object.assign({}, opts, { keepJournal: true }));
        tm.run += Date.now() - t;
        x.timing = tm;
        if (x.uiRequest || !x.journal) return x;
        if (changesEmpty(x.changes)) { x.journal.clear(); return x; }
        try {
          t = Date.now();
          for (const e of x.changes.sheets.values()) tm.saveRows += e.full ? -1 : e.rows.size;   // -1 = whole tab rewritten
          if (this.adapter) await this.adapter.commit(this.store, x.changes, false);
          tm.save += Date.now() - t;
          x.journal.clear();
          committed = x.changes;
          return x;
        } catch (e) {
          x.journal.rollback();
          if (e.conflict && attempt < 5) { await new Promise(res => setTimeout(res, 30 * attempt + Math.random() * 60)); continue; }
          this.log.error("[commit] " + project + "." + (fn || "action") + " not saved: " + e.message);
          return Object.assign(x, { ok: false, mails: [], error: new Error(e.conflict
            ? "Someone else changed the same data at the same moment. Please try again."
            : "Saving to the database failed. Please try again. (" + e.message + ")") });
        }
      }
    });
    if (committed) {
      const t = Date.now();
      await this.sendMails(r.mails);
      if (this.afterCommit) { try { await this.afterCommit(committed); } catch (e) { this.log.error("[afterCommit] " + e.message); } }
      tm.after = Date.now() - t;
    }
    return r;
  }

  /** Save changes made outside an action (worker results, mirrored settings): last write wins. */
  async commitForce(changes) {
    if (!this.adapter || changesEmpty(changes)) return;
    for (let attempt = 1; ; attempt++) {
      try { await this.adapter.commit(this.store, changes, true); return; }
      catch (e) { if (attempt >= 4) throw e; await new Promise(res => setTimeout(res, 300 * attempt)); }
    }
  }

  /* ------------------------- worker-thread executions ------------------------- */
  /**
   * Run a long execution on a worker thread against a snapshot of the data,
   * then merge its row changes back and persist them. Returns a Promise of the
   * same shape as execute().
   */
  async executeInWorker(project, fn, argsJson, opts) {
    opts = opts || {};
    if (!this.pool) this.pool = new WorkerPool(this, Number(process.env.GAS_WORKERS || 2));
    const job = await this.exclusive(async () => {
      await this.sync(true);
      return {
        type: "run", project, fn, argsJson, serialize: !!opts.serialize, activeUserEmail: opts.activeUserEmail || "",
        snapshot: require("./snapshot").storeToSnapshot(this.store),
        cache: Object.fromEntries([...S.CACHES].map(([ns, m]) => [ns, [...m]]))
      };
    });
    const msg = await this.pool.run(job);
    let saveError = null;
    if (msg.changes) {
      await this.exclusive(async () => {
        await this.sync(true);
        const { applyTransfer } = require("./snapshot");
        const { journal } = this.store.begin();
        let changes;
        try { applyTransfer(this.store, msg.changes); }
        finally { changes = journal.changeSet(); this.store.end(journal); }
        try { await this.commitForce(changes); journal.clear(); }
        catch (e) { journal.rollback(); saveError = e; this.log.error("[commit] " + fn + " (background) not saved: " + e.message); }
      });
    }
    if (!saveError) await this.sendMails(msg.mails || []);
    const error = saveError ? new Error("Saving to the database failed. Please try again. (" + saveError.message + ")")
      : msg.error ? Object.assign(new Error(msg.error.message), { name: msg.error.name, stack: msg.error.stack }) : null;
    return { ok: msg.ok && !saveError, value: msg.value, error, logs: msg.logs || [], mails: msg.mails || [], persisted: Promise.resolve() };
  }

  /** Settings / cache written live by a worker (progress, job status): apply and save right away. */
  mirrorLive(item) {
    (this.mirrorBuf = this.mirrorBuf || []).push(item);
    if (this.mirrorTimer) return;
    this.mirrorTimer = setTimeout(() => {
      this.mirrorTimer = null;
      const items = this.mirrorBuf.splice(0);
      this.exclusive(async () => {
        const props = [], cache = [];
        for (const m of items) {
          if (m.type === "prop") {
            const map = this.store.properties(m.ns);
            if (m.value === null) map.delete(m.key); else map.set(m.key, m.value);
            props.push({ project: m.ns, key: m.key, value: m.value });
          } else {
            const c = S.CACHES.get(m.ns) || new Map(); S.CACHES.set(m.ns, c);
            if (m.entry) c.set(m.key, m.entry); else c.delete(m.key);
            cache.push({ project: m.ns, key: m.key, value: m.entry ? m.entry.v : null, expires_ms: m.entry ? m.entry.exp : Date.now() });
          }
        }
        // a key can appear several times in one batch (progress updates): keep the latest
        const last = (list, key) => [...new Map(list.map(x => [key(x), x])).values()];
        await this.commitForce({ sheets: new Map(), deleted: [], props: last(props, x => x.project + "\u0000" + x.key), cache: last(cache, x => x.project + "\u0000" + x.key) })
          .catch(e => this.log.error("[mirror] " + e.message));
      });
    }, 250);
  }

  async sendMails(list) {
    for (const m of list) {
      try { await this.mailer(m); }
      catch (e) { this.log.error("[mail] failed to send to " + m.to + ":", e && e.message); }
    }
  }

  /* -------------------- UrlFetchApp -> other projects -------------------- */
  dispatchUrl(url, opts, callerEnv) {
    const target = this.projectForUrl(url);
    if (!target) return null;
    const method = String(opts.method || "get").toLowerCase();
    let payload = opts.payload;
    let contents = "";
    let parameter = {};
    if (payload && typeof payload === "object" && !Array.isArray(payload)) {
      parameter = Object.fromEntries(Object.entries(payload).map(([k, v]) => [k, String(v)]));
      contents = new URLSearchParams(parameter).toString();
    } else if (payload !== undefined && payload !== null) contents = String(payload);
    const q = String(url).split("?")[1] || "";
    for (const [k, v] of new URLSearchParams(q)) parameter[k] = v;
    const event = {
      parameter, parameters: Object.fromEntries(Object.entries(parameter).map(([k, v]) => [k, [v]])),
      queryString: q, contextPath: "", contentLength: contents.length,
      postData: method === "post" ? { contents, length: contents.length, type: opts.contentType || "application/x-www-form-urlencoded", name: "postData" } : undefined
    };
    const handler = method === "post" ? "doPost" : "doGet";
    try {
      const c = this.createContext(target, { logs: callerEnv.logs, mailQueue: callerEnv.mailQueue });
      c.sandbox.__gas_event = JSON.stringify(event);
      const out = vm.runInContext(
        "(function(){ if (typeof " + handler + " !== 'function') throw new Error('Script function not found: " + handler + "'); return " + handler + "(JSON.parse(__gas_event)); })()",
        c.ctx, { timeout: EXEC_TIMEOUT_MS }
      );
      if (out && typeof out.getContent === "function") {
        const mime = typeof out.getMimeType === "function" ? out.getMimeType() : "text/html";
        return { code: 200, text: out.getContent(), headers: { "Content-Type": mime } };
      }
      return { code: 200, text: out === undefined ? "" : String(out), headers: { "Content-Type": "text/html" } };
    } catch (e) {
      callerEnv.log("error", "[" + target + "] " + handler + " failed: " + ((e && e.stack) || e));
      return { code: 200, text: "<!DOCTYPE html><html><body><div>" + escapeHtml("Error: " + (e && e.message)) + "</div></body></html>", headers: { "Content-Type": "text/html" } };
    }
  }

  /* ------------------------------ triggers ------------------------------ */
  saveTrigger(t) {
    this.store.triggers.push(t);
    if (this.onTriggersChanged) this.onTriggersChanged();
  }
  deleteTrigger(id) {
    const i = this.store.triggers.findIndex(t => t.id === String(id));
    if (i >= 0) this.store.triggers.splice(i, 1);
    if (this.onTriggersChanged) this.onTriggersChanged();
  }

  /**
   * Fire edit triggers for a cell edit made in the sheet editor:
   *   - simple onEdit(e) of the project bound to that spreadsheet
   *   - installable ON_EDIT triggers whose source is that spreadsheet
   */
  editTriggerTargets(spreadsheetId) {
    const targets = [];
    for (const [name, p] of this.projects) {
      if (p.boundSpreadsheetId === spreadsheetId && p.hasOnEdit !== false) targets.push({ project: name, handler: "onEdit", simple: true });
    }
    for (const t of this.store.triggers) {
      if (t.type === "ON_EDIT" && t.source_id === spreadsheetId && this.projects.has(t.project)) targets.push({ project: t.project, handler: t.handler, simple: false, id: t.id });
    }
    return targets;
  }
}

class WorkerPool {
  constructor(runtime, size) {
    this.runtime = runtime; this.size = Math.max(1, size); this.idle = []; this.all = []; this.queue = [];
    this.locks = new Map(); // project -> count of worker jobs holding the script lock
    runtime.workerLockHeld = (project) => (this.locks.get(project) || 0) > 0;
  }
  spawn() {
    const { Worker } = require("worker_threads");
    const w = new Worker(require("path").join(__dirname, "worker.js"), { workerData: {
      config: this.runtime.config, appsScriptDir: this.runtime.dir, publicUrl: this.runtime.publicUrl,
      ownerEmail: this.runtime.ownerEmail, timeZone: this.runtime.timeZone
    } });
    w.on("message", (m) => this.onMessage(w, m));
    w.on("error", (e) => { this.runtime.log.error("[worker] crashed:", e); if (w.job) w.job.reject(e); this.remove(w); });
    w.on("exit", () => this.remove(w));
    this.all.push(w);
    return w;
  }
  remove(w) { this.all = this.all.filter(x => x !== w); this.idle = this.idle.filter(x => x !== w); if (w.lockProject) this.setLock(w, null); }
  setLock(w, project) {
    if (w.lockProject) this.locks.set(w.lockProject, Math.max(0, (this.locks.get(w.lockProject) || 1) - 1));
    w.lockProject = project;
    if (project) this.locks.set(project, (this.locks.get(project) || 0) + 1);
  }
  onMessage(w, m) {
    if (m.type === "cache" || m.type === "prop") {
      this.runtime.mirrorLive(m);
    } else if (m.type === "lock") {
      this.setLock(w, m.held ? m.project : null);
    } else if (m.type === "done") {
      const job = w.job; w.job = null; this.setLock(w, null);
      this.idle.push(w); this.next();
      if (job) job.resolve(m);
    }
  }
  run(msg) { return new Promise((resolve, reject) => { this.queue.push({ msg, resolve, reject }); this.next(); }); }
  next() {
    while (this.queue.length) {
      let w = this.idle.pop();
      if (!w) { if (this.all.length >= this.size) return; w = this.spawn(); }
      const job = this.queue.shift(); w.job = job; w.postMessage(job.msg);
    }
  }
}

function changesEmpty(c) {
  return !c || (!c.sheets.size && !c.deleted.length && !c.props.length && !(c.cache && c.cache.length));
}

function unsupported(realm, name) {
  return new Proxy({}, { get: (_, k) => (typeof k === "string" ? () => { throw new realm.Error(name + "." + k + " is not available in the Supabase runtime."); } : undefined) });
}
function escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

module.exports = { Runtime, UiInputNeeded };
