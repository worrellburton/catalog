import { supabase } from '~/utils/supabase';
import type { UserRole } from '~/types/roles';

export interface Profile {
  id: string;
  email: string | null;
  full_name: string | null;
  avatar_url: string | null;
  provider: string | null;
  role: UserRole;
  is_admin: boolean;
  is_ai: boolean;
  gender: 'male' | 'female' | 'unknown';
  created_at: string;
  last_sign_in_at: string | null;
}

const PROFILE_SELECT = 'id, email, full_name, avatar_url, provider, role, is_admin, is_ai, gender, created_at, last_sign_in_at';

export async function getProfiles(): Promise<Profile[]> {
  if (!supabase) return [];
  // Try with the full column set first; fall back if older deploys
  // haven't run the role / is_admin migrations yet.
  let result = await supabase
    .from('profiles')
    .select(PROFILE_SELECT)
    .order('created_at', { ascending: false });
  if (result.error) {
    const fallback = await supabase
      .from('profiles')
      .select('id, email, full_name, avatar_url, provider, created_at, last_sign_in_at')
      .order('created_at', { ascending: false });
    if (fallback.error) {
      console.error('Failed to load profiles', fallback.error);
      return [];
    }
    result = fallback as unknown as typeof result;
  }
  const rows = (result.data || []) as unknown as Record<string, unknown>[];
  return rows.map(p => ({
    id: p.id as string,
    email: (p.email as string) || null,
    full_name: (p.full_name as string) || null,
    avatar_url: (p.avatar_url as string) || null,
    provider: (p.provider as string) || null,
    role: (p.role as UserRole) || 'shopper',
    is_admin: (p.is_admin as boolean) ?? (p.role === 'admin' || p.role === 'super_admin'),
    is_ai: (p.is_ai as boolean) === true,
    gender: ((p.gender as string) === 'male' || (p.gender as string) === 'female')
      ? (p.gender as 'male' | 'female')
      : 'unknown',
    created_at: p.created_at as string,
    last_sign_in_at: (p.last_sign_in_at as string) || null,
  }));
}

export async function getProfilesByRole(role: UserRole): Promise<Profile[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('profiles')
    .select(PROFILE_SELECT)
    .eq('role', role)
    .order('created_at', { ascending: false });
  if (error) {
    console.error(`Failed to load ${role} profiles`, error);
    return [];
  }
  return (data || []).map(p => {
    const g = (p as { gender?: string }).gender;
    return {
      ...p,
      role: p.role || 'shopper',
      is_admin: (p as { is_admin?: boolean }).is_admin ?? (p.role === 'admin' || p.role === 'super_admin'),
      is_ai: (p as { is_ai?: boolean }).is_ai === true,
      gender: (g === 'male' || g === 'female') ? g : 'unknown',
    };
  });
}

export async function deleteProfile(userId: string): Promise<{ error?: string }> {
  if (!supabase) return { error: 'Supabase not configured' };
  const { data, error } = await supabase
    .from('profiles')
    .delete()
    .eq('id', userId)
    .select('id');
  if (error) return { error: error.message };
  if (!data || data.length === 0) {
    return { error: 'Delete blocked by RLS. Sign in as an admin to remove profiles.' };
  }
  return {};
}

export async function updateUserRole(userId: string, role: UserRole): Promise<{ error?: string }> {
  if (!supabase) return { error: 'Supabase not configured' };
  const { data, error } = await supabase
    .from('profiles')
    .update({ role })
    .eq('id', userId)
    .select('id, role');
  if (error) return { error: error.message };
  if (!data || data.length === 0) {
    return { error: 'Update blocked by RLS. You must be signed in as admin/super_admin to change another user\'s role.' };
  }
  if (data[0].role !== role) {
    return { error: `Role did not persist (got ${data[0].role}, expected ${role}).` };
  }
  return {};
}

/**
 * Persist the shopper's height + age picks from /generate so the
 * wizard reopens prefilled and downstream pipelines have something
 * to reference. Mirrors updateUserGender's shape.
 */
export async function updateUserHeightAge(
  userId: string,
  patch: {
    heightCm?: number | null; heightLabel?: string | null;
    ageLabel?: string | null;
    weightKg?: number | null; weightLabel?: string | null;
    /** Advanced-mode body proportions + aesthetic, persisted verbatim. */
    armLengthLabel?: string | null;
    legLengthLabel?: string | null;
    fashionStyles?: string | null;
  },
): Promise<{ error?: string }> {
  if (!supabase) return { error: 'Supabase not configured' };
  const update: Record<string, number | string | null> = {};
  if (patch.heightCm !== undefined)    update.height_cm    = patch.heightCm;
  if (patch.heightLabel !== undefined) update.height_label = patch.heightLabel;
  if (patch.ageLabel !== undefined)    update.age_label    = patch.ageLabel;
  if (patch.weightKg !== undefined)    update.weight_kg    = patch.weightKg;
  if (patch.weightLabel !== undefined) update.weight_label = patch.weightLabel;
  if (patch.armLengthLabel !== undefined) update.arm_length_label = patch.armLengthLabel || null;
  if (patch.legLengthLabel !== undefined) update.leg_length_label = patch.legLengthLabel || null;
  if (patch.fashionStyles !== undefined)  update.fashion_styles   = patch.fashionStyles || null;
  if (Object.keys(update).length === 0) return {};
  const { error } = await supabase
    .from('profiles')
    .update(update)
    .eq('id', userId);
  if (error) return { error: error.message };
  return {};
}

/**
 * Upload a JPEG blob to the avatars bucket and patch profiles.avatar_url
 * to point at it. Returns the cache-busted public URL the caller should
 * render immediately.
 *
 * Path convention: avatars/<userId>/<timestamp>.jpg. The timestamp keeps
 * each upload unique so a re-upload doesn't get served from the
 * browser's cached previous avatar - and lets us delete prior avatars
 * later as a cleanup step without affecting the current one.
 */
export async function updateUserAvatar(
  userId: string,
  blob: Blob,
): Promise<{ url?: string; error?: string }> {
  if (!supabase) return { error: 'Supabase not configured' };
  const path = `${userId}/${Date.now()}.jpg`;
  const { error: upErr } = await supabase.storage
    .from('avatars')
    .upload(path, blob, {
      contentType: 'image/jpeg',
      cacheControl: 'public, max-age=31536000, immutable',
      upsert: false,
    });
  if (upErr) return { error: upErr.message };

  const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path);
  const url = urlData?.publicUrl ?? '';
  if (!url) return { error: 'Avatar upload succeeded but URL was empty.' };

  const { error: profErr } = await supabase
    .from('profiles')
    .update({ avatar_url: url })
    .eq('id', userId);
  if (profErr) return { error: profErr.message };

  // Mirror the URL onto auth.user.user_metadata so getCurrentUser()
  // can prefer it as a fast read. CRITICAL: supabase.auth.updateUser
  // always targets the CURRENT session — so we must only run it when
  // the upload target IS the signed-in user. Without this guard, an
  // admin uploading an avatar for an AI persona (or another user)
  // would have that URL silently overwritten onto their own auth
  // metadata, cross-contaminating avatars between accounts.
  try {
    const { data: { user: signedInUser } } = await supabase.auth.getUser();
    if (signedInUser?.id === userId) {
      await supabase.auth.updateUser({ data: { avatar_url: url } });
    }
  } catch {
    /* metadata write is non-critical - the profiles row is the
       source of truth and we already wrote that. */
  }

  return { url };
}

/** Read prior height + age + weight picks so the wizard re-opens prefilled. */
export async function getUserHeightAge(
  userId: string,
): Promise<{
  heightCm: number | null; heightLabel: string | null;
  ageLabel: string | null;
  weightKg: number | null; weightLabel: string | null;
  armLengthLabel: string | null; legLengthLabel: string | null;
  fashionStyles: string | null;
}> {
  const empty = {
    heightCm: null, heightLabel: null, ageLabel: null,
    weightKg: null, weightLabel: null,
    armLengthLabel: null, legLengthLabel: null, fashionStyles: null,
  };
  if (!supabase) return empty;
  const { data } = await supabase
    .from('profiles')
    .select('height_cm, height_label, age_label, weight_kg, weight_label, arm_length_label, leg_length_label, fashion_styles')
    .eq('id', userId)
    .maybeSingle();
  return {
    heightCm:    (data?.height_cm    as number | null) ?? null,
    heightLabel: (data?.height_label as string | null) ?? null,
    ageLabel:    (data?.age_label    as string | null) ?? null,
    weightKg:    (data?.weight_kg    as number | null) ?? null,
    weightLabel: (data?.weight_label as string | null) ?? null,
    armLengthLabel: (data?.arm_length_label as string | null) ?? null,
    legLengthLabel: (data?.leg_length_label as string | null) ?? null,
    fashionStyles:  (data?.fashion_styles   as string | null) ?? null,
  };
}

/**
 * The user's free-text "your style" descriptor (set on the Style page).
 * Persisted on profiles.custom_style_prompt and threaded into the
 * Seedance video prompt by buildGenerationPrompt so generated looks
 * reflect the user's personal aesthetic. Returns null when unset.
 */
export async function getUserCustomStyle(userId: string): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase
    .from('profiles')
    .select('custom_style_prompt')
    .eq('id', userId)
    .maybeSingle();
  const v = (data?.custom_style_prompt as string | null) ?? null;
  return v && v.trim() ? v.trim() : null;
}

/** Save (or clear, with an empty string) the user's custom style descriptor. */
export async function updateUserCustomStyle(
  userId: string,
  style: string,
): Promise<{ error?: string }> {
  if (!supabase) return { error: 'Supabase not configured' };
  const trimmed = style.trim();
  if (trimmed.length > 400) return { error: 'Style is too long (400 characters max)' };
  const { error } = await supabase
    .from('profiles')
    .update({ custom_style_prompt: trimmed || null })
    .eq('id', userId);
  if (error) return { error: error.message };
  return {};
}

/**
 * Update a profile's display name. Used by the AI persona editor on
 * /admin/user/<id> — the create form picks the initial name; admins
 * can rename a persona after the fact without round-tripping through
 * the create flow.
 */
export async function updateUserFullName(
  userId: string,
  fullName: string,
): Promise<{ error?: string }> {
  if (!supabase) return { error: 'Supabase not configured' };
  const trimmed = fullName.trim();
  if (!trimmed) return { error: 'Name cannot be empty' };
  const { error } = await supabase
    .from('profiles')
    .update({ full_name: trimmed })
    .eq('id', userId);
  if (error) return { error: error.message };
  return {};
}

/**
 * Look up the impersonation target for the /generate?as_user=<id>
 * flow. Returns the persona's id + display fields when the row exists
 * and `is_ai=true`; null when the id is unknown or the profile is a
 * real user. The RLS policies added in 20260521020000 mirror the gate
 * on `is_ai=true`, so attempting to impersonate a real user would
 * fail the writes anyway — this lookup just keeps the wizard from
 * pretending it's working before any rows are touched.
 */
export interface ImpersonationTarget {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  gender: 'male' | 'female' | 'unknown';
}

export async function getImpersonationTarget(
  userId: string,
): Promise<ImpersonationTarget | null> {
  if (!supabase) return null;
  const { data } = await supabase
    .from('profiles')
    .select('id, full_name, avatar_url, gender, is_ai')
    .eq('id', userId)
    .maybeSingle();
  if (!data || data.is_ai !== true) return null;
  const g = data.gender as string | null;
  return {
    id: data.id as string,
    full_name: (data.full_name as string) ?? null,
    avatar_url: (data.avatar_url as string) ?? null,
    gender: g === 'male' || g === 'female' ? (g as 'male' | 'female') : 'unknown',
  };
}

/**
 * Toggle the explicit admin flag on a profile. Source-of-truth for
 * the admin gate going forward; the Admins tab in /admin/users
 * filters on this column.
 */
export async function updateUserIsAdmin(
  userId: string,
  isAdmin: boolean,
): Promise<{ error?: string }> {
  if (!supabase) return { error: 'Supabase not configured' };
  const { data, error } = await supabase
    .from('profiles')
    .update({ is_admin: isAdmin })
    .eq('id', userId)
    .select('id, is_admin');
  if (error) return { error: error.message };
  if (!data || data.length === 0) {
    return { error: 'Update blocked by RLS. Sign in as an admin to toggle this.' };
  }
  if (data[0].is_admin !== isAdmin) {
    return { error: 'Toggle did not persist.' };
  }
  return {};
}
