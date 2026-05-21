import { Prisma, type PrismaClient } from "@prisma/client";

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
    externalIdExpr,
    geomSourceExpr,
    lineToMultiLineStringSql,
    mapCandidateSrcColumns,
    mapClassCodeExpr,
    mapPrepRow,
    mapReadyRow,
    nameExpr,
    normalizedDataMergeExpr,
    polygonToMultiPolygonSql,
    sourceRefsMergeExpr,
} from "./import-review-promotion-promote-sql.js";

const LANDUSE_CANDIDATE_TABLE = "import_review.landuse_candidates";
const WATER_LINE_CANDIDATE_TABLE = "import_review.water_line_candidates";
const WATER_POLYGON_CANDIDATE_TABLE = "import_review.water_polygon_candidates";

const CORE_LANDUSE_TABLE = "core.core_map_landuse";
const CORE_WATER_LINES_TABLE = "core.core_map_water_lines";
const CORE_WATER_POLYGONS_TABLE = "core.core_map_water_polygons";

type MapEntityFamily = "landuse" | "water_lines" | "water_polygons";

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
    landuse: {
        entityFamily: "landuse",
        entityKey: "landuse",
        candidateTable: LANDUSE_CANDIDATE_TABLE,
        candidateAlias: "lu",
        coreTable: CORE_LANDUSE_TABLE,
        geomKind: "polygon",
    },
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

function classCodeSql(config: MapEntityConfig, alias: string): Prisma.Sql {
    return mapClassCodeExpr(alias, config.classCodeFallback);
}

export class ImportReviewPromotionPromoteMapRepository {
    constructor(private readonly prisma: PrismaClient) {}

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
        const config = MAP_ENTITY_CONFIG[entityFamily];
        const alias = config.candidateAlias;
        const verificationColumns = getCoreVerificationColumnsForEntity(config.entityKey);
        const srcColumns = mapCandidateSrcColumns(alias, config.candidateTable);

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
                SELECT ${srcColumns}
                FROM system.system_publish_items AS spi
                INNER JOIN ${Prisma.raw(config.candidateTable)} AS ${Prisma.raw(alias)}
                    ON ${Prisma.raw(alias)}.id = spi.review_candidate_id
                   AND spi.review_candidate_table = ${config.candidateTable}
                WHERE spi.id = ${publishItemId}
                  AND spi.publish_batch_id = ${batchId}
            ),
            raw_geom AS (
                SELECT s.*, ${geomSourceExpr("s")} AS g_raw FROM src AS s
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
                    ${externalIdExpr("r")} AS resolved_external_id,
                    ${classCodeSql(config, "r")} AS resolved_class_code
                FROM ready AS r
            ),
            guard AS (
                SELECT g.*
                FROM resolved AS g
                WHERE g.resolved_external_id IS NOT NULL
                  AND g.resolved_class_code IS NOT NULL
                  AND NOT EXISTS (
                      SELECT 1 FROM ${Prisma.raw(config.coreTable)} AS c
                      WHERE coalesce(c.is_active, true)
                        AND (
                            c.external_id = g.resolved_external_id
                            OR (g.local_staging_id IS NOT NULL AND c.source_staging_id = g.local_staging_id)
                        )
                  )
            )
            INSERT INTO ${Prisma.raw(config.coreTable)} (
                source_staging_id, external_id, name, class_code, normalized_data, source_refs,
                geom${coreVerificationInsertColumnsSql(verificationColumns)}, is_active,
                created_at, updated_at
            )
            SELECT
                g.local_staging_id,
                g.resolved_external_id,
                ${nameExpr("g")},
                g.resolved_class_code,
                ${normalizedDataMergeExpr("g", batchId)},
                ${sourceRefsMergeExpr("g", batchId, config.entityFamily)},
                g.geom${coreVerificationInsertValuesSql(verificationColumns)},
                true,
                now(),
                now()
            FROM guard AS g
            RETURNING id, external_id, source_staging_id, name, class_code
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
                source_staging_id: row.source_staging_id?.toString() ?? null,
                name: row.name,
                class_code: row.class_code,
            },
            ...verificationMeta,
        };
    }

    async updateMapEntity(
        entityFamily: MapEntityFamily,
        batchId: bigint,
        publishItemId: bigint
    ): Promise<PromoteItemResult> {
        const config = MAP_ENTITY_CONFIG[entityFamily];
        const alias = config.candidateAlias;
        const verificationColumns = getCoreVerificationColumnsForEntity(config.entityKey);
        const srcColumns = mapCandidateSrcColumns(alias, config.candidateTable);

        const beforeRows = await this.prisma.$queryRaw<{ row_json: unknown }[]>`
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

        const rows = await this.prisma.$queryRaw<
            { id: bigint; external_id: string | null; name: string | null; class_code: string }[]
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
                SELECT s.*, ${geomSourceExpr("s")} AS g_raw FROM src AS s
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
                    ${externalIdExpr("r")} AS resolved_external_id,
                    ${classCodeSql(config, "r")} AS resolved_class_code
                FROM ready AS r
            )
            UPDATE ${Prisma.raw(config.coreTable)} AS c
            SET
                source_staging_id = r.local_staging_id,
                external_id = r.resolved_external_id,
                name = ${nameExpr("r")},
                class_code = r.resolved_class_code,
                normalized_data = ${normalizedDataMergeExpr("r", batchId)},
                source_refs = ${sourceRefsMergeExpr("r", batchId, config.entityFamily)},
                geom = r.geom${coreVerificationUpdateSetClauseSql("c", verificationColumns)},
                is_active = true,
                updated_at = now()
            FROM resolved AS r
            WHERE c.id = r.matched_core_id
              AND coalesce(c.is_active, true)
              AND r.resolved_external_id IS NOT NULL
              AND r.resolved_class_code IS NOT NULL
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
                class_code: row.class_code,
            },
            ...verificationMeta,
        };
    }

    isMapEntityFamily(family: PromotablePublishEntityFamily): family is MapEntityFamily {
        return family === "landuse" || family === "water_lines" || family === "water_polygons";
    }
}

export {
    LANDUSE_CANDIDATE_TABLE,
    WATER_LINE_CANDIDATE_TABLE,
    WATER_POLYGON_CANDIDATE_TABLE,
    CORE_LANDUSE_TABLE,
    CORE_WATER_LINES_TABLE,
    CORE_WATER_POLYGONS_TABLE,
};
