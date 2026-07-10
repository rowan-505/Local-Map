import type { SearchAliasesListFilters } from "./types";

type Signal = Pick<RequestInit, "signal">;

export const SEARCH_ALIASES_PATH = "/admin/search/aliases";

function appendString(sp: URLSearchParams, key: string, value: string | undefined) {
    const trimmed = value?.trim();
    if (trimmed) sp.set(key, trimmed);
}

export function buildSearchAliasesRequest(
    filters: SearchAliasesListFilters = {},
    init?: Signal,
): [string, RequestInit] {
    const sp = new URLSearchParams();
    appendString(sp, "q", filters.q);
    appendString(sp, "entity_type", filters.entity_type);
    appendString(sp, "language_code", filters.language_code);
    appendString(sp, "alias_type", filters.alias_type);
    if (filters.is_active !== undefined) sp.set("is_active", String(filters.is_active));
    appendString(sp, "entity_id", filters.entity_id);
    if (filters.has_indexed_entity !== undefined) {
        sp.set("has_indexed_entity", String(filters.has_indexed_entity));
    }
    appendString(sp, "sort", filters.sort);
    if (filters.order) sp.set("order", filters.order);
    if (filters.page !== undefined) sp.set("page", String(filters.page));
    if (filters.pageSize !== undefined) sp.set("pageSize", String(filters.pageSize));

    const qs = sp.toString();
    return [`${SEARCH_ALIASES_PATH}${qs ? `?${qs}` : ""}`, { method: "GET", ...init }];
}
