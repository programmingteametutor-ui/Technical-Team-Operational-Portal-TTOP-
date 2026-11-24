/******************************************************
 * PORTALINCENTIVEBRIDGE.GS - FAST RECOVERY ACTIONS v2.1
 * Secure bridge from Interview Operations Portal
 * to the PRIVATE Incentive Backend Apps Script project.
 *
 * Install in: Incentive Backend - Private Apps Script project
 *
 * This bridge DOES NOT duplicate the normal scan engine.
 *
 * FAST DIRECT SCAN + RECOVERY + PROGRESS PATCH:
 * The Scan command sets Incentive Backend - Private as the
 * active spreadsheet for this Web App execution and calls
 * the existing scanIncentives() heart directly.
 *
 * This removes the one-time time-trigger queue delay while
 * preserving the original scanIncentives() calculation.
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
          PIB_runDirectScan_(
            payload.operationId
          );
        break;

      case "progress":
        data =
          PIB_getOperationProgress_(
            payload.operationId
          );
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
            payload.recoveryId,
            payload.operationId
          );
        break;

      case "applyException":
        data =
          PIB_applyException_(
            payload.exceptionId,
            payload.handler,
            payload.operationId
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
 * OPERATION PROGRESS
 ******************************************************/
const PIB_PROGRESS_PREFIX =
  "PIB_OPERATION_PROGRESS_";


function PIB_setOperationProgress_(
  operationId,
  percent,
  stage,
  detail,
  status,
  extra
){

  const id =
    String(operationId || "")
      .trim();

  if(!id){
    return;
  }

  const value = {
    operationId: id,
    percent: Math.max(
      0,
      Math.min(
        100,
        Number(percent || 0)
      )
    ),
    stage: String(stage || ""),
    detail: String(detail || ""),
    status: String(status || "Running"),
    updatedAt: new Date().toISOString()
  };

  if(
    extra &&
    typeof extra === "object"
  ){
    Object.keys(extra)
      .forEach(function(key){
        value[key] = extra[key];
      });
  }

  CacheService
    .getScriptCache()
    .put(
      PIB_PROGRESS_PREFIX + id,
      JSON.stringify(value),
      21600
    );
}


function PIB_getOperationProgress_(
  operationId
){

  const id =
    String(operationId || "")
      .trim();

  if(!id){
    return {
      operationId: "",
      percent: 0,
      stage: "Waiting",
      detail: "",
      status: "Waiting"
    };
  }

  const raw =
    CacheService
      .getScriptCache()
      .get(
        PIB_PROGRESS_PREFIX + id
      );

  if(!raw){
    return {
      operationId: id,
      percent: 0,
      stage: "Waiting",
      detail: "",
      status: "Waiting"
    };
  }

  try{
    return JSON.parse(raw);
  }catch(error){
    return {
      operationId: id,
      percent: 0,
      stage: "Waiting",
      detail: "",
      status: "Waiting"
    };
  }
}


/******************************************************
 * FAST DIRECT INCENTIVE SCAN
 *
 * Why:
 * ClockTriggerBuilder.after(1000) specifies only a
 * minimum delay. The actual trigger execution can occur
 * later, which made portal scans appear to run for
 * several minutes even though the heart scan itself is
 * fast when run manually.
 *
 * How:
 * 1. Open the private engine workbook explicitly.
 * 2. Make it the active spreadsheet for THIS execution.
 * 3. Call the existing scanIncentives() heart directly.
 *
 * No incentive calculation is duplicated here.
 ******************************************************/
function PIB_runDirectScan_(
  operationId
){

  const lock =
    LockService.getScriptLock();

  if(
    !lock.tryLock(
      30000
    )
  ){

    PIB_setOperationProgress_(
      operationId,
      100,
      "Incentive processing blocked",
      "Another Incentive Processing operation is already running.",
      "Failed"
    );

    throw new Error(
      "INCENTIVE_SCAN_ALREADY_RUNNING"
    );
  }


  const props =
    PropertiesService
      .getScriptProperties();


  const jobId =
    "SCAN-" +
    Utilities.getUuid();


  const opId =
    String(
      operationId || jobId
    );


  const startedMs =
    Date.now();


  const job = {
    jobId:
      jobId,
    operationId:
      opId,
    status:
      "Running",
    mode:
      "DIRECT_SCAN_PLUS_RECOVERY",
    phase:
      "Starting",
    requestedAt:
      new Date().toISOString(),
    startedAt:
      new Date().toISOString(),
    finishedAt:
      "",
    elapsedMs:
      0,
    error:
      ""
  };


  try{

    PIB_setOperationProgress_(
      opId,
      5,
      "Starting incentive processing",
      "Preparing the private incentive workbook.",
      "Running"
    );


    PIB_writeScanJob_(
      job
    );


    props.setProperty(
      PIB_CONFIG
        .CURRENT_SCAN_JOB_PROPERTY,
      jobId
    );


    const privateSS =
      PIB_privateEngineSpreadsheet_();


    SpreadsheetApp
      .setActiveSpreadsheet(
        privateSS
      );


    const active =
      SpreadsheetApp
        .getActive();


    if(
      !active ||
      active.getId() !==
        privateSS.getId()
    ){
      throw new Error(
        "PRIVATE_ENGINE_ACTIVE_CONTEXT_NOT_SET"
      );
    }


    if(
      typeof scanIncentives !==
        "function"
    ){
      throw new Error(
        "SCAN_INCENTIVES_FUNCTION_NOT_FOUND"
      );
    }


    if(
      typeof recoverMissedPromotions !==
        "function"
    ){
      throw new Error(
        "RECOVERY_FUNCTION_NOT_FOUND"
      );
    }


    job.phase =
      "Incentive Scan";


    PIB_setOperationProgress_(
      opId,
      20,
      "Running Incentive Scan",
      "Executing the existing scanIncentives() engine.",
      "Running"
    );


    //--------------------------------------------------
    // EXISTING INCENTIVE HEART
    //--------------------------------------------------

    scanIncentives();


    PIB_setOperationProgress_(
      opId,
      60,
      "Incentive Scan complete",
      "Normal incentive scan completed. Starting Recovery detection.",
      "Running"
    );


    job.phase =
      "Recovery";


    PIB_setOperationProgress_(
      opId,
      65,
      "Running Recovery",
      "Checking missed promotions and refreshing Recovery / Exceptions / Evidence.",
      "Running"
    );


    //--------------------------------------------------
    // EXISTING RECOVERY HEART
    //--------------------------------------------------

    recoverMissedPromotions();


    PIB_setOperationProgress_(
      opId,
      96,
      "Recovery complete",
      "Recovery detection and evidence refresh completed.",
      "Running"
    );


    job.phase =
      "Complete";

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


    PIB_setOperationProgress_(
      opId,
      100,
      "Incentive processing failed",
      job.error,
      "Failed",
      {
        phase:
          job.phase
      }
    );


    Logger.log(
      error &&
      error.stack
        ? error.stack
        : error
    );

  }
  finally{

    job.finishedAt =
      new Date().toISOString();

    job.elapsedMs =
      Date.now() -
      startedMs;


    PIB_writeScanJob_(
      job
    );


    props.deleteProperty(
      PIB_CONFIG
        .CURRENT_SCAN_JOB_PROPERTY
    );


    if(
      job.status ===
        "Completed"
    ){

      PIB_setOperationProgress_(
        opId,
        100,
        "Incentive processing complete",
        "Incentive Scan + Recovery completed in " +
        Math.max(
          1,
          Math.round(
            job.elapsedMs /
            1000
          )
        ) +
        " sec.",
        "Completed",
        {
          elapsedMs:
            job.elapsedMs
        }
      );

    }


    lock.releaseLock();

  }


  return job;

}


/******************************************************
 * PRIVATE: RESOLVE PRIVATE ENGINE WORKBOOK
 ******************************************************/
function PIB_privateEngineSpreadsheet_(){

  if(
    typeof IR_backend_ ===
      "function"
  ){

    return IR_backend_();

  }


  if(
    typeof getPrivateIncentiveSpreadsheet ===
      "function"
  ){

    return getPrivateIncentiveSpreadsheet();

  }


  if(
    typeof INCENTIVE_PRIVATE_ROUTING !==
      "undefined" &&
    INCENTIVE_PRIVATE_ROUTING &&
    INCENTIVE_PRIVATE_ROUTING
      .PRIVATE_BACKEND_ID
  ){

    return SpreadsheetApp
      .openById(
        INCENTIVE_PRIVATE_ROUTING
          .PRIVATE_BACKEND_ID
      );

  }


  throw new Error(
    "PRIVATE_ENGINE_WORKBOOK_ROUTER_NOT_FOUND"
  );

}


/******************************************************
 * READ-ONLY CONTEXT TEST
 *
 * Run manually in Incentive Backend - Private BEFORE
 * deploying the bridge update.
 *
 * Does NOT run scanIncentives().
 ******************************************************/
function PIB_testDirectScanContextReadOnly(){

  const privateSS =
    PIB_privateEngineSpreadsheet_();


  SpreadsheetApp
    .setActiveSpreadsheet(
      privateSS
    );


  const active =
    SpreadsheetApp
      .getActive();


  const operations =
    typeof IR_operations_ ===
      "function"
      ? IR_operations_()
      : null;


  const result = {
    ok:
      Boolean(
        active &&
        active.getId() ===
          privateSS.getId() &&
        typeof scanIncentives ===
          "function"
      ),
    mode:
      "READ_ONLY_DIRECT_SCAN_CONTEXT",
    privateWorkbook:
      privateSS.getName(),
    activeContextMatchesPrivate:
      Boolean(
        active &&
        active.getId() ===
          privateSS.getId()
      ),
    scanFunctionAvailable:
      typeof scanIncentives ===
        "function",
    sharedRawFound:
      Boolean(
        operations &&
        operations.getSheetByName(
          "Raw Data"
        )
      ),
    sharedTeamFound:
      Boolean(
        operations &&
        operations.getSheetByName(
          "Team Data"
        )
      ),
    privateTrackerFound:
      Boolean(
        privateSS.getSheetByName(
          "Incentive Tracker"
        )
      )
  };


  Logger.log(
    "========== DIRECT INCENTIVE SCAN CONTEXT =========="
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


/******************************************************
 * LEGACY INCENTIVE SCAN QUEUE
 *
 * Kept temporarily for compatibility with any old
 * already-created trigger. New portal scan requests no
 * longer use this queue.
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

    const privateSS =
      PIB_privateEngineSpreadsheet_();

    SpreadsheetApp
      .setActiveSpreadsheet(
        privateSS
      );

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
  recoveryId,
  operationId
){

  const started =
    Date.now();

  const opId =
    String(operationId || "")
      .trim();

  const id =
    String(
      recoveryId || ""
    ).trim();

  if(!id){
    throw new Error(
      "RECOVERY_ID_REQUIRED"
    );
  }


  PIB_setOperationProgress_(
    opId,
    10,
    "Loading recovery",
    "Opening the confirmed Recovery record.",
    "Running"
  );


  try{

    const ss =
      getPrivateIncentiveSpreadsheet();

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
      sheet
        .getDataRange()
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


    PIB_setOperationProgress_(
      opId,
      30,
      "Approving recovery",
      "Validating the Recovery status.",
      "Running"
    );


    // The secure portal invokes this bridge only after Admin
    // authorization + confirmation. Handle Pending -> Approved
    // in THIS same private-backend process, avoiding the old
    // duplicate portal write + flush + second Web App read.
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

      status =
        "approved";

    }


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


    PIB_setOperationProgress_(
      opId,
      55,
      "Writing permanent incentive",
      "Applying duplicate protection and writing the permanent tracker record.",
      "Running"
    );


    const result =
      PIB_applyTrackerRow_(
        ss,
        id,
        trackerRow
      );


    SpreadsheetApp.flush();


    const output =
      Object.assign(
        {},
        result,
        {
          elapsedMs:
            Date.now() -
            started
        }
      );


    PIB_setOperationProgress_(
      opId,
      100,
      "Recovery approved & applied",
      result.added > 0
        ? (
            result.candidate +
            " • ₹" +
            Number(result.amount || 0) +
            " added to the permanent Incentive Tracker."
          )
        : (
            result.candidate +
            " • incentive already existed in the permanent tracker."
          ),
      "Completed",
      output
    );


    return output;

  }
  catch(error){

    PIB_setOperationProgress_(
      opId,
      100,
      "Recovery approval failed",
      error && error.message
        ? error.message
        : String(error),
      "Failed"
    );

    throw error;

  }

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
    getPrivateIncentiveSpreadsheet();

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
  selectedHandler,
  operationId
){

  const opId =
    String(operationId || "")
      .trim();

  const started =
    Date.now();

  PIB_setOperationProgress_(
    opId,
    10,
    "Loading exception",
    "Opening the Recovery Exception record.",
    "Running"
  );

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
    getPrivateIncentiveSpreadsheet();

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

  PIB_setOperationProgress_(
    opId,
    55,
    "Writing exception incentive",
    "Applying duplicate protection and writing the permanent tracker record.",
    "Running"
  );

  const result =
    PIB_applyTrackerRow_(
      ss,
      id,
      trackerRow
    );


  if(
    headers["Status"] !==
      undefined
  ){

    sheet
      .getRange(
        rowInfo.rowNumber,
        headers["Status"] + 1
      )
      .setValue(
        "Resolved"
      );

  }


  SpreadsheetApp.flush();


  const output =
    Object.assign(
      {},
      result,
      {
        elapsedMs:
          Date.now() -
          started
      }
    );


  PIB_setOperationProgress_(
    opId,
    100,
    "Exception incentive approved",
    result.added > 0
      ? (
          result.candidate +
          " • ₹" +
          Number(result.amount || 0) +
          " added to the permanent Incentive Tracker."
        )
      : (
          result.candidate +
          " • incentive already existed in the permanent tracker."
        ),
    "Completed",
    output
  );


  return output;
}


/******************************************************
 * APPLY ALL ALREADY-APPROVED RECOVERIES
 * Useful as a catch-up button for old portal approvals.
 ******************************************************/
function PIB_applyAllApprovedRecoveries_(){

  const ss =
    getPrivateIncentiveSpreadsheet();

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


  //--------------------------------------------------
  // PERFORMANCE FIX
  //
  // OLD PATH:
  //   read tracker
  //   -> canonical writer reads tracker again
  //   -> read tracker a third time to confirm
  //
  // NEW PATH:
  //   canonical duplicate-safe writer ONCE.
  //
  // appendIncentivesToPrivateBackend() already validates
  // the schema, builds the permanent duplicate index, and
  // writes only genuinely new rows.
  //--------------------------------------------------

  const added =
    appendIncentivesToPrivateBackend(
      [trackerRow]
    );


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


  const lastRow =
    sheet.getLastRow();


  if(lastRow > 1){

    const found =
      sheet
        .getRange(
          2,
          1,
          lastRow - 1,
          1
        )
        .createTextFinder(
          String(sourceId || "")
        )
        .matchEntireCell(
          true
        )
        .findNext();

    if(found){
      return;
    }

  }


  sheet
    .getRange(
      Math.max(
        2,
        lastRow + 1
      ),
      1,
      1,
      9
    )
    .setValues([[
      sourceId,
      new Date(),
      result,
      trackerRow[1],
      trackerRow[2],
      trackerRow[3],
      trackerRow[4],
      trackerRow[7],
      trackerRow[8]
    ]]);

}


/******************************************************
 * HELPERS
 ******************************************************/
function PIB_exceptionAmount_(fromRound,toRound){

  const fromText = String(fromRound || "").trim();
  const toText = String(toRound || "").trim();

  const fromMatch = fromText.match(/\b(\d{1,2})\s*(?:st|nd|rd|th)?\s*(?:Round|Rd)?\b/i);
  const toMatch = toText.match(/\b(\d{1,2})\s*(?:st|nd|rd|th)?\s*(?:Round|Rd)?\b/i);

  const from = fromMatch ? Number(fromMatch[1]) : 0;
  const to = /^final$/i.test(toText) ? 999 : (toMatch ? Number(toMatch[1]) : 0);

  if(from <= 0 || to <= from)
    return 0;

  // Business rule: a Team-handled 1st Round earns ₹100
  // when Raw Data later proves ANY higher round.
  if(from === 1)
    return 100;

  // Any Team-handled 2nd+ Round earns ₹500 when Raw Data
  // later proves ANY higher round.
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
