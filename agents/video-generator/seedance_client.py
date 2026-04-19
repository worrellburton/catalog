"""
Seedance (ByteDance) video generation client via Replicate.

Seedance advantages over Veo:
  - No Tier 1 rate limits — pay per clip via Replicate
  - Accepts image URLs directly (no download/upload step)
  - Higher per-day throughput

Limitations vs Veo:
  - No audio (silent video)
  - Max 10s duration

Models:
  - bytedance/seedance-1-pro  (higher quality, ~$0.50-1.00/clip)
  - bytedance/seedance-1-lite (faster/cheaper)
"""

import os
import httpx
import replicate


MAX_POLL_SECONDS = 420  # 7 min


def generate_video_from_image_url(
    image_url: str,
    prompt: str,
    *,
    model: str = "bytedance/seedance-1-pro",
    duration: int = 5,
    resolution: str = "720p",
    aspect_ratio: str = "9:16",
) -> bytes:
    """Submit image-to-video job to Replicate and return downloaded video bytes."""
    api_token = os.environ.get("REPLICATE_API_TOKEN")
    if not api_token:
        raise RuntimeError("REPLICATE_API_TOKEN not set in Modal secret")

    client = replicate.Client(api_token=api_token)

    output = client.run(
        model,
        input={
            "prompt": prompt,
            "image": image_url,
            "duration": duration,
            "resolution": resolution,
            "aspect_ratio": aspect_ratio,
        },
    )

    # Replicate returns a FileOutput object or URL string
    if hasattr(output, "read"):
        return output.read()
    if isinstance(output, str):
        resp = httpx.get(output, timeout=60, follow_redirects=True)
        resp.raise_for_status()
        return resp.content
    if isinstance(output, list) and output:
        url = output[0] if isinstance(output[0], str) else str(output[0])
        resp = httpx.get(url, timeout=60, follow_redirects=True)
        resp.raise_for_status()
        return resp.content
    raise RuntimeError(f"Unexpected Replicate output format: {type(output)}")


def generate_video_from_text(
    prompt: str,
    *,
    model: str = "bytedance/seedance-1-pro",
    duration: int = 5,
    resolution: str = "720p",
    aspect_ratio: str = "9:16",
) -> bytes:
    """Text-only Seedance fallback."""
    api_token = os.environ.get("REPLICATE_API_TOKEN")
    if not api_token:
        raise RuntimeError("REPLICATE_API_TOKEN not set in Modal secret")

    client = replicate.Client(api_token=api_token)

    output = client.run(
        model,
        input={
            "prompt": prompt,
            "duration": duration,
            "resolution": resolution,
            "aspect_ratio": aspect_ratio,
        },
    )

    if hasattr(output, "read"):
        return output.read()
    if isinstance(output, str):
        resp = httpx.get(output, timeout=60, follow_redirects=True)
        resp.raise_for_status()
        return resp.content
    if isinstance(output, list) and output:
        url = output[0] if isinstance(output[0], str) else str(output[0])
        resp = httpx.get(url, timeout=60, follow_redirects=True)
        resp.raise_for_status()
        return resp.content
    raise RuntimeError(f"Unexpected Replicate output format: {type(output)}")
