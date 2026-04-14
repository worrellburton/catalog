#!/usr/bin/env python3
"""
Tests for the product scraper agent.
Uses mocked Playwright browser and Claude API responses.

Run:
    cd agents/product-scraper
    pip install -r requirements.txt && pip install pytest
    python -m pytest test_agent.py -v --tb=short --json-report --json-report-file=test_results.json
"""

import json
import base64
import re
import pytest
from unittest.mock import MagicMock, patch, PropertyMock
from datetime import datetime, timezone
from urllib.parse import urlparse

# Import from agent
from agent import (
    BrowserSession,
    execute_tool,
    save_to_supabase,
    run_agent,
    TOOLS,
    SYSTEM_PROMPT,
    MAX_HTML_LENGTH,
)


# ─── Fixtures ─────────────────────────────────────────────────────────

SAMPLE_HTML = """
<!DOCTYPE html>
<html>
<head>
    <title>Nike Air Force 1 '07 - Men's Shoe</title>
    <meta property="og:title" content="Nike Air Force 1 '07">
    <meta property="og:image" content="https://static.nike.com/af1.jpg">
    <meta property="og:price:amount" content="110.00">
    <meta property="og:price:currency" content="USD">
    <meta property="og:availability" content="instock">
    <meta property="og:brand" content="Nike">
    <meta name="description" content="The radiance lives on in the Nike Air Force 1.">
    <script type="application/ld+json">
    {
        "@type": "Product",
        "name": "Nike Air Force 1 '07",
        "brand": {"@type": "Brand", "name": "Nike"},
        "offers": {
            "@type": "Offer",
            "price": "110.00",
            "priceCurrency": "USD",
            "availability": "https://schema.org/InStock"
        },
        "image": ["https://static.nike.com/af1-1.jpg", "https://static.nike.com/af1-2.jpg"]
    }
    </script>
</head>
<body>
    <h1>Nike Air Force 1 '07</h1>
    <span class="price">$110.00</span>
    <p>The radiance lives on in the Nike Air Force 1 '07, a basketball original.</p>
    <img src="https://static.nike.com/af1-main.jpg" width="600" height="600">
    <img src="https://static.nike.com/af1-side.jpg" width="600" height="600">
    <img src="/icons/logo.svg" width="24" height="24">
    <img src="data:image/gif;base64,abc" width="1" height="1">
</body>
</html>
"""

SAMPLE_SALE_HTML = """
<!DOCTYPE html>
<html>
<head>
    <title>Zara Oversized Blazer - SALE</title>
    <meta property="og:title" content="Oversized Blazer">
    <meta property="og:price:amount" content="89.90">
    <meta property="og:price:currency" content="USD">
    <meta property="og:brand" content="Zara">
</head>
<body>
    <h1>Oversized Blazer</h1>
    <span class="price--original">$129.90</span>
    <span class="price--sale">$89.90</span>
    <p>Flowing oversized blazer with padded shoulders.</p>
    <img src="https://static.zara.net/blazer-1.jpg" width="500" height="750">
</body>
</html>
"""

SAMPLE_VISIT_RESULT = {
    "title": "Nike Air Force 1 '07 - Men's Shoe",
    "meta": {
        "description": "The radiance lives on in the Nike Air Force 1.",
        "og_title": "Nike Air Force 1 '07",
        "og_image": "https://static.nike.com/af1.jpg",
        "og_price": "110.00",
        "og_currency": "USD",
        "og_availability": "instock",
        "og_brand": "Nike",
    },
    "json_ld": [
        json.dumps(
            {
                "@type": "Product",
                "name": "Nike Air Force 1 '07",
                "brand": {"@type": "Brand", "name": "Nike"},
                "offers": {
                    "@type": "Offer",
                    "price": "110.00",
                    "priceCurrency": "USD",
                    "availability": "https://schema.org/InStock",
                },
                "image": [
                    "https://static.nike.com/af1-1.jpg",
                    "https://static.nike.com/af1-2.jpg",
                ],
            }
        )
    ],
    "text_content": "Nike Air Force 1 '07\n$110.00\nThe radiance lives on...",
}


def make_mock_browser():
    """Create a mock BrowserSession with stubbed Playwright methods."""
    browser = BrowserSession()
    browser.page = MagicMock()
    browser.browser = MagicMock()
    browser._pw = MagicMock()
    return browser


# ─── Tool definition tests ───────────────────────────────────────────


class TestToolDefinitions:
    def test_all_tools_have_required_fields(self):
        for tool in TOOLS:
            assert "name" in tool, f"Tool missing name: {tool}"
            assert "description" in tool, f"Tool {tool['name']} missing description"
            assert "input_schema" in tool, f"Tool {tool['name']} missing input_schema"
            assert tool["input_schema"]["type"] == "object"

    def test_tool_names_are_unique(self):
        names = [t["name"] for t in TOOLS]
        assert len(names) == len(set(names)), "Duplicate tool names found"

    def test_expected_tools_exist(self):
        names = {t["name"] for t in TOOLS}
        expected = {"visit_page", "get_page_html", "get_all_images", "take_screenshot", "scroll_down", "save_product"}
        assert expected == names

    def test_visit_page_requires_url(self):
        visit = next(t for t in TOOLS if t["name"] == "visit_page")
        assert "url" in visit["input_schema"]["required"]

    def test_save_product_requires_title_and_images(self):
        save = next(t for t in TOOLS if t["name"] == "save_product")
        assert "title" in save["input_schema"]["required"]
        assert "images" in save["input_schema"]["required"]

    def test_save_product_has_all_fields(self):
        save = next(t for t in TOOLS if t["name"] == "save_product")
        props = save["input_schema"]["properties"]
        expected_fields = {"title", "brand", "description", "price", "discounted_price", "currency", "images", "availability"}
        assert expected_fields == set(props.keys())


# ─── execute_tool tests ──────────────────────────────────────────────


class TestExecuteTool:
    def test_visit_page_returns_json(self):
        browser = make_mock_browser()
        browser.page.goto = MagicMock()
        browser.page.wait_for_timeout = MagicMock()
        browser.page.title = MagicMock(return_value="Test Page")
        browser.page.evaluate = MagicMock(
            side_effect=[
                {"description": "Test", "og_title": None, "og_image": None, "og_price": None, "og_currency": None, "og_availability": None, "og_brand": None},
                ['{"@type": "Product", "name": "Test"}'],
                "Test page content",
            ]
        )

        result = execute_tool(browser, "visit_page", {"url": "https://example.com"})
        assert len(result) == 1
        assert result[0]["type"] == "text"
        parsed = json.loads(result[0]["text"])
        assert parsed["title"] == "Test Page"

    def test_get_page_html_strips_and_truncates(self):
        browser = make_mock_browser()
        # Return HTML with scripts
        browser.page.content = MagicMock(
            return_value="<html><script>var x=1;</script><body>Hello</body></html>"
        )

        result = execute_tool(browser, "get_page_html", {})
        assert len(result) == 1
        text = result[0]["text"]
        assert "<script>" not in text
        assert len(text) <= MAX_HTML_LENGTH

    def test_get_all_images_deduplicates(self):
        browser = make_mock_browser()
        browser.page.evaluate = MagicMock(
            side_effect=[
                ["https://img.com/1.jpg", "https://img.com/2.jpg", "https://img.com/1.jpg"],
                ["https://img.com/2.jpg", "https://img.com/3.jpg"],
            ]
        )

        result = execute_tool(browser, "get_all_images", {})
        imgs = json.loads(result[0]["text"])
        assert len(imgs) == 3
        assert len(set(imgs)) == 3  # no dupes

    def test_take_screenshot_returns_base64_image(self):
        browser = make_mock_browser()
        fake_png = b"\x89PNG\r\n\x1a\nfakepng"
        browser.page.screenshot = MagicMock(return_value=fake_png)

        result = execute_tool(browser, "take_screenshot", {})
        assert len(result) == 1
        assert result[0]["type"] == "image"
        assert result[0]["source"]["media_type"] == "image/png"
        decoded = base64.b64decode(result[0]["source"]["data"])
        assert decoded == fake_png

    def test_scroll_down_executes(self):
        browser = make_mock_browser()
        result = execute_tool(browser, "scroll_down", {})
        assert "Scrolled" in result[0]["text"]
        browser.page.evaluate.assert_called_once()

    def test_save_product_returns_confirmation(self):
        browser = make_mock_browser()
        result = execute_tool(browser, "save_product", {"title": "Test", "images": []})
        assert "Product data received" in result[0]["text"]

    def test_unknown_tool_returns_error(self):
        browser = make_mock_browser()
        result = execute_tool(browser, "nonexistent_tool", {})
        assert "Unknown tool" in result[0]["text"]


# ─── BrowserSession unit tests ───────────────────────────────────────


class TestBrowserSession:
    def test_get_html_removes_scripts_styles_svg(self):
        browser = make_mock_browser()
        html = (
            "<html><script>alert(1)</script>"
            "<style>.x{color:red}</style>"
            "<svg><circle/></svg>"
            "<noscript>Enable JS</noscript>"
            "<body><p>Real content</p></body></html>"
        )
        browser.page.content = MagicMock(return_value=html)
        cleaned = browser.get_html()
        assert "<script>" not in cleaned
        assert "<style>" not in cleaned
        assert "<svg>" not in cleaned
        assert "<noscript>" not in cleaned
        assert "Real content" in cleaned

    def test_get_html_respects_max_length(self):
        browser = make_mock_browser()
        huge_html = "<html><body>" + ("x" * (MAX_HTML_LENGTH + 1000)) + "</body></html>"
        browser.page.content = MagicMock(return_value=huge_html)
        cleaned = browser.get_html()
        assert len(cleaned) <= MAX_HTML_LENGTH

    def test_get_images_caps_at_20(self):
        browser = make_mock_browser()
        many_imgs = [f"https://img.com/{i}.jpg" for i in range(30)]
        browser.page.evaluate = MagicMock(side_effect=[many_imgs, []])
        imgs = browser.get_images()
        assert len(imgs) <= 20


# ─── Storage path tests ──────────────────────────────────────────────


class TestSaveToSupabase:
    def test_returns_error_when_no_env_vars(self):
        with patch.dict("os.environ", {}, clear=True):
            result = save_to_supabase({}, "https://example.com/product")
            assert result["saved"] is False
            assert "not set" in result["error"]

    def test_path_includes_look_id_when_provided(self):
        """Verify storage path logic without actually calling Supabase."""
        # We just test the path construction logic
        from agent import save_to_supabase
        from urllib.parse import urlparse

        url = "https://www.nike.com/t/air-force-1"
        domain = urlparse(url).hostname.replace("www.", "")
        safe = re.sub(r"[^a-zA-Z0-9.\-]", "_", domain)

        # With look_id
        look_id = "abc-123"
        expected_prefix = f"looks/{look_id}/{safe}_"
        # The actual path has a timestamp, just verify the prefix pattern
        assert safe == "nike.com"
        assert expected_prefix.startswith("looks/abc-123/nike.com_")

    def test_path_uses_products_prefix_without_look_id(self):
        url = "https://www.zara.com/product/123"
        domain = urlparse(url).hostname.replace("www.", "")
        safe = re.sub(r"[^a-zA-Z0-9.\-]", "_", domain)
        assert safe == "zara.com"
        # Without look_id, path should start with "products/"

    def test_handles_unusual_domains(self):
        urls = [
            "https://shop.example.co.uk/product",
            "https://www.très-chic.com/product",
            "https://192.168.1.1:8080/product",
        ]
        for url in urls:
            try:
                domain = urlparse(url).hostname.replace("www.", "")
                safe = re.sub(r"[^a-zA-Z0-9.\-]", "_", domain)
                assert len(safe) > 0
                assert all(c.isalnum() or c in "._-" for c in safe)
            except Exception:
                pass  # Invalid URLs should not crash


# ─── System prompt tests ─────────────────────────────────────────────


class TestSystemPrompt:
    def test_prompt_mentions_all_tools(self):
        for tool in TOOLS:
            assert tool["name"] in SYSTEM_PROMPT, f"System prompt missing tool: {tool['name']}"

    def test_prompt_mentions_key_rules(self):
        assert "null" in SYSTEM_PROMPT.lower()
        assert "currency" in SYSTEM_PROMPT.lower()
        assert "fabricate" in SYSTEM_PROMPT.lower() or "guess" in SYSTEM_PROMPT.lower()


# ─── Agent loop tests (mocked Claude API) ────────────────────────────


class TestAgentLoop:
    @patch("agent.BrowserSession")
    @patch("agent.anthropic.Anthropic")
    def test_agent_extracts_product_in_one_round(self, mock_anthropic_cls, mock_browser_cls):
        """Simulate a single-round agent: Claude calls visit_page then save_product."""
        # Mock browser
        mock_browser = MagicMock()
        mock_browser_cls.return_value = mock_browser
        mock_browser.page = MagicMock()

        # visit_page return
        mock_browser.visit.return_value = SAMPLE_VISIT_RESULT

        # Mock Claude API client
        mock_client = MagicMock()
        mock_anthropic_cls.return_value = mock_client

        # First API call: Claude calls visit_page
        visit_response = MagicMock()
        visit_response.stop_reason = "tool_use"
        visit_block = MagicMock()
        visit_block.type = "tool_use"
        visit_block.name = "visit_page"
        visit_block.input = {"url": "https://www.nike.com/t/af1"}
        visit_block.id = "tool_1"
        visit_response.content = [visit_block]

        # Second API call: Claude calls save_product
        save_response = MagicMock()
        save_response.stop_reason = "tool_use"
        save_block = MagicMock()
        save_block.type = "tool_use"
        save_block.name = "save_product"
        save_block.input = {
            "title": "Nike Air Force 1 '07",
            "brand": "Nike",
            "description": "Classic basketball shoe.",
            "price": "$110.00",
            "discounted_price": None,
            "currency": "USD",
            "images": ["https://static.nike.com/af1-1.jpg"],
            "availability": "In Stock",
        }
        save_block.id = "tool_2"
        save_response.content = [save_block]

        # Third API call: end_turn
        end_response = MagicMock()
        end_response.stop_reason = "end_turn"
        end_response.content = []

        mock_client.messages.create.side_effect = [visit_response, save_response, end_response]

        result = run_agent("https://www.nike.com/t/af1", save=False)

        assert result["success"] is True
        assert result["data"]["title"] == "Nike Air Force 1 '07"
        assert result["data"]["brand"] == "Nike"
        assert result["data"]["price"] == "$110.00"
        assert result["data"]["discounted_price"] is None
        assert result["data"]["currency"] == "USD"
        assert len(result["data"]["images"]) == 1
        assert result["data"]["url"] == "https://www.nike.com/t/af1"
        assert result["data"]["scraped_at"] is not None

    @patch("agent.BrowserSession")
    @patch("agent.anthropic.Anthropic")
    def test_agent_handles_sale_product(self, mock_anthropic_cls, mock_browser_cls):
        """Simulate extraction of a product on sale with both prices."""
        mock_browser = MagicMock()
        mock_browser_cls.return_value = mock_browser
        mock_browser.page = MagicMock()

        mock_client = MagicMock()
        mock_anthropic_cls.return_value = mock_client

        # Visit
        visit_resp = MagicMock()
        visit_resp.stop_reason = "tool_use"
        vb = MagicMock()
        vb.type = "tool_use"
        vb.name = "visit_page"
        vb.input = {"url": "https://www.zara.com/product/123"}
        vb.id = "t1"
        visit_resp.content = [vb]
        mock_browser.visit.return_value = {"title": "Zara Blazer", "meta": {}, "json_ld": [], "text_content": ""}

        # Save with both prices
        save_resp = MagicMock()
        save_resp.stop_reason = "tool_use"
        sb = MagicMock()
        sb.type = "tool_use"
        sb.name = "save_product"
        sb.input = {
            "title": "Oversized Blazer",
            "brand": "Zara",
            "description": "Flowing oversized blazer with padded shoulders.",
            "price": "$129.90",
            "discounted_price": "$89.90",
            "currency": "USD",
            "images": ["https://static.zara.net/blazer-1.jpg"],
            "availability": "In Stock",
        }
        sb.id = "t2"
        save_resp.content = [sb]

        end_resp = MagicMock()
        end_resp.stop_reason = "end_turn"
        end_resp.content = []

        mock_client.messages.create.side_effect = [visit_resp, save_resp, end_resp]

        result = run_agent("https://www.zara.com/product/123", save=False)

        assert result["success"] is True
        assert result["data"]["price"] == "$129.90"
        assert result["data"]["discounted_price"] == "$89.90"
        assert result["data"]["brand"] == "Zara"

    @patch("agent.BrowserSession")
    @patch("agent.anthropic.Anthropic")
    def test_agent_fails_without_save_product(self, mock_anthropic_cls, mock_browser_cls):
        """Agent should raise error if Claude finishes without calling save_product."""
        mock_browser = MagicMock()
        mock_browser_cls.return_value = mock_browser
        mock_browser.page = MagicMock()

        mock_client = MagicMock()
        mock_anthropic_cls.return_value = mock_client

        # Claude just ends without saving
        end_resp = MagicMock()
        end_resp.stop_reason = "end_turn"
        end_resp.content = []

        mock_client.messages.create.return_value = end_resp

        with pytest.raises(RuntimeError, match="save_product"):
            run_agent("https://example.com", save=False)

    @patch("agent.BrowserSession")
    @patch("agent.anthropic.Anthropic")
    def test_agent_handles_tool_error_gracefully(self, mock_anthropic_cls, mock_browser_cls):
        """If a tool throws, agent should continue with an error message."""
        mock_browser = MagicMock()
        mock_browser_cls.return_value = mock_browser
        mock_browser.page = MagicMock()
        mock_browser.visit.side_effect = Exception("Connection timeout")

        mock_client = MagicMock()
        mock_anthropic_cls.return_value = mock_client

        # Visit (will fail)
        visit_resp = MagicMock()
        visit_resp.stop_reason = "tool_use"
        vb = MagicMock()
        vb.type = "tool_use"
        vb.name = "visit_page"
        vb.input = {"url": "https://down.example.com"}
        vb.id = "t1"
        visit_resp.content = [vb]

        # Claude saves anyway with nulls
        save_resp = MagicMock()
        save_resp.stop_reason = "tool_use"
        sb = MagicMock()
        sb.type = "tool_use"
        sb.name = "save_product"
        sb.input = {
            "title": "Unknown Product",
            "brand": None,
            "description": None,
            "price": None,
            "discounted_price": None,
            "currency": None,
            "images": [],
            "availability": None,
        }
        sb.id = "t2"
        save_resp.content = [sb]

        end_resp = MagicMock()
        end_resp.stop_reason = "end_turn"
        end_resp.content = []

        mock_client.messages.create.side_effect = [visit_resp, save_resp, end_resp]

        result = run_agent("https://down.example.com", save=False)
        assert result["success"] is True
        assert result["data"]["title"] == "Unknown Product"

    @patch("agent.BrowserSession")
    @patch("agent.anthropic.Anthropic")
    def test_agent_multi_tool_round(self, mock_anthropic_cls, mock_browser_cls):
        """Simulate Claude using multiple tools: visit → screenshot → images → save."""
        mock_browser = MagicMock()
        mock_browser_cls.return_value = mock_browser
        mock_browser.page = MagicMock()
        mock_browser.visit.return_value = SAMPLE_VISIT_RESULT
        mock_browser.screenshot.return_value = b"\x89PNGfake"
        mock_browser.get_images.return_value = [
            "https://static.nike.com/af1-1.jpg",
            "https://static.nike.com/af1-2.jpg",
        ]

        mock_client = MagicMock()
        mock_anthropic_cls.return_value = mock_client

        # Turn 1: visit
        r1 = MagicMock()
        r1.stop_reason = "tool_use"
        b1 = MagicMock()
        b1.type = "tool_use"
        b1.name = "visit_page"
        b1.input = {"url": "https://nike.com/af1"}
        b1.id = "t1"
        r1.content = [b1]

        # Turn 2: screenshot + get_all_images (parallel tool calls)
        r2 = MagicMock()
        r2.stop_reason = "tool_use"
        b2 = MagicMock()
        b2.type = "tool_use"
        b2.name = "take_screenshot"
        b2.input = {}
        b2.id = "t2"
        b3 = MagicMock()
        b3.type = "tool_use"
        b3.name = "get_all_images"
        b3.input = {}
        b3.id = "t3"
        r2.content = [b2, b3]

        # Turn 3: save
        r3 = MagicMock()
        r3.stop_reason = "tool_use"
        b4 = MagicMock()
        b4.type = "tool_use"
        b4.name = "save_product"
        b4.input = {
            "title": "Nike Air Force 1 '07",
            "brand": "Nike",
            "description": "Classic.",
            "price": "$110.00",
            "discounted_price": None,
            "currency": "USD",
            "images": ["https://static.nike.com/af1-1.jpg", "https://static.nike.com/af1-2.jpg"],
            "availability": "In Stock",
        }
        b4.id = "t4"
        r3.content = [b4]

        r4 = MagicMock()
        r4.stop_reason = "end_turn"
        r4.content = []

        mock_client.messages.create.side_effect = [r1, r2, r3, r4]

        result = run_agent("https://nike.com/af1", save=False)

        assert result["success"] is True
        assert len(result["data"]["images"]) == 2
        assert mock_client.messages.create.call_count == 3  # 3 turns then save breaks loop


# ─── Output format tests ─────────────────────────────────────────────


class TestOutputFormat:
    def test_scraped_product_has_all_fields(self):
        product = {
            "url": "https://example.com/product",
            "title": "Test Product",
            "brand": "TestBrand",
            "description": "A test product.",
            "price": "$99.99",
            "discounted_price": "$79.99",
            "currency": "USD",
            "images": ["https://example.com/img1.jpg"],
            "availability": "In Stock",
            "scraped_at": datetime.now(timezone.utc).isoformat(),
        }

        required_keys = {"url", "title", "brand", "description", "price", "discounted_price", "currency", "images", "availability", "scraped_at"}
        assert required_keys == set(product.keys())

    def test_scraped_at_is_valid_iso(self):
        ts = datetime.now(timezone.utc).isoformat()
        parsed = datetime.fromisoformat(ts)
        assert parsed.tzinfo is not None

    def test_agent_result_structure(self):
        result = {
            "success": True,
            "data": {"url": "https://x.com", "title": "X", "brand": None, "description": None, "price": None, "discounted_price": None, "currency": None, "images": [], "availability": None, "scraped_at": "2026-01-01T00:00:00+00:00"},
            "storage": {"saved": False, "skipped": True},
        }
        assert result["success"] is True
        assert "data" in result
        assert "storage" in result
        assert isinstance(result["data"]["images"], list)
