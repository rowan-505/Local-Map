import type { ImportReviewBuildingListItem } from "@/src/lib/api";
import type { RefBuildingType } from "@/src/lib/api";

export type BuildingTypeSelectOption = {
    value: string;
    label: string;
    code?: string;
};

/** Dropdown label for an active ref row: `residential — Residential`. */
export function formatActiveBuildingTypeOptionLabel(item: {
    code: string;
    name?: string | null;
    name_mm?: string | null;
}): string {
    const code = item.code.trim();
    const name = item.name?.trim();
    if (code && name) {
        return `${code} — ${name}`;
    }
    return code || name || "";
}

export function mapRefBuildingTypesToSelectOptions(
    items: RefBuildingType[]
): BuildingTypeSelectOption[] {
    return items.map((item) => ({
        value: item.id,
        label: formatActiveBuildingTypeOptionLabel(item),
        code: item.code,
    }));
}

function readNormalizedString(data: unknown, key: string): string | null {
    if (!data || typeof data !== "object" || Array.isArray(data)) {
        return null;
    }
    const raw = (data as Record<string, unknown>)[key];
    if (raw === null || raw === undefined) {
        return null;
    }
    const text = String(raw).trim();
    return text.length > 0 ? text : null;
}

/** Read-only label for tables/drawers; safe when ref join is missing or type was retired. */
export function formatBuildingTypeDisplay(args: {
    buildingTypeCode?: string | null;
    buildingTypeName?: string | null;
    legacyBuildingType?: string | null;
    buildingTypeId?: string | null;
    normalizedData?: unknown;
}): string {
    const code = args.buildingTypeCode?.trim();
    const name = args.buildingTypeName?.trim();
    if (code) {
        return name ? `${code} — ${name}` : code;
    }

    const source =
        readNormalizedString(args.normalizedData, "source_building_type_code") ??
        readNormalizedString(args.normalizedData, "previous_building_type_code");
    if (source) {
        return `${source} (historical)`;
    }

    const legacy =
        args.legacyBuildingType?.trim() ?? readNormalizedString(args.normalizedData, "building_type");
    if (legacy) {
        return `${legacy} (historical)`;
    }

    const id = args.buildingTypeId?.trim();
    if (id) {
        return `Type #${id} (historical)`;
    }

    return "";
}

export function formatImportReviewBuildingTypeLabel(row: ImportReviewBuildingListItem): string {
    return formatBuildingTypeDisplay({
        buildingTypeCode: row.building_type_code,
        buildingTypeName: row.building_type_name,
        legacyBuildingType: row.building_type,
        buildingTypeId: row.building_type_id,
        normalizedData: row.normalized_data,
    });
}

/** Keep select usable when a row still references an inactive/deleted type id. */
export function mergeBuildingTypeSelectOptions(
    activeOptions: BuildingTypeSelectOption[],
    selectedId: string,
    selectedDisplayLabel?: string | null
): BuildingTypeSelectOption[] {
    const id = selectedId.trim();
    if (!id || activeOptions.some((opt) => opt.value === id)) {
        return activeOptions;
    }
    const label =
        selectedDisplayLabel?.trim() ||
        `ID ${id} (inactive — choose an active type)`;
    return [...activeOptions, { value: id, label }];
}
