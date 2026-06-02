-- 023_auto_enrich_similarity_trigger
--
-- Auto-generate the "Similar" signal for NEW products, mirroring the existing
-- trg_products_auto_embed (search) pattern. When a product first gets a
-- description (i.e. after the scrape lands), fire the enrich-similarity edge
-- function, which classifies it with Claude → writes product_taxonomy +
-- similarity_profile → embeds the profile into similarity_embedding.
--
-- Generate-once: only fires while similarity_profile IS NULL, so routine
-- updates don't re-spend on Claude. Re-run scripts/enrich-similarity.mjs
-- --force to regenerate deliberately. Reuses the same vault service key as
-- the search auto-embed.

create or replace function public.notify_enrich_similarity()
returns trigger
language plpgsql
security definer
as $$
declare
  v_token text;
begin
  -- Need a name + a description to classify well; skip until both exist.
  if NEW.name is null or NEW.name = '' then return NEW; end if;
  if NEW.description is null or NEW.description = '' then return NEW; end if;
  -- Generate once: skip if already profiled.
  if NEW.similarity_profile is not null then return NEW; end if;

  select decrypted_secret into v_token
    from vault.decrypted_secrets
   where name = 'embed_entity_service_key'
   limit 1;
  if v_token is null or v_token = 'PLACEHOLDER_REPLACE_VIA_DASHBOARD' then
    return NEW;
  end if;

  perform net.http_post(
    url     := 'https://vtarjrnqvcqbhoclvcur.supabase.co/functions/v1/enrich-similarity',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_token
    ),
    body    := jsonb_build_object('id', NEW.id)
  );
  return NEW;
end;
$$;

drop trigger if exists trg_products_auto_enrich_similarity on public.products;
create trigger trg_products_auto_enrich_similarity
  after insert or update of description, is_active
  on public.products
  for each row
  execute function public.notify_enrich_similarity();
