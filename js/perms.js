/* ============================================================
   TTOP – perms.js
   Backs the "Assigned User" field on Candidates (PRD §3–4, §31):
   who a candidate — and, by extension, their interviews/assessments/
   incentives — belongs to. Actual enforcement happens server-side
   in apps-script/Code.gs (a non-admin's browser never receives another
   user's rows at all); this module just supplies the picker with the
   list of approved users, since only admins may reassign.
   ============================================================ */

const Perms = (() => {
  let users = []; // [{ email, name }] — approved users only

  async function loadUsers() {
    const out = await Drive.callRaw({ action: "listActiveUsers" });
    if (out && out.ok) users = out.users || [];
    return users;
  }

  function cached() { return users; }

  /** email -> display name, falling back to the email itself if we don't have the name cached yet */
  function nameFor(email) {
    if (!email) return "";
    const u = users.find(u => u.email.toLowerCase() === email.toLowerCase());
    return u ? u.name : email;
  }

  function canReassign() { return Auth.isAdmin(); }

  return { loadUsers, cached, nameFor, canReassign };
})();
