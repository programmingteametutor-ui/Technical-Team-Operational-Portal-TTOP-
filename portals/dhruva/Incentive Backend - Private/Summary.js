/******************************************************
 * SUMMARY.GS
 * Monthly Incentive Summary
 *
 * Source of truth:
 *   Private Backend -> Incentive Tracker
 *
 * Business rule:
 *   Incentive month = Promotion Date / earning date
 *
 * Output:
 *   1) Private Backend -> Monthly Incentive Summary
 *   2) Main workbook -> CONFIG.SUMMARY_SHEET
 *      (temporary mirror until dashboard is ready)
 ******************************************************/


const MONTHLY_SUMMARY_CONFIG = {

  PRIVATE_SUMMARY_SHEET:
    "Monthly Incentive Summary",

  // Keep the current visible summary working until
  // the dashboard is ready.
  MIRROR_TO_MAIN:
    true

};


/******************************************************
 * GENERATE SUMMARY
 *
 * Engine.gs already calls generateSummary(),
 * so Engine.gs does NOT need to change.
 ******************************************************/
function generateSummary(){

  Logger.log(
    "========== MONTHLY SUMMARY START =========="
  );


  //--------------------------------------------------
  // Private permanent tracker is the source of truth
  //--------------------------------------------------

  if(
    typeof getPrivateTrackerSheet !== "function" ||
    typeof getPrivateIncentiveSpreadsheet !== "function"
  ){

    throw new Error(
      "PrivateBackend.gs is missing or incomplete."
    );

  }


  const tracker =
    getPrivateTrackerSheet();


  const values =
    tracker
      .getDataRange()
      .getValues();


  //--------------------------------------------------
  // Build monthly report
  //--------------------------------------------------

  const report = {};

  let validRecords = 0;
  let skippedNoHandler = 0;
  let skippedNoDate = 0;
  let skippedNoAmount = 0;
  let skippedUnknownType = 0;


  for(
    let i = 1;
    i < values.length;
    i++
  ){

    const row =
      values[i];


    const type =
      String(
        row[0] || ""
      )
      .trim()
      .toLowerCase();


    const handler =
      normalizeHandler(
        row[7]
      );


    const amount =
      SUM_parseAmount(
        row[8]
      );


    //----------------------------------------------
    // Promotion Date is the earning date.
    //
    // Tracker schema:
    // 0 Type
    // 1 Candidate
    // 2 Client
    // 3 From
    // 4 To
    // 5 Previous Date
    // 6 Promotion Date / earning date
    // 7 Handler
    // 8 Amount
    // 9 Status
    //----------------------------------------------

    const earningDate =
      SUM_parseDate(
        row[6]
      );


    if(!handler){

      skippedNoHandler++;
      continue;

    }


    if(!earningDate){

      skippedNoDate++;
      continue;

    }


    if(amount <= 0){

      skippedNoAmount++;
      continue;

    }


    if(
      type !== "promotion" &&
      type !== "selection"
    ){

      skippedUnknownType++;
      continue;

    }


    const monthKey =
      SUM_monthKey(
        earningDate
      );


    const monthLabel =
      SUM_monthLabel(
        earningDate
      );


    if(!report[monthKey]){

      report[monthKey] = {

        label:
          monthLabel,

        handlers:
          {}

      };

    }


    if(
      !report[monthKey]
        .handlers[handler]
    ){

      report[monthKey]
        .handlers[handler] = {

          promotion:
            0,

          selection:
            0,

          total:
            0

        };

    }


    if(type === "promotion"){

      report[monthKey]
        .handlers[handler]
        .promotion += amount;

    }


    if(type === "selection"){

      report[monthKey]
        .handlers[handler]
        .selection += amount;

    }


    report[monthKey]
      .handlers[handler]
      .total += amount;


    validRecords++;

  }


  //--------------------------------------------------
  // Build output
  //
  // Newest month first.
  //--------------------------------------------------

  const output = [];

  const monthKeys =
    Object.keys(report)
      .sort()
      .reverse();


  monthKeys.forEach(
    function(monthKey){

      const month =
        report[monthKey];


      let monthPromotion = 0;
      let monthSelection = 0;
      let monthTotal = 0;


      Object.keys(
        month.handlers
      )
      .sort()
      .forEach(
        function(handler){

          const item =
            month
              .handlers[handler];


          monthPromotion +=
            Number(
              item.promotion
            ) || 0;


          monthSelection +=
            Number(
              item.selection
            ) || 0;


          monthTotal +=
            Number(
              item.total
            ) || 0;


          output.push([

            month.label,

            handler,

            Number(
              item.promotion
            ) || 0,

            Number(
              item.selection
            ) || 0,

            Number(
              item.total
            ) || 0

          ]);

        }
      );


      //----------------------------------------------
      // Separate total for this month
      //----------------------------------------------

      output.push([

        month.label,

        "MONTH TOTAL",

        monthPromotion,

        monthSelection,

        monthTotal

      ]);

    }
  );


  //--------------------------------------------------
  // Write PRIVATE monthly summary
  //--------------------------------------------------

  const privateSS =
    getPrivateIncentiveSpreadsheet();


  let privateSummary =
    privateSS.getSheetByName(
      MONTHLY_SUMMARY_CONFIG
        .PRIVATE_SUMMARY_SHEET
    );


  if(!privateSummary){

    privateSummary =
      privateSS.insertSheet(
        MONTHLY_SUMMARY_CONFIG
          .PRIVATE_SUMMARY_SHEET
      );

  }


  SUM_writeSummarySheet(
    privateSummary,
    output
  );


  //--------------------------------------------------
  // Temporary mirror in the main workbook
  //
  // This preserves the current workflow until
  // the dashboard replaces the visible sheet.
  //--------------------------------------------------

  if(
    MONTHLY_SUMMARY_CONFIG
      .MIRROR_TO_MAIN
  ){

    const mainSS =
      SpreadsheetApp
        .getActive();


    let mainSummary =
      mainSS.getSheetByName(
        CONFIG.SUMMARY_SHEET
      );


    if(!mainSummary){

      mainSummary =
        mainSS.insertSheet(
          CONFIG.SUMMARY_SHEET
        );

    }


    SUM_writeSummarySheet(
      mainSummary,
      output
    );

  }


  //--------------------------------------------------
  // Logs
  //--------------------------------------------------

  Logger.log(
    "Private Tracker Records : " +
    Math.max(
      values.length - 1,
      0
    )
  );


  Logger.log(
    "Valid Monthly Records : " +
    validRecords
  );


  Logger.log(
    "Months Found : " +
    monthKeys.length
  );


  Logger.log(
    "Months : " +
    monthKeys.map(
      function(key){
        return report[key].label;
      }
    ).join(", ")
  );


  Logger.log(
    "Skipped - No Handler : " +
    skippedNoHandler
  );


  Logger.log(
    "Skipped - No Earning Date : " +
    skippedNoDate
  );


  Logger.log(
    "Skipped - No Amount : " +
    skippedNoAmount
  );


  Logger.log(
    "Skipped - Unknown Type : " +
    skippedUnknownType
  );


  Logger.log(
    "========== MONTHLY SUMMARY COMPLETE =========="
  );

}


/******************************************************
 * WRITE MONTHLY SUMMARY SHEET
 ******************************************************/
function SUM_writeSummarySheet(
  sheet,
  output
){

  //--------------------------------------------------
  // Remove an old filter if present
  //--------------------------------------------------

  const filter =
    sheet.getFilter();


  if(filter){

    filter.remove();

  }


  sheet.clear();


  const header = [[

    "Month",

    "Handler",

    "Promotion",

    "Selection",

    "Total"

  ]];


  sheet
    .getRange(
      1,
      1,
      1,
      header[0].length
    )
    .setValues(
      header
    );


  if(
    output &&
    output.length
  ){

    sheet
      .getRange(
        2,
        1,
        output.length,
        5
      )
      .setValues(
        output
      );

  }


  const lastRow =
    Math.max(
      sheet.getLastRow(),
      1
    );


  //--------------------------------------------------
  // Header
  //--------------------------------------------------

  sheet
    .getRange(
      1,
      1,
      1,
      5
    )
    .setFontWeight(
      "bold"
    )
    .setFontSize(
      12
    )
    .setBackground(
      "#D9EAD3"
    )
    .setHorizontalAlignment(
      "center"
    );


  //--------------------------------------------------
  // Borders
  //--------------------------------------------------

  sheet
    .getRange(
      1,
      1,
      lastRow,
      5
    )
    .setBorder(
      true,
      true,
      true,
      true,
      true,
      true
    );


  //--------------------------------------------------
  // Currency formatting
  //--------------------------------------------------

  if(lastRow > 1){

    sheet
      .getRange(
        2,
        3,
        lastRow - 1,
        3
      )
      .setNumberFormat(
        "₹#,##0"
      )
      .setHorizontalAlignment(
        "right"
      );


    //------------------------------------------------
    // Month + Handler formatting
    //------------------------------------------------

    sheet
      .getRange(
        2,
        1,
        lastRow - 1,
        2
      )
      .setFontWeight(
        "bold"
      );


    //------------------------------------------------
    // Highlight every MONTH TOTAL row
    //------------------------------------------------

    const handlers =
      sheet
        .getRange(
          2,
          2,
          lastRow - 1,
          1
        )
        .getValues();


    handlers.forEach(
      function(row, index){

        if(
          String(
            row[0] || ""
          ).trim() ===
          "MONTH TOTAL"
        ){

          sheet
            .getRange(
              index + 2,
              1,
              1,
              5
            )
            .setFontWeight(
              "bold"
            )
            .setBackground(
              "#CFE2F3"
            );

        }

      }
    );

  }


  sheet.setFrozenRows(1);


  //--------------------------------------------------
  // Keep sizing simple and fast
  //--------------------------------------------------

  sheet.setColumnWidth(
    1,
    110
  );


  sheet.setColumnWidth(
    2,
    150
  );


  sheet.setColumnWidths(
    3,
    3,
    110
  );

}


/******************************************************
 * MONTH KEY
 *
 * Example:
 * 2026-08
 ******************************************************/
function SUM_monthKey(
  dateObj
){

  return Utilities.formatDate(

    dateObj,

    Session.getScriptTimeZone(),

    "yyyy-MM"

  );

}


/******************************************************
 * MONTH LABEL
 *
 * Example:
 * Aug-2026
 ******************************************************/
function SUM_monthLabel(
  dateObj
){

  return Utilities.formatDate(

    dateObj,

    Session.getScriptTimeZone(),

    "MMM-yyyy"

  );

}


/******************************************************
 * PARSE AMOUNT
 ******************************************************/
function SUM_parseAmount(
  value
){

  if(
    value === null ||
    value === undefined ||
    value === ""
  ){

    return 0;

  }


  const cleaned =
    String(value)
      .replace(
        /[₹,\s]/g,
        ""
      )
      .trim();


  const amount =
    Number(
      cleaned
    );


  return isNaN(amount)
    ? 0
    : amount;

}


/******************************************************
 * PARSE TRACKER DATE
 *
 * Handles:
 * - real Google Sheets Date values
 * - dd-MMM-yyyy
 * - yyyy-MM-dd
 * - dd/MM/yyyy
 * - normal JavaScript-parseable dates
 ******************************************************/
function SUM_parseDate(
  value
){

  //--------------------------------------------------
  // Real Date
  //--------------------------------------------------

  if(
    Object.prototype
      .toString
      .call(value) ===
      "[object Date]"
  ){

    if(
      !isNaN(
        value.getTime()
      )
    ){

      return new Date(
        value
      );

    }


    return null;

  }


  const text =
    String(
      value || ""
    )
    .trim();


  if(!text){

    return null;

  }


  //--------------------------------------------------
  // dd-MMM-yyyy
  //
  // Example:
  // 15-Jul-2026
  //--------------------------------------------------

  let match =
    text.match(
      /^(\d{1,2})-([A-Za-z]{3,9})-(\d{4})$/
    );


  if(match){

    const months = {

      jan: 0,
      january: 0,

      feb: 1,
      february: 1,

      mar: 2,
      march: 2,

      apr: 3,
      april: 3,

      may: 4,

      jun: 5,
      june: 5,

      jul: 6,
      july: 6,

      aug: 7,
      august: 7,

      sep: 8,
      sept: 8,
      september: 8,

      oct: 9,
      october: 9,

      nov: 10,
      november: 10,

      dec: 11,
      december: 11

    };


    const month =
      months[
        String(
          match[2]
        )
        .toLowerCase()
      ];


    if(
      month !== undefined
    ){

      const d =
        new Date(

          Number(
            match[3]
          ),

          month,

          Number(
            match[1]
          )

        );


      if(
        !isNaN(
          d.getTime()
        )
      ){

        return d;

      }

    }

  }


  //--------------------------------------------------
  // yyyy-MM-dd
  //--------------------------------------------------

  match =
    text.match(
      /^(\d{4})-(\d{1,2})-(\d{1,2})$/
    );


  if(match){

    const d =
      new Date(

        Number(
          match[1]
        ),

        Number(
          match[2]
        ) - 1,

        Number(
          match[3]
        )

      );


    if(
      !isNaN(
        d.getTime()
      )
    ){

      return d;

    }

  }


  //--------------------------------------------------
  // dd/MM/yyyy
  //--------------------------------------------------

  match =
    text.match(
      /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/
    );


  if(match){

    const d =
      new Date(

        Number(
          match[3]
        ),

        Number(
          match[2]
        ) - 1,

        Number(
          match[1]
        )

      );


    if(
      !isNaN(
        d.getTime()
      )
    ){

      return d;

    }

  }


  //--------------------------------------------------
  // Last fallback
  //--------------------------------------------------

  const parsed =
    new Date(
      text
    );


  if(
    !isNaN(
      parsed.getTime()
    )
  ){

    return parsed;

  }


  return null;

}


/******************************************************
 * NORMALIZE HANDLER
 *
 * Preserves the existing Summary.gs behavior.
 ******************************************************/
function normalizeHandler(
  name
){

  name =
    String(
      name || ""
    )
    .trim();


  if(name === ""){

    return "";

  }


  name =
    name.replace(
      /\s+/g,
      " "
    );


  return name
    .toLowerCase()
    .replace(
      /\b\w/g,
      function(letter){

        return letter
          .toUpperCase();

      }
    );

}


/******************************************************
 * TEST MONTHLY SUMMARY
 *
 * Safe test:
 * Rebuilds summary sheets only.
 * Does NOT modify Incentive Tracker or Recovery.
 ******************************************************/
function testMonthlySummary(){

  generateSummary();

  Logger.log(
    "Monthly summary test finished successfully."
  );

}
