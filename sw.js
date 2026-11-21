const CACHE_NAME = 'apodtok-cache-v3';
const RUNTIME_CACHE = 'apodtok-runtime-v3';

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

// Fetch event
self.addEventListener('fetch', event => {
    // Skip cross-origin requests (NASA API calls and images go straight to the network)
    if (!event.request.url.startsWith(self.location.origin)) {
        return;
    }

    // Never cache Netlify Function responses (the APOD feed endpoint)
    if (event.request.url.includes('/.netlify/functions/')) {
        return;
    }

    // Network-first for the app shell (HTML/JS/CSS) so updates reach users
    // immediately; fall back to cache when offline.
    event.respondWith(
        fetch(event.request)
            .then(response => {
                if (response.ok) {
                    const clonedResponse = response.clone();
                    caches.open(RUNTIME_CACHE).then(cache => {
                        cache.put(event.request, clonedResponse);
                    });
                }
                return response;
            })
            .catch(() => {
                return caches.match(event.request).then(cachedResponse => {
                    return cachedResponse || caches.match('/index.html');
                });
            })
    );
});
