"use strict";
/**
 * Dhruva single sign-on.
 * After Google sign-in, the Dhruva page needs its own portal session token
 * (localStorage "interview_portal_session"). We create it with Dhruva's own
 * functions (PA_getAuthorizedUserByEmail_, PA_createSession_), so Dhruva's
 * logic decides who the person is inside Dhruva, exactly as after an email code.
 *
 * Role ceiling: the app role caps the Dhruva role.
 *   user        -> may not hold ADMIN or SUPER_ADMIN in Dhruva
 *   admin       -> may not hold SUPER_ADMIN in Dhruva
 *   super_admin -> any Dhruva role
 */
const vm = require("vm");

const PRIVATE_BACKEND = "1Q5pRPoLsSjfxuRfEUZW2zZqrURYPzzbbPO6_8r9CLCk";
const CEILING = { user: ["SUPER_ADMIN", "ADMIN"], admin: ["SUPER_ADMIN"], super_admin: [] };

function createDhruvaSso({ runtime, store }) {
  /** Roles Dhruva gives this email (V2 User Access + active V2 User Roles). */
  function dhruvaRoles(email) {
    email = String(email || "").toLowerCase();
    const wb = store.workbook(PRIVATE_BACKEND);
    if (!wb) return { known: false, active: false, roles: [] };
    const read = (name) => {
      const s = wb.sheets.find(x => x.name === name);
      if (!s || !s.rows[0]) return [];
      const head = s.rows[0].v.map(h => String(h || "").trim().toLowerCase());
      return s.rows.slice(1).filter(Boolean).map(r => Object.fromEntries(head.map((h, i) => [h, r.v[i]])));
    };
    const yes = (v) => v === true || /^(true|yes|y|1)$/i.test(String(v || "").trim());
    const access = read("V2 User Access").filter(r => String(r.email || "").trim().toLowerCase() === email);
    const roles = new Set();
    let active = false, name = "";
    for (const a of access) {
      if (yes(a.active)) { active = true; if (a.role) roles.add(String(a.role).trim().toUpperCase()); }
      name = name || String(a["official name"] || "");
    }
    for (const r of read("V2 User Roles")) {
      if (String(r.email || "").trim().toLowerCase() === email && yes(r.active) && r.role) roles.add(String(r.role).trim().toUpperCase());
    }
    return { known: access.length > 0, active, roles: [...roles], name };
  }

  function ceilingProblem(appUser, info) {
    const blocked = (CEILING[appUser.role] || []).filter(r => info.roles.includes(r));
    if (!blocked.length) return null;
    return "Your Dhruva account has the " + blocked.join(" / ") + " role, which is above your app role (" + appUser.role.replace("_", " ") +
      "). Ask a super admin to change your role in Dhruva Administration or on the app's Access page.";
  }

  /** Returns { token } or { error }. Keeps the browser's current Dhruva token when it is still valid for this person. */
  async function session(appUser, currentToken) {
    const info = dhruvaRoles(appUser.email);
    if (!info.known || !info.active) return { error: "Your email is not set up as an active user in the Dhruva portal yet. Ask a super admin to add you in Dhruva Administration." };
    const problem = ceilingProblem(appUser, info);
    if (problem) return { error: problem };
    const r = await runtime.run("portal", null, null, {
      run: (c) => {
        c.sandbox.__sso = JSON.stringify({ email: appUser.email, current: currentToken || "" });
        return vm.runInContext(
          "(function(){ var a = JSON.parse(__sso);" +
          " if (a.current) { var v = PA_validateSession_(a.current);" +
          "   if (v && v.ok && v.user && String(v.user.email || '').toLowerCase() === a.email) return JSON.stringify({ token: a.current, kept: true }); }" +
          " var u = PA_getAuthorizedUserByEmail_(a.email);" +
          " if (!u) return JSON.stringify({ error: 'NOT_AUTHORIZED_IN_DHRUVA' });" +
          " var s = PA_createSession_(u, true); return JSON.stringify({ token: s.token }); })()",
          c.ctx, { timeout: 30000 });
      }
    });
    try { await r.persisted; } catch (e) { return { error: "Could not save the Dhruva session: " + e.message }; }
    if (!r.ok) return { error: "Dhruva sign-in failed: " + (r.error && r.error.message) };
    const out = JSON.parse(r.value);
    if (out.error === "NOT_AUTHORIZED_IN_DHRUVA") return { error: "Dhruva does not allow this email to sign in. Ask a super admin to check it in Dhruva Administration." };
    return out;
  }

  /** Dhruva users for seeding app_users (V2 User Access, active rows). */
  function dhruvaUsers() {
    const wb = store.workbook(PRIVATE_BACKEND);
    const s = wb && wb.sheets.find(x => x.name === "V2 User Access");
    if (!s || !s.rows[0]) return [];
    const emails = new Set();
    for (const r of s.rows.slice(1)) {
      if (!r) continue;
      const e = String(r.v[1] || "").trim().toLowerCase();
      if (e.includes("@")) emails.add(e);
    }
    return [...emails].map(e => Object.assign({ email: e }, dhruvaRoles(e))).filter(u => u.active);
  }

  return { session, dhruvaRoles, dhruvaUsers, ceilingProblem };
}

module.exports = { createDhruvaSso };
