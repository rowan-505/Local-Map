export type ImportReviewClientFetchStatus = "start" | "success" | "error" | "abort";

export type ImportReviewClientFetchLog = {
    phase: string;
    family?: string;
    status: ImportReviewClientFetchStatus;
    durationMs?: number;
    itemCount?: number;
    total?: number;
    error?: string;
    query?: Record<string, unknown>;
};

/** Dev-only structured fetch timing — mirrors API import-review roads request logs. */
export function logImportReviewClientFetch(details: ImportReviewClientFetchLog): void {
    if (process.env.NODE_ENV === "production") {
        return;
    }
    console.debug("[import-review fetch]", details);
}
