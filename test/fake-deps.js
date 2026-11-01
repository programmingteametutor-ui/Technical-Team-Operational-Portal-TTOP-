// In-memory stand-ins for the recruiter MySQL database and Supabase, used by the tests.
// The fake MySQL fails the test if any statement is not a SELECT or touches credential / HTML columns.
'use strict';
const FORBIDDEN = /creds_json|token_expiry|last_history_id|body_html|meeting_windows|scheduling_links|\bINSERT\b|\bUPDATE\b|\bDELETE\b|\bREPLACE\b|\bALTER\b|\bDROP\b|\bCREATE\b|\bTRUNCATE\b/i;
const LBL = ['INTERVIEW', 'SCHEDULING'];

function fixtures() {
  const accounts = [
    { id: 1, student_email: 'rohit@student.com', google_user_email: 'rohit.k@gmail.com', status: 'active', creds_json: 'SECRET-CREDS', token_expiry: 'x' },
    { id: 2, student_email: 'priya@student.com', google_user_email: 'priya.s@gmail.com', status: 'active', creds_json: 'SECRET-CREDS', token_expiry: 'x' },
    { id: 3, student_email: 'other@student.com', google_user_email: 'other@gmail.com', status: 'active', creds_json: 'SECRET-CREDS', token_expiry: 'x' },
  ];
  let id = 1000;
  const m = (o) => ({ id: ++id, snippet: (o.body_plain || '').slice(0, 80), body_html: '<p>SECRET-HTML</p>', sender_name: 'Recruiter', sender_email: 'jobs@acme.com', from_header: 'Recruiter <jobs@acme.com>', role: null, company: null, location: null, ...o });
  const messages = [
    // before the start date (26 Oct 23:30 IST): must never appear
    m({ account_id: 3, gmail_thread_id: 'dd4', internal_date: '2026-10-26 18:00:00', classifier_label: 'INTERVIEW', subject: 'Interview on Oct 30 at 10am', to_header: 'Old <other@gmail.com>', company: 'Acme', role: 'QA', body_plain: 'Hi Old, interview on October 30 at 10:00 AM IST.' }),
    // thread aa1: first invite, then a reschedule (newest wins)
    m({ account_id: 1, gmail_thread_id: 'aa1', internal_date: '2026-10-26 18:45:00', classifier_label: 'INTERVIEW', subject: 'Interview invitation - Data Analyst', to_header: '"Kumar, Rohit" <rohit.k@gmail.com>', company: 'Acme Corporation Ltd', role: 'Data Analyst',
      body_plain: 'Hi Rohit,\n\nWe would like to invite you to a first round interview with the hiring manager on Monday, November 2nd at 1:00 PM EST. It will be a 45 minute video call. Please join 10 minutes before.\nYour application was submitted on October 27.\n' }),
    m({ account_id: 1, gmail_thread_id: 'aa1', internal_date: '2026-10-27 09:00:00', classifier_label: 'SCHEDULING', subject: 'Updated invitation: Data Analyst interview', to_header: '"Kumar, Rohit" <rohit.k@gmail.com>', company: 'Acme Corporation Ltd', role: 'Data Analyst',
      body_plain: 'Hi Rohit,\nYour interview has been rescheduled and is confirmed for Tuesday, November 3rd at 2:00 PM EST.\n\nOn Mon, Oct 26, 2026 at 10:00 AM Recruiter wrote:\n> Monday, November 20th at 5:00 PM EST\n' }),
    // thread bb2: options offered
    m({ account_id: 2, gmail_thread_id: 'bb2', internal_date: '2026-10-27 05:00:00', classifier_label: 'SCHEDULING', subject: 'Scheduling your interview with Globex', to_header: 'priya.s@gmail.com', company: 'Globex', role: 'Java Developer', sender_email: 'ta@globex.com',
      body_plain: 'Hello Priya,\nPlease let me know which of the following times works best for a 30 minute recruiter call:\n- Oct 29 at 10:00 AM IST\n- Oct 30 at 2:00 PM IST\nThanks' }),
    // thread cc3: not an interview email
    m({ account_id: 1, gmail_thread_id: 'cc3', internal_date: '2026-10-27 06:00:00', classifier_label: 'NON_RECRUITER', subject: 'Newsletter', to_header: 'rohit.k@gmail.com', body_plain: 'Interview tips on Oct 30 at 1pm' }),
    // thread ee5: calendar invite, unknown client, interview tomorrow (past by "now")
    m({ account_id: 2, gmail_thread_id: 'ee5', internal_date: '2026-10-27 07:00:00', classifier_label: 'INTERVIEW', subject: 'Invitation: Technical Interview - Initrode @ Wed Oct 28, 2026 2:30pm - 3:15pm (IST) (priya.s@gmail.com)', to_header: 'priya.s@gmail.com', company: 'Initrode Inc', role: 'Backend Engineer', body_plain: 'Candidate: Priya Sharma\nJoin with Google Meet. Reminder 10 minutes before.' }),
    // thread ff6: belongs to a student who is not a candidate of Gopi
    m({ account_id: 3, gmail_thread_id: 'ff6', internal_date: '2026-10-27 08:00:00', classifier_label: 'INTERVIEW', subject: 'Interview tomorrow', to_header: 'other@gmail.com', company: 'Globex', role: 'BA', body_plain: 'Hi Sam, see you tomorrow at 11am IST for the final round interview.' }),
  ];
  const sb = {
    profiles: [{ id: 'u-admin', email: 'admin@x.com', role: 'admin', approved: true, removed: false }, { id: 'u-gopi', email: 'gopi@x.com', role: 'user', approved: true, removed: false },
      { id: 'u-out', email: 'out@x.com', role: 'user', approved: true, removed: false }, { id: 'u-wait', email: 'wait@x.com', role: 'user', approved: false, removed: false }],
    team_members: [{ id: 1, name: 'Gopi', email: 'gopi@x.com' }, { id: 2, name: 'Kishore', email: 'kishore@x.com' }],
    clients: [{ id: 1, name: 'Acme Corp' }, { id: 2, name: 'Globex' }],
    candidates: [{ id: 11, name: 'Rohit Kumar', email: 'rohit@student.com', technical_poc_id: 1 }, { id: 12, name: 'Priya Sharma', email: 'priya@student.com', technical_poc_id: 2 }],
    interviews: [], interview_inbox_state: [], interview_inbox_threads: [], interview_inbox_dismissed: [],
  };
  const tokens = { 'tok-admin-0123456789abcdef': 'u-admin', 'tok-gopi-0123456789abcdef': 'u-gopi', 'tok-out-0123456789abcdef': 'u-out', 'tok-wait-0123456789abcdef': 'u-wait' };
  return { accounts, messages, sb, tokens };
}

function makeDeps(F, now = Date.parse('2026-10-29T06:00:00Z')) {
  const log = { sql: [], sbWrites: [] };
  const acc = id => F.accounts.find(a => a.id == id);
  const isLbl = r => LBL.includes(r.classifier_label);
  const pick = (r, cols) => Object.fromEntries(cols.map(c => [c, r[c]]));
  async function mysql(sql, p = []) {
    log.sql.push(sql);
    if (!/^\s*SELECT\b/i.test(sql) || FORBIDDEN.test(sql)) throw new Error('TEST FAIL: forbidden SQL: ' + sql);
    const M = F.messages;
    if (/SELECT MIN\(id\) AS id FROM recruiter_messages WHERE internal_date >= \?/.test(sql)) {
      const ids = M.filter(r => r.internal_date >= p[0]).map(r => r.id); return [{ id: ids.length ? Math.min(...ids) : null }] }
    if (/GROUP BY m\.account_id, m\.gmail_thread_id/.test(sql)) {
      const g = new Map(); for (const r of M) { if (r.id < p[0] || r.internal_date < p[1] || !isLbl(r)) continue; const k = r.account_id + '|' + r.gmail_thread_id;
        const x = g.get(k) || { account_id: r.account_id, gmail_thread_id: r.gmail_thread_id, n: 0, max_id: 0, last_at: '' }; x.n++; x.max_id = Math.max(x.max_id, r.id); if (r.internal_date > x.last_at) x.last_at = r.internal_date; g.set(k, x) }
      return [...g.values()] }
    if (/LEFT\(m\.body_plain, 12000\) AS body/.test(sql)) {
      const pairs = []; for (let i = 2; i < p.length; i += 2) pairs.push(p[i] + '|' + p[i + 1]);
      return M.filter(r => r.id >= p[0] && r.internal_date >= p[1] && isLbl(r) && pairs.includes(r.account_id + '|' + r.gmail_thread_id))
        .sort((a, b) => b.internal_date.localeCompare(a.internal_date) || b.id - a.id)
        .map(r => ({ ...pick(r, ['id', 'account_id', 'gmail_thread_id', 'internal_date', 'subject', 'to_header', 'company', 'role', 'classifier_label']), body: (r.body_plain || '').slice(0, 12000), student_email: acc(r.account_id).student_email, mailbox: acc(r.account_id).google_user_email })) }
    if (/AGAINST \(\? IN BOOLEAN MODE\)/.test(sql)) {
      const words = p[2].split(' ').map(w => w.replace(/^\+|\*$/g, '').toLowerCase());
      return M.filter(r => r.id >= p[0] && r.internal_date >= p[1] && isLbl(r) && words.every(w => [r.subject, r.sender_name, r.sender_email, r.from_header, r.snippet, r.company, r.role, r.body_plain].join(' ').toLowerCase().includes(w)))
        .map(r => pick(r, ['account_id', 'gmail_thread_id'])) }
    if (/WHERE m\.id = \? AND m\.internal_date >= \?/.test(sql)) {
      return M.filter(r => r.id == p[0] && r.internal_date >= p[1] && isLbl(r)).map(r => ({ ...pick(r, ['id', 'account_id', 'gmail_thread_id', 'internal_date', 'subject', 'from_header', 'to_header', 'sender_name', 'sender_email', 'company', 'role', 'location', 'classifier_label']), body_plain: (r.body_plain || '').slice(0, 100000), student_email: acc(r.account_id).student_email })) }
    if (/LIMIT 50/.test(sql)) {
      return M.filter(r => r.account_id == p[0] && r.gmail_thread_id == p[1] && r.internal_date >= p[2] && isLbl(r)).sort((a, b) => b.internal_date.localeCompare(a.internal_date))
        .map(r => pick(r, ['id', 'internal_date', 'subject', 'sender_name', 'sender_email', 'classifier_label', 'snippet'])) }
    if (/SELECT a\.student_email FROM recruiter_messages m JOIN accounts a/.test(sql)) {
      return M.filter(r => r.account_id == p[0] && r.gmail_thread_id == p[1] && r.internal_date >= p[2] && isLbl(r)).slice(0, 1).map(r => ({ student_email: acc(r.account_id).student_email })) }
    if (/MAX\(internal_date\) AS max_internal_date/.test(sql)) return [{ max_internal_date: M.map(r => r.internal_date).sort().pop(), db_now: '2026-10-29 06:00:00', db_utc_now: '2026-10-29 06:00:00', session_tz: '+00:00', global_tz: 'SYSTEM' }];
    if (/information_schema\.COLUMNS/.test(sql)) return [{ data_type: 'datetime' }];
    throw new Error('TEST FAIL: unexpected SQL ' + sql);
  }
  // tiny PostgREST: table?col=eq.v&col=ilike.v&col=not.is.null&on_conflict=k
  const parse = path => { const [t, qs] = path.split('?'); const p = new URLSearchParams(qs || ''); const f = []; for (const [k, v] of p) if (!['select', 'order', 'offset', 'limit', 'on_conflict'].includes(k)) f.push([k, v]); return { t, f, conflict: p.get('on_conflict') } };
  const match = (r, f) => f.every(([k, v]) => v.startsWith('eq.') ? String(r[k]) == v.slice(3) : v.startsWith('ilike.') ? String(r[k] || '').toLowerCase() == v.slice(6).toLowerCase() : v == 'not.is.null' ? r[k] != null : true);
  async function sb(path, o = {}) {
    const { t, f, conflict } = parse(path); const T = F.sb[t]; if (!T) throw Object.assign(new Error('no table ' + t), { status: 502 });
    const method = o.method || 'GET';
    if (method == 'GET') return T.filter(r => match(r, f)).map(r => ({ ...r }));
    log.sbWrites.push([method, t]);
    if (method == 'POST') { for (const b of [].concat(o.body)) { const i = conflict ? T.findIndex(r => r[conflict] == b[conflict]) : -1; if (i >= 0) T[i] = { ...T[i], ...b }; else T.push({ dismissed_at: new Date(now).toISOString(), ...b }) } return null }
    if (method == 'DELETE') { for (let i = T.length - 1; i >= 0; i--) if (match(T[i], f)) T.splice(i, 1); return null }
    throw new Error('method ' + method);
  }
  const sbAll = async (t, select, filter) => sb(`${t}?select=${select}${filter ? '&' + filter : ''}`);
  const sbUser = async tok => F.tokens[tok] ? { id: F.tokens[tok], email: (F.sb.profiles.find(p => p.id == F.tokens[tok]) || {}).email } : null;
  return { D: { mysql, sb, sbAll, sbUser, now: () => now }, log };
}
module.exports = { fixtures, makeDeps };
