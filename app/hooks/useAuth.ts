import { useCallback, useSyncExternalStore } from 'react';
import { getCurrentUser, onAuthStateChange, signOut, type AuthUser } from '~/services/auth';

// Singleton auth store. The previous implementation had each component spin
// up its own getCurrentUser() promise and its own onAuthStateChange
// subscription — fine with a handful of consumers, but the consumer feed
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
  // Bail if nothing changed — prevents re-renders when auth ticks but the
  // user identity is stable (common during token refresh).
  if (state.user === next.user && state.loading === next.loading) return;
  state = next;
  for (const l of listeners) l();
}

function bootstrap() {
  if (bootstrapped) return;
  bootstrapped = true;

  // Same OAuth-return guard as before: if we landed from a Supabase OAuth
  // redirect, the SIGNED_IN event will arrive shortly — don't flip
  // loading=false off the initial getSession() call or the locked screen
  // flashes for a tick.
  const url = typeof window !== 'undefined' ? window.location.href : '';
  const isOAuthReturn =
    url.includes('code=') ||
    url.includes('access_token=') ||
    url.includes('error_description=');

  getCurrentUser().then((u) => {
    setState({ user: u, loading: isOAuthReturn ? state.loading : false });
  });

  onAuthStateChange((u) => {
    setState({ user: u, loading: false });
  });
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
