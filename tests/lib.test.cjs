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
