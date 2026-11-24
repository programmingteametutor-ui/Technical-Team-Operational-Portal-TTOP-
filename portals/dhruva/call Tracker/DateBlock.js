/*********************************************************************
 * Interview Scheduler
 * DateBlock.gs
 * Version : 2.0
 *********************************************************************/

/**
 * Returns today's working block.
 *
 * Output:
 * {
 *   startRow : 12096,
 *   endRow   : 12190,
 *   totalRows: 95,
 *   date     : "23-Jul-2026"
 * }
 */
function getTodayBlock() {

  const sheet = getMainSheet();

  const lastRow = sheet.getLastRow();

  if (lastRow === 0) {

    throw new Error("InterviewBot 2026 sheet is empty.");

  }

  // Read Column B only once
  const values = sheet
    .getRange(1, COL.MASTER, lastRow, 1)
    .getDisplayValues()
    .flat();

  let startRow = -1;
  let blockDate = "";

  // Find the last date header
  for (let i = values.length - 1; i >= 0; i--) {

    const text = String(values[i]).trim();

    if (REGEX.DATE.test(text)) {

      startRow = i + 1;
      blockDate = text;

      break;

    }

  }

  if (startRow === -1) {

    throw new Error("Unable to find latest date block.");

  }

  let endRow = lastRow;

  // Find where next date starts
  for (let i = startRow; i < values.length; i++) {

    const text = String(values[i]).trim();

    if (REGEX.DATE.test(text)) {

      endRow = i;

      break;

    }

  }

  return {

    startRow: startRow,

    endRow: endRow,

    totalRows: endRow - startRow + 1,

    date: blockDate

  };

}


/**
 * Returns today's rows as objects.
 *
 * [
 *   {
 *      row:12097,
 *      master:".....",
 *      lookup:"Ajay -5:30",
 *      extracted:"",
 *      handler:""
 *   }
 * ]
 */
function getTodayRows() {

  const sheet = getMainSheet();
  const block = getTodayBlock();

  const values = sheet.getRange(
    block.startRow,
    1,
    block.totalRows,
    6
  ).getDisplayValues();

  const rows = [];

  values.forEach(function(r, index) {

    // Skip the date header row
    if (String(r[0]).trim() === "")
      return;

    rows.push({

      row: block.startRow + index,

      serial: r[0].trim(),

      master: r[1].trim(),

      lookup: r[3].trim(),

      extracted: r[4].trim(),

      handler: r[5].trim()

    });

  });

  return rows;

}


/**
 * Returns active worksheet.
 */
function getMainSheet() {

  let ss =
    SpreadsheetApp.getActiveSpreadsheet();

  // When the bound project runs as a Web App there is no active
  // spreadsheet UI context. Fall back to the explicit Call Tracker ID.
  if(!ss){

    if(
      typeof CSB_workbook_ !== "function"
    ){
      throw new Error(
        "CALL_TRACKER_CONTEXT_NOT_AVAILABLE"
      );
    }

    ss =
      CSB_workbook_();
  }

  const sheet =
    ss.getSheetByName(
      SHEETS.MAIN
    );

  if (!sheet) {

    throw new Error(
      "Sheet '" + SHEETS.MAIN + "' not found."
    );

  }

  return sheet;

}


/**
 * Returns today's date string.
 */
function getTodayDate() {

  return getTodayBlock().date;

}


/**
 * Returns today's total interview rows.
 */
function getTodayRowCount() {

  return getTodayBlock().totalRows;

}


/*********************************************************************
 * TEST FUNCTIONS
 *********************************************************************/

/**
 * Test latest date block.
 */
function testDateBlock() {

  const block = getTodayBlock();

  Logger.log(JSON.stringify(block));

  SpreadsheetApp.getActiveSpreadsheet().toast(
    "Date: " + block.date +
    "\nStart: " + block.startRow +
    "\nEnd: " + block.endRow,
    "Interview Scheduler",
    5
  );

}
/**
 * Test row reader.
 */
function testTodayRows() {

  const rows = getTodayRows();

  Logger.log(rows);

  SpreadsheetApp.getUi().alert(

    "Today's Interviews : " +

    rows.length

  );

}
