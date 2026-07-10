/**
 * Canonical vocabulary for `search.search_index_runs.status`.
 *
 * Rebuild functions write `running` at start, then `completed` or `failed` at end.
 * The table constraint also allows legacy `pending` and `success`; new runs use
 * `completed` for success — not `success`.
 */

export const SEARCH_INDEX_RUN_STATUS = {
    PENDING: "pending",
    RUNNING: "running",
    COMPLETED: "completed",
    FAILED: "failed",
} as const;

export type SearchIndexRunTerminalStatus =
    | typeof SEARCH_INDEX_RUN_STATUS.COMPLETED
    | typeof SEARCH_INDEX_RUN_STATUS.FAILED;

/** Status values written by `search.rebuild_search_documents` on success. */
export const SEARCH_INDEX_RUN_SUCCESSFUL_STATUSES: readonly SearchIndexRunTerminalStatus[] = [
    SEARCH_INDEX_RUN_STATUS.COMPLETED,
];

export function isSearchIndexRunSuccessful(status: string | null | undefined): boolean {
    return status === SEARCH_INDEX_RUN_STATUS.COMPLETED;
}

export function isSearchIndexRunFailed(status: string | null | undefined): boolean {
    return status === SEARCH_INDEX_RUN_STATUS.FAILED;
}

export function isSearchIndexRunInProgress(status: string | null | undefined): boolean {
    return (
        status === SEARCH_INDEX_RUN_STATUS.RUNNING || status === SEARCH_INDEX_RUN_STATUS.PENDING
    );
}

/** SQL fragment: `status = 'completed'` for successful rebuild lookups. */
export const SEARCH_INDEX_RUN_SUCCESSFUL_STATUS_SQL = `'${SEARCH_INDEX_RUN_STATUS.COMPLETED}'`;
