import { useState, useEffect, useCallback } from 'react';
import { getCurrentUser, onAuthStateChange, signOut, type AuthUser } from '~/services/auth';

export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getCurrentUser().then((u) => {
      setUser(u);
      setLoading(false);
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
