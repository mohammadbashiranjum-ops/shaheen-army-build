// PWA shell checks: static, no browser, no network.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const manifest = JSON.parse(read('manifest.json'));
const swSrc = read('sw.js');
const html = read('index.html');

function pngSize(file) {
  const b = fs.readFileSync(path.join(root, file));
  assert.strictEqual(b.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', file + ' is not a PNG');
  return b.readUInt32BE(16) + 'x' + b.readUInt32BE(20);
}

test('manifest: relative sub-path-safe urls and required fields', () => {
  for (const k of ['name', 'short_name', 'start_url', 'scope', 'display', 'icons']) assert.ok(manifest[k], k);
  assert.strictEqual(manifest.display, 'standalone');
  for (const k of ['start_url', 'scope', 'id']) assert.match(manifest[k], /^\.\//, k + ' must be relative');
  assert.ok(!JSON.stringify(manifest).includes('"/'), 'no root-absolute path');
});
test('manifest icons exist with declared sizes; 192, 512 and maskable present', () => {
  const purposes = new Set(); const sizes = new Set();
  for (const i of manifest.icons) {
    assert.strictEqual(pngSize(i.src), i.sizes, i.src);
    purposes.add(i.purpose); sizes.add(i.sizes);
  }
  assert.ok(sizes.has('192x192') && sizes.has('512x512'));
  assert.ok(purposes.has('maskable'));
});
test('index.html links manifest, theme-color, apple icon (relative) and registers sw.js guarded', () => {
  assert.match(html, /<link rel="manifest" href="manifest\.json">/);
  assert.match(html, /<meta name="theme-color"/);
  const m = html.match(/<link rel="apple-touch-icon" href="([^"]+)"/);
  assert.ok(m && !m[1].startsWith('/') && fs.existsSync(path.join(root, m[1])));
  assert.match(html, /'serviceWorker' in navigator && location\.protocol === 'https:'/);
  assert.match(html, /register\('sw\.js'\)/);
});
test('sw precache list files all exist', () => {
  const list = [...swSrc.match(/const SHELL = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map(x => x[1]);
  assert.ok(list.length >= 6);
  for (const p of list) {
    const f = p === './' ? 'index.html' : p.replace(/^\.\//, '');
    assert.ok(fs.existsSync(path.join(root, f)), p);
  }
  for (const k of ['./index.html', './shaheen-lib.js', './manifest.json']) assert.ok(list.includes(k), k);
});

// Behavioural: run sw.js in a vm with fake caches/fetch and drive its fetch handler.
function loadSw() {
  const handlers = {}; const store = new Map(); const fetched = [];
  const caches = {
    open: async () => ({ addAll: async () => {}, put: async (r, v) => store.set(r.url, v) }),
    match: async r => store.get(r.url), keys: async () => [], delete: async () => true,
  };
  const self = {
    location: new URL('https://o.github.io/shaheen-army-build/sw.js'),
    addEventListener: (t, f) => { handlers[t] = f; }, skipWaiting() {}, clients: { claim() {} },
  };
  const fetchFn = async req => { fetched.push(req.url); return { ok: true, type: 'basic', clone() { return this; } }; };
  vm.runInNewContext(swSrc, { self, caches, fetch: fetchFn, URL, Promise });
  const dispatch = req => { let p = null; handlers.fetch({ request: req, respondWith: x => { p = x; } }); return p; };
  return { dispatch, store, fetched };
}
const mk = (url, method = 'GET', mode = 'cors') => ({ url, method, mode });
const O = 'https://o.github.io/shaheen-army-build/';

test('sw never handles cross-origin requests (WHOS API, Groq, GitHub)', () => {
  const { dispatch, store } = loadSw();
  for (const u of ['https://whos-backend-production.up.railway.app/api/v1/auth/login',
    'https://api.groq.com/openai/v1/chat/completions', 'https://api.github.com/repos/x']) {
    assert.strictEqual(dispatch(mk(u)), null, u);
    assert.strictEqual(dispatch(mk(u, 'GET', 'navigate')), null, u);
  }
  assert.strictEqual(store.size, 0);
});
test('sw never handles non-GET', () => {
  const { dispatch } = loadSw();
  assert.strictEqual(dispatch(mk(O + 'index.html', 'POST')), null);
  assert.strictEqual(dispatch(mk(O + 'api', 'PUT', 'navigate')), null);
});
test('sw ignores same-origin non-shell subresources and caches only shell urls', async () => {
  const { dispatch, store } = loadSw();
  assert.strictEqual(dispatch(mk(O + 'secret.json')), null);
  await dispatch(mk(O + 'shaheen-lib.js'));
  await dispatch(mk(O + 'index.html', 'GET', 'navigate'));
  await new Promise(r => setImmediate(r));
  assert.ok(store.has(O + 'shaheen-lib.js'));
  await dispatch(mk(O + 'page?token=1', 'GET', 'navigate'));
  await new Promise(r => setImmediate(r));
  assert.ok(!store.has(O + 'page?token=1'), 'non-shell navigation must not be cached');
  assert.deepStrictEqual([...store.keys()].filter(k => !k.startsWith(O)), []);
});
test('sw source: versioned cache, cleanup, no hard-coded absolute origin/path', () => {
  assert.match(swSrc, /const CACHE = 'shaheen-shell-v\d+'/);
  assert.match(swSrc, /caches\.delete/);
  assert.doesNotMatch(swSrc, /https?:\/\//);
  assert.doesNotMatch(swSrc, /['"]\/shaheen/);
});
