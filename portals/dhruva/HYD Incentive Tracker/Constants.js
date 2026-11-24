/*********************************************************************
 * Interview Scheduler
 * Constants.gs
 * HYDERABAD TEAM VERSION 3.3
 *********************************************************************/

/************** SHEET NAMES ****************/

const SHEET_NAME = "HYD Interview Bot 2026";

const SHEETS = {
  MAIN: "HYD Interview Bot 2026",
  RAW: "HYD Raw Data",
  TEAM_DATA: "HYD Team Data",
  CONFIG: "Config",
  BUSY: "BusySlots",
  LOG: "Logs"
};


/************** HYDERABAD HANDLERS ****************/
/*
 * These are the expected Hyderabad Handler identities supplied by the user.
 * Runtime assignment still reads the active roster from the central
 * V2 Handler Master through TeamRuntime.gs. This list is retained as a
 * compatibility/default roster and as a setup-validation target.
 */

const HYD_DEFAULT_HANDLERS = Object.freeze([
  "Stephen",
  "Karthikeya",
  "Uday",
  "Anji",
  "Akhil",
  "Vamshidhar Reddy"
]);

/* Legacy compatibility for older scheduler modules that still reference HANDLERS. */
const HANDLERS = Object.freeze(
  HYD_DEFAULT_HANDLERS.concat(["Support"])
);


/************** FIXED HANDLER KEYWORDS ****************/
/*
 * FuzzyMatcher.gs and InterviewExtractor.gs now resolve handlers dynamically
 * from TeamRuntime.gs. This compatibility object contains only Hyderabad names
 * so any older helper that still reads FIXED_HANDLER_KEYWORDS cannot route a
 * Hyderabad call to a other-team handler.
 */

const FIXED_HANDLER_KEYWORDS = Object.freeze({
  STEPHEN: "Stephen",
  KARTHIKEYA: "Karthikeya",
  UDAY: "Uday",
  ANJI: "Anji",
  AKHIL: "Akhil",
  VAMSHIDHAR : "Vamshidhar Reddy",
  SUPPORT: "Support"
});


/************** NIGHT ROTATION ****************/
/*
 * Do not copy another team's fixed weekday pairs into Hyderabad.
 * Current scheduler fairness is driven by WeeklyNightBalance.gs using the
 * active Hyderabad MAIN_HANDLERS roster. These arrays intentionally remain
 * empty until a Hyderabad-specific fixed weekday rotation is explicitly set.
 */

const NIGHT_ROTATION = Object.freeze({
  MONDAY: [],
  TUESDAY: [],
  WEDNESDAY: [],
  THURSDAY: [],
  FRIDAY: []
});


/************** COLUMN NUMBERS ****************/

const COL = {
  SLNO: 1,
  MASTER: 2,
  MATCH_TEXT: 4,
  EXTRACTED: 5,
  HANDLER: 6
};


/************** DEFAULT SETTINGS ****************/

const SETTINGS = {
  DEFAULT_DURATION: 30,

  // Hyderabad has no dedicated setup-support person. Each real handler
  // must be free for this many minutes BEFORE the interview begins.
  // Support remains an overflow label only and does not consume a personal slot.
  PRE_CALL_SETUP_MINUTES: 30,

  AFTER_HOUR: 2,
  WORK_START: 12,
  WORK_END: 4,
  MATCH_THRESHOLD: 70,
  SUPPORT_NAME: "Support",

  // R3 cross-midnight scheduling rule: times before 6 AM belong to the
  // next calendar day of the current working block.
  OPERATIONAL_DAY_CUTOVER_HOUR: 6,

  // Hyderabad currently has no legacy special-handler special handler configured.
  SPECIAL_HANDLER_NAME: ""
};


/************** COLORS ****************/

const COLORS = {
  MATCH_FOUND: "#d9ead3",
  MATCH_NOT_FOUND: "#f4cccc",
  AUTO_ASSIGNED: "#d0e0e3",
  MANUAL: "#fff2cc",
  CONFLICT: "#ea9999"
};


/************** STATUS ****************/

const STATUS = {
  MATCHED: "MATCHED",
  NOT_FOUND: "NOT FOUND",
  ASSIGNED: "ASSIGNED",
  CONFLICT: "CONFLICT",
  MANUAL: "MANUAL"
};


/************** REGEX ****************/

const REGEX = {
  DATE: /^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}/,
  TIME: /(\d{1,2})([:.](\d{2}))?\s*(AM|PM)?/i,
  DURATION: /(\d+)\s*(MIN|MINS|MINUTES|HR|HRS|HOUR|HOURS)/i
};
