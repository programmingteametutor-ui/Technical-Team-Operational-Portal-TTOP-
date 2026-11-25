"use strict";
/**
 * Super admin home: figures from both portals and sign-up requests.
 * Everything is computed in SQL (TTOP: app_dashboard_ttop, Call Pilots:
 * app_dashboard_callpilots), called with the service key.
 */
function createAdmin({ rest, log }) {
  const istDay = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

  async function overview() {
    const now = new Date();
    const today = istDay();
    const [ttop, callpilots, users] = await Promise.all([
      rest("POST", "rpc/app_dashboard_ttop", { p_today: today }).then(v => ({ v }), e => ({ e: e.message })),
      rest("POST", "rpc/app_dashboard_callpilots", {}).then(v => ({ v }), e => ({ e: e.message })),
      userCounts().then(v => ({ v }), e => ({ e: e.message }))
    ]);
    if (callpilots.e) log.warn("[admin] Call Pilots figures: " + callpilots.e);
    return {
      today, generatedAt: now.toISOString(),
      ttop: ttop.v || null, ttopError: ttop.e || null,
      callpilots: callpilots.v || null, callpilotsError: callpilots.e || null,
      users: users.v || { error: users.e }
    };
  }

  async function userCounts() {
    const all = await rest("GET", "app_users?select=email,role,portals,active,last_login_at");
    const since = Date.now() - 7 * 86400000;
    return {
      total: all.filter(u => u.active).length,
      superAdmins: all.filter(u => u.active && u.role === "super_admin").length,
      admins: all.filter(u => u.active && u.role === "admin").length,
      users: all.filter(u => u.active && u.role === "user").length,
      activeWeek: all.filter(u => u.last_login_at && Date.parse(u.last_login_at) > since).length,
      pending: (await pendingSignups()).length
    };
  }

  async function pendingSignups() {
    try { return (await rest("POST", "rpc/app_pending_signups", {})) || []; }
    catch (e) { return []; }
  }

  return { overview, pendingSignups };
}

module.exports = { createAdmin };
