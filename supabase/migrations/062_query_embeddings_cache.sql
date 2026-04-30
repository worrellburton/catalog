-- 062: Query embedding cache
--
-- Persistent cache for OpenAI text-embedding-3-small (1536-dim) embeddings,
-- keyed by normalized query text. Embeddings are user-agnostic — the same
-- query produces the same vector — so this table is shared across all
-- sessions/users.
--
-- Read flow (inside nl-search edge function):
--   SELECT embedding FROM query_embeddings WHERE query_text = $1
--   • Hit  → skip OpenAI call (~100-300 ms saved)
--   • Miss → embed, then INSERT … ON CONFLICT DO NOTHING
--
-- Normalization rule (must match the edge function):
--   lower(trim(regexp_replace(query, '\s+', ' ', 'g')))
--
-- The table is service-role-write only; no client ever writes here directly.

create table if not exists public.query_embeddings (
  query_text  text         primary key,
  embedding   vector(1536) not null,
  hit_count   integer      not null default 0,
  created_at  timestamptz  not null default now(),
  last_used_at timestamptz not null default now()
);

-- Bumps on every cache hit so we can prune cold entries later if the table grows.
create or replace function public.touch_query_embedding(p_query_text text)
returns void
language sql
as $$
  update public.query_embeddings
     set hit_count    = hit_count + 1,
         last_used_at = now()
   where query_text = p_query_text;
$$;

alter table public.query_embeddings enable row level security;

-- No client-side access — only the service-role key (used by nl-search) reads/writes.
-- Explicit policies omitted; default-deny is the desired behaviour.

grant execute on function public.touch_query_embedding(text) to service_role;
