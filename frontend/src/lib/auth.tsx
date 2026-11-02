import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api, tokens, type AuthResponse, type Role, type User } from "./api";
import { liveClient } from "./live-status";

export interface RegisterInput {
  email: string;
  full_name: string;
  password: string;
}

interface AuthState {
  user: User | null;
  /** True once the initial session check has finished. */
  ready: boolean;
  permissions: string[];
  login: (email: string, password: string) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
  /** One-click demo sign-in as the seeded administrator. */
  demoLogin: () => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  can: (permission: string) => boolean;
  isRole: (...roles: Role[]) => boolean;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [ready, setReady] = useState(false);

  const applySession = useCallback((accessToken: string, refreshToken: string, next: User | null) => {
    tokens.set(accessToken, refreshToken);
    liveClient.setToken(accessToken);
    setUser(next);
  }, []);

  const clearSession = useCallback(() => {
    tokens.clear();
    liveClient.setToken(null);
    setUser(null);
    setPermissions([]);
  }, []);

  const refreshUser = useCallback(async () => {
    if (!tokens.access) {
      setUser(null);
      return;
    }
    try {
      const me = await api.get<User>("/auth/me");
      setUser(me);
    } catch {
      clearSession();
    }
  }, [clearSession]);

  // Restore the session on first load.
  useEffect(() => {
    void (async () => {
      if (tokens.access) {
        liveClient.setToken(tokens.access);
        await refreshUser();
      }
      setReady(true);
    })();
  }, [refreshUser]);

  const login = useCallback(
    async (email: string, password: string) => {
      const data = await api.post<AuthResponse>(
        "/auth/login",
        { email, password },
        { skipRefresh: true },
      );
      applySession(data.access_token, data.refresh_token, data.user);
    },
    [applySession],
  );

  const register = useCallback(
    async (input: RegisterInput) => {
      const data = await api.post<AuthResponse>("/auth/register", input, { skipRefresh: true });
      applySession(data.access_token, data.refresh_token, data.user);
    },
    [applySession],
  );

  const demoLogin = useCallback(async () => {
    await login("admin@deploysphere.dev", "Admin!2345");
  }, [login]);

  const logout = useCallback(async () => {
    try {
      if (tokens.access) await api.post("/auth/logout");
    } catch {
      /* token may already be invalid; clear locally either way */
    }
    clearSession();
  }, [clearSession]);

  const value = useMemo<AuthState>(
    () => ({
      user,
      ready,
      permissions,
      login,
      register,
      demoLogin,
      logout,
      refreshUser,
      can: (permission: string) => permissions.includes(permission),
      isRole: (...roles: Role[]) => Boolean(user && roles.includes(user.role)),
    }),
    [user, ready, permissions, login, register, demoLogin, logout, refreshUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
