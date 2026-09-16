# StyleUp — auditable generations and per-item retrieval provenance

**Date:** 2026-08-20
**Status:** Approved design, pre-implementation
**Feedback source:** Robert Burton (founder) — "each generation has a node sequence
we can audit? Also show context about how each item is pulled?"

## Problem

Two audit gaps on `/admin/style`, verified against live data rather than inferred
from the UI.

**1. A generation's real sequence is recorded but never read.** `user_generations`
itself carries only `created_at` and `completed_at`. But `generation_events`
(`generation_id, event, payload jsonb, created_at`) already holds a timestamped
step log, written best-effort by `generate-look` and `fal-webhook`: **611 rows,
12 event types, back to 2026-05-01, covering 120 of 135 generations.** A real
render reads:

```
submit_attempt         15:58:42          model, face_count, product_count
image_rehost_faces     15:58:45   +3.0s  bytes + public_url per face
image_rehost_products  15:58:48   +3.3s  bytes + public_url per product
seedance_face_grid     15:58:52   +3.1s  faces, gridded
fal_submit_ok          15:58:53   +1.5s  request_id, model, prompt_preview
fal_webhook            16:03:17  +264.3s status, error, fal_body
```

Eleven seconds of our own preprocessing, then 264 seconds of Fal. The admin UI
shows none of it — it renders a three-node Input → Model → Output summary built
from `user_generations` columns alone. **This half of the work is therefore pure
read-side: no migration, no write change, and retroactive over 120 generations.**

(Superseded design note: an earlier draft of this spec proposed a `submitted_at`
column on `user_generations`. `fal_submit_ok.created_at` already *is* that
timestamp, recorded 116 times historically. The column would have duplicated
existing data and only worked going forward. Do not add it.)

**2. Per-item retrieval provenance is computed and then thrown away.** This is the
sharper of the two.
[`_shared/style-retrieval.ts`](../../../supabase/functions/_shared/style-retrieval.ts)
already returns `slot` and `score` on every candidate, and internally knows which
of three query fallback tiers produced each slot's rows. Then:

- [`style-up-chat/index.ts:179`](../../../supabase/functions/style-up-chat/index.ts)
  `.map()`s the candidates into a narrower shape that **drops `slot` and `score`**.
- [`style-up-chat/index.ts:372`](../../../supabase/functions/style-up-chat/index.ts)
  writes only `candidate_count: cands.length` into the trace payload.

Live check across all 47 `style_up_traces` rows: every row has
`candidate_count`, `picks`, and `product_ids`; **no row has** `occasion`,
`candidates`, `slot`, or `score`. The only surviving record of how a product was
pulled is an ephemeral `console.log` in the edge function.

Which fallback tier fired matters most. The per-slot query runs up to three times —
aesthetic + occasion, then occasion alone, then occasion ignoring the exclude list —
and two shipped bugs were exactly this shape: a red-carpet stylist's specialty
zeroing whole slots, and the case-sensitive `type` match collapsing 70 shirts to 5.
Neither is visible in any stored trace.

## What already exists (reused, not rebuilt)

- **Slot and score are already computed.** `OccasionCand` carries
  `{ slot, score }`; the loop already distinguishes the three query tiers. Nothing
  new needs to be *derived* — only kept.
- **The trace surface exists.** `style_up_traces(payload jsonb, searches jsonb)` and
  `StyleUpTraceDiagram` already render an expandable node-per-step diagram with a
  precedent for honest empty states ("No search results recorded (older turn…)").
- **The step log already exists and is already written.** `generation_events` is
  populated from `generate-look` (`submit_attempt`, `image_rehost_faces`,
  `image_rehost_products`, `seedance_face_grid`, `fal_submit_ok`,
  `fal_submit_fail`, `fal_submit_fallback`, `fal_submit_fallback_skipped`,
  `content_policy_fallback`) and `fal-webhook` (`fal_webhook`), plus
  `watchdog_timeout` and `name_look_fail`. Each carries a `payload jsonb` with
  the step's real detail. Nothing needs to be written for the spine — only read.
- **A time-proportional spine already exists.** `pipeline.product.$id.tsx` renders a
  log-scaled timeline where vertical gap encodes waiting
  ([`gapPx`](../../../app/routes/admin/pipeline.product.$id.tsx)). The generation
  spine reuses that idiom rather than inventing a second timeline style.
- **One Fal handoff site.** [`generate-look/index.ts:959`](../../../supabase/functions/generate-look/index.ts)
  is the single place that writes `status:'generating'` + `fal_request_id` +
  `veo_model` — so one column added there captures the handoff moment.
- **A single caller.** `retrieveOccasionCandidates` has exactly one caller
  (`style-up-chat:175`), so changing its return type is contained.
- **An existing unit test on this module.**
  [`app/services/style-retrieval-rotate.test.ts`](../../../app/services/style-retrieval-rotate.test.ts)
  already imports the edge-function shared module directly under vitest. The new
  tier test sits beside it, no new harness.
- **The conversation page already fetches traces** (shipped `a4145886`), so the
  per-item lookup needs no additional round trip.

## Design

### 1. Retrieval keeps its provenance

`_shared/style-retrieval.ts` returns an object instead of a bare array:

```ts
export interface SlotDiag {
  slot: Slot;
  query: string;          // the query that actually produced the kept rows
  tier: 1 | 2 | 3;        // 1 aesthetic+occasion · 2 occasion only · 3 occasion, exclude ignored
  returned: number;       // rows the RPC gave back
  kept: number;           // after gender-name filter + rotate/trim
  error: string | null;
}

export interface RetrievalResult {
  cands: OccasionCand[];  // each now also carries `rank` within its slot
  slots: SlotDiag[];
}
```

`OccasionCand` gains `rank: number` — position within its own slot after
rotate/trim, so "2nd of 8 in tops" is a stored fact rather than a UI guess.

`tier` is set at the point each fallback is taken, not reconstructed afterwards.
A slot that errored records `tier` of the last attempt with `error` populated and
`kept: 0`.

### 2. The trace records the pool

`style-up-chat` stops narrowing the candidates at line 179 and adds one payload key:

```ts
retrieval: {
  method,          // 'stylist_engine' | 'legacy'
  occasion,        // the exact string passed to retrieval
  gender,          // genderNorm
  aesthetic,       // stylist specialty, as used
  exclude_ids,     // ids skipped for anti-repeat
  rotate,          // rotation offset applied
  slots,           // SlotDiag[]
  candidates: [{ id, name, brand, slot, score, rank }],
}
```

Names and brands are **stored, not joined**. A product deleted after the turn would
otherwise blank out the audit record; ~48 candidates × ~100 bytes ≈ 5 KB of jsonb
per stylist turn is the price of a self-contained record.

The stored candidate shape is deliberately looser than `OccasionCand`:
`{ id, name, brand, slot: string | null, score: number | null, rank: number }`.
`legacy` retrieval (the recency-120 scan) has no slots or scores, so it records
`method: 'legacy'`, `slots: []`, and candidates with `slot: null`, `score: null`,
`rank` as the scan index — the UI reads that as "recency scan, no ranking" rather
than pretending a score exists. Do not reuse the `OccasionCand` type for the
payload; it would force a fake slot onto every legacy row.

Web-sourced stylists (`isWeb`) skip catalog retrieval entirely and keep using the
existing `searches` column; `retrieval` is absent on those traces.

**Growth:** 5 KB per stylist turn, unbounded. Acceptable at 47 traces, and revisited
with a retention policy well before 47,000. Not solved now.

### 3. `generation_events` catch-up migration

The table exists in the database but has **no migration file** — it was created
out-of-band, so the repo is not currently the source of truth for it. Add
`20260820000000_generation_events_catchup.sql` containing a
`create table if not exists` matching the live shape, plus the index the spine
query needs:

```sql
create table if not exists public.generation_events (
  id            bigserial primary key,
  generation_id uuid not null references public.user_generations(id) on delete cascade,
  event         text not null,
  payload       jsonb,
  created_at    timestamptz not null default now()
);
create index if not exists generation_events_gen_created_idx
  on public.generation_events (generation_id, created_at);
```

`if not exists` throughout, so applying it against the live database is a no-op
that only records the shape. No data is written or altered.

### 4. `/admin/style/g/:generationId`

New route file `app/routes/admin/style.g.$generationId.tsx`, registered as
`style/g/:generationId` in the `vite.config.ts` admin block (admin routes are
defined manually — `ignoredRouteFiles` excludes `routes/admin/**`). Three segments
against the conversation route's two, so it cannot collide with
`style/:threadId`. The `admin` manualChunks rule already covers `/routes/admin/`,
so the page cannot leak into the consumer bundle.

**Back link** resolves to the originating conversation when the generation came from
a chat (`style_up_messages` where `render_generation_id` matches), otherwise to
`/admin/style?tab=generations`.

**The spine** — one node per `generation_events` row for this generation, in
`created_at` order, with log-scaled gaps via the `pipeline.product.$id.tsx` idiom.
Nodes are rendered from the event log, not from a fixed list, so a retry, a
fallback, or a watchdog timeout appears without any code change.

Each known event maps to a label and a one-line summary pulled from its payload:

| `event` | Label | Summary from `payload` |
|---|---|---|
| `submit_attempt` | Submit attempt | `fal_model`, `face_count`, `product_count` |
| `image_rehost_faces` | Faces re-hosted | count + total bytes from `stats[]` |
| `image_rehost_products` | Products re-hosted | count + total bytes from `stats[]` |
| `image_preflight` | Image preflight | payload as-is |
| `seedance_face_grid` | Face grid built | `faces`, `gridded` |
| `fal_submit_fallback` | Model fallback | from → to model |
| `fal_submit_fallback_skipped` | Fallback skipped | reason |
| `fal_submit_ok` | Submitted to Fal | `request_id`, `model`, `duration_seconds` |
| `fal_submit_fail` | Submit failed | `error` (node marked failed) |
| `content_policy_fallback` | Content-policy retry | payload as-is |
| `watchdog_timeout` | Watchdog timeout | payload as-is (node marked failed) |
| `fal_webhook` | Fal returned | `status`, `error` |
| `name_look_fail` | Naming failed | `error` |

An **unrecognised** `event` string still renders — label falls back to the raw
event name, summary to the first ~80 chars of the payload. A new event type added
to an edge function shows up in the audit without a UI change; it never silently
vanishes.

Every node expands to its full `payload` JSON, same interaction as
`StyleUpTraceDiagram`'s nodes.

Two derived rows frame the log, drawn from `user_generations` because they are
not events: **Requested** (`created_at`, `triggered_by_admin_id` → shopper vs
admin, plus the linked uploads and pieces) at the top, and **Output**
(`video_url`, `storage_path`, `display_name`, terminal `status`) at the bottom.

Gaps are labelled from real adjacent timestamps. The `fal_submit_ok →
fal_webhook` gap is the one that matters and gets called out as **model time**;
everything before it is our own preprocessing.

**The 15 generations with no events** (all pre-2026-05-01) render the two derived
rows with an explicit "no step log — this render predates event capture
(2026-05-01)" band between them. No inferred intermediate steps.

Below the spine sits today's Input → Model → Output graph, **extracted** from
`admin/style.tsx` into `app/components/style-up/GenerationDiagram.tsx` so both
surfaces share one copy. `style.tsx` sheds roughly 90 lines.

**The modal is retired.** The Generations table row becomes a `<Link>` to this page,
matching the conversation-page direction and dropping the `openLook` / `openGen` /
`openUploads` state from `style.tsx`.

The conversation page's render bubble gains an "audit" link to the same page.

### 5. Per-item provenance, two surfaces

The conversation page builds `Map<productId, { trace, candidate }>` from
`payload.retrieval.candidates` across the traces it already loads. This is an exact
id join — no timestamp-proximity heuristic.

**Transcript.** Each product bubble gets a `why` toggle that expands to slot, rank,
score, the exact query, the tier that fired, and what it beat ("2nd of 8 in tops").
A product with no matching candidate shows the not-recorded state. The reconstruct
affordance from §6 appears only for catalog traces: a web stylist never ran catalog
retrieval, so there is nothing to replay and the panel says so instead of offering a
button that cannot work.

**Research tab.** The "Sent to the model" node's `31 candidates` summary becomes
expandable: the full pool grouped by slot with picks marked, above a per-slot table
of query / tier / returned / kept. A slot that collapsed to one row, or fell to
tier 3, is visible at a glance in that table — which is the diagnostic the two
historical bugs needed.

### 6. Reconstruction for pre-existing traces

New edge function `style-retrace`. Given a trace id it rebuilds the retrieval
**inputs exactly** and replays them:

- `occasion` — thread's `style_up_messages` where `created_at < trace.created_at`,
  filtered to `sender='shopper'`, last 3 bodies joined, sliced to 300 chars. This is
  the same algorithm the original turn ran, over the same rows.
- `exclude_ids` — `kind='product'` messages before the trace timestamp.
- `rotate` — shopper turn count before the trace timestamp, minus 1, floored at 0.
- `gender` — `payload.context.gender`.
- `aesthetic` — the stylist's *current* specialty, looked up via `stylist_id`.

It then calls the shared `retrieveOccasionCandidates` and **returns the result
without storing it.**

Not storing is the design point, not an omission: a reconstruction written into
`payload` would become indistinguishable from a record. The UI renders it behind a
persistent `⚠ RECONSTRUCTED <date> — inputs are original, catalog has changed`
banner that cannot be dismissed.

Reconstruction is faithful in its inputs and *not* faithful in its output — the
catalog has gained and lost products since. The aesthetic is a further caveat: a
stylist whose specialty was edited replays with today's value. The banner names
both limits.

## Error handling

- `retrieval` absent from a payload → "not recorded (turn predates provenance
  capture)" plus the reconstruct button. Mirrors the existing `searches` empty state.
- `style-retrace` failure → the error surfaces in the panel; nothing is written, so
  a failed reconstruction leaves no trace of itself.
- A generation with no `generation_events` rows → the "no step log" band described
  in §4. Never an inferred timeline.
- An unrecognised `event` string → rendered with the raw name, never dropped.
- A candidate id no longer in `products` → the stored `name`/`brand` still render.
- Provenance capture is best-effort inside the existing `try` that already wraps the
  trace insert. A retrieval-recording bug must never fail a shopper's turn.

## Testing

One unit test, `app/services/style-retrieval-tier.test.ts`, beside the existing
`style-retrieval-rotate.test.ts` and importing the same shared module. It drives a
stubbed `RpcClient` through the fallback sequence and asserts the recorded tier:

- RPC returns rows on the first call → `tier: 1`, query includes the aesthetic.
- First call empty, second returns rows → `tier: 2`, query is occasion-only.
- First two empty with a non-empty `excludeIds`, third returns rows → `tier: 3`.
- All three empty → `kept: 0`, `error` populated, slot contributes no candidates.

That is the branch worth pinning — it is the logic the whole provenance feature
reports on, and it is where a silent regression would quietly mislabel every turn.
`rank` correctness is covered incidentally by the same fixtures.

A second unit test, `app/services/generation-spine.test.ts`, pins the pure
`eventsToNodes(events)` mapper from §4:

- A known event maps to its label and payload-derived summary.
- An **unknown** event still produces a node, labelled with the raw event string —
  the guarantee that a newly added edge-function event can never silently vanish
  from an audit surface.
- An empty event list produces no nodes, so the page renders the "no step log"
  band rather than an empty spine.
- `fal_submit_fail` and `watchdog_timeout` mark their node failed.

The route pages, the spine layout, and the reconstruction round trip are verified by
hand in the admin panel against real threads. No component-test harness exists in
this repo and this design does not add one.

## Out of scope

- Retention or pruning of `retrieval` payloads.
- Backfilling reconstructions into storage — deliberately rejected in §6.
- Any change to what the shopper sees. Every surface here is admin-only and
  read-only.
