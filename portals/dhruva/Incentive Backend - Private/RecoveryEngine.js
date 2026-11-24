/******************************************************
 * RECOVERY ENGINE
 * Version 1.4.2 - TEAM-FIRST + PERMANENT TRACKER DUPLICATE GUARD
 *
 * Purpose:
 * Recover promotions for calls handled by our team when
 * later Raw Data proves ANY higher round. Recovery exists
 * mainly for candidate/client text differences missed by the
 * normal exact-key scan.
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

  Logger.log("========== RECOVERY START - TEAM-FIRST v1.4.2 ==========");

  //--------------------------------------------------
  // Load + canonicalize using the RELEASED v1.8.2
  // Candidate/Client identity layer when available.
  //--------------------------------------------------

  const rawLoaded = REC_loadRawDataForRecovery();

  const rawRepaired =
    REC_repairPromotionRecordsV142_(
      rawLoaded
    );

  const rawRecords =
    typeof PROMO_getEffectiveRawRecords_ === "function"
      ? PROMO_getEffectiveRawRecords_(rawRepaired)
      : rawRepaired;

  Logger.log(
    "Recovery stage: Raw Data loaded. Effective rows = " +
    rawRecords.length
  );

  const teamLoaded = loadTeamData();

  const teamRecords =
    REC_repairPromotionRecordsV142_(
      teamLoaded
    );

  Logger.log(
    "Recovery stage: Team Data loaded. Rows = " +
    teamRecords.length
  );

  //--------------------------------------------------
  // Permanent tracker is authoritative.
  //--------------------------------------------------

  const trackerRecords =
    REC_loadTrackerPromotions();

  Logger.log(
    "Recovery stage: Existing promotion tracker loaded. Rows = " +
    trackerRecords.length
  );

  const currentOccurrenceIndex =
    REC_buildCurrentOccurrenceIndex(
      teamRecords
    );

  const rawSearchIndex =
    REC_buildRawSearchIndexV141_(
      rawRecords
    );

  const trackerSearchIndex =
    REC_buildTrackerSearchIndexV141_(
      trackerRecords
    );

  Logger.log(
    "Recovery stage: Search indexes built."
  );

  const existingRecoveryStatuses =
    REC_loadExistingRecoveryStatuses();

  const existingExceptionStatuses =
    REC_loadExistingExceptionStatuses();

  const results = [];
  const exceptions = [];
  const seenRecoveryIds = {};
  const seenExceptionIds = {};
  const seenTeamCalls = {};

  let eligibleTeamCalls = 0;
  let noProgressionYet = 0;
  let alreadyTracked = 0;
  let exactPermanentKeyBlocks = 0;
  let fallbackTrackerBlocks = 0;
  let exactNormalMatches = 0;
  let recoveryMatches = 0;
  let sameDayReview = 0;
  let ambiguousReview = 0;
  let processedEligible = 0;

  (teamRecords || []).forEach(
    function(teamRecord){

      if(
        !REC_isEligibleTeamCallV14_(
          teamRecord
        )
      ){
        return;
      }

      const teamCallKey =
        REC_teamCallIdentityV14_(
          teamRecord
        );

      if(
        !teamCallKey ||
        seenTeamCalls[teamCallKey]
      ){
        return;
      }

      seenTeamCalls[teamCallKey] = true;
      eligibleTeamCalls++;
      processedEligible++;

      if(
        processedEligible % 100 === 0
      ){
        Logger.log(
          "Recovery progress: " +
          processedEligible +
          " eligible Team calls checked"
        );
      }

      //------------------------------------------------
      // PERMANENT DUPLICATE GUARD v1.4.2
      //
      // Business identity is the handled Team call:
      // Canonical Candidate + Canonical Client +
      // From Round + Previous/Team Date.
      //
      // We intentionally do NOT require:
      // - To Round
      // - Promotion Date
      // - Handler spelling/capitalization
      // - Tracker status
      //
      // Once that Team call has already earned a Promotion
      // in Incentive Tracker, Recovery must never reopen it.
      //------------------------------------------------

      const trackerPool =
        REC_getTrackerPoolV141_(
          teamRecord,
          trackerSearchIndex
        );

      const trackedResult =
        REC_findTrackedTeamCallV142_(
          teamRecord,
          trackerPool
        );

      if(trackedResult.tracked){

        alreadyTracked++;

        if(
          trackedResult.matchType ===
          "EXACT_PERMANENT_KEY"
        ){
          exactPermanentKeyBlocks++;
        }else{
          fallbackTrackerBlocks++;
        }

        return;
      }

      //------------------------------------------------
      // FAST Raw progression search.
      //------------------------------------------------

      const rawPool =
        REC_getRawPoolV141_(
          teamRecord,
          rawSearchIndex
        );

      const match =
        REC_findHigherRawForTeamCallV14_(
          teamRecord,
          rawPool,
          currentOccurrenceIndex
        );

      if(
        !match ||
        match.status === "none"
      ){
        noProgressionYet++;
        return;
      }

      if(
        match.status ===
        "same_day_review"
      ){

        const exception =
          REC_buildTeamFirstExceptionV14_(
            "SAME_DAY_HIGHER_ROUND",
            teamRecord,
            match.best,
            match,
            existingExceptionStatuses,
            "Same-Day Higher Round Review",
            "A higher Raw round exists for this Team-handled call on the same date, but the source does not explicitly identify a Loop Interview. No incentive was created automatically."
          );

        if(
          exception &&
          !seenExceptionIds[
            exception.exceptionId
          ]
        ){
          seenExceptionIds[
            exception.exceptionId
          ] = true;

          exceptions.push(
            exception
          );

          sameDayReview++;
        }

        return;
      }

      if(
        match.status ===
        "ambiguous"
      ){

        const exception =
          REC_buildTeamFirstExceptionV14_(
            "AMBIGUOUS_RAW_PROGRESS",
            teamRecord,
            match.best,
            match,
            existingExceptionStatuses,
            "Ambiguous Raw Progression",
            "More than one Raw progression candidate is similarly strong for this Team-handled call. The system did not guess which Raw occurrence proves promotion."
          );

        if(
          exception &&
          !seenExceptionIds[
            exception.exceptionId
          ]
        ){
          seenExceptionIds[
            exception.exceptionId
          ] = true;

          exceptions.push(
            exception
          );

          ambiguousReview++;
        }

        return;
      }

      const rawRecord =
        match.best.match;

      //------------------------------------------------
      // SECOND permanent duplicate check.
      //
      // This protects against unusual index misses and
      // guarantees an already-recorded Team call is not
      // emitted into Recovery after a Raw match is found.
      //------------------------------------------------

      if(
        REC_isAlreadyTracked(
          teamRecord,
          rawRecord,
          trackerRecords
        )
      ){
        alreadyTracked++;
        fallbackTrackerBlocks++;
        return;
      }

      const amount =
        REC_getPromotionAmount(
          teamRecord,
          rawRecord
        );

      if(amount <= 0)
        return;

      const recoveryId =
        REC_buildRecoveryId(
          teamRecord,
          rawRecord
        );

      if(
        seenRecoveryIds[
          recoveryId
        ]
      ){
        return;
      }

      seenRecoveryIds[
        recoveryId
      ] = true;

      if(match.best.exactIdentity)
        exactNormalMatches++;
      else
        recoveryMatches++;

      results.push({
        recoveryId: recoveryId,
        candidate: teamRecord.candidate,
        previousRound: teamRecord.round,
        currentRound: rawRecord.round,
        teamClient: teamRecord.client,
        rawClient: rawRecord.client,
        teamDate: teamRecord.dateObj,
        promotionDate: rawRecord.dateObj,
        candidateScore: match.best.candidateScore,
        clientScore: match.best.clientScore,
        confidence: match.best.confidence,
        handler: teamRecord.handler,
        amount: amount,
        status:
          existingRecoveryStatuses[
            recoveryId
          ] || "Pending",
        reason:
          "Team call progressed to a higher Raw round" +
          " | Candidate " + match.best.candidateScore + "%" +
          " | Client " + match.best.clientScore + "%" +
          " | From " + teamRecord.round +
          " | Evidence " + rawRecord.round
      });

    }
  );

  Logger.log(
    "Recovery stage: Team-first matching complete."
  );

  REC_writeRecoveryResults(
    results
  );

  REC_writeRecoveryExceptions(
    exceptions
  );

  Logger.log(
    "Recovery stage: Recovery sheets written."
  );

  Logger.log(
    "Recovery Evidence refresh deferred. Run REC_refreshRecoveryEvidence() separately if needed."
  );

  Logger.log(
    "Raw Records (all) : " +
    rawLoaded.length
  );

  Logger.log(
    "Raw Records (effective after reschedule collapse) : " +
    rawRecords.length
  );

  Logger.log(
    "Team Records : " +
    teamRecords.length
  );

  Logger.log(
    "Eligible Team Calls : " +
    eligibleTeamCalls
  );

  Logger.log(
    "Promotion Recovery Results : " +
    results.length
  );

  Logger.log(
    "Already Tracked Team Calls Suppressed : " +
    alreadyTracked
  );

  Logger.log(
    "Exact Permanent-Key Suppressions : " +
    exactPermanentKeyBlocks
  );

  Logger.log(
    "Fallback Tracker Suppressions : " +
    fallbackTrackerBlocks
  );

  Logger.log(
    "No Higher Raw Progression Yet : " +
    noProgressionYet
  );

  Logger.log(
    "Exact Identity Progressions : " +
    exactNormalMatches
  );

  Logger.log(
    "Fuzzy Recovery Progressions : " +
    recoveryMatches
  );

  Logger.log(
    "Same-Day Higher-Round Review : " +
    sameDayReview
  );

  Logger.log(
    "Ambiguous Raw Progression Review : " +
    ambiguousReview
  );

  Logger.log(
    "Recovery Exceptions : " +
    exceptions.length
  );

  Logger.log(
    "========== RECOVERY COMPLETE - TEAM-FIRST v1.4.2 =========="
  );
}

/******************************************************
 * TEAM-FIRST v1.4 HELPERS
 ******************************************************/
function REC_isEligibleTeamCallV14_(record){

  if(
    !record ||
    !record.candidate ||
    !record.client ||
    !(record.dateObj instanceof Date) ||
    !REC_hasValidHandler(record.handler)
  ){
    return false;
  }

  const roundNo = Number(record.roundNo) || 0;
  return roundNo >= 1 && roundNo !== 999;
}


function REC_teamCallIdentityV14_(teamRecord){
  return [
    REC_canonicalCandidateKeyV142_(
      teamRecord && teamRecord.candidate
    ),
    REC_canonicalClientKeyV142_(
      teamRecord && teamRecord.client
    ),
    Number(
      teamRecord && teamRecord.roundNo
    ) || 0,
    REC_dateKey(
      teamRecord && teamRecord.dateObj
    ),
    REC_normalizeHandler(
      teamRecord && teamRecord.handler
    )
  ].join("||");
}


function REC_findHigherRawForTeamCallV14_(teamRecord,rawRecords,currentOccurrenceIndex){

  const safe = [];
  const sameDayUnsafe = [];

  (rawRecords || []).forEach(function(rawRecord){

    if(
      !rawRecord ||
      !rawRecord.candidate ||
      !rawRecord.client ||
      !(rawRecord.dateObj instanceof Date)
    ){
      return;
    }

    const fromRoundNo = Number(teamRecord.roundNo) || 0;
    const toRoundNo = Number(rawRecord.roundNo) || 0;

    const higher = toRoundNo === 999
      ? fromRoundNo !== 999
      : (fromRoundNo !== 999 && toRoundNo > fromRoundNo);

    // Critical: same round can NEVER be progression evidence.
    if(!higher)
      return;

    const candidateScore = REC_candidateScore(teamRecord.candidate,rawRecord.candidate);
    if(candidateScore < REC_SETTINGS.MIN_CANDIDATE_SCORE)
      return;

    const clientScore = REC_clientScore(teamRecord.client,rawRecord.client);
    if(clientScore < REC_SETTINGS.MIN_CLIENT_SCORE)
      return;

    const occurrenceCheck = REC_checkCurrentOccurrence(rawRecord,currentOccurrenceIndex);
    if(occurrenceCheck.blocked)
      return;

    const chronology = REC_compareChronology(teamRecord,rawRecord);
    const confidence = REC_calculateConfidence(
      candidateScore,
      clientScore,
      100,
      chronology.dateScore
    );

    const item = {
      match: rawRecord,
      candidateScore: candidateScore,
      clientScore: clientScore,
      confidence: confidence,
      chronology: chronology,
      rawTimestamp: chronology.rawTimestamp || rawRecord.dateObj.getTime(),
      exactIdentity:
        makeSmartKey(teamRecord.candidate,teamRecord.client) ===
        makeSmartKey(rawRecord.candidate,rawRecord.client)
    };

    if(chronology.valid && confidence >= REC_getMinimumConfidence()){
      safe.push(item);
      return;
    }

    if(
      chronology.reason === "same_day_non_loop" &&
      candidateScore >= REC_SETTINGS.EXCEPTION_MIN_CANDIDATE_SCORE &&
      clientScore >= REC_SETTINGS.EXCEPTION_MIN_CLIENT_SCORE
    ){
      sameDayUnsafe.push(item);
    }

  });

  if(safe.length){

    safe.sort(REC_sortRawProgressionCandidatesV14_);

    const best = safe[0];
    const sameTimePool = safe.filter(function(item){
      return Math.abs((item.rawTimestamp||0) - (best.rawTimestamp||0)) <= 60000;
    });

    if(sameTimePool.length > 1){
      const second = sameTimePool[1];
      if(Math.abs(best.confidence-second.confidence) <= REC_SETTINGS.AMBIGUITY_MARGIN){
        return {status:"ambiguous",best:best,second:second};
      }
    }

    return {status:"matched",best:best};
  }

  if(sameDayUnsafe.length){
    sameDayUnsafe.sort(REC_sortRawProgressionCandidatesV14_);
    return {status:"same_day_review",best:sameDayUnsafe[0]};
  }

  return {status:"none"};
}


function REC_sortRawProgressionCandidatesV14_(a,b){

  if((a.rawTimestamp||0) !== (b.rawTimestamp||0))
    return (a.rawTimestamp||0) - (b.rawTimestamp||0);

  if(b.confidence !== a.confidence)
    return b.confidence - a.confidence;

  return (Number(a.match && a.match.roundNo)||0) - (Number(b.match && b.match.roundNo)||0);
}


function REC_buildTeamFirstExceptionV14_(
  type,
  teamRecord,
  rawItem,
  matchResult,
  existingStatuses,
  issueType,
  reason
){

  if(!teamRecord || !rawItem || !rawItem.match)
    return null;

  const rawRecord = rawItem.match;
  const exceptionId = REC_buildTeamFirstExceptionIdV14_(type,teamRecord);

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
    candidateScore: rawItem.candidateScore,
    clientScore: rawItem.clientScore,
    issueType: issueType,
    reason: reason,
    status: existingStatuses[exceptionId] || "Review"
  };
}


function REC_buildTeamFirstExceptionIdV14_(type,teamRecord){

  const parts = [
    String(type || ""),
    REC_normalizeCandidate(teamRecord && teamRecord.candidate),
    REC_normalizeClient(teamRecord && teamRecord.client),
    Number(teamRecord && teamRecord.roundNo) || 0,
    REC_dateKey(teamRecord && teamRecord.dateObj),
    REC_normalizeHandler(teamRecord && teamRecord.handler)
  ];

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


function REC_trackerDateKeyV14_(value){

  if(value instanceof Date)
    return REC_dateKey(value);

  const text = String(value || "").trim();
  if(!text)
    return "";

  if(typeof parseSheetDate === "function"){
    try{
      const parsed = parseSheetDate(text);
      if(parsed instanceof Date && !isNaN(parsed.getTime()))
        return REC_dateKey(parsed);
    }catch(error){}
  }

  const parsed = new Date(text);
  if(!isNaN(parsed.getTime()))
    return REC_dateKey(parsed);

  return "";
}



/******************************************************
 * RECOVERY PERFORMANCE HELPERS
 * v1.4.1 (retained by v1.4.2)
 *
 * Purpose:
 * - Preserve the v1.4 Team-first business rules.
 * - Avoid comparing every Team Data call against every
 *   Raw Data / Tracker record.
 * - Build candidate-keyed search pools once, then reuse.
 ******************************************************/

function REC_buildRawSearchIndexV141_(rawRecords){

  const index = {
    exact: {},
    buckets: {},
    all: rawRecords || []
  };

  (rawRecords || []).forEach(function(record){

    if(!record || !record.candidate)
      return;

    const exactKey = REC_exactPersonClientKeyV141_(
      record.candidate,
      record.client
    );

    if(exactKey){
      if(!index.exact[exactKey])
        index.exact[exactKey] = [];
      index.exact[exactKey].push(record);
    }

    REC_candidateBucketKeysV141_(record.candidate)
      .forEach(function(bucketKey){
        if(!index.buckets[bucketKey])
          index.buckets[bucketKey] = [];
        index.buckets[bucketKey].push(record);
      });
  });

  return index;
}


function REC_buildTrackerSearchIndexV141_(trackerRecords){

  const index = {
    exact: {},
    buckets: {},
    all: trackerRecords || []
  };

  (trackerRecords || []).forEach(function(record){

    if(!record || !record.candidate)
      return;

    const exactKey = REC_exactPersonClientKeyV141_(
      record.candidate,
      record.client
    );

    if(exactKey){
      if(!index.exact[exactKey])
        index.exact[exactKey] = [];
      index.exact[exactKey].push(record);
    }

    REC_candidateBucketKeysV141_(record.candidate)
      .forEach(function(bucketKey){
        if(!index.buckets[bucketKey])
          index.buckets[bucketKey] = [];
        index.buckets[bucketKey].push(record);
      });
  });

  return index;
}


function REC_getRawPoolV141_(teamRecord,index){
  return REC_getCandidatePoolV141_(
    teamRecord,
    index
  );
}


function REC_getTrackerPoolV141_(teamRecord,index){
  return REC_getCandidatePoolV141_(
    teamRecord,
    index
  );
}


function REC_getCandidatePoolV141_(teamRecord,index){

  if(!teamRecord || !index)
    return [];

  const output = [];

  const exactKey = REC_exactPersonClientKeyV141_(
    teamRecord.candidate,
    teamRecord.client
  );

  if(
    exactKey &&
    index.exact &&
    index.exact[exactKey]
  ){
    REC_addUniqueRecordsV141_(
      output,
      index.exact[exactKey]
    );
  }

  REC_candidateBucketKeysV141_(teamRecord.candidate)
    .forEach(function(bucketKey){
      if(
        index.buckets &&
        index.buckets[bucketKey]
      ){
        REC_addUniqueRecordsV141_(
          output,
          index.buckets[bucketKey]
        );
      }
    });

  // Very short / unusual candidate names are rare. For
  // those only, keep the old full-search safety fallback.
  if(
    output.length === 0 &&
    REC_normalizeCandidate(teamRecord.candidate)
      .replace(/\s+/g,"").length <= 3
  ){
    return (index.all || []).slice();
  }

  return output;
}


function REC_exactPersonClientKeyV141_(candidate,client){
  return [
    REC_canonicalCandidateKeyV142_(candidate),
    REC_canonicalClientKeyV142_(client)
  ].join("||");
}


function REC_candidateBucketKeysV141_(candidate){

  const normalized =
    REC_normalizeCandidate(candidate);

  if(!normalized)
    return [];

  const tokens = normalized
    .split(/\s+/)
    .filter(Boolean);

  const compact =
    normalized.replace(/\s+/g,"");

  const keys = [];

  function add(value){
    value = String(value || "");
    if(value && keys.indexOf(value) === -1)
      keys.push(value);
  }

  if(compact.length >= 2)
    add("P2:" + compact.substring(0,2));

  if(compact.length >= 4)
    add("P4:" + compact.substring(0,4));

  if(tokens.length){
    const first = tokens[0];
    const last = tokens[tokens.length - 1];

    if(first.length >= 3)
      add("F3:" + first.substring(0,3));

    if(last.length >= 3)
      add("L3:" + last.substring(0,3));
  }

  if(tokens.length >= 2){
    add(
      "I:" +
      tokens.map(function(token){
        return token.charAt(0);
      }).join("")
    );
  }

  return keys;
}


function REC_addUniqueRecordsV141_(target,records){

  (records || []).forEach(function(record){
    if(target.indexOf(record) === -1)
      target.push(record);
  });
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

  if(
    !record ||
    !record.candidate ||
    !record.client ||
    !(record.dateObj instanceof Date)
  ){
    return false;
  }

  const roundNo =
    Number(record.roundNo) || 0;

  if(roundNo >= 2 && roundNo <= 10)
    return true;

  return roundNo === 999;

}


/******************************************************
 * BUILD TEAM INDEX BY ROUND NUMBER
 ******************************************************/
function REC_buildTeamRoundIndex(teamRecords){

  const index = {};

  (teamRecords || []).forEach(function(record){

    if(
      !record ||
      !REC_hasValidHandler(record.handler) ||
      !(record.dateObj instanceof Date)
    ){
      return;
    }

    const roundNo =
      Number(record.roundNo) || 0;

    if(roundNo < 1 || roundNo > 10)
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

  const rawRoundNo =
    Number(rawRecord.roundNo) || 0;

  let pools = [];

  //--------------------------------------------------
  // Numbered promotion: exact previous round required.
  //--------------------------------------------------

  if(rawRoundNo >= 2 && rawRoundNo <= 10){

    pools =
      (teamIndex[rawRoundNo - 1] || [])
        .slice();

  }

  //--------------------------------------------------
  // Final: search numbered rounds. The amount rule
  // later decides which transition is actually payable.
  //--------------------------------------------------

  else if(rawRoundNo === 999){

    for(let roundNo=10;roundNo>=1;roundNo--){

      const roundPool =
        teamIndex[roundNo] || [];

      if(roundPool.length)
        pools = pools.concat(roundPool);

    }

  }

  if(!pools.length)
    return null;

  const candidates = [];

  pools.forEach(function(teamRecord){

    const chronology =
      REC_compareChronology(
        teamRecord,
        rawRecord
      );

    if(!chronology.valid)
      return;

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

    const confidence =
      REC_calculateConfidence(
        candidateScore,
        clientScore,
        100,
        chronology.dateScore
      );

    if(
      confidence <
      REC_getMinimumConfidence()
    ){
      return;
    }

    candidates.push({
      match: teamRecord,
      candidateScore: candidateScore,
      clientScore: clientScore,
      dateScore: chronology.dateScore,
      confidence: confidence,
      teamTimestamp: chronology.teamTimestamp,
      rawTimestamp: chronology.rawTimestamp,
      chronology: chronology
    });

  });

  if(!candidates.length)
    return null;

  candidates.sort(function(a,b){

    if(rawRoundNo === 999){

      const roundDifference =
        Number(b.match.roundNo) -
        Number(a.match.roundNo);

      if(roundDifference !== 0)
        return roundDifference;

    }

    if(b.confidence !== a.confidence)
      return b.confidence - a.confidence;

    return (
      Math.abs(a.rawTimestamp - a.teamTimestamp) -
      Math.abs(b.rawTimestamp - b.teamTimestamp)
    );

  });

  const best =
    candidates[0];

  if(candidates.length > 1){

    const second =
      candidates[1];

    const differentHandler =
      REC_normalizeHandler(best.match.handler) !==
      REC_normalizeHandler(second.match.handler);

    const differentTeamEvent =
      REC_dateKey(best.match.dateObj) !==
        REC_dateKey(second.match.dateObj) ||
      Number(best.match.roundNo) !==
        Number(second.match.roundNo);

    if(
      (differentHandler || differentTeamEvent) &&
      Math.abs(
        best.confidence -
        second.confidence
      ) <= REC_SETTINGS.AMBIGUITY_MARGIN
    ){

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
 * FIND SKIPPED-ROUND EVIDENCE
 *
 * Example:
 * Team Data has a strong 1st Round record,
 * Raw Data later shows 3rd Round, but Team Data has
 * no safe 2nd Round match.
 *
 * This NEVER creates an incentive. It only creates
 * a Recovery Exceptions review row.
 ******************************************************/
function REC_findSkippedRoundEvidence(rawRecord, teamIndex){

  const rawRoundNo =
    Number(rawRecord.roundNo) || 0;

  if(rawRoundNo < 3 || rawRoundNo > 10)
    return null;

  const expectedPreviousRoundNo =
    rawRoundNo - 1;

  const candidates = [];

  for(
    let roundNo = expectedPreviousRoundNo - 1;
    roundNo >= 1;
    roundNo--
  ){

    const pool =
      teamIndex[roundNo] || [];

    pool.forEach(function(teamRecord){

      const chronology =
        REC_compareChronology(
          teamRecord,
          rawRecord
        );

      if(!chronology.valid)
        return;

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
        match: teamRecord,
        candidateScore: candidateScore,
        clientScore: clientScore,
        dateScore: chronology.dateScore,
        teamTimestamp: chronology.teamTimestamp,
        rawTimestamp: chronology.rawTimestamp,
        chronology: chronology
      });

    });

  }

  if(!candidates.length)
    return null;

  candidates.sort(function(a,b){

    const roundDifference =
      Number(b.match.roundNo) -
      Number(a.match.roundNo);

    if(roundDifference !== 0)
      return roundDifference;

    const scoreA =
      a.candidateScore +
      a.clientScore;

    const scoreB =
      b.candidateScore +
      b.clientScore;

    if(scoreB !== scoreA)
      return scoreB - scoreA;

    return (
      Math.abs(a.rawTimestamp - a.teamTimestamp) -
      Math.abs(b.rawTimestamp - b.teamTimestamp)
    );

  });

  return candidates[0];

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

  const n =
    Number(roundNo) || 0;

  if(n === 999)
    return "Final";

  if(n <= 0)
    return String(roundNo || "");

  const mod100 = n % 100;
  let suffix = "th";

  if(mod100 < 11 || mod100 > 13){
    if(n % 10 === 1) suffix = "st";
    else if(n % 10 === 2) suffix = "nd";
    else if(n % 10 === 3) suffix = "rd";
  }

  return n + suffix + " Round";

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
 * FIND CREDIBLE RELATED TEAM EVIDENCE
 *
 * Used only when the strict recovery match failed.
 * It does NOT create an incentive automatically.
 ******************************************************/
function REC_findNearTeamEvidence_(rawRecord, teamRecords){

  const expectedPreviousRoundNo =
    Number(rawRecord.roundNo) === 999
      ? 6
      : (Number(rawRecord.roundNo) || 0) - 1;

  const candidates = [];

  (teamRecords || []).forEach(function(teamRecord){

    if(
      !teamRecord ||
      !REC_hasValidHandler(teamRecord.handler) ||
      !(teamRecord.dateObj instanceof Date)
    ){
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

    const chronology =
      REC_compareChronology(
        teamRecord,
        rawRecord
      );

    candidates.push({
      match: teamRecord,
      candidateScore: candidateScore,
      clientScore: clientScore,
      chronology: chronology,
      expectedPreviousRoundNo: expectedPreviousRoundNo,
      exactExpectedRound:
        Number(teamRecord.roundNo) ===
        expectedPreviousRoundNo
    });

  });

  if(!candidates.length)
    return null;

  candidates.sort(function(a,b){

    if(a.exactExpectedRound !== b.exactExpectedRound)
      return a.exactExpectedRound ? -1 : 1;

    const aScore =
      a.candidateScore + a.clientScore;

    const bScore =
      b.candidateScore + b.clientScore;

    if(aScore !== bScore)
      return bScore - aScore;

    const aDate =
      a.match.dateObj instanceof Date
        ? a.match.dateObj.getTime()
        : 0;

    const bDate =
      b.match.dateObj instanceof Date
        ? b.match.dateObj.getTime()
        : 0;

    return Math.abs(
      rawRecord.dateObj.getTime() - aDate
    ) - Math.abs(
      rawRecord.dateObj.getTime() - bDate
    );

  });

  return candidates[0];

}


/******************************************************
 * BUILD NO-SAFE-MATCH / CHRONOLOGY EXCEPTION
 ******************************************************/
function REC_buildNoSafeMatchException_(
  rawRecord,
  near,
  existingStatuses
){

  if(!near || !near.match)
    return null;

  const teamRecord =
    near.match;

  let issueType =
    "No Safe Previous-Round Match";

  let reason =
    "A strong Candidate + Client Team Data record exists, " +
    "but the normal recovery rules could not safely map it to " +
    rawRecord.round + ". No incentive was created automatically.";

  if(
    near.chronology &&
    near.chronology.reason === "reverse_date"
  ){
    issueType =
      "Chronology / Date Anomaly";
    reason =
      "The possible previous Team Data round is dated after the Raw higher round. " +
      "Review the source dates before approving any incentive.";
  }

  else if(
    near.chronology &&
    near.chronology.reason === "same_day_non_loop"
  ){
    issueType =
      "Same-Day Round Progression";
    reason =
      "Two different rounds were found for the same Candidate + Client on the same date, " +
      "but the source does not explicitly identify a Loop Interview. Review the round/date entry.";
  }

  else if(
    near.chronology &&
    near.chronology.reason === "loop_time_order"
  ){
    issueType =
      "Loop Interview Time Order";
    reason =
      "The source is marked as a Loop Interview, but the higher round time does not occur after the possible previous round time.";
  }

  else if(!near.exactExpectedRound){
    issueType =
      "Possible Round Label Error";
    reason =
      "Raw Data shows " + rawRecord.round +
      ", but the strongest Team Data evidence is labeled " +
      teamRecord.round +
      ". This may be a skipped round or a source round-label mistake. No incentive was created automatically.";
  }

  const exceptionId =
    REC_buildExceptionId(
      "NO_SAFE_MATCH",
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
    candidateScore: near.candidateScore,
    clientScore: near.clientScore,
    issueType: issueType,
    reason: reason,
    status: existingStatuses[exceptionId] || "Review"
  };

}


/******************************************************
 * LOOP RECORD?
 ******************************************************/
function REC_isLoopRecord_(record){

  if(!record)
    return false;

  if(record.isLoopInterview)
    return true;

  return /\bLoop\s+Interview\b/i.test(
    String(
      record.originalText ||
      ""
    )
  );

}


/******************************************************
 * REMOVE INTERVIEW-STAGE WORDING FROM CLIENT
 ******************************************************/
function REC_stripInterviewStageFromClient_(client){

  let value =
    String(client || "")
      .replace(/[–—]/g,"-")
      .replace(/\s+/g," ")
      .trim();

  const leading =
    /^(?:(?:Loop|Technical|Behavioral|Final|Assessment\s+Through|Assessment|Panel|Manager|Hiring\s+Manager)\s+Interview|Interview)\s*(?:-|:)?\s*/i;

  const trailing =
    /\s*(?:-|:)?\s*(?:(?:Loop|Technical|Behavioral|Final|Assessment|Panel|Manager|Hiring\s+Manager)\s+Interview|Interview)\s*$/i;

  let previous = null;

  while(previous !== value){
    previous = value;
    value = value
      .replace(leading,"")
      .replace(trailing,"")
      .replace(/^[-:\s]+|[-:\s]+$/g,"")
      .replace(/\s+/g," ")
      .trim();
  }

  return value;

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

  let value =
    String(client || "");

  value =
    REC_stripInterviewStageFromClient_(
      value
    );

  // Remove parenthetical notes before approved-alias lookup.
  value =
    value.replace(
      /\([^)]*\)/g,
      " "
    );

  if(typeof normalizeClient === "function"){

    try{
      value =
        normalizeClient(value);
    }catch(error){
      // Continue with local normalization.
    }

  }

  value =
    REC_stripInterviewStageFromClient_(
      value
    );

  value = String(value || "").toLowerCase();
  value = value.replace(/[-–—]/g," ");
  value = value.replace(/[.,'’`&]/g," ");
  value = value.replace(/[^a-z0-9\s]/g," ");
  value = value.replace(/\s+/g," ").trim();

  return value;

}
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
      rawTimestamp: 0,
      reason: "invalid_date"
    };
  }

  const teamDay =
    REC_startOfDay(teamDate);

  const rawDay =
    REC_startOfDay(rawDate);

  if(rawDay.getTime() > teamDay.getTime()){
    return {
      valid: true,
      dateScore: 100,
      teamTimestamp: REC_buildDateTime(teamDate,teamRecord.time).getTime(),
      rawTimestamp: REC_buildDateTime(rawDate,rawRecord.time).getTime(),
      reason: ""
    };
  }

  if(rawDay.getTime() < teamDay.getTime()){
    return {
      valid: false,
      dateScore: 0,
      teamTimestamp: teamDay.getTime(),
      rawTimestamp: rawDay.getTime(),
      reason: "reverse_date"
    };
  }

  //--------------------------------------------------
  // Same-day progression is valid only for an
  // explicitly identified Loop Interview.
  //--------------------------------------------------

  if(
    !REC_isLoopRecord_(teamRecord) &&
    !REC_isLoopRecord_(rawRecord)
  ){
    return {
      valid: false,
      dateScore: 0,
      teamTimestamp: REC_buildDateTime(teamDate,teamRecord.time).getTime(),
      rawTimestamp: REC_buildDateTime(rawDate,rawRecord.time).getTime(),
      reason: "same_day_non_loop"
    };
  }

  const teamHasTime =
    REC_hasUsableTime(teamRecord.time);

  const rawHasTime =
    REC_hasUsableTime(rawRecord.time);

  const teamDateTime =
    REC_buildDateTime(
      teamDate,
      teamRecord.time
    );

  const rawDateTime =
    REC_buildDateTime(
      rawDate,
      rawRecord.time
    );

  if(teamHasTime && rawHasTime){

    const valid =
      rawDateTime.getTime() >
      teamDateTime.getTime();

    return {
      valid: valid,
      dateScore: valid ? 100 : 0,
      teamTimestamp: teamDateTime.getTime(),
      rawTimestamp: rawDateTime.getTime(),
      reason: valid ? "" : "loop_time_order"
    };

  }

  return {
    valid: true,
    dateScore: 90,
    teamTimestamp: teamDay.getTime(),
    rawTimestamp: rawDay.getTime(),
    reason: ""
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

  const ss =
    typeof IR_backend_ === "function"
      ? IR_backend_()
      : SpreadsheetApp.getActive();

  const sheet =
    ss.getSheetByName(
      CONFIG.TRACKER_SHEET
    );

  if(!sheet)
    return [];

  const values =
    sheet.getDataRange()
      .getValues();

  if(values.length <= 1)
    return [];

  const headers =
    values[0].map(
      function(value){
        return String(value || "").trim();
      }
    );

  const typeCol =
    headers.indexOf("Incentive Type");

  const candidateCol =
    headers.indexOf("Candidate");

  const clientCol =
    headers.indexOf("Client");

  const fromCol =
    headers.indexOf("From");

  const toCol =
    headers.indexOf("To");

  const previousDateCol =
    headers.indexOf("Previous Date");

  const promotionDateCol =
    headers.indexOf("Promotion Date");

  const handlerCol =
    headers.indexOf("Handler");

  const amountCol =
    headers.indexOf("Amount");

  const statusCol =
    headers.indexOf("Status");

  if(
    typeCol < 0 ||
    candidateCol < 0 ||
    clientCol < 0 ||
    fromCol < 0 ||
    toCol < 0 ||
    previousDateCol < 0 ||
    handlerCol < 0
  ){
    throw new Error(
      "Incentive Tracker headers are not in the expected format."
    );
  }

  const records = [];

  for(
    let i=1;
    i<values.length;
    i++
  ){

    const row = values[i];

    if(
      String(row[typeCol] || "")
        .trim()
        .toLowerCase() !==
      "promotion"
    ){
      continue;
    }

    const record = {
      candidate:
        row[candidateCol],
      client:
        row[clientCol],
      fromRound:
        row[fromCol],
      toRound:
        row[toCol],
      previousDate:
        row[previousDateCol],
      promotionDate:
        promotionDateCol >= 0
          ? row[promotionDateCol]
          : "",
      handler:
        row[handlerCol],
      amount:
        amountCol >= 0
          ? row[amountCol]
          : "",
      status:
        statusCol >= 0
          ? row[statusCol]
          : ""
    };

    //------------------------------------------------
    // Permanent identity fields.
    // Status is deliberately NOT part of identity.
    //------------------------------------------------

    record.canonicalCandidate =
      REC_canonicalCandidateV142_(
        record.candidate
      );

    record.canonicalClient =
      REC_canonicalClientV142_(
        record.client
      );

    record.fromRoundNo =
      REC_roundNumberFromText(
        record.fromRound
      );

    record.toRoundNo =
      REC_roundNumberFromText(
        record.toRound
      );

    record.previousDateKey =
      REC_trackerDateKeyV14_(
        record.previousDate
      );

    record.promotionDateKey =
      REC_trackerDateKeyV14_(
        record.promotionDate
      );

    record.permanentTeamCallKey =
      REC_buildPermanentTeamCallKeyV142_(
        record.canonicalCandidate,
        record.canonicalClient,
        record.fromRoundNo,
        record.previousDateKey
      );

    records.push(record);
  }

  return records;
}


/******************************************************
 * PERMANENT TRACKER DUPLICATE GUARD v1.4.2
 ******************************************************/
function REC_findTrackedTeamCallV142_(
  teamRecord,
  trackerRecords
){

  const teamCandidate =
    REC_canonicalCandidateV142_(
      teamRecord && teamRecord.candidate
    );

  const teamClient =
    REC_canonicalClientV142_(
      teamRecord && teamRecord.client
    );

  const fromRoundNo =
    Number(
      teamRecord && teamRecord.roundNo
    ) || 0;

  const teamDateKey =
    REC_dateKey(
      teamRecord && teamRecord.dateObj
    );

  const permanentKey =
    REC_buildPermanentTeamCallKeyV142_(
      teamCandidate,
      teamClient,
      fromRoundNo,
      teamDateKey
    );

  //--------------------------------------------------
  // 1. Exact canonical permanent key.
  //--------------------------------------------------

  for(
    let i=0;
    i<(trackerRecords || []).length;
    i++
  ){

    const tracker =
      trackerRecords[i];

    if(
      tracker.permanentTeamCallKey &&
      tracker.permanentTeamCallKey ===
        permanentKey
    ){
      return {
        tracked:true,
        matchType:
          "EXACT_PERMANENT_KEY",
        tracker:tracker
      };
    }
  }

  //--------------------------------------------------
  // 2. Safe compatibility fallback for older tracker
  // rows whose Candidate/Client text predates the
  // canonical identity layer.
  //--------------------------------------------------

  for(
    let i=0;
    i<(trackerRecords || []).length;
    i++
  ){

    const tracker =
      trackerRecords[i];

    const trackerFromRoundNo =
      Number(
        tracker.fromRoundNo
      ) ||
      REC_roundNumberFromText(
        tracker.fromRound
      );

    if(
      trackerFromRoundNo !==
      fromRoundNo
    ){
      continue;
    }

    const trackerPreviousDateKey =
      tracker.previousDateKey ||
      REC_trackerDateKeyV14_(
        tracker.previousDate
      );

    //------------------------------------------------
    // If both sides have a date, it must be the same
    // handled Team occurrence.
    //--------------------------------------------------

    if(
      teamDateKey &&
      trackerPreviousDateKey &&
      trackerPreviousDateKey !==
        teamDateKey
    ){
      continue;
    }

    const trackerCandidate =
      tracker.canonicalCandidate ||
      REC_canonicalCandidateV142_(
        tracker.candidate
      );

    const trackerClient =
      tracker.canonicalClient ||
      REC_canonicalClientV142_(
        tracker.client
      );

    if(
      REC_identityKeyV142_(
        trackerCandidate
      ) ===
      REC_identityKeyV142_(
        teamCandidate
      ) &&
      REC_identityKeyV142_(
        trackerClient
      ) ===
      REC_identityKeyV142_(
        teamClient
      )
    ){
      return {
        tracked:true,
        matchType:
          "CANONICAL_FALLBACK",
        tracker:tracker
      };
    }

    //------------------------------------------------
    // Last fallback: existing conservative recovery
    // similarity thresholds.
    //--------------------------------------------------

    if(
      REC_candidateScore(
        trackerCandidate,
        teamCandidate
      ) < 95
    ){
      continue;
    }

    if(
      REC_clientScore(
        trackerClient,
        teamClient
      ) < 90
    ){
      continue;
    }

    return {
      tracked:true,
      matchType:
        "LEGACY_SIMILARITY_FALLBACK",
      tracker:tracker
    };
  }

  return {
    tracked:false,
    matchType:"",
    tracker:null
  };
}


/******************************************************
 * ALREADY IN INCENTIVE TRACKER?
 *
 * Keeps the old function name because other private
 * backend files call it.
 ******************************************************/
function REC_isAlreadyTracked(
  teamRecord,
  rawRecord,
  trackerRecords
){

  return REC_findTrackedTeamCallV142_(
    teamRecord,
    trackerRecords
  ).tracked;
}


/******************************************************
 * BUILD PERMANENT HANDLED-TEAM-CALL KEY
 ******************************************************/
function REC_buildPermanentTeamCallKeyV142_(
  candidate,
  client,
  fromRoundNo,
  previousDateKey
){

  return [
    REC_identityKeyV142_(candidate),
    REC_identityKeyV142_(client),
    Number(fromRoundNo) || 0,
    String(previousDateKey || "")
  ].join("||");
}


/******************************************************
 * RELEASED v1.8.2 IDENTITY BRIDGE
 ******************************************************/
function REC_repairPromotionRecordsV142_(records){

  if(!Array.isArray(records))
    return [];

  if(
    typeof PARSER_repairPromotionRecordsV16_ ===
    "function"
  ){
    try{
      return PARSER_repairPromotionRecordsV16_(
        records
      );
    }catch(error){
      Logger.log(
        "Recovery canonical record repair fallback: " +
        error.message
      );
    }
  }

  return records;
}


function REC_canonicalCandidateV142_(value){

  const clean =
    String(value || "")
      .trim();

  if(!clean)
    return "";

  if(
    typeof PARSER_identityCanonicalCandidate_ ===
    "function"
  ){
    try{
      return PARSER_identityCanonicalCandidate_(
        clean
      ) || clean;
    }catch(error){}
  }

  return clean;
}


function REC_canonicalClientV142_(value){

  let clean =
    String(value || "")
      .trim();

  if(!clean)
    return "";

  //--------------------------------------------------
  // First apply the same Client-vs-Role right-boundary
  // logic used by the released v1.8.2 parser.
  //--------------------------------------------------

  if(
    typeof PARSER_identityResolveClientRoleFromText_ ===
    "function"
  ){
    try{
      const info =
        PARSER_identityResolveClientRoleFromText_(
          clean
        );

      if(
        info &&
        info.client
      ){
        clean = info.client;
      }
    }catch(error){}
  }

  //--------------------------------------------------
  // Then apply verified Client Name Map alias-first
  // canonicalization.
  //--------------------------------------------------

  if(
    typeof PARSER_identityCanonicalClientV16_ ===
    "function"
  ){
    try{
      const canonical =
        PARSER_identityCanonicalClientV16_(
          clean
        );

      if(canonical)
        clean = canonical;

    }catch(error){}
  }

  return clean;
}


function REC_canonicalCandidateKeyV142_(value){
  return REC_identityKeyV142_(
    REC_canonicalCandidateV142_(
      value
    )
  );
}


function REC_canonicalClientKeyV142_(value){
  return REC_identityKeyV142_(
    REC_canonicalClientV142_(
      value
    )
  );
}


function REC_identityKeyV142_(value){

  if(
    typeof PARSER_identityKey_ ===
    "function"
  ){
    try{
      return PARSER_identityKey_(
        value
      );
    }catch(error){}
  }

  return String(value || "")
    .toLowerCase()
    .replace(/&/g," and ")
    .replace(/[^a-z0-9]+/g,"")
    .trim();
}


/******************************************************
 * READ-ONLY PERMANENT DUPLICATE-GUARD TEST
 *
 * NO SHEET WRITES.
 ******************************************************/
function testRecoveryPermanentDuplicateGuardV142ReadOnly(){

  const teamLoaded =
    loadTeamData();

  const teamRecords =
    REC_repairPromotionRecordsV142_(
      teamLoaded
    );

  const trackerRecords =
    REC_loadTrackerPromotions();

  const trackerIndex =
    REC_buildTrackerSearchIndexV141_(
      trackerRecords
    );

  const seen = {};
  const suppressedSamples = [];

  let eligibleTeamCalls = 0;
  let alreadyTracked = 0;
  let exactPermanentKey = 0;
  let canonicalFallback = 0;
  let legacyFallback = 0;

  (teamRecords || []).forEach(
    function(teamRecord){

      if(
        !REC_isEligibleTeamCallV14_(
          teamRecord
        )
      ){
        return;
      }

      const callKey =
        REC_teamCallIdentityV14_(
          teamRecord
        );

      if(
        !callKey ||
        seen[callKey]
      ){
        return;
      }

      seen[callKey] = true;
      eligibleTeamCalls++;

      const pool =
        REC_getTrackerPoolV141_(
          teamRecord,
          trackerIndex
        );

      const result =
        REC_findTrackedTeamCallV142_(
          teamRecord,
          pool
        );

      if(!result.tracked)
        return;

      alreadyTracked++;

      if(
        result.matchType ===
        "EXACT_PERMANENT_KEY"
      ){
        exactPermanentKey++;
      }else if(
        result.matchType ===
        "CANONICAL_FALLBACK"
      ){
        canonicalFallback++;
      }else{
        legacyFallback++;
      }

      if(
        suppressedSamples.length < 50
      ){
        suppressedSamples.push({
          candidate:
            teamRecord.candidate,
          client:
            teamRecord.client,
          fromRound:
            teamRecord.round,
          teamDate:
            REC_dateKey(
              teamRecord.dateObj
            ),
          handler:
            teamRecord.handler,
          matchType:
            result.matchType,
          trackerCandidate:
            result.tracker
              ? result.tracker.candidate
              : "",
          trackerClient:
            result.tracker
              ? result.tracker.client
              : "",
          trackerFrom:
            result.tracker
              ? result.tracker.fromRound
              : "",
          trackerTo:
            result.tracker
              ? result.tracker.toRound
              : "",
          trackerPreviousDate:
            result.tracker
              ? result.tracker.previousDateKey
              : "",
          trackerStatus:
            result.tracker
              ? result.tracker.status
              : ""
        });
      }

    }
  );

  const result = {
    ok:true,
    mode:
      "READ_ONLY_RECOVERY_PERMANENT_DUPLICATE_GUARD_V1_4_2",
    version:
      "RECOVERY-1.4.2",
    teamRecords:
      teamRecords.length,
    trackerPromotionRecords:
      trackerRecords.length,
    eligibleTeamCalls:
      eligibleTeamCalls,
    alreadyTrackedSuppressed:
      alreadyTracked,
    matchTypes:{
      exactPermanentKey:
        exactPermanentKey,
      canonicalFallback:
        canonicalFallback,
      legacySimilarityFallback:
        legacyFallback
    },
    suppressedSamples:
      suppressedSamples
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
 * ROUND NUMBER FROM TEXT
 ******************************************************/
function REC_roundNumberFromText(round){

  const value =
    String(round || "")
      .trim();

  if(!value)
    return 0;

  if(/^final$/i.test(value))
    return 999;

  const patterns = [
    /\b(\d{1,2})\s*(?:st|nd|rd|th)\s*(?:Round|Rd)\b/i,
    /\bRound\s*[-:#]?\s*(\d{1,2})\b/i,
    /\bR\s*[-:#]?\s*(\d{1,2})\b/i,
    /\b(\d{1,2})\s*Round\b/i
  ];

  for(let i=0;i<patterns.length;i++){
    const match = value.match(patterns[i]);
    if(match)
      return parseInt(match[1],10);
  }

  return 0;

}


/******************************************************
 * PROMOTION AMOUNT
 ******************************************************/
function REC_getPromotionAmount(teamRecord,rawRecord){

  const fromRoundNo = Number(teamRecord && teamRecord.roundNo) || 0;
  const toRoundNo = Number(rawRecord && rawRecord.roundNo) || 0;

  if(fromRoundNo <= 0 || toRoundNo <= 0)
    return 0;

  const isHigher = toRoundNo === 999
    ? fromRoundNo !== 999
    : (fromRoundNo !== 999 && toRoundNo > fromRoundNo);

  if(!isHigher)
    return 0;

  if(fromRoundNo === 1){
    return (
      typeof INCENTIVES !== "undefined" &&
      Number(INCENTIVES.FIRST_PROMOTION) > 0
    ) ? Number(INCENTIVES.FIRST_PROMOTION) : 100;
  }

  if(fromRoundNo >= 2){
    return (
      typeof INCENTIVES !== "undefined" &&
      Number(INCENTIVES.PROMOTION) > 0
    ) ? Number(INCENTIVES.PROMOTION) : 500;
  }

  return 0;
}


/******************************************************
 * RECOVERY ID
 ******************************************************/
function REC_buildRecoveryId(teamRecord,rawRecord){

  // Recovery identity is anchored to the Team-handled call,
  // not to whichever later Raw row happens to prove progression.
  const fingerprint = [
    REC_normalizeCandidate(teamRecord && teamRecord.candidate),
    REC_normalizeClient(teamRecord && teamRecord.client),
    Number(teamRecord && teamRecord.roundNo) || 0,
    REC_dateKey(teamRecord && teamRecord.dateObj),
    REC_normalizeHandler(teamRecord && teamRecord.handler)
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

  const normalRecords =
    loadRawData();

  //--------------------------------------------------
  // IMPORTANT: Recovery fallback reads the SAME
  // Pradeep operations Raw Data as the normal parser.
  //--------------------------------------------------

  const sheet =
    IR_operations_()
      .getSheetByName(
        CONFIG.RAW_SHEET
      );

  if(!sheet){
    throw new Error(
      "Raw Data sheet not found in shared operations workbook."
    );
  }

  const values =
    sheet.getDataRange().getValues();

  const fallbackRecords = [];
  let currentDate = null;

  for(let i=0;i<values.length;i++){

    const colB =
      values[i][1];

    if(colB instanceof Date){
      currentDate = new Date(colB);
      continue;
    }

    if(
      !colB ||
      !(currentDate instanceof Date)
    ){
      continue;
    }

    const normalInterview =
      parseInterview(colB);

    if(normalInterview)
      continue;

    const fallbackInterview =
      REC_parseFallbackRawInterview(
        colB
      );

    if(!fallbackInterview)
      continue;

    fallbackInterview.dateObj =
      new Date(currentDate);

    fallbackInterview.dateText =
      formatDate(currentDate);

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

  const value =
    String(text || "")
      .trim();

  if(!value)
    return null;

  //--------------------------------------------------
  // First reuse the hardened normal parser.
  //--------------------------------------------------

  if(typeof parseInterview === "function"){
    const normal = parseInterview(value);
    if(normal)
      return normal;
  }

  //--------------------------------------------------
  // Legacy recovery-only time-first layout:
  // Candidate - Interview - 8:30 PM IST Client (2nd Round)
  //--------------------------------------------------

  const normalized =
    value
      .replace(/[–—]/g,"-")
      .replace(/-{2,}/g," - ")
      .replace(/\s*-\s*/g," - ")
      .replace(/\s+/g," ")
      .trim();

  const firstDash =
    normalized.indexOf(" - ");

  if(firstDash < 0)
    return null;

  const candidate =
    normalized
      .substring(0,firstDash)
      .replace(/\([^)]*\)/g," ")
      .replace(/\s+/g," ")
      .trim();

  if(!candidate)
    return null;

  const remaining =
    normalized
      .substring(firstDash + 3)
      .trim();

  const interviewMatch =
    remaining.match(
      /^(?:Interview|Phone Interview|Phone Call|Recruiter Call)\s+-\s+(.*)$/i
    );

  if(!interviewMatch)
    return null;

  const tail =
    String(interviewMatch[1] || "")
      .trim();

  const timeFirstMatch =
    tail.match(
      /^(\d{1,2})(?::(\d{2}))?\s*([AP]M)\s*(?:IST\b)?\s*(.*)$/i
    );

  if(!timeFirstMatch)
    return null;

  const hour =
    parseInt(timeFirstMatch[1],10);

  const minute =
    timeFirstMatch[2] || "00";

  const time =
    hour + ":" + minute + " " +
    String(timeFirstMatch[3] || "")
      .toUpperCase();

  let clientPart =
    String(timeFirstMatch[4] || "")
      .trim();

  let roundInfo = null;

  if(typeof PARSER_extractRound_ === "function"){
    roundInfo = PARSER_extractRound_(value);
  }

  if(!roundInfo){

    const ordinal =
      value.match(
        /\b(\d{1,2})\s*(?:st|nd|rd|th)\s*Round\b/i
      );

    if(ordinal){
      const n = parseInt(ordinal[1],10);
      roundInfo = {
        round: REC_roundLabel(n),
        roundNo: n
      };
    }else if(/\bFinal\b/i.test(value)){
      roundInfo = {
        round: "Final",
        roundNo: 999
      };
    }

  }

  if(!roundInfo)
    return null;

  clientPart =
    clientPart
      .replace(/\([^)]*(?:Round|Rd)[^)]*\).*$/i," ")
      .replace(/\s*-?\s*Duration\s*:?.*$/i," ")
      .replace(/^[-:\s]+|[-:\s]+$/g," ")
      .replace(/\s+/g," ")
      .trim();

  clientPart =
    REC_stripInterviewStageFromClient_(
      clientPart
    );

  if(!clientPart)
    return null;

  return {
    candidate: candidate,
    client: clientPart,
    round: roundInfo.round,
    roundNo: roundInfo.roundNo,
    time: time,
    isLoopInterview: /\bLoop\s+Interview\b/i.test(value),
    originalText: value,
    recoveryFallback: true
  };

}



