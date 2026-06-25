import { createContext, useContext } from 'react';
import type {
  AuthProfile,
  EmailOtpStatus,
  LoginInput,
  RegisterInput,
  UpdateProfileInput,
} from '../types';

export type AuthModalView = 'login' | 'signup';

export type AuthContextValue = {
  readonly user: AuthProfile | null;
  readonly isAuthenticated: boolean;
  /** True while the initial /auth/me bootstrap is running. */
  readonly initializing: boolean;
  readonly login: (input: LoginInput) => Promise<void>;
  readonly register: (input: RegisterInput) => Promise<void>;
  readonly logout: () => Promise<void>;
  readonly refreshProfile: () => Promise<void>;
  readonly updateProfile: (input: UpdateProfileInput) => Promise<void>;
  readonly sendEmailOtp: () => Promise<EmailOtpStatus>;
  readonly verifyEmailOtp: (code: string) => Promise<EmailOtpStatus>;
  // Global auth modal control so any surface (e.g. Save button) can prompt login.
  readonly authModalView: AuthModalView | null;
  readonly openAuthModal: (view?: AuthModalView) => void;
  readonly closeAuthModal: () => void;
};

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
