const CACHE_NAME = 'attendance-pro-v2'; // Increment version if you update cached files
const urlsToCache = [
  '/',
  '/static/style.css',
  '/static/script.js',
  '/static/manifest.json',
  // Paths to your required icons (must exist)
  '/static/icons/icon-192x192.png',
  '/static/icons/icon-512x512.png',
  // External Libraries (Cache-first strategy)
  'https://cdn.jsdelivr.net/npm/chart.js', 
  'https://unpkg.com/html5-qrcode',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/js/all.min.js'
];

// Install event: Caches all essential files
self.addEventListener('install', event => {
  console.log('[Service Worker] Installing...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[Service Worker] Caching app shell');
        // Ignore the cache if a file fetch fails during installation
        return cache.addAll(urlsToCache).catch(err => {
            console.error('[Service Worker] Cache addAll failed:', err);
        });
      })
  );
  self.skipWaiting();
});

// Activate event: Clears old caches
self.addEventListener('activate', event => {
  console.log('[Service Worker] Activating...');
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            console.log('[Service Worker] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch event: Serve content from cache first, then fall back to network
self.addEventListener('fetch', event => {
  // Only handle GET requests for caching
  if (event.request.method !== 'GET') {
    return;
  }
  
  // Do NOT cache API calls (e.g., /login, /enroll, /analytics)
  if (event.request.url.includes('/recognize') || 
      event.request.url.includes('/enroll') ||
      event.request.url.includes('/login') ||
      event.request.url.includes('/register') ||
      event.request.url.includes('/qr_scan') ||
      event.request.url.includes('/analytics') ||
      event.request.url.includes('/records')) {
      
      // Let API requests go straight to the network
      event.respondWith(fetch(event.request));
      return;
  }

  // For static assets, try cache first, then network
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        if (response) {
          return response; // Found in cache
        }
        return fetch(event.request); // Fetch from network
      })
      .catch(error => {
        console.log('Fetch failed for static asset:', error);
      })
  );
});
