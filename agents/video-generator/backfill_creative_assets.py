"""Backfill posters + mobile variants for existing product_creative and
generated_videos rows.

The schema picked up `thumbnail_url` and `mobile_video_url` columns in
migration 072. Frontend renders the poster as <video poster=> for instant
first paint, and pickVideoUrl() picks the mobile variant for cellular
users. Until both columns are populated, the perceived-latency win is dead
code at runtime - this script does the one-time fill on existing rows.

Usage:
    cd agents/video-generator
    cp .env.example .env       # fill in SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
    pip install supabase
    python backfill_creative_assets.py            # all tables (incl. products)
    python backfill_creative_assets.py --table product_creative --limit 5
    python backfill_creative_assets.py --table products          # primary-video posters
    python backfill_creative_assets.py --dry-run  # show what would run

Re-runnable: each iteration only touches rows where the relevant column
is still NULL, so a partial run that gets killed mid-batch can be
resumed by re-invoking. Sequential by default (single ffmpeg pass at a
time) to keep memory + bandwidth bounded; pass --concurrency N to fan
out if you trust the box.
"""
from __future__ import annotations

import argparse
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Iterable

# Allow running directly from /agents/video-generator without a package install.
sys.path.insert(0, str(Path(__file__).resolve().parent))

from asset_encoder import (  # noqa: E402
    encode_assets_from_url,
    cleanup,
    encode_hls_ladder_from_url,
    encode_hls_hevc_ladder_from_url,
    encode_av1_mp4_from_url,
    cleanup_hls,
    cleanup_av1,
)
from primary_poster import generate_primary_poster, poster_storage_key  # noqa: E402

try:
    from supabase import create_client  # type: ignore
except ImportError:
    print("Missing dependency: pip install supabase", file=sys.stderr)
    sys.exit(2)

BUCKET = "look-media"
# Where to drop poster + mobile derivatives in the bucket. We mirror the
# source path so it's easy to tell at a glance which derivative belongs
# to which source file. Posters get a `.jpg` extension; mobile variants
# get a `.mobile.mp4` suffix.
POSTER_SUFFIX = ".poster.jpg"
MOBILE_SUFFIX = ".mobile.mp4"


def base_key_for(video_url: str, storage_path: str | None, row_id: str | None = None) -> str:
    """Derive the bucket-relative base key (no extension) for a source video.

    Prefers the explicit `storage_path` column; falls back to the key embedded
    in the public URL, then to a row-id-derived path for external CDNs."""
    if storage_path:
        base = storage_path
    else:
        # public URL pattern: /storage/v1/object/public/<bucket>/<key>
        marker = f"/object/public/{BUCKET}/"
        i = video_url.find(marker)
        if i >= 0:
            base = video_url[i + len(marker):]
        elif row_id:
            base = f"looks/{row_id}/creative"
        else:
            raise ValueError(f"Cannot derive storage path from URL: {video_url}")
    # Strip `.mp4` so derivatives read `foo.poster.jpg` / `foo/hls/...`.
    if base.endswith(".mp4"):
        base = base[:-4]
    return base


def storage_paths_for(video_url: str, storage_path: str | None, row_id: str | None = None) -> tuple[str, str]:
    """Poster + mobile storage keys derived from the source video.
    Returns (poster_key, mobile_key)."""
    base = base_key_for(video_url, storage_path, row_id)
    return f"{base}{POSTER_SUFFIX}", f"{base}{MOBILE_SUFFIX}"


def public_url_for(supabase_url: str, key: str) -> str:
    return f"{supabase_url}/storage/v1/object/public/{BUCKET}/{key}"


# ── HLS ladder backfill ──────────────────────────────────────────────────────
# Encodes an adaptive 480p/720p/1080p ladder per clip and uploads the whole
# tree (master + variant playlists + segments) under `<base>/hls/`, then points
# the row's hls_url (products: primary_hls_url) at the master playlist.

_HLS_CONTENT_TYPES = {
    ".m3u8": "application/vnd.apple.mpegurl",
    ".ts": "video/mp2t",
    # fMP4/CMAF segments + init are served as video/mp4 — the canonical, widely
    # accepted type for fMP4 HLS (Apple's own examples use it) AND the only one
    # in the look-media bucket's allowed_mime_types (video/iso.segment is
    # rejected with 415). Players key off the playlist, not the segment subtype.
    ".m4s": "video/mp4",
    ".mp4": "video/mp4",
}
# Segments are content-stable → cache hard. Playlists get a short TTL so a
# re-encode can propagate (they're tiny, so the repeated fetch is cheap).
_HLS_SEGMENT_CACHE = "public, max-age=31536000, immutable"
_HLS_PLAYLIST_CACHE = "public, max-age=300"

# Versioned output directory for the HLS tree. Segments are uploaded with an
# `immutable` 1-year cache, so re-encoding a clip MUST land on new URLs —
# overwriting `seg_000.*` in place would serve stale bytes to any client that
# cached it, against a playlist that now expects different segments. Bump this
# suffix whenever the encoder output changes; old `…/hls-vN/…` files stay valid
# for in-flight sessions until their row's hls_url is repointed by a (forced)
# re-backfill. New rows pick up the latest automatically.
#
# hls-v3 = the source-aware fMP4 ladder (was hls-v2 = fixed 480/720/1080 TS).
# The container + segment ext changed (.ts → .m4s + init.mp4), so this bump is
# mandatory. After backfilling, bump the client cache keys (looks.ts LOOKS_LS_KEY,
# product-creative.ts HOME_FEED_LS_KEY) so returning users pick up the new URLs.
# hls-v4 = hls-v3 + B-frames disabled. B-frames made the fMP4 init carry a
# leading EMPTY edit (elst media_time=-1, the ~2-frame reorder delay), which iOS
# native HLS chokes on → "stuck on poster". v4 has no B-frames → clean identity
# edit list → plays on iOS. (See asset_encoder._run_hls_ladder.)
_HLS_DIR = "hls-v4"
# HEVC ladder lives in its own tree (separate master) so it never touches the
# H.264 master; the client prefers it where supported and falls back to H.264.
_HEVC_DIR = "hls-hevc-v4"
# AV1 progressive MP4 for the desktop path. Versioned filename so a future
# re-encode lands on a fresh immutable URL.
AV1_SUFFIX = ".av1-v1.mp4"


def upload_hls_tree(supabase, out_dir: str, key_prefix: str) -> int:
    """Uploads every file under `out_dir` to `{key_prefix}/<relpath>`,
    preserving the directory structure so the manifest's RELATIVE references
    (master → v0/playlist.m3u8 → seg_000.ts) resolve against the uploaded
    URLs. Returns the number of files uploaded."""
    count = 0
    for root, _dirs, files in os.walk(out_dir):
        for name in files:
            local = os.path.join(root, name)
            rel = os.path.relpath(local, out_dir).replace(os.sep, "/")
            key = f"{key_prefix}/{rel}"
            ext = os.path.splitext(name)[1].lower()
            ctype = _HLS_CONTENT_TYPES.get(ext, "application/octet-stream")
            cache = _HLS_PLAYLIST_CACHE if ext == ".m3u8" else _HLS_SEGMENT_CACHE
            with open(local, "rb") as f:
                supabase.storage.from_(BUCKET).upload(
                    key,
                    f.read(),
                    {"content-type": ctype, "upsert": "true", "cache-control": cache},
                )
            count += 1
    return count


def process_hls_row(
    supabase,
    supabase_url: str,
    table: str,
    row_id: str,
    video_url: str,
    storage_path: str | None,
    dry_run: bool,
    encode_fn=encode_hls_ladder_from_url,
    dir_name: str = _HLS_DIR,
    column: str = "hls_url",
) -> tuple[str, bool, str]:
    """Encode + upload an HLS ladder for one creative row, then write `column`.
    Parameterized by (encode_fn, dir_name, column) so the SAME code drives the
    H.264 ladder (hls_url) and the HEVC ladder (hls_hevc_url) into separate dirs."""
    prefix = f"{base_key_for(video_url, storage_path, row_id)}/{dir_name}"
    if dry_run:
        return row_id, True, f"DRY-RUN {column}={prefix}/master.m3u8"
    try:
        h = encode_fn(video_url)
    except Exception as e:
        return row_id, False, f"encode failed: {e}"
    try:
        n = upload_hls_tree(supabase, h.out_dir, prefix)
        master_url = public_url_for(supabase_url, f"{prefix}/{h.master_name}")
        supabase.table(table).update({column: master_url}).eq("id", row_id).execute()
        return row_id, True, f"{column} {n} files -> {master_url}"
    except Exception as e:
        return row_id, False, f"upload failed: {e}"
    finally:
        cleanup_hls(h)


def process_hls_product(
    supabase,
    supabase_url: str,
    product_id: str,
    primary_video_url: str,
    dry_run: bool,
    encode_fn=encode_hls_ladder_from_url,
    dir_name: str = _HLS_DIR,
    column: str = "primary_hls_url",
) -> tuple[str, bool, str]:
    """HLS ladder for a product's primary video → products.`column`."""
    prefix = f"{base_key_for(primary_video_url, None, product_id)}/{dir_name}"
    if dry_run:
        return product_id, True, f"DRY-RUN {column}={prefix}/master.m3u8"
    try:
        h = encode_fn(primary_video_url)
    except Exception as e:
        return product_id, False, f"encode failed: {e}"
    try:
        n = upload_hls_tree(supabase, h.out_dir, prefix)
        master_url = public_url_for(supabase_url, f"{prefix}/{h.master_name}")
        supabase.table("products").update({column: master_url}).eq("id", product_id).execute()
        return product_id, True, f"{column} {n} files -> {master_url}"
    except Exception as e:
        return product_id, False, f"upload failed: {e}"
    finally:
        cleanup_hls(h)


def process_av1_row(
    supabase, supabase_url: str, table: str, row_id: str,
    video_url: str, storage_path: str | None, dry_run: bool,
) -> tuple[str, bool, str]:
    """Encode + upload one AV1 progressive MP4 for a creative row → video_av1_url."""
    key = f"{base_key_for(video_url, storage_path, row_id)}{AV1_SUFFIX}"
    if dry_run:
        return row_id, True, f"DRY-RUN video_av1_url={key}"
    try:
        enc = encode_av1_mp4_from_url(video_url)
    except Exception as e:
        return row_id, False, f"encode failed: {e}"
    try:
        with open(enc.path, "rb") as f:
            supabase.storage.from_(BUCKET).upload(
                key, f.read(),
                {"content-type": "video/mp4", "upsert": "true", "cache-control": _HLS_SEGMENT_CACHE},
            )
        url = public_url_for(supabase_url, key)
        supabase.table(table).update({"video_av1_url": url}).eq("id", row_id).execute()
        return row_id, True, f"av1 -> {url}"
    except Exception as e:
        return row_id, False, f"upload failed: {e}"
    finally:
        cleanup_av1(enc)


def process_av1_product(
    supabase, supabase_url: str, product_id: str, primary_video_url: str, dry_run: bool,
) -> tuple[str, bool, str]:
    """AV1 progressive MP4 for a product's primary video → primary_video_av1_url."""
    key = f"{base_key_for(primary_video_url, None, product_id)}{AV1_SUFFIX}"
    if dry_run:
        return product_id, True, f"DRY-RUN primary_video_av1_url={key}"
    try:
        enc = encode_av1_mp4_from_url(primary_video_url)
    except Exception as e:
        return product_id, False, f"encode failed: {e}"
    try:
        with open(enc.path, "rb") as f:
            supabase.storage.from_(BUCKET).upload(
                key, f.read(),
                {"content-type": "video/mp4", "upsert": "true", "cache-control": _HLS_SEGMENT_CACHE},
            )
        url = public_url_for(supabase_url, key)
        supabase.table("products").update({"primary_video_av1_url": url}).eq("id", product_id).execute()
        return product_id, True, f"av1 -> {url}"
    except Exception as e:
        return product_id, False, f"upload failed: {e}"
    finally:
        cleanup_av1(enc)


def fetch_hls_rows(
    supabase, table: str, limit: int | None, statuses: list[str] | None = None,
    reencode: bool = False, column: str = "hls_url",
) -> list[dict]:
    """Creative rows with a source video. By default only those MISSING the
    target ladder (`column` IS NULL); pass reencode=True to RE-process rows that
    already have one — e.g. to regenerate with new encoder settings into a new
    output dir (paired with a bumped dir so new URLs don't collide with the
    immutable-cached old segments). Re-encoding does NOT null `column` first, so
    the feed keeps serving the old ladder until each row is repointed.

    `column` selects which ladder: 'hls_url' (H.264) or 'hls_hevc_url' (HEVC).

    product_creative is gated by status (default: live-only, so we don't
    waste compute on draft/paused rows). Pass `statuses` to widen the net
    — e.g. ["live", "done", "paused"] to backfill non-live creatives."""
    q = (
        supabase.table(table)
        .select(f"id, video_url, storage_path, {column}")
        .not_.is_("video_url", "null")
    )
    if not reencode:
        q = q.is_(column, "null")
    if table == "product_creative":
        q = q.in_("status", statuses or ["live"])
    if limit:
        q = q.limit(limit)
    return q.execute().data or []


def fetch_hls_product_rows(
    supabase, limit: int | None, reencode: bool = False, column: str = "primary_hls_url",
) -> list[dict]:
    """Products with a primary video. By default only those MISSING the target
    ladder (`column` IS NULL); reencode=True re-processes ones that have it.
    `column` is 'primary_hls_url' (H.264) or 'primary_hls_hevc_url' (HEVC)."""
    q = (
        supabase.table("products")
        .select("id, primary_video_url")
        .not_.is_("primary_video_url", "null")
    )
    if not reencode:
        q = q.is_(column, "null")
    if limit:
        q = q.limit(limit)
    return q.execute().data or []


def run_hls(
    table: str, limit: int | None, dry_run: bool, concurrency: int,
    statuses: list[str] | None = None, reencode: bool = False, mode: str = "hls",
) -> int:
    """mode='hls' → H.264 ladder (hls_url / primary_hls_url).
    mode='hevc' → HEVC ladder into a separate tree (hls_hevc_url /
    primary_hls_hevc_url). The HEVC pass is purely additive — it never touches
    the H.264 columns, so the H.264 ladder always stands as the fallback."""
    supabase_url = os.environ.get("SUPABASE_URL")
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not supabase_url or not service_key:
        print("SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required in env", file=sys.stderr)
        return 2
    supabase = create_client(supabase_url, service_key)

    if mode == "hevc":
        encode_fn, dir_name = encode_hls_hevc_ladder_from_url, _HEVC_DIR
        col_row, col_prod = "hls_hevc_url", "primary_hls_hevc_url"
    else:
        encode_fn, dir_name = encode_hls_ladder_from_url, _HLS_DIR
        col_row, col_prod = "hls_url", "primary_hls_url"

    is_products = table == "products"
    rows = (
        fetch_hls_product_rows(supabase, limit, reencode, col_prod) if is_products
        else fetch_hls_rows(supabase, table, limit, statuses, reencode, col_row)
    )
    if not rows:
        print(f"[{table}/{mode}] nothing to backfill")
        return 0
    print(f"[{table}/{mode}] {len(rows)} rows to process")

    ok_count = fail_count = 0
    started = time.time()

    def work(r: dict) -> tuple[str, bool, str]:
        if is_products:
            return process_hls_product(
                supabase, supabase_url, r["id"], r["primary_video_url"], dry_run,
                encode_fn=encode_fn, dir_name=dir_name, column=col_prod,
            )
        return process_hls_row(
            supabase, supabase_url, table, r["id"], r["video_url"], r.get("storage_path"), dry_run,
            encode_fn=encode_fn, dir_name=dir_name, column=col_row,
        )

    if concurrency <= 1:
        for r in rows:
            rid, ok, msg = work(r)
            print(f"  {rid} {'OK' if ok else 'FAIL'}  {msg}")
            ok_count += 1 if ok else 0
            fail_count += 0 if ok else 1
    else:
        with ThreadPoolExecutor(max_workers=concurrency) as pool:
            for f in as_completed([pool.submit(work, r) for r in rows]):
                rid, ok, msg = f.result()
                print(f"  {rid} {'OK' if ok else 'FAIL'}  {msg}")
                ok_count += 1 if ok else 0
                fail_count += 0 if ok else 1

    dur = time.time() - started
    print(f"[{table}/{mode}] done: {ok_count} ok, {fail_count} fail in {dur:.1f}s")
    return 0 if fail_count == 0 else 1


def fetch_av1_rows(
    supabase, table: str, limit: int | None, statuses: list[str] | None = None,
    reencode: bool = False,
) -> list[dict]:
    """Creative rows with a source video but no AV1 variant (video_av1_url NULL).
    reencode=True re-processes rows that already have one."""
    q = (
        supabase.table(table)
        .select("id, video_url, storage_path, video_av1_url")
        .not_.is_("video_url", "null")
    )
    if not reencode:
        q = q.is_("video_av1_url", "null")
    if table == "product_creative":
        q = q.in_("status", statuses or ["live"])
    if limit:
        q = q.limit(limit)
    return q.execute().data or []


def fetch_av1_product_rows(supabase, limit: int | None, reencode: bool = False) -> list[dict]:
    """Products with a primary video but no AV1 variant (primary_video_av1_url NULL)."""
    q = (
        supabase.table("products")
        .select("id, primary_video_url")
        .not_.is_("primary_video_url", "null")
    )
    if not reencode:
        q = q.is_("primary_video_av1_url", "null")
    if limit:
        q = q.limit(limit)
    return q.execute().data or []


def run_av1(
    table: str, limit: int | None, dry_run: bool, concurrency: int,
    statuses: list[str] | None = None, reencode: bool = False,
) -> int:
    """Encode an AV1 progressive MP4 per row for the desktop path. Purely
    additive — fills video_av1_url / primary_video_av1_url; the H.264 source
    stays the fallback for non-AV1 clients."""
    supabase_url = os.environ.get("SUPABASE_URL")
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not supabase_url or not service_key:
        print("SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required in env", file=sys.stderr)
        return 2
    supabase = create_client(supabase_url, service_key)

    is_products = table == "products"
    rows = (
        fetch_av1_product_rows(supabase, limit, reencode) if is_products
        else fetch_av1_rows(supabase, table, limit, statuses, reencode)
    )
    if not rows:
        print(f"[{table}/av1] nothing to backfill")
        return 0
    print(f"[{table}/av1] {len(rows)} rows to process")

    ok_count = fail_count = 0
    started = time.time()

    def work(r: dict) -> tuple[str, bool, str]:
        if is_products:
            return process_av1_product(supabase, supabase_url, r["id"], r["primary_video_url"], dry_run)
        return process_av1_row(
            supabase, supabase_url, table, r["id"], r["video_url"], r.get("storage_path"), dry_run,
        )

    if concurrency <= 1:
        for r in rows:
            rid, ok, msg = work(r)
            print(f"  {rid} {'OK' if ok else 'FAIL'}  {msg}")
            ok_count += 1 if ok else 0
            fail_count += 0 if ok else 1
    else:
        with ThreadPoolExecutor(max_workers=concurrency) as pool:
            for f in as_completed([pool.submit(work, r) for r in rows]):
                rid, ok, msg = f.result()
                print(f"  {rid} {'OK' if ok else 'FAIL'}  {msg}")
                ok_count += 1 if ok else 0
                fail_count += 0 if ok else 1

    dur = time.time() - started
    print(f"[{table}/av1] done: {ok_count} ok, {fail_count} fail in {dur:.1f}s")
    return 0 if fail_count == 0 else 1


def process_row(
    supabase,
    supabase_url: str,
    table: str,
    row_id: str,
    video_url: str,
    storage_path: str | None,
    needs_poster: bool,
    needs_mobile: bool,
    dry_run: bool,
) -> tuple[str, bool, str]:
    """Encodes + uploads + writes back. Returns (row_id, ok, message)."""
    poster_key, mobile_key = storage_paths_for(video_url, storage_path, row_id)
    if dry_run:
        wanted = []
        if needs_poster: wanted.append(f"poster={poster_key}")
        if needs_mobile: wanted.append(f"mobile={mobile_key}")
        return row_id, True, "DRY-RUN " + ", ".join(wanted)

    try:
        assets = encode_assets_from_url(video_url)
    except Exception as e:
        return row_id, False, f"encode failed: {e}"

    try:
        update: dict = {}
        if needs_poster:
            with open(assets.poster_jpeg_path, "rb") as f:
                supabase.storage.from_(BUCKET).upload(
                    poster_key,
                    f.read(),
                    {"content-type": "image/jpeg", "upsert": "true"},
                )
            update["thumbnail_url"] = public_url_for(supabase_url, poster_key)
        if needs_mobile:
            with open(assets.mobile_mp4_path, "rb") as f:
                supabase.storage.from_(BUCKET).upload(
                    mobile_key,
                    f.read(),
                    {"content-type": "video/mp4", "upsert": "true"},
                )
            update["mobile_video_url"] = public_url_for(supabase_url, mobile_key)
        supabase.table(table).update(update).eq("id", row_id).execute()
        return row_id, True, f"uploaded {list(update.keys())}"
    except Exception as e:
        return row_id, False, f"upload failed: {e}"
    finally:
        cleanup(assets)


def process_product_row(
    supabase,
    supabase_url: str,
    product_id: str,
    primary_video_url: str,
    dry_run: bool,
) -> tuple[str, bool, str]:
    """Extracts the primary video's first frame (at the clip's native 3:4
    size) and writes it to products.primary_video_poster_url. Delegates to
    the shared primary_poster helper so the Modal webhook/cron path and this
    one-off sweep stay byte-identical."""
    if dry_run:
        return product_id, True, f"DRY-RUN poster={poster_storage_key(product_id)}"

    try:
        poster_url = generate_primary_poster(
            supabase, supabase_url, product_id, video_url=primary_video_url,
        )
        return product_id, True, f"poster={poster_url}"
    except Exception as e:
        return product_id, False, f"failed: {e}"


def fetch_product_rows(supabase, limit: int | None) -> list[dict]:
    """Products with a primary video but no poster yet. We match the feed's
    own selection criteria — getHomeFeed surfaces any product where
    primary_video_url IS NOT NULL (it doesn't gate on primary_video_status,
    since the autopromote backfill sets the URL without flipping status to
    'done') — so every such product needs a matching 3:4 poster."""
    q = (
        supabase.table("products")
        .select("id, primary_video_url")
        .not_.is_("primary_video_url", "null")
        .is_("primary_video_poster_url", "null")
    )
    if limit:
        q = q.limit(limit)
    return q.execute().data or []


def run_products(limit: int | None, dry_run: bool, concurrency: int) -> int:
    supabase_url = os.environ.get("SUPABASE_URL")
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not supabase_url or not service_key:
        print("SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required in env", file=sys.stderr)
        return 2

    supabase = create_client(supabase_url, service_key)

    rows = fetch_product_rows(supabase, limit)
    if not rows:
        print("[products] nothing to backfill")
        return 0
    print(f"[products] {len(rows)} rows to process")

    ok_count = 0
    fail_count = 0
    started = time.time()

    if concurrency <= 1:
        for r in rows:
            pid, ok, msg = process_product_row(
                supabase, supabase_url, r["id"], r["primary_video_url"], dry_run,
            )
            print(f"  {pid} {'OK' if ok else 'FAIL'}  {msg}")
            ok_count += 1 if ok else 0
            fail_count += 0 if ok else 1
    else:
        with ThreadPoolExecutor(max_workers=concurrency) as pool:
            futures = [
                pool.submit(
                    process_product_row,
                    supabase, supabase_url, r["id"], r["primary_video_url"], dry_run,
                )
                for r in rows
            ]
            for f in as_completed(futures):
                pid, ok, msg = f.result()
                print(f"  {pid} {'OK' if ok else 'FAIL'}  {msg}")
                ok_count += 1 if ok else 0
                fail_count += 0 if ok else 1

    dur = time.time() - started
    print(f"[products] done: {ok_count} ok, {fail_count} fail in {dur:.1f}s")
    return 0 if fail_count == 0 else 1


def fetch_rows(supabase, table: str, limit: int | None) -> list[dict]:
    """Pulls rows from `table` that need either column populated."""
    cols = "id, video_url, storage_path, thumbnail_url, mobile_video_url"
    q = supabase.table(table).select(cols).not_.is_("video_url", "null")
    # We only want rows where at least one of the two derivative columns
    # is missing. supabase-py's .or_ is a string DSL.
    q = q.or_("thumbnail_url.is.null,mobile_video_url.is.null")
    # Live-only on product_creative so we don't waste compute on draft /
    # paused rows. looks_creative is NOT filtered by status — the
    # consumer feed joins on is_primary without checking the creative's
    # status, so pending rows need posters too.
    if table == "product_creative":
        q = q.eq("status", "live")
    if limit:
        q = q.limit(limit)
    res = q.execute()
    return res.data or []


def run(table: str, limit: int | None, dry_run: bool, concurrency: int) -> int:
    supabase_url = os.environ.get("SUPABASE_URL")
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not supabase_url or not service_key:
        print("SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required in env", file=sys.stderr)
        return 2

    supabase = create_client(supabase_url, service_key)

    rows = fetch_rows(supabase, table, limit)
    if not rows:
        print(f"[{table}] nothing to backfill")
        return 0
    print(f"[{table}] {len(rows)} rows to process")

    ok_count = 0
    fail_count = 0
    started = time.time()

    if concurrency <= 1:
        for r in rows:
            rid, ok, msg = process_row(
                supabase,
                supabase_url,
                table,
                r["id"],
                r["video_url"],
                r.get("storage_path"),
                r.get("thumbnail_url") is None,
                r.get("mobile_video_url") is None,
                dry_run,
            )
            print(f"  {rid} {'OK' if ok else 'FAIL'}  {msg}")
            ok_count += 1 if ok else 0
            fail_count += 0 if ok else 1
    else:
        with ThreadPoolExecutor(max_workers=concurrency) as pool:
            futures = [
                pool.submit(
                    process_row,
                    supabase,
                    supabase_url,
                    table,
                    r["id"],
                    r["video_url"],
                    r.get("storage_path"),
                    r.get("thumbnail_url") is None,
                    r.get("mobile_video_url") is None,
                    dry_run,
                )
                for r in rows
            ]
            for f in as_completed(futures):
                rid, ok, msg = f.result()
                print(f"  {rid} {'OK' if ok else 'FAIL'}  {msg}")
                ok_count += 1 if ok else 0
                fail_count += 0 if ok else 1

    dur = time.time() - started
    print(f"[{table}] done: {ok_count} ok, {fail_count} fail in {dur:.1f}s")
    return 0 if fail_count == 0 else 1


def main(argv: Iterable[str] | None = None) -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--table", choices=["product_creative", "generated_videos", "looks_creative", "products", "all", "both"], default="all")
    p.add_argument("--limit", type=int, default=None)
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--concurrency", type=int, default=1,
                   help="Parallel encodes. Each worker uses ~1 ffmpeg invocation + a few hundred MB of memory. "
                        "Defaults to 1: parallel uploads share one Supabase storage connection that the "
                        "server drops under load ('Server disconnected'), failing most rows. Raise only if "
                        "you've confirmed the storage endpoint tolerates it.")
    p.add_argument("--hls", action="store_true",
                   help="Encode H.264 fMP4 HLS adaptive ladders (source-aware) into "
                        "<base>/hls-v3/ and fill hls_url (products: primary_hls_url) instead of "
                        "poster/mobile assets. Heavier per row; consider a lower --concurrency.")
    p.add_argument("--hevc", action="store_true",
                   help="Encode HEVC fMP4 HLS ladders into <base>/hls-hevc-v3/ and fill "
                        "hls_hevc_url (products: primary_hls_hevc_url). Additive: the H.264 ladder "
                        "stays the fallback for clients without HEVC decode.")
    p.add_argument("--av1", action="store_true",
                   help="Encode an AV1 progressive MP4 (<base>.av1-v1.mp4) and fill video_av1_url "
                        "(products: primary_video_av1_url) for the desktop path. Additive: the "
                        "H.264 source stays the fallback for non-AV1 clients.")
    p.add_argument("--statuses", default=None,
                   help="Comma-separated product_creative statuses to include in HLS backfill "
                        "(default: live). e.g. 'live,done,paused' to cover non-live creatives.")
    p.add_argument("--reencode", action="store_true",
                   help="Re-encode rows that ALREADY have an HLS ladder (hls_url / "
                        "primary_hls_url set), not just missing ones. Use after an encoder "
                        "change (e.g. 1s segments); pair with a bumped output dir so new "
                        "URLs don't collide with immutable-cached old segments. Does not "
                        "null hls_url first, so the feed keeps playing until each row is "
                        "repointed.")
    args = p.parse_args(argv)
    statuses = [s.strip() for s in args.statuses.split(",") if s.strip()] if args.statuses else None

    # `products` follows a different path: it derives the poster from
    # primary_video_url and writes products.primary_video_poster_url (no
    # mobile variant), so it's dispatched to run_products(), not run().
    tables = ["product_creative", "generated_videos", "looks_creative", "products"] if args.table in ("both", "all") else [args.table]
    rc = 0
    for t in tables:
        if args.hls:
            # generated_videos has no hls_url column; skip it in HLS mode.
            if t == "generated_videos":
                continue
            rc |= run_hls(t, args.limit, args.dry_run, args.concurrency, statuses, args.reencode, mode="hls")
        elif args.hevc:
            if t == "generated_videos":
                continue
            rc |= run_hls(t, args.limit, args.dry_run, args.concurrency, statuses, args.reencode, mode="hevc")
        elif args.av1:
            if t == "generated_videos":
                continue
            rc |= run_av1(t, args.limit, args.dry_run, args.concurrency, statuses, args.reencode)
        elif t == "products":
            rc |= run_products(args.limit, args.dry_run, args.concurrency)
        else:
            rc |= run(t, args.limit, args.dry_run, args.concurrency)
    return rc


if __name__ == "__main__":
    sys.exit(main())
