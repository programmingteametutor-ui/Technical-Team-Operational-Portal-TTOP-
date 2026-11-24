/***************************************************************
 * PORTALSCHEDULERADMIN.GS - FAST + PROGRESS v3.0
 * Interview Portal Control -> Call Scheduler Bridge
 *
 * Install in the INTERVIEW PORTAL CONTROL Apps Script project.
 *
 * Security:
 * - Every browser-call validates the secure portal OTP session.
 * - Every scheduler-control function is ADMIN ONLY.
 * - The bridge URL and secret are stored only in Script Properties.
 * - They are never sent to the browser.
 ***************************************************************/

const PORTAL_SCHEDULER_ADMIN = {

  URL_PROPERTY:
    "CALL_SCHEDULER_BRIDGE_URL",

  SECRET_PROPERTY:
    "CALL_SCHEDULER_BRIDGE_SECRET"

};


/***************************************************************
 * SETUP - RUN MANUALLY ONCE IN INTERVIEW PORTAL CONTROL
 ***************************************************************/
function configurePortalSchedulerBridge(){

  const ui =
    SpreadsheetApp.getUi();

  const urlResponse =
    ui.prompt(
      "Call Scheduler Bridge",
      "Paste the Call Tracker bridge Web App /exec URL:",
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
      "Call Scheduler Bridge",
      "Paste the bridge secret generated in the Call Tracker project:",
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
      "The bridge secret is too short. Run setupPortalSchedulerBridgeSecret in the Call Tracker project again."
    );
    return;
  }

  const props =
    PropertiesService
      .getScriptProperties();

  props.setProperty(
    PORTAL_SCHEDULER_ADMIN.URL_PROPERTY,
    url
  );

  props.setProperty(
    PORTAL_SCHEDULER_ADMIN.SECRET_PROPERTY,
    secret
  );

  ui.alert(
    "Call Scheduler Bridge configured.\n\n" +
    "Run testPortalSchedulerBridge next."
  );
}


/**
 * Safe manual connection test.
 */
function testPortalSchedulerBridge(){

  const result =
    PSA_callBridge_(
      "state",
      {}
    );

  Logger.log(
    "========== PORTAL SCHEDULER BRIDGE TEST =========="
  );

  Logger.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );

  Logger.log(
    "=================================================="
  );
}


/***************************************************************
 * PUBLIC - ADMIN STATE
 ***************************************************************/
function getPortalSchedulerAdminState(token){

  // Read-only scheduler state is safe in Super Admin Test-As mode.
  // Mutating scheduler functions still use PSA_requireAdmin_() and
  // therefore continue to reject TEST_VIEW_READ_ONLY.
  const user =
    PSA_requireAdminReadOnly_(
      token
    );

  const data =
    PSA_callBridge_(
      "state",
      {}
    );

  return {
    ok: true,
    user: {
      email: user.email,
      role: user.role,
      accessRole: user.accessRole || "",
      testViewActive: user.testViewActive === true,
      readOnlyTest: user.readOnlyTest === true
    },
    readOnly: (
      user.testViewActive === true ||
      user.readOnlyTest === true
    ),
    state: data
  };
}


/***************************************************************
 * PUBLIC - SET LEAVE
 ***************************************************************/
function portalSchedulerSetLeave(
  token,
  onLeave
){

  const user =
    PSA_requireAdmin_(
      token
    );

  const list =
    Array.isArray(onLeave)
      ? onLeave
      : [];

  const result =
    PSA_callBridge_(
      "setLeave",
      {
        onLeave: list
      }
    );

  PSA_audit_(
    user,
    "CALL_SCHEDULER_SET_LEAVE",
    result.workingDate || "",
    "",
    (result.onLeave || []).join(", "),
    "",
    "Portal scheduler leave configuration"
  );

  return {
    ok: true,
    message:
      "Today's leave saved: " +
      (
        result.onLeave &&
        result.onLeave.length
          ? result.onLeave.join(", ")
          : "Nobody"
      ),
    result: result
  };
}


/***************************************************************
 * PUBLIC - EXTRACT TODAY
 ***************************************************************/
function portalSchedulerExtractToday(
  token,
  operationId
){

  const user =
    PSA_requireAdmin_(
      token
    );

  const started =
    Date.now();

  const result =
    PSA_callBridge_(
      "extractToday",
      {
        operationId:
          String(
            operationId || ""
          )
      }
    );

  PSA_audit_(
    user,
    "CALL_SCHEDULER_EXTRACT",
    result.workingDate || "",
    "",
    String(result.matched || 0),
    "",
    "Matched=" + (result.matched || 0) +
    " | Unmatched=" + (result.unmatched || 0) +
    " | ElapsedMs=" + (result.elapsedMs || (Date.now()-started))
  );

  return {
    ok: true,
    message:
      "Extraction completed. Matched " +
      (result.matched || 0) +
      ", unmatched " +
      (result.unmatched || 0) +
      ".",
    result: result
  };
}


/***************************************************************
 * PUBLIC - INITIAL AUTO ASSIGN
 ***************************************************************/
function portalSchedulerAutoAssign(
  token,
  operationId
){

  const user =
    PSA_requireAdmin_(
      token
    );

  const result =
    PSA_callBridge_(
      "autoAssign",
      {
        operationId:
          String(
            operationId || ""
          )
      }
    );

  PSA_audit_(
    user,
    "CALL_SCHEDULER_AUTO_ASSIGN",
    result.workingDate || "",
    "",
    String(result.assigned || 0),
    "",
    "Initial auto assignment | ElapsedMs=" +
    (result.elapsedMs || 0)
  );

  return {
    ok: true,
    message:
      "Initial auto assignment completed. " +
      (result.assigned || 0) +
      " of " +
      (result.total || 0) +
      " extracted calls assigned.",
    result: result
  };
}


/***************************************************************
 * PUBLIC - ASSIGN NEW
 ***************************************************************/
function portalSchedulerAssignNew(
  token,
  operationId
){

  const user =
    PSA_requireAdmin_(
      token
    );

  const result =
    PSA_callBridge_(
      "assignNew",
      {
        operationId:
          String(
            operationId || ""
          )
      }
    );

  PSA_audit_(
    user,
    "CALL_SCHEDULER_ASSIGN_NEW",
    "",
    "",
    String(result.assigned || 0),
    "",
    "Existing locked=" + (result.existing || 0) +
    " | New pending=" + (result.pending || 0) +
    " | New assigned=" + (result.assigned || 0) +
    " | Still unassigned=" + (result.unassigned || 0) +
    " | ElapsedMs=" + (result.elapsedMs || 0)
  );

  return {
    ok: true,
    message:
      "New-interview assignment completed. " +
      (result.assigned || 0) +
      " assigned; " +
      (result.unassigned || 0) +
      " still unassigned.",
    result: result
  };
}



/***************************************************************
 * PUBLIC - LONG OPERATION PROGRESS
 ***************************************************************/
function getPortalSchedulerOperationProgress(
  token,
  operationId
){

  PSA_requireAdmin_(
    token
  );

  const progress =
    PSA_callBridge_(
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


/***************************************************************
 * PUBLIC - REASSIGNMENT OPTIONS
 ***************************************************************/
function getPortalSchedulerReassignOptions(
  token,
  callId
){

  PSA_requireAdmin_(
    token
  );

  const target =
    PSA_requireLatestScheduledCall_(
      callId
    );

  const result =
    PSA_callBridge_(
      "reassignOptions",
      {
        sourceRow:
          target.sourceRow
      }
    );

  return {
    ok: true,
    callId: target.callId,
    candidate: target.candidate,
    currentHandler: result.currentHandler,
    suggestedHandler: result.suggestedHandler,
    options: result.options || [],
    time: result.time || target.time,
    client: target.client
  };
}


/***************************************************************
 * PUBLIC - APPLY REASSIGNMENT
 ***************************************************************/
function portalSchedulerReassignCall(
  token,
  callId,
  newHandler
){

  const user =
    PSA_requireAdmin_(
      token
    );

  const target =
    PSA_requireLatestScheduledCall_(
      callId
    );

  const requested =
    String(newHandler || "")
      .trim();

  if(!requested){
    throw new Error(
      "Choose a handler."
    );
  }

  const result =
    PSA_callBridge_(
      "reassign",
      {
        sourceRow:
          target.sourceRow,
        handler:
          requested
      }
    );

  PSA_audit_(
    user,
    "CALL_SCHEDULER_REASSIGN",
    target.callId,
    result.oldHandler || target.handler,
    result.newHandler || requested,
    result.newHandler || requested,
    (
      target.candidate || target.originalText || ""
    ) +
    " | " +
    (
      target.time || ""
    )
  );

  return {
    ok: true,
    message:
      (target.candidate || "Call") +
      " reassigned from " +
      (result.oldHandler || target.handler || "Unassigned") +
      " to " +
      (result.newHandler || requested) +
      ".",
    result: result
  };
}


/***************************************************************
 * SECURITY — READ-ONLY ADMIN ACCESS
 *
 * Allows real Admin/Super Admin and Super Admin Test-As Admin
 * to READ scheduler state. It never authorizes a write.
 ***************************************************************/
function PSA_requireAdminReadOnly_(token){

  const auth =
    PA_validateSession_(
      token
    );

  if(!auth.ok){
    throw new Error(
      "SESSION_EXPIRED"
    );
  }

  const user = auth.user || {};
  const access = auth.accessContext || {};
  const effective = access.effective || {};
  const accessRole = String(
    user.accessRole ||
    effective.accessRole ||
    access.currentRole ||
    ""
  ).trim().toUpperCase();

  if(
    accessRole !== "SUPER_ADMIN" &&
    accessRole !== "ADMIN" &&
    user.role !== "Admin" &&
    user.role !== "TeamAdmin"
  ){
    throw new Error(
      "ADMIN_ONLY"
    );
  }

  // Preserve the read-only flags on the returned compatibility user so
  // the browser can render an accurate Test-As read-only state.
  user.testViewActive =
    user.testViewActive === true ||
    access.testViewActive === true;

  user.readOnlyTest =
    user.readOnlyTest === true ||
    access.readOnlyTest === true;

  return user;
}


/***************************************************************
 * SECURITY — WRITABLE ADMIN ACCESS
 ***************************************************************/
function PSA_requireAdmin_(token){

  const auth =
    PA_validateSession_(
      token
    );

  if(!auth.ok){
    throw new Error(
      "SESSION_EXPIRED"
    );
  }

  const user = auth.user || {};
  const access = auth.accessContext || {};
  const accessRole = String(
    user.accessRole ||
    access.currentRole ||
    ""
  ).trim().toUpperCase();

  if(
    user.readOnlyTest === true ||
    user.testViewActive === true ||
    access.readOnlyTest === true ||
    access.testViewActive === true
  ){
    throw new Error(
      "TEST_VIEW_READ_ONLY"
    );
  }

  if(
    accessRole !== "SUPER_ADMIN" &&
    accessRole !== "ADMIN" &&
    user.role !== "Admin"
  ){
    throw new Error(
      "ADMIN_ONLY"
    );
  }

  return user;
}


/**
 * Ensures operational scheduler controls can only mutate the LATEST
 * date block, never a historical schedule.
 */
function PSA_requireLatestScheduledCall_(callId){

  const latest =
    PC_loadScheduleByDateKey_(
      ""
    );

  const id =
    String(callId || "")
      .trim();

  const target =
    latest.calls.find(
      function(call){
        return call.callId === id;
      }
    );

  if(!target){
    throw new Error(
      "SCHEDULER_CONTROL_LATEST_DATE_ONLY"
    );
  }

  const statusMap =
    PC_loadStatusMap_();

  const statusEntry =
    statusMap.byId[target.callId] ||
    statusMap.byFallback[
      PC_statusFallbackKey_(
        target
      )
    ] ||
    null;

  const status =
    statusEntry
      ? PC_normalizeStatus_(
          statusEntry.status
        )
      : "Scheduled";

  if(status !== "Scheduled"){
    throw new Error(
      "RESET_CALL_STATUS_BEFORE_REASSIGNING"
    );
  }

  if(!target.handler){
    throw new Error(
      "UNASSIGNED_CALL_USE_ASSIGN_NEW"
    );
  }

  return target;
}


/***************************************************************
 * BRIDGE CALL
 ***************************************************************/
function PSA_callBridge_(
  command,
  payload
){

  let bridge;

  if(typeof PTR_schedulerBridgeConfig_ === "function"){
    bridge = PTR_schedulerBridgeConfig_();
  }else{
    const props = PropertiesService.getScriptProperties();
    bridge = {
      url: String(props.getProperty(PORTAL_SCHEDULER_ADMIN.URL_PROPERTY) || "").trim(),
      secret: String(props.getProperty(PORTAL_SCHEDULER_ADMIN.SECRET_PROPERTY) || "").trim()
    };
  }

  const url = bridge.url;
  const secret = bridge.secret;

  if(!url || !secret){
    throw new Error(
      "SCHEDULER_BRIDGE_NOT_CONFIGURED"
    );
  }

  const body = {
    secret: secret,
    command: command,
    payload: payload || {},
    requestId:
      Utilities.getUuid()
  };

  const response =
    UrlFetchApp.fetch(
      url,
      {
        method: "post",
        contentType: "application/json",
        payload:
          JSON.stringify(body),
        muteHttpExceptions: true,
        followRedirects: true
      }
    );

  const text =
    response.getContentText();

  let parsed;

  try{
    parsed =
      JSON.parse(text);
  }
  catch(err){
    throw new Error(
      "SCHEDULER_BRIDGE_BAD_RESPONSE"
    );
  }

  if(
    !parsed ||
    parsed.ok !== true
  ){

    throw new Error(
      parsed && parsed.error
        ? parsed.error
        : "SCHEDULER_BRIDGE_REQUEST_FAILED"
    );
  }

  return parsed.data || {};
}


/***************************************************************
 * AUDIT
 ***************************************************************/
function PSA_audit_(
  user,
  action,
  targetId,
  oldValue,
  newValue,
  handler,
  details
){

  if(
    typeof PO_appendAudit_ !==
    "function"
  ){
    return;
  }

  PO_appendAudit_({
    actorEmail: user.email,
    role: user.role,
    action: action,
    targetType:
      "Call Scheduler",
    targetId:
      String(targetId || ""),
    oldValue:
      String(oldValue || ""),
    newValue:
      String(newValue || ""),
    handler:
      String(handler || ""),
    details:
      String(details || "")
  });
}


/***************************************************************
 * READ-ONLY HYD SCHEDULER BRIDGE DIAGNOSTIC
 *
 * Manual editor test. Does not change schedule data and never
 * logs the bridge secret. It proves whether the configured HYD
 * /exec URL returns bridge JSON or an HTML/login/error page.
 ***************************************************************/
function PSA_testHydSchedulerBridgeReadOnly(){

  const props = PropertiesService.getScriptProperties();
  const urlKey =
    typeof PORTAL_TEAM_ROUTER !== "undefined"
      ? PORTAL_TEAM_ROUTER.PROPERTIES.HYD_SCHEDULER_URL
      : "PORTAL_TEAM_HYD_SCHEDULER_BRIDGE_URL";
  const secretKey =
    typeof PORTAL_TEAM_ROUTER !== "undefined"
      ? PORTAL_TEAM_ROUTER.PROPERTIES.HYD_SCHEDULER_SECRET
      : "PORTAL_TEAM_HYD_SCHEDULER_BRIDGE_SECRET";

  const url = String(props.getProperty(urlKey) || "").trim();
  const secret = String(props.getProperty(secretKey) || "").trim();

  const result = {
    ok: false,
    team: "HYD",
    urlConfigured: !!url,
    secretConfigured: !!secret,
    urlLooksExec: /^https:\/\/script\.google\.com\/macros\/s\/.+\/exec(?:\?.*)?$/i.test(url),
    httpCode: 0,
    contentType: "",
    jsonParsed: false,
    bridgeOk: false,
    bridgeError: "",
    responsePreview: ""
  };

  if(!url || !secret){
    result.bridgeError = "HYD_SCHEDULER_BRIDGE_NOT_CONFIGURED";
    Logger.log("========== HYD SCHEDULER BRIDGE DIAGNOSTIC ==========");
    Logger.log(JSON.stringify(result,null,2));
    Logger.log("=====================================================");
    return result;
  }

  const response = UrlFetchApp.fetch(url,{
    method:"post",
    contentType:"application/json",
    payload:JSON.stringify({
      secret:secret,
      command:"state",
      payload:{},
      requestId:Utilities.getUuid()
    }),
    muteHttpExceptions:true,
    followRedirects:true
  });

  result.httpCode = Number(response.getResponseCode() || 0);
  const headers = response.getHeaders ? response.getHeaders() : {};
  result.contentType = String(
    headers["Content-Type"] ||
    headers["content-type"] ||
    ""
  );

  const text = String(response.getContentText() || "");
  result.responsePreview = text
    .replace(/\s+/g," ")
    .trim()
    .substring(0,240);

  try{
    const parsed = JSON.parse(text);
    result.jsonParsed = true;
    result.bridgeOk = !!(parsed && parsed.ok === true);
    result.bridgeError = parsed && parsed.error
      ? String(parsed.error)
      : "";
    result.bridgeData = parsed && parsed.data
      ? parsed.data
      : null;
  }catch(error){
    result.bridgeError = "SCHEDULER_BRIDGE_BAD_RESPONSE";
  }

  result.ok =
    result.httpCode >= 200 &&
    result.httpCode < 300 &&
    result.jsonParsed === true &&
    result.bridgeOk === true;

  Logger.log("========== HYD SCHEDULER BRIDGE DIAGNOSTIC ==========");
  Logger.log(JSON.stringify(result,null,2));
  Logger.log("=====================================================");
  return result;
}
