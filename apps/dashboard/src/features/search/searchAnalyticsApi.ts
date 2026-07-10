import type { SearchAnalyticsFilters } from "./types";

type Signal = Pick<RequestInit, "signal">;

export const SEARCH_ANALYTICS_PATH = "/admin/search/analytics";

export function buildSearchAnalyticsRequest(
    filters: SearchAnalyticsFilters = {},
    init?: Signal,
): [string, RequestInit] {
    const sp = new URLSearchParams();
    if (filters.period) sp.set("period", filters.period);
    if (filters.from) sp.set("from", filters.from);
    if (filters.to) sp.set("to", filters.to);

    const qs = sp.toString();
    return [`${SEARCH_ANALYTICS_PATH}${qs ? `?${qs}` : ""}`, { method: "GET", ...init }];
}
