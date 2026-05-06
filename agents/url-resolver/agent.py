#!/usr/bin/env python3
"""
URL Resolver Agent

Resolves Google Shopping URLs to direct merchant product URLs using SerpAPI's
google_product engine. This is a lightweight agent — no browser, no Claude AI —
just a SerpAPI call to fetch the merchant's direct link from the product's
online sellers list.

Google Shopping URLs stored in the products table look like:
  https://www.google.com/shopping/product/1234567890
  https://www.google.com/shopping/product/1234567890/specs?...

The agent extracts the numeric product ID and calls SerpAPI's google_product
engine, which returns a sellers list with direct merchant URLs.

Usage:
    python agent.py "https://www.google.com/shopping/product/1234567890"
    python agent.py "https://www.google.com/shopping/product/1234567890/specs"

Returns:
    str | None  — the resolved merchant URL, or None if not resolvable.
"""

import os
import re
import json
import urllib.request
import urllib.parse
from dotenv import load_dotenv

load_dotenv()

SERPAPI_KEY = os.environ.get("SERPAPI_KEY", "")
SERPAPI_URL = "https://serpapi.com/search.json"


def is_google_url(url: str) -> bool:
    return bool(re.search(r'google\.com', url, re.IGNORECASE))


def extract_product_id(google_shopping_url: str) -> str | None:
    """
    Extract the numeric product ID from a Google Shopping URL.

    Handles:
      https://www.google.com/shopping/product/12345678901234567
      https://google.com/shopping/product/12345678901234567/specs?q=...
    """
    match = re.search(r'/shopping/product/(\d+)', google_shopping_url)
    return match.group(1) if match else None


def resolve_via_serpapi(product_id: str) -> str | None:
    """
    Call SerpAPI google_product engine with the product ID and return the first
    direct merchant URL found in the online sellers list.
    """
    if not SERPAPI_KEY:
        raise RuntimeError("SERPAPI_KEY is not set")

    params = urllib.parse.urlencode({
        "engine": "google_product",
        "product_id": product_id,
        "api_key": SERPAPI_KEY,
        "gl": "us",
        "hl": "en",
    })
    url = f"{SERPAPI_URL}?{params}"

    req = urllib.request.Request(url, headers={"User-Agent": "catalog-url-resolver/1.0"})
    with urllib.request.urlopen(req, timeout=20) as resp:
        data = json.loads(resp.read())

    # SerpAPI schema varies — walk all known seller list locations
    type Sellers = list[dict]
    seller_lists: list[Sellers] = [
        data.get("sellers_results", {}).get("online_sellers", []),
        data.get("online_sellers", []),
        data.get("stores", []),
        data.get("product_results", {}).get("online_sellers", []),
    ]

    for sellers in seller_lists:
        if not isinstance(sellers, list):
            continue
        for seller in sellers:
            for key in ("direct_link", "link", "base_price_link"):
                candidate = str(seller.get(key) or "").strip()
                if candidate and candidate.startswith("https://") and not is_google_url(candidate):
                    return candidate

    # Fallback: top-level product link
    top_link = str(data.get("product_results", {}).get("link") or "").strip()
    if top_link and top_link.startswith("https://") and not is_google_url(top_link):
        return top_link

    return None


def resolve_url(google_shopping_url: str) -> str | None:
    """
    Main entry point. Given a Google Shopping URL, return a direct merchant
    product URL or None if resolution fails.
    """
    product_id = extract_product_id(google_shopping_url)
    if not product_id:
        print(f"  ⚠️  Cannot extract product ID from: {google_shopping_url}")
        return None

    print(f"  🔍 Product ID: {product_id}")
    try:
        resolved = resolve_via_serpapi(product_id)
    except Exception as e:
        print(f"  ❌ SerpAPI error: {e}")
        return None

    if resolved:
        print(f"  ✅ Resolved: {resolved}")
    else:
        print(f"  ⚠️  No direct merchant URL found for product ID {product_id}")

    return resolved


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Resolve a Google Shopping URL to a merchant PDP URL")
    parser.add_argument("url", help="Google Shopping URL (e.g. https://www.google.com/shopping/product/1234)")
    args = parser.parse_args()

    result = resolve_url(args.url)
    if result:
        print(f"\nDirect URL: {result}")
    else:
        print("\nCould not resolve to a direct URL.")
