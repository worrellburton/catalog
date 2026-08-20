# StyleUp — auditable generations and per-item retrieval provenance

**Date:** 2026-08-20
**Status:** Approved design, pre-implementation
**Feedback source:** Robert Burton (founder) — "each generation has a node sequence
we can audit? Also show context about how each item is pulled?"

## Problem

Two audit gaps on `/admin/style`, verified against live data rather than inferred
from the UI.

**1. A generation is not a sequence.** `user_generations` carries `created_at` and
`completed_at` and nothing between — no event table, no intermediate timestamps
(confirmed against `information_schema`; the 28 columns include neither). The
existing admin graph is three nodes (Input → Model → Output) because that is all
the stored data supports. A four-minute render cannot be split into "sat in our
queue" versus "Fal was slow".

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

### 3. `user_generations.submitted_at`

One nullable `timestamptz` column, migration
`20260820000000_generation_submitted_at.sql`, written at
[`generate-look/index.ts:959`](../../../supabase/functions/generate-look/index.ts)
alongside `fal_request_id`. It splits the total elapsed time into queue wait
(`created_at → submitted_at`) and model time (`submitted_at → completed_at`).

Null on all existing rows and on any future row where the handoff never happened.
The spine renders an unmeasured segment in that case; it never shows a wait it
did not observe.

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

**The spine** — six nodes, log-scaled gaps via the `pipeline.product.$id.tsx` idiom:

| Node | Source | Detail shown |
|---|---|---|
| Requested | `created_at`, `triggered_by_admin_id` | who kicked it off (shopper vs admin) |
| Inputs | `user_generation_uploads`, `user_generation_products` | photo count, pieces head-to-toe |
| Prompt built | `prompt` | length, expandable to the literal text |
| Submitted | `submitted_at`, `fal_request_id`, `veo_model`, `model`, `duration_seconds` | request id, model slug |
| Returned | `completed_at`, `status`, `error_code`, `error_raw` | 'ok' or the failure category |
| Output | `video_url`, `storage_path`, `display_name` | the video, the Claude-given name |

Gaps carry labels only where both endpoints have timestamps — `created_at →
submitted_at` as "queue wait" and `submitted_at → completed_at` as "model time".

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
- `submitted_at` null → the spine renders the segment unmeasured. No inferred times.
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

The route pages, the spine layout, and the reconstruction round trip are verified by
hand in the admin panel against real threads. No component-test harness exists in
this repo and this design does not add one.

## Out of scope

- Retention or pruning of `retrieval` payloads.
- A `generation_events` table. `submitted_at` covers the one split that matters now;
  the table is the upgrade path if retries or further steps need recording.
- Backfilling reconstructions into storage — deliberately rejected in §6.
- Any change to what the shopper sees. Every surface here is admin-only and
  read-only.
