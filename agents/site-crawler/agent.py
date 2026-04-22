#!/usr/bin/env python3
"""
Site Crawler Agent — Two-Phase Sub-Agent Architecture

Phase 1: COORDINATOR agent visits the homepage, explores navigation, and
          discovers all collection/category URLs.

Phase 2: COLLECTION sub-agents run IN PARALLEL — one per collection —
          each visiting its collection page(s) and extracting product URLs.

This is much faster than a single agent because collections are independent
and can be crawled concurrently.

Usage:
    python agent.py "https://www.nike.com"
    python agent.py "https://www.zara.com/us/en" --max-pages 50
    python agent.py "https://shop.example.com" --dry-run
    python agent.py "https://shop.example.com" --workers 8
"""

import anthropic
import json
import base64
import os
import re
import time
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from urllib.parse import urlparse, urljoin
from playwright.sync_api import sync_playwright, Page, Browser
from dotenv import load_dotenv

load_dotenv()

# ─── Configuration ────────────────────────────────────────────────────

COORDINATOR_MODEL = "claude-sonnet-4-20250514"  # Sonnet for smart navigation discovery
COLLECTION_MODEL = "claude-haiku-4-5-20251001"   # Haiku for simple URL extraction (~cheaper)
MAX_COORDINATOR_TURNS = 10
MAX_COLLECTION_TURNS = 15
MAX_HTML_LENGTH = 15_000      # down from 80K — only need product link patterns
MAX_LINKS_RETURN = 200        # down from 500
MAX_TEXT_PREVIEW = 1500       # down from 3000
MAX_PAGES_DEFAULT = 100
MAX_WORKERS_DEFAULT = 3       # down from 5 to avoid rate limits
RETRY_DELAYS = [2, 5, 15, 30] # exponential backoff for 429s


def _normalize_product_url(url: str) -> str:
    """Normalize a product URL to its canonical form for deduplication.

    Shopify (and similar) stores repeat the same product under many collection
    prefixes, e.g.:
      /collections/t-shirts/products/cool-tee
      /collections/all/products/cool-tee

    We strip the collection prefix so only /products/<slug> is compared.
    """
    parsed = urlparse(url)
    path = parsed.path

    # Shopify pattern: /collections/<name>/products/<slug>  →  /products/<slug>
    match = re.search(r'/products/[^/?#]+', path)
    if match:
        canonical_path = match.group(0)
        return f"{parsed.scheme}://{parsed.netloc}{canonical_path}"

    return url


def _call_with_retry(client: anthropic.Anthropic, **kwargs) -> anthropic.types.Message:
    """Wrapper around messages.create with automatic retry on 429 rate limits."""
    for attempt, delay in enumerate(RETRY_DELAYS):
        try:
            return client.messages.create(**kwargs)
        except anthropic.RateLimitError as e:
            print(f"    ⏳ Rate limited (attempt {attempt + 1}/{len(RETRY_DELAYS)}), waiting {delay}s...")
            time.sleep(delay)
    # Final attempt — let it raise
    return client.messages.create(**kwargs)


# ═══════════════════════════════════════════════════════════════════════
# SHARED BROWSER WRAPPER
# ═══════════════════════════════════════════════════════════════════════

class BrowserAgent:
    """Shared Playwright browser wrapper for agent tool execution."""

    def __init__(self, base_url: str):
        self.base_url = base_url
        self.base_domain = urlparse(base_url).netloc
        self.pages_visited = 0
        self.visited_urls: set[str] = set()
        self.browser: Browser | None = None
        self.page: Page | None = None
        self.pw = None

    def start(self):
        self.pw = sync_playwright().start()
        self.browser = self.pw.chromium.launch(headless=True)
        self.context = self.browser.new_context(
            viewport={"width": 1280, "height": 900},
            user_agent=(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0.0.0 Safari/537.36"
            ),
        )
        self.page = self.context.new_page()

    def stop(self):
        if self.browser:
            self.browser.close()
        if self.pw:
            self.pw.stop()

    def is_same_domain(self, url: str) -> bool:
        try:
            parsed = urlparse(url)
            return parsed.netloc == self.base_domain or parsed.netloc == ""
        except Exception:
            return False

    def visit_page(self, url: str) -> str:
        full_url = urljoin(self.base_url, url) if not url.startswith("http") else url

        if not self.is_same_domain(full_url):
            return json.dumps({"error": f"Different domain: {full_url}"})

        if full_url in self.visited_urls:
            return json.dumps({"error": f"Already visited: {full_url}"})

        self.visited_urls.add(full_url)
        self.pages_visited += 1

        try:
            self.page.goto(full_url, wait_until="domcontentloaded", timeout=30000)
            self.page.wait_for_timeout(2000)
        except Exception as e:
            return json.dumps({"error": f"Failed to load {full_url}: {e}"})

        title = self.page.title()
        link_count = self.page.evaluate("() => document.querySelectorAll('a[href]').length")

        return json.dumps({
            "url": full_url,
            "title": title,
            "link_count": link_count,
            "pages_visited": self.pages_visited,
        })

    def get_page_links(self) -> str:
        links = self.page.evaluate("""() => {
            const links = [];
            const seen = new Set();
            document.querySelectorAll('a[href]').forEach(a => {
                const href = a.href;
                const text = (a.innerText || '').trim().substring(0, 60);
                if (href && !seen.has(href) && !href.startsWith('javascript:') && !href.startsWith('mailto:')) {
                    seen.add(href);
                    links.push({ h: href, t: text });
                }
            });
            return links;
        }""")
        same_domain = [l for l in links if self.is_same_domain(l["h"])]
        return json.dumps({
            "count": len(same_domain),
            "links": [{"h": l["h"], "t": l["t"]} for l in same_domain[:MAX_LINKS_RETURN]],
        })

    def get_navigation(self) -> str:
        nav = self.page.evaluate("""() => {
            const seen = new Set();
            const links = [];
            document.querySelectorAll('nav a, header a, [role="navigation"] a, [class*="categor"] a, [class*="collect"] a, [class*="menu"] a').forEach(a => {
                const href = a.href;
                const text = (a.innerText || '').trim().substring(0, 50);
                if (href && text && !seen.has(href) && !href.startsWith('javascript:')) {
                    seen.add(href);
                    links.push({ h: href, t: text });
                }
            });
            return links;
        }""")
        same_domain = [l for l in nav if self.is_same_domain(l["h"])]
        return json.dumps({"nav_links": same_domain[:150]})

    def take_screenshot(self) -> str:
        buf = self.page.screenshot(full_page=False)
        return f"Screenshot taken ({len(buf)} bytes)."

    def take_screenshot_b64(self) -> str | None:
        try:
            buf = self.page.screenshot(full_page=False)
            return base64.b64encode(buf).decode()
        except Exception:
            return None

    def scroll_down(self, pixels: int = 800) -> str:
        self.page.evaluate(f"window.scrollBy(0, {pixels})")
        self.page.wait_for_timeout(1500)
        new_height = self.page.evaluate("document.documentElement.scrollHeight")
        scroll_pos = self.page.evaluate("window.scrollY + window.innerHeight")
        return json.dumps({
            "scrolled_by": pixels,
            "page_height": new_height,
            "current_position": scroll_pos,
            "at_bottom": scroll_pos >= new_height - 50,
        })

    def get_product_links(self) -> str:
        """Extract only product-like links from the page — much cheaper than full HTML."""
        links = self.page.evaluate("""() => {
            const seen = new Set();
            const products = [];
            document.querySelectorAll('a[href]').forEach(a => {
                const href = a.href;
                if (!href || seen.has(href)) return;
                const pattern = new RegExp('/(products?|item|p|dp|shop)/');
                if (pattern.test(href) ||
                    a.closest('[class*="product"], [class*="card"], [class*="item"], [data-product], [data-item]')) {
                    seen.add(href);
                    const text = (a.innerText || a.getAttribute('aria-label') || '').trim().substring(0, 60);
                    products.push({ h: href, t: text });
                }
            });
            return products;
        }""")
        same_domain = [l for l in links if self.is_same_domain(l["h"])]
        return json.dumps({"product_links": same_domain[:300]})

    def get_page_html(self) -> str:
        """Fallback: stripped HTML if product_links doesn't find enough."""
        html = self.page.evaluate("""() => {
            const clone = document.documentElement.cloneNode(true);
            clone.querySelectorAll('script, style, noscript, svg, link[rel="stylesheet"], img, picture, video, iframe, meta').forEach(e => e.remove());
            // Strip all attributes except href
            clone.querySelectorAll('*').forEach(el => {
                const href = el.getAttribute('href');
                [...el.attributes].forEach(a => el.removeAttribute(a.name));
                if (href) el.setAttribute('href', href);
            });
            return clone.outerHTML;
        }""")
        if len(html) > MAX_HTML_LENGTH:
            html = html[:MAX_HTML_LENGTH] + "\n<!-- truncated -->"
        return html


# ═══════════════════════════════════════════════════════════════════════
# PHASE 1: COORDINATOR — discover collections/categories
# ═══════════════════════════════════════════════════════════════════════

COORDINATOR_TOOLS = [
    {
        "name": "visit_page",
        "description": "Navigate to a URL. Returns page title, link count, visible text.",
        "input_schema": {
            "type": "object",
            "properties": {"url": {"type": "string", "description": "URL to navigate to"}},
            "required": ["url"],
        },
    },
    {
        "name": "get_page_links",
        "description": "Get all links from the current page with href, text, and section context.",
        "input_schema": {"type": "object", "properties": {}, "required": []},
    },
    {
        "name": "get_navigation",
        "description": "Extract the site navigation structure — menus, category links, collection links.",
        "input_schema": {"type": "object", "properties": {}, "required": []},
    },
    {
        "name": "take_screenshot",
        "description": "Take a screenshot for visual inspection of navigation/layout.",
        "input_schema": {"type": "object", "properties": {}, "required": []},
    },
    {
        "name": "scroll_down",
        "description": "Scroll down to reveal more navigation or content.",
        "input_schema": {
            "type": "object",
            "properties": {"pixels": {"type": "integer", "description": "Pixels to scroll (default 800)"}},
            "required": [],
        },
    },
    {
        "name": "save_collections",
        "description": (
            "Save the discovered collection/category pages. Each collection will be "
            "crawled by a separate sub-agent in parallel to extract product URLs. "
            "Call this ONCE after you've identified all collections."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "collections": {
                    "type": "array",
                    "description": "Array of collection/category pages to crawl",
                    "items": {
                        "type": "object",
                        "properties": {
                            "url": {"type": "string", "description": "Collection page URL"},
                            "name": {"type": "string", "description": "Collection name (e.g. 'New Arrivals', 'Women\\'s Shoes')"},
                        },
                        "required": ["url", "name"],
                    },
                },
            },
            "required": ["collections"],
        },
    },
]

COORDINATOR_SYSTEM = """You are the COORDINATOR agent for a site crawler. Your ONLY job is to
discover all collection/category page URLs on an e-commerce site.

## Your Task

1. Visit the homepage
2. Explore the navigation (menus, dropdowns, sidebar categories, footer links)
3. Identify ALL collection/category pages that list products
4. Call save_collections with the complete list

## What counts as a collection page?

- Category pages (e.g. /men, /women, /shoes, /accessories)
- Collection pages (e.g. /collections/new-arrivals, /collections/sale)
- Brand pages that list products
- Seasonal/featured pages (e.g. /spring-2025, /best-sellers)
- ANY page that lists multiple products in a grid or list

## Rules

- Do NOT follow individual product links — only find LISTING pages
- Include subcategories (e.g. Men > Shoes > Running Shoes)
- Stay on the same domain
- Work fast — you don't need to visit every page, just identify the collection URLs from navigation
- Skip non-product pages (about, contact, FAQ, blog, policies, cart, account)
- Call save_collections ONCE with ALL collections you found
- If the site has many subcategories, include them all — each will be crawled by a sub-agent
- LIMIT yourself to the top 30-50 most important collection pages (main categories + key subcategories). If a site has hundreds of leaf subcategories, pick the broader parent pages instead — do not exceed ~50 entries.
- Keep collection names short (1-4 words). The full save_collections JSON must fit in ~6000 tokens."""


def run_coordinator(site_url: str) -> list[dict]:
    """
    Phase 1: Discover all collection/category URLs on the site.

    Returns: [{"url": "...", "name": "..."}, ...]
    """
    browser = BrowserAgent(site_url)
    browser.start()
    collections: list[dict] = []

    try:
        client = anthropic.Anthropic()
        messages = [{"role": "user", "content": (
            f"Discover all collection/category page URLs on {site_url}. "
            f"Visit the homepage, explore the navigation structure, and call save_collections "
            f"with every collection/category page you find."
        )}]

        for turn in range(MAX_COORDINATOR_TURNS):
            print(f"  [Coordinator] Turn {turn + 1}/{MAX_COORDINATOR_TURNS}")

            response = _call_with_retry(
                client,
                model=COORDINATOR_MODEL,
                max_tokens=8192,
                system=COORDINATOR_SYSTEM,
                tools=COORDINATOR_TOOLS,
                messages=messages,
            )

            if response.stop_reason == "end_turn":
                for block in response.content:
                    if hasattr(block, "text"):
                        print(f"  [Coordinator] {block.text[:200]}")
                break

            assistant_content = response.content
            messages.append({"role": "assistant", "content": assistant_content})

            tool_results = []

            for block in assistant_content:
                if block.type != "tool_use":
                    if hasattr(block, "text"):
                        print(f"  [Coordinator] {block.text[:150]}")
                    continue

                tool_name = block.name
                tool_input = block.input
                print(f"    → {tool_name}({json.dumps(tool_input)[:100]})")

                if tool_name == "save_collections":
                    raw = tool_input.get("collections", [])
                    if not raw:
                        result_text = json.dumps({
                            "error": (
                                "You called save_collections with an empty or missing 'collections' array. "
                                "You MUST pass the collections inline as: "
                                "save_collections({\"collections\": [{\"url\": \"...\", \"name\": \"...\"}, ...]}). "
                                "If your list is very long, prioritise the top 30-50 most important "
                                "category/collection pages and keep names short."
                            ),
                            "saved": 0,
                        })
                    else:
                        seen = set()
                        for c in raw:
                            url = c.get("url", "").strip()
                            if url and url not in seen and browser.is_same_domain(url):
                                seen.add(url)
                                collections.append({
                                    "url": url,
                                    "name": c.get("name", ""),
                                })
                        result_text = json.dumps({
                            "saved": len(collections),
                            "message": f"Saved {len(collections)} collections. They will now be crawled in parallel.",
                        })
                elif tool_name == "visit_page":
                    result_text = browser.visit_page(tool_input["url"])
                elif tool_name == "get_page_links":
                    result_text = browser.get_page_links()
                elif tool_name == "get_navigation":
                    result_text = browser.get_navigation()
                elif tool_name == "take_screenshot":
                    result_text = browser.take_screenshot()
                elif tool_name == "scroll_down":
                    result_text = browser.scroll_down(tool_input.get("pixels", 800))
                else:
                    result_text = f"Unknown tool: {tool_name}"

                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": block.id,
                    "content": result_text,
                })

            if tool_results:
                messages.append({"role": "user", "content": tool_results})

            # If we got collections, stop
            if collections:
                break

    except Exception as e:
        print(f"  [Coordinator] Error: {e}")
    finally:
        browser.stop()

    print(f"  [Coordinator] Found {len(collections)} collections")
    return collections


# ═══════════════════════════════════════════════════════════════════════
# PHASE 2: COLLECTION SUB-AGENT — extract product URLs from one collection
# ═══════════════════════════════════════════════════════════════════════

COLLECTION_TOOLS = [
    {
        "name": "visit_page",
        "description": "Navigate to a URL. Returns page title and link count.",
        "input_schema": {
            "type": "object",
            "properties": {"url": {"type": "string", "description": "URL to navigate to"}},
            "required": ["url"],
        },
    },
    {
        "name": "get_product_links",
        "description": "Extract product-specific links from the page (auto-detects product URL patterns and product card containers). Use this FIRST.",
        "input_schema": {"type": "object", "properties": {}, "required": []},
    },
    {
        "name": "scroll_down",
        "description": "Scroll down to reveal lazy-loaded products.",
        "input_schema": {
            "type": "object",
            "properties": {"pixels": {"type": "integer", "description": "Pixels to scroll (default 800)"}},
            "required": [],
        },
    },
    {
        "name": "get_page_links",
        "description": "Get ALL links from the page. Use only if get_product_links missed some products.",
        "input_schema": {"type": "object", "properties": {}, "required": []},
    },
    {
        "name": "save_product_urls",
        "description": "Save found product URLs from this collection. Call when done.",
        "input_schema": {
            "type": "object",
            "properties": {
                "products": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "url": {"type": "string", "description": "Product page URL"},
                            "page_title": {"type": "string", "description": "Product name from link text"},
                        },
                        "required": ["url"],
                    },
                },
            },
            "required": ["products"],
        },
    },
]

COLLECTION_SYSTEM = """You are a COLLECTION sub-agent. Extract ALL product page URLs from a collection page.

## Strategy

1. Visit the collection page — note the total product count if shown (e.g. "74 Products")
2. Call get_product_links to get the initial visible products
3. Scroll down repeatedly (4-6 times, ~2000px each) and call get_product_links after each scroll — most modern sites lazy-load products on scroll
4. Keep scrolling until get_product_links returns the same count twice in a row OR you reach the displayed total
5. If there's pagination instead of infinite scroll, visit page 2, 3 etc. and repeat
6. Call save_product_urls with ALL product URLs you collected. You may call save_product_urls multiple times if needed — duplicates will be ignored.

## Rules

- Only save PRODUCT page URLs (not collection/category links)
- Use get_product_links first — only use get_page_links as fallback
- DO NOT stop at 10-20 products if the page header says there are more
- Keep page_title strings short (1-5 words) — long titles waste output tokens
- Stay on the same domain
- It's fine to call save_product_urls progressively as you discover more products"""


def run_collection_subagent(
    site_url: str,
    collection_url: str,
    collection_name: str,
    max_pages: int = 10,
) -> list[dict]:
    """
    Phase 2 sub-agent: Extract product URLs from a single collection.

    Returns: [{"url": "...", "collection_name": "...", "page_title": "..."}, ...]
    """
    browser = BrowserAgent(site_url)
    browser.start()
    products: list[dict] = []

    try:
        client = anthropic.Anthropic()
        messages = [{"role": "user", "content": (
            f"Extract all product URLs from the '{collection_name}' collection at: {collection_url}\n"
            f"Visit the page, use get_product_links, scroll down, then call save_product_urls."
        )}]

        for turn in range(MAX_COLLECTION_TURNS):
            response = _call_with_retry(
                client,
                model=COLLECTION_MODEL,
                max_tokens=8192,
                system=COLLECTION_SYSTEM,
                tools=COLLECTION_TOOLS,
                messages=messages,
            )

            if response.stop_reason == "end_turn":
                break

            assistant_content = response.content
            messages.append({"role": "assistant", "content": assistant_content})

            tool_results = []
            for block in assistant_content:
                if block.type != "tool_use":
                    continue

                tool_name = block.name
                tool_input = block.input

                if tool_name == "save_product_urls":
                    raw = tool_input.get("products", [])
                    if not raw:
                        result_text = json.dumps({
                            "error": (
                                "You called save_product_urls with an empty 'products' array. "
                                "You MUST pass the products inline as: "
                                "save_product_urls({\"products\": [{\"url\": \"...\", \"page_title\": \"...\"}, ...]}). "
                                "Make sure you've called get_product_links and scrolled enough to load all products first."
                            ),
                            "saved": 0,
                        })
                    else:
                        seen = {p["url"] for p in products}
                        added = 0
                        for p in raw:
                            url = p.get("url", "").strip()
                            if url and url not in seen and browser.is_same_domain(url):
                                seen.add(url)
                                products.append({
                                    "url": url,
                                    "collection_name": collection_name,
                                    "page_title": p.get("page_title", ""),
                                })
                                added += 1
                        result_text = json.dumps({
                            "saved_total": len(products),
                            "newly_added": added,
                            "message": (
                                f"Total products saved so far: {len(products)}. "
                                "If the collection page showed more products than this, "
                                "scroll down further and call save_product_urls again with additional URLs."
                            ),
                        })
                elif tool_name == "visit_page":
                    if browser.pages_visited >= max_pages:
                        result_text = json.dumps({"error": f"Max pages ({max_pages}) reached"})
                    else:
                        result_text = browser.visit_page(tool_input["url"])
                elif tool_name == "get_product_links":
                    result_text = browser.get_product_links()
                elif tool_name == "get_page_links":
                    result_text = browser.get_page_links()
                elif tool_name == "scroll_down":
                    result_text = browser.scroll_down(tool_input.get("pixels", 800))
                else:
                    result_text = f"Unknown tool: {tool_name}"

                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": block.id,
                    "content": result_text,
                })

            if tool_results:
                messages.append({"role": "user", "content": tool_results})

            # If products saved and agent done, break
            if products and response.stop_reason == "end_turn":
                break

    except Exception as e:
        print(f"    [Sub-agent:{collection_name}] Error: {e}")
    finally:
        browser.stop()

    return products


# ═══════════════════════════════════════════════════════════════════════
# ORCHESTRATOR — wire coordinator + parallel sub-agents together
# ═══════════════════════════════════════════════════════════════════════

def run_agent(
    site_url: str,
    max_pages: int = MAX_PAGES_DEFAULT,
    max_workers: int = MAX_WORKERS_DEFAULT,
) -> dict:
    """
    Run the full site crawler: coordinator then parallel collection sub-agents.

    Returns:
        {
            "success": bool,
            "site_url": str,
            "collections_found": int,
            "products": [{"url", "collection_name", "page_title"}, ...],
            "pages_visited": int,
            "error": str | None,
        }
    """
    print(f"=== Phase 1: Discovering collections on {site_url} ===")
    collections = run_coordinator(site_url)

    if not collections:
        return {
            "success": False,
            "site_url": site_url,
            "collections_found": 0,
            "products": [],
            "pages_visited": 0,
            "error": "No collections/categories discovered",
        }

    # Distribute max_pages across collections
    pages_per_collection = max(3, max_pages // len(collections))

    print(f"\n=== Phase 2: Crawling {len(collections)} collections "
          f"({max_workers} workers, {pages_per_collection} pages each) ===")

    all_products: list[dict] = []
    seen_slugs: set[str] = set()  # normalized URLs for dedup
    total_pages = 0
    errors: list[str] = []

    def _crawl_collection(coll: dict) -> tuple[list[dict], str | None]:
        """Worker function for thread pool."""
        try:
            name = coll["name"]
            url = coll["url"]
            print(f"  > Starting: {name} ({url})")
            result = run_collection_subagent(site_url, url, name, pages_per_collection)
            print(f"  + Done: {name} -> {len(result)} products")
            return result, None
        except Exception as e:
            print(f"  x Failed: {coll['name']} -- {e}")
            return [], str(e)

    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        futures = {pool.submit(_crawl_collection, c): c for c in collections}

        for future in as_completed(futures):
            coll = futures[future]
            try:
                products, err = future.result()
                if err:
                    errors.append(f"{coll['name']}: {err}")

                # Dedup across collections using normalized product URL
                for p in products:
                    canonical = _normalize_product_url(p["url"])
                    if canonical not in seen_slugs:
                        seen_slugs.add(canonical)
                        # Store the canonical URL so DB has consistent URLs
                        p["url"] = canonical
                        all_products.append(p)

            except Exception as e:
                errors.append(f"{coll['name']}: {e}")

    print(f"\n=== Crawl complete ===")
    print(f"  Collections: {len(collections)}")
    print(f"  Products: {len(all_products)}")
    if errors:
        print(f"  Errors: {len(errors)}")

    return {
        "success": len(all_products) > 0,
        "site_url": site_url,
        "collections_found": len(collections),
        "products": all_products,
        "pages_visited": total_pages,
        "error": "; ".join(errors) if errors and not all_products else None,
    }


# ─── CLI ──────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Site Crawler Agent (Sub-Agent Architecture)")
    parser.add_argument("url", help="Site URL to crawl")
    parser.add_argument("--max-pages", type=int, default=MAX_PAGES_DEFAULT,
                        help=f"Max total pages to visit (default: {MAX_PAGES_DEFAULT})")
    parser.add_argument("--workers", type=int, default=MAX_WORKERS_DEFAULT,
                        help=f"Concurrent collection workers (default: {MAX_WORKERS_DEFAULT})")
    parser.add_argument("--dry-run", action="store_true",
                        help="Print results without saving to DB")
    args = parser.parse_args()

    print(f"Crawling: {args.url}")
    print(f"   Max pages: {args.max_pages}")
    print(f"   Workers: {args.workers}")
    print()

    result = run_agent(args.url, args.max_pages, args.workers)

    print()
    success = "OK" if result["success"] else "FAIL"
    print(f"[{success}] Crawl complete")
    print(f"   Collections: {result['collections_found']}")
    print(f"   Products found: {len(result['products'])}")

    if result.get("error"):
        print(f"   Error: {result['error']}")

    if result["products"]:
        collections: dict[str, list] = {}
        for p in result["products"]:
            coll = p.get("collection_name") or "Uncategorized"
            collections.setdefault(coll, []).append(p)

        print(f"\n   Collections ({len(collections)}):")
        for coll, items in sorted(collections.items()):
            print(f"     {coll}: {len(items)} products")
            for item in items[:3]:
                print(f"       - {item['page_title'] or item['url']}")
            if len(items) > 3:
                print(f"       ... and {len(items) - 3} more")

    if not args.dry_run:
        output_file = "crawl_results.json"
        with open(output_file, "w") as f:
            json.dump(result, f, indent=2)
        print(f"\n   Results saved to {output_file}")

    return 0 if result["success"] else 1


if __name__ == "__main__":
    exit(main())
