import { Prisma, type PrismaClient } from "@prisma/client";

export const POI_CATEGORIES_TABLE = "ref.ref_poi_categories";
export const POI_CATEGORIES_REGCLASS = "ref.ref_poi_categories";

export class ImportReviewMissingPoiCategoriesTableError extends Error {
    readonly statusCode = 500;

    constructor() {
        super("Missing required table ref.ref_poi_categories");
        this.name = "ImportReviewMissingPoiCategoriesTableError";
    }
}

let poiCategoriesTableVerified = false;

export async function assertPoiCategoriesTableExists(prisma: PrismaClient): Promise<void> {
    if (poiCategoriesTableVerified) {
        return;
    }
    const rows = await prisma.$queryRaw<{ exists: boolean }[]>`
        SELECT to_regclass(${POI_CATEGORIES_REGCLASS}) IS NOT NULL AS exists
    `;
    if (rows[0]?.exists !== true) {
        throw new ImportReviewMissingPoiCategoriesTableError();
    }
    poiCategoriesTableVerified = true;
}

/** Numeric category_id from candidate column or normalized_data (no code lookup). */
export function placeExplicitCategoryIdExpr(alias: string): Prisma.Sql {
    const a = Prisma.raw(alias);
    return Prisma.sql`
        coalesce(
            ${a}.category_id,
            CASE WHEN (${a}.normalized_data->>'category_id') ~ '^[0-9]+$'
                THEN (${a}.normalized_data->>'category_id')::bigint END,
            CASE WHEN (${a}.normalized_data->>'poi_category_id') ~ '^[0-9]+$'
                THEN (${a}.normalized_data->>'poi_category_id')::bigint END
        )
    `;
}

/** class_code / category_code from column and normalized_data only. */
export function placeClassCodeJsonExpr(alias: string): Prisma.Sql {
    const a = Prisma.raw(alias);
    return Prisma.sql`
        nullif(trim(coalesce(
            ${a}.class_code,
            ${a}.normalized_data->>'class_code',
            ${a}.normalized_data->>'category_code',
            ''
        )), '')
    `;
}

/** class_code / category_code from candidate column or normalized_data. */
export function placeClassCodeExpr(alias: string): Prisma.Sql {
    const a = Prisma.raw(alias);
    return Prisma.sql`
        nullif(trim(coalesce(
            ${a}.class_code,
            ${a}.normalized_data->>'class_code',
            ${a}.normalized_data->>'category_code',
            ''
        )), '')
    `;
}

/** Resolved category_id: explicit ids first, then lookup by class_code in ref.ref_poi_categories.code. */
export function placeResolvedCategoryIdExpr(alias: string): Prisma.Sql {
    return Prisma.sql`
        coalesce(
            ${placeExplicitCategoryIdExpr(alias)},
            (
                SELECT c.id
                FROM ref.ref_poi_categories AS c
                WHERE c.code = ${placeClassCodeExpr(alias)}
                LIMIT 1
            )
        )
    `;
}

/**
 * Promotion-safe category resolution: typed columns first, then normalized_data.
 * Uses ref.ref_poi_categories only (never ref.ref_place_categories).
 */
export function placeResolvedCategoryIdExprForPromotion(alias: string): Prisma.Sql {
    const a = Prisma.raw(alias);
    return Prisma.sql`
        coalesce(
            ${placeExplicitCategoryIdExpr(alias)},
            (
                SELECT c.id
                FROM ref.ref_poi_categories AS c
                WHERE c.code = nullif(trim(coalesce(
                    ${a}.class_code,
                    ${a}.normalized_data->>'class_code',
                    ${a}.normalized_data->>'category_code',
                    ''
                )), '')
                LIMIT 1
            )
        )
    `;
}
