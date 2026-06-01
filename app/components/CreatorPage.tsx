import { useMemo, useState, useEffect, useCallback } from 'react';
import { looks as seedLooks, creators as seedCreators, Look, Product } from '~/data/looks';
import { useEscapeKey } from '~/hooks/useEscapeKey';
import { supabase } from '~/utils/supabase';
import { useAuth } from '~/hooks/useAuth';
import { AvatarUpload } from './AvatarCropModal';
import LookCard from './LookCard';
import { toggleFollow, isFollowing as fetchIsFollowing, getFollowerCount } from '~/services/follows';

interface CreatorPageProps {
  creatorName: string;
  onClose: () => void;
  onOpenLook: (look: Look) => void;
  onOpenProduct?: (product: Product) => void;
  onOpenBrowser?: (url: string, title: string) => void;
  onCreateCatalog?: (query: string) => void;
}

type Tab = 'looks' | 'products';

interface UserProfile {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  email: string | null;
  gender: string | null;
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
function formatFollowerCount(real: number | null, fallback: string): string {
  if (real !== null && real > 0) {
    const label = real === 1 ? 'shopper' : 'shoppers';
    return `${real.toLocaleString()} ${label} follow`;
  }
  return `Trusted by ${fallback} shoppers`;
}

export default function CreatorPage({
  creatorName,
  onClose,
  onOpenLook,
  onOpenProduct,
  onOpenBrowser,
  onCreateCatalog,
}: CreatorPageProps) {
  const [activeTab, setActiveTab] = useState<Tab>('looks');
  const { user: currentUser } = useAuth();
  useEscapeKey(onClose);

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
  // The creator's chosen catalog theme — applied for ALL viewers. null
  // until resolved; treated as the default dark.
  const [catalogTheme, setCatalogTheme] = useState<'light' | 'dark' | null>(null);

  // Resolve the creator's catalog theme by handle (public read).
  useEffect(() => {
    let cancelled = false;
    if (!creatorName) return;
    import('~/services/catalog-theme').then(({ getCreatorTheme }) => {
      getCreatorTheme(creatorName).then(t => { if (!cancelled) setCatalogTheme(t); });
    });
    return () => { cancelled = true; };
  }, [creatorName]);

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
          .select('id, full_name, avatar_url, email, gender')
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
        setProfile(profRes.data as UserProfile);
      } else {
        // Profile row missing / RLS blocked - synth a placeholder so the
        // header renders with the truncated UUID rather than crashing.
        setProfile({
          id: userId, full_name: null, avatar_url: null, email: null, gender: null,
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
          .select('generation_id, product_id, products(id, name, brand, price, image_url, primary_image_url, images, url)')
          .in('generation_id', genIds);
        if (cancelled) return;
        const productById = new Map<string, Product>();
        const productsByGen = new Map<string, Set<string>>();
        for (const row of (pickRows || []) as unknown as Array<{
          generation_id: string; product_id: string;
          products: { id: string; name: string | null; brand: string | null; price: string | null; image_url: string | null; primary_image_url: string | null; images: string[] | null; url: string | null } | null;
        }>) {
          const p = row.products;
          if (!p) continue;
          if (!productById.has(p.id)) {
            productById.set(p.id, {
              brand: p.brand || '',
              name: p.name || 'Untitled',
              price: p.price || '',
              url: p.url || '',
              image: p.primary_image_url || p.image_url || (p.images && p.images[0]) || undefined,
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
          looks_creative!inner ( video_url, thumbnail_url, is_primary ),
          look_products ( products ( id, name, brand, price, image_url, primary_image_url, url, images ) )
        `)
        .eq('creator_handle', creatorName)
        .eq('status', 'live')
        .eq('enabled', true)
        .is('archived_at', null)
        .eq('looks_creative.is_primary', true)
        .order('created_at', { ascending: false });
      if (cancelled) return;

      type LookPayload = {
        id: string; legacy_id: number | null; title: string;
        gender: string | null; creator_handle: string; user_id: string | null;
        looks_creative: { video_url: string | null; thumbnail_url: string | null; is_primary: boolean }[];
        look_products: { products: { id: string; name: string | null; brand: string | null; price: string | null; image_url: string | null; primary_image_url: string | null; url: string | null; images: string[] | null } | null }[] | null;
      };
      const rows = (lookRows as LookPayload[] | null) || [];

      const mappedLooks: Look[] = rows.map((r, i) => {
        const products: Product[] = (r.look_products || [])
          .map(lp => lp.products)
          .filter((p): p is NonNullable<typeof p> => !!p)
          .map(p => ({
            brand: p.brand || '',
            name: p.name || 'Untitled',
            price: p.price || '',
            url: p.url || '',
            image: p.image_url || (p.images && p.images[0]) || undefined,
          }));
        return {
          id: r.legacy_id ?? -(i + 1),
          title: r.title,
          creator: creatorName,
          gender: (r.gender as 'men' | 'women') || 'unisex',
          description: '',
          video: r.looks_creative[0]?.video_url || '',
          thumbnail_url: r.looks_creative[0]?.thumbnail_url || undefined,
          products,
          color: '#222',
        };
      });
      if (!cancelled) {
        setUserLooks(mappedLooks);
        // Aggregate products across all looks for the Shop tab.
        const seen = new Set<string>();
        const ordered: Product[] = [];
        for (const l of mappedLooks) {
          for (const p of l.products) {
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
      // vice versa.
      const ownerId = rows.find(r => r.user_id)?.user_id;
      const [profRes, creatorRes] = await Promise.all([
        ownerId
          ? supabase!.from('profiles').select('id, full_name, avatar_url, email, gender').eq('id', ownerId).maybeSingle()
          : Promise.resolve({ data: null }),
        supabase!.from('creators').select('handle, display_name, avatar_url, is_ai').eq('handle', creatorName).maybeSingle(),
      ]);
      if (cancelled) return;
      const prof = (profRes as { data: { id: string; full_name: string | null; avatar_url: string | null; email: string | null; gender: string | null } | null }).data;
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
        });
      }

      if (!cancelled) setLoading(false);
    })().catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [isHandleBranch, creatorName]);

  // Resolved values that the JSX below reads. When userId is set we use
  // the live data; otherwise the static-seed values.
  const displayName = (userId || isHandleBranch)
    ? (profile?.full_name || profile?.email?.split('@')[0] || creatorName)
    : (seedCreatorData?.displayName || creatorName);
  const avatarUrl = (userId || isHandleBranch)
    ? (profile?.avatar_url || seedCreatorData?.avatar || '')
    : (seedCreatorData?.avatar || '');
  const creatorLooks = (userId || isHandleBranch) ? userLooks : seedCreatorLooks;

  // Brand-grouped product list - powers the Shop tab chips.
  const allProducts = useMemo(() => {
    if (userId || isHandleBranch) return userProducts;
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
  }, [userId, isHandleBranch, userProducts, seedCreatorLooks]);

  const brandCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    allProducts.forEach(p => {
      const brand = p.brand || 'Other';
      counts[brand] = (counts[brand] || 0) + 1;
    });
    return counts;
  }, [allProducts]);

  const [activeBrand, setActiveBrand] = useState<string | null>(null);
  const filteredProducts = useMemo(() => {
    if (!activeBrand) return allProducts;
    return allProducts.filter(p => (p.brand || 'Other') === activeBrand);
  }, [allProducts, activeBrand]);

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
  const [followBusy, setFollowBusy] = useState(false);
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
      const { following: next } = await toggleFollow(followHandle);
      setFollowing(next);
    } catch {
      // Revert on error
      setFollowing(prev);
      setFollowerCount(n => (n ?? 0) + (prev ? 1 : -1));
    } finally {
      setFollowBusy(false);
    }
  }, [following, followBusy, followHandle, currentUser]);

  // Cheap deterministic "trusted by X.Yk" stat - seeded by the userId so
  // it doesn't change on every render. For seed creators we use the
  // creator handle as the seed.
  const trustCount = useMemo(() => {
    const seed = userId || creatorName;
    let h = 0;
    for (let i = 0; i < seed.length; i++) h = ((h << 5) - h + seed.charCodeAt(i)) | 0;
    const k = Math.abs(h % 90) / 10 + 1; // 1.0 - 10.0
    return `${k.toFixed(1)}k`;
  }, [userId, creatorName]);

  // Initial-letter avatar fallback when profile.avatar_url is missing.
  const initial = (displayName || 'U').trim().charAt(0).toUpperCase() || 'U';

  // The creator's chosen theme applies for everyone. Light catalogs wrap
  // the page in `.light-mode` so the global descendant rules
  // (.light-mode .creator-*) recolor it; dark (default) renders as-is.
  const wrapClass = catalogTheme === 'light' ? 'creator-theme-wrap light-mode' : undefined;

  return (
    <div className={wrapClass}>
    <div className="creator-page">
      <button className="creator-back" onClick={onClose}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        Back
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
        ) : avatarUrl ? (
          <img className="creator-hero-avatar" src={avatarUrl} alt={displayName} />
        ) : (
          <div className="creator-hero-avatar creator-hero-avatar--initial">{initial}</div>
        )}
        <span className="creator-hero-curated">Curated by</span>
        <h1 className="creator-hero-name">{displayName}</h1>
        <button
          className="creator-follow-btn"
          onClick={onToggleFollow}
          disabled={followBusy}
          aria-pressed={following}
          style={following ? { background: '#fff', color: '#0f172a', border: '1px solid #cbd5e1' } : undefined}
        >
          {following ? 'Following' : 'Follow'}
        </button>
        <p className="creator-hero-trust">
          {creatorLooks.length > 0
            ? `${creatorLooks.length} look${creatorLooks.length === 1 ? '' : 's'} · ${allProducts.length} product${allProducts.length === 1 ? '' : 's'} · ${formatFollowerCount(followerCount, trustCount)}`
            : loading
              ? 'Loading catalog...'
              : formatFollowerCount(followerCount, trustCount)}
        </p>
        <div className="creator-hero-socials">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/></svg>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.34-6.34V8.98a8.18 8.18 0 004.76 1.52V7.05a4.83 4.83 0 01-1-.36z"/></svg>
        </div>
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
          Shop {allProducts.length > 0 && <span className="creator-nav-count">{allProducts.length}</span>}
        </button>
      </div>

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
          <div className="creator-skeleton-grid">
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
          <div className="creator-grid">
            {creatorLooks.map(look => (
              <LookCard
                key={look.id}
                look={look}
                className="look-card"
                onOpenLook={onOpenLook}
                onOpenCreator={() => {}}
                onCreateCatalog={onCreateCatalog}
                hideCreator
              />
            ))}
          </div>
        )
      )}

      {/* Products grid */}
      {activeTab === 'products' && (
        loading && allProducts.length === 0 ? (
          <div className="creator-skeleton-grid">
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
          <div className="creator-products-grid">
            {filteredProducts.map((p, i) => (
              <div
                key={`${p.brand}-${p.name}-${i}`}
                className="creator-product-card"
                onClick={() => handleProductClick(p)}
              >
                <div className="creator-product-img">
                  {p.image ? (
                    <img src={p.image} alt={p.name} loading="lazy" decoding="async" />
                  ) : (
                    <div className="creator-product-placeholder" />
                  )}
                </div>
                <div className="creator-product-info">
                  {p.brand && <span className="creator-product-brand">{p.brand}</span>}
                  <span className="creator-product-name">{p.name}</span>
                  {p.price && <span className="creator-product-price">{p.price}</span>}
                </div>
              </div>
            ))}
          </div>
        )
      )}
    </div>
    </div>
  );
}

// ── helpers ────────────────────────────────────────────────────────────
function hashUuid(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return h;
}

function toTitleCase(s: string): string {
  return s.replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
