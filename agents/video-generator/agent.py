"""
Video Generator Agent — full pipeline.

Flow:
  1. Fetch product from Supabase
  2. Fetch AI model (if specified) for persona/face reference
  3. Build and enhance Veo prompt
  4. Generate video via Veo 3.1 (image-to-video)
  5. Upload to Supabase Storage
  6. Create look + look_videos + look_products records
  7. Update generated_videos job row
"""

import os
import time
from datetime import datetime, timezone

import httpx
from supabase import create_client

from config import STYLES, GENERATION_DEFAULTS, DEFAULT_STYLE, DEFAULT_PERSONA, GENDER_PERSONA_MAP
from prompts import build_prompt, enhance_prompt_with_gemini
from veo_client import generate_video_from_image, generate_video_from_text
from video_crop import crop_to_aspect


def generate_video(
    product_id: str,
    style: str = DEFAULT_STYLE,
    persona: str = DEFAULT_PERSONA,
    ai_model_id: str | None = None,
    enhance_prompt: bool = True,
) -> dict:
    """
    Full pipeline: fetch product → fetch AI model → build prompt →
    generate video → upload → create look → return result.
    """
    supabase = create_client(
        os.environ["SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_ROLE_KEY"],
    )
    style_cfg = STYLES[style]

    # 1 — Fetch product
    row = supabase.table("products").select("*").eq("id", product_id).single().execute()
    product = row.data
    if not product:
        raise ValueError(f"Product {product_id} not found")
    if not product.get("images"):
        raise ValueError(f"Product {product_id} has no images — scrape it first")

    # 2 — Fetch AI model (if specified)
    ai_model = None
    creator_handle = None
    if ai_model_id:
        model_row = supabase.table("ai_models").select("*, creators(handle)").eq("id", ai_model_id).single().execute()
        ai_model = model_row.data
        if ai_model:
            # Use model's default style if no style was explicitly passed
            if style == DEFAULT_STYLE and ai_model.get("default_style"):
                style = ai_model["default_style"]
                style_cfg = STYLES.get(style, STYLES[DEFAULT_STYLE])
            # Resolve persona from model gender
            if ai_model.get("gender"):
                persona = GENDER_PERSONA_MAP.get(ai_model["gender"], DEFAULT_PERSONA)
            # Get creator handle for the look
            if ai_model.get("creators") and ai_model["creators"].get("handle"):
                creator_handle = ai_model["creators"]["handle"]
    else:
        # Pick a random active AI model if none specified
        models_result = supabase.table("ai_models").select("*, creators(handle)").eq("status", "active").eq("enabled", True).limit(1).execute()
        if models_result.data:
            ai_model = models_result.data[0]
            ai_model_id = ai_model["id"]
            if ai_model.get("gender"):
                persona = GENDER_PERSONA_MAP.get(ai_model["gender"], DEFAULT_PERSONA)
            if ai_model.get("creators") and ai_model["creators"].get("handle"):
                creator_handle = ai_model["creators"]["handle"]

    # 3 — Insert generated_videos job row (pending)
    job = supabase.table("generated_videos").insert({
        "product_id": product_id,
        "ai_model_id": ai_model_id,
        "style": style,
        "model_persona": persona,
        "veo_model": GENERATION_DEFAULTS["model"],
        "status": "pending",
        "duration_seconds": style_cfg["duration"],
        "aspect_ratio": style_cfg["aspect_ratio"],
        "resolution": GENERATION_DEFAULTS["resolution"],
    }).execute().data[0]
    job_id = job["id"]

    try:
        # 4 — Build prompt
        raw_prompt = build_prompt(product, style, persona, ai_model)
        prompt = enhance_prompt_with_gemini(raw_prompt, product, ai_model) if enhance_prompt else raw_prompt

        supabase.table("generated_videos").update({
            "status": "generating",
            "prompt": prompt,
        }).eq("id", job_id).execute()

        # 5 — Download best product image
        image_url = product["images"][0]
        img_resp = httpx.get(image_url, timeout=30, follow_redirects=True)
        img_resp.raise_for_status()
        image_bytes = img_resp.content
        mime_type = img_resp.headers.get("content-type", "image/jpeg").split(";")[0]

        # 6 — Generate video via Veo
        model_name = ai_model["name"] if ai_model else "default"
        print(f"  Generating video [{style}] model={model_name} for product: {product.get('name', product_id)}")

        video_bytes = generate_video_from_image(
            image_bytes=image_bytes,
            image_mime=mime_type,
            prompt=prompt,
            model=GENERATION_DEFAULTS["model"],
            duration=style_cfg["duration"],
            aspect_ratio=style_cfg["aspect_ratio"],
            resolution=GENERATION_DEFAULTS["resolution"],
            person_generation=GENERATION_DEFAULTS["person_generation"],
        )

        # Crop to 3:4 (feed card aspect ratio) — Veo only outputs 9:16 or 16:9
        try:
            video_bytes = crop_to_aspect(video_bytes, 3, 4)
            print("  Cropped to 3:4 aspect ratio")
        except Exception as e:
            print(f"  ⚠ Crop failed, using original: {e}")

        supabase.table("generated_videos").update({"status": "uploading"}).eq("id", job_id).execute()

        # 7 — Upload to Supabase Storage
        ts = int(datetime.now(timezone.utc).timestamp())
        storage_path = f"generated/{product_id}/{style}_{ts}.mp4"
        supabase.storage.from_("look-media").upload(
            storage_path, video_bytes, {"content-type": "video/mp4"}
        )
        video_url = supabase.storage.from_("look-media").get_public_url(storage_path)

        # 8 — Create look record (linked to AI model's creator)
        look_data = {
            "title": f"{product.get('name', 'Untitled')} — {style.replace('_', ' ').title()}",
            "description": product.get("description"),
            "status": "in_review",
            "enabled": False,
        }
        if creator_handle:
            look_data["creator_handle"] = creator_handle

        look = supabase.table("looks").insert(look_data).execute().data[0]
        look_id = look["id"]

        # 9 — Create look_videos entry
        supabase.table("look_videos").insert({
            "look_id": look_id,
            "order_index": 0,
            "storage_path": storage_path,
            "url": video_url,
            "duration_seconds": style_cfg["duration"],
        }).execute()

        # 10 — Link product to look
        supabase.table("look_products").insert({
            "look_id": look_id,
            "product_id": product_id,
            "sort_order": 0,
        }).execute()

        # 11 — Mark job done
        cost = _estimate_cost(GENERATION_DEFAULTS["model"], GENERATION_DEFAULTS["resolution"])
        supabase.table("generated_videos").update({
            "status": "done",
            "video_url": video_url,
            "storage_path": storage_path,
            "look_id": look_id,
            "cost_usd": cost,
            "completed_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", job_id).execute()

        # 12 — Increment AI model's looks_count
        if ai_model_id:
            supabase.rpc("increment_ai_model_looks", {"model_id": ai_model_id}).execute()

        print(f"  Done — look {look_id} | {video_url}")
        return {"success": True, "look_id": look_id, "video_url": video_url, "job_id": job_id}

    except Exception as e:
        supabase.table("generated_videos").update({
            "status": "failed",
            "error": str(e)[:500],
            "completed_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", job_id).execute()
        print(f"  Failed: {e}")
        raise


def _estimate_cost(model: str, resolution: str) -> float:
    """Rough cost estimate per video in USD."""
    pricing = {
        "veo-3.1-fast-generate-preview": {"720p": 0.10, "1080p": 0.12},
        "veo-3.1-generate-preview": {"720p": 0.40, "1080p": 0.40},
        "veo-3.1-lite-generate-preview": {"720p": 0.05, "1080p": 0.08},
    }
    return pricing.get(model, {}).get(resolution, 0.10)
