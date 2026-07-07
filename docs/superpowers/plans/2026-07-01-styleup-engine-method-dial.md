# Style Up Engine-Method Dial + Full-Look "See it on me" — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an admin `/admin/dials` switch that flips the `/style` catalog stylist between the occasion-aware **style engine** and the pre-engine **legacy** recency behavior, and give engine mode a full-look "See it on me" with optional per-piece selection — all without deleting either code path.

**Architecture:** One `app_settings` dial (`stylist_engine_method`) read by both the client (`StyleUpExperience`, via a hook) and the `style-up-chat` edge fn (direct select), so they never disagree. Client routing, the swap retrieval source, and the edge-fn candidate query each branch on the dial. Full-look render reuses the existing `generateFullLook`/`startFullLookRender` pipeline. Reverting is flipping the dial — no deploy.

**Tech Stack:** Remix v2 SPA + React 19 + TypeScript; Supabase (`app_settings`, edge functions, `style_slot_search` RPC); Vitest for unit tests.

## Global Constraints

- Commit directly to `dev` (never create feature/session branches). Prefixes: `feat:` / `fix:` / `refactor:` / `chore:`.
- No deletions: every legacy path (`startOutfitFlow`, `askOutfitSlots`, `onChoose('slots')`, `recommendForSlot`, the recency query in `fetchSwapOptions`, the 120-newest edge-fn query) stays in the code, chosen at runtime by the dial.
- Dial values: `stylist_engine_method` ∈ `'style_engine' | 'legacy'`, default `'style_engine'`.
- Web stylists (`source_mode === 'web'`) are never affected by the dial.
- Edge-fn deploys go through `mcp__supabase__deploy_edge_function` (bundle `index.ts` + `../_shared/style-retrieval.ts`), not the CLI. Keep `verify_jwt: true`.
- Path alias: `~/*` → `app/*` (resolves in vitest).

---

### Task 1: `stylist_engine_method` dial (service)

**Files:**
- Modify: `app/services/dials.ts` (append new dial after the waitlist block ~line 386; add key to `prefetchDials` ~line 150)
- Test: `app/services/dials.stylist-method.test.ts` (create)

**Interfaces:**
- Produces: `STYLIST_ENGINE_METHOD_KEY: string`, `type StylistEngineMethod = 'style_engine' | 'legacy'`, `DEFAULT_STYLIST_ENGINE_METHOD: StylistEngineMethod`, `parseStylistMethod(raw): StylistEngineMethod`, `getStylistEngineMethod(): Promise<StylistEngineMethod>`, `setStylistEngineMethod(v): Promise<void>`, `subscribeStylistEngineMethod(cb): () => void`.

- [ ] **Step 1: Write the failing test**

Create `app/services/dials.stylist-method.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { parseStylistMethod, DEFAULT_STYLIST_ENGINE_METHOD } from './dials';

describe('parseStylistMethod', () => {
  it('returns "legacy" only for the exact string', () => {
    expect(parseStylistMethod('legacy')).toBe('legacy');
  });
  it('defaults to style_engine for anything else', () => {
    expect(DEFAULT_STYLIST_ENGINE_METHOD).toBe('style_engine');
    expect(parseStylistMethod('style_engine')).toBe('style_engine');
    expect(parseStylistMethod(null)).toBe('style_engine');
    expect(parseStylistMethod(undefined)).toBe('style_engine');
    expect(parseStylistMethod('garbage')).toBe('style_engine');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/services/dials.stylist-method.test.ts`
Expected: FAIL — `parseStylistMethod` is not exported / not a function.

- [ ] **Step 3: Add the dial to `app/services/dials.ts`**

Append after the waitlist `subscribeWaitlistMode` block (after ~line 386):
```ts
// ────────────────────────────────────────────────────────────────────
// Stylist engine method (A/B). How the /style catalog stylist sources
// products:
//   'style_engine' (default) → occasion-aware style_slot_search
//   'legacy'                  → the pre-engine 120-newest recency behavior
// Read by StyleUpExperience (client, via useStylistEngineMethod) AND the
// style-up-chat edge fn (direct app_settings select), so both always agree.
// ────────────────────────────────────────────────────────────────────

export const STYLIST_ENGINE_METHOD_KEY = 'stylist_engine_method';
export type StylistEngineMethod = 'style_engine' | 'legacy';
export const DEFAULT_STYLIST_ENGINE_METHOD: StylistEngineMethod = 'style_engine';

export function parseStylistMethod(raw: string | null | undefined): StylistEngineMethod {
  return raw === 'legacy' ? 'legacy' : DEFAULT_STYLIST_ENGINE_METHOD;
}

export async function getStylistEngineMethod(): Promise<StylistEngineMethod> {
  return parseStylistMethod(await readDial(STYLIST_ENGINE_METHOD_KEY));
}

export async function setStylistEngineMethod(value: StylistEngineMethod): Promise<void> {
  if (!supabase) throw new Error('Supabase not configured');
  const { error } = await supabase
    .from('app_settings')
    .upsert({ key: STYLIST_ENGINE_METHOD_KEY, value }, { onConflict: 'key' });
  if (error) throw error;
}

export function subscribeStylistEngineMethod(onChange: (v: StylistEngineMethod) => void): () => void {
  if (!supabase) return () => {};
  const channel = supabase
    .channel(`dials:${STYLIST_ENGINE_METHOD_KEY}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'app_settings', filter: `key=eq.${STYLIST_ENGINE_METHOD_KEY}` },
      (payload) => onChange(parseStylistMethod((payload.new as { value?: string } | null)?.value ?? null)),
    )
    .subscribe();
  return () => { void supabase!.removeChannel(channel); };
}
```

Then add the key to the `prefetchDials` `keys` array (inside the array literal ~line 150):
```ts
      WAITLIST_MODE_KEY,
      STYLIST_ENGINE_METHOD_KEY,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run app/services/dials.stylist-method.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add app/services/dials.ts app/services/dials.stylist-method.test.ts
git commit -m "feat(style-up): add stylist_engine_method dial (app_settings)"
```

---

### Task 2: Admin control + `useStylistEngineMethod` hook

**Files:**
- Create: `app/hooks/useStylistEngineMethod.ts`
- Modify: `app/routes/admin/dials.tsx` (imports ~line 23-37; add state block near the comments block ~line 213; add a render card near the comments card ~line 868)

**Interfaces:**
- Consumes: `getStylistEngineMethod`, `setStylistEngineMethod`, `subscribeStylistEngineMethod`, `StylistEngineMethod`, `DEFAULT_STYLIST_ENGINE_METHOD` (Task 1).
- Produces: `useStylistEngineMethod(): { method: StylistEngineMethod; loading: boolean }`.

- [ ] **Step 1: Create the hook**

Create `app/hooks/useStylistEngineMethod.ts`:
```ts
import { useEffect, useState } from 'react';
import {
  getStylistEngineMethod,
  subscribeStylistEngineMethod,
  DEFAULT_STYLIST_ENGINE_METHOD,
  type StylistEngineMethod,
} from '~/services/dials';

// The /style catalog stylist's retrieval method, read live from the
// stylist_engine_method dial (app_settings). Flipping it on /admin/dials
// switches every open stylist chat between the style engine and the legacy
// recency behavior without a refresh.
export function useStylistEngineMethod(): { method: StylistEngineMethod; loading: boolean } {
  const [method, setMethod] = useState<StylistEngineMethod>(DEFAULT_STYLIST_ENGINE_METHOD);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    getStylistEngineMethod().then(v => { if (!cancelled) { setMethod(v); setLoading(false); } });
    const unsub = subscribeStylistEngineMethod(v => { if (!cancelled) setMethod(v); });
    return () => { cancelled = true; unsub(); };
  }, []);

  return { method, loading };
}
```

- [ ] **Step 2: Add the dial imports to `app/routes/admin/dials.tsx`**

In the `~/services/dials` import block (~line 23-37), add:
```ts
  getStylistEngineMethod,
  setStylistEngineMethod,
  subscribeStylistEngineMethod,
  DEFAULT_STYLIST_ENGINE_METHOD,
  type StylistEngineMethod,
```

- [ ] **Step 3: Add the state block**

After the comments-flag state/handlers block (after ~line 237, before the next `// ──` section), add:
```ts
  // ── Stylist engine method (A/B: style engine vs legacy recency) ─────
  const [stylistMethod, setStylistMethodState] = useState<StylistEngineMethod>(DEFAULT_STYLIST_ENGINE_METHOD);
  const [stylistMethodLoaded, setStylistMethodLoaded] = useState(false);
  const [stylistMethodSaving, setStylistMethodSaving] = useState(false);
  const inflightStylistMethod = useRef<StylistEngineMethod | null>(null);
  useEffect(() => {
    getStylistEngineMethod().then(v => {
      if (inflightStylistMethod.current) return;
      setStylistMethodState(v);
      setStylistMethodLoaded(true);
    });
    const unsub = subscribeStylistEngineMethod(v => {
      if (inflightStylistMethod.current === v) return;
      setStylistMethodState(v);
    });
    return () => unsub();
  }, []);
  const onSetStylistMethod = (next: StylistEngineMethod) => {
    if (next === stylistMethod) return;
    setStylistMethodState(next);
    inflightStylistMethod.current = next;
    setStylistMethodSaving(true);
    setStylistEngineMethod(next)
      .catch(() => setStylistMethodState(stylistMethod))
      .finally(() => {
        setStylistMethodSaving(false);
        if (inflightStylistMethod.current === next) inflightStylistMethod.current = null;
      });
  };
```

- [ ] **Step 4: Add the render card**

After the comments-flag `<div className="admin-detail-card">…</div>` (after ~line 868), add:
```tsx
        <div className="admin-detail-card">
          <h3>Stylist engine (Style Up)</h3>
          <p style={{ fontSize: 13, color: '#888', margin: '4px 0 16px' }}>
            How the /style catalog stylist finds products. <b>Style engine</b> uses
            occasion-aware search and suggests a complete look directly (no slot
            chooser). <b>Legacy</b> restores the pre-engine behavior: the "Build your
            outfit" chooser and the 120-newest recency scan. Flip to compare — it
            applies to the next turn in every open chat.
          </p>
          {!stylistMethodLoaded ? (
            <Skeleton height={40} radius={8} />
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
              <div style={{ display: 'inline-flex', border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
                {(['style_engine', 'legacy'] as const).map(opt => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => onSetStylistMethod(opt)}
                    style={{
                      padding: '8px 16px', fontSize: 13, fontWeight: 600, border: 'none', cursor: 'pointer',
                      background: stylistMethod === opt ? '#111' : '#fff',
                      color: stylistMethod === opt ? '#fff' : '#555',
                    }}
                  >
                    {opt === 'style_engine' ? 'Style engine' : 'Legacy'}
                  </button>
                ))}
              </div>
              <span style={{ fontSize: 11, color: '#999' }}>{stylistMethodSaving ? 'Saving…' : 'Saved'}</span>
            </div>
          )}
        </div>
```

- [ ] **Step 5: Typecheck + build the admin route**

Run: `npx tsc --noEmit`
Expected: no new errors in `dials.tsx` / `useStylistEngineMethod.ts`.

- [ ] **Step 6: Commit**

```bash
git add app/hooks/useStylistEngineMethod.ts app/routes/admin/dials.tsx
git commit -m "feat(style-up): admin dial control + useStylistEngineMethod hook"
```

---

### Task 3: Edge fn — branch candidates on the dial + `mode:'outfit'`

**Files:**
- Modify: `supabase/functions/style-up-chat/index.ts` (candidate block ~line 125-146; catalog system prompt ~line 165-181)

**Interfaces:**
- Consumes: `retrieveOccasionCandidates` (existing import), `app_settings` row `stylist_engine_method`, request `body.mode`.
- Produces: same response shape; picks now come from engine OR the restored 120-newest query depending on the dial.

- [ ] **Step 1: Read the dial + branch the candidate block**

Replace the current catalog candidate block (the `let cands: ProductCand[] = []; if (!isWeb) { … retrieveOccasionCandidates … }` block, ~line 130-143) with:
```ts
    // Retrieval method is an admin dial (app_settings.stylist_engine_method):
    //   'style_engine' (default) → occasion-aware style_slot_search
    //   'legacy'                 → the pre-engine 120-newest recency scan
    const { data: methodRow } = await admin
      .from('app_settings').select('value').eq('key', 'stylist_engine_method').maybeSingle();
    const method = (methodRow?.value === 'legacy') ? 'legacy' : 'style_engine';
    const mode = String(body.mode ?? '');

    // Candidate products to recommend FROM. Web stylists skip this (live web search).
    let cands: ProductCand[] = [];
    if (!isWeb && method === 'legacy') {
      // LEGACY: the 120 most-recently-added active products, gender-filtered.
      let q = admin.from('products')
        .select('id, name, brand, price, image_url, primary_image_url, url, type')
        .eq('is_active', true)
        .not('image_url', 'is', null)
        .order('created_at', { ascending: false })
        .limit(120);
      if (genderNorm === 'male') q = q.or('gender.eq.male,gender.eq.unisex');
      else if (genderNorm === 'female') q = q.or('gender.eq.female,gender.eq.unisex');
      const { data: candRows } = await q;
      cands = (candRows ?? []) as ProductCand[];
      console.log(`[style-up-chat] thread=${threadId} retrieval=LEGACY(recency-120) candidates=${cands.length}`);
    } else if (!isWeb) {
      // STYLE ENGINE: occasion-aware per-slot style_slot_search.
      const occasion = turns.map(t => (t.body ?? '').trim()).filter(Boolean).join(' ').slice(0, 600);
      const found = await retrieveOccasionCandidates(admin, {
        occasion, gender: genderNorm, aesthetic: stylist?.specialty ?? '',
      });
      cands = found.filter(c => c.image).map(c => ({
        id: c.id, name: c.name, brand: c.brand, price: c.price,
        image_url: c.image, primary_image_url: c.image, url: c.url, type: c.type,
      }));
      console.log(`[style-up-chat] thread=${threadId} retrieval=ENGINE(style_slot_search) candidates=${cands.length} mode=${mode || 'default'} (occasion-aware, NOT recency scan)`);
    }
```

- [ ] **Step 2: Add the complete-look clause to the catalog prompt**

Just before the catalog branch's `CANDIDATE PRODUCTS …` line (~line 173), build a clause and interpolate it. Immediately before the `const system = isWeb ? … : …` assignment, add:
```ts
    const outfitClause = (!isWeb && method === 'style_engine' && mode === 'outfit')
      ? `\n- The shopper wants a COMPLETE outfit this turn. Recommend ONE coherent full look from the candidates: a top (or a dress), a bottom, shoes, plus an optional layer — one piece per slot, all matching in colour, formality and season. Put every piece's id in productIds.`
      : '';
```
Then, in the catalog (`: \`…\``) branch of the `system` template, insert `${outfitClause}` at the end of the `STYLE OF REPLY:` bullet list — i.e. immediately after the line ending `…NEVER say you can't generate photos.` and before the blank line preceding `CANDIDATE PRODUCTS`:
```ts
- After recommending, tell them they can tap any piece to see it on themselves, or just ask you to put the whole look on them — you CAN generate the look on them (it kicks off automatically when they ask). NEVER say you can't generate photos.${outfitClause}

CANDIDATE PRODUCTS (id | name | brand | price | type) — only recommend from these:
```

- [ ] **Step 3: Deploy the edge function**

Deploy via `mcp__supabase__deploy_edge_function` with `name: "style-up-chat"`, `entrypoint_path: "index.ts"`, `verify_jwt: true`, and BOTH files: `index.ts` (the edited content) and `../_shared/style-retrieval.ts` (unchanged). Confirm the response shows a new `version` and `status: "ACTIVE"`.

- [ ] **Step 4: Verify boot + both branches**

Run (CORS preflight proves the bundle boots):
```bash
curl -s -o /dev/null -w "%{http_code}\n" -X OPTIONS \
  https://vtarjrnqvcqbhoclvcur.supabase.co/functions/v1/style-up-chat \
  -H "Origin: https://catalog.shop" -H "Access-Control-Request-Method: POST"
```
Expected: `204`.

Then, via `mcp__supabase__execute_sql`, set the dial and confirm each branch is reachable by reading a subsequent trace's `candidate_count` after a live chat turn (see Task 6 manual verification). For a quick server check, set legacy and confirm the row exists:
```sql
insert into app_settings(key, value) values ('stylist_engine_method','legacy')
on conflict (key) do update set value = excluded.value;
select value from app_settings where key = 'stylist_engine_method';  -- 'legacy'
-- reset to default afterward:
update app_settings set value = 'style_engine' where key = 'stylist_engine_method';
```

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/style-up-chat/index.ts
git commit -m "feat(style-up): edge fn branches candidates on stylist_engine_method + outfit mode"
```

---

### Task 4: Swap retrieval branches on the dial

**Files:**
- Modify: `app/services/style-up.ts` (`RecommendOpts` ~line 620-627; `fetchSwapOptions` ~line 643-698; add `slotSearch` + `SwapRow` above it)

**Interfaces:**
- Consumes: `StylistEngineMethod` (Task 1), `supabase.rpc('style_slot_search', …)`, existing `ROLE_QUERY_NOUN`, `getUserGender`, `roleForProduct`.
- Produces: `RecommendOpts.engineMethod?: StylistEngineMethod`; `fetchSwapOptions` returns occasion-ranked candidates when `engineMethod === 'style_engine'`, recency otherwise. Same `StyleUpProductRef[]` shape.

- [ ] **Step 1: Import the type + extend `RecommendOpts`**

At the top of `app/services/style-up.ts`, add to the existing `~/services/dials` import (or add a new import if none):
```ts
import type { StylistEngineMethod } from '~/services/dials';
```
Add one field to the `RecommendOpts` interface (~line 620):
```ts
  engineMethod?: StylistEngineMethod;   // 'style_engine' (default) → style_slot_search; 'legacy' → recency
```

- [ ] **Step 2: Add a `SwapRow` type + `slotSearch` wrapper**

Immediately above `export async function fetchSwapOptions` (~line 643), add:
```ts
type SwapRow = {
  id: string; name: string | null; brand: string | null; price: string | null;
  image_url: string | null; primary_image_url: string | null; url: string | null;
  type: string | null; haiku_context: string | null;
};

/** Occasion-aware candidates for one slot via style_slot_search (the engine).
 *  Returns rows in the same shape as the legacy recency select so the caller's
 *  scoring loop is source-agnostic. */
async function slotSearch(role: string, gender: string, occasion: string, k: number): Promise<SwapRow[]> {
  if (!supabase) return [];
  const noun = ROLE_QUERY_NOUN[role] ?? '';
  const q = `${occasion} ${noun}`.trim();
  const pGender = gender === 'male' || gender === 'female' ? gender : null;
  const { data, error } = await supabase.rpc('style_slot_search', { p_query: q, p_k: k, p_gender: pGender });
  if (error || !Array.isArray(data)) return [];
  return (data as Array<Record<string, unknown>>).map(r => ({
    id: String(r.product_id), name: (r.product_name as string) ?? null, brand: (r.product_brand as string) ?? null,
    price: (r.product_price as string) ?? null, image_url: (r.product_image_url as string) ?? null,
    primary_image_url: (r.product_image_url as string) ?? null, url: (r.product_url as string) ?? null,
    type: (r.product_type as string) ?? null, haiku_context: null,
  }));
}
```

- [ ] **Step 3: Branch the candidate source inside `fetchSwapOptions`**

In `fetchSwapOptions`, replace the recency query block (the `let q = supabase.from('products')… const { data } = await q;` lines, ~line 652-660) with:
```ts
  const method: StylistEngineMethod = opts.engineMethod ?? 'style_engine';
  let data: SwapRow[] | null;
  if (method === 'style_engine') {
    const occasion = [opts.styleText, opts.occasion].filter(Boolean).join(' ');
    data = await slotSearch(role, gender, occasion, SWAP_FETCH_LIMIT);
  } else {
    let q = supabase.from('products')
      .select('id, name, brand, price, image_url, primary_image_url, url, type, gender, haiku_context')
      .eq('is_active', true)              // in-stock proxy (#5)
      .not('image_url', 'is', null)
      .order('created_at', { ascending: false })
      .limit(SWAP_FETCH_LIMIT);
    if (gender === 'male') q = q.or('gender.eq.male,gender.eq.unisex');
    else if (gender === 'female') q = q.or('gender.eq.female,gender.eq.unisex');
    data = (await q).data as SwapRow[] | null;
  }
```
Then, in the existing scoring loop, change the local `type Row = { … }` line to reuse `SwapRow` (replace `for (const p of (data ?? []) as Row[])` with `for (const p of (data ?? []) as SwapRow[])`, and delete the now-redundant inline `type Row` declaration). The rest of the loop (exclude, `roleForProduct`, budget, avoid, formality, recency tiebreak) is unchanged; the engine already ranks by occasion so the recency tiebreak stays a harmless minor term.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors in `style-up.ts`.

- [ ] **Step 5: Commit**

```bash
git add app/services/style-up.ts
git commit -m "feat(style-up): fetchSwapOptions sources from style_slot_search when engine method on"
```

---

### Task 5: Client routing branches on the dial

**Files:**
- Modify: `app/components/style-up/StyleUpExperience.tsx` (imports top; `triggerStylist` ~line 654-683; `send()` ~line 851-875; `recOpts` ~line 529-533)

**Interfaces:**
- Consumes: `useStylistEngineMethod` (Task 2), `RecommendOpts.engineMethod` (Task 4).
- Produces: outfit asks route to the engine (with `mode:'outfit'`) in engine mode, to `startOutfitFlow()` in legacy; `recOpts()` carries `engineMethod`.

- [ ] **Step 1: Import + read the dial**

Add the import near the other hook imports at the top of `StyleUpExperience.tsx`:
```ts
import { useStylistEngineMethod } from '~/hooks/useStylistEngineMethod';
```
Inside the component body (near the other hooks, before `recOpts`), add:
```ts
  const { method: engineMethod } = useStylistEngineMethod();
```

- [ ] **Step 2: `triggerStylist` accepts + sends `mode`**

Change the `triggerStylist` signature and the invoke body (~line 654, ~line 668):
```ts
  const triggerStylist = useCallback(async (mode?: 'outfit') => {
```
```ts
        const { data, error } = await supabase.functions.invoke('style-up-chat', { body: { threadId, mode } });
```
(All existing no-arg callers — the retry button, the `else` branch, the `askScene` fallback — keep working; `mode` is `undefined`, which the edge fn reads as no mode.)

- [ ] **Step 3: Route the outfit ask on the dial**

In `send()` (~line 872), change the `wantsFullOutfit` branch:
```ts
    else if (wantsFullOutfit(text)) {
      if (engineMethod === 'style_engine') void triggerStylist('outfit');
      else void startOutfitFlow();
    }
```
Add `engineMethod` to the `send` `useCallback` dependency array.

- [ ] **Step 4: Thread the method into swap recommendations**

In `recOpts` (~line 529-533), add `engineMethod` to the returned object and the dep array:
```ts
  const recOpts = useCallback((): RecommendOpts => {
    const p = prefsRef.current;
    const styleText = [ctx?.style, ...(ctx?.chips ?? [])].filter(Boolean).join(' ');
    return { budgetMax: p.budgetMax, occasion: p.occasion, formality: p.formality, avoidColors: p.avoidColors, simpler: p.simpler, styleText, engineMethod };
  }, [ctx, engineMethod]);
```
(`handleSwapRequest` and `onChoose('slots')` already call `recOpts()`, so the swap picker and the legacy slot recommender both receive `engineMethod` automatically.)

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add app/components/style-up/StyleUpExperience.tsx
git commit -m "feat(style-up): outfit ask routes to engine (mode) in engine mode, chooser in legacy"
```

---

### Task 6: Full-look bar + optional piece selection (engine mode)

**Files:**
- Modify: `app/components/style-up/StyleUpExperience.tsx` (state near other `useState`; `onChoose('scene')` ~line 779-783; JSX before `.su-composer` ~line 1470)
- Modify: `app/styles/style-up.css` (append look-bar styles)

**Interfaces:**
- Consumes: `assembleLook()`, `askScene()`, `generateFullLook()`, `engineMethod` (existing/Task 5).
- Produces: `lookSelection` state, `selectedLook()`; a sticky look bar rendered in engine mode when the look has ≥2 pieces.

- [ ] **Step 1: Add selection state + `selectedLook`**

Near the other `useState` declarations in the component, add:
```ts
  const [lookSelection, setLookSelection] = useState<Set<string> | null>(null); // null = all pieces
  const [pickingLook, setPickingLook] = useState(false);
```
After `assembleLook` (~line 733), add:
```ts
  // The look to render on the shopper: assembleLook() minus any pieces the
  // shopper unticked in "Choose pieces". null selection = all pieces.
  const selectedLook = useCallback((): StyleUpProductRef[] =>
    assembleLook().filter(p => !lookSelection || (p.id != null && lookSelection.has(p.id))),
    [assembleLook, lookSelection]);
  // A fresh suggestion resets the selection back to "all".
  const lookIdsKey = lookPicks().map(p => p.id).join(',');
  useEffect(() => { setLookSelection(null); setPickingLook(false); }, [lookIdsKey]);
```

- [ ] **Step 2: Route the full-look render through `selectedLook()`**

In `onChoose` (~line 782), change the scene branch to use `selectedLook()` (defaults to all, so legacy/full behavior is unchanged):
```ts
    if (kind === 'scene') {
      const scene = values[0];
      setChosenScene(scene);
      await generateFullLook(selectedLook(), scene);
      return;
    }
```
Add `selectedLook` to the `onChoose` dependency array (replace `assembleLook` there is not required — keep both).

- [ ] **Step 3: Render the sticky look bar**

Insert immediately before `<div className="su-composer">` (~line 1471):
```tsx
        {engineMethod === 'style_engine' && assembleLook().length >= 2 && (
          <div className="su-lookbar">
            <div className="su-lookbar-row">
              <span className="su-lookbar-title">Your look · {selectedLook().length} piece{selectedLook().length === 1 ? '' : 's'}</span>
              <div className="su-lookbar-actions">
                <button type="button" className="su-lookbar-btn" onClick={() => setPickingLook(v => !v)}>
                  {pickingLook ? 'Done' : 'Choose pieces'}
                </button>
                <button
                  type="button"
                  className="su-lookbar-btn su-lookbar-btn--primary"
                  disabled={selectedLook().length === 0 || genLook || pendingRender}
                  onClick={() => void askScene()}
                >
                  See it on me
                </button>
              </div>
            </div>
            {pickingLook && (
              <div className="su-lookbar-pieces">
                {assembleLook().map(p => {
                  const on = !lookSelection || (p.id != null && lookSelection.has(p.id));
                  return (
                    <button
                      key={p.id || p.name}
                      type="button"
                      className={`su-lookbar-piece${on ? ' su-lookbar-piece--on' : ''}`}
                      onClick={() => {
                        if (!p.id) return;
                        setLookSelection(prev => {
                          const base = prev ?? new Set(assembleLook().map(x => x.id).filter((x): x is string => !!x));
                          const next = new Set(base);
                          if (next.has(p.id!)) next.delete(p.id!); else next.add(p.id!);
                          return next;
                        });
                      }}
                    >
                      {on ? '✓ ' : ''}{roleTagFromName(p.name ?? null) || p.name || 'Piece'}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
```

- [ ] **Step 4: Add the look-bar styles**

Append to `app/styles/style-up.css`:
```css
/* Full-look bar (engine mode): render the whole suggested look, optionally
   dropping pieces. Sits above the composer. */
.su-lookbar { border-top: 1px solid rgba(255,255,255,.08); padding: 10px 14px; background: rgba(0,0,0,.25); }
.su-lookbar-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.su-lookbar-title { font-size: 13px; font-weight: 600; color: #e8e8ec; }
.su-lookbar-actions { display: flex; gap: 8px; }
.su-lookbar-btn { font-size: 13px; font-weight: 600; padding: 7px 14px; border-radius: 999px;
  border: 1px solid rgba(255,255,255,.18); background: transparent; color: #e8e8ec; cursor: pointer; }
.su-lookbar-btn--primary { background: var(--su-accent, #8aa0c0); border-color: transparent; color: #0a0a0a; }
.su-lookbar-btn:disabled { opacity: .5; cursor: default; }
.su-lookbar-pieces { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.su-lookbar-piece { font-size: 12px; padding: 6px 12px; border-radius: 999px;
  border: 1px solid rgba(255,255,255,.18); background: transparent; color: #aaa; cursor: pointer; }
.su-lookbar-piece--on { color: #0a0a0a; background: #e8e8ec; border-color: transparent; }
```

- [ ] **Step 5: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: no errors; build succeeds.

- [ ] **Step 6: Manual A/B verification (local, logged-in Chrome)**

Start the dev server (`/style` route). With the dial at **style_engine** (`/admin/dials`):
1. In Lena, send "put together a smart casual dinner outfit" → engine product cards appear, **no "Build your outfit" chooser**. Confirm via `select payload->>'candidate_count', payload->>'source_mode' from style_up_traces order by created_at desc limit 1;` (engine pool, not 120) and the `[style-up-chat] … retrieval=ENGINE … mode=outfit` log line format.
2. The look bar shows "Your look · N pieces" with **See it on me** + **Choose pieces**. Tap See it on me → scene chooser → full-look render. Tap Choose pieces, untick the bottom, See it on me → renders top + shoes only.

Flip the dial to **legacy**:
3. Same outfit ask → the "Build your outfit" chooser returns; picks are the 120-newest; no look bar. Confirms the A/B split on screen.

Reset the dial to `style_engine` when done.

- [ ] **Step 7: Commit**

```bash
git add app/components/style-up/StyleUpExperience.tsx app/styles/style-up.css
git commit -m "feat(style-up): full-look See it on me bar with optional piece selection (engine mode)"
```

---

## Self-Review

**Spec coverage:**
- Dial (storage/service/hook/admin/server read) → Tasks 1, 2, 3. ✓
- Behavior matrix: typed (edge fn branch, Task 3), outfit (Task 5 + 3 mode), swap (Task 4), See-it-on-me (Task 6). ✓
- No deletions / revert by dial → enforced in Tasks 3–6 (branches, not removals). ✓
- Web stylists unaffected → `!isWeb` guards kept (Task 3); swap web path untouched (Task 4). ✓
- Full-look bar engine-mode only, ≥2 pieces, Choose pieces → Task 6. ✓

**Placeholder scan:** none — every code step has literal content.

**Type consistency:** `StylistEngineMethod` defined in Task 1, imported in Tasks 2/4/5; `parseStylistMethod`, `getStylistEngineMethod`, `setStylistEngineMethod`, `subscribeStylistEngineMethod` names consistent across tasks; `RecommendOpts.engineMethod` defined in Task 4 and set in Task 5; `SwapRow`/`slotSearch` defined and consumed in Task 4; `selectedLook`/`lookSelection`/`pickingLook` defined and used within Task 6.
