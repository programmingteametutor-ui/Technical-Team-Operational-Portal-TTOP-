/******************************************************
 * SELECTIONDATE.GS
 *
 * Selection incentive:
 * - Handler comes from final Team Data interview
 * - Earning date comes from Selection Confirmed Date
 *
 * Team Data:
 * A Date
 * B Interview
 * C Handler
 * D Status
 * E Selection Confirmed Date
 ******************************************************/


/******************************************************
 * AUTO-STAMP SELECTION CONFIRMED DATE
 *
 * Manual Team Data edit:
 *
 * D -> Selected
 * E -> today's date
 *
 * Selected -> In Progress
 * E -> cleared
 ******************************************************/
function onEdit(e){

  if(
    !e ||
    !e.range
  ){
    return;
  }


  const sheet =
    e.range.getSheet();


  if(
    sheet.getName() !==
    CONFIG.TEAM_SHEET
  ){
    return;
  }


  //--------------------------------------------------
  // Only Team Data Column D
  //--------------------------------------------------

  if(
    e.range.getColumn() !== 4 ||
    e.range.getNumRows() !== 1 ||
    e.range.getNumColumns() !== 1
  ){
    return;
  }


  const row =
    e.range.getRow();


  //--------------------------------------------------
  // Ignore date-header / empty interview rows
  //--------------------------------------------------

  const interviewText =
    sheet
      .getRange(
        row,
        2
      )
      .getValue();


  if(!interviewText){
    return;
  }


  const status =
    String(
      e.range.getValue() || ""
    )
    .trim()
    .toLowerCase();


  const selectionDateCell =
    sheet.getRange(
      row,
      5
    );


  //--------------------------------------------------
  // Selected -> stamp date only if currently blank
  //--------------------------------------------------

  if(status === "selected"){

    if(
      !selectionDateCell.getValue()
    ){

      selectionDateCell
        .setValue(
          new Date()
        )
        .setNumberFormat(
          "dd-mmm-yyyy"
        );

    }

    return;
  }


  //--------------------------------------------------
  // Reopened / no longer Selected -> clear date
  //--------------------------------------------------

  if(
    selectionDateCell.getValue()
  ){

    selectionDateCell
      .clearContent();

  }

}


/******************************************************
 * SYNCHRONIZE CHANGED SELECTION DATES TO
 * PRIVATE PERMANENT INCENTIVE TRACKER
 *
 * IMPORTANT:
 * This runs BEFORE normal backend append.
 *
 * Example:
 *
 * Existing permanent record:
 * Bharat | Selection | 26-Jul
 *
 * New correct scan:
 * Bharat | Selection | 11-Aug
 *
 * This updates the existing permanent record to
 * 11-Aug BEFORE duplicate checking, preventing a
 * second ₹2,000 incentive from being created.
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


  const selections =
    records.filter(
      function(row){

        return (
          Array.isArray(row) &&
          row.length >= 10 &&
          PB_normalizeText(
            row[0]
          ) === "selection"
        );

      }
    );


  if(!selections.length){
    return 0;
  }


  const incoming = {};


  selections.forEach(
    function(row){

      const key =
        SD_buildSelectionIdentityKey_(
          row
        );


      if(
        key &&
        row[6]
      ){

        incoming[key] =
          row[6];

      }

    }
  );


  const tracker =
    getPrivateTrackerSheet();


  if(
    tracker.getLastRow() <= 1
  ){
    return 0;
  }


  const existing =
    tracker
      .getRange(
        2,
        1,
        tracker.getLastRow() - 1,
        10
      )
      .getValues();


  let updated = 0;


  existing.forEach(
    function(row,index){

      if(
        PB_normalizeText(
          row[0]
        ) !== "selection"
      ){
        return;
      }


      const key =
        SD_buildSelectionIdentityKey_(
          row
        );


      const correctDate =
        incoming[key];


      if(!correctDate){
        return;
      }


      const currentDateKey =
        PB_normalizeDate(
          row[6]
        );


      const correctDateKey =
        PB_normalizeDate(
          correctDate
        );


      if(
        !correctDateKey ||
        currentDateKey ===
          correctDateKey
      ){
        return;
      }


      //------------------------------------------------
      // Only update Promotion / Earning Date
      // Keep Pending / Approved / Paid status untouched
      //------------------------------------------------

      tracker
        .getRange(
          index + 2,
          7
        )
        .setValue(
          correctDate
        );


      updated++;

    }
  );


  Logger.log(
    "Selection earning dates corrected in Private Backend: " +
    updated
  );


  return updated;

}


/******************************************************
 * SELECTION IDENTITY
 *
 * Promotion date intentionally excluded here because
 * this helper exists specifically to CORRECT that date.
 ******************************************************/
function SD_buildSelectionIdentityKey_(
  row
){

  if(
    !Array.isArray(row) ||
    row.length < 10
  ){
    return "";
  }


  if(
    PB_normalizeText(
      row[0]
    ) !== "selection"
  ){
    return "";
  }


  return [

    PB_normalizeText(
      row[0]
    ),

    PB_normalizeIdentity(
      row[1]
    ),

    PB_normalizeIdentity(
      row[2]
    ),

    PB_normalizeText(
      row[3]
    ),

    PB_normalizeText(
      row[4]
    ),

    PB_normalizeText(
      row[7]
    ),

    PB_normalizeAmount(
      row[8]
    )

  ].join("||");

}
