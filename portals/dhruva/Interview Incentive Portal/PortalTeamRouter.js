/******************************************************
 * PORTALTEAMROUTER.GS
 * Interview Operations Portal - Multi-Team Runtime
 * Version 1.0.0
 *
 * Central team routing for the Interview Portal Control
 * Apps Script project.
 *
 * Goals:
 * - Preserve existing Pradeep production behavior.
 * - Route TEAM-HYD to HYD workbooks/bridges when configured.
 * - Register Developer Team in the portal now, but fail closed
 *   with a clear NOT_CONNECTED state until its workbooks exist.
 * - Keep Current Role and Team View as separate concepts.
 * - Never fall back to another team's operational data.
 ******************************************************/

const PORTAL_TEAM_ROUTER = Object.freeze({
  VERSION: "PORTAL-TEAM-ROUTER-1.1.0",

  VIEW_PREFIX: "PORTAL_TEAM_VIEW_",

  TEAM_CODES: Object.freeze({
    ALL: "ALL",
    PRADEEP: "PRADEEP",
    HYD: "HYD",
    DEV: "DEV",
    UNASSIGNED: "UNASSIGNED"
  }),

  TEAM_LABELS: Object.freeze({
    ALL: "All Teams",
    PRADEEP: "Pradeep Anna Team",
    HYD: "Hyderabad Team",
    DEV: "Developer Team",
    UNASSIGNED: "Team Not Assigned"
  }),

  // Existing production routing recovered from the supplied snapshot.
  LEGACY: Object.freeze({
    CALL_TRACKER_ID: "1BD_XIhQW6d4w4dnrcM17wYgv6hZqdx7mTsAIYgUOC7M",
    OPERATIONS_ID: "1UudfZfeBBkEwBQeWUwx77R4gl26wYZ1rKKZWCM_SHq4",
    PRIVATE_BACKEND_ID: "1Q5pRPoLsSjfxuRfEUZW2zZqrURYPzzbbPO6_8r9CLCk"
  }),

  PROPERTIES: Object.freeze({
    HYD_OPERATIONS_ID: "PORTAL_TEAM_HYD_OPERATIONS_ID",
    HYD_PRIVATE_ID: "PORTAL_TEAM_HYD_PRIVATE_ID",
    HYD_SCHEDULER_URL: "PORTAL_TEAM_HYD_SCHEDULER_BRIDGE_URL",
    HYD_SCHEDULER_SECRET: "PORTAL_TEAM_HYD_SCHEDULER_BRIDGE_SECRET",
    HYD_INCENTIVE_URL: "PORTAL_TEAM_HYD_INCENTIVE_BRIDGE_URL",
    HYD_INCENTIVE_SECRET: "PORTAL_TEAM_HYD_INCENTIVE_BRIDGE_SECRET"
  })
});

// Execution-scoped only. Apps Script creates a fresh execution context
// for each server call, so this never persists between requests.
let PTR_EXECUTION_TEAM_CODE_ = "";
let PTR_EXECUTION_CONTEXT_ = null;


/******************************************************
 * AUTH HOOK
 * Called by PA_validateSession_ after the normal access model
 * resolves Current Role / effective identity.
 ******************************************************/
function PTR_applySessionTeamContext_(authResult, token){

  if(!authResult || authResult.ok !== true){
    return authResult;
  }

  const access = authResult.accessContext || {};
  const user = authResult.user || {};
  const effective = access.effective || {};
  const currentRole = String(
    access.currentRole ||
    user.accessRole ||
    ""
  ).toUpperCase();

  let selectedCode = "";
  let source = "ROLE_TEAM";

  // Super Admin Team View is only used while operating as the real
  // SUPER_ADMIN. Test-As and other Current Roles use their resolved team.
  if(
    currentRole === "SUPER_ADMIN" &&
    access.testViewActive !== true
  ){
    selectedCode = PTR_readTeamView_(token) || PORTAL_TEAM_ROUTER.TEAM_CODES.ALL;
    source = "SUPER_ADMIN_TEAM_VIEW";
  }else{
    selectedCode = PTR_teamCodeForIdentity_(
      user.primaryTeamId || effective.primaryTeamId || "",
      user.teamName || effective.teamName || ""
    );
  }

  if(!selectedCode){
    selectedCode = PORTAL_TEAM_ROUTER.TEAM_CODES.UNASSIGNED;
  }

  const context = PTR_buildTeamContext_(selectedCode, currentRole, source);

  PTR_EXECUTION_TEAM_CODE_ = context.selectedCode;
  PTR_EXECUTION_CONTEXT_ = context;

  authResult.teamContext = context;

  // Safe public fields useful to existing modules without changing their
  // legacy role checks.
  authResult.user.teamCode = context.selectedCode;
  authResult.user.teamView = context.selectedCode;
  authResult.user.teamOperationalStatus = context.status;

  return authResult;
}


/******************************************************
 * PUBLIC TEAM VIEW API
 ******************************************************/
function getPortalTeamViewContext(token){
  const auth = PA_validateSession_(token);
  if(!auth.ok){
    throw new Error("SESSION_EXPIRED");
  }
  return {
    ok: true,
    teamContext: auth.teamContext || PTR_EXECUTION_CONTEXT_ || null
  };
}


function setPortalTeamView(token, requestedTeamCode){

  const auth = PA_validateSession_(token);

  if(!auth.ok){
    throw new Error("SESSION_EXPIRED");
  }

  const access = auth.accessContext || {};

  if(
    String(access.currentRole || "").toUpperCase() !== "SUPER_ADMIN" ||
    access.testViewActive === true
  ){
    throw new Error("SUPER_ADMIN_TEAM_VIEW_REQUIRED");
  }

  const code = PTR_normalizeTeamCode_(requestedTeamCode);

  if([
    PORTAL_TEAM_ROUTER.TEAM_CODES.ALL,
    PORTAL_TEAM_ROUTER.TEAM_CODES.PRADEEP,
    PORTAL_TEAM_ROUTER.TEAM_CODES.HYD,
    PORTAL_TEAM_ROUTER.TEAM_CODES.DEV
  ].indexOf(code) === -1){
    throw new Error("INVALID_PORTAL_TEAM_VIEW");
  }

  PropertiesService
    .getScriptProperties()
    .setProperty(
      PORTAL_TEAM_ROUTER.VIEW_PREFIX + String(token || "").trim(),
      code
    );

  // Re-read access context after the selection has been stored.
  return getPortalAccessContext(token);
}


/******************************************************
 * TEAM CONTEXT BUILDERS
 ******************************************************/
function PTR_buildTeamContext_(selectedCode, currentRole, source){

  const code = PTR_normalizeTeamCode_(selectedCode) || PORTAL_TEAM_ROUTER.TEAM_CODES.UNASSIGNED;
  const runtime = PTR_runtimeForCode_(code);
  const options = PTR_teamViewOptions_();

  const connected = runtime.connected === true;
  const aggregate = code === PORTAL_TEAM_ROUTER.TEAM_CODES.ALL;

  return {
    version: PORTAL_TEAM_ROUTER.VERSION,
    selectedCode: code,
    selectedTeamId: runtime.teamId || "",
    selectedLabel: runtime.label || PORTAL_TEAM_ROUTER.TEAM_LABELS[code] || code,
    status: runtime.status,
    connected: connected,
    aggregate: aggregate,
    source: source || "",
    currentRole: currentRole || "",
    message: runtime.message || "",
    schedulerConnected: runtime.schedulerConnected === true,
    incentiveConnected: runtime.incentiveConnected === true,
    options: options
  };
}


function PTR_teamViewOptions_(){
  return [
    PTR_publicRuntime_(PTR_runtimeForCode_("ALL")),
    PTR_publicRuntime_(PTR_runtimeForCode_("PRADEEP")),
    PTR_publicRuntime_(PTR_runtimeForCode_("HYD")),
    PTR_publicRuntime_(PTR_runtimeForCode_("DEV"))
  ];
}


function PTR_publicRuntime_(runtime){
  return {
    code: runtime.code,
    teamId: runtime.teamId || "",
    label: runtime.label,
    status: runtime.status,
    connected: runtime.connected === true,
    aggregate: runtime.code === "ALL",
    schedulerConnected: runtime.schedulerConnected === true,
    incentiveConnected: runtime.incentiveConnected === true,
    message: runtime.message || ""
  };
}


function PTR_runtimeForCode_(teamCode){

  const code = PTR_normalizeTeamCode_(teamCode);
  const props = PropertiesService.getScriptProperties();

  if(code === "ALL"){
    return {
      code: "ALL",
      teamId: "",
      label: "All Teams",
      status: "AGGREGATE",
      connected: true,
      schedulerConnected: false,
      incentiveConnected: false,
      message: "Dashboard incentive and call-operation data combine connected teams. Choose a specific team for write operations, recovery, interviews and reports."
    };
  }

  if(code === "PRADEEP"){
    const schedulerUrl = String(props.getProperty("CALL_SCHEDULER_BRIDGE_URL") || "").trim();
    const schedulerSecret = String(props.getProperty("CALL_SCHEDULER_BRIDGE_SECRET") || "").trim();
    const incentiveUrl = String(props.getProperty("INCENTIVE_BRIDGE_URL") || "").trim();
    const incentiveSecret = String(props.getProperty("INCENTIVE_BRIDGE_SECRET") || "").trim();

    return {
      code: "PRADEEP",
      teamId: PTR_findActualTeamId_("PRADEEP"),
      label: "Pradeep Anna Team",
      status: "CONNECTED",
      connected: true,
      schedulerConnected: !!schedulerUrl && !!schedulerSecret,
      incentiveConnected: !!incentiveUrl && !!incentiveSecret,
      callTrackerId: PORTAL_TEAM_ROUTER.LEGACY.CALL_TRACKER_ID,
      operationsId: PORTAL_TEAM_ROUTER.LEGACY.OPERATIONS_ID,
      privateBackendId: PORTAL_TEAM_ROUTER.LEGACY.PRIVATE_BACKEND_ID,
      callSheet: "InterviewBot 2026",
      rawSheet: "Raw Data",
      teamSheet: "Team Data",
      trackerSheet: "Incentive Tracker",
      schedulerUrlProperty: "CALL_SCHEDULER_BRIDGE_URL",
      schedulerSecretProperty: "CALL_SCHEDULER_BRIDGE_SECRET",
      incentiveUrlProperty: "INCENTIVE_BRIDGE_URL",
      incentiveSecretProperty: "INCENTIVE_BRIDGE_SECRET",
      message: "Connected"
    };
  }

  if(code === "HYD"){
    const operationsId = String(props.getProperty(PORTAL_TEAM_ROUTER.PROPERTIES.HYD_OPERATIONS_ID) || "").trim();
    const privateId = String(props.getProperty(PORTAL_TEAM_ROUTER.PROPERTIES.HYD_PRIVATE_ID) || "").trim();
    const schedulerUrl = String(props.getProperty(PORTAL_TEAM_ROUTER.PROPERTIES.HYD_SCHEDULER_URL) || "").trim();
    const schedulerSecret = String(props.getProperty(PORTAL_TEAM_ROUTER.PROPERTIES.HYD_SCHEDULER_SECRET) || "").trim();
    const incentiveUrl = String(props.getProperty(PORTAL_TEAM_ROUTER.PROPERTIES.HYD_INCENTIVE_URL) || "").trim();
    const incentiveSecret = String(props.getProperty(PORTAL_TEAM_ROUTER.PROPERTIES.HYD_INCENTIVE_SECRET) || "").trim();

    const workbookConnected = !!operationsId && !!privateId;

    return {
      code: "HYD",
      teamId: PTR_findActualTeamId_("HYD") || "TEAM-HYD",
      label: "Hyderabad Team",
      status: workbookConnected ? "CONNECTED" : "NOT_CONNECTED",
      connected: workbookConnected,
      schedulerConnected: workbookConnected && !!schedulerUrl && !!schedulerSecret,
      incentiveConnected: workbookConnected && !!incentiveUrl && !!incentiveSecret,
      callTrackerId: operationsId,
      operationsId: operationsId,
      privateBackendId: privateId,
      callSheet: "HYD Interview Bot 2026",
      rawSheet: "HYD Raw Data",
      teamSheet: "HYD Team Data",
      trackerSheet: "Incentive Tracker",
      schedulerUrlProperty: PORTAL_TEAM_ROUTER.PROPERTIES.HYD_SCHEDULER_URL,
      schedulerSecretProperty: PORTAL_TEAM_ROUTER.PROPERTIES.HYD_SCHEDULER_SECRET,
      incentiveUrlProperty: PORTAL_TEAM_ROUTER.PROPERTIES.HYD_INCENTIVE_URL,
      incentiveSecretProperty: PORTAL_TEAM_ROUTER.PROPERTIES.HYD_INCENTIVE_SECRET,
      message: workbookConnected
        ? "Connected"
        : "Hyderabad Team operational setup is not yet connected in Interview Portal Control. Configure the HYD workbook IDs first."
    };
  }

  if(code === "DEV"){
    return {
      code: "DEV",
      teamId: PTR_findActualTeamId_("DEV") || "TEAM-DEV",
      label: "Developer Team",
      status: "NOT_CONNECTED",
      connected: false,
      schedulerConnected: false,
      incentiveConnected: false,
      callTrackerId: "",
      operationsId: "",
      privateBackendId: "",
      callSheet: "Dev Interview Bot 2026",
      rawSheet: "Dev Raw Data",
      teamSheet: "Dev Team Data",
      trackerSheet: "Incentive Tracker",
      message: "Developer Team operational setup is not yet connected. Interview scheduling, call operations, incentives and recovery will become available after the Developer Team workbooks are configured."
    };
  }

  return {
    code: "UNASSIGNED",
    teamId: "",
    label: "Team Not Assigned",
    status: "NOT_CONNECTED",
    connected: false,
    schedulerConnected: false,
    incentiveConnected: false,
    callTrackerId: "",
    operationsId: "",
    privateBackendId: "",
    callSheet: "",
    rawSheet: "",
    teamSheet: "",
    trackerSheet: "Incentive Tracker",
    message: "No operational team is assigned to this role. Ask a Super Admin to assign the correct team."
  };
}


/******************************************************
 * TEAM MAPPING
 ******************************************************/
function PTR_teamCodeForIdentity_(teamId, teamName){

  const id = String(teamId || "").trim().toUpperCase();
  const name = String(teamName || "").trim().toLowerCase();

  if(id === "TEAM-HYD" || name.indexOf("hyderabad") !== -1){
    return "HYD";
  }

  if(
    id === "TEAM-DEV" ||
    name.indexOf("developer") !== -1 ||
    name.indexOf("technical support") !== -1
  ){
    return "DEV";
  }

  if(
    id === "TEAM-PRADEEP" ||
    id === "TEAM-PRD" ||
    name.indexOf("pradeep") !== -1
  ){
    return "PRADEEP";
  }

  return "";
}


function PTR_normalizeTeamCode_(value){
  const key = String(value || "").trim().toUpperCase();

  if(key === "ALL" || key === "ALL_TEAMS") return "ALL";
  if(key === "PRADEEP" || key === "TEAM-PRADEEP" || key === "TEAM-PRD") return "PRADEEP";
  if(key === "HYD" || key === "TEAM-HYD" || key === "HYDERABAD") return "HYD";
  if(key === "DEV" || key === "TEAM-DEV" || key === "DEVELOPER") return "DEV";
  if(key === "UNASSIGNED") return "UNASSIGNED";

  // Team-master IDs that do not use the expected canonical ID can still
  // resolve by their Team Name.
  try{
    const teamName = typeof PAC_teamName_ === "function" ? PAC_teamName_(value) : "";
    return PTR_teamCodeForIdentity_(value, teamName) || key;
  }catch(error){
    return key;
  }
}


function PTR_findActualTeamId_(code){
  try{
    if(typeof PAC_teamOptions_ !== "function") return "";
    const teams = PAC_teamOptions_();
    for(let i=0;i<teams.length;i++){
      if(PTR_teamCodeForIdentity_(teams[i].id, teams[i].name) === code){
        return String(teams[i].id || "").trim();
      }
    }
  }catch(error){
    // Team Master may not be initialized yet. Canonical fallbacks are used.
  }
  return "";
}


function PTR_readTeamView_(token){
  return String(
    PropertiesService
      .getScriptProperties()
      .getProperty(
        PORTAL_TEAM_ROUTER.VIEW_PREFIX + String(token || "").trim()
      ) || ""
  ).trim().toUpperCase();
}


/******************************************************
 * EXECUTION RUNTIME
 ******************************************************/
function PTR_currentTeamCode_(){
  return PTR_EXECUTION_TEAM_CODE_ || "PRADEEP";
}


function PTR_currentContext_(){
  if(PTR_EXECUTION_CONTEXT_){
    return PTR_EXECUTION_CONTEXT_;
  }
  return PTR_buildTeamContext_("PRADEEP", "", "LEGACY_DEFAULT");
}


function PTR_currentRuntime_(){
  return PTR_runtimeForCode_(PTR_currentTeamCode_());
}


function PTR_requireSpecificConnectedRuntime_(purpose){
  const runtime = PTR_currentRuntime_();

  if(runtime.code === "ALL"){
    throw new Error(
      "TEAM_VIEW_REQUIRES_SPECIFIC_TEAM|" +
      String(purpose || "This operation")
    );
  }

  if(runtime.connected !== true){
    throw new Error(
      "TEAM_OPERATIONAL_SETUP_NOT_CONNECTED|" +
      runtime.label
    );
  }

  return runtime;
}


/******************************************************
 * DATA ROUTERS
 ******************************************************/
function PTR_callTracker_(){
  const runtime = PTR_requireSpecificConnectedRuntime_("Call Schedule");
  return SpreadsheetApp.openById(runtime.callTrackerId);
}


function PTR_operations_(){
  const runtime = PTR_requireSpecificConnectedRuntime_("Operational Data");
  return SpreadsheetApp.openById(runtime.operationsId);
}


function PTR_privateBackend_(){
  const runtime = PTR_requireSpecificConnectedRuntime_("Incentive / Recovery Data");
  return SpreadsheetApp.openById(runtime.privateBackendId);
}


/******************************************************
 * EXECUTION-SCOPED TEAM SWITCH
 *
 * Used only for read-only aggregate operations. The
 * original execution context is restored even on error.
 ******************************************************/
function PTR_withExecutionTeamCode_(teamCode, callback){
  const code = PTR_normalizeTeamCode_(teamCode);
  const runtime = PTR_runtimeForCode_(code);

  if(!runtime || runtime.connected !== true){
    return null;
  }

  const previousCode = PTR_EXECUTION_TEAM_CODE_;
  const previousContext = PTR_EXECUTION_CONTEXT_;

  try{
    PTR_EXECUTION_TEAM_CODE_ = code;
    PTR_EXECUTION_CONTEXT_ = PTR_buildTeamContext_(
      code,
      "SUPER_ADMIN",
      "AGGREGATE_READ"
    );
    return callback(runtime);
  }finally{
    PTR_EXECUTION_TEAM_CODE_ = previousCode;
    PTR_EXECUTION_CONTEXT_ = previousContext;
  }
}


/******************************************************
 * SHARED RAW DATA SOURCE
 *
 * Raw Data is a common incentive-eligibility source for
 * every team. Team Data remains team-owned. The existing
 * Incentive Tracker -> Raw Data tab is the canonical source.
 * HYD Raw Data / Dev Raw Data may remain as operational
 * mirrors, but portal eligibility/recovery reads use this
 * canonical source so team switching never changes Raw Data
 * meaning or counts it more than once.
 ******************************************************/
function PTR_sharedRawDataWorkbook_(){
  return SpreadsheetApp.openById(
    PORTAL_TEAM_ROUTER.LEGACY.OPERATIONS_ID
  );
}

function PTR_sharedRawDataSheet_(){
  const ss = PTR_sharedRawDataWorkbook_();
  const sheet = ss.getSheetByName("Raw Data");
  if(!sheet){
    throw new Error("SHARED_RAW_DATA_SHEET_NOT_FOUND");
  }
  return sheet;
}

function PTR_sharedRawDataSource_(){
  const ss = PTR_sharedRawDataWorkbook_();
  const sheet = ss.getSheetByName("Raw Data");
  if(!sheet){
    throw new Error("SHARED_RAW_DATA_SHEET_NOT_FOUND");
  }
  return {
    spreadsheet:ss,
    sheet:sheet,
    spreadsheetId:ss.getId(),
    spreadsheetName:ss.getName(),
    sheetName:sheet.getName(),
    mode:"SHARED_ELIGIBILITY"
  };
}


function PTR_trackerSheet_(){
  const runtime = PTR_requireSpecificConnectedRuntime_("Incentive Tracker");
  const sheet = SpreadsheetApp
    .openById(runtime.privateBackendId)
    .getSheetByName(runtime.trackerSheet || "Incentive Tracker");

  if(!sheet){
    throw new Error("PRIVATE_INCENTIVE_TRACKER_NOT_FOUND|" + runtime.label);
  }
  return sheet;
}


function PTR_trackerSheetsForDashboard_(){
  const code = PTR_currentTeamCode_();

  if(code !== "ALL"){
    const runtime = PTR_currentRuntime_();
    if(runtime.connected !== true){
      return [];
    }
    const sheet = SpreadsheetApp
      .openById(runtime.privateBackendId)
      .getSheetByName(runtime.trackerSheet || "Incentive Tracker");
    return sheet ? [{teamCode: runtime.code, teamLabel: runtime.label, sheet: sheet}] : [];
  }

  const output = [];
  ["PRADEEP","HYD"].forEach(function(teamCode){
    const runtime = PTR_runtimeForCode_(teamCode);
    if(runtime.connected !== true || !runtime.privateBackendId){
      return;
    }
    try{
      const sheet = SpreadsheetApp
        .openById(runtime.privateBackendId)
        .getSheetByName(runtime.trackerSheet || "Incentive Tracker");
      if(sheet){
        output.push({
          teamCode: runtime.code,
          teamLabel: runtime.label,
          sheet: sheet
        });
      }
    }catch(error){
      Logger.log("All Teams tracker skipped for " + runtime.label + ": " + error.message);
    }
  });

  return output;
}


function PTR_callScheduleSheetName_(){
  return PTR_requireSpecificConnectedRuntime_("Call Schedule").callSheet;
}


function PTR_rawDataSheetName_(){
  return PTR_requireSpecificConnectedRuntime_("Raw Data").rawSheet;
}


function PTR_teamDataSheetName_(){
  return PTR_requireSpecificConnectedRuntime_("Team Data").teamSheet;
}


/******************************************************
 * CENTRAL CONTROL SHEETS
 * Existing Pradeep sheet names are preserved exactly.
 * Other teams receive isolated control sheets in the same
 * central portal backend, avoiding cross-team Call ID collisions.
 ******************************************************/
function PTR_controlSheetName_(baseName){
  const base = String(baseName || "").trim();
  const code = PTR_currentTeamCode_();

  if(code === "ALL"){
    throw new Error("TEAM_VIEW_REQUIRES_SPECIFIC_TEAM|Portal Control Data");
  }

  if(code === "DEV"){
    throw new Error("TEAM_OPERATIONAL_SETUP_NOT_CONNECTED|Developer Team");
  }

  if(code === "HYD"){
    return "HYD " + base;
  }

  if(code === "UNASSIGNED"){
    throw new Error("TEAM_OPERATIONAL_SETUP_NOT_CONNECTED|Team Not Assigned");
  }

  return base;
}


/******************************************************
 * TEAM-SCOPED HANDLER FALLBACK
 ******************************************************/
function PTR_activeHandlerNames_(){
  const runtime = PTR_requireSpecificConnectedRuntime_("Handler Roster");
  const targetCode = runtime.code;
  const names = [];

  try{
    const central = portalBackend_();
    const sheet = central.getSheetByName("V2 Handler Master");
    if(!sheet || sheet.getLastRow() < 2){
      return names;
    }

    const values = sheet.getDataRange().getDisplayValues();
    const headers = values[0].map(function(v){ return String(v || "").trim().toLowerCase(); });
    const nameCol = headers.indexOf("handler name");
    const teamCol = headers.indexOf("team id");
    const activeCol = headers.indexOf("active");

    if(nameCol < 0 || teamCol < 0){
      return names;
    }

    for(let i=1;i<values.length;i++){
      const name = String(values[i][nameCol] || "").trim();
      const teamId = String(values[i][teamCol] || "").trim();
      const active = activeCol < 0
        ? true
        : ["true","yes","1","active"].indexOf(String(values[i][activeCol] || "").trim().toLowerCase()) !== -1;

      if(
        name &&
        active &&
        PTR_teamCodeForIdentity_(teamId, typeof PAC_teamName_ === "function" ? PAC_teamName_(teamId) : "") === targetCode
      ){
        names.push(name);
      }
    }
  }catch(error){
    Logger.log("Team handler roster fallback unavailable: " + error.message);
  }

  return names;
}


/******************************************************
 * BRIDGE ROUTING
 ******************************************************/
function PTR_schedulerBridgeConfig_(){
  const runtime = PTR_requireSpecificConnectedRuntime_("Scheduler");
  const props = PropertiesService.getScriptProperties();

  const url = String(props.getProperty(runtime.schedulerUrlProperty) || "").trim();
  const secret = String(props.getProperty(runtime.schedulerSecretProperty) || "").trim();

  if(!url || !secret){
    throw new Error("SCHEDULER_BRIDGE_NOT_CONFIGURED|" + runtime.label);
  }

  return {url:url, secret:secret, teamCode:runtime.code, teamLabel:runtime.label};
}


function PTR_incentiveBridgeConfig_(){
  const runtime = PTR_requireSpecificConnectedRuntime_("Incentive Processing");
  const props = PropertiesService.getScriptProperties();

  const url = String(props.getProperty(runtime.incentiveUrlProperty) || "").trim();
  const secret = String(props.getProperty(runtime.incentiveSecretProperty) || "").trim();

  if(!url || !secret){
    throw new Error("INCENTIVE_BRIDGE_NOT_CONFIGURED|" + runtime.label);
  }

  return {url:url, secret:secret, teamCode:runtime.code, teamLabel:runtime.label};
}


/******************************************************
 * READ-ONLY SHARED RAW VALIDATION
 ******************************************************/
function PTR_testSharedRawDataReadOnly(){
  const source = PTR_sharedRawDataSource_();
  const result = {
    ok:true,
    mode:source.mode,
    workbook:source.spreadsheetName,
    sheet:source.sheetName,
    rows:Math.max(0, source.sheet.getLastRow() - 1)
  };
  Logger.log("========== SHARED RAW DATA ==========");
  Logger.log(JSON.stringify(result,null,2));
  Logger.log("=====================================");
  return result;
}


/******************************************************
 * TEAM MASTER REGISTRATION
 * Safe to re-run from the Apps Script editor.
 * Adds only a missing team when neither its canonical ID nor
 * equivalent Team Name already exists.
 ******************************************************/
function initializePortalTeamRegistry(){

  const ss = portalBackend_();
  let sheet = ss.getSheetByName("V2 Team Master");

  if(!sheet){
    sheet = ss.insertSheet("V2 Team Master");
    sheet.getRange(1,1,1,3).setValues([[
      "Team ID",
      "Team Name",
      "Support Mode"
    ]]);
    sheet.setFrozenRows(1);
  }

  if(sheet.getLastRow() === 0){
    sheet.getRange(1,1,1,3).setValues([[
      "Team ID",
      "Team Name",
      "Support Mode"
    ]]);
    sheet.setFrozenRows(1);
  }

  const values = sheet.getDataRange().getDisplayValues();
  const headers = (values[0] || []).map(function(v){ return String(v || "").trim().toLowerCase(); });
  const idCol = headers.indexOf("team id");
  const nameCol = headers.indexOf("team name");
  const modeCol = headers.indexOf("support mode");

  if(idCol < 0 || nameCol < 0){
    throw new Error("V2_TEAM_MASTER_SCHEMA_INVALID");
  }

  const definitions = [
    {code:"PRADEEP", id:"TEAM-PRADEEP", name:"Pradeep Anna Team", supportMode:""},
    {code:"HYD", id:"TEAM-HYD", name:"Hyderabad Team", supportMode:"Self Support"},
    {code:"DEV", id:"TEAM-DEV", name:"Developer Team", supportMode:""}
  ];

  const added = [];
  const existing = [];

  definitions.forEach(function(def){
    let found = null;

    for(let i=1;i<values.length;i++){
      const rowId = String(values[i][idCol] || "").trim();
      const rowName = String(values[i][nameCol] || "").trim();
      if(
        rowId.toUpperCase() === def.id ||
        PTR_teamCodeForIdentity_(rowId,rowName) === def.code
      ){
        found = {id:rowId, name:rowName};
        break;
      }
    }

    if(found){
      existing.push(found);
      return;
    }

    const row = new Array(Math.max(sheet.getLastColumn(),3)).fill("");
    row[idCol] = def.id;
    row[nameCol] = def.name;
    if(modeCol >= 0){
      row[modeCol] = def.supportMode;
    }
    sheet.getRange(sheet.getLastRow()+1,1,1,row.length).setValues([row]);
    added.push({id:def.id,name:def.name});
  });

  SpreadsheetApp.flush();

  const result = {
    ok: true,
    version: PORTAL_TEAM_ROUTER.VERSION,
    added: added,
    existing: existing,
    teamOptions: PTR_teamViewOptions_()
  };

  Logger.log("========== PORTAL TEAM REGISTRY ==========");
  Logger.log(JSON.stringify(result,null,2));
  Logger.log("==========================================");

  return result;
}


/******************************************************
 * READ-ONLY CONNECTION HEALTH
 ******************************************************/
function PTR_testMultiTeamRoutingReadOnly(){
  const result = {
    ok: true,
    version: PORTAL_TEAM_ROUTER.VERSION,
    teams: ["PRADEEP","HYD","DEV"].map(function(code){
      const runtime = PTR_runtimeForCode_(code);
      return {
        code: code,
        label: runtime.label,
        status: runtime.status,
        connected: runtime.connected === true,
        schedulerConnected: runtime.schedulerConnected === true,
        incentiveConnected: runtime.incentiveConnected === true,
        operationsConfigured: !!runtime.operationsId,
        privateBackendConfigured: !!runtime.privateBackendId,
        callTrackerConfigured: !!runtime.callTrackerId
      };
    })
  };

  Logger.log("========== PORTAL MULTI-TEAM ROUTING ==========");
  Logger.log(JSON.stringify(result,null,2));
  Logger.log("===============================================");
  return result;
}

/******************************************************
 * READ-ONLY HYD CONNECTION VALIDATION
 * Run after adding the six HYD Script Properties listed
 * in the installation README.
 ******************************************************/
function PTR_validateHydConnectionReadOnly(){

  const runtime = PTR_runtimeForCode_("HYD");
  const result = {
    ok: false,
    team: "Hyderabad Team",
    status: runtime.status,
    operationsConfigured: !!runtime.operationsId,
    privateBackendConfigured: !!runtime.privateBackendId,
    schedulerBridgeConfigured: runtime.schedulerConnected === true,
    incentiveBridgeConfigured: runtime.incentiveConnected === true,
    operationsWorkbook: "",
    privateWorkbook: "",
    interviewSheetFound: false,
    rawSheetFound: false,
    teamSheetFound: false,
    privateTrackerFound: false
  };

  if(runtime.operationsId){
    try{
      const operations = SpreadsheetApp.openById(runtime.operationsId);
      result.operationsWorkbook = operations.getName();
      result.interviewSheetFound = !!operations.getSheetByName(runtime.callSheet);
      result.rawSheetFound = !!operations.getSheetByName(runtime.rawSheet);
      result.teamSheetFound = !!operations.getSheetByName(runtime.teamSheet);
    }catch(error){
      result.operationsError = error.message;
    }
  }

  if(runtime.privateBackendId){
    try{
      const backend = SpreadsheetApp.openById(runtime.privateBackendId);
      result.privateWorkbook = backend.getName();
      result.privateTrackerFound = !!backend.getSheetByName(runtime.trackerSheet);
    }catch(error){
      result.privateError = error.message;
    }
  }

  result.ok = Boolean(
    runtime.connected === true &&
    result.interviewSheetFound &&
    result.rawSheetFound &&
    result.teamSheetFound &&
    result.privateTrackerFound
  );

  Logger.log("========== HYD PORTAL CONNECTION ==========");
  Logger.log(JSON.stringify(result,null,2));
  Logger.log("===========================================");

  return result;
}
function ADMIN_testHydCallTrackerAccessReadOnly(){

  const runtime = PTR_runtimeForCode_("HYD");

  const result = {
    callTrackerConfigured: !!runtime.callTrackerId,
    callTrackerIdPresent: !!String(runtime.callTrackerId || "").trim(),
    workbook: "",
    scheduleSheet: runtime.callSheet || "",
    scheduleSheetFound: false,
    error: ""
  };

  try{
    const ss = SpreadsheetApp.openById(runtime.callTrackerId);

    result.workbook = ss.getName();

    const sheet = ss.getSheetByName(
      runtime.callSheet || "HYD Interview Bot 2026"
    );

    result.scheduleSheetFound = !!sheet;

  }catch(error){

    result.error =
      error && error.message
        ? error.message
        : String(error);
  }

  Logger.log(JSON.stringify(result, null, 2));
  return result;
}