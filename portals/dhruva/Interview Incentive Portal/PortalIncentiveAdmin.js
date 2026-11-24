/******************************************************
 * PORTALINCENTIVEADMIN.GS - FAST RECOVERY QUEUE v2.1 - QUEUE/PROGRESS v2.0
 * Interview Operations Portal -> Incentive Bridge
 *
 * Install in: Interview Portal Control project
 *
 * Admin only:
 * - Run normal Incentive Scan
 * - Poll scan status
 * - Approve & immediately apply Recovery
 * - Approve Exception as incentive
 * - Catch up already-approved recoveries
 ******************************************************/

const PORTAL_INCENTIVE_ADMIN = {

  URL_PROPERTY:
    "INCENTIVE_BRIDGE_URL",

  SECRET_PROPERTY:
    "INCENTIVE_BRIDGE_SECRET"

};


/******************************************************
 * SETUP - RUN MANUALLY ONCE
 ******************************************************/
function configurePortalIncentiveBridge(){

  const ui =
    SpreadsheetApp.getUi();

  const urlResponse =
    ui.prompt(
      "Incentive Bridge",
      "Paste the Incentive Tracker bridge Web App /exec URL:",
      ui.ButtonSet.OK_CANCEL
    );

  if(
    urlResponse.getSelectedButton() !==
    ui.Button.OK
  ){
    return;
  }

  const url =
    String(
      urlResponse.getResponseText() || ""
    )
    .trim();

  if(
    !/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec(?:\?.*)?$/i
      .test(url)
  ){

    ui.alert(
      "That does not look like a deployed Apps Script /exec URL."
    );

    return;
  }

  const secretResponse =
    ui.prompt(
      "Incentive Bridge",
      "Paste the Incentive Bridge secret:",
      ui.ButtonSet.OK_CANCEL
    );

  if(
    secretResponse.getSelectedButton() !==
    ui.Button.OK
  ){
    return;
  }

  const secret =
    String(
      secretResponse.getResponseText() || ""
    )
    .trim();

  if(secret.length < 60){

    ui.alert(
      "The bridge secret is too short."
    );

    return;
  }

  const props =
    PropertiesService
      .getScriptProperties();

  props.setProperty(
    PORTAL_INCENTIVE_ADMIN.URL_PROPERTY,
    url
  );

  props.setProperty(
    PORTAL_INCENTIVE_ADMIN.SECRET_PROPERTY,
    secret
  );

  ui.alert(
    "Incentive Bridge configured.\n\n" +
    "Run testPortalIncentiveBridge next."
  );
}


function testPortalIncentiveBridge(){

  const result =
    PIA_callBridge_(
      "ping",
      {}
    );

  Logger.log(
    "========== INCENTIVE BRIDGE TEST =========="
  );

  Logger.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );

  Logger.log(
    "==========================================="
  );
}


/******************************************************
 * READ-ONLY: VERIFY BRIDGE IS ONLINE
 *
 * The direct execution context is tested in the private
 * project with PIB_testDirectScanContextReadOnly().
 ******************************************************/
function PIA_testPortalIncentiveBridgeReadOnly(){

  const startedAt =
    Date.now();

  const result =
    PIA_callBridge_(
      "ping",
      {}
    );

  const output = {
    ok:
      Boolean(
        result &&
        result.privateTrackerAvailable
      ),
    mode:
      "READ_ONLY_PORTAL_INCENTIVE_BRIDGE",
    elapsedMs:
      Date.now() -
      startedAt,
    service:
      result &&
      result.service
        ? result.service
        : "",
    privateTrackerAvailable:
      Boolean(
        result &&
        result.privateTrackerAvailable
      )
  };

  Logger.log(
    "========== PORTAL INCENTIVE BRIDGE READ ONLY =========="
  );

  Logger.log(
    JSON.stringify(
      output,
      null,
      2
    )
  );

  Logger.log(
    "======================================================="
  );

  return output;

}


/******************************************************
 * PUBLIC: START INCENTIVE SCAN
 ******************************************************/
function startPortalIncentiveScan(
  token,
  operationId
){

  const user =
    PO_requireAdmin_(token);


  const result =
    PIA_callBridge_(
      "scan",
      {
        operationId:
          String(
            operationId || ""
          )
      }
    );


  PO_appendAudit_({

    actorEmail:
      user.email,

    role:
      user.role,

    action:
      "Run Incentive Processing",

    targetType:
      "Incentive Engine",

    targetId:
      result.jobId || "",

    oldValue:
      "",

    newValue:
      result.status || "",

    handler:
      "",

    details:
      "Direct Incentive Scan + Recovery through private Incentive Bridge. " +
      "Elapsed ms: " +
      Number(
        result.elapsedMs || 0
      )

  });


  return {

    ok:
      result.status ===
        "Completed",

    job:
      result,

    message:
      result.status ===
        "Completed"
        ? (
            "Incentive Processing completed in " +
            Math.max(
              1,
              Math.round(
                Number(
                  result.elapsedMs || 0
                ) / 1000
              )
            ) +
            " sec."
          )
        : (
            result.error ||
            "Incentive Processing failed."
          )

  };

}



/******************************************************
 * PUBLIC: REAL INCENTIVE OPERATION PROGRESS
 ******************************************************/
function getPortalIncentiveOperationProgress(
  token,
  operationId
){

  PO_requireAdmin_(
    token
  );

  const progress =
    PIA_callBridge_(
      "progress",
      {
        operationId:
          String(
            operationId || ""
          )
      }
    );

  return {
    ok: true,
    progress: progress
  };
}


/******************************************************
 * PUBLIC: POLL INCENTIVE SCAN
 ******************************************************/
function getPortalIncentiveScanStatus(
  token,
  jobId
){

  PO_requireAdmin_(token);

  const result =
    PIA_callBridge_(
      "scanStatus",
      {
        jobId:
          String(
            jobId || ""
          ).trim()
      }
    );

  return {
    ok:
      true,
    job:
      result
  };
}


/******************************************************
 * PUBLIC: APPROVE + APPLY ONE RECOVERY
 ******************************************************/
function approveAndApplyPortalRecovery(
  token,
  recoveryId,
  operationId
){

  const user =
    PO_requireAdmin_(
      token
    );


  const result =
    PIA_callBridge_(
      "applyRecovery",
      {
        recoveryId:
          String(
            recoveryId || ""
          ).trim(),

        operationId:
          String(
            operationId || ""
          ).trim()
      }
    );


  PO_appendAudit_({

    actorEmail:
      user.email,

    role:
      user.role,

    action:
      "Approve + Apply Recovery Incentive",

    targetType:
      "Recovery",

    targetId:
      String(
        recoveryId || ""
      ).trim(),

    oldValue:
      "Pending",

    newValue:
      "Approved + Applied",

    handler:
      result.handler || "",

    details:
      (result.candidate || "") +
      " | ₹" +
      Number(
        result.amount || 0
      ) +
      " | ElapsedMs=" +
      Number(
        result.elapsedMs || 0
      )

  });


  return {

    ok:
      true,

    result:
      result,

    message:
      result.added > 0
        ? (
            "Recovery approved and added to the permanent incentive tracker in " +
            Math.max(
              1,
              Math.round(
                Number(
                  result.elapsedMs || 0
                ) / 1000
              )
            ) +
            " sec."
          )
        : "Recovery approved. The incentive already existed in the permanent tracker."

  };

}


/******************************************************
 * PUBLIC: APPROVE EXCEPTION AS INCENTIVE
 *
 * selectedHandler is required only when the exception
 * has multiple suggested handlers.
 ******************************************************/
function approveAndApplyPortalException(
  token,
  exceptionId,
  selectedHandler,
  operationId
){

  const user =
    PO_requireAdmin_(
      token
    );


  const result =
    PIA_callBridge_(
      "applyException",
      {
        exceptionId:
          String(
            exceptionId || ""
          ).trim(),

        handler:
          String(
            selectedHandler || ""
          ).trim(),

        operationId:
          String(
            operationId || ""
          ).trim()
      }
    );


  PO_appendAudit_({

    actorEmail:
      user.email,

    role:
      user.role,

    action:
      "Approve Exception Incentive",

    targetType:
      "Recovery Exception",

    targetId:
      String(
        exceptionId || ""
      ).trim(),

    oldValue:
      "Review",

    newValue:
      "Resolved + Applied",

    handler:
      result.handler || "",

    details:
      (result.candidate || "") +
      " | ₹" +
      Number(
        result.amount || 0
      ) +
      " | ElapsedMs=" +
      Number(
        result.elapsedMs || 0
      )

  });


  return {

    ok:
      true,

    result:
      result,

    message:
      result.added > 0
        ? "Exception approved and added as an incentive."
        : "Exception approved. The incentive already existed in the permanent tracker."

  };

}



/******************************************************
 * QUEUED RECOVERY / EXCEPTION STATUS-ONLY ACTIONS
 ******************************************************/
function queuePortalRecoveryStatusAction(
  token,
  recoveryId,
  status,
  operationId
){

  POR_setProgress_(
    operationId,
    15,
    "Updating Recovery",
    "Saving the Recovery status.",
    "Running"
  );


  try{

    const result =
      updatePortalRecoveryStatus(
        token,
        recoveryId,
        status
      );


    POR_setProgress_(
      operationId,
      100,
      "Recovery updated",
      "Recovery " +
      status +
      " successfully.",
      "Completed",
      {
        id:
          String(recoveryId || ""),
        status:
          String(status || "")
      }
    );


    return {
      ok: true,
      result: result,
      message:
        "Recovery " +
        status +
        " successfully."
    };

  }
  catch(error){

    POR_setProgress_(
      operationId,
      100,
      "Recovery update failed",
      error && error.message
        ? error.message
        : String(error),
      "Failed"
    );

    throw error;

  }

}


function queuePortalExceptionStatusAction(
  token,
  exceptionId,
  status,
  operationId
){

  POR_setProgress_(
    operationId,
    15,
    "Updating Recovery Exception",
    "Saving the exception review status.",
    "Running"
  );


  try{

    const result =
      updatePortalExceptionStatus(
        token,
        exceptionId,
        status
      );


    POR_setProgress_(
      operationId,
      100,
      "Recovery Exception updated",
      "Exception " +
      status +
      " successfully.",
      "Completed",
      {
        id:
          String(exceptionId || ""),
        status:
          String(status || "")
      }
    );


    return {
      ok: true,
      result: result,
      message:
        "Exception " +
        status +
        " successfully."
    };

  }
  catch(error){

    POR_setProgress_(
      operationId,
      100,
      "Exception update failed",
      error && error.message
        ? error.message
        : String(error),
      "Failed"
    );

    throw error;

  }

}


/******************************************************
 * PUBLIC: CATCH UP OLD APPROVED RECOVERIES
 ******************************************************/
function applyPortalApprovedRecoveries(
  token
){

  const user =
    PO_requireAdmin_(token);

  const result =
    PIA_callBridge_(
      "applyAllApproved",
      {}
    );

  PO_appendAudit_({

    actorEmail:
      user.email,

    role:
      user.role,

    action:
      "Apply Approved Recoveries",

    targetType:
      "Recovery",

    targetId:
      "ALL_APPROVED",

    oldValue:
      "",

    newValue:
      String(
        result.applied || 0
      ) +
      " confirmed",

    handler:
      "",

    details:
      "Approved rows checked: " +
      Number(
        result.totalApproved || 0
      )

  });

  return {

    ok:
      true,

    result:
      result,

    message:
      "Approved recoveries checked: " +
      Number(
        result.totalApproved || 0
      ) +
      ". Confirmed/applied: " +
      Number(
        result.applied || 0
      ) +
      "."

  };
}


/******************************************************
 * PRIVATE: BRIDGE CALL
 ******************************************************/
function PIA_callBridge_(
  command,
  payload
){

  let bridge;

  if(typeof PTR_incentiveBridgeConfig_ === "function"){
    bridge = PTR_incentiveBridgeConfig_();
  }else{
    const props = PropertiesService.getScriptProperties();
    bridge = {
      url: String(props.getProperty(PORTAL_INCENTIVE_ADMIN.URL_PROPERTY) || "").trim(),
      secret: String(props.getProperty(PORTAL_INCENTIVE_ADMIN.SECRET_PROPERTY) || "").trim()
    };
  }

  const url = bridge.url;
  const secret = bridge.secret;

  if(!url || !secret){
    throw new Error(
      "INCENTIVE_BRIDGE_NOT_CONFIGURED"
    );
  }

  const body = {
    secret:
      secret,
    command:
      command,
    payload:
      payload || {},
    requestId:
      Utilities.getUuid()
  };

  const response =
    UrlFetchApp.fetch(
      url,
      {
        method:
          "post",
        contentType:
          "application/json",
        payload:
          JSON.stringify(
            body
          ),
        muteHttpExceptions:
          true,
        followRedirects:
          true
      }
    );

  const text =
    response.getContentText();

  let parsed;

  try{
    parsed =
      JSON.parse(
        text
      );
  }
  catch(error){
    throw new Error(
      "INCENTIVE_BRIDGE_BAD_RESPONSE"
    );
  }

  if(
    !parsed ||
    parsed.ok !== true
  ){

    throw new Error(
      parsed &&
      parsed.error
        ? parsed.error
        : "INCENTIVE_BRIDGE_REQUEST_FAILED"
    );
  }

  return parsed.data || {};
}
