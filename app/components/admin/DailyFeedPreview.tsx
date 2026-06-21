// Daily Feed — preview panel. See what ANY shopper's feed looks like:
//   • By user — their LIVE feed (today) computed on demand, or
//   • a past DATE — the exact feed they were served that day (read back
//     from the persisted personalized_feeds row), or
//   • a cohort baseline (all users / men / women — what a cold-start sees).
//
// Products AND looks are shown, woven together the way the consumer feed does
// (by feed_rank, looks leading) so the preview matches what the shopper sees.
// Per-user "live" mode calls the admin-gated `personalize-feed` edge function
// with { target_user_id } (computes live, never persists). A past date reads
// the stored personalized_feeds row. "Daily Feed" is canonical — docs/daily-feed.md.

import { useEffect, useRef, useState } from 'react';
import { supabase } from '~/utils/supabase';

type Mode = 'user' | 'all' | 'men' | 'women';

interface PreviewItem {
  kind: 'product' | 'look';
  id: string;
  title: string;
  sub: string;
  image: string;
  feedRank: number | null;
}

interface FeedReason {
  topBrands?: string[];
  topTypes?: string[];
  engaged?: number;
  seen?: number;
  rules?: string[];
  looks?: number;
}

function sanitizeTerm(s: string): string {
  return s.replace(/[%,()*\\]/g, '').trim();
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

// Weave looks + products exactly like FeedSection's initial deck: sort by
// feed_rank (admin pins lead), looks lead on a tie, otherwise keep input order
// (which is each lane's personalized order); then guarantee a look near the top.
function weave(products: PreviewItem[], looks: PreviewItem[]): PreviewItem[] {
  const entries = [...looks, ...products]; // looks first → they win ties
  const withIdx = entries.map((e, i) => ({ e, i }));
  const rankOf = (e: PreviewItem) => (typeof e.feedRank === 'number' ? e.feedRank : Number.POSITIVE_INFINITY);
  const typeRank = (e: PreviewItem) => (e.kind === 'look' ? 0 : 1);
  withIdx.sort((a, b) => {
    const d = rankOf(a.e) - rankOf(b.e);
    if (d !== 0) return d;
    const t = typeRank(a.e) - typeRank(b.e);
    return t !== 0 ? t : a.i - b.i;
  });
  const sorted = withIdx.map(x => x.e);
  const FRONT = 4;
  const firstLookIdx = sorted.findIndex(e => e.kind === 'look');
  if (firstLookIdx >= FRONT) {
    const [lk] = sorted.splice(firstLookIdx, 1);
    sorted.splice(1, 0, lk);
  }
  return sorted;
}

const MODES: { id: Mode; label: string }[] = [
  { id: 'user', label: 'By user' },
  { id: 'all', label: 'All users' },
  { id: 'men', label: 'All men' },
  { id: 'women', label: 'All women' },
];

export default function DailyFeedPreview() {
  const [mode, setMode] = useState<Mode>('user');
  const [username, setUsername] = useState('');
  const [feedDate, setFeedDate] = useState(''); // '' = today / live
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [who, setWho] = useState<string | null>(null);
  const [variant, setVariant] = useState<string | null>(null);
  const [items, setItems] = useState<PreviewItem[]>([]);
  const [reason, setReason] = useState<FeedReason | null>(null);
  const [suggestions, setSuggestions] = useState<{ id: string; label: string; sub: string }[]>([]);
  const pickedUser = useRef<{ id: string; label: string } | null>(null);
  const searchTimer = useRef(0);

  useEffect(() => {
    if (mode !== 'user') { setSuggestions([]); return; }
    const term = sanitizeTerm(username);
    if (!term || term === pickedUser.current?.label) { setSuggestions([]); return; }
    window.clearTimeout(searchTimer.current);
    searchTimer.current = window.setTimeout(async () => {
      if (!supabase) return;
      const { data } = await supabase
        .from('profiles').select('id, full_name, email')
        .or(`full_name.ilike.%${term}%,email.ilike.%${term}%`).limit(6);
      setSuggestions(((data ?? []) as { id: string; full_name: string | null; email: string | null }[])
        .map(r => ({ id: r.id, label: r.full_name || r.email || r.id.slice(0, 8), sub: r.email || '' })));
    }, 220);
    return () => window.clearTimeout(searchTimer.current);
  }, [username, mode]);

  async function resolveUser(q: string): Promise<{ id: string; label: string } | null> {
    if (!supabase) return null;
    const term = sanitizeTerm(q);
    if (!term) return null;
    const { data: profs } = await supabase
      .from('profiles').select('id, full_name, email')
      .or(`full_name.ilike.%${term}%,email.ilike.%${term}%`).limit(1);
    if (profs && profs.length) return { id: profs[0].id as string, label: (profs[0].full_name || profs[0].email || term) as string };
    const { data: creators } = await supabase
      .from('creators').select('id, handle, display_name')
      .or(`handle.ilike.%${term}%,display_name.ilike.%${term}%`).limit(1);
    if (creators && creators.length) return { id: creators[0].id as string, label: (creators[0].display_name || creators[0].handle || term) as string };
    return null;
  }

  async function productsByIds(ids: string[]): Promise<PreviewItem[]> {
    if (!supabase || ids.length === 0) return [];
    const { data } = await supabase
      .from('products').select('id, name, brand, feed_rank, primary_video_poster_url, primary_image_url, image_url')
      .in('id', ids.slice(0, 80));
    const byId = new Map((data ?? []).map((p: Record<string, unknown>) => [p.id as string, p]));
    return ids.map(id => byId.get(id)).filter(Boolean).map((p) => {
      const r = p as Record<string, unknown>;
      return {
        kind: 'product' as const,
        id: r.id as string,
        title: (r.name as string) || 'Product',
        sub: (r.brand as string) || '',
        image: (r.primary_video_poster_url || r.primary_image_url || r.image_url || '') as string,
        feedRank: typeof r.feed_rank === 'number' ? (r.feed_rank as number) : null,
      };
    });
  }

  function mapLookRow(r: Record<string, unknown>): PreviewItem {
    const creatives = (r.looks_creative ?? []) as { thumbnail_url: string | null; is_primary: boolean | null }[];
    const primary = creatives.find(c => c.is_primary) ?? creatives[0];
    return {
      kind: 'look',
      id: r.id as string,
      title: (r.creator_handle as string) || 'Look',
      sub: 'Look',
      image: (primary?.thumbnail_url || '') as string,
      feedRank: typeof r.feed_rank === 'number' ? (r.feed_rank as number) : null,
    };
  }

  async function looksByIds(ids: string[]): Promise<PreviewItem[]> {
    if (!supabase || ids.length === 0) return [];
    const { data } = await supabase
      .from('looks').select('id, feed_rank, creator_handle, looks_creative ( thumbnail_url, is_primary )')
      .in('id', ids.slice(0, 60));
    const byId = new Map((data ?? []).map((l: Record<string, unknown>) => [l.id as string, l]));
    return ids.map(id => byId.get(id)).filter(Boolean).map(l => mapLookRow(l as Record<string, unknown>));
  }

  // The live look set (feed_rank order) — what a cold-start shopper sees, and
  // the fallback when a stored row predates per-shopper look ranking.
  async function liveLooks(): Promise<PreviewItem[]> {
    if (!supabase) return [];
    const { data } = await supabase
      .from('looks').select('id, feed_rank, creator_handle, looks_creative ( thumbnail_url, is_primary )')
      .eq('status', 'live')
      .order('feed_rank', { ascending: true, nullsFirst: false })
      .limit(40);
    return ((data ?? []) as Record<string, unknown>[]).map(mapLookRow);
  }

  async function cohort(gender: 'all' | 'men' | 'women'): Promise<PreviewItem[]> {
    if (!supabase) return [];
    const { data } = await supabase
      .from('products').select('id, name, brand, gender, feed_rank, primary_video_poster_url, primary_image_url, image_url')
      .eq('is_active', true).not('primary_video_url', 'is', null)
      .order('feed_rank', { ascending: true, nullsFirst: false }).limit(60);
    let rows = (data ?? []) as Record<string, unknown>[];
    if (gender !== 'all') rows = rows.filter(p => !p.gender || p.gender === gender || p.gender === 'unisex');
    return rows.map(r => ({
      kind: 'product' as const,
      id: r.id as string,
      title: (r.name as string) || 'Product',
      sub: (r.brand as string) || '',
      image: (r.primary_video_poster_url || r.primary_image_url || r.image_url || '') as string,
      feedRank: typeof r.feed_rank === 'number' ? (r.feed_rank as number) : null,
    }));
  }

  const run = async () => {
    if (!supabase) { setErr('Supabase not configured.'); return; }
    setLoading(true); setErr(null); setItems([]); setWho(null); setVariant(null); setReason(null); setSuggestions([]);
    try {
      if (mode === 'user') {
        const u = pickedUser.current?.label === username.trim()
          ? pickedUser.current
          : await resolveUser(username);
        if (!u) { setErr(`No user found matching “${username}”.`); setLoading(false); return; }
        setWho(u.label);
        const isPast = !!feedDate && feedDate < todayUtc();
        let ranked: { type?: string; id: string }[];
        if (isPast) {
          const { data, error } = await supabase
            .from('personalized_feeds')
            .select('ranked_items, variant, model, reason')
            .eq('user_id', u.id).eq('feed_date', feedDate).maybeSingle();
          if (error) throw error;
          if (!data) {
            setErr(`No stored Daily Feed for ${u.label} on ${feedDate} (they may not have opened the app that day).`);
            setLoading(false); return;
          }
          const row = data as { ranked_items?: { type?: string; id: string }[]; variant?: string; model?: string; reason?: FeedReason | null };
          setVariant(`${row.variant ?? 'feed'}${row.model ? ` · ${row.model}` : ''}`);
          setReason(row.reason ?? null);
          ranked = row.ranked_items ?? [];
        } else {
          const { data, error } = await supabase.functions.invoke('personalize-feed', { body: { target_user_id: u.id } });
          if (error) throw error;
          const resp = data as { enabled?: boolean; variant?: string; reason?: FeedReason | null; ranked_items?: { type?: string; id: string }[] };
          setVariant(resp.enabled === false ? 'auto-editor disabled' : `${resp.variant ?? 'live'} · live`);
          setReason(resp.reason ?? null);
          ranked = resp.ranked_items ?? [];
        }
        const productIds = ranked.filter(r => !r.type || r.type === 'product').map(r => r.id);
        const lookIds = ranked.filter(r => r.type === 'look').map(r => r.id);
        const products = productIds.length ? await productsByIds(productIds) : await cohort('all');
        // Personalized looks if the engine ranked them; else fall back to the
        // live look set so the preview still shows the woven-in looks.
        const looks = lookIds.length ? await looksByIds(lookIds) : await liveLooks();
        setItems(weave(products, looks));
      } else {
        setWho(mode === 'all' ? 'All users' : mode === 'men' ? 'All men' : 'All women');
        setVariant('global feed');
        const [products, looks] = await Promise.all([cohort(mode), liveLooks()]);
        setItems(weave(products, looks));
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load feed.');
    } finally {
      setLoading(false);
    }
  };

  const lookCount = items.filter(i => i.kind === 'look').length;

  return (
    <div style={{ background: '#fff', border: '1px solid #eee', borderRadius: 14, overflow: 'hidden' }}>
      <div style={{ padding: '16px 18px', borderBottom: '1px solid #eee' }}>
        <h2 style={{ margin: '0 0 2px', fontSize: 17, fontWeight: 700, color: '#111' }}>Preview a shopper&apos;s feed</h2>
        <p style={{ margin: 0, fontSize: 12.5, color: '#777' }}>
          See any shopper&apos;s live feed, the feed they were served on a past day, or a cohort baseline.
          Looks and products are woven together exactly like the shopper&apos;s feed.
        </p>
      </div>

      <div style={{ padding: '14px 18px' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
          {MODES.map(m => (
            <button
              key={m.id}
              onClick={() => { setMode(m.id); setItems([]); setWho(null); setVariant(null); setErr(null); }}
              style={{
                padding: '6px 12px', borderRadius: 999, fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
                border: '1px solid', borderColor: mode === m.id ? '#111' : '#e5e7eb',
                background: mode === m.id ? '#111' : '#fff', color: mode === m.id ? '#fff' : '#444',
              }}
            >{m.label}</button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
          {mode === 'user' && (
            <div style={{ flex: 1, minWidth: 220, position: 'relative' }}>
              <input
                value={username}
                onChange={e => { pickedUser.current = null; setUsername(e.target.value); }}
                onKeyDown={e => { if (e.key === 'Enter') { setSuggestions([]); run(); } }}
                placeholder="Type a user — name or email…"
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', borderRadius: 8, border: '1px solid #ddd', fontSize: 13, fontFamily: 'inherit' }}
              />
              {suggestions.length > 0 && (
                <div style={{
                  position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 5, marginTop: 4,
                  background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10,
                  boxShadow: '0 12px 32px rgba(0,0,0,0.14)', overflow: 'hidden',
                }}>
                  {suggestions.map(s => (
                    <button
                      key={s.id}
                      onClick={() => {
                        pickedUser.current = { id: s.id, label: s.label };
                        setUsername(s.label);
                        setSuggestions([]);
                      }}
                      style={{
                        display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px',
                        background: '#fff', border: 'none', borderBottom: '1px solid #f4f4f5',
                        fontSize: 13, cursor: 'pointer',
                      }}
                    >
                      <span style={{ fontWeight: 600, color: '#111' }}>{s.label}</span>
                      {s.sub && s.sub !== s.label && <span style={{ marginLeft: 8, fontSize: 11.5, color: '#999' }}>{s.sub}</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {mode === 'user' && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#666' }}>
              <span style={{ whiteSpace: 'nowrap' }}>Date</span>
              <input
                type="date"
                value={feedDate}
                max={todayUtc()}
                onChange={e => setFeedDate(e.target.value)}
                title="Leave as today for the live feed; pick a past day to see the feed they were served then"
                style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid #ddd', fontSize: 13, fontFamily: 'inherit' }}
              />
              {feedDate && (
                <button
                  onClick={() => setFeedDate('')}
                  title="Back to today (live)"
                  style={{ background: 'transparent', border: 'none', color: '#999', fontSize: 16, cursor: 'pointer', lineHeight: 1 }}
                >×</button>
              )}
            </label>
          )}
          <button
            className="admin-btn admin-btn-primary"
            onClick={run}
            disabled={loading || (mode === 'user' && !username.trim())}
            style={{ whiteSpace: 'nowrap' }}
          >{loading ? 'Loading…' : (mode === 'user' && feedDate && feedDate < todayUtc()) ? 'View that day' : 'Preview feed'}</button>
        </div>

        {err && <div style={{ background: '#fef2f2', color: '#b91c1c', borderRadius: 8, padding: '10px 12px', fontSize: 13, marginBottom: 12 }}>{err}</div>}

        {who && !err && (
          <div style={{ fontSize: 12.5, color: '#555', marginBottom: 10 }}>
            Showing <strong style={{ color: '#111' }}>{who}</strong>
            {mode === 'user' && feedDate && feedDate < todayUtc() && (
              <span style={{ marginLeft: 6, color: '#999' }}>on {feedDate}</span>
            )}
            {variant && <span style={{ marginLeft: 6, padding: '2px 8px', borderRadius: 999, background: '#eef2ff', color: '#4338ca', fontSize: 11, fontWeight: 600 }}>{variant}</span>}
            <span style={{ marginLeft: 6, color: '#999' }}>· {items.length} items · {lookCount} looks</span>
            {reason && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 8 }}>
                {(reason.topBrands ?? []).slice(0, 4).map(b => (
                  <span key={`b-${b}`} style={{ padding: '2px 8px', borderRadius: 999, background: '#fef3c7', color: '#92400e', fontSize: 10.5, fontWeight: 600 }}>♥ {b}</span>
                ))}
                {(reason.topTypes ?? []).slice(0, 4).map(ty => (
                  <span key={`t-${ty}`} style={{ padding: '2px 8px', borderRadius: 999, background: '#dcfce7', color: '#166534', fontSize: 10.5, fontWeight: 600 }}>{ty}</span>
                ))}
                {(reason.rules ?? []).map(r => (
                  <span key={`r-${r}`} style={{ padding: '2px 8px', borderRadius: 999, background: '#f1f5f9', color: '#475569', fontSize: 10.5, fontWeight: 600 }}>rule: {r}</span>
                ))}
                {typeof reason.engaged === 'number' && (
                  <span style={{ padding: '2px 8px', borderRadius: 999, background: '#f1f5f9', color: '#475569', fontSize: 10.5, fontWeight: 600 }}>{reason.engaged} engaged · {reason.seen ?? 0} seen</span>
                )}
              </div>
            )}
          </div>
        )}

        {items.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 10, maxHeight: '60vh', overflow: 'auto' }}>
            {items.map((p, i) => (
              <div key={`${p.kind}-${p.id}-${i}`} style={{ border: p.kind === 'look' ? '1px solid #c7d2fe' : '1px solid #f0f0f0', borderRadius: 10, overflow: 'hidden', background: '#fafafa' }}>
                <div style={{ position: 'relative', aspectRatio: '3 / 4', background: p.image ? `center/cover no-repeat url(${p.image})` : '#e9e9ee' }}>
                  <span style={{ position: 'absolute', top: 4, left: 4, background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: 10, fontWeight: 700, borderRadius: 6, padding: '1px 6px' }}>{i + 1}</span>
                  <span style={{
                    position: 'absolute', top: 4, right: 4, fontSize: 9, fontWeight: 800, letterSpacing: '0.4px',
                    borderRadius: 5, padding: '1px 5px', color: '#fff',
                    background: p.kind === 'look' ? 'rgba(79,70,229,0.92)' : 'rgba(0,0,0,0.55)',
                  }}>{p.kind === 'look' ? 'LOOK' : 'PRODUCT'}</span>
                </div>
                <div style={{ padding: '6px 8px' }}>
                  {p.sub && <div style={{ fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: '0.3px', fontWeight: 700 }}>{p.sub}</div>}
                  <div style={{ fontSize: 12, color: '#222', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.title}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
