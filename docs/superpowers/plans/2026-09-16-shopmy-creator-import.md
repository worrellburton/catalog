# ShopMy Creator Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import a ShopMy creator storefront as a first-class creator — one `creators` row plus their products, each carrying that creator's own stable ShopMy link — driven by a five-step admin wizard at `/admin/creators`.

**Architecture:** The existing `shopmy-ingest` edge function gains three additive request fields and writes two new things alongside the products it already writes: a `creators` row and a `creator_products` join row per product. A new join table exists because `products` are deduplicated on normalised URL and therefore shared between creators, so no single-valued column on `products` can attribute two curators who pin the same item. On the consumer side the creator's link becomes a new first rail in the clickout router, and the creator page unions those products into its Shop tab.

**Tech Stack:** Supabase Postgres + edge functions (Deno), Remix v2 SPA + React 19, vanilla CSS. Two test runners: `deno test` for `supabase/functions/_shared/*`, `vitest` for everything under `app/`.

**Spec:** [`docs/superpowers/specs/2026-09-16-shopmy-creator-import-design.md`](../specs/2026-09-16-shopmy-creator-import-design.md)

## Global Constraints

- **Branch is `dev`.** Commit directly to it. Never create a feature or session branch. Never force-push.
- **Throttling is not optional.** The existing 25-row batch cap and 1500 ms inter-batch delay in `shopmy-ingest` must survive every change. Each inserted product fires `trg_products_auto_verify_image` and `trg_products_auto_embed`, each a `net.http_post`. An unthrottled 424-pin shop is ~1,270 edge invocations.
- **Every new request field defaults to current behaviour.** `include_creator` defaults `false`, `section_ids` defaults `null`. An existing caller's request body must produce a byte-identical outcome.
- **Never overwrite a non-ShopMy creator.** A `creators` row whose `source` is not `'shopmy'` is a real signed creator. The import fails closed rather than clobbering their display name, avatar or bio.
- **Do not write `products.affiliate_url`.** `affiliate-enrich` unconditionally nulls that column on every active row it sweeps at 09:30 UTC (`supabase/functions/affiliate-enrich/index.ts:135-139`).
- **Do not edit an applied migration file.** `create or replace` in a new migration instead, matching the note at `supabase/migrations/20260915000002_shopmy_upsert_noop_guard.sql:22-23`.
- **Handles are normalised** to lowercase, no leading `@`, kebab-case. `creators.handle` is a case-**sensitive** unique btree while `CreatorAvatarFollow` resolves with `ilike` (`app/components/CreatorAvatarFollow.tsx:16-28`).
- The ShopMy link shape is exactly `https://go.shopmy.us/p-<pin_id>` — no query string, no `clickId`.
- Migrations are applied with `mcp__supabase__apply_migration` against project ref `vtarjrnqvcqbhoclvcur`, and the SQL file is also committed under `supabase/migrations/`.

---

## File Structure

**Create:**

| File | Responsibility |
|---|---|
| `supabase/migrations/20260916000000_creator_products.sql` | `creator_products` table + RLS, two `creators` columns, the `shopmy_link_creator_products` RPC |
| `app/services/creator-products.ts` | One function: fetch a creator's imported products as `Product[]`. Nothing else. |
| `app/services/creator-products.test.ts` | vitest for the row→`Product` mapper |
| `app/services/affiliate.rail.test.ts` | vitest for the rail-picking decision |
| `app/services/creators.ts` | Admin-side creator list query |
| `app/components/shopmy-wizard-state.ts` | Pure step reducer for the wizard — no React, no I/O |
| `app/components/shopmy-wizard-state.test.ts` | vitest for the reducer |
| `app/components/ShopMyImportWizard.tsx` | The five-step wizard shell; delegates steps 4–5 to `ShopMyIngest` |

**Modify:**

| File | Change |
|---|---|
| `supabase/functions/_shared/shopmy.ts` | add `mapCurator`, `pinAffiliateUrl`, `ShopMyUser` |
| `supabase/functions/_shared/shopmy.test.ts` | add five Deno tests |
| `supabase/functions/shopmy-ingest/index.ts` | `include_creator`, `section_ids`, creator block in the dry-run response, creator + link writes |
| `app/data/looks.ts` | `Product.affiliate_url?: string` |
| `app/services/affiliate.ts` | extract `pickRail`, add Rail 0 |
| `app/components/CreatorPage.tsx` | union imported products into `userProducts` |
| `app/routes/admin/creators.tsx` | replace mock arrays with a live list + Import button |
| `app/routes/admin/route.tsx:171-175` | drop the four invented creator handles from the nav |

**Task order is dependency order.** Tasks 1→3 build the write path bottom-up; 4→5 the read path; 6→8 the UI. Tasks 4 and 5 do not depend on 2 or 3 and may be done in parallel with them.

---

### Task 1: The `creator_products` table

**Files:**
- Create: `supabase/migrations/20260916000000_creator_products.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: table `public.creator_products (creator_handle text, product_id uuid, source text, shopmy_pin_id bigint, affiliate_url text, collection_name text, section_name text, sort_order int, created_at timestamptz)`, PK `(creator_handle, product_id)`; columns `public.creators.source text`, `public.creators.source_url text`; RPC `public.shopmy_link_creator_products(p_handle text, rows jsonb) returns jsonb` where each element of `rows` is `{url, pin_id, affiliate_url, collection_name, section_name, sort_order}` and the return is `{"linked": <int>, "missing": <int>}`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260916000000_creator_products.sql`:

```sql
-- Per-creator product attribution for imported storefronts.
--
-- products rows are deduplicated on normalize_product_url() and are therefore
-- SHARED between creators, while products.affiliate_url is a single scalar.
-- Two creators who pin the same item cannot both be credited by any
-- single-valued column on products, so the relationship gets its own table.
--
-- raw_data.shopmy is not an alternative: shopmy_upsert_batch replaces that
-- whole key on every upsert, so a second curator's ingest silently overwrites
-- the first curator's pin_id.

create table if not exists public.creator_products (
  creator_handle  text not null references public.creators(handle) on delete cascade,
  product_id      uuid not null references public.products(id)     on delete cascade,
  source          text not null default 'shopmy',
  shopmy_pin_id   bigint,
  affiliate_url   text,
  collection_name text,
  section_name    text,
  sort_order      int  not null default 0,
  created_at      timestamptz not null default now(),
  primary key (creator_handle, product_id)
);

create index if not exists creator_products_handle_order_idx
  on public.creator_products (creator_handle, sort_order);

alter table public.creator_products enable row level security;

-- Mirrors products: the catalog is public, writes are service-role only.
-- Deliberately NO insert/update/delete policy — RLS with no permissive
-- policy denies every non-service-role write.
drop policy if exists "Public read creator_products" on public.creator_products;
create policy "Public read creator_products"
  on public.creator_products for select using (true);

-- Provenance on the creator itself. source_url is what lets the wizard say
-- "already imported - will update", and what a future re-sync would read.
alter table public.creators add column if not exists source     text;
alter table public.creators add column if not exists source_url text;

-- Link a batch of already-upserted products to a creator.
--
-- Resolves product_id by the SAME normalize_product_url() key the products
-- unique index uses, because shopmy_upsert_batch cannot return ids: its
-- no-op guard (20260915000002) means an unchanged row produces no RETURNING
-- row at all, so an idempotent re-run would link nothing.
--
-- affiliate_url is passed in, not built here, so the go.shopmy.us shape has
-- exactly one definition (pinAffiliateUrl in _shared/shopmy.ts) with one test.
create or replace function public.shopmy_link_creator_products(
  p_handle text,
  rows     jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_linked  int := 0;
  v_seen    int := 0;
begin
  if jsonb_typeof(rows) <> 'array' then
    raise exception 'rows must be a jsonb array';
  end if;

  select jsonb_array_length(rows) into v_seen;

  with incoming as (
    select distinct on (public.normalize_product_url(e->>'url'))
      public.normalize_product_url(e->>'url') as nurl,
      (e->>'pin_id')::bigint                  as pin_id,
      e->>'affiliate_url'                     as affiliate_url,
      e->>'collection_name'                   as collection_name,
      e->>'section_name'                      as section_name,
      coalesce((e->>'sort_order')::int, 0)    as sort_order
    from jsonb_array_elements(rows) with ordinality as t(e, ord)
    order by public.normalize_product_url(e->>'url'), ord
  ),
  resolved as (
    select p.id as product_id, i.*
      from incoming i
      join public.products p
        on public.normalize_product_url(p.url) = i.nurl
  ),
  upserted as (
    insert into public.creator_products
      (creator_handle, product_id, source, shopmy_pin_id, affiliate_url,
       collection_name, section_name, sort_order)
    select p_handle, r.product_id, 'shopmy', r.pin_id, r.affiliate_url,
           r.collection_name, r.section_name, r.sort_order
      from resolved r
    on conflict (creator_handle, product_id) do update set
      shopmy_pin_id   = excluded.shopmy_pin_id,
      affiliate_url   = excluded.affiliate_url,
      collection_name = excluded.collection_name,
      section_name    = excluded.section_name,
      sort_order      = excluded.sort_order
    returning 1
  )
  select count(*) into v_linked from upserted;

  return jsonb_build_object('linked', v_linked, 'missing', v_seen - v_linked);
end $$;

revoke all on function public.shopmy_link_creator_products(text, jsonb) from public, anon, authenticated;
grant execute on function public.shopmy_link_creator_products(text, jsonb) to service_role;
```

- [ ] **Step 2: Apply it**

Apply with `mcp__supabase__apply_migration`, name `creator_products`, passing the file's SQL verbatim.

- [ ] **Step 3: Verify the schema landed**

Run via `mcp__supabase__execute_sql`:

```sql
select
  (select count(*) from information_schema.columns
     where table_schema='public' and table_name='creator_products')                      as cp_cols,
  (select count(*) from pg_policies
     where schemaname='public' and tablename='creator_products')                          as cp_policies,
  (select count(*) from information_schema.columns
     where table_schema='public' and table_name='creators'
       and column_name in ('source','source_url'))                                        as creators_new_cols,
  (select count(*) from pg_proc
     where proname='shopmy_link_creator_products')                                        as rpc;
```

Expected: `cp_cols=8`, `cp_policies=1`, `creators_new_cols=2`, `rpc=1`.

- [ ] **Step 4: Verify the RPC links and is idempotent**

Run via `mcp__supabase__execute_sql`. This uses a real existing ShopMy product and a throwaway creator, then cleans up:

```sql
begin;
insert into public.creators (handle, display_name, source)
values ('zz-plan-probe', 'Plan Probe', 'shopmy');

with p as (select url from public.products where source='shopmy' limit 1)
select public.shopmy_link_creator_products(
  'zz-plan-probe',
  (select jsonb_build_array(jsonb_build_object(
     'url', p.url, 'pin_id', 999001,
     'affiliate_url', 'https://go.shopmy.us/p-999001',
     'collection_name', 'Probe', 'section_name', 'Probe', 'sort_order', 0)) from p)
) as first_call;

with p as (select url from public.products where source='shopmy' limit 1)
select public.shopmy_link_creator_products(
  'zz-plan-probe',
  (select jsonb_build_array(jsonb_build_object(
     'url', p.url, 'pin_id', 999001,
     'affiliate_url', 'https://go.shopmy.us/p-999001',
     'collection_name', 'Probe', 'section_name', 'Probe', 'sort_order', 0)) from p)
) as second_call;

select count(*) as rows_after_two_identical_calls
  from public.creator_products where creator_handle='zz-plan-probe';
rollback;
```

Expected: both calls return `{"linked": 1, "missing": 0}`, and `rows_after_two_identical_calls = 1`. The `rollback` leaves no trace.

- [ ] **Step 5: Verify RLS denies a client write**

```sql
select count(*) as write_policies from pg_policies
 where schemaname='public' and tablename='creator_products'
   and cmd in ('INSERT','UPDATE','DELETE','ALL');
```

Expected: `write_policies = 0`.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260916000000_creator_products.sql
git commit -m "feat(db): creator_products join table for per-creator attribution

products are deduped on normalize_product_url and therefore shared between
creators, while products.affiliate_url is a single scalar - so no column on
products can attribute two curators who pin the same item. The link RPC
resolves product ids by the same normalised key rather than by the upsert's
RETURNING rows, because the no-op guard means an unchanged row returns none
and an idempotent re-run would link nothing.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: `mapCurator` and `pinAffiliateUrl`

**Files:**
- Modify: `supabase/functions/_shared/shopmy.ts`
- Test: `supabase/functions/_shared/shopmy.test.ts`

**Interfaces:**
- Consumes: the existing private `cdnImageUrl(raw: string): string` in the same file.
- Produces:
  - `export interface ShopMyUser { id?: number | null; name?: string | null; username?: string | null; image?: string | null; description?: string | null }`
  - `export interface MappedCurator { handle: string; display_name: string; avatar_url: string | null; bio: string | null }`
  - `export function mapCurator(user: ShopMyUser): MappedCurator | null`
  - `export function pinAffiliateUrl(pinId: number): string`

- [ ] **Step 1: Write the failing tests**

Append to `supabase/functions/_shared/shopmy.test.ts`, and add `mapCurator, pinAffiliateUrl` to the existing import on line 2:

```ts
Deno.test('mapCurator maps ShopMy user block to creator fields', () => {
  const r = mapCurator({
    id: 446,
    name: 'Bobbi Brown',
    username: 'justbobbidotcom',
    image: 'https://production-shopmyshelf-uploads.s3.us-east-2.amazonaws.com/img-user-deres-446-1726690629276',
    description: 'Makeup Artist, Entrepreneur, Hotelier',
  });
  assert(r?.handle === 'justbobbidotcom', 'handle');
  assert(r?.display_name === 'Bobbi Brown', 'display_name');
  assert(r?.bio === 'Makeup Artist, Entrepreneur, Hotelier', 'bio');
  assert(
    r?.avatar_url === 'https://static.shopmy.us/uploads/img-user-deres-446-1726690629276',
    'avatar must be rewritten to the CDN — the raw S3 object returns 403 to anyone',
  );
});

Deno.test('mapCurator normalises handle case, a leading @, and spaces', () => {
  // creators.handle is a case-SENSITIVE unique btree while CreatorAvatarFollow
  // resolves with ilike, so two case variants can both insert and then resolve
  // ambiguously. All three of these must collapse to one handle.
  assert(mapCurator({ username: '@JustBobbi', name: 'B' })?.handle === 'justbobbi', 'strips @ and lowercases');
  assert(mapCurator({ username: 'JustBobbi', name: 'B' })?.handle === 'justbobbi', 'lowercases');
  assert(mapCurator({ username: 'Just Bobbi', name: 'B' })?.handle === 'just-bobbi', 'kebabs spaces');
});

Deno.test('mapCurator falls back to the handle when ShopMy has no name', () => {
  // creators.display_name is NOT NULL, so an empty name cannot pass through.
  const r = mapCurator({ username: 'justbobbidotcom', name: null });
  assert(r?.display_name === 'justbobbidotcom', 'display_name falls back to the handle');
});

Deno.test('mapCurator rejects a user block with no usable username', () => {
  assert(mapCurator({ name: 'Bobbi Brown' }) === null, 'no username');
  assert(mapCurator({ username: '   ', name: 'B' }) === null, 'blank username');
  assert(mapCurator({ username: '@@@', name: 'B' }) === null, 'nothing survives normalisation');
});

Deno.test('pinAffiliateUrl is a pure function of the pin id, with no clickId', () => {
  const u = pinAffiliateUrl(51354524);
  assert(u === 'https://go.shopmy.us/p-51354524', 'exact shape');
  // The reason this replaces ShopMy's own affiliate_link field: that one
  // embeds a fresh clickId UUID per fetch, so storing it made every re-sync
  // look like a change and re-fired the products trigger fan-out.
  assert(!u.includes('clickId') && !u.includes('?'), 'must carry no rotating component');
  assert(pinAffiliateUrl(51354524) === u, 'stable across calls');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `deno test --no-check --allow-read supabase/functions/_shared/shopmy.test.ts`

Expected: FAIL — `The requested module './shopmy.ts' does not provide an export named 'mapCurator'`.

- [ ] **Step 3: Implement**

Append to `supabase/functions/_shared/shopmy.ts`:

```ts
export interface ShopMyUser {
  id?: number | null;
  name?: string | null;
  username?: string | null;
  image?: string | null;
  description?: string | null;
}

export interface MappedCurator {
  handle: string;
  display_name: string;
  avatar_url: string | null;
  bio: string | null;
}

/**
 * `creators.handle` is a case-SENSITIVE unique btree, but
 * CreatorAvatarFollow resolves handles with `ilike`
 * (app/components/CreatorAvatarFollow.tsx:16-28). Without normalising here,
 * "JustBobbi" and "justbobbi" both insert and then resolve ambiguously.
 */
function normaliseHandle(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^@+/, '')
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** ShopMy's `user` block (from GET /api/Collections/:id) → a creators row. */
export function mapCurator(user: ShopMyUser): MappedCurator | null {
  const handle = normaliseHandle(user.username ?? '');
  if (!handle) return null;

  const avatar = user.image ? cdnImageUrl(user.image) : null;
  const bio = (user.description ?? '').trim();

  return {
    handle,
    // creators.display_name is NOT NULL — never let a blank ShopMy name through.
    display_name: (user.name ?? '').trim() || handle,
    avatar_url: avatar,
    bio: bio || null,
  };
}

/**
 * The creator's own stable ShopMy link for one pin. A permanent 302 into
 * ShopMy's redirect_click carrying `cid=user-<curatorId>-pin-<pinId>`.
 *
 * This is why we can store a link at all. ShopMy's own `affiliate_link` field
 * embeds a fresh `clickId` UUID on every fetch, so storing THAT made each
 * re-sync look like a change and re-fired the products trigger fan-out (see
 * the note in mapPin's raw_data block). This shape is a pure function of
 * `pin_id`, which we already capture.
 */
export function pinAffiliateUrl(pinId: number): string {
  return `https://go.shopmy.us/p-${pinId}`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `deno test --no-check --allow-read supabase/functions/_shared/shopmy.test.ts`

Expected: PASS, including the pre-existing `parseShopMyUrl` and `mapPin` tests.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/shopmy.ts supabase/functions/_shared/shopmy.test.ts
git commit -m "feat(shopmy): map the curator block and the stable per-pin link

pinAffiliateUrl is a pure function of pin_id, which is why it can be stored
at all - ShopMy's own affiliate_link field embeds a fresh clickId per fetch.
mapCurator normalises the handle because creators.handle is a case-sensitive
unique index that CreatorAvatarFollow then resolves with ilike.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Edge function writes the creator and the links

**Files:**
- Modify: `supabase/functions/shopmy-ingest/index.ts`

**Interfaces:**
- Consumes: `mapCurator`, `pinAffiliateUrl`, `type ShopMyUser`, `type MappedCurator` (Task 2); RPC `shopmy_link_creator_products` (Task 1).
- Produces: request fields `include_creator: boolean`, `section_ids: number[]`, `creator_handle: string`; response fields `creator: MappedCurator | null`, `creator_written: boolean`, `linked: number`.

**Note on `MappedProduct`:** it carries `raw_data.shopmy.pin_id`, `collection_name` and `section_name` already (`_shared/shopmy.ts:209-220`), so the link rows are built from `unique` with no change to `mapPin`.

- [ ] **Step 1: Accept `section_ids` and fetch each section's collections**

In `supabase/functions/shopmy-ingest/index.ts`, replace lines 164–188 (the `// ── 1. sections + collections` block through the `collections.length === 0` guard) with:

```ts
    // ── 1. sections + collections ──────────────────────────────────────────
    // ShopMy returns only the FIRST section's collections when no Section_id
    // is given (measured: 13 of 64 for the reference shop), so a multi-section
    // import is genuinely one list call per section, not a filter.
    const requestedSections: (number | null)[] = Array.isArray(body.section_ids) && body.section_ids.length
      ? body.section_ids.map(Number).filter((n: number) => Number.isFinite(n))
      : [sectionId];

    async function listFor(sec: number | null) {
      const listUrl = new URL(`${API}/api/Shop/Collections`);
      // Curator_username and Curator_id are distinct upstream params — one is
      // never a substitute for the other (verified against the live API: a
      // numeric id passed as Curator_username returns success with an empty
      // list). Send exactly whichever identifier this shop resolved to.
      if (username) listUrl.searchParams.set('Curator_username', username);
      else listUrl.searchParams.set('Curator_id', String(curatorId));
      listUrl.searchParams.set('limit', '100');
      if (sec != null) listUrl.searchParams.set('Section_id', String(sec));
      return getJson(listUrl.toString());
    }

    const lists = await pooled(requestedSections, COLLECTION_CONCURRENCY, listFor);
    const sections: Array<{ id: number; title: string }> = lists[0]?.sections ?? [];
    const byId = new Map<number, { id: number; name: string; Section_id: number; User_username?: string | null }>();
    let hasMore = false;
    for (const l of lists) {
      // ShopMy paginates this list (`hasMoreCollections`); no paging parameter
      // (offset/cursor/page) is documented or evident on the response, so we
      // cannot request page 2. Surface the flag rather than silently ingesting
      // only page 1 and reporting a collection count that looks complete.
      if (l?.hasMoreCollections === true) hasMore = true;
      // Dedup by collection id — a section list can legitimately repeat one.
      for (const c of (l?.collections ?? [])) byId.set(c.id, c);
    }
    let collections = Array.from(byId.values());
    if (body.max_collections) collections = collections.slice(0, Number(body.max_collections));

    if (collections.length === 0) {
      return json({ success: false, error: `no collections for ${curatorLabel}` }, 404);
    }
    const sectionName = (id: number) => sections.find((s) => s.id === id)?.title ?? null;
```

- [ ] **Step 2: Capture the creator's user block while fetching pins**

The `user` block only appears on `GET /api/Collections/:id`, never on the shop-level list — and the run already fetches every collection detail, so this costs no extra request.

Immediately after `const failures: string[] = [];` (line 204), add:

```ts
    let curatorUser: ShopMyUser | null = null;
```

Inside the `pooled(collections, …)` callback, immediately after the `const ctx: PinContext = { … };` block, add:

```ts
      // Whichever collection lands first wins; every one carries the same user.
      if (!curatorUser && detail.user) curatorUser = detail.user as ShopMyUser;
```

Extend the import on line 14 to:

```ts
import {
  parseShopMyUrl, mapPin, mapCurator, pinAffiliateUrl,
  type PinContext, type MappedProduct, type ShopMyUser, type MappedCurator,
} from '../_shared/shopmy.ts';
```

- [ ] **Step 3: Put the creator in the summary**

Replace the `const summary = { … }` block (lines 242–248) with:

```ts
    // A wizard operator may retype the handle at step 2; their choice wins
    // over ShopMy's username, but still gets normalised by mapCurator.
    const mappedCurator: MappedCurator | null = curatorUser
      ? mapCurator(
          typeof body.creator_handle === 'string' && body.creator_handle.trim()
            ? { ...curatorUser, username: body.creator_handle }
            : curatorUser,
        )
      : null;

    const summary = {
      success: true, curator: username, section_id: sectionId,
      sections: sections.length, collections: collections.length,
      pins: pinCount, mapped: unique.length, skipped,
      failures: failures.length ? failures : undefined,
      has_more: hasMore,
      creator: mappedCurator,
    };
```

- [ ] **Step 4: Write the creator before the product batches**

Insert immediately after the `await patchJob(jobId, { status: 'crawling', … })` call (which currently ends at line 264):

```ts
    // ── 3a. creator ────────────────────────────────────────────────────────
    // Fails CLOSED on a collision with a real creator. A creators row whose
    // source is not 'shopmy' belongs to a signed-up person; silently
    // overwriting their display name, avatar and bio with a scraped
    // storefront's would be a data-loss bug, not an import.
    let creatorWritten = false;
    if (body.include_creator === true) {
      if (!mappedCurator) {
        return json({ ...summary, success: false, error: 'ShopMy returned no user block for this shop' }, 502);
      }
      const { data: existing, error: lookupErr } = await admin
        .from('creators').select('handle, source').eq('handle', mappedCurator.handle).maybeSingle();
      if (lookupErr) {
        return json({ ...summary, success: false, error: `creator lookup failed: ${lookupErr.message}` }, 500);
      }
      if (existing && existing.source !== 'shopmy') {
        return json({
          ...summary, success: false,
          error: `handle "${mappedCurator.handle}" already belongs to a non-ShopMy creator — choose a different handle`,
        }, 409);
      }
      const { error: creatorErr } = await admin.from('creators').upsert({
        handle: mappedCurator.handle,
        display_name: mappedCurator.display_name,
        avatar_url: mappedCurator.avatar_url,
        bio: mappedCurator.bio,
        source: 'shopmy',
        source_url: typeof body.url === 'string' ? body.url : null,
      }, { onConflict: 'handle' });
      if (creatorErr) {
        return json({ ...summary, success: false, error: `creator write failed: ${creatorErr.message}` }, 500);
      }
      creatorWritten = true;
    }
```

- [ ] **Step 5: Link each batch after it is written**

Replace the write loop body (lines 266–285) with:

```ts
    let inserted = 0, merged = 0, linked = 0, writeError: string | null = null;
    try {
      for (let i = 0; i < unique.length; i += batchSize) {
        const batch = unique.slice(i, i + batchSize);
        const { data, error } = await admin.rpc('shopmy_upsert_batch', { rows: batch });
        if (error) {
          writeError = `upsert batch ${Math.floor(i / batchSize)}: ${error.message}`;
          break;
        }
        inserted += data?.inserted ?? 0;
        merged += data?.merged ?? 0;

        // Link AFTER the upsert, per batch: the products must exist for the
        // RPC's join on normalize_product_url to resolve them. Note this
        // links every row in the batch, not just the ones the upsert touched
        // — an unchanged product still belongs to this creator.
        if (creatorWritten && mappedCurator) {
          const linkRows = batch.map((m, j) => {
            const sm = (m.raw_data?.shopmy ?? {}) as Record<string, unknown>;
            const pinId = Number(sm.pin_id);
            return {
              url: m.url,
              pin_id: Number.isFinite(pinId) ? pinId : null,
              affiliate_url: Number.isFinite(pinId) ? pinAffiliateUrl(pinId) : null,
              collection_name: (sm.collection_name as string) ?? null,
              section_name: (sm.section_name as string) ?? null,
              sort_order: i + j,
            };
          });
          const { data: linkData, error: linkErr } = await admin
            .rpc('shopmy_link_creator_products', { p_handle: mappedCurator.handle, rows: linkRows });
          if (linkErr) {
            writeError = `link batch ${Math.floor(i / batchSize)}: ${linkErr.message}`;
            break;
          }
          linked += linkData?.linked ?? 0;
        }

        await patchJob(jobId, { scraped_urls: inserted + merged });
        if (i + batchSize < unique.length && delayMs > 0) await sleep(delayMs);
      }
    } catch (e) {
      // A throw here (library fault, runtime error) would otherwise skip the
      // closing patch entirely. Turn it into a writeError so the row is closed
      // out AND the caller still gets the partial summary.
      writeError = `unexpected error during write: ${String(e).slice(0, 200)}`;
    }
```

Then extend the final success response (lines 294–299) to carry the two new counters:

```ts
    return json(
      { ...summary, success: !writeError, dry_run: false, inserted, merged,
        creator_written: creatorWritten, linked,
        batch_size: batchSize, batch_delay_ms: delayMs,
        error: writeError ?? undefined },
      writeError ? 500 : 200,
    );
```

- [ ] **Step 6: Deploy**

Deploy with `mcp__supabase__deploy_edge_function`, name `shopmy-ingest`, `verify_jwt: true`, uploading `supabase/functions/shopmy-ingest/index.ts`, `supabase/functions/_shared/shopmy.ts` and `supabase/functions/_shared/ssrf-guard.ts`.

- [ ] **Step 7: Verify the existing request shape is unchanged**

From the browser console on `/admin/agents?tab=crawls`, signed in as an admin:

```js
await supabase.functions.invoke('shopmy-ingest', {
  body: { url: 'https://shopmy.us/shop/justbobbidotcom?Section_id=2387365', dry_run: true },
})
```

Expected: `data.success === true`, `data.collections === 3`, `data.pins === 9` (the Dogs section), `data.creator` is an object with `handle: 'justbobbidotcom'`, and `data.creator_written` is **absent** — `include_creator` was not passed, so nothing about the old contract changed.

- [ ] **Step 8: Verify a real one-section import writes all three**

```js
await supabase.functions.invoke('shopmy-ingest', {
  body: {
    url: 'https://shopmy.us/shop/justbobbidotcom',
    section_ids: [2387365],
    include_creator: true,
    dry_run: false,
  },
})
```

Then via `mcp__supabase__execute_sql`:

```sql
select
  (select count(*) from creators where handle='justbobbidotcom' and source='shopmy')       as creator,
  (select count(*) from creator_products where creator_handle='justbobbidotcom')           as links,
  (select count(*) from creator_products
     where creator_handle='justbobbidotcom' and affiliate_url like 'https://go.shopmy.us/p-%') as good_links,
  (select count(*) from creator_products where creator_handle='justbobbidotcom' and affiliate_url is null) as null_links;
```

Expected: `creator=1`, `links > 0`, `good_links = links`, `null_links = 0`.

- [ ] **Step 9: Verify re-running is idempotent**

Re-run the exact same invoke from Step 8, then re-run the Step 8 SQL.

Expected: `links` is unchanged, and the response's `inserted` is `0` (the no-op guard) while `linked` still equals the batch size — links are re-asserted, products are not re-touched.

- [ ] **Step 10: Verify the collision guard**

```sql
-- pick any creator that is NOT a ShopMy import
select handle, source from public.creators where source is distinct from 'shopmy' limit 1;
```

Invoke with `creator_handle` set to that handle and `include_creator: true`, `dry_run: false`.

Expected: HTTP 409 and `error` containing `already belongs to a non-ShopMy creator`. Confirm with SQL that the existing row's `display_name` and `avatar_url` are unchanged.

- [ ] **Step 11: Commit**

```bash
git add supabase/functions/shopmy-ingest/index.ts
git commit -m "feat(shopmy-ingest): write the creator and per-creator product links

Three additive request fields, all defaulting to current behaviour:
include_creator, section_ids and creator_handle. section_ids is one list
call per section because ShopMy returns only the first section's
collections when no Section_id is given.

Fails closed on a handle collision with a non-ShopMy creator rather than
overwriting a signed-up person's name, avatar and bio. Links are written
per batch after the upsert, inside the existing throttle.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Rail 0 in the clickout router

**Files:**
- Modify: `app/data/looks.ts:1-10` (the `Product` interface), `app/services/affiliate.ts:119-165`
- Test: `app/services/affiliate.rail.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `Product.affiliate_url?: string`; `export function pickRail(url: string, product?: RailProduct | null, tracked?: string | null): { link: string | null; rail: string; wrappable: boolean }` where `RailProduct = { brand?: string | null; name?: string | null; id?: string | null; affiliate_url?: string | null }`. `link` is non-null only when the rail returns a link untouched.

**Why extract `pickRail`:** `affiliateRedirect` calls `supabase` and mints a UUID, so it is not directly unit-testable. The decision it makes is, and that decision is the whole feature.

- [ ] **Step 1: Write the failing test**

Create `app/services/affiliate.rail.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { pickRail } from './affiliate';

describe('pickRail', () => {
  it('returns the creator ShopMy link untouched, ahead of every other rail', () => {
    const r = pickRail('https://us.etoile.com/products/vanity-case', {
      id: 'p1',
      affiliate_url: 'https://go.shopmy.us/p-51354524',
    });
    expect(r.link).toBe('https://go.shopmy.us/p-51354524');
    expect(r.rail).toBe('shopmy');
    expect(r.wrappable).toBe(false);
  });

  it('prefers the creator link over a direct tracked link for the same product', () => {
    const r = pickRail(
      'https://us.etoile.com/products/vanity-case',
      { id: 'p1', affiliate_url: 'https://go.shopmy.us/p-51354524' },
      'https://tracked.example/p1',
    );
    expect(r.link).toBe('https://go.shopmy.us/p-51354524');
    expect(r.rail).toBe('shopmy');
  });

  it('falls through to the direct tracked link when there is no creator link', () => {
    const r = pickRail('https://us.etoile.com/x', { id: 'p1' }, 'https://tracked.example/p1');
    expect(r.link).toBe('https://tracked.example/p1');
    expect(r.rail).toBe('affiliate.com');
    expect(r.wrappable).toBe(false);
  });

  it('falls through to the Shopnomix wrap for an ordinary merchant', () => {
    const r = pickRail('https://revolve.com/some-dress', { id: 'p1' });
    expect(r.link).toBeNull();
    expect(r.rail).toBe('shopnomix');
    expect(r.wrappable).toBe(true);
  });

  it('stays direct for an excluded host', () => {
    // Shopnomix runs every brand except Amazon and Booking.
    const r = pickRail('https://www.amazon.com/dp/B000', { id: 'p1' });
    expect(r.link).toBeNull();
    expect(r.rail).toBe('direct');
    expect(r.wrappable).toBe(false);
  });

  it('is unaffected by a product with no affiliate_url field at all', () => {
    expect(pickRail('https://revolve.com/x', { id: 'p1' }).rail).toBe('shopnomix');
    expect(pickRail('https://revolve.com/x', null).rail).toBe('shopnomix');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run app/services/affiliate.rail.test.ts`

Expected: FAIL — `No "pickRail" export is defined on the module`.

- [ ] **Step 3: Add the `Product` field**

In `app/data/looks.ts`, inside `export interface Product`, immediately after the `url: string;` line, add:

```ts
  /** A creator's own tracked link for THIS product — today only the ShopMy
   *  link from creator_products. Takes precedence over every other rail in
   *  affiliateRedirect, and is returned untouched: wrapping a tracked link
   *  breaks its attribution. */
  affiliate_url?: string;
```

- [ ] **Step 4: Extract `pickRail` and use it**

In `app/services/affiliate.ts`, add above `export function affiliateRedirect`:

```ts
export interface RailProduct {
  brand?: string | null;
  name?: string | null;
  id?: string | null;
  /** Rail 0 — a creator's own link for this product (creator_products). */
  affiliate_url?: string | null;
}

/**
 * Which rail carries this clickout, and the link if that rail returns one
 * untouched. Extracted from affiliateRedirect so the decision — the whole
 * feature — is unit-testable without a supabase client or crypto.
 *
 * Order: creator link → direct tracked link → Shopnomix wrap → bare URL.
 */
export function pickRail(
  url: string,
  product?: RailProduct | null,
  tracked?: string | null,
): { link: string | null; rail: string; wrappable: boolean } {
  const creatorLink = product?.affiliate_url || null;
  if (creatorLink) return { link: creatorLink, rail: 'shopmy', wrappable: false };
  if (tracked) return { link: tracked, rail: 'affiliate.com', wrappable: false };
  const wrappable = isWrappable(url);
  return { link: null, rail: wrappable ? 'shopnomix' : 'direct', wrappable };
}
```

Then in `affiliateRedirect`, replace its three decision lines (currently `const tracked = …`, `const wrappable = …`, `const rail = …` at `affiliate.ts:127-129`) with:

```ts
  const trackedLink = product?.id ? trackedByProduct.get(product.id) ?? null : null;
  const { link, rail, wrappable } = pickRail(url, product, trackedLink);
```

and replace the `if (tracked) return tracked;` line (currently `affiliate.ts:156`) with:

```ts
  if (link) return link;
```

Widen the function's `product` parameter type from the inline object to `RailProduct | null`.

**Do not add an early return above the `affiliate_clicks` insert.** The insert at `affiliate.ts:131-152` runs before any return, and it is the only record that a clickout happened. An early return would silently drop telemetry for exactly the products this feature adds — which is what the `rail`/`wrapped` assertions below pin.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run app/services/affiliate.rail.test.ts`

Expected: PASS, 6 tests.

- [ ] **Step 6: Verify the click row still precedes every return**

`pickRail` is pure, so no unit test can prove the `affiliate_clicks` insert
still runs — and dropping it is the one plausible way to implement this wrong.
Check structurally:

```bash
awk '/export function affiliateRedirect/,/^}/' app/services/affiliate.ts \
  | grep -n "return\|affiliate_clicks"
```

Expected: the `affiliate_clicks` line appears **before** the first `return` that
is not the `if (!url || !enabled) return url;` guard. If any `return` carrying a
link appears above it, the telemetry is broken — move it back down.

The end-to-end half of this is verified in Task 5, Step 7, which asserts a real
click on an imported product writes `rail='shopmy'`, `wrapped=false`.

- [ ] **Step 7: Verify nothing else broke**

Run: `npm run typecheck && npx vitest run`

Expected: no TypeScript errors; the full suite passes.

- [ ] **Step 8: Commit**

```bash
git add app/data/looks.ts app/services/affiliate.ts app/services/affiliate.rail.test.ts
git commit -m "feat(affiliate): Rail 0 - a creator's own link wins the clickout

A product carrying an affiliate_url from creator_products clicks out through
that link untouched, ahead of the direct-tracked and Shopnomix rails, and
records rail='shopmy'.

Folded into the existing rail computation rather than added as an early
return: affiliateRedirect writes the affiliate_clicks row BEFORE it returns,
so returning early would have dropped clickout telemetry for exactly the
products this adds. pickRail is extracted so that decision is testable
without a supabase client.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Imported products on the creator page

**Files:**
- Create: `app/services/creator-products.ts`, `app/services/creator-products.test.ts`
- Modify: `app/components/CreatorPage.tsx:440-540`

**Interfaces:**
- Consumes: `Product` from `~/data/looks` with the `affiliate_url` field from Task 4; table `creator_products` from Task 1.
- Produces:
  - `export interface CreatorProductRow { affiliate_url: string | null; sort_order: number; products: { id: string; name: string | null; brand: string | null; price: string | null; image_url: string | null; primary_image_url: string | null; primary_video_url: string | null; primary_hls_url: string | null; primary_video_poster_url: string | null; url: string | null; images: string[] | null } | null }`
  - `export function mapCreatorProductRows(rows: CreatorProductRow[]): Product[]`
  - `export async function getImportedCreatorProducts(handle: string): Promise<Product[]>`

- [ ] **Step 1: Write the failing test**

Create `app/services/creator-products.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { mapCreatorProductRows, type CreatorProductRow } from './creator-products';

const row = (over: Partial<CreatorProductRow['products']> & { id: string }, affiliate_url: string | null, sort_order = 0): CreatorProductRow => ({
  affiliate_url,
  sort_order,
  products: {
    id: over.id, name: 'Vanity Case', brand: 'ETOILE', price: '$100.00',
    image_url: 'https://static.shopmy.us/pins/a.png',
    primary_image_url: null, primary_video_url: null, primary_hls_url: null,
    primary_video_poster_url: null, url: 'https://us.etoile.com/products/vanity-case',
    images: null, ...over,
  },
});

describe('mapCreatorProductRows', () => {
  it('carries the creator ShopMy link onto the product', () => {
    const [p] = mapCreatorProductRows([row({ id: 'p1' }, 'https://go.shopmy.us/p-51354524')]);
    // This is the whole point: Rail 0 reads Product.affiliate_url.
    expect(p.affiliate_url).toBe('https://go.shopmy.us/p-51354524');
    expect(p.id).toBe('p1');
    expect(p.brand).toBe('ETOILE');
  });

  it('leaves affiliate_url undefined when the link row has none', () => {
    const [p] = mapCreatorProductRows([row({ id: 'p1' }, null)]);
    expect(p.affiliate_url).toBeUndefined();
  });

  it('drops a link row whose product was deleted', () => {
    // creator_products cascades on product delete, but a stale embedded null
    // still arrives from PostgREST on a partially-visible join.
    expect(mapCreatorProductRows([{ affiliate_url: 'x', sort_order: 0, products: null }])).toEqual([]);
  });

  it('preserves sort_order', () => {
    const out = mapCreatorProductRows([
      row({ id: 'b' }, null, 2),
      row({ id: 'a' }, null, 1),
    ]);
    expect(out.map(p => p.id)).toEqual(['a', 'b']);
  });

  it('prefers primary_image_url, then image_url, then images[0]', () => {
    expect(mapCreatorProductRows([row({ id: 'p1', primary_image_url: 'PRI' }, null)])[0].image).toBe('PRI');
    expect(mapCreatorProductRows([row({ id: 'p1', primary_image_url: null }, null)])[0].image)
      .toBe('https://static.shopmy.us/pins/a.png');
    expect(mapCreatorProductRows([row({ id: 'p1', primary_image_url: null, image_url: null, images: ['ARR'] }, null)])[0].image)
      .toBe('ARR');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run app/services/creator-products.test.ts`

Expected: FAIL — `Failed to resolve import "./creator-products"`.

- [ ] **Step 3: Implement the service**

Create `app/services/creator-products.ts`:

```ts
// Products attributed to a creator directly, rather than through their looks.
//
// CreatorPage's Shop tab has always derived its products from look_products,
// so a creator with no looks had no products. An imported ShopMy creator has
// exactly that shape: hundreds of curated products and no video.

import { supabase } from '~/utils/supabase';
import type { Product } from '~/data/looks';

export interface CreatorProductRow {
  affiliate_url: string | null;
  sort_order: number;
  products: {
    id: string;
    name: string | null;
    brand: string | null;
    price: string | null;
    image_url: string | null;
    primary_image_url: string | null;
    primary_video_url: string | null;
    primary_hls_url: string | null;
    primary_video_poster_url: string | null;
    url: string | null;
    images: string[] | null;
  } | null;
}

/** Row → Product. Mirrors the mapping CreatorPage already does for
 *  look_products (CreatorPage.tsx:474-489), plus the creator's own link. */
export function mapCreatorProductRows(rows: CreatorProductRow[]): Product[] {
  return [...rows]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((r) => {
      const p = r.products;
      if (!p) return null;
      return {
        id: p.id,
        brand: p.brand || '',
        name: p.name || 'Untitled',
        price: p.price || '',
        url: p.url || '',
        image: p.primary_image_url || p.image_url || (p.images && p.images[0]) || undefined,
        video_url: p.primary_video_url || undefined,
        primary_hls_url: p.primary_hls_url || undefined,
        thumbnail_url: p.primary_video_poster_url || p.primary_image_url || p.image_url || undefined,
        // Rail 0 reads this at click time (app/services/affiliate.ts).
        affiliate_url: r.affiliate_url || undefined,
      } as Product;
    })
    .filter((p): p is Product => p !== null);
}

export async function getImportedCreatorProducts(handle: string): Promise<Product[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('creator_products')
    .select(`
      affiliate_url,
      sort_order,
      products ( id, name, brand, price, image_url, primary_image_url, primary_video_url, primary_hls_url, primary_video_poster_url, url, images )
    `)
    .eq('creator_handle', handle)
    .order('sort_order', { ascending: true });
  if (error || !data) return [];
  return mapCreatorProductRows(data as unknown as CreatorProductRow[]);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run app/services/creator-products.test.ts`

Expected: PASS, 5 tests.

- [ ] **Step 5: Union the imported products into the Shop tab**

In `app/components/CreatorPage.tsx`, add to the imports:

```ts
import { getImportedCreatorProducts } from '~/services/creator-products';
```

In the handle-branch effect, replace the aggregation block that currently begins `// Aggregate products across all looks for the Shop tab, skipping any` and ends with `setUserProducts(ordered);` (around `CreatorPage.tsx:525-539`) with:

```ts
        // Aggregate products across all looks for the Shop tab, skipping any
        // the creator has set inactive, then append the ones imported for
        // this creator directly (creator_products) — an imported ShopMy
        // creator has products but no looks, so the look-derived list alone
        // would leave their Shop tab empty.
        const imported = await getImportedCreatorProducts(creatorName);
        if (cancelled) return;
        const seen = new Set<string>();
        const ordered: Product[] = [];
        for (const p of [...mappedLooks.flatMap(l => l.products), ...imported]) {
          if (p.id && hiddenProductIds.has(p.id)) continue;
          const key = `${p.brand}::${p.name}`;
          if (seen.has(key)) continue;
          seen.add(key);
          ordered.push(p);
        }
        setUserProducts(ordered);
```

Look-derived products are listed first so an existing creator's Shop tab keeps its current order; the `${brand}::${name}` key is the one already in use there.

- [ ] **Step 6: Verify in the browser**

Start the dev server with `preview_start` (`.claude/launch.json`), sign in, and open `/creator/justbobbidotcom` (the handle imported in Task 3, Step 8).

Expected: the hero shows Bobbi Brown's name and ShopMy avatar; the Looks tab shows its empty state; the **Shop tab shows the imported products** with a count badge. In the console, `document.querySelectorAll('.creator-nav-count')` should report a non-zero Shop count.

- [ ] **Step 7: Verify the clickout uses the ShopMy link**

With the creator page open, click a product through to its Shop drawer and tap the official offer. Then via `mcp__supabase__execute_sql`:

```sql
select rail, wrapped, creator_handle, product_url
  from affiliate_clicks order by clicked_at desc limit 3;
```

Expected: the newest row has `rail='shopmy'`, `wrapped=false`, and `creator_handle='justbobbidotcom'`. Confirm the opened tab landed on the merchant via `go.shopmy.us`.

- [ ] **Step 8: Commit**

```bash
git add app/services/creator-products.ts app/services/creator-products.test.ts app/components/CreatorPage.tsx
git commit -m "feat(creator): show imported products on the Shop tab

CreatorPage has always derived its products from look_products, so a creator
with no looks had an empty Shop tab - which is exactly the shape of an
imported ShopMy creator. Union creator_products in, carrying each row's
affiliate_url onto the Product so Rail 0 picks it up at click time.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: A real `/admin/creators`

**Files:**
- Create: `app/services/creators.ts`
- Modify: `app/routes/admin/creators.tsx` (replace wholesale), `app/routes/admin/route.tsx:171-175`

**Interfaces:**
- Consumes: `creators.source` / `source_url` (Task 1).
- Produces: `export interface AdminCreatorRow { handle: string; display_name: string; avatar_url: string | null; source: string | null; source_url: string | null; created_at: string | null; products: number; looks: number }` and `export async function listAdminCreators(): Promise<AdminCreatorRow[]>`.

- [ ] **Step 1: Write the service**

Create `app/services/creators.ts`:

```ts
// Admin creator list. Replaces the hardcoded mock arrays that
// app/routes/admin/creators.tsx shipped with.

import { supabase } from '~/utils/supabase';

export interface AdminCreatorRow {
  handle: string;
  display_name: string;
  avatar_url: string | null;
  source: string | null;
  source_url: string | null;
  created_at: string | null;
  products: number;
  looks: number;
}

export async function listAdminCreators(): Promise<AdminCreatorRow[]> {
  if (!supabase) return [];
  const [creatorsRes, cpRes, looksRes] = await Promise.all([
    supabase.from('creators')
      .select('handle, display_name, avatar_url, source, source_url, created_at')
      .order('created_at', { ascending: false }),
    supabase.from('creator_products').select('creator_handle'),
    supabase.from('looks').select('creator_handle').not('creator_handle', 'is', null),
  ]);
  const rows = (creatorsRes.data ?? []) as Omit<AdminCreatorRow, 'products' | 'looks'>[];

  // Counted client-side rather than with an RPC: 42 creators against a few
  // hundred junction rows is one cheap pass, and it avoids a migration whose
  // only consumer is one admin table.
  const tally = (list: { creator_handle: string | null }[] | null) => {
    const m = new Map<string, number>();
    for (const r of list ?? []) {
      if (!r.creator_handle) continue;
      m.set(r.creator_handle, (m.get(r.creator_handle) ?? 0) + 1);
    }
    return m;
  };
  const productCounts = tally(cpRes.data as { creator_handle: string | null }[] | null);
  const lookCounts = tally(looksRes.data as { creator_handle: string | null }[] | null);

  return rows.map((r) => ({
    ...r,
    products: productCounts.get(r.handle) ?? 0,
    looks: lookCounts.get(r.handle) ?? 0,
  }));
}
```

- [ ] **Step 2: Replace the mock page**

Replace the entire contents of `app/routes/admin/creators.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useNavigate } from '@remix-run/react';
import { useSortableTable, SortableTh } from '~/components/SortableTable';
import { listAdminCreators, type AdminCreatorRow } from '~/services/creators';
import ShopMyImportWizard from '~/components/ShopMyImportWizard';

export default function AdminCreators() {
  const [activeTab, setActiveTab] = useState<'creators' | 'incoming'>('creators');
  const [rows, setRows] = useState<AdminCreatorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const { sortedData, sort, handleSort } = useSortableTable(rows);
  const navigate = useNavigate();

  const load = () => {
    setLoading(true);
    listAdminCreators()
      .then(setRows)
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <h1>Creators</h1>
        <p className="admin-page-subtitle">Manage platform creators</p>
      </div>

      <div className="admin-tabs">
        <button className={`admin-tab ${activeTab === 'creators' ? 'active' : ''}`} onClick={() => setActiveTab('creators')}>
          Creators
          {rows.length > 0 && <span className="admin-tab-badge">{rows.length}</span>}
        </button>
        <button className={`admin-tab ${activeTab === 'incoming' ? 'active' : ''}`} onClick={() => setActiveTab('incoming')}>
          Incoming
          <span className="admin-tab-badge">0</span>
        </button>
      </div>

      {activeTab === 'creators' ? (
        <>
          {importing ? (
            <ShopMyImportWizard
              onClose={() => setImporting(false)}
              onDone={() => { setImporting(false); load(); }}
            />
          ) : (
            <button className="admin-btn admin-btn-primary" onClick={() => setImporting(true)}>
              Import from ShopMy
            </button>
          )}

          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <SortableTh label="Creator" sortKey="display_name" currentSort={sort} onSort={handleSort} />
                  <SortableTh label="Handle" sortKey="handle" currentSort={sort} onSort={handleSort} />
                  <SortableTh label="Source" sortKey="source" currentSort={sort} onSort={handleSort} />
                  <SortableTh label="Products" sortKey="products" currentSort={sort} onSort={handleSort} />
                  <SortableTh label="Looks" sortKey="looks" currentSort={sort} onSort={handleSort} />
                  <SortableTh label="Joined" sortKey="created_at" currentSort={sort} onSort={handleSort} />
                </tr>
              </thead>
              <tbody>
                {sortedData.map((c) => (
                  <tr key={c.handle} onClick={() => navigate(`/admin/creators/${c.handle}`)} style={{ cursor: 'pointer' }}>
                    <td>
                      {c.avatar_url
                        ? <img src={c.avatar_url} alt="" width={28} height={28} loading="lazy" style={{ borderRadius: '50%', verticalAlign: 'middle', marginRight: 8 }} />
                        : null}
                      {c.display_name}
                    </td>
                    <td>{c.handle}</td>
                    <td>{c.source ?? '—'}</td>
                    <td>{c.products}</td>
                    <td>{c.looks}</td>
                    <td>{c.created_at ? new Date(c.created_at).toLocaleDateString() : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {loading && <p className="admin-form-hint">Loading creators…</p>}
          {!loading && rows.length === 0 && <p className="admin-form-hint">No creators yet.</p>}
        </>
      ) : (
        <p className="admin-form-hint">No incoming creator applications.</p>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Drop the invented handles from the nav**

In `app/routes/admin/route.tsx`, delete lines 171–175 — the `// Creators` comment and the four `applee` / `PrettyHome` / `testapple` / `apple` entries. They point at handles that do not exist in the database.

- [ ] **Step 4: Verify**

Run: `npm run typecheck && npm run check:routes`

Expected: no errors. (`check:routes` confirms the route registration at `vite.config.ts:251` still resolves — the path does not change, only the file's contents.)

Then open `/admin/creators` in the preview. Expected: the real creator count in the tab badge, ShopMy-imported creators showing `source = shopmy` with a non-zero product count, and the four fake handles gone from the sidebar.

- [ ] **Step 5: Commit**

```bash
git add app/services/creators.ts app/routes/admin/creators.tsx app/routes/admin/route.tsx
git commit -m "feat(admin): make /admin/creators read the real database

The page shipped as 75 lines of hardcoded arrays with zero Supabase calls,
and the sidebar linked four handles that do not exist. Replace both with the
live creator list, plus product and look counts and an Import from ShopMy
entry point.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: The wizard step reducer

**Files:**
- Create: `app/components/shopmy-wizard-state.ts`, `app/components/shopmy-wizard-state.test.ts`

**Interfaces:**
- Consumes: nothing. Deliberately free of React and I/O so the rules are testable on their own, matching `app/components/shopmy-ingest-progress.ts`.
- Produces:
  - `export type WizardStep = 1 | 2 | 3 | 4 | 5`
  - `export interface WizardSection { id: number; title: string; collections: number; pins: number }`
  - `export interface WizardState { step: WizardStep; url: string; handle: string; displayName: string; bio: string; selectedSections: number[]; sections: WizardSection[] }`
  - `export function canAdvance(s: WizardState): string | null` — returns `null` when the step may advance, else the reason.
  - `export function toggleSection(s: WizardState, id: number): WizardState`

- [ ] **Step 1: Write the failing test**

Create `app/components/shopmy-wizard-state.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { canAdvance, toggleSection, type WizardState } from './shopmy-wizard-state';

const base: WizardState = {
  step: 1,
  url: 'https://shopmy.us/shop/justbobbidotcom',
  handle: 'justbobbidotcom',
  displayName: 'Bobbi Brown',
  bio: '',
  sections: [
    { id: 409, title: "Bobbi's Closet", collections: 14, pins: 123 },
    { id: 2387365, title: 'Dogs', collections: 3, pins: 9 },
  ],
  selectedSections: [409, 2387365],
};

describe('canAdvance', () => {
  it('blocks step 1 without a ShopMy URL', () => {
    expect(canAdvance({ ...base, step: 1, url: '' })).toMatch(/url/i);
    expect(canAdvance({ ...base, step: 1, url: 'https://ltk.app/someone' })).toMatch(/shopmy/i);
    expect(canAdvance({ ...base, step: 1 })).toBeNull();
  });

  it('blocks step 2 without a handle or a display name', () => {
    // creators.handle and creators.display_name are both NOT NULL.
    expect(canAdvance({ ...base, step: 2, handle: '' })).toMatch(/handle/i);
    expect(canAdvance({ ...base, step: 2, displayName: '  ' })).toMatch(/name/i);
    expect(canAdvance({ ...base, step: 2 })).toBeNull();
  });

  it('blocks step 3 with zero sections selected', () => {
    // Without this the run would list every section and quietly import the
    // non-apparel ones the operator just unticked.
    expect(canAdvance({ ...base, step: 3, selectedSections: [] })).toMatch(/section/i);
    expect(canAdvance({ ...base, step: 3 })).toBeNull();
  });

  it('does not gate the preview and import steps', () => {
    expect(canAdvance({ ...base, step: 4 })).toBeNull();
    expect(canAdvance({ ...base, step: 5 })).toBeNull();
  });
});

describe('toggleSection', () => {
  it('removes a selected section and adds an unselected one', () => {
    const off = toggleSection(base, 409);
    expect(off.selectedSections).toEqual([2387365]);
    expect(toggleSection(off, 409).selectedSections.sort()).toEqual([409, 2387365]);
  });

  it('does not mutate the input state', () => {
    const before = [...base.selectedSections];
    toggleSection(base, 409);
    expect(base.selectedSections).toEqual(before);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run app/components/shopmy-wizard-state.test.ts`

Expected: FAIL — `Failed to resolve import "./shopmy-wizard-state"`.

- [ ] **Step 3: Implement**

Create `app/components/shopmy-wizard-state.ts`:

```ts
// Step rules for the ShopMy creator import wizard.
//
// Pure — no React, no I/O — so the gating rules are testable on their own,
// the same split as shopmy-ingest-progress.ts.

export type WizardStep = 1 | 2 | 3 | 4 | 5;

export interface WizardSection {
  id: number;
  title: string;
  collections: number;
  pins: number;
}

export interface WizardState {
  step: WizardStep;
  url: string;
  handle: string;
  displayName: string;
  bio: string;
  sections: WizardSection[];
  selectedSections: number[];
}

function isShopMyUrl(raw: string): boolean {
  try {
    const host = new URL(raw).hostname.toLowerCase().replace(/^www\./, '');
    return host === 'shopmy.us' || host === 'shop.my';
  } catch {
    return false;
  }
}

/** null when the current step may advance, else the reason to show. */
export function canAdvance(s: WizardState): string | null {
  switch (s.step) {
    case 1:
      if (!s.url.trim()) return 'Paste a ShopMy shop URL.';
      if (!isShopMyUrl(s.url.trim())) return 'That is not a ShopMy URL.';
      return null;
    case 2:
      // Both columns are NOT NULL on creators.
      if (!s.handle.trim()) return 'A handle is required.';
      if (!s.displayName.trim()) return 'A display name is required.';
      return null;
    case 3:
      if (s.selectedSections.length === 0) return 'Select at least one section.';
      return null;
    default:
      return null;
  }
}

export function toggleSection(s: WizardState, id: number): WizardState {
  const on = s.selectedSections.includes(id);
  return {
    ...s,
    selectedSections: on
      ? s.selectedSections.filter((x) => x !== id)
      : [...s.selectedSections, id],
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run app/components/shopmy-wizard-state.test.ts`

Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add app/components/shopmy-wizard-state.ts app/components/shopmy-wizard-state.test.ts
git commit -m "feat(shopmy): pure step rules for the creator import wizard

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: The wizard

**Files:**
- Create: `app/components/ShopMyImportWizard.tsx`
- Modify: `app/components/ShopMyIngest.tsx` (accept the wizard's choices), `app/styles/admin.css:3568,3602`

**Interfaces:**
- Consumes: `canAdvance`, `toggleSection`, `WizardState`, `WizardSection` (Task 7); the edge function's `creator` / `sections` dry-run response (Task 3); `ShopMyIngest` for steps 4–5.
- Produces: `export default function ShopMyImportWizard({ onClose, onDone }: { onClose: () => void; onDone: () => void })`.

**Markup convention:** admin forms are `<div className="admin-form-group"><label>…</label><input …/></div>` — the label and input are styled by descendant selectors (`admin.css:3561,3568`), not by classes of their own. There is no `admin-form-input` or `admin-form-label` class; do not invent one.

- [ ] **Step 0: Let `.admin-form-group` style a textarea**

`.admin-form-group input` has no `textarea` counterpart, so the bio field would render as an unstyled browser default. In `app/styles/admin.css`, extend both the light rule at line 3568 and its dark twin at line 3602:

```css
.admin-form-group input,
.admin-form-group textarea {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid #ddd;
  border-radius: 6px;
  font-size: 13px;
  outline: none;
  transition: border-color 0.15s;
  box-sizing: border-box;
}
.admin-form-group input:focus,
.admin-form-group textarea:focus { border-color: #111; }
```

```css
.admin-dark .admin-form-group input,
.admin-dark .admin-form-group textarea { background: rgba(255,255,255,0.06); border-color: rgba(255,255,255,0.1); color: rgba(255,255,255,0.9); }
.admin-dark .admin-form-group input:focus,
.admin-dark .admin-form-group textarea:focus { border-color: rgba(255,255,255,0.3); }
```

Widening-only: no existing admin form has a textarea inside an `.admin-form-group`, so nothing currently rendered changes.

- [ ] **Step 1: Let `ShopMyIngest` carry the wizard's choices**

`ShopMyIngest` currently hardcodes both of its request bodies. Widen its props and thread them through.

In `app/components/ShopMyIngest.tsx`, change the component signature to:

```tsx
export default function ShopMyIngest({ url, sectionIds, creatorHandle, includeCreator, onClose, onDone }:
  {
    url: string;
    /** Wizard step 3's selection. Undefined ingests whatever the URL addresses. */
    sectionIds?: number[];
    /** Wizard step 2's (possibly edited) handle. */
    creatorHandle?: string;
    /** False keeps the legacy products-only behaviour. */
    includeCreator?: boolean;
    onClose: () => void;
    onDone: () => void;
  }) {
```

In `runPreview`, change the invoke body to:

```ts
        body: { url, dry_run: true, section_ids: sectionIds, creator_handle: creatorHandle },
```

and add `sectionIds` and `creatorHandle` to that `useCallback`'s dependency array alongside `url`.

In `start`, change the invoke body to:

```ts
        body: {
          url, dry_run: false, job_id: createdJob.id,
          section_ids: sectionIds, creator_handle: creatorHandle,
          include_creator: includeCreator === true,
        },
```

and add `sectionIds`, `creatorHandle`, `includeCreator` to that `useCallback`'s dependency array.

Existing callers pass none of the three, so `section_ids` and `creator_handle` arrive `undefined` (omitted from the JSON body) and `include_creator` arrives `false` — identical to today's behaviour.

- [ ] **Step 2: Build the wizard**

Create `app/components/ShopMyImportWizard.tsx`:

```tsx
// Five-step ShopMy creator import.
//
// Steps 1-3 collect the operator's choices; steps 4-5 are ShopMyIngest,
// unchanged — it already owns the dry-run preview, the crawl_jobs polling,
// the progress bar and the skip summary.

import { useCallback, useState } from 'react';
import { supabase } from '~/utils/supabase';
import ShopMyIngest from '~/components/ShopMyIngest';
import { canAdvance, toggleSection, type WizardState, type WizardSection } from './shopmy-wizard-state';

interface ProbeResponse {
  success?: boolean;
  error?: string;
  creator?: { handle: string; display_name: string; avatar_url: string | null; bio: string | null } | null;
  sections?: { id: number; title: string }[];
}

/** Recover an edge function's JSON body from a non-2xx invoke() error.
 *  Mirrors ShopMyIngest.edgeBody — this ingest returns real bodies at 500. */
async function edgeBody(err: unknown): Promise<Record<string, unknown> | null> {
  const ctx = (err as { context?: Response })?.context;
  if (!ctx || typeof ctx.json !== 'function') return null;
  try { return await ctx.json(); } catch { return null; }
}

const EMPTY: WizardState = {
  step: 1, url: '', handle: '', displayName: '', bio: '', sections: [], selectedSections: [],
};

export default function ShopMyImportWizard({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [s, setS] = useState<WizardState>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existing, setExisting] = useState<string | null>(null);

  const blocked = canAdvance(s);

  // Step 1 → 2. One dry-run against the whole shop resolves both the creator
  // block and the section list; per-section pin counts come from step 3's
  // own probes, which is why this one passes no section_ids.
  const resolve = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const { data, error: err } = await supabase!.functions.invoke('shopmy-ingest', {
        body: { url: s.url.trim(), dry_run: true, max_collections: 1 },
      });
      const p = (data ?? (err ? await edgeBody(err) : null)) as ProbeResponse | null;
      if (!p?.success) throw new Error(p?.error ?? (err as Error)?.message ?? 'could not read that shop');
      if (!p.creator) throw new Error('ShopMy returned no creator for that shop');

      const sections: WizardSection[] = (p.sections ?? []).map((x) => ({
        id: x.id, title: x.title, collections: 0, pins: 0,
      }));

      const { data: hit } = await supabase!
        .from('creators').select('handle, source').eq('handle', p.creator.handle).maybeSingle();
      setExisting(hit ? (hit.source === 'shopmy' ? 'update' : 'conflict') : null);

      setS((prev) => ({
        ...prev,
        step: 2,
        handle: p.creator!.handle,
        displayName: p.creator!.display_name,
        bio: p.creator!.bio ?? '',
        sections,
        selectedSections: sections.map((x) => x.id),
      }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [s.url]);

  // Step 2 → 3. Count collections and pins per section so the operator can
  // see what they are dropping before they drop it.
  const countSections = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const counted = await Promise.all(s.sections.map(async (sec) => {
        const { data, error: err } = await supabase!.functions.invoke('shopmy-ingest', {
          body: { url: s.url.trim(), dry_run: true, section_ids: [sec.id] },
        });
        const p = (data ?? (err ? await edgeBody(err) : null)) as { collections?: number; pins?: number } | null;
        return { ...sec, collections: p?.collections ?? 0, pins: p?.pins ?? 0 };
      }));
      setS((prev) => ({ ...prev, step: 3, sections: counted }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [s.url, s.sections]);

  if (s.step >= 4) {
    return (
      <ShopMyIngest
        url={s.url.trim()}
        sectionIds={s.selectedSections}
        creatorHandle={s.handle.trim()}
        includeCreator
        onClose={onClose}
        onDone={onDone}
      />
    );
  }

  return (
    <div className="admin-section">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <h3 style={{ margin: 0 }}>Import from ShopMy · step {s.step} of 5</h3>
        <button className="admin-btn admin-btn-secondary" onClick={onClose}>Close</button>
      </div>

      {error && <div className="admin-form-error">{error}</div>}

      {s.step === 1 && (
        <>
          <div className="admin-form-group">
            <label htmlFor="shopmy-url">Shop URL</label>
            <input
              id="shopmy-url"
              type="url"
              value={s.url}
              placeholder="https://shopmy.us/shop/justbobbidotcom"
              onChange={(e) => setS({ ...s, url: e.target.value })}
            />
          </div>
          <p className="admin-form-hint">
            All three shapes work: <code>/shop/&lt;username&gt;</code>, the bare
            {' '}<code>/&lt;username&gt;</code>, and <code>/shop?Curator_id=&lt;digits&gt;</code>.
          </p>
        </>
      )}

      {s.step === 2 && (
        <>
          {existing === 'update' && (
            <p className="admin-form-hint">Already imported — this run will update that creator.</p>
          )}
          {existing === 'conflict' && (
            <div className="admin-form-error">
              <strong>{s.handle}</strong> already belongs to a creator who did not come from ShopMy.
              Choose a different handle — importing over them would replace their name, avatar and bio.
            </div>
          )}
          <div className="admin-form-group">
            <label htmlFor="shopmy-handle">Handle</label>
            <input id="shopmy-handle" type="text" value={s.handle}
                   onChange={(e) => setS({ ...s, handle: e.target.value })} />
          </div>
          <div className="admin-form-group">
            <label htmlFor="shopmy-name">Display name</label>
            <input id="shopmy-name" type="text" value={s.displayName}
                   onChange={(e) => setS({ ...s, displayName: e.target.value })} />
          </div>
          <div className="admin-form-group">
            <label htmlFor="shopmy-bio">Bio</label>
            <textarea id="shopmy-bio" rows={3} value={s.bio}
                      onChange={(e) => setS({ ...s, bio: e.target.value })} />
          </div>
        </>
      )}

      {s.step === 3 && (
        <>
          <p className="admin-form-hint">
            Untick anything that is not fashion — those pins are never fetched.
          </p>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead><tr><th /><th>Section</th><th>Collections</th><th>Pins</th></tr></thead>
              <tbody>
                {s.sections.map((sec) => (
                  <tr key={sec.id}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={sec.title}
                        checked={s.selectedSections.includes(sec.id)}
                        onChange={() => setS(toggleSection(s, sec.id))}
                      />
                    </td>
                    <td>{sec.title}</td>
                    <td>{sec.collections}</td>
                    <td>{sec.pins}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {blocked && <p className="admin-form-hint">{blocked}</p>}

      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        {s.step > 1 && (
          <button className="admin-btn admin-btn-secondary" disabled={busy}
                  onClick={() => setS({ ...s, step: (s.step - 1) as WizardState['step'] })}>
            Back
          </button>
        )}
        <button
          className="admin-btn admin-btn-primary"
          disabled={busy || blocked !== null || existing === 'conflict'}
          onClick={() => {
            if (s.step === 1) return void resolve();
            if (s.step === 2) return void countSections();
            setS({ ...s, step: 4 });
          }}
        >
          {busy ? 'Reading the shop…' : s.step === 3 ? 'Preview import' : 'Continue'}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify the whole flow in the browser**

Run: `npm run typecheck && npx vitest run`, then open `/admin/creators` in the preview and click **Import from ShopMy**.

Walk the flow with `https://shopmy.us/shop/justbobbidotcom`. Expected at each step:

1. **Continue** is disabled until a ShopMy URL is present; an `ltk.app` URL shows "That is not a ShopMy URL."
2. The card resolves to handle `justbobbidotcom`, name "Bobbi Brown", the ShopMy bio, and — because Task 3 already imported this shop — the "Already imported — this run will update that creator." hint.
3. Nine sections with counts. Untick **Home**, **Dogs** and **Discount Codes**.
4. The preview's collection count matches the six sections left ticked, not all nine.
5. The progress bar runs and the landed-products table fills.

- [ ] **Step 4: Verify the untick actually excluded those sections**

```sql
select section_name, count(*)
  from creator_products
 where creator_handle='justbobbidotcom'
 group by section_name order by 2 desc;
```

Expected: no `Home`, `Dogs` or `Discount Codes` rows from this run. (Rows written by Task 3's `Dogs` verification run may still be present — check `created_at` to tell them apart, or delete them first with `delete from creator_products where creator_handle='justbobbidotcom' and section_name='Dogs';`.)

- [ ] **Step 5: Verify a non-ShopMy collision is blocked in the UI**

Restart the wizard, reach step 2, and retype the handle to a creator whose `source` is null. Expected: the red conflict panel appears and **Continue** is disabled — the guard fires in the UI as well as in the edge function.

- [ ] **Step 6: Commit**

```bash
git add app/components/ShopMyImportWizard.tsx app/components/ShopMyIngest.tsx
git commit -m "feat(admin): five-step ShopMy creator import wizard

Steps 1-3 collect the URL, the creator card and the section selection;
steps 4-5 hand off to ShopMyIngest unchanged, which already owns the
dry-run preview, the crawl_jobs polling and the progress bar.

Section selection is the point of step 3: 73 of the reference shop's 425
pins are Home, Dogs and Discount Codes, and unticking them means those
collections are never fetched rather than imported and cleaned up later.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Verification

After Task 8, the full path works end to end:

```sql
select c.handle, c.display_name, c.source,
       count(cp.product_id)                                            as products,
       count(cp.affiliate_url)                                         as with_shopmy_link
  from creators c
  left join creator_products cp on cp.creator_handle = c.handle
 where c.source = 'shopmy'
 group by 1,2,3 order by products desc;
```

Expected: one row per imported creator, with `with_shopmy_link = products`.

```bash
npm run typecheck && npx vitest run && npm run lint
deno test --no-check --allow-read supabase/functions/_shared/shopmy.test.ts
```

Expected: all green.

## Out of scope for this plan

Carried over verbatim from the spec (§10) — do not let these creep in: looks of any kind; scheduled re-sync of a shop; discovery surfaces (follow rails and the creator constellation key on looks, so an imported creator will not appear there); product activation (`is_active`, and the main feed's additional `primary_video_url` requirement, stay with the existing admin gate); and claiming — attaching an auth user to an imported `creators` row.
