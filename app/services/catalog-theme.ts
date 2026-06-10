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

// ── Catalog appearance: particle field + background hue ──────────────────────
// A creator customises their own catalog look; viewers of that creator's
// catalog (CreatorPage) see it. Backed by creators.catalog_particles +
// creators.catalog_hue.

export interface CatalogAppearance {
  particles: boolean;
  /** 0–360 hue, or null for the default (no tint). */
  hue: number | null;
}

export const DEFAULT_CATALOG_APPEARANCE: CatalogAppearance = { particles: true, hue: null };

function rowToAppearance(data: { catalog_particles?: boolean | null; catalog_hue?: number | null } | null): CatalogAppearance {
  if (!data) return DEFAULT_CATALOG_APPEARANCE;
  return {
    particles: data.catalog_particles !== false,
    hue: data.catalog_hue ?? null,
  };
}

/** Read a creator's appearance by handle (consumer CreatorPage). */
export async function getCreatorAppearance(handle: string): Promise<CatalogAppearance> {
  if (!supabase || !handle) return DEFAULT_CATALOG_APPEARANCE;
  const { data } = await supabase
    .from('creators')
    .select('catalog_particles, catalog_hue')
    .eq('handle', handle)
    .maybeSingle();
  return rowToAppearance(data as never);
}

/** Read a creator's appearance by user id (CreatorPage for `user:<uuid>`
 *  creators — My Catalog saves keyed by creators.id = auth.uid()). */
export async function getCreatorAppearanceById(userId: string): Promise<CatalogAppearance> {
  if (!supabase || !userId) return DEFAULT_CATALOG_APPEARANCE;
  const { data } = await supabase
    .from('creators')
    .select('catalog_particles, catalog_hue')
    .eq('id', userId)
    .maybeSingle();
  return rowToAppearance(data as never);
}

/** Read the signed-in creator's own appearance (My Catalog initial state). */
export async function getMyCatalogAppearance(): Promise<CatalogAppearance> {
  if (!supabase) return DEFAULT_CATALOG_APPEARANCE;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return DEFAULT_CATALOG_APPEARANCE;
  const { data } = await supabase
    .from('creators')
    .select('catalog_particles, catalog_hue')
    .eq('id', user.id)
    .maybeSingle();
  return rowToAppearance(data as never);
}

/** Persist the signed-in creator's appearance. */
export async function setMyCatalogAppearance(patch: Partial<CatalogAppearance>): Promise<{ ok: boolean }> {
  if (!supabase) return { ok: false };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false };
  const update: Record<string, unknown> = {};
  if (patch.particles !== undefined) update.catalog_particles = patch.particles;
  if (patch.hue !== undefined) update.catalog_hue = patch.hue;
  if (Object.keys(update).length === 0) return { ok: true };
  const { error } = await supabase.from('creators').update(update).eq('id', user.id);
  return { ok: !error };
}
