/******************************************************
 * PROMOTION ENGINE
 * Version 5.8 - RESCHEDULED HIGHER-ROUND PROVES PROMOTION
 *
 * BUSINESS RULE:
 * 1) Team Data identifies a call handled by our team.
 * 2) Raw Data only has to prove that the SAME Candidate + Client
 *    later reached ANY higher round.
 * 3) The later round may be handled by any team.
 * 4) ONE promotion incentive maximum per handled Team call.
 * 5) Amount is based on the handled Team round:
 *      1st Round  -> any higher round = FIRST_PROMOTION (₹100)
 *      2nd+ Round -> any higher round = PROMOTION (₹500)
 * 6) Same-day DIRECT numbered progression can qualify when the
 *    higher round is later in operational time. Skipped-round
 *    same-day cases remain review-only unless explicitly Loop.
 * 7) If duplicate Team rows exist for a Raw occurrence, ANY valid
 *    handled copy proves the occurrence; one Cancelled/Rescheduled
 *    copy cannot suppress another valid handler copy.
 ******************************************************/

function buildPromotionHistory(rawRecords, teamRecords){

  //--------------------------------------------------
  // v1.6 HISTORICAL FORMAT RECONCILIATION
  //
  // Repair BOTH sides before any makeSmartKey() call.
  // This joins old Client-only rows with newer
  // Client + Role rows using the authoritative
  // Client Master / Client Name Map.
  //--------------------------------------------------

  const repairedRaw =
    PARSER_repairPromotionRecordsV16_(
      rawRecords || []
    );

  const repairedTeam =
    PARSER_repairPromotionRecordsV16_(
      Array.isArray(teamRecords)
        ? teamRecords
        : loadTeamData()
    );

  const raw =
    PROMO_getEffectiveRawRecords_(
      repairedRaw
    );

  const team =
    repairedTeam;

  const promotions = [];
  const seenTeamCalls = {};

  (team || []).forEach(function(teamRecord){

    if(!PROMO_isEligibleTeamCall_(teamRecord))
      return;

    const teamCallKey = PROMO_teamCallKey_(teamRecord);

    if(!teamCallKey || seenTeamCalls[teamCallKey])
      return;

    seenTeamCalls[teamCallKey] = true;

    const evidence = PROMO_findEarliestHigherEvidence_(
      teamRecord,
      raw,
      team
    );

    if(!evidence)
      return;

    promotions.push({
      candidate: teamRecord.candidate,
      client: teamRecord.client,
      previousRound: teamRecord.round,
      previousRoundNo: Number(teamRecord.roundNo) || 0,
      previousDate: teamRecord.dateObj,
      promotionRound: evidence.round,
      promotionRoundNo: Number(evidence.roundNo) || 0,
      promotionDate: evidence.dateObj,
      previousRecord: teamRecord,
      promotionRecord: evidence,
      handler: teamRecord.handler,
      teamCallKey: teamCallKey,
      evidenceSource:
        evidence.promotionEvidenceSource ||
        "RAW"
    });

  });

  return promotions;
}


/******************************************************
 * COMPATIBILITY: history-only detector
 *
 * Kept for older test/helper calls. It no longer controls the
 * production incentive scan. Production uses buildPromotionHistory()
 * with Team Data as the starting point.
 ******************************************************/
function detectPromotions(history){

  const promotions = [];

  if(!history || history.length < 2)
    return promotions;

  const sorted = history.slice().sort(PROMO_compareRecords_);

  for(let i=0;i<sorted.length-1;i++){

    const current = sorted[i];

    for(let j=i+1;j<sorted.length;j++){

      const next = sorted[j];

      if(!PROMO_isHigherRound_(current,next))
        continue;

      if(!PROMO_isChronologicallyAfter_(current,next))
        continue;

      promotions.push({
        candidate: current.candidate,
        client: current.client,
        previousRound: current.round,
        previousRoundNo: Number(current.roundNo) || 0,
        previousDate: current.dateObj,
        promotionRound: next.round,
        promotionRoundNo: Number(next.roundNo) || 0,
        promotionDate: next.dateObj,
        previousRecord: current,
        promotionRecord: next
      });

      break;
    }
  }

  return promotions;
}


function PROMO_isEligibleTeamCall_(record){

  if(
    !record ||
    !record.candidate ||
    !record.client ||
    !(record.dateObj instanceof Date)
  ){
    return false;
  }

  const roundNo = Number(record.roundNo) || 0;

  if(roundNo < 1 || roundNo === 999)
    return false;

  return PROMO_hasValidTeamHandler_(record.handler);
}


function PROMO_hasValidTeamHandler_(handler){

  const key = String(handler || "").trim().toLowerCase();

  if(!key)
    return false;

  if(/^(?:support|cancelled|canceled|rescheduled)$/.test(key))
    return false;

  if(
    typeof IGNORE_HANDLERS !== "undefined" &&
    Array.isArray(IGNORE_HANDLERS) &&
    IGNORE_HANDLERS.map(function(v){return String(v||"").trim().toLowerCase();}).indexOf(key) !== -1
  ){
    return false;
  }

  return true;
}



/******************************************************
 * CAN TEAM ROW PROVE HIGHER-ROUND PROGRESSION?
 *
 * IMPORTANT BUSINESS RULE:
 *
 * A later higher-round row marked "Rescheduled" still
 * proves that the candidate advanced to that round.
 *
 * Example:
 * Team handled Round 2.
 * Candidate later gets a Round 3 interview, but that
 * Round 3 meeting is rescheduled.
 *
 * The Round 2 handler STILL earned the promotion because
 * the candidate advanced to Round 3.
 *
 * However:
 * - Cancelled / Canceled does NOT prove progression.
 * - Support does NOT prove progression.
 * - blank does NOT prove progression.
 *
 * This helper is ONLY for higher-round EVIDENCE.
 * It does NOT make "Rescheduled" an eligible earning
 * handler for the later round itself.
 ******************************************************/
function PROMO_teamRowCanProveHigherRound_(teamRecord){

  if(!teamRecord){
    return false;
  }

  const key =
    String(
      teamRecord.handler || ""
    )
      .trim()
      .toLowerCase();

  if(!key){
    return false;
  }

  if(
    /^(?:cancelled|canceled|support)$/.test(
      key
    )
  ){
    return false;
  }

  //--------------------------------------------------
  // Explicitly allowed as evidence:
  // "rescheduled"
  //--------------------------------------------------

  if(key === "rescheduled"){
    return true;
  }

  //--------------------------------------------------
  // Normal named handler.
  //--------------------------------------------------

  return PROMO_hasValidTeamHandler_(
    teamRecord.handler
  );
}


function PROMO_findEarliestHigherEvidence_(
  teamRecord,
  rawRecords,
  teamRecords
){

  const rawCandidates = [];
  const teamKey =
    makeSmartKey(
      teamRecord.candidate,
      teamRecord.client
    );

  //--------------------------------------------------
  // PRIMARY EVIDENCE:
  // Raw Data remains the preferred source of proof.
  //--------------------------------------------------

  (rawRecords || []).forEach(
    function(rawRecord){

      if(
        !rawRecord ||
        !(rawRecord.dateObj instanceof Date) ||
        !rawRecord.candidate ||
        !rawRecord.client
      ){
        return;
      }

      if(
        makeSmartKey(
          rawRecord.candidate,
          rawRecord.client
        ) !== teamKey
      ){
        return;
      }

      if(
        !PROMO_isHigherRound_(
          teamRecord,
          rawRecord
        )
      ){
        return;
      }

      if(
        PROMO_rawOccurrenceBlockedByTeam_(
          rawRecord,
          teamRecords
        )
      ){
        return;
      }

      if(
        !PROMO_isChronologicallyAfter_(
          teamRecord,
          rawRecord
        )
      ){
        return;
      }

      rawCandidates.push(
        rawRecord
      );

    }
  );

  if(rawCandidates.length){

    rawCandidates.sort(
      PROMO_compareRecords_
    );

    rawCandidates[0].promotionEvidenceSource =
      "RAW";

    return rawCandidates[0];
  }

  //--------------------------------------------------
  // v1.8.3 SAFE FALLBACK:
  //
  // A VALID later Team Data occurrence is itself strong
  // proof that the higher round happened.
  //
  // This is used ONLY when Raw Data has no qualifying
  // higher-round evidence.
  //
  // Safety:
  // - same Candidate + Client
  // - strictly higher round
  // - chronologically later
  // - later Team row must be valid progression evidence
  // - Rescheduled DOES prove advancement to the higher round
  // - Cancelled / Support / blank do NOT prove progression
  //
  // This fixes cases where Operations Team Data contains
  // the valid next round but Raw Data missed that row.
  //--------------------------------------------------

  const teamCandidates = [];

  (teamRecords || []).forEach(
    function(higherTeamRecord){

      if(
        !higherTeamRecord ||
        higherTeamRecord === teamRecord ||
        !(higherTeamRecord.dateObj instanceof Date) ||
        !higherTeamRecord.candidate ||
        !higherTeamRecord.client
      ){
        return;
      }

      if(
        !PROMO_teamRowCanProveHigherRound_(
          higherTeamRecord
        )
      ){
        return;
      }

      if(
        makeSmartKey(
          higherTeamRecord.candidate,
          higherTeamRecord.client
        ) !== teamKey
      ){
        return;
      }

      if(
        !PROMO_isHigherRound_(
          teamRecord,
          higherTeamRecord
        )
      ){
        return;
      }

      if(
        !PROMO_isChronologicallyAfter_(
          teamRecord,
          higherTeamRecord
        )
      ){
        return;
      }

      teamCandidates.push(
        higherTeamRecord
      );

    }
  );

  if(!teamCandidates.length){
    return null;
  }

  teamCandidates.sort(
    PROMO_compareRecords_
  );

  const chosen =
    teamCandidates[0];

  const chosenHandler =
    String(
      chosen.handler || ""
    )
      .trim()
      .toLowerCase();

  chosen.promotionEvidenceSource =
    chosenHandler === "rescheduled"
      ? "TEAM_RESCHEDULED_EVIDENCE"
      : "TEAM_FALLBACK";

  return chosen;
}


function PROMO_isHigherRound_(teamRecord,rawRecord){

  const from = Number(teamRecord && teamRecord.roundNo) || 0;
  const to = Number(rawRecord && rawRecord.roundNo) || 0;

  if(from <= 0 || to <= 0)
    return false;

  if(to === 999)
    return from !== 999;

  if(from === 999)
    return false;

  return to > from;
}


function PROMO_isChronologicallyAfter_(teamRecord,rawRecord){

  const teamDate = teamRecord && teamRecord.dateObj;
  const rawDate = rawRecord && rawRecord.dateObj;

  if(!(teamDate instanceof Date) || !(rawDate instanceof Date))
    return false;

  const teamDay = PROMO_dayKey_(teamDate);
  const rawDay = PROMO_dayKey_(rawDate);

  if(rawDay > teamDay)
    return true;

  if(rawDay < teamDay)
    return false;

  //--------------------------------------------------
  // SAME WORKING DATE
  //
  // Historically the engine accepted only explicit Loop
  // Interview records. Real operations also contain legitimate
  // same-day direct progression such as R1 9:30 PM -> R2 11:00 PM.
  //
  // Safe automatic rule:
  // - explicit Loop Interview: any higher round may qualify;
  // - otherwise ONLY direct numbered progression (R1->R2,
  //   R2->R3, etc.) may qualify;
  // - the higher round must be later in operational time.
  //--------------------------------------------------

  const from = Number(teamRecord && teamRecord.roundNo) || 0;
  const to = Number(rawRecord && rawRecord.roundNo) || 0;

  const explicitLoop =
    PROMO_isLoopProgression_(teamRecord,rawRecord);

  if(!explicitLoop){
    if(from <= 0 || to <= 0 || to === 999 || to !== from + 1)
      return false;
  }

  const teamMinutes = PROMO_operationalMinutes_(teamRecord.time);
  const rawMinutes = PROMO_operationalMinutes_(rawRecord.time);

  // Same-day automatic credit requires usable time evidence.
  // Ambiguous time-less same-day cases stay in Recovery/manual review.
  if(teamMinutes < 0 || rawMinutes < 0)
    return false;

  return rawMinutes > teamMinutes;
}


function PROMO_rawOccurrenceBlockedByTeam_(rawRecord,teamRecords){

  const rawDateKey =
    PROMO_dateKey_(
      rawRecord.dateObj
    );

  const rawRoundNo =
    Number(
      rawRecord.roundNo
    ) || 0;

  const rawTime =
    PROMO_operationalMinutes_(
      rawRecord.time
    );

  let matchingTeamRows = 0;
  let progressionEvidenceRows = 0;

  for(
    let i=0;
    i<(teamRecords||[]).length;
    i++
  ){

    const team =
      teamRecords[i];

    if(
      !team ||
      !(team.dateObj instanceof Date) ||
      Number(team.roundNo || 0) !== rawRoundNo ||
      PROMO_dateKey_(team.dateObj) !== rawDateKey
    ){
      continue;
    }

    if(
      makeSmartKey(
        team.candidate,
        team.client
      ) !==
      makeSmartKey(
        rawRecord.candidate,
        rawRecord.client
      )
    ){
      continue;
    }

    //--------------------------------------------------
    // Do not let an invalid Team row at a different time
    // suppress a legitimate same-day occurrence.
    //--------------------------------------------------

    const teamTime =
      PROMO_operationalMinutes_(
        team.time
      );

    if(
      rawTime >= 0 &&
      teamTime >= 0 &&
      rawTime !== teamTime
    ){
      continue;
    }

    matchingTeamRows++;

    //--------------------------------------------------
    // v1.8.4:
    // A Rescheduled higher-round occurrence is STILL
    // valid progression evidence.
    //
    // Cancelled / Support remain blocked.
    //--------------------------------------------------

    if(
      PROMO_teamRowCanProveHigherRound_(
        team
      )
    ){
      progressionEvidenceRows++;
    }

  }

  //--------------------------------------------------
  // Any valid progression evidence means Raw can be
  // used. This includes Team rows marked Rescheduled.
  //--------------------------------------------------

  if(progressionEvidenceRows > 0){
    return false;
  }

  //--------------------------------------------------
  // If Team Data explicitly contains only blocked copies
  // (Cancelled / Support / blank), block this occurrence.
  //--------------------------------------------------

  if(matchingTeamRows > 0){
    return true;
  }

  //--------------------------------------------------
  // No Team row is fine: another team may have handled
  // the higher round.
  //--------------------------------------------------

  return false;
}


/******************************************************
 * RESCHEDULE LINEAGE
 *
 * If a later Raw row says "Rescheduled from Sep 1" (etc.),
 * the prior same Candidate + Client + Round occurrence is superseded.
 * This prevents Sep-1 and Sep-2 from becoming two promotion evidences.
 ******************************************************/
function PROMO_getEffectiveRawRecords_(rawRecords){

  const rows = (rawRecords || []).slice();
  const superseded = {};
  const groups = {};

  rows.forEach(function(record,index){

    if(!record || !(record.dateObj instanceof Date))
      return;

    const groupKey = [
      makeSmartKey(record.candidate,record.client),
      Number(record.roundNo) || 0
    ].join("||");

    if(!groups[groupKey])
      groups[groupKey] = [];

    groups[groupKey].push({record:record,index:index});
  });

  Object.keys(groups).forEach(function(groupKey){

    const group = groups[groupKey].sort(function(a,b){
      return PROMO_compareRecords_(a.record,b.record);
    });

    group.forEach(function(item,pos){

      const text = String(item.record.originalText || "");

      if(!/\bresched(?:ule|uled|uling)?\s+from\b/i.test(text))
        return;

      const referenced = PROMO_extractRescheduledFromDate_(
        text,
        item.record.dateObj
      );

      let target = null;

      if(referenced){
        const refKey = PROMO_dateKey_(referenced);
        for(let j=pos-1;j>=0;j--){
          if(PROMO_dateKey_(group[j].record.dateObj) === refKey){
            target = group[j];
            break;
          }
        }
      }

      // Safe fallback: same candidate/client/round and the immediately
      // preceding earlier occurrence.
      if(!target && pos > 0)
        target = group[pos-1];

      if(target)
        superseded[target.index] = true;

    });
  });

  return rows.filter(function(record,index){
    return !superseded[index];
  });
}


function PROMO_extractRescheduledFromDate_(text,currentDate){

  if(!(currentDate instanceof Date))
    return null;

  const source = String(text || "")
    .replace(/[–—]/g,"-")
    .replace(/\b(\d{1,2})(?:st|nd|rd|th)\b/gi,"$1");

  const m = source.match(/\bresched(?:ule|uled|uling)?\s+from\s+([^),;\-]+(?:\s+\d{4})?)/i);
  if(!m)
    return null;

  let part = String(m[1] || "").trim();
  if(!part)
    return null;

  const months = {
    jan:0,january:0,feb:1,february:1,mar:2,march:2,apr:3,april:3,
    may:4,jun:5,june:5,jul:6,july:6,aug:7,august:7,sep:8,sept:8,september:8,
    oct:9,october:9,nov:10,november:10,dec:11,december:11
  };

  let match = part.match(/\b([A-Za-z]+)\s+(\d{1,2})(?:\s*,?\s*(\d{4}))?/i);
  if(match){
    const mon = months[String(match[1]).toLowerCase()];
    if(mon !== undefined){
      const year = Number(match[3]) || currentDate.getFullYear();
      return new Date(year,mon,Number(match[2]));
    }
  }

  match = part.match(/\b(\d{1,2})\s+([A-Za-z]+)(?:\s*,?\s*(\d{4}))?/i);
  if(match){
    const mon = months[String(match[2]).toLowerCase()];
    if(mon !== undefined){
      const year = Number(match[3]) || currentDate.getFullYear();
      return new Date(year,mon,Number(match[1]));
    }
  }

  match = part.match(/\b(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?/);
  if(match){
    let year = Number(match[3]) || currentDate.getFullYear();
    if(year < 100) year += 2000;
    // Existing operations data is predominantly US-style month/day.
    return new Date(year,Number(match[1])-1,Number(match[2]));
  }

  return null;
}


function PROMO_teamCallKey_(record){
  if(!record) return "";
  return [
    makeSmartKey(record.candidate,record.client),
    Number(record.roundNo) || 0,
    PROMO_dateKey_(record.dateObj),
    String(record.handler || "").trim().toLowerCase()
  ].join("||");
}


function PROMO_compareRecords_(a,b){

  const aDate = a && a.dateObj instanceof Date ? a.dateObj.getTime() : 0;
  const bDate = b && b.dateObj instanceof Date ? b.dateObj.getTime() : 0;

  if(aDate !== bDate)
    return aDate - bDate;

  const aTime = PROMO_operationalMinutes_(a && a.time);
  const bTime = PROMO_operationalMinutes_(b && b.time);

  if(aTime !== bTime)
    return aTime - bTime;

  return (Number(a && a.roundNo)||0) - (Number(b && b.roundNo)||0);
}


function PROMO_dayKey_(date){
  return date.getFullYear()*10000 + (date.getMonth()+1)*100 + date.getDate();
}


function PROMO_dateKey_(date){
  if(!(date instanceof Date)) return "";
  return [
    date.getFullYear(),
    String(date.getMonth()+1).padStart(2,"0"),
    String(date.getDate()).padStart(2,"0")
  ].join("-");
}


function PROMO_sameDate_(a,b){
  return (
    a instanceof Date &&
    b instanceof Date &&
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}


function PROMO_isLoopProgression_(current,next){
  return !!(
    current && current.isLoopInterview ||
    next && next.isLoopInterview ||
    /\bLoop\s+Interview\b/i.test(String(current && current.originalText || "")) ||
    /\bLoop\s+Interview\b/i.test(String(next && next.originalText || ""))
  );
}


function PROMO_timeMinutes_(time){
  const match = String(time || "").trim().match(/^(\d{1,2})(?::(\d{2}))?\s*([AP]M)$/i);
  if(!match) return 0;
  let hour = parseInt(match[1],10);
  const minute = parseInt(match[2] || "0",10);
  const meridiem = String(match[3] || "").toUpperCase();
  if(hour === 12) hour = 0;
  if(meridiem === "PM") hour += 12;
  return hour * 60 + minute;
}


/******************************************************
 * OPERATIONAL MINUTES
 *
 * Interview working dates run through the night. Times from
 * midnight through 5:59 AM belong after the evening portion
 * of the same working-date block, not before 7-11 PM calls.
 ******************************************************/
function PROMO_operationalMinutes_(time){
  const match = String(time || "").trim().match(/^(\d{1,2})(?::(\d{2}))?\s*([AP]M)$/i);
  if(!match) return -1;

  let hour = parseInt(match[1],10);
  const minute = parseInt(match[2] || "0",10);
  const meridiem = String(match[3] || "").toUpperCase();

  if(hour === 12) hour = 0;
  if(meridiem === "PM") hour += 12;

  let minutes = hour * 60 + minute;

  // The operations working-date block continues after midnight.
  if(minutes < (6 * 60))
    minutes += (24 * 60);

  return minutes;
}


/******************************************************
 * WRITE PROMOTION HISTORY
 ******************************************************/
function writePromotionHistory(promotions){

  const ss = SpreadsheetApp.getActive();
  let sheet = ss.getSheetByName(CONFIG.PROMOTION_HISTORY_SHEET);

  if(!sheet)
    sheet = ss.insertSheet(CONFIG.PROMOTION_HISTORY_SHEET);

  sheet.clearContents();

  sheet.appendRow([
    "Candidate",
    "Client",
    "Previous Round",
    "Promotion Round",
    "Previous Date",
    "Promotion Date"
  ]);

  if(!promotions || !promotions.length)
    return;

  const output = promotions.map(function(p){
    return [
      p.candidate,
      p.client,
      p.previousRound,
      p.promotionRound,
      formatDate(p.previousDate),
      formatDate(p.promotionDate)
    ];
  });

  sheet.getRange(2,1,output.length,output[0].length).setValues(output);
}



/******************************************************
 * FULL SYSTEM READ-ONLY PROMOTION AUDIT v1.6
 *
 * No spreadsheet writes.
 *
 * This is intentionally generic:
 * - all handlers
 * - all candidates
 * - all clients
 * - old and new formats
 ******************************************************/
function auditAllPromotionRecognitionV16ReadOnly(){

  PARSER_IDENTITY_CACHE_ = null;

  const raw =
    loadRawData();

  const team =
    loadTeamData();

  const repairedRaw =
    PARSER_repairPromotionRecordsV16_(
      raw
    );

  const repairedTeam =
    PARSER_repairPromotionRecordsV16_(
      team
    );

  const promotions =
    buildPromotionHistory(
      repairedRaw,
      repairedTeam
    );

  const byHandler = {};
  const byTransition = {};

  promotions.forEach(
    function(p){

      const handler =
        String(
          p.handler || "UNASSIGNED"
        ).trim() || "UNASSIGNED";

      if(!byHandler[handler]){

        byHandler[handler] = {
          total:0,
          transitions:{}
        };

      }

      const transition =
        String(
          p.previousRound || ""
        ) +
        " -> " +
        String(
          p.promotionRound || ""
        );

      byHandler[handler].total++;

      byHandler[handler].transitions[transition] =
        (
          byHandler[handler]
            .transitions[transition] ||
          0
        ) + 1;

      byTransition[transition] =
        (
          byTransition[transition] ||
          0
        ) + 1;

    }
  );

  const result = {
    ok:true,
    mode:
      "READ_ONLY_FULL_PROMOTION_AUDIT_V1_6",
    version:
      "PROMOTION-IDENTITY-1.6",
    rawRecords:
      raw.length,
    teamRecords:
      team.length,
    promotionCount:
      promotions.length,
    handlers:
      byHandler,
    transitions:
      byTransition
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



function generatePromotionHistory(){
  const rawRecords = loadRawData();
  const teamRecords = loadTeamData();
  const promotions = buildPromotionHistory(rawRecords,teamRecords);
  writePromotionHistory(promotions);
  Logger.log("Promotions Found : " + promotions.length);
}


/******************************************************
 * READ-ONLY TARGETED LIVE PREVIEW v1.8.3
 *
 * NO WRITES.
 *
 * Checks the three reported cases using current
 * Raw Data + Team Data + current canonical identity.
 ******************************************************/
function previewReportedPromotionCasesV183ReadOnly(){

  PARSER_IDENTITY_CACHE_ = null;

  const raw =
    loadRawData();

  const team =
    loadTeamData();

  const promotions =
    buildPromotionHistory(
      raw,
      team
    );

  const targets = [
    {
      candidate:
        "Navya Sree Rama",
      client:
        "Adyen"
    },
    {
      candidate:
        "Mathew kodavalli",
      client:
        "Lotus"
    },
    {
      candidate:
        "Srestha Somala",
      client:
        "Veeva Systems"
    }
  ];

  const cases =
    targets.map(
      function(target){

        const key =
          makeSmartKey(
            target.candidate,
            target.client
          );

        const rawRows =
          raw.filter(
            function(r){
              return (
                r &&
                makeSmartKey(
                  r.candidate,
                  r.client
                ) === key
              );
            }
          )
          .map(
            PROMO_caseCompactV183_
          );

        const teamRows =
          team.filter(
            function(r){
              return (
                r &&
                makeSmartKey(
                  r.candidate,
                  r.client
                ) === key
              );
            }
          )
          .map(
            PROMO_caseCompactV183_
          );

        const matchedPromotions =
          promotions.filter(
            function(p){
              return (
                makeSmartKey(
                  p.candidate,
                  p.client
                ) === key
              );
            }
          )
          .map(
            function(p){
              return {
                candidate:
                  p.candidate,
                client:
                  p.client,
                from:
                  p.previousRound,
                to:
                  p.promotionRound,
                previousDate:
                  PROMO_dateKey_(
                    p.previousDate
                  ),
                promotionDate:
                  PROMO_dateKey_(
                    p.promotionDate
                  ),
                handler:
                  p.handler || "",
                evidenceSource:
                  p.evidenceSource || ""
              };
            }
          );

        return {
          candidate:
            target.candidate,
          client:
            target.client,
          recognized:
            matchedPromotions.length > 0,
          promotions:
            matchedPromotions,
          rawRows:
            rawRows,
          teamRows:
            teamRows
        };

      }
    );

  const result = {
    ok:true,
    mode:
      "READ_ONLY_REPORTED_PROMOTION_CASES_V1_8_3",
    version:
      "PROMOTION-RECOGNITION-1.8.3",
    promotionCount:
      promotions.length,
    cases:
      cases
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


function PROMO_caseCompactV183_(record){

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
      Number(record.roundNo) || 0,
    date:
      PROMO_dateKey_(
        record.dateObj
      ),
    time:
      record.time || "",
    handler:
      record.handler || "",
    status:
      record.status || "",
    originalText:
      record.originalText || ""
  };

}


/******************************************************
 * PROMOTION USE-CASE REGRESSION TESTS
 * Version 1.8.4 - READ ONLY
 *
 * These tests are based on real failure patterns supplied
 * by operations. They do not write to any spreadsheet.
 ******************************************************/

function testPromotionRecognitionUseCasesV18ReadOnly(){

  const savedIdentityCache = PARSER_IDENTITY_CACHE_;

  try{

    PARSER_IDENTITY_CACHE_ = PRU_testIdentityIndex_();

    const checks = [];

    function add(name,ok,details){
      checks.push({
        name:name,
        ok:!!ok,
        details:details || null
      });
    }

    //--------------------------------------------------
    // PARSER / IDENTITY CASES
    //--------------------------------------------------

    let p = parseInterview(
      "Mathew kodavalli – Interview – (UK) - Technical Interview - Lotus – 6:30 PM IST – Duration: 60 Mins (3rd Round)"
    );
    add(
      "Mathew: country tag + Technical Interview before client",
      !!p && p.client === "Lotus" && Number(p.roundNo) === 3,
      p
    );

    p = parseInterview(
      "Sunil kumar Pasupuleti (Canada) – Interview – Aon - Python Developer Pathwise – 8:30 PM IST – Duration: 60 Mins (2nd Round)"
    );
    add(
      "Sunil: Role after Aon is not Client identity",
      !!p && p.client === "Aon" && Number(p.roundNo) === 2,
      p
    );

    p = parseInterview(
      "Yeswanthi Chowdavaram – Interview – RTI International - Master's - level Health Economist – 9:00 PM IST – Duration: 1HR 45 Mins (2nd Round)"
    );
    add(
      "Yeswanthi: approved Client alias RTI International -> RTI",
      !!p && p.client === "RTI" && Number(p.roundNo) === 2,
      p
    );

    p = parseInterview(
      "Srestha Somala – Interview – Interview Veeva Systems – 7:30 PM IST – Duration: 45 Mins (1st Round)"
    );
    add(
      "Srestha: glued Interview descriptor before Veeva Systems",
      !!p && p.client === "Veeva Systems" && Number(p.roundNo) === 1,
      p
    );

    p = parseInterview(
      "Srestha Somala – Interview – Technical interview - Veeva Systems - Platform Engineer - Commercial Services Tools – 9:30 PM IST – Duration: 45 Mins (2nd Round)"
    );
    add(
      "Srestha: Technical Interview + multi-part Role ignored",
      !!p && p.client === "Veeva Systems" && Number(p.roundNo) === 2,
      p
    );

    p = parseInterview(
      "Srestha Somala – Interview – Panel interview - TD Bank Group - Data Designer II (US) - Business System Analyst – 10:30 PM IST – Duration: 60 Mins (3rd Round)"
    );
    add(
      "Srestha: Panel Interview + Role ignored for TD Bank Group",
      !!p && p.client === "TD Bank Group" && Number(p.roundNo) === 3,
      p
    );

    p = parseInterview(
      "Chandi priya katta – Interview – Technical Interview - applied medical - IT Business Analyst, Custom Applications – 9:30 PM IST – Duration: 60 Mins (2nd Round)"
    );
    add(
      "Chandi: Technical Interview + Role ignored for Applied Medical",
      !!p && PARSER_identityKey_(p.client) === PARSER_identityKey_("Applied Medical") && Number(p.roundNo) === 2,
      p
    );

    p = parseInterview(
      "Rohini Sura – Interview – Stanford Health Care – Clinical Applications Analyst – 2nd Round – 4:30 AM IST (45-minute)"
    );
    add(
      "Rohini: Round before time still parses",
      !!p && p.client === "Stanford Health Care" && Number(p.roundNo) === 2,
      p
    );

    p = parseInterview(
      "Shifali PathulaChristina – Interview – WakeMed Health & Hospitals – 1:00 AM IST – Duration: 30 Mins (Round; Candidate 1st interview)"
    );
    add(
      "Shifali: explicit Candidate 1st interview safely means Round 1",
      !!p && p.client === "WakeMed Health & Hospitals" && Number(p.roundNo) === 1,
      p
    );

    p = parseInterview(
      "Mani teja A – Interview – QTS data centers - Process Improvement Analyst – 11:30 PM IST – Duration: 45 Mins"
    );
    add(
      "QTS: completely missing round remains review-only",
      p === null,
      p
    );

    //--------------------------------------------------
    // PROMOTION CASES
    //--------------------------------------------------

    let team = [
      PRU_record_(
        "Sumayya Fathima Shaik – Phone Interview – Jain Global – 9:30 PM IST – Duration: 15 Mins (1st Round)",
        2026,10,1,"Venkatesh"
      )
    ];
    let raw = [
      PRU_record_(
        "Sumayya Fathima Shaik – Phone Interview – Jain Global – 9:30 PM IST – Duration: 15 Mins (1st Round)",
        2026,10,1,""
      ),
      PRU_record_(
        "Sumayya Fathima Shaik – Interview – Jain Global – 11:00 PM IST – Duration: 30 Mins (2nd Round)",
        2026,10,1,""
      )
    ];
    let promotions = buildPromotionHistory(raw,team);
    add(
      "Sumayya: same-day direct R1 -> R2 later time qualifies",
      promotions.length === 1 && Number(promotions[0].promotionRoundNo) === 2,
      PRU_promoView_(promotions)
    );

    team = [
      PRU_record_(
        "Example Candidate – Interview – Example Client – 8:00 PM IST – Duration: 30 Mins (1st Round)",
        2026,10,1,"Handler A"
      )
    ];
    raw = [
      PRU_record_(
        "Example Candidate – Interview – Example Client – 10:00 PM IST – Duration: 30 Mins (3rd Round)",
        2026,10,1,""
      )
    ];
    promotions = buildPromotionHistory(raw,team);
    add(
      "Same-day skipped R1 -> R3 remains review-only without Loop",
      promotions.length === 0,
      PRU_promoView_(promotions)
    );

    team = [
      PRU_record_(
        "Mani teja A – Interview – Aspenpublishing - Quality Assurance/Operations Analyst – 12:10 AM IST – Duration: 30 Mins (1st Round)",
        2026,10,8,"Venkatesh"
      ),
      PRU_record_(
        "Mani teja A – Interview – Aspenpublishing - Quality Assurance/Operations Analyst – 10:30 PM IST – Duration: 60 Mins (2nd Round)",
        2026,10,23,"Stephen"
      )
    ];
    raw = [
      PRU_record_(
        "Mani teja A – Interview – Aspenpublishing - Quality Assurance/Operations Analyst – 10:30 PM IST – Duration: 60 Mins (2nd Round)",
        2026,10,23,""
      )
    ];
    promotions = buildPromotionHistory(raw,team);
    add(
      "Aspenpublishing: later round handled by Stephen still credits earlier handler",
      PRU_hasPromotion_(promotions,"Mani teja A","Aspenpublishing",1,2),
      PRU_promoView_(promotions)
    );

    team = [
      PRU_record_(
        "Aslesha yalamanchili – Interview – Sephora – 10:45 PM IST – Duration: 30 Mins (1st Round)",
        2026,10,8,"Venkatesh"
      )
    ];
    raw = [
      PRU_record_(
        "Aslesha yalamanchili – Interview – Sephora - Data Analyst – 8:30 PM IST – Duration: 45 Mins (2nd Round)",
        2026,10,19,""
      )
    ];
    promotions = buildPromotionHistory(raw,team);
    add(
      "Sephora: Role text does not break R1 -> R2",
      PRU_hasPromotion_(promotions,"Aslesha yalamanchili","Sephora",1,2),
      PRU_promoView_(promotions)
    );

    const activR1 = PRU_record_(
      "Akshaya reddy Paila – Interview – ActivTrak – 10:00 PM IST – Duration: 30 Mins (1st Round)",
      2026,10,9,"Venkatesh"
    );
    const activR2Valid = PRU_record_(
      "Akshaya reddy Paila – Interview – ActivTrak - Data Analyst – 9:30 PM IST – Duration: 30 Mins (2nd Round)",
      2026,10,13,"Gopal"
    );
    const activR2Invalid = PRU_record_(
      "Akshaya reddy Paila – Interview – ActivTrak - Data Analyst – 9:30 PM IST – Duration: 30 Mins (2nd Round)",
      2026,10,13,"Rescheduled"
    );
    team = [activR1,activR2Invalid,activR2Valid];
    raw = [PRU_record_(
      "Akshaya reddy Paila – Interview – ActivTrak - Data Analyst – 9:30 PM IST – Duration: 30 Mins (2nd Round)",
      2026,10,13,""
    )];
    promotions = buildPromotionHistory(raw,team);
    add(
      "ActivTrak: invalid duplicate cannot suppress valid Gopal R2",
      PRU_hasPromotion_(promotions,"Akshaya reddy Paila","ActivTrak",1,2),
      PRU_promoView_(promotions)
    );

    team = [
      PRU_record_(
        "Night Candidate – Interview – Night Client – 11:30 PM IST – Duration: 30 Mins (1st Round)",
        2026,10,10,"Handler A"
      )
    ];
    raw = [
      PRU_record_(
        "Night Candidate – Interview – Night Client – 1:00 AM IST – Duration: 30 Mins (2nd Round)",
        2026,10,10,""
      )
    ];
    promotions = buildPromotionHistory(raw,team);
    add(
      "Overnight same working date: 11:30 PM -> 1:00 AM is later",
      promotions.length === 1,
      PRU_promoView_(promotions)
    );

    team = [
      PRU_record_(
        "Midnight Candidate – Interview – Midnight Client – 11:30 PM IST – Duration: 30 Mins (1st Round)",
        2026,10,10,"Handler A"
      )
    ];
    raw = [
      PRU_record_(
        "Midnight Candidate – Interview – Midnight Client – 12:00 AM IST – Duration: 30 Mins (2nd Round)",
        2026,10,10,""
      )
    ];
    promotions = buildPromotionHistory(raw,team);
    add(
      "Exact midnight is valid later operational time",
      promotions.length === 1,
      PRU_promoView_(promotions)
    );

    team = [
      PRU_record_(
        "Nikitha Gopu – Interview – Roadrunner Transportation Services, Inc. – 8:00 PM IST – Duration: 30 Mins (3rd Round)",
        2026,10,1,"Handler A"
      )
    ];
    raw = [
      PRU_record_(
        "Nikitha Gopu – Interview – Roadrunner Transportation Services, Inc. – 8:00 PM IST – Duration: 30 Mins (Final Round)",
        2026,10,6,""
      )
    ];
    promotions = buildPromotionHistory(raw,team);
    add(
      "Roadrunner: 3rd -> Final qualifies",
      promotions.length === 1 && Number(promotions[0].promotionRoundNo) === 999,
      PRU_promoView_(promotions)
    );


    //--------------------------------------------------
    // V1.6 HISTORICAL FORMAT TRANSITION CASES
    //--------------------------------------------------

    team = [
      PRU_record_(
        "Sravani thurlapati – Interview – UC Davis Health – 9:30 PM IST – Duration: 30 Mins (1st Round)",
        2026,10,20,"Naresh"
      )
    ];
    raw = [
      PRU_record_(
        "Sravani thurlapati – Interview – UC Davis Health - Business Systems Analyst 3 position – 9:30 PM IST – Duration: 55 Mins (2nd Round)",
        2026,10,27,""
      )
    ];
    promotions = buildPromotionHistory(raw,team);
    add(
      "UC Davis Health: old Client-only R1 joins new Client + Role R2",
      PRU_hasPromotion_(promotions,"Sravani thurlapati","UC Davis Health",1,2),
      PRU_promoView_(promotions)
    );

    team = [
      PRU_record_(
        "Navya Sree Rama – Interview – Adyen – 8:30 PM IST – Duration: 30 Mins (1st Round)",
        2026,10,8,"Gopal"
      )
    ];
    raw = [
      PRU_record_(
        "Navya Sree Rama – Interview – Adyen - Business Systems Analyst – 8:30 PM IST – Duration: 45 Mins (2nd Round)",
        2026,10,23,""
      )
    ];
    promotions = buildPromotionHistory(raw,team);
    add(
      "Adyen: old Client-only R1 joins new Client + Role R2",
      PRU_hasPromotion_(promotions,"Navya Sree Rama","Adyen",1,2),
      PRU_promoView_(promotions)
    );

    team = [
      PRU_record_(
        "Satya Pavan Vignesh Veera – Interview – Integrity Marketing Group – 8:00 PM IST – Duration: 45 Mins (2nd Round)",
        2026,10,26,"Gopal"
      )
    ];
    raw = [
      PRU_record_(
        "Satya Pavan Vignesh Veera – Interview – Integrity Marketing Group - Business Analyst – 8:00 PM IST – Duration: 45 Mins (3rd Round)",
        2026,10,30,""
      )
    ];
    promotions = buildPromotionHistory(raw,team);
    add(
      "Integrity Marketing Group: old Client-only R2 joins new Client + Role R3",
      PRU_hasPromotion_(promotions,"Satya Pavan Vignesh Veera","Integrity Marketing Group",2,3),
      PRU_promoView_(promotions)
    );

    team = [
      PRU_record_(
        "Mani teja A – Interview – Aspenpublishing – 12:10 AM IST – Duration: 30 Mins (1st Round)",
        2026,10,8,"Venkatesh"
      )
    ];
    raw = [
      PRU_record_(
        "Mani teja A – Interview – Aspenpublishing - Quality Assurance/Operations Analyst – 10:30 PM IST – Duration: 60 Mins (2nd Round)",
        2026,10,23,""
      )
    ];
    promotions = buildPromotionHistory(raw,team);
    add(
      "Aspenpublishing: old Client-only R1 joins new Client + Role R2",
      PRU_hasPromotion_(promotions,"Mani teja A","Aspenpublishing",1,2),
      PRU_promoView_(promotions)
    );


    const passed = checks.filter(function(x){ return x.ok; }).length;
    const result = {
      ok:passed === checks.length,
      mode:"READ_ONLY_PROMOTION_USE_CASES_V1_8",
      version:"PROMOTION-RECOGNITION-1.8",
      passed:passed,
      total:checks.length,
      checks:checks
    };

    Logger.log(JSON.stringify(result,null,2));
    return result;

  }finally{
    PARSER_IDENTITY_CACHE_ = savedIdentityCache;
  }
}


/******************************************************
 * LIVE READ-ONLY PREVIEW
 *
 * Uses the actual Raw Data + Team Data and reports whether
 * representative known processes appear in Promotion History.
 * No sheet is written.
 ******************************************************/
function previewPromotionRecognitionUseCasesReadOnly(){

  PARSER_IDENTITY_CACHE_ = null;

  const raw = loadRawData();
  const team = loadTeamData();
  const promotions = buildPromotionHistory(raw,team);

  const cases = [
    ["Sumayya Fathima Shaik","Jain Global"],
    ["Mani teja A","Aspenpublishing"],
    ["Aslesha yalamanchili","Sephora"],
    ["Akshaya reddy Paila","ActivTrak"],
    ["Sravani thurlapati","UC Davis Health"],
    ["Benhur ruchitha mamidi","Millennium Healthcare"],
    ["Yeswanthi Chowdavaram","Clinical Architecture"],
    ["Shifali PathulaChristina","WakeMed Health & Hospitals"],
    ["Chandi priya katta","Applied Medical"],
    ["Rohini Sura","Stanford Health Care"],
    ["Nikitha Gopu","Roadrunner Transportation Services, Inc."],
    ["Rohit Garjakuntla","Rakuten"],
    ["Manasa Keerthi","Nasdaq"],
    ["Anusha Marella","Cotiviti"],
    ["Navya Sree Rama","Adyen"],
    ["Vasavi Ramya Gajula","Truist"],
    ["Satya Pavan Vignesh Veera","Integrity Marketing Group"]
  ];

  const results = cases.map(function(item){
    const target = makeSmartKey(item[0],item[1]);
    const hits = promotions.filter(function(p){
      return makeSmartKey(p.candidate,p.client) === target;
    });
    return {
      candidate:item[0],
      client:item[1],
      recognized:hits.length > 0,
      promotions:PRU_promoView_(hits)
    };
  });

  const result = {
    ok:true,
    mode:"READ_ONLY_LIVE_PROMOTION_USE_CASE_PREVIEW",
    rawRecords:raw.length,
    teamRecords:team.length,
    promotionCount:promotions.length,
    recognizedCount:results.filter(function(x){return x.recognized;}).length,
    cases:results
  };

  Logger.log(JSON.stringify(result,null,2));
  return result;
}


function PRU_testIdentityIndex_(){

  const index = {
    candidateByName:{}, candidateAlias:{},
    clientByName:{}, clientAlias:{}, localClientByName:{}
  };

  const candidates = [
    "Mathew kodavalli","Sunil kumar Pasupuleti","Yeswanthi Chowdavaram",
    "Srestha Somala","Chandi priya katta","Rohini Sura","Shifali PathulaChristina",
    "Mani teja A","Aslesha yalamanchili","Akshaya reddy Paila",
    "Sumayya Fathima Shaik","Nikitha Gopu","Night Candidate","Midnight Candidate","Example Candidate"
  ];

  const clients = [
    "Lotus","Aon","RTI","Veeva Systems","TD Bank Group","Applied Medical",
    "Stanford Health Care","WakeMed Health & Hospitals","QTS data centers",
    "Aspenpublishing","Sephora","ActivTrak","Jain Global",
    "Roadrunner Transportation Services, Inc.","Night Client","Midnight Client","Example Client"
  ];

  candidates.forEach(function(name){
    index.candidateByName[PARSER_identityKey_(name)] = {name:name};
  });

  clients.forEach(function(name){
    index.clientByName[PARSER_identityKey_(name)] = {name:name};
  });

  index.clientAlias[PARSER_identityKey_("RTI International")] = {name:"RTI"};
  index.candidateAlias[PARSER_identityKey_("Akshaya Paila")] = {name:"Akshaya reddy Paila"};

  return index;
}


function PRU_record_(text,year,month,day,handler){
  const record = parseInterview(text);
  if(!record) return null;
  record.dateObj = new Date(year,month-1,day);
  record.dateText = PROMO_dateKey_(record.dateObj);
  if(handler !== undefined) record.handler = handler;
  return record;
}


function PRU_hasPromotion_(promotions,candidate,client,fromRound,toRound){
  const target = makeSmartKey(candidate,client);
  return (promotions || []).some(function(p){
    return makeSmartKey(p.candidate,p.client) === target &&
      Number(p.previousRoundNo) === Number(fromRound) &&
      Number(p.promotionRoundNo) === Number(toRound);
  });
}


function PRU_promoView_(promotions){
  return (promotions || []).map(function(p){
    return {
      candidate:p.candidate,
      client:p.client,
      from:p.previousRound,
      to:p.promotionRound,
      previousDate:PROMO_dateKey_(p.previousDate),
      promotionDate:PROMO_dateKey_(p.promotionDate),
      handler:p.handler || ""
    };
  });
}


/******************************************************
 * BACKWARD-COMPATIBLE WRAPPER
 ******************************************************/
function testPromotionRecognitionUseCasesV15ReadOnly(){
  return testPromotionRecognitionUseCasesV18ReadOnly();
}

function testPromotionRecognitionUseCasesV16ReadOnly(){
  return testPromotionRecognitionUseCasesV18ReadOnly();
}


function testPromotionRecognitionUseCasesV17ReadOnly(){
  return testPromotionRecognitionUseCasesV18ReadOnly();
}


/******************************************************
 * PROMOTION REGRESSION v1.8.3
 *
 * NO WRITES.
 *
 * Covers:
 * - malformed "2Nd; Round"
 * - valid Team higher-round fallback
 * - invalid Rescheduled higher Team row must NOT qualify
 ******************************************************/
function testPromotionRecognitionUseCasesV183ReadOnly(){

  const checks = [];

  //--------------------------------------------------
  // 1. Navya: semicolon Round 2 parses and qualifies.
  //--------------------------------------------------

  const navyaR1 =
    parseInterview(
      "Navya sree rama – Interview – Adyen – 7:15 PM IST – Duration: 30 Mins (1St Round)"
    );

  const navyaR2 =
    parseInterview(
      "Navya sree rama – Interview – Adyen - Software Engineer I (Front End) Lifecycle Experience – 7:30 PM IST – Duration: 90 Mins (2Nd; Round)"
    );

  navyaR1.dateObj =
    new Date(2026,9,8);

  navyaR1.handler =
    "Gopal";

  navyaR2.dateObj =
    new Date(2026,9,23);

  const navyaPromos =
    buildPromotionHistory(
      [navyaR1,navyaR2],
      [navyaR1]
    );

  checks.push({
    name:
      "Navya: 2Nd; Round parses and creates R1 -> R2",
    ok:
      !!navyaR2 &&
      Number(navyaR2.roundNo) === 2 &&
      navyaPromos.length === 1 &&
      Number(navyaPromos[0].promotionRoundNo) === 2,
    details:
      navyaPromos
  });

  //--------------------------------------------------
  // 2. Srestha:
  // Raw misses R2, but valid Team R2 can prove progress.
  //--------------------------------------------------

  const sresthaR1 =
    parseInterview(
      "Srestha Somala – Interview – Interview Veeva Systems – 7:30 PM IST – Duration: 45 Mins (1st Round) (Reschedule from sep 29)"
    );

  const sresthaR2 =
    parseInterview(
      "Srestha Somala – Interview – Technical interview - Veeva Systems - Platform Engineer - Commercial Services Tools – 9:30 PM IST – Duration: 45 Mins (2nd Round)"
    );

  sresthaR1.dateObj =
    new Date(2026,9,8);

  sresthaR1.handler =
    "Naresh";

  sresthaR2.dateObj =
    new Date(2026,9,27);

  sresthaR2.handler =
    "Naresh";

  const sresthaPromos =
    buildPromotionHistory(
      // Intentionally NO Raw R2.
      [sresthaR1],
      [sresthaR1,sresthaR2]
    );

  checks.push({
    name:
      "Srestha: valid Team R2 safely proves R1 -> R2 when Raw R2 is missing",
    ok:
      sresthaPromos.some(
        function(p){
          return (
            Number(p.previousRoundNo) === 1 &&
            Number(p.promotionRoundNo) === 2 &&
            p.evidenceSource ===
              "TEAM_FALLBACK"
          );
        }
      ),
    details:
      sresthaPromos
  });

  //--------------------------------------------------
  // 3. Mathew:
  // Rescheduled higher Team row MUST NOT prove promotion.
  //--------------------------------------------------

  const mathewR2 =
    parseInterview(
      "Mathew kodavalli (UK) – Interview – Lotus – 9:00 PM IST – Duration: 30 Mins (2nd Round)"
    );

  const mathewR3 =
    parseInterview(
      "Mathew kodavalli – Interview – (UK) - Lotus – 6:30 PM IST – Duration: 60 Mins (3rd Round)"
    );

  mathewR2.dateObj =
    new Date(2026,9,1);

  mathewR2.handler =
    "Naresh";

  mathewR3.dateObj =
    new Date(2026,9,12);

  mathewR3.handler =
    "Rescheduled";

  const mathewPromos =
    buildPromotionHistory(
      // No valid Raw R3.
      [mathewR2],
      [mathewR2,mathewR3]
    );

  checks.push({
    name:
      "Mathew: Rescheduled Team R3 does NOT prove R2 -> R3",
    ok:
      mathewPromos.length === 0,
    details:
      mathewPromos
  });

  const passed =
    checks.filter(
      function(check){
        return check.ok;
      }
    ).length;

  const result = {
    ok:
      passed === checks.length,
    mode:
      "READ_ONLY_PROMOTION_USE_CASES_V1_8_3",
    version:
      "PROMOTION-RECOGNITION-1.8.3",
    passed:
      passed,
    total:
      checks.length,
    checks:
      checks
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
 * PROMOTION REGRESSION v1.8.4
 *
 * Business rule:
 * A Rescheduled HIGHER round still proves promotion for
 * the earlier handled round.
 *
 * Cancelled higher round does not.
 *
 * NO WRITES.
 ******************************************************/
function testPromotionRecognitionUseCasesV184ReadOnly(){

  const checks = [];

  //--------------------------------------------------
  // MATHEW:
  // Earlier R2 handled by Naresh.
  // Later R3 exists but is marked Rescheduled.
  //
  // This MUST credit the R2 handler because the
  // candidate advanced to the 3rd-round stage.
  //--------------------------------------------------

  const mathewR2 =
    parseInterview(
      "Mathew kodavalli (UK) – Interview – Lotus – 9:00 PM IST – Duration: 30 Mins (2nd Round)"
    );

  const mathewR3 =
    parseInterview(
      "Mathew kodavalli – Interview – (UK) - Lotus – 6:30 PM IST – Duration: 60 Mins (3rd Round)"
    );

  mathewR2.dateObj =
    new Date(2026,9,1);

  mathewR2.handler =
    "Naresh";

  mathewR3.dateObj =
    new Date(2026,9,12);

  mathewR3.handler =
    "Rescheduled";

  const mathewPromos =
    buildPromotionHistory(
      // Simulate missing Raw R3 so Team fallback is tested.
      [mathewR2],
      [mathewR2,mathewR3]
    );

  checks.push({
    name:
      "Mathew: Rescheduled R3 still proves R2 -> R3 promotion",
    ok:
      mathewPromos.some(
        function(p){
          return (
            Number(p.previousRoundNo) === 2 &&
            Number(p.promotionRoundNo) === 3 &&
            p.handler === "Naresh" &&
            p.evidenceSource ===
              "TEAM_RESCHEDULED_EVIDENCE"
          );
        }
      ),
    details:
      mathewPromos
  });

  //--------------------------------------------------
  // CANCELLED:
  // A cancelled higher round must NOT prove promotion.
  //--------------------------------------------------

  const cancelledR2 =
    parseInterview(
      "Cancelled Candidate – Interview – Cancel Client – 8:00 PM IST – Duration: 30 Mins (2nd Round)"
    );

  const cancelledR3 =
    parseInterview(
      "Cancelled Candidate – Interview – Cancel Client – 9:00 PM IST – Duration: 30 Mins (3rd Round)"
    );

  cancelledR2.dateObj =
    new Date(2026,9,1);

  cancelledR2.handler =
    "Handler A";

  cancelledR3.dateObj =
    new Date(2026,9,2);

  cancelledR3.handler =
    "Cancelled";

  const cancelledPromos =
    buildPromotionHistory(
      [cancelledR2],
      [cancelledR2,cancelledR3]
    );

  checks.push({
    name:
      "Cancelled higher round does NOT prove promotion",
    ok:
      cancelledPromos.length === 0,
    details:
      cancelledPromos
  });

  //--------------------------------------------------
  // SRESTHA:
  // Normal valid Team fallback remains allowed.
  //--------------------------------------------------

  const sresthaR1 =
    parseInterview(
      "Srestha Somala – Interview – Interview Veeva Systems – 7:30 PM IST – Duration: 45 Mins (1st Round) (Reschedule from sep 29)"
    );

  const sresthaR2 =
    parseInterview(
      "Srestha Somala – Interview – Technical interview - Veeva Systems - Platform Engineer - Commercial Services Tools – 9:30 PM IST – Duration: 45 Mins (2nd Round)"
    );

  sresthaR1.dateObj =
    new Date(2026,9,8);

  sresthaR1.handler =
    "Naresh";

  sresthaR2.dateObj =
    new Date(2026,9,27);

  sresthaR2.handler =
    "Naresh";

  const sresthaPromos =
    buildPromotionHistory(
      [sresthaR1],
      [sresthaR1,sresthaR2]
    );

  checks.push({
    name:
      "Srestha: normal valid Team R2 still proves R1 -> R2",
    ok:
      sresthaPromos.some(
        function(p){
          return (
            Number(p.previousRoundNo) === 1 &&
            Number(p.promotionRoundNo) === 2 &&
            p.handler === "Naresh"
          );
        }
      ),
    details:
      sresthaPromos
  });

  //--------------------------------------------------
  // NAVYA:
  // v1.8.3 semicolon parser fix must remain intact.
  //--------------------------------------------------

  const navyaR1 =
    parseInterview(
      "Navya sree rama – Interview – Adyen – 7:15 PM IST – Duration: 30 Mins (1St Round)"
    );

  const navyaR2 =
    parseInterview(
      "Navya sree rama – Interview – Adyen - Software Engineer I (Front End) Lifecycle Experience – 7:30 PM IST – Duration: 90 Mins (2Nd; Round)"
    );

  navyaR1.dateObj =
    new Date(2026,9,8);

  navyaR1.handler =
    "Gopal";

  navyaR2.dateObj =
    new Date(2026,9,23);

  const navyaPromos =
    buildPromotionHistory(
      [navyaR1,navyaR2],
      [navyaR1]
    );

  checks.push({
    name:
      "Navya: 2Nd; Round remains recognized as R2",
    ok:
      Number(navyaR2.roundNo) === 2 &&
      navyaPromos.some(
        function(p){
          return (
            Number(p.previousRoundNo) === 1 &&
            Number(p.promotionRoundNo) === 2
          );
        }
      ),
    details:
      navyaPromos
  });

  const passed =
    checks.filter(
      function(check){
        return check.ok;
      }
    ).length;

  const result = {
    ok:
      passed === checks.length,
    mode:
      "READ_ONLY_PROMOTION_USE_CASES_V1_8_4",
    version:
      "PROMOTION-RECOGNITION-1.8.4",
    passed:
      passed,
    total:
      checks.length,
    checks:
      checks
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

