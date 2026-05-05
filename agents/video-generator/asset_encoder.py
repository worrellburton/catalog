"""Asset encoder: extract poster frame + mobile-optimized variant from a
generated MP4.

The consumer feed paints a black rectangle until the source MP4 has decoded a
frame, which on mobile cellular is ~2-3 s after the card mounts. Two cheap
fixes wipe out that latency:

  1. Poster frame  - first frame extracted as a 75-quality JPEG, set as the
     <video poster=...> attribute. The browser paints it instantly while the
     MP4 streams in the background. Stored alongside the source MP4 in the
     same `look-media` bucket; the public URL goes into product_creative
     .thumbnail_url (or generated_videos.thumbnail_url).

  2. Mobile variant - 480p H.264 at ~600 kbps, ~3-5 s clip. ~150-300 KB
     vs ~1-3 MB for the full-res source, so cellular users get a playable
     first frame in a fraction of the time. The renderer picks this on
     narrow viewports / slow connections via pickVideoUrl(); full-res is
     prefetched in the background while the user browses so detail-view
     navigations are cache hits.

Both pieces are bytes-in / bytes-out; this module knows nothing about
Supabase Storage. The caller (run_batch.py for new generations,
backfill_creative_assets.py for existing rows) is responsible for the
upload + DB write.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
import urllib.request
from dataclasses import dataclass
from typing import Optional


@dataclass
class EncodedAssets:
    """Output of encode_assets_from_url. Both fields are file paths on disk
    that the caller is responsible for cleaning up."""
    poster_jpeg_path: str
    mobile_mp4_path: str
    workdir: str


def encode_assets_from_url(video_url: str, workdir: Optional[str] = None) -> EncodedAssets:
    """Downloads the source MP4 to a temp dir, then runs ffmpeg twice:
    once to extract the first frame as a JPEG, once to transcode a
    mobile-optimized variant. Returns the two output paths.

    Raises CalledProcessError on ffmpeg failure or HTTPError on a 4xx/5xx
    while fetching the source.

    Caller cleans up by removing `result.workdir` once the bytes are
    uploaded.
    """
    if shutil.which("ffmpeg") is None:
        raise RuntimeError(
            "ffmpeg not found on PATH. Install it (apt-get install ffmpeg) "
            "or run this inside the Modal image which already has it."
        )

    workdir = workdir or tempfile.mkdtemp(prefix="creative-assets-")
    src_path = os.path.join(workdir, "source.mp4")
    poster_path = os.path.join(workdir, "poster.jpg")
    mobile_path = os.path.join(workdir, "mobile.mp4")

    # 1. Pull the source. urllib avoids adding a new dependency; the agent
    # repo doesn't pin httpx for this script's sake. Public look-media URLs
    # don't require auth.
    with urllib.request.urlopen(video_url) as resp, open(src_path, "wb") as f:
        shutil.copyfileobj(resp, f)

    # 2. Poster: first frame (or 0.1s in - some encoders emit a black first
    # frame) at 75% JPEG quality. Cap at 720px wide so the file stays under
    # ~80 KB even for tall aspect ratios.
    subprocess.run(
        [
            "ffmpeg", "-y",
            "-loglevel", "error",
            "-ss", "0.1",
            "-i", src_path,
            "-frames:v", "1",
            "-vf", "scale='min(720,iw)':-2",
            "-q:v", "5",  # ~75% quality
            poster_path,
        ],
        check=True,
    )

    # 3. Mobile variant: 480p H.264, 600 kbps, faststart (moov atom at the
    # head of the file so the browser starts decoding from the first byte
    # range request), CRF disabled in favour of bitrate for predictable
    # file sizes. -movflags +faststart is the single most important flag
    # here for "first-frame on mobile" - without it the browser has to
    # download the whole file before any frame plays.
    subprocess.run(
        [
            "ffmpeg", "-y",
            "-loglevel", "error",
            "-i", src_path,
            "-vf", "scale='min(480,iw)':-2",
            "-c:v", "libx264",
            "-preset", "veryfast",
            "-b:v", "600k",
            "-maxrate", "800k",
            "-bufsize", "1200k",
            "-pix_fmt", "yuv420p",
            "-an",  # no audio - the consumer feed plays muted anyway
            "-movflags", "+faststart",
            mobile_path,
        ],
        check=True,
    )

    return EncodedAssets(
        poster_jpeg_path=poster_path,
        mobile_mp4_path=mobile_path,
        workdir=workdir,
    )


def cleanup(assets: EncodedAssets) -> None:
    """Removes the temp workdir created by encode_assets_from_url."""
    try:
        shutil.rmtree(assets.workdir, ignore_errors=True)
    except Exception:
        pass
