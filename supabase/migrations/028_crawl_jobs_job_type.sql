-- ============================================================
-- 028: Add job_type to crawl_jobs
-- ============================================================
-- Distinguishes between full-site crawls, single-collection crawls,
-- and creator-profile crawls (e.g. shopmy.us/<curator>) so the
-- admin UI can filter each tab independently.

BEGIN;

ALTER TABLE crawl_jobs
    ADD COLUMN IF NOT EXISTS job_type text NOT NULL DEFAULT 'site';

ALTER TABLE crawl_jobs
    DROP CONSTRAINT IF EXISTS crawl_jobs_job_type_check;

ALTER TABLE crawl_jobs
    ADD CONSTRAINT crawl_jobs_job_type_check
    CHECK (job_type IN ('site', 'collection', 'profile'));

CREATE INDEX IF NOT EXISTS idx_crawl_jobs_job_type ON crawl_jobs (job_type);

COMMIT;
