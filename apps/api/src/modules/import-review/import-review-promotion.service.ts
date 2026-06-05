import type { FastifyBaseLogger } from "fastify";
import { Prisma } from "@prisma/client";

import type { JwtUser } from "../../plugins/auth.js";
import type { PublishBatchRowDb, ReadyBuildingCandidateRowDb } from "./import-review-promotion.repo.js";
import { ImportReviewPromotionRepository } from "./import-review-promotion.repo.js";
import {
    ImportReviewPromotionPromoteRunner,
    isImportReviewPromotionWorkerRunning,
} from "./import-review-promotion-promote.js";
import { recoverStalePromotionBatchIfNeeded } from "./import-review-promotion-promote-control.js";
import {
    isPromotionHeartbeatStale,
    isPromotionHeartbeatStalled,
    parsePromotionHeartbeatFromSummary,
} from "./import-review-promotion-promote-progress.js";
import { ImportReviewPromotionPromoteRepository } from "./import-review-promotion-promote.repo.js";
import { ImportReviewPromotionValidationRunner } from "./import-review-promotion-validation.js";
import { ImportReviewPromotionValidationRepository } from "./import-review-promotion-validation.repo.js";
import {
    extractStageLogHeartbeatIso,
    heartbeatAnchorAt,
    isValidationHeartbeatStalled,
} from "./import-review-promotion-validation-control.js";
import { evaluateRoadPromotionGates } from "./import-review-road-promotion-gates.js";
import { buildPromotionPreflightFromItemSelection } from "./import-review-promotion-promote-api.js";
import { classifyPublishItemsForPromotion } from "./import-review-promotion-execution.js";
import {
    buildPromotionEligibilityDetailsResponse,
    parsePromotionEligibilityFamilyParam,
} from "./import-review-promotion-eligibility-details-api.js";
import { parseEligibilityDetailsListFilters } from "./import-review-promotion-eligibility-details-filters.js";
import { ImportReviewPromotionEligibilityDetailsRepository } from "./import-review-promotion-eligibility-details.repo.js";
import type { ImportReviewPromotionEligibilityDetailsResponse } from "./import-review-promotion-eligibility-details.types.js";
import {
    buildPromotionScopeEligibilityFamilyRow,
    buildReadonlyPromotionEligibilityResponse,
    isPrismaPoolTimeoutError,
    PROMOTION_ELIGIBILITY_DB_POOL_TIMEOUT_MESSAGE,
    type ImportReviewPromotionEligibilityResponse,
} from "./import-review-promotion-eligibility-api.js";
import { mapFamilyPromotionScopeCounts } from "./import-review-promotion-scope-counts.js";
import { assertPublishBatchLimits } from "./import-review-promotion-batch-limits.js";
import {
    buildCreateBatchDryRunResponse,
    buildCreateBatchSuccessResponse,
    resolveCreateBatchFamilies,
} from "./import-review-promotion-create-batch-api.js";
import {
    ImportReviewPromotionCreateBatchResolver,
    resolveCreateBatchName,
} from "./import-review-promotion-create-batch.js";
import type {
    ImportReviewCreatePublishBatchDryRunResult,
    ImportReviewCreatePublishBatchResult,
    ImportReviewPromotionBatchEligibilityResponse,
    ImportReviewPromotionReadyCandidateItem,
    ImportReviewPromotionReadyCandidatesResponse,
    ImportReviewPromotionReadyCounts,
    ImportReviewPublishBatchDetail,
    ImportReviewPublishBatchEntityValidationCounts,
    ImportReviewPublishBatchLogsResponse,
    ImportReviewPublishBatchProgressResponse,
    ImportReviewPublishBatchPromotionResultSummary,
    ImportReviewPublishBatchSummary,
    ImportReviewPublishBatchValidationResultSummary,
    ImportReviewPublishBatchVerifyResponse,
    ImportReviewPublishStageLogItem,
    ImportReviewReleaseStaleBatchedResponse,
    ImportReviewRepairInvalidPromotedBatchesResponse,
    ImportReviewCreateRetryPublishBatchResult,
    ImportReviewStartPublishBatchPromotionResponse,
    ImportReviewStartPublishBatchValidationResponse,
} from "./import-review-promotion.types.js";
import type {
    ImportReviewPromotionBatchEligibilityQuery,
    ImportReviewPromotionEligibilityDetailsQuery,
    ImportReviewPromotionEligibilityQuery,
    ImportReviewPromotionBatchesListQuery,
    ImportReviewPromotionReadyCandidatesQuery,
    ImportReviewPromotionReadyQuery,
    PostImportReviewPromotionBatchBody,
    PostImportReviewPromotionBatchPromoteBody,
    PostImportReviewPromotionBatchRetryFailedReadyBody,
    PostImportReviewPromotionReleaseStaleBatchedBody,
    PostImportReviewPromotionBatchValidateBody,
} from "./import-review-promotion.schema.js";
import { DEFAULT_PUBLISH_ENTITY_FAMILIES, resolvePublishEntityFamilies } from "./import-review-promotion-config.js";
import { IMPORT_REVIEW_PUBLISH_VALIDATION_STAGES } from "./import-review-promotion-validation.types.js";
import { ImportReviewInvalidScopeError } from "./import-review-errors.js";
import {
    ImportReviewPublishBatchNotFoundError,
    ImportReviewPublishBatchValidationNotRunningError,
    ImportReviewPublishBatchValidationResetError,
    ImportReviewTransportPromotionDeprecatedError,
} from "./import-review-promotion.errors.js";
import { parsePromotionOutcomeStatus } from "./import-review-promotion-batch-status.js";
import {
    ImportReviewPublishBatchSummaryRepository,
    applyComputedCountsToBatchSummary,
    parseEntityFamiliesFromBatchSummary,
    parsePromotionStatusFromSummary,
    type PublishBatchComputedSummary,
} from "./import-review-publish-batch-summary.js";
import { releaseStaleBatchedImportReviewCandidates } from "./import-review-promotion-release-stale-batched.js";
import { createRetryBatchFromFailedReady } from "./import-review-promotion-retry-failed-ready.service.js";
import { resolveFailedReadyRetryCandidates } from "./import-review-promotion-retry-failed-ready.js";
import { isDisabledImportReviewPromotionFamily } from "./import-review-promotion-config.js";
import { ImportReviewReviewBatchSummaryRepository } from "./import-review-review-batch-summary.js";
import {
    createImportReviewPromotionRoadDryRunService,
    ImportReviewPromotionRoadDryRunService,
} from "./import-review-promotion-road-dry-run.service.js";
import type { ImportReviewPromotionRoadDryRunResponse } from "./import-review-promotion-road-dry-run.service.js";
import type { PostImportReviewPromotionRoadDryRunBody } from "./import-review-promotion-road-dry-run.schema.js";
import {
    createImportReviewPromotionRoutingBarrierDryRunService,
    ImportReviewPromotionRoutingBarrierDryRunService,
} from "./import-review-promotion-routing-barrier-dry-run.service.js";
import type { ImportReviewPromotionRoutingBarrierDryRunResult } from "./import-review-promotion-routing-barrier-dry-run.types.js";
import {
    buildMinimalPublishBatchProgressResponse,
    serializePublishBatchLogsResponse,
    serializePublishBatchProgressResponse,
} from "./import-review-promotion-progress-serializer.js";
import { runPublishBatchDryRun } from "./import-review-promotion-batch-dry-run.service.js";
import {
    parsePublishBatchDryRunResultFromSummary,
    publishBatchDryRunPassed,
} from "./import-review-publish-batch-dry-run.js";
import type { ImportReviewPublishBatchDryRunApiResponse } from "./import-review-promotion-batch-dry-run.types.js";
import type { PostImportReviewPromotionBatchDryRunBody } from "./import-review-promotion-batch-dry-run.schema.js";
import { normalizePublishBatchLifecycleStatus } from "./import-review-publish-batch-lifecycle.js";
import { ImportReviewPromotionProgress } from "./import-review-promotion-progress.js";
import type { PostImportReviewPromotionRoutingBarrierDryRunBody } from "./import-review-promotion-routing-barrier-dry-run.schema.js";
import {
    countIncompleteValidationItems,
    countPendingPromotableItems,
    resolvePromotionStageCancelTarget,
    resolvePromotionStageResumeAction,
    type PromotionStageSnapshot,
} from "./import-review-promotion-stage-control.js";
import { ImportReviewPublishBatchStageControlError } from "./import-review-promotion.errors.js";
import { batchPromotionBlocksValidationReset } from "./import-review-promotion-batch-status.js";

function reviewedByUserId(user: JwtUser): bigint | null {
    const sub = user.sub?.trim();
    if (!sub || !/^\d+$/.test(sub)) {
        return null;
    }
    return BigInt(sub);
}

function toIso(d: Date | null): string | null {
    return d ? d.toISOString() : null;
}

function n(v: bigint | number): number {
    return typeof v === "bigint" ? Number(v) : v;
}

function throwPromotionFamilyResolutionError(err: unknown): never {
    if (err instanceof ImportReviewTransportPromotionDeprecatedError) {
        throw err;
    }
    throw new ImportReviewInvalidScopeError(
        err instanceof Error ? err.message : "Invalid entity_families"
    );
}

function numOrNull(v: unknown): number | null {
    if (v === null || v === undefined) {
        return null;
    }
    if (typeof v === "number" && Number.isFinite(v)) {
        return v;
    }
    if (typeof v === "string" && v.trim() !== "") {
        const x = Number(v);
        return Number.isFinite(x) ? x : null;
    }
    return null;
}

function bigStr(v: bigint | null): string | null {
    return v !== null ? v.toString() : null;
}

export type ImportReviewPromotionStageControlResponse = {
    batch_id: string;
    action: string;
    status: string;
    message: string;
};

function mapReadyCandidateRow(
    row: ReadyBuildingCandidateRowDb,
    includeGeometry: boolean
): ImportReviewPromotionReadyCandidateItem {
    return {
        id: row.id.toString(),
        public_id: row.public_id,
        external_id: row.external_id,
        name: row.name,
        canonical_name: row.canonical_name,
        class_code: row.class_code,
        building_type: row.building_type,
        building_type_id: bigStr(row.building_type_id),
        building_type_code: row.building_type_code,
        building_type_name: row.building_type_name,
        confidence_score: numOrNull(row.confidence_score),
        match_status: row.match_status,
        auto_action: row.auto_action,
        review_status: row.review_status,
        review_decision: row.review_decision,
        promotion_status: row.promotion_status,
        validation_warnings_count: row.validation_warnings_count,
        validation_errors_count: row.validation_errors_count,
        updated_at: row.updated_at.toISOString(),
        source_snapshot_version: row.source_snapshot_version,
        review_batch_id: row.review_batch_id.toString(),
        normalized_data: row.normalized_data,
        source_refs: row.source_refs,
        geometry: includeGeometry ? (row.geometry as Record<string, unknown> | null) : null,
    };
}

function mapBatchSummary(
    row: PublishBatchRowDb,
    computed: PublishBatchComputedSummary | null
): ImportReviewPublishBatchSummary {
    const base = {
        id: row.id.toString(),
        public_id: row.public_id,
        batch_name: row.batch_name,
        status: row.status,
        source_review_batch_id: row.source_review_batch_id?.toString() ?? null,
        source_snapshot_version: row.source_snapshot_version,
        region_code: row.region_code,
        total_item_count: row.total_item_count,
        success_count: row.success_count,
        failed_count: row.failed_count,
        skipped_count: row.skipped_count,
        note: row.note,
        created_at: row.created_at.toISOString(),
        published_at: toIso(row.published_at),
        promoted_at: toIso(row.promoted_at),
    };
    const enriched = applyComputedCountsToBatchSummary(base, computed);
    return {
        ...enriched,
        derived_status: enriched.derived_status,
        derived_status_reason: enriched.derived_status_reason,
        stored_status_recommendation: enriched.stored_status_recommendation,
        status_note: enriched.derived_status_reason,
    };
}

function parseValidationResult(summary: unknown): ImportReviewPublishBatchValidationResultSummary | null {
    if (!summary || typeof summary !== "object" || Array.isArray(summary)) {
        return null;
    }
    const vr = (summary as Record<string, unknown>).validation_result;
    if (!vr || typeof vr !== "object" || Array.isArray(vr)) {
        return null;
    }
    const o = vr as Record<string, unknown>;
    const byAction = o.by_publish_action;
    const entityFamily = o.entity_family;
    const byEntityRaw = o.by_entity;

    const byEntity: Record<string, ImportReviewPublishBatchEntityValidationCounts> = {};
    if (byEntityRaw && typeof byEntityRaw === "object" && !Array.isArray(byEntityRaw)) {
        for (const [key, val] of Object.entries(byEntityRaw as Record<string, unknown>)) {
            if (val && typeof val === "object" && !Array.isArray(val)) {
                const b = val as Record<string, unknown>;
                byEntity[key] = {
                    total: Number(b.total ?? 0),
                    valid: Number(b.valid ?? b.ready ?? 0),
                    ready: Number(b.ready ?? b.valid ?? 0),
                    warning: Number(b.warning ?? 0),
                    blocked: Number(b.blocked ?? 0),
                    skipped: Number(b.skipped ?? 0),
                };
            }
        }
    }

    const promotableFamilies = Array.isArray(o.promotable_entity_families)
        ? (o.promotable_entity_families as string[])
        : ["buildings"];

    return {
        outcome:
            o.outcome === "blocked"
                ? "blocked"
                : o.outcome === "partial"
                  ? "partial"
                  : o.outcome === "ready" || o.outcome === "passed"
                    ? "passed"
                    : "passed",
        can_promote: o.can_promote === false ? false : true,
        requires_warning_confirmation: o.requires_warning_confirmation === true,
        promotable_count:
            typeof o.promotable_count === "number"
                ? o.promotable_count
                : (typeof o.ready_count === "number" ? o.ready_count : typeof o.valid_count === "number" ? o.valid_count : 0) +
                  (typeof o.warning_count === "number" ? o.warning_count : 0),
        total_count:
            typeof o.total_count === "number"
                ? o.total_count
                : typeof o.total_items === "number"
                  ? o.total_items
                  : 0,
        ready_count:
            typeof o.ready_count === "number"
                ? o.ready_count
                : typeof o.valid_count === "number"
                  ? o.valid_count
                  : 0,
        valid_count: typeof o.valid_count === "number" ? o.valid_count : typeof o.ready_count === "number" ? o.ready_count : 0,
        warning_count: typeof o.warning_count === "number" ? o.warning_count : 0,
        blocked_count: typeof o.blocked_count === "number" ? o.blocked_count : 0,
        skipped_count: typeof o.skipped_count === "number" ? o.skipped_count : 0,
        total_items: typeof o.total_items === "number" ? o.total_items : 0,
        by_publish_action:
            byAction && typeof byAction === "object" && !Array.isArray(byAction)
                ? {
                      insert: Number((byAction as Record<string, unknown>).insert ?? 0),
                      update: Number((byAction as Record<string, unknown>).update ?? 0),
                      merge: Number((byAction as Record<string, unknown>).merge ?? 0),
                  }
                : { insert: 0, update: 0, merge: 0 },
        by_entity: byEntity,
        entity_family:
            entityFamily && typeof entityFamily === "object" && !Array.isArray(entityFamily)
                ? { buildings: Number((entityFamily as Record<string, unknown>).buildings ?? 0) }
                : { buildings: 0 },
        promotable_entity_families: promotableFamilies,
    };
}

function currentEntityFamilyFromLog(details: unknown): string | null {
    if (!details || typeof details !== "object" || Array.isArray(details)) {
        return null;
    }
    const record = details as Record<string, unknown>;
    const current = record.current_family;
    if (typeof current === "string" && current.trim().length > 0) {
        return current;
    }
    const legacy = record.entity_family;
    return typeof legacy === "string" ? legacy : null;
}

function parseLogsSummary(summary: unknown, key: "validation_logs_summary" | "promotion_logs_summary"): string | null {
    if (!summary || typeof summary !== "object" || Array.isArray(summary)) {
        return null;
    }
    const v = (summary as Record<string, unknown>)[key];
    return typeof v === "string" ? v : null;
}

function parsePromotionResult(summary: unknown): ImportReviewPublishBatchPromotionResultSummary | null {
    if (!summary || typeof summary !== "object" || Array.isArray(summary)) {
        return null;
    }
    const pr = (summary as Record<string, unknown>).promotion_result;
    if (!pr || typeof pr !== "object" || Array.isArray(pr)) {
        return null;
    }
    const o = pr as Record<string, unknown>;
    const statusRaw = o.status;
    const status =
        statusRaw === "promoted" ||
        statusRaw === "partial" ||
        statusRaw === "partially_promoted" ||
        statusRaw === "failed" ||
        statusRaw === "promotion_failed"
            ? statusRaw === "promotion_failed"
                ? "failed"
                : statusRaw === "partially_promoted"
                  ? "partial"
                  : statusRaw
            : "failed";
    const sampleFailures = Array.isArray(o.sample_failures)
        ? (o.sample_failures as ImportReviewPublishBatchPromotionResultSummary["sample_failures"])
        : undefined;
    return {
        status,
        promoted_count: Number(o.promoted_count ?? o.success_count ?? 0),
        inserted_count: Number(o.inserted_count ?? 0),
        updated_count: Number(o.updated_count ?? 0),
        success_count: Number(o.success_count ?? 0),
        failed_count: Number(o.failed_count ?? 0),
        skipped_count: Number(o.skipped_count ?? 0),
        total: Number(o.total ?? 0),
        core_verified_count: Number(o.core_verified_count ?? 0),
        import_review_marked_promoted_count: Number(o.import_review_marked_promoted_count ?? 0),
        verification_metadata_applied_count: Number(o.verification_metadata_applied_count ?? 0),
        verification_metadata_skipped_already_verified_count: Number(
            o.verification_metadata_skipped_already_verified_count ?? 0
        ),
        partial_success: o.partial_success === true ? true : undefined,
        started_at: typeof o.started_at === "string" ? o.started_at : "",
        finished_at: typeof o.finished_at === "string" ? o.finished_at : "",
        duration_ms: Number(o.duration_ms ?? 0),
        promoted_entity_families: Array.isArray(o.promoted_entity_families)
            ? (o.promoted_entity_families as string[])
            : ["buildings"],
        sample_failures: sampleFailures,
    };
}

function isPrismaConnectionPoolTimeout(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2024";
}

function workflowForStatus(status: string): "validation" | "promotion" | "idle" {
    if (status === "validating") {
        return "validation";
    }
    if (status === "promoting") {
        return "promotion";
    }
    return "idle";
}

export class ImportReviewPromotionService {
    private readonly pipelineProgress: ImportReviewPromotionProgress;
    private readonly validationRunner: ImportReviewPromotionValidationRunner;
    private readonly promoteRunner: ImportReviewPromotionPromoteRunner;
    private readonly publishSummaryRepo: ImportReviewPublishBatchSummaryRepository;
    private readonly reviewSummaryRepo: ImportReviewReviewBatchSummaryRepository;
    private readonly roadDryRunService: ImportReviewPromotionRoadDryRunService;
    private readonly routingBarrierDryRunService: ImportReviewPromotionRoutingBarrierDryRunService;
    private readonly eligibilityDetailsRepo: ImportReviewPromotionEligibilityDetailsRepository;

    constructor(
        private readonly repo: ImportReviewPromotionRepository,
        private readonly validationRepo: ImportReviewPromotionValidationRepository,
        private readonly promoteRepo: ImportReviewPromotionPromoteRepository
    ) {
        const prisma = this.validationRepo.prisma;
        this.pipelineProgress = new ImportReviewPromotionProgress(prisma);
        this.validationRunner = new ImportReviewPromotionValidationRunner(
            this.validationRepo,
            this.pipelineProgress
        );
        this.promoteRunner = new ImportReviewPromotionPromoteRunner(
            this.promoteRepo,
            this.pipelineProgress
        );
        this.publishSummaryRepo = new ImportReviewPublishBatchSummaryRepository(prisma);
        this.reviewSummaryRepo = new ImportReviewReviewBatchSummaryRepository(prisma);
        this.roadDryRunService = createImportReviewPromotionRoadDryRunService(prisma);
        this.routingBarrierDryRunService = createImportReviewPromotionRoutingBarrierDryRunService(prisma);
        this.eligibilityDetailsRepo = new ImportReviewPromotionEligibilityDetailsRepository(prisma);
    }

    private async computeBatchSummary(batchId: bigint): Promise<PublishBatchComputedSummary | null> {
        return this.publishSummaryRepo.computePublishBatchSummary(batchId);
    }

    async getReady(query: ImportReviewPromotionReadyQuery): Promise<ImportReviewPromotionReadyCounts> {
        const scope = await this.repo.resolveScope(query);
        const counts = await this.repo.countPromotionReady(scope, query.include_merged ?? false);
        return {
            entity_family: "buildings",
            review_batch_id: scope.reviewBatchId.toString(),
            source_snapshot_version: scope.snapshotVersion,
            ready_count: n(counts.ready_count),
            already_batched_count: n(counts.already_batched_count),
            promoted_count: n(counts.promoted_count),
            blocked_in_active_publish_batch_count: n(counts.blocked_in_active_publish_batch_count),
        };
    }

    async listReadyCandidates(
        query: ImportReviewPromotionReadyCandidatesQuery
    ): Promise<ImportReviewPromotionReadyCandidatesResponse> {
        if (query.entity_family !== "buildings") {
            throw new ImportReviewInvalidScopeError("Only entity_family=buildings is supported for ready-candidates");
        }
        const scope = await this.repo.resolveScope(query);
        const { rows, total, counts } = await this.repo.listReadyBuildingCandidates({
            scope,
            includeMerged: query.include_merged ?? false,
            limit: query.limit ?? 50,
            offset: query.offset ?? 0,
            sort: query.sort ?? "updated_at_desc",
            includeGeometry: query.include_geometry ?? false,
        });
        return {
            items: rows.map((row) => mapReadyCandidateRow(row, query.include_geometry ?? false)),
            total: n(total),
            limit: query.limit ?? 50,
            offset: query.offset ?? 0,
            counts: {
                ready: n(counts.ready_count),
                already_batched: n(counts.already_batched_count),
                promoted: n(counts.promoted_count),
                blocked_active_batch: n(counts.blocked_in_active_publish_batch_count),
            },
        };
    }

    async listBatches(
        query: ImportReviewPromotionBatchesListQuery
    ): Promise<{ items: ImportReviewPublishBatchSummary[]; total: number; limit: number; offset: number }> {
        const scope = await this.repo.resolveScope(query);
        const { rows, total } = await this.repo.listPublishBatches({
            scope,
            limit: query.limit ?? 50,
            offset: query.offset ?? 0,
        });
        const summaries = await Promise.all(
            rows.map((row) => this.computeBatchSummary(row.id))
        );
        return {
            items: rows.map((row, i) => mapBatchSummary(row, summaries[i] ?? null)),
            total: n(total),
            limit: query.limit ?? 50,
            offset: query.offset ?? 0,
        };
    }

    async getBatchById(batchId: bigint): Promise<ImportReviewPublishBatchDetail> {
        const row = await this.repo.fetchPublishBatchById(batchId);
        if (!row) {
            throw new ImportReviewPublishBatchNotFoundError(batchId.toString());
        }
        const computed = await this.computeBatchSummary(batchId);
        const itemCounts = await this.repo.fetchPublishItemCounts(batchId);
        const buildingItemCounts = await this.repo.fetchBuildingPublishItemCounts(batchId);
        const itemCountsByEntityFamily: Record<
            string,
            {
                pending: number;
                success: number;
                failed: number;
                skipped: number;
                total: number;
            }
        > = {};
        for (const row of computed?.by_entity_family ?? []) {
            itemCountsByEntityFamily[row.entity_family] = {
                pending: row.pending,
                success: row.success,
                failed: row.failed,
                skipped: row.skipped,
                total: row.total,
            };
        }
        const fromSummary = parseEntityFamiliesFromBatchSummary(row.summary).filter(
            (family) => !isDisabledImportReviewPromotionFamily(family)
        );
        const fromItems = Object.keys(itemCountsByEntityFamily).filter(
            (family) => !isDisabledImportReviewPromotionFamily(family)
        );
        const entityFamilies = fromSummary.length > 0 ? fromSummary : fromItems.sort();
        return {
            ...mapBatchSummary(row, computed),
            entity_families: entityFamilies,
            item_counts: {
                pending: n(itemCounts.pending),
                success: n(itemCounts.success),
                failed: n(itemCounts.failed),
                skipped: n(itemCounts.skipped),
                rolled_back: n(itemCounts.rolled_back),
                total: n(itemCounts.total),
            },
            building_item_counts: {
                pending: n(buildingItemCounts.pending),
                success: n(buildingItemCounts.success),
                failed: n(buildingItemCounts.failed),
                skipped: n(buildingItemCounts.skipped),
                rolled_back: n(buildingItemCounts.rolled_back),
                total: n(buildingItemCounts.total),
            },
            item_counts_by_entity_family: itemCountsByEntityFamily,
        };
    }

    async getPromotionEligibilityDetails(
        query: ImportReviewPromotionEligibilityDetailsQuery
    ): Promise<ImportReviewPromotionEligibilityDetailsResponse> {
        const scope = await this.repo.resolveScope({
            review_batch_id: query.review_batch_id,
        });
        const config = parsePromotionEligibilityFamilyParam(query.family);
        if (!(await this.eligibilityDetailsRepo.pgRegclassExists(config.candidateTable))) {
            return buildPromotionEligibilityDetailsResponse({
                reviewBatchId: scope.reviewBatchId,
                family: config.entityFamily,
                bucket: query.bucket,
                total: 0,
                limit: query.limit,
                offset: query.offset,
                rows: [],
                config,
            });
        }

        const options = {
            includeWarnings: query.include_warnings ?? false,
            includeMerged: false,
        };
        const filters = parseEligibilityDetailsListFilters({
            search: query.search,
            reason_code: query.reason_code,
            sort_by: query.sort_by,
            sort_order: query.sort_order,
        });
        const total = await this.eligibilityDetailsRepo.countBucket({
            config,
            reviewBatchId: scope.reviewBatchId,
            bucket: query.bucket,
            options,
            filters,
        });
        const rows = await this.eligibilityDetailsRepo.listBucket({
            config,
            reviewBatchId: scope.reviewBatchId,
            bucket: query.bucket,
            options,
            filters,
            limit: query.limit,
            offset: query.offset,
        });

        return buildPromotionEligibilityDetailsResponse({
            reviewBatchId: scope.reviewBatchId,
            family: config.entityFamily,
            bucket: query.bucket,
            total,
            limit: query.limit,
            offset: query.offset,
            rows,
            config,
        });
    }

    async getPromotionEligibility(
        query: ImportReviewPromotionEligibilityQuery
    ): Promise<ImportReviewPromotionEligibilityResponse> {
        const scope = await this.repo.resolveScope({
            review_batch_id: query.review_batch_id,
        });
        const familyConfigs = resolveCreateBatchFamilies(query.families, undefined);
        const familyRows = [];

        const options = {
            includeWarnings: query.include_warnings ?? false,
            includeMerged: false,
        };

        for (const config of familyConfigs) {
            try {
                const row = await this.repo.countFamilyPromotionScope(
                    config,
                    scope.reviewBatchId,
                    options
                );
                familyRows.push(
                    buildPromotionScopeEligibilityFamilyRow({
                        config,
                        scope: mapFamilyPromotionScopeCounts(row),
                        countError:
                            row === null
                                ? {
                                      ok: false,
                                      code: "FAMILY_TABLE_MISSING",
                                      message: `Candidate table is not available for ${config.entityFamily}.`,
                                  }
                                : null,
                    })
                );
            } catch (error) {
                const countError = isPrismaPoolTimeoutError(error)
                    ? {
                          ok: false as const,
                          code: "DB_POOL_TIMEOUT",
                          message: PROMOTION_ELIGIBILITY_DB_POOL_TIMEOUT_MESSAGE,
                      }
                    : {
                          ok: false as const,
                          code: "FAMILY_COUNT_FAILED",
                          message:
                              error instanceof Error
                                  ? error.message
                                  : "Failed to load counts for this family.",
                      };
                familyRows.push(
                    buildPromotionScopeEligibilityFamilyRow({
                        config,
                        scope: mapFamilyPromotionScopeCounts(null),
                        countError,
                    })
                );
            }
        }

        return buildReadonlyPromotionEligibilityResponse({
            reviewBatchId: scope.reviewBatchId,
            familyRows,
            includeWarnings: query.include_warnings ?? false,
        });
    }

    async getBatchEligibility(
        query: ImportReviewPromotionBatchEligibilityQuery
    ): Promise<ImportReviewPromotionBatchEligibilityResponse> {
        const scope = await this.repo.resolveScope(query);
        let families;
        try {
            families = resolvePublishEntityFamilies(
                query.entity_families ?? [...DEFAULT_PUBLISH_ENTITY_FAMILIES],
                false
            );
        } catch (err) {
            throwPromotionFamilyResolutionError(err);
        }

        const options = {
            includeWarnings: query.include_warnings ?? false,
            includeMerged: query.include_merged ?? false,
        };
        const rows = await this.repo.countBatchEligibilityByFamilies({
            scope,
            families,
            options,
        });

        const byFamily = rows.map((row) => ({
            entity_family: row.entity_family,
            table_name: row.table_name,
            approved_ready: n(row.approved_ready),
            with_warnings: n(row.with_warnings),
            blocked: n(row.blocked),
            already_promoted: n(row.already_promoted),
            excluded: n(row.excluded),
            skipped_reasons: [
                { reason: "has_validation_errors", count: n(row.has_validation_errors) },
                { reason: "manual_protected", count: n(row.manual_protected) },
                { reason: "duplicate_unconfirmed", count: n(row.duplicate_unconfirmed) },
                { reason: "rejected_decision", count: n(row.rejected_decision) },
            ].filter((r) => r.count > 0),
        }));

        const totals = byFamily.reduce(
            (acc, f) => ({
                approved_ready: acc.approved_ready + f.approved_ready,
                with_warnings: acc.with_warnings + f.with_warnings,
                blocked: acc.blocked + f.blocked,
                already_promoted: acc.already_promoted + f.already_promoted,
            }),
            { approved_ready: 0, with_warnings: 0, blocked: 0, already_promoted: 0 }
        );

        return {
            review_batch_id: scope.reviewBatchId.toString(),
            source_snapshot_version: scope.snapshotVersion,
            entity_families: families.map((f) => f.entityFamily),
            by_family: byFamily,
            totals,
        };
    }

    async createBatch(
        body: PostImportReviewPromotionBatchBody,
        user: JwtUser,
        log?: FastifyBaseLogger
    ): Promise<ImportReviewCreatePublishBatchResult | ImportReviewCreatePublishBatchDryRunResult> {
        const totalStart = Date.now();
        let resolveMs = 0;

        const resolveStart = Date.now();
        const mode = body.mode ?? "all_ready";
        const filters = {
            review_decision: (body.filters?.review_decision ?? "approved") as "approved",
            include_warnings:
                body.filters?.include_warnings ?? body.include_warnings ?? false,
        };
        const families = resolveCreateBatchFamilies(body.families, body.entity_families);
        const scope = await this.repo.resolveScope({
            review_batch_id: body.review_batch_id,
        });
        resolveMs = Date.now() - resolveStart;

        const familySlugs = families.map((f) => f.entityFamily);
        const batchName = resolveCreateBatchName(scope.reviewBatchId, familySlugs, body.batch_name);

        const createResolver = new ImportReviewPromotionCreateBatchResolver(this.repo.prisma);
        const resolution = await createResolver.resolveCandidateIds({
            reviewBatchId: scope.reviewBatchId,
            mode,
            families: familySlugs,
            candidateIdsByFamily: body.candidate_ids_by_family,
            filters,
            maxItems: body.max_items,
            limitPerFamily: body.limit_per_family,
        });

        assertPublishBatchLimits({
            families: familySlugs,
            totalItems: resolution.totalItems,
            confirmation: {
                confirm_large_batch: body.confirm_large_batch,
                allow_high_risk_families: body.allow_high_risk_families,
                mixed_high_risk_confirm: body.mixed_high_risk_confirm,
            },
            context: "create",
            enforceLargeBatchLimit: !body.dry_run,
        });

        if (body.dry_run) {
            const preview = {
                batchName,
                entityFamilies: familySlugs,
                totals: {
                    included: resolution.totalItems,
                    excluded: 0,
                    skipped: 0,
                },
                byFamily: familySlugs.map((family) => ({
                    entity_family: family,
                    included: resolution.countByFamily[family] ?? 0,
                    excluded: 0,
                    skipped: 0,
                    skipped_reasons: [],
                })),
            };
            const eligibilityMs = Date.now() - resolveStart;
            const totalMs = Date.now() - totalStart;
            const timing_ms = {
                resolve_ms: resolveMs,
                eligibility_ms: eligibilityMs,
                payload_ms: 0,
                transaction_ms: 0,
                total_ms: totalMs,
            };
            log?.info(
                {
                    create_batch_timing: timing_ms,
                    dry_run: true,
                    mode,
                    review_batch_id: scope.reviewBatchId.toString(),
                    families: familySlugs,
                    total_items: resolution.totalItems,
                    count_by_family: resolution.countByFamily,
                    can_create_batch: resolution.totalItems > 0,
                },
                `create_batch_timing eligibility_ms=${eligibilityMs} transaction_ms=0 total_ms=${totalMs}`
            );
            return buildCreateBatchDryRunResponse({
                reviewBatchId: scope.reviewBatchId,
                batchName,
                familyConfigs: families,
                preview,
                countRows: [],
                includeWarnings: filters.include_warnings,
                timing_ms,
                resolveMs,
            });
        }

        const options = {
            includeWarnings: filters.include_warnings,
            includeMerged: body.include_merged ?? false,
        };

        const limitPerFamily: Record<string, number> = {};
        for (const family of familySlugs) {
            const perFamily = body.limit_per_family?.[family];
            if (perFamily !== undefined && perFamily > 0) {
                limitPerFamily[family] = perFamily;
            } else if (body.max_items !== undefined && body.max_items > 0) {
                limitPerFamily[family] = body.max_items;
            }
        }

        const { batch, itemsAdded, candidatesMarked, byFamily, timing, totalSelected } =
            await this.repo.createPublishBatchMultiFamily({
                scope,
                batchName,
                note: body.note?.trim() || null,
                families,
                options,
                createdByUserId: reviewedByUserId(user),
                candidateIdsByFamily: resolution.candidateIdsByFamily,
                limitPerFamily:
                    Object.keys(limitPerFamily).length > 0 ? limitPerFamily : undefined,
            });

        const detail = await this.getBatchById(batch.id);
        const buildingsMarked =
            byFamily.find((f) => f.entity_family === "buildings")?.marked_batched ?? 0;
        const familyLabels = familySlugs.join(", ");
        const skipped = byFamily.reduce(
            (sum, f) => sum + f.skipped_reasons.reduce((s, r) => s + r.count, 0),
            0
        );
        const timing_ms = {
            resolve_ms: resolveMs + timing.resolve_ms,
            eligibility_ms: timing.eligibility_ms,
            payload_ms: timing.payload_ms,
            transaction_ms: timing.transaction_ms,
            total_ms: Date.now() - totalStart,
        };

        const count_by_family = Object.fromEntries(
            byFamily.map((f) => [f.entity_family, f.items_added])
        );
        for (const family of familySlugs) {
            if (count_by_family[family] === undefined) {
                count_by_family[family] = resolution.countByFamily[family] ?? 0;
            }
        }

        const requestedBatchSize =
            body.max_items !== undefined && body.max_items > 0
                ? body.max_items
                : undefined;
        const partialWarning =
            requestedBatchSize !== undefined && itemsAdded < requestedBatchSize
                ? `Only ${itemsAdded} eligible candidates available.`
                : null;
        const baseMessage = `Created publish batch "${batch.batch_name}" with ${itemsAdded} item(s) across [${familyLabels}]. Candidates marked promotion_status=batched. No core writes were performed.`;
        const response = buildCreateBatchSuccessResponse({
            batch,
            detail,
            reviewBatchId: scope.reviewBatchId,
            mode,
            families: familySlugs,
            countByFamily: count_by_family,
            itemsAdded,
            totalSelected,
            candidatesMarked,
            byFamily,
            skipped,
            timing_ms,
            buildingsMarked,
            message: partialWarning ? `${baseMessage} ${partialWarning}` : baseMessage,
            warnings: partialWarning ? [partialWarning] : undefined,
        });

        log?.info(
            {
                create_batch_timing: timing_ms,
                dry_run: false,
                id: response.id,
                public_id: response.public_id,
                review_batch_id: response.review_batch_id,
                mode: response.mode,
                total_item_count: response.total_item_count,
                count_by_family: response.count_by_family,
                total_selected: totalSelected,
            },
            `create_batch_timing eligibility_ms=${timing_ms.eligibility_ms} transaction_ms=${timing_ms.transaction_ms} total_ms=${timing_ms.total_ms}`
        );

        return response;
    }

    async createRetryBatchFromFailedReady(
        sourceBatchId: bigint,
        body: PostImportReviewPromotionBatchRetryFailedReadyBody,
        user: JwtUser,
        log?: FastifyBaseLogger
    ): Promise<ImportReviewCreateRetryPublishBatchResult> {
        return createRetryBatchFromFailedReady({
            sourceBatchId,
            body,
            user,
            repo: this.repo,
            promoteRepo: this.promoteRepo,
            getBatchById: (id) => this.getBatchById(id),
            log,
        });
    }

    async releaseStaleBatchedCandidates(
        body: PostImportReviewPromotionReleaseStaleBatchedBody
    ): Promise<ImportReviewReleaseStaleBatchedResponse> {
        return releaseStaleBatchedImportReviewCandidates(this.repo.prisma, {
            review_batch_id: BigInt(body.review_batch_id),
            families: body.families,
            dry_run: body.dry_run,
        });
    }

    async startValidateBatch(
        batchId: bigint,
        body: PostImportReviewPromotionBatchValidateBody = {
            confirm_large_batch: false,
            allow_high_risk_families: false,
            mixed_high_risk_confirm: false,
        },
        log?: FastifyBaseLogger
    ): Promise<ImportReviewStartPublishBatchValidationResponse> {
        const batch = await this.validationRepo.fetchBatchProgress(batchId);
        if (!batch) {
            throw new ImportReviewPublishBatchNotFoundError(batchId.toString());
        }
        const totalItems = await this.validationRepo.countPublishItems(batchId);
        const familyCounts = await this.validationRepo.countItemsByEntityFamily(batchId);
        const families = familyCounts.map((row) => row.entity_family);

        assertPublishBatchLimits({
            families,
            totalItems,
            confirmation: {
                confirm_large_batch: body.confirm_large_batch,
                allow_high_risk_families: body.allow_high_risk_families,
                mixed_high_risk_confirm: body.mixed_high_risk_confirm,
            },
            context: "validate",
        });

        return this.validationRunner.startValidation(batchId, log);
    }

    async cancelValidateBatch(
        batchId: bigint
    ): Promise<ImportReviewStartPublishBatchValidationResponse> {
        return this.validationRunner.cancelValidation(batchId);
    }

    async resetValidateBatch(
        batchId: bigint
    ): Promise<ImportReviewStartPublishBatchValidationResponse> {
        return this.validationRunner.resetValidation(batchId);
    }

    async getBatchProgress(batchId: bigint): Promise<ImportReviewPublishBatchProgressResponse> {
        try {
            return serializePublishBatchProgressResponse(await this.buildBatchProgress(batchId));
        } catch (error) {
            if (error instanceof ImportReviewPublishBatchNotFoundError) {
                throw error;
            }
            if (isPrismaConnectionPoolTimeout(error)) {
                const row = await this.validationRepo.fetchBatchProgress(batchId);
                if (!row) {
                    throw error;
                }
                return buildMinimalPublishBatchProgressResponse({
                    batchId: batchId.toString(),
                    status: row.status,
                    validationPercent: row.validation_percent,
                    validationTotal: row.validation_total,
                    validationDone: row.validation_done,
                    summary: row.summary,
                    message:
                        "Database connection pool is busy (often connection_limit=1 on Supabase pooler while validation or promotion runs). Wait and retry, or use SQL bulk scripts for large road batches.",
                });
            }
            throw error;
        }
    }

    private async buildBatchProgress(batchId: bigint): Promise<ImportReviewPublishBatchProgressResponse> {
        let batch = await this.validationRepo.fetchBatchProgress(batchId);
        if (!batch) {
            throw new ImportReviewPublishBatchNotFoundError(batchId.toString());
        }

        await recoverStalePromotionBatchIfNeeded({
            batchId,
            batchStatus: batch.status,
            summary: batch.summary,
            workerInProcess: isImportReviewPromotionWorkerRunning(batchId),
            repo: this.promoteRepo,
        });
        batch = (await this.validationRepo.fetchBatchProgress(batchId)) ?? batch;

        const promotionStatusBeforeSync = parsePromotionOutcomeStatus(
            parsePromotionStatusFromSummary(batch.summary)
        );
        let batchRow = batch;
        if (
            promotionStatusBeforeSync === "promotion_failed" &&
            batch.status !== "failed" &&
            batch.status !== "promoting"
        ) {
            await this.publishSummaryRepo.syncPublishBatchSummary(batchId);
            batchRow = (await this.validationRepo.fetchBatchProgress(batchId)) ?? batch;
        }

        const computed = await this.publishSummaryRepo.computePublishBatchSummary(batchId);
        const logs = await this.validationRepo.listStageLogs(batchId);
        const terminalPromotion = ["promoted", "partial", "failed"].includes(
            batchRow.status.trim().toLowerCase()
        );
        const running = terminalPromotion
            ? undefined
            : logs.find((l) => l.stage_status === "running");
        const lastFinished = [...logs]
            .filter((l) => l.finished_at != null)
            .sort((a, b) => {
                const progressDiff = (b.progress_percent ?? 0) - (a.progress_percent ?? 0);
                if (progressDiff !== 0) {
                    return progressDiff;
                }
                return b.started_at.getTime() - a.started_at.getTime();
            })[0];

        const current = running ?? lastFinished ?? null;
        const runningCandidateLog =
            running?.stage_key === "validate_candidate_state"
                ? running
                : logs.find(
                      (l) =>
                          l.stage_key === "validate_candidate_state" && l.stage_status === "running"
                  );
        const heartbeatAnchor = heartbeatAnchorAt(
            batchRow,
            runningCandidateLog ? extractStageLogHeartbeatIso(runningCandidateLog.details) : null
        );

        const workflow = workflowForStatus(batchRow.status);
        const promotionSummary = parsePromotionResult(batchRow.summary);
        const validationSummary = parseLogsSummary(batchRow.summary, "validation_logs_summary");
        const promotionLogsSummary = parseLogsSummary(batchRow.summary, "promotion_logs_summary");
        const totalItemCount = computed?.item_counts.total ?? batchRow.validation_total;
        const publishItemStatusCounts = await this.promoteRepo.countPublishItemsByStatus(batchId);
        const promotionSelection = await this.promoteRepo.selectPublishItemsForPromotion(batchId);
        const currentPromotableCount = promotionSelection.promotableIds.length;
        const summaryRecord =
            batchRow.summary && typeof batchRow.summary === "object" && !Array.isArray(batchRow.summary)
                ? (batchRow.summary as Record<string, unknown>)
                : null;
        const promotionProgressTotalFromSummary =
            typeof summaryRecord?.promotion_progress_total === "number"
                ? summaryRecord.promotion_progress_total
                : null;
        const promotionProgressDoneFromSummary =
            typeof summaryRecord?.promotion_progress_done === "number"
                ? summaryRecord.promotion_progress_done
                : null;
        const progressTotalForUi =
            batchRow.status === "promoting"
                ? Math.max(
                      promotionProgressTotalFromSummary ?? 0,
                      currentPromotableCount,
                      batchRow.validation_total,
                      0
                  )
                : totalItemCount;
        const itemProcessedCount = Math.min(
            batchRow.status === "promoting"
                ? (promotionProgressDoneFromSummary ?? batchRow.validation_done)
                : batchRow.validation_done,
            progressTotalForUi > 0 ? progressTotalForUi : totalItemCount
        );
        const promotionHeartbeatAnchor = parsePromotionHeartbeatFromSummary(batchRow.summary);
        const runningPromotionStage =
            running?.stage_key === "promote_preflight" ||
            (typeof running?.stage_key === "string" && running.stage_key.startsWith("promote_"))
                ? running
                : logs.find(
                      (l) =>
                          l.stage_status === "running" &&
                          (l.stage_key === "promote_preflight" ||
                              l.stage_key.startsWith("promote_"))
                  );
        const promotionHeartbeatAt =
            promotionHeartbeatAnchor ??
            (runningPromotionStage
                ? parsePromotionHeartbeatFromSummary({
                      promotion_heartbeat_at: extractStageLogHeartbeatIso(
                          runningPromotionStage.details
                      ),
                  })
                : null);
        const promotionWorkerInProcess = isImportReviewPromotionWorkerRunning(batchId);
        const validationParsed =
            batchRow.status === "validating" ? null : parseValidationResult(batchRow.summary);
        const validationPromotableCount = validationParsed?.promotable_count ?? null;
        const promotionStatusRaw = parsePromotionStatusFromSummary(batchRow.summary);
        const promotionStatus = parsePromotionOutcomeStatus(promotionStatusRaw);

        let failed_ready_retry_count = 0;
        const skipRetryLookup =
            batchRow.status === "validating" || batchRow.status === "promoting";
        if (
            !skipRetryLookup &&
            currentPromotableCount === 0 &&
            publishItemStatusCounts.failed > 0
        ) {
            try {
                const sourceRow = await this.repo.fetchPublishBatchById(batchId);
                if (sourceRow?.source_review_batch_id != null) {
                    const retry = await resolveFailedReadyRetryCandidates({
                        prisma: this.repo.prisma,
                        sourceBatchId: batchId,
                        reviewBatchId: sourceRow.source_review_batch_id,
                    });
                    failed_ready_retry_count = retry.resolution.totalItems;
                }
            } catch {
                failed_ready_retry_count = 0;
            }
        }

        let road_promotion_gates = null;
        try {
            const roadItemCount = await this.promoteRepo.countRoadPublishItems(batchId);
            if (roadItemCount > 0) {
                const dryRun = await this.promoteRepo.readRoadDryRunResult(batchId);
                const roadDryRunSummary = await this.promoteRepo.readRoadDryRunSummary(batchId);
                const routingReadinessSummary =
                    await this.promoteRepo.readRoutingReadinessSummary(batchId);
                const pendingRows =
                    await this.promoteRepo.listPendingPublishItemValidationRows(batchId);
                const itemPreflight = buildPromotionPreflightFromItemSelection(
                    pendingRows,
                    classifyPublishItemsForPromotion(pendingRows)
                );
                const roadsEntity = validationParsed?.by_entity?.roads;
                const roadsReadyAtValidation =
                    (roadsEntity?.ready ?? 0) + (roadsEntity?.warning ?? 0) ||
                    itemPreflight.ready_count;
                road_promotion_gates = evaluateRoadPromotionGates({
                    road_item_count: roadItemCount,
                    validation_percent: batchRow.validation_percent,
                    validation: itemPreflight,
                    batch_status: batchRow.status,
                    batch_summary: batchRow.summary,
                    road_dry_run: roadDryRunSummary,
                    routing_readiness_validation: routingReadinessSummary,
                    dry_run: dryRun,
                    roads_ready_at_validation: roadsReadyAtValidation,
                });
            }
        } catch {
            road_promotion_gates = null;
        }

        let pipelineSnapshot = null;
        try {
            pipelineSnapshot = await this.pipelineProgress.getBatchProgress(batchId);
        } catch {
            pipelineSnapshot = null;
        }

        const pipelinePercent = pipelineSnapshot?.percent ?? batchRow.validation_percent;
        const pipelineProcessed =
            pipelineSnapshot?.processed_count ?? itemProcessedCount;
        const pipelineTotal = pipelineSnapshot?.total_item_count ?? totalItemCount;

        return {
            batch_id: batchId.toString(),
            status: batchRow.status,
            derived_status: computed?.derived_status ?? batchRow.status,
            derived_status_reason: computed?.derived_status_reason ?? null,
            stored_status_recommendation: computed?.stored_status_recommendation ?? null,
            status_note: computed?.derived_status_reason ?? null,
            workflow,
            validation_total:
                pipelineSnapshot?.current_stage === "validate_items"
                    ? pipelineTotal
                    : progressTotalForUi,
            validation_done:
                pipelineSnapshot?.current_stage === "validate_items"
                    ? pipelineProcessed
                    : itemProcessedCount,
            validation_percent: pipelinePercent,
            total_item_count: totalItemCount,
            item_processed_count: pipelineProcessed,
            stage_count: IMPORT_REVIEW_PUBLISH_VALIDATION_STAGES.length,
            validated_at: batchRow.validated_at ? batchRow.validated_at.toISOString() : null,
            current_stage_key:
                pipelineSnapshot?.current_stage ?? current?.stage_key ?? null,
            current_stage_label:
                pipelineSnapshot?.current_stage_label ?? current?.stage_label ?? null,
            current_stage_status:
                pipelineSnapshot?.stage_status ?? current?.stage_status ?? null,
            current_entity_family:
                pipelineSnapshot?.current_family ??
                (current ? currentEntityFamilyFromLog(current.details) : null),
            current_message:
                computed?.derived_status === "invalid_empty_promoted"
                    ? (computed.derived_status_reason ??
                      "This batch was marked promoted but no items were promoted.")
                    : promotionStatus === "promotion_failed"
                      ? (promotionLogsSummary ??
                        computed?.derived_status_reason ??
                        "Promotion failed. Create a new retry batch after fixing the error.")
                      : (current?.message ??
                        (workflow === "promotion" ? promotionLogsSummary : validationSummary)),
            validation_result: validationParsed,
            validation_logs_summary: validationSummary,
            promotion_result: promotionSummary,
            promotion_logs_summary: promotionLogsSummary,
            validation_heartbeat_at: batchRow.validation_heartbeat_at
                ? batchRow.validation_heartbeat_at.toISOString()
                : null,
            validation_cancel_requested_at: batchRow.validation_cancel_requested_at
                ? batchRow.validation_cancel_requested_at.toISOString()
                : null,
            validation_heartbeat_stale_warning:
                batchRow.status === "validating" && isValidationHeartbeatStalled(heartbeatAnchor),
            promotion_heartbeat_at: promotionHeartbeatAt
                ? promotionHeartbeatAt.toISOString()
                : null,
            promotion_heartbeat_stale_warning:
                batchRow.status === "promoting" &&
                !promotionWorkerInProcess &&
                isPromotionHeartbeatStalled(promotionHeartbeatAt),
            promotion_worker_in_process: promotionWorkerInProcess,
            current_promotable_count: currentPromotableCount,
            validation_promotable_count: validationPromotableCount,
            publish_item_status_counts: publishItemStatusCounts,
            promotion_status: promotionStatus,
            failed_ready_retry_count,
            road_promotion_gates,
            dry_run_result: parsePublishBatchDryRunResultFromSummary(batchRow.summary),
            current_stage: pipelineSnapshot?.current_stage ?? null,
            percent: pipelinePercent,
            processed_count: pipelineProcessed,
            total: pipelineTotal,
            last_heartbeat_at: pipelineSnapshot?.last_heartbeat_at ?? null,
            resumable_actions: pipelineSnapshot?.resumable_actions ?? [],
        };
    }

    async cancelPromoteBatch(
        batchId: bigint
    ): Promise<ImportReviewStartPublishBatchPromotionResponse> {
        const batch = await this.validationRepo.fetchBatchProgress(batchId);
        if (!batch) {
            throw new ImportReviewPublishBatchNotFoundError(batchId.toString());
        }
        if (batch.status !== "promoting") {
            return {
                batch_id: batchId.toString(),
                status: batch.status,
                message: `Cannot cancel promotion when batch status is ${batch.status}.`,
            };
        }
        await this.promoteRepo.requestPromotionCancel(batchId);
        const workerInProcess = isImportReviewPromotionWorkerRunning(batchId);
        const anchor = this.promoteRepo.parsePromotionHeartbeatAnchor(batch.summary);
        if (!workerInProcess || isPromotionHeartbeatStale(anchor)) {
            await this.promoteRepo.finalizePromotionAborted({
                batchId,
                reason: "cancelled",
                message: "Promotion cancelled.",
            });
            return {
                batch_id: batchId.toString(),
                status: "ready",
                message: "Promotion cancelled (worker was not responding).",
            };
        }
        return {
            batch_id: batchId.toString(),
            status: "promoting",
            message: "Promotion cancel requested; worker stops at the next checkpoint.",
        };
    }

    private async buildPromotionStageSnapshot(batchId: bigint): Promise<PromotionStageSnapshot> {
        const batch = await this.validationRepo.fetchBatchProgress(batchId);
        if (!batch) {
            throw new ImportReviewPublishBatchNotFoundError(batchId.toString());
        }
        const prisma = this.validationRepo.prisma;
        const [incompleteValidationItemCount, pendingPromotableCount, itemCounts] =
            await Promise.all([
                countIncompleteValidationItems(prisma, batchId),
                countPendingPromotableItems(prisma, batchId),
                this.promoteRepo.countPublishItemsByStatus(batchId),
            ]);
        const dryRun = parsePublishBatchDryRunResultFromSummary(batch.summary);
        return {
            status: batch.status,
            validationPercent: batch.validation_percent,
            validatedAt: batch.validated_at,
            successCount: itemCounts.success,
            summary: batch.summary,
            incompleteValidationItemCount,
            pendingPromotableCount,
            dryRunPassed: publishBatchDryRunPassed(dryRun),
            validationWorkerInProcess: this.validationRunner.isRunning(batchId),
            promotionWorkerInProcess: isImportReviewPromotionWorkerRunning(batchId),
        };
    }

    private stageControlResponse(
        batchId: bigint,
        action: string,
        status: string,
        message: string
    ): ImportReviewPromotionStageControlResponse {
        return {
            batch_id: batchId.toString(),
            action,
            status,
            message,
        };
    }

    async resumeBatchStage(
        batchId: bigint,
        log?: FastifyBaseLogger,
        promotedBy: bigint | null = null
    ): Promise<ImportReviewPromotionStageControlResponse> {
        const snapshot = await this.buildPromotionStageSnapshot(batchId);
        const resumeAction = resolvePromotionStageResumeAction(snapshot);

        if (resumeAction === "already_complete") {
            return this.stageControlResponse(
                batchId,
                "already_complete",
                normalizePublishBatchLifecycleStatus(snapshot.status),
                "Batch is already complete; nothing to resume."
            );
        }

        if (resumeAction === "resume_validation") {
            const result = await this.startValidateBatch(
                batchId,
                {
                    confirm_large_batch: true,
                    allow_high_risk_families: true,
                    mixed_high_risk_confirm: true,
                },
                log
            );
            return this.stageControlResponse(
                batchId,
                "resume_validation",
                result.status,
                result.message
            );
        }

        if (resumeAction === "resume_dry_run") {
            const dryRun = await this.runPublishBatchDryRun(batchId, {}, log);
            return this.stageControlResponse(
                batchId,
                "resume_dry_run",
                dryRun.status,
                dryRun.summary?.message ?? `Dry-run ${dryRun.status}.`
            );
        }

        const promoteResult = await this.startPromoteBatch(
            batchId,
            {
                confirmation_text: "PROMOTE",
                confirm_warnings: true,
                allow_high_risk_families: false,
                confirm_large_batch: false,
                chunk_size: 100,
                promotion_note: undefined,
                warning_confirmation_note: undefined,
                review_note: undefined,
            },
            { sub: promotedBy?.toString() ?? "" } as JwtUser,
            log
        );
        return this.stageControlResponse(
            batchId,
            "resume_promotion",
            promoteResult.status,
            promoteResult.message
        );
    }

    async cancelCurrentStage(batchId: bigint): Promise<ImportReviewPromotionStageControlResponse> {
        const snapshot = await this.buildPromotionStageSnapshot(batchId);
        const target = resolvePromotionStageCancelTarget(snapshot);

        if (target === "none") {
            throw new ImportReviewPublishBatchStageControlError(
                batchId.toString(),
                "No promotion stage is currently running for this batch."
            );
        }

        if (target === "validation") {
            try {
                const result = await this.cancelValidateBatch(batchId);
                return this.stageControlResponse(
                    batchId,
                    "cancel_validation",
                    result.status,
                    result.message
                );
            } catch (err) {
                if (err instanceof ImportReviewPublishBatchValidationNotRunningError) {
                    await this.pipelineProgress
                        .failStage(batchId, "validate_items", err.messageDetail)
                        .catch(() => undefined);
                    const refreshed = await this.validationRepo.fetchBatchProgress(batchId);
                    return this.stageControlResponse(
                        batchId,
                        "cancel_validation",
                        refreshed?.status ?? snapshot.status,
                        "Validation stage marked cancelled (no active worker)."
                    );
                }
                throw err;
            }
        }

        if (target === "promotion") {
            const result = await this.cancelPromoteBatch(batchId);
            return this.stageControlResponse(
                batchId,
                "cancel_promotion",
                result.status,
                result.message
            );
        }

        await this.pipelineProgress
            .failStage(batchId, "dry_run_items", "Dry-run stage cancelled.")
            .catch(() => undefined);
        const refreshed = await this.validationRepo.fetchBatchProgress(batchId);
        return this.stageControlResponse(
            batchId,
            "cancel_dry_run",
            refreshed?.status ?? snapshot.status,
            "Dry-run pipeline stage marked cancelled."
        );
    }

    async resetDryRunStage(batchId: bigint): Promise<ImportReviewPromotionStageControlResponse> {
        const batch = await this.validationRepo.fetchBatchProgress(batchId);
        if (!batch) {
            throw new ImportReviewPublishBatchNotFoundError(batchId.toString());
        }
        if (batch.status === "validating" || batch.status === "promoting") {
            throw new ImportReviewPublishBatchStageControlError(
                batchId.toString(),
                `Cannot reset dry-run while batch status is ${batch.status}.`
            );
        }
        await this.promoteRepo.clearDryRunResult(batchId);
        const refreshed = await this.validationRepo.fetchBatchProgress(batchId);
        return this.stageControlResponse(
            batchId,
            "reset_dry_run",
            refreshed?.status ?? batch.status,
            "Dry-run result cleared. Validation results were kept."
        );
    }

    async resetPromotionFailuresStage(
        batchId: bigint
    ): Promise<ImportReviewPromotionStageControlResponse> {
        const batch = await this.validationRepo.fetchBatchProgress(batchId);
        if (!batch) {
            throw new ImportReviewPublishBatchNotFoundError(batchId.toString());
        }
        if (batch.status === "promoting") {
            throw new ImportReviewPublishBatchStageControlError(
                batchId.toString(),
                "Cannot reset promotion failures while promotion is running."
            );
        }
        const { reset_item_count } = await this.promoteRepo.resetFailedPromotionItems(batchId);
        await this.publishSummaryRepo.syncPublishBatchSummary(batchId).catch(() => undefined);
        const refreshed = await this.validationRepo.fetchBatchProgress(batchId);
        return this.stageControlResponse(
            batchId,
            "reset_promotion_failures",
            refreshed?.status ?? batch.status,
            reset_item_count > 0
                ? `Reset ${reset_item_count} failed publish item(s) to pending. Promoted items were not changed.`
                : "No failed publish items to reset."
        );
    }

    async resetValidateBatchStage(
        batchId: bigint
    ): Promise<ImportReviewPromotionStageControlResponse> {
        const batch = await this.validationRepo.fetchBatchProgress(batchId);
        if (!batch) {
            throw new ImportReviewPublishBatchNotFoundError(batchId.toString());
        }
        const itemCounts = await this.promoteRepo.countPublishItemsByStatus(batchId);
        if (
            batchPromotionBlocksValidationReset({
                status: batch.status,
                promoted_at: batch.promoted_at,
                success_count: itemCounts.success,
                summary: batch.summary,
            })
        ) {
            throw new ImportReviewPublishBatchValidationResetError(
                batchId.toString(),
                "Cannot reset validation: batch has promoted items. Promoted rows are never unpromoted."
            );
        }
        const result = await this.resetValidateBatch(batchId);
        return this.stageControlResponse(
            batchId,
            "reset_validation",
            result.status,
            result.message
        );
    }

    async resetPromoteBatch(
        batchId: bigint
    ): Promise<ImportReviewStartPublishBatchPromotionResponse> {
        const batch = await this.validationRepo.fetchBatchProgress(batchId);
        if (!batch) {
            throw new ImportReviewPublishBatchNotFoundError(batchId.toString());
        }
        if (batch.status !== "promoting") {
            return {
                batch_id: batchId.toString(),
                status: batch.status,
                message: "Promotion is not running; no reset needed.",
            };
        }
        if (isImportReviewPromotionWorkerRunning(batchId)) {
            return {
                batch_id: batchId.toString(),
                status: "promoting",
                message: "Promotion is still running in this API process. Cancel promotion first.",
            };
        }
        await this.promoteRepo.resetPromotionWorkerState(batchId);
        const refreshed = await this.validationRepo.fetchBatchProgress(batchId);
        return {
            batch_id: batchId.toString(),
            status: refreshed?.status ?? "ready",
            message: "Promotion worker reset. Pending ready items can be promoted again.",
        };
    }

    async startPromoteBatch(
        batchId: bigint,
        body: PostImportReviewPromotionBatchPromoteBody,
        user: JwtUser,
        log?: FastifyBaseLogger
    ): Promise<ImportReviewStartPublishBatchPromotionResponse> {
        return this.promoteRunner.startPromotion({
            batchId,
            confirmationText: body.confirmation_text,
            confirmWarnings: body.confirm_warnings,
            allowHighRiskFamilies: body.allow_high_risk_families,
            confirmLargeBatch: body.confirm_large_batch,
            promotionNote: body.promotion_note,
            warningConfirmationNote: body.warning_confirmation_note,
            chunkSize: body.chunk_size,
            promotedBy: reviewedByUserId(user),
            log,
        });
    }

    async repairInvalidEmptyPromotedBatches(options: {
        batchId?: bigint;
        reviewBatchId?: bigint;
    } = {}): Promise<ImportReviewRepairInvalidPromotedBatchesResponse> {
        const result = await this.publishSummaryRepo.repairInvalidEmptyPromotedBatches(options);
        return {
            ...result,
            message:
                result.repaired > 0
                    ? `Repaired ${result.repaired} invalid promoted batch(es).`
                    : "No invalid promoted batches required repair.",
        };
    }

    async getBatchVerify(batchId: bigint): Promise<ImportReviewPublishBatchVerifyResponse> {
        const batch = await this.validationRepo.fetchBatchProgress(batchId);
        if (!batch) {
            throw new ImportReviewPublishBatchNotFoundError(batchId.toString());
        }
        return this.promoteRepo.getBatchVerify(batchId);
    }

    async runPublishBatchDryRun(
        batchId: bigint,
        _body: PostImportReviewPromotionBatchDryRunBody,
        log?: FastifyBaseLogger
    ): Promise<ImportReviewPublishBatchDryRunApiResponse> {
        return runPublishBatchDryRun({
            prisma: this.validationRepo.prisma,
            batchId,
            log,
        });
    }

    async runRoadDryRun(
        batchId: bigint,
        body: PostImportReviewPromotionRoadDryRunBody
    ): Promise<ImportReviewPromotionRoadDryRunResponse> {
        return this.roadDryRunService.runDryRun(batchId, body);
    }

    async getRoadDryRun(batchId: bigint): Promise<ImportReviewPromotionRoadDryRunResponse> {
        return this.roadDryRunService.getDryRunResult(batchId);
    }

    async runRoutingBarrierDryRun(
        batchId: bigint,
        body: PostImportReviewPromotionRoutingBarrierDryRunBody
    ): Promise<ImportReviewPromotionRoutingBarrierDryRunResult> {
        return this.routingBarrierDryRunService.runDryRun(batchId, body);
    }

    async getRoutingBarrierDryRun(batchId: bigint): Promise<ImportReviewPromotionRoutingBarrierDryRunResult> {
        return this.routingBarrierDryRunService.getDryRunResult(batchId);
    }

    async getBatchLogs(batchId: bigint): Promise<ImportReviewPublishBatchLogsResponse> {
        try {
            const batch = await this.validationRepo.fetchBatchProgress(batchId);
            if (!batch) {
                throw new ImportReviewPublishBatchNotFoundError(batchId.toString());
            }

            const rows = await this.validationRepo.listStageLogs(batchId);
            const items: ImportReviewPublishStageLogItem[] = rows.map((row) => ({
                id: row.id.toString(),
                stage_key: row.stage_key,
                stage_label: row.stage_label,
                stage_status: row.stage_status,
                message: row.message,
                progress_percent: row.progress_percent,
                details: row.details,
                started_at: row.started_at.toISOString(),
                finished_at: row.finished_at ? row.finished_at.toISOString() : null,
            }));

            return serializePublishBatchLogsResponse({ batch_id: batchId.toString(), items });
        } catch (error) {
            if (error instanceof ImportReviewPublishBatchNotFoundError) {
                throw error;
            }
            if (isPrismaConnectionPoolTimeout(error)) {
                return serializePublishBatchLogsResponse({
                    batch_id: batchId.toString(),
                    items: [],
                });
            }
            throw error;
        }
    }
}
