"use strict";
/**
 * Apps Script service emulations (everything except SpreadsheetApp).
 * Every factory receives `env`, the per-execution environment built by
 * runtime.js, and returns objects whose values are created in the script's
 * own realm (env.realm) so `instanceof` checks inside the scripts keep working.
 */
const crypto = require("crypto");
const F = require("./format");

/* ------------------------------------------------------------------ */
/* PropertiesService                                                   */
/* ------------------------------------------------------------------ */
function createPropertiesService(env) {
  const { store } = env;
  function makeProps(ns) {
    const map = () => store.properties(ns);
    const touch = (k) => { if (store.journal) store.journal.touchProp(ns, k, map().get(k)); };
    const P = {
      getProperty: (k) => { const v = map().get(String(k)); return v === undefined ? null : v; },
      setProperty: (k, v) => { k = String(k); touch(k); map().set(k, String(v)); return P; },
      setProperties: (obj, deleteAllOthers) => {
        if (deleteAllOthers) for (const k of [...map().keys()]) if (!(k in obj)) { touch(k); map().delete(k); }
        for (const k of Object.keys(obj || {})) { touch(k); map().set(k, String(obj[k])); }
        return P;
      },
      getProperties: () => { const o = new env.realm.Object(); for (const [k, v] of map()) o[k] = v; return o; },
      getKeys: () => env.realm.Array.from(map().keys()),
      deleteProperty: (k) => { k = String(k); touch(k); map().delete(k); return P; },
      deleteAllProperties: () => { for (const k of [...map().keys()]) { touch(k); map().delete(k); } return P; }
    };
    return P;
  }
  return {
    getScriptProperties: () => makeProps(env.project),
    getUserProperties: () => makeProps(env.project + "::user"),
    getDocumentProperties: () => makeProps(env.project + "::document")
  };
}

/* ------------------------------------------------------------------ */
/* CacheService  (in memory, shared by all executions of a project)    */
/* ------------------------------------------------------------------ */
const CACHES = new Map();
function cacheFor(ns) {
  let c = CACHES.get(ns);
  if (!c) { c = new Map(); CACHES.set(ns, c); }
  return c;
}
function createCacheService(env) {
  // Shared by every server copy: writes are saved with the action (gs_cache) and
  // other copies pick them up on their next request.
  function make(ns) {
    const c = cacheFor(ns);
    const touch = (k) => { if (env.store && env.store.journal) env.store.journal.touchCache(ns, k, c.get(k)); };
    const live = (k) => { const e = c.get(k); if (!e) return null; if (e.exp < Date.now() || e.v === null) return null; return e.v; };
    const ttl = (s) => Math.min(Math.max(Number(s) || 600, 1), 21600) * 1000;
    const C = {
      get: (k) => live(String(k)),
      getAll: (keys) => { const o = new env.realm.Object(); for (const k of keys) { const v = live(String(k)); if (v !== null) o[k] = v; } return o; },
      put: (k, v, s) => {
        const val = String(v);
        if (String(k).length > 250) throw new env.realm.Error("Exception: Argument too large: key");
        if (Buffer.byteLength(val) > 102400) throw new env.realm.Error("Exception: Argument too large: value");
        touch(String(k));
        c.set(String(k), { v: val, exp: Date.now() + ttl(s) });
      },
      putAll: (obj, s) => { for (const k of Object.keys(obj)) C.put(k, obj[k], s); },
      remove: (k) => { touch(String(k)); c.delete(String(k)); },
      removeAll: (keys) => { for (const k of keys) C.remove(k); }
    };
    return C;
  }
  return {
    getScriptCache: () => make(env.project),
    getUserCache: () => make(env.project + "::user"),
    getDocumentCache: () => make(env.project + "::document")
  };
}

/* ------------------------------------------------------------------ */
/* LockService — executions are serialized on one thread, so a lock    */
/* is always immediately available.                                    */
/* ------------------------------------------------------------------ */
function createLockService(env) {
  const busy = () => !!(env && env.lockHeldElsewhere && env.lockHeldElsewhere());
  const make = () => {
    let held = false;
    return {
      tryLock: () => { if (busy()) return false; held = true; return true; },
      waitLock: () => { if (busy()) throw new env.realm.Error("Exception: Lock timeout: another process was holding the lock for too long."); held = true; },
      releaseLock: () => { held = false; },
      hasLock: () => held
    };
  };
  const makeUser = () => { let held = false; return { tryLock: () => { held = true; return true; }, waitLock: () => { held = true; }, releaseLock: () => { held = false; }, hasLock: () => held }; };
  return { getScriptLock: make, getUserLock: makeUser, getDocumentLock: make };
}

/* ------------------------------------------------------------------ */
/* Utilities                                                           */
/* ------------------------------------------------------------------ */
const DIGEST = { MD2: "md2", MD5: "md5", SHA_1: "sha1", SHA_256: "sha256", SHA_384: "sha384", SHA_512: "sha512" };
const MAC = { HMAC_MD5: "md5", HMAC_SHA_1: "sha1", HMAC_SHA_256: "sha256", HMAC_SHA_384: "sha384", HMAC_SHA_512: "sha512" };
function toBuffer(v, charset) {
  if (Array.isArray(v)) return Buffer.from(v.map(b => b & 255));
  if (v && typeof v.getBytes === "function") return Buffer.from(v.getBytes().map(b => b & 255));
  return Buffer.from(String(v), charset === "US_ASCII" ? "ascii" : "utf8");
}
function createUtilities(env) {
  const signed = (buf) => env.realm.Array.from(buf, b => (b > 127 ? b - 256 : b));
  const U = {
    formatDate: (date, tz, fmt) => F.formatJavaDate(date, tz, fmt),
    formatString: (tpl, ...args) => {
      let i = 0;
      return String(tpl).replace(/%(-?\d*)(?:\.(\d+))?([sdfi%])/g, (m, w, p, t) => {
        if (t === "%") return "%";
        let a = args[i++];
        if (t === "d" || t === "i") a = String(Math.trunc(Number(a)));
        else if (t === "f") a = Number(a).toFixed(p === undefined ? 6 : Number(p));
        else a = String(a);
        const width = Math.abs(Number(w) || 0);
        return w && w.startsWith("-") ? a.padEnd(width) : a.padStart(width);
      });
    },
    getUuid: () => crypto.randomUUID(),
    computeDigest: (alg, value, charset) => {
      const name = typeof alg === "string" && DIGEST[alg] ? DIGEST[alg] : alg;
      return signed(crypto.createHash(name).update(toBuffer(value, charset)).digest());
    },
    computeHmacSignature: (alg, value, key, charset) => signed(crypto.createHmac(MAC[alg] || alg, toBuffer(key, charset)).update(toBuffer(value, charset)).digest()),
    computeHmacSha256Signature: (value, key, charset) => signed(crypto.createHmac("sha256", toBuffer(key, charset)).update(toBuffer(value, charset)).digest()),
    computeRsaSha256Signature: () => { throw new env.realm.Error("Utilities.computeRsaSha256Signature is not supported."); },
    base64Encode: (v, charset) => toBuffer(v, charset).toString("base64"),
    base64EncodeWebSafe: (v, charset) => toBuffer(v, charset).toString("base64").replace(/\+/g, "-").replace(/\//g, "_"),
    base64Decode: (s) => signed(Buffer.from(String(s), "base64")),
    base64DecodeWebSafe: (s) => signed(Buffer.from(String(s).replace(/-/g, "+").replace(/_/g, "/"), "base64")),
    newBlob: (data, contentType, name) => makeBlob(env, toBuffer(data === undefined ? "" : data), contentType, name),
    sleep: (ms) => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.max(0, Math.min(Number(ms) || 0, 300000))); },
    parseCsv: (csv, delim) => env.realm.Array.from(parseCsv(String(csv), delim || ",")),
    jsonParse: (s) => env.realm.JSON.parse(s),
    jsonStringify: (o) => JSON.stringify(o),
    DigestAlgorithm: Object.fromEntries(Object.keys(DIGEST).map(k => [k, k])),
    MacAlgorithm: Object.fromEntries(Object.keys(MAC).map(k => [k, k])),
    Charset: { US_ASCII: "US_ASCII", UTF_8: "UTF_8" },
    RsaAlgorithm: { RSA_SHA_1: "RSA_SHA_1", RSA_SHA_256: "RSA_SHA_256" }
  };
  return U;
}
function makeBlob(env, buf, contentType, name) {
  const B = {
    getBytes: () => env.realm.Array.from(buf, b => (b > 127 ? b - 256 : b)),
    getDataAsString: () => buf.toString("utf8"),
    getContentType: () => contentType || "application/octet-stream",
    setContentType: (t) => { contentType = t; return B; },
    getName: () => name || null,
    setName: (n) => { name = n; return B; },
    copyBlob: () => makeBlob(env, Buffer.from(buf), contentType, name),
    isGoogleType: () => false
  };
  return B;
}
function parseCsv(text, d) {
  const rows = []; let row = []; let cur = ""; let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === d) { row.push(cur); cur = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cur); rows.push(row); row = []; cur = ""; }
    else cur += ch;
  }
  if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

/* ------------------------------------------------------------------ */
/* Session / Logger / console                                          */
/* ------------------------------------------------------------------ */
function createSession(env) {
  const user = (email) => ({ getEmail: () => email || "", getUserLoginId: () => email || "", toString: () => email || "" });
  return {
    getScriptTimeZone: () => env.timeZone,
    getEffectiveUser: () => user(env.ownerEmail),
    getActiveUser: () => user(env.activeUserEmail || ""),
    getActiveUserLocale: () => "en",
    getTemporaryActiveUserKey: () => ""
  };
}
function createLogger(env) {
  const fmt = (args) => {
    if (args.length > 1 && typeof args[0] === "string" && /%s|%d/.test(args[0])) {
      let i = 1; return args[0].replace(/%[sd]/g, () => String(args[i++]));
    }
    return args.map(a => (typeof a === "string" ? a : safeJson(a))).join(" ");
  };
  const L = {
    log: (...a) => { env.log("info", fmt(a)); return L; },
    info: (...a) => { env.log("info", fmt(a)); return L; },
    warning: (...a) => { env.log("warn", fmt(a)); return L; },
    severe: (...a) => { env.log("error", fmt(a)); return L; },
    fine: (...a) => { env.log("debug", fmt(a)); return L; },
    finer: (...a) => L, finest: (...a) => L, config: (...a) => L,
    getLog: () => env.logs.map(l => l.msg).join("\n"),
    clear: () => { env.logs.length = 0; }
  };
  const C = {
    log: (...a) => env.log("info", fmt(a)),
    info: (...a) => env.log("info", fmt(a)),
    warn: (...a) => env.log("warn", fmt(a)),
    error: (...a) => env.log("error", fmt(a)),
    debug: (...a) => env.log("debug", fmt(a)),
    time: () => {}, timeEnd: () => {}, trace: () => {}, dir: (...a) => env.log("info", fmt(a)), table: (...a) => env.log("info", fmt(a)), assert: () => {}
  };
  return { Logger: L, console: C };
}
function safeJson(v) {
  if (v instanceof Error || (v && v.stack && v.message)) return String(v.stack || v.message);
  try { return JSON.stringify(v); } catch (e) { return String(v); }
}

/* ------------------------------------------------------------------ */
/* MailApp / GmailApp — queued and sent after the execution commits    */
/* ------------------------------------------------------------------ */
function createMail(env) {
  const send = (a, b, c, d) => {
    let msg;
    if (a && typeof a === "object") msg = Object.assign({}, a);
    else msg = Object.assign({ to: a, subject: b, body: c }, d || {});
    if (!msg.to && msg.recipient) msg.to = msg.recipient;
    if (!msg.to) throw new env.realm.Error("Exception: Invalid argument: recipient");
    env.mailQueue.push({
      to: String(msg.to), cc: msg.cc ? String(msg.cc) : "", bcc: msg.bcc ? String(msg.bcc) : "",
      subject: String(msg.subject || ""), text: String(msg.body || ""), html: msg.htmlBody ? String(msg.htmlBody) : "",
      name: msg.name ? String(msg.name) : "", replyTo: msg.replyTo ? String(msg.replyTo) : "", project: env.project
    });
  };
  const MailApp = { sendEmail: send, getRemainingDailyQuota: () => 1000 };
  const GmailApp = { sendEmail: (to, subject, body, opts) => { send(to, subject, body, opts); return GmailApp; } };
  return { MailApp, GmailApp };
}

/* ------------------------------------------------------------------ */
/* UrlFetchApp — routes Apps Script web-app URLs of the other projects */
/* to in-process executions. External URLs are not supported.          */
/* ------------------------------------------------------------------ */
function createUrlFetchApp(env) {
  const response = (code, text, headers) => {
    const buf = Buffer.from(String(text || ""), "utf8");
    return {
      getResponseCode: () => code,
      getContentText: () => buf.toString("utf8"),
      getContent: () => env.realm.Array.from(buf, b => (b > 127 ? b - 256 : b)),
      getHeaders: () => Object.assign(new env.realm.Object(), headers || {}),
      getAllHeaders: () => Object.assign(new env.realm.Object(), headers || {}),
      getBlob: () => makeBlob(env, buf, (headers || {})["Content-Type"])
    };
  };
  const fetch = (url, opts) => {
    opts = opts || {};
    const r = env.dispatchUrl(String(url), opts);
    if (!r) throw new env.realm.Error("Exception: UrlFetchApp to external URLs is not available in the Supabase runtime: " + String(url).slice(0, 120));
    if (r.code >= 400 && !opts.muteHttpExceptions) throw new env.realm.Error("Exception: Request failed for " + url + " returned code " + r.code + ". Truncated server response: " + String(r.text).slice(0, 200));
    return response(r.code, r.text, r.headers);
  };
  return { fetch, fetchAll: (reqs) => env.realm.Array.from(reqs.map(q => (typeof q === "string" ? fetch(q) : fetch(q.url, q)))), getRequest: (url, o) => ({ url, ...(o || {}) }) };
}

/* ------------------------------------------------------------------ */
/* ScriptApp                                                           */
/* ------------------------------------------------------------------ */
function createScriptApp(env) {
  const { store } = env;
  const wrapTrigger = (t) => ({
    getHandlerFunction: () => t.handler,
    getUniqueId: () => t.id,
    getEventType: () => t.type,
    getTriggerSource: () => (t.type === "CLOCK" ? "CLOCK" : "SPREADSHEETS"),
    getTriggerSourceId: () => t.source_id || null,
    __id: t.id
  });
  const builder = (handler) => {
    const t = { id: String(Math.floor(Math.random() * 9e15) + 1e15), project: env.project, handler: String(handler), type: null, source_id: null, meta: {} };
    const B = {
      forSpreadsheet: (ss) => { t.source_id = typeof ss === "string" ? ss : ss.getId(); return SB; },
      timeBased: () => { t.type = "CLOCK"; return TB; },
      forDocument: () => { throw new env.realm.Error("Document triggers are not supported."); },
      forForm: () => { throw new env.realm.Error("Form triggers are not supported."); },
      forUserCalendar: () => { throw new env.realm.Error("Calendar triggers are not supported."); }
    };
    const create = () => { env.saveTrigger(t); return wrapTrigger(t); };
    const SB = {
      onEdit: () => { t.type = "ON_EDIT"; return { create }; },
      onChange: () => { t.type = "ON_CHANGE"; return { create }; },
      onOpen: () => { t.type = "ON_OPEN"; return { create }; },
      onFormSubmit: () => { t.type = "ON_FORM_SUBMIT"; return { create }; }
    };
    const TB = {
      everyMinutes: (n) => { t.meta.everyMs = n * 60000; return TB; },
      everyHours: (n) => { t.meta.everyMs = n * 3600000; return TB; },
      everyDays: (n) => { t.meta.everyMs = n * 86400000; return TB; },
      everyWeeks: (n) => { t.meta.everyMs = n * 7 * 86400000; return TB; },
      atHour: (h) => { t.meta.atHour = h; return TB; },
      nearMinute: (m) => { t.meta.nearMinute = m; return TB; },
      onWeekDay: (d) => { t.meta.weekDay = String(d); return TB; },
      onMonthDay: (d) => { t.meta.monthDay = d; return TB; },
      inTimezone: (tz) => { t.meta.tz = tz; return TB; },
      after: (ms) => { t.meta.at = Date.now() + Number(ms); t.meta.once = true; return TB; },
      at: (date) => { t.meta.at = date.getTime(); t.meta.once = true; return TB; },
      create
    };
    return B;
  };
  return {
    getProjectTriggers: () => env.realm.Array.from(store.triggers.filter(t => t.project === env.project).map(wrapTrigger)),
    getUserTriggers: () => env.realm.Array.from(store.triggers.filter(t => t.project === env.project).map(wrapTrigger)),
    newTrigger: builder,
    deleteTrigger: (tr) => env.deleteTrigger(tr && (tr.__id || (tr.getUniqueId && tr.getUniqueId()))),
    getService: () => ({ getUrl: () => env.serviceUrl, isEnabled: () => true }),
    getScriptId: () => env.scriptId,
    getOAuthToken: () => "",
    getIdentityToken: () => "",
    getAuthorizationInfo: () => ({ getAuthorizationStatus: () => "NOT_REQUIRED", getAuthorizationUrl: () => null }),
    invalidateAuth: () => {},
    requireScopes: () => {},
    requireAllScopes: () => {},
    AuthMode: { NONE: "NONE", CUSTOM_FUNCTION: "CUSTOM_FUNCTION", LIMITED: "LIMITED", FULL: "FULL" },
    AuthorizationStatus: { REQUIRED: "REQUIRED", NOT_REQUIRED: "NOT_REQUIRED" },
    EventType: { CLOCK: "CLOCK", ON_OPEN: "ON_OPEN", ON_EDIT: "ON_EDIT", ON_FORM_SUBMIT: "ON_FORM_SUBMIT", ON_CHANGE: "ON_CHANGE" },
    TriggerSource: { SPREADSHEETS: "SPREADSHEETS", CLOCK: "CLOCK", FORMS: "FORMS", DOCUMENTS: "DOCUMENTS", CALENDAR: "CALENDAR" },
    WeekDay: { MONDAY: "MONDAY", TUESDAY: "TUESDAY", WEDNESDAY: "WEDNESDAY", THURSDAY: "THURSDAY", FRIDAY: "FRIDAY", SATURDAY: "SATURDAY", SUNDAY: "SUNDAY" }
  };
}

/* ------------------------------------------------------------------ */
/* HtmlService / ContentService                                        */
/* ------------------------------------------------------------------ */
function createHtmlService(env) {
  const output = (content) => {
    const o = { __html: true, content: String(content || ""), title: "", meta: [], favicon: "" };
    const H = {
      __out: o,
      getContent: () => o.content,
      setContent: (c) => { o.content = String(c); return H; },
      append: (c) => { o.content += String(c); return H; },
      appendUntrusted: (c) => { o.content += String(c).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch])); return H; },
      setTitle: (t) => { o.title = String(t); return H; },
      getTitle: () => o.title,
      addMetaTag: (n, c) => { o.meta.push([String(n), String(c)]); return H; },
      setFaviconUrl: (u) => { o.favicon = String(u); return H; },
      setXFrameOptionsMode: () => H, setSandboxMode: () => H, setWidth: () => H, setHeight: () => H,
      asTemplate: () => template(o.content)
    };
    return H;
  };
  const template = (src) => {
    const T = {
      evaluate: () => output(evaluateTemplate(src, T, env)),
      getRawContent: () => src,
      getCode: () => src
    };
    return T;
  };
  return {
    createTemplateFromFile: (name) => template(env.readHtmlFile(name)),
    createTemplate: (src) => template(String(src && src.getDataAsString ? src.getDataAsString() : src)),
    createHtmlOutputFromFile: (name) => output(env.readHtmlFile(name)),
    createHtmlOutput: (src) => output(src === undefined ? "" : src && src.getDataAsString ? src.getDataAsString() : src),
    XFrameOptionsMode: { ALLOWALL: "ALLOWALL", DEFAULT: "DEFAULT" },
    SandboxMode: { EMULATED: "EMULATED", IFRAME: "IFRAME", NATIVE: "NATIVE" }
  };
}
/** Minimal scriptlet support (<?= ?>, <?!= ?>, <? ?>); the portal HTML uses none. */
function evaluateTemplate(src, T, env) {
  if (!/<\?/.test(src)) return src;
  return env.evalTemplate(src, T);
}
function createContentService(env) {
  return {
    createTextOutput: (text) => {
      let content = text === undefined ? "" : String(text), mime = "text/plain";
      const O = {
        __text: true,
        getContent: () => content,
        setContent: (c) => { content = String(c); return O; },
        append: (c) => { content += String(c); return O; },
        setMimeType: (m) => { mime = m; return O; },
        getMimeType: () => mime,
        downloadAsFile: () => O,
        getFileName: () => null
      };
      return O;
    },
    MimeType: { JSON: "application/json", TEXT: "text/plain", CSV: "text/csv", XML: "application/xml", JAVASCRIPT: "application/javascript", ATOM: "application/atom+xml", RSS: "application/rss+xml", ICAL: "text/calendar", VCARD: "text/vcard" }
  };
}

module.exports = {
  createPropertiesService, createCacheService, createLockService, createUtilities, createSession,
  createLogger, createMail, createUrlFetchApp, createScriptApp, createHtmlService, createContentService,
  CACHES
};
