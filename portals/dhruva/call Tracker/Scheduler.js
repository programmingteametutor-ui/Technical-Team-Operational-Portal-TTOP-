/*************************************************
 * INTERVIEW SCHEDULER V3
 *************************************************/

const MAIN_HANDLERS = [

"Dhruva",
"Naresh",
"Bharat",
"Venkatesh",
"Avinash",
"Karthik",
"Gopal"

];

const SPECIAL_HANDLER = "Pradeep";
const SUPPORT_HANDLER = "Support";
function createScheduler() {

  const scheduler = {};

scheduler.interviews = sortInterviewsByTime(
    getExtractedInterviewObjects()
);

  scheduler.availability = getAvailability();

  // Upgrade Step 1: apply the selected all-day leave reservations
  // after the existing availability map is built. This deliberately
  // avoids changing the project's existing time helper functions.
  applyTodayLeaveToAvailability_(scheduler.availability);

  scheduler.statistics = {};

  // Upgrade Step 2: baseline weekly night-call counts from earlier
  // working dates in the current Monday-Sunday week.
  scheduler.weeklyNightStatistics = getWeeklyNightCounts_();

  scheduler.assignments = [];

  scheduler.unassigned = [];

  scheduler.priority = [...MAIN_HANDLERS];

  scheduler.priority.push(SPECIAL_HANDLER);

  Object.keys(scheduler.availability).forEach(function(name){

    scheduler.statistics[name] = 0;

  });

  Logger.log("Master Interviews : " + getInterviewObjects().length);
  Logger.log("Scheduler Interviews : " + scheduler.interviews.length);

  return scheduler;

}
/*************************************************
 * TIME HELPERS - CONTINUOUS OPERATIONAL DAY
 *
 * The working schedule crosses midnight. Clock-only minutes would map
 * 12:00 AM to 0 and incorrectly make it look earlier than 11:30 PM.
 *
 * Times before the operational cutover (default 6:00 AM) therefore
 * belong to the NEXT calendar day of the same working block:
 *
 *   11:30 PM -> 1410
 *   12:00 AM -> 1440
 *   12:20 AM -> 1460
 *
 * If SETTINGS.OPERATIONAL_DAY_CUTOVER_HOUR is later added, the scheduler
 * will honor it. Otherwise 6:00 AM matches the current overnight window.
 *************************************************/

function schedulerOperationalCutoverMinutes_() {

  const configured =
    (
      typeof SETTINGS !== "undefined" &&
      SETTINGS &&
      Number(SETTINGS.OPERATIONAL_DAY_CUTOVER_HOUR) >= 0 &&
      Number(SETTINGS.OPERATIONAL_DAY_CUTOVER_HOUR) < 12
    )
      ? Number(SETTINGS.OPERATIONAL_DAY_CUTOVER_HOUR)
      : 6;

  return configured * 60;
}


function schedulerClockMinutes_(timeString) {

  const text =
    String(timeString || "")
      .trim()
      .toUpperCase();

  const match =
    text.match(
      /(\d{1,2})[:.](\d{2})\s*(AM|PM)/
    );

  if(!match) {
    return -1;
  }

  let h = Number(match[1]);
  const m = Number(match[2]);
  const ampm = match[3];

  if(
    h < 1 ||
    h > 12 ||
    m < 0 ||
    m > 59
  ){
    return -1;
  }

  if(ampm === "PM" && h !== 12) {
    h += 12;
  }

  if(ampm === "AM" && h === 12) {
    h = 0;
  }

  return h * 60 + m;
}


function schedulerTimelineMinutes_(timeString) {

  const clock =
    schedulerClockMinutes_(
      timeString
    );

  if(clock < 0) {
    return -1;
  }

  if(
    clock <
      schedulerOperationalCutoverMinutes_()
  ){
    return clock + 1440;
  }

  return clock;
}

/**
 * Safely converts an interview start time + duration
 * into one validated scheduler interval.
 *
 * Returns:
 * {
 *   start: 1410,
 *   end: 1460,
 *   duration: 50
 * }
 *
 * Returns null when the time or duration is invalid.
 */
function schedulerBuildInterval_(startTime, duration) {

  const start =
    schedulerTimelineMinutes_(
      startTime
    );

  const length =
    Number(duration);

  if (
    !Number.isFinite(start) ||
    !Number.isFinite(length) ||
    start < 0 ||
    length <= 0
  ) {

    Logger.log(
      "INVALID SCHEDULER INTERVAL -> " +
      "StartTime=" + startTime +
      " | ParsedStart=" + start +
      " | Duration=" + duration +
      " | ParsedDuration=" + length
    );

    return null;
  }

  const end =
    start + length;

  if (!Number.isFinite(end)) {

    Logger.log(
      "INVALID SCHEDULER END -> " +
      "Start=" + start +
      " | Duration=" + length
    );

    return null;
  }

  return {
    start: start,
    end: end,
    duration: length
  };
}


function interviewMinutes(interview) {

  return schedulerTimelineMinutes_(
    interview.interviewTime
  );

}


// Compatibility name used by older source files. It now returns the
// continuous working-day minute so all scheduler paths use one timeline.
function timeToMinutes(timeString) {

  return schedulerTimelineMinutes_(
    timeString
  );

}


/*************************************************
 * HANDLER AVAILABILITY
 *************************************************/

function schedulerIsHandlerAvailable_(
  availability,
  handler,
  startTime,
  duration
){

  Logger.log(
    "Checking -> " +
    handler +
    " | Start=" +
    startTime +
    " | Duration=" +
    duration
  );

  const interval =
    schedulerBuildInterval_(
      startTime,
      duration
    );

  // Invalid time/duration must NEVER be treated as available.
  if (!interval) {

    Logger.log(
      "INVALID INTERVAL - NOT AVAILABLE -> " +
      handler +
      " | Start=" +
      startTime +
      " | Duration=" +
      duration
    );

    return false;
  }

  const start =
    interval.start;

  const end =
    interval.end;

  const bookings =
    availability[handler] || [];

  bookings.forEach(function(b){

    Logger.log(
      "Busy Slot -> " +
      handler +
      " : " +
      b.start +
      " - " +
      b.end
    );

  });

  for (
    let i = 0;
    i < bookings.length;
    i++
  ){

    const b =
      bookings[i];

    const busyStart =
      Number(b.start);

    const busyEnd =
      Number(b.end);

    // If an existing reservation itself is corrupted,
    // fail safely instead of pretending the handler is free.
    if (
      !Number.isFinite(busyStart) ||
      !Number.isFinite(busyEnd)
    ){

      Logger.log(
        "INVALID EXISTING BUSY SLOT -> " +
        handler +
        " | Start=" +
        b.start +
        " | End=" +
        b.end
      );

      return false;
    }

    /*
     * Half-open interval overlap rule:
     *
     * Existing: [busyStart, busyEnd)
     * New:      [start, end)
     *
     * Example:
     * 11:30 PM - 12:20 AM
     * 12:00 AM - 12:30 AM
     * = conflict
     *
     * But:
     * 11:30 PM - 12:20 AM
     * 12:20 AM - 12:50 AM
     * = allowed
     */
    if (
      start < busyEnd &&
      end > busyStart
    ){

      Logger.log(
        "CONFLICT FOUND for " +
        handler
      );

      return false;
    }

  }

  return true;
}

// Compatibility wrapper for older code.
function isHandlerAvailable(
  availability,
  handler,
  startTime,
  duration
){

  return schedulerIsHandlerAvailable_(
    availability,
    handler,
    startTime,
    duration
  );
}


function schedulerReserveHandler_(
  availability,
  handler,
  startTime,
  duration,
  type,
  candidate
){

  Logger.log(
    "Reserve -> " +
    handler +
    " | " +
    startTime +
    " | Duration=" +
    duration
  );

  const interval =
    schedulerBuildInterval_(
      startTime,
      duration
    );

  // Never create a corrupt reservation.
  if (!interval) {

    Logger.log(
      "RESERVATION REJECTED - INVALID INTERVAL -> " +
      handler +
      " | " +
      startTime +
      " | Duration=" +
      duration +
      " | Candidate=" +
      String(candidate || "")
    );

    return false;
  }

  const start =
    interval.start;

  const end =
    interval.end;

  const length =
    interval.duration;

  Logger.log(
    "Stored Slot -> " +
    start +
    " - " +
    end
  );

  if (!availability[handler]){
    availability[handler] = [];
  }

  availability[handler].push({
    start: start,
    end: end,
    duration: length,
    type: type,
    candidate: candidate
  });

  return true;
}


// Compatibility wrapper for older code.
function reserveHandler(
  availability,
  handler,
  startTime,
  duration,
  type,
  candidate
){

  return schedulerReserveHandler_(
    availability,
    handler,
    startTime,
    duration,
    type,
    candidate
  );
}


/*****************************************************************
 * REMOVE BUSY SLOT
 *****************************************************************/
function schedulerRemoveBusySlot_(
  availability,
  handler,
  startTime,
  duration
){

  if(!availability[handler]){
    return;
  }

  const start =
    schedulerTimelineMinutes_(
      startTime
    );

  const end =
    start + Number(duration || 0);

  availability[handler] =
    availability[handler]
      .filter(function(slot){

        return !(
          Number(slot.start) === start &&
          Number(slot.end) === end
        );

      });

}


// Compatibility wrapper for older code.
function removeBusySlot(
  availability,
  handler,
  startTime,
  duration
){

  schedulerRemoveBusySlot_(
    availability,
    handler,
    startTime,
    duration
  );
}
/*************************************************
 * FIXED HANDLERS
 *************************************************/

function assignFixedHandlers(scheduler) {

  scheduler.interviews.forEach(function(interview){

    if (!interview.fixedHandler)
      return;

    const handler = interview.fixedHandler;

    if (!schedulerIsHandlerAvailable_(

      scheduler.availability,
      handler,
      interview.interviewTime,
      interview.duration

    )) {

      scheduler.unassigned.push({

        interview: interview,

        reason: "Preferred handler busy"

      });

      return;

    }

    schedulerReserveHandler_(

      scheduler.availability,

      handler,

      interview.interviewTime,

      interview.duration,

      "Interview",

      interview.candidate

    );

    scheduler.statistics[handler]++;

    // Fixed night calls also count toward weekly fairness for normal handlers.
    recordNightAssignment_(scheduler, handler, interview);

    scheduler.assignments.push({

      row: interview.row,

      handler: handler,

      interview: interview,

      fixed: true,

      start: schedulerTimelineMinutes_(interview.interviewTime),

      end: schedulerTimelineMinutes_(interview.interviewTime) + interview.duration

    });

  });

}
function getPendingInterviews(scheduler){

  const fixed = {};

  scheduler.assignments.forEach(function(a){

    fixed[a.row] = true;

  });

  return scheduler.interviews.filter(function(interview){

    return !fixed[interview.row];

  });

}
function getHandlerLoad(scheduler, handler) {
  return scheduler.statistics[handler] || 0;
}
function assignNormalHandlers(scheduler) {

  const pending = getPendingInterviews(scheduler);

  pending.forEach(function(interview){

    const handler = findBestAvailableHandler(interview, scheduler);

    schedulerReserveHandler_(
      scheduler.availability,
      handler,
      interview.interviewTime,
      interview.duration,
      "Interview",
      interview.candidate
    );

    scheduler.assignments.push({

      row: interview.row,

      handler: handler,

      interview: interview,

      fixed: false,

      locked: false,

      reason: "Automatic",

start: schedulerTimelineMinutes_(interview.interviewTime),

end: schedulerTimelineMinutes_(interview.interviewTime) + interview.duration

    });

    scheduler.statistics[handler] =
      (scheduler.statistics[handler] || 0) + 1;

    // Update the in-memory weekly night tally immediately so later
    // night calls in the same Auto Assign run see the new count.
    recordNightAssignment_(scheduler, handler, interview);

  });

}
function findBestAvailableHandler(interview, scheduler) {

  // First try ONLY the normal/main handlers.
  let candidates = [];
  const nightCall = isNightCallTime_(interview.interviewTime);

  MAIN_HANDLERS.forEach(function(handler){

    if (!schedulerIsHandlerAvailable_(
      scheduler.availability,
      handler,
      interview.interviewTime,
      interview.duration
    )) {
      return;
    }

    candidates.push({
      handler: handler,
      load: scheduler.statistics[handler] || 0,
      nightLoad: scheduler.weeklyNightStatistics
        ? (scheduler.weeklyNightStatistics[handler] || 0)
        : 0,
      order: getMainHandlerOrderIndex_(handler)
    });

  });

  // If one or more normal handlers are available.
  if (candidates.length > 0) {

    candidates.sort(function(a,b){

      // For calls at 2:00 AM or later, weekly night fairness has
      // first priority. Today's total load breaks ties.
      if (nightCall) {

        if (a.nightLoad !== b.nightLoad)
          return a.nightLoad - b.nightLoad;

        if (a.load !== b.load)
          return a.load - b.load;

        return a.order - b.order;
      }

      // Preserve the existing normal-call behavior: lowest daily load.
      if (a.load !== b.load)
        return a.load - b.load;

      return a.handler.localeCompare(b.handler);

    });

    if (nightCall) {
      Logger.log(
        "Night Selection -> " + candidates[0].handler +
        " | Weekly Night Load=" + candidates[0].nightLoad +
        " | Today Load=" + candidates[0].load
      );
    }

    return candidates[0].handler;

  }

  //--------------------------------------------------
  // All six busy
  // Try Pradeep
  //--------------------------------------------------

  if (
    schedulerIsHandlerAvailable_(
      scheduler.availability,
      SPECIAL_HANDLER,
      interview.interviewTime,
      interview.duration
    )
  ) {
    return SPECIAL_HANDLER;
  }

  //--------------------------------------------------
  // Everybody busy
  //--------------------------------------------------

  return SUPPORT_HANDLER;

}
/**
 * Safe in-memory regression test for Requirement 3.
 * Expected:
 * - 11:30 PM / 50 min reserves Gopal until 12:20 AM.
 * - 12:00 AM is NOT available.
 * - 12:20 AM IS available (end-to-start touching is allowed).
 */
function testCrossMidnightConflictRule() {

  const availability = {
    Gopal: []
  };

  schedulerReserveHandler_(
    availability,
    "Gopal",
    "11:30 PM",
    50,
    "Test",
    "Cross-midnight test"
  );

  const atMidnight =
    schedulerIsHandlerAvailable_(
      availability,
      "Gopal",
      "12:00 AM",
      30
    );

  const atEnd =
    schedulerIsHandlerAvailable_(
      availability,
      "Gopal",
      "12:20 AM",
      30
    );

  const result = {
    reserved:
      availability.Gopal[0],
    midnightAvailable:
      atMidnight,
    endTimeAvailable:
      atEnd,
    pass:
      atMidnight === false &&
      atEnd === true
  };

  Logger.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );

  return result;
}


function writeAssignments(scheduler) {

  const sheet = getMainSheet();

  scheduler.assignments.forEach(function(a){

    sheet
      .getRange(a.row, COL.HANDLER)
      .setValue(a.handler);

  });

}