// API tests for api/_lib/inbox.js with fake MySQL / Supabase. Run: node --test test/
'use strict';
process.env.INTERVIEW_IMPORT_START_DATE = '2026-10-27'; process.env.INBOX_DB_TIMEZONE = 'UTC';
const test = require('node:test'), assert = require('node:assert');
const L = require('../api/_lib/inbox');
const { fixtures, makeDeps } = require('./fake-deps');
const ADMIN = 'Bearer tok-admin-0123456789abcdef', GOPI = 'Bearer tok-gopi-0123456789abcdef';
const req = (query = {}, auth = ADMIN, method = 'GET') => ({ method, query, headers: auth ? { authorization: auth } : {} });
const fetch_ = (D, auth = ADMIN) => L.refresh(req({}, auth, 'POST'), D);
const setup = async () => { const F = fixtures(), x = makeDeps(F); await fetch_(x.D); return { F, ...x } };
const rejects = async (p, status) => { try { await p; assert.fail('expected ' + status) } catch (e) { assert.equal(e.status, status, e.message) } };
const deep = o => JSON.stringify(o);

test('only INTERVIEW/SCHEDULING threads from the start date (00:00 IST) onwards; one row per thread', async () => {
  const { D } = await setup(); const r = await L.list(req({ view: 'all', showPast: '1' }), D);
  const keys = r.rows.map(x => x.thread_key).sort();
  assert.deepEqual(keys, ['1.aa1', '2.bb2', '2.ee5', '3.ff6']);       // dd4 is 23:30 IST on 26 Oct, cc3 is NON_RECRUITER
  assert.equal(new Set(keys).size, keys.length);
});
test('reschedule in a thread overrides the old date; fields + evidence + client match', async () => {
  const { D } = await setup(); const r = await L.list(req({ view: 'all', showPast: '1' }), D), a = r.rows.find(x => x.thread_key == '1.aa1');
  assert.equal(a.date, '2026-11-03'); assert.equal(a.time, '14:00'); assert.equal(a.timezone, 'EST'); assert.equal(a.schedule_status, 'confirmed');
  assert.equal(a.duration_minutes, 45); assert.equal(a.round, 'Round 1'); assert.equal(a.type, 'Hiring Manager');
  assert.equal(a.client_raw, 'Acme Corporation Ltd'); assert.equal(a.client_match, 'Acme Corp');
  assert.equal(a.candidate_name, 'Rohit Kumar'); assert.equal(a.portal_candidate, 'Rohit Kumar'); assert.equal(a.student_email, 'rohit@student.com');
  assert.equal(a.sheet_update_date, '2026-10-27'); assert.equal(a.stage, 'SCHEDULING'); assert.equal(a.emails, 2);
  const b = r.rows.find(x => x.thread_key == '2.bb2'); assert.equal(b.schedule_status, 'options'); assert.ok(b.date_options.length >= 2);
  const e = r.rows.find(x => x.thread_key == '2.ee5'); assert.equal(e.client_match, null); assert.equal(e.client_raw, 'Initrode Inc');   // not auto-created
});
test('past interview dates are hidden unless showPast', async () => {
  const { D } = await setup();
  assert.ok(!(await L.list(req(), D)).rows.some(x => x.thread_key == '2.ee5'));
  assert.ok((await L.list(req({ showPast: '1' }), D)).rows.some(x => x.thread_key == '2.ee5'));
});
test('no credentials or HTML ever leave the server', async () => {
  const { D, F } = await setup();
  const l = await L.list(req({ view: 'all', showPast: '1' }), D), d = await L.detail(req({ id: String(F.messages[1].id) }), D);
  for (const o of [l, d]) { const s = deep(o); assert.ok(!/SECRET-CREDS|SECRET-HTML|creds_json|body_html|token_expiry/.test(s)) }
  assert.ok(d.message.body_plain.includes('first round')); assert.equal(d.thread.length, 2);
});
test('the recruiter database is only read (every statement is a SELECT)', async () => {
  const { D, log, F } = await setup();
  await L.list(req({ view: 'all', q: 'invitation' }), D); await L.detail(req({ id: String(F.messages[1].id) }), D);
  await L.dismiss(req({ id: '1.aa1' }, ADMIN, 'POST'), D); await L.dismiss(req({ id: '1.aa1' }, ADMIN, 'DELETE'), D);
  assert.ok(log.sql.length > 5); log.sql.forEach(s => assert.match(s, /^\s*SELECT\b/i));
  await assert.rejects(L.mysqlQuery('UPDATE recruiter_messages SET subject = 1', []), /read only/);
  await assert.rejects(L.mysqlQuery('SELECT 1; DELETE FROM accounts', []), /read only/);
});
test('detail is 404 for older or non-interview emails', async () => {
  const { D, F } = await setup();
  await rejects(L.detail(req({ id: String(F.messages[0].id) }), D), 404);   // before start date
  await rejects(L.detail(req({ id: String(F.messages[4].id) }), D), 404);   // NON_RECRUITER
  await rejects(L.detail(req({ id: '999999' }), D), 404);
});
test('Technical POC sees only threads of their own candidates', async () => {
  const { D, F } = await setup(); const r = await L.list(req({ view: 'all', showPast: '1' }, GOPI), D);
  assert.deepEqual(r.rows.map(x => x.thread_key), ['1.aa1']);
  await rejects(L.detail(req({ id: String(F.messages[3].id) }, GOPI), D), 404);     // Priya belongs to Kishore
  await rejects(L.dismiss(req({ id: '2.bb2' }, GOPI, 'POST'), D), 404);
});
test('auth: missing / bad token 401, unapproved or not a team member 403', async () => {
  const { D } = await setup();
  await rejects(L.list(req({}, null), D), 401);
  await rejects(L.list(req({}, 'Bearer nope-nope-nope-nope-nope'), D), 401);
  await rejects(L.list(req({}, 'Bearer tok-wait-0123456789abcdef'), D), 403);
  await rejects(L.list(req({}, 'Bearer tok-out-0123456789abcdef'), D), 403);
  await rejects(L.list(req({ diag: '1' }, GOPI), D), 403);
});
test('invalid parameters -> 400', async () => {
  const { D } = await setup();
  for (const q of [{ page: '0' }, { page: 'x' }, { pageSize: '30' }, { pageSize: '1000' }, { stage: 'OFFER' }, { student: 'not-an-email' }, { hasDate: 'yes' },
    { view: 'old' }, { q: 'x'.repeat(201) }, { since: '2020-01-01' }, { from: '2020-01-01' }, { page: ['1', '2'] }])
    await rejects(L.list(req(q), D), 400);
  await rejects(L.detail(req({ id: 'abc' }), D), 400);
  await rejects(L.dismiss(req({ id: 'bad key!' }, ADMIN, 'POST'), D), 400);
});
test('filters: search (full text), student, client, stage, hasDate, pagination', async () => {
  const { D } = await setup(); const g = async q => (await L.list(req({ view: 'all', showPast: '1', ...q }), D));
  assert.deepEqual((await g({ q: 'globex' })).rows.map(r => r.thread_key).sort(), ['2.bb2', '3.ff6']);
  assert.deepEqual((await g({ student: 'priya@student.com' })).rows.map(r => r.thread_key).sort(), ['2.bb2', '2.ee5']);
  assert.deepEqual((await g({ client: 'acme corp' })).rows.map(r => r.thread_key), ['1.aa1']);
  assert.deepEqual((await g({ stage: 'SCHEDULING' })).rows.map(r => r.thread_key).sort(), ['1.aa1', '2.bb2']);
  assert.equal((await g({ hasDate: '1' })).rows.every(r => r.date), true);
  const p = await g({ pageSize: '25', page: '9' }); assert.equal(p.page, 1); assert.equal(p.pages, 1);
});
test('dismiss + undo, and added threads show as Added', async () => {
  const { D, F } = await setup();
  await L.dismiss(req({ id: '1.aa1' }, ADMIN, 'POST'), D);
  assert.ok(!(await L.list(req(), D)).rows.some(r => r.thread_key == '1.aa1'));
  assert.ok((await L.list(req({ view: 'dismissed' }), D)).rows.some(r => r.thread_key == '1.aa1'));
  await L.dismiss(req({ id: '1.aa1' }, ADMIN, 'DELETE'), D);
  assert.ok((await L.list(req(), D)).rows.some(r => r.thread_key == '1.aa1'));
  F.sb.interviews.push({ id: 77, source_account_id: 1, source_thread_id: 'aa1', interview_date: '2026-11-03' });
  const all = await L.list(req({ view: 'all' }), D), a = all.rows.find(r => r.thread_key == '1.aa1');
  assert.deepEqual(a.added, { interview_id: 77, date: '2026-11-03' }); assert.equal(all.counts.added, 1);
  assert.ok(!(await L.list(req(), D)).rows.some(r => r.thread_key == '1.aa1'));       // not in To do any more
});
test('extraction is cached: a second request reads no email bodies; a new email re-extracts only that thread', async () => {
  const { D, log, F } = await setup();
  log.sql.length = 0;
  await L.list(req(), D); assert.equal(log.sql.length, 0);                          // the page reads saved threads only
  await fetch_(D); assert.ok(!log.sql.some(s => /LEFT\(m\.body_plain/.test(s)));  // nothing new: no email bodies read
  F.messages.push({ ...F.messages[3], id: 5000, internal_date: '2026-10-28 05:00:00', body_plain: 'Confirmed: Oct 30 at 2:00 PM IST. See you then.', subject: 'Confirmed' });
  log.sql.length = 0; await fetch_(D); const r = await L.list(req({ view: 'all', showPast: '1' }), D);
  assert.equal(log.sql.filter(s => /LEFT\(m\.body_plain/.test(s)).length, 1);
  const b = r.rows.find(x => x.thread_key == '2.bb2'); assert.equal(b.date, '2026-10-30'); assert.equal(b.schedule_status, 'confirmed');
});
test('IST day boundary: start 00:00 IST = 18:30 UTC the day before', () => {
  assert.equal(L.msToDb(L.istMidnightMs('2026-10-27'), '+00:00'), '2026-10-26 18:30:00');
  assert.equal(L.msToDb(L.istMidnightMs('2026-10-27'), '+05:30'), '2026-10-27 00:00:00');
});
test('client match ignores case and Ltd / Inc / LLC', () => {
  const cl = [{ name: 'Acme Corp' }, { name: 'Globex' }, { name: 'Bank of America' }];
  assert.equal(L.clientMatch('ACME corporation ltd', cl), 'Acme Corp'); assert.equal(L.clientMatch('Globex, Inc.', cl), 'Globex');
  assert.equal(L.clientMatch('Bank of America LLC', cl), 'Bank of America'); assert.equal(L.clientMatch('Initrode', cl), null);
});
test('performance: 600 threads, page size 100 under 2 s (fake DB)', async () => {
  const F = fixtures(); let id = 20000;
  for (let i = 0; i < 600; i++) for (let j = 0; j < 3; j++) F.messages.push({ id: ++id, account_id: 1 + (i % 2), gmail_thread_id: 't' + i, internal_date: `2026-10-${27 + (i % 2)} ${String(5 + j).padStart(2, '0')}:00:00`, classifier_label: j ? 'SCHEDULING' : 'INTERVIEW',
    subject: 'Interview with Globex', to_header: 'x', company: 'Globex', role: 'Dev', body_plain: ('Hi Priya, your interview is on Nov ' + (3 + (i % 20)) + ' at 10:00 AM IST, a 60 minute technical round. ').repeat(40) });
  const { D } = makeDeps(F);
  const run = await fetch_(D); assert.equal(run.pending, 0); assert.ok(run.threads >= 600);       // one fetch catches up (400 per round)
  const t = Date.now(); const r = await L.list(req({ pageSize: '100', page: '2' }), D), ms = Date.now() - t;
  assert.equal(r.rows.length, 100); assert.ok(ms < 2000, ms + ' ms');
});

test('automatic fetch: CRON_SECRET works, a wrong secret / no sign-in is refused, the run is recorded', async () => {
  process.env.CRON_SECRET = 'cron-secret-0123456789-abcdefghij';
  const F = fixtures(), { D } = makeDeps(F);
  assert.equal((await L.list(req(), D)).total, 0);                                     // nothing fetched yet
  const r = await L.refresh(req({}, 'Bearer cron-secret-0123456789-abcdefghij', 'POST'), D);
  assert.equal(r.ok, true); assert.equal(r.by, 'auto (every 4 hours)'); assert.equal(r.threads, 4);
  await rejects(L.refresh(req({}, 'Bearer wrong-secret-0123456789-abcdefghij', 'POST'), D), 401);
  await rejects(L.refresh(req({}, null, 'POST'), D), 401);
  await rejects(L.refresh(req({ x: '1' }, ADMIN, 'POST'), D), 400);
  const l = await L.list(req(), D); assert.equal(l.last_fetch.by, 'auto (every 4 hours)'); assert.ok(l.total > 0);
  const g = await L.refresh(req({}, GOPI, 'POST'), D); assert.equal(g.by, 'gopi@x.com');   // "Fetch now" by a POC
  delete process.env.CRON_SECRET;
});
