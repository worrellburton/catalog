
import { useRef, useEffect, useState, useCallback, memo } from 'react';
import { Look, creators } from '~/data/looks';
import { useAuth } from '~/hooks/useAuth';
import { hideLookId } from '~/hooks/useHiddenLooks';
import { useInViewport } from '~/hooks/useInViewport';
import { useTrailVideo, useTrailPrewarm } from './TrailVideoHost';
import { lookTrailId, normalizeLookVideoUrl } from '~/utils/trailIds';
import { toggleFollow, isFollowing as fetchIsFollowing } from '~/services/follows';
import { trackImpression } from '~/services/session-tracker';
import { useVideoStillRatio } from '~/hooks/useVideoStillRatio';
import { shouldBeVideo } from '~/utils/videoStillSplit';
import {
  prefetchVideoBytes,
  captureVideoFrame,
  isMobileViewport,
  isSlowConnection,
} from '~/services/video-loading';

// Per-session impression dedupe so a user scrolling past the same
// look five times only counts as one impression (one round trip).
// Lives on module scope so it's shared across every LookCard mount
// in the same tab; reset on a hard reload.
const impressionsLogged = new Set<string>();

interface LookCardProps {
  look: Look;
  className?: string;
  onOpenLook: (look: Look) => void;
  onOpenCreator: (creatorName: string) => void;
  onCreateCatalog?: (query: string) => void;
  /** Hide the creator avatar+name row on the tile. Used by the Creator
   *  Catalog page where the creator identity is already in the page
   *  header - per-tile attribution is redundant noise there. */
  hideCreator?: boolean;
  /** IntersectionObserver rootMargin for the *active* band — cards inside
   *  this band attach a live <video> element. Default: '50% 0%' (half a
   *  viewport above + below). Cards outside this band but still within the
   *  wider render band fall back to a static poster image, which releases
   *  the video back to the TrailVideoHost pool. Pass a tighter value for
   *  overlay feed sections that share bandwidth with a hero video. */
  rootMargin?: string;
  /** Skip video entirely and render a static poster thumbnail. Use for
   *  overlay feed sections (similar looks, YMAL) where multiple simultaneous
   *  video decoders cause CPU/fan spikes. Card is still tappable. */
  previewOnly?: boolean;
}

// Render band — cards within this margin keep their poster painted but
// drop the video element. Wider than the active band so videos re-attach
// before the user can scroll one back into view.
const RENDER_MARGIN = '200% 0%';

const LookCard = memo(function LookCard({ look, className = 'look-card', onOpenLook, onOpenCreator, onCreateCatalog, hideCreator = false, rootMargin = '50% 0%', previewOnly = false }: LookCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const slotRef = useRef<HTMLDivElement | null>(null);
  // Poster-first: if the look has a poster image, treat the card as
  // "loaded" immediately so we never flash a shimmer over a perfectly
  // good still image while the MP4 streams in.
  const posterReady = !!(look.thumbnail_url || look.cover);
  const [loaded, setLoaded] = useState(() => previewOnly || posterReady);
  // Active band — close enough to need a live video element.
  const inActiveBand = useInViewport(cardRef, rootMargin);
  // Render band — still on screen-ish, but far enough that we drop the
  // video to free decoder/bandwidth. The card stays in the DOM with its
  // poster so scrolling back is instant (no remount, no layout shift).
  const inRenderBand = useInViewport(cardRef, RENDER_MARGIN);
  // Anything in DOM at all gets the poster painted.
  const inViewport = inActiveBand || inRenderBand;
  const { user } = useAuth();
  const isSuperAdmin = user?.role === 'super_admin';
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  // Follow state for the inline creator chip. We only fetch when the
  // card actually enters the viewport (useInViewport already fires
  // further down) — module-level cache in services/follows would be
  // nicer, but per-card fetch is cheap (single COUNT(*)) and avoids
  // a shared-state singleton for the first cut.
  const [following, setFollowing] = useState<boolean | null>(null);
  const [followBusy, setFollowBusy] = useState(false);
  const longPressTimer = useRef<number | null>(null);
  const longPressFired = useRef(false);

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
      try { (navigator as Navigator & { vibrate?: (n: number) => void }).vibrate?.(10); } catch {}
    }, 500);
  }, [isSuperAdmin]);

  const cancelLongPress = useCallback(() => {
    if (longPressTimer.current != null) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  // Fetch follow state for this card's creator on mount. Skipped
  // for seed creators whose handle starts with "user:" placeholder —
  // those aren't real creators and the toggle would no-op.
  useEffect(() => {
    if (!look.creator || look.creator.startsWith('user:')) return;
    let cancelled = false;
    fetchIsFollowing(look.creator).then(v => { if (!cancelled) setFollowing(v); });
    return () => { cancelled = true; };
  }, [look.creator]);

  const onToggleFollow = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (followBusy || !look.creator) return;
    setFollowBusy(true);
    const prev = following;
    setFollowing(!prev);
    try {
      const { following: next } = await toggleFollow(look.creator);
      setFollowing(next);
    } catch {
      setFollowing(prev);
    } finally {
      setFollowBusy(false);
    }
  }, [following, followBusy, look.creator]);

  // Close the admin right-click menu on any outside click or Escape.
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

  const creatorData = creators[look.creator];
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
  const trailId = lookTrailId(look.id);
  const fullVideoUrl = normalizeLookVideoUrl(look.video, basePath);
  // Mobile / slow connections get the smaller H.264 480p variant when
  // it exists (mirrors pickVideoUrl() in CreativeCard). Same URL is used
  // by LookOverlay so TrailVideoHost's PoolEntry doesn't re-swap src on
  // handoff (which would force a re-buffer + first-frame black).
  const wantMobile = isMobileViewport() || isSlowConnection();
  const videoUrl = wantMobile && look.mobile_video_url ? look.mobile_video_url : fullVideoUrl;
  // Look thumbnail (server-extracted) → look cover image → empty.
  // Used as the <video poster=> so the card paints a real image while
  // the MP4 streams. Empty string disables the attribute.
  const posterUrl = look.thumbnail_url || look.cover || '';
  // When the Dial pushes this card into still mode, prefer the first
  // product's retail image over the look's own thumbnail — the
  // product photo is the merchandising shot and reads better as a
  // static tile. Falls back through the poster chain if no product
  // images are attached.
  const firstProductImage = look.products?.find(p => !!p.image)?.image || '';
  const stillImageUrl = firstProductImage || posterUrl;

  // Defer slot population to the *active* viewport band. Outside that
  // band the video is detached and returned to the TrailVideoHost pool —
  // bounded CPU/decoder use no matter how long the infinite feed gets.
  // The LookOverlay hero (same trailId) still reuses the same running
  // <video> on tap — no remount, no first-frame black.
  //
  // Video ↔ Still ratio dial (/admin/dials → video_still_ratio): when
  // the global ratio is below 100, a deterministic per-card subset
  // gets forced into the still-image path instead of the video path.
  //
  // Fallbacks (Phase 8): the dial is a preference, not a guarantee.
  //   • A card flagged "still" with no poster falls back to video so
  //     the slot isn't a flat colour block.
  //   • A card flagged "video" with no video URL stays as a still
  //     (its poster / cover image) — same behaviour as today.
  // inActiveBand / previewOnly gates still apply, so off-screen and
  // preview cards stay cheap regardless of the dial.
  const globalVideoRatio = useVideoStillRatio();
  const dialPrefersVideo = shouldBeVideo(look.id, globalVideoRatio);
  const hasVideo  = !!videoUrl;
  const hasPoster = !!posterUrl;
  const allowVideoForThisCard = hasVideo && (dialPrefersVideo || !hasPoster);
  const videoActive = inActiveBand && !previewOnly && allowVideoForThisCard;
  const setVideoSlot = useTrailVideo(
    videoActive ? trailId : undefined,
    videoActive ? videoUrl : undefined,
    posterUrl || undefined,
  );

  const setSlot = useCallback((node: HTMLDivElement | null) => {
    slotRef.current = node;
    setVideoSlot(node);
  }, [setVideoSlot]);

  // Emit one impression per session per look the first time the card
  // crosses the viewport. Deduped via a module-scope Set so a user
  // scrolling past the same tile multiple times still counts as one.
  useEffect(() => {
    if (!inViewport) return;
    const key = String(look.id ?? '');
    if (!key || impressionsLogged.has(key)) return;
    impressionsLogged.add(key);
    trackImpression({ type: 'look', id: key, uuid: look.uuid, context: look.title?.slice(0, 200) });
  }, [inViewport, look.id, look.title]);

  // Mark loaded once the host video has frames. If we already have a
  // poster, `loaded` was true from the start — this just keeps things in
  // sync for the rare no-poster path.
  useEffect(() => {
    if (!videoActive) return;
    const video = slotRef.current?.querySelector('video') as HTMLVideoElement | null;
    if (!video) return;
    if (video.readyState >= 2) { setLoaded(true); return; }
    const handler = () => setLoaded(true);
    ['playing', 'canplay', 'loadeddata'].forEach(evt => video.addEventListener(evt, handler, { once: true }));
    const timeout = setTimeout(() => setLoaded(true), 8000);
    return () => {
      clearTimeout(timeout);
      ['playing', 'canplay', 'loadeddata'].forEach(evt => video.removeEventListener(evt, handler));
    };
  }, [videoActive, trailId]);

  // Pre-warm: create the <video> element in the offscreen pool as soon as
  // the card enters the render band (~2 viewports away). The media pipeline
  // starts buffering immediately. When the card enters the active band,
  // useTrailVideo's attach() finds the already-loading element and starts
  // playing near-instantly instead of cold-starting from zero.
  // This mirrors what the VideoPlaybackDirector does for CreativeCardV2.
  const prewarmId  = inRenderBand && !previewOnly && allowVideoForThisCard ? trailId   : undefined;
  const prewarmSrc = inRenderBand && !previewOnly && allowVideoForThisCard ? videoUrl  : undefined;
  useTrailPrewarm(prewarmId, prewarmSrc, posterUrl || undefined);

  // For the overlay: when serving a down-sized mobile variant on this card,
  // also warm the full-res URL so tapping in opens the overlay instantly.
  useEffect(() => {
    if (!inRenderBand || previewOnly || videoUrl === fullVideoUrl) return;
    const t = window.setTimeout(() => prefetchVideoBytes(fullVideoUrl), 500);
    return () => window.clearTimeout(t);
  }, [inRenderBand, previewOnly, videoUrl, fullVideoUrl]);

  return (
    <div
      ref={cardRef}
      className={`${className} ${loaded ? 'loaded' : ''}`}
      data-present-id={`card:${look.id}`}
      onClick={(e) => {
        if (longPressFired.current) {
          longPressFired.current = false;
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        if (!(e.target as HTMLElement).closest('.card-creator-row')) {
          // Phase 9 — snapshot the currently-playing frame so LookOverlay
          // can paint it as an instant poster behind its hero <video> slot.
          // Eliminates the black flash between card → overlay even when
          // the trail-host hasn't yet swapped the live element across.
          try {
            const video = slotRef.current?.querySelector('video') as HTMLVideoElement | null;
            const frame = captureVideoFrame(video);
            if (frame) {
              const w = window as Window & { __feedTapPosters?: Record<string, string> };
              w.__feedTapPosters = w.__feedTapPosters || {};
              w.__feedTapPosters[trailId] = frame;
            }
          } catch { /* ignore — overlay falls back to thumbnail_url */ }
          onOpenLook(look);
        }
      }}
      onTouchStart={beginLongPress}
      onTouchEnd={cancelLongPress}
      onTouchMove={cancelLongPress}
      onTouchCancel={cancelLongPress}
      onMouseDown={beginLongPress}
      onMouseUp={cancelLongPress}
      onMouseLeave={cancelLongPress}
      onContextMenu={isSuperAdmin ? (e) => {
        e.preventDefault();
        setMenu({ x: e.clientX, y: e.clientY });
      } : undefined}
    >
      <div className="card-inner">
        {!loaded && <div className="card-shimmer" />}
        {/* TrailVideoHost slot — shared <video> hands off to LookOverlay's
            hero on tap via DOM appendChild. No layout morph; the card's
            own video frames stay alive while the overlay opacity-fades in.
            We paint the poster as a CSS background on the slot itself so
            the user sees a real still image instantly — the <video> then
            decodes on top of it. previewOnly and out-of-active-band cards
            skip the video entirely and render poster only. */}
        {previewOnly || !videoActive ? (
          <div
            className="card-video-slot"
            style={{
              position: 'absolute',
              inset: 0,
              // Prefer the retail product image when the Dial forced
              // this into the still path; thumbnail / cover are the
              // fallback chain for cards in still mode for other
              // reasons (previewOnly, out-of-band, missing video).
              backgroundImage: (stillImageUrl || posterUrl) ? `url(${stillImageUrl || posterUrl})` : undefined,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              backgroundColor: look.color || '#111',
            } as React.CSSProperties}
          />
        ) : (
          <div
            ref={setSlot}
            className="card-video-slot"
            data-trail-id={trailId}
            style={{
              position: 'absolute',
              inset: 0,
              backgroundImage: posterUrl ? `url(${posterUrl})` : undefined,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              backgroundColor: look.color || '#111',
            } as React.CSSProperties}
          />
        )}
        <div className="card-gradient" />

        {!hideCreator && (
          <div
            className="card-creator-row"
            onClick={(e) => {
              e.stopPropagation();
              onOpenCreator(look.creator);
            }}
          >
            {(() => {
              const avatar = creatorData?.avatar || look.creatorAvatar || '';
              const name = creatorData?.displayName
                || look.creatorDisplayName
                || (look.creator?.startsWith('user:') ? 'User' : look.creator || '');
              return avatar ? (
                <img className="card-creator-avatar" src={avatar} alt={name} />
              ) : (
                <span className="card-creator-avatar card-creator-avatar--initial" aria-hidden="true">
                  {(name || look.creator || '?').charAt(0).toUpperCase()}
                </span>
              );
            })()}
            <span className="card-creator-name">
              {creatorData?.displayName
                || look.creatorDisplayName
                || (look.creator?.startsWith('user:') ? 'User' : look.creator)}
            </span>
            {/* Inline follow toggle. Hidden when we don't have a real
                handle (no point following a "User:<uuid>" placeholder)
                and while the initial isFollowing fetch is in flight
                (null state). Optimistic flip + revert via onToggleFollow. */}
            {look.creator && !look.creator.startsWith('user:') && following !== null && (
              <button
                type="button"
                onClick={onToggleFollow}
                disabled={followBusy}
                aria-pressed={following}
                className="card-creator-follow"
                title={following ? 'Following — click to unfollow' : 'Follow this creator'}
                style={{
                  marginLeft: 6,
                  padding: '2px 9px',
                  borderRadius: 999,
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: '0.3px',
                  cursor: followBusy ? 'wait' : 'pointer',
                  border: '1px solid',
                  borderColor: following ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.7)',
                  background: following ? 'transparent' : '#fff',
                  color: following ? '#fff' : '#0f172a',
                  transition: 'background 160ms, color 160ms, border-color 160ms',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 3,
                }}
              >
                {following ? (
                  <>
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                    Following
                  </>
                ) : '+ Follow'}
              </button>
            )}
          </div>
        )}
      </div>
      {menu && isSuperAdmin && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'fixed',
            left: menu.x,
            top: menu.y,
            zIndex: 10000,
            background: '#1a1a1a',
            color: '#fff',
            borderRadius: 8,
            padding: 4,
            minWidth: 160,
            boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
            border: '1px solid #333',
            fontSize: 13,
          }}
        >
          <button
            onClick={async (e) => {
              e.stopPropagation();
              setMenu(null);
              await hideLookId(look.id);
            }}
            style={{
              width: '100%',
              textAlign: 'left',
              padding: '8px 12px',
              background: 'transparent',
              border: 'none',
              color: '#fca5a5',
              fontSize: 13,
              fontWeight: 500,
              cursor: 'pointer',
              borderRadius: 6,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#2a1616'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
              <path d="M10 11v6" />
              <path d="M14 11v6" />
            </svg>
            Delete look (admin)
          </button>
        </div>
      )}
    </div>
  );
});

export default LookCard;
