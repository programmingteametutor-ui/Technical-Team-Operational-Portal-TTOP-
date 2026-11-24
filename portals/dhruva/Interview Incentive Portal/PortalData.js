/******************************************************

 * PORTALDATA.GS

 * Secure Incentive Dashboard Data - Phase 3

 *

 * PUBLIC CLIENT FUNCTION:

 *   getPortalDashboardData(token, monthKey)

 *

 * SECURITY RULE:

 * - Admin: server may return team data.

 * - Handler: server filters to authenticated handler

 *   BEFORE any incentive data is returned.

 * - Browser NEVER supplies a handler name.

 ******************************************************/





/******************************************************

 * PUBLIC: DASHBOARD DATA

 ******************************************************/

function getPortalDashboardData(

  token,

  requestedMonth

){



  //--------------------------------------------------

  // Mandatory server-side authentication

  //--------------------------------------------------



  const auth =

    PA_validateSession_(

      token

    );





  if(!auth.ok){



    throw new Error(

      "SESSION_EXPIRED"

    );



  }





  const user =

    auth.user;





  //--------------------------------------------------

  // Load permanent private tracker

  //--------------------------------------------------



  const records =

    PD_loadTrackerRecords_();





  //--------------------------------------------------

  // CRITICAL PRIVACY FILTER

  //

  // Handler data is filtered here on the server.

  // We do not trust any handler name from the browser.

  //--------------------------------------------------



  const permittedRecords =

    user.role === "Admin"

      ? records

      : records.filter(

          function(record){



            return (

              PD_handlerKey_(

                record.handler

              ) ===

              PD_handlerKey_(

                user.handler

              )

            );



          }

        );





  //--------------------------------------------------

  // Available months

  //--------------------------------------------------



  const monthMap = {};





  permittedRecords.forEach(

    function(record){



      if(!record.monthKey)

        return;





      monthMap[

        record.monthKey

      ] =

        record.monthLabel;



    }

  );





  //--------------------------------------------------
  // MULTI-TEAM MONTH MERGE
  //
  // Incentive Tracker remains the source for incentive
  // amounts, but the month selector must also include
  // months that already exist in the team's Call Tracker.
  //
  // Primary path:
  //   PCO_loadCallDashboardFacts_()
  //
  // Defensive Admin fallback:
  //   Read date headers directly from the current team's
  //   schedule sheet if the call-fact path is unavailable.
  //--------------------------------------------------

  if(
    typeof PCO_loadCallDashboardFacts_ ===
      "function"
  ){

    try{

      const teamContext =
        auth.teamContext || {};

      const callFacts =
        (
          teamContext.aggregate === true &&
          typeof PCO_loadAggregateCallDashboardFacts_ ===
            "function"
        )
          ? (
              PCO_loadAggregateCallDashboardFacts_("")
                .facts || []
            )
          : (
              PCO_loadCallDashboardFacts_("")
                .facts || []
            );

      const handlerKey =
        user.role === "Admin"
          ? ""
          : PD_handlerKey_(
              user.handler
            );

      callFacts.forEach(
        function(item){

          if(handlerKey){

            const initialKey =
              PD_handlerKey_(
                item.initialHandler
              );

            const finalKey =
              PD_handlerKey_(
                item.finalHandler
              );

            if(
              initialKey !== handlerKey &&
              finalKey !== handlerKey
            ){
              return;
            }

          }

          const dateKey =
            String(
              item.dateKey || ""
            )
            .trim();

          if(
            !/^\d{4}-\d{2}-\d{2}$/
              .test(
                dateKey
              )
          ){
            return;
          }

          const key =
            dateKey.substring(
              0,
              7
            );

          if(
            monthMap[key]
          ){
            return;
          }

          const parts =
            key.split("-");

          const monthDate =
            new Date(
              Number(
                parts[0]
              ),
              Number(
                parts[1]
              ) - 1,
              1
            );

          monthMap[key] =
            PD_monthLabel_(
              monthDate
            );

        }
      );

    }catch(error){

      Logger.log(
        "Call fact month merge failed: " +
        (
          error &&
          error.message
            ? error.message
            : String(error)
        )
      );

    }

  }


  //--------------------------------------------------
  // DIRECT CALL TRACKER MONTH FALLBACK - ADMIN ONLY
  //
  // This guarantees a Team Admin can see every month
  // that physically exists in the current team's Call
  // Tracker even if the richer call-fact loader fails.
  //
  // Call Tracker date headers are stored in Column B.
  //--------------------------------------------------

  if(
    user.role === "Admin" &&
    typeof PC_scheduleSheet_ ===
      "function"
  ){

    try{

      const scheduleSheet =
        PC_scheduleSheet_();

      const lastRow =
        scheduleSheet
          .getLastRow();

      if(
        lastRow > 0
      ){

        const dateValues =
          scheduleSheet
            .getRange(
              1,
              2,
              lastRow,
              1
            )
            .getDisplayValues();

        dateValues.forEach(
          function(row){

            const text =
              String(
                row[0] || ""
              )
              .trim();

            const match =
              text.match(
                /^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})(?:\s|$)/
              );

            if(
              !match
            ){
              return;
            }

            const year =
              Number(
                match[3]
              );

            const month =
              Number(
                match[1]
              );

            const day =
              Number(
                match[2]
              );

            const testDate =
              new Date(
                year,
                month - 1,
                day
              );

            if(
              testDate.getFullYear() !== year ||
              testDate.getMonth() !== month - 1 ||
              testDate.getDate() !== day
            ){
              return;
            }

            const key =
              String(year) +
              "-" +
              String(month)
                .padStart(
                  2,
                  "0"
                );

            if(
              monthMap[key]
            ){
              return;
            }

            const monthDate =
              new Date(
                year,
                month - 1,
                1
              );

            monthMap[key] =
              PD_monthLabel_(
                monthDate
              );

          }
        );

      }

    }catch(error){

      Logger.log(
        "Direct Call Tracker month fallback failed: " +
        (
          error &&
          error.message
            ? error.message
            : String(error)
        )
      );

    }

  }



  const months =

    Object.keys(

      monthMap

    )

    .sort()

    .reverse()

    .map(

      function(key){



        return {

          key:

            key,

          label:

            monthMap[key]

        };



      }

    );





  let selectedMonth =

    String(

      requestedMonth || ""

    )

    .trim();





  if(

    !monthMap[

      selectedMonth

    ]

  ){



    selectedMonth =

      months.length

        ? months[0].key

        : "";



  }





  //--------------------------------------------------

  // Selected-month records

  //--------------------------------------------------



  const currentRecords =

    permittedRecords

      .filter(

        function(record){



          return (

            record.monthKey ===

            selectedMonth

          );



        }

      )

      .sort(

        PD_recordSortNewest_

      );





  //--------------------------------------------------

  // Previous calendar month

  //--------------------------------------------------



  const previousMonth =

    selectedMonth

      ? PD_previousMonthKey_(

          selectedMonth

        )

      : "";





  const previousRecords =

    permittedRecords.filter(

      function(record){



        return (

          record.monthKey ===

          previousMonth

        );



      }

    );





  //--------------------------------------------------

  // Summary

  //--------------------------------------------------



  const summary =

    PD_summarize_(

      currentRecords

    );





  const previousSummary =

    PD_summarize_(

      previousRecords

    );





  summary.totalChange =

    PD_percentChange_(

      summary.total,

      previousSummary.total

    );





  summary.promotionChange =

    PD_percentChange_(

      summary.promotion,

      previousSummary.promotion

    );





  summary.selectionChange =

    PD_percentChange_(

      summary.selection,

      previousSummary.selection

    );





  //--------------------------------------------------

  // Trend - latest six permitted months

  //--------------------------------------------------



  const trendMonthKeys =

    Object.keys(

      monthMap

    )

    .sort()

    .slice(

      -6

    );





  const trend =

    trendMonthKeys.map(

      function(monthKey){



        const monthRecords =

          permittedRecords.filter(

            function(record){



              return (

                record.monthKey ===

                monthKey

              );



            }

          );





        const item =

          PD_summarize_(

            monthRecords

          );





        return {



          monthKey:

            monthKey,



          month:

            monthMap[

              monthKey

            ],



          promotion:

            item.promotion,



          selection:

            item.selection,



          total:

            item.total



        };



      }

    );





  //--------------------------------------------------

  // Handler performance

  //

  // Only useful/returned to Admin.

  //--------------------------------------------------



  const handlerPerformance =

    user.role === "Admin"

      ? PD_handlerPerformance_(

          currentRecords

        )

      : [];





  //--------------------------------------------------

  // Recent activity

  //--------------------------------------------------



  const recentActivity =

    currentRecords

      .slice(

        0,

        8

      )

      .map(

        function(record){



          return {



            type:

              record.type,



            candidate:

              record.candidate,



            client:

              record.client,



            fromRound:

              record.fromRound,



            toRound:

              record.toRound,



            date:

              record.promotionDateLabel,



            handler:

              record.handler,



            amount:

              record.amount



          };



        }

      );





  //--------------------------------------------------

  // Monthly records

  //

  // Admin receives selected-month team records.

  // Handler receives only their filtered records.

  //--------------------------------------------------



  const safeRecords =

    currentRecords

      .slice(

        0,

        1000

      )

      .map(

        function(record){



          return {



            type:

              record.type,



            candidate:

              record.candidate,



            client:

              record.client,



            fromRound:

              record.fromRound,



            toRound:

              record.toRound,



            previousDate:

              record.previousDateLabel,



            promotionDate:

              record.promotionDateLabel,



            handler:

              record.handler,



            amount:

              record.amount,



            status:

              record.status



          };



        }

      );





  //--------------------------------------------------

  // Quick insights

  //--------------------------------------------------



  const insights =

    PD_buildInsights_(

      user,

      currentRecords,

      handlerPerformance,

      summary

    );





  const portalTeamContext =

    typeof PTR_currentContext_ === "function"

      ? PTR_currentContext_()

      : null;



  return {



    ok:

      true,



    teamContext:

      portalTeamContext,



    teamUnavailable:

      Boolean(

        portalTeamContext &&

        portalTeamContext.connected !== true &&

        portalTeamContext.aggregate !== true

      ),



    teamAggregate:

      Boolean(

        portalTeamContext &&

        portalTeamContext.aggregate === true

      ),



    teamMessage:

      portalTeamContext

        ? String(portalTeamContext.message || "")

        : "",



    user: {

      email:

        user.email,

      handler:

        user.handler,

      role:

        user.role

    },



    months:

      months,



    selectedMonth:

      selectedMonth,



    selectedMonthLabel:

      selectedMonth

        ? monthMap[

            selectedMonth

          ]

        : "No Data",



    previousMonth:

      previousMonth,



    summary:

      summary,



    trend:

      trend,



    handlerPerformance:

      handlerPerformance,



    recentActivity:

      recentActivity,



    records:

      safeRecords,



    insights:

      insights



  };



}





/******************************************************

 * PRIVATE: LOAD TRACKER

 *

 * Tracker schema:

 * 0 Incentive Type

 * 1 Candidate

 * 2 Client

 * 3 From

 * 4 To

 * 5 Previous Date

 * 6 Promotion Date / earning date

 * 7 Handler

 * 8 Amount

 * 9 Status

 ******************************************************/

function PD_loadTrackerRecords_(){



  // Team Router supplies either one specific tracker or, for

  // Super Admin -> All Teams, every connected team's tracker.

  if(typeof PTR_trackerSheetsForDashboard_ === "function"){



    const sources = PTR_trackerSheetsForDashboard_();

    let combined = [];



    sources.forEach(function(source){

      combined = combined.concat(

        PD_loadTrackerRecordsFromSheet_(

          source.sheet,

          source.teamCode,

          source.teamLabel

        )

      );

    });



    return combined;

  }



  return PD_loadTrackerRecordsFromSheet_(

    portalTracker_(),

    "PRADEEP",

    "Pradeep Anna Team"

  );

}





function PD_loadTrackerRecordsFromSheet_(sheet, teamCode, teamLabel){



  if(!sheet){

    return [];

  }



  const lastRow = sheet.getLastRow();

  const lastColumn = sheet.getLastColumn();



  if(lastColumn < 10){

    throw new Error(

      "Private Incentive Tracker does not contain the expected 10-column schema."

    );

  }



  if(lastRow <= 1){

    return [];

  }



  const rows =

    sheet

      .getRange(

        2,

        1,

        lastRow - 1,

        10

      )

      .getValues();



  const output = [];



  rows.forEach(function(row){



    const type =

      String(row[0] || "")

        .trim();



    const handler =

      String(row[7] || "")

        .replace(/\s+/g," ")

        .trim();



    const amount =

      PD_amount_(row[8]);



    const earningDate =

      PD_parseDate_(row[6]);



    if(

      !type ||

      !handler ||

      amount <= 0 ||

      !earningDate

    ){

      return;

    }



    const previousDate =

      PD_parseDate_(row[5]);



    output.push({

      type: type,

      candidate: String(row[1] || "").trim(),

      client: String(row[2] || "").trim(),

      fromRound: String(row[3] || "").trim(),

      toRound: String(row[4] || "").trim(),

      previousDate: previousDate,

      previousDateLabel:

        previousDate

          ? PD_dateLabel_(previousDate)

          : "",

      promotionDate: earningDate,

      promotionDateLabel:

        PD_dateLabel_(earningDate),

      monthKey:

        PD_monthKey_(earningDate),

      monthLabel:

        PD_monthLabel_(earningDate),

      handler: handler,

      amount: amount,

      status: String(row[9] || "").trim(),

      teamCode: String(teamCode || ""),

      teamLabel: String(teamLabel || "")

    });

  });



  return output;

}





/******************************************************

 * PRIVATE: SUMMARY

 ******************************************************/

function PD_summarize_(

  records

){



  const summary = {



    promotion:

      0,



    selection:

      0,



    total:

      0,



    promotions:

      0,



    selections:

      0,



    records:

      records.length,



    candidates:

      0,



    activeHandlers:

      0



  };





  const candidateSet = {};

  const handlerSet = {};





  records.forEach(

    function(record){



      const type =

        String(

          record.type || ""

        )

        .trim()

        .toLowerCase();





      const amount =

        Number(

          record.amount

        ) || 0;





      if(type === "promotion"){



        summary.promotion +=

          amount;



        summary.promotions++;



      }





      if(type === "selection"){



        summary.selection +=

          amount;



        summary.selections++;



      }





      summary.total +=

        amount;





      const candidateKey =

        String(

          record.candidate || ""

        )

        .trim()

        .toLowerCase() +

        "|" +

        String(

          record.client || ""

        )

        .trim()

        .toLowerCase();





      if(

        candidateKey !==

        "|"

      ){



        candidateSet[

          candidateKey

        ] = true;



      }





      const handlerKey =

        PD_handlerKey_(

          record.handler

        );





      if(handlerKey){



        handlerSet[

          handlerKey

        ] = true;



      }



    }

  );





  summary.candidates =

    Object.keys(

      candidateSet

    ).length;





  summary.activeHandlers =

    Object.keys(

      handlerSet

    ).length;





  return summary;



}





/******************************************************

 * PRIVATE: HANDLER PERFORMANCE

 ******************************************************/

function PD_handlerPerformance_(

  records

){



  const map = {};





  records.forEach(

    function(record){



      const handler =

        String(

          record.handler || ""

        )

        .replace(

          /\s+/g,

          " "

        )

        .trim();





      if(!handler)

        return;





      const key =

        PD_handlerKey_(

          handler

        );





      if(!map[key]){



        map[key] = {



          handler:

            handler,



          promotion:

            0,



          selection:

            0,



          total:

            0,



          promotions:

            0,



          selections:

            0



        };



      }





      const amount =

        Number(

          record.amount

        ) || 0;





      const type =

        String(

          record.type || ""

        )

        .trim()

        .toLowerCase();





      if(type === "promotion"){



        map[key].promotion +=

          amount;



        map[key].promotions++;



      }





      if(type === "selection"){



        map[key].selection +=

          amount;



        map[key].selections++;



      }





      map[key].total +=

        amount;



    }

  );





  return Object.keys(

    map

  )

  .map(

    function(key){



      return map[key];



    }

  )

  .sort(

    function(a,b){



      if(

        b.total !==

        a.total

      ){



        return (

          b.total -

          a.total

        );



      }





      return a.handler

        .localeCompare(

          b.handler

        );



    }

  );



}





/******************************************************

 * PRIVATE: INSIGHTS

 ******************************************************/

function PD_buildInsights_(

  user,

  records,

  handlerPerformance,

  summary

){



  const output = [];





  if(

    user.role === "Admin"

  ){



    if(

      handlerPerformance.length

    ){



      const top =

        handlerPerformance[0];





      output.push({



        icon:

          "★",



        title:

          "Top Performer",



        value:

          top.handler,



        detail:

          "₹" +

          PD_numberLabel_(

            top.total

          ) +

          " total incentive"



      });



    }





    output.push({



      icon:

        "👥",



      title:

        "Active Handlers",



      value:

        String(

          summary.activeHandlers

        ),



      detail:

        "Handlers with incentive activity this month"



    });





    output.push({



      icon:

        "🏆",



      title:

        "Promotions",



      value:

        String(

          summary.promotions

        ),



      detail:

        "Promotion incentive records this month"



    });





    return output;



  }





  //--------------------------------------------------

  // Handler insights

  //--------------------------------------------------



  const typeName =

    summary.selection >=

    summary.promotion

      ? "Selection"

      : "Promotion";





  const typeAmount =

    typeName === "Selection"

      ? summary.selection

      : summary.promotion;





  output.push({



    icon:

      "★",



    title:

      "Top Incentive Type",



    value:

      typeName,



    detail:

      "₹" +

      PD_numberLabel_(

        typeAmount

      ) +

      " this month"



  });





  const clients = {};





  records.forEach(

    function(record){



      const client =

        String(

          record.client || ""

        ).trim();





      if(!client)

        return;





      clients[client] =

        (

          clients[client] ||

          0

        ) +

        (

          Number(

            record.amount

          ) ||

          0

        );



    }

  );





  const bestClient =

    Object.keys(

      clients

    )

    .sort(

      function(a,b){



        return (

          clients[b] -

          clients[a]

        );



      }

    )[0];





  if(bestClient){



    output.push({



      icon:

        "◇",



      title:

        "Best Client",



      value:

        bestClient,



      detail:

        "₹" +

        PD_numberLabel_(

          clients[

            bestClient

          ]

        ) +

        " earned this month"



    });



  }





  output.push({



    icon:

      "🏆",



    title:

      "My Promotions",



    value:

      String(

        summary.promotions

      ),



    detail:

      "Promotion records this month"



  });





  return output;



}





/******************************************************

 * PRIVATE: DATE PARSER

 *

 * Core engine stores tracker dates as dd-MMM-yyyy.

 * Also accepts Date objects and ISO-like text.

 ******************************************************/

function PD_parseDate_(

  value

){



  if(

    Object.prototype

      .toString

      .call(

        value

      ) ===

      "[object Date]"

  ){



    if(

      !isNaN(

        value.getTime()

      )

    ){



      return new Date(

        value.getTime()

      );



    }





    return null;



  }





  const text =

    String(

      value || ""

    )

    .trim();





  if(!text)

    return null;





  //--------------------------------------------------

  // dd-MMM-yyyy

  //--------------------------------------------------



  let match =

    text.match(

      /^(\d{1,2})-([A-Za-z]{3,9})-(\d{4})$/

    );





  if(match){



    const months = {



      jan:0,

      january:0,



      feb:1,

      february:1,



      mar:2,

      march:2,



      apr:3,

      april:3,



      may:4,



      jun:5,

      june:5,



      jul:6,

      july:6,



      aug:7,

      august:7,



      sep:8,

      sept:8,

      september:8,



      oct:9,

      october:9,



      nov:10,

      november:10,



      dec:11,

      december:11



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





      return isNaN(

        d.getTime()

      )

        ? null

        : d;



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





    return isNaN(

      d.getTime()

    )

      ? null

      : d;



  }





  //--------------------------------------------------

  // Last safe fallback

  //--------------------------------------------------



  const parsed =

    new Date(

      text

    );





  return isNaN(

    parsed.getTime()

  )

    ? null

    : parsed;



}





/******************************************************

 * PRIVATE: HELPERS

 ******************************************************/

function PD_amount_(value){



  if(

    value === null ||

    value === undefined ||

    value === ""

  ){



    return 0;



  }





  const cleaned =

    String(

      value

    )

    .replace(

      /[₹,\s]/g,

      ""

    )

    .trim();





  const amount =

    Number(

      cleaned

    );





  return isNaN(

    amount

  )

    ? 0

    : amount;



}





function PD_handlerKey_(value){



  return String(

    value || ""

  )

  .replace(

    /\s+/g,

    " "

  )

  .trim()

  .toLowerCase();



}





function PD_monthKey_(dateObj){



  return Utilities.formatDate(

    dateObj,

    PORTAL_CONFIG.TIME_ZONE,

    "yyyy-MM"

  );



}





function PD_monthLabel_(dateObj){



  return Utilities.formatDate(

    dateObj,

    PORTAL_CONFIG.TIME_ZONE,

    "MMM-yyyy"

  );



}





function PD_dateLabel_(dateObj){



  return Utilities.formatDate(

    dateObj,

    PORTAL_CONFIG.TIME_ZONE,

    "dd-MMM-yyyy"

  );



}





function PD_previousMonthKey_(

  monthKey

){



  const match =

    String(

      monthKey || ""

    )

    .match(

      /^(\d{4})-(\d{2})$/

    );





  if(!match)

    return "";





  const date =

    new Date(

      Number(

        match[1]

      ),

      Number(

        match[2]

      ) - 2,

      1

    );





  return Utilities.formatDate(

    date,

    PORTAL_CONFIG.TIME_ZONE,

    "yyyy-MM"

  );



}





function PD_percentChange_(

  current,

  previous

){



  current =

    Number(

      current

    ) || 0;





  previous =

    Number(

      previous

    ) || 0;





  if(previous === 0){



    return null;



  }





  return Math.round(

    (

      (

        current -

        previous

      ) /

      previous

    ) *

    1000

  ) /

  10;



}





function PD_recordSortNewest_(

  a,

  b

){



  const aTime =

    a.promotionDate

      ? a.promotionDate

          .getTime()

      : 0;





  const bTime =

    b.promotionDate

      ? b.promotionDate

          .getTime()

      : 0;





  return (

    bTime -

    aTime

  );



}





function PD_numberLabel_(

  value

){



  return Number(

    value || 0

  )

  .toLocaleString(

    "en-IN"

  );



}
