# StyleUp Audit Trail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every StyleUp generation readable as its real recorded step sequence, and make every product the stylist showed traceable back to the query, slot, and rank that pulled it.

**Architecture:** Two halves that share no code. The **generation half is pure read-side** — `generation_events` already holds a timestamped step log written by `generate-look` and `fal-webhook`; the work is a pure mapper plus a page that renders it, retroactive over 120 of 135 generations. The **retrieval half is write-then-read** — `_shared/style-retrieval.ts` already computes per-candidate slot/score and knows which query-fallback tier fired, but `style-up-chat` drops it before writing the trace; the work is to keep it, then surface it. Traces predating capture get a non-storing replay function.

**Tech Stack:** Remix v2 SPA (client-only, no loaders) + React 19 + vanilla CSS, Supabase Postgres + Deno edge functions, vitest for unit tests.

**Spec:** [`docs/superpowers/specs/2026-08-20-styleup-audit-trail-design.md`](../specs/2026-08-20-styleup-audit-trail-design.md)

## Global Constraints

- Branch is `dev`. Commit directly to `dev`. Never create feature branches. Never force-push. `git fetch origin dev && git rebase origin/dev` before every push.
- **Do NOT add `user_generations.submitted_at`.** An earlier spec draft proposed it; `generation_events.fal_submit_ok.created_at` already is that timestamp (116 historical rows). The spec marks it superseded.
- **Applying migrations is the CONTROLLER's job**, via the Supabase MCP `apply_migration`. An implementer writes the migration FILE and stops. Do NOT run `supabase db push`, `migration up`, or `migration repair` — the repo and remote deliberately disagree on version strings (CLAUDE.md §7).
- Edge functions deploy with `node scripts/deploy-edge.mjs <name>` — never by hand-pasting into the dashboard.
- Admin routes are defined **manually** in `vite.config.ts` (`ignoredRouteFiles: ["routes/admin/**"]`). A new route file does nothing until registered there.
- Every admin surface in this plan is **read-only**. Nothing here writes shopper-visible data or mutates a generation.
- Provenance capture is best-effort. A bug in recording must never fail a shopper's turn — it stays inside the existing `try` that wraps the trace insert.
- Reconstructions are **never stored**. See Task 7.
- All new files under `app/routes/admin/` or `app/components/style-up/` land in the `admin` rollup chunk automatically. Do not put anything from this plan in `app/utils/` — that path is pinned to `app-core`, which ships on every consumer page load.
- Run `npx tsc --noEmit` and `npx vitest run` before every commit.

## File Structure

**Created:**

| File | Responsibility |
|---|---|
| `supabase/migrations/20260820000000_generation_events_catchup.sql` | Records the live `generation_events` shape in the repo. `if not exists` throughout. |
| `app/components/style-up/admin-format.ts` | `fmtTime`, `fmtElapsed`, `statusClass`. Shared by four admin surfaces; kills the current route→route import. |
| `app/services/generation-spine.ts` | **Pure.** `eventsToNodes(events) → SpineNode[]`. No Supabase import, so its test has zero deps. |
| `app/services/generation-spine.test.ts` | Pins the mapper, especially the unknown-event fallback. |
| `app/components/style-up/GenerationDiagram.tsx` | The Input → Model → Output graph, extracted verbatim from `admin/style.tsx`. |
| `app/routes/admin/style.g.$generationId.tsx` | The generation audit page: spine + diagram. |
| `app/services/style-retrieval-tier.test.ts` | Pins which query-fallback tier gets recorded. |
| `supabase/functions/style-retrace/index.ts` | Replays retrieval for a pre-capture trace. Returns, never stores. |
| `app/styles/admin-style-up.css` (append) | Spine + provenance styles. |

**Modified:**

| File | Change |
|---|---|
| `supabase/functions/_shared/style-retrieval.ts` | Return `{ cands, slots }`; add `rank`; record `tier`. |
| `supabase/functions/style-up-chat/index.ts:179,372` | Stop dropping slot/score; write `retrieval` into the trace payload. |
| `app/services/user-generations.ts` | Add `listGenerationEvents(id)`. |
| `app/services/style-up.ts` | Add `adminGetGenerationThread(id)`, provenance types. |
| `app/routes/admin/style.tsx` | Retire the modal; link rows to the new page; import formatters from the new module. |
| `app/routes/admin/style.$threadId.tsx` | Per-item "why"; render-bubble audit link; import formatters from the new module. |
| `app/components/style-up/StyleUpTraceDiagram.tsx` | Expandable candidate pool + per-slot table. |
| `vite.config.ts` | Register `style/g/:generationId`. |

---

### Task 1: Record the `generation_events` shape in the repo

`generation_events` exists live and is written by two edge functions, but has **no migration file** — it was created out-of-band. This task makes the repo the source of truth. It writes no data.

**Files:**
- Create: `supabase/migrations/20260820000000_generation_events_catchup.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: the `generation_events_gen_created_idx` index that Task 3's page query relies on.

- [ ] **Step 1: Write the migration file**

```sql
-- generation_events already exists in the live project (611 rows since
-- 2026-05-01) but was created out-of-band, so the repo has never recorded its
-- shape. This is a catch-up: `if not exists` throughout, so applying it against
-- the live database is a no-op that only writes the definition into the repo's
-- migration history. No data is created, altered, or deleted.
--
-- Written by supabase/functions/generate-look/index.ts (submit_attempt,
-- image_rehost_faces, image_rehost_products, image_preflight,
-- seedance_face_grid, fal_submit_ok, fal_submit_fail, fal_submit_fallback,
-- fal_submit_fallback_skipped, content_policy_fallback) and
-- supabase/functions/fal-webhook/index.ts (fal_webhook, content_policy_fallback).
-- watchdog_timeout and name_look_fail come from the reconciler / naming paths.

create table if not exists public.generation_events (
  id            bigserial primary key,
  generation_id uuid not null references public.user_generations(id) on delete cascade,
  event         text not null,
  payload       jsonb,
  created_at    timestamptz not null default now()
);

-- The admin audit page reads one generation's events in time order. Without
-- this the spine query is a full scan of the table.
create index if not exists generation_events_gen_created_idx
  on public.generation_events (generation_id, created_at);

alter table public.generation_events enable row level security;

-- Admin-only read. The edge functions that write this table use the service
-- role, which bypasses RLS, so no insert policy is needed.
--
-- `(select auth.uid())` rather than a bare `auth.uid()` is deliberate and is the
-- house pattern (see the "admins read pipeline_events" policy): the subquery form
-- is evaluated once per statement instead of once per row.
drop policy if exists "admins read generation events" on public.generation_events;
create policy "admins read generation events"
  on public.generation_events for select
  using (exists (select 1 from public.profiles me
                 where me.id = (select auth.uid()) and me.is_admin));
```

- [ ] **Step 2: (Already verified — no action, read and continue)**

Checked against the live database while this plan was written, so do not re-derive:
`profiles.is_admin` exists and the predicate above is copied from the existing
"admins read pipeline_events" policy. `user_generation_products` and
`user_generation_uploads` each carry a separate `_admin_read` SELECT policy, so the
`is_ai = true` gate on their ALL policies does not restrict the audit page's reads.

- [ ] **Step 3: STOP — hand off to the controller**

Do not apply the migration. Report the file path. The controller applies it via `mcp__supabase__apply_migration` and runs the verification below.

- [ ] **Step 4: (Controller) Verify the table is unchanged and readable**

```sql
select count(*) as rows, count(distinct generation_id) as gens from generation_events;
```
Expected: `rows` ≥ 611, `gens` ≥ 120 — i.e. unchanged. If either dropped, the migration was not a no-op; stop and investigate.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260820000000_generation_events_catchup.sql
git commit -m "chore(db): record generation_events shape in the repo

The table exists live and is written by generate-look and fal-webhook,
but had no migration file. Catch-up only: create-if-not-exists plus the
(generation_id, created_at) index the admin audit page needs. No data
is written or altered."
```

---

### Task 2: The spine mapper

A pure function turning stored events into renderable nodes. No Supabase import, so the test has zero dependencies. The unknown-event branch is the important one: it is the guarantee that a newly added edge-function event can never silently vanish from an audit surface.

**Files:**
- Create: `app/services/generation-spine.ts`
- Test: `app/services/generation-spine.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `GenerationEvent`, `SpineNode`, `eventsToNodes(events: GenerationEvent[]): SpineNode[]`. Task 3 renders `SpineNode[]`.

- [ ] **Step 1: Write the failing test**

Create `app/services/generation-spine.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { eventsToNodes, type GenerationEvent } from './generation-spine';

const ev = (event: string, payload: Record<string, unknown> | null, at: string): GenerationEvent =>
  ({ id: 1, event, payload, createdAt: at });

describe('eventsToNodes (generation audit spine)', () => {
  it('maps a known event to its label and a payload-derived summary', () => {
    const [n] = eventsToNodes([
      ev('fal_submit_ok', { request_id: 'req_8f2a1c4b9d0e', model: 'bytedance/seedance-2.5', duration_seconds: 10 }, '2026-08-14T15:58:53Z'),
    ]);
    expect(n.label).toBe('Submitted to Fal');
    expect(n.summary).toContain('bytedance/seedance-2.5');
    expect(n.summary).toContain('req_8f2a1c4b9d');
    expect(n.failed).toBe(false);
  });

  it('still renders an UNKNOWN event rather than dropping it', () => {
    // The guarantee: a new event type added to an edge function shows up in the
    // audit without a UI change. Silently dropping it would make the spine lie.
    const [n] = eventsToNodes([ev('some_future_step', { detail: 'hello' }, '2026-08-14T15:58:00Z')]);
    expect(n).toBeDefined();
    expect(n.label).toBe('some_future_step');
    expect(n.summary).toContain('hello');
  });

  it('marks failure events failed', () => {
    const nodes = eventsToNodes([
      ev('fal_submit_fail', { error: 'FAL_KEY missing' }, '2026-08-14T15:58:00Z'),
      ev('watchdog_timeout', { reason: 'no webhook after 15m' }, '2026-08-14T16:13:00Z'),
      ev('name_look_fail', { error: 'timeout' }, '2026-08-14T16:14:00Z'),
    ]);
    expect(nodes.map(n => n.failed)).toEqual([true, true, true]);
    expect(nodes[0].summary).toContain('FAL_KEY missing');
  });

  it('summarises a re-host batch as count plus total size', () => {
    const [n] = eventsToNodes([
      ev('image_rehost_faces', { stats: [{ bytes: 238923 }, { bytes: 111077 }] }, '2026-08-14T15:58:45Z'),
    ]);
    expect(n.label).toBe('Faces re-hosted');
    expect(n.summary).toBe('2 images · 342 KB');
  });

  it('orders by createdAt and gives every node a stable unique key', () => {
    const nodes = eventsToNodes([
      ev('fal_webhook', { status: 'done' }, '2026-08-14T16:03:17Z'),
      ev('submit_attempt', { fal_model: 'm', face_count: 1, product_count: 3 }, '2026-08-14T15:58:42Z'),
    ]);
    expect(nodes.map(n => n.event)).toEqual(['submit_attempt', 'fal_webhook']);
    expect(new Set(nodes.map(n => n.key)).size).toBe(2);
  });

  it('produces no nodes for an empty log, so the page can show its own empty state', () => {
    expect(eventsToNodes([])).toEqual([]);
  });

  it('survives a null payload', () => {
    const [n] = eventsToNodes([ev('seedance_face_grid', null, '2026-08-14T15:58:52Z')]);
    expect(n.label).toBe('Face grid built');
    expect(n.summary).toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/services/generation-spine.test.ts`
Expected: FAIL — `Failed to resolve import "./generation-spine"`.

- [ ] **Step 3: Write the implementation**

Create `app/services/generation-spine.ts`:

```ts
// generation-spine — turns the stored generation_events log into renderable
// audit nodes for /admin/style/g/:generationId.
//
// PURE by design: no Supabase import, so the mapper is unit-testable with zero
// setup and the fetch lives in user-generations.ts instead.
//
// Every label and summary below is keyed off payload fields that the edge
// functions ACTUALLY write (verified against all 611 live rows). An event with
// no entry here still renders, labelled with its raw name — that is deliberate,
// see summarize()/labelFor().

export interface GenerationEvent {
  id: number;
  event: string;
  payload: Record<string, unknown> | null;
  createdAt: string;
}

export interface SpineNode {
  key: string;
  event: string;
  label: string;
  summary: string;
  at: string;
  failed: boolean;
  payload: Record<string, unknown> | null;
}

const EVENT_LABEL: Record<string, string> = {
  submit_attempt: 'Submit attempt',
  image_rehost_faces: 'Faces re-hosted',
  image_rehost_products: 'Products re-hosted',
  image_preflight: 'Image preflight',
  seedance_face_grid: 'Face grid built',
  fal_submit_fallback: 'Model fallback',
  fal_submit_fallback_skipped: 'Fallback skipped',
  content_policy_fallback: 'Content-policy retry',
  fal_submit_ok: 'Submitted to Fal',
  fal_submit_fail: 'Submit failed',
  fal_webhook: 'Fal returned',
  watchdog_timeout: 'Watchdog timeout',
  name_look_fail: 'Naming failed',
};

// Events that represent something going wrong. The node renders in the failed
// style; the spine itself still shows them in sequence.
const FAILED_EVENTS = new Set([
  'fal_submit_fail', 'watchdog_timeout', 'name_look_fail', 'fal_submit_fallback_skipped',
]);

const str = (v: unknown): string => (v == null ? '' : String(v));
const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v ?? 0));

/** "2 images · 342 KB" from a re-host stats array. */
function rehostSummary(payload: Record<string, unknown>): string {
  const stats = Array.isArray(payload.stats) ? (payload.stats as Array<Record<string, unknown>>) : [];
  if (stats.length === 0) return '';
  const bytes = stats.reduce((a, s) => a + num(s.bytes), 0);
  return `${stats.length} image${stats.length === 1 ? '' : 's'} · ${Math.round(bytes / 1024)} KB`;
}

function summarize(event: string, payload: Record<string, unknown> | null): string {
  if (!payload) return '';
  switch (event) {
    case 'submit_attempt':
      return [str(payload.fal_model), `${num(payload.face_count)} face`, `${num(payload.product_count)} piece`]
        .filter(Boolean).join(' · ');
    case 'image_rehost_faces':
    case 'image_rehost_products':
      return rehostSummary(payload);
    case 'seedance_face_grid':
      return `${num(payload.faces)} face → ${num(payload.gridded)} grid`;
    case 'fal_submit_fallback':
      return `${str(payload.original_model)} → ${str(payload.fallback_model)}`;
    case 'fal_submit_fallback_skipped':
      return str(payload.reason) || str(payload.original_error);
    case 'content_policy_fallback':
      return `${str(payload.from)} → ${str(payload.to)}`;
    case 'fal_submit_ok':
      return [str(payload.model), `req ${str(payload.request_id).slice(0, 12)}`,
        payload.duration_seconds ? `${num(payload.duration_seconds)}s` : '']
        .filter(Boolean).join(' · ');
    case 'fal_submit_fail':
      return str(payload.error);
    case 'fal_webhook':
      return [str(payload.status), str(payload.error_code) || str(payload.error)]
        .filter(Boolean).join(' · ');
    case 'watchdog_timeout':
      return str(payload.reason);
    case 'name_look_fail':
      return str(payload.error);
    default: {
      // Unknown event — never drop it. Show enough of the payload that an
      // operator can tell what happened, and the raw JSON is one click away.
      const json = JSON.stringify(payload);
      return json.length > 80 ? `${json.slice(0, 80)}…` : json;
    }
  }
}

/** Known events get a written label; anything else keeps its raw event string. */
function labelFor(event: string): string {
  return EVENT_LABEL[event] ?? event;
}

export function eventsToNodes(events: GenerationEvent[]): SpineNode[] {
  return [...events]
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map(e => ({
      key: `${e.id}:${e.event}`,
      event: e.event,
      label: labelFor(e.event),
      summary: summarize(e.event, e.payload),
      at: e.createdAt,
      failed: FAILED_EVENTS.has(e.event),
      payload: e.payload,
    }));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run app/services/generation-spine.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add app/services/generation-spine.ts app/services/generation-spine.test.ts
git commit -m "feat(admin): pure mapper from generation_events to audit nodes

Turns the stored step log into renderable spine nodes. Labels and
summaries key off payload fields the edge functions actually write,
verified against all 611 live rows.

An unrecognised event still renders under its raw name rather than
being dropped, so a new edge-function event appears in the audit
without a UI change. That branch is what the test pins."
```

---

### Task 3: The generation audit page

Renders the spine, retires the modal, and shares the formatters. Retroactive over the 120 generations that already have events.

**Files:**
- Create: `app/components/style-up/admin-format.ts`
- Create: `app/components/style-up/GenerationDiagram.tsx`
- Create: `app/routes/admin/style.g.$generationId.tsx`
- Modify: `app/services/user-generations.ts`, `app/services/style-up.ts`
- Modify: `app/routes/admin/style.tsx`, `app/routes/admin/style.$threadId.tsx`
- Modify: `vite.config.ts`, `app/styles/admin-style-up.css`

**Interfaces:**
- Consumes: `eventsToNodes`, `SpineNode`, `GenerationEvent` (Task 2).
- Produces: `listGenerationEvents(generationId): Promise<GenerationEvent[]>`; `adminGetGenerationThread(generationId): Promise<{ threadId, shopperName, stylistName } | null>`; `fmtTime`, `fmtElapsed`, `statusClass` from `~/components/style-up/admin-format`.

- [ ] **Step 1: Extract the shared formatters**

Create `app/components/style-up/admin-format.ts`. Move these **verbatim** out of `app/routes/admin/style.tsx` (they currently live at the top of that file, and `style.$threadId.tsx` imports two of them *from the route module* — a route→route import this removes):

```ts
// Formatting shared by the admin StyleUp surfaces: the conversation index,
// a single conversation, and the generation audit page. Lives here rather than
// in a route module so no route has to import another route, and outside
// app/utils/ so it stays in the `admin` rollup chunk.

export function fmtTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function statusClass(s: string): string {
  if (s === 'done') return 'sua-pill sua-pill--done';
  if (s === 'failed') return 'sua-pill sua-pill--failed';
  return 'sua-pill sua-pill--pending';
}

/** Seconds between two timestamps, pretty-printed ("74s" / "2m 3s"). */
export function fmtElapsed(fromIso: string | null, toIso: string | null): string {
  if (!fromIso || !toIso) return '—';
  const s = Math.round((new Date(toIso).getTime() - new Date(fromIso).getTime()) / 1000);
  if (!Number.isFinite(s) || s < 0) return '—';
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}
```

Then in `app/routes/admin/style.tsx`: delete the three local definitions and the `export` keywords added in commit `a4145886`, and import from the new module. In `app/routes/admin/style.$threadId.tsx`: replace `import { fmtTime, statusClass } from './style';` with an import from `~/components/style-up/admin-format`.

- [ ] **Step 2: Extract `GenerationDiagram`**

Create `app/components/style-up/GenerationDiagram.tsx`. Move, **unchanged in behaviour**, out of `app/routes/admin/style.tsx`: the `gCard` / `gLabel` / `gKv` / `gKvVal` / `gArrow` style consts, `SLOT_ORDER`, `sortHeadToToe`, and the `GenerationDiagram` component. Its imports become:

```tsx
import { roleTagFromName } from '~/services/product-roles';
import type { AdminLook } from '~/services/style-up';
import type { UserGeneration, UserUpload } from '~/services/user-generations';
import { fmtTime, fmtElapsed } from './admin-format';
```

Export it as the default. Delete all of it from `style.tsx`, which sheds roughly 90 lines.

- [ ] **Step 3: Add the two fetches**

In `app/services/user-generations.ts`, append:

```ts
import type { GenerationEvent } from './generation-spine';

/** Admin: the recorded step log for one generation, oldest first. Empty for
 *  the 15 generations that predate event capture (2026-05-01). */
export async function listGenerationEvents(generationId: string): Promise<GenerationEvent[]> {
  if (!supabase || !generationId) return [];
  const { data } = await supabase
    .from('generation_events')
    .select('id, event, payload, created_at')
    .eq('generation_id', generationId)
    .order('created_at', { ascending: true });
  return ((data ?? []) as Array<Record<string, unknown>>).map(r => ({
    id: Number(r.id),
    event: String(r.event),
    payload: (r.payload as Record<string, unknown> | null) ?? null,
    createdAt: String(r.created_at),
  }));
}
```

In `app/services/style-up.ts`, append near the other `admin*` helpers:

```ts
/** Admin: the conversation a generation came out of, if any. Used by the audit
 *  page's back link — generations started from /generate have no thread. */
export async function adminGetGenerationThread(
  generationId: string,
): Promise<{ threadId: string; shopperName: string; stylistName: string | null } | null> {
  if (!supabase || !generationId) return null;
  // maybeSingle() is safe here: render_generation_id is a uuid column and no
  // generation is referenced by more than one message (verified across all rows).
  const { data: msg } = await supabase
    .from('style_up_messages')
    .select('thread_id')
    .eq('render_generation_id', generationId)
    .maybeSingle();
  if (!msg) return null;
  const head = await adminGetThread(String(msg.thread_id));
  if (!head) return null;
  return { threadId: head.threadId, shopperName: head.shopper.name, stylistName: head.stylist.name || null };
}
```

- [ ] **Step 4: Write the page**

Create `app/routes/admin/style.g.$generationId.tsx`:

```tsx
// Admin · one generation, as its recorded step sequence.
//
// The nodes are NOT derived — generation_events already holds a timestamped log
// written by generate-look and fal-webhook, going back to 2026-05-01. This page
// reads it. Gaps between nodes are log-scaled so a stall is visible before you
// read a number (same idiom as admin/pipeline.product.$id.tsx).

import { useEffect, useState } from 'react';
import { Link, useParams } from '@remix-run/react';
import { getGenerationDetail, listGenerationEvents, type UserGeneration, type UserUpload } from '~/services/user-generations';
import { adminGetGenerationThread } from '~/services/style-up';
import { eventsToNodes, type SpineNode } from '~/services/generation-spine';
import { fmtTime, fmtElapsed, statusClass } from '~/components/style-up/admin-format';
import GenerationDiagram from '~/components/style-up/GenerationDiagram';
import type { AdminLook } from '~/services/style-up';
import '~/styles/admin-style-up.css';

// Real gaps run from ~1s of preprocessing to ~5min of model time. Linear
// spacing would flatten the preprocessing steps into one line, so map log10 of
// the wait onto 12–140px — identical to pipeline.product.$id.tsx's gapPx.
function gapPx(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return 12;
  return Math.min(140, Math.max(12, Math.round(14 * Math.log10(1 + seconds))));
}

function gapSeconds(fromIso: string, toIso: string): number {
  return (new Date(toIso).getTime() - new Date(fromIso).getTime()) / 1000;
}

function fmtWait(seconds: number): string {
  if (seconds < 1) return 'instant';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

function SpineRow({ node, prev }: { node: SpineNode; prev: SpineNode | null }) {
  const [open, setOpen] = useState(false);
  const wait = prev ? gapSeconds(prev.at, node.at) : 0;
  // The one gap worth naming: everything before Fal accepted the job is our own
  // preprocessing; everything after is the model.
  const isModelTime = prev?.event === 'fal_submit_ok' && node.event === 'fal_webhook';
  return (
    <>
      {prev && (
        <li className="gsp-gap" style={{ height: gapPx(wait) }}>
          <span className="gsp-gap-label">{fmtWait(wait)}{isModelTime ? ' · model time' : ''}</span>
        </li>
      )}
      <li className={`gsp-node${node.failed ? ' is-failed' : ''}`}>
        <span className="gsp-dot" aria-hidden="true" />
        <button type="button" className="gsp-card" onClick={() => setOpen(o => !o)}>
          <span className="gsp-label">{node.label}</span>
          <span className="gsp-summary">{node.summary}</span>
          <span className="gsp-at">{fmtTime(node.at)}</span>
        </button>
        {open && <pre className="gsp-payload">{JSON.stringify(node.payload, null, 2)}</pre>}
      </li>
    </>
  );
}

export default function AdminGenerationAudit() {
  const { generationId = '' } = useParams();
  const [gen, setGen] = useState<UserGeneration | null>(null);
  const [uploads, setUploads] = useState<UserUpload[]>([]);
  const [nodes, setNodes] = useState<SpineNode[]>([]);
  const [origin, setOrigin] = useState<{ threadId: string; shopperName: string; stylistName: string | null } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!generationId) return;
    let cancelled = false;
    void (async () => {
      const [detail, events, from] = await Promise.all([
        getGenerationDetail(generationId),
        listGenerationEvents(generationId),
        adminGetGenerationThread(generationId),
      ]);
      if (cancelled) return;
      setGen(detail.generation);
      setUploads(detail.uploads);
      setNodes(eventsToNodes(events));
      setOrigin(from);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [generationId]);

  if (loading) return <div className="sua"><div className="sua-empty">Loading generation…</div></div>;
  if (!gen) return <div className="sua"><div className="sua-empty">That generation no longer exists.</div></div>;

  // GenerationDiagram takes an AdminLook; the audit page has the generation
  // itself, so build the minimum shape it reads.
  const look: AdminLook = {
    messageId: '', threadId: origin?.threadId ?? '', generationId,
    status: gen.status, videoUrl: gen.video_url, createdAt: gen.created_at,
    shopper: { id: gen.user_id, name: origin?.shopperName ?? 'Shopper', avatarUrl: null },
    stylist: null, products: [],
  };

  return (
    <div className="sua">
      <Link to={origin ? `/admin/style/${origin.threadId}` : '/admin/style?tab=generations'} className="suc-back">
        ← {origin ? `${origin.shopperName}${origin.stylistName ? ` with ${origin.stylistName}` : ''}` : 'Generations'}
      </Link>

      <div className="suc-head">
        <div className="suc-head-id">
          <h1 className="sua-title">{gen.display_name || 'Generation'}</h1>
          <p className="sua-sub">
            {gen.veo_model || gen.model} · {gen.duration_seconds}s · started {fmtTime(gen.created_at)}
            {gen.completed_at && ` · took ${fmtElapsed(gen.created_at, gen.completed_at)}`}
          </p>
        </div>
        <span className={statusClass(gen.status)}>{gen.status}</span>
      </div>

      <h2 className="gsp-title">Step sequence</h2>
      {nodes.length === 0 ? (
        <div className="sua-empty">
          No step log — this render predates event capture (2026-05-01).
        </div>
      ) : (
        <ol className="gsp-spine">
          {nodes.map((n, i) => <SpineRow key={n.key} node={n} prev={i > 0 ? nodes[i - 1] : null} />)}
        </ol>
      )}

      <h2 className="gsp-title">Inputs, model, output</h2>
      <GenerationDiagram look={look} gen={gen} uploads={uploads} />
    </div>
  );
}
```

- [ ] **Step 5: Register the route**

In `vite.config.ts`, immediately after the `style/:threadId` line added in `a4145886`:

```ts
            // One generation's recorded step sequence. Three segments, so it
            // cannot collide with the two-segment style/:threadId.
            route("style/g/:generationId", "routes/admin/style.g.$generationId.tsx");
```

- [ ] **Step 6: Retire the modal and link to the page**

In `app/routes/admin/style.tsx`:
- Delete the `openLook` / `openGen` / `openUploads` state, the `openGeneration` callback, and the entire `{openLook && (…)}` modal block.
- Delete the now-unused `getGenerationDetail` / `UserGeneration` / `UserUpload` imports.
- Change the generations table row from `<tr … onClick={() => void openGeneration(r.look)}>` to a row whose cells sit inside a link. Keep it a `<tr>` for table semantics and navigate with `useNavigate`, since an `<a>` cannot wrap `<td>`s:

```tsx
<tr key={r.messageId} className="sua-table-row"
    onClick={() => navigate(`/admin/style/g/${r.look.generationId}`)}>
```

Guard the rows with no generation id — `AdminLook.generationId` is nullable:

```tsx
onClick={() => { if (r.look.generationId) navigate(`/admin/style/g/${r.look.generationId}`); }}
```

Re-add `useNavigate` to the `@remix-run/react` import.

In `app/routes/admin/style.$threadId.tsx`, give the render bubble an audit link. In `RenderBubble`, take the generation id as a prop and add below `.suc-render-foot`:

```tsx
{genId && <Link className="suc-render-audit" to={`/admin/style/g/${genId}`}>audit →</Link>}
```

- [ ] **Step 7: Add the styles**

Append to `app/styles/admin-style-up.css`:

```css
/* ── Generation audit spine (admin/style.g.$generationId) ────────────────── */
.gsp-title { margin: 28px 0 12px; font-size: 15px; font-weight: 800; letter-spacing: -0.01em; }
.gsp-spine { list-style: none; margin: 0; padding: 0 0 0 6px; }
.gsp-gap { position: relative; margin-left: 5px; border-left: 2px solid #e4e6ea; display: flex; align-items: center; }
.gsp-gap-label { padding-left: 14px; font-size: 11px; color: #9aa0a8; }
.gsp-node { position: relative; display: flex; align-items: flex-start; gap: 10px; flex-wrap: wrap; }
.gsp-dot { flex: 0 0 auto; margin-top: 13px; width: 12px; height: 12px; border-radius: 50%; background: #14151a; }
.gsp-node.is-failed .gsp-dot { background: #b4453a; }
.gsp-card { flex: 1 1 auto; min-width: 0; display: flex; align-items: baseline; gap: 10px; padding: 10px 12px;
  border: 1px solid #e4e6ea; border-radius: 12px; background: #fff; text-align: left; cursor: pointer; }
.gsp-node.is-failed .gsp-card { border-color: #f0c9c4; background: #fdf6f5; }
.gsp-label { flex: 0 0 auto; font-size: 13px; font-weight: 800; }
.gsp-summary { flex: 1 1 auto; min-width: 0; font-size: 12px; color: #6b7280;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gsp-at { flex: 0 0 auto; font-size: 11px; color: #9aa0a8; }
.gsp-payload { flex: 1 1 100%; margin: 6px 0 0 22px; padding: 10px; border-radius: 8px; background: #f7f8fa;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; line-height: 1.5;
  white-space: pre-wrap; word-break: break-word; max-height: 320px; overflow-y: auto; }
.suc-render-audit { display: inline-block; padding: 0 10px 8px; font-size: 11.5px; font-weight: 700;
  color: #6b7280; text-decoration: none; }
.suc-render-audit:hover { color: #14151a; }

.admin-dark .gsp-card { background: #17181c; border-color: #26282d; }
.admin-dark .gsp-node.is-failed .gsp-card { background: #1c1517; border-color: #4a2a26; }
.admin-dark .gsp-dot { background: #e7e7ea; }
.admin-dark .gsp-gap { border-color: #2a2c31; }
.admin-dark .gsp-payload { background: #0d0e10; color: #c7c9cf; }
.admin-dark .suc-render-audit { color: #8b8e96; }
```

- [ ] **Step 8: Typecheck, test, build**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: no type errors, all tests pass, build succeeds.

- [ ] **Step 9: Verify against a real generation**

Open `/admin/style?tab=generations`, click a row from August 2026. Confirm: six nodes appear, the `fal_submit_ok → fal_webhook` gap is labelled "model time" and is visibly the tallest, a node expands to raw JSON, and the back link returns to the originating conversation. Then open a generation from before 2026-05-01 and confirm the "no step log" band renders instead of an empty spine.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat(admin): generation audit page reading the real step log

/admin/style/g/:generationId renders one node per generation_events row
with log-scaled gaps, so a stall is visible before you read a number.
The fal_submit_ok -> fal_webhook gap is called out as model time;
everything before it is our own preprocessing.

Retires the generation modal on /admin/style in favour of the page, and
extracts GenerationDiagram plus the shared formatters out of the route
module (style.\$threadId.tsx was importing two of them from style.tsx).

Retroactive over the 120 generations that already have events; the 15
older ones show an explicit no-step-log band rather than an inferred
timeline."
```

---

### Task 4: Keep the retrieval provenance

`_shared/style-retrieval.ts` already computes slot and score and already knows which query-fallback tier fired. This task stops throwing it away. TDD: the tier branch is the logic the whole feature reports on.

**Files:**
- Modify: `supabase/functions/_shared/style-retrieval.ts`
- Test: `app/services/style-retrieval-tier.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `retrieveOccasionCandidates()` now returns `RetrievalResult = { cands: OccasionCand[]; slots: SlotDiag[] }` instead of `OccasionCand[]`. `OccasionCand` gains `rank: number`. Task 5 consumes both.

- [ ] **Step 1: Write the failing test**

Create `app/services/style-retrieval-tier.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
// Cross-boundary import, same as style-retrieval-rotate.test.ts: the edge helper
// is pure TS with no Deno imports, so it is testable from the app's vitest run.
import { retrieveOccasionCandidates } from '../../supabase/functions/_shared/style-retrieval';

/** A style_slot_search row as the RPC returns it. */
const row = (id: string, score = 1) => ({
  product_id: id, product_name: `Item ${id}`, product_brand: 'B', product_price: '10',
  product_image_url: 'http://img', product_url: 'http://u', product_type: 'shirt',
  product_gender: 'unisex', score,
});

/** Records every rpc call and replays a scripted queue of responses per slot. */
function stubClient(script: Array<{ data: unknown; error: unknown }>) {
  const calls: Array<Record<string, unknown>> = [];
  let i = 0;
  return {
    calls,
    rpc(_fn: string, args: Record<string, unknown>) {
      calls.push(args);
      const res = script[Math.min(i, script.length - 1)];
      i += 1;
      return Promise.resolve(res);
    },
  };
}

// One slot only, so the call script is unambiguous: a male shopper drops
// 'dresses', so restrict further by asking for a single slot via kPerSlot and
// reading only the 'tops' diagnostic out of the result.
const OPTS = { occasion: 'rooftop dinner', gender: 'male' as const, aesthetic: 'smart casual' };

describe('retrieveOccasionCandidates — recorded fallback tier', () => {
  it('records tier 1 when the aesthetic query returns rows', async () => {
    const c = stubClient([{ data: [row('a'), row('b')], error: null }]);
    const { slots, cands } = await retrieveOccasionCandidates(c, OPTS);
    const tops = slots.find(s => s.slot === 'tops')!;
    expect(tops.tier).toBe(1);
    expect(tops.query).toContain('smart casual');
    expect(tops.returned).toBe(2);
    expect(cands.every(x => typeof x.rank === 'number')).toBe(true);
  });

  it('records tier 2 when the aesthetic query is empty and occasion-only works', async () => {
    const c = stubClient([
      { data: [], error: null },              // tier 1 — aesthetic + occasion
      { data: [row('a')], error: null },      // tier 2 — occasion only
    ]);
    const { slots } = await retrieveOccasionCandidates(c, OPTS);
    const tops = slots.find(s => s.slot === 'tops')!;
    expect(tops.tier).toBe(2);
    expect(tops.query).not.toContain('smart casual');
  });

  it('records tier 3 when excluding shown ids emptied the slot', async () => {
    const c = stubClient([
      { data: [], error: null },              // tier 1
      { data: [], error: null },              // tier 2
      { data: [row('a')], error: null },      // tier 3 — exclude list dropped
    ]);
    const { slots } = await retrieveOccasionCandidates(c, { ...OPTS, excludeIds: ['x'], rotate: 1 });
    const tops = slots.find(s => s.slot === 'tops')!;
    expect(tops.tier).toBe(3);
    expect(tops.kept).toBe(1);
  });

  it('records the error and keeps nothing when every tier fails', async () => {
    const c = stubClient([{ data: null, error: { message: 'boom' } }]);
    const { slots, cands } = await retrieveOccasionCandidates(c, OPTS);
    const tops = slots.find(s => s.slot === 'tops')!;
    expect(tops.kept).toBe(0);
    expect(tops.error).toBe('boom');
    expect(cands).toHaveLength(0);
  });

  it('ranks candidates from 0 within their own slot', async () => {
    const c = stubClient([{ data: [row('a', 9), row('b', 5), row('c', 1)], error: null }]);
    const { cands } = await retrieveOccasionCandidates(c, OPTS);
    const tops = cands.filter(x => x.slot === 'tops');
    expect(tops.map(x => x.rank)).toEqual([0, 1, 2]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/services/style-retrieval-tier.test.ts`
Expected: FAIL — destructuring `{ slots, cands }` from an array yields `undefined`.

- [ ] **Step 3: Change the helper**

In `supabase/functions/_shared/style-retrieval.ts`:

Add `rank` to `OccasionCand` and add the two new exported types above `RpcClient`:

```ts
export interface OccasionCand {
  id: string; name: string | null; brand: string | null; price: string | null;
  image: string | null; url: string | null; type: string | null; gender: string | null;
  slot: Slot; score: number;
  /** Position within this candidate's OWN slot after rotate/trim. Lets the admin
   *  audit say "2nd of 8 in tops" as a recorded fact rather than a UI guess. */
  rank: number;
}

/** Per-slot record of what the retrieval actually did — which query ran, which
 *  fallback tier it took, and how many rows survived. This is the diagnostic
 *  that makes a collapsed slot visible; without it the only evidence is a
 *  console.log that nobody reads. */
export interface SlotDiag {
  slot: Slot;
  query: string;
  tier: 1 | 2 | 3;   // 1 aesthetic+occasion · 2 occasion only · 3 occasion, exclude ignored
  returned: number;  // rows the RPC gave back
  kept: number;      // after the women-only name filter + rotate/trim
  error: string | null;
}

export interface RetrievalResult {
  cands: OccasionCand[];
  slots: SlotDiag[];
}
```

Change the signature's return type to `Promise<RetrievalResult>`, then rewrite the `perSlot` map body so each tier records itself as it is taken:

```ts
  const perSlot = await Promise.all(slots.map(async (slot): Promise<{ rows: OccasionCand[]; diag: SlotDiag }> => {
    // style_slot_search AND-s every query term, so folding the stylist's
    // specialty into the query ("occasion red carpet … shirt") zeroes the WHOLE
    // slot when that vocab isn't in the (thin) catalog — that's why a red-carpet
    // stylist returned "no pieces" while a smart-casual one worked. Query WITH
    // the aesthetic for the bias, then fall back to the occasion alone when it
    // comes back empty, so the specialty only RANKS, never empties the pool.
    //
    // `tier` and `query` are captured AT the point each fallback is taken, not
    // reconstructed afterwards — the admin audit reports on exactly this.
    let tier: 1 | 2 | 3 = 1;
    let query = `${aesthetic} ${opts.occasion} ${SLOT_NOUN[slot]}`.trim();
    let res = await admin.rpc('style_slot_search', {
      p_query: query, p_k: fetchK, p_gender: filterGender, p_exclude_ids: exclude,
    });
    if (aesthetic && (res.error || !Array.isArray(res.data) || res.data.length === 0)) {
      tier = 2;
      query = `${opts.occasion} ${SLOT_NOUN[slot]}`.trim();
      res = await admin.rpc('style_slot_search', {
        p_query: query, p_k: fetchK, p_gender: filterGender, p_exclude_ids: exclude,
      });
    }
    // Anti-repeat exhaustion: if excluding shown ids emptied this slot (thin
    // catalog), allow repeats for THIS slot only rather than showing nothing.
    if (exclude.length > 0 && (res.error || !Array.isArray(res.data) || res.data.length === 0)) {
      tier = 3;
      query = `${opts.occasion} ${SLOT_NOUN[slot]}`.trim();
      res = await admin.rpc('style_slot_search', {
        p_query: query, p_k: fetchK, p_gender: filterGender, p_exclude_ids: [],
      });
    }
    const { data, error } = res;
    const errMsg = error ? String((error as { message?: unknown }).message ?? error) : null;
    if (error || !Array.isArray(data)) {
      return { rows: [], diag: { slot, query, tier, returned: 0, kept: 0, error: errMsg } };
    }
    const returned = data.length;
    let rows = (data as Array<Record<string, unknown>>).map((r) => ({
      id: String(r.product_id), name: (r.product_name as string) ?? null, brand: (r.product_brand as string) ?? null,
      price: (r.product_price as string) ?? null, image: (r.product_image_url as string) ?? null,
      url: (r.product_url as string) ?? null, type: (r.product_type as string) ?? null,
      gender: (r.product_gender as string) ?? null, slot, score: Number(r.score ?? 0), rank: 0,
    } as OccasionCand));
    if (gender === 'male') rows = rows.filter(c => !WOMEN_ONLY_NAME_RE.test(c.name ?? ''));
    // Rank AFTER rotate/trim so it describes the pool the model actually saw.
    const kept = rotateWithAnchors(rows, rotate, k).map((c, i) => ({ ...c, rank: i }));
    return { rows: kept, diag: { slot, query, tier, returned, kept: kept.length, error: null } };
  }));
```

Then update the flatten and the return:

```ts
  const seen = new Set<string>();
  const out: OccasionCand[] = [];
  for (const { rows } of perSlot) for (const c of rows) {
    if (seen.has(c.id)) continue;
    seen.add(c.id); out.push(c);
  }
  const diags = perSlot.map(p => p.diag);
  // Observability: proves this path (per-slot style_slot_search) produced the pool.
  console.log(
    `[style-retrieval] ENGINE via style_slot_search × ${slots.length} slots ` +
    `[${diags.map(d => `${d.slot}:${d.kept}/t${d.tier}`).join(' ')}] ` +
    `gender=${gender} exclude=${exclude.length} rotate=${rotate} ` +
    `occasion="${opts.occasion.slice(0, 80)}" -> ${out.length} unique candidates`,
  );
  return { cands: out, slots: diags };
```

- [ ] **Step 4: Fix the one caller so the project still typechecks**

`style-up-chat/index.ts:175` currently does `const found = await retrieveOccasionCandidates(…)`. Change to `const { cands: found, slots: slotDiags } = await retrieveOccasionCandidates(…)` and keep the existing `cands = found.filter(…)` line unchanged for now — Task 5 rewrites it. Declare `let slotDiags: SlotDiag[] = [];` beside `let cands` so the legacy branch also compiles, and import the type.

- [ ] **Step 5: Run all tests**

Run: `npx vitest run`
Expected: PASS — the 5 new tier tests plus the existing `rotateWithAnchors` suite (which must still pass; `rotateWithAnchors` itself is unchanged).

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/_shared/style-retrieval.ts supabase/functions/style-up-chat/index.ts app/services/style-retrieval-tier.test.ts
git commit -m "feat(stylist): retrieval records which fallback tier fired

style_slot_search runs up to three times per slot - aesthetic+occasion,
occasion alone, then occasion ignoring the exclude list. Which one fired
was the single most diagnostic fact about a turn and existed only in a
console.log. Two shipped bugs were exactly this shape.

retrieveOccasionCandidates now returns { cands, slots }: per-slot query,
tier, returned, kept, error, and a per-candidate rank within its own
slot. Nothing about the ranking or the returned pool changes."
```

---

### Task 5: Write the provenance into the trace

**Files:**
- Modify: `supabase/functions/style-up-chat/index.ts` (lines ~175-183, ~372)

**Interfaces:**
- Consumes: `RetrievalResult`, `SlotDiag` (Task 4).
- Produces: `payload.retrieval` on new `style_up_traces` rows. Task 6 reads it.

- [ ] **Step 1: Stop narrowing the candidates**

At `style-up-chat/index.ts:179`, extend `ProductCand` (line 48) with the provenance fields and stop dropping them:

```ts
interface ProductCand {
  id: string; name: string | null; brand: string | null; price: string | null;
  image_url: string | null; primary_image_url: string | null; url: string | null; type: string | null;
  // Provenance, carried through so the trace can record how each piece was
  // pulled. Null on the legacy recency scan, which has no slots or scores.
  slot?: string | null; score?: number | null; rank?: number;
}
```

```ts
      cands = found.filter(c => c.image).map(c => ({
        id: c.id, name: c.name, brand: c.brand, price: c.price,
        image_url: c.image, primary_image_url: c.image, url: c.url, type: c.type,
        slot: c.slot, score: c.score, rank: c.rank,
      }));
```

In the legacy branch, tag the rows so the UI can tell a recency scan from a ranked one:

```ts
      cands = ((candRows ?? []) as ProductCand[]).map((c, i) => ({
        ...c, slot: null, score: null, rank: i,
      }));
```

- [ ] **Step 2: Add the `retrieval` key to the trace payload**

At `style-up-chat/index.ts:372`, inside the existing payload object, immediately after `candidate_count: cands.length,`:

```ts
          // How each candidate was pulled — the slot it was retrieved for, its
          // BM25 score, its rank within that slot, and per-slot which query and
          // fallback tier produced the pool. Names and brands are STORED, not
          // joined: a product deleted after this turn would otherwise blank out
          // the audit record. ~48 rows ≈ 5 KB of jsonb per stylist turn.
          //
          // Absent on web-sourced stylists, which never run catalog retrieval
          // and record their provenance in the `searches` column instead.
          retrieval: isWeb ? null : {
            method,
            occasion,
            gender: genderNorm,
            aesthetic: stylist?.specialty ?? null,
            exclude_ids: excludeIds,
            rotate,
            slots: slotDiags,
            candidates: cands.map(c => ({
              id: c.id, name: c.name, brand: c.brand,
              slot: c.slot ?? null, score: c.score ?? null, rank: c.rank ?? null,
            })),
          },
```

`occasion`, `excludeIds`, and `rotate` are declared inside the `else if (!isWeb)` block today. Hoist all three to the same scope as `cands` (`let occasion = ''; let excludeIds: string[] = []; let rotate = 0;`) so the payload can read them. The legacy branch leaves them at their defaults, which is accurate — it uses none of them.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 4: Deploy**

```bash
npm run deploy:edge -- style-up-chat
```

- [ ] **Step 5: Verify a real turn records provenance**

Send one message to a catalog stylist from `/style`, then:

```sql
select payload->'retrieval'->'method' as method,
       jsonb_array_length(payload->'retrieval'->'candidates') as cands,
       jsonb_pretty(payload->'retrieval'->'slots') as slots
from style_up_traces order by created_at desc limit 1;
```
Expected: `method` = `"stylist_engine"`, `cands` > 0, and `slots` listing every slot with a `tier`, `returned`, and `kept`. If `retrieval` is null on a catalog stylist, the deploy did not take — check the function logs before proceeding.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/style-up-chat/index.ts
git commit -m "feat(stylist): record per-item retrieval provenance in the trace

The trace stored candidate_count: 31 and nothing else, so which slot a
product was pulled for, what it scored, and which query found it were
unrecoverable. Now stored: occasion, gender, aesthetic, exclude_ids,
rotate, the per-slot query/tier/returned/kept diagnostics, and every
candidate with its slot, score and rank.

Names and brands are stored rather than joined so a later product
deletion cannot blank out the record. Best-effort inside the existing
try - a recording bug must never fail a shopper's turn."
```

---

### Task 6: Surface the provenance

**Files:**
- Modify: `app/services/style-up.ts` (types + trace parsing)
- Modify: `app/components/style-up/StyleUpTraceDiagram.tsx`
- Modify: `app/routes/admin/style.$threadId.tsx`
- Modify: `app/styles/admin-style-up.css`

**Interfaces:**
- Consumes: `payload.retrieval` (Task 5).
- Produces: `StyleUpRetrieval`, `RetrievalCandidate`, `RetrievalSlot` types; `buildProvenanceIndex(traces)` returning `Map<productId, { trace, candidate }>`. Task 7 reuses the same types for reconstructed results.

- [ ] **Step 1: Add the types and the index builder**

In `app/services/style-up.ts`, beside `StyleUpTrace`:

```ts
export interface RetrievalCandidate {
  id: string; name: string | null; brand: string | null;
  /** Null on the legacy recency scan, which has no slots or scores. */
  slot: string | null; score: number | null; rank: number | null;
}
export interface RetrievalSlot {
  slot: string; query: string; tier: 1 | 2 | 3;
  returned: number; kept: number; error: string | null;
}
export interface StyleUpRetrieval {
  method: string; occasion: string; gender: string; aesthetic: string | null;
  exclude_ids: string[]; rotate: number;
  slots: RetrievalSlot[]; candidates: RetrievalCandidate[];
}

/** Index every traced candidate by product id, so a product bubble in the
 *  transcript can look up exactly how it was pulled. An exact id join — no
 *  timestamp-proximity guessing. Later traces win, which is what you want when
 *  the same product surfaced on more than one turn. */
export function buildProvenanceIndex(
  traces: StyleUpTrace[],
): Map<string, { trace: StyleUpTrace; retrieval: StyleUpRetrieval; candidate: RetrievalCandidate }> {
  const out = new Map<string, { trace: StyleUpTrace; retrieval: StyleUpRetrieval; candidate: RetrievalCandidate }>();
  for (const trace of [...traces].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    const retrieval = (trace.payload?.retrieval as StyleUpRetrieval | null) ?? null;
    if (!retrieval?.candidates) continue;
    for (const candidate of retrieval.candidates) out.set(candidate.id, { trace, retrieval, candidate });
  }
  return out;
}
```

- [ ] **Step 2: Expand the candidate pool in the research diagram**

In `StyleUpTraceDiagram.tsx`, read the new key and make the "Sent to the model" node's candidate count expandable. Add below the existing `const candidateCount = …`:

```tsx
  const retrieval = (p.retrieval as StyleUpRetrieval | null) ?? null;
  const pickedIds = new Set((p.product_ids as string[]) ?? []);
```

Then add a new node between `sent` and `ai`:

```tsx
      {!isWeb && (
        <TraceNode
          k="pool" icon="🎯" title="How the pool was pulled"
          summary={retrieval
            ? `${retrieval.method} · ${retrieval.candidates.length} candidates · ${retrieval.slots.length} slots`
            : 'not recorded (turn predates provenance capture)'}
          open={!!open.pool} onToggle={toggle}
        >
          {!retrieval ? (
            <div className="sut-muted">
              This turn predates provenance capture. Use “Re-run retrieval” to replay it.
            </div>
          ) : (
            <>
              <div className="sut-sub">Occasion the retrieval ran on</div>
              <pre className="sut-pre">{retrieval.occasion || '(empty)'}</pre>
              <div className="sut-sub">Per slot</div>
              <table className="sup-slots">
                <thead><tr><th>Slot</th><th>Tier</th><th>Query</th><th>Ret.</th><th>Kept</th></tr></thead>
                <tbody>
                  {retrieval.slots.map(s => (
                    <tr key={s.slot} className={s.kept === 0 ? 'is-empty' : s.tier > 1 ? 'is-fallback' : ''}>
                      <td>{s.slot}</td>
                      <td title={TIER_TITLE[s.tier]}>t{s.tier}</td>
                      <td className="sup-q">{s.query}</td>
                      <td>{s.returned}</td>
                      <td>{s.error ? `err: ${s.error}` : s.kept}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="sut-sub">Candidates ({retrieval.candidates.length}) — ★ = shown to the shopper</div>
              {retrieval.candidates.map(c => (
                <div key={c.id} className={`sup-cand${pickedIds.has(c.id) ? ' is-picked' : ''}`}>
                  <span className="sup-cand-slot">{c.slot ?? 'recency'}</span>
                  <span className="sup-cand-name">{[c.brand, c.name].filter(Boolean).join(' · ') || c.id}</span>
                  <span className="sup-cand-score">{c.score == null ? `#${c.rank}` : c.score.toFixed(2)}</span>
                  {pickedIds.has(c.id) && <span className="sup-cand-star">★</span>}
                </div>
              ))}
            </>
          )}
        </TraceNode>
      )}
```

With this const at module scope:

```tsx
const TIER_TITLE: Record<number, string> = {
  1: 'aesthetic + occasion (the intended query)',
  2: 'occasion only — the stylist specialty emptied this slot',
  3: 'occasion only, exclude list dropped — anti-repeat had exhausted the slot',
};
```

- [ ] **Step 3: Add the per-item "why" to the transcript**

In `app/routes/admin/style.$threadId.tsx`, build the index from the traces already loaded, and give the product bubble a toggle. Because the Research tab currently loads traces lazily, change that effect to load traces **on mount** rather than on tab open — the transcript now needs them too. Keep the `traces.length > 0` guard so it still fetches once.

```tsx
const provenance = useMemo(() => buildProvenanceIndex(traces), [traces]);
```

Replace the `kind === 'product'` branch with a component:

```tsx
function ProductBubble({ m, hit }: {
  m: StyleUpMessage;
  hit: { retrieval: StyleUpRetrieval; candidate: RetrievalCandidate } | undefined;
}) {
  const [open, setOpen] = useState(false);
  const slot = hit?.candidate.slot
    ? hit.retrieval.slots.find(s => s.slot === hit.candidate.slot)
    : undefined;
  return (
    <div className="suc-product">
      <div className="sua-msg-product">
        {m.productRef?.image && <img src={m.productRef.image} alt="" />}
        <span>{[m.productRef?.brand, m.productRef?.name].filter(Boolean).join(' · ') || 'Product'}</span>
      </div>
      <button type="button" className="suc-why-btn" onClick={() => setOpen(o => !o)}>
        {open ? 'hide' : 'why this?'}
      </button>
      {open && (
        <div className="suc-why">
          {!hit ? (
            <span className="sut-muted">
              Not recorded — this turn predates provenance capture, or the piece was
              not pulled from the catalog.
            </span>
          ) : (
            <dl className="sut-kv">
              <div className="sut-kv-row"><dt>slot</dt><dd>{hit.candidate.slot ?? 'recency scan'}</dd></div>
              <div className="sut-kv-row"><dt>rank</dt>
                <dd>{hit.candidate.rank == null ? '—'
                  : `${hit.candidate.rank + 1} of ${slot?.kept ?? '?'} in ${hit.candidate.slot}`}</dd></div>
              <div className="sut-kv-row"><dt>score</dt>
                <dd>{hit.candidate.score == null ? 'n/a (recency scan)' : hit.candidate.score.toFixed(3)}</dd></div>
              <div className="sut-kv-row"><dt>query</dt><dd>{slot?.query ?? '—'}</dd></div>
              <div className="sut-kv-row"><dt>tier</dt>
                <dd>{slot ? `${slot.tier} — ${TIER_TITLE[slot.tier]}` : '—'}</dd></div>
              <div className="sut-kv-row"><dt>occasion</dt><dd>{hit.retrieval.occasion || '(empty)'}</dd></div>
            </dl>
          )}
        </div>
      )}
    </div>
  );
}
```

Export `TIER_TITLE` from `StyleUpTraceDiagram.tsx` and import it here so the two surfaces cannot drift.

- [ ] **Step 4: Add the styles**

Append to `app/styles/admin-style-up.css`:

```css
/* ── Retrieval provenance ────────────────────────────────────────────────── */
.sup-slots { width: 100%; border-collapse: collapse; font-size: 11.5px; margin-bottom: 6px; }
.sup-slots th { text-align: left; padding: 4px 6px; color: #9aa0a8; font-weight: 700; border-bottom: 1px solid #f0f1f3; }
.sup-slots td { padding: 4px 6px; border-bottom: 1px solid #f4f5f7; }
.sup-slots .sup-q { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: #4b5563; }
/* A slot that fell back, or collapsed to nothing, is the thing you are looking for. */
.sup-slots tr.is-fallback td { background: #fdf7e8; }
.sup-slots tr.is-empty td { background: #fdeeec; color: #b4453a; }
.sup-cand { display: flex; align-items: center; gap: 8px; padding: 3px 0; font-size: 11.5px; border-bottom: 1px solid #f4f5f7; }
.sup-cand.is-picked { font-weight: 700; }
.sup-cand-slot { flex: 0 0 62px; color: #9aa0a8; }
.sup-cand-name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sup-cand-score { flex: 0 0 auto; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: #6b7280; }
.sup-cand-star { flex: 0 0 auto; color: #9a6a00; }

.suc-product { display: flex; flex-direction: column; align-items: flex-start; max-width: 80%; }
.suc-why-btn { margin: 3px 0 0 6px; padding: 0; border: none; background: none; cursor: pointer;
  font-size: 10.5px; font-weight: 700; color: #9ca3af; }
.suc-why-btn:hover { color: #14151a; }
.suc-why { margin: 5px 0 0 6px; padding: 8px 10px; border: 1px solid #e8e9ec; border-radius: 10px; background: #fff; }

.admin-dark .sup-slots th { color: #8b8e96; border-color: #26282d; }
.admin-dark .sup-slots td, .admin-dark .sup-cand { border-color: #26282d; }
.admin-dark .sup-slots tr.is-fallback td { background: #221d10; }
.admin-dark .sup-slots tr.is-empty td { background: #1c1517; }
.admin-dark .suc-why { background: #17181c; border-color: #26282d; }
```

- [ ] **Step 5: Typecheck, test, build**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: clean.

- [ ] **Step 6: Verify against the turn recorded in Task 5**

Open that conversation. On the newest product bubble, click "why this?" — expect a slot, a rank like "2 of 8 in tops", a score, the literal query, and the tier. Open the Research tab and confirm the new "How the pool was pulled" node lists every slot, with any tier-2/3 or zero-kept row highlighted. On an older turn, confirm both surfaces say "not recorded" rather than rendering blanks.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(admin): show how each product was pulled

The transcript's product bubbles get a 'why this?' toggle: slot, rank
within that slot, BM25 score, the literal query, the fallback tier, and
the occasion the retrieval ran on. Joined by exact product id against
the trace's recorded candidate pool - no timestamp proximity guessing.

The research diagram gains a pool node: the per-slot query/tier table
(fallback rows tinted, empty rows flagged) above the full candidate list
with the shown pieces starred. A slot that collapsed is now visible at a
glance instead of being invisible."
```

---

### Task 7: Replay retrieval for pre-capture traces

The 47 existing traces have no provenance. This replays the **original inputs** — recoverable exactly from `style_up_messages` — through today's catalog, and **never stores the result**.

**Files:**
- Create: `supabase/functions/style-retrace/index.ts`
- Modify: `app/services/style-up.ts`, `app/components/style-up/StyleUpTraceDiagram.tsx`, `app/styles/admin-style-up.css`

**Interfaces:**
- Consumes: `retrieveOccasionCandidates` (Task 4), `StyleUpRetrieval` (Task 6).
- Produces: `adminRetraceTrace(traceId): Promise<{ retrieval: StyleUpRetrieval; reconstructedAt: string } | { error: string }>`.

- [ ] **Step 1: Write the edge function**

Create `supabase/functions/style-retrace/index.ts`:

```ts
// style-retrace — replay the retrieval for a trace recorded before provenance
// capture existed.
//
// The INPUTS are recovered exactly: occasion, exclude ids and rotate all derive
// from style_up_messages rows older than the trace, which is the same source and
// the same algorithm the original turn ran. The OUTPUT is not the original pool
// — the catalog has gained and lost products since.
//
// The result is RETURNED AND NEVER STORED. Writing it into payload.retrieval
// would make a reconstruction indistinguishable from a record, and this is an
// audit surface. That is the whole design of this function.

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { retrieveOccasionCandidates } from '../_shared/style-retrieval.ts';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req: Request) => {
  try {
    const { trace_id } = await req.json();
    if (!trace_id) return json({ success: false, error: 'trace_id required' }, 400);

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const { data: trace } = await admin.from('style_up_traces')
      .select('id, thread_id, stylist_id, source_mode, payload, created_at')
      .eq('id', trace_id).maybeSingle();
    if (!trace) return json({ success: false, error: 'trace not found' }, 404);
    if (trace.source_mode === 'web') {
      return json({ success: false, error: 'web stylists never ran catalog retrieval' }, 400);
    }

    // Everything the thread had said BEFORE this turn.
    const { data: prior } = await admin.from('style_up_messages')
      .select('sender, kind, body, product_ref, created_at')
      .eq('thread_id', trace.thread_id)
      .lt('created_at', trace.created_at)
      .order('created_at', { ascending: true });
    const turns = (prior ?? []) as Array<{ sender: string; kind: string; body: string | null; product_ref: { id?: string } | null }>;

    // Same three derivations style-up-chat performs, over the same rows.
    const occasion = turns.filter(t => t.sender === 'shopper' && t.body)
      .slice(-3).map(t => (t.body ?? '').trim()).join(' ').slice(0, 300);
    const excludeIds = [...new Set(turns.filter(t => t.kind === 'product')
      .map(t => t.product_ref?.id).filter((x): x is string => !!x))];
    const rotate = Math.max(0, turns.filter(t => t.sender === 'shopper').length - 1);

    const ctx = (trace.payload?.context ?? {}) as { gender?: string };
    const gender = ctx.gender === 'male' ? 'male' : ctx.gender === 'female' ? 'female' : 'unknown';

    // The stylist's CURRENT specialty — it may have been edited since the turn.
    // Returned in the response so the UI can name that caveat too.
    const { data: stylist } = await admin.from('style_up_stylists')
      .select('specialty').eq('id', trace.stylist_id).maybeSingle();
    const aesthetic = stylist?.specialty ?? '';

    const { cands, slots } = await retrieveOccasionCandidates(admin, {
      occasion, gender, aesthetic, excludeIds, rotate,
    });

    return json({
      success: true,
      reconstructed_at: new Date().toISOString(),
      retrieval: {
        method: 'stylist_engine', occasion, gender, aesthetic,
        exclude_ids: excludeIds, rotate, slots,
        candidates: cands.map(c => ({
          id: c.id, name: c.name, brand: c.brand, slot: c.slot, score: c.score, rank: c.rank,
        })),
      },
    });
  } catch (e) {
    return json({ success: false, error: String(e) }, 500);
  }
});
```

- [ ] **Step 2: Deploy**

```bash
npm run deploy:edge -- style-retrace
```

- [ ] **Step 3: Add the client call**

In `app/services/style-up.ts`:

```ts
/** Admin: replay retrieval for a trace that predates provenance capture. The
 *  inputs are the originals; the candidate pool is today's catalog. Nothing is
 *  stored — see the function's header comment. */
export async function adminRetraceTrace(
  traceId: string,
): Promise<{ retrieval: StyleUpRetrieval; reconstructedAt: string } | { error: string }> {
  if (!supabase) return { error: 'No database connection' };
  const { data, error } = await supabase.functions.invoke('style-retrace', { body: { trace_id: traceId } });
  if (error) return { error: error.message };
  if (!data?.success) return { error: String(data?.error ?? 'retrace failed') };
  return { retrieval: data.retrieval as StyleUpRetrieval, reconstructedAt: String(data.reconstructed_at) };
}
```

- [ ] **Step 4: Wire the button into the pool node**

In `StyleUpTraceDiagram.tsx`, in the `!retrieval` branch from Task 6, replace the plain message with a button plus the banner. Reconstruction is offered **only for catalog traces** — the node is already inside `{!isWeb && …}`, so a web stylist never sees it.

```tsx
{!retrieval && !recon && (
  <>
    <div className="sut-muted">This turn predates provenance capture.</div>
    <button type="button" className="sua-btn" disabled={busy}
      onClick={async () => {
        setBusy(true);
        const r = await adminRetraceTrace(trace.id);
        setBusy(false);
        if ('error' in r) setReconErr(r.error); else setRecon(r);
      }}>
      {busy ? 'Replaying…' : 'Re-run retrieval'}
    </button>
    {reconErr && <div className="sut-search-stat is-err">{reconErr}</div>}
  </>
)}
{recon && (
  <>
    <div className="sup-recon-banner">
      ⚠ RECONSTRUCTED {new Date(recon.reconstructedAt).toLocaleString()} — the inputs are
      the originals, but this is today’s catalog, not the pool this turn actually saw.
      The stylist’s specialty is also its current value. Not stored.
    </div>
    {/* identical rendering to the recorded case */}
  </>
)}
```

Extract the slot table + candidate list from Task 6 into a local `RetrievalBody({ retrieval, pickedIds })` component so the recorded and reconstructed cases render through one code path and cannot drift.

- [ ] **Step 5: Style the banner so it cannot be mistaken for a record**

```css
.sup-recon-banner { margin-bottom: 10px; padding: 8px 10px; border-radius: 8px;
  background: #fdf1d6; border: 1px solid #f0dcae; color: #7a5300;
  font-size: 11.5px; font-weight: 700; line-height: 1.45; }
.admin-dark .sup-recon-banner { background: #241d0c; border-color: #4a3c1a; color: #e0b95f; }
```

- [ ] **Step 6: Typecheck, test, build**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: clean.

- [ ] **Step 7: Verify on a real old trace**

Open a conversation from July 2026, Research tab, the pool node. Confirm: it says the turn predates capture, "Re-run retrieval" returns a slot table and candidate list, and the banner is present and undismissable. Then confirm nothing was written:

```sql
select count(*) from style_up_traces where payload ? 'retrieval';
```
Expected: only the count of turns created **after** Task 5 deployed. If it grew by one after clicking the button, the function is storing and must be fixed before merge.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(admin): replay retrieval for pre-capture traces

style-retrace rebuilds a turn's original inputs - occasion, exclude ids
and rotate all derive from the thread's own messages older than the
trace, the same source and algorithm the original turn used - and
re-runs the shared retrieval helper.

The result is returned and never stored. Writing it into the payload
would make a reconstruction indistinguishable from a record on an audit
surface. It renders behind a permanent banner naming both caveats:
today's catalog, and the stylist's current specialty."
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| §1 Retrieval keeps its provenance | Task 4 |
| §2 The trace records the pool | Task 5 |
| §3 `generation_events` catch-up migration | Task 1 |
| §4 `/admin/style/g/:generationId` + spine | Tasks 2, 3 |
| §5 Per-item provenance, two surfaces | Task 6 |
| §6 Reconstruction | Task 7 |
| Error handling — no events | Task 3 Step 4 (empty-state band) |
| Error handling — unknown event | Task 2 (tested) |
| Error handling — `retrieval` absent | Task 6 Step 2/3 |
| Error handling — deleted product | Task 5 Step 2 (names stored) |
| Testing — tier test | Task 4 |
| Testing — spine mapper test | Task 2 |

No gaps.

**Type consistency:** `SpineNode` / `GenerationEvent` (Task 2) are consumed unchanged in Task 3. `RetrievalResult` / `SlotDiag` / `OccasionCand.rank` (Task 4) flow into Task 5's payload and Task 6's `StyleUpRetrieval` / `RetrievalSlot` / `RetrievalCandidate`, which Task 7 reuses verbatim for reconstructed results. `TIER_TITLE` is defined once in `StyleUpTraceDiagram.tsx` and imported by the route — named identically in both places.

**Ordering note:** Task 4 changes a function signature and Task 5 fixes the caller's use of it; Task 4 Step 4 keeps the project compiling in between, so each task is independently reviewable.
