from ad_generator import (
    _estimate_cost,
    _PER_SECOND_USD,
    _UNKNOWN_MODEL_USD_PER_SECOND,
)

# The real slugs in use. Pro carries NO tier segment - that asymmetry is the
# whole reason these tests exist.
PRO = "bytedance/seedance-2.0/reference-to-video"
FAST = "bytedance/seedance-2.0/fast/reference-to-video"


def test_pro_slug_is_actually_matched_not_falling_through():
    """Regression: an earlier draft keyed pro on 'bytedance/seedance-2.0/pro',
    which matches nothing that exists, so pro silently used the unknown-model
    rate and the fast<pro ordering held only by accident."""
    assert _estimate_cost(PRO, "720p", 10) == round(0.060 * 10, 4)
    assert _estimate_cost(PRO, "720p", 10) != round(_UNKNOWN_MODEL_USD_PER_SECOND * 10, 4)


def test_fast_is_cheaper_than_pro_by_rate_not_by_accident():
    assert _estimate_cost(FAST, "720p", 10) < _estimate_cost(PRO, "720p", 10)


def test_no_model_returns_the_old_flat_default():
    """Every product_creative row read exactly 0.1000 before this fix."""
    for slug in (PRO, FAST, "fal-ai/vidu/reference-to-video", "some/unknown-model"):
        assert _estimate_cost(slug, "720p", 10) != 0.10


def test_duration_scales_linearly():
    five = _estimate_cost(FAST, "720p", 5)
    ten = _estimate_cost(FAST, "720p", 10)
    assert abs(ten - five * 2) < 0.001


def test_unknown_model_bills_at_the_highest_known_rate():
    """Fail-safe: unknown must over-report, never under-report."""
    highest = max(rate for _, rate in _PER_SECOND_USD)
    assert _UNKNOWN_MODEL_USD_PER_SECOND == highest
    assert _estimate_cost("some/unknown-model", "720p", 10) == round(highest * 10, 4)


def test_veo_flat_models_still_priced():
    assert _estimate_cost("veo-3.1-fast-generate-preview", "720p", 8) == 0.10


def test_zero_duration_bills_at_least_one_second():
    assert _estimate_cost(FAST, "720p", 0) == round(0.030 * 1, 4)
