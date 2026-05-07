-- ai_usage_logs — fire-and-forget log written by edge functions after each
-- external AI API call. Used by the /admin/ai-usage page to display per-
-- platform usage summaries and a recent-activity table.

create table if not exists public.ai_usage_logs (
  id                  uuid primary key default gen_random_uuid(),
  platform            text not null,        -- anthropic | serpapi | rainforest | twelvelabs | fal | google-veo | gemini | modal
  operation           text not null,        -- brainstorm | product-search | product-lookup | video-embed | name-look | taxonomy-gen
  model               text,                 -- e.g. claude-sonnet-4-6 (nullable for non-LLM calls)
  input_tokens        integer,              -- LLM prompt tokens
  output_tokens       integer,              -- LLM completion tokens
  units               numeric,              -- non-LLM calls (1 per API request)
  estimated_cost_usd  numeric(10, 6),       -- computed at log-time from known pricing
  status              text not null default 'success',  -- success | error
  error_message       text,
  metadata            jsonb,
  created_at          timestamptz not null default now()
);

-- Indexes for the admin page queries
create index if not exists ai_usage_logs_platform_idx    on public.ai_usage_logs (platform);
create index if not exists ai_usage_logs_created_at_idx  on public.ai_usage_logs (created_at desc);
create index if not exists ai_usage_logs_operation_idx   on public.ai_usage_logs (operation);

-- RLS: admin panel reads via anon key (app-level password gate provides access
-- control); edge functions write via service-role key which bypasses RLS.
alter table public.ai_usage_logs enable row level security;

create policy "anon can read ai_usage_logs"
  on public.ai_usage_logs for select
  to anon, authenticated
  using (true);
