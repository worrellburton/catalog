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
