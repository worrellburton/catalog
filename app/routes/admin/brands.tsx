// /admin/brands — directory of every brand in the products catalog.
// One row per brand with product counts, polished/video coverage,
// gender mix, and a "last updated" recency stamp. Click a row to
// expand a drawer with sample products, 7-day event totals, and the
// catalogs that include this brand.
//
// Brand is a text column on `products` — there's no `brands` table —
// so everything here aggregates from the products feed (see
// services/brands.ts).

import { useEffect, useMemo, useState, Fragment } from 'react';
import { Link } from '@remix-run/react';
import {
  loadBrands, loadBrandDetail, formatRelative, pct,
  type BrandRow, type BrandDetail,
} from '~/services/brands';
import { useBrandLogo } from '~/hooks/useBrandLogoLookup';

type SortKey = 'products' | 'name' | 'polished' | 'video' | 'updated';
type LogoFilter = 'all' | 'with-logo' | 'no-logo';
type ViewMode = 'list' | 'grid';

const BRANDS_VIEW_LS_KEY = 'admin-brands:view-mode';

export default function AdminBrands() {
  const [rows, setRows] = useState<BrandRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortKey>('products');
  const [logoFilter, setLogoFilter] = useState<LogoFilter>('all');
  const [expanded, setExpanded] = useState<string | null>(null);
  // Grid vs list view, persisted so it sticks across sessions.
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    if (typeof window === 'undefined') return 'list';
    try { return (window.localStorage.getItem(BRANDS_VIEW_LS_KEY) as ViewMode) || 'list'; }
    catch { return 'list'; }
  });
  useEffect(() => {
    try { window.localStorage.setItem(BRANDS_VIEW_LS_KEY, viewMode); } catch { /* private mode */ }
  }, [viewMode]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await loadBrands();
        if (!cancelled) setRows(data);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    if (!rows) return [];
    const q = search.trim().toLowerCase();
    let out = rows;
    if (logoFilter === 'with-logo') out = out.filter(r => r.hasLogo);
    if (logoFilter === 'no-logo')   out = out.filter(r => !r.hasLogo);
    if (q) out = out.filter(r => r.name.toLowerCase().includes(q));
    const sorted = [...out];
    sorted.sort((a, b) => {
      switch (sort) {
        case 'name':     return a.name.localeCompare(b.name);
        case 'polished': return (b.polishedCount / Math.max(1, b.productCount)) - (a.polishedCount / Math.max(1, a.productCount));
        case 'video':    return (b.withPrimaryVideoCount / Math.max(1, b.productCount)) - (a.withPrimaryVideoCount / Math.max(1, a.productCount));
        case 'updated':  return (b.lastUpdatedAt ?? '').localeCompare(a.lastUpdatedAt ?? '');
        case 'products':
        default:         return b.productCount - a.productCount || a.name.localeCompare(b.name);
      }
    });
    return sorted;
  }, [rows, search, sort, logoFilter]);

  // KPI strip — totals across the FULL set (not the filtered one) so
  // the numbers don't shift when you filter.
  const kpis = useMemo(() => {
    if (!rows) return null;
    const totalProducts = rows.reduce((s, r) => s + r.productCount, 0);
    const totalVideo = rows.reduce((s, r) => s + r.withPrimaryVideoCount, 0);
    const totalPolished = rows.reduce((s, r) => s + r.polishedCount, 0);
    const withLogo = rows.filter(r => r.hasLogo).length;
    return {
      totalBrands: rows.length,
      totalProducts,
      videoCoverage: pct(totalVideo, totalProducts),
      polishedCoverage: pct(totalPolished, totalProducts),
      logoCoverage: pct(withLogo, rows.length),
      topBrand: rows[0]?.name ?? '—',
    };
  }, [rows]);

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <div>
          <h1>Brands</h1>
          <p className="admin-page-subtitle">Every brand in the catalog — product counts, polish coverage, gender mix. Click a row to drill in.</p>
        </div>
      </div>

      {error && (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px', color: '#b91c1c', fontSize: 13, marginBottom: 14 }}>
          {error}
        </div>
      )}

      {kpis && (
        <div className="admin-stats-grid" style={{ marginBottom: 20 }}>
          <Kpi label="Brands" value={kpis.totalBrands.toLocaleString()} />
          <Kpi label="Products" value={kpis.totalProducts.toLocaleString()} />
          <Kpi label="Has primary video" value={kpis.videoCoverage} sub="of products" />
          <Kpi label="Polished" value={kpis.polishedCoverage} sub="primary images" />
          <Kpi label="Has logo" value={kpis.logoCoverage} sub="of brands" />
          <Kpi label="Top brand" value={kpis.topBrand} />
        </div>
      )}

      {/* Search + sort + filter chips */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
        <input
          type="text" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search brands…"
          style={{ flex: 1, minWidth: 200, padding: '8px 12px', borderRadius: 8, border: '1px solid #e0e0e0', fontSize: 13 }}
        />
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#475569' }}>
          Sort
          <select value={sort} onChange={e => setSort(e.target.value as SortKey)}
            style={{ fontSize: 12, padding: '5px 8px', borderRadius: 6, border: '1px solid #cbd5e1', background: '#fff' }}>
            <option value="products">Most products</option>
            <option value="name">Name (A–Z)</option>
            <option value="polished">Polished %</option>
            <option value="video">Video %</option>
            <option value="updated">Recently updated</option>
          </select>
        </label>
        <div style={{ display: 'inline-flex', border: '1px solid #e2e8f0', borderRadius: 999, overflow: 'hidden' }}>
          {([['all', 'All'], ['with-logo', 'Has logo'], ['no-logo', 'No logo']] as const).map(([key, label]) => (
            <button key={key} type="button" onClick={() => setLogoFilter(key)}
              style={{
                padding: '5px 12px', fontSize: 11, fontWeight: 600, border: 'none', cursor: 'pointer',
                background: logoFilter === key ? '#111' : '#fff',
                color: logoFilter === key ? '#fff' : '#475569',
              }}>
              {label}
            </button>
          ))}
        </div>
        <div style={{ display: 'inline-flex', border: '1px solid #e2e8f0', borderRadius: 6, overflow: 'hidden' }}>
          <button type="button" onClick={() => setViewMode('grid')} title="Grid view" aria-label="Grid view"
            style={{
              padding: '5px 10px', border: 'none', cursor: 'pointer',
              background: viewMode === 'grid' ? '#111' : '#fff',
              color: viewMode === 'grid' ? '#fff' : '#475569',
              display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600,
            }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
            Grid
          </button>
          <button type="button" onClick={() => setViewMode('list')} title="List view" aria-label="List view"
            style={{
              padding: '5px 10px', border: 'none', borderLeft: '1px solid #e2e8f0', cursor: 'pointer',
              background: viewMode === 'list' ? '#111' : '#fff',
              color: viewMode === 'list' ? '#fff' : '#475569',
              display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600,
            }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
            List
          </button>
        </div>
      </div>

      {!rows && (
        <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>Loading…</div>
      )}
      {rows && filtered.length === 0 && (
        <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>No brands match that filter.</div>
      )}

      {rows && filtered.length > 0 && viewMode === 'list' && (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th style={{ width: 22 }}></th>
                <th style={{ textAlign: 'left' }}>Brand</th>
                <th>Products</th>
                <th title="Polished primary image / total products">Polished</th>
                <th title="Has primary video / total products">Video</th>
                <th>Gender mix</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(b => (
                <Fragment key={b.name}>
                  <BrandTableRow
                    brand={b}
                    expanded={expanded === b.name}
                    onToggle={() => setExpanded(expanded === b.name ? null : b.name)}
                  />
                  {expanded === b.name && (
                    <tr>
                      <td colSpan={7} style={{ padding: 0, background: '#fafafa', borderTop: 'none' }}>
                        <BrandDetailDropdown brand={b} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {rows && filtered.length > 0 && viewMode === 'grid' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
          {filtered.map(b => (
            <BrandGridCard
              key={b.name}
              brand={b}
              expanded={expanded === b.name}
              onToggle={() => setExpanded(expanded === b.name ? null : b.name)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Grid card ───────────────────────────────────────────────────────

function BrandGridCard({ brand, expanded, onToggle }: { brand: BrandRow; expanded: boolean; onToggle: () => void }) {
  const logo = useBrandLogo(brand.name);
  const polishedPct = pct(brand.polishedCount, brand.productCount);
  const videoPct = pct(brand.withPrimaryVideoCount, brand.productCount);
  return (
    <div style={{
      border: `1px solid ${expanded ? '#111' : '#e5e7eb'}`, borderRadius: 12, background: '#fff',
      overflow: 'hidden', display: 'flex', flexDirection: 'column',
    }}>
      <button
        type="button"
        onClick={onToggle}
        style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: 14, border: 'none',
          background: expanded ? '#fffbeb' : '#fff', cursor: 'pointer', textAlign: 'left', width: '100%',
        }}
      >
        {logo
          ? <img src={logo} alt={brand.name} style={{ width: 40, height: 40, borderRadius: 8, objectFit: 'contain', background: '#fff', padding: 2, border: '1px solid #f1f5f9' }} onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
          : brand.sampleImageUrl
            ? <img src={brand.sampleImageUrl} alt="" style={{ width: 40, height: 40, borderRadius: 8, objectFit: 'cover', background: '#f1f5f9' }} />
            : <span style={{ width: 40, height: 40, borderRadius: 8, background: '#f1f5f9', display: 'inline-block' }} />}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 14, color: '#111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{brand.name}</div>
          <div style={{ fontSize: 11, color: '#64748b' }}>{brand.productCount.toLocaleString()} product{brand.productCount === 1 ? '' : 's'}</div>
        </div>
      </button>
      <div style={{ padding: '0 14px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 10, color: '#94a3b8', width: 54 }}>Polished</span>
          <CoverageBar pct={polishedPct} color="#0ea5e9" />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 10, color: '#94a3b8', width: 54 }}>Video</span>
          <CoverageBar pct={videoPct} color="#10b981" />
        </div>
        <GenderMix m={brand.menCount} w={brand.womenCount} u={brand.unisexCount} x={brand.untaggedCount} total={brand.productCount} />
      </div>
      {expanded && (
        <div style={{ borderTop: '1px solid #f1f5f9', background: '#fafafa' }}>
          <BrandDetailDropdown brand={brand} />
        </div>
      )}
    </div>
  );
}

// ── Row ─────────────────────────────────────────────────────────────

function BrandTableRow({ brand, expanded, onToggle }: { brand: BrandRow; expanded: boolean; onToggle: () => void }) {
  const logo = useBrandLogo(brand.name);
  const polishedPct = pct(brand.polishedCount, brand.productCount);
  const videoPct = pct(brand.withPrimaryVideoCount, brand.productCount);
  return (
    <tr onClick={onToggle} style={{ cursor: 'pointer', background: expanded ? '#fffbeb' : undefined }}>
      <td style={{ paddingLeft: 8 }}>
        <span style={{
          display: 'inline-flex', width: 14, color: '#94a3b8', fontSize: 10,
          transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.12s',
        }}>▶</span>
      </td>
      <td style={{ textAlign: 'left' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {logo
            ? <img src={logo} alt={brand.name} style={{ width: 32, height: 32, borderRadius: 6, objectFit: 'contain', background: '#fff', padding: 2, border: '1px solid #f1f5f9' }} onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
            : brand.sampleImageUrl
              ? <img src={brand.sampleImageUrl} alt="" style={{ width: 32, height: 32, borderRadius: 6, objectFit: 'cover', background: '#f1f5f9' }} />
              : <span style={{ width: 32, height: 32, borderRadius: 6, background: '#f1f5f9', display: 'inline-block' }} />}
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontWeight: 600, fontSize: 13, color: '#111' }}>{brand.name}</span>
            {!brand.hasLogo && (
              <span style={{ fontSize: 10, color: '#a16207' }}>No custom logo</span>
            )}
          </div>
        </div>
      </td>
      <td style={{ fontWeight: 700, fontSize: 13 }}>{brand.productCount.toLocaleString()}</td>
      <td><CoverageBar pct={polishedPct} color="#0ea5e9" /></td>
      <td><CoverageBar pct={videoPct} color="#10b981" /></td>
      <td>
        <GenderMix m={brand.menCount} w={brand.womenCount} u={brand.unisexCount} x={brand.untaggedCount} total={brand.productCount} />
      </td>
      <td style={{ fontSize: 12, color: '#64748b' }}>{formatRelative(brand.lastUpdatedAt)}</td>
    </tr>
  );
}

// ── Expanded detail drawer ─────────────────────────────────────────

function BrandDetailDropdown({ brand }: { brand: BrandRow }) {
  const [detail, setDetail] = useState<BrandDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    loadBrandDetail(brand.name)
      .then(d => { if (!cancelled) setDetail(d); })
      .catch(e => { if (!cancelled) setError((e as Error).message); });
    return () => { cancelled = true; };
  }, [brand.name]);

  return (
    <div style={{ padding: '16px 24px 22px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      {error && (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '8px 12px', color: '#b91c1c', fontSize: 12 }}>{error}</div>
      )}

      {/* Quick stat row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
        <DetailStat label="Products" value={brand.productCount.toLocaleString()} />
        <DetailStat label="With video" value={brand.withPrimaryVideoCount.toLocaleString()} sub={pct(brand.withPrimaryVideoCount, brand.productCount)} />
        <DetailStat label="Polished" value={brand.polishedCount.toLocaleString()} sub={pct(brand.polishedCount, brand.productCount)} />
        <DetailStat label="Impressions 7d" value={detail ? detail.events.impressions7d.toLocaleString() : '…'} />
        <DetailStat label="Clickouts 7d" value={detail ? detail.events.clickouts7d.toLocaleString() : '…'} />
        <DetailStat label="Last updated" value={formatRelative(brand.lastUpdatedAt)} />
      </div>

      {/* Quick links */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Link to={`/admin/brand/${encodeURIComponent(brand.name)}`}
          className="admin-btn admin-btn-primary" style={{ fontSize: 11, padding: '4px 12px' }}>
          Open brand dashboard →
        </Link>
        <Link to={`/admin/data?tab=products&brand=${encodeURIComponent(brand.name)}`}
          className="admin-btn admin-btn-secondary" style={{ fontSize: 11, padding: '4px 12px' }}>
          Manage products in Data
        </Link>
      </div>

      {/* Catalogs */}
      {detail && detail.catalogs.length > 0 && (
        <div>
          <div style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6, fontWeight: 600 }}>
            In catalogs ({detail.catalogs.length})
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {detail.catalogs.map(c => (
              <Link key={c}
                to={`/admin/catalogs/${c.toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-')}`}
                style={{ padding: '3px 10px', borderRadius: 999, background: '#fff', border: '1px solid #e2e8f0', fontSize: 11, fontWeight: 600, color: '#475569', textDecoration: 'none' }}>
                {c}
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Sample products grid */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
          <span style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 600 }}>
            Products ({detail ? detail.products.length : '…'})
          </span>
        </div>
        {!detail && <div style={{ padding: 16, color: '#94a3b8', fontSize: 12 }}>Loading products…</div>}
        {detail && detail.products.length === 0 && (
          <div style={{ padding: 12, color: '#94a3b8', fontSize: 12 }}>No active products for this brand.</div>
        )}
        {detail && detail.products.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 10 }}>
            {detail.products.slice(0, 24).map(p => {
              const img = p.primaryImageUrl ?? p.imageUrl;
              return (
                <div key={p.id} style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden', background: '#fff' }}>
                  {img
                    ? <img src={img} alt="" style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', display: 'block', background: '#f1f5f9' }} onError={e => { (e.target as HTMLImageElement).style.opacity = '0.2'; }} />
                    : <div style={{ width: '100%', aspectRatio: '1', background: '#f1f5f9' }} />}
                  <div style={{ padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: '#111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name ?? 'Untitled'}</span>
                    <span style={{ fontSize: 10, color: '#64748b' }}>{p.price ?? ''}{p.primaryVideoUrl ? ' · 🎬' : ''}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Small presentation helpers ─────────────────────────────────────

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="admin-stat-card">
      <span className="admin-stat-value">{value}</span>
      <span className="admin-stat-label">{label}</span>
      {sub && <span style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>{sub}</span>}
    </div>
  );
}

function DetailStat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: '8px 12px' }}>
      <div style={{ fontSize: 10, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: '#111', marginTop: 2 }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: '#64748b' }}>{sub}</div>}
    </div>
  );
}

function CoverageBar({ pct: ratio, color }: { pct: string; color: string }) {
  const n = parseInt(ratio, 10) || 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center' }}>
      <div style={{ width: 60, height: 6, borderRadius: 3, background: '#f1f5f9', overflow: 'hidden' }}>
        <div style={{ width: `${n}%`, height: '100%', background: color, transition: 'width 0.2s' }} />
      </div>
      <span style={{ fontSize: 11, fontWeight: 600, color: '#475569', minWidth: 32, textAlign: 'left' }}>{ratio}</span>
    </div>
  );
}

function GenderMix({ m, w, u, x, total }: { m: number; w: number; u: number; x: number; total: number }) {
  if (total === 0) return <span style={{ color: '#cbd5e1', fontSize: 11 }}>—</span>;
  const seg = (n: number, color: string, label: string) =>
    n === 0 ? null : <div key={label} title={`${label}: ${n}`} style={{ width: `${(n / total) * 100}%`, height: 6, background: color }} />;
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
      <div style={{ display: 'flex', width: 70, height: 6, borderRadius: 3, overflow: 'hidden', background: '#f1f5f9' }}>
        {seg(m, '#3b82f6', 'Men')}
        {seg(w, '#ec4899', 'Women')}
        {seg(u, '#a855f7', 'Unisex')}
        {seg(x, '#94a3b8', 'Untagged')}
      </div>
      <span style={{ fontSize: 10, color: '#64748b', fontVariantNumeric: 'tabular-nums' }}>
        {m}/{w}/{u}{x > 0 ? ` · ${x}?` : ''}
      </span>
    </div>
  );
}
