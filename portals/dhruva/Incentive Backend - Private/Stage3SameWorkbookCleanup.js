/******************************************************
 * STAGE 3 - SAME WORKBOOK CLEANUP
 *
 * FINAL SHARED WORKBOOK:
 *   Raw Data
 *   Team Data
 *
 * NO NEW GOOGLE SHEET IS CREATED.
 *
 * Run this file from:
 *   Incentive Backend - Private Apps Script project
 *
 * This script:
 * - verifies private critical sheets exist
 * - deletes every shared tab except Raw Data / Team Data
 * - never changes Raw Data or Team Data
 ******************************************************/

const STAGE3_SHARED_CLEANUP = {

  SHARED_OPERATIONS_ID:
    "1UudfZfeBBkEwBQeWUwx77R4gl26wYZ1rKKZWCM_SHq4",

  PRIVATE_BACKEND_ID:
    "1Q5pRPoLsSjfxuRfEUZW2zZqrURYPzzbbPO6_8r9CLCk",

  KEEP_SHARED: [
    "Raw Data",
    "Team Data"
  ],

  REQUIRED_PRIVATE: [
    "Incentive Tracker",
    "Promotion History",
    "Promotion Recovery",
    "Recovery Exceptions",
    "Recovery Evidence",
    "Recovery Applied Log",
    "Possible Matches",
    "Incentive Summary",
    "Monthly Incentive Summary"
  ]
};


/******************************************************
 * STEP 1 - READ-ONLY FINAL SAFETY CHECK
 ******************************************************/
function stage3VerifyReadyToClearShared(){

  const shared =
    SpreadsheetApp.openById(
      STAGE3_SHARED_CLEANUP
        .SHARED_OPERATIONS_ID
    );

  const backend =
    SpreadsheetApp.openById(
      STAGE3_SHARED_CLEANUP
        .PRIVATE_BACKEND_ID
    );

  const sharedNames =
    shared.getSheets()
      .map(function(sheet){
        return sheet.getName();
      });

  const privateNames =
    backend.getSheets()
      .map(function(sheet){
        return sheet.getName();
      });

  const missingPrivate =
    STAGE3_SHARED_CLEANUP
      .REQUIRED_PRIVATE
      .filter(function(name){
        return privateNames.indexOf(name) === -1;
      });

  const missingKeep =
    STAGE3_SHARED_CLEANUP
      .KEEP_SHARED
      .filter(function(name){
        return sharedNames.indexOf(name) === -1;
      });

  const toDelete =
    sharedNames.filter(
      function(name){
        return STAGE3_SHARED_CLEANUP
          .KEEP_SHARED
          .indexOf(name) === -1;
      }
    );

  const result = {

    sharedWorkbook:
      shared.getName(),

    sharedId:
      shared.getId(),

    keep:
      STAGE3_SHARED_CLEANUP.KEEP_SHARED,

    sheetsToDelete:
      toDelete,

    missingRequiredPrivateSheets:
      missingPrivate,

    missingRequiredSharedSheets:
      missingKeep,

    privateTrackerRows:
      backend
        .getSheetByName("Incentive Tracker")
        ? backend
            .getSheetByName("Incentive Tracker")
            .getLastRow()
        : 0,

    privateRecoveryRows:
      backend
        .getSheetByName("Promotion Recovery")
        ? backend
            .getSheetByName("Promotion Recovery")
            .getLastRow()
        : 0,

    readyToClear:
      missingPrivate.length === 0 &&
      missingKeep.length === 0
  };


  Logger.log(
    "========== STAGE 3 PRE-CLEAR CHECK =========="
  );

  Logger.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );

  Logger.log(
    "============================================="
  );

  return result;
}


/******************************************************
 * STEP 2 - DESTRUCTIVE SHARED TAB CLEANUP
 *
 * Deletes every sheet except:
 *   Raw Data
 *   Team Data
 *
 * Does NOT create any new Google Sheet.
 ******************************************************/
function stage3ClearSharedSensitiveTabs(){

  const lock =
    LockService.getScriptLock();

  lock.waitLock(30000);

  try{

    //--------------------------------------------------
    // Safety checks before deletion
    //--------------------------------------------------

    const check =
      stage3VerifyReadyToClearShared();

    if(!check.readyToClear){

      throw new Error(
        "STAGE3_NOT_READY_TO_CLEAR"
      );
    }


    const shared =
      SpreadsheetApp.openById(
        STAGE3_SHARED_CLEANUP
          .SHARED_OPERATIONS_ID
      );


    const deleted = [];
    const kept = [];


    //--------------------------------------------------
    // Snapshot the sheet list first because deleting
    // while repeatedly querying can be error-prone.
    //--------------------------------------------------

    const sheets =
      shared.getSheets();


    sheets.forEach(
      function(sheet){

        const name =
          sheet.getName();

        if(
          STAGE3_SHARED_CLEANUP
            .KEEP_SHARED
            .indexOf(name) !== -1
        ){

          kept.push(name);
          return;
        }


        shared.deleteSheet(
          sheet
        );

        deleted.push(
          name
        );

      }
    );


    SpreadsheetApp.flush();


    //--------------------------------------------------
    // Final verification
    //--------------------------------------------------

    const remaining =
      shared.getSheets()
        .map(function(sheet){
          return sheet.getName();
        });


    const exact =
      remaining.length === 2 &&
      remaining.indexOf("Raw Data") !== -1 &&
      remaining.indexOf("Team Data") !== -1;


    if(!exact){

      throw new Error(
        "STAGE3_FINAL_SHARED_STATE_INVALID"
      );
    }


    const result = {

      deleted:
        deleted,

      remaining:
        remaining,

      sharedWorkbookId:
        shared.getId(),

      success:
        true

    };


    Logger.log(
      "========== STAGE 3 SHARED CLEANUP =========="
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
  finally{

    lock.releaseLock();

  }
}


/******************************************************
 * STEP 3 - READ-ONLY FINAL VERIFICATION
 ******************************************************/
function stage3VerifySharedIsRawTeamOnly(){

  const shared =
    SpreadsheetApp.openById(
      STAGE3_SHARED_CLEANUP
        .SHARED_OPERATIONS_ID
    );

  const backend =
    SpreadsheetApp.openById(
      STAGE3_SHARED_CLEANUP
        .PRIVATE_BACKEND_ID
    );

  const sharedNames =
    shared.getSheets()
      .map(function(sheet){
        return sheet.getName();
      });

  const exact =
    sharedNames.length === 2 &&
    sharedNames.indexOf("Raw Data") !== -1 &&
    sharedNames.indexOf("Team Data") !== -1;

  const result = {

    sharedWorkbook:
      shared.getName(),

    sharedId:
      shared.getId(),

    sharedSheets:
      sharedNames,

    rawRows:
      shared.getSheetByName("Raw Data")
        .getLastRow(),

    teamRows:
      shared.getSheetByName("Team Data")
        .getLastRow(),

    privateTrackerRows:
      backend.getSheetByName(
        "Incentive Tracker"
      ).getLastRow(),

    privateRecoveryRows:
      backend.getSheetByName(
        "Promotion Recovery"
      ).getLastRow(),

    privateExceptionsRows:
      backend.getSheetByName(
        "Recovery Exceptions"
      ).getLastRow(),

    privateEvidenceRows:
      backend.getSheetByName(
        "Recovery Evidence"
      ).getLastRow(),

    sharedIsRawTeamOnly:
      exact

  };


  Logger.log(
    "========== STAGE 3 FINAL VERIFY =========="
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
