/******************************************************
 * PORTALCONFIG.GS
 * Secure Portal - Central + Team Routing
 *
 * IMPORTANT:
 * - portalBackend_() remains the CENTRAL control/access backend.
 *   V2 User Access, User Roles, masters and central request/audit
 *   data continue to live there.
 * - Team operational/private data is resolved through
 *   PortalTeamRouter.gs.
 ******************************************************/

const PORTAL_CONFIG = {

  // CENTRAL control/access backend. Do not make this team-dynamic.
  PRIVATE_BACKEND_ID:
    "1Q5pRPoLsSjfxuRfEUZW2zZqrURYPzzbbPO6_8r9CLCk",

  // Legacy Pradeep shared Incentive Tracker source.
  OPERATIONS_SPREADSHEET_ID:
    "1UudfZfeBBkEwBQeWUwx77R4gl26wYZ1rKKZWCM_SHq4",

  TRACKER_SHEET:
    "Incentive Tracker",

  USERS_SHEET:
    "Portal Users",

  RAW_SHEET:
    "Raw Data",

  TEAM_SHEET:
    "Team Data",

  RECOVERY_SHEET:
    "Promotion Recovery",

  RECOVERY_EXCEPTIONS_SHEET:
    "Recovery Exceptions",

  RECOVERY_EVIDENCE_SHEET:
    "Recovery Evidence",

  RECOVERY_APPLIED_LOG_SHEET:
    "Recovery Applied Log",

  SELECTION_REQUESTS_SHEET:
    "Selection Requests",

  PORTAL_AUDIT_SHEET:
    "Portal Action Log",

  TIME_ZONE:
    "Asia/Kolkata"

};


/******************************************************
 * CENTRAL CONTROL / ACCESS BACKEND
 ******************************************************/
function portalBackend_(){
  return SpreadsheetApp.openById(
    PORTAL_CONFIG.PRIVATE_BACKEND_ID
  );
}


/******************************************************
 * TEAM PRIVATE BACKEND
 * For Pradeep this resolves to the same existing private backend.
 * For Hyderabad it resolves to HYD Incentive Backend - Private.
 ******************************************************/
function portalTeamBackend_(){
  if(typeof PTR_privateBackend_ === "function"){
    return PTR_privateBackend_();
  }
  return portalBackend_();
}


/******************************************************
 * TEAM SHARED OPERATIONS WORKBOOK
 ******************************************************/
function portalOperations_(){
  if(typeof PTR_operations_ === "function"){
    return PTR_operations_();
  }
  return SpreadsheetApp.openById(
    PORTAL_CONFIG.OPERATIONS_SPREADSHEET_ID
  );
}


/******************************************************
 * TEAM PRIVATE TRACKER SHEET
 ******************************************************/
function portalTracker_(){

  if(typeof PTR_trackerSheet_ === "function"){
    return PTR_trackerSheet_();
  }

  const sheet =
    portalBackend_()
      .getSheetByName(
        PORTAL_CONFIG.TRACKER_SHEET
      );

  if(!sheet){
    throw new Error(
      "Private Incentive Tracker was not found."
    );
  }

  return sheet;
}


/******************************************************
 * CENTRAL PORTAL USERS SHEET
 ******************************************************/
function portalUsers_(){

  const sheet =
    portalBackend_()
      .getSheetByName(
        PORTAL_CONFIG.USERS_SHEET
      );

  if(!sheet){
    throw new Error(
      "Portal Users sheet was not found in the private backend."
    );
  }

  return sheet;
}
