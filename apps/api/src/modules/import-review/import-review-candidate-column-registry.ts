import { Prisma, type PrismaClient } from "@prisma/client";

/** Known columns from migrations — avoids information_schema on hot paths. */
const STATIC_CANDIDATE_COLUMNS: Record<string, readonly string[]> = {
    "import_review.building_candidates": [
        "id",
        "external_id",
        "local_staging_id",
        "source_refs",
        "review_overrides",
        "normalized_data",
        "geom",
        "centroid",
        "building_type",
        "building_type_id",
        "admin_area_id",
        "class_code",
        "confidence_score",
        "review_decision",
        "review_status",
        "promotion_status",
        "validation_errors",
        "match_status",
        "auto_action",
        "matched_core_id",
        "matched_core_data",
    ],
    "import_review.place_candidates": [
        "id",
        "external_id",
        "local_staging_id",
        "source_refs",
        "review_overrides",
        "normalized_data",
        "primary_name",
        "display_name",
        "canonical_name",
        "category_id",
        "class_code",
        "admin_area_id",
        "point_geom",
        "lat",
        "lng",
        "confidence_score",
        "review_decision",
        "review_status",
        "promotion_status",
        "validation_errors",
        "match_status",
        "auto_action",
        "matched_core_id",
        "matched_core_data",
    ],
    "import_review.landuse_candidates": [
        "id",
        "external_id",
        "local_staging_id",
        "source_refs",
        "review_overrides",
        "normalized_data",
        "geom",
        "centroid",
        "class_code",
        "landuse_class_id",
        "name",
        "canonical_name",
        "confidence_score",
        "review_decision",
        "review_status",
        "promotion_status",
        "validation_errors",
        "match_status",
        "auto_action",
        "matched_core_id",
        "matched_core_data",
    ],
    "import_review.water_line_candidates": [
        "id",
        "external_id",
        "local_staging_id",
        "source_refs",
        "review_overrides",
        "normalized_data",
        "geom",
        "class_code",
        "name",
        "canonical_name",
        "confidence_score",
        "review_decision",
        "review_status",
        "promotion_status",
        "validation_errors",
        "match_status",
        "auto_action",
        "matched_core_id",
        "matched_core_data",
    ],
    "import_review.water_polygon_candidates": [
        "id",
        "external_id",
        "local_staging_id",
        "source_refs",
        "review_overrides",
        "normalized_data",
        "geom",
        "centroid",
        "class_code",
        "name",
        "canonical_name",
        "confidence_score",
        "review_decision",
        "review_status",
        "promotion_status",
        "validation_errors",
        "match_status",
        "auto_action",
        "matched_core_id",
        "matched_core_data",
    ],
    "import_review.bus_stop_candidates": [
        "id",
        "external_id",
        "local_staging_id",
        "source_refs",
        "review_overrides",
        "normalized_data",
        "geom",
        "stop_code",
        "admin_area_id",
        "canonical_name",
        "confidence_score",
        "review_decision",
        "review_status",
        "promotion_status",
        "validation_errors",
        "match_status",
        "auto_action",
        "matched_core_id",
        "matched_core_data",
    ],
    "import_review.road_candidates": [
        "id",
        "external_id",
        "local_staging_id",
        "source_refs",
        "review_overrides",
        "normalized_data",
        "geom",
        "road_class_id",
        "road_class",
        "class_code",
        "confidence_score",
        "review_decision",
        "review_status",
        "promotion_status",
        "validation_errors",
        "match_status",
        "auto_action",
        "matched_core_id",
        "matched_core_data",
    ],
};

export type CandidateColumnCapabilities = {
    hasAdminAreaIdColumn: boolean;
    hasLanduseClassIdColumn: boolean;
    hasBuildingTypeIdColumn: boolean;
    hasCategoryIdColumn: boolean;
};

export class ImportReviewCandidateColumnRegistry {
    private readonly cache = new Map<string, Set<string>>();

    constructor(private readonly prisma: PrismaClient) {}

    async getColumns(candidateTable: string): Promise<ReadonlySet<string>> {
        const cached = this.cache.get(candidateTable);
        if (cached) {
            return cached;
        }

        const staticCols = STATIC_CANDIDATE_COLUMNS[candidateTable];
        if (staticCols) {
            const set = new Set(staticCols);
            this.cache.set(candidateTable, set);
            return set;
        }

        const [schema, table] = candidateTable.includes(".")
            ? candidateTable.split(".")
            : ["import_review", candidateTable];
        const rows = await this.prisma.$queryRaw<{ column_name: string }[]>`
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema = ${schema}
              AND table_name = ${table}
        `;
        const set = new Set(rows.map((row) => row.column_name));
        this.cache.set(candidateTable, set);
        return set;
    }

    async hasColumn(candidateTable: string, column: string): Promise<boolean> {
        const columns = await this.getColumns(candidateTable);
        return columns.has(column);
    }

    async getCapabilities(candidateTable: string): Promise<CandidateColumnCapabilities> {
        const columns = await this.getColumns(candidateTable);
        return {
            hasAdminAreaIdColumn: columns.has("admin_area_id"),
            hasLanduseClassIdColumn: columns.has("landuse_class_id"),
            hasBuildingTypeIdColumn: columns.has("building_type_id"),
            hasCategoryIdColumn: columns.has("category_id"),
        };
    }
}

export function effectiveAdminAreaIdExpr(
    alias: string,
    options: { hasAdminAreaColumn: boolean }
): Prisma.Sql {
    const a = Prisma.raw(alias);
    const fromOverrides = Prisma.sql`
        CASE WHEN (${a}.review_overrides->>'admin_area_id') ~ '^[0-9]+$'
            THEN (${a}.review_overrides->>'admin_area_id')::bigint
        END
    `;
    const fromNormalized = Prisma.sql`
        CASE WHEN (${a}.normalized_data->>'admin_area_id') ~ '^[0-9]+$'
            THEN (${a}.normalized_data->>'admin_area_id')::bigint
        END
    `;
    if (!options.hasAdminAreaColumn) {
        return Prisma.sql`coalesce(${fromOverrides}, ${fromNormalized})`;
    }
    return Prisma.sql`coalesce(${fromOverrides}, ${a}.admin_area_id, ${fromNormalized})`;
}

export function landuseEffectiveClassIdRawExpr(
    alias: string,
    options: { hasLanduseClassIdColumn: boolean }
): Prisma.Sql {
    const a = Prisma.raw(alias);
    const fromOverrides = Prisma.sql`
        CASE WHEN (${a}.review_overrides->>'landuse_class_id') ~ '^[0-9]+$'
            THEN (${a}.review_overrides->>'landuse_class_id')::bigint
        END
    `;
    const fromNormalized = Prisma.sql`
        CASE WHEN (${a}.normalized_data->>'landuse_class_id') ~ '^[0-9]+$'
            THEN (${a}.normalized_data->>'landuse_class_id')::bigint
        END
    `;
    if (!options.hasLanduseClassIdColumn) {
        return Prisma.sql`coalesce(${fromOverrides}, ${fromNormalized})`;
    }
    return Prisma.sql`coalesce(${fromOverrides}, ${a}.landuse_class_id, ${fromNormalized})`;
}

/** Effective landuse_class_id when it exists in ref.ref_landuse_classes. */
export function landuseClassIdExpr(
    alias: string,
    options: { hasLanduseClassIdColumn: boolean } = { hasLanduseClassIdColumn: true }
): Prisma.Sql {
    const raw = landuseEffectiveClassIdRawExpr(alias, options);
    return Prisma.sql`
        CASE
            WHEN ${raw} IS NULL THEN NULL::bigint
            WHEN EXISTS (
                SELECT 1 FROM ref.ref_landuse_classes AS lc
                WHERE lc.id = ${raw}
                  AND coalesce(lc.is_active, true)
            ) THEN ${raw}
            ELSE NULL::bigint
        END
    `;
}

export function landuseClassCodeEffectiveExpr(alias: string): Prisma.Sql {
    const a = Prisma.raw(alias);
    return Prisma.sql`
        nullif(trim(coalesce(
            ${a}.review_overrides->>'class_code',
            ${a}.class_code,
            ${a}.normalized_data->>'class_code',
            ''
        )), '')
    `;
}
