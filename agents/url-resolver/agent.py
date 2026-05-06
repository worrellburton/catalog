#!/usr/bin/env python3
"""
URL Resolver Agent

Resolves Google Shopping URLs to direct merchant product page URLs using
Playwright. Visits the Google Shopping product page in a headless browser,
finds the first merchant offer link in the buying-options panel, follows
any Google redirect (/url?q=, /aclk?) to the final merchant URL.

Google Shopping URLs stored in the products table look like:
  https://www.google.com/shopping/product/1234567890
  https://www.google.com/search?ibp=oshop&q=...&prds=...gpcid:XXX...

The search-panel URL is normalised to a /shopping/product/{gpcid} URL before
visiting, which has a more predictable layout.

Usage:
    python agent.py "https://www.google.com/search?ibp=oshop&..."

Returns:
    str | None  — the resolved merchant URL, or None if not resolvable.

Env vars (optional):
    SCRAPER_PROXY_SERVER     e.g. "http://198.23.239.134:6540"
    SCRAPER_PROXY_USERNAME
    SCRAPER_PROXY_PASSWORD
"""

import os
import re
import sys
from urllib.parse import urlparse, parse_qs

from playwright.sync_api import sync_playwright


# JS snippet that finds the first valid merchant offer link on the page.
# Raw string so Python does not misinterpret JS regex escapes like \s, \d.
_FIND_OFFER_LINK_JS = r"""
() => {
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
    const priceRe = /[$\u00a3\u20ac\u00a5]\s?\d/;
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
        let el = a;
        let depth = -1;
        for (let i = 0; i < 6 && el; i++) {
            if (priceRe.test(el.innerText || '')) { depth = i; break; }
            el = el.parentElement;
        }
        if (depth < 0) continue;
        candidates.push({ href: a.href, depth, top: rect.top });
    }
    candidates.sort((a, b) => a.depth - b.depth || a.top - b.top);
    return candidates[0]?.href || null;
}
"""


def _normalise_google_url(url: str) -> str:
    """
    Convert a Google Shopping search-panel URL to a canonical product page URL.

    https://www.google.com/search?ibp=oshop&prds=...gpcid:16036284921817255101,...
    -> https://www.google.com/shopping/product/16036284921817255101

    If already a /shopping/product/ URL, returns unchanged.
    """
    parsed = urlparse(url)
    if parsed.path.startswith("/shopping/product/"):
        return url

    qs = parse_qs(parsed.query)
    prds = qs.get("prds", [""])[0]

    # gpcid is the Google Product Cluster ID
    match = re.search(r'gpcid:(\d+)', prds)
    if match:
        return f"https://www.google.com/shopping/product/{match.group(1)}"

    match = re.search(r'productid:(\d+)', prds)
    if match:
        return f"https://www.google.com/shopping/product/{match.group(1)}"

    return url


def _get_proxy() -> dict | None:
    """Read proxy config from env vars (shared with product-scraper)."""
    server = os.environ.get("SCRAPER_PROXY_SERVER", "").strip()
    if not server:
        return None
    proxy: dict = {"server": server}
    user = os.environ.get("SCRAPER_PROXY_USERNAME", "").strip()
    pwd = os.environ.get("SCRAPER_PROXY_PASSWORD", "").strip()
    if user:
        proxy["username"] = user
    if pwd:
        proxy["password"] = pwd
    return proxy


def _accept_google_consent(page) -> None:
    """Accept Google cookie consent banner if present."""
    try:
        # "Accept all" button text varies by locale
        for selector in [
            'button:has-text("Accept all")',
            'button:has-text("I agree")',
            'button:has-text("Agree")',
            '[aria-label="Accept all"]',
        ]:
            btn = page.query_selector(selector)
            if btn:
                btn.click()
                page.wait_for_timeout(1500)
                print("  Accepted Google consent banner")
                return
    except Exception:
        pass


def resolve_url(google_shopping_url: str) -> str | None:
    """
    Visit a Google Shopping URL with a real browser and return the first
    direct merchant product URL found in the offers panel.

    Returns None if no merchant link can be found.
    """
    target_url = _normalise_google_url(google_shopping_url)
    if target_url != google_shopping_url:
        print(f"  Normalised URL -> {target_url}")

    proxy = _get_proxy()
    if proxy:
        print(f"  Using proxy: {proxy['server']}")

    with sync_playwright() as pw:
        browser = pw.chromium.launch(
            headless=True,
            proxy=proxy,
        )
        ctx = browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0.0.0 Safari/537.36"
            ),
            locale="en-US",
            viewport={"width": 1280, "height": 900},
        )
        page = ctx.new_page()

        try:
            print(f"  Loading: {target_url}")
            page.goto(target_url, wait_until="domcontentloaded", timeout=60_000)
            page.wait_for_timeout(2_000)

            # Accept cookie consent if Google shows it
            _accept_google_consent(page)

            # Log page title for diagnostics
            title = page.title()
            current_url = page.url
            print(f"  Page title: {title!r}")
            print(f"  Current URL: {current_url}")

            page.wait_for_timeout(2_000)

            candidate = page.evaluate(_FIND_OFFER_LINK_JS)

            if not candidate:
                print("  No merchant offer link found — page may be a captcha or consent screen")
                # Log some page text for diagnosis
                body_text = page.evaluate("() => document.body?.innerText?.slice(0, 300) || ''")
                print(f"  Page text preview: {body_text!r}")
                return None

            print(f"  Found offer link: {candidate}")

            # Follow the link — Google /url? and /aclk? redirect to merchant PDP
            page.goto(candidate, wait_until="domcontentloaded", timeout=60_000)
            page.wait_for_timeout(2_000)

            final_url = page.url
            final_host = (urlparse(final_url).hostname or "").lower()

            if not final_url or "google.com" in final_host:
                print(f"  Link did not leave google.com (landed on {final_url})")
                return None

            print(f"  Resolved: {final_url}")
            return final_url

        except Exception as e:
            print(f"  Browser error: {e}")
            return None
        finally:
            browser.close()


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python agent.py <google-shopping-url>")
        sys.exit(1)
    result = resolve_url(sys.argv[1])
    if not result:
        print("Could not resolve to a direct URL.")
        sys.exit(1)
    print(f"\nMerchant URL: {result}")
