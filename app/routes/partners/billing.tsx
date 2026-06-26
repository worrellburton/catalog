import { useEffect, useState } from 'react';
import { Link } from '@remix-run/react';
import { supabase } from '~/utils/supabase';
import { usePartnersContext } from '~/hooks/useBrandMembership';

interface Sub {
  status: string | null;
  current_period_end: string | null;
  plan: { name: string | null; price_monthly: number | null } | null;
}

const STATUS_COLOR: Record<string, string> = {
  active: '#188a4a',
  past_due: '#9a6b00',
  canceled: '#c0392b',
  inactive: '#8b8b93',
};

export default function PartnersBilling() {
  const { brand } = usePartnersContext();
  const [sub, setSub] = useState<Sub | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('brand_subscriptions')
        .select('status, current_period_end, plan:brand_plans(name, price_monthly)')
        .eq('brand_id', brand.id)
        .maybeSingle();
      if (!cancelled) { setSub((data as any) ?? null); setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [brand.id]);

  return (
    <div style={{ padding: 24, maxWidth: 980 }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, margin: '0 0 4px' }}>Billing</h1>
      <p style={{ fontSize: 13, color: '#8b8b93', margin: '0 0 18px' }}>
        Your subscription and invoices.
      </p>

      {loading ? (
        <div style={{ fontSize: 13, color: '#8b8b93' }}>Loading…</div>
      ) : !sub ? (
        <div style={{ padding: 28, borderRadius: 14, border: '1px dashed #d8d8de', textAlign: 'center', color: '#8b8b93' }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#444' }}>No active plan</div>
          <div style={{ fontSize: 13, marginTop: 4 }}>
            <Link to="/partners/billing/plans">Choose a plan</Link> to get started.
          </div>
        </div>
      ) : (
        <div style={{ padding: 20, borderRadius: 14, border: '1px solid #ececef', background: '#fff' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 18, fontWeight: 800 }}>{sub.plan?.name || 'Current plan'}</span>
            <span
              style={{
                padding: '2px 8px', borderRadius: 999, fontSize: 12, fontWeight: 600,
                background: '#f4f4f6', color: STATUS_COLOR[sub.status || 'inactive'] ?? '#8b8b93',
                textTransform: 'capitalize',
              }}
            >
              {(sub.status || 'inactive').replace('_', ' ')}
            </span>
          </div>

          <div style={{ fontSize: 13, color: '#8b8b93', marginTop: 6 }}>
            {sub.plan?.price_monthly != null ? `$${sub.plan.price_monthly}/mo` : '—'}
            {sub.current_period_end && (
              <> · renews {new Date(sub.current_period_end).toLocaleDateString()}</>
            )}
          </div>

          <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
            <Link
              to="/partners/billing/plans"
              style={{ padding: '9px 18px', borderRadius: 9, fontSize: 13, fontWeight: 600, background: '#111', color: '#fff', textDecoration: 'none' }}
            >
              Change plan
            </Link>
            <Link
              to="/partners/billing/invoices"
              style={{ padding: '9px 18px', borderRadius: 9, fontSize: 13, fontWeight: 600, background: '#f4f4f6', color: '#1a1a1f', textDecoration: 'none', border: '1px solid #ececef' }}
            >
              Invoices
            </Link>
          </div>
        </div>
      )}

      <p style={{ fontSize: 12, color: '#8b8b93', margin: '14px 0 0' }}>
        Payment processing (Stripe) is connected separately.
      </p>
    </div>
  );
}
