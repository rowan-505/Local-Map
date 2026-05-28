export type BuildingTypeRefDto = {
    id: string;
    code: string;
    name: string;
    name_mm: string | null;
    parent_id: string | null;
};

type BuildingTypeRowFields = {
    building_type_id?: string | null;
    ref_bt_id?: string | null;
    ref_bt_code?: string | null;
    ref_bt_name?: string | null;
    ref_bt_name_mm?: string | null;
    ref_bt_parent_id?: string | null;
    building_type_code?: string | null;
    building_type_name?: string | null;
    building_type_name_mm?: string | null;
    class_code?: string | null;
};

function nonEmpty(value: string | null | undefined): string | null {
    if (value === null || value === undefined) {
        return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

/** Flat code for API/tiles: ref join, then legacy class_code. */
export function resolveBuildingTypeCode(row: BuildingTypeRowFields): string | null {
    return (
        nonEmpty(row.building_type_code) ??
        nonEmpty(row.ref_bt_code) ??
        nonEmpty(row.class_code)
    );
}

export function resolveBuildingTypeName(
    row: BuildingTypeRowFields,
    code: string | null
): string | null {
    return nonEmpty(row.building_type_name) ?? nonEmpty(row.ref_bt_name) ?? code;
}

export function resolveBuildingTypeNameMm(row: BuildingTypeRowFields): string | null {
    return nonEmpty(row.building_type_name_mm) ?? nonEmpty(row.ref_bt_name_mm);
}

/** Nested ref object; includes inactive/historical FK rows when ref row still exists. */
export function buildBuildingTypeRef(row: BuildingTypeRowFields): BuildingTypeRefDto | null {
    const code = resolveBuildingTypeCode(row);
    if (!code) {
        return null;
    }

    const id = nonEmpty(row.ref_bt_id) ?? nonEmpty(row.building_type_id);
    if (!id) {
        return null;
    }

    return {
        id,
        code,
        name: resolveBuildingTypeName(row, code) ?? code,
        name_mm: resolveBuildingTypeNameMm(row),
        parent_id: row.ref_bt_parent_id ?? null,
    };
}
