
import { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import { Look, creators, Product, looks as allLooksData } from '~/data/looks';
import { useEscapeKey } from '~/hooks/useEscapeKey';
import LookCard from './LookCard';
import { useTrailVideo } from './TrailVideoHost';
import { lookTrailId, normalizeLookVideoUrl } from '~/utils/trailIds';
import { supabaseImage } from '~/utils/supabaseImage';
import { getLookSaveCount, recordLookSave, recordLookUnsave } from '~/services/look-saves';

// ─── Look similarity helpers (module-level, stable references) ──────────────

/** Pads `arr` to exactly `count` items by cycling duplicates, or trims if
 *  longer. Returns empty array unchanged so empty sections stay hidden. */
function fillToExact<T>(arr: T[], count: number): T[] {
  if (arr.length === 0) return [];
  if (arr.length >= count) return arr.slice(0, count);
  const out: T[] = [];
  while (out.length < count) out.push(arr[out.length % arr.length]);
  return out;
}

/**
 * Same as fillToExact but gives each padded Look copy a unique synthetic
 * negative ID so TrailVideoHost creates separate <video> elements per slot.
 * Without this, multiple cards that share the same look.id all compete for
 * the same trailId — only the last-mounted one gets the real <video> node
 * and the rest show a black empty div.
 */
function fillLooks(arr: Look[], count: number): Look[] {
  if (arr.length === 0) return [];
  if (arr.length >= count) return arr.slice(0, count);
  const out: Look[] = [...arr];
  while (out.length < count) {
    const src = arr[out.length % arr.length];
    // Synthetic unique negative ID keeps the video URL / products intact
    // while giving TrailVideoHost a distinct trailId per card position.
    out.push({ ...src, id: -(src.id * 1000 + out.length) });
  }
  return out;
}

/** Canonical product-type groups. A product name that contains any keyword
 *  in a group is classified as that group's canonical type.
 *  Order matters: more specific patterns must come before general ones. */
const PRODUCT_TYPE_GROUPS: readonly [canonical: string, keywords: readonly string[]][] = [
  ['jeans',       ['jeans', 'denim pant', 'denim trouser']],
  ['shorts',      ['shorts', 'short pant', 'breezy short', 'board short', 'swim short']],
  ['pants',       ['pants', 'trousers', 'chinos', 'slacks', 'leggings', 'joggers', 'sweatpants']],
  ['skirt',       ['skirt', 'mini skirt', 'midi skirt', 'maxi skirt']],
  ['dress',       ['dress', 'gown', 'jumpsuit', 'romper']],
  ['top',         ['blouse', 'crop top', 'tank top', 'tube top', 'cami', 'bodysuit']],
  ['tshirt',      ['t-shirt', 'tshirt', 'crew neck', 'crewneck', 'graphic tee', 'tee ']],
  ['shirt',       ['shirt', 'button down', 'button-down', 'oxford', 'flannel shirt']],
  ['sweater',     ['sweater', 'pullover', 'knitwear', 'knit top', 'cardigan']],
  ['hoodie',      ['hoodie', 'sweatshirt', 'hooded']],
  ['jacket',      ['jacket', 'blazer', 'bomber', 'windbreaker', 'parka', 'anorak']],
  ['coat',        ['coat', 'overcoat', 'trench', 'puffer']],
  ['vest',        ['vest', 'waistcoat']],
  ['sneakers',    ['sneaker', 'trainer', 'running shoe', 'athletic shoe']],
  ['shoes',       ['shoe', 'oxford shoe', 'derby', 'loafer', 'mule', 'flat shoe']],
  ['boots',       ['boot', 'ankle boot', 'knee-high', 'chelsea']],
  ['sandals',     ['sandal', 'slide', 'flip flop', 'flip-flop']],
  ['heels',       ['heel', 'pump', 'stiletto', 'wedge']],
  ['bag',         ['bag', 'purse', 'tote', 'backpack', 'clutch', 'handbag', 'shoulder bag', 'crossbody', 'satchel', 'wallet']],
  ['cap',         ['cap', 'hat', 'beanie', 'beret', 'bucket hat', 'snapback', 'baseball']],
  ['sunglasses',  ['sunglasses', 'sunglass', 'shades', 'cat eye', 'aviator']],
  ['glasses',     ['glasses', 'eyewear', 'spectacles']],
  ['watch',       ['watch', 'smartwatch']],
  ['jewelry',     ['necklace', 'bracelet', 'earring', 'ring ', 'pendant', 'anklet', 'jewelry', 'jewellery']],
  ['belt',        ['belt']],
  ['scarf',       ['scarf', 'wrap']],
  ['socks',       ['socks', 'sock ']],
  ['underwear',   ['underwear', 'bra ', 'boxers', 'briefs', 'lingerie']],
  ['swimwear',    ['swimsuit', 'bikini', 'swim', 'wetsuit']],
  ['activewear',  ['sports bra', 'sports top', 'gym wear', 'workout', 'activewear', 'athletic wear']],
];

function getProductTypes(products: Product[]): Set<string> {
  const types = new Set<string>();
  for (const p of products) {
    const name = p.name.toLowerCase();
    for (const [canonical, keywords] of PRODUCT_TYPE_GROUPS) {
      if (keywords.some(kw => name.includes(kw))) {
        types.add(canonical);
        break;
      }
    }
  }
  return types;
}

function getBrands(products: Product[]): Set<string> {
  const out = new Set<string>();
  for (const p of products) {
    const b = p.brand?.toLowerCase().trim();
    if (b) out.add(b);
  }
  return out;
}

/**
 * Score similarity between two looks.
 * Returns 0 immediately when genders are incompatible.
 * Each shared product type   = +1 pt
 * Each shared brand          = +3 pts
 * Threshold for "similar"    = ≥ 2 pts
 */
function lookSimilarityScore(seed: Look, candidate: Look): number {
  // Gender filter: men looks should only surface in men sections, etc.
  const sg = seed.gender;
  const cg = candidate.gender;
  if (sg !== 'unisex' && cg !== 'unisex' && sg !== cg) return 0;

  const seedTypes  = getProductTypes(seed.products);
  const candTypes  = getProductTypes(candidate.products);
  const seedBrands = getBrands(seed.products);
  const candBrands = getBrands(candidate.products);

  let score = 0;
  for (const t of seedTypes)  if (candTypes.has(t))  score += 1;
  for (const b of seedBrands) if (candBrands.has(b)) score += 3;
  return score;
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
}

export default function LookOverlay({ look, onClose, onOpenCreator, onOpenBrowser, onOpenProduct, onCreateCatalog, onOpenLook, bookmarks, allLooks }: LookOverlayProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const moreScrollRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>('products');
  const [touchStartY, setTouchStartY] = useState(0);
  const [translateY, setTranslateY] = useState(0);
  const [isAnimatingOut, setIsAnimatingOut] = useState(false);
  const [lookBookmarked, setLookBookmarked] = useState(bookmarks.isLookBookmarked(look.id));
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
  const heroVideoUrl = normalizeLookVideoUrl(look.video, basePath);

  // Take ownership of the same shared <video> element the originating
  // LookCard was playing. appendChild moves the DOM node - currentTime,
  // decoded frames, and audio context all survive, so the morph from card
  // → hero never reloads or shows a black gap.
  const setHeroSlot = useTrailVideo(trailId, heroVideoUrl);

  // Mirror ProductPage's feed structure with three sections:
  //   1. "Looks like this" — same brand overlap with current look
  //   2. "Popular" — fallback when section 1 is empty
  //   3. "More from <creator>" — other looks by the same creator
  // Each section is padded/trimmed to exactly 8 items (fillLooks duplicates
  // when there are fewer, caps when there are more).
  const feedSections = useMemo(() => {
    const source = (allLooks || allLooksData).filter(l => l.id !== look.id);
    const ownBrands = new Set(
      (look.products || [])
        .map(p => (p.brand || '').toLowerCase().trim())
        .filter(Boolean),
    );

    const looksLikeThis: Look[] = ownBrands.size
      ? source.filter(l =>
          (l.products || []).some(p =>
            ownBrands.has((p.brand || '').toLowerCase().trim()),
          ),
        )
      : [];

    const popular: Look[] = looksLikeThis.length === 0
      ? source.slice(0, 8)
      : [];

    const moreFromCreator: Look[] = look.creator
      ? source.filter(l => l.creator === look.creator)
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
  }, [look.id, look.creator, look.products, allLooks]);

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
    const byCreator = look.creator
      ? all.filter(l => l.creator === look.creator && l.id !== look.id)
      : [];
    const source = byCreator.length > 0
      ? byCreator
      : (look.creator ? all.filter(l => l.creator === look.creator) : []);
    return source.slice(0, 8).map((l, i) => ({
      ...l,
      // Use a unique synthetic ID so TrailVideoHost creates a separate
      // <video> element for the about strip vs the feed section cards.
      id: -(Math.abs(l.id) * 1000 + i + 1),
    }));
  }, [look.id, look.creator, allLooks]);

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
    if (translateY > 100) {
      handleClose();
    } else {
      setTranslateY(0);
    }
  }, [translateY, handleClose]);

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
      <div className="look-overlay-scroll" ref={scrollRef}>
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

            {/* Mobile-only: back + bookmark overlaid on top of the video (same
                pattern as ProductPage .pd-back / .pd-bookmark-btn) */}
            <div className="look-video-overlay-btns">
              <button className="look-video-back-btn" onClick={handleClose} aria-label="Back">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="15 18 9 12 15 6"/>
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
            <div className="look-media-centered">
              <div className="look-media">
                {/* Shared video slot - TrailVideoHost moves the running
                    <video> from the originating LookCard into this
                    element on tap, so playback continues unbroken across
                    the navigation. */}
                <div
                  ref={setHeroSlot}
                  className="look-media-video"
                  data-trail-id={trailId}
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
          </div>

          {/* ── RIGHT: Info panel (40%) ── */}
          <div className="look-info-col" style={panelStyle}>
            {/* Mobile-only: drag handle */}
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
              <button className="look-back-btn-mobile" onClick={handleClose} aria-label="Back">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="15 18 9 12 15 6"/>
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

            {/* Creator row */}
            <div
              className="look-creator-row"
              onClick={() => { handleClose(); onOpenCreator(look.creator); }}
            >
              <img className="detail-creator-avatar" src={creatorData?.avatar || ''} alt={creatorData?.displayName || ''} />
              <div className="look-creator-text">
                <span className="detail-creator-name">
                  {creatorData?.displayName || (showHandle ? look.creator : 'Creator')}
                </span>
                {showHandle && <span className="look-creator-handle">{look.creator.startsWith('@') ? look.creator : `@${look.creator}`}</span>}
              </div>
            </div>

            {/* Look title */}
            {look.title && (
              <h2 className="look-detail-title">{look.title}</h2>
            )}

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

            {/* Tab content */}
            <div className="look-tab-content">
              {activeTab === 'products' && (
                <div className="look-products-list">
                  {look.products.map((p, pi) => (
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

              {activeTab === 'creator' && (
                <>
                  <div className="look-creator-about">
                    <div className="look-creator-about-header">
                      <img className="look-creator-about-avatar" src={creatorData?.avatar || ''} alt={creatorData?.displayName || ''} />
                      <div>
                        <div className="look-creator-about-name">
                          {creatorData?.displayName || (showHandle ? look.creator : 'Creator')}
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
                              onOpenLook={fl.id !== look.id ? handleFeedLookClick : undefined}
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
        {feedSections.looksLikeThis.length > 0 && (
          <div className="look-feed-section">
            <h3 className="look-feed-heading">Looks like this</h3>
            <div className="look-feed-grid">
              {feedSections.looksLikeThis.map(fl => (
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

        {feedSections.popular.length > 0 && (
          <div className="look-feed-section">
            <h3 className="look-feed-heading">Popular</h3>
            <div className="look-feed-grid">
              {feedSections.popular.map(fl => (
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

        {feedSections.moreFromCreator.length > 0 && (
          <div className="look-feed-section">
            <h3 className="look-feed-heading">
              More from {creatorData?.displayName || look.creator}
            </h3>
            <div className="look-feed-grid">
              {feedSections.moreFromCreator.map(fl => (
                <LookCard
                  key={`creator-${fl.id}`}
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
      </div>
    </div>
  );
}
