import type { SearchDocumentsListFilters } from "./types";

type Signal = Pick<RequestInit, "signal">;

export const SEARCH_DOCUMENTS_PATH = "/admin/search/documents";

function appendString(sp: URLSearchParams, key: string, value: string | undefined) {
    const trimmed = value?.trim();
    if (trimmed) {
        sp.set(key, trimmed);
    }
}

export function buildSearchDocumentsRequest(
    filters: SearchDocumentsListFilters = {},
    init?: Signal,
): [string, RequestInit] {
    const sp = new URLSearchParams();
    appendString(sp, "q", filters.q);
    appendString(sp, "entity_type", filters.entity_type);
    appendString(sp, "entity_id", filters.entity_id);
    appendString(sp, "transport_mode", filters.transport_mode);
    appendString(sp, "review_status", filters.review_status);
    if (filters.is_verified !== undefined) sp.set("is_verified", String(filters.is_verified));
    if (filters.is_public !== undefined) sp.set("is_public", String(filters.is_public));
    if (filters.is_active !== undefined) sp.set("is_active", String(filters.is_active));
    if (filters.has_alias !== undefined) sp.set("has_alias", String(filters.has_alias));
    if (filters.sync_state) sp.set("sync_state", filters.sync_state);
    if (filters.language) sp.set("language", filters.language);
    appendString(sp, "sort", filters.sort);
    if (filters.order) sp.set("order", filters.order);
    if (filters.page !== undefined) sp.set("page", String(filters.page));
    if (filters.pageSize !== undefined) sp.set("pageSize", String(filters.pageSize));

    const qs = sp.toString();
    return [
        `${SEARCH_DOCUMENTS_PATH}${qs ? `?${qs}` : ""}`,
        {
            method: "GET",
            ...init,
        },
    ];
}
