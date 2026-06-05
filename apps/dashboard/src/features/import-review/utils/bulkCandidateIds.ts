/**
 * Normalize import-review list row IDs for bulk-decision API bodies.
 * Candidate primary keys are numeric; the list UI stores them as strings.
 */
export function normalizeBulkCandidateIds(raw: Iterable<string | number | null | undefined>): number[] {
    const seen = new Set<number>();
    const out: number[] = [];

    for (const rawId of raw) {
        if (rawId === null || rawId === undefined) {
            continue;
        }
        const trimmed = String(rawId).trim();
        if (trimmed === "") {
            continue;
        }
        const n = typeof rawId === "number" ? rawId : Number(trimmed);
        if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
            continue;
        }
        if (seen.has(n)) {
            continue;
        }
        seen.add(n);
        out.push(n);
    }

    return out;
}

export function logBulkReviewActionDev(args: {
    family: string;
    rawSelectedIds?: readonly (string | number)[];
    normalizedIds: readonly number[];
    action: string;
    forceApproval: boolean;
    response?: unknown;
}): void {
    if (process.env.NODE_ENV !== "development") {
        return;
    }
    console.debug("[bulk-review-action]", {
        family: args.family,
        action: args.action,
        normalizedIds: [...args.normalizedIds],
        ...(args.rawSelectedIds !== undefined ? { rawSelectedIds: [...args.rawSelectedIds] } : {}),
        forceApproval: args.forceApproval,
        ...(args.response !== undefined ? { response: args.response } : {}),
    });
}
