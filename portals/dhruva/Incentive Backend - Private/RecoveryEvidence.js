/******************************************************
 * RECOVERY EVIDENCE - FAST PRIVATE v2.0
 *
 * Purpose:
 * - Build one central Recovery Evidence sheet.
 * - Make Recovery ID clickable in Promotion Recovery.
 * - Make Exception ID clickable in Recovery Exceptions.
 * - Show the exact Raw Data / Team Data source rows.
 *
 * This file does NOT change incentive calculations.
 *
 * PERFORMANCE PATCH:
 * - Keeps private/shared workbook routing.
 * - Restores date+round source indexes.
 * - Avoids full Raw/Team rescans for every evidence row.
 * - Keeps batched evidence/link writes.
 * - Adds stage timing logs.
 ******************************************************/

const RE_EVIDENCE_SHEET_NAME = "Recovery Evidence";


/******************************************************
 * MAIN REFRESH
 ******************************************************/
function REC_refreshRecoveryEvidence(){

  const ss = IR_backend_();

  const recoverySheetName =
    (typeof REC_SETTINGS !== "undefined" && REC_SETTINGS.SHEET_NAME)
      ? REC_SETTINGS.SHEET_NAME
      : "Promotion Recovery";

  const exceptionSheetName =
    (typeof REC_SETTINGS !== "undefined" && REC_SETTINGS.EXCEPTIONS_SHEET_NAME)
      ? REC_SETTINGS.EXCEPTIONS_SHEET_NAME
      : "Recovery Exceptions";

  const recoverySheet = ss.getSheetByName(recoverySheetName);
  const exceptionSheet = ss.getSheetByName(exceptionSheetName);

  const refreshStarted =
    Date.now();

  const sourceLoadStarted =
    Date.now();

  const rawSource = RE_loadRawSourceRows();
  const teamSource = RE_loadTeamSourceRows();

  Logger.log(
    "Recovery Evidence source load : Raw " +
    rawSource.length +
    " | Team " +
    teamSource.length +
    " | " +
    (Date.now() - sourceLoadStarted) +
    " ms"
  );

  const indexStarted =
    Date.now();

  // Build date+round indexes ONCE.
  // All evidence matching below reads only the small
  // relevant date+round pool instead of rescanning
  // thousands of source rows every time.
  const rawSourceIndex =
    RE_buildSourceIndex(
      rawSource
    );

  const teamSourceIndex =
    RE_buildSourceIndex(
      teamSource
    );

  Logger.log(
    "Recovery Evidence source indexes : " +
    (Date.now() - indexStarted) +
    " ms"
  );

  const evidenceBuildStarted =
    Date.now();

  const evidenceRows = [];

  //--------------------------------------------------
  // Promotion Recovery
  //--------------------------------------------------

  if(recoverySheet && recoverySheet.getLastRow() > 1){

    const values = recoverySheet.getDataRange().getValues();
    const headers = RE_headerMap(values[0]);

    for(let i = 1; i < values.length; i++){

      const row = values[i];
      const id = RE_cell(row, headers, "Recovery ID");

      if(!id)
        continue;

      const candidate = RE_cell(row, headers, "Candidate");
      const previousRound = RE_cell(row, headers, "Previous Round");
      const currentRound = RE_cell(row, headers, "Current Round");
      const teamClient = RE_cell(row, headers, "Team Client");
      const rawClient = RE_cell(row, headers, "Raw Client");
      const teamDate = RE_cell(row, headers, "Team Date");
      const promotionDate = RE_cell(row, headers, "Promotion Date");
      const handler = RE_cell(row, headers, "Suggested Handler");

      const previousTeam = RE_findBestTeamSource(
        teamSourceIndex,
        candidate,
        teamClient,
        previousRound,
        teamDate,
        handler
      );

      const currentRaw = RE_findBestRawSource(
        rawSourceIndex,
        candidate,
        rawClient,
        currentRound,
        promotionDate
      );

      const currentCandidate =
        currentRaw && currentRaw.candidate
          ? currentRaw.candidate
          : candidate;

      const currentClient =
        currentRaw && currentRaw.client
          ? currentRaw.client
          : rawClient;

      const currentTeam = RE_findBestCurrentTeamSource(
        teamSourceIndex,
        currentCandidate,
        currentClient,
        currentRound,
        promotionDate
      );

      evidenceRows.push({
        id: id,
        type: "Promotion Recovery",
        teamCandidate: previousTeam ? previousTeam.candidate : candidate,
        rawCandidate: currentRaw ? currentRaw.candidate : "",
        teamClient: previousTeam ? previousTeam.client : teamClient,
        rawClient: currentRaw ? currentRaw.client : rawClient,
        previousRound: previousTeam ? previousTeam.round : previousRound,
        currentRound: currentRaw ? currentRaw.round : currentRound,
        teamDate: previousTeam ? previousTeam.dateObj : teamDate,
        promotionDate: currentRaw ? currentRaw.dateObj : promotionDate,
        previousTeam: previousTeam,
        currentRaw: currentRaw,
        currentTeam: currentTeam,
        candidateScore: RE_cell(row, headers, "Candidate %"),
        clientScore: RE_cell(row, headers, "Client %"),
        confidence: RE_cell(row, headers, "Confidence"),
        reason: RE_cell(row, headers, "Match Reason"),
        status: RE_cell(row, headers, "Status")
      });

    }

  }

  //--------------------------------------------------
  // Recovery Exceptions
  //--------------------------------------------------

  if(exceptionSheet && exceptionSheet.getLastRow() > 1){

    const values = exceptionSheet.getDataRange().getValues();
    const headers = RE_headerMap(values[0]);

    for(let i = 1; i < values.length; i++){

      const row = values[i];
      const id = RE_cell(row, headers, "Exception ID");

      if(!id)
        continue;

      const rawCandidate = RE_cell(row, headers, "Candidate");
      const rawClient = RE_cell(row, headers, "Raw Client");
      const rawRound = RE_cell(row, headers, "Raw Round");
      const promotionDate = RE_cell(row, headers, "Promotion Date");

      const teamCandidate = RE_cell(row, headers, "Possible Team Candidate");
      const teamClient = RE_cell(row, headers, "Team Client");
      const teamRound = RE_cell(row, headers, "Team Round");
      const teamDate = RE_cell(row, headers, "Team Date");
      const handlers = RE_cell(row, headers, "Suggested Handler(s)");

      const previousTeam = RE_findBestTeamSource(
        teamSourceIndex,
        teamCandidate || rawCandidate,
        teamClient,
        teamRound,
        teamDate,
        handlers
      );

      const currentRaw = RE_findBestRawSource(
        rawSourceIndex,
        rawCandidate,
        rawClient,
        rawRound,
        promotionDate
      );

      const currentCandidate =
        currentRaw && currentRaw.candidate
          ? currentRaw.candidate
          : rawCandidate;

      const currentClient =
        currentRaw && currentRaw.client
          ? currentRaw.client
          : rawClient;

      const currentTeam = RE_findBestCurrentTeamSource(
        teamSourceIndex,
        currentCandidate,
        currentClient,
        rawRound,
        promotionDate
      );

      const issueType = RE_cell(row, headers, "Issue Type");
      const reason = RE_cell(row, headers, "Reason");

      evidenceRows.push({
        id: id,
        type: "Recovery Exception",
        teamCandidate: previousTeam ? previousTeam.candidate : teamCandidate,
        rawCandidate: currentRaw ? currentRaw.candidate : rawCandidate,
        teamClient: previousTeam ? previousTeam.client : teamClient,
        rawClient: currentRaw ? currentRaw.client : rawClient,
        previousRound: previousTeam ? previousTeam.round : teamRound,
        currentRound: currentRaw ? currentRaw.round : rawRound,
        teamDate: previousTeam ? previousTeam.dateObj : teamDate,
        promotionDate: currentRaw ? currentRaw.dateObj : promotionDate,
        previousTeam: previousTeam,
        currentRaw: currentRaw,
        currentTeam: currentTeam,
        candidateScore: RE_cell(row, headers, "Candidate %"),
        clientScore: RE_cell(row, headers, "Client %"),
        confidence: "",
        reason: issueType + (reason ? " | " + reason : ""),
        status: RE_cell(row, headers, "Status")
      });

    }

  }

  Logger.log(
    "Recovery Evidence matching : " +
    evidenceRows.length +
    " rows | " +
    (Date.now() - evidenceBuildStarted) +
    " ms"
  );

  //--------------------------------------------------
  // Write evidence + install links
  //--------------------------------------------------

  const evidenceSheet = RE_writeEvidenceSheet(evidenceRows);
  const evidenceRowMap = RE_buildEvidenceRowMap(evidenceRows);

  if(recoverySheet){
    RE_linkIdColumn(
      recoverySheet,
      "Recovery ID",
      evidenceSheet,
      evidenceRowMap
    );
  }

  if(exceptionSheet){
    RE_linkIdColumn(
      exceptionSheet,
      "Exception ID",
      evidenceSheet,
      evidenceRowMap
    );
  }

  Logger.log("Recovery Evidence Records : " + evidenceRows.length);

  Logger.log(
    "Recovery Evidence TOTAL : " +
    (Date.now() - refreshStarted) +
    " ms"
  );

}


/******************************************************
 * LOAD RAW DATA WITH ORIGINAL SHEET ROW NUMBER
 ******************************************************/
function RE_loadRawSourceRows(){

  const ss = IR_operations_();
  const sheet = ss.getSheetByName(CONFIG.RAW_SHEET);

  if(!sheet)
    throw new Error("Raw Data sheet not found.");

  const values = sheet.getDataRange().getValues();
  const records = [];
  let currentDate = null;

  for(let i = 0; i < values.length; i++){

    const colB = values[i][1];

    if(colB instanceof Date){
      currentDate = new Date(colB);
      continue;
    }

    if(!colB || !(currentDate instanceof Date))
      continue;

    const interview = parseInterview(colB);

    if(!interview)
      continue;

    interview.dateObj = new Date(currentDate);
    interview.sourceRow = i + 1;
    interview.originalText = String(colB || "").trim();

    records.push(interview);

  }

  return records;

}


/******************************************************
 * LOAD TEAM DATA WITH ORIGINAL SHEET ROW NUMBER
 ******************************************************/
function RE_loadTeamSourceRows(){

  const ss = IR_operations_();
  const sheet = ss.getSheetByName(CONFIG.TEAM_SHEET);

  if(!sheet)
    throw new Error("Team Data sheet not found.");

  const values = sheet.getDataRange().getValues();
  const records = [];
  let currentDate = null;

  for(let i = 0; i < values.length; i++){

    const colA = values[i][0];
    const colB = values[i][1];
    const colC = values[i][2];
    const colD = values[i][3];

    if(colA && !colB){
      currentDate = parseSheetDate(colA);
      continue;
    }

    if(!colB || !(currentDate instanceof Date))
      continue;

    const interview = parseInterview(colB);

    if(!interview)
      continue;

    interview.handler = String(colC || "").trim();
    interview.status = String(colD || "").trim();
    interview.dateObj = new Date(currentDate);
    interview.sourceRow = i + 1;
    interview.originalText = String(colB || "").trim();

    records.push(interview);

  }

  return records;

}


/******************************************************
 * BUILD FAST SOURCE INDEX
 *
 * Key:
 * yyyy-MM-dd|normalized round
 *
 * PERFORMANCE:
 * Recovery Evidence previously rescanned every Raw/Team
 * record for every evidence row. With 3,273 Raw records
 * and 1,718 Team records this caused multi-minute runs.
 ******************************************************/
function RE_buildSourceIndex(records){

  const index = {};

  records.forEach(function(record){

    const key =
      RE_dateKeySafe(record.dateObj) +
      "|" +
      RE_normalizeRound(record.round);

    if(!key || key === "|")
      return;

    if(!index[key])
      index[key] = [];

    index[key].push(record);

  });

  return index;

}


/******************************************************
 * GET SMALL DATE + ROUND SOURCE POOL
 ******************************************************/
function RE_getSourcePool(index, dateValue, round){

  const key =
    RE_dateKeySafe(dateValue) +
    "|" +
    RE_normalizeRound(round);

  return index[key] || [];

}


/******************************************************
 * FIND PREVIOUS / POSSIBLE TEAM SOURCE ROW
 ******************************************************/
function RE_findBestTeamSource(
  index,
  candidate,
  client,
  round,
  dateValue,
  handler
){

  const handlerTokens = RE_handlerTokens(handler);

  const pool =
    RE_getSourcePool(
      index,
      dateValue,
      round
    );

  let best = null;
  let bestScore = -1;

  pool.forEach(function(record){

    const candidateScore = REC_candidateScore(
      record.candidate,
      candidate
    );

    const clientScore = REC_clientScore(
      record.client,
      client
    );

    if(candidateScore < 80 || clientScore < 70)
      return;

    let score = candidateScore + clientScore;

    if(
      handlerTokens.length > 0 &&
      handlerTokens.indexOf(RE_normalizeHandler(record.handler)) !== -1
    ){
      score += 25;
    }

    if(score > bestScore){
      bestScore = score;
      best = record;
    }

  });

  return best;

}


/******************************************************
 * FIND CURRENT RAW SOURCE ROW
 ******************************************************/
function RE_findBestRawSource(
  index,
  candidate,
  client,
  round,
  dateValue
){

  const pool =
    RE_getSourcePool(
      index,
      dateValue,
      round
    );

  let best = null;
  let bestScore = -1;

  pool.forEach(function(record){

    const candidateScore = REC_candidateScore(
      record.candidate,
      candidate
    );

    const clientScore = REC_clientScore(
      record.client,
      client
    );

    if(candidateScore < 70 || clientScore < 65)
      return;

    const score = candidateScore + clientScore;

    if(score > bestScore){
      bestScore = score;
      best = record;
    }

  });

  return best;

}


/******************************************************
 * FIND CURRENT ROUND TEAM OCCURRENCE
 *
 * Includes real handlers AND values such as:
 * Rescheduled / Cancelled / Support / blank.
 ******************************************************/
function RE_findBestCurrentTeamSource(
  index,
  candidate,
  client,
  round,
  dateValue
){

  const pool =
    RE_getSourcePool(
      index,
      dateValue,
      round
    );

  let best = null;
  let bestScore = -1;

  pool.forEach(function(record){

    const candidateScore = REC_candidateScore(
      record.candidate,
      candidate
    );

    const clientScore = REC_clientScore(
      record.client,
      client
    );

    if(candidateScore < 80 || clientScore < 70)
      return;

    const score = candidateScore + clientScore;

    if(score > bestScore){
      bestScore = score;
      best = record;
    }

  });

  return best;

}


/******************************************************
 * WRITE CENTRAL RECOVERY EVIDENCE SHEET
 ******************************************************/
function RE_writeEvidenceSheet(evidenceRows){

  const started = Date.now();

  const backend =
    IR_backend_();

  const operations =
    IR_operations_();

  let sheet =
    backend.getSheetByName(
      RE_EVIDENCE_SHEET_NAME
    );

  if(!sheet){
    sheet =
      backend.insertSheet(
        RE_EVIDENCE_SHEET_NAME
      );
  }

  //--------------------------------------------------
  // Preserve column widths / layout where possible.
  // Clear only values + rich text content.
  //--------------------------------------------------

  sheet.clearContents();

  const header = [
    "Evidence ID",
    "Type",
    "Team Candidate",
    "Raw Candidate",
    "Team Client",
    "Raw Client",
    "Previous / Team Round",
    "Current / Raw Round",
    "Team Date",
    "Promotion Date",
    "Previous Team Original Text",
    "Previous Team Handler",
    "Previous Team Status",
    "Previous Team Source",
    "Current Raw Original Text",
    "Current Raw Source",
    "Current Team Original Text",
    "Current Team Handler",
    "Current Team Status",
    "Current Team Source",
    "Candidate %",
    "Client %",
    "Confidence",
    "Issue / Match Reason",
    "Review Status"
  ];

  sheet
    .getRange(
      1,
      1,
      1,
      header.length
    )
    .setValues(
      [header]
    );

  const count =
    evidenceRows.length;

  if(count){

    const output =
      evidenceRows.map(
        function(item){

          return [
            item.id,
            item.type,
            item.teamCandidate || "",
            item.rawCandidate || "",
            item.teamClient || "",
            item.rawClient || "",
            item.previousRound || "",
            item.currentRound || "",
            item.teamDate || "",
            item.promotionDate || "",
            item.previousTeam
              ? item.previousTeam.originalText
              : "Not found",
            item.previousTeam
              ? item.previousTeam.handler
              : "",
            item.previousTeam
              ? item.previousTeam.status
              : "",
            item.previousTeam
              ? "Open Team Row " +
                item.previousTeam.sourceRow
              : "Not found",
            item.currentRaw
              ? item.currentRaw.originalText
              : "Not found",
            item.currentRaw
              ? "Open Raw Row " +
                item.currentRaw.sourceRow
              : "Not found",
            item.currentTeam
              ? item.currentTeam.originalText
              : "Not found in Team Data",
            item.currentTeam
              ? item.currentTeam.handler
              : "",
            item.currentTeam
              ? item.currentTeam.status
              : "",
            item.currentTeam
              ? "Open Team Row " +
                item.currentTeam.sourceRow
              : "Not found",
            item.candidateScore,
            item.clientScore,
            item.confidence,
            item.reason || "",
            item.status || ""
          ];

        }
      );

    sheet
      .getRange(
        2,
        1,
        output.length,
        output[0].length
      )
      .setValues(
        output
      );

    sheet
      .getRange(
        2,
        9,
        output.length,
        2
      )
      .setNumberFormat(
        "dd-MMM-yyyy"
      );

    sheet
      .getRange(
        2,
        21,
        output.length,
        3
      )
      .setNumberFormat(
        "0"
      );


    //--------------------------------------------------
    // IMPORTANT PRIVATE-MIGRATION FIX:
    // Raw Data + Team Data live in the SHARED workbook.
    //
    // Previous code looked for these inside backend,
    // where they no longer exist.
    //--------------------------------------------------

    const rawSheet =
      operations.getSheetByName(
        CONFIG.RAW_SHEET
      );

    const teamSheet =
      operations.getSheetByName(
        CONFIG.TEAM_SHEET
      );


    //--------------------------------------------------
    // Build source hyperlinks IN MEMORY and write each
    // source column once.
    //
    // This replaces many slow per-cell Spreadsheet
    // service calls.
    //--------------------------------------------------

    const previousTeamLinks = [];
    const currentRawLinks = [];
    const currentTeamLinks = [];

    evidenceRows.forEach(
      function(item){

        previousTeamLinks.push([
          RE_buildSourceRichText_(
            item.previousTeam
              ? "Open Team Row " +
                item.previousTeam.sourceRow
              : "Not found",
            teamSheet,
            item.previousTeam
              ? item.previousTeam.sourceRow
              : 0
          )
        ]);

        currentRawLinks.push([
          RE_buildSourceRichText_(
            item.currentRaw
              ? "Open Raw Row " +
                item.currentRaw.sourceRow
              : "Not found",
            rawSheet,
            item.currentRaw
              ? item.currentRaw.sourceRow
              : 0
          )
        ]);

        currentTeamLinks.push([
          RE_buildSourceRichText_(
            item.currentTeam
              ? "Open Team Row " +
                item.currentTeam.sourceRow
              : "Not found",
            teamSheet,
            item.currentTeam
              ? item.currentTeam.sourceRow
              : 0
          )
        ]);

      }
    );


    sheet
      .getRange(
        2,
        14,
        count,
        1
      )
      .setRichTextValues(
        previousTeamLinks
      );

    sheet
      .getRange(
        2,
        16,
        count,
        1
      )
      .setRichTextValues(
        currentRawLinks
      );

    sheet
      .getRange(
        2,
        20,
        count,
        1
      )
      .setRichTextValues(
        currentTeamLinks
      );

  }


  //--------------------------------------------------
  // Light formatting only.
  // Avoid autoResizeColumns(), which is unnecessary on
  // every evidence refresh and can be slow.
  //--------------------------------------------------

  sheet
    .getRange(
      1,
      1,
      1,
      header.length
    )
    .setFontWeight(
      "bold"
    )
    .setHorizontalAlignment(
      "center"
    )
    .setBackground(
      "#CFE2F3"
    );

  sheet.setFrozenRows(1);

  const usedRows =
    Math.max(
      count + 1,
      1
    );

  sheet
    .getRange(
      1,
      1,
      usedRows,
      header.length
    )
    .setVerticalAlignment(
      "top"
    )
    .setWrap(
      true
    );

  Logger.log(
    "Recovery Evidence sheet write : " +
    count +
    " rows | " +
    (Date.now() - started) +
    " ms"
  );

  return sheet;
}


/******************************************************
 * BUILD ID -> EVIDENCE ROW MAP
 ******************************************************/
function RE_buildEvidenceRowMap(evidenceRows){

  const map = {};

  evidenceRows.forEach(function(item, index){
    map[String(item.id || "").trim()] = index + 2;
  });

  return map;

}


/******************************************************
 * MAKE ID COLUMN CLICKABLE
 ******************************************************/
function RE_linkIdColumn(
  sheet,
  idHeader,
  evidenceSheet,
  evidenceRowMap
){

  const lastRow =
    sheet.getLastRow();

  if(lastRow <= 1){
    return;
  }

  const lastCol =
    sheet.getLastColumn();

  const headerRow =
    sheet
      .getRange(
        1,
        1,
        1,
        lastCol
      )
      .getValues()[0];

  const headers =
    RE_headerMap(
      headerRow
    );

  const idCol =
    headers[idHeader];

  if(idCol === undefined){
    return;
  }

  const range =
    sheet.getRange(
      2,
      idCol + 1,
      lastRow - 1,
      1
    );

  const ids =
    range
      .getDisplayValues();

  const baseUrl =
    evidenceSheet
      .getParent()
      .getUrl() +
    "#gid=" +
    evidenceSheet.getSheetId() +
    "&range=A";

  const richTextValues =
    ids.map(
      function(row){

        const id =
          String(
            row[0] || ""
          ).trim();

        const evidenceRow =
          evidenceRowMap[id];

        const builder =
          SpreadsheetApp
            .newRichTextValue()
            .setText(
              id
            );

        if(
          id &&
          evidenceRow
        ){
          builder.setLinkUrl(
            baseUrl +
            evidenceRow
          );
        }

        return [
          builder.build()
        ];

      }
    );

  range
    .setRichTextValues(
      richTextValues
    );

  Logger.log(
    idHeader +
    " links refreshed : " +
    richTextValues.length
  );
}


/******************************************************
 * FAST PRIVATE SOURCE-LINK BUILDER
 ******************************************************/
function RE_buildSourceRichText_(
  label,
  targetSheet,
  rowNumber
){

  const text =
    String(
      label || ""
    );

  const builder =
    SpreadsheetApp
      .newRichTextValue()
      .setText(
        text
      );

  if(
    targetSheet &&
    Number(rowNumber) > 0
  ){

    const url =
      targetSheet
        .getParent()
        .getUrl() +
      "#gid=" +
      targetSheet.getSheetId() +
      "&range=A" +
      Number(rowNumber);

    builder.setLinkUrl(
      url
    );

  }

  return builder.build();
}

/******************************************************
 * SOURCE ROW LINK
 ******************************************************/
function RE_setSourceLink(cell, label, targetSheet, rowNumber){

  const url =
    targetSheet.getParent().getUrl() +
    "#gid=" + targetSheet.getSheetId() +
    "&range=A" + rowNumber;

  const richText = SpreadsheetApp
    .newRichTextValue()
    .setText(label)
    .setLinkUrl(url)
    .build();

  cell
    .setRichTextValue(richText)
    .setFontColor("#1155CC")
    .setFontLine("underline");

}


/******************************************************
 * HEADER MAP
 ******************************************************/
function RE_headerMap(headerRow){

  const map = {};

  headerRow.forEach(function(value, index){
    map[String(value || "").trim()] = index;
  });

  return map;

}


/******************************************************
 * READ CELL BY HEADER
 ******************************************************/
function RE_cell(row, headerMap, headerName){

  const index = headerMap[headerName];

  if(index === undefined)
    return "";

  return row[index];

}


/******************************************************
 * DATE KEY - ACCEPTS DATE OR DATE-LIKE VALUE
 ******************************************************/
function RE_dateKeySafe(value){

  if(value instanceof Date && !isNaN(value.getTime())){
    return REC_dateKey(value);
  }

  if(!value)
    return "";

  const parsed = new Date(value);

  if(isNaN(parsed.getTime()))
    return "";

  return REC_dateKey(parsed);

}


/******************************************************
 * NORMALIZE ROUND
 ******************************************************/
function RE_normalizeRound(value){

  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

}


/******************************************************
 * NORMALIZE HANDLER
 ******************************************************/
function RE_normalizeHandler(value){

  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

}


/******************************************************
 * HANDLER TOKENS
 *
 * Handles exception values such as:
 * "Naresh / Pradeep"
 ******************************************************/
function RE_handlerTokens(value){

  return String(value || "")
    .split("/")
    .map(function(item){
      return RE_normalizeHandler(item);
    })
    .filter(function(item){
      return !!item;
    });

}


/******************************************************
 * OPTIONAL MANUAL TEST
 ******************************************************/
function testRecoveryEvidence(){

  REC_refreshRecoveryEvidence();

  SpreadsheetApp.getUi().alert(
    "Recovery Evidence refreshed.\n\n" +
    "Click a Recovery ID or Exception ID to test the links."
  );

}
