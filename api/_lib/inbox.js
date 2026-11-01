// Interview Inbox: reads recruiter emails (INTERVIEW / SCHEDULING) from the CareerXcelerator MySQL database
// (READ ONLY) and turns each email thread into pre-filled interview fields for the portal.
//
// Safety rules enforced here:
//  - MySQL is only ever read: every connection runs SET SESSION TRANSACTION READ ONLY, and q() refuses any
//    statement that is not a SELECT. Only named columns are selected; creds_json, token_expiry,
//    last_history_id and body_html are never selected.
//  - Nothing older than INTERVIEW_IMPORT_START_DATE (00:00 IST) is ever read or returned.
//  - Our own state (dismissed threads, extraction cache) lives in Supabase, written with the service role.
//
// Environment (Vercel > Settings > Environment Variables; never sent to the browser):
//   DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME    MySQL (use a SELECT-only user)
//   INTERVIEW_IMPORT_START_DATE                        YYYY-MM-DD, default 2026-10-27 (go-live day)
//   INBOX_DB_TIMEZONE                                  how recruiter_messages.internal_date is stored:
//                                                      "UTC" (default) or an offset like "+05:30".
//                                                      Check with /api/interview-inbox?diag=1 (admins).
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY            already used by the doc sync
'use strict';
const { mergeThread } = require('./extract');

const LABELS = ['INTERVIEW', 'SCHEDULING'];
const EXTRACT_VER = 'x1';                 // bump to re-extract every cached thread
const MAX_PER_THREAD = 15, BODY_CHARS = 12000, DETAIL_BODY_CHARS = 100000;
const MAX_EXTRACT_PER_REQUEST = 400;      // first run catches up over a few requests
const DEFAULT_START = '2026-10-27';

/* ---------- env ---------- */
const envFind = (...ends) => { const e = process.env; for (const n of ends) if (e[n]) return e[n];
  for (const n of ends) { const k = Object.keys(e).find(k => k.endsWith('_' + n) && e[k]); if (k) return e[k] } return '' };
const cfg = () => {
  const start = /^\d{4}-\d{2}-\d{2}$/.test(process.env.INTERVIEW_IMPORT_START_DATE || '') ? process.env.INTERVIEW_IMPORT_START_DATE : DEFAULT_START;
  const tz = (process.env.INBOX_DB_TIMEZONE || 'UTC').trim();
  const off = /^utc$|^gmt$|^z$/i.test(tz) ? '+00:00' : /^ist$/i.test(tz) ? '+05:30' : /^[+-]\d{2}:\d{2}$/.test(tz) ? tz : '+00:00';
  return { start, dbOffset: off,
    sbUrl: envFind('SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_API_URL').replace(/\/$/, ''),
    sbKey: envFind('SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY', 'SERVICE_ROLE_KEY') };
};

/* ---------- time helpers (IST is UTC+05:30, no DST) ---------- */
const offMin = o => (o[0] == '-' ? -1 : 1) * (+o.slice(1, 3) * 60 + +o.slice(4, 6));
const pad = n => String(n).padStart(2, '0');
const fmt = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
// DB datetime string (in DB timezone) -> epoch ms
const dbToMs = (s, off) => { const t = Date.parse(String(s).replace(' ', 'T').slice(0, 19) + 'Z'); return Number.isNaN(t) ? NaN : t - offMin(off) * 60000 };
// epoch ms -> DB datetime string
const msToDb = (ms, off) => fmt(new Date(ms + offMin(off) * 60000));
const msToIst = ms => fmt(new Date(ms + 330 * 60000));                    // "YYYY-MM-DD HH:MM:SS" IST
const istDay = (ms = Date.now()) => msToIst(ms).slice(0, 10);
const istMidnightMs = day => Date.parse(day + 'T00:00:00+05:30');

/* ---------- validation ---------- */
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status } }
const bad = m => { throw new HttpError(400, m) };
const EMAIL_RE = /^[^\s@<>"']{1,64}@[^\s@<>"']{1,190}$/;
const THREAD_RE = /^(\d{1,15})\.([A-Za-z0-9_-]{1,64})$/;
function parseList(q) {
  const allowed = ['page', 'pageSize', 'q', 'student', 'client', 'stage', 'hasDate', 'showPast', 'view', 'diag'];
  for (const k of Object.keys(q || {})) if (!allowed.includes(k)) bad('Unknown parameter: ' + k);
  const one = k => { const v = q[k]; if (Array.isArray(v)) bad('Parameter given twice: ' + k); return v == null ? '' : String(v) };
  const int = (k, d, lo, hi) => { const v = one(k); if (v === '') return d; if (!/^\d{1,6}$/.test(v) || +v < lo || +v > hi) bad(`${k} must be a whole number from ${lo} to ${hi}`); return +v };
  const bool = k => { const v = one(k).toLowerCase(); if (!['', '0', '1', 'true', 'false'].includes(v)) bad(k + ' must be 0 or 1'); return v == '1' || v == 'true' };
  const pageSize = int('pageSize', 25, 1, 100); if (![25, 50, 100].includes(pageSize)) bad('pageSize must be 25, 50 or 100');
  const text = one('q').trim(); if (text.length > 200) bad('q is too long (max 200)');
  const student = one('student').trim().toLowerCase(); if (student && (student.length > 254 || !EMAIL_RE.test(student))) bad('student must be an email address');
  const client = one('client').trim(); if (client.length > 200) bad('client is too long (max 200)');
  const stage = one('stage').toUpperCase(); if (stage && !LABELS.includes(stage)) bad('stage must be INTERVIEW or SCHEDULING');
  const view = one('view').toLowerCase() || 'todo'; if (!['todo', 'added', 'dismissed', 'all'].includes(view)) bad('view must be todo, added, dismissed or all');
  return { page: int('page', 1, 1, 100000), pageSize, q: text, student, client, stage, hasDate: bool('hasDate'), showPast: bool('showPast'), view, diag: bool('diag') };
}
const parseMsgId = v => { if (!/^\d{1,15}$/.test(String(v || ''))) bad('Invalid message id'); return +v };
const parseThreadKey = v => { const m = THREAD_RE.exec(String(v || '')); if (!m) bad('Invalid thread key'); return { key: m[0], account: +m[1], thread: m[2] } };

/* ---------- MySQL (read only) ---------- */
let POOL = null;
function mysqlPool() {
  if (POOL) return POOL;
  const e = process.env;
  if (!e.DB_HOST || !e.DB_USER || !e.DB_NAME) throw new HttpError(500, 'Interview Inbox is not configured: DB_HOST, DB_USER, DB_PASSWORD and DB_NAME are missing in Vercel');
  const mysql = require('mysql2/promise');
  POOL = mysql.createPool({ host: e.DB_HOST, port: +(e.DB_PORT || 3306), user: e.DB_USER, password: e.DB_PASSWORD || '', database: e.DB_NAME,
    connectionLimit: 3, maxIdle: 3, idleTimeout: 30000, connectTimeout: 8000, waitForConnections: true, queueLimit: 20,
    dateStrings: true, multipleStatements: false, supportBigNumbers: true, bigNumberStrings: false, charset: 'utf8mb4' });
  // every connection: read only + UTC session (so TIMESTAMP columns come back in UTC)
  const warn = w => e => { if (e) console.error('interview-inbox: ' + w + ' failed: ' + (e.code || e.message)) };
  POOL.pool.on('connection', c => { c.query('SET SESSION TRANSACTION READ ONLY', warn('read-only session')); c.query("SET SESSION time_zone = '+00:00'", warn('UTC session')); c.query('SET SESSION MAX_EXECUTION_TIME = 10000', () => {}) });
  return POOL;
}
const READ_ONLY_SQL = /^\s*SELECT\b/i;
async function mysqlQuery(sql, params) {
  if (!READ_ONLY_SQL.test(sql) || /;\s*\S/.test(sql)) throw new Error('Refused: the recruiter database is read only');
  try { const [rows] = await mysqlPool().query({ sql, timeout: 10000 }, params || []); return rows }
  catch (e) { if (e instanceof HttpError) throw e; const x = new HttpError(502, 'Could not read the recruiter email database (' + (e.code || 'error') + ')'); x.cause = e; throw x }
}

/* ---------- Supabase (service role, server only) ---------- */
async function sbRest(path, { method = 'GET', body, prefer, token } = {}) {
  const { sbUrl, sbKey } = cfg();
  if (!sbUrl || !sbKey) throw new HttpError(500, 'SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing in Vercel');
  const r = await fetch(`${sbUrl}/rest/v1/${path}`, { method, headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}`, 'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text(); let d = null; try { d = t ? JSON.parse(t) : null } catch (e) { }
  if (!r.ok) { const e = new HttpError(502, 'Database error: ' + ((d && d.message) || t || r.status)); e.code = d && d.code; throw e }
  return d;
}
async function sbAll(table, select, filter = '') {
  let out = [];
  for (let from = 0; ; from += 1000) {
    const d = await sbRest(`${table}?select=${select}${filter ? '&' + filter : ''}&order=${table == 'interview_inbox_threads' ? 'thread_key' : 'id'}&offset=${from}&limit=1000`);
    out = out.concat(d || []); if (!d || d.length < 1000) return out;
  }
}
async function sbUser(token) {
  const { sbUrl, sbKey } = cfg();
  const r = await fetch(`${sbUrl}/auth/v1/user`, { headers: { apikey: sbKey, Authorization: `Bearer ${token}` } });
  if (!r.ok) return null; const u = await r.json().catch(() => null); return u && u.id ? u : null;
}

const realDeps = () => ({ mysql: mysqlQuery, sb: sbRest, sbAll, sbUser, now: () => Date.now() });

/* ---------- auth: same rules as the portal ---------- */
// Admins see every thread. A Technical POC sees threads whose student email belongs to one of their candidates.
async function authorize(req, D) {
  const h = (req.headers && (req.headers.authorization || req.headers.Authorization)) || '';
  const tok = /^Bearer\s+(\S{20,4096})$/i.exec(h);
  if (!tok) throw new HttpError(401, 'Sign in to use the Interview Inbox');
  const u = await D.sbUser(tok[1]); if (!u) throw new HttpError(401, 'Your session has expired. Sign in again');
  const p = ((await D.sb(`profiles?id=eq.${encodeURIComponent(u.id)}&select=email,role,approved,removed`)) || [])[0];
  if (!p || !p.approved || p.removed) throw new HttpError(403, 'Your account is not approved');
  const admin = p.role == 'admin';
  const email = String(p.email || u.email || '').toLowerCase();
  let member = null, emails = null;
  if (!admin) {
    member = ((await D.sb(`team_members?select=id,name,email&email=ilike.${encodeURIComponent(email.replace(/[%_*]/g, ''))}`)) || [])[0] || null;
    if (!member) throw new HttpError(403, 'Only admins and Technical POCs can add interviews');
    const cs = await D.sbAll('candidates', 'id,email', `technical_poc_id=eq.${member.id}`);
    emails = new Set(cs.map(c => String(c.email || '').trim().toLowerCase()).filter(Boolean));
  }
  return { admin, email, member, emails, canSee: s => admin || emails.has(String(s || '').trim().toLowerCase()) };
}

/* ---------- client matching (case-insensitive, ignores Ltd / Inc / LLC ...) ---------- */
const SUFFIX = /\b(the|ltd|limited|inc|incorporated|llc|llp|plc|corp|corporation|co|company|pvt|private|gmbh|ag|sa|bv|pty|group|holdings|technologies|technology|tech|solutions|services|software|systems|international|intl|uk|usa|us|india)\b/g;
const ckey = s => String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9 ]+/g, ' ').replace(SUFFIX, ' ').replace(/\s+/g, ' ').trim();
function clientMatch(raw, clients) {
  const k = ckey(raw); if (!k) return null;
  const hit = clients.find(c => ckey(c.name) == k) || clients.find(c => ckey(c.name).replace(/ /g, '') == k.replace(/ /g, ''));
  return hit ? hit.name : null;
}

/* ---------- threads ---------- */
const tkey = (a, t) => `${a}.${t}`;
// Smallest message id received on/after the start date: later queries use id >= it (primary key range) to stay fast.
async function startId(D, startDb) {
  const k = 'start_id:' + startDb;
  const s = ((await D.sb(`interview_inbox_state?key=eq.${encodeURIComponent(k)}&select=value`)) || [])[0];
  if (s && /^\d+$/.test(s.value)) return +s.value;
  const r = (await D.mysql('SELECT MIN(id) AS id FROM recruiter_messages WHERE internal_date >= ?', [startDb]))[0];
  if (!r || r.id == null) return null;                                   // nothing yet: don't cache
  await D.sb('interview_inbox_state?on_conflict=key', { method: 'POST', body: { key: k, value: String(r.id) }, prefer: 'resolution=merge-duplicates,return=minimal' });
  return +r.id;
}
const LBL_SQL = `classifier_label IN ('INTERVIEW','SCHEDULING')`;

async function threadSummaries(D, sid, startDb) {
  return D.mysql(
    `SELECT m.account_id, m.gmail_thread_id, COUNT(*) AS n, MAX(m.id) AS max_id, MAX(m.internal_date) AS last_at
       FROM recruiter_messages m
      WHERE m.id >= ? AND m.internal_date >= ? AND m.${LBL_SQL} AND m.gmail_thread_id IS NOT NULL
      GROUP BY m.account_id, m.gmail_thread_id`, [sid, startDb]);
}

const stripQuoted = s => { const t = String(s || '').replace(/\r/g, ''); const i = t.search(/^\s*(On\s.{4,200}\swrote:|-{2,}\s*(Original|Forwarded)\s+Message)/im); return (i > 0 ? t.slice(0, i) : t).split('\n').filter(l => !/^\s*>/.test(l)).join('\n') };

// Fetch newest messages for a set of threads and run mergeThread() on each.
async function extractThreads(D, list, sid, startDb, off) {
  const out = [];
  for (let i = 0; i < list.length; i += 40) {
    const ch = list.slice(i, i + 40), ph = ch.map(() => '(?,?)').join(','), args = [sid, startDb];
    ch.forEach(t => args.push(t.account_id, t.gmail_thread_id));
    const rows = await D.mysql(
      `SELECT m.id, m.account_id, m.gmail_thread_id, m.internal_date, m.subject, m.to_header, m.company, m.role,
              m.classifier_label, LEFT(m.body_plain, ${BODY_CHARS}) AS body, a.student_email, a.google_user_email AS mailbox
         FROM recruiter_messages m JOIN accounts a ON a.id = m.account_id
        WHERE m.id >= ? AND m.internal_date >= ? AND m.${LBL_SQL} AND (m.account_id, m.gmail_thread_id) IN (${ph})
        ORDER BY m.internal_date DESC, m.id DESC`, args);
    const by = new Map();
    for (const r of rows) { const k = tkey(r.account_id, r.gmail_thread_id); if (!by.has(k)) by.set(k, []); const a = by.get(k); if (a.length < MAX_PER_THREAD) a.push(r) }
    for (const t of ch) {
      const k = tkey(t.account_id, t.gmail_thread_id), msgs = by.get(k); if (!msgs || !msgs.length) continue;
      // extract.js reads the date part of internal_date as the email's day: give it the IST time
      const conv = msgs.map(m => ({ id: m.id, subject: m.subject, body: stripQuoted(m.body), to_header: m.to_header, company: m.company, role: m.role,
        internal_date: msToIst(dbToMs(m.internal_date, off)), mailbox: m.mailbox, student_email: m.student_email }));
      let f; try { f = mergeThread(conv, conv[0].internal_date) } catch (e) { f = { error: String(e.message || e).slice(0, 200) } }
      const top = msgs[0];
      out.push({ thread_key: k, account_id: t.account_id, thread_id: t.gmail_thread_id, sig: `${EXTRACT_VER}:${t.n}:${t.max_id}`,
        last_at: new Date(dbToMs(t.last_at, off)).toISOString(), last_message_id: top.id, stage: top.classifier_label,
        student_email: String(top.student_email || '').toLowerCase() || null, mailbox: String(top.mailbox || '').toLowerCase() || null,
        n: t.n, fields: f, extracted_at: new Date(D.now()).toISOString() });
    }
  }
  return out;
}

// Keep the Supabase cache in step with MySQL: only threads with a new email are extracted again.
async function refreshCache(D, C) {
  const startDb = msToDb(istMidnightMs(C.start), C.dbOffset);
  const sid = await startId(D, startDb);
  const cache = await D.sbAll('interview_inbox_threads', 'thread_key,account_id,thread_id,sig,last_at,last_message_id,stage,student_email,mailbox,n,fields');
  if (sid == null) return { rows: cache.filter(r => Date.parse(r.last_at) >= istMidnightMs(C.start)), pending: 0, sid, startDb };
  const sums = await threadSummaries(D, sid, startDb);
  const have = new Map(cache.map(r => [r.thread_key, r]));
  const todo = sums.filter(s => { const c = have.get(tkey(s.account_id, s.gmail_thread_id)); return !c || c.sig != `${EXTRACT_VER}:${s.n}:${s.max_id}` });
  todo.sort((a, b) => String(b.last_at).localeCompare(String(a.last_at)));
  const now = todo.slice(0, MAX_EXTRACT_PER_REQUEST);
  const fresh = now.length ? await extractThreads(D, now, sid, startDb, C.dbOffset) : [];
  for (let i = 0; i < fresh.length; i += 200)
    await D.sb('interview_inbox_threads?on_conflict=thread_key', { method: 'POST', body: fresh.slice(i, i + 200), prefer: 'resolution=merge-duplicates,return=minimal' });
  fresh.forEach(r => have.set(r.thread_key, r));
  const live = new Set(sums.map(s => tkey(s.account_id, s.gmail_thread_id)));
  return { rows: [...have.values()].filter(r => live.has(r.thread_key)), pending: todo.length - now.length, fresh: fresh.length, sid, startDb };
}

// Fetch new emails into the saved threads. Called every 4 hours by Supabase pg_cron (with CRON_SECRET),
// or by "Fetch now" on the page. Keeps going (400 threads per round) until done or the time budget is used.
const RUN_KEY = 'last_fetch';
async function lastRun(D) {
  const s = ((await D.sb(`interview_inbox_state?key=eq.${RUN_KEY}&select=value`)) || [])[0];
  try { return s ? JSON.parse(s.value) : null } catch (e) { return null }
}
async function fetchNow(D, C, by, budgetMs = 45000) {
  const t0 = D.now(), wall = Date.now(); let rounds = 0, extracted = 0, r;
  try {
    do { r = await refreshCache(D, C); rounds++; extracted += r.fresh || 0 } while (r.pending > 0 && Date.now() - wall < budgetMs && rounds < 20);
  } catch (e) {
    const run = { at: new Date(t0).toISOString(), ok: false, by, error: String(e.message || e).slice(0, 300) };
    await D.sb('interview_inbox_state?on_conflict=key', { method: 'POST', body: { key: RUN_KEY, value: JSON.stringify(run), updated_at: new Date(D.now()).toISOString() }, prefer: 'resolution=merge-duplicates,return=minimal' }).catch(() => {});
    throw e;
  }
  const run = { at: new Date(t0).toISOString(), ok: true, by, threads: r.rows.length, updated: extracted, pending: r.pending, ms: Date.now() - wall };
  await D.sb('interview_inbox_state?on_conflict=key', { method: 'POST', body: { key: RUN_KEY, value: JSON.stringify(run), updated_at: new Date(D.now()).toISOString() }, prefer: 'resolution=merge-duplicates,return=minimal' });
  return run;
}
const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length == y.length && require('crypto').timingSafeEqual(x, y) };
async function refresh(req, D = realDeps()) {
  for (const k of Object.keys(req.query || {})) bad('Unknown parameter: ' + k);
  const C = cfg(), secret = process.env.CRON_SECRET || '', h = String((req.headers && req.headers.authorization) || '').replace(/^Bearer\s+/i, '');
  let by;
  if (secret && h && safeEq(h, secret)) by = 'auto (every 4 hours)';
  else { const who = await authorize(req, D); by = who.email }
  return { ok: true, ...(await fetchNow(D, C, by)) };
}

// Full-text search (uses ft_recruiter_messages_search_v2). Returns a Set of thread keys.
function ftQuery(q) {
  const words = q.replace(/[+\-<>()~*"@]/g, ' ').split(/\s+/).filter(w => w.length >= 2).slice(0, 8);
  return words.length ? words.map(w => '+' + w + '*').join(' ') : null;
}
async function searchThreads(D, q, sid, startDb) {
  const fq = ftQuery(q); if (!fq) return null;
  const rows = await D.mysql(
    `SELECT DISTINCT account_id, gmail_thread_id FROM recruiter_messages
      WHERE id >= ? AND internal_date >= ? AND ${LBL_SQL}
        AND MATCH(subject, sender_name, sender_email, from_header, snippet, company, role, body_plain) AGAINST (? IN BOOLEAN MODE)
      LIMIT 5000`, [sid, startDb, fq]);
  return new Set(rows.map(r => tkey(r.account_id, r.gmail_thread_id)));
}

/* ---------- row for the browser (no email bodies, no credentials) ---------- */
function rowOut(c, ctx) {
  const f = c.fields || {}, added = ctx.added.get(c.thread_key), dis = ctx.dismissed.get(c.thread_key);
  const cand = ctx.candByEmail.get(c.student_email || '') || null;
  return {
    thread_key: c.thread_key, message_id: c.last_message_id, stage: c.stage, emails: c.n,
    received_at: new Date(c.last_at).toISOString(), sheet_update_date: f.sheet_update_date || null,
    student_email: c.student_email, candidate_name: f.candidate_name || null, candidate_name_source: f.candidate_name_source || null,
    portal_candidate: cand ? cand.name : null,
    client_raw: f.client || null, client_match: clientMatch(f.client, ctx.clients),
    role: f.role || null, date: f.date || null, time: f.time || null, timezone: f.timezone || null,
    schedule_status: f.schedule_status || null, date_options: f.date_options || [],
    duration_minutes: f.duration_minutes || null, round: f.round || null, type: f.type || null,
    evidence: f.evidence || {}, past: !!(f.date && f.date < ctx.today),
    added: added ? { interview_id: added.id, date: added.interview_date } : null,
    dismissed: dis ? { by: dis.dismissed_by, at: dis.dismissed_at } : null,
  };
}

async function context(D, who) {
  const [clients, cands, added, dismissed] = await Promise.all([
    D.sbAll('clients', 'id,name'),
    D.sbAll('candidates', 'id,name,email'),
    D.sbAll('interviews', 'id,source_account_id,source_thread_id,interview_date', 'source_thread_id=not.is.null'),
    D.sbAll('interview_inbox_dismissed', 'thread_key,dismissed_by,dismissed_at').catch(e => { throw e }),
  ]);
  const candByEmail = new Map(); cands.forEach(c => { const e = String(c.email || '').trim().toLowerCase(); if (e && !candByEmail.has(e)) candByEmail.set(e, c) });
  const am = new Map(); added.forEach(x => { const k = tkey(x.source_account_id, x.source_thread_id); if (!am.has(k) || x.id < am.get(k).id) am.set(k, x) });
  return { clients, candByEmail, added: am, dismissed: new Map(dismissed.map(d => [d.thread_key, d])), today: istDay(D.now()) };
}

/* ---------- endpoints ---------- */
async function list(req, D = realDeps()) {
  const P = parseList(req.query), C = cfg(), who = await authorize(req, D);
  if (P.diag) return diag(who, D, C);
  const startDb = msToDb(istMidnightMs(C.start), C.dbOffset);
  const [rows, run, sid] = await Promise.all([
    D.sbAll('interview_inbox_threads', 'thread_key,account_id,thread_id,sig,last_at,last_message_id,stage,student_email,mailbox,n,fields'),
    lastRun(D), P.q ? startId(D, startDb) : null]);
  const pending = run ? run.pending || 0 : 0;
  const ctx = await context(D, who);
  let L = rows.filter(r => Date.parse(r.last_at) >= istMidnightMs(C.start) && who.canSee(r.student_email)).map(r => rowOut(r, ctx));
  const facets = {
    students: [...new Map(L.map(r => [r.student_email, { email: r.student_email, name: r.portal_candidate || r.candidate_name || '' }])).values()].filter(s => s.email).sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email)),
    clients: [...new Set(L.map(r => r.client_match).filter(Boolean))].sort(),
  };
  const counts = { todo: 0, added: 0, dismissed: 0, all: L.length };
  L.forEach(r => { if (!P.showPast && r.past) return; if (r.added) counts.added++; else if (r.dismissed) counts.dismissed++; else counts.todo++ });
  counts.all = counts.added + counts.dismissed + counts.todo;
  if (P.q) { const hit = sid == null ? new Set() : await searchThreads(D, P.q, sid, startDb); if (hit) L = L.filter(r => hit.has(r.thread_key)) }
  L = L.filter(r =>
    (P.view == 'all' || (P.view == 'added' ? !!r.added : P.view == 'dismissed' ? !r.added && !!r.dismissed : !r.added && !r.dismissed)) &&
    (!P.student || r.student_email == P.student) &&
    (!P.client || (r.client_match || '').toLowerCase() == P.client.toLowerCase()) &&
    (!P.stage || r.stage == P.stage) &&
    (!P.hasDate || !!r.date) &&
    (P.showPast || !r.past));
  L.sort((a, b) => String(b.received_at).localeCompare(String(a.received_at)) || a.thread_key.localeCompare(b.thread_key));
  const total = L.length, pages = Math.max(1, Math.ceil(total / P.pageSize)), page = Math.min(P.page, pages);
  return { ok: true, start_date: C.start, today: ctx.today, last_fetch: run, page, pageSize: P.pageSize, total, pages, counts, facets, catching_up: pending,
    rows: L.slice((page - 1) * P.pageSize, page * P.pageSize) };
}

async function detail(req, D = realDeps()) {
  for (const k of Object.keys(req.query || {})) if (k != 'id') bad('Unknown parameter: ' + k);
  const id = parseMsgId(req.query.id), C = cfg(), who = await authorize(req, D);
  const startDb = msToDb(istMidnightMs(C.start), C.dbOffset);
  const m = (await D.mysql(
    `SELECT m.id, m.account_id, m.gmail_thread_id, m.internal_date, m.subject, m.from_header, m.to_header, m.sender_name, m.sender_email,
            m.company, m.role, m.location, m.classifier_label, LEFT(m.body_plain, ${DETAIL_BODY_CHARS}) AS body_plain, a.student_email
       FROM recruiter_messages m JOIN accounts a ON a.id = m.account_id
      WHERE m.id = ? AND m.internal_date >= ? AND m.${LBL_SQL}`, [id, startDb]))[0];
  if (!m || !who.canSee(m.student_email)) throw new HttpError(404, 'Email not found');
  const thread = await D.mysql(
    `SELECT m.id, m.internal_date, m.subject, m.sender_name, m.sender_email, m.classifier_label, m.snippet
       FROM recruiter_messages m
      WHERE m.account_id = ? AND m.gmail_thread_id = ? AND m.internal_date >= ? AND m.${LBL_SQL}
      ORDER BY m.internal_date DESC, m.id DESC LIMIT 50`, [m.account_id, m.gmail_thread_id, startDb]);
  const key = tkey(m.account_id, m.gmail_thread_id);
  let c = ((await D.sb(`interview_inbox_threads?thread_key=eq.${encodeURIComponent(key)}&select=thread_key,account_id,thread_id,sig,last_at,last_message_id,stage,student_email,mailbox,n,fields`)) || [])[0];
  if (!c) {
    const s = { account_id: m.account_id, gmail_thread_id: m.gmail_thread_id, n: thread.length, max_id: Math.max(...thread.map(t => t.id)), last_at: thread[0].internal_date };
    c = (await extractThreads(D, [s], 0, startDb, C.dbOffset))[0];
  }
  const ctx = await context(D, who);
  const iso = s => new Date(dbToMs(s, C.dbOffset)).toISOString();
  return { ok: true, row: rowOut(c, ctx),
    message: { id: m.id, thread_key: key, received_at: iso(m.internal_date), subject: m.subject, from: m.from_header, to: m.to_header,
      sender_name: m.sender_name, sender_email: m.sender_email, company: m.company, role: m.role, location: m.location, stage: m.classifier_label,
      body_plain: m.body_plain || '' },
    thread: thread.map(t => ({ id: t.id, received_at: iso(t.internal_date), subject: t.subject, sender_name: t.sender_name, sender_email: t.sender_email, stage: t.classifier_label, snippet: t.snippet })) };
}

async function dismiss(req, D = realDeps()) {
  for (const k of Object.keys(req.query || {})) if (k != 'id') bad('Unknown parameter: ' + k);
  const t = parseThreadKey(req.query.id), C = cfg(), who = await authorize(req, D);
  const startDb = msToDb(istMidnightMs(C.start), C.dbOffset);
  const m = (await D.mysql(
    `SELECT a.student_email FROM recruiter_messages m JOIN accounts a ON a.id = m.account_id
      WHERE m.account_id = ? AND m.gmail_thread_id = ? AND m.internal_date >= ? AND m.${LBL_SQL} LIMIT 1`, [t.account, t.thread, startDb]))[0];
  if (!m || !who.canSee(m.student_email)) throw new HttpError(404, 'Thread not found');
  if (req.method == 'POST') {
    await D.sb('interview_inbox_dismissed?on_conflict=thread_key', { method: 'POST', body: { thread_key: t.key, account_id: t.account, thread_id: t.thread, dismissed_by: who.email }, prefer: 'resolution=merge-duplicates,return=minimal' });
    return { ok: true, thread_key: t.key, dismissed: true };
  }
  await D.sb(`interview_inbox_dismissed?thread_key=eq.${encodeURIComponent(t.key)}`, { method: 'DELETE', prefer: 'return=minimal' });
  return { ok: true, thread_key: t.key, dismissed: false };
}

// Admin check: which timezone is internal_date stored in? Compares the newest email with the database clock.
async function diag(who, D, C) {
  if (!who.admin) throw new HttpError(403, 'Admins only');
  const [x] = await D.mysql(`SELECT MAX(internal_date) AS max_internal_date, NOW() AS db_now, UTC_TIMESTAMP() AS db_utc_now, @@session.time_zone AS session_tz, @@global.time_zone AS global_tz FROM recruiter_messages`);
  const [col] = await D.mysql(`SELECT DATA_TYPE AS data_type FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'recruiter_messages' AND COLUMN_NAME = 'internal_date'`);
  const maxAsUtc = Date.parse(String(x.max_internal_date).replace(' ', 'T') + 'Z'), now = D.now(), mins = Math.round((maxAsUtc - now) / 60000);
  const guess = col && /timestamp/i.test(col.data_type) ? 'UTC (TIMESTAMP column, read in a UTC session)'
    : mins > 300 && mins < 360 ? 'IST (+05:30): set INBOX_DB_TIMEZONE=+05:30'
    : mins <= 5 ? 'UTC: INBOX_DB_TIMEZONE=UTC (default) is right'
    : 'unclear: the newest email is ' + (-mins) + ' minutes old; check again right after a new email arrives';
  return { ok: true, start_date: C.start, configured_db_timezone: C.dbOffset, column_type: col ? col.data_type : null, ...x,
    server_utc_now: new Date(now).toISOString(), newest_minus_now_if_utc_minutes: mins, guess };
}

/* ---------- HTTP wrapper ---------- */
const handler = fn => async (req, res) => {
  res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
  try { res.status(200).json(await fn(req)) }
  catch (e) {
    const st = e instanceof HttpError ? e.status : 500;
    if (st >= 500) console.error('interview-inbox', e.cause ? (e.cause.code || e.cause.message) : (e.message || e));
    res.status(st).json({ ok: false, error: st == 500 && !(e instanceof HttpError) ? 'Server error' : e.message });
  }
};

module.exports = { list, detail, dismiss, refresh, fetchNow, handler, HttpError, parseList, parseThreadKey, clientMatch, ckey, ftQuery, dbToMs, msToDb, istMidnightMs, stripQuoted, mysqlQuery, LABELS };
