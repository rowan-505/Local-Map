import { Prisma, type PrismaClient } from "@prisma/client";

export type UserListFilters = {
    search?: string;
    role?: string;
    emailVerified?: boolean;
    accountStatus?: string;
    primaryRegionId?: number;
    createdFrom?: Date;
    createdTo?: Date;
    page: number;
    pageSize: number;
};

export type UserListRow = {
    public_id: string;
    email: string;
    display_name: string;
    phone: string | null;
    email_verified: boolean;
    account_status: string;
    primary_region_id: bigint | null;
    roles: string[];
    total_points: number;
    last_seen_at: Date | null;
    last_login_at: Date | null;
    created_at: Date;
};

export type UserDetailRow = UserListRow & {
    is_active: boolean;
    preferred_language: string;
    admin_note: string | null;
    lifetime_points_earned: number;
    lifetime_points_removed: number;
    saved_places_count: number;
    updated_at: Date;
    deleted_at: Date | null;
};

export type ManageableUser = {
    id: bigint;
    account_status: string;
    roles: string[];
    deleted_at: Date | null;
};

export type UserAuditRow = {
    id: bigint;
    action_type: string;
    actor_display_name: string | null;
    before_snapshot: unknown;
    after_snapshot: unknown;
    created_at: Date;
};

const ROLES_SUBQUERY = Prisma.sql`
    COALESCE((
        SELECT array_agg(r.code ORDER BY r.code)
        FROM app_auth.auth_user_roles ur
        JOIN app_auth.auth_roles r ON r.id = ur.role_id
        WHERE ur.user_id = u.id
    ), '{}'::text[])
`;

export class AdminUsersRepository {
    constructor(private readonly prisma: PrismaClient) {}

    async findUserIdByPublicId(publicId: string): Promise<bigint | null> {
        const rows = await this.prisma.$queryRaw<{ id: bigint }[]>(Prisma.sql`
            SELECT id FROM app_auth.auth_users WHERE public_id::text = ${publicId} LIMIT 1
        `);
        return rows[0]?.id ?? null;
    }

    /** Existing user (including soft-deleted) with roles, for permission checks + mutations. */
    async getManageableUser(publicId: string): Promise<ManageableUser | null> {
        const rows = await this.prisma.$queryRaw<
            { id: bigint; account_status: string; roles: string[]; deleted_at: Date | null }[]
        >(Prisma.sql`
            SELECT u.id, u.account_status, u.deleted_at, ${ROLES_SUBQUERY} AS roles
            FROM app_auth.auth_users u
            WHERE u.public_id::text = ${publicId}
            LIMIT 1
        `);

        const row = rows[0];
        return row
            ? {
                  id: row.id,
                  account_status: row.account_status,
                  roles: row.roles,
                  deleted_at: row.deleted_at,
              }
            : null;
    }

    async listUsers(filters: UserListFilters): Promise<{ items: UserListRow[]; total: number }> {
        const conditions: Prisma.Sql[] = [];

        if (filters.search) {
            const term = `%${filters.search}%`;
            conditions.push(
                Prisma.sql`(u.display_name ILIKE ${term} OR u.email ILIKE ${term} OR u.phone ILIKE ${term})`
            );
        }
        if (filters.role) {
            conditions.push(Prisma.sql`EXISTS (
                SELECT 1 FROM app_auth.auth_user_roles ur
                JOIN app_auth.auth_roles r ON r.id = ur.role_id
                WHERE ur.user_id = u.id AND r.code = ${filters.role}
            )`);
        }
        if (filters.emailVerified !== undefined) {
            conditions.push(Prisma.sql`u.email_verified = ${filters.emailVerified}`);
        }
        if (filters.accountStatus) {
            conditions.push(Prisma.sql`u.account_status = ${filters.accountStatus}`);
        } else {
            // Hide soft-deleted users unless explicitly filtering for them.
            conditions.push(Prisma.sql`u.deleted_at IS NULL`);
        }
        if (filters.primaryRegionId !== undefined) {
            conditions.push(Prisma.sql`u.primary_region_id = ${BigInt(filters.primaryRegionId)}`);
        }
        if (filters.createdFrom) {
            conditions.push(Prisma.sql`u.created_at >= ${filters.createdFrom}`);
        }
        if (filters.createdTo) {
            conditions.push(Prisma.sql`u.created_at <= ${filters.createdTo}`);
        }

        const where = conditions.length
            ? Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}`
            : Prisma.empty;

        const offset = (filters.page - 1) * filters.pageSize;

        const items = await this.prisma.$queryRaw<UserListRow[]>(Prisma.sql`
            SELECT
                u.public_id,
                u.email,
                u.display_name,
                u.phone,
                u.email_verified,
                u.account_status,
                u.primary_region_id,
                ${ROLES_SUBQUERY} AS roles,
                COALESCE((SELECT s.total_points FROM contrib.user_point_summary s WHERE s.user_id = u.id), 0)::int AS total_points,
                u.last_seen_at,
                u.last_login_at,
                u.created_at
            FROM app_auth.auth_users u
            ${where}
            ORDER BY u.created_at DESC, u.id DESC
            LIMIT ${filters.pageSize} OFFSET ${offset}
        `);

        const totalRows = await this.prisma.$queryRaw<{ total: number }[]>(Prisma.sql`
            SELECT COUNT(*)::int AS total FROM app_auth.auth_users u ${where}
        `);

        return { items, total: totalRows[0]?.total ?? 0 };
    }

    async getUserDetail(publicId: string): Promise<UserDetailRow | null> {
        const rows = await this.prisma.$queryRaw<UserDetailRow[]>(Prisma.sql`
            SELECT
                u.public_id,
                u.email,
                u.display_name,
                u.phone,
                u.email_verified,
                u.account_status,
                u.is_active,
                u.primary_region_id,
                u.preferred_language,
                u.admin_note,
                ${ROLES_SUBQUERY} AS roles,
                COALESCE(s.total_points, 0)::int AS total_points,
                COALESCE(s.lifetime_points_earned, 0)::int AS lifetime_points_earned,
                COALESCE(s.lifetime_points_removed, 0)::int AS lifetime_points_removed,
                COALESCE((SELECT COUNT(*) FROM app.user_saved_places sp WHERE sp.user_id = u.id), 0)::int AS saved_places_count,
                u.last_seen_at,
                u.last_login_at,
                u.created_at,
                u.updated_at,
                u.deleted_at
            FROM app_auth.auth_users u
            LEFT JOIN contrib.user_point_summary s ON s.user_id = u.id
            WHERE u.public_id::text = ${publicId}
            LIMIT 1
        `);

        return rows[0] ?? null;
    }

    /** Recent audit_logs scoped to a target user (entity_type = 'auth_user'). */
    async listUserAudit(targetUserId: bigint, limit: number): Promise<UserAuditRow[]> {
        return this.prisma.$queryRaw<UserAuditRow[]>(Prisma.sql`
            SELECT
                a.id,
                a.action_type,
                actor.display_name AS actor_display_name,
                a.before_snapshot,
                a.after_snapshot,
                a.created_at
            FROM system.audit_logs a
            LEFT JOIN app_auth.auth_users actor ON actor.id = a.actor_user_id
            WHERE a.entity_type = 'auth_user' AND a.entity_id = ${targetUserId}
            ORDER BY a.created_at DESC, a.id DESC
            LIMIT ${limit}
        `);
    }

    async findRoleIdByCode(code: string): Promise<bigint | null> {
        const role = await this.prisma.authRole.findUnique({
            where: { code },
            select: { id: true },
        });
        return role?.id ?? null;
    }

    async updateStatus(input: {
        targetUserId: bigint;
        accountStatus: string;
        beforeStatus: string;
        actorUserId: bigint | null;
        ipAddress: string | null;
        userAgent: string | null;
    }): Promise<void> {
        const isActive = input.accountStatus === "active";
        const deletedAt = input.accountStatus === "deleted" ? new Date() : null;

        await this.prisma.$transaction(async (tx) => {
            await tx.authUser.update({
                where: { id: input.targetUserId },
                data: {
                    accountStatus: input.accountStatus,
                    isActive,
                    deletedAt,
                },
            });

            await tx.auditLog.create({
                data: {
                    actorUserId: input.actorUserId,
                    actionType: "admin_user_status_changed",
                    entityType: "auth_user",
                    entityId: input.targetUserId,
                    beforeSnapshot: { account_status: input.beforeStatus },
                    afterSnapshot: { account_status: input.accountStatus },
                    ipAddress: input.ipAddress,
                    userAgent: input.userAgent,
                },
            });
        });
    }

    async updateAdminNote(input: {
        targetUserId: bigint;
        adminNote: string | null;
        beforeNote: string | null;
        actorUserId: bigint | null;
        ipAddress: string | null;
        userAgent: string | null;
    }): Promise<void> {
        await this.prisma.$transaction(async (tx) => {
            await tx.authUser.update({
                where: { id: input.targetUserId },
                data: { adminNote: input.adminNote },
            });

            await tx.auditLog.create({
                data: {
                    actorUserId: input.actorUserId,
                    actionType: "admin_user_note_updated",
                    entityType: "auth_user",
                    entityId: input.targetUserId,
                    beforeSnapshot: { admin_note: input.beforeNote },
                    afterSnapshot: { admin_note: input.adminNote },
                    ipAddress: input.ipAddress,
                    userAgent: input.userAgent,
                },
            });
        });
    }

    async assignRole(input: {
        targetUserId: bigint;
        roleId: bigint;
        roleCode: string;
        actorUserId: bigint | null;
        ipAddress: string | null;
        userAgent: string | null;
    }): Promise<void> {
        await this.prisma.$transaction(async (tx) => {
            const existing = await tx.authUserRole.findFirst({
                where: { userId: input.targetUserId, roleId: input.roleId },
                select: { id: true },
            });

            if (existing) {
                return; // already assigned — idempotent, no audit noise.
            }

            await tx.authUserRole.create({
                data: { userId: input.targetUserId, roleId: input.roleId },
            });

            await tx.auditLog.create({
                data: {
                    actorUserId: input.actorUserId,
                    actionType: "admin_user_role_assigned",
                    entityType: "auth_user",
                    entityId: input.targetUserId,
                    afterSnapshot: { role_code: input.roleCode },
                    ipAddress: input.ipAddress,
                    userAgent: input.userAgent,
                },
            });
        });
    }

    /** Removes a role assignment. Returns true if a row was removed. */
    async removeRole(input: {
        targetUserId: bigint;
        roleId: bigint;
        roleCode: string;
        actorUserId: bigint | null;
        ipAddress: string | null;
        userAgent: string | null;
    }): Promise<boolean> {
        return this.prisma.$transaction(async (tx) => {
            const result = await tx.authUserRole.deleteMany({
                where: { userId: input.targetUserId, roleId: input.roleId },
            });

            if (result.count === 0) {
                return false;
            }

            await tx.auditLog.create({
                data: {
                    actorUserId: input.actorUserId,
                    actionType: "admin_user_role_removed",
                    entityType: "auth_user",
                    entityId: input.targetUserId,
                    beforeSnapshot: { role_code: input.roleCode },
                    ipAddress: input.ipAddress,
                    userAgent: input.userAgent,
                },
            });

            return true;
        });
    }
}
