import {
    IMPORT_REVIEW_PROMOTION_TARGETS,
    PROMOTABLE_PUBLISH_FAMILIES,
    type ImportReviewPromotionAllowedFamily,
    type PromotablePublishEntityFamily,
    isDisabledImportReviewPromotionFamily,
    isPromotablePublishFamily,
} from "./import-review-promotion-config.js";
import { isDeprecatedCoreBusPublishFamily } from "./import-review-transport-promotion-deprecated.js";
import type { PostImportReviewPromotionBatchPromoteBody } from "./import-review-promotion.schema.js";

export type PromotionPreflightValidation = {
    outcome: string;
    blocked_count: number;
    warning_count: number;
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
    if (isDisabledImportReviewPromotionFamily(family) || isDeprecatedCoreBusPublishFamily(family)) {
        return null;
    }
    if (!isPromotablePublishFamily(family)) {
        return null;
    }
    return IMPORT_REVIEW_PROMOTION_TARGETS[family as ImportReviewPromotionAllowedFamily];
}

export function assertBusFamilyCannotPromote(family: string): void {
    if (isDeprecatedCoreBusPublishFamily(family) || isDisabledImportReviewPromotionFamily(family)) {
        throw new Error(`Bus entity family ${family} cannot be promoted via import review publish batches.`);
    }
}

export function resolvePromotionWarningNote(body: PostImportReviewPromotionBatchPromoteBody): string | undefined {
    const note = body.warning_confirmation_note?.trim() || body.review_note?.trim();
    return note || undefined;
}

export type PromotionWarningConfirmationInput = {
    confirm_warnings?: boolean;
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
        body.warning_confirmation_note?.trim() ||
        body.review_note?.trim() ||
        undefined;
    if (!note) {
        throw new Error("Validation warnings require a non-empty review_note before promotion.");
    }
}

export function assertPromotionNotBlocked(validation: PromotionPreflightValidation | null): void {
    if (!validation) {
        throw new Error("Batch validation summary is missing.");
    }
    if (validation.blocked_count > 0 || validation.outcome === "blocked") {
        throw new Error("Batch has blocked validation items; resolve blockers before promotion.");
    }
    if (!validation.can_promote) {
        throw new Error("Batch validation does not allow promotion (can_promote=false).");
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
        landuse: "Promote landuse",
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
