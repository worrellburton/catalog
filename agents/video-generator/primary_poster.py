"""Shared helper: generate a product's primary-video poster.

The primary-video pipeline (generate-primary-video → fal-webhook, or the
promote_creative_to_primary_video DB trigger) sets products.primary_video_url
but never a matching poster. The feed then fell back to the square
primary_image_url, which object-fit:cover magnified into the 3:4 card (the
"zoomed in" product look).

This module extracts the FIRST frame (frame 0) at the video's native 3:4
size, via asset_encoder, and writes it to products.primary_video_poster_url
so the poster fills the card AND is pixel-identical to the frame the <video>
paints when it starts playing — the poster→playback handoff is seamless (no
zoom pop), and frame 0 is the clip's widest, least-zoomed framing.

Single source of truth for both callers:
  • modal_app.generate_primary_poster_job  (event-driven webhook + cron)
  • backfill_creative_assets               (one-off / manual sweep)
"""
from __future__ import annotations

import urllib.request

from asset_encoder import encode_assets_from_url, cleanup

BUCKET = "look-media"
# Feed render params — MUST match app/utils/supabase-image.ts withTransform
# as called in CreativeCardV2 (width 540, quality 72, resize cover). We warm
# this exact URL so the first feed view is a CDN HIT, not a 2-6s cold
# on-demand transform (which left the grid dark on reload).
POSTER_RENDER_QUERY = "width=540&quality=72&resize=contain"
# One poster per product, keyed by id. Primary videos live on fal's CDN
# (external URL) so we can't mirror their storage path — the product id is
# stable and unambiguous.
#
# `-v4`: bumped to force-refresh posters that had gone STALE — many `-v3`
# posters were extracted from an OLDER, more-zoomed primary video and never
# refreshed when the product's video was regenerated, so the poster (zoomed)
# no longer matched the current clip's frame 0 (wider). A NEW object key hands
# every product a fresh render-CDN URL AND a fresh frame-0 extraction from the
# CURRENT video. Bump again (v5…) if the frame-selection or source ever changes.
POSTER_SUFFIX = ".poster-v4.jpg"


def poster_storage_key(product_id: str) -> str:
    return f"products/{product_id}/primary-video{POSTER_SUFFIX}"


def public_url_for(supabase_url: str, key: str, bucket: str = BUCKET) -> str:
    return f"{supabase_url}/storage/v1/object/public/{bucket}/{key}"


def render_url_for(object_public_url: str) -> str:
    """The transform URL the feed actually requests — object/public →
    render/image/public with the feed's render params appended."""
    base = object_public_url.replace(
        "/storage/v1/object/public/", "/storage/v1/render/image/public/", 1
    )
    sep = "&" if "?" in base else "?"
    return f"{base}{sep}{POSTER_RENDER_QUERY}"


def warm_poster_cache(object_public_url: str, timeout: float = 30.0) -> bool:
    """GET the transformed poster once so the CDN caches it before the first
    shopper hits the feed. Best-effort: returns True on a 2xx, False on any
    failure (never raises — a cold poster is a perf hit, not a correctness
    bug)."""
    try:
        req = urllib.request.Request(render_url_for(object_public_url), method="GET")
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return 200 <= resp.status < 300
    except Exception:
        return False


def generate_primary_poster(
    supabase,
    supabase_url: str,
    product_id: str,
    video_url: str | None = None,
) -> str:
    """Extract product_id's primary-video first frame (frame 0) and write it
    to products.primary_video_poster_url. Returns the public poster URL.

    Pass `video_url` to skip the lookup (the webhook already has it from the
    trigger payload). Raises ValueError if the product has no primary video,
    and propagates encode/upload errors so the caller can record a failure.
    """
    if not video_url:
        row = (
            supabase.table("products")
            .select("primary_video_url")
            .eq("id", product_id)
            .single()
            .execute()
        )
        video_url = (row.data or {}).get("primary_video_url")
    if not video_url:
        raise ValueError(f"product {product_id} has no primary_video_url")

    assets = encode_assets_from_url(video_url, poster_only=True)
    try:
        key = poster_storage_key(product_id)
        with open(assets.poster_jpeg_path, "rb") as f:
            supabase.storage.from_(BUCKET).upload(
                key,
                f.read(),
                # STABLE key, overwritten in place on regen (no ?v cache-bust),
                # so this must stay revalidatable — NOT immutable, or a
                # regenerated primary-video poster would be pinned stale for a
                # year. 1-day TTL kills the per-request revalidation while still
                # self-healing a regen within a day.
                {"content-type": "image/jpeg", "upsert": "true",
                 "cache-control": "public, max-age=86400"},
            )
        poster_url = public_url_for(supabase_url, key)
        supabase.table("products").update(
            {"primary_video_poster_url": poster_url}
        ).eq("id", product_id).execute()
        # Pre-warm the CDN so the first feed render is a HIT, not a cold
        # 2-6s on-demand transform. Best-effort — never blocks the write.
        warm_poster_cache(poster_url)
        return poster_url
    finally:
        cleanup(assets)
