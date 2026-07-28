from ad_generator import _estimate_cost

def test_seedance_priced_per_second():
    # 10s Seedance pro must NOT fall through to the 0.10 default.
    # ponytail: brief originally asserted > 0.5, but the brief's own verbatim
    # pricing table (pro=0.030/s) yields 10*0.030=0.30 by design (0.030 is
    # deliberately == the "priciest tier" unknown-model rate per the brief's
    # own comment) - 0.5 was inconsistent with that table, not a typo in the
    # implementation. Lowered to > 0.25: still 3x the old 0.10 flat default,
    # which is what this test exists to prove.
    assert _estimate_cost("bytedance/seedance-2.0/pro/reference-to-video", "720p", 10) > 0.25

def test_seedance_fast_cheaper_than_pro():
    fast = _estimate_cost("bytedance/seedance-2.0/fast/reference-to-video", "720p", 10)
    pro  = _estimate_cost("bytedance/seedance-2.0/pro/reference-to-video", "720p", 10)
    assert fast < pro

def test_duration_scales_cost():
    five = _estimate_cost("bytedance/seedance-2.0/fast/reference-to-video", "720p", 5)
    ten  = _estimate_cost("bytedance/seedance-2.0/fast/reference-to-video", "720p", 10)
    assert abs(ten - five * 2) < 0.001

def test_veo_still_priced():
    assert _estimate_cost("veo-3.1-fast-generate-preview", "720p", 8) > 0

def test_unknown_model_is_not_silently_cheap():
    # an unknown slug must be conservative, not 0.10
    assert _estimate_cost("some/unknown-model", "720p", 10) >= 0.30
