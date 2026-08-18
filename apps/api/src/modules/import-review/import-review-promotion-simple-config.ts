/**
 * Readable promotion registry for the direct-edit promotion contract.
 *
 * @see docs/import-review/direct-edit-promotion-contract.md
 *
 * This module is declarative configuration only — it does not run validation or promotion yet.
 * Typed candidate columns are the promote source of truth; `normalized_data` is not listed as a
 * required-field fallback for FK, class, or geometry.
 */

import { getImportReviewEntityConfig } from "./import-review-config.js";

/** PostGIS geometry types allowed for promotion (contract SRID 4326). */
export type PromotionGeometryType =
    | "Point"
    | "LineString"
    | "MultiLineString"
    | "Polygon"
    | "MultiPolygon";

export type PromotionGeometrySpec = {
    /** Typed geometry column on the candidate row (no normalized_data fallback). */
    column: string;
    requiredType: PromotionGeometryType | readonly PromotionGeometryType[];
    srid: number;
};

export type PromotionFkCheck = {
    /** Typed FK column on the candidate row. */
    column: string;
    refSchema: string;
    refTable: string;
    /** Referenced column; defaults to `id`. */
    refColumn?: string;
};

export type ImportReviewSimplePromotionFamily =
    | "places"
    | "buildings"
    | "roads"
    | "land_areas"
    | "water_lines"
    | "water_polygons"
    | "admin_areas"
    | "routing_barriers"
    | "addresses";

export const IMPORT_REVIEW_SIMPLE_PROMOTION_FAMILIES = [
    "places",
    "buildings",
    "roads",
    "land_areas",
    "water_lines",
    "water_polygons",
    "admin_areas",
    "routing_barriers",
    "addresses",
] as const satisfies readonly ImportReviewSimplePromotionFamily[];

export type ImportReviewSimplePromotionFamilyConfig = {
    family: ImportReviewSimplePromotionFamily;
    candidateTable: string;
    targetSchema: string;
    targetTable: string;
    /** Primary key on candidate and typical core target row. */
    idColumn: "id";
    /**
     * Typed columns that must be set (or pass geometry/FK checks) before promote.
     * Lineage uses `external_id` OR `local_staging_id` OR non-empty `source_refs` (validated separately).
     */
    requiredFields: readonly string[];
    /** Typed columns; issues produce WARNING (promote with confirmation). */
    warningFields: readonly string[];
    fkChecks: readonly PromotionFkCheck[];
    geometry: PromotionGeometrySpec | null;
    highRisk: boolean;
    requiresDryRun: boolean;
    /**
     * When true, missing typed display names may WARN using source context only —
     * never auto-fill core writes from `normalized_data` / OSM tags.
     */
    allowSourceNameFallback: boolean;
    /** Typed candidate columns the promotion writer may read (no review_overrides). */
    promotionColumns: readonly string[];
};

const SRID_WGS84 = 4326;

const LINEAGE_FIELDS = ["external_id", "local_staging_id", "source_refs"] as const;

const GLOBAL_REVIEW_FIELDS = ["review_status", "review_decision"] as const;

function qualifiedCandidateTable(family: ImportReviewSimplePromotionFamily): string {
    const base = getImportReviewEntityConfig(family);
    return `import_review.${base.importReviewTable}`;
}

function targetParts(
    schema: string,
    table: string
): Pick<ImportReviewSimplePromotionFamilyConfig, "targetSchema" | "targetTable"> {
    return { targetSchema: schema, targetTable: table };
}

function cfg(
    family: ImportReviewSimplePromotionFamily,
    args: Omit<
        ImportReviewSimplePromotionFamilyConfig,
        "family" | "candidateTable" | "idColumn"
    >
): ImportReviewSimplePromotionFamilyConfig {
    return {
        family,
        candidateTable: qualifiedCandidateTable(family),
        idColumn: "id",
        ...args,
    };
}

/**
 * Single registry — one entry per promotable import-review family.
 */
export const IMPORT_REVIEW_SIMPLE_PROMOTION_REGISTRY: Record<
    ImportReviewSimplePromotionFamily,
    ImportReviewSimplePromotionFamilyConfig
> = {
    places: cfg("places", {
        ...targetParts("core", "core_places"),
        requiredFields: [
            ...GLOBAL_REVIEW_FIELDS,
            "point_geom",
            "category_id",
            "admin_area_id",
            ...LINEAGE_FIELDS,
        ],
        warningFields: ["name_en", "name_mm", "primary_name", "display_name"],
        fkChecks: [
            { column: "category_id", refSchema: "ref", refTable: "ref_poi_categories" },
            { column: "admin_area_id", refSchema: "core", refTable: "core_admin_areas" },
        ],
        geometry: {
            column: "point_geom",
            requiredType: "Point",
            srid: SRID_WGS84,
        },
        highRisk: false,
        requiresDryRun: false,
        allowSourceNameFallback: true,
        promotionColumns: [
            "point_geom",
            "category_id",
            "admin_area_id",
            "name_mm",
            "name_en",
            "primary_name",
            "display_name",
            "class_code",
            "external_id",
            "local_staging_id",
            "source_refs",
            "confidence_score",
        ],
    }),

    buildings: cfg("buildings", {
        ...targetParts("core", "core_buildings"),
        requiredFields: [...GLOBAL_REVIEW_FIELDS, "geom", "building_type_id", ...LINEAGE_FIELDS],
        warningFields: ["name_en", "name_mm", "class_code"],
        fkChecks: [
            { column: "building_type_id", refSchema: "ref", refTable: "ref_building_types" },
            { column: "admin_area_id", refSchema: "core", refTable: "core_admin_areas" },
        ],
        geometry: {
            column: "geom",
            requiredType: ["Polygon", "MultiPolygon"],
            srid: SRID_WGS84,
        },
        highRisk: false,
        requiresDryRun: false,
        allowSourceNameFallback: true,
        promotionColumns: [
            "geom",
            "centroid",
            "building_type_id",
            "admin_area_id",
            "name_mm",
            "name_en",
            "class_code",
            "external_id",
            "local_staging_id",
            "source_refs",
            "confidence_score",
        ],
    }),

    roads: cfg("roads", {
        ...targetParts("core", "core_streets"),
        requiredFields: [
            ...GLOBAL_REVIEW_FIELDS,
            "geom",
            "road_class_id",
            ...LINEAGE_FIELDS,
        ],
        warningFields: [
            "name_en",
            "name_mm",
            "canonical_name",
            "surface",
            "speed_kph",
            "is_oneway",
        ],
        fkChecks: [{ column: "road_class_id", refSchema: "ref", refTable: "ref_road_classes" }],
        geometry: {
            column: "geom",
            requiredType: ["LineString", "MultiLineString"],
            srid: SRID_WGS84,
        },
        highRisk: false,
        requiresDryRun: true,
        allowSourceNameFallback: true,
        promotionColumns: [
            "geom",
            "road_class_id",
            "road_class",
            "name_mm",
            "name_en",
            "canonical_name",
            "surface",
            "is_oneway",
            "admin_area_id",
            "speed_kph",
            "length_m",
            "bridge",
            "tunnel",
            "layer",
            "access",
            "external_id",
            "local_staging_id",
            "source_refs",
            "confidence_score",
        ],
    }),

    land_areas: cfg("land_areas", {
        ...targetParts("core", "core_land_areas"),
        requiredFields: [
            ...GLOBAL_REVIEW_FIELDS,
            "geom",
            "land_area_class_id",
            ...LINEAGE_FIELDS,
        ],
        warningFields: ["name_en", "name_mm", "class_code"],
        fkChecks: [{ column: "land_area_class_id", refSchema: "ref", refTable: "ref_land_area_classes" }],
        geometry: {
            column: "geom",
            requiredType: ["Polygon", "MultiPolygon"],
            srid: SRID_WGS84,
        },
        highRisk: false,
        requiresDryRun: false,
        allowSourceNameFallback: true,
        promotionColumns: [
            "geom",
            "centroid",
            "land_area_class_id",
            "class_code",
            "name_mm",
            "name_en",
            "external_id",
            "local_staging_id",
            "source_refs",
            "confidence_score",
        ],
    }),

    water_lines: cfg("water_lines", {
        ...targetParts("core", "core_water_lines"),
        requiredFields: [...GLOBAL_REVIEW_FIELDS, "geom", "water_class_id", ...LINEAGE_FIELDS],
        warningFields: ["name_en", "name_mm", "class_code"],
        fkChecks: [{ column: "water_class_id", refSchema: "ref", refTable: "ref_water_classes" }],
        geometry: {
            column: "geom",
            requiredType: ["LineString", "MultiLineString"],
            srid: SRID_WGS84,
        },
        highRisk: false,
        requiresDryRun: false,
        allowSourceNameFallback: true,
        promotionColumns: [
            "geom",
            "water_class_id",
            "class_code",
            "name_mm",
            "name_en",
            "external_id",
            "local_staging_id",
            "source_refs",
            "confidence_score",
        ],
    }),

    water_polygons: cfg("water_polygons", {
        ...targetParts("core", "core_water_polygons"),
        requiredFields: [...GLOBAL_REVIEW_FIELDS, "geom", "water_class_id", ...LINEAGE_FIELDS],
        warningFields: ["name_en", "name_mm", "class_code"],
        fkChecks: [{ column: "water_class_id", refSchema: "ref", refTable: "ref_water_classes" }],
        geometry: {
            column: "geom",
            requiredType: ["Polygon", "MultiPolygon"],
            srid: SRID_WGS84,
        },
        highRisk: false,
        requiresDryRun: false,
        allowSourceNameFallback: true,
        promotionColumns: [
            "geom",
            "centroid",
            "water_class_id",
            "class_code",
            "name_mm",
            "name_en",
            "external_id",
            "local_staging_id",
            "source_refs",
            "confidence_score",
        ],
    }),

    admin_areas: cfg("admin_areas", {
        ...targetParts("core", "core_admin_areas"),
        requiredFields: [
            ...GLOBAL_REVIEW_FIELDS,
            "geom",
            "admin_level_id",
            "source_refs",
            ...LINEAGE_FIELDS,
        ],
        warningFields: ["name_en", "name_mm", "canonical_name", "slug"],
        fkChecks: [
            { column: "admin_level_id", refSchema: "ref", refTable: "ref_admin_levels" },
            { column: "parent_id", refSchema: "core", refTable: "core_admin_areas" },
        ],
        geometry: {
            column: "geom",
            requiredType: ["Polygon", "MultiPolygon"],
            srid: SRID_WGS84,
        },
        highRisk: true,
        requiresDryRun: false,
        allowSourceNameFallback: false,
        promotionColumns: [
            "geom",
            "centroid",
            "admin_level_id",
            "parent_id",
            "slug",
            "name_mm",
            "name_en",
            "canonical_name",
            "class_code",
            "external_id",
            "local_staging_id",
            "source_refs",
            "confidence_score",
        ],
    }),

    routing_barriers: cfg("routing_barriers", {
        ...targetParts("routing", "routing_barriers"),
        requiredFields: [
            ...GLOBAL_REVIEW_FIELDS,
            "point_geom",
            "barrier_type",
            "source_refs",
            ...LINEAGE_FIELDS,
        ],
        warningFields: ["name_en", "name_mm", "class_code"],
        fkChecks: [],
        geometry: {
            column: "point_geom",
            requiredType: "Point",
            srid: SRID_WGS84,
        },
        highRisk: false,
        requiresDryRun: true,
        allowSourceNameFallback: false,
        promotionColumns: [
            "point_geom",
            "barrier_type",
            "class_code",
            "name_mm",
            "name_en",
            "canonical_name",
            "external_id",
            "local_staging_id",
            "source_refs",
            "confidence_score",
        ],
    }),

    addresses: cfg("addresses", {
        ...targetParts("core", "core_addresses"),
        requiredFields: [
            ...GLOBAL_REVIEW_FIELDS,
            "point_geom",
            "validation_status",
            "address_strength",
            ...LINEAGE_FIELDS,
        ],
        warningFields: ["full_address", "geom"],
        fkChecks: [
            { column: "matched_place_id", refSchema: "core", refTable: "core_places" },
            { column: "admin_area_id", refSchema: "core", refTable: "core_admin_areas" },
        ],
        geometry: {
            column: "point_geom",
            requiredType: "Point",
            srid: SRID_WGS84,
        },
        highRisk: true,
        requiresDryRun: false,
        allowSourceNameFallback: false,
        promotionColumns: [
            "point_geom",
            "geom",
            "lat",
            "lng",
            "full_address",
            "address_strength",
            "validation_status",
            "promotion_blockers",
            "promotion_warnings",
            "matched_place_id",
            "admin_area_id",
            "external_id",
            "source_refs",
            "confidence_score",
        ],
    }),
};

export function isImportReviewSimplePromotionFamily(
    family: string
): family is ImportReviewSimplePromotionFamily {
    return (IMPORT_REVIEW_SIMPLE_PROMOTION_FAMILIES as readonly string[]).includes(family);
}

export function listPromotableFamilies(): ImportReviewSimplePromotionFamily[] {
    return [...IMPORT_REVIEW_SIMPLE_PROMOTION_FAMILIES];
}

export function getPromotionFamilyConfig(
    family: string
): ImportReviewSimplePromotionFamilyConfig | null {
    if (!isImportReviewSimplePromotionFamily(family)) {
        return null;
    }
    return IMPORT_REVIEW_SIMPLE_PROMOTION_REGISTRY[family];
}

export function assertPromotableFamily(family: string): asserts family is ImportReviewSimplePromotionFamily {
    if (!isImportReviewSimplePromotionFamily(family)) {
        throw new Error(`Import review promotion is not allowed for entity family: ${family}`);
    }
}

/** Fully qualified target table (`schema.table`). */
export function promotionTargetQualifiedTable(
    config: ImportReviewSimplePromotionFamilyConfig
): string {
    return `${config.targetSchema}.${config.targetTable}`;
}

/** Guard: registry must never reference review_overrides. */
export function assertRegistryExcludesReviewOverrides(): void {
    for (const entry of Object.values(IMPORT_REVIEW_SIMPLE_PROMOTION_REGISTRY)) {
        const columns = [...entry.requiredFields, ...entry.warningFields, ...entry.promotionColumns];
        for (const col of columns) {
            if (col === "review_overrides") {
                throw new Error(
                    `Promotion registry for ${entry.family} must not reference review_overrides`
                );
            }
        }
    }
}

// Fail fast at module load if registry violates hard rules.
assertRegistryExcludesReviewOverrides();

const routingBarrierCfg = IMPORT_REVIEW_SIMPLE_PROMOTION_REGISTRY.routing_barriers;
if (
    routingBarrierCfg.targetSchema !== "routing" ||
    routingBarrierCfg.targetTable !== "routing_barriers"
) {
    throw new Error("routing_barriers must target routing.routing_barriers");
}
