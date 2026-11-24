/******************************************************
 * PORTALTEAMDAYCONTROL.GS
 * Team Data open-day control for Interview Operations Portal
 *
 * Install in: Interview Portal Control project
 *
 * PURPOSE
 * -------
 * Team Data uses ONE date header in Column A, followed by
 * that day's approved interview rows in Columns B:E.
 *
 * Admin explicitly closes the current day from the portal.
 * Closing writes the NEXT BUSINESS DAY header immediately
 * after the current day's final interview row.
 * Saturday / Sunday are skipped.
 *
 * No new Google Sheet is created.
 ******************************************************/

const PORTAL_TEAM_DAY = {

  DISPLAY_FORMAT:
    "m/d/yyyy dddd",

  STATUS_VALUES: [
    "In Progress",
    "Selected"
  ]

};


/******************************************************
 * PUBLIC: ADMIN DAY CONTROL STATE
 ******************************************************/
function getPortalTeamDayControlState(
  token
){

  PO_requireAdmin_(token);

  return PTD_buildPortalState_();
}


/******************************************************
 * PUBLIC: ADMIN COMPLETES CURRENT TEAM DATA DAY
 *
 * expectedOpenDateKey prevents accidental double-clicks.
 ******************************************************/
function completePortalTeamDay(
  token,
  expectedOpenDateKey
){

  const user =
    PO_requireAdmin_(token);

  const expected =
    PTD_normalizeDateKey_(
      expectedOpenDateKey
    );

  if(!expected){
    throw new Error(
      "TEAM_DAY_EXPECTED_DATE_REQUIRED"
    );
  }

  const lock =
    LockService.getScriptLock();

  lock.waitLock(30000);

  try{

    const sheet =
      PTD_teamSheet_();

    const layout =
      PTD_getOpenDayLayout_(
        sheet
      );

    if(!layout.dateKey){
      throw new Error(
        "TEAM_DATA_OPEN_DAY_NOT_FOUND"
      );
    }

    if(
      layout.dateKey !==
      expected
    ){
      throw new Error(
        "TEAM_DAY_ALREADY_ADVANCED|current=" +
        layout.dateKey
      );
    }

    if(layout.needsCompaction){
      throw new Error(
        "TEAM_DATA_NEEDS_COMPACTION"
      );
    }

    const pending =
      PTD_pendingCounts_(
        layout.dateKey
      );

    if(
      pending.outcomes > 0 ||
      pending.reassignments > 0
    ){
      throw new Error(
        "TEAM_DAY_PENDING_APPROVALS|outcomes=" +
        pending.outcomes +
        "|reassignments=" +
        pending.reassignments
      );
    }

    const nextDate =
      PTD_nextBusinessDate_(
        layout.dateKey
      );

    const headerRow =
      layout.nextWriteRow;

    if(
      headerRow >
      sheet.getMaxRows()
    ){

      sheet.insertRowsAfter(
        sheet.getMaxRows(),
        headerRow -
          sheet.getMaxRows()
      );

    }

    //--------------------------------------------------
    // Date header row must contain ONLY Column A value.
    // clearContent preserves formatting / validation.
    //--------------------------------------------------

    sheet
      .getRange(
        headerRow,
        1,
        1,
        5
      )
      .clearContent();

    sheet
      .getRange(
        headerRow,
        1
      )
      .setValue(
        nextDate.date
      )
      .setNumberFormat(
        PORTAL_TEAM_DAY.DISPLAY_FORMAT
      );

    SpreadsheetApp.flush();

    PO_appendAudit_({

      actorEmail:
        user.email,

      role:
        user.role,

      action:
        "Complete Team Data Day",

      targetType:
        "Team Data",

      targetId:
        layout.dateKey,

      oldValue:
        layout.dateLabel,

      newValue:
        nextDate.label,

      handler:
        "",

      details:
        "Closed Team Data day at row " +
        layout.headerRow +
        "; next working-day header written at row " +
        headerRow +
        "."

    });

    return {

      ok:
        true,

      closedDateKey:
        layout.dateKey,

      closedDateLabel:
        layout.dateLabel,

      newOpenDateKey:
        nextDate.key,

      newOpenDateLabel:
        nextDate.label,

      newHeaderRow:
        headerRow,

      message:
        layout.dateLabel +
        " completed. Team Data is now open for " +
        nextDate.label +
        ".",

      state:
        PTD_buildPortalState_()

    };

  }
  finally{

    lock.releaseLock();

  }
}


/******************************************************
 * MANUAL READ-ONLY TEST
 *
 * Run from Interview Portal Control Apps Script editor.
 ******************************************************/
function testPortalTeamDayControlState(){

  const state =
    PTD_buildPortalState_();

  Logger.log(
    "========== TEAM DATA DAY CONTROL =========="
  );

  Logger.log(
    JSON.stringify(
      state,
      null,
      2
    )
  );

  Logger.log(
    "==========================================="
  );

  return state;
}


/******************************************************
 * MANUAL READ-ONLY COMPACTION PREVIEW
 *
 * This does NOT change Team Data.
 ******************************************************/
function previewCompactCurrentOpenTeamDay(){

  const sheet =
    PTD_teamSheet_();

  const layout =
    PTD_getOpenDayLayout_(
      sheet
    );

  const preview = {

    openDateKey:
      layout.dateKey,

    openDateLabel:
      layout.dateLabel,

    headerRow:
      layout.headerRow,

    recordCount:
      layout.recordCount,

    firstRecordRow:
      layout.firstRecordRow,

    lastRecordRow:
      layout.lastRecordRow,

    nextWriteRow:
      layout.nextWriteRow,

    gapRows:
      layout.gapRows,

    needsCompaction:
      layout.needsCompaction,

    unexpectedRows:
      layout.unexpectedRows,

    safeToCompact:
      layout.unexpectedRows.length === 0

  };

  Logger.log(
    "========== TEAM DATA COMPACTION PREVIEW =========="
  );

  Logger.log(
    JSON.stringify(
      preview,
      null,
      2
    )
  );

  Logger.log(
    "=================================================="
  );

  return preview;
}


/******************************************************
 * MANUAL ONE-TIME COMPACTION
 *
 * IMPORTANT:
 * Run ONLY after previewCompactCurrentOpenTeamDay()
 * has been reviewed.
 *
 * It moves current open-day B:E records directly below
 * the date header and clears phantom "In Progress" rows.
 * Existing values, including Selection Confirmed Date E,
 * are preserved.
 ******************************************************/
function compactCurrentOpenTeamDay(){

  const lock =
    LockService.getScriptLock();

  lock.waitLock(30000);

  try{

    const sheet =
      PTD_teamSheet_();

    const layout =
      PTD_getOpenDayLayout_(
        sheet
      );

    if(!layout.dateKey){
      throw new Error(
        "TEAM_DATA_OPEN_DAY_NOT_FOUND"
      );
    }

    if(
      layout.unexpectedRows.length
    ){
      throw new Error(
        "TEAM_DATA_COMPACTION_BLOCKED_UNEXPECTED_ROWS|" +
        layout.unexpectedRows.join(",")
      );
    }

    if(!layout.needsCompaction){

      Logger.log(
        "Team Data open day is already contiguous. Nothing to compact."
      );

      return {
        ok: true,
        moved: 0,
        state: PTD_buildPortalState_()
      };
    }

    const scanEnd =
      layout.scanEndRow;

    const height =
      Math.max(
        scanEnd -
          layout.headerRow,
        0
      );

    const allValues =
      height > 0
        ? sheet
            .getRange(
              layout.headerRow + 1,
              1,
              height,
              5
            )
            .getValues()
        : [];

    const records = [];
    const oldRows = [];

    allValues.forEach(
      function(row,index){

        if(
          String(
            row[1] || ""
          ).trim()
        ){

          records.push([
            "",
            row[1],
            row[2],
            row[3] || "In Progress",
            row[4] || ""
          ]);

          oldRows.push(
            layout.headerRow +
            1 +
            index
          );

        }

      }
    );

    //--------------------------------------------------
    // Clear only contents; retain formatting/validation.
    //--------------------------------------------------

    if(height > 0){

      sheet
        .getRange(
          layout.headerRow + 1,
          1,
          height,
          5
        )
        .clearContent();

    }

    if(records.length){

      sheet
        .getRange(
          layout.headerRow + 1,
          1,
          records.length,
          5
        )
        .setValues(
          records
        );

      PTD_applyStatusValidation_(
        sheet,
        layout.headerRow + 1,
        records.length
      );

    }

    const rowMap = {};

    oldRows.forEach(
      function(oldRow,index){

        rowMap[
          String(oldRow)
        ] =
          layout.headerRow +
          1 +
          index;

      }
    );

    PTD_rewriteTeamRowReferences_(
      rowMap
    );

    SpreadsheetApp.flush();

    const result = {

      ok:
        true,

      openDateKey:
        layout.dateKey,

      openDateLabel:
        layout.dateLabel,

      moved:
        records.length,

      oldFirstRecordRow:
        layout.firstRecordRow,

      oldLastRecordRow:
        layout.lastRecordRow,

      newFirstRecordRow:
        records.length
          ? layout.headerRow + 1
          : 0,

      newLastRecordRow:
        records.length
          ? layout.headerRow +
            records.length
          : 0,

      message:
        "Current Team Data day compacted successfully. Run REC_refreshRecoveryEvidence() in the private backend next.",

      state:
        PTD_buildPortalState_()

    };

    Logger.log(
      "========== TEAM DATA COMPACTION COMPLETE =========="
    );

    Logger.log(
      JSON.stringify(
        result,
        null,
        2
      )
    );

    Logger.log(
      "==================================================="
    );

    return result;

  }
  finally{

    lock.releaseLock();

  }
}


/******************************************************
 * SHARED PRIVATE HELPER
 *
 * Used by PortalCallOperations.gs replacement too.
 ******************************************************/
function PTD_getOpenDayLayout_(
  sheet
){

  const scanEnd =
    Math.max(
      sheet.getLastRow(),
      1
    );

  const values =
    sheet
      .getRange(
        1,
        1,
        scanEnd,
        5
      )
      .getValues();

  let headerRow = 0;
  let dateKey = "";
  let dateValue = null;

  //--------------------------------------------------
  // Last valid date in Column A = current OPEN day.
  //--------------------------------------------------

  for(
    let i = 0;
    i < values.length;
    i++
  ){

    const key =
      PTD_teamDateKey_(
        values[i][0]
      );

    if(key){
      headerRow = i + 1;
      dateKey = key;
      dateValue = values[i][0];
    }

  }

  if(!headerRow){

    return {
      dateKey: "",
      dateLabel: "",
      headerRow: 0,
      recordCount: 0,
      firstRecordRow: 0,
      lastRecordRow: 0,
      nextWriteRow: 0,
      gapRows: 0,
      needsCompaction: false,
      unexpectedRows: [],
      recordRows: [],
      scanEndRow: scanEnd
    };

  }

  const recordRows = [];
  const unexpectedRows = [];

  for(
    let row = headerRow + 1;
    row <= scanEnd;
    row++
  ){

    const data =
      values[row - 1];

    const a =
      String(
        data[0] || ""
      ).trim();

    const b =
      String(
        data[1] || ""
      ).trim();

    const c =
      String(
        data[2] || ""
      ).trim();

    const d =
      String(
        data[3] || ""
      ).trim();

    const e =
      String(
        data[4] || ""
      ).trim();

    if(b){
      recordRows.push(row);
      continue;
    }

    //--------------------------------------------------
    // Blank B rows containing only the historical
    // pre-filled "In Progress" in D are safe phantom
    // rows and may be cleared during compaction.
    //--------------------------------------------------

    const harmlessPrefill =
      !a &&
      !b &&
      !c &&
      !e &&
      (
        !d ||
        d.toLowerCase() ===
          "in progress"
      );

    if(!harmlessPrefill){
      unexpectedRows.push(row);
    }

  }

  const recordCount =
    recordRows.length;

  const firstRecordRow =
    recordCount
      ? recordRows[0]
      : 0;

  const lastRecordRow =
    recordCount
      ? recordRows[
          recordCount - 1
        ]
      : 0;

  const expectedLastRecordRow =
    recordCount
      ? headerRow +
        recordCount
      : headerRow;

  const gapRows =
    recordCount
      ? Math.max(
          lastRecordRow -
            expectedLastRecordRow,
          0
        )
      : 0;

  const needsCompaction =
    gapRows > 0;

  const dateObj =
    PTD_dateFromKey_(
      dateKey
    );

  return {

    dateKey:
      dateKey,

    dateLabel:
      PTD_dateLabel_(
        dateObj
      ),

    headerRow:
      headerRow,

    recordCount:
      recordCount,

    firstRecordRow:
      firstRecordRow,

    lastRecordRow:
      lastRecordRow,

    nextWriteRow:
      headerRow +
      recordCount +
      1,

    gapRows:
      gapRows,

    needsCompaction:
      needsCompaction,

    unexpectedRows:
      unexpectedRows,

    recordRows:
      recordRows,

    scanEndRow:
      scanEnd,

    rawDateValue:
      dateValue

  };
}


/******************************************************
 * PRIVATE: BUILD PORTAL STATE
 ******************************************************/
function PTD_buildPortalState_(){

  const sheet =
    PTD_teamSheet_();

  const layout =
    PTD_getOpenDayLayout_(
      sheet
    );

  if(!layout.dateKey){

    return {
      ok: false,
      openDateKey: "",
      openDateLabel: "No Team Data date header found",
      canComplete: false,
      blockReason: "TEAM_DATA_OPEN_DAY_NOT_FOUND"
    };

  }

  const pending =
    PTD_pendingCounts_(
      layout.dateKey
    );

  const next =
    PTD_nextBusinessDate_(
      layout.dateKey
    );

  let blockReason = "";

  if(layout.needsCompaction){

    blockReason =
      "Current Team Data day has " +
      layout.gapRows +
      " blank row(s) inside its active record block. Run the one-time compaction first.";

  }else if(
    layout.unexpectedRows.length
  ){

    blockReason =
      "Unexpected data exists in blank Team Data rows: " +
      layout.unexpectedRows
        .slice(0,10)
        .join(", ");

  }else if(
    pending.outcomes > 0 ||
    pending.reassignments > 0
  ){

    blockReason =
      "Resolve pending approvals first: " +
      pending.outcomes +
      " outcome(s), " +
      pending.reassignments +
      " reassignment(s).";

  }

  return {

    ok:
      true,

    openDateKey:
      layout.dateKey,

    openDateLabel:
      layout.dateLabel,

    headerRow:
      layout.headerRow,

    recordCount:
      layout.recordCount,

    firstRecordRow:
      layout.firstRecordRow,

    lastRecordRow:
      layout.lastRecordRow,

    nextWriteRow:
      layout.nextWriteRow,

    gapRows:
      layout.gapRows,

    needsCompaction:
      layout.needsCompaction,

    unexpectedRows:
      layout.unexpectedRows,

    pendingOutcomes:
      pending.outcomes,

    pendingReassignments:
      pending.reassignments,

    nextDateKey:
      next.key,

    nextDateLabel:
      next.label,

    canComplete:
      !blockReason,

    blockReason:
      blockReason

  };
}


/******************************************************
 * PRIVATE: CURRENT-DATE PENDING COUNTS
 ******************************************************/
function PTD_pendingCounts_(
  dateKey
){

  let outcomes = 0;
  let reassignments = 0;

  if(
    typeof PCO_loadOutcomeRequests_ ===
    "function"
  ){

    outcomes =
      PCO_loadOutcomeRequests_()
        .filter(
          function(item){
            return (
              item.statusKey ===
                "pending" &&
              item.dateKey ===
                dateKey
            );
          }
        )
        .length;

  }

  if(
    typeof PCO_loadReassignmentRequests_ ===
    "function"
  ){

    reassignments =
      PCO_loadReassignmentRequests_()
        .filter(
          function(item){
            return (
              item.statusKey ===
                "pending" &&
              item.dateKey ===
                dateKey
            );
          }
        )
        .length;

  }

  return {
    outcomes:
      outcomes,
    reassignments:
      reassignments
  };
}


/******************************************************
 * PRIVATE: TEAM SHEET
 ******************************************************/
function PTD_teamSheet_(){

  const ss =
    portalOperations_();

  const sheet =
    ss.getSheetByName(
      PTR_teamDataSheetName_()
    );

  if(!sheet){
    throw new Error(
      "TEAM_DATA_SHEET_NOT_FOUND"
    );
  }

  return sheet;
}


/******************************************************
 * PRIVATE: NEXT BUSINESS DAY
 ******************************************************/
function PTD_nextBusinessDate_(
  currentKey
){

  const current =
    PTD_dateFromKey_(
      currentKey
    );

  const next =
    new Date(
      current.getFullYear(),
      current.getMonth(),
      current.getDate() + 1
    );

  // Saturday -> Monday
  if(next.getDay() === 6){
    next.setDate(
      next.getDate() + 2
    );
  }

  // Sunday -> Monday
  if(next.getDay() === 0){
    next.setDate(
      next.getDate() + 1
    );
  }

  return {
    date:
      next,
    key:
      PTD_keyFromDate_(
        next
      ),
    label:
      PTD_dateLabel_(
        next
      )
  };
}


function PTD_dateLabel_(
  date
){

  return Utilities.formatDate(
    date,
    PTD_timeZone_(),
    "M/d/yyyy EEEE"
  );
}


function PTD_keyFromDate_(
  date
){

  return Utilities.formatDate(
    date,
    PTD_timeZone_(),
    "yyyy-MM-dd"
  );
}


function PTD_dateFromKey_(
  key
){

  const m =
    String(
      key || ""
    )
      .match(
        /^(\d{4})-(\d{2})-(\d{2})$/
      );

  if(!m){
    throw new Error(
      "INVALID_DATE_KEY"
    );
  }

  // Noon avoids date drift when the Apps Script project
  // timezone and spreadsheet timezone are different.
  return new Date(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    12,
    0,
    0
  );
}


function PTD_normalizeDateKey_(
  value
){

  if(
    value instanceof Date &&
    !isNaN(
      value.getTime()
    )
  ){
    return PTD_keyFromDate_(
      value
    );
  }

  const text =
    String(
      value || ""
    ).trim();

  if(!text){
    return "";
  }

  let m =
    text.match(
      /^(\d{4})-(\d{1,2})-(\d{1,2})/
    );

  if(m){
    return (
      m[1] +
      "-" +
      ("0" + m[2]).slice(-2) +
      "-" +
      ("0" + m[3]).slice(-2)
    );
  }

  m =
    text.match(
      /^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/
    );

  if(m){
    return (
      m[3] +
      "-" +
      ("0" + m[1]).slice(-2) +
      "-" +
      ("0" + m[2]).slice(-2)
    );
  }

  return "";
}


function PTD_teamDateKey_(
  value
){

  return PTD_normalizeDateKey_(
    value
  );
}


function PTD_timeZone_(){

  try{

    const ss =
      portalOperations_();

    return (
      ss.getSpreadsheetTimeZone() ||
      "Asia/Kolkata"
    );

  }
  catch(error){
    return "Asia/Kolkata";
  }
}


/******************************************************
 * PRIVATE: ENSURE D STATUS VALIDATION
 ******************************************************/
function PTD_applyStatusValidation_(
  sheet,
  startRow,
  count
){

  if(count <= 0){
    return;
  }

  const rule =
    SpreadsheetApp
      .newDataValidation()
      .requireValueInList(
        PORTAL_TEAM_DAY.STATUS_VALUES,
        true
      )
      .setAllowInvalid(
        false
      )
      .build();

  sheet
    .getRange(
      startRow,
      4,
      count,
      1
    )
    .setDataValidation(
      rule
    );
}


/******************************************************
 * PRIVATE: REWRITE PRIVATE ROW REFERENCES AFTER
 * ONE-TIME COMPACTION
 ******************************************************/
function PTD_rewriteTeamRowReferences_(
  rowMap
){

  const backend =
    portalTeamBackend_();

  //--------------------------------------------------
  // Selection Requests -> Team Row
  //--------------------------------------------------

  const selection =
    backend.getSheetByName(
      PTR_controlSheetName_(PORTAL_CONFIG.SELECTION_REQUESTS_SHEET)
    );

  if(
    selection &&
    selection.getLastRow() > 1
  ){

    const values =
      selection
        .getDataRange()
        .getValues();

    const headers =
      PCO_headerMap_(
        values[0] || []
      );

    const col =
      headers["Team Row"];

    if(col !== undefined){

      for(
        let i = 1;
        i < values.length;
        i++
      ){

        const oldRow =
          Number(
            values[i][col] || 0
          );

        const mapped =
          rowMap[
            String(oldRow)
          ];

        if(mapped){
          selection
            .getRange(
              i + 1,
              col + 1
            )
            .setValue(
              mapped
            );
        }

      }

    }

  }

  //--------------------------------------------------
  // Call Sync Map -> Team Data Row
  //--------------------------------------------------

  const sync =
    backend.getSheetByName(
      PTR_controlSheetName_(PORTAL_CALL_OPS.SYNC_MAP_SHEET)
    );

  if(
    sync &&
    sync.getLastRow() > 1
  ){

    const values =
      sync
        .getDataRange()
        .getValues();

    const headers =
      PCO_headerMap_(
        values[0] || []
      );

    const col =
      headers["Team Data Row"];

    if(col !== undefined){

      for(
        let i = 1;
        i < values.length;
        i++
      ){

        const oldRow =
          Number(
            values[i][col] || 0
          );

        const mapped =
          rowMap[
            String(oldRow)
          ];

        if(mapped){
          sync
            .getRange(
              i + 1,
              col + 1
            )
            .setValue(
              mapped
            );
        }

      }

    }

  }
}
