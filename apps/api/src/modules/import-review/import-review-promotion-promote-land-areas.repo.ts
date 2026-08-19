import { Prisma } from "@prisma/client";

import type { PromotionDb } from "./import-review-promotion-db.js";

import { syncLandAreaFeatureNames } from "../../lib/entity-names/sync-primary-names.js";
import { deriveImportReviewNames, type ImportReviewNameCandidate } from "./import-review-name-fields.js";
import {
    buildVerificationMetadataTracking,
    coreVerificationInsertColumnsSql,
    coreVerificationInsertValuesSql,
    coreVerificationUpdateSetClauseSql,
    getCoreVerificationColumnsForEntity,
} from "./import-review-promotion-core-verification.js";
import type { PromoteItemResult } from "./import-review-promotion-promote.types.js";
import {
    PROMOTE_LANDUSE_SRC_COLUMNS,
    landAreaFixedGeomExpr,
    landAreaRawGeomExpr,
    landAreaReadyFieldExprs,
} from "./import-review-promotion-promote-land-areas-sql.js";

export const LANDUSE_CANDIDATE_TABLE = "import_review.land_area_candidates";
export const CORE_LAND_AREAS_TABLE = "core.core_land_areas";

const LAND_AREA_VERIFICATION_COLUMNS = getCoreVerificationColumnsForEntity("land_areas");

type LandAreaCandidateNameRow = {
    canonical_name: string | null;
    normalized_data: unknown;
    external_id: string | null;
    class_code: string | null;
    name: string | null;
    name_mm: string | null;
    name_en: string | null;
};

export class ImportReviewPromotionPromoteLandAreasRepository {
    constructor(private readonly prisma: PromotionDb) {}

    async checkLandAreaCoreExists(targetId: bigint): Promise<boolean> {
        const rows = await this.prisma.$queryRaw<{ id: bigint }[]>`
            SELECT id FROM core.core_land_areas
            WHERE id = ${targetId}
              AND coalesce(is_active, true)
              AND deleted_at IS NULL
            LIMIT 1
        `;
        return rows.length > 0;
    }

    async insertLandArea(batchId: bigint, publishItemId: bigint): Promise<PromoteItemResult> {
        try {
            return await this.insertLandAreaTx(this.prisma, batchId, publishItemId);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return {
                publish_item_id: publishItemId,
                outcome: "failed",
                target_id: null,
                error_message: `Land area promotion failed: ${message}`,
                before_data: null,
                after_data: null,
            };
        }
    }

    async insertLandAreaTx(
        tx: PromotionDb,
        batchId: bigint,
        publishItemId: bigint
    ): Promise<PromoteItemResult> {
                const rows = await tx.$queryRaw<
                    {
                        id: bigint;
                        external_id: string | null;
                        name: string | null;
                        land_area_class_id: bigint;
                        detail_level: string;
                        crop_code: string | null;
                        candidate_id: bigint;
                    }[]
                >`
                    WITH src AS (
                        SELECT ${PROMOTE_LANDUSE_SRC_COLUMNS}
                        FROM system.system_publish_items AS spi
                        INNER JOIN import_review.land_area_candidates AS lu
                            ON lu.id = spi.review_candidate_id
                           AND spi.review_candidate_table = ${LANDUSE_CANDIDATE_TABLE}
                        WHERE spi.id = ${publishItemId}
                          AND spi.publish_batch_id = ${batchId}
                    ),
                    raw_geom AS (
                        SELECT s.*, ${landAreaRawGeomExpr("s")} AS g_raw FROM src AS s
                    ),
                    prep AS (
                        SELECT r.*, ${landAreaFixedGeomExpr("r")} AS geom FROM raw_geom AS r
                    ),
                    ready AS (
                        SELECT
                            p.*,
                            ${landAreaReadyFieldExprs(batchId, "p")}
                        FROM prep AS p
                    ),
                    valid AS (
                        SELECT r.*
                        FROM ready AS r
                        WHERE r.geom IS NOT NULL
                          AND ST_IsValid(r.geom)
                          AND NOT ST_IsEmpty(r.geom)
                          AND ST_SRID(r.geom) = 4326
                          AND r.land_area_class_id_ready IS NOT NULL
                          AND r.class_code_ready IS NOT NULL
                          AND r.external_id_ready IS NOT NULL
                          AND r.confidence_score_ready >= 0
                          AND r.confidence_score_ready <= 100
                    ),
                    guard AS (
                        SELECT v.*
                        FROM valid AS v
                        WHERE NOT EXISTS (
                            SELECT 1 FROM core.core_land_areas AS c
                            WHERE coalesce(c.is_active, true)
                              AND c.deleted_at IS NULL
                              AND c.external_id = v.external_id_ready
                        )
                    )
                    INSERT INTO core.core_land_areas (
                        external_id,
                        land_area_class_id, admin_area_id,
                        geom, centroid, area_m2,
                        confidence_score, manual_override, source_tags,
                        normalized_data, source_refs,
                        crop_code, detail_level,
                        is_active${coreVerificationInsertColumnsSql(LAND_AREA_VERIFICATION_COLUMNS)},
                        created_at, updated_at, deleted_at
                    )
                    SELECT
                        g.external_id_ready,
                        g.land_area_class_id_ready,
                        g.admin_area_id_ready,
                        g.geom,
                        g.centroid_ready,
                        g.area_m2_ready,
                        g.confidence_score_ready,
                        false,
                        g.source_tags_ready,
                        g.merged_normalized_data,
                        g.merged_source_refs,
                        g.crop_code_ready,
                        g.detail_level_ready,
                        true${coreVerificationInsertValuesSql(LAND_AREA_VERIFICATION_COLUMNS)},
                        now(),
                        now(),
                        NULL::timestamptz
                    FROM guard AS g
                    RETURNING id, external_id, NULL::text AS name,
                        land_area_class_id, detail_level, crop_code
                `;

                if (rows.length === 0) {
                    const reason = await this.explainInsertBlocked(tx, batchId, publishItemId);
                    return {
                        publish_item_id: publishItemId,
                        outcome: "failed",
                        target_id: null,
                        error_message: reason,
                        before_data: null,
                        after_data: null,
                    };
                }

                const row = rows[0]!;
                const classRows = await tx.$queryRaw<{ code: string }[]>`
                    SELECT code FROM ref.ref_land_area_classes WHERE id = ${row.land_area_class_id} LIMIT 1
                `;
                const names = await this.loadCandidateNames(tx, publishItemId);
                const derived = deriveImportReviewNames(this.toNameCandidate(names));
                const legacyName = derived.name_en ?? derived.name_mm ?? derived.name_und ?? null;

                await syncLandAreaFeatureNames(tx, row.id, {
                    name_mm: derived.name_mm,
                    name_en: derived.name_en,
                    name_und: derived.name_und,
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
                        name: legacyName,
                        class_code: classRows[0]?.code ?? null,
                        land_area_class_id: row.land_area_class_id.toString(),
                        detail_level: row.detail_level,
                        crop_code: row.crop_code,
                        entity_family: "land_areas",
                    },
                    ...buildVerificationMetadataTracking({
                        outcome: "inserted",
                        beforeData: null,
                        entityKey: "land_areas",
                    }),
                };
    }

    async loadLandAreaUpdateBeforeData(
        tx: PromotionDb,
        publishItemId: bigint
    ): Promise<unknown | null> {
        const beforeRows = await tx.$queryRaw<{ row_json: unknown }[]>`
            SELECT to_jsonb(c) AS row_json
            FROM system.system_publish_items AS spi
            INNER JOIN import_review.land_area_candidates AS lu
                ON lu.id = spi.review_candidate_id
               AND spi.review_candidate_table = ${LANDUSE_CANDIDATE_TABLE}
            INNER JOIN core.core_land_areas AS c ON c.id = lu.matched_core_id
            WHERE spi.id = ${publishItemId}
              AND coalesce(c.is_active, true)
              AND c.deleted_at IS NULL
            LIMIT 1
        `;
        return beforeRows[0]?.row_json ?? null;
    }

    async updateLandArea(batchId: bigint, publishItemId: bigint): Promise<PromoteItemResult> {
        const beforeData = await this.loadLandAreaUpdateBeforeData(this.prisma, publishItemId);
        if (!beforeData) {
            return {
                publish_item_id: publishItemId,
                outcome: "failed",
                target_id: null,
                error_message: "Update blocked: matched_core_id missing or core row inactive.",
                before_data: null,
                after_data: null,
            };
        }

        try {
            return await this.updateLandAreaTx(this.prisma, batchId, publishItemId, beforeData);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return {
                publish_item_id: publishItemId,
                outcome: "failed",
                target_id: null,
                error_message: `Land area promotion failed: ${message}`,
                before_data: beforeData,
                after_data: null,
            };
        }
    }

    async updateLandAreaTx(
        tx: PromotionDb,
        batchId: bigint,
        publishItemId: bigint,
        beforeData: unknown
    ): Promise<PromoteItemResult> {
                const rows = await tx.$queryRaw<
                    {
                        id: bigint;
                        external_id: string | null;
                        land_area_class_id: bigint;
                        detail_level: string;
                        crop_code: string | null;
                    }[]
                >`
                    WITH src AS (
                        SELECT ${PROMOTE_LANDUSE_SRC_COLUMNS}
                        FROM system.system_publish_items AS spi
                        INNER JOIN import_review.land_area_candidates AS lu
                            ON lu.id = spi.review_candidate_id
                           AND spi.review_candidate_table = ${LANDUSE_CANDIDATE_TABLE}
                        WHERE spi.id = ${publishItemId}
                          AND spi.publish_batch_id = ${batchId}
                          AND lu.matched_core_id IS NOT NULL
                    ),
                    raw_geom AS (
                        SELECT s.*, ${landAreaRawGeomExpr("s")} AS g_raw FROM src AS s
                    ),
                    prep AS (
                        SELECT r.*, ${landAreaFixedGeomExpr("r")} AS geom FROM raw_geom AS r
                    ),
                    ready AS (
                        SELECT
                            p.*,
                            ${landAreaReadyFieldExprs(batchId, "p")}
                        FROM prep AS p
                    ),
                    valid AS (
                        SELECT r.*
                        FROM ready AS r
                        WHERE r.geom IS NOT NULL
                          AND ST_IsValid(r.geom)
                          AND NOT ST_IsEmpty(r.geom)
                          AND r.land_area_class_id_ready IS NOT NULL
                          AND r.class_code_ready IS NOT NULL
                          AND r.external_id_ready IS NOT NULL
                    )
                    UPDATE core.core_land_areas AS c
                    SET
                        external_id = v.external_id_ready,
                        land_area_class_id = v.land_area_class_id_ready,
                        admin_area_id = v.admin_area_id_ready,
                        geom = v.geom,
                        centroid = v.centroid_ready,
                        area_m2 = v.area_m2_ready,
                        confidence_score = v.confidence_score_ready,
                        manual_override = false,
                        source_tags = v.source_tags_ready,
                        normalized_data = v.merged_normalized_data,
                        source_refs = v.merged_source_refs,
                        crop_code = v.crop_code_ready,
                        detail_level = v.detail_level_ready,
                        is_active = true,
                        deleted_at = NULL,
                        updated_at = now()${coreVerificationUpdateSetClauseSql("c", LAND_AREA_VERIFICATION_COLUMNS)}
                    FROM valid AS v
                    WHERE c.id = v.matched_core_id
                      AND coalesce(c.is_active, true)
                      AND c.deleted_at IS NULL
                    RETURNING c.id, c.external_id, NULL::text AS name, c.land_area_class_id,
                        c.detail_level, c.crop_code
                `;

                if (rows.length === 0) {
                    return {
                        publish_item_id: publishItemId,
                        outcome: "failed",
                        target_id: null,
                        error_message: "Update failed: geometry invalid, missing land_area_class_id, or target not updatable.",
                        before_data: beforeData,
                        after_data: null,
                    };
                }

                const row = rows[0]!;
                const classRows = await tx.$queryRaw<{ code: string }[]>`
                    SELECT code FROM ref.ref_land_area_classes WHERE id = ${row.land_area_class_id} LIMIT 1
                `;
                const names = await this.loadCandidateNames(tx, publishItemId);
                const derived = deriveImportReviewNames(this.toNameCandidate(names));
                const legacyName = derived.name_en ?? derived.name_mm ?? derived.name_und ?? null;

                await syncLandAreaFeatureNames(tx, row.id, {
                    name_mm: derived.name_mm,
                    name_en: derived.name_en,
                    name_und: derived.name_und,
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
                        name: legacyName,
                        class_code: classRows[0]?.code ?? null,
                        land_area_class_id: row.land_area_class_id.toString(),
                        detail_level: row.detail_level,
                        crop_code: row.crop_code,
                        entity_family: "land_areas",
                    },
                    ...buildVerificationMetadataTracking({
                        outcome: "updated",
                        beforeData,
                        entityKey: "land_areas",
                    }),
                };
    }

    private async loadCandidateNames(
        tx: PromotionDb,
        publishItemId: bigint
    ): Promise<LandAreaCandidateNameRow> {
        const rows = await tx.$queryRaw<LandAreaCandidateNameRow[]>`
            SELECT
                lu.canonical_name,
                lu.normalized_data,
                lu.external_id,
                lu.class_code,
                lu.name,
                lu.name_mm,
                lu.name_en
            FROM system.system_publish_items AS spi
            INNER JOIN import_review.land_area_candidates AS lu
                ON lu.id = spi.review_candidate_id
            WHERE spi.id = ${publishItemId}
            LIMIT 1
        `;
        return (
            rows[0] ?? {
                canonical_name: null,
                normalized_data: {},
                external_id: null,
                class_code: null,
                name: null,
                name_mm: null,
                name_en: null,
            }
        );
    }

    private async explainInsertBlocked(
        tx: PromotionDb,
        batchId: bigint,
        publishItemId: bigint
    ): Promise<string> {
        const rows = await tx.$queryRaw<{ reason: string }[]>`
            WITH src AS (
                SELECT ${PROMOTE_LANDUSE_SRC_COLUMNS}
                FROM system.system_publish_items AS spi
                INNER JOIN import_review.land_area_candidates AS lu
                    ON lu.id = spi.review_candidate_id
                   AND spi.review_candidate_table = ${LANDUSE_CANDIDATE_TABLE}
                WHERE spi.id = ${publishItemId}
                  AND spi.publish_batch_id = ${batchId}
            ),
            raw_geom AS (
                SELECT s.*, ${landAreaRawGeomExpr("s")} AS g_raw FROM src AS s
            ),
            prep AS (
                SELECT r.*, ${landAreaFixedGeomExpr("r")} AS geom FROM raw_geom AS r
            ),
            ready AS (
                SELECT
                    p.*,
                    ${landAreaReadyFieldExprs(batchId, "p")}
                FROM prep AS p
            )
            SELECT CASE
                WHEN NOT EXISTS (SELECT 1 FROM ready) THEN
                    'Land area candidate not found for publish item.'
                WHEN (SELECT g_raw IS NULL FROM raw_geom LIMIT 1) THEN
                    'Missing polygon geometry (geom).'
                WHEN (SELECT geom IS NULL FROM prep LIMIT 1) THEN
                    'Geometry must be Polygon or MultiPolygon (or safely converted to MultiPolygon).'
                WHEN (SELECT geom IS NOT NULL AND NOT ST_IsValid(geom) FROM prep LIMIT 1) THEN
                    'Geometry could not be made valid.'
                WHEN (SELECT land_area_class_id_ready IS NULL FROM ready LIMIT 1) THEN
                    'land_area_class_id is required and must reference ref.ref_land_area_classes.'
                WHEN (SELECT class_code_ready IS NULL FROM ready LIMIT 1) THEN
                    'class_code could not be resolved for land area.'
                WHEN (SELECT external_id_ready IS NULL FROM ready LIMIT 1) THEN
                    'external_id is required.'
                WHEN EXISTS (
                    SELECT 1 FROM ready AS r
                    INNER JOIN core.core_land_areas AS c
                        ON coalesce(c.is_active, true) AND c.deleted_at IS NULL
                    WHERE c.external_id = r.external_id_ready
                ) THEN
                    'Duplicate core.core_land_areas row with same external_id.'
                ELSE
                    'Insert blocked by promotion guard.'
            END AS reason
        `;
        return rows[0]?.reason ?? "Insert blocked: duplicate core row, invalid geometry, or missing required fields.";
    }

    private toNameCandidate(row: LandAreaCandidateNameRow): ImportReviewNameCandidate {
        const baseNd =
            row.normalized_data && typeof row.normalized_data === "object" && !Array.isArray(row.normalized_data)
                ? { ...(row.normalized_data as Record<string, unknown>) }
                : {};
        if (row.name_mm && baseNd.name_mm == null) {
            baseNd.name_mm = row.name_mm;
        }
        if (row.name_en && baseNd.name_en == null) {
            baseNd.name_en = row.name_en;
        }
        return {
            canonical_name: row.canonical_name,
            normalized_data: baseNd,
            external_id: row.external_id,
            class_code: row.class_code,
            name: row.name,
            name_mm: row.name_mm,
            name_en: row.name_en,
        };
    }
}
