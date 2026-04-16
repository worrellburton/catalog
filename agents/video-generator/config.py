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
    "model": "veo-3.1-fast-generate-preview",
    "duration": 4,            # seconds — minimum for Veo 3.1 Fast
    "aspect_ratio": "9:16",   # portrait, mobile-first
    "resolution": "720p",
    "person_generation": "allow_adult",  # required for image-to-video with people
}

DEFAULT_STYLE = "editorial_runway"
DEFAULT_PERSONA = "feminine_editorial"
