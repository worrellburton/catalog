"""Asset encoder: extract poster frame + mobile-optimized variant from a
generated MP4.

The consumer feed paints a black rectangle until the source MP4 has decoded a
frame, which on mobile cellular is ~2-3 s after the card mounts. Two cheap
fixes wipe out that latency:

  1. Poster frame  - the FIRST frame (frame 0) extracted as a 75-quality
     JPEG, set as the <video poster=...> attribute. The browser paints it
     instantly while the MP4 streams in the background. We take frame 0 so
     the poster is IDENTICAL to the frame the <video> shows the instant it
     starts playing — the still and the first painted video frame are the
     same pixels, so the poster→video handoff is seamless ("the video is
     already there") with zero zoom pop. Frame 0 is also the clip's widest,
     least-zoomed framing. Stored alongside the source MP4 in the same
     `look-media` bucket; the public URL goes into
     product_creative.thumbnail_url (or generated_videos.thumbnail_url).

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

# Poster = frame 0 (the very first frame). The generated clips do an
# editorial zoom-in from a wide packshot, so frame 0 is the widest,
# least-zoomed framing AND — critically — the exact frame the <video> paints
# the instant it starts playing. A frame-0 poster therefore hands off into
# playback seamlessly: poster pixels == first video frame, no zoom pop, the
# grid reads as "video already there." (A late/hero-frame poster mismatched
# the playing clip's start and read as a static, zoomed still.)
POSTER_SEEK_SECONDS = 0.0


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

    The poster is the FIRST frame (frame 0) scaled to the clip's NATIVE
    aspect ratio (height derived with `-2`), so it fills the 3:4 card with no
    crop-zoom. Frame 0 is identical to the frame the <video> paints when it
    starts playing, so the poster→playback handoff is seamless (no zoom pop),
    and it's the widest, least-zoomed framing of the clip.

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

    # 2. Poster: frame 0 (POSTER_SEEK_SECONDS) at 75% JPEG quality. Cap at
    # 720px wide so the file stays under ~80 KB even for tall aspect ratios.
    # Seek BEFORE -i for a fast keyframe seek — frame 0 is always a keyframe,
    # so this lands exactly on the first frame the <video> will paint.
    poster_cmd = [
        "ffmpeg", "-y", "-loglevel", "error",
        "-ss", str(POSTER_SEEK_SECONDS), "-i", src_path,
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
