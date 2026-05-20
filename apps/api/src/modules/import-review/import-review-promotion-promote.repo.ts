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
    type PromotablePublishEntityFamily,
} from "./import-review-promotion-config.js";
import { requireValidPublishStageStatus } from "./import-review-promotion-stage-status.js";
import {
    CORE_PLACES_TABLE,
    ImportReviewPromotionPromotePlacesRepository,
    PLACE_CANDIDATE_TABLE,
} from "./import-review-promotion-promote-places.repo.js";
import {
    type ImportReviewPublishItemValidationStageKey,
} from "./import-review-promotion-validation.types.js";

const PROMOTE_PREFLIGHT_VALIDATION_STAGES: ImportReviewPublishItemValidationStageKey[] = [
    "validate_candidate_state",
    "validate_geometry",
    "validate_required_fields",
    "validate_references",
    "validate_entity_specific_rules",
];

const BUILDING_CANDIDATE_TABLE = "import_review.building_candidates";

const CORE_TABLE = "core.core_map_buildings";

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

function classCodeExpr(alias: string): Prisma.Sql {
    const a = Prisma.raw(alias);
    return Prisma.sql`
        nullif(trim(coalesce(
            ${a}.review_overrides->>'class_code',
            ${a}.review_overrides->>'building_type',
            ${a}.class_code,
            ${a}.building_type,
            ${a}.normalized_data->>'class_code',
            ${a}.normalized_data->>'building_type',
            'yes'
        )), '')
    `;
}

function nameExpr(alias: string): Prisma.Sql {
    const a = Prisma.raw(alias);
    return Prisma.sql`
        nullif(trim(coalesce(
            ${a}.review_overrides->>'name',
            ${a}.review_overrides->>'canonical_name',
            ${a}.name,
            ${a}.canonical_name,
            ${a}.normalized_data->>'name',
            ''
        )), '')
    `;
}

function geomSourceExpr(alias: string, geomColumn = "candidate_geom"): Prisma.Sql {
    const a = Prisma.raw(alias);
    const geomCol = Prisma.raw(geomColumn);
    return Prisma.sql`
        CASE
            WHEN ${a}.review_overrides ? 'geom'
                 AND ${a}.review_overrides->'geom' IS NOT NULL
                 AND jsonb_typeof(${a}.review_overrides->'geom') = 'object'
            THEN ST_SetSRID(ST_GeomFromGeoJSON(${a}.review_overrides->'geom'), 4326)
            ELSE ${a}.${geomCol}
        END
    `;
}

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

function sourceRefsMergeExpr(alias: string, batchId: bigint): Prisma.Sql {
    const a = Prisma.raw(alias);
    return Prisma.sql`
        coalesce(${a}.source_refs, '{}'::jsonb)
        || jsonb_strip_nulls(jsonb_build_object(
            'review_candidate_id', ${a}.id::text,
            'review_batch_id', ${a}.review_batch_id::text,
            'source_snapshot_version', ${a}.source_snapshot_version,
            'local_staging_id', ${a}.local_staging_id::text,
            'publish_batch_id', ${batchId}::text
        ))
    `;
}

function normalizedDataMergeExpr(alias: string, batchId: bigint): Prisma.Sql {
    const a = Prisma.raw(alias);
    return Prisma.sql`
        coalesce(${a}.normalized_data, '{}'::jsonb)
        || coalesce(${a}.review_overrides, '{}'::jsonb)
        || jsonb_build_object(
            'promotion', jsonb_build_object(
                'publish_batch_id', ${batchId}::text,
                'promoted_at', to_jsonb(now())
            )
        )
    `;
}

export class ImportReviewPromotionPromoteRepository {
    private readonly placesRepo: ImportReviewPromotionPromotePlacesRepository;

    constructor(
        private readonly prisma: PrismaClient,
        private readonly validationRepo: ImportReviewPromotionValidationRepository
    ) {
        this.placesRepo = new ImportReviewPromotionPromotePlacesRepository(prisma);
    }

    async fetchBatchProgress(batchId: bigint): Promise<ImportReviewPublishBatchProgressRow | null> {
        return this.validationRepo.fetchBatchProgress(batchId);
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
        const out: Record<PromotablePublishEntityFamily, number> = {
            buildings: 0,
            places: 0,
        };
        for (const row of rows) {
            if (row.entity_family === "buildings" || row.entity_family === "places") {
                out[row.entity_family] = Number(row.count);
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
            const coreExists =
                item.entity_family === "places"
                    ? await this.placesRepo.checkPlaceCoreExists(item.target_id)
                    : (
                          await this.prisma.$queryRaw<{ id: bigint }[]>`
                              SELECT id FROM core.core_map_buildings
                              WHERE id = ${item.target_id}
                                AND coalesce(is_active, true) AND deleted_at IS NULL
                              LIMIT 1
                          `
                      ).length > 0;
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
            return this.insertBuilding(args.batchId, args.publishItemId, args.promotedBy);
        }

        if (item.publish_action === "update") {
            if (item.entity_family === "places") {
                return this.placesRepo.updatePlace(args.batchId, args.publishItemId, args.promotedBy);
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
                SELECT ${PROMOTE_PREP_ROW(Prisma.sql`
                    CASE
                        WHEN r.g_raw IS NULL THEN NULL::geometry(MultiPolygon, 4326)
                        WHEN ST_GeometryType(r.g_raw) = 'ST_Polygon'
                            THEN ST_Multi(r.g_raw)::geometry(MultiPolygon, 4326)
                        WHEN ST_GeometryType(r.g_raw) = 'ST_MultiPolygon'
                            THEN r.g_raw::geometry(MultiPolygon, 4326)
                        ELSE NULL::geometry(MultiPolygon, 4326)
                    END
                `)}
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
                centroid, area_m2, confidence_score, is_verified, is_active,
                created_at, updated_at, deleted_at
            )
            SELECT
                g.local_staging_id,
                nullif(trim(g.external_id), ''),
                ${nameExpr("g")},
                ${classCodeExpr("g")},
                ${normalizedDataMergeExpr("g", batchId)},
                ${sourceRefsMergeExpr("g", batchId)},
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
                coalesce(g.confidence_score, 80),
                false,
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
                SELECT ${PROMOTE_PREP_ROW(Prisma.sql`
                    CASE
                        WHEN r.g_raw IS NULL THEN NULL::geometry(MultiPolygon, 4326)
                        WHEN ST_GeometryType(r.g_raw) = 'ST_Polygon'
                            THEN ST_Multi(r.g_raw)::geometry(MultiPolygon, 4326)
                        WHEN ST_GeometryType(r.g_raw) = 'ST_MultiPolygon'
                            THEN r.g_raw::geometry(MultiPolygon, 4326)
                        ELSE NULL::geometry(MultiPolygon, 4326)
                    END
                `)}
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
                class_code = ${classCodeExpr("r")},
                normalized_data = ${normalizedDataMergeExpr("r", batchId)},
                source_refs = ${sourceRefsMergeExpr("r", batchId)},
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
                confidence_score = coalesce(r.confidence_score, c.confidence_score),
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
        if (args.entityFamily === "places") {
            await this.markPlaceCandidatePromoted(args);
            return;
        }
        await this.prisma.$executeRaw`
            UPDATE import_review.building_candidates
            SET promotion_status = 'promoted',
                promoted_core_id = ${args.promotedCoreId},
                promoted_at = now(),
                promoted_by = ${args.promotedBy},
                review_status = 'promoted',
                updated_at = now()
            WHERE id = ${args.reviewCandidateId}
        `;
    }

    async markPlaceCandidatePromoted(args: {
        reviewCandidateId: bigint;
        promotedCoreId: bigint;
        promotedBy: bigint | null;
    }): Promise<void> {
        await this.prisma.$executeRaw`
            UPDATE import_review.place_candidates
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
        if (entityFamily === "places") {
            await this.markPlaceCandidateFailed(reviewCandidateId);
            return;
        }
        await this.prisma.$executeRaw`
            UPDATE import_review.building_candidates
            SET promotion_status = 'failed',
                review_status = 'promotion_failed',
                updated_at = now()
            WHERE id = ${reviewCandidateId}
        `;
    }

    async markPlaceCandidateFailed(reviewCandidateId: bigint): Promise<void> {
        await this.prisma.$executeRaw`
            UPDATE import_review.place_candidates
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
        return {
            missing: Number(buildingRows[0]?.missing ?? 0n) + Number(placeRows[0]?.missing ?? 0n),
            invalid_geom:
                Number(buildingRows[0]?.invalid_geom ?? 0n) + Number(placeRows[0]?.invalid_geom ?? 0n),
            missing_names: Number(placeRows[0]?.missing_names ?? 0n),
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
        const bi = buildingCoreIssues[0] ?? { missing: 0n, inactive: 0n, lineage: 0n, geom: 0n };
        const pi = placeCoreIssues[0] ?? {
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
            ) AS missing_candidates
        `;

        const issues: ImportReviewPublishBatchVerifyResponse["issues"] = [];
        const missingCore = Number(bi.missing ?? 0n) + Number(pi.missing ?? 0n);
        const missingTarget = Number(ic.success_missing_target ?? 0n);
        const lineage = Number(bi.lineage ?? 0n) + Number(pi.lineage ?? 0n);
        const geom = Number(bi.geom ?? 0n) + Number(pi.geom ?? 0n);
        const missingNames = Number(pi.missing_names ?? 0n);
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
                code: "place_names_missing",
                message: `${missingNames} promoted place(s) missing core_place_names rows.`,
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
            core_rows_inactive: Number(bi.inactive ?? 0n) + Number(pi.inactive ?? 0n),
            candidates_promoted_missing_core_id: cand,
            lineage_warnings: lineage,
            geometry_warnings: geom,
            issues,
        };
    }
}
