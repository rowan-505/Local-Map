/** Import Review dashboards accept `source_snapshot_version` (canonical) with legacy alias `snapshot_version`. */
export function snapshotVersionFromImportReviewSearch(sp: Pick<URLSearchParams, "get">): string {
    return (
        sp.get("source_snapshot_version")?.trim() ||
        sp.get("snapshot_version")?.trim() ||
        ""
    );
}

/** Writes canonical query key and drops deprecated alias when updating the URL bar. */
export function setImportReviewSnapshotSearchParam(params: URLSearchParams, value: string): void {
    if (!value.trim()) {
        params.delete("source_snapshot_version");
        params.delete("snapshot_version");
        return;
    }

    params.set("source_snapshot_version", value.trim());
    params.delete("snapshot_version");
}

export function reviewBatchIdFromImportReviewSearch(sp: Pick<URLSearchParams, "get">): string {
    return sp.get("review_batch_id")?.trim() ?? "";
}

/**
 * Persist exactly one scope key: snapshot xor batch ID (aligned with `/api/import-review/*` XOR rules).
 */
export function applyImportReviewScopeSearchParams(params: URLSearchParams, snapshot: string, batchId: string): void {
    const s = snapshot.trim();
    const b = batchId.trim();

    params.delete("source_snapshot_version");
    params.delete("snapshot_version");
    params.delete("latest");

    if (b) {
        params.set("review_batch_id", b);
    } else {
        params.delete("review_batch_id");
        setImportReviewSnapshotSearchParam(params, s);
    }
}

/** API scope selectors derived from the URL bar (batch id xor snapshot). */
export type ImportReviewScopeQueryParams =
    | { review_batch_id: string }
    | { source_snapshot_version: string; latest?: boolean };

export type ImportReviewScopeSearchOptions = {
    /** When false, do not fall back to NEXT_PUBLIC_IMPORT_REVIEW_SNAPSHOT_VERSION (entity pages). */
    useEnvDefault?: boolean;
};

/** Build API scope params from URL search params (batch id preferred over snapshot). */
export function importReviewScopeQueryFromSearch(
    sp: Pick<URLSearchParams, "get">,
    envDefault = "",
    options?: ImportReviewScopeSearchOptions
): ImportReviewScopeQueryParams | null {
    const batch = reviewBatchIdFromImportReviewSearch(sp);
    if (batch) {
        return { review_batch_id: batch };
    }
    const useEnvDefault = options?.useEnvDefault !== false;
    const snap =
        snapshotVersionFromImportReviewSearch(sp) || (useEnvDefault ? envDefault.trim() : "");
    if (!snap) {
        return null;
    }
    const latestRaw = sp.get("latest")?.trim().toLowerCase();
    const latest = latestRaw === "true" || latestRaw === "1";
    return latest ? { source_snapshot_version: snap, latest: true } : { source_snapshot_version: snap };
}

/** Scope params safe for `/api/import-review/*` — never send snapshot when batch id is set. */
export function importReviewScopeQueryForApi(
    scope: ImportReviewScopeQueryParams | null
): ImportReviewScopeQueryParams | null {
    if (!scope) {
        return null;
    }
    if ("review_batch_id" in scope) {
        const id = scope.review_batch_id.trim();
        return id ? { review_batch_id: id } : null;
    }
    const snap = scope.source_snapshot_version.trim();
    if (!snap) {
        return null;
    }
    return scope.latest ? { source_snapshot_version: snap, latest: true } : { source_snapshot_version: snap };
}

/** Keep review_batch_id (or snapshot) when mutating filter/pagination query strings. */
export function preserveImportReviewScopeInParams(
    params: URLSearchParams,
    sp: Pick<URLSearchParams, "get">
): void {
    const batch = reviewBatchIdFromImportReviewSearch(sp);
    const snap = snapshotVersionFromImportReviewSearch(sp);
    applyImportReviewScopeSearchParams(params, snap, batch);
}

/** After resolving via snapshot, prefer stable batch-scoped URLs. */
export function syncImportReviewUrlToResolvedBatch(
    params: URLSearchParams,
    reviewBatchId: string | null | undefined
): boolean {
    const id = reviewBatchId?.trim();
    if (!id) {
        return false;
    }
    applyImportReviewScopeSearchParams(params, "", id);
    return true;
}
