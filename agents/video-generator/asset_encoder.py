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
from typing import List, NamedTuple, Optional

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

    # 3. Mobile variant: 480p H.264, capped CRF. Single fallback rung for the
    # progressive-MP4 path (and slow connections). -crf 23 + a maxrate ceiling
    # ("constrained quality") right-sizes bytes per clip — a static lookbook clip
    # encodes well under the cap, a busy runway/hair clip rides it — instead of
    # paying a flat bitrate on every clip. The maxrate (1.8 Mbps) keeps the
    # earlier "no frame-drop" headroom; bufsize 2× maxrate lets busy clips breathe.
    #
    # -preset slow (was medium): encode is offline/batch, so the extra seconds
    # buy ~10-20% better compression efficiency (smaller at equal quality). The
    # same argument that justified veryfast→medium, taken one step further.
    # -tune film + aq-mode 3 bias bits toward faces / fabric / shadows — the
    # detail that reads on a fashion clip — and redistribute WITHIN the rate
    # ceiling, so they cost no extra bytes.
    #
    # -r 24 matches the source-native 24 fps (Fal Seedance + Veo). -movflags
    # +faststart keeps first-frame-on-mobile instant (moov atom up front).
    subprocess.run(
        [
            "ffmpeg", "-y",
            "-loglevel", "error",
            "-i", src_path,
            "-vf", "scale='min(480,iw)':-2",
            "-r", "24",
            "-c:v", "libx264",
            "-preset", "slow",
            "-tune", "film",
            "-crf", "23",
            "-maxrate", "1800k",
            "-bufsize", "3600k",
            "-x264-params", "aq-mode=3:aq-strength=0.9",
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


# ── HLS adaptive-bitrate ladder ──────────────────────────────────────────────
# The mobile/full MP4 split forces one fixed quality per surface: the feed and
# the full-screen hero play the SAME file, so we either ship 480p (soft on a
# phone hero) or full-res (slow first frame + wasteful on a tile). HLS removes
# the tradeoff — one manifest, three renditions; the player starts low for an
# instant first frame and ramps up to a high rung at full-screen size, with no
# src swap on the card→hero handoff. This is how TikTok/IG feel instant AND crisp.


@dataclass
class EncodedHls:
    """Output of an HLS ladder encode. `out_dir` holds the full HLS tree
    (master.m3u8 + v0/v1/… variant playlists + per-variant init.mp4 + .m4s fMP4
    segments); `master_name` is the master playlist filename within it. The
    caller uploads the whole tree preserving relative paths, then points the
    *_hls_url column at the master."""
    out_dir: str
    master_name: str
    workdir: str


@dataclass
class EncodedAv1:
    """Output of encode_av1_mp4_from_url — one progressive AV1 MP4 (file path on
    disk) for the desktop progressive path. Caller uploads + removes workdir."""
    path: str
    workdir: str


class _Rung(NamedTuple):
    label: str
    width: int
    b: str        # target / average bitrate
    maxrate: str  # VBV ceiling (also the master's BANDWIDTH attr)
    bufsize: str  # VBV buffer — kept > maxrate so busy clips can breathe


# H.264 rendition ladder. Bitrates are tuned for -preset slow (≈20% more
# efficient than the former veryfast, so the targets dropped accordingly for
# equal-or-better quality). The ladder is SOURCE-AWARE at encode time
# (_source_aware_ladder): a rung is NEVER emitted wider than the true source —
# an upscaled rung spends the most bits in the ladder for ZERO real detail (the
# old fixed "1080" rung upscaled a ~720–834px source). When the source sits
# between steps the ladder tops out at the native source width, so a full-screen
# hero gets the source's full detail without ever upscaling.
_HLS_LADDER: List[_Rung] = [
    _Rung("480", 480, "1100k", "1500k", "3000k"),
    _Rung("720", 720, "2400k", "3000k", "6000k"),
    _Rung("1080", 1080, "4500k", "5500k", "11000k"),
]

# HEVC bitrates ≈ 0.7× H.264 at equal quality (hardware HEVC decode is universal
# on Apple devices, where native HLS picks the HEVC variant automatically).
_HEVC_BITRATE_SCALE = 0.7


def _kbps(rate: str) -> int:
    """'2400k' → 2400."""
    return int(rate.lower().rstrip("k"))


def _probe_width(path: str) -> Optional[int]:
    """Source video pixel width via ffprobe, or None if it can't be read (the
    caller then falls back to the full ladder)."""
    if shutil.which("ffprobe") is None:
        return None
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-select_streams", "v:0",
             "-show_entries", "stream=width", "-of", "csv=p=0", path],
            check=True, capture_output=True, text=True,
        ).stdout.strip()
        return int(out) if out else None
    except Exception:
        return None


def _source_aware_ladder(width: Optional[int], scale: float = 1.0) -> List[_Rung]:
    """The ladder filtered to the true source width — never wider than the
    source. If the source sits ≥15% above the largest kept rung, append a
    native-width top rung (interpolating its bitrate by pixel-area) so a
    full-screen hero gets full source detail with no upscale. `scale` multiplies
    every bitrate (HEVC passes <1)."""
    def scaled(r: _Rung) -> _Rung:
        if scale == 1.0:
            return r
        return _Rung(r.label, r.width,
                     f"{int(_kbps(r.b) * scale)}k",
                     f"{int(_kbps(r.maxrate) * scale)}k",
                     f"{int(_kbps(r.bufsize) * scale)}k")

    if not width or width <= 0:
        return [scaled(r) for r in _HLS_LADDER]  # unknown source → full ladder
    kept = [r for r in _HLS_LADDER if r.width <= width]
    if not kept:
        kept = [_HLS_LADDER[0]]
    if width >= int(kept[-1].width * 1.15):
        lower = kept[-1]
        area = (width / lower.width) ** 2
        b = int(_kbps(lower.b) * area)
        kept = kept + [_Rung(str(width), width, f"{b}k", f"{int(b * 1.3)}k", f"{int(b * 2.6)}k")]
    return [scaled(r) for r in kept]


def _download(video_url: str, dst: str) -> None:
    with urllib.request.urlopen(video_url) as resp, open(dst, "wb") as f:
        shutil.copyfileobj(resp, f)


def _run_hls_ladder(src_path: str, out_dir: str, rungs: List[_Rung], codec: str) -> None:
    """One ffmpeg → a single-codec fMP4 HLS VOD ladder. `codec` is 'h264' or
    'hevc'. ffmpeg generates the master playlist (with correct per-variant CODECS
    attributes — load-bearing for native iOS HLS), mirroring the proven
    split-filter / var_stream_map structure.

    fMP4 (not MPEG-TS): ~6–10% less packaging overhead at these sub-1Mbps
    bitrates, byte-range addressable, and MANDATORY for HEVC on Apple native HLS.
    1s segments + 1s GOP (-g 24 @ 24fps, fixed cadence) keep rung switch points
    aligned AND the first segment small for a fast cold start; the client warmer
    already parses #EXT-X-MAP (the fMP4 init segment)."""
    n = len(rungs)
    for i in range(n):
        os.makedirs(os.path.join(out_dir, f"v{i}"), exist_ok=True)

    splits = "".join(f"[v{i}]" for i in range(n))
    chain = [f"[0:v]split={n}{splits}"]
    for i, r in enumerate(rungs):
        chain.append(f"[v{i}]scale=w={r.width}:h=-2[v{i}out]")
    filter_complex = "; ".join(chain)

    # NO B-FRAMES (bf 0 / bframes=0). B-frame composition reordering makes the
    # mov muxer write a 2-entry edit list into the fMP4 init whose FIRST entry is
    # an empty edit (media_time=-1, a leading dwell of the ~2-frame reorder delay).
    # iOS AVPlayer's native HLS chokes on a leading empty edit in fMP4 and never
    # renders the first frame (poster-only / "stuck"). MPEG-TS has no edit lists,
    # which is why the old TS ladder played on iOS and the fMP4 ladder didn't.
    # Dropping B-frames removes the reorder delay → a clean identity edit list
    # (media_time=0) → iOS plays. Costs a few % compression on these short clips;
    # correctness on the dominant mobile platform wins. (negative_cts_offsets /
    # avoid_negative_ts / setpts were all tried and did NOT remove the empty edit.)
    if codec == "hevc":
        vcodec = "libx265"
        # -tag:v hvc1 is required for Apple to play HEVC in fMP4/HLS. libx265 has
        # no 'film' tune, so AQ is set via -x265-params; bframes=0 (ffmpeg -bf
        # doesn't reach libx265) for the edit-list reason above.
        codec_opts = ["-tag:v", "hvc1", "-profile:v", "main",
                      "-x265-params", "aq-mode=3:bframes=0"]
    else:
        vcodec = "libx264"
        codec_opts = ["-tune", "film", "-profile:v", "high", "-bf", "0",
                      "-x264-params", "aq-mode=3:aq-strength=0.9"]

    cmd = ["ffmpeg", "-y", "-loglevel", "error", "-i", src_path,
           "-filter_complex", filter_complex]
    for i, r in enumerate(rungs):
        cmd += ["-map", f"[v{i}out]",
                f"-c:v:{i}", vcodec,
                f"-b:v:{i}", r.b,
                f"-maxrate:v:{i}", r.maxrate,
                f"-bufsize:v:{i}", r.bufsize]
    cmd += ["-preset", "slow"] + codec_opts + [
        "-r", "24", "-g", "24", "-keyint_min", "24", "-sc_threshold", "0",
        "-pix_fmt", "yuv420p", "-an",
        "-f", "hls",
        "-hls_time", "1",
        "-hls_playlist_type", "vod",
        "-hls_flags", "independent_segments",
        "-hls_segment_type", "fmp4",
        "-hls_fmp4_init_filename", "init.mp4",
        "-hls_segment_filename", os.path.join("v%v", "seg_%03d.m4s"),
        "-master_pl_name", "master.m3u8",
        "-var_stream_map", " ".join(f"v:{i}" for i in range(n)),
        os.path.join("v%v", "playlist.m3u8"),
    ]
    # Input absolute; OUTPUT paths relative with cwd=out_dir so -master_pl_name
    # lands in out_dir referencing v0/playlist.m3u8 etc.
    subprocess.run(cmd, check=True, cwd=out_dir)


def encode_hls_ladder_from_url(video_url: str, workdir: Optional[str] = None) -> EncodedHls:
    """Download the source MP4 and transcode the H.264 fMP4 HLS VOD ladder
    (source-aware renditions, -preset slow, -tune film, capped VBR). Fills the
    existing hls_url / primary_hls_url columns.

    Raises CalledProcessError on ffmpeg failure / HTTPError on a bad fetch.
    Caller removes result.workdir once the tree is uploaded."""
    if shutil.which("ffmpeg") is None:
        raise RuntimeError(
            "ffmpeg not found on PATH. Install it (apt-get install ffmpeg) "
            "or run this inside the Modal image which already has it."
        )
    workdir = workdir or tempfile.mkdtemp(prefix="hls-ladder-")
    src_path = os.path.join(workdir, "source.mp4")
    out_dir = os.path.join(workdir, "hls")
    os.makedirs(out_dir, exist_ok=True)
    _download(video_url, src_path)
    rungs = _source_aware_ladder(_probe_width(src_path))
    _run_hls_ladder(src_path, out_dir, rungs, "h264")
    return EncodedHls(out_dir=out_dir, master_name="master.m3u8", workdir=workdir)


def encode_hls_hevc_ladder_from_url(video_url: str, workdir: Optional[str] = None) -> EncodedHls:
    """Same as encode_hls_ladder_from_url but HEVC (libx265, hvc1). Produces a
    SEPARATE master/tree so it never touches the proven H.264 master — fills the
    additive hls_hevc_url / primary_hls_hevc_url columns. The client prefers it
    where HEVC decode is available and ALWAYS keeps the H.264 ladder as fallback.
    Saves ~15-25% bytes on these short low-res portrait clips."""
    if shutil.which("ffmpeg") is None:
        raise RuntimeError("ffmpeg not found on PATH.")
    workdir = workdir or tempfile.mkdtemp(prefix="hls-hevc-")
    src_path = os.path.join(workdir, "source.mp4")
    out_dir = os.path.join(workdir, "hls-hevc")
    os.makedirs(out_dir, exist_ok=True)
    _download(video_url, src_path)
    rungs = _source_aware_ladder(_probe_width(src_path), scale=_HEVC_BITRATE_SCALE)
    _run_hls_ladder(src_path, out_dir, rungs, "hevc")
    return EncodedHls(out_dir=out_dir, master_name="master.m3u8", workdir=workdir)


def encode_av1_mp4_from_url(video_url: str, workdir: Optional[str] = None) -> EncodedAv1:
    """One progressive AV1 MP4 (libsvtav1) at the source's native resolution for
    the desktop progressive path — ~30-50% smaller than H.264 at equal quality.
    Tile and hero share this ONE url (so the pooled-element handoff stays
    seamless); the client gates on MediaCapabilities and ALWAYS keeps the H.264
    source as fallback. Fills video_av1_url / primary_video_av1_url.

    libsvtav1 -preset 6 is a sane speed/quality balance for 3-6s clips (encode is
    offline). Raises on ffmpeg failure; caller removes workdir."""
    if shutil.which("ffmpeg") is None:
        raise RuntimeError("ffmpeg not found on PATH.")
    workdir = workdir or tempfile.mkdtemp(prefix="av1-mp4-")
    src_path = os.path.join(workdir, "source.mp4")
    out_path = os.path.join(workdir, "desktop.av1.mp4")
    _download(video_url, src_path)
    subprocess.run(
        [
            "ffmpeg", "-y", "-loglevel", "error",
            "-i", src_path,
            "-c:v", "libsvtav1",
            "-preset", "6",
            "-crf", "30",
            "-svtav1-params", "tune=0",
            "-pix_fmt", "yuv420p",
            "-an",
            "-movflags", "+faststart",
            out_path,
        ],
        check=True,
    )
    return EncodedAv1(path=out_path, workdir=workdir)


def cleanup_hls(assets: EncodedHls) -> None:
    """Removes the temp workdir created by an HLS ladder encode."""
    try:
        shutil.rmtree(assets.workdir, ignore_errors=True)
    except Exception:
        pass


def cleanup_av1(assets: EncodedAv1) -> None:
    """Removes the temp workdir created by encode_av1_mp4_from_url."""
    try:
        shutil.rmtree(assets.workdir, ignore_errors=True)
    except Exception:
        pass
