"""
Seedance (ByteDance) video generation client via fal.ai.

Seedance advantages over Veo:
  - No Tier 1 rate limits — pay per clip via fal.ai
  - Accepts image URLs directly (no download/upload step)
  - Higher per-day throughput

Per-version notes:
  - v1: silent video, 2-12s duration, 480p/720p/1080p
  - v2: synchronized audio (generate_audio=true default), 4-15s, 480p/720p

fal.ai model IDs:
  v1:
    - fal-ai/bytedance/seedance/v1/pro/image-to-video
    - fal-ai/bytedance/seedance/v1/pro/text-to-video
    - fal-ai/bytedance/seedance/v1/lite/image-to-video
    - fal-ai/bytedance/seedance/v1/lite/text-to-video
  v2:
    - bytedance/seedance-2.0/image-to-video
    - bytedance/seedance-2.0/text-to-video

Legacy model strings ("seedance-1-pro", "seedance-2", etc.) are
mapped to the correct fal.ai endpoint automatically.
"""

import os
import httpx
import fal_client


def _ensure_auth() -> None:
    if not os.environ.get("FAL_KEY"):
        raise RuntimeError("FAL_KEY not set in Modal secret")


def _fal_model_id(model: str, mode: str) -> str:
    """Map legacy model names to fal.ai model IDs. `mode` = image-to-video | text-to-video."""
    # Already a full fal slug (has a concrete endpoint path) — pass through
    if model.startswith("fal-ai/") or model.startswith("bytedance/seedance-2.0/"):
        return model
    # v2 shorthand — covers "seedance-2", "bytedance/seedance-2", "seedance-2-foo"
    if "seedance-2" in model:
        return f"bytedance/seedance-2.0/{mode}"
    # v1 variants
    variant = "lite" if "lite" in model else "pro"
    return f"fal-ai/bytedance/seedance/v1/{variant}/{mode}"


def _download(url: str) -> bytes:
    resp = httpx.get(url, timeout=60, follow_redirects=True)
    resp.raise_for_status()
    return resp.content


def _extract_video_url(result: dict) -> str:
    """Best-effort extraction that handles the common fal.ai response shapes."""
    if not isinstance(result, dict):
        raise RuntimeError(f"Unexpected fal.ai output (not a dict): {result}")
    # Shape 1: {"video": {"url": "..."}}
    video = result.get("video")
    if isinstance(video, dict) and video.get("url"):
        return video["url"]
    # Shape 2: {"video": "https://..."}
    if isinstance(video, str) and video:
        return video
    # Shape 3: {"videos": [{"url": "..."}]} or [{..., "url"}, ...]
    videos = result.get("videos")
    if isinstance(videos, list) and videos:
        first = videos[0]
        if isinstance(first, dict) and first.get("url"):
            return first["url"]
        if isinstance(first, str):
            return first
    # Shape 4: {"output": {"video": {...}}} (rare)
    output = result.get("output")
    if isinstance(output, dict):
        nested = _safe_extract_url(output)
        if nested:
            return nested
    raise RuntimeError(f"Unexpected fal.ai output format: {result}")


def _safe_extract_url(d: dict) -> str | None:
    v = d.get("video")
    if isinstance(v, dict) and v.get("url"):
        return v["url"]
    if isinstance(v, str):
        return v
    return None


def _is_v2(fal_model: str) -> bool:
    return fal_model.startswith("bytedance/seedance-2")


def _is_veo(fal_model: str) -> bool:
    """True when the fal slug is one of the Veo-via-fal endpoints.

    Veo uses a different input schema than Seedance: duration is a string
    literal like '4s' / '6s' / '8s' (not a bare number) and is rejected
    with a `literal_error` otherwise.
    """
    return "veo" in fal_model.lower()


# Veo 3.1 via fal.ai only accepts these exact duration strings. Anything
# else fails schema validation server-side, so we clamp to the nearest
# supported value instead of letting the API reject the job.
_VEO_DURATIONS = (4, 6, 8)


def _format_duration(fal_model: str, duration: int) -> str:
    """Return the duration string in the shape the target fal endpoint expects."""
    if _is_veo(fal_model):
        # Snap to nearest allowed duration.
        nearest = min(_VEO_DURATIONS, key=lambda d: abs(d - duration))
        return f"{nearest}s"
    return str(duration)


def generate_from_fal_model(
    fal_slug: str,
    prompt: str,
    *,
    image_url: str | None = None,
    duration: int = 5,
    aspect_ratio: str = "9:16",
) -> bytes:
    """Generic fal.ai video generation — works for any fal model whose input
    schema includes prompt + optional image_url.

    Sends {prompt, image_url?, duration, aspect_ratio} with two retries on
    400 (each omitting one arg) so a model that doesn't accept our optional
    params still runs on its own defaults.
    """
    _ensure_auth()
    base: dict = {"prompt": prompt}
    if image_url:
        base["image_url"] = image_url
    if _is_v2(fal_slug):
        base["generate_audio"] = False

    duration_arg = _format_duration(fal_slug, duration)

    # Try most-specific args first, then degrade.
    arg_attempts: list[dict] = [
        {**base, "duration": duration_arg, "aspect_ratio": aspect_ratio},
        {**base, "duration": duration_arg},
        base,
    ]
    last_err: Exception | None = None
    for args in arg_attempts:
        try:
            result = fal_client.subscribe(fal_slug, arguments=args)
            return _download(_extract_video_url(result))
        except Exception as e:
            last_err = e
            msg = str(e).lower()
            # Only retry on argument validation failures
            if "400" not in msg and "validation" not in msg and "invalid" not in msg:
                raise
            print(f"    ⚠ {fal_slug} rejected args {list(args.keys())}: {e}")
    raise RuntimeError(f"fal model {fal_slug} rejected all arg sets: {last_err}")


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

    args: dict = {
        "prompt": prompt,
        "image_url": image_url,
        "duration": _format_duration(fal_model, duration),
        "resolution": resolution,
        "aspect_ratio": aspect_ratio,
    }
    # Seedance v2 adds audio by default; we generate silent ad videos.
    if _is_v2(fal_model):
        args["generate_audio"] = False

    result = fal_client.subscribe(fal_model, arguments=args)
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

    args: dict = {
        "prompt": prompt,
        "duration": _format_duration(fal_model, duration),
        "resolution": resolution,
        "aspect_ratio": aspect_ratio,
    }
    if _is_v2(fal_model):
        args["generate_audio"] = False

    result = fal_client.subscribe(fal_model, arguments=args)
    return _download(_extract_video_url(result))
