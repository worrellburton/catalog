// Catalog service worker — small, cautious, single-purpose.
//
// Goal: cache content-hashed assets aggressively so returning visitors
// don't re-download Vite-built JS/CSS chunks. GitHub Pages serves these
// with Cache-Control: max-age=600, which is fine but means a 10-minute
// gap loses the cache. With this SW, /catalog/assets/* lives forever
// (the URL itself contains a content hash, so a "wrong" cache is
// impossible — different content = different URL).
//
// Everything else (HTML, Supabase requests, videos, fonts) falls through
// to the network untouched.
//
// Kill-switch: if this file is replaced with one that calls
// self.registration.unregister() in install/activate, the SW removes
// itself on next page load. Bumping CACHE_VERSION purges all caches.

const CACHE_VERSION = 'catalog-assets-v1';
const ASSET_PATH_RE = /\/assets\/[^/?#]+\.(?:js|css|woff2?|png|svg|webp|jpg|jpeg)$/;

self.addEventListener('install', (event) => {
  // skipWaiting on install means a new SW takes effect on the very next
  // navigation, instead of waiting for every tab to close. Safe here
  // because we only cache content-hashed URLs.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Claim open clients so they start using this SW immediately.
    await self.clients.claim();
    // Drop any caches whose names don't match the current version.
    const names = await caches.keys();
    await Promise.all(names.filter(n => n !== CACHE_VERSION).map(n => caches.delete(n)));
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // Same-origin only — never touch Supabase, fonts.googleapis, etc.
  if (url.origin !== self.location.origin) return;
  if (!ASSET_PATH_RE.test(url.pathname)) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_VERSION);
    const cached = await cache.match(req);
    if (cached) return cached;

    try {
      const fresh = await fetch(req);
      // Only cache successful responses. 404/500 must not poison.
      if (fresh.ok) cache.put(req, fresh.clone());
      return fresh;
    } catch (err) {
      // Offline + nothing cached — let the browser show its native error.
      return Response.error();
    }
  })());
});
