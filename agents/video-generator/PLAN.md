# Video Generator Agent — Development Plan

> Generate 4–8s AI fashion videos from scraped products using Veo 3.1 (Gemini API).
> Videos are stored in Supabase and automatically become **looks** linked to their source product.

---

## Overview

**Flow:**
```
Product scraped (status=done)
  → Download best product image
  → Gemini Flash refines product data into a cinematic Veo prompt
  → Veo 3.1 generates video (image-to-video, 4s, 9:16, 720p)
  → Video uploaded to Supabase look-media/generated/
  → look + look_videos + look_products records created (status=in_review)
  → generated_videos row marked done
```

**Stack:**
- **Veo 3.1** via Gemini API (AI Studio key, `veo-3.1-fast-generate-preview`)
- **Gemini 3 Flash** for prompt enhancement
- **Modal** for deployment (same pattern as product-scraper)
- **Supabase** for DB + Storage
- **google-genai** Python SDK

---

## Phase 1 — Database Schema

### New table: `generated_videos`

```sql
-- supabase/migrations/0XX_generated_videos.sql

create table generated_videos (
  id               uuid primary key default gen_random_uuid(),
  product_id       uuid not null references products(id) on delete cascade,
  style            text not null,                          -- editorial_runway | street_style | studio_clean | lifestyle_context
  model_persona    text,                                   -- feminine_editorial | masculine_street | androgynous_minimal
  prompt           text,                                   -- full Veo prompt used
  veo_model        text default 'veo-3.1-fast-generate-preview',
  status           text not null default 'pending'         -- pending | generating | uploading | done | failed
                     check (status in ('pending','generating','uploading','done','failed')),
  veo_operation_id text,                                   -- async operation ID for polling
  video_url        text,                                   -- final Supabase public URL
  storage_path     text,                                   -- Supabase storage path
  look_id          uuid references looks(id),              -- set after look creation
  duration_seconds numeric default 4,
  aspect_ratio     text default '9:16',
  resolution       text default '720p',
  cost_usd         numeric,                                -- $0.05–$0.10 per video (fast tier)
  error            text,
  created_at       timestamptz default now(),
  completed_at     timestamptz
);

create index idx_generated_videos_status on generated_videos(status);
create index idx_generated_videos_product_style on generated_videos(product_id, style);
```

No changes to existing tables — `looks`, `look_videos`, and `look_products` already support everything needed.

---

## Phase 2 — Prompt Engineering

### `agents/video-generator/config.py`

Styles and personas as typed dicts:

```python
STYLES = {
    "editorial_runway": {
        "prompt_template": "High fashion editorial, {product_desc}. A {persona} walks toward the camera on a dramatic runway. Slow-motion fabric movement, volumetric lighting, shallow depth of field. Editorial photography style.",
        "aspect_ratio": "9:16",
        "duration": 4,
    },
    "street_style": {
        "prompt_template": "Urban street style, {product_desc}. {persona} moving confidently through a city environment. Natural daylight, candid movement, street photography aesthetic.",
        "aspect_ratio": "9:16",
        "duration": 4,
    },
    "studio_clean": {
        "prompt_template": "Commercial product showcase, {product_desc}. Clean white studio background, soft even lighting. Camera slowly orbits the product. Minimalist commercial photography style.",
        "aspect_ratio": "9:16",
        "duration": 4,
    },
    "lifestyle_context": {
        "prompt_template": "Lifestyle editorial, {product_desc}. {persona} in a real-world setting, product in natural use context. Warm ambient lighting, golden hour, lifestyle editorial aesthetic.",
        "aspect_ratio": "9:16",
        "duration": 4,
    },
}

PERSONAS = {
    "feminine_editorial": "a professional female model with elegant posture",
    "masculine_street":   "a male model with a confident, relaxed demeanor",
    "androgynous_minimal": "a model with an androgynous, minimalist look",
}

GENERATION_DEFAULTS = {
    "model":             "veo-3.1-fast-generate-preview",
    "duration":          4,       # seconds — minimum for Veo 3.1 Fast
    "aspect_ratio":      "9:16",  # portrait, mobile-first
    "resolution":        "720p",
    "person_generation": "allow_adult",  # required for image-to-video with people
}

DEFAULT_STYLE   = "editorial_runway"
DEFAULT_PERSONA = "feminine_editorial"
```

### `agents/video-generator/prompts.py`

```python
import os
import google.genai as genai
from config import STYLES, PERSONAS

def build_prompt(product: dict, style: str, persona: str) -> str:
    """Build a Veo prompt from product data + style/persona config."""
    style_cfg   = STYLES[style]
    persona_str = PERSONAS.get(persona, "")

    product_desc = _summarise_product(product)

    return style_cfg["prompt_template"].format(
        product_desc=product_desc,
        persona=persona_str,
    )

def enhance_prompt_with_gemini(raw_prompt: str, product: dict) -> str:
    """Use Gemini Flash to refine the prompt into cinematic Veo language.
    
    Cost: ~$0.0005 per call (negligible). Improves video quality.
    """
    client = genai.Client(api_key=os.environ["GOOGLE_API_KEY"])
    response = client.models.generate_content(
        model="gemini-2.5-flash",
        contents=(
            f"Rewrite this video generation prompt to be more cinematic and specific for Veo AI. "
            f"Keep it under 200 words. Focus on: subject, action, style, camera motion, lighting, ambiance.\n\n"
            f"Product: {product.get('name')} by {product.get('brand')}\n"
            f"Original prompt: {raw_prompt}"
        ),
    )
    return response.text.strip()

def _summarise_product(product: dict) -> str:
    parts = []
    if product.get("name"):
        parts.append(product["name"])
    if product.get("brand"):
        parts.append(f"by {product['brand']}")
    if product.get("description"):
        parts.append(f"— {product['description'][:150]}")
    return " ".join(parts)
```

---

## Phase 3 — Core Agent

### `agents/video-generator/veo_client.py`

```python
import os
import time
import httpx
import google.genai as genai
import google.genai.types as types

MAX_POLL_SECONDS = 420   # 7 minutes (Veo latency: 11s–6min)
POLL_INTERVAL    = 10    # seconds between status checks

def generate_video_from_image(
    image_bytes: bytes,
    image_mime: str,
    prompt: str,
    *,
    model: str = "veo-3.1-fast-generate-preview",
    duration: int = 4,
    aspect_ratio: str = "9:16",
    resolution: str = "720p",
    person_generation: str = "allow_adult",
) -> bytes:
    """Submit image-to-video job, poll until done, return video bytes."""
    client = genai.Client(api_key=os.environ["GOOGLE_API_KEY"])

    operation = client.models.generate_videos(
        model=model,
        prompt=prompt,
        image=types.Image(image_bytes=image_bytes, mime_type=image_mime),
        config=types.GenerateVideosConfig(
            duration_seconds=duration,
            aspect_ratio=aspect_ratio,
            resolution=resolution,
            person_generation=person_generation,
            number_of_videos=1,
        ),
    )

    # Poll for completion
    start = time.time()
    while not operation.done:
        if time.time() - start > MAX_POLL_SECONDS:
            raise TimeoutError(f"Veo job timed out after {MAX_POLL_SECONDS}s")
        time.sleep(POLL_INTERVAL)
        operation = client.operations.get(operation)

    video = operation.response.generated_videos[0].video
    return httpx.get(video.uri).content


def generate_video_from_text(
    prompt: str,
    *,
    model: str = "veo-3.1-fast-generate-preview",
    duration: int = 4,
    aspect_ratio: str = "9:16",
) -> bytes:
    """Text-only fallback — no reference image."""
    client = genai.Client(api_key=os.environ["GOOGLE_API_KEY"])

    operation = client.models.generate_videos(
        model=model,
        prompt=prompt,
        config=types.GenerateVideosConfig(
            duration_seconds=duration,
            aspect_ratio=aspect_ratio,
            number_of_videos=1,
        ),
    )

    start = time.time()
    while not operation.done:
        if time.time() - start > MAX_POLL_SECONDS:
            raise TimeoutError(f"Veo job timed out after {MAX_POLL_SECONDS}s")
        time.sleep(POLL_INTERVAL)
        operation = client.operations.get(operation)

    video = operation.response.generated_videos[0].video
    return httpx.get(video.uri).content
```

### `agents/video-generator/agent.py`

```python
import os
import time
import httpx
from datetime import datetime, timezone
from supabase import create_client

from config import STYLES, PERSONAS, GENERATION_DEFAULTS, DEFAULT_STYLE, DEFAULT_PERSONA
from prompts import build_prompt, enhance_prompt_with_gemini
from veo_client import generate_video_from_image, generate_video_from_text


def generate_video(
    product_id: str,
    style: str = DEFAULT_STYLE,
    persona: str = DEFAULT_PERSONA,
    enhance_prompt: bool = True,
) -> dict:
    """
    Full pipeline: fetch product → build prompt → generate video → upload →
    create look → return result.
    """
    supabase = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])
    style_cfg = STYLES[style]

    # 1 — Fetch product
    row = supabase.table("products").select("*").eq("id", product_id).single().execute()
    product = row.data
    if not product:
        raise ValueError(f"Product {product_id} not found")
    if not product.get("images"):
        raise ValueError(f"Product {product_id} has no images — scrape it first")

    # 2 — Insert generated_videos job row (pending)
    job = supabase.table("generated_videos").insert({
        "product_id":    product_id,
        "style":         style,
        "model_persona": persona,
        "veo_model":     GENERATION_DEFAULTS["model"],
        "status":        "pending",
        "duration_seconds": style_cfg["duration"],
        "aspect_ratio":  style_cfg["aspect_ratio"],
        "resolution":    GENERATION_DEFAULTS["resolution"],
    }).execute().data[0]
    job_id = job["id"]

    try:
        # 3 — Build prompt
        raw_prompt = build_prompt(product, style, persona)
        prompt = enhance_prompt_with_gemini(raw_prompt, product) if enhance_prompt else raw_prompt

        supabase.table("generated_videos").update({
            "status": "generating",
            "prompt": prompt,
        }).eq("id", job_id).execute()

        # 4 — Download best product image
        image_url  = product["images"][0]
        img_resp   = httpx.get(image_url, timeout=30, follow_redirects=True)
        img_resp.raise_for_status()
        image_bytes = img_resp.content
        mime_type   = img_resp.headers.get("content-type", "image/jpeg").split(";")[0]

        # 5 — Generate video via Veo
        print(f"  🎬 Generating video [{style}] for product: {product['name']}")
        video_bytes = generate_video_from_image(
            image_bytes=image_bytes,
            image_mime=mime_type,
            prompt=prompt,
            model=GENERATION_DEFAULTS["model"],
            duration=style_cfg["duration"],
            aspect_ratio=style_cfg["aspect_ratio"],
            resolution=GENERATION_DEFAULTS["resolution"],
            person_generation=GENERATION_DEFAULTS["person_generation"],
        )

        supabase.table("generated_videos").update({"status": "uploading"}).eq("id", job_id).execute()

        # 6 — Upload to Supabase Storage
        ts           = int(datetime.now(timezone.utc).timestamp())
        storage_path = f"generated/{product_id}/{style}_{ts}.mp4"
        supabase.storage.from_("look-media").upload(
            storage_path, video_bytes, {"content-type": "video/mp4"}
        )
        video_url = supabase.storage.from_("look-media").get_public_url(storage_path)

        # 7 — Create look record
        look = supabase.table("looks").insert({
            "title":       f"{product['name']} — {style.replace('_', ' ').title()}",
            "description": product.get("description"),
            "status":      "in_review",   # admin approves before going live
            "enabled":     False,
        }).execute().data[0]
        look_id = look["id"]

        # 8 — Create look_videos entry
        supabase.table("look_videos").insert({
            "look_id":          look_id,
            "order_index":      0,
            "storage_path":     storage_path,
            "url":              video_url,
            "duration_seconds": style_cfg["duration"],
        }).execute()

        # 9 — Link product to look
        supabase.table("look_products").insert({
            "look_id":    look_id,
            "product_id": product_id,
            "sort_order": 0,
        }).execute()

        # 10 — Mark job done
        cost = _estimate_cost(GENERATION_DEFAULTS["model"], GENERATION_DEFAULTS["resolution"])
        supabase.table("generated_videos").update({
            "status":       "done",
            "video_url":    video_url,
            "storage_path": storage_path,
            "look_id":      look_id,
            "cost_usd":     cost,
            "completed_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", job_id).execute()

        print(f"  ✅ Done — look {look_id} | {video_url}")
        return {"success": True, "look_id": look_id, "video_url": video_url, "job_id": job_id}

    except Exception as e:
        supabase.table("generated_videos").update({
            "status":       "failed",
            "error":        str(e)[:500],
            "completed_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", job_id).execute()
        print(f"  ❌ Failed: {e}")
        raise


def _estimate_cost(model: str, resolution: str) -> float:
    """Rough cost estimate per video in USD."""
    pricing = {
        "veo-3.1-fast-generate-preview":     {"720p": 0.10, "1080p": 0.12},
        "veo-3.1-generate-preview":          {"720p": 0.40, "1080p": 0.40},
        "veo-3.1-lite-generate-preview":     {"720p": 0.05, "1080p": 0.08},
    }
    return pricing.get(model, {}).get(resolution, 0.10)
```

---

## Phase 4 — Modal Deployment

### `agents/video-generator/modal_app.py`

Three entry points — same pattern as product-scraper:

| Entry point | Trigger | Purpose |
|---|---|---|
| `generate_webhook` | POST — Supabase DB webhook on `products` UPDATE (`scrape_status` → `done`) | Auto-generate default style for newly scraped products |
| `generate_pending` | Cron every 30 min | Retry failed/pending jobs, catch products with no videos |
| `generate_for_product` | Manual / batch | Generate specific style+persona combos |

**Secrets (Modal):**
```bash
modal secret create video-generator-secrets \
  GOOGLE_API_KEY=... \
  SUPABASE_URL=... \
  SUPABASE_SERVICE_ROLE_KEY=...
```

**Modal image:**
```python
generator_image = (
    modal.Image.debian_slim(python_version="3.12")
    .pip_install(
        "google-genai>=1.0.0",
        "supabase>=2.10.0",
        "httpx>=0.27.0",
        "python-dotenv>=1.0.0",
        "fastapi[standard]>=0.115.0",
    )
)
```

**Concurrency:** `max_containers=3` — Veo jobs are slow (up to 6 min each), 3 parallel keeps costs predictable.

### `agents/video-generator/run_batch.py`

```bash
# Generate one product, specific style
python run_batch.py --product-id <uuid> --style editorial_runway --persona feminine_editorial

# Generate for all products missing videos (default style)
python run_batch.py --all-products

# Generate multiple styles for a brand
python run_batch.py --brand "Wolfs Collections" --styles editorial_runway,street_style

# Dry run — list products that would be processed
python run_batch.py --all-products --dry-run
```

---

## Phase 5 — Admin UI (follow-up)

### `app/routes/admin/video-generation.tsx`

- Table of `generated_videos` rows with status badges, product name, style, cost, preview player
- **Generate Video** button → opens modal with style + persona selectors → calls webhook
- Inline `<video>` preview for completed jobs
- Approve/deny look buttons (sets `looks.status = 'live'` or `'denied'`)
- Filter by status, product, brand

### Product page enhancement (`app/routes/admin/products.tsx`)

- Add **Generate Video** action to each product row
- Show status pill (No Video / Pending / Done) based on `generated_videos` rows

---

## File Checklist

```
agents/video-generator/
├── config.py           ← styles, personas, defaults
├── prompts.py          ← prompt builder + Gemini Flash enhancer
├── veo_client.py       ← Veo API wrapper with async polling
├── agent.py            ← full pipeline: fetch → generate → upload → look
├── modal_app.py        ← webhook + cron + batch Modal deployment
├── run_batch.py        ← CLI batch runner
├── test_agent.py       ← local test against real Supabase product
├── requirements.txt
└── .env.example

supabase/migrations/
└── 0XX_generated_videos.sql

app/routes/admin/
└── video-generation.tsx   (Phase 5)
```

---

## Key Decisions

| Decision | Choice | Reason |
|---|---|---|
| Veo model | `veo-3.1-fast-generate-preview` | $0.10/video (720p) — good quality, low cost |
| Duration | 4 seconds | Shortest Veo 3.1 Fast allows; ideal for fashion content |
| Aspect ratio | `9:16` portrait | Mobile-first, matches feed cards |
| Input mode | Image-to-video (product image as reference) | Product image grounds the visual output |
| Person generation | `allow_adult` | Required for image-to-video with people |
| Prompt enhancement | Gemini 3 Flash | ~$0.0005/call, meaningfully improves video quality |
| Look status on creation | `in_review` | Admin approves before going live |
| Auto-trigger | 1 default style on scrape completion | Keeps costs predictable; multi-style via manual batch |
| Storage path | `look-media/generated/{product_id}/{style}_{ts}.mp4` | Separated from user uploads |

---

## Cost Reference

| Model | 720p | 1080p |
|---|---|---|
| `veo-3.1-lite-generate-preview` | $0.05 | $0.08 |
| `veo-3.1-fast-generate-preview` ✅ | $0.10 | $0.12 |
| `veo-3.1-generate-preview` | $0.40 | $0.40 |

At $0.10/video: 100 products × 1 style = **$10**. 100 products × 4 styles = **$40**.

---

## Verification Checklist

- [ ] `python test_agent.py` — end-to-end test with a real Supabase product
- [ ] Video accessible via Supabase Storage public URL and plays in browser
- [ ] `look`, `look_videos`, `look_products` records created correctly
- [ ] `generated_videos` row has correct status, cost, storage_path, look_id
- [ ] `modal serve modal_app.py` — test webhook with curl
- [ ] Error path: product with no images → `status=failed` with clear error message
- [ ] Cost logged correctly per generation
