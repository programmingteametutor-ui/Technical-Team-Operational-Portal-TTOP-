/******************************************************
 * PORTALACTIONS.GS
 * Combined Operations Phase
 *
 * WRITE FUNCTIONS:
 * - Admin approve/reject Recovery
 * - Admin resolve/ignore Recovery Exceptions
 * - Admin mark Team Data interview Selected
 * - Handler submit Selection Request
 * - Admin approve/reject Selection Request
 *
 * READ FUNCTIONS:
 * - Interview Status / Selection Requests
 *
 * SECURITY:
 * - Every function validates the OTP session.
 * - Recovery/Exception writes are Admin only.
 * - Team Data direct "Selected" write is Admin only.
 * - Handler can only request selection for their OWN
 *   Team Data row.
 *
 * AUDIT:
 * - Every write is logged to private backend:
 *   Portal Action Log
 ******************************************************/


/******************************************************
 * PUBLIC: UPDATE RECOVERY STATUS
 *
 * Allowed:
 * Pending -> Approved
 * Pending -> Rejected
 ******************************************************/
function updatePortalRecoveryStatus(
  token,
  recoveryId,
  newStatus
){

  const user =
    PO_requireAdmin_(
      token
    );


  const id =
    String(
      recoveryId || ""
    )
    .trim();


  const requested =
    PO_normalizeAllowed_(
      newStatus,
      [
        "Approved",
        "Rejected"
      ]
    );


  if(
    !id ||
    !requested
  ){

    throw new Error(
      "Invalid recovery update."
    );

  }


  const lock =
    LockService
      .getScriptLock();


  lock.waitLock(
    10000
  );


  try{

    const ss =
      portalTeamBackend_();


    const sheet =
      ss.getSheetByName(
        PORTAL_CONFIG.RECOVERY_SHEET
      );


    if(!sheet){

      throw new Error(
        "Promotion Recovery sheet was not found."
      );

    }


    const values =
      sheet
        .getDataRange()
        .getValues();


    if(values.length <= 1){

      throw new Error(
        "Recovery record was not found."
      );

    }


    const headers =
      PO_headerMap_(
        values[0]
      );


    const idCol =
      PO_requireColumn_(
        headers,
        "Recovery ID",
        "Promotion Recovery"
      );


    const statusCol =
      PO_requireColumn_(
        headers,
        "Status",
        "Promotion Recovery"
      );


    const handlerCol =
      PO_requireColumn_(
        headers,
        "Suggested Handler",
        "Promotion Recovery"
      );


    const candidateCol =
      PO_requireColumn_(
        headers,
        "Candidate",
        "Promotion Recovery"
      );


    const amountCol =
      PO_requireColumn_(
        headers,
        "Amount",
        "Promotion Recovery"
      );


    let rowIndex =
      -1;


    for(
      let i = 1;
      i < values.length;
      i++
    ){

      if(
        String(
          values[i][idCol] || ""
        )
        .trim() ===
        id
      ){

        rowIndex =
          i;

        break;

      }

    }


    if(rowIndex < 0){

      throw new Error(
        "Recovery ID was not found."
      );

    }


    const current =
      String(
        values[rowIndex][statusCol] || ""
      )
      .trim();


    if(
      current.toLowerCase() ===
      requested.toLowerCase()
    ){

      return {
        ok:
          true,
        id:
          id,
        status:
          requested,
        changed:
          false
      };

    }


    if(
      current.toLowerCase() !==
      "pending"
    ){

      throw new Error(
        "Only Pending recovery records can be approved or rejected from the portal."
      );

    }


    sheet
      .getRange(
        rowIndex + 1,
        statusCol + 1
      )
      .setValue(
        requested
      );


    PO_appendAudit_({

      actorEmail:
        user.email,

      role:
        user.role,

      action:
        requested === "Approved"
          ? "Approve Recovery"
          : "Reject Recovery",

      targetType:
        "Recovery",

      targetId:
        id,

      oldValue:
        current,

      newValue:
        requested,

      handler:
        String(
          values[rowIndex][handlerCol] || ""
        ).trim(),

      details:
        String(
          values[rowIndex][candidateCol] || ""
        ).trim() +
        " | ₹" +
        PO_number_(
          values[rowIndex][amountCol]
        )

    });


    return {

      ok:
        true,

      id:
        id,

      status:
        requested,

      changed:
        true

    };

  }
  finally{

    lock.releaseLock();

  }

}


/******************************************************
 * PUBLIC: UPDATE EXCEPTION STATUS
 *
 * Allowed:
 * Review -> Resolved
 * Review -> Ignore
 ******************************************************/
function updatePortalExceptionStatus(
  token,
  exceptionId,
  newStatus
){

  const user =
    PO_requireAdmin_(
      token
    );


  const id =
    String(
      exceptionId || ""
    )
    .trim();


  const requested =
    PO_normalizeAllowed_(
      newStatus,
      [
        "Resolved",
        "Ignore"
      ]
    );


  if(
    !id ||
    !requested
  ){

    throw new Error(
      "Invalid recovery exception update."
    );

  }


  const lock =
    LockService
      .getScriptLock();


  lock.waitLock(
    10000
  );


  try{

    const ss =
      portalTeamBackend_();


    const sheet =
      ss.getSheetByName(
        PORTAL_CONFIG.RECOVERY_EXCEPTIONS_SHEET
      );


    if(!sheet){

      throw new Error(
        "Recovery Exceptions sheet was not found."
      );

    }


    const values =
      sheet
        .getDataRange()
        .getValues();


    const headers =
      PO_headerMap_(
        values[0] || []
      );


    const idCol =
      PO_requireColumn_(
        headers,
        "Exception ID",
        "Recovery Exceptions"
      );


    const statusCol =
      PO_requireColumn_(
        headers,
        "Status",
        "Recovery Exceptions"
      );


    const handlerCol =
      PO_requireColumn_(
        headers,
        "Suggested Handler(s)",
        "Recovery Exceptions"
      );


    const candidateCol =
      PO_requireColumn_(
        headers,
        "Candidate",
        "Recovery Exceptions"
      );


    let rowIndex =
      -1;


    for(
      let i = 1;
      i < values.length;
      i++
    ){

      if(
        String(
          values[i][idCol] || ""
        )
        .trim() ===
        id
      ){

        rowIndex =
          i;

        break;

      }

    }


    if(rowIndex < 0){

      throw new Error(
        "Exception ID was not found."
      );

    }


    const current =
      String(
        values[rowIndex][statusCol] || ""
      )
      .trim();


    if(
      current.toLowerCase() ===
      requested.toLowerCase()
    ){

      return {
        ok:
          true,
        id:
          id,
        status:
          requested,
        changed:
          false
      };

    }


    if(
      current.toLowerCase() !==
      "review"
    ){

      throw new Error(
        "Only Review exceptions can be resolved or ignored from the portal."
      );

    }


    sheet
      .getRange(
        rowIndex + 1,
        statusCol + 1
      )
      .setValue(
        requested
      );


    PO_appendAudit_({

      actorEmail:
        user.email,

      role:
        user.role,

      action:
        requested === "Resolved"
          ? "Resolve Exception"
          : "Ignore Exception",

      targetType:
        "Recovery Exception",

      targetId:
        id,

      oldValue:
        current,

      newValue:
        requested,

      handler:
        String(
          values[rowIndex][handlerCol] || ""
        ).trim(),

      details:
        String(
          values[rowIndex][candidateCol] || ""
        ).trim()

    });


    return {

      ok:
        true,

      id:
        id,

      status:
        requested,

      changed:
        true

    };

  }
  finally{

    lock.releaseLock();

  }

}


/******************************************************
 * PUBLIC: INTERVIEW STATUS PAGE DATA
 ******************************************************/
function getPortalInterviewStatusData(
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


  const monthKey =
    String(
      requestedMonth || ""
    )
    .trim();


  const interviews =
    PO_loadTeamInterviews_();


  const requests =
    PO_loadSelectionRequests_();


  const requestByTeamRow = {};


  requests.forEach(
    function(request){

      const key =
        String(
          request.teamRow
        );


      if(
        !requestByTeamRow[key] ||
        PO_requestPriority_(
          request.status
        ) >
        PO_requestPriority_(
          requestByTeamRow[key].status
        )
      ){

        requestByTeamRow[key] =
          request;

      }

    }
  );


  let permitted =
    interviews;


  if(
    user.role !==
    "Admin"
  ){

    permitted =
      interviews.filter(
        function(item){

          return (
            PO_handlerKey_(
              item.handler
            ) ===
            PO_handlerKey_(
              user.handler
            )
          );

        }
      );

  }


  if(
    monthKey &&
    /^\d{4}-\d{2}$/.test(
      monthKey
    )
  ){

    permitted =
      permitted.filter(
        function(item){

          return (
            item.monthKey ===
            monthKey
          );

        }
      );

  }


  permitted.sort(
    function(a,b){

      if(
        b.dateSort !==
        a.dateSort
      ){

        return (
          b.dateSort -
          a.dateSort
        );

      }


      return (
        b.rowNumber -
        a.rowNumber
      );

    }
  );


  const safeInterviews =
    permitted
      .slice(
        0,
        1200
      )
      .map(
        function(item){

          const request =
            requestByTeamRow[
              String(
                item.rowNumber
              )
            ] ||
            null;


          const safeRequest =
            request
              ? {

                  requestId:
                    request.requestId,

                  status:
                    request.status,

                  requestedAt:
                    request.requestedAtLabel,

                  reviewedAt:
                    request.reviewedAtLabel

                }
              : null;


          return {

            rowNumber:
              item.rowNumber,

            date:
              item.dateLabel,

            monthKey:
              item.monthKey,

            candidate:
              item.candidate,

            client:
              item.client,

            round:
              item.round,

            time:
              item.time,

            handler:
              user.role === "Admin"
                ? item.handler
                : user.handler,

            status:
              item.status,

            originalText:
              item.originalText,

            selected:
              item.statusKey ===
              "selected",

            selectionRequest:
              safeRequest

          };

        }
      );


  const pendingRequests =
    requests.filter(
      function(request){

        if(
          String(
            request.status || ""
          )
          .trim()
          .toLowerCase() !==
          "pending"
        ){

          return false;

        }


        if(
          monthKey &&
          request.monthKey !==
          monthKey
        ){

          return false;

        }


        if(
          user.role !==
          "Admin"
        ){

          return (
            PO_handlerKey_(
              request.handler
            ) ===
            PO_handlerKey_(
              user.handler
            )
          );

        }


        return true;

      }
    )
    .map(
      function(request){

        return {

          requestId:
            request.requestId,

          teamRow:
            request.teamRow,

          requestedAt:
            request.requestedAtLabel,

          handler:
            user.role === "Admin"
              ? request.handler
              : user.handler,

          date:
            request.interviewDateLabel,

          candidate:
            request.candidate,

          client:
            request.client,

          round:
            request.round,

          currentStatus:
            request.currentStatus,

          status:
            request.status

        };

      }
    );


  const summary = {

    interviews:
      safeInterviews.length,

    inProgress:
      0,

    selected:
      0,

    other:
      0,

    pendingRequests:
      pendingRequests.length

  };


  safeInterviews.forEach(
    function(item){

      const status =
        String(
          item.status || ""
        )
        .trim()
        .toLowerCase();


      if(status === "selected"){

        summary.selected++;

      }else if(
        status === "in progress" ||
        status === "interview in progress"
      ){

        summary.inProgress++;

      }else{

        summary.other++;

      }

    }
  );


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
        ? PO_monthLabelFromKey_(
            monthKey
          )
        : "All Interviews",

    summary:
      summary,

    interviews:
      safeInterviews,

    pendingRequests:
      pendingRequests

  };

}


/******************************************************
 * PUBLIC: HANDLER REPORTS SELECTION
 *
 * Does NOT change Team Data.
 * Creates a private Selection Request for Admin.
 ******************************************************/
function submitSelectionRequest(
  token,
  teamRow
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


  if(
    user.role !==
    "Handler"
  ){

    throw new Error(
      "HANDLER_ACCESS_REQUIRED"
    );

  }


  const rowNumber =
    Number(
      teamRow
    );


  if(
    !rowNumber ||
    rowNumber < 1
  ){

    throw new Error(
      "Invalid Team Data row."
    );

  }


  const lock =
    LockService
      .getScriptLock();


  lock.waitLock(
    10000
  );


  try{

    const interview =
      PO_getTeamInterviewByRow_(
        rowNumber
      );


    if(!interview){

      throw new Error(
        "The Team Data interview row was not found."
      );

    }


    if(
      PO_handlerKey_(
        interview.handler
      ) !==
      PO_handlerKey_(
        user.handler
      )
    ){

      throw new Error(
        "You can only report selections for your own interviews."
      );

    }


    if(
      interview.statusKey ===
      "selected"
    ){

      throw new Error(
        "This interview is already marked Selected."
      );

    }


    const sheet =
      PO_getSelectionRequestsSheet_();


    const existing =
      PO_findPendingSelectionRequestByTeamRow_(
        sheet,
        rowNumber
      );


    if(existing){

      return {

        ok:
          true,

        requestId:
          existing.requestId,

        status:
          "Pending",

        changed:
          false,

        message:
          "A selection request is already pending for this interview."

      };

    }


    const requestId =
      PO_buildRequestId_(
        rowNumber,
        user.email
      );


    const now =
      new Date();


    sheet.appendRow([

      requestId,
      now,
      user.email,
      user.handler,
      rowNumber,
      interview.dateObj || "",
      interview.candidate,
      interview.client,
      interview.round,
      interview.status,
      "Selected",
      "Pending",
      "",
      "",
      "",
      interview.originalText

    ]);


    PO_appendAudit_({

      actorEmail:
        user.email,

      role:
        user.role,

      action:
        "Report Selection",

      targetType:
        "Selection Request",

      targetId:
        requestId,

      oldValue:
        interview.status,

      newValue:
        "Pending Admin Confirmation",

      handler:
        user.handler,

      details:
        interview.candidate +
        " | " +
        interview.client +
        " | Team Row " +
        rowNumber

    });


    return {

      ok:
        true,

      requestId:
        requestId,

      status:
        "Pending",

      changed:
        true

    };

  }
  finally{

    lock.releaseLock();

  }

}


/******************************************************
 * PUBLIC: ADMIN MARK INTERVIEW SELECTED DIRECTLY
 *
 * Changes Team Data Column D to "Selected".
 *
 * IMPORTANT:
 * The portal does NOT calculate or append the ₹2,000
 * incentive itself. The normal incentive scan remains
 * responsible for that.
 ******************************************************/
function adminMarkInterviewSelected(
  token,
  teamRow
){

  const user =
    PO_requireAdmin_(
      token
    );


  const rowNumber =
    Number(
      teamRow
    );


  if(
    !rowNumber ||
    rowNumber < 1
  ){

    throw new Error(
      "Invalid Team Data row."
    );

  }


  const lock =
    LockService
      .getScriptLock();


  lock.waitLock(
    10000
  );


  try{

    const interview =
      PO_getTeamInterviewByRow_(
        rowNumber
      );


    if(!interview){

      throw new Error(
        "The Team Data interview row was not found."
      );

    }


    if(
      interview.statusKey ===
      "selected"
    ){

      return {

        ok:
          true,

        changed:
          false,

        status:
          "Selected",

        message:
          "This interview is already Selected."

      };

    }


    const sheet =
      portalOperations_()
        .getSheetByName(
          PTR_teamDataSheetName_()
        );


    const oldStatus =
      interview.status;


    sheet
      .getRange(
        rowNumber,
        4
      )
      .setValue(
        "Selected"
      );


    PO_appendAudit_({

      actorEmail:
        user.email,

      role:
        user.role,

      action:
        "Mark Interview Selected",

      targetType:
        "Team Data",

      targetId:
        "ROW-" +
        rowNumber,

      oldValue:
        oldStatus,

      newValue:
        "Selected",

      handler:
        interview.handler,

      details:
        interview.candidate +
        " | " +
        interview.client +
        " | " +
        interview.round

    });


    return {

      ok:
        true,

      changed:
        true,

      status:
        "Selected",

      message:
        "Team Data was updated to Selected. The normal incentive scan will create/synchronize the selection incentive."

    };

  }
  finally{

    lock.releaseLock();

  }

}


/******************************************************
 * PUBLIC: ADMIN REVIEW SELECTION REQUEST
 *
 * Approved:
 * - request -> Approved
 * - Team Data row -> Selected
 *
 * Rejected:
 * - request -> Rejected
 * - Team Data is not changed
 ******************************************************/
function reviewSelectionRequest(
  token,
  requestId,
  decision
){

  const user =
    PO_requireAdmin_(
      token
    );


  const id =
    String(
      requestId || ""
    )
    .trim();


  const requested =
    PO_normalizeAllowed_(
      decision,
      [
        "Approved",
        "Rejected"
      ]
    );


  if(
    !id ||
    !requested
  ){

    throw new Error(
      "Invalid selection request review."
    );

  }


  const lock =
    LockService
      .getScriptLock();


  lock.waitLock(
    10000
  );


  try{

    const requestSheet =
      PO_getSelectionRequestsSheet_();


    const values =
      requestSheet
        .getDataRange()
        .getValues();


    const headers =
      PO_headerMap_(
        values[0] || []
      );


    const idCol =
      PO_requireColumn_(
        headers,
        "Request ID",
        "Selection Requests"
      );


    const statusCol =
      PO_requireColumn_(
        headers,
        "Request Status",
        "Selection Requests"
      );


    const rowCol =
      PO_requireColumn_(
        headers,
        "Team Row",
        "Selection Requests"
      );


    const handlerCol =
      PO_requireColumn_(
        headers,
        "Handler",
        "Selection Requests"
      );


    const candidateCol =
      PO_requireColumn_(
        headers,
        "Candidate",
        "Selection Requests"
      );


    const clientCol =
      PO_requireColumn_(
        headers,
        "Client",
        "Selection Requests"
      );


    const reviewedAtCol =
      PO_requireColumn_(
        headers,
        "Reviewed At",
        "Selection Requests"
      );


    const reviewedByCol =
      PO_requireColumn_(
        headers,
        "Reviewed By Email",
        "Selection Requests"
      );


    let requestRowIndex =
      -1;


    for(
      let i = 1;
      i < values.length;
      i++
    ){

      if(
        String(
          values[i][idCol] || ""
        )
        .trim() ===
        id
      ){

        requestRowIndex =
          i;

        break;

      }

    }


    if(requestRowIndex < 0){

      throw new Error(
        "Selection request was not found."
      );

    }


    const currentStatus =
      String(
        values[requestRowIndex][statusCol] || ""
      )
      .trim();


    if(
      currentStatus.toLowerCase() !==
      "pending"
    ){

      throw new Error(
        "Only Pending selection requests can be reviewed."
      );

    }


    const teamRow =
      Number(
        values[requestRowIndex][rowCol]
      );


    const handler =
      String(
        values[requestRowIndex][handlerCol] || ""
      )
      .trim();


    const candidate =
      String(
        values[requestRowIndex][candidateCol] || ""
      )
      .trim();


    const client =
      String(
        values[requestRowIndex][clientCol] || ""
      )
      .trim();


    let oldTeamStatus =
      "";


    if(
      requested ===
      "Approved"
    ){

      const interview =
        PO_getTeamInterviewByRow_(
          teamRow
        );


      if(!interview){

        throw new Error(
          "The Team Data row referenced by this request no longer exists."
        );

      }


      if(
        PO_handlerKey_(
          interview.handler
        ) !==
        PO_handlerKey_(
          handler
        )
      ){

        throw new Error(
          "Team Data handler changed since this request was submitted. Review manually."
        );

      }


      oldTeamStatus =
        interview.status;


      if(
        interview.statusKey !==
        "selected"
      ){

        const teamSheet =
          portalOperations_()
            .getSheetByName(
              PTR_teamDataSheetName_()
            );


        teamSheet
          .getRange(
            teamRow,
            4
          )
          .setValue(
            "Selected"
          );

      }

    }


    const now =
      new Date();


    requestSheet
      .getRange(
        requestRowIndex + 1,
        statusCol + 1
      )
      .setValue(
        requested
      );


    requestSheet
      .getRange(
        requestRowIndex + 1,
        reviewedAtCol + 1
      )
      .setValue(
        now
      );


    requestSheet
      .getRange(
        requestRowIndex + 1,
        reviewedByCol + 1
      )
      .setValue(
        user.email
      );


    PO_appendAudit_({

      actorEmail:
        user.email,

      role:
        user.role,

      action:
        requested === "Approved"
          ? "Approve Selection Request"
          : "Reject Selection Request",

      targetType:
        "Selection Request",

      targetId:
        id,

      oldValue:
        "Pending",

      newValue:
        requested,

      handler:
        handler,

      details:
        candidate +
        " | " +
        client +
        " | Team Row " +
        teamRow +
        (
          requested === "Approved"
            ? " | Team Status: " +
              oldTeamStatus +
              " -> Selected"
            : ""
        )

    });


    return {

      ok:
        true,

      requestId:
        id,

      status:
        requested,

      changed:
        true,

      message:
        requested === "Approved"
          ? "Selection request approved and Team Data updated to Selected. The normal incentive scan will create/synchronize the selection incentive."
          : "Selection request rejected. Team Data was not changed."

    };

  }
  finally{

    lock.releaseLock();

  }

}


/******************************************************
 * PRIVATE: LOAD TEAM DATA ROWS
 *
 * Team Data structure follows the working Parser:
 * A = date header
 * B = interview text
 * C = handler
 * D = status
 ******************************************************/
function PO_loadTeamInterviews_(){

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

    const rowNumber =
      i + 1;


    const colA =
      values[i][0];


    const colB =
      values[i][1];


    const colC =
      values[i][2];


    const colD =
      values[i][3];


    //--------------------------------------------------
    // Date header
    //--------------------------------------------------

    if(
      colA &&
      !colB
    ){

      currentDate =
        PO_parseDate_(
          colA
        );


      continue;

    }


    if(!colB)
      continue;


    const parsed =
      PO_parseInterviewText_(
        colB
      );


    const dateObj =
      currentDate
        ? new Date(
            currentDate.getTime()
          )
        : null;


    const handler =
      String(
        colC || ""
      )
      .replace(
        /\s+/g,
        " "
      )
      .trim();


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
        rowNumber,

      dateObj:
        dateObj,

      dateLabel:
        dateObj
          ? PO_dateLabel_(
              dateObj
            )
          : "",

      dateSort:
        dateObj
          ? dateObj.getTime()
          : 0,

      monthKey:
        dateObj
          ? PO_monthKey_(
              dateObj
            )
          : "",

      candidate:
        parsed.candidate,

      client:
        parsed.client,

      round:
        parsed.round,

      time:
        parsed.time,

      handler:
        handler,

      status:
        status,

      statusKey:
        status.toLowerCase(),

      originalText:
        String(
          colB || ""
        ).trim()

    });

  }


  return output;

}


/******************************************************
 * PRIVATE: GET ONE TEAM INTERVIEW BY SOURCE ROW
 ******************************************************/
function PO_getTeamInterviewByRow_(
  rowNumber
){

  const rows =
    PO_loadTeamInterviews_();


  for(
    let i = 0;
    i < rows.length;
    i++
  ){

    if(
      Number(
        rows[i].rowNumber
      ) ===
      Number(
        rowNumber
      )
    ){

      return rows[i];

    }

  }


  return null;

}


/******************************************************
 * PRIVATE: LIGHTWEIGHT INTERVIEW PARSER
 *
 * This parser is ONLY for portal display.
 * It does not participate in incentive calculation.
 ******************************************************/
function PO_parseInterviewText_(
  text
){

  // Reuse the central identity parser when installed so Interview
  // Status / Selection views show canonical Candidate + Client and
  // keep Role/Position separate from Client.
  if(typeof PIM_parseInterviewTextForPortal_ === "function"){
    return PIM_parseInterviewTextForPortal_(text);
  }

  const original =
    String(
      text || ""
    )
    .trim();


  const normalized =
    original
      .replace(
        /[–—]/g,
        "-"
      );


  let candidate =
    "";


  const firstDash =
    normalized.indexOf(
      "-"
    );


  if(firstDash > -1){

    candidate =
      normalized
        .substring(
          0,
          firstDash
        )
        .replace(
          /\([^)]*\)/g,
          ""
        )
        .trim();

  }else{

    candidate =
      normalized;

  }


  let client =
    "";


  const clientMatch =
    normalized.match(
      /(?:Interview|Phone Interview|Phone Call|Recruiter Call)\s*-\s*(.*?)\s*-\s*\d{1,2}:\d{2}/i
    );


  if(clientMatch){

    client =
      String(
        clientMatch[1] || ""
      )
      .trim();

  }


  //--------------------------------------------------
  // Fallback: time-first pattern
  //--------------------------------------------------

  if(!client){

    const afterInterview =
      normalized.match(
        /(?:Interview|Phone Interview|Phone Call|Recruiter Call)\s*-\s*(.*)$/i
      );


    if(afterInterview){

      const tail =
        String(
          afterInterview[1] || ""
        )
        .trim();


      const timeFirst =
        tail.match(
          /^\d{1,2}:\d{2}\s*[AP]M\s*(?:IST\b)?\s*(.*?)(?:\s*\(|$)/i
        );


      if(timeFirst){

        client =
          String(
            timeFirst[1] || ""
          )
          .replace(
            /\s*-\s*$/,
            ""
          )
          .trim();

      }

    }

  }


  let round =
    "";


  if(
    /\bfinal(?:\s+round)?\b/i.test(
      normalized
    )
  ){

    round =
      "Final";

  }else{

    const roundMatch =
      normalized.match(
        /(\d+)(st|nd|rd|th)\s+round/i
      );


    if(roundMatch){

      round =
        roundMatch[1] +
        String(
          roundMatch[2]
        )
        .toLowerCase() +
        " Round";

    }

  }


  const timeMatch =
    normalized.match(
      /(\d{1,2}:\d{2}\s*[AP]M)/i
    );


  const time =
    timeMatch
      ? String(
          timeMatch[1]
        )
        .toUpperCase()
      : "";


  return {

    candidate:
      candidate,

    client:
      client,

    round:
      round,

    time:
      time

  };

}


/******************************************************
 * PRIVATE: SELECTION REQUESTS SHEET
 *
 * Stored in PRIVATE BACKEND.
 ******************************************************/
function PO_getSelectionRequestsSheet_(){

  const ss =
    portalTeamBackend_();


  let sheet =
    ss.getSheetByName(
      PTR_controlSheetName_(PORTAL_CONFIG.SELECTION_REQUESTS_SHEET)
    );


  if(!sheet){

    sheet =
      ss.insertSheet(
        PTR_controlSheetName_(PORTAL_CONFIG.SELECTION_REQUESTS_SHEET)
      );

  }


  if(sheet.getLastRow() === 0){

    sheet.appendRow([

      "Request ID",
      "Requested At",
      "Requested By Email",
      "Handler",
      "Team Row",
      "Interview Date",
      "Candidate",
      "Client",
      "Round",
      "Current Status",
      "Requested Status",
      "Request Status",
      "Reviewed At",
      "Reviewed By Email",
      "Review Note",
      "Original Interview Text"

    ]);


    sheet.setFrozenRows(
      1
    );


    sheet
      .getRange(
        1,
        1,
        1,
        16
      )
      .setFontWeight(
        "bold"
      );

  }


  return sheet;

}


/******************************************************
 * PRIVATE: LOAD SELECTION REQUESTS
 ******************************************************/
function PO_loadSelectionRequests_(){

  const sheet =
    PO_getSelectionRequestsSheet_();


  if(sheet.getLastRow() <= 1){

    return [];

  }


  const values =
    sheet
      .getDataRange()
      .getValues();


  const headers =
    PO_headerMap_(
      values[0]
    );


  const output = [];


  for(
    let i = 1;
    i < values.length;
    i++
  ){

    const row =
      values[i];


    const requestId =
      PO_text_(
        row,
        headers,
        "Request ID"
      );


    if(!requestId)
      continue;


    const requestedAt =
      PO_parseDate_(
        PO_value_(
          row,
          headers,
          "Requested At"
        )
      );


    const interviewDate =
      PO_parseDate_(
        PO_value_(
          row,
          headers,
          "Interview Date"
        )
      );


    const reviewedAt =
      PO_parseDate_(
        PO_value_(
          row,
          headers,
          "Reviewed At"
        )
      );


    output.push({

      requestId:
        requestId,

      requestedAt:
        requestedAt,

      requestedAtLabel:
        requestedAt
          ? PO_dateTimeLabel_(
              requestedAt
            )
          : "",

      requestedByEmail:
        PO_text_(
          row,
          headers,
          "Requested By Email"
        ),

      handler:
        PO_text_(
          row,
          headers,
          "Handler"
        ),

      teamRow:
        Number(
          PO_value_(
            row,
            headers,
            "Team Row"
          )
        ) || 0,

      interviewDate:
        interviewDate,

      interviewDateLabel:
        interviewDate
          ? PO_dateLabel_(
              interviewDate
            )
          : "",

      monthKey:
        interviewDate
          ? PO_monthKey_(
              interviewDate
            )
          : "",

      candidate:
        PO_text_(
          row,
          headers,
          "Candidate"
        ),

      client:
        PO_text_(
          row,
          headers,
          "Client"
        ),

      round:
        PO_text_(
          row,
          headers,
          "Round"
        ),

      currentStatus:
        PO_text_(
          row,
          headers,
          "Current Status"
        ),

      requestedStatus:
        PO_text_(
          row,
          headers,
          "Requested Status"
        ),

      status:
        PO_text_(
          row,
          headers,
          "Request Status"
        ),

      reviewedAt:
        reviewedAt,

      reviewedAtLabel:
        reviewedAt
          ? PO_dateTimeLabel_(
              reviewedAt
            )
          : ""

    });

  }


  return output;

}


/******************************************************
 * PRIVATE: FIND PENDING REQUEST BY TEAM ROW
 ******************************************************/
function PO_findPendingSelectionRequestByTeamRow_(
  sheet,
  teamRow
){

  if(sheet.getLastRow() <= 1)
    return null;


  const values =
    sheet
      .getDataRange()
      .getValues();


  const headers =
    PO_headerMap_(
      values[0]
    );


  const rowCol =
    PO_requireColumn_(
      headers,
      "Team Row",
      "Selection Requests"
    );


  const statusCol =
    PO_requireColumn_(
      headers,
      "Request Status",
      "Selection Requests"
    );


  const idCol =
    PO_requireColumn_(
      headers,
      "Request ID",
      "Selection Requests"
    );


  for(
    let i = 1;
    i < values.length;
    i++
  ){

    if(
      Number(
        values[i][rowCol]
      ) ===
      Number(
        teamRow
      ) &&
      String(
        values[i][statusCol] || ""
      )
      .trim()
      .toLowerCase() ===
      "pending"
    ){

      return {

        requestId:
          String(
            values[i][idCol] || ""
          ).trim()

      };

    }

  }


  return null;

}


/******************************************************
 * PRIVATE: PORTAL AUDIT LOG
 *
 * Stored in PRIVATE BACKEND.
 ******************************************************/
function PO_auditBackend_(){

  //--------------------------------------------------
  // Operational audit history belongs to the current
  // team's PRIVATE backend.  Global access/master
  // administration uses PO_appendCentralAudit_ below.
  //--------------------------------------------------

  return portalTeamBackend_();
}


function PO_auditSheetName_(){

  return PTR_controlSheetName_(
    PORTAL_CONFIG.PORTAL_AUDIT_SHEET
  );
}


function PO_getAuditSheet_(){

  const ss =
    PO_auditBackend_();

  const sheetName =
    PO_auditSheetName_();

  let sheet =
    ss.getSheetByName(
      sheetName
    );

  if(!sheet){
    sheet =
      ss.insertSheet(
        sheetName
      );
  }

  if(sheet.getLastRow() === 0){

    sheet.appendRow([
      "Timestamp",
      "Actor Email",
      "Role",
      "Action",
      "Target Type",
      "Target ID",
      "Old Value",
      "New Value",
      "Handler",
      "Details"
    ]);

    sheet.setFrozenRows(1);

    sheet
      .getRange(
        1,
        1,
        1,
        10
      )
      .setFontWeight(
        "bold"
      );
  }

  return sheet;
}


function PO_appendAudit_(
  entry
){

  PO_getAuditSheet_()
    .appendRow([
      new Date(),
      entry.actorEmail || "",
      entry.role || "",
      entry.action || "",
      entry.targetType || "",
      entry.targetId || "",
      entry.oldValue || "",
      entry.newValue || "",
      entry.handler || "",
      entry.details || ""
    ]);
}


/******************************************************
 * PRIVATE: CENTRAL ACCESS / MASTER AUDIT
 *
 * This is intentionally different from the operational
 * team audit above.  Access administration is global
 * control-plane data and remains in portalBackend_().
 ******************************************************/
function PO_getCentralAuditSheet_(){

  const ss =
    portalBackend_();

  const sheetName =
    "Portal Access Audit Log";

  let sheet =
    ss.getSheetByName(
      sheetName
    );

  if(!sheet){
    sheet =
      ss.insertSheet(
        sheetName
      );
  }

  if(sheet.getLastRow() === 0){

    sheet.appendRow([
      "Timestamp",
      "Actor Email",
      "Role",
      "Action",
      "Target Type",
      "Target ID",
      "Old Value",
      "New Value",
      "Handler",
      "Details"
    ]);

    sheet.setFrozenRows(1);

    sheet
      .getRange(
        1,
        1,
        1,
        10
      )
      .setFontWeight(
        "bold"
      );
  }

  return sheet;
}


function PO_appendCentralAudit_(
  entry
){

  PO_getCentralAuditSheet_()
    .appendRow([
      new Date(),
      entry.actorEmail || "",
      entry.role || "",
      entry.action || "",
      entry.targetType || "",
      entry.targetId || "",
      entry.oldValue || "",
      entry.newValue || "",
      entry.handler || "",
      entry.details || ""
    ]);
}


/******************************************************
 * PRIVATE: SECURITY
 ******************************************************/
function PO_requireAdmin_(
  token
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

  const user = auth.user || {};
  const access = auth.accessContext || {};
  const accessRole = String(
    user.accessRole ||
    access.currentRole ||
    ""
  ).trim().toUpperCase();

  // Super Admin Test-As is intentionally read-only.
  if(
    user.readOnlyTest === true ||
    user.testViewActive === true ||
    access.readOnlyTest === true ||
    access.testViewActive === true
  ){
    throw new Error(
      "TEST_VIEW_READ_ONLY"
    );
  }

  // V2 real Team Admin is compatibility-mapped to "TeamAdmin"
  // so old global-admin modules fail closed. Team-routed operational
  // modules are now safe to authorize by the real accessRole instead.
  if(
    accessRole !== "SUPER_ADMIN" &&
    accessRole !== "ADMIN" &&
    user.role !== "Admin"
  ){
    throw new Error(
      "ADMIN_ACCESS_REQUIRED"
    );
  }

  return user;
}


/******************************************************
 * PRIVATE: REQUEST ID
 ******************************************************/
function PO_buildRequestId_(
  teamRow,
  email
){

  const raw =
    teamRow +
    "|" +
    email +
    "|" +
    Date.now() +
    "|" +
    Utilities.getUuid();


  const digest =
    Utilities.computeDigest(
      Utilities
        .DigestAlgorithm
        .SHA_256,
      raw,
      Utilities
        .Charset
        .UTF_8
    );


  const hex =
    digest
      .map(
        function(byte){

          const n =
            byte < 0
              ? byte + 256
              : byte;


          return (
            "0" +
            n.toString(16)
          ).slice(-2);

        }
      )
      .join("");


  return (
    "SEL-" +
    hex
      .substring(
        0,
        14
      )
      .toUpperCase()
  );

}


/******************************************************
 * PRIVATE: HELPERS
 ******************************************************/
function PO_normalizeAllowed_(
  value,
  allowed
){

  const target =
    String(
      value || ""
    )
    .trim()
    .toLowerCase();


  for(
    let i = 0;
    i < allowed.length;
    i++
  ){

    if(
      String(
        allowed[i]
      )
      .toLowerCase() ===
      target
    ){

      return allowed[i];

    }

  }


  return "";

}


function PO_handlerKey_(
  value
){

  if(
    typeof PHI_handlerIdentityKey_ ===
      "function"
  ){
    return PHI_handlerIdentityKey_(
      value
    );
  }

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


function PO_number_(
  value
){

  const cleaned =
    String(
      value || ""
    )
    .replace(
      /[₹,\s]/g,
      ""
    );


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


function PO_requestPriority_(
  status
){

  const key =
    String(
      status || ""
    )
    .trim()
    .toLowerCase();


  if(key === "pending")
    return 3;


  if(key === "approved")
    return 2;


  if(key === "rejected")
    return 1;


  return 0;

}


function PO_headerMap_(
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


function PO_requireColumn_(
  headers,
  name,
  sheetName
){

  const key =
    String(
      name || ""
    )
    .trim()
    .toLowerCase();


  if(
    !Object.prototype
      .hasOwnProperty
      .call(
        headers,
        key
      )
  ){

    throw new Error(
      sheetName +
      " is missing expected column: " +
      name
    );

  }


  return headers[key];

}


function PO_value_(
  row,
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
      ? row[
          headers[key]
        ]
      : "";

}


function PO_text_(
  row,
  headers,
  name
){

  return String(
    PO_value_(
      row,
      headers,
      name
    ) || ""
  )
  .trim();

}


/******************************************************
 * PRIVATE: DATE HELPERS
 ******************************************************/
function PO_parseDate_(
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
  // Handles many sheet-style text dates.
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


function PO_dateLabel_(
  dateObj
){

  return Utilities.formatDate(
    dateObj,
    PORTAL_CONFIG.TIME_ZONE,
    "dd-MMM-yyyy"
  );

}


function PO_dateTimeLabel_(
  dateObj
){

  return Utilities.formatDate(
    dateObj,
    PORTAL_CONFIG.TIME_ZONE,
    "dd-MMM-yyyy hh:mm a"
  );

}


function PO_monthKey_(
  dateObj
){

  return Utilities.formatDate(
    dateObj,
    PORTAL_CONFIG.TIME_ZONE,
    "yyyy-MM"
  );

}


function PO_monthLabelFromKey_(
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
