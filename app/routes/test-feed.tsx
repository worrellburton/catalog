// Test page for director-based video playback.
//
// PURPOSE: Validate the VideoPlaybackDirector + CreativeCardV2 approach
//          before touching production code. NOT committed. NOT linked from
//          production navigation.
//
// URL: /test-feed
//
// What to look for:
//   ▸ Exactly K cards show green "playing" badge near viewport centre
//     (K=2 mobile, K=4 desktop).
//   ▸ All other cards show grey "paused" badge.
//   ▸ Fast flick → all badges go grey → resume within 150 ms of stopping.
//   ▸ No card is stuck on orange "loading" indefinitely.
//   ▸ No card permanently paused after extended scroll.
//   ▸ Tapping a card opens product URL in a new tab (or fires onOpenProduct).

import { useEffect, useRef, useState, useCallback } from 'react';
import {
  getCachedHomeFeed,
  prefetchHomeFeed,
  type ProductAd,
} from '~/services/product-creative';
import { director } from '~/services/video-playback-director';
import CreativeCardV2 from '~/components/CreativeCardV2';

// How many cards to render on first paint.
const INITIAL_BATCH = 12;
// How many cards to add per infinite-scroll trigger.
const NEXT_BATCH = 12;
// Hard cap to avoid runaway DOM growth.
const MAX_ITEMS = 500;

export default function TestFeedPage() {
  const [creatives, setCreatives] = useState<ProductAd[]>(() =>
    getCachedHomeFeed() ?? [],
  );
  const [visibleCount, setVisibleCount] = useState(INITIAL_BATCH);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const creativesRef = useRef<ProductAd[]>([]);
  const observerRef = useRef<IntersectionObserver | null>(null);

  // Callback ref — re-wires the IntersectionObserver the moment the
  // sentinel div mounts or its deps change. Works even when the div
  // is conditionally rendered.
  const sentinelRef = useCallback((node: HTMLDivElement | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (!node) return;
    observerRef.current = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisibleCount((prev) =>
            Math.min(prev + NEXT_BATCH, MAX_ITEMS),
          );
        }
      },
      { rootMargin: '400px' },
    );
    observerRef.current.observe(node);
  }, []);

  // ── Feed data ────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    prefetchHomeFeed()
      .then((data) => {
        if (!cancelled) {
          creativesRef.current = data;
          setCreatives(data);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError((err as Error)?.message ?? 'Failed to load feed');
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, []);

  // ── Scroll → director ────────────────────────────────────────────────
  useEffect(() => {
    const onScroll = () => director.notifyScroll(window.scrollY);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Keep creativesRef in sync so the sentinel callback always reads
  // the latest length without needing to be re-created.
  useEffect(() => {
    creativesRef.current = creatives;
  }, [creatives]);

  // ── Grid column count ────────────────────────────────────────────────
  const cols =
    typeof window !== 'undefined' && window.innerWidth <= 600 ? 3 : 5;

  const visible = creatives.length > 0
    ? Array.from({ length: visibleCount }, (_, i) => ({
        creative: creatives[i % creatives.length],
        slotId: `slot-${i}`,
      }))
    : [];

  // ── Card interaction ─────────────────────────────────────────────────
  const handleOpenProduct = useCallback((creative: ProductAd) => {
    const url = creative.affiliate_url ?? creative.product?.url;
    if (url) window.open(url, '_blank', 'noopener');
  }, []);

  // ── Render ───────────────────────────────────────────────────────────
  return (
    <div
      style={{
        minHeight: '100dvh',
        background: '#000',
        color: '#fff',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      {/* ── Purple test banner ───────────────────────────────────────── */}
      <div
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 100,
          background: 'rgba(80,0,140,0.95)',
          padding: '6px 12px',
          fontSize: 12,
          letterSpacing: '0.06em',
          backdropFilter: 'blur(6px)',
          WebkitBackdropFilter: 'blur(6px)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <span>▶ TEST FEED · director v2 · not committed</span>
        <span style={{ marginLeft: 'auto', opacity: 0.7 }}>
          {visible.length}/{creatives.length} unique · {visibleCount} slots
        </span>
      </div>

      {/* ── State indicators ─────────────────────────────────────────── */}
      {loading && (
        <div
          style={{
            textAlign: 'center',
            padding: '40px 0',
            opacity: 0.5,
            fontSize: 14,
          }}
        >
          Loading feed…
        </div>
      )}
      {error && (
        <div
          style={{
            textAlign: 'center',
            padding: '40px 0',
            color: '#f66',
            fontSize: 14,
          }}
        >
          {error}
        </div>
      )}

      {/* ── Card grid ────────────────────────────────────────────────── */}
      {visible.length > 0 && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${cols}, 1fr)`,
            gap: '2px',
            padding: '2px',
          }}
        >
          {visible.map(({ creative, slotId }, index) => (
            <CreativeCardV2
              key={slotId}
              creative={creative}
              slotId={slotId}
              className="look-card"
              onOpenProduct={handleOpenProduct}
              priority={index < INITIAL_BATCH}
            />
          ))}
        </div>
      )}

      {/* ── Infinite-scroll sentinel ─────────────────────────────────── */}
      <div
        ref={visibleCount < MAX_ITEMS && creatives.length > 0 ? sentinelRef : undefined}
        style={{ height: 1, width: '100%' }}
        aria-hidden="true"
      />

      {/* ── End of feed (only at DOM cap) ──────────────────────────── */}
      {!loading && visibleCount >= MAX_ITEMS && (
        <div
          style={{
            textAlign: 'center',
            padding: '32px 0',
            opacity: 0.35,
            fontSize: 12,
          }}
        >
          Reached {MAX_ITEMS} slots
        </div>
      )}

      {/* ── Debug legend ─────────────────────────────────────────────── */}
      <div
        aria-hidden="true"
        style={{
          position: 'fixed',
          bottom: 12,
          left: 12,
          zIndex: 200,
          background: 'rgba(0,0,0,0.8)',
          borderRadius: 6,
          padding: '6px 10px',
          fontSize: 10,
          lineHeight: 1.7,
          backdropFilter: 'blur(4px)',
          WebkitBackdropFilter: 'blur(4px)',
          pointerEvents: 'none',
          userSelect: 'none',
        }}
      >
        {[
          ['rgba(0,200,0,0.85)', 'playing'],
          ['rgba(255,165,0,0.85)', 'loading'],
          ['rgba(80,80,80,0.85)', 'paused'],
          ['rgba(200,0,0,0.85)', 'degraded'],
          ['rgba(20,20,20,0.7)', 'idle'],
        ].map(([color, label]) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span
              style={{
                display: 'inline-block',
                width: 10,
                height: 10,
                borderRadius: 2,
                background: color,
                flexShrink: 0,
              }}
            />
            {label}
          </div>
        ))}
      </div>
    </div>
  );
}
