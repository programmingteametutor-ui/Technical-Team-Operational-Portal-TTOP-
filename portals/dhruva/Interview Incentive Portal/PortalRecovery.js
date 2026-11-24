/******************************************************
 * PORTALRECOVERY.GS - FAST PAGE + PRELOADED EVIDENCE v2.0
 * Phase 5 - Recovery / Exceptions / Evidence
 *
 * READ-ONLY PORTAL MODULE
 *
 * PUBLIC CLIENT FUNCTIONS:
 *   getPortalRecoveryData(token, monthKey)
 *   getPortalRecoveryEvidence(token, evidenceId)
 *
 * SECURITY:
 * - Session is validated server-side.
 * - Admin can read all recovery items.
 * - Handler receives only rows assigned/suggested to
 *   the authenticated handler.
 * - No recovery approval/rejection writes are exposed.
 ******************************************************/


/******************************************************
 * OPTIONAL MANUAL CONNECTION TEST
 *
 * Run from Apps Script editor after adding the main
 * workbook ID/URL to PortalConfig.gs.
 *
 * Trailing "_" keeps it private from google.script.run.
 ******************************************************/
function PR_testPortalRecoverySourceConnection_(){

  const backend =
    portalTeamBackend_();

  const operations =
    portalOperations_();

  Logger.log(
    "========== PORTAL RECOVERY SOURCE TEST =========="
  );

  Logger.log(
    "Private Recovery Workbook : " +
    backend.getName() +
    " | " +
    backend.getId()
  );

  [
    PORTAL_CONFIG.RECOVERY_SHEET,
    PORTAL_CONFIG.RECOVERY_EXCEPTIONS_SHEET,
    PORTAL_CONFIG.RECOVERY_EVIDENCE_SHEET,
    PORTAL_CONFIG.RECOVERY_APPLIED_LOG_SHEET
  ]
  .forEach(
    function(name){
      const sheet =
        backend.getSheetByName(name);
      Logger.log(
        "PRIVATE " + name +
        " : " +
        (sheet ? "FOUND | Rows " + sheet.getLastRow() : "MISSING")
      );
    }
  );

  const sharedRaw =
    typeof PTR_sharedRawDataSource_ === "function"
      ? PTR_sharedRawDataSource_()
      : null;

  Logger.log(
    "SHARED ELIGIBILITY RAW : " +
    (
      sharedRaw && sharedRaw.sheet
        ? sharedRaw.spreadsheetName +
          " / " + sharedRaw.sheetName +
          " | Rows " + sharedRaw.sheet.getLastRow()
        : "MISSING"
    )
  );

  const teamSheet =
    operations.getSheetByName(
      PTR_teamDataSheetName_()
    );

  Logger.log(
    "TEAM DATA : " +
    (teamSheet ? "FOUND | Rows " + teamSheet.getLastRow() : "MISSING")
  );

  Logger.log(
    "==============================================="
  );
}

function getPortalRecoveryData(
  token,
  requestedMonth
){

  const auth =
    PA_validateSession_(
      token
    );


  if(!auth.ok){

    throw new Error(
      "SESSION_EXPIRED"
    );

  }


  const user =
    auth.user;


  const ss =
    portalTeamBackend_();


  const appliedIds =
    PR_loadAppliedIds_(
      ss
    );


  let recoveries =
    PR_loadRecoveries_(
      ss,
      appliedIds
    );


  let exceptions =
    PR_loadExceptions_(
      ss
    );


  //--------------------------------------------------
  // SERVER-SIDE ROLE FILTER
  //--------------------------------------------------

  if(
    user.role !==
    "Admin"
  ){

    recoveries =
      recoveries.filter(
        function(item){

          return (
            PR_handlerKey_(
              item.handler
            ) ===
            PR_handlerKey_(
              user.handler
            )
          );

        }
      );


    exceptions =
      exceptions.filter(
        function(item){

          return PR_handlerListContains_(
            item.suggestedHandlers,
            user.handler
          );

        }
      );

  }


  //--------------------------------------------------
  // Visible months
  //--------------------------------------------------

  const monthMap = {};


  recoveries.forEach(
    function(item){

      if(
        item.monthKey
      ){

        monthMap[
          item.monthKey
        ] =
          item.monthLabel;

      }

    }
  );


  exceptions.forEach(
    function(item){

      if(
        item.monthKey
      ){

        monthMap[
          item.monthKey
        ] =
          item.monthLabel;

      }

    }
  );


  let selectedMonth =
    String(
      requestedMonth || ""
    )
    .trim();


  if(
    selectedMonth &&
    !/^\d{4}-\d{2}$/.test(
      selectedMonth
    )
  ){

    selectedMonth =
      "";

  }


  //--------------------------------------------------
  // If no month is supplied, use latest recovery month.
  //
  // If the dashboard supplies a legitimate month with
  // no recovery activity, KEEP it and show zero rows.
  //--------------------------------------------------

  if(!selectedMonth){

    const keys =
      Object.keys(
        monthMap
      )
      .sort()
      .reverse();


    selectedMonth =
      keys.length
        ? keys[0]
        : "";

  }


  const monthRecoveries =
    selectedMonth
      ? recoveries.filter(
          function(item){

            return (
              item.monthKey ===
              selectedMonth
            );

          }
        )
      : recoveries.slice();


  const monthExceptions =
    selectedMonth
      ? exceptions.filter(
          function(item){

            return (
              item.monthKey ===
              selectedMonth
            );

          }
        )
      : exceptions.slice();


  monthRecoveries.sort(
    PR_sortNewest_
  );


  monthExceptions.sort(
    PR_sortNewest_
  );


  //--------------------------------------------------
  // Handler response sanitization
  //--------------------------------------------------

  const safeRecoveries =
    monthRecoveries.map(
      function(item){

        return PR_safeRecovery_(
          item,
          user
        );

      }
    );


  const safeExceptions =
    monthExceptions.map(
      function(item){

        return PR_safeException_(
          item,
          user
        );

      }
    );


  //--------------------------------------------------
  // Summary
  //--------------------------------------------------

  const summary =
    PR_summary_(
      monthRecoveries,
      monthExceptions
    );


  //--------------------------------------------------
  // PRELOAD VISIBLE EVIDENCE IN THIS SAME REQUEST
  //
  // The old portal made a second protected Apps Script
  // request every time an Evidence ID was clicked.
  // That repeated session/access resolution + workbook
  // opens and caused the visible "Loading evidence..."
  // delay.
  //
  // Build only evidence rows already authorized by the
  // server-filtered Recovery / Exception result.
  //--------------------------------------------------

  const visibleEvidenceIds = {};

  safeRecoveries
    .forEach(function(item){
      if(item && item.id){
        visibleEvidenceIds[item.id] = true;
      }
    });

  safeExceptions
    .forEach(function(item){
      if(item && item.id){
        visibleEvidenceIds[item.id] = true;
      }
    });


  const evidenceById =
    PR_buildVisibleEvidenceMap_(
      ss,
      user,
      visibleEvidenceIds
    );


  return {

    ok:
      true,

    evidenceById:
      evidenceById,

    user: {
      email:
        user.email,
      handler:
        user.handler,
      role:
        user.role
    },

    selectedMonth:
      selectedMonth,

    selectedMonthLabel:
      selectedMonth
        ? PR_monthLabelFromKey_(
            selectedMonth
          )
        : "All Recovery Data",

    availableMonths:
      Object.keys(
        monthMap
      )
      .sort()
      .reverse()
      .map(
        function(key){

          return {
            key:
              key,
            label:
              monthMap[key]
          };

        }
      ),

    summary:
      summary,

    recoveries:
      safeRecoveries,

    exceptions:
      safeExceptions

  };

}


/******************************************************
 * PUBLIC: EVIDENCE
 *
 * Authorization is re-checked against the underlying
 * recovery/exception item BEFORE evidence is returned.
 ******************************************************/
function getPortalRecoveryEvidence(
  token,
  evidenceId
){

  const auth =
    PA_validateSession_(
      token
    );


  if(!auth.ok){

    throw new Error(
      "SESSION_EXPIRED"
    );

  }


  const user =
    auth.user;


  const id =
    String(
      evidenceId || ""
    )
    .trim();


  if(!id){

    throw new Error(
      "Evidence ID is required."
    );

  }


  const ss =
    portalTeamBackend_();


  //--------------------------------------------------
  // Verify user is authorized to this specific ID.
  //--------------------------------------------------

  const authorization =
    PR_authorizeEvidenceId_(
      ss,
      id,
      user
    );


  if(!authorization.allowed){

    throw new Error(
      "RECOVERY_ACCESS_DENIED"
    );

  }


  const evidenceSheet =
    ss.getSheetByName(
      PORTAL_CONFIG.RECOVERY_EVIDENCE_SHEET
    );


  if(!evidenceSheet){

    throw new Error(
      "Recovery Evidence sheet was not found."
    );

  }


  const values =
    evidenceSheet
      .getDataRange()
      .getValues();


  if(
    !values ||
    values.length <= 1
  ){

    throw new Error(
      "No recovery evidence is currently available."
    );

  }


  const headers =
    PR_headerMap_(
      values[0]
    );


  const idCol =
    PR_col_(
      headers,
      "Evidence ID"
    );


  if(idCol < 0){

    throw new Error(
      "Recovery Evidence headers are not in the expected format."
    );

  }


  let evidenceRow =
    null;


  for(
    let i = 1;
    i < values.length;
    i++
  ){

    if(
      String(
        values[i][idCol] || ""
      )
      .trim() ===
      id
    ){

      evidenceRow =
        values[i];

      break;

    }

  }


  if(!evidenceRow){

    throw new Error(
      "Evidence record was not found."
    );

  }


  const operations =
    portalOperations_();

  const sharedRaw =
    typeof PTR_sharedRawDataSource_ === "function"
      ? PTR_sharedRawDataSource_()
      : null;

  const rawSheet =
    sharedRaw
      ? sharedRaw.sheet
      : operations.getSheetByName(
          PTR_rawDataSheetName_()
        );

  const teamSheet =
    operations.getSheetByName(
      PTR_teamDataSheetName_()
    );

  const teamBaseUrl =
    operations.getUrl();

  const rawBaseUrl =
    sharedRaw
      ? sharedRaw.spreadsheet.getUrl()
      : teamBaseUrl;


  const previousTeamSource =
    PR_textCell_(
      evidenceRow,
      headers,
      "Previous Team Source"
    );


  const currentRawSource =
    PR_textCell_(
      evidenceRow,
      headers,
      "Current Raw Source"
    );


  const currentTeamSource =
    PR_textCell_(
      evidenceRow,
      headers,
      "Current Team Source"
    );


  const previousTeamUrl =
    PR_buildSourceUrl_(
      teamBaseUrl,
      teamSheet,
      previousTeamSource
    );


  const currentRawUrl =
    PR_buildSourceUrl_(
      rawBaseUrl,
      rawSheet,
      currentRawSource
    );


  const currentTeamUrl =
    PR_buildSourceUrl_(
      teamBaseUrl,
      teamSheet,
      currentTeamSource
    );


  let previousTeamHandler =
    PR_textCell_(
      evidenceRow,
      headers,
      "Previous Team Handler"
    );


  let currentTeamHandler =
    PR_textCell_(
      evidenceRow,
      headers,
      "Current Team Handler"
    );


  //--------------------------------------------------
  // Handler account does not need other handler names
  // exposed by the evidence modal.
  //--------------------------------------------------

  if(
    user.role !==
    "Admin"
  ){

    if(
      PR_handlerKey_(
        previousTeamHandler
      ) !==
      PR_handlerKey_(
        user.handler
      )
    ){

      previousTeamHandler =
        "";

    }


    if(
      PR_handlerKey_(
        currentTeamHandler
      ) !==
      PR_handlerKey_(
        user.handler
      )
    ){

      currentTeamHandler =
        "";

    }

  }


  return {

    ok:
      true,

    id:
      id,

    type:
      PR_textCell_(
        evidenceRow,
        headers,
        "Type"
      ),

    teamCandidate:
      PR_textCell_(
        evidenceRow,
        headers,
        "Team Candidate"
      ),

    rawCandidate:
      PR_textCell_(
        evidenceRow,
        headers,
        "Raw Candidate"
      ),

    teamClient:
      PR_textCell_(
        evidenceRow,
        headers,
        "Team Client"
      ),

    rawClient:
      PR_textCell_(
        evidenceRow,
        headers,
        "Raw Client"
      ),

    previousRound:
      PR_textCell_(
        evidenceRow,
        headers,
        "Previous / Team Round"
      ),

    currentRound:
      PR_textCell_(
        evidenceRow,
        headers,
        "Current / Raw Round"
      ),

    teamDate:
      PR_dateLabel_(
        PR_value_(
          evidenceRow,
          headers,
          "Team Date"
        )
      ),

    promotionDate:
      PR_dateLabel_(
        PR_value_(
          evidenceRow,
          headers,
          "Promotion Date"
        )
      ),

    candidateScore:
      PR_textCell_(
        evidenceRow,
        headers,
        "Candidate %"
      ),

    clientScore:
      PR_textCell_(
        evidenceRow,
        headers,
        "Client %"
      ),

    confidence:
      PR_textCell_(
        evidenceRow,
        headers,
        "Confidence"
      ),

    reason:
      PR_textCell_(
        evidenceRow,
        headers,
        "Issue / Match Reason"
      ),

    reviewStatus:
      PR_textCell_(
        evidenceRow,
        headers,
        "Review Status"
      ),

    previousTeam: {

      originalText:
        PR_textCell_(
          evidenceRow,
          headers,
          "Previous Team Original Text"
        ),

      handler:
        previousTeamHandler,

      status:
        PR_textCell_(
          evidenceRow,
          headers,
          "Previous Team Status"
        ),

      sourceLabel:
        previousTeamSource,

      sourceUrl:
        previousTeamUrl

    },

    currentRaw: {

      originalText:
        PR_textCell_(
          evidenceRow,
          headers,
          "Current Raw Original Text"
        ),

      sourceLabel:
        currentRawSource,

      sourceUrl:
        currentRawUrl

    },

    currentTeam: {

      originalText:
        PR_textCell_(
          evidenceRow,
          headers,
          "Current Team Original Text"
        ),

      handler:
        currentTeamHandler,

      status:
        PR_textCell_(
          evidenceRow,
          headers,
          "Current Team Status"
        ),

      sourceLabel:
        currentTeamSource,

      sourceUrl:
        currentTeamUrl

    }

  };

}



/******************************************************
 * PRIVATE: BUILD EVIDENCE FOR VISIBLE IDS
 *
 * One Evidence sheet read + one shared workbook open.
 * No extra authentication request is needed in browser.
 ******************************************************/
function PR_buildVisibleEvidenceMap_(
  backend,
  user,
  visibleIds
){

  const output = {};

  const ids =
    visibleIds &&
    typeof visibleIds === "object"
      ? visibleIds
      : {};

  if(
    Object.keys(ids).length === 0
  ){
    return output;
  }


  const evidenceSheet =
    backend.getSheetByName(
      PORTAL_CONFIG
        .RECOVERY_EVIDENCE_SHEET
    );

  if(
    !evidenceSheet ||
    evidenceSheet.getLastRow() <= 1
  ){
    return output;
  }


  const values =
    evidenceSheet
      .getDataRange()
      .getValues();

  const headers =
    PR_headerMap_(
      values[0] || []
    );

  const idCol =
    PR_col_(
      headers,
      "Evidence ID"
    );

  if(idCol < 0){
    return output;
  }


  // Raw Data + Team Data live in the shared operations
  // workbook, while Recovery/Evidence live in private.
  const operations =
    portalOperations_();

  const sharedRaw =
    typeof PTR_sharedRawDataSource_ === "function"
      ? PTR_sharedRawDataSource_()
      : null;

  const rawSheet =
    sharedRaw
      ? sharedRaw.sheet
      : operations.getSheetByName(
          PTR_rawDataSheetName_()
        );

  const teamSheet =
    operations.getSheetByName(
      PTR_teamDataSheetName_()
    );

  const teamBaseUrl =
    operations.getUrl();

  const rawBaseUrl =
    sharedRaw
      ? sharedRaw.spreadsheet.getUrl()
      : teamBaseUrl;


  for(
    let i = 1;
    i < values.length;
    i++
  ){

    const row =
      values[i];

    const id =
      String(
        row[idCol] || ""
      ).trim();

    if(
      !id ||
      !ids[id]
    ){
      continue;
    }


    const previousTeamSource =
      PR_textCell_(
        row,
        headers,
        "Previous Team Source"
      );

    const currentRawSource =
      PR_textCell_(
        row,
        headers,
        "Current Raw Source"
      );

    const currentTeamSource =
      PR_textCell_(
        row,
        headers,
        "Current Team Source"
      );


    let previousTeamHandler =
      PR_textCell_(
        row,
        headers,
        "Previous Team Handler"
      );

    let currentTeamHandler =
      PR_textCell_(
        row,
        headers,
        "Current Team Handler"
      );


    if(
      user.role !==
        "Admin"
    ){

      if(
        PR_handlerKey_(
          previousTeamHandler
        ) !==
        PR_handlerKey_(
          user.handler
        )
      ){
        previousTeamHandler = "";
      }

      if(
        PR_handlerKey_(
          currentTeamHandler
        ) !==
        PR_handlerKey_(
          user.handler
        )
      ){
        currentTeamHandler = "";
      }

    }


    output[id] = {

      ok:
        true,

      id:
        id,

      type:
        PR_textCell_(
          row,
          headers,
          "Type"
        ),

      teamCandidate:
        PR_textCell_(
          row,
          headers,
          "Team Candidate"
        ),

      rawCandidate:
        PR_textCell_(
          row,
          headers,
          "Raw Candidate"
        ),

      teamClient:
        PR_textCell_(
          row,
          headers,
          "Team Client"
        ),

      rawClient:
        PR_textCell_(
          row,
          headers,
          "Raw Client"
        ),

      previousRound:
        PR_textCell_(
          row,
          headers,
          "Previous / Team Round"
        ),

      currentRound:
        PR_textCell_(
          row,
          headers,
          "Current / Raw Round"
        ),

      teamDate:
        PR_dateLabel_(
          PR_value_(
            row,
            headers,
            "Team Date"
          )
        ),

      promotionDate:
        PR_dateLabel_(
          PR_value_(
            row,
            headers,
            "Promotion Date"
          )
        ),

      candidateScore:
        PR_textCell_(
          row,
          headers,
          "Candidate %"
        ),

      clientScore:
        PR_textCell_(
          row,
          headers,
          "Client %"
        ),

      confidence:
        PR_textCell_(
          row,
          headers,
          "Confidence"
        ),

      reason:
        PR_textCell_(
          row,
          headers,
          "Issue / Match Reason"
        ),

      reviewStatus:
        PR_textCell_(
          row,
          headers,
          "Review Status"
        ),

      previousTeam: {

        originalText:
          PR_textCell_(
            row,
            headers,
            "Previous Team Original Text"
          ),

        handler:
          previousTeamHandler,

        status:
          PR_textCell_(
            row,
            headers,
            "Previous Team Status"
          ),

        sourceLabel:
          previousTeamSource,

        sourceUrl:
          PR_buildSourceUrl_(
            teamBaseUrl,
            teamSheet,
            previousTeamSource
          )

      },

      currentRaw: {

        originalText:
          PR_textCell_(
            row,
            headers,
            "Current Raw Original Text"
          ),

        sourceLabel:
          currentRawSource,

        sourceUrl:
          PR_buildSourceUrl_(
            rawBaseUrl,
            rawSheet,
            currentRawSource
          )

      },

      currentTeam: {

        originalText:
          PR_textCell_(
            row,
            headers,
            "Current Team Original Text"
          ),

        handler:
          currentTeamHandler,

        status:
          PR_textCell_(
            row,
            headers,
            "Current Team Status"
          ),

        sourceLabel:
          currentTeamSource,

        sourceUrl:
          PR_buildSourceUrl_(
            teamBaseUrl,
            teamSheet,
            currentTeamSource
          )

      }

    };

  }


  return output;

}


/******************************************************
 * PRIVATE: LOAD PROMOTION RECOVERY
 ******************************************************/
function PR_loadRecoveries_(
  ss,
  appliedIds
){

  const sheet =
    ss.getSheetByName(
      PORTAL_CONFIG.RECOVERY_SHEET
    );


  if(
    !sheet ||
    sheet.getLastRow() <= 1
  ){

    return [];

  }


  const values =
    sheet
      .getDataRange()
      .getValues();


  const headers =
    PR_headerMap_(
      values[0]
    );


  const required = [
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


  PR_requireHeaders_(
    headers,
    required,
    "Promotion Recovery"
  );


  const output = [];


  for(
    let i = 1;
    i < values.length;
    i++
  ){

    const row =
      values[i];


    const recoveryId =
      PR_textCell_(
        row,
        headers,
        "Recovery ID"
      );


    if(!recoveryId)
      continue;


    const promotionDate =
      PR_parseDate_(
        PR_value_(
          row,
          headers,
          "Promotion Date"
        )
      );


    output.push({

      id:
        recoveryId,

      candidate:
        PR_textCell_(
          row,
          headers,
          "Candidate"
        ),

      previousRound:
        PR_textCell_(
          row,
          headers,
          "Previous Round"
        ),

      currentRound:
        PR_textCell_(
          row,
          headers,
          "Current Round"
        ),

      teamClient:
        PR_textCell_(
          row,
          headers,
          "Team Client"
        ),

      rawClient:
        PR_textCell_(
          row,
          headers,
          "Raw Client"
        ),

      teamDate:
        PR_parseDate_(
          PR_value_(
            row,
            headers,
            "Team Date"
          )
        ),

      promotionDate:
        promotionDate,

      candidateScore:
        PR_number_(
          PR_value_(
            row,
            headers,
            "Candidate %"
          )
        ),

      clientScore:
        PR_number_(
          PR_value_(
            row,
            headers,
            "Client %"
          )
        ),

      confidence:
        PR_number_(
          PR_value_(
            row,
            headers,
            "Confidence"
          )
        ),

      handler:
        PR_textCell_(
          row,
          headers,
          "Suggested Handler"
        ),

      amount:
        PR_number_(
          PR_value_(
            row,
            headers,
            "Amount"
          )
        ),

      status:
        PR_textCell_(
          row,
          headers,
          "Status"
        ),

      reason:
        PR_textCell_(
          row,
          headers,
          "Match Reason"
        ),

      applied:
        !!appliedIds[
          recoveryId
        ],

      monthKey:
        promotionDate
          ? PR_monthKey_(
              promotionDate
            )
          : "",

      monthLabel:
        promotionDate
          ? PR_monthLabel_(
              promotionDate
            )
          : ""

    });

  }


  return output;

}


/******************************************************
 * PRIVATE: LOAD EXCEPTIONS
 ******************************************************/
function PR_loadExceptions_(
  ss
){

  const sheet =
    ss.getSheetByName(
      PORTAL_CONFIG.RECOVERY_EXCEPTIONS_SHEET
    );


  if(
    !sheet ||
    sheet.getLastRow() <= 1
  ){

    return [];

  }


  const values =
    sheet
      .getDataRange()
      .getValues();


  const headers =
    PR_headerMap_(
      values[0]
    );


  const required = [
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


  PR_requireHeaders_(
    headers,
    required,
    "Recovery Exceptions"
  );


  const output = [];


  for(
    let i = 1;
    i < values.length;
    i++
  ){

    const row =
      values[i];


    const exceptionId =
      PR_textCell_(
        row,
        headers,
        "Exception ID"
      );


    if(!exceptionId)
      continue;


    const promotionDate =
      PR_parseDate_(
        PR_value_(
          row,
          headers,
          "Promotion Date"
        )
      );


    output.push({

      id:
        exceptionId,

      candidate:
        PR_textCell_(
          row,
          headers,
          "Candidate"
        ),

      rawClient:
        PR_textCell_(
          row,
          headers,
          "Raw Client"
        ),

      rawRound:
        PR_textCell_(
          row,
          headers,
          "Raw Round"
        ),

      promotionDate:
        promotionDate,

      teamCandidate:
        PR_textCell_(
          row,
          headers,
          "Possible Team Candidate"
        ),

      teamClient:
        PR_textCell_(
          row,
          headers,
          "Team Client"
        ),

      teamRound:
        PR_textCell_(
          row,
          headers,
          "Team Round"
        ),

      teamDate:
        PR_parseDate_(
          PR_value_(
            row,
            headers,
            "Team Date"
          )
        ),

      suggestedHandlers:
        PR_textCell_(
          row,
          headers,
          "Suggested Handler(s)"
        ),

      candidateScore:
        PR_number_(
          PR_value_(
            row,
            headers,
            "Candidate %"
          )
        ),

      clientScore:
        PR_number_(
          PR_value_(
            row,
            headers,
            "Client %"
          )
        ),

      issueType:
        PR_textCell_(
          row,
          headers,
          "Issue Type"
        ),

      reason:
        PR_textCell_(
          row,
          headers,
          "Reason"
        ),

      status:
        PR_textCell_(
          row,
          headers,
          "Status"
        ),

      monthKey:
        promotionDate
          ? PR_monthKey_(
              promotionDate
            )
          : "",

      monthLabel:
        promotionDate
          ? PR_monthLabel_(
              promotionDate
            )
          : ""

    });

  }


  return output;

}


/******************************************************
 * PRIVATE: APPLIED LOG IDS
 ******************************************************/
function PR_loadAppliedIds_(
  ss
){

  const output = {};


  const sheet =
    ss.getSheetByName(
      PORTAL_CONFIG.RECOVERY_APPLIED_LOG_SHEET
    );


  if(
    !sheet ||
    sheet.getLastRow() <= 1
  ){

    return output;

  }


  const values =
    sheet
      .getDataRange()
      .getValues();


  const headers =
    PR_headerMap_(
      values[0]
    );


  const idCol =
    PR_col_(
      headers,
      "Recovery ID"
    );


  if(idCol < 0)
    return output;


  for(
    let i = 1;
    i < values.length;
    i++
  ){

    const id =
      String(
        values[i][idCol] || ""
      )
      .trim();


    if(id){

      output[id] =
        true;

    }

  }


  return output;

}


/******************************************************
 * PRIVATE: AUTHORIZE EVIDENCE ID
 ******************************************************/
function PR_authorizeEvidenceId_(
  ss,
  id,
  user
){

  const recoveries =
    PR_loadRecoveries_(
      ss,
      PR_loadAppliedIds_(
        ss
      )
    );


  for(
    let i = 0;
    i < recoveries.length;
    i++
  ){

    const item =
      recoveries[i];


    if(item.id !== id)
      continue;


    if(
      user.role ===
      "Admin"
    ){

      return {
        allowed:
          true,
        type:
          "recovery"
      };

    }


    return {

      allowed:
        (
          PR_handlerKey_(
            item.handler
          ) ===
          PR_handlerKey_(
            user.handler
          )
        ),

      type:
        "recovery"

    };

  }


  const exceptions =
    PR_loadExceptions_(
      ss
    );


  for(
    let i = 0;
    i < exceptions.length;
    i++
  ){

    const item =
      exceptions[i];


    if(item.id !== id)
      continue;


    if(
      user.role ===
      "Admin"
    ){

      return {
        allowed:
          true,
        type:
          "exception"
      };

    }


    return {

      allowed:
        PR_handlerListContains_(
          item.suggestedHandlers,
          user.handler
        ),

      type:
        "exception"

    };

  }


  return {
    allowed:
      false
  };

}


/******************************************************
 * PRIVATE: SAFE RECOVERY RESPONSE
 ******************************************************/
function PR_safeRecovery_(
  item,
  user
){

  return {

    id:
      item.id,

    candidate:
      item.candidate,

    previousRound:
      item.previousRound,

    currentRound:
      item.currentRound,

    teamClient:
      item.teamClient,

    rawClient:
      item.rawClient,

    teamDate:
      PR_dateLabel_(
        item.teamDate
      ),

    promotionDate:
      PR_dateLabel_(
        item.promotionDate
      ),

    candidateScore:
      item.candidateScore,

    clientScore:
      item.clientScore,

    confidence:
      item.confidence,

    handler:
      user.role === "Admin"
        ? item.handler
        : user.handler,

    amount:
      item.amount,

    status:
      item.status,

    reason:
      item.reason,

    applied:
      item.applied

  };

}


/******************************************************
 * PRIVATE: SAFE EXCEPTION RESPONSE
 ******************************************************/
function PR_safeException_(
  item,
  user
){

  return {

    id:
      item.id,

    candidate:
      item.candidate,

    rawClient:
      item.rawClient,

    rawRound:
      item.rawRound,

    promotionDate:
      PR_dateLabel_(
        item.promotionDate
      ),

    teamCandidate:
      item.teamCandidate,

    teamClient:
      item.teamClient,

    teamRound:
      item.teamRound,

    teamDate:
      PR_dateLabel_(
        item.teamDate
      ),

    suggestedHandlers:
      user.role === "Admin"
        ? item.suggestedHandlers
        : user.handler,

    candidateScore:
      item.candidateScore,

    clientScore:
      item.clientScore,

    issueType:
      item.issueType,

    reason:
      item.reason,

    status:
      item.status

  };

}


/******************************************************
 * PRIVATE: SUMMARY
 ******************************************************/
function PR_summary_(
  recoveries,
  exceptions
){

  const summary = {

    totalRecoveries:
      recoveries.length,

    pending:
      0,

    approved:
      0,

    rejected:
      0,

    applied:
      0,

    recoveryAmount:
      0,

    pendingAmount:
      0,

    exceptionTotal:
      exceptions.length,

    exceptionReview:
      0,

    exceptionResolved:
      0,

    exceptionIgnored:
      0

  };


  recoveries.forEach(
    function(item){

      const status =
        String(
          item.status || ""
        )
        .trim()
        .toLowerCase();


      if(status === "pending"){

        summary.pending++;

        summary.pendingAmount +=
          Number(
            item.amount || 0
          );

      }


      if(status === "approved")
        summary.approved++;


      if(status === "rejected")
        summary.rejected++;


      if(item.applied)
        summary.applied++;


      summary.recoveryAmount +=
        Number(
          item.amount || 0
        );

    }
  );


  exceptions.forEach(
    function(item){

      const status =
        String(
          item.status || ""
        )
        .trim()
        .toLowerCase();


      if(status === "review")
        summary.exceptionReview++;


      if(status === "resolved")
        summary.exceptionResolved++;


      if(status === "ignore")
        summary.exceptionIgnored++;

    }
  );


  return summary;

}


/******************************************************
 * PRIVATE: SOURCE URL
 ******************************************************/
function PR_buildSourceUrl_(
  baseUrl,
  sheet,
  sourceLabel
){

  if(
    !baseUrl ||
    !sheet ||
    !sourceLabel
  ){

    return "";

  }


  const match =
    String(
      sourceLabel
    )
    .match(
      /row\s+(\d+)/i
    );


  if(!match)
    return "";


  const row =
    Number(
      match[1]
    );


  if(
    !row ||
    row < 1
  ){

    return "";

  }


  return (
    baseUrl +
    "#gid=" +
    sheet.getSheetId() +
    "&range=A" +
    row
  );

}


/******************************************************
 * PRIVATE: HANDLER LIST MATCH
 ******************************************************/
function PR_handlerListContains_(
  value,
  handler
){

  const target =
    PR_handlerKey_(
      handler
    );


  if(!target)
    return false;


  const original =
    String(
      value || ""
    )
    .trim();


  if(!original)
    return false;


  if(
    PR_handlerKey_(
      original
    ) ===
    target
  ){

    return true;

  }


  const parts =
    original
      .split(
        /[,;|\/]+/
      )
      .map(
        function(part){

          return PR_handlerKey_(
            part
          );

        }
      )
      .filter(
        Boolean
      );


  return (
    parts.indexOf(
      target
    ) > -1
  );

}


/******************************************************
 * PRIVATE: HEADER MAP
 ******************************************************/
function PR_headerMap_(
  headerRow
){

  const map = {};


  headerRow.forEach(
    function(value,index){

      const key =
        String(
          value || ""
        )
        .trim()
        .toLowerCase();


      if(key){

        map[key] =
          index;

      }

    }
  );


  return map;

}


function PR_col_(
  headers,
  name
){

  const key =
    String(
      name || ""
    )
    .trim()
    .toLowerCase();


  return Object.prototype
    .hasOwnProperty
    .call(
      headers,
      key
    )
      ? headers[key]
      : -1;

}


function PR_requireHeaders_(
  headers,
  required,
  sheetName
){

  const missing =
    required.filter(
      function(name){

        return (
          PR_col_(
            headers,
            name
          ) < 0
        );

      }
    );


  if(missing.length){

    throw new Error(
      sheetName +
      " is missing expected columns: " +
      missing.join(
        ", "
      )
    );

  }

}


function PR_value_(
  row,
  headers,
  name
){

  const col =
    PR_col_(
      headers,
      name
    );


  return col >= 0
    ? row[col]
    : "";

}


function PR_textCell_(
  row,
  headers,
  name
){

  return String(
    PR_value_(
      row,
      headers,
      name
    ) || ""
  )
  .trim();

}


/******************************************************
 * PRIVATE: DATE
 ******************************************************/
function PR_parseDate_(
  value
){

  if(
    Object.prototype
      .toString
      .call(
        value
      ) ===
      "[object Date]"
  ){

    if(
      !isNaN(
        value.getTime()
      )
    ){

      return new Date(
        value.getTime()
      );

    }


    return null;

  }


  const text =
    String(
      value || ""
    )
    .trim();


  if(!text)
    return null;


  let match =
    text.match(
      /^(\d{1,2})-([A-Za-z]{3,9})-(\d{4})$/
    );


  if(match){

    const months = {

      jan:0,
      january:0,

      feb:1,
      february:1,

      mar:2,
      march:2,

      apr:3,
      april:3,

      may:4,

      jun:5,
      june:5,

      jul:6,
      july:6,

      aug:7,
      august:7,

      sep:8,
      sept:8,
      september:8,

      oct:9,
      october:9,

      nov:10,
      november:10,

      dec:11,
      december:11

    };


    const month =
      months[
        String(
          match[2]
        )
        .toLowerCase()
      ];


    if(
      month !== undefined
    ){

      const d =
        new Date(
          Number(
            match[3]
          ),
          month,
          Number(
            match[1]
          )
        );


      return isNaN(
        d.getTime()
      )
        ? null
        : d;

    }

  }


  match =
    text.match(
      /^(\d{4})-(\d{1,2})-(\d{1,2})$/
    );


  if(match){

    const d =
      new Date(
        Number(
          match[1]
        ),
        Number(
          match[2]
        ) - 1,
        Number(
          match[3]
        )
      );


    return isNaN(
      d.getTime()
    )
      ? null
      : d;

  }


  const parsed =
    new Date(
      text
    );


  return isNaN(
    parsed.getTime()
  )
    ? null
    : parsed;

}


function PR_dateLabel_(
  dateObj
){

  if(
    !dateObj ||
    Object.prototype
      .toString
      .call(
        dateObj
      ) !==
      "[object Date]" ||
    isNaN(
      dateObj.getTime()
    )
  ){

    return "";

  }


  return Utilities.formatDate(
    dateObj,
    PORTAL_CONFIG.TIME_ZONE,
    "dd-MMM-yyyy"
  );

}


function PR_monthKey_(
  dateObj
){

  return Utilities.formatDate(
    dateObj,
    PORTAL_CONFIG.TIME_ZONE,
    "yyyy-MM"
  );

}


function PR_monthLabel_(
  dateObj
){

  return Utilities.formatDate(
    dateObj,
    PORTAL_CONFIG.TIME_ZONE,
    "MMM-yyyy"
  );

}


function PR_monthLabelFromKey_(
  monthKey
){

  const match =
    String(
      monthKey || ""
    )
    .match(
      /^(\d{4})-(\d{2})$/
    );


  if(!match)
    return monthKey;


  const date =
    new Date(
      Number(
        match[1]
      ),
      Number(
        match[2]
      ) - 1,
      1
    );


  return PR_monthLabel_(
    date
  );

}


/******************************************************
 * PRIVATE: OTHER HELPERS
 ******************************************************/
function PR_handlerKey_(
  value
){

  return String(
    value || ""
  )
  .replace(
    /\s+/g,
    " "
  )
  .trim()
  .toLowerCase();

}


function PR_number_(
  value
){

  if(
    value === null ||
    value === undefined ||
    value === ""
  ){

    return 0;

  }


  const cleaned =
    String(
      value
    )
    .replace(
      /[₹,%\s,]/g,
      ""
    )
    .trim();


  const number =
    Number(
      cleaned
    );


  return isNaN(
    number
  )
    ? 0
    : number;

}


function PR_sortNewest_(
  a,
  b
){

  const aTime =
    a.promotionDate &&
    a.promotionDate.getTime
      ? a.promotionDate.getTime()
      : 0;


  const bTime =
    b.promotionDate &&
    b.promotionDate.getTime
      ? b.promotionDate.getTime()
      : 0;


  return (
    bTime -
    aTime
  );

}
