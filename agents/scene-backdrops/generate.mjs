// One-off: generate the StyleUp scene-picker backdrop thumbnails via Fal (flux)
// and host them in the Supabase `scene-backdrops` public bucket. Re-run to
// regenerate; uploads are upsert. The object names here MUST match the URLs
// baked into app/data/style-scenes.ts.
//
//   node --env-file=.env agents/scene-backdrops/generate.mjs
//
// Needs FAL_KEY + SUPABASE_SERVICE_ROLE_KEY + VITE_SUPABASE_URL in the env.

const FAL_KEY = process.env.FAL_KEY;
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!FAL_KEY || !SUPABASE_URL || !SERVICE_ROLE) {
  console.error('Missing FAL_KEY / VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const BUCKET = 'scene-backdrops';

// id → flux prompt. Empty environments, NO people (the shopper is composited in
// later by the look render); premium editorial, matches each preset's render
// phrase. "empty / deserted / no people" is repeated hard — flux still sneaks in
// distant figures otherwise.
const SCENES = [
  ['studio', 'A high-end editorial photography studio, warm beige seamless paper backdrop, soft diffused golden light, elegant and minimal, cinematic, completely empty, no people, premium fashion set, photorealistic'],
  ['restaurant', 'An intimate candlelit fine-dining restaurant interior at night, warm golden ambient glow, softly blurred bokeh background, elegant set tables, completely empty, deserted, no people, moody editorial, cinematic, photorealistic'],
  ['rooftop', 'A stylish rooftop bar at dusk, glowing city skyline, warm string lights, soft bokeh, blue-hour sky, completely empty, deserted, no people, editorial fashion location, cinematic, photorealistic'],
  ['cafe', 'A charming sunny European outdoor cafe terrace in the morning, warm golden daylight, cafe tables, lush greenery, pastel tones, completely empty, deserted, no people, editorial lifestyle, cinematic, photorealistic'],
  ['street', 'A picturesque old-town European cobblestone street at golden hour, warm sunlight, elegant facades, completely empty, deserted, no people anywhere, editorial fashion location, cinematic, photorealistic, wide'],
  ['beach', 'A serene sandy beach at golden hour, soft breaking waves, warm glowing sunlight, pastel sky, completely empty, deserted, no people, editorial fashion backdrop, cinematic, photorealistic'],
  ['office', 'A stylish sunlit modern loft workspace, floor-to-ceiling windows, warm wood floor, greenery, minimal design-forward interior, completely empty, no people, aspirational editorial, cinematic, photorealistic'],
  ['park', 'A beautiful sunny city park with lush green trees and a winding path, warm golden daylight, dappled light, completely empty, deserted, no people, editorial lifestyle backdrop, cinematic, photorealistic'],
];

async function ensureBucket() {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/bucket`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${SERVICE_ROLE}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: BUCKET, name: BUCKET, public: true }),
  });
  if (res.ok) { console.log(`bucket ${BUCKET} created`); return; }
  const body = await res.text();
  if (res.status === 409 || body.includes('already exists')) { console.log(`bucket ${BUCKET} exists`); return; }
  throw new Error(`bucket create failed ${res.status}: ${body}`);
}

// flux-pro v1.1 — markedly better realism than schnell. No num_inference_steps
// (that's a schnell/dev param); pro tunes internally.
const MODEL = process.env.SCENE_MODEL || 'fal-ai/flux-pro/v1.1';
async function flux(prompt) {
  const res = await fetch(`https://fal.run/${MODEL}`, {
    method: 'POST',
    headers: { Authorization: `Key ${FAL_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, image_size: 'portrait_4_3', num_images: 1, output_format: 'jpeg' }),
  });
  if (!res.ok) throw new Error(`fal ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const url = data.images?.[0]?.url;
  if (!url) throw new Error(`no image url in fal response: ${JSON.stringify(data).slice(0, 300)}`);
  return url;
}

async function upload(id, bytes) {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${id}.jpg`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SERVICE_ROLE}`,
      'Content-Type': 'image/jpeg',
      'x-upsert': 'true',
      'cache-control': 'public, max-age=31536000, immutable',
    },
    body: bytes,
  });
  if (!res.ok) throw new Error(`upload ${id} failed ${res.status}: ${await res.text()}`);
  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${id}.jpg`;
}

await ensureBucket();
for (const [id, prompt] of SCENES) {
  try {
    const imgUrl = await flux(prompt);
    const bytes = new Uint8Array(await (await fetch(imgUrl)).arrayBuffer());
    const publicUrl = await upload(id, bytes);
    console.log(`✓ ${id} → ${publicUrl} (${bytes.length} bytes)`);
  } catch (e) {
    console.error(`✗ ${id}: ${e.message}`);
  }
}
console.log('done');
