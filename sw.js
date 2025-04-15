const CACHE_NAME = 'apodtok-cache-v1';
const RUNTIME_CACHE = 'apodtok-runtime';

// Resources to cache on install
const PRECACHE_URLS = [
    '/',
    '/index.html',
    '/styles.css',
    '/app.js',
    '/favicon.svg'
];

// Install event - precache static assets
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(PRECACHE_URLS))
            .then(() => self.skipWaiting())
    );
});

// Activate event - cleanup old caches
self.addEventListener('activate', event => {
    const currentCaches = [CACHE_NAME, RUNTIME_CACHE];
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return cacheNames.filter(cacheName => !currentCaches.includes(cacheName));
        }).then(cachesToDelete => {
            return Promise.all(cachesToDelete.map(cacheToDelete => {
                return caches.delete(cacheToDelete);
            }));
        }).then(() => self.clients.claim())
    );
});

// Fetch event - network first, then cache
self.addEventListener('fetch', event => {
    // Skip cross-origin requests
    if (!event.request.url.startsWith(self.location.origin)) {
        return;
    }

    // Handle API requests differently
    if (event.request.url.includes('api.nasa.gov')) {
        event.respondWith(
            fetch(event.request)
                .then(response => {
                    // Cache response for future offline use
                    const clonedResponse = response.clone();
                    caches.open(RUNTIME_CACHE).then(cache => {
                        cache.put(event.request, clonedResponse);
                    });
                    return response;
                })
                .catch(() => {
                    // If offline, try to return cached response
                    return caches.match(event.request);
                })
        );
        return;
    }

    // For all other requests, try cache first, then network
    event.respondWith(
        caches.match(event.request)
            .then(cachedResponse => {
                if (cachedResponse) {
                    return cachedResponse;
                }

                return caches.open(RUNTIME_CACHE)
                    .then(cache => {
                        return fetch(event.request)
                            .then(response => {
                                // Cache the response for future use
                                cache.put(event.request, response.clone());
                                return response;
                            });
                    });
            })
    );
}); 