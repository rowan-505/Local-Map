type Signal = Pick<RequestInit, "signal">;

export const SEARCH_OVERVIEW_PATH = "/admin/search/overview";

export function buildSearchOverviewRequest(init?: Signal): [string, RequestInit] {
    return [
        SEARCH_OVERVIEW_PATH,
        {
            method: "GET",
            ...init,
        },
    ];
}
