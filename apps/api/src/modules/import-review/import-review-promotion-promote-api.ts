import {
    PROMOTABLE_PUBLISH_FAMILIES,
    type PromotablePublishEntityFamily,
    isPromotablePublishFamily,
} from "./import-review-promotion-config.js";
import {
    getPromotionFamilyConfig,
    promotionTargetQualifiedTable,
} from "./import-review-promotion-simple-config.js";
import type {
    PublishItemPromotionSelection,
    PublishItemValidationRow,
} from "./import-review-promotion-execution.js";
import {
    isPublishItemValidationBlocked,
    isPublishItemValidationReady,
    isPublishItemValidationWarning,
    parsePublishItemValidationResult,
} from "./import-review-promotion-publish-item-validation.js";
import type { PostImportReviewPromotionBatchPromoteBody } from "./import-review-promotion.schema.js";

export type PromotionPreflightValidation = {
    outcome: string;
    blocked_count: number;
    warning_count: number;
    ready_count: number;
    promotable_count: number;
    can_promote: boolean;
    requires_warning_confirmation: boolean;
};

export type PromotionFamilyItemCounts = {
    success: number;
    failed: number;
    skipped: number;
    inserted: number;
    updated: number;
};

export function getImportReviewPromotionTargetTable(family: string): string | null {
    const config = getPromotionFamilyConfig(family);
    if (config) {
        return promotionTargetQualifiedTable(config);
    }
    if (!isPromotablePublishFamily(family)) {
        return null;
    }
    return null;
}

export function resolvePromotionWarningNote(body: PostImportReviewPromotionBatchPromoteBody): string | undefined {
    const note =
        body.promotion_note?.trim() ||
        body.warning_confirmation_note?.trim() ||
        body.review_note?.trim();
    return note || undefined;
}

export type PromotionWarningConfirmationInput = {
    confirm_warnings?: boolean;
    promotion_note?: string;
    warning_confirmation_note?: string;
    review_note?: string;
};

export function assertPromotionWarningConfirmationAllowed(
    validation: PromotionPreflightValidation | null,
    body: PromotionWarningConfirmationInput
): void {
    if (!validation?.requires_warning_confirmation) {
        return;
    }
    if (body.confirm_warnings !== true) {
        throw new Error("Validation warnings require confirm_warnings=true before promotion.");
    }
    const note =
        body.promotion_note?.trim() ||
        body.warning_confirmation_note?.trim() ||
        body.review_note?.trim() ||
        undefined;
    if (!note) {
        throw new Error("Validation warnings require a non-empty promotion_note before promotion.");
    }
}

/** Item-level preflight from pending publish items (authority over stale batch summary). */
export function buildPromotionPreflightFromItemSelection(
    pendingRows: readonly PublishItemValidationRow[],
    selection: PublishItemPromotionSelection
): PromotionPreflightValidation {
    let ready_count = 0;
    let warning_count = 0;
    let blocked_count = 0;

    for (const row of pendingRows) {
        const status = parsePublishItemValidationResult(row.validation_result).status;
        if (isPublishItemValidationReady(status)) {
            ready_count += 1;
        } else if (isPublishItemValidationWarning(status)) {
            warning_count += 1;
        } else if (isPublishItemValidationBlocked(status)) {
            blocked_count += 1;
        }
    }

    const promotable_count = selection.promotableIds.length;
    const can_promote = promotable_count > 0;

    let outcome: string;
    if (!can_promote) {
        outcome = "blocked";
    } else if (blocked_count > 0 || warning_count > 0) {
        outcome = "partial";
    } else {
        outcome = "passed";
    }

    return {
        outcome,
        blocked_count,
        warning_count,
        ready_count,
        promotable_count,
        can_promote,
        requires_warning_confirmation: warning_count > 0,
    };
}

/**
 * Batch promotion gate: validated batch with at least one promotable publish item for this run.
 * Does not require blocked_count = 0 or whole-batch status = ready.
 */
export function assertPromotionNotBlocked(validation: PromotionPreflightValidation | null): void {
    if (!validation) {
        throw new Error("Batch validation summary is missing.");
    }
    const promotableCount =
        validation.promotable_count > 0
            ? validation.promotable_count
            : Math.max(0, validation.ready_count);

    if (promotableCount === 0) {
        throw new Error(
            validation.blocked_count > 0
                ? "Batch has no promotable items; resolve blockers before promotion."
                : "Batch has no promotable items; run batch validation first."
        );
    }
}

export function promotionFamilyStagesForBatch(
    familiesInBatch: Iterable<string>
): Array<{ key: string; entityFamily: PromotablePublishEntityFamily; label: string }> {
    const present = new Set(
        [...familiesInBatch].filter(
            (family): family is PromotablePublishEntityFamily => isPromotablePublishFamily(family)
        )
    );
    return PROMOTABLE_PUBLISH_FAMILIES.filter((family) => present.has(family)).map((family) => ({
        key: promotionStageKeyForFamily(family),
        entityFamily: family,
        label: promotionStageLabelForFamily(family),
    }));
}

export function promotionStageKeyForFamily(family: PromotablePublishEntityFamily): string {
    if (family === "routing_barriers") {
        return "promote_routing_barriers_to_routing";
    }
    return `promote_${family}_to_core`;
}

export function promotionStageLabelForFamily(family: PromotablePublishEntityFamily): string {
    const labels: Record<PromotablePublishEntityFamily, string> = {
        buildings: "Promote buildings",
        places: "Promote places",
        land_areas: "Promote land areas",
        water_lines: "Promote water lines",
        water_polygons: "Promote water polygons",
        roads: "Promote roads",
        addresses: "Promote addresses",
        admin_areas: "Promote admin areas",
        routing_barriers: "Promote routing barriers",
    };
    return labels[family];
}

export function emptyPromotionFamilyCounts(): PromotionFamilyItemCounts {
    return { success: 0, failed: 0, skipped: 0, inserted: 0, updated: 0 };
}

export function initPromotionCountsByFamily(
    families: Iterable<string>
): Record<string, PromotionFamilyItemCounts> {
    const out: Record<string, PromotionFamilyItemCounts> = {};
    for (const family of families) {
        if (isPromotablePublishFamily(family)) {
            out[family] = emptyPromotionFamilyCounts();
        }
    }
    return out;
}
