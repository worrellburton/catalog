// CreativeCardV2 — director-driven variant of CreativeCard.
//
// Key differences from CreativeCard:
//   - No <video> JSX / videoRef. The director appends a pooled <video>
//     element into the card div when this card is in the top-K nearest
//     to viewport center.
//   - No 1-second heartbeat useEffect (was lines ~93-110 in CreativeCard).
//   - No prefetchVideoBytes call on viewport dwell.
//   - No crossOrigin="anonymous" default.
//   - Uses useDirectorSlot for playback control.
//   - captureVideoFrame reads from director.getVideoElement() instead
//     of a component-owned ref.
//   - Small debug badge (status colour) in top-right corner.
//     Remove before promoting to production.
//
// Polymorphic input: pass either `creative` (a ProductAd — the original
// product-creative card) OR `look` (a Look — replaces the legacy LookCard
// in the continuous feed so both surfaces share the same director-driven
// playback pipeline, pool, preload, and visibility handling).

import { useRef, useEffect, useState, useCallback, memo } from 'react';
import { catalogConfirm } from '~/components/CatalogDialog';
import {
  trackAdImpression,
  trackAdClick,
  prefetchSimilarProducts,
  type ProductAd,
} from '~/services/product-creative';
import {
  pickVideoUrl,
  pickPlaybackSource,
  pickPosterUrl,
  pickStillImageUrl,
  captureVideoFrame,
  markFeedMilestone,
  prefetchVideoBytes,
  prefetchHlsHead,
} from '~/services/video-loading';
import FeedWhyButton from '~/components/feed/FeedWhyButton';
import FeedWhyShopperTag from '~/components/feed/FeedWhyShopperTag';
import { lookPoster } from '~/services/media-resolver';
import { posterRendition } from '~/utils/poster-prefetch';
import { isHlsUrl } from '~/utils/hlsAttach';
import { director } from '~/services/video-playback-director';
import { useAuth } from '~/hooks/useAuth';
import { useDirectorSlot } from '~/hooks/useDirectorSlot';
import { useTrailVideoManager } from '~/components/TrailVideoHost';
import { useInViewport } from '~/hooks/useInViewport';
import { useVideoStillRatio } from '~/hooks/useVideoStillRatio';
import { useVideoPipelineMode } from '~/hooks/useVideoPipeline';
import { useProductsImageOnly } from '~/hooks/useProductsImageOnly';
import CreatorAvatarFollow from './CreatorAvatarFollow';
import { useShowBrandLogos } from '~/hooks/useShowBrandLogos';
import { useBrandLogo } from '~/hooks/useBrandLogoLookup';
import { usePrefersReducedMotion } from '~/hooks/usePrefersReducedMotion';
import { shouldBeVideo } from '~/utils/videoStillSplit';
import { lookProductsSummary } from '~/utils/lookShopSummary';
import type { Look, Product } from '~/data/looks';
import { creators } from '~/data/looks';
import { hideLookId } from '~/hooks/useHiddenLooks';
import { lookTrailId, normalizeLookVideoUrl } from '~/utils/trailIds';
import { trackImpression } from '~/services/session-tracker';

/** The slice of useBookmarks a card needs for its save button. Threaded
 *  down from _index (the single source of bookmark state) so a toggle on
 *  any card updates the header count / saved screen live. */
export interface CardBookmarks {
  isLookBookmarked: (lookId: number) => boolean;
  toggleLookBookmark: (lookId: number) => void;
  isProductBookmarked: (p: Product) => boolean;
  toggleProductBookmark: (p: Product) => void;
}

interface CreativeCardV2Props {
  /** Provide either `creative` (product-creative card) or `look` (look card). */
  creative?: ProductAd;
  look?: Look;
  className?: string;
  /** Creative-mode click handler. */
  onOpenProduct?: (creative: ProductAd) => void;
  /** Look-mode click handler. */
  onOpenLook?: (look: Look) => void;
  /** Look-mode creator-row tap handler. */
  onOpenCreator?: (creatorName: string) => void;
  canDelete?: boolean;
  onDelete?: (id: string) => void;
  /** Look-mode delete handler. Fires when an admin in delete mode
   *  taps the trash icon on a look card. Parent decides hard vs soft
   *  delete (typically: hard via deleteLook(look.uuid) when the look
   *  is a real DB row, soft via hideLookId for legacy seed looks). */
  onDeleteLook?: (look: Look) => void;
  /** Above-the-fold cards get eager poster fetch. */
  priority?: boolean;
  /** Override the director slot ID (use when the same item appears multiple times). */
  slotId?: string;
  /** Look-mode: hide the creator avatar+name chip. Used by the Creator
   *  catalog page where the creator identity is already in the page header,
   *  so per-tile attribution is redundant noise (mirrors LookCard.hideCreator). */
  hideCreator?: boolean;
  /** Look-mode: use the look's OWN poster (its frame / video) and never fall
   *  back to a product packshot. The creator catalog sets this so a posterless
   *  generated look reveals its own video frame instead of a product image. */
  lookPosterOnly?: boolean;
  /** When provided, the card renders a save (bookmark) button so shoppers
   *  can save without opening the detail overlay. Omitted = no button. */
  bookmarks?: CardBookmarks;
}

/** Poster/still rendition width matches the VIDEO rendition the card
 *  will actually play (the mobile variant encodes at 480w, desktop/full
 *  at 720w), so the poster→first-frame swap is pixel-identical — no
 *  sharpness pop when the clip takes over from the still. */


const CreativeCardV2 = memo(function CreativeCardV2({
  creative,
  look,
  className = 'look-card',
  onOpenProduct,
  onOpenLook,
  onOpenCreator,
  canDelete,
  onDelete,
  onDeleteLook,
  priority = false,
  slotId,
  hideCreator = false,
  lookPosterOnly = false,
  bookmarks,
}: CreativeCardV2Props) {
  const isLook = !!look && !creative;
  // Subscribe to the global pipeline dial: a flip (hls ⇄ mp4) re-renders the
  // card so pickPlaybackSource below re-routes to the other delivery path.
  useVideoPipelineMode();

  // ── Normalize inputs into the shape the playback pipeline expects ─────
  // For look mode we derive video/poster/still URLs from the Look fields
  // and reuse the same pickVideoUrl/pickStillImageUrl helpers so the
  // mobile-variant + dial behaviour is identical to product creatives.
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
  const itemKey = isLook ? `look-${look!.id}` : creative!.id;
  // dial split is deterministic on the item key (string)
  const dialKey = itemKey;

  // Prefer the HLS manifest (adaptive ladder) when present so the feed tile
  // and the detail hero share ONE source — the director hands the live element
  // to TrailVideoHost on tap with no src swap. Falls back to the progressive
  // mobile/full MP4 split when there's no ladder yet.
  const playableUrl = isLook
    ? pickPlaybackSource({
        hls_url: look!.hls_url ?? null,
        hls_hevc_url: look!.hls_hevc_url ?? null,
        video_av1_url: look!.video_av1_url ?? null,
        video_url: normalizeLookVideoUrl(look!.video, basePath),
        mobile_video_url: look!.mobile_video_url ?? null,
      })
    : pickPlaybackSource(creative!);

  // Raw poster / still URLs from the data layer. These point at the
  // FULL-RES asset in storage (the polished primary image, the look
  // thumbnail, etc.) so server-side consumers — Seedance i2v, sharing,
  // export — get the highest fidelity available.
  // Canonical poster chains (services/media-resolver) — the look chain lives in
  // ONE place now, so the card, overlay hero, and inline detail can't drift
  // (that drift was the "looks go black, then the video appears" bug).
  const rawPosterUrl = isLook ? lookPoster(look!, lookPosterOnly) : pickPosterUrl(creative!);
  const rawStillImageUrl = isLook ? lookPoster(look!, lookPosterOnly) : pickStillImageUrl(creative!);

  // Compressed render variants for ON-SCREEN display. Routed through
  // Supabase's storage image-transform endpoint so the feed ships
  // ~20 KB WebPs instead of full-res 1-3 MB PNGs. No-op for non-
  // Supabase URLs (external CDNs, etc.) — safe to apply blindly.
  // Width 540px covers a 2-up mobile column at 2× DPR cleanly.
  //
  // resize:'contain' — DOWNSCALE only, preserve the source aspect; do NOT
  // crop server-side. The default 'cover' with a width-only request crops a
  // 3:4 poster to 9:16 (Supabase fills width × the source height), which then
  // got cropped AGAIN by the <img> object-fit:cover → a visibly zoomed poster
  // that no longer matched the natively-3:4 <video> (which fills the tile
  // un-cropped). With 'contain' the poster keeps the clip's exact aspect, so
  // the browser's object-fit:cover fits it to the 3:4 tile identically to the
  // video — poster and playback match.
  // quality 82 (was 72): 540px already matches the tile's device-pixel size, so
  // the poster wasn't under-resolved — it was under-COMPRESSED relative to the
  // video. Since the poster is the clip's frame 0, the leftover compression
  // delta is what you see "pop" the instant the <video> cuts in over it. q82
  // closes that gap (still a ~25 KB WebP) so poster→playback reads as one image.
  const posterUrl = posterRendition(rawPosterUrl) || rawPosterUrl;
  const stillImageUrl = posterRendition(rawStillImageUrl) || rawStillImageUrl;

  // Dial: /admin/dials → video_still_ratio controls whether this card
  // renders as a still image or plays video. When the dial pushes the
  // card into still mode we show the retail product photo (higher
  // merchandising quality than the auto-extracted thumbnail) and skip
  // the director entirely. On mouse-enter the card upgrades to video.
  const globalVideoRatio = useVideoStillRatio();
  const dialPrefersVideo = shouldBeVideo(dialKey, globalVideoRatio);
  // "Products image-only" dial (/admin/dials). When ON, every tile
  // that ISN'T backed by a look (creative.look_id is null/undefined)
  // renders as the still product image. Looks keep video playback.
  const productsImageOnly = useProductsImageOnly();
  // Product cards backed by a polished primary video AUTOPLAY — they
  // override the still-vs-video dials. The poster is the clip's FRAME 0, so
  // the autoplaying video starts from exactly the poster's framing — the
  // handoff is seamless, no zoom pop. Other product cards (looks with no
  // primary video, no playableUrl) still honour the dials.
  const hasPrimaryVideo = !isLook && !!creative?.product?.primary_video_url;
  const forceStillForProduct = !hasPrimaryVideo && !isLook && !!productsImageOnly && !!creative && !creative.look_id && !!stillImageUrl;
  // OS-level "reduce motion" wins over every dial (including autoplay
  // primary videos) whenever a still exists to show instead. Cards with
  // no still at all keep video — a blank tile helps no one.
  const prefersReducedMotion = usePrefersReducedMotion();
  const renderAsStill = (prefersReducedMotion && !!stillImageUrl)
    || (hasPrimaryVideo
      ? false
      : (forceStillForProduct || (!dialPrefersVideo && !!stillImageUrl)));

  // Hover-to-play: when in still mode, a mouseenter activates video for
  // this card. Stays active for the session — no revert on mouseleave.
  const [hoverPlaying, setHoverPlaying] = useState(false);

  // Director only receives the video URL when we want it to play.
  // Passing null keeps the card unregistered (still-only path).
  const activeVideoUrl = (!renderAsStill || hoverPlaying) ? playableUrl : null;

  // Shimmer until the poster actually PAINTS (img onLoad) or the director
  // assigns a video — not merely because a posterUrl string exists. The old
  // `!!posterUrl` start assumed the <img> was already on screen; but a poster
  // whose bytes haven't arrived paints nothing, so the tile sat BLACK (no
  // shimmer, no image) until the fetch landed — the "black grid while
  // scrolling" before the poster shows. Starting false shows the shimmer in
  // that gap instead of black; combined with eager posters (loaded into cache
  // ahead of the viewport) a scrolled-to tile has usually already fired onLoad,
  // so the shimmer doesn't visibly flash.
  const [loaded, setLoaded] = useState(false);
  const impressionTracked = useRef(false);
  const trailMgr = useTrailVideoManager();
  const { user } = useAuth();
  const isSuperAdmin = user?.role === 'super_admin';
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const longPressTimer = useRef<number | null>(null);
  const longPressFired = useRef(false);

  // Use slotId when provided (e.g. duplicate positions in infinite feed),
  // otherwise fall back to the item's own id.
  const directorId = slotId ?? itemKey;

  // Wire to the director. containerRef goes on the card div — the
  // director will appendChild a pooled <video> here when promoted to top-K.
  // activeVideoUrl is null in still mode, so the director skips this card.
  const { containerRef, status } = useDirectorSlot(
    directorId,
    activeVideoUrl,
    posterUrl,
  );

  // Pre-warm autoplay videos: start fetching the first 256 KB of the clip
  // when the card is within ~1 viewport. This covers BOTH looks and product
  // primary videos — any card that will actually autoplay (activeVideoUrl
  // set). Without this, a product clip hits a cold buffer the instant it
  // enters the play band, so play() pends on the network and the card holds
  // its poster for a beat; warming the moov atom + first GOP ahead of time
  // lets `playing` fire almost immediately (and stay cached on scroll-back).
  // We track the element in a separate ref because containerRef is a
  // callback ref (not an object ref) and useInViewport needs a RefObject.
  const prewarmNodeRef = useRef<HTMLDivElement | null>(null);
  const combinedRef = useCallback(
    (node: HTMLDivElement | null) => {
      prewarmNodeRef.current = node;
      containerRef(node);
    },
    [containerRef],
  );
  // 120% (was 200%) — warm roughly one screen ahead instead of two, so the
  // on-screen clip's bytes always win the bandwidth. prefetchVideoBytes
  // additionally caps concurrency and bails on fast scroll.
  const inPrewarmBand = useInViewport(prewarmNodeRef, '120% 0%');
  useEffect(() => {
    if (!inPrewarmBand || !activeVideoUrl) return;
    if (isHlsUrl(activeVideoUrl)) {
      // HLS streams its own segments via hls.js. Warm the manifest + the
      // lowest rung's init + first segments ahead of the play band so the
      // attach is a cache hit and the first frame paints without a load.
      prefetchHlsHead(activeVideoUrl);
    } else {
      prefetchVideoBytes(activeVideoUrl);
    }
  }, [inPrewarmBand, activeVideoUrl]);

  // Drop the shimmer only when a real frame is PAINTED ('playing'), not on
  // 'loading'. 'loading' means the director appended the <video> and called
  // play(), but the element's own poster attribute may not have decoded yet
  // and no frame exists — hiding the shimmer there left a BLACK tile until the
  // first frame arrived. The poster <img>'s onLoad (below) is the other, more
  // common exit: with eager posters it usually fires first, so the still poster
  // covers the tile well before playback. Net: shimmer → poster → video, never
  // shimmer → black → video.
  useEffect(() => {
    if (status === 'playing') {
      setLoaded(true);
      markFeedMilestone(`first-frame:${directorId}`);
    }
  }, [status, directorId]);

  // Impression tracking — fire once on first promotion (status moves off idle).
  // Creative mode hits the ad-impression endpoint; look mode emits a
  // generic look impression to match the legacy LookCard telemetry.
  useEffect(() => {
    if (status !== 'idle' && !impressionTracked.current) {
      impressionTracked.current = true;
      if (isLook && look) {
        trackImpression({
          type: 'look',
          id: String(look.id),
          uuid: look.uuid,
          context: look.title?.slice(0, 200),
        });
        // Real-time unseen-badge clearing: tell the Following stories rail
        // this look is now seen so its creator's "new looks" count drops
        // live (no refresh). Mirrors the impression we just logged, which
        // is the same signal the badge is derived from.
        if (look.uuid && look.creator && typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('catalog:look-seen', {
            detail: { uuid: look.uuid, creator: look.creator },
          }));
        }
      } else if (creative) {
        trackAdImpression(creative.id);
      }
    }
  }, [status, creative, look, isLook]);

  const handleClick = useCallback(() => {
    if (isLook && look) {
      // Capture the playing frame so the overlay can paint it as an
      // instant poster behind its hero <video> slot (mirrors the
      // legacy LookCard handoff via __feedTapPosters[trailId]).
      const frame = captureVideoFrame(director.getVideoElement(directorId));
      if (frame) {
        try {
          const w = window as Window & { __feedTapPosters?: Record<string, string> };
          w.__feedTapPosters = w.__feedTapPosters || {};
          w.__feedTapPosters[lookTrailId(look.id)] = frame;
        } catch { /* ignore */ }
      }
      // Donate the director's playing element to TrailVideoHost so the
      // LookOverlay hero can reuse it without re-buffering. The element
      // keeps its currentTime and decoded state — no black flash or stall.
      const directorEl = director.stealVideoElement(directorId);
      if (directorEl && trailMgr && playableUrl) {
        trailMgr.donate(lookTrailId(look.id), directorEl, playableUrl, posterUrl || undefined);
        director.registerTrailReturn(lookTrailId(look.id), directorId);
      }
      onOpenLook?.(look);
      return;
    }
    if (!creative) return;
    trackAdClick(creative.id);
    // Capture the playing frame for the detail-view hero handoff.
    // director.getVideoElement() returns the pooled element if assigned.
    const frame = captureVideoFrame(director.getVideoElement(directorId));
    if (frame) {
      try {
        const w = window as Window & { __feedTapPosters?: Record<string, string> };
        w.__feedTapPosters = w.__feedTapPosters || {};
        w.__feedTapPosters[creative.id] = frame;
      } catch { /* ignore */ }
    }
    // Donate the director's playing element to TrailVideoHost so the
    // ProductPage hero can reuse it without re-buffering.
    const directorEl = director.stealVideoElement(directorId);
    if (directorEl && trailMgr && playableUrl) {
      trailMgr.donate(creative.id, directorEl, playableUrl, posterUrl || undefined);
      director.registerTrailReturn(creative.id, directorId);
    }
    if (onOpenProduct) {
      onOpenProduct(creative);
    } else if (creative.affiliate_url) {
      window.open(creative.affiliate_url, '_blank', 'noopener');
    } else if (creative.product?.url) {
      window.open(creative.product.url, '_blank', 'noopener');
    }
  }, [creative, look, isLook, onOpenProduct, onOpenLook, directorId, trailMgr, playableUrl, posterUrl]);

  // Hover/touch-start prefetch for the "More like this" rail.
  // No-op for look mode — looks don't use the creative-similarity RPC.
  const handlePrefetch = useCallback(() => {
    if (!isLook && creative?.product?.id) prefetchSimilarProducts(creative.product.id, 18);
  }, [creative, isLook]);

  const beginLongPress = useCallback((e: React.TouchEvent | React.MouseEvent) => {
    if (!isSuperAdmin) return;
    longPressFired.current = false;
    const isTouch = 'touches' in e;
    if (isTouch && e.touches.length !== 1) return;
    const x = isTouch ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
    const y = isTouch ? e.touches[0].clientY : (e as React.MouseEvent).clientY;
    longPressTimer.current = window.setTimeout(() => {
      longPressFired.current = true;
      setMenu({ x, y });
      try {
        (navigator as Navigator & { vibrate?: (n: number) => void }).vibrate?.(10);
      } catch { /* ignore */ }
    }, 500);
  }, [isSuperAdmin]);

  const cancelLongPress = useCallback(() => {
    if (longPressTimer.current != null) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(null); };
    document.addEventListener('click', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  // Look-mode creator-row data (resolved from the static creators map
  // with the same look-level fallbacks the legacy LookCard used).
  const creatorData = isLook && look ? creators[look.creator] : undefined;
  const creatorAvatar = isLook && look ? (look.creatorAvatar || creatorData?.avatar || '') : '';
  const creatorName = isLook && look
    ? (creatorData?.displayName
        || look.creatorDisplayName
        || (look.creator?.startsWith('user:') ? 'User' : look.creator || ''))
    : '';

  // ── Card-level save (bookmark) ──────────────────────────────────────
  // Synthetic duplicate looks (infinite-feed padding) carry negative ids
  // derived as -(id*1000+n); normalize back so a save on the duplicate
  // marks the real look.
  const canonicalLookId = isLook && look
    ? (look.id < 0 ? Math.floor(-look.id / 1000) : look.id)
    : null;
  // Minimal Product for the bookmark store — same shape handleOpenCreative
  // maps for ProductPage, so productKey (brand::name) matches a save made
  // from the detail page.
  const saveProduct: Product | null = !isLook && creative?.product
    ? {
        id: creative.product.id || undefined,
        name: creative.product.name || 'Shop Now',
        brand: creative.product.brand || '',
        price: creative.product.price || '',
        url: creative.product.url || '',
        image: rawStillImageUrl || rawPosterUrl || undefined,
      }
    : null;
  const canSave = !!bookmarks && (isLook ? canonicalLookId != null : !!saveProduct);
  const isSaved = !!bookmarks && (isLook && canonicalLookId != null
    ? bookmarks.isLookBookmarked(canonicalLookId)
    : !!saveProduct && bookmarks.isProductBookmarked(saveProduct));
  const toggleSave = () => {
    if (!bookmarks) return;
    if (isLook && canonicalLookId != null) bookmarks.toggleLookBookmark(canonicalLookId);
    else if (saveProduct) bookmarks.toggleProductBookmark(saveProduct);
  };

  // "N products · from $58" shoppability pill for look tiles.
  const productsSummary = isLook && look ? lookProductsSummary(look) : null;

  const cardLabel = isLook && look
    ? `Open look${look.title ? `: ${look.title}` : ''}${creatorName ? ` by ${creatorName}` : ''}`
    : `Open ${[creative?.product?.brand, creative?.product?.name || 'product'].filter(Boolean).join(' ')}${creative?.product?.price ? `, ${creative.product.price}` : ''}`;

  return (
    <div
      ref={combinedRef}
      className={`${className} ${isLook ? '' : 'promo-card '}${loaded ? 'loaded' : ''}`}
      data-present-id={isLook && look ? `card:${look.id}` : undefined}
      style={{ position: 'relative', overflow: 'hidden' }}
      role="button"
      tabIndex={0}
      aria-label={cardLabel}
      onKeyDown={(e) => {
        // Keyboard activation for the card itself. Keys bubbling out of the
        // inner controls (creator chip, save, delete) are theirs to handle.
        if (e.target !== e.currentTarget) return;
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        handleClick();
      }}
      onClick={(e) => {
        if (longPressFired.current) {
          longPressFired.current = false;
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        // A card tap opens the look/product. The lower-left creator chip is the
        // one exception — it's a hotspot that opens that creator's catalog and
        // stops propagation, so its taps never reach here.
        handleClick();
      }}
      onMouseEnter={() => {
        handlePrefetch();
        // Hover-to-play stays off under reduced motion — the whole point
        // of the setting is that stills don't spontaneously start moving.
        if (renderAsStill && !hoverPlaying && !prefersReducedMotion) setHoverPlaying(true);
      }}
      onTouchStart={(e) => { handlePrefetch(); beginLongPress(e); }}
      onTouchEnd={cancelLongPress}
      onTouchMove={cancelLongPress}
      onTouchCancel={cancelLongPress}
      onMouseDown={beginLongPress}
      onMouseUp={cancelLongPress}
      onMouseLeave={() => {
        cancelLongPress();
        // Revert to the still image when the cursor leaves. Without
        // this, the first hover stuck the tile in video mode for the
        // rest of the session — the products-image-only dial said
        // "still" and the feed slowly turned video-heavy anyway.
        if (renderAsStill && hoverPlaying) setHoverPlaying(false);
      }}
      onContextMenu={isSuperAdmin ? (e) => {
        e.preventDefault();
        setMenu({ x: e.clientX, y: e.clientY });
      } : undefined}
    >
      <div className="card-inner">
        {!loaded && <div className="card-shimmer" />}

        {/* Super-admin-only "why did this show up?" affordance (center-left).
            Self-gates on role; renders nothing for shoppers. */}
        <FeedWhyButton creative={creative} look={look} />

        {/* Shopper-facing reason caption (top-left) — "Because you saved
            Nike". Self-gates: renders nothing without a strong signal. */}
        <FeedWhyShopperTag creative={creative} look={look} />


        {/* Poster <img> — identical path for looks and products. The
            browser's preparser discovers <img> tags and schedules fetches
            with proper priority, decoding, and lazy-loading — CSS
            backgroundImage gets none of that. */}
        {(renderAsStill ? stillImageUrl : posterUrl) && (
          <img
            className="card-poster"
            src={renderAsStill && !hoverPlaying ? stillImageUrl : posterUrl ?? undefined}
            alt=""
            // Eager, not lazy. The grid mounts cards ~1600px ahead of the
            // viewport (FeedSection sentinel) and windows the mounted set, so
            // eager-loading fetches each poster into cache BEFORE its tile
            // scrolls in — killing the "black tile → poster pops in → video"
            // lag on scroll. `loading="lazy"` deferred the fetch until the tile
            // was nearly on screen, which a fast flick always outran. Bandwidth
            // stays bounded by the mounted window; first-screen tiles keep the
            // high fetchPriority so initial paint is unaffected.
            loading="eager"
            decoding="async"
            fetchPriority={priority ? 'high' : undefined}
            onLoad={() => setLoaded(true)}
            onError={(e) => { setLoaded(true); (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
            style={{
              position: 'absolute', inset: 0, width: '100%', height: '100%',
              objectFit: 'cover', zIndex: 1,
            } as React.CSSProperties}
          />
        )}

        {/* Director appends the pooled <video> element here at zIndex 2.
            No <video> JSX — the director owns the element lifecycle. */}

        <div className="card-gradient" />

        {canSave && (
          <button
            type="button"
            className={`card-save-btn${isSaved ? ' is-saved' : ''}`}
            aria-label={isSaved ? 'Remove from saved' : (isLook ? 'Save look' : 'Save product')}
            aria-pressed={isSaved}
            title={isSaved ? 'Remove from saved' : 'Save'}
            onClick={(e) => { e.stopPropagation(); toggleSave(); }}
            onMouseDown={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill={isSaved ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
            </svg>
          </button>
        )}

        {!isLook && canDelete && onDelete && creative && (
          <button
            type="button"
            className="creative-delete-btn"
            aria-label="Delete product"
            onClick={async (e) => {
              e.stopPropagation();
              if (await catalogConfirm({ title: `Delete product "${creative.product?.name || 'this product'}" everywhere?`, danger: true })) {
                onDelete(creative.id);
              }
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
              <path d="M10 11v6" />
              <path d="M14 11v6" />
              <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
            </svg>
          </button>
        )}

        {isLook && look && canDelete && onDeleteLook && (
          <button
            type="button"
            className="creative-delete-btn"
            aria-label="Delete look"
            onClick={async (e) => {
              e.stopPropagation();
              if (await catalogConfirm({ title: 'Delete this look everywhere?', danger: true })) {
                onDeleteLook(look);
              }
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
              <path d="M10 11v6" />
              <path d="M14 11v6" />
              <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
            </svg>
          </button>
        )}

        {isLook && look && !hideCreator ? (
          <>
            <CreatorChip
              look={look}
              creatorAvatar={creatorAvatar}
              creatorName={creatorName}
              onOpenCreator={onOpenCreator}
            />
            {/* Shoppability pill — the look-mode counterpart of the product
                card's brand/name/price row, so a look tile signals it can be
                shopped (and from what price) before the tap. */}
            {productsSummary && (
              <span className="card-products-pill">{productsSummary}</span>
            )}
          </>
        ) : creative ? (
          <div className="promo-product-info">
            <div className="promo-product-text">
              {creative.product?.brand && (
                <BrandLabel name={creative.product.brand} />
              )}
              <span className="promo-product-name">
                {creative.product?.name || 'Shop Now'}
              </span>
            </div>
            {creative.product?.price && (
              <span className="promo-product-price">{creative.product.price}</span>
            )}
          </div>
        ) : null}
      </div>

      {menu && isSuperAdmin && (
        <div
          className="trail-admin-menu"
          onClick={(e) => e.stopPropagation()}
          style={{ left: menu.x, top: menu.y }}
        >
          <button
            type="button"
            className="trail-admin-menu-btn trail-admin-menu-btn--danger"
            onClick={async (e) => {
              e.stopPropagation();
              setMenu(null);
              if (isLook && look) {
                await hideLookId(look);
                return;
              }
              if (creative && onDelete && await catalogConfirm({ title: `Delete product "${creative.product?.name || 'this product'}" everywhere?`, danger: true })) {
                onDelete(creative.id);
              }
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
              <path d="M10 11v6" />
              <path d="M14 11v6" />
            </svg>
            {isLook ? 'Delete look (admin)' : 'Delete product'}
          </button>
        </div>
      )}

    </div>
  );
});

export default CreativeCardV2;

// Brand label that swaps text → logo image when the
// "Show brand logos on the feed" dial is ON AND we have a logo
// registered in public.brand_logos for this brand. Falls back to
// the plain text in every other case so flipping the dial never
// blanks a label.
//
// Logos are forced to a pure-white silhouette via CSS filter so
// every brand reads consistently against the card's dark bottom-fade
// gradient — Brandfetch returns whatever variants the brand has
// registered, which can be near-black or full-colour and would
// vanish on the gradient. `brightness(0) invert(1)` collapses every
// pixel to white regardless of source palette. The logo is also
// pinned to the left edge so it lines up with the product name
// below it (not baseline-centered to the cap height of the SVG).
/**
 * Creator identity on feed look cards — a small profile picture (with the
 * +/− follow badge) sitting inline next to the creator's username, sized to
 * match the product name. The avatar AND the username are each their own
 * clickable tag: both open the creator's catalog. The follow badge on the
 * avatar keeps its own follow/unfollow behavior.
 */
function CreatorChip({
  look,
  creatorAvatar,
  creatorName,
  onOpenCreator,
}: {
  look: Look;
  creatorAvatar: string;
  creatorName: string;
  onOpenCreator?: (name: string) => void;
}) {
  // The creator chip is a tappable hotspot (the lower-left rounded rectangle —
  // see .card-creator-tag in feed.css): tapping the avatar OR the username
  // opens that creator's catalog. stopPropagation keeps the tap from falling
  // through to the card (which opens the look). The small +/− follow badge
  // stays its own control (it stops propagation itself), so follow still works.
  const openCreator = (e: React.MouseEvent | React.KeyboardEvent) => {
    e.stopPropagation();
    if (look.creator) onOpenCreator?.(look.creator);
  };
  return (
    <div
      className="card-creator-tag"
      role="button"
      tabIndex={0}
      aria-label={creatorName ? `Open ${creatorName}'s catalog` : 'Open creator catalog'}
      onClick={openCreator}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openCreator(e); } }}
    >
      <CreatorAvatarFollow
        handle={look.creator}
        avatarUrl={creatorAvatar}
        displayName={creatorName}
        size={20}
        onOpenCreator={onOpenCreator}
        avatarOpensCreator={false}
      />
      {creatorName && (
        <span className="card-creator-tag-name">{creatorName}</span>
      )}
    </div>
  );
}

function BrandLabel({ name }: { name: string }) {
  const showLogos = useShowBrandLogos();
  // Only look up (and network-fetch) a brand logo when the dial is actually on.
  // DEFAULT_SHOW_BRAND_LOGOS is false, so without this gate every uncached brand
  // fired a products?brand=ilike… query whose result was then discarded. Passing
  // null makes the hook a no-op (it early-returns on an empty key).
  const logoUrl = useBrandLogo(showLogos ? name : null);
  const [imageBroken, setImageBroken] = useState(false);
  if (showLogos && logoUrl && !imageBroken) {
    return (
      <img
        className="promo-product-brand promo-product-brand-logo"
        src={logoUrl}
        alt={name}
        onError={() => setImageBroken(true)}
        style={{
          height: 14,
          width: 'auto',
          maxWidth: 96,
          objectFit: 'contain',
          objectPosition: 'left center',
          display: 'block',
          alignSelf: 'flex-start',
          marginBottom: 2,
          // No brightness/invert filter — Brandfetch's theme=dark
          // wordmark variant is already designed for dark backgrounds
          // (transparent PNG with white-ish text). The filter we used
          // before flattened opaque-background variants into a solid
          // white block; without it, the natural typeface shows.
          filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.55))',
        }}
      />
    );
  }
  return <span className="promo-product-brand">{name}</span>;
}
