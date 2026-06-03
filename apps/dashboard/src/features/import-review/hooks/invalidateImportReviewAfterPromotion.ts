"use client";

import type { QueryClient } from "@tanstack/react-query";

import {
    CORE_REVIEW_IMPORT_PROMOTION_TARGET_SLUGS,
    coreReviewQueryKeys,
} from "@/src/features/core-review/hooks/coreReviewQueryKeys";
import {
    coreReviewSlugsForImportReviewPromotionFamilies,
    importReviewApiFamiliesForPromotionFamilies,
} from "@/src/features/import-review/utils/importReviewPromotionCoreReviewMap";

import { importReviewQueryKeys } from "./importReviewQueryKeys";

/** Dispatched when a publish batch promotion finishes so non–react-query screens can refetch. */
export const IMPORT_REVIEW_PROMOTION_COMPLETED_EVENT = "import-review:promotion-completed";

export type ImportReviewPromotionCompletedDetail = {
    reviewBatchId?: string;
    publishBatchId?: string;
    /** Import Review entity families from batch detail (underscore API names). */
    promotedFamilies?: string[];
};

export function emitImportReviewPromotionCompleted(detail?: ImportReviewPromotionCompletedDetail): void {
    if (typeof window === "undefined") {
        return;
    }
    window.dispatchEvent(
        new CustomEvent<ImportReviewPromotionCompletedDetail>(IMPORT_REVIEW_PROMOTION_COMPLETED_EVENT, {
            detail,
        })
    );
}

function familiesKey(families: readonly string[]): string {
    return [...families].map((f) => f.trim().toLowerCase()).filter(Boolean).sort().join(",");
}

async function invalidateImportReviewFamilyCaches(
    queryClient: QueryClient,
    families: readonly string[]
): Promise<void> {
    const apiFamilies = importReviewApiFamiliesForPromotionFamilies(families);

    if (apiFamilies.length === 0) {
        await Promise.all([
            queryClient.invalidateQueries({
                queryKey: ["import-review", "candidates"],
                refetchType: "all",
            }),
            queryClient.invalidateQueries({
                queryKey: ["import-review", "candidates-count"],
                refetchType: "all",
            }),
            queryClient.invalidateQueries({ queryKey: ["import-review", "filter-options"] }),
        ]);
    } else {
        await Promise.all(
            apiFamilies.flatMap((apiFamily) => [
                queryClient.invalidateQueries({
                    queryKey: ["import-review", "candidates", apiFamily],
                    refetchType: "all",
                }),
                queryClient.invalidateQueries({
                    queryKey: ["import-review", "candidates-count", apiFamily],
                    refetchType: "all",
                }),
                queryClient.invalidateQueries({
                    queryKey: ["import-review", "filter-options", apiFamily],
                }),
            ])
        );
    }

    await queryClient.invalidateQueries({ queryKey: ["import-review", "summary"] });
    await queryClient.invalidateQueries({ queryKey: ["import-review", "roads", "dry-run-summary"] });
}

async function invalidateCoreReviewPromotionTargets(
    queryClient: QueryClient,
    families: readonly string[]
): Promise<void> {
    const slugs =
        families.length > 0
            ? coreReviewSlugsForImportReviewPromotionFamilies(families)
            : [...CORE_REVIEW_IMPORT_PROMOTION_TARGET_SLUGS];

    await queryClient.invalidateQueries({
        queryKey: coreReviewQueryKeys.overviewVerificationSummary(),
    });

    if (slugs.length === 0) {
        await Promise.all([
            queryClient.invalidateQueries({ queryKey: coreReviewQueryKeys.list.all() }),
            queryClient.invalidateQueries({ queryKey: coreReviewQueryKeys.verificationTotals.all() }),
        ]);
        return;
    }

    await Promise.all(
        slugs.flatMap((slug) => [
            queryClient.invalidateQueries({ queryKey: coreReviewQueryKeys.list.family(slug) }),
            queryClient.invalidateQueries({ queryKey: coreReviewQueryKeys.verificationTotals.family(slug) }),
        ])
    );
}

async function invalidatePromotionWorkflowCaches(
    queryClient: QueryClient,
    detail?: ImportReviewPromotionCompletedDetail
): Promise<void> {
    const tasks: Promise<void>[] = [];

    if (detail?.publishBatchId) {
        tasks.push(
            queryClient.invalidateQueries({
                queryKey: importReviewQueryKeys.promotionBatch(detail.publishBatchId),
            })
        );
    }

    if (detail?.reviewBatchId) {
        tasks.push(
            queryClient.invalidateQueries({
                queryKey: importReviewQueryKeys.promotionBatches(detail.reviewBatchId),
            })
        );
        const key = familiesKey(detail.promotedFamilies ?? []);
        if (key) {
            tasks.push(
                queryClient.invalidateQueries({
                    queryKey: importReviewQueryKeys.promotionEligibility(detail.reviewBatchId, key),
                })
            );
        }
    }

    await Promise.all(tasks);
}

/**
 * Refetch import-review and core-review caches after a successful publish batch promotion.
 * When `promotedFamilies` is set, only matching entity modules are refreshed; otherwise all
 * promotion-related caches are invalidated conservatively.
 */
export async function invalidateImportReviewAfterPromotion(
    queryClient: QueryClient,
    detail?: ImportReviewPromotionCompletedDetail
): Promise<void> {
    const families = detail?.promotedFamilies ?? [];

    await Promise.all([
        invalidateImportReviewFamilyCaches(queryClient, families),
        invalidateCoreReviewPromotionTargets(queryClient, families),
        invalidatePromotionWorkflowCaches(queryClient, detail),
    ]);

    emitImportReviewPromotionCompleted(detail);
}
