// _shared/seedance-model.test.ts — dependency-free unit test for Seedance slug
// routing. Run: deno test --no-check supabase/functions/_shared/seedance-model.test.ts
//
// Guards the regression that adding Seedance 2.5 exposed: an exact-slug-set
// check treats a new Seedance version as "not Seedance", which skips the
// face-grid bypass and makes every render fall back to Gemini Omni.

import {
  isSeedanceModel, isSeedanceEndpoint, hasSeedanceTiers,
  seedanceSlugFor, falAppBase, SEEDANCE_20_FAST, SEEDANCE_20_PRO,
} from './seedance-model.ts';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`FAILED: ${msg}`);
}

Deno.test('every Seedance version keeps the Seedance path', () => {
  for (const slug of [
    SEEDANCE_20_FAST, SEEDANCE_20_PRO,
    'bytedance/seedance-2.5/reference-to-video',
    'bytedance/seedance-2.0/mini/reference-to-video',
    'seedance-2', 'seedance-1-pro', 'seedance-1-lite',
  ]) {
    assert(isSeedanceModel(slug), `${slug} must route to Seedance`);
  }
});

Deno.test('non-Seedance models do not', () => {
  for (const slug of [
    'fal-ai/veo3.1/fast/image-to-video', 'fal-ai/vidu/reference-to-video',
    'google/gemini-omni', 'fal-ai/kling-video/v3/pro/image-to-video',
  ]) {
    assert(!isSeedanceModel(slug), `${slug} must not route to Seedance`);
  }
});

Deno.test('only 2.0 and legacy aliases get the fast/pro tier rewrite', () => {
  assert(hasSeedanceTiers(SEEDANCE_20_FAST), '2.0 fast is tiered');
  assert(hasSeedanceTiers(SEEDANCE_20_PRO), '2.0 pro is tiered');
  assert(hasSeedanceTiers('seedance-1-lite'), 'legacy alias is tiered');
  // 2.5 has ONE endpoint — rewriting it to a tier would silently downgrade the
  // render back to 2.0, which is exactly what the operator did not pick.
  assert(!hasSeedanceTiers('bytedance/seedance-2.5/reference-to-video'), '2.5 has no tiers');
  assert(seedanceSlugFor('pro') === SEEDANCE_20_PRO, 'pro → pro endpoint');
  assert(seedanceSlugFor('fast') === SEEDANCE_20_FAST, 'fast → fast endpoint');
  assert(seedanceSlugFor(null) === SEEDANCE_20_FAST, 'unset defaults to fast');
});

Deno.test('legacy aliases are not routable fal endpoints', () => {
  assert(isSeedanceEndpoint('bytedance/seedance-2.5/reference-to-video'), '2.5 is routable');
  assert(!isSeedanceEndpoint('seedance-2'), 'bare alias is not a fal endpoint');
});

Deno.test('queue status routes use the two-segment app base', () => {
  assert(falAppBase('bytedance/seedance-2.5/reference-to-video') === 'bytedance/seedance-2.5', '2.5 base');
  assert(falAppBase(SEEDANCE_20_FAST) === 'bytedance/seedance-2.0', '2.0 fast base drops /fast/');
});
