function HYD_testPrivateIncentiveMonths(){

  const ss =
    SpreadsheetApp.getActiveSpreadsheet();

  const sheet =
    ss.getSheetByName(
      "Incentive Tracker"
    );

  if(!sheet){
    throw new Error(
      "Incentive Tracker sheet not found"
    );
  }

  const lastRow =
    sheet.getLastRow();

  if(lastRow <= 1){

    Logger.log(
      JSON.stringify(
        {
          workbook:ss.getName(),
          months:[]
        },
        null,
        2
      )
    );

    return;
  }

  const values =
    sheet
      .getRange(
        2,
        7,
        lastRow - 1,
        1
      )
      .getValues();

  const months = {};

  values.forEach(function(row){

    const value =
      row[0];

    if(!value){
      return;
    }

    const date =
      value instanceof Date
        ? value
        : new Date(value);

    if(
      isNaN(
        date.getTime()
      )
    ){
      return;
    }

    const key =
      Utilities.formatDate(
        date,
        "Asia/Kolkata",
        "yyyy-MM"
      );

    months[key] = true;

  });

  const result = {
    workbook:
      ss.getName(),

    months:
      Object.keys(months)
        .sort()
  };

  Logger.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );

  return result;
}
function HYD_previewIncentiveMonthsReadOnly(){

  const rawRecords =
    loadRawData();

  const teamRecords =
    loadTeamData();

  const promotions =
    buildPromotionHistory(
      rawRecords,
      teamRecords
    );

  const tracker =
    buildIncentiveTracker(
      promotions,
      teamRecords
    );

  const monthMap = {};

  tracker.forEach(function(item){

    const date =
      item.promotionDate;

    if(
      !date ||
      Object.prototype.toString.call(date) !== "[object Date]" ||
      isNaN(date.getTime())
    ){
      return;
    }

    const monthKey =
      Utilities.formatDate(
        date,
        "Asia/Kolkata",
        "yyyy-MM"
      );

    if(!monthMap[monthKey]){
      monthMap[monthKey] = {
        total: 0,
        promotions: 0,
        selections: 0,
        amount: 0
      };
    }

    monthMap[monthKey].total++;

    const type =
      String(
        item.incentiveType || ""
      )
      .trim()
      .toLowerCase();

    if(type === "promotion"){
      monthMap[monthKey].promotions++;
    }

    if(type === "selection"){
      monthMap[monthKey].selections++;
    }

    monthMap[monthKey].amount +=
      Number(item.amount || 0);

  });

  const result = {
    ok: true,
    totalDetected:
      tracker.length,
    months:
      monthMap
  };

  Logger.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );

  return result;
}
function HYD_debugInputMonthsReadOnly(){

  function monthKey_(date){

    if(
      !date ||
      Object.prototype.toString.call(date) !== "[object Date]" ||
      isNaN(date.getTime())
    ){
      return "";
    }

    return Utilities.formatDate(
      date,
      "Asia/Kolkata",
      "yyyy-MM"
    );
  }


  function countMonths_(records, field){

    const map = {};

    records.forEach(function(item){

      const key =
        monthKey_(
          item[field]
        );

      if(!key){
        return;
      }

      map[key] =
        (map[key] || 0) + 1;

    });

    return map;
  }


  const rawRecords =
    loadRawData();

  const teamRecords =
    loadTeamData();


  //----------------------------------------------
  // Months the CURRENT parser actually loaded
  //----------------------------------------------

  const loadedRawMonths =
    countMonths_(
      rawRecords,
      "dateObj"
    );

  const loadedTeamMonths =
    countMonths_(
      teamRecords,
      "dateObj"
    );


  //----------------------------------------------
  // Selected earning dates
  //----------------------------------------------

  const selectionMonths = {};

  teamRecords.forEach(function(item){

    if(
      String(item.status || "")
        .toLowerCase() !== "selected"
    ){
      return;
    }

    const earningDate =
      item.selectionDateObj ||
      item.dateObj;

    const key =
      monthKey_(earningDate);

    if(!key){
      return;
    }

    selectionMonths[key] =
      (selectionMonths[key] || 0) + 1;

  });


  //----------------------------------------------
  // Inspect RAW DATA Column B date-header formats
  //----------------------------------------------

  const rawSheet =
    IR_operations_()
      .getSheetByName(
        CONFIG.RAW_SHEET
      );

  const lastRow =
    rawSheet.getLastRow();

  const rawValues =
    rawSheet
      .getRange(
        1,
        2,
        lastRow,
        1
      )
      .getValues();

  const rawDisplay =
    rawSheet
      .getRange(
        1,
        2,
        lastRow,
        1
      )
      .getDisplayValues();

  const headerSamples = [];

  for(
    let i = 0;
    i < rawValues.length;
    i++
  ){

    const actual =
      rawValues[i][0];

    const display =
      String(
        rawDisplay[i][0] || ""
      ).trim();

    const looksLikeDate =
      actual instanceof Date ||
      /^\d{1,2}[\/-]\d{1,2}[\/-]\d{4}/
        .test(display) ||
      /^\d{1,2}[\s-][A-Za-z]{3,9}[\s-]\d{4}/
        .test(display);

    if(!looksLikeDate){
      continue;
    }

    headerSamples.push({
      row:
        i + 1,

      display:
        display,

      actualType:
        actual instanceof Date
          ? "Date"
          : typeof actual
    });

  }


  const result = {

    ok: true,

    rawRecordCount:
      rawRecords.length,

    teamRecordCount:
      teamRecords.length,

    loadedRawMonths:
      loadedRawMonths,

    loadedTeamMonths:
      loadedTeamMonths,

    selectionMonths:
      selectionMonths,

    rawDateHeaders:
      headerSamples.slice(-15)

  };


  Logger.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );

  return result;
}