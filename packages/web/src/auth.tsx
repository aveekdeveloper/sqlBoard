import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  api,
  getStoredUser,
  getToken,
  setStoredUser,
  type SessionUser,
} from './api/client.js';

interface AuthState {
  user: SessionUser | null;
  loading: boolean;
  role: SessionUser['role'] | null;
  canWrite: boolean;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(() => getStoredUser());
  const [loading, setLoading] = useState(() => Boolean(getToken()));

  const refresh = useCallback(async () => {
    if (!getToken()) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const me = await api.me();
      setUser(me);
      setStoredUser(me);
    } catch {
      // request() clears the session and redirects on 401.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo<AuthState>(
    () => ({
      user,
      loading,
      role: user?.role ?? null,
      canWrite: Boolean(user) && user?.role !== 'viewer',
      refresh,
    }),
    [user, loading, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>');
  return value;
}
