// sw.js — مركز عاشور POS
const VERSION = 'v13';
const CACHE_NAME = 'ashour-pos-' + VERSION;
const NETWORK_TIMEOUT_MS = 4000;

const CORE_ASSETS = [
  './', './index.html', './app.js', './db.js', './firebase-sync.js', './ashour-fixes.js',
  './manifest.json', './icon-192.png', './icon-512.png', './maskable-512.png', './icon.svg'
];

const CDN_ASSETS = [
  'https://cdn.tailwindcss.com',
  'https://cdn.jsdelivr.net/npm/sweetalert2@11',
  'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js',
  'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
  'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&family=Inter:wght@500;600;700&family=Cairo:wght@600;800&family=Montserrat:wght@700;800&display=swap',
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js',
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js',
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js'
];

const CDN_HOSTS = [
  'cdn.tailwindcss.com', 'cdn.jsdelivr.net', 'unpkg.com',
  'cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com'
];

function isCdn(url) {
  if (url.hostname === 'www.gstatic.com') return url.pathname.startsWith('/firebasejs/');
  return CDN_HOSTS.includes(url.hostname);
}

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(CORE_ASSETS.map((u) => cache.add(new Request(u, { cache: 'reload' })).catch(() => {})));
    await Promise.all(CDN_ASSETS.map(async (u) => {
      try {
        let res = await fetch(u, { mode: 'cors' }).catch(() => null);
        if (!res || !res.ok) res = await fetch(u, { mode: 'no-cors' });
        await cache.put(u, res);
      } catch (_) {}
    }));
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('ashour-pos-') && k !== CACHE_NAME).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

function fetchFresh(req, ms) {
  const ctrl = new AbortController();
  const timer = ms > 0 ? setTimeout(() => ctrl.abort(), ms) : null;
  return fetch(req, { cache: 'no-cache', signal: ctrl.signal }).finally(() => { if (timer) clearTimeout(timer); });
}

async function networkFirst(req, event) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(req, { ignoreSearch: true });
  try {
    const res = await fetchFresh(req, cached ? NETWORK_TIMEOUT_MS : 0);
    if (res && res.status === 200) event.waitUntil(cache.put(req, res.clone()));
    return res;
  } catch (_) {
    if (cached) return cached;
    if (req.mode === 'navigate') {
      const shell = await cache.match('./index.html');
      if (shell) return shell;
    }
    return Response.error();
  }
}

async function staleWhileRevalidate(req, event) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(req);
  const update = fetch(req).then((res) => {
    if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
    return res;
  }).catch(() => null);
  if (cached) { event.waitUntil(update); return cached; }
  return (await update) || Response.error();
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) event.respondWith(networkFirst(req, event));
  else if (isCdn(url)) event.respondWith(staleWhileRevalidate(req, event));
});
