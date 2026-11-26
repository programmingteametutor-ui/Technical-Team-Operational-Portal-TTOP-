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

test('Add Interviews adds directly: new candidate and client are created, with a Check row', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20261126000003_add_directly.sql'), 'utf8');
  const imp = sql.slice(sql.indexOf('function public.cp_import_interviews('), sql.lastIndexOf('end $$'));
  assert.doesNotMatch(imp, /kind := 'newc'/);
  assert.match(imp, /insert into candidates \(name, technical_poc_id\) values \(v_cand, public\.cp_match_member\(v_poc\)\)/);
  assert.match(imp, /insert into clients \(name\) values \(v_client\)/);
  assert.match(imp, /if v_newclient or v_newcand then/);
  assert.match(imp, /kind := 'dupe'/);                                  // a same-round second line still waits
  const ttop = fs.readFileSync(path.join(__dirname, '..', 'portals', 'ttop', 'index.html'), 'utf8');
  assert.doesNotMatch(ttop, /rv1\(r,'newc',\{hold:'1'/);
  assert.match(ttop, /newC=true;L\('Added candidate '/);
});

test('portal switch for admins and super admins in both portals', () => {
  const ttop = fs.readFileSync(path.join(__dirname, '..', 'portals', 'ttop', 'index.html'), 'utf8');
  assert.match(ttop, /<div class="row">\$\{portSw\(\)\}/);
  assert.match(ttop, /u\.role=='admin'\|\|u\.role=='super_admin'/);
  assert.match(ttop, /<a href="\/callpilots\/">Call Pilots<\/a>/);
  const cp = fs.readFileSync(path.join(__dirname, '..', 'portals', 'callpilots', 'index.html'), 'utf8');
  assert.match(cp, /APP\.role === "admin" \|\| APP\.role === "super_admin"/);
  assert.match(cp, /<a href="\/ttop\/">TTOP<\/a>/);
});


test('team board roster: linked or added in both portals, never a shared first name guessed', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20261126000004_tooldrive_roster.sql'), 'utf8');
  for (const n of ['Akhil', 'Anji', 'Karthikeya', 'Stephen', 'Uday', 'Vamshidhar', 'Avinash', 'Bharath', 'Dhruva', 'Karthik', 'Naresh', 'Pradeep Anna',
    'Dilip B', 'Gopal', 'Gopi', 'Karthik D', 'Kishore', 'Kumar', 'N Sai', 'Pavan M', 'Vamsi P', 'Sameer', 'Uday D', 'Sai', 'Sandeep Anna']) assert.ok(sql.includes("('" + n + "',"), n);
  assert.ok(sql.includes('set is_tool_drive = true, call_pilot_team = r.team, is_call_pilot = public.cp_is_cp_team(r.team)'));   // TTOP + Call Pilots
  assert.ok(sql.includes('order by cardinality(regexp_split_to_array(btrim(name),'));                                            // "Karthik D" before "Karthik"
  assert.ok(sql.includes('tm.id not in (select o.mid from cp_roster_out o'));                                                     // a person is claimed once
  assert.ok(sql.includes('if nfit = 1 then'));                                                                                    // only when exactly one fits
  assert.ok(sql.includes("btrim(coalesce(tm.tool_drive_alias, ''))"));                                                            // alias in matching
});

test('Call Pilots edit and delete: admins edit everything and delete, handlers edit only their own calls', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20261126000005_callpilots_edit_delete.sql'), 'utf8');
  const body = (f) => { const i = sql.indexOf('function public.' + f + '('); assert.ok(i >= 0, f); return sql.slice(i, sql.indexOf('end $$', i)); };
  const ed = body('cp_edit_call');
  assert.match(ed, /if not public\.cp_call_in_admin_scope\(i\.tool_drive_member_id\) then/);              // admin: own teams only
  assert.match(ed, /elsif me is null or i\.tool_drive_member_id is distinct from me then/);                  // handler: own calls only
  assert.match(ed, /Only an admin can change the candidate, client, Tool Drive or Call Support/);
  assert.match(ed, /A call in the future cannot be marked Completed/);
  assert.match(ed, /exception when unique_violation/);
  const del = body('cp_delete_call');
  assert.match(del, /perform public\.cp_require\(true\)/);                                                   // admins only
  assert.match(del, /cp_call_in_admin_scope/);
  assert.match(del, /deleted call/);                                                                         // logged
  assert.match(sql, /revoke all on function public\.cp_call_in_admin_scope\(bigint\) from public, anon, authenticated/);
  const mc = body('cp_my_calls');
  assert.match(mc, /'support1', i\.call_support_1, 'support2', i\.call_support_2/);
  assert.match(mc, /else i\.tool_drive_member_id = me or i\.call_support_1 = me or i\.call_support_2 = me end/);
  const page = fs.readFileSync(path.join(__dirname, '..', 'portals', 'callpilots', 'index.html'), 'utf8');
  assert.match(page, /ME\.isAdmin \|\| c\.myPart === "Tool Drive" \? '<button class="sm" data-a="edit"/);
  assert.match(page, /ME\.isAdmin \? '<button class="sm d" data-a="delete"/);
  assert.match(page, /rpc\("cp_edit_call"/);
  assert.match(page, /rpc\("cp_delete_call"/);
});
