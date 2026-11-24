/******************************************************
 * TEAM LOOKUP
 * Version 5.2 - TEAM-FIRST PROMOTION MODEL
 ******************************************************/

/******************************************************
 * BUILD INCENTIVE TRACKER
 ******************************************************/
function buildIncentiveTracker(promotions, teamRecords){

  const tracker = [];

  //--------------------------------------------------
  // Promotion Incentives
  //--------------------------------------------------

  promotions.forEach(function(promotion){

    const interview = findTeamInterview(

      teamRecords,

      promotion.previousRecord

    );

    if(!interview)
      return;

    const amount = getPromotionAmount(

      promotion.previousRoundNo,

      promotion.promotionRoundNo

    );

    if(amount <= 0)
      return;

    tracker.push({

      incentiveType : "Promotion",

      candidate : promotion.candidate,

      client : promotion.client,

      fromRound : promotion.previousRound,

      toRound : promotion.promotionRound,

      previousDate : promotion.previousDate,

      promotionDate : promotion.promotionDate,

      handler : interview.handler,

      amount : amount,

      status : "Pending"

    });

  });

  //--------------------------------------------------
  // Selection Incentives
  //--------------------------------------------------

  teamRecords.forEach(function(interview){

    if(interview.status != "selected")
      return;

    tracker.push({

      incentiveType : "Selection",

      candidate : interview.candidate,

      client : interview.client,

      fromRound : "-",

      toRound : "Selected",

      previousDate : "",

      promotionDate :
        interview.selectionDateObj ||
        interview.dateObj,

      handler : interview.handler,

      amount : INCENTIVES.SELECTED,

      status : "Pending"

    });

  });

  return tracker;

}
/******************************************************
 * FIND TEAM INTERVIEW
 ******************************************************/
function findTeamInterview(teamRecords, rawInterview){

  const targetKey = makeSmartKey(

    rawInterview.candidate,

    rawInterview.client

  );

  for(let i=0;i<teamRecords.length;i++){

    const team = teamRecords[i];

    //--------------------------------------------------
    // Candidate + Client
    //--------------------------------------------------

    const teamKey = makeSmartKey(

      team.candidate,

      team.client

    );

    if(teamKey != targetKey)
      continue;

    //--------------------------------------------------
    // Same Round
    //--------------------------------------------------

    if(team.roundNo != rawInterview.roundNo)
      continue;

    //--------------------------------------------------
    // Same Date
    //--------------------------------------------------

    if(formatDate(team.dateObj) != formatDate(rawInterview.dateObj))
      continue;

    //--------------------------------------------------
    // Ignore invalid handlers
    //--------------------------------------------------

    if(
      IGNORE_HANDLERS.indexOf(
        String(team.handler).toLowerCase()
      ) > -1
    ){
      continue;
    }

    return team;

  }

  return null;

}


/******************************************************
 * GET PROMOTION AMOUNT
 ******************************************************/
function getPromotionAmount(previousRound,nextRound){

  const from = Number(previousRound) || 0;
  const to = Number(nextRound) || 0;

  // Must actually progress to a higher round.
  if(from <= 0 || to <= from)
    return 0;

  // Business rule: if OUR TEAM handled 1st Round, ANY later
  // higher round proves promotion and earns the first amount.
  if(from === 1)
    return INCENTIVES.FIRST_PROMOTION;

  // If OUR TEAM handled 2nd Round or above, ANY later higher
  // round proves promotion and earns the normal promotion amount.
  if(from >= 2)
    return INCENTIVES.PROMOTION;

  return 0;
}
/******************************************************
 * WRITE INCENTIVE TRACKER
 *
 * Updated:
 * - Keeps existing Incentive Tracker working
 * - Rebuilds the visible tracker exactly as before
 * - Also synchronizes the generated records
 *   to the Private Incentive Backend
 ******************************************************/
function writeIncentiveTracker(tracker){

  //--------------------------------------------------
  // PRIVATE-ONLY MODE
  //
  // The private Incentive Tracker is PERMANENT.
  // It must NEVER be cleared/rebuilt by a scan.
  //--------------------------------------------------

  if(
    !tracker ||
    tracker.length === 0
  ){

    Logger.log(
      "Tracker is empty. Permanent backend unchanged."
    );

    return 0;
  }

  const output =
    tracker.map(
      function(r){

        return [
          r.incentiveType,
          r.candidate,
          r.client,
          r.fromRound,
          r.toRound,
          r.previousDate
            ? formatDate(r.previousDate)
            : "",
          r.promotionDate
            ? formatDate(r.promotionDate)
            : "",
          r.handler,
          r.amount,
          r.status
        ];
      }
    );


  //--------------------------------------------------
  // If SelectionDatePrivate.gs is installed, correct
  // previously-known Selection earning dates BEFORE
  // duplicate checking.
  //--------------------------------------------------

  if(
    typeof syncSelectionDatesToPrivateBackend ===
    "function"
  ){
    syncSelectionDatesToPrivateBackend(
      output
    );
  }


  const added =
    appendIncentivesToPrivateBackend(
      output
    );

  Logger.log(
    "Private Backend Records Added : " +
    added
  );

  return added;
}

function generateIncentiveTracker(){

  //--------------------------------------------------
  // Load data
  //--------------------------------------------------

  const rawRecords = loadRawData();

  const teamRecords = loadTeamData();

  //--------------------------------------------------
  // Build promotions
  //--------------------------------------------------

  const promotions =
    buildPromotionHistory(rawRecords,teamRecords);

  //--------------------------------------------------
  // Build tracker
  //--------------------------------------------------

  Logger.log("Promotions : " + promotions.length);
Logger.log("Team Records : " + teamRecords.length);

const tracker =
  buildIncentiveTracker(
    promotions,
    teamRecords
  );

Logger.log("Tracker : " + tracker.length);
  //--------------------------------------------------
  // Write tracker
  //--------------------------------------------------

  writeIncentiveTracker(tracker);

  Logger.log(

    "Tracker Records : " +

    tracker.length

  );

}