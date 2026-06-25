import { Prisma } from "@prisma/client";

import { generateOtpCode, hashOtp, safeCompareHex } from "../../lib/security/otp.js";
import type { EmailService } from "../email/email.service.js";
import {
    AuthRepository,
    AuthRoleNotFoundError,
    type AuthUserProfile,
    type UpdatableProfileFields,
} from "./auth.repo.js";
import { hashPassword, verifyPassword } from "./password.js";
import { generateRefreshToken, hashRefreshToken, refreshTokenExpiry } from "./refresh-token.js";

/** Purpose tag stored on email_verification_otps rows. */
const EMAIL_VERIFICATION_PURPOSE = "email_verification";

/** Minimum seconds between OTP sends for the same user (service-level throttle). */
const OTP_RESEND_THROTTLE_SECONDS = 60;

export class AuthError extends Error {
    constructor(
        message: string,
        public readonly statusCode: number
    ) {
        super(message);
        this.name = "AuthError";
    }
}

/** Minimal user shape returned by login/refresh (no secrets). */
export type AuthUserResponse = {
    id: string;
    public_id: string;
    email: string;
    display_name: string;
    roles: string[];
};

/** Claims embedded in the short-lived access JWT (signed by the route via reply.jwtSign). */
export type AccessTokenClaims = {
    sub: string;
    email: string;
    roles: string[];
};

export type SessionContext = {
    userAgent?: string | null;
    ipAddress?: string | null;
};

export type AuthSessionResult = {
    user: AuthUserResponse;
    accessTokenClaims: AccessTokenClaims;
    refreshToken: string;
};

export type EmailOtpDeps = {
    emailService: EmailService;
    /** HMAC key for OTP hashing; null when email verification is not configured. */
    otpSecret: string | null;
    ttlMinutes: number;
    maxAttempts: number;
};

export type EmailOtpStatus = { status: "sent" | "verified" | "already_verified" };

export class AuthService {
    constructor(
        private readonly authRepo: AuthRepository,
        private readonly emailOtp?: EmailOtpDeps
    ) {}

    async register(input: {
        email: string;
        displayName: string;
        password: string;
        preferredLanguage?: "my" | "en";
        primaryRegionId?: number | null;
    }): Promise<AuthUserProfile> {
        const email = normalizeEmail(input.email);
        const displayName = input.displayName.trim();

        const existing = await this.authRepo.findUserByEmail(email);
        if (existing) {
            throw new AuthError("Email already registered", 409);
        }

        let primaryRegionId: bigint | undefined;
        if (input.primaryRegionId !== undefined && input.primaryRegionId !== null) {
            primaryRegionId = BigInt(input.primaryRegionId);
            const exists = await this.authRepo.adminAreaExists(primaryRegionId);
            if (!exists) {
                throw new AuthError("primaryRegionId does not reference a known region", 400);
            }
        }

        const passwordHash = await hashPassword(input.password);

        try {
            return await this.authRepo.createPublicUser({
                email,
                displayName,
                passwordHash,
                preferredLanguage: input.preferredLanguage,
                primaryRegionId,
            });
        } catch (error) {
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
                throw new AuthError("Email already registered", 409);
            }

            if (error instanceof AuthRoleNotFoundError) {
                throw new AuthError("User role is not configured", 500);
            }

            throw error;
        }
    }

    /** Applies self-service profile edits and returns the refreshed profile. */
    async updateProfile(
        userPublicId: string,
        fields: UpdatableProfileFields
    ): Promise<AuthUserProfile> {
        const current = await this.authRepo.findProfileByPublicId(userPublicId);
        if (!current) {
            throw new AuthError("User not found", 404);
        }

        if (fields.primaryRegionId !== undefined && fields.primaryRegionId !== null) {
            const exists = await this.authRepo.adminAreaExists(fields.primaryRegionId);
            if (!exists) {
                throw new AuthError("primaryRegionId does not reference a known region", 400);
            }
        }

        await this.authRepo.updateProfile(BigInt(current.id), fields);

        const updated = await this.authRepo.findProfileByPublicId(userPublicId);
        if (!updated) {
            throw new AuthError("User not found", 404);
        }
        return updated;
    }

    async login(
        credentials: { email?: string; username?: string },
        password: string,
        context: SessionContext = {}
    ): Promise<AuthSessionResult> {
        const normalizedEmail = normalizeLoginEmail(credentials);
        const user = await this.authRepo.findUserByEmail(normalizedEmail);

        if (!user) {
            throw new AuthError("Invalid email or password", 401);
        }

        assertUserUsable(user.is_active, user.account_status);

        const { valid, needsRehash } = await verifyPassword(user.password_hash, password);
        if (!valid) {
            throw new AuthError("Invalid email or password", 401);
        }

        const userId = BigInt(user.id);

        // Transparently upgrade legacy bcrypt (or stale argon2) hashes to Argon2id.
        if (needsRehash) {
            try {
                await this.authRepo.updatePasswordHash(userId, await hashPassword(password));
            } catch {
                // Rehash is best-effort; never block a valid login on it.
            }
        }

        await this.authRepo.touchLastLogin(userId);

        const refreshToken = await this.issueSession(userId, context);

        return {
            user: toUserResponse(user),
            accessTokenClaims: toAccessTokenClaims(user),
            refreshToken,
        };
    }

    async refresh(refreshToken: string): Promise<AuthSessionResult> {
        const session = await this.authRepo.findActiveSessionByTokenHash(
            hashRefreshToken(refreshToken)
        );

        if (!session) {
            throw new AuthError("Invalid or expired refresh token", 401);
        }

        assertUserUsable(session.user.is_active, session.user.account_status);

        // Rotate: the presented token is consumed and replaced.
        const newRefreshToken = generateRefreshToken();
        await this.authRepo.rotateSession(
            session.id,
            hashRefreshToken(newRefreshToken),
            refreshTokenExpiry()
        );

        return {
            user: toUserResponse(session.user),
            accessTokenClaims: toAccessTokenClaims(session.user),
            refreshToken: newRefreshToken,
        };
    }

    /** Idempotent: revoking an unknown/already-revoked token is a no-op success. */
    async logout(refreshToken: string): Promise<void> {
        await this.authRepo.revokeSessionByTokenHash(hashRefreshToken(refreshToken));
    }

    async getMe(userPublicId: string): Promise<AuthUserProfile> {
        const profile = await this.authRepo.findProfileByPublicId(userPublicId);

        if (!profile) {
            throw new AuthError("User not found", 401);
        }

        assertUserUsable(profile.is_active, profile.account_status);

        return profile;
    }

    /**
     * Sends a fresh email-verification OTP to the logged-in user. Optional flow:
     * already-verified users are short-circuited and account creation is never
     * blocked on this. Throttled to one send per {@link OTP_RESEND_THROTTLE_SECONDS}.
     */
    async sendEmailOtp(userPublicId: string, context: SessionContext = {}): Promise<EmailOtpStatus> {
        const config = this.requireEmailOtpConfig();
        const user = await this.loadVerificationUser(userPublicId);

        if (user.email_verified) {
            return { status: "already_verified" };
        }

        const latest = await this.authRepo.findLatestOtp(
            user.id,
            user.email,
            EMAIL_VERIFICATION_PURPOSE
        );

        if (latest) {
            const elapsedMs = Date.now() - latest.created_at.getTime();
            if (elapsedMs < OTP_RESEND_THROTTLE_SECONDS * 1000) {
                throw new AuthError("Please wait before requesting another code", 429);
            }
        }

        await this.authRepo.invalidateActiveOtps(user.id, user.email, EMAIL_VERIFICATION_PURPOSE);

        const code = generateOtpCode();
        await this.authRepo.createEmailOtp({
            userId: user.id,
            email: user.email,
            otpHash: hashOtp(code, config.otpSecret),
            purpose: EMAIL_VERIFICATION_PURPOSE,
            maxAttempts: config.maxAttempts,
            expiresAt: new Date(Date.now() + config.ttlMinutes * 60 * 1000),
        });

        // Email send errors (EmailSendError / EmailServiceNotConfiguredError) carry
        // their own statusCode and propagate to the global handler (which logs them).
        await config.emailService.sendEmailVerificationOtp({
            to: user.email,
            code,
            ttlMinutes: config.ttlMinutes,
        });

        return { status: "sent" };
    }

    /**
     * Verifies a submitted OTP. On success: sets email_verified and consumes the
     * OTP (with an audit log) in one transaction. On failure: increments attempts.
     */
    async verifyEmailOtp(
        userPublicId: string,
        code: string,
        context: SessionContext = {}
    ): Promise<EmailOtpStatus> {
        const config = this.requireEmailOtpConfig();
        const user = await this.loadVerificationUser(userPublicId);

        if (user.email_verified) {
            return { status: "already_verified" };
        }

        const otp = await this.authRepo.findLatestUnconsumedOtp(
            user.id,
            user.email,
            EMAIL_VERIFICATION_PURPOSE
        );

        if (!otp) {
            throw new AuthError("No active verification code. Request a new one.", 400);
        }

        if (otp.expires_at.getTime() <= Date.now()) {
            throw new AuthError("Verification code has expired", 400);
        }

        if (otp.attempts_count >= otp.max_attempts) {
            throw new AuthError("Too many attempts. Request a new code.", 429);
        }

        const matches = safeCompareHex(hashOtp(code, config.otpSecret), otp.otp_hash);

        if (!matches) {
            await this.authRepo.incrementOtpAttempts(otp.id);
            throw new AuthError("Invalid verification code", 400);
        }

        await this.authRepo.markEmailVerified(user.id, otp.id, {
            ipAddress: context.ipAddress ?? null,
            userAgent: context.userAgent ?? null,
        });

        return { status: "verified" };
    }

    private requireEmailOtpConfig(): EmailOtpDeps & { otpSecret: string } {
        if (!this.emailOtp || !this.emailOtp.otpSecret) {
            throw new AuthError("Email verification is not configured", 503);
        }

        return { ...this.emailOtp, otpSecret: this.emailOtp.otpSecret };
    }

    private async loadVerificationUser(userPublicId: string) {
        const user = await this.authRepo.findVerificationUserByPublicId(userPublicId);

        if (!user) {
            throw new AuthError("User not found", 401);
        }

        assertUserUsable(user.is_active, user.account_status);
        return user;
    }

    private async issueSession(userId: bigint, context: SessionContext): Promise<string> {
        const refreshToken = generateRefreshToken();

        await this.authRepo.createSession({
            userId,
            refreshTokenHash: hashRefreshToken(refreshToken),
            expiresAt: refreshTokenExpiry(),
            userAgent: context.userAgent ?? null,
            ipAddress: context.ipAddress ?? null,
        });

        return refreshToken;
    }
}

function assertUserUsable(isActive: boolean, accountStatus: string): void {
    if (!isActive || accountStatus !== "active") {
        throw new AuthError("User account is inactive", 403);
    }
}

function toUserResponse(user: {
    id: string;
    public_id: string;
    email: string;
    display_name: string;
    roles: string[];
}): AuthUserResponse {
    return {
        id: user.id,
        public_id: user.public_id,
        email: user.email,
        display_name: user.display_name,
        roles: user.roles,
    };
}

function toAccessTokenClaims(user: {
    public_id: string;
    email: string;
    roles: string[];
}): AccessTokenClaims {
    return {
        sub: user.public_id,
        email: user.email,
        roles: user.roles,
    };
}

function normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
}

/**
 * Login accepts email, or a legacy `username` that maps to the historic
 * `<username>@demo.local` address so pre-existing internal accounts still work.
 */
function normalizeLoginEmail(credentials: { email?: string; username?: string }): string {
    if (credentials.username) {
        return `${credentials.username.trim().toLowerCase()}@demo.local`;
    }

    return normalizeEmail(credentials.email!);
}
