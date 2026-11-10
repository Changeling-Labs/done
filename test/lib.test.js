import test from 'node:test';
import assert from 'node:assert/strict';

import {
  cleanName,
  codeFromSearch,
  formatCode,
  isValidCode,
  isValidName,
  joinUrl,
  normalizeCode,
  progressSummary,
  roundLabel,
  sortMembers,
  summaryText,
  truncate,
} from '../js/lib.js';

test('room codes are normalized, formatted and validated', () => {
  assert.equal(normalizeCode(' abc-234 '), 'ABC234');
  assert.equal(normalizeCode('ABCDEFG'), 'ABCDEF');
  assert.equal(formatCode('abc234'), 'ABC 234');
  assert.equal(isValidCode('ABC 234'), true);
  assert.equal(isValidCode('ABC 23'), false);
  assert.equal(isValidCode('ABI234'), false, 'I is not in the alphabet');
  assert.equal(isValidCode('AB0234'), false, '0 is not in the alphabet');
});

test('room codes survive being pasted out of a URL', () => {
  assert.equal(codeFromSearch('?code=abc234'), 'ABC234');
  assert.equal(codeFromSearch('?code=ABC-234&x=1'), 'ABC234');
  assert.equal(codeFromSearch('?code=notacode'), '');
  assert.equal(codeFromSearch(''), '');
});

test('join links strip an existing query', () => {
  assert.equal(
    joinUrl('abc234', 'https://example.com/done/?code=OLD234&demo=1'),
    'https://example.com/done/?code=ABC234',
  );
});

test('seats keep join order, so rows never jump mid-round', () => {
  const members = [
    { name: 'Dad', created_at: '2026-01-01T00:00:03Z', done: true },
    { name: 'Mum', created_at: '2026-01-01T00:00:01Z', done: true },
    { name: 'You', created_at: '2026-01-01T00:00:02Z', done: false },
  ];
  assert.deepEqual(
    sortMembers(members).map((m) => m.name),
    ['Mum', 'You', 'Dad'],
  );
});

test('sorting does not mutate the input', () => {
  const members = [
    { name: 'B', created_at: '2026-01-01T00:00:02Z' },
    { name: 'A', created_at: '2026-01-01T00:00:01Z' },
  ];
  sortMembers(members);
  assert.deepEqual(members.map((m) => m.name), ['B', 'A']);
});

test('progress counts are exact', () => {
  const summary = progressSummary([
    { name: 'A', done: true },
    { name: 'B', done: false },
    { name: 'C', done: true },
    { name: 'D', done: false },
  ]);
  assert.equal(summary.done, 2);
  assert.equal(summary.total, 4);
  assert.equal(summary.waiting, 2);
  assert.equal(summary.anyoneDone, true);
  assert.equal(summary.allDone, false);
  assert.deepEqual(summary.names, ['A', 'C']);

  assert.equal(progressSummary([{ done: true }]).allDone, true);
  assert.equal(progressSummary([]).allDone, false);
  assert.equal(progressSummary([]).total, 0);
});

test('summary copy reads naturally at every stage', () => {
  assert.equal(summaryText(progressSummary([])), 'Waiting for players to join');
  assert.equal(summaryText(progressSummary([{ done: false }])), 'Nobody’s done yet');
  assert.equal(summaryText(progressSummary([{ done: true }, { done: false }])), '1 of 2 done');
  assert.equal(
    summaryText(progressSummary([{ done: true }, { done: false }, { done: false }])),
    '1 of 3 done',
  );
  assert.equal(summaryText(progressSummary([{ done: true }])), 'Everyone’s done');
});

test('round labels stay positive', () => {
  assert.equal(roundLabel(1), 'Round 1');
  assert.equal(roundLabel(12), 'Round 12');
  assert.equal(roundLabel(0), 'Round 1');
  assert.equal(roundLabel(undefined), 'Round 1');
});

test('names are cleaned and bounded', () => {
  assert.equal(cleanName('  Ada   Lovelace  '), 'Ada Lovelace');
  assert.equal(cleanName('a'.repeat(40)).length, 24);
  assert.equal(isValidName('   '), false);
  assert.equal(isValidName('Ada'), true);
});

test('truncate keeps game titles tidy', () => {
  assert.equal(truncate('Catan', 40), 'Catan');
  assert.equal(truncate('A'.repeat(40), 10), `${'A'.repeat(9)}…`);
});
