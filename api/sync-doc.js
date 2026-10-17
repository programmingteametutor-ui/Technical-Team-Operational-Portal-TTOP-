// TTOP Portal: automatic Google Doc -> portal sync.
// Called at 6:00 AM and 6:00 PM IST by Supabase pg_cron (see doc_sync_setup.sql),
// or from the portal's "Sync now" button (admins only).
// It reads the Google Doc as plain text, imports only lines it has never imported before,
// and records the run in sync_runs, which the portal shows as a notification with the date and time.
//
// Environment variables (Vercel > Project > Settings > Environment Variables):
//   SUPABASE_URL                 (set by the Vercel Supabase integration)
//   SUPABASE_SERVICE_ROLE_KEY    (set by the Vercel Supabase integration; server-only, never in the browser)
//   CRON_SECRET                  any long random text; the same value goes into doc_sync_setup.sql
//   TTOP_DOC_ID                  optional, defaults to the Sirian Interview Tracker doc
// Test without saving anything: /api/sync-doc?dry=1 (with the secret).

const DOC_ID = process.env.TTOP_DOC_ID || '18_X3ibtvERFdu1_A_LFIoB9_mU6DeR2EXguuOpJJsOo';
// Finds the Supabase settings under any name: SUPABASE_URL, NEXT_PUBLIC_SUPABASE_URL, or a prefixed
// name the Vercel integration may create (e.g. STORAGE_SUPABASE_URL, TTOP_SUPABASE_SERVICE_ROLE_KEY).
const envFind = (...ends) => { const e = process.env; for (const n of ends) if (e[n]) return e[n];
  for (const n of ends) { const k = Object.keys(e).find(k => k.endsWith('_' + n) && e[k]); if (k) return e[k] } return '' };
const SB_URL = envFind('SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_API_URL').replace(/\/$/, '');
const SB_KEY = envFind('SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY', 'SERVICE_ROLE_KEY');
const SECRET = process.env.CRON_SECRET || '';

/* ---------- Supabase REST (no dependencies) ---------- */
async function rest(path, { method = 'GET', body, prefer } = {}) {
  const r = await fetch(SB_URL + '/rest/v1/' + path, {
    method,
    headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY, 'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const t = await r.text(); let d = null; try { d = t ? JSON.parse(t) : null } catch (e) { d = t }
  if (!r.ok) { const e = new Error((d && d.message) || t || 'HTTP ' + r.status); e.code = d && d.code; throw e }
  return d;
}
async function all(table, select) {
  let out = [], from = 0;
  for (;;) { const d = await rest(`${table}?select=${select}&order=id&offset=${from}&limit=1000`); out = out.concat(d); if (d.length < 1000) return out; from += 1000 }
}

/* ---------- Same helpers as the portal ---------- */
const pad = n => String(n).padStart(2, '0');
const nm = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
const strip = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\b(mr|mrs|ms|dr)\b\.?/g, ' ').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const nk = s => strip(s).split(' ').filter(Boolean).sort().join(' ');
const tcase = s => s.replace(/\s+/g, ' ').trim().replace(/(^|\s)(\S)/g, (a, b, c) => b + c.toUpperCase());
const clean = s => (s == null ? s : String(s).replace(/[<>]/g, ''));
const SUF = /\b(inc|llc|ltd|limited|corp|corporation|co|company|technologies|technology|tech|group|pvt|plc|the)\b/g;
const ckey = s => strip(s).replace(SUF, ' ').replace(/ /g, '');
const dbKey = s => String(s || '').toLowerCase().replace(SUF, ' ').replace(/[^a-z0-9]+/g, '');
const rn = r => nm(String(r || '').replace(/\(.*$/, ''));
const roleEq = (a, b) => { const p = rn(a), q = rn(b); return !p || !q || p == q };
function lev(a, b) { if (a == b) return 0; if (Math.abs(a.length - b.length) > 2) return 9; const d = []; for (let i = 0; i <= a.length; i++) { d[i] = [i]; for (let j = 1; j <= b.length; j++)d[i][j] = i ? Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] == b[j - 1] ? 0 : 1)) : j } return d[a.length][b.length] }
const tokOk = (a, b) => b.startsWith(a) || (a.length >= 5 && b.length >= 5 && lev(a, b) <= 1);
function cover(A, B) { const used = new Set(); let strong = 0; for (const a of A) { let k = B.findIndex((b, i) => !used.has(i) && b == a); if (k < 0) k = B.findIndex((b, i) => !used.has(i) && tokOk(a, b)); if (k < 0) return 0; used.add(k); if (a.length >= 3 || B[k] == a) strong++ } return strong >= 1 }
function candFind(name, pool, hint) {
  const k = strip(name); if (!k) return {};
  const ex = pool.filter(c => strip(c.name) == k); if (ex.length) return { c: ex.find(c => hint && c.pocName == hint) || ex[0] };
  const kn = nk(name), nkm = pool.filter(c => nk(c.name) == kn); if (nkm.length == 1) return { c: nkm[0] };
  const ks = k.replace(/ /g, ''), ns = pool.filter(c => strip(c.name).replace(/ /g, '') == ks); if (ns.length == 1) return { c: ns[0] };
  const P = k.split(' '); if (P.length < 2) return {};
  const js = pool.filter(c => { const q = strip(c.name).replace(/ /g, ''); return ks.length >= 6 && q.length >= 6 && (q.startsWith(ks) || ks.startsWith(q)) }); if (js.length == 1) return { c: js[0] };
  let m = pool.filter(c => { const Q = strip(c.name).split(' '); return Q.length >= 2 && (cover(P, Q) || cover(Q, P)) });
  if (m.length > 1 && hint) { const h = m.filter(c => c.pocName == hint); if (h.length) m = h }
  if (m.length > 1) { const e = m.filter(c => strip(c.name).split(' ')[0] == P[0]); if (e.length == 1) m = e }
  return m.length == 1 ? { c: m[0] } : m.length ? { amb: m } : {};
}
function clientCanon(name, list) {
  const n = (name || '').trim(), k = ckey(n); if (!k) return n;
  return list.find(c => nm(c) == nm(n)) || list.find(c => ckey(c) == k || dbKey(c) == dbKey(n)) || (k.length >= 6 && list.find(c => { const q = ckey(c); return q.length >= 6 && lev(q, k) <= 1 })) || n;
}
const istDate = ms => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
const istStamp = d => new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }).format(d) + ' IST';

/* ---------- Doc parser (same rules as "Import from Google Doc" in the portal) ---------- */
const prepOf = () => 'Pending';   // Prep always starts as Pending; the team updates it in the portal
const IVR = /\b(?:i?nterv[a-z]*|intrview\w*|intervew\w*)\b/i;
const TR = /(\d{1,2})(?:\s*[:.]\s*(\d{2}))?\s*([ap])\.?m\b/i, MO = 'jan feb mar apr may jun jul aug sep oct nov dec'.split(' '), CT = /^\(?(uk|ireland|us|usa|canada|australia|uae|india)\)?$/i;
const bpNorm = l => l.replace(/\)\s*-(?=[^\s-])/g, ') - ').replace(/([A-Za-z])-(?=\s*\d{1,2}(?::\d{2}|\s*[ap]\.?m\b))/gi, '$1 - ').replace(/([^\s-])-[ \t]+(?=\S)/g, '$1 - ').replace(/(\s)-(?=[^\s-])/g, ' - ').replace(/[ \t]{2,}/g, ' ');
function parseDoc(text, team, clientNames, today) {
  const pfind = n => team.find(t => nm(t.name) == nm(n) || nm(t.name.split(' ')[0]) == nm(n));
  const names = [...new Set(['gopi', 'pavan', 'kumar', 'kishore', 'vamsi', 'dilip', 'karthik', ...team.map(t => t.name.split(' ')[0].toLowerCase())])].map(x => x.replace(/[^a-z]/g, '')).filter(Boolean);
  const tre = new RegExp('(?:^|[^a-z])(' + names.join('|') + ')(?![a-z])', 'i'), sep = '\\s*(?:[–—-]{2,}|[–—]|\\s-\\s)\\s*';
  const rows = [], rmap = new Map(), clx = [...clientNames]; let date = today;
  text.split(/\r?\n/).forEach(ln => {
    ln = ln.replace(/^\s*[*•●◦-]\s+/, '').replace(/^\s*\d{1,3}\s*[.)]?\s*\t\s*/, '').replace(/^\s*\d{1,3}\s*[.)]\s+/, '').replace(/^\s*\d{1,3}\s{2,}(?=\S)/, '').trim(); ln = bpNorm(ln);
    const iv = IVR.test(ln) || (/\b(phn|phone|phonecall|call)\b/i.test(ln) && (TR.test(ln) || /waiting|invite|round|duration/i.test(ln)));
    const hd = /^([a-z]{3})[a-z]*\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})?/i.exec(ln);
    if (hd && !iv && MO.includes(hd[1].toLowerCase())) { date = (hd[3] || today.slice(0, 4)) + '-' + pad(MO.indexOf(hd[1].toLowerCase()) + 1) + '-' + pad(+hd[2]); return }
    const m = new RegExp(sep).exec(ln); if (!iv || !m) return;
    const s0 = ln.slice(0, m.index), rest = ln.slice(m.index + m[0].length), par = [...s0.matchAll(/\(([^)]*)\)/g)].map(x => x[1].trim());
    // client = first segment after the candidate that is not "Interview", a country, a time, a duration or a round
    const isMeta = x => !x || IVR.test(x) || /^(?:phn|phone)?\s*(?:call|interview)s?$/i.test(x) || /^phn\b/i.test(x) || CT.test(x) || TR.test(x) || /^duration|round|^\d+\s*(?:mins?|hrs?)\b|elabor|eloborat|waiting|invit/i.test(x);
    const segs = rest.split(new RegExp(sep)).map(x => x.replace(/\s+/g, ' ').trim()), ci = segs.findIndex(x => !isMeta(x.replace(/\(.*$/, '').trim()));
    const raw = ci < 0 ? '' : segs[ci], dash = s => s.replace(/^[\s\-–—]+|[\s\-–—:,]+$/g, '').trim();
    let c2 = dash(raw.replace(/\(.*$/, '')), role2 = '';
    { const pr = [...raw.matchAll(/\(([^)]*)\)/g)].map(x => x[1].trim()).find(x => x && !isMeta(x) && x.split(' ').length >= 2); if (pr) role2 = pr }   // "Client-(Role)"
    { const m = /^(.+?)-(?=[A-Z][a-z])(.+)$/.exec(c2); if (m && m[2].trim().split(/\s+/).length >= 2) { c2 = dash(m[1]); role2 = role2 || dash(m[2]) } }   // "client-Role Name"
    if (!role2 && ci >= 0) { const nx = (segs[ci + 1] || '').replace(/\(.*$/, '').trim(); if (nx && !isMeta(nx) && !/\d{1,2}(?::\d{2})?\s*[ap]\.?m/i.test(nx)) role2 = dash(nx) }   // "Client - Role - time"
    const client = clientCanon(c2 == c2.toLowerCase() ? tcase(c2) : c2, clx);
    const tt = TR.exec(rest), hr = /(\d+(?:\.\d+)?)\s*(?:hrs?|hours?)\b/i.exec(rest), mn = /(\d+)\s*min/i.exec(rest), mins = (hr ? hr[1] * 60 : 0) + (mn ? +mn[1] : 0);
    const rd = /final/i.test(rest) ? 'Final' : /\bloop\b/i.test(rest) ? 'Loop' : (x => x ? 'Round ' + x[1] : '')(/(\d)\s*(?:st|nd|rd|th)?\s*round/i.exec(rest));
    const tdm = tre.exec(rest), notes = tdm ? rest.slice(tdm.index + tdm[0].length).replace(/\d{1,2}\/\d{1,2}(\/\d{2,4})?/g, '').replace(/^[\s>\-–—→]+|[\s>\-–—→]+$/g, '').trim() : '';
    const type = /\bon\s*-?site/i.test(rest) ? 'Onsite' : /coding/i.test(rest) ? 'Coding' : /system design/i.test(rest) ? 'System Design' : /technical/i.test(rest) ? 'Technical' : /director/i.test(rest) ? 'Director' : /\b(vp|cto|ceo|head|leadership)\b/i.test(rest) ? 'Leadership' : /manager|panel/i.test(rest) ? 'Hiring Manager' : 'Technical';
    const pcs = ln.split(new RegExp(sep)).map(x => x.trim()), isCall = pcs.some(x => /^(?:phn|phone)?\s*call$/i.test(x) || /^(?:phn|phone)\b/i.test(x));
    const ex_ = [...rest.matchAll(/\(([^)]*)\)/g)].map(x => x[1].trim()).filter(x => x && !/round|^(?:loop|final)$|^\d+\s*mins?\b/i.test(x) && !/^el[ao]bor/i.test(x) && !CT.test(x));
    let time = ''; if (tt) { let h = +tt[1]; const p = tt[3].toLowerCase(); if (p == 'p' && h < 12) h += 12; if (p == 'a' && h == 12) h = 0; time = pad(h) + ':' + (tt[2] || '00') }
    const r = {
      cand: tcase(s0.replace(/\(.*$/, '').replace(/[\s-]*(?:phn\s*|phone\s*)?i?nterv\w*\s*$/i, '').replace(/[\s\-–—]+$/, '')), role: par.find(x => !CT.test(x) && !IVR.test(x)) || role2 || '', loc: par.find(x => CT.test(x)) || '',
      client, date, time, dur: mins || 60, round: rd, type, poc: tdm ? (pfind(tdm[1]) || { name: tcase(tdm[1]) }).name : '', prep: prepOf(rest),
      notes: [notes, isCall ? 'Phone call' : '', ...ex_].filter(Boolean).join(' · ')
    };
    const key = nm(r.cand) + '|' + nm(r.client) + '|' + date + '|' + time, o = rmap.get(key);
    if (o) { if (!o.poc) o.poc = r.poc; if (r.prep == 'Done') o.prep = 'Done'; if (!o.notes) o.notes = r.notes; if (!o.round) o.round = r.round }
    else { rows.push(r); rmap.set(key, r); if (!clx.includes(r.client)) clx.push(r.client) }
  });
  rows.forEach(r => { if (!r.round) r.round = 'Round 1' });
  return rows;
}


/* ---------- Who is calling: cron secret or a signed-in admin ---------- */
async function allowed(req) {
  const h = String(req.headers.authorization || ''), tok = h.replace(/^Bearer\s+/i, '');
  if (SECRET && (tok === SECRET || (req.query && req.query.key === SECRET))) return 'cron';
  if (!tok) return null;
  try {
    const u = await fetch(SB_URL + '/auth/v1/user', { headers: { apikey: SB_KEY, Authorization: 'Bearer ' + tok } });
    if (!u.ok) return null; const user = await u.json();
    const p = await rest(`profiles?select=role,approved&id=eq.${user.id}`);
    return p[0] && p[0].role == 'admin' && p[0].approved ? 'admin:' + (user.email || '') : null;
  } catch (e) { return null }
}

/* ---------- The sync ---------- */
async function runSync(dry) {
  const now = new Date(), today = istDate(Date.now() - 6 * 3600e3), sheetDate = istDate(Date.now());
  const r = await fetch(`https://docs.google.com/document/d/${DOC_ID}/export?format=txt`, { redirect: 'follow' });
  const text = (await r.text()).replace(/^﻿/, '');
  if (!r.ok || /<html/i.test(text.slice(0, 1000))) throw new Error('Could not read the Google Doc. In the doc, click Share > General access > "Anyone with the link" (Viewer).');

  const [team, cls, cands, ivs, seenRows] = await Promise.all([
    all('team_members', 'id,name'), all('clients', 'id,name'), all('candidates', 'id,name,technical_poc_id'),
    all('interviews', 'id,candidate_id,client_id,role,round,interview_date,interview_time,interview_status'),
    rest('doc_sync_lines?select=key&limit=100000')
  ]);
  const tName = id => (team.find(t => t.id == id) || {}).name || '';
  const C = cands.map(c => ({ ...c, pocName: tName(c.technical_poc_id) })), CL = cls.slice(), I = ivs.map(x => ({ ...x, interview_time: (x.interview_time || '').slice(0, 5) }));
  const seen = new Set(seenRows.map(x => x.key)), rows = parseDoc(text, team, CL.map(c => c.name), today);
  const pfind = n => n && team.find(t => nm(t.name) == nm(n) || nm(t.name.split(' ')[0]) == nm(n));
  let fake = -1; const S = { lines: rows.length, added: 0, updated: 0, rescheduled: 0, already: 0, newCands: 0, newClients: 0, pending: 0, review: 0, failed: 0, errors: [] };
  const review = [], seenAdd = [], plans = [];
  const rv = (row, kind, extra) => review.push({ reason: { dupe: 'dupe', newc: 'cand' }[kind] || 'fix', created_by: 'Auto sync', payload: { cand: row.cand, role: row.role, client: row.client, date: row.date, time: row.time, dur: row.dur + ' Minutes', round: row.round, type: row.type, td: '', poc: row.poc, prep: row.prep, notes: row.notes, loc: row.loc, rsId: '', kind, iid: '', xid: '', msg: '', ...extra } });

  for (const row of rows) {
    const key = [nk(row.cand), ckey(row.client), row.round, row.date, row.time].join('|');
    if (seen.has(key)) { S.already++; continue }
    if (!row.cand || !row.client || !row.date) { rv(row, 'skip', { msg: 'Not imported: ' + (!row.client ? 'client' : !row.cand ? 'candidate' : 'date') + ' is missing in the doc line' }); seen.add(key); seenAdd.push({ key, action: 'skipped' }); continue }

    // candidate (never duplicated: same matching as the portal)
    let c = candFind(row.cand, C, row.poc).c, newc = false;
    if (!c) {
      const poc = pfind(row.poc), o = { name: clean(row.cand), location: clean(row.loc) || null, technical_poc_id: poc ? poc.id : null, active: true };
      if (dry) c = { id: fake--, ...o };
      else { try { c = (await rest('candidates', { method: 'POST', body: o, prefer: 'return=representation' }))[0] } catch (e) { const f = (await all('candidates', 'id,name,technical_poc_id')).find(x => nk(x.name) == nk(row.cand)); if (!f) { S.failed++; S.errors.push(row.cand + ': ' + e.message); continue } c = f } }
      c.pocName = poc ? poc.name : ''; C.push(c); S.newCands++; newc = true;
    }
    // client
    const cn = clientCanon(row.client, CL.map(x => x.name)); let cl = CL.find(x => x.name == cn);
    if (!cl) {
      if (dry) cl = { id: fake--, name: cn };
      else { try { cl = (await rest('clients', { method: 'POST', body: { name: clean(cn) }, prefer: 'return=representation' }))[0] } catch (e) { const f = (await all('clients', 'id,name')).find(x => nm(x.name) == nm(cn) || ckey(x.name) == ckey(cn)); if (!f) { S.failed++; S.errors.push(cn + ': ' + e.message); continue } cl = f } }
      CL.push(cl); S.newClients++;
    }
    const noT = !row.time, mine = I.filter(x => x.candidate_id == c.id && x.client_id == cl.id && x.round == row.round);
    // already in the portal in any status (so a cancelled or deleted interview is not brought back)
    { const ex = mine.find(x => noT ? !x.interview_date : x.interview_date == row.date && x.interview_time == row.time); if (ex) { S.already++; seen.add(key); seenAdd.push({ key, action: 'already', interview_id: ex.id > 0 ? ex.id : null }); continue } }

    const act = mine.filter(x => !['Rescheduled', 'Cancelled'].includes(x.interview_status) && roleEq(x.role, row.role));
    const x = row.round == 'Loop' ? null : act[0], status = noT ? 'Date Pending' : row.date < today ? 'Completed' : 'Scheduled';
    // the doc now gives a time for an interview that was waiting for one
    if (x && x.interview_status == 'Date Pending' && !noT) {
      if (!dry) await rest(`interviews?id=eq.${x.id}`, { method: 'PATCH', body: { interview_date: row.date, interview_time: row.time, interview_status: status } });
      Object.assign(x, { interview_date: row.date, interview_time: row.time, interview_status: status });
      S.updated++; seen.add(key); seenAdd.push({ key, action: 'updated', interview_id: x.id > 0 ? x.id : null }); continue;
    }
    const rs = x && /resched/i.test(row.notes || '') && ['Scheduled', 'Date Pending', 'Completed'].includes(x.interview_status) ? x : null;
    const body = {
      candidate_id: c.id, role: clean(row.role) || null, client_id: cl.id, interview_date: noT ? null : row.date, interview_time: noT ? null : row.time,
      duration_minutes: row.dur, round: row.round, interview_type: row.type, source: 'Direct', prep_status: row.prep, interview_status: status,
      notes: clean([row.notes, noT ? 'Time not in doc (' + row.date + ')' : ''].filter(Boolean).join(' · ')) || null, rescheduled_from: rs ? rs.id : null, sheet_date: sheetDate
    };
    const ph = { id: 0, candidate_id: c.id, client_id: cl.id, role: row.role, round: row.round, interview_date: body.interview_date, interview_time: body.interview_time || '', interview_status: status };
    I.push(ph); seen.add(key);
    plans.push({ row, key, body, ph, rs, dupeOf: !rs && x ? x : null, newc });
  }

  // insert new interviews in batches (falls back to one at a time if a batch is refused)
  const done = (p, id) => {
    p.ph.id = id; S.added++; if (p.rs) { S.rescheduled++ } if (!p.body.interview_date) S.pending++;
    seenAdd.push({ key: p.key, action: p.rs ? 'rescheduled' : 'added', interview_id: id > 0 ? id : null });
    if (p.dupeOf) rv(p.row, 'dupe', { iid: id, xid: p.dupeOf.id });
    if (!p.body.interview_date) rv(p.row, 'time', { iid: id });
    if (p.newc) rv(p.row, 'newc', {});
  };
  for (let i = 0; i < plans.length; i += 200) {
    const ch = plans.slice(i, i + 200);
    if (dry) { ch.forEach(p => done(p, fake--)); continue }
    let ok = false;
    try { const d = await rest('interviews?select=id', { method: 'POST', body: ch.map(p => p.body), prefer: 'return=representation' }); if (d && d.length == ch.length) { ch.forEach((p, j) => done(p, d[j].id)); ok = true } } catch (e) { }
    if (!ok) for (const p of ch) {
      try { const d = await rest('interviews?select=id', { method: 'POST', body: p.body, prefer: 'return=representation' }); done(p, d[0].id) }
      catch (e) { S.failed++; S.errors.push(p.row.cand + ' · ' + p.row.client + ': ' + e.message); rv(p.row, 'skip', { msg: 'Not imported: ' + e.message }); seenAdd.push({ key: p.key, action: 'failed' }) }
    }
  }
  if (!dry) {
    for (const p of plans) if (p.rs && p.ph.id > 0) await rest(`interviews?id=eq.${p.rs.id}`, { method: 'PATCH', body: { interview_status: 'Rescheduled' } });
    for (let i = 0; i < seenAdd.length; i += 500) await rest('doc_sync_lines?on_conflict=key', { method: 'POST', body: seenAdd.slice(i, i + 500).map(x => ({ interview_id: null, ...x, run_at: now.toISOString() })), prefer: 'resolution=ignore-duplicates,return=minimal' });
    for (let i = 0; i < review.length; i += 300) { try { await rest('import_review', { method: 'POST', body: review.slice(i, i + 300), prefer: 'return=minimal' }) } catch (e) { S.errors.push('Import Review: ' + e.message) } }
  }
  S.review = review.length;
  return { S, now, sample: dry ? rows.slice(0, 15) : undefined };
}

async function repairSync() {
  const r = await fetch(`https://docs.google.com/document/d/${DOC_ID}/export?format=txt`, { redirect: 'follow' }), text = (await r.text()).replace(/^\uFEFF/, '');
  if (!r.ok || /<html/i.test(text.slice(0, 1000))) throw new Error('Could not read the Google Doc');
  const [team, cls, lines] = await Promise.all([all('team_members', 'id,name'), all('clients', 'id,name'), rest('doc_sync_lines?select=key,interview_id,action&interview_id=not.is.null&limit=100000')]);
  const rows = parseDoc(text, team, cls.map(c => c.name), istDate(Date.now() - 6 * 3600e3)), byKey = new Map(rows.map(x => [[nk(x.cand), ckey(x.client), x.round, x.date, x.time].join('|'), x]));
  const mine = lines.filter(l => ['added', 'rescheduled', 'updated', null].includes(l.action)), ids = mine.map(l => l.interview_id);
  const ivs = []; for (let i = 0; i < ids.length; i += 200) ivs.push(...await rest(`interviews?select=id,role,prep_status&id=in.(${ids.slice(i, i + 200).join(',')})`));
  const iv = new Map(ivs.map(x => [x.id, x])); let prep = 0, role = 0;
  for (const l of mine) {
    const row = byKey.get(l.key), x = iv.get(l.interview_id); if (!row || !x) continue;
    const patch = {}; if (x.prep_status != row.prep && x.prep_status != 'In Progress') { patch.prep_status = row.prep; prep++ }
    if (!x.role && row.role) { patch.role = clean(row.role); role++ }
    if (Object.keys(patch).length) await rest(`interviews?id=eq.${x.id}`, { method: 'PATCH', body: patch });
  }
  return { prep, role };
}
const summary = (S, when) => [
  `Sheet updated at ${when}`,
  `New interviews: ${S.added}${S.rescheduled ? ` (${S.rescheduled} rescheduled)` : ''} · Times filled: ${S.updated} · Already in portal: ${S.already}`,
  `New candidates: ${S.newCands} · Date pending: ${S.pending} · Import Review: ${S.review}${S.failed ? ` · Failed: ${S.failed}` : ''}`
].join('\n');

module.exports = async (req, res) => {
  const dry = !!(req.query && (req.query.dry == '1' || req.query.dry == 'true'));
  if (!SB_URL || !SB_KEY) return res.status(500).json({ ok: false, error: [!SB_URL && 'SUPABASE_URL', !SB_KEY && 'SUPABASE_SERVICE_ROLE_KEY'].filter(Boolean).join(' and ') + ' not found in Vercel. Add it under Project > Settings > Environment Variables (Production), then Redeploy.' });
  if (/^eyJ/.test(SB_KEY)) { try { const role = JSON.parse(Buffer.from(SB_KEY.split('.')[1], 'base64').toString()).role; if (role && role !== 'service_role') return res.status(500).json({ ok: false, error: 'SUPABASE_SERVICE_ROLE_KEY holds the "' + role + '" key. Use the service_role key from Supabase > Project Settings > API.' }) } catch (e) { } }
  const who = await allowed(req);
  if (!who) return res.status(401).json({ ok: false, error: 'Not allowed' });
  const started = new Date();
  if (req.query && req.query.repair == '1') { try { const r = await repairSync(); await rest('activity_log', { method: 'POST', body: { actor_email: 'auto-sync', actor_name: 'Auto sync', action: `Repaired synced interviews: prep corrected on ${r.prep}, role filled on ${r.role}` }, prefer: 'return=minimal' }).catch(() => { }); return res.status(200).json({ ok: true, ...r }) } catch (e) { return res.status(500).json({ ok: false, error: e.message }) } }
  try {
    const { S, sample } = await runSync(dry), when = istStamp(started), msg = summary(S, when);
    if (!dry) {
      await rest('sync_runs', { method: 'POST', body: { ok: true, added: S.added, updated: S.updated, skipped: S.already, new_candidates: S.newCands, review: S.review, failed: S.failed, triggered_by: who, message: msg, error: S.errors.slice(0, 20).join('\n') || null }, prefer: 'return=minimal' });
      await rest('activity_log', { method: 'POST', body: { actor_email: 'auto-sync', actor_name: 'Auto sync', action: `Doc sync (${when}): ${S.added} added, ${S.updated} times filled, ${S.newCands} new candidates, ${S.review} to review` }, prefer: 'return=minimal' }).catch(() => { });
    }
    return res.status(200).json({ ok: true, dry, when, ...S, message: msg, sample });
  } catch (e) {
    const when = istStamp(started);
    if (!dry) {
      await rest('sync_runs', { method: 'POST', body: { ok: false, triggered_by: who, error: e.message, message: `Sheet update FAILED at ${when}\n${e.message}` }, prefer: 'return=minimal' }).catch(() => { });
    }
    return res.status(500).json({ ok: false, when, error: e.message });
  }
};
module.exports.parseDoc = parseDoc;
// Allow up to 60 seconds (older Vercel projects stop functions after 10 seconds by default)
module.exports.config = { maxDuration: 60 };
