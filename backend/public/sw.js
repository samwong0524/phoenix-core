// Minimal PWA service worker — cache static assets, network-first for API
// Update to v2 to bust old cache
const CACHE_NAME = 'swarm-v2';
const STATIC_ASSETS = [
  '/',
  '/im',
  '/manifest.json',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((c) => c.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((ks) =>
      Promise.all(ks.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  // Bypass cache for POST requests
  if (e.request.method !== 'GET') return;

  const url = new URL(e.request.url);

  // CRITICAL FIX: Next.js chunks change on every build.
  // Caching them causes "ChunkLoadError" or missing files in dev mode.
  if (url.pathname.startsWith('/_next/')) {
    e.respondWith(fetch(e.request));
    return;
  }

  // API and streaming: network-first
  if (url.pathname.startsWith('/api/') || url.pathname.includes('stream')) {
    e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
    return;
  }

  // Static assets: cache-first
  e.respondWith(
    caches.match(e.request).then((r) => r || fetch(e.request).then((res) => {
      if (res.ok) {
        const clone = res.clone();
        caches.open(CACHE_NAME).then((c) => c.put(e.request, clone));
      }
      return res;
    }).catch(() => caches.match('/')))
  );
});
