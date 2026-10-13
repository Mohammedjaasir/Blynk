// Retires the old Flutter shop's offline worker (owner, 2026-10-13: /app/ is now the new
// customer app). Browsers that installed the Flutter shop check this same URL for updates;
// this version clears every cache it left, unregisters itself, and reloads open tabs so they
// load the new app straight away instead of the cached old one.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
      await self.registration.unregister();
      const tabs = await self.clients.matchAll({ type: 'window' });
      tabs.forEach((tab) => tab.navigate(tab.url));
    })(),
  );
});
