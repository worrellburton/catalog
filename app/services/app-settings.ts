import { supabase } from '~/utils/supabase';

/**
 * Generic read/write helpers for the platform-wide `app_settings` table.
 * The admin Prompts page uses this to surface and update the foundational
 * style prompt; the consumer-side reads happen inside edge functions which
 * use service-role.
 */
export async function getAppSetting(key: string): Promise<string | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('app_settings').select('value').eq('key', key).maybeSingle();
  if (error) {
    console.error('[getAppSetting]', key, error.message);
    return null;
  }
  return (data?.value as string | null) ?? null;
}

export async function setAppSetting(
  key: string,
  value: string,
): Promise<{ error: string | null }> {
  if (!supabase) return { error: 'Supabase not configured' };
  const { error } = await supabase
    .from('app_settings')
    .upsert({ key, value, updated_at: new Date().toISOString() });
  return { error: error?.message ?? null };
}

/** Default for the Style page when the row hasn't been created yet. */
export const DEFAULT_STYLE_PROMPT =
  "Make a style reference sheet for this {{gender}}, {{name}}, height {{height}} {{age}} years old, show amazing outfits {{pronoun}} can wear on {{occasion}}, but {{pronoun}}'s not trying too hard. Photo realistic. Don't show text";

export const STYLE_PROMPT_KEY = 'style_prompt';
