# Catalog Pipeline Automation (Slice 1: The Spine) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a product travel from scrape to published with no human action, governed by admin policy, and give the operator one page that shows whether it is working.

**Architecture:** Keep the existing DB-trigger chain untouched. Add a *derived* `pipeline_stage()` function that computes a product's position from columns that already exist, an append-only `pipeline_events` log for transitions and failures, two rate-limited cron drivers (creative + publish), and two admin pages. No table stores pipeline state, so nothing can drift.

**Tech Stack:** Postgres 15 / Supabase (plpgsql, pg_cron, pg_net), Deno edge functions, Modal + Python (video generator), Remix v2 SPA + React 19 + vanilla CSS.

## Global Constraints

- Branch is `dev`. Commit directly to `dev`. Never create feature branches. Never force-push.
- Every new cron and driver is **fail-closed**: a missing or unparseable setting means OFF.
- Both drivers default to `dry_run = true`. Enabling is always an explicit, separate action.
- Migrations live in `supabase/migrations/NNNN_<snake_case>.sql` and must also be applied to the live project `vtarjrnqvcqbhoclvcur`.
- **Applying migrations is the CONTROLLER's job, via the Supabase MCP `apply_migration`.** Do NOT run `supabase migration up`, `db push`, or `migration repair`. The repo and the remote deliberately disagree on version strings — the remote records MCP-generated timestamps (`20260728133737 normalize_product_type_and_brand`) while repo files use hand-written ones (`20260728000000_…`). The CLI reads that as an unsynced history and refuses. This is the documented workflow in CLAUDE.md §7, not a defect to repair. An implementer subagent writes the migration FILE and stops; the controller applies it and runs the verification SQL.
- Never run any command that mutates production migration history.
- Nothing in this plan deactivates a product. `pipeline_publish` is promote-only.
- The catalog is deliberately multi-category. Do not add an apparel-only filter anywhere.
- Admin RPCs are `SECURITY DEFINER` with `SET search_path TO 'public'` and must check `profiles.is_admin`.
- No new Modal web endpoint. The workspace cap is 8 and all 8 are spoken for.
- Task 5 must not be enabled in production until Task 3 is deployed and reporting real cost.

---

### Task 1: Derived pipeline stage function

**Files:**
- Create: `supabase/migrations/20260729000000_pipeline_stage.sql`

**Interfaces:**
- Produces: `public.pipeline_stage(p public.products) → text`, returning exactly one of
  `discovered`, `scrape_failed`, `unverified`, `needs_review`, `blocked:occasion`,
  `awaiting_creative`, `creative_pending`, `ready_to_publish`, `published`,
  `published_no_creative`. Used by Tasks 5, 6, 9.
- Produces: `public.test_pipeline_stage() → text` returning `'ok'` or raising.

- [ ] **Step 1: Write the failing test**

Create `supabase/migrations/20260729000000_pipeline_stage.sql` with ONLY the test function first:

```sql
create or replace function public.test_pipeline_stage()
returns text language plpgsql as $$
declare r public.products; got text;
begin
  select * into r from public.products limit 1;
  r.id := gen_random_uuid();          -- detach from real product_creative rows

  r.is_active := true;  r.primary_video_url := 'https://x/v.mp4';
  got := public.pipeline_stage(r);
  assert got = 'published', 'expected published, got ' || got;

  r.primary_video_url := null;
  got := public.pipeline_stage(r);
  assert got = 'published_no_creative', 'expected published_no_creative, got ' || got;

  r.is_active := false; r.scrape_status := 'pending';
  got := public.pipeline_stage(r);
  assert got = 'discovered', 'expected discovered, got ' || got;

  r.scrape_status := 'failed'; r.images := '[]'::jsonb;
  got := public.pipeline_stage(r);
  assert got = 'scrape_failed', 'expected scrape_failed, got ' || got;

  -- a failed scrape WITH a usable gallery is not terminal
  r.images := '["https://x/a.jpg"]'::jsonb; r.image_verified := null;
  got := public.pipeline_stage(r);
  assert got = 'unverified', 'failed scrape w/ images should continue, got ' || got;

  r.image_verified := true; r.image_verify_note := 'needs_review:dead';
  got := public.pipeline_stage(r);
  assert got = 'needs_review', 'expected needs_review, got ' || got;

  r.image_verify_note := 'clean';
  r.styling_metadata := '{}'::jsonb;
  got := public.pipeline_stage(r);
  assert got = 'blocked:occasion', 'expected blocked:occasion, got ' || got;

  r.styling_metadata := '{"occasion":"date night"}'::jsonb;
  got := public.pipeline_stage(r);
  assert got = 'awaiting_creative', 'expected awaiting_creative, got ' || got;

  r.primary_video_url := 'https://x/v.mp4';
  got := public.pipeline_stage(r);
  assert got = 'ready_to_publish', 'expected ready_to_publish, got ' || got;

  return 'ok';
end $$;
```

- [ ] **Step 2: Run test to verify it fails**

Apply the migration, then run:

```sql
select public.test_pipeline_stage();
```

Expected: FAIL with `function public.pipeline_stage(products) does not exist`.

- [ ] **Step 3: Write the implementation**

Prepend to the SAME migration file, above the test function:

```sql
-- Derived pipeline position. NEVER stored. Every panel and both drivers use
-- this one definition so no two numbers on the dashboard can disagree.
-- STABLE (not IMMUTABLE) because it reads product_creative.
create or replace function public.pipeline_stage(p public.products)
returns text language sql stable as $$
  select case
    when p.is_active and p.primary_video_url is not null then 'published'
    -- live but invisible: video is a hard feed filter (product-creative.ts:387)
    when p.is_active and p.primary_video_url is null     then 'published_no_creative'
    when p.scrape_status = 'pending'                     then 'discovered'
    when p.scrape_status = 'failed'
         and coalesce(jsonb_array_length(p.images), 0) = 0 then 'scrape_failed'
    when p.image_verified is null                        then 'unverified'
    when p.image_verify_note like 'needs_review%'        then 'needs_review'
    when coalesce(p.styling_metadata->>'occasion','') = '' then 'blocked:occasion'
    when p.primary_video_url is not null                 then 'ready_to_publish'
    when exists (
      select 1 from public.product_creative c
       where c.product_id = p.id
         and c.status in ('pending','queued','generating','running')
    ) then 'creative_pending'
    else 'awaiting_creative'
  end
$$;
```

- [ ] **Step 4: Run test to verify it passes**

```sql
select public.test_pipeline_stage();
```

Expected: `ok`

Then sanity-check against the live catalog:

```sql
select public.pipeline_stage(p.*) as stage, count(*)
from public.products p group by 1 order by 2 desc;
```

Expected: `published` ≈ 164, `published_no_creative` ≈ 177, plus the 18 recent rows spread across `awaiting_creative` / `ready_to_publish`, and ~54 inactive google-URL rows. Total must equal `select count(*) from products` (436+).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260729000000_pipeline_stage.sql
git commit -m "feat(pipeline): derived pipeline_stage() + self-check"
```

---

### Task 2: Pipeline event log

**Files:**
- Create: `supabase/migrations/20260729000001_pipeline_events.sql`

**Interfaces:**
- Produces: table `public.pipeline_events(id bigserial, product_id uuid, stage text, event text, detail jsonb, created_at timestamptz)`. Written by Tasks 5, 6, 7, 8. Read by Task 9.

- [ ] **Step 1: Write the failing test**

```sql
do $$ begin
  perform 1 from information_schema.tables
   where table_schema='public' and table_name='pipeline_events';
  assert found, 'pipeline_events table missing';
end $$;
```

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL with `pipeline_events table missing`.

- [ ] **Step 3: Write the implementation**

```sql
-- Transitions and failures ONLY. Never current state - that is derived by
-- pipeline_stage(). Nothing here is authoritative, so nothing here can drift.
create table if not exists public.pipeline_events (
  id         bigserial primary key,
  product_id uuid references public.products(id) on delete cascade,
  stage      text not null,
  event      text not null,          -- queued|done|failed|published|blocked|skipped|budget
  detail     jsonb,
  created_at timestamptz not null default now()
);

create index if not exists pipeline_events_created_idx
  on public.pipeline_events (created_at desc);
create index if not exists pipeline_events_product_idx
  on public.pipeline_events (product_id, created_at desc);

alter table public.pipeline_events enable row level security;

create policy "admins read pipeline_events" on public.pipeline_events
  for select using (
    exists (select 1 from public.profiles me
             where me.id = (select auth.uid()) and me.is_admin)
  );
-- writes are service-role only; service_role bypasses RLS, so no INSERT policy.
```

- [ ] **Step 4: Run test to verify it passes**

Re-run the Step 1 block. Expected: no error. Then confirm RLS is on:

```sql
select relrowsecurity from pg_class where relname='pipeline_events';
```

Expected: `true`

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260729000001_pipeline_events.sql
git commit -m "feat(pipeline): append-only pipeline_events log"
```

---

### Task 3: Real Fal cost logging (blocking prerequisite for Task 5)

**Files:**
- Modify: `agents/video-generator/ad_generator.py:516-533` (cost call + update payload)
- Modify: `agents/video-generator/ad_generator.py:579-585` (`_estimate_cost`)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `product_creative.cost_usd` reflecting the ACTUAL model and duration, plus one `ai_usage_logs` row per creative with `platform='fal'`, `operation='product-creative'`.

**Context:** `_estimate_cost` is currently called with `GENERATION_DEFAULTS["model"]` — the *default* model, not the model actually used (`ad_model`, written to `product_creative.model` at line 450) — against a 3-entry Veo-only table. Every Seedance render falls through to the `0.10` fallback. All 41 existing rows read exactly `0.1000`. `ai_usage_logs` contains zero `fal` rows.

- [ ] **Step 1: Write the failing test**

Create `agents/video-generator/test_cost.py`:

```python
from ad_generator import _estimate_cost

def test_seedance_priced_per_second():
    # 10s Seedance pro must NOT fall through to the 0.10 default
    assert _estimate_cost("bytedance/seedance-2.0/pro/reference-to-video", "720p", 10) > 0.5

def test_seedance_fast_cheaper_than_pro():
    fast = _estimate_cost("bytedance/seedance-2.0/fast/reference-to-video", "720p", 10)
    pro  = _estimate_cost("bytedance/seedance-2.0/pro/reference-to-video", "720p", 10)
    assert fast < pro

def test_duration_scales_cost():
    five = _estimate_cost("bytedance/seedance-2.0/fast/reference-to-video", "720p", 5)
    ten  = _estimate_cost("bytedance/seedance-2.0/fast/reference-to-video", "720p", 10)
    assert abs(ten - five * 2) < 0.001

def test_veo_still_priced():
    assert _estimate_cost("veo-3.1-fast-generate-preview", "720p", 8) > 0

def test_unknown_model_is_not_silently_cheap():
    # an unknown slug must be conservative, not 0.10
    assert _estimate_cost("some/unknown-model", "720p", 10) >= 0.30
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd agents/video-generator && python3 -m pytest test_cost.py -v
```

Expected: FAIL — `_estimate_cost() takes 2 positional arguments but 3 were given`.

- [ ] **Step 3: Write the implementation**

Replace `_estimate_cost` (lines 579-585):

```python
# Per-SECOND pricing. Fal bills reference-to-video by duration, which the old
# flat per-render table could not express - and it listed only 3 Veo models, so
# every Seedance render fell through to the 0.10 default. That default is why
# all 41 pre-2026-07-28 product_creative rows read exactly $0.1000 and why the
# monthly budget cap could not be trusted.
_PER_SECOND_USD = {
    "bytedance/seedance-2.0/pro":  0.030,
    "bytedance/seedance-2.0/fast": 0.013,
    "google/gemini-omni-flash":    0.013,
    "fal-ai/vidu":                 0.015,
}
_FLAT_USD = {
    "veo-3.1-fast-generate-preview":  {"720p": 0.10, "1080p": 0.12},
    "veo-3.1-generate-preview":       {"720p": 0.40, "1080p": 0.40},
    "veo-3.1-lite-generate-preview":  {"720p": 0.05, "1080p": 0.08},
}
_UNKNOWN_MODEL_USD_PER_SECOND = 0.030   # conservative: assume the priciest tier


def _estimate_cost(model: str, resolution: str, duration_seconds: int = 5) -> float:
    """Estimated USD for one render. Conservative by design: an unpriced slug
    is billed at the most expensive known rate so the budget cap fails safe."""
    if model in _FLAT_USD:
        return _FLAT_USD[model].get(resolution, 0.10)
    for prefix, rate in _PER_SECOND_USD.items():
        if model.startswith(prefix):
            return round(rate * max(1, duration_seconds), 4)
    return round(_UNKNOWN_MODEL_USD_PER_SECOND * max(1, duration_seconds), 4)
```

Then replace line 517 and extend the update block (lines 516-533):

```python
        # Cost from the model ACTUALLY used and its real duration - not the
        # default model, which is what made every row read $0.10.
        actual_model = ad_model or GENERATION_DEFAULTS["model"]
        actual_duration = int(ad.get("duration_seconds") or style_cfg.get("duration", 5))
        cost = _estimate_cost(actual_model, GENERATION_DEFAULTS["resolution"], actual_duration)

        # Update ad as done
        update_payload = {
            "status": "done",
            "video_url": video_url,
            "storage_path": storage_path,
            "affiliate_url": affiliate_url,
            "cost_usd": cost,
            "title": f"{product.get('name', 'Product')} — {style.replace('_', ' ').title()} ({method})",
            "completed_at": datetime.now(timezone.utc).isoformat(),
        }
        if thumbnail_url:
            update_payload["thumbnail_url"] = thumbnail_url
        if mobile_video_url:
            update_payload["mobile_video_url"] = mobile_video_url
        supabase.table("product_creative").update(update_payload).eq("id", ad_id).execute()

        # Spend telemetry. Without this row the monthly cap in Task 5 is
        # fiction - ai_usage_logs had ZERO fal entries before this shipped.
        try:
            supabase.table("ai_usage_logs").insert({
                "platform": "fal",
                "operation": "product-creative",
                "model": actual_model,
                "units": actual_duration,
                "estimated_cost_usd": cost,
                "status": "success",
                "metadata": {
                    "product_id": ad.get("product_id"),
                    "creative_id": ad_id,
                    "method": method,
                },
            }).execute()
        except Exception as e:
            print(f"    ⚠ usage log failed (non-fatal): {e}")
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd agents/video-generator && python3 -m pytest test_cost.py -v
```

Expected: 5 passed.

- [ ] **Step 5: Deploy and verify against a real render**

```bash
cd agents/video-generator && modal deploy modal_app.py
```

Expected: deploy succeeds and reports **at most 2 web endpoints** for this app. If it reports more, STOP — the workspace cap is 8 and exceeding it makes every deploy silently serve a stale app.

Then generate one creative from `/admin/data` and confirm:

```sql
select platform, operation, model, units, estimated_cost_usd
from ai_usage_logs where platform='fal' order by created_at desc limit 1;
```

Expected: one row, `estimated_cost_usd` NOT equal to `0.1000`.

- [ ] **Step 6: Commit**

```bash
git add agents/video-generator/ad_generator.py agents/video-generator/test_cost.py
git commit -m "fix(creative): price by actual model+duration, log fal spend

Every product_creative row read exactly \$0.1000 because _estimate_cost
was called with the DEFAULT model against a Veo-only table, so all
Seedance renders hit the fallback. ai_usage_logs had zero fal rows, so
the pipeline's most expensive operation had no telemetry at all."
```

---

### Task 4: Pipeline settings + admin RPCs

**Files:**
- Create: `supabase/migrations/20260729000002_pipeline_settings.sql`

**Interfaces:**
- Produces: `admin_set_pipeline_setting(p_key text, p_value text)`, `set_pipeline_master(p_on boolean)`, `pipeline_cron_status()`. Consumed by Task 11.
- Produces: 8 `app_settings` rows, all fail-closed. Read by Tasks 5, 6.

- [ ] **Step 1: Write the failing test**

```sql
do $$ declare v text; begin
  select value into v from public.app_settings where key='pipeline_enabled';
  assert v = 'false', 'pipeline_enabled must exist and default false, got ' || coalesce(v,'<missing>');
end $$;
```

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL — `pipeline_enabled must exist and default false, got <missing>`.

- [ ] **Step 3: Write the implementation**

```sql
insert into public.app_settings (key, value) values
  ('pipeline_enabled',                  'false'),
  ('pipeline_creative_enabled',         'false'),
  ('pipeline_autopublish_enabled',      'false'),
  ('pipeline_creatives_per_day',        '40'),
  ('pipeline_creative_monthly_usd_cap', '50'),
  ('pipeline_min_image_score',          '0.5'),
  ('pipeline_min_images',               '2'),
  ('pipeline_require_person_free',      'true')
on conflict (key) do nothing;

create or replace function public.admin_set_pipeline_setting(p_key text, p_value text)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_admin) then
    raise exception 'not authorized';
  end if;
  if p_key not like 'pipeline\_%' then
    raise exception 'invalid key: %', p_key;
  end if;
  if not exists (select 1 from public.app_settings where key = p_key) then
    raise exception 'unknown key: %', p_key;   -- allowlist by existence, no drift
  end if;
  update public.app_settings set value = p_value, updated_at = now() where key = p_key;
end $$;

-- Flips the flag AND the crons together. The seeding feature's switches did not
-- stick precisely because those two were separate.
create or replace function public.set_pipeline_master(p_on boolean)
returns void language plpgsql security definer set search_path to 'public' as $$
declare r record;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_admin) then
    raise exception 'not authorized';
  end if;
  update public.app_settings
     set value = case when p_on then 'true' else 'false' end, updated_at = now()
   where key = 'pipeline_enabled';
  for r in select jobid from cron.job where jobname like 'pipeline-%' loop
    perform cron.alter_job(job_id := r.jobid, active := p_on);
  end loop;
end $$;

create or replace function public.pipeline_cron_status()
returns table(jobname text, schedule text, active boolean, last_status text, last_run timestamptz)
language plpgsql security definer set search_path to 'public' as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_admin) then
    raise exception 'not authorized';
  end if;
  return query
    select j.jobname::text, j.schedule::text, j.active, d.status::text, d.start_time
      from cron.job j
      left join lateral (
        select r.status, r.start_time from cron.job_run_details r
         where r.jobid = j.jobid order by r.start_time desc limit 1
      ) d on true
     where j.jobname like 'pipeline-%'
     order by j.jobname;
end $$;
```

- [ ] **Step 4: Run test to verify it passes**

Re-run Step 1. Expected: no error. Then verify the guard rejects unknown keys:

```sql
select public.admin_set_pipeline_setting('pipeline_bogus','1');
```

Expected: ERROR `unknown key: pipeline_bogus`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260729000002_pipeline_settings.sql
git commit -m "feat(pipeline): fail-closed settings + admin RPCs"
```

---

### Task 5: Creative drain driver

**Files:**
- Create: `supabase/migrations/20260729000003_pipeline_creative_drain.sql`

**Interfaces:**
- Consumes: `pipeline_stage()` (Task 1), `pipeline_events` (Task 2), `ai_usage_logs` fal rows (Task 3), settings (Task 4).
- Produces: `run_pipeline_creative_drain(p_dry_run boolean default true) → jsonb`.

**Do not enable the cron until Task 3 is deployed and reporting non-placeholder cost.**

- [ ] **Step 1: Write the failing test**

```sql
do $$ declare res jsonb; begin
  res := public.run_pipeline_creative_drain(true);
  assert res->>'skipped' = 'pipeline_disabled',
    'must fail closed while disabled, got ' || res::text;
end $$;
```

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL — `function public.run_pipeline_creative_drain(boolean) does not exist`.

- [ ] **Step 3: Write the implementation**

```sql
create or replace function public.fal_month_spend()
returns numeric language sql stable as $$
  select coalesce(sum(estimated_cost_usd), 0)
    from public.ai_usage_logs
   where platform = 'fal'
     and created_at >= date_trunc('month', now());
$$;

create or replace function public.run_pipeline_creative_drain(p_dry_run boolean default true)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_enabled   boolean := coalesce((select value from app_settings where key='pipeline_enabled'), 'false') = 'true';
  v_cr_on     boolean := coalesce((select value from app_settings where key='pipeline_creative_enabled'), 'false') = 'true';
  v_per_day   int     := coalesce((select value from app_settings where key='pipeline_creatives_per_day'), '0')::int;
  v_cap       numeric := coalesce((select value from app_settings where key='pipeline_creative_monthly_usd_cap'), '0')::numeric;
  v_spend     numeric := public.fal_month_spend();
  v_today     int;
  v_n         int;
  v_ids       uuid[];
begin
  if not v_enabled then return jsonb_build_object('skipped','pipeline_disabled'); end if;
  if not v_cr_on   then return jsonb_build_object('skipped','creative_disabled'); end if;

  if v_spend >= v_cap then
    insert into pipeline_events(stage, event, detail)
    values ('creative','budget', jsonb_build_object('spend',v_spend,'cap',v_cap));
    return jsonb_build_object('skipped','budget_cap','spend',v_spend,'cap',v_cap);
  end if;

  select count(*) into v_today from product_creative
   where created_at >= date_trunc('day', now());
  v_n := least(v_per_day - v_today, 25);
  if v_n <= 0 then return jsonb_build_object('skipped','daily_limit','today',v_today); end if;

  -- BOTH creative-less stages. published_no_creative goes first: those rows are
  -- already live and invisible, so each one generated is an immediate feed gain.
  select array_agg(id) into v_ids from (
    select p.id
      from products p
     where public.pipeline_stage(p.*) in ('published_no_creative','awaiting_creative')
     order by (public.pipeline_stage(p.*) = 'published_no_creative') desc, p.created_at
     limit v_n
  ) s;

  if v_ids is null then return jsonb_build_object('queued',0,'reason','nothing_eligible'); end if;
  if p_dry_run then
    return jsonb_build_object('dry_run',true,'would_queue',array_length(v_ids,1),'ids',v_ids);
  end if;

  insert into product_creative (product_id, status)
  select unnest(v_ids), 'pending';

  insert into pipeline_events (product_id, stage, event)
  select unnest(v_ids), 'creative', 'queued';

  return jsonb_build_object('queued',array_length(v_ids,1),'spend',v_spend,'cap',v_cap);
end $$;

select cron.schedule('pipeline-creative-drain', '*/15 * * * *',
                     $$select public.run_pipeline_creative_drain(false)$$);
select cron.alter_job(job_id := (select jobid from cron.job where jobname='pipeline-creative-drain'),
                      active := false);
```

- [ ] **Step 4: Run test to verify it passes**

Re-run Step 1. Expected: no error.

Then verify the dry-run selects the invisible backlog first:

```sql
update app_settings set value='true' where key in ('pipeline_enabled','pipeline_creative_enabled');
select public.run_pipeline_creative_drain(true);
update app_settings set value='false' where key in ('pipeline_enabled','pipeline_creative_enabled');
```

Expected: `dry_run: true`, `would_queue` between 1 and 25, and **zero** rows written:

```sql
select count(*) from product_creative where created_at > now() - interval '5 minutes';
```

Expected: `0`

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260729000003_pipeline_creative_drain.sql
git commit -m "feat(pipeline): rate-limited, budget-capped creative drain (cron off)"
```

---

### Task 6: Publish driver

**Files:**
- Create: `supabase/migrations/20260729000004_pipeline_publish.sql`

**Interfaces:**
- Consumes: `pipeline_stage()` (Task 1), `pipeline_events` (Task 2), settings (Task 4).
- Produces: `run_pipeline_publish(p_dry_run boolean default true) → jsonb`.

- [ ] **Step 1: Write the failing test**

```sql
do $$ declare res jsonb; begin
  res := public.run_pipeline_publish(true);
  assert res->>'skipped' = 'pipeline_disabled',
    'must fail closed while disabled, got ' || res::text;
end $$;
```

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL — `function public.run_pipeline_publish(boolean) does not exist`.

- [ ] **Step 3: Write the implementation**

```sql
-- Promote-only. NEVER deactivates. Mirrors run_seeding_activation's contract.
create or replace function public.run_pipeline_publish(p_dry_run boolean default true)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_enabled boolean := coalesce((select value from app_settings where key='pipeline_enabled'), 'false') = 'true';
  v_pub_on  boolean := coalesce((select value from app_settings where key='pipeline_autopublish_enabled'), 'false') = 'true';
  v_score   numeric := coalesce((select value from app_settings where key='pipeline_min_image_score'), '1')::numeric;
  v_imgs    int     := coalesce((select value from app_settings where key='pipeline_min_images'), '99')::int;
  v_pfree   boolean := coalesce((select value from app_settings where key='pipeline_require_person_free'), 'true') = 'true';
  v_ids     uuid[];
begin
  if not v_enabled then return jsonb_build_object('skipped','pipeline_disabled'); end if;
  if not v_pub_on  then return jsonb_build_object('skipped','autopublish_disabled'); end if;

  select array_agg(p.id) into v_ids
    from products p
   where public.pipeline_stage(p.*) = 'ready_to_publish'
     and coalesce(p.image_verify_score, 0) >= v_score
     and coalesce(jsonb_array_length(p.images), 0) >= v_imgs
     and (not v_pfree or p.primary_image_person_free is true);

  if v_ids is null then return jsonb_build_object('published',0); end if;
  if p_dry_run then
    return jsonb_build_object('dry_run',true,'would_publish',array_length(v_ids,1),'ids',v_ids);
  end if;

  update products set is_active = true where id = any(v_ids);

  insert into pipeline_events (product_id, stage, event, detail)
  select unnest(v_ids), 'publish', 'published',
         jsonb_build_object('min_score',v_score,'min_images',v_imgs,'require_person_free',v_pfree);

  return jsonb_build_object('published',array_length(v_ids,1));
end $$;

select cron.schedule('pipeline-publish', '*/15 * * * *',
                     $$select public.run_pipeline_publish(false)$$);
select cron.alter_job(job_id := (select jobid from cron.job where jobname='pipeline-publish'),
                      active := false);
```

- [ ] **Step 4: Run test to verify it passes**

Re-run Step 1. Expected: no error. Then confirm dry-run writes nothing:

```sql
select count(*) filter (where is_active) as before from products;
update app_settings set value='true' where key in ('pipeline_enabled','pipeline_autopublish_enabled');
select public.run_pipeline_publish(true);
update app_settings set value='false' where key in ('pipeline_enabled','pipeline_autopublish_enabled');
select count(*) filter (where is_active) as after from products;
```

Expected: `before` = `after`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260729000004_pipeline_publish.sql
git commit -m "feat(pipeline): policy-gated promote-only publish driver (cron off)"
```

---

### Task 7: Extend the generation watchdog to generation_jobs

**Files:**
- Create: `supabase/migrations/20260729000005_watchdog_generation_jobs.sql`

**Interfaces:**
- Consumes: `pipeline_events` (Task 2).
- Produces: `reap_stuck_generation_jobs(p_older_than interval default '2 hours') → int`.

**Context:** 217 `generation_jobs` rows of kind `primary-video` have sat `running` since 2026-06-25 because `generation_watchdog()` only reconciles `user_generations`.

- [ ] **Step 1: Write the failing test**

```sql
do $$ declare n int; begin
  n := public.reap_stuck_generation_jobs('100 years'::interval);
  assert n = 0, 'nothing is 100 years old, got ' || n;
end $$;
```

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL — `function public.reap_stuck_generation_jobs(interval) does not exist`.

- [ ] **Step 3: Write the implementation**

```sql
create or replace function public.reap_stuck_generation_jobs(p_older_than interval default '2 hours')
returns int language plpgsql security definer set search_path to 'public' as $$
declare v_n int;
begin
  with stuck as (
    update public.generation_jobs
       set status = 'failed',
           result_message = coalesce(result_message, 'reaped: stuck in running'),
           ended_at = now()
     where status = 'running'
       and coalesce(started_at, ended_at) < now() - p_older_than
    returning id, kind
  )
  select count(*) into v_n from stuck;

  if v_n > 0 then
    insert into public.pipeline_events (stage, event, detail)
    values ('generation_jobs', 'failed', jsonb_build_object('reaped', v_n));
  end if;
  return v_n;
end $$;

select cron.schedule('pipeline-reap-jobs', '*/30 * * * *',
                     $$select public.reap_stuck_generation_jobs()$$);
```

Note: this cron is scheduled **active** — it only ever marks already-dead rows as failed and cannot spend money.

- [ ] **Step 4: Run test to verify it passes**

Re-run Step 1. Expected: no error. Then clear the real backlog:

```sql
select public.reap_stuck_generation_jobs('7 days'::interval);
select status, count(*) from generation_jobs where kind='primary-video' group by 1;
```

Expected: the first call returns ~217; afterwards no `running` rows older than 7 days remain.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260729000005_watchdog_generation_jobs.sql
git commit -m "fix(pipeline): reap stuck generation_jobs (217 zombies since Jun 25)"
```

---

### Task 8: Link health checker

**Files:**
- Create: `supabase/migrations/20260729000006_link_health.sql`
- Create: `supabase/functions/check-product-links/index.ts`

**Interfaces:**
- Consumes: `pipeline_events` (Task 2).
- Produces: `products.url_status smallint`, `products.url_checked_at timestamptz`. Read by Task 10.

**Context:** Baseline measured 2026-07-28 over 341 active URLs: 268 live, 58 HTTP 403 (anti-bot — confirmed fine in a real browser), 15 genuinely dead. A `403` must be recorded as reachable, not broken.

- [ ] **Step 1: Write the failing test**

```sql
do $$ begin
  perform 1 from information_schema.columns
   where table_schema='public' and table_name='products' and column_name='url_status';
  assert found, 'products.url_status missing';
end $$;
```

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL — `products.url_status missing`.

- [ ] **Step 3: Write the implementation**

Migration:

```sql
alter table public.products
  add column if not exists url_status     smallint,
  add column if not exists url_checked_at timestamptz;

create index if not exists products_url_checked_idx
  on public.products (url_checked_at nulls first);

-- 403 == anti-bot, NOT dead. Verified in a real browser 2026-07-28: the
-- lululemon PDP that curl 403s renders fine and its price matched our stored
-- value exactly. Treating 403 as broken would condemn 58 healthy products.
create or replace function public.link_health_summary()
returns table(bucket text, n bigint) language sql stable as $$
  select case
           when url_status is null                    then 'unchecked'
           when url_status between 200 and 299        then 'live'
           when url_status = 403                      then 'bot_blocked'
           else 'dead'
         end, count(*)
    from public.products where is_active group by 1;
$$;
```

Edge function `supabase/functions/check-product-links/index.ts`:

```ts
// Rotating link-health probe. Checks the 50 least-recently-checked active
// products per run and records the HTTP status. 403 is recorded as-is and
// interpreted as "bot-blocked, reachable" by link_health_summary().
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
           '(KHTML, like Gecko) Chrome/131.0 Safari/537.36';

Deno.serve(async () => {
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
  const { data: rows } = await admin
    .from('products')
    .select('id, url')
    .eq('is_active', true)
    .not('url', 'is', null)
    .order('url_checked_at', { ascending: true, nullsFirst: true })
    .limit(50);

  let checked = 0;
  for (const r of rows ?? []) {
    let status = 0;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 12000);
      const res = await fetch(r.url as string, {
        method: 'GET',
        headers: { 'User-Agent': UA, Range: 'bytes=0-2048' },
        redirect: 'follow',
        signal: ctrl.signal,
      });
      clearTimeout(t);
      status = res.status;
    } catch {
      status = 0;                       // connection failure / timeout
    }
    await admin.from('products')
      .update({ url_status: status, url_checked_at: new Date().toISOString() })
      .eq('id', r.id);
    checked++;
  }
  return new Response(JSON.stringify({ checked }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
```

Schedule it (add to the same migration):

```sql
select cron.schedule('pipeline-link-health', '0 5 * * *', $$
  select net.http_post(
    url := 'https://vtarjrnqvcqbhoclvcur.supabase.co/functions/v1/check-product-links',
    headers := jsonb_build_object('Content-Type','application/json','Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets
                     where name='embed_entity_service_key' limit 1)),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
$$);
```

- [ ] **Step 4: Run test to verify it passes**

Deploy and run once:

```bash
supabase functions deploy check-product-links --project-ref vtarjrnqvcqbhoclvcur
```

```sql
select * from public.link_health_summary();
```

Expected after several runs: buckets appear with `live` ≫ `dead`, and `bot_blocked` non-zero. It must NOT report ~58 products as `dead`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260729000006_link_health.sql supabase/functions/check-product-links/index.ts
git commit -m "feat(pipeline): rotating link-health probe (403 = bot-blocked, not dead)"
```

---

### Task 9: Health dashboard — pipeline + data quality panels

**Files:**
- Create: `app/routes/admin/pipeline.health.tsx`
- Modify: `vite.config.ts:255` (add routes next to the seeding routes)
- Modify: `app/routes/admin/route.tsx` (nav entry)

**Interfaces:**
- Consumes: `pipeline_stage()`, `pipeline_events`, `pipeline_cron_status()`, `link_health_summary()`.
- Produces: the route `/admin/pipeline/health`.

- [ ] **Step 1: Add the supporting SQL view**

Create `supabase/migrations/20260729000007_pipeline_funnel.sql`:

```sql
create or replace function public.pipeline_funnel()
returns table(stage text, n bigint, oldest_age interval)
language sql stable as $$
  select public.pipeline_stage(p.*) as stage,
         count(*),
         max(now() - p.created_at)
    from public.products p
   group by 1 order by 2 desc;
$$;
```

- [ ] **Step 2: Verify the funnel matches the catalog**

```sql
select * from public.pipeline_funnel();
select (select sum(n) from public.pipeline_funnel()) = (select count(*) from products) as totals_match;
```

Expected: `totals_match` = `true`.

- [ ] **Step 3: Write the page**

Create `app/routes/admin/pipeline.health.tsx`. Follow the existing admin page conventions in `app/routes/admin/seeding.tsx`: client-side data loading in `useEffect`, `admin-tabs` / `admin-btn` / `SortableTable` classes, no inline styles.

```tsx
import { useEffect, useState } from 'react';
import { supabase } from '~/utils/supabase';

interface FunnelRow { stage: string; n: number; oldest_age: string | null }
interface CronRow { jobname: string; schedule: string; active: boolean; last_status: string | null; last_run: string | null }
interface LinkRow { bucket: string; n: number }

export default function PipelineHealth() {
  const [funnel, setFunnel] = useState<FunnelRow[]>([]);
  const [crons, setCrons] = useState<CronRow[]>([]);
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [f, c, l] = await Promise.all([
        supabase.rpc('pipeline_funnel'),
        supabase.rpc('pipeline_cron_status'),
        supabase.rpc('link_health_summary'),
      ]);
      setFunnel((f.data ?? []) as FunnelRow[]);
      setCrons((c.data ?? []) as CronRow[]);
      setLinks((l.data ?? []) as LinkRow[]);
      setLoading(false);
    })();
  }, []);

  if (loading) return <div className="admin-spinner" />;

  const stuck = funnel.filter(r =>
    ['unverified', 'creative_pending', 'discovered'].includes(r.stage));

  return (
    <div className="admin-page">
      <h1>Pipeline health</h1>

      <section>
        <h2>Stage funnel</h2>
        <table className="admin-table">
          <thead><tr><th>Stage</th><th className="admin-th-center">Products</th><th>Oldest</th></tr></thead>
          <tbody>
            {funnel.map(r => (
              <tr key={r.stage} className={r.stage === 'published_no_creative' ? 'admin-row-warn' : undefined}>
                <td>{r.stage}</td>
                <td className="admin-cell-center">{r.n}</td>
                <td>{r.oldest_age ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="admin-hint">
          <strong>published_no_creative</strong> = live but invisible: video is a hard feed filter.
        </p>
      </section>

      <section>
        <h2>Automation</h2>
        <table className="admin-table">
          <thead><tr><th>Job</th><th>Schedule</th><th>On</th><th>Last run</th><th>Status</th></tr></thead>
          <tbody>
            {crons.map(c => (
              <tr key={c.jobname}>
                <td>{c.jobname}</td><td>{c.schedule}</td>
                <td>{c.active ? 'on' : 'paused'}</td>
                <td>{c.last_run ? new Date(c.last_run).toLocaleString() : 'never'}</td>
                <td>{c.last_status ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2>Link health</h2>
        <table className="admin-table">
          <thead><tr><th>Bucket</th><th className="admin-th-center">Products</th></tr></thead>
          <tbody>
            {links.map(l => (
              <tr key={l.bucket}><td>{l.bucket}</td><td className="admin-cell-center">{l.n}</td></tr>
            ))}
          </tbody>
        </table>
        <p className="admin-hint">bot_blocked = reachable in a browser, blocked to servers. Not broken.</p>
      </section>
    </div>
  );
}
```

- [ ] **Step 4: Register the route**

In `vite.config.ts`, directly after line 256 (`route("seeding/simulate", …)`), add:

```ts
            route("pipeline", "routes/admin/pipeline.tsx");
            route("pipeline/health", "routes/admin/pipeline.health.tsx");
```

Add a nav entry in `app/routes/admin/route.tsx` next to the existing Seeding entry, labelled `Pipeline`.

Note: `routes/admin/pipeline.tsx` is created in Task 11. To keep this task independently shippable, create a minimal placeholder now:

```tsx
export default function Pipeline() {
  return <div className="admin-page"><h1>Pipeline</h1><p>Settings arrive in Task 11.</p></div>;
}
```

- [ ] **Step 5: Verify**

```bash
npx tsc --noEmit -p tsconfig.json
```

Expected: exit 0.

Then start the dev server via `preview_start` and load `/admin/pipeline/health`. Confirm the funnel totals match `select count(*) from products`, and that `published_no_creative` shows ~177.

- [ ] **Step 6: Commit**

```bash
git add app/routes/admin/pipeline.health.tsx app/routes/admin/pipeline.tsx vite.config.ts app/routes/admin/route.tsx supabase/migrations/20260729000007_pipeline_funnel.sql
git commit -m "feat(admin): pipeline health dashboard - funnel, crons, link health"
```

---

### Task 10: Health dashboard — spend and demand panels

**Files:**
- Modify: `app/routes/admin/pipeline.health.tsx`
- Create: `supabase/migrations/20260729000008_pipeline_spend.sql`

**Interfaces:**
- Consumes: `ai_usage_logs` fal rows (Task 3), `fal_month_spend()` (Task 5).
- Produces: `pipeline_spend_summary()`.

- [ ] **Step 1: Write the failing test**

```sql
do $$ declare n int; begin
  select count(*) into n from public.pipeline_spend_summary();
  assert n >= 0, 'spend summary should return rows';
end $$;
```

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL — `function public.pipeline_spend_summary() does not exist`.

- [ ] **Step 3: Write the implementation**

```sql
create or replace function public.pipeline_spend_summary()
returns table(platform text, operation text, calls bigint, month_usd numeric, total_usd numeric)
language sql stable as $$
  select platform, operation, count(*),
         round(coalesce(sum(estimated_cost_usd) filter (
           where created_at >= date_trunc('month', now())), 0)::numeric, 2),
         round(coalesce(sum(estimated_cost_usd), 0)::numeric, 2)
    from public.ai_usage_logs
   group by 1, 2
   order by 4 desc, 3 desc;
$$;

create or replace function public.pipeline_cost_per_published()
returns numeric language sql stable as $$
  select case when count(*) = 0 then 0
              else round((public.fal_month_spend() / count(*))::numeric, 4) end
    from public.products p
   where p.is_active and p.primary_video_url is not null;
$$;
```

- [ ] **Step 4: Add the panels to the page**

Append to `pipeline.health.tsx` — add to the existing `Promise.all` and render two more sections: a spend table from `pipeline_spend_summary()` showing month-to-date against `pipeline_creative_monthly_usd_cap`, and a read-only demand summary (count of `seed_targets` by status) that **links to `/admin/seeding`** rather than recomputing it, so the two pages cannot disagree.

Include this warning row above the spend table whenever `ai_usage_logs` has no `fal` rows:

```tsx
{spend.every(s => s.platform !== 'fal') && (
  <p className="admin-warn">
    No Fal usage logged yet — the monthly cap is not enforceable until
    Task 3 ships and a creative has been generated.
  </p>
)}
```

- [ ] **Step 5: Verify**

```bash
npx tsc --noEmit -p tsconfig.json
```

Expected: exit 0. Load `/admin/pipeline/health`; confirm SerpAPI shows ≈ $6.42 and Anthropic ≈ $4.85 (the 2026-07-28 baseline), and that the Fal warning is either shown or Fal has a real row.

- [ ] **Step 6: Commit**

```bash
git add app/routes/admin/pipeline.health.tsx supabase/migrations/20260729000008_pipeline_spend.sql
git commit -m "feat(admin): pipeline spend + demand panels"
```

---

### Task 11: Settings page

**Files:**
- Modify: `app/routes/admin/pipeline.tsx` (replaces the Task 9 placeholder)

**Interfaces:**
- Consumes: `admin_set_pipeline_setting`, `set_pipeline_master`, `pipeline_cron_status` (Task 4).

- [ ] **Step 1: Write the page**

Replace the placeholder with a settings form: read all `pipeline_*` rows from `app_settings`, render a labelled control per key (toggle for the three `_enabled` flags and `require_person_free`, number input for the rest), and write via `supabase.rpc('admin_set_pipeline_setting', { p_key, p_value })`. Add a single master switch calling `supabase.rpc('set_pipeline_master', { p_on })`, and a cron list from `pipeline_cron_status()` — mirroring the Automation panel in `app/routes/admin/seeding.tsx:117-183`.

Each policy input shows its effect inline, e.g. under `pipeline_min_images`:

> Minimum gallery size to publish. Note: 2 is permissive — a 2-image gallery is often the *result* of aggressive junk pruning.

- [ ] **Step 2: Verify**

```bash
npx tsc --noEmit -p tsconfig.json
```

Expected: exit 0.

Load `/admin/pipeline`, toggle `pipeline_creatives_per_day` to `41`, reload, and confirm it persisted:

```sql
select value from app_settings where key='pipeline_creatives_per_day';
```

Expected: `41`. Set it back to `40`.

- [ ] **Step 3: Verify the authorization guard**

From a non-admin browser session, attempt the RPC. Expected: `not authorized`.

- [ ] **Step 4: Commit**

```bash
git add app/routes/admin/pipeline.tsx
git commit -m "feat(admin): pipeline settings page"
```

---

### Task 12: Canary rollout

**Files:** none — this is an operational runbook executed against production.

- [ ] **Step 1: Confirm the prerequisite**

```sql
select count(*) from ai_usage_logs where platform='fal';
```

Expected: `>= 1`. **If 0, STOP** — Task 3 is not live and the budget cap cannot work.

- [ ] **Step 2: Canary the creative drain at 3**

```sql
select public.admin_set_pipeline_setting('pipeline_creatives_per_day','3');
select public.set_pipeline_master(true);
select public.admin_set_pipeline_setting('pipeline_creative_enabled','true');
select public.run_pipeline_creative_drain(false);
```

Expected: `queued: 3`, all three from `published_no_creative`.

- [ ] **Step 3: Inspect the result after ~15 minutes**

```sql
select c.status, c.cost_usd, c.model, p.name
  from product_creative c join products p on p.id = c.product_id
 where c.created_at > now() - interval '1 hour';
```

Expected: `status='done'`, `cost_usd` NOT `0.1000`, and a real model slug. Watch the three videos in `/admin/data` before going further.

- [ ] **Step 4: Raise the rate**

Only if the canary output looks right:

Compute the cap from the measured canary cost — one month at the daily rate,
plus 20% headroom — and apply it:

```sql
-- cap = avg canary cost  ×  creatives_per_day (40)  ×  30 days  ×  1.2
select round(avg(cost_usd) * 40 * 30 * 1.2, 2) as suggested_cap
  from product_creative
 where created_at > now() - interval '1 hour' and status = 'done';
```

Then set both values, substituting the number that query returned:

```sql
select public.admin_set_pipeline_setting('pipeline_creatives_per_day','40');
select public.admin_set_pipeline_setting('pipeline_creative_monthly_usd_cap','SUGGESTED_CAP_FROM_QUERY_ABOVE');
select cron.alter_job(job_id := (select jobid from cron.job where jobname='pipeline-creative-drain'), active := true);
```

Worked example: if the canary averaged $0.13/video, the query returns
`187.20`, and the cap is set to `187.20`. Backstop: at 40/day the ~195-product
backlog (177 invisible + today's 18) clears in about five days, after which
throughput drops to whatever the funnel supplies.

- [ ] **Step 5: Enable auto-publish last**

```sql
select public.run_pipeline_publish(true);     -- dry run, inspect the list first
select public.admin_set_pipeline_setting('pipeline_autopublish_enabled','true');
select cron.alter_job(job_id := (select jobid from cron.job where jobname='pipeline-publish'), active := true);
```

- [ ] **Step 6: Verify the loop closes**

After ~1 hour:

```sql
select * from public.pipeline_funnel();
select stage, event, count(*) from pipeline_events
 where created_at > now() - interval '2 hours' group by 1,2;
```

Expected: `published_no_creative` falling, `published` rising, `creative/queued` and `publish/published` events accumulating.

**Kill switch at any point:** `select public.set_pipeline_master(false);`

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| §6.1 `pipeline_stage()` | 1 |
| §6.2 `pipeline_events` | 2 |
| §6.3 Fal cost logging | 3 |
| §6.4 Creative drain | 5 |
| §6.5 Publish cron | 6 |
| §6.6 Watchdog extension | 7 |
| §6.7 Link health checker | 8 |
| §6.8 Settings + RPCs | 4, 11 |
| §6.9 Health page (4 panels) | 9, 10 |
| §10 Build order | 1-2 → 9-10 → 5 → 6 → 11, canary in 12 |
| §11 Rollback | Task 12 kill switch; all migrations additive |

**Type consistency:** `pipeline_stage()` returns the same ten literals used by Tasks 5, 6 and 9. `run_pipeline_creative_drain` / `run_pipeline_publish` both take `p_dry_run boolean` and return `jsonb`. `admin_set_pipeline_setting(p_key, p_value)` matches its call sites in Tasks 11 and 12.

**Deviation from spec build order:** the spec listed the settings page last (step 5). Tasks 9 and 11 both touch `vite.config.ts` and the admin nav, so Task 9 creates a placeholder `pipeline.tsx` and Task 11 replaces it. This keeps each task independently shippable without a broken route in between.
