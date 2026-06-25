import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  fetchProfile,
  login as loginRequest,
  logout as logoutRequest,
  registerAccount,
  sendEmailOtp as sendEmailOtpRequest,
  updateProfile as updateProfileRequest,
  verifyEmailOtp as verifyEmailOtpRequest,
} from '../api/authApi';
import { onSessionCleared } from '../api/http';
import {
  clearTokens,
  getRefreshToken,
  hasStoredSession,
  setTokens,
} from '../lib/tokenStorage';
import type {
  AuthProfile,
  EmailOtpStatus,
  LoginInput,
  RegisterInput,
  UpdateProfileInput,
} from '../types';
import {
  AuthContext,
  type AuthContextValue,
  type AuthModalView,
} from './useAuth';

export function AuthProvider({ children }: { readonly children: ReactNode }) {
  const [user, setUser] = useState<AuthProfile | null>(null);
  const [initializing, setInitializing] = useState<boolean>(hasStoredSession());
  const [authModalView, setAuthModalView] = useState<AuthModalView | null>(null);
  const mounted = useRef(true);

  const loadProfile = useCallback(async (signal?: AbortSignal) => {
    try {
      const profile = await fetchProfile(signal);
      if (mounted.current) setUser(profile);
    } catch {
      // Token invalid/expired and refresh failed; treat as signed out.
      clearTokens();
      if (mounted.current) setUser(null);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();

    const bootstrap = async () => {
      if (hasStoredSession()) {
        await loadProfile(controller.signal);
      }
      if (mounted.current) setInitializing(false);
    };
    void bootstrap();

    const unsubscribe = onSessionCleared(() => {
      if (mounted.current) setUser(null);
    });

    return () => {
      mounted.current = false;
      controller.abort();
      unsubscribe();
    };
  }, [loadProfile]);

  const login = useCallback(
    async (input: LoginInput) => {
      const session = await loginRequest(input);
      setTokens({ accessToken: session.accessToken, refreshToken: session.refreshToken });
      await loadProfile();
    },
    [loadProfile],
  );

  const register = useCallback(
    async (input: RegisterInput) => {
      await registerAccount(input);
      // Registration does not issue tokens; immediately sign in for a smooth flow.
      await login({ email: input.email, password: input.password });
    },
    [login],
  );

  const logout = useCallback(async () => {
    const refreshToken = getRefreshToken();
    if (refreshToken) {
      try {
        await logoutRequest(refreshToken);
      } catch {
        // Best-effort server revoke; always clear locally below.
      }
    }
    clearTokens();
    setUser(null);
  }, []);

  const refreshProfile = useCallback(async () => {
    await loadProfile();
  }, [loadProfile]);

  const updateProfile = useCallback(async (input: UpdateProfileInput) => {
    const updated = await updateProfileRequest(input);
    if (mounted.current) setUser(updated);
  }, []);

  const sendEmailOtp = useCallback(async (): Promise<EmailOtpStatus> => {
    const result = await sendEmailOtpRequest();
    if (result.status === 'already_verified') {
      await loadProfile();
    }
    return result.status;
  }, [loadProfile]);

  const verifyEmailOtp = useCallback(
    async (code: string): Promise<EmailOtpStatus> => {
      const result = await verifyEmailOtpRequest(code);
      if (result.status === 'verified' || result.status === 'already_verified') {
        await loadProfile();
      }
      return result.status;
    },
    [loadProfile],
  );

  const openAuthModal = useCallback((view: AuthModalView = 'login') => {
    setAuthModalView(view);
  }, []);

  const closeAuthModal = useCallback(() => setAuthModalView(null), []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isAuthenticated: user !== null,
      initializing,
      login,
      register,
      logout,
      refreshProfile,
      updateProfile,
      sendEmailOtp,
      verifyEmailOtp,
      authModalView,
      openAuthModal,
      closeAuthModal,
    }),
    [
      user,
      initializing,
      login,
      register,
      logout,
      refreshProfile,
      updateProfile,
      sendEmailOtp,
      verifyEmailOtp,
      authModalView,
      openAuthModal,
      closeAuthModal,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
