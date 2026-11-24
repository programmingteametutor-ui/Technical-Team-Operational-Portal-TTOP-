/******************************************************
 * PROMOTION DUPLICATE RESOLUTION PREVIEW
 * READ-ONLY DIAGNOSTIC
 *
 * Target project:
 *   Pradeep Anna Team -> Incentive Backend - Private
 *
 * Purpose:
 * - Find logical duplicate Promotion records already stored
 *   in the private Incentive Tracker.
 * - Compare each duplicate group with Team Data and Raw Data.
 * - Recommend KEEP / DUPLICATE / REVIEW without writing anything.
 *
 * IMPORTANT:
 * - This file does NOT write to any sheet.
 * - It does NOT delete tracker rows.
 * - It does NOT run scanIncentives().
 * - It does NOT run recoverMissedPromotions().
 ******************************************************/

function previewPromotionDuplicateResolution(){

  Logger.log("========== DUPLICATE RESOLUTION PREVIEW ==========");

  const trackerSheet = getPrivateTrackerSheet();
  const lastRow = trackerSheet.getLastRow();
  const lastColumn = trackerSheet.getLastColumn();

  if(lastColumn < 10){
    throw new Error(
      "Private Incentive Tracker must contain at least 10 columns."
    );
  }

  const trackerRows =
    lastRow > 1
      ? trackerSheet
          .getRange(2, 1, lastRow - 1, 10)
          .getValues()
      : [];

  const rawRecords = loadRawData();
  const teamRecords = loadTeamData();

  const groups = {};

  trackerRows.forEach(function(row, index){

    const type = String(row[0] || "").trim().toLowerCase();

    if(type !== "promotion"){
      return;
    }

    const logicalKey = PDPR_buildLogicalKey_(row);

    if(!logicalKey){
      return;
    }

    if(!groups[logicalKey]){
      groups[logicalKey] = [];
    }

    groups[logicalKey].push({
      sheetRow: index + 2,
      row: row
    });

  });

  const duplicateKeys = Object.keys(groups).filter(function(key){
    return groups[key].length > 1;
  });

  const results = duplicateKeys.map(function(key){
    return PDPR_resolveGroupPreview_(
      key,
      groups[key],
      rawRecords,
      teamRecords
    );
  });

  const summary = {
    ok: true,
    readOnly: true,
    trackerRecords: trackerRows.length,
    duplicateGroups: results.length,
    results: results
  };

  Logger.log(JSON.stringify(summary, null, 2));

  Logger.log("========== PREVIEW COMPLETE ==========");

  return summary;
}


function PDPR_resolveGroupPreview_(
  logicalKey,
  trackerItems,
  rawRecords,
  teamRecords
){

  const firstRow = trackerItems[0].row;

  const candidate = String(firstRow[1] || "").trim();
  const client = PDPR_cleanClient_(firstRow[2]);
  const fromRoundNo = PDPR_roundNo_(firstRow[3]);
  const toRoundNo = PDPR_roundNo_(firstRow[4]);
  const previousDateKey = PDPR_dateKey_(firstRow[5]);

  const candidateKey = PDPR_normalizeIdentity_(candidate);
  const clientKey = PDPR_normalizeIdentity_(client);

  const teamEvidence = teamRecords.filter(function(record){

    if(!record){
      return false;
    }

    if(
      PDPR_normalizeIdentity_(record.candidate) !==
      candidateKey
    ){
      return false;
    }

    if(
      PDPR_normalizeIdentity_(
        PDPR_cleanClient_(record.client)
      ) !== clientKey
    ){
      return false;
    }

    if(Number(record.roundNo || 0) !== fromRoundNo){
      return false;
    }

    if(PDPR_dateKey_(record.dateObj) !== previousDateKey){
      return false;
    }

    return true;
  });

  const rawEvidence = rawRecords.filter(function(record){

    if(!record){
      return false;
    }

    if(
      PDPR_normalizeIdentity_(record.candidate) !==
      candidateKey
    ){
      return false;
    }

    if(
      PDPR_normalizeIdentity_(
        PDPR_cleanClient_(record.client)
      ) !== clientKey
    ){
      return false;
    }

    if(Number(record.roundNo || 0) !== toRoundNo){
      return false;
    }

    const rawDateKey = PDPR_dateKey_(record.dateObj);

    if(!rawDateKey){
      return false;
    }

    return rawDateKey >= previousDateKey;
  });

  const validTeamEvidence = teamEvidence.filter(function(record){
    return PDPR_validTeamOwner_(record);
  });

  const validHandlers = PDPR_unique_(
    validTeamEvidence.map(function(record){
      return String(record.handler || "").trim();
    }).filter(Boolean)
  );

  const rawDates = PDPR_unique_(
    rawEvidence.map(function(record){
      return PDPR_dateKey_(record.dateObj);
    }).filter(Boolean)
  );

  const explicitLoop =
    teamEvidence.some(function(record){
      return PDPR_isLoop_(record);
    }) ||
    rawEvidence.some(function(record){
      return PDPR_isLoop_(record);
    });

  const sameDay =
    rawDates.some(function(dateKey){
      return dateKey === previousDateKey;
    });

  const trackerDetails = trackerItems.map(function(item){

    const row = item.row;
    const promotionDateKey = PDPR_dateKey_(row[6]);
    const handler = String(row[7] || "").trim();

    return {
      sheetRow: item.sheetRow,
      incentiveType: String(row[0] || "").trim(),
      candidate: String(row[1] || "").trim(),
      client: String(row[2] || "").trim(),
      canonicalClient: PDPR_cleanClient_(row[2]),
      fromRound: String(row[3] || "").trim(),
      toRound: String(row[4] || "").trim(),
      previousDate: previousDateKey,
      promotionDate: promotionDateKey,
      handler: handler,
      amount: row[8],
      status: String(row[9] || "").trim(),
      handlerMatchesTeamEvidence:
        validHandlers.some(function(validHandler){
          return PDPR_sameText_(validHandler, handler);
        }),
      promotionDateHasRawEvidence:
        rawDates.indexOf(promotionDateKey) >= 0
    };
  });

  const teamDetails = teamEvidence.map(function(record){
    return {
      candidate: record.candidate || "",
      client: record.client || "",
      round: record.round || "",
      roundNo: Number(record.roundNo || 0),
      date: PDPR_dateKey_(record.dateObj),
      time: record.time || "",
      handler: record.handler || "",
      status: record.status || "",
      validOwner: PDPR_validTeamOwner_(record),
      isLoopInterview: PDPR_isLoop_(record)
    };
  });

  const rawDetails = rawEvidence.map(function(record){
    return {
      candidate: record.candidate || "",
      client: record.client || "",
      round: record.round || "",
      roundNo: Number(record.roundNo || 0),
      date: PDPR_dateKey_(record.dateObj),
      time: record.time || "",
      isLoopInterview: PDPR_isLoop_(record),
      originalText: record.originalText || ""
    };
  });

  const decision = PDPR_makeDecision_(
    trackerDetails,
    validHandlers,
    rawDates,
    previousDateKey,
    sameDay,
    explicitLoop,
    validTeamEvidence.length,
    rawEvidence.length
  );

  return {
    logicalKey: logicalKey,
    candidate: candidate,
    canonicalClient: client,
    transition:
      PDPR_roundLabel_(fromRoundNo) +
      " -> " +
      PDPR_roundLabel_(toRoundNo),
    previousDate: previousDateKey,
    trackerRows: trackerDetails,
    teamEvidence: teamDetails,
    rawPromotionEvidence: rawDetails,
    validHandlersFromTeamData: validHandlers,
    rawPromotionDates: rawDates,
    sameDayProgressionFound: sameDay,
    explicitLoopFound: explicitLoop,
    recommendation: decision
  };
}


function PDPR_makeDecision_(
  trackerRows,
  validHandlers,
  rawDates,
  previousDateKey,
  sameDay,
  explicitLoop,
  validTeamEvidenceCount,
  rawEvidenceCount
){

  if(validTeamEvidenceCount === 0){
    return {
      status: "REVIEW",
      reason: "NO_VALID_TEAM_DATA_PREVIOUS_ROUND",
      keepRow: null,
      duplicateRows: []
    };
  }

  if(validHandlers.length > 1){
    return {
      status: "REVIEW",
      reason: "MULTIPLE_VALID_HANDLERS_IN_TEAM_DATA",
      keepRow: null,
      duplicateRows: []
    };
  }

  if(rawEvidenceCount === 0){
    return {
      status: "REVIEW",
      reason: "NO_RAW_DATA_PROMOTION_EVIDENCE",
      keepRow: null,
      duplicateRows: []
    };
  }

  if(sameDay && !explicitLoop){
    return {
      status: "REVIEW",
      reason: "SAME_DAY_NON_LOOP_PROGRESSION",
      keepRow: null,
      duplicateRows: []
    };
  }

  const owner = validHandlers[0] || "";

  const ownerRows = trackerRows.filter(function(item){
    return PDPR_sameText_(item.handler, owner);
  });

  if(ownerRows.length === 0){
    return {
      status: "REVIEW",
      reason: "TRACKER_HANDLER_DOES_NOT_MATCH_TEAM_OWNER",
      keepRow: null,
      duplicateRows: []
    };
  }

  const ownerRowsWithRawDate = ownerRows.filter(function(item){
    return rawDates.indexOf(item.promotionDate) >= 0;
  });

  if(ownerRowsWithRawDate.length === 1){

    const keepRow = ownerRowsWithRawDate[0].sheetRow;

    return {
      status: "RESOLVABLE",
      reason: "ONE_TRACKER_ROW_MATCHES_TEAM_OWNER_AND_RAW_DATE",
      teamOwner: owner,
      keepRow: keepRow,
      duplicateRows:
        trackerRows
          .filter(function(item){
            return item.sheetRow !== keepRow;
          })
          .map(function(item){
            return item.sheetRow;
          })
    };
  }

  if(ownerRows.length === 1){

    const keepRow = ownerRows[0].sheetRow;

    return {
      status: "RESOLVABLE",
      reason: "ONE_TRACKER_ROW_MATCHES_TEAM_OWNER",
      teamOwner: owner,
      keepRow: keepRow,
      duplicateRows:
        trackerRows
          .filter(function(item){
            return item.sheetRow !== keepRow;
          })
          .map(function(item){
            return item.sheetRow;
          })
    };
  }

  const samePromotionDate =
    PDPR_unique_(
      ownerRows.map(function(item){
        return item.promotionDate;
      })
    ).length === 1;

  if(ownerRows.length > 1 && samePromotionDate){

    const sortedRows = ownerRows
      .map(function(item){
        return item.sheetRow;
      })
      .sort(function(a,b){
        return a - b;
      });

    return {
      status: "RESOLVABLE",
      reason: "SAME_OWNER_SAME_PROMOTION_DATE_DUPLICATE",
      teamOwner: owner,
      keepRow: sortedRows[0],
      duplicateRows: sortedRows.slice(1)
    };
  }

  return {
    status: "REVIEW",
    reason: "MULTIPLE_POSSIBLE_TRACKER_ROWS",
    teamOwner: owner,
    keepRow: null,
    duplicateRows: []
  };
}


function PDPR_buildLogicalKey_(row){

  if(!Array.isArray(row) || row.length < 10){
    return "";
  }

  const type = String(row[0] || "").trim().toLowerCase();
  const candidate = PDPR_normalizeIdentity_(row[1]);
  const client = PDPR_normalizeIdentity_(PDPR_cleanClient_(row[2]));
  const fromRoundNo = PDPR_roundNo_(row[3]);
  const toRoundNo = PDPR_roundNo_(row[4]);
  const previousDate = PDPR_dateKey_(row[5]);

  if(
    !type ||
    !candidate ||
    !client ||
    !fromRoundNo ||
    !toRoundNo ||
    !previousDate
  ){
    return "";
  }

  return [
    type,
    candidate,
    client,
    fromRoundNo,
    toRoundNo,
    previousDate
  ].join("||");
}


function PDPR_cleanClient_(value){

  let text = String(value || "")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();

  let previous = "";

  while(text && text !== previous){

    previous = text;

    text = text
      .replace(
        /^\s*(?:loop\s+interview|final\s+interview|technical\s+interview|assessment\s+through\s+interview|assessment\s+interview|behavioral\s+interview|behavioural\s+interview|panel\s+interview|client\s+interview|manager\s+interview|director\s+interview|interview)\s*(?:-|:)\s*/i,
        ""
      )
      .replace(
        /\s*(?:-|:)\s*(?:loop\s+interview|final\s+interview|technical\s+interview|assessment\s+through\s+interview|assessment\s+interview|behavioral\s+interview|behavioural\s+interview|panel\s+interview|client\s+interview|manager\s+interview|director\s+interview|interview)\s*$/i,
        ""
      )
      .replace(/\s+/g, " ")
      .trim();
  }

  return text;
}


function PDPR_roundNo_(value){

  const text = String(value || "").trim();

  if(!text){
    return 0;
  }

  const numeric = text.match(/\b(\d+)\s*(?:st|nd|rd|th)?\s*(?:round|rd)?\b/i);

  if(numeric){
    return parseInt(numeric[1], 10) || 0;
  }

  const wordMap = {
    first: 1,
    second: 2,
    third: 3,
    fourth: 4,
    fifth: 5,
    sixth: 6,
    seventh: 7,
    eighth: 8,
    ninth: 9,
    tenth: 10
  };

  const lower = text.toLowerCase();

  for(const word in wordMap){
    if(new RegExp("\\b" + word + "\\s+round\\b", "i").test(lower)){
      return wordMap[word];
    }
  }

  if(/\bfinal\b/i.test(text)){
    return 999;
  }

  return 0;
}


function PDPR_roundLabel_(roundNo){

  const n = Number(roundNo) || 0;

  if(n === 999){
    return "Final";
  }

  if(!n){
    return "Unknown";
  }

  const mod100 = n % 100;
  const mod10 = n % 10;
  let suffix = "th";

  if(mod100 < 11 || mod100 > 13){
    if(mod10 === 1) suffix = "st";
    else if(mod10 === 2) suffix = "nd";
    else if(mod10 === 3) suffix = "rd";
  }

  return n + suffix + " Round";
}


function PDPR_normalizeIdentity_(value){

  return String(value || "")
    .toLowerCase()
    .replace(/[–—]/g, "-")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}


function PDPR_dateKey_(value){

  if(!value){
    return "";
  }

  let date = value;

  if(!(date instanceof Date)){
    date = new Date(value);
  }

  if(!(date instanceof Date) || isNaN(date.getTime())){
    return "";
  }

  return Utilities.formatDate(
    date,
    Session.getScriptTimeZone(),
    "yyyy-MM-dd"
  );
}


function PDPR_validTeamOwner_(record){

  if(!record){
    return false;
  }

  const handler = String(record.handler || "").trim();
  const status = String(record.status || "").trim().toLowerCase();

  if(!handler){
    return false;
  }

  if(/^(support|rescheduled|cancelled|canceled)$/i.test(handler)){
    return false;
  }

  if(/^(rescheduled|cancelled|canceled)$/i.test(status)){
    return false;
  }

  return true;
}


function PDPR_isLoop_(record){

  if(!record){
    return false;
  }

  if(record.isLoopInterview === true || record.isLoop === true){
    return true;
  }

  const combined = [
    record.originalText,
    record.client,
    record.round
  ].join(" ");

  return /\b(?:loop\s+interview|interview\s+loop)\b/i.test(combined);
}


function PDPR_sameText_(a,b){
  return PDPR_normalizeIdentity_(a) === PDPR_normalizeIdentity_(b);
}


function PDPR_unique_(values){

  const seen = {};
  const output = [];

  values.forEach(function(value){

    const key = String(value || "").trim().toLowerCase();

    if(!key || seen[key]){
      return;
    }

    seen[key] = true;
    output.push(value);
  });

  return output;
}

