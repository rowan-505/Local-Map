import { Prisma, type PrismaClient } from "@prisma/client";

import type { FieldReportCreateBody } from "./field-reports.schema.js";

export type FieldReportRow = {
    id: bigint;
    public_id: string;
    created_by: bigint;
    source_code: string;
    report_type_code: string;
    status_code: string;
    target_entity_type: string | null;
    target_public_id: string | null;
    description: string;
    latitude: number;
    longitude: number;
    location_accuracy_m: number | null;
    observed_at: Date;
    admin_area_id: bigint | null;
    report_data: unknown;
    created_at: Date;
    updated_at: Date;
};

const fieldReportSelect = Prisma.sql`
    SELECT
        r.id,
        r.public_id::text AS public_id,
        r.created_by,
        r.source_code,
        r.report_type_code,
        r.status_code,
        r.target_entity_type,
        r.target_public_id::text AS target_public_id,
        r.description,
        ST_Y(r.geom)::float8 AS latitude,
        ST_X(r.geom)::float8 AS longitude,
        r.location_accuracy_m::float8 AS location_accuracy_m,
        r.observed_at,
        r.admin_area_id,
        r.report_data,
        r.created_at,
        r.updated_at
    FROM feedback.user_reports r
`;

export type FieldTargetLookup = {
    stopExists: boolean;
    routeExists: boolean;
    routeMode: string | null;
    routeCode: string | null;
    variantExists: boolean;
    variantDirectionId: number | null;
    variantRoutePublicId: string | null;
    stopOnVariant: boolean | null;
};

export class FieldReportsRepository {
    constructor(private readonly prisma: PrismaClient) {}

    async lookupTargets(input: {
        stopPublicId?: string;
        routePublicId?: string;
        variantPublicId?: string;
        stopSequence?: number;
    }): Promise<FieldTargetLookup> {
        const rows = await this.prisma.$queryRaw<
            {
                stop_exists: boolean;
                route_exists: boolean;
                route_mode: string | null;
                route_code: string | null;
                variant_exists: boolean;
                variant_direction_id: number | null;
                variant_route_public_id: string | null;
                stop_on_variant: boolean | null;
            }[]
        >`
            SELECT
                EXISTS (
                    SELECT 1
                    FROM transport.stops s
                    WHERE ${input.stopPublicId ?? null}::uuid IS NOT NULL
                      AND s.public_id = ${input.stopPublicId ?? null}::uuid
                      AND s.deleted_at IS NULL
                ) AS stop_exists,
                EXISTS (
                    SELECT 1
                    FROM transport.routes r
                    WHERE ${input.routePublicId ?? null}::uuid IS NOT NULL
                      AND r.public_id = ${input.routePublicId ?? null}::uuid
                      AND r.deleted_at IS NULL
                ) AS route_exists,
                (
                    SELECT r.mode
                    FROM transport.routes r
                    WHERE ${input.routePublicId ?? null}::uuid IS NOT NULL
                      AND r.public_id = ${input.routePublicId ?? null}::uuid
                      AND r.deleted_at IS NULL
                    LIMIT 1
                ) AS route_mode,
                (
                    SELECT r.route_code
                    FROM transport.routes r
                    WHERE ${input.routePublicId ?? null}::uuid IS NOT NULL
                      AND r.public_id = ${input.routePublicId ?? null}::uuid
                      AND r.deleted_at IS NULL
                    LIMIT 1
                ) AS route_code,
                EXISTS (
                    SELECT 1
                    FROM transport.route_variants v
                    WHERE ${input.variantPublicId ?? null}::uuid IS NOT NULL
                      AND v.public_id = ${input.variantPublicId ?? null}::uuid
                      AND v.deleted_at IS NULL
                ) AS variant_exists,
                (
                    SELECT v.direction_id
                    FROM transport.route_variants v
                    WHERE ${input.variantPublicId ?? null}::uuid IS NOT NULL
                      AND v.public_id = ${input.variantPublicId ?? null}::uuid
                      AND v.deleted_at IS NULL
                    LIMIT 1
                ) AS variant_direction_id,
                (
                    SELECT r.public_id::text
                    FROM transport.route_variants v
                    JOIN transport.routes r ON r.id = v.route_id
                    WHERE ${input.variantPublicId ?? null}::uuid IS NOT NULL
                      AND v.public_id = ${input.variantPublicId ?? null}::uuid
                      AND v.deleted_at IS NULL
                    LIMIT 1
                ) AS variant_route_public_id,
                CASE
                    WHEN ${input.variantPublicId ?? null}::uuid IS NULL
                      OR ${input.stopPublicId ?? null}::uuid IS NULL
                      OR ${input.stopSequence ?? null}::int IS NULL
                    THEN NULL
                    ELSE EXISTS (
                        SELECT 1
                        FROM transport.route_stops rs
                        JOIN transport.route_variants v ON v.id = rs.route_variant_id
                        JOIN transport.stops s ON s.id = rs.stop_id
                        WHERE v.public_id = ${input.variantPublicId ?? null}::uuid
                          AND s.public_id = ${input.stopPublicId ?? null}::uuid
                          AND rs.stop_sequence = ${input.stopSequence ?? null}::int
                          AND v.deleted_at IS NULL
                          AND s.deleted_at IS NULL
                    )
                END AS stop_on_variant
        `;
        const row = rows[0];
        return {
            stopExists: row?.stop_exists ?? false,
            routeExists: row?.route_exists ?? false,
            routeMode: row?.route_mode ?? null,
            routeCode: row?.route_code ?? null,
            variantExists: row?.variant_exists ?? false,
            variantDirectionId: row?.variant_direction_id ?? null,
            variantRoutePublicId: row?.variant_route_public_id ?? null,
            stopOnVariant: row?.stop_on_variant ?? null,
        };
    }

    async findByPublicId(publicId: string): Promise<FieldReportRow | null> {
        const rows = await this.prisma.$queryRaw<FieldReportRow[]>(Prisma.sql`
            ${fieldReportSelect}
            WHERE r.public_id = ${publicId}::uuid
            LIMIT 1
        `);
        return rows[0] ?? null;
    }

    async insertFieldReport(input: {
        clientPublicId: string;
        createdBy: bigint;
        reportTypeCode: string;
        description: string;
        latitude: number;
        longitude: number;
        accuracyM: number | null;
        observedAt: Date;
        targetEntityType: string;
        targetPublicId: string | null;
        reportData: Record<string, unknown>;
    }): Promise<{ created: boolean; row: FieldReportRow }> {
        const reportDataJson = JSON.stringify(input.reportData);
        const pointSql = Prisma.sql`ST_SetSRID(ST_MakePoint(${input.longitude}, ${input.latitude}), 4326)`;
        const inserted = await this.prisma.$transaction(async (tx) => {
            const createdRows = await tx.$queryRaw<{ id: bigint }[]>(Prisma.sql`
                INSERT INTO feedback.user_reports (
                    public_id, created_by, anonymous_id, is_anonymous, eligible_for_points,
                    report_type_code, status_code, target_entity_type, target_entity_id, target_public_id,
                    title, description, geom, admin_area_id,
                    source_code, observed_at, location_accuracy_m, report_data
                ) VALUES (
                    ${input.clientPublicId}::uuid,
                    ${input.createdBy},
                    NULL,
                    false,
                    false,
                    ${input.reportTypeCode},
                    'submitted',
                    ${input.targetEntityType},
                    NULL,
                    ${input.targetPublicId === null ? Prisma.sql`NULL` : Prisma.sql`${input.targetPublicId}::uuid`},
                    NULL,
                    ${input.description},
                    ${pointSql},
                    core.find_admin_area_for_point(${pointSql}, NULL),
                    'field_survey',
                    ${input.observedAt},
                    ${input.accuracyM},
                    ${reportDataJson}::jsonb
                )
                ON CONFLICT (public_id) DO NOTHING
                RETURNING id
            `);

            if (createdRows[0]) {
                await tx.$executeRaw(Prisma.sql`
                    INSERT INTO feedback.report_status_events
                        (report_id, old_status_code, new_status_code, actor_user_id, note)
                    VALUES (${createdRows[0].id}, NULL, 'submitted', ${input.createdBy}, NULL)
                `);
            }

            const rows = await tx.$queryRaw<FieldReportRow[]>(Prisma.sql`
                ${fieldReportSelect}
                WHERE r.public_id = ${input.clientPublicId}::uuid
                LIMIT 1
            `);
            return { created: Boolean(createdRows[0]), row: rows[0]! };
        });
        return inserted;
    }

    async updateFieldReport(input: {
        publicId: string;
        createdBy: bigint;
        description?: string;
        latitude?: number;
        longitude?: number;
        accuracyM?: number | null;
        observedAt?: Date;
        reportTypeCode?: string;
        targetEntityType?: string;
        targetPublicId?: string | null;
        reportData?: Record<string, unknown>;
    }): Promise<FieldReportRow | null> {
        const sets: Prisma.Sql[] = [Prisma.sql`updated_at = now()`];
        if (input.description !== undefined) {
            sets.push(Prisma.sql`description = ${input.description}`);
        }
        if (input.reportTypeCode !== undefined) {
            sets.push(Prisma.sql`report_type_code = ${input.reportTypeCode}`);
        }
        if (input.targetEntityType !== undefined) {
            sets.push(Prisma.sql`target_entity_type = ${input.targetEntityType}`);
        }
        if (input.targetPublicId !== undefined) {
            sets.push(Prisma.sql`target_public_id = ${input.targetPublicId}::uuid`);
        }
        if (input.observedAt !== undefined) {
            sets.push(Prisma.sql`observed_at = ${input.observedAt}`);
        }
        if (input.accuracyM !== undefined) {
            sets.push(Prisma.sql`location_accuracy_m = ${input.accuracyM}`);
        }
        if (input.latitude !== undefined && input.longitude !== undefined) {
            const pointSql = Prisma.sql`ST_SetSRID(ST_MakePoint(${input.longitude}, ${input.latitude}), 4326)`;
            sets.push(Prisma.sql`geom = ${pointSql}`);
            sets.push(Prisma.sql`admin_area_id = core.find_admin_area_for_point(${pointSql}, NULL)`);
        }
        if (input.reportData !== undefined) {
            sets.push(Prisma.sql`report_data = ${JSON.stringify(input.reportData)}::jsonb`);
        }

        const updated = await this.prisma.$queryRaw<{ public_id: string }[]>(Prisma.sql`
            UPDATE feedback.user_reports
            SET ${Prisma.join(sets, ", ")}
            WHERE public_id = ${input.publicId}::uuid
              AND created_by = ${input.createdBy}
              AND source_code = 'field_survey'
              AND status_code = 'submitted'
            RETURNING public_id
        `);
        if (!updated[0]) {
            return null;
        }
        return this.findByPublicId(input.publicId);
    }
}

export function toReportData(body: FieldReportCreateBody): Record<string, unknown> {
    const data: Record<string, unknown> = {
        snapshotRevision: body.context.snapshotRevision,
        variantCode: body.context.variantCode,
    };
    if (body.context.routePublicId) data.routePublicId = body.context.routePublicId;
    if (body.context.variantPublicId) data.variantPublicId = body.context.variantPublicId;
    if (body.context.stopPublicId) data.stopPublicId = body.context.stopPublicId;
    if (body.context.stopSequence !== undefined) data.stopSequence = body.context.stopSequence;
    if (body.context.canonicalSnapshot !== undefined) {
        data.canonicalSnapshot = body.context.canonicalSnapshot;
    }
    return data;
}
