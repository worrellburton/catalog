
import { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import { Look, creators, Product, looks as allLooksData } from '~/data/looks';
import { lookSlug } from '~/utils/slug';
import { shareLink } from '~/utils/shareLink';
import { getCommentCount } from '~/services/comments';
import { getCreatorAbout } from '~/services/creator-about';
import { getLookDescription } from '~/services/look-description';
import { lookPoster, productPoster } from '~/services/media-resolver';
import { emitSavedToast } from '~/utils/savedToast';
import { useCommentsEnabled } from '~/hooks/useCommentsEnabled';
import { useEscapeKey } from '~/hooks/useEscapeKey';
import CreativeCardV2 from './CreativeCardV2';
import { sortByGarmentRole } from '~/utils/garmentOrder';
import ContinuousFeed from './ContinuousFeed';
import { useActiveGenderFilter } from '~/hooks/useActiveGenderFilter';
import { useTrailVideo, useTrailVideoManager } from './TrailVideoHost';
import { lookTrailId, normalizeLookVideoUrl } from '~/utils/trailIds';
import ProductMiniMedia from './ProductMiniMedia';
import ParticleBackground from './ParticleBackground';
import { director } from '~/services/video-playback-director';
import CreatorAvatarFollow from './CreatorAvatarFollow';
import { getLookSaveCount, recordLookSave, recordLookUnsave } from '~/services/look-saves';
import { type ProductAd } from '~/services/product-creative';
import {
  prefetchVideoBytes,
  isMobileViewport,
  isSlowConnection,
} from '~/services/video-loading';
import { useVideoPipelineMode } from '~/hooks/useVideoPipeline';
import { useAuth } from '~/hooks/useAuth';
import { useShopperBody } from '~/hooks/useShopperBody';
import { usePageSections, isSectionEnabled, getSectionLimit } from '~/hooks/usePageSections';
import SizeMatchBadge, { SizeMatchSummary } from './SizeMatchBadge';
import { getLookSimilarityThreshold, DEFAULT_LOOK_SIMILARITY } from '~/services/dials';
import SimilarDebugModal, { type SimilarDebugReport } from './SimilarDebugModal';
import '~/styles/product-page.css';

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
  /** Opens the comment thread as an in-app overlay. */
  onOpenComments?: (type: 'product' | 'look', slug: string) => void;
}

export default function LookOverlay({ look, onClose, onOpenCreator, onOpenBrowser, onOpenProduct, onCreateCatalog, onOpenLook, bookmarks, allLooks, popularFallback, onOpenCreative, onOpenComments }: LookOverlayProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const moreScrollRef = useRef<HTMLDivElement>(null);
  // Tracked separately so the nested feed re-binds its IntersectionObserver
  // root once the scroller mounts (refs alone don't trigger re-renders).
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  const setScrollRef = useCallback((el: HTMLDivElement | null) => {
    scrollRef.current = el;
    setScrollEl(el);
  }, []);
  const [mounted, setMounted] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>('products');
  // "View more info" disclosure (replaced the old About tab).
  const [showLookInfo, setShowLookInfo] = useState(false);
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
  const [isAnimatingOut, setIsAnimatingOut] = useState(false);
  const [lookBookmarked, setLookBookmarked] = useState(bookmarks.isLookBookmarked(look.id));

  const { user } = useAuth();
  const shopperBody = useShopperBody(user?.id);

  // Comments — gated by the platform dial. Deep-links to the thread page
  // keyed by this look's shareable slug.
  const commentsEnabled = useCommentsEnabled();
  const commentSlug = useMemo(
    () => lookSlug({
      id: look.id ?? null,
      uuid: look.uuid ?? null,
      creator: look.creator ?? null,
      creatorDisplayName: look.creatorDisplayName ?? null,
      title: look.title ?? null,
    }),
    [look],
  );

  // Comment count for the red bubble on the comments FAB.
  const [commentCount, setCommentCount] = useState<number | null>(null);
  useEffect(() => {
    if (!commentsEnabled || !commentSlug) { setCommentCount(null); return; }
    let cancelled = false;
    getCommentCount('look', commentSlug).then(n => { if (!cancelled) setCommentCount(n); });
    return () => { cancelled = true; };
  }, [commentsEnabled, commentSlug]);

  // Share — upper-right, symmetric with the product page. Shares the look's
  // canonical /l/<slug> URL; flashes a check on clipboard fallback.
  const [shareFlash, setShareFlash] = useState(false);
  const handleShareLook = useCallback(async () => {
    if (!commentSlug) return;
    const url = `${typeof window !== 'undefined' ? window.location.origin : ''}/l/${commentSlug}`;
    const result = await shareLink({ url, title: look.title || 'Catalog look' });
    if (result === 'copied') { setShareFlash(true); window.setTimeout(() => setShareFlash(false), 1600); }
  }, [commentSlug, look.title]);
  // Admin-editable section config from /admin/pages. null until loaded;
  // isSectionEnabled treats null as "enabled" so first paint isn't blank.
  const pageSections = usePageSections('looks');
  const videoEnabled       = isSectionEnabled(pageSections, 'video');
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
  // HLS manifest wins when the pipeline dial is on 'hls' and one exists — the
  // SAME source LookCard plays, so the pooled <video> hands off into the hero
  // with no src swap, and ABR ramps to a high rung now that the element fills
  // the screen. Progressive mobile/full split is the fallback when there's no
  // manifest yet, and the ONLY path in 'mp4' mode (must match LookCard's pick
  // exactly or the handoff re-buffers).
  const pipelineMode = useVideoPipelineMode();
  const activeHlsUrl = pipelineMode === 'hls' ? look.hls_url : undefined;
  const heroVideoUrl = activeHlsUrl || (wantMobile && look.mobile_video_url ? look.mobile_video_url : fullVideoUrl);

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
  // Canonical look poster (services/media-resolver) — same chain the feed card
  // uses, so the hero never opens to a different (or black) still than the card
  // that launched it. tapHandoffPoster is the exact frame captured on tap.
  const heroPoster = tapHandoffPoster || lookPoster(look);

  // Take ownership of the same shared <video> element the originating
  // LookCard was playing. appendChild moves the DOM node - currentTime,
  // decoded frames, and audio context all survive, so the morph from card
  // → hero never reloads or shows a black gap. Pass the poster so a cold
  // path (pool element evicted between card unmount and hero attach) still
  // paints a real image.
  const setHeroSlot = useTrailVideo(trailId, heroVideoUrl, heroPoster || undefined);
  // Container ref alongside the trail attach, so close can read the hero's
  // <video> for the reverse frame handoff.
  const heroHostRef = useRef<HTMLElement | null>(null);
  const setHeroSlotRef = useCallback((node: HTMLElement | null) => {
    heroHostRef.current = node;
    setHeroSlot(node);
  }, [setHeroSlot]);

  // Phase 8 — kick off a high-res prefetch on overlay mount in case the
  // card-side preload didn't run (e.g. user opened the overlay from a
  // route that never mounted the LookCard, or the card had been out of
  // the render band). Idempotent by URL so calling twice is free when
  // the cache is already warm.
  useEffect(() => {
    // HLS streams its own segments via hls.js — skip the full-file byte
    // prewarm (it would fetch an MP4 the hero won't play). In 'mp4' pipeline
    // mode activeHlsUrl is undefined, so the byte prewarm always runs.
    if (activeHlsUrl) return;
    if (heroVideoUrl) prefetchVideoBytes(heroVideoUrl);
    if (fullVideoUrl && fullVideoUrl !== heroVideoUrl) prefetchVideoBytes(fullVideoUrl);
  }, [heroVideoUrl, fullVideoUrl, activeHlsUrl]);

  // Pause background feed cards while the overlay is open so they don't
  // compete for bandwidth with the hero video. Resume on unmount.
  const trailMgr = useTrailVideoManager();
  useEffect(() => {
    trailMgr?.suspendFeed(trailId);
    // Reclaim decoders held by the now-covered feed's parked clips.
    trailMgr?.pruneIdle();
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
  //   2. "More from <creator>" — other looks by the same creator
  // Each section is capped at 8; padding with cycled duplicates fills short lists.
  const feedSections = useMemo(() => {
    // Filter out the legacy static-seed creators (@lilywittman /
    // @garrett) — they have placeholder gradient thumbnails with no
    // real videos, so they read as "looks that don't exist" in the
    // More-from / similar sections. Live looks only.
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
    const c = dedupe(moreFromCreator);

    return {
      looksLikeThis:   fillLooks(a, 8),
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

  // AI "about" blurb for the creator — cache-first, generated on demand for
  // signed-in viewers. Only fetched when the About tab is open and there's
  // no hand-written bio to show instead.
  // Per-look description — UNIQUE to this look, generated by Gemini from the
  // look's poster frame + the products in it (services/look-description). This
  // is the primary blurb; it replaces the generic creator-level "about" summary
  // that made every look under one creator read identically. Cache-first, so
  // logged-out viewers get the cached copy and signed-in viewers generate one
  // on demand.
  const [lookDescription, setLookDescription] = useState<string | null>(null);
  useEffect(() => {
    if (!look.uuid) { setLookDescription(null); return; }
    let cancelled = false;
    setLookDescription(null);
    const products = (look.products || []).slice(0, 12).map(p => ({
      brand: p.brand,
      name: p.name,
      type: p.subtype || p.type,
      price: p.price,
    }));
    getLookDescription({
      lookId: look.uuid,
      title: look.title,
      imageUrl: look.thumbnail_url || look.cover || '',
      products,
    }).then(d => { if (!cancelled) setLookDescription(d); });
    return () => { cancelled = true; };
  }, [look.uuid]);

  const [aboutSummary, setAboutSummary] = useState<string | null>(null);
  useEffect(() => {
    if (creatorData?.bio || !look.creator) return;
    let cancelled = false;
    const creatorLooks = [look, ...aboutCreatorStrip];
    const payload = creatorLooks.slice(0, 40).map(l => ({
      title: l.title,
      brands: (l.products || []).map(p => p.brand).filter(Boolean),
      types: (l.products || []).map(p => p.subtype || p.type).filter((t): t is string => !!t),
    }));
    const name = creatorData?.displayName || look.creatorDisplayName || look.creator;
    getCreatorAbout(look.creator, name, payload).then(s => { if (!cancelled) setAboutSummary(s); });
    return () => { cancelled = true; };
  }, [look, aboutCreatorStrip, creatorData?.bio, creatorData?.displayName]);

  // ── You Might Also Like ─────────────────────────────────────────────────────
  // Reuses the home/feed ContinuousFeed component (gender-aware, autoplay,
  // infinite scroll). ymalGenderFilter is already declared above (before feedSections).

  // Director scope key for this overlay — shared by the suspend effect below
  // and handleClose (which flags it exiting so the feed re-warms during the
  // close slide). Matches the slotPrefix on the nested "You might also like"
  // feed (`look:<id>`).
  const directorScope = `look:${look.id}`;

  // While this overlay is open, suspend the home feed's video playback in
  // the director. The feed stays mounted+blurred behind us; without this it
  // keeps decoding dozens of clips under the blur layer, forcing the
  // compositor to re-rasterize the blur every frame. Scope matches the
  // slotPrefix on our nested "You might also like" feed (`look:<id>`), so
  // that feed still plays while the background is paused.
  useEffect(() => {
    director.pushScope(directorScope);
    return () => director.popScope(directorScope);
  }, [directorScope]);

  // Mark mounted on first paint so --in-keyed rules apply (e.g. the mobile
  // .look-info-col transform reset). The overlay opens instantly — there's
  // no enter animation; only the swipe-down dismiss animates.
  useEffect(() => {
    const raf = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(raf);
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
    // Reverse handoff: pin the hero's exact frame onto the source card and
    // seek the card's element to match, so the grid resumes where the
    // overlay left off instead of restarting the clip.
    director.syncFromTrailReturn(trailId, heroHostRef.current?.querySelector('video') ?? null);
    // Flag the scope exiting NOW (gesture start), not on unmount 360 ms later:
    // the background feed re-acquires + decodes its videos under cover of the
    // slide-out so it's already playing when the overlay clears — no dead feed
    // on back. The pushScope effect's cleanup still pops the scope on unmount.
    director.beginScopeExit(directorScope);
    setIsAnimatingOut(true);
    setTimeout(onClose, 360);
  }, [onClose, directorScope]);

  // Mobile drag-to-dismiss on the WHOLE overlay (not just the info
  // column). The existing onTouchStart/Move/End handlers below only
  // armed on .look-info-col, so swiping down on the video — the
  // dominant mobile surface — did nothing. This effect mirrors the
  // ProductPage approach exactly: attach native listeners to the
  // scroller root, only engage at scrollTop=0, slide the whole
  // overlay's transform, and fire handleClose at the same > 96 px /
  // velocity > 0.6 thresholds. Bails on desktop and ignores any
  // touch starting from an interactive control (so taps still work).
  useEffect(() => {
    const overlay = overlayRef.current;
    const scroller = scrollRef.current;
    if (!overlay || !scroller) return;
    if (typeof window === 'undefined') return;
    if (window.matchMedia('(min-width: 960px)').matches) return;
    const drag = { startY: 0, startTime: 0, active: false };
    const onStart = (e: TouchEvent) => {
      if (scroller.scrollTop > 0) return;
      // Don't hijack drags that start on a button / link / input —
      // the close chevron, bookmark button, product card, etc. all
      // need their tap to land normally.
      const t = e.target as HTMLElement | null;
      if (t && t.closest('button, a, input, textarea, [role="button"]')) return;
      drag.startY = e.touches[0].clientY;
      drag.startTime = performance.now();
      drag.active = true;
    };
    const onMove = (e: TouchEvent) => {
      if (!drag.active) return;
      const dy = e.touches[0].clientY - drag.startY;
      if (dy <= 0) {
        overlay.style.transform = '';
        overlay.classList.remove('is-dragging');
        drag.active = false;
        return;
      }
      overlay.classList.add('is-dragging');
      overlay.style.transform = `translateY(${dy}px)`;
    };
    const onEnd = (e: TouchEvent) => {
      if (!drag.active) return;
      const endY = e.changedTouches[0].clientY;
      const dy = endY - drag.startY;
      const dt = performance.now() - drag.startTime;
      const velocity = dt > 0 ? dy / dt : 0;
      overlay.classList.remove('is-dragging');
      drag.active = false;
      // Require a deliberate downward pull from the top — a casual / quick
      // scroll gesture shouldn't dismiss the look. (Was dy>96 || velocity>0.6,
      // which closed on the first small flick.)
      if (dy > 150 && velocity > 0.25) {
        // Continue smoothly off the bottom from the current drag position
        // (the overlay's transform transition eases the rest) — matches the
        // comments sheet leave; no snap-back-then-down.
        overlay.style.transform = 'translateY(100%)';
        handleClose();
      } else {
        overlay.style.transform = ''; // settle back
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

  // Dismiss-by-drag is handled solely by the whole-overlay gesture (the effect
  // above), which arms ONLY when the scroll container is at the very top
  // (scroller.scrollTop === 0) — so scrolling content never dismisses the look.

  const handleToggleLookBookmark = () => {
    const wasBookmarked = lookBookmarked;
    bookmarks.toggleLookBookmark(look.id);
    setLookBookmarked(b => !b);
    emitSavedToast({
      name: look.title || look.creator || 'this look',
      imageUrl: lookPoster(look),
      saved: !wasBookmarked,
      kind: 'look',
    });
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
    const product = look.products[index];
    const wasBookmarked = !!productBookmarks[index];
    bookmarks.toggleProductBookmark(product);
    setProductBookmarks(prev => {
      const next = [...prev];
      next[index] = !next[index];
      return next;
    });
    emitSavedToast({
      name: product.name || 'this product',
      imageUrl: productPoster(product),
      saved: !wasBookmarked,
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

  return (
    <div
      ref={overlayRef}
      className={`look-overlay${mounted && !isAnimatingOut ? ' look-overlay--in' : ''}${isAnimatingOut ? ' look-overlay--out' : ''}`}
    >
      {/* Ambient particle field on top of the opaque black base — makes
          the page background a live, dynamic surface instead of a flat
          solid. Sits behind all scroll content (z-index 0). */}
      {/* Desktop only: on phones the ambient field is barely visible and a
          second WebGL context competes for the ~16-context cap (evicting the
          app-root singleton) and GPU. The opaque black base reads fine without
          it. A1 already stops this field drawing when opened over the feed
          (paused), so this just spares mobile the context + any hero-opened draw. */}
      <div className="look-overlay-particles" aria-hidden="true">
        {!isMobileViewport() && <ParticleBackground />}
      </div>
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

            {/* Mobile controls overlaid on the video: close (top-left),
                share (top-right), and a bottom-right column with the
                comments bubble above the save button. The product-count
                badge that used to sit bottom-right is gone — Save took
                its place. */}
            <button className="look-video-close" onClick={handleClose} aria-label="Close">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 12 15 18 9"/>
              </svg>
            </button>
            <button
              className={`look-video-share${shareFlash ? ' is-flashed' : ''}`}
              onClick={handleShareLook}
              aria-label="Share look"
              title={shareFlash ? 'Link copied' : 'Share'}
            >
              {shareFlash ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
              )}
            </button>
            <div className="look-video-actions">
              {/* Comments moved off the floating bubble into a labelled
                  button in the info panel (like the product screen). */}
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
                  ref={setHeroSlotRef}
                  className="look-media-video"
                  data-trail-id={trailId}
                  style={{ position: 'relative', zIndex: 1 }}
                />
                {/* Bottom-left: creator identity — avatar circle + follow
                    badge only (no name), the single creator reference on
                    the look (the info-panel duplicate row was removed). */}
                <div className="overlay-video-creator-avatar">
                  <CreatorAvatarFollow
                    handle={look.creator}
                    avatarUrl={look.creatorAvatar || creatorData?.avatar || ''}
                    eager
                    displayName={creatorData?.displayName || look.creatorDisplayName || look.creator}
                    size={46}
                    onOpenCreator={(h) => { handleClose(); onOpenCreator(h); }}
                  />
                  {(creatorData?.displayName || look.creatorDisplayName || (showHandle ? look.creator : '')) && (
                    <button
                      type="button"
                      className="overlay-video-creator-name"
                      onClick={() => { handleClose(); onOpenCreator(look.creator); }}
                    >
                      {creatorData?.displayName || look.creatorDisplayName || look.creator}
                    </button>
                  )}
                </div>
                {/* Product-count badge removed — Save now occupies the
                    bottom-right (see .look-video-actions above). */}
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
            className="look-info-col"
          >
            {/* Mobile-only: drag handle (visual affordance for the
                gesture the whole column accepts at scroll-top). */}
            <div className="look-drag-strip">
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
              <button
                className={`look-comment-btn${shareFlash ? ' is-flashed' : ''}`}
                onClick={handleShareLook}
                aria-label="Share look"
                title={shareFlash ? 'Link copied' : 'Share'}
              >
                {shareFlash ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
                )}
              </button>
            </div>

            {/* Creator row — prefer the static-seed creator entry if
                this look is from a hardcoded handle (@lilywittman etc.),
                otherwise fall back to the per-look fields that
                services/looks.ts populates from the publisher's profile
                (creatorAvatar + creatorDisplayName). Without these
                fallbacks user-published looks render as a blank avatar
                + literal "Creator" placeholder. */}
            {/* Creator row removed — the avatar + follow badge on the video
                (overlay-video-creator-avatar) is now the single creator
                reference, so the @handle row here was a duplicate. */}

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
                        <ProductMiniMedia
                          posterSrc={p.thumbnail_url || p.image}
                          videoSrc={p.video_url}
                          alt={p.name}
                          fallbackColor={look.color}
                        />
                      </div>
                      <div className="product-card-info">
                        {/* Brand + subtype/type chip on the same line so
                            the shopper sees both "ALO YOGA" and the
                            specific shape ("Sandals" / "Sneakers" /
                            etc.) before reading the long product name.
                            Subtype wins when present — it's the more
                            specific signal. */}
                        <span className="product-brand-row">
                          {p.brand && <span className="product-brand">{p.brand}</span>}
                          {(p.subtype || p.type) && (
                            <span className="product-subtype-chip">{p.subtype || p.type}</span>
                          )}
                        </span>
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

              {/* Creator info — always shown (the "View more info" toggle
                  was removed). */}
              <>
                <>
                  <div className="look-creator-about">
                    {/* Creator avatar + name intentionally omitted here — the
                        floating top-left creator badge already shows the
                        identity, so this card stays slim (just the summary +
                        "View all looks"). */}
                    {lookDescription ? (
                      // Unique, image-grounded description for THIS look.
                      <p className="look-creator-about-bio look-creator-about-bio--ai">
                        <span className="look-creator-about-ai-mark" aria-hidden="true">✨</span>
                        {lookDescription}
                      </p>
                    ) : creatorData?.bio ? (
                      <p className="look-creator-about-bio">{creatorData.bio}</p>
                    ) : aboutSummary ? (
                      <p className="look-creator-about-bio look-creator-about-bio--ai">
                        <span className="look-creator-about-ai-mark" aria-hidden="true">✨</span>
                        {aboutSummary}
                      </p>
                    ) : null}
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

                  {/* Comments — glowing, animated button with a live count,
                      sits directly under the (always-shown) creator info. */}
                  {commentsEnabled && commentSlug && onOpenComments && (
                    <button
                      type="button"
                      className="look-comments-labeled"
                      onClick={() => onOpenComments('look', commentSlug)}
                      aria-label="Comments"
                    >
                      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
                      </svg>
                      <span>{commentCount != null ? `Comments ${commentCount > 99 ? '99+' : commentCount}` : 'Comments'}</span>
                    </button>
                  )}
                </>
              </>
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
              {feedSections.looksLikeThis.slice(0, similarLimit).map((fl, i) => (
                <CreativeCardV2
                  key={`like-${fl.id}`}
                  slotId={`${directorScope}:like-${fl.id}`}
                  look={fl}
                  className="look-card"
                  onOpenLook={handleFeedLookClick}
                  onOpenCreator={onOpenCreator}
                  priority={i < 2}
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
                  <CreativeCardV2
                    key={`creator-more-${fl.id}`}
                    slotId={`${directorScope}:creator-more-${fl.id}`}
                    look={fl}
                    className="look-card"
                    onOpenLook={handleFeedLookClick}
                    onOpenCreator={onOpenCreator}
                  />
                ))}
            </div>
          </div>
        )}

        <div className="look-feed-section">
          <h3 className="look-feed-heading">Popular</h3>
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
