import { Prisma, type PrismaClient } from "@prisma/client";

import {
    getImportReviewEntityConfig,
    IMPORT_REVIEW_ENTITY_FAMILIES,
} from "./import-review-config.js";
import type { PublishBatchDerivedStatus } from "./import-review-publish-batch-summary.js";
import {
    ImportReviewPublishBatchSummaryRepository,
    derivePublishBatchStatus,
    parseDryRunFromSummary,
    parseCanPromoteFromSummary,
    parsePromotionResultFieldsFromSummary,
    parsePromotionResultTotalFromSummary,
    parseValidationOutcomeFromSummary,
} from "./import-review-publish-batch-summary.js";
import {
    buildFamilySummaryMetricsSql,
    buildFamilySummaryMetricsForBatchIdsSql,
    mapFamilySummaryMetricsDb,
    rollupFamilySummaries,
    type ImportReviewFamilySummaryMetrics,
    type ImportReviewFamilySummaryMetricsDb,
} from "./import-review-summary-counts.js";

export type ReviewBatchDerivedStatus =
    | "reviewing"
    | "publish_batch_created"
    | "partially_promoted"
    | "promoted"
    | "needs_attention"
    | "failed"
    | "uploaded"
    | "review_completed"
    | "archived";

export type ReviewBatchPublishAttemptSummary = {
    id: string;
    batch_name: string;
    stored_status: string;
    derived_status: PublishBatchDerivedStatus;
    created_at: string;
    promoted_at: string | null;
    total_item_count: number;
    success_count: number;
    failed_count: number;
    core_verified_count: number;
    import_review_marked_promoted_count: number;
};

export type ReviewBatchSummaryInput = {
    stored_status: string;
    candidate_counts: {
        batch_total_candidates: number;
        pending_review_candidates: number;
        approved_candidates: number;
        promoted_candidates: number;
        promotion_failed_candidates: number;
        ready_for_publish: number;
    };
    publish_attempts: ReviewBatchPublishAttemptSummary[];
};

export type ReviewBatchStoredStatus =
    | "uploaded"
    | "reviewing"
    | "review_completed"
    | "publish_batch_created"
    | "promoted"
    | "failed"
    | "archived";

export type ReviewBatchDerivedResult = {
    stored_status_recommendation: ReviewBatchStoredStatus;
    derived_status: ReviewBatchDerivedStatus;
    derived_status_reason: string | null;
    /** @deprecated Use derived_status_reason */
    status_note: string | null;
};

export type ReviewBatchComputedSummary = ReviewBatchSummaryInput & {
    derived_status: ReviewBatchDerivedStatus;
    derived_status_reason: string | null;
    stored_status_recommendation: ReviewBatchStoredStatus;
    status_note: string | null;
    latest_publish_batch: ReviewBatchPublishAttemptSummary | null;
    counts_by_entity_family: ImportReviewFamilySummaryMetrics[];
};


function toIso(d: Date | null): string | null {
    return d ? d.toISOString() : null;
}

function asReviewStoredStatus(status: string): ReviewBatchStoredStatus {
    const allowed: ReviewBatchStoredStatus[] = [
        "uploaded",
        "reviewing",
        "review_completed",
        "publish_batch_created",
        "promoted",
        "failed",
        "archived",
    ];
    if (allowed.includes(status as ReviewBatchStoredStatus)) {
        return status as ReviewBatchStoredStatus;
    }
    return "reviewing";
}

function buildReviewDerivedResult(
    input: ReviewBatchSummaryInput,
    derived_status: ReviewBatchDerivedStatus,
    stored_status_recommendation: ReviewBatchStoredStatus,
    derived_status_reason: string | null
): ReviewBatchDerivedResult {
    return {
        stored_status_recommendation,
        derived_status,
        derived_status_reason,
        status_note: derived_status_reason,
    };
}

export function deriveReviewBatchStatus(input: ReviewBatchSummaryInput): ReviewBatchDerivedResult {
    const {
        stored_status,
        candidate_counts,
        publish_attempts,
    } = input;
    const storedRec = asReviewStoredStatus(stored_status);

    if (stored_status === "archived") {
        return buildReviewDerivedResult(input, "archived", "archived", null);
    }
    if (stored_status === "uploaded") {
        return buildReviewDerivedResult(input, "uploaded", "uploaded", null);
    }

    const hasPublishBatches = publish_attempts.length > 0;
    const anyNeedsAttention = publish_attempts.some((pb) =>
        ["failed", "blocked", "partially_promoted", "invalid_empty_promoted"].includes(pb.derived_status)
    );
    const anyPromoted = publish_attempts.some((pb) => pb.derived_status === "promoted");
    const totalPromotionSuccess = publish_attempts.reduce((s, pb) => s + pb.success_count, 0);

    if (candidate_counts.promotion_failed_candidates > 0 || anyNeedsAttention) {
        if (candidate_counts.promoted_candidates > 0 || totalPromotionSuccess > 0) {
            return buildReviewDerivedResult(
                input,
                "needs_attention",
                storedRec,
                "Some promotion attempts failed while others succeeded or candidates remain unresolved."
            );
        }
        if (hasPublishBatches && totalPromotionSuccess === 0) {
            return buildReviewDerivedResult(
                input,
                "needs_attention",
                storedRec,
                "Publish batch promotion attempts failed."
            );
        }
    }

    if (
        candidate_counts.promoted_candidates > 0 &&
        candidate_counts.ready_for_publish > 0
    ) {
        return buildReviewDerivedResult(
            input,
            "partially_promoted",
            storedRec,
            `${candidate_counts.promoted_candidates} promoted; ${candidate_counts.ready_for_publish} still ready for publish.`
        );
    }

    if (
        candidate_counts.promoted_candidates > 0 &&
        candidate_counts.pending_review_candidates > 0 &&
        hasPublishBatches
    ) {
        return buildReviewDerivedResult(
            input,
            "partially_promoted",
            storedRec,
            `${candidate_counts.promoted_candidates} promoted; ${candidate_counts.pending_review_candidates} still pending review.`
        );
    }

    if (
        candidate_counts.approved_candidates > 0 &&
        candidate_counts.promoted_candidates === 0 &&
        candidate_counts.ready_for_publish === candidate_counts.approved_candidates &&
        hasPublishBatches &&
        !anyPromoted
    ) {
        return buildReviewDerivedResult(input, "publish_batch_created", "publish_batch_created", null);
    }

    if (
        candidate_counts.promoted_candidates > 0 &&
        candidate_counts.ready_for_publish === 0 &&
        candidate_counts.promotion_failed_candidates === 0 &&
        !anyNeedsAttention
    ) {
        return buildReviewDerivedResult(input, "promoted", "promoted", null);
    }

    if (hasPublishBatches && !anyPromoted && candidate_counts.promoted_candidates === 0) {
        return buildReviewDerivedResult(input, "publish_batch_created", "publish_batch_created", null);
    }

    if (
        candidate_counts.pending_review_candidates > 0 &&
        !hasPublishBatches
    ) {
        return buildReviewDerivedResult(input, "reviewing", "reviewing", null);
    }

    if (stored_status === "review_completed" && !hasPublishBatches) {
        return buildReviewDerivedResult(input, "review_completed", "review_completed", null);
    }

    if (stored_status === "promoted") {
        return buildReviewDerivedResult(input, "promoted", "promoted", null);
    }

    if (stored_status === "failed" && totalPromotionSuccess === 0) {
        return buildReviewDerivedResult(input, "failed", "failed", null);
    }

    // Never return plain reviewing when publish batches exist
    if (hasPublishBatches) {
        if (candidate_counts.promoted_candidates > 0) {
            return buildReviewDerivedResult(
                input,
                "partially_promoted",
                storedRec,
                `${candidate_counts.promoted_candidates} promoted; publish batches linked.`
            );
        }
        if (anyNeedsAttention) {
            return buildReviewDerivedResult(
                input,
                "needs_attention",
                storedRec,
                "Linked publish batches require attention."
            );
        }
        return buildReviewDerivedResult(input, "publish_batch_created", "publish_batch_created", null);
    }

    return buildReviewDerivedResult(input, "reviewing", "reviewing", null);
}

export class ImportReviewReviewBatchSummaryRepository {
    private readonly publishSummaryRepo: ImportReviewPublishBatchSummaryRepository;

    constructor(private readonly prisma: PrismaClient) {
        this.publishSummaryRepo = new ImportReviewPublishBatchSummaryRepository(prisma);
    }

    async computeReviewBatchSummary(reviewBatchId: bigint): Promise<ReviewBatchComputedSummary | null> {
        const batchRows = await this.prisma.$queryRaw<
            { status: string }[]
        >`
            SELECT status FROM import_review.review_batches WHERE id = ${reviewBatchId} LIMIT 1
        `;
        if (batchRows.length === 0) {
            return null;
        }

        const familyMetrics = await this.fetchFamilyMetrics(reviewBatchId);
        const rollup = rollupFamilySummaries(familyMetrics);

        const publishBatchRows = await this.prisma.$queryRaw<
            {
                id: bigint;
                batch_name: string;
                status: string;
                validated_at: Date | null;
                promoted_at: Date | null;
                summary: unknown;
                created_at: Date;
                total_item_count: number;
                success_count: number;
                failed_count: number;
            }[]
        >`
            SELECT
                id, batch_name, status, validated_at, promoted_at, summary, created_at,
                total_item_count, success_count, failed_count
            FROM system.system_publish_batches
            WHERE source_review_batch_id = ${reviewBatchId}
            ORDER BY created_at ASC, id ASC
        `;

        const publish_attempts: ReviewBatchPublishAttemptSummary[] = [];
        for (const row of publishBatchRows) {
            const computed = await this.publishSummaryRepo.computePublishBatchSummary(row.id);
            if (computed) {
                publish_attempts.push({
                    id: row.id.toString(),
                    batch_name: row.batch_name,
                    stored_status: row.status,
                    derived_status: computed.derived_status,
                    created_at: row.created_at.toISOString(),
                    promoted_at: toIso(row.promoted_at),
                    total_item_count: computed.item_counts.total,
                    success_count: computed.item_counts.success,
                    failed_count: computed.item_counts.failed,
                    core_verified_count: computed.core_verified_count,
                    import_review_marked_promoted_count: computed.import_review_marked_promoted_count,
                });
            } else {
                const itemInput = {
                    stored_status: row.status,
                    validated_at: row.validated_at,
                    promoted_at: row.promoted_at,
                    dry_run: parseDryRunFromSummary(row.summary),
                    validation_outcome: parseValidationOutcomeFromSummary(row.summary),
                    can_promote: parseCanPromoteFromSummary(row.summary),
                    item_counts: {
                        pending: 0,
                        success: row.success_count,
                        failed: row.failed_count,
                        skipped: 0,
                        rolled_back: 0,
                        total: row.total_item_count,
                    },
                    action_counts: { inserted: 0, updated: 0, merged: 0 },
                    core_verified_count: 0,
                    import_review_marked_promoted_count: 0,
                    promotion_result_total: parsePromotionResultTotalFromSummary(row.summary),
                    promotion_result_success_count:
                        parsePromotionResultFieldsFromSummary(row.summary)?.success_count ?? null,
                    promotion_result_core_verified_count:
                        parsePromotionResultFieldsFromSummary(row.summary)?.core_verified_count ?? null,
                    promotion_result_marked_promoted_count:
                        parsePromotionResultFieldsFromSummary(row.summary)
                            ?.import_review_marked_promoted_count ?? null,
                };
                const { derived_status } = derivePublishBatchStatus(itemInput);
                publish_attempts.push({
                    id: row.id.toString(),
                    batch_name: row.batch_name,
                    stored_status: row.status,
                    derived_status,
                    created_at: row.created_at.toISOString(),
                    promoted_at: toIso(row.promoted_at),
                    total_item_count: row.total_item_count,
                    success_count: row.success_count,
                    failed_count: row.failed_count,
                    core_verified_count: 0,
                    import_review_marked_promoted_count: 0,
                });
            }
        }

        const candidate_counts = {
            batch_total_candidates: rollup.batch_total_candidates,
            pending_review_candidates: rollup.pending_review_candidates,
            approved_candidates: rollup.approved_candidates,
            promoted_candidates: rollup.promoted_candidates,
            promotion_failed_candidates: rollup.promotion_failed_candidates,
            ready_for_publish: rollup.ready_for_publish_candidates,
        };

        const input: ReviewBatchSummaryInput = {
            stored_status: batchRows[0]!.status,
            candidate_counts,
            publish_attempts,
        };

        const derived = deriveReviewBatchStatus(input);
        const latest_publish_batch =
            publish_attempts.length > 0 ? publish_attempts[publish_attempts.length - 1]! : null;

        return {
            ...input,
            derived_status: derived.derived_status,
            derived_status_reason: derived.derived_status_reason,
            stored_status_recommendation: derived.stored_status_recommendation,
            status_note: derived.derived_status_reason,
            latest_publish_batch,
            counts_by_entity_family: familyMetrics,
        };
    }

    async syncReviewBatchStatus(reviewBatchId: bigint): Promise<ReviewBatchComputedSummary | null> {
        const computed = await this.computeReviewBatchSummary(reviewBatchId);
        if (!computed) {
            return null;
        }

        const summaryPatch = JSON.stringify({
            recomputed_at: new Date().toISOString(),
            derived_status: computed.derived_status,
            derived_status_reason: computed.derived_status_reason,
            status_note: computed.derived_status_reason,
            publish_batch_count: computed.publish_attempts.length,
        });

        await this.prisma.$executeRaw`
            UPDATE import_review.review_batches
            SET
                summary = coalesce(summary, '{}'::jsonb) || ${summaryPatch}::jsonb,
                updated_at = now()
            WHERE id = ${reviewBatchId}
        `;

        return computed;
    }

    private async fetchFamilyMetrics(reviewBatchId: bigint): Promise<ImportReviewFamilySummaryMetrics[]> {
        const parts: Prisma.Sql[] = [];
        for (const family of IMPORT_REVIEW_ENTITY_FAMILIES) {
            const config = getImportReviewEntityConfig(family);
            const tableName = `import_review.${config.importReviewTable}`;
            const exists = await this.prisma.$queryRaw<{ exists: boolean }[]>`
                SELECT to_regclass(${tableName}) IS NOT NULL AS exists
            `;
            if (exists[0]?.exists) {
                parts.push(buildFamilySummaryMetricsSql(config, reviewBatchId));
            }
        }
        if (parts.length === 0) {
            return [];
        }
        const rows = await this.prisma.$queryRaw<ImportReviewFamilySummaryMetricsDb[]>(
            Prisma.join(parts, " UNION ALL ")
        );
        return rows
            .filter((r) => Number(r.batch_total) > 0)
            .map(mapFamilySummaryMetricsDb);
    }
}
