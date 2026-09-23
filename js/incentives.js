/* ============================================================
   TTOP – incentives.js
   Incentive calculation engine (calculateIncentive) plus all
   rendering for the Incentives page: summary cards, leaderboard,
   and the incentive history table.

   RULES IMPLEMENTED (see Add Interview flow for where this is
   triggered):
   1. First interview for a candidate+client -> no incentive.
   2. Round 1 -> Round 2 for the same candidate+client -> ₹100
      to the Tool Drive person.
   3. Any later progression (Round 2->3, 3->4, ...) for the same
      candidate+client -> ₹500 to the Tool Drive person.
   4. Final round interview where the candidate is Placed ->
      ₹2,000 to the Tool Drive person + ₹2,000 to the Candidate
      POC (₹4,000 total). If both roles are the same person,
      one combined ₹4,000 record is created instead of two.
   Every incentive record gets a unique id and duplicate
   protection is handled by the caller (interviews.js) which
   only calls this once per newly-saved interview.
   ============================================================ */

const Incentives = (() => {

  function parseRoundNumber(roundStr) {
    if (!roundStr) return null;
    const m = roundStr.match(/(\d+)/);
    if (m) return parseInt(m[1], 10);
    if (/final/i.test(roundStr)) return 99; // treat unlabeled "Final Round" as highest
    return null;
  }

  function isFinalRound(roundStr) {
    return /final/i.test(roundStr || "");
  }

  /**
   * Core rule engine. Returns an array of incentive line-items
   * (not yet saved) for a single interview record that was just
   * added or edited.
   *
   * toolDrivePerson always comes from the interview's "Done By"
   * field (manual entry — the person who drove the tool for this
   * interview). candidatePOC always comes from the candidate's
   * own "Candidate POC" assignment — never falls back to the
   * Support POC, since those are two distinct roles/teams.
   *
   * @param {object} interview - the interview record being evaluated
   * @param {object[]} allInterviews - full interview history (excluding this one, or including - we filter)
   * @param {object|null} candidateRecord - candidate profile, for Candidate POC lookup
   */
  function calculateIncentive(interview, allInterviews, candidateRecord) {
    const results = [];
    const sameClientHistory = allInterviews.filter(iv =>
      iv.id !== interview.id &&
      iv.candidateName === interview.candidateName &&
      iv.client === interview.client &&
      iv.interviewDate && interview.interviewDate &&
      iv.interviewDate < interview.interviewDate
    );

    const toolDrivePerson = (interview.doneBy || "").trim();
    const candidatePOC = (candidateRecord && candidateRecord.candidatePOC) ? candidateRecord.candidatePOC.trim() : "";
    const currentRoundNum = parseRoundNumber(interview.round);

    const isFirstInterview = sameClientHistory.length === 0;

    if (!isFirstInterview) {
      // find the highest previous round number for this candidate+client
      const prevRounds = sameClientHistory.map(iv => parseRoundNumber(iv.round)).filter(n => n !== null);
      const prevMax = prevRounds.length ? Math.max(...prevRounds) : null;

      if (prevMax === 1 && currentRoundNum === 2) {
        results.push({
          incentiveType: "Round Progression Bonus",
          toolDrivePerson, candidatePOC: "",
          amount: 100,
          reason: "Interview Progression (Round 1 → Round 2)"
        });
      } else if (prevMax !== null && currentRoundNum && currentRoundNum > prevMax) {
        results.push({
          incentiveType: "Same Client Interview",
          toolDrivePerson, candidatePOC: "",
          amount: 500,
          reason: `Subsequent interview with the same client (Round ${prevMax} → ${currentRoundNum})`
        });
      }
    }

    if (isFinalRound(interview.round) && interview.placementStatus === "Placed") {
      if (toolDrivePerson && candidatePOC && toolDrivePerson === candidatePOC) {
        results.push({
          incentiveType: "Final Interview + Placement (Combined)",
          toolDrivePerson, candidatePOC,
          amount: 4000,
          reason: "Final interview completed and candidate placed — same person is Tool Drive and Candidate POC"
        });
      } else {
        if (toolDrivePerson) {
          results.push({
            incentiveType: "Final Interview + Placement (Tool Drive)",
            toolDrivePerson, candidatePOC: "",
            amount: 2000,
            reason: "Final interview completed and candidate placed"
          });
        }
        if (candidatePOC) {
          results.push({
            incentiveType: "Final Interview + Placement (Candidate POC)",
            toolDrivePerson: "", candidatePOC,
            amount: 2000,
            reason: "Final interview completed and candidate placed"
          });
        }
      }
    }

    return results.map(r => ({
      id: Utils.generateId("INC"),
      candidate: interview.candidateName,
      client: interview.client,
      round: interview.round,
      date: interview.interviewDate,
      status: "Pending",
      ...r
    }));
  }

  /**
   * Persist calculated incentives, log activity + notifications.
   * Idempotent per interview: re-saving/editing an interview (or
   * assigning its Tool Drive person later from the dashboard card)
   * never creates a second record for the same candidate + client +
   * round + incentive type. If the existing record was created while
   * Tool Drive was still blank, it is filled in instead.
   */
  function applyIncentivesForInterview(interview, candidateRecord) {
    const allInterviews = Storage.getAll("interviews");
    const existing = Storage.getAll("incentives");
    const created = [];
    calculateIncentive(interview, allInterviews, candidateRecord).forEach(inc => {
      const dup = existing.find(e => e.candidate === inc.candidate && e.client === inc.client &&
        e.round === inc.round && e.incentiveType === inc.incentiveType);
      if (dup) {
        const patch = {};
        if (!dup.toolDrivePerson && inc.toolDrivePerson) patch.toolDrivePerson = inc.toolDrivePerson;
        if (!dup.candidatePOC && inc.candidatePOC) patch.candidatePOC = inc.candidatePOC;
        if (Object.keys(patch).length) Storage.update("incentives", dup.id, patch);
        return;
      }
      Storage.insert("incentives", inc);
      created.push(inc);
      Storage.logActivity(`₹${inc.amount.toLocaleString("en-IN")} incentive generated (${inc.incentiveType})`, "💰");
      if (App.pushNotification) {
        App.pushNotification(`New incentive generated: ₹${inc.amount.toLocaleString("en-IN")}`, "success");
      }
    });
    return created;
  }

  /* ------------------------ Rendering ------------------------ */

  function allTeamNames() {
    const support = Storage.getAll("supportTeam").map(t => t.name);
    const cpoc = Storage.getAll("candidatePocTeam").map(t => t.name);
    return [...new Set([...support, ...cpoc])];
  }

  function leaderboardData() {
    const incentives = Storage.getAll("incentives");
    const totals = {};
    allTeamNames().forEach(name => totals[name] = 0);
    incentives.forEach(inc => {
      // A combined record (same person is Tool Drive AND Candidate POC) carries that name in both
      // fields. Credit each distinct person exactly once per record, otherwise the ₹4,000 is counted
      // twice and shows as ₹8,000.
      const people = new Set([inc.toolDrivePerson, inc.candidatePOC].filter(Boolean));
      people.forEach(name => { totals[name] = (totals[name] || 0) + Number(inc.amount || 0); });
    });
    return Object.entries(totals).sort((a, b) => b[1] - a[1]);
  }

  function renderSummaryCards() {
    const incentives = Storage.getAll("incentives");
    const total = incentives.reduce((s, i) => s + Number(i.amount || 0), 0);
    const now = new Date();
    const thisMonth = incentives.filter(i => {
      const dt = new Date(i.date);
      return dt.getMonth() === now.getMonth() && dt.getFullYear() === now.getFullYear();
    }).reduce((s, i) => s + Number(i.amount || 0), 0);
    const today = incentives.filter(i => Utils.dayBucket(i.date) === "today").reduce((s, i) => s + Number(i.amount || 0), 0);
    const pending = incentives.filter(i => i.status === "Pending").reduce((s, i) => s + Number(i.amount || 0), 0);

    const cards = [
      { label: "Total Incentive", value: Utils.formatCurrency(total), icon: "💰" },
      { label: "This Month", value: Utils.formatCurrency(thisMonth), icon: "📅" },
      { label: "Today", value: Utils.formatCurrency(today), icon: "☀️" },
      { label: "Pending", value: Utils.formatCurrency(pending), icon: "⏳" }
    ];
    return cards.map(c => `
      <div class="mini-card">
        <div class="mini-card__icon">${c.icon}</div>
        <div class="mini-card__value">${c.value}</div>
        <div class="mini-card__label">${c.label}</div>
      </div>`).join("");
  }

  function renderLeaderboard(containerId) {
    const data = leaderboardData();
    const max = Math.max(1, ...data.map(([, v]) => v));
    const host = document.getElementById(containerId);
    if (!host) return;
    host.innerHTML = data.map(([name, amt], idx) => `
      <div class="leader-row">
        <div class="leader-row__rank">#${idx + 1}</div>
        <div class="leader-row__avatar">${Utils.initials(name)}</div>
        <div class="leader-row__info">
          <div class="leader-row__name">${Utils.escapeHtml(name)}</div>
          <div class="leader-row__bar"><div class="leader-row__bar-fill" style="width:${(amt / max) * 100}%"></div></div>
        </div>
        <div class="leader-row__amount">${Utils.formatCurrency(amt)}</div>
      </div>`).join("") || `<p class="empty-hint">No incentive data yet.</p>`;
  }

  function renderHistoryTable(filters = {}) {
    let rows = Storage.getAll("incentives");
    if (filters.person) rows = rows.filter(r => r.toolDrivePerson === filters.person || r.candidatePOC === filters.person);
    if (filters.client) rows = rows.filter(r => r.client === filters.client);
    if (filters.type) rows = rows.filter(r => r.incentiveType === filters.type);
    if (filters.search) {
      const q = filters.search.toLowerCase();
      rows = rows.filter(r => (r.candidate + r.client + r.incentiveType).toLowerCase().includes(q));
    }
    rows = rows.sort((a, b) => (b.date || "").localeCompare(a.date || ""));

    const tbody = document.getElementById("incentiveHistoryBody");
    if (!tbody) return;
    tbody.innerHTML = rows.map(r => `
      <tr>
        <td data-label="Date">${Utils.formatDate(r.date)}</td>
        <td data-label="Candidate">${Utils.escapeHtml(r.candidate)}</td>
        <td data-label="Client">${Utils.escapeHtml(r.client)}</td>
        <td data-label="Round">${Utils.escapeHtml(r.round || "—")}</td>
        <td data-label="Reason">${Utils.escapeHtml(r.reason || r.incentiveType)}</td>
        <td data-label="Tool Drive">${Utils.escapeHtml(r.toolDrivePerson || "—")}</td>
        <td data-label="Candidate POC">${Utils.escapeHtml(r.candidatePOC || "—")}</td>
        <td class="text-right" data-label="Amount"><strong>${Utils.formatCurrency(r.amount)}</strong></td>
        <td data-label="Status"><span class="badge ${Utils.statusBadgeClass(r.status)}">${r.status}</span></td>
      </tr>`).join("") || `<tr><td colspan="9" class="empty-hint">No incentive records match your filters.</td></tr>`;
  }

  function populateFilterOptions() {
    const rows = Storage.getAll("incentives");
    const clients = [...new Set(rows.map(r => r.client))];
    const types = [...new Set(rows.map(r => r.incentiveType))];

    const personSel = document.getElementById("incFilterPerson");
    const clientSel = document.getElementById("incFilterClient");
    const typeSel = document.getElementById("incFilterType");
    const keep = { p: personSel?.value, c: clientSel?.value, t: typeSel?.value };
    if (personSel) personSel.innerHTML = `<option value="">All People</option>` + allTeamNames().map(n => `<option value="${n}">${n}</option>`).join("");
    if (clientSel) clientSel.innerHTML = `<option value="">All Clients</option>` + clients.map(c => `<option value="${Utils.escapeHtml(c)}">${Utils.escapeHtml(c)}</option>`).join("");
    if (typeSel) typeSel.innerHTML = `<option value="">All Types</option>` + types.map(t => `<option value="${Utils.escapeHtml(t)}">${Utils.escapeHtml(t)}</option>`).join("");
    // keep whatever the user had selected when data is refreshed
    if (personSel && [...personSel.options].some(o => o.value === keep.p)) personSel.value = keep.p;
    if (clientSel && [...clientSel.options].some(o => o.value === keep.c)) clientSel.value = keep.c;
    if (typeSel && [...typeSel.options].some(o => o.value === keep.t)) typeSel.value = keep.t;
  }

  function renderPage() {
    const summaryHost = document.getElementById("incentiveSummaryCards");
    if (summaryHost) summaryHost.innerHTML = renderSummaryCards();
    renderLeaderboard("incentiveLeaderboard");
    populateFilterOptions();
    renderHistoryTable({
      person: document.getElementById("incFilterPerson")?.value,
      client: document.getElementById("incFilterClient")?.value,
      type: document.getElementById("incFilterType")?.value,
      search: document.getElementById("incSearch")?.value
    });
  }

  function bindFilters() {
    ["incFilterPerson", "incFilterClient", "incFilterType", "incSearch"].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      const handler = () => renderHistoryTable({
        person: document.getElementById("incFilterPerson")?.value,
        client: document.getElementById("incFilterClient")?.value,
        type: document.getElementById("incFilterType")?.value,
        search: document.getElementById("incSearch")?.value
      });
      el.addEventListener(el.tagName === "SELECT" ? "change" : "input", Utils.debounce(handler, 150));
    });
  }

  return { calculateIncentive, applyIncentivesForInterview, leaderboardData, renderPage, bindFilters, renderLeaderboard, allTeamNames };
})();
