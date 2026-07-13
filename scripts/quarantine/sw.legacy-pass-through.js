// Simple Service Worker placeholder
self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        try {
            const cacheKeys = await caches.keys();
            await Promise.all(cacheKeys.map((key) => caches.delete(key)));
        } catch (error) {
            console.warn('SW cache cleanup failed:', error);
        }
        await self.clients.claim();
    })());
});

self.addEventListener('install', (event) => {
    self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
    // Pass-through
    event.respondWith(fetch(event.request));
});
