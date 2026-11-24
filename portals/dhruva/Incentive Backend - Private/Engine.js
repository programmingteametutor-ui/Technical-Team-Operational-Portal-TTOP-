/******************************************************
 * ENGINE.GS
 * Version 5.1
 ******************************************************/

/******************************************************
 * MAIN SCAN
 ******************************************************/
function scanIncentives(){

  Logger.log("========== START ==========");

  //--------------------------------------------------
  // Load Raw Data
  // Raw Data proves that a later/higher round exists.
  //--------------------------------------------------
  const rawRecords = loadRawData();

  Logger.log(
    "Raw Records : " +
    rawRecords.length
  );

  //--------------------------------------------------
  // Load Team Data FIRST for incentive ownership.
  // A valid Team Data call is the earning call.
  //--------------------------------------------------
  const teamRecords = loadTeamData();

  Logger.log(
    "Team Records : " +
    teamRecords.length
  );

  //--------------------------------------------------
  // TEAM-FIRST PROMOTION MODEL
  // For each valid Team Data call, Raw Data is searched
  // for the earliest later occurrence for the same
  // Candidate + Client with a HIGHER round.
  //--------------------------------------------------
  const promotions =
    buildPromotionHistory(
      rawRecords,
      teamRecords
    );

  Logger.log(
    "Team Calls With Confirmed Progression : " +
    promotions.length
  );

  writePromotionHistory(
    promotions
  );

  //--------------------------------------------------
  // Keep existing alias / possible-match workflow.
  //--------------------------------------------------
  generatePossibleMatches();

  //--------------------------------------------------
  // Build Incentive Tracker
  //--------------------------------------------------
  const tracker =
    buildIncentiveTracker(
      promotions,
      teamRecords
    );

  Logger.log(
    "Tracker : " +
    tracker.length
  );

  writeIncentiveTracker(
    tracker
  );

  //--------------------------------------------------
  // Summary
  //--------------------------------------------------
  generateSummary();

  //--------------------------------------------------
  // Import Approved Aliases
  //--------------------------------------------------
  approveAliases();

  Logger.log(
    "========== COMPLETE =========="
  );
}

/******************************************************
 * CUSTOM MENU
 ******************************************************/
function onOpen(){

  SpreadsheetApp
    .getUi()
    .createMenu("Incentives")

    .addItem(
      "Run Incentive Scan",
      "scanIncentives"
    )

    .addSeparator()

.addItem(
  "Recover Missed Promotions",
  "recoverMissedPromotions"
)

.addItem(
  "Apply Approved Recoveries",
  "applyApprovedRecoveries"
)

    .addItem(
      "Import Approved Aliases",
      "approveAliases"
    )

    .addToUi();

}