import type { PrismaClient } from "@prisma/client";

import { isImportReviewRoadPromotionEnabled } from "./import-review-config.js";
import { ImportReviewPublishBatchNotFoundError } from "./import-review-promotion.errors.js";
import {
    ImportReviewPromotionRoadDryRunNoItemsError,
    ImportReviewPromotionRoadDryRunNotFoundError,
} from "./import-review-promotion-road-dry-run.errors.js";
import {
    ImportReviewPromotionRoadDryRunRepository,
    type RoadCandidatePromotionRow,
    type RoadPublishItemRow,
} from "./import-review-promotion-road-dry-run.repo.js";
import type { PostImportReviewPromotionRoadDryRunBody } from "./import-review-promotion-road-dry-run.schema.js";
import type {
    ImportReviewPromotionRoadDryRunResult,
    RoadDryRunItemResult,
    RoadDryRunItemStatus,
} from "./import-review-promotion-road-dry-run.types.js";
import { runImportReviewRoadRoutingValidation } from "./import-review-road-routing-validation.js";
import { SERIOUS_ROUTING_WARNING_CODES } from "./import-review-road-routing-validation.types.js";
import { StreetsRepository } from "../streets/streets.repo.js";

const DUPLICATE_RISK_CODES = new Set([
    "POSSIBLE_DUPLICATE_CORE_ROAD",
    "POSSIBLE_DUPLICATE_REVIEW_ROAD",
    "DUPLICATE_EXTERNAL_ID_IN_REVIEW_BATCH",
]);

function jsonbArrayNonEmpty(value: unknown): boolean {
    if (!value || typeof value !== "object" || !Array.isArray(value)) {
        return false;
    }
    return value.length > 0;
}

function hasRoutingValidationRun(reviewOverrides: unknown): boolean {
    if (!reviewOverrides || typeof reviewOverrides !== "object" || Array.isArray(reviewOverrides)) {
        return false;
    }
    const summary = (reviewOverrides as Record<string, unknown>).validation_summary;
    if (!summary || typeof summary !== "object" || Array.isArray(summary)) {
        return false;
    }
    return typeof (summary as Record<string, unknown>).validated_at === "string";
}

function collectBlockingReasons(args: {
    item: RoadPublishItemRow;
    candidate: RoadCandidatePromotionRow | null;
    roadClassValid: boolean | null;
}): string[] {
    const reasons: string[] = [];
    const { item, candidate } = args;

    if (item.review_candidate_id == null || candidate == null) {
        reasons.push("candidate_missing");
        return reasons;
    }

    if (item.publish_action === "protect_manual") {
        reasons.push("manual_protected");
    }
    if (candidate.auto_action === "protect_manual" || candidate.auto_action === "manual_protected") {
        reasons.push("manual_protected");
    }

    if (candidate.review_status !== "approved" || candidate.review_decision !== "approved") {
        reasons.push("not_approved");
    }

    if (
        candidate.promotion_status === "promoted" ||
        candidate.review_status === "promoted"
    ) {
        reasons.push("already_promoted");
    }

    if (candidate.geom == null) {
        reasons.push("geom_missing");
    } else {
        if (candidate.is_valid === false) {
            reasons.push("invalid_geom");
        }
        if (candidate.srid != null && candidate.srid !== 4326) {
            reasons.push("invalid_geom");
        }
        const gt = candidate.geom_type?.toUpperCase() ?? "";
        if (gt && gt !== "LINESTRING" && gt !== "MULTILINESTRING") {
            reasons.push("invalid_geom_type");
        }
    }

    if (args.roadClassValid === false) {
        reasons.push("invalid_road_class_id");
    }

    if (
        candidate.confidence_score != null &&
        (candidate.confidence_score < 0 || candidate.confidence_score > 100)
    ) {
        reasons.push("invalid_confidence");
    }

    if (
        !candidate.source_refs ||
        typeof candidate.source_refs !== "object" ||
        Array.isArray(candidate.source_refs) ||
        Object.keys(candidate.source_refs as object).length === 0
    ) {
        reasons.push("empty_source_refs");
    }

    if (jsonbArrayNonEmpty(candidate.validation_errors)) {
        reasons.push("validation_errors_present");
    }

    return [...new Set(reasons)];
}

function resolveItemStatus(
    blockingReasons: string[],
    warningCodes: string[]
): RoadDryRunItemStatus {
    if (blockingReasons.length > 0) {
        return "blocked";
    }
    const serious = warningCodes.filter((c) => SERIOUS_ROUTING_WARNING_CODES.has(c));
    const nonSerious = warningCodes.filter((c) => !SERIOUS_ROUTING_WARNING_CODES.has(c));
    if (serious.length > 0 && nonSerious.length === 0) {
        return "eligible_if_confirmed";
    }
    if (warningCodes.length > 0) {
        return "warning";
    }
    return "eligible";
}

export class ImportReviewPromotionRoadDryRunService {
    private readonly prisma: PrismaClient;
    private readonly repo: ImportReviewPromotionRoadDryRunRepository;
    private readonly streetsRepo: StreetsRepository;

    constructor(prisma: PrismaClient) {
        this.prisma = prisma;
        this.repo = new ImportReviewPromotionRoadDryRunRepository(prisma);
        this.streetsRepo = new StreetsRepository(prisma);
    }

    async runDryRun(
        batchId: bigint,
        body: PostImportReviewPromotionRoadDryRunBody
    ): Promise<ImportReviewPromotionRoadDryRunResult> {
        const meta = await this.repo.fetchBatchMeta(batchId);
        if (!meta) {
            throw new ImportReviewPublishBatchNotFoundError(batchId.toString());
        }

        const items = await this.repo.listRoadPublishItems(batchId);
        if (items.length === 0) {
            throw new ImportReviewPromotionRoadDryRunNoItemsError(batchId.toString());
        }

        const evaluated: RoadDryRunItemResult[] = [];
        for (const item of items) {
            evaluated.push(await this.evaluateItem(item, body));
        }

        const result = this.aggregateResult(batchId, meta.source_review_batch_id, evaluated);
        await this.repo.persistRoadDryRunResult(batchId, result);
        return result;
    }

    async getDryRunResult(batchId: bigint): Promise<ImportReviewPromotionRoadDryRunResult> {
        const meta = await this.repo.fetchBatchMeta(batchId);
        if (!meta) {
            throw new ImportReviewPublishBatchNotFoundError(batchId.toString());
        }
        const cached = await this.repo.readRoadDryRunResult(batchId);
        if (!cached) {
            throw new ImportReviewPromotionRoadDryRunNotFoundError(batchId.toString());
        }
        return cached;
    }

    async countRoadItemsInBatch(batchId: bigint): Promise<number> {
        return this.repo.countRoadItemsInBatch(batchId);
    }

    private async evaluateItem(
        item: RoadPublishItemRow,
        body: PostImportReviewPromotionRoadDryRunBody
    ): Promise<RoadDryRunItemResult> {
        const reviewBatchId = item.review_batch_id;
        let candidate: RoadCandidatePromotionRow | null = null;
        let roadClassValid: boolean | null = null;

        if (item.review_candidate_id != null && reviewBatchId != null) {
            candidate = await this.repo.fetchRoadCandidateForDryRun(
                item.review_candidate_id,
                reviewBatchId
            );
            if (candidate?.road_class_id != null) {
                roadClassValid = await this.repo.roadClassIdExists(candidate.road_class_id);
            }
        }

        const routingRow =
            item.review_candidate_id != null && reviewBatchId != null
                ? await this.repo.fetchRoadCandidateRoutingValidationRow(
                      item.review_candidate_id,
                      reviewBatchId
                  )
                : null;

        const blockingReasons = collectBlockingReasons({ item, candidate, roadClassValid });
        const warningCodes: string[] = [];
        let routingSummary: RoadDryRunItemResult["routing_validation_summary"] = null;

        if (
            blockingReasons.length === 0 &&
            routingRow != null &&
            reviewBatchId != null
        ) {
            if (!hasRoutingValidationRun(routingRow.review_overrides)) {
                warningCodes.push("ROUTING_VALIDATION_NOT_RUN");
            }

            const routingResult = await runImportReviewRoadRoutingValidation({
                prisma: this.prisma,
                streetsRepo: this.streetsRepo,
                row: routingRow,
                useReviewOverrides: body.use_review_overrides,
                connectivityThresholdM: body.connectivity_threshold_m,
                duplicateThresholdM: body.duplicate_threshold_m,
                confirmWarnings: body.confirm_routing_warnings,
            });

            for (const w of routingResult.warnings) {
                warningCodes.push(w.code);
            }
            for (const i of routingResult.info) {
                warningCodes.push(i.code);
            }
            for (const e of routingResult.errors) {
                if (!blockingReasons.includes(e.code)) {
                    blockingReasons.push(e.code);
                }
            }

            routingSummary = {
                validation_mode: routingResult.validation_mode,
                can_approve: routingResult.can_approve,
                stats: routingResult.stats,
                error_count: routingResult.errors.length,
                warning_count: routingResult.warnings.length,
            };
        }

        const uniqueWarnings = [...new Set(warningCodes)];
        const uniqueBlockers = [...new Set(blockingReasons)];
        const dryRunStatus = resolveItemStatus(uniqueBlockers, uniqueWarnings);

        return {
            publish_item_id: item.publish_item_id.toString(),
            review_candidate_id: item.review_candidate_id?.toString() ?? "",
            external_id: candidate?.external_id ?? routingRow?.external_id ?? null,
            publish_action: item.publish_action,
            dry_run_status: dryRunStatus,
            blocking_reasons: uniqueBlockers,
            warning_codes: uniqueWarnings,
            matched_core_id: candidate?.matched_core_id?.toString() ?? null,
            routing_validation_summary: routingSummary,
            geometry_summary: candidate
                ? {
                      srid: candidate.srid,
                      geom_type: candidate.geom_type,
                      length_m: candidate.length_m,
                      is_valid: candidate.is_valid,
                  }
                : null,
        };
    }

    private aggregateResult(
        batchId: bigint,
        reviewBatchId: bigint | null,
        items: RoadDryRunItemResult[]
    ): ImportReviewPromotionRoadDryRunResult {
        let wouldInsert = 0;
        let wouldUpdate = 0;
        let blocked = 0;
        let warning = 0;
        let duplicateRisk = 0;
        let routingWarning = 0;
        let seriousWarning = 0;
        let eligibleIfConfirmed = 0;

        for (const item of items) {
            if (item.dry_run_status === "blocked") {
                blocked += 1;
            } else if (item.dry_run_status === "warning") {
                warning += 1;
            } else if (item.dry_run_status === "eligible_if_confirmed") {
                eligibleIfConfirmed += 1;
            }

            if (item.publish_action === "insert" && item.dry_run_status !== "blocked") {
                wouldInsert += 1;
            }
            if (item.publish_action === "update" && item.dry_run_status !== "blocked") {
                wouldUpdate += 1;
            }

            if (item.warning_codes.some((c) => DUPLICATE_RISK_CODES.has(c))) {
                duplicateRisk += 1;
            }
            if (
                item.warning_codes.includes("ROUTING_VALIDATION_NOT_RUN") ||
                item.routing_validation_summary != null
            ) {
                routingWarning += 1;
            }
            if (item.warning_codes.some((c) => SERIOUS_ROUTING_WARNING_CODES.has(c))) {
                seriousWarning += 1;
            }
        }

        return {
            batch_id: batchId.toString(),
            review_batch_id: reviewBatchId?.toString() ?? null,
            would_insert_count: wouldInsert,
            would_update_count: wouldUpdate,
            blocked_count: blocked,
            warning_count: warning,
            duplicate_risk_count: duplicateRisk,
            routing_warning_count: routingWarning,
            serious_warning_count: seriousWarning,
            eligible_if_confirmed_count: eligibleIfConfirmed,
            disabled_because_env_flag_false: !isImportReviewRoadPromotionEnabled(),
            items,
            finished_at: new Date().toISOString(),
            message: "Road dry-run complete. No core rows were written.",
        };
    }
}

export function createImportReviewPromotionRoadDryRunService(
    prisma: PrismaClient
): ImportReviewPromotionRoadDryRunService {
    return new ImportReviewPromotionRoadDryRunService(prisma);
}
