// Unit tests for the pure helpers in portals/callpilots/index.html (between /* core:start */ and /* core:end */),
// plus static checks of the page and of the Call Pilots SQL. Run: npm test
'use strict';
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const CORE = new Function(html.slice(html.indexOf('/* core:start */'), html.indexOf('/* core:end */')) + '\nreturn CORE;')();
const SQL = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'supabase', 'migrations', '20261125000001_callpilots.sql'), 'utf8');

/* ---------- money, months, IST list day ---------- */
test('Indian Rupee format uses lakh grouping', () => {
  assert.equal(CORE.inr(0), '₹0');
  assert.equal(CORE.inr(2000), '₹2,000');
  assert.equal(CORE.inr(123456), '₹1,23,456');
  assert.equal(CORE.inr(10000000), '₹1,00,00,000');
  assert.equal(CORE.inr(-500), '-₹500');
});
test('month labels', () => {
  assert.equal(CORE.monthLabel('2026-11'), 'Nov-2026');
  assert.equal(CORE.monthLong('2026-01'), 'January 2026');
});
test('list day in IST: before 06:00 it is still the previous day', () => {
  assert.equal(CORE.listToday(new Date('2026-11-25T20:00:00Z')), '2026-11-25');   // 01:30 IST on the 26th
  assert.equal(CORE.listToday(new Date('2026-11-26T00:20:00Z')), '2026-11-25');   // 05:50 IST
  assert.equal(CORE.listToday(new Date('2026-11-26T00:40:00Z')), '2026-11-26');   // 06:10 IST
  assert.equal(CORE.listToday(new Date('2026-11-30T19:00:00Z')), '2026-11-30');   // 00:30 IST on 1 Dec: still November
});
test('12-hour time', () => {
  assert.equal(CORE.time12('16:00'), '4:00 PM');
  assert.equal(CORE.time12('00:30'), '12:30 AM');
  assert.equal(CORE.time12(''), 'TBD');
});

/* ---------- Google Doc list ---------- */
const team = ['Gopi Krishna', 'Karthik Rao', 'Karthik Dhaniyala'];
const doc = [
  'November 20, 2026 (Friday)',
  'Ravi Kumar (UK)(Java Developer) – Interview – Initrode – 4:00 PM IST – Duration: 60 Mins (1st Round)-gopi',
  'Sita Rao (UK)(Data Engineer) – Interview – Globex – 5:00 PM IST – Duration: 45 Mins (1st Round) technical-gopi',
  'Arjun Das (UK)(QA Lead) – Interview – Acme – 6:00 PM IST – Duration: 60 Mins (2nd Round)-gopi',
  'Meena Iyer (UK)(SRE) – Interview – Umbrella – 1:30 AM IST – Duration: 30 Mins-gopi',
  'Ravi Kumar (UK)(Java Developer) – Interview – Initrode – 4:00 PM IST – Duration: 60 Mins (1st Round)-gopi',
  'November 21, 2026',
  '1. Asha Nair (UK)(PM) – Interview – Hooli – 10:00 AM IST – Duration: 1 hr (Final Round)-karthik'
].join('\n');

test('Doc list: rows, dates, times, rounds, POC, repeats merged', () => {
  const p = CORE.parseDocList(doc, { today: '2026-11-20', pocNames: team });
  assert.equal(p.rows.length, 5);
  assert.equal(p.merged, 1);
  const by = n => p.rows.find(r => r.cand.startsWith(n));
  assert.deepEqual([by('Ravi').date, by('Ravi').time, by('Ravi').round, by('Ravi').client, by('Ravi').role, by('Ravi').loc], ['2026-11-20', '16:00', 'Round 1', 'Initrode', 'Java Developer', 'UK']);
  assert.equal(by('Ravi').poc, 'Gopi Krishna');        // only one Gopi on the team: full name
  assert.equal(by('Sita').tech, true);
  assert.equal(by('Sita').dur, 45);
  assert.equal(by('Arjun').round, 'Round 2');
  assert.equal(by('Arjun').tech, false);
  assert.equal(by('Meena').time, '01:30');              // after midnight: same list day (the 20th)
  assert.equal(by('Meena').date, '2026-11-20');
  assert.equal(by('Meena').roundGiven, false);
  assert.equal(by('Asha').date, '2026-11-21');
  assert.equal(by('Asha').round, 'Final');
  assert.equal(by('Asha').dur, 60);
  assert.equal(by('Asha').poc, 'Karthik');              // two Karthiks: never guessed
});

/* ---------- WhatsApp ---------- */
test('WhatsApp: copied messages with prefixes, bold dates and numbering', () => {
  const wa = [
    '[10:42 am, 25/11/2026] Pradeep Anna: *26 Nov 2026*',
    '[10:42 am, 25/11/2026] Pradeep Anna: 1. *Ravi Kumar* (UK)(Java Developer) - Interview - Initrode - 4:00 PM IST - Duration: 60 Mins (2nd Round)-gopi',
    '2) _Sita Rao_ (UK)(Data Engineer) - Interview - Globex - 11:30 PM IST - Duration: 45 Mins (1st Round)-gopi',
    '<Media omitted>',
    '25/11/2026, 21:05 - Pradeep Anna: 27/11/2026',
    '25/11/2026, 21:05 - Pradeep Anna: Arjun Das (UK)(QA) – Interview – Acme – 6:00 PM IST – Duration: 60 Mins (Final Round)-gopi',
  ].join('\n');
  const docText = CORE.whatsappToDoc(wa);
  assert.ok(!/\[10:42|Pradeep Anna:|\*|_Sita|<Media/.test(docText), docText);
  const p = CORE.parseDocList(docText, { today: '2026-11-25', pocNames: team });
  assert.equal(p.rows.length, 3);
  const by = n => p.rows.find(r => r.cand.startsWith(n));
  assert.deepEqual([by('Ravi').date, by('Ravi').round, by('Ravi').time], ['2026-11-26', 'Round 2', '16:00']);
  assert.deepEqual([by('Sita').date, by('Sita').time, by('Sita').cand], ['2026-11-26', '23:30', 'Sita Rao']);
  assert.deepEqual([by('Arjun').date, by('Arjun').round], ['2026-11-27', 'Final']);
});
test('WhatsApp: "Wednesday, 26 November" style headings', () => {
  const p = CORE.parseDocList(CORE.whatsappToDoc('Wednesday, 26 November 2026\nRavi Kumar (UK)(Dev) - Interview - Initrode - 4:00 PM IST - 60 Mins (1st Round)-gopi'), { today: '2026-11-25', pocNames: team });
  assert.equal(p.rows[0].date, '2026-11-26');
});

/* ---------- Tool Drive list ---------- */
const list = [
  '*HYD Team*',
  'Sri Charan S (Ireland) - 11:30',
  'Sakshi Goud (UK) - 12:30 (*Karthik Rao*)',
  'Ravi Kumar (UK) - 1:00 (*Gopi*)',
  '*Pradeep Anna Team*',
  'Meena Iyer (UK) - 6:00 (*Karthik*)',
].join('\n');
test('Tool Drive list: headings, no-AM/PM times read in order, after midnight', () => {
  const e = CORE.parseToolDriveList(list);
  assert.deepEqual(e.map(x => [x.name, x.time, x.tool, x.grp]), [
    ['Sri Charan S', '23:30', '', 'HYD Team'],      // no AM/PM: the list day runs from noon, so 11:30 is 11:30 PM
    ['Sakshi Goud', '00:30', 'Karthik Rao', 'HYD Team'],     // 12:30 after 11:30 -> after midnight
    ['Ravi Kumar', '01:00', 'Gopi', 'HYD Team'],
    ['Meena Iyer', '18:00', 'Karthik', 'Pradeep Anna Team'],
  ]);
});

const members = [
  { id: 1, name: 'Gopi Krishna', team: 'Pradeep Anna', isCallPilot: true },
  { id: 2, name: 'Karthik Rao', team: 'HYD', isCallPilot: true },
  { id: 3, name: 'Karthik Dhaniyala', team: 'Pradeep Anna', isCallPilot: true },
  { id: 4, name: 'Naresh Kumar', team: 'HYD', isCallPilot: true },
];
test('member lookup: exact name, unique first name, never a shared first name', () => {
  assert.equal(CORE.findMember('karthik rao', members).id, 2);
  assert.equal(CORE.findMember('Gopi', members).id, 1);
  assert.equal(CORE.findMember('Karthik', members), null);
  assert.equal(CORE.findMember('Someone Else', members), null);
});

test('matching the list to the day\'s interviews', () => {
  const calls = [
    { id: 11, candidate: 'Sri Charan S', client: 'Initrode', round: 'Round 1', time: '23:30', toolDrive: '', toolDriveMemberId: null },
    { id: 12, candidate: 'Sakshi Goud', client: 'Globex', round: 'Round 2', time: '00:30', toolDrive: 'Naresh Kumar', toolDriveMemberId: 4 },
    { id: 13, candidate: 'Ravi Kumar', client: 'Acme', round: 'Final', time: '01:30', toolDrive: '', toolDriveMemberId: null },
    { id: 14, candidate: 'Meena Iyer', client: 'Umbrella', round: 'Round 1', time: '18:00', toolDrive: '', toolDriveMemberId: null },
  ];
  const r = CORE.matchToolDrive(CORE.parseToolDriveList(list), calls, members, { HYD: members[3] });
  const by = id => r.find(x => x.call && x.call.id === id);
  // heading -> team lead (Naresh), interview had no Tool Drive
  assert.equal(by(11).ok, true); assert.equal(by(11).member.id, 4); assert.equal(by(11).fromTeam, true);
  // named person replaces the previous one
  assert.equal(by(12).ok, true); assert.equal(by(12).member.id, 2); assert.match(by(12).msg, /Replaces Naresh Kumar/);
  // time differs: matched but not ticked by default in the page
  assert.equal(by(13).ok, true); assert.match(by(13).msg, /Time differs/);
  // shared first name: refused
  assert.equal(by(14).ok, false); assert.match(by(14).msg, /not one team member/);
});
test('a team heading never replaces an existing Tool Drive', () => {
  const calls = [{ id: 21, candidate: 'Sri Charan S', client: 'X', round: 'Round 1', time: '23:30', toolDrive: 'Gopi Krishna', toolDriveMemberId: 1 }];
  const r = CORE.matchToolDrive(CORE.parseToolDriveList('*HYD Team*\nSri Charan S (UK) - 11:30'), calls, members, { HYD: members[3] });
  assert.equal(r[0].ok, false); assert.match(r[0].msg, /team heading not applied/);
});
test('a heading that is itself a team row is used before the chosen lead', () => {
  const m2 = members.concat([{ id: 9, name: 'HYD Team', team: 'HYD', isCallPilot: false }]);
  const calls = [{ id: 31, candidate: 'Sri Charan S', client: 'X', round: 'Round 1', time: '23:30', toolDrive: '', toolDriveMemberId: null }];
  const r = CORE.matchToolDrive(CORE.parseToolDriveList('*HYD Team*\nSri Charan S (UK) - 11:30'), calls, m2, { HYD: members[3] });
  assert.equal(r[0].member.id, 9);
});

/* ---------- page and SQL ---------- */
test('every inline script on the page parses', () => {
  for (const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) new Function(m[1]);
});
test('the page calls only cp_* functions, each defined in the migration and granted to signed-in users only', () => {
  const used = [...new Set([...html.matchAll(/rpc\("([a-z_]+)"/g)].map(m => m[1]))];
  assert.ok(used.length >= 8, used.join(','));
  for (const f of used) {
    assert.match(f, /^cp_/);
    assert.match(SQL, new RegExp('create or replace function public\\.' + f + '\\('), f + ' is defined');
    assert.match(SQL, new RegExp("'" + f + '\\('), f + ' is in the grant list');
  }
  assert.doesNotMatch(SQL, /grant[^;]*to\s+anon/i);
});
test('admin-only functions check for an admin in the database', () => {
  for (const f of ['cp_members', 'cp_day_calls', 'cp_unmatched_tool_drive', 'cp_set_member', 'cp_import_interviews', 'cp_assign_tool_drive']) {
    const body = SQL.slice(SQL.indexOf('function public.' + f + '('));
    assert.match(body.slice(0, body.indexOf('end $$')), /cp_require\(true\)/, f);
  }
});
test('handler functions are limited to the caller (cp_scope / cp_member_id), never by first name', () => {
  for (const f of ['cp_dashboard', 'cp_incentives']) {
    const body = SQL.slice(SQL.indexOf('function public.' + f + '('));
    assert.match(body.slice(0, body.indexOf('end $$')), /cp_scope\(p_member, p_team\)/, f);
  }
  const mc = SQL.slice(SQL.indexOf('function public.cp_my_calls('));
  assert.match(mc.slice(0, mc.indexOf('end $$')), /case when public\.cp_is_admin\(\) then coalesce\(p_member, public\.cp_member_id\(\)\) else public\.cp_member_id\(\) end/);
  const sc = SQL.slice(SQL.indexOf('function public.cp_scope('));
  assert.match(sc.slice(0, sc.indexOf('end $$')), /if not public\.cp_is_admin\(\) then[\s\S]*cp_member_id\(\)/);
  assert.doesNotMatch(SQL.slice(SQL.indexOf('-- 7. READ functions')), /split_part\([^)]*tool_drive/);
});
test('no secrets in the page', () => {
  assert.doesNotMatch(html, /service_role|SUPABASE_SERVICE|eyJhbGciOi/);
});


/* ---------- patterns from the team's real daily lists (made-up names) ---------- */
const dayList = [
  "Call's for tomorrow (25th Nov)",
  '1.\tAsha Kiran Rao (UK) – Interview – Optimizely - Associate Business Systems Analyst – 2:30 PM IST – Duration: 30 Mins (1st Round)',
  '2.\tMeera B (UK) – Interview – Lumai - AI Modelling and Simulation Engineer – 2:30 PM IST – Duration: 30 Mins (1st Round)',
  '3.\tRohan Varma Kota (UK) – Call – Phn call - IVC Evidensia - Resource Planner - Data Analyst – 2:30 PM IST – Duration: 30 Mins (1st Round) ',
  '4.\tNisha Reddy (Ireland) – Interview – Regeneron - (IT Applications Analyst Quality Systems) – 3:00 PM IST – Duration: 30 Mins (1st Round)',
  '5.\tKiran Kumar M (IR) – Interview – Optum - senior data engineer – 3:30 PM IST – Duration: 20 Mins (1st Round) (Candidate Own Side)',
  '6.\tAsha Kiran Rao (UK) – Interview – Technical Interview - Revolution Beauty - Demand Planner – 5:00 PM IST – Duration: 60 Mins (2nd Round) (Rescheduled from 24th)',
  '7.\tLatha devi kunduru – Phone Interview – Hennepin Healthcare - Qual Perf Improve Data Analyst – 8:00 PM IST – Duration: 30 Mins (1st Round)',
  '8.\tTara Menon – Interview – Fontainebleau Las Vegas - cyber security engineer – 12:00 AM IST – Duration: 30 Mins (1st Round)',
  '9.\tGita Pillai -(UK)- Interview –Helping Hands Homecare-(Graduate Analytics Engineer)(Waiting for Invite)(1st round)',
  '10.\tAnil Shetty - Interview - University of North Carolina Asheville - Linux Systems Administrator - Waiting For Invite',
  '11.\tRavi Teja – Interview - EOS IT Solutions – Compliance Analyst – (1 st round, 30 mins) (Waiting for invite)Candidate own side',
].join('\n\n');
const dayRows = CORE.parseDocList(CORE.whatsappToDoc(dayList), { today: '2026-11-24', date: '2026-11-24' }).rows;

test('daily list: "(25th Nov)" heading sets the date for every line', () => {
  assert.equal(dayRows.length, 11);
  assert.ok(dayRows.every(r => r.date === '2026-11-25'));
});
test('daily list: client and role after the client, multi-part and bracketed roles, statuses in notes', () => {
  const at = i => dayRows[i - 1];
  assert.deepEqual([at(1).client, at(1).role], ['Optimizely', 'Associate Business Systems Analyst']);
  assert.deepEqual([at(3).client, at(3).role, at(3).notes], ['IVC Evidensia', 'Resource Planner - Data Analyst', 'Phone call']);
  assert.deepEqual([at(4).client, at(4).role, at(4).notes], ['Regeneron', 'IT Applications Analyst Quality Systems', '']);
  assert.deepEqual([at(5).loc, at(5).role, at(5).notes], ['IR', 'senior data engineer', 'Candidate Own Side']);
  assert.deepEqual([at(6).client, at(6).role, at(6).round], ['Revolution Beauty', 'Demand Planner', 'Round 2']);
  assert.deepEqual([at(8).time, at(8).date], ['00:00', '2026-11-25']);           // midnight stays on the 25th list
  assert.deepEqual([at(9).client, at(9).role, at(9).notes, at(9).time], ['Helping Hands Homecare', 'Graduate Analytics Engineer', 'Waiting for Invite', '']);
  assert.deepEqual([at(10).role, at(10).notes], ['Linux Systems Administrator', 'Waiting For Invite']);
  assert.deepEqual([at(11).client, at(11).role, at(11).dur, at(11).round], ['EOS IT Solutions', 'Compliance Analyst', 30, 'Round 1']);
});
test('daily Tool Drive list: names written differently still match the right call and person', () => {
  const calls = dayRows.filter(r => r.time).map((r, i) => ({ id: 100 + i, candidate: r.cand, client: r.client, round: r.round, time: r.time, toolDrive: '', toolDriveMemberId: null }));
  const mem = ['Karthik Dhaniyala', 'Karthik Rao', 'Avinash Kumar', 'Naresh Kumar', 'HYD Lead'].map((n, i) => ({ id: i + 1, name: n, isCallPilot: true }));
  const list = ['*HYD Team*', 'Meera Bhaskaran (UK) - 2:30', 'Rohan Varma Kota (UK) - 2:30 (*Karthik D*)', 'Latha Devi Kundurru - 8:00 (*Avinash*)',
    'Tara Menon - 12:00', 'Someone Else - 1:30'].join('\n');
  const r = CORE.matchToolDrive(CORE.parseToolDriveList(list), calls, mem, { HYD: mem[4] });
  const by = n => r.find(x => x.e.name === n);
  assert.equal(by('Meera Bhaskaran').call.candidate, 'Meera B');                 // initial
  assert.equal(by('Meera Bhaskaran').member.name, 'HYD Lead');                    // team heading -> lead
  assert.equal(by('Rohan Varma Kota').member.name, 'Karthik Dhaniyala');           // "Karthik D"
  assert.equal(by('Latha Devi Kundurru').call.client, 'Hennepin Healthcare');      // spelling slip
  assert.equal(by('Tara Menon').call.time, '00:00');                               // "12:00" after 8:00 PM = midnight
  assert.equal(by('Someone Else').ok, false);
});
test('names: same person despite initials, short forms and small slips; different people stay apart', () => {
  for (const [a, b] of [['Meera B', 'Meera Bhaskaran'], ['Rahul Vernon D', 'Rahul Vernon Dsouza'], ['Latha devi kunduru', 'Latha Devi Kundurru'],
    ['Ammita Rao', 'Amita Rao'], ['Vikram Reddy', 'Vikram Reddy Choudary'], ['Sita Ram', 'Ram Sita']]) assert.ok(CORE.sameName(a, b), a + ' = ' + b);
  for (const [a, b] of [['Kiran Kumar Gopalan', 'Kiran Kumar Nagaraju'], ['Anita Rao', 'Anand Kumar'], ['Sai Nag Pilla', 'Sai Dilip Kumar']])
    assert.ok(!CORE.sameName(a, b), a + ' != ' + b);
});
test('heading dates', () => {
  assert.equal(CORE.headingDate("Call's for tomorrow (25th Nov)", '2026-11-24'), '2026-11-25');
  assert.equal(CORE.headingDate('October 5, 2026 (Monday)', '2026-11-24'), '2026-10-05');
  assert.equal(CORE.headingDate('Calls for 2nd Jan', '2026-12-30'), '2027-01-02');
  assert.equal(CORE.headingDate('Tomorrow calls', '2026-11-24'), '');
});
test('a new role is only flagged, never held (decision 25 Nov 2026)', () => {
  const R = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'supabase', 'migrations', '20261125000002_callpilots_roles.sql'), 'utf8');
  assert.match(R, /create or replace function public\.cp_import_interviews\(/);
  assert.doesNotMatch(R, /kind := 'newrole'/);
  assert.match(R, /'newRole', v_newrole/);
  assert.doesNotMatch(html, /review_new_role/);
  const sync = fs.readFileSync(path.join(__dirname, '..', '..', 'ttop', 'api', 'sync-doc.js'), 'utf8');
  assert.doesNotMatch(sync, /'newrole'/);
});
