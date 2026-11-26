const CACHE_NAME = 'ashour-pos-v11';
const CORE_ASSETS = [
  './',
  './index.html',
  './db.js',
  './app.js',
  './firebase-sync.js',
  './manifest.json'
];
const OPTIONAL_ASSETS = [
  './icon-192.png',
  './icon.svg',
  'https://cdn.tailwindcss.com',
  'https://cdn.jsdelivr.net/npm/sweetalert2@11',
  'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js',
  'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await Promise.allSettled(
        CORE_ASSETS.map(async (asset) => {
          try {
            const resp = await fetch(asset, { cache: 'reload' });
            if (resp && resp.ok) {
              await cache.put(asset, resp);
            }
          } catch (_) {}
        })
      );
      await Promise.allSettled(
        OPTIONAL_ASSETS.map(async (url) => {
          try {
            const resp = await fetch(url, { mode: 'no-cors' });
            if (resp && (resp.ok || resp.type === 'opaque')) {
              await cache.put(url, resp);
            }
          } catch (_) {}
        })
      );
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((key) => (key !== CACHE_NAME ? caches.delete(key) : Promise.resolve())))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const urlStr = req.url || '';
  if (
    urlStr.includes('firestore.googleapis.com') ||
    urlStr.includes('identitytoolkit.googleapis.com') ||
    urlStr.includes('securetoken.googleapis.com')
  ) {
    return;
  }

  const isSameOrigin = urlStr.startsWith(self.location.origin);

  if (isSameOrigin) {
    event.respondWith(
      fetch(req)
        .then((networkRes) => {
          if (networkRes && networkRes.status === 200) {
            const copy = networkRes.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => {});
          }
          return networkRes;
        })
        .catch(() =>
          caches.match(req).then((cached) => {
            if (cached) return cached;
            if (req.mode === 'navigate') return caches.match('./index.html');
            return undefined;
          })
        )
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      const fetchPromise = fetch(req)
        .then((networkRes) => {
          if (networkRes && (networkRes.status === 200 || networkRes.type === 'opaque')) {
            const copy = networkRes.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => {});
          }
          return networkRes;
        })
        .catch(() => cached);
      return cached || fetchPromise;
    })
  );
});
