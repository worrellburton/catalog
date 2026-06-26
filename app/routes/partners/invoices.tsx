import { useEffect, useState } from 'react';
import { Link } from '@remix-run/react';
import { supabase } from '~/utils/supabase';
import { usePartnersContext } from '~/hooks/useBrandMembership';

interface Row {
  id: string;
  number: string | null;
  amount: number | null;
  currency: string | null;
  status: 'paid' | 'open' | 'void' | null;
  issued_at: string | null;
  pdf_url: string | null;
}

const STATUS_COLOR: Record<string, string> = { paid: '#188a4a', open: '#9a6b00', void: '#8b8b93' };

export default function PartnersInvoices() {
  const { brand } = usePartnersContext();
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('brand_invoices')
        .select('id, number, amount, currency, status, issued_at, pdf_url')
        .eq('brand_id', brand.id)
        .order('issued_at', { ascending: false })
        .limit(500);
      if (!cancelled) setRows((data ?? []) as Row[]);
    })();
    return () => { cancelled = true; };
  }, [brand.id]);

  return (
    <div style={{ padding: 24, maxWidth: 980 }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, margin: '0 0 4px' }}>Invoices</h1>
      <p style={{ fontSize: 13, color: '#8b8b93', margin: '0 0 6px' }}>
        Your billing history for {brand.name}.
      </p>
      <p style={{ fontSize: 13, margin: '0 0 18px' }}>
        <Link to="/partners/billing">← Back to billing</Link>
      </p>

      {rows === null ? (
        <div style={{ fontSize: 13, color: '#8b8b93' }}>Loading…</div>
      ) : rows.length === 0 ? (
        <div style={{ padding: 28, borderRadius: 14, border: '1px dashed #d8d8de', textAlign: 'center', color: '#8b8b93' }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#444' }}>No invoices yet.</div>
          <div style={{ fontSize: 13, marginTop: 4 }}>Invoices will appear here once you’re billed.</div>
        </div>
      ) : (
        <div style={{ border: '1px solid #ececef', borderRadius: 14, overflow: 'hidden', background: '#fff' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#fafafb', textAlign: 'left', color: '#8b8b93' }}>
                <th style={{ padding: '10px 14px', fontWeight: 600 }}>Number</th>
                <th style={{ padding: '10px 14px', fontWeight: 600 }}>Date</th>
                <th style={{ padding: '10px 14px', fontWeight: 600 }}>Amount</th>
                <th style={{ padding: '10px 14px', fontWeight: 600 }}>Status</th>
                <th style={{ padding: '10px 14px', fontWeight: 600, textAlign: 'right' }}>Download</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r: any) => (
                <tr key={r.id} style={{ borderTop: '1px solid #f0f0f2' }}>
                  <td style={{ padding: '10px 14px', fontWeight: 600 }}>{r.number || '—'}</td>
                  <td style={{ padding: '10px 14px', color: '#6b6b73' }}>{fmtDate(r.issued_at)}</td>
                  <td style={{ padding: '10px 14px' }}>{fmtAmount(r.amount, r.currency)}</td>
                  <td style={{ padding: '10px 14px' }}>
                    <span style={{ color: STATUS_COLOR[r.status] ?? '#8b8b93', fontWeight: 600, textTransform: 'capitalize' }}>
                      {r.status || '—'}
                    </span>
                  </td>
                  <td style={{ padding: '10px 14px', textAlign: 'right' }}>
                    {r.pdf_url
                      ? <a href={r.pdf_url} target="_blank" rel="noreferrer">PDF</a>
                      : <span style={{ color: '#c8c8ce' }}>—</span>}
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

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function fmtAmount(amount: number | null, currency: string | null): string {
  if (amount == null) return '—';
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: (currency || 'USD').toUpperCase() }).format(amount);
  } catch {
    return `${(currency || 'USD').toUpperCase()} ${amount.toFixed(2)}`;
  }
}
