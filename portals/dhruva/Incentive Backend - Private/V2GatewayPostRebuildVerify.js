/******************************************************
 * V2GATEWAYPOSTREBUILDVERIFY.GS
 * Interview Operations Portal V2
 *
 * READ-ONLY post-rebuild verification.
 *
 * PURPOSE
 * -------
 * Verify that the Candidate-aware Gateway rebuild wrote
 * exactly the same Candidate ID / official name / status /
 * score that the current Candidate Matcher recomputes.
 *
 * NO WRITES.
 ******************************************************/


function V2_verifyGatewayCandidateRebuildReadOnly(){

  const gateway =
    V2Repo_getGateway({});

  const candidates =
    V2Repo_getCandidates();

  const masterIndex =
    V2_loadCandidateMaster_();

  const candidateById = {};

  candidates.forEach(
    function(row){

      const id =
        String(
          row["Candidate ID"] || ""
        ).trim();

      if(id){
        candidateById[id] = row;
      }

    }
  );

  const autoStatuses = {
    AUTO_EXACT_NORMALIZED:
      true,
    AUTO_TOKEN_EQUIVALENT:
      true,
    AUTO_NEAR_TYPO:
      true
  };

  const expectedStatusCounts = {};
  const storedStatusCounts = {};
  const parseStatusCounts = {};

  let candidateIdMismatch = 0;
  let officialNameMismatch = 0;
  let statusMismatch = 0;
  let scoreMismatch = 0;

  let autoMissingCandidateId = 0;
  let autoUnknownCandidateId = 0;
  let unresolvedHasCandidateId = 0;
  let unresolvedHasOfficialName = 0;

  let parserVersionMismatch = 0;
  let missingGatewayId = 0;

  const gatewayIds = {};
  const duplicateGatewayIds = [];

  const mismatchExamples = [];

  gateway.forEach(
    function(row,index){

      const gatewayId =
        String(
          row["Gateway ID"] || ""
        ).trim();

      if(!gatewayId){
        missingGatewayId++;
      }else if(gatewayIds[gatewayId]){
        duplicateGatewayIds.push(
          gatewayId
        );
      }else{
        gatewayIds[gatewayId] = true;
      }

      const parserVersion =
        String(
          row["Parser Version"] || ""
        ).trim();

      if(
        parserVersion !==
        "GW-PARSER-1.4.0"
      ){
        parserVersionMismatch++;
      }

      const parseStatus =
        String(
          row["Parse Status"] || ""
        ).trim();

      parseStatusCounts[
        parseStatus || "(blank)"
      ] =
        (
          parseStatusCounts[
            parseStatus || "(blank)"
          ] || 0
        ) + 1;

      const raw =
        String(
          row["Candidate Raw"] || ""
        ).trim();

      const expected =
        V2_matchCandidate_(
          raw,
          masterIndex
        );

      const storedCandidateId =
        String(
          row["Candidate ID"] || ""
        ).trim();

      const storedOfficialName =
        String(
          row["Official Candidate Name"] || ""
        ).trim();

      const storedStatus =
        String(
          row["Candidate Match Status"] || ""
        ).trim();

      const storedScoreRaw =
        row["Candidate Match Score"];

      const storedScore =
        (
          storedScoreRaw === "" ||
          storedScoreRaw === null ||
          typeof storedScoreRaw === "undefined"
        )
          ? ""
          : Number(
              storedScoreRaw
            );

      const expectedScore =
        (
          expected.score === "" ||
          expected.score === null ||
          typeof expected.score === "undefined"
        )
          ? ""
          : Number(
              expected.score
            );

      expectedStatusCounts[
        expected.status
      ] =
        (
          expectedStatusCounts[
            expected.status
          ] || 0
        ) + 1;

      storedStatusCounts[
        storedStatus || "(blank)"
      ] =
        (
          storedStatusCounts[
            storedStatus || "(blank)"
          ] || 0
        ) + 1;

      const rowIssues = [];

      if(
        storedCandidateId !==
        String(
          expected.candidateId || ""
        ).trim()
      ){
        candidateIdMismatch++;
        rowIssues.push(
          "CANDIDATE_ID"
        );
      }

      if(
        storedOfficialName !==
        String(
          expected.officialName || ""
        ).trim()
      ){
        officialNameMismatch++;
        rowIssues.push(
          "OFFICIAL_NAME"
        );
      }

      if(
        storedStatus !==
        String(
          expected.status || ""
        ).trim()
      ){
        statusMismatch++;
        rowIssues.push(
          "STATUS"
        );
      }

      const scoresEqual =
        (
          storedScore === "" &&
          expectedScore === ""
        ) ||
        (
          storedScore !== "" &&
          expectedScore !== "" &&
          Math.abs(
            storedScore -
            expectedScore
          ) < 0.0001
        );

      if(!scoresEqual){
        scoreMismatch++;
        rowIssues.push(
          "SCORE"
        );
      }

      if(autoStatuses[storedStatus]){

        if(!storedCandidateId){
          autoMissingCandidateId++;
          rowIssues.push(
            "AUTO_NO_ID"
          );
        }

        if(
          storedCandidateId &&
          !candidateById[
            storedCandidateId
          ]
        ){
          autoUnknownCandidateId++;
          rowIssues.push(
            "AUTO_UNKNOWN_ID"
          );
        }

      }else{

        if(storedCandidateId){
          unresolvedHasCandidateId++;
          rowIssues.push(
            "UNRESOLVED_HAS_ID"
          );
        }

        if(storedOfficialName){
          unresolvedHasOfficialName++;
          rowIssues.push(
            "UNRESOLVED_HAS_OFFICIAL"
          );
        }

      }

      if(
        rowIssues.length &&
        mismatchExamples.length < 20
      ){

        mismatchExamples.push({
          gatewayRow:
            index + 2,

          gatewayId:
            gatewayId,

          candidateRaw:
            raw,

          issues:
            rowIssues,

          stored: {
            candidateId:
              storedCandidateId,
            officialName:
              storedOfficialName,
            status:
              storedStatus,
            score:
              storedScore
          },

          expected: {
            candidateId:
              expected.candidateId || "",
            officialName:
              expected.officialName || "",
            status:
              expected.status || "",
            score:
              expectedScore
          }
        });

      }

    }
  );

  const expectedAutoLinked =
    (
      expectedStatusCounts[
        "AUTO_EXACT_NORMALIZED"
      ] || 0
    ) +
    (
      expectedStatusCounts[
        "AUTO_TOKEN_EQUIVALENT"
      ] || 0
    ) +
    (
      expectedStatusCounts[
        "AUTO_NEAR_TYPO"
      ] || 0
    );

  const storedAutoLinked =
    (
      storedStatusCounts[
        "AUTO_EXACT_NORMALIZED"
      ] || 0
    ) +
    (
      storedStatusCounts[
        "AUTO_TOKEN_EQUIVALENT"
      ] || 0
    ) +
    (
      storedStatusCounts[
        "AUTO_NEAR_TYPO"
      ] || 0
    );

  const ok =
    (
      gateway.length === 3321 &&
      candidates.length === 1074 &&

      parseStatusCounts.READY === 3313 &&
      parseStatusCounts.REVIEW === 8 &&

      expectedAutoLinked === 2415 &&
      storedAutoLinked === 2415 &&

      candidateIdMismatch === 0 &&
      officialNameMismatch === 0 &&
      statusMismatch === 0 &&
      scoreMismatch === 0 &&

      autoMissingCandidateId === 0 &&
      autoUnknownCandidateId === 0 &&
      unresolvedHasCandidateId === 0 &&
      unresolvedHasOfficialName === 0 &&

      parserVersionMismatch === 0 &&
      missingGatewayId === 0 &&
      duplicateGatewayIds.length === 0
    );

  const result = {

    ok:
      ok,

    mode:
      "READ_ONLY",

    parserVersion:
      "GW-PARSER-1.4.0",

    matcherVersion:
      (
        typeof V2_CANDIDATE_MATCHER !==
          "undefined"
      )
        ? V2_CANDIDATE_MATCHER.VERSION
        : "MISSING",

    counts: {
      gatewayRows:
        gateway.length,
      candidateMasterRows:
        candidates.length,
      storedAutoLinked:
        storedAutoLinked,
      expectedAutoLinked:
        expectedAutoLinked
    },

    parseStatus:
      parseStatusCounts,

    storedCandidateMatchStatus:
      storedStatusCounts,

    expectedCandidateMatchStatus:
      expectedStatusCounts,

    integrity: {
      candidateIdMismatch:
        candidateIdMismatch,
      officialNameMismatch:
        officialNameMismatch,
      statusMismatch:
        statusMismatch,
      scoreMismatch:
        scoreMismatch,
      autoMissingCandidateId:
        autoMissingCandidateId,
      autoUnknownCandidateId:
        autoUnknownCandidateId,
      unresolvedHasCandidateId:
        unresolvedHasCandidateId,
      unresolvedHasOfficialName:
        unresolvedHasOfficialName,
      parserVersionMismatch:
        parserVersionMismatch,
      missingGatewayId:
        missingGatewayId,
      duplicateGatewayIds:
        duplicateGatewayIds
    },

    mismatchExamples:
      mismatchExamples

  };

  Logger.log(
    "========== V2 GATEWAY POST-REBUILD VERIFY =========="
  );

  Logger.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );

  Logger.log(
    "===================================================="
  );

  return result;

}
