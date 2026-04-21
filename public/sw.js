const CACHE_NAME = 'ailaoda-shell-v2';
const CORE_ASSETS = ['/', '/manifest.json', '/icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(CORE_ASSETS))
      .finally(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => clients.claim())
  );
});

const isApiRequest = request => new URL(request.url).pathname.startsWith('/api/');
const isStaticAsset = request => {
  const pathname = new URL(request.url).pathname;
  return pathname.startsWith('/assets/')
    || pathname === '/manifest.json'
    || pathname === '/icon.svg'
    || pathname === '/sw.js';
};

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || isApiRequest(request)) return;

  if (isStaticAsset(request)) {
    event.respondWith(
      fetch(request)
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put('/', copy));
          return response;
        })
        .catch(() => caches.match('/'))
    );
  }
});
