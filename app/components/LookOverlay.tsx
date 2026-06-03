
import { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import { Look, creators, Product, looks as allLooksData } from '~/data/looks';
import { useEscapeKey } from '~/hooks/useEscapeKey';
import LookCard from './LookCard';
import { sortByGarmentRole } from '~/utils/garmentOrder';
import ContinuousFeed from './ContinuousFeed';
import { useActiveGenderFilter } from '~/hooks/useActiveGenderFilter';
import { useTrailVideo, useTrailVideoManager } from './TrailVideoHost';
import { lookTrailId, normalizeLookVideoUrl } from '~/utils/trailIds';
import { supabaseImage } from '~/utils/supabaseImage';
import { director } from '~/services/video-playback-director';
import FollowIconButton from './FollowIconButton';
import { getLookSaveCount, recordLookSave, recordLookUnsave } from '~/services/look-saves';
import { type ProductAd } from '~/services/product-creative';
import {
  prefetchVideoBytes,
  isMobileViewport,
  isSlowConnection,
} from '~/services/video-loading';
import { useAuth } from '~/hooks/useAuth';
import { useShopperBody } from '~/hooks/useShopperBody';
import { usePageSections, isSectionEnabled, getSectionLimit } from '~/hooks/usePageSections';
import SizeMatchBadge, { SizeMatchSummary } from './SizeMatchBadge';
import { getLookSimilarityThreshold, DEFAULT_LOOK_SIMILARITY } from '~/services/dials';
import SimilarDebugModal, { type SimilarDebugReport } from './SimilarDebugModal';

/**
 * Pads `arr` to exactly `count` items by cycling duplicates (with synthetic
 * negative IDs so TrailVideoHost creates a separate <video> per slot), or
 * trims to `count` if longer. Returns empty array unchanged so empty sections
 * stay hidden.
 */
function fillLooks(arr: Look[], count: number): Look[] {
  if (arr.length === 0) return [];
  if (arr.length >= count) return arr.slice(0, count);
  const out: Look[] = [...arr];
  while (out.length < count) {
    const src = arr[out.length % arr.length];
    out.push({ ...src, id: -(src.id * 1000 + out.length) });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────


type TabId = 'products' | 'creator';

interface BookmarksInterface {
  isLookBookmarked: (id: number) => boolean;
  toggleLookBookmark: (id: number) => void;
  isProductBookmarked: (p: Product) => boolean;
  toggleProductBookmark: (p: Product) => void;
}

interface LookOverlayProps {
  look: Look;
  onClose: () => void;
  onOpenCreator: (name: string) => void;
  onOpenBrowser: (url: string, title: string) => void;
  onOpenProduct?: (product: Product) => void;
  onCreateCatalog?: (query: string) => void;
  onOpenLook?: (look: Look) => void;
  bookmarks: BookmarksInterface;
  allLooks?: Look[];
  /** Product creatives for the "You might also like" section. */
  popularFallback?: ProductAd[];
  /** Opens a product creative (with video context) in ProductPage. */
  onOpenCreative?: (creative: ProductAd) => void;
}

export default function LookOverlay({ look, onClose, onOpenCreator, onOpenBrowser, onOpenProduct, onCreateCatalog, onOpenLook, bookmarks, allLooks, popularFallback, onOpenCreative }: LookOverlayProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const moreScrollRef = useRef<HTMLDivElement>(null);
  /** The whole info column on mobile — needs its scrollTop checked when a
   *  swipe-down begins, so we only intercept the gesture as a dismiss
   *  when the column is already at the top. */
  const infoColRef = useRef<HTMLDivElement>(null);
  /** True when the touch sequence currently in flight is being treated
   *  as a dismiss-pull (we'll translate the panel) instead of normal
   *  vertical scroll (we leave it alone). */
  const dragActiveRef = useRef(false);
  // Tracked separately so the nested feed re-binds its IntersectionObserver
  // root once the scroller mounts (refs alone don't trigger re-renders).
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  const setScrollRef = useCallback((el: HTMLDivElement | null) => {
    scrollRef.current = el;
    setScrollEl(el);
  }, []);
  const [mounted, setMounted] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>('products');
  // Side-rail back button: fades in once the user has scrolled past the
  // hero (the corner .look-back-btn has scrolled off). Desktop only —
  // mobile has its own dedicated bottom-sheet dismiss affordance.
  const [showSideBack, setShowSideBack] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!window.matchMedia('(min-width: 769px)').matches) return;
    const scroller = scrollEl;
    if (!scroller) return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setShowSideBack(scroller.scrollTop > 220));
    };
    onScroll();
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      scroller.removeEventListener('scroll', onScroll);
    };
  }, [scrollEl]);
  const [touchStartY, setTouchStartY] = useState(0);
  const [translateY, setTranslateY] = useState(0);
  const [isAnimatingOut, setIsAnimatingOut] = useState(false);
  const [lookBookmarked, setLookBookmarked] = useState(bookmarks.isLookBookmarked(look.id));

  const { user } = useAuth();
  const shopperBody = useShopperBody(user?.id);
  // Admin-editable section config from /admin/pages. null until loaded;
  // isSectionEnabled treats null as "enabled" so first paint isn't blank.
  const pageSections = usePageSections('looks');
  const videoEnabled       = isSectionEnabled(pageSections, 'video');
  const creatorChipEnabled = isSectionEnabled(pageSections, 'creator-chip');
  const tabsEnabled        = isSectionEnabled(pageSections, 'tabs');
  const productsEnabled    = isSectionEnabled(pageSections, 'products');
  const moreFromCreatorEnabled = isSectionEnabled(pageSections, 'more-from-creator');
  const similarEnabled         = isSectionEnabled(pageSections, 'similar');
  // Default 9 → a clean 3×3 mosaic in the right column (admin can override).
  const moreFromCreatorLimit   = getSectionLimit(pageSections, 'more-from-creator', 9);
  const similarLimit           = getSectionLimit(pageSections, 'similar', 8);
  const [productBookmarks, setProductBookmarks] = useState<boolean[]>(
    look.products.map(p => bookmarks.isProductBookmarked(p))
  );
  const [saveCount, setSaveCount] = useState<number | null>(null);

  // Resolve creator identity in priority order so orphan looks (created
  // via the user-generation flow with no creator_handle) render the
  // publishing user's profile name + avatar instead of the synthetic
  // `user:UUID` key. See services/looks.ts for where the fallback fields
  // are populated.
  const staticCreator = creators[look.creator];
  const isSyntheticCreator = !!look.creator && look.creator.startsWith('user:');
  const creatorData = staticCreator
    ? staticCreator
    : (look.creatorDisplayName || look.creatorAvatar)
      ? { displayName: look.creatorDisplayName || '', avatar: look.creatorAvatar || '', name: look.creator }
      : undefined;
  const showHandle = !isSyntheticCreator && !!look.creator;

  const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
  const trailId = lookTrailId(look.id);
  const fullVideoUrl = normalizeLookVideoUrl(look.video, basePath);
  // Match LookCard's URL choice exactly: same string ⇒ TrailVideoHost
  // PoolEntry hits without re-swapping src on handoff. If the URL diverges
  // the trail-host detects "same id, new src" and re-buffers from scratch
  // (audible/visible reload).
  const wantMobile = isMobileViewport() || isSlowConnection();
  const heroVideoUrl = wantMobile && look.mobile_video_url ? look.mobile_video_url : fullVideoUrl;

  // Tap-handoff poster: LookCard captured the playing frame via
  // captureVideoFrame() and stashed a JPEG data URL on
  // window.__feedTapPosters[trailId] right before navigation. Read it
  // synchronously on mount so the hero paints that exact frame BEFORE
  // the trail-host has a chance to swap in the live <video> element.
  // Cleared after read so the next tap doesn't reuse a stale snapshot.
  const tapHandoffPoster = (() => {
    if (typeof window === 'undefined') return '';
    const w = window as Window & { __feedTapPosters?: Record<string, string> };
    const url = w.__feedTapPosters?.[trailId];
    if (url && w.__feedTapPosters) delete w.__feedTapPosters[trailId];
    return url || '';
  })();
  const heroPoster = tapHandoffPoster || look.thumbnail_url || look.cover || '';

  // Take ownership of the same shared <video> element the originating
  // LookCard was playing. appendChild moves the DOM node - currentTime,
  // decoded frames, and audio context all survive, so the morph from card
  // → hero never reloads or shows a black gap. Pass the poster so a cold
  // path (pool element evicted between card unmount and hero attach) still
  // paints a real image.
  const setHeroSlot = useTrailVideo(trailId, heroVideoUrl, heroPoster || undefined);

  // Phase 8 — kick off a high-res prefetch on overlay mount in case the
  // card-side preload didn't run (e.g. user opened the overlay from a
  // route that never mounted the LookCard, or the card had been out of
  // the render band). Idempotent by URL so calling twice is free when
  // the cache is already warm.
  useEffect(() => {
    if (heroVideoUrl) prefetchVideoBytes(heroVideoUrl);
    if (fullVideoUrl && fullVideoUrl !== heroVideoUrl) prefetchVideoBytes(fullVideoUrl);
  }, [heroVideoUrl, fullVideoUrl]);

  // Pause background feed cards while the overlay is open so they don't
  // compete for bandwidth with the hero video. Resume on unmount.
  const trailMgr = useTrailVideoManager();
  useEffect(() => {
    trailMgr?.suspendFeed(trailId);
    return () => { trailMgr?.resumeFeed(); };
  }, [trailMgr, trailId]);

  // Resolves to the shopper's active gender preference ('all'|'men'|'women').
  // Declared before feedSections so it can be used as a tiebreaker when the
  // seed look is tagged 'unisex' (e.g. because a product says "Unisex T-Shirt").
  const ymalGenderFilter = useActiveGenderFilter();

  // Admin dial: minimum fraction of seed products a candidate look must share.
  // 0 = any 1 match (default/current). Loaded once on overlay open.
  const [lookSimilarityThreshold, setLookSimilarityThresholdState] = useState(DEFAULT_LOOK_SIMILARITY);
  useEffect(() => {
    getLookSimilarityThreshold().then(setLookSimilarityThresholdState);
  }, []);

  // Feed sections below the hero:
  //   1. "More like this" — shared product types + compatible gender
  //   2. "Popular" — fallback (8 looks) when section 1 is empty
  //   3. "More from <creator>" — other looks by the same creator
  // Each section is capped at 8; padding with cycled duplicates fills short lists.
  const feedSections = useMemo(() => {
    // Filter out the legacy static-seed creators (@lilywittman /
    // @garrett) — they have placeholder gradient thumbnails with no
    // real videos, so they read as "looks that don't exist" in the
    // Popular / More-from sections. Live looks only.
    const SEED_CREATORS = new Set(['@lilywittman', '@garrett']);
    const source = (allLooks || allLooksData)
      .filter(l => l.id !== look.id)
      .filter(l => !SEED_CREATORS.has(l.creator));
    // Match by exact shared product name (at least 1 product in common) +
    // compatible gender. "Same hat" means the exact same product, not just
    // any hat — type-category matching was too broad and pulled in unrelated looks.
    const seedProductNames = new Set(
      (look.products || []).map(p => p.name.toLowerCase().trim()).filter(Boolean)
    );
    const seedGender = look.gender;

    // When the seed look is 'unisex', use the shopper's active gender preference
    // as the effective filter gender. This prevents women's looks from appearing
    // in "More like this" when the seed is visually a men's look but tagged
    // 'unisex' (e.g. because a product name includes "Unisex ...").
    // If no preference is set ('all'), fall back to 'unisex' so all genders show.
    const effectiveSeedGender: 'men' | 'women' | 'unisex' =
      seedGender === 'unisex' && ymalGenderFilter !== 'all'
        ? ymalGenderFilter
        : seedGender;

    // minMatches = how many seed products must appear in the candidate.
    // threshold 0 → 1 match (current behaviour). threshold 60 with 3
    // seed products → ceil(3×0.6)=2 must match. threshold 100 → all must match.
    const minMatches = Math.max(1, Math.ceil(seedProductNames.size * lookSimilarityThreshold / 100));
    const looksLikeThis: Look[] = seedProductNames.size > 0
      ? source.filter(l => {
          const cg = l.gender;
          if (effectiveSeedGender !== 'unisex' && cg !== 'unisex' && effectiveSeedGender !== cg) return false;
          const matchCount = (l.products || []).filter(p =>
            seedProductNames.has(p.name.toLowerCase().trim())
          ).length;
          return matchCount >= minMatches;
        })
      : [];

    const popular: Look[] = looksLikeThis.length === 0
      ? source
      : [];

    // Two looks count as "from the same creator" only when both the
    // creator key AND the display name match. A single uploader can
    // publish looks under multiple synthetic personas (e.g. all share
    // the same user:<uuid> key but have different titles/displayNames
    // like "Robert Burton" vs "Taylor Phillips"). Matching on the key
    // alone groups unrelated personas together.
    const sameCreator = (l: Look) =>
      l.creator === look.creator &&
      (l.creatorDisplayName || '') === (look.creatorDisplayName || '');

    const moreFromCreator: Look[] = look.creator
      ? source.filter(sameCreator)
      : [];

    const seen = new Set<number>();
    const dedupe = (arr: Look[]): Look[] => arr.filter(l => {
      if (seen.has(l.id)) return false;
      seen.add(l.id);
      return true;
    });

    const a = dedupe(looksLikeThis);
    const b = dedupe(popular);
    const c = dedupe(moreFromCreator);

    return {
      looksLikeThis:   fillLooks(a, 8),
      popular:         fillLooks(b, 8),
      moreFromCreator: fillLooks(c, 8),
    };
  }, [look.id, look.creator, look.products, look.gender, allLooks, ymalGenderFilter, lookSimilarityThreshold]);

  // Super-admin "why this rail?" debug for the name-match "Similar looks".
  // Unlike the product rail (embedding cosine), looks are matched by exact
  // shared product names + gender, so the report recomputes that math here.
  const isSuperAdmin = user?.role === 'super_admin';
  const [simDebug, setSimDebug] = useState<{ open: boolean; report: SimilarDebugReport | null }>(
    { open: false, report: null },
  );
  const openSimilarLooksDebug = useCallback(() => {
    const SEED_CREATORS = new Set(['@lilywittman', '@garrett']);
    const source = (allLooks || allLooksData)
      .filter(l => l.id !== look.id)
      .filter(l => !SEED_CREATORS.has(l.creator));
    const seedNames = Array.from(new Set(
      (look.products || []).map(p => p.name.toLowerCase().trim()).filter(Boolean),
    ));
    const seedSet = new Set(seedNames);
    const effectiveSeedGender: 'men' | 'women' | 'unisex' =
      look.gender === 'unisex' && ymalGenderFilter !== 'all' ? ymalGenderFilter : look.gender;
    const minMatches = Math.max(1, Math.ceil(seedSet.size * lookSimilarityThreshold / 100));

    const scored = source.map(l => {
      const matchCount = (l.products || []).filter(p => seedSet.has(p.name.toLowerCase().trim())).length;
      const genderOk = effectiveSeedGender === 'unisex' || l.gender === 'unisex' || effectiveSeedGender === l.gender;
      const included = seedSet.size > 0 && genderOk && matchCount >= minMatches;
      return { l, matchCount, genderOk, included };
    });
    // Show every look that shares ≥1 product (the interesting set), included first.
    const relevant = scored
      .filter(s => s.matchCount > 0)
      .sort((a, b) => (Number(b.included) - Number(a.included)) || (b.matchCount - a.matchCount));
    const includedCount = scored.filter(s => s.included).length;

    const report: SimilarDebugReport = {
      title: 'Similar looks — shared products',
      subtitle: `Seed look #${look.id}${look.creatorDisplayName ? ` · ${look.creatorDisplayName}` : ''}`,
      badges: [
        { label: 'dial', value: String(lookSimilarityThreshold), tone: 'accent' },
        { label: 'seed products', value: String(seedSet.size) },
        { label: 'min matches', value: String(minMatches), tone: 'bad' },
        { label: 'gender', value: effectiveSeedGender },
        { label: 'candidates', value: String(source.length) },
        { label: 'shown', value: String(includedCount), tone: 'good' },
      ],
      sections: [
        {
          heading: 'How it’s fetched',
          lines: [
            'Source: the in-memory looks dataset (no RPC) — every loaded look except this one and the legacy seed creators (@lilywittman, @garrett).',
            'No embeddings here: looks are matched purely by the product names they contain.',
          ],
        },
        {
          heading: 'The logic (gates)',
          lines: [
            `1. Gender — seed is "${look.gender}"${look.gender === 'unisex' ? `, resolved to "${effectiveSeedGender}" via the shopper filter` : ''}. A candidate passes if either side is unisex or both match.`,
            `2. Shared products — the candidate must contain at least minMatches of the seed’s ${seedSet.size} product name(s).`,
            'Name match is exact (lowercased/trimmed) — "same hat" means the identical product, not just the same category.',
          ],
        },
        {
          heading: 'How it calculated this rail',
          lines: [
            `minMatches = max(1, ceil(${seedSet.size} seed products × dial ${lookSimilarityThreshold}/100)) = ${minMatches}.`,
            `Seed products: ${seedNames.length ? seedNames.join(', ') : '(none — rail stays empty)'}.`,
            `${includedCount} look(s) cleared both gates and feed the rail (capped at the section limit).`,
          ],
        },
      ],
      columns: [
        { key: 'id', label: 'Look' },
        { key: 'creator', label: 'Creator' },
        { key: 'matches', label: 'Matches', align: 'right' },
        { key: 'gender', label: 'Gender' },
        { key: 'verdict', label: 'Verdict' },
      ],
      rows: relevant.map(s => ({
        id: String(s.l.id),
        included: s.included,
        cells: {
          id: { text: `#${s.l.id}`, tone: 'muted' },
          creator: { text: s.l.creatorDisplayName || s.l.creator || '—' },
          matches: { text: `${s.matchCount}/${minMatches}`, tone: s.matchCount >= minMatches ? 'good' : 'muted' },
          gender: { text: s.l.gender, tone: s.genderOk ? undefined : 'bad' },
          verdict: s.included
            ? { text: 'shown', tone: 'good' }
            : !s.genderOk
              ? { text: 'cut · gender', tone: 'bad' }
              : { text: 'cut · too few matches', tone: 'muted' },
        },
      })),
      footnote: relevant.length > includedCount
        ? `Rows below the shown set share a product but fell short of the gates. Looks with 0 shared products are omitted from this table.`
        : undefined,
    };
    setSimDebug({ open: true, report });
  }, [look, allLooks, ymalGenderFilter, lookSimilarityThreshold]);

  // About-tab strip: all looks by this creator (including current look when
  // there are no others). Falls back to similar looks so the strip always
  // has something to show.
  // Synthetic negative IDs prevent TrailVideoHost trailId conflicts with the
  // always-rendered moreFromCreator feed section below the hero. Without this,
  // mounting the About strip steals the shared <video> element from the feed
  // cards (same look.id → same lookTrailId → same TrailVideoHost key), making
  // the Popular/moreFromCreator sections go black when the About tab is active.
  const aboutCreatorStrip = useMemo(() => {
    const all = allLooks || allLooksData;
    // Match creator by key AND display name. See feedSections.sameCreator
    // for why — different personas can share the same user:<uuid> key.
    const sameCreator = (l: Look) =>
      l.creator === look.creator &&
      (l.creatorDisplayName || '') === (look.creatorDisplayName || '');
    const byCreator = look.creator
      ? all.filter(l => sameCreator(l) && l.id !== look.id)
      : [];
    const source = byCreator;
    return source.slice(0, Math.max(1, moreFromCreatorLimit)).map((l, i) => ({
      ...l,
      // Use a unique synthetic ID so TrailVideoHost creates a separate
      // <video> element for the about strip vs the feed section cards.
      id: -(Math.abs(l.id) * 1000 + i + 1),
    }));
  }, [look.id, look.creator, look.creatorDisplayName, allLooks, moreFromCreatorLimit]);

  // ── You Might Also Like ─────────────────────────────────────────────────────
  // Reuses the home/feed ContinuousFeed component (gender-aware, autoplay,
  // infinite scroll). ymalGenderFilter is already declared above (before feedSections).

  // While this overlay is open, suspend the home feed's video playback in
  // the director. The feed stays mounted+blurred behind us; without this it
  // keeps decoding dozens of clips under the blur layer, forcing the
  // compositor to re-rasterize the blur every frame. Scope matches the
  // slotPrefix on our nested "You might also like" feed (`look:<id>`), so
  // that feed still plays while the background is paused.
  useEffect(() => {
    const scope = `look:${look.id}`;
    director.pushScope(scope);
    return () => director.popScope(scope);
  }, [look.id]);

  // Trigger enter animation after first paint
  useEffect(() => {
    requestAnimationFrame(() => setMounted(true));
  }, []);

  const scrollMoreLeft = () => {
    moreScrollRef.current?.scrollBy({ left: -240, behavior: 'smooth' });
  };
  const scrollMoreRight = () => {
    moreScrollRef.current?.scrollBy({ left: 240, behavior: 'smooth' });
  };

  // Reset scroll to top when look changes
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    setActiveTab('products');
    setLookBookmarked(bookmarks.isLookBookmarked(look.id));
    setProductBookmarks(look.products.map(p => bookmarks.isProductBookmarked(p)));
    // Fetch save count when look has a Supabase UUID
    setSaveCount(null);
    if (look.uuid) {
      getLookSaveCount(look.uuid).then(setSaveCount);
    }
  }, [look.id]);

  useEscapeKey(() => handleClose());

  const handleClose = useCallback(() => {
    setIsAnimatingOut(true);
    setTimeout(onClose, 320);
  }, [onClose]);

  // Swipe-down to dismiss (mobile handle area)
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    setTouchStartY(e.touches[0].clientY);
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    const dy = e.touches[0].clientY - touchStartY;
    if (dy > 0) setTranslateY(dy);
  }, [touchStartY]);

  const handleTouchEnd = useCallback(() => {
    dragActiveRef.current = false;
    if (translateY > 100) {
      handleClose();
    } else {
      setTranslateY(0);
    }
  }, [translateY, handleClose]);

  // Column-scoped swipe-down: only arms when the info column is already
  // scrolled to its top, so a normal vertical scroll inside content
  // never gets hijacked into a dismiss-pull. Mirrors how ProductPage
  // handles its own pull-to-close.
  const handleColumnTouchStart = useCallback((e: React.TouchEvent) => {
    const atTop = (infoColRef.current?.scrollTop ?? 0) <= 0;
    dragActiveRef.current = atTop;
    if (atTop) setTouchStartY(e.touches[0].clientY);
  }, []);
  const handleColumnTouchMove = useCallback((e: React.TouchEvent) => {
    if (!dragActiveRef.current) return;
    const dy = e.touches[0].clientY - touchStartY;
    // Upward swipe → cede control back to native scroll.
    if (dy <= 0) { dragActiveRef.current = false; setTranslateY(0); return; }
    setTranslateY(dy);
  }, [touchStartY]);

  const handleToggleLookBookmark = () => {
    const wasBookmarked = lookBookmarked;
    bookmarks.toggleLookBookmark(look.id);
    setLookBookmarked(b => !b);
    // Sync to Supabase and update the displayed count
    if (look.uuid) {
      if (wasBookmarked) {
        recordLookUnsave(look.uuid);
        setSaveCount(c => (c !== null && c > 0 ? c - 1 : c));
      } else {
        recordLookSave(look.uuid);
        setSaveCount(c => (c !== null ? c + 1 : 1));
      }
    }
  };

  const handleToggleProductBookmark = (index: number) => {
    bookmarks.toggleProductBookmark(look.products[index]);
    setProductBookmarks(prev => {
      const next = [...prev];
      next[index] = !next[index];
      return next;
    });
  };

  const handleProductClick = (p: Product) => {
    if (onOpenProduct) onOpenProduct(p);
    else if (p.url) onOpenBrowser(p.url, p.name);
  };

  const handleFeedLookClick = useCallback((feedLook: Look) => {
    if (onOpenLook) {
      onOpenLook(feedLook);
    }
  }, [onOpenLook]);

  const panelStyle: React.CSSProperties = translateY > 0
    ? { transform: `translateY(${translateY}px)`, transition: 'none' }
    : {};

  return (
    <div
      ref={overlayRef}
      className={`look-overlay${mounted && !isAnimatingOut ? ' look-overlay--in' : ''}${isAnimatingOut ? ' look-overlay--out' : ''}`}
    >
      <div className="look-overlay-scroll" ref={setScrollRef}>
        {/* ═══ HERO: 60/40 split (first viewport) ═══ */}
        <div className="look-hero-section">
          {/* ── LEFT: Media area (60%) ── */}
          <div className="look-media-col">
            {/* Back button - top-left of the screen (desktop) */}
            <button className="look-back-btn" onClick={handleClose} aria-label="Back">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6"/>
              </svg>
            </button>

            {/* Side-rail back button — vertically centered on the left edge
                of the browser, desktop only. Fades in once the user has
                scrolled past the hero (corner button is off-screen). */}
            <button
              className={`look-back-rail${showSideBack ? ' is-visible' : ''}`}
              onClick={handleClose}
              aria-label="Back"
              tabIndex={showSideBack ? 0 : -1}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6"/>
              </svg>
            </button>

            {/* Mobile-only: dismiss + bookmark overlaid on top of the video.
                The chevron points DOWN (instead of left/back) since the
                overlay also dismisses with a swipe-down — the icon
                reinforces the same gesture. */}
            <div className="look-video-overlay-btns">
              <button className="look-video-back-btn" onClick={handleClose} aria-label="Close">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="6 9 12 15 18 9"/>
                </svg>
              </button>
              <button
                className={`look-video-bookmark-btn${lookBookmarked ? ' active' : ''}`}
                onClick={handleToggleLookBookmark}
                aria-label="Bookmark look"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill={lookBookmarked ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
                </svg>
              </button>
            </div>

            {/* Centered video with overlays */}
            {videoEnabled && (
            <div className="look-media-centered">
              <div className="look-media">
                {/* Phase 9 instant poster: paints synchronously on mount
                    using either the canvas-frame stashed by the tapped
                    LookCard or the static thumbnail. The trail-host
                    attaches its <video> on top in the same paint cycle,
                    so the user sees a real frame immediately - never the
                    black flash that used to bridge the card → hero gap. */}
                {heroPoster && (
                  <img
                    src={heroPoster}
                    alt=""
                    aria-hidden="true"
                    className="look-media-handoff-poster"
                    style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', zIndex: 0 }}
                  />
                )}
                {/* Shared video slot - TrailVideoHost moves the running
                    <video> from the originating LookCard into this
                    element on tap, so playback continues unbroken across
                    the navigation. */}
                <div
                  ref={setHeroSlot}
                  className="look-media-video"
                  data-trail-id={trailId}
                  style={{ position: 'relative', zIndex: 1 }}
                />
                {/* Bottom-left: creator avatar + name */}
                <button
                  className="overlay-video-creator"
                  onClick={() => { handleClose(); onOpenCreator(look.creator); }}
                  aria-label={`View ${creatorData?.displayName || look.creator}`}
                >
                  {(creatorData?.avatar || look.creatorAvatar) ? (
                    <img
                      className="overlay-video-creator__avatar"
                      src={creatorData?.avatar || look.creatorAvatar}
                      alt={creatorData?.displayName || look.creator}
                    />
                  ) : (
                    <span className="overlay-video-creator__avatar overlay-video-creator__avatar--initial">
                      {(creatorData?.displayName || look.creatorDisplayName || look.creator || '?').charAt(0).toUpperCase()}
                    </span>
                  )}
                  <span className="overlay-video-creator__name">
                    {creatorData?.displayName
                      || look.creatorDisplayName
                      || (look.creator?.startsWith('user:') ? 'User' : look.creator)}
                  </span>
                </button>

                {/* Bottom-right: product count badge */}
                <div className="hotspot-indicator">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/>
                    <line x1="3" y1="6" x2="21" y2="6"/>
                    <path d="M16 10a4 4 0 01-8 0"/>
                  </svg>
                  <span>{look.products.length}</span>
                </div>
              </div>
            </div>
            )}
          </div>

          {/* ── RIGHT: Info panel (40%) ── */}
          {/* Mobile parity with ProductPage: the whole info column accepts
              the swipe-down dismiss, but ONLY when the column is already
              scrolled to the top — otherwise a normal downward scroll
              would drag the panel instead of scrolling content. */}
          <div
            ref={infoColRef}
            className="look-info-col"
            style={panelStyle}
            onTouchStart={handleColumnTouchStart}
            onTouchMove={handleColumnTouchMove}
            onTouchEnd={handleTouchEnd}
          >
            {/* Mobile-only: drag handle (visual affordance for the
                gesture the whole column accepts at scroll-top). */}
            <div
              className="look-drag-strip"
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
            >
              <span className="look-drag-pill" />
            </div>

            {/* Desktop-only top bar: bookmark button. On mobile these move
                to look-video-overlay-btns on top of the video. */}
            <div className="look-info-topbar">
              <button className="look-back-btn-mobile" onClick={handleClose} aria-label="Close">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="6 9 12 15 18 9"/>
                </svg>
              </button>
              <button
                className={`look-bookmark-btn${lookBookmarked ? ' active' : ''}`}
                onClick={handleToggleLookBookmark}
                aria-label="Bookmark look"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill={lookBookmarked ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
                </svg>
              </button>
            </div>

            {/* Creator row — prefer the static-seed creator entry if
                this look is from a hardcoded handle (@lilywittman etc.),
                otherwise fall back to the per-look fields that
                services/looks.ts populates from the publisher's profile
                (creatorAvatar + creatorDisplayName). Without these
                fallbacks user-published looks render as a blank avatar
                + literal "Creator" placeholder. */}
            {creatorChipEnabled && (
            <div
              className="look-creator-row"
              onClick={() => { handleClose(); onOpenCreator(look.creator); }}
            >
              {(() => {
                const avatar = creatorData?.avatar || look.creatorAvatar || '';
                const name =
                  creatorData?.displayName ||
                  look.creatorDisplayName ||
                  (showHandle ? look.creator : 'Creator');
                return avatar ? (
                  <img className="detail-creator-avatar" src={avatar} alt={name} />
                ) : (
                  <span className="detail-creator-avatar detail-creator-avatar--initial" aria-hidden="true">
                    {(name || '?').charAt(0).toUpperCase()}
                  </span>
                );
              })()}
              {/* Creator name is intentionally not duplicated here —
                  the chip overlay on the video card already shows
                  the creator and the look title below (e.g.
                  "Amir Malaklou's studio look") repeats it. Without
                  this guard the same name read three times on the
                  surface. Handle stays visible because it's the
                  /c/<handle> link affordance. */}
              {showHandle && (
                <div className="look-creator-text">
                  <span className="look-creator-handle">
                    {look.creator.startsWith('@') ? look.creator : `@${look.creator}`}
                  </span>
                </div>
              )}
              <FollowIconButton
                handle={look.creator}
                size={22}
                style={{
                  marginLeft: 'auto',
                  borderColor: 'rgba(0,0,0,0.55)',
                  color: '#0f172a',
                  background: 'transparent',
                }}
              />
            </div>
            )}

            {/* Look title removed — the creator chip + avatar already
                identify ownership; the named title (e.g. "Robert
                Burton's beach look") read as redundant chrome. */}

            {/* Save count */}
            {look.uuid && saveCount !== null && saveCount > 0 && (
              <div className="look-save-count">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                  <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
                </svg>
                <span>{saveCount.toLocaleString()} {saveCount === 1 ? 'save' : 'saves'}</span>
              </div>
            )}

            {/* Tabs */}
            {tabsEnabled && (
            <div className="look-tabs">
              <button
                className={`look-tab${activeTab === 'products' ? ' active' : ''}`}
                onClick={() => setActiveTab('products')}
              >
                Products
                <span className="look-tab-count">{look.products.length}</span>
              </button>
              <button
                className={`look-tab${activeTab === 'creator' ? ' active' : ''}`}
                onClick={() => setActiveTab('creator')}
              >
                About
              </button>
            </div>
            )}

            {/* Tab content */}
            <div className="look-tab-content">
              {activeTab === 'products' && (
                <div className="look-products-list">
                  {productsEnabled && shopperBody.heightCm && (
                    <SizeMatchSummary products={look.products} body={shopperBody} />
                  )}
                  {productsEnabled && sortByGarmentRole(look.products).map((p, pi) => (
                    <div key={pi} className="product-card" onClick={() => handleProductClick(p)}>
                      <div className="product-card-thumb">
                        {p.image
                          ? <img src={supabaseImage(p.image, { width: 240, quality: 70 })} alt={p.name} className="product-thumb-img" loading="lazy" decoding="async" />
                          : <div className="product-thumb-placeholder" style={{ background: look.color, opacity: 0.5 }} />
                        }
                      </div>
                      <div className="product-card-info">
                        {p.brand && <span className="product-brand">{p.brand}</span>}
                        <span className="product-card-name">{p.name}</span>
                        <span className="product-card-price">{p.price}</span>
                        {shopperBody.heightCm && <SizeMatchBadge product={p} body={shopperBody} />}
                      </div>
                      <button
                        className={`product-bookmark-btn${productBookmarks[pi] ? ' active' : ''}`}
                        onClick={(e) => { e.stopPropagation(); handleToggleProductBookmark(pi); }}
                        aria-label="Bookmark product"
                      >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill={productBookmarks[pi] ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
                        </svg>
                      </button>
                      <svg className="product-arrow" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="9 18 15 12 9 6"/>
                      </svg>
                    </div>
                  ))}
                </div>
              )}

              {/* "More from this creator" no longer lives up here as a
                  horizontal strip — it renders below as a 2-column grid
                  AFTER "More like this" / "Popular" (see the feed sections). */}

              {activeTab === 'creator' && (
                <>
                  <div className="look-creator-about">
                    <div className="look-creator-about-header">
                      {(() => {
                        const avatar = creatorData?.avatar || look.creatorAvatar || '';
                        const name =
                          creatorData?.displayName ||
                          look.creatorDisplayName ||
                          (showHandle ? look.creator : 'Creator');
                        return avatar ? (
                          <img className="look-creator-about-avatar" src={avatar} alt={name} />
                        ) : (
                          <span className="look-creator-about-avatar look-creator-about-avatar--initial" aria-hidden="true">
                            {(name || '?').charAt(0).toUpperCase()}
                          </span>
                        );
                      })()}
                      <div>
                        <div className="look-creator-about-name">
                          {creatorData?.displayName || look.creatorDisplayName || (showHandle ? look.creator : 'Creator')}
                        </div>
                        {showHandle && (
                          <div className="look-creator-about-handle">
                            {look.creator.startsWith('@') ? look.creator : `@${look.creator}`}
                          </div>
                        )}
                      </div>
                    </div>
                    {creatorData?.bio && (
                      <p className="look-creator-about-bio">{creatorData.bio}</p>
                    )}
                    <button
                      className="look-creator-about-btn"
                      onClick={() => { handleClose(); onOpenCreator(look.creator); }}
                    >
                      View all looks
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="9 18 15 12 9 6"/>
                      </svg>
                    </button>
                  </div>

                  {aboutCreatorStrip.length > 0 && (
                    <div className="look-creator-more-section">
                      <h3 className="look-feed-heading">More looks</h3>
                      <div className="look-creator-more-scroll-wrap">
                        <button className="look-scroll-arrow look-scroll-arrow--left" onClick={scrollMoreLeft} aria-label="Scroll left">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
                        </button>
                        <div className="look-creator-more-scroll" ref={moreScrollRef}>
                          {aboutCreatorStrip.map(fl => (
                            <LookCard
                              key={`about-creator-${fl.id}`}
                              look={fl}
                              className="look-card"
                              onOpenLook={fl.id !== look.id ? handleFeedLookClick : (() => {})}
                              onOpenCreator={onOpenCreator}
                              onCreateCatalog={onCreateCatalog}
                            />
                          ))}
                        </div>
                        <button className="look-scroll-arrow look-scroll-arrow--right" onClick={scrollMoreRight} aria-label="Scroll right">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        {/* ═══ FEED: ProductPage-style stacked sections below the hero ═══ */}
        {/* "Similar looks" section — admin-controllable via /admin/pages
            (page=looks, key=similar). Shows garment-matched looks, with a
            Popular fallback when nothing matches. */}
        {similarEnabled && feedSections.looksLikeThis.length > 0 && (
          <div className="look-feed-section">
            <h3 className="look-feed-heading">
              More like this
              {isSuperAdmin && (
                <button
                  type="button"
                  className="sim-debug-btn"
                  onClick={openSimilarLooksDebug}
                  aria-label="Why these? (super-admin debug)"
                  title="Why these? (super-admin debug)"
                >
                  ⓘ why
                </button>
              )}
            </h3>
            <div className="look-feed-grid">
              {feedSections.looksLikeThis.slice(0, similarLimit).map(fl => (
                <LookCard
                  key={`like-${fl.id}`}
                  look={fl}
                  className="look-card"
                  onOpenLook={handleFeedLookClick}
                  onOpenCreator={onOpenCreator}
                  onCreateCatalog={onCreateCatalog}
                />
              ))}
            </div>
          </div>
        )}

        {similarEnabled && feedSections.popular.length > 0 && (
          <div className="look-feed-section">
            <h3 className="look-feed-heading">Popular</h3>
            <div className="look-feed-grid">
              {feedSections.popular.slice(0, similarLimit).map(fl => (
                <LookCard
                  key={`popular-${fl.id}`}
                  look={fl}
                  className="look-card"
                  onOpenLook={handleFeedLookClick}
                  onOpenCreator={onOpenCreator}
                  onCreateCatalog={onCreateCatalog}
                />
              ))}
            </div>
          </div>
        )}

        {/* "More from this creator" — same 2-column grid as the sections
            above, placed AFTER "More like this" / "Popular" so the look's
            own products and similar looks come first. Skips the seed look
            itself. */}
        {moreFromCreatorEnabled && aboutCreatorStrip.filter(fl => fl.id !== look.id).length > 0 && (
          <div className="look-feed-section">
            <h3 className="look-feed-heading">More from this creator</h3>
            <div className="look-feed-grid">
              {aboutCreatorStrip
                .filter(fl => fl.id !== look.id)
                .slice(0, moreFromCreatorLimit)
                .map(fl => (
                  <LookCard
                    key={`creator-more-${fl.id}`}
                    look={fl}
                    className="look-card"
                    onOpenLook={handleFeedLookClick}
                    onOpenCreator={onOpenCreator}
                    onCreateCatalog={onCreateCatalog}
                  />
                ))}
            </div>
          </div>
        )}

        <div className="look-feed-section">
          <h3 className="look-feed-heading">You might also like</h3>
          <ContinuousFeed
            nested
            slotPrefix={`look:${look.id}`}
            scrollRoot={scrollEl}
            activeFilter={ymalGenderFilter}
            searchQuery=""
            shuffleKey={0}
            layoutMode={0}
            onOpenLook={handleFeedLookClick}
            onOpenCreator={onOpenCreator}
            onOpenBrowser={(url, title) => onOpenBrowser(url, title)}
            onOpenProduct={onOpenProduct}
            onOpenCreative={onOpenCreative}
            onCreateCatalog={onCreateCatalog}
            bookmarks={bookmarks}
          />
        </div>
      </div>
      {simDebug.open && (
        <SimilarDebugModal
          report={simDebug.report}
          onClose={() => setSimDebug({ open: false, report: null })}
        />
      )}
    </div>
  );
}
