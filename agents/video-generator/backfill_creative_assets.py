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
    python backfill_creative_assets.py            # both tables
    python backfill_creative_assets.py --table product_creative --limit 5
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

from asset_encoder import encode_assets_from_url, cleanup  # noqa: E402

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


def storage_paths_for(video_url: str, storage_path: str | None, row_id: str | None = None) -> tuple[str, str]:
    """Derive the poster + mobile storage keys from the source video.

    Prefers the explicit `storage_path` column when present; falls back
    to deriving from the public URL (the bucket prefix in the URL is
    stable). For external URLs (e.g. fal.media CDN), uses the row ID
    as the storage key prefix. Returns (poster_key, mobile_key)."""
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
    # Strip the `.mp4` so we don't end up with `foo.mp4.poster.jpg` -
    # cleaner: `foo.poster.jpg` and `foo.mobile.mp4`.
    if base.endswith(".mp4"):
        base = base[:-4]
    return f"{base}{POSTER_SUFFIX}", f"{base}{MOBILE_SUFFIX}"


def public_url_for(supabase_url: str, key: str) -> str:
    return f"{supabase_url}/storage/v1/object/public/{BUCKET}/{key}"


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
    p.add_argument("--table", choices=["product_creative", "generated_videos", "looks_creative", "all", "both"], default="all")
    p.add_argument("--limit", type=int, default=None)
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--concurrency", type=int, default=2,
                   help="Parallel encodes. Each worker uses ~1 ffmpeg invocation + a few hundred MB of memory.")
    args = p.parse_args(argv)

    tables = ["product_creative", "generated_videos", "looks_creative"] if args.table in ("both", "all") else [args.table]
    rc = 0
    for t in tables:
        rc |= run(t, args.limit, args.dry_run, args.concurrency)
    return rc


if __name__ == "__main__":
    sys.exit(main())
