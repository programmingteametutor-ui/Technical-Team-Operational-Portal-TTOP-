/******************************************************
 * PRIVATE BACKEND
 * Clean Rebuild - Version 1.0
 *
 * Purpose:
 * - Keep permanent incentive storage independent
 *   from the dashboard / portal.
 * - Preserve the existing function used by the
 *   working Incentive Tracker:
 *
 *     appendIncentivesToPrivateBackend(records)
 *
 * IMPORTANT:
 * - No OAuth
 * - No portal access logic
 * - No doGet()
 * - No HTML/dashboard logic
 ******************************************************/


/******************************************************
 * CONFIGURATION
 ******************************************************/

const PRIVATE_BACKEND_CONFIG = {

  SPREADSHEET_ID:
    "1Q5pRPoLsSjfxuRfEUZW2zZqrURYPzzbbPO6_8r9CLCk",

  TRACKER_SHEET:
    "Incentive Tracker"

};


/******************************************************
 * GET PRIVATE SPREADSHEET
 ******************************************************/

function getPrivateIncentiveSpreadsheet(){

  const id =
    String(
      PRIVATE_BACKEND_CONFIG.SPREADSHEET_ID || ""
    ).trim();

  if(!id){

    throw new Error(
      "Private backend Spreadsheet ID is not configured."
    );

  }

  return SpreadsheetApp.openById(id);

}


/******************************************************
 * GET PRIVATE TRACKER SHEET
 ******************************************************/

function getPrivateTrackerSheet(){

  const ss =
    getPrivateIncentiveSpreadsheet();

  const sheet =
    ss.getSheetByName(
      PRIVATE_BACKEND_CONFIG.TRACKER_SHEET
    );

  if(!sheet){

    throw new Error(
      "Private backend sheet '" +
      PRIVATE_BACKEND_CONFIG.TRACKER_SHEET +
      "' was not found."
    );

  }

  return sheet;

}


/******************************************************
 * APPEND INCENTIVES TO PRIVATE BACKEND
 *
 * Expected tracker row structure:
 *
 * 0  Incentive Type
 * 1  Candidate
 * 2  Client
 * 3  From
 * 4  To
 * 5  Previous Date
 * 6  Promotion Date
 * 7  Handler
 * 8  Amount
 * 9  Status
 *
 * Returns:
 * Number of newly-added records.
 ******************************************************/

function appendIncentivesToPrivateBackend(records){

  if(
    !Array.isArray(records) ||
    records.length === 0
  ){

    Logger.log(
      "Private Backend: No records supplied."
    );

    return 0;

  }


  const tracker =
    getPrivateTrackerSheet();

  const columnCount =
    tracker.getLastColumn();


  //--------------------------------------------------
  // Require the existing 10-column tracker schema
  //--------------------------------------------------

  if(columnCount !== 10){

    throw new Error(
      "Private Incentive Tracker must contain exactly " +
      "10 columns. Current column count: " +
      columnCount
    );

  }


  //--------------------------------------------------
  // Validate incoming records
  //--------------------------------------------------

  const validRecords =
    records.filter(function(row){

      return (
        Array.isArray(row) &&
        row.length === columnCount &&
        PB_rowHasData(row)
      );

    });


  if(validRecords.length === 0){

    Logger.log(
      "Private Backend: No valid records supplied."
    );

    return 0;

  }


  //--------------------------------------------------
  // Read existing permanent records
  //--------------------------------------------------

  const lastRow =
    tracker.getLastRow();

  let existingRecords = [];


  if(lastRow > 1){

    existingRecords =
      tracker
        .getRange(
          2,
          1,
          lastRow - 1,
          columnCount
        )
        .getValues();

  }


  //--------------------------------------------------
  // Build permanent duplicate index
  //--------------------------------------------------

  const existingIndex = {};


  existingRecords.forEach(function(row){

    const key =
      PB_buildTrackerKey(row);

    if(key){

      existingIndex[key] = true;

    }

  });


  //--------------------------------------------------
  // Find genuinely new records
  //--------------------------------------------------

  const newRecords = [];


  validRecords.forEach(function(row){

    const key =
      PB_buildTrackerKey(row);

    if(!key)
      return;


    if(existingIndex[key]){

      return;

    }


    newRecords.push(row);

    // Also prevents duplicates inside the same batch.
    existingIndex[key] = true;

  });


  //--------------------------------------------------
  // Nothing new
  //--------------------------------------------------

  if(newRecords.length === 0){

    Logger.log(
      "Private Backend: No new records."
    );

    return 0;

  }


  //--------------------------------------------------
  // Append new records
  //--------------------------------------------------

  const startRow =
    Math.max(
      tracker.getLastRow() + 1,
      2
    );


  tracker
    .getRange(
      startRow,
      1,
      newRecords.length,
      columnCount
    )
    .setValues(
      newRecords
    );


  Logger.log(
    "Private Backend: Added " +
    newRecords.length +
    " new tracker records."
  );


  return newRecords.length;

}


/******************************************************
 * BUILD PRIVATE TRACKER KEY
 *
 * IMPORTANT:
 * Status is intentionally NOT part of the key.
 *
 * Therefore:
 *
 * Pending -> Approved -> Paid
 *
 * is still treated as the SAME incentive record.
 ******************************************************/

function PB_buildTrackerKey(row){

  if(
    !Array.isArray(row) ||
    row.length < 10
  ){

    return "";

  }


  const type =
    PB_normalizeText(
      row[0]
    );


  const candidate =
    PB_normalizeIdentity(
      row[1]
    );


  const client =
    PB_normalizeIdentity(
      row[2]
    );


  const fromRound =
    PB_normalizeText(
      row[3]
    );


  const toRound =
    PB_normalizeText(
      row[4]
    );


  const previousDate =
    PB_normalizeDate(
      row[5]
    );


  const promotionDate =
    PB_normalizeDate(
      row[6]
    );


  const handler =
    PB_normalizeText(
      row[7]
    );


  const amount =
    PB_normalizeAmount(
      row[8]
    );


  //--------------------------------------------------
  // Ignore completely blank records
  //--------------------------------------------------

  if(
    !type &&
    !candidate &&
    !client &&
    !fromRound &&
    !toRound &&
    !handler &&
    !amount
  ){

    return "";

  }


  //--------------------------------------------------
  // Status (row[9]) intentionally excluded
  //--------------------------------------------------

  return [

    type,

    candidate,

    client,

    fromRound,

    toRound,

    previousDate,

    promotionDate,

    handler,

    amount

  ].join("||");

}


/******************************************************
 * NORMALIZE GENERAL TEXT
 ******************************************************/

function PB_normalizeText(value){

  return String(
    value === null ||
    value === undefined
      ? ""
      : value
  )
    .trim()
    .toLowerCase()
    .replace(/\s+/g," ");

}


/******************************************************
 * NORMALIZE CANDIDATE / CLIENT IDENTITY
 *
 * This handles harmless differences such as:
 * - capitalization
 * - punctuation
 * - hyphens
 * - repeated spaces
 *
 * It intentionally does NOT perform fuzzy matching.
 * Fuzzy approval belongs in RecoveryEngine /
 * RecoveryApproval, not the permanent storage layer.
 ******************************************************/

function PB_normalizeIdentity(value){

  return String(
    value === null ||
    value === undefined
      ? ""
      : value
  )
    .trim()
    .toLowerCase()
    .replace(/[()]/g," ")
    .replace(/[-–—]/g," ")
    .replace(/[.,']/g," ")
    .replace(/\s+/g," ")
    .trim();

}


/******************************************************
 * NORMALIZE DATE
 ******************************************************/

function PB_normalizeDate(value){

  if(
    value === null ||
    value === undefined ||
    value === ""
  ){

    return "";

  }


  //--------------------------------------------------
  // Date object
  //--------------------------------------------------

  if(
    Object.prototype.toString.call(value) ===
    "[object Date]"
  ){

    if(isNaN(value.getTime()))
      return "";


    return Utilities.formatDate(

      value,

      Session.getScriptTimeZone(),

      "yyyy-MM-dd"

    );

  }


  //--------------------------------------------------
  // Text date
  //--------------------------------------------------

  const text =
    String(value)
      .trim();


  if(!text)
    return "";


  const parsed =
    new Date(text);


  if(!isNaN(parsed.getTime())){

    return Utilities.formatDate(

      parsed,

      Session.getScriptTimeZone(),

      "yyyy-MM-dd"

    );

  }


  //--------------------------------------------------
  // Keep unparseable text deterministically
  //--------------------------------------------------

  return PB_normalizeText(text);

}


/******************************************************
 * NORMALIZE AMOUNT
 ******************************************************/

function PB_normalizeAmount(value){

  if(
    value === null ||
    value === undefined ||
    value === ""
  ){

    return "";

  }


  const cleaned =
    String(value)
      .replace(/[₹,\s]/g,"")
      .trim();


  const number =
    Number(cleaned);


  if(!isNaN(number)){

    return String(number);

  }


  return PB_normalizeText(cleaned);

}


/******************************************************
 * ROW HAS DATA
 ******************************************************/

function PB_rowHasData(row){

  return row.some(function(value){

    return !(
      value === "" ||
      value === null ||
      value === undefined
    );

  });

}


/******************************************************
 * TEST PRIVATE BACKEND CONNECTION
 *
 * Safe read-only test.
 ******************************************************/

function testPrivateBackendConnection(){

  const ss =
    getPrivateIncentiveSpreadsheet();

  const tracker =
    getPrivateTrackerSheet();


  Logger.log(
    "========== PRIVATE BACKEND TEST =========="
  );

  Logger.log(
    "Spreadsheet : " +
    ss.getName()
  );

  Logger.log(
    "Spreadsheet ID : " +
    ss.getId()
  );

  Logger.log(
    "Tracker Sheet : " +
    tracker.getName()
  );

  Logger.log(
    "Tracker Rows : " +
    tracker.getLastRow()
  );

  Logger.log(
    "Tracker Columns : " +
    tracker.getLastColumn()
  );

  Logger.log(
    "=========================================="
  );

}


/******************************************************
 * OPTIONAL DUPLICATE AUDIT
 *
 * Read-only.
 * Reports how many duplicate permanent tracker
 * records already exist using the new key.
 ******************************************************/

function auditPrivateBackendDuplicates(){

  const tracker =
    getPrivateTrackerSheet();

  const lastRow =
    tracker.getLastRow();

  const lastColumn =
    tracker.getLastColumn();


  if(lastRow <= 1){

    Logger.log(
      "Private Backend Audit: No records."
    );

    return;

  }


  const values =
    tracker
      .getRange(
        2,
        1,
        lastRow - 1,
        lastColumn
      )
      .getValues();


  const seen = {};

  let duplicates = 0;


  values.forEach(function(row){

    const key =
      PB_buildTrackerKey(row);

    if(!key)
      return;


    if(seen[key]){

      duplicates++;

    }else{

      seen[key] = true;

    }

  });


  Logger.log(
    "========== PRIVATE BACKEND AUDIT =========="
  );

  Logger.log(
    "Records : " +
    values.length
  );

  Logger.log(
    "Unique Keys : " +
    Object.keys(seen).length
  );

  Logger.log(
    "Duplicate Records : " +
    duplicates
  );

  Logger.log(
    "==========================================="
  );

}

