/* ============================================================
   TTOP – dashboard.js
   Everything on the main landing page: summary cards, the
   assessment->interview pipeline, simple CSS/JS charts,
   activity feed, notifications, gamification progress and the
   "My Work" personal view.
   ============================================================ */

const Dashboard = (() => {

  function counts() {
    const assessments = Storage.getAll("assessments");
    const interviews = Storage.getAll("interviews");
    const incentives = Storage.getAll("incentives");
    return {
      totalAssessments: assessments.length,
      pendingAssessments: assessments.filter(a => a.status === "Assessment Pending").length,
      completedAssessments: assessments.filter(a => a.status !== "Assessment Pending").length,
      upcomingInterviews: interviews.filter(i => i.interviewStatus === "Upcoming Interview").length,
      todayInterviews: interviews.filter(i => Utils.dayBucket(i.interviewDate) === "today").length,
      tomorrowInterviews: interviews.filter(i => Utils.dayBucket(i.interviewDate) === "tomorrow").length,
      completedInterviews: interviews.filter(i => i.interviewStatus === "Interview Completed").length,
      totalIncentives: incentives.reduce((s, i) => s + Number(i.amount || 0), 0),
      candidatesInProgress: Storage.getAll("candidates").filter(c => Candidates.computeCandidateStatus(c.name) !== "New").length
    };
  }

  function renderSummaryCards() {
    const c = counts();
    const weekAgo = Utils.dateISO(new Date(Date.now() - 6 * 86400000));
    const addedThisWeek = Storage.getAll("assessments").filter(a => a.date && a.date >= weekAgo).length;
    const cards = [
      { icon: "📋", label: "Total Assessments", value: c.totalAssessments, trend: `${addedThisWeek} added in the last 7 days` },
      { icon: "⏳", label: "Assessments Pending", value: c.pendingAssessments, trend: "Needs attention" },
      { icon: "✅", label: "Assessments Completed", value: c.completedAssessments, trend: "On track" },
      { icon: "📅", label: "Upcoming Interviews", value: c.upcomingInterviews, trend: "Next 7 days" },
      { icon: "☀️", label: "Interviews Today", value: c.todayInterviews, trend: "Live" },
      { icon: "🌤️", label: "Interviews Tomorrow", value: c.tomorrowInterviews, trend: "Prepare ahead" },
      { icon: "🏁", label: "Interviews Completed", value: c.completedInterviews, trend: "This cycle" },
      { icon: "💰", label: "Total Incentives", value: Utils.formatCurrency(c.totalIncentives), trend: "Team-wide" },
      { icon: "🧑‍💻", label: "Candidates in Progress", value: c.candidatesInProgress, trend: "Active pipeline" }
    ];
    const host = document.getElementById("summaryCards");
    if (host) host.innerHTML = cards.map(c => `
      <div class="stat-card">
        <div class="stat-card__icon">${c.icon}</div>
        <div class="stat-card__value">${c.value}</div>
        <div class="stat-card__label">${c.label}</div>
        <div class="stat-card__trend">${c.trend}</div>
      </div>`).join("");
  }

  /* ------------------------- Simple CSS/JS charts ------------------------- */

  function renderAssessmentCharts() {
    const assessments = Storage.getAll("assessments");
    const byType = {
      "Take Home": assessments.filter(a => a.type === "Take Home").length,
      "Portal": assessments.filter(a => a.type === "Portal").length,
      "Coding Assessment": assessments.filter(a => a.type === "Coding Assessment").length
    };
    const byStatus = {
      "Pending": assessments.filter(a => a.status === "Assessment Pending").length,
      "Completed": assessments.filter(a => a.status !== "Assessment Pending").length
    };

    const typeHost = document.getElementById("chartByType");
    if (typeHost) {
      const max = Math.max(1, ...Object.values(byType));
      typeHost.innerHTML = Object.entries(byType).map(([label, val]) => `
        <div class="bar-row">
          <span class="bar-row__label">${label}</span>
          <div class="bar-row__track"><div class="bar-row__fill" style="width:${(val / max) * 100}%"></div></div>
          <span class="bar-row__value">${val}</span>
        </div>`).join("");
    }

    const statusHost = document.getElementById("chartByStatus");
    if (statusHost) {
      const total = byStatus.Pending + byStatus.Completed || 1;
      const pendingPct = Math.round((byStatus.Pending / total) * 100);
      statusHost.innerHTML = `
        <div class="donut" style="--pct:${pendingPct}">
          <div class="donut__hole">
            <strong>${100 - pendingPct}%</strong>
            <span>Completed</span>
          </div>
        </div>
        <div class="donut-legend">
          <span><i class="dot dot--amber"></i> Pending (${byStatus.Pending})</span>
          <span><i class="dot dot--green"></i> Completed (${byStatus.Completed})</span>
        </div>`;
    }
  }

  /* ------------------------- Activity feed & Notifications ------------------------- */

  function renderActivity() {
    const host = document.getElementById("activityFeed");
    if (!host) return;
    const items = Storage.getAll("activity").slice(0, 12);
    host.innerHTML = items.map(a => `
      <div class="activity-row">
        <span class="activity-row__icon">${a.icon}</span>
        <span class="activity-row__text">${Utils.escapeHtml(a.text)}</span>
        <span class="activity-row__time">${Utils.timeAgo(a.ts)}</span>
      </div>`).join("") || `<p class="empty-hint">No recent activity yet.</p>`;
  }

  function buildNotifications() {
    const notes = [];
    const interviews = Storage.getAll("interviews");
    const assessments = Storage.getAll("assessments");
    const candidates = Storage.getAll("candidates");

    interviews.filter(i => Utils.dayBucket(i.interviewDate) === "today" && i.interviewStatus !== "Interview Completed")
      .forEach(i => notes.push({ text: `Interview today at ${i.interviewTime} – ${i.candidateName}`, type: "warning" }));

    assessments.filter(a => a.status === "Assessment Completed" && !Interviews.findMatchingAssessment(a.candidateName, a.client))
      .forEach(() => {});
    assessments.filter(a => a.status === "Assessment Completed").forEach(a => {
      const hasInterview = interviews.some(i => i.candidateName === a.candidateName && i.client === a.client);
      if (!hasInterview) notes.push({ text: `Assessment completed but interview not scheduled – ${a.candidateName}`, type: "info" });
    });

    interviews.filter(i => i.interviewStatus !== "Interview Completed" && i.interviewStatus !== "Cancelled").forEach(i => {
      const missing = [!i.doneBy && "Tool Drive", !i.assignedPOC && "Call Support"].filter(Boolean);
      if (missing.length) notes.push({ text: `${missing.join(" & ")} not assigned for ${i.candidateName}`, type: "warning" });
    });

    interviews.filter(i => /final/i.test(i.round) && i.interviewStatus === "Interview Completed" && i.placementStatus === "Pending")
      .forEach(i => notes.push({ text: `Final interview completed – placement status required for ${i.candidateName}`, type: "warning" }));

    Storage.getAll("incentives").filter(inc => inc.amount > 0).slice(0, 3)
      .forEach(inc => notes.push({ text: `Incentive on record: ₹${inc.amount.toLocaleString("en-IN")} for ${inc.toolDrivePerson || inc.candidatePOC}`, type: "success" }));

    return notes.slice(0, 10);
  }

  function renderNotifications() {
    const host = document.getElementById("notificationList");
    const badge = document.getElementById("notificationBadge");
    if (!host) return;
    const notes = buildNotifications();
    host.innerHTML = notes.map(n => `
      <div class="notification-row notification-row--${n.type}">
        <span class="notification-row__dot"></span>
        <span>${Utils.escapeHtml(n.text)}</span>
      </div>`).join("") || `<p class="empty-hint">You're all caught up 🎉</p>`;
    if (badge) {
      if (notes.length) { badge.textContent = notes.length; badge.classList.remove("is-hidden"); }
      else badge.classList.add("is-hidden");
    }
  }

  function pushNotification(text, type = "info") {
    Utils.toast(text, type);
    renderNotifications();
  }

  /* ------------------------- Gamification ------------------------- */

  function renderGamification() {
    const host = document.getElementById("todaysProgress");
    if (!host) return;
    const today = Utils.dateISO();
    const isDone = a => a.status !== "Assessment Pending";
    const PREPARED = ["Mock Call Done", "Completed"];   // "In Progress" is not prepared yet

    const allAssessments = Storage.getAll("assessments");
    const allInterviews = Storage.getAll("interviews");

    // 1) Assessments dated today
    const aToday = allAssessments.filter(a => a.date === today);
    const aDone = aToday.filter(isDone).length;

    // 2) Interviews happening today or tomorrow that have been prepared
    const soon = allInterviews.filter(i => ["today", "tomorrow"].includes(Utils.dayBucket(i.interviewDate)));
    const prepared = soon.filter(i => PREPARED.includes(i.preparationStatus)).length;

    // 3) Everything due today: today's assessments + today's interviews
    const ivToday = allInterviews.filter(i => i.interviewDate === today);
    const ivDone = ivToday.filter(i => i.interviewStatus === "Interview Completed").length;
    const tasksTotal = aToday.length + ivToday.length;
    const tasksDone = aDone + ivDone;

    const pct = (done, total) => total ? Math.round((done / total) * 100) : null;
    const bars = [
      { label: "Assessments Completed", done: aDone, total: aToday.length, empty: "No assessments today" },
      { label: "Interviews Prepared (today & tomorrow)", done: prepared, total: soon.length, empty: "No interviews today or tomorrow" },
      { label: "Tasks Completed", done: tasksDone, total: tasksTotal, empty: "Nothing due today" }
    ].map(b => ({ ...b, pct: pct(b.done, b.total) }));

    host.innerHTML = bars.map(b => b.pct === null ? `
      <div class="progress-row">
        <div class="progress-row__head"><span>${b.label}</span><span class="muted">${b.empty}</span></div>
        <div class="progress-row__track"></div>
      </div>` : `
      <div class="progress-row">
        <div class="progress-row__head"><span>${b.label}</span><strong>${b.done} of ${b.total} · ${b.pct}%</strong></div>
        <div class="progress-row__track"><div class="progress-row__fill" style="width:${b.pct}%"></div></div>
      </div>`).join("");

    const badgeHost = document.getElementById("achievementBadges");
    if (badgeHost) {
      const overduePending = allAssessments.filter(a => !isDone(a) && a.date && a.date < today).length;
      const badges = [
        { name: "Assessment Finisher", earned: bars[0].pct !== null && bars[0].pct >= 80 },
        { name: "Interview Ready", earned: bars[1].pct !== null && bars[1].pct >= 60 },
        { name: "Fast Responder", earned: allAssessments.length > 0 && overduePending === 0 },
        { name: "Client Champion", earned: Storage.getAll("incentives").some(i => (i.incentiveType || "").includes("Same Client")) },
        { name: "Final Round Success", earned: allInterviews.some(i => i.placementStatus === "Placed") }
      ];
      badgeHost.innerHTML = badges.map(b => `
        <div class="achievement ${b.earned ? "is-earned" : ""}">
          <span class="achievement__icon">${b.earned ? "🏆" : "🔒"}</span>
          <span>${b.name}</span>
        </div>`).join("");
    }
  }

  /* ------------------------- My Work ------------------------- */

  function renderMyWork() {
    const select = document.getElementById("myWorkPerson");
    if (!select) return;
    const team = [...Storage.getAll("supportTeam"), ...Storage.getAll("candidatePocTeam")];
    if (!select.dataset.filled) {
      select.innerHTML = team.map(t => `<option value="${t.name}">${t.name}</option>`).join("");
      select.dataset.filled = "1";
      const me = Auth.currentUser()?.name;
      const saved = Storage.getSettings().myWorkPerson;
      select.value = (saved && team.some(t => t.name === saved)) ? saved
        : (me && team.some(t => t.name === me)) ? me
        : team[0]?.name;
    }
    updateMyWork(select.value);
    select.onchange = () => {
      Storage.saveSettings({ myWorkPerson: select.value });
      updateMyWork(select.value);
    };
  }

  function updateMyWork(name) {
    // Tool Drive lives on the interview now; an assessment counts as "mine" when I'm Tool Drive on its interview
    const allInterviews = Storage.getAll("interviews");
    const assessments = Storage.getAll("assessments").filter(a => Assessments.getToolDrive(a) === name);
    const interviews = allInterviews.filter(i => i.doneBy === name || i.assignedPOC === name);
    const pending = assessments.filter(a => a.status === "Assessment Pending").length;
    const incentives = Storage.getAll("incentives").filter(i => i.toolDrivePerson === name || i.candidatePOC === name)
      .reduce((s, i) => s + Number(i.amount || 0), 0);
    const completed = assessments.filter(a => a.status !== "Assessment Pending").length + interviews.filter(i => i.interviewStatus === "Interview Completed").length;

    const host = document.getElementById("myWorkStats");
    if (!host) return;
    const items = [
      { label: "My Assessments", value: assessments.length },
      { label: "My Interviews", value: interviews.length },
      { label: "My Pending Tasks", value: pending },
      { label: "My Incentives", value: Utils.formatCurrency(incentives) },
      { label: "My Completed Work", value: completed }
    ];
    host.innerHTML = items.map(i => `
      <div class="mywork-stat">
        <div class="mywork-stat__value">${i.value}</div>
        <div class="mywork-stat__label">${i.label}</div>
      </div>`).join("");
  }

  function renderAll() {
    renderSummaryCards();
    renderAssessmentCharts();
    renderActivity();
    renderNotifications();
    renderGamification();
    renderMyWork();
    Incentives.renderLeaderboard("incentiveLeaderboardDash");
  }

  return { renderAll, renderNotifications, pushNotification, counts };
})();
