-- 064: cache Haiku query expansions alongside the OpenAI embedding so repeat
-- searches skip both LLM round-trips. The expansion JSON has the shape:
--   { intent: 'browse'|'pairing'|'vibe', types: string[],
--     anchor_type: string|null, pair_types: string[]|null }
alter table public.query_embeddings
  add column if not exists expansion jsonb;

comment on column public.query_embeddings.expansion is
  'Haiku-generated query expansion: intent + canonical product.type set. Cached to avoid re-asking Claude for repeat searches.';
