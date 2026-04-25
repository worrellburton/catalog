-- Per-generation clip length. Seedance 2 Fast supports 5 or 10
-- second outputs; the wizard's Review step now exposes a picker so
-- the shopper can choose. Default 5 keeps existing rows valid.

alter table public.user_generations
  add column if not exists duration_seconds smallint not null default 5;

-- Enforce the supported set so a stale client can't ask for 7s and
-- have Fal silently coerce the value.
alter table public.user_generations
  drop constraint if exists user_generations_duration_seconds_check;
alter table public.user_generations
  add constraint user_generations_duration_seconds_check
  check (duration_seconds in (5, 10));

comment on column public.user_generations.duration_seconds is
  'Output clip length in seconds. Mapped to Fal Seedance 2 `duration` parameter. 5 or 10 only.';
