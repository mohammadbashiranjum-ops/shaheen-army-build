const assert = require('node:assert/strict');
const test = require('node:test');
const {
  DEFAULT_PRIORITY,
  normalizePriority,
  sortPublishQueue,
} = require('./publish-queue.js');

function candidate(sku, overrides = {}) {
  return {
    sku,
    lifecycleStatus: 'LISTING_READY',
    status: 'LISTING_READY',
    publishable: true,
    imageCount: 3,
    ...overrides,
  };
}

test('accepts the backend publishable boolean contract and orders P0 through P4', () => {
  const items = [
    candidate('CC-4'),
    candidate('CC-0'),
    candidate('CC-1'),
    candidate('CC-2'),
    candidate('CC-3'),
  ];
  const ordered = sortPublishQueue(items, {
    'CC-0': 'P0',
    'CC-1': 'P1',
    'CC-2': 'P2',
    'CC-3': 'P3',
  });

  assert.deepEqual(ordered.map((item) => [item.sku, item.priority]), [
    ['CC-0', 'P0'],
    ['CC-1', 'P1'],
    ['CC-2', 'P2'],
    ['CC-3', 'P3'],
    ['CC-4', 'P4'],
  ]);
});

test('filters PUBLISHED, non-LISTING_READY, blocked, and photo-incomplete items', () => {
  const ordered = sortPublishQueue([
    candidate('READY'),
    candidate('PUBLISHED', { status: 'PUBLISHED', publishable: false }),
    candidate('VERIFIED', { lifecycleStatus: 'VERIFIED' }),
    candidate('TOO-FEW', { imageCount: 1, status: 'BLOCKED', publishable: false }),
    candidate('TOO-MANY', { imageCount: 7, status: 'BLOCKED', publishable: false }),
    candidate('SERVER-BLOCKED', { publishable: false }),
  ]);

  assert.deepEqual(ordered.map((item) => item.sku), ['READY']);
});

test('defaults missing or invalid priority to P4 without assigning merit by guess', () => {
  assert.equal(DEFAULT_PRIORITY, 'P4');
  assert.equal(normalizePriority(undefined), 'P4');
  assert.equal(normalizePriority('P9'), 'P4');
  assert.deepEqual(
    sortPublishQueue([candidate('UNASSIGNED')]).map((item) => [item.sku, item.priority]),
    [['UNASSIGNED', 'P4']],
  );
});

test('deduplicates SKUs before the priority-ordered POST list is constructed', () => {
  const ordered = sortPublishQueue(
    [candidate('DUP'), candidate('OTHER'), candidate('DUP')],
    { DUP: 'P1', OTHER: 'P2' },
  );

  assert.deepEqual(ordered.map((item) => item.sku), ['DUP', 'OTHER']);
});
