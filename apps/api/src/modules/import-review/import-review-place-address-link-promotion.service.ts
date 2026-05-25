import type { PrismaClient } from "@prisma/client";

import { ImportReviewBatchNotFoundError } from "./import-review-errors.js";
import { ImportReviewPlaceAddressLinkPromotionRepository } from "./import-review-place-address-link-promotion.repo.js";
import type { PostImportReviewPlaceAddressLinkPromotionBody } from "./import-review-place-address-link-promotion.schema.js";
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

export function createImportReviewPlaceAddressLinkPromotionService(prisma: PrismaClient) {
    const repo = new ImportReviewPlaceAddressLinkPromotionRepository(prisma);

    return {
        dryRun(body: PostImportReviewPlaceAddressLinkPromotionBody): Promise<ImportReviewSplitPromotionResponse> {
            return runPromotion(prisma, repo, body, true);
        },

        promote(body: PostImportReviewPlaceAddressLinkPromotionBody): Promise<ImportReviewSplitPromotionResponse> {
            return runPromotion(prisma, repo, body, false);
        },
    };
}

async function runPromotion(
    prisma: PrismaClient,
    repo: ImportReviewPlaceAddressLinkPromotionRepository,
    body: PostImportReviewPlaceAddressLinkPromotionBody,
    dryRun: boolean
): Promise<ImportReviewSplitPromotionResponse> {
    if (body.review_batch_id !== undefined && !(await repo.reviewBatchExists(body.review_batch_id))) {
        throw new ImportReviewBatchNotFoundError(body.review_batch_id.toString());
    }

    const links = await repo.listLinks({
        reviewBatchId: body.review_batch_id,
        linkIds: body.link_ids,
    });

    const summary = { promoted: 0, skipped: 0, failed: 0 };
    const items: SplitPromotionItemResult[] = [];
    const warnings: string[] = [];
    const finishedAt = new Date().toISOString();

    await prisma.$transaction(async (tx) => {
        const txRepo = new ImportReviewPlaceAddressLinkPromotionRepository(tx);

        for (const link of links) {
            const reasons: string[] = [];
            const blockers = parseIssues(link.validation_errors, "error");
            const promotionWarnings = parseIssues(link.validation_warnings, "warning");

            if ((link.review_status ?? "").trim().toLowerCase() !== "approved") {
                reasons.push("review_status_not_approved");
            }
            if (link.validation_status === "blocked" || link.validation_status === "failed") {
                reasons.push("validation_blocked");
            } else if (!["valid", "valid_with_warnings", "passed", "warnings"].includes(link.validation_status ?? "")) {
                reasons.push("validation_not_ready");
            }
            if (link.validation_status === "valid_with_warnings" && !body.confirm_warnings) {
                reasons.push("confirm_warnings_required");
            }
            if ((link.promotion_status ?? "").trim().toLowerCase() === "promoted") {
                reasons.push("already_promoted");
            }
            if (blockers.length > 0) {
                reasons.push("validation_blockers_present");
            }
            if (link.resolved_core_place_id === null || !link.place_exists_in_core) {
                reasons.push("core_place_missing");
                blockers.push({
                    code: "core_place_missing",
                    message: "Place/address link requires a promoted or matched core place.",
                    severity: "error",
                });
            }
            if (link.resolved_core_address_id === null || !link.address_exists_in_core) {
                reasons.push("core_address_missing");
                blockers.push({
                    code: "core_address_missing",
                    message: "Place/address link requires a promoted or matched core address.",
                    severity: "error",
                });
            }
            if (link.duplicate_core_link) {
                reasons.push("duplicate_core_place_address");
            }

            if (reasons.length > 0) {
                summary.skipped += 1;
                items.push({
                    candidate_id: link.id.toString(),
                    external_id: link.external_id,
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
                    candidate_id: link.id.toString(),
                    external_id: link.external_id,
                    outcome: "would_promote",
                    reasons: [],
                    core_id: null,
                    promotion_warnings: promotionWarnings,
                    promotion_blockers: [],
                });
                continue;
            }

            try {
                const inserted = await txRepo.insertCorePlaceAddress({
                    placeId: link.resolved_core_place_id!,
                    addressId: link.resolved_core_address_id!,
                    relationType: link.relation_type ?? "primary",
                    isPrimary: link.is_primary ?? true,
                });
                await txRepo.markPromoted(link.id);
                summary.promoted += 1;
                items.push({
                    candidate_id: link.id.toString(),
                    external_id: link.external_id,
                    outcome: "promoted",
                    reasons: inserted ? [] : ["already_exists"],
                    core_id: `${link.resolved_core_place_id!.toString()}:${link.resolved_core_address_id!.toString()}`,
                    promotion_warnings: promotionWarnings,
                    promotion_blockers: [],
                });
            } catch (err) {
                summary.failed += 1;
                const message = err instanceof Error ? err.message : "Link promotion failed";
                warnings.push(`place/address link ${link.id.toString()}: ${message}`);
                items.push({
                    candidate_id: link.id.toString(),
                    external_id: link.external_id,
                    outcome: "failed",
                    reasons: ["insert_failed"],
                    core_id: null,
                    promotion_warnings: promotionWarnings,
                    promotion_blockers: [{ code: "promotion_insert_failed", message, severity: "error" }],
                });
            }
        }
    });

    return {
        dry_run: dryRun,
        review_batch_id:
            body.review_batch_id?.toString() ??
            (links.length > 0 ? links[0]!.review_batch_id.toString() : null),
        candidate_count: links.length,
        ...summary,
        warnings,
        items,
        finished_at: finishedAt,
    };
}
