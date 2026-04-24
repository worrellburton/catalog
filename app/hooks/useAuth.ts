import { useState, useEffect, useCallback } from 'react';
import { getCurrentUser, onAuthStateChange, signOut, type AuthUser } from '~/services/auth';

export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // If we just landed from an OAuth redirect (PKCE adds `?code=` and an
    // implicit/Apple flow drops `#access_token=`), supabase-js is mid-way
    // through exchanging the code for a session. Don't resolve `loading`
    // from the initial getSession call — that race is what made the locked
    // view flash and prompted users to click sign-in 2-3 times. The
    // SIGNED_IN event from onAuthStateChange will arrive within a second.
    const url = window.location.href;
    const isOAuthReturn =
      url.includes('code=') ||
      url.includes('access_token=') ||
      url.includes('error_description=');

    getCurrentUser().then((u) => {
      setUser(u);
      if (!isOAuthReturn) setLoading(false);
    });

    const { unsubscribe } = onAuthStateChange((u) => {
      setUser(u);
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  const logout = useCallback(async () => {
    await signOut();
    setUser(null);
  }, []);

  return { user, loading, logout };
}
