/*********************************************************************
 * Interview Scheduler
 * Main.gs
 * Version : 2.0
 *********************************************************************/

/**
 * Creates the custom menu whenever the spreadsheet opens.
 */
function onOpen() {

  SpreadsheetApp.getUi()
    .createMenu("🤖 Interview Scheduler")
    .addItem("📥 Extract Today's Interviews", "extractToday")
    .addSeparator()
    .addItem("👥 Set Today's Leave", "setTodayLeave")
    .addItem("👁️ View Today's Leave", "viewTodayLeave")
    .addSeparator()
    .addItem("⚙️ Auto Assign Handlers", "autoAssign")
    .addSeparator()
    .addItem("🔄 Reassign Selected Interview", "reassignSelected")
    .addSeparator()
    .addItem("📊 Today's Summary", "showSummary")
    .addSeparator()
    .addItem("🧹 Reset Today's Assignments", "resetToday")
    .addToUi();

}


/**
 * Extract interviews from Column B to Column E
 */
function extractToday() {

  runSafely(function () {

    const start = new Date();

    showToast("Detecting today's interviews...");

    extractTodayInterviews();

    const end = new Date();

    showToast("Completed in " + elapsed(start, end));

  });

}


/**
 * Auto assign handlers.
 */
function autoAssign() {

  runSafely(function () {

    if (!requireTodayLeaveSetup_()) {
      return;
    }

    const start = new Date();

    showToast("Assigning interviews...");

    autoAssignHandlers();

    const end = new Date();

    showToast("Completed in " + elapsed(start, end));

  });

}



/**
 * Manual reassignment.
 */
function reassignSelected() {

  runSafely(function () {

    reassignCurrentRow();

  });

}


/**
 * Show today's statistics.
 */
function showSummary() {

  runSafely(function () {

    displayTodaySummary();

  });

}


/**
 * Reset only today's assignments.
 */
function resetToday() {

  runSafely(function () {

    clearTodayAssignments();

  });

}


/*********************************************************************
 * COMMON UTILITIES
 *********************************************************************/

/**
 * Runs a function safely.
 */
function runSafely(fn) {

  try {

    fn();

  }

  catch (err) {

    SpreadsheetApp.getUi().alert(

      "Interview Scheduler\n\n" +

      err.message

    );

    Logger.log(err);

  }

}


/**
 * Shows toast message.
 */
function showToast(message) {

  SpreadsheetApp
    .getActiveSpreadsheet()
    .toast(message, "Interview Scheduler", 5);

}


/**
 * Returns execution time.
 */
function elapsed(start, end) {

  const seconds = ((end - start) / 1000).toFixed(2);

  return seconds + " sec";

}


/*********************************************************************
 * PLACE HOLDERS
 * (Will be replaced as we build modules)
 *********************************************************************/




function autoAssignHandlers() {

  const scheduler = createScheduler();

  // Step 1
  assignFixedHandlers(scheduler);

  // Step 2
  assignNormalHandlers(scheduler);

  // Step 3
  writeAssignments(scheduler);

  Logger.log(
      "Assigned : " +
      scheduler.assignments.length
  );

}


function reassignCurrentRow() {

  const sheet = getMainSheet();

  const row = sheet.getActiveCell().getRow();

  if (row < 2) {
    SpreadsheetApp.getUi().alert("Please select an interview row.");
    return;
  }

  const extracted = sheet
    .getRange(row, COL.EXTRACTED)
    .getDisplayValue()
    .trim();

  if (extracted === "") {
    SpreadsheetApp.getUi().alert(
      "Selected row does not contain an extracted interview."
    );
    return;
  }

  const interview = parseMatchedInterview(extracted);

  interview.row = row;

  const currentHandler = sheet
    .getRange(row, COL.HANDLER)
    .getDisplayValue()
    .trim();

const scheduler = createScheduler();

//--------------------------------------------------
// Build availability only
//--------------------------------------------------

scheduler.interviews.forEach(function(interviewObj){

  const handler = sheet
    .getRange(interviewObj.row, COL.HANDLER)
    .getDisplayValue()
    .trim();

  if(handler === "")
    return;

  schedulerReserveHandler_(
    scheduler.availability,
    handler,
    interviewObj.interviewTime,
    interviewObj.duration,
    "Interview",
    interviewObj.candidate
  );

  scheduler.statistics[handler] =
    (scheduler.statistics[handler] || 0) + 1;

});

// Remove the current interview from this handler
schedulerRemoveBusySlot_(
    scheduler.availability,
    currentHandler,
    interview.interviewTime,
    interview.duration
);

// Reduce handler load by one
scheduler.statistics[currentHandler] =
Math.max((scheduler.statistics[currentHandler] || 1) - 1, 0);

  scheduler.priority = MAIN_HANDLERS.filter(function(h){

    return h !== currentHandler;

  });

  const suggested =
    findBestAvailableHandler(interview, scheduler);

  const ui = SpreadsheetApp.getUi();

  const result = ui.alert(

    "Manual Reassignment",

    "Current Handler : " + currentHandler +

    "\n\nSuggested Handler : " + suggested +

    "\n\nAssign this handler?",

    ui.ButtonSet.YES_NO

  );

if (result == ui.Button.YES) {

  sheet
    .getRange(row, COL.HANDLER)
    .setValue(suggested);

  ui.alert("Interview reassigned to " + suggested);

  return;
}

//--------------------------------------------------
// User clicked NO
//--------------------------------------------------

const available = [];

//--------------------------------------------------
// Always include the suggested handler first
//--------------------------------------------------

if (
  suggested &&
  suggested !== currentHandler &&
  !available.includes(suggested)
) {
  available.push(suggested);
}

//--------------------------------------------------
// Remaining available main handlers
//--------------------------------------------------

MAIN_getSchedulerDisplayHandlers_().forEach(function(handler){

  if(handler === currentHandler) return;

  if(handler === suggested) return;

  if(
    schedulerIsHandlerAvailable_(
      scheduler.availability,
      handler,
      interview.interviewTime,
      interview.duration
    )
  ){
    available.push(handler);
  }

});

//--------------------------------------------------
// Add optional special/fallback handler if available
//--------------------------------------------------

if(
  SPECIAL_HANDLER &&
  SPECIAL_HANDLER !== currentHandler &&
  SPECIAL_HANDLER !== suggested &&
  schedulerIsHandlerAvailable_(
    scheduler.availability,
    SPECIAL_HANDLER,
    interview.interviewTime,
    interview.duration
  )
){
  available.push(SPECIAL_HANDLER);
}

//--------------------------------------------------
// Always allow Support
//--------------------------------------------------

if(!available.includes(SUPPORT_HANDLER)){
  available.push(SUPPORT_HANDLER);
}
if(available.length === 0){

  ui.alert("No alternate handler available.");

  return;

}

let message = "Available Handlers\n\n";

available.forEach(function(name,index){

  message += (index+1) + " - " + name + "\n";

});

const response = ui.prompt(

  "Manual Assignment",

  message + "\n\nEnter the number:",

  ui.ButtonSet.OK_CANCEL

);

if(response.getSelectedButton() != ui.Button.OK)
  return;

const choice = parseInt(response.getResponseText(),10);

if(isNaN(choice) || choice < 1 || choice > available.length){

  ui.alert("Invalid Selection.");

  return;

}

const selected = available[choice - 1];

sheet
  .getRange(row, COL.HANDLER)
  .setValue(selected);
ui.alert(
  "Interview reassigned to " + selected
);
  }




function displayTodaySummary() {

  const sheet = getMainSheet();
  const block = getTodayBlock();

  const values = sheet.getRange(
    block.startRow,
    COL.HANDLER,
    block.totalRows,
    1
  ).getDisplayValues();

  const summary = {};

  getSchedulerDisplayHandlers_().forEach(function(handler){
    summary[handler] = 0;
  });

  let total = 0;

  values.forEach(function(row){

    const handler = String(row[0]).trim();

    if(handler === "")
      return;

    total++;

    if(summary[handler] == null)
      summary[handler] = 0;

    summary[handler]++;

  });

  //----------------------------------------------------
  // Write Summary in H:I
  //----------------------------------------------------

  const startCol = 8;   // Column H
  const startRow = block.startRow;

  // Clear old summary
  sheet.getRange(startRow, startCol, 20, 2).clearContent();

  const output = [];

  output.push(["Today's Interview Summary",""]);
  output.push(["",""]);
  output.push(["Total Interviews", total]);
  output.push(["",""]);

  getSchedulerDisplayHandlers_().forEach(function(handler){

    output.push([
      handler,
      summary[handler]
    ]);

  });

  sheet
    .getRange(startRow, startCol, output.length, 2)
    .setValues(output);

  //----------------------------------------------------
  // Formatting
  //----------------------------------------------------

  sheet
    .getRange(startRow, startCol)
    .setFontWeight("bold")
    .setFontSize(12);

  sheet
    .getRange(startRow + 2, startCol, output.length - 2, 2)
    .setBorder(
      true,
      true,
      true,
      true,
      true,
      true
    );

  sheet.autoResizeColumn(startCol);
  sheet.autoResizeColumn(startCol + 1);

}

function clearTodayAssignments() {

  SpreadsheetApp
    .getUi()
    .alert("Reset module is not added yet.");

}

