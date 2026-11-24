// Pre-flight check: loads every Dhruva Apps Script project, checks TTOP files, settings and Supabase.
process.env.TZ = process.env.TZ || "Asia/Kolkata";
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
(function loadDotEnv(file) {
  const fs = require("fs"); if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) { const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line); if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2"); }
})(path.join(ROOT, ".env"));
const { Store } = require("../server/store");
const { Runtime } = require("../server/runtime");
const config = require("../config/projects.json");
(async () => {
  let ok = true;
  const store = new Store();
  const rt = new Runtime({ store, config, appsScriptDir: path.join(ROOT, "portals", "dhruva"), persist: async () => {}, mailer: async () => {} });
  rt.loadProjects();
  for (const name of rt.projects.keys()) {
    const { journal } = store.begin();
    try { rt.createContext(name, {}); console.log("ok   project " + name); }
    catch (e) { ok = false; console.log("FAIL project " + name + ": " + e.message); }
    finally { store.end(journal); }
  }
  if (process.env.SUPABASE_URL) {
    const { SupabaseAdapter } = require("../server/persistence");
    const sb = new SupabaseAdapter({ url: process.env.SUPABASE_URL, serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY });
    try {
      const wbs = await sb.req("GET", "gs_workbooks?select=spreadsheet_id,title");
      const sheets = await sb.req("GET", "gs_sheets?select=spreadsheet_id");
      for (const w of wbs) { const n = sheets.filter(s => s.spreadsheet_id === w.spreadsheet_id).length; console.log((n ? "ok   " : "WARN ") + "workbook " + w.title + ": " + n + " tabs" + (n ? "" : " (import its CSV files on Data import)")); }
      try { await sb.req("GET", "app_imports?select=id&limit=1"); console.log("ok   migration 6 (dashboard, CSV import)"); }
      catch (e) { ok = false; console.log("FAIL migration 6 not run: supabase/migrations/20261124000006_admin_dashboard.sql"); }
    } catch (e) { ok = false; console.log("FAIL Supabase: " + e.message); }
  } else console.log("info SUPABASE_URL not set (local file mode)");
  const fs = require("fs");
  console.log((fs.existsSync(path.join(ROOT, "config", "tab-profiles.json")) ? "ok   " : "FAIL ") + "CSV import tab layouts (config/tab-profiles.json)");
  console.log((fs.existsSync(path.join(ROOT, "portals", "ttop", "index.html")) ? "ok   " : "FAIL ") + "TTOP portal files");
  for (const m of ["mysql2", "web-push"]) { try { require.resolve(m, { paths: [path.join(ROOT, "portals", "ttop", "api")] }); console.log("ok   package " + m); } catch (e) { console.log("WARN package " + m + " not installed (run npm install): TTOP Interview Inbox / phone alerts need it"); } }
  for (const k of ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "APP_SECRET", "PUBLIC_URL", "CRON_SECRET", "SUPER_ADMIN_EMAILS"]) console.log((process.env[k] ? "ok   " : "WARN ") + "env " + k + (process.env[k] ? "" : " is not set"));
  process.exit(ok ? 0 : 1);
})();
