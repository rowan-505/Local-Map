import type { ImportReviewEntityConfig } from "../config/types";
import type { ImportReviewOverrideFieldDef } from "../config/overrideFieldDefs";
import type { AdminAreaOption } from "@/src/components/admin-areas/adminAreaLabels";
import type { RoadClassOption } from "@/src/lib/api";
import type { ImportReviewFormOptionsBundle } from "../hooks/useImportReviewFormOptions";

export type ImportReviewFormOptionsKey = keyof ImportReviewFormOptionsBundle;

export function formOptionsKeyForField(
    config: ImportReviewEntityConfig,
    def: ImportReviewOverrideFieldDef
): ImportReviewFormOptionsKey | null {
    if (def.type === "admin_area" || def.patchKey === "admin_area_id" || def.patchKey === "parent_id") {
        return "admin_areas";
    }

    if (def.configKey === "class_code") {
        switch (config.apiFamily) {
            case "landuse":
                return "landuse_classes";
            case "water_lines":
                return "waterway_classes";
            case "water_polygons":
                return "water_classes";
            case "routing_barriers":
                return "barrier_types";
            default:
                return null;
        }
    }

    if (def.configKey === "barrier_type") {
        return "barrier_types";
    }

    if (def.configKey === "surface") {
        return "surface_presets";
    }

    switch (def.refSource) {
        case "ref_poi_categories":
            return "poi_categories";
        case "ref_road_classes":
            return "road_classes";
        case "ref_building_types":
            return "building_types";
        case "ref_landuse_classes":
            return "landuse_classes";
        case "ref_admin_levels":
            return "admin_levels";
        default:
            return null;
    }
}

export function selectOptionsForField(
    formOptions: ImportReviewFormOptionsBundle | null | undefined,
    key: ImportReviewFormOptionsKey | null
): Array<{ value: string; label: string }> {
    if (!formOptions || !key) {
        return [];
    }
    const rows = formOptions[key] ?? [];
    return rows.map((row) => ({
        value: String(row.value),
        label: row.label,
    }));
}

export function toAdminAreaComboboxOptions(
    formOptions: ImportReviewFormOptionsBundle | null | undefined
): AdminAreaOption[] {
    if (!formOptions) {
        return [];
    }
    return formOptions.admin_areas.map((row) => ({
        id: row.id,
        canonical_name: row.canonical_name,
        name_mm: row.name_mm ?? null,
        name_en: row.name_en ?? null,
        admin_level_id: row.admin_level_id,
        parent_id: row.parent_id ?? null,
    }));
}

export function roadClassOptionsFromFormOptions(
    formOptions: ImportReviewFormOptionsBundle | null | undefined
): RoadClassOption[] {
    if (!formOptions) {
        return [];
    }
    return formOptions.road_classes.map((row) => ({
        id: String(row.value),
        code: row.code?.trim() || String(row.value),
        name: row.label,
        rank: 0,
    }));
}

export function surfacePresetOptionsFromFormOptions(
    formOptions: ImportReviewFormOptionsBundle | null | undefined
): Array<{ value: string; label: string }> {
    if (!formOptions) {
        return [];
    }
    return formOptions.surface_presets.map((row) => ({
        value: String(row.value),
        label: row.label,
    }));
}

export function selectOptionsWithCurrentValue(
    options: Array<{ value: string; label: string }>,
    current: string
): Array<{ value: string; label: string }> {
    const trimmed = current.trim();
    if (!trimmed || options.some((opt) => opt.value === trimmed)) {
        return options;
    }
    return [...options, { value: trimmed, label: `${trimmed} (imported)` }];
}

export function fieldUsesSelectOptions(
    config: ImportReviewEntityConfig,
    def: ImportReviewOverrideFieldDef
): boolean {
    if (def.type === "select" || def.type === "admin_area") {
        return true;
    }
    if (
        def.configKey === "class_code" ||
        def.configKey === "landuse_class_id" ||
        def.configKey === "barrier_type" ||
        def.configKey === "surface"
    ) {
        return true;
    }
    return formOptionsKeyForField(config, def) !== null;
}
