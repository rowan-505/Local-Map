import { Prisma, type PrismaClient } from "@prisma/client";

import {
    getImportTransportFamilyConfig,
    qualifiedImportTransportTable,
    type ImportTransportFamily,
} from "./import-transport.config.js";
import {
    IMPORT_TRANSPORT_FAMILY_ENTITY_KIND,
    IMPORT_TRANSPORT_STOP_DUPLICATE_DISTANCE_M,
    type ImportTransportValidationIssueDraft,
    type ImportTransportValidationIssueRecord,
} from "./import-transport-validation.types.js";
import {
    type RouteStopValidationInput,
    type RouteValidationInput,
    type StopValidationInput,
    type VariantValidationInput,
    validateRouteCandidate,
    validateRouteStopCandidate,
    validateStopCandidate,
    validateVariantCandidate,
} from "./import-transport-validation-rules.js";

type IssueRowDb = {
    id: bigint;
    import_batch_id: bigint;
    entity_kind: string | null;
    entity_id: bigint | null;
    entity_source_id: string | null;
    issue_code: string;
    severity: string;
    issue_status: string;
    message: string;
    details: unknown;
    created_at: Date;
    resolved_at: Date | null;
};

function mapIssueRow(row: IssueRowDb): ImportTransportValidationIssueRecord {
    return {
        id: row.id.toString(),
        import_batch_id: row.import_batch_id.toString(),
        entity_kind: row.entity_kind,
        entity_id: row.entity_id == null ? null : row.entity_id.toString(),
        entity_source_id: row.entity_source_id,
        issue_code: row.issue_code,
        severity: row.severity,
        issue_status: row.issue_status,
        message: row.message,
        details:
            row.details != null && typeof row.details === "object" && !Array.isArray(row.details)
                ? (row.details as Record<string, unknown>)
                : {},
        created_at: row.created_at.toISOString(),
        resolved_at: row.resolved_at?.toISOString() ?? null,
    };
}

export class ImportTransportValidationRepository {
    constructor(private readonly prisma: PrismaClient) {}

    async tableExists(qualifiedName: string): Promise<boolean> {
        const rows = await this.prisma.$queryRaw<{ ok: boolean }[]>`
            SELECT to_regclass(${qualifiedName}) IS NOT NULL AS ok
        `;
        return rows[0]?.ok === true;
    }

    async listCandidateIds(
        family: ImportTransportFamily,
        importBatchId: bigint
    ): Promise<bigint[]> {
        const qualified = qualifiedImportTransportTable(family);
        if (!(await this.tableExists(qualified))) {
            return [];
        }
        const cfg = getImportTransportFamilyConfig(family);
        const rows = await this.prisma.$queryRaw<{ id: bigint }[]>`
            SELECT ${Prisma.raw(`${cfg.alias}.id`)} AS id
            FROM ${Prisma.raw(qualified)} AS ${Prisma.raw(cfg.alias)}
            WHERE ${Prisma.raw(`${cfg.alias}.import_batch_id`)} = ${importBatchId}
            ORDER BY ${Prisma.raw(`${cfg.alias}.id`)} ASC
        `;
        return rows.map((row) => row.id);
    }

    async evaluateRoute(importBatchId: bigint, candidateId: bigint): Promise<ImportTransportValidationIssueDraft[]> {
        const rows = await this.prisma.$queryRaw<
            [
                {
                    id: bigint;
                    route_code: string | null;
                    public_name: string | null;
                    transport_mode: string | null;
                    confidence_score: number | null;
                    operator_match_status: string | null;
                    has_operator: boolean;
                    duplicate_route_code: boolean;
                },
            ]
        >`
            SELECT
                r.id,
                r.route_code,
                r.public_name,
                r.transport_mode,
                r.confidence_score::float8 AS confidence_score,
                o.match_status AS operator_match_status,
                (r.raw_operator_id IS NOT NULL) AS has_operator,
                EXISTS (
                    SELECT 1
                    FROM import_transport.raw_routes AS other
                    WHERE other.import_batch_id = r.import_batch_id
                      AND other.id <> r.id
                      AND lower(btrim(coalesce(other.route_code, ''))) = lower(btrim(coalesce(r.route_code, '')))
                      AND btrim(coalesce(other.route_code, '')) <> ''
                      AND other.transport_mode = r.transport_mode
                ) AS duplicate_route_code
            FROM import_transport.raw_routes AS r
            LEFT JOIN import_transport.raw_operators AS o
                ON o.id = r.raw_operator_id
               AND o.import_batch_id = r.import_batch_id
            WHERE r.import_batch_id = ${importBatchId}
              AND r.id = ${candidateId}
            LIMIT 1
        `;
        const row = rows[0];
        if (!row) {
            return [];
        }
        const input: RouteValidationInput = {
            id: row.id.toString(),
            route_code: row.route_code,
            public_name: row.public_name,
            transport_mode: row.transport_mode,
            confidence_score: row.confidence_score,
            operator_match_status: row.operator_match_status,
            has_operator: row.has_operator,
            duplicate_route_code: row.duplicate_route_code,
        };
        return validateRouteCandidate(input);
    }

    async evaluateStop(importBatchId: bigint, candidateId: bigint): Promise<ImportTransportValidationIssueDraft[]> {
        const rows = await this.prisma.$queryRaw<
            [
                {
                    id: bigint;
                    stop_code: string | null;
                    stop_name: string | null;
                    stop_name_local: string | null;
                    admin_area_code: string | null;
                    confidence_score: number | null;
                    geometry_present: boolean;
                    geometry_valid: boolean;
                    geometry_srid: number | null;
                    nearby_stop_id: bigint | null;
                    nearby_stop_distance_m: number | null;
                },
            ]
        >`
            SELECT
                s.id,
                s.stop_code,
                s.stop_name,
                s.stop_name_local,
                s.admin_area_code,
                s.confidence_score::float8 AS confidence_score,
                (s.geom IS NOT NULL) AS geometry_present,
                CASE
                    WHEN s.geom IS NULL THEN false
                    ELSE ST_IsValid(s.geom) AND NOT ST_IsEmpty(s.geom)
                END AS geometry_valid,
                CASE WHEN s.geom IS NULL THEN NULL ELSE ST_SRID(s.geom) END AS geometry_srid,
                nearby.id AS nearby_stop_id,
                nearby.distance_m AS nearby_stop_distance_m
            FROM import_transport.raw_stops AS s
            LEFT JOIN LATERAL (
                SELECT other.id, ST_Distance(other.geom::geography, s.geom::geography) AS distance_m
                FROM import_transport.raw_stops AS other
                WHERE other.import_batch_id = s.import_batch_id
                  AND other.id <> s.id
                  AND other.geom IS NOT NULL
                  AND s.geom IS NOT NULL
                  AND ST_DWithin(other.geom::geography, s.geom::geography, ${IMPORT_TRANSPORT_STOP_DUPLICATE_DISTANCE_M})
                ORDER BY ST_Distance(other.geom::geography, s.geom::geography) ASC
                LIMIT 1
            ) AS nearby ON true
            WHERE s.import_batch_id = ${importBatchId}
              AND s.id = ${candidateId}
            LIMIT 1
        `;
        const row = rows[0];
        if (!row) {
            return [];
        }
        const input: StopValidationInput = {
            id: row.id.toString(),
            stop_code: row.stop_code,
            stop_name: row.stop_name,
            stop_name_local: row.stop_name_local,
            admin_area_code: row.admin_area_code,
            confidence_score: row.confidence_score,
            geometry_present: row.geometry_present,
            geometry_valid: row.geometry_valid,
            geometry_srid: row.geometry_srid,
            nearby_stop_id: row.nearby_stop_id?.toString() ?? null,
            nearby_stop_distance_m: row.nearby_stop_distance_m,
        };
        return validateStopCandidate(input);
    }

    async evaluateVariant(
        importBatchId: bigint,
        candidateId: bigint
    ): Promise<ImportTransportValidationIssueDraft[]> {
        const rows = await this.prisma.$queryRaw<
            [
                {
                    id: bigint;
                    raw_route_id: bigint | null;
                    parent_route_exists: boolean;
                    variant_code: string | null;
                    direction_name: string | null;
                    origin_name: string | null;
                    destination_name: string | null;
                    distance_m: number | null;
                    geometry_present: boolean;
                    geometry_valid: boolean;
                    duplicate_variant: boolean;
                },
            ]
        >`
            SELECT
                v.id,
                v.raw_route_id,
                EXISTS (
                    SELECT 1
                    FROM import_transport.raw_routes AS r
                    WHERE r.id = v.raw_route_id
                      AND r.import_batch_id = v.import_batch_id
                ) AS parent_route_exists,
                v.variant_code,
                v.direction_name,
                v.origin_name,
                v.destination_name,
                v.distance_m::float8 AS distance_m,
                (v.geom IS NOT NULL) AS geometry_present,
                CASE
                    WHEN v.geom IS NULL THEN false
                    ELSE ST_IsValid(v.geom) AND NOT ST_IsEmpty(v.geom)
                END AS geometry_valid,
                EXISTS (
                    SELECT 1
                    FROM import_transport.raw_route_variants AS other
                    WHERE other.import_batch_id = v.import_batch_id
                      AND other.id <> v.id
                      AND other.raw_route_id = v.raw_route_id
                      AND (
                          (
                              btrim(coalesce(other.direction_name, '')) <> ''
                              AND lower(btrim(other.direction_name)) = lower(btrim(coalesce(v.direction_name, '')))
                          )
                          OR (
                              btrim(coalesce(other.variant_code, '')) <> ''
                              AND lower(btrim(other.variant_code)) = lower(btrim(coalesce(v.variant_code, '')))
                          )
                      )
                ) AS duplicate_variant
            FROM import_transport.raw_route_variants AS v
            WHERE v.import_batch_id = ${importBatchId}
              AND v.id = ${candidateId}
            LIMIT 1
        `;
        const row = rows[0];
        if (!row) {
            return [];
        }
        const input: VariantValidationInput = {
            id: row.id.toString(),
            raw_route_id: row.raw_route_id?.toString() ?? null,
            parent_route_exists: row.parent_route_exists,
            variant_code: row.variant_code,
            direction_name: row.direction_name,
            origin_name: row.origin_name,
            destination_name: row.destination_name,
            distance_m: row.distance_m,
            geometry_present: row.geometry_present,
            geometry_valid: row.geometry_valid,
            duplicate_variant: row.duplicate_variant,
        };
        return validateVariantCandidate(input);
    }

    async evaluateRouteStop(
        importBatchId: bigint,
        candidateId: bigint
    ): Promise<ImportTransportValidationIssueDraft[]> {
        const rows = await this.prisma.$queryRaw<
            [
                {
                    id: bigint;
                    raw_route_variant_id: bigint | null;
                    raw_stop_id: bigint | null;
                    variant_exists: boolean;
                    stop_exists: boolean;
                    stop_sequence: number | null;
                    distance_from_start_m: number | null;
                    duplicate_stop_sequence: boolean;
                    duplicate_consecutive_stop: boolean;
                },
            ]
        >`
            SELECT
                rs.id,
                rs.raw_route_variant_id,
                rs.raw_stop_id,
                EXISTS (
                    SELECT 1
                    FROM import_transport.raw_route_variants AS v
                    WHERE v.id = rs.raw_route_variant_id
                      AND v.import_batch_id = rs.import_batch_id
                ) AS variant_exists,
                EXISTS (
                    SELECT 1
                    FROM import_transport.raw_stops AS s
                    WHERE s.id = rs.raw_stop_id
                      AND s.import_batch_id = rs.import_batch_id
                ) AS stop_exists,
                rs.stop_sequence,
                rs.distance_from_start_m::float8 AS distance_from_start_m,
                EXISTS (
                    SELECT 1
                    FROM import_transport.raw_route_stops AS other
                    WHERE other.raw_route_variant_id = rs.raw_route_variant_id
                      AND other.id <> rs.id
                      AND other.stop_sequence = rs.stop_sequence
                ) AS duplicate_stop_sequence,
                EXISTS (
                    SELECT 1
                    FROM import_transport.raw_route_stops AS prev
                    WHERE prev.raw_route_variant_id = rs.raw_route_variant_id
                      AND prev.stop_sequence = rs.stop_sequence - 1
                      AND prev.raw_stop_id = rs.raw_stop_id
                ) AS duplicate_consecutive_stop
            FROM import_transport.raw_route_stops AS rs
            WHERE rs.import_batch_id = ${importBatchId}
              AND rs.id = ${candidateId}
            LIMIT 1
        `;
        const row = rows[0];
        if (!row) {
            return [];
        }
        const input: RouteStopValidationInput = {
            id: row.id.toString(),
            raw_route_variant_id: row.raw_route_variant_id?.toString() ?? null,
            raw_stop_id: row.raw_stop_id?.toString() ?? null,
            variant_exists: row.variant_exists,
            stop_exists: row.stop_exists,
            stop_sequence: row.stop_sequence,
            distance_from_start_m: row.distance_from_start_m,
            duplicate_stop_sequence: row.duplicate_stop_sequence,
            duplicate_consecutive_stop: row.duplicate_consecutive_stop,
        };
        return validateRouteStopCandidate(input);
    }

    async evaluateCandidate(
        family: ImportTransportFamily,
        importBatchId: bigint,
        candidateId: bigint
    ): Promise<ImportTransportValidationIssueDraft[]> {
        switch (family) {
            case "routes":
                return this.evaluateRoute(importBatchId, candidateId);
            case "stops":
                return this.evaluateStop(importBatchId, candidateId);
            case "variants":
                return this.evaluateVariant(importBatchId, candidateId);
            case "route_stops":
                return this.evaluateRouteStop(importBatchId, candidateId);
            default:
                return [];
        }
    }

    async persistValidationResult(args: {
        family: ImportTransportFamily;
        importBatchId: bigint;
        candidateId: bigint;
        entitySourceId: string | null;
        validationStatus: string;
        issues: ImportTransportValidationIssueDraft[];
        reviewNote?: string | null;
    }): Promise<ImportTransportValidationIssueRecord[]> {
        const entityKind = IMPORT_TRANSPORT_FAMILY_ENTITY_KIND[args.family];
        const qualified = qualifiedImportTransportTable(args.family);

        return this.prisma.$transaction(async (tx) => {
            if (await this.tableExists("import_transport.validation_issues")) {
                await tx.$executeRaw`
                    UPDATE import_transport.validation_issues
                    SET issue_status = 'resolved',
                        resolved_at = now()
                    WHERE import_batch_id = ${args.importBatchId}
                      AND entity_kind = ${entityKind}
                      AND entity_id = ${args.candidateId}
                      AND issue_status = 'open'
                `;

                for (const issue of args.issues) {
                    await tx.$executeRaw`
                        INSERT INTO import_transport.validation_issues (
                            import_batch_id,
                            entity_kind,
                            entity_id,
                            entity_source_id,
                            issue_code,
                            severity,
                            issue_status,
                            message,
                            details
                        ) VALUES (
                            ${args.importBatchId},
                            ${entityKind},
                            ${args.candidateId},
                            ${args.entitySourceId},
                            ${issue.issue_code},
                            ${issue.severity === "warning" ? "warning" : "error"},
                            'open',
                            ${issue.message},
                            ${JSON.stringify(issue.details ?? {})}::jsonb
                        )
                    `;
                }
            }

            if (args.reviewNote?.trim()) {
                await tx.$executeRaw(
                    Prisma.sql`
                        UPDATE ${Prisma.raw(qualified)}
                        SET validation_status = ${args.validationStatus},
                            updated_at = now(),
                            review_note = ${args.reviewNote.trim()}
                        WHERE import_batch_id = ${args.importBatchId}
                          AND id = ${args.candidateId}
                    `
                );
            } else {
                await tx.$executeRaw(
                    Prisma.sql`
                        UPDATE ${Prisma.raw(qualified)}
                        SET validation_status = ${args.validationStatus},
                            updated_at = now()
                        WHERE import_batch_id = ${args.importBatchId}
                          AND id = ${args.candidateId}
                    `
                );
            }

            const issueRows = await tx.$queryRaw<IssueRowDb[]>`
                SELECT
                    id,
                    import_batch_id,
                    entity_kind,
                    entity_id,
                    entity_source_id,
                    issue_code,
                    severity,
                    issue_status,
                    message,
                    details,
                    created_at,
                    resolved_at
                FROM import_transport.validation_issues
                WHERE import_batch_id = ${args.importBatchId}
                  AND entity_kind = ${entityKind}
                  AND entity_id = ${args.candidateId}
                  AND issue_status = 'open'
                ORDER BY
                    CASE severity
                        WHEN 'critical' THEN 0
                        WHEN 'error' THEN 1
                        WHEN 'warning' THEN 2
                        ELSE 3
                    END,
                    id ASC
            `;
            return issueRows.map(mapIssueRow);
        });
    }

    async listIssues(input: {
        importBatchId: bigint;
        entityKind?: string;
        entityId?: bigint;
        severity?: string;
        limit: number;
        offset: number;
    }): Promise<{ items: ImportTransportValidationIssueRecord[]; total: number }> {
        if (!(await this.tableExists("import_transport.validation_issues"))) {
            return { items: [], total: 0 };
        }

        const filters: Prisma.Sql[] = [
            Prisma.sql`import_batch_id = ${input.importBatchId}`,
            Prisma.sql`issue_status = 'open'`,
        ];
        if (input.entityKind) {
            filters.push(Prisma.sql`entity_kind = ${input.entityKind}`);
        }
        if (input.entityId != null) {
            filters.push(Prisma.sql`entity_id = ${input.entityId}`);
        }
        if (input.severity) {
            filters.push(Prisma.sql`severity = ${input.severity}`);
        }
        const where = Prisma.join(filters, " AND ");

        const totalRows = await this.prisma.$queryRaw<{ count: bigint }[]>`
            SELECT count(*)::bigint AS count
            FROM import_transport.validation_issues
            WHERE ${where}
        `;

        const rows = await this.prisma.$queryRaw<IssueRowDb[]>`
            SELECT
                id,
                import_batch_id,
                entity_kind,
                entity_id,
                entity_source_id,
                issue_code,
                severity,
                issue_status,
                message,
                details,
                created_at,
                resolved_at
            FROM import_transport.validation_issues
            WHERE ${where}
            ORDER BY created_at DESC, id DESC
            LIMIT ${input.limit} OFFSET ${input.offset}
        `;

        return {
            total: Number(totalRows[0]?.count ?? 0n),
            items: rows.map(mapIssueRow),
        };
    }

    async getCandidateSourceId(
        family: ImportTransportFamily,
        importBatchId: bigint,
        candidateId: bigint
    ): Promise<string | null> {
        const qualified = qualifiedImportTransportTable(family);
        if (!(await this.tableExists(qualified))) {
            return null;
        }
        const cfg = getImportTransportFamilyConfig(family);
        const rows = await this.prisma.$queryRaw<{ external_id: string | null }[]>`
            SELECT ${Prisma.raw(cfg.externalIdExpression)} AS external_id
            FROM ${Prisma.raw(qualified)} AS ${Prisma.raw(cfg.alias)}
            WHERE ${Prisma.raw(`${cfg.alias}.import_batch_id`)} = ${importBatchId}
              AND ${Prisma.raw(`${cfg.alias}.id`)} = ${candidateId}
            LIMIT 1
        `;
        return rows[0]?.external_id ?? null;
    }
}
