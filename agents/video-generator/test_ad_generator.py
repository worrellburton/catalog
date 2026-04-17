"""
Live test for the ad video generator.

Usage:
    cd agents/video-generator
    python test_ad_generator.py                  # all tests including Veo
    python test_ad_generator.py --skip-generation # fast tests only

Tests against real Supabase + Veo APIs (requires .env with valid credentials).
"""

import os
import json
import sys
import time

from dotenv import load_dotenv

load_dotenv()

from supabase import create_client


def find_test_product(supabase) -> dict | None:
    """Find a scraped product with multiple images for best coverage."""
    rows = (
        supabase.table("products")
        .select("id, name, brand, images, image_url, url, description")
        .eq("scrape_status", "done")
        .limit(20)
        .execute()
    )
    if not rows.data:
        return None

    # Sort by number of images (prefer more)
    candidates = sorted(
        rows.data,
        key=lambda p: len(p.get("images") or []),
        reverse=True,
    )
    return candidates[0]


def create_test_ad(supabase, product_id: str, style: str = "studio_clean") -> str:
    """Insert a pending product_ad row and return its ID."""
    row = (
        supabase.table("product_ads")
        .insert({
            "product_id": product_id,
            "style": style,
            "status": "pending",
        })
        .execute()
    )
    return row.data[0]["id"]


def cleanup_ad(supabase, ad_id: str):
    """Delete the test ad and its storage file."""
    ad = supabase.table("product_ads").select("storage_path").eq("id", ad_id).single().execute().data
    if ad and ad.get("storage_path"):
        try:
            supabase.storage.from_("look-media").remove([ad["storage_path"]])
        except Exception:
            pass
    supabase.table("product_ads").delete().eq("id", ad_id).execute()


def test_prompt_building():
    """Test: prompts include image context for multi-image products."""
    print("\n" + "=" * 60)
    print("TEST: Prompt building with image context")
    print("=" * 60)

    from ad_generator import _build_image_context, _summarise_product, AD_PROMPT_TEMPLATES

    # No images — no extra context
    ctx_none = _build_image_context([], 0, 0)
    assert ctx_none == "", f"Expected empty context, got: {ctx_none}"
    print("  ✓ No images: no context")

    # Single image
    ctx_single = _build_image_context(["http://img1.jpg"], 1, 1)
    assert "reference" in ctx_single.lower(), f"Expected reference mention, got: {ctx_single}"
    print(f"  ✓ Single image context: {ctx_single[:60]}…")

    # Multiple images
    ctx_multi = _build_image_context(["a", "b", "c"], 3, 10)
    assert "3 of 10" in ctx_multi, f"Expected '3 of 10' in: {ctx_multi}"
    print(f"  ✓ Multi image context: {ctx_multi[:80]}…")

    # Template formatting works
    product = {"name": "Test Jacket", "brand": "TestBrand", "description": "A nice jacket"}
    desc = _summarise_product(product)
    template = AD_PROMPT_TEMPLATES["studio_clean"]
    prompt = template.format(product_desc=desc, image_context=ctx_multi)
    assert "Test Jacket" in prompt
    print(f"  ✓ Full prompt includes product + image context")

    return {"test": "prompt_building", "success": True}


def test_image_selection():
    """Test: image selection picks different sets for different ad indices."""
    print("\n" + "=" * 60)
    print("TEST: Image selection for multiple ads")
    print("=" * 60)

    from ad_generator import _pick_images_for_ad, MAX_REFERENCE_IMAGES

    # Test with 10 images
    images = [f"http://img{i}.jpg" for i in range(10)]

    set_0 = _pick_images_for_ad(images, 0)
    set_1 = _pick_images_for_ad(images, 1)
    set_2 = _pick_images_for_ad(images, 2)

    print(f"  Ad 0 gets: {set_0}")
    print(f"  Ad 1 gets: {set_1}")
    print(f"  Ad 2 gets: {set_2}")

    assert len(set_0) == MAX_REFERENCE_IMAGES
    assert len(set_1) == MAX_REFERENCE_IMAGES
    assert set_0 != set_1, "Different ads should get different image sets"
    print("  ✓ Different ads get different image sets")

    # Test with fewer images than MAX
    small = ["a.jpg", "b.jpg"]
    result = _pick_images_for_ad(small, 0)
    assert len(result) == 2
    print(f"  ✓ 2 images → picks 2: {result}")

    # Test with no images
    empty = _pick_images_for_ad([], 0)
    assert empty == []
    print("  ✓ No images → empty list")

    return {"test": "image_selection", "success": True}


def test_multi_image_cycling():
    """Test: verifies image cycling with real Supabase data."""
    print("\n" + "=" * 60)
    print("TEST: Multi-image cycling (real DB)")
    print("=" * 60)

    supabase = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])

    rows = (
        supabase.table("products")
        .select("id, name, brand, images, image_url")
        .eq("scrape_status", "done")
        .limit(20)
        .execute()
    )
    multi_image = [p for p in (rows.data or []) if len(p.get("images") or []) >= 3]
    if not multi_image:
        print("SKIP — no products with 3+ images found")
        return None

    product = multi_image[0]
    images = product.get("images", [])
    print(f"Product: {product.get('name')} ({product['id']})")
    print(f"  Total images: {len(images)}")

    # Create 2 ads
    ad_id_1 = create_test_ad(supabase, product["id"], "studio_clean")
    ad_id_2 = create_test_ad(supabase, product["id"], "street_style")

    from ad_generator import _get_product_images, _pick_images_for_ad, _get_ad_index_for_product

    all_images = _get_product_images(product)
    idx_1 = _get_ad_index_for_product(supabase, product["id"], ad_id_1)
    idx_2 = _get_ad_index_for_product(supabase, product["id"], ad_id_2)

    set_1 = _pick_images_for_ad(all_images, idx_1)
    set_2 = _pick_images_for_ad(all_images, idx_2)

    print(f"  Ad 1 (index {idx_1}): {len(set_1)} images → {[u[:40] for u in set_1]}")
    print(f"  Ad 2 (index {idx_2}): {len(set_2)} images → {[u[:40] for u in set_2]}")

    if len(all_images) >= 6:
        assert set_1 != set_2, "Expected different image sets"
        print("  ✓ Different image sets assigned")
    else:
        print("  ⚠ Not enough images for fully distinct sets (expected)")

    cleanup_ad(supabase, ad_id_1)
    cleanup_ad(supabase, ad_id_2)
    print("  Cleaned up test ads")

    return {
        "test": "multi_image_cycling",
        "success": True,
        "product": {"id": product["id"], "name": product.get("name"), "image_count": len(images)},
    }


def test_live_generation():
    """Test: generate a real ad video via Veo (costs ~$0.10)."""
    print("\n" + "=" * 60)
    print("TEST: Live ad generation (Veo API)")
    print("=" * 60)

    supabase = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])

    product = find_test_product(supabase)
    if not product:
        print("SKIP — no scraped products found")
        return None

    images = product.get("images") or []
    print(f"Product: {product.get('name')} ({product['id']})")
    print(f"  Brand: {product.get('brand')}")
    print(f"  Images: {len(images)}")
    for i, url in enumerate(images[:5]):
        print(f"    [{i}] {url[:80]}…")
    if len(images) > 5:
        print(f"    ... and {len(images) - 5} more")

    # Use studio_clean style (least likely to hit safety filters)
    ad_id = create_test_ad(supabase, product["id"], "studio_clean")
    print(f"\nCreated test ad: {ad_id}")

    from ad_generator import generate_ad_video

    start = time.time()
    try:
        result = generate_ad_video(ad_id)
    except Exception as e:
        elapsed = time.time() - start
        print(f"\nFAILED after {elapsed:.1f}s: {e}")
        return {"test": "live_generation", "success": False, "error": str(e), "ad_id": ad_id, "elapsed": elapsed}

    elapsed = time.time() - start
    print(f"\nCompleted in {elapsed:.1f}s")
    print(f"Result: {json.dumps(result, indent=2)}")

    # Verify DB record
    ad = supabase.table("product_ads").select("*").eq("id", ad_id).single().execute().data
    print(f"\nAd record:")
    print(f"  status: {ad['status']}")
    print(f"  video_url: {ad.get('video_url', 'N/A')}")
    print(f"  title: {ad.get('title', 'N/A')}")
    print(f"  cost_usd: ${ad.get('cost_usd', '?')}")
    print(f"  method: {result.get('method', '?')}")
    print(f"  images_sent: {result.get('images_sent', '?')}/{result.get('total_images', '?')}")

    assert ad["status"] == "done", f"Expected status=done, got {ad['status']}"
    assert ad.get("video_url"), "Missing video_url"

    return {
        "test": "live_generation",
        "success": True,
        "ad_id": ad_id,
        "product": {"id": product["id"], "name": product.get("name"), "image_count": len(images)},
        "result": result,
        "elapsed_seconds": round(elapsed, 1),
    }


if __name__ == "__main__":
    results = []

    # Fast unit tests (no API calls)
    results.append(test_prompt_building())
    results.append(test_image_selection())
    results.append(test_multi_image_cycling())

    # Live generation test (calls Veo — costs ~$0.10, takes 30s-6min)
    if "--skip-generation" not in sys.argv:
        results.append(test_live_generation())
    else:
        print("\nSkipping live generation test (--skip-generation)")

    # Summary
    print("\n" + "=" * 60)
    print("RESULTS")
    print("=" * 60)
    for r in results:
        if r is None:
            print("  SKIP")
        elif r.get("success"):
            print(f"  ✓ {r.get('test', '?')}")
        else:
            print(f"  ✗ {r.get('test', '?')}: {r.get('error', 'unknown')}")

    with open("test_ad_results.json", "w") as f:
        json.dump(results, f, indent=2, default=str)
    print("\nResults saved to test_ad_results.json")
