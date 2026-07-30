"""Ad-creative pricing table + cost estimator.

Stdlib-only, no project imports — this is what lets test_cost.py run in a bare
checkout or CI. ad_generator.py imports _estimate_cost (and the two tables)
from here; this is the ONLY copy of the pricing table in the codebase.

(agents/video-generator/agent.py has its own unrelated `_estimate_cost` for
the separate looks/generated_videos pipeline — a 3-entry flat table with a
different signature (no duration_seconds). That is a different feature, not
covered by this module; do not merge the two.)
"""

# Per-SECOND pricing. Fal bills reference-to-video by duration, which a flat
# per-render table could not express - and it listed only 3 Veo models, so
# every Seedance render fell through to the 0.10 default. That default is why
# all 41 pre-2026-07-28 product_creative rows read exactly $0.1000 and why the
# monthly budget cap could not be trusted.
# Per-SECOND rates, derived from this repo's own pricing table in
# app/constants/video-model-pricing.ts, whose header states its numbers are
# "ballpark for a single ~5s 720p portrait clip" - so rate = costUsd / 5.
#
# ORDER MATTERS and the list is most-specific-first, because the Pro
# reference-to-video slug carries NO tier segment:
#     pro  -> bytedance/seedance-2.0/reference-to-video
#     fast -> bytedance/seedance-2.0/fast/reference-to-video
# A bare "bytedance/seedance-2.0" prefix therefore matches BOTH, so the fast
# entry must be tested first. (An earlier draft keyed pro on
# "bytedance/seedance-2.0/pro", which matches nothing that exists - pro fell
# through to the unknown-model rate and the fast<pro ordering only held by
# accident.)
#
# These remain ESTIMATES. fal does not return a price in its response, so the
# budget cap in run_pipeline_creative_drain() is only as accurate as this
# table - reconcile it against a real fal invoice after the first canary.
PER_SECOND_USD = (
    ("bytedance/seedance-2.0/fast", 0.030),   # 0.15 / 5s
    ("bytedance/seedance-2.0",      0.060),   # 0.30 / 5s  (pro ref-to-video)
    ("fal-ai/veo3.1/fast",          0.024),   # 0.12 / 5s
    ("fal-ai/veo3.1",               0.090),   # 0.45 / 5s
    ("fal-ai/vidu",                 0.040),   # 0.20 / 5s
    ("google/gemini-omni",          0.060),   # absent from the repo table; priced at top tier
)
FLAT_USD = {
    "veo-3.1-fast-generate-preview":  {"720p": 0.10, "1080p": 0.12},
    "veo-3.1-generate-preview":       {"720p": 0.40, "1080p": 0.40},
    "veo-3.1-lite-generate-preview":  {"720p": 0.05, "1080p": 0.08},
}
# Fail-safe: an unpriced slug bills at the HIGHEST known rate, so an unknown
# model can only ever over-report spend and trip the cap early.
UNKNOWN_MODEL_USD_PER_SECOND = max(rate for _, rate in PER_SECOND_USD)


def estimate_cost(model: str, resolution: str, duration_seconds: int = 5) -> float:
    """Estimated USD for one render, by the model ACTUALLY used and its real
    duration. Conservative by design: an unpriced slug is billed at the most
    expensive known rate so the budget cap fails safe."""
    if model in FLAT_USD:
        return FLAT_USD[model].get(resolution, 0.10)
    for prefix, rate in PER_SECOND_USD:
        if model.startswith(prefix):
            return round(rate * max(1, duration_seconds), 4)
    return round(UNKNOWN_MODEL_USD_PER_SECOND * max(1, duration_seconds), 4)
