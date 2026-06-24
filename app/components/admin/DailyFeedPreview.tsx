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
import { weaveByFeedRank } from '~/utils/feed-weave';
import { ErrorState } from '~/components/ui/StateViews';

type Mode = 'user' | 'all' | 'men' | 'women';

interface PreviewItem {
  kind: 'product' | 'look';
  id: string;
  title: string;
  sub: string;
  image: string;
  feedRank: number | null;
  // Per-item data surfaced in the hover info panel (admin debugging).
  gender?: string | null;
  productType?: string | null;
  price?: string | null;
  conversionScore?: number | null;
  isElite?: boolean | null;
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

// Cohort baselines have no per-shopper order, so they weave by feed_rank — the
// shared weaveByFeedRank, identical to what a cold-start shopper sees.
function weave(products: PreviewItem[], looks: PreviewItem[]): PreviewItem[] {
  return weaveByFeedRank(looks, products, i => i.feedRank, i => i.kind === 'look');
}

// A real shopper's feed is the ENGINE's per-day ranked order, NOT the static
// feed_rank — that's the whole point of the Daily Feed (it re-ranks + shuffles
// + deranges daily). The preview must preserve that order or it looks identical
// every day (the "day to day it hasn't changed" bug). `products` and `looks`
// already arrive in the engine's order (productsByIds/looksByIds preserve the
// id order), so here we just weave them looks-leading at a steady cadence,
// keeping each lane's engine order intact.
function weaveEngineOrder(products: PreviewItem[], looks: PreviewItem[]): PreviewItem[] {
  if (looks.length === 0) return products;
  if (products.length === 0) return looks;
  const out: PreviewItem[] = [looks[0]];
  let li = 1, pi = 0;
  while (pi < products.length || li < looks.length) {
    for (let k = 0; k < 4 && pi < products.length; k++) out.push(products[pi++]);
    if (li < looks.length) out.push(looks[li++]);
  }
  return out;
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
  // Defaults to today (the live feed). A past date reads the stored row; today
  // (== now) still resolves to the live compute since isPast is feedDate<today.
  const [feedDate, setFeedDate] = useState(todayUtc());
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [who, setWho] = useState<string | null>(null);
  const [variant, setVariant] = useState<string | null>(null);
  const [items, setItems] = useState<PreviewItem[]>([]);
  const [reason, setReason] = useState<FeedReason | null>(null);
  const [suggestions, setSuggestions] = useState<{ id: string; label: string; sub: string }[]>([]);
  const pickedUser = useRef<{ id: string; label: string } | null>(null);
  const searchTimer = useRef(0);
  // Index of the tile whose hover info panel is open (admin debugging).
  const [infoIdx, setInfoIdx] = useState<number | null>(null);

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
      .from('products').select('id, name, brand, type, gender, price, conversion_score, is_elite, feed_rank, primary_video_poster_url, primary_image_url, image_url')
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
        gender: (r.gender as string) ?? null,
        productType: (r.type as string) ?? null,
        price: (r.price as string) ?? null,
        conversionScore: typeof r.conversion_score === 'number' ? (r.conversion_score as number) : null,
        isElite: (r.is_elite as boolean) ?? null,
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
      gender: (r.gender as string) ?? null,
    };
  }

  async function looksByIds(ids: string[]): Promise<PreviewItem[]> {
    if (!supabase || ids.length === 0) return [];
    const { data } = await supabase
      .from('looks').select('id, feed_rank, gender, creator_handle, looks_creative ( thumbnail_url, is_primary )')
      .in('id', ids.slice(0, 60));
    const byId = new Map((data ?? []).map((l: Record<string, unknown>) => [l.id as string, l]));
    return ids.map(id => byId.get(id)).filter(Boolean).map(l => mapLookRow(l as Record<string, unknown>));
  }

  // The live look set (feed_rank order) — what a cold-start shopper sees, and
  // the fallback when a stored row predates per-shopper look ranking.
  async function liveLooks(): Promise<PreviewItem[]> {
    if (!supabase) return [];
    const { data } = await supabase
      .from('looks').select('id, feed_rank, gender, creator_handle, looks_creative ( thumbnail_url, is_primary )')
      .eq('status', 'live')
      .order('feed_rank', { ascending: true, nullsFirst: false })
      .limit(40);
    return ((data ?? []) as Record<string, unknown>[]).map(mapLookRow);
  }

  async function cohort(gender: 'all' | 'men' | 'women'): Promise<PreviewItem[]> {
    if (!supabase) return [];
    const { data } = await supabase
      .from('products').select('id, name, brand, type, gender, price, conversion_score, is_elite, feed_rank, primary_video_poster_url, primary_image_url, image_url')
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
      gender: (r.gender as string) ?? null,
      productType: (r.type as string) ?? null,
      price: (r.price as string) ?? null,
      conversionScore: typeof r.conversion_score === 'number' ? (r.conversion_score as number) : null,
      isElite: (r.is_elite as boolean) ?? null,
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
        // Preserve the engine's per-day order so the preview changes day to day
        // (matches the shopper). Only fall back to feed_rank weave when the
        // engine returned no personalized ids (cold start / disabled).
        const hasEngineOrder = productIds.length > 0 || lookIds.length > 0;
        setItems(hasEngineOrder ? weaveEngineOrder(products, looks) : weave(products, looks));
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
    // overflow:visible (not hidden) so the user-search autocomplete dropdown
    // isn't clipped by the card edge; the header rounds its own top corners.
    <div style={{ background: '#fff', border: '1px solid #eee', borderRadius: 14, overflow: 'visible' }}>
      <div style={{ padding: '16px 18px', borderBottom: '1px solid #eee', borderRadius: '14px 14px 0 0' }}>
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

        {/* What the selected mode actually previews — the cohort tabs are a
            BASELINE (the global, non-personalized feed a cold-start shopper
            sees), not a per-shopper feed. */}
        <div style={{ fontSize: 12, color: '#777', margin: '-4px 0 12px', lineHeight: 1.45 }}>
          {mode === 'user'
            ? 'A real shopper’s own Daily Feed — personalized to their taste (today’s live feed, or a past day exactly as served).'
            : mode === 'men'
              ? 'Cohort baseline — the global feed a brand-new / cold-start shopper sees (no personalization yet), filtered to men’s + unisex.'
              : mode === 'women'
                ? 'Cohort baseline — the global feed a brand-new / cold-start shopper sees (no personalization yet), filtered to women’s + unisex.'
                : 'Cohort baseline — the global feed a brand-new / cold-start shopper sees (no personalization yet), across all genders.'}
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
                  position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50, marginTop: 4,
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
              {feedDate && feedDate < todayUtc() && (
                <button
                  onClick={() => setFeedDate(todayUtc())}
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

        {err && <ErrorState light body={err} onRetry={run} retryLabel="Retry" />}

        {who && !err && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 10 }}>
            <div style={{ fontSize: 12.5, color: '#555' }}>
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
            {/* Collapse the previewed feed back down (keeps the user/date inputs
                so you can re-run without retyping). */}
            <button
              type="button"
              onClick={() => { setItems([]); setWho(null); setVariant(null); setReason(null); }}
              title="Collapse this preview"
              style={{
                flexShrink: 0, padding: '5px 12px', borderRadius: 999, cursor: 'pointer',
                border: '1px solid #e5e7eb', background: '#fff', color: '#444',
                fontSize: 12, fontWeight: 600,
              }}
            >Collapse ↑</button>
          </div>
        )}

        {items.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 10, maxHeight: '60vh', overflow: 'auto' }}>
            {items.map((p, i) => {
              const dataRows: [string, string][] = [
                ['Position', `#${i + 1}`],
                ['Type', p.kind === 'look' ? 'Look' : 'Product'],
                [p.kind === 'look' ? 'Creator' : 'Brand', p.sub || '—'],
                ['Name', p.title || '—'],
                ['feed_rank', p.feedRank == null ? 'unranked' : String(p.feedRank)],
                ['Gender', p.gender || '—'],
                ...(p.kind === 'product' ? ([
                  ['Category', p.productType || '—'],
                  ['Price', p.price || '—'],
                  ['Conversion', p.conversionScore == null ? '—' : p.conversionScore.toFixed(2)],
                  ['Elite', p.isElite ? 'yes' : 'no'],
                ] as [string, string][]) : []),
                ['ID', p.id.slice(0, 8) + '…'],
              ];
              return (
              <div key={`${p.kind}-${p.id}-${i}`} style={{ border: p.kind === 'look' ? '1px solid #c7d2fe' : '1px solid #f0f0f0', borderRadius: 10, overflow: 'hidden', background: '#fafafa' }}>
                <div style={{ position: 'relative', aspectRatio: '3 / 4', background: p.image ? `center/cover no-repeat url(${p.image})` : '#e9e9ee' }}>
                  <span style={{ position: 'absolute', top: 4, left: 4, background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: 10, fontWeight: 700, borderRadius: 6, padding: '1px 6px' }}>{i + 1}</span>
                  <span style={{
                    position: 'absolute', top: 4, right: 4, fontSize: 9, fontWeight: 800, letterSpacing: '0.4px',
                    borderRadius: 5, padding: '1px 5px', color: '#fff',
                    background: p.kind === 'look' ? 'rgba(79,70,229,0.92)' : 'rgba(0,0,0,0.55)',
                  }}>{p.kind === 'look' ? 'LOOK' : 'PRODUCT'}</span>
                  {/* Info icon — hover to reveal the per-item data panel. */}
                  <button
                    type="button"
                    aria-label="Show item data"
                    onMouseEnter={() => setInfoIdx(i)}
                    onMouseLeave={() => setInfoIdx(prev => (prev === i ? null : prev))}
                    onClick={() => setInfoIdx(prev => (prev === i ? null : i))}
                    style={{
                      position: 'absolute', bottom: 6, right: 6, width: 22, height: 22, borderRadius: '50%',
                      border: 'none', cursor: 'pointer', color: '#fff', fontSize: 12, fontWeight: 700,
                      fontStyle: 'italic', fontFamily: 'Georgia, serif', lineHeight: 1,
                      background: infoIdx === i ? 'rgba(17,17,17,0.92)' : 'rgba(0,0,0,0.55)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}
                  >i</button>
                  {infoIdx === i && (
                    <div
                      style={{
                        position: 'absolute', inset: 0, background: 'rgba(10,10,12,0.92)',
                        color: '#fff', padding: '10px 11px', overflowY: 'auto', fontSize: 11, lineHeight: 1.5,
                      }}
                    >
                      {dataRows.map(([k, v]) => (
                        <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 3 }}>
                          <span style={{ color: 'rgba(255,255,255,0.5)', flexShrink: 0 }}>{k}</span>
                          <span style={{ color: '#fff', fontWeight: 600, textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div style={{ padding: '6px 8px' }}>
                  {p.sub && <div style={{ fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: '0.3px', fontWeight: 700 }}>{p.sub}</div>}
                  <div style={{ fontSize: 12, color: '#222', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.title}</div>
                </div>
              </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
