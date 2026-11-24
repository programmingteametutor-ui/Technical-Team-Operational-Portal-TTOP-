/******************************************************
 * PORTALCALLROLE.GS
 * Call Schedule: handler / admin confirms the ROLE of a
 * scheduled call.
 *
 * Candidate and Client are confirmed with Map Candidate /
 * Map / Add Client (PortalIdentityMapping.gs). This adds the
 * third part: the Role/Position the call is for. The parser
 * already reads a role from the call text; the person who
 * handles the call (or an admin) checks it, corrects it if
 * needed, and saves it.
 *
 * ACCESS: same rule as identity mapping (PIM_requireCallAccess_):
 *   Admin / Super Admin: any call; Handler: own calls only.
 *
 * STORAGE: "Call Role Confirmations" in the Interview Portal
 * Control workbook (same workbook as the identity maps).
 * One row per team + call; saving again updates that row.
 * Every save is also written to "Identity Mapping Audit".
 *
 * Role never takes part in candidate/client identity,
 * promotion, selection or duplicate keys.
 ******************************************************/
const PORTAL_CALL_ROLE = Object.freeze({
  SHEET: "Call Role Confirmations",
  HEADERS: [
    "Team", "Call ID", "Date Key", "Source Row", "Call Text",
    "Parsed Role", "Confirmed Role", "Confirmed By", "Confirmed At"
  ],
  MAX_LENGTH: 120
});


/******************************************************
 * PUBLIC: SAVE THE CONFIRMED ROLE OF ONE CALL
 ******************************************************/
function savePortalCallRole(token, callId, role, callLocator){
  const auth = PA_validateSession_(token);
  if(!auth.ok){
    throw new Error("SESSION_EXPIRED");
  }
  const clean = PCR_cleanRole_(role);
  if(!clean){
    throw new Error("CALL_ROLE_REQUIRED");
  }
  const runtime = PTR_requireSpecificConnectedRuntime_("Confirm Role");
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try{
    const call = PIM_resolveCallForIdentity_(callId, callLocator);
    PIM_requireCallAccess_(auth.user, call);

    const sheet = PCR_sheet_();
    const now = new Date();
    const by = String(auth.user && (auth.user.handler || auth.user.name || auth.user.email) || "").trim();
    const parsed = PC_parseInterviewText_(call.originalText || "");
    const row = [
      runtime.code,
      call.callId,
      call.dateKey || "",
      Number(call.sourceRow || 0),
      call.originalText || "",
      String(parsed && parsed.role || ""),
      clean,
      by,
      now
    ];

    const found = PCR_findRow_(sheet, runtime.code, call.callId);
    if(found){
      sheet.getRange(found, 1, 1, row.length).setValues([row]);
    }else{
      sheet.appendRow(row);
    }

    PIM_appendAudit_({
      team: runtime.label,
      callId: call.callId,
      sourceRow: call.sourceRow,
      entityType: "role",
      originalValue: String(parsed && parsed.role || ""),
      canonicalValue: clean,
      action: found ? "ROLE_CHANGED" : "ROLE_CONFIRMED",
      actorEmail: auth.user && auth.user.email || ""
    });

    return {
      ok: true,
      callId: call.callId,
      confirmedRole: clean,
      roleConfirmedBy: by,
      roleConfirmedAt: PCR_stamp_(now)
    };
  }finally{
    lock.releaseLock();
  }
}


/******************************************************
 * PRIVATE: ADD CONFIRMED ROLES TO SCHEDULE CALLS
 * Called by getPortalCallScheduleData.
 ******************************************************/
function PCR_enrichCalls_(calls){
  const list = calls || [];
  let map = {};
  try{
    map = PCR_loadMap_(PTR_currentRuntime_().code);
  }catch(error){
    // control workbook not set up yet: show parsed roles only
    map = {};
  }
  list.forEach(function(call){
    const saved = map[call.callId] || null;
    call.confirmedRole = saved ? saved.role : "";
    call.roleConfirmedBy = saved ? saved.by : "";
    call.roleConfirmedAt = saved ? saved.at : "";
  });
  return list;
}


/******************************************************
 * PRIVATE: ROLE SUGGESTIONS (confirmed roles, newest first)
 ******************************************************/
function PCR_roleOptions_(){
  try{
    const sheet = PCR_controlSheetIfExists_();
    if(!sheet || sheet.getLastRow() < 2){
      return [];
    }
    const values = sheet.getRange(2, 7, sheet.getLastRow() - 1, 1).getValues();
    const seen = {};
    const out = [];
    for(let i = values.length - 1; i >= 0 && out.length < 300; i--){
      const role = PCR_cleanRole_(values[i][0]);
      const key = role.toLowerCase();
      if(role && !seen[key]){
        seen[key] = true;
        out.push(role);
      }
    }
    return out.sort(function(a, b){ return a.localeCompare(b); });
  }catch(error){
    return [];
  }
}


/******************************************************
 * HELPERS
 ******************************************************/
function PCR_cleanRole_(value){
  return String(value || "")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .substring(0, PORTAL_CALL_ROLE.MAX_LENGTH);
}


function PCR_controlSheetIfExists_(){
  return PIM_controlWorkbook_({allowActiveFallback:true})
    .getSheetByName(PORTAL_CALL_ROLE.SHEET);
}


function PCR_sheet_(){
  const ss = PIM_controlWorkbook_({allowActiveFallback:true});
  let sheet = ss.getSheetByName(PORTAL_CALL_ROLE.SHEET);
  if(!sheet){
    sheet = ss.insertSheet(PORTAL_CALL_ROLE.SHEET);
  }
  if(sheet.getLastRow() === 0){
    sheet
      .getRange(1, 1, 1, PORTAL_CALL_ROLE.HEADERS.length)
      .setValues([PORTAL_CALL_ROLE.HEADERS])
      .setFontWeight("bold");
    sheet.setFrozenRows(1);
  }
  return sheet;
}


function PCR_findRow_(sheet, teamCode, callId){
  const last = sheet.getLastRow();
  if(last < 2){
    return 0;
  }
  const values = sheet.getRange(2, 1, last - 1, 2).getValues();
  for(let i = 0; i < values.length; i++){
    if(
      String(values[i][0] || "") === String(teamCode || "") &&
      String(values[i][1] || "") === String(callId || "")
    ){
      return i + 2;
    }
  }
  return 0;
}


function PCR_loadMap_(teamCode){
  const sheet = PCR_controlSheetIfExists_();
  const map = {};
  if(!sheet || sheet.getLastRow() < 2){
    return map;
  }
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, PORTAL_CALL_ROLE.HEADERS.length).getValues();
  values.forEach(function(r){
    if(String(r[0] || "") !== String(teamCode || "")){
      return;
    }
    const callId = String(r[1] || "").trim();
    const role = PCR_cleanRole_(r[6]);
    if(callId && role){
      map[callId] = {
        role: role,
        by: String(r[7] || "").trim(),
        at: r[8] instanceof Date ? PCR_stamp_(r[8]) : String(r[8] || "")
      };
    }
  });
  return map;
}


function PCR_stamp_(date){
  return Utilities.formatDate(date, "Asia/Kolkata", "dd-MMM-yyyy hh:mm a");
}
