import { Prisma, type PrismaClient } from "@prisma/client";

import type { ImportReviewPromotionRoadDryRunResult } from "./import-review-promotion-road-dry-run.types.js";
import type { ImportReviewRoadRoutingValidationRow } from "./import-review-road-routing-validation.js";

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
    review_status: string;
    review_decision: string | null;
    promotion_status: string;
    auto_action: string | null;
    confidence_score: number | null;
    source_refs: unknown;
    validation_errors: unknown;
    validation_warnings: unknown;
    review_overrides: unknown;
    matched_core_id: bigint | null;
    road_class_id: bigint | null;
    geom: unknown;
    srid: number | null;
    geom_type: string | null;
    is_valid: boolean | null;
    length_m: number | null;
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
                r.review_status,
                r.review_decision,
                r.promotion_status,
                r.auto_action,
                r.confidence_score::float8 AS confidence_score,
                r.source_refs,
                r.validation_errors,
                r.validation_warnings,
                r.review_overrides,
                r.matched_core_id,
                r.road_class_id,
                r.geom,
                CASE WHEN r.geom IS NOT NULL THEN ST_SRID(r.geom) ELSE NULL END AS srid,
                CASE WHEN r.geom IS NOT NULL THEN GeometryType(r.geom) ELSE NULL END AS geom_type,
                CASE WHEN r.geom IS NOT NULL THEN ST_IsValid(r.geom) ELSE NULL END AS is_valid,
                CASE WHEN r.geom IS NOT NULL THEN ST_Length(r.geom::geography)::float8 ELSE NULL END AS length_m
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
                COALESCE(to_jsonb(r.review_overrides), '{}'::jsonb) AS review_overrides,
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
