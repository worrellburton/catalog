"""
Modal deployment for the Video Generator Agent.

Exposes entry points:
  1. POST /generate-ad             — Supabase webhook when product_creative row inserted
  2. POST /generate-video          — Supabase webhook when products.scrape_status → done
  3. POST /generate-primary-poster — products DB trigger when primary_video_url is set
  4. Cron job                      — every 30 min: retry pending creatives & looks,
                                     backfill missing primary-video posters
  5. Manual                        — generate_ad_job / generate_and_update

Deploy:
    modal deploy modal_app.py

Test locally:
    modal run modal_app.py::generate_pending   # run cron manually
    modal serve modal_app.py                   # live-reload webhook server

Secrets — create once in Modal dashboard or via CLI:
    modal secret create video-generator-secrets \
        GOOGLE_API_KEY=... \
        SUPABASE_URL=... \
        SUPABASE_SERVICE_ROLE_KEY=...

Supabase webhooks to configure in Dashboard → Database → Webhooks:
  • Table: product_creative, event: INSERT
    → POST {modal_webhook_url}/generate-ad
  • Table: products, event: UPDATE (filter: scrape_status = done)
    → POST {modal_webhook_url}/generate-video

The primary-poster endpoint is wired via a DB trigger instead of a
dashboard webhook — see migration
20260601000008_trg_generate_primary_poster.sql
(trg_products_generate_primary_poster → POST /generate-primary-poster).
"""

import modal

# ─── Image ─────────────────────────────────────────────────────────────

generator_image = (
    modal.Image.debian_slim(python_version="3.12")
    # libcairo2 + libpango1 are required by cairosvg's transitive
    # dependencies (cairocffi -> cairo -> pango). Without them, the
    # wordmark watermark rasterizer fails at import time.
    .apt_install("ffmpeg", "libcairo2-dev", "libpango1.0-0")
    .pip_install(
        "google-genai>=1.0.0",
        "supabase>=2.10.0",
        "httpx>=0.27.0",
        "python-dotenv>=1.0.0",
        "fastapi[standard]>=0.115.0",
        "fal-client>=0.4.0",
        # Watermark renderer: cairosvg rasterizes the Catalog wordmark
        # SVG path to a transparent PNG once per container, then
        # ffmpeg overlays it onto the source MP4.
        "cairosvg>=2.7.0",
    )
    .add_local_file("config.py", "/root/config.py")
    .add_local_file("prompts.py", "/root/prompts.py")
    .add_local_file("veo_client.py", "/root/veo_client.py")
    .add_local_file("seedance_client.py", "/root/seedance_client.py")
    .add_local_file("video_crop.py", "/root/video_crop.py")
    .add_local_file("ad_generator.py", "/root/ad_generator.py")
    .add_local_file("agent.py", "/root/agent.py")
    .add_local_file("watermark.py", "/root/watermark.py")
    # Primary-video poster extraction (asset_encoder does the ffmpeg
    # frame grab; primary_poster wraps upload + DB write).
    .add_local_file("asset_encoder.py", "/root/asset_encoder.py")
    .add_local_file("primary_poster.py", "/root/primary_poster.py")
)

# ─── App ───────────────────────────────────────────────────────────────

app = modal.App("video-generator")

secrets = [modal.Secret.from_name("video-generator-secrets")]

# ─── Shared: generate video for one product ────────────────────────────

@app.function(
    image=generator_image,
    secrets=secrets,
    timeout=600,         # 10 min max (Veo can take up to 6 min + upload)
    retries=1,
    max_containers=3,    # Veo jobs are slow; 3 parallel keeps costs predictable
)
def generate_and_update(
    product_id: str,
    style: str = "editorial_runway",
    ai_model_id: str | None = None,
):
    """Generate a video for a single product and write results to Supabase."""
    import sys
    sys.path.insert(0, "/root")
    from agent import generate_video

    result = generate_video(
        product_id=product_id,
        style=style,
        ai_model_id=ai_model_id,
    )
    print(f"[{product_id}] look={result['look_id']} video={result['video_url']}")
    return result


# ─── Ad generation: run one product_creative job ──────────────────────

@app.function(
    image=generator_image,
    secrets=secrets,
    timeout=600,         # 10 min — 3 Veo attempts × up to 2 min each + upload
    retries=1,
    max_containers=5,    # ads can run in parallel
)
def generate_ad_job(ad_id: str):
    """Generate a video for a single product_creative row and update Supabase."""
    import sys
    sys.path.insert(0, "/root")
    from ad_generator import generate_ad_video

    result = generate_ad_video(ad_id)
    print(f"[ad {ad_id}] url={result.get('video_url')} method={result.get('method')}")
    return result


# ─── Webhook: triggered when product_creative row is inserted ────────

@app.function(image=generator_image, secrets=secrets)
@modal.fastapi_endpoint(method="POST", label="generate-ad")
def generate_ad_webhook(body: dict):
    """
    POST /generate-ad

    Called by Supabase Database Webhook on INSERT to product_creative.
    Supabase sends the full new row as body["record"].
    """
    record = body.get("record", {})
    ad_id = record.get("id")
    status = record.get("status")

    if not ad_id:
        return {"error": "Missing ad id"}, 400

    if status not in ("pending", None):
        return {"status": "skipped", "reason": f"ad status is '{status}', expected pending"}

    generate_ad_job.spawn(ad_id)
    return {"status": "queued", "ad_id": ad_id}



@app.function(
    image=generator_image,
    secrets=secrets,
)
@modal.fastapi_endpoint(method="POST", label="generate-video")
def generate_webhook(body: dict):
    """
    POST /generate-video

    Called by Supabase Database Webhook when products.scrape_status is updated to 'done'.
    Supabase sends the full record as body["record"].

    Expected body:
        { "record": { "id": "uuid", "scrape_status": "done", ... } }
    """
    record = body.get("record", {})
    product_id = record.get("id")
    scrape_status = record.get("scrape_status")

    if not product_id:
        return {"error": "Missing product id"}, 400

    if scrape_status != "done":
        return {"status": "skipped", "reason": "scrape_status is not done"}

    # Check if product has images (required for image-to-video)
    images = record.get("images")
    if not images:
        return {"status": "skipped", "reason": "no images"}

    # Dispatch async — webhook returns immediately
    generate_and_update.spawn(product_id)

    return {"status": "queued", "product_id": product_id}


# ─── Primary-video poster: extract a 3:4 still that matches the clip ───

@app.function(
    image=generator_image,
    secrets=secrets,
    timeout=300,
    retries=1,
    max_containers=5,
)
def generate_primary_poster_job(product_id: str):
    """Extract the product's primary-video first frame (native 3:4) and
    write products.primary_video_poster_url. Cheap (one ffmpeg frame grab),
    so it runs with higher concurrency than the video generators."""
    import os
    import sys
    sys.path.insert(0, "/root")
    from supabase import create_client
    from primary_poster import generate_primary_poster

    supabase = create_client(
        os.environ["SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_ROLE_KEY"],
    )
    poster_url = generate_primary_poster(supabase, os.environ["SUPABASE_URL"], product_id)
    print(f"[poster {product_id}] {poster_url}")
    return {"product_id": product_id, "poster_url": poster_url}


@app.function(image=generator_image, secrets=secrets)
@modal.fastapi_endpoint(method="POST", label="generate-primary-poster")
def generate_primary_poster_webhook(body: dict):
    """
    POST /generate-primary-poster

    Called by the products DB trigger (trg_products_generate_primary_poster)
    whenever primary_video_url appears/changes and no poster exists yet.
    Supabase sends the full new row as body["record"].
    """
    record = body.get("record", {})
    product_id = record.get("id")
    if not product_id:
        return {"error": "Missing product id"}, 400
    if not record.get("primary_video_url"):
        return {"status": "skipped", "reason": "no primary_video_url"}
    if record.get("primary_video_poster_url"):
        return {"status": "skipped", "reason": "poster already set"}

    generate_primary_poster_job.spawn(product_id)
    return {"status": "queued", "product_id": product_id}


# ─── Watermark a user_generation for the public share flow ────────────

@app.function(
    image=generator_image,
    secrets=secrets,
    timeout=300,
    retries=1,
)
def watermark_share(share_id: str):
    """Bake the Catalog wordmark onto the source generation video and
    upload the result. Patches the look_shares row's status +
    watermarked_video_url. Designed to be invoked from the share-look
    edge function via .spawn() so the HTTP request returns
    immediately and the user sees a 'rendering' state until this
    finishes (~15-30s for a 5s clip)."""
    import sys
    sys.path.insert(0, "/root")
    from watermark import watermark_one

    return watermark_one(share_id)


@app.function(image=generator_image, secrets=secrets)
@modal.fastapi_endpoint(method="POST", label="watermark-share")
def watermark_share_webhook(body: dict):
    """POST /watermark-share — called by the share-look Supabase edge
    function once it has inserted a look_shares row. Body shape:
        { "share_id": "<uuid>" }
    """
    share_id = body.get("share_id")
    if not share_id:
        return {"error": "Missing share_id"}, 400

    watermark_share.spawn(share_id)
    return {"status": "queued", "share_id": share_id}


# ─── Cron: retry pending/failed jobs every 30 min ─────────────────────

@app.function(
    image=generator_image,
    secrets=secrets,
    schedule=modal.Cron("*/30 * * * *"),
)
def generate_pending():
    """Scheduled job — retry pending/failed product_creative and generated_videos."""
    import os
    import sys
    sys.path.insert(0, "/root")
    from supabase import create_client

    supabase = create_client(
        os.environ["SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_ROLE_KEY"],
    )

    # ── 0. Promote queued → pending (max 2 slots) ──────────────────
    active = (
        supabase.table("product_creative")
        .select("id", count="exact")
        .in_("status", ["pending", "generating"])
        .execute()
    )
    in_flight = active.count or 0
    # Keep concurrency at 1 to stay under Tier 1 Veo rate limits.
    slots = max(0, 1 - in_flight)
    if slots > 0:
        queued = (
            supabase.table("product_creative")
            .select("id")
            .eq("status", "queued")
            .order("created_at")
            .limit(slots)
            .execute()
        )
        promote_ids = [r["id"] for r in (queued.data or [])]
        if promote_ids:
            for pid in promote_ids:
                supabase.table("product_creative").update({"status": "pending"}).eq("id", pid).execute()
            print(f"Promoted {len(promote_ids)} queued → pending")

    # ── 1. Retry pending/failed product_creative ──────────────────────
    ads = (
        supabase.table("product_creative")
        .select("id")
        .in_("status", ["pending", "failed"])
        .limit(10)
        .execute()
    )
    pending_ads = ads.data or []

    if pending_ads:
        print(f"Retrying {len(pending_ads)} pending/failed ad(s)…")
        for _ in generate_ad_job.starmap([(ad["id"],) for ad in pending_ads]):
            pass
    else:
        print("No pending ads.")

    # ── 2. Retry pending/failed generated_videos (look generation) ────
    rows = (
        supabase.table("generated_videos")
        .select("id, product_id, style, ai_model_id")
        .in_("status", ["pending", "failed"])
        .limit(10)
        .execute()
    )
    pending_looks = rows.data or []

    if pending_looks:
        print(f"Retrying {len(pending_looks)} pending/failed look(s)…")
        for _ in generate_and_update.starmap([
            (job["product_id"], job.get("style", "editorial_runway"), job.get("ai_model_id"))
            for job in pending_looks
        ]):
            pass
    else:
        print("No pending looks.")

    # ── 3. Backfill missing primary-video posters ─────────────────────
    # Safety net behind the DB trigger: catches any product whose
    # primary_video_url was set without the webhook firing (trigger
    # disabled, Modal endpoint down, historical autopromote rows) so the
    # feed never falls back to the square, zoomed primary_image_url.
    missing_posters = (
        supabase.table("products")
        .select("id")
        .not_.is_("primary_video_url", "null")
        .is_("primary_video_poster_url", "null")
        .limit(20)
        .execute()
    )
    poster_rows = missing_posters.data or []
    if poster_rows:
        print(f"Backfilling {len(poster_rows)} missing primary-video poster(s)…")
        for _ in generate_primary_poster_job.starmap([(r["id"],) for r in poster_rows]):
            pass
    else:
        print("No missing primary-video posters.")

