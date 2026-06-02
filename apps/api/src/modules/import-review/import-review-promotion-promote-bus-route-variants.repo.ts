import { Prisma, type PrismaClient } from "@prisma/client";

import {
    buildVerificationMetadataTracking,
    getCoreVerificationColumnsForEntity,
} from "./import-review-promotion-core-verification.js";
import type { PromoteItemResult } from "./import-review-promotion-promote.types.js";
import {
    ImportReviewSchemaCapabilityRegistry,
    type ImportReviewEntityColumnCapabilities,
    type ImportReviewTargetColumnCapabilities,
} from "./import-review-schema-capabilities.js";

export const BUS_ROUTE_VARIANT_CANDIDATE_TABLE = "import_review.bus_route_variant_candidates";
export const CORE_BUS_ROUTE_VARIANTS_TABLE = "core.core_bus_route_variants";

type BusRouteVariantCandidateRow = {
    publish_item_id: bigint;
    publish_batch_id: bigint;
    target_id: bigint | null;
    id: bigint;
    review_batch_id: bigint;
    source_snapshot_version: string;
    local_staging_id: bigint;
    external_id: string | null;
    route_id: bigint | null;
    route_code: string | null;
    variant_code: string | null;
    direction_name: string | null;
    origin_name: string | null;
    destination_name: string | null;
    distance_m: Prisma.Decimal | number | string | null;
    source_refs: unknown;
    normalized_data: unknown;
    matched_core_id: bigint | null;
    promoted_core_id: bigint | null;
};

const BUS_ROUTE_VARIANT_VERIFICATION_COLUMNS = getCoreVerificationColumnsForEntity("bus_route_variants");

function col(alias: string, column: string): Prisma.Sql {
    return Prisma.raw(`${alias}.${column}`);
}

function optionalColumnExpr(
    alias: string,
    caps: ImportReviewEntityColumnCapabilities,
    column: string,
    typeSql: string
): Prisma.Sql {
    return caps.hasColumn(column) ? col(alias, column) : Prisma.raw(`NULL::${typeSql}`);
}

function optionalJsonTextExpr(
    alias: string,
    caps: ImportReviewEntityColumnCapabilities,
    jsonColumn: "normalized_data" | "source_refs",
    key: string
): Prisma.Sql {
    return caps.hasColumn(jsonColumn) ? Prisma.sql`${col(alias, jsonColumn)}->>${key}` : Prisma.sql`NULL::text`;
}

function textExpr(
    alias: string,
    caps: ImportReviewEntityColumnCapabilities,
    column: "external_id" | "route_code" | "variant_code" | "direction_name" | "origin_name" | "destination_name"
): Prisma.Sql {
    return Prisma.sql`nullif(trim(coalesce(
        ${optionalColumnExpr(alias, caps, column, "text")},
        ${optionalJsonTextExpr(alias, caps, "normalized_data", column)},
        ''
    )), '')`;
}

function routeCodeExpr(alias: string, caps: ImportReviewEntityColumnCapabilities): Prisma.Sql {
    return Prisma.sql`nullif(trim(coalesce(
        ${optionalColumnExpr(alias, caps, "route_code", "text")},
        ${optionalJsonTextExpr(alias, caps, "normalized_data", "route_code")},
        ${optionalJsonTextExpr(alias, caps, "source_refs", "route_code")},
        ''
    )), '')`;
}

function variantCodeExpr(alias: string, caps: ImportReviewEntityColumnCapabilities): Prisma.Sql {
    return Prisma.sql`nullif(trim(coalesce(
        ${optionalColumnExpr(alias, caps, "variant_code", "text")},
        ${optionalJsonTextExpr(alias, caps, "normalized_data", "variant_code")},
        ${optionalJsonTextExpr(alias, caps, "normalized_data", "direction")},
        ''
    )), '')`;
}

function routeIdExpr(alias: string, caps: ImportReviewEntityColumnCapabilities): Prisma.Sql {
    return Prisma.sql`coalesce(
        ${optionalColumnExpr(alias, caps, "route_id", "bigint")},
        CASE WHEN ${optionalJsonTextExpr(alias, caps, "normalized_data", "route_id")} ~ '^[0-9]+$'
            THEN ${optionalJsonTextExpr(alias, caps, "normalized_data", "route_id")}::bigint END,
        CASE WHEN ${optionalJsonTextExpr(alias, caps, "source_refs", "route_id")} ~ '^[0-9]+$'
            THEN ${optionalJsonTextExpr(alias, caps, "source_refs", "route_id")}::bigint END
    )`;
}

function distanceExpr(alias: string, caps: ImportReviewEntityColumnCapabilities): Prisma.Sql {
    const geom = optionalColumnExpr(alias, caps, "geom", "geometry");
    return Prisma.sql`coalesce(
        ${optionalColumnExpr(alias, caps, "distance_m", "numeric")},
        CASE WHEN ${optionalJsonTextExpr(alias, caps, "normalized_data", "distance_m")} ~ '^[0-9]+(\\.[0-9]+)?$'
            THEN ${optionalJsonTextExpr(alias, caps, "normalized_data", "distance_m")}::numeric END,
        CASE WHEN ${geom} IS NOT NULL THEN ST_Length(${geom}::geography) END
    )`;
}

function lineGeomExpr(alias: string, caps: ImportReviewEntityColumnCapabilities): Prisma.Sql {
    const geom = optionalColumnExpr(alias, caps, "geom", "geometry");
    return Prisma.sql`
        CASE
            WHEN ${geom} IS NULL THEN NULL::geometry(LineString, 4326)
            WHEN ST_GeometryType(${geom}) = 'ST_LineString' THEN ${geom}::geometry(LineString, 4326)
            WHEN ST_GeometryType(${geom}) = 'ST_MultiLineString'
                 AND ST_GeometryType(ST_LineMerge(${geom})) = 'ST_LineString'
                THEN ST_LineMerge(${geom})::geometry(LineString, 4326)
            ELSE NULL::geometry(LineString, 4326)
        END
    `;
}

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function scalarText(value: unknown): string | null {
    return typeof value === "string" && value.trim() ? value.trim() : null;
}

function bigintText(value: bigint): string {
    return value.toString();
}

function activeTargetWhere(targetCaps: ImportReviewTargetColumnCapabilities, alias: string): Prisma.Sql {
    const checks: Prisma.Sql[] = [];
    if (targetCaps.hasIsActive) checks.push(Prisma.sql`coalesce(${col(alias, "is_active")}, true)`);
    if (targetCaps.hasDeletedAt) checks.push(Prisma.sql`${col(alias, "deleted_at")} IS NULL`);
    return checks.length > 0 ? Prisma.join(checks, " AND ") : Prisma.sql`true`;
}

function unverifiedWhere(targetCaps: ImportReviewTargetColumnCapabilities, alias: string): Prisma.Sql {
    if (targetCaps.hasIsVerified) return Prisma.sql`coalesce(${col(alias, "is_verified")}, false) IS FALSE`;
    if (targetCaps.hasVerificationStatus) return Prisma.sql`coalesce(${col(alias, "verification_status")}, 'unverified') <> 'verified'`;
    return Prisma.sql`true`;
}

function buildSourceRefs(
    candidate: BusRouteVariantCandidateRow,
    publishBatchId: bigint,
    resolvedRouteId: bigint
): Record<string, unknown> {
    return {
        ...asRecord(candidate.source_refs),
        review_candidate_id: bigintText(candidate.id),
        review_batch_id: bigintText(candidate.review_batch_id),
        publish_batch_id: bigintText(publishBatchId),
        source_snapshot_version: candidate.source_snapshot_version,
        local_staging_id: bigintText(candidate.local_staging_id),
        entity_family: "bus_route_variants",
        resolved_route_id: bigintText(resolvedRouteId),
    };
}

function buildNormalizedData(candidate: BusRouteVariantCandidateRow): Record<string, unknown> {
    return {
        ...asRecord(candidate.normalized_data),
        promotion: {
            promoted_from: BUS_ROUTE_VARIANT_CANDIDATE_TABLE,
            promoted_at: new Date().toISOString(),
            phase: "12B_bus_route_variant_promotion",
        },
    };
}

function insertColumnsAndSelects(args: {
    targetCaps: ImportReviewTargetColumnCapabilities;
    routeId: bigint;
    variantCode: string;
    directionName: string | null;
    originName: string | null;
    destinationName: string | null;
    caps: ImportReviewEntityColumnCapabilities;
}): { columns: Prisma.Sql[]; selects: Prisma.Sql[] } {
    const columns: Prisma.Sql[] = [];
    const selects: Prisma.Sql[] = [];
    const push = (column: string, value: Prisma.Sql) => {
        if (args.targetCaps.hasColumn(column)) {
            columns.push(Prisma.raw(column));
            selects.push(value);
        }
    };
    push("route_id", Prisma.sql`${args.routeId}`);
    push("variant_code", Prisma.sql`${args.variantCode}`);
    push("direction_name", Prisma.sql`${args.directionName}`);
    push("origin_name", Prisma.sql`${args.originName}`);
    push("destination_name", Prisma.sql`${args.destinationName}`);
    push("geom", lineGeomExpr("brv", args.caps));
    push("distance_m", distanceExpr("brv", args.caps));
    push("is_active", Prisma.sql`true`);
    for (const column of BUS_ROUTE_VARIANT_VERIFICATION_COLUMNS) {
        if (!args.targetCaps.hasColumn(column)) continue;
        if (column === "is_verified") push(column, Prisma.sql`false`);
        if (column === "verification_status") push(column, Prisma.sql`'unverified'`);
        if (column === "verified_at" || column === "verified_by" || column === "verification_note") {
            push(column, Prisma.sql`NULL`);
        }
    }
    return { columns, selects };
}

function updateSetSql(args: {
    targetCaps: ImportReviewTargetColumnCapabilities;
    routeId: bigint;
    variantCode: string;
    directionName: string | null;
    originName: string | null;
    destinationName: string | null;
}): Prisma.Sql {
    const assignments: Prisma.Sql[] = [];
    const push = (column: string, value: Prisma.Sql) => {
        if (args.targetCaps.hasColumn(column)) {
            assignments.push(Prisma.sql`${Prisma.raw(column)} = ${value}`);
        }
    };
    push("route_id", Prisma.sql`${args.routeId}`);
    push("variant_code", Prisma.sql`${args.variantCode}`);
    push("direction_name", Prisma.sql`${args.directionName}`);
    push("origin_name", Prisma.sql`${args.originName}`);
    push("destination_name", Prisma.sql`${args.destinationName}`);
    push("geom", Prisma.sql`candidate.geom`);
    push("distance_m", Prisma.sql`candidate.distance_m`);
    push("is_active", Prisma.sql`true`);
    for (const column of BUS_ROUTE_VARIANT_VERIFICATION_COLUMNS) {
        if (!args.targetCaps.hasColumn(column)) continue;
        if (column === "is_verified") push(column, Prisma.sql`false`);
        if (column === "verification_status") push(column, Prisma.sql`'unverified'`);
        if (column === "verified_at" || column === "verified_by" || column === "verification_note") {
            push(column, Prisma.sql`NULL`);
        }
    }
    return Prisma.join(assignments, ", ");
}

export class ImportReviewPromotionPromoteBusRouteVariantsRepository {
    private readonly schemaRegistry: ImportReviewSchemaCapabilityRegistry;

    constructor(private readonly prisma: PrismaClient) {
        this.schemaRegistry = new ImportReviewSchemaCapabilityRegistry(prisma);
    }

    async checkBusRouteVariantCoreExists(targetId: bigint): Promise<boolean> {
        const targetCaps = await this.schemaRegistry.getTargetColumnCapabilities(CORE_BUS_ROUTE_VARIANTS_TABLE);
        if (!targetCaps.hasColumn("id")) return false;
        const rows = await this.prisma.$queryRaw<{ id: bigint }[]>(Prisma.sql`
            SELECT id
            FROM core.core_bus_route_variants AS v
            WHERE v.id = ${targetId}
              AND ${activeTargetWhere(targetCaps, "v")}
            LIMIT 1
        `);
        return rows.length > 0;
    }

    async insertBusRouteVariant(
        batchId: bigint,
        publishItemId: bigint,
        promotedBy: bigint | null
    ): Promise<PromoteItemResult> {
        return this.promoteBusRouteVariant(batchId, publishItemId, promotedBy, "insert");
    }

    async updateBusRouteVariant(
        batchId: bigint,
        publishItemId: bigint,
        promotedBy: bigint | null
    ): Promise<PromoteItemResult> {
        return this.promoteBusRouteVariant(batchId, publishItemId, promotedBy, "update");
    }

    private async promoteBusRouteVariant(
        batchId: bigint,
        publishItemId: bigint,
        promotedBy: bigint | null,
        mode: "insert" | "update"
    ): Promise<PromoteItemResult> {
        try {
            const caps = await this.schemaRegistry.getEntityColumnCapabilities("bus_route_variants");
            const targetCaps = await this.schemaRegistry.getTargetColumnCapabilities(CORE_BUS_ROUTE_VARIANTS_TABLE);
            const missingRequired = ["id", "route_id", "variant_code", "geom"]
                .filter((column) => !targetCaps.hasColumn(column));
            if (missingRequired.length > 0) {
                return this.failed(publishItemId, `core.core_bus_route_variants is missing required column(s): ${missingRequired.join(", ")}.`);
            }

            const candidate = await this.fetchCandidate(batchId, publishItemId, caps);
            if (!candidate) {
                return this.failed(publishItemId, "Bus route variant candidate not found.");
            }
            const resolvedRouteId = await this.resolveRouteId(candidate);
            if (!resolvedRouteId) {
                return this.failed(publishItemId, "DEPENDENCY_ROUTE_MISSING: bus route variant requires an existing core bus route.");
            }
            if (!candidate.variant_code) {
                return this.failed(publishItemId, "Bus route variant promotion blocked: variant_code is required.");
            }

            const existingId =
                mode === "update"
                    ? (candidate.target_id ?? candidate.matched_core_id ?? candidate.promoted_core_id ?? await this.findExistingByRouteVariant(resolvedRouteId, candidate.variant_code, targetCaps))
                    : await this.findExistingByRouteVariant(resolvedRouteId, candidate.variant_code, targetCaps);
            const beforeData = existingId ? await this.fetchTargetData(existingId) : null;
            const sourceRefs = buildSourceRefs(candidate, batchId, resolvedRouteId);
            const normalizedData = buildNormalizedData(candidate);

            if (existingId) {
                const setSql = updateSetSql({
                    targetCaps,
                    routeId: resolvedRouteId,
                    variantCode: candidate.variant_code,
                    directionName: candidate.direction_name,
                    originName: candidate.origin_name,
                    destinationName: candidate.destination_name,
                });
                const rows = await this.prisma.$queryRaw<{ id: bigint; route_id: bigint; variant_code: string }[]>(Prisma.sql`
                    UPDATE core.core_bus_route_variants AS v
                    SET ${setSql}
                    FROM (
                        SELECT ${lineGeomExpr("brv", caps)} AS geom, ${distanceExpr("brv", caps)} AS distance_m
                        FROM system.system_publish_items AS spi
                        INNER JOIN import_review.bus_route_variant_candidates AS brv
                            ON brv.id = spi.review_candidate_id
                           AND spi.review_candidate_table = ${BUS_ROUTE_VARIANT_CANDIDATE_TABLE}
                        WHERE spi.id = ${publishItemId}
                          AND spi.publish_batch_id = ${batchId}
                        LIMIT 1
                    ) AS candidate
                    WHERE v.id = ${existingId}
                      AND candidate.geom IS NOT NULL
                      AND ${activeTargetWhere(targetCaps, "v")}
                      AND ${unverifiedWhere(targetCaps, "v")}
                    RETURNING v.id, v.route_id, v.variant_code
                `);
                const row = rows[0];
                if (!row) {
                    return {
                        publish_item_id: publishItemId,
                        outcome: "failed",
                        target_id: null,
                        error_message: "Bus route variant update blocked: target missing, inactive, deleted, already verified, or geometry could not become LineString.",
                        before_data: beforeData,
                        after_data: null,
                    };
                }
                await this.persistCandidatePromotionMetadata(candidate.id, sourceRefs, normalizedData, caps);
                return {
                    publish_item_id: publishItemId,
                    outcome: "updated",
                    target_id: row.id,
                    error_message: null,
                    before_data: beforeData,
                    after_data: {
                        id: bigintText(row.id),
                        route_id: bigintText(row.route_id),
                        variant_code: row.variant_code,
                        source_refs: sourceRefs,
                        normalized_data: normalizedData,
                        skipped_target_columns: {
                            source_refs: !targetCaps.hasSourceRefs,
                            normalized_data: !targetCaps.hasNormalizedData,
                        },
                    },
                    ...buildVerificationMetadataTracking({ outcome: "updated", beforeData, entityKey: "bus_route_variants" }),
                };
            }

            const { columns, selects } = insertColumnsAndSelects({
                targetCaps,
                routeId: resolvedRouteId,
                variantCode: candidate.variant_code,
                directionName: candidate.direction_name,
                originName: candidate.origin_name,
                destinationName: candidate.destination_name,
                caps,
            });
            const rows = await this.prisma.$queryRaw<{ id: bigint; route_id: bigint; variant_code: string }[]>(Prisma.sql`
                INSERT INTO core.core_bus_route_variants (${Prisma.join(columns, ", ")})
                SELECT ${Prisma.join(selects, ", ")}
                FROM system.system_publish_items AS spi
                INNER JOIN import_review.bus_route_variant_candidates AS brv
                    ON brv.id = spi.review_candidate_id
                   AND spi.review_candidate_table = ${BUS_ROUTE_VARIANT_CANDIDATE_TABLE}
                WHERE spi.id = ${publishItemId}
                  AND spi.publish_batch_id = ${batchId}
                  AND ${lineGeomExpr("brv", caps)} IS NOT NULL
                RETURNING id, route_id, variant_code
            `);
            const row = rows[0];
            if (!row) {
                return this.failed(publishItemId, "Bus route variant insert blocked: geometry could not become LineString.");
            }
            await this.persistCandidatePromotionMetadata(candidate.id, sourceRefs, normalizedData, caps);
            return {
                publish_item_id: publishItemId,
                outcome: "inserted",
                target_id: row.id,
                error_message: null,
                before_data: null,
                after_data: {
                    id: bigintText(row.id),
                    route_id: bigintText(row.route_id),
                    variant_code: row.variant_code,
                    source_refs: sourceRefs,
                    normalized_data: normalizedData,
                    skipped_target_columns: {
                        source_refs: !targetCaps.hasSourceRefs,
                        normalized_data: !targetCaps.hasNormalizedData,
                    },
                },
                ...buildVerificationMetadataTracking({ outcome: "inserted", beforeData: null, entityKey: "bus_route_variants" }),
            };
        } catch (err) {
            return this.failed(publishItemId, err instanceof Error ? err.message : "Bus route variant promotion failed.");
        }
    }

    private failed(publishItemId: bigint, message: string): PromoteItemResult {
        return {
            publish_item_id: publishItemId,
            outcome: "failed",
            target_id: null,
            error_message: message,
            before_data: null,
            after_data: null,
        };
    }

    private async fetchCandidate(
        batchId: bigint,
        publishItemId: bigint,
        caps: ImportReviewEntityColumnCapabilities
    ): Promise<BusRouteVariantCandidateRow | null> {
        const rows = await this.prisma.$queryRaw<BusRouteVariantCandidateRow[]>(Prisma.sql`
            SELECT
                spi.id AS publish_item_id,
                spi.publish_batch_id,
                spi.target_id,
                brv.id,
                brv.review_batch_id,
                brv.source_snapshot_version,
                brv.local_staging_id,
                ${textExpr("brv", caps, "external_id")} AS external_id,
                ${routeIdExpr("brv", caps)} AS route_id,
                ${routeCodeExpr("brv", caps)} AS route_code,
                ${variantCodeExpr("brv", caps)} AS variant_code,
                ${textExpr("brv", caps, "direction_name")} AS direction_name,
                ${textExpr("brv", caps, "origin_name")} AS origin_name,
                ${textExpr("brv", caps, "destination_name")} AS destination_name,
                ${distanceExpr("brv", caps)} AS distance_m,
                ${optionalColumnExpr("brv", caps, "source_refs", "jsonb")} AS source_refs,
                ${optionalColumnExpr("brv", caps, "normalized_data", "jsonb")} AS normalized_data,
                ${optionalColumnExpr("brv", caps, "matched_core_id", "bigint")} AS matched_core_id,
                ${optionalColumnExpr("brv", caps, "promoted_core_id", "bigint")} AS promoted_core_id
            FROM system.system_publish_items AS spi
            INNER JOIN import_review.bus_route_variant_candidates AS brv
                ON brv.id = spi.review_candidate_id
               AND spi.review_candidate_table = ${BUS_ROUTE_VARIANT_CANDIDATE_TABLE}
            WHERE spi.id = ${publishItemId}
              AND spi.publish_batch_id = ${batchId}
              AND spi.entity_family = 'bus_route_variants'
            LIMIT 1
        `);
        return rows[0] ?? null;
    }

    private async persistCandidatePromotionMetadata(
        candidateId: bigint,
        sourceRefs: Record<string, unknown>,
        normalizedData: Record<string, unknown>,
        caps: ImportReviewEntityColumnCapabilities
    ): Promise<void> {
        const assignments: Prisma.Sql[] = [];
        if (caps.hasSourceRefs) {
            assignments.push(Prisma.sql`source_refs = ${JSON.stringify(sourceRefs)}::jsonb`);
        }
        if (caps.hasNormalizedData) {
            assignments.push(Prisma.sql`normalized_data = ${JSON.stringify(normalizedData)}::jsonb`);
        }
        if (assignments.length === 0) {
            return;
        }
        await this.prisma.$executeRaw(Prisma.sql`
            UPDATE import_review.bus_route_variant_candidates
            SET ${Prisma.join(assignments, ", ")},
                updated_at = now()
            WHERE id = ${candidateId}
        `);
    }

    private async resolveRouteId(candidate: BusRouteVariantCandidateRow): Promise<bigint | null> {
        if (candidate.route_id) {
            const direct = await this.findActiveRouteById(candidate.route_id);
            if (direct) return direct;
        }

        const fromBatch = await this.findRouteFromPublishBatch(candidate);
        if (fromBatch) return fromBatch;

        const refs = asRecord(candidate.source_refs);
        const data = asRecord(candidate.normalized_data);
        const externalRouteRef =
            scalarText(refs.route_external_id) ??
            scalarText(refs.bus_route_external_id) ??
            scalarText(data.route_external_id);
        const routeCode = candidate.route_code ?? scalarText(refs.route_code) ?? scalarText(data.route_code);
        if (!routeCode && !externalRouteRef) return null;

        const rows = await this.prisma.$queryRaw<{ id: bigint }[]>`
            SELECT id
            FROM core.core_bus_routes
            WHERE coalesce(is_active, true)
              AND deleted_at IS NULL
              AND (
                  (${routeCode}::text IS NOT NULL AND route_code = ${routeCode})
                  OR (${externalRouteRef}::text IS NOT NULL AND external_id = ${externalRouteRef})
              )
            ORDER BY id
            LIMIT 1
        `;
        return rows[0]?.id ?? null;
    }

    private async findActiveRouteById(routeId: bigint): Promise<bigint | null> {
        const rows = await this.prisma.$queryRaw<{ id: bigint }[]>`
            SELECT id
            FROM core.core_bus_routes
            WHERE id = ${routeId}
              AND coalesce(is_active, true)
              AND deleted_at IS NULL
            LIMIT 1
        `;
        return rows[0]?.id ?? null;
    }

    private async findRouteFromPublishBatch(candidate: BusRouteVariantCandidateRow): Promise<bigint | null> {
        const refs = asRecord(candidate.source_refs);
        const routeLocalStagingId = scalarText(refs.route_local_staging_id);
        const rows = await this.prisma.$queryRaw<{ id: bigint | null }[]>`
            SELECT coalesce(route_item.target_id, route_candidate.promoted_core_id, route_candidate.matched_core_id) AS id
            FROM system.system_publish_items AS route_item
            INNER JOIN import_review.bus_route_candidates AS route_candidate
                ON route_candidate.id = route_item.review_candidate_id
               AND route_item.review_candidate_table = 'import_review.bus_route_candidates'
            WHERE route_item.publish_batch_id = ${candidate.publish_batch_id}
              AND route_item.entity_family = 'bus_routes'
              AND coalesce(route_item.target_id, route_candidate.promoted_core_id, route_candidate.matched_core_id) IS NOT NULL
              AND (
                  (${candidate.route_code}::text IS NOT NULL AND route_candidate.route_code = ${candidate.route_code})
                  OR (${routeLocalStagingId}::text ~ '^[0-9]+$' AND route_candidate.local_staging_id = ${routeLocalStagingId}::bigint)
              )
            LIMIT 1
        `;
        return rows[0]?.id ?? null;
    }

    private async findExistingByRouteVariant(
        routeId: bigint,
        variantCode: string,
        targetCaps: ImportReviewTargetColumnCapabilities
    ): Promise<bigint | null> {
        const rows = await this.prisma.$queryRaw<{ id: bigint }[]>(Prisma.sql`
            SELECT id
            FROM core.core_bus_route_variants AS v
            WHERE v.route_id = ${routeId}
              AND v.variant_code = ${variantCode}
              AND ${activeTargetWhere(targetCaps, "v")}
            ORDER BY id DESC
            LIMIT 1
        `);
        return rows[0]?.id ?? null;
    }

    private async fetchTargetData(targetId: bigint): Promise<Record<string, unknown> | null> {
        const rows = await this.prisma.$queryRaw<{ data: unknown }[]>`
            SELECT to_jsonb(v.*) AS data
            FROM core.core_bus_route_variants AS v
            WHERE v.id = ${targetId}
            LIMIT 1
        `;
        return rows[0]?.data ? asRecord(rows[0].data) : null;
    }
}
