import { isImportReviewEntityFamily } from "./import-review-config.js";
import type { PromotionEligibilityDetailRowDb } from "./import-review-promotion-eligibility-details.repo.js";
import { resolvePromotionEligibilityReasons } from "./import-review-promotion-eligibility-reasons.js";
import type {
    ImportReviewPromotionEligibilityDetailItem,
    ImportReviewPromotionEligibilityDetailsResponse,
} from "./import-review-promotion-eligibility-details.types.js";
import type { PromotionEligibilityBucket } from "./import-review-promotion-eligibility.js";
import {
    getImportReviewPublishFamilyConfig,
    type ImportReviewPromotionAllowedFamily,
    type ImportReviewPublishFamilyConfig,
} from "./import-review-promotion-config.js";
import { importReviewPromotionFamilyTarget } from "./import-review-promotion-family-meta.js";
import {
    ImportReviewPromotionUnknownFamilyError,
    ImportReviewTransportPromotionDeprecatedError,
} from "./import-review-promotion.errors.js";
import { isDisabledImportReviewPromotionFamily } from "./import-review-promotion-config.js";
export function parsePromotionEligibilityFamilyParam(family: string): ImportReviewPublishFamilyConfig {
    const trimmed = family.trim();
    if (isDisabledImportReviewPromotionFamily(trimmed)) {
        throw new ImportReviewTransportPromotionDeprecatedError([trimmed]);
    }
    if (!isImportReviewEntityFamily(trimmed)) {
        throw new ImportReviewPromotionUnknownFamilyError(trimmed);
    }
    const cfg = getImportReviewPublishFamilyConfig(trimmed);
    if (!cfg) {
        throw new ImportReviewPromotionUnknownFamilyError(trimmed);
    }
    return cfg;
}

function bigintToNumber(value: bigint): number {
    const n = Number(value);
    if (!Number.isSafeInteger(n)) {
        throw new Error(`id is too large to represent as a number: ${value.toString()}`);
    }
    return n;
}

export function mapPromotionEligibilityDetailRow(
    row: PromotionEligibilityDetailRowDb,
    config: ImportReviewPublishFamilyConfig,
    bucket: PromotionEligibilityBucket
): ImportReviewPromotionEligibilityDetailItem {
    const target = importReviewPromotionFamilyTarget(config.entityFamily);
    const reasons = resolvePromotionEligibilityReasons(row, config, bucket);

    return {
        id: bigintToNumber(row.id),
        external_id: row.external_id,
        display_name: row.display_name,
        match_status: row.match_status,
        auto_action: row.auto_action,
        review_status: row.review_status,
        review_decision: row.review_decision,
        promotion_status: row.promotion_status,
        confidence_score: row.confidence_score,
        reason_codes: reasons.reason_codes,
        reason_messages: reasons.reason_messages,
        validation_errors: row.validation_errors,
        validation_warnings: row.validation_warnings,
        target,
        publish_batch_id: row.publish_batch_id != null ? bigintToNumber(row.publish_batch_id) : null,
        publish_batch_status: row.publish_batch_status,
        promoted_core_id: row.promoted_core_id != null ? bigintToNumber(row.promoted_core_id) : null,
        created_at: row.created_at?.toISOString() ?? null,
        updated_at: row.updated_at?.toISOString() ?? null,
    };
}

export function buildPromotionEligibilityDetailsResponse(args: {
    reviewBatchId: bigint;
    family: ImportReviewPromotionAllowedFamily;
    bucket: PromotionEligibilityBucket;
    total: number;
    limit: number;
    offset: number;
    rows: PromotionEligibilityDetailRowDb[];
    config: ImportReviewPublishFamilyConfig;
}): ImportReviewPromotionEligibilityDetailsResponse {
    const reviewBatchNumber = bigintToNumber(args.reviewBatchId);
    const target = importReviewPromotionFamilyTarget(args.family);

    return {
        review_batch_id: reviewBatchNumber,
        family: args.family,
        bucket: args.bucket,
        target,
        total: args.total,
        limit: args.limit,
        offset: args.offset,
        items: args.rows.map((row) => mapPromotionEligibilityDetailRow(row, args.config, args.bucket)),
    };
}
