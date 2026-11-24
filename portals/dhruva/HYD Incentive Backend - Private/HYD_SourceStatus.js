/******************************************************
 * HYD PRIVATE BACKEND - SOURCE STATUS
 ******************************************************/

const HYD_BACKEND_SOURCE_STATUS = {
  TEAM_ID: "TEAM-HYD",
  OPERATIONS_WORKBOOK_NAME: "HYD Incentive Tracker",
  INTERVIEW_SHEET: "HYD Interview Bot 2026",
  RAW_SHEET: "HYD Raw Data",
  TEAM_SHEET: "HYD Team Data",

  RECOVERY_ENGINE: "BEST_KNOWN_V1_1_FROM_SNAPSHOT",
  RECOVERY_LIMITATION:
    "Exact latest live RecoveryEngine.gs was not present in the supplied snapshot. " +
    "The included best-known engine preserves the recovered core matching, ambiguity, " +
    "invalid-occurrence, approval and evidence workflows but may create extra skipped-round review exceptions.",

  POSSIBLE_MATCHES_GENERATOR:
    "NOT_PRESENT_IN_SNAPSHOT",

  APPROVE_ALIASES_FUNCTION:
    "NOT_PRESENT_IN_SNAPSHOT"
};

function HYD_getSourceStatus(){
  return JSON.parse(
    JSON.stringify(HYD_BACKEND_SOURCE_STATUS)
  );
}
