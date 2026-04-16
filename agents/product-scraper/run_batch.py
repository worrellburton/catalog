#!/usr/bin/env python3
"""
Batch runner for GitHub Actions cron.

Queries Supabase for products with scrape_status='pending',
runs the agent on each, and updates the row with extracted data.

Usage:
    python run_batch.py              # process all pending
    python run_batch.py --limit 10   # process up to 10
    python run_batch.py --dry-run    # list pending without scraping
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


def fetch_pending(supabase, limit: int) -> list[dict]:
    res = (
        supabase.table("products")
        .select("id, url")
        .eq("scrape_status", "pending")
        .limit(limit)
        .execute()
    )
    return res.data or []


def mark_processing(supabase, product_id: str):
    supabase.table("products").update({"scrape_status": "processing"}).eq("id", product_id).execute()


def mark_done(supabase, product_id: str, data: dict):
    supabase.table("products").update(
        {
            "scrape_status": "done",
            "scraped_at": datetime.now(timezone.utc).isoformat(),
            "scrape_error": None,
            # map agent output to products table columns
            "name": data.get("title"),
            "brand": data.get("brand"),
            "description": data.get("description"),
            "price": data.get("price"),
            "discounted_price": data.get("discounted_price"),
            "currency": data.get("currency"),
            "images": data.get("images", []),
            "availability": data.get("availability"),
            "image_url": data.get("images", [None])[0],  # first image as primary
        }
    ).eq("id", product_id).execute()


def mark_failed(supabase, product_id: str, error: str):
    supabase.table("products").update(
        {
            "scrape_status": "failed",
            "scraped_at": datetime.now(timezone.utc).isoformat(),
            "scrape_error": error[:500],
        }
    ).eq("id", product_id).execute()


def main():
    parser = argparse.ArgumentParser(description="Batch product scraper")
    parser.add_argument("--limit", type=int, default=10, help="Max products to process per run")
    parser.add_argument("--dry-run", action="store_true", help="List pending without scraping")
    args = parser.parse_args()

    supabase = get_supabase()
    pending = fetch_pending(supabase, args.limit)

    if not pending:
        print("✅ No pending products.")
        sys.exit(0)

    print(f"📋 Found {len(pending)} pending product(s)")

    if args.dry_run:
        for row in pending:
            print(f"  - [{row['id']}] {row.get('url', 'no url')}")
        sys.exit(0)

    # Import agent only when actually running (Playwright not needed for dry-run)
    from agent import run_agent

    passed = 0
    failed = 0

    for row in pending:
        product_id = row["id"]
        url = row.get("url")

        if not url:
            print(f"  ⚠️  [{product_id}] No URL — skipping")
            mark_failed(supabase, product_id, "No url set")
            failed += 1
            continue

        print(f"\n🔍 [{product_id}] {url}")
        mark_processing(supabase, product_id)

        try:
            result = run_agent(url, save=False)
            product = result["data"]  # run_agent returns {"success", "data", "storage"}
            mark_done(supabase, product_id, product)
            print(f"  ✅ Done — {product.get('title', 'no title')}")
            passed += 1
        except Exception as e:
            error_msg = str(e)
            print(f"  ❌ Failed — {error_msg}")
            mark_failed(supabase, product_id, error_msg)
            failed += 1

    print(f"\n{'='*40}")
    print(f"Done: {passed} succeeded, {failed} failed")

    if failed > 0:
        sys.exit(1)  # Non-zero exit signals failure to GitHub Actions


if __name__ == "__main__":
    main()
