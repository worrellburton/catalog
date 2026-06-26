import { useEffect, useState } from 'react';
import { Link } from '@remix-run/react';
import { supabase } from '~/utils/supabase';
import { usePartnersContext } from '~/hooks/useBrandMembership';

interface Counts { total: number; active: number; shopify: number; members: number }
interface DailyPoint { day: string; impressions: number; clicks: number; clickouts: number }
interface Analytics { days: number; product_count: number; impressions: number; clicks: number; clickouts: number; daily: DailyPoint[] }

const RANGES = [{ label: '7d', days: 7 }, { label: '30d', days: 30 }, { label: '90d', days: 90 }];

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div style={{ flex: '1 1 150px', minWidth: 150, padding: 18, borderRadius: 14, border: '1px solid #ececef', background: '#fff' }}>
      <div style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: '#8b8b93' }}>{label}</div>
      <div style={{ fontSize: 30, fontWeight: 800, marginTop: 6 }}>{value}</div>
      {hint && <div style={{ fontSize: 12, color: '#8b8b93', marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

// Dependency-free daily impressions chart — bars normalized to the window max.
function ImpressionBars({ daily }: { daily: DailyPoint[] }) {
  if (daily.length === 0) return <div style={{ fontSize: 13, color: '#8b8b93', padding: '8px 0' }}>No activity in this window yet.</div>;
  const max = Math.max(1, ...daily.map(d => d.impressions));
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 96, padding: '8px 0' }}>
      {daily.map(d => (
        <div
          key={d.day}
          title={`${d.day}: ${d.impressions} impressions${d.clickouts ? `, ${d.clickouts} clickouts` : ''}`}
          style={{
            flex: 1, minWidth: 2,
            height: `${Math.max(3, (d.impressions / max) * 100)}%`,
            background: d.clickouts > 0 ? '#1f5fd6' : '#cdd6e6',
            borderRadius: 2,
          }}
        />
      ))}
    </div>
  );
}

export default function PartnersDashboard() {
  const { brand, role } = usePartnersContext();
  const [counts, setCounts] = useState<Counts | null>(null);
  const [days, setDays] = useState(30);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);

  // Catalog counts (range-independent).
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    (async () => {
      const base = () => supabase!.from('products').select('id', { count: 'exact', head: true }).eq('brand_id', brand.id);
      const [total, active, shopify, members] = await Promise.all([
        base(),
        base().eq('is_active', true),
        base().eq('source', 'shopify'),
        supabase!.from('brand_members').select('user_id', { count: 'exact', head: true }).eq('brand_id', brand.id).eq('status', 'active'),
      ]);
      if (cancelled) return;
      setCounts({ total: total.count ?? 0, active: active.count ?? 0, shopify: shopify.count ?? 0, members: members.count ?? 0 });
    })();
    return () => { cancelled = true; };
  }, [brand.id]);

  // Performance analytics (range-dependent), via the membership-gated RPC.
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    setAnalytics(null);
    (async () => {
      const { data, error } = await supabase.rpc('brand_portal_analytics', { p_brand_id: brand.id, p_days: days });
      if (cancelled || error) return;
      setAnalytics(data as Analytics);
    })();
    return () => { cancelled = true; };
  }, [brand.id, days]);

  const connected = Boolean(brand.shopify_shop);
  const clickoutRate = analytics && analytics.impressions > 0
    ? `${((analytics.clickouts / analytics.impressions) * 100).toFixed(1)}%` : '—';

  return (
    <div style={{ padding: 24, maxWidth: 980 }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, margin: '0 0 4px' }}>{brand.name}</h1>
      <p style={{ fontSize: 13, color: '#8b8b93', margin: '0 0 20px', textTransform: 'capitalize' }}>You are {role} of this brand.</p>

      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
        padding: 16, borderRadius: 14, border: '1px solid #ececef',
        background: connected ? '#f1faf3' : '#fff8f1', marginBottom: 18,
      }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700 }}>
            {connected ? `Shopify connected — ${brand.shopify_shop}` : 'Shopify not connected'}
          </div>
          <div style={{ fontSize: 12, color: '#8b8b93', marginTop: 2 }}>
            {connected ? 'Synced products flow into the catalog automatically.' : 'Connect your store to import products.'}
          </div>
        </div>
        <Link to="/partners/store" style={{ padding: '8px 14px', borderRadius: 9, background: '#111', color: '#fff', fontSize: 13, fontWeight: 600, textDecoration: 'none', whiteSpace: 'nowrap' }}>
          {connected ? 'Manage store' : 'Connect Shopify'}
        </Link>
      </div>

      {/* Catalog */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 24 }}>
        <Stat label="Products" value={counts?.total ?? '—'} />
        <Stat label="Live in feed" value={counts?.active ?? '—'} hint="Active products" />
        <Stat label="From Shopify" value={counts?.shopify ?? '—'} />
        <Stat label="Team" value={counts?.members ?? '—'} hint="Active members" />
      </div>

      {/* Performance */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <h2 style={{ fontSize: 16, fontWeight: 800, margin: 0 }}>Performance</h2>
        <div style={{ display: 'inline-flex', gap: 4, background: '#f1f1f4', borderRadius: 9, padding: 3 }}>
          {RANGES.map(r => (
            <button
              key={r.days}
              onClick={() => setDays(r.days)}
              style={{
                padding: '5px 12px', borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600,
                background: days === r.days ? '#fff' : 'transparent',
                color: days === r.days ? '#111' : '#8b8b93',
                boxShadow: days === r.days ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
              }}
            >{r.label}</button>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 12 }}>
        <Stat label="Impressions" value={analytics ? analytics.impressions.toLocaleString() : '—'} />
        <Stat label="Clickouts" value={analytics ? analytics.clickouts.toLocaleString() : '—'} hint="Taps through to your store" />
        <Stat label="Clickout rate" value={clickoutRate} />
      </div>

      <div style={{ padding: '8px 16px 12px', borderRadius: 14, border: '1px solid #ececef', background: '#fff' }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#8b8b93', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          Daily impressions
        </div>
        {analytics ? <ImpressionBars daily={analytics.daily} /> : <div style={{ height: 96 }} />}
      </div>
    </div>
  );
}
