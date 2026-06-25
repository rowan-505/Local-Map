import { Prisma, type PrismaClient } from "@prisma/client";

export type PointSummaryRow = {
    totalPoints: number;
    lifetimePointsEarned: number;
    lifetimePointsRemoved: number;
    updatedAt: Date;
};

export type PointLedgerRow = {
    id: bigint;
    pointsDelta: number;
    reasonCode: string;
    note: string | null;
    relatedEntityType: string | null;
    relatedEntityId: bigint | null;
    createdAt: Date;
};

export type AdminLedgerFilters = {
    userPublicId?: string;
    reasonCode?: string;
    page: number;
    pageSize: number;
};

export type AdminLedgerRow = {
    id: bigint;
    points_delta: number;
    reason_code: string;
    note: string | null;
    created_at: Date;
    user_public_id: string;
    user_display_name: string;
    user_email: string;
    created_by_display_name: string | null;
};

export type TopPointUserRow = {
    public_id: string;
    display_name: string;
    email: string;
    total_points: number;
    lifetime_points_earned: number;
    lifetime_points_removed: number;
};

export type ApplyPointChangeInput = {
    targetUserId: bigint;
    pointsDelta: number;
    reasonCode: string;
    note: string | null;
    relatedEntityType: string | null;
    relatedEntityId: bigint | null;
    adminUserId: bigint | null;
    ipAddress: string | null;
    userAgent: string | null;
};

export class PointsRepository {
    constructor(private readonly prisma: PrismaClient) {}

    /** Resolves internal user id from a public_id uuid; null when missing or soft-deleted. */
    async findActiveUserIdByPublicId(publicId: string): Promise<bigint | null> {
        const rows = await this.prisma.$queryRaw<{ id: bigint }[]>(Prisma.sql`
            SELECT id
            FROM app_auth.auth_users
            WHERE public_id::text = ${publicId}
              AND deleted_at IS NULL
            LIMIT 1
        `);

        return rows[0]?.id ?? null;
    }

    async getSummary(userId: bigint): Promise<PointSummaryRow | null> {
        return this.prisma.userPointSummary.findUnique({
            where: { userId },
            select: {
                totalPoints: true,
                lifetimePointsEarned: true,
                lifetimePointsRemoved: true,
                updatedAt: true,
            },
        });
    }

    async listHistory(userId: bigint, limit: number): Promise<PointLedgerRow[]> {
        return this.prisma.pointLedger.findMany({
            where: { userId },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: limit,
            select: {
                id: true,
                pointsDelta: true,
                reasonCode: true,
                note: true,
                relatedEntityType: true,
                relatedEntityId: true,
                createdAt: true,
            },
        });
    }

    /** Recent point changes across all users, with optional user/reason filters. */
    async listRecentLedger(
        filters: AdminLedgerFilters
    ): Promise<{ items: AdminLedgerRow[]; total: number }> {
        const conditions: Prisma.Sql[] = [];

        if (filters.userPublicId) {
            conditions.push(Prisma.sql`u.public_id::text = ${filters.userPublicId}`);
        }
        if (filters.reasonCode) {
            conditions.push(Prisma.sql`l.reason_code = ${filters.reasonCode}`);
        }

        const where = conditions.length
            ? Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}`
            : Prisma.empty;

        const offset = (filters.page - 1) * filters.pageSize;

        const items = await this.prisma.$queryRaw<AdminLedgerRow[]>(Prisma.sql`
            SELECT
                l.id,
                l.points_delta,
                l.reason_code,
                l.note,
                l.created_at,
                u.public_id::text AS user_public_id,
                u.display_name AS user_display_name,
                u.email AS user_email,
                c.display_name AS created_by_display_name
            FROM contrib.point_ledger l
            JOIN app_auth.auth_users u ON u.id = l.user_id
            LEFT JOIN app_auth.auth_users c ON c.id = l.created_by
            ${where}
            ORDER BY l.created_at DESC, l.id DESC
            LIMIT ${filters.pageSize} OFFSET ${offset}
        `);

        const totalRows = await this.prisma.$queryRaw<{ total: number }[]>(Prisma.sql`
            SELECT COUNT(*)::int AS total
            FROM contrib.point_ledger l
            JOIN app_auth.auth_users u ON u.id = l.user_id
            ${where}
        `);

        return { items, total: totalRows[0]?.total ?? 0 };
    }

    /** Users with the highest current point balance. */
    async topUsers(limit: number): Promise<TopPointUserRow[]> {
        return this.prisma.$queryRaw<TopPointUserRow[]>(Prisma.sql`
            SELECT
                u.public_id::text AS public_id,
                u.display_name,
                u.email,
                s.total_points,
                s.lifetime_points_earned,
                s.lifetime_points_removed
            FROM contrib.user_point_summary s
            JOIN app_auth.auth_users u ON u.id = s.user_id
            WHERE u.deleted_at IS NULL
            ORDER BY s.total_points DESC, u.display_name ASC
            LIMIT ${limit}
        `);
    }

    /**
     * Append-only point change: inserts a ledger row, updates the summary cache,
     * and writes an audit log — all atomically. Never edits/deletes ledger rows
     * (corrections are new reversal rows).
     */
    async applyPointChange(
        input: ApplyPointChangeInput
    ): Promise<{ ledger: PointLedgerRow; summary: PointSummaryRow }> {
        const earned = input.pointsDelta > 0 ? input.pointsDelta : 0;
        const removed = input.pointsDelta < 0 ? Math.abs(input.pointsDelta) : 0;

        return this.prisma.$transaction(async (tx) => {
            const before = await tx.userPointSummary.findUnique({
                where: { userId: input.targetUserId },
                select: { totalPoints: true },
            });

            const ledger = await tx.pointLedger.create({
                data: {
                    userId: input.targetUserId,
                    pointsDelta: input.pointsDelta,
                    reasonCode: input.reasonCode,
                    note: input.note,
                    relatedEntityType: input.relatedEntityType,
                    relatedEntityId: input.relatedEntityId,
                    createdBy: input.adminUserId,
                },
                select: {
                    id: true,
                    pointsDelta: true,
                    reasonCode: true,
                    note: true,
                    relatedEntityType: true,
                    relatedEntityId: true,
                    createdAt: true,
                },
            });

            const summary = await tx.userPointSummary.upsert({
                where: { userId: input.targetUserId },
                create: {
                    userId: input.targetUserId,
                    totalPoints: input.pointsDelta,
                    lifetimePointsEarned: earned,
                    lifetimePointsRemoved: removed,
                },
                update: {
                    totalPoints: { increment: input.pointsDelta },
                    lifetimePointsEarned: { increment: earned },
                    lifetimePointsRemoved: { increment: removed },
                    updatedAt: new Date(),
                },
                select: {
                    totalPoints: true,
                    lifetimePointsEarned: true,
                    lifetimePointsRemoved: true,
                    updatedAt: true,
                },
            });

            await tx.auditLog.create({
                data: {
                    actorUserId: input.adminUserId,
                    actionType: "admin_points_adjusted",
                    entityType: "auth_user",
                    entityId: input.targetUserId,
                    beforeSnapshot: { total_points: before?.totalPoints ?? 0 },
                    afterSnapshot: {
                        total_points: summary.totalPoints,
                        points_delta: input.pointsDelta,
                        reason_code: input.reasonCode,
                    },
                    ipAddress: input.ipAddress,
                    userAgent: input.userAgent,
                },
            });

            return { ledger, summary };
        });
    }
}
