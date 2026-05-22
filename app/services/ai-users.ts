import { supabase } from '~/utils/supabase';

/**
 * Service wrapper for the create-ai-user edge function. The function
 * lives at supabase/functions/create-ai-user — it uses the service
 * role key to provision an auth.users row (which the
 * handle_auth_user_change trigger materializes a profile for) and
 * then patches the profile with is_ai=true + the supplied metadata.
 *
 * We can't do this from the browser directly because profiles.id
 * has a hard FK to auth.users(id) and creating auth users requires
 * the service role.
 *
 * We use raw fetch (not supabase.functions.invoke) so that when the
 * edge function returns a non-2xx, we still extract its response
 * body and surface the real error message instead of the generic
 * "Edge Function returned a non-2xx status code" supabase-js
 * substitutes in.
 */

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY as string | undefined;

export interface CreateAiUserInput {
  full_name: string;
  gender?: 'men' | 'women' | 'unisex' | null;
  height_cm?: number | null;
  height_label?: string | null;
  age_label?: string | null;
}

export interface CreateAiUserResult {
  user_id: string;
}

export async function createAiUser(input: CreateAiUserInput): Promise<CreateAiUserResult> {
  if (!supabase || !SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error('Supabase not configured');
  }

  // Pull the caller's JWT explicitly so the edge function's admin
  // gate can verify them. supabase.functions.invoke does this
  // automatically but eats non-2xx response bodies; raw fetch
  // exposes everything.
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;
  if (!token) throw new Error('Not signed in');

  const url = `${SUPABASE_URL}/functions/v1/create-ai-user`;
  let resp: Response;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'apikey': SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(input),
    });
  } catch (netErr) {
    throw new Error(`Network error calling create-ai-user: ${netErr instanceof Error ? netErr.message : String(netErr)}`);
  }

  // Try to parse JSON regardless of status code. Falls back to raw
  // text if the body isn't JSON (rare — Deno crash, edge runtime
  // throwing an HTML error page, etc.).
  let body: { success?: boolean; user_id?: string; error?: string } | null = null;
  let rawText = '';
  try { rawText = await resp.text(); } catch { /* noop */ }
  if (rawText) {
    try { body = JSON.parse(rawText); } catch { /* leave body null, rawText carries it */ }
  }

  if (!resp.ok && !body?.error) {
    throw new Error(`create-ai-user HTTP ${resp.status}: ${rawText.slice(0, 240) || resp.statusText || 'no response body'}`);
  }
  if (body?.error || body?.success === false) {
    throw new Error(body?.error || 'create-ai-user reported failure with no message');
  }
  if (!body?.user_id) {
    throw new Error('create-ai-user returned no user_id');
  }
  return { user_id: body.user_id };
}
