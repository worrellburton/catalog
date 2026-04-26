import { useState, useEffect, useMemo } from 'react';
import { useParams, Link } from '@remix-run/react';
import { supabase } from '~/utils/supabase';

interface AdRow {
  id: string;
  status: string;
  style: string;
  video_url: string | null;
  impressions: number;
  clicks: number;
  cost_usd: number | null;
  created_at: string;
  product: { id: string; name: string | null; brand: string | null; image_url: string | null; price: string | null; catalog_tags: string[] | null } | null;
}

const COMMISSION_RATE = 0.08; // Illustrative blended commission. Fine-tune per brand later.

export default function BrandDashboard() {
  const { name: rawName } = useParams();
  const name = decodeURIComponent(rawName || '');
  const [ads, setAds] = useState<AdRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      if (!supabase || !name) return;
      const { data } = await supabase
        .from('product_creative')
        .select('id, status, style, video_url, impressions, clicks, cost_usd, created_at, product:products!inner(id, name, brand, image_url, price, catalog_tags)')
        .eq('product.brand', name)
        .order('created_at', { ascending: false });
      setAds((data || []) as unknown as AdRow[]);
      setLoading(false);
    })();
  }, [name]);

  const stats = useMemo(() => {
    const impressions = ads.reduce((s, a) => s + (a.impressions || 0), 0);
    const clicks = ads.reduce((s, a) => s + (a.clicks || 0), 0);
    const cost = ads.reduce((s, a) => s + (a.cost_usd || 0), 0);
    const liveAds = ads.filter(a => a.status === 'live').length;
    const products = new Set(ads.map(a => a.product?.id).filter(Boolean)).size;
    const catalogs = new Set<string>();
    ads.forEach(a => (a.product?.catalog_tags || []).forEach(c => catalogs.add(c)));
    // Rough estimated commission — clicks × AOV × commission rate. AOV
    // derived from ad-weighted product prices (numeric parse).
    const priceTotal = ads.reduce((s, a) => {
      const priceNum = parseFloat((a.product?.price || '').replace(/[^0-9.]/g, '')) || 0;
      return s + priceNum;
    }, 0);
    const avgPrice = ads.length > 0 ? priceTotal / ads.length : 0;
    const estimatedRevenue = clicks * avgPrice * COMMISSION_RATE;
    return {
      products,
      catalogs: Array.from(catalogs),
      liveAds,
      impressions,
      clicks,
      cost,
      ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
      avgPrice,
      estimatedRevenue,
    };
  }, [ads]);

  const topCreative = useMemo(() =>
    [...ads]
      .filter(a => a.video_url && (a.impressions || 0) > 0)
      .sort((a, b) => {
        const aCtr = (a.clicks || 0) / Math.max(1, a.impressions || 1);
        const bCtr = (b.clicks || 0) / Math.max(1, b.impressions || 1);
        return bCtr - aCtr;
      })
      .slice(0, 6)
  , [ads]);

  const topProducts = useMemo(() => {
    const map = new Map<string, { id: string; name: string; image: string | null; impressions: number; clicks: number }>();
    ads.forEach(a => {
      const pid = a.product?.id;
      if (!pid) return;
      if (!map.has(pid)) {
        map.set(pid, { id: pid, name: a.product?.name || 'Unnamed', image: a.product?.image_url || null, impressions: 0, clicks: 0 });
      }
      const e = map.get(pid)!;
      e.impressions += a.impressions || 0;
      e.clicks += a.clicks || 0;
    });
    return Array.from(map.values())
      .sort((a, b) => b.clicks - a.clicks)
      .slice(0, 8);
  }, [ads]);

  const handleExport = () => {
    const json = JSON.stringify({
      brand: name,
      exported: new Date().toISOString(),
      stats,
      topProducts,
      topCreative: topCreative.map(a => ({
        id: a.id, product: a.product?.name, style: a.style,
        impressions: a.impressions, clicks: a.clicks,
        ctr: (a.impressions || 0) > 0 ? ((a.clicks || 0) / a.impressions) * 100 : 0,
      })),
    }, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name.replace(/\s+/g, '_')}_catalog_report.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="admin-page">
        <div className="admin-empty">Loading {name} data…</div>
      </div>
    );
  }

  return (
    <div className="admin-page">
      <div className="admin-page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <Link to="/admin/brands" style={{ fontSize: 12, color: '#64748b', textDecoration: 'none' }}>← All brands</Link>
          <h1 style={{ marginTop: 6 }}>{name}</h1>
          <p className="admin-page-subtitle">Brand performance on Catalog. Share this with your partner contact.</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="admin-btn admin-btn-secondary" onClick={handleExport}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 6 }}>
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
            </svg>
            Export report
          </button>
        </div>
      </div>

      {/* Top-level stat strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 24 }}>
        {[
          { label: 'Products', value: stats.products.toLocaleString() },
          { label: 'Live ads', value: stats.liveAds.toLocaleString() },
          { label: 'Impressions', value: stats.impressions.toLocaleString() },
          { label: 'Clicks', value: stats.clicks.toLocaleString() },
          { label: 'CTR', value: `${stats.ctr.toFixed(2)}%` },
          { label: 'Est. commission', value: `$${stats.estimatedRevenue.toFixed(2)}`, accent: '#16a34a' },
        ].map(s => (
          <div key={s.label} style={{ padding: 14, borderRadius: 10, border: '1px solid #e5e7eb', background: '#fff' }}>
            <div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>
              {s.label}
            </div>
            <div style={{ fontSize: 22, fontWeight: 700, color: s.accent || '#111' }}>{s.value}</div>
          </div>
        ))}
      </div>

      {stats.catalogs.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <h3 style={{ fontSize: 13, fontWeight: 600, color: '#111', margin: '0 0 8px' }}>Featured in catalogs</h3>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {stats.catalogs.map(c => (
              <span key={c} style={{
                padding: '4px 12px', borderRadius: 999, background: '#eff6ff', color: '#1d4ed8',
                fontSize: 12, fontWeight: 600,
              }}>{c}</span>
            ))}
          </div>
        </div>
      )}

      {topCreative.length > 0 && (
        <div style={{ marginBottom: 28 }}>
          <h3 style={{ fontSize: 13, fontWeight: 600, color: '#111', margin: '0 0 10px' }}>Top-performing creative</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
            {topCreative.map(a => {
              const ctr = (a.impressions || 0) > 0 ? ((a.clicks || 0) / a.impressions) * 100 : 0;
              return (
                <div key={a.id} style={{ border: '1px solid #e5e7eb', borderRadius: 10, overflow: 'hidden', background: '#fff' }}>
                  <div style={{ aspectRatio: '9 / 16', background: '#000', position: 'relative' }}>
                    {a.video_url && (
                      <video src={a.video_url} autoPlay muted loop playsInline
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    )}
                  </div>
                  <div style={{ padding: 10 }}>
                    <div style={{ fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{a.style.replace(/_/g, ' ')}</div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {a.product?.name}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 11, color: '#475569' }}>
                      <span>{(a.impressions || 0).toLocaleString()} imp</span>
                      <span style={{ fontWeight: 700, color: ctr >= 4 ? '#16a34a' : ctr >= 2 ? '#ca8a04' : '#64748b' }}>
                        {ctr.toFixed(2)}% CTR
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {topProducts.length > 0 && (
        <div>
          <h3 style={{ fontSize: 13, fontWeight: 600, color: '#111', margin: '0 0 10px' }}>Top products by clicks</h3>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>Product</th>
                  <th>Impressions</th>
                  <th>Clicks</th>
                  <th>CTR</th>
                </tr>
              </thead>
              <tbody>
                {topProducts.map(p => {
                  const ctr = p.impressions > 0 ? (p.clicks / p.impressions) * 100 : 0;
                  return (
                    <tr key={p.id}>
                      <td style={{ textAlign: 'left' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          {p.image && <img src={p.image} alt="" style={{ width: 32, height: 32, borderRadius: 6, objectFit: 'cover' }} />}
                          <span style={{ fontSize: 13, fontWeight: 600 }}>{p.name}</span>
                        </div>
                      </td>
                      <td>{p.impressions.toLocaleString()}</td>
                      <td>{p.clicks.toLocaleString()}</td>
                      <td style={{ fontWeight: 700, color: ctr >= 4 ? '#16a34a' : ctr >= 2 ? '#ca8a04' : '#64748b' }}>
                        {p.impressions > 0 ? `${ctr.toFixed(2)}%` : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
