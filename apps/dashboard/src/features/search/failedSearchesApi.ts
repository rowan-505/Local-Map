import type { FailedSearchesListFilters } from "./types";

type Signal = Pick<RequestInit, "signal">;

export const FAILED_SEARCHES_PATH = "/admin/search/failed-searches";

function appendString(sp: URLSearchParams, key: string, value: string | undefined) {
    const trimmed = value?.trim();
    if (trimmed) sp.set(key, trimmed);
}

export function buildFailedSearchesRequest(
    filters: FailedSearchesListFilters = {},
    init?: Signal,
): [string, RequestInit] {
    const sp = new URLSearchParams();
    appendString(sp, "q", filters.q);
    appendString(sp, "lang", filters.lang);
    if (filters.resolved !== undefined) sp.set("resolved", String(filters.resolved));
    appendString(sp, "last_seen_from", filters.last_seen_from);
    appendString(sp, "last_seen_to", filters.last_seen_to);
    if (filters.min_occurrence !== undefined) {
        sp.set("min_occurrence", String(filters.min_occurrence));
    }
    appendString(sp, "sort", filters.sort);
    if (filters.order) sp.set("order", filters.order);
    if (filters.page !== undefined) sp.set("page", String(filters.page));
    if (filters.pageSize !== undefined) sp.set("pageSize", String(filters.pageSize));

    const qs = sp.toString();
    return [`${FAILED_SEARCHES_PATH}${qs ? `?${qs}` : ""}`, { method: "GET", ...init }];
}
