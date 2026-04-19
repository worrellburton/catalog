"""
Seedance (ByteDance) video generation client via fal.ai.

Seedance advantages over Veo:
  - No Tier 1 rate limits — pay per clip via fal.ai
  - Accepts image URLs directly (no download/upload step)
  - Higher per-day throughput

Limitations vs Veo:
  - No audio (silent video)
  - Max 12s duration

fal.ai model IDs:
  - fal-ai/bytedance/seedance/v1/pro/image-to-video
  - fal-ai/bytedance/seedance/v1/pro/text-to-video
  - fal-ai/bytedance/seedance/v1/lite/image-to-video
  - fal-ai/bytedance/seedance/v1/lite/text-to-video

Legacy model strings ("seedance-1-pro", "bytedance/seedance-1-pro", etc.)
are mapped to the correct fal.ai endpoint automatically.
"""

import os
import httpx
import fal_client


def _ensure_auth() -> None:
    if not os.environ.get("FAL_KEY"):
        raise RuntimeError("FAL_KEY not set in Modal secret")


def _fal_model_id(model: str, mode: str) -> str:
    """Map legacy model names to fal.ai model IDs. `mode` = image-to-video | text-to-video."""
    if model.startswith("fal-ai/"):
        return model
    variant = "lite" if "lite" in model else "pro"
    return f"fal-ai/bytedance/seedance/v1/{variant}/{mode}"


def _download(url: str) -> bytes:
    resp = httpx.get(url, timeout=60, follow_redirects=True)
    resp.raise_for_status()
    return resp.content


def _extract_video_url(result: dict) -> str:
    video = result.get("video") or {}
    url = video.get("url")
    if not url:
        raise RuntimeError(f"Unexpected fal.ai output format: {result}")
    return url


def generate_video_from_image_url(
    image_url: str,
    prompt: str,
    *,
    model: str = "bytedance/seedance-1-pro",
    duration: int = 5,
    resolution: str = "720p",
    aspect_ratio: str = "9:16",
) -> bytes:
    """Submit image-to-video job to fal.ai and return downloaded video bytes."""
    _ensure_auth()
    fal_model = _fal_model_id(model, "image-to-video")

    result = fal_client.subscribe(
        fal_model,
        arguments={
            "prompt": prompt,
            "image_url": image_url,
            "duration": str(duration),
            "resolution": resolution,
            "aspect_ratio": aspect_ratio,
        },
    )
    return _download(_extract_video_url(result))


def generate_video_from_text(
    prompt: str,
    *,
    model: str = "bytedance/seedance-1-pro",
    duration: int = 5,
    resolution: str = "720p",
    aspect_ratio: str = "9:16",
) -> bytes:
    """Text-only Seedance fallback."""
    _ensure_auth()
    fal_model = _fal_model_id(model, "text-to-video")

    result = fal_client.subscribe(
        fal_model,
        arguments={
            "prompt": prompt,
            "duration": str(duration),
            "resolution": resolution,
            "aspect_ratio": aspect_ratio,
        },
    )
    return _download(_extract_video_url(result))
