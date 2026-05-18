import { useMemo, useState, useEffect, useLayoutEffect, useCallback, useRef } from 'react';
import { useNavigate } from '@remix-run/react';
import { Product, Look, creators as staticCreators } from '~/data/looks';
import { useEscapeKey } from '~/hooks/useEscapeKey';
import CreativeCard from '~/components/CreativeCard';
import { useTrailVideo } from '~/components/TrailVideoHost';
import { lookTrailId, normalizeLookVideoUrl } from '~/utils/trailIds';
import { trackAdClick, prefetchSimilarCreatives, type ProductAd } from '~/services/product-creative';
import { type GraphPair } from '~/services/graph-pairs';
import { trackProductClickout } from '~/services/session-tracker';
import {
  pickVideoUrl,
  pickPosterUrl,
  prefetchVideoBytes,
  isMobileViewport,
  markFeedMilestone,
} from '~/services/video-loading';

interface ProductPageCreative {
  /** The product_creative.id - used to resolve the shared <video> element
   *  from TrailVideoHost so the morph reuses the card's playing instance. */
  id?: string;
  videoUrl: string;
  thumbnailUrl?: string | null;
}

interface BookmarksInterface {
  isProductBookmarked: (p: Product) => boolean;
  toggleProductBookmark: (p: Product) => void;
}

interface ProductPageProps {
  product: Product;
  onClose: () => void;
  onOpenLook: (look: Look) => void;
  onOpenBrowser: (url: string, title: string, product?: Product) => void;
  onOpenProduct?: (product: Product) => void;
  onOpenCreator?: (name: string) => void;
  onOpenCreative?: (creative: ProductAd) => void;
  /** Tap on the brand label opens the brand catalog page. */
  onOpenBrand?: (brandName: string) => void;
  creative?: ProductPageCreative;
  /** Visually-similar creatives from TwelveLabs/pgvector. Rendered as the
   *  "More like this" video rail below the hero. */
  similarCreatives?: ProductAd[];
  /** Other live creatives from the same brand. Rendered as the
   *  "More from <brand>" rail in the desktop info column. */
  brandCreatives?: ProductAd[];
  /** Popular live creatives - used to fill the "More like this" grid
   *  when find_similar_creatives returns nothing for the active product
   *  (cold-start, missing embedding, etc.). */
  popularFallback?: ProductAd[];
  /** Editorial fashion looks (Look[]) - drives the "You might also like"
   *  grid below the trail rail. Tap opens the look in LookOverlay. */
  lookCreatives?: Look[];
  /** Products related via entity_edges (pairs_with / same_brand). Powers
   *  the "Pairs well with" horizontal rail on ProductPage. */
  graphPairs?: GraphPair[];
  bookmarks: BookmarksInterface;
  /** Increments on every navigation. ProductPage's scroll-to-top
   *  effect depends on this so it fires reliably even when the new
   *  product happens to share brand+name with the prior one. */
  navKey?: number;
}

// Stable hash of any string → unsigned integer. Used to derive a consistent
// dummy save count + "saved by" avatar set per product so refreshing the
// page doesn't reshuffle the social-proof row.
function hashString(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

// Curated avatar pool for the dummy "saved by" row. Sources from the
// existing static creators so the avatars are real images (no third-party
// avatar generators / extra network hops).
const AVATAR_POOL = Object.values(staticCreators)
  .filter(c => !!c.avatar)
  .slice(0, 12);

interface RetailerOffer {
  retailer: string;
  url: string;
  price: string;        // "$48.00"
  priceCents: number;   // for "lowest" computation
  badge?: 'lowest' | 'discount' | 'official';
  discountPct?: number; // shown on the chip when badge==='discount'
}

// Synthetic retailer set with realistic, search-shaped fallback URLs so the
// in-app browser actually lands somewhere useful per chip. The brand site
// (product.url) is always retailer #1, marked "official". Stable per
// product so prices don't reshuffle on re-render.
const ALT_RETAILERS = [
  { name: 'Amazon',    url: (q: string) => `https://www.amazon.com/s?k=${q}`,                bias: -0.07 },
  { name: 'Nordstrom', url: (q: string) => `https://www.nordstrom.com/sr?keyword=${q}`,      bias: +0.03 },
  { name: 'Revolve',   url: (q: string) => `https://www.revolve.com/r/Search.jsp?search=${q}`, bias: +0.05 },
  { name: 'Shopbop',   url: (q: string) => `https://www.shopbop.com/s/${q}`,                  bias: -0.02 },
  { name: 'Bloomingdale\'s', url: (q: string) => `https://www.bloomingdales.com/shop/search?keyword=${q}`, bias: +0.06 },
] as const;

function parsePriceCents(raw?: string | null): number | null {
  if (!raw) return null;
  const m = raw.replace(/,/g, '').match(/(\d+(?:\.\d{1,2})?)/);
  if (!m) return null;
  return Math.round(parseFloat(m[1]) * 100);
}

function formatCents(cents: number): string {
  const dollars = cents / 100;
  return `$${dollars.toFixed(dollars >= 100 ? 0 : 2)}`;
}

function buildRetailerOffers(product: Product): RetailerOffer[] {
  const baseCents = parsePriceCents(product.price);
  if (!baseCents) {
    // No parseable price: still surface SOMETHING shoppable so the Shop
    // button is never an empty button. If there's a brand URL, that's
    // the official site; otherwise route to a web search for the
    // product so the chip still works.
    const fallbackUrl = product.url
      || `https://www.google.com/search?q=${encodeURIComponent(`${product.brand || ''} ${product.name || ''}`.trim() + ' buy')}`;
    return [{ retailer: product.brand || 'Brand site', url: fallbackUrl, price: ' - ', priceCents: 0, badge: 'official' }];
  }
  const seed = hashString(`${product.brand}|${product.name}`);
  // Three deterministic alts pulled from the rotating pool.
  const altCount = 3;
  const offset = seed % ALT_RETAILERS.length;
  const q = encodeURIComponent(`${product.brand || ''} ${product.name || ''}`.trim());

  const offers: RetailerOffer[] = [];

  if (product.url) {
    offers.push({
      retailer: product.brand || 'Brand site',
      url: product.url,
      price: formatCents(baseCents),
      priceCents: baseCents,
      badge: 'official',
    });
  }

  for (let i = 0; i < altCount; i++) {
    const r = ALT_RETAILERS[(offset + i) % ALT_RETAILERS.length];
    // Per-retailer jitter so prices are believably varied - clamp to ±15%.
    const jitterSeed = hashString(`${product.brand}|${product.name}|${r.name}`);
    const jitter = ((jitterSeed % 200) / 1000) - 0.10; // -0.10 .. +0.10
    const factor = 1 + r.bias + jitter;
    const altCents = Math.max(100, Math.round(baseCents * factor));
    offers.push({
      retailer: r.name,
      url: r.url(q),
      price: formatCents(altCents),
      priceCents: altCents,
    });
  }

  // Mark the cheapest as "lowest"; if it also undercuts the brand price by
  // >=10%, mark a "discount" badge with the percent off.
  const cheapest = offers.reduce((acc, o) => (o.priceCents < acc.priceCents ? o : acc), offers[0]);
  if (cheapest && cheapest.badge !== 'official') {
    cheapest.badge = 'lowest';
    if (baseCents - cheapest.priceCents >= baseCents * 0.10) {
      cheapest.badge = 'discount';
      cheapest.discountPct = Math.round(((baseCents - cheapest.priceCents) / baseCents) * 100);
    }
  }
  return offers;
}

// Brand-logo experiment removed - Brandfetch's results were inconsistent
// (white squares for opaque-bg logos, wrong-brand fallbacks for products
// scraped from Google Shopping). Brand text is the reliable indicator.

interface SavedByDummy { count: number; avatars: { name: string; avatar: string }[] }
function dummySavedBy(productKey: string): SavedByDummy {
  if (AVATAR_POOL.length === 0) return { count: 0, avatars: [] };
  const h = hashString(productKey);
  // 47–527 is a plausible "interesting but not insane" range for a curated
  // catalog product. Bias the low end so most products read as believable.
  const count = 47 + (h % 481);
  const start = h % AVATAR_POOL.length;
  const visibleN = Math.min(5, AVATAR_POOL.length);
  const avatars = Array.from({ length: visibleN }, (_, i) => AVATAR_POOL[(start + i) % AVATAR_POOL.length]);
  return { count, avatars };
}

/** Compact video tile for the brand strip - small, shows a product image
 *  poster + brand/name caption so the tile is never blank, then swaps in
 *  the video once frames are decoded. Tap reuses the shared <video>
 *  element via the trail host so playback continues without remount. */
function BrandStripTile({ creative, onOpen }: { creative: ProductAd; onOpen: (c: ProductAd) => void }) {
  const [loaded, setLoaded] = useState(false);
  const slotRef = useRef<HTMLDivElement | null>(null);
  // pickPosterUrl returns the thumbnail when present, falls back to
  // product image. Passed to the trail-video pool so the <video poster=>
  // attribute paints a real image during MP4 load.
  const tilePoster = pickPosterUrl(creative);
  const tileSrc = pickVideoUrl(creative) ?? creative.video_url ?? undefined;
  const setSlot = useTrailVideo(creative.id, tileSrc, tilePoster || undefined);
  const setRef = useCallback((node: HTMLDivElement | null) => {
    slotRef.current = node;
    setSlot(node);
  }, [setSlot]);
  useEffect(() => {
    const video = slotRef.current?.querySelector('video') as HTMLVideoElement | null;
    if (!video) return;
    if (video.readyState >= 2) { setLoaded(true); return; }
    const handler = () => setLoaded(true);
    ['playing', 'canplay', 'loadeddata'].forEach(e => video.addEventListener(e, handler, { once: true }));
    const t = setTimeout(() => setLoaded(true), 6000);
    return () => {
      clearTimeout(t);
      ['playing', 'canplay', 'loadeddata'].forEach(e => video.removeEventListener(e, handler));
    };
  }, [creative.id]);

  const posterUrl = creative.thumbnail_url
    || creative.product?.image_url
    || (creative.product?.images && creative.product.images[0])
    || '';
  const productName = creative.product?.name || '';

  return (
    <button
      type="button"
      className={`pd-brand-tile ${loaded ? 'loaded' : ''}`}
      onClick={() => { trackAdClick(creative.id); onOpen(creative); }}
      onMouseEnter={() => prefetchSimilarCreatives(creative.id, 18, creative.product?.type ?? null)}
      onTouchStart={() => prefetchSimilarCreatives(creative.id, 18, creative.product?.type ?? null)}
    >
      {posterUrl && (
        <img
          className="pd-brand-tile-poster"
          src={posterUrl}
          alt={productName}
          loading="lazy"
        />
      )}
      <div ref={setRef} className="pd-brand-tile-slot" data-trail-id={creative.id} />
      {productName && (
        <div className="pd-brand-tile-caption">
          <span className="pd-brand-tile-name">{productName}</span>
        </div>
      )}
    </button>
  );
}

/** Look-creative tile for the "Featured in Looks" grid. Looks have video
 *  via the looks_creative join in services/looks.ts, mapped to look.video. */
function LookTile({
  look,
  index,
  onOpen,
}: {
  look: Look;
  index: number;
  onOpen: (l: Look) => void;
}) {
  const wrapRef = useRef<HTMLButtonElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [inViewport, setInViewport] = useState(false);
  const [renderReady, setRenderReady] = useState(index < 4);
  // True once the <video> has decoded its first frame. The video is
  // rendered opacity:0 until then so the poster <img> underneath stays
  // visible - otherwise the video element paints black on top of the
  // poster for the seconds-long window between mount and first frame.
  const [videoLoaded, setVideoLoaded] = useState(false);
  const trailId = lookTrailId(look.id);
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
  // Phase 6: route through the shared pickVideoUrl helper so save-data
  // and slow-connection users get the small variant even on a wider
  // viewport. The helper expects video_url / mobile_video_url, which
  // matches ProductAd's shape; Look stores the full-res URL on `video`.
  const rawVideo = pickVideoUrl({
    video_url: look.video,
    mobile_video_url: look.mobile_video_url ?? null,
  });
  const videoUrl = normalizeLookVideoUrl(rawVideo, basePath);
  // Full-res URL used for Phase 4 background prefetch. Skip the
  // prefetch when it equals the playable URL (desktop) - that file is
  // already streaming.
  const fullResVideoUrl = normalizeLookVideoUrl(look.video, basePath);

  useEffect(() => {
    const node = wrapRef.current;
    if (!node) return;
    const obs = new IntersectionObserver(
      es => es.forEach(e => setInViewport(e.isIntersecting)),
      // Bumped from 400px to 800px so look-tile videos start streaming
      // ~half a viewport before the user actually scrolls them into
      // view; closes the perceived gap to product images, which paint
      // instantly because they're way smaller.
      { rootMargin: '800px' },
    );
    obs.observe(node);
    return () => obs.disconnect();
  }, []);

  // Phase 5: stagger the request waterfall. The browser caps to ~6
  // concurrent media downloads per origin; an 8-tile rail saturates
  // that and the last 2 sit in queue. Tiles 0-3 render <video>
  // immediately, 4-7 wait a tick, 8+ wait for idle. By the time the
  // first batch has its moov atom + first GOP, the next batch's
  // sockets are free.
  useEffect(() => {
    if (renderReady) return;
    if (typeof window === 'undefined') return;
    const delay = index < 8 ? 200 : 400 + (index - 8) * 100;
    const ric = (window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
    }).requestIdleCallback;
    if (ric) {
      const handle = ric(() => setRenderReady(true), { timeout: delay + 500 });
      return () => {
        const cic = (window as Window & {
          cancelIdleCallback?: (h: number) => void;
        }).cancelIdleCallback;
        if (cic) cic(handle);
      };
    }
    const t = window.setTimeout(() => setRenderReady(true), delay);
    return () => window.clearTimeout(t);
  }, [index, renderReady]);

  // Phase 4: once a tile has been visible ~600ms on mobile, warm the
  // first 256 KB of the full-res clip. Same Phase-8 contract as
  // CreativeCard - by the time the user taps in, the LookOverlay
  // hero gets a cache hit and paints near-instantly.
  useEffect(() => {
    if (!inViewport) return;
    if (!isMobileViewport()) return;
    if (!fullResVideoUrl) return;
    if (fullResVideoUrl === videoUrl) return; // already streaming this URL
    const t = window.setTimeout(() => {
      prefetchVideoBytes(fullResVideoUrl);
    }, 600);
    return () => window.clearTimeout(t);
  }, [inViewport, fullResVideoUrl, videoUrl]);

  // Belt-and-suspenders: force play() once frames decode + on every
  // visibility return. Mobile Safari pauses videos on tab background
  // and the muted-autoplay flag can fail to evaluate when the element
  // is JS-created with src set after attributes; rendering the <video>
  // declaratively (every attribute on the element from creation) plus
  // these retries makes muted autoplay actually fire on mobile.
  useEffect(() => {
    if (!inViewport) return;
    const v = videoRef.current;
    if (!v) return;
    const kick = () => { if (v.paused) void v.play().catch(() => {}); };
    // Phase 1: capture the moment the first frame decodes so the
    // before/after of the rest of the perf work is measurable. Only
    // marks once per tile (the one-shot guard is a closure boolean).
    let marked = false;
    const markFirstFrame = () => {
      if (marked) return;
      marked = true;
      markFeedMilestone(`look-first-frame:${look.id}`);
    };
    if (v.readyState >= 2) { kick(); markFirstFrame(); setVideoLoaded(true); }
    const onLoaded = () => { kick(); markFirstFrame(); setVideoLoaded(true); };
    v.addEventListener('loadeddata', onLoaded);
    v.addEventListener('canplay', onLoaded);
    const onVis = () => { if (!document.hidden) kick(); };
    document.addEventListener('visibilitychange', onVis);
    const interval = window.setInterval(kick, 1000);
    const stopAt = window.setTimeout(() => window.clearInterval(interval), 8000);
    return () => {
      v.removeEventListener('loadeddata', onLoaded);
      v.removeEventListener('canplay', onLoaded);
      document.removeEventListener('visibilitychange', onVis);
      window.clearInterval(interval);
      window.clearTimeout(stopAt);
    };
  }, [inViewport, videoUrl, look.id]);

  // Resolve creator identity in priority order:
  //   1. Static creators map (real handles like @lilywittman/@garrett)
  //   2. Profile fallback baked into the look row (orphan looks created
  //      via the user-generation flow - see services/looks.ts)
  //   3. Raw handle string, but only if it's not the synthetic `user:UUID`
  //      key - that one's a placeholder, not something to show users.
  const creatorEntry = staticCreators[look.creator];
  const displayName = creatorEntry?.displayName
    || look.creatorDisplayName
    || (look.creator?.startsWith('user:') ? '' : look.creator)
    || '';
  const avatarUrl = creatorEntry?.avatar || look.creatorAvatar || '';

  // Look poster: the server-extracted thumbnail when present, the
  // legacy cover image otherwise. Set as <video poster=> so the tile
  // never paints a black frame, and rendered as a separate <img>
  // behind the video so the tile is never blank even outside the
  // viewport prep band.
  const tilePoster = look.thumbnail_url || look.cover || '';

  // Phase 2: the first 8 tiles (one row on desktop, four rows on
  // mobile) get eager + high-priority poster fetch so the rail paints
  // an image the instant it scrolls into view. Later tiles stay lazy
  // so we don't burn bytes on posters the user may never reach.
  const eagerPoster = index < 8;

  // Phase 10: intent-based prefetch. Hover or first-touch = the user
  // is about to tap, so kick the full-res byte fetch immediately.
  // Idempotent via the prefetchedHighResUrls set in video-loading.ts,
  // so this is free if Phase 4 already ran or if the bytes are
  // cached. Closes the cold-cache gap for staggered tiles whose
  // <video> hasn't rendered yet when the tap lands.
  const handleIntent = useCallback(() => {
    if (fullResVideoUrl) prefetchVideoBytes(fullResVideoUrl);
  }, [fullResVideoUrl]);

  return (
    <button
      type="button"
      className="pd-look-tile"
      onClick={() => onOpen(look)}
      onMouseEnter={handleIntent}
      onTouchStart={handleIntent}
      ref={wrapRef}
    >
      {tilePoster ? (
        <>
          {/* Shimmer underneath the poster so the tile never paints
              flat black during the brief window before the <img> network
              fetch resolves. The poster covers it the moment it decodes. */}
          {!videoLoaded && (
            <div className="card-shimmer" style={{ position: 'absolute', inset: 0, zIndex: 0, borderRadius: 0 }} />
          )}
          <img
            src={tilePoster}
            alt=""
            aria-hidden="true"
            className="pd-look-tile-video"
            loading={eagerPoster ? 'eager' : 'lazy'}
            fetchPriority={eagerPoster ? 'high' : 'auto'}
            decoding="async"
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', zIndex: 0 }}
          />
        </>
      ) : (
        <div className="card-shimmer" style={{ position: 'absolute', inset: 0, zIndex: 0, borderRadius: 0 }} />
      )}
      {videoUrl && inViewport && renderReady && (
        <video
          ref={videoRef}
          className="pd-look-tile-video"
          data-trail-id={trailId}
          src={videoUrl}
          poster={tilePoster || undefined}
          muted
          autoPlay
          loop
          playsInline
          preload="auto"
          crossOrigin="anonymous"
          style={{
            position: 'relative',
            zIndex: 1,
            opacity: videoLoaded ? 1 : 0,
            transition: 'opacity 0.25s ease',
          }}
        />
      )}
      {(!videoUrl || !inViewport || !renderReady) && (
        <div className="pd-look-tile-video" data-trail-id={trailId} />
      )}

      <div className="pd-look-tile-meta">
        {/* Always render the creator chip in the lower-left so every
            look has a visible attribution. Static creators get their
            real avatar + name; user-generated orphan looks fall back
            to an initial circle so the chip never disappears. */}
        <span className="pd-look-tile-creator">
          {avatarUrl ? (
            <img
              className="pd-look-tile-avatar"
              src={avatarUrl}
              alt=""
              loading="lazy"
            />
          ) : (
            <span className="pd-look-tile-avatar pd-look-tile-avatar--initial" aria-hidden="true">
              {(displayName || look.creator || '?').charAt(0).toUpperCase()}
            </span>
          )}
          <span>{displayName || (look.creator?.startsWith('user:') ? 'User' : look.creator || '')}</span>
        </span>
      </div>
    </button>
  );
}

/** Pads `arr` to exactly `count` items by cycling through duplicates,
 *  or trims to `count` if the array is longer. Returns empty array
 *  unchanged (no padding for empty sections). */
function fillToExact<T>(arr: T[], count: number): T[] {
  if (arr.length === 0) return [];
  if (arr.length >= count) return arr.slice(0, count);
  const out: T[] = [];
  while (out.length < count) out.push(arr[out.length % arr.length]);
  return out;
}

export default function ProductPage({
  product,
  onClose,
  onOpenLook,
  onOpenBrowser,
  onOpenCreative,
  onOpenBrand,
  creative,
  similarCreatives,
  brandCreatives,
  popularFallback,
  lookCreatives,
  graphPairs,
  bookmarks,
  navKey = 0,
}: ProductPageProps) {
  const navigate = useNavigate();
  const [mounted, setMounted] = useState(false);
  const [isAnimatingOut, setIsAnimatingOut] = useState(false);

  // "Try it on" → /generate with the current product pre-picked.
  // The /generate route looks up the supabase products row by url
  // and prepends it to the picker's selection.
  const handleTryOn = useCallback(() => {
    const url = product.url;
    const target = url
      ? `/generate?step=products&product_url=${encodeURIComponent(url)}`
      : '/generate?step=products';
    navigate(target);
  }, [navigate, product.url]);

  // Shared derived values used by both rails below.
  const ownBrand = (product.brand || '').trim().toLowerCase();
  const ownProductId = (product as Product & { id?: string }).id || '';

  // Resolve seed gender from any available row so we can gender-scope rails.
  const seedGender = useMemo(() => {
    const findSeed = (rows: ProductAd[] | undefined): { gender?: string | null } | null => {
      if (!rows) return null;
      for (const c of rows) {
        if (ownProductId && c.product_id === ownProductId) return c.product || null;
        const cName = (c.product?.name || '').trim().toLowerCase();
        const cBrand = (c.product?.brand || '').trim().toLowerCase();
        if (cBrand === ownBrand && cName === (product.name || '').trim().toLowerCase()) {
          return c.product || null;
        }
      }
      return null;
    };
    const seed = findSeed(similarCreatives) || findSeed(popularFallback);
    return (seed?.gender || '').toLowerCase();
  }, [similarCreatives, popularFallback, ownBrand, ownProductId, product.name]);

  const genderMatches = useCallback((otherGender: string | null | undefined): boolean => {
    if (!seedGender || seedGender === 'unisex') return true;
    const g = (otherGender || '').toLowerCase();
    if (!g || g === 'unisex') return true;
    return g === seedGender;
  }, [seedGender]);

  const pickFrom = useCallback((rows: ProductAd[] | undefined, limit = 16): ProductAd[] => {
    if (!rows || rows.length === 0) return [];
    const seenProductIds = new Set<string>();
    const out: ProductAd[] = [];
    for (const c of rows) {
      const otherBrand = (c.product?.brand || '').trim().toLowerCase();
      if (ownBrand && otherBrand === ownBrand) continue;
      if (ownProductId && c.product_id === ownProductId) continue;
      if (seenProductIds.has(c.product_id)) continue;
      if (!genderMatches(c.product?.gender)) continue;
      seenProductIds.add(c.product_id);
      out.push(c);
      if (out.length >= limit) break;
    }
    return out;
  }, [ownBrand, ownProductId, genderMatches]);

  // "More like this" — only from the type-scoped similarity RPC.
  // Empty when the RPC returns nothing; Popular section fills the gap instead.
  const moreLikeThis = useMemo(
    () => pickFrom(similarCreatives),
    [similarCreatives, pickFrom],
  );

  // "Popular" — shown only when moreLikeThis is empty.
  // Filtered to the same product type so we never show unrelated items.
  // "Popular" rail — shown only when "More like this" has no results.
  // No type filter: the whole point is to surface something when similarity
  // returns nothing, so we show the full popular feed (cross-brand, gender-
  // scoped as usual via pickFrom).
  const popularItems = useMemo((): ProductAd[] => {
    if (moreLikeThis.length > 0) return [];
    return pickFrom(popularFallback);
  }, [moreLikeThis, popularFallback, pickFrom]);
  // Shop dropdown - collapsed by default on mobile so the action row
  // reads clean; auto-expanded on desktop because the split layout
  // gives the right column plenty of vertical space and the retailer
  // comparison is the highest-value content there.
  const isDesktop = typeof window !== 'undefined'
    && window.matchMedia('(min-width: 960px)').matches;
  const [showRetailers, setShowRetailers] = useState(isDesktop);
  const scrollerRef = useRef<HTMLDivElement>(null);

  // Re-sync the drawer when the user navigates to a different product:
  // open by default on desktop, closed on mobile.
  useEffect(() => {
    setShowRetailers(
      typeof window !== 'undefined'
        && window.matchMedia('(min-width: 960px)').matches,
    );
  }, [product.brand, product.name]);

  useEffect(() => {
    requestAnimationFrame(() => setMounted(true));
  }, []);

  // Reset scroll to top on every product navigation. useLayoutEffect runs
  // synchronously after DOM updates but BEFORE paint - combined with
  // `behavior: 'instant'`, the snap-to-top happens between renders so
  // the user never sees the new content briefly scrolled to the old
  // tap position. The dep is the parent's nav counter (not brand+name)
  // so the effect fires on every trail step regardless of whether the
  // products happen to share fields.
  useLayoutEffect(() => {
    scrollerRef.current?.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }, [navKey]);

  const handleClose = useCallback(() => {
    setIsAnimatingOut(true);
    setTimeout(onClose, 320);
  }, [onClose]);

  // Mobile drag-to-dismiss. Listens on the scroller; only engages while
  // scrollTop is at the top so users can scroll content normally without
  // accidentally dismissing. A pull > 96px or fast flick triggers close.
  // No-op on desktop. Passive listeners - never preventDefault - so the
  // Flutter shell's gesture handlers stay intact.
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ startY: number; startTime: number; active: boolean }>({
    startY: 0, startTime: 0, active: false,
  });
  useEffect(() => {
    const overlay = overlayRef.current;
    const scroller = scrollerRef.current;
    if (!overlay || !scroller) return;
    if (typeof window === 'undefined') return;
    if (window.matchMedia('(min-width: 960px)').matches) return;

    const onStart = (e: TouchEvent) => {
      if (scroller.scrollTop > 0) return;
      dragRef.current = {
        startY: e.touches[0].clientY,
        startTime: performance.now(),
        active: true,
      };
    };
    const onMove = (e: TouchEvent) => {
      if (!dragRef.current.active) return;
      const dy = e.touches[0].clientY - dragRef.current.startY;
      if (dy <= 0) {
        // Dragging up - release control so native scroll resumes.
        overlay.style.transform = '';
        overlay.classList.remove('is-dragging');
        dragRef.current.active = false;
        return;
      }
      overlay.classList.add('is-dragging');
      overlay.style.transform = `translateY(${dy}px)`;
    };
    const onEnd = (e: TouchEvent) => {
      if (!dragRef.current.active) return;
      const endY = e.changedTouches[0].clientY;
      const dy = endY - dragRef.current.startY;
      const dt = performance.now() - dragRef.current.startTime;
      const velocity = dt > 0 ? dy / dt : 0; // px/ms
      overlay.classList.remove('is-dragging');
      overlay.style.transform = '';
      dragRef.current.active = false;
      if (dy > 96 || velocity > 0.6) handleClose();
    };

    scroller.addEventListener('touchstart', onStart, { passive: true });
    scroller.addEventListener('touchmove', onMove, { passive: true });
    scroller.addEventListener('touchend', onEnd, { passive: true });
    scroller.addEventListener('touchcancel', onEnd, { passive: true });
    return () => {
      scroller.removeEventListener('touchstart', onStart);
      scroller.removeEventListener('touchmove', onMove);
      scroller.removeEventListener('touchend', onEnd);
      scroller.removeEventListener('touchcancel', onEnd);
    };
  }, [handleClose]);

  useEscapeKey(handleClose);

  const isSaved = bookmarks.isProductBookmarked(product);

  const handleToggleSave = useCallback(() => {
    bookmarks.toggleProductBookmark(product);
  }, [bookmarks, product]);

  // Dummy social proof. Stable per product so the count + avatars don't
  // reshuffle on every re-render. Wire to a real `product_saves` table when
  // we ship it.
  const savedBy = useMemo(
    () => dummySavedBy(`${product.brand}|${product.name}`),
    [product.brand, product.name],
  );

  // Retailer chips - brand site + 3 synthetic alts (same pool every time so
  // prices are consistent across re-renders). Cheapest gets a lowest /
  // discount badge.
  const retailerOffers = useMemo(() => buildRetailerOffers(product), [product]);

  const heroClassName = `pd-hero${creative ? ' pd-hero--video' : product.image ? ' pd-hero--image' : ' pd-hero--empty'}`;

  // Tap-handoff poster: when CreativeCard navigates here, it stashes a
  // canvas snapshot of the playing card frame on window.__feedTapPosters.
  // We pick it up synchronously so the hero can paint that exact frame
  // BEFORE the trail-host has had a chance to swap in the live element.
  // Cleared after read so the next tap doesn't reuse a stale snapshot.
  const tapHandoffPoster = (() => {
    if (typeof window === 'undefined') return '';
    if (!creative?.id) return '';
    const w = window as Window & { __feedTapPosters?: Record<string, string> };
    const url = w.__feedTapPosters?.[creative.id];
    if (url && w.__feedTapPosters) delete w.__feedTapPosters[creative.id];
    return url || '';
  })();
  const heroPoster = tapHandoffPoster || creative?.thumbnailUrl || '';

  // Take ownership of the shared <video> element keyed by creative.id. The
  // TrailVideoHost moves the running DOM node from the card slot into this
  // hero slot - appendChild preserves currentTime + decoded frames, so there
  // is no reload, no black flash, no audio gap. The poster argument keeps
  // the <video> element painting a real image even on the (rare) cold
  // path where the pool element was evicted between card unmount and
  // hero attach.
  const setHeroSlot = useTrailVideo(
    creative?.id,
    creative?.videoUrl,
    heroPoster || undefined,
  );

  // Phase 8 helper: kick off a high-res prefetch on hero mount in case
  // the card-side preload (only fires on mobile) didn't run. Idempotent
  // by URL so a second call here is free when the card already warmed
  // the cache.
  useEffect(() => {
    if (creative?.videoUrl) prefetchVideoBytes(creative.videoUrl);
  }, [creative?.id, creative?.videoUrl]);

  // Prewarm "Featured in Looks" poster images. Each look that's
  // about to render a tile gets its poster jpeg pulled into the
  // browser image cache while the user is still reading the hero.
  // Posters are tiny (~30 KB) so the cost is negligible and the
  // payoff is the rail painting instantly the moment it scrolls
  // into view - same first-paint cadence as the product images
  // around it.
  //
  // Phase 3: Range-bounded byte prefetch for staggered look tiles.
  // Tiles 0-3 have renderReady=true and mount <video> elements immediately,
  // so prefetching their bytes would create competing downloads for the same
  // URL. Only prefetch tiles 4-11 which have a render delay (200-400 ms)
  // giving us a head start before their <video> elements mount.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!lookCreatives || lookCreatives.length === 0) return;
    const tiles = lookCreatives.slice(0, 12);
    for (const l of tiles) {
      const url = l.thumbnail_url;
      if (!url) continue;
      try {
        const img = new Image();
        img.decoding = 'async';
        img.src = url;
      } catch { /* ignore */ }
    }
    const mobile = isMobileViewport();
    for (const l of tiles.slice(4, 12)) {
      const videoUrl = (mobile && l.mobile_video_url) || l.video;
      if (videoUrl && /^https?:\/\//i.test(videoUrl)) {
        prefetchVideoBytes(videoUrl);
      }
    }
  }, [lookCreatives]);

  return (
    <div
      ref={overlayRef}
      className={`product-page-overlay${mounted && !isAnimatingOut ? ' product-page-overlay--in' : ''}${isAnimatingOut ? ' product-page-overlay--out' : ''}`}
      role="dialog"
      aria-modal="true"
    >
      <div className="product-page" ref={scrollerRef}>
        <button
          className="pd-back"
          onClick={handleClose}
          aria-label="Back"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>

        <div className="pd-split">
          <section className={heroClassName}>
            {creative ? (
              <>
                {/* Phase 9 instant poster: paints synchronously on mount
                    using either the canvas-frame stashed by the tapped
                    card or the static thumbnail. The trail-host attaches
                    its <video> on top in the same paint cycle, so the
                    user sees a real frame immediately - never the black
                    flash that used to bridge the card-to-hero gap. */}
                {heroPoster && (
                  <img
                    src={heroPoster}
                    alt=""
                    aria-hidden="true"
                    className="pd-hero-media pd-hero-handoff-poster"
                    style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', zIndex: 0 }}
                  />
                )}
                <div
                  ref={setHeroSlot}
                  className="pd-hero-media pd-hero-video-slot"
                  data-trail-id={creative.id}
                  style={{ position: 'relative', zIndex: 1 }}
                />
              </>
            ) : product.image ? (
              <img
                src={product.image.replace('w=200&h=200', 'w=1200&h=1600')}
                alt={product.name}
                className="pd-hero-media"
              />
            ) : (
              <div className="pd-hero-placeholder" />
            )}
            <div className="pd-hero-scrim" />
          </section>

          <section className="pd-info">
          <div className="pd-info-inner">
            {product.brand && (
              onOpenBrand
                ? (
                  <button
                    type="button"
                    className="pd-brand brand-link"
                    onClick={() => onOpenBrand(product.brand!)}
                  >
                    {product.brand}
                  </button>
                )
                : <div className="pd-brand">{product.brand}</div>
            )}
            <h1 className="pd-name">{product.name}</h1>
            {product.price && <div className="pd-price">{product.price}</div>}

            {/* Saved-by social-proof row. Dummy data today - wired to
                bookmark-based save counts when the product_saves table ships. */}
            {savedBy.avatars.length > 0 && (
              <div className="pd-saved-by" aria-label={`Saved by ${savedBy.count} shoppers`}>
                <div className="pd-saved-avatars">
                  {savedBy.avatars.map((a, i) => (
                    <img
                      key={a.name}
                      src={a.avatar}
                      alt=""
                      className="pd-saved-avatar"
                      style={{ zIndex: savedBy.avatars.length - i }}
                      loading="lazy"
                    />
                  ))}
                </div>
                <span className="pd-saved-count">
                  Saved by <strong>{savedBy.count.toLocaleString()}</strong>
                </span>
              </div>
            )}

            <div className="pd-actions">
              {retailerOffers.length > 0 && (
                <button
                  type="button"
                  className={`pd-shop-btn${showRetailers ? ' is-open' : ''}`}
                  onClick={() => setShowRetailers(s => !s)}
                  aria-expanded={showRetailers}
                  aria-controls="pd-retailers-drawer"
                >
                  <span>Shop</span>
                  <svg className="pd-shop-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>
              )}
              <button
                type="button"
                className="pd-tryon-btn"
                onClick={handleTryOn}
                aria-label="Try this on"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                </svg>
                <span>Try it on</span>
              </button>
              <button
                type="button"
                className={`pd-bookmark-btn ${isSaved ? 'is-saved' : ''}`}
                onClick={handleToggleSave}
                aria-label={isSaved ? 'Remove from bookmarks' : 'Save product'}
                aria-pressed={isSaved}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill={isSaved ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
                </svg>
                <span>{isSaved ? 'Saved' : 'Save'}</span>
              </button>
            </div>

            {/* Retailer comparison drawer. Hidden until the user taps Shop.
                Each chip says the retailer name + the price at that
                retailer. Tap goes straight to that retailer's page (in-app
                browser). The cheapest is badged "Lowest" or "Discount −X%"
                based on % off MSRP. The brand's own site sits first,
                marked "Official". */}
            {retailerOffers.length > 0 && (
              <div
                id="pd-retailers-drawer"
                className={`pd-retailers-drawer${showRetailers ? ' is-open' : ''}`}
                role="region"
                aria-label="Where to buy"
                hidden={!showRetailers}
              >
                <div className="pd-retailers" role="list">
                  {retailerOffers.map(offer => (
                    <button
                      key={offer.retailer}
                      type="button"
                      className={`pd-retailer-chip${offer.badge ? ` is-${offer.badge}` : ''}`}
                      onClick={() => {
                        setShowRetailers(false);
                        // Fire-and-forget clickout telemetry. Resolves the
                        // products.url → id so /admin/products + the per-
                        // user CTR both attribute the right product.
                        void trackProductClickout(offer.url, product.brand, product.name);
                        onOpenBrowser(offer.url, `${offer.retailer} - ${product.name}`, product);
                      }}
                      role="listitem"
                    >
                      <span className="pd-retailer-name">{offer.retailer}</span>
                      <span className="pd-retailer-price">{offer.price}</span>
                      {offer.badge === 'official' && <span className="pd-retailer-badge">Official</span>}
                      {offer.badge === 'lowest' && <span className="pd-retailer-badge pd-retailer-badge--lowest">Lowest</span>}
                      {offer.badge === 'discount' && (
                        <span className="pd-retailer-badge pd-retailer-badge--discount">−{offer.discountPct}%</span>
                      )}
                      <svg className="pd-retailer-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="7" y1="17" x2="17" y2="7" />
                        <polyline points="7 7 17 7 17 17" />
                      </svg>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* "More from <brand>" rail - fills the negative space below
                the Shop drawer in the info column with same-brand-mate
                creatives. Cross-brand discovery happens below in the
                "More like this" feed. */}
            {brandCreatives && brandCreatives.length > 0 && onOpenCreative && (
              <section className="pd-info-brand-rail" aria-label={`More from ${product.brand || 'this brand'}`}>
                <h2 className="pd-info-brand-rail-title">
                  More from {product.brand || 'this brand'}
                </h2>
                <div className="pd-info-brand-rail-grid">
                  {brandCreatives.slice(0, 6).map(c => (
                    <BrandStripTile key={c.id} creative={c} onOpen={onOpenCreative} />
                  ))}
                </div>
              </section>
            )}
          </div>
        </section>
        </div>

        {moreLikeThis.length > 0 && (
          <section className="pd-similar-feed">
            <h2 className="pd-feed-title">More like this</h2>
            <div className="pd-similar-grid">
              {/* CreativeCard handles the layoutId morph + shared video element
                  so a tap here continues the trail with the same fluid handoff. */}
              {fillToExact(moreLikeThis, 8).map((c, i) => (
                <CreativeCard
                  key={`mlt-${i}`}
                  creative={c}
                  className="look-card"
                  onOpenProduct={onOpenCreative}
                />
              ))}
            </div>
          </section>
        )}

        {popularItems.length > 0 && (
          <section className="pd-similar-feed">
            <h2 className="pd-feed-title">Popular</h2>
            <div className="pd-similar-grid">
              {fillToExact(popularItems, 8).map((c, i) => (
                <CreativeCard
                  key={`pop-${i}`}
                  creative={c}
                  className="look-card"
                  onOpenProduct={onOpenCreative}
                />
              ))}
            </div>
          </section>
        )}

        {lookCreatives && lookCreatives.length > 0 && (
          <section className="pd-look-feed">
            <h2 className="pd-feed-title">Featured in Looks</h2>
            <div className="pd-look-grid">
              {fillToExact(lookCreatives, 8).map((l, i) => (
                <LookTile key={`fl-${i}`} look={l} index={i} onOpen={onOpenLook} />
              ))}
            </div>
          </section>
        )}

        {graphPairs && graphPairs.length > 0 && (
          <section className="pd-graph-pairs" aria-label="Pairs well with">
            <h2 className="pd-feed-title">Pairs well with</h2>
            <div className="pd-graph-pairs-rail">
              {graphPairs.map(pair => (
                <button
                  key={pair.product_id}
                  className="pd-graph-pair-tile"
                  onClick={() => {
                    if (pair.url && onOpenBrowser) {
                      onOpenBrowser(pair.url, pair.name || pair.brand || 'Product', {
                        name: pair.name || '',
                        brand: pair.brand || '',
                        price: pair.price || '',
                        url: pair.url,
                        image: pair.image_url || undefined,
                      });
                    }
                  }}
                  aria-label={[pair.brand, pair.name].filter(Boolean).join(' — ')}
                >
                  {pair.image_url && (
                    <img
                      src={pair.image_url}
                      alt={pair.name || ''}
                      className="pd-graph-pair-img"
                      loading="lazy"
                    />
                  )}
                  <div className="pd-graph-pair-meta">
                    {pair.brand && <span className="pd-graph-pair-brand">{pair.brand}</span>}
                    {pair.name && <span className="pd-graph-pair-name">{pair.name}</span>}
                    {pair.price && <span className="pd-graph-pair-price">{pair.price}</span>}
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
