// EmptyCatalogState - shown when a search/filter yields zero creatives.
// Matte-black surface with the AI-diamond particle drift behind it
// (same field as the home hero). Below the headline sits a single CTA
// that lets shoppers signal demand for the catalog they searched for;
// the count is fed from Supabase realtime so it ticks up live.

import { useCallback, useEffect, useRef, useState } from 'react';
import ParticleBackground from './ParticleBackground';
import { supabase } from '~/utils/supabase';

interface EmptyCatalogStateProps {
  /** Display name as shown in the UI (e.g. "Y2K Streetwear"). */
  catalogName: string;
  /** When true, shows a "sourcing" message instead of the normal demand-signal
   *  copy - used when the semantic search returned a cold miss and the backfill
   *  agent is queued to fetch products for this query. */
  isSourcing?: boolean;
}

export default function EmptyCatalogState({ catalogName, isSourcing = false }: EmptyCatalogStateProps) {
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
          if (typeof next === 'number') {
            setCount(next);
            triggerPulse();
          }
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
      console.warn('[EmptyCatalogState] request_catalog failed:', error.message);
      setCount(c => (c == null ? c : Math.max(0, c - 1)));
      setPressed(false);
      return;
    }
    if (typeof data === 'number') setCount(data);
  }, [pressed, slug, triggerPulse]);

  const display = count == null ? '' : count.toLocaleString();
  const noun = count === 1 ? 'shopper' : 'shoppers';

  return (
    <div className="empty-catalog">
      <ParticleBackground />
      <div className="empty-catalog-content">
        {/* Catalog AI spark — the orbiting-tiles diamond from the home hero,
            spinning. Core diamond + four catalog tiles counter-rotating. */}
        <span className="ec-spark" aria-hidden="true">
          <svg viewBox="0 0 140 140" width="64" height="64">
            <defs>
              <linearGradient id="ec-spark-grad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#fff" />
                <stop offset="50%" stopColor="#cbd5e1" />
                <stop offset="100%" stopColor="#94a3b8" />
              </linearGradient>
              <radialGradient id="ec-tile-grad" cx="50%" cy="40%" r="60%">
                <stop offset="0%" stopColor="#fff" />
                <stop offset="100%" stopColor="#64748b" />
              </radialGradient>
            </defs>
            <g className="ec-spark-orbit">
              <rect className="ec-spark-tile" x="65"  y="6"   width="10" height="10" rx="2" fill="url(#ec-tile-grad)" />
              <rect className="ec-spark-tile" x="124" y="65"  width="10" height="10" rx="2" fill="url(#ec-tile-grad)" />
              <rect className="ec-spark-tile" x="65"  y="124" width="10" height="10" rx="2" fill="url(#ec-tile-grad)" />
              <rect className="ec-spark-tile" x="6"   y="65"  width="10" height="10" rx="2" fill="url(#ec-tile-grad)" />
            </g>
            <g className="ec-spark-core">
              <path
                transform="translate(20 20)"
                d="M50 4 C54 30 70 46 96 50 C70 54 54 70 50 96 C46 70 30 54 4 50 C30 46 46 30 50 4 Z"
                fill="url(#ec-spark-grad)"
              />
            </g>
          </svg>
        </span>

        {isSourcing ? (
          <>
            <h2 className="empty-catalog-headline">
              Finding <em>{catalogName}</em>
            </h2>
            <p className="empty-catalog-subhead">
              Our agents are pulling looks and products. Check back shortly.
            </p>
            <div className="ec-sourcing" aria-live="polite">
              <div className="ec-sourcing-track">
                <span className="ec-sourcing-fill" />
              </div>
              <span className="ec-sourcing-label">Sourcing products…</span>
            </div>
          </>
        ) : (
          <>
            <h2 className="empty-catalog-headline">
              Nothing in <em>{catalogName}</em> yet
            </h2>
            <p className="empty-catalog-subhead">
              Tap below if you'd shop this. We surface what people ask for.
            </p>

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
          </>
        )}
      </div>
    </div>
  );
}
