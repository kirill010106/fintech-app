import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { api, setUnauthorizedHandler, tokenStore } from '../api';
import type { Account, FamilyInfo, RegisterPayload, User } from '../types';

export type AuthStatus = 'loading' | 'authenticated' | 'anonymous';

interface AuthContextValue {
  status: AuthStatus;
  user: User | null;
  accounts: Account[];
  family: FamilyInfo | null;
  token: string | null;
  login: (email: string, password: string) => Promise<void>;
  register: (payload: RegisterPayload) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  updateProfile: (name: string, phone: string) => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // With no stored token there is nothing to restore, so start out signed out
  // instead of toggling the status from inside an effect.
  const [status, setStatus] = useState<AuthStatus>(() =>
    tokenStore.get() ? 'loading' : 'anonymous',
  );
  const [user, setUser] = useState<User | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [family, setFamily] = useState<FamilyInfo | null>(null);
  const [token, setToken] = useState<string | null>(() => tokenStore.get());

  /** Guards against a slow bootstrap overwriting a newer sign-in. */
  const generation = useRef(0);

  const applySession = useCallback(
    (payload: { user: User; accounts?: Account[]; family?: FamilyInfo | null }) => {
      setUser(payload.user);
      setAccounts(Array.isArray(payload.accounts) ? payload.accounts : []);
      setFamily(payload.family ?? null);
      setStatus('authenticated');
    },
    [],
  );

  const clearSession = useCallback(() => {
    tokenStore.clear();
    setToken(null);
    setUser(null);
    setAccounts([]);
    setFamily(null);
    setStatus('anonymous');
  }, []);

  // An expired or revoked token anywhere in the app drops us back to the sign-in screen.
  useEffect(() => {
    setUnauthorizedHandler(clearSession);
    return () => setUnauthorizedHandler(null);
  }, [clearSession]);

  // Restore the session on page load.
  useEffect(() => {
    if (!tokenStore.get()) return;

    const current = ++generation.current;

    api
      .getMe()
      .then((payload) => {
        if (generation.current === current) applySession(payload);
      })
      .catch(() => {
        if (generation.current === current) clearSession();
      });
  }, [applySession, clearSession]);

  const login = useCallback(
    async (email: string, password: string) => {
      const result = await api.login(email, password);
      generation.current += 1;
      tokenStore.set(result.access_token);
      setToken(result.access_token);
      applySession(result);
    },
    [applySession],
  );

  const register = useCallback(
    async (payload: RegisterPayload) => {
      const result = await api.register(payload);
      generation.current += 1;
      tokenStore.set(result.access_token);
      setToken(result.access_token);
      applySession(result);
    },
    [applySession],
  );

  const logout = useCallback(async () => {
    generation.current += 1;
    await api.logout();
    clearSession();
  }, [clearSession]);

  const refresh = useCallback(async () => {
    const payload = await api.getMe();
    applySession(payload);
  }, [applySession]);

  const updateProfile = useCallback(
    async (name: string, phone: string) => {
      const payload = await api.updateProfile({ name, phone });
      applySession(payload);
    },
    [applySession],
  );

  const changePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    await api.changePassword(currentPassword, newPassword);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      accounts,
      family,
      token,
      login,
      register,
      logout,
      refresh,
      updateProfile,
      changePassword,
    }),
    [
      status,
      user,
      accounts,
      family,
      token,
      login,
      register,
      logout,
      refresh,
      updateProfile,
      changePassword,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextValue => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
};
