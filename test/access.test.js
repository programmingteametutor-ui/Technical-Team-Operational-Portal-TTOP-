// People page rules: TTOP / Call Pilots per team, who may manage whom. Run: npm test
'use strict';
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), path = require('path');
const { createAuth } = require('../server/app/auth');

function setup(rows) {
  const db = new Map(rows.map(u => [u.email, Object.assign({ active: true, portals: [], cp_teams: [] }, u)]));
  const saved = [];
  const rest = async (method, p, body) => {
    if (method === 'GET') return [...db.values()];
    if (method === 'POST') { for (const r of body) { db.set(r.email, Object.assign({}, db.get(r.email) || {}, r)); saved.push(r); } return null; }
    if (method === 'DELETE') { db.delete(decodeURIComponent(p.split('eq.')[1])); return null; }
  };
  const auth = createAuth({ supabaseUrl: 'http://x', serviceKey: 'k', anonKey: 'a', secret: 'test-secret', rest, log: console });
  return { auth, db, saved };
}
const people = [
  { email: 'super@x.com', role: 'super_admin', portals: ['callpilots', 'ttop'], cp_teams: ['HYD', 'Pradeep Anna'] },
  { email: 'hydadmin@x.com', role: 'admin', portals: ['callpilots'], cp_teams: ['HYD'] },
  { email: 'pradmin@x.com', role: 'admin', portals: ['callpilots'], cp_teams: ['Pradeep Anna'] },
  { email: 'ttopadmin@x.com', role: 'admin', portals: ['ttop'], cp_teams: [] },
  { email: 'hyduser@x.com', role: 'user', portals: ['callpilots'], cp_teams: ['HYD'] },
  { email: 'pruser@x.com', role: 'user', portals: ['callpilots'], cp_teams: ['Pradeep Anna'] },
  { email: 'ttopuser@x.com', role: 'user', portals: ['ttop'], cp_teams: [] },
];
const get = (s, e) => s.db.get(e);

test('access choices: TTOP and one entry per Call Pilots team; super admin has all', () => {
  const s = setup(people);
  assert.deepEqual(s.auth.access(get(s, 'super@x.com')), ['ttop', 'cp:Pradeep Anna', 'cp:HYD']);
  assert.deepEqual(s.auth.access(get(s, 'hyduser@x.com')), ['cp:HYD']);
  assert.deepEqual(s.auth.access(get(s, 'ttopuser@x.com')), ['ttop']);
});

test('a team admin manages only users of their own team', () => {
  const s = setup(people), m = s.auth.mayManage, hyd = get(s, 'hydadmin@x.com');
  assert.equal(m(hyd, get(s, 'hyduser@x.com'), { role: 'user', portals: ['callpilots'], cp_teams: ['HYD'] }), true);
  assert.equal(m(hyd, get(s, 'pruser@x.com'), null), false);                                                   // other team
  assert.equal(m(hyd, get(s, 'ttopuser@x.com'), null), false);                                                 // TTOP only
  assert.equal(m(hyd, null, { role: 'user', portals: ['callpilots'], cp_teams: ['Pradeep Anna'] }), false);   // cannot give another team
  assert.equal(m(hyd, null, { role: 'user', portals: ['ttop'], cp_teams: [] }), false);                        // cannot give TTOP
  assert.equal(m(hyd, null, { role: 'admin', portals: ['callpilots'], cp_teams: ['HYD'] }), false);           // cannot make admins
  assert.equal(m(hyd, get(s, 'pradmin@x.com'), null), false);                                                  // other admins
  const ttop = get(s, 'ttopadmin@x.com');
  assert.equal(m(ttop, get(s, 'ttopuser@x.com'), null), true);
  assert.equal(m(ttop, get(s, 'hyduser@x.com'), null), false);
  assert.equal(m(get(s, 'super@x.com'), get(s, 'pradmin@x.com'), { role: 'admin', portals: ['callpilots'], cp_teams: ['HYD'] }), true);
});

test('saving from People stores portals + teams', async () => {
  const s = setup(people);
  await s.auth.saveUser(get(s, 'super@x.com'), { email: 'New.Person@x.com', name: 'New', role: 'admin', access: ['ttop', 'cp:Pradeep Anna'] });
  assert.deepEqual([get(s, 'new.person@x.com').portals, get(s, 'new.person@x.com').cp_teams], [['ttop', 'callpilots'], ['Pradeep Anna']]);
  await s.auth.saveUser(get(s, 'hydadmin@x.com'), { email: 'helper@x.com', name: 'Helper', role: 'user', access: ['cp:HYD'] });
  assert.deepEqual([get(s, 'helper@x.com').portals, get(s, 'helper@x.com').cp_teams], [['callpilots'], ['HYD']]);
  await assert.rejects(s.auth.saveUser(get(s, 'hydadmin@x.com'), { email: 'x2@x.com', role: 'user', access: ['cp:Pradeep Anna'] }), /own portal and team/);
  await assert.rejects(s.auth.saveUser(get(s, 'super@x.com'), { email: 'x3@x.com', role: 'user', access: [] }), /Choose TTOP or a Call Pilots team/);
  await assert.rejects(s.auth.saveUser(get(s, 'super@x.com'), { email: 'x4@x.com', role: 'user', access: ['cp:Nowhere'] }), /Choose TTOP or a Call Pilots team/);
});

test('team migration: admins are limited to their teams in every Call Pilots function', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20261125000003_callpilots_teams.sql'), 'utf8');
  const body = (f) => { const i = sql.indexOf('function public.' + f + '('); assert.ok(i >= 0, f); return sql.slice(i, sql.indexOf('end $$', i)); };
  assert.match(body('cp_scope'), /tm\.call_pilot_team = any\(teams\)/);
  assert.match(body('cp_scope'), /where public\.cp_member_in_scope\(p_member\)/);
  assert.match(body('cp_members'), /where sup or tm\.call_pilot_team = any\(teams\)/);
  assert.match(body('cp_day_calls'), /sup or i\.tool_drive_member_id is null or tm\.call_pilot_team = any\(teams\)/);
  assert.match(body('cp_my_calls'), /cp_member_in_scope\(p_member\)/);
  assert.match(body('cp_update_call'), /This call belongs to another team/);
  assert.match(body('cp_assign_tool_drive'), /person_in_other_team/);
  assert.match(body('cp_assign_tool_drive'), /other_team/);
  assert.match(body('cp_set_member'), /You can only add people to your own team/);
  assert.match(sql, /check \(cp_teams <@ array\['Pradeep Anna','HYD'\]::text\[\]\)/);
  assert.doesNotMatch(sql, /grant[^;]*to\s+anon/i);
});

test('TTOP no longer manages users itself (People on the home page does)', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'portals', 'ttop', 'index.html'), 'utf8');
  assert.doesNotMatch(html, /User approvals/);
  assert.doesNotMatch(html, /onclick="uSet\(/);
  assert.doesNotMatch(html, /onchange="ur\(/);
  assert.match(html, /managed on the home page under <b>People<\/b>/);
});

test('Tool Drive teams: other teams can be Tool Drive without app access; People saves never fail', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20261125000004_tooldrive_teams.sql'), 'utf8');
  const body = (f) => { const i = sql.indexOf('function public.' + f + '('); assert.ok(i >= 0, f); return sql.slice(i, sql.indexOf('end $$', i)); };
  assert.match(sql, /drop index if exists public\.team_first_name_uniq/);                  // Karthik / Karthik D can both exist
  assert.match(body('trg_app_users_callpilots'), /exception when others then\s+raise warning/);  // linking never blocks a save
  assert.match(body('cp_member_assignable'), /not public\.cp_is_cp_team\(tm\.call_pilot_team\)/);
  assert.match(body('cp_assign_tool_drive'), /cp_member_assignable\(mid\)/);
  assert.match(body('cp_add_tool_drive_person'), /@tooldrive\.invalid/);                   // no login for Tool Drive teams
  assert.match(body('cp_add_tool_drive_person'), /You can only add people to your own Call Pilots team/);
  assert.match(body('cp_members'), /not public\.cp_is_cp_team\(tm\.call_pilot_team\)/);
});

test('Call Pilots shows only Pradeep Anna and HYD; other teams are "Other" Tool Drive people', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20261125000005_only_two_teams.sql'), 'utf8');
  assert.match(sql, /when public\.cp_role\(\) = 'super_admin' then array\['HYD','Pradeep Anna'\]/);
  assert.match(sql, /set is_call_pilot = false, call_pilot_team = 'Other'/);
  assert.match(sql, /if not public\.cp_is_cp_team\(t\) then t := 'Other'; end if;/);
  const page = fs.readFileSync(path.join(__dirname, '..', 'portals', 'callpilots', 'index.html'), 'utf8');
  assert.doesNotMatch(page, /Development/);
  assert.match(page, /Other Tool Drive people/);
});

test('only a new candidate waits; Call Pilots admins see all calls of their teams', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20261126000002_callpilots_checks_allcalls.sql'), 'utf8');
  const body = (f) => { const i = sql.indexOf('function public.' + f + '('); assert.ok(i >= 0, f); return sql.slice(i, sql.indexOf('end $$', i)); };
  const imp = body('cp_import_interviews');
  assert.doesNotMatch(imp, /kind := 'newcl'/);                         // a new client never holds a line
  assert.match(imp, /insert into clients \(name\) values \(v_client\)/);
  assert.match(imp, /'kind', 'chk'/);                                   // ...it gets a non-blocking Check row
  assert.match(imp, /'hold', ''/);
  const mc = body('cp_my_calls');
  assert.match(mc, /all_calls := adm and p_member is null/);
  assert.match(mc, /sup or i\.tool_drive_member_id is null or td\.call_pilot_team = any\(teams\)/);   // team admins: their teams + unassigned
  assert.match(mc, /else i\.tool_drive_member_id = me or i\.call_support_1 = me or i\.call_support_2 = me end/);   // handlers: own only
  const page = fs.readFileSync(path.join(__dirname, '..', 'portals', 'callpilots', 'index.html'), 'utf8');
  assert.match(page, /href="#add">＋ Add Interviews/);
  assert.match(page, /href="#assign">⇄ Assign Interviews/);
  const ttop = fs.readFileSync(path.join(__dirname, '..', 'portals', 'ttop', 'index.html'), 'utf8');
  assert.doesNotMatch(ttop, /rv1\(r,'newcl'/);
  assert.match(ttop, /rv1\(r,'chk',/);
});
