/******************************************************
 * RECOVERY ENGINE
 * Clean Rebuild - Version 1.1
 *
 * Purpose:
 * Recover promotions missed by the normal incentive
 * engine because candidate/client text differs between
 * Team Data and later Raw Data.
 *
 * IMPORTANT:
 * - Does NOT modify the 7 working core files.
 * - Raw Data proves that a higher round occurred.
 * - Team Data proves that our team handled the prior round.
 * - Handler ALWAYS comes from Team Data.
 * - Nothing is added directly to Incentive Tracker here.
 * - Recovery results are written as Pending for review.
 * - Meaningful unsafe cases are written to Recovery Exceptions.
 ******************************************************/


/******************************************************
 * RECOVERY SETTINGS
 ******************************************************/
const REC_SETTINGS = {

  SHEET_NAME: "Promotion Recovery",
  EXCEPTIONS_SHEET_NAME: "Recovery Exceptions",

  // Minimum component scores.
  MIN_CANDIDATE_SCORE: 90,
  MIN_CLIENT_SCORE: 88,

  // Exceptions are intentionally selective. These
  // thresholds prevent unrelated other-team Raw records
  // from flooding the exception sheet.
  EXCEPTION_MIN_CANDIDATE_SCORE: 92,
  EXCEPTION_MIN_CLIENT_SCORE: 88,

  // Overall threshold. Uses CONFIG.RECOVERY.MIN_CONFIDENCE
  // when available; otherwise falls back to 95.
  DEFAULT_MIN_CONFIDENCE: 95,

  // If two different Team Data records are almost equally
  // good matches, do not guess.
  AMBIGUITY_MARGIN: 3,

  // Final-round promotions use the normal promotion amount.
  // Change this one rule later if your business rule differs.
  FINAL_PROMOTION_AMOUNT: 500
};


/******************************************************
 * MAIN RECOVERY FUNCTION
 ******************************************************/
function recoverMissedPromotions(){

  Logger.log("========== RECOVERY START ==========");

  const rawRecords =
  REC_loadRawDataForRecovery();
  const teamRecords = loadTeamData();

const trackerRecords = REC_loadTrackerPromotions();

const teamIndex =
  REC_buildTeamRoundIndex(teamRecords);

// Includes VALID and INVALID handlers.
// Used only to detect Rescheduled / Cancelled / Support.
const currentOccurrenceIndex =
  REC_buildCurrentOccurrenceIndex(teamRecords);

  const existingRecoveryStatuses =
    REC_loadExistingRecoveryStatuses();

  const existingExceptionStatuses =
    REC_loadExistingExceptionStatuses();

  const results = [];
  const exceptions = [];

  const seenRecoveryIds = {};
  const seenExceptionIds = {};

  let higherRoundRawCount = 0;
  let rejectedNoTeamMatch = 0;
  let rejectedAlreadyTracked = 0;
  let ambiguousExceptions = 0;
  let skippedRoundExceptions = 0;
  let ignoredInvalidCurrentOccurrence = 0;

  rawRecords.forEach(function(rawRecord){

if(!REC_isPromotionEvidence(rawRecord))
  return;

higherRoundRawCount++;


//------------------------------------------------
// CURRENT ROUND OCCURRENCE CHECK
//
// If Team Data explicitly says this exact
// higher-round occurrence was:
//   Rescheduled
//   Cancelled
//   Canceled
//   Support
//   blank handler
//
// then this Raw record must NOT be used as proof
// that a promotion actually occurred.
//
// IMPORTANT:
// If there is NO matching current-round Team row,
// we continue normally because the next round may
// have been handled by another team.
//------------------------------------------------

const occurrenceCheck =
  REC_checkCurrentOccurrence(
    rawRecord,
    currentOccurrenceIndex
  );


if(occurrenceCheck.blocked){

  ignoredInvalidCurrentOccurrence++;

  Logger.log(

    "Ignored invalid Raw occurrence: " +

    rawRecord.candidate +
    " | " +

    rawRecord.client +
    " | " +

    rawRecord.round +
    " | " +

    REC_dateKey(rawRecord.dateObj) +
    " | Team Handler = " +

    occurrenceCheck.handler

  );

  return;
}


const matchResult =
  REC_findBestTeamMatch(
    rawRecord,
    teamIndex
  );

    //------------------------------------------------
    // Ambiguous correct-round Team match.
    // Do not guess the handler; send for review.
    //------------------------------------------------

    if(
      matchResult &&
      !matchResult.match &&
      matchResult.reason === "ambiguous"
    ){

      const exception = REC_buildAmbiguousException(
        rawRecord,
        matchResult,
        existingExceptionStatuses
      );

      if(exception && !seenExceptionIds[exception.exceptionId]){
        seenExceptionIds[exception.exceptionId] = true;
        exceptions.push(exception);
        ambiguousExceptions++;
      }

      return;
    }

    //------------------------------------------------
    // No safe correct-previous-round match.
    // Check whether a strong lower-round Team record
    // exists (e.g. Team 1st, Raw 3rd).
    //------------------------------------------------

    if(!matchResult || !matchResult.match){

const skipped = REC_findSkippedRoundEvidence(
  rawRecord,
  teamIndex,
  rawRecords,
  currentOccurrenceIndex
);

      if(skipped){

        const exception = REC_buildSkippedRoundException(
          rawRecord,
          skipped,
          existingExceptionStatuses
        );

        if(exception && !seenExceptionIds[exception.exceptionId]){
          seenExceptionIds[exception.exceptionId] = true;
          exceptions.push(exception);
          skippedRoundExceptions++;
        }

      }else{
        rejectedNoTeamMatch++;
      }

      return;
    }

    const teamRecord = matchResult.match;

    //------------------------------------------------
    // Existing Tracker ALWAYS wins.
    //------------------------------------------------

    if(
      REC_isAlreadyTracked(
        teamRecord,
        rawRecord,
        trackerRecords
      )
    ){

      rejectedAlreadyTracked++;
      return;
    }

    const amount = REC_getPromotionAmount(
      teamRecord,
      rawRecord
    );

    if(amount <= 0)
      return;

    const recoveryId = REC_buildRecoveryId(
      teamRecord,
      rawRecord
    );

    if(seenRecoveryIds[recoveryId])
      return;

    seenRecoveryIds[recoveryId] = true;

    const preservedStatus =
      existingRecoveryStatuses[recoveryId] || "Pending";

    results.push({

      recoveryId: recoveryId,

      candidate: teamRecord.candidate,

      previousRound: teamRecord.round,
      currentRound: rawRecord.round,

      teamClient: teamRecord.client,
      rawClient: rawRecord.client,

      teamDate: teamRecord.dateObj,
      promotionDate: rawRecord.dateObj,

      candidateScore: matchResult.candidateScore,
      clientScore: matchResult.clientScore,
      confidence: matchResult.confidence,

      handler: teamRecord.handler,
      amount: amount,

      status: preservedStatus,

      reason: REC_buildMatchReason(matchResult)

    });

  });

  REC_writeRecoveryResults(results);
  REC_writeRecoveryExceptions(exceptions);

  //--------------------------------------------------
// RECOVERY EVIDENCE + CLICKABLE IDS
//--------------------------------------------------

try{

  REC_refreshRecoveryEvidence();

}catch(error){

  Logger.log(
    "Recovery Evidence Error : " +
    error.message
  );

}

  Logger.log("Raw Records : " + rawRecords.length);
  Logger.log("Team Records : " + teamRecords.length);
  Logger.log("Higher-Round Raw Records : " + higherRoundRawCount);
  Logger.log("Recovery Results : " + results.length);
  Logger.log("No Team Match : " + rejectedNoTeamMatch);
  Logger.log("Ambiguous Matches Sent To Exceptions : " + ambiguousExceptions);
  Logger.log("Skipped-Round Exceptions : " + skippedRoundExceptions);
  Logger.log("Recovery Exceptions : " + exceptions.length);
  Logger.log(
  "Invalid/Rescheduled Raw Occurrences Ignored : " +
  ignoredInvalidCurrentOccurrence
);
  Logger.log("Already Tracked : " + rejectedAlreadyTracked);
  Logger.log("========== RECOVERY COMPLETE ==========");

}


/******************************************************
 * RAW RECORD = PROMOTION EVIDENCE?
 *
 * Numbered rounds:
 *   2nd, 3rd, 4th, 5th
 *
 * Final:
 *   supported as a special higher-round event.
 ******************************************************/
function REC_isPromotionEvidence(record){

  if(!record)
    return false;

  if(!record.candidate || !record.client)
    return false;

  if(!(record.dateObj instanceof Date))
    return false;

  const roundNo = Number(record.roundNo) || 0;

  if(roundNo >= 2 && roundNo <= 5)
    return true;

  if(roundNo === 999)
    return true;

  return false;

}


/******************************************************
 * BUILD TEAM INDEX BY ROUND NUMBER
 ******************************************************/
function REC_buildTeamRoundIndex(teamRecords){

  const index = {};

  teamRecords.forEach(function(record){

    if(!record)
      return;

    if(!REC_hasValidHandler(record.handler))
      return;

    if(!(record.dateObj instanceof Date))
      return;

    const roundNo = Number(record.roundNo) || 0;

    if(roundNo < 1 || roundNo > 5)
      return;

    if(!index[roundNo])
      index[roundNo] = [];

    index[roundNo].push(record);

  });

  return index;

}

/******************************************************
 * BUILD CURRENT OCCURRENCE INDEX
 *
 * Unlike REC_buildTeamRoundIndex(), this index keeps
 * ALL Team Data records, including:
 *
 * Rescheduled
 * Cancelled
 * Canceled
 * Support
 * blank handler
 *
 * because those values are exactly what we need to
 * detect invalid Raw promotion evidence.
 ******************************************************/
function REC_buildCurrentOccurrenceIndex(teamRecords){

  const index = {};


  teamRecords.forEach(function(record){

    if(!record)
      return;

    if(!(record.dateObj instanceof Date))
      return;

    const roundNo =
      Number(record.roundNo) || 0;

    if(roundNo <= 0)
      return;


    const dateKey =
      REC_dateKey(
        record.dateObj
      );


    if(!dateKey)
      return;


    const key =
      roundNo +
      "|" +
      dateKey;


    if(!index[key]){

      index[key] = [];

    }


    index[key].push(
      record
    );

  });


  return index;

}


/******************************************************
 * CHECK CURRENT RAW OCCURRENCE
 *
 * PURPOSE:
 *
 * Determine whether Team Data explicitly says that
 * this SAME current-round Raw interview occurrence
 * did not actually happen.
 *
 * This function does NOT determine who receives the
 * incentive.
 *
 * Promotion ownership still comes from the previous
 * qualifying Team Data round.
 ******************************************************/
function REC_checkCurrentOccurrence(
  rawRecord,
  occurrenceIndex
){

  const roundNo =
    Number(rawRecord.roundNo) || 0;


  const dateKey =
    REC_dateKey(
      rawRecord.dateObj
    );


  if(
    roundNo <= 0 ||
    !dateKey
  ){

    return {
      blocked: false,
      found: false,
      handler: ""
    };

  }


  const key =
    roundNo +
    "|" +
    dateKey;


  const pool =
    occurrenceIndex[key] || [];


  if(pool.length === 0){

    // Could have been handled by another team.
    // Do NOT block recovery.
    return {
      blocked: false,
      found: false,
      handler: ""
    };

  }


  const strongMatches = [];


  pool.forEach(function(teamRecord){

    //----------------------------------------------
    // Candidate
    //----------------------------------------------

    const candidateScore =
      REC_candidateScore(
        teamRecord.candidate,
        rawRecord.candidate
      );


    if(
      candidateScore <
      REC_SETTINGS.MIN_CANDIDATE_SCORE
    ){

      return;

    }


    //----------------------------------------------
    // Client
    //----------------------------------------------

    const clientScore =
      REC_clientScore(
        teamRecord.client,
        rawRecord.client
      );


    if(
      clientScore <
      REC_SETTINGS.MIN_CLIENT_SCORE
    ){

      return;

    }


    //----------------------------------------------
    // Round + date are already exact here.
    //----------------------------------------------

    const confidence =
      REC_calculateConfidence(
        candidateScore,
        clientScore,
        100,
        100
      );


    if(
      confidence <
      REC_getMinimumConfidence()
    ){

      return;

    }


    strongMatches.push({

      record:
        teamRecord,

      candidateScore:
        candidateScore,

      clientScore:
        clientScore,

      confidence:
        confidence

    });

  });


  //--------------------------------------------------
  // No credible Team occurrence found.
  //
  // Do not block because another team may have
  // handled this Raw interview.
  //--------------------------------------------------

  if(strongMatches.length === 0){

    return {
      blocked: false,
      found: false,
      handler: ""
    };

  }


  //--------------------------------------------------
  // If ANY strong Team record has a real handler,
  // consider the interview occurrence valid.
  //--------------------------------------------------

  const validMatch =
    strongMatches.find(function(item){

      return REC_hasValidHandler(
        item.record.handler
      );

    });


  if(validMatch){

    return {

      blocked: false,

      found: true,

      handler:
        String(
          validMatch.record.handler || ""
        ).trim()

    };

  }


  //--------------------------------------------------
  // Strong Team match exists, but every matching row
  // has an invalid handler.
  //
  // Therefore this Raw occurrence should NOT prove
  // promotion.
  //--------------------------------------------------

  const invalidHandler =
    String(
      strongMatches[0].record.handler || ""
    ).trim();


  return {

    blocked: true,

    found: true,

    handler:
      invalidHandler || "(blank)"

  };

}

/******************************************************
 * FIND BEST TEAM DATA MATCH
 *
 * Raw Data is the promotion evidence.
 * Team Data must contain the qualifying previous round.
 ******************************************************/
function REC_findBestTeamMatch(rawRecord, teamIndex){

  const rawRoundNo = Number(rawRecord.roundNo) || 0;

  let pools = [];

  //--------------------------------------------------
  // Numbered promotion: exact previous round required
  //--------------------------------------------------

  if(rawRoundNo >= 2 && rawRoundNo <= 5){

    const previousRoundNo = rawRoundNo - 1;

    pools = (teamIndex[previousRoundNo] || []).slice();

  }

  //--------------------------------------------------
  // Final round:
  // Search prior numbered rounds and prefer the
  // highest valid round handled by our team.
  //--------------------------------------------------

  else if(rawRoundNo === 999){

    for(let roundNo = 5; roundNo >= 1; roundNo--){

      const roundPool = teamIndex[roundNo] || [];

      if(roundPool.length){
        pools = pools.concat(roundPool);
      }

    }

  }

  if(pools.length === 0)
    return null;

  const candidates = [];

  pools.forEach(function(teamRecord){

    //------------------------------------------------
    // Final must be after a numbered Team round.
    // Numbered rounds already came from exact prior pool.
    //------------------------------------------------

    if(
      rawRoundNo === 999 &&
      (Number(teamRecord.roundNo) < 1 || Number(teamRecord.roundNo) > 5)
    ){
      return;
    }

    const chronology = REC_compareChronology(
      teamRecord,
      rawRecord
    );

    if(!chronology.valid)
      return;

    const candidateScore = REC_candidateScore(
      teamRecord.candidate,
      rawRecord.candidate
    );

    if(candidateScore < REC_SETTINGS.MIN_CANDIDATE_SCORE)
      return;

    const clientScore = REC_clientScore(
      teamRecord.client,
      rawRecord.client
    );

    if(clientScore < REC_SETTINGS.MIN_CLIENT_SCORE)
      return;

    const roundScore = 100;

    const confidence = REC_calculateConfidence(
      candidateScore,
      clientScore,
      roundScore,
      chronology.dateScore
    );

    if(confidence < REC_getMinimumConfidence())
      return;

    candidates.push({

      match: teamRecord,

      candidateScore: candidateScore,
      clientScore: clientScore,
      dateScore: chronology.dateScore,
      confidence: confidence,

      teamTimestamp: chronology.teamTimestamp,
      rawTimestamp: chronology.rawTimestamp

    });

  });

  if(candidates.length === 0)
    return null;

  //--------------------------------------------------
  // Ranking
  // 1. Final: prefer highest previous round first.
  // 2. Higher confidence.
  // 3. Closest prior interview in time.
  //--------------------------------------------------

  candidates.sort(function(a,b){

    if(rawRoundNo === 999){

      const roundDifference =
        Number(b.match.roundNo) - Number(a.match.roundNo);

      if(roundDifference !== 0)
        return roundDifference;

    }

    if(b.confidence !== a.confidence)
      return b.confidence - a.confidence;

    const aGap = Math.abs(a.rawTimestamp - a.teamTimestamp);
    const bGap = Math.abs(b.rawTimestamp - b.teamTimestamp);

    return aGap - bGap;

  });

  const best = candidates[0];

  //--------------------------------------------------
  // Ambiguity protection
  //--------------------------------------------------

  if(candidates.length > 1){

    const second = candidates[1];

    const differentHandler =
      REC_normalizeHandler(best.match.handler) !==
      REC_normalizeHandler(second.match.handler);

    const differentTeamEvent =
      REC_dateKey(best.match.dateObj) !==
      REC_dateKey(second.match.dateObj) ||
      Number(best.match.roundNo) !== Number(second.match.roundNo);

    if(
      (differentHandler || differentTeamEvent) &&
      Math.abs(best.confidence - second.confidence) <=
        REC_SETTINGS.AMBIGUITY_MARGIN
    ){

      Logger.log(
        "Ambiguous recovery skipped: " +
        rawRecord.candidate + " | " +
        rawRecord.client + " | " +
        rawRecord.round
      );

      return {
        match: null,
        reason: "ambiguous",
        best: best,
        second: second
      };

    }

  }

  return best;

}


/******************************************************
 * FIND TRUE SKIPPED-ROUND EVIDENCE
 *
 * IMPORTANT BUSINESS RULE:
 *
 * Raw Data = complete round progression evidence.
 * Team Data = our-team handler ownership evidence.
 *
 * Therefore:
 *
 * Raw:  1st -> 2nd -> 3rd
 * Team: 1st only
 *
 * is NOT a skipped round.
 *
 * The missing Team 2nd means the 2nd round may have
 * been handled by another team.
 *
 * A Skipped Round exception is created only when the
 * expected intermediate round is also absent from Raw.
 ******************************************************/
function REC_findSkippedRoundEvidence(
  rawRecord,
  teamIndex,
  rawRecords,
  currentOccurrenceIndex
){

  const rawRoundNo =
    Number(rawRecord.roundNo) || 0;


  //--------------------------------------------------
  // Numbered rounds only.
  //--------------------------------------------------

  if(
    rawRoundNo < 3 ||
    rawRoundNo > 5
  ){
    return null;
  }


  const expectedPreviousRoundNo =
    rawRoundNo - 1;


  //--------------------------------------------------
  // FIRST:
  // Check Raw Data for the expected intermediate
  // round.
  //
  // Example:
  // Current Raw = 3rd
  // Expected Raw = 2nd
  //--------------------------------------------------

  const rawIntermediate =
    REC_findRawIntermediateRound(
      rawRecord,
      expectedPreviousRoundNo,
      rawRecords,
      currentOccurrenceIndex
    );


  //--------------------------------------------------
  // Raw contains the expected round.
  //
  // Therefore progression is complete.
  //
  // Its absence from Team Data only means our team
  // did not own that round.
  //
  // NOT an exception.
  //--------------------------------------------------

  if(rawIntermediate){

    Logger.log(
      "Skipped-round exception suppressed: " +
      rawRecord.candidate +
      " | " +
      rawRecord.client +
      " | Raw progression contains " +
      REC_roundLabel(
        expectedPreviousRoundNo
      ) +
      " before " +
      rawRecord.round
    );

    return null;
  }


  //--------------------------------------------------
  // Expected intermediate round does NOT exist in
  // Raw Data.
  //
  // Now look for a strong earlier Team record.
  //--------------------------------------------------

  const candidates = [];


  for(
    let roundNo =
      expectedPreviousRoundNo - 1;

    roundNo >= 1;

    roundNo--
  ){

    const pool =
      teamIndex[roundNo] || [];


    pool.forEach(
      function(teamRecord){

        const chronology =
          REC_compareChronology(
            teamRecord,
            rawRecord
          );


        if(!chronology.valid){
          return;
        }


        const candidateScore =
          REC_candidateScore(
            teamRecord.candidate,
            rawRecord.candidate
          );


        if(
          candidateScore <
          REC_SETTINGS.EXCEPTION_MIN_CANDIDATE_SCORE
        ){
          return;
        }


        const clientScore =
          REC_clientScore(
            teamRecord.client,
            rawRecord.client
          );


        if(
          clientScore <
          REC_SETTINGS.EXCEPTION_MIN_CLIENT_SCORE
        ){
          return;
        }


        candidates.push({

          match:
            teamRecord,

          candidateScore:
            candidateScore,

          clientScore:
            clientScore,

          dateScore:
            chronology.dateScore,

          teamTimestamp:
            chronology.teamTimestamp,

          rawTimestamp:
            chronology.rawTimestamp

        });

      }
    );

  }


  if(
    candidates.length === 0
  ){
    return null;
  }


  candidates.sort(
    function(a,b){

      //------------------------------------------------
      // Prefer highest earlier Team round.
      //------------------------------------------------

      const roundDifference =
        Number(b.match.roundNo) -
        Number(a.match.roundNo);


      if(roundDifference !== 0){
        return roundDifference;
      }


      //------------------------------------------------
      // Strongest identity.
      //------------------------------------------------

      const aScore =
        a.candidateScore +
        a.clientScore;

      const bScore =
        b.candidateScore +
        b.clientScore;


      if(bScore !== aScore){
        return bScore - aScore;
      }


      //------------------------------------------------
      // Closest earlier occurrence.
      //------------------------------------------------

      const aGap =
        Math.abs(
          a.rawTimestamp -
          a.teamTimestamp
        );

      const bGap =
        Math.abs(
          b.rawTimestamp -
          b.teamTimestamp
        );


      return aGap - bGap;

    }
  );


  return candidates[0];

}
/******************************************************
 * FIND EXPECTED INTERMEDIATE ROUND IN RAW DATA
 *
 * Example:
 *
 * Current Raw:
 *   Candidate X / Client Y / 3rd Round
 *
 * Search Raw for:
 *   Candidate X / Client Y / 2nd Round
 *
 * The intermediate occurrence must:
 *
 * - match candidate
 * - match client
 * - be the exact expected round
 * - occur before current Raw round
 * - not be explicitly blocked in Team Data as
 *   Rescheduled / Cancelled / Support / blank
 ******************************************************/
function REC_findRawIntermediateRound(
  currentRawRecord,
  expectedRoundNo,
  rawRecords,
  currentOccurrenceIndex
){

  if(
    !Array.isArray(rawRecords) ||
    !rawRecords.length
  ){
    return null;
  }


  const matches = [];


  rawRecords.forEach(
    function(rawRecord){

      if(!rawRecord){
        return;
      }


      //------------------------------------------------
      // Exact expected round
      //------------------------------------------------

      if(
        Number(rawRecord.roundNo) !==
        Number(expectedRoundNo)
      ){
        return;
      }


      //------------------------------------------------
      // Must be before the current higher round
      //------------------------------------------------

      const chronology =
        REC_compareChronology(
          rawRecord,
          currentRawRecord
        );


      if(!chronology.valid){
        return;
      }


      //------------------------------------------------
      // Candidate identity
      //------------------------------------------------

      const candidateScore =
        REC_candidateScore(
          rawRecord.candidate,
          currentRawRecord.candidate
        );


      if(
        candidateScore <
        REC_SETTINGS.MIN_CANDIDATE_SCORE
      ){
        return;
      }


      //------------------------------------------------
      // Client identity
      //------------------------------------------------

      const clientScore =
        REC_clientScore(
          rawRecord.client,
          currentRawRecord.client
        );


      if(
        clientScore <
        REC_SETTINGS.MIN_CLIENT_SCORE
      ){
        return;
      }


      //------------------------------------------------
      // If OUR Team Data explicitly says this exact
      // Raw occurrence was Rescheduled / Cancelled /
      // Support / blank, do not treat it as proof that
      // the intermediate interview occurred.
      //
      // No Team match = other team is possible = valid.
      //------------------------------------------------

      const occurrenceCheck =
        REC_checkCurrentOccurrence(
          rawRecord,
          currentOccurrenceIndex
        );


      if(occurrenceCheck.blocked){
        return;
      }


      matches.push({

        record:
          rawRecord,

        candidateScore:
          candidateScore,

        clientScore:
          clientScore,

        timestamp:
          chronology.teamTimestamp

      });

    }
  );


  if(!matches.length){
    return null;
  }


  //--------------------------------------------------
  // Prefer strongest identity match.
  //--------------------------------------------------

  matches.sort(
    function(a,b){

      const aScore =
        a.candidateScore +
        a.clientScore;

      const bScore =
        b.candidateScore +
        b.clientScore;


      if(bScore !== aScore){
        return bScore - aScore;
      }


      //------------------------------------------------
      // If multiple scheduled occurrences exist,
      // prefer the latest valid occurrence before
      // the current round.
      //------------------------------------------------

      return (
        b.timestamp -
        a.timestamp
      );

    }
  );


  return matches[0].record;

}
/******************************************************
 * BUILD AMBIGUOUS EXCEPTION
 ******************************************************/
function REC_buildAmbiguousException(
  rawRecord,
  matchResult,
  existingStatuses
){

  if(!matchResult || !matchResult.best || !matchResult.second)
    return null;

  const best = matchResult.best;
  const second = matchResult.second;

  const exceptionId = REC_buildExceptionId(
    "AMBIGUOUS",
    rawRecord,
    best.match,
    second.match
  );

  const handlers = REC_uniqueNonBlank([
    best.match.handler,
    second.match.handler
  ]).join(" / ");

  return {
    exceptionId: exceptionId,
    candidate: rawRecord.candidate,
    rawClient: rawRecord.client,
    rawRound: rawRecord.round,
    promotionDate: rawRecord.dateObj,
    teamCandidate: best.match.candidate,
    teamClient: best.match.client,
    teamRound: best.match.round,
    teamDate: best.match.dateObj,
    handler: handlers,
    candidateScore: best.candidateScore,
    clientScore: best.clientScore,
    issueType: "Ambiguous Team Match",
    reason:
      "Two Team Data records are nearly equally strong matches. " +
      "Best: " + best.match.candidate + " / " + best.match.client +
      " / " + best.match.round + " / " + (best.match.handler || "") +
      "; Second: " + second.match.candidate + " / " + second.match.client +
      " / " + second.match.round + " / " + (second.match.handler || "") +
      ". The system did not guess the handler.",
    status: existingStatuses[exceptionId] || "Review"
  };

}


/******************************************************
 * BUILD SKIPPED-ROUND EXCEPTION
 ******************************************************/
function REC_buildSkippedRoundException(
  rawRecord,
  skipped,
  existingStatuses
){

  if(!skipped || !skipped.match)
    return null;

  const teamRecord = skipped.match;
  const expectedPreviousRoundNo = (Number(rawRecord.roundNo) || 0) - 1;

  const exceptionId = REC_buildExceptionId(
    "SKIPPED",
    rawRecord,
    teamRecord,
    null
  );

  return {
    exceptionId: exceptionId,
    candidate: rawRecord.candidate,
    rawClient: rawRecord.client,
    rawRound: rawRecord.round,
    promotionDate: rawRecord.dateObj,
    teamCandidate: teamRecord.candidate,
    teamClient: teamRecord.client,
    teamRound: teamRecord.round,
    teamDate: teamRecord.dateObj,
    handler: teamRecord.handler,
    candidateScore: skipped.candidateScore,
    clientScore: skipped.clientScore,
    issueType: "Skipped Round",
    reason:
      "Raw Data shows " + rawRecord.round +
      ", so the expected Team Data previous round is " +
      REC_roundLabel(expectedPreviousRoundNo) +
      ". No safe match was found for that expected round, " +
      "but a strong earlier Team Data record was found at " +
      teamRecord.round + ". No incentive was created.",
    status: existingStatuses[exceptionId] || "Review"
  };

}


/******************************************************
 * EXCEPTION ID
 ******************************************************/
function REC_buildExceptionId(type, rawRecord, teamRecord1, teamRecord2){

  const parts = [
    String(type || ""),
    REC_normalizeCandidate(rawRecord && rawRecord.candidate),
    REC_normalizeClient(rawRecord && rawRecord.client),
    Number(rawRecord && rawRecord.roundNo) || 0,
    REC_dateKey(rawRecord && rawRecord.dateObj)
  ];

  [teamRecord1, teamRecord2].forEach(function(teamRecord){

    if(!teamRecord)
      return;

    parts.push(
      REC_normalizeCandidate(teamRecord.candidate),
      REC_normalizeClient(teamRecord.client),
      Number(teamRecord.roundNo) || 0,
      REC_dateKey(teamRecord.dateObj),
      REC_normalizeHandler(teamRecord.handler)
    );

  });

  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    parts.join("|")
  );

  const hex = digest.map(function(byte){
    const value = byte < 0 ? byte + 256 : byte;
    return ("0" + value.toString(16)).slice(-2);
  }).join("");

  return "EXC-" + hex.substring(0,16).toUpperCase();

}


/******************************************************
 * ROUND LABEL
 ******************************************************/
function REC_roundLabel(roundNo){

  const n = Number(roundNo) || 0;

  if(n === 1) return "1st Round";
  if(n === 2) return "2nd Round";
  if(n === 3) return "3rd Round";
  if(n === 4) return "4th Round";
  if(n === 5) return "5th Round";
  if(n === 999) return "Final";

  return String(roundNo || "");

}


/******************************************************
 * UNIQUE NON-BLANK VALUES
 ******************************************************/
function REC_uniqueNonBlank(values){

  const seen = {};
  const output = [];

  (values || []).forEach(function(value){

    const text = String(value || "").trim();
    const key = text.toLowerCase();

    if(!text || seen[key])
      return;

    seen[key] = true;
    output.push(text);

  });

  return output;

}


/******************************************************
 * CANDIDATE SCORE
 ******************************************************/
function REC_candidateScore(name1, name2){

  const a = REC_normalizeCandidate(name1);
  const b = REC_normalizeCandidate(name2);

  if(!a || !b)
    return 0;

  if(a === b)
    return 100;

  const compactA = a.replace(/\s+/g, "");
  const compactB = b.replace(/\s+/g, "");

  if(compactA === compactB)
    return 100;

  //--------------------------------------------------
  // Ignore single-letter initials.
  //--------------------------------------------------

  const noInitialA = REC_removeSingleLetterTokens(a);
  const noInitialB = REC_removeSingleLetterTokens(b);

  if(
    noInitialA &&
    noInitialB &&
    noInitialA.replace(/\s+/g, "") ===
      noInitialB.replace(/\s+/g, "")
  ){
    return 98;
  }

  //--------------------------------------------------
  // Initial can stand for a full token:
  // Rakesh K <-> Rakesh Kumar
  //--------------------------------------------------

  if(REC_initialCompatibleNames(a,b))
    return 96;

  const score1 = REC_stringSimilarity(compactA, compactB);

  const score2 = REC_stringSimilarity(
    noInitialA.replace(/\s+/g, ""),
    noInitialB.replace(/\s+/g, "")
  );

  return Math.round(Math.max(score1, score2));

}


/******************************************************
 * CLIENT SCORE
 ******************************************************/
function REC_clientScore(client1, client2){

  const a = REC_normalizeClient(client1);
  const b = REC_normalizeClient(client2);

  if(!a || !b)
    return 0;

  if(a === b)
    return 100;

  const compactA = a.replace(/\s+/g, "");
  const compactB = b.replace(/\s+/g, "");

  if(compactA === compactB)
    return 100;

  const simpleA = REC_simplifyCompany(a);
  const simpleB = REC_simplifyCompany(b);

  if(simpleA && simpleA === simpleB)
    return 100;

  //--------------------------------------------------
  // One company name may contain the meaningful core
  // of the other, e.g. Alten Technology <-> Alten.
  //--------------------------------------------------

  if(
    simpleA.length >= 4 &&
    simpleB.length >= 4 &&
    (
      simpleA.indexOf(simpleB) > -1 ||
      simpleB.indexOf(simpleA) > -1
    )
  ){

    const shorter = Math.min(simpleA.length, simpleB.length);
    const longer = Math.max(simpleA.length, simpleB.length);

    if(shorter / longer >= 0.50)
      return 98;

  }

  //--------------------------------------------------
  // Typo tolerance, e.g. BlueSpring <-> Bluesprig.
  //--------------------------------------------------

  const score = REC_stringSimilarity(simpleA, simpleB);

  return Math.round(score);

}


/******************************************************
 * NORMALIZE CANDIDATE
 *
 * Uses approved Candidate Alias first when available,
 * then applies recovery-specific cleanup.
 ******************************************************/
function REC_normalizeCandidate(name){

  let value = String(name || "");

  // Remove country/notes BEFORE calling the existing
  // alias normalizer, because normalizeText() removes
  // brackets but intentionally keeps their contents.
  value = value.replace(/\([^)]*\)/g, " ");

  if(typeof normalizeCandidate === "function"){

    try{
      value = normalizeCandidate(value);
    }catch(error){
      // Continue with local normalization.
    }

  }

  value = String(value || "").toLowerCase();

  value = value.replace(/[-–—]/g, " ");
  value = value.replace(/[.,'’`]/g, " ");

  value = value.replace(/[^a-z0-9\s]/g, " ");
  value = value.replace(/\s+/g, " ").trim();

  return value;

}


/******************************************************
 * NORMALIZE CLIENT
 *
 * Uses approved Client Alias first when available.
 ******************************************************/
function REC_normalizeClient(client){

  let value = String(client || "");

  // Remove parenthetical notes before approved-alias lookup.
  value = value.replace(/\([^)]*\)/g, " ");

  if(typeof normalizeClient === "function"){

    try{
      value = normalizeClient(value);
    }catch(error){
      // Continue with local normalization.
    }

  }

  value = String(value || "").toLowerCase();
  value = value.replace(/[-–—]/g, " ");
  value = value.replace(/[.,'’`&]/g, " ");
  value = value.replace(/[^a-z0-9\s]/g, " ");
  value = value.replace(/\s+/g, " ").trim();

  return value;

}


/******************************************************
 * SIMPLIFY COMPANY NAME
 ******************************************************/
function REC_simplifyCompany(name){

  let value = String(name || "").toLowerCase();

  const genericWords = [
    "the",
    "technology",
    "technologies",
    "tech",
    "solution",
    "solutions",
    "service",
    "services",
    "system",
    "systems",
    "limited",
    "ltd",
    "llc",
    "inc",
    "corporation",
    "corp",
    "company",
    "co",
    "private",
    "pvt",
    "holdings",
    "group"
  ];

  genericWords.forEach(function(word){

    const regex = new RegExp("\\b" + word + "\\b", "g");
    value = value.replace(regex, " ");

  });

  return value.replace(/\s+/g, "").trim();

}


/******************************************************
 * REMOVE SINGLE-LETTER TOKENS
 ******************************************************/
function REC_removeSingleLetterTokens(name){

  return String(name || "")
    .split(/\s+/)
    .filter(function(token){
      return token.length > 1;
    })
    .join(" ")
    .trim();

}


/******************************************************
 * INITIAL-COMPATIBLE NAMES
 *
 * Examples:
 * Rakesh K       <-> Rakesh Kumar
 * Venkata K Gopu <-> Venkata Kumar Gopu
 ******************************************************/
function REC_initialCompatibleNames(name1, name2){

  const a = String(name1 || "").split(/\s+/).filter(String);
  const b = String(name2 || "").split(/\s+/).filter(String);

  if(a.length !== b.length)
    return false;

  let fullTokenMatches = 0;

  for(let i=0;i<a.length;i++){

    if(a[i] === b[i]){

      if(a[i].length > 1)
        fullTokenMatches++;

      continue;
    }

    if(
      a[i].length === 1 &&
      b[i].length > 1 &&
      b[i].charAt(0) === a[i]
    ){
      continue;
    }

    if(
      b[i].length === 1 &&
      a[i].length > 1 &&
      a[i].charAt(0) === b[i]
    ){
      continue;
    }

    return false;

  }

  // Require at least one real full-name token match.
  return fullTokenMatches >= 1;

}


/******************************************************
 * CHARACTER SIMILARITY
 ******************************************************/
function REC_stringSimilarity(a,b){

  a = String(a || "");
  b = String(b || "");

  const maxLength = Math.max(a.length, b.length);

  if(maxLength === 0)
    return 100;

  const distance = REC_levenshteinDistance(a,b);

  return ((maxLength - distance) / maxLength) * 100;

}


/******************************************************
 * LEVENSHTEIN DISTANCE
 ******************************************************/
function REC_levenshteinDistance(a,b){

  const previous = [];
  const current = [];

  for(let j=0;j<=a.length;j++)
    previous[j] = j;

  for(let i=1;i<=b.length;i++){

    current[0] = i;

    for(let j=1;j<=a.length;j++){

      const cost = b.charAt(i-1) === a.charAt(j-1) ? 0 : 1;

      current[j] = Math.min(
        previous[j] + 1,
        current[j-1] + 1,
        previous[j-1] + cost
      );

    }

    for(let j=0;j<=a.length;j++)
      previous[j] = current[j];

  }

  return previous[a.length];

}


/******************************************************
 * CHRONOLOGY CHECK
 *
 * Uses dateObj produced by the existing Parser.gs.
 * If both times exist, same-day rounds are compared
 * using interview time.
 ******************************************************/
function REC_compareChronology(teamRecord, rawRecord){

  const teamDate = teamRecord.dateObj;
  const rawDate = rawRecord.dateObj;

  if(
    !(teamDate instanceof Date) ||
    !(rawDate instanceof Date)
  ){

    return {
      valid: false,
      dateScore: 0,
      teamTimestamp: 0,
      rawTimestamp: 0
    };

  }

  const teamDay = REC_startOfDay(teamDate);
  const rawDay = REC_startOfDay(rawDate);

  //--------------------------------------------------
  // Later calendar day = strong chronology.
  //--------------------------------------------------

  if(rawDay.getTime() > teamDay.getTime()){

    return {
      valid: true,
      dateScore: 100,
      teamTimestamp: REC_buildDateTime(teamDate, teamRecord.time).getTime(),
      rawTimestamp: REC_buildDateTime(rawDate, rawRecord.time).getTime()
    };

  }

  //--------------------------------------------------
  // Earlier calendar day = impossible.
  //--------------------------------------------------

  if(rawDay.getTime() < teamDay.getTime()){

    return {
      valid: false,
      dateScore: 0,
      teamTimestamp: teamDay.getTime(),
      rawTimestamp: rawDay.getTime()
    };

  }

  //--------------------------------------------------
  // Same day.
  //--------------------------------------------------

  const teamHasTime = REC_hasUsableTime(teamRecord.time);
  const rawHasTime = REC_hasUsableTime(rawRecord.time);

  const teamDateTime = REC_buildDateTime(teamDate, teamRecord.time);
  const rawDateTime = REC_buildDateTime(rawDate, rawRecord.time);

  if(teamHasTime && rawHasTime){

    return {
      valid: rawDateTime.getTime() > teamDateTime.getTime(),
      dateScore: rawDateTime.getTime() > teamDateTime.getTime() ? 100 : 0,
      teamTimestamp: teamDateTime.getTime(),
      rawTimestamp: rawDateTime.getTime()
    };

  }

  //--------------------------------------------------
  // Same day but one/both times missing.
  // Keep as a weaker but reviewable match.
  //--------------------------------------------------

  return {
    valid: true,
    dateScore: 90,
    teamTimestamp: teamDay.getTime(),
    rawTimestamp: rawDay.getTime()
  };

}


/******************************************************
 * BUILD DATE + TIME
 ******************************************************/
function REC_buildDateTime(dateObj, timeText){

  const d = new Date(
    dateObj.getFullYear(),
    dateObj.getMonth(),
    dateObj.getDate(),
    0,0,0,0
  );

  const match = String(timeText || "")
    .trim()
    .match(/^(\d{1,2}):(\d{2})\s*([AP]M)$/i);

  if(!match)
    return d;

  let hour = parseInt(match[1],10);
  const minute = parseInt(match[2],10);
  const meridiem = match[3].toUpperCase();

  if(hour === 12)
    hour = 0;

  if(meridiem === "PM")
    hour += 12;

  d.setHours(hour, minute, 0, 0);

  return d;

}


/******************************************************
 * HAS USABLE TIME
 ******************************************************/
function REC_hasUsableTime(timeText){

  return /^(\d{1,2}):(\d{2})\s*([AP]M)$/i.test(
    String(timeText || "").trim()
  );

}


/******************************************************
 * START OF DAY
 ******************************************************/
function REC_startOfDay(dateObj){

  return new Date(
    dateObj.getFullYear(),
    dateObj.getMonth(),
    dateObj.getDate(),
    0,0,0,0
  );

}


/******************************************************
 * CALCULATE CONFIDENCE
 ******************************************************/
function REC_calculateConfidence(
  candidateScore,
  clientScore,
  roundScore,
  dateScore
){

  const recoveryConfig =
    CONFIG && CONFIG.RECOVERY
      ? CONFIG.RECOVERY
      : {};

  const candidateWeight =
    Number(recoveryConfig.CANDIDATE_WEIGHT) || 50;

  const clientWeight =
    Number(recoveryConfig.CLIENT_WEIGHT) || 30;

  const roundWeight =
    Number(recoveryConfig.ROUND_WEIGHT) || 10;

  const dateWeight =
    Number(recoveryConfig.DATE_WEIGHT) || 10;

  const totalWeight =
    candidateWeight +
    clientWeight +
    roundWeight +
    dateWeight;

  if(totalWeight <= 0)
    return 0;

  const score = (
    candidateScore * candidateWeight +
    clientScore * clientWeight +
    roundScore * roundWeight +
    dateScore * dateWeight
  ) / totalWeight;

  return Math.round(score);

}


/******************************************************
 * MINIMUM CONFIDENCE
 ******************************************************/
function REC_getMinimumConfidence(){

  if(
    CONFIG &&
    CONFIG.RECOVERY &&
    Number(CONFIG.RECOVERY.MIN_CONFIDENCE) > 0
  ){

    return Number(CONFIG.RECOVERY.MIN_CONFIDENCE);

  }

  return REC_SETTINGS.DEFAULT_MIN_CONFIDENCE;

}


/******************************************************
 * VALID HANDLER
 ******************************************************/
function REC_hasValidHandler(handler){

  const normalized = REC_normalizeHandler(handler);

  if(!normalized)
    return false;

  const ignored =
    typeof IGNORE_HANDLERS !== "undefined"
      ? IGNORE_HANDLERS
      : [];

  return ignored.indexOf(normalized) === -1;

}


/******************************************************
 * NORMALIZE HANDLER
 ******************************************************/
function REC_normalizeHandler(handler){

  return String(handler || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

}


/******************************************************
 * LOAD EXISTING PROMOTION TRACKER RECORDS
 ******************************************************/
function REC_loadTrackerPromotions(){

  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName(CONFIG.TRACKER_SHEET);

  if(!sheet)
    return [];

  const values = sheet.getDataRange().getValues();

  if(values.length <= 1)
    return [];

  const headers = values[0].map(function(value){
    return String(value || "").trim();
  });

  const typeCol = headers.indexOf("Incentive Type");
  const candidateCol = headers.indexOf("Candidate");
  const clientCol = headers.indexOf("Client");
  const fromCol = headers.indexOf("From");
  const toCol = headers.indexOf("To");
  const handlerCol = headers.indexOf("Handler");

  if(
    typeCol < 0 ||
    candidateCol < 0 ||
    clientCol < 0 ||
    fromCol < 0 ||
    toCol < 0 ||
    handlerCol < 0
  ){

    throw new Error(
      "Incentive Tracker headers are not in the expected format."
    );

  }

  const records = [];

  for(let i=1;i<values.length;i++){

    const row = values[i];

    if(
      String(row[typeCol] || "")
        .trim()
        .toLowerCase() !== "promotion"
    ){
      continue;
    }

    records.push({
      candidate: row[candidateCol],
      client: row[clientCol],
      fromRound: row[fromCol],
      toRound: row[toCol],
      handler: row[handlerCol]
    });

  }

  return records;

}


/******************************************************
 * ALREADY IN INCENTIVE TRACKER?
 ******************************************************/
function REC_isAlreadyTracked(
  teamRecord,
  rawRecord,
  trackerRecords
){

  const fromRoundNo = Number(teamRecord.roundNo) || 0;
  const toRoundNo = Number(rawRecord.roundNo) || 0;
  const handler = REC_normalizeHandler(teamRecord.handler);

  for(let i=0;i<trackerRecords.length;i++){

    const tracker = trackerRecords[i];

    if(REC_normalizeHandler(tracker.handler) !== handler)
      continue;

    if(REC_roundNumberFromText(tracker.fromRound) !== fromRoundNo)
      continue;

    if(REC_roundNumberFromText(tracker.toRound) !== toRoundNo)
      continue;

    const trackerCandidateScore = Math.max(
      REC_candidateScore(
        tracker.candidate,
        teamRecord.candidate
      ),
      REC_candidateScore(
        tracker.candidate,
        rawRecord.candidate
      )
    );

    if(trackerCandidateScore < 95)
      continue;

    const trackerClientScore = Math.max(
      REC_clientScore(
        tracker.client,
        teamRecord.client
      ),
      REC_clientScore(
        tracker.client,
        rawRecord.client
      )
    );

    if(trackerClientScore < 90)
      continue;

    return true;

  }

  return false;

}


/******************************************************
 * ROUND NUMBER FROM TEXT
 ******************************************************/
function REC_roundNumberFromText(round){

  const value = String(round || "")
    .trim()
    .toLowerCase();

  if(value === "final")
    return 999;

  const match = value.match(/^(\d+)(st|nd|rd|th)\s+round$/i);

  if(!match)
    return 0;

  return parseInt(match[1],10);

}


/******************************************************
 * PROMOTION AMOUNT
 ******************************************************/
function REC_getPromotionAmount(
  teamRecord,
  rawRecord
){

  const fromRoundNo =
    Number(teamRecord.roundNo) || 0;

  const toRoundNo =
    Number(rawRecord.roundNo) || 0;


  //--------------------------------------------------
  // 1st -> 2nd = ₹100
  //--------------------------------------------------

  if(
    fromRoundNo === 1 &&
    toRoundNo === 2
  ){

    return (
      typeof INCENTIVES !== "undefined" &&
      Number(INCENTIVES.FIRST_PROMOTION) > 0
    )
      ? Number(
          INCENTIVES.FIRST_PROMOTION
        )
      : 100;

  }


  //--------------------------------------------------
  // Direct numbered progression = ₹500
  //--------------------------------------------------

  if(
    fromRoundNo >= 2 &&
    toRoundNo ===
      fromRoundNo + 1
  ){

    return (
      typeof INCENTIVES !== "undefined" &&
      Number(INCENTIVES.PROMOTION) > 0
    )
      ? Number(
          INCENTIVES.PROMOTION
        )
      : 500;

  }


  //--------------------------------------------------
  // Invalid/skipped progression
  //--------------------------------------------------

  return 0;

}



/******************************************************
 * RECOVERY ID
 ******************************************************/
function REC_buildRecoveryId(teamRecord, rawRecord){

  const fingerprint = [
    REC_normalizeCandidate(teamRecord.candidate),
    REC_normalizeClient(teamRecord.client),
    Number(teamRecord.roundNo) || 0,
    Number(rawRecord.roundNo) || 0,
    REC_dateKey(teamRecord.dateObj),
    REC_dateKey(rawRecord.dateObj),
    REC_normalizeHandler(teamRecord.handler)
  ].join("|");

  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    fingerprint
  );

  const hex = digest.map(function(byte){

    const value = byte < 0 ? byte + 256 : byte;
    return ("0" + value.toString(16)).slice(-2);

  }).join("");

  return "REC-" + hex.substring(0,16).toUpperCase();

}


/******************************************************
 * DATE KEY
 ******************************************************/
function REC_dateKey(dateObj){

  if(!(dateObj instanceof Date))
    return "";

  return Utilities.formatDate(
    dateObj,
    Session.getScriptTimeZone(),
    "yyyy-MM-dd"
  );

}


/******************************************************
 * MATCH REASON
 ******************************************************/
function REC_buildMatchReason(matchResult){

  return [
    "Candidate " + matchResult.candidateScore + "%",
    "Client " + matchResult.clientScore + "%",
    "Round 100%",
    "Date " + matchResult.dateScore + "%"
  ].join(" | ");

}


/******************************************************
 * LOAD EXISTING RECOVERY STATUSES
 *
 * This prevents a rerun from wiping Approved/Rejected
 * decisions for the same Recovery ID.
 ******************************************************/
function REC_loadExistingRecoveryStatuses(){

  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName(REC_SETTINGS.SHEET_NAME);

  if(!sheet)
    return {};

  const values = sheet.getDataRange().getValues();

  if(values.length <= 1)
    return {};

  const headers = values[0].map(function(value){
    return String(value || "").trim();
  });

  const idCol = headers.indexOf("Recovery ID");
  const statusCol = headers.indexOf("Status");

  if(idCol < 0 || statusCol < 0)
    return {};

  const statuses = {};

  for(let i=1;i<values.length;i++){

    const recoveryId = String(values[i][idCol] || "").trim();
    const status = String(values[i][statusCol] || "").trim();

    if(!recoveryId)
      continue;

    if(
      status === "Approved" ||
      status === "Rejected" ||
      status === "Pending"
    ){
      statuses[recoveryId] = status;
    }

  }

  return statuses;

}


/******************************************************
 * LOAD EXISTING EXCEPTION STATUSES
 *
 * Preserves Review / Resolved / Ignore decisions on rerun.
 ******************************************************/
function REC_loadExistingExceptionStatuses(){

  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName(REC_SETTINGS.EXCEPTIONS_SHEET_NAME);

  if(!sheet)
    return {};

  const values = sheet.getDataRange().getValues();

  if(values.length <= 1)
    return {};

  const headers = values[0].map(function(value){
    return String(value || "").trim();
  });

  const idCol = headers.indexOf("Exception ID");
  const statusCol = headers.indexOf("Status");

  if(idCol < 0 || statusCol < 0)
    return {};

  const statuses = {};

  for(let i=1;i<values.length;i++){

    const exceptionId = String(values[i][idCol] || "").trim();
    const status = String(values[i][statusCol] || "").trim();

    if(!exceptionId)
      continue;

    if(
      status === "Review" ||
      status === "Resolved" ||
      status === "Ignore"
    ){
      statuses[exceptionId] = status;
    }

  }

  return statuses;

}


/******************************************************
 * WRITE RECOVERY RESULTS
 ******************************************************/
function REC_writeRecoveryResults(results){

  const ss = SpreadsheetApp.getActive();

  let sheet = ss.getSheetByName(REC_SETTINGS.SHEET_NAME);

  if(!sheet)
    sheet = ss.insertSheet(REC_SETTINGS.SHEET_NAME);

  sheet.clear();

  const header = [
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
  ];

  sheet.getRange(1,1,1,header.length).setValues([header]);

  if(results.length){

    const output = results.map(function(item){

      return [
        item.recoveryId,
        item.candidate,
        item.previousRound,
        item.currentRound,
        item.teamClient,
        item.rawClient,
        item.teamDate,
        item.promotionDate,
        item.candidateScore,
        item.clientScore,
        item.confidence,
        item.handler,
        item.amount,
        item.status,
        item.reason
      ];

    });

    sheet
      .getRange(2,1,output.length,output[0].length)
      .setValues(output);

    //------------------------------------------------
    // Dates
    //------------------------------------------------

    sheet
      .getRange(2,7,output.length,2)
      .setNumberFormat("dd-MMM-yyyy");

    //------------------------------------------------
    // Scores
    //------------------------------------------------

    sheet
      .getRange(2,9,output.length,3)
      .setNumberFormat("0");

    //------------------------------------------------
    // Amount
    //------------------------------------------------

    sheet
      .getRange(2,13,output.length,1)
      .setNumberFormat("₹#,##0");

    //------------------------------------------------
    // Status dropdown
    //------------------------------------------------

    const statusRule = SpreadsheetApp
      .newDataValidation()
      .requireValueInList(
        ["Pending","Approved","Rejected"],
        true
      )
      .setAllowInvalid(false)
      .build();

    sheet
      .getRange(2,14,output.length,1)
      .setDataValidation(statusRule);

  }

  //--------------------------------------------------
  // Formatting
  //--------------------------------------------------

  sheet
    .getRange(1,1,1,header.length)
    .setFontWeight("bold")
    .setHorizontalAlignment("center")
    .setBackground("#D9EAD3");

  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1,header.length);

}


/******************************************************
 * WRITE RECOVERY EXCEPTIONS
 *
 * Always creates/refreshes a separate Recovery Exceptions
 * sheet, even when there are zero exception rows.
 ******************************************************/
function REC_writeRecoveryExceptions(exceptions){

  const ss = SpreadsheetApp.getActive();

  let sheet = ss.getSheetByName(
    REC_SETTINGS.EXCEPTIONS_SHEET_NAME
  );

  if(!sheet)
    sheet = ss.insertSheet(REC_SETTINGS.EXCEPTIONS_SHEET_NAME);

  sheet.clear();

  const header = [
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
  ];

  sheet.getRange(1,1,1,header.length).setValues([header]);

  if(exceptions && exceptions.length){

    const output = exceptions.map(function(item){

      return [
        item.exceptionId,
        item.candidate,
        item.rawClient,
        item.rawRound,
        item.promotionDate,
        item.teamCandidate,
        item.teamClient,
        item.teamRound,
        item.teamDate,
        item.handler,
        item.candidateScore,
        item.clientScore,
        item.issueType,
        item.reason,
        item.status
      ];

    });

    sheet
      .getRange(2,1,output.length,output[0].length)
      .setValues(output);

    sheet
      .getRange(2,5,output.length,1)
      .setNumberFormat("dd-MMM-yyyy");

    sheet
      .getRange(2,9,output.length,1)
      .setNumberFormat("dd-MMM-yyyy");

    sheet
      .getRange(2,11,output.length,2)
      .setNumberFormat("0");

    const statusRule = SpreadsheetApp
      .newDataValidation()
      .requireValueInList(
        ["Review","Resolved","Ignore"],
        true
      )
      .setAllowInvalid(false)
      .build();

    sheet
      .getRange(2,15,output.length,1)
      .setDataValidation(statusRule);

  }

  sheet
    .getRange(1,1,1,header.length)
    .setFontWeight("bold")
    .setHorizontalAlignment("center")
    .setBackground("#FCE5CD");

  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1,header.length);

}


/******************************************************
 * OPTIONAL TEST: MATCHING EXAMPLES
 *
 * Run REC_testMatchingExamples() manually from Apps Script.
 ******************************************************/
function REC_testMatchingExamples(){

  const tests = [

    [
      "Venkata Dilip Kumar Gopu",
      "Venkata Dilip Kumar Gopu",
      "Alten Technology",
      "Alten"
    ],

    [
      "Benhur Ruchitha mamidi",
      "Benhur Ruchitha Mamidi",
      "BlueSpring",
      "Bluesprig"
    ],

    [
      "Deepesh N Paladugu",
      "Deepesh Paladugu",
      "Gimlet Labs",
      "Gimlet Labs"
    ],

    [
      "Vinay Kumar Bollepalli",
      "Vinay Kumar Bollepalli",
      "Projecthome",
      "Project Home"
    ],

    [
      "Rakesh K",
      "Rakesh Kumar",
      "Twilio",
      "Twilio"
    ]

  ];

  tests.forEach(function(test){

    Logger.log(
      test[0] + " <> " + test[1] +
      " | Candidate=" +
      REC_candidateScore(test[0],test[1]) +
      " | " +
      test[2] + " <> " + test[3] +
      " | Client=" +
      REC_clientScore(test[2],test[3])
    );

  });

}
/******************************************************
 * RECOVERY RAW DATA LOADER
 *
 * Uses normal Parser.gs FIRST.
 *
 * Then scans only rows the normal parser could not
 * understand and tries a Recovery-only fallback.
 *
 * Does NOT modify normal incentive scanning.
 ******************************************************/
function REC_loadRawDataForRecovery(){

  //--------------------------------------------------
  // Normal working parser remains primary
  //--------------------------------------------------

  const normalRecords =
    loadRawData();


  //--------------------------------------------------
  // Raw sheet
  //--------------------------------------------------

  const sheet =
    SpreadsheetApp
      .getActive()
      .getSheetByName(
        CONFIG.RAW_SHEET
      );


  if(!sheet){

    throw new Error(
      "Raw Data sheet not found."
    );

  }


  const values =
    sheet
      .getDataRange()
      .getValues();


  const fallbackRecords = [];

  let currentDate = null;


  //--------------------------------------------------
  // Scan Raw Data
  //--------------------------------------------------

  for(
    let i = 0;
    i < values.length;
    i++
  ){

    const colB =
      values[i][1];


    //----------------------------------------------
    // Date header
    //----------------------------------------------

    if(colB instanceof Date){

      currentDate =
        new Date(colB);

      continue;

    }


    if(
      !colB ||
      !(currentDate instanceof Date)
    ){

      continue;

    }


    //----------------------------------------------
    // If normal parser understands this row,
    // it is already inside normalRecords.
    //----------------------------------------------

    const normalInterview =
      parseInterview(colB);


    if(normalInterview){

      continue;

    }


    //----------------------------------------------
    // Normal parser failed.
    // Try Recovery-only fallback.
    //----------------------------------------------

    const fallbackInterview =
      REC_parseFallbackRawInterview(
        colB
      );


    if(!fallbackInterview){

      continue;

    }


    fallbackInterview.dateObj =
      new Date(currentDate);


    fallbackInterview.dateText =
      formatDate(currentDate);


    //----------------------------------------------
    // Useful for audit/evidence
    //----------------------------------------------

    fallbackInterview.sourceRow =
      i + 1;


    fallbackInterview.originalText =
      String(colB || "").trim();


    fallbackInterview.recoveryFallback =
      true;


    fallbackRecords.push(
      fallbackInterview
    );

  }


  Logger.log(
    "Recovery Fallback Raw Records : " +
    fallbackRecords.length
  );


  return normalRecords.concat(
    fallbackRecords
  );

}


/******************************************************
 * RECOVERY FALLBACK RAW PARSER
 *
 * Handles unusual layout:
 *
 * Candidate – Interview –
 * 8:30 PM IST Client Name (2nd Round)
 *
 * Example:
 *
 * Bhavanteja Ammisetty – Interview –
 * 8:30 PM IST Infinitiv (2nd Round)
 ******************************************************/
function REC_parseFallbackRawInterview(text){

  let value =
    String(text || "").trim();


  if(!value){

    return null;

  }


  //--------------------------------------------------
  // Normalize dashes
  //--------------------------------------------------

  value =
    value.replace(
      /[–—]/g,
      "-"
    );


  //--------------------------------------------------
  // Candidate
  //--------------------------------------------------

  const firstDash =
    value.indexOf("-");


  if(firstDash === -1){

    return null;

  }


  let candidate =
    value
      .substring(
        0,
        firstDash
      )
      .trim();


  // Same country-note cleanup as normal parser
  candidate =
    candidate
      .replace(
        /\([^)]*\)/g,
        " "
      )
      .replace(
        /\s+/g,
        " "
      )
      .trim();


  if(!candidate){

    return null;

  }


  //--------------------------------------------------
  // Everything after candidate
  //--------------------------------------------------

  const remaining =
    value
      .substring(
        firstDash + 1
      )
      .trim();


  //--------------------------------------------------
  // Must be an interview-style record
  //--------------------------------------------------

  const interviewMatch =
    remaining.match(
      /^(?:Interview|Phone Interview|Phone Call|Recruiter Call)\s*-\s*(.*)$/i
    );


  if(!interviewMatch){

    return null;

  }


  let tail =
    String(
      interviewMatch[1] || ""
    ).trim();


  //--------------------------------------------------
  // SPECIAL FORMAT:
  //
  // TIME first, then CLIENT
  //--------------------------------------------------

  const timeFirstMatch =
    tail.match(
      /^(\d{1,2}:\d{2}\s*[AP]M)\s*(?:IST\b)?\s*(.*)$/i
    );


  if(!timeFirstMatch){

    return null;

  }


  const time =
    String(
      timeFirstMatch[1] || ""
    )
      .trim()
      .toUpperCase();


  let clientPart =
    String(
      timeFirstMatch[2] || ""
    ).trim();


  //--------------------------------------------------
  // Round
  //--------------------------------------------------

  let round = "";
  let roundNo = 0;


  if(/final/i.test(value)){

    round = "Final";
    roundNo = 999;

  }else{

    const roundMatch =
      value.match(
        /(\d+)(st|nd|rd|th)\s*Round/i
      );


    if(!roundMatch){

      return null;

    }


    round =
      roundMatch[0];


    roundNo =
      parseInt(
        roundMatch[1],
        10
      );

  }


  //--------------------------------------------------
  // Remove Round and everything following it
  //--------------------------------------------------

  clientPart =
    clientPart.replace(
      /\(\s*\d+(?:st|nd|rd|th)\s*Round\s*\).*$/i,
      ""
    );


  clientPart =
    clientPart.replace(
      /\(\s*Final(?:\s*Round)?\s*\).*$/i,
      ""
    );


  //--------------------------------------------------
  // Remove optional Duration information
  //--------------------------------------------------

  clientPart =
    clientPart.replace(
      /\s*-?\s*Duration\s*:?.*$/i,
      ""
    );


  //--------------------------------------------------
  // Remove leftover separators
  //--------------------------------------------------

  clientPart =
    clientPart
      .replace(
        /^[-:\s]+/,
        ""
      )
      .replace(
        /[-:\s]+$/,
        ""
      )
      .replace(
        /\s+/g,
        " "
      )
      .trim();


  if(!clientPart){

    return null;

  }


  //--------------------------------------------------
  // Recovery-compatible interview object
  //--------------------------------------------------

  return {

    candidate:
      candidate,

    client:
      clientPart,

    round:
      round,

    roundNo:
      roundNo,

    time:
      time

  };

}



