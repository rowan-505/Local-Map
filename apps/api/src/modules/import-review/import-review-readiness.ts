/**
 * Process-wide readiness flag for the import-review database bootstrap.
 *
 * The bootstrap (schema verification) runs AFTER `app.listen()` so a slow or
 * unreachable Supabase connection can never delay the HTTP port bind (Render port
 * scan). Until the bootstrap succeeds, import-review routes return 503 instead of
 * hitting an unverified database. The rest of the API is unaffected.
 */
export type ImportReviewReadiness = "pending" | "ready" | "failed";

export type ImportReviewReadinessSnapshot = {
    status: ImportReviewReadiness;
    lastError: string | null;
    /** ISO timestamp of the last bootstrap attempt that resolved/rejected. */
    lastCheckedAt: string | null;
};

let state: ImportReviewReadiness = "pending";
let lastError: string | null = null;
let lastCheckedAt: string | null = null;

export function markImportReviewReady(): void {
    state = "ready";
    lastError = null;
    lastCheckedAt = new Date().toISOString();
}

export function markImportReviewFailed(error: unknown): void {
    state = "failed";
    lastError = error instanceof Error ? error.message : String(error);
    lastCheckedAt = new Date().toISOString();
}

export function getImportReviewReadiness(): ImportReviewReadiness {
    return state;
}

export function getImportReviewReadinessError(): string | null {
    return lastError;
}

export function isImportReviewReady(): boolean {
    return state === "ready";
}

export function getImportReviewReadinessSnapshot(): ImportReviewReadinessSnapshot {
    return { status: state, lastError, lastCheckedAt };
}
