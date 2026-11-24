// Team update: one Tool Drive rule (CORE.tdIs, same as api/_lib/push.js), own 1st rounds, and the TEAM UPDATE part of the SQL file. Run: npm test
'use strict';
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const CORE = new Function(html.slice(html.indexOf('/* core:start */'), html.indexOf('/* core:end */')) + '\nreturn CORE;')();
const PUSH = require('../api/_lib/push');
const DBSQL = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'reset_and_setup_DELETES_ALL_DATA.sql'), 'utf8');
const sqlPart = n => { const i = DBSQL.indexOf('-- ---------- PART: ' + n); assert.ok(i >= 0, 'SQL part missing: ' + n); const j = DBSQL.indexOf('-- ---------- PART', i + 10); return DBSQL.slice(i, j < 0 ? undefined : j); };

const team = [{ name: 'Gopi Krishna', poc: 1 }, { name: 'Kishore Rao', poc: 1 }, { name: 'Vamsi Reddy', poc: 0 }, { name: 'Sowmya Devi', poc: 1 }];

test('tdIs: the full name always counts', () => {
  assert.equal(CORE.tdIs('Gopi Krishna', 'Gopi Krishna', team, ''), true);
  assert.equal(CORE.tdIs('  gopi   KRISHNA ', 'Gopi Krishna', team, ''), true);      // case and spaces ignored
  assert.equal(CORE.tdIs('Gopi Krishna', 'Gopi Krishna', team, 'Some Other POC'), true);
});

test('tdIs: a first name alone counts only for our own candidates and when the first name is unique', () => {
  assert.equal(CORE.tdIs('Gopi', 'Gopi Krishna', team, 'Kishore Rao'), true);       // our POC's candidate
  assert.equal(CORE.tdIs('Gopi', 'Gopi Krishna', team, ''), false);                 // no POC = another team's student
  assert.equal(CORE.tdIs('Gopi', 'Gopi Krishna', team, 'Ramesh Babu'), false);      // POC from another team
  assert.equal(CORE.tdIs('Gopi', 'Gopi Krishna', team, 'Vamsi Reddy'), false);      // Vamsi is not a Technical POC
  const twoGopis = team.concat([{ name: 'Gopi Nath', poc: 0 }]);
  assert.equal(CORE.tdIs('Gopi', 'Gopi Krishna', twoGopis, 'Kishore Rao'), false);  // two team members called Gopi
  assert.equal(CORE.tdIs('Gopi N', 'Gopi Krishna', team, 'Kishore Rao'), false);    // two words that are not the full name
  assert.equal(CORE.tdIs('Gopinath', 'Gopi Krishna', team, 'Kishore Rao'), false);
  assert.equal(CORE.tdIs('', 'Gopi Krishna', team, 'Kishore Rao'), false);
});

test('the phone alarms use the same rule as the page', () => {
  const t2 = team.map(t => ({ name: t.name, is_technical_poc: !!t.poc }));
  for (const [td, poc] of [['Gopi Krishna', ''], ['Gopi', 'Kishore Rao'], ['Gopi', ''], ['Gopi', 'Vamsi Reddy'], ['Gopi N', 'Kishore Rao'], ['Kishore', 'Sowmya Devi']])
    assert.equal(PUSH.tdIs(td, td.startsWith('Gopi') ? 'Gopi Krishna' : 'Kishore Rao', t2, poc), CORE.tdIs(td, td.startsWith('Gopi') ? 'Gopi Krishna' : 'Kishore Rao', team, poc), td + ' / ' + poc);
});

test('1st rounds tab: a POC sees only their own candidates; an Admin sees all, one POC, or no POC', () => {
  assert.equal(CORE.r1In('Gopi Krishna', false, 'Gopi Krishna', ''), true);
  assert.equal(CORE.r1In('Kishore Rao', false, 'Gopi Krishna', ''), false);
  assert.equal(CORE.r1In('', false, 'Gopi Krishna', ''), false);                    // other teams' students
  assert.equal(CORE.r1In('', false, '', ''), false);                                // not on the team: nothing
  assert.equal(CORE.r1In('Kishore Rao', true, '', ''), true);
  assert.equal(CORE.r1In('', true, '', ''), true);
  assert.equal(CORE.r1In('Kishore Rao', true, '', 'Kishore Rao'), true);
  assert.equal(CORE.r1In('Gopi Krishna', true, '', 'Kishore Rao'), false);
  assert.equal(CORE.r1In('', true, '', '—'), true);
  assert.equal(CORE.r1In('Gopi Krishna', true, '', '—'), false);
});

test('the page uses the shared helpers (myTD, Tool Drive filters, 1st rounds, hidden 1st-rounds note)', () => {
  assert.match(html, /myTD=i=>tdIs\(i,myT\(\)\)/);
  assert.match(html, /tdIs=\(i,t\)=>!!\(t&&i&&i\.td\)&&CORE\.tdIs\(i\.td,t\.name,team,poc\(i\)\)/);
  assert.match(html, /r1Scope=i=>CORE\.r1In\(poc\(i\),isA\(\)/);
  assert.match(html, /i1note=\(\)=>\{if\(INC1\)return'';const raw=isA\(\)\?I:I\.filter\(r1Own\)/);
  assert.ok(!/fnm\(i\.td\)/.test(html), 'no loose first-name Tool Drive match left');
});

test('SQL team update part: re-runnable, keeps is_team_name and never deletes incentives', () => {
  const sql = sqlPart('TEAM UPDATE').replace(/--.*$/gm, '');
  assert.ok(!/is_team_name/i.test(sql));
  assert.ok(!/delete\s+from\s+public\.incentives/i.test(sql));
  assert.ok(!/drop\s+table/i.test(sql));
  (sql.match(/create\s+table\s+(?!if not exists)/gi) || []).forEach(() => assert.fail('create table without if not exists'));
  (sql.match(/add\s+column\s+(?!if not exists)/gi) || []).forEach(() => assert.fail('add column without if not exists'));
  assert.match(sql, /create or replace function public\.resolve_recipient/);
  assert.match(sql, /position\(' ' in n\) = 0/);                 // one word only
  assert.match(sql, /= 1 then/);                                   // exactly one member with that first name
});

test('ourI: our team\'s interviews only (our POC, or I am the Tool Drive by full name / own first name)', () => {
  assert.equal(CORE.ourI('Kishore Rao', '', 'Gopi Krishna', team), true);           // our POC
  assert.equal(CORE.ourI('', '', 'Gopi Krishna', team), false);                     // no POC: another team
  assert.equal(CORE.ourI('Ramesh Babu', 'Gopi', 'Gopi Krishna', team), false);      // another team's POC
  assert.equal(CORE.ourI('Vamsi Reddy', '', 'Gopi Krishna', team), false);          // Vamsi is not a Technical POC
  assert.equal(CORE.ourI('', 'Gopi Krishna', 'Gopi Krishna', team), true);          // I drive it (full name)
  assert.equal(CORE.ourI('', 'Gopi', 'Gopi Krishna', team), false);                 // first name only on another team's student
  assert.equal(CORE.ourI('', 'Gopi Krishna', '', team), false);                     // not on the team
});
