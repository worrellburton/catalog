#!/usr/bin/env python3
"""
End-to-end test: Scrape a ShopMy profile page, extract the first 10 product URLs,
then scrape each product page and save all product data to a JSON file.

Usage:
    cd agents/site-crawler  (activate this venv — it has all dependencies)
    python ../test_profile_scrape.py
    python ../test_profile_scrape.py --profile https://shopmy.us/drconnieyang --limit 10
    python ../test_profile_scrape.py --output my_results.json

Both agent files are named agent.py so they are loaded via importlib with distinct
module names to avoid conflicts.
"""

import sys
import json
import argparse
import time
import importlib.util
from datetime import datetime, timezone
from pathlib import Path

# ─── Path setup ────────────────────────────────────────────────────────
AGENTS_DIR = Path(__file__).parent

# Load .env from site-crawler (has ANTHROPIC_API_KEY)
from dotenv import load_dotenv
load_dotenv(AGENTS_DIR / "site-crawler" / ".env")


def _load_agent(name: str, path: Path):
    """Load an agent.py file as a uniquely named module to avoid name clashes."""
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


# ─── Import agents ─────────────────────────────────────────────────────
# Add site-crawler dir so its internal relative imports (dotenv, playwright, etc.) work
sys.path.insert(0, str(AGENTS_DIR / "site-crawler"))
crawler_agent = _load_agent("crawler_agent", AGENTS_DIR / "site-crawler" / "agent.py")
run_collection_agent = crawler_agent.run_collection_subagent

sys.path.insert(0, str(AGENTS_DIR / "product-scraper"))
scraper_agent = _load_agent("scraper_agent", AGENTS_DIR / "product-scraper" / "agent.py")
scrape_product = scraper_agent.run_agent

# ─── Defaults ─────────────────────────────────────────────────────────
DEFAULT_PROFILE = "https://shopmy.us/drconnieyang"
DEFAULT_LIMIT = 10
DEFAULT_OUTPUT = AGENTS_DIR / "profile_scrape_results.json"


def discover_product_urls(profile_url: str, limit: int) -> list[str]:
    """
    Phase 1: Run the site-crawler profile sub-agent to extract product URLs
    from a ShopMy (or similar) curator page.

    Returns up to `limit` unique product URLs.
    """
    print(f"\n{'='*60}")
    print(f"PHASE 1 — Discovering product URLs")
    print(f"Profile: {profile_url}")
    print(f"{'='*60}")

    results = run_collection_agent(
        site_url=profile_url,
        collection_url=profile_url,
        collection_name="drconnieyang",
        cross_domain=True,       # ShopMy links point to external brand sites
    )

    urls = [r["url"] for r in results if r.get("url")]

    # Deduplicate while preserving order
    seen: set[str] = set()
    unique_urls: list[str] = []
    for url in urls:
        if url not in seen:
            seen.add(url)
            unique_urls.append(url)

    chosen = unique_urls[:limit]

    print(f"\n✅ Discovered {len(urls)} URLs → keeping first {len(chosen)}")
    for i, url in enumerate(chosen, 1):
        print(f"   {i:2d}. {url}")

    return chosen


def scrape_products(urls: list[str]) -> list[dict]:
    """
    Phase 2: Run the product scraper agent on each URL and collect results.

    Returns a list of product dicts (only successful scrapes).
    """
    print(f"\n{'='*60}")
    print(f"PHASE 2 — Scraping {len(urls)} product page(s)")
    print(f"{'='*60}")

    results: list[dict] = []
    failed: list[dict] = []

    for i, url in enumerate(urls, 1):
        print(f"\n[{i}/{len(urls)}] {url}")
        try:
            result = scrape_product(url, save=False)   # save=False → don't push to Supabase
            product = result.get("data") or {}
            if product.get("title"):
                product["source_url"] = url
                product["scraped_at"] = datetime.now(timezone.utc).isoformat()
                results.append(product)
                print(f"  ✅ {product['title']} — {product.get('price', 'n/a')}")
            else:
                raise ValueError("Agent returned no product data")
        except Exception as exc:
            msg = str(exc)
            print(f"  ❌ Failed: {msg[:120]}")
            failed.append({"url": url, "error": msg})
        # Small pause to avoid hammering sites back-to-back
        if i < len(urls):
            time.sleep(1.5)

    print(f"\n{'='*60}")
    print(f"Scraped: {len(results)} succeeded, {len(failed)} failed")
    if failed:
        print("Failed URLs:")
        for f in failed:
            print(f"  - {f['url']}: {f['error'][:80]}")

    return results


def save_results(products: list[dict], output_path: Path) -> None:
    """Write product data to a JSON file."""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as fh:
        json.dump(products, fh, indent=2, ensure_ascii=False)
    print(f"\n💾 Saved {len(products)} product(s) → {output_path}")


def main():
    parser = argparse.ArgumentParser(description="Profile scrape end-to-end test")
    parser.add_argument(
        "--profile",
        default=DEFAULT_PROFILE,
        help=f"ShopMy (or any curator) profile URL (default: {DEFAULT_PROFILE})",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=DEFAULT_LIMIT,
        help=f"Max product URLs to scrape (default: {DEFAULT_LIMIT})",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT,
        help=f"Output JSON file path (default: {DEFAULT_OUTPUT})",
    )
    args = parser.parse_args()

    start = time.time()

    # Phase 1: discover
    product_urls = discover_product_urls(args.profile, args.limit)
    if not product_urls:
        print("\n❌ No product URLs discovered — aborting.")
        sys.exit(1)

    # Phase 2: scrape
    products = scrape_products(product_urls)

    # Save
    save_results(products, args.output)

    elapsed = time.time() - start
    print(f"\n⏱  Total time: {elapsed:.1f}s")
    print(f"✅ Done — {len(products)} product(s) saved to {args.output}")


if __name__ == "__main__":
    main()
