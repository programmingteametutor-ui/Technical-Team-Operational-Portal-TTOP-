// Unit tests for the pure helpers in index.html (the block between /* core:start */ and /* core:end */). Run: npm test
'use strict';
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const src = html.slice(html.indexOf('/* core:start */'), html.indexOf('/* core:end */'));
const CORE = new Function(src + '\nreturn CORE;')();

const T = '2026-11-20';
let n = 0;
const iv = o => ({ id: ++n, cand: 'Ravi Kumar', client: 'Initrode', role: 'Java Developer', date: T, time: '10:00', dur: '60 Minutes', round: 'Round 1', status: 'Completed', placement: '—', td: '', feedback: '', ...o });

test('dates: days and addD across month ends', () => {
  assert.equal(CORE.days('2026-10-30', '2026-11-02'), 3);
  assert.equal(CORE.addD('2026-12-31', 1), '2027-01-01');
  assert.equal(CORE.addD('2026-11-01', -1), '2026-10-31');
});

test('stuck: quiet 14+ days and after Round 2+ 5+ days', () => {
  const L = [
    iv({ cand: 'A One', date: '2026-11-01' }),                          // 19 days, Round 1 -> quiet
    iv({ cand: 'B Two', date: '2026-11-14', round: 'Round 2' }),        // 6 days, Round 2 -> adv
    iv({ cand: 'C Three', date: '2026-11-17', round: 'Final' }),        // 3 days -> not yet
    iv({ cand: 'D Four', date: '2026-11-10' }),                         // 10 days, Round 1 -> not yet
  ];
  const s = CORE.stuck(L, T);
  assert.deepEqual(s.map(x => x.cand), ['B Two', 'A One']);
  assert.equal(s[0].adv, true); assert.equal(s[1].quiet, true); assert.equal(s[1].days, 19);
});

test('stuck: not stuck when placed, rejected, cancelled, booked ahead, date pending or a closer', () => {
  const L = [
    iv({ cand: 'P', date: '2026-10-01', placement: 'Placed' }),
    iv({ cand: 'R', date: '2026-10-01', placement: 'Rejected' }),
    iv({ cand: 'X', date: '2026-10-01', status: 'Cancelled' }),
    iv({ cand: 'N', date: '2026-10-01' }), iv({ cand: 'N', date: '2026-11-25', status: 'Scheduled', round: 'Round 2' }),
    iv({ cand: 'Q', date: '2026-10-01' }), iv({ cand: 'Q', date: '', status: 'Date Pending' }),
    iv({ cand: 'K', date: '2026-10-01' }),
  ];
  assert.deepEqual(CORE.stuck(L, T, new Set(['k'])), []);
});

test('stuck: a rescheduled call does not count as the last one', () => {
  const L = [iv({ cand: 'Z', date: '2026-11-01' }), iv({ cand: 'Z', date: '2026-11-18', status: 'Rescheduled' })];
  assert.equal(CORE.stuck(L, T)[0].days, 19);
});

test('clashes: overlap uses duration; back-to-back is fine', () => {
  const a = iv({ td: 'Gopi', time: '10:00', dur: '60 Minutes' }), b = iv({ td: 'gopi', time: '10:30' }), c = iv({ td: 'Gopi', time: '11:30' }), d = iv({ td: 'Kishore', time: '10:15' });
  const r = CORE.clashes([a, b, c, d]);
  assert.equal(r.length, 1);                       // a-b only: b runs 10:30-11:30 and c starts at 11:30 (back-to-back); Kishore is someone else
  assert.equal(r[0].a, a); assert.equal(r[0].b, b);
});
test('clashes: back-to-back exactly is not a clash', () => {
  const a = iv({ td: 'Gopi', time: '10:00', dur: '60 Minutes' }), b = iv({ td: 'Gopi', time: '11:00' });
  assert.equal(CORE.clashes([a, b]).length, 0);
});
test('clashes: a 1:30 AM call belongs to the end of the list day; cancelled calls ignored', () => {
  const a = iv({ td: 'Gopi', time: '23:30', dur: '60 Minutes' }), b = iv({ td: 'Gopi', time: '00:15' }), c = iv({ td: 'Gopi', time: '23:45', status: 'Cancelled' }), e = iv({ td: 'Gopi', time: '09:00' });
  const r = CORE.clashes([e, a, b, c]);
  assert.equal(r.length, 1); assert.equal(r[0].a, a); assert.equal(r[0].b, b);
});

test('funnel: conversion, pass rate, average days, active', () => {
  const L = [
    iv({ cand: 'A', date: '2026-10-01' }), iv({ cand: 'A', date: '2026-10-05', round: 'Round 2' }), iv({ cand: 'A', date: '2026-10-11', round: 'Final', placement: 'Placed' }),
    iv({ cand: 'B', date: '2026-10-01' }), iv({ cand: 'B', date: '2026-10-08', round: 'Round 2', placement: 'Rejected' }),
    iv({ cand: 'C', date: '2026-11-15' }),
    iv({ cand: 'D', date: '2026-11-01', status: 'Cancelled' }),
  ];
  const f = CORE.funnel(L, T);
  assert.equal(f.r1, 3); assert.equal(f.r2, 2); assert.equal(f.fin, 1); assert.equal(f.pl, 1);
  assert.equal(f.c12, 67); assert.equal(f.c2f, 50); assert.equal(f.cfp, 100);
  assert.equal(f.passN, 4); assert.equal(f.failN, 1); assert.equal(f.pass, 80);
  assert.equal(f.avgDays, 10); assert.equal(f.act, 1);
});

test('listDiff: matched, different, missing, extra', () => {
  const app = [
    iv({ cand: 'Ravi Kumar', client: 'Initrode', time: '10:00', round: 'Round 1' }),
    iv({ cand: 'Sita Rao', client: 'Globex', time: '14:00', round: 'Round 1' }),
    iv({ cand: 'Old Call', client: 'Acme', time: '09:00' }),
  ];
  const list = [
    { cand: 'Kumar Ravi', client: 'initrode', time: '10:00', round: 'Round 1', role: '' },
    { cand: 'Sita Rao', client: 'Globex', time: '15:00', round: 'Round 2', role: '' },
    { cand: 'New Person', client: 'Umbrella', time: '11:00', round: '', role: '' },
  ];
  const r = CORE.listDiff(list, app);
  assert.equal(r.matched.length, 1);
  assert.equal(r.different.length, 1); assert.deepEqual(r.different[0].d.map(d => d[0]), ['time', 'round']);
  assert.deepEqual(r.missing.map(x => x.cand), ['New Person']);
  assert.deepEqual(r.extra.map(x => x.cand), ['Old Call']);
});

test('eodText: done with results, not updated, tomorrow, open items', () => {
  const day = [iv({ cand: 'A', status: 'Completed', placement: 'Placed', round: 'Final' }), iv({ cand: 'B', status: 'Completed', feedback: 'Strong on Java\nmore' }), iv({ cand: 'C', status: 'Scheduled', td: 'Gopi' }), iv({ cand: 'D', status: 'Cancelled' })];
  const tmr = [iv({ cand: 'E', date: '2026-11-21', status: 'Scheduled', td: '' })];
  const t = CORE.eodText(T, day, tmr, { owe: 2, stuck: 1 });
  assert.match(t, /Technical calls: 3 · Done: 2 · Not updated: 1 · Cancelled: 1/);
  assert.match(t, /A · Initrode · Final → Placed/);
  assert.match(t, /B · Initrode · Round 1 → Strong on Java$/m);
  assert.match(t, /C · Initrode · Round 1 \(TD Gopi\)/);
  assert.match(t, /Tomorrow \(2026-11-21\): 1 technical call/);
  assert.match(t, /1 call tomorrow with no Tool Drive/);
  assert.match(t, /2 past calls not updated/); assert.match(t, /1 stuck candidate$/m);
});

test('suggestTD: same client first, then similar role, ties by lighter load', () => {
  const i = iv({ id: 999, client: 'Initrode', role: 'Java Backend Developer', date: '2026-11-21', status: 'Scheduled' });
  const hist = [
    iv({ td: 'Gopi', client: 'Initrode', date: '2026-11-01' }), iv({ td: 'Gopi', client: 'Initrode', date: '2026-11-05' }),
    iv({ td: 'Kishore', client: 'Globex', role: 'Java Engineer', date: '2026-11-10' }),
    iv({ td: 'Vamsi', client: 'Acme', role: 'Python', date: '2026-11-10' }),
    iv({ td: 'Gopi', date: '2026-11-21', status: 'Scheduled', client: 'Acme' }),
  ];
  const s = CORE.suggestTD(i, hist, T);
  assert.deepEqual(s.map(x => x.name), ['Gopi', 'Kishore']);
  assert.equal(s[0].client, 2); assert.equal(s[0].load, 1); assert.equal(s[1].role, 1);
});
