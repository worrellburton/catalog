-- Perf hardening from Supabase advisors. No behavior change.
--   #1 auth_rls_initplan   — wrap auth.uid()/auth.role() in a scalar subquery so
--                            Postgres evaluates them once per query, not once per row.
--   #2 unindexed_foreign_keys — add covering indexes on the 24 flagged FK columns.
-- Both are additive/semantics-preserving and reversible.

-- #2: covering indexes for unindexed foreign keys
CREATE INDEX IF NOT EXISTS ix_affiliate_conversions_click_id ON public.affiliate_conversions (click_id);
CREATE INDEX IF NOT EXISTS ix_become_creator_requests_reviewed_by ON public.become_creator_requests (reviewed_by);
CREATE INDEX IF NOT EXISTS ix_brand_campaigns_advertisement_id ON public.brand_campaigns (advertisement_id);
CREATE INDEX IF NOT EXISTS ix_brand_campaigns_audience_id ON public.brand_campaigns (audience_id);
CREATE INDEX IF NOT EXISTS ix_brand_collection_products_product_id ON public.brand_collection_products (product_id);
CREATE INDEX IF NOT EXISTS ix_brand_invites_accepted_user_id ON public.brand_invites (accepted_user_id);
CREATE INDEX IF NOT EXISTS ix_brand_invites_brand_id ON public.brand_invites (brand_id);
CREATE INDEX IF NOT EXISTS ix_brand_invites_invited_by ON public.brand_invites (invited_by);
CREATE INDEX IF NOT EXISTS ix_brand_members_invited_by ON public.brand_members (invited_by);
CREATE INDEX IF NOT EXISTS ix_brand_subscriptions_plan_id ON public.brand_subscriptions (plan_id);
CREATE INDEX IF NOT EXISTS ix_crawl_discovered_urls_product_id ON public.crawl_discovered_urls (product_id);
CREATE INDEX IF NOT EXISTS ix_creator_hidden_products_product_id ON public.creator_hidden_products (product_id);
CREATE INDEX IF NOT EXISTS ix_creator_product_order_product_id ON public.creator_product_order (product_id);
CREATE INDEX IF NOT EXISTS ix_creators_ai_model_id ON public.creators (ai_model_id);
CREATE INDEX IF NOT EXISTS ix_generated_videos_look_id ON public.generated_videos (look_id);
CREATE INDEX IF NOT EXISTS ix_lens_results_ingested_product_id ON public.lens_results (ingested_product_id);
CREATE INDEX IF NOT EXISTS ix_look_products_source_catalog_id ON public.look_products (source_catalog_id);
CREATE INDEX IF NOT EXISTS ix_looks_created_by ON public.looks (created_by);
CREATE INDEX IF NOT EXISTS ix_musics_added_by ON public.musics (added_by);
CREATE INDEX IF NOT EXISTS ix_search_queries_user_id ON public.search_queries (user_id);
CREATE INDEX IF NOT EXISTS ix_style_up_threads_stylist_id ON public.style_up_threads (stylist_id);
CREATE INDEX IF NOT EXISTS ix_user_events_session_id ON public.user_events (session_id);
CREATE INDEX IF NOT EXISTS ix_user_generation_products_product_id ON public.user_generation_products (product_id);
CREATE INDEX IF NOT EXISTS ix_user_generation_uploads_upload_id ON public.user_generation_uploads (upload_id);

-- #1: wrap auth.uid()/auth.role() in every public policy still using the bare form.
-- Idempotent: policies already carrying "select auth." are skipped, so re-running is a no-op.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT format(
      'ALTER POLICY %I ON %I.%I%s%s;',
      policyname, schemaname, tablename,
      CASE WHEN qual IS NOT NULL THEN ' USING ('||
        regexp_replace(regexp_replace(qual,'auth\.uid\(\)','( SELECT auth.uid() )','g'),
                       'auth\.role\(\)','( SELECT auth.role() )','g')||')' ELSE '' END,
      CASE WHEN with_check IS NOT NULL THEN ' WITH CHECK ('||
        regexp_replace(regexp_replace(with_check,'auth\.uid\(\)','( SELECT auth.uid() )','g'),
                       'auth\.role\(\)','( SELECT auth.role() )','g')||')' ELSE '' END
    ) AS stmt
    FROM pg_policies
    WHERE schemaname='public'
      AND (qual ~ 'auth\.(uid|role)\(\)' OR with_check ~ 'auth\.(uid|role)\(\)')
      AND coalesce(qual,'')       !~* 'select auth\.'
      AND coalesce(with_check,'') !~* 'select auth\.'
  LOOP
    EXECUTE r.stmt;
  END LOOP;
END $$;
