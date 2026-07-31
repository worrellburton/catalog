"""
Configuration for AI video generation.

Styles, personas, and generation defaults for Veo 3.1 video creation.
"""

# ─── Video Styles ──────────────────────────────────────────────────────

STYLES = {
    "editorial_runway": {
        "prompt_template": (
            "High fashion editorial, {product_desc}. A {persona} walks toward the camera "
            "on a dramatic runway. Slow-motion fabric movement, volumetric lighting, "
            "shallow depth of field. Editorial photography style."
        ),
        "aspect_ratio": "9:16",
        "duration": 4,
    },
    "street_style": {
        "prompt_template": (
            "Urban street style, {product_desc}. {persona} moving confidently through "
            "a city environment. Natural daylight, candid movement, street photography aesthetic."
        ),
        "aspect_ratio": "9:16",
        "duration": 4,
    },
    "studio_clean": {
        "prompt_template": (
            "Commercial product showcase, {product_desc}. Clean white studio background, "
            "soft even lighting. Camera slowly orbits the product. Minimalist commercial "
            "photography style."
        ),
        "aspect_ratio": "9:16",
        "duration": 4,
    },
    "lifestyle_context": {
        "prompt_template": (
            "Lifestyle editorial, {product_desc}. {persona} in a real-world setting, "
            "product in natural use context. Warm ambient lighting, golden hour, "
            "lifestyle editorial aesthetic."
        ),
        "aspect_ratio": "9:16",
        "duration": 4,
    },
}

# ─── Default Personas (fallback when no AI model is specified) ─────────

PERSONAS = {
    "feminine_editorial": "a professional female model with elegant posture",
    "masculine_street": "a male model with a confident, relaxed demeanor",
    "androgynous_minimal": "a model with an androgynous, minimalist look",
}

# ─── Gender → Default Persona Mapping ─────────────────────────────────

GENDER_PERSONA_MAP = {
    "female": "feminine_editorial",
    "male": "masculine_street",
    "non_binary": "androgynous_minimal",
}

# ─── Generation Defaults ──────────────────────────────────────────────

GENERATION_DEFAULTS = {
    # fal-only. Was "veo-3.1-fast-generate-preview" (Google Veo); retired so a
    # bad/absent GOOGLE_API_KEY can't break renders. Seedance-2 runs on fal.ai
    # (needs only FAL_KEY) and matches the app's look_video_model standard; the
    # client maps it to bytedance/seedance-2.0/{image,text}-to-video.
    "model": "seedance-2",
    "duration": 5,            # seconds — Seedance range is 2–12s
    "aspect_ratio": "9:16",   # portrait; cropped to 3:4 for the feed afterwards
    "resolution": "720p",
    "person_generation": "allow_adult",  # Veo-only param; unused by fal, kept for the retired path
}

# Feed card aspect ratio — videos are cropped to this after generation
FEED_ASPECT_RATIO = (3, 4)   # width:height — matches .look-card { aspect-ratio: 3/4 }

DEFAULT_STYLE = "editorial_runway"
DEFAULT_PERSONA = "feminine_editorial"
