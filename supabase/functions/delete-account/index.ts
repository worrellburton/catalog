// delete-account
//
// POST /delete-account
// Body: none. Auth: required.
//
// Deletes the caller's account. The database already cascades most user data:
// public.profiles references auth.users(id) on delete cascade, and 18 further
// tables cascade from profiles or auth.users. So auth.admin.deleteUser(uid)
// alone wipes uploads, generations, collections, follows, comments,
// wallet_entries, payout_transfers, brand memberships, and the rest.
// lens_searches / search_queries / musics are set null (anonymized).
//
// This function does only the three things the cascade does NOT:
//   1. Purge Storage objects under user-uploads/<uid>/ (no FK, not cascaded).
//   2. Pre-null four RESTRICT foreign keys that would otherwise BLOCK the
//      delete for a privileged user (reviewer / brand inviter). All nullable.
//   3. Delete the auth user, triggering the cascade.
//
// uid comes from the VERIFIED JWT, never the request body — this function holds
// the service role key, so a body-supplied id would be an account-takeover
// primitive.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return json({ error: "method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const authHeader = req.headers.get("Authorization") ?? "";

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: userErr } = await userClient.auth.getUser();
  if (userErr || !user) {
    return json({ error: "unauthorized" }, 401);
  }
  const uid = user.id;

  const admin = createClient(
    supabaseUrl,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // 1. Storage: every object under the user's own prefix. No FK covers this,
  //    so the cascade would leave it behind.
  try {
    const { data: objects } = await admin.storage
      .from("user-uploads")
      .list(uid, { limit: 1000 });
    if (objects?.length) {
      await admin.storage
        .from("user-uploads")
        .remove(objects.map((o) => `${uid}/${o.name}`));
    }
  } catch (e) {
    console.error("[delete-account] storage purge failed", uid, e);
    return json({ error: "storage_purge_failed" }, 500);
  }

  // 2. Pre-null the four RESTRICT foreign keys that would block the cascade
  //    for a privileged user. All nullable; a plain shopper has none set.
  const preClear: Array<[string, string]> = [
    ["become_creator_requests", "reviewed_by"],
    ["brand_invites", "invited_by"],
    ["brand_invites", "accepted_user_id"],
    ["brand_members", "invited_by"],
  ];
  for (const [table, col] of preClear) {
    const { error } = await admin.from(table).update({ [col]: null }).eq(
      col,
      uid,
    );
    if (error) {
      console.error(
        `[delete-account] pre-clear ${table}.${col} failed`,
        uid,
        error,
      );
      return json({ error: "preclear_failed" }, 500);
    }
  }

  // 3. Delete the auth user. profiles cascades from auth.users and 18 tables
  //    cascade from there, so this wipes the rest of the account.
  const { error: delErr } = await admin.auth.admin.deleteUser(uid);
  if (delErr) {
    console.error("[delete-account] auth delete failed", uid, delErr);
    return json({ error: "auth_delete_failed" }, 500);
  }

  return json({ ok: true });
});
