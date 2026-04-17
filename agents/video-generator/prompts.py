"""
Prompt engineering for Veo video generation.

Builds and enhances prompts using product data, style configs,
and AI model persona information.
"""

import os
import google.genai as genai

from config import STYLES, PERSONAS, GENDER_PERSONA_MAP


def build_prompt(product: dict, style: str, persona: str, ai_model: dict | None = None) -> str:
    """Build a Veo prompt from product data + style/persona config.

    If an ai_model dict is provided, uses its persona_prompt and gender
    to override the default persona string.
    """
    style_cfg = STYLES[style]

    # Determine persona description
    if ai_model and ai_model.get("persona_prompt"):
        persona_str = ai_model["persona_prompt"]
    elif ai_model and ai_model.get("gender"):
        persona_key = GENDER_PERSONA_MAP.get(ai_model["gender"], "feminine_editorial")
        persona_str = PERSONAS.get(persona_key, PERSONAS.get(persona, ""))
    else:
        persona_str = PERSONAS.get(persona, "")

    product_desc = _summarise_product(product)

    return style_cfg["prompt_template"].format(
        product_desc=product_desc,
        persona=persona_str,
    )


def enhance_prompt_with_gemini(raw_prompt: str, product: dict, ai_model: dict | None = None) -> str:
    """Use Gemini Flash to refine the prompt into cinematic Veo language.

    Cost: ~$0.0005 per call (negligible). Improves video quality significantly.
    """
    client = genai.Client(api_key=os.environ["GOOGLE_API_KEY"])

    model_context = ""
    if ai_model:
        model_context = (
            f"\nModel: {ai_model.get('name', 'Unknown')} "
            f"({ai_model.get('gender', 'unknown')}, {ai_model.get('age_range', 'unknown')})"
        )
        if ai_model.get("persona_prompt"):
            model_context += f"\nModel persona: {ai_model['persona_prompt']}"

    response = client.models.generate_content(
        model="gemini-2.5-flash",
        contents=(
            f"Rewrite this video generation prompt to be more cinematic and specific for Veo AI. "
            f"Keep it under 200 words. Focus on: subject, action, style, camera motion, lighting, ambiance.\n\n"
            f"Product: {product.get('name')} by {product.get('brand')}\n"
            f"{model_context}\n"
            f"Original prompt: {raw_prompt}"
        ),
    )
    return response.text.strip()


def _summarise_product(product: dict) -> str:
    """Create a brief description of the product for prompt insertion."""
    parts = []
    if product.get("name"):
        parts.append(product["name"])
    if product.get("brand"):
        parts.append(f"by {product['brand']}")
    if product.get("description"):
        parts.append(f"— {product['description'][:150]}")
    return " ".join(parts)
