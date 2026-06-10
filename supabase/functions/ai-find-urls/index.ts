// ai-find-urls — runs the same shopper prompt through Claude AND
// Gemini in parallel, instructs both to return ONLY URLs (no prose),
// then parses the URLs out and returns them grouped by model.
//
// The admin "Add via Claude + Gemini" flow uses this as the source
// of truth for a side-by-side comparison: two columns of URLs, each
// tappable to enqueue the scraper.
//
// Required Supabase secrets:
//   ANTHROPIC_API_KEY — Claude
//   GOOGLE_API_KEY    — Gemini

import { logAiUsage } from '../_shared/ai-usage.ts';

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

// Most-recent models per the project's standard.
// HIGHEST tier of each provider — per user spec, never Sonnet,
// never Gemini 2.5. Claude Opus 4.8 + Gemini 3.1 Pro.
// (gemini-3-pro-preview was retired by Google in March 2026; the GA
//  replacement is gemini-3.1-pro-preview.)
const CLAUDE_MODEL = 'claude-opus-4-8';
const GEMINI_MODEL = 'gemini-3.1-pro-preview';

// Anthropic server-side web-search tool. Without it Claude has no way
// to confirm a URL resolves to a live product page, so under the strict
// "drop anything you're not sure of" prompt below it returns nothing.
const CLAUDE_WEB_SEARCH_TOOL = { type: 'web_search_20260209', name: 'web_search' };

// One shared instruction so both models return the same shape.
const SYSTEM_INSTRUCTION = `You help build a shoppable product catalog.

The user will describe what they're looking for. Your job: return a
list of EXACT, REAL, DIRECT PRODUCT URLs — one per line — that match
the request and resolve to buyable product pages RIGHT NOW.

ALWAYS use web search to find and verify these URLs. Do not answer
from memory — search for the products, open the candidates, and only
return links you have confirmed point at a live product detail page.

STRICT RULES:
- Output URLs ONLY. No headers, no bullets, no prose, no markdown,
  no descriptions, no commentary. Each line is exactly one URL.
- Every URL must be a DEEP LINK to a specific product on a specific
  retailer's product detail page. Not:
    × homepages          (https://www.brand.com)
    × category pages     (https://www.brand.com/men)
    × search pages       (https://www.brand.com/search?q=...)
    × blog posts / press
    × example.com or other placeholder domains
- The URL must end at a specific product — a slug, an SKU, an item
  id. If you can't be certain a URL is a real, live product page,
  DROP IT. Quality over quantity. Better to return 8 URLs you're
  sure of than 20 with guesses.
- Prefer the brand's own .com when it has a direct product page;
  otherwise Amazon, Nordstrom, Bloomingdale's, Sephora, Net-a-Porter,
  REI, etc. — major retailers with stable product URLs.
- Do NOT invent URLs. Do NOT use example.com, placeholder paths, or
  imagined slugs. Only URLs you would recognise as real, live
  product pages.
- Do not echo the user's prompt. Just URLs, one per line.`;

interface ModelResult {
  model: string;
  urls: string[];
  error?: string;
  ms: number;
  inputTokens?: number | null;
  outputTokens?: number | null;
}

/** Extracts http(s) URLs from arbitrary text. Strips trailing
 *  punctuation that often glues to URLs in prose (',.!?;:)]}>'). */
function extractUrls(text: string): string[] {
  if (!text) return [];
  const out: string[] = [];
  const re = /https?:\/\/[^\s<>"']+/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    let u = m[0];
    // Trim common trailing chars that get glued in markdown / prose.
    while (u.length && /[),.!?;:>\]}"']/.test(u[u.length - 1])) u = u.slice(0, -1);
    if (u) out.push(u);
  }
  // Dedupe in insertion order.
  const seen = new Set<string>();
  return out.filter(u => (seen.has(u) ? false : (seen.add(u), true)));
}

async function runClaude(prompt: string, apiKey: string): Promise<ModelResult> {
  const t0 = Date.now();
  if (!apiKey) return { model: CLAUDE_MODEL, urls: [], error: 'ANTHROPIC_API_KEY not configured', ms: 0 };
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 4000,
        system: SYSTEM_INSTRUCTION,
        tools: [CLAUDE_WEB_SEARCH_TOOL],
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    const data = await res.json() as {
      content?: { type: string; text?: string }[];
      usage?: { input_tokens?: number; output_tokens?: number };
      error?: { message?: string };
    };
    if (!res.ok || data.error) {
      return { model: CLAUDE_MODEL, urls: [], error: data.error?.message || `Claude ${res.status}`, ms: Date.now() - t0 };
    }
    // Web search interleaves several text blocks with tool-use/result
    // blocks — concatenate every text block, not just the first.
    const text = (data.content ?? []).filter(b => b.type === 'text').map(b => b.text || '').join('\n');
    return {
      model: CLAUDE_MODEL,
      urls: extractUrls(text),
      ms: Date.now() - t0,
      inputTokens: data.usage?.input_tokens ?? null,
      outputTokens: data.usage?.output_tokens ?? null,
    };
  } catch (err) {
    return { model: CLAUDE_MODEL, urls: [], error: err instanceof Error ? err.message : String(err), ms: Date.now() - t0 };
  }
}

async function runGemini(prompt: string, apiKey: string): Promise<ModelResult> {
  const t0 = Date.now();
  if (!apiKey) return { model: GEMINI_MODEL, urls: [], error: 'GOOGLE_API_KEY not configured', ms: 0 };
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        // Google Search grounding so Gemini returns real, live URLs
        // instead of guessing from training data.
        tools: [{ google_search: {} }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 2000 },
      }),
    });
    const data = await res.json() as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
      error?: { message?: string };
    };
    if (!res.ok || data.error) {
      return { model: GEMINI_MODEL, urls: [], error: data.error?.message || `Gemini ${res.status}`, ms: Date.now() - t0 };
    }
    const text = data.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
    return {
      model: GEMINI_MODEL,
      urls: extractUrls(text),
      ms: Date.now() - t0,
      inputTokens: data.usageMetadata?.promptTokenCount ?? null,
      outputTokens: data.usageMetadata?.candidatesTokenCount ?? null,
    };
  } catch (err) {
    return { model: GEMINI_MODEL, urls: [], error: err instanceof Error ? err.message : String(err), ms: Date.now() - t0 };
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== 'POST') return jsonRes({ error: 'POST only' }, 405);

  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY') ?? '';
  const googleKey = Deno.env.get('GOOGLE_API_KEY') ?? '';

  let payload: { prompt?: string };
  try { payload = await req.json(); } catch { return jsonRes({ error: 'Invalid JSON body' }, 400); }
  const prompt = (payload.prompt || '').trim();
  if (!prompt) return jsonRes({ error: 'prompt is required' }, 400);

  const [claude, gemini] = await Promise.all([
    runClaude(prompt, anthropicKey),
    runGemini(prompt, googleKey),
  ]);

  // Fire-and-forget usage logs so the AI dashboard reflects these
  // calls.
  void logAiUsage({
    platform: 'anthropic',
    operation: 'ai-find-urls',
    model: CLAUDE_MODEL,
    input_tokens: claude.inputTokens ?? null,
    output_tokens: claude.outputTokens ?? null,
    status: claude.error ? 'error' : 'success',
    error_message: claude.error ?? null,
    metadata: { urls: claude.urls.length, ms: claude.ms },
  });
  void logAiUsage({
    platform: 'google',
    operation: 'ai-find-urls',
    model: GEMINI_MODEL,
    input_tokens: gemini.inputTokens ?? null,
    output_tokens: gemini.outputTokens ?? null,
    status: gemini.error ? 'error' : 'success',
    error_message: gemini.error ?? null,
    metadata: { urls: gemini.urls.length, ms: gemini.ms },
  });

  return jsonRes({ claude, gemini });
});
