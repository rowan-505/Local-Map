import { Prisma, type PrismaClient } from "@prisma/client";

/** system.audit_logs.entity_type used for all report-related audit entries. */
export const REPORT_ENTITY_TYPE = "user_report";
/** contrib.point_ledger.related_entity_type used for report rewards. */
export const REPORT_LEDGER_RELATED_ENTITY_TYPE = "report";

export type PointSummaryRow = {
    total_points: number;
    lifetime_points_earned: number;
    lifetime_points_removed: number;
    updated_at: Date;
};

/**
 * Radius (meters) used to treat two map_point reports of the same type from the
 * same submitter as duplicates. Midpoint of the 50–100m product guidance.
 */
export const DUPLICATE_MAP_POINT_RADIUS_METERS = 75;

export type SubmitterKey = {
    createdBy: bigint | null;
    anonymousId: string | null;
};

export type SubmissionStats = {
    count24h: number;
    lastCreatedAt: Date | null;
};

export type ReportRow = {
    id: bigint;
    public_id: string;
    created_by: bigint | null;
    anonymous_id: string | null;
    is_anonymous: boolean;
    eligible_for_points: boolean;
    report_type_code: string;
    report_type_name: string;
    status_code: string;
    status_name: string;
    reason_code: string | null;
    target_entity_type: string | null;
    target_entity_id: bigint | null;
    target_public_id: string | null;
    title: string | null;
    description: string;
    latitude: number | null;
    longitude: number | null;
    admin_area_id: bigint | null;
    priority: string;
    confidence_score: number;
    reviewed_by: bigint | null;
    reviewed_at: Date | null;
    admin_note: string | null;
    reward_ledger_id: bigint | null;
    reward_granted_at: Date | null;
    created_at: Date;
    updated_at: Date;
    author_public_id: string | null;
    author_display_name: string | null;
    author_email: string | null;
};

export type StatusEventRow = {
    id: bigint;
    old_status_code: string | null;
    new_status_code: string;
    actor_user_id: bigint | null;
    actor_display_name: string | null;
    note: string | null;
    created_at: Date;
};

export type FollowupRow = {
    id: bigint;
    actor_type: string;
    actor_user_id: bigint | null;
    actor_display_name: string | null;
    message: string;
    created_at: Date;
};

export type CreateReportInput = {
    createdBy: bigint | null;
    anonymousId: string | null;
    isAnonymous: boolean;
    eligibleForPoints: boolean;
    reportTypeCode: string;
    reasonCode: string | null;
    targetEntityType: string;
    targetEntityId: bigint | null;
    targetPublicId: string | null;
    title: string | null;
    description: string;
    latitude: number | null;
    longitude: number | null;
};

export type ReportAnalyticsSummaryRow = {
    total: number;
    submitted: number;
    in_review: number;
    needs_more_info: number;
    accepted: number;
    rejected: number;
    duplicate: number;
    anonymous: number;
    logged_in: number;
    this_week: number;
    this_month: number;
};

export type ReportAnalyticsCodeCountRow = { code: string; name: string; count: number };
export type ReportAnalyticsRegionCountRow = {
    region_id: bigint | null;
    region_name: string | null;
    count: number;
};
export type ReportAnalyticsAnonymousRow = { anonymous: number; logged_in: number };

export type AdminReportFilters = {
    statusCode?: string;
    reportTypeCode?: string;
    adminAreaId?: bigint;
    targetEntityType?: string;
    isAnonymous?: boolean;
    createdFrom?: Date;
    createdTo?: Date;
    page: number;
    pageSize: number;
};

export type AuditContext = {
    actorUserId: bigint | null;
    ipAddress: string | null;
    userAgent: string | null;
};

// Shared projection so list/detail/create return identical row shapes.
const reportSelect = Prisma.sql`
    SELECT
        r.id,
        r.public_id::text AS public_id,
        r.created_by,
        r.anonymous_id,
        r.is_anonymous,
        r.eligible_for_points,
        r.report_type_code,
        rt.name AS report_type_name,
        r.status_code,
        rs.name AS status_name,
        r.reason_code,
        r.target_entity_type,
        r.target_entity_id,
        r.target_public_id::text AS target_public_id,
        r.title,
        r.description,
        ST_Y(r.geom) AS latitude,
        ST_X(r.geom) AS longitude,
        r.admin_area_id,
        r.priority,
        r.confidence_score,
        r.reviewed_by,
        r.reviewed_at,
        r.admin_note,
        r.reward_ledger_id,
        r.reward_granted_at,
        r.created_at,
        r.updated_at,
        u.public_id::text AS author_public_id,
        u.display_name AS author_display_name,
        u.email AS author_email
    FROM feedback.user_reports r
    JOIN ref.ref_report_types rt ON rt.code = r.report_type_code
    JOIN ref.ref_report_statuses rs ON rs.code = r.status_code
    LEFT JOIN app_auth.auth_users u ON u.id = r.created_by
`;

export class ReportsRepository {
    constructor(private readonly prisma: PrismaClient) {}

    /** Resolves the internal user id from a JWT subject (public_id uuid); null when missing. */
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

    /** Like findActiveUserIdByPublicId but also returns verification state (for rate-limit tiers). */
    async findActiveUserByPublicId(
        publicId: string
    ): Promise<{ id: bigint; emailVerified: boolean } | null> {
        const rows = await this.prisma.$queryRaw<{ id: bigint; email_verified: boolean }[]>(Prisma.sql`
            SELECT id, email_verified
            FROM app_auth.auth_users
            WHERE public_id::text = ${publicId}
              AND deleted_at IS NULL
            LIMIT 1
        `);
        const row = rows[0];
        return row ? { id: row.id, emailVerified: row.email_verified } : null;
    }

    /**
     * Per-submitter submission stats used for DB-based rate limiting: count of
     * reports in the last 24h plus the most recent report timestamp (cooldown).
     */
    async getSubmissionStats(key: SubmitterKey): Promise<SubmissionStats> {
        const rows = await this.prisma.$queryRaw<{ count_24h: number; last_created_at: Date | null }[]>(Prisma.sql`
            SELECT
                (COUNT(*) FILTER (WHERE created_at >= now() - interval '24 hours'))::int AS count_24h,
                MAX(created_at) AS last_created_at
            FROM feedback.user_reports
            WHERE ${submitterMatchSql(key)}
        `);
        return {
            count24h: rows[0]?.count_24h ?? 0,
            lastCreatedAt: rows[0]?.last_created_at ?? null,
        };
    }

    /**
     * Finds a recent (≤24h) duplicate from the SAME submitter: same report type and
     * either the same entity target, or — for map points — an existing report whose
     * geom is within {@link DUPLICATE_MAP_POINT_RADIUS_METERS}. Returns its public_id.
     */
    async findRecentDuplicate(input: {
        createdBy: bigint | null;
        anonymousId: string | null;
        reportTypeCode: string;
        targetEntityType: string;
        targetEntityId: bigint | null;
        latitude: number | null;
        longitude: number | null;
    }): Promise<string | null> {
        let targetCondition: Prisma.Sql;
        if (input.targetEntityType === "map_point") {
            if (input.latitude === null || input.longitude === null) {
                return null;
            }
            const point = Prisma.sql`ST_SetSRID(ST_MakePoint(${input.longitude}, ${input.latitude}), 4326)`;
            targetCondition = Prisma.sql`
                r.target_entity_type = 'map_point'
                AND r.geom IS NOT NULL
                AND ST_DWithin(r.geom::geography, ${point}::geography, ${DUPLICATE_MAP_POINT_RADIUS_METERS})
                ORDER BY ST_Distance(r.geom::geography, ${point}::geography) ASC
            `;
        } else {
            if (input.targetEntityId === null) {
                return null;
            }
            targetCondition = Prisma.sql`
                r.target_entity_type = ${input.targetEntityType}
                AND r.target_entity_id = ${input.targetEntityId}
                ORDER BY r.created_at DESC
            `;
        }

        const rows = await this.prisma.$queryRaw<{ public_id: string }[]>(Prisma.sql`
            SELECT r.public_id::text AS public_id
            FROM feedback.user_reports r
            WHERE ${submitterMatchSql({ createdBy: input.createdBy, anonymousId: input.anonymousId }, "r")}
              AND r.report_type_code = ${input.reportTypeCode}
              AND r.created_at >= now() - interval '24 hours'
              AND ${targetCondition}
            LIMIT 1
        `);
        return rows[0]?.public_id ?? null;
    }

    /**
     * Creates a report and its initial 'submitted' status event atomically. When
     * coordinates are present, geom is derived via PostGIS and admin_area_id is
     * inferred from the existing core.find_admin_area_for_point lookup.
     */
    async createReport(input: CreateReportInput): Promise<ReportRow> {
        const hasGeom = input.latitude !== null && input.longitude !== null;
        const pointSql = hasGeom
            ? Prisma.sql`ST_SetSRID(ST_MakePoint(${input.longitude}, ${input.latitude}), 4326)`
            : null;
        const geomSql = pointSql ?? Prisma.sql`NULL`;
        const adminAreaSql = pointSql
            ? Prisma.sql`core.find_admin_area_for_point(${pointSql}, NULL)`
            : Prisma.sql`NULL`;

        return this.prisma.$transaction(async (tx) => {
            const inserted = await tx.$queryRaw<{ id: bigint }[]>(Prisma.sql`
                INSERT INTO feedback.user_reports (
                    created_by, anonymous_id, is_anonymous, eligible_for_points,
                    report_type_code, status_code, reason_code,
                    target_entity_type, target_entity_id, target_public_id,
                    title, description, geom, admin_area_id
                ) VALUES (
                    ${input.createdBy}, ${input.anonymousId}, ${input.isAnonymous}, ${input.eligibleForPoints},
                    ${input.reportTypeCode}, 'submitted', ${input.reasonCode},
                    ${input.targetEntityType}, ${input.targetEntityId}, ${input.targetPublicId}::uuid,
                    ${input.title}, ${input.description}, ${geomSql}, ${adminAreaSql}
                )
                RETURNING id
            `);

            const id = inserted[0]!.id;

            await tx.$executeRaw(Prisma.sql`
                INSERT INTO feedback.report_status_events
                    (report_id, old_status_code, new_status_code, actor_user_id, note)
                VALUES (${id}, NULL, 'submitted', ${input.createdBy}, NULL)
            `);

            const rows = await tx.$queryRaw<ReportRow[]>(
                Prisma.sql`${reportSelect} WHERE r.id = ${id} LIMIT 1`
            );
            return rows[0]!;
        });
    }

    async findByPublicId(publicId: string): Promise<ReportRow | null> {
        const rows = await this.prisma.$queryRaw<ReportRow[]>(
            Prisma.sql`${reportSelect} WHERE r.public_id::text = ${publicId} LIMIT 1`
        );
        return rows[0] ?? null;
    }

    async listForUser(userId: bigint, limit: number): Promise<ReportRow[]> {
        return this.prisma.$queryRaw<ReportRow[]>(Prisma.sql`
            ${reportSelect}
            WHERE r.created_by = ${userId}
            ORDER BY r.created_at DESC, r.id DESC
            LIMIT ${limit}
        `);
    }

    async listStatusEvents(reportId: bigint): Promise<StatusEventRow[]> {
        return this.prisma.$queryRaw<StatusEventRow[]>(Prisma.sql`
            SELECT
                e.id,
                e.old_status_code,
                e.new_status_code,
                e.actor_user_id,
                au.display_name AS actor_display_name,
                e.note,
                e.created_at
            FROM feedback.report_status_events e
            LEFT JOIN app_auth.auth_users au ON au.id = e.actor_user_id
            WHERE e.report_id = ${reportId}
            ORDER BY e.created_at ASC, e.id ASC
        `);
    }

    async listFollowups(reportId: bigint): Promise<FollowupRow[]> {
        return this.prisma.$queryRaw<FollowupRow[]>(Prisma.sql`
            SELECT
                f.id,
                f.actor_type,
                f.actor_user_id,
                au.display_name AS actor_display_name,
                f.message,
                f.created_at
            FROM feedback.report_followups f
            LEFT JOIN app_auth.auth_users au ON au.id = f.actor_user_id
            WHERE f.report_id = ${reportId}
            ORDER BY f.created_at ASC, f.id ASC
        `);
    }

    async listAdmin(
        filters: AdminReportFilters
    ): Promise<{ items: ReportRow[]; total: number }> {
        const conditions: Prisma.Sql[] = [];
        if (filters.statusCode) {
            conditions.push(Prisma.sql`r.status_code = ${filters.statusCode}`);
        }
        if (filters.reportTypeCode) {
            conditions.push(Prisma.sql`r.report_type_code = ${filters.reportTypeCode}`);
        }
        if (filters.adminAreaId !== undefined) {
            conditions.push(Prisma.sql`r.admin_area_id = ${filters.adminAreaId}`);
        }
        if (filters.targetEntityType) {
            conditions.push(Prisma.sql`r.target_entity_type = ${filters.targetEntityType}`);
        }
        if (filters.isAnonymous !== undefined) {
            conditions.push(Prisma.sql`r.is_anonymous = ${filters.isAnonymous}`);
        }
        if (filters.createdFrom) {
            conditions.push(Prisma.sql`r.created_at >= ${filters.createdFrom}`);
        }
        if (filters.createdTo) {
            // Inclusive of the whole selected end day.
            conditions.push(Prisma.sql`r.created_at < ${filters.createdTo} + interval '1 day'`);
        }
        const where = conditions.length
            ? Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}`
            : Prisma.empty;

        const offset = (filters.page - 1) * filters.pageSize;

        const items = await this.prisma.$queryRaw<ReportRow[]>(Prisma.sql`
            ${reportSelect}
            ${where}
            ORDER BY r.created_at DESC, r.id DESC
            LIMIT ${filters.pageSize} OFFSET ${offset}
        `);

        const totalRows = await this.prisma.$queryRaw<{ total: number }[]>(Prisma.sql`
            SELECT COUNT(*)::int AS total
            FROM feedback.user_reports r
            ${where}
        `);

        return { items, total: totalRows[0]?.total ?? 0 };
    }

    // --- Analytics (lightweight aggregate counts; no retention/funnel logic) ---

    async analyticsSummary(): Promise<ReportAnalyticsSummaryRow> {
        const rows = await this.prisma.$queryRaw<ReportAnalyticsSummaryRow[]>(Prisma.sql`
            SELECT
                (COUNT(*))::int AS total,
                (COUNT(*) FILTER (WHERE status_code = 'submitted'))::int AS submitted,
                (COUNT(*) FILTER (WHERE status_code = 'in_review'))::int AS in_review,
                (COUNT(*) FILTER (WHERE status_code = 'needs_more_info'))::int AS needs_more_info,
                (COUNT(*) FILTER (WHERE status_code = 'accepted'))::int AS accepted,
                (COUNT(*) FILTER (WHERE status_code = 'rejected'))::int AS rejected,
                (COUNT(*) FILTER (WHERE status_code = 'duplicate'))::int AS duplicate,
                (COUNT(*) FILTER (WHERE is_anonymous))::int AS anonymous,
                (COUNT(*) FILTER (WHERE NOT is_anonymous))::int AS logged_in,
                (COUNT(*) FILTER (WHERE created_at >= date_trunc('week', now())))::int AS this_week,
                (COUNT(*) FILTER (WHERE created_at >= date_trunc('month', now())))::int AS this_month
            FROM feedback.user_reports
        `);
        return rows[0]!;
    }

    async analyticsByType(): Promise<ReportAnalyticsCodeCountRow[]> {
        return this.prisma.$queryRaw<ReportAnalyticsCodeCountRow[]>(Prisma.sql`
            SELECT rt.code, rt.name, (COUNT(r.id))::int AS count
            FROM ref.ref_report_types rt
            LEFT JOIN feedback.user_reports r ON r.report_type_code = rt.code
            GROUP BY rt.code, rt.name
            ORDER BY count DESC, rt.code
        `);
    }

    async analyticsByStatus(): Promise<ReportAnalyticsCodeCountRow[]> {
        return this.prisma.$queryRaw<ReportAnalyticsCodeCountRow[]>(Prisma.sql`
            SELECT rs.code, rs.name, (COUNT(r.id))::int AS count
            FROM ref.ref_report_statuses rs
            LEFT JOIN feedback.user_reports r ON r.status_code = rs.code
            GROUP BY rs.code, rs.name
            ORDER BY count DESC, rs.code
        `);
    }

    async analyticsByRegion(): Promise<ReportAnalyticsRegionCountRow[]> {
        return this.prisma.$queryRaw<ReportAnalyticsRegionCountRow[]>(Prisma.sql`
            SELECT r.admin_area_id AS region_id, a.canonical_name AS region_name, (COUNT(*))::int AS count
            FROM feedback.user_reports r
            LEFT JOIN core.core_admin_areas a ON a.id = r.admin_area_id
            GROUP BY r.admin_area_id, a.canonical_name
            ORDER BY count DESC, region_name NULLS LAST
        `);
    }

    async analyticsAnonymousVsLoggedIn(): Promise<ReportAnalyticsAnonymousRow> {
        const rows = await this.prisma.$queryRaw<ReportAnalyticsAnonymousRow[]>(Prisma.sql`
            SELECT
                (COUNT(*) FILTER (WHERE is_anonymous))::int AS anonymous,
                (COUNT(*) FILTER (WHERE NOT is_anonymous))::int AS logged_in
            FROM feedback.user_reports
        `);
        return rows[0]!;
    }

    /** Adds a follow-up message. Used for both admin request-info and user replies. */
    async insertFollowup(input: {
        reportId: bigint;
        actorUserId: bigint | null;
        actorType: "admin" | "user" | "system";
        message: string;
    }): Promise<void> {
        await this.prisma.$executeRaw(Prisma.sql`
            INSERT INTO feedback.report_followups (report_id, actor_user_id, actor_type, message)
            VALUES (${input.reportId}, ${input.actorUserId}, ${input.actorType}, ${input.message})
        `);
    }

    /**
     * User reply: append a 'user' follow-up and move the report back to 'submitted'
     * (the same report row is reused — no new report is created).
     */
    async addUserReply(input: {
        reportId: bigint;
        userId: bigint;
        fromStatusCode: string;
        message: string;
    }): Promise<ReportRow> {
        return this.prisma.$transaction(async (tx) => {
            await tx.$executeRaw(Prisma.sql`
                INSERT INTO feedback.report_followups (report_id, actor_user_id, actor_type, message)
                VALUES (${input.reportId}, ${input.userId}, 'user', ${input.message})
            `);
            await tx.$executeRaw(Prisma.sql`
                INSERT INTO feedback.report_status_events
                    (report_id, old_status_code, new_status_code, actor_user_id, note)
                VALUES (${input.reportId}, ${input.fromStatusCode}, 'submitted', ${input.userId}, NULL)
            `);
            await tx.$executeRaw(Prisma.sql`
                UPDATE feedback.user_reports
                SET status_code = 'submitted', updated_at = now()
                WHERE id = ${input.reportId}
            `);
            const rows = await tx.$queryRaw<ReportRow[]>(
                Prisma.sql`${reportSelect} WHERE r.id = ${input.reportId} LIMIT 1`
            );
            return rows[0]!;
        });
    }

    /** Admin status change: update + status event + audit, atomically. */
    async changeStatus(input: {
        reportId: bigint;
        fromStatusCode: string;
        toStatusCode: string;
        note: string | null;
        audit: AuditContext;
    }): Promise<ReportRow> {
        return this.prisma.$transaction(async (tx) => {
            await tx.$executeRaw(Prisma.sql`
                UPDATE feedback.user_reports
                SET status_code = ${input.toStatusCode},
                    reviewed_by = ${input.audit.actorUserId},
                    reviewed_at = now(),
                    updated_at = now()
                WHERE id = ${input.reportId}
            `);
            await tx.$executeRaw(Prisma.sql`
                INSERT INTO feedback.report_status_events
                    (report_id, old_status_code, new_status_code, actor_user_id, note)
                VALUES (${input.reportId}, ${input.fromStatusCode}, ${input.toStatusCode}, ${input.audit.actorUserId}, ${input.note})
            `);
            await insertReportAudit(tx, {
                actionType: "report_status_changed",
                reportId: input.reportId,
                before: { status_code: input.fromStatusCode },
                after: { status_code: input.toStatusCode },
                audit: input.audit,
            });
            return selectById(tx, input.reportId);
        });
    }

    /**
     * Admin request-info: append an 'admin' follow-up, move to 'needs_more_info',
     * record the status event + audit. Reuses the existing report row.
     */
    async requestInfo(input: {
        reportId: bigint;
        fromStatusCode: string;
        message: string;
        audit: AuditContext;
    }): Promise<ReportRow> {
        return this.prisma.$transaction(async (tx) => {
            await tx.$executeRaw(Prisma.sql`
                INSERT INTO feedback.report_followups (report_id, actor_user_id, actor_type, message)
                VALUES (${input.reportId}, ${input.audit.actorUserId}, 'admin', ${input.message})
            `);
            await tx.$executeRaw(Prisma.sql`
                UPDATE feedback.user_reports
                SET status_code = 'needs_more_info',
                    reviewed_by = ${input.audit.actorUserId},
                    reviewed_at = now(),
                    updated_at = now()
                WHERE id = ${input.reportId}
            `);
            await tx.$executeRaw(Prisma.sql`
                INSERT INTO feedback.report_status_events
                    (report_id, old_status_code, new_status_code, actor_user_id, note)
                VALUES (${input.reportId}, ${input.fromStatusCode}, 'needs_more_info', ${input.audit.actorUserId}, NULL)
            `);
            await insertReportAudit(tx, {
                actionType: "report_info_requested",
                reportId: input.reportId,
                before: { status_code: input.fromStatusCode },
                after: { status_code: "needs_more_info" },
                audit: input.audit,
            });
            return selectById(tx, input.reportId);
        });
    }

    async updateAdminNote(input: {
        reportId: bigint;
        adminNote: string | null;
        audit: AuditContext;
    }): Promise<ReportRow> {
        return this.prisma.$transaction(async (tx) => {
            await tx.$executeRaw(Prisma.sql`
                UPDATE feedback.user_reports
                SET admin_note = ${input.adminNote}, updated_at = now()
                WHERE id = ${input.reportId}
            `);
            await insertReportAudit(tx, {
                actionType: "report_admin_note_updated",
                reportId: input.reportId,
                before: null,
                after: { has_note: input.adminNote !== null },
                audit: input.audit,
            });
            return selectById(tx, input.reportId);
        });
    }

    /**
     * Grants a manual point reward/penalty for an accepted report. Inserts an
     * append-only ledger row (signed points_delta), updates the summary cache,
     * links the ledger row onto the report (reward_ledger_id), and writes an
     * audit log — all atomically. Returns the refreshed report + point summary.
     */
    async grantReward(input: {
        reportId: bigint;
        targetUserId: bigint;
        pointsDelta: number;
        reasonCode: string;
        note: string | null;
        audit: AuditContext;
    }): Promise<{ report: ReportRow; summary: PointSummaryRow }> {
        const earned = input.pointsDelta > 0 ? input.pointsDelta : 0;
        const removed = input.pointsDelta < 0 ? Math.abs(input.pointsDelta) : 0;

        return this.prisma.$transaction(async (tx) => {
            const beforeRows = await tx.$queryRaw<{ total_points: number }[]>(Prisma.sql`
                SELECT total_points FROM contrib.user_point_summary WHERE user_id = ${input.targetUserId}
            `);
            const beforeTotal = beforeRows[0]?.total_points ?? 0;

            const ledger = await tx.$queryRaw<{ id: bigint }[]>(Prisma.sql`
                INSERT INTO contrib.point_ledger
                    (user_id, points_delta, reason_code, related_entity_type, related_entity_id, note, created_by)
                VALUES (
                    ${input.targetUserId}, ${input.pointsDelta}, ${input.reasonCode},
                    ${REPORT_LEDGER_RELATED_ENTITY_TYPE}, ${input.reportId}, ${input.note}, ${input.audit.actorUserId}
                )
                RETURNING id
            `);
            const rewardLedgerId = ledger[0]!.id;

            const summaryRows = await tx.$queryRaw<PointSummaryRow[]>(Prisma.sql`
                INSERT INTO contrib.user_point_summary
                    (user_id, total_points, lifetime_points_earned, lifetime_points_removed)
                VALUES (${input.targetUserId}, ${input.pointsDelta}, ${earned}, ${removed})
                ON CONFLICT (user_id) DO UPDATE SET
                    total_points = contrib.user_point_summary.total_points + ${input.pointsDelta},
                    lifetime_points_earned = contrib.user_point_summary.lifetime_points_earned + ${earned},
                    lifetime_points_removed = contrib.user_point_summary.lifetime_points_removed + ${removed},
                    updated_at = now()
                RETURNING total_points, lifetime_points_earned, lifetime_points_removed, updated_at
            `);

            await tx.$executeRaw(Prisma.sql`
                UPDATE feedback.user_reports
                SET reward_ledger_id = ${rewardLedgerId},
                    reward_granted_at = now(),
                    updated_at = now()
                WHERE id = ${input.reportId}
            `);

            await insertReportAudit(tx, {
                actionType: "report_points_rewarded",
                reportId: input.reportId,
                before: { total_points: beforeTotal },
                after: {
                    total_points: beforeTotal + input.pointsDelta,
                    points_delta: input.pointsDelta,
                    reason_code: input.reasonCode,
                    reward_ledger_id: rewardLedgerId.toString(),
                },
                audit: input.audit,
            });

            return { report: await selectById(tx, input.reportId), summary: summaryRows[0]! };
        });
    }
}

type TxClient = Prisma.TransactionClient;

/**
 * Matches reports by their submitter: created_by for signed-in users, otherwise
 * anonymous_id. Callers guarantee exactly one key is non-null. `alias` prefixes
 * the column when the query aliases feedback.user_reports (e.g. "r").
 */
function submitterMatchSql(key: SubmitterKey, alias?: string): Prisma.Sql {
    const prefix = alias ? `${alias}.` : "";
    if (key.createdBy !== null) {
        return Prisma.sql`${Prisma.raw(`${prefix}created_by`)} = ${key.createdBy}`;
    }
    return Prisma.sql`${Prisma.raw(`${prefix}anonymous_id`)} = ${key.anonymousId}`;
}

async function selectById(tx: TxClient, reportId: bigint): Promise<ReportRow> {
    const rows = await tx.$queryRaw<ReportRow[]>(
        Prisma.sql`${reportSelect} WHERE r.id = ${reportId} LIMIT 1`
    );
    return rows[0]!;
}

async function insertReportAudit(
    tx: TxClient,
    input: {
        actionType: string;
        reportId: bigint;
        before: Record<string, unknown> | null;
        after: Record<string, unknown> | null;
        audit: AuditContext;
    }
): Promise<void> {
    const before = input.before === null ? Prisma.sql`NULL` : Prisma.sql`${JSON.stringify(input.before)}::jsonb`;
    const after = input.after === null ? Prisma.sql`NULL` : Prisma.sql`${JSON.stringify(input.after)}::jsonb`;
    await tx.$executeRaw(Prisma.sql`
        INSERT INTO system.audit_logs
            (actor_user_id, action_type, entity_type, entity_id, before_snapshot, after_snapshot, ip_address, user_agent)
        VALUES (
            ${input.audit.actorUserId}, ${input.actionType}, ${REPORT_ENTITY_TYPE}, ${input.reportId},
            ${before}, ${after}, ${input.audit.ipAddress}, ${input.audit.userAgent}
        )
    `);
}
