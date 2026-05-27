import {
    ImportReviewBatchAmbiguousError,
    isImportReviewBatchAmbiguousError,
} from "@/src/lib/api";

export type ParsedImportReviewApiError = {
    code: string;
    message: string;
    details: unknown;
};

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

/** Parses `{ ok: false, error, message, details? }` from the import-review API. */
export function parseImportReviewApiErrorBody(
    data: Record<string, unknown>
): ParsedImportReviewApiError | null {
    if (data.ok !== false) {
        return null;
    }

    const message =
        typeof data.message === "string" && data.message.trim()
            ? data.message.trim()
            : "Request failed.";

    const code =
        typeof data.error === "string" && data.error.trim() ? data.error.trim() : "UNKNOWN_ERROR";

    return {
        code,
        message,
        details: data.details ?? null,
    };
}

/** User-facing text from a parsed or legacy JSON error body. */
export function formatImportReviewApiErrorBody(
    data: Record<string, unknown>,
    fallback = "Request failed.",
    options?: { includeTechnicalDetails?: boolean }
): string {
    if (data.error === "MULTIPLE_REVIEW_BATCHES") {
        return (
            (typeof data.message === "string" && data.message.trim()) ||
            "Multiple review batches match this snapshot. Select a batch below."
        );
    }

    const parsed = parseImportReviewApiErrorBody(data);
    if (parsed) {
        let message = parsed.message;
        if (options?.includeTechnicalDetails && parsed.details != null) {
            const isDev =
                typeof process !== "undefined" && process.env.NODE_ENV === "development";
            if (isDev) {
                try {
                    const block = JSON.stringify(parsed.details, null, 2);
                    if (block && block !== "null") {
                        message = `${message}\n\n${block}`;
                    }
                } catch {
                    // ignore non-serializable details
                }
            }
        }
        return message;
    }

    const headline: string[] = [];
    if (typeof data.message === "string" && data.message.trim()) {
        headline.push(data.message.trim());
    }
    if (typeof data.error === "string" && data.error.trim()) {
        headline.push(data.error.trim());
    }
    return headline.length > 0 ? headline.join(" — ") : fallback;
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
