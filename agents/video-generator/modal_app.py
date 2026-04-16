"""
Modal deployment for the Video Generator Agent.

Exposes three entry points:
  1. HTTP webhook  — POST /generate-video  (Supabase DB webhook on products UPDATE scrape_status=done)
  2. Cron job      — every 30 min  (retries pending/failed jobs, catches products with no videos)
  3. Manual        — generate_for_product  (specific product + style + ai_model combo)

Deploy:
    modal deploy modal_app.py

Test locally:
    modal run modal_app.py::generate_pending   # run cron manually
    modal serve modal_app.py                   # serve webhook locally with live reload

Secrets — create once in Modal dashboard or via CLI:
    modal secret create video-generator-secrets \
        GOOGLE_API_KEY=... \
        SUPABASE_URL=... \
        SUPABASE_SERVICE_ROLE_KEY=...
"""

import modal

# ─── Image ─────────────────────────────────────────────────────────────

generator_image = (
    modal.Image.debian_slim(python_version="3.12")
    .pip_install(
        "google-genai>=1.0.0",
        "supabase>=2.10.0",
        "httpx>=0.27.0",
        "python-dotenv>=1.0.0",
        "fastapi[standard]>=0.115.0",
    )
    .add_local_file("config.py", "/root/config.py")
    .add_local_file("prompts.py", "/root/prompts.py")
    .add_local_file("veo_client.py", "/root/veo_client.py")
    .add_local_file("agent.py", "/root/agent.py")
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


# ─── Webhook: triggered when product scrape completes ──────────────────

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


# ─── Cron: retry pending/failed jobs every 30 min ─────────────────────

@app.function(
    image=generator_image,
    secrets=secrets,
    schedule=modal.Cron("*/30 * * * *"),
)
def generate_pending():
    """Scheduled job — find pending and failed generated_videos, retry them."""
    import os
    import sys
    sys.path.insert(0, "/root")
    from supabase import create_client

    supabase = create_client(
        os.environ["SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_ROLE_KEY"],
    )

    # Retry failed/pending jobs
    rows = (
        supabase.table("generated_videos")
        .select("id, product_id, style, ai_model_id")
        .in_("status", ["pending", "failed"])
        .limit(10)
        .execute()
    )

    pending = rows.data or []

    # Also find products with scrape_status=done but no generated_videos
    products_without_videos = (
        supabase.rpc("products_without_videos", {}).execute()
    )
    new_products = products_without_videos.data or []

    if not pending and not new_products:
        print("No pending jobs or unprocessed products.")
        return

    # Retry existing jobs
    if pending:
        print(f"Retrying {len(pending)} pending/failed job(s)…")
        for _ in generate_and_update.starmap([
            (job["product_id"], job.get("style", "editorial_runway"), job.get("ai_model_id"))
            for job in pending
        ]):
            pass

    # Generate for new products (default style, auto-select AI model)
    if new_products:
        print(f"Generating videos for {len(new_products)} new product(s)…")
        for _ in generate_and_update.starmap([
            (p["id"],)
            for p in new_products
        ]):
            pass
