/* ============================================================
   TTOP – candidates.js
   Candidate directory (full CRUD: add / view / edit / delete) + profile modal (assessment/interview/
   incentive history), plus the Team page which manages two
   distinct teams with full CRUD:
   - Candidate POC Team  = the Technical POC for candidates
     (Marketing POC is a separate, freely-typed field on the
     candidate — it is not drawn from a team list)
   - Support Team        = Tool Drive and Call Support
   ============================================================ */

const Candidates = (() => {

  let state = { search: "" };

  function computeCandidateStatus(name) {
    const assessments = Storage.getAll("assessments").filter(a => a.candidateName === name);
    const interviews = Storage.getAll("interviews").filter(i => i.candidateName === name);
    if (interviews.some(i => i.placementStatus === "Placed")) return "Placed";
    if (interviews.length) return "In Interview Process";
    if (assessments.length) return "In Assessment";
    return "New";
  }

  function renderGrid() {
    const host = document.getElementById("candidatesGrid");
    if (!host) return;
    let rows = Storage.getAll("candidates");
    if (state.search) {
      const q = state.search.toLowerCase();
      rows = rows.filter(c => `${c.name} ${c.email} ${c.phone} ${c.assignedDomains} ${c.location} ${c.candidatePOC} ${c.marketingPOC}`.toLowerCase().includes(q));
    }
    host.innerHTML = rows.map(c => {
      const stage = computeCandidateStatus(c.name);
      return `
      <div class="candidate-card" data-id="${Utils.escapeHtml(c.id)}">
        <div class="candidate-card__actions">
          <button type="button" class="icon-btn" data-action="edit" title="Edit candidate">✏️</button>
          <button type="button" class="icon-btn icon-btn--danger" data-action="delete" title="Delete candidate">🗑️</button>
        </div>
        <div class="candidate-card__avatar">${Utils.initials(c.name)}</div>
        <div class="candidate-card__name">${Utils.escapeHtml(c.name)}</div>
        <div class="candidate-card__domain">${Utils.escapeHtml(c.assignedDomains)}</div>
        <div class="candidate-card__meta">${Utils.escapeHtml(c.location)} · ${Utils.escapeHtml(c.experience)}</div>
        <div class="candidate-card__poc">Technical POC: <strong>${Utils.escapeHtml(c.candidatePOC || "Unassigned")}</strong></div>
        <div class="candidate-card__poc">Marketing POC: <strong>${Utils.escapeHtml(c.marketingPOC || "Unassigned")}</strong></div>
        <span class="badge ${Utils.statusBadgeClass(stage === "Placed" ? "Placed" : c.activeStatus)}">${stage}</span>
      </div>`;
    }).join("") || `<p class="empty-hint">${state.search ? "No candidates match your search." : "No candidates yet — click “+ Add Candidate” to create one."}</p>`;
  }

  /** One delegated handler for the whole grid: open profile / edit / delete */
  function bindGrid() {
    document.getElementById("candidatesGrid")?.addEventListener("click", e => {
      const card = e.target.closest(".candidate-card");
      if (!card) return;
      const c = Storage.find("candidates", card.dataset.id);
      if (!c) return;
      const btn = e.target.closest("button[data-action]");
      if (btn?.dataset.action === "edit") return openCandidateModal(c.name);
      if (btn?.dataset.action === "delete") return deleteCandidate(c.id);
      openProfile(c.name);
    });
  }

  /** Delete a candidate profile. Their assessments / interviews / incentives are kept (they live in their own tables). */
  async function deleteCandidate(id) {
    const c = Storage.find("candidates", id);
    if (!c) return;
    const nA = Storage.getAll("assessments").filter(a => a.candidateName === c.name).length;
    const nI = Storage.getAll("interviews").filter(i => i.candidateName === c.name).length;
    const linked = (nA || nI) ? ` Their ${nA} assessment(s) and ${nI} interview(s) will stay in their own tables.` : "";
    const ok = await Utils.confirmDialog("Delete candidate?", `Delete ${c.name}?${linked} This cannot be undone.`);
    if (!ok) return;
    Storage.remove("candidates", id);
    Storage.logActivity(`Candidate profile for ${c.name} was deleted`, "🗑️");
    Utils.toast("Candidate deleted.", "success");
    document.getElementById("candidateProfileOverlay")?.classList.remove("is-open");
    refreshAfterChange();
  }

  function refreshAfterChange() {
    renderGrid();
    TeamManager.renderBoth();
    Interviews.renderAllSchedules();
    Interviews.renderTable();
    Assessments.renderTable();
    Incentives.renderPage();
    Dashboard.renderAll();
  }

  function openProfile(name) {
    const c = Storage.getAll("candidates").find(c => c.name === name);
    if (!c) return;
    const assessments = Storage.getAll("assessments").filter(a => a.candidateName === name);
    const interviews = Storage.getAll("interviews").filter(i => i.candidateName === name);
    const incentives = Storage.getAll("incentives").filter(i => i.candidate === name);

    document.getElementById("candidateProfileTitle").textContent = name;
    document.getElementById("candidateProfileBody").innerHTML = `
      <div class="view-grid">
        <div class="view-row"><span>Email</span><strong>${Utils.escapeHtml(c.email)}</strong></div>
        <div class="view-row"><span>Phone</span><strong>${Utils.escapeHtml(c.phone)}</strong></div>
        <div class="view-row"><span>Location</span><strong>${Utils.escapeHtml(c.location)}</strong></div>
        <div class="view-row"><span>Experience</span><strong>${Utils.escapeHtml(c.experience)}</strong></div>
        <div class="view-row"><span>Assigned Domains</span><strong>${Utils.escapeHtml(c.assignedDomains)}</strong></div>
        <div class="view-row"><span>Technical POC (Candidate POC)</span><strong>${Utils.escapeHtml(c.candidatePOC || "Assignment Required")}</strong></div>
        <div class="view-row"><span>Marketing POC</span><strong>${Utils.escapeHtml(c.marketingPOC || "Assignment Required")}</strong></div>
        <div class="view-row"><span>Status</span><span class="badge ${Utils.statusBadgeClass(c.activeStatus)}">${c.activeStatus}</span></div>
      </div>

      <h4 class="profile-subhead">Assessment History</h4>
      ${assessments.map(a => `
        <div class="history-item">
          <div><strong>${Utils.escapeHtml(a.client)}</strong> · ${a.type}</div>
          <span class="badge ${Utils.statusBadgeClass(a.status)}">${a.status}</span>
          <span class="muted">${Utils.formatDate(a.date)}</span>
        </div>`).join("") || `<p class="empty-hint">No assessments yet.</p>`}

      <h4 class="profile-subhead">Interview History</h4>
      ${interviews.map(i => `
        <div class="history-item">
          <div><strong>${Utils.escapeHtml(i.client)}</strong> · ${i.round}</div>
          <span class="badge ${Utils.statusBadgeClass(i.interviewStatus)}">${i.interviewStatus}</span>
          <span class="muted">${Utils.formatDate(i.interviewDate)} · ${i.interviewTime}</span>
        </div>`).join("") || `<p class="empty-hint">No interviews yet.</p>`}

      <h4 class="profile-subhead">Incentive History</h4>
      ${incentives.filter(i => i.amount > 0).map(i => `
        <div class="history-item">
          <div>${Utils.escapeHtml(i.incentiveType)}</div>
          <strong>${Utils.formatCurrency(i.amount)}</strong>
          <span class="muted">${Utils.formatDate(i.date)}</span>
        </div>`).join("") || `<p class="empty-hint">No incentives linked to this candidate yet.</p>`}

      <div class="modal__foot modal__foot--split">
        <button type="button" class="btn btn--danger" id="candidateProfileDelete" data-id="${Utils.escapeHtml(c.id)}">🗑️ Delete</button>
        <button type="button" class="btn btn--primary" id="candidateProfileEdit" data-name="${Utils.escapeHtml(c.name)}">✏️ Edit</button>
      </div>
    `;
    document.getElementById("candidateProfileEdit").onclick = () => {
      document.getElementById("candidateProfileOverlay").classList.remove("is-open");
      openCandidateModal(c.name);
    };
    document.getElementById("candidateProfileDelete").onclick = () => deleteCandidate(c.id);
    document.getElementById("candidateProfileOverlay").classList.add("is-open");
  }

  function bindEvents() {
    document.getElementById("candidateSearch")?.addEventListener("input", Utils.debounce(e => {
      state.search = e.target.value; renderGrid();
    }, 200));
    document.getElementById("candidateProfileClose")?.addEventListener("click", () =>
      document.getElementById("candidateProfileOverlay").classList.remove("is-open"));
    document.getElementById("btnAddCandidate")?.addEventListener("click", () => openCandidateModal(null));
  }

  /* -------- Add/Edit candidate -------- */

  function openCandidateModal(name) {
    const record = name ? Storage.getAll("candidates").find(c => c.name === name) : null;
    document.getElementById("candidateModalTitle").textContent = name ? "Edit Candidate" : "Add Candidate";
    const form = document.getElementById("candidateForm");
    form.reset();
    form.dataset.editingName = name || "";
    form.elements.name.value = record?.name || "";
    form.elements.email.value = record?.email || "";
    form.elements.phone.value = record?.phone || "";
    form.elements.location.value = record?.location || "";
    form.elements.experience.value = record?.experience || "";
    form.elements.assignedDomains.value = record?.assignedDomains || "";
    // Technical POC = Candidate POC Team member, set once here and never asked again per interview
    const pocNames = Storage.getAll("candidatePocTeam").map(t => t.name);
    if (record?.candidatePOC && !pocNames.includes(record.candidatePOC)) pocNames.push(record.candidatePOC); // keep a value that has since left the team
    form.elements.candidatePOC.innerHTML = `<option value="">— Assignment Required —</option>` +
      pocNames.map(n => `<option value="${Utils.escapeHtml(n)}" ${n === record?.candidatePOC ? "selected" : ""}>${Utils.escapeHtml(n)}</option>`).join("");
    // Marketing POC is typed in manually (not drawn from a team list)
    form.elements.marketingPOC.value = record?.marketingPOC || "";
    form.elements.activeStatus.value = record?.activeStatus || "Active";
    document.getElementById("candidateModalOverlay").classList.add("is-open");
  }

  function bindCandidateModal() {
    document.getElementById("candidateModalClose")?.addEventListener("click", () =>
      document.getElementById("candidateModalOverlay").classList.remove("is-open"));
    document.getElementById("candidateModalCancel")?.addEventListener("click", () =>
      document.getElementById("candidateModalOverlay").classList.remove("is-open"));

    document.getElementById("candidateForm")?.addEventListener("submit", async e => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const payload = {};
      ["name", "email", "phone", "location", "experience", "assignedDomains", "candidatePOC", "marketingPOC", "activeStatus"]
        .forEach(k => payload[k] = (fd.get(k) || "").trim());
      if (!payload.name) { Utils.toast("Candidate name is required.", "warning"); return; }

      const editingName = e.target.dataset.editingName;
      const all = Storage.getAll("candidates");
      const existing = editingName ? all.find(c => c.name === editingName) : null;

      // Assessments, interviews and incentives link to a candidate by NAME, so names must be unique
      const clash = all.find(c => c.id !== existing?.id && c.name.trim().toLowerCase() === payload.name.toLowerCase());
      if (clash) { Utils.toast(`A candidate named “${clash.name}” already exists.`, "warning", 4500); return; }

      if (existing) {
        Storage.update("candidates", existing.id, payload);
        if (existing.name !== payload.name) renameCandidateEverywhere(existing.name, payload.name);
        Storage.logActivity(`Candidate profile for ${payload.name} was updated`, "✏️");
        Utils.toast("Candidate updated.", "success");
      } else {
        payload.id = Utils.generateId("CAND");
        Storage.insert("candidates", payload);
        Storage.logActivity(`A new candidate profile was created for ${payload.name}`, "👤");
        Utils.toast("Candidate added.", "success");
      }
      document.getElementById("candidateModalOverlay").classList.remove("is-open");
      refreshAfterChange();
    });
  }

  /** Keep linked records attached when a candidate is renamed */
  function renameCandidateEverywhere(oldName, newName) {
    Storage.getAll("assessments").filter(a => a.candidateName === oldName)
      .forEach(a => Storage.update("assessments", a.id, { candidateName: newName }));
    Storage.getAll("interviews").filter(i => i.candidateName === oldName)
      .forEach(i => Storage.update("interviews", i.id, { candidateName: newName }));
    Storage.getAll("incentives").filter(i => i.candidate === oldName)
      .forEach(i => Storage.update("incentives", i.id, { candidate: newName }));
  }

  function init() {
    bindEvents();
    bindGrid();
    bindCandidateModal();
    renderGrid();
  }

  return { init, renderGrid, openProfile, openCandidateModal, deleteCandidate, computeCandidateStatus };
})();

/* ============================================================
   TeamManager – full CRUD for the two teams: Candidate POC Team
   and Support Team. Both use the same add/edit modal, tagged
   with which collection they belong to.
   ============================================================ */

const TeamManager = (() => {

  const COLLECTIONS = {
    candidatePocTeam: { label: "Candidate POC Team" },   // Technical POC — linked via candidate.candidatePOC
    supportTeam: { label: "Support Team" }               // Tool Drive (interview.doneBy) + Call Support (interview.assignedPOC)
  };

  function countAssigned(collectionKey, name) {
    const candidates = Storage.getAll("candidates");
    if (collectionKey === "candidatePocTeam") {
      return candidates.filter(c => c.candidatePOC === name).length;
    }
    // supportTeam: interviews where this person is Call Support or Tool Drive
    return Storage.getAll("interviews").filter(i => i.assignedPOC === name || i.doneBy === name).length;
  }

  function renderTable(collectionKey, tbodyId) {
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;
    const rows = Storage.getAll(collectionKey);
    tbody.innerHTML = rows.map(t => `
      <tr data-id="${t.id}">
        <td data-label="Avatar"><div class="team-avatar">${Utils.initials(t.name)}</div></td>
        <td data-label="Name"><strong>${Utils.escapeHtml(t.name)}</strong></td>
        <td data-label="Email">${Utils.escapeHtml(t.email || "—")}</td>
        <td data-label="Linked Records">${countAssigned(collectionKey, t.name)}</td>
        <td data-label="Status"><span class="badge ${Utils.statusBadgeClass(t.activeStatus)}">${t.activeStatus}</span></td>
        <td class="row-actions" data-label="Actions">
          <button class="icon-btn" data-action="edit" title="Edit">✏️</button>
          <button class="icon-btn icon-btn--danger" data-action="delete" title="Delete">🗑️</button>
        </td>
      </tr>`).join("") || `<tr><td colspan="6" class="empty-hint">No team members yet.</td></tr>`;
  }

  function renderBoth() {
    renderTable("candidatePocTeam", "candidatePocTeamBody");
    renderTable("supportTeam", "supportTeamBody");
  }

  function openModal(collectionKey, id) {
    const record = id ? Storage.find(collectionKey, id) : null;
    const form = document.getElementById("teamMemberForm");
    form.reset();
    form.dataset.collection = collectionKey;
    form.dataset.editingId = id || "";
    document.getElementById("teamMemberModalTitle").textContent = (id ? "Edit " : "Add ") + COLLECTIONS[collectionKey].label + " Member";
    form.elements.teamLabel.value = COLLECTIONS[collectionKey].label;
    form.elements.name.value = record?.name || "";
    form.elements.email.value = record?.email || "";
    form.elements.activeStatus.value = record?.activeStatus || "Active";
    document.getElementById("teamMemberModalOverlay").classList.add("is-open");
  }

  function closeModal() {
    document.getElementById("teamMemberModalOverlay").classList.remove("is-open");
  }

  function bindEvents() {
    document.getElementById("btnAddCandidatePoc")?.addEventListener("click", () => openModal("candidatePocTeam", null));
    document.getElementById("btnAddSupportMember")?.addEventListener("click", () => openModal("supportTeam", null));

    ["candidatePocTeamBody", "supportTeamBody"].forEach((tbodyId, idx) => {
      const collectionKey = idx === 0 ? "candidatePocTeam" : "supportTeam";
      document.getElementById(tbodyId)?.addEventListener("click", async e => {
        const btn = e.target.closest("button[data-action]");
        if (!btn) return;
        const id = btn.closest("tr").dataset.id;
        if (btn.dataset.action === "edit") openModal(collectionKey, id);
        if (btn.dataset.action === "delete") {
          const member = Storage.find(collectionKey, id);
          const ok = await Utils.confirmDialog("Remove team member?", `Are you sure you want to remove ${member?.name || "this person"} from the ${COLLECTIONS[collectionKey].label}? This cannot be undone.`);
          if (ok) {
            Storage.remove(collectionKey, id);
            Storage.logActivity(`${member?.name || "A team member"} was removed from the ${COLLECTIONS[collectionKey].label}`, "🗑️");
            renderBoth();
            Utils.toast("Team member removed.", "success");
          }
        }
      });
    });

    document.getElementById("teamMemberModalClose")?.addEventListener("click", closeModal);
    document.getElementById("teamMemberModalCancel")?.addEventListener("click", closeModal);

    document.getElementById("teamMemberForm")?.addEventListener("submit", e => {
      e.preventDefault();
      const form = e.target;
      const collectionKey = form.dataset.collection;
      const editingId = form.dataset.editingId;
      const fd = new FormData(form);
      const payload = {
        name: (fd.get("name") || "").trim(),
        email: (fd.get("email") || "").trim(),
        activeStatus: fd.get("activeStatus") || "Active"
      };
      if (!payload.name) { Utils.toast("Name is required.", "warning"); return; }

      if (editingId) {
        Storage.update(collectionKey, editingId, payload);
        Utils.toast("Team member updated.", "success");
      } else {
        payload.id = Utils.generateId(collectionKey === "candidatePocTeam" ? "CPOC" : "SUP");
        Storage.insert(collectionKey, payload);
        Storage.logActivity(`${payload.name} was added to the ${COLLECTIONS[collectionKey].label}`, "🧑‍💼");
        Utils.toast("Team member added.", "success");
      }
      closeModal();
      renderBoth();
    });
  }

  function init() {
    bindEvents();
    renderBoth();
  }

  return { init, renderBoth };
})();
