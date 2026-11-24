/******************************************************
 * V2_PHASE4_BRIDGECOMMANDS.GS
 * Interview Operations Portal V2
 * Phase 4 -> Existing Private Incentive Bridge extension
 *
 * INSTALL IN:
 *   Incentive Backend - Private -> Apps Script
 *
 * VERSION:
 *   V2-PHASE4-BRIDGE-COMMANDS-1.0.0
 *
 * PURPOSE:
 *   Whitelist READ-ONLY Phase 4 Candidate 360/API commands
 *   for the ALREADY-EXISTING private Incentive Bridge.
 *
 * IMPORTANT:
 * - This file does NOT define doGet() or doPost().
 * - It does NOT replace the existing incentive/recovery bridge.
 * - It does NOT write to any sheet.
 * - The existing bridge secret remains authoritative.
 * - Requires V2_Phase4_API.gs v1.0.1 or later.
 ******************************************************/

const V2P4_BRIDGE = Object.freeze({
  VERSION:
    "V2-PHASE4-BRIDGE-COMMANDS-1.0.0",

  REQUIRED_PHASE4_VERSION:
    "V2-PHASE4-PORTAL-API-1.0.1"
});


/******************************************************
 * ENTRY POINT CALLED ONLY FROM EXISTING doPost()
 *
 * Returns:
 *   { handled: true, data: ... }
 * or
 *   { handled: false, data: null }
 ******************************************************/
function V2P4_bridgeCommandReadOnly_(
  command,
  payload
){

  const cmd =
    String(
      command || ""
    ).trim();

  const p =
    payload &&
    typeof payload === "object"
      ? payload
      : {};

  switch(cmd){

    case "v2p4Health":
      return {
        handled: true,
        data:
          V2P4_testPhase4HealthReadOnly()
      };

    case "v2p4SearchCandidates":
      return {
        handled: true,
        data:
          V2P4_searchCandidatesReadOnly(
            p.query,
            p.limit
          )
      };

    case "v2p4Candidate360":
      return {
        handled: true,
        data:
          V2P4_getCandidate360ReadOnly(
            p.candidateRef
          )
      };

    case "v2p4CandidateTimeline":
      return {
        handled: true,
        data:
          V2P4_getCandidateTimelineReadOnly(
            p.candidateRef
          )
      };

    case "v2p4LogicalInterviews":
      return {
        handled: true,
        data:
          V2P4_getLogicalInterviewsReadOnly(
            p.candidateRef
          )
      };

    case "v2p4OccurrenceDetails":
      return {
        handled: true,
        data:
          V2P4_getOccurrenceDetailsReadOnly(
            p.occurrenceId
          )
      };

    case "v2p4ReviewQueue":
      return {
        handled: true,
        data:
          V2P4_getReviewQueueReadOnly(
            p.limit
          )
      };

    case "v2p4CandidateBundle":
      return {
        handled: true,
        data:
          V2P4_getPortalCandidateBundleReadOnly(
            p.candidateRef
          )
      };

    default:
      return {
        handled: false,
        data: null
      };

  }

}


/******************************************************
 * READ-ONLY INSTALL HEALTH
 *
 * Run manually in Incentive Backend - Private before
 * redeploying the existing private bridge.
 ******************************************************/
function V2P4_testBridgeCommandsHealthReadOnly(){

  const phase4Available =
    (
      typeof V2P4_testPhase4HealthReadOnly ===
        "function" &&
      typeof V2P4_searchCandidatesReadOnly ===
        "function" &&
      typeof V2P4_getCandidate360ReadOnly ===
        "function" &&
      typeof V2P4_getCandidateTimelineReadOnly ===
        "function" &&
      typeof V2P4_getLogicalInterviewsReadOnly ===
        "function" &&
      typeof V2P4_getOccurrenceDetailsReadOnly ===
        "function" &&
      typeof V2P4_getReviewQueueReadOnly ===
        "function" &&
      typeof V2P4_getPortalCandidateBundleReadOnly ===
        "function"
    );

  const bridgeDoPostAvailable =
    (
      typeof doPost ===
        "function"
    );

  let phase4Health = null;

  if(phase4Available){
    phase4Health =
      V2P4_testPhase4HealthReadOnly();
  }

  const result = {
    ok:
      Boolean(
        phase4Available &&
        bridgeDoPostAvailable &&
        phase4Health &&
        phase4Health.ok === true
      ),

    mode:
      "READ_ONLY",

    bridgeCommandsVersion:
      V2P4_BRIDGE.VERSION,

    requiredPhase4Version:
      V2P4_BRIDGE
        .REQUIRED_PHASE4_VERSION,

    phase4Available:
      phase4Available,

    existingDoPostFound:
      bridgeDoPostAvailable,

    phase4Health:
      phase4Health
  };

  Logger.log(
    "========== V2 PHASE 4 BRIDGE COMMAND HEALTH =========="
  );

  Logger.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );

  Logger.log(
    "======================================================"
  );

  return result;

}
