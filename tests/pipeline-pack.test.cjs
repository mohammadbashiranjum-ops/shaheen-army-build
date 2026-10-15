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

test('CC-0036 follow-up + Owner checklist: draft-only, gated, only approved price', () => {
  const dir = path.join(__dirname, '..', 'marketing');
  const f = fs.readFileSync(path.join(dir, 'cc-0036-instagram-live-followup-draft.md'), 'utf8');
  assert.match(f, /DRAFT ONLY/); assert.match(f, /read back/);
  [...f.matchAll(/AUD\s*(\d+)/g)].forEach(m => assert.strictEqual(m[1], '350'));
  f.split('\n').filter(l => l.startsWith('>') && !/OWNER:/.test(l)).forEach(l => assert.doesNotMatch(l, /\b(tested|working|warranty|guarantee)\b/i, l));
  const c = fs.readFileSync(path.join(dir, 'owner-weekly-checklist.md'), 'utf8');
  assert.match(c, /Drafts only/); assert.match(c, /read-back/);
  [...c.matchAll(/AUD\s*(\d+)/g)].forEach(m => assert.ok(['350', '300'].includes(m[1])));
});

test('listing-quality drafts: AUD-only prices gated to the Owner, no unsourced claims, 3-5 hashtags', () => {
  const dir = path.join(__dirname, '..', 'marketing', 'listing-quality');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.md')).sort();
  assert.deepStrictEqual(files, ['01-brand-voice-guide.md', '02-caption-templates.md', '03-posting-times.md', '04-next-five-item-drafts.md', '05-seven-day-plan-five-items.md']);
  const quoted = [];
  files.forEach(f => fs.readFileSync(path.join(dir, f), 'utf8').split('\n').forEach(l => { if (l.startsWith('>')) quoted.push(l); }));
  assert.ok(quoted.length > 20);
  quoted.filter(l => !/OWNER:/.test(l)).forEach(l => {
    assert.doesNotMatch(l, /\b(tested|working|warranty|guarantee|genuine|authentic|original|professional-grade|premium brand)\b/i, l);
    assert.doesNotMatch(l, /\b(AUD|\$)\s*\d/, 'price must be Owner-gated: ' + l);
    const tags = l.match(/#\w+/g); if (tags) assert.ok(tags.length >= 3 && tags.length <= 5, 'hashtags 3-5: ' + l);
  });
  quoted.forEach(l => assert.doesNotMatch(l, /\b(USD|NZD|EUR)\b/));
  const times = fs.readFileSync(path.join(dir, '03-posting-times.md'), 'utf8');
  assert.match(times, /UTC\+12/); assert.match(times, /UNVERIFIED/); assert.match(times, /Actual post time/);
  assert.match(fs.readFileSync(path.join(dir, '04-next-five-item-drafts.md'), 'utf8'), /DRAFT ONLY/);
});

test('v2 drafts: sourced item names, no internal costs, test wording only as gated supplier statement', () => {
  const dir = path.join(__dirname, '..', 'marketing', 'listing-quality');
  const d = fs.readFileSync(path.join(dir, '04-next-five-item-drafts.md'), 'utf8');
  ['Makita HS7000', 'Makita DBO180', 'Makita HS6600', 'Makita TD090D'].forEach(n => assert.ok(d.includes(n), n));
  const all = fs.readdirSync(dir).map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
  assert.doesNotMatch(all, /MIN\s*\/\s*MAX|landed|fully loaded|buy cost|\b130\.94\b|\b66\.25\b/i);
  assert.doesNotMatch(d + fs.readFileSync(path.join(dir, '05-seven-day-plan-five-items.md'), 'utf8'), /\bAUD\s?\d{2,}/);
  d.split('\n').filter(l => /tested/i.test(l) && l.startsWith('>')).forEach(l => assert.match(l, /OWNER:/));
  assert.match(d, /not re-tested by us/); assert.match(d, /supplier's statement/);
  assert.match(fs.readFileSync(path.join(dir, '05-seven-day-plan-five-items.md'), 'utf8'), /UNVERIFIED/);
});
