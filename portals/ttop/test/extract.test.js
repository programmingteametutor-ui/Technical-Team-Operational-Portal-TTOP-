// Unit tests for the email extraction (api/_lib/extract.js). Run: node --test test/
'use strict';
const test = require('node:test'), assert = require('node:assert');
const { extractMessage, mergeThread } = require('../api/_lib/extract');
const ex = (subject, body, date = '2026-10-27 10:00:00', extra = {}) => extractMessage({ id: 1, subject, body, internal_date: date, to_header: '', ...extra });

test('calendar-invite subject: date, time range, timezone, duration, type', () => {
  const r = ex('Invitation: Technical Interview - Initrode @ Wed Oct 28, 2026 2:30pm - 3:15pm (IST) (priya@gmail.com)', 'Join with Google Meet');
  assert.equal(r.date, '2026-10-28'); assert.equal(r.time, '14:30'); assert.equal(r.timezone, 'IST');
  assert.equal(r.duration_minutes, 45); assert.equal(r.type, 'Technical');
});
test('"tomorrow" uses the email date', () => {
  const r = ex('Interview tomorrow', 'Hi Sam, see you tomorrow at 11am IST for the interview.');
  assert.equal(r.date, '2026-10-28'); assert.equal(r.time, '11:00'); assert.equal(r.timezone, 'IST');
});
test('"Monday, November 2nd at 1:00 PM EST"', () => {
  const r = ex('Interview', 'Your interview is on Monday, November 2nd at 1:00 PM EST.');
  assert.equal(r.date, '2026-11-02'); assert.equal(r.time, '13:00'); assert.equal(r.timezone, 'EST');
});
test('"2:30pm - 3:15pm (IST)" range gives time + 45 min', () => {
  const r = ex('Interview call', 'Scheduled for Oct 30, 2:30pm - 3:15pm (IST) on Teams.');
  assert.equal(r.time, '14:30'); assert.equal(r.timezone, 'IST'); assert.equal(r.duration_minutes, 45);
});
test('several offered slots -> options, first slot pre-filled', () => {
  const r = ex('Scheduling', 'Please let me know which of the following times works best for a call:\n- Oct 29 at 10:00 AM IST\n- Oct 30 at 2:00 PM IST');
  assert.equal(r.schedule_status, 'options'); assert.equal(r.date, '2026-10-29'); assert.equal(r.time, '10:00');
  assert.ok(r.date_options.length >= 2); assert.ok(r.date_options.some(o => o.date == '2026-10-30' && o.time == '14:00'));
});
test('quoted replies are ignored', () => {
  const r = ex('Re: interview', 'Confirmed for November 3rd at 2:00 PM EST.\n\nOn Mon, Oct 26, 2026 at 10:00 AM Recruiter wrote:\n> November 20th at 5:00 PM EST');
  assert.equal(r.date, '2026-11-03');
});
test('application / deadline dates are ignored', () => {
  const r = ex('Your application', 'Your application was submitted on October 27. Thanks for applying.');
  assert.equal(r.date, null);
});
test('"10 minutes before" is not a duration', () => {
  const r = ex('Interview', 'Interview on Oct 30 at 10am IST. Please join 10 minutes before.');
  assert.equal(r.duration_minutes, null);
});
test('candidate name from the To line ("Kumar, Rohit" -> Rohit Kumar), then "Candidate:", then greeting', () => {
  assert.equal(ex('x', 'Hi there', undefined, { to_header: '"Kumar, Rohit" <r@gmail.com>', mailbox: 'r@gmail.com' }).candidate_name, 'Rohit Kumar');
  assert.equal(ex('x', 'Candidate: Priya Sharma\nhello').candidate_name, 'Priya Sharma');
  assert.equal(ex('x', 'Hi Rohit,\nthanks').candidate_name, 'Rohit');
  assert.equal(ex('x', 'Hi there,\nthanks').candidate_name, null);
});
test('round and type', () => {
  const r = ex('Final round interview', 'This is the final round with the hiring manager.');
  assert.equal(r.round, 'Final Round'); assert.equal(r.type, 'Hiring Manager');
  assert.equal(ex('x', 'Invite to your second round interview').round, 'Round 2');
});
test('nothing is invented: an email with no details gives nulls', () => {
  const r = ex('Hello', 'Thanks for your interest.');
  for (const k of ['date', 'time', 'timezone', 'duration_minutes', 'round', 'type', 'candidate_name']) assert.equal(r[k], null, k);
});
test('mergeThread: newest non-empty value wins (reschedule overrides the old date)', () => {
  const msgs = [
    { id: 2, subject: 'Updated invitation', body: 'Rescheduled and confirmed for Tuesday, November 3rd at 2:00 PM EST.', internal_date: '2026-10-27 14:30:00', role: 'Data Analyst' },
    { id: 1, subject: 'Interview invitation', body: 'First round on Monday, November 2nd at 1:00 PM EST. 45 minute call.', internal_date: '2026-10-27 00:15:00', role: 'Data Analyst', company: 'Acme' },
  ];
  const t = mergeThread(msgs, msgs[0].internal_date);
  assert.equal(t.date, '2026-11-03'); assert.equal(t.time, '14:00'); assert.equal(t.duration_minutes, 45); assert.equal(t.round, 'Round 1');
  assert.equal(t.client, 'Acme'); assert.equal(t.sheet_update_date, '2026-10-27'); assert.equal(t.sources.date, 2);
});
