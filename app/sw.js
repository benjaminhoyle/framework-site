// Makes /app open fast on a phone with a slow connection. It asks the network first, and uses
// this device's copy only if no answer comes quickly, so a new deploy is what people get and an
// old app.js never talks to a newer server for long. It never touches /api, so it cannot serve stale
// data or lose a write. Scope is /app/ only, so the public site knows nothing of it.
const CACHE = 'fw-app-shell-v2';
const SHELL = ['/app/', '/app/config.js', '/css/app.css', '/js/app/rules.js', '/js/app/app.js', '/images/global/fwk-icon.png'];
const WAIT_MS = 1200;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  const navigate = e.request.mode === 'navigate';
  if (!navigate && !SHELL.includes(url.pathname)) return;
  const key = navigate ? '/app/' : url.pathname;
  e.respondWith(caches.open(CACHE).then(async (cache) => {
    const kept = await cache.match(key);
    const fresh = fetch(e.request).then((res) => {
      if (res.ok) cache.put(key, res.clone());
      return res;
    });
    if (!kept) return fresh;
    const slow = new Promise((resolve) => { setTimeout(() => resolve(kept), WAIT_MS); });
    return Promise.race([fresh.catch(() => kept), slow]);
  }));
});
