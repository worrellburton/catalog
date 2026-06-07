"""Shared helper: generate a LOOK's poster frame (server-side).

Mirrors primary_poster.py (which does the same for product primary videos).
A look's primary creative (looks_creative) has a video_url but often no
thumbnail_url, so the consumer feed fell back to a product packshot until the
clip loaded — and the per-look description trigger (which fires when the poster
is set) never ran. This extracts the clip's FIRST frame (native 3:4) via
asset_encoder and writes it to looks_creative.thumbnail_url, which:
  • makes the feed/look card paint the look's own frame, and
  • fires trg_looks_creative_generate_description → a unique Gemini blurb.

Single source of truth for both callers:
  • modal_app.generate_look_poster_job  (DB-trigger webhook)
  • a one-off backfill sweep
"""
from __future__ import annotations

import urllib.request

from asset_encoder import encode_assets_from_url, cleanup

BUCKET = "look-media"
# Match the client extractor's render params (CreativeCardV2 / withTransform).
POSTER_RENDER_QUERY = "width=540&quality=72&resize=contain"
# Keyed by look id, same path the client-side uploader uses (utils/video-poster
# → looks/<lookId>/poster.jpg) so server + client write the same object.
POSTER_SUFFIX = "poster.jpg"


def poster_storage_key(look_id: str) -> str:
    return f"looks/{look_id}/{POSTER_SUFFIX}"


def public_url_for(supabase_url: str, key: str, bucket: str = BUCKET) -> str:
    return f"{supabase_url}/storage/v1/object/public/{bucket}/{key}"


def render_url_for(object_public_url: str) -> str:
    base = object_public_url.replace(
        "/storage/v1/object/public/", "/storage/v1/render/image/public/", 1
    )
    sep = "&" if "?" in base else "?"
    return f"{base}{sep}{POSTER_RENDER_QUERY}"


def warm_poster_cache(object_public_url: str, timeout: float = 30.0) -> bool:
    try:
        req = urllib.request.Request(render_url_for(object_public_url), method="GET")
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return 200 <= resp.status < 300
    except Exception:
        return False


def generate_look_poster(
    supabase,
    supabase_url: str,
    creative_id: str,
    look_id: str | None = None,
    video_url: str | None = None,
) -> str:
    """Extract the look creative's first frame and write it to
    looks_creative.thumbnail_url. Returns the public poster URL.

    Pass look_id + video_url to skip the lookup (the webhook has them from the
    trigger payload). Raises ValueError if the creative has no video.
    """
    if not video_url or not look_id:
        row = (
            supabase.table("looks_creative")
            .select("look_id, video_url")
            .eq("id", creative_id)
            .single()
            .execute()
        )
        data = row.data or {}
        look_id = look_id or data.get("look_id")
        video_url = video_url or data.get("video_url")
    if not video_url:
        raise ValueError(f"looks_creative {creative_id} has no video_url")
    if not look_id:
        raise ValueError(f"looks_creative {creative_id} has no look_id")

    assets = encode_assets_from_url(video_url, poster_only=True)
    try:
        key = poster_storage_key(look_id)
        with open(assets.poster_jpeg_path, "rb") as f:
            supabase.storage.from_(BUCKET).upload(
                key,
                f.read(),
                {"content-type": "image/jpeg", "upsert": "true"},
            )
        poster_url = public_url_for(supabase_url, key)
        supabase.table("looks_creative").update(
            {"thumbnail_url": poster_url}
        ).eq("id", creative_id).execute()
        warm_poster_cache(poster_url)
        return poster_url
    finally:
        cleanup(assets)
