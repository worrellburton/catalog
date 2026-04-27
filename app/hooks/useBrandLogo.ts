// useBrandLogo — single source of truth for the wordmark variant the
// CatalogLogo renders app-wide. Persists to localStorage so the choice
// survives reloads, and listens for cross-tab changes so picking a font
// on one tab updates the other tab's header instantly.

import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_VARIANT_ID } from '~/utils/brandFonts';

const STORAGE_KEY = 'catalog.brandLogo';

function read(): string {
  if (typeof window === 'undefined') return DEFAULT_VARIANT_ID;
  try {
    return window.localStorage.getItem(STORAGE_KEY) || DEFAULT_VARIANT_ID;
  } catch {
    return DEFAULT_VARIANT_ID;
  }
}

export function useBrandLogo(): { variantId: string; setVariant: (id: string) => void; reset: () => void } {
  const [variantId, setVariantId] = useState<string>(() => read());

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      setVariantId(e.newValue || DEFAULT_VARIANT_ID);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const setVariant = useCallback((id: string) => {
    setVariantId(id);
    try { window.localStorage.setItem(STORAGE_KEY, id); } catch {}
    // Same-tab listeners (other components mounting useBrandLogo) won't
    // hear the storage event — fire a custom event so they can rebroadcast.
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('brand-logo:change', { detail: id }));
    }
  }, []);

  // Same-tab sync via the custom event above.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onChange = (e: Event) => {
      const next = (e as CustomEvent<string>).detail;
      if (next && next !== variantId) setVariantId(next);
    };
    window.addEventListener('brand-logo:change', onChange);
    return () => window.removeEventListener('brand-logo:change', onChange);
  }, [variantId]);

  const reset = useCallback(() => setVariant(DEFAULT_VARIANT_ID), [setVariant]);

  return { variantId, setVariant, reset };
}
