-- 20260620000000_regen_haiku_context_rpc.sql
--
-- regen_haiku_context — admin-invokable single-product Haiku context regen.
-- Mirrors the products_haiku_context trigger + run_haiku_context_backfill:
-- a vault-token net.http_post to the haiku-context edge function, but for
-- ONE product on demand. Lets the admin "Regenerate" a row's image read
-- (e.g. after editing the Haiku prompt in Data → Settings) without having to
-- re-pick the primary image. The edge function overwrites
-- products.haiku_context when it finishes; the admin table's realtime
-- products subscription surfaces the new text.

create or replace function public.regen_haiku_context(p_product_id uuid)
returns void
language plpgsql
security definer
as $function$
declare v_token text;
begin
  select decrypted_secret into v_token
    from vault.decrypted_secrets where name = 'search_backfill_service_key' limit 1;
  perform net.http_post(
    url     := 'https://vtarjrnqvcqbhoclvcur.supabase.co/functions/v1/haiku-context',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||coalesce(v_token,'')),
    body    := jsonb_build_object('productId', p_product_id),
    timeout_milliseconds := 60000);
end;
$function$;

revoke all on function public.regen_haiku_context(uuid) from public;
grant execute on function public.regen_haiku_context(uuid) to authenticated;
