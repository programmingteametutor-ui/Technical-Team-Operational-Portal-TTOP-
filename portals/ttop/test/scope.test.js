// Part C: My interviews / All Technical POCs; other teams' students are never shown to a Technical POC. Run: npm test
'use strict';
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const CORE = new Function(html.slice(html.indexOf('/* core:start */'), html.indexOf('/* core:end */')) + '\nreturn CORE;')();

test('the page keeps other teams\' students out of every list', () => {
  assert.match(html, /OT\.length=0;al\.forEach\(r=>OT\.push\([\s\S]*?\}\)\);\{const k=OT\.filter\(x=>ourI\(x\)\|\|!x\.pocName\);OT\.length=0;k\.forEach\(x=>OT\.push\(x\)\)\}/);   // loaded for a POC
  assert.match(html, /prev:'',notes:''\}\)\);const k=OT\.filter\(x=>ourI\(x\)\|\|!x\.pocName\)/);                                                            // an Admin's User view
  assert.match(html, /allI=\(\)=>uniqI\(I\.concat\(OT\)\)\.filter\(ourI\)/);                                                        // Reports and lists
  assert.match(html, /fI=\(sd,all\)=>\(all\?\(isA\(\)&&F\.poc=='No Technical POC'\?I\.filter\(i=>!ourI\(i\)&&!unaI\(i\)\):scI\(\)\):vI\(\)\)/);  // Interviews table + exports
  assert.match(html, /ev=fI\(1,1\)/);                                                                                                 // Calendar follows the toggle
  assert.match(html, /localStorage\.getItem\('ttop_scope_'\+me\.email\)/);                                                            // remembered per person
});

test('My / All / No Technical POC on a small set', () => {
  const team = [{ name: 'Gopi Krishna', poc: 1 }, { name: 'Kishore Rao', poc: 1 }, { name: 'Vamsi Reddy', poc: 0 }], me = 'Gopi Krishna';
  const L = [
    { id: 1, poc: 'Gopi Krishna', td: '' }, { id: 2, poc: 'Kishore Rao', td: 'Gopi' }, { id: 3, poc: 'Kishore Rao', td: 'Vamsi Reddy' },
    { id: 4, poc: '', td: 'Gopi' }, { id: 5, poc: '', td: 'Gopi Krishna' }, { id: 6, poc: '', td: '' },
  ];
  const our = L.filter(i => CORE.ourI(i.poc, i.td, me, team)).map(i => i.id);
  const my = L.filter(i => i.poc == me || CORE.tdIs(i.td, me, team, i.poc)).map(i => i.id);
  const other = L.filter(i => !CORE.ourI(i.poc, i.td, '', team)).map(i => i.id);
  assert.deepEqual(my, [1, 2, 5]);            // my candidate, my Tool Drive on our candidate, my full name on another team's call
  assert.deepEqual(our, [1, 2, 3, 5]);        // All Technical POCs: never 4 or 6 (other teams)
  assert.deepEqual(other, [4, 5, 6]);         // Admin "No Technical POC"
});

test('an Admin\'s Dashboard and agenda cards also show only our team (other teams via the No Technical POC filter)', () => {
  assert.match(html, /return isA\(\)\?own\.filter\(ourI\):own\.concat\(OT\.filter\(i=>myTD\(i\)/);
});

test('unassigned candidates: upcoming calls on Interviews with an Assign to me button; never in reports', () => {
  assert.match(html, /unaRec=i=>!poc\(i\)&&UNA\.find\(c=>c\.active!==false&&nm\(c\.name\)==nm\(i\.cand\)\)/);
  assert.match(html, /filter\(i=>unaI\(i\)&&\(F\.poc=='Unassigned'\|\|unaUp\(i\)\)\)/);          // both scopes; full history via the filter
  assert.match(html, /unaUp=i=>\(!i\.date\|\|i\.date>=TODAY\)&&i\.status!='Cancelled'/);
  assert.match(html, /onclick="unaC\(\$\{c\.id\}\)">Assign to me<\/button>/);
  assert.match(html, /concat\(\['Unassigned'\]/);
  assert.match(html, /const un=uniqI\(I\.concat\(OT\)\)\.filter\(i=>unaI\(i\)&&unaUp\(i\)&&r1ok\(i\)\)/);   // Today / Upcoming tabs too
  assert.match(html, /A_=uniqI\(allI\(\)\.filter\(meC\)\.concat\(uniqI\(I\.concat\(OT\)\)\.filter\(i=>unaI\(i\)&&unaUp\(i\)\)\)\)/);   // My calls too
  assert.match(html, /\$\{techCtl\(i\)\}\$\{unaB\(i\)\}`\]\],/);
  assert.match(html, /uniqI\(todayL\(\)\.concat\(u\('t'\)\)\)/);                                                  // Technical POC filter option
  assert.match(html, /allI=\(\)=>uniqI\(I\.concat\(OT\)\)\.filter\(ourI\)/);                    // reports unchanged
  assert.match(html, /concat\(OT\.filter\(ourI\)\)\}/);                                            // Clients page counts unchanged
});
