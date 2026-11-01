// GET /api/interview-inbox?page&pageSize&q&student&client&stage&hasDate&showPast&view
//   One row per email thread (INTERVIEW / SCHEDULING emails since INTERVIEW_IMPORT_START_DATE) with pre-filled interview fields.
// GET /api/interview-inbox?diag=1   (admins) shows how internal_date is stored, to set INBOX_DB_TIMEZONE.
const { list, handler, HttpError } = require('../_lib/inbox');
module.exports = handler(req => { if (req.method != 'GET') throw new HttpError(405, 'Use GET'); return list(req) });
module.exports.config = { maxDuration: 30 };
