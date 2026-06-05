export type PublishBatchDryRunResult = {
    status: string;
    checked_at?: string;
    total?: number;
    entity_families?: string[];
    ready_count?: number;
    blocked_count?: number;
    ran_at?: string;
};

export function parsePublishBatchDryRunResultFromSummary(
    summary: unknown
): PublishBatchDryRunResult | null {
    if (!summary || typeof summary !== "object" || Array.isArray(summary)) {
        return null;
    }
    const raw = (summary as Record<string, unknown>).dry_run_result;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return null;
    }
    const o = raw as Record<string, unknown>;
    const status = typeof o.status === "string" ? o.status.trim() : "";
    if (!status) {
        return null;
    }
    return {
        status,
        checked_at: typeof o.checked_at === "string" ? o.checked_at : undefined,
        total: o.total != null ? Number(o.total) : undefined,
        entity_families: Array.isArray(o.entity_families)
            ? o.entity_families.filter((f): f is string => typeof f === "string")
            : undefined,
        ready_count: o.ready_count != null ? Number(o.ready_count) : undefined,
        blocked_count: o.blocked_count != null ? Number(o.blocked_count) : undefined,
        ran_at: typeof o.ran_at === "string" ? o.ran_at : undefined,
    };
}

export function publishBatchDryRunPassed(
    dryRunResult: PublishBatchDryRunResult | null | undefined
): boolean {
    return dryRunResult?.status?.trim().toLowerCase() === "passed";
}
