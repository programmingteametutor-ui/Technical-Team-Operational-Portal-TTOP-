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
  //--------------------------------------------------

  const rawRecords = loadRawData();

  Logger.log(
    "Raw Records : " +
    rawRecords.length
  );

  //--------------------------------------------------
  // Promotion Engine
  //--------------------------------------------------

  const promotions =
    buildPromotionHistory(rawRecords);

  Logger.log(
    "Promotions : " +
    promotions.length
  );

  writePromotionHistory(promotions);

  //--------------------------------------------------
  // Possible Matches
  //--------------------------------------------------

  generatePossibleMatches();

  //--------------------------------------------------
  // Load Team Data
  //--------------------------------------------------

  const teamRecords =
    loadTeamData();

  Logger.log(
    "Team Records : " +
    teamRecords.length
  );

  //--------------------------------------------------
  // Incentive Tracker
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

  writeIncentiveTracker(tracker);

  //--------------------------------------------------
  // Summary
  //--------------------------------------------------

  generateSummary();

  //--------------------------------------------------
  // Import Approved Aliases
  //--------------------------------------------------

  approveAliases();

  Logger.log("========== COMPLETE ==========");

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