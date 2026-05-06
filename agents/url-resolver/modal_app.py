"""
Modal deployment for the URL Resolver Agent.

Resolves Google Shopping URLs to direct merchant product page URLs using
Playwright. Visits the Google Shopping page in a real headless browser,
finds the first merchant offer link in the buying-options panel, follows
any Google redirect, and returns the final merchant PDP URL.

Entry points:
  1. HTTP endpoint  — POST /resolve-url      (on-demand, called from admin panel)
  2. Cron job       — daily at 9am UTC        (batch-resolves all Google URLs)

Deploy:
    modal deploy modal_app.py

Secrets — reuses scraper-secrets (only needs SUPABASE_* — no SERPAPI_KEY):
    modal secret create scraper-secrets \\
        SUPABASE_URL=... \\
        SUPABASE_SERVICE_ROLE_KEY=...
"""

import modal

# ─── Image ─────────────────────────────────────────────────────────────
# Uses Playwright + Chromium to headlessly browse Google Shopping pages.

resolver_image = (
    modal.Image.debian_slim(python_version="3.12")
    .pip_install(
        "playwright==1.44.0",
        "supabase>=2.10.0",
        "fastapi[standard]>=0.115.0",
    )
    .run_commands("playwright install chromium --with-deps")
    .add_local_file("agent.py", "/root/agent.py")
)

# ─── App ───────────────────────────────────────────────────────────────

app = modal.App("url-resolver")

# Only needs Supabase credentials — no SERPAPI_KEY required.
secrets = [modal.Secret.from_name("scraper-secrets")]


# ─── Shared: resolve one product and update the DB row ─────────────────

@app.function(
    image=resolver_image,
    secrets=secrets,
    timeout=120,       # Playwright browser navigation needs more time than SerpAPI
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
