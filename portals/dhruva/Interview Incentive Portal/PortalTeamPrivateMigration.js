/******************************************************
 * PORTAL TEAM PRIVATE MIGRATION
 * Version: ISSUE4-HYD-PRIVATE-ISOLATION-1.0.2
 *
 * Target project: Interview Portal Control
 *
 * PURPOSE
 * - Move/copy legacy HYD operational control data out of
 *   the central/Pradeep private backend and into HYD's
 *   configured private backend.
 * - Preserve the existing HYD-prefixed sheet names for
 *   compatibility during this migration.
 * - Never delete or overwrite the old central source.
 * - Dedupe by stable ID when one exists.
 * - Keep target rows authoritative when the same ID is
 *   already present in HYD.
 *
 * RUN ORDER
 * 1) PTPM_validateHydPrivateIsolationReadOnly()
 * 2) PTPM_migrateHydPrivateControls()
 * 3) PTPM_verifyHydPrivateIsolationReadOnly()
 ******************************************************/

const PORTAL_TEAM_PRIVATE_MIGRATION = {
  VERSION: "ISSUE4-HYD-PRIVATE-ISOLATION-1.0.2",
  TEAM_CODE: "HYD",
  TRACKER_SHEET: "Incentive Tracker"
};


function PTPM_controlDefinitions_(){

  return [
    {
      label: "Call Outcome Requests",
      baseName: PORTAL_CALL_OPS.OUTCOME_REQUESTS_SHEET,
      keyHeader: "Request ID"
    },
    {
      label: "Call Reassignment Requests",
      baseName: PORTAL_CALL_OPS.REASSIGN_REQUESTS_SHEET,
      keyHeader: "Request ID"
    },
    {
      label: "Call Sync Map",
      baseName: PORTAL_CALL_OPS.SYNC_MAP_SHEET,
      keyHeader: "Call ID"
    },
    {
      label: "Selection Requests",
      baseName: PORTAL_CONFIG.SELECTION_REQUESTS_SHEET,
      keyHeader: "Request ID"
    },
    {
      label: "Portal Action Log",
      baseName: PORTAL_CONFIG.PORTAL_AUDIT_SHEET,
      keyHeader: ""
    }
  ];
}


function PTPM_hydRuntime_(){

  if(typeof PTR_runtimeForCode_ !== "function"){
    throw new Error("PORTAL_TEAM_ROUTER_NOT_INSTALLED");
  }

  const runtime =
    PTR_runtimeForCode_(
      PORTAL_TEAM_PRIVATE_MIGRATION.TEAM_CODE
    );

  if(
    !runtime ||
    runtime.connected !== true ||
    !runtime.privateBackendId
  ){
    throw new Error(
      "HYD_PRIVATE_BACKEND_NOT_CONNECTED"
    );
  }

  return runtime;
}


function PTPM_hydPrivateBackend_(){

  const runtime =
    PTPM_hydRuntime_();

  return SpreadsheetApp.openById(
    runtime.privateBackendId
  );
}


function PTPM_hydControlSheetName_(
  baseName
){

  if(
    typeof PTR_withExecutionTeamCode_ === "function" &&
    typeof PTR_controlSheetName_ === "function"
  ){

    return PTR_withExecutionTeamCode_(
      PORTAL_TEAM_PRIVATE_MIGRATION.TEAM_CODE,
      function(){
        return PTR_controlSheetName_(
          baseName
        );
      }
    );
  }

  // Compatibility fallback for the current router naming.
  return (
    "HYD " +
    String(baseName || "").trim()
  );
}


function PTPM_sheetRowCount_(
  sheet
){

  if(!sheet){
    return 0;
  }

  return Math.max(
    0,
    sheet.getLastRow() - 1
  );
}


function PTPM_headerMap_(
  headers
){

  const map = {};

  (headers || []).forEach(
    function(value,index){

      const key =
        String(value || "")
          .replace(/\s+/g," ")
          .trim()
          .toLowerCase();

      if(key){
        map[key] = index;
      }
    }
  );

  return map;
}


function PTPM_rowFingerprint_(
  row
){

  //--------------------------------------------------
  // v1.0.1
  // Google Sheets can normalize Date values when they
  // are written and read back. Exact ISO millisecond
  // comparison therefore creates false mismatches for
  // audit rows even when every row was copied correctly.
  //
  // Canonicalize dates to whole seconds and normalize
  // other scalar values before building the fingerprint.
  // This keeps migration re-runs idempotent without
  // treating harmless Date round-trip precision changes
  // as missing rows.
  //--------------------------------------------------

  return JSON.stringify(
    (row || []).map(
      function(value){

        if(
          value instanceof Date &&
          !isNaN(value.getTime())
        ){
          return {
            t: "date",
            // Floor rather than round: Sheets commonly
            // drops sub-second precision on round-trip.
            v: Math.floor(
              value.getTime() / 1000
            )
          };
        }

        if(
          value === null ||
          value === undefined
        ){
          return {
            t: "blank",
            v: ""
          };
        }

        if(typeof value === "string"){
          return {
            t: "string",
            v: value
              .replace(/\r\n/g,"\n")
              .trim()
          };
        }

        if(typeof value === "number"){
          return {
            t: "number",
            v: isFinite(value)
              ? Number(value)
              : String(value)
          };
        }

        if(typeof value === "boolean"){
          return {
            t: "boolean",
            v: value
          };
        }

        return {
          t: typeof value,
          v: String(value)
        };
      }
    )
  );
}


function PTPM_auditContentFingerprint_(
  row
){

  //--------------------------------------------------
  // v1.0.2
  // Audit Timestamp (column A) is intentionally excluded
  // from the migration/verification identity. Two different
  // spreadsheets can round-trip the same Sheets date serial
  // through different workbook time zones and return different
  // JavaScript Date objects. The operational audit payload is
  // columns B:J. Multiplicity is tracked separately, so repeated
  // identical audit events are still preserved/count-verified.
  //--------------------------------------------------

  return PTPM_rowFingerprint_(
    (row || []).slice(1)
  );
}


function PTPM_incrementCount_(
  map,
  key
){

  map[key] =
    Number(map[key] || 0) + 1;
}


function PTPM_consumeCount_(
  map,
  key
){

  const count =
    Number(map[key] || 0);

  if(count <= 0){
    return false;
  }

  map[key] = count - 1;
  return true;
}


function PTPM_normalizedKey_(
  value
){

  return String(value || "")
    .replace(/\s+/g," ")
    .trim();
}


function PTPM_assertCompatibleHeaders_(
  sourceHeaders,
  targetHeaders,
  sheetName
){

  const source =
    (sourceHeaders || []).map(
      function(value){
        return String(value || "")
          .replace(/\s+/g," ")
          .trim()
          .toLowerCase();
      }
    );

  const target =
    (targetHeaders || []).map(
      function(value){
        return String(value || "")
          .replace(/\s+/g," ")
          .trim()
          .toLowerCase();
      }
    );

  if(source.length !== target.length){
    throw new Error(
      "MIGRATION_HEADER_WIDTH_MISMATCH|" +
      sheetName
    );
  }

  for(let i=0;i<source.length;i++){
    if(source[i] !== target[i]){
      throw new Error(
        "MIGRATION_HEADER_MISMATCH|" +
        sheetName +
        "|column=" +
        (i + 1)
      );
    }
  }
}


function PTPM_ensureTargetSheet_(
  targetBook,
  sourceSheet,
  sheetName
){

  let target =
    targetBook.getSheetByName(
      sheetName
    );

  const sourceLastColumn =
    sourceSheet.getLastColumn();

  const sourceHeaders =
    sourceSheet
      .getRange(
        1,
        1,
        1,
        sourceLastColumn
      )
      .getValues()[0];

  if(!target){

    target =
      targetBook.insertSheet(
        sheetName
      );

    target
      .getRange(
        1,
        1,
        1,
        sourceHeaders.length
      )
      .setValues([
        sourceHeaders
      ])
      .setFontWeight(
        "bold"
      );

    target.setFrozenRows(1);

    const headerFormats =
      sourceSheet
        .getRange(
          1,
          1,
          1,
          sourceHeaders.length
        )
        .getNumberFormats();

    target
      .getRange(
        1,
        1,
        1,
        sourceHeaders.length
      )
      .setNumberFormats(
        headerFormats
      );

    return target;
  }

  if(target.getLastRow() === 0){

    target
      .getRange(
        1,
        1,
        1,
        sourceHeaders.length
      )
      .setValues([
        sourceHeaders
      ])
      .setFontWeight(
        "bold"
      );

    target.setFrozenRows(1);
    return target;
  }

  const targetWidth =
    target.getLastColumn();

  const targetHeaders =
    target
      .getRange(
        1,
        1,
        1,
        targetWidth
      )
      .getValues()[0];

  PTPM_assertCompatibleHeaders_(
    sourceHeaders,
    targetHeaders,
    sheetName
  );

  return target;
}


function PTPM_copyMissingRows_(
  sourceSheet,
  targetSheet,
  keyHeader
){

  const sourceValues =
    sourceSheet
      .getDataRange()
      .getValues();

  if(sourceValues.length <= 1){
    return {
      sourceRows: 0,
      targetRowsBefore:
        PTPM_sheetRowCount_(
          targetSheet
        ),
      copied: 0,
      duplicateKeys: 0,
      targetRowsAfter:
        PTPM_sheetRowCount_(
          targetSheet
        )
    };
  }

  const sourceWidth =
    sourceValues[0].length;

  const targetValues =
    targetSheet.getLastRow() > 0
      ? targetSheet
          .getRange(
            1,
            1,
            targetSheet.getLastRow(),
            sourceWidth
          )
          .getValues()
      : [];

  const targetRowsBefore =
    Math.max(
      0,
      targetValues.length - 1
    );

  let keyIndex = -1;

  if(keyHeader){

    const headerMap =
      PTPM_headerMap_(
        sourceValues[0]
      );

    keyIndex =
      headerMap[
        String(keyHeader)
          .trim()
          .toLowerCase()
      ];

    if(keyIndex === undefined){
      throw new Error(
        "MIGRATION_KEY_COLUMN_NOT_FOUND|" +
        sourceSheet.getName() +
        "|" +
        keyHeader
      );
    }
  }

  const targetKeys = {};
  const targetFingerprints = {};

  for(let i=1;i<targetValues.length;i++){

    if(keyIndex >= 0){

      const key =
        PTPM_normalizedKey_(
          targetValues[i][keyIndex]
        );

      if(key){
        targetKeys[key] = true;
      }

    }else{

      PTPM_incrementCount_(
        targetFingerprints,
        PTPM_auditContentFingerprint_(
          targetValues[i]
        )
      );
    }
  }

  const rowsToAppend = [];
  const formatsToAppend = [];
  let duplicateKeys = 0;

  const sourceFormats =
    sourceSheet
      .getDataRange()
      .getNumberFormats();

  for(let i=1;i<sourceValues.length;i++){

    const row =
      sourceValues[i];

    let exists = false;

    if(keyIndex >= 0){

      const key =
        PTPM_normalizedKey_(
          row[keyIndex]
        );

      if(!key){
        // A control row without its stable ID is not safe
        // to migrate automatically.
        continue;
      }

      exists =
        targetKeys[key] === true;

      if(exists){
        duplicateKeys++;
      }else{
        targetKeys[key] = true;
      }

    }else{

      const fingerprint =
        PTPM_auditContentFingerprint_(
          row
        );

      // Multiset matching preserves repeated identical audit
      // events while remaining insensitive to timestamp
      // round-trip differences between workbooks.
      exists =
        PTPM_consumeCount_(
          targetFingerprints,
          fingerprint
        );
    }

    if(exists){
      continue;
    }

    rowsToAppend.push(
      row.slice(0,sourceWidth)
    );

    formatsToAppend.push(
      sourceFormats[i]
        .slice(0,sourceWidth)
    );
  }

  if(rowsToAppend.length){

    const startRow =
      targetSheet.getLastRow() + 1;

    const requiredLastRow =
      startRow +
      rowsToAppend.length -
      1;

    if(
      requiredLastRow >
      targetSheet.getMaxRows()
    ){

      targetSheet.insertRowsAfter(
        targetSheet.getMaxRows(),
        requiredLastRow -
          targetSheet.getMaxRows()
      );
    }

    const range =
      targetSheet.getRange(
        startRow,
        1,
        rowsToAppend.length,
        sourceWidth
      );

    range.setValues(
      rowsToAppend
    );

    if(formatsToAppend.length){
      range.setNumberFormats(
        formatsToAppend
      );
    }
  }

  return {
    sourceRows:
      sourceValues.length - 1,
    targetRowsBefore:
      targetRowsBefore,
    copied:
      rowsToAppend.length,
    duplicateKeys:
      duplicateKeys,
    targetRowsAfter:
      PTPM_sheetRowCount_(
        targetSheet
      )
  };
}


function PTPM_ensureHydTrackerSchema_(
  central,
  hydPrivate
){

  const target =
    hydPrivate.getSheetByName(
      PORTAL_TEAM_PRIVATE_MIGRATION.TRACKER_SHEET
    );

  if(target){
    return {
      created: false,
      rows:
        PTPM_sheetRowCount_(
          target
        )
    };
  }

  const source =
    central.getSheetByName(
      PORTAL_TEAM_PRIVATE_MIGRATION.TRACKER_SHEET
    );

  if(
    !source ||
    source.getLastRow() < 1 ||
    source.getLastColumn() < 1
  ){

    return {
      created: false,
      rows: 0,
      warning:
        "HYD Incentive Tracker is missing and no central header template was available."
    };
  }

  //--------------------------------------------------
  // IMPORTANT: Only the schema/header is copied.
  // Central tracker DATA may belong to Pradeep and must
  // never be copied into HYD automatically.
  //--------------------------------------------------

  const width =
    source.getLastColumn();

  const sheet =
    hydPrivate.insertSheet(
      PORTAL_TEAM_PRIVATE_MIGRATION.TRACKER_SHEET
    );

  const sourceHeader =
    source.getRange(
      1,
      1,
      1,
      width
    );

  sheet
    .getRange(
      1,
      1,
      1,
      width
    )
    .setValues(
      sourceHeader.getValues()
    )
    .setNumberFormats(
      sourceHeader.getNumberFormats()
    )
    .setFontWeight(
      "bold"
    );

  sheet.setFrozenRows(1);

  return {
    created: true,
    rows: 0
  };
}


function PTPM_validateHydPrivateIsolationReadOnly(){

  const runtime =
    PTPM_hydRuntime_();

  const central =
    portalBackend_();

  const hydPrivate =
    PTPM_hydPrivateBackend_();

  const definitions =
    PTPM_controlDefinitions_();

  const sheets =
    definitions.map(
      function(def){

        const sheetName =
          PTPM_hydControlSheetName_(
            def.baseName
          );

        const source =
          central.getSheetByName(
            sheetName
          );

        const target =
          hydPrivate.getSheetByName(
            sheetName
          );

        return {
          label: def.label,
          sheetName: sheetName,
          centralRows:
            PTPM_sheetRowCount_(
              source
            ),
          hydRows:
            PTPM_sheetRowCount_(
              target
            ),
          centralExists: !!source,
          hydExists: !!target
        };
      }
    );

  const tracker =
    hydPrivate.getSheetByName(
      PORTAL_TEAM_PRIVATE_MIGRATION.TRACKER_SHEET
    );

  const result = {
    ok:
      central.getId() !==
      hydPrivate.getId(),
    version:
      PORTAL_TEAM_PRIVATE_MIGRATION.VERSION,
    hydRuntimeConnected:
      runtime.connected === true,
    centralWorkbook:
      central.getName(),
    hydPrivateWorkbook:
      hydPrivate.getName(),
    centralTimeZone:
      central.getSpreadsheetTimeZone(),
    hydPrivateTimeZone:
      hydPrivate.getSpreadsheetTimeZone(),
    physicallySeparated:
      central.getId() !==
      hydPrivate.getId(),
    hydTrackerExists:
      !!tracker,
    hydTrackerRows:
      PTPM_sheetRowCount_(
        tracker
      ),
    controlSheets:
      sheets
  };

  Logger.log(
    "========== HYD PRIVATE ISOLATION - PRECHECK =========="
  );

  Logger.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );

  Logger.log(
    "======================================================"
  );

  return result;
}


function PTPM_migrateHydPrivateControls(){

  const lock =
    LockService.getScriptLock();

  lock.waitLock(30000);

  try{

    const central =
      portalBackend_();

    const hydPrivate =
      PTPM_hydPrivateBackend_();

    if(
      central.getId() ===
      hydPrivate.getId()
    ){
      throw new Error(
        "HYD_PRIVATE_BACKEND_POINTS_TO_CENTRAL_BACKEND"
      );
    }

    const trackerResult =
      PTPM_ensureHydTrackerSchema_(
        central,
        hydPrivate
      );

    const results = [];

    PTPM_controlDefinitions_()
      .forEach(
        function(def){

          const sheetName =
            PTPM_hydControlSheetName_(
              def.baseName
            );

          const source =
            central.getSheetByName(
              sheetName
            );

          if(!source){

            results.push({
              label: def.label,
              sheetName: sheetName,
              sourceFound: false,
              copied: 0,
              note:
                "No legacy central source sheet was found."
            });

            return;
          }

          const target =
            PTPM_ensureTargetSheet_(
              hydPrivate,
              source,
              sheetName
            );

          const copy =
            PTPM_copyMissingRows_(
              source,
              target,
              def.keyHeader
            );

          results.push({
            label: def.label,
            sheetName: sheetName,
            sourceFound: true,
            sourceRows:
              copy.sourceRows,
            targetRowsBefore:
              copy.targetRowsBefore,
            copied:
              copy.copied,
            duplicateKeys:
              copy.duplicateKeys,
            targetRowsAfter:
              copy.targetRowsAfter
          });
        }
      );

    SpreadsheetApp.flush();

    const result = {
      ok: true,
      version:
        PORTAL_TEAM_PRIVATE_MIGRATION.VERSION,
      centralWorkbook:
        central.getName(),
      hydPrivateWorkbook:
        hydPrivate.getName(),
      tracker:
        trackerResult,
      sheets:
        results,
      sourceDeleted: false,
      message:
        "HYD operational control data was copied/deduped into the HYD private backend. Central source sheets were intentionally left unchanged."
    };

    Logger.log(
      "========== HYD PRIVATE MIGRATION =========="
    );

    Logger.log(
      JSON.stringify(
        result,
        null,
        2
      )
    );

    Logger.log(
      "==========================================="
    );

    return result;

  }finally{
    lock.releaseLock();
  }
}


function PTPM_missingCount_(
  source,
  target,
  keyHeader
){

  if(!source){
    return 0;
  }

  if(!target){
    return PTPM_sheetRowCount_(
      source
    );
  }

  const sourceValues =
    source.getDataRange().getValues();

  const targetValues =
    target.getDataRange().getValues();

  if(sourceValues.length <= 1){
    return 0;
  }

  if(!keyHeader){

    const targetFingerprints = {};

    for(let i=1;i<targetValues.length;i++){
      PTPM_incrementCount_(
        targetFingerprints,
        PTPM_auditContentFingerprint_(
          targetValues[i]
        )
      );
    }

    let missing = 0;

    for(let i=1;i<sourceValues.length;i++){
      const fingerprint =
        PTPM_auditContentFingerprint_(
          sourceValues[i]
        );

      if(
        !PTPM_consumeCount_(
          targetFingerprints,
          fingerprint
        )
      ){
        missing++;
      }
    }

    return missing;
  }

  const map =
    PTPM_headerMap_(
      sourceValues[0]
    );

  const keyIndex =
    map[
      String(keyHeader)
        .trim()
        .toLowerCase()
    ];

  if(keyIndex === undefined){
    throw new Error(
      "VERIFY_KEY_COLUMN_NOT_FOUND|" +
      source.getName() +
      "|" +
      keyHeader
    );
  }

  const targetKeys = {};

  for(let i=1;i<targetValues.length;i++){
    const key =
      PTPM_normalizedKey_(
        targetValues[i][keyIndex]
      );
    if(key){
      targetKeys[key] = true;
    }
  }

  let missing = 0;

  for(let i=1;i<sourceValues.length;i++){

    const key =
      PTPM_normalizedKey_(
        sourceValues[i][keyIndex]
      );

    if(
      key &&
      !targetKeys[key]
    ){
      missing++;
    }
  }

  return missing;
}


function PTPM_verifyHydPrivateIsolationReadOnly(){

  const central =
    portalBackend_();

  const hydPrivate =
    PTPM_hydPrivateBackend_();

  const results = [];
  let totalMissing = 0;

  PTPM_controlDefinitions_()
    .forEach(
      function(def){

        const sheetName =
          PTPM_hydControlSheetName_(
            def.baseName
          );

        const source =
          central.getSheetByName(
            sheetName
          );

        const target =
          hydPrivate.getSheetByName(
            sheetName
          );

        const missing =
          PTPM_missingCount_(
            source,
            target,
            def.keyHeader
          );

        totalMissing +=
          missing;

        results.push({
          label: def.label,
          sheetName: sheetName,
          centralRows:
            PTPM_sheetRowCount_(
              source
            ),
          hydRows:
            PTPM_sheetRowCount_(
              target
            ),
          missingFromHyd:
            missing
        });
      }
    );

  const tracker =
    hydPrivate.getSheetByName(
      PORTAL_TEAM_PRIVATE_MIGRATION.TRACKER_SHEET
    );

  const physicallySeparated =
    central.getId() !==
    hydPrivate.getId();

  const result = {
    ok:
      physicallySeparated &&
      totalMissing === 0 &&
      !!tracker,
    version:
      PORTAL_TEAM_PRIVATE_MIGRATION.VERSION,
    physicallySeparated:
      physicallySeparated,
    centralWorkbook:
      central.getName(),
    hydPrivateWorkbook:
      hydPrivate.getName(),
    hydTrackerExists:
      !!tracker,
    hydTrackerRows:
      PTPM_sheetRowCount_(
        tracker
      ),
    totalMissingFromHyd:
      totalMissing,
    controlSheets:
      results,
    centralSourcePreserved:
      true,
    auditVerificationMode:
      "Audit rows compared as a multiplicity-preserving fingerprint of columns B:J; Timestamp excluded because workbook date round-trips can differ"
  };

  Logger.log(
    "========== HYD PRIVATE ISOLATION - VERIFY =========="
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
