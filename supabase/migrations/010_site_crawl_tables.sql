-- ============================================================
-- 010: Site crawl tables for URL discovery agent
-- ============================================================
-- crawl_jobs:           tracks each site crawl request
-- crawl_discovered_urls: stores discovered product URLs per crawl

BEGIN;

-- ─── crawl_jobs ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS crawl_jobs (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    site_url        text NOT NULL,
    site_name       text,                          -- human label (e.g. "Nike US")
    status          text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'crawling', 'done', 'failed', 'cancelled')),
    total_urls      integer DEFAULT 0,             -- count of discovered URLs
    scraped_urls    integer DEFAULT 0,             -- count of URLs that have been scraped
    error           text,
    started_at      timestamptz,
    completed_at    timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_crawl_jobs_status ON crawl_jobs (status);
CREATE INDEX idx_crawl_jobs_created ON crawl_jobs (created_at DESC);

-- auto-update updated_at
CREATE TRIGGER set_crawl_jobs_updated_at
    BEFORE UPDATE ON crawl_jobs
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

-- ─── crawl_discovered_urls ─────────────────────────────────
CREATE TABLE IF NOT EXISTS crawl_discovered_urls (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    crawl_job_id    uuid NOT NULL REFERENCES crawl_jobs(id) ON DELETE CASCADE,
    url             text NOT NULL,
    collection_name text,                          -- e.g. "New Arrivals", "Women's Shoes"
    page_title      text,
    product_id      uuid REFERENCES products(id) ON DELETE SET NULL,  -- linked after insert
    status          text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'queued', 'scraped', 'skipped', 'failed')),
    error           text,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_crawl_urls_job ON crawl_discovered_urls (crawl_job_id);
CREATE INDEX idx_crawl_urls_status ON crawl_discovered_urls (status) WHERE status = 'pending';
CREATE UNIQUE INDEX idx_crawl_urls_unique ON crawl_discovered_urls (crawl_job_id, url);

-- ─── RLS (public read, service role write) ─────────────────
ALTER TABLE crawl_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE crawl_discovered_urls ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can read crawl_jobs"
    ON crawl_jobs FOR SELECT USING (true);

CREATE POLICY "Public can read crawl_discovered_urls"
    ON crawl_discovered_urls FOR SELECT USING (true);

COMMIT;
