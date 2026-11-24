// Phone alarms. pg_cron calls POST /api/push-alerts every 5 minutes with CRON_SECRET.
//   call10  a technical call (Round 2+, or a 1st round marked technical) starting in 10 minutes -> its Tool Drive and
//           the candidate's Technical POC (a person who is both gets one alarm)
//   notd    a technical call within 60 minutes with NO Tool Drive -> the candidate's Technical POC
//   rem     a reminder that is due -> its owner
// An alarm repeats every 5 minutes, at most 3 times, until "Got it" (Snooze 5 min waits). The first alarm goes to every
// device of the person; repeats only to devices with "Alarms on this device" switched on. Each alarm carries a signed
// token (HMAC with CRON_SECRET), so the Got it / Snooze buttons work from the notification without signing in.
// A signed-in user can POST {test:true} or {test:'alarm'} to send a test to their own devices.
// Env: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:...), CRON_SECRET
'use strict';
const crypto = require('crypto');

class HttpError extends Error { constructor(status, message) { super(message); this.status = status } }

const MAX_SENDS = 3, GAP_MS = 4.5 * 60e3, SNOOZE_MS = 5 * 60e3, TOKEN_MS = 6 * 3600e3;
const sp = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
const pad = n => String(n).padStart(2, '0');
// when a call really starts (ms): a call before 06:00 belongs to the NEXT calendar day of its list date
function startMs(date, time) {
  const t = String(time || '').slice(0, 5); if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(t)) return NaN;
  let ms = Date.parse(date + 'T' + t + ':00+05:30'); if (t < '06:00') ms += 864e5; return ms;
}
const istDate = ms => new Date(ms + 5.5 * 3600e3).toISOString().slice(0, 10);
const tm12 = t => { const [h, m] = String(t).slice(0, 5).split(':').map(Number); return ((h % 12) || 12) + ':' + pad(m) + (h >= 12 ? ' PM' : ' AM') };
const isTech = i => i.round != 'Round 1' || !!i.is_technical;

// The same Tool Drive rule as the page (CORE.tdIs in index.html): the full name always counts; a one-word first name
// counts only when exactly one team member has that first name AND the candidate's Technical POC is one of our
// Technical POCs (other teams have people with the same first names).
function tdIs(td, name, team, candPoc) {
  const a = sp(td), b = sp(name); if (!a || !b) return false; if (a == b) return true; if (a.includes(' ')) return false;
  if (a != b.split(' ')[0]) return false; const T = team || [];
  if (T.filter(t => sp(t.name).split(' ')[0] == a).length != 1) return false;
  const p = sp(candPoc); return !!p && T.some(t => (t.is_technical_poc || t.poc) && sp(t.name) == p);
}
const tdMember = (td, team, candPoc) => (team || []).find(t => tdIs(td, t.name, team, candPoc)) || null;

// ---- signed token for Got it / Snooze ----
const b64u = s => Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = s => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString();
const hmac = (secret, s) => crypto.createHmac('sha256', secret).update(s).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function sign(secret, o) { const body = b64u(JSON.stringify(o)); return body + '.' + hmac(secret, body) }
function verify(secret, tok, now) {
  const [body, sig] = String(tok || '').split('.'); if (!secret || !body || !sig) return null;
  const want = hmac(secret, body), a = Buffer.from(sig), b = Buffer.from(want);
  if (a.length != b.length || !crypto.timingSafeEqual(a, b)) return null;
  let o; try { o = JSON.parse(unb64u(body)) } catch (e) { return null }
  return o && o.k && o.r && o.u && +o.e > now ? o : null;
}

// Pure: which alarms apply now. Returns [{kind, ref, users:[uid], payload, first}]
function due({ now, interviews, cands, team, profiles, reminders }) {
  const out = [], uidByEmail = {}, memberById = {}, candById = {};
  profiles.forEach(p => { if (p.approved && !p.removed && p.email) uidByEmail[String(p.email).toLowerCase()] = p.id });
  team.forEach(t => { memberById[t.id] = t });
  cands.forEach(c => { candById[c.id] = c });
  const uidOf = m => m && m.email ? uidByEmail[String(m.email).toLowerCase()] || null : null;
  interviews.forEach(i => {
    if (i.interview_status != 'Scheduled' || !isTech(i)) return;
    const s = startMs(i.interview_date, i.interview_time), mins = Math.round((s - now) / 6e4);
    if (Number.isNaN(mins)) return;
    const c = candById[i.candidate_id] || {}, pocM = memberById[c.technical_poc_id], pocName = pocM ? pocM.name : '';
    const ref = i.id + '@' + i.interview_date + 'T' + String(i.interview_time).slice(0, 5), body = [c.name, i.client, i.round, tm12(i.interview_time)].filter(Boolean).join(' · ');
    const noTd = !String(i.tool_drive || '').trim();
    // call10: first alarm when it starts within 10 minutes; repeats allowed until 10 minutes after the start
    if (mins <= 10 && mins >= -10) {
      const users = [...new Set([uidOf(noTd ? null : tdMember(i.tool_drive, team, pocName)), uidOf(pocM)].filter(Boolean))];
      if (users.length) out.push({ kind: 'call10', ref, users, first: mins >= 0, payload: { title: mins > 0 ? `Technical call in ${mins} min` : mins == 0 ? 'Technical call starting now' : `Technical call started ${-mins} min ago`, body, tag: 'call-' + i.id, url: '/#i' + i.id } });
    }
    // notd: within 60 minutes and nobody is driving it -> the candidate's POC
    if (noTd && mins <= 60 && mins >= 0) {
      const u = uidOf(pocM);
      if (u) out.push({ kind: 'notd', ref, users: [u], first: true, payload: { title: `No Tool Drive · call in ${mins} min`, body, tag: 'notd-' + i.id, url: '/#i' + i.id } });
    }
  });
  reminders.forEach(r => {
    if (r.done) return;
    const d = Date.parse(r.due_at); if (!(d <= now && d > now - 30 * 60e3)) return;
    out.push({ kind: 'rem', ref: r.id + '@' + r.due_at, users: [r.owner], first: d > now - 15 * 60e3, payload: { title: '⏰ Reminder', body: String(r.note || '').slice(0, 200), tag: 'rem-' + r.id, url: r.interview_id ? '/#i' + r.interview_id : '/' } });
  });
  return out;
}

// Pure: for one alarm and one user, send now? (state = push_sends row, ack = push_ack row)
function shouldSend(a, state, ack, now) {
  if (ack && ack.action == 'ack') return false;
  if (ack && ack.action == 'snooze' && Date.parse(ack.until) > now) return false;
  const n = state ? +state.n || 0 : 0;
  if (n >= MAX_SENDS) return false;
  if (!n) return !!a.first;                                    // never start an alarm late (past its first window)
  return now - Date.parse(state.last_at) >= GAP_MS;
}

function vapid() {
  const e = process.env, pub = (e.VAPID_PUBLIC_KEY || '').trim(), priv = (e.VAPID_PRIVATE_KEY || '').trim();
  return pub && priv ? { pub, priv, subject: (e.VAPID_SUBJECT || '').trim() || 'mailto:admin@example.com' } : null;
}
const alarmPayload = (p, tok, repeat) => ({ ...p, alarm: true, tok, repeat: repeat || 0, requireInteraction: true, vibrate: [300, 150, 300, 150, 600],
  actions: [{ action: 'ack', title: '✓ Got it' }, { action: 'snooze', title: '⏰ Snooze 5 min' }] });
async function deliver(D, subs, payload, dead) {
  let n = 0;
  for (const s of subs) {
    try { await D.send({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload)); n++ }
    catch (e) { if (e && (e.statusCode == 404 || e.statusCode == 410)) dead.add(s.id); else console.error('push send failed', s.id, e && e.statusCode) }
  }
  return n;
}
const inList = ids => 'in.(' + ids.map(encodeURIComponent).join(',') + ')';
const key3 = (k, r, u) => k + '|' + r + '|' + u;

async function runAlerts(D) {
  const now = D.now(), yday = istDate(now - 864e5), tmr = istDate(now + 864e5), secret = process.env.CRON_SECRET || '';
  const interviews = await D.sbAll('interviews', 'id,candidate_id,interview_date,interview_time,round,is_technical,interview_status,tool_drive,client:clients(name)',
    `interview_date=gte.${yday}&interview_date=lte.${tmr}&interview_status=eq.Scheduled`);
  interviews.forEach(i => { i.client = i.client && i.client.name || '' });
  const since = new Date(now - 30 * 60e3).toISOString(), until = new Date(now).toISOString();
  const reminders = await D.sb(`reminders?select=id,owner,due_at,note,interview_id,done&done=is.false&due_at=gt.${encodeURIComponent(since)}&due_at=lte.${encodeURIComponent(until)}`).catch(() => []) || [];
  if (!interviews.length && !reminders.length) return { ok: true, sent: 0 };
  const cids = [...new Set(interviews.map(i => i.candidate_id))];
  const cands = cids.length ? await D.sb(`candidates?select=id,name,technical_poc_id&id=${inList(cids)}`) : [];
  const team = await D.sbAll('team_members', 'id,name,email,is_technical_poc');
  const profiles = await D.sbAll('profiles', 'id,email,approved,removed');
  const list = due({ now, interviews, cands, team, profiles, reminders });
  if (!list.length) return { ok: true, sent: 0 };
  const day = new Date(now - 2 * 864e5).toISOString();
  const sends = await D.sb(`push_sends?select=kind,ref,user_id,n,last_at&last_at=gte.${encodeURIComponent(day)}`) || [];
  const acks = await D.sb(`push_ack?select=kind,ref,user_id,action,until&at=gte.${encodeURIComponent(day)}`) || [];
  const S = new Map(sends.map(x => [key3(x.kind, x.ref, x.user_id), x])), A = new Map(acks.map(x => [key3(x.kind, x.ref, x.user_id), x]));
  const uids = [...new Set(list.flatMap(x => x.users))];
  const subs = await D.sb(`push_subscriptions?select=id,user_id,endpoint,p256dh,auth,alarm&user_id=${inList(uids)}`) || [];
  const dead = new Set(); let n = 0, alarms = 0;
  for (const x of list) for (const u of x.users) {
    const k = key3(x.kind, x.ref, u), st = S.get(k);
    if (!shouldSend(x, st, A.get(k), now)) continue;
    const count = (st ? +st.n || 0 : 0) + 1;
    // record first: if the send fails half way, the next run must not repeat it early
    try { await D.sb('push_sends?on_conflict=kind,ref,user_id', { method: 'POST', body: { kind: x.kind, ref: x.ref, user_id: u, n: count, last_at: new Date(now).toISOString() }, prefer: 'resolution=merge-duplicates,return=minimal' }) } catch (e) { continue }
    const mine = subs.filter(s => s.user_id == u && (count == 1 || s.alarm !== false));
    const tok = secret ? sign(secret, { k: x.kind, r: x.ref, u, e: now + TOKEN_MS }) : '';
    n += await deliver(D, mine, alarmPayload(x.payload, tok, count - 1), dead); alarms++;
  }
  if (dead.size) await D.sb(`push_subscriptions?id=${inList([...dead])}`, { method: 'DELETE' }).catch(() => {});
  return { ok: true, alarms, sent: n, removed: dead.size };
}

// Got it / Snooze from a notification or the in-app alarm: no session, the signed token says who and what
async function ack(D, body) {
  const secret = process.env.CRON_SECRET || '', o = verify(secret, body.ack, D.now());
  if (!o) throw new HttpError(401, 'This alarm link has expired');
  const action = body.action == 'snooze' ? 'snooze' : 'ack', now = D.now();
  await D.sb('push_ack?on_conflict=kind,ref,user_id', { method: 'POST', body: { kind: o.k, ref: o.r, user_id: o.u, action, until: action == 'snooze' ? new Date(now + SNOOZE_MS).toISOString() : null, at: new Date(now).toISOString() }, prefer: 'resolution=merge-duplicates,return=minimal' });
  return { ok: true, action };
}

async function sessionUser(tok, D) {
  if (tok.length < 20) return null;
  const u = await D.sbUser(tok).catch(() => null); if (!u) return null;
  const p = ((await D.sb(`profiles?id=eq.${encodeURIComponent(u.id)}&select=approved,removed`)) || [])[0];
  return p && p.approved && !p.removed ? u.id : null;
}
const bodyOf = req => req.body && typeof req.body == 'object' ? req.body : (() => { try { return JSON.parse(req.body || '{}') } catch (e) { return {} } })();

async function handle(req, D) {
  if (req.method != 'POST') throw new HttpError(405, 'Use POST');
  const body = bodyOf(req);
  if (body.ack) return ack(D, body);
  if (!D.vapid) throw new HttpError(503, 'Phone alerts are not set up yet: add VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT in Vercel');
  const tok = String((req.headers && (req.headers.authorization || req.headers.Authorization)) || '').replace(/^Bearer\s+/i, '').trim();
  const secret = process.env.CRON_SECRET || '';
  if (secret && tok === secret) return runAlerts(D);
  const uid = await sessionUser(tok, D); if (!uid) throw new HttpError(401, 'Sign in again');
  // a signed-in user: a test alert (or alarm) to their own devices only
  const subs = await D.sb(`push_subscriptions?select=id,user_id,endpoint,p256dh,auth,alarm&user_id=eq.${encodeURIComponent(uid)}`) || [];
  if (!subs.length) throw new HttpError(404, 'No device has alerts turned on for your login yet');
  const dead = new Set(), now = D.now();
  const p = body.test == 'alarm'
    ? alarmPayload({ title: '⏰ Test alarm', body: 'This is how a call alarm looks. Tap Got it to stop it.', tag: 'test-alarm', url: '/' }, secret ? sign(secret, { k: 'test', r: String(now), u: uid, e: now + TOKEN_MS }) : '', 0)
    : { title: 'TTOP alerts are on ✓', body: 'You will get an alarm 10 minutes before your technical calls, and when a reminder is due.', tag: 'test', url: '/' };
  const n = await deliver(D, subs, p, dead);
  if (dead.size) await D.sb(`push_subscriptions?id=${inList([...dead])}`, { method: 'DELETE' }).catch(() => {});
  return { ok: true, sent: n, devices: subs.length };
}

function realDeps() {
  const L = require('./inbox'), v = vapid();
  let wp = null;
  if (v) { wp = require('web-push'); wp.setVapidDetails(v.subject, v.pub, v.priv) }
  return { sb: L.sbRest, sbAll: L.sbAll, sbUser: L.sbUser, now: () => Date.now(), vapid: v, send: (sub, body) => wp.sendNotification(sub, body, { TTL: 1800, urgency: 'high' }) };
}
const http = async (req, res, D) => {
  res.setHeader('Cache-Control', 'no-store');
  try { res.status(200).json(await handle(req, D || realDeps())) }
  catch (e) { const st = e.status || 500; if (st >= 500 && st != 503) console.error('push-alerts', e.message || e); res.status(st).json({ ok: false, error: st == 500 ? 'Server error' : e.message }) }
};

module.exports = { http, handle, due, shouldSend, startMs, tdIs, sign, verify, vapid, MAX_SENDS };
