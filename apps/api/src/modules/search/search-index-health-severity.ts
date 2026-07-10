/**
 * Search index health severity rules.
 *
 * Expected searchable count = rows from `search.v_search_*_source` views (canonical_count
 * in the health query). These views already exclude entities that are not intended
 * to be indexed, which avoids false positives from raw table counts.
 */

export type SearchIndexHealthSeverity = "healthy" | "warning" | "critical";

export const SEARCH_INDEX_HEALTH_SEVERITY_THRESHOLDS = {
    /** Missing rows still treated as healthy (incremental sync lag). */
    MISSING_HEALTHY_MAX: 2,
    /** Missing rows below this absolute count are warning (when % is not critical). */
    MISSING_WARNING_ABSOLUTE_MAX: 25,
    /** Missing share of expected searchable rows → warning. */
    MISSING_WARNING_PERCENT: 0.0025,
    /** Missing share of expected searchable rows → critical. */
    MISSING_CRITICAL_PERCENT: 0.02,
    /** Missing absolute count → critical when expected is large enough. */
    MISSING_CRITICAL_ABSOLUTE: 100,
    /** Minimum expected searchable rows before percent rules apply. */
    MIN_EXPECTED_FOR_PERCENT: 50,

    /** Stale rows at or below this are warning only (never healthy once > 0). */
    STALE_WARNING_ABSOLUTE_MAX: 20,
    STALE_WARNING_PERCENT: 0.01,
    STALE_CRITICAL_PERCENT: 0.1,
    STALE_CRITICAL_ABSOLUTE: 500,

    /** Last successful rebuild older than this → warning. */
    REBUILD_WARNING_AGE_MS: 7 * 24 * 60 * 60 * 1000,
    /** Last successful rebuild older than this → critical. */
    REBUILD_CRITICAL_AGE_MS: 30 * 24 * 60 * 60 * 1000,

    /** Family latest index older than this (when expected > 0) → warning. */
    FAMILY_INDEX_WARNING_AGE_MS: 14 * 24 * 60 * 60 * 1000,
    /** Family latest index older than this (when expected > 0) → critical. */
    FAMILY_INDEX_CRITICAL_AGE_MS: 45 * 24 * 60 * 60 * 1000,
} as const;

export type SearchIndexFamilySeverityInput = {
    missing_count: number;
    ghost_count: number;
    stale_count: number;
    /** Intended searchable rows from source views (`canonical_count`). */
    expected_searchable_count: number;
    latest_indexed_at: Date | null;
};

export type SearchIndexOverallSeverityInput = {
    family_severities: readonly SearchIndexHealthSeverity[];
    last_rebuild_status: string | null;
    last_successful_rebuild_finished_at: Date | null;
    health_query_ok: boolean;
};

const SEVERITY_RANK: Record<SearchIndexHealthSeverity, number> = {
    healthy: 0,
    warning: 1,
    critical: 2,
};

export function maxSearchIndexHealthSeverity(
    ...levels: readonly SearchIndexHealthSeverity[]
): SearchIndexHealthSeverity {
    if (levels.some((level) => level === "critical")) {
        return "critical";
    }
    if (levels.some((level) => level === "warning")) {
        return "warning";
    }
    return "healthy";
}

function isFailedRebuildStatus(status: string | null): boolean {
    if (!status) {
        return false;
    }
    const normalized = status.trim().toLowerCase();
    return normalized.includes("fail") || normalized.includes("error");
}

function ageMs(value: Date | null, now: Date): number | null {
    if (!value) {
        return null;
    }
    const ms = now.getTime() - value.getTime();
    return ms >= 0 ? ms : 0;
}

function missingDriftSeverity(
    missing: number,
    expected: number,
): { severity: SearchIndexHealthSeverity; reason: string | null } {
    if (missing <= SEARCH_INDEX_HEALTH_SEVERITY_THRESHOLDS.MISSING_HEALTHY_MAX) {
        return { severity: "healthy", reason: null };
    }

    const percent =
        expected >= SEARCH_INDEX_HEALTH_SEVERITY_THRESHOLDS.MIN_EXPECTED_FOR_PERCENT
            ? missing / expected
            : 0;

    if (
        missing >= SEARCH_INDEX_HEALTH_SEVERITY_THRESHOLDS.MISSING_CRITICAL_ABSOLUTE ||
        percent >= SEARCH_INDEX_HEALTH_SEVERITY_THRESHOLDS.MISSING_CRITICAL_PERCENT
    ) {
        return {
            severity: "critical",
            reason: `missing ${missing} of ${expected} expected searchable rows`,
        };
    }

    if (
        missing <= SEARCH_INDEX_HEALTH_SEVERITY_THRESHOLDS.MISSING_WARNING_ABSOLUTE_MAX ||
        percent >= SEARCH_INDEX_HEALTH_SEVERITY_THRESHOLDS.MISSING_WARNING_PERCENT
    ) {
        return {
            severity: "warning",
            reason: `small missing drift (${missing} of ${expected} expected searchable rows)`,
        };
    }

    return {
        severity: "warning",
        reason: `missing drift (${missing} of ${expected} expected searchable rows)`,
    };
}

function staleDriftSeverity(
    stale: number,
    expected: number,
): { severity: SearchIndexHealthSeverity; reason: string | null } {
    if (stale === 0) {
        return { severity: "healthy", reason: null };
    }

    const percent =
        expected >= SEARCH_INDEX_HEALTH_SEVERITY_THRESHOLDS.MIN_EXPECTED_FOR_PERCENT
            ? stale / expected
            : 0;

    if (
        stale >= SEARCH_INDEX_HEALTH_SEVERITY_THRESHOLDS.STALE_CRITICAL_ABSOLUTE ||
        percent >= SEARCH_INDEX_HEALTH_SEVERITY_THRESHOLDS.STALE_CRITICAL_PERCENT
    ) {
        return {
            severity: "critical",
            reason: `large stale drift (${stale} of ${expected} expected searchable rows)`,
        };
    }

    if (
        stale <= SEARCH_INDEX_HEALTH_SEVERITY_THRESHOLDS.STALE_WARNING_ABSOLUTE_MAX ||
        percent >= SEARCH_INDEX_HEALTH_SEVERITY_THRESHOLDS.STALE_WARNING_PERCENT
    ) {
        return {
            severity: "warning",
            reason: `small stale drift (${stale} rows)`,
        };
    }

    return {
        severity: "warning",
        reason: `stale drift (${stale} rows)`,
    };
}

function familyIndexAgeSeverity(
    latestIndexedAt: Date | null,
    expected: number,
    now: Date,
): { severity: SearchIndexHealthSeverity; reason: string | null } {
    if (expected === 0) {
        return { severity: "healthy", reason: null };
    }

    const age = ageMs(latestIndexedAt, now);
    if (age == null) {
        return {
            severity: "critical",
            reason: "no indexed rows recorded for a non-empty searchable family",
        };
    }

    if (age >= SEARCH_INDEX_HEALTH_SEVERITY_THRESHOLDS.FAMILY_INDEX_CRITICAL_AGE_MS) {
        return {
            severity: "critical",
            reason: "family index is very old",
        };
    }

    if (age >= SEARCH_INDEX_HEALTH_SEVERITY_THRESHOLDS.FAMILY_INDEX_WARNING_AGE_MS) {
        return {
            severity: "warning",
            reason: "family index age exceeds warning threshold",
        };
    }

    return { severity: "healthy", reason: null };
}

export function deriveSearchIndexFamilySeverity(
    input: SearchIndexFamilySeverityInput,
    now: Date = new Date(),
): { severity: SearchIndexHealthSeverity; reasons: string[] } {
    const reasons: string[] = [];
    const levels: SearchIndexHealthSeverity[] = [];

    if (input.ghost_count > 0) {
        levels.push("critical");
        reasons.push(`ghost rows in index (${input.ghost_count})`);
    }

    const missing = missingDriftSeverity(input.missing_count, input.expected_searchable_count);
    if (missing.reason) {
        reasons.push(missing.reason);
    }
    levels.push(missing.severity);

    const stale = staleDriftSeverity(input.stale_count, input.expected_searchable_count);
    if (stale.reason) {
        reasons.push(stale.reason);
    }
    levels.push(stale.severity);

    const indexAge = familyIndexAgeSeverity(
        input.latest_indexed_at,
        input.expected_searchable_count,
        now,
    );
    if (indexAge.reason) {
        reasons.push(indexAge.reason);
    }
    levels.push(indexAge.severity);

    return {
        severity: maxSearchIndexHealthSeverity(...levels),
        reasons,
    };
}

export function deriveSearchIndexOverallSeverity(
    input: SearchIndexOverallSeverityInput,
    now: Date = new Date(),
): { severity: SearchIndexHealthSeverity; reasons: string[] } {
    if (!input.health_query_ok) {
        return {
            severity: "critical",
            reasons: ["health query failed"],
        };
    }

    const reasons: string[] = [];
    const levels: SearchIndexHealthSeverity[] = [...input.family_severities];

    if (isFailedRebuildStatus(input.last_rebuild_status)) {
        levels.push("critical");
        reasons.push("latest rebuild run failed");
    }

    const rebuildAge = ageMs(input.last_successful_rebuild_finished_at, now);
    if (rebuildAge == null) {
        levels.push("warning");
        reasons.push("no successful rebuild recorded");
    } else if (rebuildAge >= SEARCH_INDEX_HEALTH_SEVERITY_THRESHOLDS.REBUILD_CRITICAL_AGE_MS) {
        levels.push("critical");
        reasons.push("last successful rebuild is very old");
    } else if (rebuildAge >= SEARCH_INDEX_HEALTH_SEVERITY_THRESHOLDS.REBUILD_WARNING_AGE_MS) {
        levels.push("warning");
        reasons.push("last successful rebuild exceeds warning age");
    }

    const severity = maxSearchIndexHealthSeverity(...levels);
    return { severity, reasons };
}

export function severityToBinaryHealthStatus(
    severity: SearchIndexHealthSeverity,
): "healthy" | "unhealthy" {
    return severity === "healthy" ? "healthy" : "unhealthy";
}

export function compareSeverity(
    left: SearchIndexHealthSeverity,
    right: SearchIndexHealthSeverity,
): number {
    return SEVERITY_RANK[left] - SEVERITY_RANK[right];
}
