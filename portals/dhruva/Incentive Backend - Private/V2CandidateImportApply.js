/******************************************************
 * V2CANDIDATEIMPORTAPPLY.GS
 * Interview Operations Portal V2
 *
 * INITIAL Candidate Master import controller.
 *
 * REQUIRES:
 * - V2CandidateImportPreview.gs already installed
 * - V2Repository.gs with initial import adapter
 *
 * SAFETY:
 * - Validates the exact reviewed source fingerprint.
 * - Requires 1,074 source candidates.
 * - Requires zero blocked rows.
 * - Requires Candidate Master to be empty before first import.
 * - Uses LockService to prevent double-click races.
 * - Repository layer performs the only Sheet write.
 ******************************************************/


const V2_CANDIDATE_IMPORT_APPROVAL =
  Object.freeze({

    SOURCE_FINGERPRINT:
      "CANDSRC-3719ABD061D4B79A0796",

    SOURCE_ROWS:
      1074,

    DUPLICATE_NAME_GROUPS:
      12

  });


/******************************************************
 * PUBLIC: READ-ONLY IMPORT READINESS CHECK
 ******************************************************/
function V2_checkCandidateMasterImportReady(){

  const source =
    V2CandidateImport_readSource_();

  const existing =
    V2Repo_getCandidates();

  const analysis =
    V2CandidateImport_analyzeSource_(
      source.rows
    );

  const masterAnalysis =
    V2CandidateImport_analyzeExistingMaster_(
      existing
    );

  const proposal =
    V2CandidateImport_buildProposal_(
      source.rows,
      existing
    );

  const fingerprint =
    V2CandidateImport_sourceFingerprint_(
      source.rows
    );

  const checks = {

    fingerprintMatches:
      (
        fingerprint ===
        V2_CANDIDATE_IMPORT_APPROVAL
          .SOURCE_FINGERPRINT
      ),

    sourceRowCountMatches:
      (
        source.rows.length ===
        V2_CANDIDATE_IMPORT_APPROVAL
          .SOURCE_ROWS
      ),

    duplicateNameGroupCountMatches:
      (
        analysis
          .duplicateNameGroups
          .length ===
        V2_CANDIDATE_IMPORT_APPROVAL
          .DUPLICATE_NAME_GROUPS
      ),

    sourceHasNoBlockingIssues:
      (
        analysis.blockingIssues ===
        0
      ),

    masterHasNoBlockingIssues:
      (
        masterAnalysis
          .blockingIssues ===
        0
      ),

    proposalHasNoBlockedRows:
      (
        proposal.blockedCount ===
        0
      ),

    candidateMasterEmpty:
      (
        existing.length ===
        0
      ),

    proposedInsertCount:
      proposal.insertCount,

    proposedUpdateCount:
      proposal.updateCount,

    proposedUnchangedCount:
      proposal.unchangedCount

  };

  const ok =
    (
      checks.fingerprintMatches &&
      checks.sourceRowCountMatches &&
      checks.duplicateNameGroupCountMatches &&
      checks.sourceHasNoBlockingIssues &&
      checks.masterHasNoBlockingIssues &&
      checks.proposalHasNoBlockedRows &&
      checks.candidateMasterEmpty &&
      checks.proposedInsertCount ===
        V2_CANDIDATE_IMPORT_APPROVAL
          .SOURCE_ROWS &&
      checks.proposedUpdateCount ===
        0 &&
      checks.proposedUnchangedCount ===
        0
    );

  const result = {

    ok:
      ok,

    mode:
      "READ_ONLY",

    approvedFingerprint:
      V2_CANDIDATE_IMPORT_APPROVAL
        .SOURCE_FINGERPRINT,

    currentFingerprint:
      fingerprint,

    sourceRows:
      source.rows.length,

    existingCandidateMasterRows:
      existing.length,

    duplicateNameGroups:
      analysis
        .duplicateNameGroups
        .length,

    blockedRows:
      proposal.blockedCount,

    checks:
      checks

  };

  Logger.log(
    "========== V2 CANDIDATE IMPORT READINESS =========="
  );

  Logger.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );

  Logger.log(
    "==================================================="
  );

  return result;

}


/******************************************************
 * PUBLIC: APPLY INITIAL IMPORT
 *
 * DO NOT RUN until readiness result is ok:true.
 ******************************************************/
function V2_applyCandidateMasterInitialImport(){

  const lock =
    LockService
      .getScriptLock();

  lock.waitLock(
    30000
  );

  try{

    const readiness =
      V2_checkCandidateMasterImportReady();

    if(!readiness.ok){
      throw new Error(
        "V2_CANDIDATE_IMPORT_NOT_READY"
      );
    }

    const source =
      V2CandidateImport_readSource_();

    const existing =
      V2Repo_getCandidates();

    const proposal =
      V2CandidateImport_buildProposal_(
        source.rows,
        existing
      );

    const proposedBySourceRow = {};

    proposal
      .proposedRows
      .forEach(
        function(item){

          proposedBySourceRow[
            item.sourceRow
          ] =
            item;

        }
      );

    const profiles = [];

    source.rows.forEach(
      function(sourceRow){

        const proposalRow =
          proposedBySourceRow[
            sourceRow.sourceRow
          ];

        if(!proposalRow){
          throw new Error(
            "V2_CANDIDATE_IMPORT_PROPOSAL_MISSING|" +
            "sourceRow=" +
            sourceRow.sourceRow
          );
        }

        profiles.push(
          V2CandidateImport_buildCandidateProfile_(
            sourceRow,
            proposalRow.candidateId
          )
        );

      }
    );

    const fingerprint =
      V2CandidateImport_sourceFingerprint_(
        source.rows
      );

    const writeResult =
      V2Repo_importCandidateMasterInitial(
        profiles,
        fingerprint
      );

    const result = {

      ok:
        true,

      status:
        writeResult.status,

      sourceRows:
        source.rows.length,

      candidateMasterRows:
        writeResult
          .candidateRows,

      written:
        writeResult.written,

      sourceFingerprint:
        fingerprint,

      firstCandidateId:
        profiles.length
          ? profiles[0][
              "Candidate ID"
            ]
          : "",

      lastCandidateIdInSourceOrder:
        profiles.length
          ? profiles[
              profiles.length - 1
            ][
              "Candidate ID"
            ]
          : ""

    };

    Logger.log(
      "========== V2 CANDIDATE MASTER IMPORT =========="
    );

    Logger.log(
      JSON.stringify(
        result,
        null,
        2
      )
    );

    Logger.log(
      "================================================"
    );

    return result;

  }finally{

    lock.releaseLock();

  }

}
