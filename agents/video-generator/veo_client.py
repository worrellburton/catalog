"""
Veo 3.1 API client for video generation.

Handles both image-to-video and text-to-video workflows
with async polling for completion.
"""

import os
import time

import httpx
import google.genai as genai
import google.genai.types as types


MAX_POLL_SECONDS = 420   # 7 minutes (Veo latency: 11s–6min)
POLL_INTERVAL = 10       # seconds between status checks


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
    """Submit image-to-video job, poll until done, return video bytes."""
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

    # Poll for completion
    start = time.time()
    while not operation.done:
        if time.time() - start > MAX_POLL_SECONDS:
            raise TimeoutError(f"Veo job timed out after {MAX_POLL_SECONDS}s")
        time.sleep(POLL_INTERVAL)
        operation = client.operations.get(operation)

    video = operation.response.generated_videos[0].video
    return httpx.get(video.uri).content


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

    start = time.time()
    while not operation.done:
        if time.time() - start > MAX_POLL_SECONDS:
            raise TimeoutError(f"Veo job timed out after {MAX_POLL_SECONDS}s")
        time.sleep(POLL_INTERVAL)
        operation = client.operations.get(operation)

    video = operation.response.generated_videos[0].video
    return httpx.get(video.uri).content
