import type { ImportReviewEntityFamilySlug } from "./import-review-config.js";

export type ImportReviewEssentialFieldRule =
    | { kind: "field"; key: string }
    | { kind: "at_least_one"; keys: readonly string[] }
    | { kind: "geometry" };

/** Default confidence when candidate column is null (0–100 scale). */
export const IMPORT_REVIEW_DEFAULT_CONFIDENCE_SCORE = 65;

export const IMPORT_REVIEW_BUS_STOP_UNNAMED_NAME_MM = "Unnamed bus stop";

export const POI_CATEGORY_FALLBACK_CODES = ["unknown", "other"] as const;
export const BUILDING_TYPE_FALLBACK_CODES = ["yes", "unknown", "building"] as const;
export const ROAD_CLASS_FALLBACK_CODES = [
    "local",
    "residential",
    "unclassified",
    "unknown",
    "service",
] as const;

/** Entity families that receive a default confidence_score on approve when missing. */
export const IMPORT_REVIEW_CONFIDENCE_DEFAULT_FAMILIES: ReadonlySet<ImportReviewEntityFamilySlug> = new Set([
    "places",
    "buildings",
    "roads",
]);

export const IMPORT_REVIEW_ESSENTIAL_FIELD_RULES: Partial<
    Record<ImportReviewEntityFamilySlug, readonly ImportReviewEssentialFieldRule[]>
> = {
    bus_stops: [
        { kind: "field", key: "name_mm" },
        { kind: "field", key: "admin_area_id" },
        { kind: "geometry" },
    ],
    places: [
        { kind: "at_least_one", keys: ["name_mm", "name_en"] },
        { kind: "field", key: "category_id" },
        { kind: "field", key: "admin_area_id" },
        { kind: "geometry" },
    ],
    roads: [
        { kind: "field", key: "road_class_id" },
        { kind: "field", key: "admin_area_id" },
        { kind: "geometry" },
    ],
    buildings: [
        { kind: "field", key: "building_type_id" },
        { kind: "field", key: "admin_area_id" },
        { kind: "geometry" },
    ],
    landuse: [{ kind: "field", key: "landuse_class_id" }, { kind: "geometry" }],
    water_lines: [{ kind: "field", key: "class_code" }, { kind: "geometry" }],
    water_polygons: [{ kind: "field", key: "class_code" }, { kind: "geometry" }],
};

export function essentialFieldKeysForFamily(family: ImportReviewEntityFamilySlug): Set<string> {
    const rules = IMPORT_REVIEW_ESSENTIAL_FIELD_RULES[family] ?? [];
    const keys = new Set<string>();
    for (const rule of rules) {
        if (rule.kind === "field") {
            keys.add(rule.key);
        } else if (rule.kind === "at_least_one") {
            for (const key of rule.keys) {
                keys.add(key);
            }
        }
    }
    return keys;
}

export function isGeometryEssentialForFamily(family: ImportReviewEntityFamilySlug): boolean {
    return (IMPORT_REVIEW_ESSENTIAL_FIELD_RULES[family] ?? []).some((rule) => rule.kind === "geometry");
}
