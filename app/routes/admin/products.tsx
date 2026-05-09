import { useEffect, useMemo, useState } from 'react';
import { supabase } from '~/utils/supabase';
import {
  getProductAnalytics,
  clickThroughRate,
  type ProductAnalyticsRow,
} from '~/services/analytics';

interface ProductRow {
  id: string;
  name: string | null;
  brand: string | null;
  price: string | null;
  image_url: string | null;
  created_at: string;
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

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    supabase
      .from('products')
      .select('id, name, brand, price, image_url, created_at')
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
          <table className="admin-table">
            <thead>
              <tr>
                <th>Product</th>
                <th>Brand</th>
                <th>Price</th>
                <th className="admin-th-num">Impressions</th>
                <th className="admin-th-num">Clicks</th>
                <th className="admin-th-num">Clickouts</th>
                <th className="admin-th-num">CTR</th>
              </tr>
            </thead>
            <tbody>
              {products.map(p => {
                const a = analyticsById.get(p.id);
                const ctr = a ? clickThroughRate(a) : null;
                return (
                  <tr key={p.id}>
                    <td className="admin-cell-name">{p.name || '—'}</td>
                    <td className="admin-cell-muted">{p.brand || '—'}</td>
                    <td>{p.price || '—'}</td>
                    <td className="admin-cell-num">{(a?.total_impressions ?? 0).toLocaleString()}</td>
                    <td className="admin-cell-num">{(a?.total_clicks      ?? 0).toLocaleString()}</td>
                    <td className="admin-cell-num">{(a?.total_clickouts   ?? 0).toLocaleString()}</td>
                    <td className="admin-cell-num">{ctr === null ? '—' : `${(ctr * 100).toFixed(1)}%`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
