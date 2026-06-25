// personalize-feed — Automatic Editor.
//
// Builds (and caches for the day) one ranked feed per signed-in shopper.
// Hybrid: a cheap deterministic candidate score from the shopper's recent
// user_events (engaged brands/types, with already-seen items down-ranked),
// then Claude re-ranks the top slice into the final order. Cold-start and a
// holdout slice fall back to the global feed (recorded for measurement).
//
// Invoked by the consumer client on the first visit of the day
// (services/personalized-feed.ts). Idempotent per (user_id, feed_date):
// a second call the same day returns the stored row.
//
// Config (app_settings dials, see migration 20260607000000):
//   auto_editor_enabled       'true' | 'false'
//   auto_editor_holdout_pct   0..100
//   auto_editor_recency_days  history lookback window
//   auto_editor_min_signal    min user_events before personalizing
//   feed_rules                JSON rulebook (services/dials.ts FeedRules) —
//                             ten founder-tunable ranking rules, all signals
//                             normalized 0..1 then scaled by weight 0..10
//
// Optional secret (falls back to the deterministic order when absent):
//   ANTHROPIC_API_KEY

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const MODEL = 'claude-opus-4-8';
const CANDIDATE_POOL = 160;   // active products pulled as the candidate set
const CLAUDE_TOP_N = 60;      // top deterministic candidates sent to Claude
const EVENT_LOOKBACK_CAP = 5000;

const EVENT_WEIGHT: Record<string, number> = { clickout: 5, click: 3, impression: 1 };

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, apikey, x-client-info',
  'Access-Control-Max-Age': '86400',
};

function jsonRes(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

// Deterministic 0..99 bucket from the user id — stable across days so a
// shopper stays in (or out of) the holdout group for clean measurement.
function holdoutBucket(userId: string): number {
  let h = 2166136261;
  for (let i = 0; i < userId.length; i++) {
    h ^= userId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % 100;
}

// The "editor day" — the feed rolls over to a new day at refreshHour:00 UTC
// (admin-configurable). Shifting now back by refreshHour hours and taking the
// UTC date means before that hour we stay on yesterday's feed, after it a new
// one is computed. refreshHour=0 ⇒ midnight-UTC rollover (the default).
// `epoch` is the manual "advance the daily feed" counter (app_settings
// auto_editor_epoch): it shifts the day FORWARD by `epoch` days on top of the
// natural rollover, so an admin bump force-advances every shopper to their next
// feed (new feed_date key ⇒ fresh recompute, new rotation offset ⇒ new order).
function editorDay(refreshHour: number, epoch = 0): string {
  return new Date(Date.now() - refreshHour * 3_600_000 + epoch * 86_400_000).toISOString().slice(0, 10); // YYYY-MM-DD
}

interface ProductRow {
  id: string;
  name: string | null;
  brand: string | null;
  type: string | null;
  price: string | null;
  gender: string | null;
  feed_rank: number | null;
  is_elite: boolean | null;
  conversion_score: number | null;
  primary_video_generated_at: string | null;
}

interface FeedRule { enabled: boolean; weight: number }
type FeedRules = Record<
  'convertingBoost' | 'clickedProducts' | 'engagedBrands' | 'engagedTypes' | 'savedBrands'
  | 'freshnessBoost' | 'seenDecay' | 'diversityGuard' | 'genderStrict' | 'trendingBoost'
  | 'freshSlots' | 'dailyShuffle',
  FeedRule
>;

// Mirrors DEFAULT_FEED_RULES in app/services/dials.ts — defaults reproduce
// the pre-rules behavior (brand/type affinity + seen penalty only).
const DEFAULT_RULES: FeedRules = {
  convertingBoost: { enabled: false, weight: 5 },
  clickedProducts: { enabled: false, weight: 3 },
  engagedBrands:   { enabled: true,  weight: 5 },
  engagedTypes:    { enabled: true,  weight: 5 },
  savedBrands:     { enabled: false, weight: 4 },  // client-side rule — ignored here
  freshnessBoost:  { enabled: false, weight: 3 },
  seenDecay:       { enabled: true,  weight: 5 },
  diversityGuard:  { enabled: false, weight: 3 },
  genderStrict:    { enabled: true,  weight: 0 },
  trendingBoost:   { enabled: false, weight: 4 },
  // Fresh-slot quota: weight = how many of the TOP 20 slots are reserved
  // for items this shopper has never been shown. THE "new feed every
  // morning" mechanic — on by default (founder's call).
  freshSlots:      { enabled: true,  weight: 6 },
  // Daily shuffle: weight = how many of the TOP slots get re-ordered each day
  // (date+user seeded), so the VISIBLE head of the feed changes daily even for
  // a stable-taste shopper. On by default.
  dailyShuffle:    { enabled: true,  weight: 8 },
};

function parseRules(raw: string | undefined): FeedRules {
  const out: FeedRules = JSON.parse(JSON.stringify(DEFAULT_RULES));
  if (!raw) return out;
  try {
    const parsed = JSON.parse(raw) as Record<string, { enabled?: unknown; weight?: unknown }>;
    for (const key of Object.keys(out) as (keyof FeedRules)[]) {
      const r = parsed[key];
      if (r && typeof r === 'object') {
        if (typeof r.enabled === 'boolean') out[key].enabled = r.enabled;
        const w = Number(r.weight);
        if (Number.isFinite(w)) out[key].weight = Math.max(0, Math.min(10, w));
      }
    }
  } catch { /* malformed rulebook — defaults */ }
  return out;
}

function normMap(m: Map<string, number>): Map<string, number> {
  let max = 0;
  for (const v of m.values()) max = Math.max(max, v);
  if (max <= 0) return new Map();
  return new Map([...m.entries()].map(([k, v]) => [k, v / max]));
}

/** Cap how many items one brand can hold in the top 20 — excess demotes
 *  to just past the window, preserving relative order. */
function applyDiversityGuard(order: string[], brandById: Map<string, string | null>, cap: number): string[] {
  const top: string[] = [];
  const demoted: string[] = [];
  const perBrand = new Map<string, number>();
  for (const id of order) {
    if (top.length < 20) {
      const brand = brandById.get(id) || '';
      const n = brand ? (perBrand.get(brand) ?? 0) : 0;
      if (brand && n >= cap) { demoted.push(id); continue; }
      if (brand) perBrand.set(brand, n + 1);
      top.push(id);
    } else {
      top.push(id);
    }
  }
  // Demoted items re-enter right after the top window.
  return [...top.slice(0, 20), ...demoted, ...top.slice(20)];
}

function applyFreshSlots(order: string[], seen: Set<string>, k: number): string[] {
  if (k === 0 || order.length === 0) return order;
  const top = order.slice(0, 20);
  const unseenInTop = top.filter(id => !seen.has(id)).length;
  if (unseenInTop >= k) return order;
  const promoted = order.slice(20).filter(id => !seen.has(id)).slice(0, k - unseenInTop);
  if (promoted.length === 0) return order;
  const promotedSet = new Set(promoted);
  const rest = order.filter(id => !promotedSet.has(id));
  const out = [...rest];
  promoted.forEach((id, i) => out.splice(Math.min(1 + i * 3, out.length), 0, id));
  return out;
}

/** Re-order the top `window` items with a date+user-seeded shuffle so the
 *  VISIBLE head of the feed changes every day even when the shopper's taste
 *  (and therefore the ranking) is stable. Everything below `window` keeps its
 *  order. Deterministic per (feedDate, userId) — same shopper, same day, same
 *  result. window is 0..10 (the rule weight); 0/1 is a no-op. */
function applyDailyShuffle(order: string[], seedStr: string, window: number): string[] {
  const n = Math.min(window, order.length);
  if (n <= 1) return order;
  // FNV-1a → mulberry32: a tiny seeded PRNG (no deps in the edge runtime).
  let h = 2166136261;
  for (let i = 0; i < seedStr.length; i++) { h ^= seedStr.charCodeAt(i); h = Math.imul(h, 16777619); }
  let s = h >>> 0;
  const rand = () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const head = order.slice(0, n);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [head[i], head[j]] = [head[j], head[i]];
  }
  return [...head, ...order.slice(n)];
}

/** Day-to-day derangement: guarantee NO id holds the same index it held
 *  yesterday, so every drop visibly moves (founder's ask: "make sure no
 *  product is in the same place"). Single deterministic pass — wherever
 *  today[i] === prev[i], swap with the neighbour, which always breaks the
 *  collision (the neighbour is a different id, so it can't re-collide here).
 *  Items not present yesterday are left where the ranking put them. */
function derangeAgainstPrev(order: string[], prev: string[]): string[] {
  if (order.length < 2 || prev.length === 0) return order;
  const out = order.slice();
  for (let i = 0; i < out.length; i++) {
    if (i < prev.length && out[i] === prev[i]) {
      const j = i + 1 < out.length ? i + 1 : i - 1;
      [out[i], out[j]] = [out[j], out[i]];
    }
  }
  return out;
}

/** Hard rotation: cap how many of yesterday's top-12 may repeat in
 *  today's top-12 — excess repeats demote past the window so the drop
 *  always FEELS new (founder's call: at most half may carry over). */
function applyRotationGuard(order: string[], prevTop: Set<string>, maxRepeats: number, window: number): string[] {
  const head: string[] = [];
  const demoted: string[] = [];
  let repeats = 0;
  let i = 0;
  for (; i < order.length && head.length < window; i++) {
    const id = order[i];
    if (prevTop.has(id)) {
      if (repeats >= maxRepeats) { demoted.push(id); continue; }
      repeats++;
    }
    head.push(id);
  }
  return [...head, ...demoted, ...order.slice(i)];
}

/** Daily lead-rotation: cycle WHICH slice of the ranked pool leads, so a
 *  stable-taste shopper sees a genuinely different head each day — not the
 *  same top set merely re-shuffled. Rotates only within the top `pool`
 *  (quality preserved: every lead is still a high-affinity item); the long
 *  tail keeps its order. `dayIndex` is a monotonic day counter so consecutive
 *  days step by `step` positions through the pool. `step` should be coprime
 *  with `pool` for a full, even cycle. Deterministic per (day, pool, step). */
function applyDailyRotation(order: string[], dayIndex: number, pool: number, step: number): string[] {
  const n = Math.min(pool, order.length);
  if (n <= 1) return order;
  const head = order.slice(0, n);
  const tail = order.slice(n);
  const off = (((dayIndex * step) % n) + n) % n;
  return [...head.slice(off), ...head.slice(0, off), ...tail];
}

/** Whole-days since the Unix epoch for a YYYY-MM-DD feed date — the monotonic
 *  counter that drives applyDailyRotation's per-day offset. */
function dayIndexOf(feedDate: string): number {
  return Math.floor(Date.parse(`${feedDate}T00:00:00Z`) / 86_400_000);
}

interface RankedItem { type: 'product' | 'look'; id: string }

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== 'POST') return jsonRes({ success: false, error: 'method not allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceRoleKey) return jsonRes({ success: false, error: 'server misconfigured' }, 500);
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  try {
    // ── Auth: resolve the caller from their JWT ──────────────────────────
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    if (!token) return jsonRes({ success: false, error: 'missing auth' }, 401);
    const { data: { user }, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !user) return jsonRes({ success: false, error: 'invalid auth' }, 401);
    let userId = user.id;

    // ── Admin preview: compute ANY user's live daily feed ────────────────
    // When an admin passes { target_user_id }, rank for THAT user instead of
    // the caller. Gated on profiles.is_admin so a regular shopper can't read
    // another shopper's feed. `preview` mode never persists — it must not
    // overwrite the target's real daily row.
    let preview = false;
    try {
      const body = await req.json();
      const targetUserId = typeof body?.target_user_id === 'string' ? body.target_user_id.trim() : '';
      if (targetUserId && targetUserId !== userId) {
        const { data: prof } = await supabase.from('profiles').select('is_admin').eq('id', userId).maybeSingle();
        if (!prof?.is_admin) return jsonRes({ success: false, error: 'admin only' }, 403);
        userId = targetUserId;
        preview = true;
      }
    } catch { /* no JSON body — normal per-caller path */ }

    // ── Config dials ─────────────────────────────────────────────────────
    const { data: settingRows } = await supabase
      .from('app_settings')
      .select('key, value')
      .in('key', ['auto_editor_enabled', 'auto_editor_holdout_pct', 'auto_editor_recency_days', 'auto_editor_min_signal', 'auto_editor_refresh_hour', 'auto_editor_epoch', 'feed_rules']);
    const cfg = new Map((settingRows ?? []).map((r: { key: string; value: string | null }) => [r.key, r.value ?? '']));
    const enabled = (cfg.get('auto_editor_enabled') || 'false').trim().toLowerCase() === 'true';
    const holdoutPct = clampInt(cfg.get('auto_editor_holdout_pct'), 10, 0, 100);
    const recencyDays = clampInt(cfg.get('auto_editor_recency_days'), 30, 1, 365);
    const minSignal = clampInt(cfg.get('auto_editor_min_signal'), 3, 0, 1000);
    const refreshHour = clampInt(cfg.get('auto_editor_refresh_hour'), 0, 0, 23);
    // Manual "advance the daily feed" counter — shifts every shopper's feed day
    // forward so an admin can push everyone to their next feed on demand.
    const epoch = clampInt(cfg.get('auto_editor_epoch'), 0, 0, 100000);
    const rules = parseRules(cfg.get('feed_rules'));

    if (!enabled) return jsonRes({ success: true, enabled: false, variant: 'disabled' });

    const feedDate = editorDay(refreshHour, epoch);

    // ── Idempotency: today's feed already computed? ──────────────────────
    // Admin previews skip the cache: the lens must reflect rule-dial
    // changes immediately, and preview never persists anyway.
    const { data: existing } = preview ? { data: null } : await supabase
      .from('personalized_feeds')
      .select('ranked_items, variant, model, computed_at')
      .eq('user_id', userId)
      .eq('feed_date', feedDate)
      .maybeSingle();
    if (existing) {
      return jsonRes({ success: true, enabled: true, cached: true, ...existing });
    }

    // ── Holdout: keep a deterministic slice on the global feed ───────────
    if (holdoutBucket(userId) < holdoutPct) {
      return await persistAndReturn(supabase, userId, feedDate, [], 'holdout', null, null, preview);
    }

    // ── Signals: the shopper's recent engagement ────────────────────────
    const sinceISO = new Date(Date.now() - recencyDays * 24 * 60 * 60 * 1000).toISOString();
    const { data: eventRows } = await supabase
      .from('user_events')
      .select('event_type, target_type, target_id, target_uuid')
      .eq('user_id', userId)
      .eq('target_type', 'product')
      .gte('created_at', sinceISO)
      .limit(EVENT_LOOKBACK_CAP);
    const events = (eventRows ?? []) as Array<{ event_type: string | null; target_id: string | null; target_uuid: string | null }>;

    if (events.length < minSignal) {
      // Cold start — not enough to personalize; serve the global feed.
      return await persistAndReturn(supabase, userId, feedDate, [], 'fallback', null, null, preview);
    }

    // Per-product engagement weight + the seen set (any impression).
    const engagementWeight = new Map<string, number>();
    const seen = new Set<string>();
    for (const e of events) {
      const pid = e.target_uuid || e.target_id;
      if (!pid) continue;
      const w = EVENT_WEIGHT[(e.event_type || '').toLowerCase()] ?? 1;
      engagementWeight.set(pid, (engagementWeight.get(pid) ?? 0) + w);
      if ((e.event_type || '').toLowerCase() === 'impression') seen.add(pid);
    }

    // Brand / type affinity from the engaged products.
    const engagedIds = [...engagementWeight.keys()];
    const brandWeight = new Map<string, number>();
    const typeWeight = new Map<string, number>();
    if (engagedIds.length > 0) {
      const { data: engagedProducts } = await supabase
        .from('products')
        .select('id, brand, type')
        .in('id', engagedIds.slice(0, 500));
      for (const p of (engagedProducts ?? []) as Array<{ id: string; brand: string | null; type: string | null }>) {
        const w = engagementWeight.get(p.id) ?? 1;
        if (p.brand) brandWeight.set(p.brand, (brandWeight.get(p.brand) ?? 0) + w);
        if (p.type) typeWeight.set(p.type, (typeWeight.get(p.type) ?? 0) + w);
      }
    }

    // ── Candidate pool: the global active product feed ──────────────────
    const { data: candidateRows } = await supabase
      .from('products')
      .select('id, name, brand, type, price, gender, feed_rank, is_elite, conversion_score, primary_video_generated_at')
      .eq('is_active', true)
      .not('primary_video_url', 'is', null)
      .order('feed_rank', { ascending: true, nullsFirst: false })
      .order('is_elite', { ascending: false, nullsFirst: false })
      .order('primary_video_generated_at', { ascending: false, nullsFirst: false })
      .limit(CANDIDATE_POOL);
    let candidates = (candidateRows ?? []) as ProductRow[];

    // Rule: strict gender match — drop items for the other gender (unisex and
    // untagged always pass; unknown shopper gender disables). The catalog is
    // inconsistent: PRODUCTS are tagged male/female/unisex while LOOKS are
    // tagged men/women — so a shopper's gender must accept BOTH spellings
    // (female → {female, women}; male → {male, men}). The old code mapped to a
    // single "women"/"men" plus a broken alias ("women".slice(0,-2)+"le" =
    // "womle"), so it matched ZERO products (all tagged female) and only let
    // unisex through — which is why a female shopper saw a menswear-heavy feed.
    let genderAccept: string[] | null = null;
    if (rules.genderStrict.enabled) {
      const { data: prof } = await supabase.from('profiles').select('gender').eq('id', userId).maybeSingle();
      const g = String(prof?.gender ?? '').toLowerCase();
      if (g.startsWith('m')) genderAccept = ['men', 'male'];
      else if (g.startsWith('f') || g.startsWith('w')) genderAccept = ['women', 'female'];
      if (genderAccept) {
        const ok = new Set([...genderAccept, 'unisex']);
        candidates = candidates.filter(c => {
          const pg = String(c.gender ?? '').toLowerCase();
          return !pg || ok.has(pg);
        });
      }
    }
    if (candidates.length === 0) {
      return await persistAndReturn(supabase, userId, feedDate, [], 'fallback', null, null, preview);
    }

    // Rule: trending this week — platform-wide engagement velocity.
    const trendNorm = new Map<string, number>();
    if (rules.trendingBoost.enabled) {
      const { data: trendRows } = await supabase.rpc('trending_product_scores', { days: 7, lim: 200 });
      const raw = new Map<string, number>(
        ((trendRows ?? []) as Array<{ product_id: string; score: number }>).map(r => [r.product_id, Number(r.score) || 0]));
      for (const [k, v] of normMap(raw)) trendNorm.set(k, v);
    }

    // Deterministic taste score — every signal normalized 0..1, scaled by
    // its rule weight (0..10). Disabled rules contribute nothing.
    const brandNorm = normMap(brandWeight);
    const typeNorm = normMap(typeWeight);
    const engageNorm = normMap(engagementWeight);
    const maxConv = Math.max(...candidates.map(c => c.conversion_score ?? 0), 0.0001);
    const newestMs = Math.max(...candidates.map(c => c.primary_video_generated_at ? Date.parse(c.primary_video_generated_at) : 0), 1);
    const oldestMs = Math.min(...candidates.map(c => c.primary_video_generated_at ? Date.parse(c.primary_video_generated_at) : newestMs));
    const freshSpan = Math.max(newestMs - oldestMs, 1);

    const scored = candidates.map((c, idx) => {
      let score = 0;
      if (rules.engagedBrands.enabled && c.brand) score += rules.engagedBrands.weight * (brandNorm.get(c.brand) ?? 0);
      if (rules.engagedTypes.enabled && c.type) score += rules.engagedTypes.weight * (typeNorm.get(c.type) ?? 0);
      if (rules.clickedProducts.enabled) score += rules.clickedProducts.weight * (engageNorm.get(c.id) ?? 0);
      if (rules.convertingBoost.enabled) score += rules.convertingBoost.weight * ((c.conversion_score ?? 0) / maxConv);
      if (rules.freshnessBoost.enabled && c.primary_video_generated_at) {
        score += rules.freshnessBoost.weight * ((Date.parse(c.primary_video_generated_at) - oldestMs) / freshSpan);
      }
      if (rules.trendingBoost.enabled) score += rules.trendingBoost.weight * (trendNorm.get(c.id) ?? 0);
      if (rules.seenDecay.enabled && seen.has(c.id)) score -= rules.seenDecay.weight / 2; // weight 5 ≈ legacy SEEN_PENALTY 2.5
      // Small global-rank tiebreaker so equal-affinity items keep editorial order.
      score += (CANDIDATE_POOL - idx) * 0.001;
      return { c, score };
    });
    scored.sort((a, b) => b.score - a.score);
    const deterministicOrder = scored.map(s => s.c.id);

    // ── Claude re-rank of the top slice ─────────────────────────────────
    const apiKey = Deno.env.get('ANTHROPIC_API_KEY') || '';
    let finalOrder = deterministicOrder;
    let model = 'deterministic';
    const appliedRules = (Object.keys(rules) as (keyof FeedRules)[])
      .filter(k => rules[k].enabled && k !== 'savedBrands');
    let reason: Record<string, unknown> | null = {
      topBrands: topKeys(brandWeight, 5),
      topTypes: topKeys(typeWeight, 5),
      engaged: engagedIds.length,
      seen: seen.size,
      rules: appliedRules,
    };

    if (apiKey && !preview) {
      try {
        const topSlice = scored.slice(0, CLAUDE_TOP_N).map(s => s.c);
        const { order: claudeOrder, inputTokens, outputTokens } = await claudeRerank(topSlice, brandWeight, typeWeight, seen, apiKey);
        void logUsage(supabase, { operation: 'personalize-feed', model: MODEL, input_tokens: inputTokens, output_tokens: outputTokens, status: 'success' });
        // Keep only known candidate ids, then append any the model dropped so
        // the feed is always complete (Claude order first, remainder after).
        const candidateIdSet = new Set(candidates.map(c => c.id));
        const seenInOrder = new Set<string>();
        const merged: string[] = [];
        for (const id of claudeOrder) {
          if (candidateIdSet.has(id) && !seenInOrder.has(id)) { merged.push(id); seenInOrder.add(id); }
        }
        for (const id of deterministicOrder) {
          if (!seenInOrder.has(id)) { merged.push(id); seenInOrder.add(id); }
        }
        if (merged.length > 0) {
          finalOrder = merged;
          model = MODEL;
          reason = { ...reason, reranked: true };
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        void logUsage(supabase, { operation: 'personalize-feed', model: MODEL, status: 'error', error_message: msg.slice(0, 500) });
        // Fall through with the deterministic order.
      }
    }

    // Rule: brand diversity guard — cap one brand's share of the top 20.
    if (rules.diversityGuard.enabled) {
      const cap = Math.max(1, Math.min(5, Math.round(rules.diversityGuard.weight)));
      const brandById = new Map(candidates.map(c => [c.id, c.brand]));
      finalOrder = applyDiversityGuard(finalOrder, brandById, cap);
    }

    // Rule: fresh-slot quota — guarantee never-shown items hold K of the
    // top 20, promoting the best-ranked unseen from below, interleaved so
    // the feed leads with discovery without burying proven favourites.
    if (rules.freshSlots.enabled) {
      const k = Math.max(0, Math.min(20, Math.round(rules.freshSlots.weight)));
      finalOrder = applyFreshSlots(finalOrder, seen, k);
    }

    // Hard rotation guarantee: at most 6 of yesterday's top 12 may repeat
    // in today's top 12 (fresh arrivals and dark inventory rise instead).
    const prevDay = new Date(Date.parse(`${feedDate}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
    const { data: prevRow } = await supabase
      .from('personalized_feeds')
      .select('ranked_items')
      .eq('user_id', userId)
      .eq('feed_date', prevDay)
      .maybeSingle();
    const prevTop = new Set(
      (((prevRow?.ranked_items ?? []) as RankedItem[]).slice(0, 12)).map(r => r.id));
    if (prevTop.size > 0) {
      finalOrder = applyRotationGuard(finalOrder, prevTop, 6, 12);
      reason = { ...reason, rotated: true };
    }

    // Daily shuffle — re-order the top slots with a date+user seed so the
    // VISIBLE head changes every day even when taste (and the ranking) is
    // stable. Last product step so it owns the final lead order.
    if (rules.dailyShuffle.enabled) {
      finalOrder = applyDailyShuffle(finalOrder, `${feedDate}:${userId}`, Math.round(rules.dailyShuffle.weight));
      reason = { ...reason, shuffled: true };
    }

    // Day-to-day derangement guarantee: no product may sit in the SAME slot it
    // held yesterday, so each drop visibly moves even below the shuffled head.
    const prevProductOrder = ((prevRow?.ranked_items ?? []) as RankedItem[])
      .filter(r => !r.type || r.type === 'product').map(r => r.id);
    if (prevProductOrder.length > 0) {
      finalOrder = derangeAgainstPrev(finalOrder, prevProductOrder);
      reason = { ...reason, deranged: true };
    }

    // ── Personalize LOOKS too (deterministic, fail-open) ────────────────
    // Looks are ranked separately here and woven into the feed client-side by
    // feed_rank (looks still lead). A look inherits the brand/type affinity of
    // its attached products (reusing the weights above), plus freshness − seen-
    // decay. Wrapped so any failure leaves lookOrder empty and products — which
    // are already ranked — are never affected.
    let lookOrder: string[] = [];
    try {
      lookOrder = await rankLooks(supabase, userId, sinceISO, brandNorm, typeNorm, rules, genderAccept);
      // LEAD ROTATION (the fix for "I keep seeing the same looks first"): looks
      // lead the feed, but the affinity ranking is stable day-to-day, so the
      // SAME top looks always won — dailyShuffle only re-ordered that same set
      // and derange only swapped positions, leaving the lead pool unchanged.
      // Rotate which slice of the top looks leads each day so a genuinely
      // different (still high-affinity) set heads the feed. Cycles through the
      // top 18 in steps of 7 (coprime → even 18-day cycle).
      if (lookOrder.length > 1) {
        lookOrder = applyDailyRotation(lookOrder, dayIndexOf(feedDate), 18, 7);
        reason = { ...reason, lookRotated: true };
      }
      if (rules.dailyShuffle.enabled && lookOrder.length > 1) {
        lookOrder = applyDailyShuffle(lookOrder, `looks:${feedDate}:${userId}`, Math.round(rules.dailyShuffle.weight));
      }
      // Same day-to-day guarantee for looks so the lead look isn't the same
      // every drop ("I've seen the same look first every time").
      const prevLookOrder = ((prevRow?.ranked_items ?? []) as RankedItem[])
        .filter(r => r.type === 'look').map(r => r.id);
      if (lookOrder.length > 1 && prevLookOrder.length > 0) {
        lookOrder = derangeAgainstPrev(lookOrder, prevLookOrder);
      }
      if (lookOrder.length > 0) reason = { ...reason, looks: lookOrder.length };
    } catch (err) {
      void logUsage(supabase, { operation: 'personalize-feed-looks', model: 'deterministic', status: 'error', error_message: (err instanceof Error ? err.message : String(err)).slice(0, 500) });
    }

    return await persistAndReturn(supabase, userId, feedDate, finalOrder, 'personalized', model, reason, preview, lookOrder);
  } catch (err) {
    return jsonRes({ success: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

// ── Helpers ────────────────────────────────────────────────────────────

function clampInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function topKeys(m: Map<string, number>, k: number): string[] {
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, k).map(([key]) => key);
}

// Fire-and-forget AI-usage log (mirrors _shared/ai-usage.ts, inlined so this
// function deploys as a single file). Never throws.
async function logUsage(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  fields: { operation: string; model: string; input_tokens?: number | null; output_tokens?: number | null; status?: 'success' | 'error'; error_message?: string | null },
): Promise<void> {
  try {
    await supabase.from('ai_usage_logs').insert({
      platform: 'anthropic',
      operation: fields.operation,
      model: fields.model,
      input_tokens: fields.input_tokens ?? null,
      output_tokens: fields.output_tokens ?? null,
      status: fields.status ?? 'success',
      error_message: fields.error_message ?? null,
    });
  } catch { /* logging must never break the request */ }
}

async function persistAndReturn(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  userId: string,
  feedDate: string,
  order: string[],
  variant: 'personalized' | 'fallback' | 'holdout',
  model: string | null,
  reason: Record<string, unknown> | null,
  preview = false,
  lookOrder: string[] = [],
) {
  // Products first, then the personalized look order. The client splits by
  // type and weaves looks in by feed_rank; keeping products first also keeps
  // the rotation guard's "top 12" (read elsewhere) product-based.
  const ranked: RankedItem[] = [
    ...order.map(id => ({ type: 'product' as const, id })),
    ...lookOrder.map(id => ({ type: 'look' as const, id })),
  ];
  // Preview (admin viewing another user) must not write the target's row.
  if (!preview) {
    await supabase.from('personalized_feeds').upsert({
      user_id: userId,
      feed_date: feedDate,
      ranked_items: ranked,
      variant,
      model,
      reason,
      computed_at: new Date().toISOString(),
    }, { onConflict: 'user_id,feed_date' });
  }
  return jsonRes({ success: true, enabled: true, cached: false, preview, variant, model, reason, ranked_items: ranked });
}

// Deterministic LOOK ranking for the Daily Feed. Mirrors the product taste
// score but for looks: a look inherits the brand/type affinity of its attached
// products, plus a freshness boost and a seen-decay. Returns look ids best-
// first. Bounded + the caller wraps it in try/catch (fail-open).
async function rankLooks(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  userId: string,
  sinceISO: string,
  brandNorm: Map<string, number>,
  typeNorm: Map<string, number>,
  rules: FeedRules,
  genderAccept: string[] | null,
): Promise<string[]> {
  const LOOK_POOL = 120;
  const { data: lookRows } = await supabase
    .from('looks')
    .select('id, feed_rank, created_at, gender')
    .eq('status', 'live')
    .order('feed_rank', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false, nullsFirst: false })
    .limit(LOOK_POOL);
  let looks = (lookRows ?? []) as Array<{ id: string; feed_rank: number | null; created_at: string | null; gender: string | null }>;
  // Strict gender match for looks too (they were never filtered — the reason a
  // female shopper still saw male-model looks). Looks are tagged men/women;
  // accept the shopper's gender (both spellings) + unisex/untagged.
  if (genderAccept) {
    const ok = new Set([...genderAccept, 'unisex']);
    looks = looks.filter(l => { const lg = String(l.gender ?? '').toLowerCase(); return !lg || ok.has(lg); });
  }
  if (looks.length === 0) return [];
  const lookIds = looks.map(l => l.id);

  // Each look inherits its attached products' brand/type affinity.
  const affRaw = new Map<string, number>();
  const { data: lp } = await supabase
    .from('look_products')
    .select('look_id, products:products ( brand, type )')
    .in('look_id', lookIds);
  for (const row of (lp ?? []) as Array<{ look_id: string; products: { brand: string | null; type: string | null } | null }>) {
    const b = row.products?.brand; const t = row.products?.type;
    const a = (b ? (brandNorm.get(b) ?? 0) : 0) + (t ? (typeNorm.get(t) ?? 0) : 0);
    if (a > 0) affRaw.set(row.look_id, (affRaw.get(row.look_id) ?? 0) + a);
  }
  const affNorm = normMap(affRaw);

  // Looks the shopper has already seen (impressions) get decayed.
  const seenLooks = new Set<string>();
  if (rules.seenDecay.enabled) {
    const { data: lookEvents } = await supabase
      .from('user_events')
      .select('target_id, target_uuid')
      .eq('user_id', userId).eq('target_type', 'look').eq('event_type', 'impression')
      .gte('created_at', sinceISO).limit(5000);
    for (const e of (lookEvents ?? []) as Array<{ target_id: string | null; target_uuid: string | null }>) {
      const id = e.target_uuid || e.target_id; if (id) seenLooks.add(id);
    }
  }

  const times = looks.map(l => (l.created_at ? Date.parse(l.created_at) : 0)).filter(Boolean);
  const newest = Math.max(...times, 1);
  const oldest = Math.min(...(times.length ? times : [newest]));
  const span = Math.max(newest - oldest, 1);
  const affWeight = (rules.engagedBrands.weight + rules.engagedTypes.weight) / 2;

  const scored = looks.map((l, idx) => {
    let s = 0;
    if (rules.engagedBrands.enabled || rules.engagedTypes.enabled) s += affWeight * (affNorm.get(l.id) ?? 0);
    if (rules.freshnessBoost.enabled && l.created_at) s += rules.freshnessBoost.weight * ((Date.parse(l.created_at) - oldest) / span);
    if (rules.seenDecay.enabled && seenLooks.has(l.id)) s -= rules.seenDecay.weight / 2;
    s += (LOOK_POOL - idx) * 0.001; // editorial tiebreaker — keeps feed_rank order on ties
    return { id: l.id, s };
  });
  scored.sort((a, b) => b.s - a.s);
  return scored.map(x => x.id);
}

interface ClaudeResponse {
  content?: Array<{ type: string; text?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
}

async function claudeRerank(
  products: ProductRow[],
  brandWeight: Map<string, number>,
  typeWeight: Map<string, number>,
  seen: Set<string>,
  apiKey: string,
): Promise<{ order: string[]; inputTokens: number | null; outputTokens: number | null }> {
  const compact = products.map(p => ({
    id: p.id,
    name: (p.name || '').slice(0, 80),
    brand: p.brand || '',
    type: p.type || '',
    price: p.price || '',
    seen: seen.has(p.id),
  }));
  const prompt = `You are the personal editor of a shopper's daily fashion feed.

The shopper's recent taste signals:
- Favorite brands (most→least engaged): ${topKeys(brandWeight, 8).join(', ') || '(none yet)'}
- Favorite categories: ${topKeys(typeWeight, 8).join(', ') || '(none yet)'}

Here are the candidate products (JSON). "seen": true means they've already
seen it recently — push those DOWN so today's feed feels fresh.

${JSON.stringify(compact)}

Order ALL of these products into the best daily feed for THIS shopper:
- Lead with items matching their favorite brands and categories.
- Favor fresh (seen=false) items over ones they've already seen.
- Keep variety near the top (don't stack 5 of the same category in a row).
- Every product id must appear exactly once.

Return ONLY JSON: {"order": ["id1","id2",...]}. No prose, no code fences.`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as ClaudeResponse;
  const text = json.content?.find(c => c.type === 'text')?.text?.trim() ?? '';
  const cleaned = text.replace(/```json\s*|```\s*/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('no JSON object in Claude response');
  const parsed = JSON.parse(cleaned.slice(start, end + 1)) as { order?: unknown };
  if (!Array.isArray(parsed.order)) throw new Error('Claude response missing order array');
  return {
    order: parsed.order.map(String),
    inputTokens: json.usage?.input_tokens ?? null,
    outputTokens: json.usage?.output_tokens ?? null,
  };
}
