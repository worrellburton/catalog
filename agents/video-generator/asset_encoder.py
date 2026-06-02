"""Asset encoder: extract poster frame + mobile-optimized variant from a
generated MP4.

The consumer feed paints a black rectangle until the source MP4 has decoded a
frame, which on mobile cellular is ~2-3 s after the card mounts. Two cheap
fixes wipe out that latency:

  1. Poster frame  - a HERO frame (~80% through the clip) extracted as a
     75-quality JPEG, set as the <video poster=...> attribute. The browser
     paints it instantly while the MP4 streams in the background. We take a
     LATE frame, not the first: the generated clips do an editorial zoom-in,
     so frame 0 is the zoomed-OUT source packshot and the product only
     settles into its hero framing late in the clip. The still shoppers
     stare at should match the framing they see while it plays. Stored
     alongside the source MP4 in the same `look-media` bucket; the public
     URL goes into product_creative.thumbnail_url (or
     generated_videos.thumbnail_url).

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

# The generated clips do an editorial zoom-in: frame 0 is the zoomed-OUT
# source packshot and the product settles into its hero framing late in the
# clip. Grab the poster from ~80% through so the still matches the framing
# shoppers see while it plays, not the zoomed-out start. (Trade-off: a small
# zoom "reveal" when the looping <video> restarts at frame 0 — accepted; the
# poster looking right wins.)
POSTER_SEEK_FRACTION = 0.8
# Seconds-before-EOF fallback used only when ffprobe can't read the
# duration. Lands in the settled hero portion for the ~5 s clips without
# needing the duration, instead of regressing to the zoomed-out frame 0.
POSTER_SEEK_FROM_EOF = -1.0


def _hero_seek_seconds(src_path: str) -> Optional[float]:
    """Timestamp (s) ~POSTER_SEEK_FRACTION through the clip, or None if the
    duration can't be read (caller falls back to end-relative seeking)."""
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "csv=p=0", src_path],
            capture_output=True, text=True, check=True,
        )
        dur = float(out.stdout.strip())
        if dur > 0:
            return round(dur * POSTER_SEEK_FRACTION, 3)
    except Exception:
        pass
    return None


@dataclass
class EncodedAssets:
    """Output of encode_assets_from_url. Both fields are file paths on disk
    that the caller is responsible for cleaning up. `mobile_mp4_path` is an
    empty string when poster_only=True (no mobile variant was encoded)."""
    poster_jpeg_path: str
    mobile_mp4_path: str
    workdir: str


def encode_assets_from_url(
    video_url: str,
    workdir: Optional[str] = None,
    poster_only: bool = False,
) -> EncodedAssets:
    """Downloads the source MP4 to a temp dir, then runs ffmpeg to extract
    the first frame as a JPEG and (unless poster_only) transcode a
    mobile-optimized variant. Returns the output paths.

    The poster is a HERO frame (~80% through the clip, where the editorial
    zoom-in has settled on the product) scaled to the clip's NATIVE aspect
    ratio (height derived with `-2`), so it still fills the 3:4 card with no
    crop-zoom. It is deliberately NOT the first frame: frame 0 is the
    zoomed-out packshot, which is why a first-frame poster read as "zoomed
    out" next to the framing the video shows while playing.

    Set poster_only=True for sources that only need a poster (e.g. the
    products.primary_video_poster_url backfill), skipping the costlier
    mobile transcode.

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

    # 2. Poster: a HERO frame ~80% through the clip (POSTER_SEEK_FRACTION)
    # at 75% JPEG quality. Cap at 720px wide so the file stays under ~80 KB
    # even for tall aspect ratios. Seek BEFORE -i for a fast keyframe seek —
    # a single still doesn't need frame-accurate decode.
    hero_ss = _hero_seek_seconds(src_path)
    poster_cmd = ["ffmpeg", "-y", "-loglevel", "error"]
    if hero_ss is not None:
        poster_cmd += ["-ss", str(hero_ss), "-i", src_path]
    else:
        # Duration unreadable — seek ~1s before EOF so we still land in the
        # settled hero portion instead of the zoomed-out first frame.
        poster_cmd += ["-sseof", str(POSTER_SEEK_FROM_EOF), "-i", src_path]
    poster_cmd += [
        "-frames:v", "1",
        "-vf", "scale='min(720,iw)':-2",
        "-q:v", "5",  # ~75% quality
        poster_path,
    ]
    subprocess.run(poster_cmd, check=True)

    if poster_only:
        return EncodedAssets(
            poster_jpeg_path=poster_path,
            mobile_mp4_path="",
            workdir=workdir,
        )

    # 3. Mobile variant: 480p H.264, 1.5 Mbps target. Earlier this
    # ran at 600 kbps, which is borderline for 480p portrait at 24fps
    # the moment there's real motion — model walking, hair, camera
    # arc — and produced the "choppy" frame-drop look users reported
    # on the feed. 1.5 Mbps gives the encoder enough budget to keep
    # every frame without exploding the file size (still <500 KB for
    # a 5 s clip).
    #
    # -preset medium (was veryfast) trades a few seconds of encode
    # time for noticeably better compression efficiency at the same
    # bitrate. Mobile feeds are batch-encoded so the wall-clock
    # difference is invisible to the shopper.
    #
    # -r 24 locks framerate to the source-native 24 fps (matches Fal
    # Seedance + Veo output). Without it, a re-encode could
    # interpolate or drop frames inconsistently when the input has
    # variable frame timing.
    #
    # -movflags +faststart is the single most important flag here
    # for "first-frame on mobile" — without it the browser has to
    # download the whole file before any frame plays.
    subprocess.run(
        [
            "ffmpeg", "-y",
            "-loglevel", "error",
            "-i", src_path,
            "-vf", "scale='min(480,iw)':-2",
            "-r", "24",
            "-c:v", "libx264",
            "-preset", "medium",
            "-b:v", "1500k",
            "-maxrate", "2000k",
            "-bufsize", "3000k",
            "-profile:v", "high",
            "-level", "4.0",
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
