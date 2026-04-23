#!/usr/bin/env python3
"""
Tests for the site-crawler agent.

Run:
    cd agents/site-crawler
    python -m pytest test_agent.py -v
    python -m pytest test_agent.py -v -k "not live"   # skip live API tests
"""

import json
import pytest
from unittest.mock import MagicMock, patch
from urllib.parse import urlparse

# ─── Import agent modules ──────────────────────────────────────────────

from agent import (
    BrowserAgent,
    COORDINATOR_TOOLS,
    COLLECTION_TOOLS,
    COORDINATOR_MODEL,
    COLLECTION_MODEL,
    MAX_HTML_LENGTH,
    MAX_LINKS_RETURN,
    _call_with_retry,
    _classify_url,
    _name_from_url,
    _parse_sitemap,
    discover_via_sitemap,
    RETRY_DELAYS,
)


# ═══════════════════════════════════════════════════════════════════════
# 1. Tool definitions — no duplicate names
# ═══════════════════════════════════════════════════════════════════════

class TestToolDefinitions:
    """Validate tool schemas before sending to the API."""

    def test_coordinator_tools_no_duplicates(self):
        names = [t["name"] for t in COORDINATOR_TOOLS]
        assert len(names) == len(set(names)), (
            f"Duplicate coordinator tool names: "
            f"{[n for n in names if names.count(n) > 1]}"
        )

    def test_collection_tools_no_duplicates(self):
        names = [t["name"] for t in COLLECTION_TOOLS]
        assert len(names) == len(set(names)), (
            f"Duplicate collection tool names: "
            f"{[n for n in names if names.count(n) > 1]}"
        )

    def test_coordinator_tools_have_required_fields(self):
        for tool in COORDINATOR_TOOLS:
            assert "name" in tool, f"Tool missing name: {tool}"
            assert "description" in tool, f"Tool {tool['name']} missing description"
            assert "input_schema" in tool, f"Tool {tool['name']} missing input_schema"
            assert tool["input_schema"].get("type") == "object"

    def test_collection_tools_have_required_fields(self):
        for tool in COLLECTION_TOOLS:
            assert "name" in tool, f"Tool missing name: {tool}"
            assert "description" in tool, f"Tool {tool['name']} missing description"
            assert "input_schema" in tool, f"Tool {tool['name']} missing input_schema"
            assert tool["input_schema"].get("type") == "object"

    def test_coordinator_has_expected_tools(self):
        names = {t["name"] for t in COORDINATOR_TOOLS}
        assert "visit_page" in names
        assert "get_navigation" in names
        assert "save_collections" in names
        assert "hover_main_menu" in names

    def test_collection_has_expected_tools(self):
        names = {t["name"] for t in COLLECTION_TOOLS}
        assert "visit_page" in names
        assert "get_product_links" in names
        assert "save_product_urls" in names
        assert "scroll_down" in names
        assert "auto_load_all" in names

    def test_collection_does_not_have_get_page_html(self):
        """get_page_html was removed to save tokens — verify it stays removed."""
        names = {t["name"] for t in COLLECTION_TOOLS}
        assert "get_page_html" not in names


# ═══════════════════════════════════════════════════════════════════════
# 2. Model configuration
# ═══════════════════════════════════════════════════════════════════════

class TestModelConfig:
    def test_coordinator_uses_sonnet(self):
        assert "sonnet" in COORDINATOR_MODEL.lower()

    def test_collection_uses_haiku(self):
        assert "haiku" in COLLECTION_MODEL.lower()


# ═══════════════════════════════════════════════════════════════════════
# 3. BrowserAgent — domain checks
# ═══════════════════════════════════════════════════════════════════════

class TestBrowserAgent:
    def test_is_same_domain_true(self):
        agent = BrowserAgent("https://www.nike.com")
        assert agent.is_same_domain("https://www.nike.com/shoes") is True
        assert agent.is_same_domain("https://www.nike.com/collections/running") is True

    def test_is_same_domain_false(self):
        agent = BrowserAgent("https://www.nike.com")
        assert agent.is_same_domain("https://www.adidas.com/shoes") is False
        assert agent.is_same_domain("https://google.com") is False

    def test_is_same_domain_relative(self):
        agent = BrowserAgent("https://www.nike.com")
        # Empty netloc = relative URL
        assert agent.is_same_domain("/shoes") is True

    def test_is_same_domain_handles_bad_input(self):
        agent = BrowserAgent("https://www.nike.com")
        # Empty string and javascript: parse with empty netloc — is_same_domain
        # only checks netloc; JS links are filtered in get_page_links() instead
        assert agent.is_same_domain("") is True
        assert agent.is_same_domain("https://totally-different.com") is False

    def test_visited_urls_tracking(self):
        agent = BrowserAgent("https://example.com")
        assert agent.pages_visited == 0
        assert len(agent.visited_urls) == 0


# ═══════════════════════════════════════════════════════════════════════
# 4. Retry logic
# ═══════════════════════════════════════════════════════════════════════

class TestRetryLogic:
    def test_retry_on_rate_limit(self):
        """Should retry on RateLimitError and succeed on later attempt."""
        import anthropic

        mock_client = MagicMock()
        mock_response = MagicMock()
        mock_response.stop_reason = "end_turn"

        # Fail twice, succeed on third
        mock_client.messages.create.side_effect = [
            anthropic.RateLimitError(
                message="rate limited",
                response=MagicMock(status_code=429, headers={}),
                body={"error": {"type": "rate_limit_error", "message": "rate limited"}},
            ),
            anthropic.RateLimitError(
                message="rate limited",
                response=MagicMock(status_code=429, headers={}),
                body={"error": {"type": "rate_limit_error", "message": "rate limited"}},
            ),
            mock_response,
        ]

        with patch("time.sleep"):  # Don't actually sleep in tests
            result = _call_with_retry(mock_client, model="test", messages=[], max_tokens=100)

        assert result == mock_response
        assert mock_client.messages.create.call_count == 3

    def test_no_retry_on_success(self):
        """Should not retry if first call succeeds."""
        mock_client = MagicMock()
        mock_response = MagicMock()
        mock_client.messages.create.return_value = mock_response

        result = _call_with_retry(mock_client, model="test", messages=[], max_tokens=100)

        assert result == mock_response
        assert mock_client.messages.create.call_count == 1

    def test_retry_delays_configured(self):
        assert len(RETRY_DELAYS) >= 3
        assert all(d > 0 for d in RETRY_DELAYS)
        # Delays should increase
        for i in range(1, len(RETRY_DELAYS)):
            assert RETRY_DELAYS[i] >= RETRY_DELAYS[i - 1]


# ═══════════════════════════════════════════════════════════════════════
# 5. Configuration sanity
# ═══════════════════════════════════════════════════════════════════════

class TestConfigSanity:
    def test_max_html_length_reasonable(self):
        assert MAX_HTML_LENGTH <= 20_000, "HTML should be kept small to save tokens"

    def test_max_links_return_reasonable(self):
        assert MAX_LINKS_RETURN <= 300, "Links list should be limited"

    def test_no_python_syntax_warnings(self):
        """Ensure no invalid escape sequences in the source file."""
        import warnings
        with warnings.catch_warnings(record=True) as w:
            warnings.simplefilter("always")
            import importlib
            import agent
            importlib.reload(agent)
            syntax_warnings = [x for x in w if issubclass(x.category, SyntaxWarning)]
            assert len(syntax_warnings) == 0, (
                f"SyntaxWarnings found: {[str(x.message) for x in syntax_warnings]}"
            )


# ═══════════════════════════════════════════════════════════════════════
# 6. JSON output format of browser methods
# ═══════════════════════════════════════════════════════════════════════

class TestBrowserOutputFormat:
    """Test that browser methods produce valid JSON with expected structure."""

    def test_visit_page_rejects_visited(self):
        agent = BrowserAgent("https://example.com")
        agent.visited_urls.add("https://example.com/test")
        result = json.loads(agent.visit_page("https://example.com/test"))
        assert "error" in result
        assert "Already visited" in result["error"]

    def test_visit_page_rejects_different_domain(self):
        agent = BrowserAgent("https://example.com")
        result = json.loads(agent.visit_page("https://other-site.com/page"))
        assert "error" in result
        assert "Different domain" in result["error"]


# ═══════════════════════════════════════════════════════════════════════
# 7. Sitemap discovery
# ═══════════════════════════════════════════════════════════════════════

SAMPLE_URLSET = b"""<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://shop.example.com/products/cool-tee</loc></url>
  <url><loc>https://shop.example.com/products/warm-hoodie</loc></url>
  <url><loc>https://shop.example.com/collections/new-arrivals</loc></url>
  <url><loc>https://shop.example.com/about</loc></url>
</urlset>"""

SAMPLE_INDEX = b"""<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>https://shop.example.com/sitemap_products_1.xml</loc></sitemap>
  <sitemap><loc>https://shop.example.com/sitemap_collections_1.xml</loc></sitemap>
</sitemapindex>"""


class TestSitemapHelpers:
    def test_classify_product(self):
        assert _classify_url("https://x.com/products/cool-tee") == "product"
        assert _classify_url("https://x.com/p/abc-123") == "product"
        assert _classify_url("https://x.com/dp/B0XYZ12345") == "product"

    def test_classify_collection(self):
        assert _classify_url("https://x.com/collections/new-arrivals") == "collection"
        assert _classify_url("https://x.com/category/shoes") == "collection"
        assert _classify_url("https://x.com/c/men") == "collection"

    def test_classify_unknown(self):
        assert _classify_url("https://x.com/about") is None
        assert _classify_url("https://x.com/") is None

    def test_name_from_url(self):
        assert _name_from_url("https://x.com/collections/new-arrivals") == "New Arrivals"
        assert _name_from_url("https://x.com/c/mens-shoes/") == "Mens Shoes"

    def test_parse_urlset(self):
        sub, pages = _parse_sitemap(SAMPLE_URLSET)
        assert sub == []
        assert len(pages) == 4
        assert "https://shop.example.com/products/cool-tee" in pages

    def test_parse_index(self):
        sub, pages = _parse_sitemap(SAMPLE_INDEX)
        assert pages == []
        assert len(sub) == 2
        assert any("sitemap_products_1.xml" in s for s in sub)


class TestDiscoverViaSitemap:
    def test_classifies_urls(self):
        """Mock _http_get to return our sample sitemap and check classification."""
        with patch("agent._http_get") as mock_get, \
             patch("agent._sitemap_urls_from_robots", return_value=[]):
            # First call returns urlset; subsequent return None to stop traversal
            mock_get.side_effect = [SAMPLE_URLSET] + [None] * 20

            result = discover_via_sitemap("https://shop.example.com")

        product_urls = {p["url"] for p in result["products"]}
        coll_urls = {c["url"] for c in result["collections"]}

        assert "https://shop.example.com/products/cool-tee" in product_urls
        assert "https://shop.example.com/products/warm-hoodie" in product_urls
        assert "https://shop.example.com/collections/new-arrivals" in coll_urls
        # /about must not be classified
        assert all("/about" not in u for u in product_urls | coll_urls)

    def test_handles_no_sitemap(self):
        with patch("agent._http_get", return_value=None), \
             patch("agent._sitemap_urls_from_robots", return_value=[]):
            result = discover_via_sitemap("https://nothing.example")
        assert result["products"] == []
        assert result["collections"] == []


# ═══════════════════════════════════════════════════════════════════════
# Profile / cross-domain mode
# ═══════════════════════════════════════════════════════════════════════

class TestProfileMode:
    """Curator / link-in-bio profile crawls need cross-domain link extraction."""

    def _make_agent_with_links(self, base_url: str, raw_links: list[dict]) -> BrowserAgent:
        agent = BrowserAgent(base_url)
        agent.page = MagicMock()
        agent.page.evaluate.return_value = raw_links
        return agent

    def test_cross_domain_keeps_outbound_brand_links(self):
        agent = self._make_agent_with_links("https://shopmy.us/drconnieyang", [
            {"h": "https://www.valmont.com/en/hydra3-cream", "t": "Valmont Hydra3"},
            {"h": "https://www.net-a-porter.com/products/some-knit", "t": "Knit top"},
            {"h": "https://shopmy.us/drconnieyang", "t": "profile root"},
            {"h": "https://www.instagram.com/drconnieyang", "t": "IG"},
            {"h": "https://tiktok.com/@drconnieyang", "t": "TT"},
            {"h": "mailto:hi@example.com", "t": "email"},
        ])
        result = json.loads(agent.get_product_links(cross_domain=True))
        urls = [l["h"] for l in result["product_links"]]
        assert "https://www.valmont.com/en/hydra3-cream" in urls
        assert "https://www.net-a-porter.com/products/some-knit" in urls
        # Profile's own host removed
        assert "https://shopmy.us/drconnieyang" not in urls
        # Socials removed
        assert not any("instagram.com" in u for u in urls)
        assert not any("tiktok.com" in u for u in urls)
        # Non-http schemes removed
        assert not any(u.startswith("mailto:") for u in urls)

    def test_cross_domain_strips_www_when_matching_profile_host(self):
        # profile URL has no www — outbound with www.shopmy.us should also be dropped.
        agent = self._make_agent_with_links("https://shopmy.us/drconnieyang", [
            {"h": "https://www.shopmy.us/something", "t": "internal"},
            {"h": "https://brand.com/products/x", "t": "brand"},
        ])
        result = json.loads(agent.get_product_links(cross_domain=True))
        urls = [l["h"] for l in result["product_links"]]
        assert "https://www.shopmy.us/something" not in urls
        assert "https://brand.com/products/x" in urls

    def test_same_domain_mode_unchanged(self):
        """Regression: cross_domain=False keeps the original behaviour."""
        agent = self._make_agent_with_links("https://nike.com", [
            {"h": "https://nike.com/products/a", "t": "A"},
            {"h": "https://adidas.com/products/b", "t": "B"},
        ])
        result = json.loads(agent.get_product_links(cross_domain=False))
        urls = [l["h"] for l in result["product_links"]]
        assert urls == ["https://nike.com/products/a"]


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
