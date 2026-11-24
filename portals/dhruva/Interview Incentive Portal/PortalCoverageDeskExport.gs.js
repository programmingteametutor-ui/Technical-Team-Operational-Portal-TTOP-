/***************************************************************
 * PORTALCOVERAGEDESKEXPORT.GS - v4 (renamed constant, avoids collision)
 * Read-only bridge: Interview Portal Control -> Coverage Desk
 *
 * If you're replacing an earlier version of this file: the top-level
 * constant is now CDESK_EXPORT_CONFIG instead of COVERAGE_DESK_EXPORT,
 * specifically to avoid a naming collision with something else already
 * declared elsewhere in this project.
 *
 * Still completely READ-ONLY. Still uses its own dedicated secret,
 * separate from the scheduler and incentive bridges. Cannot assign,
 * approve, or write anything. Covers both connected teams (Pradeep
 * Anna Team + Hyderabad Team).
 ***************************************************************/

const CDESK_EXPORT_CONFIG = {
  SECRET_PROPERTY: "COVERAGE_DESK_EXPORT_SECRET"
};

/**
 * THE ACTUAL WEB APP ENTRY POINT FOR POST REQUESTS.
 * Every POST request to your deployed /exec URL lands here first.
 */
function doPost(e){
  try{
    const body = JSON.parse((e.postData && e.postData.contents) || "{}");

    if(body.target === "coverageDesk"){
      return coverageDeskExportRequest_(e);
    }

    return CDE_json_({ ok:false, error:"NO_POST_HANDLER" });

  }catch(err){
    return CDE_json_({ ok:false, error: String((err && err.message) || err) });
  }
}

/**
 * Run this once manually (function dropdown at top -> Run) to generate
 * a fresh random secret. Copy the value from the Execution Log into
 * Vercel as COVERAGE_DESK_PORTAL_SECRET, then don't paste it anywhere
 * else, including back into chat.
 */
function generateCoverageDeskExportSecret(){
  const secret = Utilities.getUuid() + Utilities.getUuid();
  PropertiesService.getScriptProperties().setProperty(
    CDESK_EXPORT_CONFIG.SECRET_PROPERTY,
    secret
  );
  Logger.log("========== COVERAGE DESK EXPORT SECRET ==========");
  Logger.log(secret);
  Logger.log("Copy this into Vercel as COVERAGE_DESK_PORTAL_SECRET.");
  Logger.log("==================================================");
}

/**
 * Handles the actual "coverageDesk" request once doPost has routed it
 * here. Checks the secret, then returns whichever resource was asked for.
 */
function coverageDeskExportRequest_(e){
  try{
    const body = JSON.parse((e.postData && e.postData.contents) || "{}");
    const expected = PropertiesService.getScriptProperties()
      .getProperty(CDESK_EXPORT_CONFIG.SECRET_PROPERTY) || "";
    const provided = String(body.secret || "");

    if(!expected || provided !== expected){
      return CDE_json_({ ok:false, error:"UNAUTHORIZED" });
    }

    const resource = String(body.resource || "");
    const monthFromDate = String(body.date || "").trim().substring(0,7);
    const effectiveMonth = String(body.month || monthFromDate || "");
    let data;

    if(resource === "assignments"){
      data = CDE_getAssignments_(effectiveMonth, String(body.date || ""));
    } else if(resource === "incentives"){
      data = CDE_getIncentiveSummary_(String(body.month || ""));
    } else if(resource === "everything"){
      data = {
        assignments: CDE_getAssignments_(effectiveMonth, String(body.date || "")),
        incentives: CDE_getIncentiveSummary_(String(body.month || ""))
      };
    } else {
      return CDE_json_({ ok:false, error:"UNKNOWN_RESOURCE" });
    }

    return CDE_json_({ ok:true, data: data, generatedAt: new Date().toISOString() });

  } catch(err){
    return CDE_json_({ ok:false, error: String((err && err.message) || err) });
  }
}

function CDE_json_(obj){
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * All call assignments across every connected team (Pradeep + HYD).
 * When exactDateKey is given (yyyy-MM-dd), this is fast: it only reads
 * that one month's data from each team's Call Tracker, then filters
 * down to that single day — a small fraction of the ~7000+ records in
 * full history. Leave exactDateKey blank for the full-history pull
 * (slow, ~20 seconds, but returns everything ever recorded).
 */
function CDE_getAssignments_(monthKey, exactDateKey){
  const loaded = CDE_loadAggregateCallDashboardFactsFast_(monthKey || "");
  let facts = (loaded && loaded.facts) || [];

  const dateFilter = String(exactDateKey || "").trim();
  if(dateFilter){
    facts = facts.filter(function(item){
      return item.dateKey === dateFilter;
    });
  }

  return facts.map(function(item){
    return {
      callId: item.callId || "",
      team: item.teamLabel || item.teamCode || "",
      teamCode: item.teamCode || "",
      date: item.dateLabel || "",
      dateKey: item.dateKey || "",
      candidate: item.candidate || "",
      client: item.client || "",
      time: item.time || "",
      duration: item.duration || "",
      assignee: item.finalHandler || item.initialHandler || "",
      initialAssignee: item.initialHandler || "",
      status: item.status || "",
      support: item.support === true,
      nightCall: item.nightCall === true
    };
  });
}

/**
 * Per-handler incentive totals across every connected team, for the
 * given month (yyyy-MM) or all months if blank. Reuses
 * PD_loadTrackerRecordsFromSheet_ — the exact function the Portal's
 * own Incentive Tracker page uses, so figures match exactly.
 */
function CDE_getIncentiveSummary_(monthKey){

  const teamCodes = ["PRADEEP","HYD"];
  const perHandler = {};
  const byTeam = {};
  const monthFilter = String(monthKey || "").trim();

  teamCodes.forEach(function(teamCode){

    const runtime = PTR_runtimeForCode_(teamCode);
    if(!runtime || runtime.connected !== true){
      return;
    }

    let sheet;
    try{
      sheet = SpreadsheetApp
        .openById(runtime.privateBackendId)
        .getSheetByName(runtime.trackerSheet || "Incentive Tracker");
    }catch(error){
      return;
    }
    if(!sheet){
      return;
    }

    const records = PD_loadTrackerRecordsFromSheet_(sheet, teamCode, runtime.label);

    let teamTotal = 0;
    let teamCount = 0;

    records.forEach(function(record){

      if(monthFilter && record.monthKey !== monthFilter){
        return;
      }

      teamTotal += record.amount;
      teamCount++;

      const key = teamCode + "|" + record.handler.toLowerCase();

      if(!perHandler[key]){
        perHandler[key] = {
          team: runtime.label,
          teamCode: teamCode,
          handler: record.handler,
          promotion: 0,
          selection: 0,
          total: 0,
          records: 0
        };
      }

      const row = perHandler[key];
      const type = String(record.type || "").toLowerCase();

      if(type === "promotion"){ row.promotion += record.amount; }
      if(type === "selection"){ row.selection += record.amount; }
      row.total += record.amount;
      row.records++;

    });

    byTeam[teamCode] = {
      label: runtime.label,
      total: teamTotal,
      records: teamCount
    };

  });

  const byHandler = Object.keys(perHandler)
    .map(function(key){ return perHandler[key]; })
    .sort(function(a,b){ return b.total - a.total; });

  return {
    month: monthFilter || "ALL",
    byTeam: byTeam,
    byHandler: byHandler,
    grandTotal: byHandler.reduce(function(sum,row){ return sum + row.total; }, 0)
  };
}

/**
 * ISOLATED DIAGNOSTIC — checks the HYD call tracker sheet directly.
 */
function testDirectOpen(){
  try {
    const ss = SpreadsheetApp.openById("1pDKLkZc4mCU7pcTWG-aYgovj7DJjF7C77292JyQ3zwU");
    Logger.log("SUCCESS: " + ss.getName());
  } catch(e) {
    Logger.log("FAILED: " + e.message);
  }
}

/**
 * ISOLATED DIAGNOSTIC — checks the Pradeep Anna Team call tracker
 * sheet directly.
 */
function testPradeepOpen(){
  try {
    const ss = SpreadsheetApp.openById("1BD_XIhQW6d4w4dnrcM17wYgv6hZqdx7mTsAIYgUOC7M");
    Logger.log("SUCCESS: " + ss.getName());
  } catch(e) {
    Logger.log("FAILED: " + e.message);
  }
}

/**
 * FULL DIAGNOSTIC — runs the actual combined bridge logic used by
 * Coverage Desk, across both teams.
 */
function testCoverageDeskBridge(){
  Logger.log("Effective user: " + Session.getEffectiveUser().getEmail());
  const started = new Date().getTime();
  const result = CDE_getAssignments_("");
  const elapsed = new Date().getTime() - started;
  Logger.log("Records: " + result.length);
  Logger.log("Elapsed ms: " + elapsed);
}

/**
 * ISOLATED DIAGNOSTIC — compares raw call facts for PRADEEP vs HYD on the
 * same date, using the real code path (PTR_withExecutionTeamCode_ +
 * PCO_loadCallDashboardFacts_). sheetHandler is the raw value straight
 * from the spreadsheet column; finalHandler is what gets returned after
 * status matching. Change dateKey below to whatever date you're checking.
 */
function testTeamIsolation(){
  const dateKey = "2026-09-01"; // change to the date you're checking
  const monthKey = dateKey.substring(0,7);

  ["PRADEEP","HYD"].forEach(function(teamCode){
    Logger.log("========== " + teamCode + " ==========");
    const result = PTR_withExecutionTeamCode_(teamCode, function(){
      return PCO_loadCallDashboardFacts_(monthKey);
    });
    if(!result){
      Logger.log("null / not connected");
      return;
    }
    const todays = (result.facts || []).filter(function(f){ return f.dateKey === dateKey; });
    Logger.log("Facts for " + dateKey + ": " + todays.length);
    todays.slice(0,6).forEach(function(f){
      Logger.log(JSON.stringify({
        candidate: f.candidate,
        client: f.client,
        time: f.time,
        sheetHandler: f.sheetHandler,
        finalHandler: f.finalHandler,
        status: f.status
      }));
    });
  });
}

/**
 * ISOLATED DIAGNOSTIC — walks through CDE_getIncentiveSummary_'s logic
 * step by step for each team, logging exactly where it breaks instead of
 * silently skipping. Change monthKey below to whatever month you're
 * checking.
 */
function testIncentivesIsolation(){
  const monthKey = "2026-09";
  ["PRADEEP","HYD"].forEach(function(teamCode){
    Logger.log("========== " + teamCode + " ==========");

    const runtime = PTR_runtimeForCode_(teamCode);
    if(!runtime){
      Logger.log("PTR_runtimeForCode_ returned nothing for " + teamCode);
      return;
    }
    Logger.log("connected: " + runtime.connected + ", privateBackendId: " + runtime.privateBackendId + ", trackerSheet: " + (runtime.trackerSheet || "Incentive Tracker (default)"));
    if(runtime.connected !== true){
      Logger.log("SKIPPED — runtime.connected is not true for " + teamCode);
      return;
    }

    let ss, sheet;
    try{
      ss = SpreadsheetApp.openById(runtime.privateBackendId);
      Logger.log("Opened spreadsheet: " + ss.getName());
    }catch(error){
      Logger.log("FAILED to open spreadsheet: " + error.message);
      return;
    }
    sheet = ss.getSheetByName(runtime.trackerSheet || "Incentive Tracker");
    if(!sheet){
      Logger.log("FAILED — no tab named exactly \"" + (runtime.trackerSheet || "Incentive Tracker") + "\". Actual tab names: " + ss.getSheets().map(function(s){return s.getName();}).join(", "));
      return;
    }
    Logger.log("Found tab: " + sheet.getName());

    const records = PD_loadTrackerRecordsFromSheet_(sheet, teamCode, runtime.label);
    Logger.log("Total records read from sheet: " + records.length);
    const monthMatches = records.filter(function(r){ return r.monthKey === monthKey; });
    Logger.log("Records matching monthKey '" + monthKey + "': " + monthMatches.length);
    if(records.length && !monthMatches.length){
      const sampleMonths = Array.from(new Set(records.map(function(r){ return r.monthKey; }))).slice(0,10);
      Logger.log("Sample of actual monthKey values found in sheet: " + sampleMonths.join(", "));
    }
  });
}