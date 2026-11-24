// POST /api/push-alerts  every 5 minutes from pg_cron (CRON_SECRET): technical-call and reminder alerts.
// A signed-in user can POST here to send a test alert to their own devices. See api/_lib/push.js
const { http } = require('./_lib/push');
module.exports = (req, res) => http(req, res);
module.exports.config = { maxDuration: 30 };
