// share-look
//
// POST /share-look
// Body: { generation_id: string }
// Auth: required (verify_jwt=true).
//
// Creates a public share row for the caller's user_generation,
// generates a unique slug, and triggers the Modal watermark worker
// asynchronously. Returns the slug + share_id immediately so the
// frontend can navigate / show a share modal that polls for status.
//
// The Modal endpoint URL lives in Supabase Functions secrets as
// MODAL_WATERMARK_URL. If it isn't set, the share row is still
// created (status='pending') so the watermark can be backfilled
// later, but the response carries a non-fatal warning.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// 32 chars, no look-alikes (no 0/O/1/I/l). 10 chars = ~50 bits.
const SLUG_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const SLUG_LENGTH = 10;

function generateSlug(): string {
  const bytes = new Uint8Array(SLUG_LENGTH);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < SLUG_LENGTH; i++) {
    out += SLUG_ALPHABET[bytes[i] % SLUG_ALPHABET.length];
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("method not allowed", { status: 405 });
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const serviceClient = createClient(
    supabaseUrl,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let body: { generation_id?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "bad json" }), { status: 400 });
  }
  const generationId = body.generation_id;
  if (!generationId) {
    return new Response(
      JSON.stringify({ error: "missing generation_id" }),
      { status: 400 },
    );
  }

  const { data: userResp, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userResp?.user) {
    return new Response(
      JSON.stringify({ error: "not authenticated" }),
      { status: 401 },
    );
  }
  const userId = userResp.user.id;

  const { data: gen, error: genErr } = await userClient
    .from("user_generations")
    .select("id, user_id, status, video_url")
    .eq("id", generationId)
    .maybeSingle();
  if (genErr || !gen) {
    return new Response(
      JSON.stringify({ error: "generation not found" }),
      { status: 404 },
    );
  }
  if (gen.user_id !== userId) {
    return new Response(
      JSON.stringify({ error: "not your generation" }),
      { status: 403 },
    );
  }
  if (gen.status !== "done" || !gen.video_url) {
    return new Response(
      JSON.stringify({ error: "generation isn't done yet" }),
      { status: 409 },
    );
  }

  const { data: existing } = await serviceClient
    .from("look_shares")
    .select("id, slug, status, watermarked_video_url")
    .eq("generation_id", generationId)
    .eq("created_by", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing) {
    return new Response(
      JSON.stringify({
        share_id: existing.id,
        slug: existing.slug,
        status: existing.status,
        watermarked_video_url: existing.watermarked_video_url,
        reused: true,
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  }

  let inserted: { id: string; slug: string } | null = null;
  for (let attempt = 0; attempt < 3 && !inserted; attempt++) {
    const slug = generateSlug();
    const { data, error } = await userClient
      .from("look_shares")
      .insert({
        slug,
        generation_id: generationId,
        created_by: userId,
        status: "pending",
      })
      .select("id, slug")
      .maybeSingle();
    if (data) {
      inserted = data;
    } else if (error && !/duplicate key|unique/i.test(error.message)) {
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 500 },
      );
    }
  }
  if (!inserted) {
    return new Response(
      JSON.stringify({ error: "could not generate unique slug" }),
      { status: 500 },
    );
  }

  const modalUrl = Deno.env.get("MODAL_WATERMARK_URL");
  let modalKickoff: "queued" | "missing_url" | "error" = "missing_url";
  if (modalUrl) {
    try {
      const r = await fetch(modalUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ share_id: inserted.id }),
      });
      modalKickoff = r.ok ? "queued" : "error";
    } catch {
      modalKickoff = "error";
    }
  }

  return new Response(
    JSON.stringify({
      share_id: inserted.id,
      slug: inserted.slug,
      status: "pending",
      modal: modalKickoff,
    }),
    { headers: { "Content-Type": "application/json" } },
  );
});
