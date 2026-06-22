// CatalogDemandCTA — the "I want this catalog" demand-signal button + live
// count. Extracted from EmptyCatalogState so it can be reused: as the centered
// CTA on the full empty overlay (no recommendations), AND folded in below the
// "Other catalogs you might like" picks on the now-browsing strip when a search
// returns nothing but we still have suggestions to offer.
//
// Backed by the `catalog_requests` table + `request_catalog` RPC; the count
// ticks live via a Supabase realtime subscription on the catalog's slug.

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '~/utils/supabase';

interface CatalogDemandCTAProps {
  /** Display name — also the source of the aggregation slug. */
  catalogName: string;
  /** Extra class on the wrapper so callers can scope layout (overlay vs inline). */
  className?: string;
}

export default function CatalogDemandCTA({ catalogName, className = '' }: CatalogDemandCTAProps) {
  const slug = catalogName.toLowerCase().trim().replace(/\s+/g, ' ');
  const [count, setCount] = useState<number | null>(null);
  const [pressed, setPressed] = useState(false);
  const [pulse, setPulse] = useState(false);
  const pulseTimeout = useRef<number | null>(null);

  const triggerPulse = useCallback(() => {
    setPulse(true);
    if (pulseTimeout.current) window.clearTimeout(pulseTimeout.current);
    pulseTimeout.current = window.setTimeout(() => setPulse(false), 600);
  }, []);

  useEffect(() => {
    if (!supabase || !slug) return;
    let cancelled = false;

    supabase
      .from('catalog_requests')
      .select('count')
      .eq('catalog_slug', slug)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        setCount((data as { count?: number } | null)?.count ?? 0);
      });

    const channel = supabase
      .channel(`catalog-requests-${slug}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'catalog_requests', filter: `catalog_slug=eq.${slug}` },
        payload => {
          const next = (payload.new as { count?: number } | null)?.count;
          if (typeof next === 'number') { setCount(next); triggerPulse(); }
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      void supabase!.removeChannel(channel);
      if (pulseTimeout.current) window.clearTimeout(pulseTimeout.current);
    };
  }, [slug, triggerPulse]);

  const handleRequest = useCallback(async () => {
    if (pressed || !supabase) return;
    setPressed(true);
    setCount(c => (c ?? 0) + 1);
    triggerPulse();
    const { data, error } = await supabase.rpc('request_catalog', { slug });
    if (error) {
      console.warn('[CatalogDemandCTA] request_catalog failed:', error.message);
      setCount(c => (c == null ? c : Math.max(0, c - 1)));
      setPressed(false);
      return;
    }
    if (typeof data === 'number') setCount(data);
  }, [pressed, slug, triggerPulse]);

  const display = count == null ? '' : count.toLocaleString();
  const noun = count === 1 ? 'shopper' : 'shoppers';

  return (
    <div className={`catalog-demand ${className}`.trim()}>
      <button
        type="button"
        className={`empty-catalog-cta ${pressed ? 'is-pressed' : ''}`}
        onClick={handleRequest}
        disabled={pressed}
        aria-pressed={pressed}
      >
        {pressed ? (
          <>
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
              <path d="M2.5 7.5L6 11L12.5 4" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            We hear you
          </>
        ) : (
          'I want this catalog'
        )}
      </button>

      <div className={`ec-demand ${pulse ? 'pulse' : ''}`} aria-live="polite">
        {count == null ? (
          <span className="ec-demand-text">&nbsp;</span>
        ) : count > 0 ? (
          <span className="ec-demand-text">
            <strong>{display}</strong> {noun} {count === 1 ? 'has' : 'have'} asked for this
          </span>
        ) : (
          <span className="ec-demand-text">Be the first to ask</span>
        )}
      </div>
    </div>
  );
}
