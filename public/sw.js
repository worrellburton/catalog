// Catalog service worker — RETIRED (self-destructing).
//
// This previously cached content-hashed /assets/* "forever". On Vercel those
// assets are already served `Cache-Control: immutable` (max-age=1y) by the
// browser HTTP cache, so the SW added ~no benefit while creating a real
// footgun: a stale app shell could request lazy chunk hashes a newer deploy
// had removed, hanging navigation (tap a product/look → its chunk 404s).
//
// The SPA no longer registers a service worker. This file remains only so that
// returning visitors who still have the old SW installed get it cleanly
// removed: the browser byte-checks sw.js on its next SW update, installs this
// version, and it purges every cache and unregisters itself.

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try {
      const names = await caches.keys();
      await Promise.all(names.map((n) => caches.delete(n)));
    } catch (_) {
      /* best-effort */
    }
    try {
      await self.registration.unregister();
    } catch (_) {
      /* best-effort */
    }
  })());
});
