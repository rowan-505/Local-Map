import {
    ImportReviewBatchAmbiguousError,
    isImportReviewBatchAmbiguousError,
} from "@/src/lib/api";

export function isImportReviewApiNetworkError(err: unknown): boolean {
    if (!(err instanceof Error)) {
        return false;
    }
    if (err.name === "AbortError") {
        return false;
    }
    const m = err.message.toLowerCase();
    return (
        m.includes("failed to fetch") ||
        m.includes("networkerror") ||
        m.includes("load failed") ||
        m.includes("network request failed") ||
        err.name === "TypeError"
    );
}

/** User-facing message for import-review API failures (400/404/409/network/auth). */
export function formatImportReviewApiError(err: unknown, fallback = "Request failed."): string {
    if (isImportReviewBatchAmbiguousError(err)) {
        return (
            err.message.trim() ||
            "Multiple review batches match this snapshot. Select a batch below."
        );
    }

    if (!(err instanceof Error)) {
        return fallback;
    }

    if (err.name === "AbortError") {
        return "";
    }

    if (isImportReviewApiNetworkError(err)) {
        return "API unavailable — check that the API server is running and reachable.";
    }

    const m = err.message;
    if (m.includes("401") || m.toLowerCase().includes("authentication") || m.includes("Session expired")) {
        return "Unauthorized — sign in with an admin-capable account.";
    }
    if (m.includes("403") || m.toLowerCase().includes("forbidden")) {
        return "Forbidden — import review endpoints require admin.";
    }
    if (m.includes("404") || m.toLowerCase().includes("not found")) {
        return m.trim() || "Not found — the requested resource may have been removed.";
    }
    if (
        m.toLowerCase().includes("multiple review batches") ||
        m.toLowerCase().includes("multiple review batches matched")
    ) {
        return "Multiple review batches match this snapshot. Select a batch below.";
    }

    return m.trim() || fallback;
}

export function importReviewAmbiguousFromError(
    err: unknown
): { sourceSnapshotVersion: string; batches: ImportReviewBatchAmbiguousError["batches"] } | null {
    if (!isImportReviewBatchAmbiguousError(err)) {
        return null;
    }
    return {
        sourceSnapshotVersion: err.sourceSnapshotVersion,
        batches: err.batches,
    };
}
