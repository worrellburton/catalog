// Fires the global "added/removed from your saved" toast. FollowToastHost
// (mounted once at the app root) listens for `catalog:saved` and renders a
// top-of-screen pill with a thumbnail — the same surface as the follow toast.

export interface SavedToastDetail {
  name: string;
  imageUrl?: string | null;
  /** true = just saved, false = just removed. */
  saved: boolean;
}

export function emitSavedToast(detail: SavedToastDetail): void {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new CustomEvent('catalog:saved', { detail }));
  } catch {
    /* ignore — toast is non-critical */
  }
}
