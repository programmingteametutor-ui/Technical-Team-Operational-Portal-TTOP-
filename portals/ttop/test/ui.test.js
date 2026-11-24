// Part D: UI and UX checks on index.html (the browser harness checks layout; these guard the structure). Run: npm test
'use strict';
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('Interviews: + Add Interview and Show all 1st rounds stay; the rest is in More ▾', () => {
  const m = /return `<div class="top"><h2>Interviews<\/h2><div class="row">(.*?)<\/div><\/div>\$\{i1note\(\)\}/.exec(html);
  assert.ok(m, 'Interviews header');
  assert.match(m[1], /\+ Add Interview/); assert.match(m[1], /i1btn\(\)/);
  ['Tool Drive list', 'Check against group list', 'End-of-day message', 'Find duplicates', 'Export CSV / Excel'].forEach(x => assert.ok(m[1].includes("['" + x + "'"), x));
  assert.match(html, /role="menu"/); assert.match(html, /role="menuitem"/);
});

test('Filters: Search, Week and Status visible; the rest behind Filters (n) with chips and Clear all', () => {
  assert.match(html, /fbar\(\['q','wk','status'\],\['date','sheet','client','poc','tdf','callt','round','type'\]\)/);
  assert.match(html, /Filters\$\{n\?` <i>\$\{n\}<\/i>`:''\}/);
  assert.match(html, /class="fchip"/); assert.match(html, /Clear all/);
  assert.match(html, /aria-label="Remove filter /);
});

test('1st-round note: one line, correct grammar for 1 and many', () => {
  const m = /i1note=\(\)=>\{[^\n]*?return n\?`([^`]*)`:''\}/.exec(html);
  assert.ok(m);
  const render = n => m[1].replace(/\$\{n\}/g, n).replace(/\$\{n==1\?'':'s'\}/g, n == 1 ? '' : 's').replace(/\$\{n==1\?'it':'them'\}/g, n == 1 ? 'it' : 'them').replace(/<[^>]+>/g, '');
  assert.match(render(1), /^1 1st-round interview hidden \(not technical\) · See it on the 1st rounds tab$/);
  assert.match(render(3), /^3 1st-round interviews hidden \(not technical\) · See them on the 1st rounds tab$/);
  assert.ok(!/is not technical calls/.test(html));
  assert.match(html, /aria-label="What do the card colours mean\?"/);
});

test('cards: one main action and a ⋯ menu; 1st-round cards keep Add to Technical / Add to my list visible', () => {
  assert.match(html, /<button type="button" onclick="vi\(\$\{i\.id\}\)">Open<\/button>`\}\$\{cardM\(i\)\}/);
  assert.match(html, /const cardM=i=>/);
  ['Add to Technical', 'Reschedule', 'Remind me', 'Prep: mark '].forEach(x => assert.ok(html.includes("it.push(['" + x) || html.includes("push(['" + x), x));
  const r1 = html.slice(html.indexOf('r1card=(i,k)=>'), html.indexOf('r1Take=async'));
  assert.match(r1, /Add to my list/);
  assert.match(html, /techCtl=i=>/);   // the 1st rounds tab still shows Add to Technical through techCtl on its card
});

test('one date format: when() and no raw ISO dates in the Tool Drive banner or the panel', () => {
  assert.match(html, /when=\(d,t\)=>d\?dW\(d\)\+\(t\?' · '\+/);
  const ban = html.slice(html.indexOf('tdBan=()=>'), html.indexOf('yday=()=>'));
  assert.match(ban, /when\(i\.date,i\.time\)/); assert.ok(!/i\.date==TODAY\?'Today':i\.date\}/.test(ban));
  assert.match(html, /Date:i\.date\?dW\(i\.date\):'To be confirmed'/);
  assert.match(html, /'Sheet update date':i\.sheet\?dW\(i\.sheet\):''/);
});

test('interview panel: key facts first, Details collapsed under More details, actions bar', () => {
  assert.match(html, /<dl class="kf"><div><dt>When<\/dt>/);
  ['Round', 'Technical POC', 'Tool Drive', 'Status', 'Prep'].forEach(x => assert.ok(html.includes('<dt>' + x + '</dt>'), x));
  assert.match(html, /<details class="more vmore"><summary>More details<\/summary>/);
  assert.match(html, /<div class="row vact">/);
  assert.match(html, /\.mod\.drw \.vact\{position:fixed;left:0;right:0;bottom:0/);
});

test('phone layout: 4 nav items + More; notes button above the bar; room at the bottom', () => {
  assert.match(html, /navBN=\(\)=>\(myT\(\)\?\['dash','my','int','cal'\]:\['dash','int','cal','cand'\]\)/);
  assert.match(html, /class="nmore/); assert.match(html, /aria-label="More pages"/);
  assert.match(html, /nav a:not\(\.bn\)\{display:none!important\}/);
  assert.match(html, /#stk\{bottom:calc\(84px \+ env\(safe-area-inset-bottom,0px\)\)!important/);
  assert.match(html, /main\{padding-bottom:calc\(140px/);
});

test('Candidates: the Stuck filter has its own id (it used to clash with the notes button); phone cards', () => {
  assert.match(html, /bar\(\['q','poc','tdf','cstatus','stuck'\]\)/);
  assert.ok(!/'stk'\]/.test(html));
  assert.match(html, /class="card ccard"/); assert.match(html, /<dt>Next call<\/dt>/);
});

test('team member Dashboard: my calls today, feedback owed, briefing, stats; empty parts hidden', () => {
  const d = html.slice(html.indexOf('tmDash=(td,pc,c)=>'), html.indexOf('tmDash=(td,pc,c)=>') + 6000);
  const order = ['My technical calls today', 'Calls I owe feedback for', '(/class="brt/.test(b)?b:\'\')', 'class="kp"'].map(x => d.indexOf(x));
  assert.ok(order.every(i => i > 0), order); assert.deepEqual(order, order.slice().sort((a, b) => a - b));
  assert.match(d, /\.filter\(x=>x\[1\]\)/);          // stat cards with 0 are hidden
  assert.match(html, /if\(myT\(\)&&!isA\(\)\)return tmDash\(td,pc,c\)/);
});

test('polish: skeleton, empty states with a next step, clear toasts, header icons, focus ring, shortcuts', () => {
  assert.match(html, /class="skl" role="status" aria-label="Loading your workspace"/);
  assert.match(html, /No calls today\. <a class="lnk"/);
  assert.match(html, /toast\(`Saved: \$\{i\.cand\} · \$\{i\.round\} \$\{k=='prep'\?'prep':'marked'\} \$\{v\}`\)/);
  assert.match(html, /class="sdot \$\{syd\(\)\}" id="sy" role="status"/);
  assert.match(html, /:focus-visible\{outline:2px solid var\(--ac\)/);
  assert.match(html, /onclick="cpp\(\);kbHelp\(\)">⌨ Keyboard shortcuts/);
  assert.ok(!/Ask TTOP|askOpen|\/api\/ask|CORE\.ask/.test(html), 'Ask TTOP removed');
  assert.match(html, /return `<select aria-label="\$\{k=='prep'\?'Preparation':'Status'\} of/);
});

test('sheet updated date: on interview cards, the candidate Interviews table and the Candidate 360 timeline', () => {
  assert.match(html, /shD=i=>i\.sheet\?`<span class="shd"[^`]*>Sheet updated \$\{fD\(i\.sheet\)\}<\/span>`:''/);
  assert.match(html, /Assessment<\/a><\/span>`:''\}\$\{shD\(i\)\}<\/div>/);                 // icard (also 1st-round cards)
  assert.match(html, /\$\{i\.sheet\?' · Sheet updated '\+fD\(i\.sheet\):''\}<\/div><div class="row">\$\{unaB\(i\)\}/);   // other cards
  assert.match(html, /civCols=\(\)=>\[\['Date',i=>i\.date\?fD\(i\.date\):'TBD'\],\['Sheet updated',i=>i\.sheet\?fD\(i\.sheet\):'—'\]/);
  assert.match(html, /\$\{i\.sheet\?' <small class="mu">· Sheet updated '\+fD\(i\.sheet\)\+'<\/small>':''\}/);
});

test('Rescheduled: calls with no new date move to the Date pending tab (Set new date); the list hides Rescheduled unless that status is chosen', () => {
  assert.match(html, /rsNo=i=>i\.status=='Rescheduled'&&i\.id>0&&!I\.some\(x=>String\(x\.prev\)==String\(i\.id\)\)/);
  assert.match(html, /\['pend','Date pending',vI\(\)\.filter\(i=>i\.id>0&&\(i\.status=='Date Pending'\|\|rsNo\(i\)\)\)\]/);
  assert.match(html, /rsNo\(i\)\?`<button class="p" onclick="rs\(\$\{i\.id\}\)">Set new date<\/button>`/);
  assert.match(html, /\(F\.status\?i\.status==F\.status:i\.status!='Rescheduled'\)/);
});

test('Placed: any round from the Status dropdown or Mark placed; incentives wait for the closer list; admin keeps or removes', () => {
  assert.match(html, /ss=\(i,k,o\)=>\{const pl=k=='status'&&o\.includes\('Completed'\)&&canPl\(i\)/);
  assert.match(html, /if\(k=='status'&&v=='Placed'\)return plc\(id\)/);
  assert.match(html, /canPl=i=>i\.id>0&&!!i\.date&&i\.round!='Loop'&&!\['Cancelled','Rescheduled','Date Pending'\]\.includes\(i\.status\)&&\(isA\(\)\|\|mine\(cOf\(i\)\)\)/);
  assert.ok(!/onclick="epNew\(/.test(html), 'Expect placement button replaced');
  assert.match(html, /isA\(\)&&x\.appr!='Pending Approval'&&!x\.cc\?/);                       // no Mark paid while waiting
  assert.match(html, /\.is\('closer_check',null\)/);                                               // bulk pay skips waiting rows
  assert.match(html, /SB\.rpc\('closer_check_month',\{p_month:m\+'-01'\}\)/);
  assert.match(html, /SB\.rpc\('closer_check_decide',\{p_id:id,p_keep:!!keep\}\)/);
  const DBSQL = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'reset_and_setup_DELETES_ALL_DATA.sql'), 'utf8'), pi = DBSQL.indexOf('-- ---------- PART: PLACED STATUS'), sql = DBSQL.slice(pi, DBSQL.indexOf('-- ---------- PART', pi + 10));
  assert.ok(pi >= 0, 'placed status part missing');
  assert.match(sql, /if i\.placement_status = 'Placed' then/); assert.ok(!/i\.round = 'Final' and i\.placement_status/.test(sql));
  assert.match(sql, /raise exception 'This placement incentive is waiting for the closer list/);
  assert.match(sql, /if public\.is_admin\(\) then\s+update incentives set closer_check = null/);
  assert.match(sql, /if not public\.is_admin\(\) then raise exception 'Admin only'; end if;\s+update incentives x set closer_check = 'Not in closer list'/);
  assert.ok(!/update[^;]*set status/i.test(sql), 'never pays or un-pays anything');
});

test('every inline <script> in index.html parses (a syntax slip would blank the whole portal)', () => {
  const vm = require('vm'), re = /<script>([\s\S]*?)<\/script>/g; let m, k = 0;
  while ((m = re.exec(html))) { k++; assert.doesNotThrow(() => new vm.Script(m[1], { filename: 'inline-' + k }), 'script ' + k) }
  assert.ok(k > 0);
});

test('reschedule: the new copy is inserted as a new interview (it must not carry the old row\'s saved-in-database flag)', () => {
  assert.match(html, /const rsCopy=n=>\{delete n\.db;delete n\.srcA;delete n\.srcT;delete n\.srcM;/);
  assert.match(html, /const n=rsCopy\(\{\.\.\.o,id:\+\+iid,/);                                  // Set new date / Reschedule button
  assert.match(html, /n=\{\.\.\.rsCopy\(\{\.\.\.o\}\),\.\.\.d,[^;]*\};delete n\.db;/);            // Add Interview > Reschedule (keeps a new inbox link)
  // behaviour: the copy has no db flag, the original keeps it
  const rsCopy = new Function('return ' + /const rsCopy=(n=>\{[^}]*\})/.exec(html)[1])();
  const o = { id: 5, db: 1, srcT: 't', feedback: 'ok', placement: 'Placed' }, n = rsCopy({ ...o, id: 1e9 + 1, prev: 5 });
  assert.equal(n.db, undefined); assert.equal(n.srcT, undefined); assert.equal(n.feedback, ''); assert.equal(o.db, 1);
});
