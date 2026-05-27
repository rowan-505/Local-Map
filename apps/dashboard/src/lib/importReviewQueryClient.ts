import { QueryClient } from "@tanstack/react-query";

import { importReviewOptionsQueryDefaults } from "@/src/features/import-review/hooks/importReviewQueryConfig";

export function createDashboardQueryClient(): QueryClient {
    return new QueryClient({
        defaultOptions: {
            queries: {
                retry: 1,
                refetchOnWindowFocus: false,
            },
        },
    });
}

/** Query client for admin dashboard — import-review option queries use extended stale/gc times. */
export function createImportReviewQueryClient(): QueryClient {
    return new QueryClient({
        defaultOptions: {
            queries: {
                retry: 1,
                ...importReviewOptionsQueryDefaults,
            },
        },
    });
}
