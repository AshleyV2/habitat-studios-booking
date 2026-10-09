import type { MeResponse, Permission } from '@habitat/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, ApiError, SESSION_EXPIRED_EVENT } from '../api/client';

interface AuthState {
  me: MeResponse | null;
  loading: boolean;
  sessionExpired: boolean;
  can: (p: Permission) => boolean;
  setMe: (me: MeResponse | null) => void;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [sessionExpired, setExpired] = useState(false);
  const query = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return await api.get<MeResponse>('/api/me');
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    staleTime: 5 * 60_000,
  });
  const setMe = useCallback(
    (me: MeResponse | null) => {
      if (me) setExpired(false);
      qc.removeQueries({ predicate: (q) => String(q.queryKey[0]).startsWith('admin') });
      qc.setQueryData(['me'], me);
    },
    [qc],
  );
  useEffect(() => {
    const onExpired = () => {
      if (qc.getQueryData(['me'])) setExpired(true);
      setMe(null);
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, [qc, setMe]);
  const logout = useCallback(async () => {
    try {
      await api.post('/api/auth/logout');
    } finally {
      setMe(null);
    }
  }, [setMe]);
  const me = query.data ?? null;
  const value = useMemo<AuthState>(
    () => ({ me, loading: query.isPending, sessionExpired, can: (p) => Boolean(me?.permissions.includes(p)), setMe, logout }),
    [me, query.isPending, sessionExpired, setMe, logout],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth outside AuthProvider');
  return c;
}
