/* ============================================================
   TTOP – app.js
   Application shell: page navigation, sidebar behaviour, global
   search, dark/light theme, Settings page (import/export, reset
   future-integrations panel), and bootstrapping.
   ============================================================ */

const Nav = (() => {
  const pages = ["dashboard", "assessments", "interviews", "candidates", "incentives", "team", "reports", "admin", "settings"];

  function goTo(page) {
    if (!pages.includes(page)) page = "dashboard";
    if (page === "admin" && !Auth.isAdmin()) page = "dashboard"; // admin page is admin-only, even if linked directly
    pages.forEach(p => {
      document.getElementById(`page-${p}`)?.classList.toggle("is-active", p === page);
      document.querySelector(`.nav-link[data-page="${p}"]`)?.classList.toggle("is-active", p === page);
    });
    document.getElementById("pageTitle").textContent = ({
      dashboard: "Dashboard", assessments: "Assessments", interviews: "Interviews", candidates: "Candidates",
      incentives: "Incentives", team: "Team & POC", reports: "Reports", admin: "Admin", settings: "Settings"
    })[page];
    window.scrollTo({ top: 0, behavior: "smooth" });
    document.querySelectorAll(".mobile-nav__link").forEach(l => l.classList.toggle("is-active", l.dataset.page === page));

    // refresh page-specific data on entry
    if (page === "dashboard") Dashboard.renderAll();
    if (page === "assessments") Assessments.renderTable();
    if (page === "interviews") Interviews.renderAllSchedules();
    if (page === "candidates") Candidates.renderGrid();
    if (page === "incentives") Incentives.renderPage();
    if (page === "team") TeamManager.renderBoth();
    if (page === "reports") Reports.render();
    if (page === "admin") AdminUsers.load();
  }

  function bind() {
    document.querySelectorAll(".nav-link[data-page]").forEach(link =>
      link.addEventListener("click", () => goTo(link.dataset.page)));
    document.querySelectorAll(".mobile-nav__link[data-page]").forEach(link =>
      link.addEventListener("click", () => goTo(link.dataset.page)));
  }

  return { goTo, bind };
})();

const Reports = (() => {
  function render() {
    const host = document.getElementById("reportsContent");
    if (!host) return;
    const assessments = Storage.getAll("assessments");
    const interviews = Storage.getAll("interviews");
    const incentives = Storage.getAll("incentives");
    const clients = [...new Set([...assessments.map(a => a.client), ...interviews.map(i => i.client)])];

    const clientRows = clients.map(client => {
      const as = assessments.filter(a => a.client === client).length;
      const iv = interviews.filter(i => i.client === client).length;
      const placed = interviews.filter(i => i.client === client && i.placementStatus === "Placed").length;
      const inc = incentives.filter(i => i.client === client).reduce((s, i) => s + Number(i.amount || 0), 0);
      return { client, as, iv, placed, inc };
    });

    host.innerHTML = `
      <div class="report-grid">
        <div class="report-card">
          <h4>Assessment → Interview Conversion</h4>
          <p class="report-big">${assessments.length ? Math.round((interviews.length / assessments.length) * 100) : 0}%</p>
          <p class="muted">${interviews.length} interviews generated from ${assessments.length} assessments</p>
        </div>
        <div class="report-card">
          <h4>Placement Rate</h4>
          <p class="report-big">${interviews.length ? Math.round((interviews.filter(i => i.placementStatus === "Placed").length / interviews.length) * 100) : 0}%</p>
          <p class="muted">${interviews.filter(i => i.placementStatus === "Placed").length} candidates placed</p>
        </div>
        <div class="report-card">
          <h4>Total Payout</h4>
          <p class="report-big">${Utils.formatCurrency(incentives.reduce((s, i) => s + Number(i.amount || 0), 0))}</p>
          <p class="muted">Across ${incentives.filter(i => i.amount > 0).length} incentive events</p>
        </div>
      </div>
      <h4 class="profile-subhead">By Client</h4>
      <table class="data-table">
        <thead><tr><th>Client</th><th>Assessments</th><th>Interviews</th><th>Placed</th><th>Incentives Paid</th></tr></thead>
        <tbody>
          ${clientRows.map(r => `<tr><td>${Utils.escapeHtml(r.client)}</td><td>${r.as}</td><td>${r.iv}</td><td>${r.placed}</td><td>${Utils.formatCurrency(r.inc)}</td></tr>`).join("")}
        </tbody>
      </table>`;
  }
  return { render };
})();

const GlobalSearch = (() => {
  function search(query) {
    const q = query.toLowerCase().trim();
    if (!q) return { candidates: [], assessments: [], interviews: [], pocs: [], incentives: [] };
    const candidates = Storage.getAll("candidates").filter(c => `${c.name} ${c.assignedDomains} ${c.location}`.toLowerCase().includes(q));
    const assessments = Storage.getAll("assessments").filter(a => `${a.candidateName} ${a.client} ${a.techRole}`.toLowerCase().includes(q));
    const interviews = Storage.getAll("interviews").filter(i => `${i.candidateName} ${i.client} ${i.round}`.toLowerCase().includes(q));
    const pocs = [
      ...Storage.getAll("candidatePocTeam").map(t => ({ ...t, teamLabel: "Candidate POC" })),
      ...Storage.getAll("supportTeam").map(t => ({ ...t, teamLabel: "Support Team" }))
    ].filter(t => t.name.toLowerCase().includes(q));
    const incentives = Storage.getAll("incentives").filter(i => `${i.candidate} ${i.client} ${i.toolDrivePerson} ${i.candidatePOC}`.toLowerCase().includes(q));
    return { candidates, assessments, interviews, pocs, incentives };
  }

  function renderResults(query) {
    const host = document.getElementById("globalSearchResults");
    if (!host) return;
    if (!query.trim()) { host.classList.remove("is-open"); host.innerHTML = ""; return; }
    const r = search(query);
    const total = r.candidates.length + r.assessments.length + r.interviews.length + r.pocs.length + r.incentives.length;
    if (!total) { host.innerHTML = `<div class="search-empty">No matches for "${Utils.escapeHtml(query)}"</div>`; host.classList.add("is-open"); return; }

    const section = (title, items, render) => items.length ? `
      <div class="search-section">
        <div class="search-section__title">${title}</div>
        ${items.slice(0, 4).map(render).join("")}
      </div>` : "";

    host.innerHTML =
      section("Candidates", r.candidates, c => `<div class="search-item" data-goto="candidates">👤 ${Utils.escapeHtml(c.name)} <span class="muted">${Utils.escapeHtml(c.assignedDomains)}</span></div>`) +
      section("Assessments", r.assessments, a => `<div class="search-item" data-goto="assessments">📝 ${Utils.escapeHtml(a.candidateName)} <span class="muted">${Utils.escapeHtml(a.client)}</span></div>`) +
      section("Interviews", r.interviews, i => `<div class="search-item" data-goto="interviews">📅 ${Utils.escapeHtml(i.candidateName)} <span class="muted">${Utils.escapeHtml(i.client)} · ${i.round}</span></div>`) +
      section("POC / Team", r.pocs, p => `<div class="search-item" data-goto="team">🧑‍💼 ${Utils.escapeHtml(p.name)} <span class="muted">${p.teamLabel}</span></div>`) +
      section("Incentives", r.incentives, i => `<div class="search-item" data-goto="incentives">💰 ${Utils.escapeHtml(i.candidate)} <span class="muted">${Utils.formatCurrency(i.amount)}</span></div>`);
    host.classList.add("is-open");

    host.querySelectorAll(".search-item").forEach(el => el.addEventListener("click", () => {
      Nav.goTo(el.dataset.goto);
      host.classList.remove("is-open");
      document.getElementById("globalSearchInput").value = "";
    }));
  }

  function bind() {
    const input = document.getElementById("globalSearchInput");
    input?.addEventListener("input", Utils.debounce(e => renderResults(e.target.value), 200));
    document.addEventListener("click", e => {
      if (!e.target.closest(".global-search")) document.getElementById("globalSearchResults")?.classList.remove("is-open");
    });
  }

  return { bind };
})();

const App = (() => {

  function pushNotification(text, type) { Dashboard.pushNotification(text, type); }

  function bindTheme() {
    const toggle = document.getElementById("themeToggle");
    const settings = Storage.getSettings();
    document.documentElement.dataset.theme = settings.theme || "light";
    if (toggle) toggle.checked = settings.theme === "dark";
    toggle?.addEventListener("change", () => {
      const theme = toggle.checked ? "dark" : "light";
      document.documentElement.dataset.theme = theme;
      Storage.saveSettings({ theme });
    });
  }

  function bindSidebar() {
    const sidebar = document.getElementById("sidebar");
    const btn = document.getElementById("sidebarToggle");
    const settings = Storage.getSettings();
    if (settings.sidebarCollapsed) sidebar.classList.add("is-collapsed");
    btn?.addEventListener("click", () => {
      sidebar.classList.toggle("is-collapsed");
      Storage.saveSettings({ sidebarCollapsed: sidebar.classList.contains("is-collapsed") });
    });
    document.getElementById("mobileMenuToggle")?.addEventListener("click", () => sidebar.classList.toggle("is-open-mobile"));
  }

  function bindNotificationBell() {
    document.getElementById("notificationBell")?.addEventListener("click", () => {
      document.getElementById("notificationPanel")?.classList.toggle("is-open");
    });
    document.addEventListener("click", e => {
      if (!e.target.closest(".notification-wrap")) document.getElementById("notificationPanel")?.classList.remove("is-open");
    });
  }

  function bindSettings() {
    document.getElementById("btnExportJSON")?.addEventListener("click", () => {
      Utils.downloadFile(`ttop-export-${Date.now()}.json`, JSON.stringify(Storage.exportAll(), null, 2));
      Utils.toast("Data exported as JSON.", "success");
    });

    document.getElementById("btnExportCSV")?.addEventListener("click", () => {
      const cols = [
        { key: "date", label: "Date of Assessment" }, { key: "type", label: "Type" },
        { key: "candidateName", label: "Candidate Name" }, { key: "techRole", label: "Technology/Role" },
        { key: "interviewDate", label: "Interview Date" }, { key: "client", label: "Company/Client" },
        { key: "doneBy", label: "Done By" }, { key: "status", label: "Status" }, { key: "folderLink", label: "Folder Link" }
      ];
      // "Done BY" in the sheet is now the Tool Drive person from the linked interview
      const rows = Storage.getAll("assessments").map(a => ({ ...a, doneBy: Assessments.getToolDrive(a) }));
      Utils.downloadFile(`ttop-assessments-${Date.now()}.csv`, Utils.toCSV(rows, cols), "text/csv");
      Utils.toast("Assessments exported as CSV.", "success");
    });

    document.getElementById("btnImportJSON")?.addEventListener("click", () => document.getElementById("importFileInput")?.click());
    document.getElementById("importFileInput")?.addEventListener("change", e => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const payload = JSON.parse(reader.result);
          Storage.importAll(payload);
          Utils.toast("Data imported successfully.", "success");
          Dashboard.renderAll(); Assessments.renderTable(); Interviews.renderAllSchedules();
          Candidates.renderGrid(); Incentives.renderPage(); TeamManager.renderBoth();
        } catch (err) {
          Utils.toast("Could not read that file — is it a valid TTOP export?", "error");
        }
      };
      reader.readAsText(file);
      e.target.value = "";
    });

  }

  function bindDriveSettings() {
    const url = document.getElementById("driveEndpointInput");
    const secret = document.getElementById("driveSecretInput");
    const badge = document.getElementById("driveModeBadge");
    if (!url) return;
    const paint = () => {
      const cfg = Drive.config();
      url.value = cfg.endpoint; secret.value = cfg.secret;
      badge.textContent = "🟢 Live – saving to Google Drive & Sheets";
    };
    document.getElementById("btnSaveDrive")?.addEventListener("click", () => {
      const endpoint = url.value.trim();
      if (!endpoint || !secret.value.trim()) { Utils.toast("Both the Web App URL and the secret are required.", "warning"); return; }
      if (!/^https:\/\/script\.google\.com\//.test(endpoint)) {
        Utils.toast("That doesn't look like an Apps Script web app URL (https://script.google.com/...).", "warning", 5000);
        return;
      }
      Storage.saveSettings({ driveEndpoint: endpoint, driveSecret: secret.value.trim() });
      paint();
      Utils.toast("Google Drive & Sheets connection saved.", "success");
    });
    document.getElementById("btnClearDrive")?.addEventListener("click", () => {
      Storage.saveSettings({ driveEndpoint: "", driveSecret: "" });
      paint();
      Utils.toast("Restored the default Google Drive & Sheets connection.", "info");
    });
    paint();
  }

  function bindGlobalUI() {
    document.getElementById("confirmOverlay")?.querySelectorAll(".modal__backdrop").forEach(b => {});
    document.querySelectorAll(".overlay").forEach(overlay => {
      overlay.addEventListener("click", e => { if (e.target === overlay) overlay.classList.remove("is-open"); });
    });
    document.addEventListener("keydown", e => {
      if (e.key === "Escape") document.querySelectorAll(".overlay.is-open").forEach(o => o.classList.remove("is-open"));
    });
  }

  /** Re-draw everything (used after data arrives from the Google Sheet) */
  function refreshAll() {
    Assessments.populateFilterOptions();
    Assessments.renderTable();
    Interviews.renderTable();
    Interviews.renderAllSchedules();
    Candidates.renderGrid();
    TeamManager.renderBoth();
    Incentives.renderPage();
    Dashboard.renderAll();
    Reports.render();
  }

  function init() {
    Storage.initIfNeeded();
    const me = Auth.currentUser();
    document.getElementById("currentUserName").textContent = me ? me.name : "Karthik";
    document.getElementById("currentUserAvatar").textContent = Utils.initials(me ? me.name : "Karthik");
    document.getElementById("navAdminLink")?.classList.toggle("is-hidden", !Auth.isAdmin());

    Nav.bind();
    GlobalSearch.bind();
    bindTheme();
    bindSidebar();
    bindNotificationBell();
    bindSettings();
    bindDriveSettings();
    bindGlobalUI();

    Assessments.init();
    Interviews.init();
    Candidates.init();
    TeamManager.init();
    AdminUsers.init();
    Incentives.renderPage();
    Incentives.bindFilters();
    Dashboard.renderAll();
    Reports.render();

    Nav.goTo("dashboard");
    Sync.start({ refresh: refreshAll });
  }

  return { init, pushNotification, refreshAll };
})();
