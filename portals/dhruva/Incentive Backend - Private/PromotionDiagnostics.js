
/******************************************************
 * PROMOTION MISSED-DIAGNOSTICS
 * Version 1.0 - READ ONLY
 *
 * PURPOSE
 * -------
 * Scan ALL Team Data records against ALL Raw Data records
 * and explain why a promotion was or was not recognized.
 *
 * NO SHEET WRITES.
 * NO INCENTIVE WRITES.
 * NO BUSINESS-RULE CHANGES.
 *
 * Requires v1.6 Parser + PromotionEngine already installed.
 ******************************************************/


/******************************************************
 * MAIN FULL-DATA DIAGNOSTIC
 ******************************************************/
function diagnoseAllPromotionMissesV16ReadOnly(){

  PARSER_IDENTITY_CACHE_ = null;

  const rawOriginal =
    loadRawData();

  const teamOriginal =
    loadTeamData();

  const raw =
    PARSER_repairPromotionRecordsV16_(
      rawOriginal
    );

  const team =
    PARSER_repairPromotionRecordsV16_(
      teamOriginal
    );

  const promotions =
    buildPromotionHistory(
      raw,
      team
    );

  //--------------------------------------------------
  // Build lookup of actual promotions already found.
  //--------------------------------------------------

  const promoLookup = {};

  promotions.forEach(
    function(p){

      const key =
        PMD_identityKey_(
          p.candidate,
          p.client
        );

      if(!promoLookup[key]){
        promoLookup[key] = [];
      }

      promoLookup[key].push(p);

    }
  );

  //--------------------------------------------------
  // Build Raw identity index.
  //--------------------------------------------------

  const rawByIdentity = {};

  raw.forEach(
    function(r){

      const key =
        PMD_identityKey_(
          r.candidate,
          r.client
        );

      if(!key)
        return;

      if(!rawByIdentity[key]){
        rawByIdentity[key] = [];
      }

      rawByIdentity[key].push(r);

    }
  );

  Object.keys(rawByIdentity)
    .forEach(
      function(key){

        rawByIdentity[key]
          .sort(
            PMD_compareRecords_
          );

      }
    );

  //--------------------------------------------------
  // Candidate-only Raw index.
  // Used to detect client mismatch situations.
  //--------------------------------------------------

  const rawByCandidate = {};

  raw.forEach(
    function(r){

      const candidateKey =
        PARSER_identityKey_(
          r.candidate || ""
        );

      if(!candidateKey)
        return;

      if(!rawByCandidate[candidateKey]){
        rawByCandidate[candidateKey] = [];
      }

      rawByCandidate[candidateKey].push(r);

    }
  );

  //--------------------------------------------------
  // Client-only Raw index.
  // Used to detect candidate mismatch situations.
  //--------------------------------------------------

  const rawByClient = {};

  raw.forEach(
    function(r){

      const clientKey =
        PARSER_identityKey_(
          r.client || ""
        );

      if(!clientKey)
        return;

      if(!rawByClient[clientKey]){
        rawByClient[clientKey] = [];
      }

      rawByClient[clientKey].push(r);

    }
  );

  //--------------------------------------------------
  // Team invalid-status index.
  //--------------------------------------------------

  const allTeamByIdentity = {};

  team.forEach(
    function(r){

      const key =
        PMD_identityKey_(
          r.candidate,
          r.client
        );

      if(!key)
        return;

      if(!allTeamByIdentity[key]){
        allTeamByIdentity[key] = [];
      }

      allTeamByIdentity[key].push(r);

    }
  );

  //--------------------------------------------------
  // Diagnose each valid owned Team call.
  //--------------------------------------------------

  const diagnostics = [];

  team.forEach(
    function(teamRecord){

      if(
        !teamRecord ||
        !teamRecord.candidate ||
        !teamRecord.client ||
        !Number(teamRecord.roundNo)
      ){
        return;
      }

      if(
        !PMD_isValidOwnedHandler_(
          teamRecord.handler
        )
      ){
        return;
      }

      const diagnosis =
        PMD_diagnoseTeamRecord_(
          teamRecord,
          rawByIdentity,
          rawByCandidate,
          rawByClient,
          promoLookup,
          allTeamByIdentity
        );

      diagnostics.push(
        diagnosis
      );

    }
  );

  //--------------------------------------------------
  // Remove duplicates caused by duplicate Team rows.
  //--------------------------------------------------

  const deduped = [];
  const seen = {};

  diagnostics.forEach(
    function(d){

      const key = [
        PARSER_identityKey_(d.candidate),
        PARSER_identityKey_(d.client),
        Number(d.fromRoundNo) || 0,
        d.teamDate || "",
        PMD_normalizeHandler_(d.handler)
      ].join("||");

      if(seen[key])
        return;

      seen[key] = true;
      deduped.push(d);

    }
  );

  //--------------------------------------------------
  // Summaries.
  //--------------------------------------------------

  const reasonCounts = {};
  const handlerCounts = {};
  const statusCounts = {};

  deduped.forEach(
    function(d){

      reasonCounts[d.reason] =
        (
          reasonCounts[d.reason] ||
          0
        ) + 1;

      statusCounts[d.status] =
        (
          statusCounts[d.status] ||
          0
        ) + 1;

      const handler =
        PMD_displayHandler_(
          d.handler
        );

      if(!handlerCounts[handler]){

        handlerCounts[handler] = {
          total:0,
          recognized:0,
          missed:0,
          review:0,
          reasons:{}
        };

      }

      handlerCounts[handler].total++;

      if(d.status === "PROMOTION_RECOGNIZED")
        handlerCounts[handler].recognized++;
      else if(d.status === "REVIEW_NEEDED")
        handlerCounts[handler].review++;
      else
        handlerCounts[handler].missed++;

      handlerCounts[handler].reasons[d.reason] =
        (
          handlerCounts[handler]
            .reasons[d.reason] ||
          0
        ) + 1;

    }
  );

  //--------------------------------------------------
  // High-signal missed/review records only.
  //--------------------------------------------------

  const unresolved =
    deduped.filter(
      function(d){
        return d.status !==
          "PROMOTION_RECOGNIZED";
      }
    );

  //--------------------------------------------------
  // Known sample visibility.
  // This does NOT affect logic.
  //--------------------------------------------------

  const sampleCases = [
    ["Mani teja A","Aspenpublishing"],
    ["Sravani thurlapati","UC Davis Health"],
    ["Navya Sree Rama","Adyen"],
    ["Satya Pavan Vignesh Veera","Integrity Marketing Group"],
    ["Yeswanthi Chowdavaram","Clinical Architecture"]
  ];

  const samples =
    sampleCases.map(
      function(item){

        const target =
          PMD_identityKey_(
            item[0],
            item[1]
          );

        return {
          candidate:item[0],
          client:item[1],
          diagnostics:
            deduped.filter(
              function(d){
                return (
                  PMD_identityKey_(
                    d.candidate,
                    d.client
                  ) === target
                );
              }
            )
        };

      }
    );

  const result = {
    ok:true,
    mode:
      "READ_ONLY_FULL_PROMOTION_MISS_DIAGNOSTICS_V1",
    version:
      "PROMOTION-DIAGNOSTICS-1.0",
    rawRecords:
      raw.length,
    teamRecords:
      team.length,
    recognizedPromotions:
      promotions.length,
    diagnosedTeamCalls:
      deduped.length,
    unresolvedCount:
      unresolved.length,
    statusCounts:
      statusCounts,
    reasonCounts:
      reasonCounts,
    handlers:
      handlerCounts,
    knownSamples:
      samples,
    unresolvedPreview:
      unresolved.slice(0,150)
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
 * DIAGNOSE ONE TEAM-OWNED CALL
 ******************************************************/
function PMD_diagnoseTeamRecord_(
  teamRecord,
  rawByIdentity,
  rawByCandidate,
  rawByClient,
  promoLookup,
  allTeamByIdentity
){

  const identityKey =
    PMD_identityKey_(
      teamRecord.candidate,
      teamRecord.client
    );

  const fromRoundNo =
    Number(
      teamRecord.roundNo
    ) || 0;

  const sameIdentityRaw =
    rawByIdentity[identityKey] || [];

  const existingPromos =
    promoLookup[identityKey] || [];

  //--------------------------------------------------
  // Was this exact Team call already credited?
  //--------------------------------------------------

  const matchingPromotion =
    existingPromos.find(
      function(p){

        if(
          Number(
            p.previousRoundNo
          ) !== fromRoundNo
        ){
          return false;
        }

        if(
          !PMD_sameDate_(
            p.previousDate,
            teamRecord.dateObj
          )
        ){
          return false;
        }

        return true;

      }
    );

  if(matchingPromotion){

    return PMD_result_(
      teamRecord,
      "PROMOTION_RECOGNIZED",
      "PROMOTION_FOUND",
      {
        nextRound:
          matchingPromotion.promotionRound,
        nextRoundNo:
          matchingPromotion.promotionRoundNo,
        nextDate:
          PMD_dateKey_(
            matchingPromotion.promotionDate
          ),
        promotionHandler:
          matchingPromotion.handler || ""
      }
    );

  }

  //--------------------------------------------------
  // Same Candidate + Client Raw history.
  //--------------------------------------------------

  const laterSameIdentity =
    sameIdentityRaw.filter(
      function(rawRecord){

        return PMD_isLaterRecord_(
          teamRecord,
          rawRecord
        );

      }
    );

  const higherSameIdentity =
    laterSameIdentity.filter(
      function(rawRecord){

        return PMD_isHigherRound_(
          fromRoundNo,
          rawRecord.roundNo
        );

      }
    );

  //--------------------------------------------------
  // No later raw records for same identity at all.
  //--------------------------------------------------

  if(!laterSameIdentity.length){

    const candidateKey =
      PARSER_identityKey_(
        teamRecord.candidate || ""
      );

    const clientKey =
      PARSER_identityKey_(
        teamRecord.client || ""
      );

    const candidateRaw =
      rawByCandidate[candidateKey] || [];

    const clientRaw =
      rawByClient[clientKey] || [];

    const laterCandidate =
      candidateRaw.filter(
        function(r){
          return PMD_isLaterRecord_(
            teamRecord,
            r
          );
        }
      );

    //------------------------------------------------
    // Same Candidate later exists but under another
    // Client identity -> likely client mismatch/alias.
    //------------------------------------------------

    if(laterCandidate.length){

      return PMD_result_(
        teamRecord,
        "PROMOTION_MISSED",
        "LIKELY_CLIENT_IDENTITY_MISMATCH",
        {
          candidateLaterRaw:
            PMD_compactRecords_(
              laterCandidate,
              12
            )
        }
      );

    }

    const laterClient =
      clientRaw.filter(
        function(r){
          return PMD_isLaterRecord_(
            teamRecord,
            r
          );
        }
      );

    //------------------------------------------------
    // Same Client later exists but Candidate differs.
    //------------------------------------------------

    if(laterClient.length){

      return PMD_result_(
        teamRecord,
        "PROMOTION_MISSED",
        "LIKELY_CANDIDATE_IDENTITY_MISMATCH",
        {
          clientLaterRaw:
            PMD_compactRecords_(
              laterClient,
              12
            )
        }
      );

    }

    return PMD_result_(
      teamRecord,
      "PROMOTION_MISSED",
      "NO_LATER_RAW_RECORD_FOUND",
      {}
    );

  }

  //--------------------------------------------------
  // Later Raw exists, but no higher round.
  //--------------------------------------------------

  if(!higherSameIdentity.length){

    const missingRound =
      laterSameIdentity.filter(
        function(r){
          return !Number(r.roundNo);
        }
      );

    if(missingRound.length){

      return PMD_result_(
        teamRecord,
        "REVIEW_NEEDED",
        "LATER_RAW_ROUND_MISSING",
        {
          laterRaw:
            PMD_compactRecords_(
              laterSameIdentity,
              12
            )
        }
      );

    }

    const sameOrLower =
      laterSameIdentity.map(
        function(r){
          return Number(r.roundNo) || 0;
        }
      );

    return PMD_result_(
      teamRecord,
      "PROMOTION_MISSED",
      "NO_HIGHER_ROUND_IN_LATER_RAW",
      {
        laterRounds:
          sameOrLower,
        laterRaw:
          PMD_compactRecords_(
            laterSameIdentity,
            12
          )
      }
    );

  }

  //--------------------------------------------------
  // There IS a later higher Raw round, but no promotion
  // was created. Determine why.
  //--------------------------------------------------

  const orderedHigher =
    higherSameIdentity
      .slice()
      .sort(
        PMD_compareRecords_
      );

  const firstHigher =
    orderedHigher[0];

  const directStep =
    PMD_isDirectProgression_(
      fromRoundNo,
      firstHigher.roundNo
    );

  const sameDate =
    PMD_sameDate_(
      teamRecord.dateObj,
      firstHigher.dateObj
    );

  //--------------------------------------------------
  // Same-day non-direct jump is intentionally review.
  //--------------------------------------------------

  if(
    sameDate &&
    !directStep &&
    !PMD_isLoop_(
      teamRecord,
      firstHigher
    )
  ){

    return PMD_result_(
      teamRecord,
      "REVIEW_NEEDED",
      "SAME_DAY_SKIPPED_ROUND_REVIEW",
      {
        higherRaw:
          PMD_compactRecords_(
            orderedHigher,
            12
          )
      }
    );

  }

  //--------------------------------------------------
  // Same-day direct step but time did not move forward.
  //--------------------------------------------------

  if(
    sameDate &&
    directStep &&
    !PMD_isOperationallyLater_(
      teamRecord,
      firstHigher
    )
  ){

    return PMD_result_(
      teamRecord,
      "REVIEW_NEEDED",
      "SAME_DAY_TIME_NOT_LATER",
      {
        higherRaw:
          PMD_compactRecords_(
            orderedHigher,
            12
          )
      }
    );

  }

  //--------------------------------------------------
  // Higher Raw is valid, inspect Team duplicates/status.
  //--------------------------------------------------

  const sameIdentityTeam =
    allTeamByIdentity[identityKey] || [];

  const laterRoundTeamCopies =
    sameIdentityTeam.filter(
      function(r){

        return (
          Number(r.roundNo) ===
            Number(firstHigher.roundNo) &&
          PMD_sameDate_(
            r.dateObj,
            firstHigher.dateObj
          )
        );

      }
    );

  if(laterRoundTeamCopies.length){

    const hasValidCopy =
      laterRoundTeamCopies.some(
        function(r){
          return PMD_isValidOwnedHandler_(
            r.handler
          );
        }
      );

    if(!hasValidCopy){

      return PMD_result_(
        teamRecord,
        "REVIEW_NEEDED",
        "ONLY_INVALID_OR_RESCHEDULED_TEAM_COPY_FOR_LATER_ROUND",
        {
          laterTeam:
            PMD_compactTeamRecords_(
              laterRoundTeamCopies,
              12
            ),
          higherRaw:
            PMD_compactRecords_(
              orderedHigher,
              12
            )
        }
      );

    }

  }

  //--------------------------------------------------
  // At this point the data looks promotion-worthy but
  // engine still produced nothing.
  // This is the highest-value diagnostic bucket.
  //--------------------------------------------------

  return PMD_result_(
    teamRecord,
    "PROMOTION_MISSED",
    "HIGHER_RAW_EXISTS_BUT_ENGINE_DID_NOT_CREDIT",
    {
      higherRaw:
        PMD_compactRecords_(
          orderedHigher,
          12
        ),
      laterTeam:
        PMD_compactTeamRecords_(
          laterRoundTeamCopies,
          12
        )
    }
  );

}


/******************************************************
 * RESULT SHAPE
 ******************************************************/
function PMD_result_(
  teamRecord,
  status,
  reason,
  extra
){

  const result = {
    candidate:
      teamRecord.candidate || "",
    client:
      teamRecord.client || "",
    fromRound:
      teamRecord.round || "",
    fromRoundNo:
      Number(teamRecord.roundNo) || 0,
    handler:
      PMD_displayHandler_(
        teamRecord.handler
      ),
    teamDate:
      PMD_dateKey_(
        teamRecord.dateObj
      ),
    teamTime:
      teamRecord.time || "",
    status:
      status,
    reason:
      reason,
    teamOriginalText:
      teamRecord.originalText || ""
  };

  Object.keys(
    extra || {}
  ).forEach(
    function(key){
      result[key] = extra[key];
    }
  );

  return result;

}


/******************************************************
 * IDENTITY
 ******************************************************/
function PMD_identityKey_(
  candidate,
  client
){

  if(
    !candidate ||
    !client
  ){
    return "";
  }

  return [
    PARSER_identityKey_(
      candidate
    ),
    PARSER_identityKey_(
      client
    )
  ].join("||");

}


/******************************************************
 * HANDLER NORMALIZATION
 *
 * Fixes audit display such as:
 *   Karthik
 *   karthik
 *
 * into one bucket without changing ownership logic.
 ******************************************************/
function PMD_normalizeHandler_(
  handler
){

  return String(
    handler || ""
  )
    .trim()
    .toLowerCase()
    .replace(/\s+/g," ");

}


function PMD_displayHandler_(
  handler
){

  const clean =
    String(
      handler || ""
    )
      .trim()
      .replace(/\s+/g," ");

  if(!clean)
    return "";

  return clean
    .split(" ")
    .map(
      function(word){

        if(!word)
          return "";

        return (
          word.charAt(0).toUpperCase() +
          word.substring(1).toLowerCase()
        );

      }
    )
    .join(" ");

}


function PMD_isValidOwnedHandler_(
  handler
){

  const value =
    PMD_normalizeHandler_(
      handler
    );

  if(!value)
    return false;

  return !/^(?:cancelled|canceled|rescheduled|reschedule|cancel|na|n\/a|none|null|not\s+handled)$/i
    .test(
      value
    );

}


/******************************************************
 * CHRONOLOGY
 ******************************************************/
function PMD_compareRecords_(
  a,
  b
){

  const ad =
    a &&
    a.dateObj instanceof Date
      ? a.dateObj.getTime()
      : 0;

  const bd =
    b &&
    b.dateObj instanceof Date
      ? b.dateObj.getTime()
      : 0;

  if(ad !== bd)
    return ad - bd;

  const at =
    PROMO_operationalMinutes_(
      a && a.time
    );

  const bt =
    PROMO_operationalMinutes_(
      b && b.time
    );

  if(at !== bt)
    return at - bt;

  return (
    Number(a && a.roundNo) -
    Number(b && b.roundNo)
  );

}


function PMD_isLaterRecord_(
  earlier,
  later
){

  if(
    !earlier ||
    !later ||
    !(earlier.dateObj instanceof Date) ||
    !(later.dateObj instanceof Date)
  ){
    return false;
  }

  const ed =
    earlier.dateObj.getTime();

  const ld =
    later.dateObj.getTime();

  if(ld > ed)
    return true;

  if(ld < ed)
    return false;

  //--------------------------------------------------
  // Same working-date block.
  //--------------------------------------------------

  const et =
    PROMO_operationalMinutes_(
      earlier.time
    );

  const lt =
    PROMO_operationalMinutes_(
      later.time
    );

  if(
    et >= 0 &&
    lt >= 0
  ){
    return lt > et;
  }

  //--------------------------------------------------
  // When time is missing, a strictly higher round on
  // the same date is treated as "later candidate data"
  // for diagnostics only. It is NOT auto-credited here.
  //--------------------------------------------------

  return (
    Number(later.roundNo) >
    Number(earlier.roundNo)
  );

}


function PMD_isOperationallyLater_(
  earlier,
  later
){

  const et =
    PROMO_operationalMinutes_(
      earlier.time
    );

  const lt =
    PROMO_operationalMinutes_(
      later.time
    );

  if(
    et < 0 ||
    lt < 0
  ){
    return false;
  }

  return lt > et;

}


function PMD_sameDate_(
  a,
  b
){

  return (
    a instanceof Date &&
    b instanceof Date &&
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );

}


function PMD_dateKey_(
  date
){

  if(
    !(date instanceof Date)
  ){
    return "";
  }

  return [
    date.getFullYear(),
    String(
      date.getMonth()+1
    ).padStart(2,"0"),
    String(
      date.getDate()
    ).padStart(2,"0")
  ].join("-");

}


/******************************************************
 * ROUND LOGIC
 ******************************************************/
function PMD_isHigherRound_(
  fromRoundNo,
  toRoundNo
){

  const from =
    Number(
      fromRoundNo
    ) || 0;

  const to =
    Number(
      toRoundNo
    ) || 0;

  if(
    !from ||
    !to
  ){
    return false;
  }

  //--------------------------------------------------
  // Final = 999.
  //--------------------------------------------------

  if(to === 999)
    return from !== 999;

  if(from === 999)
    return false;

  return to > from;

}


function PMD_isDirectProgression_(
  fromRoundNo,
  toRoundNo
){

  const from =
    Number(
      fromRoundNo
    ) || 0;

  const to =
    Number(
      toRoundNo
    ) || 0;

  if(!from || !to)
    return false;

  if(to === 999)
    return true;

  return to === from + 1;

}


function PMD_isLoop_(
  current,
  next
){

  return !!(
    current &&
    current.isLoopInterview ||
    next &&
    next.isLoopInterview ||
    /\bLoop\s+Interview\b/i
      .test(
        String(
          current &&
          current.originalText ||
          ""
        )
      ) ||
    /\bLoop\s+Interview\b/i
      .test(
        String(
          next &&
          next.originalText ||
          ""
        )
      )
  );

}


/******************************************************
 * COMPACT RECORD VIEWS
 ******************************************************/
function PMD_compactRecords_(
  records,
  limit
){

  const max =
    Number(limit) || 10;

  return (
    records || []
  )
    .slice(0,max)
    .map(
      function(r){

        return {
          candidate:
            r.candidate || "",
          client:
            r.client || "",
          role:
            r.role || "",
          round:
            r.round || "",
          roundNo:
            Number(r.roundNo) || 0,
          date:
            PMD_dateKey_(
              r.dateObj
            ),
          time:
            r.time || "",
          originalText:
            r.originalText || ""
        };

      }
    );

}


function PMD_compactTeamRecords_(
  records,
  limit
){

  const max =
    Number(limit) || 10;

  return (
    records || []
  )
    .slice(0,max)
    .map(
      function(r){

        return {
          candidate:
            r.candidate || "",
          client:
            r.client || "",
          role:
            r.role || "",
          round:
            r.round || "",
          roundNo:
            Number(r.roundNo) || 0,
          date:
            PMD_dateKey_(
              r.dateObj
            ),
          time:
            r.time || "",
          handler:
            PMD_displayHandler_(
              r.handler
            ),
          status:
            r.status || "",
          originalText:
            r.originalText || ""
        };

      }
    );

}


/******************************************************
 * KNOWN SAMPLE-ONLY SHORT VIEW
 *
 * Convenience function so Apps Script logs do not get
 * overwhelmed. Still READ ONLY.
 ******************************************************/
function diagnoseKnownPromotionSamplesV16ReadOnly(){

  const full =
    diagnoseAllPromotionMissesV16ReadOnly();

  const result = {
    ok:true,
    mode:
      "READ_ONLY_KNOWN_SAMPLE_PROMOTION_DIAGNOSTICS_V1",
    version:
      "PROMOTION-DIAGNOSTICS-1.0",
    knownSamples:
      full.knownSamples
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
 * HIGH-SIGNAL ENGINE MISSES ONLY
 *
 * Shows records where a valid later higher Raw round
 * exists but buildPromotionHistory() still did not
 * create the incentive.
 ******************************************************/
function diagnoseEnginePromotionMissesV16ReadOnly(){

  const full =
    diagnoseAllPromotionMissesV16ReadOnly();

  const engineMisses =
    (
      full.unresolvedPreview ||
      []
    ).filter(
      function(d){
        return d.reason ===
          "HIGHER_RAW_EXISTS_BUT_ENGINE_DID_NOT_CREDIT";
      }
    );

  const result = {
    ok:true,
    mode:
      "READ_ONLY_ENGINE_PROMOTION_MISSES_V1",
    version:
      "PROMOTION-DIAGNOSTICS-1.0",
    count:
      engineMisses.length,
    records:
      engineMisses
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
 * PROMOTION SOURCE TRACE
 * Version 1.0 - READ ONLY
 *
 * PURPOSE
 * -------
 * Inspect ORIGINAL Raw Data / Team Data rows before the
 * normal parser discards or transforms them.
 *
 * This is the correct next diagnostic for cases where:
 * - a known candidate/client produces no diagnostic row
 * - a later round exists in the sheet but not in parsed data
 * - a shortened/alternate client name is being parsed
 *
 * NO SHEET WRITES.
 * NO INCENTIVE WRITES.
 ******************************************************/


/******************************************************
 * TRACE ONE CANDIDATE / CLIENT
 *
 * Can also be called from another function:
 *
 * tracePromotionSourceRowsV16ReadOnly(
 *   "Navya Sree Rama",
 *   "Adyen"
 * )
 ******************************************************/
function tracePromotionSourceRowsV16ReadOnly(
  candidate,
  client
){

  const candidateNeedle =
    PSTRACE_loose_(
      candidate
    );

  const clientNeedle =
    PSTRACE_loose_(
      client
    );

  if(!candidateNeedle){
    throw new Error(
      "Candidate is required."
    );
  }

  const operations =
    IR_operations_();

  const rawSheet =
    operations.getSheetByName(
      CONFIG.RAW_SHEET
    );

  const teamSheet =
    operations.getSheetByName(
      CONFIG.TEAM_SHEET
    );

  if(!rawSheet){
    throw new Error(
      "Raw Data sheet not found."
    );
  }

  if(!teamSheet){
    throw new Error(
      "Team Data sheet not found."
    );
  }

  const rawValues =
    rawSheet
      .getDataRange()
      .getValues();

  const teamValues =
    teamSheet
      .getDataRange()
      .getValues();

  const rawMatches = [];
  const teamMatches = [];

  //--------------------------------------------------
  // RAW DATA ORIGINAL ROW TRACE
  //--------------------------------------------------

  let rawCurrentDate = null;

  for(
    let i=0;
    i<rawValues.length;
    i++
  ){

    const colB =
      rawValues[i][1];

    if(colB instanceof Date){

      rawCurrentDate =
        new Date(
          colB
        );

      continue;

    }

    if(!colB)
      continue;

    const original =
      String(
        colB || ""
      ).trim();

    if(
      !PSTRACE_containsCandidate_(
        original,
        candidateNeedle
      )
    ){
      continue;
    }

    const parsed =
      parseInterview(
        original
      );

    const repaired =
      parsed
        ? PARSER_repairPromotionRecordIdentityV16_(
            Object.assign(
              {},
              parsed,
              {
                dateObj:
                  rawCurrentDate
                    ? new Date(rawCurrentDate)
                    : null
              }
            )
          )
        : null;

    rawMatches.push({
      sheetRow:
        i + 1,
      date:
        rawCurrentDate
          ? PSTRACE_dateKey_(
              rawCurrentDate
            )
          : "",
      originalText:
        original,
      containsRequestedClientText:
        clientNeedle
          ? (
              PSTRACE_loose_(
                original
              ).indexOf(
                clientNeedle
              ) !== -1
            )
          : null,
      parseInterviewSucceeded:
        !!parsed,
      parsed:
        repaired
          ? PSTRACE_compactParsed_(
              repaired
            )
          : null
    });

  }

  //--------------------------------------------------
  // TEAM DATA ORIGINAL ROW TRACE
  //--------------------------------------------------

  let teamCurrentDate = null;

  for(
    let j=0;
    j<teamValues.length;
    j++
  ){

    const colA =
      teamValues[j][0];

    const colB =
      teamValues[j][1];

    const colC =
      teamValues[j][2];

    const colD =
      teamValues[j][3];

    const colE =
      teamValues[j][4];

    if(
      colA &&
      !colB
    ){

      teamCurrentDate =
        parseSheetDate(
          colA
        );

      continue;

    }

    if(!colB)
      continue;

    const original =
      String(
        colB || ""
      ).trim();

    if(
      !PSTRACE_containsCandidate_(
        original,
        candidateNeedle
      )
    ){
      continue;
    }

    const status =
      String(
        colD || ""
      )
        .trim()
        .toLowerCase();

    let parsed = null;

    if(status === "selected"){

      parsed =
        parseSelectedTeamInterviewFallback_(
          original
        );

    }else{

      parsed =
        parseInterview(
          original
        );

    }

    if(parsed){

      parsed.handler =
        String(
          colC || ""
        ).trim();

      parsed.status =
        status;

      parsed.dateObj =
        teamCurrentDate
          ? new Date(teamCurrentDate)
          : null;

      parsed.selectionDateObj =
        colE
          ? parseSheetDate(
              colE
            )
          : null;

    }

    const repaired =
      parsed
        ? PARSER_repairPromotionRecordIdentityV16_(
            parsed
          )
        : null;

    teamMatches.push({
      sheetRow:
        j + 1,
      date:
        teamCurrentDate
          ? PSTRACE_dateKey_(
              teamCurrentDate
            )
          : "",
      originalText:
        original,
      handler:
        String(
          colC || ""
        ).trim(),
      status:
        status,
      containsRequestedClientText:
        clientNeedle
          ? (
              PSTRACE_loose_(
                original
              ).indexOf(
                clientNeedle
              ) !== -1
            )
          : null,
      parseSucceeded:
        !!parsed,
      parsed:
        repaired
          ? PSTRACE_compactParsed_(
              repaired
            )
          : null
    });

  }

  //--------------------------------------------------
  // Narrow same-client views.
  //--------------------------------------------------

  const rawSameClient =
    rawMatches.filter(
      function(row){

        if(!clientNeedle)
          return true;

        if(
          row.parsed &&
          PSTRACE_loose_(
            row.parsed.client
          ) === clientNeedle
        ){
          return true;
        }

        return (
          row.containsRequestedClientText ===
          true
        );

      }
    );

  const teamSameClient =
    teamMatches.filter(
      function(row){

        if(!clientNeedle)
          return true;

        if(
          row.parsed &&
          PSTRACE_loose_(
            row.parsed.client
          ) === clientNeedle
        ){
          return true;
        }

        return (
          row.containsRequestedClientText ===
          true
        );

      }
    );

  const result = {
    ok:true,
    mode:
      "READ_ONLY_PROMOTION_SOURCE_TRACE_V1",
    version:
      "PROMOTION-SOURCE-TRACE-1.0",
    candidate:
      candidate,
    requestedClient:
      client || "",
    summary:{
      rawCandidateRows:
        rawMatches.length,
      rawSameClientRows:
        rawSameClient.length,
      rawParseFailures:
        rawMatches.filter(
          function(x){
            return !x.parseInterviewSucceeded;
          }
        ).length,
      teamCandidateRows:
        teamMatches.length,
      teamSameClientRows:
        teamSameClient.length,
      teamParseFailures:
        teamMatches.filter(
          function(x){
            return !x.parseSucceeded;
          }
        ).length
    },
    rawSameClientRows:
      rawSameClient,
    teamSameClientRows:
      teamSameClient,
    allRawCandidateRows:
      rawMatches,
    allTeamCandidateRows:
      teamMatches
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
 * TRACE THE KNOWN EXAMPLES IN ONE RUN
 ******************************************************/
function traceKnownPromotionSourceRowsV16ReadOnly(){

  const cases = [
    ["Mani teja A","Aspenpublishing"],
    ["Sravani thurlapati","UC Davis Health"],
    ["Navya Sree Rama","Adyen"],
    ["Satya Pavan Vignesh Veera","Integrity Marketing Group"],
    ["Yeswanthi Chowdavaram","Clinical Architecture"]
  ];

  const results =
    cases.map(
      function(item){

        return tracePromotionSourceRowsV16ReadOnly(
          item[0],
          item[1]
        );

      }
    );

  const compact =
    results.map(
      function(r){

        return {
          candidate:
            r.candidate,
          requestedClient:
            r.requestedClient,
          summary:
            r.summary,
          rawSameClientRows:
            r.rawSameClientRows,
          teamSameClientRows:
            r.teamSameClientRows
        };

      }
    );

  const result = {
    ok:true,
    mode:
      "READ_ONLY_KNOWN_PROMOTION_SOURCE_TRACE_V1",
    version:
      "PROMOTION-SOURCE-TRACE-1.0",
    cases:
      compact
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
 * TRACE ONLY PARSE FAILURES ACROSS ALL SOURCE ROWS
 *
 * This is useful after the known-case trace.
 ******************************************************/
function traceAllInterviewParseFailuresV16ReadOnly(){

  const operations =
    IR_operations_();

  const rawSheet =
    operations.getSheetByName(
      CONFIG.RAW_SHEET
    );

  const teamSheet =
    operations.getSheetByName(
      CONFIG.TEAM_SHEET
    );

  const rawValues =
    rawSheet
      .getDataRange()
      .getValues();

  const teamValues =
    teamSheet
      .getDataRange()
      .getValues();

  const rawFailures = [];
  const teamFailures = [];

  let rawCurrentDate = null;

  for(
    let i=0;
    i<rawValues.length;
    i++
  ){

    const value =
      rawValues[i][1];

    if(value instanceof Date){

      rawCurrentDate =
        new Date(value);

      continue;

    }

    if(!value)
      continue;

    const text =
      String(
        value || ""
      ).trim();

    //------------------------------------------------
    // Restrict to interview/call-like rows so notes
    // and unrelated content are not falsely reported.
    //------------------------------------------------

    if(
      !/\b(?:interview|phone\s+call|phn\s+call|recruiter\s+call|phone\s+screen|prep\s+call)\b/i
        .test(
          text
        )
    ){
      continue;
    }

    const parsed =
      parseInterview(
        text
      );

    if(!parsed){

      rawFailures.push({
        sheetRow:
          i + 1,
        date:
          rawCurrentDate
            ? PSTRACE_dateKey_(
                rawCurrentDate
              )
            : "",
        originalText:
          text
      });

    }

  }

  let teamCurrentDate = null;

  for(
    let j=0;
    j<teamValues.length;
    j++
  ){

    const colA =
      teamValues[j][0];

    const colB =
      teamValues[j][1];

    const colD =
      teamValues[j][3];

    if(
      colA &&
      !colB
    ){

      teamCurrentDate =
        parseSheetDate(
          colA
        );

      continue;

    }

    if(!colB)
      continue;

    const text =
      String(
        colB || ""
      ).trim();

    if(
      !/\b(?:interview|phone\s+call|phn\s+call|recruiter\s+call|phone\s+screen|prep\s+call)\b/i
        .test(
          text
        )
    ){
      continue;
    }

    const status =
      String(
        colD || ""
      )
        .trim()
        .toLowerCase();

    const parsed =
      status === "selected"
        ? parseSelectedTeamInterviewFallback_(
            text
          )
        : parseInterview(
            text
          );

    if(!parsed){

      teamFailures.push({
        sheetRow:
          j + 1,
        date:
          teamCurrentDate
            ? PSTRACE_dateKey_(
                teamCurrentDate
              )
            : "",
        status:
          status,
        originalText:
          text
      });

    }

  }

  const result = {
    ok:true,
    mode:
      "READ_ONLY_ALL_INTERVIEW_PARSE_FAILURES_V1",
    version:
      "PROMOTION-SOURCE-TRACE-1.0",
    rawFailureCount:
      rawFailures.length,
    teamFailureCount:
      teamFailures.length,
    rawFailures:
      rawFailures.slice(0,300),
    teamFailures:
      teamFailures.slice(0,300)
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
 * HELPERS
 ******************************************************/
function PSTRACE_loose_(
  value
){

  return String(
    value || ""
  )
    .toLowerCase()
    .replace(/&/g," and ")
    .replace(/[’']/g,"")
    .replace(/[^a-z0-9]+/g," ")
    .replace(/\s+/g," ")
    .trim();

}


function PSTRACE_containsCandidate_(
  source,
  candidateNeedle
){

  const haystack =
    " " +
    PSTRACE_loose_(
      source
    ) +
    " ";

  const needle =
    " " +
    candidateNeedle +
    " ";

  return (
    haystack.indexOf(
      needle
    ) !== -1
  );

}


function PSTRACE_dateKey_(
  date
){

  if(
    !(date instanceof Date)
  ){
    return "";
  }

  return [
    date.getFullYear(),
    String(
      date.getMonth()+1
    ).padStart(2,"0"),
    String(
      date.getDate()
    ).padStart(2,"0")
  ].join("-");

}


function PSTRACE_compactParsed_(
  record
){

  return {
    candidate:
      record.candidate || "",
    client:
      record.client || "",
    role:
      record.role || "",
    round:
      record.round || "",
    roundNo:
      Number(
        record.roundNo
      ) || 0,
    time:
      record.time || "",
    handler:
      record.handler || "",
    status:
      record.status || "",
    identityMatchedBy:
      record.identityMatchedBy || "",
    promotionIdentityKey:
      record.promotionIdentityKey || ""
  };

}

