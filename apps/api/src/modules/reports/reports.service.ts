import {
    ReportsRepository,
    type AuditContext,
    type FollowupRow,
    type PointSummaryRow,
    type ReportAnalyticsAnonymousRow,
    type ReportAnalyticsCodeCountRow,
    type ReportAnalyticsSummaryRow,
    type ReportRow,
    type StatusEventRow,
} from "./reports.repo.js";
import type { AdminReportsQuery, ReportCreateBody } from "./reports.schema.js";

export type ReportRegionCountResponse = {
    region_id: string | null;
    region_name: string | null;
    count: number;
};

export class ReportsError extends Error {
    constructor(
        message: string,
        public readonly statusCode: number
    ) {
        super(message);
        this.name = "ReportsError";
    }
}

/** Shown for both daily-cap and cooldown rejections (kept identical on purpose). */
export const REPORT_RATE_LIMIT_MESSAGE =
    "You have reached the report limit. Please try again later.";

const MINUTE_MS = 60 * 1000;

type RateLimit = { maxPerDay: number; cooldownMs: number };

/**
 * Per-tier report limits. Anonymous and unverified accounts are throttled hardest.
 * Admins/super_admins bypass these entirely (handled by the caller).
 *
 * TODO(trusted_contributor): when a trusted-contributor badge table exists, grant
 * { maxPerDay: 40, cooldownMs: 1 * MINUTE_MS }. Until then such users are treated
 * as verified users (the branch below).
 */
function resolveRateLimit(tier: { isAnonymous: boolean; emailVerified: boolean }): RateLimit {
    if (tier.isAnonymous) {
        return { maxPerDay: 3, cooldownMs: 10 * MINUTE_MS };
    }
    if (tier.emailVerified) {
        return { maxPerDay: 15, cooldownMs: 2 * MINUTE_MS };
    }
    return { maxPerDay: 5, cooldownMs: 5 * MINUTE_MS };
}

/**
 * Status transitions an admin may perform via PATCH /status. Two transitions are
 * intentionally NOT here because they have dedicated channels:
 *   * → needs_more_info  is done via POST /request-info (it attaches a question).
 *   * needs_more_info → submitted  happens only via a user follow-up reply.
 * accepted / rejected / duplicate are terminal.
 */
const ADMIN_STATUS_TRANSITIONS: Record<string, readonly string[]> = {
    submitted: ["in_review", "duplicate"],
    in_review: ["accepted", "rejected", "duplicate"],
};

/** Statuses from which an admin may request more info (→ needs_more_info). */
const REQUEST_INFO_ALLOWED_FROM = ["submitted", "in_review"] as const;

function assertAdminStatusTransition(from: string, to: string): void {
    if (from === to) {
        throw new ReportsError(`Report is already '${to}'`, 409);
    }
    const allowed = ADMIN_STATUS_TRANSITIONS[from] ?? [];
    if (!allowed.includes(to)) {
        throw new ReportsError(`Cannot change report status from '${from}' to '${to}'`, 409);
    }
}

export type ReportResponse = {
    public_id: string;
    is_anonymous: boolean;
    eligible_for_points: boolean;
    report_type: { code: string; name: string };
    status: { code: string; name: string };
    reason_code: string | null;
    target_entity_type: string | null;
    target_entity_id: string | null;
    target_public_id: string | null;
    title: string | null;
    description: string;
    latitude: number | null;
    longitude: number | null;
    admin_area_id: string | null;
    priority: string;
    confidence_score: number;
    admin_note: string | null;
    reviewed_at: string | null;
    reward_granted_at: string | null;
    created_at: string;
    updated_at: string;
};

export type AdminReportResponse = ReportResponse & {
    author: { public_id: string; display_name: string | null; email: string } | null;
    anonymous_id: string | null;
};

export type StatusEventResponse = {
    old_status_code: string | null;
    new_status_code: string;
    actor_display_name: string | null;
    note: string | null;
    created_at: string;
};

export type FollowupResponse = {
    actor_type: string;
    actor_display_name: string | null;
    message: string;
    created_at: string;
};

export type PointSummaryResponse = {
    total_points: number;
    lifetime_points_earned: number;
    lifetime_points_removed: number;
    updated_at: string;
};

export type RewardResult = {
    report: AdminReportResponse;
    summary: PointSummaryResponse;
};

export type ReportViewer = {
    /** JWT subject (public_id uuid) when authenticated, else null. */
    jwtSub: string | null;
    /** Roles from the verified JWT (used only for admin rate-limit bypass). */
    roles: string[];
    /** x-anonymous-id header (or body) when present. */
    anonymousId: string | null;
};

export type CreateReportResult = {
    /** false when an existing duplicate is returned instead of inserting a new row. */
    created: boolean;
    report: ReportResponse;
    /** Human-facing notice when a duplicate was detected. */
    message: string | null;
};

export class ReportsService {
    constructor(private readonly reportsRepo: ReportsRepository) {}

    async create(
        viewer: ReportViewer,
        body: ReportCreateBody,
        audit: AuditContext
    ): Promise<CreateReportResult> {
        const authenticated = viewer.jwtSub !== null;
        let createdBy: bigint | null = null;
        let emailVerified = false;
        if (authenticated) {
            const user = await this.reportsRepo.findActiveUserByPublicId(viewer.jwtSub!);
            createdBy = user?.id ?? null;
            emailVerified = user?.emailVerified ?? false;
        }
        const isAnonymous = !authenticated;

        const anonymousId = body.anonymousId?.trim() || viewer.anonymousId?.trim() || null;
        if (isAnonymous && !anonymousId) {
            throw new ReportsError("anonymous_id is required for anonymous reports", 400);
        }

        const isMapPoint = body.targetEntityType === "map_point";
        const targetEntityId =
            isMapPoint || body.targetEntityId === undefined ? null : BigInt(body.targetEntityId);
        const latitude = body.latitude ?? null;
        const longitude = body.longitude ?? null;

        // Counting key for limit + duplicate checks: created_by, else anonymous_id.
        const submitterKey =
            createdBy !== null
                ? { createdBy, anonymousId: null }
                : isAnonymous && anonymousId
                  ? { createdBy: null, anonymousId }
                  : null;

        const isAdmin = viewer.roles.includes("admin") || viewer.roles.includes("super_admin");

        // 1. Duplicate protection — only ever matches the SAME submitter's recent
        //    reports; never auto-rejects across different users.
        if (submitterKey) {
            const duplicatePublicId = await this.reportsRepo.findRecentDuplicate({
                ...submitterKey,
                reportTypeCode: body.reportTypeCode,
                targetEntityType: body.targetEntityType,
                targetEntityId,
                latitude,
                longitude,
            });
            if (duplicatePublicId) {
                const existing = await this.reportsRepo.findByPublicId(duplicatePublicId);
                if (existing) {
                    return {
                        created: false,
                        report: toReportResponse(existing),
                        message: "A similar report was submitted recently; showing your existing report.",
                    };
                }
            }
        }

        // 2. DB-based rate limiting (admins bypass; no key ⇒ cannot count, so skip).
        if (submitterKey && !isAdmin) {
            const limit = resolveRateLimit({ isAnonymous, emailVerified });
            const stats = await this.reportsRepo.getSubmissionStats(submitterKey);
            if (stats.count24h >= limit.maxPerDay) {
                throw new ReportsError(REPORT_RATE_LIMIT_MESSAGE, 429);
            }
            if (
                stats.lastCreatedAt &&
                Date.now() - stats.lastCreatedAt.getTime() < limit.cooldownMs
            ) {
                throw new ReportsError(REPORT_RATE_LIMIT_MESSAGE, 429);
            }
        }

        const created = await this.reportsRepo.createReport({
            createdBy,
            anonymousId: isAnonymous ? anonymousId : null,
            isAnonymous,
            // Only signed-in reports that resolve to a real user can earn points.
            eligibleForPoints: createdBy !== null,
            reportTypeCode: body.reportTypeCode,
            reasonCode: body.reasonCode?.trim() || null,
            targetEntityType: body.targetEntityType,
            targetEntityId,
            targetPublicId: body.targetPublicId ?? null,
            title: body.title?.trim() || null,
            description: body.description.trim(),
            latitude,
            longitude,
        });

        return { created: true, report: toReportResponse(created), message: null };
    }

    async listMine(jwtSub: string, limit: number): Promise<ReportResponse[]> {
        const userId = await this.requireUserId(jwtSub, 401, "User not found");
        const rows = await this.reportsRepo.listForUser(userId, limit);
        return rows.map(toReportResponse);
    }

    async getForViewer(
        publicId: string,
        viewer: ReportViewer
    ): Promise<ReportResponse & { followups: FollowupResponse[]; status_events: StatusEventResponse[] }> {
        const report = await this.reportsRepo.findByPublicId(publicId);
        if (!report) {
            throw new ReportsError("Report not found", 404);
        }

        await this.assertViewerCanRead(report, viewer);

        const [events, followups] = await Promise.all([
            this.reportsRepo.listStatusEvents(report.id),
            // Anonymous reports never have follow-ups in the MVP.
            report.is_anonymous ? Promise.resolve<FollowupRow[]>([]) : this.reportsRepo.listFollowups(report.id),
        ]);

        return {
            ...toReportResponse(report),
            status_events: events.map(toStatusEventResponse),
            followups: followups.map(toFollowupResponse),
        };
    }

    async addUserFollowup(
        publicId: string,
        viewer: ReportViewer,
        message: string
    ): Promise<ReportResponse & { followups: FollowupResponse[] }> {
        const userId = await this.requireUserId(viewer.jwtSub ?? "", 401, "User not found");
        const report = await this.reportsRepo.findByPublicId(publicId);
        if (!report) {
            throw new ReportsError("Report not found", 404);
        }
        if (report.is_anonymous || report.created_by === null) {
            throw new ReportsError("Anonymous reports do not support follow-ups", 400);
        }
        if (report.created_by !== userId) {
            throw new ReportsError("You can only reply to your own reports", 403);
        }
        if (report.status_code !== "needs_more_info") {
            throw new ReportsError("You can only reply when the report needs more info", 409);
        }

        const updated = await this.reportsRepo.addUserReply({
            reportId: report.id,
            userId,
            fromStatusCode: report.status_code,
            message: message.trim(),
        });
        const followups = await this.reportsRepo.listFollowups(report.id);
        return { ...toReportResponse(updated), followups: followups.map(toFollowupResponse) };
    }

    // --- Admin ---

    async adminList(query: AdminReportsQuery): Promise<{
        items: AdminReportResponse[];
        total: number;
        page: number;
        pageSize: number;
    }> {
        const { items, total } = await this.reportsRepo.listAdmin({
            statusCode: query.status,
            reportTypeCode: query.type,
            adminAreaId: query.adminAreaId !== undefined ? BigInt(query.adminAreaId) : undefined,
            targetEntityType: query.targetEntityType,
            isAnonymous: query.anonymous,
            createdFrom: query.createdFrom,
            createdTo: query.createdTo,
            page: query.page,
            pageSize: query.pageSize,
        });
        return {
            items: items.map(toAdminReportResponse),
            total,
            page: query.page,
            pageSize: query.pageSize,
        };
    }

    // --- Analytics ---

    analyticsSummary(): Promise<ReportAnalyticsSummaryRow> {
        return this.reportsRepo.analyticsSummary();
    }

    analyticsByType(): Promise<ReportAnalyticsCodeCountRow[]> {
        return this.reportsRepo.analyticsByType();
    }

    analyticsByStatus(): Promise<ReportAnalyticsCodeCountRow[]> {
        return this.reportsRepo.analyticsByStatus();
    }

    async analyticsByRegion(): Promise<ReportRegionCountResponse[]> {
        const rows = await this.reportsRepo.analyticsByRegion();
        return rows.map((row) => ({
            region_id: row.region_id !== null ? row.region_id.toString() : null,
            region_name: row.region_name,
            count: row.count,
        }));
    }

    analyticsAnonymousVsLoggedIn(): Promise<ReportAnalyticsAnonymousRow> {
        return this.reportsRepo.analyticsAnonymousVsLoggedIn();
    }

    async adminGet(
        publicId: string
    ): Promise<AdminReportResponse & { followups: FollowupResponse[]; status_events: StatusEventResponse[] }> {
        const report = await this.requireReport(publicId);
        const [events, followups] = await Promise.all([
            this.reportsRepo.listStatusEvents(report.id),
            this.reportsRepo.listFollowups(report.id),
        ]);
        return {
            ...toAdminReportResponse(report),
            status_events: events.map(toStatusEventResponse),
            followups: followups.map(toFollowupResponse),
        };
    }

    async adminChangeStatus(
        publicId: string,
        statusCode: string,
        note: string | undefined,
        audit: AuditContext
    ): Promise<AdminReportResponse> {
        const report = await this.requireReport(publicId);
        assertAdminStatusTransition(report.status_code, statusCode);
        const updated = await this.reportsRepo.changeStatus({
            reportId: report.id,
            fromStatusCode: report.status_code,
            toStatusCode: statusCode,
            note: note?.trim() || null,
            audit,
        });
        return toAdminReportResponse(updated);
    }

    async adminRequestInfo(
        publicId: string,
        message: string,
        audit: AuditContext
    ): Promise<AdminReportResponse & { followups: FollowupResponse[] }> {
        const report = await this.requireReport(publicId);
        if (report.is_anonymous || report.created_by === null) {
            throw new ReportsError("Anonymous reports do not support follow-ups", 400);
        }
        if (!REQUEST_INFO_ALLOWED_FROM.includes(report.status_code as (typeof REQUEST_INFO_ALLOWED_FROM)[number])) {
            throw new ReportsError(
                `Cannot request more info while the report is '${report.status_code}'`,
                409
            );
        }
        const updated = await this.reportsRepo.requestInfo({
            reportId: report.id,
            fromStatusCode: report.status_code,
            message: message.trim(),
            audit,
        });
        const followups = await this.reportsRepo.listFollowups(report.id);
        return { ...toAdminReportResponse(updated), followups: followups.map(toFollowupResponse) };
    }

    async adminUpdateNote(
        publicId: string,
        adminNote: string | null,
        audit: AuditContext
    ): Promise<AdminReportResponse> {
        const report = await this.requireReport(publicId);
        const updated = await this.reportsRepo.updateAdminNote({
            reportId: report.id,
            adminNote: adminNote?.trim() || null,
            audit,
        });
        return toAdminReportResponse(updated);
    }

    async adminRewardPoints(
        publicId: string,
        input: { pointsDelta: number; reasonCode: string; note?: string },
        audit: AuditContext
    ): Promise<RewardResult> {
        const report = await this.requireReport(publicId);

        // Eligibility — points are never granted automatically; admin must act and
        // all of these must hold (see endpoint contract).
        if (report.is_anonymous || report.created_by === null) {
            throw new ReportsError("Anonymous reports cannot receive points", 400);
        }
        if (report.status_code !== "accepted") {
            throw new ReportsError("Points can only be rewarded for accepted reports", 409);
        }
        if (!report.eligible_for_points) {
            throw new ReportsError("Report is not eligible for points", 400);
        }
        if (report.reward_ledger_id !== null) {
            throw new ReportsError("A reward has already been granted for this report", 409);
        }

        const { report: updated, summary } = await this.reportsRepo.grantReward({
            reportId: report.id,
            targetUserId: report.created_by,
            pointsDelta: input.pointsDelta,
            reasonCode: input.reasonCode,
            note: input.note?.trim() || null,
            audit,
        });
        return { report: toAdminReportResponse(updated), summary: toPointSummaryResponse(summary) };
    }

    private async assertViewerCanRead(report: ReportRow, viewer: ReportViewer): Promise<void> {
        if (report.created_by !== null) {
            // Authored report: only the owner may read it via the public endpoint.
            const userId = viewer.jwtSub ? await this.reportsRepo.findActiveUserIdByPublicId(viewer.jwtSub) : null;
            if (userId === null || userId !== report.created_by) {
                throw new ReportsError("Report not found", 404);
            }
            return;
        }
        // Anonymous report: a matching anonymous_id acts as the access token.
        const anon = viewer.anonymousId?.trim() || null;
        if (!report.anonymous_id || !anon || anon !== report.anonymous_id) {
            throw new ReportsError("Report not found", 404);
        }
    }

    private async requireReport(publicId: string): Promise<ReportRow> {
        const report = await this.reportsRepo.findByPublicId(publicId);
        if (!report) {
            throw new ReportsError("Report not found", 404);
        }
        return report;
    }

    private async requireUserId(jwtSub: string, status: number, message: string): Promise<bigint> {
        const userId = jwtSub ? await this.reportsRepo.findActiveUserIdByPublicId(jwtSub) : null;
        if (userId === null) {
            throw new ReportsError(message, status);
        }
        return userId;
    }
}

function toReportResponse(row: ReportRow): ReportResponse {
    return {
        public_id: row.public_id,
        is_anonymous: row.is_anonymous,
        eligible_for_points: row.eligible_for_points,
        report_type: { code: row.report_type_code, name: row.report_type_name },
        status: { code: row.status_code, name: row.status_name },
        reason_code: row.reason_code,
        target_entity_type: row.target_entity_type,
        target_entity_id: row.target_entity_id !== null ? row.target_entity_id.toString() : null,
        target_public_id: row.target_public_id,
        title: row.title,
        description: row.description,
        latitude: row.latitude !== null ? Number(row.latitude) : null,
        longitude: row.longitude !== null ? Number(row.longitude) : null,
        admin_area_id: row.admin_area_id !== null ? row.admin_area_id.toString() : null,
        priority: row.priority,
        confidence_score: row.confidence_score,
        admin_note: row.admin_note,
        reviewed_at: row.reviewed_at ? row.reviewed_at.toISOString() : null,
        reward_granted_at: row.reward_granted_at ? row.reward_granted_at.toISOString() : null,
        created_at: row.created_at.toISOString(),
        updated_at: row.updated_at.toISOString(),
    };
}

function toAdminReportResponse(row: ReportRow): AdminReportResponse {
    return {
        ...toReportResponse(row),
        anonymous_id: row.anonymous_id,
        author:
            row.author_public_id && row.author_email
                ? {
                      public_id: row.author_public_id,
                      display_name: row.author_display_name,
                      email: row.author_email,
                  }
                : null,
    };
}

function toStatusEventResponse(row: StatusEventRow): StatusEventResponse {
    return {
        old_status_code: row.old_status_code,
        new_status_code: row.new_status_code,
        actor_display_name: row.actor_display_name,
        note: row.note,
        created_at: row.created_at.toISOString(),
    };
}

function toPointSummaryResponse(row: PointSummaryRow): PointSummaryResponse {
    return {
        total_points: row.total_points,
        lifetime_points_earned: row.lifetime_points_earned,
        lifetime_points_removed: row.lifetime_points_removed,
        updated_at: row.updated_at.toISOString(),
    };
}

function toFollowupResponse(row: FollowupRow): FollowupResponse {
    return {
        actor_type: row.actor_type,
        actor_display_name: row.actor_display_name,
        message: row.message,
        created_at: row.created_at.toISOString(),
    };
}
