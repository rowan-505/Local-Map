import type { ImportReviewEntityConfig } from "./types";

export type DashboardEssentialFieldRule =
    | { kind: "field"; key: string }
    | { kind: "at_least_one"; keys: readonly string[] }
    | { kind: "geometry" };

const ESSENTIAL_BY_API_FAMILY: Record<string, readonly DashboardEssentialFieldRule[]> = {
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

export function essentialRulesForEntity(config: ImportReviewEntityConfig): readonly DashboardEssentialFieldRule[] {
    return ESSENTIAL_BY_API_FAMILY[config.apiFamily] ?? [];
}

export function isFieldEssentialForEntity(config: ImportReviewEntityConfig, configKey: string): boolean {
    for (const rule of essentialRulesForEntity(config)) {
        if (rule.kind === "field" && rule.key === configKey) {
            return true;
        }
        if (rule.kind === "at_least_one" && rule.keys.includes(configKey)) {
            return true;
        }
    }
    return false;
}

export function isGeometryEssentialForEntity(config: ImportReviewEntityConfig): boolean {
    return essentialRulesForEntity(config).some((rule) => rule.kind === "geometry");
}

export function essentialFieldLabel(configKey: string): string {
    if (configKey === "category_id" || configKey === "poi_category_id") {
        return "Category";
    }
    return configKey;
}

export const ESSENTIAL_FIELD_MARKER = "*";

export function labelWithEssentialMarker(label: string, essential: boolean): string {
    return essential ? `${label} ${ESSENTIAL_FIELD_MARKER}` : label;
}
