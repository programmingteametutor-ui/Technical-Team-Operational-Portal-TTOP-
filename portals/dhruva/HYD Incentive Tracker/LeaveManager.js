/*********************************************************************
 * Interview Scheduler
 * LeaveManager.gs
 * Upgrade Step 1 v2 - Daily Leave / Availability
 *
 * IMPORTANT:
 * - Does not modify Utilities.gs.
 * - Does not modify Availability.gs.
 * - Stores leave by the latest working date block.
 *********************************************************************/

/**
 * People who can be marked on leave.
 * Support is intentionally excluded because it is a fallback label.
 */
function getLeaveEligibleHandlers_() {

  const handlers = MAIN_HANDLERS.slice();

  if (SPECIAL_HANDLER && handlers.indexOf(SPECIAL_HANDLER) === -1) {
    handlers.push(SPECIAL_HANDLER);
  }

  return handlers;
}


/**
 * Builds a stable Script Properties key for the current working date block.
 */
function getTodayLeavePropertyKey_() {

  const dateText = String(getTodayDate() || "").trim();

  return "INTERVIEW_SCHEDULER_LEAVE_" + dateText;
}


/**
 * Reads today's leave setup.
 * Returns null when the day has not been configured yet.
 */
function getTodayLeaveConfig_() {

  const raw = PropertiesService
    .getScriptProperties()
    .getProperty(getTodayLeavePropertyKey_());

  if (!raw) {
    return null;
  }

  try {

    const config = JSON.parse(raw);

    if (
      !config ||
      config.configured !== true ||
      !Array.isArray(config.onLeave)
    ) {
      return null;
    }

    return config;
  }
  catch (err) {

    Logger.log("Unable to read leave configuration: " + err.message);
    return null;
  }
}


function getTodayOnLeaveHandlers_() {

  const config = getTodayLeaveConfig_();

  return config ? config.onLeave.slice() : [];
}


function isTodayLeaveConfigured_() {

  return getTodayLeaveConfig_() !== null;
}


/**
 * Menu action.
 * Example input: 2,5
 * Use 0 when nobody is on leave.
 */
function setTodayLeave() {

  const ui = SpreadsheetApp.getUi();
  const handlers = getLeaveEligibleHandlers_();
  const currentLeave = getTodayOnLeaveHandlers_();

  let message = "Working date: " + getTodayDate() + "\n\n";
  message += "Enter the NUMBER(S) of handlers who are on leave.\n";
  message += "Separate multiple numbers with commas. Example: 2,5\n";
  message += "Enter 0 if everyone is working.\n\n";

  handlers.forEach(function(handler, index) {

    const marker = currentLeave.indexOf(handler) !== -1
      ? "  [currently ON LEAVE]"
      : "";

    message += (index + 1) + " - " + handler + marker + "\n";
  });

  const response = ui.prompt(
    "Set Today's Leave",
    message,
    ui.ButtonSet.OK_CANCEL
  );

  if (response.getSelectedButton() !== ui.Button.OK) {
    return;
  }

  const input = String(response.getResponseText() || "").trim();

  if (input === "") {
    ui.alert("Nothing saved. Enter 0 if nobody is on leave.");
    return;
  }

  let onLeave = [];

  if (input !== "0") {

    const pieces = input.split(",");
    const seen = {};

    for (let i = 0; i < pieces.length; i++) {

      const raw = String(pieces[i] || "").trim();

      if (!/^\d+$/.test(raw)) {
        ui.alert("Invalid selection: " + raw);
        return;
      }

      const choice = Number(raw);

      if (choice < 1 || choice > handlers.length) {
        ui.alert(
          "Invalid selection: " + raw +
          "\nChoose numbers between 1 and " + handlers.length + "."
        );
        return;
      }

      const handler = handlers[choice - 1];

      if (!seen[handler]) {
        seen[handler] = true;
        onLeave.push(handler);
      }
    }
  }

  const config = {
    configured: true,
    date: getTodayDate(),
    onLeave: onLeave,
    configuredAt: new Date().toISOString()
  };

  PropertiesService
    .getScriptProperties()
    .setProperty(
      getTodayLeavePropertyKey_(),
      JSON.stringify(config)
    );

  ui.alert(
    "Today's leave saved.\n\n" +
    "Date: " + config.date + "\n" +
    "On Leave: " + (onLeave.length ? onLeave.join(", ") : "Nobody") +
    "\n\nAuto Assign will exclude them."
  );
}


function viewTodayLeave() {

  const ui = SpreadsheetApp.getUi();
  const config = getTodayLeaveConfig_();

  if (!config) {
    ui.alert(
      "Today's leave has not been configured.\n\n" +
      "Use Interview Scheduler → Set Today's Leave."
    );
    return;
  }

  ui.alert(
    "Today's Availability\n\n" +
    "Date: " + config.date + "\n" +
    "On Leave: " +
    (config.onLeave.length ? config.onLeave.join(", ") : "Nobody")
  );
}


/**
 * Safety gate used by the initial Auto Assign command.
 */
function requireTodayLeaveSetup_() {

  if (isTodayLeaveConfigured_()) {
    return true;
  }

  SpreadsheetApp.getUi().alert(
    "Set Today's Leave First\n\n" +
    "Before Auto Assign use:\n" +
    "Interview Scheduler → Set Today's Leave\n\n" +
    "If everybody is working, enter 0."
  );

  return false;
}


/**
 * Applies leave directly to the already-built availability map.
 * We use minute values directly, so this does not depend on any of the
 * project's duplicate timeToMinutes()/minutesToTime() helper definitions.
 */
function applyTodayLeaveToAvailability_(availability) {

  const onLeave = getTodayOnLeaveHandlers_();

  onLeave.forEach(function(handler) {

    if (!availability[handler]) {
      availability[handler] = [];
    }

    availability[handler].push({
      start: 0,
      end: 2880,
      duration: 2880,
      source: "Leave",
      candidate: "ON LEAVE"
    });

    Logger.log("ON LEAVE -> " + handler);
  });

  return availability;
}


/**
 * Safe test. Does not assign or edit interview rows.
 */
function testTodayLeaveSetup() {

  const dateText = getTodayDate();
  const configured = isTodayLeaveConfigured_();
  const onLeave = getTodayOnLeaveHandlers_();
  const handlers = getLeaveEligibleHandlers_();

  Logger.log("========== TODAY LEAVE TEST ==========");
  Logger.log("Working Date : " + dateText);
  Logger.log("Configured   : " + (configured ? "YES" : "NO"));
  Logger.log("On Leave     : " + (onLeave.length ? onLeave.join(", ") : "Nobody"));
  Logger.log("");

  handlers.forEach(function(handler) {
    Logger.log(
      handler + " : " +
      (onLeave.indexOf(handler) !== -1 ? "ON LEAVE" : "AVAILABLE")
    );
  });

  Logger.log("======================================");
}


