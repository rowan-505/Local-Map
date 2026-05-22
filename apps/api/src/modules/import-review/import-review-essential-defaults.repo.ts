import { Prisma, type PrismaClient } from "@prisma/client";

import type { ImportReviewEntityFamilySlug } from "./import-review-config.js";
import { getImportReviewEntityConfig } from "./import-review-config.js";
import { buildCandidateScopeWhere } from "./import-review-candidate-sql.js";

export type ImportReviewEssentialCandidateContext = {
    id: bigint;
    review_batch_id: bigint;
    review_overrides: Record<string, unknown>;
    normalized_data: unknown;
    name: string | null;
    name_local: string | null;
    canonical_name: string | null;
    primary_name: string | null;
    display_name: string | null;
    admin_area_id: bigint | null;
    building_type_id: bigint | null;
    category_id: bigint | null;
    road_class_id: bigint | null;
    road_class: string | null;
    class_code: string | null;
    building_type: string | null;
    confidence_score: number | null;
    stop_code: string | null;
    has_geometry: boolean;
};

function asOverrideRecord(review_overrides: unknown): Record<string, unknown> {
    if (review_overrides && typeof review_overrides === "object" && !Array.isArray(review_overrides)) {
        return review_overrides as Record<string, unknown>;
    }
    return {};
}

function geometryColumnForFamily(family: ImportReviewEntityFamilySlug): string {
    const config = getImportReviewEntityConfig(family);
    return config.geometryColumns.primary ?? "geom";
}

function optionalColumn(alias: string, column: string | null, sqlType: string): Prisma.Sql {
    if (column === null) {
        return Prisma.raw(`NULL::${sqlType}`);
    }
    return Prisma.raw(`${alias}.${column}`);
}

function essentialSelectColumns(family: ImportReviewEntityFamilySlug, alias: string): Prisma.Sql {
    const geomCol = geometryColumnForFamily(family);

    const nameCol =
        family === "buildings" || family === "landuse" || family.startsWith("water") ? "name" : null;
    const nameLocalCol = null;
    const primaryNameCol = family === "places" ? "primary_name" : null;
    const displayNameCol = family === "places" ? "display_name" : null;
    const adminAreaCol =
        family === "bus_stops" || family === "buildings" || family === "places" ? "admin_area_id" : null;
    const buildingTypeIdCol = family === "buildings" ? "building_type_id" : null;
    const buildingTypeCol = family === "buildings" ? "building_type" : null;
    const categoryIdCol = family === "places" ? "category_id" : null;
    const roadClassIdCol = family === "roads" ? "road_class_id" : null;
    const roadClassCol = family === "roads" ? "road_class" : null;
    const classCodeCol =
        family === "buildings" ||
        family === "places" ||
        family === "landuse" ||
        family.startsWith("water") ||
        family === "roads" ||
        family === "bus_stops"
            ? "class_code"
            : null;
    const stopCodeCol = family === "bus_stops" ? "stop_code" : null;

    return Prisma.sql`
        ${optionalColumn(alias, nameCol, "text")} AS name,
        ${optionalColumn(alias, nameLocalCol, "text")} AS name_local,
        ${Prisma.raw(`${alias}.canonical_name`)} AS canonical_name,
        ${optionalColumn(alias, primaryNameCol, "text")} AS primary_name,
        ${optionalColumn(alias, displayNameCol, "text")} AS display_name,
        ${optionalColumn(alias, adminAreaCol, "bigint")} AS admin_area_id,
        ${optionalColumn(alias, buildingTypeIdCol, "bigint")} AS building_type_id,
        ${optionalColumn(alias, categoryIdCol, "bigint")} AS category_id,
        ${optionalColumn(alias, roadClassIdCol, "bigint")} AS road_class_id,
        ${optionalColumn(alias, roadClassCol, "text")} AS road_class,
        ${optionalColumn(alias, classCodeCol, "text")} AS class_code,
        ${optionalColumn(alias, buildingTypeCol, "text")} AS building_type,
        ${Prisma.raw(`${alias}.confidence_score`)}::double precision AS confidence_score,
        ${optionalColumn(alias, stopCodeCol, "text")} AS stop_code,
        (
            ${Prisma.raw(`${alias}.${geomCol}`)} IS NOT NULL
            AND NOT ST_IsEmpty(${Prisma.raw(`${alias}.${geomCol}`)})
        ) AS has_geometry
    `;
}

export class ImportReviewEssentialDefaultsRepository {
    constructor(private readonly prisma: PrismaClient) {}

    async fetchEssentialContext(
        family: ImportReviewEntityFamilySlug,
        reviewBatchId: bigint,
        id: bigint
    ): Promise<ImportReviewEssentialCandidateContext | null> {
        const config = getImportReviewEntityConfig(family);
        const where = buildCandidateScopeWhere(config, reviewBatchId, id);
        const alias = config.tableAlias;

        const rows = await this.prisma.$queryRaw<
            Array<
                Omit<ImportReviewEssentialCandidateContext, "review_overrides"> & {
                    review_overrides: unknown;
                }
            >
        >`
            SELECT
                ${Prisma.raw(`${alias}.id`)},
                ${Prisma.raw(`${alias}.review_batch_id`)},
                COALESCE(to_jsonb(${Prisma.raw(`${alias}.review_overrides`)}), '{}'::jsonb) AS review_overrides,
                ${Prisma.raw(`${alias}.normalized_data`)},
                ${essentialSelectColumns(family, alias)}
            FROM ${Prisma.raw(`import_review.${config.importReviewTable}`)} AS ${Prisma.raw(alias)}
            WHERE ${where}
            LIMIT 1
        `;

        const row = rows[0];
        if (row === undefined) {
            return null;
        }

        return {
            ...row,
            review_overrides: asOverrideRecord(row.review_overrides),
        };
    }

    async inferAdminAreaIdFromCandidateGeometry(
        family: ImportReviewEntityFamilySlug,
        reviewBatchId: bigint,
        id: bigint
    ): Promise<bigint | null> {
        const config = getImportReviewEntityConfig(family);
        const where = buildCandidateScopeWhere(config, reviewBatchId, id);
        const alias = config.tableAlias;
        const geomCol = geometryColumnForFamily(family);

        const rows = await this.prisma.$queryRaw<{ admin_area_id: bigint | null }[]>`
            SELECT (
                SELECT a.id
                FROM core.core_admin_areas AS a
                WHERE a.is_active IS TRUE
                  AND a.geom IS NOT NULL
                  AND ST_IsValid(a.geom)
                  AND ST_Contains(
                      a.geom::geometry,
                      ST_PointOnSurface(${Prisma.raw(`${alias}.${geomCol}`)})
                  )
                ORDER BY ST_Area(a.geom::geography) ASC NULLS LAST
                LIMIT 1
            ) AS admin_area_id
            FROM ${Prisma.raw(`import_review.${config.importReviewTable}`)} AS ${Prisma.raw(alias)}
            WHERE ${where}
              AND ${Prisma.raw(`${alias}.${geomCol}`)} IS NOT NULL
              AND NOT ST_IsEmpty(${Prisma.raw(`${alias}.${geomCol}`)})
            LIMIT 1
        `;
        return rows[0]?.admin_area_id ?? null;
    }

    async applyConfidenceDefaultIfMissing(
        family: ImportReviewEntityFamilySlug,
        reviewBatchId: bigint,
        id: bigint,
        defaultScore: number
    ): Promise<void> {
        const config = getImportReviewEntityConfig(family);
        const where = buildCandidateScopeWhere(config, reviewBatchId, id);
        const alias = config.tableAlias;

        await this.prisma.$executeRaw`
            UPDATE ${Prisma.raw(`import_review.${config.importReviewTable}`)} AS ${Prisma.raw(alias)}
            SET confidence_score = ${defaultScore}, updated_at = now()
            WHERE ${where}
              AND ${Prisma.raw(`${alias}.confidence_score`)} IS NULL
        `;
    }
}
