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
 */

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
  if (!supabase) throw new Error('Supabase not configured');

  // Functions invoke uses the caller's JWT automatically, which the
  // edge function reads to verify the caller is an admin before
  // provisioning anything.
  const { data, error } = await supabase.functions.invoke<{ success: boolean; user_id?: string; error?: string }>(
    'create-ai-user',
    { body: input },
  );

  if (error) throw new Error(error.message || 'create-ai-user invoke failed');
  if (!data?.success || !data.user_id) {
    throw new Error(data?.error || 'create-ai-user returned no user_id');
  }
  return { user_id: data.user_id };
}
