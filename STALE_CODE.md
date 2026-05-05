# Stale / Deprecated Code — Cleanup Tracker

Items below are no longer reached after the SEARCH_V3 (product-first
retrieval + creative hydration) pivot. Keep this list current; remove
the items in a follow-up PR once the V3 path has soaked in production.

## Database

- **`search_products_hybrid` RPC** — Replaced by
  `search_products_with_creatives` (migration `080_search_v3_product_first.sql`).
  No live caller after `nl-search` redeploy. Drop in migration `082_drop_search_products_hybrid.sql`
  after one full release cycle of green golden-eval runs.

- **`search_creatives_hybrid` RPC** — Now only called for the elite-boost
  lane (`require_elite: true, k≈max(6, ceil(k/4))`). Once the elite lane
  is folded into `search_products_with_creatives` (planned), this RPC
  can also be retired.

## Edge Function — `supabase/functions/nl-search/index.ts`

- **Step 4b (products fallback dance)** — Deleted. Was a multi-pass
  fallback (`callProducts` → `appendRows` w/ Pass 1/2/3) layered on top
  of the creative lane. Superseded by the new primary RPC which already
  considers every active product as a candidate.

- **Step 4c (BM25-aware re-rank)** — Deleted. Was gated on
  `productsAppended > 0`, which is now permanently zero. The new RPC
  bakes BM25 + dense fusion into its own `rrf_score`.

- **Step 4f (server-side video-only filter)** — Deleted. V3 returns
  `is_placeholder=true` rows on purpose so cold categories show the
  matching product as an image card. Re-introducing this filter would
  defeat that contract.

- **`productsRpcSpeculative` pattern** — Removed. Speculatively firing a
  second RPC in parallel was a workaround for the old fallback dance.
  The new path runs a single primary RPC.

- **`productsAppended` / `productsFallbackPasses` consts** — Currently
  hard-coded to `0` and emitted in the response `meta` for back-compat
  with any clients that read them. Drop once nothing reads them
  (search the webapp + deck repo for these keys before removing).

## Edge Function — `supabase/functions/nl-search/query-analyzer.ts`

- **`CATALOG_TYPE_SYNONYMS` static map** — Will be obsolete once
  Phase B (server-side taxonomy expansion via `taxonomy` table seeded by
  migration `081_taxonomy_seed.sql`) ships. Keep until Phase C closes
  the loop and Haiku stops emitting `types`/`anchor_type`/`pair_types`.

## Webapp

- **`ContinuousFeed.tsx` video_url filter** — Already removed (kept
  `matchesMaterial` only). Comment in source documents the V3 reasoning.

## Migrations Pending

- `082_drop_search_products_hybrid.sql` — drops the deprecated RPC.
  Schedule after V3 has been live for ≥1 week with green eval runs.
