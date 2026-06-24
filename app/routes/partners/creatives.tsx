import { useEffect, useState } from 'react';
import { Link } from '@remix-run/react';
import { supabase } from '~/utils/supabase';
import { usePartnersContext } from '~/hooks/useBrandMembership';

interface Creative {
  id: string;
  status: string | null;
  video_url: string | null;
  impressions: number | null;
  clicks: number | null;
  created_at: string;
  product: { name: string | null; image_url: string | null } | null;
}

// Map the raw generation status to a friendly label + tone.
function statusBadge(status: string | null, hasVideo: boolean): { label: string; color: string; bg: string } {
  const s = (status || '').toLowerCase();
  if (s === 'failed') return { label: 'Failed', color: '#b42318', bg: '#fef3f2' };
  if (s === 'done' || s === 'live' || hasVideo) return { label: 'Ready', color: '#188a4a', bg: '#ecfdf3' };
  if (s === 'generating' || s === 'pending') return { label: 'Generating…', color: '#9a6b00', bg: '#fffaeb' };
  return { label: 'Queued', color: '#475467', bg: '#f2f4f7' };
}

export default function PartnersCreatives() {
  const { brand } = usePartnersContext();
  const [rows, setRows] = useState<Creative[] | null>(null);

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    (async () => {
      // product_creative is public-read; filter to this brand via the inner join.
      const { data } = await supabase
        .from('product_creative')
        .select('id, status, video_url, impressions, clicks, created_at, products!inner(name, image_url, brand_id)')
        .eq('products.brand_id', brand.id)
        .order('created_at', { ascending: false })
        .limit(300);
      if (cancelled) return;
      setRows((data ?? []).map((r: any) => ({
        id: r.id, status: r.status, video_url: r.video_url,
        impressions: r.impressions, clicks: r.clicks, created_at: r.created_at,
        product: r.products ?? null,
      })));
    })();
    return () => { cancelled = true; };
  }, [brand.id]);

  return (
    <div style={{ padding: 24, maxWidth: 1100 }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, margin: '0 0 4px' }}>Creatives</h1>
      <p style={{ fontSize: 13, color: '#8b8b93', margin: '0 0 18px' }}>
        AI-generated video ads for {brand.name}’s products. Generation is run by the Catalog team.
      </p>

      {rows === null ? (
        <div style={{ fontSize: 13, color: '#8b8b93' }}>Loading…</div>
      ) : rows.length === 0 ? (
        <div style={{ padding: 28, borderRadius: 14, border: '1px dashed #d8d8de', textAlign: 'center', color: '#8b8b93' }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#444' }}>No creatives yet</div>
          <div style={{ fontSize: 13, marginTop: 4 }}>
            Creatives are generated from your <Link to="/partners/products">products</Link> once they’re reviewed.
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 14 }}>
          {rows.map(c => {
            const badge = statusBadge(c.status, Boolean(c.video_url));
            return (
              <div key={c.id} style={{ border: '1px solid #ececef', borderRadius: 14, overflow: 'hidden', background: '#fff' }}>
                <div style={{ aspectRatio: '3 / 4', background: '#f0f0f2', position: 'relative' }}>
                  {c.video_url ? (
                    <video src={c.video_url} muted playsInline preload="metadata" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : c.product?.image_url ? (
                    <img src={c.product.image_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : null}
                  <span style={{ position: 'absolute', top: 8, left: 8, padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700, color: badge.color, background: badge.bg }}>
                    {badge.label}
                  </span>
                </div>
                <div style={{ padding: '10px 12px' }}>
                  <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {c.product?.name || 'Product'}
                  </div>
                  <div style={{ fontSize: 12, color: '#8b8b93', marginTop: 4 }}>
                    {(c.impressions ?? 0).toLocaleString()} imp · {(c.clicks ?? 0).toLocaleString()} clicks
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
