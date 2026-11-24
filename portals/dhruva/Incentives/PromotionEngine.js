/******************************************************
 * PROMOTION ENGINE
 * Version 5.0
 ******************************************************/

/******************************************************
 * BUILD PROMOTION HISTORY
 ******************************************************/
function buildPromotionHistory(rawRecords){

  //--------------------------------------------------
  // Group by Candidate + Client
  //--------------------------------------------------

  const histories = {};

  rawRecords.forEach(function(record){

    const key = makeSmartKey(

      record.candidate,

      record.client

    );

    if(!histories[key]){

      histories[key] = [];

    }

    histories[key].push(record);

  });

  //--------------------------------------------------
  // Detect Promotions
  //--------------------------------------------------

  const promotions = [];

  Object.keys(histories).forEach(function(key){

    const history = histories[key];

    history.sort(function(a,b){

      return a.dateObj - b.dateObj;

    });

    promotions.push(

      ...detectPromotions(history)

    );

  });

  return promotions;

}
/******************************************************
 * DETECT PROMOTIONS
 ******************************************************/
function detectPromotions(history){

  const promotions = [];

  if(history.length < 2)
    return promotions;

  for(let i=0;i<history.length-1;i++){

    const current = history[i];
    const next = history[i+1];

    //--------------------------------------------------
    // Must be a promotion
    //--------------------------------------------------

    if(next.roundNo <= current.roundNo)
      continue;

    //--------------------------------------------------
    // Only allow direct promotion
    //--------------------------------------------------

    if(next.roundNo != current.roundNo + 1)
      continue;

    promotions.push({

      candidate : current.candidate,

      client : current.client,

      previousRound : current.round,

      previousRoundNo : current.roundNo,

      previousDate : current.dateObj,

      promotionRound : next.round,

      promotionRoundNo : next.roundNo,

      promotionDate : next.dateObj,

      previousRecord : current,

      promotionRecord : next

    });

  }

  return promotions;

}
/******************************************************
 * WRITE PROMOTION HISTORY
 ******************************************************/
function writePromotionHistory(promotions){

  const ss = SpreadsheetApp.getActive();

  let sheet =
    ss.getSheetByName(
      CONFIG.PROMOTION_HISTORY_SHEET
    );

  //--------------------------------------------------
  // Create Sheet
  //--------------------------------------------------

  if(!sheet){

    sheet =
      ss.insertSheet(
        CONFIG.PROMOTION_HISTORY_SHEET
      );

  }

  //--------------------------------------------------
  // Clear
  //--------------------------------------------------

  sheet.clearContents();

  //--------------------------------------------------
  // Header
  //--------------------------------------------------

  sheet.appendRow([

    "Candidate",

    "Client",

    "Previous Round",

    "Promotion Round",

    "Previous Date",

    "Promotion Date"

  ]);

  //--------------------------------------------------
  // No Promotions
  //--------------------------------------------------

  if(promotions.length == 0)
    return;

  //--------------------------------------------------
  // Data
  //--------------------------------------------------

  const output = promotions.map(function(p){

    return [

      p.candidate,

      p.client,

      p.previousRound,

      p.promotionRound,

      formatDate(p.previousDate),

      formatDate(p.promotionDate)

    ];

  });

  sheet

    .getRange(

      2,

      1,

      output.length,

      output[0].length

    )

    .setValues(output);

}


/******************************************************
 * RUN PROMOTION ENGINE
 ******************************************************/
function generatePromotionHistory(){

  const rawRecords =
    loadRawData();

  const promotions =
    buildPromotionHistory(rawRecords);

  writePromotionHistory(promotions);

  Logger.log(

    "Promotions Found : " +

    promotions.length

  );

}
