// Admin preview of the personalized daily feed (the landing-screen "Your
// daily feed" catalog). Lets an admin see what ANY shopper's live feed looks
// like by username, plus the cohort baselines (all users / men / women).
//
// Per-user mode calls the admin-gated `personalize-feed` edge function with
// { target_user_id } — it computes that user's feed live and never persists
// to their real daily row. Cohort modes render the global active product feed
// (what a cold-start shopper sees), gender-filtered.

import { useState } from 'react';
import { supabase } from '~/utils/supabase';

type Mode = 'user' | 'all' | 'men' | 'women';

interface PreviewProduct { id: string; name: string; brand: string; image: string }

// Strip characters that would break a PostgREST .or() filter string (an admin
// types free text here). Keeps the ilike match safe + predictable.
function sanitizeTerm(s: string): string {
  return s.replace(/[%,()*\\]/g, '').trim();
}

const MODES: { id: Mode; label: string }[] = [
  { id: 'user', label: 'By username' },
  { id: 'all', label: 'All users' },
  { id: 'men', label: 'All men' },
  { id: 'women', label: 'All women' },
];

export default function DailyFeedPreview({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [mode, setMode] = useState<Mode>('user');
  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [who, setWho] = useState<string | null>(null);
  const [variant, setVariant] = useState<string | null>(null);
  const [products, setProducts] = useState<PreviewProduct[]>([]);

  if (!open) return null;

  async function resolveUser(q: string): Promise<{ id: string; label: string } | null> {
    if (!supabase) return null;
    const term = sanitizeTerm(q);
    if (!term) return null;
    const { data: profs } = await supabase
      .from('profiles').select('id, full_name, email')
      .or(`full_name.ilike.%${term}%,email.ilike.%${term}%`).limit(1);
    if (profs && profs.length) return { id: profs[0].id as string, label: (profs[0].full_name || profs[0].email || term) as string };
    // creators.id === profiles.id, so a handle/display-name match resolves too.
    const { data: creators } = await supabase
      .from('creators').select('id, handle, display_name')
      .or(`handle.ilike.%${term}%,display_name.ilike.%${term}%`).limit(1);
    if (creators && creators.length) return { id: creators[0].id as string, label: (creators[0].display_name || creators[0].handle || term) as string };
    return null;
  }

  async function productsByIds(ids: string[]): Promise<PreviewProduct[]> {
    if (!supabase || ids.length === 0) return [];
    const { data } = await supabase
      .from('products').select('id, name, brand, primary_video_poster_url, primary_image_url, image_url')
      .in('id', ids.slice(0, 60));
    const byId = new Map((data ?? []).map((p: Record<string, unknown>) => [p.id as string, p]));
    return ids.map(id => byId.get(id)).filter(Boolean).map((p) => {
      const r = p as Record<string, string | null>;
      return { id: r.id as string, name: r.name || 'Product', brand: r.brand || '', image: r.primary_video_poster_url || r.primary_image_url || r.image_url || '' };
    });
  }

  async function cohort(gender: 'all' | 'men' | 'women'): Promise<PreviewProduct[]> {
    if (!supabase) return [];
    const { data } = await supabase
      .from('products').select('id, name, brand, gender, primary_video_poster_url, primary_image_url, image_url')
      .eq('is_active', true).not('primary_video_url', 'is', null)
      .order('feed_rank', { ascending: true, nullsFirst: false }).limit(60);
    let rows = (data ?? []) as Record<string, string | null>[];
    if (gender !== 'all') rows = rows.filter(p => !p.gender || p.gender === gender || p.gender === 'unisex');
    return rows.map(r => ({ id: r.id as string, name: r.name || 'Product', brand: r.brand || '', image: r.primary_video_poster_url || r.primary_image_url || r.image_url || '' }));
  }

  const run = async () => {
    if (!supabase) { setErr('Supabase not configured.'); return; }
    setLoading(true); setErr(null); setProducts([]); setWho(null); setVariant(null);
    try {
      if (mode === 'user') {
        const u = await resolveUser(username);
        if (!u) { setErr(`No user found matching “${username}”.`); setLoading(false); return; }
        setWho(u.label);
        const { data, error } = await supabase.functions.invoke('personalize-feed', { body: { target_user_id: u.id } });
        if (error) throw error;
        const resp = data as { enabled?: boolean; variant?: string; ranked_items?: { id: string }[] };
        setVariant(resp.enabled === false ? 'auto-editor disabled' : (resp.variant ?? null));
        const ids = (resp.ranked_items ?? []).map(r => r.id);
        // personalized/cold-start with no ranked ids → fall back to the global feed.
        setProducts(ids.length ? await productsByIds(ids) : await cohort('all'));
      } else {
        setWho(mode === 'all' ? 'All users' : mode === 'men' ? 'All men' : 'All women');
        setVariant('global feed');
        setProducts(await cohort(mode));
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load feed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      role="dialog" aria-modal="true" aria-label="Preview daily feed"
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 12000, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '6vh 16px', overflow: 'auto' }}
    >
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, width: 'min(880px, 100%)', boxShadow: '0 24px 70px rgba(0,0,0,0.35)', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, padding: '16px 18px', borderBottom: '1px solid #eee' }}>
          <div>
            <h2 style={{ margin: '0 0 2px', fontSize: 17, fontWeight: 700, color: '#111' }}>Preview the daily feed</h2>
            <p style={{ margin: 0, fontSize: 12.5, color: '#777' }}>See any shopper’s live personalized feed, or a cohort baseline.</p>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ background: 'transparent', border: 'none', fontSize: 22, lineHeight: 1, color: '#999', cursor: 'pointer' }}>×</button>
        </div>

        <div style={{ padding: '14px 18px' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
            {MODES.map(m => (
              <button
                key={m.id}
                onClick={() => { setMode(m.id); setProducts([]); setWho(null); setVariant(null); setErr(null); }}
                style={{
                  padding: '6px 12px', borderRadius: 999, fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
                  border: '1px solid', borderColor: mode === m.id ? '#111' : '#e5e7eb',
                  background: mode === m.id ? '#111' : '#fff', color: mode === m.id ? '#fff' : '#444',
                }}
              >{m.label}</button>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 14 }}>
            {mode === 'user' && (
              <input
                value={username}
                onChange={e => setUsername(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') run(); }}
                placeholder="Username, name, or email…"
                style={{ flex: 1, padding: '9px 12px', borderRadius: 8, border: '1px solid #ddd', fontSize: 13, fontFamily: 'inherit' }}
              />
            )}
            <button
              className="admin-btn admin-btn-primary"
              onClick={run}
              disabled={loading || (mode === 'user' && !username.trim())}
              style={{ whiteSpace: 'nowrap' }}
            >{loading ? 'Loading…' : 'Preview feed'}</button>
          </div>

          {err && <div style={{ background: '#fef2f2', color: '#b91c1c', borderRadius: 8, padding: '10px 12px', fontSize: 13, marginBottom: 12 }}>{err}</div>}

          {who && !err && (
            <div style={{ fontSize: 12.5, color: '#555', marginBottom: 10 }}>
              Showing <strong style={{ color: '#111' }}>{who}</strong>
              {variant && <span style={{ marginLeft: 6, padding: '2px 8px', borderRadius: 999, background: '#eef2ff', color: '#4338ca', fontSize: 11, fontWeight: 600 }}>{variant}</span>}
              <span style={{ marginLeft: 6, color: '#999' }}>· {products.length} items</span>
            </div>
          )}

          {products.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 10, maxHeight: '52vh', overflow: 'auto' }}>
              {products.map((p, i) => (
                <div key={`${p.id}-${i}`} style={{ border: '1px solid #f0f0f0', borderRadius: 10, overflow: 'hidden', background: '#fafafa' }}>
                  <div style={{ position: 'relative', aspectRatio: '3 / 4', background: p.image ? `center/cover no-repeat url(${p.image})` : '#e9e9ee' }}>
                    <span style={{ position: 'absolute', top: 4, left: 4, background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: 10, fontWeight: 700, borderRadius: 6, padding: '1px 6px' }}>{i + 1}</span>
                  </div>
                  <div style={{ padding: '6px 8px' }}>
                    {p.brand && <div style={{ fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: '0.3px', fontWeight: 700 }}>{p.brand}</div>}
                    <div style={{ fontSize: 12, color: '#222', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
