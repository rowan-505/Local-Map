import type { RefSource } from "./refSources";
import type { ImportReviewEntityConfig } from "./types";

export type ImportReviewOverrideFieldType = "text" | "number" | "boolean" | "select" | "textarea";

export type ImportReviewOverrideFieldDef = {
    /** Key listed on entity config `overrideEditableFields`. */
    configKey: string;
    /** Key written into `review_overrides` JSON (defaults to configKey). */
    patchKey: string;
    label: string;
    type: ImportReviewOverrideFieldType;
    refSource?: RefSource;
    /** Where to read imported/staging display value. */
    importedFrom?: "row" | "normalized";
    importedKey?: string;
    min?: number;
    max?: number;
};

const FIELD = (def: ImportReviewOverrideFieldDef): ImportReviewOverrideFieldDef => def;

export const IMPORT_REVIEW_OVERRIDE_FIELD_REGISTRY: Record<string, ImportReviewOverrideFieldDef> = {
    name: FIELD({ configKey: "name", patchKey: "name", label: "name", type: "text", importedFrom: "row" }),
    canonical_name: FIELD({
        configKey: "canonical_name",
        patchKey: "canonical_name",
        label: "canonical_name",
        type: "text",
        importedFrom: "row",
    }),
    class_code: FIELD({
        configKey: "class_code",
        patchKey: "class_code",
        label: "class_code",
        type: "text",
        importedFrom: "row",
    }),
    building_type: FIELD({
        configKey: "building_type",
        patchKey: "building_type",
        label: "building_type",
        type: "text",
        importedFrom: "row",
    }),
    building_type_id: FIELD({
        configKey: "building_type_id",
        patchKey: "building_type_id",
        label: "building_type_id",
        type: "select",
        refSource: "ref_building_types",
        importedFrom: "row",
    }),
    levels: FIELD({
        configKey: "levels",
        patchKey: "levels",
        label: "levels",
        type: "number",
        importedFrom: "row",
    }),
    height_m: FIELD({
        configKey: "height_m",
        patchKey: "height_m",
        label: "height_m",
        type: "number",
        importedFrom: "row",
    }),
    poi_category_id: FIELD({
        configKey: "poi_category_id",
        patchKey: "poi_category_id",
        label: "poi_category_id",
        type: "select",
        refSource: "ref_poi_categories",
        importedFrom: "normalized",
        importedKey: "poi_category_id",
    }),
    category_id: FIELD({
        configKey: "category_id",
        patchKey: "poi_category_id",
        label: "category_id",
        type: "select",
        refSource: "ref_poi_categories",
        importedFrom: "normalized",
        importedKey: "category_id",
    }),
    importance_score: FIELD({
        configKey: "importance_score",
        patchKey: "importance_score",
        label: "importance_score",
        type: "number",
        importedFrom: "normalized",
        min: 0,
        max: 100,
    }),
    popularity_score: FIELD({
        configKey: "popularity_score",
        patchKey: "popularity_score",
        label: "popularity_score",
        type: "number",
        importedFrom: "normalized",
        min: 0,
        max: 100,
    }),
    name_local: FIELD({
        configKey: "name_local",
        patchKey: "name_local",
        label: "name_local",
        type: "text",
        importedFrom: "normalized",
    }),
    stop_code: FIELD({
        configKey: "stop_code",
        patchKey: "stop_code",
        label: "stop_code",
        type: "text",
        importedFrom: "normalized",
    }),
    admin_area_id: FIELD({
        configKey: "admin_area_id",
        patchKey: "admin_area_id",
        label: "admin_area_id",
        type: "select",
        refSource: "core_admin_areas",
        importedFrom: "row",
    }),
    road_class_id: FIELD({
        configKey: "road_class_id",
        patchKey: "road_class_id",
        label: "road_class_id",
        type: "select",
        refSource: "ref_road_classes",
        importedFrom: "normalized",
        importedKey: "road_class_id",
    }),
    surface: FIELD({
        configKey: "surface",
        patchKey: "surface",
        label: "surface",
        type: "text",
        importedFrom: "normalized",
    }),
    is_oneway: FIELD({
        configKey: "is_oneway",
        patchKey: "is_oneway",
        label: "is_oneway",
        type: "boolean",
        importedFrom: "normalized",
    }),
    bridge: FIELD({ configKey: "bridge", patchKey: "bridge", label: "bridge", type: "boolean", importedFrom: "normalized" }),
    tunnel: FIELD({ configKey: "tunnel", patchKey: "tunnel", label: "tunnel", type: "boolean", importedFrom: "normalized" }),
    layer: FIELD({ configKey: "layer", patchKey: "layer", label: "layer", type: "number", importedFrom: "normalized" }),
    full_address: FIELD({
        configKey: "full_address",
        patchKey: "full_address",
        label: "full_address",
        type: "textarea",
        importedFrom: "normalized",
    }),
    house_number: FIELD({
        configKey: "house_number",
        patchKey: "house_number",
        label: "house_number",
        type: "text",
        importedFrom: "normalized",
    }),
    street_name: FIELD({
        configKey: "street_name",
        patchKey: "street_name",
        label: "street_name",
        type: "text",
        importedFrom: "normalized",
    }),
    quarter: FIELD({ configKey: "quarter", patchKey: "quarter", label: "quarter", type: "text", importedFrom: "normalized" }),
    township: FIELD({
        configKey: "township",
        patchKey: "township",
        label: "township",
        type: "text",
        importedFrom: "normalized",
    }),
    city: FIELD({ configKey: "city", patchKey: "city", label: "city", type: "text", importedFrom: "normalized" }),
    postcode: FIELD({
        configKey: "postcode",
        patchKey: "postcode",
        label: "postcode",
        type: "text",
        importedFrom: "normalized",
    }),
    plus_code: FIELD({
        configKey: "plus_code",
        patchKey: "plus_code",
        label: "plus_code",
        type: "text",
        importedFrom: "normalized",
    }),
    admin_level_id: FIELD({
        configKey: "admin_level_id",
        patchKey: "admin_level_id",
        label: "admin_level_id",
        type: "select",
        refSource: "ref_admin_levels",
        importedFrom: "normalized",
        importedKey: "admin_level_id",
    }),
    parent_id: FIELD({
        configKey: "parent_id",
        patchKey: "parent_id",
        label: "parent_id",
        type: "text",
        importedFrom: "normalized",
    }),
    slug: FIELD({ configKey: "slug", patchKey: "slug", label: "slug", type: "text", importedFrom: "normalized" }),
    barrier_type: FIELD({
        configKey: "barrier_type",
        patchKey: "barrier_type",
        label: "barrier_type",
        type: "text",
        importedFrom: "normalized",
    }),
    source_type_id: FIELD({
        configKey: "source_type_id",
        patchKey: "source_type_id",
        label: "source_type_id",
        type: "select",
        refSource: "ref_source_types",
        importedFrom: "normalized",
    }),
};

export function overrideFieldDefsForEntity(config: ImportReviewEntityConfig): ImportReviewOverrideFieldDef[] {
    const seen = new Set<string>();
    const out: ImportReviewOverrideFieldDef[] = [];
    for (const key of config.overrideEditableFields) {
        const def = IMPORT_REVIEW_OVERRIDE_FIELD_REGISTRY[key];
        if (!def) {
            out.push({
                configKey: key,
                patchKey: key,
                label: key,
                type: "text",
                importedFrom: "row",
            });
            continue;
        }
        if (seen.has(def.patchKey)) {
            continue;
        }
        seen.add(def.patchKey);
        out.push(def);
    }
    return out;
}
