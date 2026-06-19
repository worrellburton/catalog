// Cross-route handoff flag for the /generate → My Catalog transition.
//
// /generate and the My Catalog overlay (rendered by the consumer app at
// /my-looks) are separate Remix routes. When the user leaves /generate
// after creating an AI look, the consumer app mounts fresh and My Catalog
// renders its empty/skeleton state for a few hundred ms while its looks
// load — which flashes the feed/catalog underneath before the destination
// is ready.
//
// To cover that handoff, /generate sets this one-shot sessionStorage flag
// right before navigating away; My Catalog reads + consumes it on mount to
// decide whether to show the full-screen branded loader until its data has
// loaded. Kept in its own module so both routes share the exact key with
// no UI-state leaking into the data layer.

const HANDOFF_KEY = 'catalog:handoff-to-my-catalog';

/** Arm the handoff loader for the next My Catalog mount. Call right before
 *  navigating away from /generate to the consumer app / My Catalog. */
export function armCatalogHandoff(): void {
  try {
    sessionStorage.setItem(HANDOFF_KEY, '1');
  } catch {
    /* sessionStorage unavailable (private mode / SSR) — degrade gracefully */
  }
}

/** Read-and-clear the handoff flag. Returns true once per arm. */
export function consumeCatalogHandoff(): boolean {
  try {
    const armed = sessionStorage.getItem(HANDOFF_KEY) === '1';
    if (armed) sessionStorage.removeItem(HANDOFF_KEY);
    return armed;
  } catch {
    return false;
  }
}
