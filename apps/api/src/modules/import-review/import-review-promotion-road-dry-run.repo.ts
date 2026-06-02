import { Prisma, type PrismaClient } from "@prisma/client";

import type { ImportReviewPromotionRoadDryRunResult } from "./import-review-promotion-road-dry-run.types.js";
import {
    IMPORT_REVIEW_ROAD_DRY_RUN_STAGES,
    type ImportReviewRoadDryRunStageKey,
} from "./import-review-promotion-road-dry-run.stages.js";
import type { ImportReviewRoadRoutingValidationRow } from "./import-review-road-routing-validation.js";
import { requireValidPublishStageStatus } from "./import-review-promotion-stage-status.js";
import { geomSourceExpr, effectiveRoadLengthMExpr } from "./import-review-promotion-promote-sql.js";

export type RoadPublishItemRow = {
    publish_item_id: bigint;
    publish_action: string;
    review_candidate_id: bigint | null;
    review_batch_id: bigint | null;
};

export type RoadCandidatePromotionRow = {
    id: bigint;
    review_batch_id: bigint;
    external_id: string | null;
    canonical_name: string | null;
    class_code: string | null;
    road_class: string | null;
    review_status: string;
    review_decision: string | null;
    promotion_status: string;
    auto_action: string | null;
    confidence_score: number | null;
    source_refs: unknown;
    validation_errors: unknown;
    validation_warnings: unknown;
    matched_core_id: bigint | null;
    road_class_id: bigint | null;
    geom: unknown;
    srid: number | null;
    geom_type: string | null;
    is_valid: boolean | null;
    length_m: number | null;
    part_count: number | null;
};

const ROAD_CANDIDATE_TABLE = "import_review.road_candidates";

export class ImportReviewPromotionRoadDryRunRepository {
    constructor(private readonly prisma: PrismaClient) {}

    async countRoadItemsInBatch(batchId: bigint): Promise<number> {
        const rows = await this.prisma.$queryRaw<{ count: bigint }[]>`
            SELECT count(*)::bigint AS count
            FROM system.system_publish_items
            WHERE publish_batch_id = ${batchId}
              AND entity_family = 'roads'
        `;
        return Number(rows[0]?.count ?? 0n);
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

    async listRoadPublishItems(batchId: bigint): Promise<RoadPublishItemRow[]> {
        return this.prisma.$queryRaw<RoadPublishItemRow[]>`
            SELECT
                spi.id AS publish_item_id,
                spi.publish_action,
                spi.review_candidate_id,
                pb.source_review_batch_id AS review_batch_id
            FROM system.system_publish_items AS spi
            INNER JOIN system.system_publish_batches AS pb ON pb.id = spi.publish_batch_id
            WHERE spi.publish_batch_id = ${batchId}
              AND spi.entity_family = 'roads'
            ORDER BY spi.id ASC
        `;
    }

    async fetchRoadCandidateForDryRun(
        candidateId: bigint,
        reviewBatchId: bigint
    ): Promise<RoadCandidatePromotionRow | null> {
        const rows = await this.prisma.$queryRaw<RoadCandidatePromotionRow[]>`
            SELECT
                r.id,
                r.review_batch_id,
                r.external_id,
                r.canonical_name,
                r.class_code,
                r.road_class,
                r.review_status,
                r.review_decision,
                r.promotion_status,
                r.auto_action,
                r.confidence_score::float8 AS confidence_score,
                r.source_refs,
                r.validation_errors,
                r.validation_warnings,
                r.matched_core_id,
                r.road_class_id,
                r.geom,
                CASE WHEN ${geomSourceExpr("r")} IS NOT NULL THEN ST_SRID(${geomSourceExpr("r")}) ELSE NULL END AS srid,
                CASE WHEN ${geomSourceExpr("r")} IS NOT NULL THEN GeometryType(${geomSourceExpr("r")}) ELSE NULL END AS geom_type,
                CASE WHEN ${geomSourceExpr("r")} IS NOT NULL THEN ST_IsValid(${geomSourceExpr("r")}) ELSE NULL END AS is_valid,
                ${effectiveRoadLengthMExpr("r")}::float8 AS length_m,
                CASE
                    WHEN ${geomSourceExpr("r")} IS NULL THEN NULL
                    WHEN GeometryType(${geomSourceExpr("r")}) = 'ST_MultiLineString'
                        THEN ST_NumGeometries(${geomSourceExpr("r")})
                    WHEN GeometryType(${geomSourceExpr("r")}) = 'ST_LineString' THEN 1
                    ELSE NULL
                END AS part_count
            FROM import_review.road_candidates AS r
            WHERE r.id = ${candidateId}
              AND r.review_batch_id = ${reviewBatchId}
              AND r.entity_family = 'roads'
            LIMIT 1
        `;
        return rows[0] ?? null;
    }

    async fetchRoadCandidateRoutingValidationRow(
        candidateId: bigint,
        reviewBatchId: bigint
    ): Promise<ImportReviewRoadRoutingValidationRow | null> {
        const rows = await this.prisma.$queryRaw<ImportReviewRoadRoutingValidationRow[]>`
            SELECT
                r.id,
                r.review_batch_id,
                r.external_id,
                r.canonical_name,
                r.road_class_id,
                r.road_class,
                r.class_code,
                r.surface,
                r.is_oneway,
                CASE WHEN r.geom IS NOT NULL THEN ST_AsGeoJSON(r.geom)::json ELSE NULL::json END AS geom_geojson,
                r.name_mm,
                r.name_en,
                r.surface,
                r.is_oneway,
                r.access,
                r.speed_kph,
                r.bridge,
                r.tunnel,
                r.layer,
                r.admin_area_id,
                r.normalized_data,
                r.matched_core_table,
                r.matched_core_id,
                r.review_note,
                r.review_status,
                r.review_decision,
                NULL::json AS boundary_geom
            FROM import_review.road_candidates AS r
            WHERE r.id = ${candidateId}
              AND r.review_batch_id = ${reviewBatchId}
              AND r.entity_family = 'roads'
            LIMIT 1
        `;
        return rows[0] ?? null;
    }

    async roadClassIdExists(roadClassId: bigint): Promise<boolean> {
        const rows = await this.prisma.$queryRaw<{ exists: boolean }[]>`
            SELECT EXISTS (
                SELECT 1 FROM ref.ref_road_classes WHERE id = ${roadClassId}
            ) AS exists
        `;
        return rows[0]?.exists === true;
    }

    async countRoadClassesByCode(code: string): Promise<number> {
        const lc = code.trim().toLowerCase();
        const rows = await this.prisma.$queryRaw<{ count: bigint }[]>`
            SELECT count(*)::bigint AS count
            FROM ref.ref_road_classes
            WHERE lower(code) = ${lc}
        `;
        return Number(rows[0]?.count ?? 0n);
    }

    async duplicateExternalIdInCore(externalId: string): Promise<boolean> {
        const rows = await this.prisma.$queryRaw<{ exists: boolean }[]>`
            SELECT EXISTS (
                SELECT 1
                FROM core.core_streets AS s
                WHERE s.external_id = ${externalId}
                  AND s.deleted_at IS NULL
                  AND s.is_active IS TRUE
            ) AS exists
        `;
        return rows[0]?.exists === true;
    }

    async countLikelyNameClassDuplicates(args: {
        reviewBatchId: bigint;
        candidateId: bigint;
        canonicalName: string;
        roadClassCode: string | null;
        duplicateThresholdM: number;
        geomGeojson: Record<string, unknown>;
    }): Promise<number> {
        const gj = JSON.stringify(args.geomGeojson);
        const nameNorm = args.canonicalName.trim().toLowerCase();
        const classNorm = (args.roadClassCode ?? "").trim().toLowerCase();
        const dupM = args.duplicateThresholdM;

        const rows = await this.prisma.$queryRaw<[{ c: number }]>`
            WITH cand AS (
                SELECT ST_SetSRID(ST_GeomFromGeoJSON(${gj}::json), 4326)::geometry AS geom
            )
            SELECT count(*)::int AS c
            FROM import_review.road_candidates AS r, cand
            WHERE r.review_batch_id = ${args.reviewBatchId}
              AND r.entity_family = 'roads'
              AND r.id <> ${args.candidateId}
              AND r.geom IS NOT NULL
              AND lower(trim(coalesce(r.canonical_name, ''))) = ${nameNorm}
              AND (
                  ${classNorm} = ''
                  OR lower(trim(coalesce(r.class_code, r.road_class, ''))) = ${classNorm}
              )
              AND r.geom && ST_Expand(cand.geom, ${dupM / 111320.0})
              AND ST_DWithin(r.geom::geography, cand.geom::geography, ${dupM}::double precision)
            LIMIT 20
        `;
        return rows[0]?.c ?? 0;
    }

    async seedRoadDryRunStageLogs(batchId: bigint): Promise<void> {
        for (const stage of IMPORT_REVIEW_ROAD_DRY_RUN_STAGES) {
            await this.prisma.$executeRaw`
                INSERT INTO system.system_publish_stage_logs (
                    publish_batch_id,
                    stage_key,
                    stage_label,
                    stage_status,
                    message,
                    progress_percent,
                    details,
                    started_at
                )
                VALUES (
                    ${batchId},
                    ${stage.key},
                    ${stage.label},
                    'pending',
                    NULL,
                    0,
                    '{}'::jsonb,
                    now()
                )
            `;
        }
    }

    async updateRoadDryRunStageLog(args: {
        batchId: bigint;
        stageKey: ImportReviewRoadDryRunStageKey;
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
                SET
                    stage_status = ${stageStatus},
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
                SET
                    stage_status = ${stageStatus},
                    message = ${args.message ?? null},
                    progress_percent = ${args.progressPercent},
                    details = ${detailsJson}::jsonb,
                    started_at = CASE WHEN stage_status = 'pending' THEN now() ELSE started_at END
                WHERE publish_batch_id = ${args.batchId}
                  AND stage_key = ${args.stageKey}
            `;
        }
    }

    async persistRoadDryRunResult(
        batchId: bigint,
        result: ImportReviewPromotionRoadDryRunResult
    ): Promise<void> {
        const patch = JSON.stringify({ road_dry_run_result: result });
        await this.prisma.$executeRaw`
            UPDATE system.system_publish_batches
            SET summary = coalesce(summary, '{}'::jsonb) || ${patch}::jsonb
            WHERE id = ${batchId}
        `;
        await this.syncValidationReadinessForRoadDryRun(batchId, result);
    }

    private async syncValidationReadinessForRoadDryRun(
        batchId: bigint,
        result: ImportReviewPromotionRoadDryRunResult
    ): Promise<void> {
        const promotableCount = result.safe_to_promote_count + result.promote_with_warning_count;
        const canPromoteRoads =
            result.blocked_count === 0 &&
            result.needs_manual_review_count === 0 &&
            promotableCount > 0;
        const validationMerge = JSON.stringify({
            can_promote: canPromoteRoads,
            requires_warning_confirmation: result.promote_with_warning_count > 0,
            promotable_entity_families: canPromoteRoads ? ["roads"] : [],
            road_dry_run_ready: canPromoteRoads,
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

    async readRoadDryRunResult(batchId: bigint): Promise<ImportReviewPromotionRoadDryRunResult | null> {
        const rows = await this.prisma.$queryRaw<{ result: unknown }[]>`
            SELECT summary->'road_dry_run_result' AS result
            FROM system.system_publish_batches
            WHERE id = ${batchId}
            LIMIT 1
        `;
        const raw = rows[0]?.result;
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
            return null;
        }
        return raw as ImportReviewPromotionRoadDryRunResult;
    }
}

export { ROAD_CANDIDATE_TABLE };
