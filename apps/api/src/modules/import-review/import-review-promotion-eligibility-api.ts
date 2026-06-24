import { isImportReviewEntityFamily } from "./import-review-config.js";
import type { FamilyEligibilityReadonlyCountDb } from "./import-review-promotion-eligibility-readonly.js";
import {
    mapFamilyPromotionScopeCounts,
    PROMOTION_SCOPE_NO_READY_MESSAGE,
    type PromotionScopeFamilyCounts,
} from "./import-review-promotion-scope-counts.js";
import type { FamilyEligibilityCountDb } from "./import-review-promotion-eligibility.js";
import {
    getImportReviewPublishFamilyConfig,
    IMPORT_REVIEW_PUBLISH_FAMILY_CONFIG,
    type ImportReviewPromotionAllowedFamily,
    type ImportReviewPublishFamilyConfig,
} from "./import-review-promotion-config.js";
import {
    importReviewPromotionFamilyLabel,
    importReviewPromotionFamilyRiskLevel,
    importReviewPromotionFamilyTarget,
} from "./import-review-promotion-family-meta.js";
import { ImportReviewPromotionUnknownFamilyError } from "./import-review-promotion.errors.js";

export type ImportReviewPromotionEligibilityCountError = {
    ok: false;
    code: string;
    message: string;
};

export type ImportReviewPromotionEligibilityStoredCounts = {
    approved_count: number | null;
    ready_existing_count: number | null;
    blocked_existing_count: number | null;
    warning_existing_count: number | null;
    already_batched_count: number | null;
    already_promoted_count: number | null;
};

export type ImportReviewPromotionEligibilityFamilyCounts = {
    ready_now: number;
    retry_needed: number;
    active_locked: number;
    stale_locked: number;
    promoted: number;
    /** @deprecated Use ready_now */
    ready: number;
    /** @deprecated Always 0 on scope counts */
    warnings: number;
    /** @deprecated Always 0 on scope counts */
    blocked: number;
    /** @deprecated Use active_locked + stale_locked */
    batched: number;
};

export type ImportReviewPromotionEligibilityFamilyRow = {
    family: ImportReviewPromotionAllowedFamily;
    label: string;
    risk_level: "normal" | "high_risk";
    target: string;
    counts_ok: boolean;
    count_error: ImportReviewPromotionEligibilityCountError | null;
} & ImportReviewPromotionEligibilityFamilyCounts &
    ImportReviewPromotionEligibilityStoredCounts;

export type ImportReviewPromotionEligibilityResponse = {
    review_batch_id: number;
    families: ImportReviewPromotionEligibilityFamilyRow[];
    totals: ImportReviewPromotionEligibilityFamilyCounts;
    has_high_risk: boolean;
    can_create_batch: boolean;
    messages: string[];
};

export function parsePromotionEligibilityFamiliesParam(
    rawFamilies: readonly string[]
): ImportReviewPublishFamilyConfig[] {
    const unique = [...new Set(rawFamilies.map((f) => f.trim()).filter((f) => f.length > 0))];
    if (unique.length === 0) {
        throw new Error("families is required");
    }

    const configs: ImportReviewPublishFamilyConfig[] = [];
    for (const family of unique) {
        if (!isImportReviewEntityFamily(family)) {
            throw new ImportReviewPromotionUnknownFamilyError(family);
        }
        const cfg = getImportReviewPublishFamilyConfig(family);
        if (!cfg) {
            throw new ImportReviewPromotionUnknownFamilyError(family);
        }
        configs.push(cfg);
    }
    return configs;
}

export const PROMOTION_ELIGIBILITY_DB_POOL_TIMEOUT_MESSAGE =
    "Database connection timed out while loading counts. Try one family or refresh.";

export function isPrismaPoolTimeoutError(error: unknown): boolean {
    return (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code?: string }).code === "P2024"
    );
}

export function mapFamilyEligibilityReadonlyCounts(
    row: FamilyEligibilityReadonlyCountDb | null | undefined
): ImportReviewPromotionEligibilityStoredCounts & ImportReviewPromotionEligibilityFamilyCounts {
    if (!row) {
        return {
            approved_count: null,
            ready_existing_count: null,
            blocked_existing_count: null,
            warning_existing_count: null,
            already_batched_count: null,
            already_promoted_count: null,
            ready_now: 0,
            retry_needed: 0,
            active_locked: 0,
            stale_locked: 0,
            promoted: 0,
            ready: 0,
            warnings: 0,
            blocked: 0,
            batched: 0,
        };
    }

    const approved_count = Number(row.approved_count);
    const ready_existing_count = Number(row.ready_existing_count);
    const blocked_existing_count = Number(row.blocked_existing_count);
    const warning_existing_count = Number(row.warning_existing_count);
    const already_batched_count = Number(row.already_batched_count);
    const already_promoted_count = Number(row.already_promoted_count);

    return {
        approved_count,
        ready_existing_count,
        blocked_existing_count,
        warning_existing_count,
        already_batched_count,
        already_promoted_count,
        ready_now: ready_existing_count,
        retry_needed: 0,
        active_locked: 0,
        stale_locked: already_batched_count,
        promoted: already_promoted_count,
        ready: ready_existing_count,
        warnings: warning_existing_count,
        blocked: blocked_existing_count,
        batched: already_batched_count,
    };
}

export function mapScopeCountsToFamilyRow(
    scope: PromotionScopeFamilyCounts
): ImportReviewPromotionEligibilityFamilyCounts {
    return {
        ...scope,
        ready: scope.ready_now,
        warnings: 0,
        blocked: 0,
        batched: scope.active_locked + scope.stale_locked,
    };
}

export function buildPromotionScopeEligibilityFamilyRow(args: {
    config: ImportReviewPublishFamilyConfig;
    scope: PromotionScopeFamilyCounts;
    countError: ImportReviewPromotionEligibilityCountError | null;
}): ImportReviewPromotionEligibilityFamilyRow {
    const family = args.config.entityFamily;
    const counts = mapScopeCountsToFamilyRow(args.scope);
    return {
        family,
        label: importReviewPromotionFamilyLabel(family),
        risk_level: importReviewPromotionFamilyRiskLevel(family),
        target: importReviewPromotionFamilyTarget(family),
        counts_ok: args.countError === null,
        count_error: args.countError,
        approved_count: null,
        ready_existing_count: null,
        blocked_existing_count: null,
        warning_existing_count: null,
        already_batched_count: null,
        already_promoted_count: null,
        ...counts,
    };
}

export function buildReadonlyPromotionEligibilityFamilyRow(args: {
    config: ImportReviewPublishFamilyConfig;
    row: FamilyEligibilityReadonlyCountDb | null;
    countError: ImportReviewPromotionEligibilityCountError | null;
}): ImportReviewPromotionEligibilityFamilyRow {
    const family = args.config.entityFamily;
    const legacy = mapFamilyEligibilityReadonlyCounts(args.row);
    const scope: PromotionScopeFamilyCounts = {
        ready_now: legacy.ready,
        retry_needed: 0,
        active_locked: 0,
        stale_locked: legacy.batched,
        promoted: legacy.promoted,
    };
    return buildPromotionScopeEligibilityFamilyRow({
        config: args.config,
        scope,
        countError: args.countError,
    });
}

export function buildReadonlyPromotionEligibilityResponse(args: {
    reviewBatchId: bigint;
    familyRows: ImportReviewPromotionEligibilityFamilyRow[];
    includeWarnings: boolean;
}): ImportReviewPromotionEligibilityResponse {
    const okRows = args.familyRows.filter((row) => row.counts_ok);
    const totals = sumEligibilityTotals(okRows);
    const has_high_risk = args.familyRows.some((f) => f.risk_level === "high_risk");
    const readyNowTotal = totals.ready_now;
    const messages: string[] = [];

    if (args.familyRows.some((row) => row.count_error !== null)) {
        messages.push(
            "Some families could not be counted. Retry with fewer families selected, or refresh after other promotion work finishes."
        );
    }

    if (readyNowTotal === 0 && okRows.length > 0) {
        messages.push(PROMOTION_SCOPE_NO_READY_MESSAGE);
        if (totals.stale_locked > 0) {
            messages.push(
                `${totals.stale_locked.toLocaleString()} stale locked candidate(s) can be released with “Release stale locked items”.`
            );
        }
        if (totals.retry_needed > 0) {
            messages.push(
                `${totals.retry_needed.toLocaleString()} candidate(s) need a retry after a failed publish item.`
            );
        }
    } else if (readyNowTotal > 0) {
        messages.push(
            `${readyNowTotal.toLocaleString()} candidate(s) ready now for a new publish batch. Validation runs after batch creation.`
        );
    }

    if (has_high_risk) {
        messages.push(
            "Selection includes high-risk families (roads, addresses, admin areas, or routing barriers)."
        );
    }

    if (totals.active_locked > 0) {
        messages.push(
            `${totals.active_locked.toLocaleString()} candidate(s) are locked in an active publish batch (validating, promoting, or ready).`
        );
    }

    const reviewBatchNumber = Number(args.reviewBatchId);
    if (!Number.isSafeInteger(reviewBatchNumber)) {
        throw new Error(`review_batch_id is too large to represent as a number: ${args.reviewBatchId.toString()}`);
    }

    return {
        review_batch_id: reviewBatchNumber,
        families: args.familyRows,
        totals,
        has_high_risk,
        can_create_batch:
            readyNowTotal > 0 && !args.familyRows.every((row) => row.count_error !== null),
        messages,
    };
}

export function mapFamilyEligibilityCounts(
    row: FamilyEligibilityCountDb | null | undefined
): ImportReviewPromotionEligibilityFamilyCounts {
    if (!row) {
        return {
            ready_now: 0,
            retry_needed: 0,
            active_locked: 0,
            stale_locked: 0,
            promoted: 0,
            ready: 0,
            warnings: 0,
            blocked: 0,
            batched: 0,
        };
    }

    const ready = Number(row.approved_ready);
    const warnings = Number(row.with_warnings);
    const batched = Number(row.blocked);
    const promoted = Number(row.already_promoted);
    const blocked = Number(row.excluded);

    return {
        ready_now: ready,
        retry_needed: 0,
        active_locked: 0,
        stale_locked: batched,
        promoted,
        ready,
        warnings,
        blocked,
        batched,
    };
}

export function sumEligibilityTotals(
    rows: ImportReviewPromotionEligibilityFamilyCounts[]
): ImportReviewPromotionEligibilityFamilyCounts {
    return rows.reduce(
        (acc, row) => ({
            ready_now: acc.ready_now + row.ready_now,
            retry_needed: acc.retry_needed + row.retry_needed,
            active_locked: acc.active_locked + row.active_locked,
            stale_locked: acc.stale_locked + row.stale_locked,
            promoted: acc.promoted + row.promoted,
            ready: acc.ready + row.ready,
            warnings: acc.warnings + row.warnings,
            blocked: acc.blocked + row.blocked,
            batched: acc.batched + row.batched,
        }),
        {
            ready_now: 0,
            retry_needed: 0,
            active_locked: 0,
            stale_locked: 0,
            promoted: 0,
            ready: 0,
            warnings: 0,
            blocked: 0,
            batched: 0,
        }
    );
}

export function buildPromotionEligibilityMessages(args: {
    totals: ImportReviewPromotionEligibilityFamilyCounts;
    includeWarnings: boolean;
    hasHighRisk: boolean;
    familyRows: ImportReviewPromotionEligibilityFamilyRow[];
}): string[] {
    const messages: string[] = [];

    if (args.totals.ready === 0) {
        messages.push(
            "No ready candidates for the selected families. Check blocked, batched, or promoted counts per family."
        );
    } else {
        messages.push(
            `${args.totals.ready.toLocaleString()} candidate(s) ready to include in a new publish batch.`
        );
    }

    if (args.hasHighRisk) {
        messages.push(
            "Selection includes high-risk families (roads, addresses, admin areas, or routing barriers)."
        );
    }

    if (!args.includeWarnings && args.totals.warnings > 0) {
        messages.push(
            `${args.totals.warnings.toLocaleString()} approved candidate(s) have validation warnings and are excluded from ready unless include_warnings=true.`
        );
    }

    if (args.includeWarnings && args.totals.warnings > 0) {
        messages.push(
            `${args.totals.warnings.toLocaleString()} ready candidate(s) include validation warnings (include_warnings=true).`
        );
    }

    for (const row of args.familyRows) {
        if (row.target === "routing.routing_barriers" && row.ready > 0) {
            messages.push(
                "Routing barriers promote to routing.routing_barriers; run routing-barrier dry-run before batch promotion."
            );
            break;
        }
    }

    return messages;
}

export function buildPromotionEligibilityResponse(args: {
    reviewBatchId: bigint;
    familyConfigs: ImportReviewPublishFamilyConfig[];
    countRows: FamilyEligibilityCountDb[];
    includeWarnings: boolean;
}): ImportReviewPromotionEligibilityResponse {
    const countByFamily = new Map(args.countRows.map((row) => [row.entity_family, row]));

    const families: ImportReviewPromotionEligibilityFamilyRow[] = args.familyConfigs.map((cfg) => {
        const family = cfg.entityFamily;
        const counts = mapFamilyEligibilityCounts(countByFamily.get(family));
        return {
            family,
            label: importReviewPromotionFamilyLabel(family),
            risk_level: importReviewPromotionFamilyRiskLevel(family),
            target: importReviewPromotionFamilyTarget(family),
            counts_ok: true,
            count_error: null,
            approved_count: counts.ready,
            ready_existing_count: counts.ready,
            blocked_existing_count: counts.blocked,
            warning_existing_count: counts.warnings,
            already_batched_count: counts.batched,
            already_promoted_count: counts.promoted,
            ...counts,
        };
    });

    const totals = sumEligibilityTotals(families);
    const has_high_risk = families.some((f) => f.risk_level === "high_risk");
    const messages = buildPromotionEligibilityMessages({
        totals,
        includeWarnings: args.includeWarnings,
        hasHighRisk: has_high_risk,
        familyRows: families,
    });

    const reviewBatchNumber = Number(args.reviewBatchId);
    if (!Number.isSafeInteger(reviewBatchNumber)) {
        throw new Error(`review_batch_id is too large to represent as a number: ${args.reviewBatchId.toString()}`);
    }

    return {
        review_batch_id: reviewBatchNumber,
        families,
        totals,
        has_high_risk,
        can_create_batch: totals.ready > 0,
        messages,
    };
}

/** @internal Exported for tests — canonical allowed family keys. */
export const IMPORT_REVIEW_PROMOTION_ELIGIBILITY_ALLOWED_FAMILIES = Object.keys(
    IMPORT_REVIEW_PUBLISH_FAMILY_CONFIG
) as ImportReviewPromotionAllowedFamily[];
