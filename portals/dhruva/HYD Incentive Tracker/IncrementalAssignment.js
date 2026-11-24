/*********************************************************************
 * Interview Scheduler
 * IncrementalAssignment.gs
 * Upgrade Step 3 - Assign New Interviews Without Changing Existing
 *
 * Business rules:
 * - Existing nonblank Column F assignments are LOCKED and untouched.
 * - Existing assignments reserve their current time slots.
 * - Existing assignments count toward today's handler load.
 * - Existing 2:00 AM+ assignments count toward today's weekly-night tally.
 * - Only rows with an extracted interview in Column E AND blank Column F
 *   are eligible for incremental assignment.
 * - Leave, BusySlots, fixed-handler rules, weekly night fairness,
 *   optional special-handler fallback, and Support fallback all continue through the
 *   existing scheduler functions.
 *********************************************************************/


/**
 * Builds the scheduler state used ONLY by incremental assignment.
 *
 * Important:
 * This intentionally does NOT call createScheduler(), because the
 * original project contains two global getInterviewObjects() functions
 * (InterviewExtractor.gs and legacy Parser.gs). The legacy Parser version
 * currently throws "TEST PARSEINTERVIEW". The normal scheduler has a
 * debug line that calls getInterviewObjects(), which can resolve to that
 * legacy function depending on Apps Script's global-name resolution.
 *
 * Incremental assignment only needs Column E extracted interviews, so it
 * uses the uniquely named getExtractedInterviewObjects() directly.
 */
function createIncrementalScheduler_() {

  const scheduler = {};

  scheduler.interviews = sortInterviewsByTime(
    getExtractedInterviewObjects()
  );

  scheduler.availability = getAvailability();

  // Step 1 leave rules.
  applyTodayLeaveToAvailability_(scheduler.availability);

  scheduler.statistics = {};

  // Step 2 weekly night-call baseline.
  scheduler.weeklyNightStatistics = getWeeklyNightCounts_();

  scheduler.assignments = [];
  scheduler.unassigned = [];

  scheduler.priority = [].concat(MAIN_HANDLERS);
  if (SPECIAL_HANDLER) scheduler.priority.push(SPECIAL_HANDLER);

  Object.keys(scheduler.availability).forEach(function(name) {
    scheduler.statistics[name] = 0;
  });

  // Ensure all known identities have counters even if they are absent
  // from the availability map for any reason.
  MAIN_HANDLERS.forEach(function(name) {
    if (scheduler.statistics[name] == null) {
      scheduler.statistics[name] = 0;
    }
  });

  if (SPECIAL_HANDLER && scheduler.statistics[SPECIAL_HANDLER] == null) {
    scheduler.statistics[SPECIAL_HANDLER] = 0;
  }

  if (scheduler.statistics[SUPPORT_HANDLER] == null) {
    scheduler.statistics[SUPPORT_HANDLER] = 0;
  }

  Logger.log(
    "Incremental Scheduler Interviews : " +
    scheduler.interviews.length
  );

  return scheduler;
}

/**
 * Public menu action worker.
 * Writes only new assignments into currently blank Handler cells.
 */
function assignNewInterviewsOnly() {

  const lock = LockService.getScriptLock();

  if (!lock.tryLock(30000)) {
    throw new Error("Another scheduling operation is running. Please try again.");
  }

  try {

    const sheet = getMainSheet();
    const scheduler = createIncrementalScheduler_();

    const existingInfo = loadExistingAssignmentsIntoScheduler_(
      scheduler,
      sheet
    );

    const pending = getIncrementalPendingInterviews_(
      scheduler,
      sheet
    );

    if (pending.length === 0) {

      Logger.log("No new extracted interviews waiting for assignment.");

      return {
        existing: existingInfo.locked,
        pending: 0,
        assigned: 0,
        unassigned: 0
      };
    }

    const plan = planIncrementalAssignments_(
      scheduler,
      pending
    );

    writeIncrementalAssignments_(sheet, plan.assignments);

    Logger.log("========== INCREMENTAL ASSIGNMENT ==========");
    Logger.log("Existing locked : " + existingInfo.locked);
    Logger.log("New pending     : " + pending.length);
    Logger.log("New assigned    : " + plan.assignments.length);
    Logger.log("Still unassigned: " + plan.unassigned.length);
    Logger.log("============================================");

    return {
      existing: existingInfo.locked,
      pending: pending.length,
      assigned: plan.assignments.length,
      unassigned: plan.unassigned.length
    };

  }
  finally {
    lock.releaseLock();
  }
}


/**
 * Loads every existing current-day assignment from Column F into the
 * in-memory scheduler WITHOUT changing the sheet.
 *
 * A nonblank F cell is considered locked, even if it contains a
 * non-handler operational value. Only recognized handlers reserve a
 * slot and contribute to handler workload.
 */
function loadExistingAssignmentsIntoScheduler_(scheduler, sheet) {

  let locked = 0;
  let reserved = 0;

  scheduler.interviews.forEach(function(interview) {

    const handler = String(
      sheet.getRange(interview.row, COL.HANDLER).getDisplayValue() || ""
    ).trim();

    if (handler === "") {
      return;
    }

    locked++;

    scheduler.assignments.push({
      row: interview.row,
      handler: handler,
      interview: interview,
      fixed: false,
      locked: true,
      existing: true,
      reason: "Existing assignment",
      start: schedulerTimelineMinutes_(interview.interviewTime),
      end: schedulerTimelineMinutes_(interview.interviewTime) + interview.duration
    });

    if (!isSchedulableHandler_(handler)) {
      Logger.log(
        "Locked non-handler value -> Row " + interview.row +
        " | " + handler
      );
      return;
    }

    // Support remains a locked value, but it is not used as a normal
    // candidate. Reserving it is unnecessary for handler selection.
    if (handler !== SUPPORT_HANDLER) {

      schedulerReserveHandler_(
        scheduler.availability,
        handler,
        interview.interviewTime,
        interview.duration,
        "Existing Interview",
        interview.candidate
      );

      reserved++;
    }

    scheduler.statistics[handler] =
      (scheduler.statistics[handler] || 0) + 1;

    // getWeeklyNightCounts_() intentionally excludes the active day,
    // so existing current-day night assignments must be added here.
    recordNightAssignment_(scheduler, handler, interview);

  });

  return {
    locked: locked,
    reserved: reserved
  };
}


/**
 * True for actual scheduling identities used by this project.
 */
function isSchedulableHandler_(handler) {

  return MAIN_HANDLERS.indexOf(handler) !== -1 ||
    (SPECIAL_HANDLER && handler === SPECIAL_HANDLER) ||
    handler === SUPPORT_HANDLER;
}


/**
 * Returns only extracted interviews with blank Column F.
 * Existing nonblank assignments are never returned here.
 */
function getIncrementalPendingInterviews_(scheduler, sheet) {

  return scheduler.interviews.filter(function(interview) {

    const current = String(
      sheet.getRange(interview.row, COL.HANDLER).getDisplayValue() || ""
    ).trim();

    return current === "";
  });
}


/**
 * Creates an in-memory plan for only the new interviews.
 * No sheet writes happen here.
 */
function planIncrementalAssignments_(scheduler, pending) {

  const assignments = [];
  const unassigned = [];

  pending.forEach(function(interview) {

    let handler = "";
    let fixed = false;
    let reason = "Automatic - New Interview";

    //--------------------------------------------------------------
    // Preserve the existing fixed-handler behavior.
    //--------------------------------------------------------------
    if (interview.fixedHandler) {

      fixed = true;
      handler = interview.fixedHandler;
      reason = "Fixed Handler - New Interview";

      if (!schedulerIsHandlerAvailable_(
        scheduler.availability,
        handler,
        interview.interviewTime,
        interview.duration
      )) {

        unassigned.push({
          row: interview.row,
          interview: interview,
          reason: "Preferred handler unavailable"
        });

        Logger.log(
          "New interview unassigned -> " + interview.candidate +
          " | Preferred " + handler + " unavailable"
        );

        return;
      }
    }
    else {

      handler = findBestAvailableHandler(
        interview,
        scheduler
      );
    }

    //--------------------------------------------------------------
    // Reserve immediately so later new calls see this assignment.
    //--------------------------------------------------------------
    if (handler !== SUPPORT_HANDLER) {

      schedulerReserveHandler_(
        scheduler.availability,
        handler,
        interview.interviewTime,
        interview.duration,
        "New Interview",
        interview.candidate
      );
    }

    scheduler.statistics[handler] =
      (scheduler.statistics[handler] || 0) + 1;

    recordNightAssignment_(scheduler, handler, interview);

    const assignment = {
      row: interview.row,
      handler: handler,
      interview: interview,
      fixed: fixed,
      locked: false,
      existing: false,
      reason: reason,
      start: schedulerTimelineMinutes_(interview.interviewTime),
      end: schedulerTimelineMinutes_(interview.interviewTime) + interview.duration
    };

    scheduler.assignments.push(assignment);
    assignments.push(assignment);

    Logger.log(
      "New Assignment -> Row " + interview.row +
      " | " + interview.candidate +
      " | " + interview.interviewTime +
      " | " + handler +
      " | Today Load=" + (scheduler.statistics[handler] || 0)
    );

  });

  return {
    assignments: assignments,
    unassigned: unassigned
  };
}


/**
 * Writes only planned new assignments. The cell is checked again just
 * before writing, so a value entered manually during processing is not
 * overwritten.
 */
function writeIncrementalAssignments_(sheet, assignments) {

  assignments.forEach(function(a) {

    const cell = sheet.getRange(a.row, COL.HANDLER);
    const current = String(cell.getDisplayValue() || "").trim();

    if (current !== "") {

      Logger.log(
        "Skipped write because Handler cell became nonblank -> Row " +
        a.row + " | Current=" + current
      );

      return;
    }

    cell.setValue(a.handler);
  });
}


/*********************************************************************
 * SAFE TEST / PREVIEW
 *
 * Reads current data and creates a suggested plan only in memory.
 * DOES NOT write any Handler cells.
 *********************************************************************/
function testIncrementalAssignmentPlan() {

  if (!requireTodayLeaveSetup_()) {
    return;
  }

  const sheet = getMainSheet();
  const scheduler = createIncrementalScheduler_();

  const existingInfo = loadExistingAssignmentsIntoScheduler_(
    scheduler,
    sheet
  );

  const pending = getIncrementalPendingInterviews_(
    scheduler,
    sheet
  );

  const plan = planIncrementalAssignments_(
    scheduler,
    pending
  );

  Logger.log("========== NEW INTERVIEW PREVIEW ==========");
  Logger.log("Working Date    : " + getTodayDate());
  Logger.log("Existing locked : " + existingInfo.locked);
  Logger.log("New pending     : " + pending.length);
  Logger.log("");

  if (plan.assignments.length === 0) {
    Logger.log("No new assignable interviews found.");
  }

  plan.assignments.forEach(function(a) {

    Logger.log(
      "Row " + a.row +
      " | " + a.interview.interviewTime +
      " | " + a.interview.candidate +
      " -> " + a.handler +
      " | " + a.reason
    );
  });

  if (plan.unassigned.length > 0) {

    Logger.log("");
    Logger.log("UNASSIGNED:");

    plan.unassigned.forEach(function(item) {
      Logger.log(
        "Row " + item.row +
        " | " + item.interview.candidate +
        " | " + item.reason
      );
    });
  }

  Logger.log("===========================================");
}

