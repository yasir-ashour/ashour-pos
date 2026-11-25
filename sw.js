const CACHE_NAME = 'ashour-pos-v10';
const CORE_ASSETS = ['./', './index.html', './db.js', './app.js', './firebase-sync.js', './manifest.json'];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS).catch(() => {}))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((key) => (key !== CACHE_NAME ? caches.delete(key) : Promise.resolve())))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const urlStr = req.url || '';
  if (urlStr.includes('firebase') || urlStr.includes('googleapis.com') || urlStr.includes('gstatic.com')) return;
  const isSameOrigin = urlStr.startsWith(self.location.origin);
  if (isSameOrigin) {
    event.respondWith(
      fetch(req).then((networkRes) => {
        if (networkRes && networkRes.status === 200) {
          const copy = networkRes.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        }
        return networkRes;
      }).catch(() =>
        caches.match(req).then((cached) => cached || (req.mode === 'navigate' ? caches.match('./index.html') : undefined))
      )
    );
    return;
  }
});
