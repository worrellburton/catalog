// Per-creator catalog theme. A creator picks light or dark for their own
// catalog (their CreatorPage); every viewer then sees that catalog in the
// chosen theme. Backed by creators.catalog_theme (migration
// 20260601000011). NULL = the app default (dark).

import { supabase } from '~/utils/supabase';

export type CatalogTheme = 'light' | 'dark';

/** Read a creator's chosen catalog theme by handle. Returns null when the
 *  creator hasn't set one (caller treats null as the default dark). */
export async function getCreatorTheme(handle: string): Promise<CatalogTheme | null> {
  if (!supabase || !handle) return null;
  const { data } = await supabase
    .from('creators')
    .select('catalog_theme')
    .eq('handle', handle)
    .maybeSingle();
  const t = (data as { catalog_theme?: string | null } | null)?.catalog_theme;
  return t === 'light' || t === 'dark' ? t : null;
}

/** Set the signed-in creator's own catalog theme. The RLS policy only
 *  allows updating one's own creators row (id = auth.uid()). */
export async function setMyCatalogTheme(theme: CatalogTheme): Promise<{ ok: boolean }> {
  if (!supabase) return { ok: false };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false };
  const { error } = await supabase
    .from('creators')
    .update({ catalog_theme: theme })
    .eq('id', user.id);
  return { ok: !error };
}

/** Read the signed-in creator's own catalog theme (for the MyLooks toggle
 *  initial state). Defaults to 'dark' when unset. */
export async function getMyCatalogTheme(): Promise<CatalogTheme> {
  if (!supabase) return 'dark';
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return 'dark';
  const { data } = await supabase
    .from('creators')
    .select('catalog_theme')
    .eq('id', user.id)
    .maybeSingle();
  const t = (data as { catalog_theme?: string | null } | null)?.catalog_theme;
  return t === 'light' ? 'light' : 'dark';
}
