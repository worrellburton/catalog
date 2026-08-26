// /style/showroom — the human stylist's curated product picks (Phase 2.4).
//
// A signed-in human stylist manages three gender bins (Men / Women / Unisex).
// Adds by searching the shared product catalog; removes by tapping a tile.
// Non-stylist visitors get a pointer to /style/apply.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from '@remix-run/react';
import { supabase } from '~/utils/supabase';
import { useAuth } from '~/hooks/useAuth';
import { searchProducts } from '~/services/manage-looks';
import { StylePageHeader } from '~/components/style-up/StylePageHeader';
import '~/styles/style-up.css';

type Gender = 'men' | 'women' | 'unisex';

interface StylistRow {
  id: string;
  name: string;
}
interface ShowroomProduct {
  product_id: string;
  gender: Gender;
  sort: number;
  name: string | null;
  brand: string | null;
  image_url: string | null;
  price: string | null;
}
interface SearchHit {
  id: string;
  name: string;
  brand: string | null;
  price: string | null;
  image_url: string | null;
}

const GENDERS: Gender[] = ['men', 'women', 'unisex'];

export default function StyleShowroomRoute() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [stylist, setStylist] = useState<StylistRow | null>(null);
  const [items, setItems] = useState<ShowroomProduct[]>([]);
  const [gender, setGender] = useState<Gender>('women');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);

  // Load: is this user a human stylist? If yes, load their showroom.
  useEffect(() => {
    if (!user) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      const { data: s, error: se } = await supabase
        .from('style_up_stylists')
        .select('id, name')
        .eq('human_user_id', user.id)
        .maybeSingle();
      if (cancelled) return;
      if (se) { setError(se.message); setLoading(false); return; }
      setStylist(s as StylistRow | null);
      if (!s) { setLoading(false); return; }
      const { data: p, error: pe } = await supabase
        .from('stylist_showroom_products')
        .select('product_id, gender, sort, products(name, brand, image_url, price)')
        .eq('stylist_id', (s as StylistRow).id)
        .order('sort', { ascending: true });
      if (cancelled) return;
      if (pe) { setError(pe.message); setLoading(false); return; }
      setItems((p as unknown as Array<{
        product_id: string; gender: Gender; sort: number;
        products: { name: string | null; brand: string | null; image_url: string | null; price: string | null } | null;
      }>).map(r => ({
        product_id: r.product_id,
        gender: r.gender,
        sort: r.sort,
        name: r.products?.name ?? null,
        brand: r.products?.brand ?? null,
        image_url: r.products?.image_url ?? null,
        price: r.products?.price ?? null,
      })));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [user]);

  // Debounced product search — reuses the same helper the admin look editor uses.
  useEffect(() => {
    if (!searchOpen) { setResults([]); return; }
    if (query.trim().length < 2) { setResults([]); return; }
    const q = query.trim();
    setSearching(true);
    const t = setTimeout(async () => {
      const rows = await searchProducts(q);
      setResults(rows as SearchHit[]);
      setSearching(false);
    }, 180);
    return () => clearTimeout(t);
  }, [query, searchOpen]);

  const addProduct = useCallback(async (productId: string) => {
    if (!stylist) return;
    const nextSort = (items.filter(i => i.gender === gender).at(-1)?.sort ?? -1) + 1;
    const hit = results.find(r => r.id === productId);
    setError(null);
    const { error } = await supabase.from('stylist_showroom_products').insert({
      stylist_id: stylist.id,
      product_id: productId,
      gender,
      sort: nextSort,
    });
    if (error) {
      if (error.code === '23505') {
        // Already added — surface a gentle message rather than an error.
        setError('Already in this bin.');
        return;
      }
      setError(error.message);
      return;
    }
    // Optimistic local insert so the tile appears immediately.
    setItems(prev => [...prev, {
      product_id: productId,
      gender,
      sort: nextSort,
      name: hit?.name ?? null,
      brand: hit?.brand ?? null,
      image_url: hit?.image_url ?? null,
      price: hit?.price ?? null,
    }]);
    setQuery('');
    setResults([]);
  }, [stylist, gender, items, results]);

  const removeProduct = useCallback(async (productId: string) => {
    if (!stylist) return;
    const prev = items;
    setItems(items.filter(i => !(i.product_id === productId && i.gender === gender)));
    const { error } = await supabase
      .from('stylist_showroom_products')
      .delete()
      .eq('stylist_id', stylist.id)
      .eq('product_id', productId)
      .eq('gender', gender);
    if (error) { setError(error.message); setItems(prev); }
  }, [stylist, gender, items]);

  const visible = useMemo(() => items.filter(i => i.gender === gender), [items, gender]);

  if (authLoading || loading) {
    return <div className="su-apply su-sub su-apply--loading">Loading…</div>;
  }

  if (!user) {
    return (
      <div className="su-apply su-sub">
        <StylePageHeader title="Showroom" onBack={() => navigate('/style')} backLabel="Back to Style" />
        <p className="su-sub-lede">Sign in to manage your showroom.</p>
      </div>
    );
  }

  if (!stylist) {
    return (
      <div className="su-apply su-sub">
        <StylePageHeader title="Showroom" onBack={() => navigate('/style')} backLabel="Back to Style" />
        <p className="su-sub-lede">You&apos;re not a stylist yet. Apply first. Once approved, this is where your picks live.</p>
        <div className="su-apply-actions">
          <button type="button" className="su-apply-cta" onClick={() => navigate('/style/apply')}>Apply</button>
        </div>
      </div>
    );
  }

  return (
    <div className="su-showroom su-sub">
      <StylePageHeader
        title={`${stylist.name}’s showroom`}
        onBack={() => navigate('/style')}
        backLabel="Back to Style"
        actions={
          <button type="button" className="su-apply-back" onClick={() => navigate('/style/inbox')}>Inbox</button>
        }
      />

      <div className="su-showroom-tabs" role="tablist">
        {GENDERS.map(g => (
          <button
            key={g}
            type="button"
            role="tab"
            aria-selected={gender === g}
            className={'su-showroom-tab' + (gender === g ? ' is-active' : '')}
            onClick={() => setGender(g)}
          >
            {g === 'unisex' ? 'Unisex' : g === 'men' ? 'Men' : 'Women'}
            <span className="su-showroom-tab-count">
              {items.filter(i => i.gender === g).length}
            </span>
          </button>
        ))}
      </div>

      <div className="su-showroom-grid">
        {visible.map(p => (
          <div key={p.product_id} className="su-showroom-tile">
            {p.image_url
              ? <img src={p.image_url} alt="" loading="lazy" />
              : <div className="su-showroom-tile-placeholder" />}
            <div className="su-showroom-tile-info">
              <span className="su-showroom-tile-name">{p.name ?? 'Untitled'}</span>
              {p.brand && <span className="su-showroom-tile-brand">{p.brand}</span>}
            </div>
            <button
              type="button"
              className="su-showroom-tile-remove"
              onClick={() => void removeProduct(p.product_id)}
              aria-label="Remove"
            >×</button>
          </div>
        ))}
        <button
          type="button"
          className="su-showroom-add"
          onClick={() => setSearchOpen(true)}
        >
          + Add product
        </button>
      </div>

      {error && <div className="su-apply-error">{error}</div>}

      {searchOpen && (
        <div className="su-showroom-search-sheet" role="dialog" aria-label="Add a product">
          <div className="su-showroom-search-head">
            <input
              type="text"
              autoFocus
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={`Search catalog for ${gender === 'unisex' ? 'a piece' : gender === 'men' ? "men's" : "women's"} pieces…`}
            />
            <button type="button" className="su-apply-back" onClick={() => { setSearchOpen(false); setQuery(''); setResults([]); }}>Done</button>
          </div>
          <div className="su-showroom-search-results">
            {searching && <div className="su-empty">Searching…</div>}
            {!searching && query.trim().length >= 2 && results.length === 0 && (
              <div className="su-empty">No matches.</div>
            )}
            {results.map(r => {
              const alreadyIn = items.some(i => i.product_id === r.id && i.gender === gender);
              return (
                <button
                  key={r.id}
                  type="button"
                  className="su-showroom-hit"
                  disabled={alreadyIn}
                  onClick={() => void addProduct(r.id)}
                >
                  {r.image_url && <img src={r.image_url} alt="" loading="lazy" />}
                  <div>
                    <div className="su-showroom-hit-name">{r.name}</div>
                    {r.brand && <div className="su-showroom-hit-brand">{r.brand}{r.price ? ` · ${r.price}` : ''}</div>}
                  </div>
                  <span className="su-showroom-hit-add">{alreadyIn ? 'Added' : 'Add'}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
