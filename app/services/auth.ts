import { supabase } from '~/utils/supabase';
import type { UserRole } from '~/types/roles';
import { inferUserGenderFromName } from './genders';

// Lightweight diagnostic logger for the SSO flow. Toggled on whenever
// the URL contains ?auth-debug=1, or persistently if 'auth:debug' is
// set in localStorage. Emits structured lines so flakey users can
// open Safari Web Inspector → Console and copy them straight into a
// bug report. Stays silent otherwise to keep prod logs clean.
//
// Things to look for in the trace:
//   • Did SIGNED_IN ever fire after the redirect, or did the page mount
//     with no session at all? (PKCE exchange failed.)
//   • Is the session restored on next pageload, or is the session
//     cleared between visits? (Safari ITP nuked storage.)
//   • Does TOKEN_REFRESHED loop without SIGNED_IN? (Expired refresh
//     token; supabase-js can't promote it.)
const AUTH_DEBUG = (() => {
  if (typeof window === 'undefined') return false;
  if (window.location.search.includes('auth-debug=1')) {
    try { localStorage.setItem('auth:debug', '1'); } catch { /* */ }
    return true;
  }
  try { return localStorage.getItem('auth:debug') === '1'; } catch { return false; }
})();

function authLog(...args: unknown[]) {
  if (!AUTH_DEBUG) return;
  // eslint-disable-next-line no-console
  console.log('[auth]', new Date().toISOString().slice(11, 23), ...args);
}

if (AUTH_DEBUG && typeof window !== 'undefined') {
  authLog('debug-enabled', {
    href: window.location.href,
    hasCode: window.location.search.includes('code='),
    hasAccessToken: window.location.hash.includes('access_token'),
    hasErrorDesc: window.location.search.includes('error_description='),
    userAgent: navigator.userAgent,
  });
}

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
  authLog('signInWithGoogle:start', { redirectTo });

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

  if (error) authLog('signInWithGoogle:error', error.message);
  return { error: error?.message };
}

// sessionStorage cache for the resolved AuthUser. The Supabase session
// itself is already persisted in localStorage by supabase-js, so the
// only actual round trip in getCurrentUser is the profiles row lookup
// for role/gender. Caching the resolved AuthUser for an hour means
// returning visitors (and any client navigation that re-mounts the
// auth singleton) skip that query entirely. Invalidated on every
// onAuthStateChange tick — see below.
const AUTH_CACHE_KEY = 'auth_cache:user:v1';
const AUTH_CACHE_TTL_MS = 60 * 60 * 1000;

interface CachedAuth { user: AuthUser; userId: string; t: number; }

function readAuthCache(userId: string): AuthUser | null {
  try {
    const raw = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(AUTH_CACHE_KEY) : null;
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedAuth;
    if (parsed.userId !== userId) return null;
    if (Date.now() - parsed.t > AUTH_CACHE_TTL_MS) return null;
    return parsed.user;
  } catch { return null; }
}

function writeAuthCache(user: AuthUser): void {
  try {
    if (typeof sessionStorage === 'undefined') return;
    const entry: CachedAuth = { user, userId: user.id, t: Date.now() };
    sessionStorage.setItem(AUTH_CACHE_KEY, JSON.stringify(entry));
  } catch { /* quota or private mode */ }
}

function clearAuthCache(): void {
  try { sessionStorage?.removeItem(AUTH_CACHE_KEY); } catch { /* */ }
}

export async function getCurrentUser(): Promise<AuthUser | null> {
  if (!supabase) {
    authLog('getCurrentUser:no-supabase');
    return null;
  }

  // Use getSession (local-storage read) instead of getUser (network call to
  // /user). The /user endpoint occasionally 500s when Supabase Auth can't
  // reach Postgres, which made the SPA think the user wasn't signed in and
  // re-render the locked view — so users would click "Sign in with Google"
  // 2-3 times. The PKCE code exchange already populated the session at this
  // point, so reading from storage is enough.
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) {
    authLog('getCurrentUser:no-session');
    clearAuthCache();
    return null;
  }

  // Fast path: same user as last visit, cache fresh — return without the
  // profiles round trip.
  const cached = readAuthCache(session.user.id);
  if (cached) {
    authLog('getCurrentUser:cache-hit', { id: session.user.id });
    return cached;
  }
  authLog('getCurrentUser:session-found', { id: session.user.id });

  const authUser = mapUser(session.user);

  try {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role, gender, full_name')
      .eq('id', session.user.id)
      .single();
    if (profile?.role) {
      authUser.role = profile.role as UserRole;
    }
    // First-load gender backfill: if the profile has a name but no
    // gender signal, infer once from the first name and persist.
    // Idempotent — short-circuits as soon as the column has 'male' or
    // 'female', so steady-state this is one extra column on the read
    // above and nothing else.
    if (profile && profile.gender !== 'male' && profile.gender !== 'female') {
      const fullName = (profile.full_name as string | null) ?? authUser.displayName ?? null;
      const inferred = inferUserGenderFromName(fullName);
      if (inferred !== 'unknown') {
        void supabase.from('profiles').update({ gender: inferred }).eq('id', session.user.id);
      }
    }
  } catch {
    // role column may not exist yet
  }

  writeAuthCache(authUser);
  return authUser;
}

export async function signOut(): Promise<void> {
  if (!supabase) return;
  clearAuthCache();
  await supabase.auth.signOut();
}

export function onAuthStateChange(callback: (user: AuthUser | null) => void) {
  if (!supabase) return { unsubscribe: () => {} };

  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    authLog('onAuthStateChange', event, { hasSession: !!session, userId: session?.user?.id });
    if (!session?.user) {
      clearAuthCache();
      callback(null);
      return;
    }
    // Auth state ticked — purge the resolved-user cache so the next
    // getCurrentUser() refetches role/gender. Most ticks (token refresh)
    // don't actually change anything user-visible, so the consumer's
    // useAuth singleton de-dupes via its own snapshot equality check.
    clearAuthCache();
    callback(mapUser(session.user));
  });

  return { unsubscribe: () => data.subscription.unsubscribe() };
}
