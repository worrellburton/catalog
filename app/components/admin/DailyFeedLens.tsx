// Daily-feed lens — the per-user view of the home catalog (founder's
// design: the daily feed dropdown leads with a USER, because no two
// shoppers see the same order).
//
// Type a user → the feed renders AS THEM (live compute via the
// personalize-feed edge function; previews skip the daily cache AND the
// Claude re-rank so the pinned rule dials respond in ~a second). Movement
// badges show how far each item moved vs the baseline (cold-start) order.
// Until a user is typed, NO feed renders — there is no "the" feed, only
// each shopper's. Inspect-only by design: editing happens at the rules
// level so changes scale to every shopper.

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '~/utils/supabase';
import {
  getFeedRules, setFeedRules,
  DEFAULT_FEED_RULES, FEED_RULE_META,
  type FeedRules,
} from '~/services/dials';

interface LensItem {
  id: string;
  name: string;
  brand: string;
  image: string;
  /** Baseline rank − user rank: positive = personalization moved it UP. */
  movement: number | null;
  fresh: boolean;
}

interface FeedReason {
  topBrands?: string[];
  topTypes?: string[];
  engaged?: number;
  seen?: number;
  rules?: string[];
}

interface Props {
  showToast: (msg: string) => void;
}

export default function DailyFeedLens({ showToast }: Props) {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<{ id: string; label: string; sub: string }[]>([]);
  const [active, setActive] = useState<{ id: string; label: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<LensItem[]>([]);
  const [variant, setVariant] = useState<string | null>(null);
  const [reason, setReason] = useState<FeedReason | null>(null);
  const [rules, setRules] = useState<FeedRules>(DEFAULT_FEED_RULES);
  const searchTimer = useRef(0);
  const ruleTimer = useRef(0);

  useEffect(() => { void getFeedRules().then(setRules); }, []);

  // Live typeahead over profiles.
  useEffect(() => {
    const term = query.replace(/[%,()*\\]/g, '').trim();
    if (!term || !supabase) { setSuggestions([]); return; }
    window.clearTimeout(searchTimer.current);
    searchTimer.current = window.setTimeout(async () => {
      const { data } = await supabase!
        .from('profiles').select('id, full_name, email')
        .or(`full_name.ilike.%${term}%,email.ilike.%${term}%`).limit(6);
      setSuggestions(((data ?? []) as { id: string; full_name: string | null; email: string | null }[])
        .map(r => ({ id: r.id, label: r.full_name || r.email || r.id.slice(0, 8), sub: r.email || '' })));
    }, 220);
    return () => window.clearTimeout(searchTimer.current);
  }, [query]);

  const loadFeedFor = useCallback(async (user: { id: string; label: string }) => {
    if (!supabase) return;
    setLoading(true);
    setItems([]);
    try {
      // Baseline order for movement badges — same query a cold-start
      // shopper's feed is built from.
      const { data: baseRows } = await supabase
        .from('products').select('id')
        .eq('is_active', true).not('primary_video_url', 'is', null)
        .order('feed_rank', { ascending: true, nullsFirst: false }).limit(160);
      const baseIdx = new Map((baseRows ?? []).map((r: { id: string }, i: number) => [r.id, i]));

      const { data, error } = await supabase.functions.invoke('personalize-feed', {
        body: { target_user_id: user.id },
      });
      if (error) throw error;
      const resp = data as { enabled?: boolean; variant?: string; reason?: FeedReason | null; ranked_items?: { id: string }[] };
      setVariant(resp.enabled === false ? 'auto-editor disabled' : (resp.variant ?? null));
      setReason(resp.reason ?? null);
      const ids = (resp.ranked_items ?? []).map(r => r.id).slice(0, 60);
      if (ids.length === 0) {
        // Holdout / cold start — show the baseline order, labeled as such.
        const fallback = [...baseIdx.keys()].slice(0, 60);
        setItems(await resolveProducts(fallback, baseIdx, resp.reason ?? null));
      } else {
        setItems(await resolveProducts(ids, baseIdx, resp.reason ?? null));
      }
    } catch (err) {
      showToast(`Feed lens failed: ${err instanceof Error ? err.message : 'error'}`);
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  async function resolveProducts(
    ids: string[],
    baseIdx: Map<string, number>,
    _reason: FeedReason | null,
  ): Promise<LensItem[]> {
    if (!supabase || ids.length === 0) return [];
    const { data } = await supabase
      .from('products')
      .select('id, name, brand, primary_video_poster_url, primary_image_url, image_url')
      .in('id', ids);
    const byId = new Map((data ?? []).map((p: Record<string, unknown>) => [p.id as string, p]));
    return ids.map((id, i) => {
      const p = byId.get(id) as Record<string, string | null> | undefined;
      if (!p) return null;
      const base = baseIdx.get(id);
      return {
        id,
        name: p.name || 'Product',
        brand: p.brand || '',
        image: p.primary_video_poster_url || p.primary_image_url || p.image_url || '',
        movement: base === undefined ? null : base - i,
        fresh: false,
      };
    }).filter((x): x is LensItem => x !== null);
  }

  const pick = (u: { id: string; label: string }) => {
    setActive(u);
    setQuery('');
    setSuggestions([]);
    void loadFeedFor(u);
  };

  // Pinned rule dials: toggling persists (debounced) and re-runs the
  // active lens — previews bypass the daily cache, so the change is live.
  const toggleRule = (key: keyof FeedRules) => {
    const next = { ...rules, [key]: { ...rules[key], enabled: !rules[key].enabled } };
    setRules(next);
    window.clearTimeout(ruleTimer.current);
    ruleTimer.current = window.setTimeout(() => {
      setFeedRules(next)
        .then(() => { if (active) void loadFeedFor(active); })
        .catch(err => showToast(`Rule save failed: ${err instanceof Error ? err.message : 'error'}`));
    }, 400);
  };

  return (
    <div style={{ padding: '14px 16px', borderBottom: '1px solid #f1e8c8', background: '#fffdf4' }}>
      {/* User search + active chip */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: '0 1 340px' }}>
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="View this feed as a user — type a name or email…"
            style={{
              width: '100%', boxSizing: 'border-box', padding: '9px 12px', borderRadius: 8,
              border: '1px solid #e5d9a8', fontSize: 13, fontFamily: 'inherit', background: '#fff',
            }}
          />
          {suggestions.length > 0 && (
            <div style={{
              position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 40, marginTop: 4,
              background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10,
              boxShadow: '0 12px 32px rgba(0,0,0,0.14)', overflow: 'hidden',
            }}>
              {suggestions.map(s => (
                <button key={s.id} type="button" onClick={() => pick(s)}
                  style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px', background: '#fff', border: 'none', borderBottom: '1px solid #f4f4f5', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>
                  <span style={{ fontWeight: 600, color: '#111' }}>{s.label}</span>
                  {s.sub && s.sub !== s.label && <span style={{ marginLeft: 8, fontSize: 11.5, color: '#999' }}>{s.sub}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
        {active && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '5px 6px 5px 12px', borderRadius: 999, background: '#111', color: '#fff', fontSize: 12.5, fontWeight: 600 }}>
            Viewing as {active.label}
            {variant && <em style={{ fontStyle: 'normal', fontSize: 10.5, opacity: 0.7 }}>· {variant}</em>}
            <button type="button" aria-label="Back to baseline"
              onClick={() => { setActive(null); setItems([]); setReason(null); }}
              style={{ border: 'none', background: 'rgba(255,255,255,0.18)', color: '#fff', borderRadius: '50%', width: 18, height: 18, fontSize: 11, cursor: 'pointer', lineHeight: 1 }}>×</button>
          </span>
        )}
        {!active && (
          <span style={{ fontSize: 12, color: '#92741e' }}>
            There is no single feed — type a user to see the catalog through their eyes.
          </span>
        )}
      </div>

      {/* Pinned rule dials — flip one and the lens re-ranks live */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
        {FEED_RULE_META.map(meta => {
          const on = rules[meta.key].enabled;
          return (
            <button
              key={meta.key}
              type="button"
              title={meta.hint}
              onClick={() => toggleRule(meta.key)}
              style={{
                padding: '4px 10px', borderRadius: 999, fontSize: 11, fontWeight: 600,
                cursor: 'pointer', fontFamily: 'inherit',
                border: `1px solid ${on ? '#16a34a' : '#e5e7eb'}`,
                background: on ? '#f0fdf4' : '#fff',
                color: on ? '#15803d' : '#9ca3af',
              }}
            >{on ? '●' : '○'} {meta.label}</button>
          );
        })}
      </div>

      {/* Reason chips for the active user */}
      {active && reason && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 10 }}>
          {(reason.topBrands ?? []).slice(0, 4).map(b => (
            <span key={`b-${b}`} style={{ padding: '2px 8px', borderRadius: 999, background: '#fef3c7', color: '#92400e', fontSize: 10.5, fontWeight: 600 }}>♥ {b}</span>
          ))}
          {(reason.topTypes ?? []).slice(0, 4).map(ty => (
            <span key={`t-${ty}`} style={{ padding: '2px 8px', borderRadius: 999, background: '#dcfce7', color: '#166534', fontSize: 10.5, fontWeight: 600 }}>{ty}</span>
          ))}
          {typeof reason.engaged === 'number' && (
            <span style={{ padding: '2px 8px', borderRadius: 999, background: '#f1f5f9', color: '#475569', fontSize: 10.5, fontWeight: 600 }}>{reason.engaged} engaged · {reason.seen ?? 0} seen</span>
          )}
        </div>
      )}

      {/* The user's ranked feed (inspect-only) */}
      {active && (
        loading ? (
          <p style={{ margin: '14px 0 4px', fontSize: 12.5, color: '#92741e' }}>Computing {active.label}&apos;s feed…</p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(118px, 1fr))', gap: 10, marginTop: 14 }}>
            {items.map((it, i) => (
              <div key={it.id} style={{ border: '1px solid #f0f0f0', borderRadius: 10, overflow: 'hidden', background: '#fff' }}>
                <div style={{ position: 'relative', aspectRatio: '3 / 4', background: it.image ? `center/cover no-repeat url(${it.image})` : '#e9e9ee' }}>
                  <span style={{ position: 'absolute', top: 4, left: 4, background: 'rgba(0,0,0,0.65)', color: '#fff', fontSize: 10, fontWeight: 700, borderRadius: 6, padding: '1px 6px' }}>{i + 1}</span>
                  {it.movement !== null && it.movement !== 0 && (
                    <span style={{
                      position: 'absolute', top: 4, right: 4, fontSize: 10, fontWeight: 800,
                      borderRadius: 6, padding: '1px 6px',
                      background: it.movement > 0 ? 'rgba(22,163,74,0.92)' : 'rgba(220,38,38,0.88)',
                      color: '#fff',
                    }}>{it.movement > 0 ? `▲${it.movement}` : `▼${-it.movement}`}</span>
                  )}
                </div>
                <div style={{ padding: '5px 8px 7px' }}>
                  {it.brand && <div style={{ fontSize: 9.5, color: '#888', textTransform: 'uppercase', letterSpacing: '0.3px', fontWeight: 700 }}>{it.brand}</div>}
                  <div style={{ fontSize: 11.5, color: '#222', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.name}</div>
                </div>
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
}
