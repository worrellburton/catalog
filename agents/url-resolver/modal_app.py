"""
Modal deployment for the URL Resolver Agent.

Resolves Google Shopping URLs to direct merchant product URLs using SerpAPI.
This is a lightweight agent — no Playwright, no Claude AI — just a SerpAPI
google_product lookup against the numeric product ID in the URL.

Entry points:
  1. HTTP endpoint  — POST /resolve-url      (on-demand, called from admin panel)
  2. Cron job       — daily at 9am UTC        (batch-resolves all Google URLs)

Deploy:
    modal deploy modal_app.py

Test locally:
    modal run modal_app.py::resolve_pending   # run batch manually
    modal serve modal_app.py                  # serve endpoint with live reload

Secrets — reuses the existing scraper-secrets (already has SUPABASE_* + SERPAPI_KEY):
    modal secret create scraper-secrets \\
        SERPAPI_KEY=... \\
        SUPABASE_URL=... \\
        SUPABASE_SERVICE_ROLE_KEY=...
"""

import modal

# ─── Image ─────────────────────────────────────────────────────────────
# Minimal image — no Playwright needed; just requests + supabase client.

resolver_image = (
    modal.Image.debian_slim(python_version="3.12")
    .pip_install(
        "supabase>=2.10.0",
        "python-dotenv>=1.0.0",
        "fastapi[standard]>=0.115.0",
    )
    .add_local_file("agent.py", "/root/agent.py")
)

# ─── App ───────────────────────────────────────────────────────────────

app = modal.App("url-resolver")

# Reuse the same secret group as the product-scraper (SERPAPI_KEY is already there).
secrets = [modal.Secret.from_name("scraper-secrets")]


# ─── Shared: resolve one product and update the DB row ─────────────────

@app.function(
    image=resolver_image,
    secrets=secrets,
    timeout=60,        # SerpAPI call is fast — 60s is plenty
    retries=1,
    max_containers=5,  # allow up to 5 concurrent resolutions
)
def resolve_and_update(product_id: str, url: str):
    """Resolve a single Google Shopping URL and write the merchant URL back to DB."""
    import os
    from supabase import create_client
    from agent import resolve_url

    sb_url = os.environ["SUPABASE_URL"]
    sb_key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    supabase = create_client(sb_url, sb_key)

    print(f"🔗 [{product_id}] Resolving: {url}")

    resolved = resolve_url(url)

    if resolved:
        supabase.table("products").update({
            "url": resolved,
            "url_resolved": True,
        }).eq("id", product_id).execute()
        print(f"✅ [{product_id}] URL updated → {resolved}")
    else:
        # Mark as unresolvable so the cron skips it next time
        supabase.table("products").update({
            "url_resolved": False,
        }).eq("id", product_id).execute()
        print(f"⚠️  [{product_id}] Could not resolve — marked url_resolved=false")


# ─── HTTP endpoint: resolve a single product on demand ─────────────────

@app.function(image=resolver_image, secrets=secrets)
@modal.fastapi_endpoint(method="POST", label="resolve-url")
def resolve_webhook(body: dict):
    """
    POST /resolve-url

    Resolve a single product's Google Shopping URL on demand.
    Called from the admin panel's "Resolve URL" button.

    Body:
        { "product_id": "uuid", "url": "https://www.google.com/shopping/product/..." }
    """
    product_id = body.get("product_id")
    url = body.get("url")

    if not product_id or not url:
        return {"error": "Provide product_id and url"}, 400

    # Spawn async so the HTTP response returns immediately
    resolve_and_update.spawn(product_id, url)
    return {"status": "queued", "product_id": product_id}


# ─── Cron: batch-resolve all Google Shopping URLs daily at 9am UTC ──────

@app.function(
    image=resolver_image,
    secrets=secrets,
    schedule=modal.Cron("0 9 * * *"),  # 9am UTC daily (1 hour after scraper cron)
)
def resolve_pending():
    """
    Scheduled job — find all products with unresolved Google Shopping URLs
    and dispatch resolve_and_update for each.

    Targets rows where:
      - url contains 'google.com'
      - url_resolved is NULL (never attempted) or FALSE (previous attempt failed)
    """
    import os
    from supabase import create_client

    supabase = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])

    # url_resolved IS NULL means never attempted; FALSE means failed last time
    rows = (
        supabase.table("products")
        .select("id, url")
        .ilike("url", "%google.com%")
        .or_("url_resolved.is.null,url_resolved.eq.false")
        .limit(50)
        .execute()
    )

    pending = rows.data or []
    if not pending:
        print("No products with unresolved Google Shopping URLs.")
        return

    print(f"Found {len(pending)} product(s) to resolve — dispatching…")
    for row in pending:
        resolve_and_update.spawn(row["id"], row["url"])
    print(f"Spawned {len(pending)} resolution job(s).")
