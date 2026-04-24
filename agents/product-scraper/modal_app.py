"""
Modal deployment for the Product Scraper Agent.

Exposes two entry points:
  1. HTTP webhook  — POST /scrape-product  (Supabase DB webhook on INSERT)
  2. Cron job      — every 30 min  (retries pending + failed products)

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
        "fastapi[standard]>=0.115.0",
    )
    .run_commands("playwright install chromium --with-deps")
    .add_local_file("agent.py", "/root/agent.py")
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
    max_containers=3,  # max 3 concurrent scrapes to stay within rate limits
)
def scrape_and_update(product_id: str, url: str):
    """Scrape a single product URL and write results back to Supabase."""
    import os
    from datetime import datetime, timezone
    from supabase import create_client
    from agent import run_agent

    supabase = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])

    # Mark as processing
    supabase.table("products").update({"scrape_status": "processing"}).eq("id", product_id).execute()

    def _write_to_db(product: dict):
        """Called immediately when Claude calls save_product — no waiting for loop end."""
        # Only write fields the agent actually extracted. Blindly writing
        # every key would clobber good data (e.g. from Rainforest ingest)
        # with nulls whenever the Playwright scrape comes back empty.
        scraped = {
            "name": product.get("title"),
            "brand": product.get("brand"),
            "description": product.get("description"),
            "price": product.get("price"),
            "discounted_price": product.get("discounted_price"),
            "currency": product.get("currency"),
            "availability": product.get("availability"),
        }
        update = {k: v for k, v in scraped.items() if v not in (None, "")}

        images = product.get("images") or []
        if images:
            update["images"] = images
            update["image_url"] = images[0]

        update["scrape_status"] = "done"
        update["scraped_at"] = datetime.now(timezone.utc).isoformat()
        update["scrape_error"] = None

        supabase.table("products").update(update).eq("id", product_id).execute()
        print(f"✅ [{product_id}] {product.get('title')} — saved to DB immediately")

    try:
        run_agent(url, save=False, on_save=_write_to_db)
        print(f"✅ [{product_id}] agent loop complete")

    except Exception as e:
        supabase.table("products").update({
            "scrape_status": "failed",
            "scraped_at": datetime.now(timezone.utc).isoformat(),
            "scrape_error": str(e)[:500],
        }).eq("id", product_id).execute()
        print(f"❌ [{product_id}] {e}")
        raise


# ─── Webhook: triggered by Supabase DB webhook on INSERT ───────────────

@app.function(
    image=scraper_image,
    secrets=secrets,
)
@modal.fastapi_endpoint(method="POST", label="scrape-product")
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


# ─── Cron: retry pending + failed products every morning at 8am UTC ────

@app.function(
    image=scraper_image,
    secrets=secrets,
    schedule=modal.Cron("0 8 * * *"),   # 8am UTC daily (was: every 30 min)
)
def scrape_pending():
    """Scheduled job — find pending and failed products, scrape them in parallel."""
    import os
    from supabase import create_client

    supabase = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])

    rows = (
        supabase.table("products")
        .select("id, url")
        .in_("scrape_status", ["pending", "failed"])
        .not_.is_("url", "null")
        .limit(100)    # increased from 10 — process more per daily run
        .execute()
    )

    pending = rows.data or []
    if not pending:
        print("No pending or failed products.")
        return

    print(f"Found {len(pending)} product(s) to scrape — dispatching…")

    # Spawn each product in its own container (fire-and-forget, don't block)
    for row in pending:
        scrape_and_update.spawn(row["id"], row["url"])

    print(f"Spawned {len(pending)} scrape job(s).")
