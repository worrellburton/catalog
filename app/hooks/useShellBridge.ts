import { useEffect, useRef } from 'react';

interface UseShellBridgeArgs {
  onSetCategory: (category: string) => void;
  onOpenBookmarks: () => void;
  onOpenMyLooks: () => void;
}

// Native Flutter shell bridge - the catalog-flutter wrapper dispatches
// CustomEvents on `window` to drive the feed without needing direct
// React state access.
//
// CRITICAL (CLAUDE.md Section 8): the event names below are part of the
// shell contract and must NOT be renamed or removed. The Flutter app
// calls these exact strings.
//
// Event payloads:
//   - catalog:set-category   detail: string  (category slug)
//   - catalog:open-bookmarks no detail
//   - catalog:open-my-looks  no detail
//
// Handlers are read through a ref so callers can pass inline closures
// without re-subscribing on every render.
export function useShellBridge({ onSetCategory, onOpenBookmarks, onOpenMyLooks }: UseShellBridgeArgs) {
  const handlersRef = useRef({ onSetCategory, onOpenBookmarks, onOpenMyLooks });
  handlersRef.current = { onSetCategory, onOpenBookmarks, onOpenMyLooks };

  useEffect(() => {
    const onSetCategoryEvt = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail;
      if (typeof detail !== 'string' || !detail) return;
      handlersRef.current.onSetCategory(detail);
    };
    const onOpenBookmarksEvt = () => handlersRef.current.onOpenBookmarks();
    const onOpenMyLooksEvt = () => handlersRef.current.onOpenMyLooks();

    window.addEventListener('catalog:set-category', onSetCategoryEvt as EventListener);
    window.addEventListener('catalog:open-bookmarks', onOpenBookmarksEvt);
    window.addEventListener('catalog:open-my-looks', onOpenMyLooksEvt);
    return () => {
      window.removeEventListener('catalog:set-category', onSetCategoryEvt as EventListener);
      window.removeEventListener('catalog:open-bookmarks', onOpenBookmarksEvt);
      window.removeEventListener('catalog:open-my-looks', onOpenMyLooksEvt);
    };
  }, []);
}
