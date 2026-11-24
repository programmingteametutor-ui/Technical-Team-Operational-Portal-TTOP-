/*********************************************************************
 * Interview Scheduler
 * WeeklyNightBalance.gs
 * Upgrade Step 2 - Weekly Night Call Fairness
 *
 * Rule confirmed by user:
 * - A night call starts at 2:00 AM.
 * - Weekly fairness applies only to MAIN_HANDLERS.
 * - Pradeep is NOT part of the normal weekly night rotation.
 *
 * This module is read-only except for in-memory scheduler statistics.
 * It does not write any sheet cells.
 *********************************************************************/

/**
 * Returns the configured night-call start minute.
 * Uses SETTINGS.AFTER_HOUR when available. Current value is 2.
 */
function getNightStartMinutes_() {

  const hour = (
    typeof SETTINGS !== "undefined" &&
    SETTINGS &&
    Number(SETTINGS.AFTER_HOUR) >= 0
  ) ? Number(SETTINGS.AFTER_HOUR) : 2;

  return hour * 60;
}


/**
 * True when an interview time is 2:00 AM or later during the AM period.
 * This intentionally does not classify PM calls as "night calls".
 */
function isNightCallTime_(timeText) {

  const raw = String(timeText || "").trim();

  if (!raw) {
    return false;
  }

  const m = raw.match(/(\d{1,2})(?:[:.](\d{2}))?\s*(AM|PM)/i);

  if (!m) {
    return false;
  }

  let hour = Number(m[1]);
  const mins = Number(m[2] || 0);
  const ampm = String(m[3]).toUpperCase();

  if (ampm !== "AM") {
    return false;
  }

  if (hour === 12) {
    hour = 0;
  }

  const total = hour * 60 + mins;

  return total >= getNightStartMinutes_();
}


/**
 * Reads a time directly from an interview/master text string.
 * Example matches: 2:00 AM, 2.00 AM, 2 AM.
 */
function isNightCallText_(text) {

  const raw = String(text || "");

  const m = raw.match(/(\d{1,2})(?:[:.](\d{2}))?\s*(AM|PM)/i);

  if (!m) {
    return false;
  }

  return isNightCallTime_(m[0]);
}


/**
 * Parses the working-date header used in Column B.
 * Supported examples:
 *   8/10/2026 Monday
 *   08/10/2026
 *   23-Jul-2026
 *   23 Jul 2026
 */
function parseScheduleDateHeader_(value) {

  const text = String(value || "").trim();

  if (!text) {
    return null;
  }

  // Actual workbook style: M/D/YYYY followed optionally by weekday.
  let m = text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})(?:\s|$)/);

  if (m) {

    const month = Number(m[1]);
    const day = Number(m[2]);
    const year = Number(m[3]);

    const date = new Date(year, month - 1, day);

    if (
      date.getFullYear() === year &&
      date.getMonth() === month - 1 &&
      date.getDate() === day
    ) {
      return date;
    }
  }

  // Alternate supported style: 23-Jul-2026 / 23 Jul 2026.
  m = text.match(/^(\d{1,2})[\s-]([A-Za-z]{3,9})[\s-](\d{4})(?:\s|$)/);

  if (m) {

    const monthNames = {
      jan: 0, january: 0,
      feb: 1, february: 1,
      mar: 2, march: 2,
      apr: 3, april: 3,
      may: 4,
      jun: 5, june: 5,
      jul: 6, july: 6,
      aug: 7, august: 7,
      sep: 8, sept: 8, september: 8,
      oct: 9, october: 9,
      nov: 10, november: 10,
      dec: 11, december: 11
    };

    const key = String(m[2]).toLowerCase();

    if (monthNames[key] != null) {

      const day = Number(m[1]);
      const month = monthNames[key];
      const year = Number(m[3]);
      const date = new Date(year, month, day);

      if (
        date.getFullYear() === year &&
        date.getMonth() === month &&
        date.getDate() === day
      ) {
        return date;
      }
    }
  }

  return null;
}


function dateOnly_(date) {

  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate()
  );
}


function getMondayOfWeek_(date) {

  const d = dateOnly_(date);
  const day = d.getDay(); // Sunday=0 ... Saturday=6
  const offset = day === 0 ? -6 : 1 - day;

  d.setDate(d.getDate() + offset);

  return d;
}


function sameDate_(a, b) {

  return a && b &&
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}


function formatNightDate_(date) {

  if (!date) {
    return "";
  }

  return Utilities.formatDate(
    date,
    Session.getScriptTimeZone(),
    "dd-MMM-yyyy"
  );
}


/**
 * Returns an object initialized for all normal handlers.
 */
function createEmptyNightCounts_() {

  const counts = {};

  MAIN_HANDLERS.forEach(function(handler) {
    counts[handler] = 0;
  });

  return counts;
}


/**
 * Counts already-assigned night calls from PREVIOUS working dates in
 * the same Monday-Sunday week as the current date block.
 *
 * The current date block is intentionally excluded because the active
 * scheduler will add today's assignments in-memory as it assigns them.
 * This prevents double counting when Auto Assign is rerun.
 */
function getWeeklyNightCounts_() {

  const counts = createEmptyNightCounts_();
  const currentDate = parseScheduleDateHeader_(getTodayDate());

  if (!currentDate) {
    throw new Error(
      "Unable to parse current working date for weekly night balancing: " +
      getTodayDate()
    );
  }

  const weekStart = getMondayOfWeek_(currentDate);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);

  const sheet = getMainSheet();
  const lastRow = sheet.getLastRow();

  if (lastRow <= 0) {
    return counts;
  }

  // Read B:F once. We need:
  // B = master/date header, E = extracted interview, F = handler.
  const values = sheet
    .getRange(1, COL.MASTER, lastRow, COL.HANDLER - COL.MASTER + 1)
    .getDisplayValues();

  let workingDate = null;

  values.forEach(function(row) {

    const masterText = String(row[0] || "").trim();      // B
    const extractedText = String(row[3] || "").trim(); // E
    const handler = String(row[4] || "").trim();       // F

    const headerDate = parseScheduleDateHeader_(masterText);

    if (headerDate) {
      workingDate = headerDate;
      return;
    }

    if (!workingDate) {
      return;
    }

    // Only earlier dates in the same current week.
    if (workingDate < weekStart || workingDate > weekEnd) {
      return;
    }

    if (sameDate_(workingDate, currentDate)) {
      return;
    }

    if (MAIN_HANDLERS.indexOf(handler) === -1) {
      return;
    }

    const sourceText = extractedText || masterText;

    if (!isNightCallText_(sourceText)) {
      return;
    }

    counts[handler] = (counts[handler] || 0) + 1;
  });

  return counts;
}


/**
 * Returns true only for normal handlers. Pradeep and Support are excluded.
 */
function isNormalHandler_(handler) {

  return MAIN_HANDLERS.indexOf(handler) !== -1;
}


/**
 * Adds an assignment to the scheduler's in-memory weekly night tally.
 */
function recordNightAssignment_(scheduler, handler, interview) {

  if (!scheduler || !isNormalHandler_(handler)) {
    return;
  }

  if (!interview || !isNightCallTime_(interview.interviewTime)) {
    return;
  }

  if (!scheduler.weeklyNightStatistics) {
    scheduler.weeklyNightStatistics = createEmptyNightCounts_();
  }

  scheduler.weeklyNightStatistics[handler] =
    (scheduler.weeklyNightStatistics[handler] || 0) + 1;

  Logger.log(
    "Night Count -> " + handler +
    " = " + scheduler.weeklyNightStatistics[handler]
  );
}


/**
 * Stable main-handler order used only as the final tie breaker.
 */
function getMainHandlerOrderIndex_(handler) {

  const index = MAIN_HANDLERS.indexOf(handler);

  return index === -1 ? 999 : index;
}


/**
 * Safe test: reads sheet history and logs weekly night workload.
 * Does not edit assignments.
 */
function testWeeklyNightBalance() {

  const currentDate = parseScheduleDateHeader_(getTodayDate());

  if (!currentDate) {
    throw new Error("Unable to parse working date: " + getTodayDate());
  }

  const weekStart = getMondayOfWeek_(currentDate);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);

  const counts = getWeeklyNightCounts_();

  Logger.log("========== WEEKLY NIGHT LOAD TEST ==========");
  Logger.log("Working Date : " + getTodayDate());
  Logger.log(
    "Week         : " +
    formatNightDate_(weekStart) + " to " +
    formatNightDate_(weekEnd)
  );
  Logger.log("Night Starts : 2:00 AM");
  Logger.log("");

  MAIN_HANDLERS.forEach(function(handler) {
    Logger.log(handler + " : " + (counts[handler] || 0));
  });

  Logger.log("");
  Logger.log("Pradeep : EXCLUDED FROM NORMAL NIGHT ROTATION");
  Logger.log("Support : EXCLUDED FROM NORMAL NIGHT ROTATION");
  Logger.log("============================================");
}

/**
 * Pure in-memory test for the 2:00 AM threshold.
 * Does not read or write interview assignments.
 */
function testNightTimeRule() {

  const samples = [
    "1:59 AM",
    "2:00 AM",
    "2:30 AM",
    "4:00 AM",
    "11:00 PM"
  ];

  Logger.log("========== NIGHT TIME RULE TEST ==========");

  samples.forEach(function(time) {
    Logger.log(
      time + " : " +
      (isNightCallTime_(time) ? "NIGHT" : "NORMAL")
    );
  });

  Logger.log("==========================================");
}


/**
 * Pure in-memory test of the weekly-night tie-break logic.
 * No sheet cells are changed.
 * Expected winner: Venkatesh
 * - Bharat and Venkatesh both have weekly night count 0.
 * - Venkatesh has the lower today's load.
 */
function testNightFairnessLogic() {

  const availability = {};
  MAIN_HANDLERS.forEach(function(handler) {
    availability[handler] = [];
  });
  availability[SPECIAL_HANDLER] = [];
  availability[SUPPORT_HANDLER] = [];

  const scheduler = {
    availability: availability,
    statistics: {
      Dhruva: 1,
      Naresh: 1,
      Bharat: 5,
      Venkatesh: 2,
      Avinash: 0,
      Karthik: 0,
      Gopal: 0
    },
    weeklyNightStatistics: {
      Dhruva: 2,
      Naresh: 1,
      Bharat: 0,
      Venkatesh: 0,
      Avinash: 3,
      Karthik: 1,
      Gopal: 2
    }
  };

  const interview = {
    interviewTime: "2:30 AM",
    duration: 30,
    candidate: "TEST ONLY"
  };

  const selected = findBestAvailableHandler(interview, scheduler);

  Logger.log("========== NIGHT FAIRNESS LOGIC TEST ==========");
  Logger.log("Test Time       : 2:30 AM");
  Logger.log("Lowest Night    : Bharat=0, Venkatesh=0");
  Logger.log("Today Load      : Bharat=5, Venkatesh=2");
  Logger.log("Expected        : Venkatesh");
  Logger.log("Selected        : " + selected);
  Logger.log("Result          : " + (selected === "Venkatesh" ? "PASS" : "CHECK"));
  Logger.log("================================================");
}

