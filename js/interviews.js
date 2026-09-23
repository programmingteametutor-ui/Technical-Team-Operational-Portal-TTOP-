/* ============================================================
   TTOP – interviews.js
   Interview cards (Today/Tomorrow/Day-after), full table, a
   lightweight calendar, the Add/Edit modal, Assessment <-> Interview
   linking (required for "Assessment" / "Presentation" interviews),
   and the hook into Incentives.calculateIncentive.

   People on an interview:
   - Tool Drive     = interview.doneBy      (typed manually, Support Team)
   - Call Support   = interview.assignedPOC (picked from Support Team)
   - Technical POC  = the candidate's Candidate POC — set once on the
                      candidate, derived here, never asked per interview.
   ============================================================ */

const Interviews = (() => {

  const ROUND_OPTIONS = ["1st Round", "2nd Round", "2nd Round – Final Round", "3rd Round", "3rd Round – Final Round", "Final Round"];
  const STATUS_OPTIONS = ["Upcoming Interview", "Ongoing Interview", "Interview Completed", "Cancelled"];
  const PLACEMENT_OPTIONS = ["Pending", "Placed", "Not Placed"];
  const INTERVIEW_TYPE_OPTIONS = ["Recruiter", "Technical", "Hiring Manager", "Leadership", "Director", "Coding", "System Design", "Assessment", "Presentation", "Cultural Fit"];
  const PREP_STAGES = ["Not Started", "In Progress", "Mock Call Done", "Completed"];
  const PREP_STAGE_CLASS = { "Not Started": "notstarted", "In Progress": "inprogress", "Mock Call Done": "mockcalldone", "Completed": "completed" };
  const SUPPORT_TEAM_NAMES = () => Storage.getAll("supportTeam").map(t => t.name);
  const TYPES_NEEDING_ASSESSMENT = ["Assessment", "Presentation"];
  const needsAssessment = type => TYPES_NEEDING_ASSESSMENT.includes(type);

  let tableState = { search: "", filters: {} };

  /** Find a matching assessment for a candidate+client (most recent) */
  function findMatchingAssessment(candidateName, client) {
    return Storage.getAll("assessments")
      .filter(a => a.candidateName === candidateName && a.client === client)
      .sort((a, b) => (b.date || "").localeCompare(a.date || ""))[0] || null;
  }

  /** Explicitly linked assessment (assessmentId) or, for older records, the best candidate+client match */
  function linkedAssessment(interview) {
    if (interview.assessmentId) {
      const a = Storage.find("assessments", interview.assessmentId);
      if (a) return a;
    }
    return findMatchingAssessment(interview.candidateName, interview.client);
  }

  /** Technical POC == the candidate's Candidate POC (fixed on the candidate, not per interview) */
  function technicalPOCFor(interview) {
    const c = Storage.getAll("candidates").find(c => c.name === interview.candidateName);
    return c?.candidatePOC || "";
  }

  /**
   * The Assessment -> Interview relationship should only be shown
   * once the linked assessment has actually moved past "Assessment
   * Pending" — otherwise every interview card would show a false
   * "linked" checkmark just because *some* assessment record exists
   * for that candidate+client, even an unfinished one.
   */
  function relationshipLabel(interview) {
    const assessment = linkedAssessment(interview);
    if (!assessment) return { label: "No linked assessment", cls: "muted", stage: 0, assessment: null };
    if (assessment.status === "Assessment Pending") return { label: "Assessment in progress", cls: "muted", stage: 1, assessment };
    if (interview.interviewStatus === "Interview Completed") return { label: "Assessment → Interview → Completed", cls: "success", stage: 3, assessment };
    return { label: "Assessment → Interview", cls: "info", stage: 2, assessment };
  }

  /* ------------------------- Cards ------------------------- */

  /** One "Label: Name" line; if unassigned shows a button instead */
  function personRow(label, name, assignAction, assignText) {
    const value = name
      ? `<strong>${Utils.escapeHtml(name)}</strong>`
      : `<button type="button" class="assign-btn" data-action="${assignAction}">${assignText}</button>`;
    return `<div class="person-row"><span class="person-row__label">${label}:</span> ${value}</div>`;
  }

  function interviewCardHTML(iv) {
    const rel = relationshipLabel(iv);
    const prepClass = PREP_STAGE_CLASS[iv.preparationStatus] || "notstarted";
    return `
    <div class="interview-card interview-card--prep-${prepClass} interview-card--${Utils.interviewTypeClass(iv.interviewType).replace("itype--", "type-")}" data-id="${iv.id}">
      <div class="interview-card__top">
        <div class="interview-card__avatar">${Utils.initials(iv.candidateName)}</div>
        <div>
          <div class="interview-card__name">${Utils.escapeHtml(iv.candidateName)}</div>
          <div class="interview-card__client">${Utils.escapeHtml(iv.client)}</div>
        </div>
        <span class="badge ${Utils.statusBadgeClass(iv.interviewStatus)} interview-card__status">${iv.interviewStatus}</span>
      </div>
      <div class="interview-card__meta">
        <span>🕐 ${iv.interviewTime}</span>
        <span>⏱ ${iv.duration}</span>
        <span>🎯 ${iv.round}</span>
      </div>
      <div class="interview-card__type ${Utils.interviewTypeClass(iv.interviewType)}">${Utils.escapeHtml(iv.interviewType)}</div>
      <div class="interview-card__people">
        ${personRow("Tool Drive", iv.doneBy, "assign-tooldrive", "+ Assign Tool Drive")}
        ${personRow("Technical POC", technicalPOCFor(iv), "set-poc", "+ Set Technical POC")}
        ${personRow("Call Support", iv.assignedPOC, "assign-support", "+ Assign Call Support")}
      </div>
      <div class="interview-card__rel interview-card__rel--${rel.cls}">${rel.label}</div>
      <div class="interview-card__prep-row">
        <label>Preparation</label>
        <select class="prep-select" data-id="${iv.id}">
          ${PREP_STAGES.map(s => `<option value="${s}" ${s === (iv.preparationStatus || "Not Started") ? "selected" : ""}>${s}</option>`).join("")}
        </select>
      </div>
      <div class="interview-card__actions">
        <button class="btn btn--ghost btn--sm" data-action="candidate">View Candidate</button>
        ${rel.assessment ? `<button class="btn btn--ghost btn--sm" data-action="assessment">View Assessment</button>` : ""}
        <button class="btn btn--ghost btn--sm" data-action="view">View Interview</button>
      </div>
    </div>`;
  }

  function renderScheduleSection(bucket, containerId, emptyMsg) {
    const host = document.getElementById(containerId);
    if (!host) return;
    const rows = Storage.getAll("interviews")
      .filter(iv => Utils.dayBucket(iv.interviewDate) === bucket)
      .sort((a, b) => Utils.timeToMinutes(a.interviewTime) - Utils.timeToMinutes(b.interviewTime));
    host.innerHTML = rows.map(interviewCardHTML).join("") || `<p class="empty-hint">${emptyMsg}</p>`;
  }

  function bindCardActions(root) {
    root.addEventListener("click", e => {
      const btn = e.target.closest("button[data-action]");
      if (!btn) return;
      const card = btn.closest("[data-id]");
      const id = card.dataset.id;
      const iv = Storage.find("interviews", id);
      if (!iv) return;
      if (btn.dataset.action === "view") openViewModal(id);
      if (btn.dataset.action === "candidate") {
        Nav.goTo("candidates");
        setTimeout(() => Candidates.openProfile(iv.candidateName), 50);
      }
      if (btn.dataset.action === "assessment") {
        const a = linkedAssessment(iv);
        if (a) Assessments.openViewModal(a.id);
      }
      if (btn.dataset.action === "assign-tooldrive") openAssignDialog(id, "tooldrive");
      if (btn.dataset.action === "assign-support") openAssignDialog(id, "support");
      if (btn.dataset.action === "set-poc") {
        const cand = Storage.getAll("candidates").find(c => c.name === iv.candidateName);
        if (cand) Candidates.openCandidateModal(cand.name);
        else Utils.toast("This candidate isn't in the Candidates list yet — add them first, then set their Technical POC.", "warning", 5000);
      }
    });
    root.addEventListener("change", e => {
      const sel = e.target.closest(".prep-select");
      if (!sel) return;
      const id = sel.dataset.id;
      const iv = Storage.find("interviews", id);
      if (!iv) return;
      Storage.update("interviews", id, { preparationStatus: sel.value });
      Storage.logActivity(`Preparation for ${iv.candidateName} set to "${sel.value}"`, "🎯");
      Utils.toast(`Preparation status updated to "${sel.value}".`, "success");
      Dashboard.renderAll();
      renderTable();
      renderAllSchedules();
    });
  }

  /* ------------------------- Alert + Countdown ------------------------- */

  function renderTodayAlert() {
    const host = document.getElementById("todayAlertHost");
    if (!host) return;
    const todays = Storage.getAll("interviews").filter(iv => Utils.dayBucket(iv.interviewDate) === "today" && iv.interviewStatus !== "Interview Completed");
    if (!todays.length) { host.innerHTML = ""; return; }
    const next = todays.sort((a, b) => Utils.timeToMinutes(a.interviewTime) - Utils.timeToMinutes(b.interviewTime))[0];
    host.innerHTML = `
      <div class="today-alert">
        <div class="today-alert__pulse"></div>
        <div class="today-alert__body">
          <div class="today-alert__title">🔔 Interview Today</div>
          <div class="today-alert__name">${Utils.escapeHtml(next.candidateName)} · ${Utils.escapeHtml(next.client)}</div>
          <div class="today-alert__meta">${next.interviewTime} · ${next.round}</div>
        </div>
        <div class="today-alert__countdown" id="todayCountdown" data-date="${next.interviewDate}" data-time="${next.interviewTime}">
          Starts in ${Utils.countdown(next.interviewDate, next.interviewTime)}
        </div>
      </div>`;
  }

  function tickCountdown() {
    const el = document.getElementById("todayCountdown");
    if (!el) return;
    el.textContent = `Starts in ${Utils.countdown(el.dataset.date, el.dataset.time)}`;
  }

  /* ------------------------- Table ------------------------- */

  function getFilteredRows() {
    let rows = Storage.getAll("interviews");
    if (tableState.search) {
      const q = tableState.search.toLowerCase();
      rows = rows.filter(r => `${r.candidateName} ${r.client} ${r.round}`.toLowerCase().includes(q));
    }
    const f = tableState.filters;
    if (f.status) rows = rows.filter(r => r.interviewStatus === f.status);
    if (f.client) rows = rows.filter(r => r.client === f.client);
    if (f.round) rows = rows.filter(r => r.round === f.round);
    return rows.sort((a, b) => (a.interviewDate || "").localeCompare(b.interviewDate || ""));
  }

  function renderTable() {
    const tbody = document.getElementById("interviewsTableBody");
    if (!tbody) return;
    const rows = getFilteredRows();
    tbody.innerHTML = rows.map(r => `
      <tr data-id="${r.id}">
        <td data-label="Candidate"><strong>${Utils.escapeHtml(r.candidateName)}</strong></td>
        <td data-label="Client">${Utils.escapeHtml(r.client)}</td>
        <td data-label="Date">${Utils.formatDate(r.interviewDate)}</td>
        <td data-label="Time">${r.interviewTime}</td>
        <td data-label="Round">${r.round}</td>
        <td data-label="Tool Drive">${Utils.escapeHtml(r.doneBy || "Not assigned")}</td>
        <td data-label="Call Support">${Utils.escapeHtml(r.assignedPOC || "Not assigned")}</td>
        <td data-label="Technical POC">${Utils.escapeHtml(technicalPOCFor(r) || "Not set")}</td>
        <td data-label="Status"><span class="badge ${Utils.statusBadgeClass(r.interviewStatus)}">${r.interviewStatus}</span></td>
        <td data-label="Placement"><span class="badge ${Utils.statusBadgeClass(r.placementStatus)}">${r.placementStatus || "Pending"}</span></td>
        <td class="row-actions" data-label="Actions">
          <button class="icon-btn" data-action="view" title="View">👁️</button>
          <button class="icon-btn" data-action="edit" title="Edit">✏️</button>
          <button class="icon-btn icon-btn--danger" data-action="delete" title="Delete">🗑️</button>
        </td>
      </tr>`).join("") || `<tr><td colspan="11" class="empty-hint">No interviews match your search/filters.</td></tr>`;
  }

  function populateFilterOptions() {
    const rows = Storage.getAll("interviews");
    const clientSel = document.getElementById("ivFilterClient");
    if (clientSel) clientSel.innerHTML = `<option value="">All Clients</option>` + [...new Set(rows.map(r => r.client))].map(c => `<option value="${Utils.escapeHtml(c)}">${Utils.escapeHtml(c)}</option>`).join("");
    const roundSel = document.getElementById("ivFilterRound");
    if (roundSel) roundSel.innerHTML = `<option value="">All Rounds</option>` + ROUND_OPTIONS.map(r => `<option>${r}</option>`).join("");
  }

  function bindTableEvents() {
    document.getElementById("interviewSearch")?.addEventListener("input", Utils.debounce(e => {
      tableState.search = e.target.value; renderTable();
    }, 200));
    ["ivFilterStatus", "ivFilterClient", "ivFilterRound"].forEach(id => {
      document.getElementById(id)?.addEventListener("change", e => {
        const key = id === "ivFilterStatus" ? "status" : id === "ivFilterClient" ? "client" : "round";
        tableState.filters[key] = e.target.value;
        renderTable();
      });
    });
    document.getElementById("ivClearFilters")?.addEventListener("click", () => {
      tableState = { search: "", filters: {} };
      document.querySelectorAll("#interviewsFilterBar select, #interviewsFilterBar input").forEach(el => el.value = "");
      renderTable();
    });
    document.getElementById("interviewsTableBody")?.addEventListener("click", async e => {
      const btn = e.target.closest("button[data-action]");
      if (!btn) return;
      const id = btn.closest("tr").dataset.id;
      if (btn.dataset.action === "view") openViewModal(id);
      if (btn.dataset.action === "edit") openModal(id);
      if (btn.dataset.action === "delete") {
        const ok = await Utils.confirmDialog("Delete this interview?", "Are you sure you want to delete this record? This cannot be undone.");
        if (ok) {
          Storage.remove("interviews", id);
          Storage.logActivity("An interview record was deleted", "🗑️");
          renderTable(); renderAllSchedules(); Dashboard.renderAll();
          Utils.toast("Interview deleted.", "success");
        }
      }
    });
    document.getElementById("btnAddInterview")?.addEventListener("click", () => openModal(null));
  }

  /* ------------------------- Modal ------------------------- */

  /**
   * Suggests "Call Support" from whoever supported this candidate's most
   * recent prior interview. Technical POC is NOT suggested/asked — it is
   * the candidate's fixed Candidate POC.
   */
  function suggestCallSupport(candidateName) {
    const prior = Storage.getAll("interviews")
      .filter(i => i.candidateName === candidateName && i.assignedPOC)
      .sort((a, b) => (b.interviewDate || "").localeCompare(a.interviewDate || ""))[0];
    return prior?.assignedPOC || "";
  }

  function openModal(id) {
    const record = id ? Storage.find("interviews", id) : null;
    document.getElementById("interviewModalTitle").textContent = id ? "Edit Interview" : "Add Interview";
    const form = document.getElementById("interviewForm");
    form.reset();
    form.dataset.editingId = id || "";
    form.dataset.assessmentTouched = record?.assessmentId ? "1" : "";

    form.elements.candidateName.value = record?.candidateName || "";
    form.elements.client.value = record?.client || "";
    form.elements.interviewDate.value = record?.interviewDate || Utils.dateISO();
    form.elements.interviewTime.value = record?.interviewTime || "";
    form.elements.duration.value = record?.duration || "60 Minutes";
    form.elements.round.value = record?.round || ROUND_OPTIONS[0];
    populateSelect(form.elements.interviewType, INTERVIEW_TYPE_OPTIONS, record?.interviewType || INTERVIEW_TYPE_OPTIONS[0]);
    form.elements.interviewer.value = record?.interviewer || "";
    populateSelect(form.elements.preparationStatus, PREP_STAGES, record?.preparationStatus || "Not Started");
    form.elements.interviewStatus.value = record?.interviewStatus || "Upcoming Interview";
    form.elements.placementStatus.value = record?.placementStatus || "Pending";
    form.elements.doneBy.value = record?.doneBy || "";           // Tool Drive: manual entry, no dropdown
    populateSelect(form.elements.assignedPOC, ["", ...SUPPORT_TEAM_NAMES()], record?.assignedPOC);

    const datalist = document.getElementById("candidateNamesList");
    if (datalist) datalist.innerHTML = Storage.getAll("candidates").map(c => `<option value="${Utils.escapeHtml(c.name)}">`).join("");

    updateAssignmentHint(form.elements.candidateName.value);
    refreshAssessmentLink(record?.assessmentId || "");
    document.getElementById("interviewModalOverlay").classList.add("is-open");
  }

  function populateSelect(select, options, current) {
    select.innerHTML = options.map(o => `<option value="${Utils.escapeHtml(o)}" ${o === current ? "selected" : ""}>${Utils.escapeHtml(o) || "— Not assigned —"}</option>`).join("");
  }

  /** Info line: fixed Technical POC (read-only) + Call Support suggestion */
  function updateAssignmentHint(candidateName) {
    const hint = document.getElementById("assignmentHint");
    if (!hint) return;
    const form = document.getElementById("interviewForm");
    const name = (candidateName || "").trim();
    const cand = Storage.getAll("candidates").find(c => c.name === name);
    const parts = [];
    if (!name) {
      parts.push("Technical POC is taken from the candidate's profile — it is set once and not asked per interview.");
    } else if (!cand) {
      parts.push(`⚠️ <strong>${Utils.escapeHtml(name)}</strong> isn't in the Candidates list yet. Add them there and set their Technical POC once.`);
    } else if (cand.candidatePOC) {
      parts.push(`✅ Technical POC: <strong>${Utils.escapeHtml(cand.candidatePOC)}</strong> <span class="muted">(fixed on the candidate profile)</span>`);
    } else {
      parts.push(`⚠️ No Technical POC set for <strong>${Utils.escapeHtml(name)}</strong> yet — set it once on the Candidates page.`);
    }
    const suggested = name ? suggestCallSupport(name) : "";
    if (suggested && !form.elements.assignedPOC.value && !form.dataset.editingId) {
      form.elements.assignedPOC.value = suggested;
      parts.push(`Call Support pre-filled with <strong>${Utils.escapeHtml(suggested)}</strong> from the last interview.`);
    }
    hint.innerHTML = parts.join("<br>");
  }

  /* ---- linked assessment (Assessment / Presentation interviews) ---- */

  function assessmentOptionLabel(a) {
    return `${a.type} · ${a.client} · ${Utils.formatDate(a.date)} · ${a.status}`;
  }

  /**
   * Show/hide the "Linked Assessment" block and rebuild its options for
   * the current candidate. Keeps the current pick if still valid,
   * otherwise pre-selects the most recent assessment for the same client.
   */
  function refreshAssessmentLink(preferredId) {
    const form = document.getElementById("interviewForm");
    const box = document.getElementById("linkedAssessmentBox");
    if (!form || !box) return;
    const type = form.elements.interviewType.value;
    box.hidden = !needsAssessment(type);
    if (box.hidden) return;

    const candidate = form.elements.candidateName.value.trim().toLowerCase();
    const client = form.elements.client.value.trim().toLowerCase();
    const mine = Storage.getAll("assessments")
      .filter(a => a.candidateName.trim().toLowerCase() === candidate)
      .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    const sameClient = mine.filter(a => a.client.trim().toLowerCase() === client);

    const sel = form.elements.assessmentId;
    const wanted = preferredId || sel.value;
    sel.innerHTML = `<option value="">— Not linked —</option>` +
      mine.map(a => `<option value="${a.id}">${Utils.escapeHtml(assessmentOptionLabel(a))}</option>`).join("");
    if (wanted && mine.some(a => a.id === wanted)) sel.value = wanted;
    else if (!form.dataset.assessmentTouched && sameClient[0]) sel.value = sameClient[0].id;

    const msg = document.getElementById("linkedAssessmentMsg");
    if (!candidate || !client) {
      msg.className = "linked-msg";
      msg.innerHTML = `Enter the candidate and client to find the assessment for this ${Utils.escapeHtml(type.toLowerCase())}.`;
    } else if (sel.value) {
      msg.className = "linked-msg linked-msg--ok";
      msg.innerHTML = `✅ This ${Utils.escapeHtml(type.toLowerCase())} interview is linked to the assessment above.`;
    } else if (sameClient.length) {
      msg.className = "linked-msg linked-msg--warn";
      msg.innerHTML = `⚠️ Select which assessment this ${Utils.escapeHtml(type.toLowerCase())} belongs to.`;
    } else {
      msg.className = "linked-msg linked-msg--warn";
      msg.innerHTML = `⚠️ No assessment details found for <strong>${Utils.escapeHtml(form.elements.candidateName.value.trim())}</strong> at <strong>${Utils.escapeHtml(form.elements.client.value.trim())}</strong>. Enter the assessment details to link them.`;
    }
  }

  /** Open Add Assessment pre-filled from this interview; when saved, link it back and (optionally) finish saving the interview */
  function enterAssessmentDetails({ thenSubmit }) {
    const form = document.getElementById("interviewForm");
    Assessments.openModal(null, {
      prefill: {
        candidateName: form.elements.candidateName.value.trim(),
        client: form.elements.client.value.trim(),
        interviewDate: form.elements.interviewDate.value
      },
      onSaved: saved => {
        form.dataset.assessmentTouched = "1";
        refreshAssessmentLink(saved.id);
        Utils.toast("Assessment linked to this interview.", "success");
        if (thenSubmit) form.requestSubmit();
      }
    });
  }

  function showAssessmentPrompt(payload) {
    const overlay = document.getElementById("assessmentPromptOverlay");
    overlay.querySelector(".prompt__message").innerHTML =
      `This is a <strong>${Utils.escapeHtml(payload.interviewType)}</strong> interview, but no assessment is linked to it yet ` +
      `(${Utils.escapeHtml(payload.candidateName)} · ${Utils.escapeHtml(payload.client)}). Please enter the assessment details so they can be linked.`;
    overlay.classList.add("is-open");
    const enter = overlay.querySelector(".prompt__enter");
    const skip = overlay.querySelector(".prompt__skip");
    const cancel = overlay.querySelector(".prompt__cancel");
    const cleanup = () => { overlay.classList.remove("is-open"); enter.onclick = skip.onclick = cancel.onclick = null; };
    enter.onclick = () => { cleanup(); enterAssessmentDetails({ thenSubmit: true }); };
    skip.onclick = () => { cleanup(); pendingUnlinked = true; document.getElementById("interviewForm").requestSubmit(); };
    cancel.onclick = cleanup;
  }

  /* ---- assign Tool Drive / Call Support straight from an interview card ---- */

  function openAssignDialog(interviewId, kind) {
    const iv = Storage.find("interviews", interviewId);
    if (!iv) return;
    const overlay = document.getElementById("assignOverlay");
    const isDrive = kind === "tooldrive";
    overlay.querySelector(".assign__title").textContent = isDrive ? "Assign Tool Drive" : "Assign Call Support";
    overlay.querySelector(".assign__sub").textContent = `${iv.candidateName} · ${iv.client} · ${iv.round}`;
    const host = overlay.querySelector(".assign__field");
    host.innerHTML = isDrive
      ? `<label>Tool Drive (who is driving the tool)</label><input type="text" name="person" placeholder="e.g. Karthik" autocomplete="off">`
      : `<label>Call Support</label><select name="person">${populateOptions(SUPPORT_TEAM_NAMES())}</select>`;
    overlay.classList.add("is-open");
    const field = host.querySelector("[name=person]");
    setTimeout(() => field.focus(), 50);

    const save = overlay.querySelector(".assign__save");
    const cancel = overlay.querySelector(".assign__cancel");
    const cleanup = () => { overlay.classList.remove("is-open"); save.onclick = cancel.onclick = null; field.onkeydown = null; };
    const commit = () => {
      const person = (field.value || "").trim();
      if (!person) { Utils.toast(isDrive ? "Enter a name." : "Choose a person.", "warning"); return; }
      const updated = Storage.update("interviews", interviewId, isDrive ? { doneBy: person } : { assignedPOC: person });
      Storage.logActivity(`${person} assigned as ${isDrive ? "Tool Drive" : "Call Support"} for ${iv.candidateName}`, "👤");
      if (isDrive) {
        // Tool Drive earns incentives — recalc now that the person is known (idempotent)
        const cand = Storage.getAll("candidates").find(c => c.name === updated.candidateName);
        Incentives.applyIncentivesForInterview(updated, cand);
        Incentives.renderPage();
      }
      cleanup();
      Utils.toast(`${person} assigned as ${isDrive ? "Tool Drive" : "Call Support"}.`, "success");
      renderTable(); renderAllSchedules(); Dashboard.renderAll();
    };
    save.onclick = commit;
    cancel.onclick = cleanup;
    field.onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); commit(); } };
  }

  function populateOptions(names) {
    return `<option value="">— Choose —</option>` + names.map(n => `<option value="${Utils.escapeHtml(n)}">${Utils.escapeHtml(n)}</option>`).join("");
  }

  function closeModal() {
    document.getElementById("interviewModalOverlay").classList.remove("is-open");
    pendingOverride = false; pendingUnlinked = false;
  }

  function openViewModal(id) {
    const r = Storage.find("interviews", id);
    if (!r) return;
    const rel = relationshipLabel(r);
    document.getElementById("viewModalTitle").textContent = `${r.candidateName} — Interview`;
    document.getElementById("viewModalBody").innerHTML = `
      <div class="view-grid">
        <div class="view-row"><span>Client</span><strong>${Utils.escapeHtml(r.client)}</strong></div>
        <div class="view-row"><span>Date</span><strong>${Utils.formatDate(r.interviewDate)}</strong></div>
        <div class="view-row"><span>Time</span><strong>${r.interviewTime}</strong></div>
        <div class="view-row"><span>Duration</span><strong>${r.duration}</strong></div>
        <div class="view-row"><span>Round</span><strong>${r.round}</strong></div>
        <div class="view-row"><span>Type</span><strong>${Utils.escapeHtml(r.interviewType)}</strong></div>
        <div class="view-row"><span>Interviewer</span><strong>${Utils.escapeHtml(r.interviewer || "—")}</strong></div>
        <div class="view-row"><span>Tool Drive</span><strong>${Utils.escapeHtml(r.doneBy || "Not assigned")}</strong></div>
        <div class="view-row"><span>Call Support</span><strong>${Utils.escapeHtml(r.assignedPOC || "Not assigned")}</strong></div>
        <div class="view-row"><span>Technical POC</span><strong>${Utils.escapeHtml(technicalPOCFor(r) || "Not set")}</strong></div>
        <div class="view-row"><span>Preparation</span><strong>${Utils.escapeHtml(r.preparationStatus)}</strong></div>
        <div class="view-row"><span>Status</span><span class="badge ${Utils.statusBadgeClass(r.interviewStatus)}">${r.interviewStatus}</span></div>
        <div class="view-row"><span>Placement</span><span class="badge ${Utils.statusBadgeClass(r.placementStatus)}">${r.placementStatus || "Pending"}</span></div>
        <div class="view-row view-row--wide"><span>Relationship</span><strong>${rel.label}</strong></div>
        ${rel.assessment ? `<div class="view-row view-row--wide"><span>Linked Assessment</span><strong>${Utils.escapeHtml(assessmentOptionLabel(rel.assessment))}</strong> <button type="button" class="btn btn--ghost btn--sm" id="viewLinkedAssessmentBtn" data-aid="${rel.assessment.id}">View Assessment</button></div>` : ""}
      </div>
      <div class="timeline">
        ${["Assessment", "Interview Scheduled", "Interview Ongoing", "Interview Completed"].map((s, i) => `
          <div class="timeline__step ${i <= rel.stage ? "is-done" : ""}"><span class="timeline__dot"></span>${s}</div>`).join("")}
      </div>`;
    document.getElementById("viewModalOverlay").classList.add("is-open");
    document.getElementById("viewLinkedAssessmentBtn")?.addEventListener("click", e => Assessments.openViewModal(e.currentTarget.dataset.aid));
  }

  function isDuplicate(payload, excludeId) {
    return Storage.getAll("interviews").some(r =>
      r.id !== excludeId &&
      r.candidateName.trim().toLowerCase() === payload.candidateName.trim().toLowerCase() &&
      r.client.trim().toLowerCase() === payload.client.trim().toLowerCase() &&
      r.interviewDate === payload.interviewDate && r.round === payload.round
    );
  }

  let pendingOverride = false;
  let pendingUnlinked = false;

  function bindModalEvents() {
    document.getElementById("interviewModalClose")?.addEventListener("click", closeModal);
    document.getElementById("interviewModalCancel")?.addEventListener("click", closeModal);
    const ivForm = document.getElementById("interviewForm");
    ivForm?.elements.candidateName.addEventListener("input", Utils.debounce(e => { updateAssignmentHint(e.target.value); refreshAssessmentLink(); }, 300));
    ivForm?.elements.client.addEventListener("input", Utils.debounce(() => refreshAssessmentLink(), 300));
    ivForm?.elements.interviewType.addEventListener("change", () => refreshAssessmentLink());
    ivForm?.elements.assessmentId.addEventListener("change", () => { ivForm.dataset.assessmentTouched = "1"; refreshAssessmentLink(); });
    document.getElementById("btnEnterAssessmentDetails")?.addEventListener("click", () => enterAssessmentDetails({ thenSubmit: false }));

    document.getElementById("interviewForm")?.addEventListener("submit", e => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const payload = {};
      ["candidateName", "client", "interviewDate", "interviewTime", "duration", "round", "interviewType",
        "interviewer", "assignedPOC", "preparationStatus", "interviewStatus", "doneBy", "placementStatus", "assessmentId"]
        .forEach(k => payload[k] = (fd.get(k) || "").trim());

      if (!payload.candidateName || !payload.client || !payload.interviewDate || !payload.interviewTime) {
        Utils.toast("Please fill in candidate, client, date and time.", "warning");
        return;
      }
      const editingId = e.target.dataset.editingId;
      if (!needsAssessment(payload.interviewType)) payload.assessmentId = "";

      // Assessment / Presentation interviews must be tied to an assessment
      if (needsAssessment(payload.interviewType) && !payload.assessmentId && !pendingUnlinked) {
        showAssessmentPrompt(payload);
        return;
      }
      pendingUnlinked = false;

      if (!editingId && !pendingOverride && isDuplicate(payload, null)) {
        showDuplicateWarning(payload);
        return;
      }
      pendingOverride = false;

      const matchedAssessment = payload.assessmentId ? Storage.find("assessments", payload.assessmentId) : findMatchingAssessment(payload.candidateName, payload.client);
      if (matchedAssessment && !matchedAssessment.interviewDate) Storage.update("assessments", matchedAssessment.id, { interviewDate: payload.interviewDate });
      payload.assessmentRelated = !!matchedAssessment;
      payload.assessmentDate = matchedAssessment?.date || "";
      payload.assessmentType = matchedAssessment?.type || "";

      let savedRecord;
      if (editingId) {
        savedRecord = Storage.update("interviews", editingId, payload);
        Storage.logActivity(`${payload.doneBy || "A teammate"} updated interview status for ${payload.candidateName}`, "🔄");
        Utils.toast("Interview updated.", "success");
      } else {
        payload.id = Utils.generateId("IV");
        savedRecord = Storage.insert("interviews", payload);
        Storage.logActivity(`${payload.doneBy || "A teammate"} scheduled an interview for ${payload.candidateName}`, "📅");
        Utils.toast("Interview saved.", "success");
        if (matchedAssessment) Utils.toast("Interview generated from Assessment — relationship linked automatically.", "info");
      }

      // Trigger incentive calculation for this interview
      const candidateRecord = Storage.getAll("candidates").find(c => c.name === payload.candidateName);
      Incentives.applyIncentivesForInterview(savedRecord, candidateRecord);

      closeModal();
      renderTable();
      renderAllSchedules();
      populateFilterOptions();
      Assessments.renderTable();
      Dashboard.renderAll();
      Incentives.renderPage();
    });
  }

  function showDuplicateWarning(payload) {
    const overlay = document.getElementById("duplicateOverlay");
    overlay.querySelector(".duplicate__message").textContent =
      `A similar interview already exists for ${payload.candidateName} at ${payload.client} (${payload.round}) on ${Utils.formatDate(payload.interviewDate)}.`;
    overlay.classList.add("is-open");
    const viewBtn = overlay.querySelector(".duplicate__view");
    const continueBtn = overlay.querySelector(".duplicate__continue");
    const cancelBtn = overlay.querySelector(".duplicate__cancel");
    const cleanup = () => { overlay.classList.remove("is-open"); viewBtn.onclick = continueBtn.onclick = cancelBtn.onclick = null; };
    viewBtn.onclick = () => { cleanup(); closeModal(); Nav.goTo("interviews"); };
    continueBtn.onclick = () => { cleanup(); pendingOverride = true; document.getElementById("interviewForm").requestSubmit(); };
    cancelBtn.onclick = cleanup;
  }

  /* ------------------------- Calendar ------------------------- */

  function renderCalendar() {
    const host = document.getElementById("calendarGrid");
    if (!host) return;
    const days = [0, 1, 2, 3, 4, 5, 6];
    host.innerHTML = days.map(offset => {
      const dt = new Date(); dt.setDate(dt.getDate() + offset);
      const dateStr = Utils.dateISO(dt);
      const rows = Storage.getAll("interviews").filter(iv => iv.interviewDate === dateStr)
        .sort((a, b) => Utils.timeToMinutes(a.interviewTime) - Utils.timeToMinutes(b.interviewTime));
      return `
        <div class="cal-day">
          <div class="cal-day__header">
            <span>${dt.toLocaleDateString("en-IN", { weekday: "short" })}</span>
            <strong>${dt.getDate()}</strong>
          </div>
          <div class="cal-day__events">
            ${rows.map(r => `
              <div class="cal-event" data-id="${r.id}">
                <span class="cal-event__time">${r.interviewTime.replace(" IST", "")}</span>
                <span class="cal-event__name">${Utils.escapeHtml(r.candidateName)}</span>
                <span class="cal-event__client">${Utils.escapeHtml(r.client)} · ${r.round.split(" ")[0]}</span>
              </div>`).join("") || `<div class="cal-day__empty">No interviews</div>`}
          </div>
        </div>`;
    }).join("");

    host.querySelectorAll(".cal-event").forEach(el => el.addEventListener("click", () => openViewModal(el.dataset.id)));
  }

  function renderAllSchedules() {
    renderScheduleSection("today", "todayInterviews", "No interviews scheduled for today.");
    renderScheduleSection("tomorrow", "tomorrowInterviews", "No interviews scheduled for tomorrow.");
    renderScheduleSection("dayafter", "dayAfterInterviews", "No interviews scheduled for the day after tomorrow.");
    renderTodayAlert();
    renderCalendar();
  }

  function init() {
    populateFilterOptions();
    bindTableEvents();
    bindModalEvents();
    renderTable();
    renderAllSchedules();
    document.querySelectorAll(".schedule-section, #calendarGrid").forEach(bindCardActions);
    setInterval(tickCountdown, 60000);
  }

  return { init, renderAllSchedules, renderTable, findMatchingAssessment, linkedAssessment, technicalPOCFor, relationshipLabel, ROUND_OPTIONS, STATUS_OPTIONS, PLACEMENT_OPTIONS, INTERVIEW_TYPE_OPTIONS, PREP_STAGES, openModal };
})();
