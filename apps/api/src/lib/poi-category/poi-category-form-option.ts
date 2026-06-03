export type PoiCategoryOptionRow = {
    id: bigint;
    code: string;
    name: string | null;
    name_mm: string | null;
    parent_id: bigint | null;
    sort_order: number;
    is_public: boolean;
    is_searchable: boolean;
};

export type PoiCategoryFormOption = {
    id: string;
    value: string;
    label: string;
    code: string;
    name: string | null;
    name_mm: string | null;
    parent_id: string | null;
    sort_order: number;
    is_public: boolean;
    is_searchable: boolean;
};

export function getPoiCategoryDisplayText(input: {
    code?: string | null;
    name?: string | null;
    name_mm?: string | null;
}): string {
    const code = String(input.code ?? "").trim();
    const mm = String(input.name_mm ?? "").trim();
    const en = String(input.name ?? "").trim();
    const displayName = mm || en;

    if (code && displayName) {
        return `${code} — ${displayName}`;
    }
    if (displayName) {
        return displayName;
    }
    if (code) {
        return code;
    }
    return "Category";
}

export function poiCategoryRowToFormOption(row: PoiCategoryOptionRow): PoiCategoryFormOption {
    const id = row.id.toString();
    const name = row.name?.trim() || null;
    const name_mm = row.name_mm?.trim() || null;
    const parent_id = row.parent_id === null || row.parent_id === undefined ? null : row.parent_id.toString();

    return {
        id,
        value: id,
        label: getPoiCategoryDisplayText({
            code: row.code,
            name,
            name_mm,
        }),
        code: row.code,
        name,
        name_mm,
        parent_id,
        sort_order: row.sort_order,
        is_public: row.is_public,
        is_searchable: row.is_searchable,
    };
}
