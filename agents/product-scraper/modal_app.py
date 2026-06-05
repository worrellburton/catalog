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
        # Patchright: drop-in patched Playwright used on the bot-blocked retry.
        # Beats Akamai/Cloudflare fingerprinting that playwright-stealth misses.
        "patchright>=1.0.0",
        "supabase>=2.10.0",
        "python-dotenv>=1.0.0",
        "fastapi[standard]>=0.115.0",
        "requests>=2.31.0",
    )
    .run_commands(
        "playwright install chromium --with-deps",
        # Patchright ships its own patched Chromium build — install it too.
        "patchright install chromium",
    )
    .add_local_file("agent.py", "/root/agent.py")
    # Rotating residential proxy pool (Webshare). Used by agent.py to retry
    # behind a fresh residential IP after a SITE_BLOCKED (Akamai/Cloudflare).
    # gitignored — baked into the image at deploy time from the local file.
    .add_local_file("residential-proxies.txt", "/root/residential-proxies.txt")
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


# ─── Shared: materials parsing (no AI) ────────────────────────────────


def parse_materials(materials_care: str | None) -> list[dict] | None:
    """Parse material composition text into structured [{fiber, percentage}] array.

    Handles common formats:
      - "75% cotton, 25% polyester"
      - "Cotton 100%"
      - "75% Wool / 25% Lyocell"
      - "TENCEL™ Lyocell"
      - "Body: 95% Cotton, 5% Elastane. Trim: 100% Polyester"
    """
    import re

    if not materials_care:
        return None

    text = materials_care.strip()
    results = []
    seen = set()

    # Pattern 1: "75% cotton" or "cotton 75%"
    pct_first = re.findall(r'(\d{1,3})\s*%\s*([A-Za-z™®][A-Za-z\s™®-]{1,30})', text)
    for pct_str, fiber in pct_first:
        fiber_clean = re.sub(r'[™®™®]', '', fiber).strip().lower()
        fiber_clean = re.sub(r'\s*(,|/|\.|\band\b).*', '', fiber_clean).strip()
        if fiber_clean and fiber_clean not in seen:
            seen.add(fiber_clean)
            results.append({"fiber": fiber_clean, "percentage": int(pct_str)})

    fiber_first = re.findall(r'([A-Za-z™®][A-Za-z\s™®-]{1,30}?)\s+(\d{1,3})\s*%', text)
    for fiber, pct_str in fiber_first:
        fiber_clean = re.sub(r'[™®™®]', '', fiber).strip().lower()
        fiber_clean = re.sub(r'\s*(,|/|\.|\band\b).*', '', fiber_clean).strip()
        if fiber_clean and fiber_clean not in seen:
            seen.add(fiber_clean)
            results.append({"fiber": fiber_clean, "percentage": int(pct_str)})

    if results:
        return results

    # Pattern 2: standalone fiber names without percentages
    known_fibers = {
        'cotton', 'polyester', 'nylon', 'silk', 'wool', 'linen', 'cashmere',
        'viscose', 'rayon', 'spandex', 'elastane', 'lycra', 'modal', 'tencel',
        'lyocell', 'acrylic', 'hemp', 'bamboo', 'leather', 'suede', 'denim',
        'fleece', 'velvet', 'satin', 'chiffon', 'organza', 'tweed', 'corduroy',
        'jersey', 'mesh', 'down', 'polyamide', 'polypropylene', 'cupro',
    }
    words = re.findall(r'[a-zA-Z]+', text.lower())
    for word in words:
        if word in known_fibers and word not in seen:
            seen.add(word)
            results.append({"fiber": word, "percentage": None})

    return results if results else None


# ─── Shared: AI fit intelligence ──────────────────────────────────────


def enrich_fit_intelligence(product_data: dict) -> dict | None:
    """AI-derived fit analysis: fit type, body type match, layering, warmth, stretch."""
    import os
    import anthropic

    name = product_data.get("name", "Unknown")
    brand = product_data.get("brand", "Unknown")
    type_ = product_data.get("type", "Unknown")
    gender = product_data.get("gender", "unisex")
    size_fit = product_data.get("size_fit") or "Not available"
    materials_care = product_data.get("materials_care") or "Not available"
    size_chart = product_data.get("size_chart")
    variants = product_data.get("variants")

    size_chart_str = ""
    if size_chart:
        import json
        size_chart_str = f"\nSize Chart: {json.dumps(size_chart)[:500]}"

    variants_str = ""
    if variants:
        import json
        variants_str = f"\nVariants: {json.dumps(variants)[:300]}"

    prompt = f"""Analyze this product's fit characteristics. Return ONLY valid JSON.

Product: {name}
Brand: {brand}
Type: {type_}
Gender: {gender}
Size & Fit: {size_fit}
Materials & Care: {materials_care}{size_chart_str}{variants_str}

Return this exact JSON structure:
{{
  "fit_type": "slim|regular|relaxed|oversized|tailored|athletic",
  "body_type_match": ["lean", "athletic", "average", "broad", "petite", "tall", "plus"],
  "layering": true/false,
  "warmth_rating": "cool|light|medium|warm|heavy",
  "stretch_behavior": "none|low|medium|high",
  "likely_feel": "short description of fabric hand-feel",
  "true_to_size": "runs_small|true_to_size|runs_large",
  "best_for_occasions": ["casual", "office", "formal", "active", "lounge"],
  "season": ["spring", "summer", "fall", "winter"]
}}

Rules:
- Only include body_type_match entries that genuinely suit the garment
- Infer from materials (e.g., wool=warm, linen=cool, elastane=stretch)
- Infer from brand reputation if known (Zara=slim, Uniqlo=relaxed, etc.)
- best_for_occasions max 3 entries
- season: which seasons the garment is appropriate for"""

    try:
        client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
        response = client.messages.create(
            model="claude-sonnet-4-5-20250929",
            max_tokens=400,
            messages=[{"role": "user", "content": prompt}]
        )
        import json
        text = response.content[0].text.strip()
        # Strip markdown code fences if present
        if text.startswith("```"):
            text = text.split("\n", 1)[1] if "\n" in text else text[3:]
        if text.endswith("```"):
            text = text[:-3]
        text = text.strip()
        return json.loads(text)
    except Exception as e:
        print(f"  ⚠️  [{product_data.get('name')}] Fit intelligence error: {e}")
        return None


# ─── Shared: AI taxonomy & styling ────────────────────────────────────


def generate_taxonomy_and_styling(product_data: dict) -> tuple[dict | None, dict | None]:
    """AI-generated product taxonomy and styling metadata.

    Returns (taxonomy, styling) tuple.
    """
    import os
    import anthropic

    name = product_data.get("name", "Unknown")
    brand = product_data.get("brand", "Unknown")
    type_ = product_data.get("type", "Unknown")
    gender = product_data.get("gender", "unisex")
    description = product_data.get("description") or ""
    materials = product_data.get("materials_care") or ""

    prompt = f"""Categorize this product and generate styling metadata. Return ONLY valid JSON.

Product: {name}
Brand: {brand}
Current type: {type_}
Gender: {gender}
Description: {description[:300]}
Materials: {materials[:200]}

Return this exact JSON structure:
{{
  "taxonomy": {{
    "category": "fashion|beauty|home|tech|lifestyle|food",
    "subcategory": "specific product type, e.g. 'half zip sweater', 'slim fit chinos', 'platform sneakers'",
    "style": "aesthetic, e.g. 'minimal luxury', 'streetwear', 'classic', 'bohemian', 'athleisure', 'preppy'"
  }},
  "styling": {{
    "works_with": ["max 5 complementary items, e.g. 'wide leg trousers', 'white sneakers'"],
    "occasion": ["max 3, e.g. 'smart casual', 'weekend brunch', 'office'"],
    "season": ["spring", "summer", "fall", "winter"]
  }}
}}

Rules:
- subcategory should be MORE specific than the type field, not less
- works_with should be practical styling suggestions
- occasion should reflect realistic use cases"""

    try:
        client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
        response = client.messages.create(
            model="claude-sonnet-4-5-20250929",
            max_tokens=400,
            messages=[{"role": "user", "content": prompt}]
        )
        import json
        text = response.content[0].text.strip()
        if text.startswith("```"):
            text = text.split("\n", 1)[1] if "\n" in text else text[3:]
        if text.endswith("```"):
            text = text[:-3]
        text = text.strip()
        result = json.loads(text)
        return result.get("taxonomy"), result.get("styling")
    except Exception as e:
        print(f"  ⚠️  [{product_data.get('name')}] Taxonomy/styling error: {e}")
        return None, None


# ─── Shared: confidence scoring (no AI) ───────────────────────────────


def compute_confidence_scores(product_data: dict) -> dict:
    """Score each extracted field 0-1 based on source reliability."""
    scores = {}

    # Price confidence
    if product_data.get("price"):
        scores["price"] = 0.95
    else:
        scores["price"] = 0.0

    # Brand
    if product_data.get("brand"):
        scores["brand"] = 0.90
    else:
        scores["brand"] = 0.0

    # Size chart: HTML table > AI inference
    if product_data.get("size_chart"):
        scores["size_chart"] = 0.85
    else:
        scores["size_chart"] = 0.0

    # Variants
    if product_data.get("variants"):
        variant_count = len(product_data["variants"])
        scores["variants"] = min(0.95, 0.5 + variant_count * 0.05)
    else:
        scores["variants"] = 0.0

    # Materials
    if product_data.get("materials_detail") or product_data.get("materials_structured"):
        has_pct = any(
            m.get("percentage") is not None
            for m in (product_data.get("materials_detail") or product_data.get("materials_structured") or [])
        )
        scores["materials"] = 0.90 if has_pct else 0.60
    elif product_data.get("materials_care"):
        scores["materials"] = 0.40
    else:
        scores["materials"] = 0.0

    # Size fit
    if product_data.get("size_fit"):
        scores["size_fit"] = 0.80
    else:
        scores["size_fit"] = 0.0

    # Fit intelligence (AI-derived)
    if product_data.get("fit_intelligence"):
        scores["fit_intelligence"] = 0.65
    else:
        scores["fit_intelligence"] = 0.0

    # Type/gender
    scores["type"] = 0.85 if product_data.get("type") else 0.0
    scores["gender"] = 0.80 if product_data.get("gender") else 0.0

    # Images
    images = product_data.get("images") or []
    if len(images) >= 3:
        scores["images"] = 0.95
    elif len(images) >= 1:
        scores["images"] = 0.70
    else:
        scores["images"] = 0.0

    return scores


# ─── Shared: brand fit profile update ─────────────────────────────────


def update_brand_profile(brand: str, fit_intelligence: dict, supabase) -> None:
    """Update or create brand-level fit profile from individual product data."""
    if not brand or not fit_intelligence:
        return

    # Fetch existing profile
    existing = (
        supabase.table("brand_fit_profiles")
        .select("*")
        .eq("brand", brand)
        .maybe_single()
        .execute()
    )

    row = existing.data
    sample_count = (row.get("sample_count", 0) if row else 0) + 1

    profile = {
        "brand": brand,
        "fit_bias": fit_intelligence.get("true_to_size", "true_to_size"),
        "silhouette": fit_intelligence.get("fit_type", "regular"),
        "stretch": fit_intelligence.get("stretch_behavior", "medium"),
        "sample_count": sample_count,
        "confidence": min(0.95, 0.3 + sample_count * 0.1),
    }

    if row:
        # Only update if we have enough samples or no existing data
        if sample_count >= 3 or not row.get("fit_bias"):
            supabase.table("brand_fit_profiles").update(profile).eq("brand", brand).execute()
    else:
        supabase.table("brand_fit_profiles").insert(profile).execute()

    print(f"  📊 [{brand}] Brand profile updated (sample #{sample_count})")


# --- Alternate URL finder for bot-protected merchants --------------------


def _query_from_url_and_row(blocked_url: str, row: dict) -> str:
    """Build the best search query for a blocked product.

    Priority: name+brand from the DB row (most precise), then URL slug.
    The slug is the longest hyphen-delimited path segment with pure-numeric
    segments discarded.
    """
    from urllib.parse import urlparse

    name = (row.get("name") or "").strip()
    brand = (row.get("brand") or "").strip()
    if name:
        return f"{brand} {name}".strip()[:120]

    try:
        path = urlparse(blocked_url).path
    except Exception:
        return ""
    segs = []
    for seg in path.split("/"):
        clean = seg.replace("-", " ").replace("_", " ").strip()
        if clean and not clean.replace(" ", "").isdigit():
            segs.append(clean)
    return max(segs, key=len)[:120] if segs else ""


def _find_alternate_url(product_id: str, blocked_url: str, supabase):
    """Find a scrapeable alternate URL for a product whose site blocked us.

    Tries two sources in order:
      1. Google Shopping via product-search edge function (SerpAPI).
      2. Amazon via rainforest-product-lookup edge function.

    Returns the first URL on a different domain that is not a Google URL.
    Returns None if neither source finds anything -- caller marks row failed.
    """
    import os, requests
    from urllib.parse import urlparse

    sb_url = os.environ["SUPABASE_URL"]
    sb_key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

    def _domain(u):
        try:
            return urlparse(u).netloc.replace("www.", "").lower()
        except Exception:
            return ""

    blocked_domain = _domain(blocked_url)
    headers = {
        "Authorization": f"Bearer {sb_key}",
        "apikey": sb_key,
        "Content-Type": "application/json",
    }

    row = {}
    try:
        row = (supabase.table("products").select("name,brand").eq("id", product_id).single().execute().data) or {}
    except Exception:
        pass
    query = _query_from_url_and_row(blocked_url, row)
    if not query:
        return None
    print(f"  🔎 [{product_id}] Searching for alt URL: {query!r}")

    # Pass 1: Google Shopping (SerpAPI)
    try:
        r = requests.post(
            f"{sb_url}/functions/v1/product-search",
            headers=headers, json={"query": query}, timeout=45,
        )
        if r.ok:
            for p in (r.json() or {}).get("products") or []:
                u = (p.get("url") or "").strip()
                d = _domain(u)
                if u and d and d != blocked_domain and "google." not in d:
                    print(f"  🛒 [{product_id}] Google Shopping alt URL: {u}")
                    return u
        else:
            print(f"  ⚠️  [{product_id}] product-search HTTP {r.status_code}: {r.text[:100]}")
    except Exception as e:
        print(f"  ⚠️  [{product_id}] product-search failed: {e}")

    # Pass 2: Amazon via Rainforest
    try:
        r = requests.post(
            f"{sb_url}/functions/v1/rainforest-product-lookup",
            headers=headers, json={"keyword": query, "limit": 5}, timeout=30,
        )
        if r.ok:
            for p in (r.json() or {}).get("products") or []:
                u = (p.get("url") or "").strip()
                d = _domain(u)
                if u and d and d != blocked_domain and "google." not in d:
                    print(f"  📦 [{product_id}] Rainforest/Amazon alt URL: {u}")
                    return u
        else:
            print(f"  ⚠️  [{product_id}] rainforest-lookup HTTP {r.status_code}: {r.text[:100]}")
    except Exception as e:
        print(f"  ⚠️  [{product_id}] rainforest-lookup failed: {e}")

    return None


# ─── Shared: scrape one product and update the DB row ──────────────────


@app.function(
    image=scraper_image,
    secrets=secrets,
    timeout=420,        # 7 min max per product (Playwright + Claude scrape + enrichment pipeline)
    retries=1,          # retry once on transient failures
    max_containers=3,  # max 3 concurrent scrapes to stay within rate limits
)
def scrape_and_update(product_id: str, url: str, is_fallback: bool = False):
    """Scrape a single product URL and write results back to Supabase.

    `is_fallback=True` marks a re-scrape that was queued by the Google
    Shopping block-recovery path. Such runs never trigger the fallback
    again (no loops) and, if the alternate retailer also blocks the deep
    scrape, keep the already-filled Google Shopping data rather than
    flipping the row back to 'failed'.
    """
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

        # Parse materials into structured format (no AI, instant)
        materials_structured = parse_materials(product.get("materials_care"))

        # Snapshot the raw scraped data before any enrichment
        import json as _json
        raw_data = {k: v for k, v in product.items() if k != "images" or v}

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
            # New enrichment columns
            "raw_data": raw_data,
            "variants": product.get("variants"),
            "size_chart": product.get("size_chart"),
            "materials_structured": materials_structured or product.get("materials_detail"),
            "product_taxonomy": product.get("product_category"),
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
            "variants": product.get("variants"),
            "size_chart": product.get("size_chart"),
            "materials_detail": product.get("materials_detail"),
            "materials_structured": materials_structured,
            "images": product.get("images", []),  # needed for confidence scoring
        }

        # Note: quality_score is auto-computed by the trg_products_quality_score trigger

    try:
        run_agent(url, save=False, on_save=_write_to_db)
        print(f"✅ [{product_id}] agent loop complete")

        # ── Post-scrape enrichment pipeline ──────────────────────────────
        if saved_product_data:
            enrichment_update = {}

            # Step 1: Enrich description (existing)
            print(f"🤖 [{product_id}] Enriching description with AI...")
            enriched = enrich_description(saved_product_data)
            if enriched:
                enrichment_update["description"] = enriched
                enrichment_update["description_enriched"] = True
                print(f"✨ [{product_id}] Description enriched")
            else:
                print(f"  ⚠️  [{product_id}] Description enrichment failed, keeping original")

            # Step 2: AI fit intelligence
            print(f"🧠 [{product_id}] Generating fit intelligence...")
            fit_intel = enrich_fit_intelligence(saved_product_data)
            if fit_intel:
                enrichment_update["fit_intelligence"] = fit_intel
                saved_product_data["fit_intelligence"] = fit_intel
                print(f"✅ [{product_id}] Fit intelligence: {fit_intel.get('fit_type', '?')} / {fit_intel.get('true_to_size', '?')}")

            # Step 3: AI taxonomy & styling
            print(f"🏷️  [{product_id}] Generating taxonomy & styling...")
            taxonomy, styling = generate_taxonomy_and_styling(saved_product_data)
            if taxonomy:
                enrichment_update["product_taxonomy"] = taxonomy
                print(f"✅ [{product_id}] Taxonomy: {taxonomy.get('subcategory', '?')} ({taxonomy.get('style', '?')})")
            if styling:
                enrichment_update["styling_metadata"] = styling

            # Step 4: Confidence scores (no AI)
            confidence = compute_confidence_scores(saved_product_data)
            enrichment_update["confidence_scores"] = confidence
            enrichment_update["enrichment_version"] = 1

            # Write all enrichment data in one update
            if enrichment_update:
                supabase.table("products").update(enrichment_update).eq("id", product_id).execute()
                print(f"📦 [{product_id}] Enrichment pipeline complete ({len(enrichment_update)} fields)")

            # Step 5: Update brand fit profile
            brand = saved_product_data.get("brand")
            if brand and fit_intel:
                try:
                    update_brand_profile(brand, fit_intel, supabase)
                except Exception as e:
                    print(f"  ⚠️  [{product_id}] Brand profile update failed: {e}")

            # Step 6: Re-embed with enriched data
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
                    print(f"🔍 [{product_id}] Re-embedded with enriched data")
                else:
                    print(f"  ⚠️  [{product_id}] Re-embed warning: {response.text[:100]}")
            except Exception as e:
                print(f"  ⚠️  [{product_id}] Re-embed error: {e}")

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

        # Automatic alternate-URL fallback for blocked merchants.
        # Only runs on the first scrape attempt (not is_fallback) to avoid loops.
        # We never fill data from search results (quality is unreliable) -- only
        # the URL is used; the re-queued scrape provides the real product data.
        if is_blocked and not is_fallback:
            alt_url = None
            try:
                alt_url = _find_alternate_url(product_id, url, supabase)
            except Exception as fe:
                print(f"  ⚠️  [{product_id}] alt-URL search errored: {fe}")
            if alt_url:
                supabase.table("products").update({
                    "url": alt_url,
                    "scrape_status": "pending",
                    "scrape_error": f"SITE_BLOCKED on original URL; re-scraping alternate: {alt_url}",
                    "scraped_at": datetime.now(timezone.utc).isoformat(),
                }).eq("id", product_id).execute()
                print(f"🛟 [{product_id}] Blocked — re-scraping alternate URL: {alt_url}")
                scrape_and_update.spawn(product_id, alt_url, is_fallback=True)
                return
            # No alternate URL found -- mark as failed with a clear label.
            supabase.table("products").update({
                "scrape_status": "failed",
                "scraped_at": datetime.now(timezone.utc).isoformat(),
                "scrape_error": f"SITE_BLOCKED: {err_msg[:300]} — no scrapeable alternate URL found",
            }).eq("id", product_id).execute()
            print(f"🚫 [{product_id}] Blocked — no alternate URL found, marking failed")
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


# ─── Backfill: re-scrape products missing variant / size-chart data ────

@app.function(
    image=scraper_image,
    secrets=secrets,
    timeout=120,
)
def backfill_size_data(
    limit: int = 50,
    dry_run: bool = True,
    only_brand: str | None = None,
):
    """
    Re-scrape products where variants (size options) are missing.

    These rows were scraped before get_variants / get_size_chart were wired
    into the pipeline. A full re-scrape via scrape_and_update picks up:
      • variants   – all sizes/colors with availability
      • size_chart – garment measurements keyed by size label
      • materials_structured – parsed fiber/pct composition
      • product_taxonomy, styling_metadata, fit_intelligence, confidence_scores

    Only targets scrape_status='done' rows so it doesn't interfere with the
    regular pending/failed cron.

    Concurrency is capped by scrape_and_update.max_containers (3), so a large
    batch just queues rather than spiking Anthropic usage.

    Usage:
        # Dry-run: see the first 50 candidates without spending compute
        modal run modal_app.py::backfill_size_data

        # Actually process 100 products
        modal run modal_app.py::backfill_size_data --limit 100 --no-dry-run

        # Pilot on one brand first
        modal run modal_app.py::backfill_size_data --only-brand "Levi's" --no-dry-run
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
        .is_("variants", "null")
        .not_.is_("url", "null")
        .eq("scrape_status", "done")
    )
    if only_brand:
        q = q.eq("brand", only_brand)

    rows = q.order("created_at", desc=True).limit(limit).execute()
    candidates = rows.data or []

    if not candidates:
        print("No backfill candidates found — all products already have variant data.")
        return {"found": 0, "queued": 0, "dry_run": dry_run}

    print(
        f"Found {len(candidates)} product(s) missing variants "
        f"(limit={limit}, dry_run={dry_run}"
        + (f", only_brand={only_brand!r}" if only_brand else "")
        + "):"
    )
    for r in candidates:
        print(f"  • [{r['id']}] {(r.get('brand') or '?')} — {(r.get('name') or '?')[:60]}")

    if dry_run:
        print("\nDry run — no scrapes spawned. Re-run with --no-dry-run.")
        return {"found": len(candidates), "queued": 0, "dry_run": True}

    for r in candidates:
        scrape_and_update.spawn(r["id"], r["url"])

    print(f"\nSpawned {len(candidates)} re-scrape job(s).")
    return {"found": len(candidates), "queued": len(candidates), "dry_run": False}


# ─── Backfill: AI-only enrichment for products that already have base data ─

@app.function(
    image=scraper_image,
    secrets=secrets,
    timeout=600,
    max_containers=5,
)
def backfill_fit_intelligence(
    limit: int = 100,
    dry_run: bool = True,
    only_brand: str | None = None,
):
    """
    Run the AI enrichment pipeline on products that already have variant /
    size data but are missing fit_intelligence, product_taxonomy, and
    styling_metadata.

    Unlike backfill_size_data this does NOT re-visit any product page with
    Playwright — it only runs the three AI calls (fit_intelligence,
    taxonomy+styling, confidence_scores) using data already in the DB row.
    Much cheaper per product: one Modal container can process ~100 rows.

    Targets: scrape_status='done', variants IS NOT NULL, fit_intelligence IS NULL

    Usage:
        # Dry-run — see candidates
        modal run modal_app.py::backfill_fit_intelligence

        # Process up to 200 products
        modal run modal_app.py::backfill_fit_intelligence --limit 200 --no-dry-run

        # Pilot one brand
        modal run modal_app.py::backfill_fit_intelligence \\
            --only-brand "Nike" --no-dry-run
    """
    import os
    import json
    from supabase import create_client

    supabase = create_client(
        os.environ["SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_ROLE_KEY"],
    )

    q = (
        supabase.table("products")
        .select("id, brand, name, type, gender, price, size_fit, materials_care, variants, size_chart, description")
        .not_.is_("variants", "null")
        .is_("fit_intelligence", "null")
        .eq("scrape_status", "done")
    )
    if only_brand:
        q = q.eq("brand", only_brand)

    rows = q.order("created_at", desc=True).limit(limit).execute()
    candidates = rows.data or []

    if not candidates:
        print("No enrichment candidates found — all products with variants already have fit_intelligence.")
        return {"found": 0, "enriched": 0, "failed": 0, "dry_run": dry_run}

    print(
        f"Found {len(candidates)} product(s) needing AI enrichment "
        f"(limit={limit}, dry_run={dry_run}"
        + (f", only_brand={only_brand!r}" if only_brand else "")
        + "):"
    )
    for r in candidates:
        print(f"  • [{r['id']}] {(r.get('brand') or '?')} — {(r.get('name') or '?')[:60]}")

    if dry_run:
        print("\nDry run — no AI calls made. Re-run with --no-dry-run.")
        return {"found": len(candidates), "enriched": 0, "failed": 0, "dry_run": True}

    enriched = 0
    failed = 0

    for r in candidates:
        product_id = r["id"]
        product_data = {
            "name": r.get("name"),
            "brand": r.get("brand"),
            "type": r.get("type"),
            "gender": r.get("gender"),
            "price": r.get("price"),
            "size_fit": r.get("size_fit"),
            "materials_care": r.get("materials_care"),
            "description": r.get("description"),
            "variants": r.get("variants"),
            "size_chart": r.get("size_chart"),
        }

        try:
            enrichment_update: dict = {}

            # Fit intelligence
            fit_intel = enrich_fit_intelligence(product_data)
            if fit_intel:
                enrichment_update["fit_intelligence"] = fit_intel
                product_data["fit_intelligence"] = fit_intel
                print(f"  ✅ [{product_id}] fit_intelligence: {fit_intel.get('fit_type', '?')} / {fit_intel.get('true_to_size', '?')}")

            # Taxonomy & styling
            taxonomy, styling = generate_taxonomy_and_styling(product_data)
            if taxonomy:
                enrichment_update["product_taxonomy"] = taxonomy
            if styling:
                enrichment_update["styling_metadata"] = styling

            # Confidence scores
            enrichment_update["confidence_scores"] = compute_confidence_scores(product_data)
            enrichment_update["enrichment_version"] = 1

            supabase.table("products").update(enrichment_update).eq("id", product_id).execute()

            # Update brand fit profile
            brand = product_data.get("brand")
            if brand and fit_intel:
                try:
                    update_brand_profile(brand, fit_intel, supabase)
                except Exception as e:
                    print(f"  ⚠️  [{product_id}] brand profile error: {e}")

            enriched += 1

        except Exception as e:
            print(f"  ❌ [{product_id}] {e}")
            failed += 1

    print(f"\nDone: {enriched} enriched, {failed} failed.")
    return {"found": len(candidates), "enriched": enriched, "failed": failed, "dry_run": False}
