const CACHE_NAME = 'weather-unusualness-cache-v1';
const urlsToCache = [
    '/',
    '/index.html',
    '/style.css',
    '/script.js',
    '/manifest.json',
    '/icons/icon-192x192.png',
    '/icons/icon-512x512.png'
];

// Install event: Open cache and add files
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('Opened cache');
                return cache.addAll(urlsToCache);
            })
    );
    self.skipWaiting(); // Force the waiting service worker to become the active service worker
});

// Activate event: Clean up old caches
self.addEventListener('activate', event => {
    const cacheWhitelist = [CACHE_NAME];
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    if (cacheWhitelist.indexOf(cacheName) === -1) {
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
    return self.clients.claim(); // Take control of clients without waiting for reload
});

// Fetch event: Serve cached content when offline
self.addEventListener('fetch', event => {
    // We only want to cache GET requests for app assets, not API calls
    if (event.request.method === 'GET' && urlsToCache.some(url => event.request.url.endsWith(url))) {
         event.respondWith(
            caches.match(event.request)
                .then(response => {
                    // Cache hit - return response
                    if (response) {
                        return response;
                    }
                    // Not in cache - fetch and cache
                    return fetch(event.request).then(
                        response => {
                            // Check if we received a valid response
                            if (!response || response.status !== 200 || response.type !== 'basic' && !response.type === 'opaque') {
                                return response;
                            }

                            // IMPORTANT: Clone the response. A response is a stream
                            // and because we want the browser to consume the response
                            // as well as the cache consuming the response, we need
                            // to clone it so we have two streams.
                            const responseToCache = response.clone();

                            caches.open(CACHE_NAME)
                                .then(cache => {
                                    cache.put(event.request, responseToCache);
                                });

                            return response;
                        }
                    );
                })
        );
    } else {
        // For non-GET requests or API calls, just fetch from the network
        event.respondWith(fetch(event.request));
    }
});