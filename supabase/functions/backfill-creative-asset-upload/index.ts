// One-shot upload helper for the creative-assets backfill. Accepts a JSON
// payload with base64-encoded poster JPEG + mobile-optimized MP4 plus
// the storage paths to write them to, uploads both via the implicit
// service-role context, and patches the matching DB row's thumbnail_url
// and mobile_video_url.
//
// Authorized via the project's anon JWT (verify_jwt=true). The function
// itself owns the service-role write capability so callers don't need
// to ship a service-role key around.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const BUCKET = "look-media";

// Phase 8: paths in look-media are UUID-keyed and never overwritten
// in place, so a 1-year immutable cache is correct. Without this the
// Supabase JS default lands at max-age=3600 (1h), which costs us a
// fresh edge round-trip every hour for assets that never change.
const CACHE_CONTROL = "public, max-age=31536000, immutable";

interface Body {
  table: "product_creative" | "generated_videos" | "looks_creative";
  row_id: string;
  poster_path?: string;
  mobile_path?: string;
  poster_b64?: string;
  mobile_b64?: string;
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "bad json" }), { status: 400 });
  }
  if (!body.row_id || !body.table) {
    return new Response(JSON.stringify({ error: "missing row_id/table" }), { status: 400 });
  }
  const allowed = new Set(["product_creative", "generated_videos", "looks_creative"]);
  if (!allowed.has(body.table)) {
    return new Response(JSON.stringify({ error: "bad table" }), { status: 400 });
  }

  const update: Record<string, string> = {};
  const projectUrl = Deno.env.get("SUPABASE_URL")!;

  try {
    if (body.poster_b64 && body.poster_path) {
      const bytes = b64ToBytes(body.poster_b64);
      const { error } = await supabase.storage.from(BUCKET).upload(
        body.poster_path,
        bytes,
        { contentType: "image/jpeg", upsert: true, cacheControl: CACHE_CONTROL },
      );
      if (error) throw new Error(`poster upload: ${error.message}`);
      update.thumbnail_url = `${projectUrl}/storage/v1/object/public/${BUCKET}/${body.poster_path}`;
    }
    if (body.mobile_b64 && body.mobile_path) {
      const bytes = b64ToBytes(body.mobile_b64);
      const { error } = await supabase.storage.from(BUCKET).upload(
        body.mobile_path,
        bytes,
        { contentType: "video/mp4", upsert: true, cacheControl: CACHE_CONTROL },
      );
      if (error) throw new Error(`mobile upload: ${error.message}`);
      update.mobile_video_url = `${projectUrl}/storage/v1/object/public/${BUCKET}/${body.mobile_path}`;
    }
    if (Object.keys(update).length > 0) {
      const { error } = await supabase.from(body.table).update(update).eq("id", body.row_id);
      if (error) throw new Error(`row update: ${error.message}`);
    }
    return new Response(JSON.stringify({ ok: true, update }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ error: (e as Error).message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});
