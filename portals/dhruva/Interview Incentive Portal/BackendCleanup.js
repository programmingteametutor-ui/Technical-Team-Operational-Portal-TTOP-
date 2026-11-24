/******************************************************
 * FINAL BACKEND PRIVATE SHEET CLEANUP
 *
 * Purpose:
 * - Keep the working Version-1 portal + Administration.
 * - Delete only the abandoned V2 Candidate/Gateway/
 *   Phase2/Phase3/Candidate360/performance sheets.
 *
 * SAFE RUN ORDER:
 *   1) BACKEND_CLEANUP_preview()
 *   2) BACKEND_CLEANUP_deleteKnownIrrelevantSheets()
 *   3) BACKEND_CLEANUP_verify()
 *   4) Delete this temporary Apps Script file.
 ******************************************************/

const BACKEND_CLEANUP_DELETE = Object.freeze([
  "V2 Candidate Master",
  "V2 Client Registry",
  "V2 Interview Gateway",
  "V2 Candidate Events",
  "V2 Portal Jobs",
  "V2 Portal Notifications",

  "V2 Operational Calls",
  "V2 Interview Occurrences",
  "V2 Occurrence Reconciliation",

  "V2 Candidate 360",
  "V2 Logical Interviews",

  "V2 Candidate Portal Read Model",
  "V2 Candidate Portal Read Model Shadow"
]);


const BACKEND_CLEANUP_KEEP = Object.freeze([
  "V2 User Access",
  "V2 User Roles",
  "V2 Team Master",
  "V2 Handler Master",
  "V2 Setup Support Master",
  "V2 Developer Master",
  "V2 Screen Operator Master",
  "V2 Technical Support Master"
]);


function BACKEND_CLEANUP_preview(){

  const ss =
    BACKEND_CLEANUP_backend_();

  BACKEND_CLEANUP_assertAdminFoundation_(ss);

  const allNames =
    ss.getSheets()
      .map(function(sheet){
        return sheet.getName();
      });

  const deleteFound =
    BACKEND_CLEANUP_DELETE
      .filter(function(name){
        return allNames.indexOf(name) !== -1;
      })
      .map(function(name){

        const sheet =
          ss.getSheetByName(name);

        return {
          sheet:name,
          rows:
            Math.max(
              0,
              sheet.getLastRow() - 1
            ),
          columns:
            sheet.getLastColumn()
        };

      });

  const preserved =
    BACKEND_CLEANUP_KEEP
      .map(function(name){

        const sheet =
          ss.getSheetByName(name);

        return {
          sheet:name,
          found:Boolean(sheet),
          rows:
            sheet
              ? Math.max(
                  0,
                  sheet.getLastRow() - 1
                )
              : 0
        };

      });

  const unknownV2 =
    allNames
      .filter(function(name){

        return (
          /^V2\b/i.test(name) &&
          BACKEND_CLEANUP_DELETE.indexOf(name) === -1 &&
          BACKEND_CLEANUP_KEEP.indexOf(name) === -1
        );

      })
      .sort();

  const result = {
    ok:true,
    mode:"READ_ONLY_FINAL_BACKEND_CLEANUP_PREVIEW",
    backend:ss.getName(),
    deleteCount:deleteFound.length,
    deleteSheets:deleteFound,
    preservedAdministration:preserved,
    unknownV2SheetsNotTouched:unknownV2
  };

  Logger.log(
    "========== FINAL BACKEND CLEANUP PREVIEW =========="
  );
  Logger.log(
    JSON.stringify(result,null,2)
  );
  Logger.log(
    "==================================================="
  );

  return result;
}


function BACKEND_CLEANUP_deleteKnownIrrelevantSheets(){

  const ss =
    BACKEND_CLEANUP_backend_();

  BACKEND_CLEANUP_assertAdminFoundation_(ss);

  const deleted = [];
  const missing = [];

  BACKEND_CLEANUP_DELETE
    .forEach(function(name){

      const sheet =
        ss.getSheetByName(name);

      if(!sheet){
        missing.push(name);
        return;
      }

      ss.deleteSheet(sheet);

      deleted.push(name);

    });

  SpreadsheetApp.flush();

  const result = {
    ok:true,
    mode:"DESTRUCTIVE_KNOWN_V2_CLEANUP",
    backend:ss.getName(),
    deleted:deleted,
    alreadyMissing:missing,
    preservedAdministration:
      BACKEND_CLEANUP_KEEP.slice()
  };

  Logger.log(
    "========== FINAL BACKEND CLEANUP DELETE =========="
  );
  Logger.log(
    JSON.stringify(result,null,2)
  );
  Logger.log(
    "=================================================="
  );

  return result;
}


function BACKEND_CLEANUP_verify(){

  const ss =
    BACKEND_CLEANUP_backend_();

  BACKEND_CLEANUP_assertAdminFoundation_(ss);

  const remainingDeleteSheets =
    BACKEND_CLEANUP_DELETE
      .filter(function(name){
        return Boolean(
          ss.getSheetByName(name)
        );
      });

  const preserved =
    BACKEND_CLEANUP_KEEP
      .map(function(name){

        const sheet =
          ss.getSheetByName(name);

        return {
          sheet:name,
          found:Boolean(sheet),
          rows:
            sheet
              ? Math.max(
                  0,
                  sheet.getLastRow() - 1
                )
              : 0
        };

      });

  const allNames =
    ss.getSheets()
      .map(function(sheet){
        return sheet.getName();
      });

  const unknownV2 =
    allNames
      .filter(function(name){

        return (
          /^V2\b/i.test(name) &&
          BACKEND_CLEANUP_DELETE.indexOf(name) === -1 &&
          BACKEND_CLEANUP_KEEP.indexOf(name) === -1
        );

      })
      .sort();

  const result = {
    ok:
      remainingDeleteSheets.length === 0,
    mode:"READ_ONLY_FINAL_BACKEND_CLEANUP_VERIFY",
    backend:ss.getName(),
    remainingKnownIrrelevantSheets:
      remainingDeleteSheets,
    preservedAdministration:
      preserved,
    unknownV2SheetsNotTouched:
      unknownV2
  };

  Logger.log(
    "========== FINAL BACKEND CLEANUP VERIFY =========="
  );
  Logger.log(
    JSON.stringify(result,null,2)
  );
  Logger.log(
    "=================================================="
  );

  return result;
}


function BACKEND_CLEANUP_assertAdminFoundation_(ss){

  const missing =
    BACKEND_CLEANUP_KEEP
      .filter(function(name){
        return !ss.getSheetByName(name);
      });

  if(missing.length){

    throw new Error(
      "CLEANUP_REFUSED_ADMIN_FOUNDATION_MISSING|" +
      missing.join(",")
    );

  }
}


function BACKEND_CLEANUP_backend_(){

  let ss = null;

  if(
    typeof portalBackend_ ===
      "function"
  ){

    ss =
      portalBackend_();

  }else if(
    typeof IR_backend_ ===
      "function"
  ){

    ss =
      IR_backend_();

  }else{

    ss =
      SpreadsheetApp
        .getActiveSpreadsheet();

  }

  if(
    !ss ||
    ss.getName() !==
      "Incentive Backend - Private"
  ){

    throw new Error(
      "CLEANUP_REFUSED_WRONG_BACKEND|" +
      (
        ss
          ? ss.getName()
          : "NO_SPREADSHEET"
      )
    );

  }

  return ss;
}

