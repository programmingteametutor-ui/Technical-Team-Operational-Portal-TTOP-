/******************************************************
 * PORTALINCENTIVEBRIDGE.GS
 * Secure bridge from Interview Operations Portal
 * to the ORIGINAL Incentive Tracker Apps Script project.
 *
 * Install in: Incentive Tracker Apps Script project
 *
 * This bridge DOES NOT duplicate the normal scan engine.
 * The Scan command queues scanIncentives() through a
 * one-time trigger so the bound-script context is preserved.
 *
 * Direct recovery / exception application is narrowly
 * implemented with the existing PrivateBackend functions.
 ******************************************************/

const PIB_CONFIG = {

  OPERATIONS_SPREADSHEET_ID:
    "1UudfZfeBBkEwBQeWUwx77R4gl26wYZ1rKKZWCM_SHq4",

  RECOVERY_SHEET:
    "Promotion Recovery",

  EXCEPTION_SHEET:
    "Recovery Exceptions",

  APPLIED_LOG_SHEET:
    "Recovery Applied Log",

  SECRET_PROPERTY:
    "PORTAL_INCENTIVE_BRIDGE_SECRET",

  CURRENT_SCAN_JOB_PROPERTY:
    "PORTAL_INCENTIVE_SCAN_CURRENT_JOB",

  SCAN_JOB_PREFIX:
    "PORTAL_INCENTIVE_SCAN_JOB_"

};


/******************************************************
 * SETUP - RUN MANUALLY ONCE
 ******************************************************/
function setupPortalIncentiveBridgeSecret(){

  const secret =
    Utilities.getUuid().replace(/-/g,"") +
    Utilities.getUuid().replace(/-/g,"") +
    Utilities.getUuid().replace(/-/g,"");

  PropertiesService
    .getScriptProperties()
    .setProperty(
      PIB_CONFIG.SECRET_PROPERTY,
      secret
    );

  Logger.log(
    "PORTAL INCENTIVE BRIDGE SECRET:"
  );

  Logger.log(secret);

  try{

    SpreadsheetApp
      .getUi()
      .alert(
        "Portal Incentive Bridge Secret\n\n" +
        secret +
        "\n\nCopy this value now."
      );

  }
  catch(error){
    // No UI in non-editor context.
  }

  return secret;
}


/******************************************************
 * WEB APP
 ******************************************************/
function doGet(){

  return PIB_json_({
    ok:
      true,
    service:
      "Interview Operations Portal - Incentive Bridge",
    message:
      "Bridge is online. POST authentication is required."
  });
}


function doPost(e){

  try{

    const body =
      JSON.parse(
        e &&
        e.postData &&
        e.postData.contents
          ? e.postData.contents
          : "{}"
      );

    PIB_requireSecret_(
      body.secret
    );

    const command =
      String(
        body.command || ""
      ).trim();

    const payload =
      body.payload &&
      typeof body.payload ===
        "object"
        ? body.payload
        : {};

    let data;

    switch(command){

      case "ping":
        data = {
          service:
            "Incentive Bridge",
          operationsWorkbook:
            PIB_CONFIG.OPERATIONS_SPREADSHEET_ID,
          privateTrackerAvailable:
            Boolean(
              getPrivateTrackerSheet()
            )
        };
        break;

      case "scan":
        data =
          PIB_queueScan_();
        break;

      case "scanStatus":
        data =
          PIB_scanStatus_(
            payload.jobId
          );
        break;

      case "applyRecovery":
        data =
          PIB_applyRecovery_(
            payload.recoveryId
          );
        break;

      case "applyException":
        data =
          PIB_applyException_(
            payload.exceptionId,
            payload.handler
          );
        break;

      case "applyAllApproved":
        data =
          PIB_applyAllApprovedRecoveries_();
        break;

      default:
        throw new Error(
          "INCENTIVE_BRIDGE_COMMAND_NOT_ALLOWED"
        );

    }

    return PIB_json_({
      ok:
        true,
      command:
        command,
      requestId:
        String(
          body.requestId || ""
        ),
      data:
        data
    });

  }
  catch(error){

    Logger.log(
      error &&
      error.stack
        ? error.stack
        : error
    );

    return PIB_json_({
      ok:
        false,
      error:
        error &&
        error.message
          ? error.message
          : String(error)
    });

  }

}


/******************************************************
 * INCENTIVE SCAN QUEUE
 *
 * Bound-script active spreadsheet methods are not
 * available in a Web App request. A one-time trigger
 * runs scanIncentives() in the bound script context.
 ******************************************************/
function PIB_queueScan_(){

  const lock =
    LockService.getScriptLock();

  lock.waitLock(10000);

  try{

    const props =
      PropertiesService
        .getScriptProperties();

    const currentId =
      String(
        props.getProperty(
          PIB_CONFIG
            .CURRENT_SCAN_JOB_PROPERTY
        ) || ""
      ).trim();

    if(currentId){

      const current =
        PIB_readScanJob_(
          currentId
        );

      if(
        current &&
        (
          current.status ===
            "Queued" ||
          current.status ===
            "Running"
        )
      ){

        return current;
      }

    }

    const jobId =
      "SCAN-" +
      Utilities.getUuid();

    const job = {
      jobId:
        jobId,
      status:
        "Queued",
      requestedAt:
        new Date().toISOString(),
      startedAt:
        "",
      finishedAt:
        "",
      error:
        ""
    };

    PIB_writeScanJob_(
      job
    );

    props.setProperty(
      PIB_CONFIG
        .CURRENT_SCAN_JOB_PROPERTY,
      jobId
    );

    ScriptApp
      .newTrigger(
        "PIB_runQueuedScan_"
      )
      .timeBased()
      .after(
        1000
      )
      .create();

    return job;

  }
  finally{
    lock.releaseLock();
  }

}


/**
 * One-time trigger target.
 */
function PIB_runQueuedScan_(){

  const props =
    PropertiesService
      .getScriptProperties();

  const jobId =
    String(
      props.getProperty(
        PIB_CONFIG
          .CURRENT_SCAN_JOB_PROPERTY
      ) || ""
    ).trim();

  if(!jobId){
    return;
  }

  let job =
    PIB_readScanJob_(
      jobId
    ) || {
      jobId:
        jobId
    };

  job.status =
    "Running";

  job.startedAt =
    new Date().toISOString();

  job.error =
    "";

  PIB_writeScanJob_(
    job
  );

  try{

    scanIncentives();

    job.status =
      "Completed";

  }
  catch(error){

    job.status =
      "Failed";

    job.error =
      error &&
      error.message
        ? error.message
        : String(error);

    Logger.log(
      error &&
      error.stack
        ? error.stack
        : error
    );

  }

  job.finishedAt =
    new Date().toISOString();

  PIB_writeScanJob_(
    job
  );

  props.deleteProperty(
    PIB_CONFIG
      .CURRENT_SCAN_JOB_PROPERTY
  );

}


function PIB_scanStatus_(
  jobId
){

  const id =
    String(
      jobId || ""
    ).trim();

  if(!id){
    throw new Error(
      "SCAN_JOB_ID_REQUIRED"
    );
  }

  const job =
    PIB_readScanJob_(
      id
    );

  if(!job){
    throw new Error(
      "SCAN_JOB_NOT_FOUND"
    );
  }

  return job;
}


function PIB_scanJobKey_(
  jobId
){

  return (
    PIB_CONFIG
      .SCAN_JOB_PREFIX +
    String(
      jobId || ""
    )
  );
}


function PIB_readScanJob_(
  jobId
){

  const raw =
    PropertiesService
      .getScriptProperties()
      .getProperty(
        PIB_scanJobKey_(
          jobId
        )
      );

  if(!raw){
    return null;
  }

  try{
    return JSON.parse(raw);
  }
  catch(error){
    return null;
  }
}


function PIB_writeScanJob_(
  job
){

  PropertiesService
    .getScriptProperties()
    .setProperty(
      PIB_scanJobKey_(
        job.jobId
      ),
      JSON.stringify(
        job
      )
    );
}


/******************************************************
 * APPLY ONE APPROVED RECOVERY
 ******************************************************/
function PIB_applyRecovery_(
  recoveryId
){

  const id =
    String(
      recoveryId || ""
    ).trim();

  if(!id){
    throw new Error(
      "RECOVERY_ID_REQUIRED"
    );
  }

  const ss =
    SpreadsheetApp.openById(
      PIB_CONFIG
        .OPERATIONS_SPREADSHEET_ID
    );

  const sheet =
    ss.getSheetByName(
      PIB_CONFIG
        .RECOVERY_SHEET
    );

  if(!sheet){
    throw new Error(
      "PROMOTION_RECOVERY_SHEET_NOT_FOUND"
    );
  }

  const values =
    sheet.getDataRange()
      .getValues();

  const headers =
    PIB_headerMap_(
      values[0] || []
    );

  const rowInfo =
    PIB_findRowById_(
      values,
      headers,
      "Recovery ID",
      id
    );

  if(!rowInfo){
    throw new Error(
      "RECOVERY_NOT_FOUND"
    );
  }

  const row =
    rowInfo.row;

  let status =
    String(
      row[
        headers["Status"]
      ] || ""
    )
    .trim()
    .toLowerCase();


  //--------------------------------------------------
  // APPROVE & APPLY RACE-PROTECTION
  //
  // The portal writes "Approved" and then this separate
  // Web App immediately opens the same workbook.
  //
  // Google Sheets can briefly expose the old "Pending"
  // value to the second Apps Script process even though
  // the first write succeeded.
  //
  // Because this bridge is called only after the Admin
  // has already passed PO_requireAdmin_() and requested
  // "Approve & Apply", Pending is safe to promote here.
  //--------------------------------------------------

  if(status === "pending"){

    if(
      headers["Status"] ===
      undefined
    ){
      throw new Error(
        "MISSING_HEADER_Status"
      );
    }


    sheet
      .getRange(
        rowInfo.rowNumber,
        headers["Status"] + 1
      )
      .setValue(
        "Approved"
      );


    SpreadsheetApp.flush();


    status =
      "approved";

  }


  //--------------------------------------------------
  // Never apply Rejected / Ignore / other states.
  //--------------------------------------------------

  if(status !== "approved"){
    throw new Error(
      "RECOVERY_MUST_BE_APPROVED_FIRST"
    );
  }


  const trackerRow = [

    "Promotion",

    String(
      row[
        headers["Candidate"]
      ] || ""
    ).trim(),

    String(
      row[
        headers["Team Client"]
      ] || ""
    ).trim(),

    String(
      row[
        headers["Previous Round"]
      ] || ""
    ).trim(),

    String(
      row[
        headers["Current Round"]
      ] || ""
    ).trim(),

    row[
      headers["Team Date"]
    ],

    row[
      headers["Promotion Date"]
    ],

    String(
      row[
        headers["Suggested Handler"]
      ] || ""
    ).trim(),

    PIB_number_(
      row[
        headers["Amount"]
      ]
    ),

    "Pending"

  ];

  return PIB_applyTrackerRow_(
    ss,
    id,
    trackerRow
  );
}


/******************************************************
 * SAFE MANUAL TEST
 *
 * Read-only. Run in Incentive Tracker Apps Script.
 *
 * Logs counts of Pending / Approved / Rejected rows in
 * Promotion Recovery so bridge visibility can be checked.
 ******************************************************/
function testPortalRecoveryBridgeVisibility(){

  const ss =
    SpreadsheetApp.openById(
      PIB_CONFIG.OPERATIONS_SPREADSHEET_ID
    );

  const sheet =
    ss.getSheetByName(
      PIB_CONFIG.RECOVERY_SHEET
    );

  if(!sheet){
    throw new Error(
      "PROMOTION_RECOVERY_SHEET_NOT_FOUND"
    );
  }

  const values =
    sheet.getDataRange()
      .getValues();

  const headers =
    PIB_headerMap_(
      values[0] || []
    );

  if(
    headers["Status"] ===
    undefined
  ){
    throw new Error(
      "MISSING_HEADER_Status"
    );
  }

  const counts = {
    Pending:
      0,
    Approved:
      0,
    Rejected:
      0,
    Other:
      0
  };

  for(
    let i = 1;
    i < values.length;
    i++
  ){

    const status =
      String(
        values[i][
          headers["Status"]
        ] || ""
      ).trim();

    if(status === "Pending"){
      counts.Pending++;
    }else if(status === "Approved"){
      counts.Approved++;
    }else if(status === "Rejected"){
      counts.Rejected++;
    }else if(status){
      counts.Other++;
    }

  }

  Logger.log(
    "========== RECOVERY BRIDGE VISIBILITY =========="
  );

  Logger.log(
    JSON.stringify(
      counts,
      null,
      2
    )
  );

  Logger.log(
    "==============================================="
  );

  return counts;
}


/******************************************************
 * APPLY ONE ADMIN-APPROVED EXCEPTION
 *
 * Amount rule follows the established incentive values:
 * 1st -> 2nd = 100
 * any other approved promotion exception = 500
 *
 * If the exception suggests multiple handlers, the portal
 * must supply the Admin-selected handler.
 ******************************************************/
function PIB_applyException_(
  exceptionId,
  selectedHandler
){

  const id =
    String(
      exceptionId || ""
    ).trim();

  if(!id){
    throw new Error(
      "EXCEPTION_ID_REQUIRED"
    );
  }

  const ss =
    SpreadsheetApp.openById(
      PIB_CONFIG
        .OPERATIONS_SPREADSHEET_ID
    );

  const sheet =
    ss.getSheetByName(
      PIB_CONFIG
        .EXCEPTION_SHEET
    );

  if(!sheet){
    throw new Error(
      "RECOVERY_EXCEPTIONS_SHEET_NOT_FOUND"
    );
  }

  const values =
    sheet.getDataRange()
      .getValues();

  const headers =
    PIB_headerMap_(
      values[0] || []
    );

  const rowInfo =
    PIB_findRowById_(
      values,
      headers,
      "Exception ID",
      id
    );

  if(!rowInfo){
    throw new Error(
      "EXCEPTION_NOT_FOUND"
    );
  }

  const row =
    rowInfo.row;

  const currentStatus =
    String(
      row[
        headers["Status"]
      ] || ""
    )
    .trim()
    .toLowerCase();

  if(
    currentStatus !== "review" &&
    currentStatus !== "resolved"
  ){
    throw new Error(
      "EXCEPTION_NOT_AVAILABLE_FOR_APPROVAL"
    );
  }

  const suggested =
    String(
      row[
        headers[
          "Suggested Handler(s)"
        ]
      ] || ""
    )
    .split(
      /[,;|/]+/
    )
    .map(
      function(value){
        return String(value || "").trim();
      }
    )
    .filter(Boolean);

  const requested =
    String(
      selectedHandler || ""
    ).trim();

  let handler =
    requested;

  if(!handler){

    if(suggested.length === 1){
      handler =
        suggested[0];
    }else{
      throw new Error(
        "EXCEPTION_HANDLER_SELECTION_REQUIRED"
      );
    }

  }

  if(
    suggested.length &&
    !suggested.some(
      function(name){
        return (
          PIB_key_(name) ===
          PIB_key_(handler)
        );
      }
    )
  ){
    throw new Error(
      "INVALID_EXCEPTION_HANDLER"
    );
  }

  const fromRound =
    String(
      row[
        headers["Team Round"]
      ] || ""
    ).trim();

  const toRound =
    String(
      row[
        headers["Raw Round"]
      ] || ""
    ).trim();

  const amount =
    PIB_exceptionAmount_(
      fromRound,
      toRound
    );

  const candidate =
    String(
      row[
        headers[
          "Possible Team Candidate"
        ]
      ] || ""
    ).trim() ||
    String(
      row[
        headers["Candidate"]
      ] || ""
    ).trim();

  const trackerRow = [

    "Promotion",

    candidate,

    String(
      row[
        headers["Team Client"]
      ] || ""
    ).trim(),

    fromRound,

    toRound,

    row[
      headers["Team Date"]
    ],

    row[
      headers["Promotion Date"]
    ],

    handler,

    amount,

    "Pending"

  ];

  return PIB_applyTrackerRow_(
    ss,
    id,
    trackerRow
  );
}


/******************************************************
 * APPLY ALL ALREADY-APPROVED RECOVERIES
 * Useful as a catch-up button for old portal approvals.
 ******************************************************/
function PIB_applyAllApprovedRecoveries_(){

  const ss =
    SpreadsheetApp.openById(
      PIB_CONFIG
        .OPERATIONS_SPREADSHEET_ID
    );

  const sheet =
    ss.getSheetByName(
      PIB_CONFIG
        .RECOVERY_SHEET
    );

  if(
    !sheet ||
    sheet.getLastRow() <= 1
  ){
    return {
      applied:
        0,
      totalApproved:
        0,
      errors:
        []
    };
  }

  const values =
    sheet.getDataRange()
      .getValues();

  const headers =
    PIB_headerMap_(
      values[0] || []
    );

  let totalApproved = 0;
  let applied = 0;
  const errors = [];

  for(
    let i = 1;
    i < values.length;
    i++
  ){

    const status =
      String(
        values[i][
          headers["Status"]
        ] || ""
      )
      .trim()
      .toLowerCase();

    if(status !== "approved"){
      continue;
    }

    totalApproved++;

    const id =
      String(
        values[i][
          headers["Recovery ID"]
        ] || ""
      ).trim();

    try{

      const result =
        PIB_applyRecovery_(
          id
        );

      if(result.confirmed){
        applied++;
      }

    }
    catch(error){

      errors.push({
        id:
          id,
        error:
          error &&
          error.message
            ? error.message
            : String(error)
      });

    }

  }

  return {
    applied:
      applied,
    totalApproved:
      totalApproved,
    errors:
      errors
  };
}


/******************************************************
 * TRACKER WRITE + APPLIED LOG
 ******************************************************/
function PIB_applyTrackerRow_(
  operationsWorkbook,
  sourceId,
  trackerRow
){

  if(
    !trackerRow ||
    trackerRow.length !== 10
  ){
    throw new Error(
      "INVALID_TRACKER_ROW"
    );
  }

  const key =
    PB_buildTrackerKey(
      trackerRow
    );

  if(!key){
    throw new Error(
      "TRACKER_KEY_COULD_NOT_BE_BUILT"
    );
  }

  const tracker =
    getPrivateTrackerSheet();

  const existing =
    tracker.getLastRow() > 1
      ? tracker
          .getRange(
            2,
            1,
            tracker.getLastRow() - 1,
            10
          )
          .getValues()
      : [];

  const alreadyExists =
    existing.some(
      function(row){
        return (
          PB_buildTrackerKey(
            row
          ) ===
          key
        );
      }
    );

  let added = 0;

  if(!alreadyExists){

    added =
      appendIncentivesToPrivateBackend(
        [trackerRow]
      );

  }

  const confirmedRows =
    tracker.getLastRow() > 1
      ? tracker
          .getRange(
            2,
            1,
            tracker.getLastRow() - 1,
            10
          )
          .getValues()
      : [];

  const confirmed =
    confirmedRows.some(
      function(row){
        return (
          PB_buildTrackerKey(
            row
          ) ===
          key
        );
      }
    );

  if(!confirmed){
    throw new Error(
      "BACKEND_INCENTIVE_COULD_NOT_BE_CONFIRMED"
    );
  }

  PIB_writeAppliedLog_(
    operationsWorkbook,
    sourceId,
    trackerRow,
    added > 0
      ? "Added"
      : "Already in Backend"
  );

  return {
    sourceId:
      sourceId,
    added:
      added,
    confirmed:
      true,
    amount:
      PIB_number_(
        trackerRow[8]
      ),
    handler:
      trackerRow[7],
    candidate:
      trackerRow[1]
  };
}


function PIB_writeAppliedLog_(
  ss,
  sourceId,
  trackerRow,
  result
){

  let sheet =
    ss.getSheetByName(
      PIB_CONFIG
        .APPLIED_LOG_SHEET
    );

  const headers = [[
    "Recovery ID",
    "Applied Date",
    "Result",
    "Candidate",
    "Client",
    "From",
    "To",
    "Handler",
    "Amount"
  ]];

  if(!sheet){

    sheet =
      ss.insertSheet(
        PIB_CONFIG
          .APPLIED_LOG_SHEET
      );

    sheet
      .getRange(
        1,
        1,
        1,
        headers[0].length
      )
      .setValues(
        headers
      )
      .setFontWeight(
        "bold"
      );

  }

  if(
    sheet.getLastRow() > 1
  ){

    const ids =
      sheet
        .getRange(
          2,
          1,
          sheet.getLastRow() - 1,
          1
        )
        .getDisplayValues()
        .map(
          function(row){
            return String(
              row[0] || ""
            ).trim();
          }
        );

    if(
      ids.indexOf(
        sourceId
      ) !== -1
    ){
      return;
    }

  }

  sheet.appendRow([
    sourceId,
    new Date(),
    result,
    trackerRow[1],
    trackerRow[2],
    trackerRow[3],
    trackerRow[4],
    trackerRow[7],
    trackerRow[8]
  ]);
}


/******************************************************
 * HELPERS
 ******************************************************/
function PIB_exceptionAmount_(
  fromRound,
  toRound
){

  const from =
    String(
      fromRound || ""
    )
    .trim()
    .toLowerCase();

  const to =
    String(
      toRound || ""
    )
    .trim()
    .toLowerCase();

  if(
    /^1st\s+round$/.test(from) &&
    /^2nd\s+round$/.test(to)
  ){
    return 100;
  }

  return 500;
}


function PIB_findRowById_(
  values,
  headers,
  idHeader,
  id
){

  const col =
    headers[idHeader];

  if(col === undefined){
    throw new Error(
      "MISSING_HEADER_" +
      idHeader
    );
  }

  for(
    let i = 1;
    i < values.length;
    i++
  ){

    if(
      String(
        values[i][col] || ""
      ).trim() === id
    ){

      return {
        rowNumber:
          i + 1,
        row:
          values[i]
      };
    }

  }

  return null;
}


function PIB_headerMap_(
  headers
){

  const map = {};

  headers.forEach(
    function(value,index){
      map[
        String(
          value || ""
        ).trim()
      ] = index;
    }
  );

  return map;
}


function PIB_number_(
  value
){

  if(
    typeof value ===
    "number"
  ){
    return value;
  }

  return Number(
    String(
      value || ""
    )
    .replace(
      /[^0-9.-]/g,
      ""
    )
  ) || 0;
}


function PIB_key_(
  value
){

  return String(
    value || ""
  )
  .replace(/\s+/g," ")
  .trim()
  .toLowerCase();
}


function PIB_requireSecret_(
  provided
){

  const expected =
    String(
      PropertiesService
        .getScriptProperties()
        .getProperty(
          PIB_CONFIG
            .SECRET_PROPERTY
        ) || ""
    );

  if(!expected){
    throw new Error(
      "INCENTIVE_BRIDGE_SECRET_NOT_CONFIGURED"
    );
  }

  const actual =
    String(
      provided || ""
    );

  if(
    actual.length !==
      expected.length ||
    actual !== expected
  ){
    throw new Error(
      "INCENTIVE_BRIDGE_AUTH_FAILED"
    );
  }
}


function PIB_json_(
  obj
){

  return ContentService
    .createTextOutput(
      JSON.stringify(
        obj
      )
    )
    .setMimeType(
      ContentService
        .MimeType
        .JSON
    );
}
