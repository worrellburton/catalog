// supabase/functions/clerk-webhook/index.ts
//
// Phase 4 — keep `profiles` in sync with Clerk so the admin user list stays
// current after the Supabase-Auth -> Clerk cutover. The Clerk<->Supabase
// integration deliberately does NOT sync user records, and the old trigger on
// auth.users no longer fires (users are born in Clerk), so this webhook is what
// creates/updates/deletes the profile row admin reads.
//
// Invariant it maintains: profiles.id == the user's `app_uid` == Clerk
// external_id (the preserved Supabase UUID for migrated users; a freshly minted
// UUID for native signups, which we also write back to Clerk as external_id so
// their session token's app_uid claim resolves to the same value). This is what
// lets RLS and every user_id FK keep matching.
//
// Deploy: supabase functions deploy clerk-webhook  (or the Supabase MCP).
// Point a Clerk webhook (user.created, user.updated, user.deleted) at its URL.
// Secrets required:
//   CLERK_WEBHOOK_SECRET        svix signing secret (whsec_…) for this endpoint
//   CLERK_SECRET_KEY            to set external_id on native signups
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY   (injected by the platform)
//
// NOTE: Clerk webhooks send their own svix signature, not a Supabase JWT, so
// this function must be deployed with --no-verify-jwt.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { Webhook } from 'https://esm.sh/svix@1';

const CLERK_API = 'https://api.clerk.com/v1';

interface ClerkEmail { id: string; email_address: string }
interface ClerkExternalAccount { provider?: string }
interface ClerkUserData {
  id: string;
  external_id: string | null;
  primary_email_address_id?: string | null;
  email_addresses?: ClerkEmail[];
  first_name?: string | null;
  last_name?: string | null;
  username?: string | null;
  image_url?: string | null;
  external_accounts?: ClerkExternalAccount[];
}
interface ClerkEvent { type: string; data: ClerkUserData }

function primaryEmail(d: ClerkUserData): string | null {
  const list = d.email_addresses ?? [];
  const primary = list.find((e) => e.id === d.primary_email_address_id) ?? list[0];
  return primary?.email_address?.toLowerCase() ?? null;
}

function displayName(d: ClerkUserData): string | null {
  const name = [d.first_name, d.last_name].filter(Boolean).join(' ').trim();
  return name || d.username || null;
}

function providerOf(d: ClerkUserData): string {
  // Clerk external account providers look like "oauth_google"; normalise to
  // "google" to match what the old Supabase trigger stored.
  const p = d.external_accounts?.[0]?.provider;
  return p ? p.replace(/^oauth_/, '') : 'email';
}

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  { auth: { persistSession: false } },
);

/** Ensure the user has an external_id (= app_uid). Migrated users already do;
 *  native signups don't, so mint a UUID and write it back to Clerk. */
async function ensureExternalId(d: ClerkUserData): Promise<string> {
  if (d.external_id) return d.external_id;
  const appUid = crypto.randomUUID();
  const res = await fetch(`${CLERK_API}/users/${d.id}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${Deno.env.get('CLERK_SECRET_KEY') ?? ''}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ external_id: appUid }),
  });
  if (!res.ok) {
    throw new Error(`set external_id failed: ${res.status} ${await res.text()}`);
  }
  return appUid;
}

async function upsertProfile(d: ClerkUserData): Promise<void> {
  const id = await ensureExternalId(d);
  // Only the Clerk-owned fields are written, so role / is_admin / gender keep
  // their table defaults on insert and are never clobbered on update.
  const { error } = await supabase.from('profiles').upsert(
    {
      id,
      clerk_user_id: d.id,
      email: primaryEmail(d),
      full_name: displayName(d),
      avatar_url: d.image_url ?? null,
      provider: providerOf(d),
    },
    { onConflict: 'id' },
  );
  if (error) throw new Error(`profiles upsert failed: ${error.message}`);
}

async function deleteProfile(d: ClerkUserData): Promise<void> {
  const { error } = await supabase.from('profiles').delete().eq('clerk_user_id', d.id);
  if (error) throw new Error(`profiles delete failed: ${error.message}`);
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const secret = Deno.env.get('CLERK_WEBHOOK_SECRET');
  if (!secret) return new Response('Webhook secret not configured', { status: 500 });

  const body = await req.text();
  let evt: ClerkEvent;
  try {
    evt = new Webhook(secret).verify(body, {
      'svix-id': req.headers.get('svix-id') ?? '',
      'svix-timestamp': req.headers.get('svix-timestamp') ?? '',
      'svix-signature': req.headers.get('svix-signature') ?? '',
    }) as ClerkEvent;
  } catch (err) {
    return new Response(`Invalid signature: ${err instanceof Error ? err.message : err}`, {
      status: 400,
    });
  }

  try {
    switch (evt.type) {
      case 'user.created':
      case 'user.updated':
        await upsertProfile(evt.data);
        break;
      case 'user.deleted':
        await deleteProfile(evt.data);
        break;
      default:
        // Not a user lifecycle event — ack so Clerk doesn't retry.
        return new Response('ignored', { status: 200 });
    }
  } catch (err) {
    // 5xx so Clerk retries with backoff (transient DB / Clerk API blips).
    return new Response(`handler error: ${err instanceof Error ? err.message : err}`, {
      status: 500,
    });
  }

  return new Response('ok', { status: 200 });
});
