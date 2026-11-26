// Doc sync: only a new CANDIDATE waits on Import Review. A new client is matched to an existing one
// first and otherwise created, and the interview is added; Import Review then shows a non-blocking
// "Check" row. A new role never stops a line; a role that looks like a misspelt existing role gets a
// "Check" row too. Run: npm test
'use strict';
const test = require('node:test'), assert = require('node:assert');
process.env.SUPABASE_URL = 'http://sb.test'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
const { runSync } = require('../api/sync-doc');

// today in India, so the lines are not "old"
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() + 2 * 86400e3));
const [y, m, d] = today.split('-').map(Number);
const head = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric' }) + ' (' + new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long' }) + ')';
const doc = [head,
  'Ravi Kumar (UK)(Java Developer) – Interview – Initrode – 4:00 PM IST – Duration: 60 Mins (1st Round)-gopi',      // all known -> added
  'Ravi Kumar (UK)(Java Developer) – Interview – Newco Labs – 5:00 PM IST – Duration: 60 Mins (1st Round)-gopi',   // new client -> created, added, Check row
  'Ravi Kumar (UK)(Rust Wizard) – Interview – Initrode – 6:00 PM IST – Duration: 60 Mins (2nd Round)-gopi',        // new role -> added, no row
  'Unknown Person (UK)(Java Developer) – Interview – Initrode – 7:00 PM IST – Duration: 60 Mins (1st Round)-gopi', // new candidate -> held
  'Ravi Kumar (UK)(Java Develper) – Interview – Initrode – 8:00 PM IST – Duration: 60 Mins (Final Round)-gopi'     // misspelt role -> added, Check row
].join('\n');

const db = {
  team_members: [{ id: 1, name: 'Gopi Krishna' }],
  clients: [{ id: 10, name: 'Initrode' }],
  candidates: [{ id: 100, name: 'Ravi Kumar', technical_poc_id: 1 }],
  interviews: [{ id: 500, candidate_id: 100, client_id: 10, role: 'Java Developer', round: 'Round 3', interview_date: '2026-01-01', interview_time: '10:00', interview_status: 'Completed' }]
};
const posts = {};
global.fetch = async (url, o = {}) => {
  const res = (status, body) => ({ ok: status < 300, status, text: async () => typeof body === 'string' ? body : JSON.stringify(body) });
  if (url.startsWith('https://docs.google.com/')) return res(200, doc);
  const p = url.replace('http://sb.test/rest/v1/', ''), table = p.split('?')[0];
  if ((o.method || 'GET') === 'GET') return res(200, /offset=([1-9])/.test(p) ? [] : (db[table] || []));
  (posts[table] = posts[table] || []).push(...[].concat(JSON.parse(o.body)));
  if (table.startsWith('interviews')) return res(201, [].concat(JSON.parse(o.body)).map((_, i) => ({ id: 900 + i })));
  if (table === 'clients') return res(201, [{ id: 11, name: JSON.parse(o.body).name }]);
  return res(201, null);
};

test('only a new candidate waits; a new client is created and checked; a misspelt role is checked', async () => {
  const { S } = await runSync(false);
  const review = posts.import_review || [], kinds = review.map(r => r.payload.kind).sort();
  assert.deepEqual(kinds, ['chk', 'chk', 'newc']);
  assert.equal(review.find(r => r.payload.kind === 'newc').payload.hold, '1');
  assert.ok(review.filter(r => r.payload.kind === 'chk').every(r => r.payload.hold === '' && r.payload.iid));   // Check rows never block
  assert.match(review.find(r => /Newco/.test(r.payload.msg)).payload.msg, /New client “Newco Labs” was added/);
  assert.match(review.find(r => /Develper/.test(r.payload.msg)).payload.msg, /looks like “Java Developer”/);
  assert.equal(S.added, 4);
  assert.equal(S.held, 1);
  assert.deepEqual((posts.clients || []).map(c => c.name), ['Newco Labs']);
  const added = posts.interviews || [];
  assert.equal(added.length, 4);
  assert.ok(added.some(x => x.client_id === 11));
  assert.ok(added.some(x => x.role === 'Rust Wizard'));
});
