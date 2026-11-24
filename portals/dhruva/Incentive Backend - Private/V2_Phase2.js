/******************************************************
 * V2_Phase2.gs
 * Interview Operations Portal V2
 * Private Backend — Phase 2
 *
 * VERSION
 * -------
 * V2-PHASE2-OPERATIONS-1.0.0
 *
 * PURPOSE
 * -------
 * Build the shadow Operational Calls + Interview
 * Occurrence layer on top of the verified Phase 1:
 *
 *   Raw / Gateway occurrence
 *      -> Team Data operational assignment
 *      -> Operational Call
 *      -> Interview Occurrence
 *      -> Logical Interview ID
 *
 * PHASE 1 DEPENDENCIES
 * --------------------
 * V2_Phase1.gs must already be active and verified.
 *
 * Expected:
 * - Foundation: V2-PHASE2.0-2026.08.15
 * - Repository: V2-REPOSITORY-2.0.0
 * - Parser: GW-PARSER-1.4.0
 * - Matcher: V2-CANDIDATE-MATCHER-1.3.1
 *
 * DATA AUTHORITY
 * --------------
 * Original Raw/Gateway = source evidence.
 * Team Data = operational authority.
 *
 * BUSINESS-DAY RULE — LOCKED
 * --------------------------
 * The date header is the BUSINESS DATE, not necessarily
 * the interview's civil/calendar date.
 *
 * Raw Data:
 * - date header is in column B;
 * - interview records beneath that header inherit it.
 *
 * Team Data:
 * - date header is carried forward to interview rows.
 *
 * A business day may begin in the afternoon/evening of D
 * and continue after midnight until early morning D+1.
 * Example:
 *   Header = 2026-08-15
 *   11:30 PM interview -> Business Date 2026-08-15
 *   1:30 AM interview  -> Business Date 2026-08-15
 * even though the latter occurs on calendar date 2026-08-16.
 *
 * Phase 2 MUST NEVER change Business Date because a time is
 * AM/after midnight. Time is used only to distinguish/order
 * occurrences inside the same business-day block.
 *
 * Therefore:
 * - A Gateway row that never appears operationally in
 *   Team Data is retained as RAW_ONLY.
 * - A Team Data row is never silently discarded.
 * - If a Team Data row cannot be safely linked to one
 *   Gateway occurrence, it becomes TEAM_ONLY_REVIEW.
 *
 * SAME CANDIDATE / CLIENT / ROUND
 * -------------------------------
 * May legitimately repeat on different dates because of
 * reschedules/cancellations. Phase 2 therefore preserves
 * every dated occurrence and DOES NOT deduplicate them.
 *
 * LOGICAL INTERVIEW
 * -----------------
 * Logical Interview ID groups:
 * Candidate + Client + Stage/Round
 *
 * Occurrence ID preserves the individual dated occurrence.
 *
 * STATUS SEPARATION
 * -----------------
 * Parse Status       = parser certainty from Gateway.
 * Operational Status = Team Data truth.
 * Outcome Status     = In Progress / Selected.
 * Link Status        = Team Data <-> Gateway reconciliation.
 *
 * SAFETY
 * ------
 * Phase 2 NEVER writes Raw Data or Team Data.
 * It writes only NEW V2 Phase-2 private-backend sheets.
 ******************************************************/


const V2_PHASE2 =
  Object.freeze({

    VERSION:
      "V2-PHASE2-OPERATIONS-1.0.4",

    TEAM_DATA_SHEET:
      "Team Data",

    SHEETS:
      Object.freeze({

        OPERATIONAL_CALLS:
          "V2 Operational Calls",

        OCCURRENCES:
          "V2 Interview Occurrences",

        RECONCILIATION:
          "V2 Occurrence Reconciliation"

      }),

    LINK:
      Object.freeze({

        MIN_AUTO_SCORE:
          70,

        MIN_AUTO_MARGIN:
          10,

        EXACT_TEXT_BONUS:
          35,

        CANDIDATE_ID_BONUS:
          50,

        CANDIDATE_RAW_BONUS:
          25,

        CLIENT_EXACT_BONUS:
          20,

        CLIENT_NEAR_BONUS:
          12,

        ROUND_EXACT_BONUS:
          15,

        ROUND_LABEL_BONUS:
          12,

        TIME_EXACT_BONUS:
          15,

        TIME_5_MIN_BONUS:
          10,

        TIME_15_MIN_BONUS:
          5,

        TYPE_BONUS:
          5

      })

  });


/******************************************************
 * PHASE-2 SHEET DEFINITIONS
 ******************************************************/
function V2P2_sheetDefinitions_(){

  return {

    OPERATIONAL_CALLS: {
      name:
        V2_PHASE2.SHEETS.OPERATIONAL_CALLS,
      headers: [
        "Call ID",
        "Business Date",
        "Business Date Key",
        "Team Data Row",
        "Team Data Record",
        "Candidate Raw",
        "Candidate ID",
        "Official Candidate Name",
        "Candidate Match Status",
        "Client Raw",
        "Round Label",
        "Round No",
        "Interview Type",
        "Time Normalized",
        "Start Minutes",
        "Duration Minutes",
        "Handler Raw",
        "Handler ID",
        "Handler Name",
        "Team ID",
        "Operational Status",
        "Outcome Status",
        "Selection Confirmed Date",
        "Linked Gateway ID",
        "Occurrence ID",
        "Logical Interview ID",
        "Link Status",
        "Link Score",
        "Link Margin",
        "Link Reason",
        "Parse Status",
        "Review Reason",
        "Phase2 Version",
        "Built At"
      ]
    },

    OCCURRENCES: {
      name:
        V2_PHASE2.SHEETS.OCCURRENCES,
      headers: [
        "Occurrence ID",
        "Logical Interview ID",
        "Occurrence Source",
        "Gateway ID",
        "Operational Call ID",
        "Business Date",
        "Business Date Key",
        "Gateway Source Sheet",
        "Gateway Source Row",
        "Team Data Row",
        "Candidate Raw",
        "Gateway Candidate ID",
        "Operational Candidate ID",
        "Candidate ID",
        "Official Candidate Name",
        "Client Raw",
        "Client Key",
        "Round Label",
        "Round No",
        "Stage Descriptor",
        "Interview Type",
        "Time Normalized",
        "Start Minutes",
        "Duration Minutes",
        "Handler ID",
        "Handler Name",
        "Team ID",
        "Operational Status",
        "Outcome Status",
        "Selection Confirmed Date",
        "Parse Status",
        "Candidate Match Status",
        "Link Status",
        "Occurrence Status",
        "Original Gateway Record",
        "Team Data Record",
        "Phase2 Version",
        "Built At"
      ]
    },

    RECONCILIATION: {
      name:
        V2_PHASE2.SHEETS.RECONCILIATION,
      headers: [
        "Review ID",
        "Call ID",
        "Business Date",
        "Business Date Key",
        "Team Data Row",
        "Team Data Record",
        "Candidate Raw",
        "Candidate ID",
        "Official Candidate Name",
        "Client Raw",
        "Round Label",
        "Round No",
        "Time Normalized",
        "Handler Raw",
        "Operational Status",
        "Outcome Status",
        "Link Status",
        "Best Score",
        "Second Best Score",
        "Margin",
        "Best Gateway ID",
        "Candidate Gateway IDs",
        "Reason",
        "Phase2 Version",
        "Created At"
      ]
    }

  };

}


/******************************************************
 * PUBLIC 1 — READ-ONLY HEALTH CHECK
 ******************************************************/
function V2P2_testPhase2HealthReadOnly(){

  const required = {
    phase1Combined:
      (
        typeof V2_PHASE1_COMBINED !==
          "undefined"
      ),
    backendRouter:
      (
        typeof V2_backend_ ===
          "function"
      ),
    operationsRouter:
      (
        typeof V2_operations_ ===
          "function"
      ),
    repository:
      (
        typeof V2Repo_getGateway ===
          "function"
      ),
    parser:
      (
        typeof V2_gatewayParseText_ ===
          "function"
      ),
    candidateLoader:
      (
        typeof V2_loadCandidateMaster_ ===
          "function"
      ),
    candidateMatcher:
      (
        typeof V2_matchCandidate_ ===
          "function"
      ),
    handlerRepository:
      (
        typeof V2Repo_getHandlers ===
          "function"
      )
  };

  const dependencyOk =
    Object.keys(required)
      .every(
        function(key){
          return required[key];
        }
      );

  let teamDataFound = false;
  let teamDataRows = 0;
  let gatewayRows = 0;
  let backendName = "";
  let operationsName = "";

  if(dependencyOk){

    const backend =
      V2_backend_();

    const operations =
      V2_operations_();

    backendName =
      backend.getName();

    operationsName =
      operations.getName();

    const teamSheet =
      operations.getSheetByName(
        V2_PHASE2.TEAM_DATA_SHEET
      );

    teamDataFound =
      !!teamSheet;

    if(teamSheet){
      teamDataRows =
        Math.max(
          0,
          teamSheet.getLastRow() - 1
        );
    }

    gatewayRows =
      V2Repo_getGateway({})
        .length;

  }

  const result = {
    ok:
      (
        dependencyOk &&
        teamDataFound &&
        gatewayRows > 0
      ),

    mode:
      "READ_ONLY",

    phase2Version:
      V2_PHASE2.VERSION,

    dependencies:
      required,

    backend:
      backendName,

    operationsWorkbook:
      operationsName,

    teamDataFound:
      teamDataFound,

    teamDataPhysicalRows:
      teamDataRows,

    gatewayRows:
      gatewayRows
  };

  Logger.log(
    "========== V2 PHASE 2 HEALTH =========="
  );

  Logger.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );

  Logger.log(
    "======================================="
  );

  return result;

}


/******************************************************
 * PUBLIC 2 — PURE SYNTHETIC LINKING TESTS
 *
 * No Spreadsheet reads/writes.
 ******************************************************/
function V2P2_testOccurrenceLinkingSyntheticReadOnly(){

  const dateA =
    "2026-08-15";

  const dateB =
    "2026-08-16";

  const canonicalDateFromDate =
    V2P2_businessDateKey_(
      new Date(
        2026,
        7,
        15
      ),
      ""
    );

  const canonicalDateFromString =
    V2P2_businessDateKey_(
      "Sat Aug 15 2026 00:00:00 GMT+0530 (India Standard Time)",
      ""
    );

  // Business-day semantics:
  // 1:30 AM remains under the SAME business-date header.
  const overnightGateways = [
    V2P2_syntheticGateway_(
      "GW-NIGHT-D",
      "2026-08-15",
      "CAN-NIGHT",
      "Night Candidate",
      "Night Client",
      "1st Round",
      1,
      90,
      "Interview",
      "Night Candidate - Interview - Night Client - 1:30 AM IST - 1st Round"
    ),
    V2P2_syntheticGateway_(
      "GW-NIGHT-DPLUS1",
      "2026-08-16",
      "CAN-NIGHT",
      "Night Candidate",
      "Night Client",
      "1st Round",
      1,
      90,
      "Interview",
      "Night Candidate - Interview - Night Client - 1:30 AM IST - 1st Round"
    )
  ];

  const overnightCallSameBusinessDay =
    V2P2_syntheticCall_(
      "2026-08-15",
      "CAN-NIGHT",
      "Night Candidate",
      "Night Client",
      "1st Round",
      1,
      90,
      "Interview",
      "Night Candidate - Interview - Night Client - 1:30 AM IST - 1st Round"
    );

  const overnightDecision =
    V2P2_chooseGatewayForCall_(
      overnightCallSameBusinessDay,
      overnightGateways.filter(
        function(item){
          return (
            item.businessDateKey ===
            overnightCallSameBusinessDay.businessDateKey
          );
        }
      ),
      {}
    );

  const gateways = [
    V2P2_syntheticGateway_(
      "GW-T001",
      dateA,
      "CAN-1",
      "Ravi Kumar",
      "Acme",
      "1st Round",
      1,
      1260,
      "Interview",
      "Ravi Kumar - Interview - Acme - 9:00 PM IST - 1st Round"
    ),
    V2P2_syntheticGateway_(
      "GW-T002",
      dateA,
      "CAN-1",
      "Ravi Kumar",
      "Acme",
      "1st Round",
      1,
      1320,
      "Interview",
      "Ravi Kumar - Interview - Acme - 10:00 PM IST - 1st Round"
    ),
    V2P2_syntheticGateway_(
      "GW-T003",
      dateB,
      "CAN-1",
      "Ravi Kumar",
      "Acme",
      "1st Round",
      1,
      1260,
      "Interview",
      "Ravi Kumar - Interview - Acme - 9:00 PM IST - 1st Round"
    )
  ];

  const exactCall =
    V2P2_syntheticCall_(
      dateA,
      "CAN-1",
      "Ravi Kumar",
      "Acme",
      "1st Round",
      1,
      1260,
      "Interview",
      "Ravi Kumar - Interview - Acme - 9:00 PM IST - 1st Round"
    );

  const timeCall =
    V2P2_syntheticCall_(
      dateA,
      "CAN-1",
      "Ravi Kumar",
      "Acme",
      "1st Round",
      1,
      1320,
      "Interview",
      "Ravi Kumar - Interview - Acme - 10:00 PM IST"
    );

  const dateCall =
    V2P2_syntheticCall_(
      dateB,
      "CAN-1",
      "Ravi Kumar",
      "Acme",
      "1st Round",
      1,
      1260,
      "Interview",
      "Ravi Kumar - Interview - Acme - 9:00 PM IST"
    );

  const wrongRoundCall =
    V2P2_syntheticCall_(
      dateA,
      "CAN-1",
      "Ravi Kumar",
      "Acme",
      "2nd Round",
      2,
      1260,
      "Interview",
      "Ravi Kumar - Interview - Acme - 9:00 PM IST - 2nd Round"
    );

  const exact =
    V2P2_chooseGatewayForCall_(
      exactCall,
      gateways,
      {}
    );

  const byTime =
    V2P2_chooseGatewayForCall_(
      timeCall,
      gateways,
      {}
    );

  const byDate =
    V2P2_chooseGatewayForCall_(
      dateCall,
      gateways,
      {}
    );

  const wrongRound =
    V2P2_chooseGatewayForCall_(
      wrongRoundCall,
      gateways,
      {}
    );

  const logicalOne =
    V2P2_logicalInterviewId_(
      exactCall
    );

  const logicalTwo =
    V2P2_logicalInterviewId_(
      dateCall
    );

  const operationalCancelled =
    V2P2_operationalStatus_(
      "Cancelled",
      ""
    );

  const operationalRescheduled =
    V2P2_operationalStatus_(
      "Rescheduled",
      ""
    );

  const outcomeSelected =
    V2P2_outcomeStatus_(
      "Selected"
    );

  const checks = [
    {
      name:
        "exact text links first dated occurrence",
      ok:
        (
          exact.linkStatus ===
            "LINKED_EXACT" &&
          exact.gatewayId ===
            "GW-T001"
        )
    },
    {
      name:
        "same candidate/client/round uses time",
      ok:
        (
          byTime.gatewayId ===
            "GW-T002" &&
          byTime.autoLinked
        )
    },
    {
      name:
        "same interview on different date does not cross-link",
      ok:
        (
          byDate.gatewayId ===
            "GW-T003" &&
          byDate.autoLinked
        )
    },
    {
      name:
        "mismatched round is not auto-linked",
      ok:
        !wrongRound.autoLinked
    },
    {
      name:
        "logical interview groups same candidate/client/round across dates",
      ok:
        logicalOne ===
        logicalTwo
    },
    {
      name:
        "cancelled operational status",
      ok:
        operationalCancelled ===
        "CANCELLED"
    },
    {
      name:
        "rescheduled operational status",
      ok:
        operationalRescheduled ===
        "RESCHEDULED"
    },
    {
      name:
        "selected outcome remains separate from operational status",
      ok:
        outcomeSelected ===
        "SELECTED"
    },
    {
      name:
        "Gateway Date object canonicalizes to yyyy-MM-dd",
      ok:
        canonicalDateFromDate ===
        "2026-08-15"
    },
    {
      name:
        "Gateway Date string canonicalizes to yyyy-MM-dd",
      ok:
        canonicalDateFromString ===
        "2026-08-15"
    },
    {
      name:
        "1:30 AM keeps carried-forward business date",
      ok:
        overnightCallSameBusinessDay
          .businessDateKey ===
        "2026-08-15"
    },
    {
      name:
        "1:30 AM links only inside same business-day block",
      ok:
        (
          overnightDecision.autoLinked &&
          overnightDecision.gatewayId ===
            "GW-NIGHT-D"
        )
    }
  ];

  const passed =
    checks.filter(
      function(item){
        return item.ok;
      }
    ).length;

  const result = {
    ok:
      passed ===
      checks.length,

    mode:
      "READ_ONLY_SYNTHETIC",

    phase2Version:
      V2_PHASE2.VERSION,

    passed:
      passed,

    total:
      checks.length,

    checks:
      checks
  };

  Logger.log(
    "========== V2 PHASE 2 SYNTHETIC =========="
  );

  Logger.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );

  Logger.log(
    "=========================================="
  );

  return result;

}


/******************************************************
 * PUBLIC 3 — REAL READ-ONLY RECONCILIATION PREVIEW
 *
 * Reads:
 * - Team Data
 * - V2 Interview Gateway
 * - Candidate/Handler masters
 *
 * Writes NOTHING.
 ******************************************************/
function V2P2_previewOperationalReconciliationReadOnly(){

  const model =
    V2P2_buildShadowModel_();

  const result =
    V2P2_modelSummary_(
      model,
      "READ_ONLY"
    );

  Logger.log(
    "========== V2 PHASE 2 REAL PREVIEW =========="
  );

  Logger.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );

  Logger.log(
    "============================================="
  );

  return result;

}


/******************************************************
 * PUBLIC 4 — DATE ALIGNMENT DIAGNOSTIC
 *
 * READ ONLY.
 *
 * Purpose:
 * The first real reconciliation preview showed 0 linked
 * calls. Before changing any matching rule, this function
 * checks whether Team Data business dates and Gateway
 * Business Date Keys actually overlap.
 *
 * It does NOT write any sheet.
 ******************************************************/
function V2P2_diagnoseDateAlignmentReadOnly(){

  const teamRecords =
    V2P2_readTeamDataRecords_();

  const gatewayRows =
    V2Repo_getGateway({});

  const teamByDate = {};
  const gatewayByDate = {};

  let teamMissingDate = 0;
  let gatewayMissingDate = 0;

  teamRecords.forEach(
    function(row){

      const key =
        String(
          row.businessDateKey || ""
        ).trim();

      if(!key){
        teamMissingDate++;
        return;
      }

      teamByDate[key] =
        (
          teamByDate[key] || 0
        ) + 1;

    }
  );

  gatewayRows.forEach(
    function(row){

      const key =
        V2P2_businessDateKey_(
          row["Business Date Key"],
          row["Source Date"]
        );

      if(!key){
        gatewayMissingDate++;
        return;
      }

      gatewayByDate[key] =
        (
          gatewayByDate[key] || 0
        ) + 1;

    }
  );

  const teamDates =
    Object.keys(
      teamByDate
    ).sort();

  const gatewayDates =
    Object.keys(
      gatewayByDate
    ).sort();

  const overlappingDates =
    teamDates.filter(
      function(key){
        return !!gatewayByDate[key];
      }
    );

  const teamOnlyDates =
    teamDates.filter(
      function(key){
        return !gatewayByDate[key];
      }
    );

  const gatewayOnlyDates =
    gatewayDates.filter(
      function(key){
        return !teamByDate[key];
      }
    );

  let teamRowsOnOverlap = 0;
  let gatewayRowsOnOverlap = 0;

  overlappingDates.forEach(
    function(key){

      teamRowsOnOverlap +=
        teamByDate[key] || 0;

      gatewayRowsOnOverlap +=
        gatewayByDate[key] || 0;

    }
  );

  function sampleDates_(
    dates,
    counts,
    limit
  ){

    return dates
      .slice(
        0,
        limit
      )
      .map(
        function(key){

          return {
            businessDateKey:
              key,
            records:
              counts[key] || 0
          };

        }
      );

  }

  const firstTeamDate =
    teamDates.length
      ? teamDates[0]
      : "";

  const firstGatewayDate =
    gatewayDates.length
      ? gatewayDates[0]
      : "";

  const result = {

    ok:
      true,

    mode:
      "READ_ONLY",

    phase2Version:
      V2_PHASE2.VERSION,

    team: {
      operationalRecords:
        teamRecords.length,
      missingDateRecords:
        teamMissingDate,
      uniqueBusinessDates:
        teamDates.length,
      firstBusinessDate:
        firstTeamDate,
      lastBusinessDate:
        teamDates.length
          ? teamDates[
              teamDates.length - 1
            ]
          : "",
      first10Dates:
        sampleDates_(
          teamDates,
          teamByDate,
          10
        )
    },

    gateway: {
      rows:
        gatewayRows.length,
      missingDateRecords:
        gatewayMissingDate,
      uniqueBusinessDates:
        gatewayDates.length,
      firstBusinessDate:
        firstGatewayDate,
      lastBusinessDate:
        gatewayDates.length
          ? gatewayDates[
              gatewayDates.length - 1
            ]
          : "",
      first10Dates:
        sampleDates_(
          gatewayDates,
          gatewayByDate,
          10
        )
    },

    alignment: {
      overlappingDateCount:
        overlappingDates.length,
      teamRowsOnOverlappingDates:
        teamRowsOnOverlap,
      gatewayRowsOnOverlappingDates:
        gatewayRowsOnOverlap,
      first20OverlappingDates:
        sampleDates_(
          overlappingDates,
          teamByDate,
          20
        ),
      first20TeamOnlyDates:
        sampleDates_(
          teamOnlyDates,
          teamByDate,
          20
        ),
      first20GatewayOnlyDates:
        sampleDates_(
          gatewayOnlyDates,
          gatewayByDate,
          20
        )
    }

  };

  Logger.log(
    "========== V2 PHASE 2 BUSINESS-DATE ALIGNMENT =========="
  );

  Logger.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );

  Logger.log(
    "==============================================="
  );

  return result;

}


/******************************************************
 * PUBLIC 5 — SETUP NEW PHASE-2 SHEETS
 *
 * Writes ONLY the three new V2 Phase-2 sheets.
 * Re-runnable.
 ******************************************************/
function V2P2_setupPhase2Sheets(){

  const ss =
    V2_backend_();

  const defs =
    V2P2_sheetDefinitions_();

  const result = {
    ok:
      true,
    phase2Version:
      V2_PHASE2.VERSION,
    created:
      [],
    verified:
      []
  };

  Object.keys(defs)
    .forEach(
      function(key){

        const def =
          defs[key];

        const existing =
          ss.getSheetByName(
            def.name
          );

        const sheet =
          V2P2_ensureSheet_(
            ss,
            def.name,
            def.headers
          );

        if(existing){
          result.verified.push(
            def.name
          );
        }else{
          result.created.push(
            def.name
          );
        }

        V2P2_formatHeader_(
          sheet,
          def.headers.length
        );

      }
    );

  Logger.log(
    "========== V2 PHASE 2 SHEET SETUP =========="
  );

  Logger.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );

  Logger.log(
    "============================================"
  );

  return result;

}


/******************************************************
 * PUBLIC 6 — PHASE-2 SHADOW REBUILD
 *
 * Writes ONLY:
 * - V2 Operational Calls
 * - V2 Interview Occurrences
 * - V2 Occurrence Reconciliation
 *
 * NEVER writes Raw Data / Team Data.
 ******************************************************/
function V2P2_rebuildOperationalShadow(){

  const started =
    Date.now();

  const model =
    V2P2_buildShadowModel_();

  const ss =
    V2_backend_();

  const defs =
    V2P2_sheetDefinitions_();

  Object.keys(defs)
    .forEach(
      function(key){

        const def =
          defs[key];

        const sheet =
          ss.getSheetByName(
            def.name
          );

        if(!sheet){
          throw new Error(
            "V2P2_SHEET_NOT_FOUND|" +
            def.name +
            "|run=V2P2_setupPhase2Sheets"
          );
        }

        if(
          !V2P2_headersMatch_(
            sheet,
            def.headers
          )
        ){
          throw new Error(
            "V2P2_HEADER_MISMATCH|" +
            def.name
          );
        }

      }
    );

  V2P2_replaceBody_(
    ss.getSheetByName(
      defs.OPERATIONAL_CALLS.name
    ),
    defs.OPERATIONAL_CALLS.headers,
    model.calls.map(
      V2P2_callToRow_
    )
  );

  V2P2_replaceBody_(
    ss.getSheetByName(
      defs.OCCURRENCES.name
    ),
    defs.OCCURRENCES.headers,
    model.occurrences.map(
      V2P2_occurrenceToRow_
    )
  );

  V2P2_replaceBody_(
    ss.getSheetByName(
      defs.RECONCILIATION.name
    ),
    defs.RECONCILIATION.headers,
    model.reconciliation.map(
      V2P2_reconciliationToRow_
    )
  );

  const result =
    V2P2_modelSummary_(
      model,
      "WRITE_SHADOW"
    );

  result.elapsedMs =
    Date.now() -
    started;

  Logger.log(
    "========== V2 PHASE 2 SHADOW REBUILD =========="
  );

  Logger.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );

  Logger.log(
    "==============================================="
  );

  return result;

}


/******************************************************
 * PUBLIC 7 — STORED SHADOW VERIFICATION
 *
 * Read-only after rebuild.
 ******************************************************/
function V2P2_verifyStoredOperationalShadowReadOnly(){

  const ss =
    V2_backend_();

  const defs =
    V2P2_sheetDefinitions_();

  const calls =
    V2P2_readSheetObjects_(
      ss,
      defs.OPERATIONAL_CALLS
    );

  const occurrences =
    V2P2_readSheetObjects_(
      ss,
      defs.OCCURRENCES
    );

  const reconciliation =
    V2P2_readSheetObjects_(
      ss,
      defs.RECONCILIATION
    );

  const gatewayRows =
    V2Repo_getGateway({});

  const callIds =
    {};

  const occurrenceIds =
    {};

  const gatewayUse =
    {};

  let duplicateCallIds = 0;
  let duplicateOccurrenceIds = 0;
  let duplicateGatewayLinks = 0;
  let linkedCalls = 0;
  let reviewCalls = 0;

  calls.forEach(
    function(row){

      const callId =
        String(
          row["Call ID"] || ""
        ).trim();

      if(callIds[callId]){
        duplicateCallIds++;
      }

      callIds[callId] = true;

      const linkStatus =
        String(
          row["Link Status"] || ""
        ).trim();

      if(
        linkStatus.indexOf(
          "LINKED_"
        ) === 0
      ){
        linkedCalls++;

        const gatewayId =
          String(
            row["Linked Gateway ID"] || ""
          ).trim();

        if(gatewayId){

          gatewayUse[gatewayId] =
            (
              gatewayUse[gatewayId] || 0
            ) + 1;

        }

      }else{
        reviewCalls++;
      }

    }
  );

  occurrences.forEach(
    function(row){

      const occurrenceId =
        String(
          row["Occurrence ID"] || ""
        ).trim();

      if(occurrenceIds[occurrenceId]){
        duplicateOccurrenceIds++;
      }

      occurrenceIds[
        occurrenceId
      ] = true;

    }
  );

  Object.keys(gatewayUse)
    .forEach(
      function(gatewayId){

        if(
          gatewayUse[gatewayId] > 1
        ){
          duplicateGatewayLinks++;
        }

      }
    );

  const teamRecords =
    V2P2_readTeamDataRecords_();

  const expectedOccurrenceCount =
    gatewayRows.length +
    reviewCalls;

  const ok =
    (
      calls.length ===
        teamRecords.length &&
      reconciliation.length ===
        reviewCalls &&
      occurrences.length ===
        expectedOccurrenceCount &&
      duplicateCallIds === 0 &&
      duplicateOccurrenceIds === 0 &&
      duplicateGatewayLinks === 0
    );

  const result = {
    ok:
      ok,

    mode:
      "READ_ONLY",

    phase2Version:
      V2_PHASE2.VERSION,

    teamOperationalRecords:
      teamRecords.length,

    storedCalls:
      calls.length,

    linkedCalls:
      linkedCalls,

    reviewCalls:
      reviewCalls,

    storedReconciliation:
      reconciliation.length,

    gatewayRows:
      gatewayRows.length,

    storedOccurrences:
      occurrences.length,

    expectedOccurrences:
      expectedOccurrenceCount,

    duplicateCallIds:
      duplicateCallIds,

    duplicateOccurrenceIds:
      duplicateOccurrenceIds,

    duplicateGatewayLinks:
      duplicateGatewayLinks
  };

  Logger.log(
    "========== V2 PHASE 2 STORED VERIFY =========="
  );

  Logger.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );

  Logger.log(
    "=============================================="
  );

  return result;

}


/******************************************************
 * PRIVATE — BUILD COMPLETE SHADOW MODEL
 ******************************************************/
function V2P2_buildShadowModel_(){

  const gatewayRows =
    V2Repo_getGateway({});

  const candidateMaster =
    V2_loadCandidateMaster_();

  const handlerIndex =
    V2P2_buildHandlerIndex_(
      V2Repo_getHandlers()
    );

  const teamRecords =
    V2P2_readTeamDataRecords_();

  const calls =
    teamRecords.map(
      function(record){

        return V2P2_buildOperationalCall_(
          record,
          candidateMaster,
          handlerIndex
        );

      }
    );

  const gateways =
    gatewayRows.map(
      V2P2_gatewayModel_
    );

  const gatewayByDate =
    V2P2_groupGatewayByDate_(
      gateways
    );

  const usedGateway = {};

  const linkOrder =
    calls
      .slice()
      .sort(
        function(a,b){

          const aExact =
            V2P2_hasExactGatewayText_(
              a,
              gatewayByDate[
                a.businessDateKey
              ] || []
            )
              ? 1
              : 0;

          const bExact =
            V2P2_hasExactGatewayText_(
              b,
              gatewayByDate[
                b.businessDateKey
              ] || []
            )
              ? 1
              : 0;

          if(
            bExact !==
            aExact
          ){
            return bExact - aExact;
          }

          return (
            a.teamDataRow -
            b.teamDataRow
          );

        }
      );

  linkOrder.forEach(
    function(call){

      const candidates =
        gatewayByDate[
          call.businessDateKey
        ] || [];

      const decision =
        V2P2_chooseGatewayForCall_(
          call,
          candidates,
          usedGateway
        );

      call.linkStatus =
        decision.linkStatus;

      call.linkScore =
        decision.bestScore;

      call.linkMargin =
        decision.margin;

      call.linkReason =
        decision.reason;

// Only a true auto-link may claim a Gateway occurrence.
      // Review decisions may keep a suggested Gateway ID as evidence,
      // but must retain their own Team-only occurrence.
      call.reviewBestGatewayId =
        decision.autoLinked
          ? ""
          : (decision.gatewayId || "");

      call.linkedGatewayId =
        decision.autoLinked
          ? decision.gatewayId
          : "";

      call.reviewReason =
        decision.autoLinked
          ? ""
          : decision.reason;


      call.candidateGatewayIds =
        decision.candidateGatewayIds;

      if(
        decision.autoLinked &&
        decision.gatewayId
      ){

        usedGateway[
          decision.gatewayId
        ] =
          call.callId;

      }

    }
  );

  const gatewayMap = {};

  gateways.forEach(
    function(gateway){
      gatewayMap[
        gateway.gatewayId
      ] =
        gateway;
    }
  );

  calls.forEach(
    function(call){

      const gateway =
        call.linkedGatewayId
          ? gatewayMap[
              call.linkedGatewayId
            ]
          : null;

      call.occurrenceId =
        gateway
          ? V2P2_occurrenceIdFromGateway_(
              gateway.gatewayId
            )
          : V2P2_occurrenceIdFromCall_(
              call.callId
            );

      call.logicalInterviewId =
        V2P2_logicalInterviewId_(
          V2P2_logicalSource_(
            call,
            gateway
          )
        );

    }
  );

  const callByGateway = {};

  calls.forEach(
    function(call){

      if(
        call.linkedGatewayId
      ){
        callByGateway[
          call.linkedGatewayId
        ] =
          call;
      }

    }
  );

  const occurrences = [];

  gateways.forEach(
    function(gateway){

      const call =
        callByGateway[
          gateway.gatewayId
        ] || null;

      occurrences.push(
        V2P2_buildGatewayOccurrence_(
          gateway,
          call
        )
      );

    }
  );

  calls.forEach(
    function(call){

      if(
        !call.linkedGatewayId
      ){

        occurrences.push(
          V2P2_buildTeamOnlyOccurrence_(
            call
          )
        );

      }

    }
  );

  const reconciliation =
    calls
      .filter(
        function(call){

          return (
            call.linkStatus.indexOf(
              "LINKED_"
            ) !== 0
          );

        }
      )
      .map(
        V2P2_buildReconciliation_
      );

  return {
    gatewayRows:
      gateways,
    teamRecords:
      teamRecords,
    calls:
      calls,
    occurrences:
      occurrences,
    reconciliation:
      reconciliation
  };

}


/******************************************************
 * PRIVATE — MODEL SUMMARY
 ******************************************************/
function V2P2_modelSummary_(
  model,
  mode
){

  const linkStatus = {};
  const operationalStatus = {};
  const outcomeStatus = {};
  const occurrenceStatus = {};

  let linkedCalls = 0;

  model.calls.forEach(
    function(call){

      V2P2_count_(
        linkStatus,
        call.linkStatus
      );

      V2P2_count_(
        operationalStatus,
        call.operationalStatus
      );

      V2P2_count_(
        outcomeStatus,
        call.outcomeStatus ||
          "BLANK"
      );

      if(
        call.linkStatus.indexOf(
          "LINKED_"
        ) === 0
      ){
        linkedCalls++;
      }

    }
  );

  model.occurrences.forEach(
    function(occurrence){

      V2P2_count_(
        occurrenceStatus,
        occurrence.occurrenceStatus
      );

    }
  );

  const reviewExamples =
    model.reconciliation
      .slice(
        0,
        10
      )
      .map(
        function(item){

          return {
            teamDataRow:
              item.teamDataRow,
            businessDateKey:
              item.businessDateKey,
            candidateRaw:
              item.candidateRaw,
            clientRaw:
              item.clientRaw,
            roundLabel:
              item.roundLabel,
            timeNormalized:
              item.timeNormalized,
            handlerRaw:
              item.handlerRaw,
            linkStatus:
              item.linkStatus,
            bestScore:
              item.bestScore,
            margin:
              item.margin,
            bestGatewayId:
              item.bestGatewayId,
            reason:
              item.reason
          };

        }
      );

  return {
    ok:
      (
        model.calls.length ===
        linkedCalls +
        model.reconciliation.length
      ),

    mode:
      mode,

    phase2Version:
      V2_PHASE2.VERSION,

    gatewayOccurrences:
      model.gatewayRows.length,

    teamOperationalRecords:
      model.teamRecords.length,

    operationalCalls:
      model.calls.length,

    linkedCalls:
      linkedCalls,

    reviewCalls:
      model.reconciliation.length,

    totalOccurrences:
      model.occurrences.length,

    rawOnlyOccurrences:
      model.gatewayRows.length -
      linkedCalls,

    teamOnlyReviewOccurrences:
      model.reconciliation.length,

    linkStatus:
      linkStatus,

    operationalStatus:
      operationalStatus,

    outcomeStatus:
      outcomeStatus,

    occurrenceStatus:
      occurrenceStatus,

    reviewExamples:
      reviewExamples
  };

}


/******************************************************
 * PRIVATE — READ TEAM DATA
 *
 * Team Data columns:
 * A = Date header / carry-forward date
 * B = Interview record
 * C = Handler / Support / Rescheduled / Cancelled
 * D = In Progress / Selected
 * E = Selection Confirmed Date
 ******************************************************/
function V2P2_readTeamDataRecords_(){

  const operations =
    V2_operations_();

  const sheet =
    operations.getSheetByName(
      V2_PHASE2.TEAM_DATA_SHEET
    );

  if(!sheet){
    throw new Error(
      "V2P2_TEAM_DATA_NOT_FOUND"
    );
  }

  const lastRow =
    sheet.getLastRow();

  if(
    lastRow < 2
  ){
    return [];
  }

  const values =
    sheet
      .getRange(
        2,
        1,
        lastRow - 1,
        5
      )
      .getValues();

  const display =
    sheet
      .getRange(
        2,
        1,
        lastRow - 1,
        5
      )
      .getDisplayValues();

  const records = [];

  let currentDate = null;
  let currentDateKey = "";

  for(
    let i = 0;
    i < values.length;
    i++
  ){

    const row =
      values[i];

    const displayRow =
      display[i];

    const dateInfo =
      V2P2_dateInfo_(
        row[0],
        displayRow[0]
      );

    if(
      dateInfo.date
    ){

      currentDate =
        dateInfo.date;

      currentDateKey =
        dateInfo.key;

    }

    const interviewText =
      String(
        row[1] || ""
      ).trim();

    if(!interviewText){
      continue;
    }

    records.push({

      teamDataRow:
        i + 2,

      businessDate:
        currentDate || "",

      businessDateKey:
        currentDateKey,

      originalRecord:
        interviewText,

      columnCRaw:
        String(
          row[2] || ""
        ).trim(),

      columnDRaw:
        String(
          row[3] || ""
        ).trim(),

      selectionConfirmedDate:
        V2P2_dateValue_(
          row[4]
        )

    });

  }

  return records;

}


/******************************************************
 * PRIVATE — BUILD OPERATIONAL CALL
 ******************************************************/
function V2P2_buildOperationalCall_(
  teamRecord,
  candidateMaster,
  handlerIndex
){

  const parsed =
    V2_gatewayParseText_(
      teamRecord.originalRecord
    );

  const candidateMatch =
    V2_matchCandidate_(
      parsed.candidateRaw,
      candidateMaster,
      {
        originalRecord:
          teamRecord.originalRecord
      }
    );

  const operationalStatus =
    V2P2_operationalStatus_(
      teamRecord.columnCRaw,
      teamRecord.columnDRaw
    );

  const outcomeStatus =
    V2P2_outcomeStatus_(
      teamRecord.columnDRaw
    );

  const handlerRaw =
    V2P2_handlerRaw_(
      teamRecord.columnCRaw
    );

  const handler =
    V2P2_resolveHandler_(
      handlerRaw,
      handlerIndex
    );

  const callKey = [
    teamRecord.businessDateKey ||
      "NO_DATE",
    teamRecord.teamDataRow,
    V2P2_normalize_(
      teamRecord.originalRecord
    ),
    V2P2_normalize_(
      teamRecord.columnCRaw
    ),
    V2P2_normalize_(
      teamRecord.columnDRaw
    )
  ].join(
    "|"
  );

  const callId =
    "CALL-" +
    V2P2_hash_(
      callKey
    )
      .substring(
        0,
        18
      )
      .toUpperCase();

  const parseStatus =
    parsed.reviewReasons &&
    parsed.reviewReasons.length
      ? "REVIEW"
      : "READY";

  return {

    callId:
      callId,

    businessDate:
      teamRecord.businessDate,

    businessDateKey:
      teamRecord.businessDateKey,

    teamDataRow:
      teamRecord.teamDataRow,

    teamDataRecord:
      teamRecord.originalRecord,

    candidateRaw:
      parsed.candidateRaw,

    candidateId:
      candidateMatch.candidateId ||
      "",

    officialCandidateName:
      candidateMatch.officialName ||
      "",

    candidateMatchStatus:
      candidateMatch.status ||
      "",

    clientRaw:
      parsed.clientRaw,

    roundLabel:
      parsed.roundLabel,

    roundNo:
      parsed.roundNo,

    interviewType:
      parsed.interviewType,

    timeNormalized:
      parsed.timeNormalized,

    startMinutes:
      parsed.startMinutes,

    durationMinutes:
      parsed.durationMinutes,

    handlerRaw:
      handlerRaw,

    handlerId:
      handler.handlerId,

    handlerName:
      handler.handlerName,

    teamId:
      handler.teamId,

    operationalStatus:
      operationalStatus,

    outcomeStatus:
      outcomeStatus,

    selectionConfirmedDate:
      teamRecord.selectionConfirmedDate,

    parseStatus:
      parseStatus,

    parserReviewReason:
      (
        parsed.reviewReasons ||
        []
      ).join(
        " | "
      ),

linkedGatewayId:
      "",

    reviewBestGatewayId:
      "",

    occurrenceId:

      "",

    logicalInterviewId:
      "",

    linkStatus:
      "",

    linkScore:
      0,

    linkMargin:
      0,

    linkReason:
      "",

    reviewReason:
      "",

    candidateGatewayIds:
      [],

    builtAt:
      new Date()

  };

}


/******************************************************
 * PRIVATE — GATEWAY MODEL
 ******************************************************/
function V2P2_gatewayModel_(
  row
){

  return {
    gatewayId:
      String(
        row["Gateway ID"] || ""
      ).trim(),

    businessDate:
      row["Source Date"] || "",

    businessDateKey:
      V2P2_businessDateKey_(
        row["Business Date Key"],
        row["Source Date"]
      ),

    sourceSheet:
      String(
        row["Source Sheet"] || ""
      ).trim(),

    sourceRow:
      Number(
        row["Source Row"] || 0
      ),

    originalRecord:
      String(
        row["Original Record"] || ""
      ).trim(),

    candidateRaw:
      String(
        row["Candidate Raw"] || ""
      ).trim(),

    candidateId:
      String(
        row["Candidate ID"] || ""
      ).trim(),

    officialCandidateName:
      String(
        row[
          "Official Candidate Name"
        ] || ""
      ).trim(),

    candidateMatchStatus:
      String(
        row[
          "Candidate Match Status"
        ] || ""
      ).trim(),

    clientRaw:
      String(
        row["Client Raw"] || ""
      ).trim(),

    clientSuggested:
      String(
        row[
          "Client Suggested Match"
        ] || ""
      ).trim(),

    roundLabel:
      String(
        row["Round Label"] || ""
      ).trim(),

    roundNo:
      row["Round No"] === ""
        ? ""
        : Number(
            row["Round No"]
          ),

    stageDescriptor:
      String(
        row["Stage Descriptor"] || ""
      ).trim(),

    interviewType:
      String(
        row["Interview Type"] || ""
      ).trim(),

    timeNormalized:
      String(
        row["Time Normalized"] || ""
      ).trim(),

    startMinutes:
      row["Start Minutes"] === ""
        ? ""
        : Number(
            row["Start Minutes"]
          ),

    durationMinutes:
      row["Duration Minutes"] === ""
        ? ""
        : Number(
            row["Duration Minutes"]
          ),

    parseStatus:
      String(
        row["Parse Status"] || ""
      ).trim()

  };

}


/******************************************************
 * PRIVATE — LINK DECISION
 ******************************************************/
function V2P2_chooseGatewayForCall_(
  call,
  gatewayCandidates,
  usedGateway
){

  if(
    !call.businessDateKey
  ){

    return V2P2_linkDecision_(
      "REVIEW_MISSING_DATE",
      false,
      "",
      0,
      0,
      [],
      "TEAM_DATA_DATE_NOT_AVAILABLE"
    );

  }

  const scored = [];

  (gatewayCandidates || [])
    .forEach(
      function(gateway){

        // Business date is part of occurrence identity.
        // Never cross-link the same candidate/client/round
        // to a Gateway occurrence from another date.
        if(
          call.businessDateKey &&
          gateway.businessDateKey &&
          call.businessDateKey !==
            gateway.businessDateKey
        ){
          return;
        }

        if(
          usedGateway[
            gateway.gatewayId
          ]
        ){
          return;
        }

        const score =
          V2P2_scoreLink_(
            call,
            gateway
          );

        if(
          score.disqualified
        ){
          return;
        }

        scored.push({
          gateway:
            gateway,
          score:
            score.score,
          exactText:
            score.exactText,
          evidence:
            score.evidence
        });

      }
    );

  scored.sort(
    function(a,b){

      if(
        b.exactText !==
        a.exactText
      ){
        return (
          b.exactText
            ? 1
            : 0
        ) -
        (
          a.exactText
            ? 1
            : 0
        );
      }

      if(
        b.score !==
        a.score
      ){
        return (
          b.score -
          a.score
        );
      }

      return (
        a.gateway.sourceRow -
        b.gateway.sourceRow
      );

    }
  );

  if(
    !scored.length
  ){

    return V2P2_linkDecision_(
      "REVIEW_NO_GATEWAY_MATCH",
      false,
      "",
      0,
      0,
      [],
      "NO_COMPATIBLE_GATEWAY_ON_BUSINESS_DATE"
    );

  }

  const best =
    scored[0];

  const second =
    scored.length > 1
      ? scored[1]
      : null;

  const secondScore =
    second
      ? second.score
      : 0;

  const margin =
    best.score -
    secondScore;

  const candidateGatewayIds =
    scored
      .slice(
        0,
        5
      )
      .map(
        function(item){
          return item.gateway.gatewayId;
        }
      );

  if(
    best.exactText
  ){

    const tiedExact =
      scored.filter(
        function(item){

          return (
            item.exactText &&
            item.score ===
              best.score
          );

        }
      );

    if(
      tiedExact.length === 1
    ){

      return V2P2_linkDecision_(
        "LINKED_EXACT",
        true,
        best.gateway.gatewayId,
        best.score,
        margin,
        candidateGatewayIds,
        best.evidence.join(
          " | "
        )
      );

    }

  }

  if(
    best.score >=
      V2_PHASE2.LINK.MIN_AUTO_SCORE &&
    (
      !second ||
      margin >=
        V2_PHASE2.LINK.MIN_AUTO_MARGIN
    )
  ){

    return V2P2_linkDecision_(
      "LINKED_STRONG",
      true,
      best.gateway.gatewayId,
      best.score,
      margin,
      candidateGatewayIds,
      best.evidence.join(
        " | "
      )
    );

  }

  if(
    second &&
    margin <
      V2_PHASE2.LINK.MIN_AUTO_MARGIN
  ){

    return V2P2_linkDecision_(
      "REVIEW_AMBIGUOUS_GATEWAY",
      false,
      best.gateway.gatewayId,
      best.score,
      margin,
      candidateGatewayIds,
      "MULTIPLE_GATEWAY_OCCURRENCES_REMAIN_PLAUSIBLE"
    );

  }

  return V2P2_linkDecision_(
    "REVIEW_WEAK_GATEWAY_MATCH",
    false,
    best.gateway.gatewayId,
    best.score,
    margin,
    candidateGatewayIds,
    "BEST_GATEWAY_MATCH_BELOW_AUTO_THRESHOLD"
  );

}


function V2P2_scoreLink_(
  call,
  gateway
){

  const evidence = [];

  let score = 0;
  let disqualified = false;

  const callText =
    V2P2_normalize_(
      call.teamDataRecord
    );

  const gatewayText =
    V2P2_normalize_(
      gateway.originalRecord
    );

  const exactText =
    (
      !!callText &&
      callText ===
        gatewayText
    );

  if(exactText){

    score +=
      V2_PHASE2.LINK
        .EXACT_TEXT_BONUS;

    evidence.push(
      "EXACT_NORMALIZED_RECORD"
    );

  }

  //--------------------------------------------------
  // Candidate identity.
  //--------------------------------------------------

  if(
    call.candidateId &&
    gateway.candidateId
  ){

    if(
      call.candidateId !==
      gateway.candidateId
    ){

      disqualified = true;

      evidence.push(
        "CANDIDATE_ID_CONFLICT"
      );

    }else{

      score +=
        V2_PHASE2.LINK
          .CANDIDATE_ID_BONUS;

      evidence.push(
        "CANDIDATE_ID"
      );

    }

  }else{

    const callCandidate =
      V2P2_normalize_(
        call.candidateRaw
      );

    const gatewayCandidate =
      V2P2_normalize_(
        gateway.candidateRaw
      );

    const gatewayOfficial =
      V2P2_normalize_(
        gateway.officialCandidateName
      );

    if(
      callCandidate &&
      (
        callCandidate ===
          gatewayCandidate ||
        callCandidate ===
          gatewayOfficial
      )
    ){

      score +=
        V2_PHASE2.LINK
          .CANDIDATE_RAW_BONUS;

      evidence.push(
        "CANDIDATE_NAME"
      );

    }

  }

  //--------------------------------------------------
  // Client.
  //--------------------------------------------------

  const callClient =
    V2P2_normalize_(
      call.clientRaw
    );

  const gatewayClient =
    V2P2_normalize_(
      gateway.clientRaw
    );

  const gatewaySuggested =
    V2P2_normalize_(
      gateway.clientSuggested
    );

  if(
    callClient &&
    (
      callClient ===
        gatewayClient ||
      callClient ===
        gatewaySuggested
    )
  ){

    score +=
      V2_PHASE2.LINK
        .CLIENT_EXACT_BONUS;

    evidence.push(
      "CLIENT_EXACT"
    );

  }else if(
    callClient &&
    gatewayClient
  ){

    const clientSimilarity =
      V2P2_similarity_(
        callClient,
        gatewayClient
      );

    if(
      clientSimilarity >=
      90
    ){

      score +=
        V2_PHASE2.LINK
          .CLIENT_NEAR_BONUS;

      evidence.push(
        "CLIENT_NEAR"
      );

    }

  }

  //--------------------------------------------------
  // Round/stage.
  // If both explicit round numbers exist and differ,
  // do not auto-link them.
  //--------------------------------------------------

  const callRoundNo =
    call.roundNo === ""
      ? ""
      : Number(
          call.roundNo
        );

  const gatewayRoundNo =
    gateway.roundNo === ""
      ? ""
      : Number(
          gateway.roundNo
        );

  if(
    callRoundNo !== "" &&
    gatewayRoundNo !== ""
  ){

    if(
      callRoundNo !==
      gatewayRoundNo
    ){

      disqualified = true;

      evidence.push(
        "ROUND_NUMBER_CONFLICT"
      );

    }else{

      score +=
        V2_PHASE2.LINK
          .ROUND_EXACT_BONUS;

      evidence.push(
        "ROUND_NUMBER"
      );

    }

  }else{

    const callRound =
      V2P2_normalize_(
        call.roundLabel
      );

    const gatewayRound =
      V2P2_normalize_(
        gateway.roundLabel
      );

    if(
      callRound &&
      gatewayRound &&
      callRound ===
        gatewayRound
    ){

      score +=
        V2_PHASE2.LINK
          .ROUND_LABEL_BONUS;

      evidence.push(
        "ROUND_LABEL"
      );

    }

  }

  //--------------------------------------------------
  // Time.
  //--------------------------------------------------

  const callStart =
    V2P2_numberOrBlank_(
      call.startMinutes
    );

  const gatewayStart =
    V2P2_numberOrBlank_(
      gateway.startMinutes
    );

  if(
    callStart !== "" &&
    gatewayStart !== ""
  ){

    const delta =
      Math.abs(
        callStart -
        gatewayStart
      );

    if(
      delta === 0
    ){

      score +=
        V2_PHASE2.LINK
          .TIME_EXACT_BONUS;

      evidence.push(
        "TIME_EXACT"
      );

    }else if(
      delta <= 5
    ){

      score +=
        V2_PHASE2.LINK
          .TIME_5_MIN_BONUS;

      evidence.push(
        "TIME_WITHIN_5"
      );

    }else if(
      delta <= 15
    ){

      score +=
        V2_PHASE2.LINK
          .TIME_15_MIN_BONUS;

      evidence.push(
        "TIME_WITHIN_15"
      );

    }

  }

  //--------------------------------------------------
  // Interview type.
  //--------------------------------------------------

  const callType =
    V2P2_normalize_(
      call.interviewType
    );

  const gatewayType =
    V2P2_normalize_(
      gateway.interviewType
    );

  if(
    callType &&
    gatewayType &&
    callType ===
      gatewayType
  ){

    score +=
      V2_PHASE2.LINK
        .TYPE_BONUS;

    evidence.push(
      "INTERVIEW_TYPE"
    );

  }

  //--------------------------------------------------
  // Require actual identity evidence.
  //--------------------------------------------------

  const hasIdentityEvidence =
    evidence.indexOf(
      "CANDIDATE_ID"
    ) >= 0 ||
    evidence.indexOf(
      "CANDIDATE_NAME"
    ) >= 0 ||
    exactText;

  if(
    !hasIdentityEvidence
  ){

    disqualified = true;

    evidence.push(
      "NO_CANDIDATE_IDENTITY_EVIDENCE"
    );

  }

  return {
    score:
      score,
    exactText:
      exactText,
    disqualified:
      disqualified,
    evidence:
      evidence
  };

}


function V2P2_linkDecision_(
  linkStatus,
  autoLinked,
  gatewayId,
  bestScore,
  margin,
  candidateGatewayIds,
  reason
){

  return {
    linkStatus:
      linkStatus,
    autoLinked:
      autoLinked,
    gatewayId:
      gatewayId,
    bestScore:
      bestScore,
    margin:
      margin,
    candidateGatewayIds:
      candidateGatewayIds || [],
    reason:
      reason || ""
  };

}


/******************************************************
 * PRIVATE — BUILD OCCURRENCES
 ******************************************************/
function V2P2_buildGatewayOccurrence_(
  gateway,
  call
){

  const logicalSource =
    V2P2_logicalSource_(
      call,
      gateway
    );

  const candidateId =
    call &&
    call.candidateId
      ? call.candidateId
      : gateway.candidateId;

  const officialName =
    call &&
    call.officialCandidateName
      ? call.officialCandidateName
      : gateway.officialCandidateName;

  return {

    occurrenceId:
      V2P2_occurrenceIdFromGateway_(
        gateway.gatewayId
      ),

    logicalInterviewId:
      V2P2_logicalInterviewId_(
        logicalSource
      ),

    occurrenceSource:
      call
        ? "GATEWAY_AND_TEAM"
        : "GATEWAY_ONLY",

    gatewayId:
      gateway.gatewayId,

    operationalCallId:
      call
        ? call.callId
        : "",

    businessDate:
      call &&
      call.businessDate
        ? call.businessDate
        : gateway.businessDate,

    businessDateKey:
      call &&
      call.businessDateKey
        ? call.businessDateKey
        : gateway.businessDateKey,

    gatewaySourceSheet:
      gateway.sourceSheet,

    gatewaySourceRow:
      gateway.sourceRow,

    teamDataRow:
      call
        ? call.teamDataRow
        : "",

    candidateRaw:
      call &&
      call.candidateRaw
        ? call.candidateRaw
        : gateway.candidateRaw,

    gatewayCandidateId:
      gateway.candidateId,

    operationalCandidateId:
      call
        ? call.candidateId
        : "",

    candidateId:
      candidateId,

    officialCandidateName:
      officialName,

    clientRaw:
      call &&
      call.clientRaw
        ? call.clientRaw
        : gateway.clientRaw,

    clientKey:
      V2P2_clientKey_(
        call &&
        call.clientRaw
          ? call.clientRaw
          : gateway.clientRaw
      ),

    roundLabel:
      call &&
      call.roundLabel
        ? call.roundLabel
        : gateway.roundLabel,

    roundNo:
      call &&
      call.roundNo !== ""
        ? call.roundNo
        : gateway.roundNo,

    stageDescriptor:
      gateway.stageDescriptor,

    interviewType:
      call &&
      call.interviewType
        ? call.interviewType
        : gateway.interviewType,

    timeNormalized:
      call &&
      call.timeNormalized
        ? call.timeNormalized
        : gateway.timeNormalized,

    startMinutes:
      call &&
      call.startMinutes !== ""
        ? call.startMinutes
        : gateway.startMinutes,

    durationMinutes:
      call &&
      call.durationMinutes !== ""
        ? call.durationMinutes
        : gateway.durationMinutes,

    handlerId:
      call
        ? call.handlerId
        : "",

    handlerName:
      call
        ? call.handlerName
        : "",

    teamId:
      call
        ? call.teamId
        : "",

    operationalStatus:
      call
        ? call.operationalStatus
        : "NOT_OPERATIONAL",

    outcomeStatus:
      call
        ? call.outcomeStatus
        : "",

    selectionConfirmedDate:
      call
        ? call.selectionConfirmedDate
        : "",

    parseStatus:
      gateway.parseStatus,

    candidateMatchStatus:
      gateway.candidateMatchStatus,

    linkStatus:
      call
        ? call.linkStatus
        : "RAW_ONLY",

    occurrenceStatus:
      call
        ? "OPERATIONAL"
        : "RAW_ONLY",

    originalGatewayRecord:
      gateway.originalRecord,

    teamDataRecord:
      call
        ? call.teamDataRecord
        : "",

    builtAt:
      new Date()

  };

}


function V2P2_buildTeamOnlyOccurrence_(
  call
){

  return {

    occurrenceId:
      V2P2_occurrenceIdFromCall_(
        call.callId
      ),

    logicalInterviewId:
      call.logicalInterviewId,

    occurrenceSource:
      "TEAM_ONLY",

    gatewayId:
      "",

    operationalCallId:
      call.callId,

    businessDate:
      call.businessDate,

    businessDateKey:
      call.businessDateKey,

    gatewaySourceSheet:
      "",

    gatewaySourceRow:
      "",

    teamDataRow:
      call.teamDataRow,

    candidateRaw:
      call.candidateRaw,

    gatewayCandidateId:
      "",

    operationalCandidateId:
      call.candidateId,

    candidateId:
      call.candidateId,

    officialCandidateName:
      call.officialCandidateName,

    clientRaw:
      call.clientRaw,

    clientKey:
      V2P2_clientKey_(
        call.clientRaw
      ),

    roundLabel:
      call.roundLabel,

    roundNo:
      call.roundNo,

    stageDescriptor:
      "",

    interviewType:
      call.interviewType,

    timeNormalized:
      call.timeNormalized,

    startMinutes:
      call.startMinutes,

    durationMinutes:
      call.durationMinutes,

    handlerId:
      call.handlerId,

    handlerName:
      call.handlerName,

    teamId:
      call.teamId,

    operationalStatus:
      call.operationalStatus,

    outcomeStatus:
      call.outcomeStatus,

    selectionConfirmedDate:
      call.selectionConfirmedDate,

    parseStatus:
      call.parseStatus,

    candidateMatchStatus:
      call.candidateMatchStatus,

    linkStatus:
      call.linkStatus,

    occurrenceStatus:
      "TEAM_ONLY_REVIEW",

    originalGatewayRecord:
      "",

    teamDataRecord:
      call.teamDataRecord,

    builtAt:
      new Date()

  };

}


/******************************************************
 * PRIVATE — LOGICAL INTERVIEW ID
 ******************************************************/
function V2P2_logicalSource_(
  call,
  gateway
){

  return {

    candidateId:
      call &&
      call.candidateId
        ? call.candidateId
        : (
            gateway
              ? gateway.candidateId
              : ""
          ),

    candidateRaw:
      call &&
      call.candidateRaw
        ? call.candidateRaw
        : (
            gateway
              ? gateway.candidateRaw
              : ""
          ),

    clientRaw:
      call &&
      call.clientRaw
        ? call.clientRaw
        : (
            gateway
              ? gateway.clientRaw
              : ""
          ),

    roundNo:
      call &&
      call.roundNo !== ""
        ? call.roundNo
        : (
            gateway
              ? gateway.roundNo
              : ""
          ),

    roundLabel:
      call &&
      call.roundLabel
        ? call.roundLabel
        : (
            gateway
              ? gateway.roundLabel
              : ""
          ),

    stageDescriptor:
      gateway
        ? gateway.stageDescriptor
        : ""

  };

}


function V2P2_logicalInterviewId_(
  source
){

  const candidateKey =
    source.candidateId
      ? String(
          source.candidateId
        ).trim()
      : (
          "RAW:" +
          V2P2_normalize_(
            source.candidateRaw
          )
        );

  const clientKey =
    V2P2_clientKey_(
      source.clientRaw
    ) ||
    "NO_CLIENT";

  const roundNo =
    source.roundNo === ""
      ? ""
      : String(
          source.roundNo
        ).trim();

  const stageKey =
    roundNo
      ? (
          "ROUND:" +
          roundNo
        )
      : (
          V2P2_normalize_(
            source.roundLabel
          ) ||
          V2P2_normalize_(
            source.stageDescriptor
          ) ||
          "UNSPECIFIED_STAGE"
        );

  const key = [
    candidateKey ||
      "NO_CANDIDATE",
    clientKey,
    stageKey
  ].join(
    "|"
  );

  return (
    "INT-" +
    V2P2_hash_(
      key
    )
      .substring(
        0,
        18
      )
      .toUpperCase()
  );

}


/******************************************************
 * PRIVATE — RECONCILIATION ROW
 ******************************************************/
function V2P2_buildReconciliation_(
  call
){

  return {

    reviewId:
      "REC-" +
      V2P2_hash_(
        call.callId +
        "|" +
        call.linkStatus
      )
        .substring(
          0,
          18
        )
        .toUpperCase(),

    callId:
      call.callId,

    businessDate:
      call.businessDate,

    businessDateKey:
      call.businessDateKey,

    teamDataRow:
      call.teamDataRow,

    teamDataRecord:
      call.teamDataRecord,

    candidateRaw:
      call.candidateRaw,

    candidateId:
      call.candidateId,

    officialCandidateName:
      call.officialCandidateName,

    clientRaw:
      call.clientRaw,

    roundLabel:
      call.roundLabel,

    roundNo:
      call.roundNo,

    timeNormalized:
      call.timeNormalized,

    handlerRaw:
      call.handlerRaw,

    operationalStatus:
      call.operationalStatus,

    outcomeStatus:
      call.outcomeStatus,

    linkStatus:
      call.linkStatus,

    bestScore:
      call.linkScore,

    secondBestScore:
      call.linkScore -
      call.linkMargin,

    margin:
      call.linkMargin,

bestGatewayId:
      call.reviewBestGatewayId ||
      call.linkedGatewayId,

    candidateGatewayIds:
      (
        call.candidateGatewayIds ||
        []
      ).join(
        " | "
      ),

    reason:
      call.reviewReason,

    createdAt:
      new Date()

  };

}


/******************************************************
 * PRIVATE — OPERATIONAL / OUTCOME STATUS
 ******************************************************/
function V2P2_operationalStatus_(
  columnCRaw,
  columnDRaw
){

  const c =
    V2P2_normalize_(
      columnCRaw
    );

  if(
    c === "cancelled" ||
    c === "canceled"
  ){
    return "CANCELLED";
  }

  if(
    c === "rescheduled"
  ){
    return "RESCHEDULED";
  }

  if(
    c === "support"
  ){
    return "SUPPORT";
  }

  if(c){
    return "ASSIGNED";
  }

  const d =
    V2P2_normalize_(
      columnDRaw
    );

  if(
    d === "selected" ||
    d === "in progress"
  ){
    return "UNASSIGNED";
  }

  return "UNASSIGNED";

}


function V2P2_outcomeStatus_(
  columnDRaw
){

  const value =
    V2P2_normalize_(
      columnDRaw
    );

  if(
    value === "selected"
  ){
    return "SELECTED";
  }

  if(
    value === "in progress"
  ){
    return "IN_PROGRESS";
  }

  return "";

}


function V2P2_handlerRaw_(
  columnCRaw
){

  const raw =
    String(
      columnCRaw || ""
    ).trim();

  const normalized =
    V2P2_normalize_(
      raw
    );

  if(
    !normalized ||
    normalized === "support" ||
    normalized === "rescheduled" ||
    normalized === "cancelled" ||
    normalized === "canceled"
  ){
    return "";
  }

  return raw;

}


/******************************************************
 * PRIVATE — HANDLER RESOLUTION
 ******************************************************/
function V2P2_buildHandlerIndex_(
  rows
){

  const byName = {};

  (rows || [])
    .forEach(
      function(row){

        const name =
          String(
            row["Handler Name"] || ""
          ).trim();

        const key =
          V2P2_normalize_(
            name
          );

        if(!key){
          return;
        }

        if(!byName[key]){
          byName[key] = [];
        }

        byName[key].push({
          handlerId:
            String(
              row["Handler ID"] || ""
            ).trim(),
          handlerName:
            name,
          teamId:
            String(
              row["Team ID"] || ""
            ).trim(),
          active:
            row["Active"]
        });

      }
    );

  return {
    byName:
      byName
  };

}


function V2P2_resolveHandler_(
  handlerRaw,
  index
){

  const key =
    V2P2_normalize_(
      handlerRaw
    );

  if(
    !key ||
    !index.byName[key] ||
    index.byName[key].length !== 1
  ){

    return {
      handlerId:
        "",
      handlerName:
        handlerRaw || "",
      teamId:
        ""
    };

  }

  return index.byName[key][0];

}


/******************************************************
 * PRIVATE — GROUP GATEWAY BY DATE
 ******************************************************/
function V2P2_groupGatewayByDate_(
  gateways
){

  const grouped = {};

  (gateways || [])
    .forEach(
      function(gateway){

        const key =
          gateway.businessDateKey ||
          "";

        if(!grouped[key]){
          grouped[key] = [];
        }

        grouped[key].push(
          gateway
        );

      }
    );

  return grouped;

}


function V2P2_hasExactGatewayText_(
  call,
  candidates
){

  const callText =
    V2P2_normalize_(
      call.teamDataRecord
    );

  if(!callText){
    return false;
  }

  return (
    candidates || []
  ).some(
    function(gateway){

      return (
        callText ===
        V2P2_normalize_(
          gateway.originalRecord
        )
      );

    }
  );

}


/******************************************************
 * PRIVATE — IDs
 ******************************************************/
function V2P2_occurrenceIdFromGateway_(
  gatewayId
){

  return (
    "OCC-" +
    V2P2_hash_(
      "GW|" +
      gatewayId
    )
      .substring(
        0,
        18
      )
      .toUpperCase()
  );

}


function V2P2_occurrenceIdFromCall_(
  callId
){

  return (
    "OCC-" +
    V2P2_hash_(
      "TEAM|" +
      callId
    )
      .substring(
        0,
        18
      )
      .toUpperCase()
  );

}


/******************************************************
 * PRIVATE — ROW SERIALIZERS
 ******************************************************/
function V2P2_callToRow_(
  call
){

  return [
    call.callId,
    call.businessDate,
    call.businessDateKey,
    call.teamDataRow,
    call.teamDataRecord,
    call.candidateRaw,
    call.candidateId,
    call.officialCandidateName,
    call.candidateMatchStatus,
    call.clientRaw,
    call.roundLabel,
    call.roundNo,
    call.interviewType,
    call.timeNormalized,
    call.startMinutes,
    call.durationMinutes,
    call.handlerRaw,
    call.handlerId,
    call.handlerName,
    call.teamId,
    call.operationalStatus,
    call.outcomeStatus,
    call.selectionConfirmedDate,
    call.linkedGatewayId,
    call.occurrenceId,
    call.logicalInterviewId,
    call.linkStatus,
    call.linkScore,
    call.linkMargin,
    call.linkReason,
    call.parseStatus,
    call.reviewReason,
    V2_PHASE2.VERSION,
    call.builtAt
  ];

}


function V2P2_occurrenceToRow_(
  occurrence
){

  return [
    occurrence.occurrenceId,
    occurrence.logicalInterviewId,
    occurrence.occurrenceSource,
    occurrence.gatewayId,
    occurrence.operationalCallId,
    occurrence.businessDate,
    occurrence.businessDateKey,
    occurrence.gatewaySourceSheet,
    occurrence.gatewaySourceRow,
    occurrence.teamDataRow,
    occurrence.candidateRaw,
    occurrence.gatewayCandidateId,
    occurrence.operationalCandidateId,
    occurrence.candidateId,
    occurrence.officialCandidateName,
    occurrence.clientRaw,
    occurrence.clientKey,
    occurrence.roundLabel,
    occurrence.roundNo,
    occurrence.stageDescriptor,
    occurrence.interviewType,
    occurrence.timeNormalized,
    occurrence.startMinutes,
    occurrence.durationMinutes,
    occurrence.handlerId,
    occurrence.handlerName,
    occurrence.teamId,
    occurrence.operationalStatus,
    occurrence.outcomeStatus,
    occurrence.selectionConfirmedDate,
    occurrence.parseStatus,
    occurrence.candidateMatchStatus,
    occurrence.linkStatus,
    occurrence.occurrenceStatus,
    occurrence.originalGatewayRecord,
    occurrence.teamDataRecord,
    V2_PHASE2.VERSION,
    occurrence.builtAt
  ];

}


function V2P2_reconciliationToRow_(
  item
){

  return [
    item.reviewId,
    item.callId,
    item.businessDate,
    item.businessDateKey,
    item.teamDataRow,
    item.teamDataRecord,
    item.candidateRaw,
    item.candidateId,
    item.officialCandidateName,
    item.clientRaw,
    item.roundLabel,
    item.roundNo,
    item.timeNormalized,
    item.handlerRaw,
    item.operationalStatus,
    item.outcomeStatus,
    item.linkStatus,
    item.bestScore,
    item.secondBestScore,
    item.margin,
    item.bestGatewayId,
    item.candidateGatewayIds,
    item.reason,
    V2_PHASE2.VERSION,
    item.createdAt
  ];

}


/******************************************************
 * PRIVATE — PHASE-2 SHEET HELPERS
 ******************************************************/
function V2P2_ensureSheet_(
  ss,
  sheetName,
  headers
){

  let sheet =
    ss.getSheetByName(
      sheetName
    );

  if(!sheet){

    sheet =
      ss.insertSheet(
        sheetName
      );

    sheet
      .getRange(
        1,
        1,
        1,
        headers.length
      )
      .setValues([
        headers
      ]);

    sheet.setFrozenRows(1);

    return sheet;
  }

  if(
    sheet.getLastRow() === 0
  ){

    sheet
      .getRange(
        1,
        1,
        1,
        headers.length
      )
      .setValues([
        headers
      ]);

    sheet.setFrozenRows(1);

    return sheet;
  }

  if(
    !V2P2_headersMatch_(
      sheet,
      headers
    )
  ){

    throw new Error(
      "V2P2_HEADER_MISMATCH|" +
      sheetName
    );

  }

  return sheet;

}


function V2P2_headersMatch_(
  sheet,
  headers
){

  if(
    sheet.getLastColumn() <
    headers.length
  ){
    return false;
  }

  const actual =
    sheet
      .getRange(
        1,
        1,
        1,
        headers.length
      )
      .getDisplayValues()[0]
      .map(
        function(value){
          return String(
            value || ""
          ).trim();
        }
      );

  for(
    let i = 0;
    i < headers.length;
    i++
  ){

    if(
      actual[i] !==
      headers[i]
    ){
      return false;
    }

  }

  return true;

}


function V2P2_formatHeader_(
  sheet,
  width
){

  sheet
    .getRange(
      1,
      1,
      1,
      width
    )
    .setFontWeight(
      "bold"
    )
    .setHorizontalAlignment(
      "center"
    );

  sheet.setFrozenRows(1);

}


function V2P2_replaceBody_(
  sheet,
  headers,
  rows
){

  if(
    sheet.getLastRow() > 1
  ){

    sheet
      .getRange(
        2,
        1,
        sheet.getLastRow() - 1,
        headers.length
      )
      .clearContent();

  }

  if(rows.length){

    sheet
      .getRange(
        2,
        1,
        rows.length,
        headers.length
      )
      .setValues(
        rows
      );

  }

}


function V2P2_readSheetObjects_(
  ss,
  def
){

  const sheet =
    ss.getSheetByName(
      def.name
    );

  if(!sheet){
    throw new Error(
      "V2P2_SHEET_NOT_FOUND|" +
      def.name
    );
  }

  if(
    !V2P2_headersMatch_(
      sheet,
      def.headers
    )
  ){
    throw new Error(
      "V2P2_HEADER_MISMATCH|" +
      def.name
    );
  }

  if(
    sheet.getLastRow() < 2
  ){
    return [];
  }

  const rows =
    sheet
      .getRange(
        2,
        1,
        sheet.getLastRow() - 1,
        def.headers.length
      )
      .getValues();

  return rows
    .filter(
      function(row){

        return row.some(
          function(value){

            return (
              String(
                value === null ||
                value === undefined
                  ? ""
                  : value
              ).trim() !== ""
            );

          }
        );

      }
    )
    .map(
      function(row){

        const object = {};

        def.headers.forEach(
          function(header,index){
            object[header] =
              row[index];
          }
        );

        return object;

      }
    );

}


/******************************************************
 * PRIVATE — BUSINESS-DAY SEMANTICS
 *
 * IMPORTANT:
 * Phase 2 intentionally does NOT derive a different date
 * from Start Minutes / AM-PM time.
 *
 * Business Date Key comes only from the carried-forward
 * source date header. This preserves the mixed-day work
 * window (D afternoon/evening -> D+1 early morning).
 ******************************************************/


/******************************************************
 * PRIVATE — CANONICAL BUSINESS DATE KEY
 *
 * Google Sheets can return a visually formatted
 * yyyy-MM-dd cell as a Date object. Phase 2 must compare
 * Team Data and Gateway using one canonical key:
 * yyyy-MM-dd.
 ******************************************************/
function V2P2_businessDateKey_(
  primaryValue,
  fallbackValue
){

  const values = [
    primaryValue,
    fallbackValue
  ];

  for(
    let i = 0;
    i < values.length;
    i++
  ){

    const value =
      values[i];

    if(
      Object.prototype.toString.call(
        value
      ) === "[object Date]" &&
      !isNaN(
        value.getTime()
      )
    ){

      return Utilities.formatDate(
        value,
        Session.getScriptTimeZone(),
        "yyyy-MM-dd"
      );

    }

    const text =
      String(
        value === null ||
        value === undefined
          ? ""
          : value
      ).trim();

    if(!text){
      continue;
    }

    const iso =
      text.match(
        /^(\d{4})-(\d{2})-(\d{2})$/
      );

    if(iso){

      return (
        iso[1] +
        "-" +
        iso[2] +
        "-" +
        iso[3]
      );

    }

    const parsed =
      new Date(
        text
      );

    if(
      !isNaN(
        parsed.getTime()
      )
    ){

      return Utilities.formatDate(
        parsed,
        Session.getScriptTimeZone(),
        "yyyy-MM-dd"
      );

    }

  }

  return "";

}


/******************************************************
 * PRIVATE — DATE HELPERS
 ******************************************************/
function V2P2_dateInfo_(
  value,
  displayValue
){

  if(
    Object.prototype.toString.call(
      value
    ) === "[object Date]" &&
    !isNaN(
      value.getTime()
    )
  ){

    return {
      date:
        new Date(
          value.getTime()
        ),
      key:
        Utilities.formatDate(
          value,
          Session.getScriptTimeZone(),
          "yyyy-MM-dd"
        )
    };

  }

  const display =
    String(
      displayValue || ""
    ).trim();

  // Only parse unambiguous textual forms.
  // Ambiguous numeric 08/09/2026 is deliberately not guessed.
  const iso =
    display.match(
      /^(\d{4})-(\d{2})-(\d{2})$/
    );

  if(iso){

    const date =
      new Date(
        Number(
          iso[1]
        ),
        Number(
          iso[2]
        ) - 1,
        Number(
          iso[3]
        )
      );

    return {
      date:
        date,
      key:
        iso[1] +
        "-" +
        iso[2] +
        "-" +
        iso[3]
    };

  }

  const monthName =
    display.match(
      /^(\d{1,2})[\s-]+([A-Za-z]{3,9})[\s-]+(\d{4})$/
    );

  if(monthName){

    const parsed =
      new Date(
        display
      );

    if(
      !isNaN(
        parsed.getTime()
      )
    ){

      return {
        date:
          parsed,
        key:
          Utilities.formatDate(
            parsed,
            Session.getScriptTimeZone(),
            "yyyy-MM-dd"
          )
      };

    }

  }

  return {
    date:
      null,
    key:
      ""
  };

}


function V2P2_dateValue_(
  value
){

  if(
    Object.prototype.toString.call(
      value
    ) === "[object Date]" &&
    !isNaN(
      value.getTime()
    )
  ){
    return new Date(
      value.getTime()
    );
  }

  return "";

}


/******************************************************
 * PRIVATE — CLIENT KEY
 *
 * Not canonicalization.
 * This is only a normalized technical key.
 ******************************************************/
function V2P2_clientKey_(
  value
){

  return V2P2_normalize_(
    value
  );

}


/******************************************************
 * PRIVATE — NORMALIZATION / SCORE
 ******************************************************/
function V2P2_normalize_(
  value
){

  let text =
    String(
      value || ""
    )
      .trim()
      .toLowerCase();

  if(!text){
    return "";
  }

  try{
    text =
      text.normalize(
        "NFKD"
      );
  }catch(error){
    // Safe fallback.
  }

  text =
    text.replace(
      /[\u0300-\u036f]/g,
      ""
    );

  text =
    text.replace(
      /[^a-z0-9]+/g,
      " "
    );

  text =
    text.replace(
      /\s+/g,
      " "
    ).trim();

  return text;

}


function V2P2_similarity_(
  left,
  right
){

  const a =
    String(
      left || ""
    );

  const b =
    String(
      right || ""
    );

  const maxLength =
    Math.max(
      a.length,
      b.length
    );

  if(maxLength === 0){
    return 100;
  }

  const distance =
    V2P2_levenshtein_(
      a,
      b
    );

  return Math.round(
    (
      1 -
      distance /
      maxLength
    ) *
    10000
  ) /
  100;

}


function V2P2_levenshtein_(
  leftValue,
  rightValue
){

  const left =
    String(
      leftValue || ""
    );

  const right =
    String(
      rightValue || ""
    );

  const rows =
    left.length + 1;

  const cols =
    right.length + 1;

  const matrix = [];

  for(
    let i = 0;
    i < rows;
    i++
  ){

    matrix[i] = [];

    for(
      let j = 0;
      j < cols;
      j++
    ){

      if(i === 0){
        matrix[i][j] = j;
      }else if(j === 0){
        matrix[i][j] = i;
      }else{
        matrix[i][j] = 0;
      }

    }

  }

  for(
    let i = 1;
    i < rows;
    i++
  ){

    for(
      let j = 1;
      j < cols;
      j++
    ){

      const cost =
        left.charAt(
          i - 1
        ) ===
        right.charAt(
          j - 1
        )
          ? 0
          : 1;

      matrix[i][j] =
        Math.min(
          matrix[i - 1][j] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j - 1] +
            cost
        );

    }

  }

  return matrix[
    rows - 1
  ][
    cols - 1
  ];

}


function V2P2_numberOrBlank_(
  value
){

  if(
    value === "" ||
    value === null ||
    value === undefined
  ){
    return "";
  }

  const number =
    Number(
      value
    );

  return Number.isFinite(
    number
  )
    ? number
    : "";

}


function V2P2_count_(
  map,
  key
){

  const safeKey =
    String(
      key || "BLANK"
    );

  map[safeKey] =
    (
      map[safeKey] || 0
    ) + 1;

}


/******************************************************
 * PRIVATE — SHA-256
 ******************************************************/
function V2P2_hash_(
  value
){

  const bytes =
    Utilities.computeDigest(
      Utilities.DigestAlgorithm.SHA_256,
      String(
        value || ""
      ),
      Utilities.Charset.UTF_8
    );

  return bytes
    .map(
      function(byte){

        const value =
          (
            byte < 0
              ? byte + 256
              : byte
          )
          .toString(
            16
          );

        return value.length === 1
          ? "0" + value
          : value;

      }
    )
    .join(
      ""
    );

}


/******************************************************
 * PRIVATE — SYNTHETIC HELPERS
 ******************************************************/
function V2P2_syntheticGateway_(
  gatewayId,
  businessDateKey,
  candidateId,
  candidateRaw,
  clientRaw,
  roundLabel,
  roundNo,
  startMinutes,
  interviewType,
  originalRecord
){

  return {
    gatewayId:
      gatewayId,
    businessDate:
      "",
    businessDateKey:
      businessDateKey,
    sourceSheet:
      "Raw Data",
    sourceRow:
      1,
    originalRecord:
      originalRecord,
    candidateRaw:
      candidateRaw,
    candidateId:
      candidateId,
    officialCandidateName:
      candidateRaw,
    candidateMatchStatus:
      "AUTO_EXACT_NORMALIZED",
    clientRaw:
      clientRaw,
    clientSuggested:
      "",
    roundLabel:
      roundLabel,
    roundNo:
      roundNo,
    stageDescriptor:
      "",
    interviewType:
      interviewType,
    timeNormalized:
      "",
    startMinutes:
      startMinutes,
    durationMinutes:
      30,
    parseStatus:
      "READY"
  };

}


function V2P2_syntheticCall_(
  businessDateKey,
  candidateId,
  candidateRaw,
  clientRaw,
  roundLabel,
  roundNo,
  startMinutes,
  interviewType,
  originalRecord
){

  return {
    callId:
      "CALL-SYN",
    businessDate:
      "",
    businessDateKey:
      businessDateKey,
    teamDataRow:
      1,
    teamDataRecord:
      originalRecord,
    candidateRaw:
      candidateRaw,
    candidateId:
      candidateId,
    officialCandidateName:
      candidateRaw,
    candidateMatchStatus:
      "AUTO_EXACT_NORMALIZED",
    clientRaw:
      clientRaw,
    roundLabel:
      roundLabel,
    roundNo:
      roundNo,
    interviewType:
      interviewType,
    timeNormalized:
      "",
    startMinutes:
      startMinutes,
    durationMinutes:
      30,
    handlerRaw:
      "Handler",
    handlerId:
      "",
    handlerName:
      "Handler",
    teamId:
      "",
    operationalStatus:
      "ASSIGNED",
    outcomeStatus:
      "",
    selectionConfirmedDate:
      "",
    parseStatus:
      "READY"
  };

}
