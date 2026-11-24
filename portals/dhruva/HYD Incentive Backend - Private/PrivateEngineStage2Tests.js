/******************************************************
 * STAGE 2 PRIVATE ENGINE - SAFE TESTS
 ******************************************************/

function testPrivateEngineSourceCounts(){

  IR_requirePrivateBoundProject_();

  const raw =
    loadRawData();

  const team =
    loadTeamData();

  const result = {
    rawRecords:
      raw.length,
    teamRecords:
      team.length,
    privateTrackerRows:
      getPrivateTrackerSheet().getLastRow(),
    privatePromotionHistoryRows:
      IR_backend_()
        .getSheetByName(
          CONFIG.PROMOTION_HISTORY_SHEET
        )
        .getLastRow(),
    sharedSensitiveTabsStillPresent:
      IR_operations_()
        .getSheets()
        .map(function(s){ return s.getName(); })
        .filter(function(name){
          return [CONFIG.RAW_SHEET,CONFIG.TEAM_SHEET].indexOf(name) === -1;
        })
  };

  Logger.log(
    "========== PRIVATE ENGINE SOURCE COUNTS =========="
  );
  Logger.log(
    JSON.stringify(result,null,2)
  );
  Logger.log(
    "=================================================="
  );

  return result;
}


/******************************************************
 * RUN PRIVATE SCAN TEST
 *
 * This executes the normal heart scan from the private
 * backend. Shared Raw/Team are READ. Sensitive outputs
 * are written only to private backend.
 ******************************************************/
function testPrivateScanCutover(){

  IR_requirePrivateBoundProject_();

  const before = {
    sharedTrackerExists:
      !!IR_operations_()
        .getSheetByName(
          CONFIG.TRACKER_SHEET
        ),
    privateTrackerRows:
      getPrivateTrackerSheet()
        .getLastRow()
  };

  scanIncentives();

  const after = {
    sharedTrackerExists:
      !!IR_operations_()
        .getSheetByName(
          CONFIG.TRACKER_SHEET
        ),
    privateTrackerRows:
      getPrivateTrackerSheet()
        .getLastRow(),
    privatePromotionHistoryRows:
      IR_backend_()
        .getSheetByName(
          CONFIG.PROMOTION_HISTORY_SHEET
        )
        .getLastRow(),
    privateSummaryRows:
      IR_backend_()
        .getSheetByName(
          CONFIG.SUMMARY_SHEET
        )
        .getLastRow()
  };

  Logger.log(
    "========== PRIVATE SCAN CUTOVER TEST =========="
  );
  Logger.log(
    JSON.stringify({before:before,after:after},null,2)
  );
  Logger.log(
    "==============================================="
  );

  return {
    before:
      before,
    after:
      after
  };
}

