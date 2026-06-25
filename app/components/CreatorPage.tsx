import { useMemo, useState, useEffect, useCallback, useRef, type ReactNode, type CSSProperties } from 'react';
import { looks as seedLooks, creators as seedCreators, Look, Product } from '~/data/looks';
import { useEscapeKey } from '~/hooks/useEscapeKey';
import { supabase } from '~/utils/supabase';
import { useAuth } from '~/hooks/useAuth';
import { AvatarUpload } from './AvatarCropModal';
import CreativeCardV2 from './CreativeCardV2';
import type { ProductAd } from '~/services/product-creative';
import { primeLookAssets } from '~/utils/trailPrefetch';
import { director } from '~/services/video-playback-director';
import { isFollowing as fetchIsFollowing, getFollowerCount, getFollowingCount, getFollowers, getFollowing, type FollowUser } from '~/services/follows';
import { toggleFollowShared } from '~/hooks/useFollowState';
import { subscribeToLooksChange, fetchSeenLookIds, reorderBySeen, stableLookId } from '~/services/looks';
import ParticleBackground from './ParticleBackground';
import { getCreatorAppearance, getCreatorAppearanceById, type CatalogAppearance, DEFAULT_CATALOG_APPEARANCE } from '~/services/catalog-theme';
import { getCreatorProductOrder, getCreatorHiddenProductIds } from '~/services/catalog-products';
import { getCreatorCollections, type CreatorCollection } from '~/services/creator-collections';
import { startCreatorScrollDebug } from '~/utils/creator-scroll-debug';
import '~/styles/my-looks.css';
import '~/styles/creator-page.css';
import '~/styles/product-page.css';
import '~/styles/comments.css';
import '~/styles/profile-page.css';
// (Removed getShopperGender / subscribeToShopperGender import — the creator
// catalog page no longer filters by shopper gender; see creatorLooks below.)

interface CreatorPageProps {
  creatorName: string;
  onClose: () => void;
  onOpenLook: (look: Look) => void;
  onOpenProduct?: (product: Product) => void;
  onOpenBrowser?: (url: string, title: string) => void;
  onCreateCatalog?: (query: string) => void;
  /** Renders the shared Saved screen as a "Saved" tab. Only passed for the
   *  viewer's own catalog (their personal saves), so the tab is absent on
   *  other creators' pages. */
  renderSaved?: () => ReactNode;
}

type Tab = 'looks' | 'products' | 'saved';

interface UserProfile {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  email: string | null;
  gender: string | null;
  instagram: string | null;
  tiktok: string | null;
}

// Detect "user:<uuid>" handles and pull the trailing uuid.
function extractUserIdFromHandle(handle: string): string | null {
  if (!handle) return null;
  const match = handle.match(/^user:([0-9a-f-]{36})$/i);
  return match ? match[1] : null;
}

// "Trusted by N shoppers" → uses the real follower count when we
// have it (>=1), falls back to the deterministic "X.Yk" stat
// otherwise so the line never reads "0 shoppers" on cold creators.
export default function CreatorPage({
  creatorName,
  onClose,
  onOpenLook,
  onOpenProduct,
  onOpenBrowser,
  onCreateCatalog,
  renderSaved,
}: CreatorPageProps) {
  const [activeTab, setActiveTab] = useState<Tab>('looks');
  const { user: currentUser } = useAuth();

  // Director scope for this catalog. Each look tile below registers a slotId
  // prefixed with this, so while the catalog is open the VideoPlaybackDirector
  // plays/prebuffers ONLY the catalog's tiles and pauses the home feed mounted
  // behind us (same pattern as LookOverlay/ProductPage). Without it both grids
  // would compete for the bounded video pool.
  const directorScope = `creator:${creatorName}`;
  useEffect(() => {
    director.pushScope(directorScope);
    return () => director.popScope(directorScope);
  }, [directorScope]);

  // On close, flag the scope exiting so the home feed re-acquires + decodes its
  // <video>s DURING the back transition instead of after unmount — no dead-feed
  // beat. The push/pop balance is preserved (the effect cleanup still pops once).
  const handleClose = useCallback(() => {
    director.beginScopeExit(directorScope);
    onClose();
  }, [directorScope, onClose]);
  useEscapeKey(handleClose);

  // Grid-density dial — a minimal wheel pinned to the right edge that cycles the
  // catalog grid between 1, 2 (default), and 3 columns. Scroll/drag on it to
  // change; tap cycles. Persisted so the choice sticks across catalogs.
  const GRID_COLS = [1, 2, 3] as const;
  const [colsIndex, setColsIndex] = useState<number>(() => {
    try {
      const v = Number(window.localStorage.getItem('catalog:creator-grid-cols'));
      const i = GRID_COLS.indexOf(v as 1 | 2 | 3);
      return i >= 0 ? i : 1; // default = 2 columns
    } catch { return 1; }
  });
  const gridCols = GRID_COLS[colsIndex];
  useEffect(() => {
    try { window.localStorage.setItem('catalog:creator-grid-cols', String(gridCols)); } catch { /* quota */ }
  }, [gridCols]);
  const dialRef = useRef<HTMLDivElement | null>(null);
  const dialDraggedRef = useRef(false);
  // Auto-hide the dial on scroll-down, reveal on scroll-up (matches the rest
  // of the catalog chrome). The creator page (position:fixed; overflow:auto) is
  // the scroll container.
  const pageScrollRef = useRef<HTMLDivElement | null>(null);
  const [dialHidden, setDialHidden] = useState(false);
  useEffect(() => {
    const el = pageScrollRef.current;
    if (!el) return;
    let last = el.scrollTop;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const y = el.scrollTop;
        if (y < 40) { setDialHidden(false); last = y; return; }
        if (y - last > 8) { setDialHidden(true); last = y; }
        else if (last - y > 8) { setDialHidden(false); last = y; }
      });
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => { cancelAnimationFrame(raf); el.removeEventListener('scroll', onScroll); };
  }, [activeTab]);

  // Flag-gated diagnostic for the iOS held-scroll "thumbnail in the corner"
  // artifact. No-op unless localStorage['catalog:scrolldbg']==='1' (see
  // utils/creator-scroll-debug), so it's safe to ship; lets us read what the
  // tile media actually does mid-gesture on a real device.
  useEffect(() => {
    const el = pageScrollRef.current;
    if (!el) return;
    return startCreatorScrollDebug(el);
  }, [activeTab]);

  // iOS/WebKit held-scroll "thumbnail in the corner" fix. While the grid is
  // actively scrolling, flag the scroller with `.is-scrolling` so CSS hides the
  // director's pooled <video> layers (creator-page.css) — they get churned in
  // and out of tiles mid-scroll and a freshly-attached, frame-less video paints
  // at intrinsic thumbnail size for a frame before it composites. Posters stay
  // visible; videos keep playing (dropped to opacity:0, not paused — the layer
  // stays composited so they don't flash on reveal either) and come back the
  // instant scrolling stops. Toggled via classList, NOT React state, so it
  // never re-renders the grid during a scroll.
  useEffect(() => {
    const el = pageScrollRef.current;
    if (!el) return;
    let stopTimer = 0;
    const onScroll = () => {
      if (!el.classList.contains('is-scrolling')) el.classList.add('is-scrolling');
      window.clearTimeout(stopTimer);
      stopTimer = window.setTimeout(() => el.classList.remove('is-scrolling'), 140);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.clearTimeout(stopTimer);
      el.removeEventListener('scroll', onScroll);
      el.classList.remove('is-scrolling');
    };
  }, [activeTab]);

  // Feed the playback director this page's scroll position. The director listens
  // on `window`, which never sees this fixed/overflow:auto container's scroll, so
  // without it rank/prearm only re-fire on sparse near-band crossings and tiles
  // hold longer on their poster. Mirrors ContinuousFeed's window notifier; keeps
  // prearm warm so reveal-on-stop is instant (the .is-scrolling layer above still
  // owns the during-scroll poster look). Not device-gated.
  useEffect(() => {
    const el = pageScrollRef.current;
    if (!el) return;
    const onScroll = () => director.notifyScroll(el.scrollTop);
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [activeTab]);

  // Backfill any look (in this catalog) still missing its own poster frame, so
  // a posterless look stops falling back to a product image. Admin-gated (write
  // access), fired idle. Re-runnable, so it retries looks that failed elsewhere.
  useEffect(() => {
    if (currentUser?.role !== 'admin' && currentUser?.role !== 'super_admin') return;
    const run = () => import('~/services/poster-backfill')
      .then(({ backfillMissingLookPosters }) => backfillMissingLookPosters())
      .catch(() => {});
    const w = window as unknown as { requestIdleCallback?: (cb: () => void) => number; cancelIdleCallback?: (h: number) => void };
    const id = w.requestIdleCallback ? w.requestIdleCallback(run) : window.setTimeout(run, 3000);
    return () => { if (w.requestIdleCallback && w.cancelIdleCallback) w.cancelIdleCallback(id); else window.clearTimeout(id); };
  }, [currentUser?.role]);
  const cycleCols = useCallback(() => {
    if (dialDraggedRef.current) { dialDraggedRef.current = false; return; }
    setColsIndex(i => (i + 1) % GRID_COLS.length);
  }, []);
  // Wheel + vertical-drag stepping. Attached non-passive so we can keep the
  // gesture on the dial from scrolling the page behind it.
  useEffect(() => {
    const el = dialRef.current;
    if (!el) return;
    const clamp = (i: number) => Math.min(GRID_COLS.length - 1, Math.max(0, i));
    let accum = 0;
    let touchY: number | null = null;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      accum += e.deltaY;
      if (Math.abs(accum) > 22) { setColsIndex(i => clamp(i + (accum > 0 ? 1 : -1))); accum = 0; }
    };
    const onTouchStart = (e: TouchEvent) => { touchY = e.touches[0].clientY; dialDraggedRef.current = false; };
    const onTouchMove = (e: TouchEvent) => {
      if (touchY == null) return;
      e.preventDefault();
      const dy = e.touches[0].clientY - touchY;
      if (Math.abs(dy) > 24) {
        setColsIndex(i => clamp(i + (dy > 0 ? 1 : -1)));
        touchY = e.touches[0].clientY;
        dialDraggedRef.current = true;
      }
    };
    const onTouchEnd = () => { touchY = null; };
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd, { passive: true });
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
    };
  }, []);

  // ── Two render paths share this component ──────────────────────────────
  // 1. Static seed creators (creatorName like "@lilywittman") - data
  //    comes from app/data/looks.ts as before.
  // 2. Real users (creatorName like "user:<uuid>") - we resolve the
  //    profile, their user_generations (= published looks), and the
  //    products attached to those looks via user_generation_products.
  //
  // We only hit Supabase when the second case applies. The seed creators
  // keep working without any network round-trip.
  const userId = useMemo(() => extractUserIdFromHandle(creatorName), [creatorName]);

  // Static-seed branch (legacy creators like @lilywittman / @garrett).
  const seedCreatorData = userId ? null : seedCreators[creatorName];

  // Third path: real creator handles that don't have a static seed
  // (e.g. `taylor-phillips`, `robert-burton`, `janehamilton`). The
  // public creator page rendered blank for these because neither
  // branch above matched. Resolve by querying looks directly.
  const isHandleBranch = !userId && !seedCreatorData && !!creatorName;
  const seedCreatorLooks = useMemo(
    () => (userId ? [] : seedLooks.filter(l => l.creator === creatorName)),
    [creatorName, userId],
  );

  // ── Phase 2: profile resolution + Phase 3: looks + Phase 4: products ──
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [userLooks, setUserLooks] = useState<Look[]>([]);
  const [userProducts, setUserProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState<boolean>(!!userId);
  // The creator's auth user id (for the user:/handle branches). Drives the
  // saved product-order lookup so the Shop tab honors the order the creator
  // set in My Catalog. Null for static seed creators (no DB order).
  const [ownerUserId, setOwnerUserId] = useState<string | null>(userId);
  const [productOrderMap, setProductOrderMap] = useState<Map<string, number>>(new Map());
  // Keep ownerUserId in sync for the user: branch. The handle branch sets
  // it from the resolved look rows; seed creators leave it null.
  useEffect(() => { if (userId) setOwnerUserId(userId); }, [userId]);
  // Fetch the creator's saved product display order (public-readable) so it
  // applies for every visitor, not just the owner.
  useEffect(() => {
    if (!ownerUserId) { setProductOrderMap(new Map()); return; }
    let cancelled = false;
    getCreatorProductOrder(ownerUserId)
      .then(m => { if (!cancelled) setProductOrderMap(m); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [ownerUserId]);

  useEffect(() => {
    if (!userId) { setLoading(false); return; }
    if (!supabase) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    (async () => {
      // Three queries kicked off in parallel - profile lookup, the user's
      // generations (her published looks), and the products associated
      // with those generations. Render the page as soon as the profile
      // resolves; gens + products fade in when they land.
      const [profRes, gensRes] = await Promise.all([
        supabase!.from('profiles')
          .select('id, full_name, avatar_url, email, gender, instagram_handle, tiktok_handle')
          .eq('id', userId).maybeSingle(),
        supabase!.from('user_generations')
          .select('id, status, video_url, storage_path, style, age_label, height_label, created_at, completed_at, display_name')
          .eq('user_id', userId)
          .eq('status', 'done')
          .not('video_url', 'is', null)
          .order('created_at', { ascending: false }),
      ]);

      if (cancelled) return;

      if (profRes.data) {
        const pr = profRes.data as Record<string, unknown>;
        setProfile({
          id: pr.id as string,
          full_name: (pr.full_name as string) ?? null,
          avatar_url: (pr.avatar_url as string) ?? null,
          email: (pr.email as string) ?? null,
          gender: (pr.gender as string) ?? null,
          instagram: (pr.instagram_handle as string) ?? null,
          tiktok: (pr.tiktok_handle as string) ?? null,
        });
      } else {
        // Profile row missing / RLS blocked - synth a placeholder so the
        // header renders with the truncated UUID rather than crashing.
        setProfile({
          id: userId, full_name: null, avatar_url: null, email: null, gender: null,
          instagram: null, tiktok: null,
        });
      }

      const gens = (gensRes.data || []) as Array<{
        id: string; status: string; video_url: string | null;
        storage_path: string | null; style: string;
        age_label: string | null; height_label: string | null;
        created_at: string; completed_at: string | null;
        display_name: string | null;
      }>;

      // Map generations into the Look shape the rest of the consumer
      // surfaces expect. We synthesise a numeric id by hashing the UUID
      // so LookCard's keyed lookups don't collide with seed look ids.
      const looksFromGens: Look[] = gens.map((g, i) => ({
        id: -1 * (Math.abs(hashUuid(g.id)) % 1_000_000) - i, // negative to avoid seed-id collisions
        title: g.display_name || (g.style ? toTitleCase(g.style) + ' look' : 'Untitled look'),
        creator: creatorName,
        gender: 'unisex',
        description: g.style ? `Generated in the ${g.style} style.` : '',
        video: g.video_url || '',
        products: [], // patched in below once we resolve products
        color: '#222',
      }));
      if (!cancelled) setUserLooks(looksFromGens);

      // Phase 4 - products picked across all of her generations. Single
      // join + dedupe by product_id.
      const genIds = gens.map(g => g.id);
      if (genIds.length > 0) {
        const { data: pickRows } = await supabase!
          .from('user_generation_products')
          .select('generation_id, product_id, products(id, name, brand, price, image_url, primary_image_url, primary_video_url, primary_hls_url, primary_video_poster_url, images, url)')
          .in('generation_id', genIds);
        if (cancelled) return;
        const productById = new Map<string, Product>();
        const productsByGen = new Map<string, Set<string>>();
        for (const row of (pickRows || []) as unknown as Array<{
          generation_id: string; product_id: string;
          products: { id: string; name: string | null; brand: string | null; price: string | null; image_url: string | null; primary_image_url: string | null; primary_video_url: string | null; primary_hls_url: string | null; primary_video_poster_url: string | null; images: string[] | null; url: string | null } | null;
        }>) {
          const p = row.products;
          if (!p) continue;
          if (!productById.has(p.id)) {
            productById.set(p.id, {
              id: p.id,
              brand: p.brand || '',
              name: p.name || 'Untitled',
              price: p.price || '',
              url: p.url || '',
              image: p.primary_image_url || p.image_url || (p.images && p.images[0]) || undefined,
              // Carry the product's primary video + frame-0 poster so the Shop
              // tab tile plays it (poster-first), same as the public catalog.
              // primary_hls_url lets CreativeCardV2 play the HLS ladder (instant
              // first frame) over the progressive MP4 when one exists — feed parity.
              video_url: p.primary_video_url || undefined,
              primary_hls_url: p.primary_hls_url || undefined,
              thumbnail_url: p.primary_video_poster_url || p.primary_image_url || p.image_url || undefined,
            });
          }
          const set = productsByGen.get(row.generation_id) || new Set<string>();
          set.add(p.id);
          productsByGen.set(row.generation_id, set);
        }
        // Patch each look's products list so per-look detail still works.
        if (!cancelled) {
          setUserLooks(prev => prev.map((look, i) => {
            const gen = gens[i];
            if (!gen) return look;
            const productIds = productsByGen.get(gen.id);
            if (!productIds) return look;
            const products: Product[] = [];
            productIds.forEach(pid => {
              const p = productById.get(pid);
              if (p) products.push(p);
            });
            return { ...look, products };
          }));
          // Dedup product list for the Shop tab. Order by first-seen.
          const ordered: Product[] = [];
          const seen = new Set<string>();
          gens.forEach(g => {
            const ids = productsByGen.get(g.id);
            if (!ids) return;
            ids.forEach(pid => {
              if (seen.has(pid)) return;
              seen.add(pid);
              const p = productById.get(pid);
              if (p) ordered.push(p);
            });
          });
          setUserProducts(ordered);
        }
      }

      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [userId, creatorName]);

  // Realtime sync: services/looks.ts maintains a Supabase channel on
  // the looks + looks_creative tables and broadcasts via
  // subscribeToLooksChange. Bumping this nonce makes the resolver
  // effect below re-run, so an admin Delete or Unpublish from a
  // different tab clears the look from this creator's catalog page
  // live without a refresh.
  const [looksLiveNonce, setLooksLiveNonce] = useState(0);
  useEffect(() => {
    return subscribeToLooksChange(() => setLooksLiveNonce(n => n + 1));
  }, []);

  // Handle-branch resolver — for `/c/<handle>` URLs that map to real
  // creator_handles in the looks table. Pulls live looks + the
  // owner's profile so the page renders with their actual avatar and
  // name, not the placeholder initial circle.
  useEffect(() => {
    if (!isHandleBranch) return;
    if (!supabase) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    (async () => {
      const { data: lookRows } = await supabase
        .from('looks')
        .select(`
          id, legacy_id, title, gender, creator_handle, user_id,
          looks_creative!inner ( video_url, hls_url, thumbnail_url, is_primary ),
          look_products ( products ( id, name, brand, price, image_url, primary_image_url, primary_video_url, primary_hls_url, primary_video_poster_url, url, images ) )
        `)
        .eq('creator_handle', creatorName)
        .eq('status', 'live')
        .eq('enabled', true)
        .is('archived_at', null)
        .eq('looks_creative.is_primary', true)
        // Honor the creator's curated order (sort_order, set when they
        // drag-reorder in My Catalog) so every visitor sees the catalog in
        // the exact order the creator arranged; created_at breaks ties.
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: false });
      if (cancelled) return;

      type LookPayload = {
        id: string; legacy_id: number | null; title: string;
        gender: string | null; creator_handle: string; user_id: string | null;
        looks_creative: { video_url: string | null; hls_url: string | null; thumbnail_url: string | null; is_primary: boolean }[];
        look_products: { products: { id: string; name: string | null; brand: string | null; price: string | null; image_url: string | null; primary_image_url: string | null; primary_video_url: string | null; primary_hls_url: string | null; primary_video_poster_url: string | null; url: string | null; images: string[] | null } | null }[] | null;
      };
      const rows = (lookRows as LookPayload[] | null) || [];

      const mappedLooks: Look[] = rows.map((r, i) => {
        const products: Product[] = (r.look_products || [])
          .map(lp => lp.products)
          .filter((p): p is NonNullable<typeof p> => !!p)
          .map(p => ({
            id: p.id,
            brand: p.brand || '',
            name: p.name || 'Untitled',
            price: p.price || '',
            url: p.url || '',
            image: p.primary_image_url || p.image_url || (p.images && p.images[0]) || undefined,
            // Carry the product's primary video + its poster so the look's
            // product rows play the primary video (poster-first), same as feed.
            // primary_hls_url lets the Shop tab play the HLS ladder when present.
            video_url: p.primary_video_url || undefined,
            primary_hls_url: p.primary_hls_url || undefined,
            thumbnail_url: p.primary_video_poster_url || p.primary_image_url || p.image_url || undefined,
          }));
        return {
          // Use the SAME stable id scheme as getLooks() (legacy_id, else a
          // deterministic hash of the uuid) so a look saved/seen from a
          // creator catalog matches the same look in the feed — the old
          // -(i+1) scheme reshuffled per fetch and silently broke bookmarks.
          id: r.legacy_id ?? stableLookId(r.id),
          // The real look uuid — without this the LookCard impression fires
          // with target_uuid=null, so viewing a creator's catalog never marks
          // their looks "seen" and the following-rail unseen badge never clears.
          uuid: r.id,
          title: r.title,
          creator: creatorName,
          gender: (r.gender as 'men' | 'women') || 'unisex',
          description: '',
          video: r.looks_creative[0]?.video_url || '',
          // Carry the 1s HLS ladder so LookCard plays it (small first segment →
          // fast prebuffer) instead of cold-loading the full MP4 — the lag fix.
          hls_url: r.looks_creative[0]?.hls_url || undefined,
          thumbnail_url: r.looks_creative[0]?.thumbnail_url || undefined,
          products,
          color: '#222',
        };
      });
      const ownerId = rows.find(r => !!r.user_id)?.user_id || null;
      // Products the creator marked inactive are hidden from their public
      // catalog (mirrors the look Live/Inactive split).
      const hiddenProductIds = ownerId ? await getCreatorHiddenProductIds(ownerId) : new Set<string>();
      if (cancelled) return;
      if (!cancelled) {
        setUserLooks(mappedLooks);
        // Capture the creator's user id so the Shop tab can apply their
        // saved product order.
        setOwnerUserId(ownerId);
        // Aggregate products across all looks for the Shop tab, skipping any
        // the creator has set inactive.
        const seen = new Set<string>();
        const ordered: Product[] = [];
        for (const l of mappedLooks) {
          for (const p of l.products) {
            if (p.id && hiddenProductIds.has(p.id)) continue;
            const key = `${p.brand}::${p.name}`;
            if (seen.has(key)) continue;
            seen.add(key);
            ordered.push(p);
          }
        }
        setUserProducts(ordered);
      }

      // Pull the owner's profile via the first look's user_id so the
      // hero avatar + name. Fetch profile (by user_id) AND creators
      // (by handle) in parallel — whichever has a non-null avatar
      // wins. Some real creators have a creators-table row with an
      // avatar but their auth profile's avatar_url is null, and
      // vice versa. (ownerId computed above for the inactive-product filter.)
      const [profRes, creatorRes] = await Promise.all([
        ownerId
          ? supabase!.from('profiles').select('id, full_name, avatar_url, email, gender, instagram_handle, tiktok_handle').eq('id', ownerId).maybeSingle()
          : Promise.resolve({ data: null }),
        supabase!.from('creators').select('handle, display_name, avatar_url, is_ai').eq('handle', creatorName).maybeSingle(),
      ]);
      if (cancelled) return;
      const prof = (profRes as { data: { id: string; full_name: string | null; avatar_url: string | null; email: string | null; gender: string | null; instagram_handle: string | null; tiktok_handle: string | null } | null }).data;
      const creatorRow = (creatorRes as { data: { handle: string; display_name: string | null; avatar_url: string | null } | null }).data;
      // Merge: prefer profile values, fall back to creators row.
      const mergedAvatar = prof?.avatar_url || creatorRow?.avatar_url || null;
      const mergedName = prof?.full_name || creatorRow?.display_name || null;
      if (prof || creatorRow) {
        setProfile({
          id: ownerId || creatorName,
          full_name: mergedName,
          avatar_url: mergedAvatar,
          email: prof?.email ?? null,
          gender: prof?.gender ?? null,
          instagram: prof?.instagram_handle ?? null,
          tiktok: prof?.tiktok_handle ?? null,
        });
      }

      if (!cancelled) setLoading(false);
    })().catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [isHandleBranch, creatorName, looksLiveNonce]);

  // Resolved values that the JSX below reads. When userId is set we use
  // the live data; otherwise the static-seed values.
  const displayName = (userId || isHandleBranch)
    ? (profile?.full_name || profile?.email?.split('@')[0] || creatorName)
    : (seedCreatorData?.displayName || creatorName);
  const avatarUrl = (userId || isHandleBranch)
    ? (profile?.avatar_url || seedCreatorData?.avatar || '')
    : (seedCreatorData?.avatar || '');
  // While the live identity is still resolving (handle / user branch, profile
  // not back yet) we DON'T know the real name, avatar, or whether this is the
  // viewer's own catalog. Rendering the fallbacks then meant a jarring flicker:
  // the raw handle ("robert-burton") as the name, a monogram avatar, and a
  // FOLLOW button — all of which then snapped to the real name / photo / "My
  // information". Show a clean skeleton for that beat instead so the page
  // resolves straight to the real catalog with no wrong-state flash.
  const identityLoading = (!!userId || isHandleBranch) && loading && !profile;
  // Pull seen-look set for the signed-in shopper so the catalog
  // applies the unseen-first / shuffle-seen ordering rule defined in
  // services/looks.ts. Anonymous shoppers fall through with an empty
  // set (reorderBySeen no-ops in that case).
  const [seenLookIds, setSeenLookIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!currentUser?.id) { setSeenLookIds(new Set()); return; }
    fetchSeenLookIds(currentUser.id).then(setSeenLookIds).catch(() => setSeenLookIds(new Set()));
  }, [currentUser?.id]);

  // Creator-chosen catalog appearance (particles + hue). Read by user id for
  // `user:<uuid>` creators (My Catalog saves keyed by creators.id), else by
  // handle for seed creators.
  const [appearance, setAppearance] = useState<CatalogAppearance>(DEFAULT_CATALOG_APPEARANCE);
  useEffect(() => {
    let cancelled = false;
    const load = userId
      ? getCreatorAppearanceById(userId)
      : creatorName
        ? getCreatorAppearance(creatorName)
        : Promise.resolve(DEFAULT_CATALOG_APPEARANCE);
    load.then(a => { if (!cancelled) setAppearance(a); }).catch(() => {});
    return () => { cancelled = true; };
  }, [userId, creatorName]);
  const rawCreatorLooksUnordered = (userId || isHandleBranch) ? userLooks : seedCreatorLooks;
  const rawCreatorLooks = useMemo(
    // Real creators (handle / user branch) keep their curated sort_order
    // exactly as arranged — no unseen-first reshuffle — so every visitor
    // sees the catalog in the creator's chosen order. Only the static seed
    // creators get the seen-aware reorder.
    () => (userId || isHandleBranch)
      ? rawCreatorLooksUnordered
      : reorderBySeen(rawCreatorLooksUnordered, seenLookIds),
    [rawCreatorLooksUnordered, seenLookIds, userId, isHandleBranch],
  );

  // No gender filter on this page. The home feed filters by shopper
  // gender to keep "men + unisex" or "women + unisex" content in front
  // of each audience, but a shopper on a creator's catalog has
  // explicitly navigated TO that creator and expects to see everything
  // they've published. Earlier this surface inherited the home-feed
  // gender rule, which silently hid a female creator's published looks
  // from male shoppers (janehamilton's catalog read "No looks yet"
  // even though /admin/data showed her live rows). Strip the filter —
  // the primary-video rule below is the only gate.
  const creatorLooks = useMemo(() => {
    return rawCreatorLooks.filter(l => !!l.video);
  }, [rawCreatorLooks]);

  // Warm the above-the-fold batch the same way the feed does: decode the first
  // ~16 posters into cache and head-warm the first ~18 HLS ladders the instant
  // the look set resolves — before the cards mount — so the first screen paints
  // its posters flicker-free and plays without the cold-start manifest fetch.
  // Idempotent + network-gated inside primeLookAssets; covers every load branch
  // (handle, generated, seed) since creatorLooks is the final rendered list.
  useEffect(() => {
    if (creatorLooks.length) primeLookAssets(creatorLooks);
  }, [creatorLooks]);

  // Brand-grouped product list - powers the Shop tab chips.
  const allProducts = useMemo(() => {
    if (userId || isHandleBranch) return applyCreatorOrder(userProducts, productOrderMap);
    const seen = new Set<string>();
    const products: Product[] = [];
    seedCreatorLooks.forEach(look => {
      look.products.forEach(p => {
        const key = `${p.brand}-${p.name}`;
        if (!seen.has(key)) {
          seen.add(key);
          products.push(p);
        }
      });
    });
    return products;
  }, [userId, isHandleBranch, userProducts, seedCreatorLooks, productOrderMap]);

  const brandCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    allProducts.forEach(p => {
      const brand = p.brand || 'Other';
      counts[brand] = (counts[brand] || 0) + 1;
    });
    return counts;
  }, [allProducts]);

  // Collections — the creator's own named collections (e.g. "Cool"),
  // authored on the Saved screen and synced to the cloud. We only surface a
  // collection on the Shop tab when at least one of its products is actually
  // in this catalog (intersect membership with the live products). Each
  // collection carries the matching count for its chip.
  const [dbCollections, setDbCollections] = useState<CreatorCollection[]>([]);
  const creatorUserId = useMemo(() => {
    if (userId) return userId;
    const pid = profile?.id;
    return pid && /^[0-9a-f-]{36}$/i.test(pid) ? pid : null;
  }, [userId, profile?.id]);
  useEffect(() => {
    if (!creatorUserId) { setDbCollections([]); return; }
    let cancelled = false;
    getCreatorCollections(creatorUserId)
      .then(c => { if (!cancelled) setDbCollections(c); })
      .catch(() => { if (!cancelled) setDbCollections([]); });
    return () => { cancelled = true; };
  }, [creatorUserId]);

  const shopCollections = useMemo(() => {
    if (dbCollections.length === 0) return [];
    const liveKeys = new Set(allProducts.map(p => `${p.brand}::${p.name}`));
    return dbCollections
      .map(c => ({ id: c.clientId, name: c.name, keys: new Set(c.productKeys), count: c.productKeys.filter(k => liveKeys.has(k)).length }))
      .filter(c => c.count > 0);
  }, [dbCollections, allProducts]);

  const [activeBrand, setActiveBrand] = useState<string | null>(null);
  // Holds the active collection's client id (or null for "All").
  const [activeCollection, setActiveCollection] = useState<string | null>(null);
  const activeCollectionKeys = useMemo(
    () => shopCollections.find(c => c.id === activeCollection)?.keys ?? null,
    [shopCollections, activeCollection],
  );
  const filteredProducts = useMemo(() => {
    return allProducts.filter(p => {
      if (activeBrand && (p.brand || 'Other') !== activeBrand) return false;
      if (activeCollectionKeys && !activeCollectionKeys.has(`${p.brand}::${p.name}`)) return false;
      return true;
    });
  }, [allProducts, activeBrand, activeCollectionKeys]);

  const handleProductClick = (p: Product) => {
    if (onOpenProduct) onOpenProduct(p);
    else if (p.url && onOpenBrowser) onOpenBrowser(p.url, p.name);
  };

  // ── Follow state. Persists to creator_follows (RLS, scoped to the
  //    signed-in shopper). Optimistic toggle so the button flips
  //    instantly; reverts on RPC error.
  const followHandle = creatorName;
  const [following, setFollowing] = useState<boolean>(false);
  const [followerCount, setFollowerCount] = useState<number | null>(null);
  const [followingCount, setFollowingCount] = useState<number | null>(null);
  const [followBusy, setFollowBusy] = useState(false);

  // Followers / following list overlay. Tapping a stat opens a sheet of users;
  // tapping a user opens their catalog via the in-app open-creator event.
  const [followList, setFollowList] = useState<{ kind: 'followers' | 'following'; users: FollowUser[]; loading: boolean } | null>(null);
  const openFollowList = useCallback((kind: 'followers' | 'following') => {
    setFollowList({ kind, users: [], loading: true });
    const p = kind === 'followers'
      ? getFollowers(followHandle)
      : (creatorUserId ? getFollowing(creatorUserId) : Promise.resolve([] as FollowUser[]));
    p.then(users => setFollowList(prev => (prev && prev.kind === kind ? { kind, users, loading: false } : prev)))
     .catch(() => setFollowList(prev => (prev ? { ...prev, loading: false } : prev)));
  }, [followHandle, creatorUserId]);
  const openCreatorFromList = useCallback((handle: string) => {
    setFollowList(null);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('catalog:open-creator', { detail: { handle } }));
    }
  }, []);

  // How many creators THIS creator follows — shown alongside their follower
  // count in the hero. Keyed by the resolved creator user id.
  useEffect(() => {
    if (!creatorUserId) { setFollowingCount(null); return; }
    let cancelled = false;
    getFollowingCount(creatorUserId).then(n => { if (!cancelled) setFollowingCount(n); }).catch(() => {});
    return () => { cancelled = true; };
  }, [creatorUserId]);
  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchIsFollowing(followHandle), getFollowerCount(followHandle)]).then(([f, n]) => {
      if (cancelled) return;
      setFollowing(f);
      setFollowerCount(n);
    });
    return () => { cancelled = true; };
  }, [followHandle]);
  const onToggleFollow = useCallback(async () => {
    if (followBusy) return;
    if (!currentUser) {
      // Anon — push them to sign-in. The CreatorLoginToastHost
      // intercepts and renders the auth modal.
      try { window.dispatchEvent(new CustomEvent('catalog:require-login')); } catch { /* */ }
      return;
    }
    setFollowBusy(true);
    const prev = following;
    setFollowing(!prev);
    setFollowerCount(n => (n ?? 0) + (prev ? -1 : 1));
    try {
      // Use the SHARED toggle so the header following rail (and every
      // in-feed follow button for this creator) hears the change via
      // notifyListChanged — otherwise unfollowing here left the creator
      // stuck in the top rail until a full reload.
      const next = await toggleFollowShared(followHandle);
      setFollowing(next);
      // Mirror the feed avatar's behaviour: celebrate a NEW follow with the
      // global follow toast (FollowToastHost listens for catalog:followed).
      if (next && !prev) {
        try {
          window.dispatchEvent(new CustomEvent('catalog:followed', {
            detail: { name: displayName || creatorName, avatarUrl: avatarUrl || null },
          }));
        } catch { /* no-op */ }
      }
    } catch {
      // Revert on error
      setFollowing(prev);
      setFollowerCount(n => (n ?? 0) + (prev ? 1 : -1));
    } finally {
      setFollowBusy(false);
    }
  }, [following, followBusy, followHandle, currentUser, displayName, creatorName, avatarUrl]);

  // Cheap deterministic "trusted by X.Yk" stat - seeded by the userId so
  // it doesn't change on every render. For seed creators we use the
  // creator handle as the seed.
  // Initial-letter avatar fallback when profile.avatar_url is missing.
  const initial = (displayName || 'U').trim().charAt(0).toUpperCase() || 'U';

  // Catalog feeds are dark-only now — the per-creator light theme was
  // retired so every viewer sees the same dark surface (matches the
  // consumer feed + My Catalogue). No light-mode wrap.
  return (
    <div>
    <div
      className="creator-page"
      style={appearance.hue != null ? { background: `hsl(${appearance.hue}, 28%, 6%)` } : undefined}
    >
      {/* Creator-chosen appearance: particle field behind content + the hue
          tint on the page background above. Sits in the promoted fixed shell
          (not the scroller) so it pins to the viewport. */}
      {appearance.particles && (
        <div className="creator-page-particles" aria-hidden="true"><ParticleBackground /></div>
      )}
      {/* Inner scroller (mirrors the product detail overlay's .product-page).
          The fixed .creator-page shell is layer-promoted; the actual scroll
          happens here. */}
      <div ref={pageScrollRef} className="creator-page-scroll">
      <button className="creator-back creator-back--icon" onClick={handleClose} aria-label="Back">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
      </button>

      {/* Hero - centered profile */}
      <div className="creator-hero">
        {/* When the current user is viewing their own profile, the
            avatar becomes the AvatarUpload trigger (file picker →
            crop modal → Supabase upload). Everyone else sees the
            static <img>. The static-seed creator path has no userId,
            so this branch only fires for real shopper profiles. */}
        {userId && currentUser?.id === userId ? (
          <div className="creator-hero-avatar-edit">
            <AvatarUpload
              userId={currentUser.id}
              currentUrl={avatarUrl || undefined}
              fallbackInitial={initial}
              onUploaded={(url) => setProfile(p => p ? { ...p, avatar_url: url } : p)}
              className="creator-hero-avatar"
            />
            <span className="creator-hero-avatar-edit-hint" aria-hidden="true">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
            </span>
          </div>
        ) : identityLoading ? (
          <div className="creator-hero-avatar creator-hero-avatar--skeleton" aria-hidden="true" />
        ) : avatarUrl ? (
          <img className="creator-hero-avatar" src={avatarUrl} alt={displayName} referrerPolicy="no-referrer" />
        ) : (
          <div className="creator-hero-avatar creator-hero-avatar--initial">{initial}</div>
        )}
        <span className="creator-hero-curated">Curated by</span>
        <h1 className="creator-hero-name">
          {identityLoading
            ? <span className="creator-hero-name-skeleton" aria-hidden="true" />
            : displayName}
        </h1>
        {identityLoading ? (
          /* Button-shaped shimmer so the header holds its final height —
             without it the grid jumped down when Follow/Following arrived. */
          <span className="creator-follow-btn creator-follow-btn--skeleton" aria-hidden="true" />
        ) : currentUser?.id && creatorUserId === currentUser.id ? (
          /* Self-view: this is YOUR creator page (matched by resolved owner
              id so it also catches the handle-route, not just user:<uuid>).
              You can't follow yourself, so the Follow slot becomes "My
              information" — it opens the profile / info screen. _index
              listens for `catalog:open-profile` and shows the ProfilePage. */
          <button
            className="creator-follow-btn"
            onClick={() => window.dispatchEvent(new CustomEvent('catalog:open-profile'))}
            aria-label="My information"
            style={{ background: '#fff', color: '#0f172a', border: '1px solid #cbd5e1', display: 'inline-flex', alignItems: 'center', gap: 8 }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="8" r="4" />
              <path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1" />
            </svg>
            My information
          </button>
        ) : (
          <button
            className="creator-follow-btn"
            onClick={onToggleFollow}
            disabled={followBusy}
            aria-pressed={following}
            style={following ? { background: '#fff', color: '#0f172a', border: '1px solid #cbd5e1' } : undefined}
          >
            {following ? 'Following' : 'Follow'}
          </button>
        )}
        <p className="creator-hero-trust">
          {loading && creatorLooks.length === 0
            ? 'Loading catalog...'
            : (
              <>
                <button
                  type="button"
                  className="creator-hero-stat creator-hero-stat--btn"
                  onClick={() => openFollowList('followers')}
                >
                  <strong>{(followerCount ?? 0).toLocaleString()}</strong> {followerCount === 1 ? 'follower' : 'followers'}
                </button>
                <span className="creator-hero-stat-sep">·</span>
                <button
                  type="button"
                  className="creator-hero-stat creator-hero-stat--btn"
                  onClick={() => openFollowList('following')}
                >
                  <strong>{(followingCount ?? 0).toLocaleString()}</strong> following
                </button>
              </>
            )}
        </p>
        {(profile?.instagram || profile?.tiktok) && (
          <div className="creator-hero-socials">
            {profile?.instagram && (
              <a
                href={`https://instagram.com/${profile.instagram}`}
                target="_blank"
                rel="noopener noreferrer"
                className="creator-hero-social"
                aria-label={`@${profile.instagram} on Instagram`}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/></svg>
              </a>
            )}
            {profile?.tiktok && (
              <a
                href={`https://tiktok.com/@${profile.tiktok}`}
                target="_blank"
                rel="noopener noreferrer"
                className="creator-hero-social"
                aria-label={`@${profile.tiktok} on TikTok`}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.34-6.34V8.98a8.18 8.18 0 004.76 1.52V7.05a4.83 4.83 0 01-1-.36z"/></svg>
              </a>
            )}
          </div>
        )}
      </div>

      {/* Navigation tabs */}
      <div className="creator-nav">
        <button
          className={`creator-nav-tab ${activeTab === 'looks' ? 'active' : ''}`}
          onClick={() => setActiveTab('looks')}
        >
          Looks {creatorLooks.length > 0 && <span className="creator-nav-count">{creatorLooks.length}</span>}
        </button>
        <button
          className={`creator-nav-tab ${activeTab === 'products' ? 'active' : ''}`}
          onClick={() => setActiveTab('products')}
        >
          {/* The tab IS the creator's collections once they've set some;
              plain product list otherwise. */}
          {shopCollections.length > 0 ? 'Collections' : 'Shop'} {allProducts.length > 0 && <span className="creator-nav-count">{allProducts.length}</span>}
        </button>
        {renderSaved && (
          <button
            className={`creator-nav-tab ${activeTab === 'saved' ? 'active' : ''}`}
            onClick={() => setActiveTab('saved')}
          >
            Saved
          </button>
        )}
      </div>

      {/* Saved tab — the viewer's own saves (shared SavedScreen). */}
      {activeTab === 'saved' && renderSaved && (
        <div className="creator-saved">{renderSaved()}</div>
      )}

      {/* Collections selector (products tab only) — a swipeable row of
          the creator's collections (Shoes, Tops, Bags…). Selecting one
          shows just that collection. Only shown when there's more than
          one real collection to choose between. */}
      {activeTab === 'products' && shopCollections.length > 0 && (
        <div className="creator-collections">
          <button
            className={`creator-collection-chip ${!activeCollection ? 'active' : ''}`}
            onClick={() => setActiveCollection(null)}
          >
            All products
          </button>
          {shopCollections.map(col => (
            <button
              key={col.id}
              className={`creator-collection-chip ${activeCollection === col.id ? 'active' : ''}`}
              onClick={() => setActiveCollection(c => c === col.id ? null : col.id)}
            >
              {col.name} <span className="creator-collection-count">{col.count}</span>
            </button>
          ))}
        </div>
      )}

      {/* Brand filter chips (products tab only) */}
      {activeTab === 'products' && Object.keys(brandCounts).length > 1 && (
        <div className="creator-brand-chips">
          <button
            className={`creator-brand-chip ${!activeBrand ? 'active' : ''}`}
            onClick={() => setActiveBrand(null)}
          >
            All {allProducts.length}
          </button>
          {Object.entries(brandCounts).map(([brand, count]) => (
            <button
              key={brand}
              className={`creator-brand-chip ${activeBrand === brand ? 'active' : ''}`}
              onClick={() => setActiveBrand(brand)}
            >
              {brand} {count}
            </button>
          ))}
        </div>
      )}

      {/* Looks grid */}
      {activeTab === 'looks' && (
        loading && creatorLooks.length === 0 ? (
          <div className="creator-skeleton-grid" style={{ ['--cat-cols']: gridCols } as CSSProperties}>
            {Array.from({ length: 6 }).map((_, i) => <div key={i} className="creator-skeleton-tile" />)}
          </div>
        ) : creatorLooks.length === 0 ? (
          <div className="creator-empty">
            <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
              <circle cx="8.5" cy="8.5" r="1.5"/>
              <polyline points="21 15 16 10 5 21"/>
            </svg>
            <h2>No looks yet</h2>
            <p>This curator hasn&rsquo;t published any looks. Check back soon.</p>
          </div>
        ) : (
          <div className="creator-grid" style={{ ['--cat-cols']: gridCols } as CSSProperties}>
            {creatorLooks.map((look, i) => (
              <CreativeCardV2
                key={look.id}
                slotId={`${directorScope}:look-${look.id}`}
                look={look}
                className="look-card"
                onOpenLook={onOpenLook}
                onOpenCreator={() => {}}
                hideCreator
                lookPosterOnly
                priority={i < 6}
              />
            ))}
          </div>
        )
      )}

      {/* Products grid */}
      {activeTab === 'products' && (
        loading && allProducts.length === 0 ? (
          <div className="creator-skeleton-grid" style={{ ['--cat-cols']: gridCols } as CSSProperties}>
            {Array.from({ length: 8 }).map((_, i) => <div key={i} className="creator-skeleton-tile" />)}
          </div>
        ) : filteredProducts.length === 0 ? (
          <div className="creator-empty">
            <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/>
              <line x1="3" y1="6" x2="21" y2="6"/>
              <path d="M16 10a4 4 0 0 1-8 0"/>
            </svg>
            <h2>No products yet</h2>
            <p>Saved products will appear here once {displayName.split(' ')[0]} adds them to a look.</p>
          </div>
        ) : (
          <div className="creator-grid" style={{ ['--cat-cols']: gridCols } as CSSProperties}>
            {filteredProducts.map((p, i) => (
              <CreativeCardV2
                key={`${p.brand}-${p.name}-${i}`}
                slotId={`${directorScope}:product-${p.brand}-${p.name}-${i}`}
                creative={creatorProductToAd(p)}
                className="look-card"
                onOpenProduct={() => handleProductClick(p)}
                priority={i < 6}
              />
            ))}
          </div>
        )
      )}
      </div>{/* .creator-page-scroll */}
    </div>

    {/* Grid-density dial — minimal wheel on the right edge. Scroll/drag to
        change column count, tap to cycle. Kept dim + out of the way. Only on
        the grid tabs (Saved renders its own screen). */}
    {activeTab !== 'saved' && (
    <div
      ref={dialRef}
      className={`cat-view-dial${dialHidden ? ' cat-view-dial--hidden' : ''}`}
      role="group"
      aria-label="Grid columns"
      onClick={cycleCols}
    >
      {GRID_COLS.map((c, i) => (
        <span
          key={c}
          className={`cat-view-dial-dot${i === colsIndex ? ' is-active' : ''}`}
          aria-label={`${c} column${c > 1 ? 's' : ''}`}
          aria-current={i === colsIndex}
        >
          <span className="cat-view-dial-bars">
            {Array.from({ length: c }).map((_, b) => <i key={b} />)}
          </span>
        </span>
      ))}
    </div>
    )}

    {/* Followers / following list sheet. Tap a row to open that user's
        catalog (in-app, via the open-creator event). */}
    {followList && (
      <div
        className="follow-list-overlay"
        role="dialog"
        aria-modal="true"
        aria-label={followList.kind === 'followers' ? 'Followers' : 'Following'}
        onClick={() => setFollowList(null)}
      >
        <div className="follow-list-sheet" onClick={(e) => e.stopPropagation()}>
          <div className="follow-list-head">
            <h2 className="follow-list-title">
              {followList.kind === 'followers' ? 'Followers' : 'Following'}
            </h2>
            <button
              type="button"
              className="follow-list-close"
              onClick={() => setFollowList(null)}
              aria-label="Close"
            >×</button>
          </div>
          <div className="follow-list-body">
            {followList.loading ? (
              <p className="follow-list-empty">Loading…</p>
            ) : followList.users.length === 0 ? (
              <p className="follow-list-empty">
                {followList.kind === 'followers' ? 'No followers yet.' : 'Not following anyone yet.'}
              </p>
            ) : (
              followList.users.map((u) => (
                <button
                  key={u.handle}
                  type="button"
                  className="follow-list-row"
                  onClick={() => openCreatorFromList(u.handle)}
                >
                  {u.avatarUrl ? (
                    <img className="follow-list-avatar" src={u.avatarUrl} alt={u.displayName} referrerPolicy="no-referrer" />
                  ) : (
                    <span className="follow-list-avatar follow-list-avatar--initial">
                      {(u.displayName || 'U').trim().charAt(0).toUpperCase()}
                    </span>
                  )}
                  <span className="follow-list-name">{u.displayName}</span>
                  <svg className="follow-list-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>
              ))
            )}
          </div>
        </div>
      </div>
    )}
    </div>
  );
}

// ── helpers ────────────────────────────────────────────────────────────

// Map a creator-catalog Product into the ProductAd shape CreativeCardV2
// renders in creative mode — so the Shop tab uses the SAME director-driven,
// HLS-first playback pipeline as the feed and the Looks tab (instead of the
// old CreatorProductTile, which cold-loaded a progressive MP4 per tile).
//
// The `id` mirrors handleOpenProduct's trail-id convention
// (`creative_id` ?? `product:<brand>-<name>`): CreativeCardV2 donates its
// playing <video> to TrailVideoHost keyed by `id`, and ProductPage's hero
// reads the trail by the same key — so tapping a Shop tile hands the live,
// already-decoded frame straight to the detail hero (no re-buffer, no flash).
function creatorProductToAd(p: Product): ProductAd {
  const productId = p.id || '';
  const poster = p.thumbnail_url || p.image || null;
  return {
    id: p.creative_id || `product:${p.brand}-${p.name}`,
    product_id: productId,
    look_id: null,
    title: p.name,
    description: null,
    video_url: p.video_url ?? null,
    mobile_video_url: null,
    hls_url: p.primary_hls_url ?? null,
    storage_path: null,
    thumbnail_url: poster,
    affiliate_url: null,
    prompt: null,
    prompt_extra: null,
    style: '',
    model: null,
    status: 'live',
    duration_seconds: null,
    aspect_ratio: '3:4',
    resolution: null,
    cost_usd: null,
    impressions: 0,
    clicks: 0,
    error: null,
    enabled: true,
    created_at: '',
    completed_at: null,
    updated_at: null,
    product: {
      id: productId,
      name: p.name,
      brand: p.brand,
      price: p.price,
      image_url: p.image ?? null,
      primary_image_url: p.image ?? null,
      primary_video_url: p.video_url ?? null,
      primary_hls_url: p.primary_hls_url ?? null,
      primary_video_poster_url: p.thumbnail_url ?? null,
      images: null,
      url: p.url ?? null,
    },
  };
}

function hashUuid(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return h;
}

function toTitleCase(s: string): string {
  return s.replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// Apply the creator's saved display order to their Shop-tab products.
// Products with a saved sort_order lead (ascending); everything else keeps
// its existing first-seen order behind them. Stable so unordered products
// don't reshuffle. No-op when the creator hasn't reordered anything.
function applyCreatorOrder(products: Product[], orderMap: Map<string, number>): Product[] {
  if (orderMap.size === 0) return products;
  return products
    .map((p, i) => ({ p, i }))
    .sort((a, b) => {
      const oa = a.p.id && orderMap.has(a.p.id) ? orderMap.get(a.p.id)! : Number.POSITIVE_INFINITY;
      const ob = b.p.id && orderMap.has(b.p.id) ? orderMap.get(b.p.id)! : Number.POSITIVE_INFINITY;
      if (oa !== ob) return oa - ob;
      return a.i - b.i; // stable fallback: preserve original order
    })
    .map(({ p }) => p);
}
