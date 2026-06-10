import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

/**
 * `React.lazy` that self-heals across deploys.
 *
 * On Vercel's static SPA, a new deploy replaces every hashed chunk. A
 * browser still running the previous build's HTML then asks for a chunk
 * hash that no longer exists; Vercel's SPA fallback answers with
 * `index.html` (text/html), and the dynamic import rejects with
 * "'text/html' is not a valid JavaScript MIME type" — a hard 500 on the
 * comments/product/look deep links.
 *
 * The app-level ErrorBoundary already reloads once when such an error
 * bubbles up, but that only fires after the failure reaches React. This
 * wrapper catches the rejection at the import site itself, so recovery
 * happens the instant the chunk fetch fails — before the Suspense
 * boundary ever throws. It shares the ErrorBoundary's reload gate
 * (`catalog:chunk-reload-at`, 10s) so the two never double-reload.
 */

const RELOAD_KEY = 'catalog:chunk-reload-at';
const RELOAD_GATE_MS = 10_000;

function isChunkLoadError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /valid JavaScript MIME type|dynamically imported module|Importing a module script failed|error loading dynamically imported|Unable to preload|Failed to fetch/i.test(msg);
}

// `ComponentType<any>` mirrors React's own `lazy` constraint so the
// wrapped component keeps its exact prop types at the call site.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyWithReload<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
): LazyExoticComponent<T> {
  return lazy(() =>
    factory().catch((err: unknown) => {
      if (isChunkLoadError(err) && typeof window !== 'undefined') {
        try {
          const last = Number(window.sessionStorage.getItem(RELOAD_KEY) || '0');
          if (Date.now() - last > RELOAD_GATE_MS) {
            window.sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
            window.location.reload();
            // Keep the Suspense fallback up while the reload takes over —
            // never resolve, so React doesn't try to render a missing
            // module in the doomed-anyway current document.
            return new Promise<{ default: T }>(() => {});
          }
        } catch { /* sessionStorage blocked (private mode) — fall through */ }
      }
      throw err;
    }),
  );
}
