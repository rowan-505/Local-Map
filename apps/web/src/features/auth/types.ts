/** Auth + account types mirrored from the CoreMap API auth module responses. */

/** Minimal user shape returned by /auth/login and /auth/refresh. */
export type AuthUser = {
  readonly id: string;
  readonly public_id: string;
  readonly email: string;
  readonly display_name: string;
  readonly roles: readonly string[];
};

/** Full profile from /auth/me (and /auth/register). Never includes secrets. */
export type AuthProfile = AuthUser & {
  readonly phone: string | null;
  readonly email_verified: boolean;
  readonly account_status: string;
  readonly primary_region_id: string | null;
  readonly preferred_language: string;
  readonly total_points: number;
};

/** Self-service profile edit payload (PATCH /me/profile). */
export type UpdateProfileInput = {
  readonly displayName?: string;
  readonly phone?: string | null;
  readonly preferredLanguage?: PreferredLanguage;
  readonly primaryRegionId?: number | null;
};

export type SessionResponse = {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresIn: string;
  readonly user: AuthUser;
};

export type PreferredLanguage = 'my' | 'en';

export type RegisterInput = {
  readonly email: string;
  readonly displayName: string;
  readonly password: string;
  readonly preferredLanguage?: PreferredLanguage;
  // TODO: collect optional primaryRegionId / phone once the API + UI support them.
};

export type LoginInput = {
  readonly email: string;
  readonly password: string;
};

export type EmailOtpStatus = 'sent' | 'verified' | 'already_verified';

export type EmailOtpStatusResponse = {
  readonly status: EmailOtpStatus;
};
