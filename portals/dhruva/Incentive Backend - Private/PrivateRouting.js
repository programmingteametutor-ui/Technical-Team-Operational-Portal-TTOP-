/******************************************************
 * PRIVATE INCENTIVE ENGINE ROUTING
 *
 * Private backend is the engine/output workbook.
 * Shared workbook is ONLY the operational source:
 *   Raw Data
 *   Team Data
 ******************************************************/

const INCENTIVE_PRIVATE_ROUTING = {

  OPERATIONS_SPREADSHEET_ID:
    "1UudfZfeBBkEwBQeWUwx77R4gl26wYZ1rKKZWCM_SHq4",

  PRIVATE_BACKEND_ID:
    "1Q5pRPoLsSjfxuRfEUZW2zZqrURYPzzbbPO6_8r9CLCk"
};


function IR_operations_(){

  return SpreadsheetApp.openById(
    INCENTIVE_PRIVATE_ROUTING
      .OPERATIONS_SPREADSHEET_ID
  );

}


function IR_backend_(){

  return SpreadsheetApp.openById(
    INCENTIVE_PRIVATE_ROUTING
      .PRIVATE_BACKEND_ID
  );

}


function IR_requirePrivateBoundProject_(){

  const active =
    SpreadsheetApp.getActive();

  if(
    !active ||
    active.getId() !==
      INCENTIVE_PRIVATE_ROUTING.PRIVATE_BACKEND_ID
  ){

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

  const active =
    SpreadsheetApp.getActive();

  const shared =
    IR_operations_();

  const backend =
    IR_backend_();

  const result = {
    activeWorkbook:
      active ? active.getName() : "",
    activeId:
      active ? active.getId() : "",
    activeIsPrivateBackend:
      !!active &&
      active.getId() ===
        INCENTIVE_PRIVATE_ROUTING.PRIVATE_BACKEND_ID,
    sharedRawFound:
      !!shared.getSheetByName("Raw Data"),
    sharedTeamFound:
      !!shared.getSheetByName("Team Data"),
    privateTrackerFound:
      !!backend.getSheetByName("Incentive Tracker"),
    privateRecoveryFound:
      !!backend.getSheetByName("Promotion Recovery"),
    privateExceptionsFound:
      !!backend.getSheetByName("Recovery Exceptions"),
    privateEvidenceFound:
      !!backend.getSheetByName("Recovery Evidence")
  };

  Logger.log(
    "========== PRIVATE ENGINE ROUTING =========="
  );

  Logger.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );

  Logger.log(
    "============================================"
  );

  return result;
}
