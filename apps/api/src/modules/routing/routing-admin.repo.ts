import type { PrismaClient } from "@prisma/client";

import type {
    ListRoutingBuildsQuery,
    ListRoutingFeedbackQuery,
    ListRoutingValidationReportsQuery,
    PatchRoutingFeedbackStatusBody,
} from "./routing-admin.schema.js";
import {
    RoutingAdminBuildNotFoundError,
    RoutingAdminFeedbackNotFoundError,
    RoutingAdminSchemaUnavailableError,
} from "./routing-admin.errors.js";
import type {
    RoutingAdminBuildDetail,
    RoutingAdminBuildSummary,
    RoutingAdminFeedbackRow,
    RoutingAdminPaginated,
    RoutingAdminServiceHealthRow,
    RoutingAdminValidationReportRow,
} from "./routing-admin.types.js";

type BuildRow = {
    id: bigint;
    public_id: string;
    engine_code: string;
    region_code: string | null;
    build_version: string;
    build_label: string | null;
    status: string;
    is_active: boolean;
    is_public: boolean;
    profile_codes: string[];
    source_description: string | null;
    summary: unknown;
    smoke_test_summary: unknown;
    warning_count: number;
    error_count: number;
    started_at: Date | null;
    finished_at: Date | null;
    published_at: Date | null;
    created_at: Date;
    updated_at: Date;
    artifact_count?: bigint | number;
    source_count?: bigint | number;
};

function isMissingRoutingSchemaError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    const message = error.message.toLowerCase();
    return (
        message.includes('schema "routing" does not exist') ||
        (message.includes("relation") && message.includes("does not exist"))
    );
}

function toIso(value: Date | null): string | null {
    return value ? value.toISOString() : null;
}

function mapBuildSummary(row: BuildRow): RoutingAdminBuildSummary {
    return {
        id: String(row.id),
        publicId: row.public_id,
        engineCode: row.engine_code,
        regionCode: row.region_code,
        buildVersion: row.build_version,
        buildLabel: row.build_label,
        status: row.status,
        isActive: row.is_active,
        isPublic: row.is_public,
        profileCodes: row.profile_codes ?? [],
        warningCount: row.warning_count,
        errorCount: row.error_count,
        startedAt: toIso(row.started_at),
        finishedAt: toIso(row.finished_at),
        publishedAt: toIso(row.published_at),
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
    };
}

function jsonRecord(value: unknown): Record<string, unknown> {
    if (value && typeof value === "object" && !Array.isArray(value)) {
        return value as Record<string, unknown>;
    }
    return {};
}

export function parseRoutingEntityId(
    id: string
): { kind: "uuid"; value: string } | { kind: "bigint"; value: bigint } | null {
    const uuidRe =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (uuidRe.test(id)) {
        return { kind: "uuid", value: id };
    }
    if (/^\d+$/.test(id)) {
        return { kind: "bigint", value: BigInt(id) };
    }
    return null;
}

export class RoutingAdminRepository {
    constructor(private readonly prisma: PrismaClient) {}

    async assertSchemaAvailable(): Promise<void> {
        try {
            await this.prisma.$queryRaw`SELECT 1 FROM routing.routing_builds LIMIT 1`;
        } catch (error) {
            if (isMissingRoutingSchemaError(error)) {
                throw new RoutingAdminSchemaUnavailableError();
            }
            throw error;
        }
    }

    async listBuilds(query: ListRoutingBuildsQuery): Promise<RoutingAdminPaginated<RoutingAdminBuildSummary>> {
        await this.assertSchemaAvailable();

        const rows = await this.prisma.$queryRaw<BuildRow[]>`
            SELECT
                id,
                public_id::text,
                engine_code,
                region_code,
                build_version,
                build_label,
                status,
                is_active,
                is_public,
                profile_codes,
                source_description,
                summary,
                smoke_test_summary,
                warning_count,
                error_count,
                started_at,
                finished_at,
                published_at,
                created_at,
                updated_at
            FROM routing.routing_builds
            WHERE (${query.engine_code ?? null}::text IS NULL OR engine_code = ${query.engine_code ?? null})
              AND (${query.status ?? null}::text IS NULL OR status = ${query.status ?? null})
              AND (
                ${query.is_active === undefined ? null : query.is_active}::boolean IS NULL
                OR is_active = ${query.is_active === undefined ? null : query.is_active}
              )
            ORDER BY created_at DESC, id DESC
            LIMIT ${query.limit}
            OFFSET ${query.offset}
        `;

        const countRows = await this.prisma.$queryRaw<{ count: bigint }[]>`
            SELECT COUNT(*)::bigint AS count
            FROM routing.routing_builds
            WHERE (${query.engine_code ?? null}::text IS NULL OR engine_code = ${query.engine_code ?? null})
              AND (${query.status ?? null}::text IS NULL OR status = ${query.status ?? null})
              AND (
                ${query.is_active === undefined ? null : query.is_active}::boolean IS NULL
                OR is_active = ${query.is_active === undefined ? null : query.is_active}
              )
        `;

        return {
            items: rows.map(mapBuildSummary),
            total: Number(countRows[0]?.count ?? 0n),
            limit: query.limit,
            offset: query.offset,
        };
    }

    async getBuildById(idParam: string): Promise<RoutingAdminBuildDetail> {
        await this.assertSchemaAvailable();
        const parsed = parseRoutingEntityId(idParam);
        if (!parsed) {
            throw new RoutingAdminBuildNotFoundError(idParam);
        }

        const rows =
            parsed.kind === "uuid"
                ? await this.prisma.$queryRaw<BuildRow[]>`
                      SELECT
                          b.id,
                          b.public_id::text,
                          b.engine_code,
                          b.region_code,
                          b.build_version,
                          b.build_label,
                          b.status,
                          b.is_active,
                          b.is_public,
                          b.profile_codes,
                          b.source_description,
                          b.summary,
                          b.smoke_test_summary,
                          b.warning_count,
                          b.error_count,
                          b.started_at,
                          b.finished_at,
                          b.published_at,
                          b.created_at,
                          b.updated_at,
                          (SELECT COUNT(*) FROM routing.routing_build_artifacts a WHERE a.routing_build_id = b.id) AS artifact_count,
                          (SELECT COUNT(*) FROM routing.routing_build_sources s WHERE s.routing_build_id = b.id) AS source_count
                      FROM routing.routing_builds b
                      WHERE b.public_id = ${parsed.value}::uuid
                      LIMIT 1
                  `
                : await this.prisma.$queryRaw<BuildRow[]>`
                      SELECT
                          b.id,
                          b.public_id::text,
                          b.engine_code,
                          b.region_code,
                          b.build_version,
                          b.build_label,
                          b.status,
                          b.is_active,
                          b.is_public,
                          b.profile_codes,
                          b.source_description,
                          b.summary,
                          b.smoke_test_summary,
                          b.warning_count,
                          b.error_count,
                          b.started_at,
                          b.finished_at,
                          b.published_at,
                          b.created_at,
                          b.updated_at,
                          (SELECT COUNT(*) FROM routing.routing_build_artifacts a WHERE a.routing_build_id = b.id) AS artifact_count,
                          (SELECT COUNT(*) FROM routing.routing_build_sources s WHERE s.routing_build_id = b.id) AS source_count
                      FROM routing.routing_builds b
                      WHERE b.id = ${parsed.value}
                      LIMIT 1
                  `;

        const row = rows[0];
        if (!row) {
            throw new RoutingAdminBuildNotFoundError(idParam);
        }

        const summary = mapBuildSummary(row);
        return {
            ...summary,
            sourceDescription: row.source_description,
            summary: jsonRecord(row.summary),
            smokeTestSummary: jsonRecord(row.smoke_test_summary),
            artifactCount: Number(row.artifact_count ?? 0),
            sourceCount: Number(row.source_count ?? 0),
        };
    }

    async listActiveBuilds(): Promise<readonly RoutingAdminBuildSummary[]> {
        try {
            const rows = await this.prisma.$queryRaw<BuildRow[]>`
                SELECT
                    id,
                    public_id::text,
                    engine_code,
                    region_code,
                    build_version,
                    build_label,
                    status,
                    is_active,
                    is_public,
                    profile_codes,
                    source_description,
                    summary,
                    smoke_test_summary,
                    warning_count,
                    error_count,
                    started_at,
                    finished_at,
                    published_at,
                    created_at,
                    updated_at
                FROM routing.routing_builds
                WHERE is_active = true
                ORDER BY engine_code ASC, region_code NULLS FIRST, published_at DESC NULLS LAST
            `;
            return rows.map(mapBuildSummary);
        } catch (error) {
            if (isMissingRoutingSchemaError(error)) {
                return [];
            }
            throw error;
        }
    }

    async listServiceHealth(): Promise<readonly RoutingAdminServiceHealthRow[]> {
        try {
            const rows = await this.prisma.$queryRaw<
                {
                    id: bigint;
                    engine_code: string;
                    region_code: string | null;
                    status: string;
                    last_check_at: Date | null;
                    last_success_at: Date | null;
                    latency_ms: number | null;
                    message: string | null;
                    details: unknown;
                    updated_at: Date;
                }[]
            >`
                SELECT
                    id,
                    engine_code,
                    region_code,
                    status,
                    last_check_at,
                    last_success_at,
                    latency_ms,
                    message,
                    details,
                    updated_at
                FROM routing.routing_service_health
                ORDER BY engine_code ASC, region_code NULLS FIRST
            `;

            return rows.map((row) => ({
                id: String(row.id),
                engineCode: row.engine_code,
                regionCode: row.region_code,
                status: row.status,
                lastCheckAt: toIso(row.last_check_at),
                lastSuccessAt: toIso(row.last_success_at),
                latencyMs: row.latency_ms,
                message: row.message,
                details: jsonRecord(row.details),
                updatedAt: row.updated_at.toISOString(),
            }));
        } catch (error) {
            if (isMissingRoutingSchemaError(error)) {
                return [];
            }
            throw error;
        }
    }

    async listFeedback(
        query: ListRoutingFeedbackQuery
    ): Promise<RoutingAdminPaginated<RoutingAdminFeedbackRow>> {
        await this.assertSchemaAvailable();

        const rows = await this.prisma.$queryRaw<
            {
                id: bigint;
                public_id: string;
                routing_request_public_id: string | null;
                problem_type: string;
                status: string;
                comment: string | null;
                metadata: unknown;
                user_id: bigint | null;
                created_at: Date;
                updated_at: Date;
            }[]
        >`
            SELECT
                f.id,
                f.public_id::text,
                rr.public_id::text AS routing_request_public_id,
                f.problem_type,
                f.status,
                f.comment,
                f.metadata,
                f.user_id,
                f.created_at,
                f.updated_at
            FROM routing.routing_feedback f
            LEFT JOIN routing.routing_requests rr ON rr.id = f.routing_request_id
            WHERE (${query.status ?? null}::text IS NULL OR f.status = ${query.status ?? null})
              AND (${query.problem_type ?? null}::text IS NULL OR f.problem_type = ${query.problem_type ?? null})
            ORDER BY f.created_at DESC, f.id DESC
            LIMIT ${query.limit}
            OFFSET ${query.offset}
        `;

        const countRows = await this.prisma.$queryRaw<{ count: bigint }[]>`
            SELECT COUNT(*)::bigint AS count
            FROM routing.routing_feedback f
            WHERE (${query.status ?? null}::text IS NULL OR f.status = ${query.status ?? null})
              AND (${query.problem_type ?? null}::text IS NULL OR f.problem_type = ${query.problem_type ?? null})
        `;

        return {
            items: rows.map((row) => ({
                id: String(row.id),
                publicId: row.public_id,
                routingRequestPublicId: row.routing_request_public_id,
                problemType: row.problem_type,
                status: row.status,
                comment: row.comment,
                metadata: jsonRecord(row.metadata),
                userId: row.user_id !== null ? String(row.user_id) : null,
                createdAt: row.created_at.toISOString(),
                updatedAt: row.updated_at.toISOString(),
            })),
            total: Number(countRows[0]?.count ?? 0n),
            limit: query.limit,
            offset: query.offset,
        };
    }

    async updateFeedbackStatus(
        idParam: string,
        body: PatchRoutingFeedbackStatusBody
    ): Promise<RoutingAdminFeedbackRow> {
        await this.assertSchemaAvailable();
        const parsed = parseRoutingEntityId(idParam);
        if (!parsed) {
            throw new RoutingAdminFeedbackNotFoundError(idParam);
        }

        const rows =
            parsed.kind === "uuid"
                ? await this.prisma.$queryRaw<{ id: bigint }[]>`
                      UPDATE routing.routing_feedback
                      SET status = ${body.status}, updated_at = now()
                      WHERE public_id = ${parsed.value}::uuid
                      RETURNING id
                  `
                : await this.prisma.$queryRaw<{ id: bigint }[]>`
                      UPDATE routing.routing_feedback
                      SET status = ${body.status}, updated_at = now()
                      WHERE id = ${parsed.value}
                      RETURNING id
                  `;

        if (!rows[0]) {
            throw new RoutingAdminFeedbackNotFoundError(idParam);
        }

        const match = await this.prisma.$queryRaw<
            {
                id: bigint;
                public_id: string;
                routing_request_public_id: string | null;
                problem_type: string;
                status: string;
                comment: string | null;
                metadata: unknown;
                user_id: bigint | null;
                created_at: Date;
                updated_at: Date;
            }[]
        >`
            SELECT
                f.id,
                f.public_id::text,
                rr.public_id::text AS routing_request_public_id,
                f.problem_type,
                f.status,
                f.comment,
                f.metadata,
                f.user_id,
                f.created_at,
                f.updated_at
            FROM routing.routing_feedback f
            LEFT JOIN routing.routing_requests rr ON rr.id = f.routing_request_id
            WHERE f.id = ${rows[0].id}
            LIMIT 1
        `;

        const row = match[0];
        if (!row) {
            throw new RoutingAdminFeedbackNotFoundError(idParam);
        }

        return {
            id: String(row.id),
            publicId: row.public_id,
            routingRequestPublicId: row.routing_request_public_id,
            problemType: row.problem_type,
            status: row.status,
            comment: row.comment,
            metadata: jsonRecord(row.metadata),
            userId: row.user_id !== null ? String(row.user_id) : null,
            createdAt: row.created_at.toISOString(),
            updatedAt: row.updated_at.toISOString(),
        };
    }

    async listValidationReports(
        query: ListRoutingValidationReportsQuery
    ): Promise<RoutingAdminPaginated<RoutingAdminValidationReportRow>> {
        await this.assertSchemaAvailable();

        const buildId = query.routing_build_id ? BigInt(query.routing_build_id) : null;

        const rows = await this.prisma.$queryRaw<
            {
                id: bigint;
                routing_build_id: bigint | null;
                build_job_id: bigint | null;
                report_scope: string;
                severity: string;
                code: string;
                message: string;
                core_street_id: bigint | null;
                routing_edge_id: bigint | null;
                created_at: Date;
                updated_at: Date;
            }[]
        >`
            SELECT
                id,
                routing_build_id,
                build_job_id,
                report_scope,
                severity,
                code,
                message,
                core_street_id,
                routing_edge_id,
                created_at,
                updated_at
            FROM routing.routing_validation_reports
            WHERE (${buildId}::bigint IS NULL OR routing_build_id = ${buildId})
              AND (${query.severity ?? null}::text IS NULL OR severity = ${query.severity ?? null})
              AND (${query.report_scope ?? null}::text IS NULL OR report_scope = ${query.report_scope ?? null})
            ORDER BY created_at DESC, id DESC
            LIMIT ${query.limit}
            OFFSET ${query.offset}
        `;

        const countRows = await this.prisma.$queryRaw<{ count: bigint }[]>`
            SELECT COUNT(*)::bigint AS count
            FROM routing.routing_validation_reports
            WHERE (${buildId}::bigint IS NULL OR routing_build_id = ${buildId})
              AND (${query.severity ?? null}::text IS NULL OR severity = ${query.severity ?? null})
              AND (${query.report_scope ?? null}::text IS NULL OR report_scope = ${query.report_scope ?? null})
        `;

        return {
            items: rows.map((row) => ({
                id: String(row.id),
                routingBuildId: row.routing_build_id !== null ? String(row.routing_build_id) : null,
                buildJobId: row.build_job_id !== null ? String(row.build_job_id) : null,
                reportScope: row.report_scope,
                severity: row.severity,
                code: row.code,
                message: row.message,
                coreStreetId: row.core_street_id !== null ? String(row.core_street_id) : null,
                routingEdgeId: row.routing_edge_id !== null ? String(row.routing_edge_id) : null,
                createdAt: row.created_at.toISOString(),
                updatedAt: row.updated_at.toISOString(),
            })),
            total: Number(countRows[0]?.count ?? 0n),
            limit: query.limit,
            offset: query.offset,
        };
    }
}
