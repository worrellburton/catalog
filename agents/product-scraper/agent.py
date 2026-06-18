#!/usr/bin/env python3
"""
Product Scraper Agent

A Claude AI agent that uses Playwright to visit product pages in a real browser,
visually inspect them via screenshots, extract structured data (title, brand, price,
discounted price, images, description, availability), and save the result as JSON
to Supabase Storage.

Usage:
    python agent.py "https://www.nike.com/t/air-force-1-07"
    python agent.py "https://www.zara.com/us/en/product/12345" --look-id abc-def
    python agent.py "https://www.amazon.com/dp/B0..." --no-save  # extract only, don't save
"""

import anthropic
import json
import base64
import re
import os
import random
import time
import argparse
import urllib.request
import urllib.error
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, Page, Browser
from dotenv import load_dotenv

load_dotenv()

# ─── Configuration ────────────────────────────────────────────────────

MODEL = "claude-sonnet-4-5-20250929"
# Hard cap on Claude turns. Real product pages are extracted in 2-4 turns;
# anything past 10 means the agent is wandering on a non-product page.
MAX_AGENT_TURNS = 12
MAX_HTML_LENGTH = 15_000
MAX_TEXT_LENGTH = 3_000
MAX_IMAGES_RETURN = 30

# Rate-limit retry config
MAX_RETRIES = 3
RETRY_DELAYS = [5, 15, 30]  # seconds

# ─── Tool definitions ────────────────────────────────────────────────

TOOLS = [
    {
        "name": "visit_page",
        "description": (
            "Navigate to a URL in the browser. Returns the page title, "
            "meta/Open Graph tags, JSON-LD structured data, and visible text content. "
            "Use this first to load the product page."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "url": {
                    "type": "string",
                    "description": "The full URL to navigate to",
                }
            },
            "required": ["url"],
        },
    },
    {
        "name": "get_page_html",
        "description": (
            "Get the HTML source of the current page (scripts/styles stripped). "
            "Useful for finding structured data, hidden prices, or details not in visible text."
        ),
        "input_schema": {
            "type": "object",
            "properties": {},
            "required": [],
        },
    },
    {
        "name": "get_all_images",
        "description": (
            "Get image candidates from the current page, returned as a JSON object: "
            "{\"canonical\": [...], \"page_images\": [...], \"page_url\": \"...\"}. "
            "`canonical` are the AUTHORITATIVE product images extracted from page metadata "
            "(og:image, twitter:image, JSON-LD Product.image, link rel=image_src). "
            "`page_images` are all other DOM <img> URLs (filtered for size/SVG/data-URIs and "
            "deduped against canonical). On aggregator pages (shopmy.us, ltk.app, linktree, "
            "beacons, stan.store, bio.link) `page_images` will be FULL of curator-uploaded "
            "user photos that are NOT the product \u2014 only `canonical` is reliable on those sites."
        ),
        "input_schema": {
            "type": "object",
            "properties": {},
            "required": [],
        },
    },
    {
        "name": "take_screenshot",
        "description": (
            "Take a visual screenshot of the current page. Use this to see the product "
            "as a real user would -- helpful for verifying prices, spotting sale badges, "
            "and identifying the correct product image."
        ),
        "input_schema": {
            "type": "object",
            "properties": {},
            "required": [],
        },
    },
    {
        "name": "scroll_down",
        "description": (
            "Scroll the page down one viewport to reveal more content. "
            "Product details, images, or descriptions may be below the fold."
        ),
        "input_schema": {
            "type": "object",
            "properties": {},
            "required": [],
        },
    },
    {
        "name": "get_variants",
        "description": (
            "Extract all product variants (sizes, colors, styles) from the current page. "
            "Parses variant selectors (dropdowns, radio buttons, swatches), JSON-LD "
            "Product.offers, and Shopify/structured product data. Returns an array of "
            "variant objects with size, color, availability, sku, and price info."
        ),
        "input_schema": {
            "type": "object",
            "properties": {},
            "required": [],
        },
    },
    {
        "name": "get_size_chart",
        "description": (
            "Find and extract size chart data from the current page. Looks for size chart "
            "tables in modals, accordions, tabs, and inline sections. Returns structured "
            "measurement data keyed by size label. Also checks for fit guide text."
        ),
        "input_schema": {
            "type": "object",
            "properties": {},
            "required": [],
        },
    },
    {
        "name": "save_product",
        "description": (
            "Save the final extracted product data. Call this once you have "
            "gathered all the product information from the page."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "title": {
                    "type": "string",
                    "description": "Product name/title",
                },
                "brand": {
                    "type": ["string", "null"],
                    "description": "Brand name",
                },
                "description": {
                    "type": ["string", "null"],
                    "description": "Product description (concise, 1-3 sentences)",
                },
                "price": {
                    "type": ["string", "null"],
                    "description": "Original/regular price with currency symbol, e.g. '$129.99'",
                },
                "discounted_price": {
                    "type": ["string", "null"],
                    "description": "Sale/discounted price if product is on sale, otherwise null",
                },
                "currency": {
                    "type": ["string", "null"],
                    "description": "ISO currency code, e.g. 'USD', 'EUR', 'GBP'",
                },
                "barcode": {
                    "type": ["string", "null"],
                    "description": (
                        "Product barcode / external identifier if present on the page or in "
                        "JSON-LD: an Amazon ASIN, or a UPC/EAN/GTIN "
                        "(schema.org Product.gtin13 / gtin12 / gtin). Digits only for "
                        "UPC/EAN/GTIN; the 10-char code for an ASIN. null if none is shown."
                    ),
                },
                "barcode_type": {
                    "type": ["string", "null"],
                    "enum": ["asin", "upc", "ean", "gtin", None],
                    "description": "Which kind of identifier `barcode` is, or null.",
                },
                "images": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Product image URLs (absolute), max 10",
                },
                "availability": {
                    "type": ["string", "null"],
                    "description": "Stock status: 'In Stock', 'Out of Stock', 'Limited', etc.",
                },
                "type": {
                    "type": ["string", "null"],
                    "description": (
                        "Product category/type: 'Shoes', 'Sneakers', 'Boots', 'Sandals', "
                        "'Top', 'Shirt', 'T-Shirt', 'Sweater', 'Hoodie', 'Jacket', 'Coat', "
                        "'Dress', 'Skirt', 'Pants', 'Jeans', 'Shorts', 'Leggings', "
                        "'Underwear', 'Bra', 'Socks', 'Hat', 'Cap', 'Beanie', "
                        "'Bag', 'Backpack', 'Handbag', 'Accessories', 'Jewelry', "
                        "'Watch', 'Sunglasses', 'Belt', 'Scarf', 'Gloves', "
                        "'Activewear', 'Swimwear', 'Sleepwear', 'Decor', 'Furniture', "
                        "'Book', 'Toy', 'Electronics', 'Beauty', 'Skincare', 'Haircare', "
                        "'Coffee', 'Food', 'Supplement', 'Other'"
                    ),
                },
                "gender": {
                    "type": ["string", "null"],
                    "description": "Target gender: 'male', 'female', or 'unisex'. Use null if uncertain.",
                },
                "size_fit": {
                    "type": ["string", "null"],
                    "description": (
                        "Size and fit details from the product page (e.g. 'Slim fit. Fits true to size. "
                        "Model is 6\'2\" wearing size medium.'). Include all bullet points from the "
                        "Size & Fit section, joined with '. '. Null if not found."
                    ),
                },
                "materials_care": {
                    "type": ["string", "null"],
                    "description": (
                        "Materials and care instructions from the product page (e.g. '75% wool, 25% lyocell. "
                        "Dry clean only. Imported.'). Include all bullet points from the Materials & Care "
                        "section, joined with '. '. Null if not found."
                    ),
                },
                "variants": {
                    "type": ["array", "null"],
                    "items": {
                        "type": "object",
                        "properties": {
                            "size": {"type": ["string", "null"]},
                            "color": {"type": ["string", "null"]},
                            "availability": {"type": ["boolean", "null"]},
                            "sku": {"type": ["string", "null"]},
                            "price_modifier": {"type": ["string", "null"],
                                "description": "Price if different from main price, e.g. '+$10' or '$139.99'"},
                        },
                    },
                    "description": (
                        "All product variants extracted from the page. Each variant is a "
                        "combination of size/color/style with its availability. Extract "
                        "from dropdowns, swatches, JSON-LD offers, or get_variants tool results."
                    ),
                },
                "size_chart": {
                    "type": ["object", "null"],
                    "description": (
                        "Parsed size chart keyed by size label. Each value is an object of "
                        "measurements in cm. Example: {\"M\": {\"chest_cm\": 102, \"waist_cm\": 86, "
                        "\"length_cm\": 72}, \"L\": {\"chest_cm\": 107, ...}}. Use get_size_chart "
                        "tool output or extract from visible tables. Convert inches to cm (×2.54). "
                        "Null if no size chart found."
                    ),
                },
                "materials_detail": {
                    "type": ["array", "null"],
                    "items": {
                        "type": "object",
                        "properties": {
                            "fiber": {"type": "string", "description": "Fiber/material name, e.g. 'cotton', 'polyester', 'wool'"},
                            "percentage": {"type": ["number", "null"], "description": "Percentage 0-100, null if not specified"},
                        },
                        "required": ["fiber"],
                    },
                    "description": (
                        "Parsed material composition from materials_care text. "
                        "Example: [{\"fiber\": \"cotton\", \"percentage\": 75}, {\"fiber\": \"polyester\", \"percentage\": 25}]. "
                        "Null if composition cannot be parsed."
                    ),
                },
                "product_category": {
                    "type": ["object", "null"],
                    "properties": {
                        "category": {"type": "string", "description": "Top-level: fashion, beauty, home, tech, lifestyle"},
                        "subcategory": {"type": "string", "description": "Specific: 'half zip sweater', 'slim fit jeans', 'running sneakers'"},
                        "style": {"type": ["string", "null"], "description": "Style descriptor: 'minimal luxury', 'streetwear', 'classic', 'bohemian'"},
                    },
                    "description": (
                        "Hierarchical product categorization. More specific than 'type'. "
                        "category is broad (fashion/beauty/home), subcategory is specific "
                        "(e.g. 'half zip sweater' not just 'Top'), style is the aesthetic."
                    ),
                },
            },
            "required": ["title", "images"],
        },
    },
]


# ─── Image URL helpers ────────────────────────────────────────────────

_IMAGE_CHECK_TIMEOUT = 10  # seconds per HTTP probe
_IMAGE_CHECK_WORKERS = 16
_IMAGE_CHECK_USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/120.0.0.0 Safari/537.36"
)

# CDN domains that are always publicly accessible -- skip the HTTP probe
# for these to avoid inconsistent results from slow CDN HEAD responses.
_TRUSTED_CDN_DOMAINS = (
    "cdn.shopify.com",
    "shopify.com",
    "cdn.shopifycdn.com",
    "res.cloudinary.com",
    "images.ctfassets.net",
    "cdn.sanity.io",
    "i.imgur.com",
    "images.squarespace-cdn.com",
    "cdn.pixelunion.net",
    "imagedelivery.net",  # Cloudflare Images
    "media.istockphoto.com",
    "images-na.ssl-images-amazon.com",
    "m.media-amazon.com",
    "cdn.media.amplience.net",
    "dam.northface.com",
    "cdn.prod.website-files.com",
    "framerusercontent.com",
)


# ─── URL pre-filter ───────────────────────────────────────────────────


_BLOCK_PATTERNS = (
    "access denied",
    "you don't have permission to access",
    "request blocked",
    "pardon our interruption",  # Distil
    "sorry, we just need to make sure",  # Amazon bot
    "to discuss automated access",  # Amazon
    "are you a robot",
    "captcha",
    "checking your browser before accessing",  # Cloudflare
    "ddos protection by cloudflare",
    "this website is using a security service to protect itself",  # Cloudflare
    "reference #",  # Akamai/CloudFront block reference id
    "akamai",
    "incapsula incident id",  # Imperva
    "perimeterx",
)


def _detect_block(status: int | None, title: str, body: str) -> str | None:
    """Return a short reason if the response looks like a bot-protection
    block page rather than a real product page; else None."""
    title_l = (title or "").lower()
    body_l = (body or "").lower()
    if status in (401, 403, 429, 503):
        return f"site returned HTTP {status} (likely bot-protection block)"
    if "access denied" in title_l or "access denied" in body_l[:300]:
        return "site returned an Access Denied page"
    for pat in _BLOCK_PATTERNS:
        if pat in body_l:
            return f"site returned a bot-protection page ({pat!r})"
    return None


def _non_product_url_reason(raw_url: str) -> str | None:
    """Cheap check that mirrors app/utils/productUrl.ts. Returns a reason
    string when the URL clearly isn't a product page so the agent can
    refuse before burning a Claude call."""
    if not raw_url:
        return "empty URL"
    try:
        parsed = urlparse(raw_url)
    except Exception:
        return "invalid URL"
    if parsed.scheme not in ("http", "https"):
        return "unsupported protocol"
    host = (parsed.hostname or "").lower()
    if host.startswith("www."):
        host = host[4:]
    path = (parsed.path or "").lower()

    if host == "google.com" or host.endswith(".google.com"):
        # Allow Google Shopping product detail pages -- they get resolved to
        # the underlying merchant URL before scraping (see resolve_google_shopping).
        # Two known product-detail URL shapes:
        #   1. /shopping/product/<id>
        #   2. /search?ibp=oshop&prds=... (single-product shopping panel)
        from urllib.parse import parse_qs
        qs = parse_qs(parsed.query)
        is_google_shopping_product = (
            path.startswith("/shopping/product/")
            or (path.startswith("/search") and qs.get("ibp") == ["oshop"] and "prds" in qs)
        )
        if is_google_shopping_product:
            pass
        elif path.startswith("/search") or path.startswith("/shopping"):
            return "Google search results page"
    if host in ("bing.com", "duckduckgo.com"):
        return "search engine page"
    if path in ("", "/"):
        return "site homepage"
    if path == "/search" or path.startswith("/search/") or path == "/s" or path.startswith("/s/"):
        if not (host == "google.com" or host.endswith(".google.com")):
            return f'non-product path "{path}"'
    if (host == "amazon.com" or host.endswith(".amazon.com")) and (
        "/dp/" not in path and "/gp/product/" not in path
    ):
        return "Amazon non-product page (no /dp/ in URL)"
    return None


def _is_image_url_accessible(url: str) -> bool:
    """Return True iff the URL responds publicly with an image content-type.

    Tries HEAD first; falls back to a 1-byte ranged GET for servers that reject
    HEAD (some CDNs return 405). Used to filter out private/signed URLs (e.g.
    aggregator S3 buckets that need cookies) before they get saved as the
    \"product image\".
    """
    if not url or not isinstance(url, str):
        return False
    if not url.startswith(("http://", "https://")):
        return False

    # Skip probe for well-known public CDNs -- they're always accessible
    # and slow HEAD checks cause intermittent false negatives.
    try:
        from urllib.parse import urlparse as _urlparse
        host = _urlparse(url).hostname or ""
        if any(host == d or host.endswith("." + d) for d in _TRUSTED_CDN_DOMAINS):
            return True
    except Exception:
        pass

    headers = {
        "User-Agent": _IMAGE_CHECK_USER_AGENT,
        "Accept": "image/*,*/*;q=0.8",
    }

    def _check(method: str, extra_headers: dict | None = None) -> bool:
        req_headers = dict(headers)
        if extra_headers:
            req_headers.update(extra_headers)
        req = urllib.request.Request(url, method=method, headers=req_headers)
        try:
            with urllib.request.urlopen(req, timeout=_IMAGE_CHECK_TIMEOUT) as resp:
                if resp.status >= 400:
                    return False
                ctype = (resp.headers.get("Content-Type") or "").lower()
                # Accept image/*; reject html/xml (S3 error responses) and empty.
                return ctype.startswith("image/")
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, ValueError):
            return False
        except Exception:
            return False

    if _check("HEAD"):
        return True
    # Some CDNs / S3-style endpoints reject HEAD -- try a tiny ranged GET.
    return _check("GET", {"Range": "bytes=0-0"})


def _filter_accessible_images(urls: list[str]) -> list[str]:
    """Run accessibility checks in parallel and return only public URLs (order preserved)."""
    if not urls:
        return []
    deduped = list(dict.fromkeys(urls))
    with ThreadPoolExecutor(max_workers=_IMAGE_CHECK_WORKERS) as pool:
        results = list(pool.map(_is_image_url_accessible, deduped))
    return [u for u, ok in zip(deduped, results) if ok]


def _upgrade_image_url(url: str) -> str:
    """Upgrade CDN image URLs to high-resolution versions.

    Handles Shopify CDN (cdn.shopify.com), Contentful, and other common
    patterns that use query-string or path-based size constraints.
    """
    from urllib.parse import urlparse, urlencode, parse_qs, urlunparse

    parsed = urlparse(url)
    params = parse_qs(parsed.query, keep_blank_values=True)

    # Shopify CDN: remove &width=250 or replace with large value
    if "cdn.shopify.com" in parsed.netloc or ".myshopify.com" in parsed.netloc:
        params.pop("width", None)
        params.pop("height", None)
        params.pop("crop", None)
        # Also handle Shopify path-based sizing: _250x250. or _250x.
        path = re.sub(r"_\d+x\d*\.", ".", parsed.path)
        new_query = urlencode({k: v[0] for k, v in params.items()})
        return urlunparse(parsed._replace(path=path, query=new_query))

    # Generic: strip width/height/w/h/size query params from any CDN
    size_params = {"width", "height", "w", "h", "size", "resize", "fit"}
    if any(k.lower() in size_params for k in params):
        for k in list(params):
            if k.lower() in size_params:
                del params[k]
        new_query = urlencode({k: v[0] for k, v in params.items()})
        return urlunparse(parsed._replace(query=new_query))

    return url


# ─── Browser session ─────────────────────────────────────────────────


class BrowserSession:
    """Manages a headless Chromium browser via Playwright.

    Options:
        use_stealth: when True, drives a Patchright-patched Chromium that hides
            the automation fingerprints Akamai/Cloudflare detect. Used as an
            automatic fallback after a SITE_BLOCKED first attempt.
        proxy: optional dict {"server": "...", "username": "...", "password": "..."}
            forwarded to chromium.launch(proxy=...). Use a US residential proxy
            for sites that block datacenter IPs (Reiss / Akamai, Amazon, etc.).
    """

    def __init__(self, use_stealth: bool = False, proxy: dict | None = None):
        self._pw = None
        self.browser: Browser | None = None
        self.context = None
        self.page: Page | None = None
        self.use_stealth = use_stealth
        self.proxy = proxy
        self._using_patchright = False

    def start(self):
        # For the bot-blocked retry (use_stealth=True), drive a Patchright
        # Chromium instead of vanilla Playwright. Patchright removes the
        # automation tells Akamai/Cloudflare sensors fingerprint — the CDP
        # Runtime.enable leak, navigator.webdriver, console.debug hooks — far
        # more thoroughly than playwright-stealth (which Akamai already
        # detects). Falls back to vanilla Chromium if patchright isn't present.
        sync_pw = sync_playwright
        self._using_patchright = False
        if self.use_stealth:
            try:
                from patchright.sync_api import sync_playwright as _patchright_sync  # type: ignore
                sync_pw = _patchright_sync
                self._using_patchright = True
                print("  🛡️  using Patchright stealth browser")
            except ImportError:
                print("  ⚠️  use_stealth=True but patchright is not installed; using vanilla Chromium")
        self._pw = sync_pw().start()
        launch_kwargs = dict(
            headless=True,
            args=[
                "--disable-blink-features=AutomationControlled",
                "--no-sandbox",
                "--disable-dev-shm-usage",
            ],
        )
        if self.proxy:
            launch_kwargs["proxy"] = self.proxy
        self.browser = self._pw.chromium.launch(**launch_kwargs)
        # Use a full browser context so we can pin locale/timezone/geolocation
        # to the United States. Without this, sites that geo-detect via IP
        # (Reiss, Zara, H&M, Adidas, etc.) return EUR / GBP / INR pricing
        # depending on where the Modal worker happens to run.
        self.context = self.browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0.0.0 Safari/537.36"
            ),
            viewport={"width": 1280, "height": 900},
            locale="en-US",
            timezone_id="America/New_York",
            geolocation={"latitude": 40.7128, "longitude": -74.0060},  # NYC
            permissions=["geolocation"],
            extra_http_headers={
                "Accept-Language": "en-US,en;q=0.9",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
                "Accept-Encoding": "gzip, deflate, br",
                "Sec-Fetch-Dest": "document",
                "Sec-Fetch-Mode": "navigate",
                "Sec-Fetch-Site": "none",
                "Sec-Fetch-User": "?1",
                "Upgrade-Insecure-Requests": "1",
                # Cloudflare / Akamai forward this to origin; some merchants
                # use it as a hint for currency selection.
                "CF-IPCountry": "US",
            },
        )
        # Pre-seed currency / country cookies for merchants that store the
        # locale on the cookie jar instead of the URL. Harmless on sites
        # that don't read these names.
        self.context.add_cookies([
            {"name": "currency", "value": "USD", "domain": ".reiss.com", "path": "/"},
            {"name": "country", "value": "US", "domain": ".reiss.com", "path": "/"},
            {"name": "currency", "value": "USD", "domain": ".zara.com", "path": "/"},
            {"name": "preferredCountry", "value": "US", "domain": ".hm.com", "path": "/"},
            {"name": "i18n_redirected", "value": "en-us", "domain": ".adidas.com", "path": "/"},
        ])
        self.page = self.context.new_page()
        # Patchright patches navigator.webdriver / plugins / chrome natively and
        # consistently; layering our own init-script overrides on top would
        # create the kind of property inconsistencies Akamai's sensor flags. So
        # only apply the manual fingerprint shim on the vanilla-Chromium path.
        if not self._using_patchright:
            self.page.add_init_script("""
                Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
                Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3] });
                Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
                window.chrome = { runtime: {} };
            """)

    def stop(self):
        if self.browser:
            self.browser.close()
        if self._pw:
            self._pw.stop()

    # ── Tools ──

    def visit(self, url: str) -> dict:
        response = self.page.goto(url, wait_until="domcontentloaded", timeout=60_000)
        self.page.wait_for_timeout(3000)  # let JS render

        # Detect bot-protection / access-denied responses up front so the
        # agent doesn't waste turns trying to extract a product from an
        # Akamai / Cloudflare / Imperva block page (which has no product
        # data and would otherwise be misclassified as NOT_A_PRODUCT_PAGE).
        status = response.status if response is not None else None
        title = self.page.title()
        body_snippet = ""
        try:
            body_snippet = self.page.evaluate(
                "() => (document.body && document.body.innerText || '').slice(0, 800)"
            )
        except Exception:
            pass
        block_reason = _detect_block(status, title, body_snippet)
        if block_reason:
            raise RuntimeError(
                f"SITE_BLOCKED: {block_reason} (HTTP {status}) at {self.page.url}"
            )

        meta = self.page.evaluate(
            """() => {
            const get = (n) => {
                const el = document.querySelector(
                    `meta[property="${n}"], meta[name="${n}"]`
                );
                return el ? el.getAttribute('content') : null;
            };
            return {
                description: get('description') || get('og:description'),
                og_title: get('og:title'),
                og_image: get('og:image'),
                og_price: get('og:price:amount') || get('product:price:amount'),
                og_currency: get('og:price:currency') || get('product:price:currency'),
                og_availability: get('og:availability') || get('product:availability'),
                og_brand: get('og:brand') || get('product:brand'),
            };
        }"""
        )

        json_ld = self.page.evaluate(
            """() => {
            const scripts = document.querySelectorAll('script[type="application/ld+json"]');
            return Array.from(scripts).map(s => s.textContent).filter(Boolean);
        }"""
        )

        text_content = self.page.evaluate(
            f"""() => document.body.innerText.substring(0, {MAX_TEXT_LENGTH})"""
        )

        return {
            "title": title,
            "meta": meta,
            "json_ld": json_ld[:3],
            "text_content": text_content,
        }

    def get_html(self) -> str:
        html = self.page.content()
        html = re.sub(
            r"<(script|style|svg|noscript)[^>]*>[\s\S]*?</\1>",
            "",
            html,
            flags=re.IGNORECASE,
        )
        html = re.sub(r"<!--[\s\S]*?-->", "", html)
        html = re.sub(r"\s{2,}", " ", html)
        return html[:MAX_HTML_LENGTH]

    def get_images(self) -> dict:
        """Return categorised image candidates.

        Returns:
            {
              "canonical": [...],   # og:image + JSON-LD Product.image \u2014 authoritative
              "page_images": [...], # everything else found in the DOM (carousel, gallery)
              "page_url": "...",
            }

        On aggregator/affiliate pages (shopmy.us, ltk.app, linktree, beacons, etc.) the
        DOM is full of curator-uploaded photos that look like product images but aren't.
        Splitting them keeps the canonical product image obvious to the agent.
        """
        canonical = self.page.evaluate(
            """() => {
            const out = [];
            const seen = new Set();
            const push = (u) => {
                if (!u || typeof u !== 'string') return;
                if (u.startsWith('data:')) return;
                if (seen.has(u)) return;
                seen.add(u);
                out.push(u);
            };

            // OpenGraph / Twitter card images
            const get = (n) => {
                const el = document.querySelector(
                    `meta[property="${n}"], meta[name="${n}"]`
                );
                return el ? el.getAttribute('content') : null;
            };
            push(get('og:image'));
            push(get('og:image:secure_url'));
            push(get('twitter:image'));
            push(get('twitter:image:src'));

            // <link rel="image_src">
            const linkImg = document.querySelector('link[rel="image_src"]');
            if (linkImg) push(linkImg.getAttribute('href'));

            // JSON-LD Product.image (string OR array OR ImageObject), incl. @graph
            const scripts = document.querySelectorAll('script[type="application/ld+json"]');
            scripts.forEach(s => {
                try {
                    const data = JSON.parse(s.textContent);
                    const roots = Array.isArray(data) ? data : [data];
                    roots.forEach(root => {
                        const items = root && root['@graph'] ? root['@graph'] : [root];
                        items.forEach(item => {
                            if (!item || !item.image) return;
                            const imgs = Array.isArray(item.image) ? item.image : [item.image];
                            imgs.forEach(im => {
                                if (typeof im === 'string') push(im);
                                else if (im && im.url) push(im.url);
                                else if (im && im['@id']) push(im['@id']);
                            });
                        });
                    });
                } catch (_) {}
            });

            const base = window.location.origin;
            return out.map(u => { try { return new URL(u, base).href; } catch { return u; } });
        }"""
        )

        images = self.page.evaluate(
            """() => {
            const imgs = document.querySelectorAll('img');
            const base = window.location.origin;
            return Array.from(imgs)
                .map(img => ({
                    src: img.src || 
                         img.dataset.src || 
                         img.dataset.lazySrc ||
                         img.dataset.original ||
                         img.dataset.srcset?.split(',')[0]?.trim().split(/\\s+/)[0] ||
                         '',
                    w: img.naturalWidth || img.width || 0,
                    h: img.naturalHeight || img.height || 0,
                }))
                .filter(i => {
                    if (!i.src || i.src.startsWith('data:')) return false;
                    if (i.src.endsWith('.svg')) return false;
                    if (i.w > 0 && i.w < 50) return false;
                    if (i.h > 0 && i.h < 50) return false;
                    return true;
                })
                .map(i => { try { return new URL(i.src, base).href; } catch { return i.src; } });
        }"""
        )

        srcset = self.page.evaluate(
            """() => {
            const srcs = document.querySelectorAll('picture source, img[srcset]');
            const base = window.location.origin;
            const results = [];
            srcs.forEach(s => {
                const pairs = (s.getAttribute('srcset') || '').split(',')
                    .map(p => p.trim().split(/\\s+/))
                    .filter(p => p[0])
                    .map(p => ({
                        url: p[0],
                        w: parseInt((p[1] || '0').replace('w', '')) || 0,
                    }));
                if (pairs.length > 0) {
                    pairs.sort((a, b) => b.w - a.w);
                    try { results.push(new URL(pairs[0].url, base).href); }
                    catch { results.push(pairs[0].url); }
                }
            });
            return results;
        }"""
        )

        canonical_upgraded = [_upgrade_image_url(u) for u in canonical]
        canonical_set = set(canonical_upgraded)

        all_dom = list(dict.fromkeys(srcset + images))  # srcset first (higher-res)
        page_images = [
            _upgrade_image_url(u) for u in all_dom
            if _upgrade_image_url(u) not in canonical_set
        ][:MAX_IMAGES_RETURN]

        # Filter to only publicly-accessible URLs. Aggregator pages (shopmy.us,
        # ltk.app, etc.) often serve images from PRIVATE S3 buckets via signed
        # cookies -- those URLs render in the browser but return 403 to anyone
        # without the session, making them useless for downstream consumers.
        canonical_public = _filter_accessible_images(canonical_upgraded)
        page_images_public = _filter_accessible_images(page_images)

        return {
            "canonical": canonical_public,
            "page_images": page_images_public,
            "page_url": self.page.url,
            "note": (
                "All URLs above have been verified public (HTTP 200, content-type image/*). "
                "Private/inaccessible URLs from the page metadata have been filtered out."
            ),
        }

    def screenshot(self) -> bytes:
        return self.page.screenshot(type="png", full_page=False)

    def scroll_down(self):
        self.page.evaluate("window.scrollBy(0, window.innerHeight)")
        self.page.wait_for_timeout(1000)

    def get_variants(self) -> dict:
        """Extract product variants from dropdowns, swatches, JSON-LD, and Shopify data."""
        return self.page.evaluate(
            """() => {
            const variants = [];
            const seen = new Set();
            const addVariant = (v) => {
                const key = JSON.stringify(v);
                if (seen.has(key)) return;
                seen.add(key);
                variants.push(v);
            };

            // 1. JSON-LD Product.offers
            const scripts = document.querySelectorAll('script[type="application/ld+json"]');
            scripts.forEach(s => {
                try {
                    const data = JSON.parse(s.textContent);
                    const roots = Array.isArray(data) ? data : [data];
                    roots.forEach(root => {
                        const items = root && root['@graph'] ? root['@graph'] : [root];
                        items.forEach(item => {
                            if (!item) return;
                            const offers = item.offers
                                ? (Array.isArray(item.offers) ? item.offers : [item.offers])
                                : [];
                            offers.forEach(offer => {
                                if (offer['@type'] === 'AggregateOffer' && offer.offers) {
                                    const subOffers = Array.isArray(offer.offers)
                                        ? offer.offers : [offer.offers];
                                    subOffers.forEach(so => {
                                        addVariant({
                                            size: so.name || so.sku || null,
                                            color: null,
                                            availability: so.availability
                                                ? !so.availability.includes('OutOfStock') : null,
                                            sku: so.sku || null,
                                            price_modifier: so.price ? String(so.price) : null,
                                        });
                                    });
                                } else {
                                    addVariant({
                                        size: offer.name || offer.sku || null,
                                        color: null,
                                        availability: offer.availability
                                            ? !offer.availability.includes('OutOfStock') : null,
                                        sku: offer.sku || null,
                                        price_modifier: offer.price ? String(offer.price) : null,
                                    });
                                }
                            });
                        });
                    });
                } catch (_) {}
            });

            // 2. Shopify product JSON (window.ShopifyAnalytics or meta tag)
            try {
                const shopifyMeta = document.querySelector('script#ProductJson-product-template, script[data-product-json]');
                if (shopifyMeta) {
                    const product = JSON.parse(shopifyMeta.textContent);
                    if (product && product.variants) {
                        product.variants.forEach(v => {
                            addVariant({
                                size: v.option1 || v.title || null,
                                color: v.option2 || null,
                                availability: v.available != null ? v.available : null,
                                sku: v.sku || null,
                                price_modifier: v.price ? ('$' + (v.price / 100).toFixed(2)) : null,
                            });
                        });
                    }
                }
            } catch (_) {}

            // 3. Select dropdowns with size-like options
            const selects = document.querySelectorAll('select');
            selects.forEach(sel => {
                const label = (sel.getAttribute('aria-label') || sel.name || sel.id || '').toLowerCase();
                const isSize = /size|taille|größe|talla/i.test(label);
                const isColor = /color|colour|colou?r|farbe/i.test(label);
                if (!isSize && !isColor) return;
                Array.from(sel.options).forEach(opt => {
                    if (!opt.value || opt.value === '' || opt.disabled) return;
                    const text = opt.textContent.trim();
                    if (!text || /select|choose|pick/i.test(text)) return;
                    const v = {
                        size: isSize ? text : null,
                        color: isColor ? text : null,
                        availability: !opt.disabled && !/(sold out|unavailable|out of stock)/i.test(text),
                        sku: null,
                        price_modifier: null,
                    };
                    addVariant(v);
                });
            });

            // 4. Radio buttons / swatches for size/color
            const radios = document.querySelectorAll('input[type="radio"]');
            radios.forEach(r => {
                const name = (r.name || r.getAttribute('data-option-name') || '').toLowerCase();
                const isSize = /size/i.test(name);
                const isColor = /color|colour/i.test(name);
                if (!isSize && !isColor) return;
                const val = r.value || r.getAttribute('aria-label') || '';
                if (!val) return;
                addVariant({
                    size: isSize ? val : null,
                    color: isColor ? val : null,
                    availability: !r.disabled,
                    sku: null,
                    price_modifier: null,
                });
            });

            // 5. Button swatches (common pattern: <button data-value="M">M</button>)
            const swatchBtns = document.querySelectorAll(
                '[data-option-name] button, [class*="swatch"] button, [class*="variant"] button, [class*="size-selector"] button'
            );
            swatchBtns.forEach(btn => {
                const container = btn.closest('[data-option-name]') || btn.closest('[class*="swatch"]');
                const optName = (container?.getAttribute('data-option-name') || container?.className || '').toLowerCase();
                const isSize = /size/i.test(optName);
                const isColor = /color|colour/i.test(optName);
                const val = btn.getAttribute('data-value') || btn.textContent.trim();
                if (!val || val.length > 30) return;
                addVariant({
                    size: isSize ? val : null,
                    color: isColor ? val : null,
                    availability: !btn.disabled && !btn.classList.contains('sold-out')
                        && !btn.classList.contains('unavailable'),
                    sku: null,
                    price_modifier: null,
                });
            });

            return {variants: variants.slice(0, 100), count: variants.length};
        }"""
        )

    def get_size_chart(self) -> dict:
        """Find and extract size chart tables from modals, accordions, and inline content."""
        return self.page.evaluate(
            """() => {
            const result = {size_chart: null, fit_guide_text: null, source: null};

            // Helper: parse a <table> element into {sizeLabel: {measurement: value}}
            const parseTable = (table) => {
                const rows = Array.from(table.querySelectorAll('tr'));
                if (rows.length < 2) return null;

                const headers = Array.from(rows[0].querySelectorAll('th, td'))
                    .map(c => c.textContent.trim().toLowerCase());
                if (headers.length < 2) return null;

                // Detect orientation: sizes in first column vs sizes in header row
                const sizePatterns = /^(xxs|xs|s|m|l|xl|xxl|xxxl|2xl|3xl|4xl|5xl|\\d{1,2}|\\d{2}[.-]\\d{2}|one size|os|free)$/i;
                const sizesInHeaders = headers.slice(1).some(h => sizePatterns.test(h));

                const chart = {};

                if (sizesInHeaders) {
                    // Sizes are column headers, measurements are row labels
                    const sizeLabels = headers.slice(1);
                    for (let r = 1; r < rows.length; r++) {
                        const cells = Array.from(rows[r].querySelectorAll('td, th'));
                        const measureName = (cells[0]?.textContent || '').trim().toLowerCase()
                            .replace(/[^a-z0-9 ]/g, '').replace(/\\s+/g, '_');
                        if (!measureName) continue;
                        for (let c = 1; c < cells.length && c <= sizeLabels.length; c++) {
                            const val = parseFloat(cells[c]?.textContent?.replace(/[^0-9.]/g, '') || '');
                            if (isNaN(val)) continue;
                            const sizeKey = sizeLabels[c - 1].toUpperCase();
                            if (!chart[sizeKey]) chart[sizeKey] = {};
                            chart[sizeKey][measureName + '_cm'] = val;
                        }
                    }
                } else {
                    // Sizes are in the first column, measurements are headers
                    const measureNames = headers.slice(1).map(h =>
                        h.replace(/[^a-z0-9 ]/g, '').replace(/\\s+/g, '_')
                    );
                    for (let r = 1; r < rows.length; r++) {
                        const cells = Array.from(rows[r].querySelectorAll('td, th'));
                        const sizeLabel = (cells[0]?.textContent || '').trim().toUpperCase();
                        if (!sizeLabel || !sizePatterns.test(sizeLabel)) continue;
                        chart[sizeLabel] = {};
                        for (let c = 1; c < cells.length && c <= measureNames.length; c++) {
                            const val = parseFloat(cells[c]?.textContent?.replace(/[^0-9.]/g, '') || '');
                            if (!isNaN(val) && measureNames[c - 1]) {
                                chart[sizeLabel][measureNames[c - 1] + '_cm'] = val;
                            }
                        }
                    }
                }

                return Object.keys(chart).length > 0 ? chart : null;
            };

            // Strategy 1: Find size chart tables in visible DOM
            const tables = document.querySelectorAll('table');
            for (const table of tables) {
                const ctx = (table.closest('[class*="size"]') || table.closest('[id*="size"]')
                    || table.closest('[data-testid*="size"]') || table.parentElement);
                const ctxText = (ctx?.className || '') + ' ' + (ctx?.id || '');
                if (/size[-_ ]?(chart|guide|table|fit)/i.test(ctxText)
                    || /measurement/i.test(ctxText)) {
                    const parsed = parseTable(table);
                    if (parsed) {
                        result.size_chart = parsed;
                        result.source = 'html_table';
                        break;
                    }
                }
            }

            // Strategy 2: If not found by context, try all tables with size-like content
            if (!result.size_chart) {
                for (const table of tables) {
                    const text = table.textContent.toLowerCase();
                    if (/(chest|bust|waist|hip|length|shoulder|inseam|sleeve)/i.test(text)) {
                        const parsed = parseTable(table);
                        if (parsed) {
                            result.size_chart = parsed;
                            result.source = 'html_table_fuzzy';
                            break;
                        }
                    }
                }
            }

            // Strategy 3: Look for size chart data in hidden modals / dialog elements
            if (!result.size_chart) {
                const modals = document.querySelectorAll(
                    '[class*="size-chart"] table, [class*="size-guide"] table, '
                    + '[id*="size-chart"] table, [id*="size-guide"] table, '
                    + 'dialog table, [role="dialog"] table'
                );
                for (const table of modals) {
                    const parsed = parseTable(table);
                    if (parsed) {
                        result.size_chart = parsed;
                        result.source = 'modal_table';
                        break;
                    }
                }
            }

            // Extract fit guide text (separate from size chart)
            const fitSections = document.querySelectorAll(
                '[class*="fit-guide"], [class*="fit_guide"], [class*="size-fit"], '
                + '[data-testid*="fit"], [id*="fit-guide"], [id*="size-fit"]'
            );
            for (const sec of fitSections) {
                const text = sec.textContent.trim();
                if (text.length > 20 && text.length < 2000) {
                    result.fit_guide_text = text.replace(/\\s+/g, ' ').slice(0, 500);
                    break;
                }
            }

            return result;
        }"""
        )

    def resolve_google_shopping(self, url: str) -> str:
        """Navigate to a Google Shopping product page and return the actual
        merchant product URL (the "Most popular" / first buying option).

        Google Shopping pages list multiple merchants in the right-hand
        "Buying options" panel. Each offer links out to the merchant's
        product page \u2014 sometimes directly, sometimes through a Google
        redirect (/url?q=, /aclk?). This method follows the first viable
        offer and returns the final resolved merchant URL.
        """
        self.page.goto(url, wait_until="domcontentloaded", timeout=60_000)
        self.page.wait_for_timeout(3000)

        candidate = self.page.evaluate(
            """() => {
            const isOffsite = (h) => {
                if (!h) return false;
                if (h.startsWith('/url?') || h.startsWith('/aclk?')) return true;
                try {
                    const u = new URL(h, location.href);
                    if (!u.protocol.startsWith('http')) return false;
                    if (u.hostname.endsWith('google.com')) {
                        return u.pathname === '/url' || u.pathname === '/aclk';
                    }
                    return true;
                } catch { return false; }
            };
            const priceRe = /[\\$£€¥]\\s?\\d/;
            const blocklist = ['terms', 'privacy', 'help', 'feedback',
                'sign in', 'about', 'sponsored', 'ads by google',
                'send feedback', 'how search works'];
            const anchors = Array.from(document.querySelectorAll('a[href]'));
            const candidates = [];
            for (const a of anchors) {
                const href = a.getAttribute('href') || '';
                if (!isOffsite(href)) continue;
                const txt = (a.innerText || '').toLowerCase().trim();
                if (blocklist.some(b => txt === b)) continue;
                const rect = a.getBoundingClientRect();
                if (rect.width < 5 || rect.height < 5) continue;
                // Must have price text within 5 ancestors -- filters out
                // page chrome (header/footer/nav) and keeps only real offer cards.
                let el = a;
                let depth = -1;
                for (let i = 0; i < 6 && el; i++) {
                    if (priceRe.test(el.innerText || '')) { depth = i; break; }
                    el = el.parentElement;
                }
                if (depth < 0) continue;
                candidates.push({ href: a.href, depth, top: rect.top });
            }
            // Prefer the offer closest to the price text, then highest in
            // viewport (Google lists "Most popular" first).
            candidates.sort((a, b) => a.depth - b.depth || a.top - b.top);
            return candidates[0]?.href || null;
        }"""
        )

        if not candidate:
            raise RuntimeError(
                f"Could not find a merchant offer link on Google Shopping page: {url}"
            )

        # If the candidate is already a direct merchant URL (not a Google
        # redirect), return it without navigating -- many merchant sites
        # (e.g. shop.lululemon.com) reject Playwright with HTTP2 protocol
        # errors, but we already have the canonical URL we need.
        candidate_host = (urlparse(candidate).hostname or "").lower()
        is_google_redirect = (
            "google.com" in candidate_host
            and ("/url" in candidate or "/aclk" in candidate)
        )
        if not is_google_redirect:
            return candidate

        # Follow Google's /url? or /aclk? redirect to resolve the real
        # merchant URL.
        try:
            self.page.goto(candidate, wait_until="domcontentloaded", timeout=60_000)
            self.page.wait_for_timeout(2000)
        except Exception as e:
            # Navigation failed (often HTTP2 / bot protection on the merchant
            # site). Fall back to the candidate URL if it already resolved
            # away from google.com via the redirect chain.
            current_url = self.page.url
            current_host = (urlparse(current_url).hostname or "").lower()
            if current_url and "google.com" not in current_host:
                return current_url
            raise RuntimeError(
                f"Failed to follow Google Shopping merchant link {candidate}: {e}"
            )

        final_url = self.page.url
        final_host = (urlparse(final_url).hostname or "").lower()
        if not final_url or "google.com" in final_host:
            raise RuntimeError(
                f"Google Shopping link did not resolve to a merchant URL "
                f"(landed on {final_url})"
            )
        return final_url


def _is_google_shopping_url(raw_url: str) -> bool:
    """True iff the URL is a Google Shopping product detail page.

    Handles two URL shapes:
      1. /shopping/product/<id>
      2. /search?ibp=oshop&prds=...
    """
    from urllib.parse import parse_qs
    try:
        parsed = urlparse(raw_url)
    except Exception:
        return False
    host = (parsed.hostname or "").lower()
    if host.startswith("www."):
        host = host[4:]
    if host != "google.com" and not host.endswith(".google.com"):
        return False
    path = parsed.path or ""
    if path.startswith("/shopping/product/"):
        return True
    if path.startswith("/search"):
        qs = parse_qs(parsed.query)
        return qs.get("ibp") == ["oshop"] and "prds" in qs
    return False


# ─── Tool execution ──────────────────────────────────────────────────


def execute_tool(browser: BrowserSession, name: str, input: dict) -> list:
    """Run a tool call and return content blocks for the tool_result message."""

    if name == "visit_page":
        result = browser.visit(input["url"])
        # Truncate JSON-LD to keep tokens manageable
        if result.get("json_ld"):
            result["json_ld"] = [ld[:3000] for ld in result["json_ld"][:2]]
        return [{"type": "text", "text": json.dumps(result, indent=2, default=str)}]

    if name == "get_page_html":
        return [{"type": "text", "text": browser.get_html()}]

    if name == "get_all_images":
        imgs = browser.get_images()
        return [{"type": "text", "text": json.dumps(imgs, indent=2)}]

    if name == "take_screenshot":
        png = browser.screenshot()
        b64 = base64.b64encode(png).decode("utf-8")
        return [
            {
                "type": "image",
                "source": {"type": "base64", "media_type": "image/png", "data": b64},
            }
        ]

    if name == "scroll_down":
        browser.scroll_down()
        return [{"type": "text", "text": "Scrolled down one viewport."}]

    if name == "get_variants":
        result = browser.get_variants()
        return [{"type": "text", "text": json.dumps(result, indent=2)}]

    if name == "get_size_chart":
        result = browser.get_size_chart()
        return [{"type": "text", "text": json.dumps(result, indent=2)}]

    if name == "save_product":
        return [{"type": "text", "text": "Product data received. Saving…"}]

    return [{"type": "text", "text": f"Unknown tool: {name}"}]


def _trim_old_tool_results(messages: list):
    """Replace large tool results from earlier turns with summaries.

    Keeps only the last 2 user messages with tool_results intact.
    Older tool_result image blocks are dropped and large text blocks
    are truncated.  This prevents the conversation from ballooning
    to hundreds of thousands of tokens across many turns.
    """
    KEEP_RECENT = 2  # keep the N most-recent tool-result messages untouched
    TEXT_TRIM_THRESHOLD = 2_000

    # Find indices of user messages that contain tool_result blocks
    tool_result_indices = []
    for i, msg in enumerate(messages):
        if msg.get("role") == "user" and isinstance(msg.get("content"), list):
            if any(isinstance(b, dict) and b.get("type") == "tool_result" for b in msg["content"]):
                tool_result_indices.append(i)

    # Only trim older ones, keep the most recent KEEP_RECENT
    indices_to_trim = tool_result_indices[:-KEEP_RECENT] if len(tool_result_indices) > KEEP_RECENT else []

    for idx in indices_to_trim:
        msg = messages[idx]
        trimmed_content = []
        for block in msg["content"]:
            if not isinstance(block, dict) or block.get("type") != "tool_result":
                trimmed_content.append(block)
                continue

            new_inner = []
            for inner in block.get("content", []):
                if isinstance(inner, dict) and inner.get("type") == "image":
                    # Drop old screenshots entirely
                    new_inner.append({"type": "text", "text": "[screenshot -- trimmed from history]"})
                elif isinstance(inner, dict) and inner.get("type") == "text":
                    text = inner["text"]
                    if len(text) > TEXT_TRIM_THRESHOLD:
                        new_inner.append({"type": "text", "text": text[:TEXT_TRIM_THRESHOLD] + "\n…[truncated]"})
                    else:
                        new_inner.append(inner)
                else:
                    new_inner.append(inner)

            block["content"] = new_inner
            trimmed_content.append(block)
        msg["content"] = trimmed_content


# ─── Supabase storage ────────────────────────────────────────────────


def save_to_supabase(
    product: dict, product_url: str, look_id: str | None = None
) -> dict:
    sb_url = os.environ.get("SUPABASE_URL", "")
    sb_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")

    if not sb_url or not sb_key:
        return {"saved": False, "error": "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set"}

    from supabase import create_client

    supabase = create_client(sb_url, sb_key)

    try:
        domain = urlparse(product_url).hostname.replace("www.", "")
    except Exception:
        domain = "unknown"

    safe = re.sub(r"[^a-zA-Z0-9.\-]", "_", domain)
    ts = int(datetime.now(timezone.utc).timestamp() * 1000)

    path = f"looks/{look_id}/{safe}_{ts}.json" if look_id else f"products/{safe}_{ts}.json"
    blob = json.dumps(product, indent=2).encode("utf-8")

    supabase.storage.from_("scraped-products").upload(
        path, blob, {"content-type": "application/json"}
    )

    public_url = supabase.storage.from_("scraped-products").get_public_url(path)
    return {"saved": True, "path": path, "public_url": public_url}


# ─── Agent loop ───────────────────────────────────────────────────────

SYSTEM_PROMPT = """\
You are a product data extraction agent. You control a real browser.
Your job is to visit a product page, inspect it, and extract COMPREHENSIVE structured
product data — not just the basics, but variants, size charts, materials breakdown,
and categorization that helps users make purchasing decisions.

Workflow:
1. visit_page -- load the URL and read metadata / JSON-LD / visible text
2. take_screenshot -- visually inspect the page to verify prices, sale badges, etc.
3. get_all_images -- collect product image URLs
4. get_variants -- extract all sizes, colors, and variant combinations
5. get_size_chart -- find and parse size chart tables with measurements
6. (optional) get_page_html -- if prices or details are missing from step 1
7. (optional) scroll_down + take_screenshot -- if content is below the fold
8. save_product -- once all data is gathered, call this with the final values

Rules:
- Extract ACTUAL data from the page. Never guess or fabricate.
- Include currency symbols in price strings (e.g. "$129.99").
- If there is both an original price and a sale/discounted price, capture both.
- **ALWAYS extract product type and gender** for quality scoring:
  * TYPE: categorize as specifically as possible (e.g., "Sneakers" not "Shoes",
    "Hoodie" not "Top", "Jeans" not "Pants" when applicable)
  * GENDER: infer from product name, description, URL, or visual cues. Use 'male',
    'female', or 'unisex'. If truly uncertain, use null.
- IMAGE SELECTION (strict):
  * `get_all_images` returns `{ canonical: [...], page_images: [...] }`.
    Every URL it returns has ALREADY been verified as publicly accessible
    (HTTP 200 with image content-type). URLs that would return 403/private
    have been pre-filtered out -- do NOT use any image URL that you saw
    elsewhere (visit_page metadata, get_page_html) but that is missing from
    `get_all_images`, because that means it isn't public.
  * `canonical` images come from the page's OWN metadata (og:image, JSON-LD
    Product.image). They are the authoritative product photos -- ALWAYS prefer
    them. If `canonical` is non-empty, use ONLY `canonical` images unless the
    screenshot clearly shows additional product angles you can match in
    `page_images`.
  * On aggregator / affiliate / link-in-bio pages -- shopmy.us, ltk.app,
    liketoknow.it, linktree, beacons.ai, stan.store, bio.link, koji.to,
    snipfeed, withkoji -- `page_images` is full of CURATOR-UPLOADED user
    photos showing people using the product. These are NOT the product image.
    On these domains, save ONLY the `canonical` images. Never include
    page_images entries from these sites.
  * If BOTH `canonical` and `page_images` are empty, save_product with an
    empty images array -- do not invent URLs from the page HTML, because
    they are likely private.
  * Other things to NEVER include: site-wide hero/banners, logos, category
    thumbnails, "you might also like" carousels, reviewer photos, payment-method
    icons, social badges, blog/article images, generic lifestyle photos.
  * Extract ALL product images from the product gallery/carousel. Most products
    have 3-8 images showing different angles, colors, or styled views. Include
    all of them -- do not limit to just 1-2 images.
- Keep description concise (1-3 sentences).

VARIANT EXTRACTION (critical for sizing intelligence):
- **ALWAYS call get_variants** to extract all available sizes, colors, and combinations.
- Include the variants array in save_product even if only sizes are found (set color to null).
- For each variant, capture availability (in stock / sold out).
- If get_variants returns empty results, check visit_page text and get_page_html for
  size/color selectors that the JS extraction may have missed. List them manually.

SIZE CHART EXTRACTION:
- **ALWAYS call get_size_chart** to look for measurement tables.
- If get_size_chart finds a table, include it as the size_chart field in save_product.
- If measurements are in inches, convert to cm (multiply by 2.54) and note the conversion.
- Common measurement keys: chest_cm, waist_cm, hip_cm, shoulder_cm, length_cm,
  sleeve_cm, inseam_cm, neck_cm, rise_cm. Use snake_case with _cm suffix.
- If no structured table exists but size/fit text mentions specific measurements
  (e.g. "chest 40 inches"), include those in the size_chart as best-effort data.

MATERIALS & COMPOSITION:
- Extract materials_care as the full text (existing behavior).
- ALSO parse materials_detail: break composition into [{fiber, percentage}] array.
  Examples: "75% cotton, 25% polyester" → [{"fiber":"cotton","percentage":75},{"fiber":"polyester","percentage":25}]
  "100% Silk" → [{"fiber":"silk","percentage":100}]
  If percentages aren't given, list fibers with null percentages.

PRODUCT CATEGORIZATION:
- In addition to the flat "type" field, populate product_category with:
  * category: broad grouping (fashion, beauty, home, tech, lifestyle)
  * subcategory: specific type (e.g. "half zip sweater", "slim fit chinos", "running sneakers")
  * style: aesthetic descriptor (e.g. "minimal luxury", "streetwear", "classic", "bohemian", "athleisure")

- **Extract size_fit and materials_care by recognising what the data IS, not what it's called**:
  * size_fit → any content that describes how the garment fits the body: fit type
    (slim/relaxed/oversized), size model info ("Model is 6'2\" wearing M"), inseam,
    cut name, silhouette label, "fits true to size" notes, size chart references.
    Section labels vary widely: "Size & Fit", "Fit Guide", "Silhouette", "Fit Notes",
    "How it fits", dimension tables, etc. — recognise the content, not the label.
  * materials_care → any content that describes what the item is made of or how to
    care for it: fabric composition ("75% cotton, 25% polyester"), fibre trade names
    (Lenzing™ Lyocell, TENCEL™), wash/dry/iron instructions, "dry clean only",
    country of origin. Section labels vary: "Materials & Care", "Fabric & Care",
    "Composition", "Garment Details", "Details", a spec table with Care/Composition
    rows, fabric icons, etc. — recognise the content, not the label.
  * Check visit_page text content and get_page_html first; scroll once if needed.
  * Join all relevant bullet points / table rows with ". " into a single string.
  * Do NOT keep scrolling or use extra turns just to hunt for these sections —
    they are bonus fields. If not found after one look, use null and call save_product.
- Use null for any field that cannot be determined.

IMPORTANT -- non-product pages:
If the URL redirected to a homepage, category page, search results, blog post,
help/FAQ article, 404, or any page that is NOT a single product detail page,
DO NOT call save_product. Instead reply with plain text starting with
"NOT_A_PRODUCT_PAGE:" followed by a short reason (e.g. the actual page type
and the final URL). The orchestrator will mark the URL as failed.

IMPORTANT -- blocked pages:
If a tool returns an error containing "SITE_BLOCKED" (HTTP 403/429/503,
"Access Denied", Cloudflare/Akamai/Imperva captcha pages, etc.), the site is
actively blocking automated access. DO NOT keep retrying with other tools --
the page has no product data to extract. Reply with plain text starting with
"SITE_BLOCKED:" followed by the reason from the tool error and the URL. The
orchestrator will mark the URL as failed with a "blocked" status so a human
can decide whether to use a manual scrape / proxy.

How to recognise a real product detail page:
- It shows ONE specific product as the focus (not a grid/list of many).
- It has at least one of: a price, an "Add to cart"/"Buy" button, a SKU/variant
  selector, or product:* / og:product / Product JSON-LD metadata.
- The og:type is typically "product" (not "website" / "article").
"""


def _proxy_from_env() -> dict | None:
    """Read proxy config from env vars. Returns None if not configured.

    Recognised vars:
        SCRAPER_PROXY_SERVER     e.g. "http://us.smartproxy.com:10000"
        SCRAPER_PROXY_USERNAME   (optional)
        SCRAPER_PROXY_PASSWORD   (optional)
    """
    server = os.environ.get("SCRAPER_PROXY_SERVER", "").strip()
    if not server:
        return None
    proxy = {"server": server}
    user = os.environ.get("SCRAPER_PROXY_USERNAME", "").strip()
    pwd = os.environ.get("SCRAPER_PROXY_PASSWORD", "").strip()
    if user:
        proxy["username"] = user
    if pwd:
        proxy["password"] = pwd
    return proxy


# Path to the rotating residential proxy list (one "host:port:username:password"
# entry per line). Baked into the Modal image at /root; override via env for
# local runs. Each line is a distinct residential exit IP, so picking a random
# line per attempt rotates the IP and defeats IP-based bot walls (Akamai etc.).
_PROXY_LIST_PATH = os.environ.get(
    "SCRAPER_PROXY_LIST",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "residential-proxies.txt"),
)

_proxy_pool_cache: list[dict] | None = None


def _load_proxy_pool() -> list[dict]:
    """Parse the residential proxy list into Playwright proxy dicts.

    Each line ``host:port:username:password`` → ``{"server": "http://host:port",
    "username": ..., "password": ...}``. Lines that are blank, commented (#),
    or malformed are skipped. The result is cached for the life of the process.
    Returns an empty list if the file is missing (callers fall back to
    ``_proxy_from_env``).
    """
    global _proxy_pool_cache
    if _proxy_pool_cache is not None:
        return _proxy_pool_cache
    pool: list[dict] = []
    try:
        with open(_PROXY_LIST_PATH, "r") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                parts = line.split(":")
                if len(parts) < 2:
                    continue
                host, port = parts[0], parts[1]
                entry = {"server": f"http://{host}:{port}"}
                if len(parts) >= 4 and parts[2]:
                    entry["username"] = parts[2]
                    entry["password"] = parts[3]
                pool.append(entry)
    except FileNotFoundError:
        pool = []
    _proxy_pool_cache = pool
    if pool:
        print(f"🌐 Loaded {len(pool)} residential proxies from {_PROXY_LIST_PATH}")
    return pool


def _random_proxy() -> dict | None:
    """Pick a random residential proxy from the rotating pool. Falls back to the
    single ``SCRAPER_PROXY_SERVER`` env var, then None if neither is configured.
    """
    pool = _load_proxy_pool()
    if pool:
        return random.choice(pool)
    return _proxy_from_env()


def run_agent(
    product_url: str,
    look_id: str | None = None,
    save: bool = True,
    on_save=None,  # callable | None -- called immediately when save_product fires
) -> dict:
    """
    Top-level entry point. Tries a normal scrape first; if the site blocks the
    request (raises SITE_BLOCKED), automatically retries once with stealth +
    proxy enabled. The proxy is read from env vars (see _proxy_from_env).

    on_save(product: dict) -- optional callback fired the instant Claude calls
    save_product, BEFORE the agent loop finishes.  Use this in Modal to write
    the DB row immediately so no work is lost if the container is killed later.
    """
    try:
        return _run_agent_attempt(
            product_url, look_id=look_id, save=save, on_save=on_save,
            use_stealth=False, proxy=None,
        )
    except RuntimeError as e:
        if "SITE_BLOCKED" not in str(e).upper():
            raise
        # The direct attempt was blocked (Akamai/Cloudflare/etc). Retry with
        # stealth + a residential proxy. A single residential exit IP can itself
        # be flaky or already rate-limited, so when a rotating pool is available
        # we cycle through up to 3 distinct exit IPs before giving up. Without a
        # pool we still try stealth once (often clears soft Cloudflare checks).
        pool = _load_proxy_pool()
        max_retries = 3 if pool else 1
        last_err: Exception = e
        for i in range(max_retries):
            proxy = _random_proxy()
            label = (proxy.get("username") or proxy.get("server")) if proxy else "stealth-only"
            print(f"\n🔁 First attempt blocked ({e}); proxied retry "
                  f"{i + 1}/{max_retries} via {label}…\n")
            try:
                return _run_agent_attempt(
                    product_url, look_id=look_id, save=save, on_save=on_save,
                    use_stealth=True, proxy=proxy,
                )
            except RuntimeError as retry_err:
                if "SITE_BLOCKED" not in str(retry_err).upper():
                    raise
                last_err = retry_err
                if not proxy:
                    break  # nothing left to rotate; further stealth retries won't help
        raise last_err


def _run_agent_attempt(
    product_url: str,
    look_id: str | None,
    save: bool,
    on_save,
    use_stealth: bool,
    proxy: dict | None,
) -> dict:
    client = anthropic.Anthropic()
    browser = BrowserSession(use_stealth=use_stealth, proxy=proxy)

    messages = [
        {"role": "user", "content": f"Extract product data from: {product_url}"}
    ]

    saved_product = None
    nudge_count = 0
    MAX_NUDGES = 3
    last_agent_reply: str | None = None
    consecutive_scrolls = 0
    MAX_CONSECUTIVE_SCROLLS = 3

    # Fast-fail on URLs that obviously aren't product pages (Google search
    # results, bare homepages, etc.). Saves a Claude call per row.
    bad_url_reason = _non_product_url_reason(product_url)
    if bad_url_reason:
        raise RuntimeError(f"Not a product page -- {bad_url_reason}: {product_url}")

    try:
        browser.start()
        print(f"🌐 Agent started -- visiting {product_url}\n")

        # If this is a Google Shopping product page, resolve it to the
        # underlying merchant URL first. Google Shopping pages are not
        # scrapeable directly (different DOM, no canonical product image
        # for the chosen seller, etc.) -- but each one lists merchant
        # offers we can follow.
        if _is_google_shopping_url(product_url):
            print(f"🛒 Google Shopping URL detected -- resolving merchant…")
            resolved = browser.resolve_google_shopping(product_url)
            print(f"   → resolved to {resolved}\n")
            product_url = resolved
            messages = [
                {"role": "user", "content": f"Extract product data from: {product_url}"}
            ]

        for turn in range(MAX_AGENT_TURNS):
            # Trim old tool results to keep token usage manageable
            if turn > 2:
                _trim_old_tool_results(messages)

            # Force tool use on the last few turns if we still haven't saved
            # This prevents Claude from ending with a text response when it
            # should be calling save_product with whatever data it has.
            force_save = (nudge_count > 0 or turn >= MAX_AGENT_TURNS - 3)

            # Call Claude with retry on rate-limit (429)
            response = None
            for attempt in range(MAX_RETRIES + 1):
                try:
                    create_kwargs = dict(
                        model=MODEL,
                        max_tokens=4096,
                        system=SYSTEM_PROMPT,
                        tools=TOOLS,
                        messages=messages,
                    )
                    if force_save and not saved_product:
                        # Force specifically save_product -- "any" still lets
                        # the agent pick scroll_down and burn the remaining turns.
                        create_kwargs["tool_choice"] = {"type": "tool", "name": "save_product"}
                    response = client.messages.create(**create_kwargs)
                    break
                except anthropic.RateLimitError as e:
                    if attempt >= MAX_RETRIES:
                        raise
                    delay = RETRY_DELAYS[min(attempt, len(RETRY_DELAYS) - 1)]
                    print(f"  ⏳ Rate limited, retrying in {delay}s (attempt {attempt + 1}/{MAX_RETRIES})…")
                    time.sleep(delay)

            # If Claude finished with text only -- nudge it to call save_product
            if response.stop_reason == "end_turn":
                if saved_product:
                    print(f"\n✅ Agent finished in {turn + 1} turn(s)")
                    break

                # Did the agent explicitly say "this isn't a product page"?
                reply_text = "".join(
                    getattr(b, "text", "") for b in response.content
                    if hasattr(b, "text")
                ).strip()
                if "NOT_A_PRODUCT_PAGE" in reply_text.upper():
                    snippet = reply_text[:300].replace("\n", " ")
                    raise RuntimeError(f"Not a product page -- {snippet}")
                if "SITE_BLOCKED" in reply_text.upper():
                    snippet = reply_text[:300].replace("\n", " ")
                    raise RuntimeError(f"SITE_BLOCKED: {snippet}")

                if nudge_count >= MAX_NUDGES:
                    last_agent_reply = reply_text
                    print(f"\n⚠️  Agent could not extract product after {MAX_NUDGES} nudges")
                    break

                # Claude replied with text but didn't save -- ask it to use the tool
                nudge_count += 1
                print(f"  💬 Claude responded with text, nudging to call save_product ({nudge_count}/{MAX_NUDGES})...")
                messages.append({"role": "assistant", "content": response.content})
                messages.append({
                    "role": "user",
                    "content": (
                        "Call save_product NOW with all the data you have collected from "
                        f"visiting {product_url}. You have already browsed the page -- "
                        "do not visit it again. Use null for any fields you couldn't "
                        "determine. You MUST call the save_product tool, not reply with text."
                    ),
                })
                continue

            # Process tool use blocks
            assistant_content = response.content
            messages.append({"role": "assistant", "content": assistant_content})

            tool_results = []
            for block in assistant_content:
                if block.type != "tool_use":
                    continue

                tool_name = block.name
                tool_input = block.input
                print(f"  🔧 {tool_name}({json.dumps(tool_input)[:100]})")

                # Track consecutive scrolls; after the cap, inject a user
                # message telling the agent to stop scrolling and save.
                if tool_name == "scroll_down":
                    consecutive_scrolls += 1
                else:
                    consecutive_scrolls = 0

                if tool_name == "save_product":
                    # Sanity check: a real product page virtually always has at
                    # least a price OR a brand OR availability info. If none of
                    # those are present, the agent likely landed on a non-product
                    # page (homepage / category / blog) and is about to save
                    # whatever images it found. Reject and ask it to verify.
                    has_commerce_signal = bool(
                        tool_input.get("price")
                        or tool_input.get("discounted_price")
                        or tool_input.get("brand")
                        or tool_input.get("availability")
                    )
                    image_count = len(tool_input.get("images") or [])
                    if not has_commerce_signal and image_count > 0:
                        nudge_count += 1
                        if nudge_count >= MAX_NUDGES:
                            raise RuntimeError(
                                "Page does not look like a product detail page "
                                "(no price, brand, or availability detected). "
                                f"URL: {product_url}"
                            )
                        print(
                            "  ⚠️  save_product called with no price/brand/availability -- "
                            f"asking agent to verify ({nudge_count}/{MAX_NUDGES})"
                        )
                        tool_results.append({
                            "type": "tool_result",
                            "tool_use_id": block.id,
                            "content": [{"type": "text", "text": (
                                "Rejected: this looks like a non-product page (no price, "
                                "brand, or availability found). Please verify you are on a "
                                "single product detail page. If the URL redirected to a "
                                "homepage, category, blog, or 404, reply with "
                                "'NOT_A_PRODUCT_PAGE: <reason>' instead of calling save_product."
                            )}],
                            "is_error": True,
                        })
                        continue

                    saved_images = tool_input.get("images", []) or []
                    public_images = _filter_accessible_images(saved_images)
                    image_missing_reason: str | None = None
                    if saved_images and not public_images:
                        print(
                            f"  ⚠️  All {len(saved_images)} image(s) returned by Claude are "
                            "private/inaccessible -- saving with empty images list."
                        )
                        image_missing_reason = (
                            f"Private images -- all {len(saved_images)} URL(s) were "
                            "inaccessible (403 / non-image response)"
                        )
                    elif not saved_images:
                        image_missing_reason = "No images found on page"
                    elif len(public_images) < len(saved_images):
                        dropped = len(saved_images) - len(public_images)
                        print(
                            f"  🧹 Dropped {dropped} private/inaccessible image URL(s); "
                            f"keeping {len(public_images)}."
                        )

                    saved_product = {
                        "url": product_url,
                        "title": tool_input.get("title"),
                        "brand": tool_input.get("brand"),
                        "description": tool_input.get("description"),
                        "price": tool_input.get("price"),
                        "discounted_price": tool_input.get("discounted_price"),
                        "currency": tool_input.get("currency"),
                        "barcode": tool_input.get("barcode"),
                        "barcode_type": tool_input.get("barcode_type"),
                        "images": public_images,
                        "image_missing_reason": image_missing_reason,
                        "availability": tool_input.get("availability"),
                        "type": tool_input.get("type"),
                        "gender": tool_input.get("gender"),
                        "size_fit": tool_input.get("size_fit"),
                        "materials_care": tool_input.get("materials_care"),
                        "variants": tool_input.get("variants"),
                        "size_chart": tool_input.get("size_chart"),
                        "materials_detail": tool_input.get("materials_detail"),
                        "product_category": tool_input.get("product_category"),
                        "scraped_at": datetime.now(timezone.utc).isoformat(),
                    }

                    # ── Fire callback immediately -- don't wait for loop to finish ──
                    # This ensures the DB is updated the moment data is extracted,
                    # even if the container is killed or times out afterwards.
                    if on_save:
                        try:
                            on_save(saved_product)
                        except Exception as cb_err:
                            print(f"  ⚠️  on_save callback error: {cb_err}")

                    tool_results.append(
                        {
                            "type": "tool_result",
                            "tool_use_id": block.id,
                            "content": [
                                {"type": "text", "text": "Product saved successfully."}
                            ],
                        }
                    )
                else:
                    try:
                        content = execute_tool(browser, tool_name, tool_input)
                    except Exception as e:
                        print(f"    ⚠️  Tool error: {e}")
                        content = [{"type": "text", "text": f"Error: {e}"}]

                    tool_results.append(
                        {
                            "type": "tool_result",
                            "tool_use_id": block.id,
                            "content": content,
                        }
                    )

            messages.append({"role": "user", "content": tool_results})

            # If the agent has been scrolling too long without saving, inject
            # a hard stop so it doesn't burn all remaining turns.
            if consecutive_scrolls >= MAX_CONSECUTIVE_SCROLLS and not saved_product:
                consecutive_scrolls = 0  # reset so we don't spam
                messages.append({
                    "role": "user",
                    "content": (
                        "You have scrolled the page several times. "
                        "Stop scrolling now and call save_product immediately with "
                        "whatever data you have collected so far. "
                        "Use null for any fields you could not find."
                    ),
                })

            if saved_product:
                break

    finally:
        browser.stop()

    if not saved_product:
        detail = (
            f": {last_agent_reply[:300].replace(chr(10), ' ')}"
            if last_agent_reply
            else ""
        )
        raise RuntimeError(f"Agent completed without calling save_product{detail}")

    # Persist to Supabase storage
    storage_result = {"saved": False, "skipped": True}
    if save:
        storage_result = save_to_supabase(saved_product, product_url, look_id)

    return {
        "success": True,
        "data": saved_product,
        "storage": storage_result,
    }


# ─── CLI ──────────────────────────────────────────────────────────────


def main():
    parser = argparse.ArgumentParser(
        description="Claude AI agent that visits product pages and extracts structured data"
    )
    parser.add_argument(
        "url",
        nargs="?",
        default=os.environ.get("PRODUCT_URL"),
        help="Product page URL to scrape (falls back to PRODUCT_URL in .env)",
    )
    parser.add_argument("--look-id", help="Optional look ID to organise the saved JSON under")
    parser.add_argument(
        "--no-save",
        action="store_true",
        help="Extract data only, don't save to Supabase",
    )
    args = parser.parse_args()

    if not args.url:
        parser.error("Provide a URL as an argument or set PRODUCT_URL in .env")

    result = run_agent(args.url, look_id=args.look_id, save=not args.no_save)

    print("\n" + "=" * 60)
    print("📦 Extracted Product Data:")
    print("=" * 60)
    print(json.dumps(result["data"], indent=2))

    if result["storage"].get("saved"):
        print(f"\n☁️  Saved to: {result['storage']['path']}")
        print(f"🔗 Public URL: {result['storage']['public_url']}")
    elif result["storage"].get("skipped"):
        print("\n⏭️  Storage skipped (--no-save)")
    else:
        print(f"\n⚠️  Storage error: {result['storage'].get('error')}")


if __name__ == "__main__":
    main()
