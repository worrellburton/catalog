# ShopMy Creator Import

Status: **approved, ready for planning** · Date: 2026-09-16 · Branch: `dev`

Import a ShopMy creator storefront as a first-class creator: one `creators` row
plus their products, each product carrying that creator's own stable ShopMy
link. Driven by a five-step admin wizard at `/admin/creators`.

Follow-on to [`2026-09-15-shopmy-ingest-design.md`](./2026-09-15-shopmy-ingest-design.md),
which deliberately scoped creator onboarding out (§9). This spec takes that
piece up — and only that piece. Looks are explicitly out (§8).

---

## 1. Problem

The existing `shopmy-ingest` edge function reads a ShopMy storefront and writes
`products` rows tagged `source='shopmy'`. Measured on production 2026-09-16:
677 rows across three curators, 0 active.

Three things are missing.

**The creator does not exist.** Nothing writes a `creators` row, so the person
whose taste produced those 677 curated products is not an entity in our system.
They cannot be followed, cannot be linked to, and have no page.

**The products are not attributable.** The curator's username lives in
`raw_data.shopmy.curator`, which is a provenance breadcrumb, not a relationship:
it is unindexed, JSON-nested, and — because the whole `shopmy` key is replaced
on every upsert — destroyed the moment a second curator pins the same product.

**The links credit nobody.** `products.url` holds the clean merchant URL. On a
clickout that takes the Shopnomix wrap (`app/services/affiliate.ts:158-164`),
which pays the platform and gives the creator nothing. For a creator we have
imported but not yet signed, that is backwards: the traffic is the pitch.

## 2. What ShopMy serves for a creator

Measured against `https://shopmy.us/shop/justbobbidotcom` on 2026-09-16, using
the same `Origin: https://shopmy.us` header the product ingest already relies on.

### 2.1 The creator record

`GET /api/Collections/:id` returns a `user` block alongside the pins:

```jsonc
{
  "id": 446,
  "name": "Bobbi Brown",
  "username": "justbobbidotcom",
  "image": "https://production-shopmyshelf-uploads.s3.us-east-2.amazonaws.com/img-user-deres-446-1726690629276",
  "description": "Makeup Artist, Entrepreneur, Hotelier\nBeauty is my job. Curiosity is my hobby.\n…",
  "social_links": "https://www.instagram.com/justbobbidotcom/,https://substack.com/@bobbibrown,"
}
```

That is a complete creator: display name, handle, avatar, bio.

The shop-level list (`GET /api/Shop/Collections`) carries only `User_id`,
`User_username`, `User_name` and `User_image` on each collection row — **no
bio**. The bio therefore requires one collection fetch, which every run already
performs. No extra request.

The avatar is a raw S3 URL with the same `403 AccessDenied` problem as pin
images and the same fix: `cdnImageUrl()` rewrites it to
`https://static.shopmy.us/uploads/<key>`, verified HTTP 200.

### 2.2 The stable per-pin link

`https://go.shopmy.us/p-<pin_id>` is a permanent, creator-scoped short link.
Measured across 24 pins spanning four sections: **24 of 24 redirect, zero
failures.** Seven resolved through ShopMy's click tracker carrying the creator's
own id —

```
302 → https://apiv3.shopmy.us/api/redirect_click
        ?clickId=<fresh uuid>
        &cid=user-446-pin-51354524-puser-null-src-ql
        &url=<merchant pdp>…utm_campaign=Bobbi%20Brown…
```

— and seventeen redirected straight to the merchant with `utm_source=shopmy`.

The seven were exactly the pins whose `merchant_data.source` is `shopmyshelf`;
the seventeen were `rakuten`, `impact`, `cj`, `partnerize`, `amazon` and null.

**Do not branch on that split.** The measurement was taken from an Indian IP —
the pin payload echoes `"geo": {"country": "IN"}` — and ShopMy very likely gates
its network merchants on geography. Real shoppers are US. The link is valid,
stable and creator-scoped in every case; ShopMy decides monetisation at click
time, from the shopper's own request. Encoding a monetisation heuristic derived
from the wrong country would be a bug dressed as an optimisation.

This matters because it makes the link **derivable**. The previous spec
deliberately discarded ShopMy's `affiliate_link` field: it embeds a fresh
`clickId` UUID on every fetch, so storing it made each re-sync look like a
change and re-fired the products trigger fan-out
(`supabase/functions/_shared/shopmy.ts:214-216`). `go.shopmy.us/p-<pin_id>` has
no such component — it is a pure function of `pin_id`, which we already capture.

### 2.3 Shape of one shop

| Section | Type | Collections | With cover image | Pins |
|---|---|---:|---:|---:|
| Favorites | shelf | 13 | 0 | 78 |
| Bobbi's Closet | shelf | 14 | 1 | 123 |
| Health & Wellness | shelf | 2 | 0 | 19 |
| Home | shelf | 5 | 0 | 58 |
| Dogs | shelf | 3 | 0 | 9 |
| Substack | editorial | 3 | 1 | 28 |
| Shop My Ig | post | 12 | 12 | 37 |
| Jones Road | shelf | 6 | 0 | 67 |
| Discount Codes | editorial | 6 | 0 | 6 |
| **Total** | | **64** | **14** | **425** |

Two observations shape the design. Only 14 of 64 collections carry an image at
all (§8 explains why that kills looks). And 73 pins — Home, Dogs, Discount
Codes — are not fashion, which is why section selection is a wizard step rather
than a post-import cleanup.

## 3. Decisions

| Question | Decision |
|---|---|
| Looks | **Out of scope.** No `looks` or `looks_creative` rows. See §8. |
| Creator ↔ product link | **A new `creator_products` join table.** Not `raw_data`, not a column on `products`. See §4.1. |
| Where the ShopMy link is stored | **`creator_products.affiliate_url`**, not `products.affiliate_url`. See §4.1 and §5.2. |
| Creator identity | **A `creators` row with no auth user.** `id` is a plain uuid; `looks.user_id` stays null. Verified viable — see §4.2. |
| Edge function | **Extend `shopmy-ingest`** with additive fields rather than fork a second function. |
| Wizard home | **`/admin/creators`**, replacing the mock page that lives there today. |
| Who earns | **The creator, through ShopMy.** The platform earns nothing on these clickouts. Deliberate — see §7. |

## 4. Architecture

### 4.1 Why a join table

`products` rows are deduplicated on `normalize_product_url()`
(`supabase/migrations/20260915000000_normalize_product_url.sql:19-44`) and are
therefore **shared across creators**, while `products.affiliate_url` is a single
scalar. Two creators who pin the same item cannot both be credited by any
single-valued column on `products`. Today that is theoretical — across the three
live curators, zero normalised URLs collide — but it is structural, and the
whole point of storing a per-creator link is per-creator attribution.

`raw_data.shopmy` is not an alternative: the mapper replaces the entire key on
every upsert (`_shared/shopmy.ts:209-220`), so a second curator's ingest
silently overwrites the first curator's `pin_id`.

One table resolves the relationship and the link together:

```sql
create table public.creator_products (
  creator_handle  text not null references public.creators(handle) on delete cascade,
  product_id      uuid not null references public.products(id)     on delete cascade,
  source          text not null default 'shopmy',
  shopmy_pin_id   bigint,
  affiliate_url   text,           -- https://go.shopmy.us/p-<pin_id>
  collection_name text,
  section_name    text,
  sort_order      int  not null default 0,
  created_at      timestamptz not null default now(),
  primary key (creator_handle, product_id)
);

create index creator_products_handle_order_idx
  on public.creator_products (creator_handle, sort_order);
```

RLS mirrors `products`: a public `SELECT` policy, and **no client write policy
at all**, so writes are service-role only. The composite primary key is the
idempotency key — a re-run upserts in place.

Two nullable columns go onto `creators`:

```sql
alter table public.creators
  add column source     text,     -- 'shopmy'
  add column source_url text;     -- the shop URL the import came from
```

`source_url` is what lets the wizard say *"already imported — will update"*, and
what a future scheduled re-sync would read. Neither column changes existing
behaviour.

**No socials column.** ShopMy hands us `social_links`, but nothing in the
consumer app renders socials from `creators` — `CreatorPage` reads
`profiles.instagram_handle` / `tiktok_handle`, and those are populated on zero
rows. Adding a column nothing reads is debt. Revisit when a surface wants it.

### 4.2 A creator with no auth user

Every one of the 42 live `creators` rows has an `id` that is also an
`auth.users` id, and several mechanisms assume it: the `creators_owner_update_theme`
RLS policy (`id = auth.uid()`), the profile→creator avatar sync trigger, and
`looks_sync_creator_handle()`.

An imported creator has no auth user, so its `id` is a plain
`gen_random_uuid()`. Verified consequences:

- **Follows work.** `creator_follows` keys on `followee_handle` (text), not on
  an id (`supabase/migrations/20260526000001_creator_follows.sql:5-15`).
- **The creator page works.** `CreatorPage` fetches `profiles` by the owner id
  of the first look and `creators` by handle, then merges preferring the
  profile. With no looks there is no owner id, so the `creators` row supplies
  display name and avatar unopposed (`CreatorPage.tsx:640-680`).
- **Theme editing is unavailable.** Nobody can satisfy `id = auth.uid()`, so
  `catalog_theme` / `catalog_hue` stay at defaults. Acceptable: those are
  self-service settings for a signed creator.
- **The avatar sync trigger never fires.** It keys on a `profiles` update, and
  there is no profile. The avatar we import is the avatar that stays — which is
  what we want.

### 4.3 Edge function

`shopmy-ingest` gains three additive request fields. Every existing caller is
unaffected, because all three default to the current behaviour.

| Field | Default | Meaning |
|---|---|---|
| `include_creator` | `false` | upsert the `creators` row and the `creator_products` rows |
| `section_ids: number[]` | `null` | ingest this subset of sections (today only a single `section_id` is accepted) |
| — | — | the `dry_run` response gains a `creator` block for the wizard's step 2 |

Two new pure functions in `_shared/shopmy.ts`, unit-tested against the existing
checked-in fixture:

- `mapCurator(user)` → `{ handle, display_name, avatar_url, bio }`. Rewrites the
  avatar through the existing `cdnImageUrl()`, and **normalises the handle**:
  lowercase, strip a leading `@`, kebab-case. This is not cosmetic.
  `creators.handle` is a case-**sensitive** unique btree, while
  `CreatorAvatarFollow` resolves handles with `ilike`
  (`app/components/CreatorAvatarFollow.tsx:16-28`) — so `JustBobbi` and
  `justbobbi` can both be inserted and then resolve ambiguously.
- `pinAffiliateUrl(pinId)` → `https://go.shopmy.us/p-${pinId}`.

Write order within a run: `creators` first, then the existing throttled product
batches, then `creator_products` per batch. The join table's FK to
`creators(handle)` requires the creator to exist first; its FK to `products(id)`
requires the product ids the batch just returned.

The existing throttle is preserved unchanged. It is not an optimisation —
§6a of the previous spec measured an unthrottled 424-row insert at roughly 1,270
edge invocations through the product trigger fan-out.

### 4.4 Consumer wiring

Two changes, both small.

**`Product` gains `affiliate_url?: string`** (`app/data/looks.ts:1`), and
`affiliateRedirect` gains a Rail 0 (`app/services/affiliate.ts:119-165`).

It must be folded into the existing rail computation, **not** added as an early
return. `affiliateRedirect` returns a bare `string`, and it writes the
`affiliate_clicks` row *before* returning (`affiliate.ts:131-152`) — an early
return ahead of that insert would silently drop clickout telemetry for exactly
the products this feature adds. The existing `tracked` variable already does the
right thing: it suppresses the wrap and is returned untouched at `:156`.

```ts
// param type widens to include affiliate_url
const creatorLink = product?.affiliate_url ?? null;
const tracked = creatorLink ?? (product?.id ? trackedByProduct.get(product.id) ?? null : null);
const wrappable = !tracked && isWrappable(url);
const rail = creatorLink ? 'shopmy'
           : tracked    ? 'affiliate.com'
           : wrappable  ? 'shopnomix'
                        : 'direct';
```

No new prefetch. Rail 1 works off a fire-and-forget session query capped at 2000
rows (`affiliate.ts:66-79`), which silently degrades to the Shopnomix wrap for
any product past the cap; Rail 0 avoids that entirely because the link arrives
on the product object the page already fetched. `affiliate_clicks.rail` is
nullable free text with no CHECK constraint (verified live), so `'shopmy'` needs
no migration.

**`CreatorPage` unions `creator_products` into the Shop tab.** The handle-branch
effect (`CreatorPage.tsx:442-574`) today derives `userProducts` purely from
`look_products`. It gains a second fetch — `creator_products → products` for
this handle, ordered by `sort_order` — unioned into the same list under the
existing `${brand}::${name}` dedup key. A creator can have both looks and
imported products; the union covers both.

Nothing else changes. The Shop tab, its brand chips, and the
`creatorLooks.length === 0` empty state already exist
(`CreatorPage.tsx:1037,1068`) — they simply have something to show.

## 5. The wizard

### 5.1 `/admin/creators` becomes real

`app/routes/admin/creators.tsx` is 75 lines of hardcoded mock arrays with zero
Supabase calls, and the sidebar links four invented handles. It is replaced by a
live list — handle, display name, avatar, source, product count, look count —
with an **Import from ShopMy** button.

This is in scope rather than incidental: the feature needs an obvious home, and
a page that lies about the contents of the database is a worse foundation than
no page.

### 5.2 Steps

Steps 4 and 5 reuse `ShopMyIngest.tsx` wholesale — its `dry_run` preview call,
its `crawl_jobs` polling, its progress bar, its skip summary and its
double-submit guard. Only steps 1–3 are new.

1. **URL.** Paste a ShopMy shop URL. `parseShopMyUrl()` already handles all
   three shapes in the wild: `/shop/<username>`, the bare `/<username>`, and
   `/shop?Curator_id=<digits>`.
2. **Creator.** The resolved card — avatar, display name, handle, bio — with
   every field editable before commit. Looks up the normalised handle and, on a
   hit, switches to *"already imported — will update"*, showing which fields
   would change.
3. **Sections.** A checkbox list with live collection and pin counts, all
   selected by default. This is where *Home*, *Dogs* and *Discount Codes* get
   dropped — 73 non-apparel pins on the reference shop — instead of being
   imported and cleaned up afterwards.
4. **Preview.** The existing `dry_run` output: mapped rows, plus skips grouped
   by reason (roughly 14% of pins are incomplete).
5. **Import.** The existing throttled batch run with live progress, then a
   result summary.

## 6. Idempotency

Every write in the run has a natural key, so re-importing a shop is safe and
converges rather than duplicating:

| Table | Key | On conflict |
|---|---|---|
| `creators` | `handle` (unique) | update display name, avatar, bio, `source_url` |
| `products` | `normalize_product_url(url)` | existing behaviour — fill only null columns |
| `creator_products` | `(creator_handle, product_id)` | update pin id, affiliate URL, collection, sort order |

This is worth stating explicitly because it is the one place the looks decision
pays off twice. `looks` has **no** usable natural key — its only unique indexes
are on `id`, `legacy_id` and a partial on `source_generation_id`, whose FK
cascades from `user_generations`. Any design that created looks would have
needed a new dedup key or would have duplicated silently on every re-run.
Skipping looks makes that problem not exist.

## 7. What this costs us

`go.shopmy.us/p-<pin_id>` credits the creator's ShopMy account. Our Shopnomix
rail credits the platform. Routing imported products through ShopMy therefore
**forfeits platform revenue on those clickouts**, by design: the traffic is the
pitch to a creator who has not signed with us, and a link that pays them is a
more honest artefact than one that pays us while wearing their name.

Two properties bound the cost. It applies only to products imported by this
wizard — every other product keeps its existing rails untouched. And Rail 0 is
per-product data, not a global switch, so reverting is an `UPDATE
creator_products SET affiliate_url = NULL`, not a code change.

Worth knowing: Rail 1 has never fired in production. Zero active products carry
an `affiliate_url`, and `affiliate_clicks` records only `shopnomix` and `direct`.
Rail 0 will be the first per-product link rail that actually executes.

## 8. Why no looks

Both consumer surfaces that render looks join `looks_creative` with `!inner` and
require a playable video:

- the home feed — `app/services/looks.ts:157-203` joins
  `looks_creative!inner`, filters `.eq('looks_creative.is_primary', true)`, and
  then keeps only rows where `primary?.video_url && row.status === 'live'`
  (`:210-219`);
- the creator page — the same `!inner` + `is_primary` join
  (`CreatorPage.tsx:448-458`).

`look_photos` is read only by the creator studio (`MyLooks`, `LookForm`,
`manage-looks`), never by a consumer surface. So **a look without a video is
invisible everywhere a shopper can see.**

ShopMy has no video, and only 14 of 64 collections carry so much as a cover
image. Making ShopMy collections into looks would therefore require either
widening the app's most load-bearing query to accept image-only creatives, or
generating a video per collection through the Fal pipeline. Both are real
projects with real risk, and neither is required to import a creator and their
products. Deferred to its own spec.

## 9. Testing

Pure functions, assertions only, no framework — matching the existing
`_shared/shopmy.test.ts`:

1. `mapCurator` maps ShopMy's `user` block to creator fields and rewrites the S3
   avatar to `static.shopmy.us`.
2. `mapCurator` normalises `@JustBobbi` and `JustBobbi` to the same handle.
3. `pinAffiliateUrl(51354524)` is `https://go.shopmy.us/p-51354524`, and the
   value contains no `clickId` — the property that made the previous spec
   discard ShopMy's own `affiliate_link` field.
4. `affiliateRedirect` returns a product's `affiliate_url` untouched and
   unwrapped, rather than the Shopnomix wrap — and still records a click row,
   with `rail='shopmy'` and `wrapped=false`. The telemetry half is the point:
   the obvious implementation (an early return) passes the link assertion and
   fails this one.
5. The wizard's step reducer refuses to advance past step 3 with zero sections
   selected.

## 10. Out of scope

- **Looks.** §8.
- **Scheduled re-sync** of a shop. `creators.source_url` makes it possible
  later; this version is operator-triggered only.
- **Discovery surfaces.** An imported creator is reachable by URL and
  followable, but follow rails and the creator constellation key on looks, so
  they will not appear there until they have some.
- **Activation.** Imported products still need `is_active`, and the main feed
  additionally demands `primary_video_url`
  (`app/services/product-creative.ts:386-387`). The wizard imports and links;
  activation stays the existing admin gate.
- **Claiming.** Converting an imported creator into a signed one — attaching an
  auth user to an existing `creators` row — is a separate project.

## 11. Rollout

1. **Migration**: `creator_products` + the two `creators` columns. Verify RLS
   allows public read and blocks client writes.
2. **Shared mappers + tests**: `mapCurator`, `pinAffiliateUrl`. Verify against
   the fixture before anything calls them.
3. **Edge function**: the three additive fields. Verify an existing-shape
   request still behaves identically.
4. **Dry run** against one section of a known shop; review the creator block and
   a sample of `affiliate_url` values by eye.
5. **Import one small section for real.** Verify one `creators` row, N
   `creator_products` rows, and that the product trigger fan-out matches the row
   count.
6. **Consumer wiring**: Rail 0 and the CreatorPage union. Verify a clickout on
   an imported product opens `go.shopmy.us` and records `rail='shopmy'`.
7. **Wizard**: the real `/admin/creators` list, then steps 1–3.
8. **Import the remaining sections.**

Rollback for any import is `delete from creator_products where creator_handle =
'<handle>'` plus the existing `delete from products where source='shopmy' and
created_at > <run start>` — safe because none of these rows reach the feed
without a separate activation.
