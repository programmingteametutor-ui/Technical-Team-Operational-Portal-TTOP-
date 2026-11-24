// POST   /api/interview-inbox/:threadKey/dismiss  -> hide the thread (stored in Supabase)
// DELETE /api/interview-inbox/:threadKey/dismiss  -> undo
// threadKey = <account_id>.<gmail_thread_id>
const { dismiss, handler, HttpError } = require('../../_lib/inbox');
module.exports = handler(req => { if (req.method != 'POST' && req.method != 'DELETE') throw new HttpError(405, 'Use POST or DELETE'); return dismiss(req) });
