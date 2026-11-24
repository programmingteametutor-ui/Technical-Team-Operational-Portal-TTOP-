/******************************************************
 * TEAM LOOKUP
 * Version 5.0
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

  if(previousRound == 1 && nextRound == 2)
    return INCENTIVES.FIRST_PROMOTION;

  if(nextRound == previousRound + 1)
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

  const ss = SpreadsheetApp.getActive();

  let sheet = ss.getSheetByName(
    CONFIG.TRACKER_SHEET
  );

  //--------------------------------------------------
  // Create sheet if missing
  //--------------------------------------------------

  if(!sheet){

    sheet = ss.insertSheet(
      CONFIG.TRACKER_SHEET
    );

  }

  //--------------------------------------------------
  // Clear current tracker
  //--------------------------------------------------

  sheet.clearContents();

  //--------------------------------------------------
  // Header
  //--------------------------------------------------

  const header = [

    "Incentive Type",

    "Candidate",

    "Client",

    "From",

    "To",

    "Previous Date",

    "Promotion Date",

    "Handler",

    "Amount",

    "Status"

  ];

  sheet.appendRow(header);

  //--------------------------------------------------
  // Nothing to write
  //--------------------------------------------------

  if(
    !tracker ||
    tracker.length === 0
  ){

    Logger.log(
      "Tracker is empty."
    );

    return;

  }

  //--------------------------------------------------
  // Build output
  //--------------------------------------------------

  const output = tracker.map(function(r){

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

  });

  //--------------------------------------------------
  // Write current tracker
  //--------------------------------------------------

  sheet.getRange(

    2,

    1,

    output.length,

    output[0].length

  ).setValues(output);


  //--------------------------------------------------
  // PRIVATE BACKEND
  //--------------------------------------------------

  try{

//--------------------------------------------------
// Correct existing Selection earning dates BEFORE
// permanent duplicate checking.
//--------------------------------------------------

syncSelectionDatesToPrivateBackend(
  output
);


const added =
  appendIncentivesToPrivateBackend(
    output
  );

    Logger.log(

      "Private Backend Records Added : " +
      added

    );

  }
  catch(error){

    Logger.log(

      "PRIVATE BACKEND ERROR : " +
      error.message

    );

    throw error;

  }

}


/******************************************************
 * GENERATE INCENTIVE TRACKER
 ******************************************************/
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
    buildPromotionHistory(rawRecords);

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