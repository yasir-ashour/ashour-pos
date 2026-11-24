const CACHE_NAME = 'ashour-pos-v6';
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
  'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await cache.addAll(CORE_ASSETS);
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
  self.skipWaiting();
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
  if (
    urlStr.includes('firebase') ||
    urlStr.includes('googleapis.com') ||
    urlStr.includes('gstatic.com') ||
    urlStr.includes('supabase')
  ) {
    return;
  }

  const isSameOrigin = urlStr.startsWith(self.location.origin);

  if (isSameOrigin) {
    // Network First للملفات المحلية لضمان وصول التحديثات فوراً
    event.respondWith(
      fetch(req)
        .then((networkRes) => {
          if (networkRes && networkRes.status === 200) {
            const copy = networkRes.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          }
          return networkRes;
        })
        .catch(() =>
          caches.match(req).then((cached) => cached || (req.mode === 'navigate' ? caches.match('./index.html') : undefined))
        )
    );
    return;
  }

  // Cache First للمكتبات الخارجية مع تحديث خلفي
  event.respondWith(
    caches.match(req).then((cached) => {
      const fetchPromise = fetch(req)
        .then((networkRes) => {
          if (networkRes && (networkRes.status === 200 || networkRes.type === 'opaque')) {
            const copy = networkRes.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          }
          return networkRes;
        })
        .catch(() => cached);
      return cached || fetchPromise;
    })
  );
});
