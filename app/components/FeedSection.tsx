import { useState, useEffect, useRef, useMemo, useCallback, memo } from 'react';
import CreativeCardV2 from './CreativeCardV2';
import { pickPosterUrl } from '~/services/video-loading';
import { lookPoster } from '~/services/media-resolver';
import { warmPosters, posterRendition } from '~/utils/poster-prefetch';
import type { Look } from '~/data/looks';
import type { ProductAd } from '~/services/product-creative';
import { seededShuffle, hashSeed } from '~/utils/seededShuffle';
import { weaveByFeedRank } from '~/utils/feed-weave';

interface FeedSectionProps {
  looks: Look[];
  onOpenLook: (look: Look) => void;
  onOpenCreator: (name: string) => void;
  onCreateCatalog?: (query: string) => void;
  onOpenCreativeProduct?: (creative: ProductAd) => void;
  creatives?: ProductAd[];
  creativesLoading?: boolean;
  /**
   * When true, the initial home feed is in PERSONALIZED (Daily Feed) mode:
   * `creatives` and `looks` already arrive in the per-shopper order the engine
   * produced (composeRenderedCreatives floats the personalized products;
   * semanticallyOrderedLooks floats the personalized looks). FeedSection must
   * then PRESERVE that order and only weave the two lanes together — it must NOT
   * re-sort by feed_rank (weaveByFeedRank), which would throw the personalized
   * order away and collapse back to the global admin FEED arrangement. Off =
   * the default feed_rank weave (guests / personalization disabled).
   */
  personalized?: boolean;
  canDeleteCreative?: boolean;
  onDeleteCreative?: (id: string) => void;
  onDeleteLook?: (look: Look) => void;
  title?: string;
  batchSize?: number;
  isInitial?: boolean;
  layoutMode?: number;
  /**
   * When true the pool is built once (no cycling) so the user sees each
   * creative exactly once. When the sentinel fires at the pool end,
   * `onLoadMore` is called instead of cycling back to the start.
   */
  searchMode?: boolean;
  /** Called when the user scrolls to the end of the current pool in search mode. */
  onLoadMore?: () => void;
  /**
   * Optional scroll container to use as the IntersectionObserver root for
   * the load-more sentinel. When omitted, the default viewport is used
   * (the home/feed case where the document itself scrolls). When the
   * feed is nested inside an overflow:auto overlay (ProductPage,
   * LookOverlay), pass the overlay's scroll element so the sentinel
   * triggers based on that container's edges instead of the viewport's.
   */
  scrollRoot?: HTMLElement | null;
  /**
   * Prefix applied to every CreativeCardV2 `slotId` in this section.
   * Use a unique value (e.g. `"look:${look.id}"`) for feeds inside overlays
   * so their director registrations never collide with the main feed's
   * entries. Without a prefix the same creative at the same display-index
   * produces identical slotIds across feeds, causing the overlay's
   * `unregister()` call on close to delete the main feed's entry and freeze
   * that card permanently.
   */
  slotPrefix?: string;
  /**
   * Mobile column count (1 / 2 / 3) selected by the home-feed grid-density
   * dial. When provided on a mobile viewport, the grid renders an INLINE
   * `gridTemplateColumns: repeat(N, 1fr)` — inline style is the top of the
   * cascade, so the column change can't be overridden or fail to inherit
   * (the prior `--feed-cols` CSS-var approach did, at runtime). Only the
   * main home feed threads this; nested/overlay feeds leave it undefined
   * and fall back to the 2-column default. Desktop ignores it (keeps the
   * layout-driven column count).
   */
  feedCols?: number;
}

// When we know creatives are still fetching, reserve roughly this share of
// cells as creative placeholders so looks don't fill the whole first screen.
const LOADING_CREATIVE_RATIO = 0.6;

const LAYOUT_CONFIGS = [
  { name: 'grid', columns: 5 },
  { name: 'editorial', columns: 4 },
  { name: 'mosaic', columns: 6 },
  { name: 'spotlight', columns: 3 },
];

// First-paint batch. Sized to over-fill the first screen on a wide desktop
// grid (up to 6 columns) so there's no half-empty first viewport waiting on a
// scroll-triggered grow. Subsequent grows add `batch` more at a time.
const DEFAULT_BATCH = 24;
const SUB_BATCH = 8;
// D1 — max cards kept mounted on the infinite MOBILE feed. Cards scrolled
// further than this above the viewport are unmounted and their height replaced
// by the grid's padding-top (so scroll position is preserved). ~160 ≈ many
// screens of look-back, far beyond the director's play + warm bands, so a card
// always re-mounts and re-warms before it scrolls back into view. Desktop and
// the pre-measurement state keep windowStart = 0 → identical to before.
const MAX_WINDOW = 160;
// Fetch-ahead depth: posters for this many items BEYOND the mounted set
// are warmed into the HTTP cache (utils/poster-prefetch) so a hard flick
// lands on cards whose posters paint from cache instead of black shimmer.
const PREFETCH_AHEAD = 36;

// (Math.random shuffle removed - seeded shuffle below means the same
// inputs always produce the same output, which is what useMemo needs to
// avoid identity churn on unrelated re-renders.)

function FeedSection({
  looks,
  onOpenLook,
  onOpenCreator,
  onCreateCatalog,
  onOpenCreativeProduct,
  creatives,
  creativesLoading = false,
  personalized = false,
  canDeleteCreative = false,
  onDeleteCreative,
  onDeleteLook,
  title,
  batchSize,
  isInitial = false,
  layoutMode = 0,
  searchMode = false,
  onLoadMore,
  scrollRoot = null,
  slotPrefix,
  feedCols,
}: FeedSectionProps) {
  const batch = batchSize ?? (isInitial ? DEFAULT_BATCH : SUB_BATCH);
  const [visibleCount, setVisibleCount] = useState(batch);
  // Initial segment grows the pool in cycles for true infinite scroll.
  // Each cycle adds CYCLE_SIZE more items by rebuilding/re-shuffling the
  // deck; concurrent video decode is bounded by the playback director
  // (viewport-distance promotion + pool cap) so DOM card count is safe to
  // grow. Sub-segments render a fixed `looks.length` and don't cycle.
  const [poolCycles, setPoolCycles] = useState(1);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  // D1: measured (columns, row height) of the mobile grid, so we can unmount
  // cards far above the viewport and replace their height with padding-top.
  // Null until measured → windowStart stays 0 (current behaviour).
  const [rowMetrics, setRowMetrics] = useState<{ cols: number; rowH: number } | null>(null);
  const layout = LAYOUT_CONFIGS[layoutMode % LAYOUT_CONFIGS.length];

  const gridStyle = useMemo(() => {
    if (typeof window !== 'undefined' && window.innerWidth <= 768) {
      // BULLETPROOF mobile column count: drive it with an INLINE
      // gridTemplateColumns straight off the dial's selected count. Inline
      // style sits at the top of the cascade, so unlike the old
      // `--feed-cols` custom-prop (which had to inherit down to
      // .feed-section-grid and was beaten/never inherited at runtime), this
      // can't be overridden. Default 2 when no dial value is threaded
      // (nested/overlay feeds, pre-mount). `1` ⇒ one full-width card per
      // row (true single-column scroll).
      const cols = feedCols && feedCols >= 1 ? feedCols : 2;
      return { gridTemplateColumns: `repeat(${cols}, 1fr)` };
    }
    return { gridTemplateColumns: `repeat(${layout.columns}, 1fr)` };
  }, [layout.columns, feedCols]);

  // Pick a tile size variant deterministically from (layoutMode, index).
  // layoutMode steps the seed so the Remix button visibly rearranges the
  // mosaic (different cells become featured/wide/tall). Desktop only - mobile
  // keeps the uniform 3:4 grid.
  const getCardClass = useCallback((globalIndex: number) => {
    const isDesktop = typeof window !== 'undefined' && window.innerWidth > 768;
    if (!isDesktop) return 'look-card';
    // Hash the seed so distribution doesn't cluster at regular intervals.
    const seed = ((layoutMode + 1) * 31 + globalIndex * 127) % 100;
    if (seed < 8) return 'look-card look-card-featured';  // ~8%  2x2 (still 3/4)
    return 'look-card';                                   // ~92% 1x1
    // look-card-wide (2x1, 16:9) and look-card-tall (1x2, 3/8) retired —
    // their landscape/portrait ratios clashed with the primary 3/4 grid
    // cell. The 2x2 featured stays: scaling both dims keeps it at 3/4.
  }, [layoutMode]);

  // Build the pool by treating looks + creatives as one combined deck.
  // Each cycle emits every unique item once (shuffled); when the deck
  // runs out we re-shuffle and start another cycle. This guarantees
  // that nothing - neither a look nor a creative - repeats until every
  // other unique item in the library has been shown.
  //
  // While creatives are still being fetched we instead interleave
  // placeholder tiles so the grid doesn't fill the first screen with
  // duplicate looks. Once the fetch resolves this memo recomputes and
  // the placeholders are replaced with real creative cards.
  type PoolItem =
    | { type: 'look'; look: Look & { displayIndex: number } }
    | { type: 'creative'; creative: ProductAd }
    | { type: 'placeholder'; key: string };

  const pool = useMemo<PoolItem[]>(() => {
    const creativeList = isInitial ? (creatives ?? []) : [];
    // The initial segment is creative-only, so it should render even when
    // looks haven't resolved yet. Sub-segments need looks to draw similars.
    if (!isInitial && looks.length === 0) return [];
    // Sub-segments (More like this) show the exact looks array — no cycling
    // beyond the input so the section stays at exactly 8 items.
    // Initial segment grows in cycles of CYCLE_SIZE; sentinel bumps poolCycles
    // when the user nears the end so the feed scrolls indefinitely.
    const CYCLE_SIZE = 80;
    const targetCells = isInitial ? CYCLE_SIZE * poolCycles : looks.length;

    if (isInitial && creativesLoading) {
      // First paint while elite creatives are still loading - render *only*
      // shimmer placeholders. The static look pool used to leak in here; now
      // it stays off-screen until the real feed resolves.
      const items: PoolItem[] = [];
      for (let i = 0; i < targetCells; i++) {
        items.push({ type: 'placeholder', key: `ph-${i}` });
      }
      return items;
    }

    // Both initial and sub-segments pull from a mixed looks + creatives deck.
    // The initial segment now includes look cards so creators' looks are
    // discoverable from the main feed.
    type DeckEntry = { type: 'look'; look: Look } | { type: 'creative'; creative: ProductAd };
    // Seed combines layoutMode + sizes of the input arrays so the shuffle
    // is stable for a given (layoutMode, looks, creatives) but visibly
    // different across deck cycles (cycleSeed below salts each pass).
    const baseSeed = hashSeed(layoutMode, looks.length, creativeList.length, isInitial ? 1 : 0);
    let cycleSeed = baseSeed;
    const buildDeck = (): DeckEntry[] => {
      cycleSeed = (cycleSeed * 31 + 7) | 0;
      const entries: DeckEntry[] = [
        ...looks.map(look => ({ type: 'look' as const, look })),
        ...creativeList.map(creative => ({ type: 'creative' as const, creative })),
      ];
      // Personalized Daily Feed: both lanes ALREADY arrive in the engine's
      // per-shopper order (composeRenderedCreatives floats personalized
      // products; semanticallyOrderedLooks floats personalized looks). Preserve
      // that order exactly and just weave looks into the product stream (a look
      // leads, then WEAVE products, repeat). Crucially we do NOT call
      // weaveByFeedRank here — re-sorting by feed_rank would discard the whole
      // personalized order and snap the feed back to the global arrangement
      // (the long-standing "my daily feed never changes" bug).
      if (isInitial && !searchMode && personalized) {
        const lookEntries = entries.filter(e => e.type === 'look');
        const creativeEntries = entries.filter(e => e.type === 'creative');
        const woven: DeckEntry[] = [];
        const WEAVE = 4; // products between each woven-in look
        let li = 0, ci = 0;
        while (li < lookEntries.length || ci < creativeEntries.length) {
          if (li < lookEntries.length) woven.push(lookEntries[li++]);
          for (let k = 0; k < WEAVE && ci < creativeEntries.length; k++) woven.push(creativeEntries[ci++]);
        }
        return woven;
      }
      // The initial home feed (not search) honours the admin's UNIFIED
      // feed_rank order — looks AND products share one rank space
      // (apply_feed_order), so sorting the combined deck by feed_rank
      // reproduces the /admin/catalogs FEED arrangement exactly. Search
      // results and later cycles still shuffle (relevance / variety).
      if (isInitial && !searchMode) {
        // Unified feed_rank weave (looks + products share one rank space via
        // apply_feed_order): rank asc, looks lead ties, unranked keep input
        // order, and a look is guaranteed near the top. The exact rule lives in
        // weaveByFeedRank — shared with the admin Daily Feed preview so the two
        // can never drift.
        return weaveByFeedRank<DeckEntry>(
          entries.filter(e => e.type === 'look'),
          entries.filter(e => e.type === 'creative'),
          e => (e.type === 'look' ? e.look.feed_rank : e.creative.feed_rank),
          e => e.type === 'look',
        );
      }
      // Search results carry a RELEVANCE order (search_products V8 ranks the
      // products, search_looks the looks). Never shuffle it — shuffling was
      // the dominant reason a ranked query like "black shoes" rendered with
      // white sneakers on top. Preserve each lane's order and weave looks
      // into the product stream so products (the primary search signal) keep
      // their exact ranking and looks still surface.
      if (searchMode) {
        const lookEntries = entries.filter((e): e is Extract<DeckEntry, { type: 'look' }> => e.type === 'look');
        const creativeEntries = entries.filter((e): e is Extract<DeckEntry, { type: 'creative' }> => e.type === 'creative');
        const woven: DeckEntry[] = [];
        const WEAVE = 4; // products per woven-in look
        let li = 0, ci = 0;
        while (li < lookEntries.length || ci < creativeEntries.length) {
          for (let k = 0; k < WEAVE && ci < creativeEntries.length; k++) woven.push(creativeEntries[ci++]);
          if (li < lookEntries.length) woven.push(lookEntries[li++]);
        }
        return woven;
      }
      return seededShuffle<DeckEntry>(entries, cycleSeed);
    };

    const items: PoolItem[] = [];
    let deck = buildDeck();
    let displayIndex = 0;

    // Empty deck (no looks and no creatives available yet) - nothing to render.
    if (deck.length === 0) return items;

    // In search mode: render each creative exactly once (no cycling).
    // The sentinel fires onLoadMore() when the user reaches the end.
    if (searchMode) {
      while (deck.length > 0) {
        const next = deck.shift()!;
        if (next.type === 'look') {
          items.push({ type: 'look', look: { ...next.look, displayIndex: displayIndex++ } });
        } else {
          items.push({ type: 'creative', creative: next.creative });
        }
      }
      return items;
    }

    while (items.length < targetCells) {
      if (deck.length === 0) {
        deck = buildDeck();
        // Cycle-boundary guard: when the new shuffle's first few entries
        // happen to match the last items already rendered, the user reads
        // it as "this product just showed up again". Rotate the deck so
        // the first entry is distinct from the last LOOKBACK rendered
        // items. Bounded to avoid an infinite loop on tiny pools.
        const LOOKBACK = Math.min(items.length, deck.length - 1);
        if (LOOKBACK > 0) {
          const recentKeys = new Set<string>();
          for (let r = items.length - LOOKBACK; r < items.length; r++) {
            const it = items[r];
            recentKeys.add(it.type === 'look' ? `look:${it.look.id}` : it.type === 'creative' ? `creative:${it.creative.product_id || it.creative.id}` : `ph`);
          }
          let rotations = 0;
          while (rotations < deck.length) {
            const head = deck[0];
            const headKey = head.type === 'look' ? `look:${head.look.id}` : `creative:${head.creative.product_id || head.creative.id}`;
            if (!recentKeys.has(headKey)) break;
            // Rotate: pop head, push to the back of the deck.
            deck.push(deck.shift()!);
            rotations++;
          }
        }
      }
      const next = deck.shift()!;
      if (next.type === 'look') {
        items.push({ type: 'look', look: { ...next.look, displayIndex: displayIndex++ } });
      } else {
        items.push({ type: 'creative', creative: next.creative });
      }
    }

    return items;
  }, [looks, creatives, creativesLoading, personalized, isInitial, layoutMode, searchMode, poolCycles]);

  // ── D1: mobile DOM windowing ────────────────────────────────────────────
  // A long mobile scroll otherwise mounts every card ever seen (hundreds →
  // thousands of nodes) — the dominant memory + style-recalc cost on a phone.
  // Cap the mounted set: drop whole rows far above the viewport and replace
  // their height with padding-top so scroll position holds (overflow-anchor
  // absorbs any residual). Desktop + the pre-measure state keep windowStart = 0,
  // so this is byte-identical to the old behaviour until it can safely engage.
  const mobileWindowing = isInitial
    && typeof window !== 'undefined' && window.innerWidth <= 768;

  const windowStart = useMemo(() => {
    if (!mobileWindowing || !rowMetrics || visibleCount <= MAX_WINDOW) return 0;
    const startRow = Math.floor((visibleCount - MAX_WINDOW) / rowMetrics.cols);
    return Math.max(0, startRow * rowMetrics.cols);
  }, [mobileWindowing, rowMetrics, visibleCount]);

  const displayItems = useMemo(() => pool.slice(windowStart, visibleCount), [pool, windowStart, visibleCount]);

  // Warm the NEXT screens' posters before their cards exist — network is
  // decoupled from mounting, so mount-time paints come from cache. Uses
  // the exact rendition math the card uses (same URL = same cache entry).
  useEffect(() => {
    const ahead = pool.slice(visibleCount, visibleCount + PREFETCH_AHEAD);
    warmPosters(ahead.map(item => {
      const raw = item.type === 'look'
        ? lookPoster(item.look)
        : item.type === 'creative' ? pickPosterUrl(item.creative) : null;
      return posterRendition(raw);
    }));
  }, [pool, visibleCount]);

  const padTop = windowStart > 0 && rowMetrics
    ? (windowStart / rowMetrics.cols) * rowMetrics.rowH
    : 0;

  // Measure the mobile grid's column count + row height once its cards exist,
  // re-measuring on resize. All children share a height (uniform 3:4 grid on
  // mobile), so columns = the run of cards sharing the first card's offsetTop
  // and rowH = the gap to the next row. Until measured, windowStart stays 0.
  useEffect(() => {
    if (!mobileWindowing) return;
    const grid = gridRef.current;
    if (!grid) return;
    const measure = () => {
      const cards = grid.querySelectorAll<HTMLElement>(':scope > *');
      if (cards.length < 4) return;
      const firstTop = cards[0].offsetTop;
      let cols = 0;
      for (let i = 0; i < cards.length; i++) {
        if (cards[i].offsetTop === firstTop) cols++; else break;
      }
      if (cols < 1) return;
      const nextRow = cards[cols];
      const rowH = nextRow ? nextRow.offsetTop - firstTop : cards[0].offsetHeight;
      if (rowH <= 0) return;
      setRowMetrics(prev =>
        prev && prev.cols === cols && Math.abs(prev.rowH - rowH) < 1 ? prev : { cols, rowH });
    };
    // The grid-density dial dispatches a `resize` after changing --feed-cols.
    // Defer the read to the next frame so the browser has COMMITTED the grid
    // relayout for the new column count — reading synchronously can capture the
    // pre-change cols/rowH and leave windowStart/padTop stale (blank gaps or a
    // jump when switching to 1 or 3 columns).
    let raf = 0;
    const onResize = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => { raf = 0; measure(); });
    };
    if (!rowMetrics) measure();
    window.addEventListener('resize', onResize);
    // Re-measure on a feedCols change too (double-rAF so the browser has
    // committed the new inline gridTemplateColumns before we read cols/rowH).
    // The parent ALSO dispatches a resize, but driving the re-measure off the
    // effect dep makes it robust even if that event is coalesced/missed — so
    // windowStart/padTop never go stale (no blank gaps switching to 1 or 3).
    let measureRaf1 = 0, measureRaf2 = 0;
    measureRaf1 = requestAnimationFrame(() => {
      measureRaf2 = requestAnimationFrame(() => measure());
    });
    return () => {
      window.removeEventListener('resize', onResize);
      if (raf) cancelAnimationFrame(raf);
      if (measureRaf1) cancelAnimationFrame(measureRaf1);
      if (measureRaf2) cancelAnimationFrame(measureRaf2);
    };
  }, [mobileWindowing, visibleCount, rowMetrics, feedCols]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;

        if (searchMode) {
          // Search mode: grow the rendered set, and page in the next batch of
          // results once we're at the end of what's loaded.
          if (visibleCount < pool.length) {
            setVisibleCount(prev => Math.min(prev + batch, pool.length));
          } else {
            onLoadMore?.();
          }
          return;
        }

        // Home/initial + sub-segments: grow what's rendered every time the
        // sentinel comes near.
        setVisibleCount(prev => Math.min(prev + batch, pool.length));

        // Keep the pool comfortably AHEAD of the rendered set so the grid
        // never catches the pool's end. The old code only extended the pool
        // AFTER visibleCount had already reached pool.length — at that moment
        // there were no more items to render, so the user scrolled into a
        // blank gap until the next observer cycle rebuilt a bigger pool and
        // re-rendered. Extending while we're still a few batches short means
        // there's always rendered (or instantly-renderable) content below the
        // fold — no empty space, no fill-in pop. Only the initial home segment
        // cycles infinitely; bounded sub-segments (similar looks) keep their
        // fixed pool and simply stop. The director caps concurrent video
        // decode regardless of how many cards are mounted.
        if (isInitial && pool.length - visibleCount <= batch * 3) {
          setPoolCycles(c => c + 1);
        }
      },
      // Wide lookahead: start filling well before the sentinel is on screen so
      // rows are already mounted (and warming/playing) by the time they scroll
      // into view.
      { root: scrollRoot ?? null, rootMargin: '2800px' }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [batch, pool.length, visibleCount, searchMode, onLoadMore, scrollRoot, isInitial]);

  useEffect(() => {
    setVisibleCount(batch);
    setPoolCycles(1);
  }, [looks, batch]);

  // Hide only when both inputs are empty. Initial sections show creatives
  // before looks resolve; sub-segments render the looks-driven similars.
  if (pool.length === 0) return null;

  return (
    <div className={`feed-section layout-${layout.name}`}>
      {title && <div className="feed-section-header">{title}</div>}
      <div
        ref={gridRef}
        className="feed-section-grid"
        id={isInitial ? 'grid-container' : undefined}
        data-cols={feedCols || undefined}
        style={padTop ? { ...gridStyle, paddingTop: padTop } : gridStyle}
      >
        {displayItems.map((item, idx) => {
          // Stable, pool-position index — keys/slotIds/priority must NOT shift
          // when windowStart advances, or surviving cards would remount.
          const globalIndex = windowStart + idx;
          if (item.type === 'placeholder') {
            return (
              <div key={item.key} className="look-card promo-card creative-placeholder" aria-hidden="true">
                <div className="card-inner">
                  <div className="card-shimmer" />
                  {/* Skeleton scaffold so the placeholder reads as
                      "content coming" instead of an empty rectangle.
                      Mirrors the brand / name / price block real cards
                      render in their bottom-left corner. */}
                  <div className="card-skeleton">
                    <span className="card-skeleton-bar card-skeleton-bar--brand" />
                    <span className="card-skeleton-bar card-skeleton-bar--name" />
                    <span className="card-skeleton-bar card-skeleton-bar--price" />
                  </div>
                </div>
              </div>
            );
          }
          if (item.type === 'creative') {
            return (
              <CreativeCardV2
                key={`creative-${item.creative.id}-${globalIndex}`}
                slotId={`${slotPrefix ? `${slotPrefix}:` : ''}creative-${item.creative.id}-${globalIndex}`}
                creative={item.creative}
                className={getCardClass(globalIndex)}
                onOpenProduct={onOpenCreativeProduct}
                canDelete={canDeleteCreative}
                onDelete={onDeleteCreative}
                priority={globalIndex < 6}
              />
            );
          }
          return (
            <CreativeCardV2
              key={`${item.look.id}-${item.look.displayIndex}`}
              slotId={`${slotPrefix ? `${slotPrefix}:` : ''}look-${item.look.id}-${item.look.displayIndex}`}
              look={item.look}
              className={getCardClass(globalIndex)}
              onOpenLook={onOpenLook}
              onOpenCreator={onOpenCreator}
              canDelete={canDeleteCreative}
              onDeleteLook={onDeleteLook}
              priority={globalIndex < 6}
            />
          );
        })}
      </div>
      <div ref={sentinelRef} style={{ height: 1 }} />
    </div>
  );
}

// Memoized - ContinuousFeed re-renders on every search keystroke, but each
// FeedSection only depends on its own props. With memo + stable callbacks
// from the parent, sections skip re-render entirely when the user types.
export default memo(FeedSection);
