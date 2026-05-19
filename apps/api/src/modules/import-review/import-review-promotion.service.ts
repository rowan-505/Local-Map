import type { FastifyBaseLogger } from "fastify";

import type { JwtUser } from "../../plugins/auth.js";
import type { PublishBatchRowDb, ReadyBuildingCandidateRowDb } from "./import-review-promotion.repo.js";
import { ImportReviewPromotionRepository } from "./import-review-promotion.repo.js";
import { ImportReviewPromotionPromoteRunner } from "./import-review-promotion-promote.js";
import { ImportReviewPromotionPromoteRepository } from "./import-review-promotion-promote.repo.js";
import { ImportReviewPromotionValidationRunner } from "./import-review-promotion-validation.js";
import { ImportReviewPromotionValidationRepository } from "./import-review-promotion-validation.repo.js";
import type {
    ImportReviewCreatePublishBatchResult,
    ImportReviewPromotionReadyCandidateItem,
    ImportReviewPromotionReadyCandidatesResponse,
    ImportReviewPromotionReadyCounts,
    ImportReviewPublishBatchDetail,
    ImportReviewPublishBatchLogsResponse,
    ImportReviewPublishBatchProgressResponse,
    ImportReviewPublishBatchPromotionResultSummary,
    ImportReviewPublishBatchSummary,
    ImportReviewPublishBatchValidationResultSummary,
    ImportReviewPublishBatchVerifyResponse,
    ImportReviewPublishStageLogItem,
    ImportReviewStartPublishBatchPromotionResponse,
    ImportReviewStartPublishBatchValidationResponse,
} from "./import-review-promotion.types.js";
import type {
    ImportReviewPromotionBatchesListQuery,
    ImportReviewPromotionReadyCandidatesQuery,
    ImportReviewPromotionReadyQuery,
    PostImportReviewPromotionBatchBody,
    PostImportReviewPromotionBatchPromoteBody,
} from "./import-review-promotion.schema.js";
import { ImportReviewPublishBatchNotFoundError } from "./import-review-promotion.errors.js";
import { ImportReviewInvalidScopeError } from "./import-review-errors.js";

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
        review_overrides: row.review_overrides,
        source_refs: row.source_refs,
        geometry: includeGeometry ? (row.geometry as Record<string, unknown> | null) : null,
    };
}

function mapBatchSummary(row: PublishBatchRowDb): ImportReviewPublishBatchSummary {
    return {
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
    return {
        outcome: o.outcome === "blocked" ? "blocked" : "passed",
        valid_count: typeof o.valid_count === "number" ? o.valid_count : 0,
        warning_count: typeof o.warning_count === "number" ? o.warning_count : 0,
        blocked_count: typeof o.blocked_count === "number" ? o.blocked_count : 0,
        total_items: typeof o.total_items === "number" ? o.total_items : 0,
        by_publish_action:
            byAction && typeof byAction === "object" && !Array.isArray(byAction)
                ? {
                      insert: Number((byAction as Record<string, unknown>).insert ?? 0),
                      update: Number((byAction as Record<string, unknown>).update ?? 0),
                      merge: Number((byAction as Record<string, unknown>).merge ?? 0),
                  }
                : { insert: 0, update: 0, merge: 0 },
        entity_family:
            entityFamily && typeof entityFamily === "object" && !Array.isArray(entityFamily)
                ? { buildings: Number((entityFamily as Record<string, unknown>).buildings ?? 0) }
                : { buildings: 0 },
    };
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
    return {
        status: o.status === "promoted" ? "promoted" : "failed",
        inserted_count: Number(o.inserted_count ?? 0),
        updated_count: Number(o.updated_count ?? 0),
        success_count: Number(o.success_count ?? 0),
        failed_count: Number(o.failed_count ?? 0),
        skipped_count: Number(o.skipped_count ?? 0),
        total: Number(o.total ?? 0),
        core_verified_count: Number(o.core_verified_count ?? 0),
        import_review_marked_promoted_count: Number(o.import_review_marked_promoted_count ?? 0),
        partial_success: o.partial_success === true ? true : undefined,
        started_at: typeof o.started_at === "string" ? o.started_at : "",
        finished_at: typeof o.finished_at === "string" ? o.finished_at : "",
        duration_ms: Number(o.duration_ms ?? 0),
        promoted_entity_families: Array.isArray(o.promoted_entity_families)
            ? (o.promoted_entity_families as string[])
            : ["buildings"],
    };
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
    private readonly validationRunner: ImportReviewPromotionValidationRunner;
    private readonly promoteRunner: ImportReviewPromotionPromoteRunner;

    constructor(
        private readonly repo: ImportReviewPromotionRepository,
        private readonly validationRepo: ImportReviewPromotionValidationRepository,
        private readonly promoteRepo: ImportReviewPromotionPromoteRepository
    ) {
        this.validationRunner = new ImportReviewPromotionValidationRunner(this.validationRepo);
        this.promoteRunner = new ImportReviewPromotionPromoteRunner(this.promoteRepo);
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
        return {
            items: rows.map(mapBatchSummary),
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
        const itemCounts = await this.repo.fetchPublishItemCounts(batchId);
        const buildingItemCounts = await this.repo.fetchBuildingPublishItemCounts(batchId);
        return {
            ...mapBatchSummary(row),
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
        };
    }

    async createBatch(
        body: PostImportReviewPromotionBatchBody,
        user: JwtUser
    ): Promise<ImportReviewCreatePublishBatchResult> {
        const scope = await this.repo.resolveScope(body);
        const { batch, itemsAdded, buildingsMarked } = await this.repo.createPublishBatchFromBuildings({
            scope,
            batchName: body.batch_name,
            note: body.note?.trim() || null,
            includeMerged: body.include_merged ?? false,
            createdByUserId: reviewedByUserId(user),
        });

        const detail = await this.getBatchById(batch.id);

        return {
            message: `Created publish batch "${batch.batch_name}" with ${itemsAdded} building item(s). Candidates marked promotion_status=batched. No core writes were performed.`,
            batch: detail,
            items_added: itemsAdded,
            building_candidates_marked_batched: buildingsMarked,
        };
    }

    async startValidateBatch(
        batchId: bigint,
        log?: FastifyBaseLogger
    ): Promise<ImportReviewStartPublishBatchValidationResponse> {
        return this.validationRunner.startValidation(batchId, log);
    }

    async getBatchProgress(batchId: bigint): Promise<ImportReviewPublishBatchProgressResponse> {
        const batch = await this.validationRepo.fetchBatchProgress(batchId);
        if (!batch) {
            throw new ImportReviewPublishBatchNotFoundError(batchId.toString());
        }

        const logs = await this.validationRepo.listStageLogs(batchId);
        const running = logs.find((l) => l.stage_status === "running");
        const lastFinished = [...logs].reverse().find((l) => l.finished_at != null);

        const current = running ?? lastFinished ?? null;

        const workflow = workflowForStatus(batch.status);
        const promotionSummary = parsePromotionResult(batch.summary);
        const validationSummary = parseLogsSummary(batch.summary, "validation_logs_summary");
        const promotionLogsSummary = parseLogsSummary(batch.summary, "promotion_logs_summary");

        return {
            batch_id: batchId.toString(),
            status: batch.status,
            workflow,
            validation_total: batch.validation_total,
            validation_done: batch.validation_done,
            validation_percent: batch.validation_percent,
            validated_at: batch.validated_at ? batch.validated_at.toISOString() : null,
            current_stage_key: current?.stage_key ?? null,
            current_stage_label: current?.stage_label ?? null,
            current_stage_status: current?.stage_status ?? null,
            current_message:
                current?.message ??
                (workflow === "promotion" ? promotionLogsSummary : validationSummary),
            validation_result: parseValidationResult(batch.summary),
            validation_logs_summary: validationSummary,
            promotion_result: promotionSummary,
            promotion_logs_summary: promotionLogsSummary,
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
            chunkSize: body.chunk_size,
            promotedBy: reviewedByUserId(user),
            log,
        });
    }

    async getBatchVerify(batchId: bigint): Promise<ImportReviewPublishBatchVerifyResponse> {
        const batch = await this.validationRepo.fetchBatchProgress(batchId);
        if (!batch) {
            throw new ImportReviewPublishBatchNotFoundError(batchId.toString());
        }
        return this.promoteRepo.getBatchVerify(batchId);
    }

    async getBatchLogs(batchId: bigint): Promise<ImportReviewPublishBatchLogsResponse> {
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

        return { batch_id: batchId.toString(), items };
    }
}
