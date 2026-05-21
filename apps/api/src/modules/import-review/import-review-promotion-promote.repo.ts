import { Prisma, type PrismaClient } from "@prisma/client";

import type { ImportReviewPublishBatchProgressRow } from "./import-review-promotion-validation.types.js";
import {
    IMPORT_REVIEW_PUBLISH_PROMOTION_STAGES,
    type ImportReviewPublishPromotionStageKey,
    type ImportReviewPublishBatchVerifyResponse,
    type PromoteItemResult,
} from "./import-review-promotion-promote.types.js";
import { ImportReviewPromotionValidationRepository } from "./import-review-promotion-validation.repo.js";
import { ImportReviewPromotionValidationRules } from "./import-review-promotion-validation-rules.js";
import {
    PROMOTABLE_PUBLISH_FAMILIES,
    IMPORT_REVIEW_PUBLISH_FAMILY_CONFIG,
    type PromotablePublishEntityFamily,
} from "./import-review-promotion-config.js";
import { requireValidPublishStageStatus } from "./import-review-promotion-stage-status.js";
import {
    CORE_PLACES_TABLE,
    ImportReviewPromotionPromotePlacesRepository,
    PLACE_CANDIDATE_TABLE,
} from "./import-review-promotion-promote-places.repo.js";
import {
    ImportReviewPublishBatchSummaryRepository,
} from "./import-review-publish-batch-summary.js";
import { ImportReviewReviewBatchSummaryRepository } from "./import-review-review-batch-summary.js";
import {
    buildVerificationMetadataTracking,
    coreVerificationInsertColumnsSql,
    coreVerificationInsertValuesSql,
    coreVerificationUpdateSetClauseSql,
    getCoreVerificationColumnsForEntity,
} from "./import-review-promotion-core-verification.js";
import {
    type ImportReviewPublishItemValidationStageKey,
} from "./import-review-promotion-validation.types.js";
import {
    ImportReviewPromotionPromoteMapRepository,
    CORE_LANDUSE_TABLE,
    CORE_WATER_LINES_TABLE,
    CORE_WATER_POLYGONS_TABLE,
    LANDUSE_CANDIDATE_TABLE,
    WATER_LINE_CANDIDATE_TABLE,
    WATER_POLYGON_CANDIDATE_TABLE,
} from "./import-review-promotion-promote-map.repo.js";
import {
    ImportReviewPromotionPromoteBusStopsRepository,
    BUS_STOP_CANDIDATE_TABLE,
    CORE_BUS_STOPS_TABLE,
} from "./import-review-promotion-promote-bus-stops.repo.js";
import {
    buildingClassCodeExpr,
    geomSourceExpr,
    nameExpr,
    normalizedDataMergeExpr,
    polygonToMultiPolygonSql,
    sourceRefsMergeExpr,
} from "./import-review-promotion-promote-sql.js";

const PROMOTE_PREFLIGHT_VALIDATION_STAGES: ImportReviewPublishItemValidationStageKey[] = [
    "validate_candidate_state",
    "validate_geometry",
    "validate_required_fields",
    "validate_references",
    "validate_entity_specific_rules",
];

const BUILDING_CANDIDATE_TABLE = "import_review.building_candidates";

const CORE_TABLE = "core.core_map_buildings";
const BUILDING_VERIFICATION_COLUMNS = getCoreVerificationColumnsForEntity("buildings");

export const DEFAULT_PROMOTE_CHUNK_SIZE = 100;
export const MAX_PROMOTE_CHUNK_SIZE = 500;

export type PromotableItemRow = {
    publish_item_id: bigint;
    entity_family: PromotablePublishEntityFamily;
    target_table: string;
    publish_action: string;
    publish_status: string;
    target_id: bigint | null;
    review_candidate_id: bigint;
    review_batch_id: bigint;
    source_snapshot_version: string;
    promotion_status: string | null;
    promoted_core_id: bigint | null;
    matched_core_id: bigint | null;
};

/** Building candidate columns used for core INSERT/UPDATE (excludes geom to avoid ambiguous aliases). */
const PROMOTE_BUILDING_SRC_COLUMNS = Prisma.sql`
    spi.id AS publish_item_id,
    b.id,
    b.review_batch_id,
    b.source_snapshot_version,
    b.local_staging_id,
    b.external_id,
    b.name,
    b.canonical_name,
    b.class_code,
    b.building_type,
    b.normalized_data,
    b.review_overrides,
    b.source_refs,
    b.building_type_id,
    b.admin_area_id,
    b.levels,
    b.height_m,
    b.area_m2,
    b.confidence_score,
    b.matched_core_id,
    b.geom AS candidate_geom
`;

const PROMOTE_PREP_ROW = (geomCaseSql: Prisma.Sql) => Prisma.sql`
    r.publish_item_id,
    r.id,
    r.review_batch_id,
    r.source_snapshot_version,
    r.local_staging_id,
    r.external_id,
    r.name,
    r.canonical_name,
    r.class_code,
    r.building_type,
    r.normalized_data,
    r.review_overrides,
    r.source_refs,
    r.building_type_id,
    r.admin_area_id,
    r.levels,
    r.height_m,
    r.area_m2 AS candidate_area_m2,
    r.confidence_score,
    r.matched_core_id,
    ${geomCaseSql} AS geom
`;

const PROMOTE_READY_ROW = Prisma.sql`
    p.publish_item_id,
    p.id,
    p.review_batch_id,
    p.source_snapshot_version,
    p.local_staging_id,
    p.external_id,
    p.name,
    p.canonical_name,
    p.class_code,
    p.building_type,
    p.normalized_data,
    p.review_overrides,
    p.source_refs,
    p.building_type_id,
    p.admin_area_id,
    p.levels,
    p.height_m,
    p.confidence_score,
    p.matched_core_id,
    p.geom,
    ST_PointOnSurface(p.geom)::geometry(Point, 4326) AS centroid,
    coalesce(p.candidate_area_m2, ST_Area(p.geom::geography)) AS area_m2
`;

export class ImportReviewPromotionPromoteRepository {
    private readonly placesRepo: ImportReviewPromotionPromotePlacesRepository;
    private readonly mapRepo: ImportReviewPromotionPromoteMapRepository;
    private readonly busStopsRepo: ImportReviewPromotionPromoteBusStopsRepository;
    private readonly publishSummaryRepo: ImportReviewPublishBatchSummaryRepository;
    private readonly reviewSummaryRepo: ImportReviewReviewBatchSummaryRepository;

    constructor(
        private readonly prisma: PrismaClient,
        private readonly validationRepo: ImportReviewPromotionValidationRepository
    ) {
        this.placesRepo = new ImportReviewPromotionPromotePlacesRepository(prisma);
        this.mapRepo = new ImportReviewPromotionPromoteMapRepository(prisma);
        this.busStopsRepo = new ImportReviewPromotionPromoteBusStopsRepository(prisma);
        this.publishSummaryRepo = new ImportReviewPublishBatchSummaryRepository(prisma);
        this.reviewSummaryRepo = new ImportReviewReviewBatchSummaryRepository(prisma);
    }

    async fetchBatchProgress(batchId: bigint): Promise<ImportReviewPublishBatchProgressRow | null> {
        return this.validationRepo.fetchBatchProgress(batchId);
    }

    async countRoadPublishItems(batchId: bigint): Promise<number> {
        const rows = await this.prisma.$queryRaw<{ count: bigint }[]>`
            SELECT count(*)::bigint AS count
            FROM system.system_publish_items
            WHERE publish_batch_id = ${batchId}
              AND entity_family = 'roads'
        `;
        return Number(rows[0]?.count ?? 0n);
    }

    async clearStageLogs(batchId: bigint): Promise<void> {
        return this.validationRepo.clearStageLogs(batchId);
    }

    async seedPromotionStageLogs(batchId: bigint): Promise<void> {
        for (const stage of IMPORT_REVIEW_PUBLISH_PROMOTION_STAGES) {
            await this.prisma.$executeRaw`
                INSERT INTO system.system_publish_stage_logs (
                    publish_batch_id, stage_key, stage_label, stage_status,
                    message, progress_percent, details, started_at
                )
                VALUES (
                    ${batchId}, ${stage.key}, ${stage.label}, 'pending',
                    NULL, 0, '{}'::jsonb, now()
                )
            `;
        }
    }

    async updateStageLog(args: {
        batchId: bigint;
        stageKey: ImportReviewPublishPromotionStageKey;
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
                WHERE publish_batch_id = ${args.batchId} AND stage_key = ${args.stageKey}
            `;
        } else {
            await this.prisma.$executeRaw`
                UPDATE system.system_publish_stage_logs
                SET stage_status = ${stageStatus},
                    message = ${args.message ?? null},
                    progress_percent = ${args.progressPercent},
                    details = ${detailsJson}::jsonb,
                    started_at = CASE WHEN stage_status = 'pending' THEN now() ELSE started_at END
                WHERE publish_batch_id = ${args.batchId} AND stage_key = ${args.stageKey}
            `;
        }
    }

    async updateBatchProgress(args: {
        batchId: bigint;
        validationTotal?: number;
        validationDone?: number;
        validationPercent: number;
    }): Promise<void> {
        return this.validationRepo.updateBatchProgress(args);
    }

    async claimBatchForPromotion(batchId: bigint): Promise<{ claimed: boolean; status: string | null }> {
        const rows = await this.prisma.$queryRaw<{ id: bigint; status: string }[]>`
            UPDATE system.system_publish_batches
            SET status = 'promoting', validation_done = 0, validation_percent = 0
            WHERE id = ${batchId}
              AND status = 'ready'
              AND validation_percent = 100
              AND validated_at IS NOT NULL
            RETURNING id, status
        `;
        if (rows.length > 0) {
            return { claimed: true, status: "promoting" };
        }
        const current = await this.fetchBatchProgress(batchId);
        return { claimed: false, status: current?.status ?? null };
    }

    async countReservedNonPromotableItems(batchId: bigint): Promise<number> {
        const rows = await this.prisma.$queryRaw<{ count: bigint }[]>`
            SELECT count(*)::bigint AS count
            FROM system.system_publish_items
            WHERE publish_batch_id = ${batchId}
              AND entity_family NOT IN (${Prisma.join(PROMOTABLE_PUBLISH_FAMILIES)})
        `;
        return Number(rows[0]?.count ?? 0n);
    }

    /** @deprecated Use countReservedNonPromotableItems */
    async countNonBuildingItems(batchId: bigint): Promise<number> {
        return this.countReservedNonPromotableItems(batchId);
    }

    async countPendingByEntityFamily(
        batchId: bigint
    ): Promise<Record<PromotablePublishEntityFamily, number>> {
        const rows = await this.prisma.$queryRaw<{ entity_family: string; count: bigint }[]>`
            SELECT entity_family, count(*)::bigint AS count
            FROM system.system_publish_items
            WHERE publish_batch_id = ${batchId}
              AND entity_family IN (${Prisma.join(PROMOTABLE_PUBLISH_FAMILIES)})
              AND publish_status = 'pending'
            GROUP BY entity_family
        `;
        const out = Object.fromEntries(
            PROMOTABLE_PUBLISH_FAMILIES.map((f) => [f, 0])
        ) as Record<PromotablePublishEntityFamily, number>;
        for (const row of rows) {
            if ((PROMOTABLE_PUBLISH_FAMILIES as readonly string[]).includes(row.entity_family)) {
                out[row.entity_family as PromotablePublishEntityFamily] = Number(row.count);
            }
        }
        return out;
    }

    async listPromotableItems(batchId: bigint): Promise<PromotableItemRow[]> {
        return this.prisma.$queryRaw<PromotableItemRow[]>`
            SELECT * FROM (
                SELECT
                    spi.id AS publish_item_id,
                    'buildings'::text AS entity_family,
                    ${CORE_TABLE} AS target_table,
                    spi.publish_action,
                    spi.publish_status,
                    spi.target_id,
                    spi.review_candidate_id,
                    b.review_batch_id,
                    b.source_snapshot_version,
                    b.promotion_status,
                    b.promoted_core_id,
                    b.matched_core_id
                FROM system.system_publish_items AS spi
                INNER JOIN import_review.building_candidates AS b
                    ON b.id = spi.review_candidate_id
                   AND spi.review_candidate_table = ${BUILDING_CANDIDATE_TABLE}
                WHERE spi.publish_batch_id = ${batchId}
                  AND spi.entity_family = 'buildings'
                UNION ALL
                SELECT
                    spi.id AS publish_item_id,
                    'places'::text AS entity_family,
                    ${CORE_PLACES_TABLE} AS target_table,
                    spi.publish_action,
                    spi.publish_status,
                    spi.target_id,
                    spi.review_candidate_id,
                    p.review_batch_id,
                    p.source_snapshot_version,
                    p.promotion_status,
                    p.promoted_core_id,
                    p.matched_core_id
                FROM system.system_publish_items AS spi
                INNER JOIN import_review.place_candidates AS p
                    ON p.id = spi.review_candidate_id
                   AND spi.review_candidate_table = ${PLACE_CANDIDATE_TABLE}
                WHERE spi.publish_batch_id = ${batchId}
                  AND spi.entity_family = 'places'
                UNION ALL
                SELECT
                    spi.id AS publish_item_id,
                    'landuse'::text AS entity_family,
                    ${CORE_LANDUSE_TABLE} AS target_table,
                    spi.publish_action,
                    spi.publish_status,
                    spi.target_id,
                    spi.review_candidate_id,
                    lu.review_batch_id,
                    lu.source_snapshot_version,
                    lu.promotion_status,
                    lu.promoted_core_id,
                    lu.matched_core_id
                FROM system.system_publish_items AS spi
                INNER JOIN import_review.landuse_candidates AS lu
                    ON lu.id = spi.review_candidate_id
                   AND spi.review_candidate_table = ${LANDUSE_CANDIDATE_TABLE}
                WHERE spi.publish_batch_id = ${batchId}
                  AND spi.entity_family = 'landuse'
                UNION ALL
                SELECT
                    spi.id AS publish_item_id,
                    'water_lines'::text AS entity_family,
                    ${CORE_WATER_LINES_TABLE} AS target_table,
                    spi.publish_action,
                    spi.publish_status,
                    spi.target_id,
                    spi.review_candidate_id,
                    wl.review_batch_id,
                    wl.source_snapshot_version,
                    wl.promotion_status,
                    wl.promoted_core_id,
                    wl.matched_core_id
                FROM system.system_publish_items AS spi
                INNER JOIN import_review.water_line_candidates AS wl
                    ON wl.id = spi.review_candidate_id
                   AND spi.review_candidate_table = ${WATER_LINE_CANDIDATE_TABLE}
                WHERE spi.publish_batch_id = ${batchId}
                  AND spi.entity_family = 'water_lines'
                UNION ALL
                SELECT
                    spi.id AS publish_item_id,
                    'water_polygons'::text AS entity_family,
                    ${CORE_WATER_POLYGONS_TABLE} AS target_table,
                    spi.publish_action,
                    spi.publish_status,
                    spi.target_id,
                    spi.review_candidate_id,
                    wp.review_batch_id,
                    wp.source_snapshot_version,
                    wp.promotion_status,
                    wp.promoted_core_id,
                    wp.matched_core_id
                FROM system.system_publish_items AS spi
                INNER JOIN import_review.water_polygon_candidates AS wp
                    ON wp.id = spi.review_candidate_id
                   AND spi.review_candidate_table = ${WATER_POLYGON_CANDIDATE_TABLE}
                WHERE spi.publish_batch_id = ${batchId}
                  AND spi.entity_family = 'water_polygons'
                UNION ALL
                SELECT
                    spi.id AS publish_item_id,
                    'bus_stops'::text AS entity_family,
                    ${CORE_BUS_STOPS_TABLE} AS target_table,
                    spi.publish_action,
                    spi.publish_status,
                    spi.target_id,
                    spi.review_candidate_id,
                    bs.review_batch_id,
                    bs.source_snapshot_version,
                    bs.promotion_status,
                    bs.promoted_core_id,
                    bs.matched_core_id
                FROM system.system_publish_items AS spi
                INNER JOIN import_review.bus_stop_candidates AS bs
                    ON bs.id = spi.review_candidate_id
                   AND spi.review_candidate_table = ${BUS_STOP_CANDIDATE_TABLE}
                WHERE spi.publish_batch_id = ${batchId}
                  AND spi.entity_family = 'bus_stops'
            ) AS items
            ORDER BY entity_family ASC, publish_item_id ASC
        `;
    }

    async countPendingPromotableItems(batchId: bigint): Promise<number> {
        const rows = await this.prisma.$queryRaw<{ count: bigint }[]>`
            SELECT count(*)::bigint AS count
            FROM system.system_publish_items
            WHERE publish_batch_id = ${batchId}
              AND entity_family IN (${Prisma.join(PROMOTABLE_PUBLISH_FAMILIES)})
              AND publish_status = 'pending'
        `;
        return Number(rows[0]?.count ?? 0n);
    }

    async countByPublishAction(
        batchId: bigint
    ): Promise<{ insert: number; update: number; merge: number }> {
        const rows = await this.prisma.$queryRaw<{ insert: bigint; update: bigint; merge: bigint }[]>`
            SELECT
                count(*) FILTER (WHERE publish_action = 'insert')::bigint AS insert,
                count(*) FILTER (WHERE publish_action = 'update')::bigint AS update,
                count(*) FILTER (WHERE publish_action = 'merge')::bigint AS merge
            FROM system.system_publish_items
            WHERE publish_batch_id = ${batchId}
              AND entity_family IN (${Prisma.join(PROMOTABLE_PUBLISH_FAMILIES)})
        `;
        const r = rows[0];
        return {
            insert: Number(r?.insert ?? 0n),
            update: Number(r?.update ?? 0n),
            merge: Number(r?.merge ?? 0n),
        };
    }

    async runFinalValidationBeforeWrite(itemIds: bigint[]): Promise<number> {
        if (itemIds.length === 0) {
            return 0;
        }
        const familyRows = await this.prisma.$queryRaw<{ id: bigint; entity_family: string }[]>`
            SELECT id, entity_family
            FROM system.system_publish_items
            WHERE id IN (${Prisma.join(itemIds)})
              AND entity_family IN (${Prisma.join(PROMOTABLE_PUBLISH_FAMILIES)})
        `;
        const byFamily = new Map<string, bigint[]>();
        for (const row of familyRows) {
            const list = byFamily.get(row.entity_family) ?? [];
            list.push(row.id);
            byFamily.set(row.entity_family, list);
        }

        const rules = new ImportReviewPromotionValidationRules(this.prisma);
        let errors = 0;
        for (const [family, ids] of byFamily) {
            for (const stage of PROMOTE_PREFLIGHT_VALIDATION_STAGES) {
                const rows = await rules.validateStage(
                    stage,
                    family as PromotablePublishEntityFamily,
                    ids
                );
                errors += rows.filter((r) => r.severity === "error").length;
            }
        }
        const pendingCheck = await this.prisma.$queryRaw<{ count: bigint }[]>`
            SELECT count(*)::bigint AS count
            FROM system.system_publish_items
            WHERE id IN (${Prisma.join(itemIds)})
              AND publish_status <> 'pending'
        `;
        errors += Number(pendingCheck[0]?.count ?? 0n);
        return errors;
    }

    async failBatch(batchId: bigint, message: string): Promise<void> {
        return this.validationRepo.failBatch(batchId, message);
    }

    async promoteItem(args: {
        batchId: bigint;
        publishItemId: bigint;
        promotedBy: bigint | null;
    }): Promise<PromoteItemResult> {
        const itemRows = await this.listPromotableItems(args.batchId);
        const item = itemRows.find((r) => r.publish_item_id === args.publishItemId);
        if (!item) {
            return {
                publish_item_id: args.publishItemId,
                outcome: "failed",
                target_id: null,
                error_message: "Publish item not found.",
                before_data: null,
                after_data: null,
            };
        }

        if (item.publish_status === "success" && item.target_id != null) {
            const coreExists = await this.checkCoreRowExists(item.entity_family, item.target_id);
            if (coreExists) {
                return {
                    publish_item_id: args.publishItemId,
                    outcome: "skipped",
                    target_id: item.target_id,
                    error_message: null,
                    before_data: null,
                    after_data: { id: item.target_id.toString(), skipped: "already_success" },
                };
            }
        }

        if (item.promotion_status === "promoted" && item.promoted_core_id != null) {
            return {
                publish_item_id: args.publishItemId,
                outcome: "skipped",
                target_id: item.promoted_core_id,
                error_message: null,
                before_data: null,
                after_data: { id: item.promoted_core_id.toString(), skipped: "already_promoted" },
            };
        }

        if (item.publish_action === "merge") {
            return {
                publish_item_id: args.publishItemId,
                outcome: "failed",
                target_id: null,
                error_message: "merge publish_action is not supported in promotion v1.",
                before_data: null,
                after_data: null,
            };
        }

        if (item.publish_action === "insert") {
            if (item.entity_family === "places") {
                return this.placesRepo.insertPlace(args.batchId, args.publishItemId, args.promotedBy);
            }
            if (item.entity_family === "bus_stops") {
                return this.busStopsRepo.insertBusStop(args.batchId, args.publishItemId);
            }
            if (this.mapRepo.isMapEntityFamily(item.entity_family)) {
                return this.mapRepo.insertMapEntity(item.entity_family, args.batchId, args.publishItemId);
            }
            return this.insertBuilding(args.batchId, args.publishItemId, args.promotedBy);
        }

        if (item.publish_action === "update") {
            if (item.entity_family === "places") {
                return this.placesRepo.updatePlace(args.batchId, args.publishItemId, args.promotedBy);
            }
            if (item.entity_family === "bus_stops") {
                return this.busStopsRepo.updateBusStop(args.batchId, args.publishItemId);
            }
            if (this.mapRepo.isMapEntityFamily(item.entity_family)) {
                return this.mapRepo.updateMapEntity(item.entity_family, args.batchId, args.publishItemId);
            }
            return this.updateBuilding(args.batchId, args.publishItemId, args.promotedBy);
        }

        return {
            publish_item_id: args.publishItemId,
            outcome: "failed",
            target_id: null,
            error_message: `Unsupported publish_action: ${item.publish_action}`,
            before_data: null,
            after_data: null,
        };
    }

    private async checkCoreRowExists(
        entityFamily: PromotablePublishEntityFamily,
        targetId: bigint
    ): Promise<boolean> {
        if (entityFamily === "places") {
            return this.placesRepo.checkPlaceCoreExists(targetId);
        }
        if (entityFamily === "bus_stops") {
            return this.busStopsRepo.checkBusStopCoreExists(targetId);
        }
        if (this.mapRepo.isMapEntityFamily(entityFamily)) {
            return this.mapRepo.checkMapCoreExists(entityFamily, targetId);
        }
        const rows = await this.prisma.$queryRaw<{ id: bigint }[]>`
            SELECT id FROM core.core_map_buildings
            WHERE id = ${targetId}
              AND coalesce(is_active, true) AND deleted_at IS NULL
            LIMIT 1
        `;
        return rows.length > 0;
    }

    private async insertBuilding(
        batchId: bigint,
        publishItemId: bigint,
        _promotedBy: bigint | null
    ): Promise<PromoteItemResult> {
        const rows = await this.prisma.$queryRaw<
            {
                id: bigint;
                external_id: string | null;
                source_staging_id: bigint | null;
                name: string | null;
                class_code: string;
            }[]
        >`
            WITH src AS (
                SELECT ${PROMOTE_BUILDING_SRC_COLUMNS}
                FROM system.system_publish_items AS spi
                INNER JOIN import_review.building_candidates AS b
                    ON b.id = spi.review_candidate_id
                   AND spi.review_candidate_table = ${BUILDING_CANDIDATE_TABLE}
                WHERE spi.id = ${publishItemId}
                  AND spi.publish_batch_id = ${batchId}
            ),
            raw_geom AS (
                SELECT s.*, ${geomSourceExpr("s")} AS g_raw FROM src AS s
            ),
            prep AS (
                SELECT ${PROMOTE_PREP_ROW(polygonToMultiPolygonSql("r"))}
                FROM raw_geom AS r
            ),
            ready AS (
                SELECT ${PROMOTE_READY_ROW}
                FROM prep AS p
                WHERE p.geom IS NOT NULL
                  AND ST_IsValid(p.geom)
                  AND NOT ST_IsEmpty(p.geom)
                  AND ST_SRID(p.geom) = 4326
            ),
            guard AS (
                SELECT r.*
                FROM ready AS r
                WHERE NOT EXISTS (
                    SELECT 1 FROM core.core_map_buildings AS c
                    WHERE coalesce(c.is_active, true) AND c.deleted_at IS NULL
                      AND (
                          (r.external_id IS NOT NULL AND trim(r.external_id) <> '' AND c.external_id = r.external_id)
                          OR (r.local_staging_id IS NOT NULL AND c.source_staging_id = r.local_staging_id)
                      )
                )
            )
            INSERT INTO core.core_map_buildings (
                source_staging_id, external_id, name, class_code, normalized_data, source_refs,
                geom, building_type_id, admin_area_id, levels, height_m,
                centroid, area_m2, confidence_score${coreVerificationInsertColumnsSql(BUILDING_VERIFICATION_COLUMNS)}, is_active,
                created_at, updated_at, deleted_at
            )
            SELECT
                g.local_staging_id,
                nullif(trim(g.external_id), ''),
                ${nameExpr("g")},
                ${buildingClassCodeExpr("g")},
                ${normalizedDataMergeExpr("g", batchId)},
                ${sourceRefsMergeExpr("g", batchId, "buildings")},
                g.geom,
                coalesce(
                    CASE WHEN (g.review_overrides->>'building_type_id') ~ '^[0-9]+$'
                        THEN (g.review_overrides->>'building_type_id')::bigint END,
                    g.building_type_id
                ),
                coalesce(
                    CASE WHEN (g.review_overrides->>'admin_area_id') ~ '^[0-9]+$'
                        THEN (g.review_overrides->>'admin_area_id')::bigint END,
                    g.admin_area_id
                ),
                coalesce(
                    CASE WHEN (g.review_overrides->>'levels') ~ '^-?[0-9]+$'
                        THEN (g.review_overrides->>'levels')::integer END,
                    g.levels
                ),
                coalesce(
                    CASE WHEN (g.review_overrides->>'height_m') ~ '^-?[0-9]+(\\.[0-9]+)?$'
                        THEN (g.review_overrides->>'height_m')::numeric END,
                    g.height_m
                ),
                g.centroid,
                g.area_m2,
                coalesce(g.confidence_score, 80)${coreVerificationInsertValuesSql(BUILDING_VERIFICATION_COLUMNS)},
                true,
                now(),
                now(),
                NULL::timestamptz
            FROM guard AS g
            RETURNING id, external_id, source_staging_id, name, class_code
        `;

        if (rows.length === 0) {
            return {
                publish_item_id: publishItemId,
                outcome: "failed",
                target_id: null,
                error_message: "Insert blocked: duplicate core row, invalid geometry, or missing required fields.",
                before_data: null,
                after_data: null,
            };
        }

        const row = rows[0]!;
        const verificationMeta = buildVerificationMetadataTracking({
            outcome: "inserted",
            beforeData: null,
            entityKey: "buildings",
        });
        return {
            publish_item_id: publishItemId,
            outcome: "inserted",
            target_id: row.id,
            error_message: null,
            before_data: null,
            after_data: {
                id: row.id.toString(),
                external_id: row.external_id,
                source_staging_id: row.source_staging_id?.toString() ?? null,
                name: row.name,
                class_code: row.class_code,
            },
            ...verificationMeta,
        };
    }

    private async updateBuilding(
        batchId: bigint,
        publishItemId: bigint,
        _promotedBy: bigint | null
    ): Promise<PromoteItemResult> {
        const beforeRows = await this.prisma.$queryRaw<{ row_json: unknown }[]>`
            SELECT to_jsonb(c) AS row_json
            FROM system.system_publish_items AS spi
            INNER JOIN import_review.building_candidates AS b
                ON b.id = spi.review_candidate_id
               AND spi.review_candidate_table = ${BUILDING_CANDIDATE_TABLE}
            INNER JOIN core.core_map_buildings AS c ON c.id = b.matched_core_id
            WHERE spi.id = ${publishItemId}
              AND coalesce(c.is_active, true) AND c.deleted_at IS NULL
              AND NOT (c.source_refs @> '{"source":"dashboard"}'::jsonb)
            LIMIT 1
        `;
        const beforeData = beforeRows[0]?.row_json ?? null;
        if (!beforeData) {
            return {
                publish_item_id: publishItemId,
                outcome: "failed",
                target_id: null,
                error_message:
                    "Update blocked: matched_core_id missing, core row inactive, or dashboard-protected target.",
                before_data: null,
                after_data: null,
            };
        }

        const rows = await this.prisma.$queryRaw<
            { id: bigint; external_id: string | null; name: string | null; class_code: string }[]
        >`
            WITH src AS (
                SELECT ${PROMOTE_BUILDING_SRC_COLUMNS}
                FROM system.system_publish_items AS spi
                INNER JOIN import_review.building_candidates AS b
                    ON b.id = spi.review_candidate_id
                   AND spi.review_candidate_table = ${BUILDING_CANDIDATE_TABLE}
                WHERE spi.id = ${publishItemId}
                  AND spi.publish_batch_id = ${batchId}
                  AND b.matched_core_id IS NOT NULL
            ),
            raw_geom AS (
                SELECT s.*, ${geomSourceExpr("s")} AS g_raw FROM src AS s
            ),
            prep AS (
                SELECT ${PROMOTE_PREP_ROW(polygonToMultiPolygonSql("r"))}
                FROM raw_geom AS r
            ),
            ready AS (
                SELECT ${PROMOTE_READY_ROW}
                FROM prep AS p
                WHERE p.geom IS NOT NULL AND ST_IsValid(p.geom) AND NOT ST_IsEmpty(p.geom)
            )
            UPDATE core.core_map_buildings AS c
            SET
                source_staging_id = r.local_staging_id,
                external_id = nullif(trim(r.external_id), ''),
                name = ${nameExpr("r")},
                class_code = ${buildingClassCodeExpr("r")},
                normalized_data = ${normalizedDataMergeExpr("r", batchId)},
                source_refs = ${sourceRefsMergeExpr("r", batchId, "buildings")},
                geom = r.geom,
                building_type_id = coalesce(
                    CASE WHEN (r.review_overrides->>'building_type_id') ~ '^[0-9]+$'
                        THEN (r.review_overrides->>'building_type_id')::bigint END,
                    r.building_type_id
                ),
                admin_area_id = coalesce(
                    CASE WHEN (r.review_overrides->>'admin_area_id') ~ '^[0-9]+$'
                        THEN (r.review_overrides->>'admin_area_id')::bigint END,
                    r.admin_area_id
                ),
                levels = coalesce(
                    CASE WHEN (r.review_overrides->>'levels') ~ '^-?[0-9]+$'
                        THEN (r.review_overrides->>'levels')::integer END,
                    r.levels
                ),
                height_m = coalesce(
                    CASE WHEN (r.review_overrides->>'height_m') ~ '^-?[0-9]+(\\.[0-9]+)?$'
                        THEN (r.review_overrides->>'height_m')::numeric END,
                    r.height_m
                ),
                centroid = r.centroid,
                area_m2 = r.area_m2,
                confidence_score = coalesce(r.confidence_score, c.confidence_score)${coreVerificationUpdateSetClauseSql("c", BUILDING_VERIFICATION_COLUMNS)},
                is_active = true,
                deleted_at = NULL,
                updated_at = now()
            FROM ready AS r
            WHERE c.id = r.matched_core_id
              AND coalesce(c.is_active, true) AND c.deleted_at IS NULL
              AND NOT (c.source_refs @> '{"source":"dashboard"}'::jsonb)
            RETURNING c.id, c.external_id, c.name, c.class_code
        `;

        if (rows.length === 0) {
            return {
                publish_item_id: publishItemId,
                outcome: "failed",
                target_id: null,
                error_message: "Update failed: geometry invalid or target not updatable.",
                before_data: beforeData,
                after_data: null,
            };
        }

        const row = rows[0]!;
        const verificationMeta = buildVerificationMetadataTracking({
            outcome: "updated",
            beforeData,
            entityKey: "buildings",
        });
        return {
            publish_item_id: publishItemId,
            outcome: "updated",
            target_id: row.id,
            error_message: null,
            before_data: beforeData,
            after_data: {
                id: row.id.toString(),
                external_id: row.external_id,
                name: row.name,
                class_code: row.class_code,
            },
            ...verificationMeta,
        };
    }

    async applyItemSuccess(args: {
        publishItemId: bigint;
        targetId: bigint;
        targetTable: string;
        beforeData: unknown | null;
        afterData: unknown;
    }): Promise<void> {
        const afterJson = JSON.stringify(args.afterData);
        const beforeJson = args.beforeData != null ? JSON.stringify(args.beforeData) : null;
        await this.prisma.$executeRaw`
            UPDATE system.system_publish_items
            SET publish_status = 'success',
                target_id = ${args.targetId},
                target_schema = 'core',
                target_table = ${args.targetTable},
                before_data = ${beforeJson}::jsonb,
                after_data = ${afterJson}::jsonb,
                error_message = NULL,
                published_at = now()
            WHERE id = ${args.publishItemId}
        `;
    }

    async applyItemFailure(args: {
        publishItemId: bigint;
        errorMessage: string;
        afterData?: unknown;
    }): Promise<void> {
        const afterJson = JSON.stringify(args.afterData ?? { error: args.errorMessage });
        await this.prisma.$executeRaw`
            UPDATE system.system_publish_items
            SET publish_status = 'failed',
                error_message = ${args.errorMessage},
                after_data = ${afterJson}::jsonb
            WHERE id = ${args.publishItemId}
        `;
    }

    async markCandidatePromoted(args: {
        entityFamily: PromotablePublishEntityFamily;
        reviewCandidateId: bigint;
        promotedCoreId: bigint;
        promotedBy: bigint | null;
    }): Promise<void> {
        const config = IMPORT_REVIEW_PUBLISH_FAMILY_CONFIG[args.entityFamily];
        await this.prisma.$executeRaw`
            UPDATE ${Prisma.raw(config.candidateTable)}
            SET promotion_status = 'promoted',
                promoted_core_id = ${args.promotedCoreId},
                promoted_at = now(),
                promoted_by = ${args.promotedBy},
                review_status = 'promoted',
                updated_at = now()
            WHERE id = ${args.reviewCandidateId}
        `;
    }

    async markCandidateFailed(
        entityFamily: PromotablePublishEntityFamily,
        reviewCandidateId: bigint
    ): Promise<void> {
        const config = IMPORT_REVIEW_PUBLISH_FAMILY_CONFIG[entityFamily];
        await this.prisma.$executeRaw`
            UPDATE ${Prisma.raw(config.candidateTable)}
            SET promotion_status = 'failed',
                review_status = 'promotion_failed',
                updated_at = now()
            WHERE id = ${reviewCandidateId}
        `;
    }

    async verifyCoreRows(
        batchId: bigint
    ): Promise<{ missing: number; invalid_geom: number; missing_names: number }> {
        const buildingRows = await this.prisma.$queryRaw<{ missing: bigint; invalid_geom: bigint }[]>`
            SELECT
                count(*) FILTER (
                    WHERE spi.publish_status = 'success'
                      AND (
                          spi.target_id IS NULL
                          OR c.id IS NULL
                          OR NOT coalesce(c.is_active, true)
                          OR c.deleted_at IS NOT NULL
                      )
                )::bigint AS missing,
                count(*) FILTER (
                    WHERE spi.publish_status = 'success'
                      AND c.id IS NOT NULL
                      AND (c.geom IS NULL OR NOT ST_IsValid(c.geom) OR ST_SRID(c.geom) <> 4326)
                )::bigint AS invalid_geom
            FROM system.system_publish_items AS spi
            LEFT JOIN core.core_map_buildings AS c ON c.id = spi.target_id
            WHERE spi.publish_batch_id = ${batchId}
              AND spi.entity_family = 'buildings'
        `;
        const placeRows = await this.prisma.$queryRaw<{ missing: bigint; invalid_geom: bigint; missing_names: bigint }[]>`
            SELECT
                count(*) FILTER (
                    WHERE spi.publish_status = 'success'
                      AND (
                          spi.target_id IS NULL
                          OR p.id IS NULL
                          OR p.deleted_at IS NOT NULL
                      )
                )::bigint AS missing,
                count(*) FILTER (
                    WHERE spi.publish_status = 'success'
                      AND p.id IS NOT NULL
                      AND (
                          p.point_geom IS NULL
                          OR NOT ST_IsValid(p.point_geom)
                          OR ST_SRID(p.point_geom) <> 4326
                      )
                )::bigint AS invalid_geom,
                count(*) FILTER (
                    WHERE spi.publish_status = 'success'
                      AND p.id IS NOT NULL
                      AND NOT EXISTS (
                          SELECT 1 FROM core.core_place_names AS pn WHERE pn.place_id = p.id
                      )
                )::bigint AS missing_names
            FROM system.system_publish_items AS spi
            LEFT JOIN core.core_places AS p ON p.id = spi.target_id
            WHERE spi.publish_batch_id = ${batchId}
              AND spi.entity_family = 'places'
        `;
        const mapPolygonRows = await this.prisma.$queryRaw<{ missing: bigint; invalid_geom: bigint }[]>`
            SELECT
                count(*) FILTER (
                    WHERE spi.publish_status = 'success'
                      AND (
                          spi.target_id IS NULL
                          OR c.id IS NULL
                          OR NOT coalesce(c.is_active, true)
                          OR c.source_refs->>'review_candidate_id' IS NULL
                          OR c.source_refs->>'publish_batch_id' IS NULL
                      )
                )::bigint AS missing,
                count(*) FILTER (
                    WHERE spi.publish_status = 'success'
                      AND c.id IS NOT NULL
                      AND (
                          c.geom IS NULL
                          OR NOT ST_IsValid(c.geom)
                          OR ST_SRID(c.geom) <> 4326
                          OR ST_GeometryType(c.geom) NOT IN ('ST_Polygon', 'ST_MultiPolygon')
                      )
                )::bigint AS invalid_geom
            FROM system.system_publish_items AS spi
            LEFT JOIN core.core_map_landuse AS c ON c.id = spi.target_id
            WHERE spi.publish_batch_id = ${batchId}
              AND spi.entity_family = 'landuse'
        `;
        const waterLineRows = await this.prisma.$queryRaw<{ missing: bigint; invalid_geom: bigint }[]>`
            SELECT
                count(*) FILTER (
                    WHERE spi.publish_status = 'success'
                      AND (
                          spi.target_id IS NULL
                          OR c.id IS NULL
                          OR NOT coalesce(c.is_active, true)
                          OR c.source_refs->>'review_candidate_id' IS NULL
                          OR c.source_refs->>'publish_batch_id' IS NULL
                      )
                )::bigint AS missing,
                count(*) FILTER (
                    WHERE spi.publish_status = 'success'
                      AND c.id IS NOT NULL
                      AND (
                          c.geom IS NULL
                          OR NOT ST_IsValid(c.geom)
                          OR ST_SRID(c.geom) <> 4326
                          OR ST_GeometryType(c.geom) NOT IN ('ST_LineString', 'ST_MultiLineString')
                      )
                )::bigint AS invalid_geom
            FROM system.system_publish_items AS spi
            LEFT JOIN core.core_map_water_lines AS c ON c.id = spi.target_id
            WHERE spi.publish_batch_id = ${batchId}
              AND spi.entity_family = 'water_lines'
        `;
        const waterPolygonRows = await this.prisma.$queryRaw<{ missing: bigint; invalid_geom: bigint }[]>`
            SELECT
                count(*) FILTER (
                    WHERE spi.publish_status = 'success'
                      AND (
                          spi.target_id IS NULL
                          OR c.id IS NULL
                          OR NOT coalesce(c.is_active, true)
                          OR c.source_refs->>'review_candidate_id' IS NULL
                          OR c.source_refs->>'publish_batch_id' IS NULL
                      )
                )::bigint AS missing,
                count(*) FILTER (
                    WHERE spi.publish_status = 'success'
                      AND c.id IS NOT NULL
                      AND (
                          c.geom IS NULL
                          OR NOT ST_IsValid(c.geom)
                          OR ST_SRID(c.geom) <> 4326
                          OR ST_GeometryType(c.geom) NOT IN ('ST_Polygon', 'ST_MultiPolygon')
                      )
                )::bigint AS invalid_geom
            FROM system.system_publish_items AS spi
            LEFT JOIN core.core_map_water_polygons AS c ON c.id = spi.target_id
            WHERE spi.publish_batch_id = ${batchId}
              AND spi.entity_family = 'water_polygons'
        `;
        const busStopRows = await this.prisma.$queryRaw<{ missing: bigint; invalid_geom: bigint; missing_names: bigint }[]>`
            SELECT
                count(*) FILTER (
                    WHERE spi.publish_status = 'success'
                      AND (
                          spi.target_id IS NULL
                          OR s.id IS NULL
                          OR NOT coalesce(s.is_active, true)
                          OR s.source_refs->>'review_candidate_id' IS NULL
                          OR s.source_refs->>'publish_batch_id' IS NULL
                      )
                )::bigint AS missing,
                count(*) FILTER (
                    WHERE spi.publish_status = 'success'
                      AND s.id IS NOT NULL
                      AND (
                          s.geom IS NULL
                          OR NOT ST_IsValid(s.geom)
                          OR ST_SRID(s.geom) <> 4326
                          OR ST_GeometryType(s.geom) <> 'ST_Point'
                      )
                )::bigint AS invalid_geom,
                count(*) FILTER (
                    WHERE spi.publish_status = 'success'
                      AND s.id IS NOT NULL
                      AND bs.id IS NOT NULL
                      AND nullif(trim(coalesce(
                          bs.review_overrides->>'name',
                          bs.review_overrides->>'name_local',
                          bs.name,
                          bs.name_local,
                          bs.canonical_name,
                          bs.normalized_data->>'name',
                          bs.normalized_data->>'name_local',
                          bs.normalized_data->>'canonical_name',
                          ''
                      )), '') IS NOT NULL
                      AND nullif(trim(coalesce(
                          bs.review_overrides->>'name',
                          bs.review_overrides->>'name_local',
                          bs.name,
                          bs.name_local,
                          bs.canonical_name,
                          bs.normalized_data->>'name',
                          bs.normalized_data->>'name_local',
                          bs.normalized_data->>'canonical_name',
                          ''
                      )), '') <> nullif(trim(coalesce(
                          bs.review_overrides->>'stop_code',
                          bs.stop_code,
                          bs.normalized_data->>'stop_code',
                          ''
                      )), '')
                      AND NOT EXISTS (
                          SELECT 1 FROM core.core_bus_stop_names AS n WHERE n.stop_id = s.id
                      )
                )::bigint AS missing_names
            FROM system.system_publish_items AS spi
            LEFT JOIN core.core_bus_stops AS s ON s.id = spi.target_id
            LEFT JOIN import_review.bus_stop_candidates AS bs ON bs.id = spi.review_candidate_id
            WHERE spi.publish_batch_id = ${batchId}
              AND spi.entity_family = 'bus_stops'
        `;
        return {
            missing:
                Number(buildingRows[0]?.missing ?? 0n) +
                Number(placeRows[0]?.missing ?? 0n) +
                Number(mapPolygonRows[0]?.missing ?? 0n) +
                Number(waterLineRows[0]?.missing ?? 0n) +
                Number(waterPolygonRows[0]?.missing ?? 0n) +
                Number(busStopRows[0]?.missing ?? 0n),
            invalid_geom:
                Number(buildingRows[0]?.invalid_geom ?? 0n) +
                Number(placeRows[0]?.invalid_geom ?? 0n) +
                Number(mapPolygonRows[0]?.invalid_geom ?? 0n) +
                Number(waterLineRows[0]?.invalid_geom ?? 0n) +
                Number(waterPolygonRows[0]?.invalid_geom ?? 0n) +
                Number(busStopRows[0]?.invalid_geom ?? 0n),
            missing_names:
                Number(placeRows[0]?.missing_names ?? 0n) + Number(busStopRows[0]?.missing_names ?? 0n),
        };
    }

    async countMarkedPromoted(batchId: bigint): Promise<number> {
        const rows = await this.prisma.$queryRaw<{ count: bigint }[]>`
            SELECT count(*)::bigint AS count
            FROM (
                SELECT spi.id
                FROM system.system_publish_items AS spi
                INNER JOIN import_review.building_candidates AS b
                    ON b.id = spi.review_candidate_id
                   AND spi.review_candidate_table = ${BUILDING_CANDIDATE_TABLE}
                WHERE spi.publish_batch_id = ${batchId}
                  AND spi.publish_status = 'success'
                  AND b.promotion_status = 'promoted'
                  AND b.promoted_core_id IS NOT NULL
                UNION ALL
                SELECT spi.id
                FROM system.system_publish_items AS spi
                INNER JOIN import_review.place_candidates AS p
                    ON p.id = spi.review_candidate_id
                   AND spi.review_candidate_table = ${PLACE_CANDIDATE_TABLE}
                WHERE spi.publish_batch_id = ${batchId}
                  AND spi.publish_status = 'success'
                  AND p.promotion_status = 'promoted'
                  AND p.promoted_core_id IS NOT NULL
                UNION ALL
                SELECT spi.id
                FROM system.system_publish_items AS spi
                INNER JOIN import_review.landuse_candidates AS lu
                    ON lu.id = spi.review_candidate_id
                   AND spi.review_candidate_table = ${LANDUSE_CANDIDATE_TABLE}
                WHERE spi.publish_batch_id = ${batchId}
                  AND spi.publish_status = 'success'
                  AND lu.promotion_status = 'promoted'
                  AND lu.promoted_core_id IS NOT NULL
                UNION ALL
                SELECT spi.id
                FROM system.system_publish_items AS spi
                INNER JOIN import_review.water_line_candidates AS wl
                    ON wl.id = spi.review_candidate_id
                   AND spi.review_candidate_table = ${WATER_LINE_CANDIDATE_TABLE}
                WHERE spi.publish_batch_id = ${batchId}
                  AND spi.publish_status = 'success'
                  AND wl.promotion_status = 'promoted'
                  AND wl.promoted_core_id IS NOT NULL
                UNION ALL
                SELECT spi.id
                FROM system.system_publish_items AS spi
                INNER JOIN import_review.water_polygon_candidates AS wp
                    ON wp.id = spi.review_candidate_id
                   AND spi.review_candidate_table = ${WATER_POLYGON_CANDIDATE_TABLE}
                WHERE spi.publish_batch_id = ${batchId}
                  AND spi.publish_status = 'success'
                  AND wp.promotion_status = 'promoted'
                  AND wp.promoted_core_id IS NOT NULL
                UNION ALL
                SELECT spi.id
                FROM system.system_publish_items AS spi
                INNER JOIN import_review.bus_stop_candidates AS bs
                    ON bs.id = spi.review_candidate_id
                   AND spi.review_candidate_table = ${BUS_STOP_CANDIDATE_TABLE}
                WHERE spi.publish_batch_id = ${batchId}
                  AND spi.publish_status = 'success'
                  AND bs.promotion_status = 'promoted'
                  AND bs.promoted_core_id IS NOT NULL
            ) AS marked
        `;
        return Number(rows[0]?.count ?? 0n);
    }

    async finalizePromotionBatch(args: {
        batchId: bigint;
        status: string;
        successCount: number;
        failedCount: number;
        skippedCount: number;
        totalItemCount: number;
        promotedBy: bigint | null;
        summary: Record<string, unknown>;
    }): Promise<void> {
        const summaryJson = JSON.stringify(args.summary);
        await this.prisma.$executeRaw`
            UPDATE system.system_publish_batches
            SET
                status = ${args.status},
                success_count = ${args.successCount},
                failed_count = ${args.failedCount},
                skipped_count = ${args.skippedCount},
                total_item_count = ${args.totalItemCount},
                validation_done = ${args.totalItemCount},
                validation_percent = 100,
                promoted_at = now(),
                promoted_by = ${args.promotedBy},
                summary = coalesce(summary, '{}'::jsonb) || ${summaryJson}::jsonb
            WHERE id = ${args.batchId}
        `;
    }

    async syncPublishBatchSummary(batchId: bigint) {
        return this.publishSummaryRepo.syncPublishBatchSummary(batchId);
    }

    async syncReviewBatchStatusForPublishBatch(batchId: bigint) {
        const rows = await this.prisma.$queryRaw<{ source_review_batch_id: bigint | null }[]>`
            SELECT source_review_batch_id
            FROM system.system_publish_batches
            WHERE id = ${batchId}
            LIMIT 1
        `;
        const reviewBatchId = rows[0]?.source_review_batch_id;
        if (reviewBatchId == null) {
            return null;
        }
        return this.reviewSummaryRepo.syncReviewBatchStatus(reviewBatchId);
    }

    async getBatchVerify(batchId: bigint): Promise<ImportReviewPublishBatchVerifyResponse> {
        const itemCounts = await this.prisma.$queryRaw<
            {
                success: bigint;
                failed: bigint;
                pending: bigint;
                skipped: bigint;
                success_missing_target: bigint;
            }[]
        >`
            SELECT
                count(*) FILTER (WHERE publish_status = 'success')::bigint AS success,
                count(*) FILTER (WHERE publish_status = 'failed')::bigint AS failed,
                count(*) FILTER (WHERE publish_status = 'pending')::bigint AS pending,
                count(*) FILTER (WHERE publish_status = 'skipped')::bigint AS skipped,
                count(*) FILTER (WHERE publish_status = 'success' AND target_id IS NULL)::bigint AS success_missing_target
            FROM system.system_publish_items
            WHERE publish_batch_id = ${batchId}
        `;
        const ic = itemCounts[0] ?? {
            success: 0n,
            failed: 0n,
            pending: 0n,
            skipped: 0n,
            success_missing_target: 0n,
        };

        const buildingCoreIssues = await this.prisma.$queryRaw<
            { missing: bigint; inactive: bigint; lineage: bigint; geom: bigint }[]
        >`
            SELECT
                count(*) FILTER (WHERE spi.publish_status = 'success' AND c.id IS NULL)::bigint AS missing,
                count(*) FILTER (
                    WHERE spi.publish_status = 'success'
                      AND c.id IS NOT NULL
                      AND (NOT coalesce(c.is_active, true) OR c.deleted_at IS NOT NULL)
                )::bigint AS inactive,
                count(*) FILTER (
                    WHERE spi.publish_status = 'success'
                      AND c.id IS NOT NULL
                      AND (
                          c.source_refs->>'review_candidate_id' IS NULL
                          OR c.source_refs->>'publish_batch_id' IS NULL
                      )
                )::bigint AS lineage,
                count(*) FILTER (
                    WHERE spi.publish_status = 'success'
                      AND c.id IS NOT NULL
                      AND (c.geom IS NULL OR NOT ST_IsValid(c.geom) OR ST_SRID(c.geom) <> 4326)
                )::bigint AS geom
            FROM system.system_publish_items AS spi
            LEFT JOIN core.core_map_buildings AS c ON c.id = spi.target_id
            WHERE spi.publish_batch_id = ${batchId} AND spi.entity_family = 'buildings'
        `;
        const placeCoreIssues = await this.prisma.$queryRaw<
            { missing: bigint; inactive: bigint; lineage: bigint; geom: bigint; missing_names: bigint }[]
        >`
            SELECT
                count(*) FILTER (WHERE spi.publish_status = 'success' AND p.id IS NULL)::bigint AS missing,
                count(*) FILTER (
                    WHERE spi.publish_status = 'success'
                      AND p.id IS NOT NULL
                      AND p.deleted_at IS NOT NULL
                )::bigint AS inactive,
                count(*) FILTER (
                    WHERE spi.publish_status = 'success'
                      AND p.id IS NOT NULL
                      AND (
                          p.source_refs->>'review_candidate_id' IS NULL
                          OR p.source_refs->>'publish_batch_id' IS NULL
                      )
                )::bigint AS lineage,
                count(*) FILTER (
                    WHERE spi.publish_status = 'success'
                      AND p.id IS NOT NULL
                      AND (
                          p.point_geom IS NULL
                          OR NOT ST_IsValid(p.point_geom)
                          OR ST_SRID(p.point_geom) <> 4326
                      )
                )::bigint AS geom,
                count(*) FILTER (
                    WHERE spi.publish_status = 'success'
                      AND p.id IS NOT NULL
                      AND NOT EXISTS (
                          SELECT 1 FROM core.core_place_names AS pn WHERE pn.place_id = p.id
                      )
                )::bigint AS missing_names
            FROM system.system_publish_items AS spi
            LEFT JOIN core.core_places AS p ON p.id = spi.target_id
            WHERE spi.publish_batch_id = ${batchId} AND spi.entity_family = 'places'
        `;
        const busStopCoreIssues = await this.prisma.$queryRaw<
            { missing: bigint; inactive: bigint; lineage: bigint; geom: bigint; missing_names: bigint }[]
        >`
            SELECT
                count(*) FILTER (WHERE spi.publish_status = 'success' AND s.id IS NULL)::bigint AS missing,
                count(*) FILTER (
                    WHERE spi.publish_status = 'success'
                      AND s.id IS NOT NULL
                      AND NOT coalesce(s.is_active, true)
                )::bigint AS inactive,
                count(*) FILTER (
                    WHERE spi.publish_status = 'success'
                      AND s.id IS NOT NULL
                      AND (
                          s.source_refs->>'review_candidate_id' IS NULL
                          OR s.source_refs->>'publish_batch_id' IS NULL
                      )
                )::bigint AS lineage,
                count(*) FILTER (
                    WHERE spi.publish_status = 'success'
                      AND s.id IS NOT NULL
                      AND (
                          s.geom IS NULL
                          OR NOT ST_IsValid(s.geom)
                          OR ST_SRID(s.geom) <> 4326
                          OR ST_GeometryType(s.geom) <> 'ST_Point'
                      )
                )::bigint AS geom,
                count(*) FILTER (
                    WHERE spi.publish_status = 'success'
                      AND s.id IS NOT NULL
                      AND bs.id IS NOT NULL
                      AND nullif(trim(coalesce(
                          bs.review_overrides->>'name',
                          bs.review_overrides->>'name_local',
                          bs.name,
                          bs.name_local,
                          bs.canonical_name,
                          bs.normalized_data->>'name',
                          bs.normalized_data->>'name_local',
                          bs.normalized_data->>'canonical_name',
                          ''
                      )), '') IS NOT NULL
                      AND nullif(trim(coalesce(
                          bs.review_overrides->>'name',
                          bs.review_overrides->>'name_local',
                          bs.name,
                          bs.name_local,
                          bs.canonical_name,
                          bs.normalized_data->>'name',
                          bs.normalized_data->>'name_local',
                          bs.normalized_data->>'canonical_name',
                          ''
                      )), '') <> nullif(trim(coalesce(
                          bs.review_overrides->>'stop_code',
                          bs.stop_code,
                          bs.normalized_data->>'stop_code',
                          ''
                      )), '')
                      AND NOT EXISTS (
                          SELECT 1 FROM core.core_bus_stop_names AS n WHERE n.stop_id = s.id
                      )
                )::bigint AS missing_names
            FROM system.system_publish_items AS spi
            LEFT JOIN core.core_bus_stops AS s ON s.id = spi.target_id
            LEFT JOIN import_review.bus_stop_candidates AS bs ON bs.id = spi.review_candidate_id
            WHERE spi.publish_batch_id = ${batchId} AND spi.entity_family = 'bus_stops'
        `;
        const bi = buildingCoreIssues[0] ?? { missing: 0n, inactive: 0n, lineage: 0n, geom: 0n };
        const pi = placeCoreIssues[0] ?? {
            missing: 0n,
            inactive: 0n,
            lineage: 0n,
            geom: 0n,
            missing_names: 0n,
        };
        const bsi = busStopCoreIssues[0] ?? {
            missing: 0n,
            inactive: 0n,
            lineage: 0n,
            geom: 0n,
            missing_names: 0n,
        };

        const candMissing = await this.prisma.$queryRaw<{ count: bigint }[]>`
            SELECT count(*)::bigint AS count
            FROM (
                SELECT spi.id
                FROM system.system_publish_items AS spi
                INNER JOIN import_review.building_candidates AS b ON b.id = spi.review_candidate_id
                WHERE spi.publish_batch_id = ${batchId}
                  AND spi.publish_status = 'success'
                  AND b.promotion_status = 'promoted'
                  AND b.promoted_core_id IS NULL
                UNION ALL
                SELECT spi.id
                FROM system.system_publish_items AS spi
                INNER JOIN import_review.place_candidates AS p ON p.id = spi.review_candidate_id
                WHERE spi.publish_batch_id = ${batchId}
                  AND spi.publish_status = 'success'
                  AND p.promotion_status = 'promoted'
                  AND p.promoted_core_id IS NULL
                UNION ALL
                SELECT spi.id
                FROM system.system_publish_items AS spi
                INNER JOIN import_review.bus_stop_candidates AS bs ON bs.id = spi.review_candidate_id
                WHERE spi.publish_batch_id = ${batchId}
                  AND spi.publish_status = 'success'
                  AND bs.promotion_status = 'promoted'
                  AND bs.promoted_core_id IS NULL
            ) AS missing_candidates
        `;

        const issues: ImportReviewPublishBatchVerifyResponse["issues"] = [];
        const missingCore =
            Number(bi.missing ?? 0n) + Number(pi.missing ?? 0n) + Number(bsi.missing ?? 0n);
        const missingTarget = Number(ic.success_missing_target ?? 0n);
        const lineage = Number(bi.lineage ?? 0n) + Number(pi.lineage ?? 0n) + Number(bsi.lineage ?? 0n);
        const geom = Number(bi.geom ?? 0n) + Number(pi.geom ?? 0n) + Number(bsi.geom ?? 0n);
        const missingNames = Number(pi.missing_names ?? 0n) + Number(bsi.missing_names ?? 0n);
        const cand = Number(candMissing[0]?.count ?? 0n);

        if (missingTarget > 0) {
            issues.push({
                code: "success_missing_target_id",
                message: `${missingTarget} success item(s) missing target_id.`,
                severity: "error",
            });
        }
        if (missingCore > 0) {
            issues.push({
                code: "core_row_missing",
                message: `${missingCore} success item(s) reference missing core rows.`,
                severity: "error",
            });
        }
        if (cand > 0) {
            issues.push({
                code: "candidate_missing_promoted_core_id",
                message: `${cand} promoted candidate(s) missing promoted_core_id.`,
                severity: "error",
            });
        }
        if (lineage > 0) {
            issues.push({
                code: "lineage_incomplete",
                message: `${lineage} core row(s) missing review_candidate_id or publish_batch_id in source_refs.`,
                severity: "warning",
            });
        }
        if (geom > 0) {
            issues.push({
                code: "geometry_invalid",
                message: `${geom} core row(s) have invalid or missing geometry.`,
                severity: "warning",
            });
        }
        if (missingNames > 0) {
            issues.push({
                code: "place_or_bus_stop_names_missing",
                message: `${missingNames} promoted place(s) or bus stop(s) missing name rows in core.`,
                severity: "error",
            });
        }

        const hasError = issues.some((i) => i.severity === "error");
        const hasWarning = issues.some((i) => i.severity === "warning");
        const verification_status = hasError ? "failed" : hasWarning ? "warning" : "passed";

        return {
            batch_id: batchId.toString(),
            verification_status,
            publish_items: {
                success: Number(ic.success ?? 0n),
                failed: Number(ic.failed ?? 0n),
                pending: Number(ic.pending ?? 0n),
                skipped: Number(ic.skipped ?? 0n),
                success_missing_target_id: missingTarget,
            },
            core_rows_missing: missingCore,
            core_rows_inactive:
                Number(bi.inactive ?? 0n) + Number(pi.inactive ?? 0n) + Number(bsi.inactive ?? 0n),
            candidates_promoted_missing_core_id: cand,
            lineage_warnings: lineage,
            geometry_warnings: geom,
            issues,
        };
    }
}
