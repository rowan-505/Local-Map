/**
 * Extract durable History fields from system_publish_items JSON blobs.
 * Prefer first-class columns when present; fall back to before_data /
 * validation_result / after_data so History works after candidate cleanup
 * even before migration 139 is applied.
 */

function asRecord(value: unknown): Record<string, unknown> {
    if (value && typeof value === "object" && !Array.isArray(value)) {
        return value as Record<string, unknown>;
    }
    return {};
}

function readString(...values: unknown[]): string | null {
    for (const value of values) {
        if (typeof value === "string") {
            const t = value.trim();
            if (t) return t;
        }
        if (typeof value === "number" && Number.isFinite(value)) {
            return String(value);
        }
    }
    return null;
}

export type DurablePublishItemFields = {
    review_decision: string | null;
    source_snapshot_version: string | null;
    applied_by: string | null;
    before_summary: unknown;
    after_summary: unknown;
};

export function extractDurablePublishItemFields(row: {
    review_decision?: string | null;
    source_snapshot_version?: string | null;
    applied_by?: bigint | number | string | null;
    before_data?: unknown;
    after_data?: unknown;
    validation_result?: unknown;
}): DurablePublishItemFields {
    const before = asRecord(row.before_data);
    const candidateSummary = asRecord(before.candidate_summary);
    const validation = asRecord(row.validation_result);
    const after = asRecord(row.after_data);

    const review_decision = readString(
        row.review_decision,
        before.review_decision,
        candidateSummary.review_decision,
        validation.review_decision,
        after.review_decision
    );

    const source_snapshot_version = readString(
        row.source_snapshot_version,
        before.source_snapshot_version,
        candidateSummary.source_snapshot_version,
        validation.source_snapshot_version,
        after.source_snapshot_version
    );

    const applied_by = readString(
        row.applied_by != null ? String(row.applied_by) : null,
        after.applied_by,
        after.promoted_by
    );

    const before_summary =
        before.candidate_summary != null
            ? before.candidate_summary
            : before.review_decision != null || before.external_id != null
              ? {
                    external_id: before.external_id ?? null,
                    match_status: before.match_status ?? null,
                    review_decision: before.review_decision ?? null,
                    source_snapshot_version: before.source_snapshot_version ?? null,
                }
              : before.core_before != null
                ? before.core_before
                : row.before_data ?? null;

    const after_summary = row.after_data ?? null;

    return {
        review_decision,
        source_snapshot_version,
        applied_by,
        before_summary,
        after_summary,
    };
}

/**
 * Merge core before snapshot with the candidate summary already stored on the item
 * so review_decision survives promote bookkeeping overwrites.
 */
export function mergePublishItemBeforeData(args: {
    existingBeforeData: unknown;
    coreBeforeData: unknown | null;
}): unknown {
    const existing = asRecord(args.existingBeforeData);
    const candidateSummary =
        existing.candidate_summary != null
            ? existing.candidate_summary
            : existing.review_decision != null || existing.external_id != null
              ? {
                    id: existing.id ?? null,
                    external_id: existing.external_id ?? null,
                    match_status: existing.match_status ?? null,
                    review_decision: existing.review_decision ?? null,
                    review_status: existing.review_status ?? null,
                    promotion_status: existing.promotion_status ?? null,
                    source_snapshot_version: existing.source_snapshot_version ?? null,
                }
              : null;

    if (args.coreBeforeData == null) {
        return args.existingBeforeData ?? null;
    }

    if (!candidateSummary) {
        return args.coreBeforeData;
    }

    return {
        candidate_summary: candidateSummary,
        core_before: args.coreBeforeData,
    };
}

export function mergePublishItemAfterData(args: {
    afterData: unknown;
    reviewDecision: string | null;
    appliedBy: bigint | number | string | null;
    sourceSnapshotVersion: string | null;
}): unknown {
    const base = asRecord(args.afterData);
    return {
        ...base,
        ...(args.reviewDecision ? { review_decision: args.reviewDecision } : {}),
        ...(args.appliedBy != null && String(args.appliedBy).trim()
            ? { applied_by: String(args.appliedBy) }
            : {}),
        ...(args.sourceSnapshotVersion
            ? { source_snapshot_version: args.sourceSnapshotVersion }
            : {}),
    };
}
