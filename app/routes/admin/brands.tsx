import { useState, useEffect, useMemo } from 'react';
import { Link } from '@remix-run/react';
import { supabase } from '~/utils/supabase';

interface ProductRow {
  id: string;
  brand: string | null;
  catalog_tags: string[] | null;
}

interface AdRow {
  id: string;
  status: string;
  impressions: number;
  clicks: number;
  cost_usd: number | null;
  product: { brand: string | null } | null;
}

export default function AdminBrands() {
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [ads, setAds] = useState<AdRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      if (!supabase) return;
      const [{ data: p }, { data: a }] = await Promise.all([
        supabase.from('products').select('id, brand, catalog_tags'),
        supabase.from('product_creative').select('id, status, impressions, clicks, cost_usd, product:products(brand)'),
      ]);
      setProducts((p || []) as ProductRow[]);
      setAds((a || []) as unknown as AdRow[]);
      setLoading(false);
    })();
  }, []);

  const brands = useMemo(() => {
    const map = new Map<string, { name: string; products: number; catalogs: Set<string>; ads: number; liveAds: number; impressions: number; clicks: number; cost: number }>();

    products.forEach(p => {
      const name = p.brand || 'Unknown';
      if (!map.has(name)) {
        map.set(name, { name, products: 0, catalogs: new Set(), ads: 0, liveAds: 0, impressions: 0, clicks: 0, cost: 0 });
      }
      const entry = map.get(name)!;
      entry.products += 1;
      (p.catalog_tags || []).forEach(c => entry.catalogs.add(c));
    });

    ads.forEach(a => {
      const name = a.product?.brand || 'Unknown';
      if (!map.has(name)) {
        map.set(name, { name, products: 0, catalogs: new Set(), ads: 0, liveAds: 0, impressions: 0, clicks: 0, cost: 0 });
      }
      const entry = map.get(name)!;
      entry.ads += 1;
      if (a.status === 'live') entry.liveAds += 1;
      entry.impressions += a.impressions || 0;
      entry.clicks += a.clicks || 0;
      entry.cost += a.cost_usd || 0;
    });

    return Array.from(map.values())
      .map(b => ({
        ...b,
        catalogCount: b.catalogs.size,
        ctr: b.impressions > 0 ? (b.clicks / b.impressions) * 100 : 0,
      }))
      .sort((a, b) => b.impressions - a.impressions);
  }, [products, ads]);

  const totals = useMemo(() => ({
    brands: brands.length,
    products: products.length,
    liveAds: brands.reduce((s, b) => s + b.liveAds, 0),
    impressions: brands.reduce((s, b) => s + b.impressions, 0),
    clicks: brands.reduce((s, b) => s + b.clicks, 0),
    cost: brands.reduce((s, b) => s + b.cost, 0),
  }), [brands, products]);

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <h1>Brands</h1>
        <p className="admin-page-subtitle">Brand partnerships and performance. Click a brand for a shareable dashboard.</p>
      </div>

      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
        gap: 12, marginBottom: 16,
      }}>
        {[
          { label: 'Brands', value: totals.brands.toLocaleString() },
          { label: 'Products', value: totals.products.toLocaleString() },
          { label: 'Live ads', value: totals.liveAds.toLocaleString() },
          { label: 'Impressions', value: totals.impressions.toLocaleString() },
          { label: 'Clicks', value: totals.clicks.toLocaleString() },
          { label: 'Spend', value: `$${totals.cost.toFixed(2)}` },
        ].map(s => (
          <div key={s.label} style={{ padding: 14, borderRadius: 10, border: '1px solid #e5e7eb', background: '#fff' }}>
            <div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>
              {s.label}
            </div>
            <div style={{ fontSize: 20, fontWeight: 700, color: '#111' }}>{s.value}</div>
          </div>
        ))}
      </div>

      {loading ? (
        <div className="admin-empty">Loading brand data…</div>
      ) : brands.length === 0 ? (
        <div className="admin-empty">No brands yet. Ingest some products to populate this view.</div>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Brand</th>
                <th>Products</th>
                <th>Catalogs</th>
                <th>Live Ads</th>
                <th>Impressions</th>
                <th>Clicks</th>
                <th>CTR</th>
                <th>Spend</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {brands.map(b => (
                <tr key={b.name}>
                  <td style={{ textAlign: 'left', fontWeight: 600 }}>{b.name}</td>
                  <td>{b.products}</td>
                  <td>{b.catalogCount}</td>
                  <td>{b.liveAds}</td>
                  <td>{b.impressions.toLocaleString()}</td>
                  <td>{b.clicks.toLocaleString()}</td>
                  <td>
                    <span style={{
                      fontWeight: 700,
                      color: b.ctr >= 4 ? '#16a34a' : b.ctr >= 2 ? '#ca8a04' : b.ctr > 0 ? '#64748b' : '#cbd5e1',
                    }}>
                      {b.impressions > 0 ? `${b.ctr.toFixed(2)}%` : '—'}
                    </span>
                  </td>
                  <td>${b.cost.toFixed(2)}</td>
                  <td>
                    <Link
                      to={`/admin/brand/${encodeURIComponent(b.name)}`}
                      className="admin-btn admin-btn-secondary"
                      style={{ fontSize: 11, padding: '3px 10px' }}
                    >
                      Dashboard →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
