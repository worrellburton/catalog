"""
Modal deployment for the Product Scraper Agent.

Exposes two entry points:
  1. HTTP webhook  — POST /scrape-product  (Supabase DB webhook on INSERT)
  2. Cron job      — every 30 min  (retries pending + failed products)

Features:
  - Scrapes product pages with Playwright + Claude AI
  - Auto-enriches descriptions with contextual content (occasions, activities, price)
  - Automatically re-embeds products after enrichment for better search

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
        "playwright-stealth>=2.0.0",
        "supabase>=2.10.0",
        "python-dotenv>=1.0.0",
        "fastapi[standard]>=0.115.0",
        "requests>=2.31.0",
    )
    .run_commands("playwright install chromium --with-deps")
    .add_local_file("agent.py", "/root/agent.py")
)

# ─── App ───────────────────────────────────────────────────────────────

app = modal.App("product-scraper")

secrets = [modal.Secret.from_name("scraper-secrets")]

# ─── Shared: AI description enrichment ────────────────────────────────


def enrich_description(product_data: dict) -> str | None:
    """
    Enrich a product description with AI-generated contextual content.
    
    Adds occasion/activity/price context to enable contextual search queries
    like "casual friday", "gym workout", "brunch", etc.
    
    Args:
        product_data: dict with keys: name, brand, type, price, gender, description
    
    Returns:
        Enriched description string, or None on error
    """
    import os
    import anthropic
    
    name = product_data.get("name", "Unknown Product")
    brand = product_data.get("brand", "Unknown")
    type_ = product_data.get("type", "Unknown")
    gender = product_data.get("gender", "unisex")
    price = product_data.get("price", "Unknown")
    description = product_data.get("description", "No description available.")
    size_fit = product_data.get("size_fit") or ""
    materials_care = product_data.get("materials_care") or ""

    extra_context = ""
    if size_fit:
        extra_context += f"\nSize & Fit: {size_fit}"
    if materials_care:
        extra_context += f"\nMaterials & Care: {materials_care}"

    prompt = f"""You are a fashion copywriter. Enhance this product description by adding 2-3 sentences with:
- Specific occasions (e.g., "casual friday", "weekend brunch", "date night", "yoga class")
- Activities it's perfect for (e.g., "gym workouts", "running errands", "lounging")
- Price context using the actual price (e.g., "at $78", "under $300", "luxury $550")
- Keep it natural and conversational

Product: {name}
Brand: {brand}
Type: {type_}
Gender: {gender}
Price: {price}{extra_context}

Current description:
{description}

IMPORTANT:
- Keep existing description text
- Add new sentences at the END
- Be specific about occasions and activities
- Mention the actual price if available
- Keep total length under 500 characters
- Use natural, flowing language

Return ONLY the enhanced description, nothing else."""

    try:
        client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
        response = client.messages.create(
            model="claude-sonnet-4-5-20250929",
            max_tokens=300,
            messages=[{"role": "user", "content": prompt}]
        )
        enriched = response.content[0].text.strip()
        return enriched
    except Exception as e:
        print(f"  ⚠️  [{product_data.get('name')}] Enrichment error: {e}")
        return None


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
    from agent import run_agent, _is_google_shopping_url, BrowserSession

    sb_url = os.environ["SUPABASE_URL"]
    sb_key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    supabase = create_client(sb_url, sb_key)

    # Mark as processing
    supabase.table("products").update({"scrape_status": "processing"}).eq("id", product_id).execute()

    # Google Shopping fast path: always resolve the merchant URL up front and
    # persist it on the row. Many merchant sites (e.g. shop.lululemon.com)
    # reject Playwright with HTTP2 protocol errors, so the regular AI scrape
    # would fail anyway -- but we can still recover the canonical merchant URL
    # from Google's redirect, which is the most valuable piece of data.
    #
    # If the row already has name + description + images, skip the AI scrape
    # entirely (nothing to gain). Otherwise, try to scrape the resolved URL,
    # but if the merchant blocks us, keep the resolved URL and mark done.
    google_shopping_resolved = False
    if _is_google_shopping_url(url):
        existing = (
            supabase.table("products")
            .select("name,description,images,image_url")
            .eq("id", product_id)
            .single()
            .execute()
        )
        row = existing.data or {}
        has_images = bool(row.get("images")) or bool(row.get("image_url"))
        has_details = bool(row.get("name")) and bool(row.get("description"))

        print(f"🛒 [{product_id}] Google Shopping URL detected — resolving merchant URL")
        browser = BrowserSession(use_stealth=False, proxy=None)
        resolved = None
        try:
            browser.start()
            resolved = browser.resolve_google_shopping(url)
        except Exception as e:
            print(f"  ⚠️  [{product_id}] Failed to resolve Google Shopping URL: {e}")
        finally:
            try:
                browser.stop()
            except Exception:
                pass

        if resolved:
            supabase.table("products").update({"url": resolved}).eq("id", product_id).execute()
            print(f"  🔗 [{product_id}] URL replaced: {resolved}")
            url = resolved
            google_shopping_resolved = True

            # Skip full scrape if row already enriched.
            if has_images and has_details:
                supabase.table("products").update({
                    "scrape_status": "done",
                    "scraped_at": datetime.now(timezone.utc).isoformat(),
                    "scrape_error": None,
                }).eq("id", product_id).execute()
                print(f"✅ [{product_id}] Already enriched — skipping AI scrape")
                return

    saved_product_data = None  # Store for enrichment

    def _write_to_db(product: dict):
        """Called immediately when Claude calls save_product — no waiting for loop end."""
        nonlocal saved_product_data
        
        update_payload = {
            "scrape_status": "done",
            "scraped_at": datetime.now(timezone.utc).isoformat(),
            "scrape_error": None,
            "name": product.get("title"),
            "brand": product.get("brand"),
            "description": product.get("description"),
            "price": product.get("price"),
            "discounted_price": product.get("discounted_price"),
            "currency": product.get("currency"),
            "images": product.get("images", []),
            "image_url": (product.get("images") or [None])[0],
            "availability": product.get("availability"),
            "type": product.get("type"),
            "gender": product.get("gender"),
            "size_fit": product.get("size_fit"),
            "materials_care": product.get("materials_care"),
        }
        # If the original URL was a Google Shopping link, overwrite it with the
        # resolved merchant URL so the row points to the actual product page.
        resolved_url = product.get("url")
        if resolved_url and resolved_url != url:
            update_payload["url"] = resolved_url
            print(f"  🔗 [{product_id}] URL updated to resolved merchant URL: {resolved_url}")

        supabase.table("products").update(update_payload).eq("id", product_id).execute()
        print(f"✅ [{product_id}] {product.get('title')} — saved to DB immediately")
        
        # Store product data for enrichment after scraping completes
        saved_product_data = {
            "name": product.get("title"),
            "brand": product.get("brand"),
            "type": product.get("type"),
            "price": product.get("price"),
            "gender": product.get("gender"),
            "description": product.get("description"),
            "size_fit": product.get("size_fit"),
            "materials_care": product.get("materials_care"),
        }
        
        # Note: quality_score is auto-computed by the trg_products_quality_score trigger

    try:
        run_agent(url, save=False, on_save=_write_to_db)
        print(f"✅ [{product_id}] agent loop complete")
        
        # Enrich description after successful scrape
        if saved_product_data:
            print(f"🤖 [{product_id}] Enriching description with AI...")
            enriched = enrich_description(saved_product_data)
            
            if enriched:
                # Update with enriched description
                supabase.table("products").update({
                    "description": enriched,
                    "description_enriched": True
                }).eq("id", product_id).execute()
                print(f"✨ [{product_id}] Description enriched (+{len(enriched) - len(saved_product_data.get('description', ''))} chars)")
                
                # Trigger re-embedding with enriched description
                try:
                    import requests
                    response = requests.post(
                        f"{sb_url}/functions/v1/embed-product",
                        headers={
                            "Authorization": f"Bearer {sb_key}",
                            "apikey": sb_key,
                            "Content-Type": "application/json",
                        },
                        json={"id": product_id, "force": True},
                        timeout=30
                    )
                    if response.ok:
                        print(f"🔍 [{product_id}] Re-embedded with enriched description")
                    else:
                        print(f"  ⚠️  [{product_id}] Re-embed warning: {response.text[:100]}")
                except Exception as e:
                    print(f"  ⚠️  [{product_id}] Re-embed error: {e}")
            else:
                print(f"  ⚠️  [{product_id}] Enrichment failed, keeping original description")

    except Exception as e:
        # If we already resolved a Google Shopping URL but the merchant page
        # itself is unscrapeable (HTTP2 block / SITE_BLOCKED), don't mark the
        # row as failed -- the resolved URL is still useful and saved. Mark
        # the row as done with a soft note instead so it doesn't get retried.
        err_msg = str(e)
        is_blocked = "SITE_BLOCKED" in err_msg or "ERR_HTTP2_PROTOCOL_ERROR" in err_msg
        if google_shopping_resolved and is_blocked:
            supabase.table("products").update({
                "scrape_status": "done",
                "scraped_at": datetime.now(timezone.utc).isoformat(),
                "scrape_error": f"Merchant site blocked scrape; URL resolved only: {err_msg[:300]}",
            }).eq("id", product_id).execute()
            print(f"⚠️  [{product_id}] Merchant blocked scrape, but URL was resolved — marking done")
            return

        supabase.table("products").update({
            "scrape_status": "failed",
            "scraped_at": datetime.now(timezone.utc).isoformat(),
            "scrape_error": err_msg[:500],
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


# ─── HTTP endpoint: trigger a single product scrape on demand ─────────

@app.function(
    image=scraper_image,
    secrets=secrets,
)
@modal.fastapi_endpoint(method="POST", label="trigger-scrape")
def trigger_scrape(body: dict):
    """
    POST /trigger-scrape

    Trigger a scrape for a specific product or flush all pending rows.

    Body (specific product):
        { "product_id": "uuid", "url": "https://..." }

    Body (flush all pending — same as running the cron manually):
        { "flush_pending": true }

    Called by the admin panel after retry / add-URL so products don't
    have to wait for the 8am UTC daily cron.
    """
    if body.get("flush_pending"):
        scrape_pending.spawn()
        return {"status": "flushing_pending"}

    product_id = body.get("product_id")
    url = body.get("url")

    if not product_id or not url:
        return {"error": "Provide product_id + url, or flush_pending: true"}, 400

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
        .limit(10)
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


# ─── On-demand backfill: re-scrape rows missing size_fit / materials_care ──

@app.function(
    image=scraper_image,
    secrets=secrets,
    timeout=120,
)
def backfill_size_fit(
    limit: int = 25,
    dry_run: bool = True,
    only_brand: str | None = None,
):
    """
    Re-scrape products whose size_fit and materials_care are both NULL.

    These are typically rows that were imported before migration 092 added
    those columns, or via paths that didn't run this agent. Only targets
    rows with scrape_status='done' — the 'pending' / 'failed' rows are
    already handled by the regular cron / retry path, so this backfill
    deliberately stays out of their way.

    Reuses scrape_and_update so the full pipeline (Playwright scrape,
    description enrichment, re-embedding) runs end-to-end. The downside
    is that name / description / images get refreshed too, which is
    fine for a stale catalog but worth knowing if a row was manually
    edited.

    Concurrency is bounded by scrape_and_update.max_containers (currently
    3), so spawning a large batch just queues — it won't overrun
    Anthropic or the merchant sites.

    Usage:
        # Dry-run, see the first 25 candidates without spending compute:
        modal run modal_app.py::backfill_size_fit

        # Actually scrape 50 rows:
        modal run modal_app.py::backfill_size_fit --limit 50 --no-dry-run

        # Scope to one brand (useful for piloting):
        modal run modal_app.py::backfill_size_fit \\
            --only-brand "James Perse" --no-dry-run
    """
    import os
    from supabase import create_client

    supabase = create_client(
        os.environ["SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_ROLE_KEY"],
    )

    q = (
        supabase.table("products")
        .select("id, brand, name, url")
        .is_("size_fit", "null")
        .is_("materials_care", "null")
        .not_.is_("url", "null")
        .eq("scrape_status", "done")
    )
    if only_brand:
        q = q.eq("brand", only_brand)

    rows = q.order("created_at", desc=True).limit(limit).execute()
    candidates = rows.data or []

    if not candidates:
        print("No backfill candidates found.")
        return {"found": 0, "queued": 0, "dry_run": dry_run}

    print(
        f"Found {len(candidates)} backfill candidate(s) "
        f"(limit={limit}, dry_run={dry_run}"
        + (f", only_brand={only_brand!r}" if only_brand else "")
        + "):"
    )
    for r in candidates:
        brand = (r.get("brand") or "?")
        name  = (r.get("name")  or "?")[:60]
        print(f"  • [{r['id']}] {brand} — {name}")

    if dry_run:
        print("\nDry run — no scrapes spawned. Re-run with --no-dry-run.")
        return {"found": len(candidates), "queued": 0, "dry_run": True}

    for r in candidates:
        scrape_and_update.spawn(r["id"], r["url"])

    print(f"\nSpawned {len(candidates)} scrape job(s).")
    return {"found": len(candidates), "queued": len(candidates), "dry_run": False}
