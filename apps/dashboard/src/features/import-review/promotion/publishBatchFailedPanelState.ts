export type PublishBatchFailedPanelFetchState = "idle" | "loading" | "loaded" | "error";

export function shouldShowFailedItemsTable(
    fetchState: PublishBatchFailedPanelFetchState,
    detailRowCount: number
): boolean {
    return fetchState === "loaded" && detailRowCount > 0;
}

export function shouldShowMissingStoredDetailsMessage(
    fetchState: PublishBatchFailedPanelFetchState,
    detailRowCount: number,
    failedCount: number
): boolean {
    return fetchState === "loaded" && detailRowCount === 0 && failedCount > 0;
}

export function shouldShowFailedItemsFetchError(
    fetchState: PublishBatchFailedPanelFetchState,
    loadError: string | null
): boolean {
    return fetchState === "error" && loadError != null;
}
