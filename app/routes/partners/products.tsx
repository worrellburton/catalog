import { useEffect, useState } from 'react';
import { Link } from '@remix-run/react';
import { supabase } from '~/utils/supabase';
import { usePartnersContext } from '~/hooks/useBrandMembership';

interface Row {
  id: string;
  name: string | null;
  brand: string | null;
  image_url: string | null;
  source: string | null;
  is_active: boolean | null;
  primary_video_url: string | null;
  price: string | null;
}

export default function PartnersProducts() {
  const { brand } = usePartnersContext();
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('products')
        .select('id, name, brand, image_url, source, is_active, primary_video_url, price')
        .eq('brand_id', brand.id)
        .order('created_at', { ascending: false })
        .limit(500);
      if (!cancelled) setRows((data ?? []) as Row[]);
    })();
    return () => { cancelled = true; };
  }, [brand.id]);

  return (
    <div style={{ padding: 24, maxWidth: 1100 }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, margin: '0 0 4px' }}>Products</h1>
      <p style={{ fontSize: 13, color: '#8b8b93', margin: '0 0 18px' }}>
        Products owned by {brand.name}. Imported items are reviewed and promoted to the feed by the Catalog team.
      </p>

      {rows === null ? (
        <div style={{ fontSize: 13, color: '#8b8b93' }}>Loading…</div>
      ) : rows.length === 0 ? (
        <div style={{ padding: 28, borderRadius: 14, border: '1px dashed #d8d8de', textAlign: 'center', color: '#8b8b93' }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#444' }}>No products yet</div>
          <div style={{ fontSize: 13, marginTop: 4 }}>
            {brand.shopify_shop
              ? 'A sync is pending — products will appear here shortly.'
              : <>Connect Shopify on the <Link to="/partners/store">Store</Link> page to import your catalog.</>}
          </div>
        </div>
      ) : (
        <div style={{ border: '1px solid #ececef', borderRadius: 14, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#fafafb', textAlign: 'left', color: '#8b8b93' }}>
                <th style={{ padding: '10px 14px', fontWeight: 600 }}>Product</th>
                <th style={{ padding: '10px 14px', fontWeight: 600 }}>Source</th>
                <th style={{ padding: '10px 14px', fontWeight: 600 }}>Price</th>
                <th style={{ padding: '10px 14px', fontWeight: 600 }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const live = r.is_active && r.primary_video_url;
                return (
                  <tr key={r.id} style={{ borderTop: '1px solid #f0f0f2' }}>
                    <td style={{ padding: '10px 14px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        {r.image_url
                          ? <img src={r.image_url} alt="" style={{ width: 36, height: 36, borderRadius: 7, objectFit: 'cover', background: '#f0f0f2' }} />
                          : <span style={{ width: 36, height: 36, borderRadius: 7, background: '#f0f0f2', display: 'inline-block' }} />}
                        <span style={{ fontWeight: 600 }}>{r.name || 'Untitled'}</span>
                      </div>
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      {r.source === 'shopify'
                        ? <span style={{ padding: '2px 8px', borderRadius: 999, background: '#e7f0ff', color: '#1f5fd6', fontWeight: 600, fontSize: 12 }}>Shopify</span>
                        : <span style={{ color: '#8b8b93', textTransform: 'capitalize' }}>{r.source || '—'}</span>}
                    </td>
                    <td style={{ padding: '10px 14px' }}>{r.price ? `$${r.price}` : '—'}</td>
                    <td style={{ padding: '10px 14px' }}>
                      <span style={{ color: live ? '#188a4a' : '#9a6b00', fontWeight: 600 }}>
                        {live ? 'Live' : r.is_active ? 'Awaiting video' : 'In review'}
                      </span>
                    </td>
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
