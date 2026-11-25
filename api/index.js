// Vercel entry point: every request (see vercel.json rewrites) goes to the combined app.
// The server keeps no data in memory: TTOP and Call Pilots read Supabase directly.
module.exports = require("../server/index.js").vercelHandler;

// Never called: lets Vercel's bundler see TTOP's API functions and their packages.
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
}
module.exports.__bundleHints = __bundleHints;
