import type { PrismaClient } from "@prisma/client";

import { rebuildSearchAfterSplitPromotion } from "../search/bulk-promotion-search-rebuild.js";
import { ImportReviewBatchNotFoundError } from "./import-review-errors.js";
import { ImportReviewPlacePromotionRepository } from "./import-review-place-promotion.repo.js";
import type { PostImportReviewPlacePromotionBody } from "./import-review-place-promotion.schema.js";
import type {
    ImportReviewSplitPromotionResponse,
    SplitPromotionItemResult,
} from "./import-review-split-promotion.types.js";
import type { AddressValidationIssue } from "./import-review-address-validation.types.js";

function parseIssues(value: unknown, severity: "error" | "warning"): AddressValidationIssue[] {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.flatMap((item) => {
        if (!item || typeof item !== "object") {
            return [];
        }
        const row = item as Record<string, unknown>;
        const itemSeverity = row.severity === "error" || row.severity === "warning" ? row.severity : severity;
        if (itemSeverity !== severity) {
            return [];
        }
        return [{
            code: typeof row.code === "string" ? row.code : "unknown",
            message: typeof row.message === "string" ? row.message : "Validation issue",
            severity: itemSeverity,
            ...(typeof row.field === "string" ? { field: row.field } : {}),
        }];
    });
}

export function createImportReviewPlacePromotionService(prisma: PrismaClient) {
    const repo = new ImportReviewPlacePromotionRepository(prisma);

    return {
        dryRun(body: PostImportReviewPlacePromotionBody): Promise<ImportReviewSplitPromotionResponse> {
            return runPromotion(prisma, repo, body, true);
        },

        promote(body: PostImportReviewPlacePromotionBody): Promise<ImportReviewSplitPromotionResponse> {
            return runPromotion(prisma, repo, body, false);
        },
    };
}

async function runPromotion(
    prisma: PrismaClient,
    repo: ImportReviewPlacePromotionRepository,
    body: PostImportReviewPlacePromotionBody,
    dryRun: boolean
): Promise<ImportReviewSplitPromotionResponse> {
    if (body.review_batch_id !== undefined && !(await repo.reviewBatchExists(body.review_batch_id))) {
        throw new ImportReviewBatchNotFoundError(body.review_batch_id.toString());
    }

    const candidates = await repo.listCandidates({
        reviewBatchId: body.review_batch_id,
        candidateIds: body.candidate_ids,
    });

    const summary = { promoted: 0, skipped: 0, failed: 0 };
    const items: SplitPromotionItemResult[] = [];
    const warnings: string[] = [];
    const finishedAt = new Date().toISOString();

    await prisma.$transaction(async (tx) => {
        const txRepo = new ImportReviewPlacePromotionRepository(tx);

        for (const candidate of candidates) {
            const reasons: string[] = [];
            const blockers = parseIssues(candidate.validation_errors, "error");
            const promotionWarnings = parseIssues(candidate.validation_warnings, "warning");

            if ((candidate.review_status ?? "").trim().toLowerCase() !== "approved") {
                reasons.push("review_status_not_approved");
            }
            if (candidate.validation_status === "blocked") {
                reasons.push("validation_blocked");
            } else if (!["valid", "valid_with_warnings"].includes(candidate.validation_status)) {
                reasons.push("validation_not_ready");
            }
            if (candidate.validation_status === "valid_with_warnings" && !body.confirm_warnings) {
                reasons.push("confirm_warnings_required");
            }
            if ((candidate.promotion_status ?? "").trim().toLowerCase() === "promoted" || candidate.promoted_core_id !== null) {
                reasons.push("already_promoted");
            }
            if (blockers.length > 0) {
                reasons.push("validation_blockers_present");
            }
            if (candidate.has_core_duplicate) {
                reasons.push("duplicate_core_place");
                blockers.push({
                    code: "duplicate_core_place",
                    message: "Possible duplicate core.core_places row detected.",
                    severity: "error",
                });
            }

            if (reasons.length > 0) {
                summary.skipped += 1;
                items.push({
                    candidate_id: candidate.id.toString(),
                    external_id: candidate.external_id,
                    outcome: "skipped",
                    reasons,
                    core_id: null,
                    promotion_warnings: promotionWarnings,
                    promotion_blockers: blockers,
                });
                continue;
            }

            if (dryRun) {
                summary.promoted += 1;
                items.push({
                    candidate_id: candidate.id.toString(),
                    external_id: candidate.external_id,
                    outcome: "would_promote",
                    reasons: [],
                    core_id: null,
                    promotion_warnings: promotionWarnings,
                    promotion_blockers: [],
                });
                continue;
            }

            try {
                const corePlaceId = await txRepo.insertCorePlace(candidate.id);
                await txRepo.syncPlaceNames(candidate.id, corePlaceId);
                await txRepo.markPromoted(candidate.id, corePlaceId);
                summary.promoted += 1;
                items.push({
                    candidate_id: candidate.id.toString(),
                    external_id: candidate.external_id,
                    outcome: "promoted",
                    reasons: [],
                    core_id: corePlaceId.toString(),
                    promotion_warnings: promotionWarnings,
                    promotion_blockers: [],
                });
            } catch (err) {
                summary.failed += 1;
                const message = err instanceof Error ? err.message : "Place promotion failed";
                warnings.push(`place candidate ${candidate.id.toString()}: ${message}`);
                items.push({
                    candidate_id: candidate.id.toString(),
                    external_id: candidate.external_id,
                    outcome: "failed",
                    reasons: ["insert_failed"],
                    core_id: null,
                    promotion_warnings: promotionWarnings,
                    promotion_blockers: [{ code: "promotion_insert_failed", message, severity: "error" }],
                });
            }
        }
    });

    if (!dryRun && summary.promoted > 0) {
        try {
            await rebuildSearchAfterSplitPromotion(
                prisma,
                {
                    workflow: "import-review-place-promotion",
                    promotedCount: summary.promoted,
                    views: ["places"],
                    batchId: body.review_batch_id,
                },
            );
        } catch (searchRebuildErr) {
            warnings.push(
                `search index rebuild failed after place promotion: ${
                    searchRebuildErr instanceof Error ? searchRebuildErr.message : "unknown error"
                }`,
            );
        }
    }

    return {
        dry_run: dryRun,
        review_batch_id:
            body.review_batch_id?.toString() ??
            (candidates.length > 0 ? candidates[0]!.review_batch_id.toString() : null),
        candidate_count: candidates.length,
        ...summary,
        warnings,
        items,
        finished_at: finishedAt,
    };
}
