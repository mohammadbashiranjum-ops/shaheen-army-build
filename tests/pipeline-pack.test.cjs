const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const W = require('../live-week.js');

test('pipeline keeps only display fields and counts by availability', () => {
  const items = W.summarizeItems([
    { title: 'A', publicPrice: '350.00', currencyCode: 'AUD', availability: 'IN_STOCK', inventoryItem: { sku: 'CC-1', brand: 'x' }, description: 'secret-ish' },
    { title: 'B', publicPrice: '300.00', currencyCode: 'AUD', availability: 'RESERVED', inventoryItem: { sku: 'CC-2' } }]);
  assert.deepStrictEqual(Object.keys(items[0]).sort(), ['availability', 'currency', 'price', 'sku', 'title']);
  assert.deepStrictEqual(W.pipelineSummary(items), { total: 2, byAvailability: { IN_STOCK: 1, RESERVED: 1 } });
});
test('checkLive exposes catalog items', async () => {
  const r = async u => ({ ok: true, status: 200, json: async () => /health/.test(u) ? { status: 'ok' } : [{ title: 'A', inventoryItem: { sku: 'CC-1' } }] });
  assert.strictEqual((await W.checkLive(r, 1)).catalog.items[0].sku, 'CC-1');
});

const pack = fs.readFileSync(path.join(__dirname, '..', 'marketing', 'week-content-pack.md'), 'utf8');
test('content pack: 7 days, draft-only, FB+IG', () => {
  ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].forEach(d => assert.match(pack, new RegExp('^## ' + d + ' ', 'm')));
  assert.match(pack, /DRAFT ONLY/); assert.match(pack, /Facebook/); assert.match(pack, /Instagram/);
});
test('content pack: only Owner-approved prices', () => {
  const amounts = [...pack.matchAll(/AUD\s*(\d+)/g)].map(m => m[1]);
  assert.ok(amounts.length >= 3); amounts.forEach(a => assert.ok(['350', '300'].includes(a), 'unapproved price ' + a));
  assert.doesNotMatch(pack, /\$\s*\d|\bUSD\b|\bNZD\b/);
});
test('content pack: no unconfirmed tested/working claim in post text', () => {
  const posts = pack.split('\n').filter(l => l.startsWith('>') && !/OWNER:/.test(l));
  posts.forEach(l => assert.doesNotMatch(l, /\b(tested|working|warranty|guarantee)\b/i, l));
});

test('CC-0023 drafts: only AUD 300, owner blanks present, no tested/working claim outside an OWNER-gated line', () => {
  const t = fs.readFileSync(path.join(__dirname, '..', 'marketing', 'cc-0023-makita-hs7000-drafts.md'), 'utf8');
  assert.match(t, /DRAFT ONLY/); assert.match(t, /\[OWNER:/);
  [...t.matchAll(/AUD\s*(\d+)/g)].forEach(m => assert.strictEqual(m[1], '300'));
  t.split('\n').filter(l => l.startsWith('>') && !/OWNER:/.test(l)).forEach(l => assert.doesNotMatch(l, /\b(tested|working|warranty|guarantee)\b/i, l));
});
