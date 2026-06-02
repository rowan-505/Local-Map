import { Prisma, type PrismaClient } from "@prisma/client";

import { requireValidPublishStageStatus } from "./import-review-promotion-stage-status.js";
import {
    IMPORT_REVIEW_ROUTING_BARRIER_DRY_RUN_STAGES,
    type ImportReviewRoutingBarrierDryRunStageKey,
} from "./import-review-promotion-routing-barrier-dry-run.stages.js";
import type { ImportReviewPromotionRoutingBarrierDryRunResult } from "./import-review-promotion-routing-barrier-dry-run.types.js";
import {
    ImportReviewSchemaCapabilityRegistry,
    type ImportReviewEntityColumnCapabilities,
} from "./import-review-schema-capabilities.js";

export const ROUTING_BARRIER_CANDIDATE_TABLE = "import_review.routing_barrier_candidates";
export const ROUTING_BARRIER_TARGET_TABLE = "routing.routing_barriers";

export type RoutingBarrierPublishItemRow = {
    publish_item_id: bigint;
    publish_action: string;
    review_candidate_id: bigint | null;
    review_batch_id: bigint | null;
};

export type RoutingBarrierCandidateDryRunRow = {
    id: bigint;
    review_batch_id: bigint;
    external_id: string | null;
    canonical_name: string | null;
    class_code: string | null;
    barrier_type: string | null;
    review_status: string;
    review_decision: string | null;
    promotion_status: string;
    auto_action: string | null;
    confidence_score: number | null;
    source_refs: unknown;
    normalized_data: unknown;
    validation_errors: unknown;
    matched_core_id: bigint | null;
    promoted_core_id: bigint | null;
    point_geom: unknown;
    srid: number | null;
    geom_type: string | null;
    is_valid: boolean | null;
    nearest_core_street_id: bigint | null;
    nearest_core_road_distance_m: number | null;
    nearby_core_roads: number;
    nearby_review_roads: number;
    duplicate_nearby_barriers: number;
};

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
    return caps.hasColumn(jsonColumn)
        ? Prisma.sql`${col(alias, jsonColumn)}->>${key}`
        : Prisma.sql`NULL::text`;
}

function pointGeomExpr(alias: string, caps: ImportReviewEntityColumnCapabilities): Prisma.Sql {
    return optionalColumnExpr(alias, caps, "point_geom", "geometry(Point,4326)");
}

function barrierTypeExpr(alias: string, caps: ImportReviewEntityColumnCapabilities): Prisma.Sql {
    return Prisma.sql`
        nullif(trim(coalesce(
            ${optionalColumnExpr(alias, caps, "barrier_type", "text")},
            ${optionalJsonTextExpr(alias, caps, "normalized_data", "barrier_type")},
            ${optionalJsonTextExpr(alias, caps, "normalized_data", "barrier")},
            ${optionalColumnExpr(alias, caps, "class_code", "text")},
            ''
        )), '')
    `;
}

export class ImportReviewPromotionRoutingBarrierDryRunRepository {
    private readonly schemaRegistry: ImportReviewSchemaCapabilityRegistry;

    constructor(private readonly prisma: PrismaClient) {
        this.schemaRegistry = new ImportReviewSchemaCapabilityRegistry(prisma);
    }

    async fetchBatchMeta(batchId: bigint): Promise<{ source_review_batch_id: bigint | null } | null> {
        const rows = await this.prisma.$queryRaw<{ source_review_batch_id: bigint | null }[]>`
            SELECT source_review_batch_id
            FROM system.system_publish_batches
            WHERE id = ${batchId}
            LIMIT 1
        `;
        return rows[0] ?? null;
    }

    async countRoutingBarrierItemsInBatch(batchId: bigint): Promise<number> {
        const rows = await this.prisma.$queryRaw<{ count: bigint }[]>`
            SELECT count(*)::bigint AS count
            FROM system.system_publish_items
            WHERE publish_batch_id = ${batchId}
              AND entity_family = 'routing_barriers'
        `;
        return Number(rows[0]?.count ?? 0n);
    }

    async listRoutingBarrierPublishItems(batchId: bigint): Promise<RoutingBarrierPublishItemRow[]> {
        return this.prisma.$queryRaw<RoutingBarrierPublishItemRow[]>`
            SELECT
                spi.id AS publish_item_id,
                spi.publish_action,
                spi.review_candidate_id,
                pb.source_review_batch_id AS review_batch_id
            FROM system.system_publish_items AS spi
            INNER JOIN system.system_publish_batches AS pb ON pb.id = spi.publish_batch_id
            WHERE spi.publish_batch_id = ${batchId}
              AND spi.entity_family = 'routing_barriers'
            ORDER BY spi.id ASC
        `;
    }

    async fetchCandidateForDryRun(args: {
        candidateId: bigint;
        reviewBatchId: bigint;
        nearbyCoreRoadThresholdM: number;
        nearbyReviewRoadThresholdM: number;
        duplicateThresholdM: number;
    }): Promise<RoutingBarrierCandidateDryRunRow | null> {
        const caps = await this.schemaRegistry.getEntityColumnCapabilities("routing_barriers");
        const g = pointGeomExpr("rb", caps);
        const barrierType = barrierTypeExpr("rb", caps);
        const targetCaps = await this.schemaRegistry.getTargetColumnCapabilities(ROUTING_BARRIER_TARGET_TABLE);
        const targetExists = targetCaps.hasColumn("id");
        const duplicateSql = targetExists
            ? Prisma.sql`
                (
                    SELECT count(*)::int
                    FROM routing.routing_barriers AS existing
                    WHERE existing.geom IS NOT NULL
                      AND coalesce(existing.is_active, true)
                      AND existing.geom && ST_Expand(${g}, ${args.duplicateThresholdM / 111320.0})
                      AND ST_DWithin(existing.geom::geography, ${g}::geography, ${args.duplicateThresholdM})
                )
              `
            : Prisma.sql`0`;

        const rows = await this.prisma.$queryRaw<RoutingBarrierCandidateDryRunRow[]>(Prisma.sql`
            SELECT
                rb.id,
                rb.review_batch_id,
                ${optionalColumnExpr("rb", caps, "external_id", "text")} AS external_id,
                ${optionalColumnExpr("rb", caps, "canonical_name", "text")} AS canonical_name,
                ${optionalColumnExpr("rb", caps, "class_code", "text")} AS class_code,
                ${barrierType} AS barrier_type,
                ${optionalColumnExpr("rb", caps, "review_status", "text")} AS review_status,
                ${optionalColumnExpr("rb", caps, "review_decision", "text")} AS review_decision,
                ${optionalColumnExpr("rb", caps, "promotion_status", "text")} AS promotion_status,
                ${optionalColumnExpr("rb", caps, "auto_action", "text")} AS auto_action,
                ${optionalColumnExpr("rb", caps, "confidence_score", "numeric")}::float8 AS confidence_score,
                ${optionalColumnExpr("rb", caps, "source_refs", "jsonb")} AS source_refs,
                ${optionalColumnExpr("rb", caps, "normalized_data", "jsonb")} AS normalized_data,
                ${optionalColumnExpr("rb", caps, "validation_errors", "jsonb")} AS validation_errors,
                ${optionalColumnExpr("rb", caps, "matched_core_id", "bigint")} AS matched_core_id,
                ${optionalColumnExpr("rb", caps, "promoted_core_id", "bigint")} AS promoted_core_id,
                ${g} AS point_geom,
                CASE WHEN ${g} IS NOT NULL THEN ST_SRID(${g}) ELSE NULL END AS srid,
                CASE WHEN ${g} IS NOT NULL THEN ST_GeometryType(${g}) ELSE NULL END AS geom_type,
                CASE WHEN ${g} IS NOT NULL THEN ST_IsValid(${g}) ELSE NULL END AS is_valid,
                nearest.core_street_id AS nearest_core_street_id,
                nearest.distance_m::float8 AS nearest_core_road_distance_m,
                coalesce(core_counts.nearby_core_roads, 0)::int AS nearby_core_roads,
                coalesce(review_counts.nearby_review_roads, 0)::int AS nearby_review_roads,
                ${duplicateSql} AS duplicate_nearby_barriers
            FROM import_review.routing_barrier_candidates AS rb
            LEFT JOIN LATERAL (
                SELECT s.id AS core_street_id, ST_Distance(s.geom::geography, ${g}::geography) AS distance_m
                FROM core.core_streets AS s
                WHERE ${g} IS NOT NULL
                  AND s.geom IS NOT NULL
                  AND coalesce(s.is_active, true)
                  AND s.deleted_at IS NULL
                  AND s.geom && ST_Expand(${g}, ${args.nearbyCoreRoadThresholdM / 111320.0})
                ORDER BY s.geom <-> ${g}
                LIMIT 1
            ) nearest ON true
            LEFT JOIN LATERAL (
                SELECT count(*)::int AS nearby_core_roads
                FROM core.core_streets AS s
                WHERE ${g} IS NOT NULL
                  AND s.geom IS NOT NULL
                  AND coalesce(s.is_active, true)
                  AND s.deleted_at IS NULL
                  AND s.geom && ST_Expand(${g}, ${args.nearbyCoreRoadThresholdM / 111320.0})
                  AND ST_DWithin(s.geom::geography, ${g}::geography, ${args.nearbyCoreRoadThresholdM})
            ) core_counts ON true
            LEFT JOIN LATERAL (
                SELECT count(*)::int AS nearby_review_roads
                FROM import_review.road_candidates AS r
                WHERE ${g} IS NOT NULL
                  AND r.review_batch_id = rb.review_batch_id
                  AND r.geom IS NOT NULL
                  AND r.geom && ST_Expand(${g}, ${args.nearbyReviewRoadThresholdM / 111320.0})
                  AND ST_DWithin(r.geom::geography, ${g}::geography, ${args.nearbyReviewRoadThresholdM})
            ) review_counts ON true
            WHERE rb.id = ${args.candidateId}
              AND rb.review_batch_id = ${args.reviewBatchId}
              AND rb.entity_family = 'routing_barriers'
            LIMIT 1
        `);
        return rows[0] ?? null;
    }

    async targetTableExists(): Promise<boolean> {
        const caps = await this.schemaRegistry.getTargetColumnCapabilities(ROUTING_BARRIER_TARGET_TABLE);
        return caps.hasColumn("id");
    }

    async seedStageLogs(batchId: bigint): Promise<void> {
        for (const stage of IMPORT_REVIEW_ROUTING_BARRIER_DRY_RUN_STAGES) {
            await this.prisma.$executeRaw`
                INSERT INTO system.system_publish_stage_logs (
                    publish_batch_id, stage_key, stage_label, stage_status,
                    message, progress_percent, details, started_at
                )
                VALUES (${batchId}, ${stage.key}, ${stage.label}, 'pending', NULL, 0, '{}'::jsonb, now())
            `;
        }
    }

    async updateStageLog(args: {
        batchId: bigint;
        stageKey: ImportReviewRoutingBarrierDryRunStageKey;
        stageStatus: string;
        message?: string | null;
        progressPercent: number;
        details?: Record<string, unknown>;
        finished?: boolean;
    }): Promise<void> {
        const stageStatus = requireValidPublishStageStatus(args.stageStatus);
        const detailsJson = JSON.stringify(args.details ?? {});
        if (args.finished) {
            await this.prisma.$executeRaw`
                UPDATE system.system_publish_stage_logs
                SET stage_status = ${stageStatus},
                    message = ${args.message ?? null},
                    progress_percent = ${args.progressPercent},
                    details = ${detailsJson}::jsonb,
                    finished_at = now()
                WHERE publish_batch_id = ${args.batchId}
                  AND stage_key = ${args.stageKey}
            `;
        } else {
            await this.prisma.$executeRaw`
                UPDATE system.system_publish_stage_logs
                SET stage_status = ${stageStatus},
                    message = ${args.message ?? null},
                    progress_percent = ${args.progressPercent},
                    details = ${detailsJson}::jsonb,
                    started_at = CASE WHEN stage_status = 'pending' THEN now() ELSE started_at END
                WHERE publish_batch_id = ${args.batchId}
                  AND stage_key = ${args.stageKey}
            `;
        }
    }

    async persistDryRunResult(
        batchId: bigint,
        result: ImportReviewPromotionRoutingBarrierDryRunResult
    ): Promise<void> {
        const patch = JSON.stringify({ routing_barrier_dry_run_result: result });
        await this.prisma.$executeRaw`
            UPDATE system.system_publish_batches
            SET summary = coalesce(summary, '{}'::jsonb) || ${patch}::jsonb
            WHERE id = ${batchId}
        `;
        await this.syncValidationReadiness(batchId, result);
    }

    private async syncValidationReadiness(
        batchId: bigint,
        result: ImportReviewPromotionRoutingBarrierDryRunResult
    ): Promise<void> {
        const promotable = result.safe_to_promote_count + result.promote_with_warning_count;
        const canPromote = result.blocked_count === 0 && result.needs_manual_review_count === 0 && promotable > 0;
        const validationMerge = JSON.stringify({
            can_promote: canPromote,
            requires_warning_confirmation: result.promote_with_warning_count > 0,
            promotable_entity_families: canPromote ? ["routing_barriers"] : [],
            routing_barrier_dry_run_ready: canPromote,
        });
        await this.prisma.$executeRaw`
            UPDATE system.system_publish_batches
            SET summary = jsonb_set(
                coalesce(summary, '{}'::jsonb),
                '{validation_result}',
                coalesce(summary->'validation_result', '{}'::jsonb) || ${validationMerge}::jsonb,
                true
            )
            WHERE id = ${batchId}
        `;
    }

    async readDryRunResult(batchId: bigint): Promise<ImportReviewPromotionRoutingBarrierDryRunResult | null> {
        const rows = await this.prisma.$queryRaw<{ result: unknown }[]>`
            SELECT summary->'routing_barrier_dry_run_result' AS result
            FROM system.system_publish_batches
            WHERE id = ${batchId}
            LIMIT 1
        `;
        const raw = rows[0]?.result;
        return raw && typeof raw === "object" && !Array.isArray(raw)
            ? (raw as ImportReviewPromotionRoutingBarrierDryRunResult)
            : null;
    }
}
