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
      const wbs = await sb.req("GET", "gs_workbooks?select=spreadsheet_id,title,imported_at");
      const sheets = await sb.req("GET", "gs_sheets?select=spreadsheet_id");
      for (const w of wbs) console.log((w.imported_at ? "ok   " : "WARN ") + "workbook " + w.title + ": " + sheets.filter(s => s.spreadsheet_id === w.spreadsheet_id).length + " tabs" + (w.imported_at ? "" : " (not exported yet)"));
      const log = await sb.req("GET", "gs_export_log?select=project,web_app_url,property_count");
      for (const p of Object.keys(config.projects)) {
        const e = log.find(x => x.project === p);
        console.log((e ? "ok   " : "WARN ") + "export " + p + (e ? ": " + e.property_count + " script properties" : ": exporter not run in this project yet"));
      }
    } catch (e) { ok = false; console.log("FAIL Supabase: " + e.message); }
  } else console.log("info SUPABASE_URL not set (local file mode)");
  const fs = require("fs");
  console.log((fs.existsSync(path.join(ROOT, "portals", "ttop", "index.html")) ? "ok   " : "FAIL ") + "TTOP portal files");
  for (const m of ["mysql2", "web-push"]) { try { require.resolve(m, { paths: [path.join(ROOT, "portals", "ttop", "api")] }); console.log("ok   package " + m); } catch (e) { console.log("WARN package " + m + " not installed (run npm install): TTOP Interview Inbox / phone alerts need it"); } }
  for (const k of ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "APP_SECRET", "PUBLIC_URL", "CRON_SECRET"]) console.log((process.env[k] ? "ok   " : "WARN ") + "env " + k + (process.env[k] ? "" : " is not set"));
  process.exit(ok ? 0 : 1);
})();
