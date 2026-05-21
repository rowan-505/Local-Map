import type { PrismaClient } from "@prisma/client";

import {
    isImportReviewPermanentCleanupEnabled,
    IMPORT_REVIEW_ENTITY_FAMILIES,
    type ImportReviewEntityFamilySlug,
} from "./import-review-config.js";
import {
    ImportReviewCleanupConfirmationError,
    ImportReviewCleanupDisabledError,
    ImportReviewCleanupNoEligibleRowsError,
    ImportReviewCleanupPublishBatchNotFoundError,
    ImportReviewCleanupReviewBatchNotFoundError,
} from "./import-review-cleanup-promoted.errors.js";
import { ImportReviewCleanupPromotedRepository } from "./import-review-cleanup-promoted.repo.js";
import type {
    PostImportReviewCleanupPromotedDryRunBody,
    PostImportReviewCleanupPromotedExecuteBody,
} from "./import-review-cleanup-promoted.schema.js";
import {
    CLEANUP_INELIGIBLE_REASONS,
    CLEANUP_SUPPORTED_FAMILIES,
    type CleanupBlockedExampleRow,
    type CleanupEvaluatedRow,
    type CleanupExampleRow,
    type CleanupIneligibleReason,
    type CleanupPromotedScope,
    type ImportReviewCleanupPromotedDryRunResult,
    type ImportReviewCleanupPromotedExecuteResult,
} from "./import-review-cleanup-promoted.types.js";
import { ImportReviewPromotionPromoteRepository } from "./import-review-promotion-promote.repo.js";
import { ImportReviewPromotionValidationRepository } from "./import-review-promotion-validation.repo.js";

const EXAMPLE_LIMIT = 5;

function resolveEntityFamilies(requested: string[] | undefined): ImportReviewEntityFamilySlug[] {
    if (!requested?.length) {
        return [...CLEANUP_SUPPORTED_FAMILIES];
    }
    const supported = new Set<string>(IMPORT_REVIEW_ENTITY_FAMILIES);
    const out: ImportReviewEntityFamilySlug[] = [];
    for (const family of requested) {
        if (supported.has(family)) {
            out.push(family as ImportReviewEntityFamilySlug);
        }
    }
    return out.length > 0 ? out : [...CLEANUP_SUPPORTED_FAMILIES];
}

function toExampleRow(row: CleanupEvaluatedRow): CleanupExampleRow {
    return {
        candidate_id: row.candidate_id.toString(),
        entity_family: row.entity_family,
        promoted_core_id: row.promoted_core_id?.toString() ?? null,
        promoted_at: row.promoted_at?.toISOString() ?? null,
        publish_batch_id: row.publish_batch_id?.toString() ?? null,
    };
}

function emptyReasonCounts(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const reason of CLEANUP_INELIGIBLE_REASONS) {
        counts[reason] = 0;
    }
    return counts;
}

export class ImportReviewCleanupPromotedService {
    private readonly repo: ImportReviewCleanupPromotedRepository;
    private readonly promoteRepo: ImportReviewPromotionPromoteRepository;

    constructor(prisma: PrismaClient) {
        this.repo = new ImportReviewCleanupPromotedRepository(prisma);
        const validationRepo = new ImportReviewPromotionValidationRepository(prisma);
        this.promoteRepo = new ImportReviewPromotionPromoteRepository(prisma, validationRepo);
    }

    async dryRun(
        body: PostImportReviewCleanupPromotedDryRunBody
    ): Promise<ImportReviewCleanupPromotedDryRunResult> {
        const scope = await this.resolveScope(body);
        const evaluated = await this.evaluateScope(scope);
        return this.buildDryRunResult(scope, evaluated);
    }

    async execute(
        body: PostImportReviewCleanupPromotedExecuteBody
    ): Promise<ImportReviewCleanupPromotedExecuteResult> {
        if (!isImportReviewPermanentCleanupEnabled()) {
            throw new ImportReviewCleanupDisabledError();
        }
        if (body.confirmation_text !== "DELETE PROMOTED REVIEW DATA") {
            throw new ImportReviewCleanupConfirmationError(
                'confirmation_text must be exactly "DELETE PROMOTED REVIEW DATA".'
            );
        }

        const scope = await this.resolveScope(body);
        const evaluated = await this.evaluateScope(scope);
        const eligible = evaluated.filter((row) => row.reason === null);

        if (eligible.length === 0) {
            throw new ImportReviewCleanupNoEligibleRowsError();
        }

        const deletedByEntity: Record<string, number> = {};
        let deletedCount = 0;
        for (const family of scope.entityFamilies) {
            const ids = eligible
                .filter((row) => row.entity_family === family)
                .map((row) => row.candidate_id);
            const deleted = await this.repo.deleteCandidatesByFamily(family, ids);
            deletedByEntity[family] = deleted;
            deletedCount += deleted;
        }

        return {
            review_batch_id: scope.reviewBatchId.toString(),
            publish_batch_id: scope.publishBatchId?.toString() ?? null,
            deleted_count: deletedCount,
            deleted_by_entity: deletedByEntity,
            message: `Permanently deleted ${deletedCount} import_review candidate row(s). Core and system publish history were not modified.`,
        };
    }

    private async resolveScope(
        body: PostImportReviewCleanupPromotedDryRunBody
    ): Promise<CleanupPromotedScope> {
        const reviewBatchId = body.review_batch_id;
        if (!(await this.repo.reviewBatchExists(reviewBatchId))) {
            throw new ImportReviewCleanupReviewBatchNotFoundError(reviewBatchId.toString());
        }
        if (body.publish_batch_id !== undefined) {
            if (!(await this.repo.publishBatchExists(body.publish_batch_id))) {
                throw new ImportReviewCleanupPublishBatchNotFoundError(body.publish_batch_id.toString());
            }
        }

        return {
            reviewBatchId,
            entityFamilies: resolveEntityFamilies(body.entity_families),
            publishBatchId: body.publish_batch_id,
            olderThanDays: body.older_than_days,
        };
    }

    private async evaluateScope(scope: CleanupPromotedScope): Promise<CleanupEvaluatedRow[]> {
        const batchVerifyCache = new Map<string, boolean>();
        const summaryCache = new Map<string, boolean>();
        const rows: CleanupEvaluatedRow[] = [];

        for (const family of scope.entityFamilies) {
            const familyRows = await this.repo.evaluateFamilyCandidates(family, scope);
            rows.push(...familyRows);
        }

        const alreadyCleaned = await this.repo.listAlreadyCleaned(scope);
        for (const cleaned of alreadyCleaned) {
            rows.push({
                candidate_id: cleaned.candidate_id,
                entity_family: cleaned.entity_family as ImportReviewEntityFamilySlug,
                reason: "already_cleaned",
                publish_batch_id: cleaned.publish_batch_id,
                promoted_core_id: null,
                promoted_at: null,
                geometry_count: 0,
            });
        }

        const batchIds = [
            ...new Set(
                rows
                    .map((row) => row.publish_batch_id)
                    .filter((id): id is bigint => id != null)
            ),
        ];
        const batchRows = await this.repo.fetchBatchVerificationRows(batchIds);
        for (const batch of batchRows) {
            const success = batch.success_count ?? 0;
            const coreVerified = batch.core_verified_count ?? 0;
            summaryCache.set(
                batch.id.toString(),
                success > 0 && coreVerified >= success
            );
        }

        for (const row of rows) {
            if (row.reason !== null || row.publish_batch_id == null) {
                continue;
            }
            const batchKey = row.publish_batch_id.toString();
            if (!batchVerifyCache.has(batchKey)) {
                const verify = await this.promoteRepo.getBatchVerify(row.publish_batch_id);
                batchVerifyCache.set(
                    batchKey,
                    verify.verification_status !== "failed" || summaryCache.get(batchKey) === true
                );
            }
            if (batchVerifyCache.get(batchKey) !== true && summaryCache.get(batchKey) !== true) {
                row.reason = "verification_failed";
            }
        }

        return rows;
    }

    private buildDryRunResult(
        scope: CleanupPromotedScope,
        rows: CleanupEvaluatedRow[]
    ): ImportReviewCleanupPromotedDryRunResult {
        const eligibleCounts: Record<string, number> = {};
        const reasonCounts = emptyReasonCounts();
        let estimatedRows = 0;
        let estimatedGeometry = 0;
        const eligibleExamples: CleanupExampleRow[] = [];
        const blockedExamples: CleanupBlockedExampleRow[] = [];

        for (const row of rows) {
            if (row.reason === null) {
                eligibleCounts[row.entity_family] = (eligibleCounts[row.entity_family] ?? 0) + 1;
                estimatedRows += 1;
                estimatedGeometry += row.geometry_count;
                if (eligibleExamples.length < EXAMPLE_LIMIT) {
                    eligibleExamples.push(toExampleRow(row));
                }
            } else {
                reasonCounts[row.reason] = (reasonCounts[row.reason] ?? 0) + 1;
                if (blockedExamples.length < EXAMPLE_LIMIT) {
                    blockedExamples.push({ ...toExampleRow(row), reason: row.reason });
                }
            }
        }

        const filteredReasonCounts: Record<string, number> = {};
        for (const [reason, count] of Object.entries(reasonCounts)) {
            if (count > 0) {
                filteredReasonCounts[reason] = count;
            }
        }

        return {
            review_batch_id: scope.reviewBatchId.toString(),
            publish_batch_id: scope.publishBatchId?.toString() ?? null,
            selected_entity_families: [...scope.entityFamilies],
            eligible_counts_by_entity: eligibleCounts,
            not_eligible_counts_by_reason: filteredReasonCounts,
            estimated_rows_to_delete: estimatedRows,
            estimated_geometry_rows_to_delete: estimatedGeometry,
            example_eligible_rows: eligibleExamples,
            example_blocked_rows: blockedExamples,
            execute_enabled: isImportReviewPermanentCleanupEnabled(),
            message: "Dry-run complete. No database rows were changed.",
        };
    }
}

export function createImportReviewCleanupPromotedService(
    prisma: PrismaClient
): ImportReviewCleanupPromotedService {
    return new ImportReviewCleanupPromotedService(prisma);
}
