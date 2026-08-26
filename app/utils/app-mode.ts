// Two-app split (Phase 1). One webapp bundle, two Flutter flavors:
//   Catalog       -> loads with #app hash   -> mode 'catalog' (feed first)
//   Catalog Style -> loads with #style hash -> mode 'style'   (stylist first)
//
// The Flutter shell forces the correct hash before the webview loads
// (see catalog-flutter/lib/screens/feed_screen.dart), so this is read-only.
// Browser visits with no hash default to 'catalog' — matches the mobile-web
// experience most desktop users get today.

export type AppMode = 'catalog' | 'style';

const STORAGE_KEY = 'catalog:app-mode';

export function getAppMode(): AppMode {
  if (typeof window === 'undefined') return 'catalog';
  // Query first (survives every redirect), then hash (nice for hand-typed
  // URLs), then sessionStorage (sticks across in-app SPA navigations that
  // strip the query/hash).
  const q = new URLSearchParams(window.location.search).get('app');
  if (q === 'style' || q === 'catalog') {
    try { sessionStorage.setItem(STORAGE_KEY, q); } catch { /* private mode */ }
    return q;
  }
  const hash = window.location.hash;
  if (hash === '#style' || hash === '#app') {
    const m: AppMode = hash === '#style' ? 'style' : 'catalog';
    try { sessionStorage.setItem(STORAGE_KEY, m); } catch { /* private mode */ }
    return m;
  }
  try {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (stored === 'style') return 'style';
  } catch { /* private mode */ }
  return 'catalog';
}

export function applyAppModeToRoot(): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.app = getAppMode();
}

// ── Style-app background preset (Phase 6.1) ────────────────────────────────
// The preset the shopper picks in /style/settings is stored per-device and
// stamped on <html> as data-style-bg, which every preset rule in style-up.css
// keys off. It must reach the Style app and NOTHING else: the key is a single
// localStorage value, so if the attribute were stamped everywhere, choosing
// "Paper" would turn the Catalog feed off-white too.
//
// The gate used to be the app FLAVOR (html[data-app="style"], set only by the
// Flutter shell's #style hash / ?app=style), which meant a plain web visit to
// catalog.shop/style stamped the attribute but matched no rule — every preset
// was silently inert on the web. The surface, not the flavor, is what decides:
// the /style routes ARE the Style app however you got there.

const STYLE_BG_KEY = 'catalog:style-bg';
const STYLE_BG_PRESETS = /^(default|plain|warm|cool|paper)$/;
/** Keep in sync with the pre-hydration script in root.tsx. */
const STYLE_PATH = /^\/style(\/|$)/;

/** True on the Style app: its flavor (shell / ?app=style) or any /style route. */
export function isStyleSurface(pathname: string): boolean {
  return getAppMode() === 'style' || STYLE_PATH.test(pathname);
}

/**
 * Stamp (or clear) data-style-bg on <html> for the route being shown.
 *
 * Written imperatively, NOT rendered as an attribute on root.tsx's <html>:
 * React hydrates the document element once and then leaves its attributes
 * alone, so an attribute passed to <html> after that never lands (verified —
 * it stayed absent through both hydration and client navigations). Hydration
 * also drops what the pre-hydration script stamped, so this effect is what
 * makes the preset stick past boot.
 *
 * Clearing matters as much as setting: an SPA navigation out of /style has to
 * drop the preset, or a Style preference keeps tinting the Catalog feed.
 */
export function applyStyleBackground(pathname: string): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  let bg: string | null = null;
  if (isStyleSurface(pathname)) {
    try { bg = localStorage.getItem(STYLE_BG_KEY); } catch { /* private mode */ }
  }
  if (bg && STYLE_BG_PRESETS.test(bg)) root.dataset.styleBg = bg;
  else delete root.dataset.styleBg;
}

// ── Feed surfaces ──────────────────────────────────────────────────────────
// The home-feed caches warm themselves at module-parse time (see
// services/looks.ts and services/product-creative.ts) so the network round
// trips run in parallel with the React tree mounting. Those modules live in
// the `app-core` chunk, which is a static dependency of the root — so the warm
// fired on EVERY page, including the ones that never render a feed.
//
// Measured on the signed-out /style landing of a production build: zero <img>
// and zero <video> in the DOM, and 43 resource fetches at ~2.2 s, three of them
// MP4s (one took 1.19 s). That is the Style app's cold-boot bandwidth spent on
// media it will never show.

/** Routes that own their own surface and never render the home feed. */
const NON_FEED_PATH = /^\/(style|admin|partners|studio|deck)(\/|$)/;

/**
 * True on a surface that renders home-feed content, so the module-level warms
 * should run. Deliberately a denylist: the feed's caches are also read by the
 * product, look, brand, creator and search surfaces, and missing one of those
 * would cost a cold start on a page that used to be warm.
 */
export function isFeedSurface(pathname: string): boolean {
  return !NON_FEED_PATH.test(pathname) && getAppMode() !== 'style';
}
