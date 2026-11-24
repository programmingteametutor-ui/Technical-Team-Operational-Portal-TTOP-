/******************************************************
 * PORTALREPORTS.GS
 * Final Phase - Reports / Performance / Audit
 *
 * DATA SOURCES
 * -----------
 * Main operational workbook:
 *   Team Data
 *   Promotion Recovery
 *   Recovery Exceptions
 *
 * Private backend:
 *   Incentive Tracker
 *   Selection Requests
 *   Portal Action Log
 *
 * TEAM DATA BUSINESS RULE
 * -----------------------
 * Column A = date header. Date appears once, then blank
 *            until the next date header.
 * Column B = call / interview details.
 * Column C = handler OR Support / Rescheduled / Cancelled.
 * Column D = interview status such as In Progress / Selected.
 *
 * Every nonblank Column B row under a valid inherited date
 * counts as one assigned/scheduled call occurrence.
 *
 * Column C classification:
 * - real handler name -> handled by that handler
 * - Support           -> support handled
 * - Rescheduled       -> rescheduled
 * - Cancelled/Canceled-> cancelled
 * - blank             -> unassigned
 *
 * SECURITY
 * --------
 * Admin receives team-wide reports.
 * Handler receives only their own handler activity and
 * their own incentive/recovery/request data.
 ******************************************************/


/******************************************************
 * PUBLIC: REPORT DATA
 ******************************************************/
function getPortalReportsData(
  token,
  requestedMonth
){

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


  let monthKey =
    String(
      requestedMonth || ""
    )
    .trim();


  if(
    monthKey &&
    !/^\d{4}-\d{2}$/.test(
      monthKey
    )
  ){

    monthKey =
      "";

  }


  const teamRows =
    POR_loadTeamActivity_();


  const incentiveRows =
    POR_loadIncentives_();


  //--------------------------------------------------
  // If month was not provided, select latest month
  // found across operational/incentive data.
  //--------------------------------------------------

  if(!monthKey){

    const months = {};


    teamRows.forEach(
      function(item){

        if(item.monthKey){

          months[
            item.monthKey
          ] = true;

        }

      }
    );


    incentiveRows.forEach(
      function(item){

        if(item.monthKey){

          months[
            item.monthKey
          ] = true;

        }

      }
    );


    const keys =
      Object.keys(
        months
      )
      .sort()
      .reverse();


    monthKey =
      keys.length
        ? keys[0]
        : "";

  }


  const monthTeam =
    teamRows.filter(
      function(item){

        return (
          !monthKey ||
          item.monthKey ===
          monthKey
        );

      }
    );


  const monthIncentives =
    incentiveRows.filter(
      function(item){

        return (
          !monthKey ||
          item.monthKey ===
          monthKey
        );

      }
    );


  //--------------------------------------------------
  // SERVER-SIDE HANDLER PRIVACY
  //--------------------------------------------------

  let permittedTeam =
    monthTeam;


  let permittedIncentives =
    monthIncentives;


  if(
    user.role !==
    "Admin"
  ){

    permittedTeam =
      monthTeam.filter(
        function(item){

          return (
            item.assigneeType ===
            "handler" &&
            POR_handlerKey_(
              item.handler
            ) ===
            POR_handlerKey_(
              user.handler
            )
          );

        }
      );


    permittedIncentives =
      monthIncentives.filter(
        function(item){

          return (
            POR_handlerKey_(
              item.handler
            ) ===
            POR_handlerKey_(
              user.handler
            )
          );

        }
      );

  }


  const summary =
    POR_buildSummary_(
      permittedTeam,
      permittedIncentives,
      user
    );


  const daily =
    POR_buildDaily_(
      permittedTeam,
      permittedIncentives,
      user
    );


  const handlerPerformance =
    user.role ===
    "Admin"
      ? POR_buildHandlerPerformance_(
          monthTeam,
          monthIncentives
        )
      : POR_buildHandlerPerformance_(
          permittedTeam,
          permittedIncentives
        );


  const actions =
    POR_loadPendingActions_(
      monthKey,
      user
    );


  const audit =
    user.role ===
    "Admin"
      ? POR_loadAudit_(
          monthKey
        )
      : [];


  return {

    ok:
      true,

    user: {
      email:
        user.email,
      handler:
        user.handler,
      role:
        user.role
    },

    selectedMonth:
      monthKey,

    selectedMonthLabel:
      monthKey
        ? POR_monthLabelFromKey_(
            monthKey
          )
        : "All Data",

    summary:
      summary,

    daily:
      daily,

    handlerPerformance:
      handlerPerformance,

    pendingActions:
      actions,

    audit:
      audit

  };

}


/******************************************************
 * PRIVATE: LOAD TEAM DATA ACTIVITY
 ******************************************************/
function POR_loadTeamActivity_(){

  const ss =
    portalOperations_();


  const sheet =
    ss.getSheetByName(
      PTR_teamDataSheetName_()
    );


  if(!sheet){

    throw new Error(
      "Team Data sheet was not found."
    );

  }


  const values =
    sheet
      .getDataRange()
      .getValues();


  const output = [];


  let currentDate =
    null;


  for(
    let i = 0;
    i < values.length;
    i++
  ){

    const colA =
      values[i][0];


    const colB =
      values[i][1];


    const colC =
      values[i][2];


    const colD =
      values[i][3];


    //--------------------------------------------------
    // Date header appears once. Carry it forward until
    // the next date header.
    //--------------------------------------------------

    if(
      colA &&
      !colB
    ){

      const parsedDate =
        POR_parseTeamDate_(
          colA
        );


      if(parsedDate){

        currentDate =
          parsedDate;

      }


      continue;

    }


    //--------------------------------------------------
    // Column B = one call/interview occurrence.
    //--------------------------------------------------

    if(!colB)
      continue;


    if(!currentDate)
      continue;


    const assignee =
      POR_classifyAssignee_(
        colC
      );


    const status =
      String(
        colD || ""
      )
      .replace(
        /\s+/g,
        " "
      )
      .trim();


    output.push({

      rowNumber:
        i + 1,

      dateObj:
        new Date(
          currentDate.getTime()
        ),

      dateKey:
        POR_dateKey_(
          currentDate
        ),

      dateLabel:
        POR_dateLabel_(
          currentDate
        ),

      monthKey:
        POR_monthKey_(
          currentDate
        ),

      originalText:
        String(
          colB || ""
        ).trim(),

      assigneeType:
        assignee.type,

      handler:
        assignee.handler,

      assigneeLabel:
        assignee.label,

      status:
        status,

      statusKey:
        status.toLowerCase(),

      selected:
        status.toLowerCase() ===
        "selected",

      inProgress:
        (
          status.toLowerCase() ===
          "in progress" ||
          status.toLowerCase() ===
          "interview in progress"
        )

    });

  }


  return output;

}


/******************************************************
 * PRIVATE: CLASSIFY TEAM DATA COLUMN C
 ******************************************************/
function POR_classifyAssignee_(
  value
){

  const label =
    String(
      value || ""
    )
    .replace(
      /\s+/g,
      " "
    )
    .trim();


  const key =
    label.toLowerCase();


  if(!key){

    return {
      type:
        "unassigned",
      handler:
        "",
      label:
        "Unassigned"
    };

  }


  if(
    key.indexOf(
      "support"
    ) === 0
  ){

    return {
      type:
        "support",
      handler:
        "",
      label:
        label
    };

  }


  if(
    key.indexOf(
      "resched"
    ) === 0
  ){

    return {
      type:
        "rescheduled",
      handler:
        "",
      label:
        label
    };

  }


  if(
    key.indexOf(
      "cancel"
    ) === 0
  ){

    return {
      type:
        "cancelled",
      handler:
        "",
      label:
        label
    };

  }


  return {
    type:
      "handler",
    handler:
      label,
    label:
      label
  };

}


/******************************************************
 * PRIVATE: LOAD PERMANENT INCENTIVES
 ******************************************************/
function POR_loadIncentives_(){

  const sheet =
    portalTracker_();


  const values =
    sheet
      .getDataRange()
      .getValues();


  if(
    !values ||
    values.length <= 1
  ){

    return [];

  }


  const output = [];


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
      .trim();


    const handler =
      String(
        row[7] || ""
      )
      .replace(
        /\s+/g,
        " "
      )
      .trim();


    const dateObj =
      POR_parseDate_(
        row[6]
      );


    if(
      !type ||
      !handler ||
      !dateObj
    ){

      continue;

    }


    output.push({

      type:
        type,

      typeKey:
        type.toLowerCase(),

      candidate:
        String(
          row[1] || ""
        ).trim(),

      client:
        String(
          row[2] || ""
        ).trim(),

      handler:
        handler,

      amount:
        POR_number_(
          row[8]
        ),

      status:
        String(
          row[9] || ""
        ).trim(),

      dateObj:
        dateObj,

      dateKey:
        POR_dateKey_(
          dateObj
        ),

      dateLabel:
        POR_dateLabel_(
          dateObj
        ),

      monthKey:
        POR_monthKey_(
          dateObj
        )

    });

  }


  return output;

}


/******************************************************
 * PRIVATE: SUMMARY
 ******************************************************/
function POR_buildSummary_(
  teamRows,
  incentiveRows,
  user
){

  const isAdmin =
    user.role ===
    "Admin";


  const output = {

    assigned:
      0,

    handled:
      0,

    support:
      0,

    rescheduled:
      0,

    cancelled:
      0,

    unassigned:
      0,

    inProgress:
      0,

    selectedOperational:
      0,

    promotions:
      0,

    selections:
      0,

    promotionAmount:
      0,

    selectionAmount:
      0,

    totalIncentive:
      0,

    activeHandlers:
      0

  };


  const handlers = {};


  teamRows.forEach(
    function(item){

      //------------------------------------------------
      // For Admin, every Column B row counts as assigned.
      // For Handler, permitted rows are already only their
      // own handled rows, so assigned == handled.
      //------------------------------------------------

      output.assigned++;


      if(
        item.assigneeType ===
        "handler"
      ){

        output.handled++;


        const key =
          POR_handlerKey_(
            item.handler
          );


        if(key){

          handlers[key] =
            true;

        }

      }


      if(
        isAdmin &&
        item.assigneeType ===
        "support"
      ){

        output.support++;

      }


      if(
        isAdmin &&
        item.assigneeType ===
        "rescheduled"
      ){

        output.rescheduled++;

      }


      if(
        isAdmin &&
        item.assigneeType ===
        "cancelled"
      ){

        output.cancelled++;

      }


      if(
        isAdmin &&
        item.assigneeType ===
        "unassigned"
      ){

        output.unassigned++;

      }


      if(item.inProgress){

        output.inProgress++;

      }


      if(item.selected){

        output.selectedOperational++;

      }

    }
  );


  incentiveRows.forEach(
    function(item){

      const amount =
        Number(
          item.amount || 0
        );


      if(
        item.typeKey ===
        "promotion"
      ){

        output.promotions++;
        output.promotionAmount +=
          amount;

      }


      if(
        item.typeKey ===
        "selection"
      ){

        output.selections++;
        output.selectionAmount +=
          amount;

      }


      output.totalIncentive +=
        amount;


      const key =
        POR_handlerKey_(
          item.handler
        );


      if(key){

        handlers[key] =
          true;

      }

    }
  );


  output.activeHandlers =
    Object.keys(
      handlers
    ).length;


  return output;

}


/******************************************************
 * PRIVATE: DAILY REPORT
 ******************************************************/
function POR_buildDaily_(
  teamRows,
  incentiveRows,
  user
){

  const isAdmin =
    user.role ===
    "Admin";


  const days = {};


  function ensureDay(
    dateKey,
    dateLabel
  ){

    if(!days[dateKey]){

      days[dateKey] = {

        dateKey:
          dateKey,

        dateLabel:
          dateLabel,

        assigned:
          0,

        handled:
          0,

        support:
          0,

        rescheduled:
          0,

        cancelled:
          0,

        unassigned:
          0,

        inProgress:
          0,

        selectedOperational:
          0,

        promotions:
          0,

        selections:
          0,

        incentive:
          0

      };

    }


    return days[dateKey];

  }


  teamRows.forEach(
    function(item){

      const day =
        ensureDay(
          item.dateKey,
          item.dateLabel
        );


      day.assigned++;


      if(
        item.assigneeType ===
        "handler"
      ){

        day.handled++;

      }


      if(
        isAdmin &&
        item.assigneeType ===
        "support"
      ){

        day.support++;

      }


      if(
        isAdmin &&
        item.assigneeType ===
        "rescheduled"
      ){

        day.rescheduled++;

      }


      if(
        isAdmin &&
        item.assigneeType ===
        "cancelled"
      ){

        day.cancelled++;

      }


      if(
        isAdmin &&
        item.assigneeType ===
        "unassigned"
      ){

        day.unassigned++;

      }


      if(item.inProgress){

        day.inProgress++;

      }


      if(item.selected){

        day.selectedOperational++;

      }

    }
  );


  incentiveRows.forEach(
    function(item){

      const day =
        ensureDay(
          item.dateKey,
          item.dateLabel
        );


      if(
        item.typeKey ===
        "promotion"
      ){

        day.promotions++;

      }


      if(
        item.typeKey ===
        "selection"
      ){

        day.selections++;

      }


      day.incentive +=
        Number(
          item.amount || 0
        );

    }
  );


  return Object.keys(
    days
  )
  .sort()
  .map(
    function(key){

      return days[key];

    }
  );

}


/******************************************************
 * PRIVATE: HANDLER PERFORMANCE
 ******************************************************/
function POR_buildHandlerPerformance_(
  teamRows,
  incentiveRows
){

  const map = {};


  function ensureHandler(
    handler
  ){

    const clean =
      String(
        handler || ""
      )
      .replace(
        /\s+/g,
        " "
      )
      .trim();


    const key =
      POR_handlerKey_(
        clean
      );


    if(!key)
      return null;


    if(!map[key]){

      map[key] = {

        handler:
          clean,

        callsHandled:
          0,

        inProgress:
          0,

        selectedOperational:
          0,

        promotions:
          0,

        selections:
          0,

        promotionAmount:
          0,

        selectionAmount:
          0,

        totalIncentive:
          0,

        promotionRate:
          0,

        selectionRate:
          0

      };

    }


    return map[key];

  }


  teamRows.forEach(
    function(item){

      if(
        item.assigneeType !==
        "handler"
      ){

        return;

      }


      const row =
        ensureHandler(
          item.handler
        );


      if(!row)
        return;


      row.callsHandled++;


      if(item.inProgress)
        row.inProgress++;


      if(item.selected)
        row.selectedOperational++;

    }
  );


  incentiveRows.forEach(
    function(item){

      const row =
        ensureHandler(
          item.handler
        );


      if(!row)
        return;


      const amount =
        Number(
          item.amount || 0
        );


      if(
        item.typeKey ===
        "promotion"
      ){

        row.promotions++;
        row.promotionAmount +=
          amount;

      }


      if(
        item.typeKey ===
        "selection"
      ){

        row.selections++;
        row.selectionAmount +=
          amount;

      }


      row.totalIncentive +=
        amount;

    }
  );


  return Object.keys(
    map
  )
  .map(
    function(key){

      const row =
        map[key];


      row.promotionRate =
        row.callsHandled > 0
          ? Math.round(
              (
                row.promotions /
                row.callsHandled
              ) *
              1000
            ) /
            10
          : 0;


      row.selectionRate =
        row.callsHandled > 0
          ? Math.round(
              (
                row.selections /
                row.callsHandled
              ) *
              1000
            ) /
            10
          : 0;


      return row;

    }
  )
  .sort(
    function(a,b){

      if(
        b.callsHandled !==
        a.callsHandled
      ){

        return (
          b.callsHandled -
          a.callsHandled
        );

      }


      if(
        b.totalIncentive !==
        a.totalIncentive
      ){

        return (
          b.totalIncentive -
          a.totalIncentive
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
 * PRIVATE: PENDING ACTION COUNTS
 ******************************************************/
function POR_loadPendingActions_(
  monthKey,
  user
){

  const result = {

    pendingRecoveries:
      0,

    recoveryExceptions:
      0,

    pendingSelectionRequests:
      0

  };


  const operations =
    portalTeamBackend_();


  //--------------------------------------------------
  // Promotion Recovery
  //--------------------------------------------------

  const recoverySheet =
    operations.getSheetByName(
      PORTAL_CONFIG.RECOVERY_SHEET
    );


  if(
    recoverySheet &&
    recoverySheet.getLastRow() > 1
  ){

    const values =
      recoverySheet
        .getDataRange()
        .getValues();


    const headers =
      POR_headerMap_(
        values[0]
      );


    const dateCol =
      POR_col_(
        headers,
        "Promotion Date"
      );


    const statusCol =
      POR_col_(
        headers,
        "Status"
      );


    const handlerCol =
      POR_col_(
        headers,
        "Suggested Handler"
      );


    if(
      dateCol >= 0 &&
      statusCol >= 0
    ){

      for(
        let i = 1;
        i < values.length;
        i++
      ){

        const dateObj =
          POR_parseDate_(
            values[i][dateCol]
          );


        if(
          monthKey &&
          (
            !dateObj ||
            POR_monthKey_(
              dateObj
            ) !==
            monthKey
          )
        ){

          continue;

        }


        if(
          String(
            values[i][statusCol] || ""
          )
          .trim()
          .toLowerCase() !==
          "pending"
        ){

          continue;

        }


        if(
          user.role !==
          "Admin"
        ){

          if(
            handlerCol < 0 ||
            POR_handlerKey_(
              values[i][handlerCol]
            ) !==
            POR_handlerKey_(
              user.handler
            )
          ){

            continue;

          }

        }


        result.pendingRecoveries++;

      }

    }

  }


  //--------------------------------------------------
  // Recovery Exceptions
  //--------------------------------------------------

  const exceptionSheet =
    operations.getSheetByName(
      PORTAL_CONFIG.RECOVERY_EXCEPTIONS_SHEET
    );


  if(
    exceptionSheet &&
    exceptionSheet.getLastRow() > 1
  ){

    const values =
      exceptionSheet
        .getDataRange()
        .getValues();


    const headers =
      POR_headerMap_(
        values[0]
      );


    const dateCol =
      POR_col_(
        headers,
        "Promotion Date"
      );


    const statusCol =
      POR_col_(
        headers,
        "Status"
      );


    const handlerCol =
      POR_col_(
        headers,
        "Suggested Handler(s)"
      );


    if(
      dateCol >= 0 &&
      statusCol >= 0
    ){

      for(
        let i = 1;
        i < values.length;
        i++
      ){

        const dateObj =
          POR_parseDate_(
            values[i][dateCol]
          );


        if(
          monthKey &&
          (
            !dateObj ||
            POR_monthKey_(
              dateObj
            ) !==
            monthKey
          )
        ){

          continue;

        }


        if(
          String(
            values[i][statusCol] || ""
          )
          .trim()
          .toLowerCase() !==
          "review"
        ){

          continue;

        }


        if(
          user.role !==
          "Admin"
        ){

          if(
            handlerCol < 0 ||
            !POR_handlerListContains_(
              values[i][handlerCol],
              user.handler
            )
          ){

            continue;

          }

        }


        result.recoveryExceptions++;

      }

    }

  }


  //--------------------------------------------------
  // Selection Requests - private backend
  //--------------------------------------------------

  const backend =
    portalBackend_();


  const requestSheet =
    backend.getSheetByName(
      PTR_controlSheetName_(PORTAL_CONFIG.SELECTION_REQUESTS_SHEET)
    );


  if(
    requestSheet &&
    requestSheet.getLastRow() > 1
  ){

    const values =
      requestSheet
        .getDataRange()
        .getValues();


    const headers =
      POR_headerMap_(
        values[0]
      );


    const dateCol =
      POR_col_(
        headers,
        "Interview Date"
      );


    const statusCol =
      POR_col_(
        headers,
        "Request Status"
      );


    const handlerCol =
      POR_col_(
        headers,
        "Handler"
      );


    if(
      dateCol >= 0 &&
      statusCol >= 0
    ){

      for(
        let i = 1;
        i < values.length;
        i++
      ){

        const dateObj =
          POR_parseDate_(
            values[i][dateCol]
          );


        if(
          monthKey &&
          (
            !dateObj ||
            POR_monthKey_(
              dateObj
            ) !==
            monthKey
          )
        ){

          continue;

        }


        if(
          String(
            values[i][statusCol] || ""
          )
          .trim()
          .toLowerCase() !==
          "pending"
        ){

          continue;

        }


        if(
          user.role !==
          "Admin"
        ){

          if(
            handlerCol < 0 ||
            POR_handlerKey_(
              values[i][handlerCol]
            ) !==
            POR_handlerKey_(
              user.handler
            )
          ){

            continue;

          }

        }


        result.pendingSelectionRequests++;

      }

    }

  }


  return result;

}


/******************************************************
 * PRIVATE: ADMIN AUDIT LOG
 ******************************************************/
function POR_loadAudit_(
  monthKey
){

  const backend =
    portalBackend_();


  const sheet =
    backend.getSheetByName(
      PTR_controlSheetName_(PORTAL_CONFIG.PORTAL_AUDIT_SHEET)
    );


  if(
    !sheet ||
    sheet.getLastRow() <= 1
  ){

    return [];

  }


  const values =
    sheet
      .getDataRange()
      .getValues();


  const headers =
    POR_headerMap_(
      values[0]
    );


  const timestampCol =
    POR_col_(
      headers,
      "Timestamp"
    );


  if(timestampCol < 0)
    return [];


  const output = [];


  for(
    let i = 1;
    i < values.length;
    i++
  ){

    const row =
      values[i];


    const timestamp =
      POR_parseDate_(
        row[timestampCol]
      );


    if(!timestamp)
      continue;


    if(
      monthKey &&
      POR_monthKey_(
        timestamp
      ) !==
      monthKey
    ){

      continue;

    }


    output.push({

      timestampSort:
        timestamp.getTime(),

      timestamp:
        POR_dateTimeLabel_(
          timestamp
        ),

      actorEmail:
        POR_text_(
          row,
          headers,
          "Actor Email"
        ),

      role:
        POR_text_(
          row,
          headers,
          "Role"
        ),

      action:
        POR_text_(
          row,
          headers,
          "Action"
        ),

      targetType:
        POR_text_(
          row,
          headers,
          "Target Type"
        ),

      targetId:
        POR_text_(
          row,
          headers,
          "Target ID"
        ),

      oldValue:
        POR_text_(
          row,
          headers,
          "Old Value"
        ),

      newValue:
        POR_text_(
          row,
          headers,
          "New Value"
        ),

      handler:
        POR_text_(
          row,
          headers,
          "Handler"
        ),

      details:
        POR_text_(
          row,
          headers,
          "Details"
        )

    });

  }


  output.sort(
    function(a,b){

      return (
        b.timestampSort -
        a.timestampSort
      );

    }
  );


  return output
    .slice(
      0,
      250
    )
    .map(
      function(item){

        delete item.timestampSort;
        return item;

      }
    );

}


/******************************************************
 * PRIVATE: TEAM DATE PARSER
 *
 * Examples:
 * 7/7/2026 Tuesday
 * 08/11/2026
 * Date object
 ******************************************************/
function POR_parseTeamDate_(
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
        value.getFullYear(),
        value.getMonth(),
        value.getDate()
      );

    }


    return null;

  }


  let text =
    String(
      value || ""
    )
    .trim();


  if(!text)
    return null;


  text =
    text.replace(
      /\s+(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)$/i,
      ""
    )
    .trim();


  const slash =
    text.match(
      /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/
    );


  if(slash){

    const date =
      new Date(
        Number(
          slash[3]
        ),
        Number(
          slash[1]
        ) - 1,
        Number(
          slash[2]
        )
      );


    return isNaN(
      date.getTime()
    )
      ? null
      : date;

  }


  return POR_parseDate_(
    text
  );

}


/******************************************************
 * PRIVATE: GENERAL DATE PARSER
 ******************************************************/
function POR_parseDate_(
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


  let match =
    text.match(
      /^(\d{1,2})-([A-Za-z]{3,9})-(\d{4})$/
    );


  if(match){

    const months = {
      jan:0,january:0,
      feb:1,february:1,
      mar:2,march:2,
      apr:3,april:3,
      may:4,
      jun:5,june:5,
      jul:6,july:6,
      aug:7,august:7,
      sep:8,sept:8,september:8,
      oct:9,october:9,
      nov:10,november:10,
      dec:11,december:11
    };


    const month =
      months[
        String(
          match[2]
        )
        .toLowerCase()
      ];


    if(
      month !==
      undefined
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
 * PRIVATE: HEADER HELPERS
 ******************************************************/
function POR_headerMap_(
  headerRow
){

  const map = {};


  headerRow.forEach(
    function(value,index){

      const key =
        String(
          value || ""
        )
        .trim()
        .toLowerCase();


      if(key){

        map[key] =
          index;

      }

    }
  );


  return map;

}


function POR_col_(
  headers,
  name
){

  const key =
    String(
      name || ""
    )
    .trim()
    .toLowerCase();


  return Object.prototype
    .hasOwnProperty
    .call(
      headers,
      key
    )
      ? headers[key]
      : -1;

}


function POR_text_(
  row,
  headers,
  name
){

  const col =
    POR_col_(
      headers,
      name
    );


  return col >= 0
    ? String(
        row[col] || ""
      ).trim()
    : "";

}


/******************************************************
 * PRIVATE: HANDLER / NUMBER / DATE HELPERS
 ******************************************************/
function POR_handlerKey_(
  value
){

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


function POR_handlerListContains_(
  value,
  handler
){

  const target =
    POR_handlerKey_(
      handler
    );


  if(!target)
    return false;


  const parts =
    String(
      value || ""
    )
    .split(
      /[,;|\/]+/
    )
    .map(
      function(part){

        return POR_handlerKey_(
          part
        );

      }
    )
    .filter(
      Boolean
    );


  return (
    parts.indexOf(
      target
    ) > -1
  );

}


function POR_number_(
  value
){

  const cleaned =
    String(
      value || ""
    )
    .replace(
      /[₹,%\s,]/g,
      ""
    )
    .trim();


  const number =
    Number(
      cleaned
    );


  return isNaN(
    number
  )
    ? 0
    : number;

}


function POR_dateKey_(
  dateObj
){

  return Utilities.formatDate(
    dateObj,
    PORTAL_CONFIG.TIME_ZONE,
    "yyyy-MM-dd"
  );

}


function POR_dateLabel_(
  dateObj
){

  return Utilities.formatDate(
    dateObj,
    PORTAL_CONFIG.TIME_ZONE,
    "dd-MMM-yyyy"
  );

}


function POR_dateTimeLabel_(
  dateObj
){

  return Utilities.formatDate(
    dateObj,
    PORTAL_CONFIG.TIME_ZONE,
    "dd-MMM-yyyy hh:mm a"
  );

}


function POR_monthKey_(
  dateObj
){

  return Utilities.formatDate(
    dateObj,
    PORTAL_CONFIG.TIME_ZONE,
    "yyyy-MM"
  );

}


function POR_monthLabelFromKey_(
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
    return monthKey;


  return Utilities.formatDate(
    new Date(
      Number(
        match[1]
      ),
      Number(
        match[2]
      ) - 1,
      1
    ),
    PORTAL_CONFIG.TIME_ZONE,
    "MMM-yyyy"
  );

}
