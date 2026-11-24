/******************************************************
 * INCENTIVE PRIVATE MIGRATION - STAGE 1
 *
 * PURPOSE
 * -------
 * Safely COPY all non-operational sheets from the
 * shared Incentive Tracker workbook into the private
 * Incentive Backend.
 *
 * SHARED WORKBOOK FINAL GOAL:
 *   Raw Data
 *   Team Data
 *
 * IMPORTANT
 * ---------
 * - This Stage 1 script DOES NOT delete any shared tab.
 * - It DOES NOT move the incentive engine yet.
 * - It DOES NOT overwrite the permanent private
 *   Incentive Tracker.
 * - Existing private target sheets are backed up before
 *   a shared copy replaces them.
 ******************************************************/

const PRIVATE_MIGRATION_STAGE1 = {

  OPERATIONS_SPREADSHEET_ID:
    "1UudfZfeBBkEwBQeWUwx77R4gl26wYZ1rKKZWCM_SHq4",

  PRIVATE_BACKEND_ID:
    "1Q5pRPoLsSjfxuRfEUZW2zZqrURYPzzbbPO6_8r9CLCk",

  KEEP_IN_SHARED: [
    "Raw Data",
    "Team Data"
  ],

  //--------------------------------------------------
  // These are already private-system sheets.
  // Never replace them from an accidental shared copy.
  //--------------------------------------------------
  PRIVATE_PROTECTED: [
    "Incentive Tracker",
    "Monthly Incentive Summary",
    "Portal Users",
    "Selection Requests",
    "Portal Action Log",
    "Call Outcome Requests",
    "Call Reassignment Requests",
    "Call Sync Map"
  ]
};


/******************************************************
 * STEP 1 - SAFE AUDIT
 *
 * READ ONLY.
 ******************************************************/
function stage1AuditWorkbookSplit(){

  const shared =
    PM1_shared_();

  const backend =
    PM1_backend_();

  const sharedNames =
    shared.getSheets()
      .map(function(sheet){
        return sheet.getName();
      });

  const backendNames =
    backend.getSheets()
      .map(function(sheet){
        return sheet.getName();
      });

  const keep =
    PRIVATE_MIGRATION_STAGE1
      .KEEP_IN_SHARED;

  const toMove =
    sharedNames.filter(
      function(name){
        return keep.indexOf(name) === -1;
      }
    );

  const report = {
    sharedWorkbook:
      shared.getName(),
    sharedId:
      shared.getId(),
    privateWorkbook:
      backend.getName(),
    privateId:
      backend.getId(),
    keepShared:
      keep,
    sharedSensitiveSheets:
      toMove,
    privateSheets:
      backendNames
  };

  Logger.log(
    "========== STAGE 1 AUDIT =========="
  );

  Logger.log(
    JSON.stringify(
      report,
      null,
      2
    )
  );

  Logger.log(
    "==================================="
  );

  return report;
}


/******************************************************
 * STEP 2 - COPY SENSITIVE SHEETS TO PRIVATE BACKEND
 *
 * NON-DESTRUCTIVE TO SHARED WORKBOOK.
 *
 * Special handling:
 * - Shared Incentive Tracker is MERGED through the
 *   existing permanent backend writer when available.
 * - Private system sheets are never overwritten.
 * - Other same-name private sheets are backed up first.
 ******************************************************/
function stage1MigratePrivateSheets(){

  const lock =
    LockService.getScriptLock();

  lock.waitLock(30000);

  try{

    const shared =
      PM1_shared_();

    const backend =
      PM1_backend_();

    const keep =
      PRIVATE_MIGRATION_STAGE1
        .KEEP_IN_SHARED;

    const protectedNames =
      PRIVATE_MIGRATION_STAGE1
        .PRIVATE_PROTECTED;

    const timestamp =
      Utilities.formatDate(
        new Date(),
        Session.getScriptTimeZone(),
        "yyyyMMdd-HHmmss"
      );

    const result = {
      tracker: null,
      copied: [],
      replacedWithBackup: [],
      skippedProtected: [],
      missing: [],
      errors: []
    };


    //--------------------------------------------------
    // 1) Permanent Incentive Tracker
    //--------------------------------------------------

    const sharedTracker =
      shared.getSheetByName(
        "Incentive Tracker"
      );

    if(sharedTracker){

      try{
        result.tracker =
          PM1_migrateTracker_(
            sharedTracker
          );
      }
      catch(error){
        result.errors.push({
          sheet:
            "Incentive Tracker",
          error:
            error.message || String(error)
        });
      }

    }else{

      result.missing.push(
        "Incentive Tracker"
      );

    }


    //--------------------------------------------------
    // 2) Every other non-Raw / non-Team sheet
    //--------------------------------------------------

    shared.getSheets()
      .forEach(
        function(sourceSheet){

          const name =
            sourceSheet.getName();

          if(
            keep.indexOf(name) !== -1 ||
            name === "Incentive Tracker"
          ){
            return;
          }


          //------------------------------------------------
          // Never overwrite a protected private-system tab.
          //------------------------------------------------

          if(
            protectedNames.indexOf(name) !== -1
          ){

            result.skippedProtected.push(
              name
            );

            return;
          }


          try{

            const existing =
              backend.getSheetByName(
                name
              );

            if(existing){

              const backupName =
                PM1_uniqueSheetName_(
                  backend,
                  name +
                  "__PRE_MIGRATION__" +
                  timestamp
                );

              const backup =
                existing.copyTo(
                  backend
                );

              backup.setName(
                backupName
              );

              backend.deleteSheet(
                existing
              );

              result.replacedWithBackup
                .push({
                  sheet:
                    name,
                  backup:
                    backupName
                });
            }


            //------------------------------------------------
            // Sheet.copyTo() preserves the sheet structure,
            // formatting, formulas, validation, etc.
            //------------------------------------------------

            const copied =
              sourceSheet.copyTo(
                backend
              );

            copied.setName(
              name
            );

            result.copied.push({
              sheet:
                name,
              rows:
                sourceSheet.getLastRow(),
              columns:
                sourceSheet.getLastColumn()
            });

          }
          catch(error){

            result.errors.push({
              sheet:
                name,
              error:
                error.message || String(error)
            });

          }

        }
      );


    SpreadsheetApp.flush();


    Logger.log(
      "========== STAGE 1 MIGRATION =========="
    );

    Logger.log(
      JSON.stringify(
        result,
        null,
        2
      )
    );

    Logger.log(
      "======================================="
    );

    return result;

  }
  finally{
    lock.releaseLock();
  }
}


/******************************************************
 * STEP 3 - VERIFY PRIVATE COPIES
 *
 * READ ONLY.
 *
 * Compares:
 * - existence
 * - used row count
 * - used column count
 * - header row
 * - display-value SHA-256 digest
 *
 * Incentive Tracker is verified separately because it
 * is a permanent MERGE, not a same-sheet replacement.
 ******************************************************/
function stage1VerifyPrivateMigration(){

  const shared =
    PM1_shared_();

  const backend =
    PM1_backend_();

  const keep =
    PRIVATE_MIGRATION_STAGE1
      .KEEP_IN_SHARED;

  const protectedNames =
    PRIVATE_MIGRATION_STAGE1
      .PRIVATE_PROTECTED;

  const checks = [];


  shared.getSheets()
    .forEach(
      function(sourceSheet){

        const name =
          sourceSheet.getName();

        if(
          keep.indexOf(name) !== -1 ||
          name === "Incentive Tracker" ||
          protectedNames.indexOf(name) !== -1
        ){
          return;
        }

        const targetSheet =
          backend.getSheetByName(
            name
          );

        if(!targetSheet){

          checks.push({
            sheet:
              name,
            ok:
              false,
            reason:
              "Missing in private backend"
          });

          return;
        }


        const sourceRows =
          sourceSheet.getLastRow();

        const sourceCols =
          sourceSheet.getLastColumn();

        const targetRows =
          targetSheet.getLastRow();

        const targetCols =
          targetSheet.getLastColumn();

        const sourceHeader =
          sourceRows > 0 && sourceCols > 0
            ? sourceSheet
                .getRange(
                  1,
                  1,
                  1,
                  sourceCols
                )
                .getDisplayValues()[0]
            : [];

        const targetHeader =
          targetRows > 0 && targetCols > 0
            ? targetSheet
                .getRange(
                  1,
                  1,
                  1,
                  targetCols
                )
                .getDisplayValues()[0]
            : [];

        const sameDimensions =
          sourceRows === targetRows &&
          sourceCols === targetCols;

        const sameHeader =
          JSON.stringify(sourceHeader) ===
          JSON.stringify(targetHeader);

        let sourceDigest = "";
        let targetDigest = "";

        if(sameDimensions){
          sourceDigest =
            PM1_sheetDigest_(
              sourceSheet
            );

          targetDigest =
            PM1_sheetDigest_(
              targetSheet
            );
        }

        checks.push({
          sheet:
            name,
          ok:
            sameDimensions &&
            sameHeader &&
            sourceDigest === targetDigest,
          sourceRows:
            sourceRows,
          privateRows:
            targetRows,
          sourceColumns:
            sourceCols,
          privateColumns:
            targetCols,
          sameHeader:
            sameHeader,
          sameDigest:
            sameDimensions
              ? sourceDigest === targetDigest
              : false
        });

      }
    );


  const privateTracker =
    backend.getSheetByName(
      "Incentive Tracker"
    );

  const trackerCheck = {
    exists:
      !!privateTracker,
    columns:
      privateTracker
        ? privateTracker.getLastColumn()
        : 0,
    rows:
      privateTracker
        ? privateTracker.getLastRow()
        : 0,
    correctSchema:
      !!privateTracker &&
      privateTracker.getLastColumn() === 10
  };


  const failed =
    checks.filter(
      function(item){
        return !item.ok;
      }
    );

  const report = {
    copiedSheetChecks:
      checks,
    privateTracker:
      trackerCheck,
    failedCount:
      failed.length,
    readyForStage2:
      failed.length === 0 &&
      trackerCheck.correctSchema
  };


  Logger.log(
    "========== STAGE 1 VERIFY =========="
  );

  Logger.log(
    JSON.stringify(
      report,
      null,
      2
    )
  );

  Logger.log(
    "===================================="
  );

  return report;
}


/******************************************************
 * OPTIONAL - LIST EXACT FINAL SHARED TABS
 *
 * READ ONLY.
 ******************************************************/
function stage1PreviewFinalSharedWorkbook(){

  const shared =
    PM1_shared_();

  const keep =
    PRIVATE_MIGRATION_STAGE1
      .KEEP_IN_SHARED;

  const current =
    shared.getSheets()
      .map(function(sheet){
        return sheet.getName();
      });

  const removeLater =
    current.filter(
      function(name){
        return keep.indexOf(name) === -1;
      }
    );

  const result = {
    finalSharedTabs:
      keep,
    removeOnlyAfterFinalCutover:
      removeLater
  };

  Logger.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );

  return result;
}


/******************************************************
 * PRIVATE - MIGRATE SHARED TRACKER INTO PERMANENT
 * PRIVATE TRACKER WITHOUT OVERWRITING IT.
 ******************************************************/
function PM1_migrateTracker_(
  sharedTracker
){

  const rows =
    sharedTracker.getLastRow();

  const cols =
    sharedTracker.getLastColumn();

  if(rows <= 1){
    return {
      sourceRows:
        0,
      added:
        0,
      message:
        "Shared Incentive Tracker has no data rows."
    };
  }

  if(cols !== 10){
    throw new Error(
      "Shared Incentive Tracker must have exactly 10 columns. Current: " +
      cols
    );
  }

  if(
    typeof appendIncentivesToPrivateBackend !==
    "function"
  ){
    throw new Error(
      "appendIncentivesToPrivateBackend() is required. " +
      "Keep PrivateBackend.gs installed before Stage 1 migration."
    );
  }

  const records =
    sharedTracker
      .getRange(
        2,
        1,
        rows - 1,
        10
      )
      .getValues();

  const added =
    appendIncentivesToPrivateBackend(
      records
    );

  return {
    sourceRows:
      records.length,
    added:
      added,
    message:
      "Permanent tracker merged without overwriting existing private records."
  };
}


/******************************************************
 * PRIVATE - SHARED WORKBOOK
 ******************************************************/
function PM1_shared_(){

  const ss =
    SpreadsheetApp.openById(
      PRIVATE_MIGRATION_STAGE1
        .OPERATIONS_SPREADSHEET_ID
    );

  if(!ss){
    throw new Error(
      "Shared operations workbook could not be opened."
    );
  }

  return ss;
}


/******************************************************
 * PRIVATE - BACKEND WORKBOOK
 ******************************************************/
function PM1_backend_(){

  const ss =
    SpreadsheetApp.openById(
      PRIVATE_MIGRATION_STAGE1
        .PRIVATE_BACKEND_ID
    );

  if(!ss){
    throw new Error(
      "Private Incentive Backend could not be opened."
    );
  }

  return ss;
}


/******************************************************
 * PRIVATE - UNIQUE BACKUP NAME
 ******************************************************/
function PM1_uniqueSheetName_(
  spreadsheet,
  requestedName
){

  let name =
    String(requestedName || "Backup")
      .substring(0, 95);

  let candidate =
    name;

  let counter = 2;

  while(
    spreadsheet.getSheetByName(
      candidate
    )
  ){

    const suffix =
      "__" + counter;

    candidate =
      name.substring(
        0,
        Math.max(
          1,
          99 - suffix.length
        )
      ) + suffix;

    counter++;
  }

  return candidate;
}


/******************************************************
 * PRIVATE - SHEET CONTENT DIGEST
 *
 * Uses displayed values so dates/numbers are compared
 * as the user sees them in each copied sheet.
 ******************************************************/
function PM1_sheetDigest_(
  sheet
){

  const rows =
    sheet.getLastRow();

  const cols =
    sheet.getLastColumn();

  if(rows === 0 || cols === 0){
    return "EMPTY";
  }

  const values =
    sheet
      .getRange(
        1,
        1,
        rows,
        cols
      )
      .getDisplayValues();

  const text =
    values
      .map(function(row){
        return row.join("\u001F");
      })
      .join("\u001E");

  const digest =
    Utilities.computeDigest(
      Utilities.DigestAlgorithm.SHA_256,
      text,
      Utilities.Charset.UTF_8
    );

  return digest
    .map(function(byte){
      const value =
        (byte + 256) % 256;
      return (
        "0" +
        value.toString(16)
      ).slice(-2);
    })
    .join("");
}

