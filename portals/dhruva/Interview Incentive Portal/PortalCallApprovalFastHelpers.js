/******************************************************
 * PORTAL CALL APPROVAL - FAST BULK HELPERS
 *
 * Target project: Interview Portal Control
 * Purpose: execution-scoped snapshots + batched writes
 * for Approve All Handler Requests.
 *
 * These helpers do NOT change single-row approval.
 ******************************************************/

function PCO_FAST_loadPendingOutcomeContext_(
  sheet
){

  const values =
    sheet.getDataRange().getValues();

  if(values.length <= 1){
    return {
      sheet: sheet,
      values: values,
      cols:
        values.length
          ? PCO_headerMap_(values[0])
          : {},
      requests: [],
      markedRows: {}
    };
  }

  const cols =
    PCO_headerMap_(values[0]);

  const requests = [];

  for(let i = 1; i < values.length; i++){

    const row = values[i];

    const statusKey =
      String(
        row[cols["Request Status"]] || ""
      )
      .trim()
      .toLowerCase();

    if(statusKey !== "pending"){
      continue;
    }

    requests.push({
      rowNumber: i + 1,
      requestId:
        String(
          row[cols["Request ID"]] || ""
        ).trim(),
      callId:
        String(
          row[cols["Call ID"]] || ""
        ).trim(),
      workingDate:
        String(
          row[cols["Working Date"]] || ""
        ).trim(),
      dateKey:
        PCO_normalizeDateKey_(
          row[cols["Date Key"]]
        ),
      sourceRow:
        Number(
          row[cols["Source Row"]] || 0
        ),
      interviewText:
        String(
          row[cols["Interview Text"]] || ""
        ).trim(),
      candidate:
        String(
          row[cols["Candidate"]] || ""
        ).trim(),
      client:
        String(
          row[cols["Client"]] || ""
        ).trim(),
      duration:
        String(
          row[cols["Duration"]] || ""
        ).trim(),
      handler:
        String(
          row[cols["Original Handler"]] || ""
        ).trim(),
      outcome:
        String(
          row[cols["Requested Outcome"]] || ""
        ).trim()
    });

  }

  requests.sort(function(a,b){

    if(a.dateKey !== b.dateKey){
      return a.dateKey.localeCompare(b.dateKey);
    }

    return PC_handlerKey_(a.handler)
      .localeCompare(
        PC_handlerKey_(b.handler)
      );

  });

  return {
    sheet: sheet,
    values: values,
    cols: cols,
    requests: requests,
    markedRows: {}
  };

}


function PCO_FAST_scheduleContext_(
  sheet
){

  const lastRow =
    sheet.getLastRow();

  const values =
    lastRow > 0
      ? sheet
          .getRange(
            1,
            5,
            lastRow,
            2
          )
          .getDisplayValues()
      : [];

  return {
    sheet: sheet,
    lastRow: lastRow,
    values: values,
    markedRows: {}
  };

}


function PCO_FAST_statusContext_(){

  const sheet =
    PC_getStatusSheet_();

  const values =
    sheet.getDataRange().getValues();

  const byId = {};
  const byFallback = {};

  for(let i = 1; i < values.length; i++){

    const callId =
      String(values[i][0] || "").trim();

    const fallback =
      String(values[i][2] || "").trim() +
      "|" +
      PC_normalizeText_(
        values[i][4]
      );

    if(callId){
      byId[callId] = i;
    }

    if(
      String(values[i][2] || "").trim() &&
      String(values[i][4] || "").trim()
    ){
      byFallback[fallback] = i;
    }

  }

  return {
    sheet: sheet,
    values: values,
    byId: byId,
    byFallback: byFallback,
    markedRows: {}
  };

}


function PCO_FAST_teamContext_(){

  const ss =
    portalOperations_();

  const teamSheetName =
    typeof PTR_teamDataSheetName_ === "function"
      ? PTR_teamDataSheetName_()
      : PORTAL_CONFIG.TEAM_SHEET;

  const teamSheet =
    ss.getSheetByName(
      teamSheetName
    );

  if(!teamSheet){
    throw new Error(
      "TEAM_DATA_SHEET_NOT_FOUND|" +
      teamSheetName
    );
  }

  const teamValues =
    teamSheet.getDataRange().getValues();

  const mapSheet =
    PCO_getSyncMapSheet_();

  const mapValues =
    mapSheet.getDataRange().getValues();

  const mapCols =
    mapValues.length
      ? PCO_headerMap_(mapValues[0])
      : {};

  const mapByCall = {};

  for(let i = 1; i < mapValues.length; i++){

    const callId =
      String(
        mapValues[i][
          mapCols["Call ID"]
        ] || ""
      ).trim();

    if(!callId){
      continue;
    }

    mapByCall[callId] = {
      arrayIndex: i,
      rowNumber: i + 1,
      teamRow:
        Number(
          mapValues[i][
            mapCols["Team Data Row"]
          ] || 0
        )
    };

  }

  return {
    teamSheet: teamSheet,
    teamValues: teamValues,
    teamMarkedRows: {},
    newTeamRows: [],
    layoutLoaded: false,
    layout: null,
    recordMap: null,
    nextWriteRow: 0,
    mapSheet: mapSheet,
    mapValues: mapValues,
    mapCols: mapCols,
    mapByCall: mapByCall,
    mapMarkedRows: {}
  };

}


function PCO_FAST_prepareOutcome_(
  request,
  adminUser,
  scheduleContext,
  statusContext,
  teamContext,
  fallbackSchedules
){

  const scheduleSheet =
    scheduleContext.sheet;

  let sourceRow =
    Number(request.sourceRow || 0);

  let rowValues =
    PCO_FAST_scheduleRow_(
      scheduleContext,
      sourceRow
    );

  let currentInterview =
    rowValues
      ? String(rowValues[0] || "").trim()
      : "";

  let currentHandler =
    rowValues
      ? String(rowValues[1] || "")
          .replace(/\s+/g," ")
          .trim()
      : "";

  //--------------------------------------------------
  // Preserve existing row-move recovery, but cache
  // each date block if fallback is required.
  //--------------------------------------------------

  if(
    !rowValues ||
    PCO_normalize_(currentInterview) !==
      PCO_normalize_(request.interviewText)
  ){

    const dateKey =
      String(request.dateKey || "");

    if(!fallbackSchedules[dateKey]){
      fallbackSchedules[dateKey] =
        PC_loadScheduleByDateKey_(
          dateKey
        );
    }

    const matches =
      fallbackSchedules[dateKey]
        .calls
        .filter(function(call){
          return (
            PCO_normalize_(
              call.originalText
            ) ===
            PCO_normalize_(
              request.interviewText
            )
          );
        });

    if(matches.length !== 1){
      throw new Error(
        matches.length > 1
          ? "CALL_ROW_AMBIGUOUS_AFTER_MOVE"
          : "CALL_INTERVIEW_TEXT_CHANGED"
      );
    }

    sourceRow =
      Number(matches[0].sourceRow || 0);

    rowValues =
      PCO_FAST_scheduleRow_(
        scheduleContext,
        sourceRow
      );

    if(!rowValues){
      throw new Error(
        "CALL_SOURCE_ROW_INVALID"
      );
    }

    currentInterview =
      String(rowValues[0] || "").trim();

    currentHandler =
      String(rowValues[1] || "")
        .replace(/\s+/g," ")
        .trim();

  }

  const outcome =
    PCO_normalizeOutcome_(
      request.outcome
    );

  const currentKey =
    PC_handlerKey_(currentHandler);

  const originalKey =
    PC_handlerKey_(request.handler);

  // v11.3 — alias-safe approval. When an old pending request says
  // "Vamshidhar" but the live tracker says "Vamshidhar Reddy",
  // preserve the current canonical display name instead of treating it
  // as a reassignment or writing the old alias back to Team Data.
  const currentMatchesOriginal =
    currentKey && originalKey && currentKey === originalKey;

  const effectiveOriginalHandler =
    currentMatchesOriginal && currentHandler
      ? currentHandler
      : request.handler;

  let finalTeamValue = "";

  if(outcome === "Completed"){
    finalTeamValue = effectiveOriginalHandler;
  }else if(outcome === "Rescheduled"){
    finalTeamValue = "Rescheduled";
  }else if(outcome === "Cancelled"){
    finalTeamValue = "Cancelled";
  }else{
    throw new Error(
      "INVALID_CALL_OUTCOME"
    );
  }

  const finalKey =
    PC_handlerKey_(finalTeamValue);

  if(
    currentKey !== originalKey &&
    currentKey !== finalKey
  ){
    throw new Error(
      "CALL_ASSIGNMENT_CHANGED_CURRENT_" +
      currentHandler
    );
  }

  const parsed =
    PC_parseInterviewText_(
      currentInterview
    );

  const call = {
    callId: request.callId,
    sourceRow: sourceRow,
    date: request.workingDate,
    dateKey: request.dateKey,
    candidate:
      parsed.candidate ||
      request.candidate,
    client:
      parsed.client ||
      request.client,
    duration:
      parsed.duration ||
      request.duration ||
      "",
    round: parsed.round || "",
    time: parsed.time || "",
    nightCall:
      PC_isNightTime_(
        parsed.time || ""
      ),
    handler: effectiveOriginalHandler,
    originalText: currentInterview
  };

  //--------------------------------------------------
  // Team Data validation/allocation is done in memory
  // before ANY sheet write for this request.
  //--------------------------------------------------

  const teamRow =
    PCO_FAST_assignTeamRowInMemory_(
      teamContext,
      call,
      effectiveOriginalHandler,
      finalTeamValue,
      outcome,
      adminUser
    );

  //--------------------------------------------------
  // Plan Call Tracker F only after all validation
  // above succeeds.
  //--------------------------------------------------

  if(currentKey !== finalKey){

    scheduleContext.values[
      sourceRow - 1
    ][1] = finalTeamValue;

    scheduleContext.markedRows[
      sourceRow
    ] = true;

  }

  //--------------------------------------------------
  // Plan final status row in memory.
  //--------------------------------------------------

  PCO_FAST_upsertStatusInMemory_(
    statusContext,
    call,
    effectiveOriginalHandler,
    outcome,
    adminUser
  );

  return {
    call: call,
    teamRow: teamRow,
    finalTeamValue: finalTeamValue
  };

}


function PCO_FAST_scheduleRow_(
  context,
  sourceRow
){

  const row =
    Number(sourceRow || 0);

  if(
    row < 1 ||
    row > context.lastRow ||
    !context.values[row - 1]
  ){
    return null;
  }

  return context.values[row - 1];

}


function PCO_FAST_upsertStatusInMemory_(
  context,
  call,
  originalHandler,
  status,
  user
){

  const fallbackKey =
    String(call.dateKey || "") +
    "|" +
    PC_normalizeText_(
      call.originalText
    );

  let index =
    context.byId[
      call.callId
    ];

  if(index === undefined){
    index =
      context.byFallback[
        fallbackKey
      ];
  }

  const row = [
    call.callId,
    call.date,
    call.dateKey,
    call.sourceRow,
    call.originalText,
    originalHandler,
    status,
    new Date(),
    user.email,
    user.role
  ];

  if(index === undefined){

    context.values.push(row);
    index = context.values.length - 1;

  }else{

    context.values[index] = row;

  }

  context.byId[
    call.callId
  ] = index;

  context.byFallback[
    fallbackKey
  ] = index;

  context.markedRows[
    index + 1
  ] = true;

}


function PCO_FAST_assignTeamRowInMemory_(
  context,
  call,
  originalHandler,
  finalTeamValue,
  outcome,
  adminUser
){

  const existing =
    context.mapByCall[
      call.callId
    ] || null;

  //--------------------------------------------------
  // Existing mapped row remains the fastest/safest
  // route, exactly like PCO_syncToTeamData_().
  //--------------------------------------------------

  if(
    existing &&
    existing.teamRow > 0 &&
    existing.teamRow <=
      context.teamValues.length
  ){

    const teamRow =
      existing.teamRow;

    const current =
      context.teamValues[
        teamRow - 1
      ] || ["","","","",""];

    if(
      PCO_normalize_(
        current[1]
      ) ===
      PCO_normalize_(
        call.originalText
      )
    ){

      const next =
        PCO_FAST_padRow_(
          current,
          5
        );

      next[1] =
        call.originalText;

      next[2] =
        finalTeamValue;

      if(
        !String(next[3] || "").trim()
      ){
        next[3] =
          "In Progress";
      }

      context.teamValues[
        teamRow - 1
      ] = next;

      context.teamMarkedRows[
        teamRow
      ] = true;

      PCO_FAST_upsertMapInMemory_(
        context,
        call,
        teamRow,
        originalHandler,
        finalTeamValue,
        outcome,
        adminUser
      );

      return teamRow;
    }

  }

  //--------------------------------------------------
  // Open-day model is loaded ONCE for the whole job.
  //--------------------------------------------------

  PCO_FAST_ensureOpenDayContext_(
    context
  );

  const layout =
    context.layout;

  if(!layout.dateKey){
    throw new Error(
      "TEAM_DATA_OPEN_DAY_NOT_FOUND"
    );
  }

  if(
    PCO_normalizeDateKey_(
      call.dateKey
    ) !==
    layout.dateKey
  ){
    throw new Error(
      "TEAM_DATA_OPEN_DAY_MISMATCH|call=" +
      PCO_normalizeDateKey_(call.dateKey) +
      "|open=" +
      layout.dateKey
    );
  }

  if(layout.needsCompaction){
    throw new Error(
      "TEAM_DATA_NEEDS_COMPACTION"
    );
  }

  if(
    layout.unexpectedRows &&
    layout.unexpectedRows.length
  ){
    throw new Error(
      "TEAM_DATA_UNEXPECTED_ROWS|" +
      layout.unexpectedRows.join(",")
    );
  }

  const key =
    PCO_normalize_(
      call.originalText
    );

  let teamRow =
    context.recordMap[key] || 0;

  if(!teamRow){

    teamRow =
      context.nextWriteRow;

    context.nextWriteRow++;

    while(
      context.teamValues.length <
      teamRow
    ){
      context.teamValues.push(
        ["","","","",""]
      );
    }

    context.teamValues[
      teamRow - 1
    ] = [
      "",
      call.originalText,
      finalTeamValue,
      "In Progress",
      ""
    ];

    context.recordMap[key] =
      teamRow;

    context.newTeamRows.push(
      teamRow
    );

  }else{

    const current =
      PCO_FAST_padRow_(
        context.teamValues[
          teamRow - 1
        ] || [],
        5
      );

    current[2] =
      finalTeamValue;

    if(
      !String(current[3] || "").trim()
    ){
      current[3] =
        "In Progress";
    }

    context.teamValues[
      teamRow - 1
    ] = current;

  }

  context.teamMarkedRows[
    teamRow
  ] = true;

  PCO_FAST_upsertMapInMemory_(
    context,
    call,
    teamRow,
    originalHandler,
    finalTeamValue,
    outcome,
    adminUser
  );

  return teamRow;

}


function PCO_FAST_ensureOpenDayContext_(
  context
){

  if(context.layoutLoaded){
    return;
  }

  if(
    typeof PTD_getOpenDayLayout_ !==
    "function"
  ){
    throw new Error(
      "PORTAL_TEAM_DAY_CONTROL_NOT_INSTALLED"
    );
  }

  const layout =
    PTD_getOpenDayLayout_(
      context.teamSheet
    );

  const recordMap = {};
  const recordRows =
    layout.recordRows || [];

  recordRows.forEach(
    function(row){

      const index =
        Number(row) - 1;

      const source =
        context.teamValues[index] || [];

      const text =
        String(source[1] || "").trim();

      if(text){

        const key =
          PCO_normalize_(text);

        if(!recordMap[key]){
          recordMap[key] =
            Number(row);
        }

      }

    }
  );

  context.layoutLoaded = true;
  context.layout = layout;
  context.recordMap = recordMap;
  context.nextWriteRow =
    Number(layout.nextWriteRow || 0);

  if(
    layout.dateKey &&
    context.nextWriteRow < 1
  ){
    throw new Error(
      "TEAM_DATA_NEXT_WRITE_ROW_INVALID"
    );
  }

}


function PCO_FAST_upsertMapInMemory_(
  context,
  call,
  teamRow,
  originalHandler,
  finalTeamValue,
  outcome,
  adminUser
){

  const row = [
    call.callId,
    call.dateKey,
    call.date,
    call.sourceRow,
    teamRow,
    call.originalText,
    originalHandler,
    finalTeamValue,
    outcome,
    new Date(),
    adminUser.email
  ];

  const existing =
    context.mapByCall[
      call.callId
    ] || null;

  let index;

  if(existing){

    index =
      existing.arrayIndex;

    context.mapValues[index] =
      row;

  }else{

    context.mapValues.push(row);

    index =
      context.mapValues.length - 1;

  }

  context.mapByCall[
    call.callId
  ] = {
    arrayIndex: index,
    rowNumber: index + 1,
    teamRow: teamRow
  };

  context.mapMarkedRows[
    index + 1
  ] = true;

}


function PCO_FAST_markOutcomeApprovedInMemory_(
  context,
  request,
  adminUser
){

  const rowNumber =
    Number(request.rowNumber || 0);

  if(
    rowNumber < 2 ||
    !context.values[
      rowNumber - 1
    ]
  ){
    throw new Error(
      "OUTCOME_REQUEST_ROW_NOT_FOUND"
    );
  }

  const row =
    context.values[
      rowNumber - 1
    ];

  row[
    context.cols[
      "Request Status"
    ]
  ] = "Approved";

  row[
    context.cols[
      "Reviewed At"
    ]
  ] = new Date();

  row[
    context.cols[
      "Reviewed By Email"
    ]
  ] = adminUser.email;

  row[
    context.cols[
      "Review Note"
    ]
  ] = "Approved in fast bulk operation";

  context.markedRows[
    rowNumber
  ] = true;

}


function PCO_FAST_writeSchedule_(
  context
){

  const rows =
    PCO_FAST_markedRowNumbers_(
      context.markedRows
    );

  if(!rows.length){
    return;
  }

  const groups =
    PCO_FAST_groupRows_(rows);

  groups.forEach(
    function(group){

      const output = [];

      for(
        let row = group.startRow;
        row <= group.endRow;
        row++
      ){
        output.push([
          context.values[
            row - 1
          ][1]
        ]);
      }

      context.sheet
        .getRange(
          group.startRow,
          6,
          output.length,
          1
        )
        .setValues(output);

    }
  );

}


function PCO_FAST_writeStatus_(
  context
){

  PCO_FAST_writeMarkedMatrixRows_(
    context.sheet,
    context.values,
    context.markedRows,
    1,
    10
  );

}


function PCO_FAST_writeTeam_(
  context
){

  const rows =
    PCO_FAST_markedRowNumbers_(
      context.teamMarkedRows
    );

  if(!rows.length){
    return;
  }

  const maxRow =
    rows[rows.length - 1];

  PCO_FAST_ensureSheetRows_(
    context.teamSheet,
    maxRow
  );

  PCO_FAST_writeMarkedMatrixRows_(
    context.teamSheet,
    context.teamValues,
    context.teamMarkedRows,
    1,
    5
  );

  if(context.newTeamRows.length){

    const sorted =
      context.newTeamRows
        .slice()
        .sort(function(a,b){
          return a - b;
        });

    const minRow = sorted[0];
    const maxNew =
      sorted[sorted.length - 1];

    const rule =
      SpreadsheetApp
        .newDataValidation()
        .requireValueInList(
          [
            "In Progress",
            "Selected"
          ],
          true
        )
        .setAllowInvalid(false)
        .build();

    context.teamSheet
      .getRange(
        minRow,
        4,
        maxNew - minRow + 1,
        1
      )
      .setDataValidation(rule);

  }

}


function PCO_FAST_writeSyncMap_(
  context
){

  PCO_FAST_writeMarkedMatrixRows_(
    context.mapSheet,
    context.mapValues,
    context.mapMarkedRows,
    1,
    11
  );

}


function PCO_FAST_writeRequestUpdates_(
  context
){

  PCO_FAST_writeMarkedMatrixRows_(
    context.sheet,
    context.values,
    context.markedRows,
    1,
    context.values[0].length
  );

}


function PCO_FAST_writeMarkedMatrixRows_(
  sheet,
  values,
  markedRows,
  startCol,
  width
){

  const rows =
    PCO_FAST_markedRowNumbers_(
      markedRows
    );

  if(!rows.length){
    return;
  }

  const maxRow =
    rows[rows.length - 1];

  PCO_FAST_ensureSheetRows_(
    sheet,
    maxRow
  );

  const groups =
    PCO_FAST_groupRows_(rows);

  groups.forEach(
    function(group){

      const output = [];

      for(
        let row = group.startRow;
        row <= group.endRow;
        row++
      ){

        output.push(
          PCO_FAST_padRow_(
            values[row - 1] || [],
            width
          ).slice(
            startCol - 1,
            startCol - 1 + width
          )
        );

      }

      sheet
        .getRange(
          group.startRow,
          startCol,
          output.length,
          width
        )
        .setValues(output);

    }
  );

}


function PCO_FAST_markedRowNumbers_(
  markedRows
){

  return Object.keys(
    markedRows || {}
  )
  .map(function(value){
    return Number(value);
  })
  .filter(function(value){
    return value > 0;
  })
  .sort(function(a,b){
    return a - b;
  });

}


function PCO_FAST_groupRows_(
  rows
){

  if(!rows.length){
    return [];
  }

  const groups = [];

  let start = rows[0];
  let end = rows[0];

  for(let i = 1; i < rows.length; i++){

    if(rows[i] === end + 1){
      end = rows[i];
      continue;
    }

    groups.push({
      startRow: start,
      endRow: end
    });

    start = rows[i];
    end = rows[i];

  }

  groups.push({
    startRow: start,
    endRow: end
  });

  return groups;

}


function PCO_FAST_ensureSheetRows_(
  sheet,
  requiredRow
){

  const maxRows =
    sheet.getMaxRows();

  if(requiredRow <= maxRows){
    return;
  }

  sheet.insertRowsAfter(
    maxRows,
    requiredRow - maxRows
  );

}


function PCO_FAST_padRow_(
  row,
  width
){

  const result =
    Array.isArray(row)
      ? row.slice(0,width)
      : [];

  while(result.length < width){
    result.push("");
  }

  return result;

}


function PCO_FAST_auditRow_(
  user,
  action,
  targetType,
  targetId,
  oldValue,
  newValue,
  handler,
  details
){

  return [
    new Date(),
    user.email || "",
    user.role || "",
    action || "",
    targetType || "",
    targetId || "",
    oldValue || "",
    newValue || "",
    handler || "",
    details || ""
  ];

}


function PCO_FAST_appendAuditRows_(
  rows
){

  if(!rows || !rows.length){
    return;
  }

  const sheet =
    PO_getAuditSheet_();

  const startRow =
    sheet.getLastRow() + 1;

  PCO_FAST_ensureSheetRows_(
    sheet,
    startRow + rows.length - 1
  );

  sheet
    .getRange(
      startRow,
      1,
      rows.length,
      10
    )
    .setValues(rows);

}

