import {
    PointsRepository,
    type AdminLedgerFilters,
    type AdminLedgerRow,
    type PointLedgerRow,
    type PointSummaryRow,
    type TopPointUserRow,
} from "./points.repo.js";

export class PointsError extends Error {
    constructor(
        message: string,
        public readonly statusCode: number
    ) {
        super(message);
        this.name = "PointsError";
    }
}

export type PointSummaryResponse = {
    total_points: number;
    lifetime_points_earned: number;
    lifetime_points_removed: number;
    updated_at: string | null;
};

export type PointLedgerItemResponse = {
    id: string;
    points_delta: number;
    reason_code: string;
    note: string | null;
    related_entity_type: string | null;
    related_entity_id: string | null;
    created_at: string;
};

export type AdminLedgerItemResponse = {
    id: string;
    points_delta: number;
    reason_code: string;
    note: string | null;
    created_at: string;
    user_public_id: string;
    user_display_name: string;
    user_email: string;
    created_by_display_name: string | null;
};

export type TopPointUserResponse = {
    public_id: string;
    display_name: string;
    email: string;
    total_points: number;
    lifetime_points_earned: number;
    lifetime_points_removed: number;
};

export type AdminPointChangeInput = {
    pointsDelta: number;
    reasonCode: string;
    note?: string;
    relatedEntityType?: string;
    relatedEntityId?: number;
};

export type AdminPointChangeContext = {
    adminPublicId: string;
    ipAddress?: string | null;
    userAgent?: string | null;
};

export class PointsService {
    constructor(private readonly pointsRepo: PointsRepository) {}

    async getMySummary(userPublicId: string): Promise<PointSummaryResponse> {
        const userId = await this.requireUserId(userPublicId, 401, "User not found");
        const summary = await this.pointsRepo.getSummary(userId);
        return toSummaryResponse(summary);
    }

    async getMyHistory(userPublicId: string, limit: number): Promise<PointLedgerItemResponse[]> {
        const userId = await this.requireUserId(userPublicId, 401, "User not found");
        const rows = await this.pointsRepo.listHistory(userId, limit);
        return rows.map(toLedgerItemResponse);
    }

    async getUserPoints(
        targetPublicId: string,
        limit: number
    ): Promise<{ summary: PointSummaryResponse; history: PointLedgerItemResponse[] }> {
        const userId = await this.requireUserId(targetPublicId, 404, "User not found");
        const [summary, history] = await Promise.all([
            this.pointsRepo.getSummary(userId),
            this.pointsRepo.listHistory(userId, limit),
        ]);

        return {
            summary: toSummaryResponse(summary),
            history: history.map(toLedgerItemResponse),
        };
    }

    async adjustUserPoints(
        targetPublicId: string,
        input: AdminPointChangeInput,
        context: AdminPointChangeContext
    ): Promise<{ ledger: PointLedgerItemResponse; summary: PointSummaryResponse }> {
        const targetUserId = await this.requireUserId(targetPublicId, 404, "User not found");

        // Admin may resolve to null under dev bypass / shared-token access; the
        // created_by / actor FKs are nullable, so this stays append-only and audited.
        const adminUserId = await this.pointsRepo.findActiveUserIdByPublicId(context.adminPublicId);

        const { ledger, summary } = await this.pointsRepo.applyPointChange({
            targetUserId,
            pointsDelta: input.pointsDelta,
            reasonCode: input.reasonCode,
            note: input.note ?? null,
            relatedEntityType: input.relatedEntityType ?? null,
            relatedEntityId:
                input.relatedEntityId !== undefined ? BigInt(input.relatedEntityId) : null,
            adminUserId,
            ipAddress: context.ipAddress ?? null,
            userAgent: context.userAgent ?? null,
        });

        return {
            ledger: toLedgerItemResponse(ledger),
            summary: toSummaryResponse(summary),
        };
    }

    async listRecentLedger(filters: {
        userId?: string;
        reasonCode?: string;
        page: number;
        pageSize: number;
    }): Promise<{
        items: AdminLedgerItemResponse[];
        total: number;
        page: number;
        pageSize: number;
    }> {
        const repoFilters: AdminLedgerFilters = {
            userPublicId: filters.userId,
            reasonCode: filters.reasonCode,
            page: filters.page,
            pageSize: filters.pageSize,
        };
        const { items, total } = await this.pointsRepo.listRecentLedger(repoFilters);
        return {
            items: items.map(toAdminLedgerItemResponse),
            total,
            page: filters.page,
            pageSize: filters.pageSize,
        };
    }

    async getTopUsers(limit: number): Promise<TopPointUserResponse[]> {
        const rows = await this.pointsRepo.topUsers(limit);
        return rows.map(toTopPointUserResponse);
    }

    private async requireUserId(
        publicId: string,
        notFoundStatus: number,
        message: string
    ): Promise<bigint> {
        const userId = await this.pointsRepo.findActiveUserIdByPublicId(publicId);

        if (userId === null) {
            throw new PointsError(message, notFoundStatus);
        }

        return userId;
    }
}

function toSummaryResponse(summary: PointSummaryRow | null): PointSummaryResponse {
    if (!summary) {
        return {
            total_points: 0,
            lifetime_points_earned: 0,
            lifetime_points_removed: 0,
            updated_at: null,
        };
    }

    return {
        total_points: summary.totalPoints,
        lifetime_points_earned: summary.lifetimePointsEarned,
        lifetime_points_removed: summary.lifetimePointsRemoved,
        updated_at: summary.updatedAt.toISOString(),
    };
}

function toAdminLedgerItemResponse(row: AdminLedgerRow): AdminLedgerItemResponse {
    return {
        id: row.id.toString(),
        points_delta: row.points_delta,
        reason_code: row.reason_code,
        note: row.note,
        created_at: row.created_at.toISOString(),
        user_public_id: row.user_public_id,
        user_display_name: row.user_display_name,
        user_email: row.user_email,
        created_by_display_name: row.created_by_display_name,
    };
}

function toTopPointUserResponse(row: TopPointUserRow): TopPointUserResponse {
    return {
        public_id: row.public_id,
        display_name: row.display_name,
        email: row.email,
        total_points: row.total_points,
        lifetime_points_earned: row.lifetime_points_earned,
        lifetime_points_removed: row.lifetime_points_removed,
    };
}

function toLedgerItemResponse(row: PointLedgerRow): PointLedgerItemResponse {
    return {
        id: row.id.toString(),
        points_delta: row.pointsDelta,
        reason_code: row.reasonCode,
        note: row.note,
        related_entity_type: row.relatedEntityType,
        related_entity_id: row.relatedEntityId !== null ? row.relatedEntityId.toString() : null,
        created_at: row.createdAt.toISOString(),
    };
}
