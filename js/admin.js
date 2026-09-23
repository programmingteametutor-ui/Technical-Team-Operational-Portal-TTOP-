/* ============================================================
   TTOP – admin.js
   Admin-only "Users" page: approve/reject new sign-ins and
   promote/demote admins. Backed by the Users sheet via
   apps-script/Code.gs (listUsers / setUserStatus / setUserRole).
   ============================================================ */

const AdminUsers = (() => {
  let cache = [];

  async function load() {
    const host = document.getElementById("adminUsersHost");
    if (!host || !Auth.isAdmin()) return;
    host.innerHTML = `<p class="muted">Loading…</p>`;
    const out = await Drive.callRaw({ action: "listUsers" });
    if (!out.ok) { host.innerHTML = `<p class="auth-card__error">${Utils.escapeHtml(out.error || "Could not load users.")}</p>`; return; }
    cache = out.users || [];
    render();
  }

  function render() {
    const host = document.getElementById("adminUsersHost");
    if (!host) return;
    if (!cache.length) { host.innerHTML = `<p class="muted">Nobody has signed in yet.</p>`; return; }

    const rank = s => (s === "pending" ? 0 : s === "approved" ? 1 : 2);
    const rows = cache.slice().sort((a, b) => rank(String(a.Status).toLowerCase()) - rank(String(b.Status).toLowerCase()));
    const pendingCount = rows.filter(u => String(u.Status).toLowerCase() === "pending").length;

    host.innerHTML = `
      ${pendingCount ? `<div class="admin-alert">🔔 ${pendingCount} account${pendingCount > 1 ? "s" : ""} waiting for approval</div>` : ""}
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Requested</th><th>Actions</th></tr></thead>
          <tbody>
            ${rows.map(u => `
              <tr>
                <td>${Utils.escapeHtml(u.Name || "")}</td>
                <td>${Utils.escapeHtml(u.Email || "")}</td>
                <td>
                  <select class="select-sm admin-role" data-email="${Utils.escapeHtml(u.Email)}">
                    <option value="user" ${String(u.Role).toLowerCase() !== "admin" ? "selected" : ""}>user</option>
                    <option value="admin" ${String(u.Role).toLowerCase() === "admin" ? "selected" : ""}>admin</option>
                  </select>
                </td>
                <td><span class="status-pill status-pill--${String(u.Status).toLowerCase()}">${Utils.escapeHtml(u.Status || "")}</span></td>
                <td>${Utils.escapeHtml(String(u["Requested At"] || "").slice(0, 10))}</td>
                <td class="admin-actions">
                  ${String(u.Status).toLowerCase() !== "approved" ? `<button class="btn btn--secondary btn--sm admin-approve" data-email="${Utils.escapeHtml(u.Email)}">Approve</button>` : ""}
                  ${String(u.Status).toLowerCase() !== "rejected" ? `<button class="btn btn--ghost btn--sm admin-reject" data-email="${Utils.escapeHtml(u.Email)}">Reject</button>` : ""}
                </td>
              </tr>`).join("")}
          </tbody>
        </table>
      </div>`;
    bindRows();
  }

  function bindRows() {
    document.querySelectorAll(".admin-approve").forEach(btn => btn.addEventListener("click", () => setStatus(btn.dataset.email, "approved")));
    document.querySelectorAll(".admin-reject").forEach(btn => btn.addEventListener("click", () => setStatus(btn.dataset.email, "rejected")));
    document.querySelectorAll(".admin-role").forEach(sel => sel.addEventListener("change", () => setRole(sel.dataset.email, sel.value)));
  }

  async function setStatus(email, status) {
    const out = await Drive.callRaw({ action: "setUserStatus", email, status });
    if (!out.ok) { Utils.toast(out.error || "Could not update that user.", "error"); return; }
    Utils.toast(`${email} ${status}.`, "success");
    load();
  }

  async function setRole(email, role) {
    const out = await Drive.callRaw({ action: "setUserRole", email, role });
    if (!out.ok) { Utils.toast(out.error || "Could not update that user's role.", "error"); return; }
    Utils.toast(`${email} is now ${role}.`, "success");
    load();
  }

  function init() {
    document.getElementById("btnRefreshUsers")?.addEventListener("click", load);
  }

  return { init, load };
})();
