/*************************************************
 * INTERVIEW SCHEDULER V3.3 - HYD 30-MIN PRE-CALL SETUP
 *************************************************/

/* Handler roster is supplied dynamically by TeamRuntime.gs. */
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

  if (SPECIAL_HANDLER) scheduler.priority.push(SPECIAL_HANDLER);

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
 * HYDERABAD PRE-CALL SETUP WINDOW
 *
 * HYD has no dedicated setup-support person. A real Handler assigned
 * to a call must therefore be free before the interview so they can
 * prepare the call. Example with a 30-minute setup window:
 *
 *   Interview: 9:00 PM, Duration: 30 mins
 *   Handler reservation: 8:30 PM -> 9:30 PM
 *
 * Support is an overflow LABEL, not a normal Hyderabad person, so it
 * does not receive a personal setup reservation.
 *************************************************/

function schedulerPreCallSetupMinutes_(handler){

  if(
    typeof SUPPORT_HANDLER !== "undefined" &&
    String(handler || "") === String(SUPPORT_HANDLER || "")
  ){
    return 0;
  }

  const configured =
    (
      typeof SETTINGS !== "undefined" &&
      SETTINGS &&
      Number(SETTINGS.PRE_CALL_SETUP_MINUTES) >= 0
    )
      ? Number(SETTINGS.PRE_CALL_SETUP_MINUTES)
      : 30;

  return configured;
}


function schedulerAssignmentWindow_(
  handler,
  startTime,
  duration
){

  const callStart = schedulerTimelineMinutes_(startTime);
  const callDuration = Number(duration || 0);

  if(callStart < 0 || callDuration <= 0){
    return null;
  }

  const setupMinutes = schedulerPreCallSetupMinutes_(handler);

  return {
    callStart: callStart,
    callEnd: callStart + callDuration,
    start: callStart - setupMinutes,
    end: callStart + callDuration,
    setupMinutes: setupMinutes,
    callDuration: callDuration,
    reservedDuration: setupMinutes + callDuration
  };
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

  const window = schedulerAssignmentWindow_(
    handler,
    startTime,
    duration
  );

  Logger.log(
    "Checking -> " +
    handler +
    " | Call=" +
    startTime +
    " | Duration=" +
    duration +
    " | Setup=" +
    (window ? window.setupMinutes : "INVALID")
  );

  if(!window){
    return false;
  }

  // Support is an unlimited overflow label. It is intentionally not
  // treated as a normal person with a personal calendar.
  if(
    typeof SUPPORT_HANDLER !== "undefined" &&
    String(handler || "") === String(SUPPORT_HANDLER || "")
  ){
    return true;
  }

  const bookings = availability[handler] || [];

  for(let i = 0; i < bookings.length; i++){

    const b = bookings[i];

    if(
      window.start < Number(b.end) &&
      window.end > Number(b.start)
    ){
      Logger.log(
        "CONFLICT FOUND for " + handler +
        " | Required=" + window.start + "-" + window.end +
        " | Busy=" + b.start + "-" + b.end
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

  const window = schedulerAssignmentWindow_(
    handler,
    startTime,
    duration
  );

  if(!window){
    return false;
  }

  // Support is only an overflow marker. Do not block future overflow
  // calls just because another row is already assigned to Support.
  if(
    typeof SUPPORT_HANDLER !== "undefined" &&
    String(handler || "") === String(SUPPORT_HANDLER || "")
  ){
    return true;
  }

  Logger.log(
    "Reserve -> " + handler +
    " | Call=" + startTime +
    " | Setup=" + window.setupMinutes +
    " | Stored Slot=" + window.start + "-" + window.end
  );

  if(!availability[handler]){
    availability[handler] = [];
  }

  availability[handler].push({
    start: window.start,
    end: window.end,
    callStart: window.callStart,
    callEnd: window.callEnd,
    setupMinutes: window.setupMinutes,
    duration: window.callDuration,
    reservedDuration: window.reservedDuration,
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

  const window = schedulerAssignmentWindow_(
    handler,
    startTime,
    duration
  );

  if(!window){
    return;
  }

  availability[handler] =
    availability[handler].filter(function(slot){
      return !(
        Number(slot.start) === Number(window.start) &&
        Number(slot.end) === Number(window.end)
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
  // All normal handlers busy
  // Try optional special/fallback handler
  //--------------------------------------------------

  if (
    SPECIAL_HANDLER &&
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
 * Safe in-memory regression test for Requirement 3 + HYD setup rule.
 * With a 30-minute pre-call setup window:
 * - 11:30 PM / 50 min occupies the handler from 11:00 PM until 12:20 AM.
 * - A 12:20 AM call is NOT available because its setup starts at 11:50 PM.
 * - A 12:50 AM call IS available because its setup begins exactly at 12:20 AM.
 */
function testCrossMidnightConflictRule() {

  const handler = MAIN_HANDLERS[0] || SPECIAL_HANDLER || "Test Handler";
  const availability = {};
  availability[handler] = [];

  schedulerReserveHandler_(
    availability,
    handler,
    "11:30 PM",
    50,
    "Test",
    "Cross-midnight setup test"
  );

  const atMidnight = schedulerIsHandlerAvailable_(
    availability, handler, "12:00 AM", 30
  );

  const atPriorCallEnd = schedulerIsHandlerAvailable_(
    availability, handler, "12:20 AM", 30
  );

  const afterSetupGap = schedulerIsHandlerAvailable_(
    availability, handler, "12:50 AM", 30
  );

  const result = {
    setupMinutes: schedulerPreCallSetupMinutes_(handler),
    reserved: availability[handler][0],
    midnightAvailable: atMidnight,
    startAtPriorCallEndAvailable: atPriorCallEnd,
    startAfterRequiredSetupAvailable: afterSetupGap,
    pass:
      atMidnight === false &&
      atPriorCallEnd === false &&
      afterSetupGap === true
  };

  Logger.log(JSON.stringify(result,null,2));
  return result;
}


/**
 * HYD-specific safe test. No sheet writes.
 * Expected:
 * 1) A 9:00 PM / 30 min call reserves 8:30 PM -> 9:30 PM.
 * 2) The same Handler cannot take a 9:30 PM call because that call's
 *    setup would start at 9:00 PM.
 * 3) The Handler can take a 10:00 PM call because setup starts at 9:30 PM.
 * 4) If every real HYD Handler is occupied, findBestAvailableHandler()
 *    returns Support as the overflow fallback.
 */
function testHydSetupBufferAndOverflowRule(){

  const handler = MAIN_HANDLERS[0] || "Test Handler";
  const availability = {};
  MAIN_HANDLERS.forEach(function(name){ availability[name] = []; });
  if(!availability[handler]) availability[handler] = [];

  schedulerReserveHandler_(
    availability, handler, "9:00 PM", 30, "Test", "Setup test"
  );

  const stored = availability[handler][0] || null;
  const at930 = schedulerIsHandlerAvailable_(
    availability, handler, "9:30 PM", 30
  );
  const at1000 = schedulerIsHandlerAvailable_(
    availability, handler, "10:00 PM", 30
  );

  const scheduler = {
    availability: {},
    statistics: {},
    weeklyNightStatistics: {}
  };

  MAIN_HANDLERS.forEach(function(name){
    scheduler.availability[name] = [];
    scheduler.statistics[name] = 0;
    scheduler.weeklyNightStatistics[name] = 0;
    schedulerReserveHandler_(
      scheduler.availability, name, "9:00 PM", 30, "Test", "Overflow test"
    );
  });

  if(SPECIAL_HANDLER){
    scheduler.availability[SPECIAL_HANDLER] = [];
    scheduler.statistics[SPECIAL_HANDLER] = 0;
    schedulerReserveHandler_(
      scheduler.availability, SPECIAL_HANDLER, "9:00 PM", 30, "Test", "Overflow test"
    );
  }

  const overflow = findBestAvailableHandler({
    interviewTime: "9:15 PM",
    duration: 30
  }, scheduler);

  const expectedStart = schedulerTimelineMinutes_("9:00 PM") - 30;
  const expectedEnd = schedulerTimelineMinutes_("9:00 PM") + 30;

  const result = {
    handler: handler,
    setupMinutes: schedulerPreCallSetupMinutes_(handler),
    storedWindow: stored,
    expectedWindow: {start: expectedStart, end: expectedEnd},
    nineThirtyAvailable: at930,
    tenOClockAvailable: at1000,
    overflowHandler: overflow,
    pass:
      !!stored &&
      Number(stored.start) === expectedStart &&
      Number(stored.end) === expectedEnd &&
      at930 === false &&
      at1000 === true &&
      overflow === SUPPORT_HANDLER
  };

  Logger.log(JSON.stringify(result,null,2));
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