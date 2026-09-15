# ShopMy Creator Shop Ingest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ingest a creator's ShopMy storefront into the product catalog by reading ShopMy's public JSON API, without a browser, a model, or a single Playwright run.

**Architecture:** One Supabase edge function (`shopmy-ingest`) calls two unauthenticated ShopMy endpoints, maps each pin to a `products` row with a pure, unit-tested mapper in `_shared/shopmy.ts`, and writes through a SQL RPC that owns URL normalisation and conflict handling. Writes are throttled into small batches because `products` carries twelve triggers that fan out to edge functions on every insert.

**Tech Stack:** Deno edge functions, Postgres (Supabase), TypeScript, `deno test --no-check` for `_shared` units, vitest for `app/**` units.

**Spec:** `docs/superpowers/specs/2026-09-15-shopmy-ingest-design.md`

## Global Constraints

- **Branch is `dev`.** Never create a session branch, never force-push. (`CLAUDE.md`)
- **Never write `scrape_status='pending'` for a ShopMy row.** The `scrape-new-products` trigger fires on that value and would send the Modal scraper at a URL whose data we already hold. Always `'done'`.
- **Never bulk-insert.** Maximum 25 rows per statement, with a pause between batches. At 424 rows an unthrottled insert produces ~1,270 edge invocations and ~850 Anthropic calls; the account exhausted its credit on 2026-09-14.
- **URL normalisation lives in SQL only** — `public.normalize_product_url(text)`. No TypeScript copy; a second implementation will drift from the index and silently break dedup.
- **`products.gender` is constrained** to `NULL | 'male' | 'female' | 'unisex'`. ShopMy has no gender field, so ShopMy rows write `NULL`.
- **Every outbound fetch goes through `urlAllowed()`** from `supabase/functions/_shared/ssrf-guard.ts`.
- **`_shared` tests use `Deno.test`** and run via `deno test --no-check <file>`. Vitest only collects `app/**/*.test.{ts,tsx}` (`vite.config.ts:31`), so a `_shared` test written for vitest will never run.

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/20260915000000_normalize_product_url.sql` | Create `normalize_product_url()`, merge the 7 duplicate pairs, add the unique index |
| `supabase/migrations/20260915000001_shopmy_upsert.sql` | `shopmy_upsert_batch(jsonb)` RPC — the only writer |
| `supabase/functions/_shared/shopmy.ts` | Pure mapper: ShopMy pin → product row. No I/O. |
| `supabase/functions/_shared/shopmy.test.ts` | Deno tests for the mapper, against a checked-in fixture |
| `supabase/functions/_shared/fixtures/shopmy-collection.json` | Real captured payload, 14 pins |
| `supabase/functions/shopmy-ingest/index.ts` | HTTP layer: parse URL, fetch, throttle, call RPC, return summary |
| `app/utils/productUrl.ts` | Fix the `/s/` guard (modify) |
| `agents/product-scraper/agent.py` | Fix the same `/s/` guard (modify) |
| `app/components/ProfileCrawlsPanel.tsx` | Route ShopMy hosts to the new function (modify) |

Tasks 1–3 are independent of ShopMy and land first because they fix pre-existing bugs the ingest would otherwise inherit.

---

### Task 1: Fix the `/s/` URL guard

The guard rejects any path starting `/s/` as "amazon search". That is Nordstrom's and Nordstrom Rack's real product URL format, and it currently fails 34 of 34 such URLs. ShopMy pins link to arbitrary merchants including Nordstrom, so ingest would inherit the bug.

**Files:**
- Modify: `app/utils/productUrl.ts:38-59`
- Modify: `agents/product-scraper/agent.py:412-414`
- Test: `app/utils/productUrl.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: `nonProductUrlReason(url: string): string | null` and `isLikelyProductUrl(url: string): boolean`, unchanged signatures. After this task a Nordstrom `/s/` URL returns `null` (valid).

- [ ] **Step 1: Write the failing test**

Create `app/utils/productUrl.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { nonProductUrlReason, isLikelyProductUrl } from './productUrl';

describe('nonProductUrlReason', () => {
  it('accepts Nordstrom and Nordstrom Rack /s/ product pages', () => {
    expect(nonProductUrlReason('https://www.nordstrom.com/s/vince-fulton-low-top-sneaker-men/9144596')).toBeNull();
    expect(nonProductUrlReason('https://www.nordstromrack.com/s/allsaints-klip-sneaker-men/7942006')).toBeNull();
  });

  it('still rejects Amazon search paths', () => {
    expect(nonProductUrlReason('https://www.amazon.com/s?k=running+shoes')).not.toBeNull();
    expect(nonProductUrlReason('https://www.amazon.com/s/ref=nb_sb_noss')).not.toBeNull();
  });

  it('still rejects generic non-product paths', () => {
    expect(nonProductUrlReason('https://example.com/search')).not.toBeNull();
    expect(nonProductUrlReason('https://example.com/')).toBe('site homepage');
    expect(nonProductUrlReason('https://example.com/cart')).not.toBeNull();
    expect(nonProductUrlReason('https://example.com/cart/items')).not.toBeNull();
  });

  it('matches bad prefixes on a path boundary, not as a substring', () => {
    // Real product slugs that merely start with a bad prefix must pass.
    expect(nonProductUrlReason('https://example.com/cartier-tank-watch-p12345')).toBeNull();
    expect(nonProductUrlReason('https://example.com/about-face-blush-palette')).toBeNull();
    expect(nonProductUrlReason('https://example.com/contactless-card-case')).toBeNull();
    expect(nonProductUrlReason('https://example.com/newsboy-cap')).toBeNull();
    expect(nonProductUrlReason('https://example.com/blogger-jeans')).toBeNull();
    expect(nonProductUrlReason('https://example.com/accountancy-branded-tee')).toBeNull();
  });

  it('still requires /dp/ on Amazon', () => {
    expect(nonProductUrlReason('https://www.amazon.com/Psychology-Money/dp/0857197681')).toBeNull();
    expect(nonProductUrlReason('https://www.amazon.com/gp/help/customer')).not.toBeNull();
  });

  it('isLikelyProductUrl agrees with nonProductUrlReason', () => {
    expect(isLikelyProductUrl('https://www.nordstrom.com/s/x/123')).toBe(true);
    expect(isLikelyProductUrl('https://example.com/')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/utils/productUrl.test.ts`
Expected: FAIL — the two Nordstrom assertions return `'non-product path "/s/"'` instead of `null`.

- [ ] **Step 3: Scope the `/s/` rule to Amazon**

In `app/utils/productUrl.ts`, remove `'/s/'` from `badPrefixes` and drop the now-dead special case in the loop, so the block reads:

```ts
  const badPrefixes = [
    '/search',
    '/help',
    '/support',
    '/blog',
    '/news',
    '/about',
    '/contact',
    '/cart',
    '/checkout',
    '/login',
    '/signin',
    '/account',
    '/customer',   // no trailing slash: the boundary rule appends one
  ];
  // Match on a path BOUNDARY only — exact, or the prefix followed by "/".
  // A bare startsWith() would reject real product slugs: "/cartier-tank-watch"
  // starts with "/cart", "/newsboy-cap" with "/news", "/blogger-jeans" with
  // "/blog". The old code avoided this with an inner exact-match gate; keep
  // that protection.
  for (const p of badPrefixes) {
    if (path === p || path.startsWith(p + '/')) {
      return `non-product path "${p}"`;
    }
  }

  // Amazon: real product pages contain /dp/ or /gp/product/. Amazon's own
  // search lives at /s — scoped here, not globally, because /s/<slug>/<id>
  // is Nordstrom's and Nordstrom Rack's canonical product URL format.
  // `path` is pathname only and never contains "?", so no "/s?" case exists.
  if (host === 'amazon.com' || host.endsWith('.amazon.com')) {
    if (path === '/s' || path.startsWith('/s/')) {
      return 'Amazon search page';
    }
    if (!path.includes('/dp/') && !path.includes('/gp/product/')) {
      return 'Amazon non-product page (no /dp/ in URL)';
    }
  }
```

- [ ] **Step 4: Mirror the fix in the Python agent**

In `agents/product-scraper/agent.py`, replace the global `/s/` clause (around line 412) with:

```python
    if path == "/search" or path.startswith("/search/"):
        if not (host == "google.com" or host.endswith(".google.com")):
            return f'non-product path "{path}"'
    if (host == "amazon.com" or host.endswith(".amazon.com")):
        # Amazon search is /s — scoped to Amazon because /s/<slug>/<id> is
        # Nordstrom's and Nordstrom Rack's canonical product URL format.
        if path == "/s" or path.startswith("/s/"):
            return "Amazon search page"
        if "/dp/" not in path and "/gp/product/" not in path:
            return "Amazon non-product page (no /dp/ in URL)"
```

- [ ] **Step 5: Run tests and typecheck**

Run: `npx vitest run app/utils/productUrl.test.ts && npm run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 6: Verify no other caller regressed**

`isLikelyProductUrl` is used at `app/routes/admin/data.tsx:365` for a `hasDirect` display flag, and `nonProductUrlReason` at `app/services/scrape-product.ts:278` to reject URLs at insert. Both become *more* permissive, which cannot reject a URL that previously passed.

Run: `npx vitest run && npm run lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add app/utils/productUrl.ts app/utils/productUrl.test.ts agents/product-scraper/agent.py
git commit -m "fix(scraper): scope the /s/ guard to Amazon so Nordstrom PDPs pass

/s/<slug>/<id> is Nordstrom's and Nordstrom Rack's canonical product URL
format, but the guard rejected every /s/ path as an Amazon search. All 34
such URLs in the catalog are stuck at scrape_status='failed' because of it.

Scopes the rule to amazon.com hosts, matching the sibling /dp/ rule, in
both the TypeScript and Python copies."
```

---

### Task 2: URL normalisation, duplicate merge, unique index

One migration, in this order: create the function, merge the 7 colliding pairs, then create the index. The index cannot be created first — it would abort.

**Critical:** ten of the twelve tables referencing `products` cascade on delete. The 7 loser rows hold **3 `user_generation_products` rows (real user look-generations)** and 5 `catalog_products` rows. Children must be repointed before any delete.

**Files:**
- Create: `supabase/migrations/20260915000000_normalize_product_url.sql`

**Interfaces:**
- Produces: `public.normalize_product_url(text) returns text`, IMMUTABLE. Used by Task 3's RPC and by the unique index `products_normalized_url_uidx`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260915000000_normalize_product_url.sql`:

```sql
-- Canonical product-URL normalisation + dedup key.
--
-- Normalisation lives HERE and only here. A TypeScript copy would drift from
-- the index and silently break dedup.
--
-- Kept: variant / color / ID / pid and friends identify the product itself;
-- dropping them collapses genuinely different products onto one URL.
-- Dropped: click-tracking parameters only.

-- Parse the query string properly rather than regex-stripping fragments in
-- place. An in-place `[?&]param=value` strip is ORDER-DEPENDENT: when the
-- tracking param comes first it eats the "?" itself, so
--   ?utm_source=a&variant=5  ->  /p&variant=5
--   ?variant=5&utm_source=a  ->  /p?variant=5
-- Same product, two different keys — and tracking-first is exactly how ad
-- links (ShopMy's included) are built, so the dedup key would miss them.
-- Splitting and re-joining also sorts the survivors, making the key
-- independent of parameter order.
create or replace function public.normalize_product_url(u text)
returns text
language sql
immutable
as $$
  select case when u is null or btrim(u) = '' then null else
    -- host + path: scheme, www., #fragment and trailing slash removed
    rtrim(
      split_part(split_part(regexp_replace(lower(btrim(u)), '^https?://(www\.)?', ''), '#', 1), '?', 1),
      '/')
    -- surviving query params, sorted so order never changes the key
    || coalesce((
         select '?' || string_agg(kv, '&' order by kv)
           from unnest(string_to_array(
                  split_part(split_part(regexp_replace(lower(btrim(u)), '^https?://(www\.)?', ''), '#', 1), '?', 2),
                  '&')) kv
          where kv <> ''
            and split_part(kv, '=', 1) !~
                '^(utm_[a-z_]*|srsltid|gclid|gbraid|wbraid|fbclid|gad_source|gad_campaignid|irclickid|ranmid|raneaid|ransiteid|cjevent|msclkid|epik|_branch_match_id)$'
       ), '')
  end
$$;

comment on function public.normalize_product_url(text) is
  'Dedup key for products.url. Strips scheme/www/trailing slash and click-tracking params; KEEPS product-identifying params (variant, color, ID, pid).';

-- ── merge duplicates before the unique index can exist ──────────────────────
-- 7 colliding pairs measured 2026-09-15. Oldest row wins. Children are
-- REPOINTED, never cascade-deleted: the losers hold 3 user_generation_products
-- rows, which are real user data.
do $$
declare
  r record;
begin
  for r in
    with ranked as (
      select id, normalize_product_url(url) n, created_at,
             row_number() over (partition by normalize_product_url(url)
                                order by created_at, id) rn,
             count(*)    over (partition by normalize_product_url(url)) c
        from public.products
       where url is not null
    )
    select l.id as loser, w.id as winner
      from ranked l
      join ranked w on w.n = l.n and w.rn = 1
     where l.c > 1 and l.rn > 1
  loop
    -- Fill any column the winner is missing from the loser.
    update public.products w set
      name              = coalesce(w.name,              l.name),
      brand             = coalesce(w.brand,             l.brand),
      description       = coalesce(w.description,       l.description),
      price             = coalesce(w.price,             l.price),
      currency          = coalesce(w.currency,          l.currency),
      image_url         = coalesce(w.image_url,         l.image_url),
      images            = coalesce(w.images,            l.images),
      primary_image_url = coalesce(w.primary_image_url, l.primary_image_url),
      primary_video_url = coalesce(w.primary_video_url, l.primary_video_url),
      type              = coalesce(w.type,              l.type),
      gender            = coalesce(w.gender,            l.gender),
      styling_metadata  = coalesce(w.styling_metadata,  l.styling_metadata),
      affiliate_url     = coalesce(w.affiliate_url,     l.affiliate_url),
      is_active         = w.is_active or l.is_active
      from public.products l
     where w.id = r.winner and l.id = r.loser;

    -- Repoint children that carry real data. ON CONFLICT covers the case
    -- where the winner is already linked to the same parent.
    update public.user_generation_products set product_id = r.winner
     where product_id = r.loser
       and not exists (select 1 from public.user_generation_products x
                        where x.product_id = r.winner
                          and x.generation_id = user_generation_products.generation_id);
    delete from public.user_generation_products where product_id = r.loser;

    update public.look_products set product_id = r.winner
     where product_id = r.loser
       and not exists (select 1 from public.look_products x
                        where x.product_id = r.winner and x.look_id = look_products.look_id);
    delete from public.look_products where product_id = r.loser;

    -- catalog_products is regenerated by catalog_assign_product(); just drop.
    delete from public.catalog_products where product_id = r.loser;

    delete from public.products where id = r.loser;
  end loop;
end $$;

-- ── the dedup key ───────────────────────────────────────────────────────────
create unique index if not exists products_normalized_url_uidx
  on public.products (public.normalize_product_url(url))
  where url is not null;
```

- [ ] **Step 2: Verify the duplicate set before applying**

Run via the Supabase MCP (`execute_sql`) to confirm the count still matches what the plan assumes:

```sql
select count(*) - count(distinct public.normalize_product_url(url)) as collisions
  from products where url is not null;
```

Expected: `7`. If it differs, the data moved since 2026-09-15 — re-read the losers' child-row counts before proceeding.

- [ ] **Step 3: Apply the migration**

Apply with `mcp__supabase__apply_migration`, name `normalize_product_url`.

- [ ] **Step 4: Verify**

```sql
select count(*)                                              as rows,
       count(distinct public.normalize_product_url(url))     as distinct_norm,
       (select count(*) from user_generation_products)       as user_gen_rows
  from products where url is not null;
```

Expected: `rows = distinct_norm`, and `user_gen_rows` unchanged from before the migration (the 3 rows were repointed, not deleted). Confirm the index exists:

```sql
select indexname from pg_indexes where indexname = 'products_normalized_url_uidx';
```

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260915000000_normalize_product_url.sql
git commit -m "feat(db): normalize_product_url + unique index, merging 7 duplicate pairs

products had no dedup key at all - only the primary key and the Shopify
composite. 534 rows normalise to 527, so the index needed a merge first.

The 7 loser rows held 3 user_generation_products rows (real user look
generations) and 5 auto-assigned catalog_products rows. Ten of the twelve
tables referencing products cascade on delete, so children are repointed to
the surviving row before it is removed, never cascade-deleted."
```

---

### Task 3: The `shopmy_upsert_batch` RPC

The only writer. Owns conflict handling so the edge function never has to reimplement normalisation.

**Files:**
- Create: `supabase/migrations/20260915000001_shopmy_upsert.sql`

**Interfaces:**
- Consumes: `public.normalize_product_url(text)` from Task 2.
- Produces: `public.shopmy_upsert_batch(rows jsonb) returns jsonb` where the return is `{"inserted": int, "merged": int}`. Each element of `rows` is one mapped product object (keys matching `products` columns plus `raw_data`).

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260915000001_shopmy_upsert.sql`:

```sql
-- Batch writer for ShopMy ingest. Insert-or-fill-nulls on the normalised URL.
--
-- A ShopMy pin carries one image and no description, so it must NEVER
-- overwrite richer data from a real scrape - every conflict path uses
-- coalesce(existing, incoming), not the reverse.
--
-- Batches are capped at 25 because each inserted row fires
-- trg_products_auto_verify_image and trg_products_auto_embed, each a
-- net.http_post to an edge function.

create or replace function public.shopmy_upsert_batch(rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_inserted int := 0;
  v_merged   int := 0;
  v_rowcount int;
begin
  if jsonb_typeof(rows) <> 'array' then
    raise exception 'rows must be a jsonb array';
  end if;
  if jsonb_array_length(rows) > 25 then
    raise exception 'batch too large (% rows, max 25) - see the fan-out note in the spec',
      jsonb_array_length(rows);
  end if;

  with incoming as (
    select
      e->>'url'            as url,
      e->>'name'           as name,
      e->>'brand'          as brand,
      (e->>'price')::numeric as price,
      e->>'currency'       as currency,
      e->>'type'           as type,
      e->>'image_url'      as image_url,
      e->'images'          as images,
      e->'raw_data'        as raw_data
    from jsonb_array_elements(rows) e
  ),
  ins as (
    insert into public.products
      (url, name, brand, price, currency, type, image_url, images,
       raw_data, source, scrape_status, scraped_at, is_active, gender)
    select i.url, i.name, i.brand, i.price, i.currency, i.type, i.image_url, i.images,
           i.raw_data, 'shopmy', 'done', now(), false, null
      from incoming i
    on conflict (public.normalize_product_url(url)) where url is not null
    do update set
      name        = coalesce(public.products.name,      excluded.name),
      brand       = coalesce(public.products.brand,     excluded.brand),
      price       = coalesce(public.products.price,     excluded.price),
      currency    = coalesce(public.products.currency,  excluded.currency),
      type        = coalesce(public.products.type,      excluded.type),
      image_url   = coalesce(public.products.image_url, excluded.image_url),
      images      = case
                      when public.products.images is null
                        or jsonb_array_length(public.products.images) = 0
                      then excluded.images else public.products.images end,
      raw_data    = coalesce(public.products.raw_data, '{}'::jsonb)
                    || jsonb_build_object('shopmy', excluded.raw_data->'shopmy')
    returning (xmax = 0) as was_insert
  )
  select count(*) filter (where was_insert),
         count(*) filter (where not was_insert)
    into v_inserted, v_merged
    from ins;

  return jsonb_build_object('inserted', v_inserted, 'merged', v_merged);
end $$;

revoke all on function public.shopmy_upsert_batch(jsonb) from public, anon, authenticated;
grant execute on function public.shopmy_upsert_batch(jsonb) to service_role;
```

- [ ] **Step 2: Apply and test the conflict path directly**

Apply with `mcp__supabase__apply_migration`, name `shopmy_upsert`. Then verify insert-then-merge behaviour, and that a merge does not clobber:

```sql
-- insert
select public.shopmy_upsert_batch('[{"url":"https://example-test.com/products/zzz-plan-probe",
  "name":"Probe","brand":"ProbeBrand","price":10,"currency":"USD","type":"Shirt",
  "image_url":"https://example-test.com/a.jpg","images":["https://example-test.com/a.jpg"],
  "raw_data":{"shopmy":{"pin_id":1}}}]'::jsonb);
-- expect {"inserted": 1, "merged": 0}

-- same URL with tracking noise + a different name: must merge, must NOT rename
select public.shopmy_upsert_batch('[{"url":"https://www.example-test.com/products/zzz-plan-probe?utm_source=x",
  "name":"DIFFERENT","brand":null,"price":null,"currency":null,"type":null,
  "image_url":null,"images":[],"raw_data":{"shopmy":{"pin_id":2}}}]'::jsonb);
-- expect {"inserted": 0, "merged": 1}

select name, brand, source, scrape_status, is_active
  from products where url like '%zzz-plan-probe%';
-- expect exactly 1 row, name='Probe' (NOT 'DIFFERENT'), source='shopmy',
--        scrape_status='done', is_active=false
```

- [ ] **Step 3: Clean up the probe row**

```sql
delete from products where url like '%zzz-plan-probe%';
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260915000001_shopmy_upsert.sql
git commit -m "feat(db): shopmy_upsert_batch RPC

Single writer for ShopMy ingest. Conflicts resolve on the normalised URL and
every column uses coalesce(existing, incoming) so a ShopMy pin - one image,
no description - can never overwrite richer data from a real scrape.

Hard-caps the batch at 25 rows: each insert fires trg_products_auto_verify_image
and trg_products_auto_embed, both net.http_post calls to edge functions."
```

---

### Task 4: Capture the fixture

A checked-in real payload makes the mapper testable without network and detects upstream API drift.

**Files:**
- Create: `supabase/functions/_shared/fixtures/shopmy-collection.json`
- Create: `supabase/functions/_shared/fixtures/shopmy-sections.json`

**Interfaces:**
- Produces: two JSON fixtures consumed by `shopmy.test.ts` in Task 5.

- [ ] **Step 1: Capture both payloads**

```bash
mkdir -p supabase/functions/_shared/fixtures
curl -s -H 'Origin: https://shopmy.us' -H 'User-Agent: catalog-ingest/1.0' \
  'https://apiv3.shopmy.us/api/Shop/Collections?Curator_username=justbobbidotcom&Section_id=409&limit=24' \
  | python3 -m json.tool > supabase/functions/_shared/fixtures/shopmy-sections.json
curl -s -H 'Origin: https://shopmy.us' -H 'User-Agent: catalog-ingest/1.0' \
  'https://apiv3.shopmy.us/api/Collections/4132497' \
  | python3 -m json.tool > supabase/functions/_shared/fixtures/shopmy-collection.json
```

- [ ] **Step 2: Verify the fixtures contain the cases the tests need**

```bash
python3 -c "
import json
d=json.load(open('supabase/functions/_shared/fixtures/shopmy-collection.json'))
pins=d['pins']
print('pins:',len(pins))
print('has gucci/mytheresa pin:', any('mytheresa' in (p.get('link') or '') for p in pins))
print('has incomplete pin:', any(not (p.get('product') or {}).get('AllBrand_name') for p in pins))
s=json.load(open('supabase/functions/_shared/fixtures/shopmy-sections.json'))
print('collections:',len(s['collections']),'sections:',len(s['sections']))
"
```

Expected: `pins: 14`, both `True`, `collections: 14 sections: 9`.

If `has incomplete pin` is `False`, the creator has since fixed those pins — pick another collection that still has one, because Task 5's skip test depends on it.

- [ ] **Step 3: Strip the volatile fields**

The API echoes the caller's IP and geo into every pin. Remove them so the fixture is stable and carries no incidental personal data:

```bash
python3 - <<'PY'
import json,pathlib
p = pathlib.Path('supabase/functions/_shared/fixtures/shopmy-collection.json')
d = json.loads(p.read_text())
for pin in d.get('pins', []):
    pin.pop('ip', None)
    pin.pop('geo', None)
p.write_text(json.dumps(d, indent=1))
print('stripped ip/geo from', len(d.get('pins', [])), 'pins')
PY
```

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/_shared/fixtures/
git commit -m "test(shopmy): capture real API fixtures for the mapper

Two payloads from apiv3.shopmy.us captured 2026-09-15. Caller IP and geo are
stripped - the API echoes them into every pin. Also serves as a drift detector
against upstream API changes."
```

---

### Task 5: The pin → product mapper

Pure functions, no I/O. This is the heart of the feature and where the tests live.

**Files:**
- Create: `supabase/functions/_shared/shopmy.ts`
- Test: `supabase/functions/_shared/shopmy.test.ts`

**Interfaces:**
- Consumes: the Task 4 fixtures.
- Produces:
  - `parseShopMyUrl(raw: string): { username: string; sectionId: number | null } | null`
  - `mapPin(pin: ShopMyPin, ctx: PinContext): MappedProduct | { skip: string }`
  - `type PinContext = { curator: string; collectionId: number; collectionName: string; sectionName: string | null }`
  - `type MappedProduct = { url, name, brand, price, currency, type, image_url, images, raw_data }`

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/_shared/shopmy.test.ts`:

```ts
// Run: deno test --no-check --allow-read supabase/functions/_shared/shopmy.test.ts
import { parseShopMyUrl, mapPin } from './shopmy.ts';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`FAILED: ${msg}`);
}

const fixture = JSON.parse(
  await Deno.readTextFile(new URL('./fixtures/shopmy-collection.json', import.meta.url)),
);
const CTX = { curator: 'justbobbidotcom', collectionId: 4132497,
              collectionName: 'The Shoe Diary', sectionName: "Bobbi's Closet" };

Deno.test('parses a shop URL with a section', () => {
  const r = parseShopMyUrl('https://shopmy.us/shop/justbobbidotcom?tab=collections&Section_id=409');
  assert(r?.username === 'justbobbidotcom', 'username');
  assert(r?.sectionId === 409, 'sectionId');
});

Deno.test('parses a shop URL without a section', () => {
  const r = parseShopMyUrl('https://shopmy.us/justbobbidotcom');
  assert(r?.username === 'justbobbidotcom', 'bare username form');
  assert(r?.sectionId === null, 'no section');
});

Deno.test('rejects a non-ShopMy URL', () => {
  assert(parseShopMyUrl('https://ltk.app/someone') === null, 'must reject non-shopmy host');
});

Deno.test('maps the merchant PDP, never the affiliate link', () => {
  const pin = fixture.pins.find((p: any) => (p.link ?? '').includes('mytheresa'));
  assert(!!pin, 'fixture must contain the mytheresa pin');
  const m = mapPin(pin, CTX) as any;
  assert(!('skip' in m), 'should not skip');
  assert(m.url.includes('mytheresa.com'), 'url must be the merchant PDP');
  assert(!m.url.includes('linksynergy'), 'url must never be the Rakuten affiliate link');
  assert(m.brand === 'Gucci', `brand should prefer AllBrand_name, got ${m.brand}`);
  assert(m.price === 820, `price from fallbackPrice, got ${m.price}`);
  assert(m.currency === 'USD', 'currency');
  assert(m.type === 'Clogs', 'type from Category_name');
  assert(Array.isArray(m.images) && m.images.length === 1, 'exactly one image');
});

Deno.test('strips the BRAND | prefix from the title', () => {
  const pin = fixture.pins.find((p: any) => (p.title ?? '').includes('|'));
  assert(!!pin, 'fixture must contain a piped title');
  const m = mapPin(pin, CTX) as any;
  assert(!m.name.includes('|'), `name should not keep the pipe, got ${m.name}`);
});

Deno.test('skips a pin with no brand and no price', () => {
  const bad = fixture.pins.filter((p: any) => {
    const pr = p.product ?? {};
    return !pr.AllBrand_name && pr.fallbackPrice == null;
  });
  assert(bad.length > 0, 'fixture must contain an incomplete pin');
  for (const p of bad) {
    const m = mapPin(p, CTX) as any;
    assert('skip' in m, `expected skip for ${p.title}`);
  }
});

Deno.test('skips a pin whose link is not a product page', () => {
  const m = mapPin(
    { id: 1, title: 'Cart', link: 'https://www.amazon.com/gp/cart/view.html',
      image: 'https://x/a.jpg', product: { AllBrand_name: 'X', fallbackPrice: 5 } } as any,
    CTX,
  ) as any;
  assert('skip' in m, 'cart link must be skipped');
});

Deno.test('keeps curation context in raw_data', () => {
  const pin = fixture.pins[0];
  const m = mapPin(pin, CTX) as any;
  if ('skip' in m) return;
  assert(m.raw_data.shopmy.collection_name === 'The Shoe Diary', 'collection name kept');
  assert(m.raw_data.shopmy.section_name === "Bobbi's Closet", 'section name kept');
  assert(m.raw_data.shopmy.curator === 'justbobbidotcom', 'curator kept');
  assert(typeof m.raw_data.shopmy.affiliate_link !== 'undefined', 'their link kept as provenance');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test --no-check --allow-read supabase/functions/_shared/shopmy.test.ts`
Expected: FAIL — `Module not found ./shopmy.ts`.

- [ ] **Step 3: Write the mapper**

Create `supabase/functions/_shared/shopmy.ts`:

```ts
// ShopMy pin → products row. Pure functions, no I/O, so the whole mapping
// contract is unit-testable against a checked-in fixture.
//
// ShopMy's shape: Shop → Section (tab) → Collection → Pin (item).
// A pin already carries brand, price, category, one image and the real
// merchant PDP, so this is a mapping job, not a scrape.

export interface ShopMyPin {
  id: number;
  title?: string | null;
  link?: string | null;
  selectedGeoLink?: string | null;
  affiliate_link?: string | null;
  image?: string | null;
  domain?: string | null;
  merchant_data?: { name?: string; domain?: string; source?: string } | null;
  product?: {
    title?: string | null;
    AllBrand_name?: string | null;
    fallbackPrice?: number | null;
    fallbackPriceCurrency?: string | null;
    fallbackUrl?: string | null;
    Category_name?: string | null;
    Department_name?: string | null;
  } | null;
}

export interface PinContext {
  curator: string;
  collectionId: number;
  collectionName: string;
  sectionName: string | null;
}

export interface MappedProduct {
  url: string;
  name: string;
  brand: string | null;
  price: number | null;
  currency: string | null;
  type: string | null;
  image_url: string | null;
  images: string[];
  raw_data: Record<string, unknown>;
}

/** Parse a ShopMy shop URL into the curator and optional section. */
export function parseShopMyUrl(raw: string): { username: string; sectionId: number | null } | null {
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  if (host !== 'shopmy.us' && host !== 'shop.my') return null;

  const parts = u.pathname.split('/').filter(Boolean);
  // /shop/<username> and the bare /<username> form are both in the wild.
  const username = parts[0] === 'shop' ? parts[1] : parts[0];
  if (!username) return null;

  const rawSection = u.searchParams.get('Section_id');
  const sectionId = rawSection && /^\d+$/.test(rawSection) ? Number(rawSection) : null;
  return { username, sectionId };
}

/** Paths that are never a single product page. */
function isNonProductLink(link: string): boolean {
  let u: URL;
  try { u = new URL(link); } catch { return true; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return true;
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  const path = u.pathname.toLowerCase();
  if (path === '' || path === '/') return true;
  for (const bad of ['/cart', '/checkout', '/search', '/login', '/account']) {
    if (path === bad || path.startsWith(bad + '/') || path.startsWith(bad)) return true;
  }
  // Amazon search / cart, mirroring app/utils/productUrl.ts. /s/ is NOT
  // global - it is Nordstrom's canonical product path.
  if (host === 'amazon.com' || host.endsWith('.amazon.com')) {
    if (path === '/s' || path.startsWith('/s/')) return true;
    if (!path.includes('/dp/') && !path.includes('/gp/product/')) return true;
  }
  return false;
}

/** "GUCCI | Sol GG Canvas Clog" → "Sol GG Canvas Clog" */
function stripBrandPrefix(title: string, brand: string | null): string {
  const cut = title.indexOf('|');
  if (cut === -1) return title.trim();
  const head = title.slice(0, cut).trim();
  const tail = title.slice(cut + 1).trim();
  if (!tail) return head;
  // Only strip when the head really is the brand, not part of the name.
  if (brand && head.toLowerCase() === brand.toLowerCase()) return tail;
  if (head === head.toUpperCase() && head.length <= 30) return tail;
  return title.trim();
}

export function mapPin(pin: ShopMyPin, ctx: PinContext): MappedProduct | { skip: string } {
  const p = pin.product ?? {};

  const url = pin.selectedGeoLink || pin.link || p.fallbackUrl || '';
  if (!url) return { skip: 'no_link' };
  if (isNonProductLink(url)) return { skip: 'non_product_url' };

  const brand = p.AllBrand_name ?? pin.merchant_data?.name ?? null;
  const price = typeof p.fallbackPrice === 'number' ? p.fallbackPrice : null;

  // A pin with neither brand nor price is a bookmark, not a product.
  if (!brand && price === null) return { skip: 'no_brand_or_price' };

  const rawTitle = (p.title || pin.title || '').trim();
  if (!rawTitle) return { skip: 'no_title' };
  const name = stripBrandPrefix(rawTitle, brand);

  const image = pin.image ?? null;
  if (!image) return { skip: 'no_image' };

  return {
    url,
    name,
    brand,
    price,
    currency: p.fallbackPriceCurrency ?? (price !== null ? 'USD' : null),
    type: p.Category_name ?? p.Department_name ?? null,
    image_url: image,
    images: [image],
    raw_data: {
      shopmy: {
        pin_id: pin.id,
        curator: ctx.curator,
        collection_id: ctx.collectionId,
        collection_name: ctx.collectionName,
        section_name: ctx.sectionName,
        // Provenance only. Their Rakuten publisher ID - never used as our link.
        affiliate_link: pin.affiliate_link ?? null,
        merchant_domain: pin.domain ?? pin.merchant_data?.domain ?? null,
        department: p.Department_name ?? null,
      },
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno test --no-check --allow-read supabase/functions/_shared/shopmy.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/shopmy.ts supabase/functions/_shared/shopmy.test.ts
git commit -m "feat(shopmy): pin -> product mapper with fixture-backed tests

Pure mapping, no I/O. Takes the merchant PDP from selectedGeoLink and keeps
ShopMy's Rakuten affiliate_link in raw_data as provenance only - using it
would credit their account rather than ours.

Skips pins that are bookmarks rather than products (no brand and no price,
no image, or a cart/search link) with an explicit reason, so the run summary
can report why."
```

---

### Task 6: The `shopmy-ingest` edge function

**Files:**
- Create: `supabase/functions/shopmy-ingest/index.ts`

**Interfaces:**
- Consumes: `parseShopMyUrl`, `mapPin`, `PinContext` from `_shared/shopmy.ts`; `urlAllowed` from `_shared/ssrf-guard.ts`; the `shopmy_upsert_batch` RPC.
- Produces: `POST /functions/v1/shopmy-ingest` with body `{ url?, username?, section_id?, dry_run?, batch_size?, batch_delay_ms?, max_collections? }` returning `{ success, curator, sections, collections, pins, inserted, merged, skipped: Record<string, number>, rows? }`.

- [ ] **Step 1: Write the function**

Create `supabase/functions/shopmy-ingest/index.ts`:

```ts
// ShopMy creator-shop ingest.
//
// ShopMy is a client-rendered SPA with no SSR payload, but apiv3.shopmy.us
// serves the whole shop as JSON and needs only an Origin header - no auth, no
// browser, no model.
//
// THROTTLING IS NOT OPTIONAL. Every inserted product fires
// trg_products_auto_verify_image and trg_products_auto_embed, each a
// net.http_post to another edge function. One creator shop is ~424 pins; an
// unthrottled insert is ~1,270 edge invocations and ~850 Anthropic calls, which
// degrades every other product in the catalog, not just the new ones.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { parseShopMyUrl, mapPin, type PinContext, type MappedProduct } from '../_shared/shopmy.ts';
import { urlAllowed } from '../_shared/ssrf-guard.ts';

const API = 'https://apiv3.shopmy.us';
const HEADERS = {
  // The API returns 401 without this. Nothing else is required.
  'Origin': 'https://shopmy.us',
  'User-Agent': 'catalog-ingest/1.0 (+https://catalog.shop)',
  'Accept': 'application/json',
};

const DEFAULT_BATCH = 25;
const DEFAULT_DELAY_MS = 1500;
const COLLECTION_CONCURRENCY = 4;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getJson(url: string, attempt = 0): Promise<any> {
  if (!urlAllowed(url)) throw new Error(`blocked url: ${url}`);
  const res = await fetch(url, { headers: HEADERS });
  if (res.status === 429 || res.status >= 500) {
    if (attempt >= 3) throw new Error(`${res.status} after ${attempt} retries: ${url}`);
    const retryAfter = Number(res.headers.get('retry-after')) || 0;
    await sleep(retryAfter > 0 ? retryAfter * 1000 : 500 * Math.pow(2, attempt));
    return getJson(url, attempt + 1);
  }
  if (!res.ok) throw new Error(`${res.status} ${await res.text().catch(() => '')} — ${url}`);
  return res.json();
}

/** Run tasks with a fixed concurrency ceiling — politeness to the upstream API. */
async function pooled<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]);
      }
    }),
  );
  return out;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });

  try {
    const body = await req.json().catch(() => ({}));
    const dryRun = body.dry_run !== false;   // safe by default: must opt IN to writing
    const batchSize = Math.min(Math.max(Number(body.batch_size) || DEFAULT_BATCH, 1), 25);
    const delayMs = Math.max(Number(body.batch_delay_ms) ?? DEFAULT_DELAY_MS, 0);

    let username: string | null = body.username ?? null;
    let sectionId: number | null = body.section_id ?? null;
    if (body.url) {
      const parsed = parseShopMyUrl(String(body.url));
      if (!parsed) {
        return Response.json({ success: false, error: 'not a ShopMy URL' }, { status: 400 });
      }
      username = parsed.username;
      if (sectionId == null) sectionId = parsed.sectionId;
    }
    if (!username) {
      return Response.json({ success: false, error: 'provide url or username' }, { status: 400 });
    }

    // ── 1. sections + collections ──────────────────────────────────────────
    const listUrl = new URL(`${API}/api/Shop/Collections`);
    listUrl.searchParams.set('Curator_username', username);
    listUrl.searchParams.set('limit', '100');
    if (sectionId != null) listUrl.searchParams.set('Section_id', String(sectionId));

    const list = await getJson(listUrl.toString());
    const sections: Array<{ id: number; title: string }> = list.sections ?? [];
    let collections: Array<{ id: number; name: string; Section_id: number }> = list.collections ?? [];
    if (body.max_collections) collections = collections.slice(0, Number(body.max_collections));

    if (collections.length === 0) {
      return Response.json({ success: false, error: `no collections for ${username}` }, { status: 404 });
    }
    const sectionName = (id: number) => sections.find((s) => s.id === id)?.title ?? null;

    // ── 2. pins, one request per collection ────────────────────────────────
    const skipped: Record<string, number> = {};
    const mapped: MappedProduct[] = [];
    let pinCount = 0;
    const failures: string[] = [];

    await pooled(collections, COLLECTION_CONCURRENCY, async (c) => {
      let detail: any;
      try {
        detail = await getJson(`${API}/api/Collections/${c.id}`);
      } catch (e) {
        // One bad collection must not abort a 64-collection run.
        failures.push(`collection ${c.id}: ${String(e).slice(0, 120)}`);
        return;
      }
      const ctx: PinContext = {
        curator: username!,
        collectionId: c.id,
        collectionName: c.name,
        sectionName: sectionName(c.Section_id),
      };
      for (const pin of detail.pins ?? []) {
        pinCount++;
        const m = mapPin(pin, ctx);
        if ('skip' in m) { skipped[m.skip] = (skipped[m.skip] ?? 0) + 1; continue; }
        mapped.push(m);
      }
    });

    // Deduplicate within the run — the same product appears in several
    // collections, and one batch cannot touch the same row twice.
    const seen = new Set<string>();
    const unique = mapped.filter((m) => {
      const key = m.url.toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
      if (seen.has(key)) { skipped['duplicate_in_run'] = (skipped['duplicate_in_run'] ?? 0) + 1; return false; }
      seen.add(key);
      return true;
    });

    const summary = {
      success: true, curator: username, section_id: sectionId,
      sections: sections.length, collections: collections.length,
      pins: pinCount, mapped: unique.length, skipped,
      failures: failures.length ? failures : undefined,
    };

    if (dryRun) {
      return Response.json({ ...summary, dry_run: true, inserted: 0, merged: 0, rows: unique });
    }

    // ── 3. throttled write ─────────────────────────────────────────────────
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    let inserted = 0, merged = 0;
    for (let i = 0; i < unique.length; i += batchSize) {
      const batch = unique.slice(i, i + batchSize);
      const { data, error } = await admin.rpc('shopmy_upsert_batch', { rows: batch });
      if (error) throw new Error(`upsert batch ${i / batchSize}: ${error.message}`);
      inserted += data?.inserted ?? 0;
      merged += data?.merged ?? 0;
      if (i + batchSize < unique.length && delayMs > 0) await sleep(delayMs);
    }

    return Response.json({ ...summary, dry_run: false, inserted, merged });
  } catch (e) {
    return Response.json({ success: false, error: String(e).slice(0, 500) }, { status: 500 });
  }
});
```

- [ ] **Step 2: Deploy**

Deploy with `mcp__supabase__deploy_edge_function`, name `shopmy-ingest`.

- [ ] **Step 3: Verify the dry run — it must write nothing**

```bash
curl -s -X POST "$SUPABASE_URL/functions/v1/shopmy-ingest" \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" -H 'Content-Type: application/json' \
  -d '{"url":"https://shopmy.us/shop/justbobbidotcom?tab=collections&Section_id=409","dry_run":true}' \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print({k:v for k,v in d.items() if k!='rows'}); print('first row:', json.dumps(d['rows'][0], indent=1))"
```

Expected: `collections: 14`, `pins: 123`, a non-zero `mapped`, a `skipped` map, `inserted: 0`.

Confirm nothing was written:

```sql
select count(*) from products where source = 'shopmy';
```
Expected: `0`.

- [ ] **Step 4: Verify the guard rails**

```bash
# a non-ShopMy URL is rejected
curl -s -X POST "$SUPABASE_URL/functions/v1/shopmy-ingest" \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" -H 'Content-Type: application/json' \
  -d '{"url":"https://ltk.app/someone","dry_run":true}'
# expect {"success":false,"error":"not a ShopMy URL"}

# omitting dry_run must NOT write
curl -s -X POST "$SUPABASE_URL/functions/v1/shopmy-ingest" \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" -H 'Content-Type: application/json' \
  -d '{"username":"justbobbidotcom","max_collections":1}' \
  | python3 -c "import json,sys; print('dry_run:', json.load(sys.stdin).get('dry_run'))"
# expect dry_run: True
```

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/shopmy-ingest/index.ts
git commit -m "feat(shopmy): shopmy-ingest edge function

Reads apiv3.shopmy.us (Origin header only - no auth, no browser, no model),
maps pins via _shared/shopmy.ts and writes through shopmy_upsert_batch.

Writes are throttled to 25-row batches with a pause between them: each insert
fires two net.http_post triggers, so an unthrottled 424-pin shop would be
~1,270 edge invocations. dry_run defaults to TRUE - writing must be opted into.
A failed collection is recorded and skipped rather than aborting the run."
```

---

### Task 7: First real ingest, one collection

The first write. Small on purpose: verify the trigger fan-out behaves before scaling.

**Files:** none — this is a verification task.

- [ ] **Step 1: Record the baseline**

```sql
select
  (select count(*) from products)                                      as products,
  (select count(*) from products where source='shopmy')                as shopmy,
  (select count(*) from products where scrape_status='pending')        as pending,
  (select coalesce(sum(estimated_cost_usd),0) from ai_usage_logs
     where created_at > now() - interval '1 hour')                     as usd_last_hour;
```

- [ ] **Step 2: Ingest exactly one collection**

```bash
curl -s -X POST "$SUPABASE_URL/functions/v1/shopmy-ingest" \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" -H 'Content-Type: application/json' \
  -d '{"username":"justbobbidotcom","section_id":409,"max_collections":1,"dry_run":false}'
```

Expected: `inserted` between 1 and 25, `merged` 0 or small.

- [ ] **Step 3: Verify nothing was sent to the Modal scraper**

```sql
select count(*) from products where source='shopmy' and scrape_status <> 'done';
```
Expected: `0`. Any other value means the `scrape-new-products` trigger fired — stop and fix before continuing.

- [ ] **Step 4: Wait 3 minutes, then verify the enrich chain ran**

```sql
select count(*)                                              as rows,
       count(*) filter (where image_verified is not null)    as verified,
       count(*) filter (where image_url like '%supabase.co/storage%') as rehosted,
       count(*) filter (where is_active)                     as active
  from products where source = 'shopmy';
```

Expected: `verified` and `rehosted` climbing toward `rows`; `active = 0` (activation is a separate, deliberate step).

- [ ] **Step 5: Verify cost and errors**

```sql
select operation, count(*), round(sum(estimated_cost_usd)::numeric,4) usd
  from ai_usage_logs where created_at > now() - interval '15 minutes'
 group by 1 order by 3 desc nulls last;
```

Check the `verify-product-image` logs with `mcp__supabase__get_logs`. Expected: no credit-balance or rate-limit errors. **If any appear, stop** — the remaining batches would multiply them.

- [ ] **Step 6: Commit the verification note**

```bash
git commit --allow-empty -m "chore(shopmy): verified first live collection ingest

One collection ingested. Confirmed: no row reached scrape_status='pending' (the
Modal scraper was not triggered), verify-product-image re-hosted the images,
nothing auto-activated, and no Anthropic credit or rate-limit errors."
```

---

### Task 8: Route ShopMy URLs in the admin panel

**Files:**
- Modify: `app/components/ProfileCrawlsPanel.tsx`

**Interfaces:**
- Consumes: the `shopmy-ingest` function from Task 6.
- Produces: no new exports. A ShopMy URL calls `shopmy-ingest`; every other URL keeps the existing AI crawl.

- [ ] **Step 1: Read the existing submit handler**

Read `app/components/ProfileCrawlsPanel.tsx` in full. It already carries `https://shopmy.us/drconnieyang` as its input placeholder and calls the site-crawler profile path. Find the submit handler and the state it sets.

- [ ] **Step 2: Add host detection above the handler**

```tsx
/** ShopMy publishes a JSON API, so it never needs the AI crawl. */
function isShopMyUrl(raw: string): boolean {
  try {
    const host = new URL(raw).hostname.toLowerCase().replace(/^www\./, '');
    return host === 'shopmy.us' || host === 'shop.my';
  } catch {
    return false;
  }
}
```

- [ ] **Step 3: Branch in the submit handler**

At the top of the existing submit handler, before the current profile-crawl call:

```tsx
    if (isShopMyUrl(url)) {
      const { data, error } = await supabase.functions.invoke('shopmy-ingest', {
        body: { url, dry_run: true },
      });
      if (error) { setError(error.message); return; }
      setShopMyPreview(data);   // render summary + a "Ingest for real" confirm
      return;
    }
```

Add `const [shopMyPreview, setShopMyPreview] = useState<any>(null);` alongside the existing state, and render the preview with counts (`collections`, `pins`, `mapped`, `skipped`) plus a button that re-invokes with `dry_run: false`. **The confirm step is required** — never write on first submit.

- [ ] **Step 4: Verify both paths**

Run: `npm run dev`, open the admin profile-crawls panel.

- Paste `https://shopmy.us/shop/justbobbidotcom?tab=collections&Section_id=409` → expect the preview summary, and **no** new `crawl_jobs` row.
- Paste any non-ShopMy profile URL → expect the existing AI crawl to start, i.e. a new `crawl_jobs` row.

```sql
select id, status, created_at from crawl_jobs order by created_at desc limit 3;
```

- [ ] **Step 5: Typecheck, lint, test**

Run: `npm run typecheck && npm run lint && npx vitest run`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/components/ProfileCrawlsPanel.tsx
git commit -m "feat(admin): route ShopMy URLs to shopmy-ingest

The panel already used shopmy.us as its placeholder but sent it through the
AI profile crawl. ShopMy publishes a JSON API, so it now previews via
shopmy-ingest (dry run) and requires an explicit confirm before writing.
Every other profile host keeps the existing crawl path."
```

---

### Task 9: Ingest the remaining collections

- [ ] **Step 1: Ingest the rest of Section 409**

```bash
curl -s -X POST "$SUPABASE_URL/functions/v1/shopmy-ingest" \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" -H 'Content-Type: application/json' \
  -d '{"username":"justbobbidotcom","section_id":409,"dry_run":false,"batch_delay_ms":3000}'
```

- [ ] **Step 2: Verify after each section**

```sql
select count(*) filter (where source='shopmy')                    as shopmy_rows,
       count(*) filter (where source='shopmy' and image_verified) as verified,
       count(*) filter (where scrape_status='pending')            as must_be_zero
  from products;
```

Check `ai_usage_logs` and the edge-function logs for errors before starting another section.

- [ ] **Step 3: Decide on the non-apparel sections**

"Home" (58 pins), "Dogs" (9) and "Discount Codes" (6) are not fashion products. Per spec §10 this is a judgement call — ask the user before ingesting them.

- [ ] **Step 4: Rollback if needed**

```sql
delete from products where source = 'shopmy' and created_at > '<run start timestamp>';
```

Safe because ShopMy rows never enter the feed without a separate activation.

---

## Self-Review

**Spec coverage**

| Spec section | Task |
|---|---|
| §4 architecture, edge function, dry_run, scope-follows-URL | 6 |
| §4.1 ProfileCrawlsPanel entry point | 8 |
| §5 pin → products mapping, `scrape_status='done'` | 3, 5 |
| §6 dedup, normalisation, merge-not-overwrite | 2, 3, 6 (in-run dedup) |
| §6 duplicate merge before index, child repointing | 2 |
| §6a throttled batches, trigger fan-out | 3 (25-row cap), 6 (batching) |
| §7 error classification, skip reasons, retry/backoff, politeness | 5 (skips), 6 (backoff, pooling) |
| §7 `/s/` blocking dependency | 1 |
| §8 testing — all 5 listed assertions | 5 |
| §11 rollout steps 1–7 | 1, 2, 6, 7, 8, 9 |

**Gap found and closed:** spec §8 asserts "a URL appearing in two collections produces one row". The mapper is per-pin and cannot see across collections, so this is enforced in the edge function's in-run dedup (Task 6, step 1) rather than in `shopmy.test.ts` — a single batch must not touch the same row twice, or the upsert errors. Noted here so the discrepancy with §8 is deliberate, not an oversight.

**Placeholder scan:** no TBDs; every code step carries real code; every verification step carries a runnable command and an expected result.

**Type consistency:** `parseShopMyUrl` returns `{ username, sectionId }` and is destructured as such in Task 6. `mapPin` returns `MappedProduct | { skip: string }`, narrowed with `'skip' in m` in both the test and the function. `MappedProduct` keys match the `incoming` CTE in `shopmy_upsert_batch` exactly: `url, name, brand, price, currency, type, image_url, images, raw_data`.
