"""
Modal deployment for the Site Crawler Agent (Sub-Agent Architecture).

Three-tier parallelism:
  1. crawl_and_save()        — Coordinator discovers collections on 1 container
  2. crawl_collection()      — Each collection gets its OWN Modal container (fan-out)
  3. queue_products() (cron) — Feeds discovered URLs into the product scraper pipeline

This means a site with 20 collections gets 20 containers running simultaneously,
each with its own browser, each extracting product URLs independently.

Deploy:
    modal deploy modal_app.py

Test locally:
    modal run modal_app.py::queue_products
    modal serve modal_app.py

Secrets — same as product-scraper:
    modal secret create scraper-secrets \
        ANTHROPIC_API_KEY=... \
        SUPABASE_URL=... \
        SUPABASE_SERVICE_ROLE_KEY=...
"""

import modal

# ─── Image ─────────────────────────────────────────────────────────────

crawler_image = (
    modal.Image.debian_slim(python_version="3.12")
    .pip_install(
        "anthropic>=0.39.0",
        "playwright>=1.48.0",
        "supabase>=2.10.0",
        "python-dotenv>=1.0.0",
        "fastapi[standard]>=0.115.0",
    )
    .run_commands("playwright install chromium --with-deps")
    .add_local_file("agent.py", "/root/agent.py")
)

# ─── App ───────────────────────────────────────────────────────────────

app = modal.App("site-crawler")

secrets = [modal.Secret.from_name("scraper-secrets")]


# ─── Per-collection sub-agent (runs in its own container) ──────────────

@app.function(
    image=crawler_image,
    secrets=secrets,
    timeout=300,        # 5 min per collection
    retries=1,
)
def crawl_collection(site_url: str, collection_url: str, collection_name: str, max_pages: int = 10):
    """Crawl a single collection page and return discovered product URLs."""
    from agent import run_collection_subagent

    print(f"  [Sub-agent] Crawling: {collection_name} ({collection_url})")
    products = run_collection_subagent(site_url, collection_url, collection_name, max_pages)
    print(f"  [Sub-agent] Done: {collection_name} -> {len(products)} products")
    return products


# ─── Coordinator + fan-out to collection sub-agents ────────────────────

@app.function(
    image=crawler_image,
    secrets=secrets,
    timeout=900,        # 15 min total (coordinator + waiting for sub-agents)
    retries=1,
)
def crawl_and_save(job_id: str, site_url: str, max_pages: int = 100):
    """
    Full site crawl:
      1. Run coordinator to discover collections
      2. Fan out collection sub-agents across Modal containers
      3. Aggregate results and save to DB
    """
    import os
    import json
    from datetime import datetime, timezone
    from supabase import create_client
    from agent import run_coordinator

    supabase = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])

    # Mark job as crawling
    supabase.table("crawl_jobs").update({
        "status": "crawling",
        "started_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", job_id).execute()

    try:
        # ── Phase 1: Coordinator discovers collections ──
        print(f"=== Phase 1: Discovering collections on {site_url} ===")
        collections = run_coordinator(site_url)

        if not collections:
            supabase.table("crawl_jobs").update({
                "status": "failed",
                "error": "No collections/categories discovered on site",
                "completed_at": datetime.now(timezone.utc).isoformat(),
            }).eq("id", job_id).execute()
            print(f"FAIL [{job_id}] No collections found on {site_url}")
            return

        print(f"  Found {len(collections)} collections")

        # ── Phase 2: Fan out sub-agents (one Modal container per collection) ──
        pages_per_collection = max(3, max_pages // len(collections))

        print(f"\n=== Phase 2: Dispatching {len(collections)} sub-agents "
              f"({pages_per_collection} pages each) ===")

        # starmap launches each collection in its own container in parallel
        args = [
            (site_url, c["url"], c["name"], pages_per_collection)
            for c in collections
        ]

        all_products: list[dict] = []
        seen_slugs: set[str] = set()
        errors: list[str] = []

        from agent import _normalize_product_url

        for result in crawl_collection.starmap(args):
            # result is list[dict] from each sub-agent
            for p in result:
                canonical = _normalize_product_url(p["url"])
                if canonical not in seen_slugs:
                    seen_slugs.add(canonical)
                    p["url"] = canonical
                    all_products.append(p)

        print(f"\n=== Aggregated {len(all_products)} unique product URLs ===")

        if not all_products:
            supabase.table("crawl_jobs").update({
                "status": "failed",
                "error": f"Found {len(collections)} collections but no product URLs",
                "completed_at": datetime.now(timezone.utc).isoformat(),
            }).eq("id", job_id).execute()
            return

        # ── Save to DB ──
        rows = [
            {
                "crawl_job_id": job_id,
                "url": p["url"],
                "collection_name": p.get("collection_name") or None,
                "page_title": p.get("page_title") or None,
                "status": "pending",
            }
            for p in all_products
        ]

        inserted_count = 0
        for i in range(0, len(rows), 100):
            chunk = rows[i:i + 100]
            try:
                res = supabase.table("crawl_discovered_urls").upsert(
                    chunk,
                    on_conflict="crawl_job_id,url",
                ).execute()
                inserted_count += len(res.data) if res.data else len(chunk)
            except Exception as e:
                print(f"  Warning: chunk insert error: {e}")

        supabase.table("crawl_jobs").update({
            "status": "done",
            "total_urls": inserted_count,
            "completed_at": datetime.now(timezone.utc).isoformat(),
            "error": None,
        }).eq("id", job_id).execute()

        print(f"OK [{job_id}] Saved {inserted_count} product URLs from {len(collections)} collections")

    except Exception as e:
        supabase.table("crawl_jobs").update({
            "status": "failed",
            "error": str(e)[:500],
            "completed_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", job_id).execute()
        print(f"FAIL [{job_id}] {e}")
        raise


# ─── Webhook: triggered from admin panel ───────────────────────────────

@app.function(
    image=crawler_image,
    secrets=secrets,
)
@modal.fastapi_endpoint(method="POST", label="crawl-site")
def crawl_webhook(body: dict):
    """
    POST /crawl-site

    Expected body:
        {
            "job_id": "uuid",
            "site_url": "https://...",
            "max_pages": 100
        }
    """
    job_id = body.get("job_id")
    site_url = body.get("site_url")
    max_pages = body.get("max_pages", 100)

    if not job_id or not site_url:
        return {"error": "Missing job_id or site_url"}, 400

    # Dispatch async — webhook returns immediately
    crawl_and_save.spawn(job_id, site_url, max_pages)

    return {"status": "queued", "job_id": job_id}


# ─── Queue: move discovered URLs into products table for scraping ──────

@app.function(
    image=crawler_image,
    secrets=secrets,
    schedule=modal.Cron("*/15 * * * *"),
)
def queue_products():
    """
    Scheduled job — take pending discovered URLs and create product rows.
    The existing product-scraper agent picks them up automatically.
    """
    import os
    from supabase import create_client

    supabase = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])

    batch_size = 50
    rows = (
        supabase.table("crawl_discovered_urls")
        .select("id, url, collection_name, page_title, crawl_job_id")
        .eq("status", "pending")
        .limit(batch_size)
        .execute()
    )

    pending = rows.data or []
    if not pending:
        print("No pending discovered URLs to queue.")
        return

    print(f"Queueing {len(pending)} discovered URLs as products...")

    queued_count = 0
    failed_ids = []

    for row in pending:
        try:
            # Check if URL already exists in products
            existing = (
                supabase.table("products")
                .select("id")
                .eq("url", row["url"])
                .limit(1)
                .execute()
            )

            if existing.data:
                product_id = existing.data[0]["id"]
                supabase.table("crawl_discovered_urls").update({
                    "status": "skipped",
                    "product_id": product_id,
                }).eq("id", row["id"]).execute()
                continue

            # Insert new product (triggers product-scraper)
            product_res = supabase.table("products").insert({
                "url": row["url"],
                "brand": None,
                "scrape_status": "pending",
            }).execute()

            if product_res.data:
                product_id = product_res.data[0]["id"]
                supabase.table("crawl_discovered_urls").update({
                    "status": "queued",
                    "product_id": product_id,
                }).eq("id", row["id"]).execute()
                queued_count += 1
            else:
                failed_ids.append(row["id"])

        except Exception as e:
            print(f"  Error queueing {row['url']}: {e}")
            supabase.table("crawl_discovered_urls").update({
                "status": "failed",
                "error": str(e)[:300],
            }).eq("id", row["id"]).execute()
            failed_ids.append(row["id"])

    # Update crawl job scraped_urls counts
    job_ids = set(row["crawl_job_id"] for row in pending)
    for jid in job_ids:
        count_res = (
            supabase.table("crawl_discovered_urls")
            .select("id", count="exact")
            .eq("crawl_job_id", jid)
            .in_("status", ["queued", "scraped"])
            .execute()
        )
        count = count_res.count or 0
        supabase.table("crawl_jobs").update({
            "scraped_urls": count,
        }).eq("id", jid).execute()

    print(f"OK Queued {queued_count} new products. "
          f"Skipped existing: {len(pending) - queued_count - len(failed_ids)}. "
          f"Failed: {len(failed_ids)}.")


# ─── Manual trigger: crawl all pending jobs ────────────────────────────

@app.function(
    image=crawler_image,
    secrets=secrets,
)
def crawl_pending_jobs():
    """Manually trigger crawling for all pending jobs."""
    import os
    from supabase import create_client

    supabase = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])

    rows = (
        supabase.table("crawl_jobs")
        .select("id, site_url")
        .eq("status", "pending")
        .limit(10)
        .execute()
    )

    pending = rows.data or []
    if not pending:
        print("No pending crawl jobs.")
        return

    print(f"Found {len(pending)} pending crawl job(s) -- dispatching...")

    for _ in crawl_and_save.starmap(
        [(row["id"], row["site_url"]) for row in pending]
    ):
        pass
