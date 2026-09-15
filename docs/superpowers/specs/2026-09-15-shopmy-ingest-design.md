# ShopMy Creator Shop Ingest

Status: **approved, ready for planning** · Date: 2026-09-15 · Branch: `dev`

Ingest a creator's ShopMy storefront into the product catalog by reading ShopMy's
own public JSON API — no browser, no AI, no Playwright. One creator shop yields
roughly as many products as the entire current catalog, at zero model cost.

---

## 1. Problem

Product ingest has been dead since 2026-07-31. Every discovery source is off and
the only job still firing is a retry loop over permanently-failed URLs. Separately,
the deep scraper costs an estimated ~$0.47 per product and re-inherits a failure
mode at every step: blocked merchant, timeout, wrong page, exhausted API credit.

Measured on production 2026-09-15:

| Finding | Evidence |
|---|---|
| No product created in 46 days | newest `products.created_at` is 2026-07-31 |
| 104 of 534 rows sit at `scrape_status='failed'` | `products` |
| Catalog is heavily male-skewed | 351 `male` / 118 `unisex` / 65 `female` |
| Modal web-endpoint budget nearly full | 7 of 8 `@modal.fastapi_endpoint` labels deployed |
| No unique key on `products.url` | only `products_pkey` and `products_brand_shopify_id_idx` exist |

ShopMy is a creator-storefront platform whose shops are already curated,
already brand- and price-tagged, and already point at real merchant product
pages. Reading it costs nothing and cannot fail in the ways the scraper fails.

## 2. What ShopMy actually serves

Measured against `https://shopmy.us/shop/justbobbidotcom?tab=collections&Section_id=409`
on 2026-09-15.

The site is a client-rendered SPA (a 3.8 KB HTML shell, no SSR payload), so the
HTML is useless. All data comes from `https://apiv3.shopmy.us`.

### 2.1 Access

A single request header unlocks the API. No authentication, no cookies, no browser.

| Request | Result |
|---|---|
| `curl <endpoint>` | `HTTP 401` |
| `curl -H 'Origin: https://shopmy.us' <endpoint>` | `HTTP 200`, 38 KB JSON |

### 2.2 Endpoints

```
GET /api/Shop/Collections?Curator_username=<user>[&Section_id=<n>][&limit=<n>]
    → { success, sections[], collections[], hasMoreCollections }

GET /api/Collections/:id
    → { id, name, description, Section_id, …, pins[] }
```

The hierarchy is **Shop → Section (tab) → Collection → Pin (item)**. The URL in
the request addresses Section 409, "Bobbi's Closet".

### 2.3 Scale of one shop

| Section | Collections | Pins |
|---|---:|---:|
| Favorites | 13 | 78 |
| Bobbi's Closet | 14 | 123 |
| Health & Wellness | 2 | 19 |
| Home | 5 | 58 |
| Dogs | 3 | 9 |
| Substack | 3 | 28 |
| Shop My Ig | 12 | 37 |
| Jones Road | 6 | 66 |
| Discount Codes | 6 | 6 |
| **Total** | **64** | **424** |

424 pins from ~65 HTTP requests and zero model calls, against a current catalog
of 534 products.

### 2.4 What a pin carries

```jsonc
{
  "title": "GUCCI | Sol GG Canvas Clog",
  "link": "https://www.mytheresa.com/us/en/women/gucci-gg-supreme-horsebit-mules-beige-p00810429",
  "selectedGeoLink": "https://www.mytheresa.com/us/en/…",       // real merchant PDP
  "affiliate_link": "https://click.linksynergy.com/deeplink?id=8yaPBDQV8ls&…",  // ShopMy's Rakuten ID
  "image": "https://production-shopmyshelf-uploads.s3.us-east-2.amazonaws.com/…",
  "original_image": "…",                                        // same value in practice
  "detailed_image_data": { "image": "…", "style": "contain" },   // one image, not a gallery
  "domain": "mytheresa.com",
  "merchant_data": { "name": "Mytheresa", "domain": "mytheresa.com", "source": "rakuten" },
  "product": {
    "title": "Sol GG Canvas Clog",
    "AllBrand_name": "Gucci",
    "fallbackPrice": 820,
    "fallbackPriceCurrency": "USD",
    "fallbackUrl": "https://gucci.com/us/en/pr/…",
    "Category_name": "Clogs",
    "Department_name": "Footwear",
    "Industry_name": "Fashion & Accessories"
  }
}
```

### 2.5 Known gaps in the source

These are properties of ShopMy's data, not of our implementation, and they shape
the design:

- **Exactly one image per pin.** `image`, `original_image` and
  `detailed_image_data.image` were the same URL on every pin inspected. There is
  no gallery.
- **The image URL the API returns is NOT publicly fetchable.** It points at a raw
  S3 object (`production-shopmyshelf-*.s3.*.amazonaws.com/<key>`) that returns
  `403 AccessDenied` to any anonymous GET — no `Referer`, `Origin` or User-Agent
  unlocks it. The browser loads the same object from their CDN, and the S3 key
  maps straight onto it:

  ```
  production-shopmyshelf-<bucket>.s3.<region>.amazonaws.com/<key>
    ->  https://static.shopmy.us/<bucket>/<key>
  ```

  Verified 2026-09-15 for both buckets: `pins` and `uploads` return HTTP 200.
  **The mapper must rewrite it.** Left raw, `verify-product-image` marks every
  row `image_verified=false` / `needs_review:blocked`, which fails
  `product_ready_for_feed` — so no ShopMy product could ever reach the feed, and
  the image could not be re-hosted either. Found by the Task 7 one-collection
  checkpoint, not by any dry run.
- **No description**, no materials, no styling or occasion metadata.
- **No gender field.** `Department_name` is "Footwear", not gendered.
- **Roughly 14% of pins are incomplete.** In the 14-pin sample collection, two had
  null brand, price and category; one of those ("Subtotal") pointed at an Amazon
  cart rather than a product page.

## 3. Decisions

| Question | Decision |
|---|---|
| Purpose | **Catalog seeding.** Products land in the admin panel as ordinary products tagged `source='shopmy'` and pass the existing curation and activation gate. Not creator onboarding. |
| Pipeline depth | **ShopMy fields plus the existing enrich chain** — `verify-product-image` (which re-hosts their S3 image so it cannot rot), occasion enrich, embed. No per-pin deep scrape. |
| Links | **Clean merchant URL.** `products.url` gets `selectedGeoLink`; `affiliate_url` stays null so the existing `affiliate-sync` attaches ours by merchant domain. ShopMy's `affiliate_link` is retained in `raw_data` as provenance only — it carries their Rakuten publisher ID, so using it would credit their account. |
| Curation structure | **Flatten to products, keep the names.** Every pin becomes one `products` row; section and collection names ride along in `raw_data`. No new tables, no new admin UI. |

## 4. Architecture

A single Supabase edge function, `shopmy-ingest`. The work is pure HTTP and JSON,
so it needs neither Playwright nor a model — which also keeps it off Modal, whose
web-endpoint budget is at 7 of 8.

```
POST /functions/v1/shopmy-ingest
Body: { url? , username? , section_id? , dry_run?  }

1. Parse             url → { curator_username, section_id? }
2. List collections  GET /api/Shop/Collections?Curator_username=…[&Section_id=…]
3. Fetch pins        GET /api/Collections/:id   per collection, concurrency 4
4. Map               pin → products row (§5), skipping incomplete pins (§7)
5. Upsert            on normalised url (§6)
6. Return            run summary (§7)
```

**Scope follows the URL.** A `Section_id` in the URL ingests that section only
(123 pins for the reference URL); its absence ingests the whole shop (424).

**`dry_run: true`** performs every fetch and mapping step and returns the rows it
would write, without writing. This is the review step before a first commit on a
new creator.

### 4.1 Entry point

Reuse `app/components/ProfileCrawlsPanel.tsx`, which already carries
`https://shopmy.us/drconnieyang` as its input placeholder. Detect a ShopMy host and
route to `shopmy-ingest`; every other profile URL continues to the existing AI
crawl (`crawl_profile_and_save`).

This mirrors the gate pattern recommended for the scraper: a cheap deterministic
path first, the AI path as fallback.

## 5. Data mapping

| `products` column | Source | Notes |
|---|---|---|
| `url` | `selectedGeoLink` ?? `link` ?? `product.fallbackUrl` | normalised; tracking parameters stripped |
| `name` | `product.title` ?? `title` | strip a leading `BRAND \|` prefix from `title` |
| `brand` | `product.AllBrand_name` only | **Not** `merchant_data.name` — that is the RETAILER, not the brand. Gucci's is "Mytheresa", adidas's is "Tillys", and the Amazon-cart pin's is "Amazon". The retailer is kept in `raw_data` instead. |
| `price` | `product.fallbackPrice` | |
| `currency` | `product.fallbackPriceCurrency` | |
| `type` | `product.Category_name` | e.g. "Clogs"; `trg_products_normalize_write` normalises it |
| `images` | `[image]` | single-element array; `verify-product-image` re-hosts it |
| `image_url` | `image` | |
| `source` | `'shopmy'` | |
| `scrape_status` | `'done'` | see below |
| `is_active` | `false` | column default; activation via the existing gate |
| `gender` | `null` | ShopMy has no gender field; the column is nullable and enrichment infers it later |
| `affiliate_url` | `null` | `affiliate-sync` attaches ours by merchant domain |
| `raw_data.shopmy` | `pin_id`, `collection_id`, `collection_name`, `section_name`, `curator_username`, `affiliate_link`, `merchant_data` | provenance and the retained curation signal |

**`scrape_status` must be `'done'`, not `'pending'`.** The `scrape-new-products`
trigger fires on `scrape_status = 'pending'` and POSTs the row to the Modal
scraper. Writing `'pending'` here would send the scraper at a merchant URL whose
data we already hold — pointless, and for blocked merchants it would stamp the row
`failed`. This is precisely the bug migration `20260706000001_scrape_only_pending.sql`
was written to fix for Shopify-sourced rows.

**Side effect worth noting.** The reference shop is womenswear, while the catalog
is currently 351 male to 65 female. Ingesting it materially rebalances the catalog.

## 6. Deduplication

424 pins across 64 collections will contain internal repeats, and merchant URLs
may already exist in `products` from other sources.

Upsert on **normalised URL**: lowercase the host, strip `www.`, strip a trailing
slash, and drop tracking parameters (`utm_*`, `srsltid`, `gclid`, `fbclid`).
Parameters that identify the product itself — `variant`, `color`, `ID`, `pid` —
are **kept**, because dropping them collapses genuinely different products onto
one URL. On conflict, keep the existing row and fill only columns that are
currently null: a ShopMy pin must never overwrite richer data from a real scrape.

This requires the unique index on normalised `url` that the ingest cost plan also
calls for. It lands as part of this work, as a migration, because without it the
upsert has no conflict target and concurrent runs will duplicate.

**The index cannot be created against current data.** Measured 2026-09-15: 534
rows normalise to 527 distinct values — **7 colliding pairs**, of which 12 of the
14 rows are `is_active = true`:

| Normalised URL | Rows | Active |
|---|---:|---:|
| `quince.com/men/men-s-100-linen-short-sleeve-shirt?color=…` | 2 | 2 |
| `florsheim.com/shop/style/14427-100.html` | 2 | 2 |
| `tommybahama.com/en/paradise-breezer-linen-short-sleeve-shirt/p/st327196-042` | 2 | 2 |
| `americantall.com/products/mens-tall-chino-10332-shorts-…` | 2 | 2 |
| `bananarepublicfactory.gapfactory.com/browse/product.do?pid=853468011…` | 2 | 2 |
| `amicicloset.com/products/10-5-stretch-chino-shorts-khaki-ap006…` | 2 | 1 |
| `boohooman.com/us/product/…_cmm24449?colour=stone&size=l` | 2 | 1 |

None has a `primary_video_url`, so none is currently feed-visible and merging them
has no user-facing effect. They must still be **merged, not deleted** — keep the
oldest row, copy any non-null column the loser has and the winner lacks, repoint
`catalog_products` and any other child rows, then delete the loser. This merge is
a prerequisite step in the same migration, before the index is created.

## 6a. Regression safety

The `products` table carries twelve triggers. A ShopMy row (`name` and `images`
set, `description` and `primary_image_url` null, `scrape_status='done'`) fires:

| Trigger | Fires? | Consequence |
|---|---|---|
| `scrape-new-products` | No — `WHEN scrape_status='pending'` | the reason §5 mandates `'done'` |
| `notify_enrich_similarity` | No — requires non-empty `description` | — |
| `products_haiku_context` | Not at insert (needs `primary_image_url`) | but `verify-product-image` sets that column, firing it per row afterwards |
| `trg_products_auto_verify_image` | **Yes** | `net.http_post` → Haiku call, image fetch, storage upload |
| `trg_products_auto_embed` | **Yes** | `net.http_post` → embedding call |
| `catalog_assign_product_trg` | **Yes** | `catalog_score_products()` runs synchronously inside the insert transaction |

At 424 rows that is roughly **1,270 edge-function invocations and ~850 Anthropic
calls**, fired as fast as the inserts commit. The Anthropic account exhausted its
credit on 2026-09-14, and these are the same functions existing products depend
on — so an unthrottled bulk insert degrades the rest of the catalog, not just the
new rows.

**Therefore ingest writes in throttled batches: 25 rows per batch, with a pause
between batches, never a single bulk insert.** The batch size and delay are
request parameters with those defaults so an operator can slow them further.
`dry_run` remains the first step on any new creator.

This constraint is the single most important thing the implementation must
respect. It is not an optimisation.

## 7. Error handling

Failures are classified rather than treated alike — the lesson from the scraper
audit, where a billing outage and a dead page were both written as
`scrape_status='failed'`.

| Condition | Handling |
|---|---|
| Pin missing a usable link, or missing both brand and price | **Skip with a reason.** Do not write a broken row. Expected for ~14% of pins. |
| Link is not a product page (cart, homepage, bare domain) | Skip with reason `non_product_url`, reusing `nonProductUrlReason()` — **but see the dependency below** |
| ShopMy returns 5xx or 429 | Retry with backoff, honouring `Retry-After` |
| A single collection fetch fails | Log and continue; one bad collection must not abort a 64-collection run |
| Curator or section not found | Return a clear error; write nothing |

Every run returns and logs one summary: collections fetched, pins seen, rows
inserted, rows merged, rows skipped grouped by reason.

**Blocking dependency — the `/s/` guard must be fixed first.**
`nonProductUrlReason()` (`app/utils/productUrl.ts:41,58`) rejects any path
starting `/s/` as an Amazon search. That is Nordstrom's and Nordstrom Rack's real
product URL shape, and it currently fails 34 of 34 such URLs in the catalog.
ShopMy pins point at whatever merchant the creator linked, Nordstrom included, so
reusing the helper unchanged would silently skip valid pins. Scope the `/s/` rule
to Amazon hosts — as the sibling `/dp/` rule already is — before wiring it in
here, or ingest inherits the bug.

**Politeness.** Concurrency capped at 4, an identifying User-Agent, and `Retry-After`
honoured. This is a public unauthenticated endpoint serving public storefronts, but
being a considerate client avoids an IP block mid-build.

## 8. Testing

One test file, assertions only, no framework, run against a checked-in fixture
captured from the live API (`sections`, one `collections` response, one
`/api/Collections/:id` response):

1. The Gucci pin maps `url` to the **Mytheresa PDP**, not the Rakuten
   `affiliate_link`, and leaves `affiliate_url` null.
2. The "Subtotal" pin, which has null brand and price and an Amazon cart link, is
   **skipped** and appears in the summary with a reason.
3. A URL appearing in two collections produces **one** row, not two.
4. Every mapped row carries `scrape_status='done'` and `is_active=false`.
5. `product.AllBrand_name` wins over `merchant_data.name` when both exist.

Capturing the fixture also guards against silent upstream API drift.

## 9. Out of scope

- **Creator onboarding.** The same engine can later sit behind
  `app/routes/import.tsx` (`?source=shopmy`), but that flow, its auth, and creator
  identity are a separate project.
- **Materialising sections and collections as `catalogs` rows.** Names are kept in
  `raw_data`; building the real hierarchy is a larger schema and UI change.
- **Per-pin deep scraping** for galleries and descriptions. Products arrive with a
  single image; promoting selected products to a full scrape is a follow-up.
- **Other platforms** (LTK, Linktree). The `ProfileCrawlsPanel` AI path still
  handles them.
- **Scheduled re-sync** of a shop. First version is operator-triggered only.

## 10. Open details

- **Gender inference.** Rows land with `gender = null`, which the constraint
  permits. Whether the existing enrichment reliably fills it for ShopMy rows is
  unverified; if it does not, a follow-up can infer gender from
  `Department_name` plus the curator.
- **Non-apparel sections.** "Home", "Dogs" and "Discount Codes" (73 pins combined)
  are not fashion products. The first version ingests whatever the URL addresses;
  a section allowlist may be wanted once real data is in.
- **`hasMoreCollections` pagination** returned `false` for every section tested.
  The implementation must still follow it rather than assume one page.

## 11. Rollout

Each step is verifiable before the next begins.

1. **Merge the 7 duplicate pairs, then create the unique index** (one migration).
   Verify: `select count(*) = count(distinct normalised_url) from products`.
2. **Fix the `/s/` guard** in both `productUrl.ts` and `agent.py`, and re-queue the
   34 Nordstrom rows. Verify: those rows leave `scrape_status='failed'`.
3. **Deploy `shopmy-ingest`.** Run `dry_run: true` against Section 409 and review
   all 123 mapped rows by eye.
4. **Ingest one collection (14 pins) for real.** Verify the trigger fan-out behaves:
   14 verify-product-image invocations, 14 embeds, images re-hosted to storage, no
   Anthropic errors, nothing written to `scrape_status='pending'`.
5. **Ingest the rest of Section 409 in throttled batches.** Watch `ai_usage_logs`
   and edge-function logs between batches.
6. **Wire the `ProfileCrawlsPanel` detection.** Verify a non-ShopMy profile URL
   still routes to the existing AI crawl.
7. **Ingest the remaining sections**, or a chosen subset (see §10 on non-apparel
   sections).

A rollback for any ingest run is `delete from products where source='shopmy' and
created_at > <run start>` — safe precisely because these rows never enter the feed
without a separate activation.
