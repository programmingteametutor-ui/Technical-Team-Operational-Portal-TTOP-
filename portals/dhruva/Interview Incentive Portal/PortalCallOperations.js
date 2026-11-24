/******************************************************
 * PORTALCALLOPERATIONS.GS - FAST BULK APPROVAL v2.0
 * Interview Operations Portal - Call outcome,
 * reassignment approval, Team Data sync and
 * Call Operations dashboard.
 *
 * Install in: Interview Portal Control project
 ******************************************************/

const PORTAL_CALL_OPS = {
  OUTCOME_REQUESTS_SHEET: "Call Outcome Requests",
  CORRECTION_REQUESTS_SHEET: "Call Outcome Correction Requests",
  REASSIGN_REQUESTS_SHEET: "Call Reassignment Requests",
  SYNC_MAP_SHEET: "Call Sync Map",
  TIME_ZONE: "Asia/Kolkata"
};

function PCO_userIsAdmin_(user){
  const accessRole = String(
    user && user.accessRole || ""
  ).trim().toUpperCase();
  return (
    accessRole === "SUPER_ADMIN" ||
    accessRole === "ADMIN" ||
    String(user && user.role || "") === "Admin"
  );
}

function submitPortalCallOutcome(token, callId, requestedOutcome){
  const auth = PA_validateSession_(token);
  if(!auth.ok){ throw new Error("SESSION_EXPIRED"); }
  const user = auth.user;
  const outcome = PCO_normalizeOutcome_(requestedOutcome);
  if(["Completed","Rescheduled","Cancelled"].indexOf(outcome) === -1){
    throw new Error("INVALID_CALL_OUTCOME");
  }
  const target = PCO_getCallById_(callId);
  if(!target.handler){ throw new Error("UNASSIGNED_CALL_CANNOT_BE_SUBMITTED"); }
  if(PCO_isOutcomeLabel_(target.handler)){ throw new Error("CALL_ALREADY_FINALIZED"); }
  if(!PCO_userIsAdmin_(user) && PC_handlerKey_(target.handler) !== PC_handlerKey_(user.handler)){
    throw new Error("CALL_ACCESS_DENIED");
  }

  const existingPendingBeforeGuard =
    PCO_findPendingOutcomeByCallId_(target.callId);

  // New calls must have a canonical Candidate + Client before a Handler
  // can submit an outcome. Existing pending requests remain editable even
  // if they pre-date the new master system, preventing a legacy deadlock.
  // Admins retain an emergency/legacy bypass for historical repairs.
  if(
    !PCO_userIsAdmin_(user) &&
    !existingPendingBeforeGuard &&
    typeof PIM_assertCallIdentityResolved_ === "function"
  ){
    PIM_assertCallIdentityResolved_(target);
  }

  const finalStatusEntry = PC_loadStatusMap_().byId[target.callId] || null;
  if(finalStatusEntry && ["Completed","Rescheduled","Cancelled"].indexOf(PC_normalizeStatus_(finalStatusEntry.status)) !== -1){
    throw new Error("CALL_ALREADY_FINALIZED");
  }
  const pendingTransfer = PCO_findPendingReassignmentByCallId_(target.callId);
  if(pendingTransfer){ throw new Error("CALL_HAS_PENDING_REASSIGNMENT"); }

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try{
    const sheet = PCO_getOutcomeRequestsSheet_();
    const existing = PCO_findPendingOutcomeRow_(sheet, target.callId);
    const now = new Date();
    const requestId = existing ? existing.requestId : ("OUT-" + Utilities.getUuid());
    const submittedHandler = String(target.handler || "").trim();
    const values = [[
      requestId, target.callId, target.date, target.dateKey, target.sourceRow,
      target.originalText, target.candidate, target.client, target.duration || "",
      submittedHandler, outcome, "Pending", now, user.email,
      PCO_userIsAdmin_(user) ? submittedHandler : user.handler, "", "", ""
    ]];
    if(existing){
      sheet.getRange(existing.rowNumber, 1, 1, values[0].length).setValues(values);
    }else{
      sheet.getRange(sheet.getLastRow() + 1, 1, 1, values[0].length).setValues(values);
    }
    PO_appendAudit_({
      actorEmail: user.email, role: user.role, action: "Submit Call Outcome",
      targetType: "Call Outcome", targetId: requestId, oldValue: "Scheduled",
      newValue: outcome + " - Pending Approval", handler: submittedHandler,
      details: target.date + " | " + (target.candidate || target.originalText)
    });
    return { ok:true, requestId:requestId, status:"Pending", outcome:outcome, message: outcome + " submitted for Admin approval." };
  } finally { lock.releaseLock(); }
}


/******************************************************
 * PUBLIC: HANDLER REQUESTS CORRECTION OF AN ALREADY
 * APPROVED / FINALIZED OUTCOME.
 *
 * Pending outcomes do NOT use this function; the existing
 * submitPortalCallOutcome() overwrites the same pending row.
 ******************************************************/
function submitPortalCallOutcomeCorrection(token, callId, requestedOutcome){
  const auth = PA_validateSession_(token);
  if(!auth.ok){ throw new Error("SESSION_EXPIRED"); }

  const user = auth.user;
  const outcome = PCO_normalizeOutcome_(requestedOutcome);
  if(["Completed","Rescheduled","Cancelled"].indexOf(outcome) === -1){
    throw new Error("INVALID_CALL_OUTCOME");
  }

  const id = String(callId || "").trim();
  if(!id){ throw new Error("CALL_ID_REQUIRED"); }

  const approved = PCO_findLatestApprovedOutcomeByCallId_(id);
  if(!approved){ throw new Error("APPROVED_CALL_OUTCOME_NOT_FOUND"); }

  const oldOutcome = PCO_normalizeOutcome_(approved.outcome);
  if(outcome === oldOutcome){
    throw new Error("CORRECTION_MUST_CHANGE_OUTCOME");
  }

  if(
    !PCO_userIsAdmin_(user) &&
    PC_handlerKey_(approved.handler) !== PC_handlerKey_(user.handler)
  ){
    throw new Error("CALL_ACCESS_DENIED");
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try{
    const sheet = PCO_getCorrectionRequestsSheet_();
    const existing = PCO_findPendingCorrectionRow_(sheet,id);
    const requestId = existing ? existing.requestId : ("CORR-" + Utilities.getUuid());
    const now = new Date();

    const values = [[
      requestId,
      id,
      approved.workingDate,
      approved.dateKey,
      approved.sourceRow,
      approved.interviewText,
      approved.candidate,
      approved.client,
      approved.handler,
      oldOutcome,
      outcome,
      "Pending",
      now,
      user.email,
      PCO_userIsAdmin_(user) ? approved.handler : user.handler,
      "",
      "",
      ""
    ]];

    if(existing){
      sheet.getRange(existing.rowNumber,1,1,values[0].length).setValues(values);
    }else{
      sheet.getRange(sheet.getLastRow()+1,1,1,values[0].length).setValues(values);
    }

    PO_appendAudit_({
      actorEmail:user.email,
      role:user.role,
      action:"Request Call Outcome Correction",
      targetType:"Call Outcome Correction",
      targetId:requestId,
      oldValue:oldOutcome,
      newValue:outcome + " - Pending Approval",
      handler:approved.handler,
      details:approved.workingDate + " | " + (approved.candidate || approved.interviewText)
    });

    return {
      ok:true,
      requestId:requestId,
      status:"Pending",
      oldOutcome:oldOutcome,
      requestedOutcome:outcome,
      message:"Status correction submitted for Admin approval."
    };
  } finally {
    lock.releaseLock();
  }
}

function submitPortalCallReassignmentRequest(token, callId, requestedHandler){
  const auth = PA_validateSession_(token);
  if(!auth.ok){ throw new Error("SESSION_EXPIRED"); }
  const user = auth.user;
  if(user.role !== "Handler"){ throw new Error("HANDLER_ACCESS_REQUIRED"); }
  const target = PCO_getCallById_(callId);
  if(PC_handlerKey_(target.handler) !== PC_handlerKey_(user.handler)){ throw new Error("CALL_ACCESS_DENIED"); }
  const finalStatusEntry = PC_loadStatusMap_().byId[target.callId] || null;
  if(finalStatusEntry && PC_normalizeStatus_(finalStatusEntry.status) !== "Scheduled"){
    throw new Error("FINALIZED_CALL_CANNOT_BE_REASSIGNED");
  }
  if(PC_dateKeyFromCallId_(target.callId) !== PCO_latestDateKey_()){ throw new Error("REASSIGNMENT_LATEST_DATE_ONLY"); }
  if(PCO_findPendingOutcomeByCallId_(target.callId)){ throw new Error("CALL_HAS_PENDING_OUTCOME"); }
  const requested = String(requestedHandler || "").trim();
  const allowed = PCO_getTransferHandlers_(user.handler);
  const actual = allowed.find(function(name){ return PC_handlerKey_(name) === PC_handlerKey_(requested); });
  if(!actual){ throw new Error("INVALID_REQUESTED_HANDLER"); }

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try{
    const sheet = PCO_getReassignmentRequestsSheet_();
    const existing = PCO_findPendingReassignmentRow_(sheet, target.callId);
    const now = new Date();
    const requestId = existing ? existing.requestId : ("REASSIGN-" + Utilities.getUuid());
    const values = [[
      requestId, target.callId, target.date, target.dateKey, target.sourceRow,
      target.originalText, target.candidate, target.client, target.handler, actual,
      "Pending", now, user.email, "", "", ""
    ]];
    if(existing){
      sheet.getRange(existing.rowNumber, 1, 1, values[0].length).setValues(values);
    }else{
      sheet.getRange(sheet.getLastRow() + 1, 1, 1, values[0].length).setValues(values);
    }
    PO_appendAudit_({
      actorEmail: user.email, role: user.role, action: "Request Call Reassignment",
      targetType: "Call Reassignment", targetId: requestId, oldValue: target.handler,
      newValue: actual + " - Pending Approval", handler: user.handler,
      details: target.date + " | " + (target.candidate || target.originalText)
    });
    return { ok:true, requestId:requestId, status:"Pending", fromHandler:target.handler, toHandler:actual, message:"Reassignment request sent to Admin." };
  } finally { lock.releaseLock(); }
}

function getPortalCallApprovalData(token, requestedDateKey){
  const user = PO_requireAdmin_(token);
  const dateKey = String(requestedDateKey || "").trim();
  const outcomes = PCO_loadOutcomeRequests_()
    .filter(function(item){ return item.statusKey === "pending"; })
    .filter(function(item){ return !dateKey || item.dateKey === dateKey; });
  const groups = {};
  outcomes.forEach(function(item){
    const key = item.dateKey + "|" + PC_handlerKey_(item.handler);
    if(!groups[key]){
      groups[key] = { dateKey:item.dateKey, workingDate:item.workingDate, handler:item.handler, completed:0, rescheduled:0, cancelled:0, total:0, requestIds:[] };
    }
    const group = groups[key];
    group.total++;
    group.requestIds.push(item.requestId);
    const outcome = PCO_normalizeOutcome_(item.outcome);
    if(outcome === "Completed"){ group.completed++; }
    else if(outcome === "Rescheduled"){ group.rescheduled++; }
    else if(outcome === "Cancelled"){ group.cancelled++; }
  });
  const reassignment = PCO_loadReassignmentRequests_()
    .filter(function(item){ return item.statusKey === "pending"; })
    .filter(function(item){ return !dateKey || item.dateKey === dateKey; })
    .map(function(item){
      return { requestId:item.requestId, callId:item.callId, workingDate:item.workingDate, dateKey:item.dateKey,
        candidate:item.candidate, client:item.client, fromHandler:item.fromHandler, toHandler:item.toHandler, requestedAt:item.requestedAtLabel };
    });

  const corrections = PCO_loadCorrectionRequests_()
    .filter(function(item){ return item.statusKey === "pending"; })
    .filter(function(item){ return !dateKey || item.dateKey === dateKey; })
    .map(function(item){
      return {
        requestId:item.requestId,
        callId:item.callId,
        workingDate:item.workingDate,
        dateKey:item.dateKey,
        candidate:item.candidate,
        client:item.client,
        handler:item.handler,
        oldOutcome:item.oldOutcome,
        requestedOutcome:item.requestedOutcome,
        requestedAt:item.requestedAtLabel
      };
    });

  return {
    ok:true, user:{ email:user.email, role:user.role },
    outcomeGroups: Object.keys(groups).map(function(key){ return groups[key]; })
      .sort(function(a,b){ if(a.dateKey !== b.dateKey){ return a.dateKey < b.dateKey ? 1 : -1; } return a.handler.localeCompare(b.handler); }),
    reassignments: reassignment,
    corrections: corrections
  };
}

function approvePortalCallOutcomeBatch(token, handler, dateKey){
  const user = PO_requireAdmin_(token);
  const requestedHandler = String(handler || "").trim();
  const requestedDate = PCO_normalizeDateKey_(dateKey);
  if(!requestedHandler || !/^\d{4}-\d{2}-\d{2}$/.test(requestedDate)){ throw new Error("INVALID_OUTCOME_BATCH"); }
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try{
    const requests = PCO_loadOutcomeRequests_().filter(function(item){
      return item.statusKey === "pending" && item.dateKey === requestedDate && PC_handlerKey_(item.handler) === PC_handlerKey_(requestedHandler);
    });
    if(!requests.length){
      return { ok:true, applied:0, errors:[], message:"No pending outcomes remain for this handler/date." };
    }
    let applied = 0;
    const errors = [];
    requests.forEach(function(request){
      try{ PCO_applyOutcomeRequest_(request, user); applied++; }
      catch(error){ errors.push({ requestId:request.requestId, candidate:request.candidate, error: error && error.message ? error.message : String(error) }); }
    });
    PO_appendAudit_({
      actorEmail:user.email, role:user.role, action:"Approve Handler Call Outcomes",
      targetType:"Call Outcome Batch", targetId:requestedDate + "|" + requestedHandler,
      oldValue:"Pending", newValue:"Approved " + applied + "/" + requests.length, handler:requestedHandler,
      details:"Completed/Rescheduled/Cancelled finalization and Team Data sync."
    });
    const firstError = errors.length ? (errors[0].candidate + ": " + errors[0].error) : "";
    return {
      ok: errors.length === 0, applied:applied, total:requests.length, errors:errors,
      message: errors.length
        ? (applied + " of " + requests.length + " approved for " + requestedHandler + ". " + errors.length + " failed. First error: " + firstError)
        : (applied + " of " + requests.length + " call outcome(s) approved for " + requestedHandler + ".")
    };
  } finally { lock.releaseLock(); }
}

function approvePortalAllPendingCallOutcomes(
  token,
  operationId
){

  //--------------------------------------------------
  // ISSUE 3 v10 — ONE-CLICK, RESUMABLE BULK APPROVAL
  //
  // A single browser click may require several short
  // Apps Script executions. Each execution handles a
  // bounded batch, commits it, and returns hasMore=true.
  // The portal automatically calls this function again
  // until every eligible pending request is finalized.
  //
  // This avoids the Apps Script execution-time limit
  // without requiring the admin to click Approve All
  // multiple times.
  //--------------------------------------------------

  const user =
    PO_requireAdmin_(token);

  const opId =
    String(operationId || "").trim();

  if(!opId){
    throw new Error(
      "BULK_APPROVAL_OPERATION_ID_REQUIRED"
    );
  }

  const CHUNK_SIZE = 40;
  const invocationStarted = Date.now();

  let state =
    PCO_bulkApprovalLoadState_(opId);

  if(!state){
    state = {
      version: "ISSUE3-ONE-CLICK-BULK-1.0.0",
      operationId: opId,
      startedAtMs: invocationStarted,
      updatedAtMs: invocationStarted,
      total: 0,
      applied: 0,
      errors: [],
      actorEmail: String(user.email || ""),
      actorRole: String(user.role || "Admin")
    };
  }

  POR_setProgress_(
    opId,
    Math.max(5, Number(state.percent || 5)),
    state.applied > 0
      ? "Continuing bulk approval"
      : "Starting bulk approval",
    state.applied > 0
      ? "Continuing automatically. No additional admin click is required."
      : "Preparing a bounded server batch. The portal will automatically continue until finished.",
    "Running",
    {
      total: Number(state.total || 0),
      applied: Number(state.applied || 0),
      failed: Array.isArray(state.errors) ? state.errors.length : 0,
      chunkSize: CHUNK_SIZE
    }
  );

  const lock =
    LockService.getScriptLock();

  lock.waitLock(30000);

  try{

    const requestSheet =
      PCO_getOutcomeRequestsSheet_();

    const requestContext =
      PCO_FAST_loadPendingOutcomeContext_(
        requestSheet
      );

    const failedMap = {};

    (state.errors || []).forEach(
      function(item){
        const id =
          String(item && item.requestId || "").trim();
        if(id){
          failedMap[id] = true;
        }
      }
    );

    const eligible =
      requestContext.requests.filter(
        function(item){
          return !failedMap[
            String(item.requestId || "").trim()
          ];
        }
      );

    // Expand the total only when genuinely new pending
    // requests appeared while this one-click operation was
    // already running.
    state.total = Math.max(
      Number(state.total || 0),
      Number(state.applied || 0) +
        Number((state.errors || []).length) +
        eligible.length
    );

    if(!eligible.length){
      return PCO_bulkApprovalFinalize_(
        opId,
        state,
        invocationStarted
      );
    }

    const chunk =
      eligible.slice(
        0,
        CHUNK_SIZE
      );

    POR_setProgress_(
      opId,
      Math.max(8, Number(state.percent || 8)),
      "Preparing approval batch",
      "Processing up to " +
        CHUNK_SIZE +
        " requests in this server execution. " +
        eligible.length +
        " eligible request(s) currently remain.",
      "Running",
      {
        total: state.total,
        applied: state.applied,
        failed: (state.errors || []).length,
        batchCount: chunk.length,
        remainingEligible: eligible.length
      }
    );

    //--------------------------------------------------
    // v11.4 — HISTORICAL APPROVAL ROUTING
    //
    // Current-open-day requests continue through the fast
    // in-memory batch path. Older pending requests are
    // finalized through the normal safe single-request path,
    // which can place them inside their EXISTING historical
    // Team Data date block without moving the open day.
    //--------------------------------------------------

    const liveTeamSheet =
      portalOperations_()
        .getSheetByName(
          PTR_teamDataSheetName_()
        );

    if(!liveTeamSheet){
      throw new Error("TEAM_DATA_SHEET_NOT_FOUND");
    }

    if(typeof PTD_getOpenDayLayout_ !== "function"){
      throw new Error("PORTAL_TEAM_DAY_CONTROL_NOT_INSTALLED");
    }

    const liveOpenLayout =
      PTD_getOpenDayLayout_(
        liveTeamSheet
      );

    if(!liveOpenLayout.dateKey){
      throw new Error("TEAM_DATA_OPEN_DAY_NOT_FOUND");
    }

    const historicalChunk = [];
    const currentChunk = [];

    chunk.forEach(function(request){
      const requestDateKey =
        PCO_normalizeDateKey_(
          request.dateKey
        );

      if(requestDateKey === liveOpenLayout.dateKey){
        currentChunk.push(request);
      }else{
        historicalChunk.push(request);
      }
    });

    const prepared = [];
    const auditRows = [];
    const fallbackSchedules = {};
    const chunkErrors = [];
    let historicalApplied = 0;

    //--------------------------------------------------
    // Historical requests are intentionally processed
    // first. Any Team Data row insertion can shift later
    // row numbers, so fast contexts are built only AFTER
    // these historical writes are complete.
    //--------------------------------------------------
    historicalChunk.forEach(
      function(request){

        try{

          PCO_applyOutcomeRequest_(
            request,
            user
          );

          historicalApplied++;

        }
        catch(error){

          chunkErrors.push({
            requestId:
              String(request.requestId || ""),
            handler:
              String(request.handler || ""),
            dateKey:
              String(request.dateKey || ""),
            candidate:
              String(request.candidate || ""),
            error:
              error && error.message
                ? error.message
                : String(error)
          });

        }

      }
    );

    if(historicalChunk.length){
      SpreadsheetApp.flush();
    }

    //--------------------------------------------------
    // Current open day keeps the fast snapshot/batched
    // writer used by Issue 3.
    //--------------------------------------------------
    let scheduleContext = null;
    let statusContext = null;
    let teamContext = null;

    if(currentChunk.length){

      const scheduleSheet =
        PC_scheduleSheet_();

      scheduleContext =
        PCO_FAST_scheduleContext_(
          scheduleSheet
        );

      statusContext =
        PCO_FAST_statusContext_();

      teamContext =
        PCO_FAST_teamContext_();

      currentChunk.forEach(
        function(request){

          try{

            const preparedItem =
              PCO_FAST_prepareOutcome_(
                request,
                user,
                scheduleContext,
                statusContext,
                teamContext,
                fallbackSchedules
              );

            prepared.push(
              preparedItem
            );

            PCO_FAST_markOutcomeApprovedInMemory_(
              requestContext,
              request,
              user
            );

            auditRows.push(
              PCO_FAST_auditRow_(
                user,
                "Approve Call Outcome",
                "Call Outcome",
                request.requestId,
                request.handler,
                preparedItem.finalTeamValue,
                request.handler,
                preparedItem.call.date +
                  " | Call Tracker row " +
                  preparedItem.call.sourceRow +
                  " | Team Data row " +
                  preparedItem.teamRow +
                  " | " +
                  (
                    preparedItem.call.candidate ||
                    preparedItem.call.originalText
                  )
              )
            );

          }
          catch(error){

            chunkErrors.push({
              requestId:
                String(request.requestId || ""),
              handler:
                String(request.handler || ""),
              dateKey:
                String(request.dateKey || ""),
              candidate:
                String(request.candidate || ""),
              error:
                error && error.message
                  ? error.message
                  : String(error)
            });

          }

        }
      );
    }

    //--------------------------------------------------
    // Commit ONLY this bounded batch.
    //--------------------------------------------------

    if(prepared.length){

      PCO_FAST_writeSchedule_(
        scheduleContext
      );

      PCO_FAST_writeStatus_(
        statusContext
      );

      PCO_FAST_writeTeam_(
        teamContext
      );

      PCO_FAST_writeSyncMap_(
        teamContext
      );

      // Operational state is committed first.
      SpreadsheetApp.flush();

      // Only then mark successful requests Approved.
      PCO_FAST_writeRequestUpdates_(
        requestContext
      );

      PCO_FAST_appendAuditRows_(
        auditRows
      );

      SpreadsheetApp.flush();

    }

    state.applied =
      Number(state.applied || 0) +
      historicalApplied +
      prepared.length;

    const existingErrorIds = {};

    (state.errors || []).forEach(
      function(item){
        const id =
          String(item && item.requestId || "").trim();
        if(id){
          existingErrorIds[id] = true;
        }
      }
    );

    chunkErrors.forEach(
      function(item){
        const id =
          String(item.requestId || "").trim();

        if(!id || existingErrorIds[id]){
          return;
        }

        existingErrorIds[id] = true;
        state.errors.push(item);
      }
    );

    state.updatedAtMs = Date.now();

    // Every row in this chunk is now either Approved or
    // recorded as a unique review error, so it does not need
    // to consume another chunk in the same one-click job.
    const remainingEligible =
      Math.max(
        0,
        eligible.length - chunk.length
      );

    const processedOverall =
      Number(state.applied || 0) +
      Number((state.errors || []).length);

    const progressPercent =
      state.total > 0
        ? Math.min(
            94,
            Math.max(
              10,
              10 + Math.round(
                (processedOverall / state.total) * 84
              )
            )
          )
        : 94;

    state.percent = progressPercent;

    if(remainingEligible > 0){

      PCO_bulkApprovalSaveState_(
        opId,
        state
      );

      const message =
        state.applied +
        " approved so far. " +
        (state.errors || []).length +
        " need review. " +
        remainingEligible +
        " request(s) will continue automatically.";

      POR_setProgress_(
        opId,
        progressPercent,
        "Bulk approval continuing automatically",
        message,
        "Running",
        {
          processed: processedOverall,
          total: state.total,
          applied: state.applied,
          failed: (state.errors || []).length,
          remaining: remainingEligible,
          chunkApplied: historicalApplied + prepared.length,
          chunkFailed: chunkErrors.length,
          chunkElapsedMs: Date.now() - invocationStarted
        }
      );

      return {
        ok: true,
        done: false,
        hasMore: true,
        applied: state.applied,
        total: state.total,
        failed: (state.errors || []).length,
        remaining: remainingEligible,
        percent: progressPercent,
        chunkApplied: historicalApplied + prepared.length,
        chunkFailed: chunkErrors.length,
        elapsedMs:
          Date.now() - Number(state.startedAtMs || invocationStarted),
        message: message
      };

    }

    return PCO_bulkApprovalFinalize_(
      opId,
      state,
      invocationStarted
    );

  }
  catch(error){

    // The request rows already committed by earlier chunks are
    // safely Approved and will not be repeated by a new job.
    // Clear only the continuation metadata so a manual retry can
    // start from the true remaining Pending rows.
    PCO_bulkApprovalClearState_(
      opId
    );

    POR_setProgress_(
      opId,
      100,
      "Bulk approval failed",
      error && error.message
        ? error.message
        : String(error),
      "Failed"
    );

    throw error;

  }
  finally{
    lock.releaseLock();
  }

}


function PCO_bulkApprovalFinalize_(
  operationId,
  state,
  invocationStarted
){

  const errors =
    Array.isArray(state && state.errors)
      ? state.errors
      : [];

  const applied =
    Number(state && state.applied || 0);

  const total =
    Math.max(
      Number(state && state.total || 0),
      applied + errors.length
    );

  const startedAt =
    Number(state && state.startedAtMs || invocationStarted || Date.now());

  const elapsedMs =
    Date.now() - startedAt;

  const user = {
    email: String(state && state.actorEmail || ""),
    role: String(state && state.actorRole || "Admin")
  };

  // One summary audit row for the entire one-click operation.
  // Per-request audit rows were already written by each chunk.
  try{
    PCO_FAST_appendAuditRows_([
      PCO_FAST_auditRow_(
        user,
        "Approve All Handler Call Outcomes",
        "Call Outcome Bulk",
        String(operationId || ""),
        "Pending",
        "Approved " +
          applied +
          "/" +
          total,
        "",
        "One-click resumable bulk processing. Failed=" +
          errors.length +
          " | ElapsedMs=" +
          elapsedMs
      )
    ]);
    SpreadsheetApp.flush();
  }catch(auditError){
    // Final summary audit failure must not undo already-approved
    // operational records. Preserve it as a review error instead.
    errors.push({
      requestId: "BULK-AUDIT",
      handler: "",
      dateKey: "",
      candidate: "",
      error:
        auditError && auditError.message
          ? auditError.message
          : String(auditError)
    });
  }

  const ok =
    errors.length === 0;

  const message =
    ok
      ? (
          applied +
          " handler outcome request(s) approved successfully in one click."
        )
      : (
          applied +
          " of " +
          total +
          " handler outcome request(s) approved. " +
          errors.length +
          " need review."
        );

  POR_setProgress_(
    operationId,
    100,
    ok
      ? "Bulk approval complete"
      : "Bulk approval completed with issues",
    message +
      " Elapsed: " +
      Math.round(elapsedMs / 1000) +
      " sec.",
    ok
      ? "Completed"
      : "Partial",
    {
      processed: applied + errors.length,
      total: total,
      applied: applied,
      failed: errors.length,
      remaining: 0,
      elapsedMs: elapsedMs
    }
  );

  PCO_bulkApprovalClearState_(
    operationId
  );

  return {
    ok: ok,
    done: true,
    hasMore: false,
    applied: applied,
    total: total,
    failed: errors.length,
    remaining: 0,
    errors: errors,
    elapsedMs: elapsedMs,
    message: message
  };

}


function PCO_bulkApprovalStateKey_(
  operationId
){
  return (
    "PCO_BULK_APPROVAL_STATE_" +
    String(operationId || "")
  );
}


function PCO_bulkApprovalLoadState_(
  operationId
){

  const raw =
    PropertiesService
      .getScriptProperties()
      .getProperty(
        PCO_bulkApprovalStateKey_(
          operationId
        )
      );

  if(!raw){
    return null;
  }

  try{
    const parsed = JSON.parse(raw);
    if(!parsed || typeof parsed !== "object"){
      return null;
    }
    if(!Array.isArray(parsed.errors)){
      parsed.errors = [];
    }
    return parsed;
  }catch(error){
    return null;
  }

}


function PCO_bulkApprovalSaveState_(
  operationId,
  state
){

  const safeState = {
    version:
      String(state.version || "ISSUE3-ONE-CLICK-BULK-1.0.0"),
    operationId:
      String(operationId || ""),
    startedAtMs:
      Number(state.startedAtMs || Date.now()),
    updatedAtMs:
      Date.now(),
    total:
      Number(state.total || 0),
    applied:
      Number(state.applied || 0),
    percent:
      Number(state.percent || 0),
    actorEmail:
      String(state.actorEmail || ""),
    actorRole:
      String(state.actorRole || "Admin"),
    errors:
      (state.errors || [])
        .slice(0, 75)
        .map(function(item){
          return {
            requestId: String(item.requestId || ""),
            handler: String(item.handler || ""),
            dateKey: String(item.dateKey || ""),
            candidate: String(item.candidate || "").substring(0,120),
            error: String(item.error || "").substring(0,220)
          };
        })
  };

  PropertiesService
    .getScriptProperties()
    .setProperty(
      PCO_bulkApprovalStateKey_(
        operationId
      ),
      JSON.stringify(safeState)
    );

}


function PCO_bulkApprovalClearState_(
  operationId
){

  PropertiesService
    .getScriptProperties()
    .deleteProperty(
      PCO_bulkApprovalStateKey_(
        operationId
      )
    );

}





function testPendingCallOutcomeMapping(){
  const requests = PCO_loadOutcomeRequests_().filter(function(item){ return item.statusKey === "pending"; });
  Logger.log("========== PENDING CALL OUTCOME MAPPING ==========");
  Logger.log("Pending Requests: " + requests.length);
  const scheduleSheet = PC_scheduleSheet_();
  requests.slice(0,25).forEach(function(request, index){
    let sourceRow = Number(request.sourceRow || 0);
    let rowE = "", rowF = "", rowValid = false;
    if(sourceRow >= 1 && sourceRow <= scheduleSheet.getLastRow()){
      const values = scheduleSheet.getRange(sourceRow, 5, 1, 2).getDisplayValues()[0];
      rowE = String(values[0] || "").trim();
      rowF = String(values[1] || "").trim();
      rowValid = PCO_normalize_(rowE) === PCO_normalize_(request.interviewText);
    }
    Logger.log(JSON.stringify({ number:index+1, requestId:request.requestId, dateKey:request.dateKey, sourceRow:sourceRow,
      candidate:request.candidate, requestedOutcome:request.outcome, originalHandler:request.handler, currentColumnF:rowF, sourceRowInterviewMatches:rowValid }, null, 2));
  });
  Logger.log("==================================================");
}

function repairApprovedPortalCallOutcomeBatch(token, handler, dateKey){
  const user = PO_requireAdmin_(token);
  const requestedHandler = String(handler || "").trim();
  const requestedDate = PCO_normalizeDateKey_(dateKey);
  if(!requestedHandler || !/^\d{4}-\d{2}-\d{2}$/.test(requestedDate)){ throw new Error("INVALID_REPAIR_BATCH"); }
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try{
    const requests = PCO_loadOutcomeRequests_().filter(function(item){
      return item.statusKey === "approved" && item.dateKey === requestedDate && PC_handlerKey_(item.handler) === PC_handlerKey_(requestedHandler);
    });
    if(!requests.length){
      return { ok:true, repaired:0, total:0, errors:[], message:"No approved outcomes were found for this handler/date." };
    }
    let repaired = 0;
    const errors = [];
    requests.forEach(function(request){
      try{ PCO_applyOutcomeRequest_(request, user); repaired++; }
      catch(error){ errors.push({ requestId:request.requestId, candidate:request.candidate, error: error && error.message ? error.message : String(error) }); }
    });
    PO_appendAudit_({
      actorEmail:user.email, role:user.role, action:"Repair Approved Call Outcomes",
      targetType:"Call Outcome Batch", targetId:requestedDate + "|" + requestedHandler,
      oldValue:"Approved", newValue:"Sheets Re-applied " + repaired + "/" + requests.length, handler:requestedHandler,
      details:"Re-applied approved outcomes to Call Tracker and Team Data."
    });
    return {
      ok: errors.length === 0, repaired:repaired, total:requests.length, errors:errors,
      message: errors.length
        ? (repaired + " of " + requests.length + " approved outcome(s) repaired. " + errors.length + " failed. First error: " + errors[0].candidate + ": " + errors[0].error)
        : (repaired + " approved outcome(s) re-applied to Call Tracker and Team Data for " + requestedHandler + ".")
    };
  } finally { lock.releaseLock(); }
}

function rejectPortalCallOutcomeBatch(token, handler, dateKey){
  const user = PO_requireAdmin_(token);
  const requestedHandler = String(handler || "").trim();
  const requestedDate = PCO_normalizeDateKey_(dateKey);
  const sheet = PCO_getOutcomeRequestsSheet_();
  const values = sheet.getDataRange().getValues();
  if(values.length <= 1){ return { ok:true, changed:0 }; }
  const cols = PCO_headerMap_(values[0]);
  const now = new Date();
  let changed = 0;
  for(let i = 1; i < values.length; i++){
    const row = values[i];
    if(String(row[cols["Request Status"]] || "").trim().toLowerCase() !== "pending"){ continue; }
    if(PCO_normalizeDateKey_(row[cols["Date Key"]]) !== requestedDate){ continue; }
    if(PC_handlerKey_(row[cols["Original Handler"]]) !== PC_handlerKey_(requestedHandler)){ continue; }
    sheet.getRange(i + 1, cols["Request Status"] + 1).setValue("Rejected");
    sheet.getRange(i + 1, cols["Reviewed At"] + 1, 1, 3).setValues([[now, user.email, "Rejected as handler/date batch"]]);
    changed++;
  }
  PO_appendAudit_({
    actorEmail:user.email, role:user.role, action:"Reject Handler Call Outcomes",
    targetType:"Call Outcome Batch", targetId:requestedDate + "|" + requestedHandler,
    oldValue:"Pending", newValue:"Rejected", handler:requestedHandler, details: changed + " pending outcome(s) rejected."
  });
  return { ok:true, changed:changed, message: changed + " outcome request(s) rejected." };
}

function reversePortalApprovedCallOutcome(token, callId){
  const user = PO_requireAdmin_(token);
  const id = String(callId || "").trim();
  if(!id){ throw new Error("CALL_ID_REQUIRED"); }
  const request = PCO_findLatestApprovedOutcomeByCallId_(id);
  if(!request){ throw new Error("APPROVED_CALL_OUTCOME_NOT_FOUND"); }
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try{
    const scheduleSheet = PC_scheduleSheet_();
    let sourceRow = Number(request.sourceRow || 0);
    if(sourceRow < 1 || sourceRow > scheduleSheet.getLastRow()){ throw new Error("CALL_SOURCE_ROW_INVALID"); }
    let values = scheduleSheet.getRange(sourceRow, 5, 1, 2).getDisplayValues()[0];
    let interviewText = String(values[0] || "").trim();
    let currentF = String(values[1] || "").replace(/\s+/g," ").trim();
    if(PCO_normalize_(interviewText) !== PCO_normalize_(request.interviewText)){
      const schedule = PC_loadScheduleByDateKey_(request.dateKey);
      const matches = schedule.calls.filter(function(call){ return PCO_normalize_(call.originalText) === PCO_normalize_(request.interviewText); });
      if(matches.length !== 1){ throw new Error(matches.length > 1 ? "CALL_ROW_AMBIGUOUS_AFTER_MOVE" : "CALL_INTERVIEW_TEXT_CHANGED"); }
      sourceRow = matches[0].sourceRow;
      values = scheduleSheet.getRange(sourceRow, 5, 1, 2).getDisplayValues()[0];
      interviewText = String(values[0] || "").trim();
      currentF = String(values[1] || "").replace(/\s+/g," ").trim();
    }
    const originalHandler = String(request.handler || "").trim();
    const outcome = PCO_normalizeOutcome_(request.outcome);
    const expectedFinal = outcome === "Completed" ? originalHandler : outcome;
    const currentKey = PC_handlerKey_(currentF);
    if(currentKey !== PC_handlerKey_(expectedFinal) && currentKey !== PC_handlerKey_(originalHandler)){
      throw new Error("CALL_CHANGED_AFTER_APPROVAL_CURRENT_" + currentF);
    }
    scheduleSheet.getRange(sourceRow, 6).setValue(originalHandler);
    SpreadsheetApp.flush();
    const parsed = PC_parseInterviewText_(interviewText);
    const call = {
      callId:request.callId, sourceRow:sourceRow, date:request.workingDate, dateKey:request.dateKey,
      candidate:parsed.candidate || request.candidate, client:parsed.client || request.client,
      duration:parsed.duration || request.duration || "", round:parsed.round || "", time:parsed.time || "",
      nightCall:PC_isNightTime_(parsed.time || ""), handler:originalHandler, originalText:interviewText
    };
    PCO_writeFinalCallStatus_(call, originalHandler, "Scheduled", user);
    const teamResult = PCO_reverseTeamDataForCall_(call, originalHandler, user);
    const outcomeSheet = PCO_getOutcomeRequestsSheet_();
    const rowInfo = PCO_findOutcomeById_(outcomeSheet, request.requestId);
    if(rowInfo){
      outcomeSheet.getRange(rowInfo.rowNumber, rowInfo.statusCol + 1).setValue("Reversed");
      outcomeSheet.getRange(rowInfo.rowNumber, rowInfo.reviewedAtCol + 1, 1, 3).setValues([[new Date(), user.email, "Reopened by Admin; Handler can submit corrected outcome"]]);
    }
    PO_appendAudit_({
      actorEmail:user.email, role:user.role, action:"Reverse Approved Call Outcome", targetType:"Call Outcome", targetId:request.requestId,
      oldValue:outcome, newValue:"Scheduled / Reopened", handler:originalHandler,
      details: call.date + " | Call Tracker row " + sourceRow + (teamResult.teamRow ? " | Team Data row " + teamResult.teamRow : "") + " | " + (call.candidate || call.originalText)
    });
    return {
      ok:true, callId:id, handler:originalHandler, callTrackerRow:sourceRow, teamDataRow:teamResult.teamRow || 0,
      message:"Outcome reversed. The call is Scheduled again for " + originalHandler + " and can be submitted with a corrected outcome."
    };
  } finally { lock.releaseLock(); }
}


/******************************************************
 * PUBLIC: ADMIN REVIEWS A HANDLER STATUS CORRECTION.
 *
 * APPROVE is intentionally a controlled three-step repair:
 *  1) reverse the previously approved outcome,
 *  2) submit the corrected outcome against the reopened call,
 *  3) apply only that corrected pending request immediately.
 *
 * This reuses the existing audited production paths instead of
 * independently rewriting Call Tracker / Team Data / status sheets.
 ******************************************************/
function reviewPortalCallOutcomeCorrection(token, requestId, decision){
  const user = PO_requireAdmin_(token);
  const id = String(requestId || "").trim();
  const requestedDecision = String(decision || "").trim().toLowerCase();

  if(!id || ["approved","rejected"].indexOf(requestedDecision) === -1){
    throw new Error("INVALID_OUTCOME_CORRECTION_REVIEW");
  }

  const sheet = PCO_getCorrectionRequestsSheet_();
  let correction = PCO_findCorrectionById_(sheet,id);
  if(!correction){ throw new Error("OUTCOME_CORRECTION_REQUEST_NOT_FOUND"); }
  if(String(correction.status || "").trim().toLowerCase() !== "pending"){
    throw new Error("OUTCOME_CORRECTION_ALREADY_REVIEWED");
  }

  if(requestedDecision === "rejected"){
    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try{
      correction = PCO_findCorrectionById_(sheet,id);
      if(!correction || String(correction.status || "").trim().toLowerCase() !== "pending"){
        throw new Error("OUTCOME_CORRECTION_ALREADY_REVIEWED");
      }
      sheet.getRange(correction.rowNumber, correction.statusCol + 1).setValue("Rejected");
      sheet.getRange(correction.rowNumber, correction.reviewedAtCol + 1, 1, 3)
        .setValues([[new Date(), user.email, "Rejected from portal"]]);
    } finally {
      lock.releaseLock();
    }

    PO_appendAudit_({
      actorEmail:user.email,
      role:user.role,
      action:"Reject Call Outcome Correction",
      targetType:"Call Outcome Correction",
      targetId:id,
      oldValue:correction.oldOutcome,
      newValue:"Rejected: " + correction.requestedOutcome,
      handler:correction.handler,
      details:correction.workingDate + " | " + (correction.candidate || correction.interviewText)
    });

    return {
      ok:true,
      status:"Rejected",
      message:"Status correction request rejected."
    };
  }

  const requestedOutcome = PCO_normalizeOutcome_(correction.requestedOutcome);
  if(!requestedOutcome){ throw new Error("INVALID_CALL_OUTCOME"); }

  // Retry-safe repair state machine. A previous attempt may have already
  // reversed the old approval or created/applied the corrected pending row.
  let approvedNow = PCO_findLatestApprovedOutcomeByCallId_(correction.callId);

  if(
    approvedNow &&
    PCO_normalizeOutcome_(approvedNow.outcome) === requestedOutcome
  ){
    PCO_markCorrectionReviewed_(
      sheet,
      id,
      "Approved",
      user,
      "Corrected outcome was already applied; correction review finalized on retry."
    );

    return {
      ok:true,
      status:"Approved",
      oldOutcome:correction.oldOutcome,
      newOutcome:requestedOutcome,
      alreadyApplied:true,
      message:"Status correction was already applied and is now finalized."
    };
  }

  if(approvedNow){
    const approvedOutcome = PCO_normalizeOutcome_(approvedNow.outcome);
    if(
      approvedOutcome !== PCO_normalizeOutcome_(correction.oldOutcome)
    ){
      throw new Error(
        "OUTCOME_CORRECTION_CONFLICT_CURRENT_" +
        String(approvedNow.outcome || "UNKNOWN")
      );
    }

    reversePortalApprovedCallOutcome(token, correction.callId);
  }

  let pending = PCO_findPendingOutcomeByCallId_(correction.callId);
  let submitted = null;

  if(pending){
    if(PCO_normalizeOutcome_(pending.outcome) !== requestedOutcome){
      throw new Error(
        "OUTCOME_CORRECTION_CONFLICT_PENDING_" +
        String(pending.outcome || "UNKNOWN")
      );
    }
  }else{
    submitted = submitPortalCallOutcome(
      token,
      correction.callId,
      requestedOutcome
    );

    pending = PCO_findPendingOutcomeByCallId_(correction.callId);
    if(!pending || (submitted && pending.requestId !== submitted.requestId)){
      throw new Error("CORRECTED_OUTCOME_REQUEST_NOT_FOUND");
    }
  }

  let applied;
  const applyLock = LockService.getScriptLock();
  applyLock.waitLock(30000);
  try{
    const latestCorrection = PCO_findCorrectionById_(sheet,id);
    if(!latestCorrection || String(latestCorrection.status || "").trim().toLowerCase() !== "pending"){
      throw new Error("OUTCOME_CORRECTION_ALREADY_REVIEWED");
    }

    const latestPending = PCO_findPendingOutcomeByCallId_(correction.callId);
    if(!latestPending){
      const nowApproved = PCO_findLatestApprovedOutcomeByCallId_(correction.callId);
      if(
        nowApproved &&
        PCO_normalizeOutcome_(nowApproved.outcome) === requestedOutcome
      ){
        PCO_markCorrectionReviewed_(
          sheet,id,"Approved",user,
          "Corrected outcome was applied before correction review finalization."
        );
        applied = null;
      }else{
        throw new Error("CORRECTED_OUTCOME_REQUEST_NOT_FOUND");
      }
    }else{
      if(PCO_normalizeOutcome_(latestPending.outcome) !== requestedOutcome){
        throw new Error("CORRECTED_OUTCOME_CHANGED_DURING_REVIEW");
      }

      applied = PCO_applyOutcomeRequest_(latestPending,user);

      PCO_markCorrectionReviewed_(
        sheet,
        id,
        "Approved",
        user,
        "Approved and corrected from " + latestCorrection.oldOutcome +
          " to " + latestCorrection.requestedOutcome
      );
    }
  } finally {
    applyLock.releaseLock();
  }

  PO_appendAudit_({
    actorEmail:user.email,
    role:user.role,
    action:"Approve Call Outcome Correction",
    targetType:"Call Outcome Correction",
    targetId:id,
    oldValue:correction.oldOutcome,
    newValue:requestedOutcome,
    handler:correction.handler,
    details:correction.workingDate + " | " +
      (correction.candidate || correction.interviewText) +
      " | Corrected outcome request " +
      String((pending && pending.requestId) || (submitted && submitted.requestId) || "")
  });

  return {
    ok:true,
    status:"Approved",
    oldOutcome:correction.oldOutcome,
    newOutcome:requestedOutcome,
    applied:applied || null,
    message:"Status corrected from " + correction.oldOutcome +
      " to " + requestedOutcome + "."
  };
}


function PCO_markCorrectionReviewed_(sheet,requestId,status,user,note){
  const rowInfo = PCO_findCorrectionById_(sheet,requestId);
  if(!rowInfo){ throw new Error("OUTCOME_CORRECTION_REQUEST_NOT_FOUND"); }
  sheet.getRange(rowInfo.rowNumber,rowInfo.statusCol + 1).setValue(status);
  sheet.getRange(rowInfo.rowNumber,rowInfo.reviewedAtCol + 1,1,3)
    .setValues([[new Date(),user.email,note || ""]]);
}


function reviewPortalCallReassignmentRequest(token, requestId, decision){
  const user = PO_requireAdmin_(token);
  const id = String(requestId || "").trim();
  const requestedDecision = String(decision || "").trim().toLowerCase();
  if(!id || ["approved","rejected"].indexOf(requestedDecision) === -1){ throw new Error("INVALID_REASSIGNMENT_REVIEW"); }
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try{
    const sheet = PCO_getReassignmentRequestsSheet_();
    const rowInfo = PCO_findReassignmentById_(sheet, id);
    if(!rowInfo){ throw new Error("REASSIGNMENT_REQUEST_NOT_FOUND"); }
    if(String(rowInfo.status || "").trim().toLowerCase() !== "pending"){ throw new Error("REASSIGNMENT_ALREADY_REVIEWED"); }
    let result = null;
    if(requestedDecision === "approved"){
      result = PSA_callBridge_("reassign", { sourceRow:rowInfo.sourceRow, handler:rowInfo.toHandler });
    }
    const now = new Date();
    sheet.getRange(rowInfo.rowNumber, rowInfo.statusCol + 1).setValue(requestedDecision === "approved" ? "Approved" : "Rejected");
    sheet.getRange(rowInfo.rowNumber, rowInfo.reviewedAtCol + 1, 1, 3).setValues([[now, user.email, requestedDecision === "approved" ? "Approved from portal" : "Rejected from portal"]]);
    PO_appendAudit_({
      actorEmail:user.email, role:user.role, action: requestedDecision === "approved" ? "Approve Call Reassignment" : "Reject Call Reassignment",
      targetType:"Call Reassignment", targetId:id, oldValue:rowInfo.fromHandler, newValue: requestedDecision === "approved" ? rowInfo.toHandler : "Rejected",
      handler:rowInfo.fromHandler, details: rowInfo.workingDate + " | " + rowInfo.candidate
    });
    return {
      ok:true, status: requestedDecision === "approved" ? "Approved" : "Rejected", result:result,
      message: requestedDecision === "approved" ? ("Call reassigned from " + rowInfo.fromHandler + " to " + rowInfo.toHandler + ".") : "Reassignment request rejected."
    };
  } finally { lock.releaseLock(); }
}

function getPortalCallDashboardData(token, requestedMonth){
  const auth = PA_validateSession_(token);
  if(!auth.ok){ throw new Error("SESSION_EXPIRED"); }
  const user = auth.user;
  const monthKey = String(requestedMonth || "").trim();
  const teamContext = auth.teamContext || {};
  const aggregateView = PCO_userIsAdmin_(user) && teamContext.aggregate === true;
  const loaded = aggregateView ? PCO_loadAggregateCallDashboardFacts_(monthKey) : PCO_loadCallDashboardFacts_(monthKey);
  const selected = loaded.facts;
  const latestDate = loaded.latestDateKey;
  let visible = selected;
  if(!PCO_userIsAdmin_(user)){
    const handlerKey = PC_handlerKey_(user.handler);
    visible = selected.filter(function(item){
      return PC_handlerKey_(item.initialHandler) === handlerKey || PC_handlerKey_(item.finalHandler) === handlerKey;
    });
  }
  const monthSummary = PCO_callSummary_(visible);
  const todayVisible = visible.filter(function(item){ return item.dateKey === latestDate; });
  const todaySummary = PCO_callSummary_(todayVisible);
  const dailyMap = {};
  visible.forEach(function(item){
    if(!dailyMap[item.dateKey]){
      dailyMap[item.dateKey] = { dateKey:item.dateKey, date:item.dateLabel, assigned:0, completed:0, pending:0, rescheduled:0, cancelled:0, support:0, nightCalls:0 };
    }
    PCO_addFactToSummary_(dailyMap[item.dateKey], item);
  });
  const daily = Object.keys(dailyMap).sort().reverse().map(function(key){ return dailyMap[key]; });
  const handlerRows = PCO_userIsAdmin_(user) ? (aggregateView ? PCO_handlerDashboardAggregate_(selected) : PCO_handlerDashboard_(selected)) : [];
  return {
    ok:true, user:{ email:user.email, handler:user.handler, role:user.role }, selectedMonth:monthKey, aggregate:aggregateView,
    teamContext:teamContext, todayDateKey:latestDate, today:todaySummary, month:monthSummary, handlerPerformance:handlerRows, daily:daily
  };
}

function PCO_applyOutcomeRequest_(request, adminUser){
  const scheduleSheet = PC_scheduleSheet_();
  let sourceRow = Number(request.sourceRow || 0);
  if(sourceRow < 1 || sourceRow > scheduleSheet.getLastRow()){ throw new Error("CALL_SOURCE_ROW_INVALID"); }
  let rowValues = scheduleSheet.getRange(sourceRow, 5, 1, 2).getDisplayValues()[0];
  let currentInterview = String(rowValues[0] || "").trim();
  let currentHandler = String(rowValues[1] || "").replace(/\s+/g," ").trim();
  if(PCO_normalize_(currentInterview) !== PCO_normalize_(request.interviewText)){
    const schedule = PC_loadScheduleByDateKey_(request.dateKey);
    const matches = schedule.calls.filter(function(call){ return PCO_normalize_(call.originalText) === PCO_normalize_(request.interviewText); });
    if(matches.length === 1){
      sourceRow = matches[0].sourceRow;
      rowValues = scheduleSheet.getRange(sourceRow, 5, 1, 2).getDisplayValues()[0];
      currentInterview = String(rowValues[0] || "").trim();
      currentHandler = String(rowValues[1] || "").replace(/\s+/g," ").trim();
    }else{
      throw new Error(matches.length > 1 ? "CALL_ROW_AMBIGUOUS_AFTER_MOVE" : "CALL_INTERVIEW_TEXT_CHANGED");
    }
  }
  const outcome = PCO_normalizeOutcome_(request.outcome);

  const currentKey = PC_handlerKey_(currentHandler);
  const originalKey = PC_handlerKey_(request.handler);

  // v11.3 — historical handler aliases must not look like a reassignment.
  // If the current tracker name and the pending request resolve to the same
  // canonical identity, preserve the CURRENT tracker display name (for
  // example "Vamshidhar Reddy") rather than writing an older alias back.
  const currentMatchesOriginal =
    currentKey && originalKey && currentKey === originalKey;

  const effectiveOriginalHandler =
    currentMatchesOriginal && currentHandler
      ? currentHandler
      : request.handler;

  let finalTeamValue;
  if(outcome === "Completed"){ finalTeamValue = effectiveOriginalHandler; }
  else if(outcome === "Rescheduled"){ finalTeamValue = "Rescheduled"; }
  else if(outcome === "Cancelled"){ finalTeamValue = "Cancelled"; }
  else{ throw new Error("INVALID_CALL_OUTCOME"); }

  const finalKey = PC_handlerKey_(finalTeamValue);
  if(currentKey !== originalKey && currentKey !== finalKey){ throw new Error("CALL_ASSIGNMENT_CHANGED_CURRENT_" + currentHandler); }
  const parsed = PC_parseInterviewText_(currentInterview);
  const call = {
    callId:request.callId, sourceRow:sourceRow, date:request.workingDate, dateKey:request.dateKey,
    candidate:parsed.candidate || request.candidate, client:parsed.client || request.client,
    duration:parsed.duration || request.duration || "", round:parsed.round || "", time:parsed.time || "",
    nightCall:PC_isNightTime_(parsed.time || ""), handler:effectiveOriginalHandler, originalText:currentInterview
  };
  if(currentKey !== finalKey){ scheduleSheet.getRange(sourceRow, 6).setValue(finalTeamValue); SpreadsheetApp.flush(); }
  PCO_writeFinalCallStatus_(call, effectiveOriginalHandler, outcome, adminUser);
  const teamRow = PCO_syncToTeamData_(call, effectiveOriginalHandler, finalTeamValue, outcome, adminUser);
  const sheet = PCO_getOutcomeRequestsSheet_();
  const rowInfo = PCO_findOutcomeById_(sheet, request.requestId);
  if(rowInfo){
    sheet.getRange(rowInfo.rowNumber, rowInfo.statusCol + 1).setValue("Approved");
    sheet.getRange(rowInfo.rowNumber, rowInfo.reviewedAtCol + 1, 1, 3).setValues([[new Date(), adminUser.email, "Approved in handler/date batch"]]);
  }
  PO_appendAudit_({
    actorEmail:adminUser.email, role:adminUser.role, action:"Approve Call Outcome", targetType:"Call Outcome", targetId:request.requestId,
    oldValue:request.handler, newValue:finalTeamValue, handler:effectiveOriginalHandler,
    details: call.date + " | Call Tracker row " + sourceRow + " | Team Data row " + teamRow + " | " + (call.candidate || call.originalText)
  });
  return { callTrackerRow:sourceRow, teamDataRow:teamRow, finalTeamValue:finalTeamValue };
}


/******************************************************
 * READ-ONLY — VERIFY VAMSHIDHAR PENDING APPROVALS
 * Confirms historical request names resolve to the same
 * canonical identity as the current HYD Call Tracker name.
 ******************************************************/
function PCO_testVamshidharPendingApprovalIdentityReadOnly(){
  const requests = PCO_loadOutcomeRequests_()
    .filter(function(item){
      return item.statusKey === "pending" &&
        PC_handlerKey_(item.handler) === PC_handlerKey_("Vamshidhar Reddy");
    });

  const scheduleSheet = PC_scheduleSheet_();
  const out = requests.map(function(request){
    let sourceRow = Number(request.sourceRow || 0);
    let currentHandler = "";
    let currentInterview = "";

    if(sourceRow > 0 && sourceRow <= scheduleSheet.getLastRow()){
      const row = scheduleSheet.getRange(sourceRow,5,1,2).getDisplayValues()[0];
      currentInterview = String(row[0] || "").trim();
      currentHandler = String(row[1] || "").replace(/\s+/g," ").trim();
    }

    if(PCO_normalize_(currentInterview) !== PCO_normalize_(request.interviewText)){
      const schedule = PC_loadScheduleByDateKey_(request.dateKey);
      const matches = schedule.calls.filter(function(call){
        return PCO_normalize_(call.originalText) === PCO_normalize_(request.interviewText);
      });
      if(matches.length === 1){
        sourceRow = Number(matches[0].sourceRow || 0);
        const row = scheduleSheet.getRange(sourceRow,5,1,2).getDisplayValues()[0];
        currentHandler = String(row[1] || "").replace(/\s+/g," ").trim();
      }
    }

    const requestKey = PC_handlerKey_(request.handler);
    const currentKey = PC_handlerKey_(currentHandler);
    return {
      requestId: request.requestId,
      candidate: request.candidate,
      requestHandler: request.handler,
      currentHandler: currentHandler,
      requestKey: requestKey,
      currentKey: currentKey,
      sameIdentity: !!requestKey && requestKey === currentKey,
      sourceRow: sourceRow
    };
  });

  const result = {
    ok: out.length > 0 && out.every(function(item){ return item.sameIdentity; }),
    pendingCount: out.length,
    rows: out
  };

  Logger.log(JSON.stringify(result,null,2));
  return result;
}

function PCO_reverseTeamDataForCall_(call, originalHandler, adminUser){
  const sheet = portalOperations_().getSheetByName(PTR_teamDataSheetName_());
  if(!sheet){ throw new Error("TEAM_DATA_SHEET_NOT_FOUND"); }
  const mapSheet = PCO_getSyncMapSheet_();
  const existingMap = PCO_findSyncMapByCallId_(mapSheet, call.callId);
  if(!existingMap || existingMap.teamRow < 1 || existingMap.teamRow > sheet.getLastRow()){ return { teamRow:0 }; }
  const teamRow = existingMap.teamRow;
  const values = sheet.getRange(teamRow, 1, 1, 4).getValues()[0];
  if(PCO_normalize_(values[1]) !== PCO_normalize_(call.originalText)){ throw new Error("TEAM_DATA_MAPPING_CHANGED"); }
  sheet.getRange(teamRow, 2, 1, 3).setValues([[call.originalText, originalHandler, "In Progress"]]);
  PCO_upsertSyncMap_(mapSheet, call, teamRow, originalHandler, originalHandler, "Reversed", adminUser);
  return { teamRow:teamRow };
}

function PCO_syncToTeamData_(call, originalHandler, finalTeamValue, outcome, adminUser){
  const ss = portalOperations_();
  const sheet = ss.getSheetByName(PTR_teamDataSheetName_());
  if(!sheet){ throw new Error("TEAM_DATA_SHEET_NOT_FOUND"); }

  const mapSheet = PCO_getSyncMapSheet_();
  const existingMap = PCO_findSyncMapByCallId_(mapSheet, call.callId);

  //--------------------------------------------------
  // 1) Existing mapped row remains authoritative.
  //--------------------------------------------------
  if(existingMap && existingMap.teamRow > 0 && existingMap.teamRow <= sheet.getLastRow()){
    const rowValues = sheet.getRange(existingMap.teamRow, 1, 1, 5).getValues()[0];

    if(PCO_normalize_(rowValues[1]) === PCO_normalize_(call.originalText)){
      sheet.getRange(existingMap.teamRow, 2).setValue(call.originalText);
      sheet.getRange(existingMap.teamRow, 3).setValue(finalTeamValue);

      if(!String(rowValues[3] || "").trim()){
        sheet.getRange(existingMap.teamRow, 4).setValue("In Progress");
      }

      PCO_upsertSyncMap_(
        mapSheet,
        call,
        existingMap.teamRow,
        originalHandler,
        finalTeamValue,
        outcome,
        adminUser
      );

      return existingMap.teamRow;
    }
  }

  if(typeof PTD_getOpenDayLayout_ !== "function"){
    throw new Error("PORTAL_TEAM_DAY_CONTROL_NOT_INSTALLED");
  }

  const layout = PTD_getOpenDayLayout_(sheet);
  if(!layout.dateKey){
    throw new Error("TEAM_DATA_OPEN_DAY_NOT_FOUND");
  }

  const callDateKey = PCO_normalizeDateKey_(call.dateKey);

  //--------------------------------------------------
  // 2) CURRENT OPEN DAY:
  // preserve the strict open-day writer.
  //--------------------------------------------------
  if(callDateKey === layout.dateKey){

    if(layout.needsCompaction){
      throw new Error("TEAM_DATA_NEEDS_COMPACTION");
    }

    if(layout.unexpectedRows && layout.unexpectedRows.length){
      throw new Error(
        "TEAM_DATA_UNEXPECTED_ROWS|" +
        layout.unexpectedRows.join(",")
      );
    }

    const recordRows = layout.recordRows || [];

    for(let i = 0; i < recordRows.length; i++){
      const row = recordRows[i];
      const interviewText = sheet.getRange(row, 2).getDisplayValue();

      if(PCO_normalize_(interviewText) === PCO_normalize_(call.originalText)){
        sheet.getRange(row, 3).setValue(finalTeamValue);

        const currentStatus = sheet.getRange(row, 4).getDisplayValue();
        if(!String(currentStatus || "").trim()){
          sheet.getRange(row, 4).setValue("In Progress");
        }

        PCO_upsertSyncMap_(
          mapSheet,
          call,
          row,
          originalHandler,
          finalTeamValue,
          outcome,
          adminUser
        );

        return row;
      }
    }

    const insertRow = layout.nextWriteRow;

    if(insertRow > sheet.getMaxRows()){
      sheet.insertRowsAfter(
        sheet.getMaxRows(),
        insertRow - sheet.getMaxRows()
      );
    }

    sheet.getRange(insertRow, 1, 1, 5).clearContent();
    sheet.getRange(insertRow, 1, 1, 5).setValues([[
      "",
      call.originalText,
      finalTeamValue,
      "In Progress",
      ""
    ]]);

    const statusCell = sheet.getRange(insertRow, 4);

    if(!statusCell.getDataValidation()){
      const rule = SpreadsheetApp
        .newDataValidation()
        .requireValueInList(["In Progress","Selected"], true)
        .setAllowInvalid(false)
        .build();

      statusCell.setDataValidation(rule);
    }

    PCO_upsertSyncMap_(
      mapSheet,
      call,
      insertRow,
      originalHandler,
      finalTeamValue,
      outcome,
      adminUser
    );

    return insertRow;
  }

  //--------------------------------------------------
  // 3) HISTORICAL APPROVAL:
  //
  // A pending request can legitimately belong to an older
  // day even though Team Data has already advanced.
  //
  // Safety rules:
  // - NEVER move the current open day backwards.
  // - NEVER create a missing historical date header.
  // - Reuse an exact historical interview row when present.
  // - Otherwise insert only inside the EXISTING historical
  //   date block, immediately before its next date header.
  //--------------------------------------------------
  const lastRow = Math.max(sheet.getLastRow(), 1);
  const teamValues = sheet.getRange(1, 1, lastRow, 5).getValues();
  const headers = [];

  for(let i = 0; i < teamValues.length; i++){
    const key = PCO_teamDateKey_(teamValues[i][0]);

    if(key){
      headers.push({
        row: i + 1,
        dateKey: key
      });
    }
  }

  let block = null;
  let nextHeaderRow = 0;

  for(let i = 0; i < headers.length; i++){
    if(headers[i].dateKey === callDateKey){
      block = headers[i];
      nextHeaderRow =
        i < headers.length - 1
          ? headers[i + 1].row
          : 0;
      break;
    }
  }

  if(!block){
    throw new Error(
      "TEAM_DATA_HISTORICAL_DATE_BLOCK_NOT_FOUND|call=" +
      callDateKey +
      "|open=" +
      layout.dateKey
    );
  }

  // If this is not the open day, there should be a later header.
  // Refuse to append at the bottom because that would blur day boundaries.
  if(!nextHeaderRow){
    throw new Error(
      "TEAM_DATA_HISTORICAL_BLOCK_BOUNDARY_NOT_FOUND|call=" +
      callDateKey +
      "|open=" +
      layout.dateKey
    );
  }

  const endRow = nextHeaderRow - 1;

  for(let row = block.row + 1; row <= endRow; row++){
    const interviewText = String(teamValues[row - 1][1] || "").trim();

    if(PCO_normalize_(interviewText) === PCO_normalize_(call.originalText)){
      sheet.getRange(row, 2).setValue(call.originalText);
      sheet.getRange(row, 3).setValue(finalTeamValue);

      const currentStatus = sheet.getRange(row, 4).getDisplayValue();
      if(!String(currentStatus || "").trim()){
        sheet.getRange(row, 4).setValue("In Progress");
      }

      PCO_upsertSyncMap_(
        mapSheet,
        call,
        row,
        originalHandler,
        finalTeamValue,
        outcome,
        adminUser
      );

      return row;
    }
  }

  //--------------------------------------------------
  // Exact interview was not already present.
  // Insert one row at the end of the historical block,
  // before the next date header, and shift stored row refs.
  //--------------------------------------------------
  const insertRow = nextHeaderRow;

  PCO_shiftTeamRowReferences_(insertRow);
  sheet.insertRowsBefore(insertRow, 1);

  const priorRow = insertRow - 1;

  if(priorRow > block.row){
    try{
      sheet
        .getRange(priorRow, 1, 1, 5)
        .copyTo(
          sheet.getRange(insertRow, 1, 1, 5),
          { formatOnly:true }
        );

      const validation =
        sheet.getRange(priorRow, 4).getDataValidation();

      if(validation){
        sheet
          .getRange(insertRow, 4)
          .setDataValidation(validation);
      }
    }catch(error){
      Logger.log(
        "Historical Team Data format copy skipped: " +
        (error && error.message ? error.message : String(error))
      );
    }
  }

  sheet.getRange(insertRow, 1, 1, 5).clearContent();
  sheet.getRange(insertRow, 1, 1, 5).setValues([[
    "",
    call.originalText,
    finalTeamValue,
    "In Progress",
    ""
  ]]);

  const statusCell = sheet.getRange(insertRow, 4);

  if(!statusCell.getDataValidation()){
    const rule = SpreadsheetApp
      .newDataValidation()
      .requireValueInList(["In Progress","Selected"], true)
      .setAllowInvalid(false)
      .build();

    statusCell.setDataValidation(rule);
  }

  PCO_upsertSyncMap_(
    mapSheet,
    call,
    insertRow,
    originalHandler,
    finalTeamValue,
    outcome,
    adminUser
  );

  return insertRow;
}


/******************************************************
 * READ-ONLY — HISTORICAL PENDING TEAM DATA DIAGNOSTIC
 *
 * Shows whether pending historical outcome requests have
 * an existing Team Data date block / exact interview row.
 ******************************************************/
function PCO_testHistoricalPendingTeamDataReadOnly(){
  const sheet =
    portalOperations_()
      .getSheetByName(
        PTR_teamDataSheetName_()
      );

  if(!sheet){
    throw new Error("TEAM_DATA_SHEET_NOT_FOUND");
  }

  if(typeof PTD_getOpenDayLayout_ !== "function"){
    throw new Error("PORTAL_TEAM_DAY_CONTROL_NOT_INSTALLED");
  }

  const layout = PTD_getOpenDayLayout_(sheet);
  const lastRow = Math.max(sheet.getLastRow(), 1);
  const values = sheet.getRange(1, 1, lastRow, 5).getValues();

  const headers = [];

  for(let i = 0; i < values.length; i++){
    const key = PCO_teamDateKey_(values[i][0]);
    if(key){
      headers.push({ row:i + 1, dateKey:key });
    }
  }

  const blocks = {};

  headers.forEach(function(item, index){
    blocks[item.dateKey] = {
      startRow: item.row,
      endRow:
        index < headers.length - 1
          ? headers[index + 1].row - 1
          : lastRow
    };
  });

  const pending =
    PCO_loadOutcomeRequests_()
      .filter(function(item){
        return item.statusKey === "pending";
      });

  const rows = pending.map(function(request){
    const dateKey =
      PCO_normalizeDateKey_(request.dateKey);

    const historical =
      !!layout.dateKey &&
      dateKey !== layout.dateKey;

    const block = blocks[dateKey] || null;
    let exactInterviewRow = 0;

    if(block){
      for(let row = block.startRow + 1; row <= block.endRow; row++){
        if(
          PCO_normalize_(values[row - 1][1]) ===
          PCO_normalize_(request.interviewText)
        ){
          exactInterviewRow = row;
          break;
        }
      }
    }

    return {
      requestId: request.requestId,
      candidate: request.candidate,
      handler: request.handler,
      dateKey: dateKey,
      openDateKey: layout.dateKey || "",
      historical: historical,
      dateBlockFound: !!block,
      exactInterviewRow: exactInterviewRow,
      action:
        !historical
          ? "CURRENT_OPEN_DAY"
          : (
              exactInterviewRow
                ? "REUSE_HISTORICAL_ROW"
                : (
                    block
                      ? "INSERT_IN_EXISTING_HISTORICAL_BLOCK"
                      : "BLOCK_MISSING"
                  )
            )
    };
  });

  const historicalRows =
    rows.filter(function(item){
      return item.historical;
    });

  const result = {
    ok:
      historicalRows.every(function(item){
        return item.dateBlockFound;
      }),
    openDateKey: layout.dateKey || "",
    pendingCount: rows.length,
    historicalPendingCount: historicalRows.length,
    rows: historicalRows
  };

  Logger.log(JSON.stringify(result,null,2));
  return result;
}

function PCO_shiftTeamRowReferences_(insertedRow){
  const backend = portalTeamBackend_();
  const selectionSheet = backend.getSheetByName(PTR_controlSheetName_(PORTAL_CONFIG.SELECTION_REQUESTS_SHEET));
  if(selectionSheet && selectionSheet.getLastRow() > 1){
    const values = selectionSheet.getDataRange().getValues();
    const headers = PCO_headerMap_(values[0]);
    if(headers["Team Row"] !== undefined){
      for(let i = 1; i < values.length; i++){
        const rowNo = Number(values[i][headers["Team Row"]] || 0);
        if(rowNo >= insertedRow){ selectionSheet.getRange(i + 1, headers["Team Row"] + 1).setValue(rowNo + 1); }
      }
    }
  }
  const sync = PCO_getSyncMapSheet_();
  if(sync.getLastRow() > 1){
    const values = sync.getDataRange().getValues();
    const headers = PCO_headerMap_(values[0]);
    const col = headers["Team Data Row"];
    if(col !== undefined){
      for(let i = 1; i < values.length; i++){
        const rowNo = Number(values[i][col] || 0);
        if(rowNo >= insertedRow){ sync.getRange(i + 1, col + 1).setValue(rowNo + 1); }
      }
    }
  }
}

function PCO_writeFinalCallStatus_(call, originalHandler, status, user){
  const sheet = PC_getStatusSheet_();
  const existing = PC_findStatusRow_(sheet, call);
  const rowValues = [[ call.callId, call.date, call.dateKey, call.sourceRow, call.originalText, originalHandler, status, new Date(), user.email, user.role ]];
  if(existing){ sheet.getRange(existing.rowNumber, 1, 1, rowValues[0].length).setValues(rowValues); }
  else{ sheet.getRange(sheet.getLastRow() + 1, 1, 1, rowValues[0].length).setValues(rowValues); }
}

function PCO_enrichCalls_(user, calls){
  const outcomes = PCO_loadOutcomeRequests_();
  const transfers = PCO_loadReassignmentRequests_();
  const corrections = PCO_loadCorrectionRequests_();
  const pendingOutcome = {}, pendingTransfer = {}, approvedOutcome = {}, pendingCorrection = {};
  outcomes.forEach(function(item){
    if(item.statusKey === "pending"){ pendingOutcome[item.callId] = item; }
    else if(item.statusKey === "approved"){ approvedOutcome[item.callId] = item; }
  });
  transfers.forEach(function(item){ if(item.statusKey === "pending"){ pendingTransfer[item.callId] = item; } });
  corrections.forEach(function(item){ if(item.statusKey === "pending"){ pendingCorrection[item.callId] = item; } });
  return calls.map(function(call){
    const outcome = pendingOutcome[call.callId] || null;
    const transfer = pendingTransfer[call.callId] || null;
    const approved = approvedOutcome[call.callId] || null;
    const correction = pendingCorrection[call.callId] || null;
    call.pendingOutcome = outcome ? { requestId:outcome.requestId, outcome:outcome.outcome, handler:outcome.handler, submittedAt:outcome.submittedAtLabel } : null;
    call.pendingReassignment = transfer ? { requestId:transfer.requestId, fromHandler:transfer.fromHandler, toHandler:transfer.toHandler, requestedAt:transfer.requestedAtLabel } : null;
    call.approvedOutcome = approved ? { requestId:approved.requestId, outcome:approved.outcome, handler:approved.handler } : null;
    call.pendingCorrection = correction ? {
      requestId:correction.requestId,
      oldOutcome:correction.oldOutcome,
      requestedOutcome:correction.requestedOutcome,
      requestedAt:correction.requestedAtLabel
    } : null;
    return call;
  });
}

function PCO_getTransferHandlers_(currentHandler){
  let list = [];
  try{
    const state = PSA_callBridge_("state", {});
    const onLeave = {};
    (state.onLeave || []).forEach(function(name){ onLeave[PC_handlerKey_(name)] = true; });
    list = (state.leaveEligibleHandlers || []).filter(function(name){ return !onLeave[PC_handlerKey_(name)]; });
  } catch(error){
    Logger.log("Transfer roster bridge fallback: " + error.message);
    if(typeof PTR_activeHandlerNames_ === "function"){ list = PTR_activeHandlerNames_(); }
  }
  list.push("Support");
  const seen = {};
  return list.map(function(name){ return String(name || "").trim(); }).filter(function(name){
    const key = PC_handlerKey_(name);
    if(!key || key === PC_handlerKey_(currentHandler) || seen[key]){ return false; }
    seen[key] = true;
    return true;
  });
}

// options.skipParse: callers that only need dateKey / handlers / status (month lists,
// "latest date with my calls") skip the candidate/client/time text parsing, which is
// most of the cost when every call ever recorded is loaded. Those facts then have
// empty candidate, client, duration and time, and nightCall false.
function PCO_loadCallDashboardFacts_(requestedMonth, options){
  const skipParse = !!(options && options.skipParse);
  const sheet = PC_scheduleSheet_();
  const lastRow = sheet.getLastRow();
  if(lastRow < 1){ return { facts:[], latestDateKey:"" }; }
  const rows = sheet.getRange(1, 2, lastRow, 5).getDisplayValues();
  const monthKey = String(requestedMonth || "").trim();
  const hasMonthFilter = /^\d{4}-\d{2}$/.test(monthKey);
  let latestDateKey = "";
  for(let i = 0; i < rows.length; i++){
    const colB = String(rows[i][0] || "").trim();
    if(!colB || !PC_isDateHeader_(colB)){ continue; }
    const key = PC_dateKeyFromHeader_(colB);
    if(key && (!latestDateKey || key > latestDateKey)){ latestDateKey = key; }
  }
  const statusMap = PC_loadStatusMap_();
  const approvedTransfers = PCO_loadApprovedReassignmentHistory_();
  const facts = [];
  let currentDateLabel = "", currentDateKey = "", currentMonthMatches = false, duplicateCounts = {};
  for(let i = 0; i < rows.length; i++){
    const colB = String(rows[i][0] || "").trim();
    if(PC_isDateHeader_(colB)){
      currentDateLabel = colB;
      currentDateKey = PC_dateKeyFromHeader_(colB);
      currentMonthMatches = !hasMonthFilter || (currentDateKey && currentDateKey.substring(0,7) === monthKey);
      duplicateCounts = {};
      continue;
    }
    if(!currentDateKey || !currentMonthMatches){ continue; }
    const extracted = String(rows[i][3] || "").trim();
    if(!extracted){ continue; }
    const sheetHandler = String(rows[i][4] || "").replace(/\s+/g," ").trim();
    const normalized = PC_normalizeText_(extracted);
    const hash = PC_hash_(normalized);
    duplicateCounts[hash] = (duplicateCounts[hash] || 0) + 1;
    const callId = "CALL-" + currentDateKey + "-" + hash.substring(0,12) + "-" + duplicateCounts[hash];
    const parsed = skipParse ? { candidate:"", client:"", duration:"", time:"" } : PC_parseInterviewText_(extracted);
    const statusEntry = statusMap.byId[callId] || statusMap.byFallback[currentDateKey + "|" + normalized] || null;
    const transfer = approvedTransfers[callId] || null;
    let finalStatus = statusEntry ? PC_normalizeStatus_(statusEntry.status) : "";
    if(!finalStatus){
      const handlerKey = PC_handlerKey_(sheetHandler);
      if(handlerKey === "rescheduled"){ finalStatus = "Rescheduled"; }
      else if(handlerKey === "cancelled" || handlerKey === "canceled"){ finalStatus = "Cancelled"; }
      else{ finalStatus = "Scheduled"; }
    }
    if(finalStatus === "Scheduled" && currentDateKey !== latestDateKey && sheetHandler && !PCO_isOutcomeLabel_(sheetHandler)){ finalStatus = "Completed"; }
    const finalHandler = statusEntry && statusEntry.handler ? statusEntry.handler : (PCO_isOutcomeLabel_(sheetHandler) ? "" : sheetHandler);
    const initialHandler = transfer && transfer.initialHandler ? transfer.initialHandler : finalHandler;
    facts.push({
      callId:callId, dateKey:currentDateKey, dateLabel:currentDateLabel, candidate:parsed.candidate, client:parsed.client,
      duration:parsed.duration || "", time:parsed.time, nightCall:skipParse ? false : PC_isNightTime_(parsed.time), initialHandler:initialHandler,
      finalHandler:finalHandler, sheetHandler:sheetHandler, status:finalStatus,
      support: PC_handlerKey_(sheetHandler) === "support" || PC_handlerKey_(finalHandler) === "support"
    });
  }
  return { facts:facts, latestDateKey:latestDateKey };
}

function PCO_loadAggregateCallDashboardFacts_(requestedMonth, options){
  const combined = [];
  let latestDateKey = "";
  ["PRADEEP","HYD","DEV"].forEach(function(teamCode){
    const runtime = typeof PTR_runtimeForCode_ === "function" ? PTR_runtimeForCode_(teamCode) : null;
    if(!runtime || runtime.connected !== true || !runtime.callTrackerId){ return; }
    const loaded = PTR_withExecutionTeamCode_(teamCode, function(){ return PCO_loadCallDashboardFacts_(requestedMonth, options); });
    if(!loaded){ return; }
    if(loaded.latestDateKey && (!latestDateKey || loaded.latestDateKey > latestDateKey)){ latestDateKey = loaded.latestDateKey; }
    (loaded.facts || []).forEach(function(item){
      const copy = Object.assign({}, item);
      copy.teamCode = runtime.code;
      copy.teamLabel = runtime.label;
      combined.push(copy);
    });
  });
  return { facts:combined, latestDateKey:latestDateKey };
}

function PCO_handlerDashboardAggregate_(facts){
  const map = {};
  function ensure(item, name){
    const clean = String(name || "").trim();
    if(!clean){ return null; }
    const teamCode = String(item.teamCode || "").trim();
    const teamLabel = String(item.teamLabel || teamCode || "Team").trim();
    const key = teamCode + "|" + PC_handlerKey_(clean);
    if(!map[key]){ map[key] = { teamCode:teamCode, team:teamLabel, handler:clean, assigned:0, completed:0, rescheduled:0, cancelled:0, support:0, nightCalls:0 }; }
    return map[key];
  }
  (facts || []).forEach(function(item){
    const assigned = ensure(item, item.initialHandler);
    if(assigned){
      assigned.assigned++;
      if(item.nightCall){ assigned.nightCalls++; }
      if(item.status === "Rescheduled"){ assigned.rescheduled++; }
      if(item.status === "Cancelled"){ assigned.cancelled++; }
    }
    if(item.status === "Completed"){ const completed = ensure(item, item.finalHandler); if(completed){ completed.completed++; } }
    if(item.support){ const support = ensure(item, "Support"); if(support){ support.support++; } }
  });
  return Object.keys(map).map(function(key){ return map[key]; }).sort(function(a,b){
    const teamCompare = String(a.team).localeCompare(String(b.team));
    if(teamCompare !== 0){ return teamCompare; }
    if(b.assigned !== a.assigned){ return b.assigned - a.assigned; }
    return String(a.handler).localeCompare(String(b.handler));
  });
}

function PCO_testAggregateCallDashboardReadOnly(){
  const loaded = PCO_loadAggregateCallDashboardFacts_("");
  const byTeam = {};
  (loaded.facts || []).forEach(function(item){
    const label = String(item.teamLabel || item.teamCode || "Team");
    if(!byTeam[label]){ byTeam[label] = 0; }
    byTeam[label]++;
  });
  const result = { ok:true, latestDateKey:loaded.latestDateKey || "", totalFacts:(loaded.facts || []).length, byTeam:byTeam };
  Logger.log("========== ALL TEAMS CALL DASHBOARD ==========");
  Logger.log(JSON.stringify(result, null, 2));
  Logger.log("==============================================");
  return result;
}

function PCO_loadAllCallFacts_(){ return PCO_loadCallDashboardFacts_("").facts; }

function testCallDashboardPerformance(){
  const startMs = Date.now();
  const monthKey = Utilities.formatDate(new Date(), PORTAL_CALL_OPS.TIME_ZONE, "yyyy-MM");
  const loaded = PCO_loadCallDashboardFacts_(monthKey);
  const elapsedMs = Date.now() - startMs;
  Logger.log("========== CALL DASHBOARD PERFORMANCE ==========");
  Logger.log(JSON.stringify({ monthKey:monthKey, latestDateKey:loaded.latestDateKey, factsLoaded:loaded.facts.length, elapsedMs:elapsedMs, elapsedSeconds:Math.round(elapsedMs/100)/10 }, null, 2));
  Logger.log("===============================================");
}

function PCO_callSummary_(facts){
  const summary = { assigned:0, completed:0, pending:0, rescheduled:0, cancelled:0, support:0, nightCalls:0 };
  facts.forEach(function(item){ PCO_addFactToSummary_(summary, item); });
  return summary;
}

function PCO_addFactToSummary_(summary, item){
  summary.assigned = Number(summary.assigned || 0) + 1;
  if(item.nightCall){ summary.nightCalls = Number(summary.nightCalls || 0) + 1; }
  if(item.support){ summary.support = Number(summary.support || 0) + 1; }
  const status = PC_normalizeStatus_(item.status);
  if(status === "Completed"){ summary.completed = Number(summary.completed || 0) + 1; }
  else if(status === "Rescheduled"){ summary.rescheduled = Number(summary.rescheduled || 0) + 1; }
  else if(status === "Cancelled"){ summary.cancelled = Number(summary.cancelled || 0) + 1; }
  else{ summary.pending = Number(summary.pending || 0) + 1; }
}

function PCO_handlerDashboard_(facts){
  const map = {};
  function ensure(name){
    const clean = String(name || "").trim();
    if(!clean){ return null; }
    const key = PC_handlerKey_(clean);
    if(!map[key]){ map[key] = { handler:clean, assigned:0, completed:0, rescheduled:0, cancelled:0, support:0, nightCalls:0 }; }
    return map[key];
  }
  facts.forEach(function(item){
    const assigned = ensure(item.initialHandler);
    if(assigned){
      assigned.assigned++;
      if(item.nightCall){ assigned.nightCalls++; }
      if(item.status === "Rescheduled"){ assigned.rescheduled++; }
      if(item.status === "Cancelled"){ assigned.cancelled++; }
    }
    if(item.status === "Completed"){ const completed = ensure(item.finalHandler); if(completed){ completed.completed++; } }
    if(item.support){ const support = ensure("Support"); support.support++; }
  });
  return Object.keys(map).map(function(key){ return map[key]; }).sort(function(a,b){
    if(b.assigned !== a.assigned){ return b.assigned - a.assigned; }
    return a.handler.localeCompare(b.handler);
  });
}

function PCO_getOutcomeRequestsSheet_(){
  const ss = portalTeamBackend_();
  let sheet = ss.getSheetByName(PTR_controlSheetName_(PORTAL_CALL_OPS.OUTCOME_REQUESTS_SHEET));
  const headers = [[ "Request ID","Call ID","Working Date","Date Key","Source Row","Interview Text","Candidate","Client","Duration",
    "Original Handler","Requested Outcome","Request Status","Submitted At","Submitted By Email","Submitted By Handler","Reviewed At","Reviewed By Email","Review Note" ]];
  if(!sheet){
    sheet = ss.insertSheet(PTR_controlSheetName_(PORTAL_CALL_OPS.OUTCOME_REQUESTS_SHEET));
    sheet.getRange(1, 1, 1, headers[0].length).setValues(headers).setFontWeight("bold");
    sheet.setFrozenRows(1);
    sheet.getRange("D:D").setNumberFormat("@");
  }
  sheet.getRange("D:D").setNumberFormat("@");
  return sheet;
}


function PCO_getCorrectionRequestsSheet_(){
  const ss = portalTeamBackend_();
  let sheet = ss.getSheetByName(PTR_controlSheetName_(PORTAL_CALL_OPS.CORRECTION_REQUESTS_SHEET));
  const headers = [[
    "Request ID","Call ID","Working Date","Date Key","Source Row","Interview Text",
    "Candidate","Client","Original Handler","Old Outcome","Requested Outcome",
    "Request Status","Requested At","Requested By Email","Requested By Handler",
    "Reviewed At","Reviewed By Email","Review Note"
  ]];
  if(!sheet){
    sheet = ss.insertSheet(PTR_controlSheetName_(PORTAL_CALL_OPS.CORRECTION_REQUESTS_SHEET));
    sheet.getRange(1,1,1,headers[0].length).setValues(headers).setFontWeight("bold");
    sheet.setFrozenRows(1);
    sheet.getRange("D:D").setNumberFormat("@");
  }
  sheet.getRange("D:D").setNumberFormat("@");
  return sheet;
}

function PCO_getReassignmentRequestsSheet_(){
  const ss = portalTeamBackend_();
  let sheet = ss.getSheetByName(PTR_controlSheetName_(PORTAL_CALL_OPS.REASSIGN_REQUESTS_SHEET));
  const headers = [[ "Request ID","Call ID","Working Date","Date Key","Source Row","Interview Text","Candidate","Client",
    "From Handler","To Handler","Request Status","Requested At","Requested By Email","Reviewed At","Reviewed By Email","Review Note" ]];
  if(!sheet){
    sheet = ss.insertSheet(PTR_controlSheetName_(PORTAL_CALL_OPS.REASSIGN_REQUESTS_SHEET));
    sheet.getRange(1, 1, 1, headers[0].length).setValues(headers).setFontWeight("bold");
    sheet.setFrozenRows(1);
    sheet.getRange("D:D").setNumberFormat("@");
  }
  sheet.getRange("D:D").setNumberFormat("@");
  return sheet;
}

function PCO_getSyncMapSheet_(){
  const ss = portalTeamBackend_();
  let sheet = ss.getSheetByName(PTR_controlSheetName_(PORTAL_CALL_OPS.SYNC_MAP_SHEET));
  const headers = [[ "Call ID","Date Key","Working Date","Call Tracker Row","Team Data Row","Interview Text","Original Handler","Final Team Value","Outcome","Synced At","Approved By" ]];
  if(!sheet){
    sheet = ss.insertSheet(PTR_controlSheetName_(PORTAL_CALL_OPS.SYNC_MAP_SHEET));
    sheet.getRange(1, 1, 1, headers[0].length).setValues(headers).setFontWeight("bold");
    sheet.setFrozenRows(1);
    sheet.getRange("B:B").setNumberFormat("@");
  }
  sheet.getRange("B:B").setNumberFormat("@");
  return sheet;
}

function PCO_loadOutcomeRequests_(){
  const sheet = PCO_getOutcomeRequestsSheet_();
  if(sheet.getLastRow() <= 1){ return []; }
  const values = sheet.getDataRange().getValues();
  const cols = PCO_headerMap_(values[0]);
  return values.slice(1).map(function(row){
    return {
      requestId:String(row[cols["Request ID"]] || "").trim(), callId:String(row[cols["Call ID"]] || "").trim(),
      workingDate:String(row[cols["Working Date"]] || "").trim(), dateKey:PCO_normalizeDateKey_(row[cols["Date Key"]]),
      sourceRow:Number(row[cols["Source Row"]] || 0), interviewText:String(row[cols["Interview Text"]] || "").trim(),
      candidate:String(row[cols["Candidate"]] || "").trim(), client:String(row[cols["Client"]] || "").trim(),
      duration:String(row[cols["Duration"]] || "").trim(), handler:String(row[cols["Original Handler"]] || "").trim(),
      outcome:String(row[cols["Requested Outcome"]] || "").trim(), status:String(row[cols["Request Status"]] || "").trim(),
      statusKey:String(row[cols["Request Status"]] || "").trim().toLowerCase(), submittedAtLabel:PCO_dateTimeLabel_(row[cols["Submitted At"]])
    };
  });
}


function PCO_loadCorrectionRequests_(){
  const sheet = PCO_getCorrectionRequestsSheet_();
  if(sheet.getLastRow() <= 1){ return []; }
  const values = sheet.getDataRange().getValues();
  const cols = PCO_headerMap_(values[0]);
  return values.slice(1).map(function(row){
    return {
      requestId:String(row[cols["Request ID"]] || "").trim(),
      callId:String(row[cols["Call ID"]] || "").trim(),
      workingDate:String(row[cols["Working Date"]] || "").trim(),
      dateKey:PCO_normalizeDateKey_(row[cols["Date Key"]]),
      sourceRow:Number(row[cols["Source Row"]] || 0),
      interviewText:String(row[cols["Interview Text"]] || "").trim(),
      candidate:String(row[cols["Candidate"]] || "").trim(),
      client:String(row[cols["Client"]] || "").trim(),
      handler:String(row[cols["Original Handler"]] || "").trim(),
      oldOutcome:String(row[cols["Old Outcome"]] || "").trim(),
      requestedOutcome:String(row[cols["Requested Outcome"]] || "").trim(),
      status:String(row[cols["Request Status"]] || "").trim(),
      statusKey:String(row[cols["Request Status"]] || "").trim().toLowerCase(),
      requestedAtLabel:PCO_dateTimeLabel_(row[cols["Requested At"]])
    };
  });
}

function PCO_loadReassignmentRequests_(){
  const sheet = PCO_getReassignmentRequestsSheet_();
  if(sheet.getLastRow() <= 1){ return []; }
  const values = sheet.getDataRange().getValues();
  const cols = PCO_headerMap_(values[0]);
  return values.slice(1).map(function(row){
    return {
      requestId:String(row[cols["Request ID"]] || "").trim(), callId:String(row[cols["Call ID"]] || "").trim(),
      workingDate:String(row[cols["Working Date"]] || "").trim(), dateKey:PCO_normalizeDateKey_(row[cols["Date Key"]]),
      sourceRow:Number(row[cols["Source Row"]] || 0), candidate:String(row[cols["Candidate"]] || "").trim(),
      client:String(row[cols["Client"]] || "").trim(), fromHandler:String(row[cols["From Handler"]] || "").trim(),
      toHandler:String(row[cols["To Handler"]] || "").trim(), status:String(row[cols["Request Status"]] || "").trim(),
      statusKey:String(row[cols["Request Status"]] || "").trim().toLowerCase(), requestedAtLabel:PCO_dateTimeLabel_(row[cols["Requested At"]])
    };
  });
}

function PCO_loadApprovedReassignmentHistory_(){
  const rows = PCO_loadReassignmentRequests_().filter(function(item){ return item.statusKey === "approved"; });
  const map = {};
  rows.forEach(function(item){
    if(!map[item.callId]){ map[item.callId] = { initialHandler:item.fromHandler, finalHandler:item.toHandler }; }
    else{ map[item.callId].finalHandler = item.toHandler; }
  });
  return map;
}

function PCO_findLatestApprovedOutcomeByCallId_(callId){
  const matches = PCO_loadOutcomeRequests_().filter(function(item){ return item.callId === callId && item.statusKey === "approved"; });
  return matches.length ? matches[matches.length - 1] : null;
}

function PCO_findPendingOutcomeByCallId_(callId){
  return PCO_loadOutcomeRequests_().find(function(item){ return item.callId === callId && item.statusKey === "pending"; }) || null;
}

function PCO_findPendingReassignmentByCallId_(callId){
  return PCO_loadReassignmentRequests_().find(function(item){ return item.callId === callId && item.statusKey === "pending"; }) || null;
}

function PCO_findPendingCorrectionByCallId_(callId){
  return PCO_loadCorrectionRequests_().find(function(item){ return item.callId === callId && item.statusKey === "pending"; }) || null;
}

function PCO_findPendingCorrectionRow_(sheet, callId){
  return PCO_findPendingRowByCallId_(sheet, callId, "Requested At");
}

function PCO_findPendingOutcomeRow_(sheet, callId){ return PCO_findPendingRowByCallId_(sheet, callId, "Submitted At"); }
function PCO_findPendingReassignmentRow_(sheet, callId){ return PCO_findPendingRowByCallId_(sheet, callId, "Requested At"); }

function PCO_findPendingRowByCallId_(sheet, callId, timeHeader){
  if(sheet.getLastRow() <= 1){ return null; }
  const values = sheet.getDataRange().getValues();
  const cols = PCO_headerMap_(values[0]);
  for(let i = 1; i < values.length; i++){
    if(String(values[i][cols["Call ID"]] || "").trim() !== String(callId || "").trim()){ continue; }
    if(String(values[i][cols["Request Status"]] || "").trim().toLowerCase() !== "pending"){ continue; }
    return { rowNumber:i + 1, requestId:String(values[i][cols["Request ID"]] || "").trim(), timeCol:cols[timeHeader] };
  }
  return null;
}

function PCO_findOutcomeById_(sheet, requestId){
  if(sheet.getLastRow() <= 1){ return null; }
  const values = sheet.getDataRange().getValues();
  const cols = PCO_headerMap_(values[0]);
  for(let i = 1; i < values.length; i++){
    if(String(values[i][cols["Request ID"]] || "").trim() === requestId){
      return { rowNumber:i + 1, statusCol:cols["Request Status"], reviewedAtCol:cols["Reviewed At"] };
    }
  }
  return null;
}


function PCO_findCorrectionById_(sheet, requestId){
  if(sheet.getLastRow() <= 1){ return null; }
  const values = sheet.getDataRange().getValues();
  const cols = PCO_headerMap_(values[0]);
  for(let i = 1; i < values.length; i++){
    if(String(values[i][cols["Request ID"]] || "").trim() !== requestId){ continue; }
    return {
      rowNumber:i + 1,
      statusCol:cols["Request Status"],
      reviewedAtCol:cols["Reviewed At"],
      status:String(values[i][cols["Request Status"]] || "").trim(),
      callId:String(values[i][cols["Call ID"]] || "").trim(),
      sourceRow:Number(values[i][cols["Source Row"]] || 0),
      workingDate:String(values[i][cols["Working Date"]] || "").trim(),
      dateKey:PCO_normalizeDateKey_(values[i][cols["Date Key"]]),
      interviewText:String(values[i][cols["Interview Text"]] || "").trim(),
      candidate:String(values[i][cols["Candidate"]] || "").trim(),
      client:String(values[i][cols["Client"]] || "").trim(),
      handler:String(values[i][cols["Original Handler"]] || "").trim(),
      oldOutcome:String(values[i][cols["Old Outcome"]] || "").trim(),
      requestedOutcome:String(values[i][cols["Requested Outcome"]] || "").trim()
    };
  }
  return null;
}

function PCO_findReassignmentById_(sheet, requestId){
  if(sheet.getLastRow() <= 1){ return null; }
  const values = sheet.getDataRange().getValues();
  const cols = PCO_headerMap_(values[0]);
  for(let i = 1; i < values.length; i++){
    if(String(values[i][cols["Request ID"]] || "").trim() !== requestId){ continue; }
    return {
      rowNumber:i + 1, statusCol:cols["Request Status"], reviewedAtCol:cols["Reviewed At"], status:String(values[i][cols["Request Status"]] || "").trim(),
      sourceRow:Number(values[i][cols["Source Row"]] || 0), workingDate:String(values[i][cols["Working Date"]] || "").trim(),
      candidate:String(values[i][cols["Candidate"]] || "").trim(), fromHandler:String(values[i][cols["From Handler"]] || "").trim(),
      toHandler:String(values[i][cols["To Handler"]] || "").trim()
    };
  }
  return null;
}

function PCO_getCallById_(callId){
  const id = String(callId || "").trim();
  const dateKey = PC_dateKeyFromCallId_(id);
  if(!dateKey){ throw new Error("INVALID_CALL_ID"); }
  const schedule = PC_loadScheduleByDateKey_(dateKey);
  const target = schedule.calls.find(function(call){ return call.callId === id; });
  if(!target){ throw new Error("CALL_NOT_FOUND"); }
  return target;
}

function PCO_latestDateKey_(){ return PC_loadScheduleByDateKey_("").dateKey; }

function PCO_findSyncMapByCallId_(sheet, callId){
  if(sheet.getLastRow() <= 1){ return null; }
  const values = sheet.getDataRange().getValues();
  const cols = PCO_headerMap_(values[0]);
  for(let i = 1; i < values.length; i++){
    if(String(values[i][cols["Call ID"]] || "").trim() === callId){
      return { rowNumber:i + 1, teamRow:Number(values[i][cols["Team Data Row"]] || 0) };
    }
  }
  return null;
}

function PCO_upsertSyncMap_(sheet, call, teamRow, originalHandler, finalTeamValue, outcome, adminUser){
  const existing = PCO_findSyncMapByCallId_(sheet, call.callId);
  const row = [[ call.callId, call.dateKey, call.date, call.sourceRow, teamRow, call.originalText, originalHandler, finalTeamValue, outcome, new Date(), adminUser.email ]];
  if(existing){ sheet.getRange(existing.rowNumber, 1, 1, row[0].length).setValues(row); }
  else{ sheet.getRange(sheet.getLastRow() + 1, 1, 1, row[0].length).setValues(row); }
}

function PCO_headerMap_(headers){
  const map = {};
  headers.forEach(function(value, index){ map[String(value || "").trim()] = index; });
  return map;
}

function PCO_normalizeOutcome_(value){
  const text = String(value || "").trim().toLowerCase();
  if(text === "completed"){ return "Completed"; }
  if(text === "cancelled" || text === "canceled"){ return "Cancelled"; }
  if(text === "rescheduled"){ return "Rescheduled"; }
  return "";
}

function PCO_isOutcomeLabel_(value){
  const key = PC_handlerKey_(value);
  return key === "rescheduled" || key === "cancelled" || key === "canceled";
}

function PCO_normalize_(value){
  return String(value || "").replace(/[–—]/g,"-").replace(/\s+/g," ").trim().toLowerCase();
}

function PCO_normalizeDateKey_(value){
  if(value instanceof Date && !isNaN(value.getTime())){
    return Utilities.formatDate(value, PORTAL_CALL_OPS.TIME_ZONE, "yyyy-MM-dd");
  }
  const text = String(value || "").trim();
  if(!text){ return ""; }
  let m = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if(m){ return m[1] + "-" + ("0"+m[2]).slice(-2) + "-" + ("0"+m[3]).slice(-2); }
  m = text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/);
  if(m){ return m[3] + "-" + ("0"+m[1]).slice(-2) + "-" + ("0"+m[2]).slice(-2); }
  const parsed = new Date(text);
  if(!isNaN(parsed.getTime())){ return Utilities.formatDate(parsed, PORTAL_CALL_OPS.TIME_ZONE, "yyyy-MM-dd"); }
  return "";
}

function PCO_teamDateKey_(value){
  if(value instanceof Date && !isNaN(value.getTime())){ return Utilities.formatDate(value, PORTAL_CALL_OPS.TIME_ZONE, "yyyy-MM-dd"); }
  const text = String(value || "").trim();
  let m = text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/);
  if(m){ return m[3] + "-" + ("0"+m[1]).slice(-2) + "-" + ("0"+m[2]).slice(-2); }
  m = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if(m){ return m[1] + "-" + m[2] + "-" + m[3]; }
  return "";
}

function PCO_dateFromKey_(key){
  const m = String(key || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(!m){ throw new Error("INVALID_DATE_KEY"); }
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function PCO_dateTimeLabel_(value){
  if(!value){ return ""; }
  const date = value instanceof Date ? value : new Date(value);
  if(isNaN(date.getTime())){ return String(value || ""); }
  return Utilities.formatDate(date, PORTAL_CALL_OPS.TIME_ZONE, "dd-MMM-yyyy hh:mm a");
}

function CDE_loadCallDashboardFactsFast_(requestedMonth){
  const sheet = PC_scheduleSheet_();
  const lastRow = sheet.getLastRow();
  if(lastRow < 1){ return { facts:[], latestDateKey:"" }; }

  const monthKey = String(requestedMonth || "").trim();
  const hasMonthFilter = /^\d{4}-\d{2}$/.test(monthKey);

  const colB = sheet.getRange(1, 2, lastRow, 1).getDisplayValues();
  const headers = [];
  let latestDateKey = "";
  for(let i = 0; i < colB.length; i++){
    const val = String(colB[i][0] || "").trim();
    if(!val || !PC_isDateHeader_(val)){ continue; }
    const key = PC_dateKeyFromHeader_(val);
    headers.push({ row: i + 1, dateKey: key });
    if(key && (!latestDateKey || key > latestDateKey)){ latestDateKey = key; }
  }

  if(!hasMonthFilter){
    return PCO_loadCallDashboardFacts_(requestedMonth);
  }

  let startRow = -1, endRow = -1;
  for(let i = 0; i < headers.length; i++){
    if(headers[i].dateKey && headers[i].dateKey.substring(0, 7) === monthKey){
      const blockEnd = (i + 1 < headers.length) ? headers[i + 1].row - 1 : lastRow;
      if(startRow === -1){ startRow = headers[i].row; }
      endRow = blockEnd;
    }
  }
  if(startRow === -1){ return { facts: [], latestDateKey: latestDateKey }; }

  const rows = sheet.getRange(startRow, 2, endRow - startRow + 1, 5).getDisplayValues();

  const statusMap = PC_loadStatusMap_();
  const approvedTransfers = PCO_loadApprovedReassignmentHistory_();
  const facts = [];
  let currentDateLabel = "", currentDateKey = "", currentMonthMatches = false, duplicateCounts = {};

  for(let i = 0; i < rows.length; i++){
    const colBVal = String(rows[i][0] || "").trim();
    if(PC_isDateHeader_(colBVal)){
      currentDateLabel = colBVal;
      currentDateKey = PC_dateKeyFromHeader_(colBVal);
      currentMonthMatches = !!(currentDateKey && currentDateKey.substring(0, 7) === monthKey);
      duplicateCounts = {};
      continue;
    }
    if(!currentDateKey || !currentMonthMatches){ continue; }

    const extracted = String(rows[i][3] || "").trim();
    if(!extracted){ continue; }
    const sheetHandler = String(rows[i][4] || "").replace(/\s+/g, " ").trim();
    const normalized = PC_normalizeText_(extracted);
    const hash = PC_hash_(normalized);
    duplicateCounts[hash] = (duplicateCounts[hash] || 0) + 1;
    const callId = "CALL-" + currentDateKey + "-" + hash.substring(0, 12) + "-" + duplicateCounts[hash];
    const parsed = PC_parseInterviewText_(extracted);
    const statusEntry = statusMap.byId[callId] || statusMap.byFallback[currentDateKey + "|" + normalized] || null;
    const transfer = approvedTransfers[callId] || null;
    let finalStatus = statusEntry ? PC_normalizeStatus_(statusEntry.status) : "";
    if(!finalStatus){
      const handlerKey = PC_handlerKey_(sheetHandler);
      if(handlerKey === "rescheduled"){ finalStatus = "Rescheduled"; }
      else if(handlerKey === "cancelled" || handlerKey === "canceled"){ finalStatus = "Cancelled"; }
      else{ finalStatus = "Scheduled"; }
    }
    if(finalStatus === "Scheduled" && currentDateKey !== latestDateKey && sheetHandler && !PCO_isOutcomeLabel_(sheetHandler)){ finalStatus = "Completed"; }
    const finalHandler = statusEntry && statusEntry.handler ? statusEntry.handler : (PCO_isOutcomeLabel_(sheetHandler) ? "" : sheetHandler);
    const initialHandler = transfer && transfer.initialHandler ? transfer.initialHandler : finalHandler;

    facts.push({
      callId: callId, dateKey: currentDateKey, dateLabel: currentDateLabel, candidate: parsed.candidate, client: parsed.client,
      duration: parsed.duration || "", time: parsed.time, nightCall: PC_isNightTime_(parsed.time), initialHandler: initialHandler,
      finalHandler: finalHandler, sheetHandler: sheetHandler, status: finalStatus,
      support: PC_handlerKey_(sheetHandler) === "support" || PC_handlerKey_(finalHandler) === "support"
    });
  }

  return { facts: facts, latestDateKey: latestDateKey };
}

function CDE_loadAggregateCallDashboardFactsFast_(requestedMonth){
  const combined = [];
  let latestDateKey = "";
  ["PRADEEP", "HYD", "DEV"].forEach(function(teamCode){
    const runtime = typeof PTR_runtimeForCode_ === "function" ? PTR_runtimeForCode_(teamCode) : null;
    if(!runtime || runtime.connected !== true || !runtime.callTrackerId){ return; }
    const loaded = PTR_withExecutionTeamCode_(teamCode, function(){ return CDE_loadCallDashboardFactsFast_(requestedMonth); });
    if(!loaded){ return; }
    if(loaded.latestDateKey && (!latestDateKey || loaded.latestDateKey > latestDateKey)){ latestDateKey = loaded.latestDateKey; }
    (loaded.facts || []).forEach(function(item){
      const copy = Object.assign({}, item);
      copy.teamCode = runtime.code;
      copy.teamLabel = runtime.label;
      combined.push(copy);
    });
  });
  return { facts: combined, latestDateKey: latestDateKey };
}

function CDE_testFastVsSlowParity(requestedMonth){
  const monthKey = String(requestedMonth || Utilities.formatDate(new Date(), PORTAL_CALL_OPS.TIME_ZONE, "yyyy-MM"));
  const t0 = Date.now();
  const slow = PCO_loadCallDashboardFacts_(monthKey);
  const t1 = Date.now();
  const fast = CDE_loadCallDashboardFactsFast_(monthKey);
  const t2 = Date.now();

  const slowIds = slow.facts.map(function(f){ return f.callId; }).sort();
  const fastIds = fast.facts.map(function(f){ return f.callId; }).sort();
  const idsMatch = JSON.stringify(slowIds) === JSON.stringify(fastIds);

  let firstMismatch = null;
  if(idsMatch){
    const fastById = {};
    fast.facts.forEach(function(f){ fastById[f.callId] = f; });
    for(let i = 0; i < slow.facts.length; i++){
      const a = slow.facts[i], b = fastById[a.callId];
      if(JSON.stringify(a) !== JSON.stringify(b)){ firstMismatch = { callId: a.callId, slow: a, fast: b }; break; }
    }
  }

  const result = {
    monthKey: monthKey,
    slowCount: slow.facts.length, fastCount: fast.facts.length,
    latestDateKeyMatch: slow.latestDateKey === fast.latestDateKey,
    idsMatch: idsMatch, firstMismatch: firstMismatch,
    slowMs: t1 - t0, fastMs: t2 - t1
  };
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

function CDE_testAggregateFastVsSlow(requestedMonth){
  const monthKey = String(requestedMonth || Utilities.formatDate(new Date(), PORTAL_CALL_OPS.TIME_ZONE, "yyyy-MM"));
  const t0 = Date.now();
  const slow = PCO_loadAggregateCallDashboardFacts_(monthKey);
  const t1 = Date.now();
  const fast = CDE_loadAggregateCallDashboardFactsFast_(monthKey);
  const t2 = Date.now();

  const slowIds = slow.facts.map(function(f){ return f.teamCode + "|" + f.callId; }).sort();
  const fastIds = fast.facts.map(function(f){ return f.teamCode + "|" + f.callId; }).sort();
  const idsMatch = JSON.stringify(slowIds) === JSON.stringify(fastIds);

  const result = {
    monthKey: monthKey,
    slowCount: slow.facts.length, fastCount: fast.facts.length,
    latestDateKeyMatch: slow.latestDateKey === fast.latestDateKey,
    idsMatch: idsMatch,
    slowMs: t1 - t0, fastMs: t2 - t1
  };
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}