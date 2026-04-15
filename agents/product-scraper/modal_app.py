"""
Modal deployment for the Product Scraper Agent.

Exposes two entry points:
  1. HTTP webhook  — POST /scrape  (called by Supabase DB webhook on INSERT)
  2. Cron job      — every 30 min  (picks up any pending rows)

Deploy:
    modal deploy modal_app.py

Test locally:
    modal run modal_app.py::scrape_pending   # run cron manually
    modal serve modal_app.py                 # serve webhook locally with live reload

Secrets — create once in Modal dashboard or via CLI:
    modal secret create scraper-secrets \
        ANTHROPIC_API_KEY=... \
        SUPABASE_URL=... \
        SUPABASE_SERVICE_ROLE_KEY=...
"""

import modal

# ─── Image ─────────────────────────────────────────────────────────────
# Single Docker-style image: Python 3.12, Playwright Chromium, all deps

scraper_image = (
    modal.Image.debian_slim(python_version="3.12")
    .pip_install(
        "anthropic>=0.39.0",
        "playwright>=1.48.0",
        "supabase>=2.10.0",
        "python-dotenv>=1.0.0",
    )
    .run_commands("playwright install chromium --with-deps")
)

# ─── App ───────────────────────────────────────────────────────────────

app = modal.App("product-scraper")

secrets = [modal.Secret.from_name("scraper-secrets")]

# ─── Shared: scrape one product and update the DB row ──────────────────

@app.function(
    image=scraper_image,
    secrets=secrets,
    timeout=300,        # 5 min max per product (Playwright + Claude calls)
    retries=1,          # retry once on transient failures
)
def scrape_and_update(product_id: str, url: str):
    """Scrape a single product URL and write results back to Supabase."""
    import os
    import json
    from datetime import datetime, timezone
    from supabase import create_client
    from agent import run_agent

    supabase = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])

    # Mark as processing
    supabase.table("products").update({"scrape_status": "processing"}).eq("id", product_id).execute()

    try:
        data = run_agent(url, save=False)

        supabase.table("products").update({
            "scrape_status": "done",
            "scraped_at": datetime.now(timezone.utc).isoformat(),
            "scrape_error": None,
            "name": data.get("title"),
            "brand": data.get("brand"),
            "description": data.get("description"),
            "price": data.get("price"),
            "discounted_price": data.get("discounted_price"),
            "currency": data.get("currency"),
            "images": data.get("images", []),
            "image_url": (data.get("images") or [None])[0],
            "availability": data.get("availability"),
        }).eq("id", product_id).execute()

        print(f"✅ [{product_id}] {data.get('title')}")

    except Exception as e:
        supabase.table("products").update({
            "scrape_status": "failed",
            "scraped_at": datetime.now(timezone.utc).isoformat(),
            "scrape_error": str(e)[:500],
        }).eq("id", product_id).execute()
        print(f"❌ [{product_id}] {e}")
        raise


# ─── Cron: every 30 min, pick up all pending rows ──────────────────────

@app.function(
    image=scraper_image,
    secrets=secrets,
    schedule=modal.Cron("*/30 * * * *"),
)
def scrape_pending():
    """Scheduled job — find all pending products and scrape them in parallel."""
    import os
    from supabase import create_client

    supabase = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])

    rows = (
        supabase.table("products")
        .select("id, url")
        .eq("scrape_status", "pending")
        .limit(50)
        .execute()
    )

    pending = rows.data or []
    if not pending:
        print("No pending products.")
        return

    print(f"Found {len(pending)} pending product(s) — dispatching…")

    # Fan out — each product scraped in its own Modal container in parallel
    for _ in scrape_and_update.starmap([(row["id"], row["url"]) for row in pending if row.get("url")]):
        pass


# ─── Webhook: triggered by Supabase DB webhook on INSERT ───────────────

@app.function(
    image=scraper_image,
    secrets=secrets,
)
@modal.web_endpoint(method="POST", label="scrape-product")
def scrape_webhook(body: dict):
    """
    POST /scrape-product

    Called by Supabase Database Webhook when a new row is inserted into products.
    Supabase sends the full record as body["record"].

    Expected body:
        { "record": { "id": "uuid", "url": "https://..." } }
    """
    record = body.get("record", {})
    product_id = record.get("id")
    url = record.get("url")

    if not product_id or not url:
        return {"error": "Missing id or url in record"}, 400

    # Dispatch async — webhook returns immediately, scraping happens in background
    scrape_and_update.spawn(product_id, url)

    return {"status": "queued", "product_id": product_id}
