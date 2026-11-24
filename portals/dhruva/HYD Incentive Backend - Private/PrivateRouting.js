/******************************************************
 * HYD PRIVATE INCENTIVE ENGINE ROUTING
 * Version 1.0
 *
 * Private backend is the engine/output workbook.
 * HYD Incentive Tracker is ONLY the operational source:
 *   HYD Raw Data
 *   HYD Team Data
 *
 * Spreadsheet IDs are stored in Script Properties.
 * No Pradeep-team IDs are hard-coded here.
 ******************************************************/

const IR_PROPERTY_KEYS = {
  OPERATIONS_SPREADSHEET_ID:
    "HYD_OPERATIONS_SPREADSHEET_ID",
  PRIVATE_BACKEND_ID:
    "HYD_PRIVATE_BACKEND_ID"
};

const INCENTIVE_PRIVATE_ROUTING = {
  get OPERATIONS_SPREADSHEET_ID(){
    return IR_operationsSpreadsheetId_();
  },
  get PRIVATE_BACKEND_ID(){
    return IR_privateBackendId_();
  }
};

function IR_scriptProperties_(){
  return PropertiesService.getScriptProperties();
}

function IR_operationsSpreadsheetId_(){
  const id = String(
    IR_scriptProperties_().getProperty(
      IR_PROPERTY_KEYS.OPERATIONS_SPREADSHEET_ID
    ) || ""
  ).trim();

  if(!id){
    throw new Error(
      "HYD_OPERATIONS_SPREADSHEET_ID_NOT_CONFIGURED"
    );
  }

  return id;
}

function IR_privateBackendId_(){
  let id = String(
    IR_scriptProperties_().getProperty(
      IR_PROPERTY_KEYS.PRIVATE_BACKEND_ID
    ) || ""
  ).trim();

  if(id){
    return id;
  }

  // Safe fallback only for manual runs inside the
  // spreadsheet-bound HYD private backend project.
  const active = SpreadsheetApp.getActive();
  if(active){
    id = active.getId();
  }

  if(!id){
    throw new Error(
      "HYD_PRIVATE_BACKEND_ID_NOT_CONFIGURED"
    );
  }

  return id;
}

function IR_operations_(){
  return SpreadsheetApp.openById(
    IR_operationsSpreadsheetId_()
  );
}

function IR_backend_(){
  return SpreadsheetApp.openById(
    IR_privateBackendId_()
  );
}

function IR_requirePrivateBoundProject_(){
  const active = SpreadsheetApp.getActive();
  const expectedId = IR_privateBackendId_();

  if(!active || active.getId() !== expectedId){
    throw new Error(
      "PRIVATE_ENGINE_WRONG_BOUND_SPREADSHEET"
    );
  }

  return active;
}

/******************************************************
 * SAFE READ-ONLY ROUTING TEST
 ******************************************************/
function testPrivateEngineRouting(){
  const active = SpreadsheetApp.getActive();
  const shared = IR_operations_();
  const backend = IR_backend_();

  const result = {
    activeWorkbook:
      active ? active.getName() : "",
    activeIsPrivateBackend:
      !!active &&
      active.getId() === IR_privateBackendId_(),
    operationsWorkbook:
      shared.getName(),
    operationsIsExpectedName:
      shared.getName() === "HYD Incentive Tracker",
    hydInterviewBotFound:
      !!shared.getSheetByName("HYD Interview Bot 2026"),
    sharedRawFound:
      !!shared.getSheetByName(CONFIG.RAW_SHEET),
    sharedTeamFound:
      !!shared.getSheetByName(CONFIG.TEAM_SHEET),
    privateTrackerFound:
      !!backend.getSheetByName(CONFIG.TRACKER_SHEET),
    privateRecoveryFound:
      !!backend.getSheetByName("Promotion Recovery"),
    privateExceptionsFound:
      !!backend.getSheetByName("Recovery Exceptions"),
    privateEvidenceFound:
      !!backend.getSheetByName("Recovery Evidence")
  };

  Logger.log(
    "========== HYD PRIVATE ENGINE ROUTING =========="
  );
  Logger.log(JSON.stringify(result,null,2));
  Logger.log(
    "================================================"
  );

  return result;
}

