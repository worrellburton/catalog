import { useMemo, useState, useEffect, useLayoutEffect, useCallback, useRef } from 'react';
import { useNavigate } from '@remix-run/react';
import { Product, Look, creators as staticCreators } from '~/data/looks';
import ContinuousFeed from '~/components/ContinuousFeed';
import { useActiveGenderFilter } from '~/hooks/useActiveGenderFilter';
import { useEscapeKey } from '~/hooks/useEscapeKey';
import CreativeCardV2 from '~/components/CreativeCardV2';
import CreatorAvatarFollow from '~/components/CreatorAvatarFollow';
import { useTrailVideo, useTrailVideoManager } from '~/components/TrailVideoHost';
import { useInViewport } from '~/hooks/useInViewport';
import { lookTrailId, normalizeLookVideoUrl } from '~/utils/trailIds';
import { trackAdClick, prefetchSimilarProducts, getSimilarProductsDiagnostics, deleteProduct, type ProductAd } from '~/services/product-creative';
import SimilarDebugModal, { buildProductSimilarReport, buildGraphPairsReport, buildAffinityReport, type SimilarDebugReport } from '~/components/SimilarDebugModal';
import { getProductDetails, type ProductDetails } from '~/services/product-details';
import ProductMeasurementsDiagram from '~/components/ProductMeasurementsDiagram';
import ProductCatalogPills from '~/components/ProductCatalogPills';
import { getProductCatalogs, type ProductCatalog } from '~/services/catalogs';
import { isFitRelevant, deriveFitLabel } from '~/utils/productTaxonomy';
import { type GraphPair } from '~/services/graph-pairs';
import { useAuth } from '~/hooks/useAuth';
import { ConfirmModal } from '~/components/ConfirmModal';
import { catalogAlert, catalogConfirm } from '~/components/CatalogDialog';
import { hideProductKey } from '~/hooks/useHiddenLooks';
import { useShopperBody } from '~/hooks/useShopperBody';
import { usePageSections, isSectionEnabled, getSectionLimit, isSectionInfinite } from '~/hooks/usePageSections';
import { useUserAffinity } from '~/hooks/useUserAffinity';
import { useDynamicSectionTitle } from '~/hooks/useDynamicSectionTitle';
import { useRecentProducts } from '~/hooks/useRecentProducts';
import { getRecentSearches } from '~/services/recent-searches';
import SizeMatchBadge from '~/components/SizeMatchBadge';
import { director } from '~/services/video-playback-director';
import { warmPosters, posterRendition } from '~/utils/poster-prefetch';
import { recordOverlayScroll, consumeReturnScroll } from '~/utils/overlay-scroll-stash';
import OverlayChrome from '~/components/OverlayChrome';
import CatalogLogo from '~/components/CatalogLogo';
import AdminContextPanel from '~/components/AdminContextPanel';
import { productSlug } from '~/utils/slug';
import { useCommentsEnabled } from '~/hooks/useCommentsEnabled';
import { getCommentCount } from '~/services/comments';
import {
  pickVideoUrl,
  pickPosterUrl,
  prefetchVideoBytes,
  isMobileViewport,
  markFeedMilestone,
  takeTapPoster,
} from '~/services/video-loading';
import { useVideoPipelineMode } from '~/hooks/useVideoPipeline';
import { lookPoster, productPoster } from '~/services/media-resolver';
import { emitSavedToast } from '~/utils/savedToast';
import '~/styles/product-page.css';

interface ProductPageCreative {
  /** The product_creative.id - used to resolve the shared <video> element
   *  from TrailVideoHost so the morph reuses the card's playing instance. */
  id?: string;
  videoUrl: string;
  /** HLS master playlist (adaptive ladder). When set the hero plays this one
   *  source and ramps to a high rung at full-screen size; falls back to
   *  videoUrl (MP4) when absent. */
  hlsUrl?: string | null;
  thumbnailUrl?: string | null;
}

interface BookmarksInterface {
  isLookBookmarked: (id: number) => boolean;
  toggleLookBookmark: (id: number) => void;
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
  /** Tap a "Popular in" catalog pill → opens that catalog's feed (runs the
   *  catalog name as a search). Omitted in contexts without a feed behind us. */
  onCreateCatalog?: (query: string) => void;
  /** Opens the comment thread as an in-app overlay (keeps this product
   *  mounted underneath so Back returns to the exact same hero). */
  onOpenComments?: (type: 'product' | 'look', slug: string) => void;
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
  /** Full look pool for the "You might also like" infinite section. Falls
   *  back to the static allLooksData when omitted. */
  allLooks?: Look[];
  /** The look the shopper opened this product from (if any). Used to
   *  surface a "More from this creator" section on the info column —
   *  same dedicated section that lives on LookOverlay. Optional: when
   *  the product was opened cold (no parent look), the section is
   *  skipped. */
  fromLook?: Look | null;
  bookmarks: BookmarksInterface;
  /** Increments on every navigation. ProductPage's scroll-to-top
   *  effect depends on this so it fires reliably even when the new
   *  product happens to share brand+name with the prior one. */
  navKey?: number;
  /** Logo → home (reset to feed). Powers the scroll-reactive top chrome. */
  onHome?: () => void;
  /** Run a search on the feed (closes the overlay first). */
  onSearch?: (q: string) => void;
}

// Brand-logo experiment removed - Brandfetch's results were inconsistent
// (white squares for opaque-bg logos, wrong-brand fallbacks for products
// scraped from Google Shopping). Brand text is the reliable indicator.

/** Compact video tile for the brand strip - small, shows a product image
 *  poster + brand/name caption so the tile is never blank, then swaps in
 *  the video once frames are decoded. Tap reuses the shared <video>
 *  element via the trail host so playback continues without remount. */
function BrandStripTile({ creative, onOpen }: { creative: ProductAd; onOpen: (c: ProductAd) => void }) {
  const [loaded, setLoaded] = useState(false);
  const slotRef = useRef<HTMLDivElement | null>(null);
  const tileRef = useRef<HTMLButtonElement | null>(null);
  // Attach the pooled <video> only once the tile is near the viewport.
  // The strip sits below the hero, so on open its six tiles used to start
  // six decoders the shopper couldn't see yet — on top of the hero and the
  // look tiles. RAIL_ATTACH_MARGIN still gives a head start before it scrolls in.
  const nearViewport = useInViewport(tileRef, RAIL_ATTACH_MARGIN);
  // pickPosterUrl returns the thumbnail when present, falls back to
  // product image. Passed to the trail-video pool so the <video poster=>
  // attribute paints a real image during MP4 load.
  const tilePoster = pickPosterUrl(creative);
  const tileSrc = pickVideoUrl(creative) ?? creative.video_url ?? undefined;
  const setSlot = useTrailVideo(creative.id, tileSrc, tilePoster || undefined);
  // Identity changes with nearViewport on purpose: React then runs the old
  // callback with null (detach when leaving) and the new one with the node
  // (attach when arriving).
  const setRef = useCallback((node: HTMLDivElement | null) => {
    slotRef.current = node;
    setSlot(nearViewport ? node : null);
  }, [setSlot, nearViewport]);
  useEffect(() => {
    if (!nearViewport) return;
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
  }, [creative.id, nearViewport]);

  const posterUrl = creative.thumbnail_url
    || creative.product?.image_url
    || (creative.product?.images && creative.product.images[0])
    || '';
  const productName = creative.product?.name || '';

  return (
    <button
      type="button"
      ref={tileRef}
      className={`pd-brand-tile ${loaded ? 'loaded' : ''}`}
      onClick={() => { trackAdClick(creative.id); onOpen(creative); }}
      onMouseEnter={() => prefetchSimilarProducts(creative.product?.id || '', 18)}
      onTouchStart={() => prefetchSimilarProducts(creative.product?.id || '', 18)}
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

/** IntersectionObserver margin for attaching a rail tile's pooled <video>:
 *  roughly half a screen ahead, so buffering starts before the tile scrolls
 *  in without lighting up every below-the-fold tile on open. */
const RAIL_ATTACH_MARGIN = '60% 0%';

/** Look-creative tile for the "Featured in Looks" grid. Looks have video
 *  via the looks_creative join in services/looks.ts, mapped to look.video.
 *  Uses the TrailVideoHost shared pool — no per-tile <video> elements,
 *  no stagger timers, no intervals. Videos attach once the tile is near
 *  the viewport (RAIL_ATTACH_MARGIN). */
function LookTile({
  look,
  index,
  onOpen,
  onOpenCreator,
  posterOnly = false,
}: {
  look: Look;
  index: number;
  onOpen: (l: Look) => void;
  /** Padded duplicate of a look already in the grid: shows the poster only
   *  and never takes a pooled <video> (each duplicate used to decode its own
   *  copy of the same clip). */
  posterOnly?: boolean;
  /** Click on the creator chip jumps to that creator's catalog
   *  page instead of opening the look. Routed via the same
   *  handleOpenCreator wired through to ContinuousFeed elsewhere. */
  onOpenCreator?: (creatorName: string) => void;
}) {
  const wrapRef = useRef<HTMLButtonElement | null>(null);
  const slotRef = useRef<HTMLDivElement | null>(null);
  const inViewport = useInViewport(wrapRef);
  const nearViewport = useInViewport(wrapRef, RAIL_ATTACH_MARGIN);
  const trailId = lookTrailId(look.id);
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

  const rawVideo = pickVideoUrl({
    video_url: look.video,
    mobile_video_url: look.mobile_video_url ?? null,
  });
  const videoUrl = normalizeLookVideoUrl(rawVideo, basePath);
  const fullResVideoUrl = normalizeLookVideoUrl(look.video, basePath);
  const tilePoster = lookPoster(look);

  // Attach the shared TrailVideoHost <video> once the tile is NEAR the
  // viewport (RAIL_ATTACH_MARGIN ≈ half a screen ahead), not on mount. Eager
  // attach used to start eight decoders the moment the page opened — every
  // one below the fold on a phone, competing with the hero for the iOS
  // decoder ceiling. The margin still starts buffering (preload='auto')
  // before the tile scrolls in. Padded duplicates never attach at all.
  const setVideoSlot = useTrailVideo(trailId, posterOnly ? undefined : videoUrl, tilePoster || undefined);

  // Identity changes with nearViewport on purpose: React then runs the old
  // callback with null (detach when leaving) and the new one with the node
  // (attach when arriving).
  const setSlot = useCallback((el: HTMLDivElement | null) => {
    slotRef.current = el;
    setVideoSlot(nearViewport ? el : null);
  }, [setVideoSlot, nearViewport]);

  // Once visible, warm the full-res clip for instant LookOverlay open.
  useEffect(() => {
    if (!inViewport) return;
    if (!isMobileViewport()) return;
    if (!fullResVideoUrl || fullResVideoUrl === videoUrl) return;
    const t = window.setTimeout(() => prefetchVideoBytes(fullResVideoUrl), 600);
    return () => window.clearTimeout(t);
  }, [inViewport, fullResVideoUrl, videoUrl]);

  // Mark first frame for perf traces.
  useEffect(() => {
    if (!inViewport) return;
    const v = slotRef.current?.querySelector('video') as HTMLVideoElement | null;
    if (!v) return;
    let marked = false;
    const mark = () => {
      if (marked) return;
      marked = true;
      markFeedMilestone(`look-first-frame:${look.id}`);
    };
    if (v.readyState >= 2) { mark(); return; }
    v.addEventListener('loadeddata', mark, { once: true });
    v.addEventListener('canplay', mark, { once: true });
    return () => {
      v.removeEventListener('loadeddata', mark);
      v.removeEventListener('canplay', mark);
    };
  }, [inViewport, trailId, look.id]);

  const creatorEntry = staticCreators[look.creator];
  const displayName = creatorEntry?.displayName
    || look.creatorDisplayName
    || (look.creator?.startsWith('user:') ? '' : look.creator)
    || '';
  const avatarUrl = creatorEntry?.avatar || look.creatorAvatar || '';
  const eagerPoster = index < 8;

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
      ) : (
        <div className="card-shimmer" style={{ position: 'absolute', inset: 0, zIndex: 0, borderRadius: 0 }} />
      )}
      <div
        ref={setSlot}
        className="pd-look-tile-video"
        data-trail-id={trailId}
        style={{ position: 'relative', zIndex: 1 }}
      />

      {/* Creator chip pinned to the lower-left of the tile. Rendered
          as a nested clickable role="button" — the outer <button>
          opens the look; stopPropagation on this chip routes to the
          creator catalog instead. Avatar pulls profiles.avatar_url
          via the looks fetcher (see services/looks.ts), so once the
          admin uploads a profile pic via AvatarUpload it lights up
          here automatically. */}
      {/* Display-only: tapping the tile opens the look (only the +/− follow
          badge is interactive) — never the wrong creator catalog. */}
      <span className="pd-look-tile-meta">
        <CreatorAvatarFollow
          handle={look.creator}
          avatarUrl={avatarUrl}
          displayName={displayName}
          size={22}
          onOpenCreator={(h) => onOpenCreator?.(h)}
          avatarOpensCreator={false}
        />
        {displayName && (
          <span className="card-creator-tag-name">{displayName}</span>
        )}
      </span>
    </button>
  );
}

/** Pads `arr` to exactly `count` items by cycling duplicates, or trims.
 *  Safe for CreativeCardV2: each rendered tile gets a per-index slotId
 *  (`…:ymal-<id>-<i>`), so padded duplicates never collide on a shared
 *  director pool slot. */
function fillToExact<T>(arr: T[], count: number): T[] {
  if (arr.length === 0) return [];
  if (arr.length >= count) return arr.slice(0, count);
  const out: T[] = [];
  while (out.length < count) out.push(arr[out.length % arr.length]);
  return out;
}

/** Pads a Look array to `count` by cycling — duplicate slots get a
 *  slot-unique synthetic id so LookTile's lookTrailId() stays unique
 *  and TrailVideoHost gives each slot its own <video> element.
 *  Same video URL, served from browser cache: zero extra network cost. */
function padLooks(arr: Look[], count: number): Look[] {
  if (arr.length === 0) return [];
  // Synthesize a unique negative id for EVERY tile — including the
  // "real" first one — so the LookTile's trailId never collides with
  // a feed-level tile for the same look. Earlier the first tile kept
  // its positive id, which competed with the parent feed for the
  // same trailId slot in TrailVideoHost and lost the race, so the
  // top-left tile rendered as a black square while the duplicate
  // tiles below (already synthesized) loaded fine.
  const out: Look[] = [];
  const n = Math.max(arr.length, count);
  for (let i = 0; i < Math.min(count, n); i++) {
    const src = arr[i % arr.length];
    out.push({ ...src, id: -(1_000_000 + i) });
  }
  return out;
}

export default function ProductPage({
  product,
  onClose,
  onOpenLook,
  onOpenBrowser,
  onOpenProduct,
  onOpenCreator,
  onOpenCreative,
  onOpenBrand,
  onCreateCatalog,
  onOpenComments,
  creative,
  similarCreatives,
  brandCreatives,
  popularFallback,
  lookCreatives,
  graphPairs,
  allLooks,
  fromLook,
  bookmarks,
  navKey = 0,
  onHome,
  onSearch,
}: ProductPageProps) {
  const navigate = useNavigate();
  const [mounted, setMounted] = useState(false);
  const [isAnimatingOut, setIsAnimatingOut] = useState(false);
  const [productCatalogs, setProductCatalogs] = useState<ProductCatalog[]>([]);
  // "View more info" dropdown — collapses the size & fit, "Best for", and
  // "Popular in" detail blocks behind a single toggle so the info column
  // leads with the essentials (brand, name, price, actions). Collapsed by
  // default; resets on every product navigation.

  // Director scope key for this overlay — shared by the suspend effect below
  // and handleClose (which flags it exiting so the feed re-warms during the
  // close slide). Matches the nested "You might also like" feed's slotPrefix.
  const directorScope = `product:${product.brand}:${product.name}`;

  // Suspend the home feed's director-driven playback while this page is open.
  // The feed stays mounted+blurred behind us; left running it decodes dozens
  // of clips under the blur layer and tanks the FPS. Scope matches the
  // slotPrefix on our nested "You might also like" feed so that feed keeps
  // playing while the background is paused.
  useEffect(() => {
    director.pushScope(directorScope);
    return () => director.popScope(directorScope);
  }, [directorScope]);

  // Also pause every TrailVideoHost element except this product's hero.
  // director.pushScope handles director-managed cards, but LookCard-style
  // tiles attach video elements directly through the trail host — without
  // an explicit suspend, their <video> elements keep decoding under the
  // overlay (CPU + battery cost for invisible frames).
  const trailMgr = useTrailVideoManager();
  useEffect(() => {
    // Exempt the hero by its creative.id when present, otherwise pass a
    // sentinel so suspendFeed pauses everything.
    const heroId = creative?.id ?? '';
    trailMgr?.suspendFeed(heroId);
    // The feed behind us is fully covered — reclaim the decoders its
    // parked clips are still holding instead of waiting out each one's
    // idle timer. Re-entering the feed re-attaches the visible cards.
    trailMgr?.pruneIdle();
    return () => { trailMgr?.resumeFeed(heroId); };
  }, [trailMgr, creative?.id]);

  // "Popular in" — curated catalogs this product auto-matched (by name+brand).
  // Resets + refetches on every product change; cancel-guarded so a fast trail
  // of products can't land a stale list. Only fetched when we can navigate
  // (onCreateCatalog present), since the pills are otherwise inert.
  useEffect(() => {
    let cancelled = false;
    setProductCatalogs([]);
    if (!onCreateCatalog) return;
    getProductCatalogs(product.name, product.brand).then(rows => {
      if (!cancelled) setProductCatalogs(rows);
    });
    return () => { cancelled = true; };
  }, [product.name, product.brand, onCreateCatalog]);

  const { user } = useAuth();
  const shopperBody = useShopperBody(user?.id);

  // Comments — gated by the platform dial. The button deep-links to the
  // comment thread page keyed by this product's shareable slug.
  const commentsEnabled = useCommentsEnabled();
  const commentSlug = useMemo(
    () => productSlug({
      id: (product as Product & { id?: string | null }).id ?? null,
      brand: product.brand ?? null,
      name: product.name ?? null,
    }),
    [product],
  );
  const [commentCount, setCommentCount] = useState<number | null>(null);
  useEffect(() => {
    if (!commentsEnabled || !commentSlug) { setCommentCount(null); return; }
    let cancelled = false;
    getCommentCount('product', commentSlug).then(n => { if (!cancelled) setCommentCount(n); });
    return () => { cancelled = true; };
  }, [commentsEnabled, commentSlug]);

  // Admin-editable section config from /admin/pages. Each section's
  // enabled flag gates whether that block renders below.
  const productSections = usePageSections('product');
  const heroEnabled     = isSectionEnabled(productSections, 'hero');
  const similarEnabled  = isSectionEnabled(productSections, 'similar');
  const ymalEnabled     = isSectionEnabled(productSections, 'you-might-also-like');
  // Per-section caps. Default keeps the historic bounded-grid feel
  // until an admin tunes them in /admin/pages.
  const ymalLimit     = getSectionLimit(productSections, 'you-might-also-like', 16);
  // YMAL defaults to infinite (seeded in the migration); the toggle
  // lets an admin flip it back to a bounded grid using popularFallback.
  const ymalInfinite  = isSectionInfinite(productSections, 'you-might-also-like');

  // Dynamic, joke-y heading for the personalized "you might also like" feed.
  // Re-rolls per product open (regenKey) and leans on the shopper's category
  // affinity; falls back to "You might also like" when there's no signal yet.
  const affinity = useUserAffinity();
  const { recentProducts } = useRecentProducts();
  const ymalTitle = useDynamicSectionTitle(affinity, `${product.brand}|${product.name}`);

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
    // Cross-brand matches lead — the "Similar" rail is for cross-brand
    // discovery; same-brand mates have their own "More from <brand>" rail.
    // But same-brand items are STASHED as backfill rather than discarded:
    // in a category one brand dominates (e.g. candles are nearly all
    // WoodWick), the only genuinely-similar items ARE same-brand, and
    // dropping them outright collapsed the rail to the unrelated "Popular"
    // fallback. Backfilling keeps the rail on-topic (other candles) and only
    // ever kicks in when cross-brand results don't fill the limit, so
    // brand-rich categories (footwear, etc.) are unaffected.
    const cross: ProductAd[] = [];
    const sameBrand: ProductAd[] = [];
    for (const c of rows) {
      if (ownProductId && c.product_id === ownProductId) continue;
      if (seenProductIds.has(c.product_id)) continue;
      if (!genderMatches(c.product?.gender)) continue;
      // Hard "primary video only" rule: a product tile must have a playable
      // primary video. No video → not shown (no image-only fallbacks). This
      // matches the consumer feed contract; image-only stragglers from any
      // upstream source are dropped here as a final guard.
      const hasVideo = !!c.product?.primary_video_url || !!c.video_url;
      if (!hasVideo) continue;
      seenProductIds.add(c.product_id);
      const otherBrand = (c.product?.brand || '').trim().toLowerCase();
      if (ownBrand && otherBrand === ownBrand) sameBrand.push(c);
      else cross.push(c);
    }
    const out = cross.slice(0, limit);
    for (const c of sameBrand) {
      if (out.length >= limit) break;
      out.push(c);
    }
    return out;
  }, [ownBrand, ownProductId, genderMatches]);

  // "More like this" — only from the type-scoped similarity RPC.
  // Empty when the RPC returns nothing; Popular section fills the gap instead.
  const moreLikeThis = useMemo(
    () => pickFrom(similarCreatives),
    [similarCreatives, pickFrom],
  );

  // Similar must read as a full, intentional grid — exactly 8 when we have that
  // many unique matches, otherwise 6 (both land cleanly on the 2-col mobile grid;
  // never a dangling 5th/7th tile). A sparse similarity RPC is topped up with
  // DISTINCT popular items (pickFrom de-dupes and drops the current product) so
  // the grid still reaches 6/8 instead of collapsing to a sparse rail. An empty
  // RPC yields nothing — we don't fabricate "Similar" out of pure popular.
  const similarShown = useMemo(() => {
    if (moreLikeThis.length === 0) return [] as ProductAd[];
    const target = moreLikeThis.length >= 8 ? 8 : 6;
    if (moreLikeThis.length >= target) return moreLikeThis.slice(0, target);
    const seen = new Set(moreLikeThis.map(c => c.product_id));
    const fillers = pickFrom(popularFallback, target).filter(c => !seen.has(c.product_id));
    return [...moreLikeThis, ...fillers].slice(0, target);
  }, [moreLikeThis, popularFallback, pickFrom]);

  // Warm the rails' posters the moment their data resolves — the Similar
  // grid and look tiles otherwise start downloading at mount and read as
  // black boxes while the bytes arrive. Same rendition math as the cards,
  // so the warmed URL IS the cache entry the tile requests.
  useEffect(() => {
    // popularFallback is the WHOLE home roster; only the first ymalLimit
    // ever render here, so warming past that just queued hundreds of
    // fetches on every open.
    warmPosters([
      ...moreLikeThis.map(c => posterRendition(pickPosterUrl(c))),
      ...(lookCreatives ?? []).map(l => posterRendition(lookPoster(l))),
      ...(popularFallback ?? []).slice(0, ymalLimit).map(c => posterRendition(pickPosterUrl(c))),
    ]);
  }, [moreLikeThis, lookCreatives, popularFallback, ymalLimit]);

  // Super-admin "why this rail?" debug. Lazily computes the full diagnostics
  // (gender gate, relative band, sparse widen, per-candidate distances) only
  // when a super admin opens it — the live rail never pays for it.
  const isSuperAdmin = user?.role === 'super_admin';

  // Secret super-admin gesture: press-and-hold the SAVE button to delete the
  // product (soft-hide it from the feed + every look). A 650ms hold, cancelled
  // by any real drag/scroll; longPressFired suppresses the save-toggle that
  // would otherwise fire on release. Invisible to everyone else.
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Super-admin context panel (metadata + Kaizen chat), opened by the invisible
  // middle-LEFT tap zone (mirrors the middle-right delete zone).
  const [contextOpen, setContextOpen] = useState(false);
  // Full-screen loader shown until the hero media paints — replaces the flat
  // black the (mobile) product overlay showed on a cold open. Cleared on the
  // first hero image/video load, with a safety timeout so it never sticks.
  const [heroLoaded, setHeroLoaded] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setHeroLoaded(true), 1600);
    return () => window.clearTimeout(t);
  }, []);
  const pressTimer = useRef<number | null>(null);
  const pressStart = useRef<{ x: number; y: number } | null>(null);
  const longPressFired = useRef(false);
  const clearPress = useCallback(() => {
    if (pressTimer.current) { window.clearTimeout(pressTimer.current); pressTimer.current = null; }
    pressStart.current = null;
  }, []);
  const onSavePressStart = useCallback((e: React.PointerEvent) => {
    if (!isSuperAdmin) return;
    longPressFired.current = false;
    pressStart.current = { x: e.clientX, y: e.clientY };
    pressTimer.current = window.setTimeout(() => {
      clearPress();
      longPressFired.current = true;
      try { navigator.vibrate?.(30); } catch { /* no haptics */ }
      setDeleteOpen(true);
    }, 650);
  }, [isSuperAdmin, clearPress]);
  const onSavePressMove = useCallback((e: React.PointerEvent) => {
    if (!pressStart.current) return;
    const dx = e.clientX - pressStart.current.x;
    const dy = e.clientY - pressStart.current.y;
    if (dx * dx + dy * dy > 100) clearPress(); // moved >10px → it's a drag, not a hold
  }, [clearPress]);
  const confirmDeleteProduct = useCallback(async () => {
    setDeleting(true);
    try { await hideProductKey(product.brand, product.name); } catch { /* localStorage hide applied */ }
    setDeleting(false);
    setDeleteOpen(false);
    onClose();
  }, [product.brand, product.name, onClose]);

  const [simDebug, setSimDebug] = useState<{ open: boolean; loading: boolean; report: SimilarDebugReport | null }>(
    { open: false, loading: false, report: null },
  );
  const openSimilarDebug = useCallback(async () => {
    setSimDebug({ open: true, loading: true, report: null });
    try {
      const diag = await getSimilarProductsDiagnostics(ownProductId, 18);
      const report = buildProductSimilarReport(diag, {
        seedName: product.name,
        seedBrand: product.brand,
        ownBrand,
      });
      setSimDebug({ open: true, loading: false, report });
    } catch {
      setSimDebug({ open: true, loading: false, report: null });
    }
  }, [ownProductId, ownBrand, product.name, product.brand]);

  // "Why these?" for the "Pairs well with" rail. No fetch needed — the rail
  // already carries the edge metadata (edge_type / edge_weight) that explains
  // each tile, so the report is built synchronously from the rendered rows.
  const openGraphPairsDebug = useCallback(() => {
    const report = buildGraphPairsReport(graphPairs || [], {
      seedName: product.name,
      seedBrand: product.brand,
      shownCount: 6,
    });
    setSimDebug({ open: true, loading: false, report });
  }, [graphPairs, product.name, product.brand]);

  // "Why this?" for the personalized "You might also like" feed. Built
  // synchronously from the live on-device affinity signal (no fetch).
  const openAffinityDebug = useCallback(() => {
    const report = buildAffinityReport(affinity, {
      heading: ymalTitle,
      recentProductCount: recentProducts.length,
      recentSearchCount: getRecentSearches().length,
    });
    setSimDebug({ open: true, loading: false, report });
  }, [affinity, ymalTitle, recentProducts.length]);

  // Active gender filter mirrors the global shopper-gender singleton so
  // the nested ContinuousFeed's gender scoping matches the home feed.
  const activeFilter = useActiveGenderFilter();

  // Side-rail back button: hidden at the top (the corner .pd-back is the
  // expected affordance there), fades in once the user has scrolled past
  // the hero so the corner button has scrolled off the page. Desktop only.
  const [showSideBack, setShowSideBack] = useState(false);
  const scrollerRef = useRef<HTMLDivElement>(null);
  // Tracked separately so the nested ContinuousFeed re-binds its
  // IntersectionObserver root once the scroller mounts (refs alone
  // don't trigger re-renders).
  const [scrollerEl, setScrollerEl] = useState<HTMLDivElement | null>(null);
  const setScrollerRef = useCallback((el: HTMLDivElement | null) => {
    scrollerRef.current = el;
    setScrollerEl(el);
  }, []);

  // Show the side-rail back button once the user has scrolled past the
  // hero on desktop (the corner .pd-back has scrolled off, so we surface
  // a vertically-centered affordance on the left edge instead). 220px is
  // about one card-hero height — small enough to feel responsive, large
  // enough that opening the page doesn't instantly show both back buttons.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!window.matchMedia('(min-width: 769px)').matches) return;
    const scroller = scrollerRef.current;
    if (!scroller) return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        setShowSideBack(scroller.scrollTop > 220);
      });
    };
    onScroll();
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      scroller.removeEventListener('scroll', onScroll);
    };
  }, [scrollerEl]);

  // Feed the playback director this page's INNER-scroller position. The
  // director listens on `window`, which never sees this container's scroll, so
  // without this its rank/prearm only re-fire on sparse near-band crossings and
  // the Similar/Popular rail tiles hold on their poster until you stop scrolling
  // ("posters until pause"). Mirrors ContinuousFeed's window notifier. NOT
  // device-gated: mobile HLS is where the poster-hold is worst.
  useEffect(() => {
    const scroller = scrollerEl;
    if (!scroller) return;
    const onScroll = () => director.notifyScroll(scroller.scrollTop);
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => scroller.removeEventListener('scroll', onScroll);
  }, [scrollerEl]);

  // Lazy-fetch the spec-sheet copy (size_fit, materials_care) once per
  // product open. The main feed/look loaders don't carry these fields
  // — keeps their payloads tight — and only ~1% of rows have them
  // populated today anyway, so we fall back to "Not available" for the
  // rest. `null` = not loaded yet; the rendered section waits to paint
  // until we have a definitive answer so it doesn't flash empty.
  const productId  = (product as Product & { id?: string }).id;
  const productUrl = product.url;
  const seededFit  = product.size_fit;
  const seededCare = product.materials_care;
  const seededMeas = product.measurements;
  const [details, setDetails] = useState<ProductDetails | null>(
    seededFit !== undefined || seededCare !== undefined || seededMeas !== undefined
      ? {
          size_fit: seededFit ?? null,
          materials_care: seededCare ?? null,
          measurements: seededMeas ?? null,
        }
      : null,
  );
  useEffect(() => {
    if (seededFit !== undefined || seededCare !== undefined || seededMeas !== undefined) {
      setDetails({
        size_fit: seededFit ?? null,
        materials_care: seededCare ?? null,
        measurements: seededMeas ?? null,
      });
      return;
    }
    let cancelled = false;
    setDetails(null);
    getProductDetails({
      id: productId,
      url: productUrl,
      brand: product.brand,
      name: product.name,
    }).then(d => {
      if (cancelled) return;
      // Even if no row matched, render the section with nulls so the
      // shopper sees "Not available" instead of an indefinite skeleton.
      setDetails(d ?? { size_fit: null, materials_care: null, measurements: null });
    });
    return () => { cancelled = true; };
  }, [productId, productUrl, product.brand, product.name, seededFit, seededCare, seededMeas]);

  // Fit gating + suggestion chips. Pull the enrichment metadata from the
  // lazily-fetched spec sheet, falling back to anything already carried on
  // the product row. Fit only renders for items where garment fit means
  // something (apparel/footwear) — a book or a candle never shows a Fit row
  // or body-type chips. Occasion / season / "style it with" chips are
  // universal, so non-fashion still gets useful "Great for …" suggestions.
  const fitIntel = details?.fit_intelligence ?? product.fit_intelligence ?? null;
  const taxonomyCategory =
    (details?.product_taxonomy ?? product.product_taxonomy)?.category ?? null;
  const fitRelevant = isFitRelevant(taxonomyCategory, fitIntel);

  useEffect(() => {
    // Mark mounted on first paint so --in-keyed rules apply. The page opens
    // instantly (no slide-up); only the swipe-down dismiss animates.
    const raf = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  // Reset scroll to top on every product navigation. useLayoutEffect runs
  // synchronously after DOM updates but BEFORE paint - combined with
  // `behavior: 'instant'`, the snap-to-top happens between renders so
  // the user never sees the new content briefly scrolled to the old
  // tap position. The dep is the parent's nav counter (not brand+name)
  // so the effect fires on every trail step regardless of whether the
  // products happen to share fields.
  // Back-restore key: the product's stable slug. Recorded continuously (the
  // listener effect below) and consumed on a RETURN so Back lands where the
  // shopper left off.
  const scrollStashKey = productSlug({
    id: (product as Product & { id?: string | null }).id ?? null,
    brand: product.brand ?? null,
    name: product.name ?? null,
  });

  // Initial scroll position for each nav step, set SYNCHRONOUSLY before paint:
  // a RETURN (browser Back onto /p/…) lands at the saved offset, a fresh open
  // snaps to the top. Combining the snap-to-top and the return-restore into
  // ONE layout effect means the page paints AT its destination — it kills the
  // "jolt" where Back used to paint the page at the top and then (an rAF
  // later) jump down to where the shopper had left it.
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const returnTop = scrollStashKey ? consumeReturnScroll(scrollStashKey) : null;
    scroller.scrollTo({ top: returnTop ?? 0, behavior: 'instant' as ScrollBehavior });
    // Keyed on navKey (changes on every trail step / fresh mount), NOT on
    // scrollStashKey, so we consume the saved offset exactly once per step.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navKey]);

  // Keep recording the live scroll offset so a future return knows where to
  // land.
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || !scrollStashKey) return;
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        recordOverlayScroll(scrollStashKey, scroller.scrollTop);
      });
    };
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      scroller.removeEventListener('scroll', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [scrollStashKey]);

  // On a cold / direct load (refresh, shared URL) there's no feed-card
  // handoff, so `creative` is undefined and the hero used to fall back to a
  // static image. When the product itself carries a primary video, synthesize
  // a hero creative from it so the hero plays the primary video instead.
  // The pipeline dial gates every hlsUrl read below: in 'mp4' mode the hero
  // plays the progressive videoUrl even when a caller passed an hlsUrl.
  // Declared above handleClose so it can be a real dependency (TDZ otherwise).
  const pipelineMode = useVideoPipelineMode();
  const effectiveCreative: ProductPageCreative | undefined = creative
    ?? (product.video_url
      ? { id: `product:${product.brand}-${product.name}`, videoUrl: product.video_url, hlsUrl: pipelineMode === 'hls' ? (product.primary_hls_url ?? null) : null, thumbnailUrl: product.image ?? product.thumbnail_url ?? null }
      : undefined);
  const heroHlsUrl = pipelineMode === 'hls' ? effectiveCreative?.hlsUrl : null;

  // Cleared on unmount — see LookOverlay: a deferred onClose() after the
  // layer is already gone could pop the nav stack twice.
  const closeTimerRef = useRef<number>(0);
  useEffect(() => () => { window.clearTimeout(closeTimerRef.current); }, []);

  const handleClose = useCallback(() => {
    // Reverse handoff — see LookOverlay.handleClose: the source card resumes
    // at the hero's exact frame instead of restarting.
    if (effectiveCreative?.id) {
      director.syncFromTrailReturn(effectiveCreative.id, heroHostRef.current?.querySelector('video') ?? null);
    }
    // Flag the scope exiting at gesture start (not on unmount 360 ms later) so
    // the background feed re-warms under cover of the slide-out and is already
    // playing when this page clears. The suspend effect still pops on unmount.
    director.beginScopeExit(directorScope);
    setIsAnimatingOut(true);
    window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = window.setTimeout(() => {
      // Hand the WARM hero element back to the director (see LookOverlay) so the
      // source grid card resumes that exact element instantly — no cold
      // re-buffer / brief stop. release() makes TrailVideoHost forget it.
      const heroEl = heroHostRef.current?.querySelector('video') ?? null;
      if (effectiveCreative?.id && director.adoptReturnedElement(effectiveCreative.id, heroEl)) {
        trailMgr?.release(effectiveCreative.id);
      }
      onClose();
    }, 360);
  }, [onClose, directorScope, trailMgr, effectiveCreative?.id]);

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
    // Doc-scroll mode: the overlay scrolls the DOCUMENT, so the inner scroller's
    // scrollTop is always 0 and the "engage only at top" guard can't tell top
    // from mid-scroll — every downward drag would dismiss. The back button +
    // document scroll cover navigation, so disable whole-overlay drag here.
    if (overlay.closest('.app-root')?.classList.contains('product-doc-scroll')) return;

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
      dragRef.current.active = false;
      if (dy > 96 || velocity > 0.6) {
        // Continue smoothly off-screen from the current drag position (the
        // .product-page-overlay transition eases it the rest of the way) —
        // no snap-back-then-down. Matches how the comments sheet leaves.
        overlay.style.transform = 'translateY(100%)';
        handleClose();
      } else {
        overlay.style.transform = ''; // didn't pass threshold → settle back
      }
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
    // A super-admin long-press on this button just opened the delete confirm —
    // swallow the click so it doesn't also toggle a save on release.
    if (longPressFired.current) { longPressFired.current = false; return; }
    const wasSaved = bookmarks.isProductBookmarked(product);
    const productToSave = creative
      ? { ...product, video_url: creative.videoUrl, thumbnail_url: creative.thumbnailUrl ?? undefined, creative_id: creative.id }
      : product;
    bookmarks.toggleProductBookmark(productToSave);
    emitSavedToast({
      name: product.name || 'this product',
      imageUrl: productPoster(product),
      saved: !wasSaved,
    });
  }, [bookmarks, product, creative]);

  // Share the deep-link to this product. Uses navigator.share where it's
  // available (mobile + Safari desktop), otherwise copies the URL to the
  // clipboard with a fallback toast. Matches the MyLooks share pattern.
  const [shareToast, setShareToast] = useState<string | null>(null);
  const handleShare = useCallback(async () => {
    if (typeof window === 'undefined') return;
    const slug = productSlug({
      id: (product as { id?: string }).id ?? null,
      brand: product.brand ?? null,
      name: product.name ?? null,
    });
    const url = `${window.location.origin}/p/${slug}`;
    const title = product.brand && product.name ? `${product.brand} — ${product.name}` : product.name || 'Check this out';
    const nav = navigator as Navigator & { share?: (d: { title?: string; url?: string }) => Promise<void> };
    try {
      if (nav.share) {
        await nav.share({ title, url });
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(url);
        setShareToast('Link copied');
        window.setTimeout(() => setShareToast(null), 1800);
      }
    } catch {
      /* user dismissed the share sheet, or clipboard denied — no-op */
    }
  }, [product]);

  // Retailer chips - brand site + 3 synthetic alts (same pool every time so
  // prices are consistent across re-renders). Cheapest gets a lowest /
  // discount badge.

  // Poster source of last resort (canonical productPoster chain). Products
  // opened from a look can carry a primary-video poster in thumbnail_url while
  // `image` is empty — without this the hero painted as a black void.
  const heroStill = productPoster(product);

  const heroClassName = `pd-hero${effectiveCreative ? ' pd-hero--video' : heroStill ? ' pd-hero--image' : ' pd-hero--empty'}`;
  // Hi-res hero upgrade for image-only products. The page remounts per
  // navigation (parent keys it), so this never carries stale state.
  const heroHiResSrc = heroStill ? heroStill.replace('w=200&h=200', 'w=1200&h=1600') : '';
  const [heroHiResLoaded, setHeroHiResLoaded] = useState(false);

  // Tap-handoff poster: when a CreativeCardV2 tile navigates here, it stashes
  // a canvas snapshot of the playing card frame via stashTapPoster.
  // We pick it up synchronously so the hero can paint that exact frame
  // BEFORE the trail-host has had a chance to swap in the live element.
  // Cleared after read so the next tap doesn't reuse a stale snapshot.
  // Taken ONCE (lazy initializer) so the value is stable for the page's
  // life — see LookOverlay for why a per-render read re-attached the hero.
  const [tapHandoffPoster] = useState(() => takeTapPoster(effectiveCreative?.id));
  // Poster fallback chain — the primary image (creative.thumbnailUrl is
  // sourced from products.primary_image_url for product-feed tiles) is
  // the canonical first frame. When that's missing (or the trail-tap
  // poster from the feed card hasn't been stashed), fall back to the
  // product.image (which itself is primary_image_url → image_url →
  // first photo) so the hero never paints as a black void while waiting
  // for the trail-video host to attach. The thumbnail goes through the
  // CARD rendition (same width/quality/resize → same cache entry the feed
  // already fetched) so the underlay paints from memory instead of
  // re-downloading the full-res original — the residual 'black spot'.
  const heroPoster = tapHandoffPoster
    || posterRendition(effectiveCreative?.thumbnailUrl)
    || heroStill;

  // Take ownership of the shared <video> element keyed by creative.id. The
  // TrailVideoHost moves the running DOM node from the card slot into this
  // hero slot - appendChild preserves currentTime + decoded frames, so there
  // is no reload, no black flash, no audio gap. The poster argument keeps
  // the <video> element painting a real image even on the (rare) cold
  // path where the pool element was evicted between card unmount and
  // hero attach.
  // Prefer the HLS manifest (when the pipeline dial allows it) so the
  // full-screen hero ramps to a crisp rung; fall back to the progressive MP4
  // when no ladder exists for this clip or the pipeline is in 'mp4' mode.
  const heroHostRef = useRef<HTMLElement | null>(null);
  const setHeroSlotBase = useTrailVideo(
    effectiveCreative?.id,
    heroHlsUrl || effectiveCreative?.videoUrl,
    heroPoster || undefined,
  );
  const setHeroSlot = useCallback((node: HTMLElement | null) => {
    heroHostRef.current = node;
    setHeroSlotBase(node);
  }, [setHeroSlotBase]);

  // Size & fit spec sheet — computed up here (was an inline IIFE in the
  // JSX) so the "View more info" dropdown can both test it for emptiness
  // and render it. Null when the scraper captured none of the three
  // signals (size_fit, materials_care, measurements).
  const specsNode = (() => {
    if (!details) return null;
    const hasMeasurements = !!details.measurements
      && Object.values(details.measurements).some(
        (v): v is number => typeof v === 'number' && Number.isFinite(v)
      );
    const fitText = (details.size_fit && details.size_fit.trim())
      || deriveFitLabel(fitIntel)
      || '';
    const hasFit = fitRelevant && !!fitText;
    const hasMaterials = !!(details.materials_care && details.materials_care.trim());
    if (!hasMeasurements && !hasFit && !hasMaterials) return null;
    return (
      <section className="pd-specs" aria-label="Size and fit details">
        <h2 className="pd-specs-title">Size &amp; fit</h2>
        <ProductMeasurementsDiagram measurements={details.measurements} />
        {(hasFit || hasMaterials) && (
          <dl className="pd-specs-list">
            {hasFit && (
              <div className="pd-specs-row">
                <dt className="pd-specs-label">Fit</dt>
                <dd className="pd-specs-value">{fitText}</dd>
              </div>
            )}
            {hasMaterials && (
              <div className="pd-specs-row">
                <dt className="pd-specs-label">Materials</dt>
                <dd className="pd-specs-value">{details.materials_care}</dd>
              </div>
            )}
          </dl>
        )}
      </section>
    );
  })();
  const hasCatalogPills = !!onCreateCatalog && productCatalogs.length > 0;

  return (
    <div
      ref={overlayRef}
      className={`product-page-overlay${mounted && !isAnimatingOut ? ' product-page-overlay--in' : ''}${isAnimatingOut ? ' product-page-overlay--out' : ''}`}
      role="dialog"
      aria-modal="true"
    >
      {/* Loading state shaped like the page itself — a hero skeleton beside
          the info skeleton (product card, copy lines, action buttons), mirroring
          .pd-split (stacked on mobile, hero-left/info-right on desktop). Reads as
          the page assembling in place rather than a generic full-screen spark.
          Fades out (CSS) once heroLoaded flips; below the chrome so Back works. */}
      <div className={`pd-loading${heroLoaded ? ' is-done' : ''}`} aria-hidden="true">
        <div className="pd-skel-hero" />
        <div className="pd-skel-info">
          <div className="pd-skel-card" />
          <div className="pd-skel-lines">
            <span /><span /><span /><span />
          </div>
          <div className="pd-skel-actions">
            <span /><span />
          </div>
        </div>
      </div>
      {/* Scroll-reactive top chrome (mobile): back → previous page, logo
          → home, search → run on the feed. */}
      <OverlayChrome
        scrollEl={scrollerEl}
        onBack={handleClose}
        onHome={onHome ?? handleClose}
        onSearch={onSearch ?? (() => {})}
        showSearch={false}
      />
      {contextOpen && ownProductId && (
        <AdminContextPanel
          kind="product"
          id={ownProductId}
          title={product.name}
          subtitle={product.brand}
          onClose={() => setContextOpen(false)}
        />
      )}
      <div className="product-page" ref={setScrollerRef}>
        <button
          className="pd-back"
          onClick={handleClose}
          aria-label="Back"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        {/* Desktop-only Catalog → home button, sitting beside the back button
            in the upper-left (mirrors the mobile OverlayChrome's back + logo).
            Mobile hides this — the OverlayChrome top bar carries it there. */}
        <button
          className="pd-home"
          onClick={onHome ?? handleClose}
          aria-label="Home"
        >
          <CatalogLogo className="pd-home-mark" />
        </button>
        {/* Side-rail back button — vertically centered on the left edge of
            the browser, desktop only. Fades + slides in once the user has
            scrolled past the hero (corner button is off-screen by then). */}
        <button
          className={`pd-back-rail${showSideBack ? ' is-visible' : ''}`}
          onClick={handleClose}
          aria-label="Back"
          tabIndex={showSideBack ? 0 : -1}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>

        {heroEnabled && (
        <div className="pd-split">
          <section className={heroClassName}>
            {/* Animated loading backdrop — sits at the very bottom of the hero
                so while the poster/video/image is still loading the shopper
                sees a moving shimmer instead of a flat black box. The media
                layers paint on top (higher z-index / later in DOM) and cover
                it the instant they're ready. */}
            <div className="card-shimmer pd-hero-shimmer" aria-hidden="true" />
            {effectiveCreative ? (
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
                    onLoad={() => setHeroLoaded(true)}
                  />
                )}
                <div
                  ref={setHeroSlot}
                  className="pd-hero-media pd-hero-video-slot"
                  data-trail-id={effectiveCreative.id}
                  style={{ position: 'relative', zIndex: 1 }}
                />
              </>
            ) : heroStill ? (
              <>
                {/* Two-layer still: the bottom <img> is the EXACT URL the
                    tapped tile already painted (browser-cached → first
                    frame), the top one is the hi-res rendition fading in
                    when it lands. Previously only the hi-res rendered, so
                    image-only products opened to the hero's black backdrop
                    while a brand-new URL loaded. */}
                <img
                  src={heroStill}
                  alt=""
                  aria-hidden="true"
                  className="pd-hero-media"
                  style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
                  onLoad={() => setHeroLoaded(true)}
                />
                {heroHiResSrc !== heroStill && (
                  <img
                    src={heroHiResSrc}
                    alt={product.name}
                    className="pd-hero-media"
                    style={{ position: 'relative', opacity: heroHiResLoaded ? 1 : 0, transition: 'opacity 160ms ease' }}
                    onLoad={() => setHeroHiResLoaded(true)}
                  />
                )}
              </>
            ) : (
              <div className="pd-hero-placeholder" />
            )}
            <div className="pd-hero-scrim" />
            {/* Super-admin only: an INVISIBLE tap target on the middle-right
                of the hero that deletes this product everywhere (confirm
                first). Deliberately unstyled/invisible — a stealth admin
                affordance on the public surface. */}
            {isSuperAdmin && (
              <button
                type="button"
                className="pd-admin-delete"
                aria-label="Delete this product (super admin)"
                onClick={async () => {
                  if (!ownProductId) {
                    void catalogAlert({ title: 'No product id', message: 'This product has no database id to delete.' });
                    return;
                  }
                  const ok = await catalogConfirm({
                    title: `Delete "${product.name}"?`,
                    message: 'Removes the product and its creatives everywhere. This cannot be undone.',
                    danger: true,
                  });
                  if (!ok) return;
                  const { error } = await deleteProduct(ownProductId);
                  if (error) {
                    void catalogAlert({ title: 'Delete failed', message: String(error) });
                    return;
                  }
                  handleClose();
                }}
              />
            )}
            {/* Super-admin only: an INVISIBLE tap target on the middle-LEFT of
                the hero that opens the context panel (editable gender/type +
                Kaizen chat). Mirror of the middle-right delete zone. */}
            {isSuperAdmin && ownProductId && (
              <button
                type="button"
                className="pd-admin-context"
                aria-label="Product context (super admin)"
                onClick={() => setContextOpen(true)}
              />
            )}
            {/* Top-right share + bottom-right save, both overlaying the
                hero media. Mirror the .pd-back glass treatment so the
                three controls (back / share / save) read as a set. */}
            <button
              type="button"
              className="pd-share-floating"
              onClick={handleShare}
              aria-label="Share product"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="18" cy="5" r="3" />
                <circle cx="6" cy="12" r="3" />
                <circle cx="18" cy="19" r="3" />
                <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
              </svg>
            </button>
            <button
              type="button"
              className={`pd-save-floating ${isSaved ? 'is-saved' : ''}`}
              onClick={handleToggleSave}
              onPointerDown={onSavePressStart}
              onPointerUp={clearPress}
              onPointerLeave={clearPress}
              onPointerCancel={clearPress}
              onPointerMove={onSavePressMove}
              aria-label={isSaved ? 'Remove from bookmarks' : 'Save product'}
              aria-pressed={isSaved}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill={isSaved ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
              </svg>
            </button>
            {shareToast && (
              <div className="pd-share-toast" role="status">{shareToast}</div>
            )}
          </section>

          {/* Paper-catalog info column: brand, name, price, one real order
              line ("Shop at <brand>" → the product's own URL), two text
              links, then the spec sheet and the rails — all hairlines and
              type, nothing that isn't backed by data. The former retailer
              comparison was synthetic (a rotating list of stores with
              jittered prices) and is gone. */}
          <section className="pd-info pd-info--catalog">
          <div className="pd-info-inner">
            {product.brand && (
              onOpenBrand
                ? (
                  <button
                    type="button"
                    className="pd-brand pd-catalog-brand"
                    onClick={() => onOpenBrand(product.brand!)}
                  >
                    {product.brand}
                  </button>
                )
                : <div className="pd-brand pd-catalog-brand">{product.brand}</div>
            )}
            <h1 className="pd-name">{product.name}</h1>
            {product.price && <div className="pd-price">{product.price}</div>}
            {shopperBody.heightCm && <SizeMatchBadge product={product} body={shopperBody} />}

            <div className="pd-catalog-actions">
              {product.url && (
                <button
                  type="button"
                  className="pd-catalog-shop"
                  onClick={() => onOpenBrowser(product.url, product.name, product)}
                >
                  <span className="pd-catalog-shop-label">Shop at {product.brand || 'the retailer'}</span>
                  <svg className="pd-catalog-shop-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <line x1="7" y1="17" x2="17" y2="7" />
                    <polyline points="7 7 17 7 17 17" />
                  </svg>
                </button>
              )}
              <div className="pd-catalog-links">
                {/* "Add to a look" — kicks off the look-builder (/generate)
                    with this product pre-picked. Works for any product type. */}
                <button type="button" className="pd-catalog-link" onClick={handleTryOn}>
                  Add to a look
                </button>
                {commentsEnabled && commentSlug && onOpenComments && (
                  <button
                    type="button"
                    className="pd-catalog-link"
                    onClick={() => onOpenComments('product', commentSlug)}
                  >
                    {commentCount != null && commentCount > 0 ? `Comments (${commentCount > 99 ? '99+' : commentCount})` : 'Comments'}
                  </button>
                )}
              </div>
            </div>

            {/* Size & fit + Materials & care — inline, only when the scraper
                captured something (specsNode is null otherwise). */}
            {specsNode}

            {/* "Popular in" — curated catalogs this product belongs to. */}
            {hasCatalogPills && (
              <ProductCatalogPills catalogs={productCatalogs} onOpenCatalog={onCreateCatalog!} />
            )}

            {/* "More from <brand>" rail — same-brand creatives. */}
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
            {graphPairs && graphPairs.length > 0 && (
              <section className="pd-info-brand-rail" aria-label="Pairs well with">
                <h2 className="pd-info-brand-rail-title">
                  Pairs well with
                  {isSuperAdmin && (
                    <button
                      type="button"
                      className="sim-debug-btn"
                      onClick={openGraphPairsDebug}
                      aria-label="Why these? (super-admin debug)"
                      title="Why these? (super-admin debug)"
                    >
                      ⓘ why
                    </button>
                  )}
                </h2>
                <div className="pd-info-brand-rail-grid">
                  {graphPairs.slice(0, 6).map(pair => (
                    <button
                      key={pair.product_id}
                      type="button"
                      className="pd-info-brand-tile"
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
                          className="pd-info-brand-tile-img"
                          loading="lazy"
                        />
                      )}
                      <div className="pd-info-brand-tile-meta">
                        {pair.brand && <span className="pd-info-brand-tile-brand">{pair.brand}</span>}
                        {pair.name && <span className="pd-info-brand-tile-name">{pair.name}</span>}
                        {pair.price && <span className="pd-info-brand-tile-price">{pair.price}</span>}
                      </div>
                    </button>
                  ))}
                </div>
              </section>
            )}
          </div>
        </section>
        </div>
        )}

        {/* "Similar" — bounded rail of brand/tag-matched products
            (was "More like this"). Sits directly below the product
            card so the next-best matches always appear first. The
            infinite "You might also like" feed lives at the bottom
            for open-ended exploration. */}
        {similarEnabled && similarShown.length > 0 && (
          <section className="pd-similar-feed">
            <h2 className="pd-feed-title">
              Similar
              {isSuperAdmin && (
                <button
                  type="button"
                  className="sim-debug-btn"
                  onClick={openSimilarDebug}
                  aria-label="Why these? (super-admin debug)"
                  title="Why these? (super-admin debug)"
                >
                  ⓘ why
                </button>
              )}
            </h2>
            <div className="pd-similar-grid">
              {/* CreativeCardV2 plays via the shared director pool (same as the
                  feed) and donates its live <video> on tap, so the trail
                  continues with the same fluid handoff. slotId is scoped to this
                  overlay (`${directorScope}:…`) so the tiles actually play.
                  Render the unique matches only (capped at the limit) — never
                  pad with fillToExact, which cycles duplicates to reach the
                  count and put the same tile on screen twice. */}
              {similarShown.map((c, i) => (
                <CreativeCardV2
                  key={`mlt-${c.id}-${i}`}
                  slotId={`${directorScope}:mlt-${c.id}-${i}`}
                  creative={c}
                  className="look-card"
                  onOpenProduct={onOpenCreative}
                  priority={i < 2}
                />
              ))}
            </div>
          </section>
        )}

        {lookCreatives && lookCreatives.length > 0 && (
          <section className="pd-look-feed">
            <h2 className="pd-feed-title">Featured in Looks</h2>
            <div className="pd-look-grid">
              {/* padLooks gives duplicate slots a synthetic id so keys and
                  trail ids stay unique; the duplicates render poster-only
                  (no pooled <video>) so the grid never decodes the same
                  clip twice. */}
              {padLooks(lookCreatives, 8).map((l, i) => (
                <LookTile
                  key={`fl-${l.id}-${i}`}
                  look={l}
                  index={i}
                  onOpen={onOpenLook}
                  onOpenCreator={onOpenCreator}
                  posterOnly={i >= lookCreatives.length}
                />
              ))}
            </div>
          </section>
        )}

        {/* "You might also like" — defaults to an infinite
            ContinuousFeed (anchors the bottom so scrolling never
            dead-ends). The /admin/pages editor can flip it to a
            bounded grid via the Infinite checkbox, in which case
            we render popularFallback capped by item_limit. */}
        {ymalEnabled && (
          ymalInfinite ? (
            <section className="pd-similar-feed">
              <h2 className="pd-feed-title">
                Popular
                {isSuperAdmin && (
                  <button
                    type="button"
                    className="sim-debug-btn"
                    onClick={openAffinityDebug}
                    aria-label="Why this? (super-admin debug)"
                    title="Why this? (super-admin debug)"
                  >
                    ⓘ why
                  </button>
                )}
              </h2>
              <ContinuousFeed
                nested
                scrollRoot={scrollerEl}
                activeFilter={activeFilter}
                searchQuery=""
                shuffleKey={0}
                layoutMode={0}
                onOpenLook={onOpenLook}
                onOpenCreator={onOpenCreator || (() => {})}
                onOpenBrowser={onOpenBrowser}
                onOpenProduct={onOpenProduct}
                onOpenCreative={onOpenCreative}
                onOpenBrand={onOpenBrand}
                bookmarks={bookmarks}
                slotPrefix={`product:${product.brand}:${product.name}`}
              />
            </section>
          ) : (popularFallback && popularFallback.length > 0) ? (
            <section className="pd-similar-feed">
              <h2 className="pd-feed-title">
                Popular
                {isSuperAdmin && (
                  <button
                    type="button"
                    className="sim-debug-btn"
                    onClick={openAffinityDebug}
                    aria-label="Why this? (super-admin debug)"
                    title="Why this? (super-admin debug)"
                  >
                    ⓘ why
                  </button>
                )}
              </h2>
              <div className="pd-similar-grid">
                {fillToExact(popularFallback, ymalLimit).map((c, i) => (
                  <CreativeCardV2
                    key={`ymal-${c.id}-${i}`}
                    slotId={`${directorScope}:ymal-${c.id}-${i}`}
                    creative={c}
                    className="look-card"
                    onOpenProduct={onOpenCreative}
                  />
                ))}
              </div>
            </section>
          ) : null
        )}
      </div>
      {simDebug.open && (
        <SimilarDebugModal
          report={simDebug.report}
          loading={simDebug.loading}
          onClose={() => setSimDebug({ open: false, loading: false, report: null })}
        />
      )}
      {isSuperAdmin && (
        <ConfirmModal
          open={deleteOpen}
          title="Delete this product?"
          body={<>Removes <strong>{product.brand} — {product.name}</strong> from the feed and from every look. Super-admin only.</>}
          confirmLabel="Delete"
          destructive
          busy={deleting}
          onConfirm={confirmDeleteProduct}
          onCancel={() => setDeleteOpen(false)}
        />
      )}
    </div>
  );
}
