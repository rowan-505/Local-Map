import { Prisma, type PrismaClient, type Prisma as PrismaNamespace } from "@prisma/client";

import { syncLanduseFeatureNames } from "../../lib/entity-names/sync-primary-names.js";
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
    landuseFixedGeomExpr,
    landuseRawGeomExpr,
    landuseReadyFieldExprs,
} from "./import-review-promotion-promote-landuse-sql.js";

export const LANDUSE_CANDIDATE_TABLE = "import_review.landuse_candidates";
export const CORE_LANDUSE_TABLE = "core.core_map_landuse";

const LANDUSE_VERIFICATION_COLUMNS = getCoreVerificationColumnsForEntity("landuse");

type LanduseCandidateNameRow = {
    review_overrides: unknown;
    canonical_name: string | null;
    normalized_data: unknown;
    external_id: string | null;
    class_code: string | null;
    name: string | null;
    name_mm: string | null;
    name_en: string | null;
};

export class ImportReviewPromotionPromoteLanduseRepository {
    constructor(private readonly prisma: PrismaClient) {}

    async checkLanduseCoreExists(targetId: bigint): Promise<boolean> {
        const rows = await this.prisma.$queryRaw<{ id: bigint }[]>`
            SELECT id FROM core.core_map_landuse
            WHERE id = ${targetId}
              AND coalesce(is_active, true)
              AND deleted_at IS NULL
            LIMIT 1
        `;
        return rows.length > 0;
    }

    async insertLanduse(batchId: bigint, publishItemId: bigint): Promise<PromoteItemResult> {
        try {
            return await this.prisma.$transaction(async (tx) => {
                const rows = await tx.$queryRaw<
                    {
                        id: bigint;
                        external_id: string | null;
                        source_staging_id: bigint | null;
                        name: string | null;
                        class_code: string | null;
                        landuse_class_id: bigint;
                        detail_level: string;
                        crop_code: string | null;
                        candidate_id: bigint;
                    }[]
                >`
                    WITH src AS (
                        SELECT ${PROMOTE_LANDUSE_SRC_COLUMNS}
                        FROM system.system_publish_items AS spi
                        INNER JOIN import_review.landuse_candidates AS lu
                            ON lu.id = spi.review_candidate_id
                           AND spi.review_candidate_table = ${LANDUSE_CANDIDATE_TABLE}
                        WHERE spi.id = ${publishItemId}
                          AND spi.publish_batch_id = ${batchId}
                    ),
                    raw_geom AS (
                        SELECT s.*, ${landuseRawGeomExpr("s")} AS g_raw FROM src AS s
                    ),
                    prep AS (
                        SELECT r.*, ${landuseFixedGeomExpr("r")} AS geom FROM raw_geom AS r
                    ),
                    ready AS (
                        SELECT
                            p.*,
                            ${landuseReadyFieldExprs(batchId, "p")}
                        FROM prep AS p
                    ),
                    valid AS (
                        SELECT r.*
                        FROM ready AS r
                        WHERE r.geom IS NOT NULL
                          AND ST_IsValid(r.geom)
                          AND NOT ST_IsEmpty(r.geom)
                          AND ST_SRID(r.geom) = 4326
                          AND r.landuse_class_id_ready IS NOT NULL
                          AND r.class_code_ready IS NOT NULL
                          AND r.external_id_ready IS NOT NULL
                          AND r.confidence_score_ready >= 0
                          AND r.confidence_score_ready <= 100
                    ),
                    guard AS (
                        SELECT v.*
                        FROM valid AS v
                        WHERE NOT EXISTS (
                            SELECT 1 FROM core.core_map_landuse AS c
                            WHERE coalesce(c.is_active, true)
                              AND c.deleted_at IS NULL
                              AND (
                                  c.external_id = v.external_id_ready
                                  OR (v.local_staging_id IS NOT NULL AND c.source_staging_id = v.local_staging_id)
                              )
                        )
                    )
                    INSERT INTO core.core_map_landuse (
                        source_staging_id, external_id, name, class_code,
                        landuse_class_id, admin_area_id,
                        geom, centroid, area_m2,
                        confidence_score, manual_override, source_tags,
                        normalized_data, source_refs,
                        crop_code, detail_level,
                        is_active${coreVerificationInsertColumnsSql(LANDUSE_VERIFICATION_COLUMNS)},
                        created_at, updated_at, deleted_at
                    )
                    SELECT
                        g.local_staging_id,
                        g.external_id_ready,
                        NULL::text,
                        g.class_code_ready,
                        g.landuse_class_id_ready,
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
                        true${coreVerificationInsertValuesSql(LANDUSE_VERIFICATION_COLUMNS)},
                        now(),
                        now(),
                        NULL::timestamptz
                    FROM guard AS g
                    RETURNING id, external_id, source_staging_id, name, class_code,
                        landuse_class_id, detail_level, crop_code
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
                const names = await this.loadCandidateNames(tx, publishItemId);
                const derived = deriveImportReviewNames(this.toNameCandidate(names));
                const legacyName = derived.name_en ?? derived.name_mm ?? derived.name_und ?? null;

                if (legacyName) {
                    await tx.$executeRaw`
                        UPDATE core.core_map_landuse
                        SET name = ${legacyName}, updated_at = now()
                        WHERE id = ${row.id}
                    `;
                }

                await syncLanduseFeatureNames(tx, row.id, {
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
                        source_staging_id: row.source_staging_id?.toString() ?? null,
                        name: legacyName,
                        class_code: row.class_code,
                        landuse_class_id: row.landuse_class_id.toString(),
                        detail_level: row.detail_level,
                        crop_code: row.crop_code,
                        entity_family: "landuse",
                    },
                    ...buildVerificationMetadataTracking({
                        outcome: "inserted",
                        beforeData: null,
                        entityKey: "landuse",
                    }),
                };
            });
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return {
                publish_item_id: publishItemId,
                outcome: "failed",
                target_id: null,
                error_message: `Landuse promotion failed: ${message}`,
                before_data: null,
                after_data: null,
            };
        }
    }

    async updateLanduse(batchId: bigint, publishItemId: bigint): Promise<PromoteItemResult> {
        const beforeRows = await this.prisma.$queryRaw<{ row_json: unknown }[]>`
            SELECT to_jsonb(c) AS row_json
            FROM system.system_publish_items AS spi
            INNER JOIN import_review.landuse_candidates AS lu
                ON lu.id = spi.review_candidate_id
               AND spi.review_candidate_table = ${LANDUSE_CANDIDATE_TABLE}
            INNER JOIN core.core_map_landuse AS c ON c.id = lu.matched_core_id
            WHERE spi.id = ${publishItemId}
              AND coalesce(c.is_active, true)
              AND c.deleted_at IS NULL
            LIMIT 1
        `;
        const beforeData = beforeRows[0]?.row_json ?? null;
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
            return await this.prisma.$transaction(async (tx) => {
                const rows = await tx.$queryRaw<
                    {
                        id: bigint;
                        external_id: string | null;
                        class_code: string;
                        landuse_class_id: bigint;
                        detail_level: string;
                        crop_code: string | null;
                    }[]
                >`
                    WITH src AS (
                        SELECT ${PROMOTE_LANDUSE_SRC_COLUMNS}
                        FROM system.system_publish_items AS spi
                        INNER JOIN import_review.landuse_candidates AS lu
                            ON lu.id = spi.review_candidate_id
                           AND spi.review_candidate_table = ${LANDUSE_CANDIDATE_TABLE}
                        WHERE spi.id = ${publishItemId}
                          AND spi.publish_batch_id = ${batchId}
                          AND lu.matched_core_id IS NOT NULL
                    ),
                    raw_geom AS (
                        SELECT s.*, ${landuseRawGeomExpr("s")} AS g_raw FROM src AS s
                    ),
                    prep AS (
                        SELECT r.*, ${landuseFixedGeomExpr("r")} AS geom FROM raw_geom AS r
                    ),
                    ready AS (
                        SELECT
                            p.*,
                            ${landuseReadyFieldExprs(batchId, "p")}
                        FROM prep AS p
                    ),
                    valid AS (
                        SELECT r.*
                        FROM ready AS r
                        WHERE r.geom IS NOT NULL
                          AND ST_IsValid(r.geom)
                          AND NOT ST_IsEmpty(r.geom)
                          AND r.landuse_class_id_ready IS NOT NULL
                          AND r.class_code_ready IS NOT NULL
                          AND r.external_id_ready IS NOT NULL
                    )
                    UPDATE core.core_map_landuse AS c
                    SET
                        source_staging_id = v.local_staging_id,
                        external_id = v.external_id_ready,
                        class_code = v.class_code_ready,
                        landuse_class_id = v.landuse_class_id_ready,
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
                        updated_at = now()${coreVerificationUpdateSetClauseSql("c", LANDUSE_VERIFICATION_COLUMNS)}
                    FROM valid AS v
                    WHERE c.id = v.matched_core_id
                      AND coalesce(c.is_active, true)
                      AND c.deleted_at IS NULL
                    RETURNING c.id, c.external_id, c.name, c.class_code, c.landuse_class_id,
                        c.detail_level, c.crop_code
                `;

                if (rows.length === 0) {
                    return {
                        publish_item_id: publishItemId,
                        outcome: "failed",
                        target_id: null,
                        error_message: "Update failed: geometry invalid, missing landuse_class_id, or target not updatable.",
                        before_data: beforeData,
                        after_data: null,
                    };
                }

                const row = rows[0]!;
                const names = await this.loadCandidateNames(tx, publishItemId);
                const derived = deriveImportReviewNames(this.toNameCandidate(names));
                const legacyName = derived.name_en ?? derived.name_mm ?? derived.name_und ?? null;

                await tx.$executeRaw`
                    UPDATE core.core_map_landuse
                    SET name = ${legacyName}, updated_at = now()
                    WHERE id = ${row.id}
                `;

                await syncLanduseFeatureNames(tx, row.id, {
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
                        class_code: row.class_code,
                        landuse_class_id: row.landuse_class_id.toString(),
                        detail_level: row.detail_level,
                        crop_code: row.crop_code,
                        entity_family: "landuse",
                    },
                    ...buildVerificationMetadataTracking({
                        outcome: "updated",
                        beforeData,
                        entityKey: "landuse",
                    }),
                };
            });
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return {
                publish_item_id: publishItemId,
                outcome: "failed",
                target_id: null,
                error_message: `Landuse promotion failed: ${message}`,
                before_data: beforeData,
                after_data: null,
            };
        }
    }

    private async loadCandidateNames(
        tx: PrismaNamespace.TransactionClient,
        publishItemId: bigint
    ): Promise<LanduseCandidateNameRow> {
        const rows = await tx.$queryRaw<LanduseCandidateNameRow[]>`
            SELECT
                lu.review_overrides,
                lu.canonical_name,
                lu.normalized_data,
                lu.external_id,
                lu.class_code,
                lu.name,
                lu.name_mm,
                lu.name_en
            FROM system.system_publish_items AS spi
            INNER JOIN import_review.landuse_candidates AS lu
                ON lu.id = spi.review_candidate_id
            WHERE spi.id = ${publishItemId}
            LIMIT 1
        `;
        return (
            rows[0] ?? {
                review_overrides: {},
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
        tx: PrismaNamespace.TransactionClient,
        batchId: bigint,
        publishItemId: bigint
    ): Promise<string> {
        const rows = await tx.$queryRaw<{ reason: string }[]>`
            WITH src AS (
                SELECT ${PROMOTE_LANDUSE_SRC_COLUMNS}
                FROM system.system_publish_items AS spi
                INNER JOIN import_review.landuse_candidates AS lu
                    ON lu.id = spi.review_candidate_id
                   AND spi.review_candidate_table = ${LANDUSE_CANDIDATE_TABLE}
                WHERE spi.id = ${publishItemId}
                  AND spi.publish_batch_id = ${batchId}
            ),
            raw_geom AS (
                SELECT s.*, ${landuseRawGeomExpr("s")} AS g_raw FROM src AS s
            ),
            prep AS (
                SELECT r.*, ${landuseFixedGeomExpr("r")} AS geom FROM raw_geom AS r
            ),
            ready AS (
                SELECT
                    p.*,
                    ${landuseReadyFieldExprs(batchId, "p")}
                FROM prep AS p
            )
            SELECT CASE
                WHEN NOT EXISTS (SELECT 1 FROM ready) THEN
                    'Landuse candidate not found for publish item.'
                WHEN (SELECT g_raw IS NULL FROM raw_geom LIMIT 1) THEN
                    'Missing polygon geometry (geom).'
                WHEN (SELECT geom IS NULL FROM prep LIMIT 1) THEN
                    'Geometry must be Polygon or MultiPolygon (or safely converted to MultiPolygon).'
                WHEN (SELECT geom IS NOT NULL AND NOT ST_IsValid(geom) FROM prep LIMIT 1) THEN
                    'Geometry could not be made valid.'
                WHEN (SELECT landuse_class_id_ready IS NULL FROM ready LIMIT 1) THEN
                    'landuse_class_id is required and must reference ref.ref_landuse_classes.'
                WHEN (SELECT class_code_ready IS NULL FROM ready LIMIT 1) THEN
                    'class_code could not be resolved for landuse.'
                WHEN (SELECT external_id_ready IS NULL FROM ready LIMIT 1) THEN
                    'external_id or staging lineage is required.'
                WHEN EXISTS (
                    SELECT 1 FROM ready AS r
                    INNER JOIN core.core_map_landuse AS c
                        ON coalesce(c.is_active, true) AND c.deleted_at IS NULL
                    WHERE c.external_id = r.external_id_ready
                       OR (r.local_staging_id IS NOT NULL AND c.source_staging_id = r.local_staging_id)
                ) THEN
                    'Duplicate core.core_map_landuse row with same external_id or source_staging_id.'
                ELSE
                    'Insert blocked by promotion guard.'
            END AS reason
        `;
        return rows[0]?.reason ?? "Insert blocked: duplicate core row, invalid geometry, or missing required fields.";
    }

    private toNameCandidate(row: LanduseCandidateNameRow): ImportReviewNameCandidate {
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
            review_overrides: row.review_overrides,
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
