import type { ImportReviewEntityFamilySlug } from "./import-review-config.js";
import { isPromotablePublishFamily } from "./import-review-promotion-config.js";
import type { ImportReviewPromotionPromoteRepository } from "./import-review-promotion-promote.repo.js";
import {
    promoteItemResultFromThrownPromotionError,
    unwrapAbortedTransactionError,
} from "./import-review-promotion-road-sql-steps.js";
import type { PromoteItemResult } from "./import-review-promotion-promote.types.js";

/** Inputs shared by single-item and batch publish promotion. */
export type PromoteImportReviewItemConfig = {
    batchId: bigint;
    publishItemId: bigint;
    promotedBy: bigint | null;
    confirmWarnings?: boolean;
    promotionNote?: string;
};

/**
 * Core write for one publish item inside an existing transaction.
 * Does not update publish-item or candidate status — caller must commit bookkeeping separately.
 */
export async function promoteImportReviewItemCoreTx(
    repo: ImportReviewPromotionPromoteRepository,
    config: PromoteImportReviewItemConfig
): Promise<PromoteItemResult> {
    return repo.promotePublishItemTx({
        batchId: config.batchId,
        publishItemId: config.publishItemId,
        promotedBy: config.promotedBy,
        confirmWarnings: config.confirmWarnings,
        promotionNote: config.promotionNote,
    });
}

/**
 * Persist publish-item / candidate promotion status after core write.
 * Must run outside a failed/aborted database transaction.
 */
export async function applyImportReviewPromotionItemBookkeeping(
    repo: ImportReviewPromotionPromoteRepository,
    config: PromoteImportReviewItemConfig,
    result: PromoteItemResult
): Promise<PromoteItemResult> {
    const items = await repo.listPromotableItems(config.batchId);
    const item = items.find((row) => row.publish_item_id === config.publishItemId);

    if (result.outcome === "inserted" || result.outcome === "updated") {
        if (!item) {
            throw new Error("Publish item missing after core promotion.");
        }
        await repo.applyItemSuccess({
            publishItemId: config.publishItemId,
            targetId: result.target_id,
            targetTable: item.target_table,
            entityFamily: item.entity_family,
            beforeData: result.before_data,
            afterData: result.after_data ?? { id: result.target_id?.toString() ?? null },
        });
        if (item.entity_family !== "bus_route_stops" || result.target_id != null) {
            await repo.markCandidatePromoted({
                entityFamily: item.entity_family as ImportReviewEntityFamilySlug,
                reviewCandidateId: item.review_candidate_id,
                promotedCoreId: result.target_id,
                promotedBy: config.promotedBy,
            });
        }
        return result;
    }

    if (result.outcome === "skipped") {
        if (item) {
            await repo.applyItemSuccess({
                publishItemId: config.publishItemId,
                targetId: result.target_id,
                targetTable: item.target_table,
                entityFamily: item.entity_family,
                beforeData: result.before_data,
                afterData: result.after_data ?? { skipped: true },
            });
        }
        return result;
    }

    await repo.applyItemFailure({
        publishItemId: config.publishItemId,
        errorMessage: result.error_message ?? "Promotion failed.",
        entityFamily: item?.entity_family,
        reviewCandidateId: item?.review_candidate_id,
        externalId: item?.external_id ?? null,
        targetSchema: item?.target_schema ?? "core",
        targetTable: item?.target_table,
        publishAction: item?.publish_action,
        technicalDetail: result.after_data,
        failureCause: result.failure_cause ?? null,
    });
    if (
        item?.review_candidate_id != null &&
        item.entity_family &&
        isPromotablePublishFamily(item.entity_family)
    ) {
        await repo.releaseCandidateAfterPromotionFailure(
            item.entity_family as ImportReviewEntityFamilySlug,
            item.review_candidate_id
        );
    }
    return result;
}

/**
 * Promote one publish item inside an existing transaction (core + bookkeeping).
 * Prefer {@link promoteAndCommitImportReviewItem} for batch promotion so failures
 * are recorded outside aborted transactions.
 */
export async function promoteImportReviewItemTx(
    repo: ImportReviewPromotionPromoteRepository,
    config: PromoteImportReviewItemConfig
): Promise<PromoteItemResult> {
    const result = await promoteImportReviewItemCoreTx(repo, config);
    return applyImportReviewPromotionItemBookkeeping(repo, config, result);
}

export function promotionResultFromThrownError(
    publishItemId: bigint,
    err: unknown
): PromoteItemResult {
    return promoteItemResultFromThrownPromotionError(
        publishItemId,
        unwrapAbortedTransactionError(err)
    );
}
