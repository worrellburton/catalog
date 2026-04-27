// EmptyCatalogState — shown when a search/filter yields zero creatives.
// Recycles the same WebGL particle background from the sign-in screen so
// the moment reads as deliberate ("there's a vibe here") rather than
// broken. Below the headline sits a single CTA that lets shoppers signal
// demand for the catalog they searched for; the count of presses is fed
// from Supabase realtime so the number ticks up live as other shoppers
// hit the same empty state.

import { useCallback, useEffect, useRef, useState } from 'react';
import ParticleBackground from './ParticleBackground';
import { supabase } from '~/utils/supabase';

interface EmptyCatalogStateProps {
  /** Display name as shown in the UI (e.g. "Y2K Streetwear"). The slug
   *  used for counting is the normalized lowercase version, computed
   *  server-side in request_catalog(). */
  catalogName: string;
}

export default function EmptyCatalogState({ catalogName }: EmptyCatalogStateProps) {
  // Slug used to query the count row. Mirrors the normalization done by
  // request_catalog() so the realtime filter matches the upserted row.
  const slug = catalogName.toLowerCase().trim().replace(/\s+/g, ' ');

  const [count, setCount] = useState<number | null>(null);
  const [pressed, setPressed] = useState(false);
  const [pulse, setPulse] = useState(false);
  const pulseTimeout = useRef<number | null>(null);

  // Ticks the visual pulse when count changes — fires whether the change
  // came from this client (optimistic) or from a realtime broadcast.
  const triggerPulse = useCallback(() => {
    setPulse(true);
    if (pulseTimeout.current) window.clearTimeout(pulseTimeout.current);
    pulseTimeout.current = window.setTimeout(() => setPulse(false), 600);
  }, []);

  // Initial fetch + realtime subscription. We subscribe with a slug filter
  // so each empty state only listens to its own row.
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
    // Optimistic — realtime will reconcile if drift happens.
    setCount(c => (c ?? 0) + 1);
    triggerPulse();
    const { data, error } = await supabase.rpc('request_catalog', { slug });
    if (error) {
      console.warn('[EmptyCatalogState] request_catalog failed:', error.message);
      // Rollback the optimistic bump.
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
        <p className="empty-catalog-eyebrow">No creatives yet</p>
        <h2 className="empty-catalog-headline">
          Nothing in <em>{catalogName}</em> yet.
        </h2>
        <p className="empty-catalog-subhead">
          Tap the button if you'd shop this. We surface what people ask for.
        </p>

        <button
          type="button"
          className={`empty-catalog-cta ${pressed ? 'is-pressed' : ''}`}
          onClick={handleRequest}
          disabled={pressed}
          aria-pressed={pressed}
        >
          {pressed ? 'Got it — we hear you' : 'I want this catalog'}
        </button>

        <div className={`empty-catalog-counter ${pulse ? 'pulse' : ''}`} aria-live="polite">
          {count == null ? (
            <span className="empty-catalog-counter-loading">…</span>
          ) : (
            <span>
              <strong>{display}</strong> {noun} {count === 1 ? 'has' : 'have'} asked for this
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
