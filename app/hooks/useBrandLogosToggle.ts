// useBrandLogosToggle - boolean preference for whether ProductPage shows
// Brandfetch wordmark logos in place of the brand text. Persisted to
// localStorage and synced across tabs. Only consumed when the app is in
// light mode; in dark mode the toggle is irrelevant (logos render best
// on light surfaces).

import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'catalog.brandLogosOn';

function read(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return true;
    return raw === '1';
  } catch { return true; }
}

export function useBrandLogosToggle(): { brandLogosOn: boolean; toggle: () => void; setBrandLogosOn: (on: boolean) => void } {
  const [brandLogosOn, setBrandLogosOnState] = useState<boolean>(() => read());

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      setBrandLogosOnState(e.newValue !== '0');
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // Cross-component (same-tab) sync via custom event.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onChange = (e: Event) => {
      const next = (e as CustomEvent<boolean>).detail;
      setBrandLogosOnState(next);
    };
    window.addEventListener('brand-logos-toggle:change', onChange);
    return () => window.removeEventListener('brand-logos-toggle:change', onChange);
  }, []);

  const setBrandLogosOn = useCallback((on: boolean) => {
    setBrandLogosOnState(on);
    try { window.localStorage.setItem(STORAGE_KEY, on ? '1' : '0'); } catch {}
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('brand-logos-toggle:change', { detail: on }));
    }
  }, []);

  const toggle = useCallback(() => setBrandLogosOn(!brandLogosOn), [brandLogosOn, setBrandLogosOn]);

  return { brandLogosOn, toggle, setBrandLogosOn };
}
