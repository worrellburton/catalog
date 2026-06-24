import { useEffect, useState } from 'react';
import { Link } from '@remix-run/react';
import { supabase } from '~/utils/supabase';
import { usePartnersContext } from '~/hooks/useBrandMembership';

interface Counts { total: number; active: number; shopify: number; members: number }

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div style={{ flex: '1 1 160px', minWidth: 160, padding: 18, borderRadius: 14, border: '1px solid #ececef', background: '#fff' }}>
      <div style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: '#8b8b93' }}>{label}</div>
      <div style={{ fontSize: 30, fontWeight: 800, marginTop: 6 }}>{value}</div>
      {hint && <div style={{ fontSize: 12, color: '#8b8b93', marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

export default function PartnersDashboard() {
  const { brand, role } = usePartnersContext();
  const [counts, setCounts] = useState<Counts | null>(null);

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
      setCounts({
        total: total.count ?? 0,
        active: active.count ?? 0,
        shopify: shopify.count ?? 0,
        members: members.count ?? 0,
      });
    })();
    return () => { cancelled = true; };
  }, [brand.id]);

  const connected = Boolean(brand.shopify_shop);

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

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        <Stat label="Products" value={counts?.total ?? '—'} />
        <Stat label="Live in feed" value={counts?.active ?? '—'} hint="Active products" />
        <Stat label="From Shopify" value={counts?.shopify ?? '—'} />
        <Stat label="Team" value={counts?.members ?? '—'} hint="Active members" />
      </div>
    </div>
  );
}
