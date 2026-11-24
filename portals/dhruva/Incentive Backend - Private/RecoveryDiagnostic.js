/******************************************************
 * RECOVERY READ-ONLY DIAGNOSTIC v1.0
 *
 * RUN IN:
 *   Incentive Backend - Private -> Apps Script
 *
 * PURPOSE:
 * - Verify Recovery can still read shared Raw Data / Team Data.
 * - Show whether records after 11-Aug-2026 would become:
 *     Recovery
 *     Exception / Review
 *     Already Tracked
 *     Blocked invalid occurrence
 *     No safe team match
 *
 * SAFETY:
 * - READ ONLY
 * - Does NOT call recoverMissedPromotions()
 * - Does NOT write/clear any sheet
 * - Does NOT approve/apply anything
 ******************************************************/

function RECOVERY_DIAG_readOnly(){

  const cutoff =
    new Date(2026, 7, 11, 23, 59, 59);

  const active =
    SpreadsheetApp.getActive();

  const privateSS =
    typeof IR_backend_ === "function"
      ? IR_backend_()
      : active;

  const operationsSS =
    typeof IR_operations_ === "function"
      ? IR_operations_()
      : null;

  if(
    !active ||
    !privateSS ||
    active.getId() !== privateSS.getId()
  ){
    throw new Error(
      "RUN_THIS_FROM_INCENTIVE_BACKEND_PRIVATE"
    );
  }

  const result = {
    ok: false,
    mode: "READ_ONLY_RECOVERY_DIAGNOSTIC",
    cutoff: "2026-08-11",
    privateWorkbook: privateSS.getName(),
    sharedOperationsWorkbook:
      operationsSS ? operationsSS.getName() : "",
    routing: {},
    dates: {},
    counts: {},
    samples: {
      eligibleRecoveries: [],
      exceptions: [],
      noSafeTeamMatch: [],
      blockedInvalidOccurrence: []
    },
    errors: []
  };


  //--------------------------------------------------
  // ROUTING HEALTH
  //--------------------------------------------------

  result.routing.privateHasRawData =
    Boolean(
      privateSS.getSheetByName(
        CONFIG.RAW_SHEET
      )
    );

  result.routing.privateHasTeamData =
    Boolean(
      privateSS.getSheetByName(
        CONFIG.TEAM_SHEET
      )
    );

  result.routing.sharedHasRawData =
    Boolean(
      operationsSS &&
      operationsSS.getSheetByName(
        CONFIG.RAW_SHEET
      )
    );

  result.routing.sharedHasTeamData =
    Boolean(
      operationsSS &&
      operationsSS.getSheetByName(
        CONFIG.TEAM_SHEET
      )
    );

  result.routing.recoveryLoaderExists =
    typeof REC_loadRawDataForRecovery ===
      "function";

  result.routing.recoveryEngineExists =
    typeof recoverMissedPromotions ===
      "function";

  result.routing.recoveryLoaderSource =
    RECOVERY_DIAG_loaderRouting_();


  //--------------------------------------------------
  // LOAD DATA — READ ONLY
  //--------------------------------------------------

  let rawRecords = [];
  let teamRecords = [];
  let trackerRecords = [];

  try{

    rawRecords =
      REC_loadRawDataForRecovery();

    result.routing.recoveryLoaderSucceeded =
      true;

  }catch(error){

    result.routing.recoveryLoaderSucceeded =
      false;

    result.routing.recoveryLoaderError =
      error && error.message
        ? error.message
        : String(error);

    result.errors.push(
      "REC_loadRawDataForRecovery: " +
      result.routing.recoveryLoaderError
    );

  }


  try{

    teamRecords =
      loadTeamData();

  }catch(error){

    result.errors.push(
      "loadTeamData: " +
      (
        error && error.message
          ? error.message
          : String(error)
      )
    );

  }


  try{

    trackerRecords =
      REC_loadTrackerPromotions();

  }catch(error){

    result.errors.push(
      "REC_loadTrackerPromotions: " +
      (
        error && error.message
          ? error.message
          : String(error)
      )
    );

  }


  result.counts.rawRecords =
    rawRecords.length;

  result.counts.teamRecords =
    teamRecords.length;

  result.counts.trackerPromotions =
    trackerRecords.length;


  result.dates.latestRawDate =
    RECOVERY_DIAG_latestRecordDate_(
      rawRecords
    );

  result.dates.latestTeamDate =
    RECOVERY_DIAG_latestRecordDate_(
      teamRecords
    );

  result.dates.latestRecoveryPromotionDate =
    RECOVERY_DIAG_latestSheetDateByHeader_(
      privateSS,
      REC_SETTINGS.SHEET_NAME,
      "Promotion Date"
    );

  result.dates.latestExceptionPromotionDate =
    RECOVERY_DIAG_latestSheetDateByHeader_(
      privateSS,
      REC_SETTINGS.EXCEPTIONS_SHEET_NAME,
      "Promotion Date"
    );


  //--------------------------------------------------
  // If recovery loader itself failed, stop here.
  //--------------------------------------------------

  if(
    !result.routing.recoveryLoaderSucceeded
  ){

    result.ok = false;

    RECOVERY_DIAG_log_(
      result
    );

    return result;

  }


  //--------------------------------------------------
  // SIMULATE CURRENT RECOVERY LOGIC — NO WRITES
  //--------------------------------------------------

  const teamIndex =
    REC_buildTeamRoundIndex(
      teamRecords
    );

  const occurrenceIndex =
    REC_buildCurrentOccurrenceIndex(
      teamRecords
    );


  const counts = {
    rawAfterCutoff: 0,
    higherRoundRawAfterCutoff: 0,
    blockedInvalidOccurrenceAfterCutoff: 0,
    ambiguousWouldReviewAfterCutoff: 0,
    skippedRoundWouldReviewAfterCutoff: 0,
    alreadyTrackedAfterCutoff: 0,
    eligibleRecoveryAfterCutoff: 0,
    noSafeTeamMatchAfterCutoff: 0,
    invalidAmountAfterCutoff: 0
  };


  rawRecords.forEach(
    function(rawRecord){

      if(
        !rawRecord ||
        !(rawRecord.dateObj instanceof Date) ||
        isNaN(rawRecord.dateObj.getTime()) ||
        rawRecord.dateObj <= cutoff
      ){
        return;
      }

      counts.rawAfterCutoff++;


      if(
        !REC_isPromotionEvidence(
          rawRecord
        )
      ){
        return;
      }

      counts.higherRoundRawAfterCutoff++;


      const occurrenceCheck =
        REC_checkCurrentOccurrence(
          rawRecord,
          occurrenceIndex
        );


      if(
        occurrenceCheck &&
        occurrenceCheck.blocked
      ){

        counts
          .blockedInvalidOccurrenceAfterCutoff++;

        RECOVERY_DIAG_pushSample_(
          result.samples
            .blockedInvalidOccurrence,
          {
            date:
              RECOVERY_DIAG_dateKey_(
                rawRecord.dateObj
              ),
            candidate:
              rawRecord.candidate || "",
            client:
              rawRecord.client || "",
            round:
              rawRecord.round || "",
            teamHandler:
              occurrenceCheck.handler || ""
          }
        );

        return;
      }


      const matchResult =
        REC_findBestTeamMatch(
          rawRecord,
          teamIndex
        );


      if(
        matchResult &&
        !matchResult.match &&
        matchResult.reason ===
          "ambiguous"
      ){

        counts
          .ambiguousWouldReviewAfterCutoff++;

        RECOVERY_DIAG_pushSample_(
          result.samples.exceptions,
          {
            type:
              "Ambiguous Team Match",
            date:
              RECOVERY_DIAG_dateKey_(
                rawRecord.dateObj
              ),
            candidate:
              rawRecord.candidate || "",
            client:
              rawRecord.client || "",
            round:
              rawRecord.round || ""
          }
        );

        return;
      }


      if(
        !matchResult ||
        !matchResult.match
      ){

        const skipped =
          REC_findSkippedRoundEvidence(
            rawRecord,
            teamIndex
          );


        if(skipped){

          counts
            .skippedRoundWouldReviewAfterCutoff++;

          RECOVERY_DIAG_pushSample_(
            result.samples.exceptions,
            {
              type:
                "Skipped Round",
              date:
                RECOVERY_DIAG_dateKey_(
                  rawRecord.dateObj
                ),
              candidate:
                rawRecord.candidate || "",
              client:
                rawRecord.client || "",
              round:
                rawRecord.round || "",
              possiblePreviousRound:
                skipped.match
                  ? skipped.match.round || ""
                  : ""
            }
          );

        }else{

          counts
            .noSafeTeamMatchAfterCutoff++;

          RECOVERY_DIAG_pushSample_(
            result.samples.noSafeTeamMatch,
            {
              date:
                RECOVERY_DIAG_dateKey_(
                  rawRecord.dateObj
                ),
              candidate:
                rawRecord.candidate || "",
              client:
                rawRecord.client || "",
              round:
                rawRecord.round || ""
            }
          );

        }

        return;
      }


      const teamRecord =
        matchResult.match;


      if(
        REC_isAlreadyTracked(
          teamRecord,
          rawRecord,
          trackerRecords
        )
      ){

        counts
          .alreadyTrackedAfterCutoff++;

        return;
      }


      const amount =
        REC_getPromotionAmount(
          teamRecord,
          rawRecord
        );


      if(
        Number(amount || 0) <= 0
      ){

        counts
          .invalidAmountAfterCutoff++;

        return;
      }


      counts
        .eligibleRecoveryAfterCutoff++;


      RECOVERY_DIAG_pushSample_(
        result.samples.eligibleRecoveries,
        {
          date:
            RECOVERY_DIAG_dateKey_(
              rawRecord.dateObj
            ),
          candidate:
            rawRecord.candidate || "",
          rawClient:
            rawRecord.client || "",
          currentRound:
            rawRecord.round || "",
          teamCandidate:
            teamRecord.candidate || "",
          teamClient:
            teamRecord.client || "",
          previousRound:
            teamRecord.round || "",
          handler:
            teamRecord.handler || "",
          candidateScore:
            matchResult.candidateScore,
          clientScore:
            matchResult.clientScore,
          confidence:
            matchResult.confidence,
          amount:
            Number(amount || 0)
        }
      );

    }
  );


  Object.keys(counts)
    .forEach(
      function(key){
        result.counts[key] =
          counts[key];
      }
    );


  //--------------------------------------------------
  // INTERPRETATION
  //--------------------------------------------------

  result.interpretation = [];


  if(
    result.routing
      .recoveryLoaderSource ===
        "PRIVATE_ACTIVE_RAW_LOOKUP"
  ){

    result.interpretation.push(
      "WARNING: REC_loadRawDataForRecovery appears to use SpreadsheetApp.getActive() for Raw Data. In the private-backend architecture Raw Data should be read through IR_operations_()."
    );

  }


  if(
    result.dates.latestRawDate &&
    result.dates.latestRecoveryPromotionDate &&
    result.dates.latestRawDate >
      result.dates.latestRecoveryPromotionDate
  ){

    result.interpretation.push(
      "Raw Data is newer than Promotion Recovery, so the Recovery sheet is stale unless there were zero eligible recovery/exception cases."
    );

  }


  if(
    counts.eligibleRecoveryAfterCutoff > 0
  ){

    result.interpretation.push(
      counts.eligibleRecoveryAfterCutoff +
      " recovery candidate(s) after 11-Aug-2026 would be written if recoverMissedPromotions() runs successfully."
    );

  }


  const exceptionCount =
    counts.ambiguousWouldReviewAfterCutoff +
    counts.skippedRoundWouldReviewAfterCutoff;


  if(exceptionCount > 0){

    result.interpretation.push(
      exceptionCount +
      " post-11-Aug case(s) would go to Recovery Exceptions / Review."
    );

  }


  if(
    counts.eligibleRecoveryAfterCutoff === 0 &&
    exceptionCount === 0
  ){

    result.interpretation.push(
      "The simulation found no new post-11-Aug recovery or exception rows under the current matching rules."
    );

  }


  result.ok =
    result.errors.length === 0;


  RECOVERY_DIAG_log_(
    result
  );


  return result;

}


/******************************************************
 * IDENTIFY RAW LOADER ROUTING FROM CURRENT FUNCTION
 ******************************************************/
function RECOVERY_DIAG_loaderRouting_(){

  if(
    typeof REC_loadRawDataForRecovery !==
      "function"
  ){
    return "MISSING";
  }


  let source = "";

  try{

    source =
      String(
        REC_loadRawDataForRecovery
      );

  }catch(error){

    return "UNKNOWN";

  }


  if(
    source.indexOf(
      "IR_operations_"
    ) > -1
  ){
    return "SHARED_OPERATIONS_ROUTING";
  }


  if(
    source.indexOf(
      "SpreadsheetApp"
    ) > -1 &&
    source.indexOf(
      "getActive"
    ) > -1
  ){
    return "PRIVATE_ACTIVE_RAW_LOOKUP";
  }


  return "UNKNOWN";

}


/******************************************************
 * LATEST RECORD DATE
 ******************************************************/
function RECOVERY_DIAG_latestRecordDate_(
  records
){

  let latest = null;


  (records || [])
    .forEach(
      function(record){

        const date =
          record &&
          record.dateObj instanceof Date &&
          !isNaN(
            record.dateObj.getTime()
          )
            ? record.dateObj
            : null;


        if(
          date &&
          (
            !latest ||
            date > latest
          )
        ){
          latest =
            date;
        }

      }
    );


  return latest
    ? RECOVERY_DIAG_dateKey_(
        latest
      )
    : "";

}


/******************************************************
 * LATEST DATE FROM SHEET HEADER
 ******************************************************/
function RECOVERY_DIAG_latestSheetDateByHeader_(
  ss,
  sheetName,
  headerName
){

  const sheet =
    ss.getSheetByName(
      sheetName
    );


  if(
    !sheet ||
    sheet.getLastRow() <= 1
  ){
    return "";
  }


  const values =
    sheet
      .getDataRange()
      .getValues();


  const headers =
    values[0]
      .map(
        function(value){
          return String(
            value || ""
          ).trim();
        }
      );


  const col =
    headers.indexOf(
      headerName
    );


  if(col < 0){
    return "";
  }


  let latest = null;


  for(
    let i = 1;
    i < values.length;
    i++
  ){

    const raw =
      values[i][col];


    let date = null;


    if(
      raw instanceof Date &&
      !isNaN(raw.getTime())
    ){

      date =
        raw;

    }else if(raw){

      const parsed =
        new Date(raw);

      if(
        !isNaN(
          parsed.getTime()
        )
      ){
        date =
          parsed;
      }

    }


    if(
      date &&
      (
        !latest ||
        date > latest
      )
    ){
      latest =
        date;
    }

  }


  return latest
    ? RECOVERY_DIAG_dateKey_(
        latest
      )
    : "";

}


/******************************************************
 * DATE KEY
 ******************************************************/
function RECOVERY_DIAG_dateKey_(
  value
){

  if(
    !(value instanceof Date) ||
    isNaN(value.getTime())
  ){
    return "";
  }


  return Utilities
    .formatDate(
      value,
      Session.getScriptTimeZone(),
      "yyyy-MM-dd"
    );

}


/******************************************************
 * CAP SAMPLE SIZE
 ******************************************************/
function RECOVERY_DIAG_pushSample_(
  list,
  item
){

  if(
    list.length < 10
  ){
    list.push(
      item
    );
  }

}


/******************************************************
 * LOG
 ******************************************************/
function RECOVERY_DIAG_log_(
  result
){

  Logger.log(
    "========== RECOVERY READ-ONLY DIAGNOSTIC =========="
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

}
