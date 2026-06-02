import { isImportReviewEntityFamily } from "./import-review-config.js";
import type { FamilyEligibilityCountDb } from "./import-review-promotion-eligibility.js";
import {
    getImportReviewPublishFamilyConfig,
    IMPORT_REVIEW_PUBLISH_FAMILY_CONFIG,
    isDisabledImportReviewPromotionFamily,
    type ImportReviewPromotionAllowedFamily,
    type ImportReviewPublishFamilyConfig,
} from "./import-review-promotion-config.js";
import {
    importReviewPromotionFamilyLabel,
    importReviewPromotionFamilyRiskLevel,
    importReviewPromotionFamilyTarget,
} from "./import-review-promotion-family-meta.js";
import {
    ImportReviewPromotionUnknownFamilyError,
    ImportReviewTransportPromotionDeprecatedError,
} from "./import-review-promotion.errors.js";

export type ImportReviewPromotionEligibilityFamilyCounts = {
    ready: number;
    warnings: number;
    blocked: number;
    batched: number;
    promoted: number;
};

export type ImportReviewPromotionEligibilityFamilyRow = {
    family: ImportReviewPromotionAllowedFamily;
    label: string;
    risk_level: "normal" | "high_risk";
    target: string;
} & ImportReviewPromotionEligibilityFamilyCounts;

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
        if (isDisabledImportReviewPromotionFamily(family)) {
            throw new ImportReviewTransportPromotionDeprecatedError([family]);
        }
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

export function mapFamilyEligibilityCounts(
    row: FamilyEligibilityCountDb | null | undefined
): ImportReviewPromotionEligibilityFamilyCounts {
    if (!row) {
        return { ready: 0, warnings: 0, blocked: 0, batched: 0, promoted: 0 };
    }

    const ready = Number(row.approved_ready);
    const warnings = Number(row.with_warnings);
    const batched = Number(row.blocked);
    const promoted = Number(row.already_promoted);
    // Truly excluded only (eligibleWithWarnings in SQL). Do not sum has_validation_errors,
    // manual_protected, or duplicate_unconfirmed — those are subsets of excluded and would
    // double-count warning-only roads when include_warnings=false on the ready bucket.
    const blocked = Number(row.excluded);

    return { ready, warnings, blocked, batched, promoted };
}

export function sumEligibilityTotals(
    rows: ImportReviewPromotionEligibilityFamilyCounts[]
): ImportReviewPromotionEligibilityFamilyCounts {
    return rows.reduce(
        (acc, row) => ({
            ready: acc.ready + row.ready,
            warnings: acc.warnings + row.warnings,
            blocked: acc.blocked + row.blocked,
            batched: acc.batched + row.batched,
            promoted: acc.promoted + row.promoted,
        }),
        { ready: 0, warnings: 0, blocked: 0, batched: 0, promoted: 0 }
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
