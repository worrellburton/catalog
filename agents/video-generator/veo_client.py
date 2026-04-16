"""
Veo 3.1 API client for video generation.

Supports:
  - Reference images (up to 3) — best for product ads
  - Single image-to-video (first frame)
  - Text-to-video fallback
"""

import os
import time

import google.genai as genai
import google.genai.types as types


MAX_POLL_SECONDS = 420   # 7 minutes (Veo latency: 11s–6min)
POLL_INTERVAL = 10       # seconds between status checks


def generate_video_with_references(
    images: list[tuple[bytes, str]],
    prompt: str,
    *,
    model: str = "veo-3.1-fast-generate-preview",
    aspect_ratio: str = "9:16",
    person_generation: str = "allow_adult",
) -> bytes:
    """Generate video using up to 3 reference images (best for product ads).

    Args:
        images: List of (image_bytes, mime_type) tuples, max 3.
        prompt: Text prompt for generation.

    Note: reference images require duration=8s (Veo constraint).
    """
    client = genai.Client(api_key=os.environ["GOOGLE_API_KEY"])

    ref_images = []
    for img_bytes, mime in images[:3]:
        ref_images.append(
            types.VideoGenerationReferenceImage(
                image=types.Image(image_bytes=img_bytes, mime_type=mime),
                reference_type="asset",
            )
        )

    operation = client.models.generate_videos(
        model=model,
        prompt=prompt,
        config=types.GenerateVideosConfig(
            reference_images=ref_images,
            duration_seconds=8,  # required for reference images
            aspect_ratio=aspect_ratio,
            person_generation=person_generation,
            number_of_videos=1,
        ),
    )

    return _poll_and_extract(client, operation)


def generate_video_from_image(
    image_bytes: bytes,
    image_mime: str,
    prompt: str,
    *,
    model: str = "veo-3.1-fast-generate-preview",
    duration: int = 4,
    aspect_ratio: str = "9:16",
    resolution: str = "720p",
    person_generation: str = "allow_adult",
) -> bytes:
    """Submit image-to-video job (single image as first frame)."""
    client = genai.Client(api_key=os.environ["GOOGLE_API_KEY"])

    operation = client.models.generate_videos(
        model=model,
        prompt=prompt,
        image=types.Image(image_bytes=image_bytes, mime_type=image_mime),
        config=types.GenerateVideosConfig(
            duration_seconds=duration,
            aspect_ratio=aspect_ratio,
            resolution=resolution,
            person_generation=person_generation,
            number_of_videos=1,
        ),
    )

    return _poll_and_extract(client, operation)


def generate_video_from_text(
    prompt: str,
    *,
    model: str = "veo-3.1-fast-generate-preview",
    duration: int = 4,
    aspect_ratio: str = "9:16",
) -> bytes:
    """Text-only fallback when no reference image is available."""
    client = genai.Client(api_key=os.environ["GOOGLE_API_KEY"])

    operation = client.models.generate_videos(
        model=model,
        prompt=prompt,
        config=types.GenerateVideosConfig(
            duration_seconds=duration,
            aspect_ratio=aspect_ratio,
            number_of_videos=1,
        ),
    )

    return _poll_and_extract(client, operation)


def _poll_and_extract(client, operation) -> bytes:
    """Poll operation until done and extract video bytes."""
    start = time.time()
    while not operation.done:
        if time.time() - start > MAX_POLL_SECONDS:
            raise TimeoutError(f"Veo job timed out after {MAX_POLL_SECONDS}s")
        time.sleep(POLL_INTERVAL)
        operation = client.operations.get(operation)
    return _extract_video_bytes(client, operation)


def _extract_video_bytes(client, operation) -> bytes:
    """Extract video bytes from a completed Veo operation.

    Uses the SDK's authenticated download instead of raw HTTP.
    Handles cases where the response is None (safety filter, quota, etc.).
    """
    if operation.response is None:
        error_detail = "unknown reason"
        if hasattr(operation, 'error') and operation.error:
            error_detail = str(operation.error)
        elif hasattr(operation, 'metadata') and operation.metadata:
            error_detail = str(operation.metadata)
        raise RuntimeError(
            f"Veo returned no response (video likely blocked by safety filters or generation failed). "
            f"Detail: {error_detail}"
        )

    videos = operation.response.generated_videos
    if not videos or len(videos) == 0:
        raise RuntimeError(
            "Veo returned an empty generated_videos list — "
            "the prompt or image may have been rejected"
        )

    video_entry = videos[0]
    if video_entry.video is None:
        raise RuntimeError(
            "Veo generated_videos entry has no video — generation may have partially failed"
        )

    # Use SDK download (handles auth) then read the saved bytes
    client.files.download(file=video_entry.video)
    video_entry.video.save("_veo_tmp.mp4")
    with open("_veo_tmp.mp4", "rb") as f:
        data = f.read()
    os.remove("_veo_tmp.mp4")
    return data
