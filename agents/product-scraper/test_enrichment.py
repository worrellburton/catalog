#!/usr/bin/env python3
"""
Tests for the new product enrichment functions.
Run from the agents/product-scraper/ directory:
    python test_enrichment.py
No API keys or Supabase connection needed — tests only pure-Python functions.
"""

import sys, json

# ─── Import target functions ─────────────────────────────────────────────────

# We import from modal_app without triggering the Modal decorator machinery
# by patching the `modal` module before import.
import types

def _noop_decorator(*args, **kwargs):
    """Return the function unchanged — used for all Modal decorator stubs."""
    # Handles both @app.function (called with kw) and @modal.fastapi_endpoint
    if len(args) == 1 and callable(args[0]):
        return args[0]          # bare @decorator form
    return lambda f: f          # @decorator(**kwargs) form

class _FakeApp:
    def __init__(self, name):
        self.name = name
    def function(self, **kw):
        return lambda f: f

class _FakeImage:
    def debian_slim(self, **kw): return self
    def pip_install(self, *a, **kw): return self
    def run_commands(self, *a): return self
    def add_local_file(self, *a): return self

modal_stub = types.ModuleType("modal")
modal_stub.App = _FakeApp
modal_stub.Image = _FakeImage()
modal_stub.Secret = type("Secret", (), {"from_name": staticmethod(lambda n: n)})()
modal_stub.Cron = lambda *a: None
modal_stub.fastapi_endpoint = _noop_decorator
sys.modules["modal"] = modal_stub

# Playwright stub — not installed in test env
_pw_sync = types.ModuleType("playwright.sync_api")
_pw_sync.sync_playwright = None
_pw_sync.Page = None
_pw_sync.Browser = None
sys.modules["playwright"] = types.ModuleType("playwright")
sys.modules["playwright.sync_api"] = _pw_sync
sys.modules.setdefault("supabase", types.ModuleType("supabase"))
sys.modules.setdefault("requests", types.ModuleType("requests"))
sys.modules.setdefault("anthropic", types.ModuleType("anthropic"))
_dotenv = types.ModuleType("dotenv")
_dotenv.load_dotenv = lambda: None
sys.modules["dotenv"] = _dotenv

from modal_app import parse_materials, compute_confidence_scores

# ─── Helpers ─────────────────────────────────────────────────────────────────

PASS = "✅"
FAIL = "❌"
results = []

def test(name, got, expected=None, check=None):
    ok = check(got) if check else got == expected
    status = PASS if ok else FAIL
    results.append(ok)
    if not ok:
        print(f"{status} FAIL  {name}")
        print(f"       got:      {json.dumps(got, default=str)[:200]}")
        if expected is not None:
            print(f"       expected: {json.dumps(expected, default=str)[:200]}")
    else:
        print(f"{status}  {name}")


# ─── parse_materials() ────────────────────────────────────────────────────────

print("\n── parse_materials() ─────────────────────────────────────")

test(
    "standard percentage format",
    parse_materials("75% cotton, 25% polyester"),
    check=lambda r: r is not None
        and len(r) == 2
        and any(m["fiber"] == "cotton" and m["percentage"] == 75 for m in r)
        and any(m["fiber"] == "polyester" and m["percentage"] == 25 for m in r),
)

test(
    "fiber-first format",
    parse_materials("Cotton 100%"),
    check=lambda r: r is not None
        and len(r) >= 1
        and r[0]["fiber"] == "cotton"
        and r[0]["percentage"] == 100,
)

test(
    "slash separator",
    parse_materials("75% Wool / 25% Lyocell. Dry clean only."),
    check=lambda r: r is not None
        and any(m["fiber"] == "wool" and m["percentage"] == 75 for m in r)
        and any(m["fiber"] == "lyocell" and m["percentage"] == 25 for m in r),
)

test(
    "TENCEL trade name",
    parse_materials("100% TENCEL™ Lyocell"),
    check=lambda r: r is not None and len(r) >= 1,
)

test(
    "none returns None",
    parse_materials(None),
    expected=None,
)

test(
    "empty string returns None",
    parse_materials(""),
    expected=None,
)

test(
    "three fibers",
    parse_materials("80% cotton, 15% polyester, 5% elastane"),
    check=lambda r: r is not None and len(r) == 3,
)

test(
    "no percentages → still finds fiber names",
    parse_materials("Shell: Leather. Lining: Cotton."),
    check=lambda r: r is not None and len(r) >= 1,
)

test(
    "multi-part composition",
    parse_materials("Body: 95% Cotton, 5% Elastane. Rib: 100% Cotton."),
    check=lambda r: r is not None and len(r) >= 2,
)

# ─── compute_confidence_scores() ─────────────────────────────────────────────

print("\n── compute_confidence_scores() ────────────────────────────")

full_product = {
    "price": "$129.99",
    "brand": "Zara",
    "size_chart": {"M": {"chest_cm": 102, "waist_cm": 86}},
    "variants": [{"size": "S", "color": "Black"}, {"size": "M", "color": "Black"}, {"size": "L", "color": "Black"}],
    "materials_detail": [{"fiber": "cotton", "percentage": 75}],
    "size_fit": "Slim fit. Fits true to size.",
    "fit_intelligence": {"fit_type": "slim"},
    "type": "Top",
    "gender": "female",
    "images": ["a.jpg", "b.jpg", "c.jpg"],
}

scores = compute_confidence_scores(full_product)

test("returns dict", scores, check=lambda s: isinstance(s, dict))
test("price score high (has price)", scores.get("price", 0), check=lambda s: s >= 0.9)
test("brand score present", scores.get("brand", 0), check=lambda s: s >= 0.8)
test("size_chart score present", scores.get("size_chart", 0), check=lambda s: s >= 0.8)
test("variants score present (3 variants)", scores.get("variants", 0), check=lambda s: s >= 0.6)
test("materials score high (has percentages)", scores.get("materials", 0), check=lambda s: s >= 0.8)
test("size_fit score present", scores.get("size_fit", 0), check=lambda s: s >= 0.7)
test("fit_intelligence score present", scores.get("fit_intelligence", 0), check=lambda s: s >= 0.6)
test("type score present", scores.get("type", 0), check=lambda s: s >= 0.8)
test("gender score present", scores.get("gender", 0), check=lambda s: s >= 0.7)
test("images score high (3 images)", scores.get("images", 0), check=lambda s: s >= 0.9)

# Sparse product (missing most fields)
sparse = {"images": ["a.jpg"]}
sparse_scores = compute_confidence_scores(sparse)

test("sparse: price score 0", sparse_scores.get("price", -1), expected=0.0)
test("sparse: brand score 0", sparse_scores.get("brand", -1), expected=0.0)
test("sparse: size_chart score 0", sparse_scores.get("size_chart", -1), expected=0.0)
test("sparse: images score < 0.9 (1 image)", sparse_scores.get("images", 0), check=lambda s: 0.5 <= s < 0.9)

# ─── Tool schema validation ───────────────────────────────────────────────────

print("\n── TOOLS schema ────────────────────────────────────────────")

# Import agent — its module-level code only defines constants, no I/O
# playwright and dotenv already stubbed above

import importlib.util, pathlib
spec = importlib.util.spec_from_file_location(
    "agent",
    str(pathlib.Path(__file__).parent / "agent.py"),
)
agent_mod = importlib.util.module_from_spec(spec)
# Patch init
agent_mod.__builtins__ = __builtins__
try:
    spec.loader.exec_module(agent_mod)
    TOOLS = agent_mod.TOOLS
    tool_names = [t["name"] for t in TOOLS]
    test("get_variants tool present", "get_variants" in tool_names, expected=True)
    test("get_size_chart tool present", "get_size_chart" in tool_names, expected=True)
    test("save_product variants field present",
         "variants" in TOOLS[-1]["input_schema"]["properties"],
         expected=True)
    test("save_product size_chart field present",
         "size_chart" in TOOLS[-1]["input_schema"]["properties"],
         expected=True)
    test("save_product materials_detail field present",
         "materials_detail" in TOOLS[-1]["input_schema"]["properties"],
         expected=True)
    test("save_product product_category field present",
         "product_category" in TOOLS[-1]["input_schema"]["properties"],
         expected=True)
    test("correct tool count (8 tools)",
         len(TOOLS),
         expected=8)
    print(f"   Tool list: {tool_names}")
except Exception as e:
    print(f"{FAIL}  Could not import agent: {e}")
    results.append(False)

# ─── Summary ─────────────────────────────────────────────────────────────────

print("\n" + "─" * 55)
passed = sum(results)
total = len(results)
print(f"{'✅ ALL PASS' if passed == total else '❌ FAILURES'} — {passed}/{total} tests passed")
if passed < total:
    sys.exit(1)
