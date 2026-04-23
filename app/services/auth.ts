import { supabase } from '~/utils/supabase';
import type { UserRole } from '~/types/roles';

export interface AuthUser {
  id: string;
  email?: string;
  phone?: string;
  displayName?: string;
  avatarUrl?: string;
  role?: UserRole;
}

function mapUser(user: { id: string; email?: string; phone?: string; user_metadata?: Record<string, string> }): AuthUser {
  return {
    id: user.id,
    email: user.email,
    phone: user.phone,
    displayName: user.user_metadata?.full_name || user.user_metadata?.name || user.email || user.phone,
    avatarUrl: user.user_metadata?.avatar_url || user.user_metadata?.picture,
  };
}

export async function signInWithGoogle(): Promise<{ error?: string }> {
  if (!supabase) return { error: 'Supabase not configured' };

  // Use the currently-loaded URL (minus any hash) as the redirect target.
  // This is the most reliable on mobile Safari: the URL is guaranteed to
  // match whatever the user is on, including the correct base path on
  // GitHub Pages (/catalog/) and Vercel (/). Bare window.location.origin
  // drops paths and sometimes mismatches Supabase's allowed-redirects
  // wildcard, which surfaces as "Safari cannot open the page because the
  // address is invalid." after the Google consent screen.
  const redirectTo = window.location.href.split('#')[0];

  // Drop the `prompt: 'consent'` + `access_type: 'offline'` flags. We
  // don't use refresh tokens for anything, and forcing consent on every
  // sign-in triggers a second Google screen that mobile Safari ITP
  // sometimes breaks mid-redirect.
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo,
    },
  });

  return { error: error?.message };
}

export async function sendPhoneOtp(phone: string): Promise<{ error?: string }> {
  if (!supabase) return { error: 'Supabase not configured' };

  const { error } = await supabase.auth.signInWithOtp({
    phone,
  });

  return { error: error?.message };
}

export async function verifyPhoneOtp(phone: string, token: string): Promise<{ user?: AuthUser; error?: string }> {
  if (!supabase) return { error: 'Supabase not configured' };

  const { data, error } = await supabase.auth.verifyOtp({
    phone,
    token,
    type: 'sms',
  });

  if (error || !data.user) return { error: error?.message || 'Verification failed' };
  return { user: mapUser(data.user) };
}

export async function getCurrentUser(): Promise<AuthUser | null> {
  if (!supabase) return null;

  const { data } = await supabase.auth.getUser();
  if (!data.user) return null;
  const authUser = mapUser(data.user);

  try {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', data.user.id)
      .single();
    if (profile?.role) {
      authUser.role = profile.role as UserRole;
    }
  } catch {
    // role column may not exist yet
  }

  return authUser;
}

export async function signOut(): Promise<void> {
  if (!supabase) return;
  await supabase.auth.signOut();
}

export function onAuthStateChange(callback: (user: AuthUser | null) => void) {
  if (!supabase) return { unsubscribe: () => {} };

  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    callback(session?.user ? mapUser(session.user) : null);
  });

  return { unsubscribe: () => data.subscription.unsubscribe() };
}
