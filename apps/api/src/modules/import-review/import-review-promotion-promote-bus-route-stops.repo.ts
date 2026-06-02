import { Prisma, type PrismaClient } from "@prisma/client";

import { getCoreVerificationColumnsForEntity } from "./import-review-promotion-core-verification.js";
import type { PromoteItemResult } from "./import-review-promotion-promote.types.js";
import {
    ImportReviewSchemaCapabilityRegistry,
    type ImportReviewEntityColumnCapabilities,
    type ImportReviewTargetColumnCapabilities,
} from "./import-review-schema-capabilities.js";

export const BUS_ROUTE_STOP_CANDIDATE_TABLE = "import_review.bus_route_stop_candidates";
export const CORE_BUS_ROUTE_STOPS_TABLE = "core.core_bus_route_stops";

type BusRouteStopCandidateRow = {
    publish_item_id: bigint;
    publish_batch_id: bigint;
    id: bigint;
    review_batch_id: bigint;
    source_snapshot_version: string;
    local_staging_id: bigint;
    external_id: string | null;
    route_variant_id: bigint | null;
    stop_id: bigint | null;
    stop_sequence: number | null;
    distance_from_start_m: Prisma.Decimal | number | string | null;
    is_timing_point: boolean | null;
    source_refs: unknown;
    normalized_data: unknown;
};

type RouteStopRelationKey = {
    route_variant_id: bigint;
    stop_id: bigint;
    stop_sequence: number;
};

const BUS_ROUTE_STOP_VERIFICATION_COLUMNS = getCoreVerificationColumnsForEntity("bus_route_stops");

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

function bigintExpr(
    alias: string,
    caps: ImportReviewEntityColumnCapabilities,
    column: "route_variant_id" | "stop_id"
): Prisma.Sql {
    return Prisma.sql`coalesce(
        ${optionalColumnExpr(alias, caps, column, "bigint")},
        CASE WHEN ${optionalJsonTextExpr(alias, caps, "normalized_data", column)} ~ '^[0-9]+$'
            THEN ${optionalJsonTextExpr(alias, caps, "normalized_data", column)}::bigint END,
        CASE WHEN ${optionalJsonTextExpr(alias, caps, "source_refs", column)} ~ '^[0-9]+$'
            THEN ${optionalJsonTextExpr(alias, caps, "source_refs", column)}::bigint END
    )`;
}

function intExpr(alias: string, caps: ImportReviewEntityColumnCapabilities, column: "stop_sequence"): Prisma.Sql {
    return Prisma.sql`coalesce(
        ${optionalColumnExpr(alias, caps, column, "integer")},
        CASE WHEN ${optionalJsonTextExpr(alias, caps, "normalized_data", column)} ~ '^[0-9]+$'
            THEN ${optionalJsonTextExpr(alias, caps, "normalized_data", column)}::integer END
    )`;
}

function numericExpr(alias: string, caps: ImportReviewEntityColumnCapabilities): Prisma.Sql {
    return Prisma.sql`coalesce(
        ${optionalColumnExpr(alias, caps, "distance_from_start_m", "numeric")},
        CASE WHEN ${optionalJsonTextExpr(alias, caps, "normalized_data", "distance_from_start_m")} ~ '^[0-9]+(\\.[0-9]+)?$'
            THEN ${optionalJsonTextExpr(alias, caps, "normalized_data", "distance_from_start_m")}::numeric END
    )`;
}

function booleanExpr(alias: string, caps: ImportReviewEntityColumnCapabilities): Prisma.Sql {
    return Prisma.sql`coalesce(
        ${optionalColumnExpr(alias, caps, "is_timing_point", "boolean")},
        CASE
            WHEN lower(${optionalJsonTextExpr(alias, caps, "normalized_data", "is_timing_point")}) IN ('true', 't', '1', 'yes') THEN true
            WHEN lower(${optionalJsonTextExpr(alias, caps, "normalized_data", "is_timing_point")}) IN ('false', 'f', '0', 'no') THEN false
        END,
        false
    )`;
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

function relationKeyObject(key: RouteStopRelationKey): Record<string, string | number> {
    return {
        route_variant_id: bigintText(key.route_variant_id),
        stop_id: bigintText(key.stop_id),
        stop_sequence: key.stop_sequence,
    };
}

function buildSourceRefs(
    candidate: BusRouteStopCandidateRow,
    publishBatchId: bigint,
    key: RouteStopRelationKey
): Record<string, unknown> {
    return {
        ...asRecord(candidate.source_refs),
        review_candidate_id: bigintText(candidate.id),
        review_batch_id: bigintText(candidate.review_batch_id),
        publish_batch_id: bigintText(publishBatchId),
        source_snapshot_version: candidate.source_snapshot_version,
        local_staging_id: bigintText(candidate.local_staging_id),
        entity_family: "bus_route_stops",
        resolved_route_variant_id: bigintText(key.route_variant_id),
        resolved_stop_id: bigintText(key.stop_id),
    };
}

function buildNormalizedData(
    candidate: BusRouteStopCandidateRow,
    key: RouteStopRelationKey,
    sourceRefs: Record<string, unknown>
): Record<string, unknown> {
    return {
        ...asRecord(candidate.normalized_data),
        source_refs: sourceRefs,
        promotion: {
            promoted_from: BUS_ROUTE_STOP_CANDIDATE_TABLE,
            promoted_at: new Date().toISOString(),
            phase: "12C_bus_route_stop_promotion",
            relation_key: relationKeyObject(key),
        },
    };
}

function insertColumnsAndValues(args: {
    targetCaps: ImportReviewTargetColumnCapabilities;
    key: RouteStopRelationKey;
    distanceFromStartM: unknown;
    isTimingPoint: boolean;
}): { columns: Prisma.Sql[]; values: Prisma.Sql[] } {
    const columns: Prisma.Sql[] = [];
    const values: Prisma.Sql[] = [];
    const push = (column: string, value: Prisma.Sql) => {
        if (args.targetCaps.hasColumn(column)) {
            columns.push(Prisma.raw(column));
            values.push(value);
        }
    };
    push("route_variant_id", Prisma.sql`${args.key.route_variant_id}`);
    push("stop_id", Prisma.sql`${args.key.stop_id}`);
    push("stop_sequence", Prisma.sql`${args.key.stop_sequence}`);
    push("distance_from_start_m", Prisma.sql`${args.distanceFromStartM}`);
    push("is_timing_point", Prisma.sql`${args.isTimingPoint}`);
    for (const column of BUS_ROUTE_STOP_VERIFICATION_COLUMNS) {
        if (!args.targetCaps.hasColumn(column)) continue;
        if (column === "is_verified") push(column, Prisma.sql`false`);
        if (column === "verification_status") push(column, Prisma.sql`'unverified'`);
        if (column === "verified_at" || column === "verified_by" || column === "verification_note") {
            push(column, Prisma.sql`NULL`);
        }
    }
    return { columns, values };
}

function updateSetSql(args: {
    targetCaps: ImportReviewTargetColumnCapabilities;
    distanceFromStartM: unknown;
    isTimingPoint: boolean;
}): Prisma.Sql {
    const assignments: Prisma.Sql[] = [];
    const push = (column: string, value: Prisma.Sql) => {
        if (args.targetCaps.hasColumn(column)) {
            assignments.push(Prisma.sql`${Prisma.raw(column)} = ${value}`);
        }
    };
    push("distance_from_start_m", Prisma.sql`${args.distanceFromStartM}`);
    push("is_timing_point", Prisma.sql`${args.isTimingPoint}`);
    for (const column of BUS_ROUTE_STOP_VERIFICATION_COLUMNS) {
        if (!args.targetCaps.hasColumn(column)) continue;
        if (column === "is_verified") push(column, Prisma.sql`false`);
        if (column === "verification_status") push(column, Prisma.sql`'unverified'`);
        if (column === "verified_at" || column === "verified_by" || column === "verification_note") {
            push(column, Prisma.sql`NULL`);
        }
    }
    return Prisma.join(assignments, ", ");
}

function unverifiedWhere(targetCaps: ImportReviewTargetColumnCapabilities, alias: string): Prisma.Sql {
    if (targetCaps.hasIsVerified) return Prisma.sql`coalesce(${col(alias, "is_verified")}, false) IS FALSE`;
    if (targetCaps.hasVerificationStatus) return Prisma.sql`coalesce(${col(alias, "verification_status")}, 'unverified') <> 'verified'`;
    return Prisma.sql`true`;
}

export class ImportReviewPromotionPromoteBusRouteStopsRepository {
    private readonly schemaRegistry: ImportReviewSchemaCapabilityRegistry;

    constructor(private readonly prisma: PrismaClient) {
        this.schemaRegistry = new ImportReviewSchemaCapabilityRegistry(prisma);
    }

    async insertBusRouteStop(
        batchId: bigint,
        publishItemId: bigint,
        promotedBy: bigint | null
    ): Promise<PromoteItemResult> {
        return this.promoteBusRouteStop(batchId, publishItemId, promotedBy);
    }

    async updateBusRouteStop(
        batchId: bigint,
        publishItemId: bigint,
        promotedBy: bigint | null
    ): Promise<PromoteItemResult> {
        return this.promoteBusRouteStop(batchId, publishItemId, promotedBy);
    }

    private async promoteBusRouteStop(
        batchId: bigint,
        publishItemId: bigint,
        _promotedBy: bigint | null
    ): Promise<PromoteItemResult> {
        try {
            const caps = await this.schemaRegistry.getEntityColumnCapabilities("bus_route_stops");
            const targetCaps = await this.schemaRegistry.getTargetColumnCapabilities(CORE_BUS_ROUTE_STOPS_TABLE);
            const missingRequired = ["route_variant_id", "stop_id", "stop_sequence"]
                .filter((column) => !targetCaps.hasColumn(column));
            if (missingRequired.length > 0) {
                return this.failed(publishItemId, `core.core_bus_route_stops is missing required column(s): ${missingRequired.join(", ")}.`);
            }

            const candidate = await this.fetchCandidate(batchId, publishItemId, caps);
            if (!candidate) {
                return this.failed(publishItemId, "Bus route stop candidate not found.");
            }
            const routeVariantId = await this.resolveRouteVariantId(candidate);
            if (!routeVariantId) {
                return this.failed(publishItemId, "DEPENDENCY_VARIANT_MISSING: route-stop relation requires an existing core bus route variant.");
            }
            const stopId = await this.resolveStopId(candidate);
            if (!stopId) {
                return this.failed(publishItemId, "DEPENDENCY_STOP_MISSING: route-stop relation requires an existing core bus stop.");
            }
            if (!candidate.stop_sequence || candidate.stop_sequence <= 0) {
                return this.failed(publishItemId, "Bus route stop promotion blocked: stop_sequence must be greater than 0.");
            }

            const key: RouteStopRelationKey = {
                route_variant_id: routeVariantId,
                stop_id: stopId,
                stop_sequence: candidate.stop_sequence,
            };
            const beforeData = await this.fetchRelationData(key);
            const sourceRefs = buildSourceRefs(candidate, batchId, key);
            const normalizedData = buildNormalizedData(candidate, key, sourceRefs);
            const distance = candidate.distance_from_start_m;
            const isTimingPoint = candidate.is_timing_point ?? false;

            if (beforeData) {
                const setSql = updateSetSql({ targetCaps, distanceFromStartM: distance, isTimingPoint });
                const rows = await this.prisma.$queryRaw<{ route_variant_id: bigint; stop_id: bigint; stop_sequence: number }[]>(Prisma.sql`
                    UPDATE core.core_bus_route_stops AS rs
                    SET ${setSql}
                    WHERE rs.route_variant_id = ${key.route_variant_id}
                      AND rs.stop_id = ${key.stop_id}
                      AND rs.stop_sequence = ${key.stop_sequence}
                      AND ${unverifiedWhere(targetCaps, "rs")}
                    RETURNING rs.route_variant_id, rs.stop_id, rs.stop_sequence
                `);
                if (rows.length === 0) {
                    return this.failed(publishItemId, "Bus route stop update blocked: relation is already verified or no longer exists.");
                }
                await this.persistCandidatePromotionMetadata(candidate.id, key, sourceRefs, normalizedData, caps);
                return {
                    publish_item_id: publishItemId,
                    outcome: "updated",
                    target_id: null,
                    error_message: null,
                    before_data: beforeData,
                    after_data: this.afterData(key, sourceRefs, normalizedData, "updated"),
                    verification_metadata_applied: true,
                    verification_metadata_skipped_already_verified: false,
                };
            }

            const { columns, values } = insertColumnsAndValues({
                targetCaps,
                key,
                distanceFromStartM: distance,
                isTimingPoint,
            });
            await this.prisma.$executeRaw(Prisma.sql`
                INSERT INTO core.core_bus_route_stops (${Prisma.join(columns, ", ")})
                VALUES (${Prisma.join(values, ", ")})
            `);
            await this.persistCandidatePromotionMetadata(candidate.id, key, sourceRefs, normalizedData, caps);
            return {
                publish_item_id: publishItemId,
                outcome: "inserted",
                target_id: null,
                error_message: null,
                before_data: null,
                after_data: this.afterData(key, sourceRefs, normalizedData, "inserted"),
                verification_metadata_applied: true,
                verification_metadata_skipped_already_verified: false,
            };
        } catch (err) {
            return this.failed(publishItemId, err instanceof Error ? err.message : "Bus route stop promotion failed.");
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

    private afterData(
        key: RouteStopRelationKey,
        sourceRefs: Record<string, unknown>,
        normalizedData: Record<string, unknown>,
        outcome: "inserted" | "updated"
    ): Record<string, unknown> {
        return {
            ...relationKeyObject(key),
            relation_key: relationKeyObject(key),
            source_refs: sourceRefs,
            normalized_data: normalizedData,
            outcome,
        };
    }

    private async fetchCandidate(
        batchId: bigint,
        publishItemId: bigint,
        caps: ImportReviewEntityColumnCapabilities
    ): Promise<BusRouteStopCandidateRow | null> {
        const rows = await this.prisma.$queryRaw<BusRouteStopCandidateRow[]>(Prisma.sql`
            SELECT
                spi.id AS publish_item_id,
                spi.publish_batch_id,
                brs.id,
                brs.review_batch_id,
                brs.source_snapshot_version,
                brs.local_staging_id,
                ${optionalColumnExpr("brs", caps, "external_id", "text")} AS external_id,
                ${bigintExpr("brs", caps, "route_variant_id")} AS route_variant_id,
                ${bigintExpr("brs", caps, "stop_id")} AS stop_id,
                ${intExpr("brs", caps, "stop_sequence")} AS stop_sequence,
                ${numericExpr("brs", caps)} AS distance_from_start_m,
                ${booleanExpr("brs", caps)} AS is_timing_point,
                ${optionalColumnExpr("brs", caps, "source_refs", "jsonb")} AS source_refs,
                ${optionalColumnExpr("brs", caps, "normalized_data", "jsonb")} AS normalized_data,
            FROM system.system_publish_items AS spi
            INNER JOIN import_review.bus_route_stop_candidates AS brs
                ON brs.id = spi.review_candidate_id
               AND spi.review_candidate_table = ${BUS_ROUTE_STOP_CANDIDATE_TABLE}
            WHERE spi.id = ${publishItemId}
              AND spi.publish_batch_id = ${batchId}
              AND spi.entity_family = 'bus_route_stops'
            LIMIT 1
        `);
        return rows[0] ?? null;
    }

    private async resolveRouteVariantId(candidate: BusRouteStopCandidateRow): Promise<bigint | null> {
        if (candidate.route_variant_id) {
            const direct = await this.findActiveVariantById(candidate.route_variant_id);
            if (direct) return direct;
        }

        const refs = asRecord(candidate.source_refs);
        const data = asRecord(candidate.normalized_data);
        const routeVariantLocalStagingId = scalarText(refs.route_variant_local_staging_id);
        const variantCode = scalarText(refs.variant_code) ?? scalarText(data.variant_code);
        const sameBatchRows = await this.prisma.$queryRaw<{ id: bigint | null }[]>`
            SELECT coalesce(variant_item.target_id, variant_candidate.promoted_core_id, variant_candidate.matched_core_id) AS id
            FROM system.system_publish_items AS variant_item
            INNER JOIN import_review.bus_route_variant_candidates AS variant_candidate
                ON variant_candidate.id = variant_item.review_candidate_id
               AND variant_item.review_candidate_table = 'import_review.bus_route_variant_candidates'
            WHERE variant_item.publish_batch_id = ${candidate.publish_batch_id}
              AND variant_item.entity_family = 'bus_route_variants'
              AND coalesce(variant_item.target_id, variant_candidate.promoted_core_id, variant_candidate.matched_core_id) IS NOT NULL
              AND (
                  (${variantCode}::text IS NOT NULL AND variant_candidate.variant_code = ${variantCode})
                  OR (${routeVariantLocalStagingId}::text ~ '^[0-9]+$' AND variant_candidate.local_staging_id = ${routeVariantLocalStagingId}::bigint)
              )
            LIMIT 1
        `;
        if (sameBatchRows[0]?.id) return sameBatchRows[0].id;

        const externalVariantRef = scalarText(refs.route_variant_external_id) ?? scalarText(refs.variant_external_id) ?? scalarText(data.route_variant_external_id);
        const coreRows = await this.prisma.$queryRaw<{ id: bigint }[]>`
            SELECT id
            FROM core.core_bus_route_variants
            WHERE coalesce(is_active, true)
              AND deleted_at IS NULL
              AND (
                  (${variantCode}::text IS NOT NULL AND variant_code = ${variantCode})
                  OR (${externalVariantRef}::text ~ '^[0-9]+$' AND id = ${externalVariantRef}::bigint)
              )
            ORDER BY id
            LIMIT 1
        `;
        return coreRows[0]?.id ?? null;
    }

    private async resolveStopId(candidate: BusRouteStopCandidateRow): Promise<bigint | null> {
        if (candidate.stop_id) {
            const direct = await this.findActiveStopById(candidate.stop_id);
            if (direct) return direct;
        }

        const refs = asRecord(candidate.source_refs);
        const data = asRecord(candidate.normalized_data);
        const stopLocalStagingId = scalarText(refs.stop_local_staging_id);
        const stopCode = scalarText(refs.stop_code) ?? scalarText(data.stop_code);
        const sameBatchRows = await this.prisma.$queryRaw<{ id: bigint | null }[]>`
            SELECT coalesce(stop_item.target_id, stop_candidate.promoted_core_id, stop_candidate.matched_core_id) AS id
            FROM system.system_publish_items AS stop_item
            INNER JOIN import_review.bus_stop_candidates AS stop_candidate
                ON stop_candidate.id = stop_item.review_candidate_id
               AND stop_item.review_candidate_table = 'import_review.bus_stop_candidates'
            WHERE stop_item.publish_batch_id = ${candidate.publish_batch_id}
              AND stop_item.entity_family = 'bus_stops'
              AND coalesce(stop_item.target_id, stop_candidate.promoted_core_id, stop_candidate.matched_core_id) IS NOT NULL
              AND (
                  (${stopCode}::text IS NOT NULL AND stop_candidate.stop_code = ${stopCode})
                  OR (${stopLocalStagingId}::text ~ '^[0-9]+$' AND stop_candidate.local_staging_id = ${stopLocalStagingId}::bigint)
              )
            LIMIT 1
        `;
        if (sameBatchRows[0]?.id) return sameBatchRows[0].id;

        const externalStopRef = scalarText(refs.stop_external_id) ?? scalarText(refs.bus_stop_external_id) ?? scalarText(data.stop_external_id);
        const coreRows = await this.prisma.$queryRaw<{ id: bigint }[]>`
            SELECT id
            FROM core.core_bus_stops
            WHERE coalesce(is_active, true)
              AND deleted_at IS NULL
              AND (
                  (${externalStopRef}::text IS NOT NULL AND external_id = ${externalStopRef})
                  OR (${stopCode}::text IS NOT NULL AND stop_code = ${stopCode})
              )
            ORDER BY id
            LIMIT 1
        `;
        return coreRows[0]?.id ?? null;
    }

    private async findActiveVariantById(routeVariantId: bigint): Promise<bigint | null> {
        const rows = await this.prisma.$queryRaw<{ id: bigint }[]>`
            SELECT id
            FROM core.core_bus_route_variants
            WHERE id = ${routeVariantId}
              AND coalesce(is_active, true)
              AND deleted_at IS NULL
            LIMIT 1
        `;
        return rows[0]?.id ?? null;
    }

    private async findActiveStopById(stopId: bigint): Promise<bigint | null> {
        const rows = await this.prisma.$queryRaw<{ id: bigint }[]>`
            SELECT id
            FROM core.core_bus_stops
            WHERE id = ${stopId}
              AND coalesce(is_active, true)
              AND deleted_at IS NULL
            LIMIT 1
        `;
        return rows[0]?.id ?? null;
    }

    private async fetchRelationData(key: RouteStopRelationKey): Promise<Record<string, unknown> | null> {
        const rows = await this.prisma.$queryRaw<{ data: unknown }[]>`
            SELECT to_jsonb(rs.*) AS data
            FROM core.core_bus_route_stops AS rs
            WHERE rs.route_variant_id = ${key.route_variant_id}
              AND rs.stop_id = ${key.stop_id}
              AND rs.stop_sequence = ${key.stop_sequence}
            LIMIT 1
        `;
        return rows[0]?.data ? asRecord(rows[0].data) : null;
    }

    private async persistCandidatePromotionMetadata(
        candidateId: bigint,
        key: RouteStopRelationKey,
        sourceRefs: Record<string, unknown>,
        normalizedData: Record<string, unknown>,
        caps: ImportReviewEntityColumnCapabilities
    ): Promise<void> {
        const assignments: Prisma.Sql[] = [];
        if (caps.hasSourceRefs) {
            assignments.push(
                Prisma.sql`source_refs = ${JSON.stringify({
                    ...sourceRefs,
                    promoted_relation_key: relationKeyObject(key),
                })}::jsonb`
            );
        }
        if (caps.hasNormalizedData) {
            assignments.push(Prisma.sql`normalized_data = ${JSON.stringify(normalizedData)}::jsonb`);
        }
        if (caps.hasPromotedCoreId) {
            assignments.push(Prisma.sql`promoted_core_id = NULL`);
        }
        if (caps.hasColumn("updated_at")) {
            assignments.push(Prisma.sql`updated_at = now()`);
        }
        await this.prisma.$executeRaw(Prisma.sql`
            UPDATE import_review.bus_route_stop_candidates
            SET ${Prisma.join(assignments, ", ")}
            WHERE id = ${candidateId}
        `);
    }
}
