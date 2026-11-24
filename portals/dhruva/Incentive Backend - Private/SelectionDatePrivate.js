/******************************************************
 * SELECTION CONFIRMED DATE - PRIVATE ENGINE VERSION
 *
 * Shared Team Data:
 * A Date
 * B Interview
 * C Handler
 * D In Progress / Selected
 * E Selection Confirmed Date
 ******************************************************/


/******************************************************
 * INSTALLABLE EDIT TRIGGER HANDLER
 *
 * Runs from the PRIVATE engine project when a user
 * manually edits Team Data Column D in the SHARED sheet.
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

  if(dateCell.getValue()){
    dateCell.clearContent();
  }
}


/******************************************************
 * SETUP INSTALLABLE TRIGGER - RUN ONCE
 ******************************************************/
function setupSharedTeamSelectionTrigger(){

  const handler =
    "selectionDateSharedEdit";

  //--------------------------------------------------
  // Remove only old trigger(s) for this same handler.
  //--------------------------------------------------

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
    row.length<10 ||
    PB_normalizeText(row[0])!=="selection"
  ){
    return "";
  }

  // Date is intentionally excluded because this helper exists to correct it.
  // From/To are also excluded so "Final -> Selected" and "- -> Selected"
  // can still resolve to the same existing Selection before duplicate checking.
  return [
    PB_normalizeText(row[0]),
    PB_normalizeIdentity(row[1]),
    PB_canonicalClient_(row[2]),
    PB_normalizeText(row[7]),
    PB_normalizeAmount(row[8])
  ].join("||");
}

