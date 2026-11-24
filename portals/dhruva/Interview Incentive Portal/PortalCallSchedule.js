/******************************************************
 * PORTALCALLSCHEDULE.GS
 * Call Tracker Portal Integration - Stage 1
 *
 * Purpose:
 * - Admin sees all calls in the latest Call Tracker date block.
 * - Handler sees ONLY calls assigned to authenticated handler.
 * - Handler/Admin submit Completed / Cancelled / Rescheduled outcomes.
 * - Final outcome approval is handled by PortalCallOperations.gs.
 * - Portal Call Status preserves the real handler even when Column F
 *   later becomes Rescheduled / Cancelled.
 ******************************************************/

const PORTAL_CALL_SCHEDULE = {

  SPREADSHEET_ID:
    "1BD_XIhQW6d4w4dnrcM17wYgv6hZqdx7mTsAIYgUOC7M",

  SCHEDULE_SHEET:
    "InterviewBot 2026",

  STATUS_SHEET:
    "Portal Call Status",

  TIME_ZONE:
    "Asia/Kolkata"

};


function PC_isAdminUser_(user){
  const accessRole = String(
    user && user.accessRole || ""
  ).trim().toUpperCase();
  return (
    accessRole === "SUPER_ADMIN" ||
    accessRole === "ADMIN" ||
    String(user && user.role || "") === "Admin"
  );
}


/******************************************************
 * PUBLIC: LOAD CALL SCHEDULE
 ******************************************************/
function getPortalCallScheduleData(token, requestedDateKey){

  const auth =
    PA_validateSession_(token);

  if(!auth.ok){
    throw new Error("SESSION_EXPIRED");
  }

  const user = auth.user;

  //--------------------------------------------------
  // Handler default-date behavior
  //
  // A Handler must not inherit a stale Admin / previous-team
  // date after Current Role, Team View or Test As changes.
  // When the browser does not explicitly request a date, use
  // the most recent working date on which this Handler actually
  // has an assignment. Admin continues to use the latest global
  // schedule block.
  //--------------------------------------------------
  const requestedKey =
    String(requestedDateKey || "").trim();

  let effectiveDateKey = requestedKey;
  let handlerAutoDateKey = "";

  if(
    !effectiveDateKey &&
    !PC_isAdminUser_(user) &&
    user.handler
  ){
    handlerAutoDateKey =
      PC_latestAssignedDateKeyForHandler_(
        user.handler
      );

    if(handlerAutoDateKey){
      effectiveDateKey =
        handlerAutoDateKey;
    }
  }

  const schedule =
    PC_loadScheduleByDateKey_(
      effectiveDateKey
    );

  const availableDates = schedule.availableDates || [];
  const statusData = PC_loadStatusMap_();

  let allCalls = schedule.calls.map(function(call){

    const statusEntry =
      statusData.byId[call.callId] ||
      statusData.byFallback[
        PC_statusFallbackKey_(call)
      ] ||
      null;

    const sheetHandler =
      String(call.handler || "").trim();

    let finalStatus =
      statusEntry
        ? PC_normalizeStatus_(statusEntry.status)
        : "";

    if(!finalStatus){

      const handlerKey =
        PC_handlerKey_(sheetHandler);

      if(
        handlerKey === "rescheduled"
      ){
        finalStatus = "Rescheduled";
      }else if(
        handlerKey === "cancelled" ||
        handlerKey === "canceled"
      ){
        finalStatus = "Cancelled";
      }else{
        finalStatus = "Scheduled";
      }

    }

    call.sheetHandler =
      sheetHandler;

    call.originalHandler =
      statusEntry &&
      statusEntry.handler
        ? statusEntry.handler
        : (
            PC_isFinalOutcomeLabel_(
              sheetHandler
            )
              ? ""
              : sheetHandler
          );

    //------------------------------------------------
    // After Admin approval Column F can become
    // Rescheduled / Cancelled. Keep the real handler
    // visible in the portal from Portal Call Status.
    //------------------------------------------------
    if(
      PC_isFinalOutcomeLabel_(
        sheetHandler
      ) &&
      call.originalHandler
    ){
      call.handler =
        call.originalHandler;
    }

    call.status =
      finalStatus;

    call.statusUpdatedAt =
      statusEntry
        ? statusEntry.updatedAt
        : "";

    call.statusUpdatedBy =
      statusEntry
        ? statusEntry.updatedBy
        : "";

    return call;

  });

  if(
    typeof PCO_enrichCalls_ ===
    "function"
  ){
    allCalls =
      PCO_enrichCalls_(
        user,
        allCalls
      );
  }

  let visibleCalls = allCalls;

  if(!PC_isAdminUser_(user)){

    visibleCalls = allCalls.filter(function(call){
      return PC_handlerKey_(call.handler) ===
        PC_handlerKey_(user.handler);
    });

  }

  return {

    ok: true,

    user: {
      email: user.email,
      handler: user.handler,
      role: user.role
    },

    workingDate: schedule.dateLabel,
    workingDateKey: schedule.dateKey,
    availableDates: availableDates,

    autoSelectedMostRecentHandlerDate:
      Boolean(
        !requestedKey &&
        handlerAutoDateKey
      ),

    summary:
      PC_buildScheduleSummary_(visibleCalls),

    handlerSummary:
      PC_isAdminUser_(user)
        ? PC_buildHandlerSummary_(allCalls)
        : [],

    transferHandlers:
      (
        user.role === "Handler" &&
        typeof PCO_getTransferHandlers_ === "function"
      )
        ? PCO_getTransferHandlers_(
            user.handler
          )
        : [],

    calls:
      visibleCalls

  };

}


/******************************************************
 * PUBLIC: UPDATE CALL STATUS
 *
 * Handler:
 * - Can update only own assigned call.
 * - Allowed: Cancelled / Rescheduled.
 *
 * Admin:
 * - Can update any assigned call.
 * - Allowed: Scheduled / Cancelled / Rescheduled.
 ******************************************************/
function updatePortalCallStatus(
  token,
  callId,
  newStatus
){

  const auth =
    PA_validateSession_(token);

  if(!auth.ok){
    throw new Error(
      "SESSION_EXPIRED"
    );
  }

  //--------------------------------------------------
  // Direct status mutation is intentionally disabled.
  // Completed / Rescheduled / Cancelled must use
  // PortalCallOperations.gs so Handler actions require
  // Admin approval before Call Tracker / Team Data change.
  //--------------------------------------------------

  throw new Error(
    "CALL_STATUS_USE_APPROVAL_WORKFLOW"
  );
}


/******************************************************
 * PRIVATE: OPEN CALL TRACKER
 ******************************************************/
function PC_workbook_(){
  if(typeof PTR_callTracker_ === "function"){
    return PTR_callTracker_();
  }
  return SpreadsheetApp.openById(
    PORTAL_CALL_SCHEDULE.SPREADSHEET_ID
  );
}


function PC_scheduleSheet_(){

  const sheetName =
    typeof PTR_callScheduleSheetName_ === "function"
      ? PTR_callScheduleSheetName_()
      : PORTAL_CALL_SCHEDULE.SCHEDULE_SHEET;

  const sheet =
    PC_workbook_()
      .getSheetByName(
        sheetName
      );

  if(!sheet){
    throw new Error("CALL_SCHEDULE_SHEET_NOT_FOUND");
  }

  return sheet;

}


/******************************************************
 * PRIVATE: READ CALL SCHEDULE BY DATE
 *
 * Call Tracker structure:
 * B = master interview text / date header
 * D = lookup input
 * E = extracted interview
 * F = assigned handler
 *
 * requestedDateKey:
 * - blank => latest available date block
 * - YYYY-MM-DD => exact date block
 ******************************************************/
function PC_loadScheduleByDateKey_(requestedDateKey){

  const sheet = PC_scheduleSheet_();
  const lastRow = sheet.getLastRow();

  if(lastRow < 1){
    throw new Error("CALL_SCHEDULE_EMPTY");
  }

  const values =
    sheet
      .getRange(
        1,
        2,
        lastRow,
        5
      )
      .getDisplayValues();

  const blocks = [];

  for(let i = 0; i < values.length; i++){

    const text =
      String(values[i][0] || "").trim();

    if(!PC_isDateHeader_(text)){
      continue;
    }

    const key =
      PC_dateKeyFromHeader_(text);

    if(!key){
      continue;
    }

    blocks.push({
      startIndex: i,
      dateLabel: text,
      dateKey: key
    });

  }

  if(!blocks.length){
    throw new Error("CALL_SCHEDULE_DATE_BLOCK_NOT_FOUND");
  }

  // Newest first for portal dropdown.
  const availableDates =
    blocks
      .slice()
      .reverse()
      .map(function(block){
        return {
          dateKey: block.dateKey,
          dateLabel: block.dateLabel
        };
      });

  const requested =
    String(requestedDateKey || "").trim();

  let selected = null;

  if(requested){

    selected =
      blocks.find(function(block){
        return block.dateKey === requested;
      }) || null;

    if(!selected){
      throw new Error("CALL_SCHEDULE_DATE_NOT_FOUND");
    }

  }else{

    selected =
      blocks[blocks.length - 1];

  }

  const selectedPosition =
    blocks.indexOf(selected);

  const endIndex =
    selectedPosition < blocks.length - 1
      ? blocks[selectedPosition + 1].startIndex
      : values.length;

  const duplicateCounts = {};
  const calls = [];

  for(
    let i = selected.startIndex + 1;
    i < endIndex;
    i++
  ){

    const lookup =
      String(values[i][2] || "").trim();

    const extracted =
      String(values[i][3] || "").trim();

    const handler =
      String(values[i][4] || "")
        .replace(/\s+/g," ")
        .trim();

    // Portal schedule is based on scheduler's extracted list.
    if(!extracted){
      continue;
    }

    const normalizedText =
      PC_normalizeText_(extracted);

    const hash =
      PC_hash_(normalizedText);

    duplicateCounts[hash] =
      (duplicateCounts[hash] || 0) + 1;

    const occurrence =
      duplicateCounts[hash];

    const callId =
      "CALL-" + selected.dateKey + "-" +
      hash.substring(0,12) + "-" +
      occurrence;

    const parsed =
      PC_parseInterviewText_(extracted);

    calls.push({
      callId: callId,
      sourceRow: i + 1,
      date: selected.dateLabel,
      dateKey: selected.dateKey,
      candidate: parsed.candidate,
      candidateSource: parsed.candidateSource || parsed.candidate || "",
      countryTag: parsed.countryTag || "",
      client: parsed.client,
      clientSource: parsed.clientSource || parsed.client || "",
      role: parsed.role || "",
      duration: parsed.duration,
      round: parsed.round,
      roundNo: Number(parsed.roundNo || 0),
      time: parsed.time,
      candidateIdentity: parsed.candidateIdentity || null,
      clientIdentity: parsed.clientIdentity || null,
      identityResolved: parsed.identityResolved === true,
      nightCall: PC_isNightTime_(parsed.time),
      handler: handler,
      lookupText: lookup,
      originalText: extracted,
      status: "Scheduled",
      statusUpdatedAt: "",
      statusUpdatedBy: ""
    });

  }

  return {
    dateLabel: selected.dateLabel,
    dateKey: selected.dateKey,
    calls: calls,
    availableDates: availableDates
  };

}




/******************************************************
 * PRIVATE: MOST RECENT DATE WITH A HANDLER ASSIGNMENT
 *
 * Uses the same call-fact resolver as the dashboard so
 * approved outcomes/reassignments are respected.
 ******************************************************/
function PC_latestAssignedDateKeyForHandler_(handler){

  const handlerKey =
    PC_handlerKey_(handler);

  if(!handlerKey){
    return "";
  }

  try{

    if(
      typeof PCO_loadCallDashboardFacts_ ===
      "function"
    ){

      const loaded =
        PCO_loadCallDashboardFacts_("");

      const dates = {};

      (loaded.facts || []).forEach(
        function(item){

          const initialKey =
            PC_handlerKey_(
              item.initialHandler
            );

          const finalKey =
            PC_handlerKey_(
              item.finalHandler
            );

          if(
            initialKey === handlerKey ||
            finalKey === handlerKey
          ){
            const key =
              String(
                item.dateKey || ""
              ).trim();

            if(key){
              dates[key] = true;
            }
          }

        }
      );

      const keys =
        Object.keys(dates)
          .sort()
          .reverse();

      return keys.length
        ? keys[0]
        : "";

    }

  }catch(error){
    Logger.log(
      "Handler schedule date fallback unavailable: " +
      error.message
    );
  }

  return "";
}

/******************************************************
 * PRIVATE: READ LATEST DATE BLOCK
 * Kept as a compatibility wrapper.
 ******************************************************/
function PC_loadLatestSchedule_(){
  return PC_loadScheduleByDateKey_("");
}


function PC_isDateHeader_(value){

  return /^\d{1,2}[\/-]\d{1,2}[\/-]\d{4}/
    .test(String(value || "").trim());

}


function PC_dateKeyFromCallId_(callId){

  const match =
    String(callId || "")
      .match(/^CALL-(\d{4}-\d{2}-\d{2})-/);

  return match ? match[1] : "";

}


/******************************************************
 * PRIVATE: STATUS SHEET
 ******************************************************/
function PC_getStatusSheet_(){

  const ss = PC_workbook_();
  let sheet =
    ss.getSheetByName(
      PORTAL_CALL_SCHEDULE.STATUS_SHEET
    );

  const headers = [[
    "Call ID",
    "Working Date",
    "Date Key",
    "Source Row",
    "Interview Text",
    "Assigned Handler",
    "Call Status",
    "Updated At",
    "Updated By",
    "Actor Role"
  ]];

  if(!sheet){

    sheet =
      ss.insertSheet(
        PORTAL_CALL_SCHEDULE.STATUS_SHEET
      );

    sheet
      .getRange(1,1,1,headers[0].length)
      .setValues(headers)
      .setFontWeight("bold");

    sheet.setFrozenRows(1);

    try{
      if(
        typeof PTR_currentTeamCode_ === "function" &&
        PTR_currentTeamCode_() !== "PRADEEP"
      ){
        sheet.hideSheet();
      }
    }catch(error){
      // Visibility is cosmetic; never block status persistence.
    }

    return sheet;

  }

  if(sheet.getLastRow() === 0){
    sheet
      .getRange(1,1,1,headers[0].length)
      .setValues(headers)
      .setFontWeight("bold");
    sheet.setFrozenRows(1);
  }

  try{
    if(
      typeof PTR_currentTeamCode_ === "function" &&
      PTR_currentTeamCode_() !== "PRADEEP"
    ){
      sheet.hideSheet();
    }
  }catch(error){
    // Visibility is cosmetic; never block status persistence.
  }

  return sheet;

}


function PC_loadStatusMap_(){

  const sheet =
    PC_getStatusSheet_();

  const result = {
    byId: {},
    byFallback: {}
  };

  const lastRow =
    sheet.getLastRow();

  if(lastRow <= 1){
    return result;
  }

  const rows =
    sheet
      .getRange(
        2,
        1,
        lastRow - 1,
        10
      )
      .getValues();

  rows.forEach(function(row){

    const callId = String(row[0] || "").trim();
    const dateKey = String(row[2] || "").trim();
    const sourceRow = Number(row[3] || 0);
    const text = String(row[4] || "").trim();
    const handler = String(row[5] || "").trim();
    const status = PC_normalizeStatus_(row[6]);

    const entry = {
      callId: callId,
      dateKey: dateKey,
      sourceRow: sourceRow,
      originalText: text,
      handler: handler,
      status: status,
      updatedAt: PC_dateTimeLabel_(row[7]),
      updatedBy: String(row[8] || "").trim()
    };

    if(callId){
      result.byId[callId] = entry;
    }

    if(dateKey && text){
      result.byFallback[
        dateKey + "|" + PC_normalizeText_(text)
      ] = entry;
    }

  });

  return result;

}


function PC_findStatusRow_(sheet,target){

  const lastRow =
    sheet.getLastRow();

  if(lastRow <= 1){
    return null;
  }

  const rows =
    sheet
      .getRange(
        2,
        1,
        lastRow - 1,
        10
      )
      .getValues();

  const fallbackKey =
    PC_statusFallbackKey_(target);

  for(let i = 0; i < rows.length; i++){

    const id =
      String(rows[i][0] || "").trim();

    const rowFallback =
      String(rows[i][2] || "").trim() +
      "|" +
      PC_normalizeText_(rows[i][4]);

    if(
      id === target.callId ||
      rowFallback === fallbackKey
    ){

      return {
        rowNumber: i + 2,
        status: rows[i][6]
      };

    }

  }

  return null;

}


function PC_statusFallbackKey_(call){
  return String(call.dateKey || "") +
    "|" +
    PC_normalizeText_(call.originalText);
}


/******************************************************
 * PRIVATE: SUMMARY
 ******************************************************/
function PC_buildScheduleSummary_(calls){

  const summary = {
    total: 0,
    assigned: 0,
    unassigned: 0,
    support: 0,
    scheduled: 0,
    pending: 0,
    completed: 0,
    cancelled: 0,
    rescheduled: 0,
    nightCalls: 0
  };

  calls.forEach(function(call){

    summary.total++;

    if(call.handler){
      summary.assigned++;
    }else{
      summary.unassigned++;
    }

    if(PC_handlerKey_(call.handler) === "support"){
      summary.support++;
    }

    if(call.nightCall){
      summary.nightCalls++;
    }

    const status =
      PC_normalizeStatus_(call.status);

    if(status === "Completed"){
      summary.completed++;
    }else if(status === "Cancelled"){
      summary.cancelled++;
    }else if(status === "Rescheduled"){
      summary.rescheduled++;
    }else{
      summary.scheduled++;

      if(
        call.pendingOutcome ||
        call.pendingReassignment
      ){
        summary.pending++;
      }
    }

  });

  return summary;

}


function PC_buildHandlerSummary_(calls){

  const map = {};

  calls.forEach(function(call){

    const handler =
      String(call.handler || "").trim();

    if(!handler){
      return;
    }

    const key =
      PC_handlerKey_(handler);

    if(!map[key]){
      map[key] = {
        handler: handler,
        assigned: 0,
        scheduled: 0,
        completed: 0,
        cancelled: 0,
        rescheduled: 0,
        nightCalls: 0
      };
    }

    const item = map[key];
    item.assigned++;

    if(call.nightCall){
      item.nightCalls++;
    }

    const status =
      PC_normalizeStatus_(call.status);

    if(status === "Completed"){
      item.completed++;
    }else if(status === "Cancelled"){
      item.cancelled++;
    }else if(status === "Rescheduled"){
      item.rescheduled++;
    }else{
      item.scheduled++;
    }

  });

  return Object.keys(map)
    .map(function(key){ return map[key]; })
    .sort(function(a,b){
      return a.handler.localeCompare(b.handler);
    });

}


/******************************************************
 * PRIVATE: INTERVIEW DISPLAY PARSER
 ******************************************************/
function PC_parseInterviewText_(text){

  // Central Candidate/Client identity parser. It separates Role from
  // Client, strips country/tag text from candidate identity, and
  // resolves only exact master/approved-alias matches. Fuzzy matches
  // remain handler-confirmed suggestions in PortalIdentityMapping.gs.
  if(typeof PIM_parseInterviewTextForPortal_ === "function"){
    return PIM_parseInterviewTextForPortal_(text);
  }

  const original =
    String(text || "")
      .replace(/\u00A0/g," ")
      .trim();

  if(!original){
    return {
      candidate: "",
      client: "",
      duration: "",
      round: "",
      time: ""
    };
  }


  //--------------------------------------------------
  // NORMALIZATION
  //
  // Supports:
  // - en/em dashes
  // - double/triple hyphens
  // - mixed spacing
  // - commas as separators
  // - AM / am / Am / aM
  // - 6:30PM / 6.30 pm
  //--------------------------------------------------

  let normalized =
    original
      .replace(/[–—−]/g," - ")
      .replace(/-{2,}/g," - ")
      .replace(/\s*-\s*/g," - ")
      .replace(/\s*,\s*/g,", ")
      .replace(/\s+/g," ")
      .trim();


  //--------------------------------------------------
  // ROUND
  //--------------------------------------------------

  let round = "";

  if(
    /\bfinal(?:\s+round)?\b/i.test(
      normalized
    )
  ){
    round = "Final";
  }else{

    const rm =
      normalized.match(
        /\b(\d+)\s*(st|nd|rd|th)\s*(?:round|rnd)\b/i
      );

    if(rm){
      round =
        rm[1] +
        String(rm[2]).toLowerCase() +
        " Round";
    }
  }


  //--------------------------------------------------
  // TIME
  //--------------------------------------------------

  let time = "";

  const tm =
    normalized.match(
      /\b(\d{1,2})\s*[:.]\s*(\d{2})\s*([ap])\.?\s*m\.?\b/i
    );

  if(tm){

    let hour =
      Number(tm[1]);

    const minute =
      ("0" + Number(tm[2])).slice(-2);

    const meridiem =
      String(tm[3]).toUpperCase() + "M";

    if(hour >= 1 && hour <= 12){
      time =
        hour +
        ":" +
        minute +
        " " +
        meridiem;
    }
  }


  //--------------------------------------------------
  // DURATION
  //
  // Handles:
  // Duration: 30 Mins
  // Duration - 30 mins
  // Duration 30min
  // 30 Minutes
  // 1 Hr
  // 1 Hour 30 Mins
  //--------------------------------------------------

  let duration = "";

  const comboDuration =
    normalized.match(
      /\b(\d+)\s*(?:hours?|hrs?|hr)\s*(?:and\s*)?(\d+)\s*(?:minutes?|mins?|min)\b/i
    );

  if(comboDuration){

    const hours =
      Number(comboDuration[1]);

    const mins =
      Number(comboDuration[2]);

    duration =
      hours +
      (hours === 1 ? " Hour " : " Hours ") +
      mins +
      " Mins";

  }else{

    const explicitDuration =
      normalized.match(
        /\bduration\b\s*[:=\-]*\s*(\d+(?:\.\d+)?)\s*(minutes?|mins?|min|hours?|hrs?|hr)\b/i
      );

    const looseDuration =
      explicitDuration ||
      normalized.match(
        /\b(\d+(?:\.\d+)?)\s*(minutes?|mins?|min|hours?|hrs?|hr)\b/i
      );

    if(looseDuration){

      const number =
        Number(looseDuration[1]);

      const unit =
        String(looseDuration[2] || "")
          .toLowerCase();

      if(
        unit.indexOf("hour") === 0 ||
        unit.indexOf("hr") === 0
      ){
        duration =
          number +
          (number === 1
            ? " Hour"
            : " Hours");
      }else{
        duration =
          number +
          " Mins";
      }
    }
  }


  //--------------------------------------------------
  // CANDIDATE
  //
  // Prefer text before a known activity marker.
  // This is safer for names containing hyphens.
  //--------------------------------------------------

  const activityRegex =
    /\b(?:phone\s+interview|coding\s+interview|technical\s+interview|video\s+interview|interview|phone\s+call|recruiter\s+call)\b/i;

  let candidate = "";

  const activityMatch =
    activityRegex.exec(
      normalized
    );

  if(
    activityMatch &&
    activityMatch.index > 0
  ){

    candidate =
      normalized
        .substring(
          0,
          activityMatch.index
        )
        .replace(
          /[\s,\-:|]+$/g,
          ""
        )
        .replace(
          /\([^)]*\)/g,
          " "
        )
        .replace(
          /\s+/g,
          " "
        )
        .trim();

  }else{

    //------------------------------------------------
    // Fallback: first separator.
    //------------------------------------------------

    const firstSeparator =
      normalized.search(
        /\s-\s|,\s/
      );

    candidate =
      (
        firstSeparator > 0
          ? normalized.substring(
              0,
              firstSeparator
            )
          : normalized
      )
      .replace(
        /\([^)]*\)/g,
        " "
      )
      .replace(
        /\s+/g,
        " "
      )
      .trim();
  }


  //--------------------------------------------------
  // CLIENT
  //
  // Instead of depending on one exact "A - B - C"
  // layout, remove components we already understand:
  // candidate, activity, time, timezone, duration,
  // round. Remaining meaningful text becomes client.
  //--------------------------------------------------

  let clientWork =
    normalized;


  if(candidate){

    const candidateIndex =
      clientWork
        .toLowerCase()
        .indexOf(
          candidate.toLowerCase()
        );

    if(candidateIndex === 0){
      clientWork =
        clientWork.substring(
          candidate.length
        );
    }
  }


  clientWork =
    clientWork
      .replace(
        /\b(?:phone\s+interview|coding\s+interview|technical\s+interview|video\s+interview|interview|phone\s+call|recruiter\s+call)\b/ig,
        " "
      )
      .replace(
        /\bfinal(?:\s+round)?\b/ig,
        " "
      )
      .replace(
        /\(?\b\d+\s*(?:st|nd|rd|th)\s*(?:round|rnd)\b\)?/ig,
        " "
      )
      .replace(
        /\b\d{1,2}\s*[:.]\s*\d{2}\s*[ap]\.?\s*m\.?\b/ig,
        " "
      )
      .replace(
        /\b(?:IST|EST|EDT|CST|CDT|MST|MDT|PST|PDT|UTC|GMT)\b/ig,
        " "
      )
      .replace(
        /\bduration\b\s*[:=\-]*/ig,
        " "
      )
      .replace(
        /\b\d+\s*(?:hours?|hrs?|hr)\s*(?:and\s*)?\d+\s*(?:minutes?|mins?|min)\b/ig,
        " "
      )
      .replace(
        /\b\d+(?:\.\d+)?\s*(?:minutes?|mins?|min|hours?|hrs?|hr)\b/ig,
        " "
      )
      .replace(
        /[()]/g,
        " "
      )
      .replace(
        /\s*[,|]\s*/g,
        " - "
      )
      .replace(
        /\s*-\s*/g,
        " - "
      )
      .replace(
        /(?:\s-\s){2,}/g,
        " - "
      )
      .replace(
        /^(?:\s*-\s*)+/,
        ""
      )
      .replace(
        /(?:\s*-\s*)+$/,
        ""
      )
      .replace(
        /\s+/g,
        " "
      )
      .trim();


  //--------------------------------------------------
  // Remove empty separator pieces and obvious generic
  // leftovers. Preserve apostrophes and company names.
  //--------------------------------------------------

  const clientParts =
    clientWork
      .split(
        /\s+-\s+/
      )
      .map(
        function(part){
          return String(part || "")
            .replace(/^[,;:]+|[,;:]+$/g,"")
            .trim();
        }
      )
      .filter(
        function(part){

          if(!part){
            return false;
          }

          return !/^(?:ist|duration)$/i.test(
            part
          );
        }
      );


  const client =
    clientParts.join(
      " - "
    );


  return {
    candidate: candidate,
    client: client,
    duration: duration,
    round: round,
    time: time
  };

}

function PC_isNightTime_(timeText){

  const text =
    String(timeText || "")
      .trim()
      .toUpperCase();

  const match =
    text.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/);

  if(!match || match[3] !== "AM"){
    return false;
  }

  let hour = Number(match[1]);
  const minute = Number(match[2]);

  if(hour === 12){
    hour = 0;
  }

  return (hour * 60 + minute) >= 120;

}


/******************************************************
 * PRIVATE HELPERS
 ******************************************************/
function PC_normalizeStatus_(value){

  const text =
    String(value || "")
      .trim()
      .toLowerCase();

  if(text === "cancelled" || text === "canceled"){
    return "Cancelled";
  }

  if(text === "rescheduled"){
    return "Rescheduled";
  }

  if(text === "completed"){
    return "Completed";
  }

  if(text === "scheduled"){
    return "Scheduled";
  }

  return "";

}


function PC_isFinalOutcomeLabel_(value){

  const key =
    String(value || "")
      .replace(/\s+/g," ")
      .trim()
      .toLowerCase();

  return (
    key === "rescheduled" ||
    key === "cancelled" ||
    key === "canceled"
  );
}


function PC_handlerKey_(value){

  // v11.1 — canonical handler identity support.
  // V2 Handler Master aliases (for example Vamshi / Vamshidhar)
  // resolve to the configured canonical Handler Name before any
  // schedule, approval, visibility, or status comparison.
  if(
    typeof PHI_handlerIdentityKey_ ===
      "function"
  ){
    return PHI_handlerIdentityKey_(
      value
    );
  }

  return String(value || "")
    .replace(/\s+/g," ")
    .trim()
    .toLowerCase();
}


function PC_normalizeText_(value){
  return String(value || "")
    .replace(/[–—]/g,"-")
    .replace(/\s+/g," ")
    .trim()
    .toLowerCase();
}


function PC_hash_(value){

  const bytes =
    Utilities.computeDigest(
      Utilities.DigestAlgorithm.SHA_256,
      String(value || ""),
      Utilities.Charset.UTF_8
    );

  return bytes.map(function(b){
    const v = (b < 0 ? b + 256 : b).toString(16);
    return v.length === 1 ? "0" + v : v;
  }).join("");

}


function PC_dateKeyFromHeader_(header){

  const match =
    String(header || "")
      .match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/);

  if(!match){
    return "";
  }

  // Call Tracker date headers are month/day/year.
  return match[3] + "-" +
    ("0" + match[1]).slice(-2) + "-" +
    ("0" + match[2]).slice(-2);
}


function PC_dateTimeLabel_(value){

  if(!value){
    return "";
  }

  let date = value;

  if(!(date instanceof Date)){
    date = new Date(value);
  }

  if(isNaN(date.getTime())){
    return String(value || "").trim();
  }

  return Utilities.formatDate(
    date,
    PORTAL_CALL_SCHEDULE.TIME_ZONE,
    "dd-MMM-yyyy hh:mm a"
  );

}
