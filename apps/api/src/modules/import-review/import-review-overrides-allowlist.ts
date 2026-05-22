import type { ImportReviewEntityFamilySlug } from "./import-review-config.js";

/** Allowed `review_overrides` keys per import-review entity family (PATCH shallow merge). */
export const IMPORT_REVIEW_OVERRIDE_ALLOWLIST: Record<
    ImportReviewEntityFamilySlug,
    readonly string[]
> = {
    bus_stops: ["name_mm", "name_en", "stop_code", "admin_area_id"],
    places: [
        "name_mm",
        "name_en",
        "category_id",
        "admin_area_id",
        "confidence_score",
        "importance_score",
        "popularity_score",
        "point_geom",
        "geom",
    ],
    roads: [
        "name_mm",
        "name_en",
        "road_class_id",
        "admin_area_id",
        "surface",
        "is_oneway",
        "confidence_score",
        "geom",
    ],
    buildings: [
        "name_mm",
        "name_en",
        "building_type_id",
        "admin_area_id",
        "levels",
        "height_m",
        "confidence_score",
        "geom",
    ],
    landuse: ["name_mm", "name_en", "class_code", "landuse_class_id", "admin_area_id", "confidence_score", "geom"],
    water_lines: [
        "name_mm",
        "name_en",
        "class_code",
        "waterway_class",
        "intermittent",
        "confidence_score",
        "geom",
    ],
    water_polygons: [
        "name_mm",
        "name_en",
        "class_code",
        "water_class",
        "intermittent",
        "confidence_score",
        "geom",
    ],
    admin_areas: ["name_mm", "name_en", "admin_level_id", "parent_id", "slug", "geom"],
    addresses: [
        "full_address",
        "house_number",
        "street_name",
        "street_id",
        "quarter",
        "township",
        "city",
        "postcode",
        "plus_code",
        "admin_area_id",
        "point_geom",
        "geom",
    ],
    routing_barriers: ["barrier_type", "class_code", "admin_area_id", "confidence_score", "geom"],
};

/** PATCH keys accepted but persisted under a canonical allowlist key. */
export const IMPORT_REVIEW_OVERRIDE_PATCH_KEY_ALIASES: Readonly<Record<string, string>> = {
    parent_admin_area_id: "parent_id",
};

/** Reserved for future bus route review UI. */
export const IMPORT_REVIEW_BUS_ROUTES_OVERRIDE_ALLOWLIST = [
    "name_mm",
    "name_en",
    "route_code",
    "operator_name",
    "route_type",
] as const;

export function overrideAllowlistForFamily(family: ImportReviewEntityFamilySlug): ReadonlySet<string> {
    return new Set(IMPORT_REVIEW_OVERRIDE_ALLOWLIST[family] ?? []);
}

export function unsupportedOverrideKeys(
    family: ImportReviewEntityFamilySlug,
    patch: Record<string, unknown>
): string[] {
    const allow = overrideAllowlistForFamily(family);
    const aliases = IMPORT_REVIEW_OVERRIDE_PATCH_KEY_ALIASES;
    return Object.keys(patch)
        .filter((key) => !allow.has(key) && !(key in aliases))
        .sort();
}
