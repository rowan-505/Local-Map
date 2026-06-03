import type { ImportReviewEntityConfig } from "../config/types";
import type { ImportReviewOverrideFieldDef } from "../config/overrideFieldDefs";
import type { AdminAreaOption } from "@/src/components/admin-areas/adminAreaLabels";
import type { RoadClassOption } from "@/src/lib/api";
import {
    formatImportReviewBuildingTypeLabel,
    mergeBuildingTypeSelectOptions,
} from "@/src/lib/building-type/display";

import type { ImportReviewFormOptionsBundle } from "../hooks/useImportReviewFormOptions";
import type { ImportReviewBuildingListItem, ImportReviewFormOption } from "@/src/lib/api";
import {
    buildPoiCategoryDropdownOptions,
    type PoiCategoryDropdownOption,
} from "@/src/lib/poi-category/display";

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

export function poiCategoryOptionsFromFormOptions(
    formOptions: ImportReviewFormOptionsBundle | null | undefined,
    selectedValue?: string | null
): PoiCategoryDropdownOption[] {
    const rows = formOptions?.poi_categories ?? [];
    return buildPoiCategoryDropdownOptions(
        rows.map((row) => ({
            id: row.id ?? String(row.value),
            value: row.value,
            code: row.code ?? null,
            name: row.name ?? null,
            name_mm: row.name_mm ?? null,
            parent_id: row.parent_id,
        })),
        { selectedValue }
    );
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

export function includeCurrentAdminAreaOption(
    options: AdminAreaOption[],
    currentId: string | null | undefined
): AdminAreaOption[] {
    const id = currentId?.trim() ?? "";
    if (!id || options.some((opt) => opt.id === id)) {
        return options;
    }
    return [
        ...options,
        {
            id,
            canonical_name: id,
            name_mm: null,
            name_en: null,
            admin_level_id: "",
            parent_id: null,
        },
    ];
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
    current: string,
    currentLabel?: string | null
): Array<{ value: string; label: string }> {
    const trimmed = current.trim();
    if (!trimmed || options.some((opt) => opt.value === trimmed)) {
        return options;
    }
    return [
        ...options,
        {
            value: trimmed,
            label: currentLabel?.trim() || `${trimmed} (imported)`,
        },
    ];
}

/** Map imported label/code/id text to a dropdown option value (numeric DB id when possible). */
export function resolveDirectEditReferenceFormValue(
    raw: string,
    options: Array<{ value: string; label: string; code?: string | null }>
): string | null {
    const trimmed = raw.trim();
    if (!trimmed) {
        return null;
    }
    if (/^\d+$/.test(trimmed)) {
        return trimmed;
    }
    return resolveOptionValueFromSource(options, trimmed);
}

export function resolveOptionValueFromSource(
    options: Array<{ value: string; label: string; code?: string | null }>,
    sourceValue: string
): string | null {
    const needle = sourceValue.trim().toLowerCase();
    if (!needle) {
        return null;
    }
    const matched = options.find((opt) => {
        const value = opt.value.trim().toLowerCase();
        const label = opt.label.trim().toLowerCase();
        const code = (opt.code ?? "").trim().toLowerCase();
        return value === needle || label === needle || (code !== "" && code === needle);
    });
    return matched?.value ?? null;
}

export function buildingTypeSelectOptionsForRow(
    formOptions: ImportReviewFormOptionsBundle | null | undefined,
    row?: ImportReviewBuildingListItem | null
): Array<{ value: string; label: string }> {
    const active = (formOptions?.building_types ?? []).map((rowOption) => ({
        value: String(rowOption.value),
        label: rowOption.label,
    }));
    if (!row) {
        return active;
    }
    return mergeBuildingTypeSelectOptions(
        active,
        row.building_type_id ?? "",
        formatImportReviewBuildingTypeLabel(row) || null
    ).map((opt) => ({ value: opt.value, label: opt.label }));
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
