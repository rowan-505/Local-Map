import { Prisma, type PrismaClient } from "@prisma/client";

import {
    IMPORT_REVIEW_PUBLISH_VALIDATION_STAGES,
    type ImportReviewPublishBatchProgressRow,
    type ImportReviewPublishStageLogRow,
    type ImportReviewPublishValidationIssueRow,
    type ImportReviewPublishValidationStageKey,
} from "./import-review-promotion-validation.types.js";

const BUILDING_CANDIDATE_TABLE = "import_review.building_candidates";
const MIN_AREA_M2 = 1;
const MAX_AREA_M2 = 500_000;
const SPATIAL_OVERLAP_RATIO = 0.85;
const SPATIAL_DWITHIN_M = 2;

export const IMPORT_REVIEW_VALIDATION_CHUNK_SIZE = Math.max(
    10,
    Number.parseInt(process.env.IMPORT_REVIEW_VALIDATION_CHUNK_SIZE ?? "200", 10) || 200
);

const VALIDATABLE_BATCH_STATUSES = ["draft", "blocked", "failed", "ready"] as const;

function itemsJoinSql(): Prisma.Sql {
    return Prisma.sql`
        FROM system.system_publish_items AS spi
        LEFT JOIN import_review.building_candidates AS b
            ON b.id = spi.review_candidate_id
           AND spi.review_candidate_table = ${BUILDING_CANDIDATE_TABLE}
    `;
}

function activeCoreBuildingSql(alias: string): Prisma.Sql {
    return Prisma.sql`
        coalesce(${Prisma.raw(alias)}.is_active, true)
        AND ${Prisma.raw(alias)}.deleted_at IS NULL
    `;
}

export class ImportReviewPromotionValidationRepository {
    constructor(private readonly prisma: PrismaClient) {}

    async fetchBatchProgress(batchId: bigint): Promise<ImportReviewPublishBatchProgressRow | null> {
        const rows = await this.prisma.$queryRaw<ImportReviewPublishBatchProgressRow[]>`
            SELECT
                id,
                status,
                validation_total,
                validation_done,
                validation_percent::float8 AS validation_percent,
                validated_at,
                summary
            FROM system.system_publish_batches
            WHERE id = ${batchId}
            LIMIT 1
        `;
        return rows[0] ?? null;
    }

    async claimBatchForValidation(batchId: bigint): Promise<{ claimed: boolean; status: string | null }> {
        const rows = await this.prisma.$queryRaw<{ id: bigint; status: string }[]>`
            UPDATE system.system_publish_batches
            SET
                status = 'validating',
                validation_done = 0,
                validation_percent = 0,
                validation_total = 0,
                validated_at = NULL
            WHERE id = ${batchId}
              AND status IN (${Prisma.join(VALIDATABLE_BATCH_STATUSES.map((s) => Prisma.sql`${s}`))})
            RETURNING id, status
        `;
        if (rows.length > 0) {
            return { claimed: true, status: "validating" };
        }

        const current = await this.fetchBatchProgress(batchId);
        return { claimed: false, status: current?.status ?? null };
    }

    async clearStageLogs(batchId: bigint): Promise<void> {
        await this.prisma.$executeRaw`
            DELETE FROM system.system_publish_stage_logs
            WHERE publish_batch_id = ${batchId}
        `;
    }

    async seedStageLogs(batchId: bigint): Promise<void> {
        for (const stage of IMPORT_REVIEW_PUBLISH_VALIDATION_STAGES) {
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

    async updateStageLog(args: {
        batchId: bigint;
        stageKey: ImportReviewPublishValidationStageKey;
        stageStatus: string;
        message?: string | null;
        progressPercent: number;
        details?: Record<string, unknown>;
        finished?: boolean;
    }): Promise<void> {
        const detailsJson = JSON.stringify(args.details ?? {});
        if (args.finished) {
            await this.prisma.$executeRaw`
                UPDATE system.system_publish_stage_logs
                SET
                    stage_status = ${args.stageStatus},
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
                    stage_status = ${args.stageStatus},
                    message = ${args.message ?? null},
                    progress_percent = ${args.progressPercent},
                    details = ${detailsJson}::jsonb,
                    started_at = CASE WHEN stage_status = 'pending' THEN now() ELSE started_at END
                WHERE publish_batch_id = ${args.batchId}
                  AND stage_key = ${args.stageKey}
            `;
        }
    }

    async listStageLogs(batchId: bigint): Promise<ImportReviewPublishStageLogRow[]> {
        return this.prisma.$queryRaw<ImportReviewPublishStageLogRow[]>`
            SELECT
                id,
                publish_batch_id,
                stage_key,
                stage_label,
                stage_status,
                message,
                progress_percent::float8 AS progress_percent,
                details,
                started_at,
                finished_at
            FROM system.system_publish_stage_logs
            WHERE publish_batch_id = ${batchId}
            ORDER BY started_at ASC, id ASC
        `;
    }

    async updateBatchProgress(args: {
        batchId: bigint;
        validationTotal?: number;
        validationDone?: number;
        validationPercent: number;
    }): Promise<void> {
        if (args.validationTotal !== undefined && args.validationDone !== undefined) {
            await this.prisma.$executeRaw`
                UPDATE system.system_publish_batches
                SET
                    validation_total = ${args.validationTotal},
                    validation_done = ${args.validationDone},
                    validation_percent = ${args.validationPercent}
                WHERE id = ${args.batchId}
            `;
        } else if (args.validationDone !== undefined) {
            await this.prisma.$executeRaw`
                UPDATE system.system_publish_batches
                SET
                    validation_done = ${args.validationDone},
                    validation_percent = ${args.validationPercent}
                WHERE id = ${args.batchId}
            `;
        } else {
            await this.prisma.$executeRaw`
                UPDATE system.system_publish_batches
                SET validation_percent = ${args.validationPercent}
                WHERE id = ${args.batchId}
            `;
        }
    }

    async countPublishItems(batchId: bigint): Promise<number> {
        const rows = await this.prisma.$queryRaw<{ count: bigint }[]>`
            SELECT count(*)::bigint AS count
            FROM system.system_publish_items
            WHERE publish_batch_id = ${batchId}
        `;
        return Number(rows[0]?.count ?? 0n);
    }

    async countPendingBuildingItems(batchId: bigint): Promise<number> {
        const rows = await this.prisma.$queryRaw<{ count: bigint }[]>`
            SELECT count(*)::bigint AS count
            FROM system.system_publish_items
            WHERE publish_batch_id = ${batchId}
              AND entity_family = 'buildings'
              AND publish_status = 'pending'
        `;
        return Number(rows[0]?.count ?? 0n);
    }

    async countNonBuildingItems(batchId: bigint): Promise<number> {
        const rows = await this.prisma.$queryRaw<{ count: bigint }[]>`
            SELECT count(*)::bigint AS count
            FROM system.system_publish_items
            WHERE publish_batch_id = ${batchId}
              AND entity_family <> 'buildings'
        `;
        return Number(rows[0]?.count ?? 0n);
    }

    async listPublishItemIds(batchId: bigint): Promise<bigint[]> {
        const rows = await this.prisma.$queryRaw<{ id: bigint }[]>`
            SELECT id
            FROM system.system_publish_items
            WHERE publish_batch_id = ${batchId}
            ORDER BY id ASC
        `;
        return rows.map((r) => r.id);
    }

    async failBatch(batchId: bigint, message: string): Promise<void> {
        const summary = JSON.stringify({ validation_error: message });
        await this.prisma.$executeRaw`
            UPDATE system.system_publish_batches
            SET status = 'failed', summary = coalesce(summary, '{}'::jsonb) || ${summary}::jsonb
            WHERE id = ${batchId}
        `;
    }

    async finalizeBatch(args: {
        batchId: bigint;
        status: "ready" | "blocked";
        validationTotal: number;
        summary: Record<string, unknown>;
    }): Promise<void> {
        const summaryJson = JSON.stringify(args.summary);
        await this.prisma.$executeRaw`
            UPDATE system.system_publish_batches
            SET
                status = ${args.status},
                validation_total = ${args.validationTotal},
                validation_done = ${args.validationTotal},
                validation_percent = 100,
                validated_at = now(),
                summary = coalesce(summary, '{}'::jsonb) || ${summaryJson}::jsonb
            WHERE id = ${args.batchId}
        `;
    }

    async persistItemValidationResults(
        results: {
            publishItemId: bigint;
            status: string;
            issues: unknown[];
            errorMessage: string | null;
        }[]
    ): Promise<void> {
        for (const chunk of chunkArray(results, 100)) {
            for (const row of chunk) {
                const validationJson = JSON.stringify({ status: row.status, issues: row.issues });
                await this.prisma.$executeRaw`
                    UPDATE system.system_publish_items
                    SET
                        validation_result = ${validationJson}::jsonb,
                        error_message = ${row.errorMessage}
                    WHERE id = ${row.publishItemId}
                `;
            }
        }
    }

    async validateCandidateIntegrity(itemIds: bigint[]): Promise<ImportReviewPublishValidationIssueRow[]> {
        if (itemIds.length === 0) {
            return [];
        }
        return this.prisma.$queryRaw<ImportReviewPublishValidationIssueRow[]>`
            SELECT publish_item_id, code, message, severity
            FROM (
                SELECT spi.id AS publish_item_id, 'missing_candidate'::text AS code,
                    'Building candidate row not found for publish item.'::text AS message,
                    'error'::text AS severity
                ${itemsJoinSql()}
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND b.id IS NULL

                UNION ALL

                SELECT spi.id, 'unsupported_entity_family',
                    'Only entity_family=buildings is supported for publish validation.',
                    'error'
                FROM system.system_publish_items AS spi
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND spi.entity_family <> 'buildings'

                UNION ALL

                SELECT spi.id, 'review_not_approved',
                    'Candidate must have review_decision=approved and review_status=approved.',
                    'error'
                ${itemsJoinSql()}
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND b.id IS NOT NULL
                  AND (b.review_decision IS DISTINCT FROM 'approved' OR b.review_status IS DISTINCT FROM 'approved')

                UNION ALL

                SELECT spi.id, 'already_promoted',
                    'Candidate promotion_status must not be promoted.',
                    'error'
                ${itemsJoinSql()}
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND b.promotion_status = 'promoted'

                UNION ALL

                SELECT spi.id, 'invalid_match_action',
                    'match_status must be new_auto or matched_auto_update with insert_candidate or update_candidate.',
                    'error'
                ${itemsJoinSql()}
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND b.id IS NOT NULL
                  AND (
                      b.match_status IS NULL
                      OR b.match_status NOT IN ('new_auto', 'matched_auto_update')
                      OR b.auto_action IS NULL
                      OR b.auto_action NOT IN ('insert_candidate', 'update_candidate')
                  )

                UNION ALL

                SELECT spi.id, 'manual_protected',
                    'manual_protected or protect_manual candidates cannot be published.',
                    'error'
                ${itemsJoinSql()}
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND (
                      coalesce(b.match_status, '') = 'manual_protected'
                      OR coalesce(b.auto_action, '') = 'protect_manual'
                  )

                UNION ALL

                SELECT spi.id, 'unsupported_merge_action',
                    'merge publish_action is not supported in validation v1.',
                    'error'
                FROM system.system_publish_items AS spi
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND spi.publish_action = 'merge'
            ) AS issues
        `;
    }

    async validateGeometry(itemIds: bigint[]): Promise<ImportReviewPublishValidationIssueRow[]> {
        if (itemIds.length === 0) {
            return [];
        }
        return this.prisma.$queryRaw<ImportReviewPublishValidationIssueRow[]>`
            SELECT publish_item_id, code, message, severity
            FROM (
                SELECT spi.id AS publish_item_id, 'missing_geom'::text AS code,
                    'Building geometry (geom) is required.'::text AS message, 'error'::text AS severity
                ${itemsJoinSql()}
                WHERE spi.id IN (${Prisma.join(itemIds)}) AND b.geom IS NULL

                UNION ALL

                SELECT spi.id, 'invalid_geom', 'Geometry must pass ST_IsValid.', 'error'
                ${itemsJoinSql()}
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND b.geom IS NOT NULL AND NOT ST_IsValid(b.geom)

                UNION ALL

                SELECT spi.id, 'empty_geom', 'Geometry must not be empty.', 'error'
                ${itemsJoinSql()}
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND b.geom IS NOT NULL AND ST_IsEmpty(b.geom)

                UNION ALL

                SELECT spi.id, 'invalid_srid', 'Geometry SRID must be 4326.', 'error'
                ${itemsJoinSql()}
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND b.geom IS NOT NULL AND ST_SRID(b.geom) <> 4326

                UNION ALL

                SELECT spi.id, 'invalid_geom_type',
                    'Geometry must be Polygon, MultiPolygon, or polygonal Geometry.',
                    'error'
                ${itemsJoinSql()}
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND b.geom IS NOT NULL
                  AND upper(GeometryType(b.geom)) NOT IN ('POLYGON', 'MULTIPOLYGON', 'GEOMETRYCOLLECTION')

                UNION ALL

                SELECT spi.id, 'area_out_of_range',
                    'Building area must be between 1 m² and 500000 m².',
                    'error'
                ${itemsJoinSql()}
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND b.geom IS NOT NULL
                  AND (
                      coalesce(b.area_m2, ST_Area(b.geom::geography)) < ${MIN_AREA_M2}
                      OR coalesce(b.area_m2, ST_Area(b.geom::geography)) > ${MAX_AREA_M2}
                  )

                UNION ALL

                SELECT spi.id, 'missing_centroid',
                    'Centroid must exist on candidate or be derivable from geometry.',
                    'error'
                ${itemsJoinSql()}
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND b.geom IS NOT NULL
                  AND b.centroid IS NULL
                  AND ST_Centroid(b.geom) IS NULL
            ) AS issues
        `;
    }

    async validateRequiredFields(itemIds: bigint[]): Promise<ImportReviewPublishValidationIssueRow[]> {
        if (itemIds.length === 0) {
            return [];
        }
        const buildingTypeExpr = Prisma.sql`
            nullif(trim(coalesce(
                b.review_overrides->>'building_type',
                b.review_overrides->>'class_code',
                b.class_code,
                b.building_type,
                b.normalized_data->>'building_type',
                b.normalized_data->>'class_code',
                ''
            )), '')
        `;
        const hasLineageExpr = Prisma.sql`
            (
                b.external_id IS NOT NULL AND trim(b.external_id) <> ''
            ) OR (
                jsonb_typeof(b.source_refs) = 'object'
                AND b.source_refs <> '{}'::jsonb
                AND (
                    b.source_refs ? 'osm_id'
                    OR b.source_refs ? 'local_staging_id'
                    OR (SELECT count(*) FROM jsonb_object_keys(b.source_refs)) > 0
                )
            )
        `;

        return this.prisma.$queryRaw<ImportReviewPublishValidationIssueRow[]>`
            SELECT publish_item_id, code, message, severity
            FROM (
                SELECT spi.id AS publish_item_id, 'missing_lineage'::text AS code,
                    'external_id or non-empty source_refs lineage is required.'::text AS message,
                    'error'::text AS severity
                ${itemsJoinSql()}
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND b.id IS NOT NULL
                  AND NOT (${hasLineageExpr})

                UNION ALL

                SELECT spi.id, 'invalid_confidence',
                    'confidence_score must be between 0 and 100 when set.',
                    'error'
                ${itemsJoinSql()}
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND b.confidence_score IS NOT NULL
                  AND (b.confidence_score < 0 OR b.confidence_score > 100)

                UNION ALL

                SELECT spi.id, 'missing_building_type',
                    'class_code or building_type must be available from overrides, columns, or normalized_data.',
                    'error'
                ${itemsJoinSql()}
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND b.id IS NOT NULL
                  AND ${buildingTypeExpr} IS NULL

                UNION ALL

                SELECT spi.id, 'empty_source_refs',
                    'source_refs must not be an empty object.',
                    'error'
                ${itemsJoinSql()}
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND (
                      b.source_refs IS NULL
                      OR jsonb_typeof(b.source_refs) <> 'object'
                      OR b.source_refs = '{}'::jsonb
                  )

                UNION ALL

                SELECT spi.id, 'empty_normalized_data',
                    'normalized_data must not be an empty object.',
                    'error'
                ${itemsJoinSql()}
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND (
                      b.normalized_data IS NULL
                      OR jsonb_typeof(b.normalized_data) <> 'object'
                      OR b.normalized_data = '{}'::jsonb
                  )
            ) AS issues
        `;
    }

    async validateReferences(itemIds: bigint[]): Promise<ImportReviewPublishValidationIssueRow[]> {
        if (itemIds.length === 0) {
            return [];
        }
        return this.prisma.$queryRaw<ImportReviewPublishValidationIssueRow[]>`
            SELECT publish_item_id, code, message, severity
            FROM (
                SELECT spi.id AS publish_item_id, 'invalid_building_type_id'::text AS code,
                    'building_type_id does not exist in ref.ref_building_types.'::text AS message,
                    'error'::text AS severity
                ${itemsJoinSql()}
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND b.building_type_id IS NOT NULL
                  AND NOT EXISTS (
                      SELECT 1 FROM ref.ref_building_types AS rbt WHERE rbt.id = b.building_type_id
                  )

                UNION ALL

                SELECT spi.id, 'invalid_admin_area_id',
                    'admin_area_id does not exist in core.core_admin_areas.',
                    'error'
                ${itemsJoinSql()}
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND b.admin_area_id IS NOT NULL
                  AND NOT EXISTS (
                      SELECT 1 FROM core.core_admin_areas AS ca WHERE ca.id = b.admin_area_id
                  )

                UNION ALL

                SELECT spi.id, 'missing_admin_area',
                    'admin_area_id is not set; confirm admin assignment before promotion.',
                    'warning'
                ${itemsJoinSql()}
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND b.admin_area_id IS NULL
            ) AS issues
        `;
    }

    async validateDuplicates(itemIds: bigint[]): Promise<ImportReviewPublishValidationIssueRow[]> {
        if (itemIds.length === 0) {
            return [];
        }
        return this.prisma.$queryRaw<ImportReviewPublishValidationIssueRow[]>`
            SELECT publish_item_id, code, message, severity
            FROM (
                SELECT spi.id AS publish_item_id, 'duplicate_external_id'::text AS code,
                    'Active core building already exists with the same external_id.'::text AS message,
                    'error'::text AS severity
                ${itemsJoinSql()}
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND spi.publish_action = 'insert'
                  AND b.external_id IS NOT NULL
                  AND trim(b.external_id) <> ''
                  AND EXISTS (
                      SELECT 1 FROM core.core_map_buildings AS c
                      WHERE c.external_id = b.external_id
                        AND ${activeCoreBuildingSql("c")}
                  )

                UNION ALL

                SELECT spi.id, 'duplicate_source_staging_id',
                    'Active core building already exists with the same source_staging_id.',
                    'error'
                ${itemsJoinSql()}
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND spi.publish_action = 'insert'
                  AND b.local_staging_id IS NOT NULL
                  AND EXISTS (
                      SELECT 1 FROM core.core_map_buildings AS c
                      WHERE c.source_staging_id = b.local_staging_id
                        AND ${activeCoreBuildingSql("c")}
                  )

                UNION ALL

                SELECT spi.id, 'spatial_overlap_insert',
                    'High geometry overlap with an existing active core building.',
                    'error'
                ${itemsJoinSql()}
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND spi.publish_action = 'insert'
                  AND b.geom IS NOT NULL
                  AND EXISTS (
                      SELECT 1 FROM core.core_map_buildings AS c
                      WHERE ${activeCoreBuildingSql("c")}
                        AND c.geom IS NOT NULL
                        AND c.geom && b.geom
                        AND ST_DWithin(c.geom::geography, b.geom::geography, ${SPATIAL_DWITHIN_M})
                        AND (
                            ST_Area(ST_Intersection(c.geom, b.geom)::geography)
                            / NULLIF(ST_Area(b.geom::geography), 0)
                        ) > ${SPATIAL_OVERLAP_RATIO}
                  )

                UNION ALL

                SELECT spi.id, 'spatial_overlap_update_other',
                    'Update candidate overlaps another active core building.',
                    'warning'
                ${itemsJoinSql()}
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND spi.publish_action = 'update'
                  AND b.geom IS NOT NULL
                  AND EXISTS (
                      SELECT 1 FROM core.core_map_buildings AS c
                      WHERE ${activeCoreBuildingSql("c")}
                        AND c.geom IS NOT NULL
                        AND c.geom && b.geom
                        AND (b.matched_core_id IS NULL OR c.id <> b.matched_core_id)
                        AND ST_DWithin(c.geom::geography, b.geom::geography, ${SPATIAL_DWITHIN_M})
                        AND (
                            ST_Area(ST_Intersection(c.geom, b.geom)::geography)
                            / NULLIF(ST_Area(b.geom::geography), 0)
                        ) > ${SPATIAL_OVERLAP_RATIO}
                  )
            ) AS issues
        `;
    }

    async validateActions(itemIds: bigint[]): Promise<ImportReviewPublishValidationIssueRow[]> {
        if (itemIds.length === 0) {
            return [];
        }
        const hasMatchedCoreExpr = Prisma.sql`
            b.matched_core_id IS NOT NULL
            OR (
                b.matched_core_data IS NOT NULL
                AND jsonb_typeof(b.matched_core_data) = 'object'
                AND b.matched_core_data <> '{}'::jsonb
            )
        `;

        return this.prisma.$queryRaw<ImportReviewPublishValidationIssueRow[]>`
            SELECT publish_item_id, code, message, severity
            FROM (
                SELECT spi.id AS publish_item_id, 'unsupported_publish_action'::text AS code,
                    'publish_action skip or protect_manual is not allowed in publish batches.'::text AS message,
                    'error'::text AS severity
                FROM system.system_publish_items AS spi
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND spi.publish_action IN ('skip', 'protect_manual')

                UNION ALL

                SELECT spi.id, 'unsupported_merge_action',
                    'merge publish_action is not supported in validation v1.',
                    'error'
                FROM system.system_publish_items AS spi
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND spi.publish_action = 'merge'

                UNION ALL

                SELECT spi.id, 'insert_core_exists_external_id',
                    'insert action must not target an existing active core row by external_id.',
                    'error'
                ${itemsJoinSql()}
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND spi.publish_action = 'insert'
                  AND b.external_id IS NOT NULL
                  AND trim(b.external_id) <> ''
                  AND EXISTS (
                      SELECT 1 FROM core.core_map_buildings AS c
                      WHERE c.external_id = b.external_id AND ${activeCoreBuildingSql("c")}
                  )

                UNION ALL

                SELECT spi.id, 'insert_core_exists_staging_id',
                    'insert action must not target an existing active core row by source_staging_id.',
                    'error'
                ${itemsJoinSql()}
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND spi.publish_action = 'insert'
                  AND b.local_staging_id IS NOT NULL
                  AND EXISTS (
                      SELECT 1 FROM core.core_map_buildings AS c
                      WHERE c.source_staging_id = b.local_staging_id AND ${activeCoreBuildingSql("c")}
                  )

                UNION ALL

                SELECT spi.id, 'update_missing_target',
                    'update action requires matched_core_id or matched_core_data target info.',
                    'error'
                ${itemsJoinSql()}
                WHERE spi.id IN (${Prisma.join(itemIds)})
                  AND spi.publish_action = 'update'
                  AND NOT (${hasMatchedCoreExpr})
            ) AS issues
        `;
    }

    async fetchItemActionCounts(batchId: bigint): Promise<{
        insert: number;
        update: number;
        merge: number;
        buildings: number;
    }> {
        const rows = await this.prisma.$queryRaw<
            { insert: bigint; update: bigint; merge: bigint; buildings: bigint }[]
        >`
            SELECT
                count(*) FILTER (WHERE publish_action = 'insert')::bigint AS insert,
                count(*) FILTER (WHERE publish_action = 'update')::bigint AS update,
                count(*) FILTER (WHERE publish_action = 'merge')::bigint AS merge,
                count(*) FILTER (WHERE entity_family = 'buildings')::bigint AS buildings
            FROM system.system_publish_items
            WHERE publish_batch_id = ${batchId}
        `;
        const r = rows[0];
        return {
            insert: Number(r?.insert ?? 0n),
            update: Number(r?.update ?? 0n),
            merge: Number(r?.merge ?? 0n),
            buildings: Number(r?.buildings ?? 0n),
        };
    }
}

function chunkArray<T>(arr: T[], size: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += size) {
        out.push(arr.slice(i, i + size));
    }
    return out;
}
