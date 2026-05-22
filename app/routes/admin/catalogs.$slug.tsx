import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from '@remix-run/react';
import {
  getCatalogBySlug,
  getCatalogProducts,
  autoAssignCatalogProducts,
  autoAssignLookProducts,
  removeCatalogProduct,
  updateCatalogToggles,
  getCatalogSearchCounts,
  type Catalog,
  type CatalogProductDetail,
  type CatalogSearchCounts,
} from '~/services/catalogs';
import { supabase } from '~/utils/supabase';
import { getFeedSearchResults } from '~/services/feed-search';
import type { ProductAd } from '~/services/product-creative';

interface CatalogLookRow {
  legacyId: number | null;
  title: string;
  productCount: number;
  videoPath: string | null;
}

export default function AdminCatalogDetail() {
  const { slug } = useParams<{ slug: string }>();
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [products, setProducts] = useState<CatalogProductDetail[]>([]);
  const [looks, setLooks] = useState<CatalogLookRow[]>([]);
  const [feedResults, setFeedResults] = useState<ProductAd[]>([]);
  const [feedResultsLoading, setFeedResultsLoading] = useState(false);
  const [searchCounts, setSearchCounts] = useState<CatalogSearchCounts | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!slug) return;
    setLoading(true);
    const c = await getCatalogBySlug(slug);
    setCatalog(c);
    if (!c) {
      setLoading(false);
      return;
    }
    const [prods, lookRows] = await Promise.all([
      getCatalogProducts(c.id),
      fetchCatalogLooks(c.id),
    ]);
    setProducts(prods);
    setLooks(lookRows);
    setLoading(false);

    // Search counts for this catalog name
    getCatalogSearchCounts([c.name]).then(r => setSearchCounts(r[0] ?? null)).catch(() => {});

    // Mirror the consumer feed search for this catalog name so admins can
    // see exactly what a shopper would see if they typed the catalog name
    // into the feed search bar. Fired in the background - the main page
    // doesn't block on it.
    setFeedResultsLoading(true);
    try {
      const ads = await getFeedSearchResults(c.name);
      setFeedResults(ads.filter(a => !!a.video_url));
    } catch (err) {
      console.warn('[AdminCatalogDetail] feed search failed:', err);
      setFeedResults([]);
    } finally {
      setFeedResultsLoading(false);
    }
  }, [slug]);

  useEffect(() => { refresh(); }, [refresh]);

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };

  const handleAutoAssignProducts = async () => {
    if (!catalog) return;
    setBusy('products');
    const result = await autoAssignCatalogProducts(catalog.id, { limit: 24 });
    setBusy(null);
    flash(`Auto-assigned ${result.inserted} products (${result.totalCandidates} candidates above threshold).`);
    refresh();
  };

  const handleAutoAssignLookProducts = async () => {
    if (!catalog) return;
    setBusy('looks');
    const result = await autoAssignLookProducts(catalog.id, { perLook: 5 });
    setBusy(null);
    flash(`Pushed ${result.productsInserted} products onto ${result.looksTouched} looks.`);
    refresh();
  };

  const handleRemoveProduct = async (productId: string) => {
    if (!catalog) return;
    const ok = await removeCatalogProduct(catalog.id, productId);
    if (ok) refresh();
  };

  if (loading) {
    return <div className="admin-page"><p style={{ padding: 24, color: '#888' }}>Loading…</p></div>;
  }
  if (!catalog) {
    return (
      <div className="admin-page">
        <h1>Catalog not found</h1>
        <Link to="/admin/catalogs" className="admin-btn admin-btn-secondary">← Back to catalogs</Link>
      </div>
    );
  }

  return (
    <div className="admin-page">
      <Link to="/admin/catalogs" style={{ fontSize: 12, color: '#888', textDecoration: 'none' }}>← Catalogs</Link>
      <div className="admin-page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginTop: 4 }}>
        <div style={{ maxWidth: 640 }}>
          <h1 style={{ marginBottom: 4 }}>{catalog.name}</h1>
          <div style={{ fontFamily: 'monospace', fontSize: 12, color: '#888', marginBottom: 8 }}>{catalog.slug}</div>
          {catalog.description && <p style={{ margin: 0, color: '#555' }}>{catalog.description}</p>}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className="admin-btn admin-btn-secondary"
            onClick={handleAutoAssignProducts}
            disabled={busy !== null}
            title="Score products against this catalog's theme prompt and refresh the palette."
          >
            {busy === 'products' ? 'Scoring…' : '↻ Auto-assign products'}
          </button>
          <button
            className="admin-btn admin-btn-primary"
            onClick={handleAutoAssignLookProducts}
            disabled={busy !== null || products.length === 0 || looks.length === 0}
            title="Push the top palette products onto every look in this catalog."
          >
            {busy === 'looks' ? 'Fanning out…' : '⇣ Push to looks'}
          </button>
        </div>
      </div>

      {toast && (
        <div style={{ background: '#ecfdf5', color: '#047857', border: '1px solid #a7f3d0', padding: '8px 12px', borderRadius: 6, marginBottom: 12, fontSize: 13 }}>
          {toast}
        </div>
      )}

      {/* Home catalog banner */}
      {catalog.isHome && (
        <div style={{ padding: '8px 12px', borderRadius: 6, background: '#fef9c3', border: '1px solid #fde047', color: '#713f12', fontSize: 12, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 14 }}>🏠</span>
          <span><strong>Home feed catalog.</strong> Products here pin to the top of the consumer landing feed before the organic creative stream.</span>
        </div>
      )}

      {/* Feed-control toggles */}
      <div style={{ display: 'flex', gap: 12, padding: '0 0 16px', flexWrap: 'wrap' }}>
        {([
          { key: 'filterGender'       as const, label: 'Gender filter',        desc: "Hide products whose gender tag mismatches the shopper's profile" },
          { key: 'filterAge'          as const, label: 'Age filter',            desc: 'Hide age_group-mismatched products (run tag-product-age-groups.mjs first)', disabled: true },
          { key: 'boostTopConverting' as const, label: 'Top-converting first', desc: 'Sort pinned block by conversion_score desc' },
        ]).map(t => {
          const on = !!(catalog as Record<string, unknown>)[t.key];
          return (
            <div
              key={t.key}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px',
                borderRadius: 8, border: `1px solid ${on ? '#111' : '#e5e7eb'}`,
                background: on ? '#f8fafc' : '#fff', opacity: t.disabled ? 0.5 : 1,
              }}
            >
              <button
                role="switch"
                aria-checked={on}
                disabled={t.disabled}
                onClick={async () => {
                  if (t.disabled) return;
                  const next = !on;
                  setCatalog(prev => prev ? { ...prev, [t.key]: next } : prev);
                  await updateCatalogToggles(catalog.slug, { [t.key]: next });
                }}
                title={t.disabled ? 'Run scripts/tag-product-age-groups.mjs first' : undefined}
                style={{
                  width: 36, height: 20, borderRadius: 10, border: 'none',
                  background: on ? '#111' : '#d1d5db', position: 'relative',
                  cursor: t.disabled ? 'not-allowed' : 'pointer', flexShrink: 0,
                  transition: 'background 0.15s',
                }}
              >
                <span style={{
                  position: 'absolute', top: 2, left: on ? 18 : 2,
                  width: 16, height: 16, borderRadius: '50%', background: '#fff',
                  transition: 'left 0.15s',
                }} />
              </button>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#111' }}>{t.label}</div>
                <div style={{ fontSize: 11, color: '#888' }}>{t.desc}</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Search activity */}
      {searchCounts && (
        <div style={{ display: 'flex', gap: 12, padding: '0 0 16px', flexWrap: 'wrap' }}>
          {([
            { label: 'Searches 24h',   value: searchCounts.count24h },
            { label: 'Searches 7d',    value: searchCounts.count7d },
            { label: 'Searches total', value: searchCounts.countTotal },
          ] as const).map(s => (
            <div key={s.label} style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid #e5e7eb', background: '#fff', minWidth: 100, textAlign: 'center' }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#111' }}>{s.value.toLocaleString()}</div>
              <div style={{ fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{s.label}</div>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 24, padding: '12px 0 16px' }}>
        <Stat label="Looks in catalog" value={looks.length} />
        <Stat label="Products in palette" value={products.length} />
        <Stat label="Manual" value={products.filter(p => p.source === 'manual').length} />
        <Stat label="Auto" value={products.filter(p => p.source === 'auto').length} />
      </div>

      <h2 style={{ fontSize: 14, fontWeight: 600, margin: '8px 0', color: '#111' }}>Looks</h2>
      <div className="admin-table-wrap" style={{ marginBottom: 24 }}>
        <table className="admin-table">
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>Look</th>
              <th>Products attached</th>
            </tr>
          </thead>
          <tbody>
            {looks.length === 0 && (
              <tr><td colSpan={2} style={{ textAlign: 'center', padding: 16, color: '#888' }}>No looks attached.</td></tr>
            )}
            {looks.map(l => (
              <tr key={`${l.legacyId}-${l.title}`}>
                <td style={{ textAlign: 'left' }}>
                  <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#888', marginRight: 8 }}>#{l.legacyId ?? ' - '}</span>
                  {l.title}
                </td>
                <td style={{ fontSize: 12, color: '#555' }}>{l.productCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 style={{ fontSize: 14, fontWeight: 600, margin: '8px 0', color: '#111' }}>Product palette</h2>
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>Product</th>
              <th>Brand</th>
              <th>Price</th>
              <th>Score</th>
              <th>Source</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {products.length === 0 && (
              <tr><td colSpan={6} style={{ textAlign: 'center', padding: 16, color: '#888' }}>
                Empty palette - try “Auto-assign products”.
              </td></tr>
            )}
            {products.map(p => (
              <tr key={p.productId}>
                <td style={{ textAlign: 'left' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {p.imageUrl && (
                      <img src={p.imageUrl} alt="" width={28} height={28} style={{ borderRadius: 4, objectFit: 'cover' }} />
                    )}
                    <span style={{ fontWeight: 500 }}>{p.name}</span>
                  </div>
                </td>
                <td style={{ fontSize: 12, color: '#555' }}>{p.brand}</td>
                <td style={{ fontSize: 12, color: '#555' }}>{p.price ?? ' - '}</td>
                <td style={{ fontSize: 12, color: '#666' }}>{p.matchScore != null ? p.matchScore.toFixed(3) : ' - '}</td>
                <td>
                  <span style={{
                    padding: '2px 8px',
                    borderRadius: 4,
                    fontSize: 10,
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                    background: p.source === 'auto' ? '#fef3c7' : p.source === 'imported' ? '#e0f2fe' : '#ecfdf5',
                    color:      p.source === 'auto' ? '#92400e' : p.source === 'imported' ? '#075985' : '#047857',
                  }}>
                    {p.source}
                  </span>
                </td>
                <td>
                  <button
                    className="admin-btn admin-btn-secondary"
                    style={{ fontSize: 11, padding: '3px 8px', color: '#dc2626' }}
                    onClick={() => handleRemoveProduct(p.productId)}
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 style={{ fontSize: 14, fontWeight: 600, margin: '24px 0 8px', color: '#111' }}>
        Feed search results
        <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 400, color: '#888' }}>
          What a shopper sees when they search &ldquo;{catalog.name}&rdquo; in the feed
        </span>
      </h2>
      {feedResultsLoading && feedResults.length === 0 ? (
        <div style={{ padding: 16, color: '#888', fontSize: 12 }}>Loading feed results…</div>
      ) : feedResults.length === 0 ? (
        <div style={{ padding: 16, color: '#888', fontSize: 12 }}>No creatives surface for this query in the consumer feed.</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8 }}>
          {feedResults.map(ad => (
            <FeedResultThumb key={ad.id} ad={ad} />
          ))}
        </div>
      )}
    </div>
  );
}

function FeedResultThumb({ ad }: { ad: ProductAd }) {
  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 6, overflow: 'hidden', background: '#111' }}>
      <div style={{ width: '100%', aspectRatio: '9/16', background: '#000' }}>
        {ad.video_url ? (
          <video
            src={ad.video_url}
            poster={ad.thumbnail_url ?? undefined}
            muted
            loop
            playsInline
            preload="metadata"
            onMouseEnter={e => { (e.currentTarget as HTMLVideoElement).play().catch(() => {}); }}
            onMouseLeave={e => {
              const v = e.currentTarget as HTMLVideoElement;
              v.pause();
              v.currentTime = 0;
            }}
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        ) : null}
      </div>
      <div style={{ padding: 6, background: '#fff' }}>
        <div style={{ fontSize: 10, color: '#888', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {ad.product?.brand ?? ' - '}
        </div>
        <div style={{ fontSize: 11, fontWeight: 600, color: '#111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {ad.product?.name ?? ' - '}
        </div>
      </div>
    </div>
  );
}

async function fetchCatalogLooks(catalogId: string): Promise<CatalogLookRow[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('catalog_looks')
    .select(`
      sort_order,
      looks!inner (
        id, legacy_id, title, status, enabled, archived_at,
        looks_creative!inner ( video_url, is_primary )
      )
    `)
    .eq('catalog_id', catalogId)
    .eq('looks.status', 'live')
    .eq('looks.enabled', true)
    .is('looks.archived_at', null)
    .eq('looks.looks_creative.is_primary', true)
    .order('sort_order', { ascending: true });
  if (error || !data) return [];

  type Row = {
    sort_order: number;
    looks: {
      id: string;
      legacy_id: number | null;
      title: string;
      looks_creative: { video_url: string | null; is_primary: boolean }[];
    };
  };
  const rows = data as unknown as Row[];

  let counts: Record<string, number> = {};
  const lookIds = rows.map(r => r.looks.id);
  if (lookIds.length > 0) {
    const { data: lpRows } = await supabase
      .from('look_products')
      .select('look_id')
      .in('look_id', lookIds);
    if (lpRows) {
      counts = (lpRows as { look_id: string }[]).reduce((acc, r) => {
        acc[r.look_id] = (acc[r.look_id] ?? 0) + 1;
        return acc;
      }, {} as Record<string, number>);
    }
  }

  return rows.map(r => ({
    legacyId: r.looks.legacy_id,
    title: r.looks.title,
    videoPath: r.looks.looks_creative?.[0]?.video_url ?? null,
    productCount: counts[r.looks.id] ?? 0,
  }));
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
      <span style={{ fontSize: 16, fontWeight: 700, color: '#111' }}>{value}</span>
      <span style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</span>
    </div>
  );
}
