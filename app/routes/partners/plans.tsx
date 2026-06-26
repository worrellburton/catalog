import { useEffect, useState } from 'react';
import { Link } from '@remix-run/react';
import { supabase } from '~/utils/supabase';
import { usePartnersContext } from '~/hooks/useBrandMembership';

export default function PartnersPlans() {
  const { brand, role } = usePartnersContext();
  const canEdit = role === 'owner' || role === 'admin';
  const [plans, setPlans] = useState<any[] | null>(null);
  const [currentPlanId, setCurrentPlanId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    if (!supabase) return;
    const [{ data: planRows }, { data: sub }] = await Promise.all([
      supabase.from('brand_plans').select('*').eq('active', true).order('sort_order', { ascending: true }),
      supabase.from('brand_subscriptions').select('plan_id, status').eq('brand_id', brand.id).maybeSingle(),
    ]);
    setPlans((planRows ?? []) as any[]);
    setCurrentPlanId(sub && (sub as any).status === 'active' ? (sub as any).plan_id : null);
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [brand.id]);

  async function choose(planId: string) {
    if (!supabase || !canEdit) return;
    setErr(null); setBusy(planId);
    const now = new Date().toISOString();
    const { error } = await supabase.from('brand_subscriptions').upsert({
      brand_id: brand.id,
      plan_id: planId,
      status: 'active',
      current_period_end: new Date(Date.now() + 30 * 864e5).toISOString(),
      updated_at: now,
    }, { onConflict: 'brand_id' });
    setBusy(null);
    if (error) { setErr(error.message); return; }
    await load();
  }

  return (
    <div style={{ padding: 24, maxWidth: 980 }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, margin: '0 0 4px' }}>Plans</h1>
      <p style={{ fontSize: 13, color: '#8b8b93', margin: '0 0 6px' }}>
        {canEdit ? 'Pick the plan that fits your brand.' : 'Only a brand owner or admin can change the plan.'}
      </p>
      <p style={{ fontSize: 12, color: '#8b8b93', margin: '0 0 18px' }}>
        Demo billing — real payment (Stripe) is wired separately; this records your selected plan.{' '}
        <Link to="/partners/billing">Back to billing</Link>
      </p>

      {plans === null ? (
        <div style={{ fontSize: 13, color: '#8b8b93' }}>Loading…</div>
      ) : plans.length === 0 ? (
        <div style={{ padding: 28, borderRadius: 14, border: '1px dashed #d8d8de', textAlign: 'center', color: '#8b8b93' }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#444' }}>No plans available</div>
        </div>
      ) : (
        <>
          {err && <div style={{ fontSize: 12, color: '#c0392b', marginBottom: 12 }}>{err}</div>}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
            {plans.map((p: any) => {
              const isCurrent = p.id === currentPlanId;
              const features: string[] = Array.isArray(p.features) ? p.features : [];
              return (
                <div key={p.id} style={{
                  background: '#fff', border: isCurrent ? '2px solid #111' : '1px solid #ececef',
                  borderRadius: 14, padding: 20, display: 'flex', flexDirection: 'column', gap: 14,
                }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 16, fontWeight: 800 }}>{p.name}</span>
                      {isCurrent && (
                        <span style={{ padding: '2px 8px', borderRadius: 999, background: '#111', color: '#fff', fontWeight: 600, fontSize: 11 }}>
                          Current
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 28, fontWeight: 800, marginTop: 6 }}>
                      ${p.price_monthly}
                      <span style={{ fontSize: 13, fontWeight: 600, color: '#8b8b93' }}>/mo</span>
                    </div>
                  </div>

                  <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
                    {features.map((f, i) => (
                      <li key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                        <span style={{ color: '#188a4a', fontWeight: 700 }}>✓</span>
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>

                  {canEdit && (
                    <button
                      onClick={() => choose(p.id)}
                      disabled={isCurrent || busy !== null}
                      style={{
                        padding: '9px 16px', borderRadius: 9, border: isCurrent ? '1px solid #ececef' : 'none',
                        fontSize: 13, fontWeight: 600, cursor: isCurrent || busy ? 'default' : 'pointer',
                        background: isCurrent ? '#fff' : busy === p.id ? '#ececef' : '#111',
                        color: isCurrent ? '#8b8b93' : busy === p.id ? '#9a9aa2' : '#fff',
                      }}>
                      {isCurrent ? 'Current plan' : busy === p.id ? 'Saving…' : 'Choose plan'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
