function HYD_testCallTrackerMonths(){

  const ss =
    SpreadsheetApp.getActiveSpreadsheet();

  const sheet =
    ss.getSheetByName(
      "HYD Interview Bot 2026"
    );

  if(!sheet){
    throw new Error(
      "HYD Interview Bot 2026 sheet not found"
    );
  }

  const values =
    sheet
      .getDataRange()
      .getDisplayValues();

  const months = {};
  const dates = [];

  values.forEach(function(row){

    row.forEach(function(value){

      const text =
        String(value || "").trim();

      const match =
        text.match(
          /^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/
        );

      if(!match){
        return;
      }

      const month =
        String(match[1]).padStart(2,"0");

      const day =
        String(match[2]).padStart(2,"0");

      const year =
        String(match[3]);

      const dateKey =
        year + "-" +
        month + "-" +
        day;

      dates.push(dateKey);

      months[
        year + "-" + month
      ] = true;

    });

  });

  const result = {
    workbook:
      ss.getName(),

    sheet:
      sheet.getName(),

    months:
      Object.keys(months)
        .sort(),

    dates:
      dates
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
