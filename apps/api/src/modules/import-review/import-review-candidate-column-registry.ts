import { Prisma, type PrismaClient } from "@prisma/client";

/** Known columns from migrations — avoids information_schema on hot paths. */
const STATIC_CANDIDATE_COLUMNS: Record<string, readonly string[]> = {
    "import_review.address_candidates": [
        "id",
        "external_id",
        "review_batch_id",
        "entity_family",
        "review_status",
        "review_decision",
        "promotion_status",
        "match_status",
        "auto_action",
        "confidence_score",
        "validation_errors",
        "validation_warnings",
        "matched_core_id",
        "matched_place_id",
        "full_address",
        "point_geom",
        "geom",
        "lat",
        "lng",
        "review_note",
        "normalized_data",
        "promoted_core_id",
        "created_at",
        "updated_at",
    ],
    "import_review.building_candidates": [
        "id",
        "external_id",
        "local_staging_id",
        "source_refs",
        "normalized_data",
        "geom",
        "centroid",
        "building_type",
        "building_type_id",
        "admin_area_id",
        "name_mm",
        "name_en",
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
        "normalized_data",
        "primary_name",
        "display_name",
        "canonical_name",
        "name_mm",
        "name_en",
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
        "normalized_data",
        "geom",
        "centroid",
        "class_code",
        "landuse_class_id",
        "name_mm",
        "name_en",
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
        "normalized_data",
        "geom",
        "class_code",
        "name_mm",
        "name_en",
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
        "normalized_data",
        "geom",
        "centroid",
        "class_code",
        "name_mm",
        "name_en",
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
    "import_review.road_candidates": [
        "id",
        "external_id",
        "local_staging_id",
        "source_refs",
        "normalized_data",
        "geom",
        "road_class_id",
        "road_class",
        "class_code",
        "canonical_name",
        "road_name",
        "name_mm",
        "name_en",
        "admin_area_id",
        "surface",
        "is_oneway",
        "bridge",
        "tunnel",
        "layer",
        "access",
        "speed_kph",
        "length_m",
        "confidence_score",
        "review_decision",
        "review_status",
        "promotion_status",
        "validation_errors",
        "validation_warnings",
        "match_status",
        "auto_action",
        "matched_core_id",
        "matched_core_data",
        "promoted_core_id",
        "review_note",
        "created_at",
        "updated_at",
    ],
    "import_review.admin_area_candidates": [
        "id",
        "review_batch_id",
        "source_snapshot_version",
        "local_staging_id",
        "entity_family",
        "external_id",
        "canonical_name",
        "class_code",
        "confidence_score",
        "match_status",
        "auto_action",
        "review_status",
        "review_decision",
        "review_note",
        "normalized_data",
        "source_refs",
        "matched_core_id",
        "matched_core_data",
        "validation_warnings",
        "validation_errors",
        "promotion_status",
        "promoted_core_id",
        "promoted_at",
        "promoted_by",
        "parent_id",
        "admin_level_id",
        "slug",
        "name_mm",
        "name_en",
        "geom",
        "centroid",
    ],
    "import_review.routing_barrier_candidates": [
        "id",
        "review_batch_id",
        "source_snapshot_version",
        "local_staging_id",
        "entity_family",
        "external_id",
        "canonical_name",
        "class_code",
        "confidence_score",
        "match_status",
        "auto_action",
        "review_status",
        "review_decision",
        "review_note",
        "normalized_data",
        "source_refs",
        "matched_core_id",
        "matched_core_data",
        "validation_warnings",
        "validation_errors",
        "promotion_status",
        "promoted_core_id",
        "promoted_at",
        "promoted_by",
        "barrier_type",
        "point_geom",
    ],
};

export type CandidateColumnCapabilities = {
    hasAdminAreaIdColumn: boolean;
    hasLanduseClassIdColumn: boolean;
    hasBuildingTypeIdColumn: boolean;
    hasCategoryIdColumn: boolean;
};

/** Whether a column exists on a candidate table (static migration list). */
export function importReviewCandidateTableHasColumn(
    importReviewTable: string,
    column: string
): boolean {
    const tableKey = importReviewTable.includes(".")
        ? importReviewTable
        : `import_review.${importReviewTable}`;
    return STATIC_CANDIDATE_COLUMNS[tableKey]?.includes(column) ?? false;
}

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

        return this.loadColumnsFromDatabase(candidateTable);
    }

    /** Live information_schema columns for raw SQL (avoids stale static lists). */
    async getColumnsForSql(candidateTable: string): Promise<ReadonlySet<string>> {
        const cacheKey = `${candidateTable}:live`;
        const cached = this.cache.get(cacheKey);
        if (cached) {
            return cached;
        }
        const set = await this.loadColumnsFromDatabase(candidateTable);
        this.cache.set(cacheKey, set);
        return set;
    }

    private async loadColumnsFromDatabase(candidateTable: string): Promise<Set<string>> {
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
    const fromNormalized = Prisma.sql`
        CASE WHEN (${a}.normalized_data->>'admin_area_id') ~ '^[0-9]+$'
            THEN (${a}.normalized_data->>'admin_area_id')::bigint
        END
    `;
    if (!options.hasAdminAreaColumn) {
        return fromNormalized;
    }
    return Prisma.sql`coalesce(${a}.admin_area_id, ${fromNormalized})`;
}

export function landuseEffectiveClassIdRawExpr(
    alias: string,
    options: { hasLanduseClassIdColumn: boolean }
): Prisma.Sql {
    const a = Prisma.raw(alias);
    const fromNormalized = Prisma.sql`
        CASE WHEN (${a}.normalized_data->>'landuse_class_id') ~ '^[0-9]+$'
            THEN (${a}.normalized_data->>'landuse_class_id')::bigint
        END
    `;
    if (!options.hasLanduseClassIdColumn) {
        return fromNormalized;
    }
    return Prisma.sql`coalesce(${a}.landuse_class_id, ${fromNormalized})`;
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
            ${a}.class_code,
            ${a}.normalized_data->>'class_code',
            ''
        )), '')
    `;
}
