import type { PrismaClient } from "@prisma/client";

import type { ImportReviewRoadDryRunSummary } from "./import-review-road-dry-run-summary.types.js";
import type { ImportReviewRoadRoutingReadinessSummary } from "./import-review-road-routing-readiness.types.js";
import {
    collectRoutingReadinessIssues,
    toRoutingReadinessSampleIssue,
} from "./import-review-road-routing-readiness-checks.js";
import { ImportReviewPublishBatchNotFoundError } from "./import-review-promotion.errors.js";
import {
    collectRoadDryRunItemErrors,
    toRoadDryRunSampleError,
} from "./import-review-promotion-road-dry-run-checks.js";
import {
    ImportReviewPromotionRoadDryRunNoEligibleItemsError,
    ImportReviewPromotionRoadDryRunNoItemsError,
    ImportReviewPromotionRoadDryRunNotFoundError,
    ImportReviewPromotionRoadDryRunValidationIncompleteError,
} from "./import-review-promotion-road-dry-run.errors.js";
import { aggregateRoadDryRunResult } from "./import-review-promotion-road-dry-run.helpers.js";
import {
    ImportReviewPromotionRoadDryRunRepository,
    type RoadCandidatePromotionRow,
    type RoadPublishItemRow,
} from "./import-review-promotion-road-dry-run.repo.js";
import type { PostImportReviewPromotionRoadDryRunBody } from "./import-review-promotion-road-dry-run.schema.js";
import type {
    ImportReviewPromotionRoadDryRunResult,
    RoadDryRunConnectivitySummary,
    RoadDryRunItemResult,
} from "./import-review-promotion-road-dry-run.types.js";

const ROAD_DRY_RUN_SAMPLE_ERRORS = 20;
const ROUTING_READINESS_SAMPLE_ISSUES = 20;

export type ImportReviewPromotionRoadDryRunResponse = {
    batch_id: string;
    road_dry_run: ImportReviewRoadDryRunSummary;
    routing_readiness_validation: ImportReviewRoadRoutingReadinessSummary;
};

export class ImportReviewPromotionRoadDryRunService {
    private readonly repo: ImportReviewPromotionRoadDryRunRepository;

    constructor(prisma: PrismaClient) {
        this.repo = new ImportReviewPromotionRoadDryRunRepository(prisma);
    }

    async runDryRun(
        batchId: bigint,
        body: PostImportReviewPromotionRoadDryRunBody
    ): Promise<ImportReviewPromotionRoadDryRunResponse> {
        const batch = await this.repo.fetchBatchForDryRun(batchId);
        if (!batch) {
            throw new ImportReviewPublishBatchNotFoundError(batchId.toString());
        }

        const roadItemCount = await this.repo.countRoadItemsInBatch(batchId);
        if (roadItemCount === 0) {
            throw new ImportReviewPromotionRoadDryRunNoItemsError(batchId.toString());
        }

        if (batch.validation_percent < 100) {
            throw new ImportReviewPromotionRoadDryRunValidationIncompleteError(
                batchId.toString(),
                batch.validation_percent
            );
        }

        if (!body.revalidate) {
            const cachedDry = await this.repo.readRoadDryRunSummary(batchId);
            const cachedRouting = await this.repo.readRoutingReadinessSummary(batchId);
            if (cachedDry && cachedRouting) {
                return {
                    batch_id: batchId.toString(),
                    road_dry_run: cachedDry,
                    routing_readiness_validation: cachedRouting,
                };
            }
        }

        const items = await this.repo.listPendingReadyRoadPublishItems(batchId);
        if (items.length === 0) {
            throw new ImportReviewPromotionRoadDryRunNoEligibleItemsError(batchId.toString());
        }

        await this.repo.upsertRoadDryRunStageLog({
            batchId,
            stageStatus: "running",
            progressPercent: 0,
            message: `Road dry-run: checking ${items.length} pending ready item(s).`,
        });
        await this.repo.upsertRoutingReadinessStageLog({
            batchId,
            stageStatus: "running",
            progressPercent: 0,
            message: `Routing readiness: checking ${items.length} item(s) (DB only, no Valhalla).`,
        });

        const sampleErrors: ImportReviewRoadDryRunSummary["sample_errors"] = [];
        const routingSampleErrors: ImportReviewRoadRoutingReadinessSummary["sample_errors"] =
            [];
        const routingSampleWarnings: ImportReviewRoadRoutingReadinessSummary["sample_warnings"] =
            [];
        const evaluated: RoadDryRunItemResult[] = [];
        let dryRunPassedCount = 0;
        let routingFailedCount = 0;
        let routingWarningCount = 0;

        for (let i = 0; i < items.length; i += 1) {
            const item = items[i]!;
            const candidate =
                item.review_candidate_id != null && batch.source_review_batch_id != null
                    ? await this.repo.fetchRoadCandidateForDryRun(
                          item.review_candidate_id,
                          batch.source_review_batch_id
                      )
                    : null;

            const itemResult = await this.evaluateDryRunItem(
                item,
                candidate,
                batch.source_review_batch_id
            );
            evaluated.push(itemResult);

            if (itemResult.dry_run_status === "safe_to_promote") {
                dryRunPassedCount += 1;
            } else if (sampleErrors.length < ROAD_DRY_RUN_SAMPLE_ERRORS) {
                sampleErrors.push(
                    toRoadDryRunSampleError({
                        item,
                        candidate,
                        code: itemResult.blocking_reasons[0] ?? "dry_run_failed",
                    })
                );
            }

            const routingIssues = await this.evaluateRoutingReadinessItem(item, candidate);
            if (routingIssues.errors.length > 0) {
                routingFailedCount += 1;
                if (routingSampleErrors.length < ROUTING_READINESS_SAMPLE_ISSUES) {
                    routingSampleErrors.push(
                        toRoutingReadinessSampleIssue({
                            item,
                            candidate,
                            code: routingIssues.errors[0]!,
                            severity: "error",
                        })
                    );
                }
            } else {
                routingWarningCount += routingIssues.warnings.length;
                if (
                    routingIssues.warnings.length > 0 &&
                    routingSampleWarnings.length < ROUTING_READINESS_SAMPLE_ISSUES
                ) {
                    routingSampleWarnings.push(
                        toRoutingReadinessSampleIssue({
                            item,
                            candidate,
                            code: routingIssues.warnings[0]!,
                            severity: "warning",
                        })
                    );
                }
            }

            const pct = Math.round(((i + 1) / items.length) * 100);
            await this.repo.upsertRoadDryRunStageLog({
                batchId,
                stageStatus: "running",
                progressPercent: pct,
                message: `Road dry-run ${i + 1}/${items.length}.`,
                details: {
                    passed_count: dryRunPassedCount,
                    failed_count: i + 1 - dryRunPassedCount,
                },
            });
            await this.repo.upsertRoutingReadinessStageLog({
                batchId,
                stageStatus: "running",
                progressPercent: pct,
                message: `Routing readiness ${i + 1}/${items.length}.`,
                details: {
                    failed_count: routingFailedCount,
                    warning_count: routingWarningCount,
                },
            });
        }

        const dryRunFailedCount = items.length - dryRunPassedCount;
        const roadDryRunSummary: ImportReviewRoadDryRunSummary = {
            status: dryRunFailedCount === 0 ? "passed" : "failed",
            checked_count: items.length,
            passed_count: dryRunPassedCount,
            failed_count: dryRunFailedCount,
            sample_errors: sampleErrors,
            ran_at: new Date().toISOString(),
        };

        const routingReadinessSummary: ImportReviewRoadRoutingReadinessSummary = {
            status: routingFailedCount === 0 ? "passed" : "failed",
            type: "db_routing_readiness",
            checked_count: items.length,
            failed_count: routingFailedCount,
            warning_count: routingWarningCount,
            sample_errors: routingSampleErrors,
            sample_warnings: routingSampleWarnings,
            ran_at: new Date().toISOString(),
        };

        const detailed = aggregateRoadDryRunResult({
            batchId,
            reviewBatchId: batch.source_review_batch_id,
            items: evaluated,
        });

        await this.repo.persistRoadDryRun(
            batchId,
            roadDryRunSummary,
            routingReadinessSummary,
            detailed
        );

        await this.repo.upsertRoadDryRunStageLog({
            batchId,
            stageStatus: roadDryRunSummary.status === "passed" ? "success" : "failed",
            progressPercent: 100,
            finished: true,
            message:
                roadDryRunSummary.status === "passed"
                    ? `Road dry-run passed (${roadDryRunSummary.checked_count} items).`
                    : `Road dry-run failed (${roadDryRunSummary.failed_count} blocked).`,
            details: roadDryRunSummary,
        });

        await this.repo.upsertRoutingReadinessStageLog({
            batchId,
            stageStatus: routingReadinessSummary.status === "passed" ? "success" : "failed",
            progressPercent: 100,
            finished: true,
            message:
                routingReadinessSummary.status === "passed"
                    ? `Routing readiness passed (${routingReadinessSummary.checked_count} items, DB checks only).`
                    : `Routing readiness failed (${routingReadinessSummary.failed_count} items).`,
            details: routingReadinessSummary,
        });

        return {
            batch_id: batchId.toString(),
            road_dry_run: roadDryRunSummary,
            routing_readiness_validation: routingReadinessSummary,
        };
    }

    async getDryRunResult(batchId: bigint): Promise<ImportReviewPromotionRoadDryRunResponse> {
        const batch = await this.repo.fetchBatchForDryRun(batchId);
        if (!batch) {
            throw new ImportReviewPublishBatchNotFoundError(batchId.toString());
        }
        const roadDryRun = await this.repo.readRoadDryRunSummary(batchId);
        const routingReadiness = await this.repo.readRoutingReadinessSummary(batchId);
        if (!roadDryRun || !routingReadiness) {
            throw new ImportReviewPromotionRoadDryRunNotFoundError(batchId.toString());
        }
        return {
            batch_id: batchId.toString(),
            road_dry_run: roadDryRun,
            routing_readiness_validation: routingReadiness,
        };
    }

    async countRoadItemsInBatch(batchId: bigint): Promise<number> {
        return this.repo.countRoadItemsInBatch(batchId);
    }

    private async evaluateDryRunItem(
        item: RoadPublishItemRow,
        candidate: RoadCandidatePromotionRow | null,
        _reviewBatchId: bigint | null
    ): Promise<RoadDryRunItemResult> {
        const roadClassResolvable = await this.isRoadClassResolvable(candidate);
        const externalId = candidate?.external_id?.trim() ?? "";
        const duplicateExternalIdInCore =
            item.publish_action === "insert" &&
            externalId.length > 0 &&
            (await this.repo.duplicateExternalIdInCore(externalId));

        const coreStreetExistsForUpdate =
            candidate?.matched_core_id != null
                ? await this.repo.coreStreetExists(candidate.matched_core_id)
                : false;

        const blockingReasons = collectRoadDryRunItemErrors({
            item,
            candidate,
            roadClassResolvable,
            duplicateExternalIdInCore,
            coreStreetExistsForUpdate,
        });

        const connectivitySummary: RoadDryRunConnectivitySummary | null =
            blockingReasons.length === 0
                ? {
                      validation_mode: "db_preflight",
                      nearby_core_roads: 0,
                      nearby_review_roads: 0,
                      connected_endpoints: 0,
                      isolated_endpoints: 0,
                      possible_unsplit_intersections: 0,
                  }
                : null;

        const dryRunStatus =
            blockingReasons.length === 0 ? "safe_to_promote" : ("blocked" as const);

        return {
            publish_item_id: item.publish_item_id.toString(),
            review_candidate_id: item.review_candidate_id?.toString() ?? "",
            external_id: candidate?.external_id ?? null,
            canonical_name: candidate?.canonical_name ?? null,
            publish_action: item.publish_action,
            dry_run_status: dryRunStatus,
            blocking_reasons: blockingReasons,
            warning_codes: [],
            info_codes: [],
            matched_core_id: candidate?.matched_core_id?.toString() ?? null,
            geometry_summary: candidate
                ? {
                      srid: candidate.srid,
                      geom_type: candidate.geom_type,
                      length_m: candidate.length_m,
                      is_valid: candidate.is_valid,
                      part_count: candidate.part_count,
                  }
                : null,
            connectivity_summary: connectivitySummary,
            duplicate_summary: duplicateExternalIdInCore
                ? {
                      possible_duplicates: 0,
                      duplicate_core_external_id: true,
                      duplicate_batch_external_id: false,
                      likely_name_class_duplicate: false,
                  }
                : null,
            routing_summary: candidate
                ? {
                      road_class_code: candidate.class_code ?? candidate.road_class,
                      is_oneway: candidate.is_oneway,
                      surface: null,
                      access: candidate.access,
                      speed_kph: candidate.speed_kph,
                      bridge: candidate.bridge,
                      tunnel: candidate.tunnel,
                      layer: null,
                  }
                : null,
            can_promote_later: dryRunStatus !== "blocked",
        };
    }

    private async evaluateRoutingReadinessItem(
        item: RoadPublishItemRow,
        candidate: RoadCandidatePromotionRow | null
    ): Promise<{ errors: string[]; warnings: string[] }> {
        const roadClassIdExists =
            candidate?.road_class_id != null
                ? await this.repo.roadClassIdExists(candidate.road_class_id)
                : false;
        const externalId = candidate?.external_id?.trim() ?? "";
        const duplicateExternalIdInCore =
            item.publish_action === "insert" &&
            externalId.length > 0 &&
            (await this.repo.duplicateExternalIdInCore(externalId));
        const coreStreetExistsForUpdate =
            candidate?.matched_core_id != null
                ? await this.repo.coreStreetExists(candidate.matched_core_id)
                : false;

        return collectRoutingReadinessIssues({
            item,
            candidate,
            roadClassIdExists,
            duplicateExternalIdInCore,
            coreStreetExistsForUpdate,
        });
    }

    private async isRoadClassResolvable(candidate: RoadCandidatePromotionRow | null): Promise<boolean> {
        if (!candidate) {
            return false;
        }
        if (candidate.road_class_id != null) {
            return this.repo.roadClassIdExists(candidate.road_class_id);
        }
        const classCode = candidate.class_code ?? candidate.road_class;
        if (!classCode?.trim()) {
            return false;
        }
        const count = await this.repo.countRoadClassesByCode(classCode);
        return count === 1;
    }
}

export function createImportReviewPromotionRoadDryRunService(
    prisma: PrismaClient
): ImportReviewPromotionRoadDryRunService {
    return new ImportReviewPromotionRoadDryRunService(prisma);
}

export { aggregateRoadDryRunResult };
