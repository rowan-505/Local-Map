import type { FastifyBaseLogger } from "fastify";

import type { JwtUser } from "../../plugins/auth.js";
import {
    buildCreateBatchSuccessResponse,
    resolveCreateBatchFamilies,
} from "./import-review-promotion-create-batch-api.js";
import { assertPublishBatchLimits } from "./import-review-promotion-batch-limits.js";
import {
    ImportReviewPublishBatchNotFoundError,
    ImportReviewPublishBatchRetryNotAvailableError,
    ImportReviewPromotionNoEligibleCandidatesError,
} from "./import-review-promotion.errors.js";
import type { ImportReviewPromotionPromoteRepository } from "./import-review-promotion-promote.repo.js";
import type { ImportReviewPromotionRepository } from "./import-review-promotion.repo.js";
import { resolveFailedReadyRetryCandidates } from "./import-review-promotion-retry-failed-ready.js";
import type {
    ImportReviewCreateRetryPublishBatchResult,
    ImportReviewPublishBatchDetail,
    PostImportReviewPromotionBatchRetryFailedReadyBody,
} from "./import-review-promotion.types.js";

function reviewedByUserId(user: JwtUser): bigint | null {
    const raw = user.sub?.trim();
    if (!raw || !/^\d+$/.test(raw)) {
        return null;
    }
    return BigInt(raw);
}

function defaultRetryBatchName(sourceBatchId: bigint, familySlugs: readonly string[]): string {
    const stamp = new Date().toISOString().slice(0, 16).replace("T", "-").replace(":", "");
    const familyTag = familySlugs.length === 1 ? familySlugs[0] : "multi";
    return `retry-${familyTag}-from-batch-${sourceBatchId.toString()}-${stamp}`;
}

export async function createRetryBatchFromFailedReady(args: {
    sourceBatchId: bigint;
    body: PostImportReviewPromotionBatchRetryFailedReadyBody;
    user: JwtUser;
    repo: ImportReviewPromotionRepository;
    promoteRepo: ImportReviewPromotionPromoteRepository;
    getBatchById: (batchId: bigint) => Promise<ImportReviewPublishBatchDetail>;
    log?: FastifyBaseLogger;
}): Promise<ImportReviewCreateRetryPublishBatchResult> {
    const sourceRow = await args.repo.fetchPublishBatchById(args.sourceBatchId);
    if (!sourceRow) {
        throw new ImportReviewPublishBatchNotFoundError(args.sourceBatchId.toString());
    }
    const reviewBatchId = sourceRow.source_review_batch_id;
    if (reviewBatchId == null) {
        throw new ImportReviewPublishBatchRetryNotAvailableError(
            args.sourceBatchId.toString(),
            "Source publish batch has no review batch."
        );
    }

    const selection = await args.promoteRepo.selectPublishItemsForPromotion(args.sourceBatchId);
    if (selection.promotableIds.length > 0) {
        throw new ImportReviewPublishBatchRetryNotAvailableError(
            args.sourceBatchId.toString(),
            "This batch still has promotable pending items. Promote or reset validation on this batch instead of creating a retry batch."
        );
    }

    const prisma = args.repo.getPrisma();
    const { source_failed_ready_count, resolution } = await resolveFailedReadyRetryCandidates({
        prisma,
        sourceBatchId: args.sourceBatchId,
        reviewBatchId,
    });

    if (source_failed_ready_count === 0) {
        throw new ImportReviewPublishBatchRetryNotAvailableError(
            args.sourceBatchId.toString(),
            "No failed publish items with validation status ready were found on this batch."
        );
    }

    if (resolution.totalItems === 0) {
        throw new ImportReviewPromotionNoEligibleCandidatesError(
            0,
            "No eligible candidates remain for retry (already promoted, blocked in another batch, or excluded)."
        );
    }

    const familySlugs = resolution.familyConfigs.map((f) => f.entityFamily);
    const families = resolveCreateBatchFamilies(familySlugs, undefined);

    assertPublishBatchLimits({
        families: familySlugs,
        totalItems: resolution.totalItems,
        confirmation: {
            confirm_large_batch: args.body.confirm_large_batch,
            allow_high_risk_families: args.body.allow_high_risk_families,
            mixed_high_risk_confirm: args.body.mixed_high_risk_confirm,
        },
        context: "create",
        enforceLargeBatchLimit: true,
    });

    const batchName = args.body.batch_name?.trim() || defaultRetryBatchName(args.sourceBatchId, familySlugs);
    const scope = await args.repo.resolveScope({ review_batch_id: reviewBatchId });
    const options = { includeWarnings: false, includeMerged: false };

    const { batch, itemsAdded, candidatesMarked, byFamily, timing, totalSelected } =
        await args.repo.createPublishBatchMultiFamily({
            scope,
            batchName,
            note: args.body.note?.trim() || `Retry from publish batch ${args.sourceBatchId.toString()}`,
            families,
            options,
            createdByUserId: reviewedByUserId(args.user),
            candidateIdsByFamily: resolution.candidateIdsByFamily,
        });

    const detail = await args.getBatchById(batch.id);
    const buildingsMarked =
        byFamily.find((f) => f.entity_family === "buildings")?.marked_batched ?? 0;
    const familyLabels = familySlugs.join(", ");
    const skipped = byFamily.reduce(
        (sum, f) => sum + f.skipped_reasons.reduce((s, r) => s + r.count, 0),
        0
    );
    const timing_ms = {
        resolve_ms: timing.resolve_ms,
        eligibility_ms: timing.eligibility_ms,
        payload_ms: timing.payload_ms,
        transaction_ms: timing.transaction_ms,
        total_ms: timing.resolve_ms + timing.eligibility_ms + timing.payload_ms + timing.transaction_ms,
    };

    const count_by_family = Object.fromEntries(
        byFamily.map((f) => [f.entity_family, f.items_added])
    );
    for (const family of familySlugs) {
        if (count_by_family[family] === undefined) {
            count_by_family[family] = resolution.countByFamily[family] ?? 0;
        }
    }

    const base = buildCreateBatchSuccessResponse({
        batch,
        detail,
        reviewBatchId,
        mode: "selected",
        families: familySlugs,
        countByFamily: count_by_family,
        itemsAdded,
        totalSelected,
        candidatesMarked,
        byFamily,
        skipped,
        timing_ms,
        buildingsMarked,
        message: `Created retry publish batch "${batch.batch_name}" with ${itemsAdded} item(s) from ${source_failed_ready_count} failed ready item(s) on batch ${args.sourceBatchId.toString()} across [${familyLabels}]. Run validation on the new batch before promotion.`,
    });

    args.log?.info(
        {
            source_publish_batch_id: args.sourceBatchId.toString(),
            new_publish_batch_id: base.id,
            review_batch_id: reviewBatchId.toString(),
            source_failed_ready_count,
            items_added: itemsAdded,
            count_by_family,
        },
        "retry_failed_ready_publish_batch_created"
    );

    return {
        ...base,
        source_publish_batch_id: args.sourceBatchId.toString(),
        failed_ready_source_count: source_failed_ready_count,
        failed_ready_retry_count: resolution.totalItems,
    };
}
