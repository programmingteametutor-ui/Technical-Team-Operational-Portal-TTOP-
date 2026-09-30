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
        <div class="candidate-card__poc">Assigned User: <strong>${Utils.escapeHtml(Perms.nameFor(c.assignedUser) || "Unassigned")}</strong></div>
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

  let profileState = { name: null, tab: "overview" };

  function openProfile(name) {
    profileState = { name, tab: "overview" };
    renderProfile();
    document.getElementById("candidateProfileOverlay").classList.add("is-open");
  }

  function renderProfile() {
    const name = profileState.name;
    const c = Storage.getAll("candidates").find(c => c.name === name);
    if (!c) return;

    document.getElementById("candidateProfileTitle").textContent = name;
    document.getElementById("candidateProfileBody").innerHTML = `
      <div class="quick-actions-row">
        <button type="button" class="btn btn--ghost btn--sm" id="qaScheduleInterview">📅 Schedule Interview</button>
        <button type="button" class="btn btn--ghost btn--sm" id="qaAddAssessment">📝 Add Assessment</button>
        ${Perms.canReassign() ? `<button type="button" class="btn btn--ghost btn--sm" id="qaReassign">🔁 Reassign</button>` : ""}
        <button type="button" class="btn btn--ghost btn--sm" id="qaUpdateStatus">✏️ Update Status</button>
      </div>
      <div class="tabs" id="candidateProfileTabs">
        ${["overview", "interviews", "assessments", "preparation", "incentives", "activity"].map(t => `
          <button type="button" class="tab ${profileState.tab === t ? "is-active" : ""}" data-tab="${t}">${t[0].toUpperCase() + t.slice(1)}</button>`).join("")}
      </div>
      <div id="candidateProfileTabBody"></div>
      <div class="modal__foot modal__foot--split">
        <button type="button" class="btn btn--danger" id="candidateProfileDelete" data-id="${Utils.escapeHtml(c.id)}">🗑️ Delete</button>
        <button type="button" class="btn btn--primary" id="candidateProfileEdit" data-name="${Utils.escapeHtml(c.name)}">✏️ Edit</button>
      </div>
    `;
    renderProfileTab();

    document.querySelectorAll("#candidateProfileTabs .tab").forEach(el => el.addEventListener("click", () => {
      profileState.tab = el.dataset.tab;
      document.querySelectorAll("#candidateProfileTabs .tab").forEach(t => t.classList.toggle("is-active", t.dataset.tab === profileState.tab));
      renderProfileTab();
    }));
    document.getElementById("qaScheduleInterview").onclick = () => {
      document.getElementById("candidateProfileOverlay").classList.remove("is-open");
      Interviews.openModal(null);
      setTimeout(() => { const f = document.getElementById("interviewForm"); if (f) f.elements.candidateName.value = name; }, 30);
    };
    document.getElementById("qaAddAssessment").onclick = () => {
      document.getElementById("candidateProfileOverlay").classList.remove("is-open");
      Assessments.openModal(null);
      setTimeout(() => { const f = document.getElementById("assessmentForm"); if (f) f.elements.candidateName.value = name; }, 30);
    };
    document.getElementById("qaReassign")?.addEventListener("click", () => {
      document.getElementById("candidateProfileOverlay").classList.remove("is-open");
      openCandidateModal(name);
    });
    document.getElementById("qaUpdateStatus").addEventListener("click", () => {
      document.getElementById("candidateProfileOverlay").classList.remove("is-open");
      openCandidateModal(name);
    });
    document.getElementById("candidateProfileEdit").onclick = () => {
      document.getElementById("candidateProfileOverlay").classList.remove("is-open");
      openCandidateModal(c.name);
    };
    document.getElementById("candidateProfileDelete").onclick = () => deleteCandidate(c.id);
  }

  function renderProfileTab() {
    const name = profileState.name;
    const c = Storage.getAll("candidates").find(c => c.name === name);
    const assessments = Storage.getAll("assessments").filter(a => a.candidateName === name);
    const interviews = Storage.getAll("interviews").filter(i => i.candidateName === name);
    const incentives = Storage.getAll("incentives").filter(i => i.candidate === name);
    const host = document.getElementById("candidateProfileTabBody");
    if (!host || !c) return;

    if (profileState.tab === "overview") {
      host.innerHTML = `
        <div class="view-grid">
          <div class="view-row"><span>Email</span><strong>${Utils.escapeHtml(c.email)}</strong></div>
          <div class="view-row"><span>Phone</span><strong>${Utils.escapeHtml(c.phone)}</strong></div>
          <div class="view-row"><span>Location</span><strong>${Utils.escapeHtml(c.location)}</strong></div>
          <div class="view-row"><span>Experience</span><strong>${Utils.escapeHtml(c.experience)}</strong></div>
          <div class="view-row"><span>Assigned Domains</span><strong>${Utils.escapeHtml(c.assignedDomains)}</strong></div>
          <div class="view-row"><span>Technical POC (Candidate POC)</span><strong>${Utils.escapeHtml(c.candidatePOC || "Assignment Required")}</strong></div>
          <div class="view-row"><span>Marketing POC</span><strong>${Utils.escapeHtml(c.marketingPOC || "Assignment Required")}</strong></div>
          <div class="view-row"><span>Assigned User</span><strong>${Utils.escapeHtml(Perms.nameFor(c.assignedUser) || "Unassigned")}</strong></div>
          <div class="view-row"><span>Pipeline Stage</span><span class="badge ${Utils.statusBadgeClass(computeCandidateStatus(name))}">${computeCandidateStatus(name)}</span></div>
          <div class="view-row"><span>Status</span><span class="badge ${Utils.statusBadgeClass(c.activeStatus)}">${c.activeStatus}</span></div>
        </div>`;
    } else if (profileState.tab === "interviews") {
      host.innerHTML = interviews.map(i => `
        <div class="history-item">
          <div><strong>${Utils.escapeHtml(i.client)}</strong> · ${i.round} · ${Utils.escapeHtml(i.source || "Direct Interview")}</div>
          <span class="badge ${Utils.statusBadgeClass(i.interviewStatus)}">${i.interviewStatus}</span>
          <span class="muted">${Utils.formatDate(i.interviewDate)} · ${i.interviewTime}</span>
        </div>`).join("") || `<p class="empty-hint">No interviews yet.</p>`;
    } else if (profileState.tab === "assessments") {
      host.innerHTML = assessments.map(a => `
        <div class="history-item">
          <div><strong>${Utils.escapeHtml(a.client)}</strong> · ${a.type}</div>
          <span class="badge ${Utils.statusBadgeClass(a.status)}">${a.status}</span>
          <span class="muted">${Utils.formatDate(a.date)}</span>
        </div>`).join("") || `<p class="empty-hint">No assessments yet.</p>`;
    } else if (profileState.tab === "preparation") {
      const withPrep = interviews.filter(i => i.preparationStatus && i.preparationStatus !== "Not Started" || i.prepNotes || i.scenarioNotes);
      host.innerHTML = interviews.map(i => `
        <div class="history-item history-item--wide">
          <div><strong>${Utils.escapeHtml(i.client)}</strong> · ${i.round} · ${Utils.formatDate(i.interviewDate)}</div>
          <span class="badge ${Utils.statusBadgeClass(i.preparationStatus)}">${i.preparationStatus || "Not Started"}</span>
          ${i.preparedBy || i.prepDate ? `<div class="muted">Prepared by ${Utils.escapeHtml(i.preparedBy || "—")}${i.prepDate ? " · " + Utils.formatDate(i.prepDate) : ""}</div>` : ""}
          ${i.prepNotes ? `<div>${Utils.escapeHtml(i.prepNotes)}</div>` : ""}
          ${i.scenarioNotes ? `<div class="muted">${Utils.escapeHtml(i.scenarioNotes)}</div>` : ""}
        </div>`).join("") || `<p class="empty-hint">No interviews to prepare for yet.</p>`;
    } else if (profileState.tab === "incentives") {
      host.innerHTML = incentives.filter(i => i.amount > 0).map(i => `
        <div class="history-item">
          <div>${Utils.escapeHtml(i.incentiveType)}</div>
          <strong>${Utils.formatCurrency(i.amount)}</strong>
          <span class="muted">${Utils.formatDate(i.date)}</span>
        </div>`).join("") || `<p class="empty-hint">No incentives linked to this candidate yet.</p>`;
    } else if (profileState.tab === "activity") {
      const items = Storage.getAll("activity").filter(a => a.text.includes(name)).slice(0, 30);
      host.innerHTML = items.map(a => `
        <div class="activity-row">
          <span class="activity-row__icon">${a.icon}</span>
          <span class="activity-row__text">${Utils.escapeHtml(a.text)}</span>
          <span class="activity-row__time">${Utils.timeAgo(a.ts)}</span>
        </div>`).join("") || `<p class="empty-hint">No recorded activity for this candidate yet.</p>`;
    }
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

    // Assigned User (PRD §31): who this candidate — and their interviews/assessments/incentives — belongs
    // to. Only admins may reassign; a non-admin's own new candidates default to themselves and can't be
    // handed to someone else from here (backend enforcement means they wouldn't see it again if they did).
    const me = Auth.currentUser();
    const assignField = document.getElementById("candidateAssignedUserField");
    const current = record?.assignedUser || (record ? "" : (me?.email || ""));
    if (Perms.canReassign()) {
      const roster = Perms.cached();
      const options = roster.some(u => u.email.toLowerCase() === current.toLowerCase()) || !current
        ? roster : [...roster, { email: current, name: current }]; // keep a value that's since left the roster
      form.elements.assignedUser.innerHTML = `<option value="">— Unassigned —</option>` +
        options.map(u => `<option value="${Utils.escapeHtml(u.email)}" ${u.email === current ? "selected" : ""}>${Utils.escapeHtml(u.name)}</option>`).join("");
      assignField.hidden = false;
    } else {
      form.elements.assignedUser.innerHTML = `<option value="${Utils.escapeHtml(current)}" selected>${Utils.escapeHtml(Perms.nameFor(current) || "Me")}</option>`;
      form.elements.assignedUser.disabled = true;
      assignField.hidden = false;
    }
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
      // FormData skips disabled fields (non-admins see assignedUser disabled), so read it directly
      payload.assignedUser = (e.target.elements.assignedUser.value || "").trim();
      if (!payload.name) { Utils.toast("Candidate name is required.", "warning"); return; }

      const editingName = e.target.dataset.editingName;
      const all = Storage.getAll("candidates");
      const existing = editingName ? all.find(c => c.name === editingName) : null;

      // Assessments, interviews and incentives link to a candidate by NAME, so names must be unique
      const clash = all.find(c => c.id !== existing?.id && c.name.trim().toLowerCase() === payload.name.toLowerCase());
      if (clash) { Utils.toast(`A candidate named “${clash.name}” already exists.`, "warning", 4500); return; }

      // Smart Duplicate Detection (PRD §32): same email or phone under a different name is very likely
      // the same person entered twice. Ask once rather than silently forking their history in two.
      if (!existing) {
        const normPhone = p => String(p || "").replace(/\D/g, "");
        const dup = (payload.email && all.find(c => c.email && c.email.toLowerCase() === payload.email.toLowerCase())) ||
          (normPhone(payload.phone).length >= 7 && all.find(c => normPhone(c.phone) === normPhone(payload.phone)));
        if (dup) {
          const openExisting = await Utils.confirmDialog(
            "Possible existing candidate found",
            `A candidate named “${dup.name}” already has this ${dup.email?.toLowerCase() === payload.email.toLowerCase() ? "email" : "phone number"}. Open the existing candidate instead of creating a new one?`
          );
          if (openExisting) {
            document.getElementById("candidateModalOverlay").classList.remove("is-open");
            openProfile(dup.name);
            return;
          }
        }
      }

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
    Perms.loadUsers().then(renderGrid); // fill in real names once the roster arrives (was showing raw emails)
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
