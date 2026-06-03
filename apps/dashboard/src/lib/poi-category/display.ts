export type PoiCategoryLabelFields = {
    id?: string;
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
    if (displayName) {
        return displayName;
    }
    if (code) {
        return code;
    }
    const id = String(option.id ?? "").trim();
    return id ? `Category #${id}` : "Category";
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

export function filterPoiCategoryDropdownOptions(
    options: readonly PoiCategoryDropdownOption[],
    filterQuery: string
): PoiCategoryDropdownOption[] {
    const q = filterQuery.trim().toLowerCase();
    if (!q) {
        return [...options];
    }
    return options.filter((option) => option.searchText.toLowerCase().includes(q));
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
        id,
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

function comparePoiCategoryDropdownOptions(
    a: PoiCategoryDropdownOption,
    b: PoiCategoryDropdownOption
): number {
    const aParent = isPoiParentCategory(a);
    const bParent = isPoiParentCategory(b);
    if (aParent !== bParent) {
        return aParent ? -1 : 1;
    }
    if (!aParent && !bParent) {
        const parentCmp = String(a.parent_id ?? "").localeCompare(String(b.parent_id ?? ""));
        if (parentCmp !== 0) {
            return parentCmp;
        }
    }
    return a.label.localeCompare(b.label, undefined, { sensitivity: "base" });
}

export function dedupePoiCategoryDropdownOptions(
    options: readonly PoiCategoryDropdownOption[]
): PoiCategoryDropdownOption[] {
    const seen = new Set<string>();
    const out: PoiCategoryDropdownOption[] = [];
    for (const option of options) {
        const key = option.value.trim();
        if (!key || seen.has(key)) {
            continue;
        }
        seen.add(key);
        out.push(option);
    }
    return out;
}

export function missingPoiCategoryOption(categoryId: string): PoiCategoryDropdownOption {
    const id = categoryId.trim();
    return normalizePoiCategoryDropdownOption({
        id,
        value: id,
        code: null,
        name: `Missing category #${id}`,
        name_mm: null,
    });
}

export function withMissingPoiCategorySelection(
    options: readonly PoiCategoryDropdownOption[],
    selectedValue: string | null | undefined
): PoiCategoryDropdownOption[] {
    const id = selectedValue?.trim() ?? "";
    if (!id || options.some((option) => option.value === id)) {
        return [...options];
    }
    return [...options, missingPoiCategoryOption(id)];
}

export type PoiCategoryDropdownInput = {
    id?: string | number;
    value?: string | number;
    code?: string | null;
    name?: string | null;
    name_mm?: string | null;
    parent_id?: string | null;
};

export function buildPoiCategoryDropdownOptions(
    rows: readonly PoiCategoryDropdownInput[],
    args?: { selectedValue?: string | null }
): PoiCategoryDropdownOption[] {
    const normalized = rows.map((row) => {
        const payload: Parameters<typeof normalizePoiCategoryDropdownOption>[0] = {
            id: row.id ?? row.value,
            value: row.value ?? row.id,
            code: row.code ?? null,
            name: row.name ?? null,
            name_mm: row.name_mm ?? null,
        };
        if (Object.prototype.hasOwnProperty.call(row, "parent_id")) {
            payload.parent_id = row.parent_id ?? null;
        }
        return normalizePoiCategoryDropdownOption(payload);
    });
    const deduped = dedupePoiCategoryDropdownOptions(normalized).sort(comparePoiCategoryDropdownOptions);
    return withMissingPoiCategorySelection(deduped, args?.selectedValue);
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
    name?: string | null;
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
