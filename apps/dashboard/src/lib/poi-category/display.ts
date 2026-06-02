export type PoiCategoryLabelFields = {
    code?: string | null;
    name?: string | null;
    name_mm?: string | null;
    nameMm?: string | null;
    parent_id?: string | null;
    parentId?: string | null;
};

export type PoiCategoryDropdownOption = PoiCategoryLabelFields & {
    id: string;
    value: string;
    label: string;
    searchText: string;
};

export function getPoiCategoryDisplayText(option: PoiCategoryLabelFields): string {
    const code = String(option.code ?? "").trim();
    const mm = String(option.name_mm ?? option.nameMm ?? "").trim();
    const en = String(option.name ?? "").trim();
    const displayName = mm || en;

    if (code && displayName) {
        return `${code} — ${displayName}`;
    }
    return displayName || code || "Unknown category";
}

export function isPoiParentCategory(option: PoiCategoryLabelFields): boolean {
    if (Object.prototype.hasOwnProperty.call(option, "parent_id")) {
        return option.parent_id === null;
    }
    if (Object.prototype.hasOwnProperty.call(option, "parentId")) {
        return option.parentId === null;
    }
    return false;
}

export function poiCategoryOptionSearchText(option: PoiCategoryLabelFields & { label?: string }): string {
    const code = String(option.code ?? "").trim();
    const mm = String(option.name_mm ?? option.nameMm ?? "").trim();
    const en = String(option.name ?? "").trim();
    const label = option.label ?? getPoiCategoryDisplayText(option);
    return [code, en, mm, label].filter(Boolean).join(" ");
}

export function normalizePoiCategoryDropdownOption(input: {
    id?: string | number;
    value?: string | number;
    code?: string | null;
    name?: string | null;
    name_mm?: string | null;
    nameMm?: string | null;
    parent_id?: string | null;
    parentId?: string | null;
}): PoiCategoryDropdownOption {
    const id = String(input.id ?? input.value ?? "");
    const code = input.code ?? null;
    const name = input.name ?? null;
    const name_mm = input.name_mm ?? input.nameMm ?? null;

    const fields: PoiCategoryLabelFields = {
        code,
        name,
        name_mm,
    };

    if (Object.prototype.hasOwnProperty.call(input, "parent_id")) {
        fields.parent_id = input.parent_id ?? null;
    } else if (Object.prototype.hasOwnProperty.call(input, "parentId")) {
        fields.parentId = input.parentId ?? null;
    }

    const label = getPoiCategoryDisplayText(fields);

    return {
        id,
        value: id,
        code,
        name,
        name_mm,
        ...fields,
        label,
        searchText: poiCategoryOptionSearchText({ ...fields, label }),
    };
}

export function importReviewFormOptionToPoiCategory(row: {
    id?: string;
    value: string | number;
    code?: string | null;
    name?: string | null;
    name_mm?: string | null;
    parent_id?: string | null;
}): PoiCategoryDropdownOption {
    const payload: Parameters<typeof normalizePoiCategoryDropdownOption>[0] = {
        id: row.id ?? String(row.value),
        value: row.value,
        code: row.code,
        name: row.name,
        name_mm: row.name_mm,
    };
    if (Object.prototype.hasOwnProperty.call(row, "parent_id")) {
        payload.parent_id = row.parent_id ?? null;
    }
    return normalizePoiCategoryDropdownOption(payload);
}

export function placeFormOptionToPoiCategory(row: {
    id: string;
    code?: string;
    name?: string;
    name_mm?: string | null;
    parent_id?: string | null;
}): PoiCategoryDropdownOption {
    const payload: Parameters<typeof normalizePoiCategoryDropdownOption>[0] = {
        id: row.id,
        value: row.id,
        code: row.code ?? null,
        name: row.name ?? null,
        name_mm: row.name_mm ?? null,
    };
    if (Object.prototype.hasOwnProperty.call(row, "parent_id")) {
        payload.parent_id = row.parent_id ?? null;
    }
    return normalizePoiCategoryDropdownOption(payload);
}
