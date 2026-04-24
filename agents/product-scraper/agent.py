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

MODEL = "claude-sonnet-4-20250514"
MAX_AGENT_TURNS = 10
MAX_HTML_LENGTH = 15_000
MAX_TEXT_LENGTH = 3_000
MAX_IMAGES_RETURN = 15

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
            "as a real user would — helpful for verifying prices, spotting sale badges, "
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
                "images": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Product image URLs (absolute), max 10",
                },
                "availability": {
                    "type": ["string", "null"],
                    "description": "Stock status: 'In Stock', 'Out of Stock', 'Limited', etc.",
                },
            },
            "required": ["title", "images"],
        },
    },
]


# ─── Image URL helpers ────────────────────────────────────────────────

_IMAGE_CHECK_TIMEOUT = 5  # seconds per HTTP probe
_IMAGE_CHECK_WORKERS = 8
_IMAGE_CHECK_USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/120.0.0.0 Safari/537.36"
)


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
    # Some CDNs / S3-style endpoints reject HEAD — try a tiny ranged GET.
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
    """Manages a headless Chromium browser via Playwright."""

    def __init__(self):
        self._pw = None
        self.browser: Browser | None = None
        self.page: Page | None = None

    def start(self):
        self._pw = sync_playwright().start()
        self.browser = self._pw.chromium.launch(headless=True)
        self.page = self.browser.new_page(
            user_agent=(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0.0.0 Safari/537.36"
            ),
            viewport={"width": 1280, "height": 900},
        )

    def stop(self):
        if self.browser:
            self.browser.close()
        if self._pw:
            self._pw.stop()

    # ── Tools ──

    def visit(self, url: str) -> dict:
        self.page.goto(url, wait_until="domcontentloaded", timeout=60_000)
        self.page.wait_for_timeout(3000)  # let JS render

        title = self.page.title()

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
                    src: img.src || img.dataset.src || img.dataset.lazySrc || '',
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
        # cookies — those URLs render in the browser but return 403 to anyone
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
                    new_inner.append({"type": "text", "text": "[screenshot — trimmed from history]"})
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
Your job is to visit a product page, inspect it, and extract structured product data.

Workflow:
1. visit_page — load the URL and read metadata / JSON-LD / visible text
2. take_screenshot — visually inspect the page to verify prices, sale badges, etc.
3. get_all_images — collect product image URLs
4. (optional) get_page_html — if prices or details are missing from step 1
5. (optional) scroll_down + take_screenshot — if content is below the fold
6. save_product — once all data is gathered, call this with the final values

Rules:
- Extract ACTUAL data from the page. Never guess or fabricate.
- Include currency symbols in price strings (e.g. "$129.99").
- If there is both an original price and a sale/discounted price, capture both.
- IMAGE SELECTION (strict):
  * `get_all_images` returns `{ canonical: [...], page_images: [...] }`.
    Every URL it returns has ALREADY been verified as publicly accessible
    (HTTP 200 with image content-type). URLs that would return 403/private
    have been pre-filtered out — do NOT use any image URL that you saw
    elsewhere (visit_page metadata, get_page_html) but that is missing from
    `get_all_images`, because that means it isn't public.
  * `canonical` images come from the page's OWN metadata (og:image, JSON-LD
    Product.image). They are the authoritative product photos \u2014 ALWAYS prefer
    them. If `canonical` is non-empty, use ONLY `canonical` images unless the
    screenshot clearly shows additional product angles you can match in
    `page_images`.
  * On aggregator / affiliate / link-in-bio pages \u2014 shopmy.us, ltk.app,
    liketoknow.it, linktree, beacons.ai, stan.store, bio.link, koji.to,
    snipfeed, withkoji \u2014 `page_images` is full of CURATOR-UPLOADED user
    photos showing people using the product. These are NOT the product image.
    On these domains, save ONLY the `canonical` images. Never include
    page_images entries from these sites.
  * If BOTH `canonical` and `page_images` are empty, save_product with an
    empty images array \u2014 do not invent URLs from the page HTML, because
    they are likely private.
  * Other things to NEVER include: site-wide hero/banners, logos, category
    thumbnails, "you might also like" carousels, reviewer photos, payment-method
    icons, social badges, blog/article images, generic lifestyle photos.
  * Aim for 1\u20136 high-quality product images.
- Keep description concise (1-3 sentences).
- Use null for any field that cannot be determined.

IMPORTANT — non-product pages:
If the URL redirected to a homepage, category page, search results, blog post,
help/FAQ article, 404, or any page that is NOT a single product detail page,
DO NOT call save_product. Instead reply with plain text starting with
"NOT_A_PRODUCT_PAGE:" followed by a short reason (e.g. the actual page type
and the final URL). The orchestrator will mark the URL as failed.

How to recognise a real product detail page:
- It shows ONE specific product as the focus (not a grid/list of many).
- It has at least one of: a price, an "Add to cart"/"Buy" button, a SKU/variant
  selector, or product:* / og:product / Product JSON-LD metadata.
- The og:type is typically "product" (not "website" / "article").
"""


def run_agent(
    product_url: str,
    look_id: str | None = None,
    save: bool = True,
    on_save=None,  # callable | None — called immediately when save_product fires
) -> dict:
    """
    on_save(product: dict) — optional callback fired the instant Claude calls
    save_product, BEFORE the agent loop finishes.  Use this in Modal to write
    the DB row immediately so no work is lost if the container is killed later.
    """
    client = anthropic.Anthropic()
    browser = BrowserSession()

    messages = [
        {"role": "user", "content": f"Extract product data from: {product_url}"}
    ]

    saved_product = None
    nudge_count = 0
    MAX_NUDGES = 2

    try:
        browser.start()
        print(f"🌐 Agent started — visiting {product_url}\n")

        for turn in range(MAX_AGENT_TURNS):
            # Trim old tool results to keep token usage manageable
            if turn > 2:
                _trim_old_tool_results(messages)

            # Call Claude with retry on rate-limit (429)
            response = None
            for attempt in range(MAX_RETRIES + 1):
                try:
                    response = client.messages.create(
                        model=MODEL,
                        max_tokens=4096,
                        system=SYSTEM_PROMPT,
                        tools=TOOLS,
                        messages=messages,
                    )
                    break
                except anthropic.RateLimitError as e:
                    if attempt >= MAX_RETRIES:
                        raise
                    delay = RETRY_DELAYS[min(attempt, len(RETRY_DELAYS) - 1)]
                    print(f"  ⏳ Rate limited, retrying in {delay}s (attempt {attempt + 1}/{MAX_RETRIES})…")
                    time.sleep(delay)

            # If Claude finished with text only — nudge it to call save_product
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
                    raise RuntimeError(f"Not a product page — {snippet}")

                if nudge_count >= MAX_NUDGES:
                    print(f"\n⚠️  Agent could not extract product after {MAX_NUDGES} nudges")
                    break

                # Claude replied with text but didn't save — ask it to use the tool
                nudge_count += 1
                print(f"  💬 Claude responded with text, nudging to call save_product ({nudge_count}/{MAX_NUDGES})...")
                messages.append({"role": "assistant", "content": response.content})
                messages.append({
                    "role": "user",
                    "content": (
                        "You must call the save_product tool now with whatever data you "
                        "were able to extract. Use null for any fields you couldn't determine. "
                        "Do not respond with text — call the save_product tool."
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
                            "  ⚠️  save_product called with no price/brand/availability — "
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
                            "private/inaccessible — saving with empty images list."
                        )
                        image_missing_reason = (
                            f"Private images — all {len(saved_images)} URL(s) were "
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
                        "images": public_images,
                        "image_missing_reason": image_missing_reason,
                        "availability": tool_input.get("availability"),
                        "scraped_at": datetime.now(timezone.utc).isoformat(),
                    }

                    # ── Fire callback immediately — don't wait for loop to finish ──
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

            if saved_product:
                break

    finally:
        browser.stop()

    if not saved_product:
        raise RuntimeError("Agent completed without calling save_product")

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
