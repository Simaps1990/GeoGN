// Minimal service worker just to make the app installable as a PWA.
self.addEventListener('install', (event) => {
  // Activate immediately after installation.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // Take control of existing clients.
  self.clients.claim();

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        client.navigate(client.url);
      }
    })
  );
});

// No offline caching logic for now; network logic stays in the app.
