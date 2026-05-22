import type { RefSource } from "./refSources";
import type { ImportReviewEntityConfig } from "./types";
import { overrideAllowlistForFamily } from "./overrideAllowlist";
import {
    IMPORT_REVIEW_NAME_EN_HELPER,
    IMPORT_REVIEW_NAME_MM_HELPER,
} from "../utils/importReviewNameFields";

export type ImportReviewOverrideFieldType = "text" | "number" | "boolean" | "select" | "textarea" | "admin_area";

export type ImportReviewOverrideFieldDef = {
    configKey: string;
    patchKey: string;
    label: string;
    helperText?: string;
    type: ImportReviewOverrideFieldType;
    refSource?: RefSource;
    importedFrom?: "row" | "normalized";
    importedKey?: string;
    min?: number;
    max?: number;
    section?: "names" | "classification" | "address";
};

const FIELD = (def: ImportReviewOverrideFieldDef): ImportReviewOverrideFieldDef => def;

const NAME_MM = FIELD({
    configKey: "name_mm",
    patchKey: "name_mm",
    label: "Myanmar name",
    helperText: IMPORT_REVIEW_NAME_MM_HELPER,
    type: "text",
    importedFrom: "row",
    section: "names",
});

const NAME_EN = FIELD({
    configKey: "name_en",
    patchKey: "name_en",
    label: "English name",
    helperText: IMPORT_REVIEW_NAME_EN_HELPER,
    type: "text",
    importedFrom: "row",
    section: "names",
});

export const IMPORT_REVIEW_OVERRIDE_FIELD_REGISTRY: Record<string, ImportReviewOverrideFieldDef> = {
    name_mm: NAME_MM,
    name_en: NAME_EN,
    class_code: FIELD({
        configKey: "class_code",
        patchKey: "class_code",
        label: "Class code",
        type: "select",
        importedFrom: "row",
        section: "classification",
    }),
    building_type_id: FIELD({
        configKey: "building_type_id",
        patchKey: "building_type_id",
        label: "Building type",
        type: "select",
        refSource: "ref_building_types",
        importedFrom: "row",
        section: "classification",
    }),
    landuse_class_id: FIELD({
        configKey: "landuse_class_id",
        patchKey: "landuse_class_id",
        label: "Landuse class",
        helperText: "Category from ref.ref_landuse_classes — not the feature display name.",
        type: "select",
        refSource: "ref_landuse_classes",
        importedFrom: "row",
        section: "classification",
    }),
    levels: FIELD({
        configKey: "levels",
        patchKey: "levels",
        label: "Levels",
        type: "number",
        importedFrom: "row",
        section: "classification",
    }),
    height_m: FIELD({
        configKey: "height_m",
        patchKey: "height_m",
        label: "Height (m)",
        type: "number",
        importedFrom: "row",
        section: "classification",
    }),
    category_id: FIELD({
        configKey: "category_id",
        patchKey: "category_id",
        label: "Category",
        type: "select",
        refSource: "ref_poi_categories",
        importedFrom: "normalized",
        importedKey: "category_id",
        section: "classification",
    }),
    stop_code: FIELD({
        configKey: "stop_code",
        patchKey: "stop_code",
        label: "Stop code",
        type: "text",
        importedFrom: "normalized",
        section: "classification",
    }),
    admin_area_id: FIELD({
        configKey: "admin_area_id",
        patchKey: "admin_area_id",
        label: "Admin area",
        type: "admin_area",
        importedFrom: "row",
        section: "classification",
    }),
    road_class_id: FIELD({
        configKey: "road_class_id",
        patchKey: "road_class_id",
        label: "Road class",
        type: "select",
        refSource: "ref_road_classes",
        importedFrom: "normalized",
        importedKey: "road_class_id",
        section: "classification",
    }),
    surface: FIELD({
        configKey: "surface",
        patchKey: "surface",
        label: "Surface",
        type: "text",
        importedFrom: "normalized",
        section: "classification",
    }),
    is_oneway: FIELD({
        configKey: "is_oneway",
        patchKey: "is_oneway",
        label: "One-way",
        type: "boolean",
        importedFrom: "normalized",
        section: "classification",
    }),
    full_address: FIELD({
        configKey: "full_address",
        patchKey: "full_address",
        label: "Full address",
        type: "textarea",
        importedFrom: "normalized",
        section: "address",
    }),
    house_number: FIELD({
        configKey: "house_number",
        patchKey: "house_number",
        label: "House number",
        type: "text",
        importedFrom: "normalized",
        section: "address",
    }),
    street_name: FIELD({
        configKey: "street_name",
        patchKey: "street_name",
        label: "Street name",
        type: "text",
        importedFrom: "normalized",
        section: "address",
    }),
    quarter: FIELD({
        configKey: "quarter",
        patchKey: "quarter",
        label: "Quarter",
        type: "text",
        importedFrom: "normalized",
        section: "address",
    }),
    township: FIELD({
        configKey: "township",
        patchKey: "township",
        label: "Township",
        type: "text",
        importedFrom: "normalized",
        section: "address",
    }),
    city: FIELD({
        configKey: "city",
        patchKey: "city",
        label: "City",
        type: "text",
        importedFrom: "normalized",
        section: "address",
    }),
    postcode: FIELD({
        configKey: "postcode",
        patchKey: "postcode",
        label: "Postcode",
        type: "text",
        importedFrom: "normalized",
        section: "address",
    }),
    plus_code: FIELD({
        configKey: "plus_code",
        patchKey: "plus_code",
        label: "Plus code",
        type: "text",
        importedFrom: "normalized",
        section: "address",
    }),
    admin_level_id: FIELD({
        configKey: "admin_level_id",
        patchKey: "admin_level_id",
        label: "Admin level",
        type: "select",
        refSource: "ref_admin_levels",
        importedFrom: "normalized",
        importedKey: "admin_level_id",
        section: "classification",
    }),
    parent_id: FIELD({
        configKey: "parent_id",
        patchKey: "parent_id",
        label: "Parent admin area",
        type: "admin_area",
        importedFrom: "normalized",
        importedKey: "parent_id",
        section: "classification",
    }),
    slug: FIELD({
        configKey: "slug",
        patchKey: "slug",
        label: "Slug",
        type: "text",
        importedFrom: "normalized",
        section: "classification",
    }),
    barrier_type: FIELD({
        configKey: "barrier_type",
        patchKey: "barrier_type",
        label: "Barrier type",
        type: "text",
        importedFrom: "normalized",
        section: "classification",
    }),
};

function classCodeLabel(config: ImportReviewEntityConfig): string {
    switch (config.apiFamily) {
        case "landuse":
            return "Landuse class";
        case "water_lines":
            return "Waterway class";
        case "water_polygons":
            return "Water class";
        default:
            return "Class code";
    }
}

function withEntityLabel(
    def: ImportReviewOverrideFieldDef,
    config: ImportReviewEntityConfig
): ImportReviewOverrideFieldDef {
    if (def.configKey === "class_code") {
        return { ...def, label: classCodeLabel(config) };
    }
    return def;
}

export function overrideFieldDefsForEntity(config: ImportReviewEntityConfig): ImportReviewOverrideFieldDef[] {
    const seen = new Set<string>();
    const out: ImportReviewOverrideFieldDef[] = [];
    const allow = overrideAllowlistForFamily(config.apiFamily);

    for (const key of config.overrideEditableFields) {
        const def = IMPORT_REVIEW_OVERRIDE_FIELD_REGISTRY[key];
        if (!def) {
            const fallback: ImportReviewOverrideFieldDef = {
                configKey: key,
                patchKey: key,
                label: key,
                type: "text",
                importedFrom: "row",
                section: "classification",
            };
            if (!allow.has(fallback.patchKey) || seen.has(fallback.patchKey)) {
                continue;
            }
            seen.add(fallback.patchKey);
            out.push(withEntityLabel(fallback, config));
            continue;
        }
        if (!allow.has(def.patchKey) || seen.has(def.patchKey)) {
            continue;
        }
        seen.add(def.patchKey);
        out.push(withEntityLabel(def, config));
    }
    return out;
}

export function groupOverrideFieldDefs(defs: ImportReviewOverrideFieldDef[]): {
    names: ImportReviewOverrideFieldDef[];
    classification: ImportReviewOverrideFieldDef[];
    address: ImportReviewOverrideFieldDef[];
} {
    const names: ImportReviewOverrideFieldDef[] = [];
    const classification: ImportReviewOverrideFieldDef[] = [];
    const address: ImportReviewOverrideFieldDef[] = [];

    for (const def of defs) {
        const section = def.section ?? (def.patchKey === "name_mm" || def.patchKey === "name_en" ? "names" : "classification");
        if (section === "names") {
            names.push(def);
        } else if (section === "address") {
            address.push(def);
        } else {
            classification.push(def);
        }
    }

    return { names, classification, address };
}
