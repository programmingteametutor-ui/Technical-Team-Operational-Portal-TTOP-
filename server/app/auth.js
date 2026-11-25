"use strict";
/**
 * Combined-app sign-in and roles.
 *
 * - People sign in with Google through Supabase Auth (the same sign-in TTOP uses).
 * - The home page sends the Supabase access token once to /app/api/login; the
 *   server checks it with Supabase and sets a signed, HttpOnly session cookie.
 * - app_users (Supabase) says who may open which portal:
 *     super_admin -> both portals;  admin -> their portal(s);  user -> their portal(s)
 */
const crypto = require("crypto");

const COOKIE = "iop_session";
const SESSION_HOURS = Number(process.env.APP_SESSION_HOURS || 12);
const ROLES = ["super_admin", "admin", "user"];
const PORTALS = ["ttop", "callpilots"];

function createAuth({ supabaseUrl, serviceKey, anonKey, secret, rest, log }) {
  if (!secret) throw new Error("APP_SECRET is required (any long random text)");
  const tokenCache = new Map();  // supabase access token -> {email, exp}
  let users = null, usersAt = 0;

  /* ---------------- signed cookie ---------------- */
  const sign = (s) => crypto.createHmac("sha256", secret).update(s).digest("base64url");
  function makeCookie(email, secure) {
    const exp = Date.now() + SESSION_HOURS * 3600000;
    const payload = Buffer.from(JSON.stringify({ e: email, x: exp })).toString("base64url");
    const v = payload + "." + sign(payload);
    return COOKIE + "=" + v + "; Path=/; HttpOnly; SameSite=Lax; Max-Age=" + SESSION_HOURS * 3600 + (secure ? "; Secure" : "");
  }
  function clearCookie() { return COOKIE + "=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0"; }
  function readCookie(req) {
    const raw = String(req.headers.cookie || "").split(/;\s*/).find(c => c.startsWith(COOKIE + "="));
    if (!raw) return null;
    const v = raw.slice(COOKIE.length + 1);
    const [payload, sig] = v.split(".");
    if (!payload || !sig) return null;
    const a = Buffer.from(sign(payload)), b = Buffer.from(sig);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    try {
      const o = JSON.parse(Buffer.from(payload, "base64url").toString());
      if (!o.e || !(o.x > Date.now())) return null;
      return { email: String(o.e).toLowerCase(), exp: o.x };
    } catch (e) { return null; }
  }

  /* ---------------- Supabase token -> email ---------------- */
  async function emailFromSupabaseToken(token) {
    if (!token) return null;
    const c = tokenCache.get(token);
    if (c && c.exp > Date.now()) return c.email;
    const r = await fetch(supabaseUrl + "/auth/v1/user", { headers: { apikey: anonKey || serviceKey, Authorization: "Bearer " + token } });
    if (!r.ok) return null;
    const u = await r.json();
    const email = u && u.email ? String(u.email).toLowerCase() : null;
    if (email) tokenCache.set(token, { email, exp: Date.now() + 60000 });
    if (tokenCache.size > 2000) tokenCache.clear();
    return email;
  }

  /* ---------------- app_users ---------------- */
  async function loadUsers(force) {
    if (!force && users && Date.now() - usersAt < 15000) return users;
    const cols = "email,name,role,portals,active,updated_by,updated_at";
    // last_login_at arrives with migration 6; keep working on a database without it
    const rows = await rest("GET", "app_users?select=" + cols + ",last_login_at&order=email").catch(() => rest("GET", "app_users?select=" + cols + "&order=email"));
    users = new Map(rows.map(u => [u.email, u]));
    usersAt = Date.now();
    return users;
  }
  async function getUser(email) {
    if (!email) return null;
    const u = (await loadUsers()).get(String(email).toLowerCase());
    return u && u.active ? u : null;
  }
  const canOpen = (u, portal) => !!u && u.active && (u.role === "super_admin" || (u.portals || []).includes(portal));

  /** Who is calling? cookie session + active app user. */
  async function current(req) {
    const s = readCookie(req);
    if (!s) return null;
    const u = await getUser(s.email);
    return u ? Object.assign({}, u, { session: s }) : null;
  }

  /* ---------------- user management rules ---------------- */
  // super_admin: anyone, any role, any portal.
  // admin: only people whose portals are within the admin's own portals, only role 'user'.
  function mayManage(actor, target, next) {
    if (!actor) return false;
    if (actor.role === "super_admin") return true;
    if (actor.role !== "admin") return false;
    const mine = actor.portals || [];
    const within = (u) => !u || ((u.role === "user") && (u.portals || []).every(p => mine.includes(p)));
    return within(target) && within(next) && (!next || (next.portals || []).length > 0);
  }
  async function saveUser(actor, input) {
    const email = String(input.email || "").trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw httpError(400, "Enter a valid email");
    const role = ROLES.includes(input.role) ? input.role : "user";
    const portals = (Array.isArray(input.portals) ? input.portals : []).filter(p => PORTALS.includes(p));
    if (role !== "super_admin" && !portals.length && input.active !== false) throw httpError(400, "Choose at least one portal");
    const all = await loadUsers(true);
    const existing = all.get(email) || null;
    const next = { email, role, portals, active: input.active !== false };
    if (!mayManage(actor, existing, next)) throw httpError(403, actor.role === "admin" ? "Admins can only manage users of their own portal" : "Not allowed");
    if (actor.email === email && (role !== actor.role || !next.active)) throw httpError(400, "You cannot change your own role or switch yourself off");
    if (existing && existing.role === "super_admin" && role !== "super_admin" && countSuper(all) <= 1) throw httpError(400, "Keep at least one super admin");
    await rest("POST", "app_users?on_conflict=email", [{ email, name: String(input.name || (existing && existing.name) || "").trim() || null, role, portals, active: next.active, updated_by: actor.email }], { Prefer: "resolution=merge-duplicates,return=minimal" });
    await loadUsers(true);
    return (await loadUsers()).get(email);
  }
  async function deleteUser(actor, email) {
    email = String(email || "").toLowerCase();
    const all = await loadUsers(true);
    const existing = all.get(email);
    if (!existing) return;
    if (!mayManage(actor, existing, null)) throw httpError(403, "Not allowed");
    if (actor.email === email) throw httpError(400, "You cannot remove yourself");
    if (existing.role === "super_admin" && countSuper(all) <= 1) throw httpError(400, "Keep at least one super admin");
    await rest("DELETE", "app_users?email=eq." + encodeURIComponent(email), undefined, { Prefer: "return=minimal" });
    await loadUsers(true);
  }
  const countSuper = (all) => [...all.values()].filter(u => u.role === "super_admin" && u.active).length;

  return { makeCookie, clearCookie, readCookie, emailFromSupabaseToken, loadUsers, getUser, canOpen, current, mayManage, saveUser, deleteUser, ROLES, PORTALS };
}

function httpError(status, message) { const e = new Error(message); e.status = status; return e; }

module.exports = { createAuth, httpError };
