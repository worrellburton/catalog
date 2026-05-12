import { useCallback, useSyncExternalStore } from 'react';
import { getCurrentUser, onAuthStateChange, signOut, type AuthUser } from '~/services/auth';

// Singleton auth store. The previous implementation had each component spin
// up its own getCurrentUser() promise and its own onAuthStateChange
// subscription - fine with a handful of consumers, but the consumer feed
// renders 50–200 LookCard/CreativeCard tiles that each call useAuth(),
// which meant 50–200 redundant auth checks on every mount. This module
// runs the bootstrap once and lets every caller subscribe to the same
// state via useSyncExternalStore.

interface AuthState {
  user: AuthUser | null;
  loading: boolean;
}

let state: AuthState = { user: null, loading: true };
const listeners = new Set<() => void>();
let bootstrapped = false;

function setState(next: AuthState) {
  // Bail if nothing changed - prevents re-renders when auth ticks but the
  // user identity is stable (common during token refresh).
  if (state.user === next.user && state.loading === next.loading) return;
  state = next;
  for (const l of listeners) l();
}

// Exposed so _index.tsx can decide whether to render the password gate or a
// "Signing you in…" overlay during the OAuth callback race window.
export function isOAuthReturn(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.location.search.includes('code=') ||
    window.location.hash.includes('access_token=') ||
    window.location.search.includes('error_description=')
  );
}

function bootstrap() {
  if (bootstrapped) return;
  bootstrapped = true;

  // OAuth-return guard: if we landed from a Supabase OAuth redirect, the
  // SIGNED_IN event will arrive shortly - don't flip loading=false off the
  // initial getSession() call or the password gate flashes for a tick.
  const fromOAuth = isOAuthReturn();

  getCurrentUser().then((u) => {
    setState({ user: u, loading: fromOAuth ? state.loading : false });
  });

  onAuthStateChange((u) => {
    if (!u) {
      setState({ user: null, loading: false });
      return;
    }
    // auth.ts clears the cache before calling this callback, so
    // getCurrentUser() here will re-fetch the role from the profiles
    // table rather than returning a stale cache hit. This ensures role
    // is always correct after sign-in, token refresh, or any other
    // auth state event (not just the initial bootstrap call above).
    getCurrentUser().then((fullUser) => {
      setState({ user: fullUser, loading: false });
    });
  });

  // Fallback: if we're in an OAuth return state and SIGNED_IN never fires
  // (network blip, expired state token, Safari ITP killed storage, etc.),
  // give up after 6 seconds and let loading=false so the user can retry
  // sign-in instead of being stuck on a "Signing in…" spinner forever.
  if (fromOAuth && typeof window !== 'undefined') {
    window.setTimeout(() => {
      if (state.loading) setState({ user: null, loading: false });
    }, 6000);
  }
}

function subscribe(listener: () => void) {
  bootstrap();
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function getSnapshot(): AuthState { return state; }
function getServerSnapshot(): AuthState { return { user: null, loading: true }; }

export function useAuth() {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const logout = useCallback(async () => {
    await signOut();
    setState({ user: null, loading: false });
  }, []);
  return { user: snap.user, loading: snap.loading, logout };
}
