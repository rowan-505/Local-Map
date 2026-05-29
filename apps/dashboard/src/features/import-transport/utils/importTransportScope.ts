import type { ReadonlyURLSearchParams } from "next/navigation";

import type { ImportTransportListFilters, ImportTransportScopeQuery } from "../config/types";

export function importBatchIdFromTransportSearch(
    searchParams: URLSearchParams | ReadonlyURLSearchParams
): string {
    return searchParams.get("import_batch_id")?.trim() ?? "";
}

export function snapshotVersionFromTransportSearch(
    searchParams: URLSearchParams | ReadonlyURLSearchParams
): string {
    return searchParams.get("source_snapshot_version")?.trim() ?? "";
}

export function importTransportScopeQueryFromSearch(
    searchParams: URLSearchParams | ReadonlyURLSearchParams
): ImportTransportScopeQuery | null {
    const importBatchId = importBatchIdFromTransportSearch(searchParams);
    const snapshot = snapshotVersionFromTransportSearch(searchParams);
    if (importBatchId) {
        return { import_batch_id: importBatchId };
    }
    if (snapshot) {
        const latest = searchParams.get("latest") === "true";
        return latest
            ? { source_snapshot_version: snapshot, latest: true }
            : { source_snapshot_version: snapshot };
    }
    return null;
}

export function readImportTransportListFilters(
    searchParams: URLSearchParams | ReadonlyURLSearchParams
): ImportTransportListFilters {
    return {
        review_status: searchParams.get("review_status")?.trim() ?? "",
        review_decision: searchParams.get("review_decision")?.trim() ?? "",
        promotion_status: searchParams.get("promotion_status")?.trim() ?? "",
        validation_status: searchParams.get("validation_status")?.trim() ?? "",
        mode_type: searchParams.get("mode_type")?.trim() ?? "",
    };
}

export function applyImportTransportScopeSearchParams(
    params: URLSearchParams,
    scope: { snapshotInput: string; batchInput: string }
): URLSearchParams {
    const next = new URLSearchParams(params.toString());
    next.delete("source_snapshot_version");
    next.delete("import_batch_id");
    const batch = scope.batchInput.trim();
    const snapshot = scope.snapshotInput.trim();
    if (batch) {
        next.set("import_batch_id", batch);
    } else if (snapshot) {
        next.set("source_snapshot_version", snapshot);
    }
    return next;
}

export function preserveImportTransportScopeInParams(
    params: URLSearchParams | ReadonlyURLSearchParams
): URLSearchParams {
    const next = new URLSearchParams();
    const batch = params.get("import_batch_id");
    const snapshot = params.get("source_snapshot_version");
    if (batch) {
        next.set("import_batch_id", batch);
    } else if (snapshot) {
        next.set("source_snapshot_version", snapshot);
    }
    return next;
}

/** After summary/list resolves import_batch_id, prefer batch id in the URL bar. */
export function syncImportTransportUrlToResolvedBatch(
    params: URLSearchParams,
    importBatchId: string
): void {
    const id = importBatchId.trim();
    if (!id) {
        return;
    }
    params.delete("source_snapshot_version");
    params.delete("latest");
    params.set("import_batch_id", id);
}
