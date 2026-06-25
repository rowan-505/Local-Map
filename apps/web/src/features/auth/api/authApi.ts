import { authJson, publicJson } from './http';
import type {
  AuthProfile,
  EmailOtpStatusResponse,
  LoginInput,
  RegisterInput,
  SessionResponse,
  UpdateProfileInput,
} from '../types';

export async function registerAccount(input: RegisterInput): Promise<{ user: AuthProfile }> {
  return publicJson<{ user: AuthProfile }>('/auth/register', {
    email: input.email,
    displayName: input.displayName,
    password: input.password,
    ...(input.preferredLanguage ? { preferredLanguage: input.preferredLanguage } : {}),
    ...(input.primaryRegionId != null ? { primaryRegionId: input.primaryRegionId } : {}),
  });
}

export async function login(input: LoginInput): Promise<SessionResponse> {
  return publicJson<SessionResponse>('/auth/login', {
    email: input.email,
    password: input.password,
  });
}

export async function logout(refreshToken: string): Promise<void> {
  await publicJson<{ message: string }>('/auth/logout', { refreshToken });
}

export async function fetchProfile(signal?: AbortSignal): Promise<AuthProfile> {
  return authJson<AuthProfile>('/auth/me', signal ? { signal } : {});
}

export async function updateProfile(input: UpdateProfileInput): Promise<AuthProfile> {
  const body: Record<string, unknown> = {};
  if (input.displayName !== undefined) body.displayName = input.displayName;
  if (input.phone !== undefined) body.phone = input.phone;
  if (input.preferredLanguage !== undefined) body.preferredLanguage = input.preferredLanguage;
  if (input.primaryRegionId !== undefined) body.primaryRegionId = input.primaryRegionId;

  return authJson<AuthProfile>('/me/profile', { method: 'PATCH', body });
}

export async function sendEmailOtp(): Promise<EmailOtpStatusResponse> {
  return authJson<EmailOtpStatusResponse>('/auth/email/send-otp', { method: 'POST', body: {} });
}

export async function verifyEmailOtp(code: string): Promise<EmailOtpStatusResponse> {
  return authJson<EmailOtpStatusResponse>('/auth/email/verify-otp', {
    method: 'POST',
    body: { code },
  });
}
