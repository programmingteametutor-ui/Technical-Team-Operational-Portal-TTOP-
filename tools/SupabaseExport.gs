/**
 * SUPABASE EXPORT — one-time data migration (copy, does not change your sheets)
 *
 * Paste this file into EACH of the 6 Apps Script projects (Extensions > Apps Script
 * from the bound spreadsheet), set the two constants below, and run
 * `exportToSupabase`. It copies:
 *   1. every tab of the spreadsheet this project is bound to (values, number
 *      formats, display text, formulas, sizes, frozen rows) into gs_* tables
 *   2. this project's Script Properties (bridge secrets, sessions, routing, …)
 *   3. this project's installable triggers (e.g. the Team Data edit trigger)
 *   4. this project's web-app URL, so the new server can route bridge calls
 *
 * Re-running is safe: each tab is replaced. Big tabs continue automatically
 * across runs if the 6-minute limit is reached (just run it again).
 *
 * The service-role key gives full database access. Paste it only into these
 * private projects, run the export, then DELETE this file and rotate nothing
 * else — the key is never written to the sheet or to Script Properties.
 */
const SUPABASE_EXPORT = {
  URL: "https://YOUR-PROJECT.supabase.co",
  SERVICE_ROLE_KEY: "PASTE-SERVICE-ROLE-KEY-HERE",
  // project name used by the portal server (config/projects.json)
  // portal | pune-call-tracker | pune-incentives | pune-private-backend | hyd-call-tracker | hyd-private-backend
  PROJECT: "",
  ROWS_PER_REQUEST: 400,
  CELLS_PER_READ: 60000
};

function exportToSupabase() {
  const cfg = SUPABASE_EXPORT;
  if (!cfg.PROJECT) throw new Error("Set SUPABASE_EXPORT.PROJECT first.");
  const started = Date.now();
  const ss = SpreadsheetApp.getActive();
  if (!ss) throw new Error("This project is not bound to a spreadsheet. Open it from the spreadsheet (Extensions > Apps Script).");

  const resume = PropertiesService.getUserProperties();
  const resumeKey = "SUPABASE_EXPORT_DONE_" + ss.getId();
  const done = JSON.parse(resume.getProperty(resumeKey) || "{}");

  sbRpc_("rpc/gs_export_workbook", {
    p: { spreadsheet_id: ss.getId(), title: ss.getName(), time_zone: ss.getSpreadsheetTimeZone() }
  });

  const sheets = ss.getSheets();
  for (let i = 0; i < sheets.length; i++) {
    const sh = sheets[i];
    const name = sh.getName();
    if (done[name]) continue;
    if (Date.now() - started > 4.5 * 60 * 1000) {
      resume.setProperty(resumeKey, JSON.stringify(done));
      Logger.log("Time limit near — run exportToSupabase again to continue.");
      return;
    }
    exportSheet_(ss, sh, i);
    done[name] = true;
    Logger.log("Exported " + name);
  }
  resume.deleteProperty(resumeKey);

  // Script properties
  const props = PropertiesService.getScriptProperties().getProperties();
  const list = Object.keys(props).map(function (k) { return { project: cfg.PROJECT, key: k, value: String(props[k]) }; });
  if (list.length) sbPost_("gs_script_properties?on_conflict=project,key", list, "resolution=merge-duplicates,return=minimal");

  // Triggers
  const triggers = ScriptApp.getProjectTriggers().map(function (t) {
    return {
      id: t.getUniqueId(), project: cfg.PROJECT, handler: t.getHandlerFunction(),
      event_type: String(t.getEventType()), source_id: t.getTriggerSourceId() || null, meta: {}
    };
  });
  if (triggers.length) sbPost_("gs_triggers?on_conflict=id", triggers, "resolution=merge-duplicates,return=minimal");

  // Web-app URL (used to route the portal's UrlFetchApp bridge calls in-process)
  let url = "";
  try { url = ScriptApp.getService().getUrl() || ""; } catch (e) {}
  sbPost_("gs_export_log?on_conflict=project", [{
    project: cfg.PROJECT, script_id: ScriptApp.getScriptId(), spreadsheet_id: ss.getId(),
    web_app_url: url, property_count: list.length, trigger_count: triggers.length, exported_at: new Date().toISOString()
  }], "resolution=merge-duplicates,return=minimal");

  Logger.log("DONE: " + sheets.length + " tabs, " + list.length + " script properties, " + triggers.length + " triggers. Web app: " + url);
}

function exportSheet_(ss, sh, position) {
  const cfg = SUPABASE_EXPORT;
  const maxRows = sh.getMaxRows(), maxCols = sh.getMaxColumns();
  const lastRow = sh.getLastRow(), lastCol = sh.getLastColumn();
  const sheetPk = sbRpc_("rpc/gs_export_sheet_begin", {
    p: {
      spreadsheet_id: ss.getId(), sheet_id: sh.getSheetId(), name: sh.getName(), position: position,
      max_rows: maxRows, max_cols: maxCols, frozen_rows: sh.getFrozenRows(), frozen_cols: sh.getFrozenColumns(),
      hidden: sh.isSheetHidden()
    }
  });
  if (!lastRow || !lastCol) return;
  const rowsPerRead = Math.max(1, Math.floor(cfg.CELLS_PER_READ / lastCol));
  let batch = [];
  for (let start = 1; start <= lastRow; start += rowsPerRead) {
    const n = Math.min(rowsPerRead, lastRow - start + 1);
    const range = sh.getRange(start, 1, n, lastCol);
    const values = range.getValues();
    const display = range.getDisplayValues();
    const formats = range.getNumberFormats();
    const formulas = range.getFormulas();
    for (let r = 0; r < n; r++) {
      const v = values[r].map(encodeCell_);
      const f = formats[r].map(function (x) { return x && x !== "General" ? x : null; });
      const x = formulas[r].map(function (y) { return y || null; });
      const d = display[r];
      const hasValue = v.some(function (c) { return c !== ""; });
      const hasFmt = f.some(Boolean), hasFormula = x.some(Boolean);
      if (!hasValue && !hasFmt && !hasFormula) continue;
      batch.push({
        row_num: start + r,
        v: trimEnd_(v, function (c) { return c === ""; }),
        f: hasFmt ? trimEnd_(f, function (c) { return !c; }) : null,
        d: trimEnd_(d.slice(), function (c) { return c === ""; }),
        x: hasFormula ? trimEnd_(x, function (c) { return !c; }) : null
      });
      if (batch.length >= cfg.ROWS_PER_REQUEST) { sbRpc_("rpc/gs_save_sheet", { p: { sheet_pk: sheetPk, name: sh.getName(), rows: batch } }); batch = []; }
    }
  }
  if (batch.length) sbRpc_("rpc/gs_save_sheet", { p: { sheet_pk: sheetPk, name: sh.getName(), rows: batch } });
}

function encodeCell_(c) {
  if (Object.prototype.toString.call(c) === "[object Date]") return isNaN(c.getTime()) ? "" : { $d: c.toISOString() };
  return c;
}
function trimEnd_(a, isEmpty) { let n = a.length; while (n > 0 && isEmpty(a[n - 1])) n--; return a.slice(0, n); }

function sbHeaders_(prefer) {
  const h = { apikey: SUPABASE_EXPORT.SERVICE_ROLE_KEY, Authorization: "Bearer " + SUPABASE_EXPORT.SERVICE_ROLE_KEY };
  if (prefer) h.Prefer = prefer;
  return h;
}
function sbRpc_(path, body) {
  const res = UrlFetchApp.fetch(SUPABASE_EXPORT.URL.replace(/\/$/, "") + "/rest/v1/" + path, {
    method: "post", contentType: "application/json", headers: sbHeaders_(), payload: JSON.stringify(body), muteHttpExceptions: true
  });
  if (res.getResponseCode() >= 300) throw new Error("Supabase " + path + " " + res.getResponseCode() + ": " + res.getContentText().slice(0, 400));
  const t = res.getContentText();
  return t ? JSON.parse(t) : null;
}
function sbPost_(path, rows, prefer) {
  const res = UrlFetchApp.fetch(SUPABASE_EXPORT.URL.replace(/\/$/, "") + "/rest/v1/" + path, {
    method: "post", contentType: "application/json", headers: sbHeaders_(prefer), payload: JSON.stringify(rows), muteHttpExceptions: true
  });
  if (res.getResponseCode() >= 300) throw new Error("Supabase " + path + " " + res.getResponseCode() + ": " + res.getContentText().slice(0, 400));
}
