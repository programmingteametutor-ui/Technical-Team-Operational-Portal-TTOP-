// Doc sync: a 1st round is a technical call only when its Doc line says "technical". Run: npm test
'use strict';
const test = require('node:test'), assert = require('node:assert');
const { parseDoc } = require('../api/sync-doc');

const team = [{ name: 'Gopi Krishna', email: 'g@x' }];
const doc = [
  'November 20, 2026 (Friday)',
  'Ravi Kumar (UK)(Java Developer) – Interview – Initrode – 4:00 PM IST – Duration: 60 Mins (1st Round)-gopi',
  'Sita Rao (UK)(Data Engineer) – Interview – Globex – 5:00 PM IST – Duration: 45 Mins (1st Round) technical-gopi',
  'Arjun Das (UK)(QA Lead) – Interview – Acme – 6:00 PM IST – Duration: 60 Mins (2nd Round)-gopi',
  'Meena Iyer (UK)(SRE) – Interview – Umbrella – 7:00 PM IST – Duration: 30 Mins-gopi'
].join('\n');
const rows = parseDoc(doc, team, ['Initrode', 'Globex', 'Acme', 'Umbrella'], '2026-11-20');
const by = n => rows.find(r => r.cand.startsWith(n));

test('parses all four lines', () => assert.equal(rows.length, 4));
test('plain 1st round is not technical', () => { assert.equal(by('Ravi').round, 'Round 1'); assert.equal(by('Ravi').tech, false) });
test('1st round that says "technical" is technical', () => { assert.equal(by('Sita').round, 'Round 1'); assert.equal(by('Sita').tech, true) });
test('2nd round is never flagged (it is technical by rank)', () => { assert.equal(by('Arjun').round, 'Round 2'); assert.equal(by('Arjun').tech, false) });
test('line with no round defaults to Round 1, not technical', () => { assert.equal(by('Meena').round, 'Round 1'); assert.equal(by('Meena').tech, false) });
test('no helper field leaks into the row', () => rows.forEach(r => assert.ok(!('t1' in r))));
