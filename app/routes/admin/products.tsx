import { useEffect, useMemo, useState, useCallback } from 'react';
import { useSearchParams } from '@remix-run/react';
import { supabase } from '~/utils/supabase';
import {
  getProductAnalytics,
  clickThroughRate,
  type ProductAnalyticsRow,
} from '~/services/analytics';
import { regeneratePrimaryPoster, PosterRegenError } from '~/services/regenerate-poster';

interface ProductVariant {
  size: string | null;
  color: string | null;
  availability: boolean | null;
}

interface FitIntelligence {
  fit_type: string;
  body_type_match: string[];
  warmth_rating: string;
  stretch_behavior: string;
  true_to_size: string;
  likely_feel: string;
  best_for_occasions: string[];
  layering: boolean;
  season: string[];
}

interface ProductEnrichment {
  scrape_status: string | null;
  type: string | null;
  gender: string | null;
  availability: string | null;
  url: string | null;
  images: string[] | null;
  size_fit: string | null;
  materials_care: string | null;
  variants: ProductVariant[] | null;
  size_chart: Record<string, Record<string, number>> | null;
  fit_intelligence: FitIntelligence | null;
  materials_structured: { fiber: string; percentage: number | null }[] | null;
  product_taxonomy: { category: string; subcategory: string; style: string | null } | null;
  styling_metadata: { works_with: string[]; occasion: string[]; season: string[] } | null;
  confidence_scores: Record<string, number> | null;
  description_enriched: boolean | null;
}

interface ProductRow {
  id: string;
  name: string | null;
  brand: string | null;
  price: string | null;
  image_url: string | null;
  primary_image_url: string | null;
  primary_video_url: string | null;
  primary_video_poster_url: string | null;
  created_at: string;
}

// ── Confidence score bar ──────────────────────────────────────────────
function ScoreBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color = pct >= 80 ? '#22c55e' : pct >= 50 ? '#f59e0b' : '#ef4444';
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{
        display: 'inline-block', width: 64, height: 4,
        background: '#eee', borderRadius: 99, overflow: 'hidden',
      }}>
        <span style={{ display: 'block', height: '100%', width: `${pct}%`, background: color, borderRadius: 99 }} />
      </span>
      <span style={{ fontSize: 11, color: '#888', minWidth: 26 }}>{pct}%</span>
    </span>
  );
}

// ── Expanded product enrichment panel ────────────────────────────────
function ProductEnrichmentPanel({ productId }: { productId: string }) {
  const [data, setData] = useState<ProductEnrichment | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase) return;
    supabase
      .from('products')
      .select(
        'scrape_status, type, gender, availability, url, images, ' +
        'size_fit, materials_care, variants, size_chart, fit_intelligence, ' +
        'materials_structured, product_taxonomy, styling_metadata, ' +
        'confidence_scores, description_enriched',
      )
      .eq('id', productId)
      .single()
      .then(({ data: d }) => {
        setData(d as ProductEnrichment | null);
        setLoading(false);
      });
  }, [productId]);

  if (loading) {
    return (
      <td colSpan={8}>
        <div className="admin-enrichment-panel">
          <div className="admin-empty" style={{ padding: '12px 0' }}>Loading enrichment data…</div>
        </div>
      </td>
    );
  }

  if (!data) {
    return (
      <td colSpan={8}>
        <div className="admin-enrichment-panel">
          <div className="admin-empty" style={{ padding: '12px 0' }}>No data found.</div>
        </div>
      </td>
    );
  }

  // Deduplicate variants by color to get unique color swatches
  const uniqueColors = data.variants
    ? [...new Set(data.variants.map(v => v.color).filter(Boolean))]
    : [];
  // Unique sizes
  const uniqueSizes = data.variants
    ? [...new Set(data.variants.map(v => v.size).filter(Boolean))]
    : [];

  return (
    <td colSpan={8}>
      <div className="admin-enrichment-panel">
        {/* Row 1: images strip */}
        {data.images && data.images.length > 0 && (
          <div className="admin-enrichment-images">
            {data.images.slice(0, 6).map((src, i) => (
              <img key={i} src={src} alt="" className="admin-enrichment-thumb" loading="lazy" />
            ))}
          </div>
        )}

        <div className="admin-enrichment-grid">
          {/* Card: Basic info */}
          <div className="admin-detail-card">
            <h3>Product info</h3>
            <div className="admin-detail-rows">
              <div className="admin-detail-row"><span>Status</span>
                <span className={data.scrape_status === 'done' ? 'admin-status-active' : ''}>
                  {data.scrape_status || '—'}
                </span>
              </div>
              <div className="admin-detail-row"><span>Type</span><span>{data.type || '—'}</span></div>
              <div className="admin-detail-row"><span>Gender</span><span>{data.gender || '—'}</span></div>
              <div className="admin-detail-row"><span>Availability</span><span>{data.availability || '—'}</span></div>
              {data.product_taxonomy && (
                <>
                  <div className="admin-detail-row"><span>Category</span><span>{data.product_taxonomy.subcategory}</span></div>
                  {data.product_taxonomy.style && (
                    <div className="admin-detail-row"><span>Style</span><span>{data.product_taxonomy.style}</span></div>
                  )}
                </>
              )}
              {data.description_enriched && (
                <div className="admin-detail-row"><span>Description</span>
                  <span className="admin-status-active">AI-enriched ✓</span>
                </div>
              )}
            </div>
          </div>

          {/* Card: Size & Fit */}
          <div className="admin-detail-card">
            <h3>Size &amp; fit</h3>
            <div className="admin-detail-rows">
              {data.size_fit && (
                <div className="admin-detail-row" style={{ flexDirection: 'column', gap: 4 }}>
                  <span>Fit notes</span>
                  <span style={{ color: '#333', fontSize: 12, lineHeight: 1.5 }}>{data.size_fit}</span>
                </div>
              )}
              {data.fit_intelligence && (
                <>
                  <div className="admin-detail-row"><span>Fit type</span><span>{data.fit_intelligence.fit_type}</span></div>
                  <div className="admin-detail-row"><span>Sizing</span><span>{data.fit_intelligence.true_to_size?.replace(/_/g, ' ')}</span></div>
                  <div className="admin-detail-row"><span>Warmth</span><span>{data.fit_intelligence.warmth_rating}</span></div>
                  <div className="admin-detail-row"><span>Stretch</span><span>{data.fit_intelligence.stretch_behavior}</span></div>
                  <div className="admin-detail-row"><span>Layering</span><span>{data.fit_intelligence.layering ? 'Yes' : 'No'}</span></div>
                  {data.fit_intelligence.season?.length > 0 && (
                    <div className="admin-detail-row"><span>Seasons</span>
                      <span>{data.fit_intelligence.season.join(', ')}</span>
                    </div>
                  )}
                  {data.fit_intelligence.body_type_match?.length > 0 && (
                    <div className="admin-detail-row" style={{ flexDirection: 'column', gap: 4 }}>
                      <span>Body types</span>
                      <div className="admin-enrichment-chips">
                        {data.fit_intelligence.body_type_match.map(b => (
                          <span key={b} className="admin-enrichment-chip">{b}</span>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
              {!data.size_fit && !data.fit_intelligence && (
                <div className="admin-detail-row"><span style={{ color: '#bbb' }}>Not extracted yet</span></div>
              )}
            </div>
          </div>

          {/* Card: Materials */}
          <div className="admin-detail-card">
            <h3>Materials &amp; care</h3>
            <div className="admin-detail-rows">
              {data.materials_care && (
                <div className="admin-detail-row" style={{ flexDirection: 'column', gap: 4 }}>
                  <span>Raw</span>
                  <span style={{ color: '#333', fontSize: 12, lineHeight: 1.5 }}>{data.materials_care}</span>
                </div>
              )}
              {data.materials_structured && data.materials_structured.length > 0 && (
                <div className="admin-detail-row" style={{ flexDirection: 'column', gap: 6 }}>
                  <span>Composition</span>
                  {data.materials_structured.map((m, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                      <span style={{ textTransform: 'capitalize' }}>{m.fiber}</span>
                      <span style={{ color: '#888' }}>{m.percentage != null ? `${m.percentage}%` : '—'}</span>
                    </div>
                  ))}
                </div>
              )}
              {!data.materials_care && !data.materials_structured && (
                <div className="admin-detail-row"><span style={{ color: '#bbb' }}>Not extracted yet</span></div>
              )}
            </div>
          </div>

          {/* Card: Variants */}
          {(uniqueSizes.length > 0 || uniqueColors.length > 0) && (
            <div className="admin-detail-card">
              <h3>Variants ({data.variants?.length ?? 0})</h3>
              <div className="admin-detail-rows">
                {uniqueSizes.length > 0 && (
                  <div className="admin-detail-row" style={{ flexDirection: 'column', gap: 6 }}>
                    <span>Sizes</span>
                    <div className="admin-enrichment-chips">
                      {uniqueSizes.map(s => (
                        <span key={s} className="admin-enrichment-chip admin-enrichment-chip--size">{s}</span>
                      ))}
                    </div>
                  </div>
                )}
                {uniqueColors.length > 0 && (
                  <div className="admin-detail-row" style={{ flexDirection: 'column', gap: 6 }}>
                    <span>Colors</span>
                    <div className="admin-enrichment-chips">
                      {uniqueColors.map(c => (
                        <span key={c} className="admin-enrichment-chip">{c}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Card: Size chart */}
          {data.size_chart && Object.keys(data.size_chart).length > 0 && (
            <div className="admin-detail-card admin-detail-card--wide">
              <h3>Size chart</h3>
              <div style={{ overflowX: 'auto' }}>
                <table className="admin-enrichment-size-table">
                  <thead>
                    <tr>
                      <th>Size</th>
                      {Object.keys(Object.values(data.size_chart)[0] || {}).map(k => (
                        <th key={k}>{k.replace(/_cm$/, '').replace(/_/g, ' ')}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(data.size_chart).map(([size, meas]) => (
                      <tr key={size}>
                        <td><strong>{size}</strong></td>
                        {Object.values(meas).map((v, i) => (
                          <td key={i}>{typeof v === 'number' ? `${v} cm` : v}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Card: Styling */}
          {data.styling_metadata && (
            <div className="admin-detail-card">
              <h3>Styling</h3>
              <div className="admin-detail-rows">
                {data.styling_metadata.occasion?.length > 0 && (
                  <div className="admin-detail-row" style={{ flexDirection: 'column', gap: 6 }}>
                    <span>Occasions</span>
                    <div className="admin-enrichment-chips">
                      {data.styling_metadata.occasion.map(o => (
                        <span key={o} className="admin-enrichment-chip admin-enrichment-chip--occasion">{o}</span>
                      ))}
                    </div>
                  </div>
                )}
                {data.styling_metadata.works_with?.length > 0 && (
                  <div className="admin-detail-row" style={{ flexDirection: 'column', gap: 6 }}>
                    <span>Pairs with</span>
                    <div className="admin-enrichment-chips">
                      {data.styling_metadata.works_with.map(w => (
                        <span key={w} className="admin-enrichment-chip">{w}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Card: Confidence scores */}
          {data.confidence_scores && Object.keys(data.confidence_scores).length > 0 && (
            <div className="admin-detail-card">
              <h3>Confidence scores</h3>
              <div className="admin-detail-rows">
                {Object.entries(data.confidence_scores)
                  .sort(([, a], [, b]) => b - a)
                  .map(([field, score]) => (
                    <div key={field} className="admin-detail-row">
                      <span style={{ textTransform: 'capitalize' }}>{field.replace(/_/g, ' ')}</span>
                      <ScoreBar value={score} />
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>

        {data.url && (
          <div style={{ padding: '8px 0 0', fontSize: 12 }}>
            <a href={data.url} target="_blank" rel="noopener noreferrer"
              style={{ color: '#6366f1', textDecoration: 'none' }}
            >
              {data.url}
            </a>
          </div>
        )}
      </div>
    </td>
  );
}

/**
 * Admin Products — full catalog with live engagement metrics. Rows are
 * the supabase `products` table; impressions / clicks / clickouts / CTR
 * come from `product_analytics_summary()` and refresh in realtime when
 * a `user_events` row lands (debounced 400ms).
 */
export default function AdminProducts() {
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [analytics, setAnalytics] = useState<ProductAnalyticsRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  // Products with an in-flight poster regeneration, and the last error per row.
  const [regenerating, setRegenerating] = useState<Set<string>>(new Set());
  const [regenError, setRegenError] = useState<Record<string, string>>({});

  const handleRowClick = useCallback((id: string) => {
    setSelectedId(prev => (prev === id ? null : id));
  }, []);

  const handleRegenerate = useCallback(async (p: ProductRow) => {
    setRegenError(prev => { const next = { ...prev }; delete next[p.id]; return next; });
    setRegenerating(prev => new Set(prev).add(p.id));
    try {
      const posterUrl = await regeneratePrimaryPoster(p.id, p.primary_video_url, p.primary_video_poster_url);
      setProducts(prev => prev.map(row => (row.id === p.id ? { ...row, primary_video_poster_url: posterUrl } : row)));
    } catch (err) {
      const msg = err instanceof PosterRegenError ? err.message : 'Poster regeneration failed.';
      setRegenError(prev => ({ ...prev, [p.id]: msg }));
    } finally {
      setRegenerating(prev => { const next = new Set(prev); next.delete(p.id); return next; });
    }
  }, []);
  const brandFilter = searchParams.get('brand') || null;

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    supabase
      .from('products')
      .select('id, name, brand, price, image_url, primary_image_url, primary_video_url, primary_video_poster_url, created_at')
      .order('created_at', { ascending: false })
      .limit(500)
      .then(({ data }) => {
        if (cancelled) return;
        setProducts((data ?? []) as ProductRow[]);
        setLoaded(true);
      });
    return () => { cancelled = true; };
  }, []);

  // Realtime: re-pull the per-product rollup every time a `user_events`
  // row lands (debounced 400ms so a scroll burst is one round trip).
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    let timer: number | null = null;
    const refetch = () => {
      getProductAnalytics().then(rows => {
        if (cancelled) return;
        setAnalytics(rows);
      });
    };
    refetch();
    const schedule = () => {
      if (timer != null) window.clearTimeout(timer);
      timer = window.setTimeout(refetch, 400);
    };
    const channel = supabase
      .channel('admin-products:user_events')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_events' }, schedule)
      .subscribe();
    return () => {
      cancelled = true;
      if (timer != null) window.clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, []);

  // Index analytics by product_id for O(1) lookup while rendering.
  const analyticsById = useMemo(() => {
    const map = new Map<string, ProductAnalyticsRow>();
    analytics.forEach(row => map.set(row.product_id, row));
    return map;
  }, [analytics]);

  const stats = useMemo(() => {
    const totalImpressions = analytics.reduce((sum, a) => sum + a.total_impressions, 0);
    const totalClicks      = analytics.reduce((sum, a) => sum + a.total_clicks,      0);
    const totalClickouts   = analytics.reduce((sum, a) => sum + a.total_clickouts,   0);
    const brands = new Set(products.map(p => (p.brand || '').toLowerCase()).filter(Boolean));
    return [
      { label: 'Products',  value: products.length.toLocaleString() },
      { label: 'Brands',    value: brands.size.toLocaleString() },
      { label: 'Impressions', value: totalImpressions.toLocaleString() },
      { label: 'Clicks',     value: totalClicks.toLocaleString() },
      { label: 'Clickouts',  value: totalClickouts.toLocaleString() },
    ];
  }, [products, analytics]);

  // Apply brand filter from URL (?brand=xxx) — set by the Analytics →
  // Brands tab "View products" eye button for quick drill-down.
  const displayedProducts = useMemo(() => {
    if (!brandFilter) return products;
    const lc = brandFilter.toLowerCase();
    return products.filter(p => (p.brand || '').toLowerCase() === lc);
  }, [products, brandFilter]);

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <h1>Products</h1>
        <p className="admin-page-subtitle">Product catalog and live engagement</p>
      </div>
      <div className="admin-stats-grid">
        {stats.map(s => (
          <div key={s.label} className="admin-stat-card">
            <span className="admin-stat-value">{s.value}</span>
            <span className="admin-stat-label">{s.label}</span>
          </div>
        ))}
      </div>
      {!loaded ? (
        <div className="admin-empty">Loading…</div>
      ) : (
        <div className="admin-table-wrap">
          {brandFilter && (
            <div className="admin-brand-filter-chip">
              <span>Filtered by brand: <strong>{brandFilter}</strong></span>
              <span className="admin-brand-filter-count">{displayedProducts.length} product{displayedProducts.length !== 1 ? 's' : ''}</span>
              <button
                className="admin-icon-btn"
                title="Clear filter"
                aria-label="Clear brand filter"
                onClick={() => setSearchParams(prev => { const out = new URLSearchParams(prev); out.delete('brand'); return out; }, { replace: true })}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>
          )}
          <table className="admin-table">
            <thead>
              <tr>
                <th>Product</th>
                <th>Brand</th>
                <th>Price</th>
                <th>Primary poster</th>
                <th className="admin-th-num">Impressions</th>
                <th className="admin-th-num">Clicks</th>
                <th className="admin-th-num">Clickouts</th>
                <th className="admin-th-num">CTR</th>
              </tr>
            </thead>
            <tbody>
              {displayedProducts.map(p => {
                const a = analyticsById.get(p.id);
                const ctr = a ? clickThroughRate(a) : null;
                const expanded = selectedId === p.id;
                return (
                  <>
                    <tr
                      key={p.id}
                      className="admin-clickable-row"
                      onClick={() => handleRowClick(p.id)}
                      aria-expanded={expanded}
                    >
                      <td className="admin-cell-product-name">
                        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          {p.image_url && (
                            <img
                              src={p.image_url}
                              alt=""
                              style={{ width: 32, height: 32, objectFit: 'cover', borderRadius: 6, flexShrink: 0 }}
                              loading="lazy"
                            />
                          )}
                          {p.name || '—'}
                        </span>
                      </td>
                      <td className="admin-cell-muted">{p.brand || '—'}</td>
                      <td>{p.price || '—'}</td>
                      <td onClick={e => e.stopPropagation()}>
                        {(() => {
                          const poster = p.primary_video_poster_url || p.primary_image_url;
                          const busy = regenerating.has(p.id);
                          const err = regenError[p.id];
                          return (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                              <span style={{
                                position: 'relative', width: 36, height: 48, borderRadius: 6, flexShrink: 0,
                                overflow: 'hidden', background: '#f1f5f9', display: 'inline-block',
                              }}>
                                {poster ? (
                                  <img
                                    src={poster}
                                    alt=""
                                    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', opacity: busy ? 0.4 : 1 }}
                                    loading="lazy"
                                  />
                                ) : (
                                  <span style={{ display: 'flex', width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center', fontSize: 9, color: '#bbb' }}>
                                    none
                                  </span>
                                )}
                                {busy && (
                                  <span style={{
                                    position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                                  }}>
                                    <span className="admin-spinner" style={{ width: 14, height: 14 }} />
                                  </span>
                                )}
                              </span>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                                <button
                                  type="button"
                                  className="admin-btn admin-btn-secondary"
                                  style={{ padding: '4px 10px', fontSize: 12 }}
                                  disabled={busy || !p.primary_video_url}
                                  title={!p.primary_video_url ? 'No primary video — nothing to extract a poster from' : 'Re-extract the poster from the primary video'}
                                  onClick={() => handleRegenerate(p)}
                                >
                                  {busy ? 'Regenerating…' : 'Regenerate'}
                                </button>
                                {err && <span style={{ fontSize: 10, color: '#b91c1c', maxWidth: 180 }}>{err}</span>}
                              </div>
                            </div>
                          );
                        })()}
                      </td>
                      <td className="admin-cell-num">{(a?.total_impressions ?? 0).toLocaleString()}</td>
                      <td className="admin-cell-num">{(a?.total_clicks      ?? 0).toLocaleString()}</td>
                      <td className="admin-cell-num">{(a?.total_clickouts   ?? 0).toLocaleString()}</td>
                      <td className="admin-cell-num" style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
                        {ctr === null ? '—' : `${(ctr * 100).toFixed(1)}%`}
                        <svg
                          width="12" height="12" viewBox="0 0 24 24" fill="none"
                          stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                          style={{ flexShrink: 0, opacity: 0.4, transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}
                        >
                          <polyline points="6 9 12 15 18 9" />
                        </svg>
                      </td>
                    </tr>
                    {expanded && (
                      <tr key={`${p.id}-detail`} className="admin-enrichment-row">
                        <ProductEnrichmentPanel productId={p.id} />
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
