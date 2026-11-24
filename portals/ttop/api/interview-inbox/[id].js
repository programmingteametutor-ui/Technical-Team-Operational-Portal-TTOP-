// GET /api/interview-inbox/:messageId  -> fields, email text (body_plain, max 100k) and the thread's email list
const { detail, handler, HttpError } = require('../_lib/inbox');
module.exports = handler(req => { if (req.method != 'GET') throw new HttpError(405, 'Use GET'); return detail(req) });
module.exports.config = { maxDuration: 20 };
