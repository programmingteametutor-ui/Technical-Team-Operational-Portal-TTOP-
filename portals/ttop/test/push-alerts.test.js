// Phone alarms (api/_lib/push.js): call in 10 min, no Tool Drive within the hour, reminders; repeats, Got it / Snooze,
// signed tokens, and the same-name Tool Drive rule. Run: npm test
'use strict';
const test = require('node:test'), assert = require('node:assert');
const P = require('../api/_lib/push');

const NOW = Date.parse('2026-11-20T09:50:00+05:30');   // 9:50 AM IST
const team = [{ id: 1, name: 'Gopi Krishna', email: 'gopi@x.test', is_technical_poc: true }, { id: 2, name: 'Kishore Rao', email: 'kishore@x.test', is_technical_poc: true }, { id: 3, name: 'Vamsi Reddy', email: 'vamsi@x.test', is_technical_poc: false }];
const profiles = [{ id: 'u-gopi', email: 'GOPI@x.test', approved: true }, { id: 'u-kish', email: 'kishore@x.test', approved: true }, { id: 'u-vam', email: 'vamsi@x.test', approved: false }];
const cands = [{ id: 7, name: 'Ravi Kumar', technical_poc_id: 2 }, { id: 8, name: 'Sita Rao', technical_poc_id: 1 }, { id: 9, name: 'Other Student', technical_poc_id: null }];
let n = 0;
const iv = o => ({ id: ++n, candidate_id: 7, interview_date: '2026-11-20', interview_time: '10:00:00', round: 'Round 2', is_technical: false, interview_status: 'Scheduled', tool_drive: 'Gopi', client: 'Initrode', ...o });
const due = (interviews, o = {}) => P.due({ now: o.now || NOW, interviews, cands, team, profiles, reminders: o.reminders || [] });
const SECRET = 'cron-secret-xyz';

test('startMs: IST, and a call before 06:00 belongs to the next calendar day of its list', () => {
  assert.equal(P.startMs('2026-11-20', '10:00:00'), Date.parse('2026-11-20T04:30:00Z'));
  assert.equal(P.startMs('2026-11-20', '01:30'), Date.parse('2026-11-21T01:30:00+05:30'));
  assert.ok(Number.isNaN(P.startMs('', '10:00')));
});

test('call10: technical calls starting within 10 minutes -> Tool Drive and POC, once each', () => {
  const a = iv({}), b = iv({ round: 'Round 1' }), c = iv({ round: 'Round 1', is_technical: true, interview_time: '09:55' }),
    d = iv({ interview_time: '10:30' }), e = iv({ interview_status: 'Cancelled' }), f = iv({ candidate_id: 8, tool_drive: 'Gopi Krishna' });
  const L = due([a, b, c, d, e, f]).filter(x => x.kind == 'call10');
  assert.deepEqual(L.map(x => +x.ref.split('@')[0]), [a.id, c.id, f.id]);     // not: non-technical 1st round, 40 min away, cancelled
  assert.deepEqual(L[0].users.sort(), ['u-gopi', 'u-kish']);                    // Tool Drive Gopi + POC Kishore
  assert.deepEqual(L[2].users, ['u-gopi']);                                     // Gopi is both: one alarm
  assert.equal(L[0].payload.title, 'Technical call in 10 min');
  assert.equal(L[0].payload.body, 'Ravi Kumar · Initrode · Round 2 · 10:00 AM');
  assert.equal(L[0].payload.url, '/#i' + a.id);
  assert.equal(L[0].first, true);
});

test('same first name in another team: "Gopi" on a student with no POC from our team rings nobody', () => {
  const o = iv({ candidate_id: 9, tool_drive: 'Gopi' });
  assert.equal(due([o]).length, 0);
  const full = iv({ candidate_id: 9, tool_drive: 'Gopi Krishna' });              // the full name always counts
  assert.deepEqual(due([full]).find(x => x.kind == 'call10').users, ['u-gopi']);
});

test('notd: a technical call within 60 minutes with no Tool Drive -> the candidate\'s POC', () => {
  const a = iv({ tool_drive: '', interview_time: '10:40' }), b = iv({ tool_drive: '', interview_time: '11:00' }), c = iv({ tool_drive: '', candidate_id: 9, interview_time: '10:20' });
  const L = due([a, b, c]);
  assert.deepEqual(L.map(x => [x.kind, +x.ref.split('@')[0], x.users.join()]), [['notd', a.id, 'u-kish']]);   // b is 70 min away; c has no POC
  assert.match(L[0].payload.title, /^No Tool Drive · call in 50 min$/);
});

test('reminders: due now -> the owner; a reminder due long ago never starts an alarm', () => {
  const R = [{ id: 1, owner: 'u-x', due_at: '2026-11-20T09:45:00+05:30', note: 'Call Ravi back', done: false },
    { id: 2, owner: 'u-x', due_at: '2026-11-20T09:10:00+05:30', note: 'old', done: false },
    { id: 3, owner: 'u-x', due_at: '2026-11-20T10:10:00+05:30', note: 'later', done: false },
    { id: 4, owner: 'u-x', due_at: '2026-11-20T09:49:00+05:30', note: 'done', done: true }];
  const L = due([], { reminders: R });
  assert.deepEqual(L.map(x => [x.kind, x.users[0], x.payload.body, x.first]), [['rem', 'u-x', 'Call Ravi back', true]]);
});

test('shouldSend: at most 3 times, 5 minutes apart; Got it stops it; Snooze waits 5 minutes', () => {
  const a = { first: true }, late = { first: false }, at = m => new Date(NOW - m * 60e3).toISOString();
  assert.equal(P.shouldSend(a, null, null, NOW), true);
  assert.equal(P.shouldSend(late, null, null, NOW), false);                   // never start late
  assert.equal(P.shouldSend(late, { n: 1, last_at: at(5) }, null, NOW), true); // but a started alarm repeats
  assert.equal(P.shouldSend(a, { n: 1, last_at: at(2) }, null, NOW), false);   // too soon
  assert.equal(P.shouldSend(a, { n: 2, last_at: at(5) }, null, NOW), true);
  assert.equal(P.shouldSend(a, { n: 3, last_at: at(30) }, null, NOW), false);  // 3 is the most
  assert.equal(P.shouldSend(a, { n: 1, last_at: at(5) }, { action: 'ack' }, NOW), false);
  assert.equal(P.shouldSend(a, { n: 1, last_at: at(5) }, { action: 'snooze', until: new Date(NOW + 60e3).toISOString() }, NOW), false);
  assert.equal(P.shouldSend(a, { n: 1, last_at: at(9) }, { action: 'snooze', until: new Date(NOW - 60e3).toISOString() }, NOW), true);
});

test('signed token: valid, tampered, wrong secret, expired', () => {
  const t = P.sign(SECRET, { k: 'call10', r: '5@2026-11-20T10:00', u: 'u-gopi', e: NOW + 60e3 });
  assert.deepEqual(P.verify(SECRET, t, NOW).u, 'u-gopi');
  assert.equal(P.verify(SECRET, t.replace(/^./, c => c == 'e' ? 'f' : 'e'), NOW), null);
  assert.equal(P.verify('other-secret', t, NOW), null);
  assert.equal(P.verify(SECRET, t, NOW + 120e3), null);
  assert.equal(P.verify(SECRET, 'garbage', NOW), null);
});

function deps(o = {}) {
  const calls = [], sentTo = [], sends = o.sends || [], acks = o.acks || [];
  const D = {
    now: () => o.now || NOW, vapid: o.novapid ? null : { pub: 'p', priv: 'k' },
    sbUser: async t => t == 'tok-user-0123456789abcdef' ? { id: 'u-gopi' } : null,
    sbAll: async t => t == 'interviews' ? [iv({ id: 500 }), iv({ id: 501, round: 'Round 1' })].map(i => ({ ...i, client: { name: 'Initrode' } })) : t == 'team_members' ? team : profiles,
    sb: async (path, opt = {}) => {
      calls.push([opt.method || 'GET', path, opt.body]);
      if (path.startsWith('profiles?')) return [{ approved: true }];
      if (path.startsWith('reminders?')) return [];
      if (path.startsWith('candidates?')) return cands;
      if (path.startsWith('push_sends?select')) return sends;
      if (path.startsWith('push_ack?select')) return acks;
      if (path.startsWith('push_subscriptions?select')) return [{ id: 1, user_id: 'u-gopi', endpoint: 'e1', p256dh: 'a', auth: 'b', alarm: true }, { id: 2, user_id: 'u-kish', endpoint: 'e2', p256dh: 'a', auth: 'b', alarm: false }, { id: 3, user_id: 'u-kish', endpoint: 'gone', p256dh: 'a', auth: 'b', alarm: true }];
      return null;
    },
    send: async (sub, body) => { if (sub.endpoint == 'gone') { const e = new Error('gone'); e.statusCode = 410; throw e } sentTo.push([sub.endpoint, JSON.parse(body)]) },
  };
  return { D, calls, sentTo };
}
const req = (tok, body) => ({ method: 'POST', headers: tok ? { authorization: 'Bearer ' + tok } : {}, body: body || {} });

test('cron run: first alarm to every device, records the send first, removes dead devices; alarm payload', async () => {
  process.env.CRON_SECRET = SECRET;
  const { D, calls, sentTo } = deps();
  const r = await P.handle(req(SECRET), D);
  assert.deepEqual([r.alarms, r.sent, r.removed], [2, 2, 1]);                    // Gopi (TD) + Kishore (POC); one dead device
  assert.deepEqual(sentTo.map(x => x[0]).sort(), ['e1', 'e2']);
  const p = sentTo[0][1];
  assert.equal(p.alarm, true); assert.equal(p.requireInteraction, true); assert.deepEqual(p.actions.map(a => a.action), ['ack', 'snooze']);
  assert.ok(P.verify(SECRET, p.tok, NOW));
  const firstSend = calls.findIndex(c => c[1].startsWith('push_sends?on_conflict') && c[0] == 'POST');
  assert.ok(firstSend >= 0 && calls[firstSend][2].n == 1);
  assert.ok(calls.some(c => c[0] == 'DELETE' && c[1] == 'push_subscriptions?id=in.(3)'));
});

test('cron run: a repeat goes only to devices with alarms on; Got it stops it; 3 sends is the most', async () => {
  process.env.CRON_SECRET = SECRET;
  const ref = '500@2026-11-20T10:00', last = new Date(NOW - 5 * 60e3).toISOString();
  const rep = deps({ sends: [{ kind: 'call10', ref, user_id: 'u-gopi', n: 1, last_at: last }, { kind: 'call10', ref, user_id: 'u-kish', n: 1, last_at: last }] });
  await P.handle(req(SECRET), rep.D);
  assert.deepEqual(rep.sentTo.map(x => x[0]), ['e1']);                          // Kishore's e2 has alarms off: no repeat
  assert.equal(rep.sentTo[0][1].repeat, 1);
  const acked = deps({ sends: [{ kind: 'call10', ref, user_id: 'u-gopi', n: 1, last_at: last }], acks: [{ kind: 'call10', ref, user_id: 'u-gopi', action: 'ack' }] });
  await P.handle(req(SECRET), acked.D);
  assert.ok(!acked.sentTo.some(x => x[0] == 'e1'));
  const max = deps({ sends: [{ kind: 'call10', ref, user_id: 'u-gopi', n: 3, last_at: last }, { kind: 'call10', ref, user_id: 'u-kish', n: 3, last_at: last }] });
  assert.equal((await P.handle(req(SECRET), max.D)).sent, 0);
});

test('Got it / Snooze from the notification: signed token, no session; bad token -> 401', async () => {
  process.env.CRON_SECRET = SECRET;
  const { D, calls } = deps();
  const tok = P.sign(SECRET, { k: 'call10', r: '500@2026-11-20T10:00', u: 'u-gopi', e: NOW + 60e3 });
  assert.deepEqual(await P.handle(req(null, { ack: tok, action: 'snooze' }), D), { ok: true, action: 'snooze' });
  const w = calls.find(c => c[1].startsWith('push_ack?on_conflict'));
  assert.equal(w[2].user_id, 'u-gopi'); assert.equal(w[2].action, 'snooze'); assert.equal(w[2].until, new Date(NOW + 5 * 60e3).toISOString());
  assert.equal((await P.handle(req(null, { ack: tok }), D)).action, 'ack');
  await assert.rejects(P.handle(req(null, { ack: tok + 'x' }), D), e => e.status == 401);
  await assert.rejects(P.handle(req(null, { ack: tok }), deps({ now: NOW + 7 * 3600e3 }).D), e => e.status == 401);
});

test('401 / 503 / test alert and test alarm for a signed-in user', async () => {
  process.env.CRON_SECRET = SECRET;
  await assert.rejects(P.handle(req(null), deps().D), e => e.status == 401);
  await assert.rejects(P.handle(req(SECRET), deps({ novapid: true }).D), e => e.status == 503);
  await assert.rejects(P.handle({ method: 'GET', headers: {} }, deps().D), e => e.status == 405);
  const t = deps(), tr = await P.handle(req('tok-user-0123456789abcdef', { test: true }), t.D);
  assert.equal(tr.ok, true); assert.ok(t.sentTo.every(x => x[1].title == 'TTOP alerts are on ✓' && !x[1].alarm));
  const a = deps(); await P.handle(req('tok-user-0123456789abcdef', { test: 'alarm' }), a.D);
  assert.ok(a.sentTo.every(x => x[1].alarm && x[1].requireInteraction && P.verify(SECRET, x[1].tok, NOW)));
});
