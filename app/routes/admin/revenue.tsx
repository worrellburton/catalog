import { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '~/utils/supabase';
import { pauseAd } from '~/services/product-ads';

interface AdRow {
  id: string;
  product_id: string;
  status: string;
  style: string;
  impressions: number;
  clicks: number;
  cost_usd: number | null;
  product: {
    id: string;
    name: string | null;
    brand: string | null;
    catalog_tags: string[] | null;
  } | null;
}

type Tab = 'catalogs' | 'brands' | 'products' | 'styles' | 'variants';

const VARIANT_MIN_IMPRESSIONS = 500;

export default function AdminRevenue() {
  const [ads, setAds] = useState<AdRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('catalogs');

  useEffect(() => {
    (async () => {
      if (!supabase) return;
      const { data } = await supabase
        .from('product_ads')
        .select('id, product_id, status, style, impressions, clicks, cost_usd, product:products(id, name, brand, catalog_tags)');
      if (data) setAds(data as unknown as AdRow[]);
      setLoading(false);
    })();
  }, []);

  const totals = useMemo(() => {
    const imp = ads.reduce((s, a) => s + (a.impressions || 0), 0);
    const clk = ads.reduce((s, a) => s + (a.clicks || 0), 0);
    const cost = ads.reduce((s, a) => s + (a.cost_usd || 0), 0);
    return {
      impressions: imp,
      clicks: clk,
      cost,
      ctr: imp > 0 ? (clk / imp) * 100 : 0,
      cpc: clk > 0 ? cost / clk : 0,
    };
  }, [ads]);

  const grouped = useMemo(() => {
    type Bucket = { key: string; label: string; sublabel?: string; impressions: number; clicks: number; cost: number; adCount: number };
    const buckets = new Map<string, Bucket>();

    const add = (key: string, label: string, a: AdRow, sublabel?: string) => {
      if (!buckets.has(key)) {
        buckets.set(key, { key, label, sublabel, impressions: 0, clicks: 0, cost: 0, adCount: 0 });
      }
      const b = buckets.get(key)!;
      b.impressions += a.impressions || 0;
      b.clicks += a.clicks || 0;
      b.cost += a.cost_usd || 0;
      b.adCount += 1;
    };

    if (tab === 'catalogs') {
      ads.forEach(a => {
        const tags = a.product?.catalog_tags || [];
        if (tags.length === 0) {
          add('__untagged__', 'Untagged', a);
        } else {
          tags.forEach(tag => add(`catalog:${tag}`, tag, a));
        }
      });
    } else if (tab === 'brands') {
      ads.forEach(a => {
        const brand = a.product?.brand || 'Unknown';
        add(`brand:${brand}`, brand, a);
      });
    } else if (tab === 'products') {
      ads.forEach(a => {
        if (!a.product) return;
        add(`product:${a.product.id}`, a.product.name || 'Unnamed', a, a.product.brand || undefined);
      });
    } else if (tab === 'styles') {
      ads.forEach(a => {
        const style = a.style.replace(/_/g, ' ');
        add(`style:${a.style}`, style, a);
      });
    }

    return Array.from(buckets.values())
      .map(b => ({
        ...b,
        ctr: b.impressions > 0 ? (b.clicks / b.impressions) * 100 : 0,
        cpc: b.clicks > 0 ? b.cost / b.clicks : 0,
      }))
      .sort((a, b) => b.impressions - a.impressions);
  }, [ads, tab]);

  const maxImpressions = Math.max(1, ...grouped.map(g => g.impressions));

  const [busyGroup, setBusyGroup] = useState<string | null>(null);
  const pauseLosersInGroup = useCallback(async (groupKey: string, winnerId: string, loserIds: string[]) => {
    setBusyGroup(groupKey);
    await Promise.all(loserIds.map(id => pauseAd(id)));
    // Optimistic update
    setAds(prev => prev.map(a => loserIds.includes(a.id) ? { ...a, status: 'paused' } : a));
    setBusyGroup(null);
  }, []);

  // Variant groups: all ads sharing product_id + style form an A/B group.
  // The winner is the row with highest CTR once every ad has >= MIN impressions.
  const variantGroups = useMemo(() => {
    const groups = new Map<string, { productId: string; productName: string; brand: string; style: string; variants: AdRow[] }>();
    ads.forEach(a => {
      const key = `${a.product_id}|${a.style}`;
      if (!groups.has(key)) {
        groups.set(key, {
          productId: a.product_id,
          productName: a.product?.name || 'Unnamed',
          brand: a.product?.brand || '—',
          style: a.style,
          variants: [],
        });
      }
      groups.get(key)!.variants.push(a);
    });
    return Array.from(groups.values())
      .filter(g => g.variants.length > 1)
      .map(g => {
        const enriched = g.variants.map(v => ({
          ...v,
          ctr: (v.impressions || 0) > 0 ? ((v.clicks || 0) / v.impressions) * 100 : 0,
        }));
        const totalImp = enriched.reduce((s, v) => s + (v.impressions || 0), 0);
        const eligible = enriched.every(v => (v.impressions || 0) >= VARIANT_MIN_IMPRESSIONS);
        const winner = eligible
          ? enriched.reduce((best, v) => v.ctr > best.ctr ? v : best, enriched[0])
          : null;
        return { ...g, variants: enriched, totalImpressions: totalImp, winnerId: winner?.id ?? null, eligible };
      })
      .sort((a, b) => b.totalImpressions - a.totalImpressions);
  }, [ads]);

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <div>
          <h1>Performance</h1>
          <p className="admin-page-subtitle">
            Click-through, impressions and cost across your catalog, brands, products and video styles.
          </p>
        </div>
      </div>

      {/* Top-level stat strip */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
        gap: 12, marginBottom: 16,
      }}>
        {[
          { label: 'Impressions', value: totals.impressions.toLocaleString() },
          { label: 'Clicks', value: totals.clicks.toLocaleString() },
          { label: 'CTR', value: `${totals.ctr.toFixed(2)}%` },
          { label: 'Spend', value: `$${totals.cost.toFixed(2)}` },
          { label: 'Cost per click', value: totals.cpc > 0 ? `$${totals.cpc.toFixed(3)}` : '—' },
        ].map(stat => (
          <div key={stat.label} style={{
            padding: 14, borderRadius: 10, border: '1px solid #e5e7eb', background: '#fff',
          }}>
            <div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>
              {stat.label}
            </div>
            <div style={{ fontSize: 20, fontWeight: 700, color: '#111' }}>{stat.value}</div>
          </div>
        ))}
      </div>

      {/* Tab switcher */}
      <div className="admin-tabs" style={{ marginBottom: 12 }}>
        {([
          { key: 'catalogs' as Tab, label: 'By Catalog' },
          { key: 'brands' as Tab, label: 'By Brand' },
          { key: 'products' as Tab, label: 'By Product' },
          { key: 'styles' as Tab, label: 'By Style' },
          { key: 'variants' as Tab, label: 'A/B Variants' },
        ]).map(t => (
          <button
            key={t.key}
            className={`admin-tab ${tab === t.key ? 'active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'variants' ? (
        loading ? (
          <div className="admin-empty">Loading variants…</div>
        ) : variantGroups.length === 0 ? (
          <div className="admin-empty">
            No multi-variant groups yet. Generate 2+ ads for the same product with the same style to start A/B testing.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ fontSize: 12, color: '#888' }}>
              Winner declared once all variants have ≥ {VARIANT_MIN_IMPRESSIONS} impressions.
            </div>
            {variantGroups.map(g => (
              <div key={`${g.productId}|${g.style}`} style={{
                border: '1px solid #e5e7eb', borderRadius: 10, background: '#fff', overflow: 'hidden',
              }}>
                <div style={{ padding: '10px 14px', borderBottom: '1px solid #f0f0f0', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <div>
                    <div style={{ fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{g.brand}</div>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{g.productName}</div>
                    <div style={{ fontSize: 11, color: '#64748b', textTransform: 'capitalize' }}>{g.style.replace(/_/g, ' ')}</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                        {g.eligible ? 'Winner chosen' : `Collecting data — ${g.totalImpressions.toLocaleString()} impressions`}
                      </div>
                      <div style={{ fontSize: 11, color: g.eligible ? '#16a34a' : '#94a3b8', fontWeight: 600 }}>
                        {g.variants.length} variants
                      </div>
                    </div>
                    {g.eligible && g.winnerId && (() => {
                      const groupKey = `${g.productId}|${g.style}`;
                      const losers = g.variants.filter(v => v.id !== g.winnerId && v.status === 'live');
                      if (losers.length === 0) return null;
                      return (
                        <button
                          className="admin-btn admin-btn-primary"
                          style={{ fontSize: 11, padding: '5px 10px' }}
                          disabled={busyGroup === groupKey}
                          onClick={() => pauseLosersInGroup(groupKey, g.winnerId!, losers.map(l => l.id))}
                        >
                          {busyGroup === groupKey ? 'Pausing…' : `Pause ${losers.length} loser${losers.length === 1 ? '' : 's'}`}
                        </button>
                      );
                    })()}
                  </div>
                </div>
                <table className="admin-table" style={{ margin: 0 }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left' }}>Variant</th>
                      <th>Status</th>
                      <th>Impressions</th>
                      <th>Clicks</th>
                      <th>CTR</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.variants
                      .slice()
                      .sort((a, b) => (b.ctr || 0) - (a.ctr || 0))
                      .map((v, i) => {
                        const isWinner = g.winnerId === v.id;
                        return (
                          <tr key={v.id} style={{ background: isWinner ? '#f0fdf4' : undefined }}>
                            <td style={{ textAlign: 'left' }}>
                              <span style={{ fontSize: 12, color: '#64748b', fontFamily: 'monospace' }}>
                                #{i + 1} · {v.id.slice(0, 8)}
                              </span>
                              {isWinner && (
                                <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 700, color: '#16a34a' }}>
                                  🏆 Winner
                                </span>
                              )}
                            </td>
                            <td>
                              <span style={{
                                fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 4,
                                textTransform: 'uppercase', letterSpacing: '0.5px',
                                background: v.status === 'live' ? '#dcfce7' : v.status === 'paused' ? '#f1f5f9' : '#e0f2fe',
                                color: v.status === 'live' ? '#166534' : v.status === 'paused' ? '#475569' : '#075985',
                              }}>{v.status}</span>
                            </td>
                            <td>{(v.impressions || 0).toLocaleString()}</td>
                            <td>{(v.clicks || 0).toLocaleString()}</td>
                            <td style={{ fontWeight: 700, color: isWinner ? '#16a34a' : '#111' }}>
                              {(v.impressions || 0) > 0 ? `${v.ctr.toFixed(2)}%` : '—'}
                            </td>
                          </tr>
                        );
                    })}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )
      ) : loading ? (
        <div className="admin-empty">Loading performance data…</div>
      ) : grouped.length === 0 ? (
        <div className="admin-empty">No data yet. Generate ads and drive traffic to see performance.</div>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>
                  {tab === 'catalogs' ? 'Catalog' : tab === 'brands' ? 'Brand' : tab === 'products' ? 'Product' : 'Style'}
                </th>
                <th>Ads</th>
                <th>Impressions</th>
                <th>Clicks</th>
                <th>CTR</th>
                <th>Spend</th>
                <th>CPC</th>
                <th style={{ width: 120 }}>Volume</th>
              </tr>
            </thead>
            <tbody>
              {grouped.map(b => (
                <tr key={b.key}>
                  <td style={{ textAlign: 'left' }}>
                    <div style={{ fontWeight: 600, fontSize: 13, color: '#111', textTransform: tab === 'styles' ? 'capitalize' : 'none' }}>
                      {b.label}
                    </div>
                    {b.sublabel && <div style={{ fontSize: 11, color: '#888' }}>{b.sublabel}</div>}
                  </td>
                  <td>{b.adCount}</td>
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
                  <td>{b.cpc > 0 ? `$${b.cpc.toFixed(3)}` : '—'}</td>
                  <td>
                    <div style={{ height: 6, borderRadius: 3, background: '#f1f5f9', overflow: 'hidden' }}>
                      <div style={{
                        height: '100%',
                        width: `${(b.impressions / maxImpressions) * 100}%`,
                        background: 'linear-gradient(90deg, #3b82f6, #8b5cf6)',
                      }} />
                    </div>
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
