import { useEffect, useState } from 'react';
import { supabase } from '~/utils/supabase';
import { usePartnersContext } from '~/hooks/useBrandMembership';

interface Row {
  id: string;
  order_number: string | null;
  customer_name: string | null;
  customer_email: string | null;
  total: number | null;
  currency: string | null;
  status: string | null;
  placed_at: string | null;
}

const STATUS_COLORS: Record<string, string> = {
  paid: '#188a4a', fulfilled: '#188a4a', completed: '#188a4a',
  pending: '#9a6b00', open: '#9a6b00',
  refunded: '#c0392b', cancelled: '#c0392b', canceled: '#c0392b',
};

function money(amount: number, currency: string | null) {
  const cur = (currency || 'USD').toUpperCase();
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur }).format(amount);
  } catch {
    return `${cur} ${amount.toFixed(2)}`;
  }
}

export default function PartnersOrders() {
  const { brand } = usePartnersContext();
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('brand_orders')
        .select('id, order_number, customer_name, customer_email, total, currency, status, placed_at')
        .eq('brand_id', brand.id)
        .order('placed_at', { ascending: false, nullsFirst: false })
        .limit(500);
      if (!cancelled) setRows((data ?? []) as Row[]);
    })();
    return () => { cancelled = true; };
  }, [brand.id]);

  const revenue = (rows ?? []).reduce((s, r) => s + (Number(r.total) || 0), 0);
  const currency = rows?.find(r => r.currency)?.currency ?? 'USD';

  return (
    <div style={{ padding: 24, maxWidth: 980 }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, margin: '0 0 4px' }}>Orders</h1>
      <p style={{ fontSize: 13, color: '#8b8b93', margin: '0 0 18px' }}>
        Sales from {brand.name}, newest first.
      </p>

      {rows === null ? (
        <div style={{ fontSize: 13, color: '#8b8b93' }}>Loading…</div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 14, marginBottom: 18 }}>
            <Stat label="Total revenue" value={money(revenue, currency)} />
            <Stat label="Orders" value={String(rows.length)} />
          </div>

          {rows.length === 0 ? (
            <div style={{ padding: 28, borderRadius: 14, border: '1px dashed #d8d8de', textAlign: 'center', color: '#8b8b93' }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#444' }}>No orders yet</div>
              <div style={{ fontSize: 13, marginTop: 4 }}>They'll appear here once your store starts selling.</div>
            </div>
          ) : (
            <div style={{ border: '1px solid #ececef', borderRadius: 14, overflow: 'hidden', background: '#fff' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: '#fafafb', textAlign: 'left', color: '#8b8b93' }}>
                    <th style={{ padding: '10px 14px', fontWeight: 600 }}>Order #</th>
                    <th style={{ padding: '10px 14px', fontWeight: 600 }}>Customer</th>
                    <th style={{ padding: '10px 14px', fontWeight: 600 }}>Total</th>
                    <th style={{ padding: '10px 14px', fontWeight: 600 }}>Status</th>
                    <th style={{ padding: '10px 14px', fontWeight: 600 }}>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r: any) => (
                    <tr key={r.id} style={{ borderTop: '1px solid #f0f0f2' }}>
                      <td style={{ padding: '10px 14px', fontWeight: 600 }}>{r.order_number || '—'}</td>
                      <td style={{ padding: '10px 14px' }}>
                        <div style={{ fontWeight: 600 }}>{r.customer_name || 'Unknown'}</div>
                        {r.customer_email && <div style={{ color: '#8b8b93', fontSize: 12 }}>{r.customer_email}</div>}
                      </td>
                      <td style={{ padding: '10px 14px', fontWeight: 600 }}>{money(Number(r.total) || 0, r.currency)}</td>
                      <td style={{ padding: '10px 14px' }}>
                        <span style={{ color: STATUS_COLORS[(r.status || '').toLowerCase()] || '#8b8b93', fontWeight: 600, textTransform: 'capitalize' }}>
                          {r.status || '—'}
                        </span>
                      </td>
                      <td style={{ padding: '10px 14px', color: '#8b8b93' }}>
                        {r.placed_at ? new Date(r.placed_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ flex: 1, padding: 16, borderRadius: 14, border: '1px solid #ececef', background: '#fff' }}>
      <div style={{ fontSize: 12, color: '#8b8b93', fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, marginTop: 4 }}>{value}</div>
    </div>
  );
}
