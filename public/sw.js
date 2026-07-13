// FlightWall service worker: cache the app shell so the wall opens instantly
// and degrades to its own SIGNAL LOST state offline. Live-data APIs and photo
// hosts are cross-origin and deliberately never intercepted or cached.
const CACHE = 'flightwall-shell-v1';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== location.origin) return; // network-only for APIs/photos

  if (request.mode === 'navigate') {
    // Network-first so deploys propagate; cached shell covers offline starts.
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy));
          return res;
        })
        .catch(() =>
          caches.match(request).then((hit) => hit ?? caches.match('./')).then(
            (hit) => hit ?? Response.error(),
          ),
        ),
    );
    return;
  }

  // Hashed assets, icons, fonts: cache-first (immutable or cheap to refresh).
  event.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ??
        fetch(request).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(request, copy));
          }
          return res;
        }),
    ),
  );
});
