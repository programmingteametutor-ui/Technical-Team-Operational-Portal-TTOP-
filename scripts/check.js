// Pre-flight check: files, packages, settings, and (when configured) the Supabase migrations.
process.env.TZ = process.env.TZ || "Asia/Kolkata";
const path = require("path");
const fs = require("fs");
const ROOT = path.resolve(__dirname, "..");
(function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) { const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line); if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2"); }
})(path.join(ROOT, ".env"));

(async () => {
  let ok = true;
  const has = (rel, label) => { const yes = fs.existsSync(path.join(ROOT, rel)); if (!yes) ok = false; console.log((yes ? "ok   " : "FAIL ") + label); };
  has("portals/ttop/index.html", "TTOP portal files");
  has("public/app.html", "Home page");
  console.log((fs.existsSync(path.join(ROOT, "portals", "callpilots", "index.html")) ? "ok   " : "info ") + "Call Pilots page" +
    (fs.existsSync(path.join(ROOT, "portals", "callpilots", "index.html")) ? "" : " not built yet (a placeholder is shown)"));
  try { require(path.join(ROOT, "server", "index.js")); console.log("ok   server loads"); } catch (e) { ok = false; console.log("FAIL server: " + e.message); }

  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const url = process.env.SUPABASE_URL.replace(/\/$/, ""), key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const rpc = (fn, body) => fetch(url + "/rest/v1/rpc/" + fn, { method: "POST", headers: { apikey: key, Authorization: "Bearer " + key, "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
    const r6 = await rpc("app_dashboard_ttop", { p_today: new Date().toISOString().slice(0, 10) }).catch(e => ({ ok: false, statusText: e.message }));
    console.log((r6.ok ? "ok   " : "FAIL ") + "migration 20261124000006_admin_dashboard.sql" + (r6.ok ? "" : " (" + r6.status + ")"));
    const rc = await rpc("app_dashboard_callpilots", {}).catch(e => ({ ok: false, statusText: e.message }));
    console.log((rc.ok ? "ok   " : "FAIL ") + "migration 20261125000001_callpilots.sql" + (rc.ok ? "" : " (" + rc.status + ": run it in the SQL Editor)"));
    if (!r6.ok || !rc.ok) ok = false;
  } else console.log("info SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set: database not checked");

  for (const m of ["mysql2", "web-push"]) { try { require.resolve(m, { paths: [path.join(ROOT, "portals", "ttop", "api")] }); console.log("ok   package " + m); } catch (e) { console.log("WARN package " + m + " not installed (run npm install): TTOP Interview Inbox / phone alerts need it"); } }
  for (const k of ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "APP_SECRET", "PUBLIC_URL", "CRON_SECRET", "SUPER_ADMIN_EMAILS"]) console.log((process.env[k] ? "ok   " : "WARN ") + "env " + k + (process.env[k] ? "" : " is not set"));
  process.exit(ok ? 0 : 1);
})();
