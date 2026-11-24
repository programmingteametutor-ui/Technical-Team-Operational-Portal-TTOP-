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

  if(typeof generatePossibleMatches === "function"){
    generatePossibleMatches();
  }else{
    Logger.log(
      "Possible Matches generator skipped: exact live source was not present in the recovery snapshot."
    );
  }

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

  if(typeof approveAliases === "function"){
    approveAliases();
  }else{
    Logger.log(
      "Alias approval import skipped: exact live approveAliases() source was not present in the recovery snapshot."
    );
  }

  Logger.log("========== COMPLETE ==========");

}


/******************************************************
 * CUSTOM MENU
 ******************************************************/
function onOpen(){

  const menu = SpreadsheetApp
    .getUi()
    .createMenu("HYD Incentives")
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
      "Refresh Recovery Evidence",
      "REC_refreshRecoveryEvidence"
    )
    .addSeparator()
    .addItem(
      "Validate HYD Backend",
      "HYD_validateBackendReadOnly"
    );

  if(typeof approveAliases === "function"){
    menu.addItem(
      "Import Approved Aliases",
      "approveAliases"
    );
  }

  menu.addToUi();
}

