/* ============================================================
   TTOP – audit.js
   PRD V3 §30 Audit Log: record important changes, not editable by
   normal users. This listens ONCE to Storage's change events (which
   now carry before/after snapshots — see storage.js) and generically
   diffs whatever collection changed, for every module in the app,
   without any module needing to call an audit function itself.
   ============================================================ */

const Audit = (() => {

  const TRACKED = { candidates: "Candidate", interviews: "Interview", assessments: "Assessment", incentives: "Incentive", clients: "Client" };
  const IGNORE_FIELDS = new Set(["id"]);
  let state = { collection: "", user: "", from: "", to: "" };

  function labelFor(collection, rec) {
    if (!rec) return "—";
    return rec.name || rec.candidateName || rec.candidate || rec.client || rec.id;
  }

  function diff(before, after) {
    const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
    const changes = [];
    keys.forEach(k => {
      if (IGNORE_FIELDS.has(k)) return;
      const a = before ? before[k] : undefined, b = after ? after[k] : undefined;
      if (String(a ?? "") !== String(b ?? "")) changes.push(`${k}: "${a ?? "—"}" → "${b ?? "—"}"`);
    });
    return changes;
  }

  function record(ev) {
    const kind = TRACKED[ev.collection];
    if (!kind) return; // only audit the entities the PRD calls out — not activity/auditLog/settings themselves

    let action, summary;
    if (ev.op === "delete") {
      action = "Deleted";
      summary = `${kind} "${labelFor(ev.collection, ev.before)}" was deleted.`;
    } else if (!ev.before) {
      action = "Created";
      summary = `New ${kind.toLowerCase()} "${labelFor(ev.collection, ev.after)}" was created.`;
    } else {
      const changes = diff(ev.before, ev.after);
      if (!changes.length) return; // no actual field changed (e.g. a no-op save) — nothing worth logging
      action = "Updated";
      summary = changes.join("; ");
    }

    const me = (typeof Auth !== "undefined" && Auth.currentUser()) || { name: "Unknown" };
    Storage.insert("auditLog", {
      id: Utils.generateId("AUD"), ts: new Date().toISOString(), changedBy: me.name, collection: kind,
      recordLabel: labelFor(ev.collection, ev.after || ev.before), action, summary
    });
    if (document.getElementById("page-audit")?.classList.contains("is-active")) render();
  }

  function matches(row) {
    if (state.collection && row.collection !== state.collection) return false;
    if (state.user && row.changedBy !== state.user) return false;
    const day = (row.ts || "").slice(0, 10);
    if (state.from && day < state.from) return false;
    if (state.to && day > state.to) return false;
    return true;
  }

  function render() {
    const host = document.getElementById("auditLogTableBody");
    if (!host) return;
    const rows = Storage.getAll("auditLog").filter(matches).sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, 300);
    host.innerHTML = rows.map(r => `
      <tr>
        <td data-label="When">${Utils.timeAgo(r.ts)}</td>
        <td data-label="Changed By">${Utils.escapeHtml(r.changedBy)}</td>
        <td data-label="Type">${Utils.escapeHtml(r.collection)}</td>
        <td data-label="Record">${Utils.escapeHtml(r.recordLabel)}</td>
        <td data-label="Action"><span class="badge ${Utils.statusBadgeClass(r.action)}">${r.action}</span></td>
        <td data-label="Changes">${Utils.escapeHtml(r.summary)}</td>
      </tr>`).join("") || `<tr><td colspan="6" class="empty-hint">No audit entries match these filters yet.</td></tr>`;
  }

  function populateFilters() {
    const rows = Storage.getAll("auditLog");
    const userSel = document.getElementById("auditFilterUser");
    if (userSel) userSel.innerHTML = `<option value="">All Users</option>` + [...new Set(rows.map(r => r.changedBy))].filter(Boolean).sort()
      .map(u => `<option value="${Utils.escapeHtml(u)}">${Utils.escapeHtml(u)}</option>`).join("");
  }

  function exportCSV() {
    const rows = Storage.getAll("auditLog").filter(matches);
    const csv = Utils.toCSV(rows, [
      { key: "ts", label: "Timestamp" }, { key: "changedBy", label: "Changed By" }, { key: "collection", label: "Type" },
      { key: "recordLabel", label: "Record" }, { key: "action", label: "Action" }, { key: "summary", label: "Changes" }
    ]);
    Utils.downloadFile(`ttop-audit-log-${Utils.dateISO()}.csv`, csv, "text/csv");
  }

  function bind() {
    document.getElementById("auditFilterType")?.addEventListener("change", e => { state.collection = e.target.value; render(); });
    document.getElementById("auditFilterUser")?.addEventListener("change", e => { state.user = e.target.value; render(); });
    document.getElementById("auditFrom")?.addEventListener("change", e => { state.from = e.target.value; render(); });
    document.getElementById("auditTo")?.addEventListener("change", e => { state.to = e.target.value; render(); });
    document.getElementById("auditExportCsv")?.addEventListener("click", exportCSV);
  }

  function init() {
    Storage.onChange(record);
    bind();
    populateFilters();
    render();
  }

  return { init, render, populateFilters };
})();
