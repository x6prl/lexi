const CACHE = 'app-v1.3';
const ASSETS =
    ['./', './manifest.webmanifest', './icon-192.png', './icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE)
                  .then(c => c.addAll(ASSETS))
                  .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
                  .then(
                      keys => Promise.all(
                          keys.map(k => k !== CACHE ? caches.delete(k) : null)))
                  .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;

  if (e.request.mode === 'navigate' || e.request.destination === 'document') {
    e.respondWith((async () => {
      try {
        const fresh = await fetch(e.request);
        const copy = fresh.clone();
        (await caches.open(CACHE)).put(e.request, copy);
        return fresh;
      } catch {
        return (await caches.match(e.request)) || (await caches.match('./'));
      }
    })());
    return;
  }

  e.respondWith(caches.match(e.request).then(
      cached => cached || fetch(e.request).then(resp => {
        const copy = resp.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return resp;
      })));
});
