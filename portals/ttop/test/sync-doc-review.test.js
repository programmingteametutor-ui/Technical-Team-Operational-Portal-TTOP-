// Doc sync: no Import Review. Every line is added directly to Interviews. A new candidate or client
// is created; a new role, a role that looks like a misspelt existing one, or a round that already
// exists is flagged on the interview itself (import_check), and TTOP shows it on the card.
// Run: npm test
'use strict';
const test = require('node:test'), assert = require('node:assert');
process.env.SUPABASE_URL = 'http://sb.test'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
const { runSync } = require('../api/sync-doc');

// today in India, so the lines are not "old"
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() + 2 * 86400e3));
const [y, m, d] = today.split('-').map(Number);
const head = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric' }) + ' (' + new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long' }) + ')';
const doc = [head,
  'Ravi Kumar (UK)(Java Developer) – Interview – Initrode – 4:00 PM IST – Duration: 60 Mins (1st Round)-gopi',      // all known -> added, nothing to check
  'Ravi Kumar (UK)(Java Developer) – Interview – Newco Labs – 5:00 PM IST – Duration: 60 Mins (1st Round)-gopi',   // new client -> created, flagged
  'Ravi Kumar (UK)(Rust Wizard) – Interview – Initrode – 6:00 PM IST – Duration: 60 Mins (2nd Round)-gopi',        // new role -> flagged
  'Unknown Person (UK)(Java Developer) – Interview – Initrode – 7:00 PM IST – Duration: 60 Mins (1st Round)-gopi', // new candidate -> created, flagged
  'Ravi Kumar (UK)(Java Develper) – Interview – Initrode – 8:00 PM IST – Duration: 60 Mins (Final Round)-gopi',    // misspelt role -> flagged with the existing role
  'Ravi Kumar (UK)(Java Developer) – Interview – Initrode – 9:00 PM IST – Duration: 60 Mins (3rd Round)-gopi'      // same round exists -> added, flagged dupe
].join('\n');

const db = {
  team_members: [{ id: 1, name: 'Gopi Krishna' }],
  clients: [{ id: 10, name: 'Initrode' }],
  candidates: [{ id: 100, name: 'Ravi Kumar', technical_poc_id: 1 }],
  interviews: [{ id: 500, candidate_id: 100, client_id: 10, role: 'Java Developer', round: 'Round 3', interview_date: '2026-01-01', interview_time: '10:00', interview_status: 'Completed' }]
};
const posts = {};
let nextId = 900;
global.fetch = async (url, o = {}) => {
  const res = (status, body) => ({ ok: status < 300, status, text: async () => typeof body === 'string' ? body : JSON.stringify(body) });
  if (url.startsWith('https://docs.google.com/')) return res(200, doc);
  const p = url.replace('http://sb.test/rest/v1/', ''), table = p.split('?')[0];
  if ((o.method || 'GET') === 'GET') return res(200, /offset=([1-9])/.test(p) ? [] : (db[table] || []));
  (posts[table] = posts[table] || []).push(...[].concat(JSON.parse(o.body)));
  if (table.startsWith('interviews')) return res(201, [].concat(JSON.parse(o.body)).map(() => ({ id: nextId++ })));
  if (table === 'clients') return res(201, [{ id: 11, name: JSON.parse(o.body).name }]);
  if (table === 'candidates') return res(201, [{ id: 101, ...JSON.parse(o.body) }]);
  return res(201, null);
};

test('every line is added directly; new candidate / client / role and same round are flagged on the interview', async () => {
  const { S } = await runSync(false);
  assert.equal(posts.import_review, undefined);                                   // nothing goes to Import Review
  assert.equal(S.added, 6);
  assert.equal(S.newCands, 1);
  assert.deepEqual((posts.candidates || []).map(c => [c.name, c.technical_poc_id]), [['Unknown Person', 1]]);
  assert.deepEqual((posts.clients || []).map(c => c.name), ['Newco Labs']);
  const added = posts.interviews || [], at = t => added.find(x => x.interview_time === t);
  assert.equal(added.length, 6);
  assert.equal(at('16:00').import_check, undefined);                              // all known: nothing to check
  assert.equal(at('17:00').import_check.newClient, true);
  assert.equal(at('17:00').client_id, 11);
  assert.equal(at('18:00').import_check.newRole, true);
  assert.equal(at('19:00').import_check.newCandidate, true);
  assert.equal(at('19:00').candidate_id, 101);
  assert.equal(at('20:00').import_check.role, 'Java Developer');
  assert.equal(at('21:00').import_check.dupe, 500);
  assert.equal(at('21:00').rescheduled_from, null);                               // separate interview until someone says reschedule
  assert.ok(added.filter(x => x.import_check).every(x => x.import_check.src === 'Google Doc'));
  assert.equal(S.review, 5);                                                       // 5 cards ask for a check
});
