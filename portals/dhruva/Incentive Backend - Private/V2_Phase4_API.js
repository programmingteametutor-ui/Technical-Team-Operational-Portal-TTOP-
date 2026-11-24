/******************************************************
 * V2 PHASE 4 — PORTAL READ API
 * Version: V2-PHASE4-PORTAL-API-1.0.1
 *
 * INSTALL LOCATION:
 *   Incentive Backend - Private
 *
 * PURPOSE
 * -------
 * Safe read-only service layer over the verified
 * Phase-2 / Phase-3 shadow data.
 *
 * DATA FLOW
 * ---------
 * V2 Interview Occurrences
 * V2 Occurrence Reconciliation
 * V2 Candidate Events
 * V2 Candidate 360
 * V2 Logical Interviews
 *              ↓
 *        V2 Phase 4 API
 *              ↓
 *   Interview Portal Control (later bridge)
 *
 * SAFETY
 * ------
 * THIS FILE WRITES NOTHING.
 * It does NOT modify:
 * - Raw Data
 * - Team Data
 * - Call Tracker
 * - scheduler sheets / logic
 * - incentive / recovery sheets
 * - Phase-2 sheets
 * - Phase-3 sheets
 * - portal authentication data
 *
 * SECURITY BOUNDARY
 * -----------------
 * These functions belong in the PRIVATE backend.
 * Do not expose them directly to browser/client code.
 * Interview Portal Control must remain the server-side
 * authentication / authorization boundary when the bridge
 * is added in the next step.
 ******************************************************/


const V2_PHASE4 =
  Object.freeze({

    VERSION:
      "V2-PHASE4-PORTAL-API-1.0.1",

    SHEETS:
      Object.freeze({

        OCCURRENCES:
          "V2 Interview Occurrences",

        RECONCILIATION:
          "V2 Occurrence Reconciliation",

        CANDIDATE_EVENTS:
          "V2 Candidate Events",

        CANDIDATE_360:
          "V2 Candidate 360",

        LOGICAL_INTERVIEWS:
          "V2 Logical Interviews"

      }),

    AFTER_MIDNIGHT_CARRY_CUTOFF_MINUTES:
      360,

    SEARCH_DEFAULT_LIMIT:
      20,

    SEARCH_MAX_LIMIT:
      50,

    REVIEW_DEFAULT_LIMIT:
      100,

    REVIEW_MAX_LIMIT:
      250,

    PREVIEW_TIMELINE_LIMIT:
      8

  });


/******************************************************
 * EXACT REQUIRED STORED SCHEMAS
 ******************************************************/
function V2P4_requiredHeaders_(){

  return {

    OCCURRENCES: [
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
    ],

    RECONCILIATION: [
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
    ],

    CANDIDATE_EVENTS: [
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
    ],

    CANDIDATE_360: [
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
    ],

    LOGICAL_INTERVIEWS: [
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

  };

}


/******************************************************
 * PUBLIC 1 — PHASE-4 HEALTH CHECK
 *
 * READ ONLY.
 * Validates the exact stored data dependencies that the
 * future portal bridge will use.
 ******************************************************/
function V2P4_testPhase4HealthReadOnly(){

  const result = {
    ok: false,
    mode: "READ_ONLY",
    phase4Version: V2_PHASE4.VERSION,
    backendAvailable:
      typeof V2_backend_ === "function",
    backend: "",
    sheets: {},
    counts: {},
    duplicates: {},
    versions: {}
  };

  if(!result.backendAvailable){

    result.reason =
      "BACKEND_ROUTER_NOT_FOUND";

    V2P4_logResult_(
      "V2 PHASE 4 HEALTH",
      result
    );

    return result;

  }

  const ss =
    V2P4_backend_();

  result.backend =
    ss.getName();

  const required =
    V2P4_requiredHeaders_();

  const keys = [
    "OCCURRENCES",
    "RECONCILIATION",
    "CANDIDATE_EVENTS",
    "CANDIDATE_360",
    "LOGICAL_INTERVIEWS"
  ];

  let allSheetsOk = true;

  keys.forEach(
    function(key){

      const sheetName =
        V2_PHASE4.SHEETS[key];

      const sheet =
        ss.getSheetByName(
          sheetName
        );

      const found =
        !!sheet;

      const headersOk =
        found &&
        V2P4_sheetContainsHeaders_(
          sheet,
          required[key]
        );

      const rows =
        found
          ? Math.max(
              0,
              sheet.getLastRow() - 1
            )
          : 0;

      result.sheets[key] = {
        name: sheetName,
        found: found,
        headersOk: headersOk,
        rows: rows
      };

      result.counts[key] =
        rows;

      if(!found || !headersOk){
        allSheetsOk = false;
      }

    }
  );

  if(allSheetsOk){

    const candidates =
      V2P4_readSheetObjects_(
        V2_PHASE4.SHEETS.CANDIDATE_360,
        required.CANDIDATE_360
      );

    const events =
      V2P4_readSheetObjects_(
        V2_PHASE4.SHEETS.CANDIDATE_EVENTS,
        required.CANDIDATE_EVENTS
      );

    const logical =
      V2P4_readSheetObjects_(
        V2_PHASE4.SHEETS.LOGICAL_INTERVIEWS,
        required.LOGICAL_INTERVIEWS
      );

    const occurrences =
      V2P4_readSheetObjects_(
        V2_PHASE4.SHEETS.OCCURRENCES,
        required.OCCURRENCES
      );

    const reconciliation =
      V2P4_readSheetObjects_(
        V2_PHASE4.SHEETS.RECONCILIATION,
        required.RECONCILIATION
      );

    result.duplicates = {
      subjectKeys:
        V2P4_duplicateCount_(
          candidates,
          "Subject Key"
        ),
      eventIds:
        V2P4_duplicateCount_(
          events,
          "Event ID"
        ),
      logicalInterviewIds:
        V2P4_duplicateCount_(
          logical,
          "Logical Interview ID"
        ),
      occurrenceIds:
        V2P4_duplicateCount_(
          occurrences,
          "Occurrence ID"
        ),
      reviewIds:
        V2P4_duplicateCount_(
          reconciliation,
          "Review ID"
        )
    };

    result.versions = {
      phase2:
        V2P4_uniqueTextValues_(
          occurrences,
          "Phase2 Version"
        ),
      phase3:
        V2P4_uniqueTextValues_(
          candidates,
          "Phase3 Version"
        )
    };

    result.ok =
      (
        candidates.length > 0 &&
        events.length > 0 &&
        logical.length > 0 &&
        occurrences.length > 0 &&
        result.duplicates.subjectKeys === 0 &&
        result.duplicates.eventIds === 0 &&
        result.duplicates.logicalInterviewIds === 0 &&
        result.duplicates.occurrenceIds === 0 &&
        result.duplicates.reviewIds === 0
      );

  }

  V2P4_logResult_(
    "V2 PHASE 4 HEALTH",
    result
  );

  return result;

}


/******************************************************
 * PUBLIC 2 — PURE SYNTHETIC API TESTS
 *
 * READ ONLY. No spreadsheet reads or writes.
 ******************************************************/
function V2P4_testPhase4SyntheticReadOnly(){

  const checks = [];

  function check(
    name,
    condition
  ){
    checks.push({
      name: name,
      ok: !!condition
    });
  }

  const candidateRows = [
    {
      "Subject Key": "CID:CAN-000001",
      "Candidate ID": "CAN-000001",
      "Official Candidate Name": "Alpha Candidate",
      "Candidate Raw": "Alpha Candidate",
      "Identity Status": "RESOLVED",
      "Total Occurrences": 3,
      "Latest Business Date":
        new Date(2026,7,13),
      "Latest Client": "Client Z"
    },
    {
      "Subject Key": "CID:CAN-000002",
      "Candidate ID": "CAN-000002",
      "Official Candidate Name": "Beta Candidate",
      "Candidate Raw": "Beta Candidate",
      "Identity Status": "RESOLVED",
      "Total Occurrences": 2,
      "Latest Business Date":
        new Date(2026,7,12),
      "Latest Client": "Client B"
    },
    {
      "Subject Key": "RAW:alex sample",
      "Candidate ID": "",
      "Official Candidate Name": "",
      "Candidate Raw": "Alex Sample",
      "Identity Status": "REVIEW_UNRESOLVED",
      "Total Occurrences": 1,
      "Latest Business Date": "2026-08-11",
      "Latest Client": "Client R"
    }
  ];

  const resolvedById =
    V2P4_resolveCandidate_(
      "CAN-000001",
      candidateRows
    );

  check(
    "candidate resolves by exact Candidate ID",
    resolvedById.ok &&
    resolvedById.row["Subject Key"] ===
      "CID:CAN-000001"
  );

  const resolvedBySubject =
    V2P4_resolveCandidate_(
      "RAW:alex sample",
      candidateRows
    );

  check(
    "candidate resolves by exact Subject Key",
    resolvedBySubject.ok &&
    resolvedBySubject.row["Candidate Raw"] ===
      "Alex Sample"
  );

  const resolvedByName =
    V2P4_resolveCandidate_(
      "Alpha Candidate",
      candidateRows
    );

  check(
    "unique exact candidate name resolves",
    resolvedByName.ok &&
    resolvedByName.row["Candidate ID"] ===
      "CAN-000001"
  );

  const ambiguousRows =
    candidateRows.concat([
      {
        "Subject Key": "RAW:alpha candidate",
        "Candidate ID": "",
        "Official Candidate Name": "",
        "Candidate Raw": "Alpha Candidate",
        "Identity Status": "REVIEW_UNRESOLVED"
      }
    ]);

  const ambiguous =
    V2P4_resolveCandidate_(
      "Alpha Candidate",
      ambiguousRows
    );

  check(
    "ambiguous exact name is never auto-picked",
    !ambiguous.ok &&
    ambiguous.reason ===
      "AMBIGUOUS_CANDIDATE"
  );

  const search =
    V2P4_searchCandidateRows_(
      candidateRows,
      "CAN-000002",
      20
    );

  check(
    "candidate search ranks exact Candidate ID first",
    search.length === 1 &&
    search[0].row["Candidate ID"] ===
      "CAN-000002"
  );

  const sameDayLate = {
    "Occurrence ID": "OCC-LATE",
    "Business Date Key": "2026-08-10",
    "Start Minutes": 1410,
    "Gateway Source Row": 10,
    "Team Data Row": ""
  };

  const sameDayEarly = {
    "Occurrence ID": "OCC-EARLY",
    "Business Date Key": "2026-08-10",
    "Start Minutes": 90,
    "Gateway Source Row": 11,
    "Team Data Row": ""
  };

  check(
    "1:30 AM sorts after 11:30 PM inside same business day",
    V2P4_occurrenceSortValue_(
      sameDayEarly
    ) >
    V2P4_occurrenceSortValue_(
      sameDayLate
    )
  );

  const priorDate = {
    "Occurrence ID": "OCC-PRIOR",
    "Business Date Key": "2026-08-10",
    "Start Minutes": 1430,
    "Gateway Source Row": 20,
    "Team Data Row": ""
  };

  const laterDate = {
    "Occurrence ID": "OCC-LATER",
    "Business Date Key": "2026-08-11",
    "Start Minutes": 600,
    "Gateway Source Row": 1,
    "Team Data Row": ""
  };

  check(
    "later business date sorts after earlier date regardless of clock time",
    V2P4_occurrenceSortValue_(
      laterDate
    ) >
    V2P4_occurrenceSortValue_(
      priorDate
    )
  );

  check(
    "Google Sheets Date object normalizes to yyyy-MM-dd",
    V2P4_dateKey_(
      new Date(2026,7,13)
    ) === "2026-08-13"
  );

  const rawCandidate =
    candidateRows[2];

  const rawOccurrence = {
    "Occurrence ID": "OCC-RAW",
    "Candidate ID": "",
    "Official Candidate Name": "",
    "Candidate Raw": "Alex Sample"
  };

  check(
    "unresolved candidate filters only by exact normalized raw identity",
    V2P4_occurrenceBelongsToCandidate_(
      rawOccurrence,
      rawCandidate
    )
  );

  const wrongRawOccurrence = {
    "Occurrence ID": "OCC-WRONG",
    "Candidate ID": "",
    "Official Candidate Name": "",
    "Candidate Raw": "Alex Samples"
  };

  check(
    "unresolved candidate does not fuzzy-merge nearby name",
    !V2P4_occurrenceBelongsToCandidate_(
      wrongRawOccurrence,
      rawCandidate
    )
  );

  const publicOccurrence =
    V2P4_publicOccurrence_({
      "Occurrence ID": "OCC-X",
      "Logical Interview ID": "LI-X",
      "Business Date":
        new Date(2026,7,13),
      "Business Date Key":
        new Date(2026,7,13),
      "Selection Confirmed Date":
        new Date(2026,7,14),
      "Start Minutes": 1320,
      "Duration Minutes": 30,
      "Outcome Status": "SELECTED"
    });

  check(
    "public API returns date-only values as yyyy-MM-dd",
    publicOccurrence.businessDate ===
      "2026-08-13" &&
    publicOccurrence.selectionConfirmedDate ===
      "2026-08-14"
  );

  const publicTimeFromMinutes =
    V2P4_publicOccurrence_({
      "Occurrence ID": "OCC-TIME-MIN",
      "Business Date Key": "2026-08-13",
      "Time Normalized":
        new Date(1899,11,30,18,30,0),
      "Start Minutes": 1110
    });

  check(
    "public API formats interview time from Start Minutes as h:mm AM/PM",
    publicTimeFromMinutes.timeNormalized ===
      "6:30 PM"
  );

  const publicReviewTime =
    V2P4_publicReview_({
      "Review ID": "REV-TIME",
      "Business Date Key": "2026-08-13",
      "Time Normalized":
        new Date(1899,11,30,21,45,0)
    });

  check(
    "review API normalizes Google Sheets time Date object as h:mm AM/PM",
    publicReviewTime.timeNormalized ===
      "9:45 PM"
  );

  const reviewRows = [
    {
      "Review ID": "REV-1",
      "Candidate ID": "CAN-000001",
      "Candidate Raw": "Alpha Candidate"
    },
    {
      "Review ID": "REV-2",
      "Candidate ID": "CAN-000001",
      "Candidate Raw": "Alpha Candidate"
    }
  ];

  const candidateReviews =
    reviewRows.filter(
      function(row){
        return V2P4_reviewBelongsToCandidate_(
          row,
          candidateRows[0]
        );
      }
    );

  check(
    "multiple review rows for one candidate remain separate",
    candidateReviews.length === 2
  );

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
    phase4Version:
      V2_PHASE4.VERSION,
    passed:
      passed,
    total:
      checks.length,
    checks:
      checks
  };

  V2P4_logResult_(
    "V2 PHASE 4 SYNTHETIC",
    result
  );

  return result;

}


/******************************************************
 * PUBLIC 3 — CANDIDATE SEARCH
 *
 * Usage from server-side code later:
 *   V2P4_searchCandidatesReadOnly("Kiran")
 *   V2P4_searchCandidatesReadOnly("CAN-000161", 10)
 *
 * No fuzzy auto-resolution is performed. Search results
 * may be broad, but opening a candidate requires an exact
 * Subject Key / Candidate ID / unique exact name.
 ******************************************************/
function V2P4_searchCandidatesReadOnly(
  query,
  limit
){

  const q =
    V2P4_text_(
      query
    );

  const safeLimit =
    V2P4_limit_(
      limit,
      V2_PHASE4.SEARCH_DEFAULT_LIMIT,
      V2_PHASE4.SEARCH_MAX_LIMIT
    );

  if(!q){
    return {
      ok: true,
      mode: "READ_ONLY_API",
      phase4Version: V2_PHASE4.VERSION,
      query: "",
      totalMatches: 0,
      returned: 0,
      results: []
    };
  }

  const rows =
    V2P4_readCandidate360_();

  const matches =
    V2P4_searchCandidateRows_(
      rows,
      q,
      safeLimit
    );

  return {
    ok: true,
    mode: "READ_ONLY_API",
    phase4Version: V2_PHASE4.VERSION,
    query: q,
    totalMatches:
      matches.totalMatches,
    returned:
      matches.length,
    results:
      matches.map(
        function(item){
          return V2P4_publicCandidate_(
            item.row,
            item.score
          );
        }
      )
  };

}


/******************************************************
 * PUBLIC 4 — GET CANDIDATE 360 SUMMARY
 ******************************************************/
function V2P4_getCandidate360ReadOnly(
  candidateRef
){

  const resolved =
    V2P4_resolveCandidateFromStored_(
      candidateRef
    );

  if(!resolved.ok){
    return V2P4_candidateFailure_(
      candidateRef,
      resolved
    );
  }

  return {
    ok: true,
    mode: "READ_ONLY_API",
    phase4Version: V2_PHASE4.VERSION,
    candidate:
      V2P4_publicCandidate_(
        resolved.row
      )
  };

}


/******************************************************
 * PUBLIC 5 — CANDIDATE OCCURRENCE TIMELINE
 *
 * Returns newest business occurrence first.
 ******************************************************/
function V2P4_getCandidateTimelineReadOnly(
  candidateRef
){

  const candidates =
    V2P4_readCandidate360_();

  const resolved =
    V2P4_resolveCandidate_(
      candidateRef,
      candidates
    );

  if(!resolved.ok){
    return V2P4_candidateFailure_(
      candidateRef,
      resolved
    );
  }

  const rows =
    V2P4_readOccurrences_()
      .filter(
        function(row){
          return V2P4_occurrenceBelongsToCandidate_(
            row,
            resolved.row
          );
        }
      )
      .sort(
        V2P4_occurrenceNewestFirst_
      );

  return {
    ok: true,
    mode: "READ_ONLY_API",
    phase4Version: V2_PHASE4.VERSION,
    timelineOrder: "LATEST_FIRST",
    candidate:
      V2P4_publicCandidate_(
        resolved.row
      ),
    count:
      rows.length,
    selectedCount:
      rows.filter(
        function(row){
          return V2P4_text_(
            row["Outcome Status"]
          ).toUpperCase() ===
            "SELECTED";
        }
      ).length,
    reviewCount:
      rows.filter(
        V2P4_occurrenceNeedsReview_
      ).length,
    occurrences:
      rows.map(
        V2P4_publicOccurrence_
      )
  };

}


/******************************************************
 * PUBLIC 6 — LOGICAL INTERVIEW HISTORY
 ******************************************************/
function V2P4_getLogicalInterviewsReadOnly(
  candidateRef
){

  const candidates =
    V2P4_readCandidate360_();

  const resolved =
    V2P4_resolveCandidate_(
      candidateRef,
      candidates
    );

  if(!resolved.ok){
    return V2P4_candidateFailure_(
      candidateRef,
      resolved
    );
  }

  const subjectKey =
    V2P4_text_(
      resolved.row["Subject Key"]
    );

  const candidateId =
    V2P4_text_(
      resolved.row["Candidate ID"]
    );

  const rows =
    V2P4_readLogicalInterviews_()
      .filter(
        function(row){

          if(
            subjectKey &&
            V2P4_text_(
              row["Subject Key"]
            ) === subjectKey
          ){
            return true;
          }

          return (
            candidateId &&
            V2P4_text_(
              row["Candidate ID"]
            ) === candidateId
          );

        }
      )
      .sort(
        V2P4_logicalNewestFirst_
      );

  return {
    ok: true,
    mode: "READ_ONLY_API",
    phase4Version: V2_PHASE4.VERSION,
    candidate:
      V2P4_publicCandidate_(
        resolved.row
      ),
    count:
      rows.length,
    logicalInterviews:
      rows.map(
        V2P4_publicLogicalInterview_
      )
  };

}


/******************************************************
 * PUBLIC 7 — EXACT OCCURRENCE DETAILS
 ******************************************************/
function V2P4_getOccurrenceDetailsReadOnly(
  occurrenceId
){

  const id =
    V2P4_text_(
      occurrenceId
    );

  if(!id){
    return {
      ok: false,
      mode: "READ_ONLY_API",
      phase4Version: V2_PHASE4.VERSION,
      reason: "OCCURRENCE_ID_REQUIRED"
    };
  }

  const rows =
    V2P4_readOccurrences_();

  const matches =
    rows.filter(
      function(row){
        return V2P4_text_(
          row["Occurrence ID"]
        ).toUpperCase() ===
          id.toUpperCase();
      }
    );

  if(matches.length === 0){
    return {
      ok: false,
      mode: "READ_ONLY_API",
      phase4Version: V2_PHASE4.VERSION,
      occurrenceId: id,
      reason: "OCCURRENCE_NOT_FOUND"
    };
  }

  if(matches.length > 1){
    return {
      ok: false,
      mode: "READ_ONLY_API",
      phase4Version: V2_PHASE4.VERSION,
      occurrenceId: id,
      reason: "DUPLICATE_OCCURRENCE_ID",
      matches: matches.length
    };
  }

  return {
    ok: true,
    mode: "READ_ONLY_API",
    phase4Version: V2_PHASE4.VERSION,
    occurrence:
      V2P4_publicOccurrence_(
        matches[0],
        true
      )
  };

}


/******************************************************
 * PUBLIC 8 — PHASE-2 REVIEW QUEUE
 *
 * This returns the stored unresolved Phase-2 review
 * records. It does NOT resolve or write them.
 ******************************************************/
function V2P4_getReviewQueueReadOnly(
  limit
){

  const safeLimit =
    V2P4_limit_(
      limit,
      V2_PHASE4.REVIEW_DEFAULT_LIMIT,
      V2_PHASE4.REVIEW_MAX_LIMIT
    );

  const rows =
    V2P4_readReconciliation_()
      .sort(
        V2P4_reviewNewestFirst_
      );

  return {
    ok: true,
    mode: "READ_ONLY_API",
    phase4Version: V2_PHASE4.VERSION,
    total:
      rows.length,
    returned:
      Math.min(
        safeLimit,
        rows.length
      ),
    reviews:
      rows
        .slice(
          0,
          safeLimit
        )
        .map(
          V2P4_publicReview_
        )
  };

}


/******************************************************
 * PUBLIC 9 — COMPLETE PORTAL CANDIDATE BUNDLE
 *
 * This is the main read model intended for the future
 * Interview Portal Control bridge.
 *
 * One server-side call returns:
 * - Candidate 360 summary
 * - all occurrences / handler history
 * - selected occurrences
 * - logical interviews
 * - Candidate Events facts
 * - unresolved Phase-2 review rows for this candidate
 *
 * No writes.
 ******************************************************/
function V2P4_getPortalCandidateBundleReadOnly(
  candidateRef
){

  const candidates =
    V2P4_readCandidate360_();

  const resolved =
    V2P4_resolveCandidate_(
      candidateRef,
      candidates
    );

  if(!resolved.ok){
    return V2P4_candidateFailure_(
      candidateRef,
      resolved
    );
  }

  const candidateRow =
    resolved.row;

  const occurrences =
    V2P4_readOccurrences_()
      .filter(
        function(row){
          return V2P4_occurrenceBelongsToCandidate_(
            row,
            candidateRow
          );
        }
      )
      .sort(
        V2P4_occurrenceNewestFirst_
      );

  const logical =
    V2P4_readLogicalInterviews_()
      .filter(
        function(row){
          return V2P4_logicalBelongsToCandidate_(
            row,
            candidateRow
          );
        }
      )
      .sort(
        V2P4_logicalNewestFirst_
      );

  const reviews =
    V2P4_readReconciliation_()
      .filter(
        function(row){
          return V2P4_reviewBelongsToCandidate_(
            row,
            candidateRow
          );
        }
      )
      .sort(
        V2P4_reviewNewestFirst_
      );

  const eventRows =
    V2P4_readCandidateEvents_();

  const events =
    V2P4_eventsForCandidate_(
      eventRows,
      occurrences,
      candidateRow
    )
      .sort(
        V2P4_eventNewestFirst_
      );

  const selected =
    occurrences.filter(
      function(row){
        return V2P4_text_(
          row["Outcome Status"]
        ).toUpperCase() ===
          "SELECTED";
      }
    );

  const handlerHistory =
    V2P4_buildHandlerHistory_(
      occurrences
    );

  return {
    ok: true,
    mode: "READ_ONLY_API",
    phase4Version: V2_PHASE4.VERSION,
    timelineOrder: "LATEST_FIRST",
    candidate:
      V2P4_publicCandidate_(
        candidateRow
      ),
    counts: {
      occurrences:
        occurrences.length,
      logicalInterviews:
        logical.length,
      events:
        events.length,
      selectedOccurrences:
        selected.length,
      openReviews:
        reviews.length,
      handlers:
        handlerHistory.length
    },
    latestOccurrence:
      occurrences.length
        ? V2P4_publicOccurrence_(
            occurrences[0]
          )
        : null,
    selectedOccurrences:
      selected.map(
        V2P4_publicOccurrence_
      ),
    handlerHistory:
      handlerHistory,
    occurrences:
      occurrences.map(
        V2P4_publicOccurrence_
      ),
    logicalInterviews:
      logical.map(
        V2P4_publicLogicalInterview_
      ),
    events:
      events.map(
        V2P4_publicEvent_
      ),
    reviews:
      reviews.map(
        V2P4_publicReview_
      )
  };

}


/******************************************************
 * PUBLIC 10 — REAL READ-ONLY API PREVIEW
 *
 * Convenience test with no parameters for Apps Script
 * editor. Selects one resolved stored candidate and builds
 * the same bundle that the future portal will request.
 ******************************************************/
function V2P4_previewPortalApiReadOnly(){

  const candidates =
    V2P4_readCandidate360_()
      .filter(
        function(row){
          return (
            V2P4_text_(
              row["Candidate ID"]
            ) &&
            V2P4_text_(
              row["Identity Status"]
            ).toUpperCase() ===
              "RESOLVED"
          );
        }
      )
      .sort(
        V2P4_candidateNewestFirst_
      );

  if(candidates.length === 0){

    const empty = {
      ok: false,
      mode: "READ_ONLY_PREVIEW",
      phase4Version: V2_PHASE4.VERSION,
      reason: "NO_RESOLVED_CANDIDATE_FOUND"
    };

    V2P4_logResult_(
      "V2 PHASE 4 REAL API PREVIEW",
      empty
    );

    return empty;

  }

  const candidateRef =
    V2P4_text_(
      candidates[0]["Subject Key"]
    );

  const bundle =
    V2P4_getPortalCandidateBundleReadOnly(
      candidateRef
    );

  const result = {
    ok:
      bundle.ok,
    mode:
      "READ_ONLY_PREVIEW",
    phase4Version:
      V2_PHASE4.VERSION,
    candidate:
      bundle.candidate,
    counts:
      bundle.counts,
    latestOccurrence:
      bundle.latestOccurrence,
    timelinePreview:
      (bundle.occurrences || [])
        .slice(
          0,
          V2_PHASE4.PREVIEW_TIMELINE_LIMIT
        ),
    logicalPreview:
      (bundle.logicalInterviews || [])
        .slice(
          0,
          5
        ),
    reviewPreview:
      (bundle.reviews || [])
        .slice(
          0,
          5
        )
  };

  V2P4_logResult_(
    "V2 PHASE 4 REAL API PREVIEW",
    result
  );

  return result;

}


/******************************************************
 * PRIVATE — STORED READERS
 ******************************************************/
function V2P4_readCandidate360_(){

  return V2P4_readSheetObjects_(
    V2_PHASE4.SHEETS.CANDIDATE_360,
    V2P4_requiredHeaders_().CANDIDATE_360
  );

}


function V2P4_readOccurrences_(){

  return V2P4_readSheetObjects_(
    V2_PHASE4.SHEETS.OCCURRENCES,
    V2P4_requiredHeaders_().OCCURRENCES
  );

}


function V2P4_readLogicalInterviews_(){

  return V2P4_readSheetObjects_(
    V2_PHASE4.SHEETS.LOGICAL_INTERVIEWS,
    V2P4_requiredHeaders_().LOGICAL_INTERVIEWS
  );

}


function V2P4_readCandidateEvents_(){

  return V2P4_readSheetObjects_(
    V2_PHASE4.SHEETS.CANDIDATE_EVENTS,
    V2P4_requiredHeaders_().CANDIDATE_EVENTS
  );

}


function V2P4_readReconciliation_(){

  return V2P4_readSheetObjects_(
    V2_PHASE4.SHEETS.RECONCILIATION,
    V2P4_requiredHeaders_().RECONCILIATION
  );

}


function V2P4_readSheetObjects_(
  sheetName,
  requiredHeaders
){

  const ss =
    V2P4_backend_();

  const sheet =
    ss.getSheetByName(
      sheetName
    );

  if(!sheet){
    throw new Error(
      "V2P4_SHEET_NOT_FOUND|" +
      sheetName
    );
  }

  if(
    !V2P4_sheetContainsHeaders_(
      sheet,
      requiredHeaders
    )
  ){
    throw new Error(
      "V2P4_HEADERS_INVALID|" +
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

  const values =
    sheet.getRange(
      1,
      1,
      lastRow,
      lastColumn
    ).getValues();

  const headers =
    values[0].map(
      V2P4_text_
    );

  return values
    .slice(1)
    .filter(
      V2P4_rowHasValue_
    )
    .map(
      function(row){

        const object = {};

        headers.forEach(
          function(header,index){
            if(header){
              object[header] =
                row[index];
            }
          }
        );

        return object;

      }
    );

}


/******************************************************
 * PRIVATE — CANDIDATE RESOLUTION
 *
 * Exact-only resolver for opening a candidate.
 * Search may return partial matches; resolution never
 * guesses.
 ******************************************************/
function V2P4_resolveCandidateFromStored_(
  candidateRef
){

  return V2P4_resolveCandidate_(
    candidateRef,
    V2P4_readCandidate360_()
  );

}


function V2P4_resolveCandidate_(
  candidateRef,
  rows
){

  const ref =
    V2P4_text_(
      candidateRef
    );

  if(!ref){
    return {
      ok: false,
      reason: "CANDIDATE_REFERENCE_REQUIRED",
      matches: 0
    };
  }

  const upper =
    ref.toUpperCase();

  let matches = [];

  // 1. Exact Subject Key.
  matches =
    rows.filter(
      function(row){
        return V2P4_text_(
          row["Subject Key"]
        ).toUpperCase() === upper;
      }
    );

  if(matches.length === 1){
    return {
      ok: true,
      resolvedBy: "SUBJECT_KEY",
      row: matches[0]
    };
  }

  if(matches.length > 1){
    return {
      ok: false,
      reason: "AMBIGUOUS_SUBJECT_KEY",
      matches: matches.length
    };
  }

  // 2. Exact Candidate ID.
  matches =
    rows.filter(
      function(row){
        return (
          V2P4_text_(
            row["Candidate ID"]
          ).toUpperCase() === upper &&
          V2P4_text_(
            row["Candidate ID"]
          ) !== ""
        );
      }
    );

  if(matches.length === 1){
    return {
      ok: true,
      resolvedBy: "CANDIDATE_ID",
      row: matches[0]
    };
  }

  if(matches.length > 1){
    return {
      ok: false,
      reason: "AMBIGUOUS_CANDIDATE_ID",
      matches: matches.length
    };
  }

  // 3. Unique exact normalized official/raw name.
  const normalized =
    V2P4_normalize_(
      ref
    );

  matches =
    rows.filter(
      function(row){

        const official =
          V2P4_normalize_(
            row["Official Candidate Name"]
          );

        const raw =
          V2P4_normalize_(
            row["Candidate Raw"]
          );

        return (
          normalized &&
          (
            official === normalized ||
            raw === normalized
          )
        );

      }
    );

  if(matches.length === 1){
    return {
      ok: true,
      resolvedBy: "UNIQUE_EXACT_NAME",
      row: matches[0]
    };
  }

  if(matches.length > 1){
    return {
      ok: false,
      reason: "AMBIGUOUS_CANDIDATE",
      matches: matches.length,
      candidateRefs:
        matches.map(
          function(row){
            return V2P4_text_(
              row["Subject Key"]
            );
          }
        )
    };
  }

  return {
    ok: false,
    reason: "CANDIDATE_NOT_FOUND",
    matches: 0
  };

}


function V2P4_candidateFailure_(
  candidateRef,
  resolved
){

  return {
    ok: false,
    mode: "READ_ONLY_API",
    phase4Version: V2_PHASE4.VERSION,
    candidateRef:
      V2P4_text_(
        candidateRef
      ),
    reason:
      resolved.reason ||
      "CANDIDATE_NOT_FOUND",
    matches:
      resolved.matches || 0,
    candidateRefs:
      resolved.candidateRefs || []
  };

}


/******************************************************
 * PRIVATE — SEARCH
 ******************************************************/
function V2P4_searchCandidateRows_(
  rows,
  query,
  limit
){

  const qText =
    V2P4_text_(
      query
    );

  const qUpper =
    qText.toUpperCase();

  const qNorm =
    V2P4_normalize_(
      qText
    );

  const qTokens =
    qNorm
      ? qNorm.split(" ")
      : [];

  const scored = [];

  rows.forEach(
    function(row){

      const subject =
        V2P4_text_(
          row["Subject Key"]
        );

      const candidateId =
        V2P4_text_(
          row["Candidate ID"]
        );

      const official =
        V2P4_text_(
          row["Official Candidate Name"]
        );

      const raw =
        V2P4_text_(
          row["Candidate Raw"]
        );

      const subjectUpper =
        subject.toUpperCase();

      const idUpper =
        candidateId.toUpperCase();

      const officialNorm =
        V2P4_normalize_(
          official
        );

      const rawNorm =
        V2P4_normalize_(
          raw
        );

      const searchable =
        (
          subject + " " +
          candidateId + " " +
          official + " " +
          raw
        );

      const searchableNorm =
        V2P4_normalize_(
          searchable
        );

      let score = 0;

      if(subjectUpper === qUpper){
        score = 1000;
      }else if(
        candidateId &&
        idUpper === qUpper
      ){
        score = 950;
      }else if(
        qNorm &&
        officialNorm === qNorm
      ){
        score = 900;
      }else if(
        qNorm &&
        rawNorm === qNorm
      ){
        score = 850;
      }else if(
        qNorm &&
        officialNorm.indexOf(qNorm) === 0
      ){
        score = 700;
      }else if(
        qNorm &&
        rawNorm.indexOf(qNorm) === 0
      ){
        score = 675;
      }else if(
        qNorm &&
        (
          officialNorm.indexOf(qNorm) >= 0 ||
          rawNorm.indexOf(qNorm) >= 0 ||
          searchableNorm.indexOf(qNorm) >= 0
        )
      ){
        score = 500;
      }else if(
        qTokens.length > 0 &&
        qTokens.every(
          function(token){
            return searchableNorm.indexOf(
              token
            ) >= 0;
          }
        )
      ){
        score = 350;
      }

      if(score > 0){
        scored.push({
          row: row,
          score: score
        });
      }

    }
  );

  scored.sort(
    function(a,b){

      if(a.score !== b.score){
        return b.score - a.score;
      }

      const dateDiff =
        V2P4_dateOrdinal_(
          b.row["Latest Business Date"]
        ) -
        V2P4_dateOrdinal_(
          a.row["Latest Business Date"]
        );

      if(dateDiff !== 0){
        return dateDiff;
      }

      const occurrenceDiff =
        V2P4_number_(
          b.row["Total Occurrences"]
        ) -
        V2P4_number_(
          a.row["Total Occurrences"]
        );

      if(occurrenceDiff !== 0){
        return occurrenceDiff;
      }

      return V2P4_text_(
        a.row["Subject Key"]
      ).localeCompare(
        V2P4_text_(
          b.row["Subject Key"]
        )
      );

    }
  );

  const safeLimit =
    V2P4_limit_(
      limit,
      V2_PHASE4.SEARCH_DEFAULT_LIMIT,
      V2_PHASE4.SEARCH_MAX_LIMIT
    );

  const output =
    scored.slice(
      0,
      safeLimit
    );

  output.totalMatches =
    scored.length;

  return output;

}


/******************************************************
 * PRIVATE — CANDIDATE MEMBERSHIP
 ******************************************************/
function V2P4_occurrenceBelongsToCandidate_(
  occurrence,
  candidate
){

  const candidateId =
    V2P4_text_(
      candidate["Candidate ID"]
    );

  if(candidateId){
    return (
      V2P4_text_(
        occurrence["Candidate ID"]
      ) === candidateId
    );
  }

  const subjectKey =
    V2P4_text_(
      candidate["Subject Key"]
    );

  if(
    subjectKey.indexOf(
      "OCC:"
    ) === 0
  ){
    return (
      V2P4_text_(
        occurrence["Occurrence ID"]
      ) ===
      subjectKey.substring(4)
    );
  }

  let expectedName = "";

  if(
    subjectKey.indexOf(
      "RAW:"
    ) === 0
  ){
    expectedName =
      subjectKey.substring(4);
  }else{
    expectedName =
      V2P4_normalize_(
        candidate["Official Candidate Name"] ||
        candidate["Candidate Raw"]
      );
  }

  const occurrenceName =
    V2P4_normalize_(
      occurrence["Official Candidate Name"] ||
      occurrence["Candidate Raw"]
    );

  return (
    expectedName &&
    occurrenceName === expectedName
  );

}


function V2P4_logicalBelongsToCandidate_(
  row,
  candidate
){

  const subjectKey =
    V2P4_text_(
      candidate["Subject Key"]
    );

  const candidateId =
    V2P4_text_(
      candidate["Candidate ID"]
    );

  if(
    subjectKey &&
    V2P4_text_(
      row["Subject Key"]
    ) === subjectKey
  ){
    return true;
  }

  return (
    candidateId &&
    V2P4_text_(
      row["Candidate ID"]
    ) === candidateId
  );

}


function V2P4_reviewBelongsToCandidate_(
  row,
  candidate
){

  const candidateId =
    V2P4_text_(
      candidate["Candidate ID"]
    );

  if(candidateId){
    return (
      V2P4_text_(
        row["Candidate ID"]
      ) === candidateId
    );
  }

  const expectedName =
    V2P4_normalize_(
      candidate["Official Candidate Name"] ||
      candidate["Candidate Raw"] ||
      V2P4_text_(
        candidate["Subject Key"]
      ).replace(/^RAW:/," ")
    );

  const rowName =
    V2P4_normalize_(
      row["Official Candidate Name"] ||
      row["Candidate Raw"]
    );

  return (
    expectedName &&
    expectedName === rowName
  );

}


function V2P4_eventsForCandidate_(
  events,
  occurrences,
  candidate
){

  const candidateId =
    V2P4_text_(
      candidate["Candidate ID"]
    );

  const occurrenceIds = {};
  const callIds = {};

  occurrences.forEach(
    function(row){

      const occurrenceId =
        V2P4_text_(
          row["Occurrence ID"]
        );

      const callId =
        V2P4_text_(
          row["Operational Call ID"]
        );

      if(occurrenceId){
        occurrenceIds[occurrenceId] = true;
      }

      if(callId){
        callIds[callId] = true;
      }

    }
  );

  return events.filter(
    function(event){

      if(
        candidateId &&
        V2P4_text_(
          event["Candidate ID"]
        ) === candidateId
      ){
        return true;
      }

      const callId =
        V2P4_text_(
          event["Call ID"]
        );

      if(
        callId &&
        callIds[callId]
      ){
        return true;
      }

      const details =
        V2P4_text_(
          event["Details"]
        );

      const match =
        details.match(
          /(?:^|\s\|\s)Occurrence=([^|]+)/
        );

      const eventOccurrenceId =
        match
          ? V2P4_text_(
              match[1]
            )
          : "";

      return (
        eventOccurrenceId &&
        occurrenceIds[eventOccurrenceId]
      );

    }
  );

}


/******************************************************
 * PRIVATE — PORTAL DTO BUILDERS
 ******************************************************/
function V2P4_publicCandidate_(
  row,
  searchScore
){

  const result = {
    subjectKey:
      V2P4_text_(
        row["Subject Key"]
      ),
    candidateId:
      V2P4_text_(
        row["Candidate ID"]
      ),
    officialCandidateName:
      V2P4_text_(
        row["Official Candidate Name"]
      ),
    candidateRaw:
      V2P4_text_(
        row["Candidate Raw"]
      ),
    identityStatus:
      V2P4_text_(
        row["Identity Status"]
      ),
    latestHandlerTeamId:
      V2P4_text_(
        row["Latest Handler Team ID"]
      ),
    totalOccurrences:
      V2P4_number_(
        row["Total Occurrences"]
      ),
    operationalOccurrences:
      V2P4_number_(
        row["Operational Occurrences"]
      ),
    rawOnlyOccurrences:
      V2P4_number_(
        row["Raw Only Occurrences"]
      ),
    teamReviewOccurrences:
      V2P4_number_(
        row["Team Review Occurrences"]
      ),
    assigned:
      V2P4_number_(
        row["Assigned"]
      ),
    support:
      V2P4_number_(
        row["Support"]
      ),
    rescheduled:
      V2P4_number_(
        row["Rescheduled"]
      ),
    cancelled:
      V2P4_number_(
        row["Cancelled"]
      ),
    unassigned:
      V2P4_number_(
        row["Unassigned"]
      ),
    inProgress:
      V2P4_number_(
        row["In Progress"]
      ),
    selected:
      V2P4_number_(
        row["Selected"]
      ),
    distinctClients:
      V2P4_number_(
        row["Distinct Clients"]
      ),
    distinctLogicalInterviews:
      V2P4_number_(
        row["Distinct Logical Interviews"]
      ),
    firstBusinessDate:
      V2P4_dateKey_(
        row["First Business Date"]
      ),
    latestBusinessDate:
      V2P4_dateKey_(
        row["Latest Business Date"]
      ),
    latestClient:
      V2P4_text_(
        row["Latest Client"]
      ),
    latestRound:
      V2P4_text_(
        row["Latest Round"]
      ),
    latestHandlerId:
      V2P4_text_(
        row["Latest Handler ID"]
      ),
    latestHandlerName:
      V2P4_text_(
        row["Latest Handler Name"]
      ),
    latestOperationalStatus:
      V2P4_text_(
        row["Latest Operational Status"]
      ),
    latestOutcomeStatus:
      V2P4_text_(
        row["Latest Outcome Status"]
      ),
    openReviewCount:
      V2P4_number_(
        row["Open Review Count"]
      ),
    latestOccurrenceId:
      V2P4_text_(
        row["Latest Occurrence ID"]
      ),
    phase3Version:
      V2P4_text_(
        row["Phase3 Version"]
      )
  };

  if(
    searchScore !== undefined &&
    searchScore !== null
  ){
    result.searchScore =
      Number(
        searchScore
      );
  }

  return result;

}


function V2P4_publicOccurrence_(
  row,
  includeRawEvidence
){

  const result = {
    occurrenceId:
      V2P4_text_(
        row["Occurrence ID"]
      ),
    logicalInterviewId:
      V2P4_text_(
        row["Logical Interview ID"]
      ),
    occurrenceSource:
      V2P4_text_(
        row["Occurrence Source"]
      ),
    gatewayId:
      V2P4_text_(
        row["Gateway ID"]
      ),
    operationalCallId:
      V2P4_text_(
        row["Operational Call ID"]
      ),
    businessDate:
      V2P4_dateKey_(
        row["Business Date Key"] ||
        row["Business Date"]
      ),
    gatewaySourceSheet:
      V2P4_text_(
        row["Gateway Source Sheet"]
      ),
    gatewaySourceRow:
      V2P4_numberOrBlank_(
        row["Gateway Source Row"]
      ),
    teamDataRow:
      V2P4_numberOrBlank_(
        row["Team Data Row"]
      ),
    candidateRaw:
      V2P4_text_(
        row["Candidate Raw"]
      ),
    gatewayCandidateId:
      V2P4_text_(
        row["Gateway Candidate ID"]
      ),
    operationalCandidateId:
      V2P4_text_(
        row["Operational Candidate ID"]
      ),
    candidateId:
      V2P4_text_(
        row["Candidate ID"]
      ),
    officialCandidateName:
      V2P4_text_(
        row["Official Candidate Name"]
      ),
    client:
      V2P4_text_(
        row["Client Raw"]
      ),
    clientKey:
      V2P4_text_(
        row["Client Key"]
      ),
    roundLabel:
      V2P4_text_(
        row["Round Label"]
      ),
    roundNo:
      V2P4_numberOrBlank_(
        row["Round No"]
      ),
    stageDescriptor:
      V2P4_text_(
        row["Stage Descriptor"]
      ),
    interviewType:
      V2P4_text_(
        row["Interview Type"]
      ),
    timeNormalized:
      V2P4_timeLabel_(
        row["Time Normalized"],
        row["Start Minutes"]
      ),
    startMinutes:
      V2P4_numberOrBlank_(
        row["Start Minutes"]
      ),
    durationMinutes:
      V2P4_numberOrBlank_(
        row["Duration Minutes"]
      ),
    handlerId:
      V2P4_text_(
        row["Handler ID"]
      ),
    handlerName:
      V2P4_text_(
        row["Handler Name"]
      ),
    teamId:
      V2P4_text_(
        row["Team ID"]
      ),
    operationalStatus:
      V2P4_text_(
        row["Operational Status"]
      ),
    outcomeStatus:
      V2P4_text_(
        row["Outcome Status"]
      ),
    selectionConfirmedDate:
      V2P4_dateKey_(
        row["Selection Confirmed Date"]
      ),
    parseStatus:
      V2P4_text_(
        row["Parse Status"]
      ),
    candidateMatchStatus:
      V2P4_text_(
        row["Candidate Match Status"]
      ),
    linkStatus:
      V2P4_text_(
        row["Link Status"]
      ),
    occurrenceStatus:
      V2P4_text_(
        row["Occurrence Status"]
      ),
    phase2Version:
      V2P4_text_(
        row["Phase2 Version"]
      )
  };

  if(includeRawEvidence){
    result.originalGatewayRecord =
      V2P4_text_(
        row["Original Gateway Record"]
      );

    result.teamDataRecord =
      V2P4_text_(
        row["Team Data Record"]
      );
  }

  return result;

}


function V2P4_publicLogicalInterview_(
  row
){

  return {
    logicalInterviewId:
      V2P4_text_(
        row["Logical Interview ID"]
      ),
    subjectKey:
      V2P4_text_(
        row["Subject Key"]
      ),
    candidateId:
      V2P4_text_(
        row["Candidate ID"]
      ),
    officialCandidateName:
      V2P4_text_(
        row["Official Candidate Name"]
      ),
    client:
      V2P4_text_(
        row["Client"]
      ),
    roundLabel:
      V2P4_text_(
        row["Round Label"]
      ),
    roundNo:
      V2P4_numberOrBlank_(
        row["Round No"]
      ),
    stageDescriptor:
      V2P4_text_(
        row["Stage Descriptor"]
      ),
    occurrenceCount:
      V2P4_number_(
        row["Occurrence Count"]
      ),
    operationalOccurrences:
      V2P4_number_(
        row["Operational Occurrences"]
      ),
    rawOnlyOccurrences:
      V2P4_number_(
        row["Raw Only Occurrences"]
      ),
    reviewOccurrences:
      V2P4_number_(
        row["Review Occurrences"]
      ),
    firstBusinessDate:
      V2P4_dateKey_(
        row["First Business Date"]
      ),
    latestBusinessDate:
      V2P4_dateKey_(
        row["Latest Business Date"]
      ),
    latestOccurrenceId:
      V2P4_text_(
        row["Latest Occurrence ID"]
      ),
    latestHandlerId:
      V2P4_text_(
        row["Latest Handler ID"]
      ),
    latestHandlerName:
      V2P4_text_(
        row["Latest Handler Name"]
      ),
    latestOperationalStatus:
      V2P4_text_(
        row["Latest Operational Status"]
      ),
    latestOutcomeStatus:
      V2P4_text_(
        row["Latest Outcome Status"]
      ),
    selected:
      V2P4_number_(
        row["Selected"]
      ),
    phase3Version:
      V2P4_text_(
        row["Phase3 Version"]
      )
  };

}


function V2P4_publicEvent_(
  row
){

  return {
    eventId:
      V2P4_text_(
        row["Event ID"]
      ),
    candidateId:
      V2P4_text_(
        row["Candidate ID"]
      ),
    teamId:
      V2P4_text_(
        row["Team ID"]
      ),
    eventDate:
      V2P4_dateKey_(
        row["Event DateTime"]
      ),
    eventType:
      V2P4_text_(
        row["Event Type"]
      ),
    client:
      V2P4_text_(
        row["Client"]
      ),
    roundLabel:
      V2P4_text_(
        row["Round Label"]
      ),
    roundNo:
      V2P4_numberOrBlank_(
        row["Round No"]
      ),
    handlerId:
      V2P4_text_(
        row["Handler ID"]
      ),
    handlerName:
      V2P4_text_(
        row["Handler Name"]
      ),
    callId:
      V2P4_text_(
        row["Call ID"]
      ),
    source:
      V2P4_text_(
        row["Source"]
      ),
    sourceRow:
      V2P4_numberOrBlank_(
        row["Source Row"]
      ),
    status:
      V2P4_text_(
        row["Status"]
      ),
    details:
      V2P4_text_(
        row["Details"]
      )
  };

}


function V2P4_publicReview_(
  row
){

  return {
    reviewId:
      V2P4_text_(
        row["Review ID"]
      ),
    callId:
      V2P4_text_(
        row["Call ID"]
      ),
    businessDate:
      V2P4_dateKey_(
        row["Business Date Key"] ||
        row["Business Date"]
      ),
    teamDataRow:
      V2P4_numberOrBlank_(
        row["Team Data Row"]
      ),
    candidateRaw:
      V2P4_text_(
        row["Candidate Raw"]
      ),
    candidateId:
      V2P4_text_(
        row["Candidate ID"]
      ),
    officialCandidateName:
      V2P4_text_(
        row["Official Candidate Name"]
      ),
    client:
      V2P4_text_(
        row["Client Raw"]
      ),
    roundLabel:
      V2P4_text_(
        row["Round Label"]
      ),
    roundNo:
      V2P4_numberOrBlank_(
        row["Round No"]
      ),
    timeNormalized:
      V2P4_timeLabel_(
        row["Time Normalized"],
        ""
      ),
    handlerRaw:
      V2P4_text_(
        row["Handler Raw"]
      ),
    operationalStatus:
      V2P4_text_(
        row["Operational Status"]
      ),
    outcomeStatus:
      V2P4_text_(
        row["Outcome Status"]
      ),
    linkStatus:
      V2P4_text_(
        row["Link Status"]
      ),
    bestScore:
      V2P4_number_(
        row["Best Score"]
      ),
    secondBestScore:
      V2P4_number_(
        row["Second Best Score"]
      ),
    margin:
      V2P4_number_(
        row["Margin"]
      ),
    bestGatewayId:
      V2P4_text_(
        row["Best Gateway ID"]
      ),
    candidateGatewayIds:
      V2P4_text_(
        row["Candidate Gateway IDs"]
      ),
    reason:
      V2P4_text_(
        row["Reason"]
      ),
    phase2Version:
      V2P4_text_(
        row["Phase2 Version"]
      )
  };

}


function V2P4_buildHandlerHistory_(
  occurrences
){

  const map = {};

  occurrences.forEach(
    function(row){

      const handlerId =
        V2P4_text_(
          row["Handler ID"]
        );

      const handlerName =
        V2P4_text_(
          row["Handler Name"]
        );

      if(!handlerId && !handlerName){
        return;
      }

      const key =
        handlerId
          ? "ID:" + handlerId
          : "NAME:" +
            V2P4_normalize_(
              handlerName
            );

      if(!map[key]){
        map[key] = {
          handlerId: handlerId,
          handlerName: handlerName,
          teamId:
            V2P4_text_(
              row["Team ID"]
            ),
          occurrenceCount: 0,
          firstBusinessDate: "",
          latestBusinessDate: "",
          latestOperationalStatus: ""
        };
      }

      const item =
        map[key];

      item.occurrenceCount++;

      const dateKey =
        V2P4_dateKey_(
          row["Business Date Key"] ||
          row["Business Date"]
        );

      if(
        !item.firstBusinessDate ||
        V2P4_dateOrdinal_(dateKey) <
        V2P4_dateOrdinal_(
          item.firstBusinessDate
        )
      ){
        item.firstBusinessDate =
          dateKey;
      }

      if(
        !item.latestBusinessDate ||
        V2P4_dateOrdinal_(dateKey) >
        V2P4_dateOrdinal_(
          item.latestBusinessDate
        )
      ){
        item.latestBusinessDate =
          dateKey;

        item.latestOperationalStatus =
          V2P4_text_(
            row["Operational Status"]
          );
      }

    }
  );

  return Object.keys(map)
    .map(
      function(key){
        return map[key];
      }
    )
    .sort(
      function(a,b){
        return (
          V2P4_dateOrdinal_(
            b.latestBusinessDate
          ) -
          V2P4_dateOrdinal_(
            a.latestBusinessDate
          )
        );
      }
    );

}


/******************************************************
 * PRIVATE — SORTING
 ******************************************************/
function V2P4_occurrenceNewestFirst_(
  a,
  b
){

  const diff =
    V2P4_occurrenceSortValue_(b) -
    V2P4_occurrenceSortValue_(a);

  if(diff !== 0){
    return diff;
  }

  return V2P4_text_(
    b["Occurrence ID"]
  ).localeCompare(
    V2P4_text_(
      a["Occurrence ID"]
    )
  );

}


function V2P4_occurrenceSortValue_(
  row
){

  const datePart =
    V2P4_dateOrdinal_(
      row["Business Date Key"] ||
      row["Business Date"]
    );

  let minutePart =
    V2P4_numberOrBlank_(
      row["Start Minutes"]
    );

  if(minutePart === ""){
    minutePart = 9999;
  }else if(
    minutePart <
    V2_PHASE4.AFTER_MIDNIGHT_CARRY_CUTOFF_MINUTES
  ){
    minutePart += 1440;
  }

  const sourceRow =
    V2P4_number_(
      row["Team Data Row"] ||
      row["Gateway Source Row"]
    );

  return (
    datePart * 10000 +
    Number(minutePart) +
    sourceRow / 1000000
  );

}


function V2P4_logicalNewestFirst_(
  a,
  b
){

  const dateDiff =
    V2P4_dateOrdinal_(
      b["Latest Business Date"]
    ) -
    V2P4_dateOrdinal_(
      a["Latest Business Date"]
    );

  if(dateDiff !== 0){
    return dateDiff;
  }

  return V2P4_text_(
    b["Logical Interview ID"]
  ).localeCompare(
    V2P4_text_(
      a["Logical Interview ID"]
    )
  );

}


function V2P4_reviewNewestFirst_(
  a,
  b
){

  const dateDiff =
    V2P4_dateOrdinal_(
      b["Business Date Key"] ||
      b["Business Date"]
    ) -
    V2P4_dateOrdinal_(
      a["Business Date Key"] ||
      a["Business Date"]
    );

  if(dateDiff !== 0){
    return dateDiff;
  }

  return V2P4_number_(
    b["Team Data Row"]
  ) -
  V2P4_number_(
    a["Team Data Row"]
  );

}


function V2P4_eventNewestFirst_(
  a,
  b
){

  const dateDiff =
    V2P4_dateOrdinal_(
      b["Event DateTime"]
    ) -
    V2P4_dateOrdinal_(
      a["Event DateTime"]
    );

  if(dateDiff !== 0){
    return dateDiff;
  }

  const typeA =
    V2P4_text_(
      a["Event Type"]
    );

  const typeB =
    V2P4_text_(
      b["Event Type"]
    );

  if(typeA !== typeB){
    return typeB.localeCompare(
      typeA
    );
  }

  return V2P4_text_(
    b["Event ID"]
  ).localeCompare(
    V2P4_text_(
      a["Event ID"]
    )
  );

}


function V2P4_candidateNewestFirst_(
  a,
  b
){

  const dateDiff =
    V2P4_dateOrdinal_(
      b["Latest Business Date"]
    ) -
    V2P4_dateOrdinal_(
      a["Latest Business Date"]
    );

  if(dateDiff !== 0){
    return dateDiff;
  }

  const countDiff =
    V2P4_number_(
      b["Total Occurrences"]
    ) -
    V2P4_number_(
      a["Total Occurrences"]
    );

  if(countDiff !== 0){
    return countDiff;
  }

  return V2P4_text_(
    a["Subject Key"]
  ).localeCompare(
    V2P4_text_(
      b["Subject Key"]
    )
  );

}


function V2P4_occurrenceNeedsReview_(
  row
){

  const occurrenceStatus =
    V2P4_text_(
      row["Occurrence Status"]
    ).toUpperCase();

  const linkStatus =
    V2P4_text_(
      row["Link Status"]
    ).toUpperCase();

  return (
    occurrenceStatus ===
      "TEAM_ONLY_REVIEW" ||
    linkStatus.indexOf(
      "REVIEW_"
    ) === 0
  );

}


/******************************************************
 * PRIVATE — SHEET / HEADER SAFETY
 ******************************************************/
function V2P4_sheetContainsHeaders_(
  sheet,
  requiredHeaders
){

  if(
    !sheet ||
    sheet.getLastColumn() < 1
  ){
    return false;
  }

  const actual =
    sheet.getRange(
      1,
      1,
      1,
      sheet.getLastColumn()
    ).getValues()[0]
      .map(
        V2P4_text_
      );

  return requiredHeaders.every(
    function(header){
      return actual.indexOf(
        header
      ) >= 0;
    }
  );

}


function V2P4_rowHasValue_(
  row
){

  return (row || []).some(
    function(value){
      return V2P4_hasValue_(
        value
      );
    }
  );

}


/******************************************************
 * PRIVATE — BACKEND ROUTER
 ******************************************************/
function V2P4_backend_(){

  if(
    typeof V2_backend_ !==
      "function"
  ){
    throw new Error(
      "V2P4_BACKEND_ROUTER_NOT_FOUND|Phase1_required"
    );
  }

  return V2_backend_();

}


/******************************************************
 * PRIVATE — VALUE / DATE HELPERS
 ******************************************************/
function V2P4_text_(
  value
){

  return String(
    value === null ||
    value === undefined
      ? ""
      : value
  ).trim();

}


function V2P4_hasValue_(
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

  return V2P4_text_(
    value
  ) !== "";

}


function V2P4_number_(
  value
){

  const number =
    Number(
      value
    );

  return Number.isFinite(
    number
  )
    ? number
    : 0;

}


function V2P4_numberOrBlank_(
  value
){

  if(!V2P4_hasValue_(value)){
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


function V2P4_limit_(
  value,
  defaultValue,
  maxValue
){

  const number =
    Number(
      value
    );

  if(
    !Number.isFinite(number) ||
    number <= 0
  ){
    return defaultValue;
  }

  return Math.min(
    Math.floor(number),
    maxValue
  );

}


function V2P4_timeLabel_(
  value,
  startMinutes
){

  const numericMinutes =
    Number(
      startMinutes
    );

  if(
    startMinutes !== "" &&
    startMinutes !== null &&
    startMinutes !== undefined &&
    Number.isFinite(
      numericMinutes
    )
  ){
    return V2P4_minutesToTimeLabel_(
      numericMinutes
    );
  }

  if(
    Object.prototype.toString.call(
      value
    ) === "[object Date]" &&
    !isNaN(
      value.getTime()
    )
  ){
    return V2P4_minutesToTimeLabel_(
      (
        value.getHours() * 60
      ) +
      value.getMinutes()
    );
  }

  const text =
    V2P4_text_(
      value
    );

  if(!text){
    return "";
  }

  // Already-normalized 12-hour time.
  const twelveHour =
    text.match(
      /^(\d{1,2}):(\d{2})\s*([AP]M)$/i
    );

  if(twelveHour){

    let hour =
      Number(
        twelveHour[1]
      );

    const minute =
      Number(
        twelveHour[2]
      );

    const meridiem =
      twelveHour[3].toUpperCase();

    if(
      hour >= 1 &&
      hour <= 12 &&
      minute >= 0 &&
      minute <= 59
    ){

      if(hour === 12){
        hour = 0;
      }

      if(meridiem === "PM"){
        hour += 12;
      }

      return V2P4_minutesToTimeLabel_(
        hour * 60 + minute
      );

    }

  }

  // 24-hour time string.
  const twentyFourHour =
    text.match(
      /^(\d{1,2}):(\d{2})(?::\d{2})?$/
    );

  if(twentyFourHour){

    const hour =
      Number(
        twentyFourHour[1]
      );

    const minute =
      Number(
        twentyFourHour[2]
      );

    if(
      hour >= 0 &&
      hour <= 23 &&
      minute >= 0 &&
      minute <= 59
    ){
      return V2P4_minutesToTimeLabel_(
        hour * 60 + minute
      );
    }

  }

  // Google Sheets may stringify a time-only Date cell as:
  // Sat Dec 30 1899 18:30:00 GMT+0521 (...)
  // Read the wall-clock HH:mm directly from the string so
  // historical timezone offsets cannot shift the intended time.
  const verboseDateTime =
    text.match(
      /\b(\d{1,2}):(\d{2})(?::\d{2})?\s+GMT[+-]\d{4}/i
    );

  if(verboseDateTime){

    const hour =
      Number(
        verboseDateTime[1]
      );

    const minute =
      Number(
        verboseDateTime[2]
      );

    if(
      hour >= 0 &&
      hour <= 23 &&
      minute >= 0 &&
      minute <= 59
    ){
      return V2P4_minutesToTimeLabel_(
        hour * 60 + minute
      );
    }

  }

  // If an unfamiliar representation reaches the API, keep
  // the original text rather than inventing a time.
  return text;

}


function V2P4_minutesToTimeLabel_(
  minutes
){

  let total =
    Math.round(
      Number(
        minutes
      )
    );

  if(!Number.isFinite(total)){
    return "";
  }

  total =
    (
      total % 1440 +
      1440
    ) % 1440;

  const hour24 =
    Math.floor(
      total / 60
    );

  const minute =
    total % 60;

  const meridiem =
    hour24 >= 12
      ? "PM"
      : "AM";

  let hour12 =
    hour24 % 12;

  if(hour12 === 0){
    hour12 = 12;
  }

  return (
    hour12 +
    ":" +
    String(
      minute
    ).padStart(
      2,
      "0"
    ) +
    " " +
    meridiem
  );

}


function V2P4_dateKey_(
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
    V2P4_text_(
      value
    );

  if(!text){
    return "";
  }

  const iso =
    text.match(
      /^(\d{4})-(\d{2})-(\d{2})$/
    );

  if(iso){
    return (
      iso[1] + "-" +
      iso[2] + "-" +
      iso[3]
    );
  }

  // Google Sheets may stringify a date-formatted cell as:
  // Tue Jul 21 2026 00:00:00 GMT+0530 (...)
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

    if(!isNaN(parsed.getTime())){
      return Utilities.formatDate(
        parsed,
        Session.getScriptTimeZone(),
        "yyyy-MM-dd"
      );
    }

  }

  return "";

}


function V2P4_dateOrdinal_(
  value
){

  const key =
    V2P4_dateKey_(
      value
    );

  const match =
    key.match(
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


function V2P4_normalize_(
  value
){

  let text =
    V2P4_text_(
      value
    ).toLowerCase();

  if(!text){
    return "";
  }

  try{
    text =
      text.normalize(
        "NFKD"
      );
  }catch(error){
    // Safe Apps Script fallback.
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
 * PRIVATE — COUNTS / VERSION HELPERS
 ******************************************************/
function V2P4_duplicateCount_(
  rows,
  field
){

  const seen = {};
  let duplicates = 0;

  (rows || []).forEach(
    function(row){

      const value =
        V2P4_text_(
          row[field]
        );

      if(!value){
        return;
      }

      if(seen[value]){
        duplicates++;
      }else{
        seen[value] = true;
      }

    }
  );

  return duplicates;

}


function V2P4_uniqueTextValues_(
  rows,
  field
){

  const map = {};

  (rows || []).forEach(
    function(row){

      const value =
        V2P4_text_(
          row[field]
        );

      if(value){
        map[value] = true;
      }

    }
  );

  return Object.keys(
    map
  ).sort();

}


/******************************************************
 * PRIVATE — LOGGING
 ******************************************************/
function V2P4_logResult_(
  title,
  result
){

  const line =
    "========== " +
    title +
    " ==========";

  Logger.log(
    line
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
      Math.max(
        10,
        line.length
      )
    )
  );

}
