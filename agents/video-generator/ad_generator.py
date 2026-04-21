"""
Ad Video Generator — generates product ad videos via Veo + Gemini.

Flow:
  1. Fetch pending product_ads from Supabase
  2. For each ad: fetch product + ALL images, build prompt with Gemini
  3. Download up to 3 images and send as Veo reference images
  4. Generate video via Veo 3.1 Fast (reference_images mode)
  5. Retry with fewer images / text-only if safety filter blocks
  6. Upload to Supabase Storage
  7. Update product_ads row with video URL and status

Multi-image strategy:
  - Sends up to 3 product images as reference_images to Veo
  - Veo uses these to preserve product appearance in the video
  - If safety filter rejects, retries with single image, then text-only
  - Each ad for the same product cycles through different image sets
"""

import os
import time
from datetime import datetime, timezone

import httpx
from supabase import create_client

from config import STYLES, GENERATION_DEFAULTS, DEFAULT_STYLE
from prompts import enhance_prompt_with_gemini
from veo_client import (
    generate_video_with_references,
    generate_video_from_image,
    generate_video_from_text,
)
from seedance_client import (
    generate_video_from_image_url as seedance_from_image_url,
    generate_video_from_text as seedance_from_text,
    generate_from_fal_model,
)
from video_crop import crop_to_aspect


# Max images to send as references (Veo limit = 3)
MAX_REFERENCE_IMAGES = 3

AD_PROMPT_TEMPLATES = {
    "studio_clean": (
        "Commercial product advertisement, {product_desc}. "
        "{image_context}"
        "Clean white studio background, soft even lighting. "
        "Camera slowly orbits and zooms into the product. "
        "Luxurious commercial feel, high-end brand aesthetic. Subtle sparkle effects."
    ),
    "editorial_runway": (
        "High fashion product ad, {product_desc}. "
        "{image_context}"
        "Dramatic lighting, slow reveal, camera tracking shot. "
        "Premium brand commercial style. Cinematic color grading."
    ),
    "street_style": (
        "Urban product ad, {product_desc}. "
        "{image_context}"
        "Dynamic camera movement through city streets. "
        "Natural daylight, vibrant colors. Young, energetic commercial aesthetic."
    ),
    "lifestyle_context": (
        "Lifestyle product ad, {product_desc}. "
        "{image_context}"
        "Beautiful real-world setting, warm golden hour lighting. "
        "Aspirational lifestyle commercial, bokeh background."
    ),
}

# Variation hints injected per image index for creative diversity
IMAGE_VARIATION_HINTS = [
    "Focus on the product's front view and key details. ",
    "Emphasize texture, material quality, and craftsmanship close-up. ",
    "Show the product in motion with dynamic angles and reveal. ",
    "Highlight the product's silhouette and overall form from a distance. ",
    "Capture the product's color and finish under dramatic lighting. ",
]


def _summarise_product(product: dict) -> str:
    parts = []
    if product.get("name"):
        parts.append(product["name"])
    if product.get("brand"):
        parts.append(f"by {product['brand']}")
    if product.get("description"):
        parts.append(f"— {product['description'][:150]}")
    return " ".join(parts) if parts else "a fashion product"


def _get_product_images(product: dict) -> list[str]:
    """Extract all available image URLs from a product."""
    images = []
    if product.get("images") and isinstance(product["images"], list):
        images.extend([url for url in product["images"] if url])
    if product.get("image_url") and product["image_url"] not in images:
        images.append(product["image_url"])
    return images


def _pick_images_for_ad(images: list[str], ad_index: int) -> list[str]:
    """Pick up to MAX_REFERENCE_IMAGES for this ad, cycling through available images.

    Each ad variant starts at a different offset to use different image sets.
    """
    if not images:
        return []
    n = len(images)
    offset = (ad_index * MAX_REFERENCE_IMAGES) % n
    picked = []
    for i in range(min(MAX_REFERENCE_IMAGES, n)):
        picked.append(images[(offset + i) % n])
    return picked


def _build_image_context(images: list[str], selected_count: int, total_count: int) -> str:
    """Build context string describing the reference images."""
    if selected_count == 0:
        return ""
    if total_count <= 1:
        return "Using the product photo as reference. "
    return (
        f"Using {selected_count} of {total_count} product photos as reference images "
        f"to accurately represent the product's appearance, color, and details. "
    )


def _download_image(url: str) -> tuple[bytes, str]:
    """Download image and return (bytes, mime_type)."""
    resp = httpx.get(url, timeout=30, follow_redirects=True)
    resp.raise_for_status()
    mime = resp.headers.get("content-type", "image/jpeg").split(";")[0]
    return (resp.content, mime)


def _download_images(urls: list[str]) -> list[tuple[bytes, str]]:
    """Download multiple images, skipping failures."""
    results = []
    for url in urls:
        try:
            img_bytes, mime = _download_image(url)
            results.append((img_bytes, mime))
        except Exception as e:
            print(f"    ⚠ Failed to download {url[:60]}…: {e}")
    return results


def _get_ad_index_for_product(supabase, product_id: str, ad_id: str) -> int:
    """Determine this ad's index among all ads for the same product."""
    rows = (
        supabase.table("product_ads")
        .select("id")
        .eq("product_id", product_id)
        .order("created_at")
        .execute()
        .data
    )
    for i, row in enumerate(rows or []):
        if row["id"] == ad_id:
            return i
    return 0


def _generate_with_retry(
    images_data: list[tuple[bytes, str]],
    prompt: str,
    style_cfg: dict,
    image_urls: list[str] | None = None,
    model_override: str | None = None,
) -> tuple[bytes, str]:
    """Try generation with reference images, then single image, then text-only.

    Returns (video_bytes, method_used).
    """
    model = model_override or GENERATION_DEFAULTS["model"]
    aspect = style_cfg.get("aspect_ratio", GENERATION_DEFAULTS["aspect_ratio"])

    # Seedance path (fal.ai) — uses URL directly, no reference-images concept
    is_seedance = (
        model.startswith("seedance-")
        or model.startswith("bytedance/seedance")
        or model.startswith("fal-ai/bytedance/seedance")
    )
    if is_seedance:
        seedance_model = model if "/" in model else f"bytedance/{model}"
        # Drop falsy entries (None, empty string) — Rainforest/SerpAPI sometimes
        # return search results without an image, and passing image_url=None to
        # fal.ai produces a "Field required, loc: ['body', 'image_url']" error.
        usable = [u for u in (image_urls or []) if isinstance(u, str) and u.strip()]
        if usable:
            try:
                print(f"    → Trying Seedance image-to-video ({seedance_model})…")
                video_bytes = seedance_from_image_url(
                    image_url=usable[0],
                    prompt=prompt,
                    model=seedance_model,
                    duration=style_cfg.get("duration", 5),
                    aspect_ratio=aspect,
                )
                return (video_bytes, f"seedance_image:{seedance_model}")
            except Exception as e:
                print(f"    ⚠ Seedance image-to-video failed: {e}")
        print("    → Falling back to Seedance text-only…")
        video_bytes = seedance_from_text(
            prompt=prompt,
            model=seedance_model,
            duration=style_cfg.get("duration", 5),
            aspect_ratio=aspect,
        )
        return (video_bytes, f"seedance_text:{seedance_model}")

    # Generic fal.ai path — any non-Seedance fal slug
    # (Kling, Sora, PixVerse, MiniMax Hailuo, Wan, LTX, Veo via fal, Vidu, …)
    if model.startswith("fal-ai/") or model.startswith("bytedance/"):
        usable = [u for u in (image_urls or []) if isinstance(u, str) and u.strip()]
        print(f"    → Trying fal.ai model: {model} (with {len(usable)} image(s))")
        video_bytes = generate_from_fal_model(
            fal_slug=model,
            prompt=prompt,
            image_url=usable[0] if usable else None,
            image_urls=usable,  # Multi-image models (Vidu reference-to-video) read this.
            duration=style_cfg.get("duration", 5),
            aspect_ratio=aspect,
        )
        return (video_bytes, f"fal:{model}")

    # Strategy 1: Multiple reference images (best quality)
    if len(images_data) >= 2:
        try:
            print(f"    → Trying with {len(images_data)} reference images…")
            video_bytes = generate_video_with_references(
                images=images_data,
                prompt=prompt,
                model=model,
                aspect_ratio=aspect,
                person_generation=GENERATION_DEFAULTS["person_generation"],
            )
            return (video_bytes, f"{len(images_data)}_references")
        except RuntimeError as e:
            print(f"    ⚠ Reference images rejected: {e}")

    # Strategy 2: Single image as first frame
    if images_data:
        try:
            print("    → Retrying with single image (first frame)…")
            video_bytes = generate_video_from_image(
                image_bytes=images_data[0][0],
                image_mime=images_data[0][1],
                prompt=prompt,
                model=model,
                duration=style_cfg.get("duration", GENERATION_DEFAULTS["duration"]),
                aspect_ratio=aspect,
                resolution=GENERATION_DEFAULTS["resolution"],
                person_generation=GENERATION_DEFAULTS["person_generation"],
            )
            return (video_bytes, "single_image")
        except RuntimeError as e:
            print(f"    ⚠ Single image rejected: {e}")

    # Strategy 3: Text-only (always works)
    print("    → Falling back to text-only generation…")
    video_bytes = generate_video_from_text(
        prompt=prompt,
        model=model,
        duration=style_cfg.get("duration", GENERATION_DEFAULTS["duration"]),
        aspect_ratio=aspect,
    )
    return (video_bytes, "text_only")


def generate_ad_video(ad_id: str) -> dict:
    """Generate a single ad video by ad ID.

    Downloads up to 3 product images and sends them all as Veo reference images.
    Falls back to single image or text-only if safety filters block.
    """
    supabase = create_client(
        os.environ["SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_ROLE_KEY"],
    )

    # Fetch ad with product
    ad = (
        supabase.table("product_ads")
        .select("*, product:products(*)")
        .eq("id", ad_id)
        .single()
        .execute()
        .data
    )
    if not ad:
        raise ValueError(f"Ad {ad_id} not found")

    product = ad.get("product")
    if not product:
        raise ValueError(f"Product not found for ad {ad_id}")

    style = ad.get("style", DEFAULT_STYLE)
    style_cfg = STYLES.get(style, STYLES[DEFAULT_STYLE])

    try:
        # Mark as generating
        supabase.table("product_ads").update({"status": "generating"}).eq("id", ad_id).execute()

        # Collect all product images
        all_images = _get_product_images(product)
        print(f"  Product has {len(all_images)} image(s)")

        # Multi-reference models (Vidu reference-to-video) want every product
        # image fed in at once — no per-ad cycling. fal.ai's Vidu caps at 3
        # reference images, so trim aggressively even though direct Vidu
        # would accept up to 7.
        ad_model_for_image_pick = ad.get("veo_model") or ""
        if "reference-to-video" in ad_model_for_image_pick:
            selected_urls = list(all_images[:3])
            print(f"  Multi-reference model: passing {len(selected_urls)} image(s)")
        else:
            # Pick images for this specific ad (cycles through for different ads)
            ad_index = _get_ad_index_for_product(supabase, ad["product_id"], ad_id)
            selected_urls = _pick_images_for_ad(all_images, ad_index)
            print(f"  Selected {len(selected_urls)} images for ad (index {ad_index})")
        for i, url in enumerate(selected_urls):
            print(f"    [{i}] {url[:80]}…")

        # Download all selected images
        images_data = _download_images(selected_urls)
        print(f"  Downloaded {len(images_data)}/{len(selected_urls)} images")

        # Build prompt with image context
        product_desc = _summarise_product(product)
        image_context = _build_image_context(all_images, len(images_data), len(all_images))
        template = AD_PROMPT_TEMPLATES.get(style, AD_PROMPT_TEMPLATES["studio_clean"])
        raw_prompt = template.format(
            product_desc=product_desc,
            image_context=image_context,
        )

        # Enhance with Gemini
        enhanced_prompt = enhance_prompt_with_gemini(raw_prompt, product, None)
        supabase.table("product_ads").update({"prompt": enhanced_prompt}).eq("id", ad_id).execute()

        # Respect per-ad model override (e.g. user chose Seedance instead of Veo)
        ad_model = ad.get("veo_model")

        # Record the model that will actually be used so UI can show it
        if ad_model:
            supabase.table("product_ads").update({"veo_model": ad_model}).eq("id", ad_id).execute()

        # Generate video with retry cascade
        print(f"  Generating ad video [{style}] for: {product.get('name', 'unknown')} (model={ad_model or 'default'})")
        video_bytes, method = _generate_with_retry(
            images_data, enhanced_prompt, style_cfg,
            image_urls=selected_urls,
            model_override=ad_model,
        )
        print(f"  Generated via: {method}")

        # Crop to 3:4 (feed card aspect ratio) — Veo only outputs 9:16 or 16:9
        try:
            video_bytes = crop_to_aspect(video_bytes, 3, 4)
            print("  Cropped to 3:4 aspect ratio")
        except Exception as e:
            print(f"  ⚠ Crop failed, using original: {e}")

        # Upload to storage
        product_id = ad.get("product_id", "unknown")
        ts = int(datetime.now(timezone.utc).timestamp())
        storage_path = f"ads/{product_id}/{style}_{method}_{ts}.mp4"
        supabase.storage.from_("look-media").upload(
            storage_path, video_bytes, {"content-type": "video/mp4"}
        )
        video_url = supabase.storage.from_("look-media").get_public_url(storage_path)

        # Set affiliate URL from product URL if not already set
        affiliate_url = ad.get("affiliate_url") or product.get("url")

        # Estimate cost (reference images = 8s duration at fast pricing)
        cost = _estimate_cost(GENERATION_DEFAULTS["model"], GENERATION_DEFAULTS["resolution"])

        # Update ad as done
        supabase.table("product_ads").update({
            "status": "done",
            "video_url": video_url,
            "storage_path": storage_path,
            "affiliate_url": affiliate_url,
            "cost_usd": cost,
            "title": f"{product.get('name', 'Product')} — {style.replace('_', ' ').title()} ({method})",
            "completed_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", ad_id).execute()

        print(f"  ✓ Done — ad {ad_id} | {method} | {video_url}")
        return {
            "success": True,
            "ad_id": ad_id,
            "video_url": video_url,
            "method": method,
            "images_sent": len(images_data),
            "total_images": len(all_images),
        }

    except Exception as e:
        supabase.table("product_ads").update({
            "status": "failed",
            "error": str(e)[:500],
            "completed_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", ad_id).execute()
        print(f"  ✗ Failed: {e}")
        raise


def process_pending_ads() -> list[dict]:
    """Process all pending ad generation jobs."""
    supabase = create_client(
        os.environ["SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_ROLE_KEY"],
    )

    pending = supabase.table("product_ads").select("id").eq("status", "pending").order("created_at").execute().data
    if not pending:
        print("No pending ad jobs.")
        return []

    print(f"Processing {len(pending)} pending ad jobs...")
    results = []
    for row in pending:
        try:
            result = generate_ad_video(row["id"])
            results.append(result)
        except Exception as e:
            results.append({"success": False, "ad_id": row["id"], "error": str(e)})

    return results


def _estimate_cost(model: str, resolution: str) -> float:
    pricing = {
        "veo-3.1-fast-generate-preview": {"720p": 0.10, "1080p": 0.12},
        "veo-3.1-generate-preview": {"720p": 0.40, "1080p": 0.40},
        "veo-3.1-lite-generate-preview": {"720p": 0.05, "1080p": 0.08},
    }
    return pricing.get(model, {}).get(resolution, 0.10)


if __name__ == "__main__":
    from dotenv import load_dotenv
    load_dotenv()
    results = process_pending_ads()
    for r in results:
        status = "✓" if r.get("success") else "✗"
        print(f"  {status} {r.get('ad_id', '?')}: {r.get('video_url') or r.get('error', 'unknown')}")
