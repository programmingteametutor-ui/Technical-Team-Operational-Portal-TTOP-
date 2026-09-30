/* ============================================================
   TTOP – clients.js
   Clients are now a real entity (PRD V3 §12–14), not just a free-typed
   "Company/Client" string on Interviews/Assessments.

   - Full CRUD grid + a lightweight "Client 360" profile (counts +
     linked Candidates/Assessments/Interviews), same pattern as
     candidates.js.
   - Interviews/Assessments still just type a client name (with the
     Clients list offered via a shared <datalist>, see refreshDatalist
     below). Whenever one of those records is saved, reconcileClientName()
     runs automatically (via Storage.onChange) so a Client record always
     exists for whatever name was typed — without touching interviews.js
     or assessments.js at all.
   - Existing Client Detection (PRD §14): if the typed name doesn't
     exactly match an existing client but looks like a near-duplicate
     ("ABC Tech" vs "ABC Technologies"), the person is asked once
     whether to use the existing client or keep this as a new one.
   ============================================================ */

const Clients = (() => {

  let state = { search: "" };

  /* -------------------- name normalisation / duplicate detection -------------------- */

  const SUFFIXES = ["technologies", "technology", "corporation", "corp", "company", "solutions", "systems", "group", "university", "inc", "llc", "ltd", "co", "tech"];

  function normalize(name) {
    let s = String(name || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").trim();
    SUFFIXES.forEach(suf => { s = s.replace(new RegExp(`\\b${suf}\\b`, "g"), ""); });
    return s.replace(/\s+/g, " ").trim();
  }

  /** Existing client whose normalized name matches exactly (case/suffix-insensitive), if any */
  function findExact(name) {
    const target = String(name || "").trim().toLowerCase();
    return Storage.getAll("clients").find(c => c.name.trim().toLowerCase() === target) || null;
  }

  /** A different-looking but probably-the-same client ("ABC Tech" vs "ABC Technologies") */
  function findSimilar(name, excludeId) {
    const target = normalize(name);
    if (!target) return null;
    return Storage.getAll("clients").find(c => c.id !== excludeId && normalize(c.name) === target) || null;
  }

  function names() { return Storage.getAll("clients").map(c => c.name); }

  /** Called automatically whenever an interview/assessment is saved with a "client" text field. */
  function reconcileClientName(typedName, onRenamed) {
    const name = String(typedName || "").trim();
    if (!name) return;
    if (findExact(name)) return; // already a known client, nothing to do

    const similar = findSimilar(name, null);
    if (similar) {
      // Possible duplicate — ask once, rather than silently creating "ABC Tech" next to "ABC Technologies"
      Utils.confirmDialog(
        "Possible existing client found",
        `You entered “${name}”. An existing client, “${similar.name}”, looks very similar (${countFor(similar.name).interviews} interview(s), ${countFor(similar.name).assessments} assessment(s)). Use the existing client instead of creating a new one?`
      ).then(useExisting => {
        if (useExisting && onRenamed) onRenamed(similar.name);
        else if (!useExisting) createClient(name);
      });
      return;
    }
    createClient(name); // brand new client — add it quietly so it shows up in the Clients list right away
  }

  function createClient(name) {
    const payload = { id: Utils.generateId("CLI"), name: name.trim(), code: "", activeStatus: "Active", roles: "", technologies: "", technicalPOCs: "", notes: "" };
    Storage.insert("clients", payload);
    renderGrid();
  }

  /** Hook into every save, regardless of which page it came from — see module header. */
  function bindAutoCreate() {
    Storage.onChange(ev => {
      if (ev.op !== "upsert" || (ev.collection !== "interviews" && ev.collection !== "assessments")) return;
      const rec = Storage.find(ev.collection, ev.id);
      if (!rec || !rec.client) return;
      reconcileClientName(rec.client, canonicalName => {
        Storage.update(ev.collection, ev.id, { client: canonicalName });
        if (ev.collection === "interviews") { Interviews.renderTable(); Interviews.renderAllSchedules(); }
        else { Assessments.renderTable(); }
      });
    });
  }

  /* -------------------- shared <datalist> for Interview/Assessment "Client" fields -------------------- */

  function refreshDatalist() {
    const dl = document.getElementById("clientNamesList");
    if (dl) dl.innerHTML = names().map(n => `<option value="${Utils.escapeHtml(n)}">`).join("");
  }

  /* -------------------- counts -------------------- */

  function countFor(clientName) {
    return {
      candidates: [...new Set([
        ...Storage.getAll("interviews").filter(i => i.client === clientName).map(i => i.candidateName),
        ...Storage.getAll("assessments").filter(a => a.client === clientName).map(a => a.candidateName)
      ])].length,
      assessments: Storage.getAll("assessments").filter(a => a.client === clientName).length,
      interviews: Storage.getAll("interviews").filter(i => i.client === clientName).length
    };
  }

  /* -------------------- grid -------------------- */

  function renderGrid() {
    const host = document.getElementById("clientsGrid");
    if (!host) return;
    let rows = Storage.getAll("clients");
    if (state.search) {
      const q = state.search.toLowerCase();
      rows = rows.filter(c => `${c.name} ${c.roles} ${c.technologies} ${c.technicalPOCs}`.toLowerCase().includes(q));
    }
    host.innerHTML = rows.map(c => {
      const n = countFor(c.name);
      return `
      <div class="candidate-card" data-id="${Utils.escapeHtml(c.id)}">
        <div class="candidate-card__actions">
          <button type="button" class="icon-btn" data-action="edit" title="Edit client">✏️</button>
          <button type="button" class="icon-btn icon-btn--danger" data-action="delete" title="Delete client">🗑️</button>
        </div>
        <div class="candidate-card__avatar">${Utils.initials(c.name)}</div>
        <div class="candidate-card__name">${Utils.escapeHtml(c.name)}</div>
        <div class="candidate-card__domain">${Utils.escapeHtml(c.roles || "No roles listed")}</div>
        <div class="candidate-card__meta">${n.candidates} candidate(s) · ${n.interviews} interview(s) · ${n.assessments} assessment(s)</div>
        <div class="candidate-card__poc">Technical POC(s): <strong>${Utils.escapeHtml(c.technicalPOCs || "Unassigned")}</strong></div>
        <span class="badge ${Utils.statusBadgeClass(c.activeStatus)}">${c.activeStatus}</span>
      </div>`;
    }).join("") || `<p class="empty-hint">${state.search ? "No clients match your search." : "No clients yet — they're added automatically the first time you use a name on an Interview or Assessment, or click “+ Add Client” to create one directly."}</p>`;
  }

  function bindGrid() {
    document.getElementById("clientsGrid")?.addEventListener("click", e => {
      const card = e.target.closest(".candidate-card");
      if (!card) return;
      const c = Storage.find("clients", card.dataset.id);
      if (!c) return;
      const btn = e.target.closest("button[data-action]");
      if (btn?.dataset.action === "edit") return openClientModal(c.id);
      if (btn?.dataset.action === "delete") return deleteClient(c.id);
      openProfile(c.id);
    });
  }

  async function deleteClient(id) {
    const c = Storage.find("clients", id);
    if (!c) return;
    const n = countFor(c.name);
    const ok = await Utils.confirmDialog("Delete client?", `Delete ${c.name}? Their ${n.interviews} interview(s) and ${n.assessments} assessment(s) will stay in their own tables (the client name on them is untouched). This cannot be undone.`);
    if (!ok) return;
    Storage.remove("clients", id);
    Storage.logActivity(`Client ${c.name} was deleted`, "🗑️");
    Utils.toast("Client deleted.", "success");
    document.getElementById("clientProfileOverlay")?.classList.remove("is-open");
    renderGrid();
    refreshDatalist();
  }

  /* -------------------- Client 360 (PRD §13) -------------------- */

  let profile = { id: null, tab: "overview" };
  const TABS = ["overview", "candidates", "assessments", "interviews", "roles", "technical POCs", "history"];

  function openProfile(id) {
    profile = { id, tab: "overview" };
    renderProfile();
    document.getElementById("clientProfileOverlay").classList.add("is-open");
  }

  function renderProfile() {
    const c = Storage.find("clients", profile.id);
    if (!c) return;
    const n = countFor(c.name);
    document.getElementById("clientProfileTitle").textContent = c.name;
    document.getElementById("clientProfileBody").innerHTML = `
      <div class="view-grid">
        <div class="view-row"><span>Candidates</span><strong>${n.candidates}</strong></div>
        <div class="view-row"><span>Assessments</span><strong>${n.assessments}</strong></div>
        <div class="view-row"><span>Interviews</span><strong>${n.interviews}</strong></div>
        <div class="view-row"><span>Status</span><span class="badge ${Utils.statusBadgeClass(c.activeStatus)}">${c.activeStatus}</span></div>
      </div>
      <div class="quick-actions-row">
        <button type="button" class="btn btn--ghost btn--sm" id="cqaCandidate">🧑‍💻 Add Candidate</button>
        <button type="button" class="btn btn--ghost btn--sm" id="cqaAssessment">📝 Create Assessment</button>
        <button type="button" class="btn btn--ghost btn--sm" id="cqaInterview">📅 Schedule Interview</button>
        <button type="button" class="btn btn--ghost btn--sm" id="cqaRole">➕ Add Role</button>
        <button type="button" class="btn btn--ghost btn--sm" id="cqaPOC">👤 Assign POC</button>
      </div>
      <div class="tabs" id="clientProfileTabs">
        ${TABS.map(t => `<button type="button" class="tab ${profile.tab === t ? "is-active" : ""}" data-tab="${t}">${t[0].toUpperCase() + t.slice(1)}</button>`).join("")}
      </div>
      <div id="clientProfileTabBody"></div>
      <div class="modal__foot modal__foot--split">
        <button type="button" class="btn btn--danger" id="clientProfileDelete">🗑️ Delete</button>
        <button type="button" class="btn btn--primary" id="clientProfileEdit">✏️ Edit</button>
      </div>`;
    renderTab();

    const close = () => document.getElementById("clientProfileOverlay").classList.remove("is-open");
    document.querySelectorAll("#clientProfileTabs .tab").forEach(el => el.addEventListener("click", () => {
      profile.tab = el.dataset.tab;
      document.querySelectorAll("#clientProfileTabs .tab").forEach(t => t.classList.toggle("is-active", t.dataset.tab === profile.tab));
      renderTab();
    }));
    const prefill = (formId, field) => setTimeout(() => { const f = document.getElementById(formId); if (f) f.elements[field].value = c.name; }, 30);
    document.getElementById("cqaCandidate").onclick = () => { close(); Candidates.openCandidateModal ? Candidates.openCandidateModal(null) : document.getElementById("btnAddCandidate").click(); };
    document.getElementById("cqaAssessment").onclick = () => { close(); Assessments.openModal(null); prefill("assessmentForm", "client"); };
    document.getElementById("cqaInterview").onclick = () => { close(); Interviews.openModal(null); prefill("interviewForm", "client"); };
    document.getElementById("cqaRole").onclick = () => { close(); openClientModal(c.id); setTimeout(() => document.getElementById("clientForm").elements.roles.focus(), 50); };
    document.getElementById("cqaPOC").onclick = () => { close(); openClientModal(c.id); setTimeout(() => document.getElementById("clientForm").elements.technicalPOCs.focus(), 50); };
    document.getElementById("clientProfileEdit").onclick = () => { close(); openClientModal(c.id); };
    document.getElementById("clientProfileDelete").onclick = () => deleteClient(c.id);
  }

  function renderTab() {
    const c = Storage.find("clients", profile.id);
    const host = document.getElementById("clientProfileTabBody");
    if (!c || !host) return;
    const interviews = Storage.getAll("interviews").filter(i => i.client === c.name);
    const assessments = Storage.getAll("assessments").filter(a => a.client === c.name);
    const list = str => String(str || "").split(",").map(x => x.trim()).filter(Boolean);
    const empty = t => `<p class="empty-hint">${t}</p>`;
    let html = "";
    if (profile.tab === "overview") {
      html = `<div class="view-grid">
        <div class="view-row"><span>Client Code</span><strong>${Utils.escapeHtml(c.code || "—")}</strong></div>
        <div class="view-row"><span>Technologies</span><strong>${Utils.escapeHtml(c.technologies || "—")}</strong></div>
        <div class="view-row view-row--wide"><span>Notes</span><strong>${Utils.escapeHtml(c.notes || "—")}</strong></div></div>`;
    } else if (profile.tab === "candidates") {
      const names = [...new Set([...interviews.map(i => i.candidateName), ...assessments.map(a => a.candidateName)])].filter(Boolean);
      html = names.map(nm => `<div class="history-item"><div><strong>${Utils.escapeHtml(nm)}</strong></div>
        <span class="muted">${interviews.filter(i => i.candidateName === nm).length} interview(s) · ${assessments.filter(a => a.candidateName === nm).length} assessment(s)</span></div>`).join("") || empty("No candidates yet.");
    } else if (profile.tab === "assessments") {
      html = assessments.map(a => `<div class="history-item"><div><strong>${Utils.escapeHtml(a.candidateName)}</strong> · ${a.type}</div>
        <span class="badge ${Utils.statusBadgeClass(a.status)}">${a.status}</span><span class="muted">${Utils.formatDate(a.date)}</span></div>`).join("") || empty("No assessments yet.");
    } else if (profile.tab === "interviews") {
      html = interviews.map(i => `<div class="history-item"><div><strong>${Utils.escapeHtml(i.candidateName)}</strong> · ${i.round} · ${Utils.escapeHtml(i.source || "Direct Interview")}</div>
        <span class="badge ${Utils.statusBadgeClass(i.interviewStatus)}">${i.interviewStatus}</span><span class="muted">${Utils.formatDate(i.interviewDate)}</span></div>`).join("") || empty("No interviews yet.");
    } else if (profile.tab === "roles") {
      html = list(c.roles).map(r => `<div class="history-item"><div>${Utils.escapeHtml(r)}</div></div>`).join("") || empty("No roles listed. Use “Add Role”.");
    } else if (profile.tab === "technical POCs") {
      html = list(c.technicalPOCs).map(r => `<div class="history-item"><div>👤 ${Utils.escapeHtml(r)}</div></div>`).join("") || empty("No technical POCs assigned. Use “Assign POC”.");
    } else if (profile.tab === "history") {
      const rows = Storage.getAll("auditLog").filter(a => (a.collection === "Client" && a.recordLabel === c.name) || a.summary.includes(c.name)).slice(0, 30);
      html = rows.map(a => `<div class="history-item history-item--wide"><div><strong>${Utils.escapeHtml(a.action)}</strong> by ${Utils.escapeHtml(a.changedBy)}</div>
        <div class="muted">${Utils.escapeHtml(a.summary)} · ${Utils.timeAgo(a.ts)}</div></div>`).join("") || empty("No recorded changes yet.");
    }
    host.innerHTML = html;
  }

  /* -------------------- Add/Edit -------------------- */

  function openClientModal(id) {
    const record = id ? Storage.find("clients", id) : null;
    document.getElementById("clientModalTitle").textContent = id ? "Edit Client" : "Add Client";
    const form = document.getElementById("clientForm");
    form.reset();
    form.dataset.editingId = id || "";
    form.elements.name.value = record?.name || "";
    form.elements.code.value = record?.code || "";
    form.elements.roles.value = record?.roles || "";
    form.elements.technologies.value = record?.technologies || "";
    form.elements.technicalPOCs.value = record?.technicalPOCs || "";
    form.elements.notes.value = record?.notes || "";
    form.elements.activeStatus.value = record?.activeStatus || "Active";
    document.getElementById("clientModalOverlay").classList.add("is-open");
  }

  function bindModal() {
    document.getElementById("clientModalClose")?.addEventListener("click", () => document.getElementById("clientModalOverlay").classList.remove("is-open"));
    document.getElementById("clientModalCancel")?.addEventListener("click", () => document.getElementById("clientModalOverlay").classList.remove("is-open"));

    document.getElementById("clientForm")?.addEventListener("submit", e => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const payload = {};
      ["name", "code", "roles", "technologies", "technicalPOCs", "notes", "activeStatus"].forEach(k => payload[k] = (fd.get(k) || "").trim());
      if (!payload.name) { Utils.toast("Client name is required.", "warning"); return; }

      const editingId = e.target.dataset.editingId;
      const all = Storage.getAll("clients");
      const clash = all.find(c => c.id !== editingId && c.name.trim().toLowerCase() === payload.name.toLowerCase());
      if (clash) { Utils.toast(`A client named “${clash.name}” already exists.`, "warning", 4500); return; }

      if (editingId) {
        const existing = Storage.find("clients", editingId);
        Storage.update("clients", editingId, payload);
        if (existing && existing.name !== payload.name) renameClientEverywhere(existing.name, payload.name);
        Storage.logActivity(`Client ${payload.name} was updated`, "✏️");
        Utils.toast("Client updated.", "success");
      } else {
        payload.id = Utils.generateId("CLI");
        Storage.insert("clients", payload);
        Storage.logActivity(`A new client was added: ${payload.name}`, "🏢");
        Utils.toast("Client added.", "success");
      }
      document.getElementById("clientModalOverlay").classList.remove("is-open");
      renderGrid();
      refreshDatalist();
      Reports.render();
    });
  }

  /** Keep Interviews/Assessments pointed at the client's new name after a rename */
  function renameClientEverywhere(oldName, newName) {
    Storage.getAll("interviews").filter(i => i.client === oldName).forEach(i => Storage.update("interviews", i.id, { client: newName }));
    Storage.getAll("assessments").filter(a => a.client === oldName).forEach(a => Storage.update("assessments", a.id, { client: newName }));
  }

  function bindEvents() {
    document.getElementById("clientSearch")?.addEventListener("input", Utils.debounce(e => { state.search = e.target.value; renderGrid(); }, 200));
    document.getElementById("clientProfileClose")?.addEventListener("click", () => document.getElementById("clientProfileOverlay").classList.remove("is-open"));
    document.getElementById("btnAddClient")?.addEventListener("click", () => openClientModal(null));
  }

  function init() {
    bindEvents();
    bindGrid();
    bindModal();
    bindAutoCreate();
    renderGrid();
    refreshDatalist();
  }

  return { init, renderGrid, refreshDatalist, openProfile, openClientModal, names, reconcileClientName };
})();
