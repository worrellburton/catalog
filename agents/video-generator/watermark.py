"""
Watermark a user_generation video with the Catalog wordmark and upload
the result to the look-media bucket. Patches the matching look_shares
row with the watermarked URL + status='done'.

Usage from modal_app.py:
    from watermark import watermark_share
    watermark_share.spawn(share_id="...")

The wordmark PNG is rasterized from the canonical SVG path used by
app/components/CatalogLogo.tsx. Caching it next to the script means
the first invocation pays the cairosvg cost; every subsequent one
re-uses the file.
"""

from __future__ import annotations

import io
import os
import shutil
import subprocess
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path

import httpx
from supabase import create_client


# ── Wordmark SVG ─────────────────────────────────────────────────────
# Same path as app/components/CatalogLogo.tsx OriginalLogo.
WORDMARK_SVG_VIEWBOX = "0 0 1052 293"
WORDMARK_SVG_PATH = (
    "M1.18012 118C0.000117425 58.115 47.2001 10.03 109.15 10.915C135.11 10.915 156.94 17.995 174.935 32.45C192.93 46.61 204.435 65.195 210.04 87.91H167.56C159.595 64.015 137.47 48.38 109.15 48.38C89.9751 48.38 73.7501 54.87 61.0651 68.145C48.3801 81.42 41.8901 97.94 41.8901 118C41.8901 138.355 48.0851 154.875 60.7701 168.15C73.4551 181.13 89.6801 187.62 109.15 187.62C137.175 187.62 159.89 172.28 168.15 148.68H211.22C206.205 171.395 194.405 189.685 175.82 203.845C157.235 218.005 135.11 225.085 108.855 225.085C45.7251 225.085 1.18012 179.065 1.18012 118ZM215.306 144.55C215.306 120.36 222.091 100.595 235.366 85.255C248.641 69.915 266.046 62.245 287.286 62.245C314.131 62.245 329.176 77.88 334.486 86.14H336.551V66.08H374.901V221.25H337.141V201.485H335.076C331.831 206.205 328.291 209.745 320.916 215.645C313.541 221.545 301.741 225.085 288.466 225.085C266.931 225.085 249.231 217.71 235.661 202.96C222.091 187.915 215.306 168.445 215.306 144.55ZM254.246 143.96C254.246 171.985 271.061 190.57 295.841 190.57C308.231 190.57 318.261 186.145 325.931 177.295C333.601 168.445 337.436 157.235 337.436 143.96C337.436 115.345 320.326 97.055 295.546 97.055C271.061 97.055 254.246 116.525 254.246 143.96ZM409.011 96.76H382.756V66.375H400.161C406.946 66.375 411.371 61.95 411.371 54.575V23.305H447.361V66.08H490.136V96.76H447.361V168.15C447.361 181.425 454.441 189.39 468.601 189.39H489.251V221.25H460.636C427.891 221.25 409.011 202.665 409.011 169.625V96.76ZM492.341 144.55C492.341 120.36 499.126 100.595 512.401 85.255C525.676 69.915 543.081 62.245 564.321 62.245C591.166 62.245 606.211 77.88 611.521 86.14H613.586V66.08H651.936V221.25H614.176V201.485H612.111C608.866 206.205 605.326 209.745 597.951 215.645C590.576 221.545 578.776 225.085 565.501 225.085C543.966 225.085 526.266 217.71 512.696 202.96C499.126 187.915 492.341 168.445 492.341 144.55ZM531.281 143.96C531.281 171.985 548.096 190.57 572.876 190.57C585.266 190.57 595.296 186.145 602.966 177.295C610.636 168.445 614.471 157.235 614.471 143.96C614.471 115.345 597.361 97.055 572.581 97.055C548.096 97.055 531.281 116.525 531.281 143.96ZM670.411 177.59V-1.75834e-05H708.761V174.05C708.761 182.605 713.186 187.62 721.151 187.62H727.346V221.25H712.891C685.751 221.25 670.411 205.025 670.411 177.59ZM723.283 143.665C723.283 97.645 756.913 62.245 805.883 62.245C853.673 61.655 889.368 98.53 888.483 143.665C888.483 189.095 853.968 225.085 805.883 225.085C781.693 225.085 761.928 217.415 746.293 202.075C730.953 186.44 723.283 166.97 723.283 143.665ZM762.223 143.665C762.223 157.235 766.353 168.445 774.318 177.295C782.578 185.85 792.903 190.275 805.588 190.275C818.273 190.275 828.893 185.85 837.153 177.295C845.413 168.445 849.543 157.235 849.543 143.665C849.543 130.095 845.413 118.885 837.153 110.33C828.893 101.48 818.568 97.055 805.883 97.055C793.198 97.055 782.578 101.48 774.318 110.33C766.353 118.885 762.223 130.095 762.223 143.665ZM891.905 143.075C891.905 118.885 898.69 99.415 911.965 84.665C925.535 69.62 942.645 62.245 963.59 62.245C991.32 62.245 1006.07 78.47 1011.08 86.14H1013.44V66.08H1051.5V220.07C1051.5 263.73 1023.18 292.935 972.44 292.935C951.2 292.935 934.385 287.625 921.7 277.3C909.015 266.975 902.23 253.995 900.755 238.655H936.155C938.81 252.815 952.085 261.37 972.44 261.37C999.875 261.37 1013.74 246.915 1013.74 220.07V200.01H1011.38C1006.36 207.09 992.795 223.61 964.77 223.61C943.53 223.61 926.125 216.235 912.26 201.485C898.69 186.735 891.905 167.265 891.905 143.075ZM930.845 143.075C930.845 171.395 947.365 189.095 972.44 189.095C997.515 189.095 1014.03 169.92 1014.03 143.075C1014.03 114.755 996.925 97.055 972.145 97.055C947.365 97.055 930.845 115.935 930.845 143.075Z"
)

WORDMARK_PNG_PATH = "/tmp/catalog-wordmark.png"
# Logical width of the watermark when overlaid (px). The video is
# typically 720×1280 portrait; ~26% of the width reads as a small
# wordmark in the bottom-right that doesn't dominate the frame.
WATERMARK_REL_WIDTH = 0.22
WATERMARK_MARGIN_REL = 0.04   # fraction of video width


def render_wordmark_png(out_path: str = WORDMARK_PNG_PATH) -> str:
    """Rasterize the canonical Catalog wordmark SVG to a transparent
    PNG. White fill, no stroke, 80% opacity baked in via alpha."""
    if os.path.exists(out_path):
        return out_path

    # Build a minimal SVG document around the path. fill="white" so the
    # wordmark renders bright on dark video footage. The 0.85 opacity
    # softens it so the underlying video still reads through the
    # corners of the glyphs.
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" '
        f'viewBox="{WORDMARK_SVG_VIEWBOX}">'
        f'<path fill="white" fill-opacity="0.85" d="{WORDMARK_SVG_PATH}"/>'
        f'</svg>'
    )

    import cairosvg
    # Render at a resolution high enough that downsizing in ffmpeg
    # stays crisp on 1080p sources. 1024 px wide source = ample.
    cairosvg.svg2png(
        bytestring=svg.encode("utf-8"),
        write_to=out_path,
        output_width=1024,
    )
    return out_path


def _ffmpeg_watermark(src_path: str, watermark_path: str, dst_path: str) -> None:
    """Run ffmpeg overlay. The watermark is scaled to ~22% of the
    source video width and positioned in the bottom-right with a 4%
    margin. -movflags +faststart so the resulting MP4 streams from
    the first byte without a moov-atom seek."""
    rel_w = WATERMARK_REL_WIDTH
    margin = WATERMARK_MARGIN_REL
    filter_complex = (
        f"[1:v]scale=iw*{rel_w}/iw*main_w:-1[wm];"
        f"[0:v][wm]overlay=W-w-W*{margin}:H-h-H*{margin}"
    )
    # Simpler & more robust: use scale2ref to scale watermark relative
    # to the main video's width.
    filter_complex = (
        f"[1:v][0:v]scale2ref=w='iw*{rel_w}':h=ow/mdar[wm][vid];"
        f"[vid][wm]overlay=W-w-W*{margin}:H-h-H*{margin}"
    )

    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-i", src_path,
            "-i", watermark_path,
            "-filter_complex", filter_complex,
            "-c:v", "libx264",
            "-pix_fmt", "yuv420p",
            "-crf", "20",
            "-preset", "veryfast",
            "-c:a", "copy",
            "-movflags", "+faststart",
            dst_path,
        ],
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )


def watermark_one(share_id: str) -> dict:
    """Process a single look_shares row end-to-end. Returns a small
    summary dict for logging.

    Steps:
      1. Load the share row + the source generation video URL
      2. Mark status='rendering'
      3. Download the source MP4 to /tmp
      4. Render the watermark PNG (cached after first run)
      5. ffmpeg overlay
      6. Upload watermarked MP4 to look-media/<share_id>.mp4
      7. Patch share row with watermarked_video_url + status='done'
    """
    sb = create_client(
        os.environ["SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_ROLE_KEY"],
    )
    bucket = "look-media"

    share = (
        sb.table("look_shares").select("*").eq("id", share_id).single().execute().data
    )
    if not share:
        raise RuntimeError(f"look_shares row not found: {share_id}")

    gen = (
        sb.table("user_generations")
          .select("id, video_url")
          .eq("id", share["generation_id"])
          .single()
          .execute()
          .data
    )
    if not gen or not gen.get("video_url"):
        sb.table("look_shares").update({
            "status": "failed",
            "error": "source generation has no video_url",
        }).eq("id", share_id).execute()
        raise RuntimeError("source generation has no video_url")

    sb.table("look_shares").update({"status": "rendering"}).eq("id", share_id).execute()

    work = Path(tempfile.mkdtemp(prefix="watermark-"))
    src_path = str(work / "src.mp4")
    dst_path = str(work / "out.mp4")

    try:
        # 1. Download source video
        with httpx.stream("GET", gen["video_url"], timeout=60) as r:
            r.raise_for_status()
            with open(src_path, "wb") as f:
                for chunk in r.iter_bytes():
                    f.write(chunk)

        # 2. Wordmark PNG
        wm_path = render_wordmark_png()

        # 3. ffmpeg overlay
        _ffmpeg_watermark(src_path, wm_path, dst_path)

        # 4. Upload to storage. Path is keyed by share_id so a re-run
        #    overwrites the prior render rather than orphaning bytes.
        storage_path = f"shares/{share_id}.mp4"
        with open(dst_path, "rb") as f:
            data = f.read()
        # Supabase storage SDK rejects upsert via the "x-upsert" header
        # name in some versions; use update() if the file already exists.
        try:
            sb.storage.from_(bucket).upload(
                storage_path,
                data,
                {
                    "content-type": "video/mp4",
                    "upsert": "true",
                    # Phase 8 contract: long immutable cache for hashed
                    # paths. A re-render would land at the same path, so
                    # technically not immutable, but stale-by-design is
                    # preferable to a fresh round-trip on every share-page
                    # view. CDN edge will refresh if the upload bumps.
                    "cache-control": "public, max-age=31536000, immutable",
                },
            )
        except Exception:
            sb.storage.from_(bucket).update(
                storage_path,
                data,
                {"content-type": "video/mp4"},
            )

        public_url = sb.storage.from_(bucket).get_public_url(storage_path)
        # SDK appends a trailing "?" sometimes; strip it.
        public_url = public_url.rstrip("?")

        sb.table("look_shares").update({
            "watermarked_storage_path": storage_path,
            "watermarked_video_url": public_url,
            "status": "done",
            "rendered_at": datetime.now(timezone.utc).isoformat(),
            "error": None,
        }).eq("id", share_id).execute()

        return {"share_id": share_id, "url": public_url, "status": "done"}

    except Exception as e:
        sb.table("look_shares").update({
            "status": "failed",
            "error": str(e)[:1000],
        }).eq("id", share_id).execute()
        raise

    finally:
        shutil.rmtree(work, ignore_errors=True)
