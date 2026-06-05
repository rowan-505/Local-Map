import type { PromotionFamilyItemCounts } from "./import-review-promotion-promote-api.js";
import { planFamilyPromotionIdChunks } from "./import-review-promotion-promote-chunks.js";
import type { PromoteItemResult } from "./import-review-promotion-promote.types.js";

export type PromotionRunAggregateCounters = {
    inserted: number;
    updated: number;
    success: number;
    failed: number;
    skipped: number;
    verificationMetadataApplied: number;
    verificationMetadataSkippedAlreadyVerified: number;
};

export type PromotionChunkProgressEvent = {
    family: string;
    chunkIndex: number;
    chunkSize: number;
    familyProcessed: number;
    familyTotal: number;
    globalProcessed: number;
    globalTotal: number;
};

export function recordPromotionItemOutcome(args: {
    result: PromoteItemResult;
    hasItemRow: boolean;
    counters: PromotionRunAggregateCounters;
    familyCounts: PromotionFamilyItemCounts | undefined;
    promotedFamilies: Set<string>;
    entityFamily: string;
}): { countedSuccess: boolean; countedFailed: boolean } {
    const { result, hasItemRow, counters, familyCounts, promotedFamilies, entityFamily } = args;
    let countedSuccess = false;
    let countedFailed = false;

    if (result.outcome === "inserted" || result.outcome === "updated") {
        if (hasItemRow && result.target_id != null) {
            if (result.verification_metadata_applied) {
                counters.verificationMetadataApplied += 1;
            }
            if (result.verification_metadata_skipped_already_verified) {
                counters.verificationMetadataSkippedAlreadyVerified += 1;
            }
            promotedFamilies.add(entityFamily);
            if (result.outcome === "inserted") {
                counters.inserted += 1;
                if (familyCounts) {
                    familyCounts.inserted += 1;
                }
            } else {
                counters.updated += 1;
                if (familyCounts) {
                    familyCounts.updated += 1;
                }
            }
            counters.success += 1;
            countedSuccess = true;
            if (familyCounts) {
                familyCounts.success += 1;
            }
        }
    } else if (result.outcome === "skipped") {
        if (hasItemRow && result.target_id != null) {
            counters.skipped += 1;
            counters.success += 1;
            countedSuccess = true;
            if (familyCounts) {
                familyCounts.skipped += 1;
                familyCounts.success += 1;
            }
        }
    } else {
        counters.failed += 1;
        countedFailed = true;
        if (familyCounts) {
            familyCounts.failed += 1;
        }
    }

    return { countedSuccess, countedFailed };
}

export async function promotePublishItemsByFamilyChunks(args: {
    family: string;
    publishItemIds: readonly bigint[];
    globalProcessedOffset: number;
    globalTotal: number;
    promoteItem: (publishItemId: bigint) => Promise<PromoteItemResult>;
    hasItemRow: (publishItemId: bigint) => boolean;
    recordOutcome: (result: PromoteItemResult, publishItemId: bigint) => void;
    onChunkComplete: (event: PromotionChunkProgressEvent) => Promise<void>;
    assertNotCancelled: () => Promise<void>;
}): Promise<{ familySuccess: number; familyFailed: number }> {
    const plans = planFamilyPromotionIdChunks(args.family, args.publishItemIds);
    let familySuccess = 0;
    let familyFailed = 0;
    let familyProcessed = 0;

    for (const plan of plans) {
        await args.assertNotCancelled();
        for (const publishItemId of plan.publishItemIds) {
            const result = await args.promoteItem(publishItemId);
            args.recordOutcome(result, publishItemId);
            if (result.outcome === "failed") {
                familyFailed += 1;
            } else if (
                result.outcome === "inserted" ||
                result.outcome === "updated" ||
                (result.outcome === "skipped" && result.target_id != null && args.hasItemRow(publishItemId))
            ) {
                familySuccess += 1;
            }
        }

        familyProcessed += plan.publishItemIds.length;
        await args.onChunkComplete({
            family: args.family,
            chunkIndex: plan.chunkIndex,
            chunkSize: plan.chunkSize,
            familyProcessed,
            familyTotal: args.publishItemIds.length,
            globalProcessed: args.globalProcessedOffset + familyProcessed,
            globalTotal: args.globalTotal,
        });
    }

    return { familySuccess, familyFailed };
}
