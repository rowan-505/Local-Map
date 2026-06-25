import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";

/** Login-time record — includes password_hash for verification only. Never serialize directly. */
export type AuthUserRecord = {
    id: string;
    public_id: string;
    email: string;
    display_name: string;
    password_hash: string;
    is_active: boolean;
    account_status: string;
    roles: string[];
};

/** Safe profile shape for /auth/me and registration responses. No secrets. */
export type AuthUserProfile = {
    id: string;
    public_id: string;
    email: string;
    display_name: string;
    phone: string | null;
    is_active: boolean;
    email_verified: boolean;
    account_status: string;
    primary_region_id: string | null;
    preferred_language: string;
    roles: string[];
    total_points: number;
};

/** Fields a user may edit on their own profile. `undefined` = leave unchanged. */
export type UpdatableProfileFields = {
    displayName?: string;
    phone?: string | null;
    preferredLanguage?: "my" | "en";
    primaryRegionId?: bigint | null;
};

export type ActiveSession = {
    id: bigint;
    public_id: string;
    user: AuthUserRecord;
};

export type EmailVerificationUser = {
    id: bigint;
    email: string;
    email_verified: boolean;
    is_active: boolean;
    account_status: string;
};

export type EmailOtpRecord = {
    id: bigint;
    otp_hash: string;
    attempts_count: number;
    max_attempts: number;
    expires_at: Date;
    consumed_at: Date | null;
    created_at: Date;
};

const userWithRolesInclude = {
    userRoles: {
        include: {
            role: true,
        },
    },
} satisfies Prisma.AuthUserInclude;

type AuthUserWithRoles = Prisma.AuthUserGetPayload<{
    include: typeof userWithRolesInclude;
}>;

export class AuthRoleNotFoundError extends Error {
    constructor(roleCode: string) {
        super(`Role "${roleCode}" not found`);
        this.name = "AuthRoleNotFoundError";
    }
}

export class AuthRepository {
    constructor(private readonly prisma: PrismaClient) {}

    async findUserByEmail(email: string): Promise<AuthUserRecord | null> {
        const user = await this.prisma.authUser.findUnique({
            where: { email },
            include: userWithRolesInclude,
        });

        return user ? mapAuthUserRecord(user) : null;
    }

    async findProfileByPublicId(publicId: string): Promise<AuthUserProfile | null> {
        const user = await this.prisma.authUser.findUnique({
            where: { publicId },
            include: userWithRolesInclude,
        });

        if (!user) {
            return null;
        }

        const totalPoints = await this.getTotalPoints(user.id);
        return mapAuthUserProfile(user, totalPoints);
    }

    async touchLastLogin(userId: bigint): Promise<void> {
        const now = new Date();
        await this.prisma.authUser.update({
            where: { id: userId },
            data: { lastLoginAt: now, lastSeenAt: now },
        });
    }

    async updatePasswordHash(userId: bigint, passwordHash: string): Promise<void> {
        await this.prisma.authUser.update({
            where: { id: userId },
            data: { passwordHash },
        });
    }

    async getTotalPoints(userId: bigint): Promise<number> {
        const summary = await this.prisma.userPointSummary.findUnique({
            where: { userId },
        });

        return summary?.totalPoints ?? 0;
    }

    /**
     * Public registration: always assigns the `user` role. Admin / super_admin
     * are provisioned out-of-band and can never be created by this path.
     */
    async createPublicUser(input: {
        email: string;
        displayName: string;
        passwordHash: string;
        preferredLanguage?: "my" | "en";
        primaryRegionId?: bigint | null;
    }): Promise<AuthUserProfile> {
        const user = await this.prisma.$transaction(async (tx) => {
            const role = await tx.authRole.findUnique({
                where: { code: "user" },
            });

            if (!role) {
                throw new AuthRoleNotFoundError("user");
            }

            const createdUser = await tx.authUser.create({
                data: {
                    email: input.email,
                    displayName: input.displayName,
                    passwordHash: input.passwordHash,
                    isActive: true,
                    // Omit when undefined so the DB default ("my") applies.
                    ...(input.preferredLanguage
                        ? { preferredLanguage: input.preferredLanguage }
                        : {}),
                    ...(input.primaryRegionId != null
                        ? { primaryRegionId: input.primaryRegionId }
                        : {}),
                },
            });

            await tx.authUserRole.create({
                data: {
                    userId: createdUser.id,
                    roleId: role.id,
                },
            });

            return tx.authUser.findUniqueOrThrow({
                where: { id: createdUser.id },
                include: userWithRolesInclude,
            });
        });

        return mapAuthUserProfile(user, 0);
    }

    /** Returns true if the admin area id exists (for primaryRegionId validation). */
    async adminAreaExists(adminAreaId: bigint): Promise<boolean> {
        const rows = await this.prisma.$queryRaw<{ id: bigint }[]>(Prisma.sql`
            SELECT id FROM core.core_admin_areas WHERE id = ${adminAreaId} LIMIT 1
        `);
        return rows.length > 0;
    }

    /** Applies self-service profile edits. Only provided fields are updated. */
    async updateProfile(
        userId: bigint,
        fields: UpdatableProfileFields
    ): Promise<void> {
        const data: Prisma.AuthUserUpdateInput = { updatedAt: new Date() };

        if (fields.displayName !== undefined) data.displayName = fields.displayName;
        if (fields.phone !== undefined) data.phone = fields.phone;
        if (fields.preferredLanguage !== undefined) {
            data.preferredLanguage = fields.preferredLanguage;
        }
        if (fields.primaryRegionId !== undefined) {
            data.primaryRegionId = fields.primaryRegionId;
        }

        await this.prisma.authUser.update({ where: { id: userId }, data });
    }

    async createSession(input: {
        userId: bigint;
        refreshTokenHash: string;
        expiresAt: Date;
        userAgent?: string | null;
        ipAddress?: string | null;
    }): Promise<{ id: bigint; public_id: string }> {
        const session = await this.prisma.authSession.create({
            data: {
                userId: input.userId,
                refreshTokenHash: input.refreshTokenHash,
                expiresAt: input.expiresAt,
                userAgent: input.userAgent ?? null,
                ipAddress: input.ipAddress ?? null,
                lastUsedAt: new Date(),
            },
        });

        return { id: session.id, public_id: session.publicId };
    }

    /** Returns the session + owning user only when the session is unrevoked and unexpired. */
    async findActiveSessionByTokenHash(refreshTokenHash: string): Promise<ActiveSession | null> {
        const session = await this.prisma.authSession.findFirst({
            where: {
                refreshTokenHash,
                revokedAt: null,
                expiresAt: { gt: new Date() },
            },
            include: {
                user: {
                    include: userWithRolesInclude,
                },
            },
        });

        if (!session) {
            return null;
        }

        return {
            id: session.id,
            public_id: session.publicId,
            user: mapAuthUserRecord(session.user),
        };
    }

    /** Rotates refresh token on a session and refreshes its expiry window. */
    async rotateSession(sessionId: bigint, refreshTokenHash: string, expiresAt: Date): Promise<void> {
        await this.prisma.authSession.update({
            where: { id: sessionId },
            data: {
                refreshTokenHash,
                expiresAt,
                lastUsedAt: new Date(),
            },
        });
    }

    /** Idempotent logout: revokes the matching active session if present. Returns revoked count. */
    async revokeSessionByTokenHash(refreshTokenHash: string): Promise<number> {
        const result = await this.prisma.authSession.updateMany({
            where: {
                refreshTokenHash,
                revokedAt: null,
            },
            data: {
                revokedAt: new Date(),
            },
        });

        return result.count;
    }

    /** Lean lookup for email verification flows (internal id + current verified state). */
    async findVerificationUserByPublicId(
        publicId: string
    ): Promise<EmailVerificationUser | null> {
        const user = await this.prisma.authUser.findUnique({
            where: { publicId },
            select: { id: true, email: true, emailVerified: true, isActive: true, accountStatus: true },
        });

        if (!user) {
            return null;
        }

        return {
            id: user.id,
            email: user.email,
            email_verified: user.emailVerified,
            is_active: user.isActive,
            account_status: user.accountStatus,
        };
    }

    /** Latest OTP regardless of consumed state — used for the resend throttle window. */
    async findLatestOtp(
        userId: bigint,
        email: string,
        purpose: string
    ): Promise<EmailOtpRecord | null> {
        const otp = await this.prisma.emailVerificationOtp.findFirst({
            where: { userId, email, purpose },
            orderBy: { createdAt: "desc" },
        });

        return otp ? mapOtpRecord(otp) : null;
    }

    /** Latest unconsumed OTP — used for verification. */
    async findLatestUnconsumedOtp(
        userId: bigint,
        email: string,
        purpose: string
    ): Promise<EmailOtpRecord | null> {
        const otp = await this.prisma.emailVerificationOtp.findFirst({
            where: { userId, email, purpose, consumedAt: null },
            orderBy: { createdAt: "desc" },
        });

        return otp ? mapOtpRecord(otp) : null;
    }

    /** Marks all currently-active OTPs (this user/email/purpose) as consumed. */
    async invalidateActiveOtps(userId: bigint, email: string, purpose: string): Promise<void> {
        await this.prisma.emailVerificationOtp.updateMany({
            where: { userId, email, purpose, consumedAt: null },
            data: { consumedAt: new Date() },
        });
    }

    async createEmailOtp(input: {
        userId: bigint;
        email: string;
        otpHash: string;
        purpose: string;
        maxAttempts: number;
        expiresAt: Date;
    }): Promise<void> {
        await this.prisma.emailVerificationOtp.create({
            data: {
                userId: input.userId,
                email: input.email,
                otpHash: input.otpHash,
                purpose: input.purpose,
                maxAttempts: input.maxAttempts,
                expiresAt: input.expiresAt,
            },
        });
    }

    async incrementOtpAttempts(otpId: bigint): Promise<void> {
        await this.prisma.emailVerificationOtp.update({
            where: { id: otpId },
            data: { attemptsCount: { increment: 1 } },
        });
    }

    /**
     * Atomically: flag the user verified, consume the OTP, and write an audit log.
     * Audit fields use the system.audit_logs actor/entity convention.
     */
    async markEmailVerified(
        userId: bigint,
        otpId: bigint,
        audit: { ipAddress?: string | null; userAgent?: string | null }
    ): Promise<void> {
        await this.prisma.$transaction(async (tx) => {
            await tx.authUser.update({
                where: { id: userId },
                data: { emailVerified: true },
            });

            await tx.emailVerificationOtp.update({
                where: { id: otpId },
                data: { consumedAt: new Date() },
            });

            await tx.auditLog.create({
                data: {
                    actorUserId: userId,
                    actionType: "email_verified",
                    entityType: "auth_user",
                    entityId: userId,
                    beforeSnapshot: { email_verified: false },
                    afterSnapshot: { email_verified: true },
                    ipAddress: audit.ipAddress ?? null,
                    userAgent: audit.userAgent ?? null,
                },
            });
        });
    }
}

type EmailOtpRow = Prisma.EmailVerificationOtpGetPayload<Record<string, never>>;

function mapOtpRecord(otp: EmailOtpRow): EmailOtpRecord {
    return {
        id: otp.id,
        otp_hash: otp.otpHash,
        attempts_count: otp.attemptsCount,
        max_attempts: otp.maxAttempts,
        expires_at: otp.expiresAt,
        consumed_at: otp.consumedAt,
        created_at: otp.createdAt,
    };
}

function mapRoles(user: AuthUserWithRoles): string[] {
    return user.userRoles.map((userRole) => userRole.role.code);
}

function mapAuthUserRecord(user: AuthUserWithRoles): AuthUserRecord {
    return {
        id: user.id.toString(),
        public_id: user.publicId,
        email: user.email,
        display_name: user.displayName,
        password_hash: user.passwordHash,
        is_active: user.isActive,
        account_status: user.accountStatus,
        roles: mapRoles(user),
    };
}

function mapAuthUserProfile(user: AuthUserWithRoles, totalPoints: number): AuthUserProfile {
    return {
        id: user.id.toString(),
        public_id: user.publicId,
        email: user.email,
        display_name: user.displayName,
        phone: user.phone,
        is_active: user.isActive,
        email_verified: user.emailVerified,
        account_status: user.accountStatus,
        primary_region_id: user.primaryRegionId !== null ? user.primaryRegionId.toString() : null,
        preferred_language: user.preferredLanguage,
        roles: mapRoles(user),
        total_points: totalPoints,
    };
}
