// validate-selfie — one Claude-vision call that judges whether a shopper's
// uploaded photo is usable as the reference for an AI virtual try-on.
//
// POST { image_url: string }
// → 200 { face_clear, exactly_one_person, is_real_photo, full_body, reason }
//
// The CLIENT owns the accept/reject policy: it hard-rejects when
// face_clear / exactly_one_person / is_real_photo is false (see
// validateSelfie() in app/services/user-generations.ts). `full_body` is a
// soft quality signal, never a hard reject.
//
// Fails OPEN: any missing key / bad JSON / upstream error returns all-true
// so a hiccup never blocks an upload (matches checkFacePhoto's philosophy).
//
// Required Supabase secret: ANTHROPIC_API_KEY.
//
// ponytail: no logAiUsage telemetry here — kept self-contained (single file,
// no ../_shared dep) so it deploys cleanly. Add usage logging if this call
// volume ever grows enough to matter (~$0.003/call today).

const MODEL = 'claude-haiku-4-5';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, apikey, x-client-info',
  'Access-Control-Max-Age': '86400',
};

function jsonRes(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

// The verdict shape the client reads. On any failure we return PASS (all
// true) so the check fails open and never blocks a legit upload.
interface Verdict {
  face_clear: boolean;
  exactly_one_person: boolean;
  is_real_photo: boolean;
  full_body: boolean;
  reason: string | null;
}

// Fail-open verdict: everything passes so a hiccup never blocks the upload.
const PASS: Verdict = {
  face_clear: true,
  exactly_one_person: true,
  is_real_photo: true,
  full_body: true,
  reason: null,
};

interface ClaudeResponse {
  content?: Array<{ type: string; text?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { message?: string };
}

const SYSTEM =
  'You are validating a photo a shopper uploaded of themselves. It becomes the '
  + 'reference image for an AI virtual try-on video that renders this exact person '
  + 'wearing selected clothing, so the photo has to clearly show them.';

const RUBRIC = `Look at the image and return ONLY a JSON object (no prose, no code fences) with exactly these keys:
{
  "face_clear": boolean,          // exactly one person's face is clearly visible and front-facing enough to recognize — NOT blurry, turned away, hidden by sunglasses/mask/hands/hair, or too dark to make out
  "exactly_one_person": boolean,  // exactly one real human is the subject — false for group photos AND for photos with no person in them
  "is_real_photo": boolean,       // a real photograph of a real person — false for screenshots, memes, illustrations/cartoons, product/packshot images, text images, or a photo of a screen
  "full_body": boolean,           // roughly head-to-legs visible (a quality signal only, not a requirement)
  "reason": string                // ONE short, friendly sentence for the shopper. If something is wrong, say what and how to fix it, e.g. "We couldn't see your face clearly — try a photo facing the camera in good light." If it's a solid full-body shot, a brief positive note is fine.
}`;

// Pull the first {...} object out of the model's text and coerce it into a
// Verdict. Anything missing or malformed → fail open (PASS).
function parseVerdict(text: string): Verdict {
  try {
    const cleaned = text.replace(/```json\s*|```\s*/g, '').trim();
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start < 0 || end <= start) return PASS;
    const o = JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
    // Only trust explicit booleans; a missing key stays permissive (true).
    const bool = (v: unknown) => (typeof v === 'boolean' ? v : true);
    return {
      face_clear: bool(o.face_clear),
      exactly_one_person: bool(o.exactly_one_person),
      is_real_photo: bool(o.is_real_photo),
      full_body: bool(o.full_body),
      reason: typeof o.reason === 'string' ? o.reason.slice(0, 200) : null,
    };
  } catch {
    return PASS;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY') || '';
  if (!apiKey) return jsonRes(PASS); // no key → don't block uploads

  let imageUrl = '';
  try {
    const body = await req.json();
    imageUrl = String(body?.image_url || '').trim();
  } catch { /* fall through */ }
  if (!imageUrl) return jsonRes(PASS);

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 400,
        system: SYSTEM,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'url', url: imageUrl } },
            { type: 'text', text: RUBRIC },
          ],
        }],
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      console.error(`[validate-selfie] Anthropic ${res.status}: ${errBody.slice(0, 300)}`);
      return jsonRes(PASS); // upstream error → fail open
    }

    const json = (await res.json()) as ClaudeResponse;
    const text = json.content?.find(c => c.type === 'text')?.text?.trim() ?? '';
    return jsonRes(text ? parseVerdict(text) : PASS);
  } catch (err) {
    console.error('[validate-selfie]', err);
    return jsonRes(PASS); // network/parse error → fail open
  }
});
