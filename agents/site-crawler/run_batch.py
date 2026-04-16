#!/usr/bin/env python3
"""
Batch runner for site crawler.

Can be run locally or in CI. Creates a crawl job, runs the agent,
and inserts discovered URLs into the DB.

Usage:
    python run_batch.py "https://www.nike.com"
    python run_batch.py "https://www.zara.com" --max-pages 50
    python run_batch.py "https://www.zara.com" --workers 8
    python run_batch.py "https://shop.example.com" --dry-run
    python run_batch.py --queue-products          # queue pending URLs to product scraper
"""

import os
import sys
import json
import argparse
from datetime import datetime, timezone
from dotenv import load_dotenv

load_dotenv()


def get_supabase():
    from supabase import create_client
    url = os.environ["SUPABASE_URL"]
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    return create_client(url, key)


def create_crawl_job(supabase, site_url: str, site_name: str | None = None) -> str:
    """Create a crawl_jobs row and return the job ID."""
    from urllib.parse import urlparse
    domain = urlparse(site_url).netloc
    res = supabase.table("crawl_jobs").insert({
        "site_url": site_url,
        "site_name": site_name or domain,
        "status": "pending",
    }).execute()
    return res.data[0]["id"]


def run_crawl(site_url: str, max_pages: int, dry_run: bool = False, site_name: str | None = None, max_workers: int = 5):
    """Run the crawler and optionally save results to DB."""
    from agent import run_agent

    print(f"🕷️  Crawling: {site_url}")
    print(f"   Max pages: {max_pages}")
    print(f"   Workers: {max_workers}")
    print()

    result = run_agent(site_url, max_pages=max_pages, max_workers=max_workers)

    products = result.get("products", [])
    print(f"\n{'✅' if result['success'] else '❌'} Crawl complete")
    print(f"   Pages visited: {result['pages_visited']}")
    print(f"   Products found: {len(products)}")

    if result.get("error"):
        print(f"   Error: {result['error']}")

    if dry_run:
        if products:
            print("\n   Products (dry run — not saved):")
            for p in products[:20]:
                coll = p.get("collection_name", "")
                title = p.get("page_title", "")
                label = title or coll or ""
                print(f"     {p['url']}" + (f" [{label}]" if label else ""))
            if len(products) > 20:
                print(f"     ... and {len(products) - 20} more")
        return 0 if result["success"] else 1

    # Save to DB
    supabase = get_supabase()
    job_id = create_crawl_job(supabase, site_url, site_name)
    print(f"\n   Crawl job: {job_id}")

    if not products:
        supabase.table("crawl_jobs").update({
            "status": "failed",
            "error": result.get("error", "No products found"),
            "completed_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", job_id).execute()
        return 1

    # Mark as crawling then done
    supabase.table("crawl_jobs").update({
        "status": "crawling",
        "started_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", job_id).execute()

    # Insert discovered URLs in chunks
    rows = [
        {
            "crawl_job_id": job_id,
            "url": p["url"],
            "collection_name": p.get("collection_name") or None,
            "page_title": p.get("page_title") or None,
            "status": "pending",
        }
        for p in products
    ]

    inserted = 0
    for i in range(0, len(rows), 100):
        chunk = rows[i:i + 100]
        try:
            res = supabase.table("crawl_discovered_urls").upsert(
                chunk, on_conflict="crawl_job_id,url"
            ).execute()
            inserted += len(res.data) if res.data else len(chunk)
        except Exception as e:
            print(f"   Warning: chunk insert error: {e}")

    supabase.table("crawl_jobs").update({
        "status": "done",
        "total_urls": inserted,
        "completed_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", job_id).execute()

    print(f"   Saved {inserted} product URLs to DB")
    return 0


def queue_products_to_scraper(limit: int = 50):
    """Move pending discovered URLs into the products table for scraping."""
    supabase = get_supabase()

    rows = (
        supabase.table("crawl_discovered_urls")
        .select("id, url, collection_name, page_title, crawl_job_id")
        .eq("status", "pending")
        .limit(limit)
        .execute()
    )

    pending = rows.data or []
    if not pending:
        print("No pending discovered URLs to queue.")
        return 0

    print(f"Queueing {len(pending)} discovered URLs as products...")

    queued = 0
    skipped = 0

    for row in pending:
        # Check if URL already exists in products
        existing = (
            supabase.table("products")
            .select("id")
            .eq("url", row["url"])
            .limit(1)
            .execute()
        )

        if existing.data:
            supabase.table("crawl_discovered_urls").update({
                "status": "skipped",
                "product_id": existing.data[0]["id"],
            }).eq("id", row["id"]).execute()
            skipped += 1
            continue

        # Insert new product
        try:
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
                queued += 1
        except Exception as e:
            print(f"  Error: {row['url']}: {e}")
            supabase.table("crawl_discovered_urls").update({
                "status": "failed",
                "error": str(e)[:300],
            }).eq("id", row["id"]).execute()

    print(f"✅ Queued: {queued}  Skipped (existing): {skipped}  "
          f"Total: {len(pending)}")
    return 0


def main():
    parser = argparse.ArgumentParser(description="Site Crawler Batch Runner")
    parser.add_argument("url", nargs="?", help="Site URL to crawl")
    parser.add_argument("--max-pages", type=int, default=100,
                        help="Max pages to visit (default: 100)")
    parser.add_argument("--site-name", type=str, default=None,
                        help="Human-readable site name")
    parser.add_argument("--dry-run", action="store_true",
                        help="Print results without saving to DB")
    parser.add_argument("--workers", type=int, default=5,
                        help="Number of parallel collection sub-agents (default: 5)")
    parser.add_argument("--queue-products", action="store_true",
                        help="Queue pending discovered URLs to the product scraper")
    parser.add_argument("--limit", type=int, default=50,
                        help="Limit for --queue-products (default: 50)")
    args = parser.parse_args()

    if args.queue_products:
        return queue_products_to_scraper(args.limit)

    if not args.url:
        parser.error("URL is required (unless using --queue-products)")

    return run_crawl(args.url, args.max_pages, args.dry_run, args.site_name, args.workers)


if __name__ == "__main__":
    sys.exit(main())
