/******************************************************
 * HYD INCENTIVE BACKEND - PRIVATE
 * FIRST-TIME SETUP + VALIDATION
 * Version 1.0
 *
 * Install this Apps Script project BOUND TO the blank
 * "HYD Incentive Backend - Private" spreadsheet.
 ******************************************************/

const HYD_SETUP = {
  TEAM_ID: "TEAM-HYD",
  OPERATIONS_WORKBOOK_NAME: "HYD Incentive Tracker",
  REQUIRED_OPERATION_SHEETS: [
    "HYD Interview Bot 2026",
    "HYD Raw Data",
    "HYD Team Data"
  ]
};

/******************************************************
 * MAIN SETUP - RUN MANUALLY ONCE
 *
 * Accepts either the Spreadsheet ID or full Google
 * Sheets URL of HYD Incentive Tracker.
 ******************************************************/
function setupHydPrivateBackend(operationsSpreadsheetIdOrUrl){

  const privateSS = SpreadsheetApp.getActive();

  if(!privateSS){
    throw new Error(
      "Open HYD Incentive Backend - Private and run setup from its bound Apps Script project."
    );
  }

  let operationsInput =
    String(operationsSpreadsheetIdOrUrl || "").trim();

  if(!operationsInput){
    const response = SpreadsheetApp.getUi().prompt(
      "HYD Private Backend Setup",
      "Paste the HYD Incentive Tracker Google Sheets URL or Spreadsheet ID:",
      SpreadsheetApp.getUi().ButtonSet.OK_CANCEL
    );

    if(response.getSelectedButton() !== SpreadsheetApp.getUi().Button.OK){
      throw new Error("HYD_BACKEND_SETUP_CANCELLED");
    }

    operationsInput = String(response.getResponseText() || "").trim();
  }

  const operationsId =
    HYD_extractSpreadsheetId_(
      operationsInput
    );

  if(!operationsId){
    throw new Error(
      "HYD Incentive Tracker Spreadsheet ID/URL is required."
    );
  }

  const operationsSS =
    SpreadsheetApp.openById(
      operationsId
    );

  const missingOperationSheets =
    HYD_SETUP.REQUIRED_OPERATION_SHEETS
      .filter(function(name){
        return !operationsSS.getSheetByName(name);
      });

  if(missingOperationSheets.length){
    throw new Error(
      "HYD_OPERATIONS_SHEETS_MISSING: " +
      missingOperationSheets.join(", ")
    );
  }

  const props =
    PropertiesService.getScriptProperties();

  props.setProperties({
    HYD_OPERATIONS_SPREADSHEET_ID:
      operationsId,
    HYD_PRIVATE_BACKEND_ID:
      privateSS.getId(),
    HYD_TEAM_ID:
      HYD_SETUP.TEAM_ID
  }, false);

  HYD_ensurePrivateSheets_(privateSS);

  const result =
    HYD_validateBackendReadOnly();

  Logger.log(
    "========== HYD PRIVATE BACKEND SETUP =========="
  );
  Logger.log(JSON.stringify(result,null,2));
  Logger.log(
    "==============================================="
  );

  try{
    SpreadsheetApp.getUi().alert(
      "HYD Incentive Backend - Private setup completed.\n\n" +
      "HYD Incentive Tracker connected: " +
      operationsSS.getName() +
      "\n\nNext: run HYD_validateBackendReadOnly()."
    );
  }catch(error){
    // UI unavailable in non-editor executions.
  }

  return result;
}

/******************************************************
 * CREATE/VALIDATE PRIVATE SHEETS
 * Non-destructive for existing populated sheets.
 ******************************************************/
function HYD_ensurePrivateSheets_(ss){

  HYD_ensureSheetWithHeader_(ss, "Incentive Tracker", [
    "Incentive Type",
    "Candidate",
    "Client",
    "From",
    "To",
    "Previous Date",
    "Promotion Date",
    "Handler",
    "Amount",
    "Status"
  ], true);

  HYD_ensureSheetWithHeader_(ss, "Promotion History", [
    "Candidate",
    "Client",
    "Previous Round",
    "Promotion Round",
    "Previous Date",
    "Promotion Date"
  ], false);

  HYD_ensureSheetWithHeader_(ss, "Incentive Summary", [
    "Month",
    "Handler",
    "Promotion",
    "Selection",
    "Total"
  ], false);

  HYD_ensureSheetWithHeader_(ss, "Monthly Incentive Summary", [
    "Month",
    "Handler",
    "Promotion",
    "Selection",
    "Total"
  ], false);

  HYD_ensureSheetWithHeader_(ss, "Client Alias", [
    "Alias",
    "Official"
  ], false);

  HYD_ensureSheetWithHeader_(ss, "Candidate Alias", [
    "Alias",
    "Official"
  ], false);

  HYD_ensureSheetWithHeader_(ss, "Promotion Recovery", [
    "Recovery ID",
    "Candidate",
    "Previous Round",
    "Current Round",
    "Team Client",
    "Raw Client",
    "Team Date",
    "Promotion Date",
    "Candidate %",
    "Client %",
    "Confidence",
    "Suggested Handler",
    "Amount",
    "Status",
    "Match Reason"
  ], false);

  HYD_ensureSheetWithHeader_(ss, "Recovery Exceptions", [
    "Exception ID",
    "Candidate",
    "Raw Client",
    "Raw Round",
    "Promotion Date",
    "Possible Team Candidate",
    "Team Client",
    "Team Round",
    "Team Date",
    "Suggested Handler(s)",
    "Candidate %",
    "Client %",
    "Issue Type",
    "Reason",
    "Status"
  ], false);

  HYD_ensureSheetWithHeader_(ss, "Recovery Evidence", [
    "Evidence ID",
    "Type",
    "Team Candidate",
    "Raw Candidate",
    "Team Client",
    "Raw Client",
    "Previous / Team Round",
    "Current / Raw Round",
    "Team Date",
    "Promotion Date",
    "Previous Team Original Text",
    "Previous Team Handler",
    "Previous Team Status",
    "Previous Team Source",
    "Current Raw Original Text",
    "Current Raw Source",
    "Current Team Original Text",
    "Current Team Handler",
    "Current Team Status",
    "Current Team Source",
    "Candidate %",
    "Client %",
    "Confidence",
    "Issue / Match Reason",
    "Review Status"
  ], false);

  HYD_ensureSheetWithHeader_(ss, "Recovery Applied Log", [
    "Recovery ID",
    "Applied Date",
    "Result",
    "Candidate",
    "Client",
    "From",
    "To",
    "Handler",
    "Amount"
  ], false);

  // The exact generator was not present in the snapshot.
  // Create the tab only; do not invent its schema.
  if(!ss.getSheetByName(CONFIG.POSSIBLE_MATCHES_SHEET)){
    ss.insertSheet(CONFIG.POSSIBLE_MATCHES_SHEET);
  }
}

function HYD_ensureSheetWithHeader_(ss,name,header,strictWidth){

  let sheet = ss.getSheetByName(name);

  if(!sheet){
    sheet = ss.insertSheet(name);
  }

  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();

  if(lastRow === 0 || lastColumn === 0){
    sheet
      .getRange(1,1,1,header.length)
      .setValues([header])
      .setFontWeight("bold");
    sheet.setFrozenRows(1);
    return sheet;
  }

  const existingHeader =
    sheet
      .getRange(1,1,1,Math.max(lastColumn,header.length))
      .getDisplayValues()[0]
      .slice(0,header.length)
      .map(function(value){
        return String(value || "").trim();
      });

  const expected =
    header.map(function(value){
      return String(value || "").trim();
    });

  const matches =
    expected.every(function(value,index){
      return existingHeader[index] === value;
    });

  if(!matches){
    // Never silently overwrite an already-populated sheet.
    if(lastRow > 1){
      throw new Error(
        "PRIVATE_SHEET_HEADER_MISMATCH: " + name
      );
    }

    sheet.clearContents();
    sheet
      .getRange(1,1,1,header.length)
      .setValues([header])
      .setFontWeight("bold");
    sheet.setFrozenRows(1);
  }

  if(strictWidth && sheet.getLastColumn() !== header.length){
    // The tracker is required by PrivateBackend.gs to have
    // exactly ten used columns. Extra completely blank physical
    // columns do not matter; getLastColumn() reflects used data.
    if(sheet.getLastRow() > 1){
      throw new Error(
        "PRIVATE_INCENTIVE_TRACKER_SCHEMA_MISMATCH"
      );
    }
  }

  return sheet;
}

/******************************************************
 * READ-ONLY VALIDATION
 ******************************************************/
function HYD_validateBackendReadOnly(){

  const privateSS = SpreadsheetApp.getActive();
  const props = PropertiesService.getScriptProperties();

  const operationsId = String(
    props.getProperty("HYD_OPERATIONS_SPREADSHEET_ID") || ""
  ).trim();

  const privateId = String(
    props.getProperty("HYD_PRIVATE_BACKEND_ID") || ""
  ).trim();

  const result = {
    ok: false,
    teamId: "TEAM-HYD",
    privateWorkbook:
      privateSS ? privateSS.getName() : "",
    privateIdConfigured:
      !!privateId,
    privateBoundCorrectly:
      !!privateSS && !!privateId && privateSS.getId() === privateId,
    operationsIdConfigured:
      !!operationsId,
    operationsWorkbook: "",
    interviewSheetFound: false,
    rawSheetFound: false,
    teamSheetFound: false,
    rawRows: 0,
    teamRows: 0,
    privateTrackerFound: false,
    privateTrackerHeaderValid: false,
    recoveryEngineSource:
      HYD_BACKEND_SOURCE_STATUS.RECOVERY_ENGINE,
    exactPossibleMatchesGeneratorAvailable:
      typeof generatePossibleMatches === "function",
    exactApproveAliasesAvailable:
      typeof approveAliases === "function"
  };

  if(!privateSS || !operationsId || !privateId){
    return result;
  }

  const operationsSS = SpreadsheetApp.openById(operationsId);
  result.operationsWorkbook = operationsSS.getName();

  const interviewSheet =
    operationsSS.getSheetByName("HYD Interview Bot 2026");
  const rawSheet =
    operationsSS.getSheetByName(CONFIG.RAW_SHEET);
  const teamSheet =
    operationsSS.getSheetByName(CONFIG.TEAM_SHEET);

  result.interviewSheetFound = !!interviewSheet;
  result.rawSheetFound = !!rawSheet;
  result.teamSheetFound = !!teamSheet;
  result.rawRows = rawSheet ? rawSheet.getLastRow() : 0;
  result.teamRows = teamSheet ? teamSheet.getLastRow() : 0;

  const tracker =
    privateSS.getSheetByName(CONFIG.TRACKER_SHEET);

  result.privateTrackerFound = !!tracker;

  if(tracker){
    const expected = [
      "Incentive Type",
      "Candidate",
      "Client",
      "From",
      "To",
      "Previous Date",
      "Promotion Date",
      "Handler",
      "Amount",
      "Status"
    ];

    const actual = tracker
      .getRange(1,1,1,10)
      .getDisplayValues()[0]
      .map(function(value){
        return String(value || "").trim();
      });

    result.privateTrackerHeaderValid =
      expected.every(function(value,index){
        return actual[index] === value;
      });
  }

  result.ok = Boolean(
    result.privateBoundCorrectly &&
    result.interviewSheetFound &&
    result.rawSheetFound &&
    result.teamSheetFound &&
    result.privateTrackerFound &&
    result.privateTrackerHeaderValid
  );

  Logger.log(
    "========== HYD BACKEND VALIDATION =========="
  );
  Logger.log(JSON.stringify(result,null,2));
  Logger.log(
    "============================================"
  );

  return result;
}

/******************************************************
 * INSTALL HYD TEAM DATA SELECTION DATE TRIGGER
 * Run only AFTER setupHydPrivateBackend() succeeds.
 ******************************************************/
function HYD_installSelectionDateTrigger(){
  setupSharedTeamSelectionTrigger();
  return {
    ok: true,
    handler: "selectionDateSharedEdit",
    sheet: CONFIG.TEAM_SHEET
  };
}

/******************************************************
 * EXTRACT SPREADSHEET ID FROM ID OR URL
 ******************************************************/
function HYD_extractSpreadsheetId_(value){
  const text = String(value || "").trim();
  if(!text) return "";

  const match = text.match(/\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : text;
}


/******************************************************
 * READ-ONLY INCENTIVE PREVIEW
 *
 * Calculates the same normal promotion/team matching
 * in memory but DOES NOT write Promotion History,
 * Incentive Tracker or summaries.
 ******************************************************/
function HYD_previewIncentiveScanReadOnly(){

  IR_requirePrivateBoundProject_();

  const rawRecords = loadRawData();
  const teamRecords = loadTeamData();
  const promotions = buildPromotionHistory(rawRecords);
  const tracker = buildIncentiveTracker(
    promotions,
    teamRecords
  );

  const result = {
    ok: true,
    rawRecords: rawRecords.length,
    teamRecords: teamRecords.length,
    promotionsDetected: promotions.length,
    incentiveRowsDetected: tracker.length,
    promotionIncentives:
      tracker.filter(function(item){
        return item.incentiveType === "Promotion";
      }).length,
    selectionIncentives:
      tracker.filter(function(item){
        return item.incentiveType === "Selection";
      }).length,
    sample:
      tracker.slice(0,10).map(function(item){
        return {
          type: item.incentiveType,
          candidate: item.candidate,
          client: item.client,
          from: item.fromRound,
          to: item.toRound,
          handler: item.handler,
          amount: item.amount
        };
      })
  };

  Logger.log(
    "========== HYD INCENTIVE READ-ONLY PREVIEW =========="
  );
  Logger.log(JSON.stringify(result,null,2));
  Logger.log(
    "====================================================="
  );

  return result;
}

