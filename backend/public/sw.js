// Minimal PWA service worker — cache static assets, network-first for API
const CACHE_NAME = 'swarm-v1';
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
  const url = new URL(e.request.url);
  // API and streaming: network-first
  if (url.pathname.startsWith('/api/') || url.pathname.includes('stream')) {
    e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
    return;
  }
  // Static assets: cache-first
  e.respondWith(
    caches.match(e.request).then((r) => r || fetch(e.request).then((res) => {
      return caches.open(CACHE_NAME).then((c) => {
        c.put(e.request, res.clone());
        return res;
      });
    }).catch(() => caches.match('/')))
  );
});
