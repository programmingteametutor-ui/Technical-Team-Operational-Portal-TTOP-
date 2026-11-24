/******************************************************
 * V2_PHASE1.GS
 * Interview Operations Portal V2
 * Private Backend — Phase 1 Consolidated Source
 *
 * CONSOLIDATED VERSION
 * --------------------
 * V2-PHASE1-COMBINED-2026.08.16
 *
 * VERIFIED COMPONENTS
 * -------------------
 * Foundation: V2-PHASE2.0-2026.08.15
 * Repository: V2-REPOSITORY-2.0.0
 * Gateway Parser: GW-PARSER-1.4.0
 * Candidate Matcher: V2-CANDIDATE-MATCHER-1.3.1
 *
 * PURPOSE
 * -------
 * Consolidates the CURRENT PERMANENT V2 Private Backend
 * Phase-1 code into one Apps Script .gs file.
 *
 * NOT INCLUDED
 * ------------
 * - legacy incentive-engine code
 * - Interview Portal Control / web-app UI code
 * - obsolete one-time preview/inspection scripts
 * - historical candidate-matcher versions
 *
 * FUTURE LOCKED REQUIREMENT
 * -------------------------
 * Setup Team / POC Candidate Review:
 * approximately 20–30 assigned candidates per POC.
 * Unresolved candidate identities will be routed to the
 * responsible POC for auditable confirmation/correction.
 ******************************************************/

const V2_PHASE1_COMBINED =
  Object.freeze({
    VERSION:
      "V2-PHASE1-COMBINED-2026.08.16"
  });


/******************************************************
 * READ-ONLY CONSOLIDATED HEALTH TEST
 * No sheet writes.
 ******************************************************/
function V2_testPhase1CombinedReadOnly(){

  const result = {
    ok:
      (
        typeof V2_CONFIG !== "undefined" &&
        V2_CONFIG.VERSION ===
          "V2-PHASE2.0-2026.08.15" &&

        typeof V2_REPOSITORY_VERSION !==
          "undefined" &&
        V2_REPOSITORY_VERSION ===
          "V2-REPOSITORY-2.0.0" &&

        typeof V2_GATEWAY_CONFIG !==
          "undefined" &&
        V2_GATEWAY_CONFIG.PARSER_VERSION ===
          "GW-PARSER-1.4.0" &&

        typeof V2_CANDIDATE_MATCHER !==
          "undefined" &&
        V2_CANDIDATE_MATCHER.VERSION ===
          "V2-CANDIDATE-MATCHER-1.3.1"
      ),

    combinedVersion:
      V2_PHASE1_COMBINED.VERSION,

    foundationVersion:
      typeof V2_CONFIG !== "undefined"
        ? V2_CONFIG.VERSION
        : "",

    repositoryVersion:
      typeof V2_REPOSITORY_VERSION !== "undefined"
        ? V2_REPOSITORY_VERSION
        : "",

    parserVersion:
      typeof V2_GATEWAY_CONFIG !== "undefined"
        ? V2_GATEWAY_CONFIG.PARSER_VERSION
        : "",

    matcherVersion:
      typeof V2_CANDIDATE_MATCHER !== "undefined"
        ? V2_CANDIDATE_MATCHER.VERSION
        : ""
  };

  Logger.log(
    "========== V2 PHASE 1 COMBINED HEALTH =========="
  );

  Logger.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );

  Logger.log(
    "==============================================="
  );

  return result;

}




/******************************************************
 * SECTION 1: FOUNDATION + SCHEMA
 * Former Apps Script file: V2Foundation.gs
 ******************************************************/

/******************************************************
 * V2FOUNDATION.GS
 * Interview Operations Portal V2 - Phase 1 Foundation
 *
 * INSTALL IN:
 *   Incentive Backend - Private -> Apps Script
 *
 * SAFETY:
 * - Creates ONLY new V2 sheets in the private backend.
 * - Does NOT edit Raw Data or Team Data.
 * - Does NOT change current incentive, recovery, scheduler,
 *   portal authentication, or call-operation logic.
 ******************************************************/

const V2_CONFIG = Object.freeze({

  VERSION:
    "V2-PHASE2.0-2026.08.15",

  SHEETS: Object.freeze({

    TEAM_MASTER:
      "V2 Team Master",

    USER_ACCESS:
      "V2 User Access",

    CANDIDATE_MASTER:
      "V2 Candidate Master",

    HANDLER_MASTER:
      "V2 Handler Master",

    SETUP_SUPPORT_MASTER:
      "V2 Setup Support Master",

    DEVELOPER_MASTER:
      "V2 Developer Master",

    SCREEN_OPERATOR_MASTER:
      "V2 Screen Operator Master",

    CLIENT_REGISTRY:
      "V2 Client Registry",

    GATEWAY:
      "V2 Interview Gateway",

    CANDIDATE_EVENTS:
      "V2 Candidate Events",

    JOBS:
      "V2 Portal Jobs",

    NOTIFICATIONS:
      "V2 Portal Notifications"

  }),

  TEAM_IDS: Object.freeze({
    PRADEEP:
      "TEAM-PA",
    HYDERABAD:
      "TEAM-HYD",
    MARKETING:
      "TEAM-MKT",
    DEVELOPERS:
      "TEAM-DEV",
    EXCLUSIVE:
      "TEAM-EXC"
  })

});


/******************************************************
 * PUBLIC: SAFE ONE-TIME / RE-RUNNABLE FOUNDATION SETUP
 ******************************************************/
function V2_setupFoundation(){

  const ss =
    V2_backend_();

  const definitions =
    V2_sheetDefinitions_();

  const result = {
    version:
      V2_CONFIG.VERSION,
    backend:
      ss.getName(),
    created: [],
    verified: [],
    teamRowsSeeded:
      0
  };

  Object.keys(definitions)
    .forEach(
      function(key){

        const def =
          definitions[key];

        const existing =
          ss.getSheetByName(
            def.name
          );

        const sheet =
          V2_ensureSheet_(
            ss,
            def.name,
            def.headers
          );

        if(existing){
          result.verified.push(
            def.name
          );
        }else{
          result.created.push(
            def.name
          );
        }

        V2_formatHeader_(
          sheet,
          def.headers.length
        );

      }
    );

  result.teamRowsSeeded =
    V2_seedTeams_();

  V2_applyGatewayStatusFormatting_();

  Logger.log(
    "========== V2 FOUNDATION SETUP =========="
  );

  Logger.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );

  Logger.log(
    "========================================="
  );

  return result;
}



/******************************************************
 * PUBLIC: SAFE GATEWAY SCHEMA UPGRADE TO V1.2
 *
 * Touches ONLY "V2 Interview Gateway".
 * Preserves existing Gateway rows by header name.
 * Raw Data / Team Data / live portal data are untouched.
 ******************************************************/
function V2_upgradeGatewaySchemaV12(){

  const ss =
    V2_backend_();

  const sheet =
    ss.getSheetByName(
      V2_CONFIG.SHEETS.GATEWAY
    );

  if(!sheet){
    throw new Error(
      "V2_GATEWAY_SHEET_NOT_FOUND|run=V2_setupFoundation"
    );
  }

  const targetHeaders =
    V2_sheetDefinitions_()
      .GATEWAY
      .headers;

  if(
    V2_headersMatch_(
      sheet,
      targetHeaders
    )
  ){

    const already = {
      ok: true,
      changed: false,
      status: "ALREADY_V1_2",
      rowsPreserved:
        Math.max(
          0,
          sheet.getLastRow() - 1
        ),
      columns:
        targetHeaders.length
    };

    Logger.log(
      "========== V2 GATEWAY SCHEMA UPGRADE =========="
    );

    Logger.log(
      JSON.stringify(
        already,
        null,
        2
      )
    );

    Logger.log(
      "==============================================="
    );

    return already;
  }

  const legacyHeaders = [
    "Gateway ID",
    "Source Sheet",
    "Source Row",
    "Source Date",
    "Team ID",
    "Original Record",
    "Candidate Raw",
    "Candidate ID",
    "Official Candidate Name",
    "Candidate Match Status",
    "Candidate Match Score",
    "Client Raw",
    "Client Suggested Match",
    "Client Match Score",
    "Time Raw",
    "Time Normalized",
    "Start Minutes",
    "Duration Raw",
    "Duration Minutes",
    "End Minutes",
    "Round Raw",
    "Round Label",
    "Round No",
    "Interview Type",
    "Operational Tags",
    "Notes / Unclassified",
    "Parse Status",
    "Review Reason",
    "Source Hash",
    "Parser Version",
    "Parsed At"
  ];

  if(
    !V2_headersMatch_(
      sheet,
      legacyHeaders
    )
  ){
    throw new Error(
      "V2_GATEWAY_SCHEMA_UNKNOWN|manual_review_required"
    );
  }

  const lastRow =
    sheet.getLastRow();

  const oldValues =
    lastRow > 1
      ? sheet
          .getRange(
            2,
            1,
            lastRow - 1,
            legacyHeaders.length
          )
          .getValues()
      : [];

  const oldMap =
    V2_headerMap_(
      legacyHeaders
    );

  const remapped =
    oldValues.map(
      function(row){

        return targetHeaders.map(
          function(header){

            if(
              oldMap[header] !==
              undefined
            ){
              return row[
                oldMap[header]
              ];
            }

            if(
              header ===
                "Business Date Key"
            ){

              const sourceDate =
                row[
                  oldMap[
                    "Source Date"
                  ]
                ];

              if(
                sourceDate instanceof Date &&
                !isNaN(
                  sourceDate.getTime()
                )
              ){
                return Utilities.formatDate(
                  sourceDate,
                  Session.getScriptTimeZone(),
                  "yyyy-MM-dd"
                );
              }

            }

            return "";
          }
        );

      }
    );

  sheet.clearContents();

  sheet
    .getRange(
      1,
      1,
      1,
      targetHeaders.length
    )
    .setValues([
      targetHeaders
    ]);

  if(remapped.length){

    sheet
      .getRange(
        2,
        1,
        remapped.length,
        targetHeaders.length
      )
      .setValues(
        remapped
      );

  }

  V2_formatHeader_(
    sheet,
    targetHeaders.length
  );

  V2_applyGatewayStatusFormatting_();

  const result = {
    ok: true,
    changed: true,
    status: "UPGRADED_TO_V1_2",
    rowsPreserved:
      remapped.length,
    oldColumns:
      legacyHeaders.length,
    newColumns:
      targetHeaders.length
  };

  Logger.log(
    "========== V2 GATEWAY SCHEMA UPGRADE =========="
  );

  Logger.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );

  Logger.log(
    "==============================================="
  );

  return result;
}



/******************************************************
 * PUBLIC: SAFE GATEWAY SCHEMA UPGRADE TO V1.3
 *
 * Adds "Interview Detail" as a structured field.
 * Touches ONLY "V2 Interview Gateway".
 * Preserves all existing Gateway rows by header name.
 * Raw Data / Team Data / live portal data are untouched.
 ******************************************************/
function V2_upgradeGatewaySchemaV13(){

  const ss =
    V2_backend_();

  const sheet =
    ss.getSheetByName(
      V2_CONFIG.SHEETS.GATEWAY
    );

  if(!sheet){
    throw new Error(
      "V2_GATEWAY_SHEET_NOT_FOUND|run=V2_setupFoundation"
    );
  }

  const targetHeaders =
    V2_sheetDefinitions_()
      .GATEWAY
      .headers;

  if(
    V2_headersMatch_(
      sheet,
      targetHeaders
    )
  ){

    const already = {
      ok: true,
      changed: false,
      status: "ALREADY_V1_3",
      rowsPreserved:
        Math.max(
          0,
          sheet.getLastRow() - 1
        ),
      columns:
        targetHeaders.length
    };

    Logger.log(
      "========== V2 GATEWAY SCHEMA UPGRADE V1.3 =========="
    );

    Logger.log(
      JSON.stringify(
        already,
        null,
        2
      )
    );

    Logger.log(
      "==================================================="
    );

    return already;
  }

  const v12Headers = [
    "Gateway ID",
    "Source Sheet",
    "Source Row",
    "Source Date",
    "Business Date Key",
    "Team ID",
    "Original Record",
    "Candidate Raw",
    "Candidate ID",
    "Official Candidate Name",
    "Candidate Match Status",
    "Candidate Match Score",
    "Client Raw",
    "Client Suggested Match",
    "Client Match Score",
    "Time Raw",
    "Time Normalized",
    "Start Minutes",
    "Duration Raw",
    "Duration Minutes",
    "End Minutes",
    "Round Raw",
    "Round Label",
    "Round No",
    "Interview Type",
    "Stage Descriptor",
    "Operational Tags",
    "Notes / Unclassified",
    "Data Completeness",
    "Missing Fields",
    "Scheduling Readiness",
    "Parse Status",
    "Review Reason",
    "Source Hash",
    "Parser Version",
    "Parsed At"
  ];

  if(
    !V2_headersMatch_(
      sheet,
      v12Headers
    )
  ){
    throw new Error(
      "V2_GATEWAY_SCHEMA_UNKNOWN|expected=V1_2_or_V1_3"
    );
  }

  const lastRow =
    sheet.getLastRow();

  const oldValues =
    lastRow > 1
      ? sheet
          .getRange(
            2,
            1,
            lastRow - 1,
            v12Headers.length
          )
          .getValues()
      : [];

  const oldMap =
    V2_headerMap_(
      v12Headers
    );

  const remapped =
    oldValues.map(
      function(row){

        return targetHeaders.map(
          function(header){

            if(
              oldMap[header] !==
              undefined
            ){
              return row[
                oldMap[header]
              ];
            }

            // New V1.3 field is intentionally blank until
            // the next shadow rebuild reparses Original Record.
            if(
              header ===
                "Interview Detail"
            ){
              return "";
            }

            return "";
          }
        );

      }
    );

  sheet.clearContents();

  sheet
    .getRange(
      1,
      1,
      1,
      targetHeaders.length
    )
    .setValues([
      targetHeaders
    ]);

  if(remapped.length){

    sheet
      .getRange(
        2,
        1,
        remapped.length,
        targetHeaders.length
      )
      .setValues(
        remapped
      );

  }

  V2_formatHeader_(
    sheet,
    targetHeaders.length
  );

  V2_applyGatewayStatusFormatting_();

  const result = {
    ok: true,
    changed: true,
    status: "UPGRADED_TO_V1_3",
    rowsPreserved:
      remapped.length,
    oldColumns:
      v12Headers.length,
    newColumns:
      targetHeaders.length
  };

  Logger.log(
    "========== V2 GATEWAY SCHEMA UPGRADE V1.3 =========="
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
 * PUBLIC: SAFE CANDIDATE MASTER PROFILE UPGRADE
 *
 * Expands V2 Candidate Master from the original
 * 4-column identity table into the V2 Candidate 360
 * profile source.
 *
 * IMPORTANT:
 * - Preserves Candidate ID / Official Name / Active / Notes.
 * - New profile fields are added blank.
 * - Does NOT import or invent candidate data.
 * - Does NOT touch Gateway, Raw Data, Team Data, or live
 *   incentive / portal logic.
 * - The original first four columns remain in the same
 *   positions so the already-tested Gateway v1.4
 *   Candidate Master reader stays compatible.
 ******************************************************/
function V2_upgradeCandidateMasterSchemaV20(){

  const ss =
    V2_backend_();

  const sheet =
    ss.getSheetByName(
      V2_CONFIG.SHEETS.CANDIDATE_MASTER
    );

  if(!sheet){
    throw new Error(
      "V2_CANDIDATE_MASTER_NOT_FOUND|run=V2_setupFoundation"
    );
  }

  const targetHeaders =
    V2_sheetDefinitions_()
      .CANDIDATE_MASTER
      .headers;

  if(
    V2_headersMatch_(
      sheet,
      targetHeaders
    )
  ){

    const already = {
      ok:
        true,
      changed:
        false,
      status:
        "ALREADY_V2_CANDIDATE_PROFILE",
      rowsPreserved:
        Math.max(
          0,
          sheet.getLastRow() - 1
        ),
      columns:
        targetHeaders.length
    };

    Logger.log(
      "========== V2 CANDIDATE MASTER SCHEMA UPGRADE =========="
    );

    Logger.log(
      JSON.stringify(
        already,
        null,
        2
      )
    );

    Logger.log(
      "========================================================"
    );

    return already;
  }

  const legacyHeaders = [
    "Candidate ID",
    "Official Candidate Name",
    "Active",
    "Notes"
  ];

  if(
    !V2_headersMatch_(
      sheet,
      legacyHeaders
    )
  ){
    throw new Error(
      "V2_CANDIDATE_MASTER_SCHEMA_UNKNOWN|manual_review_required"
    );
  }

  const lastRow =
    sheet.getLastRow();

  const oldValues =
    lastRow > 1
      ? sheet
          .getRange(
            2,
            1,
            lastRow - 1,
            legacyHeaders.length
          )
          .getValues()
      : [];

  const oldMap =
    V2_headerMap_(
      legacyHeaders
    );

  const remapped =
    oldValues.map(
      function(row){

        return targetHeaders.map(
          function(header){

            if(
              oldMap[header] !==
              undefined
            ){
              return row[
                oldMap[header]
              ];
            }

            return "";

          }
        );

      }
    );

  sheet.clearContents();

  sheet
    .getRange(
      1,
      1,
      1,
      targetHeaders.length
    )
    .setValues([
      targetHeaders
    ]);

  if(remapped.length){

    sheet
      .getRange(
        2,
        1,
        remapped.length,
        targetHeaders.length
      )
      .setValues(
        remapped
      );

  }

  V2_formatHeader_(
    sheet,
    targetHeaders.length
  );

  const result = {
    ok:
      true,
    changed:
      true,
    status:
      "UPGRADED_TO_V2_CANDIDATE_PROFILE",
    rowsPreserved:
      remapped.length,
    oldColumns:
      legacyHeaders.length,
    newColumns:
      targetHeaders.length,
    gatewayCompatibility:
      "FIRST_4_COLUMNS_PRESERVED"
  };

  Logger.log(
    "========== V2 CANDIDATE MASTER SCHEMA UPGRADE =========="
  );

  Logger.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );

  Logger.log(
    "========================================================"
  );

  return result;
}


/******************************************************
 * PUBLIC: READ-ONLY FOUNDATION HEALTH TEST
 ******************************************************/
function V2_testFoundation(){

  const ss =
    V2_backend_();

  const definitions =
    V2_sheetDefinitions_();

  const sheets = [];
  let ok = true;

  Object.keys(definitions)
    .forEach(
      function(key){

        const def =
          definitions[key];

        const sheet =
          ss.getSheetByName(
            def.name
          );

        const item = {
          sheet:
            def.name,
          exists:
            Boolean(sheet),
          headersOk:
            false,
          rows:
            sheet
              ? Math.max(
                  0,
                  sheet.getLastRow() - 1
                )
              : 0
        };

        if(sheet){

          item.headersOk =
            V2_headersMatch_(
              sheet,
              def.headers
            );

        }

        if(
          !item.exists ||
          !item.headersOk
        ){
          ok = false;
        }

        sheets.push(item);

      }
    );

  const result = {
    ok:
      ok,
    version:
      V2_CONFIG.VERSION,
    backend:
      ss.getName(),
    sheets:
      sheets
  };

  Logger.log(
    "========== V2 FOUNDATION TEST =========="
  );

  Logger.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );

  Logger.log(
    "========================================"
  );

  return result;
}


/******************************************************
 * PRIVATE: BACKEND ROUTING
 ******************************************************/
function V2_backend_(){

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

  throw new Error(
    "V2_PRIVATE_BACKEND_ROUTER_NOT_FOUND"
  );
}


function V2_operations_(){

  if(
    typeof IR_operations_ ===
    "function"
  ){
    return IR_operations_();
  }

  throw new Error(
    "V2_OPERATIONS_WORKBOOK_ROUTER_NOT_FOUND"
  );
}


/******************************************************
 * PRIVATE: V2 SHEET DEFINITIONS
 ******************************************************/
function V2_sheetDefinitions_(){

  return {

    TEAM_MASTER: {
      name:
        V2_CONFIG.SHEETS.TEAM_MASTER,
      headers: [
        "Team ID",
        "Team Name",
        "Support Mode",
        "Active",
        "Notes"
      ]
    },

    USER_ACCESS: {
      name:
        V2_CONFIG.SHEETS.USER_ACCESS,
      headers: [
        "User ID",
        "Email",
        "Official Name",
        "Role",
        "Primary Team ID",
        "Handler ID",
        "Support ID",
        "Active",
        "Notes"
      ]
    },

    CANDIDATE_MASTER: {
      name:
        V2_CONFIG.SHEETS.CANDIDATE_MASTER,
      headers: [
        "Candidate ID",
        "Official Candidate Name",
        "Active",
        "Notes",
        "Email",
        "Active Status",
        "Assigned Domains",
        "Location",
        "Assigned To User ID",
        "Assigned To Name",
        "Priority Student",
        "Date of Joining",
        "Visa Type",
        "Experience",
        "Created At",
        "Updated At"
      ]
    },

    HANDLER_MASTER: {
      name:
        V2_CONFIG.SHEETS.HANDLER_MASTER,
      headers: [
        "Handler ID",
        "Handler Name",
        "Team ID",
        "Active",
        "Night Eligible",
        "Shift Start",
        "Shift End",
        "Notes"
      ]
    },

    SETUP_SUPPORT_MASTER: {
      name:
        V2_CONFIG.SHEETS.SETUP_SUPPORT_MASTER,
      headers: [
        "Support ID",
        "Support Name",
        "Team Scope",
        "Active",
        "Night Eligible",
        "Notes"
      ]
    },

    DEVELOPER_MASTER: {
      name:
        V2_CONFIG.SHEETS.DEVELOPER_MASTER,
      headers: [
        "Developer ID",
        "Developer Name",
        "Active",
        "Notes"
      ]
    },

    SCREEN_OPERATOR_MASTER: {
      name:
        V2_CONFIG.SHEETS.SCREEN_OPERATOR_MASTER,
      headers: [
        "Operator ID",
        "Operator Name",
        "Active",
        "Notes"
      ]
    },

    CLIENT_REGISTRY: {
      name:
        V2_CONFIG.SHEETS.CLIENT_REGISTRY,
      headers: [
        "Client ID",
        "Recognized Client",
        "Known Variant",
        "Active",
        "Confirmed By",
        "Confirmed At",
        "Notes"
      ]
    },

    GATEWAY: {
      name:
        V2_CONFIG.SHEETS.GATEWAY,
      headers: [
        "Gateway ID",
        "Source Sheet",
        "Source Row",
        "Source Date",
        "Business Date Key",
        "Team ID",
        "Original Record",
        "Candidate Raw",
        "Candidate ID",
        "Official Candidate Name",
        "Candidate Match Status",
        "Candidate Match Score",
        "Client Raw",
        "Client Suggested Match",
        "Client Match Score",
        "Time Raw",
        "Time Normalized",
        "Start Minutes",
        "Duration Raw",
        "Duration Minutes",
        "End Minutes",
        "Round Raw",
        "Round Label",
        "Round No",
        "Interview Type",
        "Interview Detail",
        "Stage Descriptor",
        "Operational Tags",
        "Notes / Unclassified",
        "Data Completeness",
        "Missing Fields",
        "Scheduling Readiness",
        "Parse Status",
        "Review Reason",
        "Source Hash",
        "Parser Version",
        "Parsed At"
      ]
    },

    CANDIDATE_EVENTS: {
      name:
        V2_CONFIG.SHEETS.CANDIDATE_EVENTS,
      headers: [
        "Event ID",
        "Candidate ID",
        "Team ID",
        "Event DateTime",
        "Event Type",
        "Client",
        "Round Label",
        "Round No",
        "Handler ID",
        "Handler Name",
        "Call ID",
        "Source",
        "Source Row",
        "Status",
        "Details",
        "Created At"
      ]
    },

    JOBS: {
      name:
        V2_CONFIG.SHEETS.JOBS,
      headers: [
        "Job ID",
        "Job Type",
        "User Email",
        "Role",
        "Team ID",
        "Status",
        "Stage",
        "Requested At",
        "Started At",
        "Finished At",
        "Message",
        "Error Code",
        "Error Detail"
      ]
    },

    NOTIFICATIONS: {
      name:
        V2_CONFIG.SHEETS.NOTIFICATIONS,
      headers: [
        "Notification ID",
        "Created At",
        "Target Type",
        "Target ID",
        "Team ID",
        "Severity",
        "Title",
        "Message",
        "Related Job ID",
        "Related Candidate ID",
        "Related Call ID",
        "Status",
        "Read At",
        "Acknowledged At",
        "Technical Details"
      ]
    }

  };
}


/******************************************************
 * PRIVATE: SHEET CREATION / VERIFICATION
 ******************************************************/
function V2_ensureSheet_(
  ss,
  sheetName,
  headers
){

  let sheet =
    ss.getSheetByName(
      sheetName
    );

  if(!sheet){

    sheet =
      ss.insertSheet(
        sheetName
      );

    sheet
      .getRange(
        1,
        1,
        1,
        headers.length
      )
      .setValues([
        headers
      ]);

    sheet.setFrozenRows(1);

    return sheet;
  }

  if(
    sheet.getLastRow() === 0
  ){

    sheet
      .getRange(
        1,
        1,
        1,
        headers.length
      )
      .setValues([
        headers
      ]);

    sheet.setFrozenRows(1);

    return sheet;
  }

  if(
    !V2_headersMatch_(
      sheet,
      headers
    )
  ){

    throw new Error(
      "V2_HEADER_MISMATCH|sheet=" +
      sheetName
    );

  }

  return sheet;
}


function V2_headersMatch_(
  sheet,
  headers
){

  if(
    sheet.getLastColumn() <
    headers.length
  ){
    return false;
  }

  const actual =
    sheet
      .getRange(
        1,
        1,
        1,
        headers.length
      )
      .getDisplayValues()[0]
      .map(
        function(value){
          return String(
            value || ""
          ).trim();
        }
      );

  for(
    let i = 0;
    i < headers.length;
    i++
  ){

    if(
      actual[i] !==
      headers[i]
    ){
      return false;
    }

  }

  return true;
}


function V2_formatHeader_(
  sheet,
  width
){

  sheet
    .getRange(
      1,
      1,
      1,
      width
    )
    .setFontWeight(
      "bold"
    )
    .setBackground(
      "#DCE6F8"
    )
    .setHorizontalAlignment(
      "center"
    );

  sheet.setFrozenRows(1);
}


/******************************************************
 * PRIVATE: TEAM MASTER SEED
 ******************************************************/
function V2_seedTeams_(){

  const ss =
    V2_backend_();

  const sheet =
    ss.getSheetByName(
      V2_CONFIG.SHEETS.TEAM_MASTER
    );

  if(!sheet){
    throw new Error(
      "V2_TEAM_MASTER_NOT_FOUND"
    );
  }

  const existing = {};

  if(
    sheet.getLastRow() > 1
  ){

    sheet
      .getRange(
        2,
        1,
        sheet.getLastRow() - 1,
        5
      )
      .getValues()
      .forEach(
        function(row){

          const id =
            String(
              row[0] || ""
            ).trim();

          if(id){
            existing[id] = true;
          }

        }
      );

  }

  const rows = [
    [
      V2_CONFIG.TEAM_IDS.PRADEEP,
      "Pradeep Anna Team",
      "SETUP_SUPPORT",
      true,
      "Dedicated setup-support assignment"
    ],
    [
      V2_CONFIG.TEAM_IDS.HYDERABAD,
      "Hyderabad Team",
      "SELF_SUPPORT",
      true,
      "Handler performs own setup; protected setup-gap rule will be configured in scheduler phase"
    ],
    [
      V2_CONFIG.TEAM_IDS.MARKETING,
      "Marketing Team",
      "SETUP_SUPPORT",
      true,
      "Dedicated setup-support assignment"
    ],
    [
      V2_CONFIG.TEAM_IDS.DEVELOPERS,
      "Developers Team",
      "SETUP_SUPPORT",
      true,
      "Dedicated setup-support assignment"
    ],
    [
      V2_CONFIG.TEAM_IDS.EXCLUSIVE,
      "Exclusive Team",
      "SETUP_SUPPORT",
      true,
      "Dedicated setup-support assignment"
    ]
  ];

  const missing =
    rows.filter(
      function(row){
        return !existing[
          row[0]
        ];
      }
    );

  if(missing.length){

    sheet
      .getRange(
        sheet.getLastRow() + 1,
        1,
        missing.length,
        5
      )
      .setValues(
        missing
      );

  }

  return missing.length;
}


/******************************************************
 * PRIVATE: GATEWAY STATUS VISUAL FORMATTING
 *
 * NOTE:
 * Business logic always reads the text value.
 * Color is visual only.
 ******************************************************/
function V2_applyGatewayStatusFormatting_(){

  const ss =
    V2_backend_();

  const sheet =
    ss.getSheetByName(
      V2_CONFIG.SHEETS.GATEWAY
    );

  if(!sheet){
    return;
  }

  const definitions =
    V2_sheetDefinitions_();

  const headers =
    definitions.GATEWAY.headers;

  const statusCol =
    headers.indexOf(
      "Parse Status"
    ) + 1;

  if(statusCol <= 0){
    return;
  }

  const range =
    sheet.getRange(
      2,
      statusCol,
      Math.max(
        1,
        sheet.getMaxRows() - 1
      ),
      1
    );

  const rules =
    sheet
      .getConditionalFormatRules()
      .filter(
        function(rule){

          const ranges =
            rule.getRanges();

          return !ranges.some(
            function(r){
              return (
                r.getColumn() ===
                  statusCol &&
                r.getSheet()
                  .getSheetId() ===
                  sheet.getSheetId()
              );
            }
          );

        }
      );

  rules.push(
    SpreadsheetApp
      .newConditionalFormatRule()
      .whenTextEqualTo(
        "READY"
      )
      .setBackground(
        "#D9EAD3"
      )
      .setRanges([
        range
      ])
      .build()
  );

  rules.push(
    SpreadsheetApp
      .newConditionalFormatRule()
      .whenTextEqualTo(
        "REVIEW"
      )
      .setBackground(
        "#FFF2CC"
      )
      .setRanges([
        range
      ])
      .build()
  );

  rules.push(
    SpreadsheetApp
      .newConditionalFormatRule()
      .whenTextEqualTo(
        "ERROR"
      )
      .setBackground(
        "#F4CCCC"
      )
      .setRanges([
        range
      ])
      .build()
  );

  rules.push(
    SpreadsheetApp
      .newConditionalFormatRule()
      .whenTextEqualTo(
        "NEW"
      )
      .setBackground(
        "#CFE2F3"
      )
      .setRanges([
        range
      ])
      .build()
  );

  sheet.setConditionalFormatRules(
    rules
  );
}


/******************************************************
 * PRIVATE: GENERIC HEADER MAP
 ******************************************************/
function V2_headerMap_(
  headerRow
){

  const map = {};

  (headerRow || [])
    .forEach(
      function(value,index){

        const key =
          String(
            value || ""
          ).trim();

        if(key){
          map[key] = index;
        }

      }
    );

  return map;
}


/******************************************************
 * SECTION 2: REPOSITORY / STORAGE ADAPTER
 * Former Apps Script file: V2Repository.gs
 ******************************************************/

/******************************************************
 * V2REPOSITORY.GS
 * Interview Operations Portal V2
 *
 * PRIVATE BACKEND REPOSITORY / STORAGE ADAPTER
 *
 * PURPOSE
 * -------
 * Keep Google Sheets access behind one data-access
 * boundary so business services do not scatter
 * getRange()/getValues() logic throughout V2.
 *
 * CURRENT STORAGE:
 *   Google Sheets
 *
 * FUTURE:
 *   This repository contract can be reimplemented
 *   against SQL/Postgres without changing portal
 *   business services.
 *
 * IMPORTANT
 * ---------
 * - This file does NOT change the live legacy system.
 * - Read methods are side-effect free.
 * - Business logic should consume repository objects,
 *   not raw row numbers.
 ******************************************************/


const V2_REPOSITORY_VERSION =
  "V2-REPOSITORY-2.0.0";


/******************************************************
 * PUBLIC/INTERNAL CONTRACT: READ TABLE
 *
 * sheetKey must be a key from V2_sheetDefinitions_():
 * TEAM_MASTER, USER_ACCESS, CANDIDATE_MASTER, GATEWAY...
 ******************************************************/
function V2Repo_readTable(
  sheetKey
){

  const table =
    V2Repo_readTableInternal_(
      sheetKey
    );

  return {
    sheetKey:
      table.sheetKey,
    sheetName:
      table.sheetName,
    headers:
      table.headers.slice(),
    rows:
      table.rows.map(
        function(row){
          return Object.assign(
            {},
            row
          );
        }
      )
  };

}


/******************************************************
 * REPOSITORY: TEAM MASTER
 ******************************************************/
function V2Repo_getTeams(){

  return V2Repo_readTableInternal_(
    "TEAM_MASTER"
  ).rows;

}


/******************************************************
 * REPOSITORY: USER ACCESS
 ******************************************************/
function V2Repo_getUsers(){

  return V2Repo_readTableInternal_(
    "USER_ACCESS"
  ).rows;

}


/******************************************************
 * REPOSITORY: CANDIDATE MASTER
 ******************************************************/
function V2Repo_getCandidates(){

  return V2Repo_readTableInternal_(
    "CANDIDATE_MASTER"
  ).rows;

}


/******************************************************
 * REPOSITORY: HANDLER MASTER
 ******************************************************/
function V2Repo_getHandlers(){

  return V2Repo_readTableInternal_(
    "HANDLER_MASTER"
  ).rows;

}


/******************************************************
 * REPOSITORY: SETUP SUPPORT MASTER
 ******************************************************/
function V2Repo_getSetupSupport(){

  return V2Repo_readTableInternal_(
    "SETUP_SUPPORT_MASTER"
  ).rows;

}


/******************************************************
 * REPOSITORY: DEVELOPER MASTER
 ******************************************************/
function V2Repo_getDevelopers(){

  return V2Repo_readTableInternal_(
    "DEVELOPER_MASTER"
  ).rows;

}


/******************************************************
 * REPOSITORY: SCREEN OPERATOR MASTER
 ******************************************************/
function V2Repo_getScreenOperators(){

  return V2Repo_readTableInternal_(
    "SCREEN_OPERATOR_MASTER"
  ).rows;

}


/******************************************************
 * REPOSITORY: CLIENT REGISTRY
 ******************************************************/
function V2Repo_getClients(){

  return V2Repo_readTableInternal_(
    "CLIENT_REGISTRY"
  ).rows;

}


/******************************************************
 * REPOSITORY: GATEWAY
 *
 * Optional filters:
 * {
 *   parseStatus: "READY",
 *   candidateId: "CAN-...",
 *   businessDateKey: "2026-08-15",
 *   schedulingReadiness: "...",
 *   limit: 100
 * }
 ******************************************************/
function V2Repo_getGateway(
  filters
){

  filters =
    filters || {};

  let rows =
    V2Repo_readTableInternal_(
      "GATEWAY"
    ).rows;

  rows =
    rows.filter(
      function(row){

        if(
          filters.parseStatus &&
          String(
            row["Parse Status"] || ""
          ).trim() !==
          String(
            filters.parseStatus
          ).trim()
        ){
          return false;
        }

        if(
          filters.candidateId &&
          String(
            row["Candidate ID"] || ""
          ).trim() !==
          String(
            filters.candidateId
          ).trim()
        ){
          return false;
        }

        if(
          filters.businessDateKey &&
          String(
            row["Business Date Key"] || ""
          ).trim() !==
          String(
            filters.businessDateKey
          ).trim()
        ){
          return false;
        }

        if(
          filters.schedulingReadiness &&
          String(
            row[
              "Scheduling Readiness"
            ] || ""
          ).trim() !==
          String(
            filters.schedulingReadiness
          ).trim()
        ){
          return false;
        }

        return true;

      }
    );

  const limit =
    Number(
      filters.limit
    );

  if(
    Number.isFinite(limit) &&
    limit > 0
  ){
    rows =
      rows.slice(
        0,
        Math.floor(
          limit
        )
      );
  }

  return rows;

}


/******************************************************
 * REPOSITORY: GATEWAY BY ID
 ******************************************************/
function V2Repo_getGatewayById(
  gatewayId
){

  const target =
    String(
      gatewayId || ""
    ).trim();

  if(!target)
    return null;

  const rows =
    V2Repo_getGateway();

  for(
    let i = 0;
    i < rows.length;
    i++
  ){

    if(
      String(
        rows[i]["Gateway ID"] || ""
      ).trim() === target
    ){
      return rows[i];
    }

  }

  return null;

}


/******************************************************
 * REPOSITORY: CANDIDATE BY ID
 ******************************************************/
function V2Repo_getCandidateById(
  candidateId
){

  const target =
    String(
      candidateId || ""
    ).trim();

  if(!target)
    return null;

  const rows =
    V2Repo_getCandidates();

  for(
    let i = 0;
    i < rows.length;
    i++
  ){

    if(
      String(
        rows[i]["Candidate ID"] || ""
      ).trim() === target
    ){
      return rows[i];
    }

  }

  return null;

}


/******************************************************
 * REPOSITORY: CANDIDATE BY OFFICIAL NAME
 *
 * Exact normalized lookup only.
 * Fuzzy candidate matching belongs to the Candidate
 * matching service, NOT the storage repository.
 ******************************************************/
function V2Repo_findCandidatesByOfficialName(
  officialName
){

  const target =
    V2Repo_normalizeLookup_(
      officialName
    );

  if(!target)
    return [];

  return V2Repo_getCandidates()
    .filter(
      function(row){

        return (
          V2Repo_normalizeLookup_(
            row[
              "Official Candidate Name"
            ]
          ) === target
        );

      }
    );

}


/******************************************************
 * PRIVATE: READ SHEET INTO OBJECT ROWS
 ******************************************************/
function V2Repo_readTableInternal_(
  sheetKey
){

  const definitions =
    V2_sheetDefinitions_();

  const definition =
    definitions[
      sheetKey
    ];

  if(!definition){
    throw new Error(
      "V2_REPOSITORY_UNKNOWN_SHEET_KEY|" +
      sheetKey
    );
  }

  const ss =
    V2_backend_();

  const sheet =
    ss.getSheetByName(
      definition.name
    );

  if(!sheet){
    throw new Error(
      "V2_REPOSITORY_SHEET_NOT_FOUND|" +
      definition.name
    );
  }

  const expectedHeaders =
    definition.headers.slice();

  if(
    !V2_headersMatch_(
      sheet,
      expectedHeaders
    )
  ){
    throw new Error(
      "V2_REPOSITORY_HEADER_MISMATCH|" +
      definition.name
    );
  }

  const lastRow =
    sheet.getLastRow();

  if(lastRow <= 1){
    return {
      sheetKey:
        sheetKey,
      sheetName:
        definition.name,
      headers:
        expectedHeaders,
      rows:
        []
    };
  }

  const values =
    sheet
      .getRange(
        2,
        1,
        lastRow - 1,
        expectedHeaders.length
      )
      .getValues();

  const rows = [];

  values.forEach(
    function(valuesRow,index){

      if(
        V2Repo_isBlankRow_(
          valuesRow
        )
      ){
        return;
      }

      const objectRow = {
        _sheetRow:
          index + 2
      };

      expectedHeaders.forEach(
        function(header,columnIndex){

          objectRow[
            header
          ] =
            valuesRow[
              columnIndex
            ];

        }
      );

      rows.push(
        objectRow
      );

    }
  );

  return {
    sheetKey:
      sheetKey,
    sheetName:
      definition.name,
    headers:
      expectedHeaders,
    rows:
      rows
  };

}


/******************************************************
 * PRIVATE: BLANK ROW
 ******************************************************/
function V2Repo_isBlankRow_(
  row
){

  if(
    !Array.isArray(row)
  ){
    return true;
  }

  for(
    let i = 0;
    i < row.length;
    i++
  ){

    if(
      String(
        row[i] || ""
      ).trim() !== ""
    ){
      return false;
    }

  }

  return true;

}


/******************************************************
 * PRIVATE: EXACT LOOKUP NORMALIZATION
 ******************************************************/
function V2Repo_normalizeLookup_(
  value
){

  return String(
    value || ""
  )
    .toLowerCase()
    .replace(
      /[^a-z0-9]+/g,
      " "
    )
    .replace(
      /\s+/g,
      " "
    )
    .trim();

}


/******************************************************
 * PRIVATE: DUPLICATE VALUE DETECTOR
 ******************************************************/
function V2Repo_findDuplicateValues_(
  rows,
  field
){

  const counts = {};

  rows.forEach(
    function(row){

      const value =
        String(
          row[field] || ""
        ).trim();

      if(!value)
        return;

      counts[value] =
        (
          counts[value] || 0
        ) + 1;

    }
  );

  return Object.keys(
    counts
  )
    .filter(
      function(value){
        return (
          counts[value] > 1
        );
      }
    )
    .map(
      function(value){
        return {
          value:
            value,
          count:
            counts[value]
        };
      }
    );

}


/******************************************************
 * REPOSITORY: CANDIDATE PROFILE BY ID
 *
 * Returns the current Candidate Master profile only.
 * Call/interview history belongs to Candidate Events /
 * Operational Calls and will be joined by Candidate 360
 * service later.
 ******************************************************/
function V2Repo_getCandidateProfileById(
  candidateId
){

  return V2Repo_getCandidateById(
    candidateId
  );

}


/******************************************************
 * REPOSITORY: CANDIDATE PROFILE FIELDS
 *
 * Central contract used later by Candidate 360/UI.
 ******************************************************/
function V2Repo_candidateProfileFields_(){

  return [
    "Candidate ID",
    "Official Candidate Name",
    "Email",
    "Active Status",
    "Assigned Domains",
    "Location",
    "Assigned To User ID",
    "Assigned To Name",
    "Priority Student",
    "Date of Joining",
    "Visa Type",
    "Experience",
    "Active",
    "Notes",
    "Created At",
    "Updated At"
  ];

}


/******************************************************
 * SECTION 3: STRUCTURED GATEWAY — PARSER 1.4.0 + MATCHER INTEGRATION
 * Former Apps Script file: V2Gateway.gs
 ******************************************************/

/******************************************************
 * V2GATEWAY.GS
 * Interview Operations Portal V2 - Structured Gateway
 *
 * PURPOSE
 * -------
 * Read the existing single-cell Raw Data feed WITHOUT
 * modifying it and create a structured shadow record.
 *
 * IMPORTANT
 * ---------
 * - Original Raw Data is NEVER edited here.
 * - Every non-date source record produces a Gateway row.
 * - Parse uncertainty becomes REVIEW, never silent skip.
 * - Candidate Master is authoritative for official names.
 * - Client names are recognized/suggested only; never
 *   auto-corrected by this file.
 * - Candidate identity resolution is delegated to the
 *   repository-backed V2 Candidate Matcher Service.
 ******************************************************/

const V2_GATEWAY_CONFIG = Object.freeze({

  PARSER_VERSION:
    "GW-PARSER-1.4.0",

  SOURCE_SHEET_FALLBACK:
    "Raw Data",

  AUTO_CANDIDATE_SIMILARITY:
    0.96,

  AUTO_CANDIDATE_MARGIN:
    0.03,

  CLIENT_SUGGESTION_SIMILARITY:
    0.88

});


/******************************************************
 * PUBLIC: READ-ONLY SAMPLE PARSER PREVIEW
 ******************************************************/
function V2_previewGatewaySamples(){

  const samples = [

    "Sai nikhil velagapudi – Interview – Merck & Co. – 12:40 AM IST – Duration: 20 Mins (1st Round)",

    "Sumasree Bodela – Interview – Voloridge - interview (1 st round) – 1:00 AM IST – Duration: 15 Mins",

    "lavanya akiri – Interview – psiquantum – 1:30 AM IST – Duration: 60 Mins (2nd Round)",

    "Venkata Koushik Reddy Varikoti – Interview – Loop Interview - HD Supply – 6:30 PM IST – Duration: 30 Mins (3rd Round)",

    "Achyuth gowtham – Interview – Michigan Department of Community Health - Discussion Round – 7:00 PM IST – Duration: 30 Mins"

  ];

  Logger.log(
    "========== V2 GATEWAY SAMPLE PREVIEW =========="
  );

  samples.forEach(
    function(text,index){

      const parsed =
        V2_gatewayParseText_(
          text
        );

      Logger.log(
        "SAMPLE " +
        (index + 1) +
        " : " +
        JSON.stringify(
          parsed,
          null,
          2
        )
      );

    }
  );

  Logger.log(
    "================================================"
  );
}


/******************************************************
 * PUBLIC: READ-ONLY PREVIEW OF FIRST 20 REAL RAW ROWS
 ******************************************************/
function V2_previewGatewayRaw20(){

  const rows =
    V2_readRawSourceRecords_();

  const candidateMaster =
    V2_loadCandidateMaster_();

  const clientRegistry =
    V2_loadClientRegistry_();

  const preview =
    rows
      .slice(
        0,
        20
      )
      .map(
        function(source){

          return V2_buildGatewayObject_(
            source,
            candidateMaster,
            clientRegistry
          );

        }
      );

  Logger.log(
    "========== V2 GATEWAY REAL RAW PREVIEW =========="
  );

  Logger.log(
    JSON.stringify(
      {
        totalSourceRecords:
          rows.length,
        previewCount:
          preview.length,
        records:
          preview
      },
      null,
      2
    )
  );

  Logger.log(
    "================================================="
  );

  return preview;
}


/******************************************************
 * PUBLIC: SHADOW GATEWAY REBUILD
 *
 * Writes ONLY V2 Interview Gateway in private backend.
 * Does not touch live Raw/Team/current incentive data.
 ******************************************************/
function V2_rebuildGatewayShadow(){

  const started =
    Date.now();

  const sourceRecords =
    V2_readRawSourceRecords_();

  const candidateMaster =
    V2_loadCandidateMaster_();

  const clientRegistry =
    V2_loadClientRegistry_();

  const rows = [];
  const statusCounts = {};
  const candidateCounts = {};

  sourceRecords.forEach(
    function(source){

      const record =
        V2_buildGatewayObject_(
          source,
          candidateMaster,
          clientRegistry
        );

      rows.push(
        V2_gatewayObjectToRow_(
          record
        )
      );

      statusCounts[
        record.parseStatus
      ] =
        (
          statusCounts[
            record.parseStatus
          ] || 0
        ) + 1;

      candidateCounts[
        record.candidateMatchStatus
      ] =
        (
          candidateCounts[
            record.candidateMatchStatus
          ] || 0
        ) + 1;

    }
  );

  const ss =
    V2_backend_();

  const sheet =
    ss.getSheetByName(
      V2_CONFIG.SHEETS.GATEWAY
    );

  if(!sheet){
    throw new Error(
      "V2_GATEWAY_SHEET_NOT_FOUND|run=V2_setupFoundation"
    );
  }

  const headers =
    V2_sheetDefinitions_()
      .GATEWAY
      .headers;

  if(
    !V2_headersMatch_(
      sheet,
      headers
    )
  ){
    throw new Error(
      "V2_GATEWAY_HEADER_MISMATCH"
    );
  }

  if(
    sheet.getLastRow() > 1
  ){

    sheet
      .getRange(
        2,
        1,
        sheet.getLastRow() - 1,
        headers.length
      )
      .clearContent();

  }

  if(rows.length){

    sheet
      .getRange(
        2,
        1,
        rows.length,
        headers.length
      )
      .setValues(
        rows
      );

  }

  V2_applyGatewayStatusFormatting_();

  const result = {
    ok:
      true,
    sourceRecords:
      sourceRecords.length,
    gatewayRows:
      rows.length,
    parseStatus:
      statusCounts,
    candidateMatchStatus:
      candidateCounts,
    elapsedMs:
      Date.now() - started,
    parserVersion:
      V2_GATEWAY_CONFIG.PARSER_VERSION
  };

  Logger.log(
    "========== V2 GATEWAY SHADOW REBUILD =========="
  );

  Logger.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );

  Logger.log(
    "==============================================="
  );

  return result;
}


/******************************************************
 * PRIVATE: READ CURRENT RAW DATA WITHOUT MUTATION
 ******************************************************/
function V2_readRawSourceRecords_(){

  const operations =
    V2_operations_();

  const sheetName =
    (
      typeof CONFIG !==
        "undefined" &&
      CONFIG.RAW_SHEET
    )
      ? CONFIG.RAW_SHEET
      : V2_GATEWAY_CONFIG
          .SOURCE_SHEET_FALLBACK;

  const sheet =
    operations.getSheetByName(
      sheetName
    );

  if(!sheet){
    throw new Error(
      "V2_RAW_DATA_SHEET_NOT_FOUND|sheet=" +
      sheetName
    );
  }

  const values =
    sheet
      .getDataRange()
      .getValues();

  const records = [];
  let currentDate = null;

  for(
    let i = 0;
    i < values.length;
    i++
  ){

    const value =
      values[i][1];

    if(
      value instanceof Date &&
      !isNaN(
        value.getTime()
      )
    ){

      currentDate =
        new Date(
          value.getFullYear(),
          value.getMonth(),
          value.getDate()
        );

      continue;
    }

    const text =
      String(
        value || ""
      ).trim();

    if(!text){
      continue;
    }

    records.push({
      sourceSheet:
        sheetName,
      sourceRow:
        i + 1,
      sourceDate:
        currentDate
          ? new Date(
              currentDate
            )
          : null,
      originalText:
        text
    });

  }

  return records;
}


/******************************************************
 * PRIVATE: BUILD COMPLETE GATEWAY OBJECT
 ******************************************************/
function V2_buildGatewayObject_(
  source,
  candidateMaster,
  clientRegistry
){

  const parsed =
    V2_gatewayParseText_(
      source.originalText
    );

  const candidateMatch =
    V2_matchCandidate_(
      parsed.candidateRaw,
      candidateMaster,
      {
        originalRecord:
          source.originalText
      }
    );

  const clientSuggestion =
    V2_suggestClient_(
      parsed.clientRaw,
      clientRegistry
    );

  // Parse Status is ONLY about parser certainty.
  // Candidate matching and source completeness remain
  // independent states.
  const review =
    parsed.reviewReasons
      .slice();

  const parseStatus =
    review.length
      ? "REVIEW"
      : "READY";

  const businessDateKey =
    source.sourceDate
      ? Utilities.formatDate(
          source.sourceDate,
          Session.getScriptTimeZone(),
          "yyyy-MM-dd"
        )
      : "";

  const sourceHash =
    V2_sha256Hex_(
      (
        businessDateKey ||
        "NO_DATE"
      ) +
      "|" +
      source.sourceRow +
      "|" +
      source.originalText
    );

  return {

    gatewayId:
      "GW-" +
      sourceHash
        .substring(
          0,
          18
        )
        .toUpperCase(),

    sourceSheet:
      source.sourceSheet,

    sourceRow:
      source.sourceRow,

    sourceDate:
      source.sourceDate || "",

    businessDateKey:
      businessDateKey,

    teamId:
      "",

    originalRecord:
      source.originalText,

    candidateRaw:
      parsed.candidateRaw,

    candidateId:
      candidateMatch.candidateId,

    officialCandidateName:
      candidateMatch.officialName,

    candidateMatchStatus:
      candidateMatch.status,

    candidateMatchScore:
      candidateMatch.score,

    clientRaw:
      parsed.clientRaw,

    clientSuggestedMatch:
      clientSuggestion.suggested,

    clientMatchScore:
      clientSuggestion.score,

    timeRaw:
      parsed.timeRaw,

    timeNormalized:
      parsed.timeNormalized,

    startMinutes:
      parsed.startMinutes,

    durationRaw:
      parsed.durationRaw,

    durationMinutes:
      parsed.durationMinutes,

    endMinutes:
      parsed.endMinutes,

    roundRaw:
      parsed.roundRaw,

    roundLabel:
      parsed.roundLabel,

    roundNo:
      parsed.roundNo,

    interviewType:
      parsed.interviewType,

    interviewDetail:
      parsed.interviewDetail,

    stageDescriptor:
      parsed.stageDescriptor,

    operationalTags:
      parsed.operationalTags.join(
        " | "
      ),

    notesUnclassified:
      parsed.notesUnclassified.join(
        " | "
      ),

    dataCompleteness:
      parsed.dataCompleteness,

    missingFields:
      parsed.missingFields.join(
        " | "
      ),

    schedulingReadiness:
      parsed.schedulingReadiness,

    parseStatus:
      parseStatus,

    reviewReason:
      review.join(
        " | "
      ),

    sourceHash:
      sourceHash,

    parserVersion:
      V2_GATEWAY_CONFIG.PARSER_VERSION,

    parsedAt:
      new Date()

  };
}


function V2_gatewayObjectToRow_(
  record
){

  return [
    record.gatewayId,
    record.sourceSheet,
    record.sourceRow,
    record.sourceDate,
    record.businessDateKey,
    record.teamId,
    record.originalRecord,
    record.candidateRaw,
    record.candidateId,
    record.officialCandidateName,
    record.candidateMatchStatus,
    record.candidateMatchScore,
    record.clientRaw,
    record.clientSuggestedMatch,
    record.clientMatchScore,
    record.timeRaw,
    record.timeNormalized,
    record.startMinutes,
    record.durationRaw,
    record.durationMinutes,
    record.endMinutes,
    record.roundRaw,
    record.roundLabel,
    record.roundNo,
    record.interviewType,
    record.interviewDetail,
    record.stageDescriptor,
    record.operationalTags,
    record.notesUnclassified,
    record.dataCompleteness,
    record.missingFields,
    record.schedulingReadiness,
    record.parseStatus,
    record.reviewReason,
    record.sourceHash,
    record.parserVersion,
    record.parsedAt
  ];
}


/******************************************************
 * PRIVATE: CORE TEXT PARSER
 ******************************************************/
function V2_gatewayParseText_(
  input
){

  const original =
    String(
      input || ""
    ).trim();

  const reviewReasons = [];
  const missingFields = [];
  const operationalTags = [];
  const notesUnclassified = [];

  if(!original){

    return {
      candidateRaw: "",
      clientRaw: "",
      timeRaw: "",
      timeNormalized: "",
      startMinutes: "",
      durationRaw: "",
      durationMinutes: "",
      endMinutes: "",
      roundRaw: "",
      roundLabel: "",
      roundNo: "",
      interviewType: "",
      interviewDetail: "",
      stageDescriptor: "",
      operationalTags: [],
      notesUnclassified: [],
      missingFields: [
        "CANDIDATE",
        "CLIENT",
        "INTERVIEW_TYPE",
        "TIME",
        "DURATION",
        "ROUND"
      ],
      dataCompleteness:
        "EMPTY",
      schedulingReadiness:
        "SOURCE_REVIEW_REQUIRED",
      reviewReasons: [
        "EMPTY_SOURCE_RECORD"
      ]
    };

  }

  const text =
    V2_normalizeSeparators_(
      original
    );

  //--------------------------------------------------
  // Broad interaction type + specific interview detail.
  //
  // Examples:
  //   Technical Interview -> Type=Interview,
  //                          Detail=Technical Interview
  //   Excel Interview     -> Type=Interview,
  //                          Detail=Excel Interview
  //   AI Interview        -> Type=Interview,
  //                          Detail=AI Interview
  //   Zoom Interview      -> Type=Interview,
  //                          Detail=Zoom Interview
  //
  // Discussion / Technical Discussion / Final Discussion
  // remain Stage Descriptor because they can describe the
  // stage while an explicit numbered round may also exist.
  //--------------------------------------------------

  const typeRegex =
    /\b(Technical\s+Loop\s+Interview|Technical\s+Coding\s+Interview|Candidate\s+Side\s+Interview|Assessment\s+through\s+Interview|Hiring\s+Manager\s+Interview|Assessment\s+Interview|Behavioral\s+Interview|Technical\s+Interview|Final\s+Interview|Coding\s+Interview|Loop\s+Interview|Panel\s+Interview|Excel\s+Interview|AI\s+Interview|Manager\s+Interview|Microsoft\s+Teams\s+Interview|Google\s+Meet\s+Interview|Google\s+Voice\s+Call|Phone\s+Interview|Phn\s+Interview|Phone\s+Screen|Recruiter\s+Call|Phone\s+Call|Phn\s+Call|Teams\s+Interview|Zoom\s+Interview|Coding\s+Round|Prep\s+Call|Interview)\b/i;

  const typeMatch =
    typeRegex.exec(
      text
    );

  const stageInfo =
    V2_extractStageDescriptor_(
      text
    );

  //--------------------------------------------------
  // Descriptor immediately attached to interaction type,
  // e.g. Interview (STAR Technique) - Client.
  //--------------------------------------------------

  let typeAdjacentDescriptor = "";

  if(typeMatch){

    const afterType =
      text.substring(
        typeMatch.index +
        typeMatch[0].length
      );

    const descriptorMatch =
      /^\s*\(([^)]{1,80})\)/.exec(
        afterType
      );

    if(descriptorMatch){

      const descriptor =
        String(
          descriptorMatch[1] || ""
        )
          .replace(
            /\s+/g,
            " "
          )
          .trim();

      if(
        descriptor &&
        !/\b(?:\d+(?:st|nd|rd|th)?\s*round|waiting|rescheduled|duration|mins?|minutes?|hrs?|hours?|candidate(?:['’]s)?\s+(?:1st|first)\s+interview)\b/i.test(
          descriptor
        )
      ){
        typeAdjacentDescriptor =
          descriptor;
      }

    }

  }

  let interviewType = "";
  let interviewDetail = "";

  if(typeMatch){

    interviewType =
      V2_normalizeInterviewType_(
        typeMatch[1]
      );

    interviewDetail =
      V2_extractSpecificInterviewDetail_(
        text
      ) ||
      V2_extractInterviewDetailFromType_(
        typeMatch[1]
      );

  }else if(stageInfo.label){

    interviewType =
      "Interview";

  }else{

    missingFields.push(
      "INTERVIEW_TYPE"
    );

  }

  // Business rule from operations:
  // Technical / coding interview wording is a meaningful
  // signal that developer participation should be surfaced.
  // This is a tag only; it does NOT auto-assign a developer.
  if(
    interviewDetail ===
      "Technical Interview" ||
    interviewDetail ===
      "Technical Coding Interview" ||
    interviewDetail ===
      "Technical Loop Interview"
  ){
    operationalTags.push(
      "Need Developer"
    );
  }

  //--------------------------------------------------
  // Time
  //--------------------------------------------------

  const timeMatch =
    /\b(\d{1,2})(?:\s*[:.]\s*(\d{2}))?\s*([AaPp])\.?[Mm]\.?\b/.exec(
      text
    );

  // A clock value without AM/PM is useful source evidence,
  // but V2 must never guess whether it is AM or PM.
  const ambiguousTimeMatch =
    timeMatch
      ? null
      : /\b(\d{1,2})\s*[:.]\s*(\d{2})\b/.exec(
          text
        );

  const timeBoundaryMatch =
    timeMatch ||
    ambiguousTimeMatch;

  let timeRaw =
    ambiguousTimeMatch
      ? ambiguousTimeMatch[0]
      : "";
  let timeNormalized = "";
  let startMinutes = "";

  if(timeMatch){

    timeRaw =
      timeMatch[0];

    const hour =
      Number(
        timeMatch[1]
      );

    const minute =
      Number(
        timeMatch[2] || 0
      );

    const ampm =
      String(
        timeMatch[3]
      ).toUpperCase();

    if(
      hour >= 1 &&
      hour <= 12 &&
      minute >= 0 &&
      minute <= 59
    ){

      timeNormalized =
        hour +
        ":" +
        String(
          minute
        ).padStart(
          2,
          "0"
        ) +
        " " +
        ampm +
        "M";

      startMinutes =
        V2_timeToMinutes_(
          hour,
          minute,
          ampm
        );

    }else{

      reviewReasons.push(
        "TIME_INVALID"
      );

    }

  }else{

    missingFields.push(
      "TIME"
    );

  }

  //--------------------------------------------------
  // Candidate anchor.
  //
  // Type can appear AFTER client:
  // Candidate - Client - Phone Interview - Time
  //
  // So before the anchor we keep the first segment as
  // candidate and preserve any additional segment(s)
  // as possible client text.
  //--------------------------------------------------

  let anchorMatch = null;

  if(typeMatch){
    anchorMatch = {
      index:
        typeMatch.index,
      text:
        typeMatch[0]
    };
  }else if(
    stageInfo.label &&
    (
      !timeBoundaryMatch ||
      stageInfo.index <
        timeBoundaryMatch.index
    )
  ){
    anchorMatch = {
      index:
        stageInfo.index,
      text:
        stageInfo.raw
    };
  }

  let candidateRaw = "";
  let preAnchorMiddle = "";

  if(anchorMatch){

    let beforeAnchor =
      text
        .substring(
          0,
          anchorMatch.index
        )
        .replace(
          /\s*-\s*$/,
          ""
        )
        .trim();

    const beforeParts =
      beforeAnchor
        .split(
          /\s+-\s+/
        )
        .map(
          function(value){
            return String(
              value || ""
            ).trim();
          }
        )
        .filter(Boolean);

    if(beforeParts.length){

      candidateRaw =
        beforeParts[0]
          .replace(
            /\([^)]*\)/g,
            " "
          )
          .replace(
            /\s+/g,
            " "
          )
          .trim();

      if(beforeParts.length > 1){

        preAnchorMiddle =
          beforeParts
            .slice(
              1
            )
            .join(
              " - "
            );

      }

    }

  }else{

    const firstDashMatch =
      /\s+-\s+/.exec(
        text
      );

    if(firstDashMatch){

      candidateRaw =
        text
          .substring(
            0,
            firstDashMatch.index
          )
          .replace(
            /\([^)]*\)/g,
            " "
          )
          .replace(
            /\s+/g,
            " "
          )
          .trim();

    }

  }

  if(!candidateRaw){

    missingFields.push(
      "CANDIDATE"
    );

    reviewReasons.push(
      "CANDIDATE_NOT_EXTRACTED"
    );

  }

  //--------------------------------------------------
  // Duration
  //--------------------------------------------------

  const duration =
    V2_extractDuration_(
      text
    );

  if(!duration.minutes){

    missingFields.push(
      "DURATION"
    );

  }

  //--------------------------------------------------
  // Round
  //--------------------------------------------------

  const round =
    V2_extractRound_(
      text
    );

  if(!round.label){

    missingFields.push(
      "ROUND"
    );

  }

  //--------------------------------------------------
  // Middle business segment => client / tags / notes
  //--------------------------------------------------

  let middleAfterAnchor = "";

  if(anchorMatch){

    const middleStart =
      anchorMatch.index +
      anchorMatch.text.length;

    const middleEnd =
      (
        timeBoundaryMatch &&
        timeBoundaryMatch.index >
          middleStart
      )
        ? timeBoundaryMatch.index
        : text.length;

    middleAfterAnchor =
      text.substring(
        middleStart,
        middleEnd
      );

  }else{

    const fallbackFirstDash =
      /\s+-\s+/.exec(
        text
      );

    const fallbackStart =
      fallbackFirstDash
        ? fallbackFirstDash.index +
          fallbackFirstDash[0].length
        : 0;

    const fallbackEnd =
      timeBoundaryMatch
        ? timeBoundaryMatch.index
        : text.length;

    middleAfterAnchor =
      text.substring(
        fallbackStart,
        fallbackEnd
      );

  }

  let middle =
    [
      preAnchorMiddle,
      middleAfterAnchor
    ]
      .filter(Boolean)
      .join(
        " - "
      );

  middle =
    middle
      .replace(
        /^\s*-\s*/,
        ""
      )
      .replace(
        /\s*-\s*$/,
        ""
      );

  middle =
    V2_removeDurationText_(
      middle
    );

  middle =
    V2_removeRoundText_(
      middle
    );

  if(typeAdjacentDescriptor){

    middle =
      middle
        .replace(
          new RegExp(
            "\\(\\s*" +
            V2_escapeRegex_(
              typeAdjacentDescriptor
            ) +
            "\\s*\\)",
            "ig"
          ),
          " "
        )
        .replace(
          new RegExp(
            V2_escapeRegex_(
              typeAdjacentDescriptor
            ),
            "ig"
          ),
          " "
        );

    operationalTags.push(
      typeAdjacentDescriptor
    );

  }

  if(interviewDetail){

    middle =
      middle.replace(
        new RegExp(
          V2_escapeRegex_(
            interviewDetail
          ),
          "ig"
        ),
        " "
      );

  }

  middle =
    V2_stripKnownAnnotationsFromMiddle_(
      middle
    );

  if(ambiguousTimeMatch){

    middle =
      middle.replace(
        new RegExp(
          V2_escapeRegex_(
            ambiguousTimeMatch[0]
          ),
          "g"
        ),
        " "
      );

  }

  // Remove the structured stage descriptor from client
  // candidate text. It remains preserved separately.
  if(stageInfo.raw){

    const escapedStage =
      V2_escapeRegex_(
        stageInfo.raw
      );

    middle =
      middle.replace(
        new RegExp(
          escapedStage,
          "ig"
        ),
        " "
      );

  }

  middle =
    middle
      .replace(
        /\bIST\b/ig,
        " "
      )
      .replace(
        /\(\s*\)/g,
        " "
      )
      .replace(
        /\s+/g,
        " "
      )
      .trim();

  const classified =
    V2_classifyMiddleSegments_(
      middle
    );

  Array.prototype.push.apply(
    operationalTags,
    classified.operationalTags
  );

  Array.prototype.push.apply(
    notesUnclassified,
    classified.notes
  );

  const wholeAnnotations =
    V2_extractWholeRecordAnnotations_(
      text
    );

  Array.prototype.push.apply(
    operationalTags,
    wholeAnnotations.operationalTags
  );

  Array.prototype.push.apply(
    notesUnclassified,
    wholeAnnotations.notes
  );

  if(stageInfo.label){

    // Keep only the most specific structured discussion
    // descriptor. This avoids both "Technical Discussion"
    // and "Final Technical Discussion" being stored for
    // the same source record.
    for(
      let t = operationalTags.length - 1;
      t >= 0;
      t--
    ){

      if(
        /discussion/i.test(
          String(
            operationalTags[t] || ""
          )
        )
      ){
        operationalTags.splice(
          t,
          1
        );
      }

    }

    operationalTags.push(
      stageInfo.label
    );

  }

  let clientRaw =
    classified.clientSegments
      .join(
        " - "
      )
      .replace(
        /^[-;:,\s]+|[-;:,\s]+$/g,
        ""
      )
      .replace(
        /\s+/g,
        " "
      )
      .trim();

  // Rare source order:
  // Candidate - Interview - TIME IST Client (Round)
  // Recover a trailing client only when the normal client
  // area is empty. Never overwrite an already extracted
  // client and never guess from annotation text.
  if(
    !clientRaw &&
    timeBoundaryMatch
  ){

    let trailing =
      text.substring(
        timeBoundaryMatch.index +
        timeBoundaryMatch[0].length
      );

    trailing =
      V2_removeDurationText_(
        trailing
      );

    trailing =
      V2_removeRoundText_(
        trailing
      );

    trailing =
      V2_stripKnownAnnotationsFromMiddle_(
        trailing
      );

    if(stageInfo.raw){

      trailing =
        trailing.replace(
          new RegExp(
            V2_escapeRegex_(
              stageInfo.raw
            ),
            "ig"
          ),
          " "
        );

    }

    trailing =
      trailing
        .replace(
          /\bIST\b/ig,
          " "
        )
        .replace(
          /[()]/g,
          " "
        )
        .replace(
          /^[-;:,\s]+|[-;:,\s]+$/g,
          ""
        )
        .replace(
          /\s+/g,
          " "
        )
        .trim();

    if(
      trailing &&
      !/^(interview|phone interview|phone call|phn call|phn interview|prep call)$/i.test(
        trailing
      )
    ){

      const trailingClassified =
        V2_classifyMiddleSegments_(
          trailing
        );

      if(
        trailingClassified.clientSegments.length ===
          1
      ){

        clientRaw =
          trailingClassified.clientSegments[0]
            .trim();

      }

    }

  }

  if(!clientRaw){

    missingFields.push(
      "CLIENT"
    );

    reviewReasons.push(
      "CLIENT_NOT_EXTRACTED"
    );

  }

  if(
    classified.clientSegments.length > 1
  ){

    reviewReasons.push(
      "CLIENT_HAS_MULTIPLE_UNCLASSIFIED_SEGMENTS"
    );

  }

  let endMinutes = "";

  if(
    startMinutes !== "" &&
    duration.minutes
  ){

    endMinutes =
      Number(
        startMinutes
      ) +
      Number(
        duration.minutes
      );

  }

  const uniqueMissing =
    V2_uniqueStrings_(
      missingFields
    );

  const uniqueNotes =
    V2_uniqueStrings_(
      notesUnclassified
    );

  const uniqueReview =
    V2_uniqueStrings_(
      reviewReasons
    );

  const state =
    V2_deriveGatewaySourceState_({
      candidateRaw:
        candidateRaw,
      clientRaw:
        clientRaw,
      timeNormalized:
        timeNormalized,
      durationMinutes:
        duration.minutes,
      missingFields:
        uniqueMissing,
      notes:
        uniqueNotes,
      reviewReasons:
        uniqueReview
    });

  return {

    candidateRaw:
      candidateRaw,

    clientRaw:
      clientRaw,

    timeRaw:
      timeRaw,

    timeNormalized:
      timeNormalized,

    startMinutes:
      startMinutes,

    durationRaw:
      duration.raw,

    durationMinutes:
      duration.minutes,

    endMinutes:
      endMinutes,

    roundRaw:
      round.raw,

    roundLabel:
      round.label,

    roundNo:
      round.number,

    interviewType:
      interviewType,

    interviewDetail:
      interviewDetail,

    stageDescriptor:
      stageInfo.label,

    operationalTags:
      V2_uniqueStrings_(
        operationalTags
      ),

    notesUnclassified:
      uniqueNotes,

    missingFields:
      uniqueMissing,

    dataCompleteness:
      state.dataCompleteness,

    schedulingReadiness:
      state.schedulingReadiness,

    reviewReasons:
      uniqueReview

  };
}



/******************************************************
 * PRIVATE: INTERVIEW DETAIL / FORMAT / FOCUS
 *
 * "Interview Type" remains broad operational category.
 * This field preserves what kind of interview was named
 * in Raw Data without contaminating Client or Round.
 ******************************************************/
function V2_extractInterviewDetailFromType_(
  value
){

  const raw =
    String(
      value || ""
    ).trim();

  const key =
    V2_normalizeKey_(
      raw
    );

  const mapping = {
    "technical loop interview":
      "Technical Loop Interview",
    "technical interview":
      "Technical Interview",
    "technical coding interview":
      "Technical Coding Interview",
    "final interview":
      "Final Interview",
    "loop interview":
      "Loop Interview",
    "candidate side interview":
      "Candidate Side Interview",
    "behavioral interview":
      "Behavioral Interview",
    "coding interview":
      "Coding Interview",
    "coding round":
      "Coding Round",
    "assessment through interview":
      "Assessment through Interview",
    "excel interview":
      "Excel Interview",
    "ai interview":
      "AI Interview",
    "panel interview":
      "Panel Interview",
    "hiring manager interview":
      "Hiring Manager Interview",
    "manager interview":
      "Manager Interview",
    "assessment interview":
      "Assessment Interview",
    "zoom interview":
      "Zoom Interview",
    "teams interview":
      "Teams Interview",
    "microsoft teams interview":
      "Microsoft Teams Interview",
    "google meet interview":
      "Google Meet Interview",
    "google voice call":
      "Google Voice Call",
    "phn interview":
      "Phn Interview",
    "phone screen":
      "Phone Screen",
    "prep call":
      "Prep Call"
  };

  return mapping[key] || "";
}


/******************************************************
 * PRIVATE: SPECIFIC INTERVIEW DETAIL FROM WHOLE RECORD
 ******************************************************/
function V2_extractSpecificInterviewDetail_(
  text
){

  const source =
    String(
      text || ""
    );

  const patterns = [
    { regex: /\bTechnical\s+Loop\s+Interview\b/i, value: "Technical Loop Interview" },
    { regex: /\bTechnical\s+Coding\s+Interview\b/i, value: "Technical Coding Interview" },
    { regex: /\bCandidate\s+Side\s+Interview\b/i, value: "Candidate Side Interview" },
    { regex: /\bAssessment\s+through\s+Interview\b/i, value: "Assessment through Interview" },
    { regex: /\bBehavioral\s+Interview\b/i, value: "Behavioral Interview" },
    { regex: /\bTechnical\s+Interview\b/i, value: "Technical Interview" },
    { regex: /\bFinal\s+Interview\b/i, value: "Final Interview" },
    { regex: /\bCoding\s+Interview\b/i, value: "Coding Interview" },
    { regex: /\bLoop\s+Interview\b/i, value: "Loop Interview" },
    { regex: /\bCoding\s+Round\b/i, value: "Coding Round" }
  ];

  for(
    let i = 0;
    i < patterns.length;
    i++
  ){
    if(
      patterns[i].regex.test(
        source
      )
    ){
      return patterns[i].value;
    }
  }

  return "";
}


/******************************************************
 * PRIVATE: STAGE DESCRIPTOR
 ******************************************************/
function V2_extractStageDescriptor_(
  text
){

  const source =
    String(
      text || ""
    );

  const patterns = [
    /Final\s+Technical\s+Discussion\s+w\/\s*Hiring\s+Manager/i,
    /Final\s+Technical\s+Discussion\s+Round/i,
    /Final\s+Technical\s+Discussion/i,
    /Final\s+Discussion\s+Round/i,
    /Final\s+Discussion/i,
    /Technical\s+Discussion\s+w\/\s*Hiring\s+Manager/i,
    /Technical\s+Discussion\s+Round/i,
    /Technical\s+Discussion/i,
    /Hiring\s+Manager\s+Discussion/i,
    /Discussion\s+Round/i,
    /\bDiscussion\b/i
  ];

  for(
    let i = 0;
    i < patterns.length;
    i++
  ){

    const match =
      patterns[i].exec(
        source
      );

    if(match){

      return {
        raw:
          match[0],
        label:
          V2_canonicalStageDescriptor_(
            match[0]
          ),
        index:
          match.index
      };

    }

  }

  return {
    raw: "",
    label: "",
    index: -1
  };
}


function V2_canonicalStageDescriptor_(
  value
){

  const key =
    V2_normalizeKey_(
      value
    );

  if(
    key ===
      "final technical discussion w hiring manager"
  )
    return "Final Technical Discussion w/ Hiring Manager";

  if(
    key ===
      "final technical discussion round"
  )
    return "Final Technical Discussion Round";

  if(
    key ===
      "final technical discussion"
  )
    return "Final Technical Discussion";

  if(
    key ===
      "final discussion round"
  )
    return "Final Discussion Round";

  if(
    key ===
      "final discussion"
  )
    return "Final Discussion";

  if(
    key ===
      "technical discussion w hiring manager"
  )
    return "Technical Discussion w/ Hiring Manager";

  if(
    key ===
      "technical discussion round"
  )
    return "Technical Discussion Round";

  if(
    key ===
      "technical discussion"
  )
    return "Technical Discussion";

  if(
    key ===
      "hiring manager discussion"
  )
    return "Hiring Manager Discussion";

  if(
    key ===
      "discussion round"
  )
    return "Discussion Round";

  if(
    key ===
      "discussion"
  )
    return "Discussion";

  return String(
    value || ""
  ).trim();
}


/******************************************************
 * PRIVATE: SOURCE COMPLETENESS / READINESS
 ******************************************************/
function V2_deriveGatewaySourceState_(
  data
){

  const missing =
    data.missingFields || [];

  const notesText =
    (data.notes || [])
      .join(
        " "
      )
      .toLowerCase();

  const waiting =
    /waiting|confirmation|confirm|invite|link/.test(
      notesText
    );

  let dataCompleteness =
    "COMPLETE";

  if(missing.length){

    dataCompleteness =
      waiting
        ? "AWAITING_CONFIRMATION"
        : "PARTIAL";

  }

  let schedulingReadiness = "";

  if(
    (data.reviewReasons || []).length
  ){

    schedulingReadiness =
      "SOURCE_REVIEW_REQUIRED";

  }else if(
    data.candidateRaw &&
    data.clientRaw &&
    data.timeNormalized &&
    data.durationMinutes
  ){

    schedulingReadiness =
      "SOURCE_READY_FOR_TEAM_ASSIGNMENT";

  }else if(waiting){

    schedulingReadiness =
      "SOURCE_NOT_READY_AWAITING_CONFIRMATION";

  }else{

    schedulingReadiness =
      "SOURCE_NOT_READY_INCOMPLETE";

  }

  return {
    dataCompleteness:
      dataCompleteness,
    schedulingReadiness:
      schedulingReadiness
  };
}


function V2_escapeRegex_(
  value
){

  return String(
    value || ""
  ).replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&"
  );
}


/******************************************************
 * PRIVATE: MIDDLE SEGMENT CLASSIFICATION
 ******************************************************/
function V2_classifyMiddleSegments_(
  middle
){

  const clientSegments = [];
  const operationalTags = [];
  const notes = [];

  const clean =
    String(
      middle || ""
    )
      .replace(
        /\s+/g,
        " "
      )
      .trim();

  if(!clean){
    return {
      clientSegments:
        clientSegments,
      operationalTags:
        operationalTags,
      notes:
        notes
    };
  }

  const segments =
    clean
      .split(
        /\s+-\s+|\s*;\s*/
      )
      .map(
        function(value){
          return String(
            value || ""
          ).trim();
        }
      )
      .filter(Boolean);

  segments.forEach(
    function(segment){

      const key =
        V2_normalizeKey_(
          segment
        );

      if(!key){
        return;
      }

      if(
        /^loop interview$/.test(key)
      ){

        operationalTags.push(
          "Loop Interview"
        );

        return;
      }

      if(
        /^(interview|zoom interview|teams interview|microsoft teams interview|google meet interview|technical interview|technical coding interview|excel interview|ai interview|panel interview|hiring manager interview|manager interview|assessment interview|phone interview|phn interview|phone screen|phone call|phn call|google voice call|recruiter call|prep call)$/.test(
          key
        )
      ){

        operationalTags.push(
          V2_titleCaseSimple_(
            segment
          )
        );

        return;
      }

      if(
        /^(manual|technical round|discussion round|discussion|technical discussion|technical discussion round|technical discussion w hiring manager|technical discussion w hiring manager round|hiring manager discussion|final discussion|final discussion round|final technical discussion|final technical discussion round|final technical discussion w hiring manager|final technical discussion w hiring manager round|panel interview|manager interview|hiring manager interview|screening round)$/.test(
          key
        )
      ){

        operationalTags.push(
          V2_titleCaseSimple_(
            segment
          )
        );

        return;
      }

      if(
        /need\s+(?:a\s+)?developer/i.test(
          segment
        )
      ){

        notes.push(
          "Need a Developer"
        );

        return;
      }

      if(
        /waiting\s+for\s+invite/i.test(
          segment
        )
      ){

        notes.push(
          "Waiting for Invite"
        );

        return;
      }

      if(
        /need\s+to\s+elaborate|elaborated|eloborate/i.test(
          segment
        )
      ){

        notes.push(
          segment
        );

        return;
      }

      if(
        /^rescheduled\b/i.test(
          segment
        )
      ){

        notes.push(
          segment
        );

        return;
      }

      if(
        /candidate(?:['’]s)?\s+(?:1st|first)\s+interview/i.test(
          segment
        )
      ){

        notes.push(
          segment
        );

        return;
      }

      if(
        /^\d+\s*(?:mins?|minutes?|hrs?|hours?)$/i.test(
          segment
        )
      ){
        return;
      }

      if(
        /^\([^)]{1,80}\)$/.test(
          segment
        )
      ){

        operationalTags.push(
          segment
            .replace(
              /^\(|\)$/g,
              ""
            )
            .trim()
        );

        return;
      }

      clientSegments.push(
        segment
      );

    }
  );

  return {
    clientSegments:
      clientSegments,
    operationalTags:
      operationalTags,
    notes:
      notes
  };
}


/******************************************************
 * PRIVATE: STRIP KNOWN ANNOTATIONS FROM CLIENT AREA
 *
 * This affects only the temporary client-classification
 * text. Original Record remains untouched, and the same
 * annotations are preserved by the whole-record pass.
 ******************************************************/
function V2_stripKnownAnnotationsFromMiddle_(
  text
){

  return String(
    text || ""
  )
    .replace(
      /\bWaiting\s+for\s+time\s+confirmation\s*(?:&|and)\s*invite\b/ig,
      " "
    )
    .replace(
      /\bWaiting\s+for\s+confirmation\s*(?:&|and)\s*invite\b/ig,
      " "
    )
    .replace(
      /\bWaiting\s+for\s+(?:time\s+)?confirmation\b/ig,
      " "
    )
    .replace(
      /\bWaiting\s+for\s+(?:time\s+)?(?:interview\s+)?(?:invite|invitation|link|interview)\b\.?/ig,
      " "
    )
    .replace(
      /\bNeed\s+to\s+do\s+assessment\s+in\s+the\s+interview\b/ig,
      " "
    )
    .replace(
      /\bCandidate(?:['’]s)?\s+(?:1st|first)\s+Interview\b/ig,
      " "
    )
    .replace(
      /\bNeed\s+(?:a\s+)?Developer\b/ig,
      " "
    )
    .replace(
      /\bRescheduled(?:\s+from\s+[^,);]+)?/ig,
      " "
    )
    .replace(
      /[(),]+/g,
      " "
    )
    .replace(
      /\s+/g,
      " "
    )
    .replace(
      /^[-;:,\s]+|[-;:,\s]+$/g,
      ""
    )
    .trim();
}


/******************************************************
 * PRIVATE: WHOLE-RECORD ANNOTATIONS
 *
 * Reads known operational annotations from the entire
 * source record, including text that appears after the
 * call time / duration / round. It never changes client.
 ******************************************************/
function V2_extractWholeRecordAnnotations_(
  text
){

  const source =
    String(
      text || ""
    );

  const operationalTags = [];
  const notes = [];

  //--------------------------------------------------
  // Operational tags can occur anywhere in the record.
  // Discussion-type descriptors are mutually exclusive:
  // keep the most specific wording only.
  //--------------------------------------------------

  if(
    /\bLoop\s+Interview\b/i.test(
      source
    )
  ){
    operationalTags.push(
      "Loop Interview"
    );
  }

  const discussionPatterns = [
    {
      regex:
        /\bFinal\s+Technical\s+Discussion\s+w\/\s*Hiring\s+Manager\b/i,
      value:
        "Final Technical Discussion w/ Hiring Manager"
    },
    {
      regex:
        /\bFinal\s+Technical\s+Discussion\b/i,
      value:
        "Final Technical Discussion"
    },
    {
      regex:
        /\bFinal\s+Discussion\b/i,
      value:
        "Final Discussion"
    },
    {
      regex:
        /\bTechnical\s+Discussion\s+w\/\s*Hiring\s+Manager\b/i,
      value:
        "Technical Discussion w/ Hiring Manager"
    },
    {
      regex:
        /\bHiring\s+Manager\s+Discussion\b/i,
      value:
        "Hiring Manager Discussion"
    },
    {
      regex:
        /\bTechnical\s+Discussion\b/i,
      value:
        "Technical Discussion"
    },
    {
      regex:
        /\bDiscussion\s+Round\b/i,
      value:
        "Discussion Round"
    },
    {
      regex:
        /\bDiscussion\b/i,
      value:
        "Discussion"
    }
  ];

  for(
    let d = 0;
    d < discussionPatterns.length;
    d++
  ){
    if(
      discussionPatterns[d]
        .regex
        .test(
          source
        )
    ){
      operationalTags.push(
        discussionPatterns[d]
          .value
      );
      break;
    }
  }

  const otherTagPatterns = [
    {
      regex:
        /\bTechnical\s+Round\b/i,
      value:
        "Technical Round"
    },
    {
      regex:
        /\bPanel\s+Interview\b/i,
      value:
        "Panel Interview"
    },
    {
      regex:
        /\bHiring\s+Manager\s+Interview\b/i,
      value:
        "Hiring Manager Interview"
    },
    {
      regex:
        /\bManager\s+Interview\b/i,
      value:
        "Manager Interview"
    },
    {
      regex:
        /\bScreening\s+Round\b/i,
      value:
        "Screening Round"
    },
    {
      regex:
        /\bManual\b/i,
      value:
        "Manual"
    }
  ];

  otherTagPatterns.forEach(
    function(item){
      if(
        item.regex.test(
          source
        )
      ){
        operationalTags.push(
          item.value
        );
      }
    }
  );

  //--------------------------------------------------
  // Known notes. Preserve meaningful source wording
  // where it carries history, especially rescheduling.
  //--------------------------------------------------

  if(
    /need\s+(?:a\s+)?developer/i.test(
      source
    )
  ){
    notes.push(
      "Need a Developer"
    );
  }

  const waitingPatterns = [
    /\bWaiting\s+for\s+time\s+confirmation\s*(?:&|and)\s*invite\b/i,
    /\bWaiting\s+for\s+confirmation\s*(?:&|and)\s*invite\b/i,
    /\bWaiting\s+for\s+(?:time\s+)?confirmation\b/i,
    /\bWaiting\s+for\s+(?:time\s+)?(?:interview\s+)?(?:invite|invitation|link|interview)\b\.?/i
  ];

  for(
    let i = 0;
    i < waitingPatterns.length;
    i++
  ){

    const waitingMatch =
      waitingPatterns[i].exec(
        source
      );

    if(waitingMatch){
      notes.push(
        String(
          waitingMatch[0] || ""
        )
          .replace(
            /\s+/g,
            " "
          )
          .trim()
      );
      break;
    }
  }

  if(
    /need\s+to\s+do\s+assessment\s+in\s+the\s+interview/i.test(
      source
    )
  ){
    notes.push(
      "Need to do assessment in the interview"
    );
  }

  if(
    /candidate\s+1st\s+interview/i.test(
      source
    )
  ){
    notes.push(
      "Candidate 1st Interview"
    );
  }

  const rescheduledMatch =
    /\bRescheduled(?:\s+from\s+[^,);]+)?/i.exec(
      source
    );

  if(rescheduledMatch){
    notes.push(
      String(
        rescheduledMatch[0] || ""
      )
        .replace(
          /\s+/g,
          " "
        )
        .trim()
    );
  }

  return {
    operationalTags:
      V2_uniqueStrings_(
        operationalTags
      ),
    notes:
      V2_uniqueStrings_(
        notes
      )
  };
}


/******************************************************
 * PRIVATE: DURATION
 ******************************************************/
function V2_extractDuration_(
  text
){

  const source =
    String(
      text || ""
    );

  let match =
    /\bDuration\s*[:\-]?\s*(\d{1,3})\s*(Mins?|Minutes?)\b/i.exec(
      source
    );

  if(match){
    return {
      raw:
        match[0],
      minutes:
        Number(
          match[1]
        )
    };
  }

  match =
    /\bDuration\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*(Hrs?|Hours?)\b/i.exec(
      source
    );

  if(match){
    return {
      raw:
        match[0],
      minutes:
        Math.round(
          Number(
            match[1]
          ) * 60
        )
    };
  }

  match =
    /\b(\d{1,3})\s*-\s*(Mins?|Minutes?)\b/i.exec(
      source
    );

  if(match){
    return {
      raw:
        match[0],
      minutes:
        Number(
          match[1]
        )
    };
  }

  match =
    /(?:\(|\b)(\d{1,3})\s*(Mins?|Minutes?)(?:\)|\b)/i.exec(
      source
    );

  if(match){
    return {
      raw:
        match[0],
      minutes:
        Number(
          match[1]
        )
    };
  }

  match =
    /(?:\(|\b)(\d+(?:\.\d+)?)\s*(Hrs?|Hours?)(?:\)|\b)/i.exec(
      source
    );

  if(match){
    return {
      raw:
        match[0],
      minutes:
        Math.round(
          Number(
            match[1]
          ) * 60
        )
    };
  }

  return {
    raw:
      "",
    minutes:
      ""
  };
}


function V2_removeDurationText_(
  text
){

  return String(
    text || ""
  )
    .replace(
      /\bDuration\s*[:\-]?\s*\d{1,3}\s*(?:Mins?|Minutes?)\b/ig,
      " "
    )
    .replace(
      /\bDuration\s*[:\-]?\s*\d+(?:\.\d+)?\s*(?:Hrs?|Hours?)\b/ig,
      " "
    )
    .replace(
      /\b\d{1,3}\s*-\s*(?:Mins?|Minutes?)\b/ig,
      " "
    )
    .replace(
      /\(\s*\d{1,3}\s*(?:Mins?|Minutes?)\s*\)/ig,
      " "
    )
    .replace(
      /\(\s*\d+(?:\.\d+)?\s*(?:Hrs?|Hours?)\s*\)/ig,
      " "
    );
}


/******************************************************
 * PRIVATE: ROUND
 ******************************************************/
function V2_extractRound_(
  text
){

  const source =
    String(
      text || ""
    );

  //--------------------------------------------------
  // 1) Explicit numbered round always wins.
  //--------------------------------------------------

  let match =
    /\b(\d+)\s*(st|nd|rd|th)\s*Round\b/i.exec(
      source
    );

  if(match){

    const number =
      Number(
        match[1]
      );

    return {
      raw:
        match[0],
      label:
        V2_ordinal_(
          number
        ) +
        " Round",
      number:
        number
    };

  }

  //--------------------------------------------------
  // 2) Only explicit "Final Round" is numeric-final.
  //--------------------------------------------------

  match =
    /\bFinal\s+Round\b/i.exec(
      source
    );

  if(match){
    return {
      raw:
        match[0],
      label:
        "Final",
      number:
        999
    };
  }

  //--------------------------------------------------
  // 3) Supported nonnumeric round labels.
  //--------------------------------------------------

  match =
    /\bTechnical\s+Round\b/i.exec(
      source
    );

  if(match){
    return {
      raw:
        match[0],
      label:
        "Technical Round",
      number:
        ""
    };
  }

  match =
    /\bScreening\s+Round\b/i.exec(
      source
    );

  if(match){
    return {
      raw:
        match[0],
      label:
        "Screening Round",
      number:
        ""
    };
  }

  match =
    /\bDiscussion\s+Round\b/i.exec(
      source
    );

  if(match){

    const prefix =
      source.substring(
        0,
        match.index
      );

    const partOfLongerDiscussionStage =
      /(?:Final\s+Technical|Final|Technical)\s+$/i.test(
        prefix
      );

    if(
      !partOfLongerDiscussionStage
    ){
      return {
        raw:
          match[0],
        label:
          "Discussion Round",
        number:
          ""
      };
    }

  }

  return {
    raw:
      "",
    label:
      "",
    number:
      ""
  };
}


function V2_removeRoundText_(
  text
){

  return String(
    text || ""
  )
    .replace(
      /\(?\s*\d+\s*(?:st|nd|rd|th)\s*Round(?:\s+Round)?\s*\)?/ig,
      " "
    )
    .replace(
      /\(?\s*Final\s+Round\s*\)?/ig,
      " "
    )
    .replace(
      /\b(?:Technical\s+Round|Screening\s+Round)\b/ig,
      function(value){
        return " - " + value + " - ";
      }
    )
    .replace(
      /\bDiscussion\s+Round\b/ig,
      function(value, offset, whole){

        const prefix =
          String(
            whole || ""
          ).substring(
            0,
            offset
          );

        const partOfLongerDiscussionStage =
          /(?:Final\s+Technical|Final|Technical)\s+$/i.test(
            prefix
          );

        return partOfLongerDiscussionStage
          ? value
          : " - " + value + " - ";
      }
    );
}


/******************************************************
 * PRIVATE: CANDIDATE MASTER MATCHING
 *
 * V2 Phase 2 integration:
 * - Candidate rows are obtained through Repository.
 * - Matching logic is delegated to
 *   V2CandidateMatcherService.gs.
 * - Duplicate official names are never guessed.
 * - Review-only suggestions never populate Candidate ID.
 * - Source country/location may be passed as secondary
 *   identity evidence through Original Record.
 *
 * Parser behavior is unchanged. PARSER_VERSION therefore
 * remains GW-PARSER-1.4.0.
 ******************************************************/
function V2_loadCandidateMaster_(){

  if(
    typeof V2Repo_getCandidates !==
      "function"
  ){
    throw new Error(
      "V2_CANDIDATE_REPOSITORY_NOT_AVAILABLE"
    );
  }

  if(
    typeof V2CandidateMatcher_buildIndex !==
      "function"
  ){
    throw new Error(
      "V2_CANDIDATE_MATCHER_SERVICE_NOT_AVAILABLE"
    );
  }

  const rows =
    V2Repo_getCandidates();

  // System Active controls whether the Candidate Master
  // record participates in operational matching.
  // Source profile Active Status remains a separate field.
  const activeRows =
    (rows || [])
      .filter(
        function(row){

          const active =
            row["Active"];

          if(
            active === true ||
            active === 1
          ){
            return true;
          }

          const value =
            String(
              active || ""
            )
              .trim()
              .toLowerCase();

          return (
            value === "true" ||
            value === "yes" ||
            value === "active" ||
            value === "1"
          );

        }
      );

  return V2CandidateMatcher_buildIndex(
    activeRows
  );
}


function V2_matchCandidate_(
  rawName,
  masterIndex,
  context
){

  const raw =
    String(
      rawName || ""
    ).trim();

  if(!raw){

    return {
      candidateId:
        "",
      officialName:
        "",
      status:
        "REVIEW_EMPTY_CANDIDATE",
      score:
        0
    };

  }

  if(
    !masterIndex ||
    !Array.isArray(
      masterIndex.uniqueRecords
    )
  ){

    return {
      candidateId:
        "",
      officialName:
        "",
      status:
        "MASTER_EMPTY",
      score:
        ""
    };

  }

  if(
    masterIndex.uniqueRecords.length === 0 &&
    Object.keys(
      masterIndex.byNormalized || {}
    ).length === 0
  ){

    return {
      candidateId:
        "",
      officialName:
        "",
      status:
        "MASTER_EMPTY",
      score:
        ""
    };

  }

  if(
    typeof V2CandidateMatcher_match !==
      "function"
  ){
    throw new Error(
      "V2_CANDIDATE_MATCHER_SERVICE_NOT_AVAILABLE"
    );
  }

  const match =
    V2CandidateMatcher_match(
      raw,
      masterIndex,
      context || {}
    );

  const candidateId =
    String(
      match.candidateId || ""
    ).trim();

  //--------------------------------------------------
  // Only a resolved Candidate ID may populate the
  // Official Candidate Name field.
  //
  // REVIEW_* and AMBIGUOUS results may contain a
  // suggested master name in the matcher service, but a
  // suggestion is NOT an official resolved identity.
  //--------------------------------------------------

  return {
    candidateId:
      candidateId,

    officialName:
      candidateId
        ? String(
            match.officialName || ""
          ).trim()
        : "",

    status:
      String(
        match.status || "UNMATCHED"
      ).trim(),

    score:
      Number(
        match.score || 0
      )
  };
}


/******************************************************
 * PRIVATE: CLIENT RECOGNITION (SUGGEST ONLY)
 ******************************************************/
function V2_loadClientRegistry_(){

  const ss =
    V2_backend_();

  const sheet =
    ss.getSheetByName(
      V2_CONFIG.SHEETS.CLIENT_REGISTRY
    );

  if(
    !sheet ||
    sheet.getLastRow() <= 1
  ){
    return [];
  }

  const values =
    sheet
      .getDataRange()
      .getValues();

  const headers =
    V2_headerMap_(
      values[0] || []
    );

  const result = [];

  for(
    let i = 1;
    i < values.length;
    i++
  ){

    const row =
      values[i];

    const recognized =
      String(
        row[
          headers[
            "Recognized Client"
          ]
        ] || ""
      ).trim();

    const variant =
      String(
        row[
          headers[
            "Known Variant"
          ]
        ] || ""
      ).trim();

    const active =
      V2_isActive_(
        row[
          headers[
            "Active"
          ]
        ]
      );

    if(
      recognized &&
      active
    ){

      result.push({
        recognized:
          recognized,
        key:
          V2_normalizeKey_(
            variant || recognized
          )
      });

    }

  }

  return result;
}


function V2_suggestClient_(
  rawClient,
  registry
){

  const raw =
    String(
      rawClient || ""
    ).trim();

  const key =
    V2_normalizeKey_(
      raw
    );

  if(
    !key ||
    !registry ||
    !registry.length
  ){
    return {
      suggested:
        "",
      score:
        ""
    };
  }

  let best = null;

  registry.forEach(
    function(item){

      const score =
        V2_similarity_(
          key,
          item.key
        );

      if(
        !best ||
        score > best.score
      ){
        best = {
          suggested:
            item.recognized,
          score:
            score
        };
      }

    }
  );

  if(
    best &&
    best.score >=
      V2_GATEWAY_CONFIG
        .CLIENT_SUGGESTION_SIMILARITY
  ){
    return {
      suggested:
        best.suggested,
      score:
        Math.round(
          best.score * 10000
        ) / 100
    };
  }

  return {
    suggested:
      "",
    score:
      best
        ? Math.round(
            best.score * 10000
          ) / 100
        : ""
  };
}


/******************************************************
 * PRIVATE: NORMALIZATION / MATH HELPERS
 ******************************************************/
function V2_normalizeSeparators_(
  value
){

  return String(
    value || ""
  )
    .replace(
      /\u00a0/g,
      " "
    )
    .replace(
      /[–—]/g,
      "-"
    )
    .replace(
      /\s*-{2,}\s*/g,
      " - "
    )
    .replace(
      /(?:\s+-\s*|\s*-\s+)/g,
      " - "
    )
    .replace(
      /\s+/g,
      " "
    )
    .trim();
}


function V2_normalizeInterviewType_(
  value
){

  const key =
    V2_normalizeKey_(
      value
    );

  if(
    key === "phone interview" ||
    key === "phn interview" ||
    key === "phone screen"
  )
    return "Phone Interview";

  if(
    key === "phone call" ||
    key === "phn call" ||
    key === "google voice call"
  )
    return "Phone Call";

  if(
    key === "zoom interview" ||
    key === "teams interview" ||
    key === "microsoft teams interview" ||
    key === "google meet interview" ||
    key === "technical loop interview" ||
    key === "technical interview" ||
    key === "technical coding interview" ||
    key === "final interview" ||
    key === "loop interview" ||
    key === "candidate side interview" ||
    key === "behavioral interview" ||
    key === "coding interview" ||
    key === "coding round" ||
    key === "assessment through interview" ||
    key === "excel interview" ||
    key === "ai interview" ||
    key === "panel interview" ||
    key === "hiring manager interview" ||
    key === "manager interview" ||
    key === "assessment interview" ||
    key === "interview" ||
    key === "technical discussion" ||
    key === "technical discussion w hiring manager" ||
    key === "hiring manager discussion" ||
    key === "final discussion" ||
    key === "final technical discussion" ||
    key === "final technical discussion w hiring manager" ||
    key === "discussion" ||
    key === "discussion round" ||
    key === "technical discussion round" ||
    key === "technical discussion w hiring manager round" ||
    key === "final discussion round" ||
    key === "final technical discussion round" ||
    key === "final technical discussion w hiring manager round"
  )
    return "Interview";

  if(
    key === "prep call"
  )
    return "Prep Call";

  if(key === "recruiter call")
    return "Recruiter Call";

  return rawFallback_();

  function rawFallback_(){
    return String(
      value || ""
    ).trim();
  }
}

function V2_normalizeName_(
  value
){

  return String(
    value || ""
  )
    .toLowerCase()
    .replace(
      /\([^)]*\)/g,
      " "
    )
    .replace(
      /[^a-z0-9]+/g,
      " "
    )
    .replace(
      /\s+/g,
      " "
    )
    .trim();
}


function V2_normalizeKey_(
  value
){

  return String(
    value || ""
  )
    .toLowerCase()
    .replace(
      /&/g,
      " and "
    )
    .replace(
      /[^a-z0-9]+/g,
      " "
    )
    .replace(
      /\s+/g,
      " "
    )
    .trim();
}


function V2_timeToMinutes_(
  hour,
  minute,
  ampmLetter
){

  let h =
    Number(
      hour
    );

  const m =
    Number(
      minute
    );

  const marker =
    String(
      ampmLetter || ""
    ).toUpperCase();

  if(marker === "A"){
    if(h === 12)
      h = 0;
  }else if(
    marker === "P"
  ){
    if(h !== 12)
      h += 12;
  }

  return (
    h * 60
  ) + m;
}


function V2_ordinal_(
  number
){

  const n =
    Number(
      number
    );

  const mod100 =
    n % 100;

  if(
    mod100 >= 11 &&
    mod100 <= 13
  ){
    return n + "th";
  }

  switch(
    n % 10
  ){
    case 1:
      return n + "st";
    case 2:
      return n + "nd";
    case 3:
      return n + "rd";
    default:
      return n + "th";
  }
}


function V2_titleCaseSimple_(
  value
){

  return String(
    value || ""
  )
    .toLowerCase()
    .replace(
      /\b\w/g,
      function(letter){
        return letter
          .toUpperCase();
      }
    );
}


function V2_similarity_(
  a,
  b
){

  const left =
    String(
      a || ""
    );

  const right =
    String(
      b || ""
    );

  if(
    !left &&
    !right
  ){
    return 1;
  }

  const maxLen =
    Math.max(
      left.length,
      right.length
    );

  if(maxLen === 0)
    return 1;

  const distance =
    V2_levenshtein_(
      left,
      right
    );

  return Math.max(
    0,
    1 -
      (
        distance /
        maxLen
      )
  );
}


function V2_levenshtein_(
  a,
  b
){

  const s =
    String(
      a || ""
    );

  const t =
    String(
      b || ""
    );

  if(!s.length)
    return t.length;

  if(!t.length)
    return s.length;

  const previous = [];
  const current = [];

  for(
    let j = 0;
    j <= t.length;
    j++
  ){
    previous[j] = j;
  }

  for(
    let i = 1;
    i <= s.length;
    i++
  ){

    current[0] = i;

    for(
      let j = 1;
      j <= t.length;
      j++
    ){

      const cost =
        s.charAt(
          i - 1
        ) ===
        t.charAt(
          j - 1
        )
          ? 0
          : 1;

      current[j] =
        Math.min(
          current[j - 1] + 1,
          previous[j] + 1,
          previous[j - 1] + cost
        );

    }

    for(
      let j = 0;
      j <= t.length;
      j++
    ){
      previous[j] = current[j];
    }

  }

  return previous[
    t.length
  ];
}


function V2_isActive_(
  value
){

  if(value === true)
    return true;

  const key =
    String(
      value || ""
    )
      .trim()
      .toLowerCase();

  return [
    "true",
    "yes",
    "y",
    "1",
    "active"
  ].indexOf(
    key
  ) > -1;
}


function V2_uniqueStrings_(
  values
){

  const seen = {};
  const result = [];

  (values || [])
    .forEach(
      function(value){

        const text =
          String(
            value || ""
          ).trim();

        if(!text)
          return;

        const key =
          text.toLowerCase();

        if(seen[key])
          return;

        seen[key] = true;
        result.push(text);

      }
    );

  return result;
}


function V2_sha256Hex_(
  value
){

  const digest =
    Utilities.computeDigest(
      Utilities
        .DigestAlgorithm
        .SHA_256,
      String(
        value || ""
      ),
      Utilities
        .Charset
        .UTF_8
    );

  return digest
    .map(
      function(byte){

        const n =
          byte < 0
            ? byte + 256
            : byte;

        return (
          "0" +
          n.toString(16)
        ).slice(-2);

      }
    )
    .join("");
}


/******************************************************
 * SECTION 4: CANDIDATE MATCHER — VERIFIED 1.3.1
 * Former Apps Script file: V2CandidateMatcherService.gs
 ******************************************************/

/******************************************************
 * V2CANDIDATEMATCHERSERVICE.GS
 * Interview Operations Portal V2
 *
 * Candidate identity matching BUSINESS SERVICE.
 *
 * IMPORTANT
 * ---------
 * This file does NOT read/write Sheets directly.
 * It receives Candidate Master records from Repository
 * callers and returns an interpretation.
 *
 * Auto-safe rules are deliberately evidence-based:
 * 1. unique exact normalized name
 * 2. unique token-equivalent name (order / joined spacing)
 * 3. unique strong near-typo where all name tokens match
 *    except ONE token with a very small edit distance
 * 4. unique structural partial-name expansion
 * 5. unique structural initial expansion
 * 6. country/location fallback ONLY when name evidence
 *    already exists and country reduces the pool to one
 * 7. combined-evidence name rules for unresolved cases:
 *    - unordered partial tokens
 *    - Master-name subset of Raw
 *    - one-token one-character spelling edit
 *    - merged/split name components
 *    - anchored initial expansion
 *    - anchored near-name residuals
 * 8. next-rule disambiguation for remaining cases:
 *    - exactly-one-Active tie-break inside a real
 *      name-compatible candidate pool
 *    - Master initial -> Raw full-token expansion
 *    - multiple one-character token edits
 *    - anchored edit-distance-2 / transposition matching
 *
 * High similarity alone never auto-links.
 * Ambiguous names remain REVIEW. Country never overrides
 * an incompatible name. Shared tokens alone are NOT enough
 * to auto-link.
 ******************************************************/


const V2_CANDIDATE_MATCHER =
  Object.freeze({

    VERSION:
      "V2-CANDIDATE-MATCHER-1.3.1",

    REVIEW_NEAR_MIN_SCORE:
      80,

    // Only very strong one-token typos may auto-link.
    // Lower-confidence near names remain review-only.
    AUTO_NEAR_TYPO_MIN_SCORE:
      90,

    // For long single-token typos such as
    // Mohmad <-> Mohammad, allow at most 2 edits only
    // when both differing tokens are long enough.
    LONG_TOKEN_MIN_LENGTH_FOR_2_EDITS:
      8,

    // Supporting floor for explicit NEXT-rule spelling
    // relations. High similarity alone never auto-links.
    NEXT_RULE_MIN_FULL_NAME_SIMILARITY:
      85

  });


/******************************************************
 * PUBLIC SERVICE: BUILD MASTER INDEX
 ******************************************************/
function V2CandidateMatcher_buildIndex(
  candidateRows
){

  const byNormalized = {};
  const uniqueRecords = [];
  const allRecords = [];

  (candidateRows || [])
    .forEach(
      function(row){

        const candidateId =
          String(
            row["Candidate ID"] || ""
          ).trim();

        const officialName =
          String(
            row["Official Candidate Name"] || ""
          ).trim();

        if(
          !candidateId ||
          !officialName
        ){
          return;
        }

        const normalized =
          V2CandidateMatcher_normalize_(
            officialName
          );

        if(!normalized)
          return;

        const record = {
          candidateId:
            candidateId,
          officialName:
            officialName,
          email:
            String(
              row["Email"] || ""
            ).trim(),
          activeStatus:
            V2CandidateMatcher_activeStatus_(
              row["Active Status"]
            ),
          normalized:
            normalized,
          compact:
            V2CandidateMatcher_compact_(
              normalized
            ),
          tokenKey:
            V2CandidateMatcher_tokenKey_(
              normalized
            ),
          tokens:
            V2CandidateMatcher_tokens_(
              normalized
            ),
          locationRaw:
            String(
              row["Location"] || ""
            ).trim(),
          locationCanonical:
            V2CandidateMatcher_locationCanonicalize_(
              row["Location"]
            )
        };

        allRecords.push(
          record
        );

        if(!byNormalized[normalized]){
          byNormalized[normalized] = [];
        }

        byNormalized[normalized]
          .push(
            record
          );

      }
    );

  const normalizedNames =
    Object.keys(
      byNormalized
    );

  normalizedNames.forEach(
    function(name){

      if(
        byNormalized[name]
          .length === 1
      ){
        uniqueRecords.push(
          byNormalized[name][0]
        );
      }

    }
  );

  return {
    byNormalized:
      byNormalized,
    uniqueRecords:
      uniqueRecords,
    allRecords:
      allRecords,
    normalizedNameCount:
      normalizedNames.length,
    duplicateNormalizedGroups:
      normalizedNames
        .filter(
          function(name){
            return (
              byNormalized[name]
                .length > 1
            );
          }
        )
        .map(
          function(name){
            return {
              normalizedName:
                name,
              records:
                byNormalized[name]
            };
          }
        )
  };

}


/******************************************************
 * PUBLIC SERVICE: MATCH ONE RAW CANDIDATE
 ******************************************************/
function V2CandidateMatcher_match(
  rawName,
  index,
  context
){

  const raw =
    String(
      rawName || ""
    ).trim();

  const normalized =
    V2CandidateMatcher_normalize_(
      raw
    );

  if(!normalized){

    return V2CandidateMatcher_result_(
      "UNMATCHED",
      "",
      "",
      0,
      "EMPTY_NORMALIZED_CANDIDATE",
      []
    );

  }

  if(
    !index ||
    !index.uniqueRecords
  ){
    throw new Error(
      "V2_CANDIDATE_MATCHER_INDEX_REQUIRED"
    );
  }

  //--------------------------------------------------
  // 1. EXACT NORMALIZED NAME
  //--------------------------------------------------

  const exact =
    index.byNormalized[
      normalized
    ] || [];

  if(exact.length === 1){

    return V2CandidateMatcher_result_(
      "AUTO_EXACT_NORMALIZED",
      exact[0].candidateId,
      exact[0].officialName,
      100,
      "UNIQUE_NORMALIZED_NAME",
      []
    );

  }

  if(exact.length > 1){

    const activeExact =
      V2CandidateMatcher_activePoolDecision_(
        exact
      );

    if(
      activeExact.auto &&
      activeExact.item
    ){

      return V2CandidateMatcher_result_(
        "AUTO_ACTIVE_DISAMBIGUATED",
        activeExact.item.candidateId,
        activeExact.item.officialName,
        100,
        "EXACT_DUPLICATE_NAME_EXACTLY_ONE_ACTIVE_ALL_OTHERS_INACTIVE",
        []
      );

    }

    return V2CandidateMatcher_result_(
      "AMBIGUOUS_MASTER_NAME",
      "",
      "",
      100,
      "NORMALIZED_NAME_MATCHES_MULTIPLE_CANDIDATE_IDS",
      exact.map(
        function(item){
          return item.candidateId;
        }
      )
    );

  }

  const rawCompact =
    V2CandidateMatcher_compact_(
      normalized
    );

  const rawTokenKey =
    V2CandidateMatcher_tokenKey_(
      normalized
    );

  const rawTokens =
    V2CandidateMatcher_tokens_(
      normalized
    );

  //--------------------------------------------------
  // 2. TOKEN-EQUIVALENT SAFE MATCH
  //
  // Covers:
  // Sai Kumar Battu <-> Battu Sai Kumar
  // Bhavan Teja <-> BhavanTeja
  // Vamsikrishna <-> Vamsi Krishna
  //--------------------------------------------------

  const equivalent =
    index.uniqueRecords
      .filter(
        function(item){

          return (
            item.compact ===
              rawCompact ||
            item.tokenKey ===
              rawTokenKey
          );

        }
      );

  if(equivalent.length === 1){

    return V2CandidateMatcher_result_(
      "AUTO_TOKEN_EQUIVALENT",
      equivalent[0].candidateId,
      equivalent[0].officialName,
      100,
      (
        equivalent[0].compact ===
        rawCompact
      )
        ? "UNIQUE_COMPACT_NAME_EQUIVALENT"
        : "UNIQUE_TOKEN_ORDER_EQUIVALENT",
      []
    );

  }

  if(equivalent.length > 1){

    return V2CandidateMatcher_result_(
      "AMBIGUOUS_MASTER_NAME",
      "",
      "",
      100,
      "TOKEN_EQUIVALENT_MATCHES_MULTIPLE_CANDIDATE_IDS",
      equivalent.map(
        function(item){
          return item.candidateId;
        }
      )
    );

  }

  //--------------------------------------------------
  // 3. STRICT SINGLE-TOKEN TYPO
  //--------------------------------------------------

  const typoMatches =
    index.uniqueRecords
      .map(
        function(item){

          const typo =
            V2CandidateMatcher_strictTypo_(
              rawTokens,
              item.tokens
            );

          if(!typo.ok)
            return null;

          return {
            item:
              item,
            edits:
              typo.edits,
            score:
              typo.score
          };

        }
      )
      .filter(Boolean)
      .sort(
        function(a,b){

          if(a.edits !== b.edits){
            return a.edits - b.edits;
          }

          return b.score - a.score;

        }
      );

  if(typoMatches.length === 1){

    return V2CandidateMatcher_result_(
      "AUTO_NEAR_TYPO",
      typoMatches[0]
        .item
        .candidateId,
      typoMatches[0]
        .item
        .officialName,
      typoMatches[0]
        .score,
      "UNIQUE_STRICT_SINGLE_TOKEN_TYPO",
      []
    );

  }

  if(typoMatches.length > 1){

    const bestTypo =
      typoMatches[0];

    const secondTypo =
      typoMatches[1];

    // Only auto if the best typo has fewer edits than
    // every competing typo. Otherwise do not guess.
    if(
      bestTypo.edits <
      secondTypo.edits
    ){

      return V2CandidateMatcher_result_(
        "AUTO_NEAR_TYPO",
        bestTypo
          .item
          .candidateId,
        bestTypo
          .item
          .officialName,
        bestTypo.score,
        "STRICT_TYPO_UNIQUE_BY_EDIT_DISTANCE",
        []
      );

    }

    return V2CandidateMatcher_result_(
      "REVIEW_NEAR",
      "",
      bestTypo
        .item
        .officialName,
      bestTypo.score,
      "MULTIPLE_STRICT_TYPO_CANDIDATES",
      typoMatches
        .slice(
          0,
          5
        )
        .map(
          function(item){
            return item.item.candidateId;
          }
        )
    );

  }

  //--------------------------------------------------
  // 4. UNIQUE STRUCTURAL PARTIAL / INITIAL EXPANSION
  //
  // Examples:
  //   Thrayamba Keswar
  //   -> Thrayamba Keswar Bettala
  //
  //   Meghana B
  //   -> Meghana Botta
  //
  // This is NOT fuzzy matching. Every supplied raw token
  // must structurally align with the master name. A
  // one-letter raw token may expand only to a master token
  // beginning with that same letter.
  //
  // Exactly one compatible Candidate ID is required.
  //--------------------------------------------------

  const structural =
    V2CandidateMatcher_structuralDecision_(
      rawTokens,
      index.allRecords ||
        index.uniqueRecords
    );

  if(
    structural.status ===
      "UNIQUE_INITIAL"
  ){

    const item =
      structural.matches[0];

    return V2CandidateMatcher_result_(
      "AUTO_UNIQUE_INITIAL",
      item.candidateId,
      item.officialName,
      V2CandidateMatcher_similarity_(
        normalized,
        item.normalized
      ),
      "UNIQUE_STRUCTURAL_INITIAL_EXPANSION",
      []
    );

  }

  if(
    structural.status ===
      "UNIQUE_PARTIAL"
  ){

    const item =
      structural.matches[0];

    return V2CandidateMatcher_result_(
      "AUTO_UNIQUE_PARTIAL",
      item.candidateId,
      item.officialName,
      V2CandidateMatcher_similarity_(
        normalized,
        item.normalized
      ),
      "UNIQUE_ORDERED_PARTIAL_NAME_EXPANSION",
      []
    );

  }

  //--------------------------------------------------
  // 5. SOURCE COUNTRY / LOCATION FALLBACK
  //
  // Country is SECONDARY evidence only.
  //
  // A. one-token name:
  //    Surya (Ireland)
  //    -> exact "surya" name token pool
  //    -> filter by Ireland
  //
  // B. structurally ambiguous partial/initial name:
  //    use ONLY structurally compatible candidates
  //    -> filter by source country
  //
  // Country never rescues a NO_STRUCTURAL_MATCH name.
  //--------------------------------------------------

  const sourceLocation =
    V2CandidateMatcher_extractSourceLocation_(
      context &&
      context.originalRecord
        ? context.originalRecord
        : ""
    );

  if(sourceLocation){

    const allRecords =
      index.allRecords ||
      index.uniqueRecords;

    //------------------------------------------------
    // One-token name + country.
    //------------------------------------------------

    if(rawTokens.length === 1){

      const token =
        rawTokens[0];

      const namePool =
        allRecords
          .filter(
            function(item){
              return (
                item.tokens.indexOf(
                  token
                ) > -1
              );
            }
          );

      const locationPool =
        V2CandidateMatcher_filterByLocation_(
          namePool,
          sourceLocation
        );

      if(locationPool.length === 1){

        const item =
          locationPool[0];

        return V2CandidateMatcher_result_(
          "AUTO_LOCATION_SINGLE_TOKEN",
          item.candidateId,
          item.officialName,
          V2CandidateMatcher_similarity_(
            normalized,
            item.normalized
          ),
          "ONE_TOKEN_NAME_PLUS_UNIQUE_COUNTRY_MATCH",
          []
        );

      }

    }

    //------------------------------------------------
    // Multiple structurally compatible names + country.
    //------------------------------------------------

    if(
      structural.status ===
        "BLOCK_MULTIPLE_COMPATIBLE"
    ){

      const locationPool =
        V2CandidateMatcher_filterByLocation_(
          structural.matches,
          sourceLocation
        );

      if(locationPool.length === 1){

        const item =
          locationPool[0];

        return V2CandidateMatcher_result_(
          "AUTO_LOCATION_DISAMBIGUATED",
          item.candidateId,
          item.officialName,
          V2CandidateMatcher_similarity_(
            normalized,
            item.normalized
          ),
          "MULTIPLE_NAME_MATCHES_REDUCED_TO_ONE_BY_COUNTRY",
          []
        );

      }

    }

  }


  //--------------------------------------------------
  // 7. COMBINED-EVIDENCE SAFE MATCHING
  //
  // IMPORTANT:
  // This runs only AFTER all v1.1 exact/equivalent/typo/
  // structural/location rules have had the first chance.
  //
  // It therefore expands only cases that would otherwise
  // remain REVIEW / UNMATCHED.
  //
  // Shared words alone are NOT sufficient. The remaining
  // name differences must be structurally explainable.
  //--------------------------------------------------

  const combined =
    V2CandidateMatcher_combinedEvidenceDecision_(
      rawTokens,
      index.allRecords ||
        index.uniqueRecords
    );

  if(
    combined &&
    combined.auto &&
    combined.item
  ){

    return V2CandidateMatcher_result_(
      combined.status,
      combined.item.candidateId,
      combined.item.officialName,
      V2CandidateMatcher_similarity_(
        normalized,
        combined.item.normalized
      ),
      combined.reason,
      []
    );

  }


  //--------------------------------------------------
  // 8. ACTIVE STATUS DISAMBIGUATION
  //
  // IMPORTANT v1.3.1 precedence correction:
  // Existing v1.2 combined-evidence auto matches are
  // evaluated FIRST so this tie-breaker cannot reclassify
  // a previously stable AUTO_* result.
  //
  // Active Status is used only when structural matching
  // still leaves multiple genuinely compatible IDs.
  //--------------------------------------------------

  if(
    structural.status ===
      "BLOCK_MULTIPLE_COMPATIBLE"
  ){

    const activeStructural =
      V2CandidateMatcher_activePoolDecision_(
        structural.matches
      );

    if(
      activeStructural.auto &&
      activeStructural.item
    ){

      return V2CandidateMatcher_result_(
        "AUTO_ACTIVE_DISAMBIGUATED",
        activeStructural.item.candidateId,
        activeStructural.item.officialName,
        V2CandidateMatcher_similarity_(
          normalized,
          activeStructural.item.normalized
        ),
        "MULTIPLE_STRUCTURAL_NAME_CANDIDATES_EXACTLY_ONE_ACTIVE_ALL_OTHERS_INACTIVE",
        []
      );

    }

  }


  //--------------------------------------------------
  // 9. NEXT-RULE SAFE MATCHING
  //
  // These rules were audited read-only against the
  // remaining Matcher v1.2 unresolved population.
  //
  // Similarity is supporting evidence only.
  //--------------------------------------------------

  const nextRule =
    V2CandidateMatcher_nextRuleDecision_(
      normalized,
      rawTokens,
      index.allRecords ||
        index.uniqueRecords
    );

  if(
    nextRule &&
    nextRule.auto &&
    nextRule.item
  ){

    return V2CandidateMatcher_result_(
      nextRule.status,
      nextRule.item.candidateId,
      nextRule.item.officialName,
      nextRule.score,
      nextRule.reason,
      []
    );

  }


  //--------------------------------------------------
  // 10. REVIEW-ONLY PARTIAL / INITIAL / NEAR MATCH
  //--------------------------------------------------

  const scored =
    index.uniqueRecords
      .map(
        function(item){

          return {
            item:
              item,
            partial:
              V2CandidateMatcher_partialRelation_(
                rawTokens,
                item.tokens
              ),
            initial:
              V2CandidateMatcher_initialRelation_(
                rawTokens,
                item.tokens
              ),
            score:
              V2CandidateMatcher_similarity_(
                normalized,
                item.normalized
              )
          };

        }
      )
      .sort(
        function(a,b){

          const aRank =
            (
              a.partial
                ? 2
                : 0
            ) +
            (
              a.initial
                ? 1
                : 0
            );

          const bRank =
            (
              b.partial
                ? 2
                : 0
            ) +
            (
              b.initial
                ? 1
                : 0
            );

          if(aRank !== bRank)
            return bRank - aRank;

          return b.score - a.score;

        }
      );

  const best =
    scored[0] || null;

  const second =
    scored[1] || null;

  if(best){

    const secondScore =
      second
        ? second.score
        : 0;

    const margin =
      best.score -
      secondScore;

    if(best.initial){

      return V2CandidateMatcher_reviewResult_(
        "REVIEW_INITIAL",
        best,
        secondScore,
        margin,
        "INITIAL_MAY_EXPAND_TO_MASTER_TOKEN"
      );

    }

    if(best.partial){

      return V2CandidateMatcher_reviewResult_(
        "REVIEW_PARTIAL",
        best,
        secondScore,
        margin,
        "RAW_NAME_IS_PARTIAL_OR_MASTER_HAS_EXTRA_TOKEN"
      );

    }

    if(
      best.score >=
      V2_CANDIDATE_MATCHER
        .REVIEW_NEAR_MIN_SCORE
    ){

      return V2CandidateMatcher_reviewResult_(
        "REVIEW_NEAR",
        best,
        secondScore,
        margin,
        "NEAR_NAME_REQUIRES_REVIEW"
      );

    }

  }

  return V2CandidateMatcher_result_(
    "UNMATCHED",
    "",
    best
      ? best.item.officialName
      : "",
    best
      ? best.score
      : 0,
    "NO_SAFE_OR_REVIEWABLE_MASTER_MATCH",
    []
  );

}


/******************************************************
 * PRIVATE: STRICT TYPO RULE
 *
 * Same number of tokens.
 * After order-independent best token pairing:
 * - every token pair except one must be exact
 * - the one differing pair may have:
 *      distance 1, OR
 *      distance 2 only if both tokens >= 8 chars
 ******************************************************/
function V2CandidateMatcher_strictTypo_(
  rawTokens,
  masterTokens
){

  if(
    rawTokens.length !==
    masterTokens.length ||
    rawTokens.length === 0
  ){
    return {
      ok:
        false
    };
  }

  const pairing =
    V2CandidateMatcher_bestTokenPairing_(
      rawTokens,
      masterTokens
    );

  if(!pairing)
    return {
      ok:
        false
    };

  const changed =
    pairing.pairs
      .filter(
        function(pair){
          return pair.distance > 0;
        }
      );

  if(changed.length !== 1){

    return {
      ok:
        false
    };

  }

  const pair =
    changed[0];

  //--------------------------------------------------
  // NEVER auto-match one-letter token substitutions.
  //
  // Example:
  //   Rakesh K  <->  Rakesh M
  //
  // A single-letter token is identity-bearing and can
  // represent a different surname/initial. It is not a
  // spelling typo. Such cases must remain review-only.
  //--------------------------------------------------

  if(
    pair.left.length < 3 ||
    pair.right.length < 3
  ){
    return {
      ok:
        false
    };
  }

  const maxAllowed =
    (
      pair.left.length >=
        V2_CANDIDATE_MATCHER
          .LONG_TOKEN_MIN_LENGTH_FOR_2_EDITS &&
      pair.right.length >=
        V2_CANDIDATE_MATCHER
          .LONG_TOKEN_MIN_LENGTH_FOR_2_EDITS
    )
      ? 2
      : 1;

  if(
    pair.distance >
    maxAllowed
  ){
    return {
      ok:
        false
    };
  }

  const maxLen =
    Math.max(
      pair.left.length,
      pair.right.length
    );

  const tokenScore =
    maxLen
      ? (
          1 -
          pair.distance /
          maxLen
        ) * 100
      : 0;

  const roundedScore =
    Math.round(
      tokenScore * 100
    ) / 100;

  //--------------------------------------------------
  // Conservative auto-link threshold.
  //
  // A one-token difference can be a real different name
  // rather than a typo (for example Kumar vs Kumari).
  // Only very high-similarity token changes auto-link.
  //--------------------------------------------------

  if(
    roundedScore <
    V2_CANDIDATE_MATCHER
      .AUTO_NEAR_TYPO_MIN_SCORE
  ){
    return {
      ok:
        false
    };
  }

  return {
    ok:
      true,
    edits:
      pair.distance,
    score:
      roundedScore
  };

}


/******************************************************
 * PRIVATE: BEST TOKEN PAIRING
 *
 * Names are short, so exhaustive permutation search is
 * safe and deterministic for typical candidate names.
 ******************************************************/
function V2CandidateMatcher_bestTokenPairing_(
  leftTokens,
  rightTokens
){

  if(
    leftTokens.length !==
    rightTokens.length
  ){
    return null;
  }

  const used = {};
  let best = null;

  function walk(
    index,
    pairs,
    totalDistance
  ){

    if(
      best &&
      totalDistance >
      best.totalDistance
    ){
      return;
    }

    if(
      index ===
      leftTokens.length
    ){

      if(
        !best ||
        totalDistance <
        best.totalDistance
      ){
        best = {
          totalDistance:
            totalDistance,
          pairs:
            pairs.slice()
        };
      }

      return;
    }

    for(
      let j = 0;
      j < rightTokens.length;
      j++
    ){

      if(used[j])
        continue;

      used[j] = true;

      const left =
        leftTokens[index];

      const right =
        rightTokens[j];

      const distance =
        V2CandidateMatcher_levenshtein_(
          left,
          right
        );

      pairs.push({
        left:
          left,
        right:
          right,
        distance:
          distance
      });

      walk(
        index + 1,
        pairs,
        totalDistance +
          distance
      );

      pairs.pop();

      used[j] = false;

    }

  }

  walk(
    0,
    [],
    0
  );

  return best;

}


/******************************************************
 * PRIVATE: PARTIAL RELATION
 *
 * REVIEW ONLY.
 * Requires at least 2 meaningful raw tokens and every
 * raw token to appear exactly in the master name.
 ******************************************************/
function V2CandidateMatcher_partialRelation_(
  rawTokens,
  masterTokens
){

  if(
    rawTokens.length < 2 ||
    rawTokens.length >=
      masterTokens.length
  ){
    return false;
  }

  const remaining =
    masterTokens.slice();

  for(
    let i = 0;
    i < rawTokens.length;
    i++
  ){

    const token =
      rawTokens[i];

    const position =
      remaining.indexOf(
        token
      );

    if(position < 0)
      return false;

    remaining.splice(
      position,
      1
    );

  }

  return true;

}


/******************************************************
 * PRIVATE: INITIAL RELATION
 *
 * REVIEW ONLY.
 * Allows a one-letter token to correspond to a master
 * token starting with the same letter, with all other
 * tokens equal ignoring order.
 ******************************************************/
function V2CandidateMatcher_initialRelation_(
  rawTokens,
  masterTokens
){

  if(
    rawTokens.length !==
      masterTokens.length ||
    rawTokens.length < 2
  ){
    return false;
  }

  const pairing =
    V2CandidateMatcher_bestTokenPairing_(
      rawTokens,
      masterTokens
    );

  if(!pairing)
    return false;

  let initialPairs = 0;

  for(
    let i = 0;
    i < pairing.pairs.length;
    i++
  ){

    const pair =
      pairing.pairs[i];

    if(pair.distance === 0)
      continue;

    const left =
      pair.left;

    const right =
      pair.right;

    const initialCompatible =
      (
        left.length === 1 &&
        right.length > 1 &&
        left.charAt(0) ===
          right.charAt(0)
      ) ||
      (
        right.length === 1 &&
        left.length > 1 &&
        right.charAt(0) ===
          left.charAt(0)
      );

    if(!initialCompatible)
      return false;

    initialPairs++;

  }

  return initialPairs === 1;

}


/******************************************************
 * PRIVATE: STRUCTURAL DECISION
 *
 * Uses ordered alignment.
 *
 * A raw full token must equal a master token.
 * A raw one-letter token may expand to a master token
 * beginning with that letter.
 * Master may contain additional omitted tokens.
 *
 * Initial-compatible matches have priority exactly as in
 * the verified read-only v1.1 preview.
 ******************************************************/
function V2CandidateMatcher_structuralDecision_(
  rawTokens,
  masterRecords
){

  if(
    !rawTokens ||
    rawTokens.length < 2
  ){
    return {
      status:
        "NEEDS_LOCATION_RULE",
      matches:
        []
    };
  }

  const exactCompatible = [];
  const initialCompatible = [];

  (masterRecords || [])
    .forEach(
      function(master){

        const relation =
          V2CandidateMatcher_structuralCompatibility_(
            rawTokens,
            master.tokens
          );

        if(
          !relation ||
          !relation.compatible
        ){
          return;
        }

        if(
          relation.initialExpansions > 0
        ){
          initialCompatible.push(
            master
          );
        }else if(
          relation.masterExtraTokens > 0
        ){
          exactCompatible.push(
            master
          );
        }

      }
    );

  if(initialCompatible.length === 1){

    return {
      status:
        "UNIQUE_INITIAL",
      matches:
        initialCompatible
    };

  }

  if(initialCompatible.length > 1){

    return {
      status:
        "BLOCK_MULTIPLE_COMPATIBLE",
      matches:
        initialCompatible
    };

  }

  if(exactCompatible.length === 1){

    return {
      status:
        "UNIQUE_PARTIAL",
      matches:
        exactCompatible
    };

  }

  if(exactCompatible.length > 1){

    return {
      status:
        "BLOCK_MULTIPLE_COMPATIBLE",
      matches:
        exactCompatible
    };

  }

  return {
    status:
      "NO_STRUCTURAL_MATCH",
    matches:
      []
  };

}


/******************************************************
 * PRIVATE: STRUCTURAL COMPATIBILITY
 ******************************************************/
function V2CandidateMatcher_structuralCompatibility_(
  rawTokens,
  masterTokens
){

  if(
    !rawTokens ||
    !masterTokens ||
    !rawTokens.length ||
    !masterTokens.length ||
    rawTokens.length >
      masterTokens.length
  ){
    return {
      compatible:
        false
    };
  }

  let best = null;

  function walk(
    rawIndex,
    masterIndex,
    initialExpansions,
    matchedPairs
  ){

    if(
      rawIndex ===
      rawTokens.length
    ){

      const masterExtraTokens =
        masterTokens.length -
        matchedPairs;

      const candidate = {
        compatible:
          true,
        initialExpansions:
          initialExpansions,
        masterExtraTokens:
          masterExtraTokens,
        matchedPairs:
          matchedPairs
      };

      if(
        !best ||
        candidate.initialExpansions <
          best.initialExpansions ||
        (
          candidate.initialExpansions ===
            best.initialExpansions &&
          candidate.masterExtraTokens <
            best.masterExtraTokens
        )
      ){
        best = candidate;
      }

      return;
    }

    if(
      masterIndex >=
      masterTokens.length
    ){
      return;
    }

    const rawToken =
      rawTokens[rawIndex];

    const masterToken =
      masterTokens[masterIndex];

    if(
      rawToken ===
      masterToken
    ){

      walk(
        rawIndex + 1,
        masterIndex + 1,
        initialExpansions,
        matchedPairs + 1
      );

    }else if(
      rawToken.length === 1 &&
      masterToken.length >= 2 &&
      masterToken.charAt(0) ===
        rawToken
    ){

      walk(
        rawIndex + 1,
        masterIndex + 1,
        initialExpansions + 1,
        matchedPairs + 1
      );

    }

    // Master may contain a token omitted from raw.
    walk(
      rawIndex,
      masterIndex + 1,
      initialExpansions,
      matchedPairs
    );

  }

  walk(
    0,
    0,
    0,
    0
  );

  if(!best){

    return {
      compatible:
        false
    };

  }

  // Exact names were already handled earlier and should
  // not be reclassified as structural expansion.
  if(
    best.initialExpansions === 0 &&
    best.masterExtraTokens === 0
  ){
    return {
      compatible:
        false
    };
  }

  return best;

}


/******************************************************
 * PRIVATE: SOURCE LOCATION
 *
 * Reads only parenthetical text in the candidate segment
 * before the first field separator dash.
 ******************************************************/
function V2CandidateMatcher_extractSourceLocation_(
  originalRecord
){

  const text =
    String(
      originalRecord || ""
    ).trim();

  if(!text)
    return "";

  const normalizedDash =
    text.replace(
      /[–—]/g,
      " - "
    );

  let candidateSegment =
    normalizedDash;

  const separator =
    normalizedDash.match(
      /\s+-+\s+/
    );

  if(separator){

    candidateSegment =
      normalizedDash.substring(
        0,
        separator.index
      );

  }

  const parentheses =
    candidateSegment.match(
      /\(([^()]*)\)/
    );

  if(!parentheses)
    return "";

  return V2CandidateMatcher_locationCanonicalize_(
    parentheses[1]
  );

}


/******************************************************
 * PRIVATE: LOCATION CANONICALIZATION
 *
 * Conservative country-level equivalence only.
 ******************************************************/
function V2CandidateMatcher_locationCanonicalize_(
  value
){

  let text =
    String(
      value || ""
    )
      .trim()
      .toLowerCase();

  if(!text)
    return "";

  try{
    text =
      text.normalize(
        "NFKD"
      );
  }catch(error){
    // Safe fallback.
  }

  text =
    text
      .replace(
        /[\u0300-\u036f]/g,
        ""
      )
      .replace(
        /[^a-z0-9]+/g,
        " "
      )
      .replace(
        /\s+/g,
        " "
      )
      .trim();

  if(
    !text ||
    text === "not added" ||
    text === "unknown" ||
    text === "na" ||
    text === "n a"
  ){
    return "";
  }

  if(
    text === "uk" ||
    text === "u k" ||
    text === "united kingdom" ||
    text === "england" ||
    text === "great britain" ||
    text === "britain" ||
    text === "london" ||
    text === "london uk"
  ){
    return "UNITED_KINGDOM";
  }

  if(
    text === "us" ||
    text === "u s" ||
    text === "usa" ||
    text === "u s a" ||
    text === "united states" ||
    text === "united states of america" ||
    text === "america" ||
    text === "tampa florida" ||
    text === "los angeles california"
  ){
    return "UNITED_STATES";
  }

  const direct = {
    "ireland":
      "IRELAND",
    "canada":
      "CANADA",
    "india":
      "INDIA",
    "germany":
      "GERMANY",
    "afghanistan":
      "AFGHANISTAN",
    "argentina":
      "ARGENTINA",
    "albania":
      "ALBANIA",
    "aland islands":
      "ALAND_ISLANDS",
    "bosnia and herzegovina":
      "BOSNIA_AND_HERZEGOVINA"
  };

  return direct[text] || "";

}


/******************************************************
 * PRIVATE: LOCATION FILTER
 ******************************************************/
function V2CandidateMatcher_filterByLocation_(
  records,
  canonicalLocation
){

  if(!canonicalLocation)
    return [];

  return (records || [])
    .filter(
      function(item){
        return (
          item.locationCanonical ===
          canonicalLocation
        );
      }
    );

}


/******************************************************
 * PRIVATE: SIMILARITY
 ******************************************************/
function V2CandidateMatcher_similarity_(
  left,
  right
){

  if(left === right)
    return 100;

  const compactLeft =
    V2CandidateMatcher_compact_(
      left
    );

  const compactRight =
    V2CandidateMatcher_compact_(
      right
    );

  const direct =
    V2CandidateMatcher_ratio_(
      compactLeft,
      compactRight
    );

  const sorted =
    V2CandidateMatcher_ratio_(
      V2CandidateMatcher_tokenKey_(
        left
      ).replace(/\s+/g,""),
      V2CandidateMatcher_tokenKey_(
        right
      ).replace(/\s+/g,"")
    );

  return Math.round(
    Math.max(
      direct,
      sorted
    ) * 100
  ) / 100;

}


function V2CandidateMatcher_ratio_(
  left,
  right
){

  if(left === right)
    return 100;

  if(!left || !right)
    return 0;

  const distance =
    V2CandidateMatcher_levenshtein_(
      left,
      right
    );

  return (
    1 -
    distance /
      Math.max(
        left.length,
        right.length
      )
  ) * 100;

}


/******************************************************
 * PRIVATE: LEVENSHTEIN
 ******************************************************/
function V2CandidateMatcher_levenshtein_(
  left,
  right
){

  const a =
    String(
      left || ""
    );

  const b =
    String(
      right || ""
    );

  if(a === b)
    return 0;

  if(!a.length)
    return b.length;

  if(!b.length)
    return a.length;

  let previous =
    [];

  let current =
    [];

  for(
    let j = 0;
    j <= b.length;
    j++
  ){
    previous[j] = j;
  }

  for(
    let i = 1;
    i <= a.length;
    i++
  ){

    current[0] = i;

    for(
      let j = 1;
      j <= b.length;
      j++
    ){

      const cost =
        a.charAt(
          i - 1
        ) ===
        b.charAt(
          j - 1
        )
          ? 0
          : 1;

      current[j] =
        Math.min(
          current[
            j - 1
          ] + 1,
          previous[j] + 1,
          previous[
            j - 1
          ] + cost
        );

    }

    const temp =
      previous;

    previous =
      current;

    current =
      temp;

  }

  return previous[
    b.length
  ];

}


/******************************************************
 * PRIVATE: NORMALIZATION
 ******************************************************/
function V2CandidateMatcher_normalize_(
  value
){

  let text =
    String(
      value || ""
    );

  try{
    text =
      text.normalize(
        "NFKD"
      );
  }catch(error){
    // Safe fallback.
  }

  return text
    .toLowerCase()
    .replace(
      /[\u0300-\u036f]/g,
      ""
    )
    .replace(
      /[^a-z0-9]+/g,
      " "
    )
    .replace(
      /\s+/g,
      " "
    )
    .trim();

}


function V2CandidateMatcher_compact_(
  normalized
){

  return String(
    normalized || ""
  )
    .replace(
      /\s+/g,
      ""
    );

}


function V2CandidateMatcher_tokens_(
  normalized
){

  return String(
    normalized || ""
  )
    .split(" ")
    .filter(Boolean);

}


function V2CandidateMatcher_tokenKey_(
  normalized
){

  return V2CandidateMatcher_tokens_(
    normalized
  )
    .sort()
    .join(" ");

}


/******************************************************
 * PRIVATE: RESULT HELPERS
 ******************************************************/
function V2CandidateMatcher_result_(
  status,
  candidateId,
  officialName,
  score,
  reason,
  conflicts
){

  return {
    status:
      status,
    candidateId:
      candidateId || "",
    officialName:
      officialName || "",
    score:
      Number(
        score || 0
      ),
    secondBestScore:
      0,
    margin:
      0,
    reason:
      reason || "",
    conflictingCandidateIds:
      conflicts || []
  };

}


function V2CandidateMatcher_reviewResult_(
  status,
  best,
  secondScore,
  margin,
  reason
){

  return {
    status:
      status,
    candidateId:
      "",
    officialName:
      best.item.officialName,
    suggestedCandidateId:
      best.item.candidateId,
    score:
      Math.round(
        best.score * 100
      ) / 100,
    secondBestScore:
      Math.round(
        secondScore * 100
      ) / 100,
    margin:
      Math.round(
        margin * 100
      ) / 100,
    reason:
      reason,
    conflictingCandidateIds:
      []
  };

}


/******************************************************
 * PRIVATE: COMBINED-EVIDENCE DECISION
 *
 * Permanent v1.2 implementation of the audited v1.5
 * read-only preview.
 *
 * It returns AUTO only when one Candidate ID has the
 * strongest explicit evidence. Ties remain unresolved.
 ******************************************************/
function V2CandidateMatcher_combinedEvidenceDecision_(
  rawTokens,
  masterRecords
){

  const evidenceRows = [];

  (masterRecords || [])
    .forEach(
      function(item){

        const evidence =
          V2CandidateMatcher_combinedCandidateEvidence_(
            rawTokens,
            item,
            masterRecords
          );

        if(
          evidence &&
          evidence.compatible
        ){

          evidenceRows.push({
            item:
              item,
            evidence:
              evidence
          });

        }

      }
    );

  if(
    evidenceRows.length === 0
  ){

    return {
      auto:
        false
    };

  }

  evidenceRows.sort(
    function(a,b){
      return (
        V2CandidateMatcher_compareCombinedEvidence_(
          b.evidence,
          a.evidence
        )
      );
    }
  );

  const best =
    evidenceRows[0];

  const peers =
    evidenceRows.filter(
      function(entry){
        return (
          V2CandidateMatcher_compareCombinedEvidence_(
            entry.evidence,
            best.evidence
          ) === 0
        );
      }
    );

  const candidateIds = {};

  peers.forEach(
    function(entry){
      candidateIds[
        entry.item.candidateId
      ] = true;
    }
  );

  if(
    Object.keys(
      candidateIds
    ).length !== 1
  ){

    return {
      auto:
        false,
      reason:
        "MULTIPLE_TOP_COMBINED_EVIDENCE_CANDIDATES"
    };

  }

  return {
    auto:
      true,
    status:
      best.evidence.status,
    item:
      best.item,
    reason:
      best.evidence.reason
  };

}


/******************************************************
 * PRIVATE: EVIDENCE FOR ONE MASTER CANDIDATE
 ******************************************************/
function V2CandidateMatcher_combinedCandidateEvidence_(
  rawTokens,
  item,
  allRecords
){

  const masterTokens =
    item.tokens || [];

  const exactShared =
    V2CandidateMatcher_combinedExactSharedCount_(
      rawTokens,
      masterTokens
    );

  //--------------------------------------------------
  // A. Raw token set is a subset of Master, any order.
  //
  // Adiraju Anusha
  // -> Lakshmi Sai Anusha Adiraju
  //--------------------------------------------------
  if(
    rawTokens.length >= 2 &&
    rawTokens.length <
      masterTokens.length &&
    V2CandidateMatcher_combinedMultisetContains_(
      masterTokens,
      rawTokens
    )
  ){

    return {
      compatible:
        true,
      status:
        "AUTO_UNORDERED_PARTIAL",
      rank:
        500,
      exactShared:
        rawTokens.length,
      coveredMasterTokens:
        rawTokens.length,
      editCount:
        0,
      reason:
        "ALL_RAW_TOKENS_EXIST_IN_MASTER_UNORDERED"
    };

  }

  //--------------------------------------------------
  // B. Entire Master name appears inside Raw and Raw
  //    contains extra words.
  //
  // Varahala Bharath Rajana -> Varahala Bharath
  //--------------------------------------------------
  if(
    rawTokens.length >
      masterTokens.length &&
    V2CandidateMatcher_combinedMultisetContains_(
      rawTokens,
      masterTokens
    )
  ){

    //------------------------------------------------
    // For a one-token official Master name, the token
    // itself must occur in exactly one Candidate ID.
    //------------------------------------------------
    if(
      masterTokens.length === 1
    ){

      const token =
        masterTokens[0];

      const ids = {};

      (allRecords || [])
        .forEach(
          function(other){

            if(
              (other.tokens || [])
                .indexOf(
                  token
                ) > -1
            ){
              ids[
                other.candidateId
              ] = true;
            }

          }
        );

      if(
        Object.keys(
          ids
        ).length !== 1
      ){
        return null;
      }

    }

    return {
      compatible:
        true,
      status:
        "AUTO_MASTER_SUBSET_RAW",
      rank:
        490,
      exactShared:
        masterTokens.length,
      coveredMasterTokens:
        masterTokens.length,
      editCount:
        0,
      reason:
        masterTokens.length === 1
          ? "UNIQUE_MASTER_TOKEN_FULL_NAME_FOUND_IN_RAW"
          : "ALL_MASTER_TOKENS_EXIST_IN_RAW_WITH_EXTRA_RAW_TOKENS"
    };

  }

  //--------------------------------------------------
  // C. Same token count. Exactly one name word differs
  //    by one insertion/deletion/substitution.
  //
  // Vamshi Arutala -> Vamshi Arutla
  // Ajay Kumar Pollam -> Ajay Kumar Polam
  //--------------------------------------------------
  const oneEdit =
    V2CandidateMatcher_combinedOneTokenEdit_(
      rawTokens,
      masterTokens
    );

  if(
    oneEdit.compatible
  ){

    return {
      compatible:
        true,
      status:
        "AUTO_ONE_TOKEN_EDIT",
      rank:
        470,
      exactShared:
        oneEdit.exactShared,
      coveredMasterTokens:
        masterTokens.length,
      editCount:
        1,
      reason:
        "ONE_WORD_SINGLE_CHARACTER_EDIT_WITH_EXACT_NAME_ANCHOR"
    };

  }

  //--------------------------------------------------
  // D. One Raw token contains multiple consecutive
  //    Master tokens, plus at least one independent
  //    exact Master token elsewhere in Raw.
  //
  // Raghuvamshi Goud -> Raghu Vamshi Goud
  //--------------------------------------------------
  const merged =
    V2CandidateMatcher_combinedMergedRelation_(
      rawTokens,
      masterTokens
    );

  if(
    merged.compatible
  ){

    return {
      compatible:
        true,
      status:
        "AUTO_MERGED_COMBINATION",
      rank:
        450 +
        merged.coveredMasterTokens,
      exactShared:
        merged.exactOutsideCount,
      coveredMasterTokens:
        merged.coveredMasterTokens,
      editCount:
        merged.mergeEditDistance,
      reason:
        "MERGED_MASTER_NAME_COMPONENTS_PLUS_INDEPENDENT_EXACT_ANCHOR"
    };

  }

  //--------------------------------------------------
  // E. Refined combined evidence.
  //
  // Shared words alone DO NOT auto-link. Residual name
  // differences must also be explainable.
  //--------------------------------------------------
  if(
    exactShared >= 2
  ){

    const residual =
      V2CandidateMatcher_combinedResidualRelation_(
        rawTokens,
        masterTokens,
        exactShared
      );

    if(
      residual.compatible
    ){
      return residual;
    }

  }

  return null;

}


/******************************************************
 * PRIVATE: REFINED RESIDUAL RELATION
 ******************************************************/
function V2CandidateMatcher_combinedResidualRelation_(
  rawTokens,
  masterTokens,
  exactShared
){

  const residual =
    V2CandidateMatcher_cancelExactCombinedTokens_(
      rawTokens,
      masterTokens
    );

  const rawRemaining =
    residual.rawRemaining;

  const masterRemaining =
    residual.masterRemaining;

  //--------------------------------------------------
  // E1. Initial expansion with exact anchors.
  //--------------------------------------------------
  if(
    rawRemaining.length === 1 &&
    masterRemaining.length === 1 &&
    rawRemaining[0].length === 1 &&
    masterRemaining[0]
      .charAt(0) ===
      rawRemaining[0]
  ){

    return {
      compatible:
        true,
      status:
        "AUTO_INITIAL_COMBINATION",
      rank:
        445 +
        exactShared,
      exactShared:
        exactShared,
      coveredMasterTokens:
        exactShared + 1,
      editCount:
        0,
      reason:
        "EXACT_NAME_ANCHORS_PLUS_MATCHING_INITIAL_EXPANSION"
    };

  }

  //--------------------------------------------------
  // E2. One explainable residual spelling token.
  //--------------------------------------------------
  const near =
    V2CandidateMatcher_findCombinedResidualNearPair_(
      rawRemaining,
      masterRemaining
    );

  if(
    near.compatible
  ){

    const rawLeft =
      rawRemaining.length - 1;

    const masterLeft =
      masterRemaining.length - 1;

    const leftoversOnBothSides =
      rawLeft > 0 &&
      masterLeft > 0;

    const extrasRemain =
      rawLeft > 0 ||
      masterLeft > 0;

    if(
      !leftoversOnBothSides &&
      (
        !extrasRemain ||
        exactShared >= 3
      )
    ){

      return {
        compatible:
          true,
        status:
          "AUTO_ANCHORED_NEAR_COMBINATION",
        rank:
          435 +
          exactShared +
          (
            near.distance === 1
              ? 2
              : 1
          ),
        exactShared:
          exactShared,
        coveredMasterTokens:
          exactShared + 1,
        editCount:
          near.distance,
        reason:
          "STRONG_EXACT_ANCHORS_PLUS_ONE_EXPLAINABLE_NEAR_NAME_TOKEN"
      };

    }

  }

  //--------------------------------------------------
  // E3. Multiple Raw residual tokens combine into one
  //    Master residual token.
  //--------------------------------------------------
  const reverseMerged =
    V2CandidateMatcher_reverseMergedResidual_(
      rawRemaining,
      masterRemaining
    );

  if(
    reverseMerged.compatible
  ){

    const rawLeft =
      rawRemaining.length -
      reverseMerged.rawGroupSize;

    const masterLeft =
      masterRemaining.length - 1;

    const leftoversOnBothSides =
      rawLeft > 0 &&
      masterLeft > 0;

    const extrasRemain =
      rawLeft > 0 ||
      masterLeft > 0;

    if(
      !leftoversOnBothSides &&
      (
        !extrasRemain ||
        exactShared >= 3
      )
    ){

      return {
        compatible:
          true,
        status:
          "AUTO_REVERSE_MERGED_COMBINATION",
        rank:
          440 +
          exactShared,
        exactShared:
          exactShared,
        coveredMasterTokens:
          exactShared + 1,
        editCount:
          reverseMerged.distance,
        reason:
          "MULTIPLE_RAW_NAME_TOKENS_COMBINE_TO_ONE_MASTER_TOKEN_WITH_EXACT_ANCHORS"
      };

    }

  }

  return {
    compatible:
      false
  };

}


/******************************************************
 * PRIVATE: CANCEL EXACT TOKENS
 ******************************************************/
function V2CandidateMatcher_cancelExactCombinedTokens_(
  rawTokens,
  masterTokens
){

  const rawRemaining =
    rawTokens.slice();

  const masterRemaining =
    masterTokens.slice();

  for(
    let r =
      rawRemaining.length - 1;
    r >= 0;
    r--
  ){

    const index =
      masterRemaining.indexOf(
        rawRemaining[r]
      );

    if(
      index < 0
    ){
      continue;
    }

    rawRemaining.splice(
      r,
      1
    );

    masterRemaining.splice(
      index,
      1
    );

  }

  return {
    rawRemaining:
      rawRemaining,
    masterRemaining:
      masterRemaining
  };

}


/******************************************************
 * PRIVATE: SINGLE RESIDUAL NEAR PAIR
 ******************************************************/
function V2CandidateMatcher_findCombinedResidualNearPair_(
  rawRemaining,
  masterRemaining
){

  const pairs = [];

  for(
    let r = 0;
    r < rawRemaining.length;
    r++
  ){

    const rawToken =
      rawRemaining[r];

    for(
      let m = 0;
      m < masterRemaining.length;
      m++
    ){

      const masterToken =
        masterRemaining[m];

      const distance =
        V2CandidateMatcher_levenshtein_(
          rawToken,
          masterToken
        );

      const minLength =
        Math.min(
          rawToken.length,
          masterToken.length
        );

      const allowed =
        (
          distance === 1 &&
          minLength >= 3
        ) ||
        (
          distance === 2 &&
          minLength >= 5
        );

      if(!allowed){
        continue;
      }

      pairs.push({
        rawToken:
          rawToken,
        masterToken:
          masterToken,
        distance:
          distance
      });

    }

  }

  if(
    pairs.length === 0
  ){

    return {
      compatible:
        false
    };

  }

  pairs.sort(
    function(a,b){

      if(
        a.distance !==
        b.distance
      ){
        return (
          a.distance -
          b.distance
        );
      }

      return (
        Math.abs(
          a.rawToken.length -
          a.masterToken.length
        ) -
        Math.abs(
          b.rawToken.length -
          b.masterToken.length
        )
      );

    }
  );

  const best =
    pairs[0];

  const tied =
    pairs.filter(
      function(item){

        return (
          item.distance ===
            best.distance &&
          Math.abs(
            item.rawToken.length -
            item.masterToken.length
          ) ===
          Math.abs(
            best.rawToken.length -
            best.masterToken.length
          )
        );

      }
    );

  if(
    tied.length !== 1
  ){

    return {
      compatible:
        false
    };

  }

  return {
    compatible:
      true,
    rawToken:
      best.rawToken,
    masterToken:
      best.masterToken,
    distance:
      best.distance
  };

}


/******************************************************
 * PRIVATE: REVERSE MERGED RESIDUAL
 ******************************************************/
function V2CandidateMatcher_reverseMergedResidual_(
  rawRemaining,
  masterRemaining
){

  if(
    rawRemaining.length < 2 ||
    masterRemaining.length < 1
  ){

    return {
      compatible:
        false
    };

  }

  const matches = [];

  const maxGroup =
    Math.min(
      3,
      rawRemaining.length
    );

  for(
    let groupSize = 2;
    groupSize <= maxGroup;
    groupSize++
  ){

    for(
      let start = 0;
      start + groupSize <=
        rawRemaining.length;
      start++
    ){

      const group =
        rawRemaining.slice(
          start,
          start + groupSize
        );

      const joined =
        group.join(
          ""
        );

      for(
        let m = 0;
        m < masterRemaining.length;
        m++
      ){

        const masterToken =
          masterRemaining[m];

        const distance =
          V2CandidateMatcher_levenshtein_(
            joined,
            masterToken
          );

        if(
          distance > 1
        ){
          continue;
        }

        matches.push({
          rawGroupSize:
            groupSize,
          distance:
            distance
        });

      }

    }

  }

  if(
    matches.length === 0
  ){

    return {
      compatible:
        false
    };

  }

  matches.sort(
    function(a,b){

      if(
        a.distance !==
        b.distance
      ){
        return (
          a.distance -
          b.distance
        );
      }

      return (
        b.rawGroupSize -
        a.rawGroupSize
      );

    }
  );

  const best =
    matches[0];

  const tied =
    matches.filter(
      function(item){
        return (
          item.distance ===
            best.distance &&
          item.rawGroupSize ===
            best.rawGroupSize
        );
      }
    );

  if(
    tied.length !== 1
  ){

    return {
      compatible:
        false
    };

  }

  return {
    compatible:
      true,
    rawGroupSize:
      best.rawGroupSize,
    distance:
      best.distance
  };

}


/******************************************************
 * PRIVATE: SAME-TOKEN-COUNT ONE-EDIT RELATION
 ******************************************************/
function V2CandidateMatcher_combinedOneTokenEdit_(
  rawTokens,
  masterTokens
){

  if(
    rawTokens.length !==
      masterTokens.length ||
    rawTokens.length < 2
  ){

    return {
      compatible:
        false
    };

  }

  const residual =
    V2CandidateMatcher_cancelExactCombinedTokens_(
      rawTokens,
      masterTokens
    );

  const rawRemaining =
    residual.rawRemaining;

  const masterRemaining =
    residual.masterRemaining;

  const exactShared =
    rawTokens.length -
    rawRemaining.length;

  if(
    exactShared < 1 ||
    rawRemaining.length !== 1 ||
    masterRemaining.length !== 1
  ){

    return {
      compatible:
        false
    };

  }

  const rawToken =
    rawRemaining[0];

  const masterToken =
    masterRemaining[0];

  if(
    rawToken.length < 4 ||
    masterToken.length < 4
  ){

    return {
      compatible:
        false
    };

  }

  const distance =
    V2CandidateMatcher_levenshtein_(
      rawToken,
      masterToken
    );

  if(
    distance !== 1
  ){

    return {
      compatible:
        false
    };

  }

  return {
    compatible:
      true,
    exactShared:
      exactShared
  };

}


/******************************************************
 * PRIVATE: MERGED RAW TOKEN RELATION
 ******************************************************/
function V2CandidateMatcher_combinedMergedRelation_(
  rawTokens,
  masterTokens
){

  if(
    rawTokens.length < 2 ||
    masterTokens.length < 3
  ){

    return {
      compatible:
        false
    };

  }

  let best = null;

  for(
    let rawIndex = 0;
    rawIndex < rawTokens.length;
    rawIndex++
  ){

    const rawToken =
      rawTokens[
        rawIndex
      ];

    if(
      rawToken.length < 6
    ){
      continue;
    }

    const maxGroup =
      Math.min(
        3,
        masterTokens.length - 1
      );

    for(
      let groupSize =
        maxGroup;
      groupSize >= 2;
      groupSize--
    ){

      for(
        let start = 0;
        start + groupSize <=
          masterTokens.length;
        start++
      ){

        const group =
          masterTokens.slice(
            start,
            start + groupSize
          );

        const target =
          group.join(
            ""
          );

        if(
          target.length < 6
        ){
          continue;
        }

        const approx =
          V2CandidateMatcher_findApproxCombinedSubstring_(
            rawToken,
            target,
            1
          );

        if(
          !approx.matched
        ){
          continue;
        }

        const groupIndexes = {};

        for(
          let g = start;
          g <
            start + groupSize;
          g++
        ){
          groupIndexes[g] =
            true;
        }

        let exactOutsideCount = 0;

        for(
          let mi = 0;
          mi < masterTokens.length;
          mi++
        ){

          if(
            groupIndexes[mi]
          ){
            continue;
          }

          const masterToken =
            masterTokens[mi];

          for(
            let ri = 0;
            ri < rawTokens.length;
            ri++
          ){

            if(
              ri === rawIndex
            ){
              continue;
            }

            if(
              rawTokens[ri] ===
                masterToken
            ){

              exactOutsideCount++;
              break;

            }

          }

        }

        if(
          exactOutsideCount < 1
        ){
          continue;
        }

        const candidate = {
          compatible:
            true,
          coveredMasterTokens:
            groupSize +
            exactOutsideCount,
          exactOutsideCount:
            exactOutsideCount,
          groupSize:
            groupSize,
          mergeEditDistance:
            approx.distance
        };

        if(
          !best ||
          candidate.coveredMasterTokens >
            best.coveredMasterTokens ||
          (
            candidate.coveredMasterTokens ===
              best.coveredMasterTokens &&
            candidate.groupSize >
              best.groupSize
          ) ||
          (
            candidate.coveredMasterTokens ===
              best.coveredMasterTokens &&
            candidate.groupSize ===
              best.groupSize &&
            candidate.mergeEditDistance <
              best.mergeEditDistance
          )
        ){
          best =
            candidate;
        }

      }

    }

  }

  return best || {
    compatible:
      false
  };

}


/******************************************************
 * PRIVATE: APPROXIMATE SUBSTRING FOR MERGED TOKENS
 ******************************************************/
function V2CandidateMatcher_findApproxCombinedSubstring_(
  rawToken,
  target,
  maxEdit
){

  const lengths = [
    target.length - 1,
    target.length,
    target.length + 1
  ]
    .filter(
      function(length){
        return (
          length >= 1 &&
          length <= rawToken.length
        );
      }
    );

  let best = null;

  lengths.forEach(
    function(length){

      for(
        let start = 0;
        start + length <=
          rawToken.length;
        start++
      ){

        const part =
          rawToken.substr(
            start,
            length
          );

        const distance =
          V2CandidateMatcher_levenshtein_(
            part,
            target
          );

        if(
          distance >
          maxEdit
        ){
          continue;
        }

        if(
          !best ||
          distance <
            best.distance
        ){

          best = {
            matched:
              true,
            distance:
              distance
          };

        }

      }

    }
  );

  return best || {
    matched:
      false,
    distance:
      null
  };

}


/******************************************************
 * PRIVATE: COMBINED EXACT SHARED COUNT
 ******************************************************/
function V2CandidateMatcher_combinedExactSharedCount_(
  rawTokens,
  masterTokens
){

  const remaining =
    masterTokens.slice();

  let count = 0;

  rawTokens.forEach(
    function(token){

      const index =
        remaining.indexOf(
          token
        );

      if(
        index < 0
      ){
        return;
      }

      count++;

      remaining.splice(
        index,
        1
      );

    }
  );

  return count;

}


/******************************************************
 * PRIVATE: COMBINED MULTISET CONTAINS
 ******************************************************/
function V2CandidateMatcher_combinedMultisetContains_(
  containerTokens,
  subsetTokens
){

  const remaining =
    containerTokens.slice();

  for(
    let i = 0;
    i < subsetTokens.length;
    i++
  ){

    const index =
      remaining.indexOf(
        subsetTokens[i]
      );

    if(
      index < 0
    ){
      return false;
    }

    remaining.splice(
      index,
      1
    );

  }

  return true;

}


/******************************************************
 * PRIVATE: COMBINED EVIDENCE COMPARATOR
 ******************************************************/
function V2CandidateMatcher_compareCombinedEvidence_(
  left,
  right
){

  const leftTuple = [
    Number(
      left.rank || 0
    ),
    Number(
      left.coveredMasterTokens || 0
    ),
    Number(
      left.exactShared || 0
    ),
    -Number(
      left.editCount || 0
    )
  ];

  const rightTuple = [
    Number(
      right.rank || 0
    ),
    Number(
      right.coveredMasterTokens || 0
    ),
    Number(
      right.exactShared || 0
    ),
    -Number(
      right.editCount || 0
    )
  ];

  for(
    let i = 0;
    i < leftTuple.length;
    i++
  ){

    if(
      leftTuple[i] >
        rightTuple[i]
    ){
      return 1;
    }

    if(
      leftTuple[i] <
        rightTuple[i]
    ){
      return -1;
    }

  }

  return 0;

}


/******************************************************
 * PRIVATE: ACTIVE STATUS CANONICALIZATION
 ******************************************************/
function V2CandidateMatcher_activeStatus_(
  value
){

  const normalized =
    String(
      value || ""
    )
      .trim()
      .toLowerCase();

  if(
    normalized ===
      "active"
  ){
    return "ACTIVE";
  }

  if(
    normalized ===
      "inactive"
  ){
    return "INACTIVE";
  }

  return "UNKNOWN";

}


/******************************************************
 * PRIVATE: ACTIVE POOL DECISION
 *
 * Auto only when:
 * - multiple compatible Candidate IDs exist,
 * - exactly one is explicitly ACTIVE,
 * - every other compatible Candidate ID is explicitly
 *   INACTIVE.
 *
 * UNKNOWN never behaves as Inactive.
 ******************************************************/
function V2CandidateMatcher_activePoolDecision_(
  pool
){

  const byId = {};

  (pool || [])
    .forEach(
      function(item){
        if(
          item &&
          item.candidateId
        ){
          byId[
            item.candidateId
          ] = item;
        }
      }
    );

  const unique =
    Object.keys(
      byId
    )
      .map(
        function(id){
          return byId[id];
        }
      );

  if(
    unique.length < 2
  ){
    return {
      auto:
        false
    };
  }

  const active =
    unique.filter(
      function(item){
        return (
          item.activeStatus ===
          "ACTIVE"
        );
      }
    );

  const inactive =
    unique.filter(
      function(item){
        return (
          item.activeStatus ===
          "INACTIVE"
        );
      }
    );

  if(
    active.length === 1 &&
    inactive.length ===
      unique.length - 1
  ){

    return {
      auto:
        true,
      item:
        active[0]
    };

  }

  return {
    auto:
      false
  };

}


/******************************************************
 * PRIVATE: NEXT-RULE SUPPORT SIMILARITY
 *
 * This intentionally preserves normalized spaces.
 *
 * Why:
 * The read-only v1.3 audit used the normalized full-name
 * string as its 85% supporting threshold. The general
 * matcher similarity uses compact/token-order scoring for
 * broader matching and may produce a slightly lower number.
 *
 * This helper is ONLY a supporting threshold. It is never
 * sufficient by itself to auto-link a candidate.
 ******************************************************/
function V2CandidateMatcher_nextRuleSupportSimilarity_(
  leftValue,
  rightValue
){

  const left =
    String(
      leftValue || ""
    );

  const right =
    String(
      rightValue || ""
    );

  if(left === right){
    return 100;
  }

  if(
    !left ||
    !right
  ){
    return 0;
  }

  const maxLength =
    Math.max(
      left.length,
      right.length
    );

  const distance =
    V2CandidateMatcher_levenshtein_(
      left,
      right
    );

  return Math.round(
    (
      1 -
      distance /
      maxLength
    ) *
    10000
  ) /
  100;

}


/******************************************************
 * PRIVATE: NEXT-RULE DECISION
 ******************************************************/
function V2CandidateMatcher_nextRuleDecision_(
  normalized,
  rawTokens,
  masterRecords
){

  //--------------------------------------------------
  // A. REVERSE INITIAL EXPANSION
  //--------------------------------------------------

  const reverseInitial =
    (masterRecords || [])
      .filter(
        function(item){
          return (
            V2CandidateMatcher_reverseInitialCompatible_(
              rawTokens,
              item.tokens
            )
          );
        }
      );

  const reverseDecision =
    V2CandidateMatcher_nextResolvePool_(
      reverseInitial,
      "AUTO_REVERSE_INITIAL",
      "MASTER_INITIAL_EXPANDS_TO_RAW_FULL_TOKEN",
      normalized
    );

  if(reverseDecision.auto){
    return reverseDecision;
  }

  //--------------------------------------------------
  // B. MULTI-TOKEN ONE-EDIT RELATION
  //--------------------------------------------------

  const multiEdit = [];

  (masterRecords || [])
    .forEach(
      function(item){

        const relation =
          V2CandidateMatcher_multiTokenEditRelation_(
            rawTokens,
            item.tokens
          );

        if(!relation.ok){
          return;
        }

        const score =
          V2CandidateMatcher_similarity_(
            normalized,
            item.normalized
          );

        const supportScore =
          V2CandidateMatcher_nextRuleSupportSimilarity_(
            normalized,
            item.normalized
          );

        if(
          supportScore <
          V2_CANDIDATE_MATCHER
            .NEXT_RULE_MIN_FULL_NAME_SIMILARITY
        ){
          return;
        }

        multiEdit.push({
          item:
            item,
          score:
            score,
          supportScore:
            supportScore
        });

      }
    );

  const multiDecision =
    V2CandidateMatcher_nextResolveScoredPool_(
      multiEdit,
      "AUTO_MULTI_TOKEN_EDIT",
      "MULTIPLE_SMALL_TOKEN_EDITS_WITH_EXACT_ANCHOR",
      normalized
    );

  if(multiDecision.auto){
    return multiDecision;
  }

  //--------------------------------------------------
  // C. ANCHORED NEAR / ADJACENT TRANSPOSITION
  //--------------------------------------------------

  const near = [];

  (masterRecords || [])
    .forEach(
      function(item){

        const relation =
          V2CandidateMatcher_anchoredNearNextRelation_(
            rawTokens,
            item.tokens
          );

        if(!relation.ok){
          return;
        }

        const score =
          V2CandidateMatcher_similarity_(
            normalized,
            item.normalized
          );

        const supportScore =
          V2CandidateMatcher_nextRuleSupportSimilarity_(
            normalized,
            item.normalized
          );

        // Explicit adjacent transposition is structural,
        // so a short full name may score just under 85.
        // Non-transposition edit-distance-2 cases use the
        // SAME normalized full-name support score that was
        // audited in the read-only v1.3 preview.
        if(
          relation.damerau > 1 &&
          supportScore <
            V2_CANDIDATE_MATCHER
              .NEXT_RULE_MIN_FULL_NAME_SIMILARITY
        ){
          return;
        }

        near.push({
          item:
            item,
          score:
            score,
          supportScore:
            supportScore
        });

      }
    );

  const nearDecision =
    V2CandidateMatcher_nextResolveScoredPool_(
      near,
      "AUTO_ANCHORED_NEAR_TOKEN",
      "EXACT_ANCHOR_PLUS_CLOSE_OR_TRANSPOSED_RESIDUAL_TOKEN",
      normalized
    );

  if(nearDecision.auto){
    return nearDecision;
  }

  return {
    auto:
      false
  };

}


/******************************************************
 * PRIVATE: NEXT-RULE POOL RESOLVER
 ******************************************************/
function V2CandidateMatcher_nextResolvePool_(
  pool,
  uniqueStatus,
  reason,
  normalized
){

  const byId = {};

  (pool || [])
    .forEach(
      function(item){
        if(
          item &&
          item.candidateId
        ){
          byId[
            item.candidateId
          ] = item;
        }
      }
    );

  const unique =
    Object.keys(
      byId
    )
      .map(
        function(id){
          return byId[id];
        }
      );

  if(
    unique.length === 1
  ){

    return {
      auto:
        true,
      status:
        uniqueStatus,
      item:
        unique[0],
      score:
        V2CandidateMatcher_similarity_(
          normalized,
          unique[0].normalized
        ),
      reason:
        reason
    };

  }

  if(
    unique.length > 1
  ){

    const active =
      V2CandidateMatcher_activePoolDecision_(
        unique
      );

    if(
      active.auto &&
      active.item
    ){

      return {
        auto:
          true,
        status:
          "AUTO_ACTIVE_DISAMBIGUATED",
        item:
          active.item,
        score:
          V2CandidateMatcher_similarity_(
            normalized,
            active.item.normalized
          ),
        reason:
          reason +
          "_EXACTLY_ONE_ACTIVE_ALL_OTHERS_INACTIVE"
      };

    }

  }

  return {
    auto:
      false
  };

}


/******************************************************
 * PRIVATE: NEXT-RULE SCORED POOL RESOLVER
 *
 * Score margin alone never chooses among candidates.
 ******************************************************/
function V2CandidateMatcher_nextResolveScoredPool_(
  scoredPool,
  uniqueStatus,
  reason,
  normalized
){

  const byId = {};

  (scoredPool || [])
    .forEach(
      function(entry){
        if(
          entry &&
          entry.item &&
          entry.item.candidateId
        ){

          const id =
            entry.item.candidateId;

          if(
            !byId[id] ||
            entry.score >
              byId[id].score
          ){
            byId[id] =
              entry;
          }

        }
      }
    );

  const unique =
    Object.keys(
      byId
    )
      .map(
        function(id){
          return byId[id];
        }
      );

  if(
    unique.length === 1
  ){

    return {
      auto:
        true,
      status:
        uniqueStatus,
      item:
        unique[0].item,
      score:
        unique[0].score,
      reason:
        reason
    };

  }

  if(
    unique.length > 1
  ){

    const active =
      V2CandidateMatcher_activePoolDecision_(
        unique.map(
          function(entry){
            return entry.item;
          }
        )
      );

    if(
      active.auto &&
      active.item
    ){

      return {
        auto:
          true,
        status:
          "AUTO_ACTIVE_DISAMBIGUATED",
        item:
          active.item,
        score:
          V2CandidateMatcher_similarity_(
            normalized,
            active.item.normalized
          ),
        reason:
          reason +
          "_EXACTLY_ONE_ACTIVE_ALL_OTHERS_INACTIVE"
      };

    }

  }

  return {
    auto:
      false
  };

}


/******************************************************
 * PRIVATE: REVERSE INITIAL EXPANSION
 ******************************************************/
function V2CandidateMatcher_reverseInitialCompatible_(
  rawTokens,
  masterTokens
){

  if(
    rawTokens.length !==
      masterTokens.length ||
    rawTokens.length < 2
  ){
    return false;
  }

  const usedRaw = [];

  for(
    let i = 0;
    i < rawTokens.length;
    i++
  ){
    usedRaw[i] = false;
  }

  const result =
    V2CandidateMatcher_reverseInitialWalk_(
      rawTokens,
      masterTokens,
      0,
      usedRaw,
      0,
      0
    );

  return (
    result &&
    result.exactCount >= 1 &&
    result.initialCount >= 1
  );

}


function V2CandidateMatcher_reverseInitialWalk_(
  rawTokens,
  masterTokens,
  masterIndex,
  usedRaw,
  exactCount,
  initialCount
){

  if(
    masterIndex >=
      masterTokens.length
  ){

    return {
      exactCount:
        exactCount,
      initialCount:
        initialCount
    };

  }

  const masterToken =
    masterTokens[
      masterIndex
    ];

  for(
    let r = 0;
    r < rawTokens.length;
    r++
  ){

    if(usedRaw[r]){
      continue;
    }

    const rawToken =
      rawTokens[r];

    const exact =
      masterToken ===
      rawToken;

    const masterInitial =
      masterToken.length === 1 &&
      rawToken.length > 1 &&
      rawToken
        .charAt(0) ===
      masterToken;

    if(
      !exact &&
      !masterInitial
    ){
      continue;
    }

    usedRaw[r] = true;

    const result =
      V2CandidateMatcher_reverseInitialWalk_(
        rawTokens,
        masterTokens,
        masterIndex + 1,
        usedRaw,
        exactCount +
          (
            exact
              ? 1
              : 0
          ),
        initialCount +
          (
            masterInitial
              ? 1
              : 0
          )
      );

    usedRaw[r] = false;

    if(result){
      return result;
    }

  }

  return null;

}


/******************************************************
 * PRIVATE: MULTI-TOKEN SMALL EDITS
 ******************************************************/
function V2CandidateMatcher_multiTokenEditRelation_(
  rawTokens,
  masterTokens
){

  if(
    rawTokens.length !==
      masterTokens.length ||
    rawTokens.length < 3
  ){
    return {
      ok:
        false
    };
  }

  const residual =
    V2CandidateMatcher_cancelExactNextTokens_(
      rawTokens,
      masterTokens
    );

  if(
    residual.exactCount < 1 ||
    residual.raw.length < 2 ||
    residual.raw.length !==
      residual.master.length
  ){
    return {
      ok:
        false
    };
  }

  const ok =
    V2CandidateMatcher_nextPairResidual_(
      residual.raw,
      residual.master,
      function(rawToken,masterToken){

        return (
          V2CandidateMatcher_levenshtein_(
            rawToken,
            masterToken
          ) <= 1
        );

      }
    );

  return {
    ok:
      !!ok
  };

}


/******************************************************
 * PRIVATE: ANCHORED NEAR / TRANSPOSITION
 ******************************************************/
function V2CandidateMatcher_anchoredNearNextRelation_(
  rawTokens,
  masterTokens
){

  if(
    rawTokens.length !==
      masterTokens.length ||
    rawTokens.length < 2
  ){
    return {
      ok:
        false
    };
  }

  const residual =
    V2CandidateMatcher_cancelExactNextTokens_(
      rawTokens,
      masterTokens
    );

  if(
    residual.exactCount < 1 ||
    residual.raw.length !== 1 ||
    residual.master.length !== 1
  ){
    return {
      ok:
        false
    };
  }

  const rawToken =
    residual.raw[0];

  const masterToken =
    residual.master[0];

  if(
    Math.min(
      rawToken.length,
      masterToken.length
    ) < 5
  ){
    return {
      ok:
        false
    };
  }

  const lev =
    V2CandidateMatcher_levenshtein_(
      rawToken,
      masterToken
    );

  const damerau =
    V2CandidateMatcher_damerauLevenshtein_(
      rawToken,
      masterToken
    );

  // Matcher v1.2 already owns Levenshtein-1.
  if(
    lev <= 1
  ){
    return {
      ok:
        false
    };
  }

  if(
    !(
      damerau <= 1 ||
      lev <= 2
    )
  ){
    return {
      ok:
        false
    };
  }

  return {
    ok:
      true,
    levenshtein:
      lev,
    damerau:
      damerau
  };

}


/******************************************************
 * PRIVATE: CANCEL EXACT NEXT-RULE TOKENS
 ******************************************************/
function V2CandidateMatcher_cancelExactNextTokens_(
  rawTokens,
  masterTokens
){

  const raw =
    rawTokens.slice();

  const master =
    masterTokens.slice();

  let exactCount = 0;

  for(
    let r =
      raw.length - 1;
    r >= 0;
    r--
  ){

    const index =
      master.indexOf(
        raw[r]
      );

    if(
      index < 0
    ){
      continue;
    }

    raw.splice(
      r,
      1
    );

    master.splice(
      index,
      1
    );

    exactCount++;

  }

  return {
    raw:
      raw,
    master:
      master,
    exactCount:
      exactCount
  };

}


/******************************************************
 * PRIVATE: RESIDUAL TOKEN PAIRING
 ******************************************************/
function V2CandidateMatcher_nextPairResidual_(
  rawTokens,
  masterTokens,
  relationFn
){

  const used = [];

  for(
    let i = 0;
    i < masterTokens.length;
    i++
  ){
    used[i] = false;
  }

  function walk(
    rawIndex
  ){

    if(
      rawIndex >=
      rawTokens.length
    ){
      return true;
    }

    for(
      let m = 0;
      m < masterTokens.length;
      m++
    ){

      if(used[m]){
        continue;
      }

      if(
        !relationFn(
          rawTokens[
            rawIndex
          ],
          masterTokens[m]
        )
      ){
        continue;
      }

      used[m] = true;

      if(
        walk(
          rawIndex + 1
        )
      ){
        used[m] = false;
        return true;
      }

      used[m] = false;

    }

    return false;

  }

  return walk(0);

}


/******************************************************
 * PRIVATE: DAMERAU-LEVENSHTEIN
 *
 * Adjacent transposition counts as one edit.
 ******************************************************/
function V2CandidateMatcher_damerauLevenshtein_(
  leftValue,
  rightValue
){

  const left =
    String(
      leftValue || ""
    );

  const right =
    String(
      rightValue || ""
    );

  const rows =
    left.length + 1;

  const cols =
    right.length + 1;

  const matrix = [];

  for(
    let i = 0;
    i < rows;
    i++
  ){

    matrix[i] = [];

    for(
      let j = 0;
      j < cols;
      j++
    ){

      if(i === 0){
        matrix[i][j] = j;
      }else if(j === 0){
        matrix[i][j] = i;
      }else{
        matrix[i][j] = 0;
      }

    }

  }

  for(
    let i = 1;
    i < rows;
    i++
  ){

    for(
      let j = 1;
      j < cols;
      j++
    ){

      const cost =
        left.charAt(
          i - 1
        ) ===
        right.charAt(
          j - 1
        )
          ? 0
          : 1;

      matrix[i][j] =
        Math.min(
          matrix[i - 1][j] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j - 1] +
            cost
        );

      if(
        i > 1 &&
        j > 1 &&
        left.charAt(
          i - 1
        ) ===
        right.charAt(
          j - 2
        ) &&
        left.charAt(
          i - 2
        ) ===
        right.charAt(
          j - 1
        )
      ){

        matrix[i][j] =
          Math.min(
            matrix[i][j],
            matrix[i - 2][j - 2] +
              1
          );

      }

    }

  }

  return matrix[
    rows - 1
  ][
    cols - 1
  ];

}


/******************************************************
 * SECTION 5: REPOSITORY TESTS
 * Former Apps Script file: V2RepositoryTests.gs
 ******************************************************/

/******************************************************
 * V2REPOSITORYTESTS.GS
 *
 * READ-ONLY repository foundation tests.
 * No sheet writes.
 ******************************************************/


function V2_testRepositoryReadOnly(){

  const teams =
    V2Repo_getTeams();

  const users =
    V2Repo_getUsers();

  const candidates =
    V2Repo_getCandidates();

  const gateway =
    V2Repo_getGateway();

  const gatewayIds =
    {};

  const duplicateGatewayIds =
    [];

  let ready = 0;
  let review = 0;
  let missingGatewayId = 0;
  let parserVersionMismatch = 0;

  gateway.forEach(
    function(row){

      const id =
        String(
          row["Gateway ID"] || ""
        ).trim();

      if(!id){

        missingGatewayId++;

      }else if(
        gatewayIds[id]
      ){

        duplicateGatewayIds.push(
          id
        );

      }else{

        gatewayIds[id] = true;

      }

      const parseStatus =
        String(
          row["Parse Status"] || ""
        )
          .trim()
          .toUpperCase();

      if(
        parseStatus ===
        "READY"
      ){
        ready++;
      }

      if(
        parseStatus ===
        "REVIEW"
      ){
        review++;
      }

      if(
        String(
          row["Parser Version"] || ""
        ).trim() !==
        String(
          V2_GATEWAY_CONFIG
            .PARSER_VERSION || ""
        ).trim()
      ){
        parserVersionMismatch++;
      }

    }
  );

  const duplicateTeamIds =
    V2Repo_findDuplicateValues_(
      teams,
      "Team ID"
    );

  const duplicateCandidateIds =
    V2Repo_findDuplicateValues_(
      candidates,
      "Candidate ID"
    );

  const duplicateOfficialCandidateNames =
    V2Repo_findDuplicateValues_(
      candidates,
      "Official Candidate Name"
    );

  const teamIds =
    teams.map(
      function(row){
        return String(
          row["Team ID"] || ""
        ).trim();
      }
    );

  const requiredTeamIds = [
    "TEAM-PA",
    "TEAM-HYD",
    "TEAM-MKT",
    "TEAM-DEV",
    "TEAM-EXC"
  ];

  const missingRequiredTeamIds =
    requiredTeamIds.filter(
      function(teamId){
        return (
          teamIds.indexOf(
            teamId
          ) === -1
        );
      }
    );

  const candidateTable =
    V2Repo_readTable(
      "CANDIDATE_MASTER"
    );

  const requiredCandidateProfileFields =
    V2Repo_candidateProfileFields_();

  const missingCandidateProfileFields =
    requiredCandidateProfileFields
      .filter(
        function(field){
          return (
            candidateTable.headers
              .indexOf(
                field
              ) === -1
          );
        }
      );

  const result = {

    ok:
      true,

    repositoryVersion:
      V2_REPOSITORY_VERSION,

    foundationVersion:
      V2_CONFIG.VERSION,

    parserVersion:
      V2_GATEWAY_CONFIG
        .PARSER_VERSION,

    counts: {
      teams:
        teams.length,
      users:
        users.length,
      candidates:
        candidates.length,
      gateway:
        gateway.length,
      gatewayReady:
        ready,
      gatewayReview:
        review
    },

    integrity: {
      missingRequiredTeamIds:
        missingRequiredTeamIds,
      duplicateTeamIds:
        duplicateTeamIds,
      missingGatewayId:
        missingGatewayId,
      duplicateGatewayIds:
        duplicateGatewayIds,
      parserVersionMismatch:
        parserVersionMismatch,
      duplicateCandidateIds:
        duplicateCandidateIds,
      duplicateOfficialCandidateNames:
        duplicateOfficialCandidateNames,
      missingCandidateProfileFields:
        missingCandidateProfileFields
    }

  };

  result.ok =
    (
      result.counts.teams === 5 &&
      missingRequiredTeamIds.length === 0 &&
      duplicateTeamIds.length === 0 &&
      result.counts.gateway > 0 &&
      (
        ready +
        review
      ) ===
        result.counts.gateway &&
      missingGatewayId === 0 &&
      duplicateGatewayIds.length === 0 &&
      parserVersionMismatch === 0 &&
      duplicateCandidateIds.length === 0 &&
      missingCandidateProfileFields.length === 0
    );

  Logger.log(
    "========== V2 REPOSITORY READ-ONLY TEST =========="
  );

  Logger.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );

  Logger.log(
    "================================================="
  );

  return result;

}


/******************************************************
 * READ-ONLY REPOSITORY SAMPLE
 ******************************************************/
function V2_previewRepositorySample(){

  const result = {

    teams:
      V2Repo_getTeams(),

    first5Gateway:
      V2Repo_getGateway({
        limit:
          5
      }),

    reviewGateway:
      V2Repo_getGateway({
        parseStatus:
          "REVIEW",
        limit:
          10
      }),

    candidateCount:
      V2Repo_getCandidates()
        .length

  };

  Logger.log(
    "========== V2 REPOSITORY SAMPLE =========="
  );

  Logger.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );

  Logger.log(
    "=========================================="
  );

  return result;

}


/******************************************************
 * SECTION 6: GATEWAY + INTEGRATION TESTS
 * Former Apps Script file: V2GatewayTests.gs
 ******************************************************/

/******************************************************
 * V2GATEWAYTESTS.GS
 * Permanent regression tests for V2 Gateway parser.
 *
 * READ-ONLY: does not write to any spreadsheet.
 ******************************************************/

function V2_runGatewayRegressionTests(){

  const tests = [

    {
      id:
        "GW-001",
      text:
        "Sai nikhil velagapudi – Interview – Merck & Co. – 12:40 AM IST – Duration: 20 Mins (1st Round)",
      expected: {
        candidateRaw:
          "Sai nikhil velagapudi",
        clientRaw:
          "Merck & Co.",
        timeNormalized:
          "12:40 AM",
        durationMinutes:
          20,
        roundLabel:
          "1st Round",
        roundNo:
          1
      }
    },

    {
      id:
        "GW-002",
      text:
        "Sumasree Bodela – Interview – Voloridge - interview (1 st round) – 1:00 AM IST – Duration: 15 Mins",
      expected: {
        candidateRaw:
          "Sumasree Bodela",
        clientRaw:
          "Voloridge",
        timeNormalized:
          "1:00 AM",
        durationMinutes:
          15,
        roundLabel:
          "1st Round",
        roundNo:
          1
      }
    },

    {
      id:
        "GW-003",
      text:
        "lavanya akiri – Interview – psiquantum – 1:30 AM IST – Duration: 60 Mins (2nd Round)",
      expected: {
        candidateRaw:
          "lavanya akiri",
        clientRaw:
          "psiquantum",
        timeNormalized:
          "1:30 AM",
        durationMinutes:
          60,
        roundLabel:
          "2nd Round",
        roundNo:
          2
      }
    },

    {
      id:
        "GW-004-LOOP-INTERVIEW",
      text:
        "Venkata Koushik Reddy Varikoti – Interview – Loop Interview - HD Supply – 6:30 PM IST – Duration: 30 Mins (3rd Round)",
      expected: {
        candidateRaw:
          "Venkata Koushik Reddy Varikoti",
        clientRaw:
          "HD Supply",
        timeNormalized:
          "6:30 PM",
        durationMinutes:
          30,
        roundLabel:
          "3rd Round",
        roundNo:
          3
      }
    },

    {
      id:
        "GW-005-DISCUSSION-ROUND",
      text:
        "Achyuth gowtham – Interview – Michigan Department of Community Health - Discussion Round – 7:00 PM IST – Duration: 30 Mins",
      expected: {
        candidateRaw:
          "Achyuth gowtham",
        clientRaw:
          "Michigan Department of Community Health",
        timeNormalized:
          "7:00 PM",
        durationMinutes:
          30,
        roundLabel:
          "Discussion Round",
        roundNo:
          ""
      }
    },

    {
      id:
        "GW-006-DURATION-HYPHEN",
      text:
        "Jyothipriya ramavath – Interview – Distro - 30 - Mins – 11:00 PM IST (2nd Round)",
      expected: {
        candidateRaw:
          "Jyothipriya ramavath",
        clientRaw:
          "Distro",
        timeNormalized:
          "11:00 PM",
        durationMinutes:
          30,
        roundLabel:
          "2nd Round",
        roundNo:
          2
      }
    },

    {
      id:
        "GW-007-TRAILING-RESCHEDULE",
      text:
        "Thrayamba Keswar (UK) – Interview – Ethypharm – 12:30 PM IST – Duration: 15 Mins (1st Round, Rescheduled from 30th June)",
      expected: {
        candidateRaw:
          "Thrayamba Keswar",
        clientRaw:
          "Ethypharm",
        timeNormalized:
          "12:30 PM",
        durationMinutes:
          15,
        roundLabel:
          "1st Round",
        roundNo:
          1,
        notesUnclassified:
          ["Rescheduled from 30th June"]
      }
    },

    {
      id:
        "GW-008-TRAILING-WAITING",
      text:
        "Prem Sai Jagadish (UK) – Phone Interview – Parkside Office Professional – 2:30 PM IST – Duration: 20 Mins (1st Round, Waiting for Invite)",
      expected: {
        candidateRaw:
          "Prem Sai Jagadish",
        clientRaw:
          "Parkside Office Professional",
        timeNormalized:
          "2:30 PM",
        durationMinutes:
          20,
        roundLabel:
          "1st Round",
        roundNo:
          1,
        notesUnclassified:
          ["Waiting for Invite"]
      }
    },

    {
      id:
        "GW-009-NO-TIME-WAITING-CONFIRMATION",
      text:
        "Mydhili Palagani (UK) – Interview – Thermofisher – Duration: 30 Mins (1st Round, Waiting for Confirmation & Invite)",
      expected: {
        candidateRaw:
          "Mydhili Palagani",
        clientRaw:
          "Thermofisher",
        timeNormalized:
          "",
        durationMinutes:
          30,
        roundLabel:
          "1st Round",
        roundNo:
          1,
        notesUnclassified:
          ["Waiting for Confirmation & Invite"]
      }
    },

    {
      id:
        "GW-010-NO-TIME-CLIENT-PRESERVED",
      text:
        "Joy Richard Paul Nandeti – Interview – Avis Budget Group (1st Round, Waiting for Invite)",
      expected: {
        candidateRaw:
          "Joy Richard Paul Nandeti",
        clientRaw:
          "Avis Budget Group",
        timeNormalized:
          "",
        durationMinutes:
          "",
        roundLabel:
          "1st Round",
        roundNo:
          1,
        notesUnclassified:
          ["Waiting for Invite"]
      }
    },

    {
      id:
        "GW-011-TECHNICAL-DISCUSSION-TYPE",
      text:
        "Venkata Koushik Reddy Varikoti – Technical Discussion w/ Hiring Manager – Walmart – 12:30 AM IST – Duration: 45 Mins (1st Round)",
      expected: {
        candidateRaw:
          "Venkata Koushik Reddy Varikoti",
        clientRaw:
          "Walmart",
        timeNormalized:
          "12:30 AM",
        durationMinutes:
          45,
        roundLabel:
          "1st Round",
        roundNo:
          1,
        interviewType:
          "Interview",
        operationalTags:
          ["Technical Discussion w/ Hiring Manager"]
      }
    },

    {
      id:
        "GW-012-PHN-CALL-ALIAS",
      text:
        "Adiraju anusha(uk) - Phn call - rhermofisher - 8:00 PM IST(20 Mins)",
      expected: {
        candidateRaw:
          "Adiraju anusha",
        clientRaw:
          "rhermofisher",
        timeNormalized:
          "8:00 PM",
        durationMinutes:
          20,
        roundLabel:
          "",
        roundNo:
          "",
        interviewType:
          "Phone Call"
      }
    },

    {
      id:
        "GW-013-NO-TYPE-FALLBACK-CLIENT",
      text:
        "Upendra kumar M – Tyson Foods -12:30am ist(30 mins 1st round)",
      expected: {
        candidateRaw:
          "Upendra kumar M",
        clientRaw:
          "Tyson Foods",
        timeNormalized:
          "12:30 AM",
        durationMinutes:
          30,
        roundLabel:
          "1st Round",
        roundNo:
          1,
        interviewType:
          ""
      }
    },

    {
      id:
        "GW-014-NO-TIME-NO-DURATION-CLIENT",
      text:
        "Haritha Nallam – Interview – Tenet Healthcare (Waiting for Invite)",
      expected: {
        candidateRaw:
          "Haritha Nallam",
        clientRaw:
          "Tenet Healthcare",
        timeNormalized:
          "",
        durationMinutes:
          "",
        roundLabel:
          "",
        roundNo:
          "",
        notesUnclassified:
          ["Waiting for Invite"]
      }
    },

    {
      id:
        "GW-015-ZOOM-INTERVIEW",
      text:
        "Candidate One – Zoom Interview – Acme Corp – 9:00 PM IST – Duration: 30 Mins (1st Round)",
      expected: {
        candidateRaw:
          "Candidate One",
        clientRaw:
          "Acme Corp",
        interviewType:
          "Interview",
        timeNormalized:
          "9:00 PM",
        durationMinutes:
          30,
        roundLabel:
          "1st Round"
      }
    },

    {
      id:
        "GW-016-MICROSOFT-TEAMS-INTERVIEW",
      text:
        "Candidate Two – Microsoft Teams Interview – Example Health – 10:15 PM IST – Duration: 45 Mins (2nd Round)",
      expected: {
        candidateRaw:
          "Candidate Two",
        clientRaw:
          "Example Health",
        interviewType:
          "Interview",
        roundNo:
          2
      }
    },

    {
      id:
        "GW-017-GOOGLE-MEET-INTERVIEW",
      text:
        "Candidate Three – Google Meet Interview – Northstar – 11:00 PM IST – Duration: 30 Mins (1st Round)",
      expected: {
        candidateRaw:
          "Candidate Three",
        clientRaw:
          "Northstar",
        interviewType:
          "Interview"
      }
    },

    {
      id:
        "GW-018-GOOGLE-VOICE-CALL",
      text:
        "Candidate Four – Google Voice Call – Meridian – 8:30 PM IST – Duration: 20 Mins",
      expected: {
        candidateRaw:
          "Candidate Four",
        clientRaw:
          "Meridian",
        interviewType:
          "Phone Call",
        durationMinutes:
          20
      }
    },

    {
      id:
        "GW-019-FINAL-DISCUSSION-AS-TYPE",
      text:
        "Candidate Five – Final Discussion – Walmart – 12:30 AM IST – Duration: 45 Mins",
      expected: {
        candidateRaw:
          "Candidate Five",
        clientRaw:
          "Walmart",
        interviewType:
          "Interview",
        roundLabel:
          "",
        roundNo:
          "",
        stageDescriptor:
          "Final Discussion",
        operationalTags:
          ["Final Discussion"]
      }
    },

    {
      id:
        "GW-020-TECHNICAL-DISCUSSION-AS-TYPE",
      text:
        "Candidate Six – Technical Discussion – Contoso – 1:00 AM IST – Duration: 30 Mins (2nd Round)",
      expected: {
        candidateRaw:
          "Candidate Six",
        clientRaw:
          "Contoso",
        interviewType:
          "Interview",
        roundNo:
          2,
        operationalTags:
          ["Technical Discussion"]
      }
    },

    {
      id:
        "GW-021-FINAL-TECH-DISCUSSION-AFTER-CLIENT",
      text:
        "Candidate Seven – Interview – Fabrikam – Final Technical Discussion – 1:30 AM IST – Duration: 30 Mins (3rd Round)",
      expected: {
        candidateRaw:
          "Candidate Seven",
        clientRaw:
          "Fabrikam",
        interviewType:
          "Interview",
        roundLabel:
          "3rd Round",
        roundNo:
          3,
        operationalTags:
          ["Final Technical Discussion"]
      }
    },

    {
      id:
        "GW-022-PHONE-INTERVIEW-NO-TIME-CLIENT",
      text:
        "Candidate Eight – Phone Interview – Avis Budget Group (Waiting for Invite)",
      expected: {
        candidateRaw:
          "Candidate Eight",
        clientRaw:
          "Avis Budget Group",
        interviewType:
          "Phone Interview",
        timeNormalized:
          "",
        durationMinutes:
          "",
        notesUnclassified:
          ["Waiting for Invite"]
      }
    },

    {
      id:
        "GW-023-DISCUSSION-AS-TYPE",
      text:
        "Candidate Nine – Discussion – Globex – 2:00 AM IST – Duration: 30 Mins",
      expected: {
        candidateRaw:
          "Candidate Nine",
        clientRaw:
          "Globex",
        interviewType:
          "Interview",
        stageDescriptor:
          "Discussion",
        operationalTags:
          ["Discussion"]
      }
    },

    {
      id:
        "GW-024-CLIENT-BEFORE-PHONE-TYPE",
      text:
        "Priyanka Nelluri - Ford - Phone Interview- 8:30 PM (1st round)(15mins)",
      expected: {
        candidateRaw:
          "Priyanka Nelluri",
        clientRaw:
          "Ford",
        interviewType:
          "Phone Interview",
        timeNormalized:
          "8:30 PM",
        durationMinutes:
          15,
        roundLabel:
          "1st Round",
        roundNo:
          1,
        dataCompleteness:
          "COMPLETE",
        schedulingReadiness:
          "SOURCE_READY_FOR_TEAM_ASSIGNMENT",
        reviewReasons:
          []
      }
    },

    {
      id:
        "GW-025-TYPE-UNSPECIFIED-NOT-PARSE-FAILURE",
      text:
        "Upendra kumar M – Tyson Foods -12:30am ist(30 mins 1st round)",
      expected: {
        candidateRaw:
          "Upendra kumar M",
        clientRaw:
          "Tyson Foods",
        interviewType:
          "",
        timeNormalized:
          "12:30 AM",
        durationMinutes:
          30,
        roundLabel:
          "1st Round",
        roundNo:
          1,
        missingFields:
          ["INTERVIEW_TYPE"],
        dataCompleteness:
          "PARTIAL",
        schedulingReadiness:
          "SOURCE_READY_FOR_TEAM_ASSIGNMENT",
        reviewReasons:
          []
      }
    },

    {
      id:
        "GW-026-AWAITING-INVITE-NOT-PARSE-FAILURE",
      text:
        "Joy Richard Paul Nandeti – Interview – Avis Budget Group (1st Round, Waiting for Invite)",
      expected: {
        candidateRaw:
          "Joy Richard Paul Nandeti",
        clientRaw:
          "Avis Budget Group",
        interviewType:
          "Interview",
        roundNo:
          1,
        missingFields:
          ["TIME", "DURATION"],
        dataCompleteness:
          "AWAITING_CONFIRMATION",
        schedulingReadiness:
          "SOURCE_NOT_READY_AWAITING_CONFIRMATION",
        reviewReasons:
          []
      }
    },

    {
      id:
        "GW-027-MISSING-ROUND-CAN-STILL-BE-SOURCE-READY",
      text:
        "Adiraju Anusha (UK) – Phone Call – Thermofisher – 8:00 PM IST – Duration: 20 Mins (Waiting for Confirmation)",
      expected: {
        candidateRaw:
          "Adiraju Anusha",
        clientRaw:
          "Thermofisher",
        interviewType:
          "Phone Call",
        missingFields:
          ["ROUND"],
        dataCompleteness:
          "AWAITING_CONFIRMATION",
        schedulingReadiness:
          "SOURCE_READY_FOR_TEAM_ASSIGNMENT",
        reviewReasons:
          []
      }
    },

    {
      id:
        "GW-028-STAGE-DESCRIPTOR-STRUCTURED",
      text:
        "Venkata Koushik Reddy Varikoti – Technical Discussion w/ Hiring Manager – Walmart – 12:30 AM IST – Duration: 45 Mins (1st Round)",
      expected: {
        candidateRaw:
          "Venkata Koushik Reddy Varikoti",
        clientRaw:
          "Walmart",
        interviewType:
          "Interview",
        stageDescriptor:
          "Technical Discussion w/ Hiring Manager",
        roundNo:
          1
      }
    }
,

    {
      id:
        "GW-029-TECHNICAL-INTERVIEW-DETAIL",
      text:
        "Lakshmi Narayana U – Technical Interview – XKL LLC – 11:00 PM IST – Duration: 60 Mins (2nd Round)",
      expected: {
        candidateRaw: "Lakshmi Narayana U",
        clientRaw: "XKL LLC",
        interviewType: "Interview",
        interviewDetail: "Technical Interview",
        stageDescriptor: "",
        timeNormalized: "11:00 PM",
        durationMinutes: 60,
        roundLabel: "2nd Round",
        operationalTags: ["Need Developer"],
        reviewReasons: []
      }
    },

    {
      id:
        "GW-030-TECHNICAL-CODING-DETAIL",
      text:
        "Venkata Sai Swetha Gatamaneni (Germany) – Technical Coding Interview – Sikia.ai – 9:00 PM IST – Duration: 60 Mins (2nd Round)",
      expected: {
        candidateRaw: "Venkata Sai Swetha Gatamaneni",
        clientRaw: "Sikia.ai",
        interviewType: "Interview",
        interviewDetail: "Technical Coding Interview",
        stageDescriptor: "",
        operationalTags: ["Need Developer"],
        reviewReasons: []
      }
    },

    {
      id:
        "GW-031-EXCEL-INTERVIEW-DETAIL",
      text:
        "Candidate Excel – Excel Interview – Contoso – 9:30 PM IST – Duration: 30 Mins (1st Round)",
      expected: {
        candidateRaw: "Candidate Excel",
        clientRaw: "Contoso",
        interviewType: "Interview",
        interviewDetail: "Excel Interview",
        stageDescriptor: "",
        operationalTags: [],
        reviewReasons: []
      }
    },

    {
      id:
        "GW-032-AI-INTERVIEW-DETAIL",
      text:
        "Candidate AI – AI Interview – Fabrikam – 10:00 PM IST – Duration: 30 Mins (1st Round)",
      expected: {
        candidateRaw: "Candidate AI",
        clientRaw: "Fabrikam",
        interviewType: "Interview",
        interviewDetail: "AI Interview",
        stageDescriptor: "",
        operationalTags: [],
        reviewReasons: []
      }
    },

    {
      id:
        "GW-033-PANEL-INTERVIEW-DETAIL",
      text:
        "Vineetha Gadde – Panel Interview – Goodwill – 10:00 PM IST – Duration: 1 Hr (3rd Round)",
      expected: {
        candidateRaw: "Vineetha Gadde",
        clientRaw: "Goodwill",
        interviewType: "Interview",
        interviewDetail: "Panel Interview",
        stageDescriptor: "",
        reviewReasons: []
      }
    },

    {
      id:
        "GW-034-HIRING-MANAGER-INTERVIEW-DETAIL",
      text:
        "Pavan Kumar Chebelli – Hiring Manager Interview – Citi Bank – 10:00 PM IST – Duration: 1 Hour (1st Round)",
      expected: {
        candidateRaw: "Pavan Kumar Chebelli",
        clientRaw: "Citi Bank",
        interviewType: "Interview",
        interviewDetail: "Hiring Manager Interview",
        stageDescriptor: "",
        reviewReasons: []
      }
    },

    {
      id:
        "GW-035-ASSESSMENT-INTERVIEW-DETAIL",
      text:
        "Ashrith Bhooka Raviinandhan – Assessment Interview – TypeSafe AI – 12:00 AM IST – Duration: 15 Mins (1st Round)",
      expected: {
        candidateRaw: "Ashrith Bhooka Raviinandhan",
        clientRaw: "TypeSafe AI",
        interviewType: "Interview",
        interviewDetail: "Assessment Interview",
        stageDescriptor: "",
        reviewReasons: []
      }
    },

    {
      id:
        "GW-036-PHONE-SCREEN-DETAIL",
      text:
        "Sri Mayur Dasari – Phone Screen – Foundation Risk Partners – 8:30 PM IST – Duration: 30 Mins",
      expected: {
        candidateRaw: "Sri Mayur Dasari",
        clientRaw: "Foundation Risk Partners",
        interviewType: "Phone Interview",
        interviewDetail: "Phone Screen",
        reviewReasons: []
      }
    },

    {
      id:
        "GW-037-PREP-CALL-DETAIL",
      text:
        "Ashwan Teja (Ireland) – Prep Call – Salesforce – 9:00 PM IST – Duration: 10 Mins",
      expected: {
        candidateRaw: "Ashwan Teja",
        clientRaw: "Salesforce",
        interviewType: "Prep Call",
        interviewDetail: "Prep Call",
        reviewReasons: []
      }
    },

    {
      id:
        "GW-038-PHN-INTERVIEW-DETAIL",
      text:
        "Chaithra Talagavara Sundaresha (UK) – Phn Interview – BAE Systems – 8:00 PM IST – Duration: 30 Mins (1st Round)",
      expected: {
        candidateRaw: "Chaithra Talagavara Sundaresha",
        clientRaw: "BAE Systems",
        interviewType: "Phone Interview",
        interviewDetail: "Phn Interview",
        reviewReasons: []
      }
    },

    {
      id:
        "GW-039-WAITING-TIME-CONFIRMATION-AND-INVITE",
      text:
        "Prathap K (Ireland) – Interview – Glen Dimplex – Waiting for Time Confirmation and Invite – Duration: 30 Mins (1st Round)",
      expected: {
        candidateRaw: "Prathap K",
        clientRaw: "Glen Dimplex",
        interviewType: "Interview",
        notesUnclassified: ["Waiting for Time Confirmation and Invite"],
        reviewReasons: []
      }
    },

    {
      id:
        "GW-040-HOUR-ONLY-TIME",
      text:
        "Rakesh k (Ireland) - Interview - Twilio - 6pm IST (60 mins) (2nd round)",
      expected: {
        candidateRaw: "Rakesh k",
        clientRaw: "Twilio",
        timeNormalized: "6:00 PM",
        durationMinutes: 60,
        roundLabel: "2nd Round",
        reviewReasons: []
      }
    },

    {
      id:
        "GW-041-AMBIGUOUS-TIME-NOT-GUESSED",
      text:
        "Mydhili Palagani (UK) – Phone Interview - Thermofisher - 5:30 (30 Mins)(1st round)",
      expected: {
        candidateRaw: "Mydhili Palagani",
        clientRaw: "Thermofisher",
        timeRaw: "5:30",
        timeNormalized: "",
        durationMinutes: 30,
        roundLabel: "1st Round",
        reviewReasons: []
      }
    },

    {
      id:
        "GW-042-CLIENT-AFTER-TIME",
      text:
        "Bhavanteja Ammisetty – Interview – 8:30 PM IST Infinitiv (2nd Round)",
      expected: {
        candidateRaw: "Bhavanteja Ammisetty",
        clientRaw: "Infinitiv",
        interviewType: "Interview",
        timeNormalized: "8:30 PM",
        roundLabel: "2nd Round",
        reviewReasons: []
      }
    },

    {
      id:
        "GW-043-CLIENT-BEFORE-TYPE-LOOSE-DASHES",
      text:
        "Pravallika Obulapuram  -Community Hospital Corporation -interview—1:15 am(IST) (1hr) (1st round )",
      expected: {
        candidateRaw: "Pravallika Obulapuram",
        clientRaw: "Community Hospital Corporation",
        interviewType: "Interview",
        timeNormalized: "1:15 AM",
        durationMinutes: 60,
        roundLabel: "1st Round",
        reviewReasons: []
      }
    },

    {
      id:
        "GW-044-TYPE-PARENTHETICAL-DESCRIPTOR",
      text:
        "Shaik Mohmad Sartaj Ali (Ireland) – Interview (STAR Technique) – Permanent TSB – 6:30 PM IST – Duration: 30 Mins (1st Round)",
      expected: {
        candidateRaw: "Shaik Mohmad Sartaj Ali",
        clientRaw: "Permanent TSB",
        interviewType: "Interview",
        operationalTags: ["STAR Technique"],
        reviewReasons: []
      }
    },

    {
      id:
        "GW-045-DISCUSSION-STAYS-STAGE-NOT-DETAIL",
      text:
        "Candidate Stage – Technical Discussion – Walmart – 12:30 AM IST – Duration: 45 Mins (2nd Round)",
      expected: {
        candidateRaw: "Candidate Stage",
        clientRaw: "Walmart",
        interviewType: "Interview",
        interviewDetail: "",
        stageDescriptor: "Technical Discussion",
        roundNo: 2,
        reviewReasons: []
      }
    },

    {
      id:
        "GW-046-FINAL-TECH-DISCUSSION-NO-ROUND",
      text:
        "Candidate Ten – Interview – Contoso – Final Technical Discussion – 10:30 PM IST – Duration: 30 Mins",
      expected: {
        candidateRaw: "Candidate Ten",
        clientRaw: "Contoso",
        interviewType: "Interview",
        stageDescriptor: "Final Technical Discussion",
        roundLabel: "",
        roundNo: "",
        operationalTags: ["Final Technical Discussion"],
        reviewReasons: []
      }
    },

    {
      id:
        "GW-047-FINAL-TECH-DISCUSSION-WITH-NUMERIC-ROUND",
      text:
        "Candidate Eleven – Interview – Contoso – Final Technical Discussion – 10:30 PM IST – Duration: 30 Mins (3rd Round)",
      expected: {
        candidateRaw: "Candidate Eleven",
        clientRaw: "Contoso",
        stageDescriptor: "Final Technical Discussion",
        roundLabel: "3rd Round",
        roundNo: 3,
        operationalTags: ["Final Technical Discussion"],
        reviewReasons: []
      }
    },

    {
      id:
        "GW-048-FINAL-TECH-DISCUSSION-WITH-EXPLICIT-FINAL-ROUND",
      text:
        "Candidate Twelve – Interview – Contoso – Final Technical Discussion – 10:30 PM IST – Duration: 30 Mins (Final Round)",
      expected: {
        candidateRaw: "Candidate Twelve",
        clientRaw: "Contoso",
        stageDescriptor: "Final Technical Discussion",
        roundLabel: "Final",
        roundNo: 999,
        operationalTags: ["Final Technical Discussion"],
        reviewReasons: []
      }
    },

    {
      id:
        "GW-049-FINAL-DISCUSSION-ROUND-STAYS-STAGE",
      text:
        "Candidate Thirteen – Interview – Contoso – Final Discussion Round – 11:00 PM IST – Duration: 30 Mins",
      expected: {
        candidateRaw: "Candidate Thirteen",
        clientRaw: "Contoso",
        stageDescriptor: "Final Discussion Round",
        roundLabel: "",
        roundNo: "",
        operationalTags: ["Final Discussion Round"],
        reviewReasons: []
      }
    },

    {
      id:
        "GW-050-TECHNICAL-DISCUSSION-ROUND-STAYS-STAGE",
      text:
        "Candidate Fourteen – Interview – Contoso – Technical Discussion Round – 11:30 PM IST – Duration: 30 Mins",
      expected: {
        candidateRaw: "Candidate Fourteen",
        clientRaw: "Contoso",
        stageDescriptor: "Technical Discussion Round",
        roundLabel: "",
        roundNo: "",
        operationalTags: ["Technical Discussion Round"],
        reviewReasons: []
      }
    },

    {
      id: "GW-051-FINAL-INTERVIEW-DETAIL-NOT-FINAL-ROUND",
      text: "Tarun Donda – Final Interview – CACI – 7:30 PM IST – Duration: 1 Hour (2nd Round)",
      expected: {
        clientRaw: "CACI",
        interviewType: "Interview",
        interviewDetail: "Final Interview",
        roundLabel: "2nd Round",
        roundNo: 2,
        reviewReasons: []
      }
    },

    {
      id: "GW-052-WAITING-TIME-INVITE-NOT-CLIENT",
      text: "Ashwan Teja (Ireland) – Phone Call – Interactive Brokers – Waiting for time Invite",
      expected: {
        clientRaw: "Interactive Brokers",
        missingFields: ["TIME", "DURATION", "ROUND"],
        reviewReasons: []
      }
    },

    {
      id: "GW-053-WAITING-LINK-NOT-CLIENT",
      text: "Humera Khanam Pathan – Interview – HigherPeople's – Waiting for Link",
      expected: {
        clientRaw: "HigherPeople's",
        notesUnclassified: ["Waiting for Link"],
        reviewReasons: []
      }
    },

    {
      id: "GW-054-WAITING-INTERVIEW-INVITE-NOT-CLIENT",
      text: "Abusufiyan Dudekula – Interview – FedEx (1st Round) – Waiting for interview invite.",
      expected: {
        clientRaw: "FedEx",
        reviewReasons: []
      }
    },

    {
      id: "GW-055-TYPE-PARENTHETICAL-DESCRIPTOR",
      text: "Yashaswi Kashozhala (UK) – Interview (Assessment through call, Quick Catch Up) – Ocado Group – 4:00 PM IST – Duration: 30 Mins (1st Round)",
      expected: {
        clientRaw: "Ocado Group",
        operationalTags: ["Assessment through call, Quick Catch Up"],
        reviewReasons: []
      }
    },

    {
      id: "GW-056-DUPLICATE-ROUND-WORD-WAITING",
      text: "Sai kumar battu– Interview – leffell schoo – (1hr)( 3rd round round)waiting for invite",
      expected: {
        clientRaw: "leffell schoo",
        durationMinutes: 60,
        roundLabel: "3rd Round",
        missingFields: ["TIME"],
        reviewReasons: []
      }
    },

    {
      id: "GW-057-CODING-ROUND-DETAIL",
      text: "Ashrith Bhooka Ravinandhan – Coding Round – TypeSafe AI – 7:30 PM IST – Duration: 30 Mins (2nd Round)",
      expected: {
        clientRaw: "TypeSafe AI",
        interviewType: "Interview",
        interviewDetail: "Coding Round",
        reviewReasons: []
      }
    },

    {
      id: "GW-058-WAITING-INTERVIEW-CANDIDATE-FIRST",
      text: "Shravan Kumar Goud – Interview – ComPsych – Waiting for Interview (1st Round) candidate 1st Interview",
      expected: {
        clientRaw: "ComPsych",
        notesUnclassified: ["Waiting for Interview", "Candidate 1st Interview"],
        reviewReasons: []
      }
    },

    {
      id: "GW-059-ASSESSMENT-THROUGH-INTERVIEW",
      text: "Aparna Veldurti – Assessment through Interview – Zscalar – 11:30 AM IST – Duration: 15 Mins (1st Round)",
      expected: {
        clientRaw: "Zscalar",
        interviewDetail: "Assessment through Interview",
        reviewReasons: []
      }
    },

    {
      id: "GW-060-LOOP-INTERVIEW-DETAIL",
      text: "Abhishek M – Loop Interview – Verisk – 10:30 PM IST – Duration: 3 Hours (3rd Round)",
      expected: {
        clientRaw: "Verisk",
        interviewDetail: "Loop Interview",
        reviewReasons: []
      }
    },

    {
      id: "GW-061-CANDIDATE-SIDE-DETAIL",
      text: "Sravan Kumar Sunketa – Candidate Side Interview – Centric Brands – 9:30 PM IST – Duration: 30 Mins (1st Round)",
      expected: {
        clientRaw: "Centric Brands",
        interviewDetail: "Candidate Side Interview",
        reviewReasons: []
      }
    },

    {
      id: "GW-062-BEHAVIORAL-DETAIL",
      text: "Nihal Inapanuri – Behavioral Interview – Home Depot – 11:30 PM IST – Duration: 45 Mins (3rd Round)",
      expected: {
        clientRaw: "Home Depot",
        interviewDetail: "Behavioral Interview",
        reviewReasons: []
      }
    },

    {
      id: "GW-063-CODING-INTERVIEW-AFTER-GENERIC",
      text: "Sravan Kumar Sunketa – Interview – Coding Interview - Centric Brands – 9:30 PM IST – Duration: 45 Mins (2nd Round)",
      expected: {
        clientRaw: "Centric Brands",
        interviewDetail: "Coding Interview",
        reviewReasons: []
      }
    },

    {
      id: "GW-064-TECHNICAL-LOOP-AFTER-GENERIC",
      text: "Mahesh Tirumalasetti – Interview – Technical Loop Interview - Elorian AI – 11:30 PM IST – Duration: 4Hrs (2nd Round) (Need a Developer)",
      expected: {
        clientRaw: "Elorian AI",
        interviewDetail: "Technical Loop Interview",
        operationalTags: ["Need Developer", "Loop Interview"],
        reviewReasons: []
      }
    },

    {
      id: "GW-065-WAITING-ASSESSMENT-NOTE",
      text: "Lakshmi Bhavani Chennamasetty – Interview – Optum – Waiting for Invite (2nd Round) (Need to do assessment in the interview)",
      expected: {
        clientRaw: "Optum",
        notesUnclassified: ["Waiting for Invite", "Need to do assessment in the interview"],
        reviewReasons: []
      }
    },

    {
      id: "GW-066-MISSING-CLIENT-STAYS-REVIEW",
      text: "Venkatesh Basimi (Ireland) – Interview – 6:30 PM IST – Duration: 30 Mins (1st Round)",
      expected: {
        clientRaw: "",
        missingFields: ["CLIENT"],
        reviewReasons: ["CLIENT_NOT_EXTRACTED"]
      }
    },

    {
      id: "GW-067-AMBIGUOUS-HYPHENATED-CLIENT-STAYS-REVIEW",
      text: "Mani Teja – Interview – The Hartford - Channel Interactions – 11:00 PM IST – Duration: 30 Mins (1st Round)",
      expected: {
        clientRaw: "The Hartford - Channel Interactions",
        reviewReasons: ["CLIENT_HAS_MULTIPLE_UNCLASSIFIED_SEGMENTS"]
      }
    },

    {
      id: "GW-068-CLIENT-PARENTHETICAL-DASH-STAYS-REVIEW",
      text: "Sreeja Thimmapuram – Interview – ALTEN (Business Analyst – AI Solutions) – 8:30 PM IST – Duration: 30 Mins (1st Round)",
      expected: {
        reviewReasons: ["CLIENT_HAS_MULTIPLE_UNCLASSIFIED_SEGMENTS"]
      }
    }
  ];

  const results = [];
  let passed = 0;

  tests.forEach(
    function(test){

      const parsed =
        V2_gatewayParseText_(
          test.text
        );

      const failures = [];

      Object.keys(
        test.expected
      ).forEach(
        function(key){

          if(
            String(
              parsed[key]
            ) !==
            String(
              test.expected[key]
            )
          ){

            failures.push(
              key +
              " expected=[" +
              test.expected[key] +
              "] actual=[" +
              parsed[key] +
              "]"
            );

          }

        }
      );

      const ok =
        failures.length === 0;

      if(ok)
        passed++;

      results.push({
        id:
          test.id,
        ok:
          ok,
        failures:
          failures,
        parsed:
          parsed
      });

    }
  );

  const result = {
    ok:
      passed === tests.length,
    passed:
      passed,
    total:
      tests.length,
    results:
      results
  };

  Logger.log(
    "========== V2 GATEWAY REGRESSION TEST =========="
  );

  results.forEach(
    function(item){

      Logger.log(
        item.id +
        " : " +
        (
          item.ok
            ? "PASS"
            : "FAIL"
        )
      );

      if(!item.ok){
        Logger.log(
          JSON.stringify(
            item.failures,
            null,
            2
          )
        );
      }

    }
  );

  Logger.log(
    "RESULT : " +
    (
      result.ok
        ? "PASS"
        : "FAIL"
    ) +
    " | " +
    passed +
    "/" +
    tests.length
  );

  Logger.log(
    "================================================"
  );

  return result;
}


/******************************************************
 * READ-ONLY: candidate near-match unit test.
 * Does not use spreadsheet Candidate Master.
 ******************************************************/
function V2_runCandidateMatchingUnitTest(){

  const master = [
    {
      candidateId:
        "CAND-0001",
      officialName:
        "Achyuth Gowtham",
      key:
        V2_normalizeName_(
          "Achyuth Gowtham"
        )
    },
    {
      candidateId:
        "CAND-0002",
      officialName:
        "Lavanya Akiri",
      key:
        V2_normalizeName_(
          "Lavanya Akiri"
        )
    }
  ];

  const cases = [
    "achyuth gowtham",
    "ACHYUTH GOWTHAM",
    "Achyuth  Gowtham",
    "Achyuth Gowtham",
    "Lavanya Akri"
  ];

  Logger.log(
    "========== V2 CANDIDATE MATCH UNIT TEST =========="
  );

  cases.forEach(
    function(name){

      Logger.log(
        name +
        " => " +
        JSON.stringify(
          V2_matchCandidate_(
            name,
            master
          )
        )
      );

    }
  );

  Logger.log(
    "================================================="
  );
}


/******************************************************
 * READ-ONLY: V1.4 REAL RAW PARSER PREVIEW
 ******************************************************/
function V2_previewGatewayV14Stats(){

  const sourceRecords =
    V2_readRawSourceRecords_();

  const reasonCounts = {};
  const reviewSamples = [];

  let ready = 0;
  let review = 0;

  sourceRecords.forEach(
    function(source){

      const parsed =
        V2_gatewayParseText_(
          source.originalText
        );

      if(
        parsed.reviewReasons &&
        parsed.reviewReasons.length
      ){

        review++;

        parsed.reviewReasons.forEach(
          function(reason){
            reasonCounts[reason] =
              (
                reasonCounts[reason] || 0
              ) + 1;
          }
        );

        if(reviewSamples.length < 20){
          reviewSamples.push({
            sourceRow:
              source.sourceRow,
            candidate:
              parsed.candidateRaw,
            client:
              parsed.clientRaw,
            interviewDetail:
              parsed.interviewDetail,
            reviewReasons:
              parsed.reviewReasons,
            original:
              source.originalText
          });
        }

      }else{
        ready++;
      }

    }
  );

  const result = {
    ok:
      true,
    mode:
      "READ_ONLY",
    sourceRecords:
      sourceRecords.length,
    ready:
      ready,
    review:
      review,
    reviewReasons:
      reasonCounts,
    first20Reviews:
      reviewSamples,
    parserVersion:
      V2_GATEWAY_CONFIG.PARSER_VERSION
  };

  Logger.log(
    "========== V2 V1.4 READ-ONLY RAW PREVIEW =========="
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

  return result;
}


/******************************************************
 * READ-ONLY: GATEWAY -> CANDIDATE MATCHER INTEGRATION
 *
 * Confirms V2Gateway uses the repository-backed matcher
 * without writing V2 Interview Gateway.
 ******************************************************/
function V2_testGatewayCandidateMatcherIntegrationReadOnly(){

  const masterIndex =
    V2_loadCandidateMaster_();

  const checks = {

    exact:
      V2_matchCandidate_(
        "Kiran Biradar",
        masterIndex
      ),

    tokenEquivalent:
      V2_matchCandidate_(
        "Sai Kumar Battu",
        masterIndex
      ),

    strongTypo:
      V2_matchCandidate_(
        "Hari Venkata Ravi Teja Anumakonda",
        masterIndex
      ),

    structuralPartial:
      V2_matchCandidate_(
        "Naga Bhargav Kumar",
        masterIndex
      ),

    structuralInitial:
      V2_matchCandidate_(
        "Meghana B",
        masterIndex
      ),

    locationDisambiguated:
      V2_matchCandidate_(
        "Rakesh K",
        masterIndex,
        {
          originalRecord:
            "Rakesh K (Ireland) - Interview - Test Client"
        }
      ),

    locationAmbiguous:
      V2_matchCandidate_(
        "Surya",
        masterIndex,
        {
          originalRecord:
            "Surya (Ireland) - Interview - Test Client"
        }
      ),

    initialReview:
      V2_matchCandidate_(
        "Rakesh K",
        masterIndex
      ),

    oneTokenEdit:
      V2_matchCandidate_(
        "Prema Kumar Ravipalli",
        masterIndex
      ),

    duplicateActiveDisambiguated:
      V2_matchCandidate_(
        "Keerthi Venkata Prasanna Kotra",
        masterIndex
      )

  };

  const ok =
    (
      V2_GATEWAY_CONFIG
        .PARSER_VERSION ===
        "GW-PARSER-1.4.0" &&

      typeof V2_CANDIDATE_MATCHER !==
        "undefined" &&

      V2_CANDIDATE_MATCHER
        .VERSION ===
        "V2-CANDIDATE-MATCHER-1.3.1" &&

      checks
        .exact
        .status ===
        "AUTO_EXACT_NORMALIZED" &&
      !!checks
        .exact
        .candidateId &&

      checks
        .tokenEquivalent
        .status ===
        "AUTO_TOKEN_EQUIVALENT" &&
      checks
        .tokenEquivalent
        .candidateId ===
        "CAN-000097" &&

      checks
        .strongTypo
        .status ===
        "AUTO_NEAR_TYPO" &&
      checks
        .strongTypo
        .candidateId ===
        "CAN-000251" &&

      checks
        .structuralPartial
        .status ===
        "AUTO_UNIQUE_PARTIAL" &&
      !!checks
        .structuralPartial
        .candidateId &&
      !!checks
        .structuralPartial
        .officialName &&

      checks
        .structuralInitial
        .status ===
        "AUTO_UNIQUE_INITIAL" &&
      !!checks
        .structuralInitial
        .candidateId &&
      !!checks
        .structuralInitial
        .officialName &&

      checks
        .locationDisambiguated
        .status ===
        "AUTO_LOCATION_DISAMBIGUATED" &&
      !!checks
        .locationDisambiguated
        .candidateId &&

      String(
        checks
          .locationAmbiguous
          .status
      ).indexOf(
        "AUTO_"
      ) !== 0 &&
      !checks
        .locationAmbiguous
        .candidateId &&

      checks
        .initialReview
        .status ===
        "REVIEW_INITIAL" &&
      !checks
        .initialReview
        .candidateId &&
      !checks
        .initialReview
        .officialName &&

      checks
        .oneTokenEdit
        .status ===
        "AUTO_ONE_TOKEN_EDIT" &&
      checks
        .oneTokenEdit
        .candidateId ===
        "CAN-000270" &&
      checks
        .oneTokenEdit
        .officialName ===
        "Prema Kumari Ravipalli" &&

      checks
        .duplicateActiveDisambiguated
        .status ===
        "AUTO_ACTIVE_DISAMBIGUATED" &&
      checks
        .duplicateActiveDisambiguated
        .candidateId ===
        "CAN-000353" &&
      checks
        .duplicateActiveDisambiguated
        .officialName ===
        "Keerthi venkata Prasanna Kotra"
    );

  const result = {

    ok:
      ok,

    mode:
      "READ_ONLY",

    parserVersion:
      V2_GATEWAY_CONFIG
        .PARSER_VERSION,

    matcherVersion:
      (
        typeof V2_CANDIDATE_MATCHER !==
          "undefined"
      )
        ? V2_CANDIDATE_MATCHER.VERSION
        : "MISSING",

    master: {
      normalizedNames:
        masterIndex.normalizedNameCount,
      uniqueRecords:
        masterIndex.uniqueRecords.length,
      duplicateNormalizedGroups:
        masterIndex
          .duplicateNormalizedGroups
          .length
    },

    checks:
      checks

  };

  Logger.log(
    "========== V2 GATEWAY CANDIDATE INTEGRATION TEST =========="
  );

  Logger.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );

  Logger.log(
    "==========================================================="
  );

  return result;

}


/******************************************************
 * READ-ONLY: CURRENT GATEWAY MATCH DISTRIBUTION PREVIEW
 *
 * Uses Candidate Raw already present in the 3,321-row
 * Gateway. It does NOT rebuild or write Gateway.
 ******************************************************/
function V2_previewGatewayCandidateIntegrationStats(){

  const gatewayRows =
    V2Repo_getGateway({});

  const masterIndex =
    V2_loadCandidateMaster_();

  const counts = {};
  const variantMap = {};

  gatewayRows.forEach(
    function(row){

      const raw =
        String(
          row["Candidate Raw"] || ""
        ).trim();

      const match =
        V2_matchCandidate_(
          raw,
          masterIndex,
          {
            originalRecord:
              String(
                row["Original Record"] || ""
              )
          }
        );

      counts[
        match.status
      ] =
        (
          counts[
            match.status
          ] || 0
        ) + 1;

      const key =
        V2CandidateMatcher_normalize_(
          raw
        ) || "__BLANK__";

      if(!variantMap[key]){
        variantMap[key] = {
          raw:
            raw,
          status:
            match.status,
          candidateId:
            match.candidateId,
          score:
            match.score,
          records:
            0
        };
      }

      variantMap[key]
        .records++;

    }
  );

  const autoStatuses = {
    AUTO_EXACT_NORMALIZED:
      true,
    AUTO_TOKEN_EQUIVALENT:
      true,
    AUTO_NEAR_TYPO:
      true,
    AUTO_UNIQUE_PARTIAL:
      true,
    AUTO_UNIQUE_INITIAL:
      true,
    AUTO_LOCATION_SINGLE_TOKEN:
      true,
    AUTO_LOCATION_DISAMBIGUATED:
      true
  };

  let autoLinkedRecords = 0;
  let reviewOrUnmatchedRecords = 0;

  Object.keys(
    counts
  ).forEach(
    function(status){

      if(autoStatuses[status]){
        autoLinkedRecords +=
          counts[status];
      }else{
        reviewOrUnmatchedRecords +=
          counts[status];
      }

    }
  );

  const result = {

    ok:
      true,

    mode:
      "READ_ONLY",

    gatewayRows:
      gatewayRows.length,

    gatewayVariants:
      Object.keys(
        variantMap
      ).length,

    autoLinkedRecords:
      autoLinkedRecords,

    reviewOrUnmatchedRecords:
      reviewOrUnmatchedRecords,

    accountedRecords:
      autoLinkedRecords +
      reviewOrUnmatchedRecords,

    statusByGatewayRecord:
      counts

  };

  Logger.log(
    "========== V2 GATEWAY CANDIDATE INTEGRATION STATS =========="
  );

  Logger.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );

  Logger.log(
    "============================================================"
  );

  return result;

}


/******************************************************
 * SECTION 7: CANDIDATE MATCHER TESTS
 * Former Apps Script file: V2CandidateMatcherServiceTests.gs
 ******************************************************/

/******************************************************
 * V2CANDIDATEMATCHERSERVICETESTS.GS
 *
 * READ-ONLY service + dataset validation.
 ******************************************************/


function V2_testCandidateMatcherServiceReadOnly(){

  const candidates =
    V2Repo_getCandidates();

  const gateway =
    V2Repo_getGateway({});

  const index =
    V2CandidateMatcher_buildIndex(
      candidates
    );

  const variants = {};

  gateway.forEach(
    function(row){

      const raw =
        String(
          row["Candidate Raw"] || ""
        ).trim();

      const normalized =
        V2CandidateMatcher_normalize_(
          raw
        ) || "__BLANK__";

      if(!variants[normalized]){
        variants[normalized] = {
          raw:
            raw,
          count:
            0
        };
      }

      variants[normalized]
        .count++;

    }
  );

  const statusByVariant = {};
  const statusByRecord = {};
  const examples = {};

  Object.keys(
    variants
  ).forEach(
    function(key){

      const variant =
        variants[key];

      const match =
        V2CandidateMatcher_match(
          variant.raw,
          index
        );

      statusByVariant[
        match.status
      ] =
        (
          statusByVariant[
            match.status
          ] || 0
        ) + 1;

      statusByRecord[
        match.status
      ] =
        (
          statusByRecord[
            match.status
          ] || 0
        ) +
        variant.count;

      if(!examples[match.status]){
        examples[match.status] = [];
      }

      if(
        examples[
          match.status
        ].length < 12
      ){

        examples[
          match.status
        ].push({
          raw:
            variant.raw,
          records:
            variant.count,
          candidateId:
            match.candidateId || "",
          suggestedCandidateId:
            match.suggestedCandidateId || "",
          officialName:
            match.officialName || "",
          score:
            match.score,
          reason:
            match.reason,
          conflicts:
            match.conflictingCandidateIds || []
        });

      }

    }
  );

  const knownChecks = {

    tokenReorder:
      V2CandidateMatcher_match(
        "Sai Kumar Battu",
        index
      ),

    strictTypo:
      V2CandidateMatcher_match(
        "Hari Venkata Ravi Teja Anumakonda",
        index
      ),

    compactEquivalent:
      V2CandidateMatcher_match(
        "Vamsikrishna Parvathaneni",
        index
      ),

    structuralPartial:
      V2CandidateMatcher_match(
        "Naga Bhargav Kumar",
        index
      ),

    structuralInitial:
      V2CandidateMatcher_match(
        "Meghana B",
        index
      ),

    locationDisambiguated:
      V2CandidateMatcher_match(
        "Rakesh K",
        index,
        {
          originalRecord:
            "Rakesh K (Ireland) - Interview - Test Client"
        }
      ),

    locationAmbiguousMustBlock:
      V2CandidateMatcher_match(
        "Surya",
        index,
        {
          originalRecord:
            "Surya (Ireland) - Interview - Test Client"
        }
      ),

    duplicateActiveDisambiguated:
      V2CandidateMatcher_match(
        "Keerthi Venkata Prasanna Kotra",
        index
      ),

    singleLetterSubstitutionMustNotAuto:
      V2CandidateMatcher_match(
        "Rakesh K",
        index
      ),

    oneTokenEditNowAuto:
      V2CandidateMatcher_match(
        "Prema Kumar Ravipalli",
        index
      )

  };

  const accounted =
    Object.keys(
      statusByRecord
    ).reduce(
      function(total,status){
        return (
          total +
          statusByRecord[
            status
          ]
        );
      },
      0
    );

  const autoStatuses = {
    AUTO_EXACT_NORMALIZED:
      true,
    AUTO_TOKEN_EQUIVALENT:
      true,
    AUTO_NEAR_TYPO:
      true,
    AUTO_UNIQUE_PARTIAL:
      true,
    AUTO_UNIQUE_INITIAL:
      true,
    AUTO_LOCATION_SINGLE_TOKEN:
      true,
    AUTO_LOCATION_DISAMBIGUATED:
      true,
    AUTO_UNORDERED_PARTIAL:
      true,
    AUTO_ONE_TOKEN_EDIT:
      true,
    AUTO_MASTER_SUBSET_RAW:
      true,
    AUTO_ANCHORED_NEAR_COMBINATION:
      true,
    AUTO_MERGED_COMBINATION:
      true,
    AUTO_REVERSE_MERGED_COMBINATION:
      true,
    AUTO_INITIAL_COMBINATION:
      true,
    AUTO_ACTIVE_DISAMBIGUATED:
      true,
    AUTO_REVERSE_INITIAL:
      true,
    AUTO_MULTI_TOKEN_EDIT:
      true,
    AUTO_ANCHORED_NEAR_TOKEN:
      true
  };

  let unsafeAutoWithoutId = 0;

  Object.keys(
    variants
  ).forEach(
    function(key){

      const match =
        V2CandidateMatcher_match(
          variants[key].raw,
          index
        );

      if(
        autoStatuses[
          match.status
        ] &&
        !match.candidateId
      ){
        unsafeAutoWithoutId++;
      }

      if(
        !autoStatuses[
          match.status
        ] &&
        match.status !==
          "AMBIGUOUS_MASTER_NAME" &&
        match.candidateId
      ){
        unsafeAutoWithoutId++;
      }

    }
  );

  const ok =
    (
      candidates.length === 1074 &&
      gateway.length === 3321 &&
      index
        .duplicateNormalizedGroups
        .length === 12 &&
      accounted ===
        gateway.length &&
      unsafeAutoWithoutId === 0 &&

      knownChecks
        .tokenReorder
        .status ===
        "AUTO_TOKEN_EQUIVALENT" &&

      knownChecks
        .strictTypo
        .status ===
        "AUTO_NEAR_TYPO" &&

      (
        knownChecks
          .compactEquivalent
          .status ===
          "AUTO_TOKEN_EQUIVALENT" ||
        knownChecks
          .compactEquivalent
          .status ===
          "AUTO_EXACT_NORMALIZED"
      ) &&

      knownChecks
        .structuralPartial
        .status ===
        "AUTO_UNIQUE_PARTIAL" &&

      !!knownChecks
        .structuralPartial
        .candidateId &&

      knownChecks
        .structuralInitial
        .status ===
        "AUTO_UNIQUE_INITIAL" &&

      !!knownChecks
        .structuralInitial
        .candidateId &&

      knownChecks
        .locationDisambiguated
        .status ===
        "AUTO_LOCATION_DISAMBIGUATED" &&

      !!knownChecks
        .locationDisambiguated
        .candidateId &&

      String(
        knownChecks
          .locationAmbiguousMustBlock
          .status
      ).indexOf(
        "AUTO_"
      ) !== 0 &&

      !knownChecks
        .locationAmbiguousMustBlock
        .candidateId &&

      knownChecks
        .duplicateActiveDisambiguated
        .status ===
        "AUTO_ACTIVE_DISAMBIGUATED" &&

      knownChecks
        .duplicateActiveDisambiguated
        .candidateId ===
        "CAN-000353" &&

      String(
        knownChecks
          .singleLetterSubstitutionMustNotAuto
          .status
      ).indexOf(
        "AUTO_"
      ) !== 0 &&

      !knownChecks
        .singleLetterSubstitutionMustNotAuto
        .candidateId &&

      knownChecks
        .oneTokenEditNowAuto
        .status ===
        "AUTO_ONE_TOKEN_EDIT" &&

      knownChecks
        .oneTokenEditNowAuto
        .candidateId ===
        "CAN-000270"
    );

  const result = {

    ok:
      ok,

    mode:
      "READ_ONLY",

    matcherVersion:
      V2_CANDIDATE_MATCHER
        .VERSION,

    counts: {
      candidateMasterRows:
        candidates.length,
      normalizedMasterNames:
        index
          .normalizedNameCount,
      duplicateNormalizedMasterGroups:
        index
          .duplicateNormalizedGroups
          .length,
      gatewayRows:
        gateway.length,
      gatewayVariants:
        Object.keys(
          variants
        ).length,
      accountedGatewayRows:
        accounted,
      unsafeAutoWithoutId:
        unsafeAutoWithoutId
    },

    statusByVariant:
      statusByVariant,

    statusByGatewayRecord:
      statusByRecord,

    knownChecks:
      knownChecks,

    examples:
      examples

  };

  Logger.log(
    "========== V2 CANDIDATE MATCHER SERVICE TEST =========="
  );

  Logger.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );

  Logger.log(
    "======================================================="
  );

  return result;

}


/******************************************************
 * READ-ONLY: COMPACT AUTO-MATCH AUDIT
 *
 * Logs ONLY the non-exact auto-match variants:
 * - AUTO_NEAR_TYPO
 * - AUTO_TOKEN_EQUIVALENT
 *
 * AUTO_NEAR_TYPO is sorted LOWEST score first so the
 * riskiest proposed auto matches are easiest to inspect.
 ******************************************************/
function V2_logCandidateMatcherAutoAudit(){

  const candidates =
    V2Repo_getCandidates();

  const gateway =
    V2Repo_getGateway({});

  const index =
    V2CandidateMatcher_buildIndex(
      candidates
    );

  const variants = {};

  gateway.forEach(
    function(row){

      const raw =
        String(
          row["Candidate Raw"] || ""
        ).trim();

      const normalized =
        V2CandidateMatcher_normalize_(
          raw
        ) || "__BLANK__";

      if(!variants[normalized]){
        variants[normalized] = {
          raw:
            raw,
          records:
            0
        };
      }

      variants[normalized]
        .records++;

    }
  );

  const matched =
    Object.keys(
      variants
    )
      .map(
        function(key){

          const variant =
            variants[key];

          const match =
            V2CandidateMatcher_match(
              variant.raw,
              index
            );

          return {
            raw:
              variant.raw,
            records:
              variant.records,
            status:
              match.status,
            candidateId:
              match.candidateId || "",
            officialName:
              match.officialName || "",
            score:
              Number(
                match.score || 0
              ),
            reason:
              match.reason || ""
          };

        }
      );

  const near =
    matched
      .filter(
        function(item){
          return (
            item.status ===
            "AUTO_NEAR_TYPO"
          );
        }
      )
      .sort(
        function(a,b){

          if(a.score !== b.score){
            return a.score - b.score;
          }

          return (
            b.records -
            a.records
          );

        }
      );

  const tokenEquivalent =
    matched
      .filter(
        function(item){
          return (
            item.status ===
            "AUTO_TOKEN_EQUIVALENT"
          );
        }
      )
      .sort(
        function(a,b){

          if(
            b.records !==
            a.records
          ){
            return (
              b.records -
              a.records
            );
          }

          return String(
            a.raw || ""
          ).localeCompare(
            String(
              b.raw || ""
            )
          );

        }
      );

  const nearGatewayRecords =
    near.reduce(
      function(total,item){
        return total + item.records;
      },
      0
    );

  const tokenGatewayRecords =
    tokenEquivalent.reduce(
      function(total,item){
        return total + item.records;
      },
      0
    );

  Logger.log(
    "========== V2 CANDIDATE AUTO-MATCH AUDIT =========="
  );

  Logger.log(
    JSON.stringify({
      ok:
        true,
      mode:
        "READ_ONLY",
      matcherVersion:
        V2_CANDIDATE_MATCHER.VERSION,
      autoNearVariants:
        near.length,
      autoNearGatewayRecords:
        nearGatewayRecords,
      tokenEquivalentVariants:
        tokenEquivalent.length,
      tokenEquivalentGatewayRecords:
        tokenGatewayRecords
    })
  );

  Logger.log(
    "---- AUTO_NEAR_TYPO | LOWEST SCORE FIRST ----"
  );

  near.forEach(
    function(item,index){

      Logger.log(
        [
          index + 1,
          "Raw=" +
            item.raw,
          "Records=" +
            item.records,
          "CandidateID=" +
            item.candidateId,
          "Official=" +
            item.officialName,
          "Score=" +
            item.score,
          "Reason=" +
            item.reason
        ].join(
          " | "
        )
      );

    }
  );

  Logger.log(
    "---- AUTO_TOKEN_EQUIVALENT ----"
  );

  tokenEquivalent.forEach(
    function(item,index){

      Logger.log(
        [
          index + 1,
          "Raw=" +
            item.raw,
          "Records=" +
            item.records,
          "CandidateID=" +
            item.candidateId,
          "Official=" +
            item.officialName,
          "Score=" +
            item.score,
          "Reason=" +
            item.reason
        ].join(
          " | "
        )
      );

    }
  );

  Logger.log(
    "==================================================="
  );

  return {
    ok:
      true,
    mode:
      "READ_ONLY",
    autoNearVariants:
      near.length,
    autoNearGatewayRecords:
      nearGatewayRecords,
    tokenEquivalentVariants:
      tokenEquivalent.length,
    tokenEquivalentGatewayRecords:
      tokenGatewayRecords
  };

}



/******************************************************
 * READ-ONLY: MATCHER v1.2 SYNTHETIC SAFETY TEST
 *
 * Independent of current Gateway row counts.
 ******************************************************/
function V2_testCandidateMatcherV120SyntheticReadOnly(){

  const rows = [
    {
      "Candidate ID":
        "CAN-T001",
      "Official Candidate Name":
        "Thrayamba Keswar Bettala",
      "Location":
        "United Kingdom"
    },
    {
      "Candidate ID":
        "CAN-T002",
      "Official Candidate Name":
        "Meghana Botta",
      "Location":
        "Ireland"
    },
    {
      "Candidate ID":
        "CAN-T003",
      "Official Candidate Name":
        "Meghana Reddy",
      "Location":
        "Canada"
    },
    {
      "Candidate ID":
        "CAN-T004",
      "Official Candidate Name":
        "Maneesha Gayathri Sunkara",
      "Location":
        "United States"
    },
    {
      "Candidate ID":
        "CAN-T005",
      "Official Candidate Name":
        "Sai Shwetha Kancharlapalli",
      "Location":
        "Ireland"
    },
    {
      "Candidate ID":
        "CAN-T006",
      "Official Candidate Name":
        "Surya Teja Gowd Ayinavilli",
      "Location":
        "Ireland"
    },
    {
      "Candidate ID":
        "CAN-T007",
      "Official Candidate Name":
        "Venkata Surya Yakkala",
      "Location":
        "Ireland"
    },
    {
      "Candidate ID":
        "CAN-T008",
      "Official Candidate Name":
        "Rakesh Komakula",
      "Location":
        "Ireland"
    },
    {
      "Candidate ID":
        "CAN-T009",
      "Official Candidate Name":
        "Rakesh Kumar",
      "Location":
        "Canada"
    },
    {
      "Candidate ID":
        "CAN-T010",
      "Official Candidate Name":
        "Reshma Shaik",
      "Location":
        "United Kingdom"
    },
    {
      "Candidate ID":
        "CAN-T011",
      "Official Candidate Name":
        "Reshma Reddy",
      "Location":
        "India"
    }
  ];

  const index =
    V2CandidateMatcher_buildIndex(
      rows
    );

  const checks = [

    {
      name:
        "unique partial",
      expected:
        "AUTO_UNIQUE_PARTIAL",
      match:
        V2CandidateMatcher_match(
          "Thrayamba Keswar",
          index
        )
    },

    {
      name:
        "unique initial",
      expected:
        "AUTO_UNIQUE_INITIAL",
      match:
        V2CandidateMatcher_match(
          "Maneesha Gayathri S",
          index
        )
    },

    {
      name:
        "unique initial 2",
      expected:
        "AUTO_UNIQUE_INITIAL",
      match:
        V2CandidateMatcher_match(
          "Sai Shwetha K",
          index
        )
    },

    {
      name:
        "initial chooses only compatible B",
      expected:
        "AUTO_UNIQUE_INITIAL",
      match:
        V2CandidateMatcher_match(
          "Meghana B",
          index
        )
    },

    {
      name:
        "ambiguous initial no country",
      expectedAuto:
        false,
      match:
        V2CandidateMatcher_match(
          "Rakesh K",
          index
        )
    },

    {
      name:
        "ambiguous initial resolved by Ireland",
      expected:
        "AUTO_LOCATION_DISAMBIGUATED",
      match:
        V2CandidateMatcher_match(
          "Rakesh K",
          index,
          {
            originalRecord:
              "Rakesh K (Ireland) - Interview - Client"
          }
        )
    },

    {
      name:
        "single token unique by UK",
      expected:
        "AUTO_LOCATION_SINGLE_TOKEN",
      match:
        V2CandidateMatcher_match(
          "Reshma",
          index,
          {
            originalRecord:
              "Reshma (UK) - Interview - Client"
          }
        )
    },

    {
      name:
        "single token ambiguous in Ireland blocks",
      expectedAuto:
        false,
      match:
        V2CandidateMatcher_match(
          "Surya",
          index,
          {
            originalRecord:
              "Surya (Ireland) - Interview - Client"
          }
        )
    },

    {
      name:
        "country cannot override unrelated name",
      expectedAuto:
        false,
      match:
        V2CandidateMatcher_match(
          "Completely Different",
          index,
          {
            originalRecord:
              "Completely Different (Ireland) - Interview - Client"
          }
        )
    }

  ];

  let passed = 0;

  checks.forEach(
    function(check){

      const isAuto =
        String(
          check.match.status || ""
        ).indexOf(
          "AUTO_"
        ) === 0;

      let ok = false;

      if(check.expected){

        ok =
          (
            check.match.status ===
              check.expected &&
            !!check.match.candidateId
          );

      }else{

        ok =
          (
            isAuto ===
              Boolean(
                check.expectedAuto
              )
          );

      }

      if(ok)
        passed++;

      check.ok = ok;

    }
  );

  const result = {
    ok:
      passed ===
        checks.length,
    mode:
      "READ_ONLY",
    matcherVersion:
      V2_CANDIDATE_MATCHER.VERSION,
    passed:
      passed,
    total:
      checks.length,
    checks:
      checks
  };

  Logger.log(
    "========== V2 MATCHER v1.2 SYNTHETIC TEST =========="
  );

  Logger.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );

  Logger.log(
    "===================================================="
  );

  return result;

}


/******************************************************
 * READ-ONLY: PRE-REBUILD INTEGRATION PREVIEW
 *
 * Uses the currently stored Gateway rows as evidence,
 * but computes identity using Matcher v1.2 + Original
 * Record location context.
 *
 * Expected on the verified 3,321-row baseline:
 * new combined-evidence auto records = 216
 * total auto-linked records = 3,118
 * remaining unresolved records = 203
 ******************************************************/
function V2_previewCandidateMatcherV130BeforeRebuild(){

  const candidates =
    V2Repo_getCandidates();

  const gateway =
    V2Repo_getGateway({});

  const index =
    V2CandidateMatcher_buildIndex(
      candidates
    );

  const autoStatuses = {};

  let autoLinked = 0;
  let unresolved = 0;

  const statusByGatewayRecord = {};

  gateway.forEach(
    function(row){

      const match =
        V2CandidateMatcher_match(
          row["Candidate Raw"],
          index,
          {
            originalRecord:
              row["Original Record"]
          }
        );

      const status =
        String(
          match.status || ""
        );

      statusByGatewayRecord[
        status
      ] =
        (
          statusByGatewayRecord[
            status
          ] || 0
        ) + 1;

      if(
        status.indexOf(
          "AUTO_"
        ) === 0 &&
        match.candidateId
      ){
        autoLinked++;
      }else{
        unresolved++;
      }

    }
  );

  const result = {
    ok:
      (
        gateway.length ===
          autoLinked +
          unresolved &&
        (
          gateway.length !== 3321 ||
          (
            autoLinked === 3178 &&
            unresolved === 143
          )
        )
      ),
    mode:
      "READ_ONLY",
    matcherVersion:
      V2_CANDIDATE_MATCHER.VERSION,
    gatewayRows:
      gateway.length,
    autoLinkedRecords:
      autoLinked,
    remainingUnresolvedRecords:
      unresolved,
    statusByGatewayRecord:
      statusByGatewayRecord,
    baselineExpectationApplied:
      gateway.length === 3321
  };

  Logger.log(
    "========== V2 MATCHER v1.3 PRE-REBUILD PREVIEW =========="
  );

  Logger.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );

  Logger.log(
    "========================================================="
  );

  return result;

}


/******************************************************
 * READ-ONLY: POST-REBUILD STORED GATEWAY VERIFICATION
 ******************************************************/
function V2_verifyCandidateMatcherV130StoredGatewayReadOnly(){

  const candidates =
    V2Repo_getCandidates();

  const gateway =
    V2Repo_getGateway({});

  const index =
    V2CandidateMatcher_buildIndex(
      candidates
    );

  let mismatchCount = 0;
  let autoLinked = 0;
  let unresolved = 0;
  const mismatchExamples = [];

  gateway.forEach(
    function(row){

      const expected =
        V2CandidateMatcher_match(
          row["Candidate Raw"],
          index,
          {
            originalRecord:
              row["Original Record"]
          }
        );

      const storedStatus =
        String(
          row["Candidate Match Status"] || ""
        ).trim();

      const storedId =
        String(
          row["Candidate ID"] || ""
        ).trim();

      const storedOfficial =
        String(
          row["Official Candidate Name"] || ""
        ).trim();

      const expectedStatus =
        String(
          expected.status || ""
        ).trim();

      const expectedId =
        String(
          expected.candidateId || ""
        ).trim();

      const expectedOfficial =
        expectedId
          ? String(
              expected.officialName || ""
            ).trim()
          : "";

      const mismatch =
        (
          storedStatus !==
            expectedStatus ||
          storedId !==
            expectedId ||
          storedOfficial !==
            expectedOfficial
        );

      if(mismatch){

        mismatchCount++;

        if(
          mismatchExamples.length < 20
        ){

          mismatchExamples.push({
            gatewayId:
              row["Gateway ID"],
            candidateRaw:
              row["Candidate Raw"],
            storedStatus:
              storedStatus,
            expectedStatus:
              expectedStatus,
            storedId:
              storedId,
            expectedId:
              expectedId
          });

        }

      }

      if(
        expectedStatus.indexOf(
          "AUTO_"
        ) === 0 &&
        expectedId
      ){
        autoLinked++;
      }else{
        unresolved++;
      }

    }
  );

  const result = {
    ok:
      (
        mismatchCount === 0 &&
        gateway.length ===
          autoLinked +
          unresolved &&
        (
          gateway.length !== 3321 ||
          (
            autoLinked === 3178 &&
            unresolved === 143
          )
        )
      ),
    mode:
      "READ_ONLY",
    matcherVersion:
      V2_CANDIDATE_MATCHER.VERSION,
    gatewayRows:
      gateway.length,
    storedMismatchCount:
      mismatchCount,
    autoLinkedRecords:
      autoLinked,
    remainingUnresolvedRecords:
      unresolved,
    baselineExpectationApplied:
      gateway.length === 3321,
    mismatchExamples:
      mismatchExamples
  };

  Logger.log(
    "========== V2 MATCHER v1.3 POST-REBUILD VERIFY =========="
  );

  Logger.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );

  Logger.log(
    "========================================================="
  );

  return result;

}


/******************************************************
 * READ-ONLY: MATCHER v1.2 COMBINED-EVIDENCE TEST
 ******************************************************/
function V2_testCandidateMatcherV120CombinedSyntheticReadOnly(){

  const rows = [
    {"Candidate ID":"CAN-T001","Official Candidate Name":"Lakshmi Sai Anusha Adiraju"},
    {"Candidate ID":"CAN-T002","Official Candidate Name":"Vamshi Arutla"},
    {"Candidate ID":"CAN-T003","Official Candidate Name":"Ajay Kumar Polam"},
    {"Candidate ID":"CAN-T004","Official Candidate Name":"Rani Kumari"},
    {"Candidate ID":"CAN-T005","Official Candidate Name":"Rami Kumari"},
    {"Candidate ID":"CAN-T006","Official Candidate Name":"Raghu Vamshi Goud"},
    {"Candidate ID":"CAN-T007","Official Candidate Name":"Saiteja Deep Chowdary"},
    {"Candidate ID":"CAN-T008","Official Candidate Name":"Abusufiyan"},
    {"Candidate ID":"CAN-T009","Official Candidate Name":"VARAHALA BHARATH"},
    {"Candidate ID":"CAN-T010","Official Candidate Name":"Nalabolu Prasanna Kumar"},
    {"Candidate ID":"CAN-T011","Official Candidate Name":"Sadhu Sri Charan"},
    {"Candidate ID":"CAN-T012","Official Candidate Name":"Shaik Mohammad Sartaj Ali"},
    {"Candidate ID":"CAN-T013","Official Candidate Name":"Jagadeesh Naidu Mamidibathula"},
    {"Candidate ID":"CAN-T014","Official Candidate Name":"Bala Seeta Rami Reddy Avuluri"},
    {"Candidate ID":"CAN-T015","Official Candidate Name":"Naga Sai Kumar Potti"},
    {"Candidate ID":"CAN-T016","Official Candidate Name":"RAMYA SRI MAKKAPATI"},
    {"Candidate ID":"CAN-T017","Official Candidate Name":"Venkata Sai Swetha Gatamaneni"},
    {"Candidate ID":"CAN-T018","Official Candidate Name":"SRI TEJA REDDY VELDURTHI"},
    {"Candidate ID":"CAN-T019","Official Candidate Name":"Venkata Naga Surya Lalitamanogjna Parsa"}
  ];

  const index =
    V2CandidateMatcher_buildIndex(
      rows
    );

  const cases = [
    {raw:"Adiraju Anusha",candidateId:"CAN-T001",status:"AUTO_UNORDERED_PARTIAL"},
    {raw:"Vamshi Arutala",candidateId:"CAN-T002",status:"AUTO_ONE_TOKEN_EDIT"},
    {raw:"Ajay Kumar Pollam",candidateId:"CAN-T003",status:"AUTO_ONE_TOKEN_EDIT"},
    {raw:"Ravi Kumari",auto:false},
    {raw:"Raghuvamshi Goud Karnati",candidateId:"CAN-T006",status:"AUTO_MERGED_COMBINATION"},
    {raw:"Saitejdeepkumar Chowdary Bodapati",candidateId:"CAN-T007",status:"AUTO_MERGED_COMBINATION"},
    {raw:"Abusufiyan Dudekula",candidateId:"CAN-T008",status:"AUTO_MASTER_SUBSET_RAW"},
    {raw:"Varahala Bharath Rajana",candidateId:"CAN-T009",status:"AUTO_MASTER_SUBSET_RAW"},
    {raw:"Prasanna Kumar N",candidateId:"CAN-T010",status:"AUTO_INITIAL_COMBINATION"},
    {raw:"Sri Charan S",candidateId:"CAN-T011",status:"AUTO_INITIAL_COMBINATION"},
    {raw:"Shaik Mohmad Sartaj Ali",candidateId:"CAN-T012",status:"AUTO_ANCHORED_NEAR_COMBINATION"},
    {raw:"Jagadeesh Naidu Mamidi Bathulu",candidateId:"CAN-T013",status:"AUTO_REVERSE_MERGED_COMBINATION"},
    {raw:"Bala Seetha Rami Reddy",candidateId:"CAN-T014",status:"AUTO_ANCHORED_NEAR_COMBINATION"},
    {raw:"Nag Sai Kumar Potti",candidateId:"CAN-T015",status:"AUTO_ANCHORED_NEAR_COMBINATION"},
    {raw:"Sri Ramya Kurlla",auto:false},
    {raw:"Sai Swetha K",auto:false},
    {raw:"Sri Lekha Reddy",auto:false},
    {raw:"Venkata Naga Surya Lalitha Managona",auto:false}
  ];

  let passed = 0;

  const checks =
    cases.map(
      function(test){

        const match =
          V2CandidateMatcher_match(
            test.raw,
            index
          );

        const isAuto =
          String(
            match.status || ""
          ).indexOf(
            "AUTO_"
          ) === 0;

        const ok =
          test.auto === false
            ? !isAuto
            : (
                match.status ===
                  test.status &&
                match.candidateId ===
                  test.candidateId
              );

        if(ok)
          passed++;

        return {
          raw:
            test.raw,
          expectedStatus:
            test.status ||
            "NOT_AUTO",
          match:
            match,
          ok:
            ok
        };

      }
    );

  const result = {
    ok:
      passed ===
        checks.length,
    mode:
      "READ_ONLY",
    matcherVersion:
      V2_CANDIDATE_MATCHER.VERSION,
    passed:
      passed,
    total:
      checks.length,
    checks:
      checks
  };

  Logger.log(
    "========== V2 MATCHER v1.2 COMBINED TEST =========="
  );

  Logger.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );

  Logger.log(
    "===================================================="
  );

  return result;

}


/******************************************************
 * READ-ONLY: MATCHER v1.3 NEXT-RULE SAFETY TEST
 ******************************************************/
function V2_testCandidateMatcherV130NextRulesSyntheticReadOnly(){

  const rows = [
    {"Candidate ID":"CAN-T001","Official Candidate Name":"Keerthi venkata Prasanna Kotra","Email":"kkeerthy069@gmail.com","Active Status":"Active"},
    {"Candidate ID":"CAN-T002","Official Candidate Name":"Keerthi venkata Prasanna Kotra","Email":"kkeerthy@gmail.com","Active Status":"Inactive"},
    {"Candidate ID":"CAN-T003","Official Candidate Name":"Sailaja Meenigala","Active Status":"Active"},
    {"Candidate ID":"CAN-T004","Official Candidate Name":"Reddy Sailaja Marpuri","Active Status":"Inactive"},
    {"Candidate ID":"CAN-T005","Official Candidate Name":"VAMSHI ALAGANDULA","Active Status":"Inactive"},
    {"Candidate ID":"CAN-T006","Official Candidate Name":"Vamshi Arutla","Active Status":"Active"},
    {"Candidate ID":"CAN-T007","Official Candidate Name":"Abhishek Mogili","Active Status":"Inactive"},
    {"Candidate ID":"CAN-T008","Official Candidate Name":"Abhishek Muralidharan","Active Status":"Active"},
    {"Candidate ID":"CAN-T009","Official Candidate Name":"Ramakrishna Y","Active Status":"Active"},
    {"Candidate ID":"CAN-T010","Official Candidate Name":"Sairamakrishna Yaswanth Komaravolu","Active Status":"Active"},
    {"Candidate ID":"CAN-T011","Official Candidate Name":"Reshma Chowdhary Potluri","Active Status":"Inactive"},
    {"Candidate ID":"CAN-T012","Official Candidate Name":"Yedulla Sandeep","Active Status":"Active"},
    {"Candidate ID":"CAN-T013","Official Candidate Name":"Khurshid Shaik","Active Status":"Active"},
    {"Candidate ID":"CAN-T014","Official Candidate Name":"Roopal Mishra","Active Status":"Active"},
    {"Candidate ID":"CAN-T020","Official Candidate Name":"Rahul Mithinti","Active Status":"Active"},
    {"Candidate ID":"CAN-T015","Official Candidate Name":"Hima Bindu Reddy","Active Status":"Active"},
    {"Candidate ID":"CAN-T016","Official Candidate Name":"Hima Bindu Rao","Active Status":"Active"},
    {"Candidate ID":"CAN-T017","Official Candidate Name":"Sandeep Kiran Reddy","Active Status":"Active"}
  ];

  const index =
    V2CandidateMatcher_buildIndex(
      rows
    );

  const cases = [
    {raw:"Keerthi Venkata Prasanna Kotra",candidateId:"CAN-T001",status:"AUTO_ACTIVE_DISAMBIGUATED"},
    {raw:"Sailaja M",candidateId:"CAN-T003",status:"AUTO_ACTIVE_DISAMBIGUATED"},
    {raw:"Vamshi A",candidateId:"CAN-T006",status:"AUTO_ACTIVE_DISAMBIGUATED"},
    {raw:"Abhishek M",candidateId:"CAN-T008",status:"AUTO_ACTIVE_DISAMBIGUATED"},
    {raw:"Ramakrishna Yarajarlai",candidateId:"CAN-T009",status:"AUTO_REVERSE_INITIAL"},
    {raw:"Reshma Chowdary Potluru",candidateId:"CAN-T011",status:"AUTO_MULTI_TOKEN_EDIT"},
    {raw:"Yeddula Sandeep",candidateId:"CAN-T012",status:"AUTO_ANCHORED_NEAR_TOKEN"},
    {raw:"Khrushid Shaik",candidateId:"CAN-T013",status:"AUTO_ANCHORED_NEAR_TOKEN"},
    {raw:"Roopla Mishra",candidateId:"CAN-T014",status:"AUTO_ANCHORED_NEAR_TOKEN"},
    {raw:"Rahul Minthint",candidateId:"CAN-T020",status:"AUTO_ANCHORED_NEAR_TOKEN"},
    {raw:"Hima Bindu",auto:false},
    {raw:"Sandeep Kumar Reddy",auto:false}
  ];

  let passed = 0;

  const checks =
    cases.map(
      function(test){

        const match =
          V2CandidateMatcher_match(
            test.raw,
            index
          );

        const isAuto =
          String(
            match.status || ""
          ).indexOf(
            "AUTO_"
          ) === 0;

        const ok =
          test.auto === false
            ? !isAuto
            : (
                match.status ===
                  test.status &&
                match.candidateId ===
                  test.candidateId
              );

        if(ok){
          passed++;
        }

        return {
          raw:
            test.raw,
          expectedStatus:
            test.status ||
            "NOT_AUTO",
          match:
            match,
          ok:
            ok
        };

      }
    );

  const result = {
    ok:
      passed ===
      checks.length,
    mode:
      "READ_ONLY",
    matcherVersion:
      V2_CANDIDATE_MATCHER.VERSION,
    passed:
      passed,
    total:
      checks.length,
    checks:
      checks
  };

  Logger.log(
    "========== V2 MATCHER v1.3 NEXT-RULE TEST v1.3.1 =========="
  );

  Logger.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );

  Logger.log(
    "===================================================="
  );

  return result;

}
