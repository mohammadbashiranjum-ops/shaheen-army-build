const test = require('node:test');
const assert = require('node:assert');
const L = require('../shaheen-lib.js');

test('publish is locked', () => assert.strictEqual(L.PUBLISH_UNLOCKED, false));

test('403 says permission nahi with real status, never "unknown"', () => {
  const m = L.describeError('WHOS /projects', { status: 403, data: { message: 'Forbidden resource' } });
  assert.match(m, /permission nahi/); assert.match(m, /HTTP 403/); assert.doesNotMatch(m, /unknown/);
});
test('401/404/500/network messages carry status', () => {
  assert.match(L.describeError('x', { status: 401 }), /HTTP 401/);
  assert.match(L.describeError('x', { status: 404 }), /HTTP 404/);
  assert.match(L.describeError('x', { status: 500 }), /HTTP 500/);
  assert.match(L.describeError('x', { status: 0, error: 'Failed to fetch' }), /network/);
});
test('secrets are redacted from messages', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijk';
  const m = L.describeError('x', { status: 400, data: { message: 'bad ' + jwt + ' gsk_abcdefgh12345 ghp_abcdefghijklmnop1234' } });
  assert.doesNotMatch(m, /eyJ|gsk_|ghp_/);
});
test('normalizeList handles shapes', () => {
  assert.deepStrictEqual(L.normalizeList([1]), [1]);
  assert.deepStrictEqual(L.normalizeList({ data: [2] }), [2]);
  assert.deepStrictEqual(L.normalizeList({ items: [3] }), [3]);
  assert.strictEqual(L.normalizeList({ foo: 1 }), null);
});
test('renderRows escapes html', () => {
  assert.doesNotMatch(L.renderRows([{ name: '<img onerror=x>' }], 'project'), /<img/);
});
test('tokenExpiryMs', () => {
  const p = Buffer.from(JSON.stringify({ exp: 2000000000 })).toString('base64url');
  assert.strictEqual(L.tokenExpiryMs('h.' + p + '.s'), 2000000000000);
  assert.strictEqual(L.tokenExpiryMs('garbage'), null);
});
test('approval draft dedupes and counts, makes no calls', () => {
  const d = L.buildApprovalDraft([{ sku: 'A' }, { sku: 'A' }, { sku: 'B' }], ['FACEBOOK_PAGE', 'INSTAGRAM']);
  assert.strictEqual(d.itemCount, 2); assert.strictEqual(d.postCount, 4);
  assert.match(d.text, /abhi kuch publish nahi hua/);
});

// --- IT Workshop: the lane must mirror the operator success rule exactly ---

test('the lane knows all eleven states and only VERIFIED_PASS is success', () => {
  assert.strictEqual(L.IT_LANE_STATES.length, 11);
  for (const s of L.IT_LANE_STATES) {
    assert.strictEqual(L.isOperatorSuccess(s), s === 'VERIFIED_PASS', s + ' success must be exactly VERIFIED_PASS');
  }
});

test('presentLane reads the server state and nothing else', () => {
  assert.strictEqual(L.presentLane({ lane: { state: 'VERIFIED_PASS' } }).success, true);
  for (const s of L.IT_LANE_STATES) {
    if (s === 'VERIFIED_PASS') continue;
    assert.strictEqual(L.presentLane({ lane: { state: s } }).success, false, s + ' must not be success');
  }
});

test('an unknown state is treated as unproven, never success', () => {
  const p = L.presentLane({ lane: { state: 'SOME_NEW_STATE' } });
  assert.strictEqual(p.success, false);
  assert.strictEqual(p.tone, 'unproven');
});

test('EXECUTION_INDETERMINATE is unproven, not failed', () => {
  assert.strictEqual(L.presentLane({ lane: { state: 'EXECUTION_INDETERMINATE' } }).tone, 'unproven');
});

test('every state has exactly one manual step', () => {
  for (const s of L.IT_LANE_STATES) {
    const step = L.MANUAL_STEPS[s];
    assert.ok(step, s + ' has no manual step');
    assert.ok(step.label && step.customerDetail && step.action, s + ' step is incomplete');
  }
});

test('customerReading takes success only from presentLane', () => {
  for (const s of L.IT_LANE_STATES) {
    const r = L.customerReading({ lane: { state: s } });
    assert.strictEqual(r.success, L.isOperatorSuccess(s), s);
  }
});

test('no engine vocabulary reaches the customer strings', () => {
  const banned = /\b(PR|agent|session|station|pipeline|Files|verdict|merge)\b/i;
  for (const s of L.IT_LANE_STATES) {
    assert.doesNotMatch(L.CUSTOMER_HEADLINES[s], banned, 'headline ' + s);
    assert.doesNotMatch(L.CUSTOMER_MESSAGES[s], banned, 'message ' + s);
    assert.doesNotMatch(L.MANUAL_STEPS[s].customerDetail, banned, 'detail ' + s);
  }
});

test('the customer report says OUTCOME PROVEN only for a real pass', () => {
  for (const s of L.IT_LANE_STATES) {
    const reading = L.customerReading({ lane: { state: s } });
    const text = L.customerReportText({ jobCode: 'J1', deviceLabel: 'Phone', reading });
    if (s === 'VERIFIED_PASS') assert.match(text, /OUTCOME PROVEN/);
    else { assert.match(text, /NOT YET PROVEN/); assert.doesNotMatch(text, /OUTCOME PROVEN/); }
  }
});

test('loadItJobs is GET-only and hits the IT service jobs endpoint', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => { calls.push(opts.method + ' ' + url); return { ok: true, status: 200, json: async () => ({ data: [{ job: { jobCode: 'X' }, lane: { state: 'INTAKE_ONLY' } }] }) }; };
  const r = await L.loadItJobs(fetchImpl, 'tok', 'https://whos.example/');
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0], 'GET https://whos.example/api/v1/it-service/jobs');
  assert.strictEqual(r.jobs.length, 1);
});

test('loadItJobs reports a 403 as permission nahi with the real status', async () => {
  const fetchImpl = async () => ({ ok: false, status: 403, json: async () => ({ message: 'Forbidden' }) });
  const r = await L.loadItJobs(fetchImpl, 'tok', 'https://whos.example');
  assert.match(r.error, /permission nahi/); assert.match(r.error, /HTTP 403/);
});

test('ci and review verdicts', () => {
  assert.strictEqual(L.ciState({ check_runs: [] }), 'no checks');
  assert.strictEqual(L.ciState({ check_runs: [{ status: 'completed', conclusion: 'failure' }] }), 'FAIL');
  assert.strictEqual(L.ciState({ check_runs: [{ status: 'completed', conclusion: 'success' }] }), 'PASS');
  assert.strictEqual(L.reviewVerdict([{ user: { login: 'a' }, state: 'APPROVED' }, { user: { login: 'a' }, state: 'CHANGES_REQUESTED' }]), 'changes requested');
});
test('request/PR board/spend only ever use GET', async () => {
  const methods = [];
  const f = async (u, o) => { methods.push(o.method); return { ok: true, status: 200, json: async () => (/pulls\?/.test(u) ? [{ number: 1, title: 't', head: { sha: 'abcdef012' } }] : /check-runs/.test(u) ? { check_runs: [] } : []) }; };
  await L.loadPrBoard(f, 'tok'); await L.loadSpend(f, 'tok', 'org');
  assert.ok(methods.length >= 3); assert.ok(methods.every(m => m === 'GET'));
});
test('private repo 404 is reported as permission nahi', async () => {
  const f = async () => ({ ok: false, status: 404, json: async () => ({}) });
  assert.match((await L.loadPrBoard(f, '')).error, /permission nahi/);
});
