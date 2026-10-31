// SHAHEEN app-shell service worker. Scope = the directory it is served from (/shaheen-army-build/).
// Same-origin GET only. Cross-origin (WHOS API, Groq, GitHub) is never intercepted, and
// nothing but the fixed shell list below is ever written to the cache.
const CACHE = 'shaheen-shell-v1';
const SHELL = ['./', './index.html', './shaheen-lib.js', './manifest.json',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png', './icons/apple-touch-icon.png'];
const SHELL_URLS = SHELL.map(p => new URL(p, self.location).href);

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k.startsWith('shaheen-shell-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const isShell = SHELL_URLS.includes(url.href);
  if (req.mode !== 'navigate' && !isShell) return;
  // Network-first so a deploy is never masked by a stale shell; cache is the offline fallback.
  e.respondWith(fetch(req).then(res => {
    if (isShell && res.ok && res.type === 'basic') {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(req, copy));
    }
    return res;
  }).catch(() => caches.match(req).then(hit => hit || caches.match('./index.html'))));
});
