// Admin · Stylist detail — showroom viewer + basic stats for one stylist
// (Phase 4). Read-only; the stylist themselves manages the picks from
// /style/showroom.
import { useEffect, useState } from 'react';
import { Link, useParams } from '@remix-run/react';
import { supabase } from '~/utils/supabase';
import '~/styles/admin.css';

type Gender = 'men' | 'women' | 'unisex';

interface StylistRow {
  id: string;
  name: string;
  is_human: boolean;
  bio: string | null;
  specialty: string | null;
  gender_focus: Gender | null;
  avatar_url: string | null;
}
interface ShowroomItem {
  product_id: string;
  gender: Gender;
  sort: number;
  name: string | null;
  brand: string | null;
  image_url: string | null;
  price: string | null;
}

const GENDERS: Gender[] = ['men', 'women', 'unisex'];

export default function AdminStylistDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [stylist, setStylist] = useState<StylistRow | null>(null);
  const [items, setItems] = useState<ShowroomItem[]>([]);
  const [counts, setCounts] = useState<{ threads: number; clickouts: number }>({ threads: 0, clickouts: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      const [sRes, itemsRes, threadsRes, clicksRes] = await Promise.all([
        supabase.from('style_up_stylists')
          .select('id, name, is_human, bio, specialty, gender_focus, avatar_url')
          .eq('id', id).maybeSingle(),
        supabase.from('stylist_showroom_products')
          .select('product_id, gender, sort, products(name, brand, image_url, price)')
          .eq('stylist_id', id).order('gender', { ascending: true }).order('sort', { ascending: true }),
        supabase.from('style_up_threads').select('id', { count: 'exact', head: true }).eq('stylist_id', id),
        supabase.from('affiliate_clicks').select('id', { count: 'exact', head: true }).eq('stylist_id', id),
      ]);
      if (cancelled) return;
      if (sRes.error) { setError(sRes.error.message); setLoading(false); return; }
      setStylist(sRes.data as StylistRow);
      type JoinedProduct = { name: string | null; brand: string | null; image_url: string | null; price: string | null };
      type JoinedRow = { product_id: string; gender: Gender; sort: number; products: JoinedProduct | JoinedProduct[] | null };
      setItems((itemsRes.data as unknown as JoinedRow[] ?? []).map(r => {
        const pr = Array.isArray(r.products) ? r.products[0] ?? null : r.products;
        return {
          product_id: r.product_id, gender: r.gender, sort: r.sort,
          name: pr?.name ?? null, brand: pr?.brand ?? null,
          image_url: pr?.image_url ?? null, price: pr?.price ?? null,
        };
      }));
      setCounts({ threads: threadsRes.count ?? 0, clickouts: clicksRes.count ?? 0 });
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [id]);

  if (loading) return <div className="admin-page"><div className="admin-loading">Loading…</div></div>;
  if (!stylist) return <div className="admin-page"><div className="admin-error">Stylist not found.</div></div>;

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <Link to="/admin/stylists" className="admin-btn admin-btn-secondary">← Stylists</Link>
        <h1>{stylist.name}</h1>
        <div className="admin-page-subtitle">
          {stylist.is_human ? 'Human' : 'AI'} · {counts.threads} threads · {counts.clickouts} clickouts
        </div>
      </div>

      {error && <div className="admin-error">{error}</div>}

      {stylist.bio && <p style={{ color: 'var(--admin-text-muted, #6a6a6a)', marginTop: 8 }}>{stylist.bio}</p>}

      <section className="admin-section">
        <h2>Showroom ({items.length})</h2>
        {items.length === 0 && <div className="admin-empty">No products in the showroom yet.</div>}
        {GENDERS.map(g => {
          const bin = items.filter(i => i.gender === g);
          if (bin.length === 0) return null;
          return (
            <div key={g} style={{ marginTop: 16 }}>
              <h3 style={{ fontSize: 14, textTransform: 'capitalize', margin: '0 0 8px' }}>{g} ({bin.length})</h3>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
                gap: 12,
              }}>
                {bin.map(p => (
                  <div key={p.product_id} style={{ background: 'rgba(0,0,0,0.03)', borderRadius: 8, overflow: 'hidden' }}>
                    {p.image_url
                      ? <img src={p.image_url} alt="" style={{ width: '100%', aspectRatio: '3/4', objectFit: 'cover' }} loading="lazy" />
                      : <div style={{ width: '100%', aspectRatio: '3/4', background: 'rgba(0,0,0,0.05)' }} />}
                    <div style={{ padding: '8px 10px', fontSize: 12 }}>
                      <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name ?? 'Untitled'}</div>
                      {p.brand && <div style={{ color: '#888' }}>{p.brand}</div>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </section>
    </div>
  );
}
