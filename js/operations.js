/* ============================================================
   TTOP – operations.js
   PRD V3 §21 Today's Interviews (its own page, not just a Dashboard
   widget) and §22 Calendar (Month view + a day panel; Week/Day views
   are not implemented yet — see the Phase 2 notes).
   Both reuse Interviews.interviewCardHTML/bindCardActions so a card
   here behaves exactly like a card on the Dashboard or Calendar.
   ============================================================ */

const TodayInterviews = (() => {
  let state = { from: Utils.dateISO(), to: Utils.dateISO(), status: "", type: "", source: "", poc: "", client: "" };

  function matches(iv) {
    if (iv.interviewDate < state.from || iv.interviewDate > state.to) return false;
    if (state.status && iv.interviewStatus !== state.status) return false;
    if (state.type && iv.interviewType !== state.type) return false;
    if (state.source && iv.source !== state.source) return false;
    if (state.client && iv.client !== state.client) return false;
    if (state.poc && Interviews.technicalPOCFor(iv) !== state.poc) return false;
    return true;
  }

  function render() {
    const rows = Storage.getAll("interviews").filter(matches).sort((a, b) => (a.interviewDate + a.interviewTime).localeCompare(b.interviewDate + b.interviewTime));
    const host = document.getElementById("todayInterviewsGrid");
    if (!host) return;
    host.innerHTML = rows.map(Interviews.interviewCardHTML).join("") ||
      `<p class="empty-hint">No interviews match this range/filters.</p>`;
    Interviews.bindCardActions(host);
    document.getElementById("todayInterviewsCount").textContent = `${rows.length} interview(s)`;
  }

  function populateFilterOptions() {
    const rows = Storage.getAll("interviews");
    const set = (id, values, allLabel) => {
      const sel = document.getElementById(id);
      if (sel) sel.innerHTML = `<option value="">${allLabel}</option>` + [...new Set(values)].filter(Boolean).sort().map(v => `<option value="${Utils.escapeHtml(v)}">${Utils.escapeHtml(v)}</option>`).join("");
    };
    set("tiFilterStatus", Interviews.STATUS_OPTIONS, "All Statuses");
    set("tiFilterType", Interviews.INTERVIEW_TYPE_OPTIONS, "All Types");
    set("tiFilterSource", Interviews.SOURCE_OPTIONS, "All Sources");
    set("tiFilterClient", rows.map(r => r.client), "All Clients");
    set("tiFilterPOC", rows.map(Interviews.technicalPOCFor), "All Technical POCs");
  }

  function bind() {
    document.getElementById("tiFrom").addEventListener("change", e => { state.from = e.target.value; render(); });
    document.getElementById("tiTo").addEventListener("change", e => { state.to = e.target.value; render(); });
    document.getElementById("tiFilterStatus").addEventListener("change", e => { state.status = e.target.value; render(); });
    document.getElementById("tiFilterType").addEventListener("change", e => { state.type = e.target.value; render(); });
    document.getElementById("tiFilterSource").addEventListener("change", e => { state.source = e.target.value; render(); });
    document.getElementById("tiFilterClient").addEventListener("change", e => { state.client = e.target.value; render(); });
    document.getElementById("tiFilterPOC").addEventListener("change", e => { state.poc = e.target.value; render(); });
    document.getElementById("tiToday").addEventListener("click", () => {
      state.from = state.to = Utils.dateISO();
      document.getElementById("tiFrom").value = document.getElementById("tiTo").value = state.from;
      render();
    });
    document.getElementById("tiClear").addEventListener("click", () => {
      state = { from: Utils.dateISO(), to: Utils.dateISO(), status: "", type: "", source: "", poc: "", client: "" };
      document.querySelectorAll("#todayInterviewsFilterBar select").forEach(el => el.value = "");
      document.getElementById("tiFrom").value = document.getElementById("tiTo").value = state.from;
      render();
    });
    document.getElementById("btnAddInterviewToday")?.addEventListener("click", () => Interviews.openModal(null));
  }

  function init() {
    document.getElementById("tiFrom").value = state.from;
    document.getElementById("tiTo").value = state.to;
    populateFilterOptions();
    bind();
    render();
  }

  return { init, render, populateFilterOptions };
})();


const Calendar = (() => {
  let cursor = new Date(); cursor.setDate(1); // first of the displayed month
  let selectedDate = null;
  let filters = { status: "", type: "", source: "", poc: "", client: "" };

  function matches(iv) {
    if (filters.status && iv.interviewStatus !== filters.status) return false;
    if (filters.type && iv.interviewType !== filters.type) return false;
    if (filters.source && iv.source !== filters.source) return false;
    if (filters.client && iv.client !== filters.client) return false;
    if (filters.poc && Interviews.technicalPOCFor(iv) !== filters.poc) return false;
    return true;
  }

  function interviewsByDate() {
    const map = {};
    Storage.getAll("interviews").filter(matches).forEach(iv => {
      (map[iv.interviewDate] = map[iv.interviewDate] || []).push(iv);
    });
    return map;
  }

  function renderGrid() {
    const label = document.getElementById("calMonthLabel");
    if (label) label.textContent = cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" });

    const byDate = interviewsByDate();
    const year = cursor.getFullYear(), month = cursor.getMonth();
    const firstWeekday = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const todayISO = Utils.dateISO();

    let cells = "";
    for (let i = 0; i < firstWeekday; i++) cells += `<div class="cal-cell cal-cell--empty"></div>`;
    for (let d = 1; d <= daysInMonth; d++) {
      const iso = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const list = byDate[iso] || [];
      cells += `
        <div class="cal-cell ${iso === todayISO ? "cal-cell--today" : ""} ${iso === selectedDate ? "cal-cell--selected" : ""}" data-date="${iso}">
          <div class="cal-cell__num">${d}</div>
          ${list.length ? `<div class="cal-cell__count">${list.length} interview${list.length > 1 ? "s" : ""}</div>` : ""}
        </div>`;
    }
    const host = document.getElementById("calGrid");
    if (host) host.innerHTML = cells;
    host?.querySelectorAll("[data-date]").forEach(el => el.addEventListener("click", () => openDay(el.dataset.date)));

    if (selectedDate) openDay(selectedDate); else renderDayPanel(null);
  }

  function openDay(iso) {
    selectedDate = iso;
    document.querySelectorAll("#calGrid [data-date]").forEach(el => el.classList.toggle("cal-cell--selected", el.dataset.date === iso));
    renderDayPanel(iso);
  }

  function renderDayPanel(iso) {
    const panel = document.getElementById("calDayPanel");
    if (!panel) return;
    if (!iso) { panel.innerHTML = `<p class="empty-hint">Click a date to see its interviews.</p>`; return; }
    const list = (interviewsByDate()[iso] || []).sort((a, b) => a.interviewTime.localeCompare(b.interviewTime));
    panel.innerHTML = `
      <div class="panel__head"><h3>${Utils.formatDate(iso)}</h3><span class="muted">${list.length} interview(s)</span></div>
      <button type="button" class="btn btn--primary btn--sm" id="calAddInterview">+ Schedule Interview</button>
      <div class="cal-day-list">${list.map(Interviews.interviewCardHTML).join("") || `<p class="empty-hint">No interviews this day.</p>`}</div>`;
    Interviews.bindCardActions(panel);
    document.getElementById("calAddInterview").addEventListener("click", () => {
      Interviews.openModal(null);
      setTimeout(() => { const f = document.getElementById("interviewForm"); if (f) f.elements.interviewDate.value = iso; }, 30);
    });
  }

  function populateFilterOptions() {
    const rows = Storage.getAll("interviews");
    const set = (id, values, allLabel) => {
      const sel = document.getElementById(id);
      if (sel) sel.innerHTML = `<option value="">${allLabel}</option>` + [...new Set(values)].filter(Boolean).sort().map(v => `<option value="${Utils.escapeHtml(v)}">${Utils.escapeHtml(v)}</option>`).join("");
    };
    set("calFilterStatus", Interviews.STATUS_OPTIONS, "All Statuses");
    set("calFilterType", Interviews.INTERVIEW_TYPE_OPTIONS, "All Types");
    set("calFilterSource", Interviews.SOURCE_OPTIONS, "All Sources");
    set("calFilterClient", rows.map(r => r.client), "All Clients");
    set("calFilterPOC", rows.map(Interviews.technicalPOCFor), "All Technical POCs");
  }

  function bind() {
    document.getElementById("calPrev").addEventListener("click", () => { cursor.setMonth(cursor.getMonth() - 1); renderGrid(); });
    document.getElementById("calNext").addEventListener("click", () => { cursor.setMonth(cursor.getMonth() + 1); renderGrid(); });
    document.getElementById("calThisMonth").addEventListener("click", () => { cursor = new Date(); cursor.setDate(1); renderGrid(); });
    document.getElementById("calFilterStatus").addEventListener("change", e => { filters.status = e.target.value; renderGrid(); });
    document.getElementById("calFilterType").addEventListener("change", e => { filters.type = e.target.value; renderGrid(); });
    document.getElementById("calFilterSource").addEventListener("change", e => { filters.source = e.target.value; renderGrid(); });
    document.getElementById("calFilterClient").addEventListener("change", e => { filters.client = e.target.value; renderGrid(); });
    document.getElementById("calFilterPOC").addEventListener("change", e => { filters.poc = e.target.value; renderGrid(); });
  }

  function init() {
    populateFilterOptions();
    bind();
    renderGrid();
  }

  return { init, renderGrid, populateFilterOptions };
})();
