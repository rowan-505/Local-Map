import { Prisma } from "@prisma/client";

import type { PromotionDb } from "./import-review-promotion-db.js";
import { syncWaterFeatureNames } from "../../lib/entity-names/sync-primary-names.js";
import { deriveImportReviewNames, type ImportReviewNameCandidate } from "./import-review-name-fields.js";

import type { PromotablePublishEntityFamily } from "./import-review-promotion-config.js";
import {
    buildVerificationMetadataTracking,
    coreVerificationInsertColumnsSql,
    coreVerificationInsertValuesSql,
    coreVerificationUpdateSetClauseSql,
    getCoreVerificationColumnsForEntity,
    type CoreEntityVerificationKey,
} from "./import-review-promotion-core-verification.js";
import type { PromoteItemResult } from "./import-review-promotion-promote.types.js";
import {
    geomSourceExpr,
    lineToMultiLineStringSql,
    mapCandidateSrcColumns,
    mapPrepRow,
    mapReadyRow,
    normalizedDataMergeExpr,
    polygonToMultiPolygonSql,
    sourceRefsMergeExpr,
} from "./import-review-promotion-promote-sql.js";
import {
    promotionTypedExternalIdExpr,
    promotionTypedWaterClassCodeExpr,
    promotionTypedWaterClassIdExpr,
} from "./import-review-promotion-typed-promote-sql.js";

const WATER_LINE_CANDIDATE_TABLE = "import_review.water_line_candidates";
const WATER_POLYGON_CANDIDATE_TABLE = "import_review.water_polygon_candidates";

const CORE_WATER_LINES_TABLE = "core.core_water_lines";
const CORE_WATER_POLYGONS_TABLE = "core.core_water_polygons";

type MapEntityFamily = "water_lines" | "water_polygons";

type MapEntityConfig = {
    entityFamily: MapEntityFamily;
    entityKey: CoreEntityVerificationKey;
    candidateTable: string;
    candidateAlias: string;
    coreTable: string;
    geomKind: "polygon" | "line";
    classCodeFallback?: string;
};

const MAP_ENTITY_CONFIG: Record<MapEntityFamily, MapEntityConfig> = {
    water_lines: {
        entityFamily: "water_lines",
        entityKey: "water_lines",
        candidateTable: WATER_LINE_CANDIDATE_TABLE,
        candidateAlias: "wl",
        coreTable: CORE_WATER_LINES_TABLE,
        geomKind: "line",
        classCodeFallback: "unknown",
    },
    water_polygons: {
        entityFamily: "water_polygons",
        entityKey: "water_polygons",
        candidateTable: WATER_POLYGON_CANDIDATE_TABLE,
        candidateAlias: "wp",
        coreTable: CORE_WATER_POLYGONS_TABLE,
        geomKind: "polygon",
        classCodeFallback: "unknown",
    },
};

function geomCaseSql(config: MapEntityConfig): Prisma.Sql {
    return config.geomKind === "line"
        ? lineToMultiLineStringSql("r")
        : polygonToMultiPolygonSql("r");
}

export class ImportReviewPromotionPromoteMapRepository {
    constructor(private readonly prisma: PromotionDb) {}

    private async syncCandidateNames(
        tx: PromotionDb,
        config: MapEntityConfig,
        publishItemId: bigint,
        entityId: bigint
    ): Promise<string | null> {
        const rows = await tx.$queryRaw<ImportReviewNameCandidate[]>(Prisma.sql`
            SELECT c.canonical_name, c.normalized_data, c.external_id, c.class_code,
                   c.name, c.name_mm, c.name_en
            FROM system.system_publish_items AS spi
            JOIN ${Prisma.raw(config.candidateTable)} AS c ON c.id = spi.review_candidate_id
            WHERE spi.id = ${publishItemId}
            LIMIT 1
        `);
        const derived = deriveImportReviewNames(rows[0] ?? {});
        await syncWaterFeatureNames(tx, config.entityFamily, entityId, {
            name_mm: derived.name_mm,
            name_en: derived.name_en,
            name_und: derived.name_und,
        });
        return derived.name_en ?? derived.name_mm ?? derived.name_und ?? null;
    }

    async checkMapCoreExists(entityFamily: MapEntityFamily, targetId: bigint): Promise<boolean> {
        const config = MAP_ENTITY_CONFIG[entityFamily];
        const rows = await this.prisma.$queryRaw<{ id: bigint }[]>`
            SELECT id FROM ${Prisma.raw(config.coreTable)} AS c
            WHERE c.id = ${targetId}
              AND coalesce(c.is_active, true)
            LIMIT 1
        `;
        return rows.length > 0;
    }

    async insertMapEntity(
        entityFamily: MapEntityFamily,
        batchId: bigint,
        publishItemId: bigint
    ): Promise<PromoteItemResult> {
        return this.insertMapEntityTx(this.prisma, entityFamily, batchId, publishItemId);
    }

    async insertMapEntityTx(
        tx: PromotionDb,
        entityFamily: MapEntityFamily,
        batchId: bigint,
        publishItemId: bigint
    ): Promise<PromoteItemResult> {
        const config = MAP_ENTITY_CONFIG[entityFamily];
        const alias = config.candidateAlias;
        const verificationColumns = getCoreVerificationColumnsForEntity(config.entityKey);
        const srcColumns = mapCandidateSrcColumns(alias, config.candidateTable);

        const rows = await tx.$queryRaw<
            {
                id: bigint;
                external_id: string | null;
                name: string | null;
                water_class_id: bigint;
            }[]
        >`
            WITH src AS (
                SELECT ${srcColumns}
                FROM system.system_publish_items AS spi
                INNER JOIN ${Prisma.raw(config.candidateTable)} AS ${Prisma.raw(alias)}
                    ON ${Prisma.raw(alias)}.id = spi.review_candidate_id
                   AND spi.review_candidate_table = ${config.candidateTable}
                WHERE spi.id = ${publishItemId}
                  AND spi.publish_batch_id = ${batchId}
            ),
            raw_geom AS (
                SELECT s.*, ${geomSourceExpr("s", "candidate_geom")} AS g_raw FROM src AS s
            ),
            prep AS (
                SELECT ${mapPrepRow(geomCaseSql(config))}
                FROM raw_geom AS r
            ),
            ready AS (
                SELECT ${mapReadyRow("p")}
                FROM prep AS p
                WHERE p.geom IS NOT NULL
                  AND ST_IsValid(p.geom)
                  AND NOT ST_IsEmpty(p.geom)
                  AND ST_SRID(p.geom) = 4326
            ),
            resolved AS (
                SELECT
                    r.*,
                    ${promotionTypedExternalIdExpr("r")} AS resolved_external_id,
                    ${promotionTypedWaterClassIdExpr("r")} AS resolved_water_class_id,
                    ${promotionTypedWaterClassCodeExpr("r")} AS resolved_class_code
                FROM ready AS r
            ),
            guard AS (
                SELECT g.*
                FROM resolved AS g
                WHERE g.resolved_external_id IS NOT NULL
                  AND g.resolved_water_class_id IS NOT NULL
                  AND g.resolved_class_code IS NOT NULL
                  AND NOT EXISTS (
                      SELECT 1 FROM ${Prisma.raw(config.coreTable)} AS c
                      WHERE coalesce(c.is_active, true)
                        AND c.external_id = g.resolved_external_id
                  )
            )
            INSERT INTO ${Prisma.raw(config.coreTable)} (
                external_id, water_class_id, normalized_data, source_refs,
                geom${coreVerificationInsertColumnsSql(verificationColumns)}, is_active,
                created_at, updated_at
            )
            SELECT
                g.resolved_external_id,
                g.resolved_water_class_id,
                ${normalizedDataMergeExpr("g", batchId)},
                ${sourceRefsMergeExpr("g", batchId, config.entityFamily)},
                g.geom${coreVerificationInsertValuesSql(verificationColumns)},
                true,
                now(),
                now()
            FROM guard AS g
            RETURNING id, external_id, NULL::text AS name, water_class_id
        `;

        if (rows.length === 0) {
            return {
                publish_item_id: publishItemId,
                outcome: "failed",
                target_id: null,
                error_message:
                    "Insert blocked: duplicate core row, invalid geometry, or missing required fields.",
                before_data: null,
                after_data: null,
            };
        }

        const row = rows[0]!;
        row.name = await this.syncCandidateNames(tx, config, publishItemId, row.id);
        const classRows = await tx.$queryRaw<{ code: string }[]>`
            SELECT code FROM ref.ref_water_classes WHERE id = ${row.water_class_id} LIMIT 1
        `;
        const verificationMeta = buildVerificationMetadataTracking({
            outcome: "inserted",
            beforeData: null,
            entityKey: config.entityKey,
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
                name: row.name,
                class_code: classRows[0]?.code ?? null,
                water_class_id: row.water_class_id.toString(),
            },
            ...verificationMeta,
        };
    }

    async updateMapEntity(
        entityFamily: MapEntityFamily,
        batchId: bigint,
        publishItemId: bigint
    ): Promise<PromoteItemResult> {
        return this.updateMapEntityTx(this.prisma, entityFamily, batchId, publishItemId);
    }

    async updateMapEntityTx(
        tx: PromotionDb,
        entityFamily: MapEntityFamily,
        batchId: bigint,
        publishItemId: bigint
    ): Promise<PromoteItemResult> {
        const config = MAP_ENTITY_CONFIG[entityFamily];
        const alias = config.candidateAlias;
        const verificationColumns = getCoreVerificationColumnsForEntity(config.entityKey);
        const srcColumns = mapCandidateSrcColumns(alias, config.candidateTable);

        const beforeRows = await tx.$queryRaw<{ row_json: unknown }[]>`
            SELECT to_jsonb(c) AS row_json
            FROM system.system_publish_items AS spi
            INNER JOIN ${Prisma.raw(config.candidateTable)} AS ${Prisma.raw(alias)}
                ON ${Prisma.raw(alias)}.id = spi.review_candidate_id
               AND spi.review_candidate_table = ${config.candidateTable}
            INNER JOIN ${Prisma.raw(config.coreTable)} AS c ON c.id = ${Prisma.raw(alias)}.matched_core_id
            WHERE spi.id = ${publishItemId}
              AND coalesce(c.is_active, true)
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

        const rows = await tx.$queryRaw<
            {
                id: bigint;
                external_id: string | null;
                name: string | null;
                water_class_id: bigint;
            }[]
        >`
            WITH src AS (
                SELECT ${srcColumns}
                FROM system.system_publish_items AS spi
                INNER JOIN ${Prisma.raw(config.candidateTable)} AS ${Prisma.raw(alias)}
                    ON ${Prisma.raw(alias)}.id = spi.review_candidate_id
                   AND spi.review_candidate_table = ${config.candidateTable}
                WHERE spi.id = ${publishItemId}
                  AND spi.publish_batch_id = ${batchId}
                  AND ${Prisma.raw(alias)}.matched_core_id IS NOT NULL
            ),
            raw_geom AS (
                SELECT s.*, ${geomSourceExpr("s", "candidate_geom")} AS g_raw FROM src AS s
            ),
            prep AS (
                SELECT ${mapPrepRow(geomCaseSql(config))}
                FROM raw_geom AS r
            ),
            ready AS (
                SELECT ${mapReadyRow("p")}
                FROM prep AS p
                WHERE p.geom IS NOT NULL AND ST_IsValid(p.geom) AND NOT ST_IsEmpty(p.geom)
            ),
            resolved AS (
                SELECT
                    r.*,
                    ${promotionTypedExternalIdExpr("r")} AS resolved_external_id,
                    ${promotionTypedWaterClassIdExpr("r")} AS resolved_water_class_id,
                    ${promotionTypedWaterClassCodeExpr("r")} AS resolved_class_code
                FROM ready AS r
            )
            UPDATE ${Prisma.raw(config.coreTable)} AS c
            SET
                external_id = r.resolved_external_id,
                water_class_id = r.resolved_water_class_id,
                normalized_data = ${normalizedDataMergeExpr("r", batchId)},
                source_refs = ${sourceRefsMergeExpr("r", batchId, config.entityFamily)},
                geom = r.geom${coreVerificationUpdateSetClauseSql("c", verificationColumns)},
                is_active = true,
                updated_at = now()
            FROM resolved AS r
            WHERE c.id = r.matched_core_id
              AND coalesce(c.is_active, true)
              AND r.resolved_external_id IS NOT NULL
              AND r.resolved_water_class_id IS NOT NULL
              AND r.resolved_class_code IS NOT NULL
            RETURNING c.id, c.external_id, NULL::text AS name, c.water_class_id
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
        row.name = await this.syncCandidateNames(tx, config, publishItemId, row.id);
        const classRows = await tx.$queryRaw<{ code: string }[]>`
            SELECT code FROM ref.ref_water_classes WHERE id = ${row.water_class_id} LIMIT 1
        `;
        const verificationMeta = buildVerificationMetadataTracking({
            outcome: "updated",
            beforeData,
            entityKey: config.entityKey,
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
                class_code: classRows[0]?.code ?? null,
                water_class_id: row.water_class_id.toString(),
            },
            ...verificationMeta,
        };
    }

    isMapEntityFamily(family: PromotablePublishEntityFamily): family is MapEntityFamily {
        return family === "water_lines" || family === "water_polygons";
    }
}

export {
    WATER_LINE_CANDIDATE_TABLE,
    WATER_POLYGON_CANDIDATE_TABLE,
    CORE_WATER_LINES_TABLE,
    CORE_WATER_POLYGONS_TABLE,
};
