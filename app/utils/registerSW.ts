// Register the asset-cache service worker once the page is idle. We never
// want SW setup to compete with the first paint or with Supabase fetches  - 
// it's a perf optimization for *future* visits, not the current one.

const SW_PATH = `${import.meta.env.BASE_URL}sw.js`;

export function registerAssetCache() {
  if (typeof window === 'undefined') return;
  if (!('serviceWorker' in navigator)) return;
  if (window.location.hostname === 'localhost') return;

  const fire = () => {
    navigator.serviceWorker
      .register(SW_PATH, { scope: import.meta.env.BASE_URL || '/' })
      .catch(err => {
        // Logs once for debugging; never throws into the app.
        // eslint-disable-next-line no-console
        console.warn('[sw] register failed:', err?.message || err);
      });
  };

  type IdleWin = Window & {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
  };
  const w = window as IdleWin;
  if (typeof w.requestIdleCallback === 'function') {
    w.requestIdleCallback(fire, { timeout: 4000 });
  } else {
    window.setTimeout(fire, 2000);
  }
}

// Emergency unregister: append ?sw-off to any URL once and the SW removes
// itself on next page load. Keeps a kill-switch within reach if the cache
// ever becomes a problem.
export function maybeUnregisterSW() {
  if (typeof window === 'undefined') return;
  if (!('serviceWorker' in navigator)) return;
  if (!window.location.search.includes('sw-off')) return;
  navigator.serviceWorker.getRegistrations().then(regs => {
    for (const r of regs) r.unregister();
  });
}
