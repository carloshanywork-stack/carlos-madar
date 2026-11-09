import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  api,
  bootstrapSession,
  setAccessToken,
  setTokenListener,
  type AuthResponse,
  type MfaChallengeResponse,
  type RegisterResponse,
  type User,
  type Workspace,
} from './api';

type SessionStatus = 'loading' | 'anonymous' | 'authenticated';

interface SessionState {
  status: SessionStatus;
  user: User | null;
  workspaces: Workspace[];
}

export type LoginResult =
  | { mfaRequired: false }
  | { mfaRequired: true; challengeToken: string };

interface SessionContextValue extends SessionState {
  login: (email: string, password: string) => Promise<LoginResult>;
  completeMfa: (challengeToken: string, code: string) => Promise<void>;
  register: (input: {
    email: string;
    password: string;
    displayName: string;
    workspaceName: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
  refreshWorkspaces: () => Promise<void>;
  addWorkspace: (workspace: Workspace) => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({
    status: 'loading',
    user: null,
    workspaces: [],
  });

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const session = await bootstrapSession();
      if (cancelled) return;

      if (!session) {
        setState({ status: 'anonymous', user: null, workspaces: [] });
        return;
      }

      try {
        const workspaces = await api<Workspace[]>('/workspaces');
        if (cancelled) return;
        setState({ status: 'authenticated', user: session.user, workspaces });
      } catch {
        if (!cancelled) setState({ status: 'anonymous', user: null, workspaces: [] });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setTokenListener((token) => {
      if (!token) {
        setState({ status: 'anonymous', user: null, workspaces: [] });
      }
    });
    return () => setTokenListener(null);
  }, []);

  const loadWorkspaces = useCallback(async (): Promise<Workspace[]> => {
    return api<Workspace[]>('/workspaces');
  }, []);

  const login = useCallback(
    async (email: string, password: string): Promise<LoginResult> => {
      const session = await api<AuthResponse | MfaChallengeResponse>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });

      if ('mfaRequired' in session && session.mfaRequired) {
        return { mfaRequired: true, challengeToken: session.challengeToken };
      }

      const workspaces = await loadWorkspaces();
      setState({ status: 'authenticated', user: session.user, workspaces });
      return { mfaRequired: false };
    },
    [loadWorkspaces],
  );

  const completeMfa = useCallback(
    async (challengeToken: string, code: string): Promise<void> => {
      const session = await api<AuthResponse>('/auth/mfa/verify', {
        method: 'POST',
        body: JSON.stringify({ challengeToken, code }),
      });
      const workspaces = await loadWorkspaces();
      setState({ status: 'authenticated', user: session.user, workspaces });
    },
    [loadWorkspaces],
  );

  const register = useCallback(
    async (input: {
      email: string;
      password: string;
      displayName: string;
      workspaceName: string;
    }): Promise<void> => {
      const session = await api<RegisterResponse>('/auth/register', {
        method: 'POST',
        body: JSON.stringify(input),
      });
      const workspaces = await loadWorkspaces();
      setState({ status: 'authenticated', user: session.user, workspaces });
    },
    [loadWorkspaces],
  );

  const logout = useCallback(async (): Promise<void> => {
    try {
      await api('/auth/logout', { method: 'POST' });
    } catch {
      // Local session is cleared even if the server is unreachable.
    }
    setAccessToken(null);
    setState({ status: 'anonymous', user: null, workspaces: [] });
  }, []);

  const refreshWorkspaces = useCallback(async (): Promise<void> => {
    const workspaces = await loadWorkspaces();
    setState((previous) => ({ ...previous, workspaces }));
  }, [loadWorkspaces]);

  const addWorkspace = useCallback((workspace: Workspace) => {
    setState((previous) => ({ ...previous, workspaces: [workspace, ...previous.workspaces] }));
  }, []);

  const value = useMemo<SessionContextValue>(
    () => ({
      ...state,
      login,
      completeMfa,
      register,
      logout,
      refreshWorkspaces,
      addWorkspace,
    }),
    [state, login, completeMfa, register, logout, refreshWorkspaces, addWorkspace],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext);
  if (!context) throw new Error('useSession must be used inside SessionProvider.');
  return context;
}
