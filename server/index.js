"use strict";
process.env.TZ = process.env.TZ || "Asia/Kolkata";

/**
 * Interview Operations Portal server: one Google sign-in for two portals.
 *
 *   GET  /                    home (super admin dashboard, People)       public/app.html
 *   /app/api/*                sign-in cookie, People, home figures
 *   GET  /ttop/               TTOP (static page; data protected by TTOP's RLS)
 *   /api/*                    TTOP's functions (config, doc sync, inbox, push alerts)
 *   GET  /callpilots/         Call Pilots Operations Portal (static page; every read and
 *                             write goes through the cp_* SQL functions with the user's JWT)
 *   /dhruva/*, /call-pilots/* old addresses, redirected to /callpilots/
 *   GET  /healthz             health check
 *
 * No Apps Script runtime and no in-memory data: a new server copy starts at once.
 */
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
loadDotEnv(path.join(ROOT, ".env"));

const PORT = Number(process.env.PORT || 8080);
const PUBLIC_URL = (process.env.PUBLIC_URL || "http://localhost:" + PORT).replace(/\/$/, "");
const MAX_BODY = 10 * 1024 * 1024;
const log = console;
const SECURE_COOKIE = /^https:/i.test(PUBLIC_URL);

/* ------------------------------------------------------------------ */
/* Supabase REST with the service key (server only)                    */
/* ------------------------------------------------------------------ */
async function rest(method, p, body, extra) {
  const url = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  for (let attempt = 1; ; attempt++) {
    let res;
    try {
      res = await fetch(url + "/rest/v1/" + p, {
        method,
        headers: Object.assign({ apikey: key, Authorization: "Bearer " + key, "Content-Type": "application/json" }, extra || {}),
        body: body === undefined ? undefined : JSON.stringify(body)
      });
    } catch (e) {
      if (attempt < 3) { await sleep(400 * attempt); continue; }
      throw e;
    }
    const text = await res.text();
    if (!res.ok) {
      if (res.status >= 500 && attempt < 3) { await sleep(400 * attempt); continue; }
      throw new Error("Supabase " + method + " " + p.split("?")[0] + " -> " + res.status + ": " + text.slice(0, 500));
    }
    return text ? JSON.parse(text) : null;
  }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/* ------------------------------------------------------------------ */
/* HTTP helpers                                                        */
/* ------------------------------------------------------------------ */
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
function redirect(res, to, code) { res.writeHead(code || 302, { Location: to, "Cache-Control": "no-store" }); res.end(); }
function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
}

/* ------------------------------------------------------------------ */
/* Sign-in, portals                                                    */
/* ------------------------------------------------------------------ */
const { createAuth } = require("./app/auth");
const { createTtop } = require("./app/ttop");
const { createAdmin } = require("./app/admin");
const ttop = createTtop({ root: ROOT, log });
const admin = createAdmin({ rest, log });
let auth = null;

/** Web address of each portal (portal ids are stored in app_users.portals). */
const PORTAL_PATH = { ttop: "/ttop/", callpilots: "/callpilots/" };
const CALLPILOTS_DIR = path.join(ROOT, "portals", "callpilots");

/** Page gate: signed in + allowed to open this portal, else back to the home page. */
async function pageGate(req, res, portal) {
  const u = await auth.current(req);
  if (u && auth.canOpen(u, portal)) return u;
  redirect(res, "/?next=" + encodeURIComponent(PORTAL_PATH[portal]));
  return null;
}

function serveCallPilots(res) {
  const file = path.join(CALLPILOTS_DIR, "index.html");
  if (fs.existsSync(file)) return sendHtml(res, 200, fs.readFileSync(file, "utf8"));
  // the new portal is being built (docs/CALLPILOTS_PLAN.md, phases 3 and 4)
  sendHtml(res, 200, '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Call Pilots Operations Portal</title><body style="font-family:system-ui,sans-serif;margin:0;background:#f4f6fb;color:#0f172a">' +
    '<div style="max-width:560px;margin:12vh auto;padding:24px;background:#fff;border-radius:16px;box-shadow:0 2px 12px #0001">' +
    '<h1 style="font-size:22px;margin:0 0 8px">Call Pilots Operations Portal</h1>' +
    '<p style="color:#475569;line-height:1.5">The new Call Pilots portal is being built on TTOP. It will be available here soon.</p>' +
    '<p><a href="/">Back to the home page</a></p></div></body>');
}

function publicUser(u) {
  return { email: u.email, name: u.name || "", role: u.role, portals: u.role === "super_admin" ? ["ttop", "callpilots"] : (u.portals || []),
    cpTeams: u.role === "super_admin" ? auth.TEAMS.slice() : (u.cp_teams || []), access: auth.access(u) };
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
    return sendJson(res, 200, { ok: true, user: publicUser(u) });
  }
  if (sub === "logout") { res.setHeader("Set-Cookie", auth.clearCookie()); return sendJson(res, 200, { ok: true }); }
  const me = await auth.current(req);
  if (!me) return sendJson(res, 401, { ok: false, error: "Signed out" });
  if (sub === "me") return sendJson(res, 200, { ok: true, user: publicUser(me) });
  if (sub === "users") {
    if (me.role === "user") return sendJson(res, 403, { ok: false, error: "Not allowed" });
    try {
      if (req.method === "GET") {
        const all = await auth.loadUsers(true);
        const list = [...all.values()]
          .filter(u => { const mine = auth.access(me); return me.role === "super_admin" || auth.access(u).some(k => mine.includes(k)); })
          .map(u => Object.assign(publicUser(u), { active: u.active, lastLogin: u.last_login_at || null, canEdit: auth.mayManage(me, u, u) }));
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
  if (sub === "overview") {
    if (me.role !== "super_admin") return sendJson(res, 403, { ok: false, error: "Super admins only" });
    try { return sendJson(res, 200, Object.assign({ ok: true }, await admin.overview())); }
    catch (e) { log.error("[admin] overview: " + (e.stack || e)); return sendJson(res, 500, { ok: false, error: e.message }); }
  }
  sendJson(res, 404, { ok: false, error: "Not found" });
}

/** SUPER_ADMIN_EMAILS: people who are always super admins (needed on a new, empty database). */
async function ensureSuperAdmins() {
  const want = String(process.env.SUPER_ADMIN_EMAILS || "").toLowerCase().split(",").map(s => s.trim()).filter(e => /^[^@\s]+@[^@\s]+$/.test(e));
  if (!want.length) return;
  const all = await auth.loadUsers(true);
  const rows = want.filter(e => !all.has(e) || all.get(e).role !== "super_admin" || !all.get(e).active)
    .map(e => ({ email: e, name: (all.get(e) && all.get(e).name) || null, role: "super_admin", portals: ["ttop", "callpilots"], active: true, updated_by: "SUPER_ADMIN_EMAILS" }));
  if (!rows.length) return;
  await rest("POST", "app_users?on_conflict=email", rows, { Prefer: "resolution=merge-duplicates,return=minimal" });
  await auth.loadUsers(true);
  log.log("[boot] super admins from SUPER_ADMIN_EMAILS: " + rows.map(r => r.email).join(", "));
}

/* ------------------------------------------------------------------ */
/* Routes                                                              */
/* ------------------------------------------------------------------ */
async function handle(req, res) {
  const p = req.url.split("?")[0];
  const q = req.url.includes("?") ? "?" + req.url.split("?").slice(1).join("?") : "";
  try {
    if (p === "/healthz") return sendJson(res, 200, { ok: true });
    if (p === "/" && req.method === "GET") return sendHtml(res, 200, fs.readFileSync(path.join(ROOT, "public", "app.html"), "utf8"));
    let m = /^\/app\/api\/([\w-]+)$/.exec(p);
    if (m) return await appApi(req, res, m[1]);
    // Call Pilots
    if ((p === "/callpilots" || p === "/callpilots/" || p === "/callpilots/index.html") && req.method === "GET") {
      if (await pageGate(req, res, "callpilots")) return serveCallPilots(res);
      return;
    }
    if (p === "/dhruva" || p.startsWith("/dhruva/") || p === "/call-pilots" || p.startsWith("/call-pilots/")) return redirect(res, "/callpilots/" + q, 301);
    // TTOP (page gated; its data is protected by TTOP's own row-level security)
    if (p === "/ttop" || p === "/ttop/" || p === "/ttop/index.html") { if (await pageGate(req, res, "ttop")) ttop.serveStatic(req, res, p); return; }
    if (ttop.serveStatic(req, res, p)) return;
    if (p.startsWith("/api/") && await ttop.serveApi(req, res, p, readBody)) return;
    sendJson(res, 404, { ok: false, error: "Not found" });
  } catch (e) {
    log.error("[http] " + req.method + " " + p + ":", e && e.stack || e);
    if (!res.headersSent) sendJson(res, 500, { ok: false, error: { message: String(e && e.message || e) } });
  }
}

/** One-time start of this server copy (on Vercel: the first request of a new instance). */
let readyPromise = null;
function ready() {
  if (!readyPromise) readyPromise = init().catch((e) => { readyPromise = null; throw e; });
  return readyPromise;
}
async function init() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  auth = createAuth({
    supabaseUrl: process.env.SUPABASE_URL.replace(/\/$/, ""), serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    anonKey: process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, secret: process.env.APP_SECRET, rest, log
  });
  await ensureSuperAdmins().catch(e => log.error("[boot] SUPER_ADMIN_EMAILS: " + e.message));
}

const server = http.createServer((req, res) => { ready().then(() => handle(req, res), (e) => sendJson(res, 500, { ok: false, error: "Server failed to start: " + e.message })); });

/** Local mode (`npm start`). */
async function main() {
  await ready();
  server.listen(PORT, () => log.log("[boot] Interview Operations Portal running at " + PUBLIC_URL + "  (home /, TTOP /ttop/, Call Pilots /callpilots/)"));
}
if (require.main === module) main().catch(e => { log.error(e); process.exit(1); });

/** Vercel entry: api/index.js calls this for every request. */
async function vercelHandler(req, res) {
  try { await ready(); }
  catch (e) { log.error("[boot] " + (e && e.stack || e)); return sendJson(res, 500, { ok: false, error: "Server failed to start: " + e.message }); }
  return handle(req, res);
}

module.exports = { server, main, ready, handle, vercelHandler, get auth() { return auth; } };
