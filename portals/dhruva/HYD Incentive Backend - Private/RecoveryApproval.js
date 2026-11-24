/******************************************************
 * RECOVERY APPROVAL
 * Clean Rebuild - Version 1.0
 *
 * Purpose:
 * - Read rows manually marked "Approved" in
 *   Promotion Recovery.
 * - Convert them into the standard 10-column
 *   Incentive Tracker format.
 * - Write them permanently through
 *   appendIncentivesToPrivateBackend().
 * - Never apply the same Recovery ID twice.
 *
 * IMPORTANT:
 * Recovery approval confirms that the missed
 * promotion is legitimate.
 *
 * The private tracker Status is therefore created as
 * "Pending". Payment / final incentive status is a
 * separate workflow.
 ******************************************************/


/******************************************************
 * CONFIGURATION
 ******************************************************/

const RECOVERY_APPROVAL_CONFIG = {

  RECOVERY_SHEET:
    "Promotion Recovery",

  APPLIED_LOG_SHEET:
    "Recovery Applied Log"

};


/******************************************************
 * APPLY APPROVED RECOVERIES
 *
 * Existing Engine.gs menu already calls this function.
 ******************************************************/

function applyApprovedRecoveries(){

  //--------------------------------------------------
  // Required backend functions
  //--------------------------------------------------

  if(
    typeof appendIncentivesToPrivateBackend !== "function" ||
    typeof getPrivateTrackerSheet !== "function" ||
    typeof PB_buildTrackerKey !== "function"
  ){

    throw new Error(
      "PrivateBackend.gs is missing or incomplete. " +
      "Recovery approval cannot continue."
    );

  }


  const ss =
    IR_backend_();

  const recoverySheet =
    ss.getSheetByName(
      RECOVERY_APPROVAL_CONFIG.RECOVERY_SHEET
    );


  if(!recoverySheet){

    throw new Error(
      "Promotion Recovery sheet was not found."
    );

  }


  const lastRow =
    recoverySheet.getLastRow();

  const lastColumn =
    recoverySheet.getLastColumn();


  if(lastRow <= 1){

    SpreadsheetApp.getUi().alert(
      "No recovery records are available."
    );

    return;

  }


  //--------------------------------------------------
  // Read recovery data
  //--------------------------------------------------

  const values =
    recoverySheet
      .getRange(
        1,
        1,
        lastRow,
        lastColumn
      )
      .getValues();


  const headers =
    values[0].map(function(value){

      return String(value || "").trim();

    });


  const cols =
    RA_getRecoveryColumns(headers);


  //--------------------------------------------------
  // Existing applied Recovery IDs
  //--------------------------------------------------

  const appliedLog =
    RA_getAppliedLogSheet();

  const appliedIds =
    RA_loadAppliedRecoveryIds(
      appliedLog
    );


  //--------------------------------------------------
  // Find rows manually marked Approved
  //--------------------------------------------------

  const approvedItems = [];

  let approvedTotal = 0;
  let alreadyApplied = 0;
  let invalidApproved = 0;


  for(
    let i = 1;
    i < values.length;
    i++
  ){

    const row =
      values[i];


    const status =
      String(
        row[cols.status] || ""
      )
      .trim()
      .toLowerCase();


    if(status !== "approved")
      continue;


    approvedTotal++;


    const recoveryId =
      String(
        row[cols.recoveryId] || ""
      ).trim();


    //------------------------------------------------
    // Already permanently applied
    //------------------------------------------------

    if(
      recoveryId &&
      appliedIds[recoveryId]
    ){

      alreadyApplied++;
      continue;

    }


    //------------------------------------------------
    // Convert Recovery row -> Tracker row
    //------------------------------------------------

    const trackerRow =
      RA_buildTrackerRow(
        row,
        cols
      );


    if(!trackerRow){

      invalidApproved++;

      Logger.log(
        "Invalid approved recovery skipped at row " +
        (i + 1)
      );

      continue;

    }


    const trackerKey =
      PB_buildTrackerKey(
        trackerRow
      );


    if(!trackerKey){

      invalidApproved++;

      Logger.log(
        "Approved recovery produced no tracker key at row " +
        (i + 1)
      );

      continue;

    }


    approvedItems.push({

      sheetRow:
        i + 1,

      recoveryId:
        recoveryId,

      candidate:
        String(
          row[cols.candidate] || ""
        ).trim(),

      client:
        String(
          row[cols.teamClient] || ""
        ).trim(),

      fromRound:
        String(
          row[cols.previousRound] || ""
        ).trim(),

      toRound:
        String(
          row[cols.currentRound] || ""
        ).trim(),

      handler:
        String(
          row[cols.handler] || ""
        ).trim(),

      amount:
        RA_parseAmount(
          row[cols.amount]
        ),

      trackerRow:
        trackerRow,

      trackerKey:
        trackerKey

    });

  }


  //--------------------------------------------------
  // Nothing approved
  //--------------------------------------------------

  if(approvedTotal === 0){

    SpreadsheetApp.getUi().alert(

      "Apply Approved Recoveries",

      "No rows are marked Approved in Promotion Recovery.",

      SpreadsheetApp.getUi().ButtonSet.OK

    );

    return;

  }


  //--------------------------------------------------
  // Nothing left to apply
  //--------------------------------------------------

  if(approvedItems.length === 0){

    SpreadsheetApp.getUi().alert(

      "Apply Approved Recoveries",

      "Approved rows found: " +
      approvedTotal +
      "\n\nAlready applied: " +
      alreadyApplied +
      "\nInvalid approved rows: " +
      invalidApproved +
      "\n\nNothing new needs to be written.",

      SpreadsheetApp.getUi().ButtonSet.OK

    );

    return;

  }


  //--------------------------------------------------
  // User confirmation
  //--------------------------------------------------

  const ui =
    SpreadsheetApp.getUi();


  const response =
    ui.alert(

      "Apply Approved Recoveries",

      "Approved rows found: " +
      approvedTotal +
      "\n\nNew approved rows ready to process: " +
      approvedItems.length +
      "\nAlready applied previously: " +
      alreadyApplied +
      "\nInvalid approved rows: " +
      invalidApproved +
      "\n\nContinue writing approved recoveries " +
      "to the private Incentive Tracker?",

      ui.ButtonSet.YES_NO

    );


  if(response !== ui.Button.YES){

    Logger.log(
      "Recovery approval cancelled by user."
    );

    return;

  }


  Logger.log(
    "========== RECOVERY APPROVAL START =========="
  );


  //--------------------------------------------------
  // Existing private backend index
  //--------------------------------------------------

  const backendBefore =
    RA_buildPrivateBackendIndex();


  //--------------------------------------------------
  // Deduplicate approved items by permanent key
  //--------------------------------------------------

  const batchSeen = {};

  const rowsToWrite = [];

  const uniqueNewItems = [];

  let alreadyInBackendBefore = 0;
  let duplicateApprovedRows = 0;


  approvedItems.forEach(function(item){

    //------------------------------------------------
    // Incentive already exists permanently
    //------------------------------------------------

    if(
      backendBefore[
        item.trackerKey
      ]
    ){

      alreadyInBackendBefore++;
      return;

    }


    //------------------------------------------------
    // Two Recovery IDs represent same incentive
    //------------------------------------------------

    if(
      batchSeen[
        item.trackerKey
      ]
    ){

      duplicateApprovedRows++;
      return;

    }


    batchSeen[
      item.trackerKey
    ] = true;


    rowsToWrite.push(
      item.trackerRow
    );


    uniqueNewItems.push(
      item
    );

  });


  //--------------------------------------------------
  // Write genuinely new permanent records
  //--------------------------------------------------

  let backendAdded = 0;


  if(rowsToWrite.length > 0){

    backendAdded =
      appendIncentivesToPrivateBackend(
        rowsToWrite
      );

  }


  //--------------------------------------------------
  // Re-read backend.
  //
  // We only log a Recovery ID as applied if the
  // corresponding permanent tracker record now
  // actually exists.
  //--------------------------------------------------

  const backendAfter =
    RA_buildPrivateBackendIndex();


  const logRows = [];

  let confirmedApplied = 0;
  let failedToConfirm = 0;


  approvedItems.forEach(function(item){

    const exists =
      Boolean(
        backendAfter[
          item.trackerKey
        ]
      );


    if(!exists){

      failedToConfirm++;

      Logger.log(
        "Could not confirm backend record for Recovery ID: " +
        item.recoveryId
      );

      return;

    }


    //------------------------------------------------
    // Do not duplicate Applied Log entries
    //------------------------------------------------

    if(
      item.recoveryId &&
      appliedIds[
        item.recoveryId
      ]
    ){

      return;

    }


    let result =
      "Added";


    if(
      backendBefore[
        item.trackerKey
      ]
    ){

      result =
        "Already in Backend";

    }else if(
      !batchSeen[
        item.trackerKey
      ]
    ){

      result =
        "Already Represented";

    }


    logRows.push([

      item.recoveryId,

      new Date(),

      result,

      item.candidate,

      item.client,

      item.fromRound,

      item.toRound,

      item.handler,

      item.amount

    ]);


    if(item.recoveryId){

      appliedIds[
        item.recoveryId
      ] = true;

    }


    confirmedApplied++;

  });


  //--------------------------------------------------
  // Write persistent applied log
  //--------------------------------------------------

  if(logRows.length > 0){

    const startRow =
      Math.max(
        appliedLog.getLastRow() + 1,
        2
      );


    appliedLog
      .getRange(
        startRow,
        1,
        logRows.length,
        logRows[0].length
      )
      .setValues(
        logRows
      );


    appliedLog
      .getRange(
        startRow,
        2,
        logRows.length,
        1
      )
      .setNumberFormat(
        "dd-MMM-yyyy hh:mm AM/PM"
      );


    appliedLog
      .getRange(
        startRow,
        9,
        logRows.length,
        1
      )
      .setNumberFormat(
        "₹#,##0"
      );

  }


  //--------------------------------------------------
  // Logs
  //--------------------------------------------------

  Logger.log(
    "Approved Rows : " +
    approvedTotal
  );

  Logger.log(
    "Already Applied by Recovery ID : " +
    alreadyApplied
  );

  Logger.log(
    "Already in Private Backend : " +
    alreadyInBackendBefore
  );

  Logger.log(
    "Duplicate Approved Recovery Rows : " +
    duplicateApprovedRows
  );

  Logger.log(
    "Backend Records Requested : " +
    rowsToWrite.length
  );

  Logger.log(
    "Backend Records Added : " +
    backendAdded
  );

  Logger.log(
    "Confirmed Applied Recoveries : " +
    confirmedApplied
  );

  Logger.log(
    "Invalid Approved Rows : " +
    invalidApproved
  );

  Logger.log(
    "Failed Backend Confirmation : " +
    failedToConfirm
  );

  Logger.log(
    "========== RECOVERY APPROVAL COMPLETE =========="
  );


  //--------------------------------------------------
  // User summary
  //--------------------------------------------------

  ui.alert(

    "Recovery Approval Complete",

    "Approved rows: " +
    approvedTotal +
    "\n\nBackend records added now: " +
    backendAdded +
    "\nAlready applied previously: " +
    alreadyApplied +
    "\nAlready present in backend: " +
    alreadyInBackendBefore +
    "\nConfirmed applied: " +
    confirmedApplied +
    "\nInvalid / failed: " +
    (
      invalidApproved +
      failedToConfirm
    ),

    ui.ButtonSet.OK

  );

}


/******************************************************
 * BUILD STANDARD PRIVATE TRACKER ROW
 *
 * Promotion Recovery:
 *
 * Candidate          -> Candidate
 * Team Client        -> Client
 * Previous Round     -> From
 * Current Round      -> To
 * Team Date          -> Previous Date
 * Promotion Date     -> Promotion Date
 * Suggested Handler  -> Handler
 * Amount             -> Amount
 *
 * New permanent Status = Pending
 ******************************************************/

function RA_buildTrackerRow(
  row,
  cols
){

  const candidate =
    String(
      row[cols.candidate] || ""
    ).trim();


  const client =
    String(
      row[cols.teamClient] || ""
    ).trim();


  const fromRound =
    String(
      row[cols.previousRound] || ""
    ).trim();


  const toRound =
    String(
      row[cols.currentRound] || ""
    ).trim();


  const previousDate =
    row[cols.teamDate];


  const promotionDate =
    row[cols.promotionDate];


  const handler =
    String(
      row[cols.handler] || ""
    ).trim();


  const amount =
    RA_parseAmount(
      row[cols.amount]
    );


  //--------------------------------------------------
  // Required fields
  //--------------------------------------------------

  if(
    !candidate ||
    !client ||
    !fromRound ||
    !toRound ||
    !handler ||
    amount <= 0
  ){

    return null;

  }


  return [

    "Promotion",

    candidate,

    client,

    fromRound,

    toRound,

    previousDate,

    promotionDate,

    handler,

    amount,

    "Pending"

  ];

}


/******************************************************
 * GET REQUIRED RECOVERY COLUMNS
 ******************************************************/

function RA_getRecoveryColumns(
  headers
){

  const cols = {

    recoveryId:
      RA_findColumn(
        headers,
        "Recovery ID"
      ),

    candidate:
      RA_findColumn(
        headers,
        "Candidate"
      ),

    previousRound:
      RA_findColumn(
        headers,
        "Previous Round"
      ),

    currentRound:
      RA_findColumn(
        headers,
        "Current Round"
      ),

    teamClient:
      RA_findColumn(
        headers,
        "Team Client"
      ),

    teamDate:
      RA_findColumn(
        headers,
        "Team Date"
      ),

    promotionDate:
      RA_findColumn(
        headers,
        "Promotion Date"
      ),

    handler:
      RA_findColumn(
        headers,
        "Suggested Handler"
      ),

    amount:
      RA_findColumn(
        headers,
        "Amount"
      ),

    status:
      RA_findColumn(
        headers,
        "Status"
      )

  };


  Object.keys(cols).forEach(
    function(name){

      if(cols[name] === -1){

        throw new Error(
          "Promotion Recovery column not found: " +
          name
        );

      }

    }
  );


  return cols;

}


/******************************************************
 * FIND COLUMN
 ******************************************************/

function RA_findColumn(
  headers,
  expectedName
){

  const expected =
    String(
      expectedName || ""
    )
    .trim()
    .toLowerCase();


  for(
    let i = 0;
    i < headers.length;
    i++
  ){

    const current =
      String(
        headers[i] || ""
      )
      .trim()
      .toLowerCase();


    if(current === expected){

      return i;

    }

  }


  return -1;

}


/******************************************************
 * APPLIED LOG SHEET
 *
 * This sheet is permanent and is NOT cleared by
 * RecoveryEngine.gs.
 ******************************************************/

function RA_getAppliedLogSheet(){

  const ss =
    IR_backend_();

  let sheet =
    ss.getSheetByName(
      RECOVERY_APPROVAL_CONFIG.APPLIED_LOG_SHEET
    );


  if(!sheet){

    sheet =
      ss.insertSheet(
        RECOVERY_APPROVAL_CONFIG.APPLIED_LOG_SHEET
      );

  }


  if(sheet.getLastRow() === 0){

    sheet
      .getRange(
        1,
        1,
        1,
        9
      )
      .setValues([[
        "Recovery ID",
        "Applied Date",
        "Result",
        "Candidate",
        "Client",
        "From",
        "To",
        "Handler",
        "Amount"
      ]]);


    sheet
      .getRange(
        1,
        1,
        1,
        9
      )
      .setFontWeight(
        "bold"
      );


    sheet.setFrozenRows(1);

  }


  return sheet;

}


/******************************************************
 * LOAD APPLIED RECOVERY IDS
 ******************************************************/

function RA_loadAppliedRecoveryIds(
  sheet
){

  const output = {};


  const lastRow =
    sheet.getLastRow();


  if(lastRow <= 1){

    return output;

  }


  const values =
    sheet
      .getRange(
        2,
        1,
        lastRow - 1,
        1
      )
      .getValues();


  values.forEach(function(row){

    const id =
      String(
        row[0] || ""
      ).trim();


    if(id){

      output[id] = true;

    }

  });


  return output;

}


/******************************************************
 * BUILD PRIVATE BACKEND INDEX
 ******************************************************/

function RA_buildPrivateBackendIndex(){

  const tracker =
    getPrivateTrackerSheet();


  const lastRow =
    tracker.getLastRow();

  const lastColumn =
    tracker.getLastColumn();


  const index = {};


  if(lastRow <= 1){

    return index;

  }


  const rows =
    tracker
      .getRange(
        2,
        1,
        lastRow - 1,
        lastColumn
      )
      .getValues();


  rows.forEach(function(row){

    const key =
      PB_buildTrackerKey(
        row
      );


    if(key){

      index[key] = true;

    }

  });


  return index;

}


/******************************************************
 * PARSE AMOUNT
 ******************************************************/

function RA_parseAmount(value){

  if(
    value === null ||
    value === undefined ||
    value === ""
  ){

    return 0;

  }


  const text =
    String(value)
      .replace(/[₹,\s]/g,"")
      .trim();


  const amount =
    Number(text);


  return isNaN(amount)
    ? 0
    : amount;

}


/******************************************************
 * READ-ONLY TEST
 *
 * Run this BEFORE applying anything.
 ******************************************************/

function testRecoveryApprovalReadiness(){

  //--------------------------------------------------
  // Backend dependency check
  //--------------------------------------------------

  if(
    typeof appendIncentivesToPrivateBackend !== "function" ||
    typeof getPrivateTrackerSheet !== "function" ||
    typeof PB_buildTrackerKey !== "function"
  ){

    throw new Error(
      "PrivateBackend.gs is missing or incomplete."
    );

  }


  const ss =
    IR_backend_();


  const recoverySheet =
    ss.getSheetByName(
      RECOVERY_APPROVAL_CONFIG.RECOVERY_SHEET
    );


  if(!recoverySheet){

    throw new Error(
      "Promotion Recovery sheet was not found."
    );

  }


  const values =
    recoverySheet
      .getDataRange()
      .getValues();


  if(values.length <= 1){

    Logger.log(
      "Promotion Recovery contains no records."
    );

    return;

  }


  const headers =
    values[0].map(function(value){

      return String(value || "").trim();

    });


  const cols =
    RA_getRecoveryColumns(
      headers
    );


  let pending = 0;
  let approved = 0;
  let rejected = 0;
  let other = 0;


  for(
    let i = 1;
    i < values.length;
    i++
  ){

    const status =
      String(
        values[i][cols.status] || ""
      )
      .trim()
      .toLowerCase();


    if(status === "pending"){

      pending++;

    }else if(status === "approved"){

      approved++;

    }else if(status === "rejected"){

      rejected++;

    }else{

      other++;

    }

  }


  const appliedLog =
    RA_getAppliedLogSheet();


  const appliedIds =
    RA_loadAppliedRecoveryIds(
      appliedLog
    );


  const privateTracker =
    getPrivateTrackerSheet();


  Logger.log(
    "========== RECOVERY APPROVAL READINESS =========="
  );

  Logger.log(
    "Recovery Records : " +
    (
      values.length - 1
    )
  );

  Logger.log(
    "Pending : " +
    pending
  );

  Logger.log(
    "Approved : " +
    approved
  );

  Logger.log(
    "Rejected : " +
    rejected
  );

  Logger.log(
    "Other Status : " +
    other
  );

  Logger.log(
    "Previously Applied Recovery IDs : " +
    Object.keys(appliedIds).length
  );

  Logger.log(
    "Private Backend Records : " +
    Math.max(
      privateTracker.getLastRow() - 1,
      0
    )
  );

  Logger.log(
    "==============================================="
  );

}

