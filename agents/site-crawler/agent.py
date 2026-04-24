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
import gzip
import io
import urllib.request
import urllib.error
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from urllib.parse import urlparse, urljoin
from playwright.sync_api import sync_playwright, Page, Browser
from dotenv import load_dotenv

load_dotenv()

# ─── Configuration ────────────────────────────────────────────────────

COORDINATOR_MODEL = "claude-sonnet-4-20250514"  # Sonnet for smart navigation discovery
COLLECTION_MODEL = "claude-haiku-4-5-20251001"   # Haiku for simple URL extraction (~cheaper)
MAX_COORDINATOR_TURNS = 14
MAX_COLLECTION_TURNS = 28
MAX_HTML_LENGTH = 15_000      # down from 80K — only need product link patterns
MAX_LINKS_RETURN = 200        # down from 500
MAX_TEXT_PREVIEW = 1500       # down from 3000
MAX_PAGES_DEFAULT = 100
MAX_WORKERS_DEFAULT = 3       # down from 5 to avoid rate limits
RETRY_DELAYS = [2, 5, 15, 30] # exponential backoff for 429s

# Hard cap on products we save per crawl job — protects Modal cost when a sitemap
# returns tens of thousands of URLs (e.g. Amazon-style catalogues).
MAX_PRODUCTS_HARD_LIMIT = 5000

# Per-collection sub-agent page budget (used to be derived from user-supplied max_pages).
DEFAULT_PAGES_PER_COLLECTION = 5

# Path patterns used to classify URLs found in sitemaps
PRODUCT_URL_PATTERNS = [
    re.compile(r"/products?/[^/]+/?$", re.IGNORECASE),
    re.compile(r"/p/[^/]+/?$", re.IGNORECASE),
    re.compile(r"/dp/[A-Z0-9]+", re.IGNORECASE),
    re.compile(r"/item/[^/]+/?$", re.IGNORECASE),
    re.compile(r"/shop/[^/]+/[^/]+/?$", re.IGNORECASE),
]

COLLECTION_URL_PATTERNS = [
    re.compile(r"/collections?/[^/]+/?$", re.IGNORECASE),
    re.compile(r"/category/[^/]+/?$", re.IGNORECASE),
    re.compile(r"/categories/[^/]+/?$", re.IGNORECASE),
    re.compile(r"/c/[^/]+/?$", re.IGNORECASE),
]


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
# SITEMAP DISCOVERY (deterministic, free, exhaustive)
# ═══════════════════════════════════════════════════════════════════════

_SITEMAP_USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/120.0.0.0 Safari/537.36"
)
_SITEMAP_NS = "{http://www.sitemaps.org/schemas/sitemap/0.9}"
_COMMON_SITEMAP_PATHS = [
    "/sitemap.xml",
    "/sitemap_index.xml",
    "/sitemap-index.xml",
    "/sitemap_products_1.xml",
    "/sitemap_collections_1.xml",
    "/sitemap/sitemap.xml",
]


def _http_get(url: str, timeout: int = 15) -> bytes | None:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": _SITEMAP_USER_AGENT})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = resp.read()
            if url.endswith(".gz") or resp.headers.get("Content-Encoding") == "gzip":
                try:
                    data = gzip.decompress(data)
                except OSError:
                    pass
            return data
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, ConnectionError):
        return None
    except Exception:
        return None


def _sitemap_urls_from_robots(site_url: str) -> list[str]:
    parsed = urlparse(site_url)
    base = f"{parsed.scheme}://{parsed.netloc}"
    body = _http_get(f"{base}/robots.txt")
    if not body:
        return []
    urls: list[str] = []
    for line in body.decode("utf-8", errors="ignore").splitlines():
        line = line.strip()
        if line.lower().startswith("sitemap:"):
            urls.append(line.split(":", 1)[1].strip())
    return urls


def _parse_sitemap(xml_bytes: bytes) -> tuple[list[str], list[str]]:
    """Return (sub_sitemap_urls, page_urls) from a sitemap or sitemap-index document."""
    try:
        root = ET.fromstring(xml_bytes)
    except ET.ParseError:
        return [], []

    tag = root.tag.lower()
    sub: list[str] = []
    pages: list[str] = []

    if tag.endswith("sitemapindex"):
        for sm in root.findall(f"{_SITEMAP_NS}sitemap"):
            loc = sm.find(f"{_SITEMAP_NS}loc")
            if loc is not None and loc.text:
                sub.append(loc.text.strip())
    else:
        for u in root.findall(f"{_SITEMAP_NS}url"):
            loc = u.find(f"{_SITEMAP_NS}loc")
            if loc is not None and loc.text:
                pages.append(loc.text.strip())
    return sub, pages


def _classify_url(url: str) -> str | None:
    """Return 'product', 'collection', or None."""
    path = urlparse(url).path
    if not path or path == "/":
        return None
    for pat in PRODUCT_URL_PATTERNS:
        if pat.search(path):
            return "product"
    for pat in COLLECTION_URL_PATTERNS:
        if pat.search(path):
            return "collection"
    return None


def _name_from_url(url: str) -> str:
    path = urlparse(url).path.rstrip("/")
    slug = path.rsplit("/", 1)[-1] if path else ""
    slug = slug.replace("-", " ").replace("_", " ").strip()
    return slug.title() if slug else "Collection"


def discover_via_sitemap(site_url: str, max_sitemaps: int = 50) -> dict:
    """Walk robots.txt + common sitemap paths, classify URLs.

    Returns: {"collections": [{"url", "name"}, ...], "products": [{"url", "page_title"}, ...]}
    """
    parsed = urlparse(site_url)
    base = f"{parsed.scheme}://{parsed.netloc}"

    seeds: list[str] = []
    seeds.extend(_sitemap_urls_from_robots(site_url))
    for p in _COMMON_SITEMAP_PATHS:
        candidate = f"{base}{p}"
        if candidate not in seeds:
            seeds.append(candidate)

    queue = list(seeds)
    seen_sitemaps: set[str] = set()
    products: dict[str, dict] = {}
    collections: dict[str, dict] = {}

    while queue and len(seen_sitemaps) < max_sitemaps:
        url = queue.pop(0)
        if url in seen_sitemaps:
            continue
        seen_sitemaps.add(url)

        body = _http_get(url)
        if not body:
            continue

        sub, pages = _parse_sitemap(body)
        for s in sub:
            if s not in seen_sitemaps and len(seen_sitemaps) + len(queue) < max_sitemaps:
                queue.append(s)

        for page_url in pages:
            kind = _classify_url(page_url)
            if kind == "product" and page_url not in products:
                products[page_url] = {"url": page_url, "page_title": _name_from_url(page_url)}
            elif kind == "collection" and page_url not in collections:
                collections[page_url] = {"url": page_url, "name": _name_from_url(page_url)}

    return {
        "collections": list(collections.values()),
        "products": list(products.values()),
        "sitemaps_visited": len(seen_sitemaps),
    }


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
            const sel = [
                'nav a', 'header a', '[role="navigation"] a',
                '[class*="categor"] a', '[class*="collect"] a',
                '[class*="menu"] a', '[class*="Header"] a', '[class*="Nav"] a',
                '[data-testid*="menu"] a', '[data-testid*="nav"] a',
                '[aria-label*="menu"] a', '[aria-label*="navigation"] a',
                'footer a'
            ].join(', ');
            document.querySelectorAll(sel).forEach(a => {
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
        return json.dumps({"nav_links": same_domain[:200]})

    def hover_main_menu(self) -> str:
        """Hover top-level nav items to reveal mega-menu dropdowns, then re-extract links."""
        try:
            new_links = self.page.evaluate("""async () => {
                const tops = Array.from(document.querySelectorAll(
                    'nav > ul > li, header nav li, [role="navigation"] > ul > li, [class*="Header"] li[class*="item"]'
                )).slice(0, 20);
                const before = document.querySelectorAll('a[href]').length;
                for (const el of tops) {
                    try {
                        el.dispatchEvent(new MouseEvent('mouseover', {bubbles: true}));
                        el.dispatchEvent(new MouseEvent('mouseenter', {bubbles: true}));
                        await new Promise(r => setTimeout(r, 250));
                    } catch (e) {}
                }
                const after = document.querySelectorAll('a[href]').length;
                return {hovered: tops.length, links_before: before, links_after: after};
            }""")
            return json.dumps(new_links)
        except Exception as e:
            return json.dumps({"error": str(e)})

    def detect_total_count(self) -> int | None:
        """Try to read a 'N products / items / results' badge from visible text."""
        try:
            text = self.page.evaluate("document.body.innerText || ''")
        except Exception:
            return None
        if not text:
            return None
        match = re.search(r"(\d{1,5})\s+(?:products?|items?|results?|styles?)\b", text, re.IGNORECASE)
        if match:
            try:
                return int(match.group(1))
            except ValueError:
                return None
        return None

    def auto_load_all(self, max_iterations: int = 40) -> str:
        """Deterministically scroll + click 'Load more' / pagination until the product
        link count stops growing or matches the on-page total. Avoids LLM round-trips."""
        if not self.page:
            return json.dumps({"error": "No page loaded"})

        target = self.detect_total_count()
        last_count = 0
        stable_iterations = 0
        clicked_buttons = 0
        load_more_selectors = [
            "button:has-text('Load more')",
            "button:has-text('Show more')",
            "button:has-text('View more')",
            "a:has-text('Load more')",
            "a:has-text('Show more')",
            "a:has-text('Next')",
            "button:has-text('More')",
            "[class*='load-more']",
            "[class*='LoadMore']",
            "[data-testid*='load-more']",
        ]

        for i in range(max_iterations):
            try:
                self.page.evaluate("window.scrollTo(0, document.documentElement.scrollHeight)")
            except Exception:
                pass
            try:
                self.page.wait_for_load_state("networkidle", timeout=3000)
            except Exception:
                self.page.wait_for_timeout(800)

            # Try clicking a load-more button if visible
            for sel in load_more_selectors:
                try:
                    btn = self.page.locator(sel).first
                    if btn and btn.is_visible(timeout=500):
                        btn.click(timeout=1500)
                        clicked_buttons += 1
                        try:
                            self.page.wait_for_load_state("networkidle", timeout=3000)
                        except Exception:
                            self.page.wait_for_timeout(800)
                        break
                except Exception:
                    continue

            try:
                count = self.page.evaluate(
                    """() => {
                        const seen = new Set();
                        document.querySelectorAll('a[href]').forEach(a => {
                            const h = a.href;
                            if (/\/(products?|item|p|dp|shop)\//.test(h)) seen.add(h);
                        });
                        return seen.size;
                    }"""
                )
            except Exception:
                count = last_count

            if target and count >= target:
                last_count = count
                break

            if count == last_count:
                stable_iterations += 1
                if stable_iterations >= 2:
                    break
            else:
                stable_iterations = 0
            last_count = count

        return json.dumps({
            "product_links_loaded": last_count,
            "target_total": target,
            "iterations": i + 1,
            "buttons_clicked": clicked_buttons,
        })

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

    def get_product_links(self, cross_domain: bool = False) -> str:
        """Extract product-like links from the page — much cheaper than full HTML.

        cross_domain=False (default): only same-domain links (normal site crawl).
        cross_domain=True: profile/curator mode (shopmy.us, ltk, linktree, etc.)
            Includes:
              - same-domain redirect links shaped like /p/<id>, /go/<id>, /product/...
                (these are the curator platform's outbound trackers)
              - outbound links to brand sites
            Excludes:
              - generic "card" / "item" containers (too noisy: blog cards, help cards,
                footer items, follow buttons, etc.)
              - obvious non-product paths (privacy, terms, help, login, blog, …)
              - social-media links
        """
        # Two-pass JS extraction:
        #   pass A: any <a> whose href looks like a product URL by path
        #   pass B: any <a> inside an EXPLICIT product container (not generic card/item)
        # Each entry is tagged so Python can apply different rules per pass.
        links = self.page.evaluate("""() => {
            const seen = new Set();
            const out = [];
            // Product-shaped path patterns. Note: \\bp\\b only matches when /p/ is
            // a real path segment (avoids accidental matches inside other words).
            const productPath = /\\/(products?|item|items|p|dp|gp|go|sku|listing|shop|pin)\\/[^\\/?#]+/i;
            // Tighter container selector — drops generic [class*="card"]/[class*="item"]
            // which match too many non-product elements on curator pages.
            const productContainer = '[class*="product"], [class*="Product"], ' +
                '[class*="pin"], [class*="Pin"], [class*="shelf"], [class*="Shelf"], ' +
                '[data-product], [data-product-id], [data-item-id], [data-pin-id]';
            document.querySelectorAll('a[href]').forEach(a => {
                const href = a.href;
                if (!href || seen.has(href)) return;
                if (href.startsWith('javascript:') || href.startsWith('mailto:') ||
                    href.startsWith('tel:') || href.startsWith('#')) return;
                const text = (a.innerText || a.getAttribute('aria-label') || '').trim().substring(0, 60);
                let source = null;
                if (productPath.test(href)) source = 'path';
                else if (a.closest(productContainer)) source = 'container';
                if (!source) return;
                seen.add(href);
                out.push({ h: href, t: text, s: source });
            });
            return out;
        }""")

        # Path segments that almost never correspond to real products.
        EXCLUDE_PATH_SEGMENTS = {
            "privacy", "terms", "tos", "legal", "cookies", "cookie",
            "faq", "help", "support", "contact", "about", "careers",
            "press", "blog", "news", "article", "articles", "post", "posts",
            "login", "signin", "sign-in", "signup", "sign-up", "register",
            "account", "profile", "settings", "cart", "checkout", "wishlist",
            "search", "category", "categories", "collection", "collections",
            "brands", "sitemap", "feed", "rss",
        }

        def _looks_like_product_path(href: str) -> bool:
            try:
                segs = [s for s in urlparse(href).path.split("/") if s]
            except Exception:
                return False
            if not segs:
                return False
            if any(s.lower() in EXCLUDE_PATH_SEGMENTS for s in segs):
                return False
            return True

        if cross_domain:
            def _norm(h: str) -> str:
                return (h or "").lower().removeprefix("www.")
            profile_host = _norm(self.base_domain)
            social_hosts = (
                "instagram.com", "tiktok.com", "youtube.com", "twitter.com", "x.com",
                "facebook.com", "pinterest.com", "threads.net", "linkedin.com",
                "snapchat.com", "reddit.com", "discord.com", "discord.gg",
                "spotify.com", "apple.com", "music.apple.com", "podcasts.apple.com",
            )
            # Curator/affiliate platforms whose own non-product pages we want to skip.
            # We KEEP same-host links if they look like product redirects (/p/<id>, /go/<id>).
            filtered = []
            for l in links:
                href = l["h"]
                if not href.startswith(("http://", "https://")):
                    continue
                host = _norm(urlparse(href).hostname or "")
                if not host:
                    continue
                if any(host == s or host.endswith("." + s) for s in social_hosts):
                    continue

                if host == profile_host:
                    # Same-host link on a curator page: only keep if it's clearly a
                    # product/redirect URL (e.g. shopmy.us/p/<id>), not internal nav.
                    if l["s"] != "path":
                        continue
                    if not _looks_like_product_path(href):
                        continue
                else:
                    # Outbound link: must look product-shaped. The "container" heuristic
                    # alone is too noisy on curator pages (footers, help cards, etc.).
                    if not _looks_like_product_path(href):
                        continue
                    # Drop bare-domain outbound links ("/", "/home").
                    path = urlparse(href).path.strip("/")
                    if not path or path in {"home", "index"}:
                        continue
                filtered.append({"h": href, "t": l["t"]})
        else:
            # Normal same-domain crawl: drop the source tag and keep same-domain only.
            filtered = [{"h": l["h"], "t": l["t"]} for l in links if self.is_same_domain(l["h"])]
        return json.dumps({"product_links": filtered[:300]})

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
        "name": "hover_main_menu",
        "description": (
            "Hover each top-level navigation item to expose mega-menu dropdowns, "
            "then re-extract the now-visible links. Use on sites where the main nav "
            "only renders subcategories on hover (e.g. Alo Yoga, J.Crew)."
        ),
        "input_schema": {"type": "object", "properties": {}, "required": []},
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
- If the main navigation only shows top-level items (Women / Men / Sale), call hover_main_menu to reveal the mega-menu, then call get_navigation again
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
                elif tool_name == "hover_main_menu":
                    result_text = browser.hover_main_menu()
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
        "name": "auto_load_all",
        "description": (
            "Deterministically scrolls and clicks any 'Load more' / 'Next' buttons "
            "until all lazy-loaded products are revealed. Call this FIRST after visit_page "
            "— it handles infinite-scroll, pagination, and on-page totals automatically. "
            "Returns the final product link count."
        ),
        "input_schema": {"type": "object", "properties": {}, "required": []},
    },
    {
        "name": "get_product_links",
        "description": "Extract product-specific links from the page. Call AFTER auto_load_all.",
        "input_schema": {"type": "object", "properties": {}, "required": []},
    },
    {
        "name": "scroll_down",
        "description": "Manual scroll fallback if auto_load_all missed something. Prefer auto_load_all.",
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

## Strategy (do this in order)

1. visit_page(collection_url)
2. auto_load_all — this scrolls + clicks load-more until all products are loaded.
3. get_product_links — grab the full list now that everything is rendered.
4. save_product_urls with the full list.

If auto_load_all reports fewer products than expected, you may scroll_down a few more times and call get_product_links again. If the site uses true paginated URLs (e.g. ?page=2), visit those pages too.

## Rules

- Only save PRODUCT page URLs (not collection/category links).
- Keep page_title strings short (1-5 words).
- Stay on the same domain.
- It's fine to call save_product_urls multiple times — duplicates are ignored."""

PROFILE_SYSTEM = """You are a PROFILE sub-agent. Extract ALL product URLs from a curator / creator profile page.

The page (e.g. shopmy.us/<curator>, ltk.app, linktree, Instagram bio link,
Amazon storefront) shows many products the creator has linked to. Each product
link typically points OUT to a different brand's website — that is expected.

## Strategy

1. visit_page(profile_url)
2. auto_load_all — scrolls + clicks "load more" / tab buttons until every pin loads.
3. get_product_links — grab every product-like link (outbound links are fine here).
4. save_product_urls with the full list.

If the profile has tabs like "Shelves", "Latest Finds", "Most Popular", it's OK
to visit each one with visit_page before saving.

## Rules

- Save every link that looks like a product, including links that leave the profile domain.
- Skip social-media profile links (instagram.com/, tiktok.com/@, youtube.com/@) and the curator's own profile URL.
- Keep page_title strings short (1-5 words).
- It's fine to call save_product_urls multiple times — duplicates are ignored."""


def run_collection_subagent(
    site_url: str,
    collection_url: str,
    collection_name: str,
    max_pages: int = 10,
    cross_domain: bool = False,
) -> list[dict]:
    """
    Phase 2 sub-agent: Extract product URLs from a single collection.

    cross_domain=True is used for creator/curator profile pages where
    product links point to many external brand domains.

    Returns: [{"url": "...", "collection_name": "...", "page_title": "..."}, ...]
    """
    browser = BrowserAgent(site_url)
    browser.start()
    products: list[dict] = []

    try:
        client = anthropic.Anthropic()
        if cross_domain:
            system_prompt = PROFILE_SYSTEM
            user_prompt = (
                f"Extract every product URL from the curator profile '{collection_name}' at: {collection_url}\n"
                f"Visit the page, call auto_load_all, then get_product_links, then save_product_urls. "
                f"Outbound links to brand sites are EXPECTED — save them all."
            )
        else:
            system_prompt = COLLECTION_SYSTEM
            user_prompt = (
                f"Extract all product URLs from the '{collection_name}' collection at: {collection_url}\n"
                f"Visit the page, use get_product_links, scroll down, then call save_product_urls."
            )
        messages = [{"role": "user", "content": user_prompt}]

        for turn in range(MAX_COLLECTION_TURNS):
            response = _call_with_retry(
                client,
                model=COLLECTION_MODEL,
                max_tokens=8192,
                system=system_prompt,
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
                            if not url or url in seen:
                                continue
                            if not cross_domain and not browser.is_same_domain(url):
                                continue
                            if cross_domain and not url.startswith(("http://", "https://")):
                                continue
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
                    result_text = browser.get_product_links(cross_domain=cross_domain)
                elif tool_name == "get_page_links":
                    result_text = browser.get_page_links()
                elif tool_name == "scroll_down":
                    result_text = browser.scroll_down(tool_input.get("pixels", 800))
                elif tool_name == "auto_load_all":
                    result_text = browser.auto_load_all()
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
    Run the full site crawler with a sitemap-first strategy:
      1. Try to discover collections + products from sitemap.xml (deterministic, free).
      2. If sitemap yields collection pages, dispatch sub-agents to extract products from each.
      3. If sitemap yields products directly, save them as 'All Products'.
      4. If sitemap is unusable, fall back to the LLM coordinator + sub-agents.
    """
    print(f"=== Phase 0: Sitemap discovery on {site_url} ===")
    sitemap = discover_via_sitemap(site_url)
    print(f"  Sitemap visited: {sitemap['sitemaps_visited']}, "
          f"collections={len(sitemap['collections'])}, products={len(sitemap['products'])}")

    collections: list[dict] = list(sitemap["collections"])
    direct_products: list[dict] = list(sitemap["products"])

    # Phase 1: only run coordinator if sitemap didn't give us anything actionable
    if not collections and not direct_products:
        print(f"=== Phase 1: Coordinator discovery (sitemap empty) ===")
        collections = run_coordinator(site_url)

    if not collections and not direct_products:
        return {
            "success": False,
            "site_url": site_url,
            "collections_found": 0,
            "products": [],
            "pages_visited": 0,
            "error": "No collections/categories or sitemap discovered",
        }

    all_products: list[dict] = []
    seen_slugs: set[str] = set()

    # Seed with direct sitemap products (bucket as 'All Products')
    for p in direct_products:
        canonical = _normalize_product_url(p["url"])
        if canonical in seen_slugs:
            continue
        seen_slugs.add(canonical)
        all_products.append({
            "url": canonical,
            "collection_name": "All Products",
            "page_title": p.get("page_title", ""),
        })
        if len(all_products) >= MAX_PRODUCTS_HARD_LIMIT:
            break

    errors: list[str] = []

    if collections and len(all_products) < MAX_PRODUCTS_HARD_LIMIT:
        pages_per_collection = max(DEFAULT_PAGES_PER_COLLECTION, max_pages // max(len(collections), 1))
        print(f"\n=== Phase 2: Crawling {len(collections)} collections "
              f"({max_workers} workers, {pages_per_collection} pages each) ===")

        def _crawl_collection(coll: dict) -> tuple[list[dict], str | None]:
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

                    for p in products:
                        canonical = _normalize_product_url(p["url"])
                        if canonical in seen_slugs:
                            continue
                        seen_slugs.add(canonical)
                        p["url"] = canonical
                        # If we previously bucketed this URL under 'All Products' from
                        # the sitemap, the collection result wins (richer name).
                        all_products.append(p)
                        if len(all_products) >= MAX_PRODUCTS_HARD_LIMIT:
                            break

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
        "pages_visited": 0,
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
