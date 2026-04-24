-- Shopper-facing generation flow.
--
-- user_uploads:        face / reference photos the shopper uploaded. Kept
--                      around so the admin user page can display them and
--                      so subsequent generations can re-use a face without
--                      re-uploading.
-- user_generations:    one row per "Generate" submission. Holds the style
--                      preset, the shopper's self-reported height, the
--                      assembled Seedance prompt, the status machine, and
--                      the final video URL.
-- user_generation_products:
--                      pivot of the products the shopper picked for this
--                      generation plus a `role_tag` so the prompt can say
--                      "this is the hat", "this is the jacket", etc.

create table if not exists public.user_uploads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  storage_path text not null,
  public_url text not null,
  mime_type text,
  byte_size integer,
  width integer,
  height integer,
  created_at timestamptz not null default now()
);

comment on table public.user_uploads is
  'Shopper-uploaded reference photos. Used as the face reference for the Generate flow and shown on the admin user profile.';

create index if not exists user_uploads_user_idx
  on public.user_uploads (user_id, created_at desc);

create table if not exists public.user_generations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'generating', 'done', 'failed')),
  height_cm integer,
  height_label text,
  style text not null,
  prompt text,
  veo_model text,
  video_url text,
  storage_path text,
  error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

comment on table public.user_generations is
  'One row per Generate-page submission. Links face uploads + picked products + prompt metadata, and receives the final Seedance output.';

create index if not exists user_generations_user_idx
  on public.user_generations (user_id, created_at desc);
create index if not exists user_generations_status_idx
  on public.user_generations (status)
  where status in ('pending', 'generating');

create table if not exists public.user_generation_uploads (
  generation_id uuid not null references public.user_generations(id) on delete cascade,
  upload_id uuid not null references public.user_uploads(id) on delete cascade,
  sort_order integer not null default 0,
  primary key (generation_id, upload_id)
);

create table if not exists public.user_generation_products (
  generation_id uuid not null references public.user_generations(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  -- Seedance gets a per-product role hint ("this is the hat") so the output
  -- renders each item in the right slot on the body. When null the prompt
  -- falls back to the product's name.
  role_tag text,
  sort_order integer not null default 0,
  primary key (generation_id, product_id)
);

comment on column public.user_generation_products.role_tag is
  'Hat / Jacket / Pants / Shoes / etc. Included verbatim in the Seedance prompt so each product renders in the right slot.';

-- RLS: a shopper can CRUD their own uploads and generations; service-role
-- is used by the edge function to flip status + write the result back.
alter table public.user_uploads enable row level security;
alter table public.user_generations enable row level security;
alter table public.user_generation_uploads enable row level security;
alter table public.user_generation_products enable row level security;

drop policy if exists user_uploads_self_read on public.user_uploads;
drop policy if exists user_uploads_self_write on public.user_uploads;
create policy user_uploads_self_read on public.user_uploads for select
  using (auth.uid() = user_id);
create policy user_uploads_self_write on public.user_uploads for insert
  with check (auth.uid() = user_id);

drop policy if exists user_generations_self_read on public.user_generations;
drop policy if exists user_generations_self_write on public.user_generations;
create policy user_generations_self_read on public.user_generations for select
  using (auth.uid() = user_id);
create policy user_generations_self_write on public.user_generations for insert
  with check (auth.uid() = user_id);

drop policy if exists user_generation_uploads_self on public.user_generation_uploads;
create policy user_generation_uploads_self on public.user_generation_uploads for all
  using (exists (
    select 1 from public.user_generations g
    where g.id = user_generation_uploads.generation_id and g.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.user_generations g
    where g.id = user_generation_uploads.generation_id and g.user_id = auth.uid()
  ));

drop policy if exists user_generation_products_self on public.user_generation_products;
create policy user_generation_products_self on public.user_generation_products for all
  using (exists (
    select 1 from public.user_generations g
    where g.id = user_generation_products.generation_id and g.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.user_generations g
    where g.id = user_generation_products.generation_id and g.user_id = auth.uid()
  ));
