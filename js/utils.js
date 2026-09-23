/* ============================================================
   TTOP – utils.js
   Small, dependency-free helper functions used everywhere else.
   ============================================================ */

const Utils = (() => {

  /** Generate a reasonably unique id, e.g. "AS-3F9K2" */
  function generateId(prefix = "ID") {
    const rand = Math.random().toString(36).slice(2, 7).toUpperCase();
    const time = Date.now().toString(36).slice(-4).toUpperCase();
    return `${prefix}-${time}${rand}`;
  }

  /** yyyy-mm-dd -> "12 Mar 2026" (short, readable) */
  function formatDate(dateStr) {
    if (!dateStr) return "—";
    const d = new Date(dateStr + "T00:00:00");
    if (isNaN(d)) return dateStr;
    return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  }

  /** Returns "Today" / "Tomorrow" / "Day after tomorrow" / formatted date */
  function relativeDayLabel(dateStr) {
    const bucket = dayBucket(dateStr);
    if (bucket === "today") return "Today";
    if (bucket === "tomorrow") return "Tomorrow";
    if (bucket === "dayafter") return "Day after tomorrow";
    return formatDate(dateStr);
  }

  /** Classify a yyyy-mm-dd date string relative to now */
  /** Local calendar date as YYYY-MM-DD. (toISOString() is UTC and gives *yesterday* for India before 5:30 AM.) */
  function dateISO(d = new Date()) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  function dayBucket(dateStr) {
    if (!dateStr) return "other";
    const target = new Date(dateStr + "T00:00:00");
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diffDays = Math.round((target - today) / 86400000);
    if (diffDays === 0) return "today";
    if (diffDays === 1) return "tomorrow";
    if (diffDays === 2) return "dayafter";
    if (diffDays < 0) return "past";
    return "future";
  }

  /** "7:30 PM" style time string -> minutes since midnight, for sorting/countdowns */
  function timeToMinutes(timeStr) {
    if (!timeStr) return 0;
    const m = timeStr.match(/(\d{1,2}):(\d{2})\s*([AP]M)?/i);
    if (!m) return 0;
    let [, h, min, ampm] = m;
    h = parseInt(h, 10);
    min = parseInt(min, 10);
    if (ampm) {
      ampm = ampm.toUpperCase();
      if (ampm === "PM" && h !== 12) h += 12;
      if (ampm === "AM" && h === 12) h = 0;
    }
    return h * 60 + min;
  }

  /** Combine a yyyy-mm-dd date + "7:30 PM IST" time into a real Date object (IST assumed) */
  function toDateTime(dateStr, timeStr) {
    const mins = timeToMinutes(timeStr);
    const d = new Date(dateStr + "T00:00:00");
    d.setMinutes(d.getMinutes() + mins);
    return d;
  }

  /** Countdown string like "02h 35m" or "Started" / "Passed" */
  function countdown(dateStr, timeStr) {
    const target = toDateTime(dateStr, timeStr);
    const diffMs = target - new Date();
    if (diffMs <= 0) return diffMs > -1000 * 60 * 60 ? "Starting now" : "In progress / passed";
    const totalMin = Math.floor(diffMs / 60000);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return `${String(h).padStart(2, "0")}h ${String(m).padStart(2, "0")}m`;
  }

  function timeAgo(isoTimestamp) {
    const diff = Date.now() - new Date(isoTimestamp).getTime();
    const min = Math.floor(diff / 60000);
    if (min < 1) return "Just now";
    if (min < 60) return `${min} minute${min === 1 ? "" : "s"} ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr} hour${hr === 1 ? "" : "s"} ago`;
    const day = Math.floor(hr / 24);
    if (day === 1) return "Yesterday";
    if (day < 7) return `${day} days ago`;
    return formatDate(isoTimestamp.slice(0, 10));
  }

  function formatCurrency(amount) {
    return "₹" + Number(amount || 0).toLocaleString("en-IN");
  }

  function escapeHtml(str) {
    if (str === null || str === undefined) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function initials(name) {
    if (!name) return "?";
    return name.split(" ").filter(Boolean).slice(0, 2).map(p => p[0].toUpperCase()).join("");
  }

  /** Debounce for search inputs */
  function debounce(fn, wait = 250) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), wait);
    };
  }

  /** Toast notifications (bottom-right stack) */
  function toast(message, type = "info", timeout = 3500) {
    const host = document.getElementById("toastHost");
    if (!host) return;
    const el = document.createElement("div");
    el.className = `toast toast--${type}`;
    const icons = { info: "ℹ️", success: "✅", warning: "⚠️", error: "⛔" };
    el.innerHTML = `<span class="toast__icon">${icons[type] || icons.info}</span><span class="toast__msg">${escapeHtml(message)}</span>`;
    host.appendChild(el);
    requestAnimationFrame(() => el.classList.add("toast--show"));
    setTimeout(() => {
      el.classList.remove("toast--show");
      setTimeout(() => el.remove(), 300);
    }, timeout);
  }

  /** Small confirm modal, returns a Promise<boolean> */
  function confirmDialog(title, message) {
    return new Promise(resolve => {
      const overlay = document.getElementById("confirmOverlay");
      overlay.querySelector(".confirm__title").textContent = title;
      overlay.querySelector(".confirm__message").textContent = message;
      overlay.classList.add("is-open");
      const cleanup = (result) => {
        overlay.classList.remove("is-open");
        btnYes.removeEventListener("click", onYes);
        btnNo.removeEventListener("click", onNo);
        resolve(result);
      };
      const btnYes = overlay.querySelector(".confirm__yes");
      const btnNo = overlay.querySelector(".confirm__no");
      const onYes = () => cleanup(true);
      const onNo = () => cleanup(false);
      btnYes.addEventListener("click", onYes);
      btnNo.addEventListener("click", onNo);
    });
  }

  function downloadFile(filename, content, mime = "application/json") {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function toCSV(rows, columns) {
    const header = columns.map(c => `"${c.label}"`).join(",");
    const lines = rows.map(row =>
      columns.map(c => `"${String(row[c.key] ?? "").replace(/"/g, '""')}"`).join(",")
    );
    return [header, ...lines].join("\n");
  }

  function statusBadgeClass(status) {
    const map = {
      "Assessment Pending": "badge--amber",
      "Assessment Completed": "badge--green",
      "Ongoing Interview": "badge--blue",
      "Upcoming Interview": "badge--purple",
      "Interview Completed": "badge--teal",
      "Placed": "badge--emerald",
      "Not Placed": "badge--red",
      "Active": "badge--green",
      "Inactive": "badge--grey",
      "Pending": "badge--amber",
      "Paid": "badge--green",
    };
    return map[status] || "badge--grey";
  }

  /**
   * Colour code for an interview type (dashboard cards):
   *   Coding, System Design            -> yellow
   *   Recruiter                        -> light pink
   *   Assessment, Presentation         -> orange
   *   Technical, Hiring Manager, Leadership, Director,
   *   Cultural Fit (and anything else) -> default
   */
  function interviewTypeClass(type) {
    if (type === "Coding" || type === "System Design") return "itype--yellow";
    if (type === "Recruiter") return "itype--pink";
    if (type === "Assessment" || type === "Presentation") return "itype--orange";
    return "itype--default";
  }

  function formatFileSize(bytes) {
    if (!bytes && bytes !== 0) return "";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  return {
    interviewTypeClass, formatFileSize, dateISO,
    generateId, formatDate, relativeDayLabel, dayBucket, timeToMinutes, toDateTime,
    countdown, timeAgo, formatCurrency, escapeHtml, initials, debounce,
    toast, confirmDialog, downloadFile, toCSV, statusBadgeClass
  };
})();
