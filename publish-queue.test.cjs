const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const {
  DEFAULT_PRIORITY,
  normalizePriority,
  sortPublishQueue,
  sortPublishQueueForDisplay,
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

test('displays eligible rows in execution order and blocked rows after them', () => {
  const rows = sortPublishQueueForDisplay([
    candidate('BLOCKED', { status: 'PUBLISHED', publishable: false }),
    candidate('P2'),
    candidate('P0'),
    candidate('DUP'),
    candidate('DUP'),
    candidate('BLOCKED-2', { publishable: false }),
  ], {
    P2: 'P2',
    P0: 'P0',
    DUP: 'P1',
  });

  assert.deepEqual(rows.map((item) => [item.sku, item.priority, item.queueEligible]), [
    ['P0', 'P0', true],
    ['DUP', 'P1', true],
    ['P2', 'P2', true],
    ['BLOCKED', 'P4', false],
    ['BLOCKED-2', 'P4', false],
  ]);
});

test('re-renders and reorders the UI immediately after a priority change', async () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const start = html.indexOf('function renderPublishQueue(items) {');
  const end = html.indexOf('\n}\n\nasync function loadPublishPriorities()', start);
  assert.ok(start >= 0 && end > start, 'priority queue renderer must exist in index.html');

  const elements = new Map();
  function createElement(tagName) {
    return {
      tagName,
      children: [],
      attributes: {},
      listeners: {},
      appendChild(child) { this.children.push(child); },
      replaceChildren() { this.children = []; },
      setAttribute(name, value) { this.attributes[name] = value; },
      addEventListener(name, listener) { this.listeners[name] = listener; },
    };
  }

  const root = createElement('div');
  const status = createElement('div');
  elements.set('priorityQueueList', root);
  elements.set('publishQueueStatus', status);
  const priorities = { A: 'P1', B: 'P2' };
  const items = [candidate('A', { title: 'Alpha' }), candidate('B', { title: 'Beta' })];
  const context = {
    window: { PublishQueueLogic: require('./publish-queue.js') },
    document: {
      createElement,
      getElementById(id) { return elements.get(id) || null; },
    },
    readPublishPriorities() { return { ...priorities }; },
    savePublishPriority(sku, value) { priorities[sku] = value; },
    currentPublishQueue: items,
  };

  const rendererSource = `${html.slice(start, end + 2)}; renderPublishQueue;`;
  const renderPublishQueue = vm.runInNewContext(rendererSource, context);
  context.renderPublishQueue = renderPublishQueue;
  renderPublishQueue(items);
  assert.deepEqual(root.children.map((row) => row.children[0].textContent.split(' | ')[0]), [
    'P1',
    'P2',
  ]);

  const rowA = root.children.find((row) => row.children[0].textContent.startsWith('P1 | A'));
  assert.ok(rowA, 'P1 row should render first before the edit');
  const selectA = rowA.children[1];
  selectA.value = 'P4';
  await selectA.listeners.change();

  assert.deepEqual(root.children.map((row) => row.children[0].textContent.split(' | ')[0]), [
    'P2',
    'P4',
  ]);
  assert.match(status.textContent, /A: P4 saved/);
});
