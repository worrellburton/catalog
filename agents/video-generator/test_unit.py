#!/usr/bin/env python3
"""
Unit tests for the video generator agent (mocked — no live API calls).

Run:
    cd agents/video-generator
    pip install -r requirements.txt && pip install pytest pytest-json-report
    python -m pytest test_unit.py -v --tb=short --json-report --json-report-file=test_results.json
"""

import os
import json
import pytest
from unittest.mock import MagicMock, patch

from dotenv import load_dotenv
load_dotenv()

# Set a dummy GOOGLE_API_KEY if not present (tests use mocks, not real API)
os.environ.setdefault("GOOGLE_API_KEY", "test-dummy-key")
os.environ.setdefault("SUPABASE_URL", "https://dummy.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "dummy-key")


# ─── Fixtures ─────────────────────────────────────────────────────────

SAMPLE_PRODUCT = {
    "id": "prod-001",
    "name": "Nike Air Force 1 '07",
    "brand": "Nike",
    "price": "$110",
    "description": "The radiance lives on in the Nike Air Force 1.",
    "images": [
        "https://static.nike.com/af1-front.jpg",
        "https://static.nike.com/af1-side.jpg",
    ],
    "image_url": "https://static.nike.com/af1-front.jpg",
    "url": "https://nike.com/af1",
}

SAMPLE_AI_MODEL = {
    "id": "model-001",
    "name": "Aria Rose",
    "slug": "aria-rose",
    "gender": "female",
    "age_range": "18-25",
    "persona_prompt": "a young professional female model with elegant runway posture and confident gaze",
    "default_style": "editorial_runway",
    "style_presets": ["editorial_runway", "street_style"],
    "primary_image": "https://storage.example.com/aria-front.jpg",
    "face_images": ["https://storage.example.com/aria-front.jpg"],
    "status": "active",
    "enabled": True,
    "creators": {"handle": "aria-rose"},
}

SAMPLE_AI_MODEL_NO_PERSONA = {
    "id": "model-002",
    "name": "Marcus Cole",
    "slug": "marcus-cole",
    "gender": "male",
    "age_range": "26-35",
    "persona_prompt": None,
    "default_style": "street_style",
    "style_presets": ["street_style", "lifestyle_context"],
    "primary_image": None,
    "face_images": [],
    "status": "active",
    "enabled": True,
    "creators": {"handle": "marcus-cole"},
}

FAKE_VIDEO_BYTES = b"\x00\x00\x00\x1cftypisom" + b"\x00" * 100


# ═══════════════════════════════════════════════════════════════════════
# Config Tests
# ═══════════════════════════════════════════════════════════════════════

class TestConfig:
    def test_styles_have_required_keys(self):
        from config import STYLES
        for name, style in STYLES.items():
            assert "prompt_template" in style, f"{name} missing prompt_template"
            assert "aspect_ratio" in style, f"{name} missing aspect_ratio"
            assert "duration" in style, f"{name} missing duration"

    def test_all_styles_have_product_placeholder(self):
        from config import STYLES
        for name, style in STYLES.items():
            assert "{product_desc}" in style["prompt_template"], f"{name} missing {{product_desc}}"

    def test_personas_are_non_empty_strings(self):
        from config import PERSONAS
        assert len(PERSONAS) >= 2
        for key, val in PERSONAS.items():
            assert isinstance(val, str) and len(val) > 10

    def test_gender_persona_map_valid(self):
        from config import GENDER_PERSONA_MAP, PERSONAS
        for gender, persona_key in GENDER_PERSONA_MAP.items():
            assert persona_key in PERSONAS

    def test_generation_defaults(self):
        from config import GENERATION_DEFAULTS
        assert GENERATION_DEFAULTS["model"].startswith("veo-")
        assert GENERATION_DEFAULTS["duration"] >= 4
        assert GENERATION_DEFAULTS["aspect_ratio"] in ("9:16", "16:9", "1:1")
        assert GENERATION_DEFAULTS["person_generation"] == "allow_adult"

    def test_default_style_exists_in_styles(self):
        from config import STYLES, DEFAULT_STYLE
        assert DEFAULT_STYLE in STYLES

    def test_default_persona_exists_in_personas(self):
        from config import PERSONAS, DEFAULT_PERSONA
        assert DEFAULT_PERSONA in PERSONAS


# ═══════════════════════════════════════════════════════════════════════
# Prompt Tests
# ═══════════════════════════════════════════════════════════════════════

class TestSummariseProduct:
    def test_basic_summary(self):
        from prompts import _summarise_product
        result = _summarise_product(SAMPLE_PRODUCT)
        assert "Nike Air Force 1" in result
        assert "Nike" in result

    def test_truncates_long_description(self):
        from prompts import _summarise_product
        p = {**SAMPLE_PRODUCT, "description": "A" * 300}
        result = _summarise_product(p)
        assert len(result) < 350

    def test_handles_empty_product(self):
        from prompts import _summarise_product
        result = _summarise_product({})
        assert isinstance(result, str)


class TestBuildPrompt:
    def test_editorial_runway(self):
        from prompts import build_prompt
        prompt = build_prompt(SAMPLE_PRODUCT, "editorial_runway", "feminine_editorial")
        assert "Nike Air Force 1" in prompt or "Nike" in prompt
        assert isinstance(prompt, str) and len(prompt) > 30

    def test_street_style(self):
        from prompts import build_prompt
        prompt = build_prompt(SAMPLE_PRODUCT, "street_style", "masculine_street")
        assert isinstance(prompt, str) and len(prompt) > 30

    def test_studio_clean(self):
        from prompts import build_prompt
        prompt = build_prompt(SAMPLE_PRODUCT, "studio_clean", "feminine_editorial")
        assert isinstance(prompt, str) and len(prompt) > 30

    def test_lifestyle_context(self):
        from prompts import build_prompt
        prompt = build_prompt(SAMPLE_PRODUCT, "lifestyle_context", "androgynous_minimal")
        assert isinstance(prompt, str) and len(prompt) > 30

    def test_with_ai_model_persona(self):
        from prompts import build_prompt
        prompt = build_prompt(SAMPLE_PRODUCT, "editorial_runway", "feminine_editorial", ai_model=SAMPLE_AI_MODEL)
        # AI model has persona_prompt — it should take priority
        assert "confident gaze" in prompt or "runway posture" in prompt

    def test_ai_model_without_persona_falls_back(self):
        from prompts import build_prompt
        prompt = build_prompt(SAMPLE_PRODUCT, "street_style", "masculine_street", ai_model=SAMPLE_AI_MODEL_NO_PERSONA)
        # Falls back to PERSONAS["masculine_street"]
        assert isinstance(prompt, str) and len(prompt) > 30

    def test_unknown_style_raises_error(self):
        from prompts import build_prompt
        with pytest.raises(KeyError):
            build_prompt(SAMPLE_PRODUCT, "nonexistent_style_xyz", "feminine_editorial")

    def test_all_style_persona_combinations(self):
        from config import STYLES, PERSONAS
        from prompts import build_prompt
        for style_name in STYLES:
            for persona_name in PERSONAS:
                prompt = build_prompt(SAMPLE_PRODUCT, style_name, persona_name)
                assert isinstance(prompt, str) and len(prompt) > 30


class TestEnhancePrompt:
    @patch("prompts.genai")
    def test_calls_gemini(self, mock_genai):
        from prompts import enhance_prompt_with_gemini
        mock_client = MagicMock()
        mock_genai.Client.return_value = mock_client
        mock_client.models.generate_content.return_value = MagicMock(text="Enhanced cinematic prompt")

        result = enhance_prompt_with_gemini("raw prompt", SAMPLE_PRODUCT)
        assert result == "Enhanced cinematic prompt"
        mock_client.models.generate_content.assert_called_once()

    @patch("prompts.genai")
    def test_includes_ai_model_context(self, mock_genai):
        from prompts import enhance_prompt_with_gemini
        mock_client = MagicMock()
        mock_genai.Client.return_value = mock_client
        mock_client.models.generate_content.return_value = MagicMock(text="Enhanced with model")

        result = enhance_prompt_with_gemini("raw prompt", SAMPLE_PRODUCT, ai_model=SAMPLE_AI_MODEL)
        assert result == "Enhanced with model"
        call_args = mock_client.models.generate_content.call_args
        # The contents arg should mention the model name
        contents_str = str(call_args)
        assert "Aria Rose" in contents_str


# ═══════════════════════════════════════════════════════════════════════
# Veo Client Tests
# ═══════════════════════════════════════════════════════════════════════

class TestVeoClient:
    @patch("veo_client.httpx")
    @patch("veo_client.genai")
    def test_generate_from_image_returns_bytes(self, mock_genai, mock_httpx):
        from veo_client import generate_video_from_image

        mock_client = MagicMock()
        mock_genai.Client.return_value = mock_client
        mock_video = MagicMock(uri="https://veo.google.com/v/abc.mp4")
        mock_op = MagicMock(done=True)
        mock_op.response.generated_videos = [MagicMock(video=mock_video)]
        mock_client.models.generate_videos.return_value = mock_op
        mock_httpx.get.return_value = MagicMock(content=FAKE_VIDEO_BYTES)

        result = generate_video_from_image(b"image", "image/jpeg", "prompt")
        assert result == FAKE_VIDEO_BYTES
        mock_client.models.generate_videos.assert_called_once()

    @patch("veo_client.httpx")
    @patch("veo_client.genai")
    def test_generate_from_text_returns_bytes(self, mock_genai, mock_httpx):
        from veo_client import generate_video_from_text

        mock_client = MagicMock()
        mock_genai.Client.return_value = mock_client
        mock_video = MagicMock(uri="https://veo.google.com/v/def.mp4")
        mock_op = MagicMock(done=True)
        mock_op.response.generated_videos = [MagicMock(video=mock_video)]
        mock_client.models.generate_videos.return_value = mock_op
        mock_httpx.get.return_value = MagicMock(content=FAKE_VIDEO_BYTES)

        result = generate_video_from_text("prompt")
        assert result == FAKE_VIDEO_BYTES

    @patch("veo_client.time")
    @patch("veo_client.genai")
    def test_polls_until_done(self, mock_genai, mock_time):
        from veo_client import generate_video_from_text

        mock_client = MagicMock()
        mock_genai.Client.return_value = mock_client
        mock_time.time.side_effect = [0, 10, 20, 30]
        mock_time.sleep = MagicMock()

        mock_video = MagicMock(uri="https://veo.google.com/v/poll.mp4")
        mock_op_pending = MagicMock(done=False)
        mock_op_done = MagicMock(done=True)
        mock_op_done.response.generated_videos = [MagicMock(video=mock_video)]

        mock_client.models.generate_videos.return_value = mock_op_pending
        mock_client.operations.get.side_effect = [mock_op_pending, mock_op_done]

        with patch("veo_client.httpx") as mock_httpx:
            mock_httpx.get.return_value = MagicMock(content=FAKE_VIDEO_BYTES)
            result = generate_video_from_text("poll test")

        assert result == FAKE_VIDEO_BYTES
        assert mock_client.operations.get.call_count == 2

    @patch("veo_client.time")
    @patch("veo_client.genai")
    def test_timeout_raises(self, mock_genai, mock_time):
        from veo_client import generate_video_from_text, MAX_POLL_SECONDS

        mock_client = MagicMock()
        mock_genai.Client.return_value = mock_client
        mock_time.time.side_effect = [0, MAX_POLL_SECONDS + 1]
        mock_time.sleep = MagicMock()

        mock_op = MagicMock(done=False)
        mock_client.models.generate_videos.return_value = mock_op

        with pytest.raises(TimeoutError):
            generate_video_from_text("timeout test")


# ═══════════════════════════════════════════════════════════════════════
# Agent Pipeline Tests (mocked Supabase + Veo)
# ═══════════════════════════════════════════════════════════════════════

class TestAgentPipeline:
    def _mock_supabase(self):
        """Build a mock Supabase client that supports chained query builders."""
        mock = MagicMock()

        def table(name):
            tbl = MagicMock()

            def select(*args, **kwargs):
                q = MagicMock()

                def eq(col, val):
                    eq_q = MagicMock()

                    def single():
                        s = MagicMock()
                        if name == "products":
                            s.execute.return_value = MagicMock(data=SAMPLE_PRODUCT)
                        elif name == "ai_models":
                            s.execute.return_value = MagicMock(data=SAMPLE_AI_MODEL)
                        elif name == "looks":
                            s.execute.return_value = MagicMock(data={"id": "look-001", "status": "in_review"})
                        elif name == "generated_videos":
                            s.execute.return_value = MagicMock(data={"id": "job-001", "status": "done"})
                        return s

                    eq_q.single = single
                    eq_q.execute = MagicMock(return_value=MagicMock(data=[SAMPLE_AI_MODEL]))
                    eq_q.eq = lambda c, v: eq_q
                    eq_q.limit = lambda n: eq_q
                    return eq_q

                q.eq = eq
                q.in_ = lambda c, v: q
                q.limit = lambda n: q
                q.execute = MagicMock(return_value=MagicMock(data=[SAMPLE_AI_MODEL]))
                q.single = lambda: MagicMock(execute=MagicMock(return_value=MagicMock(data=SAMPLE_PRODUCT)))
                return q

            def insert(data):
                ins = MagicMock()
                if name == "generated_videos":
                    ins.execute = MagicMock(return_value=MagicMock(data=[{"id": "job-001"}]))
                elif name == "looks":
                    ins.execute = MagicMock(return_value=MagicMock(data=[{"id": "look-001"}]))
                    ins.select = lambda *a: ins
                    ins.single = lambda: ins
                elif name == "look_videos":
                    ins.execute = MagicMock(return_value=MagicMock(data=[{"id": "lv-001"}]))
                elif name == "look_products":
                    ins.execute = MagicMock(return_value=MagicMock(data=[{"id": "lp-001"}]))
                else:
                    ins.execute = MagicMock(return_value=MagicMock(data=[data]))
                ins.select = lambda *a: ins
                ins.single = lambda: ins
                return ins

            def update(data):
                upd = MagicMock()
                upd.eq = lambda c, v: upd
                upd.execute = MagicMock(return_value=MagicMock(data=[data]))
                return upd

            tbl.select = select
            tbl.insert = insert
            tbl.update = update
            return tbl

        mock.table = table
        mock.storage.from_ = MagicMock(return_value=MagicMock(
            upload=MagicMock(),
            get_public_url=MagicMock(return_value="https://storage.supabase.co/look-media/gen/test.mp4"),
        ))
        mock.rpc = MagicMock(return_value=MagicMock(execute=MagicMock()))
        return mock

    @patch("agent.generate_video_from_image", return_value=FAKE_VIDEO_BYTES)
    @patch("agent.enhance_prompt_with_gemini", return_value="enhanced cinematic prompt")
    @patch("agent.httpx")
    @patch("agent.create_client")
    def test_full_pipeline_success(self, mock_create_client, mock_httpx, mock_enhance, mock_veo):
        from agent import generate_video

        mock_sb = self._mock_supabase()
        mock_create_client.return_value = mock_sb
        mock_httpx.get.return_value = MagicMock(
            content=b"fake_image_bytes",
            headers={"content-type": "image/jpeg"},
            raise_for_status=MagicMock(),
        )

        result = generate_video(product_id="prod-001", style="editorial_runway", ai_model_id="model-001")

        assert result["success"] is True
        assert result["look_id"] == "look-001"
        assert "video_url" in result
        assert result["job_id"] == "job-001"

    @patch("agent.generate_video_from_image", return_value=FAKE_VIDEO_BYTES)
    @patch("agent.enhance_prompt_with_gemini", return_value="enhanced prompt")
    @patch("agent.httpx")
    @patch("agent.create_client")
    def test_pipeline_auto_selects_model(self, mock_create_client, mock_httpx, mock_enhance, mock_veo):
        from agent import generate_video

        mock_sb = self._mock_supabase()
        mock_create_client.return_value = mock_sb
        mock_httpx.get.return_value = MagicMock(
            content=b"fake_image",
            headers={"content-type": "image/jpeg"},
            raise_for_status=MagicMock(),
        )

        result = generate_video(product_id="prod-001")
        assert result["success"] is True

    @patch("agent.create_client")
    def test_missing_product_raises(self, mock_create_client):
        from agent import generate_video

        mock_sb = MagicMock()
        mock_sb.table.return_value.select.return_value.eq.return_value.single.return_value.execute.return_value = MagicMock(data=None)
        mock_create_client.return_value = mock_sb

        with pytest.raises(ValueError, match="not found"):
            generate_video(product_id="nonexistent")

    @patch("agent.create_client")
    def test_no_images_raises(self, mock_create_client):
        from agent import generate_video

        product_no_img = {**SAMPLE_PRODUCT, "images": None, "image_url": None}
        mock_sb = MagicMock()
        mock_sb.table.return_value.select.return_value.eq.return_value.single.return_value.execute.return_value = MagicMock(data=product_no_img)
        mock_create_client.return_value = mock_sb

        with pytest.raises(ValueError, match="no images"):
            generate_video(product_id="prod-001")


class TestCostEstimation:
    def test_fast_720p(self):
        from agent import _estimate_cost
        assert _estimate_cost("veo-3.1-fast-generate-preview", "720p") == 0.10

    def test_fast_1080p(self):
        from agent import _estimate_cost
        assert _estimate_cost("veo-3.1-fast-generate-preview", "1080p") == 0.12

    def test_lite_720p(self):
        from agent import _estimate_cost
        assert _estimate_cost("veo-3.1-lite-generate-preview", "720p") == 0.05

    def test_full_720p(self):
        from agent import _estimate_cost
        assert _estimate_cost("veo-3.1-generate-preview", "720p") == 0.40

    def test_unknown_model_fallback(self):
        from agent import _estimate_cost
        cost = _estimate_cost("veo-99-unknown", "720p")
        assert cost == 0.10  # default fallback
