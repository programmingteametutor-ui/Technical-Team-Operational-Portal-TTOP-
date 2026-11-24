/******************************************************
 * V2_Phase3.gs
 * Interview Operations Portal V2
 * Private Backend — Phase 3
 * Candidate Timeline + Candidate 360 Shadow Layer
 *
 * VERSION
 * -------
 * V2-PHASE3-CANDIDATE360-1.0.1
 *
 * PURPOSE
 * -------
 * Build a candidate-centric read model on top of the
 * verified Phase 2 shadow layer:
 *
 *   V2 Interview Occurrences
 *        -> V2 Candidate Events
 *        -> V2 Candidate 360
 *        -> V2 Logical Interviews
 *
 * IMPORTANT DATA RULES
 * --------------------
 * 1) Every dated Phase-2 occurrence is preserved.
 * 2) Same candidate/client/round on different business
 *    dates is NOT deduplicated.
 * 3) Logical Interview ID remains the Phase-2 grouping:
 *    Candidate + Client + Stage/Round.
 * 4) Operational status and outcome status remain
 *    separate. CANCELLED/RESCHEDULED never imply outcome.
 * 5) SELECTED remains an outcome and, where available,
 *    Selection Confirmed Date is preserved.
 * 6) Business Date Key from Phase 2 is authoritative.
 *    Phase 3 never reassigns an after-midnight record to a
 *    different business-day block.
 *
 * EVENT-LEDGER RULE
 * -----------------
 * Phase 3 records OBSERVED CURRENT FACTS. It does not
 * invent historical transition timestamps that are not
 * available in the source data.
 *
 * SAFETY
 * ------
 * Phase 3 NEVER writes:
 * - Raw Data
 * - Team Data
 * - Call Tracker / scheduler sheets
 * - current incentive/recovery sheets
 * - Phase-2 sheets
 * - portal authentication data
 *
 * Phase 3 writes ONLY:
 * - V2 Candidate Events   (already provisioned by Phase 1)
 * - V2 Candidate 360      (new Phase-3 sheet)
 * - V2 Logical Interviews (new Phase-3 sheet)
 ******************************************************/


const V2_PHASE3 =
  Object.freeze({

    VERSION:
      "V2-PHASE3-CANDIDATE360-1.0.1",

    PHASE2_SHEETS:
      Object.freeze({

        OPERATIONAL_CALLS:
          "V2 Operational Calls",

        OCCURRENCES:
          "V2 Interview Occurrences",

        RECONCILIATION:
          "V2 Occurrence Reconciliation"

      }),

    SHEETS:
      Object.freeze({

        CANDIDATE_EVENTS:
          "V2 Candidate Events",

        CANDIDATE_360:
          "V2 Candidate 360",

        LOGICAL_INTERVIEWS:
          "V2 Logical Interviews"

      }),

    // Used ONLY for ordering records within the SAME
    // carried-forward business-day block. It does not
    // change Business Date Key.
    AFTER_MIDNIGHT_CARRY_CUTOFF_MINUTES:
      360,

    PREVIEW_LIMIT:
      20

  });


/******************************************************
 * PHASE-3 SHEET DEFINITIONS
 ******************************************************/
function V2P3_sheetDefinitions_(){

  return {

    CANDIDATE_EVENTS: {
      name:
        V2_PHASE3.SHEETS.CANDIDATE_EVENTS,
      headers: [
        "Event ID",
        "Candidate ID",
        "Team ID",
        "Event DateTime",
        "Event Type",
        "Client",
        "Round Label",
        "Round No",
        "Handler ID",
        "Handler Name",
        "Call ID",
        "Source",
        "Source Row",
        "Status",
        "Details",
        "Created At"
      ]
    },

    CANDIDATE_360: {
      name:
        V2_PHASE3.SHEETS.CANDIDATE_360,
      headers: [
        "Subject Key",
        "Candidate ID",
        "Official Candidate Name",
        "Candidate Raw",
        "Identity Status",
        "Latest Handler Team ID",
        "Total Occurrences",
        "Operational Occurrences",
        "Raw Only Occurrences",
        "Team Review Occurrences",
        "Assigned",
        "Support",
        "Rescheduled",
        "Cancelled",
        "Unassigned",
        "In Progress",
        "Selected",
        "Distinct Clients",
        "Distinct Logical Interviews",
        "First Business Date",
        "Latest Business Date",
        "Latest Client",
        "Latest Round",
        "Latest Handler ID",
        "Latest Handler Name",
        "Latest Operational Status",
        "Latest Outcome Status",
        "Open Review Count",
        "Latest Occurrence ID",
        "Phase3 Version",
        "Built At"
      ]
    },

    LOGICAL_INTERVIEWS: {
      name:
        V2_PHASE3.SHEETS.LOGICAL_INTERVIEWS,
      headers: [
        "Logical Interview ID",
        "Subject Key",
        "Candidate ID",
        "Official Candidate Name",
        "Client",
        "Round Label",
        "Round No",
        "Stage Descriptor",
        "Occurrence Count",
        "Operational Occurrences",
        "Raw Only Occurrences",
        "Review Occurrences",
        "First Business Date",
        "Latest Business Date",
        "Latest Occurrence ID",
        "Latest Handler ID",
        "Latest Handler Name",
        "Latest Operational Status",
        "Latest Outcome Status",
        "Selected",
        "Phase3 Version",
        "Built At"
      ]
    }

  };

}


/******************************************************
 * REQUIRED PHASE-2 OCCURRENCE COLUMNS
 *
 * We intentionally depend on the STORED Phase-2 schema,
 * not on private Phase-2 helper functions.
 ******************************************************/
function V2P3_requiredOccurrenceHeaders_(){

  return [
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
    "Candidate ID",
    "Official Candidate Name",
    "Client Raw",
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
    "Occurrence Status"
  ];

}


/******************************************************
 * PUBLIC 1 — PHASE-3 READ-ONLY HEALTH CHECK
 *
 * Writes NOTHING.
 ******************************************************/
function V2P3_testPhase3HealthReadOnly(){

  const backendAvailable =
    typeof V2_backend_ ===
      "function";

  let backendName = "";
  let phase2OccurrenceSheetFound = false;
  let phase2OccurrenceRows = 0;
  let phase2HeadersOk = false;
  let candidateEventsFound = false;
  let candidateEventsHeadersOk = false;
  let candidate360Found = false;
  let logicalInterviewsFound = false;

  if(backendAvailable){

    const ss =
      V2_backend_();

    backendName =
      ss.getName();

    const occurrenceSheet =
      ss.getSheetByName(
        V2_PHASE3.PHASE2_SHEETS.OCCURRENCES
      );

    phase2OccurrenceSheetFound =
      !!occurrenceSheet;

    if(occurrenceSheet){

      phase2OccurrenceRows =
        Math.max(
          0,
          occurrenceSheet.getLastRow() - 1
        );

      phase2HeadersOk =
        V2P3_sheetContainsHeaders_(
          occurrenceSheet,
          V2P3_requiredOccurrenceHeaders_()
        );

    }

    const defs =
      V2P3_sheetDefinitions_();

    const eventSheet =
      ss.getSheetByName(
        defs.CANDIDATE_EVENTS.name
      );

    candidateEventsFound =
      !!eventSheet;

    candidateEventsHeadersOk =
      !!eventSheet &&
      V2P3_headersMatch_(
        eventSheet,
        defs.CANDIDATE_EVENTS.headers
      );

    candidate360Found =
      !!ss.getSheetByName(
        defs.CANDIDATE_360.name
      );

    logicalInterviewsFound =
      !!ss.getSheetByName(
        defs.LOGICAL_INTERVIEWS.name
      );

  }

  const result = {

    ok:
      (
        backendAvailable &&
        phase2OccurrenceSheetFound &&
        phase2HeadersOk &&
        phase2OccurrenceRows > 0 &&
        candidateEventsFound &&
        candidateEventsHeadersOk
      ),

    mode:
      "READ_ONLY",

    phase3Version:
      V2_PHASE3.VERSION,

    backendAvailable:
      backendAvailable,

    backend:
      backendName,

    phase2OccurrenceSheetFound:
      phase2OccurrenceSheetFound,

    phase2OccurrenceRows:
      phase2OccurrenceRows,

    phase2HeadersOk:
      phase2HeadersOk,

    candidateEventsFound:
      candidateEventsFound,

    candidateEventsHeadersOk:
      candidateEventsHeadersOk,

    candidate360Found:
      candidate360Found,

    logicalInterviewsFound:
      logicalInterviewsFound,

    phase2StoredVerifyAvailable:
      (
        typeof V2P2_verifyStoredOperationalShadowReadOnly ===
          "function"
      )

  };

  V2P3_logResult_(
    "V2 PHASE 3 HEALTH",
    result
  );

  return result;

}


/******************************************************
 * PUBLIC 2 — PURE SYNTHETIC CANDIDATE-TIMELINE TESTS
 *
 * No Spreadsheet reads/writes.
 ******************************************************/
function V2P3_testCandidateTimelineSyntheticReadOnly(){

  const dateA =
    "2026-08-15";

  const dateB =
    "2026-08-16";

  const rows = [

    V2P3_syntheticOccurrence_(
      "OCC-A1",
      "INT-R1",
      "GATEWAY_AND_TEAM",
      dateA,
      "CAN-001",
      "Ravi Kumar",
      "Ravi Kumar",
      "Acme",
      "1st Round",
      1,
      1260,
      "9:00 PM",
      "H-1",
      "Bharat",
      "TEAM-HYD",
      "ASSIGNED",
      "IN_PROGRESS",
      "LINKED_EXACT",
      "OPERATIONAL"
    ),

    // Same logical interview, another dated occurrence.
    V2P3_syntheticOccurrence_(
      "OCC-A2",
      "INT-R1",
      "GATEWAY_AND_TEAM",
      dateB,
      "CAN-001",
      "Ravi Kumar",
      "Ravi Kumar",
      "Acme",
      "1st Round",
      1,
      1410,
      "11:30 PM",
      "H-1",
      "Bharat",
      "TEAM-HYD",
      "RESCHEDULED",
      "IN_PROGRESS",
      "LINKED_EXACT",
      "OPERATIONAL"
    ),

    // Same candidate, different round = separate logical interview.
    V2P3_syntheticOccurrence_(
      "OCC-A3",
      "INT-R2",
      "GATEWAY_AND_TEAM",
      dateB,
      "CAN-001",
      "Ravi Kumar",
      "Ravi Kumar",
      "Acme",
      "2nd Round",
      2,
      90,
      "1:30 AM",
      "H-2",
      "Naresh",
      "TEAM-HYD",
      "ASSIGNED",
      "SELECTED",
      "LINKED_STRONG",
      "OPERATIONAL",
      new Date(2026,7,17)
    ),

    // Raw-only source occurrence is preserved.
    V2P3_syntheticOccurrence_(
      "OCC-B1",
      "INT-B1",
      "GATEWAY_ONLY",
      dateA,
      "CAN-002",
      "Anu Reddy",
      "Anu Reddy",
      "Beta",
      "1st Round",
      1,
      1200,
      "8:00 PM",
      "",
      "",
      "",
      "NOT_OPERATIONAL",
      "",
      "RAW_ONLY",
      "RAW_ONLY"
    ),

    // Two unresolved names must not merge into one subject.
    V2P3_syntheticOccurrence_(
      "OCC-U1",
      "INT-U1",
      "TEAM_ONLY",
      dateA,
      "",
      "Unknown One",
      "",
      "Gamma",
      "1st Round",
      1,
      1140,
      "7:00 PM",
      "",
      "",
      "",
      "UNASSIGNED",
      "IN_PROGRESS",
      "REVIEW_NO_GATEWAY_MATCH",
      "TEAM_ONLY_REVIEW"
    ),

    V2P3_syntheticOccurrence_(
      "OCC-U2",
      "INT-U2",
      "TEAM_ONLY",
      dateA,
      "",
      "Unknown Two",
      "",
      "Gamma",
      "1st Round",
      1,
      1170,
      "7:30 PM",
      "",
      "",
      "",
      "UNASSIGNED",
      "IN_PROGRESS",
      "REVIEW_NO_GATEWAY_MATCH",
      "TEAM_ONLY_REVIEW"
    ),

    // Cross-date ordering must prioritize business date
    // before clock time. Earlier date at 11:30 PM must not
    // sort after a later date at 7:00 PM.
    V2P3_syntheticOccurrence_(
      "OCC-D1",
      "INT-D1",
      "GATEWAY_ONLY",
      dateA,
      "CAN-003",
      "Date Test",
      "Date Test",
      "Delta",
      "1st Round",
      1,
      1410,
      "11:30 PM",
      "",
      "",
      "",
      "NOT_OPERATIONAL",
      "",
      "RAW_ONLY",
      "RAW_ONLY"
    ),

    V2P3_syntheticOccurrence_(
      "OCC-D2",
      "INT-D2",
      "GATEWAY_ONLY",
      dateB,
      "CAN-003",
      "Date Test",
      "Date Test",
      "Echo",
      "2nd Round",
      2,
      1140,
      "7:00 PM",
      "",
      "",
      "",
      "NOT_OPERATIONAL",
      "",
      "RAW_ONLY",
      "RAW_ONLY"
    )

  ];

  // Simulate Google Sheets returning Business Date Key
  // as a real Date object instead of yyyy-MM-dd text.
  rows[
    rows.length - 1
  ]["Business Date Key"] =
    new Date(
      2026,
      7,
      16
    );

  const model =
    V2P3_buildModelFromOccurrences_(
      rows
    );

  const modelAgain =
    V2P3_buildModelFromOccurrences_(
      rows
    );

  const ravi =
    model.candidates.filter(
      function(item){
        return item.candidateId === "CAN-001";
      }
    )[0];

  const anu =
    model.candidates.filter(
      function(item){
        return item.candidateId === "CAN-002";
      }
    )[0];

  const dateTest =
    model.candidates.filter(
      function(item){
        return item.candidateId === "CAN-003";
      }
    )[0];

  const normalizedDateObjectOccurrence =
    model.occurrences.filter(
      function(item){
        return item.occurrenceId === "OCC-D2";
      }
    )[0];

  const raviLogical =
    model.logicalInterviews.filter(
      function(item){
        return item.candidateId === "CAN-001";
      }
    );

  const unresolved =
    model.candidates.filter(
      function(item){
        return item.identityStatus === "REVIEW_UNRESOLVED";
      }
    );

  const eventIds =
    model.events.map(
      function(item){
        return item.eventId;
      }
    );

  const eventIdsAgain =
    modelAgain.events.map(
      function(item){
        return item.eventId;
      }
    );

  const selectedEvents =
    model.events.filter(
      function(item){
        return item.eventType === "SELECTION_RECORDED";
      }
    );

  const checks = [

    {
      name:
        "same candidate groups across multiple business dates",
      ok:
        !!ravi &&
        ravi.totalOccurrences === 3
    },

    {
      name:
        "dated occurrences remain separate",
      ok:
        model.occurrenceCount === rows.length
    },

    {
      name:
        "different round remains separate logical interview",
      ok:
        raviLogical.length === 2
    },

    {
      name:
        "rescheduled stays operational while outcome stays separate",
      ok:
        !!ravi &&
        ravi.rescheduled === 1 &&
        ravi.selected === 1
    },

    {
      name:
        "selected produces separate selection fact event",
      ok:
        selectedEvents.length === 1 &&
        selectedEvents[0].status === "SELECTED"
    },

    {
      name:
        "raw-only source occurrence remains represented",
      ok:
        !!anu &&
        anu.rawOnlyOccurrences === 1
    },

    {
      name:
        "unresolved candidate names do not collapse together",
      ok:
        unresolved.length === 2 &&
        unresolved[0].subjectKey !== unresolved[1].subjectKey
    },

    {
      name:
        "1:30 AM sorts after prior-night 11:30 PM inside same business day",
      ok:
        !!ravi &&
        ravi.latestOccurrenceId === "OCC-A3"
    },

    {
      name:
        "later business date sorts after earlier date regardless of clock time",
      ok:
        !!dateTest &&
        dateTest.latestOccurrenceId === "OCC-D2"
    },

    {
      name:
        "Google Sheets Date object business key normalizes to yyyy-MM-dd",
      ok:
        !!normalizedDateObjectOccurrence &&
        normalizedDateObjectOccurrence.businessDateKey ===
          dateB
    },

    {
      name:
        "event IDs are deterministic",
      ok:
        JSON.stringify(eventIds) ===
        JSON.stringify(eventIdsAgain)
    },

    {
      name:
        "event IDs are unique",
      ok:
        V2P3_uniqueCount_(eventIds) ===
        eventIds.length
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
      passed === checks.length,

    mode:
      "READ_ONLY_SYNTHETIC",

    phase3Version:
      V2_PHASE3.VERSION,

    passed:
      passed,

    total:
      checks.length,

    checks:
      checks

  };

  V2P3_logResult_(
    "V2 PHASE 3 SYNTHETIC",
    result
  );

  return result;

}


/******************************************************
 * PUBLIC 3 — REAL READ-ONLY CANDIDATE-360 PREVIEW
 *
 * Reads stored Phase-2 occurrences.
 * Writes NOTHING.
 ******************************************************/
function V2P3_previewCandidate360ReadOnly(){

  const occurrences =
    V2P3_readStoredPhase2Occurrences_();

  const model =
    V2P3_buildModelFromOccurrences_(
      occurrences
    );

  const result =
    V2P3_modelSummary_(
      model,
      "READ_ONLY"
    );

  V2P3_logResult_(
    "V2 PHASE 3 REAL PREVIEW",
    result
  );

  return result;

}


/******************************************************
 * PUBLIC 4 — SETUP PHASE-3 SHEETS
 *
 * Candidate Events must already exist from Phase 1.
 * Creates/verifies ONLY the two new Phase-3 sheets.
 ******************************************************/
function V2P3_setupPhase3Sheets(){

  const ss =
    V2P3_backend_();

  const defs =
    V2P3_sheetDefinitions_();

  const eventSheet =
    ss.getSheetByName(
      defs.CANDIDATE_EVENTS.name
    );

  if(!eventSheet){
    throw new Error(
      "V2P3_CANDIDATE_EVENTS_NOT_FOUND|run=V2_setupFoundation"
    );
  }

  if(
    !V2P3_headersMatch_(
      eventSheet,
      defs.CANDIDATE_EVENTS.headers
    )
  ){
    throw new Error(
      "V2P3_HEADER_MISMATCH|" +
      defs.CANDIDATE_EVENTS.name
    );
  }

  const result = {

    ok:
      true,

    phase3Version:
      V2_PHASE3.VERSION,

    created: [],

    verified: [
      defs.CANDIDATE_EVENTS.name
    ]

  };

  [
    defs.CANDIDATE_360,
    defs.LOGICAL_INTERVIEWS
  ].forEach(
    function(def){

      const existing =
        ss.getSheetByName(
          def.name
        );

      const sheet =
        V2P3_ensureSheet_(
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

      V2P3_formatHeader_(
        sheet,
        def.headers.length
      );

    }
  );

  V2P3_formatHeader_(
    eventSheet,
    defs.CANDIDATE_EVENTS.headers.length
  );

  V2P3_logResult_(
    "V2 PHASE 3 SHEET SETUP",
    result
  );

  return result;

}


/******************************************************
 * PUBLIC 5 — PHASE-3 SHADOW REBUILD
 *
 * Writes ONLY:
 * - V2 Candidate Events
 * - V2 Candidate 360
 * - V2 Logical Interviews
 ******************************************************/
function V2P3_rebuildCandidateTimelineShadow(){

  const started =
    Date.now();

  const ss =
    V2P3_backend_();

  const defs =
    V2P3_sheetDefinitions_();

  V2P3_assertWritablePhase3Sheets_(
    ss,
    defs
  );

  const occurrences =
    V2P3_readStoredPhase2Occurrences_();

  const model =
    V2P3_buildModelFromOccurrences_(
      occurrences
    );

  V2P3_replaceBody_(
    ss.getSheetByName(
      defs.CANDIDATE_EVENTS.name
    ),
    defs.CANDIDATE_EVENTS.headers,
    model.events.map(
      V2P3_eventToRow_
    )
  );

  V2P3_replaceBody_(
    ss.getSheetByName(
      defs.CANDIDATE_360.name
    ),
    defs.CANDIDATE_360.headers,
    model.candidates.map(
      V2P3_candidate360ToRow_
    )
  );

  V2P3_replaceBody_(
    ss.getSheetByName(
      defs.LOGICAL_INTERVIEWS.name
    ),
    defs.LOGICAL_INTERVIEWS.headers,
    model.logicalInterviews.map(
      V2P3_logicalInterviewToRow_
    )
  );

  const result =
    V2P3_modelSummary_(
      model,
      "WRITE_SHADOW"
    );

  result.elapsedMs =
    Date.now() - started;

  V2P3_logResult_(
    "V2 PHASE 3 SHADOW REBUILD",
    result
  );

  return result;

}


/******************************************************
 * PUBLIC 6 — STORED PHASE-3 VERIFICATION
 *
 * Read-only after rebuild.
 ******************************************************/
function V2P3_verifyStoredCandidateTimelineReadOnly(){

  const ss =
    V2P3_backend_();

  const defs =
    V2P3_sheetDefinitions_();

  V2P3_assertWritablePhase3Sheets_(
    ss,
    defs
  );

  const storedEvents =
    V2P3_readSheetObjectsExact_(
      ss,
      defs.CANDIDATE_EVENTS
    );

  const storedCandidates =
    V2P3_readSheetObjectsExact_(
      ss,
      defs.CANDIDATE_360
    );

  const storedLogical =
    V2P3_readSheetObjectsExact_(
      ss,
      defs.LOGICAL_INTERVIEWS
    );

  const occurrences =
    V2P3_readStoredPhase2Occurrences_();

  const expected =
    V2P3_buildModelFromOccurrences_(
      occurrences
    );

  const duplicateEventIds =
    V2P3_duplicateCountByField_(
      storedEvents,
      "Event ID"
    );

  const duplicateSubjectKeys =
    V2P3_duplicateCountByField_(
      storedCandidates,
      "Subject Key"
    );

  const duplicateLogicalIds =
    V2P3_duplicateCountByField_(
      storedLogical,
      "Logical Interview ID"
    );

  const expectedEventIds =
    expected.events.map(
      function(item){
        return item.eventId;
      }
    ).sort();

  const storedEventIds =
    storedEvents.map(
      function(item){
        return String(
          item["Event ID"] || ""
        ).trim();
      }
    ).sort();

  const eventIdSetMatches =
    JSON.stringify(
      expectedEventIds
    ) ===
    JSON.stringify(
      storedEventIds
    );

  const ok =
    (
      storedEvents.length ===
        expected.events.length &&
      storedCandidates.length ===
        expected.candidates.length &&
      storedLogical.length ===
        expected.logicalInterviews.length &&
      duplicateEventIds === 0 &&
      duplicateSubjectKeys === 0 &&
      duplicateLogicalIds === 0 &&
      eventIdSetMatches
    );

  const result = {

    ok:
      ok,

    mode:
      "READ_ONLY",

    phase3Version:
      V2_PHASE3.VERSION,

    phase2Occurrences:
      occurrences.length,

    expectedEvents:
      expected.events.length,

    storedEvents:
      storedEvents.length,

    expectedCandidates:
      expected.candidates.length,

    storedCandidates:
      storedCandidates.length,

    expectedLogicalInterviews:
      expected.logicalInterviews.length,

    storedLogicalInterviews:
      storedLogical.length,

    duplicateEventIds:
      duplicateEventIds,

    duplicateSubjectKeys:
      duplicateSubjectKeys,

    duplicateLogicalInterviewIds:
      duplicateLogicalIds,

    eventIdSetMatches:
      eventIdSetMatches

  };

  V2P3_logResult_(
    "V2 PHASE 3 STORED VERIFY",
    result
  );

  return result;

}


/******************************************************
 * PRIVATE — READ STORED PHASE-2 OCCURRENCES
 ******************************************************/
function V2P3_readStoredPhase2Occurrences_(){

  const ss =
    V2P3_backend_();

  const sheetName =
    V2_PHASE3.PHASE2_SHEETS.OCCURRENCES;

  const sheet =
    ss.getSheetByName(
      sheetName
    );

  if(!sheet){
    throw new Error(
      "V2P3_PHASE2_OCCURRENCES_NOT_FOUND|" +
      sheetName +
      "|run=V2P2_rebuildOperationalShadow"
    );
  }

  const required =
    V2P3_requiredOccurrenceHeaders_();

  if(
    !V2P3_sheetContainsHeaders_(
      sheet,
      required
    )
  ){
    throw new Error(
      "V2P3_PHASE2_OCCURRENCE_SCHEMA_MISMATCH|" +
      sheetName
    );
  }

  const lastRow =
    sheet.getLastRow();

  const lastColumn =
    sheet.getLastColumn();

  if(lastRow < 2){
    return [];
  }

  const headers =
    sheet
      .getRange(
        1,
        1,
        1,
        lastColumn
      )
      .getDisplayValues()[0]
      .map(
        function(value){
          return String(
            value || ""
          ).trim();
        }
      );

  const values =
    sheet
      .getRange(
        2,
        1,
        lastRow - 1,
        lastColumn
      )
      .getValues();

  const rows = [];

  values.forEach(
    function(row,index){

      if(
        !row.some(
          function(value){
            return V2P3_hasValue_(
              value
            );
          }
        )
      ){
        return;
      }

      const object = {};

      headers.forEach(
        function(header,columnIndex){
          if(header){
            object[header] =
              row[columnIndex];
          }
        }
      );

      object.__sourceRow =
        index + 2;

      rows.push(
        object
      );

    }
  );

  return rows;

}


/******************************************************
 * PRIVATE — BUILD COMPLETE PHASE-3 MODEL
 ******************************************************/
function V2P3_buildModelFromOccurrences_(
  sourceRows
){

  const occurrences =
    (sourceRows || [])
      .map(
        V2P3_normalizeOccurrence_
      );

  const events = [];
  const candidateGroups = {};
  const logicalGroups = {};

  occurrences.forEach(
    function(occurrence){

      const subjectKey =
        V2P3_subjectKey_(
          occurrence
        );

      occurrence.subjectKey =
        subjectKey;

      if(!candidateGroups[subjectKey]){
        candidateGroups[subjectKey] = [];
      }

      candidateGroups[subjectKey].push(
        occurrence
      );

      const logicalId =
        occurrence.logicalInterviewId ||
        (
          "UNRESOLVED-" +
          occurrence.occurrenceId
        );

      if(!logicalGroups[logicalId]){
        logicalGroups[logicalId] = [];
      }

      logicalGroups[logicalId].push(
        occurrence
      );

      events.push(
        V2P3_buildOccurrenceEvent_(
          occurrence
        )
      );

      if(
        occurrence.outcomeStatus ===
          "SELECTED"
      ){
        events.push(
          V2P3_buildSelectionEvent_(
            occurrence
          )
        );
      }

    }
  );

  const candidates =
    Object.keys(
      candidateGroups
    )
      .map(
        function(subjectKey){
          return V2P3_buildCandidate360_(
            subjectKey,
            candidateGroups[subjectKey]
          );
        }
      )
      .sort(
        V2P3_candidateSummarySort_
      );

  const logicalInterviews =
    Object.keys(
      logicalGroups
    )
      .map(
        function(logicalId){
          return V2P3_buildLogicalInterview_(
            logicalId,
            logicalGroups[logicalId]
          );
        }
      )
      .sort(
        V2P3_logicalSummarySort_
      );

  events.sort(
    V2P3_eventSort_
  );

  return {

    occurrenceCount:
      occurrences.length,

    occurrences:
      occurrences,

    events:
      events,

    candidates:
      candidates,

    logicalInterviews:
      logicalInterviews

  };

}


/******************************************************
 * PRIVATE — NORMALIZE PHASE-2 OCCURRENCE
 ******************************************************/
function V2P3_normalizeOccurrence_(
  row
){

  const candidateId =
    V2P3_text_(
      row["Candidate ID"]
    );

  const officialName =
    V2P3_text_(
      row["Official Candidate Name"]
    );

  const candidateRaw =
    V2P3_text_(
      row["Candidate Raw"]
    );

  // Google Sheets may return a yyyy-MM-dd-looking cell
  // as a real Date object depending on the column format.
  // Normalize BEFORE converting to text so chronology does
  // not collapse to clock-time-only ordering.
  const businessDateKey =
    V2P3_dateKey_(
      row["Business Date Key"]
    ) ||
    V2P3_dateKey_(
      row["Business Date"]
    );

  const businessDate =
    V2P3_dateOrBlank_(
      row["Business Date"]
    ) ||
    V2P3_dateFromKeyOrBlank_(
      businessDateKey
    );

  const startMinutes =
    V2P3_numberOrBlank_(
      row["Start Minutes"]
    );

  return {

    occurrenceId:
      V2P3_text_(
        row["Occurrence ID"]
      ),

    logicalInterviewId:
      V2P3_text_(
        row["Logical Interview ID"]
      ),

    occurrenceSource:
      V2P3_text_(
        row["Occurrence Source"]
      ),

    gatewayId:
      V2P3_text_(
        row["Gateway ID"]
      ),

    callId:
      V2P3_text_(
        row["Operational Call ID"]
      ),

    businessDate:
      businessDate,

    businessDateKey:
      businessDateKey,

    gatewaySourceSheet:
      V2P3_text_(
        row["Gateway Source Sheet"]
      ),

    gatewaySourceRow:
      V2P3_numberOrBlank_(
        row["Gateway Source Row"]
      ),

    teamDataRow:
      V2P3_numberOrBlank_(
        row["Team Data Row"]
      ),

    candidateRaw:
      candidateRaw,

    candidateId:
      candidateId,

    officialCandidateName:
      officialName,

    clientRaw:
      V2P3_text_(
        row["Client Raw"]
      ),

    roundLabel:
      V2P3_text_(
        row["Round Label"]
      ),

    roundNo:
      V2P3_numberOrBlank_(
        row["Round No"]
      ),

    stageDescriptor:
      V2P3_text_(
        row["Stage Descriptor"]
      ),

    interviewType:
      V2P3_text_(
        row["Interview Type"]
      ),

    timeNormalized:
      V2P3_text_(
        row["Time Normalized"]
      ),

    startMinutes:
      startMinutes,

    durationMinutes:
      V2P3_numberOrBlank_(
        row["Duration Minutes"]
      ),

    handlerId:
      V2P3_text_(
        row["Handler ID"]
      ),

    handlerName:
      V2P3_text_(
        row["Handler Name"]
      ),

    teamId:
      V2P3_text_(
        row["Team ID"]
      ),

    operationalStatus:
      V2P3_text_(
        row["Operational Status"]
      ),

    outcomeStatus:
      V2P3_text_(
        row["Outcome Status"]
      ),

    selectionConfirmedDate:
      V2P3_dateOrBlank_(
        row["Selection Confirmed Date"]
      ),

    parseStatus:
      V2P3_text_(
        row["Parse Status"]
      ),

    candidateMatchStatus:
      V2P3_text_(
        row["Candidate Match Status"]
      ),

    linkStatus:
      V2P3_text_(
        row["Link Status"]
      ),

    occurrenceStatus:
      V2P3_text_(
        row["Occurrence Status"]
      ),

    sourceRow:
      Number(
        row.__sourceRow || 0
      ),

    businessSortValue:
      V2P3_businessSortValue_(
        businessDateKey,
        startMinutes,
        Number(
          row.__sourceRow || 0
        )
      ),

    subjectKey:
      ""

  };

}


/******************************************************
 * PRIVATE — SUBJECT IDENTITY
 ******************************************************/
function V2P3_subjectKey_(
  occurrence
){

  if(
    occurrence.candidateId
  ){
    return (
      "CID:" +
      occurrence.candidateId
    );
  }

  const rawKey =
    V2P3_normalize_(
      occurrence.officialCandidateName ||
      occurrence.candidateRaw
    );

  if(rawKey){
    return (
      "RAW:" +
      rawKey
    );
  }

  return (
    "OCC:" +
    occurrence.occurrenceId
  );

}


/******************************************************
 * PRIVATE — CANDIDATE EVENT BUILDERS
 ******************************************************/
function V2P3_buildOccurrenceEvent_(
  occurrence
){

  const eventId =
    "EVT-" +
    V2P3_hash_(
      "OCCURRENCE|" +
      occurrence.occurrenceId
    )
      .substring(
        0,
        20
      )
      .toUpperCase();

  const status =
    occurrence.operationalStatus ||
    occurrence.occurrenceStatus ||
    "OBSERVED";

  const details =
    V2P3_details_([
      [
        "Occurrence",
        occurrence.occurrenceId
      ],
      [
        "LogicalInterview",
        occurrence.logicalInterviewId
      ],
      [
        "BusinessDate",
        occurrence.businessDateKey
      ],
      [
        "Time",
        occurrence.timeNormalized
      ],
      [
        "Outcome",
        occurrence.outcomeStatus
      ],
      [
        "Link",
        occurrence.linkStatus
      ],
      [
        "OccurrenceStatus",
        occurrence.occurrenceStatus
      ],
      [
        "Identity",
        occurrence.candidateId
          ? "RESOLVED"
          : "REVIEW_UNRESOLVED"
      ]
    ]);

  return {

    eventId:
      eventId,

    candidateId:
      occurrence.candidateId,

    teamId:
      occurrence.teamId,

    // This is the authoritative BUSINESS DATE as an
    // observed fact. We deliberately do not synthesize an
    // actual timestamp from an after-midnight clock time.
    eventDateTime:
      occurrence.businessDate ||
      V2P3_dateFromKeyOrBlank_(
        occurrence.businessDateKey
      ),

    eventType:
      "INTERVIEW_OCCURRENCE",

    client:
      occurrence.clientRaw,

    roundLabel:
      occurrence.roundLabel ||
      occurrence.stageDescriptor,

    roundNo:
      occurrence.roundNo,

    handlerId:
      occurrence.handlerId,

    handlerName:
      occurrence.handlerName,

    callId:
      occurrence.callId,

    source:
      V2_PHASE3.PHASE2_SHEETS.OCCURRENCES,

    sourceRow:
      occurrence.sourceRow,

    status:
      status,

    details:
      details,

    createdAt:
      new Date(),

    sortValue:
      occurrence.businessSortValue,

    occurrenceId:
      occurrence.occurrenceId

  };

}


function V2P3_buildSelectionEvent_(
  occurrence
){

  const eventId =
    "EVT-" +
    V2P3_hash_(
      "SELECTION|" +
      occurrence.occurrenceId
    )
      .substring(
        0,
        20
      )
      .toUpperCase();

  const details =
    V2P3_details_([
      [
        "Occurrence",
        occurrence.occurrenceId
      ],
      [
        "LogicalInterview",
        occurrence.logicalInterviewId
      ],
      [
        "BusinessDate",
        occurrence.businessDateKey
      ],
      [
        "SelectionConfirmedDate",
        V2P3_dateKey_(
          occurrence.selectionConfirmedDate
        )
      ]
    ]);

  return {

    eventId:
      eventId,

    candidateId:
      occurrence.candidateId,

    teamId:
      occurrence.teamId,

    eventDateTime:
      occurrence.selectionConfirmedDate ||
      "",

    eventType:
      "SELECTION_RECORDED",

    client:
      occurrence.clientRaw,

    roundLabel:
      occurrence.roundLabel ||
      occurrence.stageDescriptor,

    roundNo:
      occurrence.roundNo,

    handlerId:
      occurrence.handlerId,

    handlerName:
      occurrence.handlerName,

    callId:
      occurrence.callId,

    source:
      V2_PHASE3.PHASE2_SHEETS.OCCURRENCES,

    sourceRow:
      occurrence.sourceRow,

    status:
      "SELECTED",

    details:
      details,

    createdAt:
      new Date(),

    sortValue:
      occurrence.businessSortValue + 0.5,

    occurrenceId:
      occurrence.occurrenceId

  };

}


/******************************************************
 * PRIVATE — CANDIDATE 360 SUMMARY
 ******************************************************/
function V2P3_buildCandidate360_(
  subjectKey,
  group
){

  const occurrences =
    (group || [])
      .slice()
      .sort(
        V2P3_occurrenceSort_
      );

  const first =
    occurrences[0] || {};

  const latest =
    occurrences[
      occurrences.length - 1
    ] || {};

  const candidateId =
    V2P3_firstNonBlank_(
      occurrences,
      "candidateId"
    );

  const officialName =
    V2P3_latestNonBlank_(
      occurrences,
      "officialCandidateName"
    ) ||
    V2P3_latestNonBlank_(
      occurrences,
      "candidateRaw"
    );

  const candidateRaw =
    V2P3_latestNonBlank_(
      occurrences,
      "candidateRaw"
    );

  const statusCounts = {};
  const outcomeCounts = {};

  let operationalOccurrences = 0;
  let rawOnlyOccurrences = 0;
  let teamReviewOccurrences = 0;
  let openReviewCount = 0;

  const clients = {};
  const logicalIds = {};

  occurrences.forEach(
    function(item){

      V2P3_count_(
        statusCounts,
        item.operationalStatus ||
          "BLANK"
      );

      V2P3_count_(
        outcomeCounts,
        item.outcomeStatus ||
          "BLANK"
      );

      if(
        item.occurrenceStatus ===
          "OPERATIONAL"
      ){
        operationalOccurrences++;
      }

      if(
        item.occurrenceStatus ===
          "RAW_ONLY"
      ){
        rawOnlyOccurrences++;
      }

      if(
        item.occurrenceStatus ===
          "TEAM_ONLY_REVIEW"
      ){
        teamReviewOccurrences++;
      }

      if(
        V2P3_occurrenceNeedsReview_(
          item
        )
      ){
        openReviewCount++;
      }

      const clientKey =
        V2P3_normalize_(
          item.clientRaw
        );

      if(clientKey){
        clients[clientKey] = true;
      }

      if(
        item.logicalInterviewId
      ){
        logicalIds[
          item.logicalInterviewId
        ] = true;
      }

    }
  );

  return {

    subjectKey:
      subjectKey,

    candidateId:
      candidateId,

    officialCandidateName:
      officialName,

    candidateRaw:
      candidateRaw,

    identityStatus:
      candidateId
        ? "RESOLVED"
        : "REVIEW_UNRESOLVED",

    latestHandlerTeamId:
      latest.teamId || "",

    totalOccurrences:
      occurrences.length,

    operationalOccurrences:
      operationalOccurrences,

    rawOnlyOccurrences:
      rawOnlyOccurrences,

    teamReviewOccurrences:
      teamReviewOccurrences,

    assigned:
      statusCounts.ASSIGNED || 0,

    support:
      statusCounts.SUPPORT || 0,

    rescheduled:
      statusCounts.RESCHEDULED || 0,

    cancelled:
      statusCounts.CANCELLED || 0,

    unassigned:
      statusCounts.UNASSIGNED || 0,

    inProgress:
      outcomeCounts.IN_PROGRESS || 0,

    selected:
      outcomeCounts.SELECTED || 0,

    distinctClients:
      Object.keys(
        clients
      ).length,

    distinctLogicalInterviews:
      Object.keys(
        logicalIds
      ).length,

    firstBusinessDate:
      first.businessDate ||
      V2P3_dateFromKeyOrBlank_(
        first.businessDateKey
      ),

    latestBusinessDate:
      latest.businessDate ||
      V2P3_dateFromKeyOrBlank_(
        latest.businessDateKey
      ),

    latestClient:
      latest.clientRaw || "",

    latestRound:
      latest.roundLabel ||
      latest.stageDescriptor ||
      "",

    latestHandlerId:
      latest.handlerId || "",

    latestHandlerName:
      latest.handlerName || "",

    latestOperationalStatus:
      latest.operationalStatus || "",

    latestOutcomeStatus:
      latest.outcomeStatus || "",

    openReviewCount:
      openReviewCount,

    latestOccurrenceId:
      latest.occurrenceId || "",

    builtAt:
      new Date(),

    latestSortValue:
      latest.businessSortValue || 0

  };

}


/******************************************************
 * PRIVATE — LOGICAL INTERVIEW SUMMARY
 ******************************************************/
function V2P3_buildLogicalInterview_(
  logicalId,
  group
){

  const occurrences =
    (group || [])
      .slice()
      .sort(
        V2P3_occurrenceSort_
      );

  const first =
    occurrences[0] || {};

  const latest =
    occurrences[
      occurrences.length - 1
    ] || {};

  let operationalOccurrences = 0;
  let rawOnlyOccurrences = 0;
  let reviewOccurrences = 0;
  let selected = false;

  occurrences.forEach(
    function(item){

      if(
        item.occurrenceStatus ===
          "OPERATIONAL"
      ){
        operationalOccurrences++;
      }

      if(
        item.occurrenceStatus ===
          "RAW_ONLY"
      ){
        rawOnlyOccurrences++;
      }

      if(
        V2P3_occurrenceNeedsReview_(
          item
        )
      ){
        reviewOccurrences++;
      }

      if(
        item.outcomeStatus ===
          "SELECTED"
      ){
        selected = true;
      }

    }
  );

  return {

    logicalInterviewId:
      logicalId,

    subjectKey:
      latest.subjectKey ||
      first.subjectKey ||
      "",

    candidateId:
      V2P3_firstNonBlank_(
        occurrences,
        "candidateId"
      ),

    officialCandidateName:
      V2P3_latestNonBlank_(
        occurrences,
        "officialCandidateName"
      ) ||
      V2P3_latestNonBlank_(
        occurrences,
        "candidateRaw"
      ),

    client:
      V2P3_latestNonBlank_(
        occurrences,
        "clientRaw"
      ),

    roundLabel:
      V2P3_latestNonBlank_(
        occurrences,
        "roundLabel"
      ),

    roundNo:
      V2P3_latestNonBlankValue_(
        occurrences,
        "roundNo"
      ),

    stageDescriptor:
      V2P3_latestNonBlank_(
        occurrences,
        "stageDescriptor"
      ),

    occurrenceCount:
      occurrences.length,

    operationalOccurrences:
      operationalOccurrences,

    rawOnlyOccurrences:
      rawOnlyOccurrences,

    reviewOccurrences:
      reviewOccurrences,

    firstBusinessDate:
      first.businessDate ||
      V2P3_dateFromKeyOrBlank_(
        first.businessDateKey
      ),

    latestBusinessDate:
      latest.businessDate ||
      V2P3_dateFromKeyOrBlank_(
        latest.businessDateKey
      ),

    latestOccurrenceId:
      latest.occurrenceId || "",

    latestHandlerId:
      latest.handlerId || "",

    latestHandlerName:
      latest.handlerName || "",

    latestOperationalStatus:
      latest.operationalStatus || "",

    latestOutcomeStatus:
      latest.outcomeStatus || "",

    selected:
      selected
        ? "YES"
        : "NO",

    builtAt:
      new Date(),

    latestSortValue:
      latest.businessSortValue || 0

  };

}


/******************************************************
 * PRIVATE — MODEL SUMMARY
 ******************************************************/
function V2P3_modelSummary_(
  model,
  mode
){

  const operationalStatus = {};
  const outcomeStatus = {};
  const occurrenceStatus = {};
  const identityStatus = {};

  let reviewOccurrences = 0;
  let selectedOccurrences = 0;

  model.occurrences.forEach(
    function(item){

      V2P3_count_(
        operationalStatus,
        item.operationalStatus ||
          "BLANK"
      );

      V2P3_count_(
        outcomeStatus,
        item.outcomeStatus ||
          "BLANK"
      );

      V2P3_count_(
        occurrenceStatus,
        item.occurrenceStatus ||
          "BLANK"
      );

      if(
        V2P3_occurrenceNeedsReview_(
          item
        )
      ){
        reviewOccurrences++;
      }

      if(
        item.outcomeStatus ===
          "SELECTED"
      ){
        selectedOccurrences++;
      }

    }
  );

  model.candidates.forEach(
    function(item){
      V2P3_count_(
        identityStatus,
        item.identityStatus
      );
    }
  );

  const previewCandidates =
    model.candidates
      .slice()
      .sort(
        function(a,b){
          return (
            b.totalOccurrences -
            a.totalOccurrences
          ) ||
          V2P3_candidateSummarySort_(
            a,
            b
          );
        }
      )
      .slice(
        0,
        V2_PHASE3.PREVIEW_LIMIT
      )
      .map(
        function(item){
          return {
            subjectKey:
              item.subjectKey,
            candidateId:
              item.candidateId,
            name:
              item.officialCandidateName ||
              item.candidateRaw,
            identityStatus:
              item.identityStatus,
            occurrences:
              item.totalOccurrences,
            logicalInterviews:
              item.distinctLogicalInterviews,
            rescheduled:
              item.rescheduled,
            cancelled:
              item.cancelled,
            selected:
              item.selected,
            openReviewCount:
              item.openReviewCount,
            latestBusinessDate:
              V2P3_dateKey_(
                item.latestBusinessDate
              ),
            latestClient:
              item.latestClient,
            latestRound:
              item.latestRound,
            latestHandler:
              item.latestHandlerName
          };
        }
      );

  const reviewExamples =
    model.occurrences
      .filter(
        V2P3_occurrenceNeedsReview_
      )
      .slice(
        0,
        V2_PHASE3.PREVIEW_LIMIT
      )
      .map(
        function(item){
          return {
            occurrenceId:
              item.occurrenceId,
            businessDateKey:
              item.businessDateKey,
            candidateId:
              item.candidateId,
            candidateRaw:
              item.candidateRaw,
            client:
              item.clientRaw,
            round:
              item.roundLabel,
            operationalStatus:
              item.operationalStatus,
            outcomeStatus:
              item.outcomeStatus,
            linkStatus:
              item.linkStatus,
            occurrenceStatus:
              item.occurrenceStatus
          };
        }
      );

  return {

    ok:
      (
        model.events.length >=
          model.occurrences.length &&
        model.candidates.length >= 0 &&
        model.logicalInterviews.length >= 0
      ),

    mode:
      mode,

    phase3Version:
      V2_PHASE3.VERSION,

    occurrences:
      model.occurrences.length,

    candidateEvents:
      model.events.length,

    candidates:
      model.candidates.length,

    logicalInterviews:
      model.logicalInterviews.length,

    selectedOccurrences:
      selectedOccurrences,

    reviewOccurrences:
      reviewOccurrences,

    operationalStatus:
      operationalStatus,

    outcomeStatus:
      outcomeStatus,

    occurrenceStatus:
      occurrenceStatus,

    identityStatus:
      identityStatus,

    candidateExamples:
      previewCandidates,

    reviewExamples:
      reviewExamples

  };

}


/******************************************************
 * PRIVATE — REVIEW RULE
 ******************************************************/
function V2P3_occurrenceNeedsReview_(
  item
){

  const link =
    String(
      item.linkStatus || ""
    ).toUpperCase();

  return (
    item.occurrenceStatus ===
      "TEAM_ONLY_REVIEW" ||
    link.indexOf(
      "REVIEW_"
    ) === 0
  );

}


/******************************************************
 * PRIVATE — BUSINESS-DAY ORDERING
 *
 * Business Date Key is NEVER changed.
 * Early-AM times are shifted only in a numeric sort key
 * so 1:30 AM follows 11:30 PM inside the same business
 * date block.
 ******************************************************/
function V2P3_businessSortValue_(
  businessDateKey,
  startMinutes,
  sourceRow
){

  const datePart =
    V2P3_dateOrdinal_(
      businessDateKey
    );

  let minutePart =
    V2P3_numberOrBlank_(
      startMinutes
    );

  if(minutePart === ""){
    minutePart = 9999;
  }else if(
    minutePart <
    V2_PHASE3.AFTER_MIDNIGHT_CARRY_CUTOFF_MINUTES
  ){
    minutePart += 1440;
  }

  const rowPart =
    Number(
      sourceRow || 0
    ) / 1000000;

  return (
    datePart * 10000 +
    minutePart +
    rowPart
  );

}


function V2P3_dateOrdinal_(
  key
){

  const normalizedKey =
    V2P3_dateKey_(
      key
    );

  const match =
    String(
      normalizedKey || ""
    ).match(
      /^(\d{4})-(\d{2})-(\d{2})$/
    );

  if(!match){
    return 0;
  }

  return Math.floor(
    Date.UTC(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3])
    ) /
    86400000
  );

}


/******************************************************
 * PRIVATE — SORT HELPERS
 ******************************************************/
function V2P3_occurrenceSort_(
  a,
  b
){

  if(
    a.businessSortValue !==
    b.businessSortValue
  ){
    return (
      a.businessSortValue -
      b.businessSortValue
    );
  }

  return String(
    a.occurrenceId || ""
  ).localeCompare(
    String(
      b.occurrenceId || ""
    )
  );

}


function V2P3_eventSort_(
  a,
  b
){

  if(
    a.sortValue !==
    b.sortValue
  ){
    return (
      a.sortValue -
      b.sortValue
    );
  }

  return String(
    a.eventId || ""
  ).localeCompare(
    String(
      b.eventId || ""
    )
  );

}


function V2P3_candidateSummarySort_(
  a,
  b
){

  const nameA =
    V2P3_normalize_(
      a.officialCandidateName ||
      a.candidateRaw ||
      a.subjectKey
    );

  const nameB =
    V2P3_normalize_(
      b.officialCandidateName ||
      b.candidateRaw ||
      b.subjectKey
    );

  return (
    nameA.localeCompare(
      nameB
    ) ||
    String(
      a.subjectKey || ""
    ).localeCompare(
      String(
        b.subjectKey || ""
      )
    )
  );

}


function V2P3_logicalSummarySort_(
  a,
  b
){

  if(
    a.latestSortValue !==
    b.latestSortValue
  ){
    return (
      a.latestSortValue -
      b.latestSortValue
    );
  }

  return String(
    a.logicalInterviewId || ""
  ).localeCompare(
    String(
      b.logicalInterviewId || ""
    )
  );

}


/******************************************************
 * PRIVATE — ROW SERIALIZERS
 ******************************************************/
function V2P3_eventToRow_(
  item
){

  return [
    item.eventId,
    item.candidateId,
    item.teamId,
    item.eventDateTime,
    item.eventType,
    item.client,
    item.roundLabel,
    item.roundNo,
    item.handlerId,
    item.handlerName,
    item.callId,
    item.source,
    item.sourceRow,
    item.status,
    item.details,
    item.createdAt
  ];

}


function V2P3_candidate360ToRow_(
  item
){

  return [
    item.subjectKey,
    item.candidateId,
    item.officialCandidateName,
    item.candidateRaw,
    item.identityStatus,
    item.latestHandlerTeamId,
    item.totalOccurrences,
    item.operationalOccurrences,
    item.rawOnlyOccurrences,
    item.teamReviewOccurrences,
    item.assigned,
    item.support,
    item.rescheduled,
    item.cancelled,
    item.unassigned,
    item.inProgress,
    item.selected,
    item.distinctClients,
    item.distinctLogicalInterviews,
    item.firstBusinessDate,
    item.latestBusinessDate,
    item.latestClient,
    item.latestRound,
    item.latestHandlerId,
    item.latestHandlerName,
    item.latestOperationalStatus,
    item.latestOutcomeStatus,
    item.openReviewCount,
    item.latestOccurrenceId,
    V2_PHASE3.VERSION,
    item.builtAt
  ];

}


function V2P3_logicalInterviewToRow_(
  item
){

  return [
    item.logicalInterviewId,
    item.subjectKey,
    item.candidateId,
    item.officialCandidateName,
    item.client,
    item.roundLabel,
    item.roundNo,
    item.stageDescriptor,
    item.occurrenceCount,
    item.operationalOccurrences,
    item.rawOnlyOccurrences,
    item.reviewOccurrences,
    item.firstBusinessDate,
    item.latestBusinessDate,
    item.latestOccurrenceId,
    item.latestHandlerId,
    item.latestHandlerName,
    item.latestOperationalStatus,
    item.latestOutcomeStatus,
    item.selected,
    V2_PHASE3.VERSION,
    item.builtAt
  ];

}


/******************************************************
 * PRIVATE — PHASE-3 SHEET SAFETY
 ******************************************************/
function V2P3_assertWritablePhase3Sheets_(
  ss,
  defs
){

  [
    defs.CANDIDATE_EVENTS,
    defs.CANDIDATE_360,
    defs.LOGICAL_INTERVIEWS
  ].forEach(
    function(def){

      const sheet =
        ss.getSheetByName(
          def.name
        );

      if(!sheet){
        throw new Error(
          "V2P3_SHEET_NOT_FOUND|" +
          def.name +
          "|run=V2P3_setupPhase3Sheets"
        );
      }

      if(
        !V2P3_headersMatch_(
          sheet,
          def.headers
        )
      ){
        throw new Error(
          "V2P3_HEADER_MISMATCH|" +
          def.name
        );
      }

    }
  );

}


function V2P3_ensureSheet_(
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
    !V2P3_headersMatch_(
      sheet,
      headers
    )
  ){
    throw new Error(
      "V2P3_HEADER_MISMATCH|" +
      sheetName
    );
  }

  return sheet;

}


function V2P3_headersMatch_(
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


function V2P3_sheetContainsHeaders_(
  sheet,
  requiredHeaders
){

  if(
    sheet.getLastColumn() < 1
  ){
    return false;
  }

  const headers =
    sheet
      .getRange(
        1,
        1,
        1,
        sheet.getLastColumn()
      )
      .getDisplayValues()[0]
      .map(
        function(value){
          return String(
            value || ""
          ).trim();
        }
      );

  const index = {};

  headers.forEach(
    function(header){
      if(header){
        index[header] = true;
      }
    }
  );

  return (
    requiredHeaders || []
  ).every(
    function(header){
      return !!index[header];
    }
  );

}


function V2P3_formatHeader_(
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


function V2P3_replaceBody_(
  sheet,
  headers,
  rows
){

  const oldBodyRows =
    Math.max(
      0,
      sheet.getLastRow() - 1
    );

  if(oldBodyRows > 0){
    sheet
      .getRange(
        2,
        1,
        oldBodyRows,
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


function V2P3_readSheetObjectsExact_(
  ss,
  def
){

  const sheet =
    ss.getSheetByName(
      def.name
    );

  if(!sheet){
    throw new Error(
      "V2P3_SHEET_NOT_FOUND|" +
      def.name
    );
  }

  if(
    !V2P3_headersMatch_(
      sheet,
      def.headers
    )
  ){
    throw new Error(
      "V2P3_HEADER_MISMATCH|" +
      def.name
    );
  }

  if(
    sheet.getLastRow() < 2
  ){
    return [];
  }

  const values =
    sheet
      .getRange(
        2,
        1,
        sheet.getLastRow() - 1,
        def.headers.length
      )
      .getValues();

  return values
    .filter(
      function(row){
        return row.some(
          V2P3_hasValue_
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
 * PRIVATE — BACKEND ROUTER
 ******************************************************/
function V2P3_backend_(){

  if(
    typeof V2_backend_ !==
      "function"
  ){
    throw new Error(
      "V2P3_BACKEND_ROUTER_NOT_FOUND|Phase1_required"
    );
  }

  return V2_backend_();

}


/******************************************************
 * PRIVATE — VALUE / DATE HELPERS
 ******************************************************/
function V2P3_text_(
  value
){

  return String(
    value === null ||
    value === undefined
      ? ""
      : value
  ).trim();

}


function V2P3_hasValue_(
  value
){

  if(
    value === null ||
    value === undefined
  ){
    return false;
  }

  if(
    Object.prototype.toString.call(
      value
    ) === "[object Date]"
  ){
    return !isNaN(
      value.getTime()
    );
  }

  return String(
    value
  ).trim() !== "";

}


function V2P3_numberOrBlank_(
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


function V2P3_dateOrBlank_(
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

  const key =
    V2P3_dateKey_(
      value
    );

  return key
    ? V2P3_dateFromKeyOrBlank_(
        key
      )
    : "";

}


function V2P3_dateFromKeyOrBlank_(
  key
){

  const match =
    String(
      key || ""
    ).match(
      /^(\d{4})-(\d{2})-(\d{2})$/
    );

  if(!match){
    return "";
  }

  return new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3])
  );

}


function V2P3_dateKey_(
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
    return "";
  }

  // Already-normalized authoritative key.
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

  // Apps Script / Google Sheets can stringify a Date cell
  // as e.g. "Tue Jul 21 2026 00:00:00 GMT+0530 (...)"
  // when a previously date-formatted key column is read.
  // This form is unambiguous because it contains a month
  // name, four-digit year and explicit GMT offset.
  const dateStringPattern =
    /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat)\s+[A-Za-z]{3}\s+\d{1,2}\s+\d{4}\s+\d{2}:\d{2}:\d{2}\s+GMT[+-]\d{4}/i;

  if(
    dateStringPattern.test(
      text
    )
  ){
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
 * PRIVATE — GROUP HELPERS
 ******************************************************/
function V2P3_firstNonBlank_(
  rows,
  field
){

  for(
    let i = 0;
    i < rows.length;
    i++
  ){
    const value =
      V2P3_text_(
        rows[i][field]
      );
    if(value){
      return value;
    }
  }

  return "";

}


function V2P3_latestNonBlank_(
  rows,
  field
){

  for(
    let i = rows.length - 1;
    i >= 0;
    i--
  ){
    const value =
      V2P3_text_(
        rows[i][field]
      );
    if(value){
      return value;
    }
  }

  return "";

}


function V2P3_latestNonBlankValue_(
  rows,
  field
){

  for(
    let i = rows.length - 1;
    i >= 0;
    i--
  ){
    const value =
      rows[i][field];

    if(
      value !== "" &&
      value !== null &&
      value !== undefined
    ){
      return value;
    }
  }

  return "";

}


function V2P3_count_(
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


function V2P3_uniqueCount_(
  values
){

  const seen = {};

  (values || [])
    .forEach(
      function(value){
        seen[
          String(value)
        ] = true;
      }
    );

  return Object.keys(
    seen
  ).length;

}


function V2P3_duplicateCountByField_(
  rows,
  field
){

  const seen = {};
  let duplicates = 0;

  (rows || [])
    .forEach(
      function(row){

        const value =
          V2P3_text_(
            row[field]
          );

        if(!value){
          duplicates++;
          return;
        }

        if(seen[value]){
          duplicates++;
        }

        seen[value] = true;

      }
    );

  return duplicates;

}


/******************************************************
 * PRIVATE — DETAILS STRING
 ******************************************************/
function V2P3_details_(
  pairs
){

  return (pairs || [])
    .filter(
      function(pair){
        return (
          pair &&
          pair.length >= 2 &&
          V2P3_hasValue_(
            pair[1]
          )
        );
      }
    )
    .map(
      function(pair){
        return (
          String(pair[0]) +
          "=" +
          V2P3_text_(
            pair[1]
          )
        );
      }
    )
    .join(
      " | "
    );

}


/******************************************************
 * PRIVATE — NORMALIZATION
 ******************************************************/
function V2P3_normalize_(
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
    // Safe fallback for Apps Script environments.
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

  return text
    .replace(
      /\s+/g,
      " "
    )
    .trim();

}


/******************************************************
 * PRIVATE — SHA-256
 ******************************************************/
function V2P3_hash_(
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
        const normalized =
          byte < 0
            ? byte + 256
            : byte;
        return (
          "0" +
          normalized.toString(16)
        ).slice(-2);
      }
    )
    .join("");

}


/******************************************************
 * PRIVATE — STRUCTURED LOGGER
 ******************************************************/
function V2P3_logResult_(
  title,
  result
){

  const border =
    "========== " +
    title +
    " ==========";

  Logger.log(
    border
  );

  Logger.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );

  Logger.log(
    "=".repeat(
      border.length
    )
  );

}


/******************************************************
 * PRIVATE — SYNTHETIC OCCURRENCE FACTORY
 ******************************************************/
function V2P3_syntheticOccurrence_(
  occurrenceId,
  logicalInterviewId,
  occurrenceSource,
  businessDateKey,
  candidateId,
  candidateRaw,
  officialName,
  client,
  roundLabel,
  roundNo,
  startMinutes,
  timeNormalized,
  handlerId,
  handlerName,
  teamId,
  operationalStatus,
  outcomeStatus,
  linkStatus,
  occurrenceStatus,
  selectionConfirmedDate
){

  const row = {
    "Occurrence ID":
      occurrenceId,
    "Logical Interview ID":
      logicalInterviewId,
    "Occurrence Source":
      occurrenceSource,
    "Gateway ID":
      "",
    "Operational Call ID":
      "CALL-" + occurrenceId,
    "Business Date":
      V2P3_dateFromKeyOrBlank_(
        businessDateKey
      ),
    "Business Date Key":
      businessDateKey,
    "Gateway Source Sheet":
      "Raw Data",
    "Gateway Source Row":
      1,
    "Team Data Row":
      1,
    "Candidate Raw":
      candidateRaw,
    "Candidate ID":
      candidateId,
    "Official Candidate Name":
      officialName,
    "Client Raw":
      client,
    "Round Label":
      roundLabel,
    "Round No":
      roundNo,
    "Stage Descriptor":
      "",
    "Interview Type":
      "Interview",
    "Time Normalized":
      timeNormalized,
    "Start Minutes":
      startMinutes,
    "Duration Minutes":
      30,
    "Handler ID":
      handlerId,
    "Handler Name":
      handlerName,
    "Team ID":
      teamId,
    "Operational Status":
      operationalStatus,
    "Outcome Status":
      outcomeStatus,
    "Selection Confirmed Date":
      selectionConfirmedDate || "",
    "Parse Status":
      "READY",
    "Candidate Match Status":
      candidateId
        ? "MATCHED"
        : "REVIEW",
    "Link Status":
      linkStatus,
    "Occurrence Status":
      occurrenceStatus,
    __sourceRow:
      1
  };

  return row;

}
