const test = require('node:test');
const assert = require('node:assert');
const W = require('../live-week.js');

const resp = (status, body) => ({ ok: status < 400, status, json: async () => body });
const okFetch = async u => /health/.test(u) ? resp(200, { status: 'ok', commit: 'abcdef0123456', uptimeSeconds: 5 }) : resp(200, [{ id: 1 }, { id: 2 }]);

test('LIVE only when both calls succeeded just now; calls are GET without credentials/auth', async () => {
  const seen = [];
  const f = async (u, o) => { seen.push([u, o]); return okFetch(u); };
  const r = await W.checkLive(f, 1000);
  assert.strictEqual(W.label(r.health), 'LIVE'); assert.strictEqual(r.catalog.count, 2); assert.strictEqual(r.health.commit, 'abcdef0');
  assert.deepStrictEqual(seen.map(x => x[0]), [W.BASE + '/health', W.BASE + '/inventory/public/catalog']);
  seen.forEach(([, o]) => { assert.strictEqual(o.method, 'GET'); assert.strictEqual(o.credentials, 'omit'); assert.ok(!o.headers); assert.ok(!o.body); });
});
test('HTTP error and network error are UNKNOWN with detail, never LIVE', async () => {
  const r1 = await W.checkLive(async () => resp(503, {}), 1);
  assert.strictEqual(W.label(r1.health), 'UNKNOWN'); assert.strictEqual(r1.health.detail, 'HTTP 503');
  const r2 = await W.checkLive(async () => { throw new TypeError('x'); }, 1);
  assert.strictEqual(r2.catalog.detail, 'network');
});
test('200 with wrong shape is not LIVE', async () => {
  const r = await W.checkLive(async u => resp(200, /health/.test(u) ? { status: 'down' } : { not: 'array' }), 1);
  assert.strictEqual(W.label(r.health), 'UNKNOWN'); assert.strictEqual(W.label(r.catalog), 'UNKNOWN');
});
test('cardState: loading, fresh, stale, error', () => {
  const bad = { checkedAt: 10_000_000, health: { ok: false }, catalog: { ok: false } };
  const good = { checkedAt: 9_900_000, health: { ok: true }, catalog: { ok: true } };
  assert.strictEqual(W.cardState(null, null, 0).kind, 'LOADING');
  assert.strictEqual(W.cardState(good, good, good.checkedAt).kind, 'FRESH');
  const st = W.cardState(bad, good, 10_000_000);
  assert.strictEqual(st.kind, 'STALE'); assert.strictEqual(st.health, 'UNKNOWN');
  assert.strictEqual(W.cardState(bad, good, 10_000_000 + W.STALE_MS + 1).kind, 'ERROR');
  assert.strictEqual(W.cardState(bad, null, 1).kind, 'ERROR');
});
test('marketing week is the fixed Mon..Sun plan', () => {
  assert.deepStrictEqual(W.MARKETING_WEEK.map(x => x.day), ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
  assert.match(W.MARKETING_WEEK[5].task, /Nauru/);
});
test('weekKey is ISO and changes per week', () => {
  assert.strictEqual(W.weekKey(new Date(2026, 9, 15)), 'shaheen_week_2026-W42');
  assert.notStrictEqual(W.weekKey(new Date(2026, 9, 15)), W.weekKey(new Date(2026, 9, 22)));
});
test('checklist storage survives bad/blocked storage', () => {
  const mem = {}; const s = { getItem: k => mem[k] || null, setItem: (k, v) => { mem[k] = v; } };
  assert.ok(W.saveChecks(s, 'k', { Mon: true })); assert.deepStrictEqual(W.loadChecks(s, 'k'), { Mon: true });
  mem.k = '{bad'; assert.deepStrictEqual(W.loadChecks(s, 'k'), {});
  const boom = { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); } };
  assert.deepStrictEqual(W.loadChecks(boom, 'k'), {}); assert.strictEqual(W.saveChecks(boom, 'k', {}), false);
});
