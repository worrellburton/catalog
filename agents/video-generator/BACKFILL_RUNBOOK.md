# Video delivery upgrade — backfill runbook

The code for the HLS/MP4/poster delivery upgrade is landed and inert: the live
feed keeps serving the current `hls-v2` ladder, the H.264 source MP4, and JPEG
posters until **you** run the steps below. `hls-v2` is never deleted and the new
DB columns are nullable, so every step here is reversible.

What the code already changed (no backfill needed):
- **Poster WebP** — posters now render as WebP via the render CDN (live now).
- **Cache-control** — *new* uploads get a 1-year immutable header. Existing
  assets are unchanged (see "Existing source-MP4 cache" below).
- **Hero sharpen** — stronger unsharp mask on the detail hero (live now).

What needs a backfill (this runbook):
- **hls-v3** — source-aware fMP4 H.264 ladder (drops the upscaled rung, preset
  slow, tune film, lower bitrates). Replaces `hls-v2`.
- **HEVC** ladder → `hls_hevc_url` / `primary_hls_hevc_url` (iOS, ~15-25% smaller).
- **AV1** MP4 → `video_av1_url` / `primary_video_av1_url` (desktop, ~30-50% smaller).

---

## 0. Prerequisites

```bash
export SUPABASE_URL=https://vtarjrnqvcqbhoclvcur.supabase.co
export SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
cd agents/video-generator
pip install -r requirements.txt
```

Confirm the ffmpeg build has the codecs (the new encoders no-op gracefully if a
codec is missing — the row just stays on H.264 — but you want them present):

```bash
ffmpeg -hide_banner -encoders | grep -E 'libx264|libx265|libsvtav1'
# need: libx264, libx265 (HEVC), libsvtav1 (AV1)
```

The DB migration (`20260612000000_hevc_av1_columns.sql`) is **already applied**.
Verify if unsure:

```sql
select table_name, column_name from information_schema.columns
where column_name in ('hls_hevc_url','video_av1_url','primary_hls_hevc_url','primary_video_av1_url');
-- expect 6 rows
```

---

## 1. Snapshot (revert point) — DO THIS FIRST

Back up the columns the H.264 re-encode will repoint, so a revert is one UPDATE:

```sql
create table if not exists _hls_url_backup_20260612 as
  select 'looks_creative' as tbl, id, hls_url::text as old_hls from looks_creative where hls_url is not null
  union all
  select 'product_creative', id, hls_url from product_creative where hls_url is not null
  union all
  select 'products', id, primary_hls_url from products where primary_hls_url is not null;
```

(HEVC/AV1 add NEW columns, so their revert is just `update ... set <col> = null`;
no snapshot needed for those.)

---

## 2. Run the backfills

Start with `--dry-run` to see the work list, then drop it. Keep `--concurrency 1`
(parallel uploads share one storage connection that drops under load).

```bash
# 2a. H.264 hls-v3 ladder — re-encode EXISTING rows into the new dir.
#     --reencode processes rows that already have hls_url (the hls-v2 ones);
#     it writes hls-v3 URLs and repoints the column. hls-v2 stays in storage.
python backfill_creative_assets.py --hls --reencode --table product_creative --statuses live,paused,done
python backfill_creative_assets.py --hls --reencode --table looks_creative --statuses live,pending
python backfill_creative_assets.py --hls --reencode --table products

# 2b. HEVC ladder (additive — fills *_hls_hevc_url; H.264 stays the fallback)
python backfill_creative_assets.py --hevc --table product_creative --statuses live,paused,done
python backfill_creative_assets.py --hevc --table looks_creative --statuses live,pending
python backfill_creative_assets.py --hevc --table products

# 2c. AV1 desktop MP4 (additive — fills *_video_av1_url; H.264 stays the fallback)
python backfill_creative_assets.py --av1 --table product_creative --statuses live,paused,done
python backfill_creative_assets.py --av1 --table looks_creative --statuses live,pending
python backfill_creative_assets.py --av1 --table products
```

Notes:
- `--statuses live,pending` is required to catch the 2 primary `looks_creative`
  rows that are `pending` (the default filter is `live` only).
- HEVC/AV1 only fill rows MISSING that column, so they're resumable — re-running
  skips finished rows.
- `generated_videos` is intentionally skipped (not on the consumer feed).

---

## 3. Verify (before flipping clients onto hls-v3)

```bash
# A hls-v3 master + its init/segments exist and play:
curl -s "$SUPABASE_URL/storage/v1/object/public/look-media/<base>/hls-v3/master.m3u8"
#   → should reference v0/playlist.m3u8 ; each variant playlist should have an
#     #EXT-X-MAP:URI="init.mp4" line and seg_*.m4s segments.
```

```sql
-- Coverage counts:
select count(*) filter (where hls_url like '%hls-v3%')  as h264_v3,
       count(*) filter (where hls_hevc_url is not null) as hevc,
       count(*) filter (where video_av1_url is not null) as av1
from product_creative where status='live';
```

On-device spot check (use a real device or a browser that lets you sign in):
- **iPhone/Safari** → detail hero should play HEVC (DevTools won't show it, but
  bytes drop). If a clip is black, the HEVC master is bad — null that row's
  `hls_hevc_url` and it falls back to H.264 instantly.
- **Desktop Chrome** → network panel should show `.av1-v1.mp4` for product
  heroes. If black, the AV1 gate is misfiring — null `video_av1_url`.

---

## 4. Flip clients onto hls-v3 (after verification passes)

Bump the two client cache keys so returning users refetch the feed payload with
the new `hls-v3` URLs, then deploy:

- `app/services/looks.ts` → `LOOKS_LS_KEY` (bump the version suffix)
- `app/services/product-creative.ts` → `HOME_FEED_LS_KEY` (bump the suffix)

Users on a stale cache keep playing valid `hls-v2` until they refresh — nothing
breaks either way (hls-v2 is never deleted).

---

## Existing source-MP4 cache (optional, separate from the above)

The cache-control code fix only affects **new** uploads. Existing source MP4s
(desktop's `primary_video_url`) keep serving `no-cache` until re-uploaded. The
hls-v3 / HEVC / AV1 backfill does NOT touch the source MP4, so to give existing
desktop clips the immutable header you'd re-upload them (download → upload with
`cache-control: public, max-age=31536000, immutable`). This is a latency win,
not correctness — defer unless desktop replay latency matters. (New generations
already get the header.)

---

## Revert

- **hls-v3 H.264 ladder** → restore from the snapshot:
  ```sql
  update product_creative t set hls_url = b.old_hls
    from _hls_url_backup_20260612 b where b.tbl='product_creative' and b.id=t.id;
  -- repeat for looks_creative (hls_url) and products (primary_hls_url)
  ```
- **HEVC** → `update <table> set hls_hevc_url = null` (products: `primary_hls_hevc_url`).
- **AV1** → `update <table> set video_av1_url = null` (products: `primary_video_av1_url`).
- **Code** → `git revert` the relevant commit(s); each phase is its own commit.

Old `hls-v2` segments and any abandoned hls-v3/hevc/av1 objects stay in the
bucket (immutable, harmless); delete them later once you're confident.
