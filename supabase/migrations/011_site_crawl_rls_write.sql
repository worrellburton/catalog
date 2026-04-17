-- ============================================================
-- 011: Allow anon/authenticated to write to site crawl tables
-- ============================================================
-- The admin panel uses the publishable (anon) key, so it needs
-- INSERT/UPDATE/DELETE policies to manage crawl jobs.

BEGIN;

-- ─── crawl_jobs write policies ─────────────────────────────

CREATE POLICY "Anon can insert crawl_jobs"
    ON crawl_jobs FOR INSERT
    TO anon, authenticated
    WITH CHECK (true);

CREATE POLICY "Anon can update crawl_jobs"
    ON crawl_jobs FOR UPDATE
    TO anon, authenticated
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Anon can delete crawl_jobs"
    ON crawl_jobs FOR DELETE
    TO anon, authenticated
    USING (true);

-- ─── crawl_discovered_urls write policies ──────────────────

CREATE POLICY "Anon can insert crawl_discovered_urls"
    ON crawl_discovered_urls FOR INSERT
    TO anon, authenticated
    WITH CHECK (true);

CREATE POLICY "Anon can update crawl_discovered_urls"
    ON crawl_discovered_urls FOR UPDATE
    TO anon, authenticated
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Anon can delete crawl_discovered_urls"
    ON crawl_discovered_urls FOR DELETE
    TO anon, authenticated
    USING (true);

COMMIT;
