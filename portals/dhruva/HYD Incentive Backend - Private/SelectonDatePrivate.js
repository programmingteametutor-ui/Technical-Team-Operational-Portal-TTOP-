/******************************************************
 * SELECTION CONFIRMED DATE - PRIVATE ENGINE VERSION
 * HYD live selection synchronization v11.5
 *
 * Shared HYD Team Data:
 * A Date
 * B Interview
 * C Handler
 * D In Progress / Selected
 * E Selection Confirmed Date
 *
 * Rules FROM INSTALLATION FORWARD:
 * - D -> Selected: stamp today's date in E only when E is blank.
 * - D -> anything other than Selected: clear E.
 * - If that Selected state already produced a PENDING private
 *   Selection incentive, changing D away from Selected removes
 *   that one exact pending incentive from the active private
 *   Incentive Tracker and writes an audit copy to
 *   "Selection Reversal Log".
 * - Approved/non-Pending incentive rows are NEVER auto-deleted.
 * - Existing historical Selected rows are NOT backfilled.
 ******************************************************/


/******************************************************
 * INSTALLABLE EDIT TRIGGER HANDLER
 *
 * Runs from HYD Incentive Backend - Private when a user
 * manually edits HYD Team Data Column D.
 ******************************************************/
function selectionDateSharedEdit(e){

  if(!e || !e.range)
    return;

  const sheet =
    e.range.getSheet();

  if(
    sheet.getParent().getId() !==
      INCENTIVE_PRIVATE_ROUTING.OPERATIONS_SPREADSHEET_ID ||
    sheet.getName() !== CONFIG.TEAM_SHEET
  ){
    return;
  }

  if(
    e.range.getColumn() !== 4 ||
    e.range.getNumRows() !== 1 ||
    e.range.getNumColumns() !== 1
  ){
    return;
  }

  const row =
    e.range.getRow();

  const interviewText =
    sheet.getRange(row,2).getValue();

  if(!interviewText)
    return;

  const status =
    String(
      e.range.getValue() || ""
    )
    .trim()
    .toLowerCase();

  const dateCell =
    sheet.getRange(row,5);

  //--------------------------------------------------
  // SELECTED -> stamp confirmation date from NOW on.
  // Existing historical rows are not touched unless
  // somebody actually edits Column D.
  //--------------------------------------------------
  if(status === "selected"){

    if(!dateCell.getValue()){
      dateCell
        .setValue(new Date())
        .setNumberFormat(
          "dd-mmm-yyyy"
        );
    }

    return;
  }

  //--------------------------------------------------
  // UNSELECT -> clear confirmation date and reverse
  // only the exact PENDING selection incentive generated
  // from that confirmation date.
  //--------------------------------------------------
  const selectionDate =
    dateCell.getValue();

  if(selectionDate){
    dateCell.clearContent();

    try{
      SD_reversePendingSelectionForTeamRow_(
        sheet,
        row,
        selectionDate,
        status
      );
    }catch(error){
      Logger.log(
        "Selection reversal skipped: " +
        String(
          error && error.message
            ? error.message
            : error
        )
      );
    }
  }
}


/******************************************************
 * SETUP INSTALLABLE TRIGGER - RUN ONCE AFTER REPLACE
 ******************************************************/
function setupSharedTeamSelectionTrigger(){

  const handler =
    "selectionDateSharedEdit";

  ScriptApp.getProjectTriggers()
    .forEach(
      function(trigger){
        if(
          trigger.getHandlerFunction() ===
          handler
        ){
          ScriptApp.deleteTrigger(
            trigger
          );
        }
      }
    );

  ScriptApp
    .newTrigger(handler)
    .forSpreadsheet(
      INCENTIVE_PRIVATE_ROUTING
        .OPERATIONS_SPREADSHEET_ID
    )
    .onEdit()
    .create();

  Logger.log(
    "Shared Team Data Selection Confirmed Date trigger installed."
  );
}


/******************************************************
 * FUTURE-EDIT REVERSAL
 *
 * Deletes only ONE exact PENDING Selection tracker row.
 * If no row or more than one exact row is found, it fails
 * closed and leaves the tracker untouched.
 ******************************************************/
function SD_reversePendingSelectionForTeamRow_(
  teamSheet,
  teamRow,
  selectionDate,
  newStatus
){

  const sourceText =
    String(
      teamSheet
        .getRange(teamRow,2)
        .getDisplayValue() || ""
    ).trim();

  const handler =
    String(
      teamSheet
        .getRange(teamRow,3)
        .getDisplayValue() || ""
    ).trim();

  if(!sourceText || !handler || !selectionDate){
    return {
      ok: true,
      removed: 0,
      reason: "SOURCE_IDENTITY_INCOMPLETE"
    };
  }

  let parsed = null;

  if(
    typeof parseSelectedTeamInterviewFallback_ ===
      "function"
  ){
    try{
      parsed =
        parseSelectedTeamInterviewFallback_(
          sourceText
        );
    }catch(error){
      parsed = null;
    }
  }

  if(
    !parsed &&
    typeof parseInterview ===
      "function"
  ){
    try{
      parsed =
        parseInterview(
          sourceText
        );
    }catch(error){
      parsed = null;
    }
  }

  if(
    !parsed ||
    !parsed.candidate ||
    !parsed.client
  ){
    return {
      ok: true,
      removed: 0,
      reason: "INTERVIEW_IDENTITY_NOT_PARSED"
    };
  }

  const amount =
    (
      typeof INCENTIVES !== "undefined" &&
      INCENTIVES &&
      Number(INCENTIVES.SELECTED)
    )
      ? Number(INCENTIVES.SELECTED)
      : 2000;

  const targetRow = [
    "Selection",
    parsed.candidate,
    parsed.client,
    "-",
    "Selected",
    "",
    selectionDate,
    handler,
    amount,
    "Pending"
  ];

  const targetKey =
    SD_privateSelectionKey_(
      targetRow
    );

  const targetDateKey =
    PB_normalizeDate(
      selectionDate
    );

  const tracker =
    getPrivateTrackerSheet();

  if(tracker.getLastRow() <= 1){
    return {
      ok: true,
      removed: 0,
      reason: "TRACKER_EMPTY"
    };
  }

  const values =
    tracker
      .getRange(
        2,
        1,
        tracker.getLastRow()-1,
        10
      )
      .getValues();

  const matches = [];

  values.forEach(
    function(row,index){

      if(
        PB_normalizeText(row[0]) !==
          "selection" ||
        PB_normalizeText(row[9]) !==
          "pending"
      ){
        return;
      }

      if(
        SD_privateSelectionKey_(row) !==
          targetKey
      ){
        return;
      }

      if(
        targetDateKey &&
        PB_normalizeDate(row[6]) !==
          targetDateKey
      ){
        return;
      }

      matches.push({
        sheetRow: index + 2,
        values: row
      });
    }
  );

  if(matches.length !== 1){
    Logger.log(
      "Selection reversal not applied. Expected one exact pending row, found " +
      matches.length +
      ". Candidate=" +
      parsed.candidate +
      " | Client=" +
      parsed.client +
      " | Handler=" +
      handler +
      " | Date=" +
      targetDateKey
    );

    return {
      ok: true,
      removed: 0,
      matches: matches.length,
      reason:
        matches.length === 0
          ? "NO_EXACT_PENDING_SELECTION"
          : "AMBIGUOUS_PENDING_SELECTION"
    };
  }

  SD_appendSelectionReversalAudit_(
    matches[0].values,
    {
      sourceTeamRow: teamRow,
      sourceText: sourceText,
      newStatus: newStatus,
      reason:
        "Team Data status changed away from Selected"
    }
  );

  tracker.deleteRow(
    matches[0].sheetRow
  );

  Logger.log(
    "Pending Selection incentive reversed for Team Data row " +
    teamRow +
    ": " +
    parsed.candidate +
    " / " +
    parsed.client +
    " / " +
    handler
  );

  return {
    ok: true,
    removed: 1,
    candidate: parsed.candidate,
    client: parsed.client,
    handler: handler,
    selectionDate: targetDateKey
  };
}


/******************************************************
 * PRIVATE AUDIT FOR REMOVED PENDING SELECTIONS
 ******************************************************/
function SD_appendSelectionReversalAudit_(
  trackerRow,
  context
){

  const ss =
    getPrivateIncentiveSpreadsheet();

  let sheet =
    ss.getSheetByName(
      "Selection Reversal Log"
    );

  if(!sheet){
    sheet =
      ss.insertSheet(
        "Selection Reversal Log"
      );

    sheet
      .getRange(1,1,1,16)
      .setValues([[
        "Reversed At",
        "Incentive Type",
        "Candidate",
        "Client",
        "From",
        "To",
        "Previous Date",
        "Promotion Date",
        "Handler",
        "Amount",
        "Original Status",
        "Team Row",
        "New Team Status",
        "Reason",
        "Source Interview",
        "Mode"
      ]]);

    sheet.setFrozenRows(1);
  }

  const info =
    context || {};

  sheet.appendRow([
    new Date(),
    trackerRow[0],
    trackerRow[1],
    trackerRow[2],
    trackerRow[3],
    trackerRow[4],
    trackerRow[5],
    trackerRow[6],
    trackerRow[7],
    trackerRow[8],
    trackerRow[9],
    Number(info.sourceTeamRow || 0),
    String(info.newStatus || ""),
    String(info.reason || ""),
    String(info.sourceText || ""),
    "AUTO_FUTURE_EDIT_REVERSAL"
  ]);
}


/******************************************************
 * ONE-TIME CLEANUP FOR THE CURRENT TEST RECORD ONLY
 *
 * User-confirmed false test selection visible in portal:
 * 03-Aug-2026 | Uday | Kiran Biradar | Kascade | ₹2,000
 *
 * This function deletes only that exact PENDING Selection
 * row after writing it to Selection Reversal Log.
 * It does NOT touch any other historical selection.
 ******************************************************/
function HYD_removeUdayKiranKascadeTestSelection(){

  const tracker =
    getPrivateTrackerSheet();

  if(tracker.getLastRow() <= 1){
    throw new Error(
      "HYD_TEST_SELECTION_NOT_FOUND"
    );
  }

  const values =
    tracker
      .getRange(
        2,
        1,
        tracker.getLastRow()-1,
        10
      )
      .getValues();

  const targetDate =
    "2026-08-03";

  const matches = [];

  values.forEach(
    function(row,index){

      if(
        PB_normalizeText(row[0]) !== "selection" ||
        PB_normalizeIdentity(row[1]) !==
          PB_normalizeIdentity("Kiran Biradar") ||
        PB_normalizeIdentity(row[2]) !==
          PB_normalizeIdentity("Kascade") ||
        PB_normalizeText(row[7]) !==
          PB_normalizeText("Uday") ||
        PB_normalizeAmount(row[8]) !==
          PB_normalizeAmount(2000) ||
        PB_normalizeText(row[9]) !==
          "pending" ||
        PB_normalizeDate(row[6]) !==
          targetDate
      ){
        return;
      }

      matches.push({
        sheetRow: index + 2,
        values: row
      });
    }
  );

  if(matches.length !== 1){
    throw new Error(
      "HYD_TEST_SELECTION_EXPECTED_ONE_MATCH_FOUND_" +
      matches.length
    );
  }

  SD_appendSelectionReversalAudit_(
    matches[0].values,
    {
      sourceTeamRow: 0,
      newStatus: "In Progress",
      reason:
        "One-time cleanup of confirmed test selection",
      sourceText:
        "Kiran Biradar / Kascade / Uday"
    }
  );

  tracker.deleteRow(
    matches[0].sheetRow
  );

  const result = {
    ok: true,
    removed: 1,
    candidate: "Kiran Biradar",
    client: "Kascade",
    handler: "Uday",
    promotionDate: targetDate,
    amount: 2000,
    status: "Pending"
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


/******************************************************
 * CORRECT EXISTING PRIVATE SELECTION EARNING DATES
 *
 * Promotion date intentionally excluded from identity
 * because this helper exists to correct that date.
 ******************************************************/
function syncSelectionDatesToPrivateBackend(
  records
){

  if(
    !Array.isArray(records) ||
    records.length === 0
  ){
    return 0;
  }

  const incoming = {};

  records.forEach(
    function(row){

      if(
        !Array.isArray(row) ||
        row.length < 10 ||
        PB_normalizeText(row[0]) !==
          "selection"
      ){
        return;
      }

      const key =
        SD_privateSelectionKey_(
          row
        );

      if(key && row[6]){
        incoming[key] = row[6];
      }
    }
  );

  const tracker =
    getPrivateTrackerSheet();

  if(tracker.getLastRow() <= 1)
    return 0;

  const existing =
    tracker
      .getRange(
        2,
        1,
        tracker.getLastRow()-1,
        10
      )
      .getValues();

  let updated = 0;

  existing.forEach(
    function(row,index){

      if(
        PB_normalizeText(row[0]) !==
        "selection"
      ){
        return;
      }

      const key =
        SD_privateSelectionKey_(row);

      const correctDate =
        incoming[key];

      if(!correctDate)
        return;

      const currentDateKey =
        PB_normalizeDate(row[6]);

      const correctDateKey =
        PB_normalizeDate(correctDate);

      if(
        !correctDateKey ||
        currentDateKey === correctDateKey
      ){
        return;
      }

      tracker
        .getRange(
          index+2,
          7
        )
        .setValue(
          correctDate
        );

      updated++;
    }
  );

  Logger.log(
    "Selection earning dates corrected: " +
    updated
  );

  return updated;
}


function SD_privateSelectionKey_(row){

  if(
    !Array.isArray(row) ||
    row.length < 10 ||
    PB_normalizeText(row[0]) !==
      "selection"
  ){
    return "";
  }

  return [
    PB_normalizeText(row[0]),
    PB_normalizeIdentity(row[1]),
    PB_normalizeIdentity(row[2]),
    PB_normalizeText(row[3]),
    PB_normalizeText(row[4]),
    PB_normalizeText(row[7]),
    PB_normalizeAmount(row[8])
  ].join("||");
}
