// Vercel entry point: every request (see vercel.json rewrites) goes to the combined app.
// The app keeps Dhruva's working data in memory per instance and refreshes it from
// Supabase on every request, so any number of instances can run at once.
module.exports = require("../server/index.js").vercelHandler;

// Never called: lets Vercel's bundler see the files and packages loaded at runtime
// (TTOP's API functions, their packages, and the worker thread).
function __bundleHints() {
  require("../portals/ttop/api/config.js");
  require("../portals/ttop/api/sync-doc.js");
  require("../portals/ttop/api/push-alerts.js");
  require("../portals/ttop/api/interview-inbox/index.js");
  require("../portals/ttop/api/interview-inbox/refresh.js");
  require("../portals/ttop/api/interview-inbox/[id].js");
  require("../portals/ttop/api/interview-inbox/[id]/dismiss.js");
  require("mysql2/promise");
  require("web-push");
  require("../server/worker.js");
}
module.exports.__bundleHints = __bundleHints;
