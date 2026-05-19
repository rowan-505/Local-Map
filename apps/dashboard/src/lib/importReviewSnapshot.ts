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

    if (b) {
        params.set("review_batch_id", b);
    } else {
        params.delete("review_batch_id");
        setImportReviewSnapshotSearchParam(params, s);
    }
}
