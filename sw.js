const CACHE_NAME = 'ashour-pos-v12';  // ← محدّث
const CORE_ASSETS = [
  './', './index.html', './db.js', './app.js', './firebase-sync.js', './updates.js', './manifest.json'
];
const OPTIONAL_ASSETS = [
  './icon-192.png', './icon.svg',
  'https://cdn.tailwindcss.com',
  'https://cdn.jsdelivr.net/npm/sweetalert2@11',
  'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js',
  'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js',
  'https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await Promise.allSettled(CORE_ASSETS.map(async (asset) => {
        try { const r = await fetch(asset, { cache: 'reload' }); if (r && r.ok) await cache.put(asset, r); } catch (_) {}
      }));
      await Promise.allSettled(OPTIONAL_ASSETS.map(async (url) => {
        try { const r = await fetch(url, { mode: 'no-cors' }); if (r && (r.ok || r.type === 'opaque')) await cache.put(url, r); } catch (_) {}
      }));
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.map((k) => (k !== CACHE_NAME ? caches.delete(k) : Promise.resolve())))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const urlStr = req.url || '';
  if (urlStr.includes('firestore.googleapis.com') || urlStr.includes('identitytoolkit.googleapis.com') || urlStr.includes('securetoken.googleapis.com')) return;
  const isSameOrigin = urlStr.startsWith(self.location.origin);
  if (isSameOrigin) {
    event.respondWith(fetch(req).then((res) => {
      if (res && res.status === 200) { const copy = res.clone(); caches.open(CACHE_NAME).then(c => c.put(req, copy)).catch(() => {}); }
      return res;
    }).catch(() => caches.match(req).then((cached) => cached || (req.mode === 'navigate' ? caches.match('./index.html') : undefined))));
    return;
  }
  event.respondWith(caches.match(req).then((cached) => {
    const fetchPromise = fetch(req).then((res) => {
      if (res && (res.status === 200 || res.type === 'opaque')) { const copy = res.clone(); caches.open(CACHE_NAME).then(c => c.put(req, copy)).catch(() => {}); }
      return res;
    }).catch(() => cached);
    return cached || fetchPromise;
  }));
});
