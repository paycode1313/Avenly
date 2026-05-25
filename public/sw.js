const CACHE_NAME = 'mapvision-v1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/Logo Avenly - Color.png',
  '/Logo Avenly - Black.png',
  '/manifest.json',
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('📦 Caching static assets');
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

// Activate event - clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => {
            console.log('🗑️ Deleting old cache:', name);
            return caches.delete(name);
          })
      );
    })
  );
  self.clients.claim();
});

// Fetch event - network first, fallback to cache
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // Skip chrome-extension and other non-http requests
  if (!url.protocol.startsWith('http')) return;

  // API requests - network only with timeout
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request).catch(() => {
        return new Response(
          JSON.stringify({ error: 'Offline', message: 'Tidak ada koneksi internet' }),
          {
            status: 503,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      })
    );
    return;
  }

  // Mapbox tiles - cache first, then network
  if (url.hostname.includes('mapbox') || url.hostname.includes('tiles')) {
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        if (cachedResponse) return cachedResponse;
        return fetch(request)
          .then((response) => {
            // Cache the tile for future use
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseClone);
            });
            return response;
          })
          .catch(() => {
            // Return a placeholder tile if offline
            return new Response('', { status: 503 });
          });
      })
    );
    return;
  }

  // Static assets and pages - stale while revalidate
  event.respondWith(
    fetch(request)
      .then((response) => {
        // Cache successful responses
        if (response.ok) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseClone);
          });
        }
        return response;
      })
      .catch(() => {
        // Fallback to cache
        return caches.match(request).then((cachedResponse) => {
          if (cachedResponse) return cachedResponse;
          // Return offline page for navigation requests
          if (request.mode === 'navigate') {
            return caches.match('/');
          }
          return new Response('Offline', { status: 503 });
        });
      })
  );
});

// Push notification handling
self.addEventListener('push', (event) => {
  const data = event.data?.json() ?? {};
  const title = data.title || 'MapVision Alert';
  const options = {
    body: data.body || 'Ada bahaya jalan di dekat Anda!',
    icon: '/Logo Avenly - Color.png',
    badge: '/Logo Avenly - Color.png',
    vibrate: [200, 100, 200],
    tag: 'mapvision-alert',
    data: {
      url: data.url || '/',
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// Notification click handling
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.openWindow(event.notification.data?.url || '/')
  );
});

// Background sync for reporting hazards
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-hazard-report') {
    event.waitUntil(syncHazardReports());
  }
});

async function syncHazardReports() {
  // This would sync pending hazard reports when back online
  console.log('🔄 Syncing hazard reports...');
}