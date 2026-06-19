// The catalog SPA no longer uses a service worker.
//
// On Vercel, content-hashed assets are already served
// `Cache-Control: immutable` (max-age=1y) by the browser HTTP cache, so a SW
// added no real benefit — only a caching footgun: a stale app shell could
// request lazy chunk hashes that a newer deploy has since removed, which hangs
// navigation (tap a product/look → its chunk never loads). This proactively
// retires any SW a returning visitor still has registered and purges its
// caches, then never registers again. Paired with a self-destructing
// `public/sw.js` so even visitors whose page JS is stale get cleaned on the
// browser's next SW update check.

export function retireServiceWorker() {
  if (typeof window === 'undefined') return;
  if (!('serviceWorker' in navigator)) return;

  navigator.serviceWorker
    .getRegistrations()
    .then((regs) => Promise.all(regs.map((r) => r.unregister())))
    .catch(() => {});

  if ('caches' in window) {
    caches
      .keys()
      .then((names) => Promise.all(names.map((n) => caches.delete(n))))
      .catch(() => {});
  }
}
