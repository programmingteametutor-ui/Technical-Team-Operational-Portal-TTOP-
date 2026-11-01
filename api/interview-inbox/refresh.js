// POST/GET /api/interview-inbox/refresh  -> read new recruiter emails into the Interview Inbox.
// Runs every 4 hours from Supabase pg_cron (Authorization: Bearer CRON_SECRET, see interview_inbox_schedule.sql),
// or from "Fetch now" on the page (signed-in admin / Technical POC).
const { refresh, handler, HttpError } = require('../_lib/inbox');
module.exports = handler(req => { if (req.method != 'POST' && req.method != 'GET') throw new HttpError(405, 'Use POST'); return refresh(req) });
module.exports.config = { maxDuration: 60 };
