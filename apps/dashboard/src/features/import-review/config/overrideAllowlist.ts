/** Allowed `review_overrides` keys per import-review entity family (must match API allowlist). */
export const IMPORT_REVIEW_OVERRIDE_ALLOWLIST: Record<string, readonly string[]> = {
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
        "is_oneway",
        "surface",
        "admin_area_id",
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
    landuse: ["name_mm", "name_en", "landuse_class_id", "admin_area_id", "confidence_score", "geom"],
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
    addresses: ["point_geom"],
    routing_barriers: ["barrier_type", "class_code", "admin_area_id", "confidence_score", "geom"],
};

/** PATCH keys accepted by API but stored under a canonical key. */
export const IMPORT_REVIEW_OVERRIDE_PATCH_KEY_ALIASES: Readonly<Record<string, string>> = {
    parent_admin_area_id: "parent_id",
};

export function overrideAllowlistForFamily(apiFamily: string): ReadonlySet<string> {
    return new Set(IMPORT_REVIEW_OVERRIDE_ALLOWLIST[apiFamily] ?? []);
}

export function filterOverridePatchForFamily(
    apiFamily: string,
    patch: Record<string, unknown>
): Record<string, unknown> {
    const allow = overrideAllowlistForFamily(apiFamily);
    const aliases = IMPORT_REVIEW_OVERRIDE_PATCH_KEY_ALIASES;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(patch)) {
        const canonical = aliases[key] ?? key;
        if (allow.has(canonical)) {
            out[canonical] = value;
        }
    }
    return out;
}
