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


def product_poster_key(product_id: str) -> str:
    """Storage key for a product's primary-video poster. Primary videos
    live on fal's CDN (external URL), so we can't mirror their path — key
    by product id instead, which is stable and one-poster-per-product."""
    return f"products/{product_id}/primary-video{POSTER_SUFFIX}"


def process_product_row(
    supabase,
    supabase_url: str,
    product_id: str,
    primary_video_url: str,
    dry_run: bool,
) -> tuple[str, bool, str]:
    """Extracts the primary video's first frame (at the clip's native 3:4
    size) and writes it to products.primary_video_poster_url. Products only
    need the poster — no mobile variant — so we encode poster_only."""
    poster_key = product_poster_key(product_id)
    if dry_run:
        return product_id, True, f"DRY-RUN poster={poster_key}"

    try:
        assets = encode_assets_from_url(primary_video_url, poster_only=True)
    except Exception as e:
        return product_id, False, f"encode failed: {e}"

    try:
        with open(assets.poster_jpeg_path, "rb") as f:
            supabase.storage.from_(BUCKET).upload(
                poster_key,
                f.read(),
                {"content-type": "image/jpeg", "upsert": "true"},
            )
        poster_url = public_url_for(supabase_url, poster_key)
        supabase.table("products").update(
            {"primary_video_poster_url": poster_url}
        ).eq("id", product_id).execute()
        return product_id, True, f"poster={poster_url}"
    except Exception as e:
        return product_id, False, f"upload failed: {e}"
    finally:
        cleanup(assets)


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
    p.add_argument("--concurrency", type=int, default=2,
                   help="Parallel encodes. Each worker uses ~1 ffmpeg invocation + a few hundred MB of memory.")
    args = p.parse_args(argv)

    # `products` follows a different path: it derives the poster from
    # primary_video_url and writes products.primary_video_poster_url (no
    # mobile variant), so it's dispatched to run_products(), not run().
    tables = ["product_creative", "generated_videos", "looks_creative", "products"] if args.table in ("both", "all") else [args.table]
    rc = 0
    for t in tables:
        if t == "products":
            rc |= run_products(args.limit, args.dry_run, args.concurrency)
        else:
            rc |= run(t, args.limit, args.dry_run, args.concurrency)
    return rc


if __name__ == "__main__":
    sys.exit(main())
