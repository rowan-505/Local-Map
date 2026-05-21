import type { FastifyBaseLogger } from "fastify";

import type { JwtUser } from "../../plugins/auth.js";
import type { PublishBatchRowDb, ReadyBuildingCandidateRowDb } from "./import-review-promotion.repo.js";
import { ImportReviewPromotionRepository } from "./import-review-promotion.repo.js";
import { ImportReviewPromotionPromoteRunner } from "./import-review-promotion-promote.js";
import { ImportReviewPromotionPromoteRepository } from "./import-review-promotion-promote.repo.js";
import { ImportReviewPromotionValidationRunner } from "./import-review-promotion-validation.js";
import { ImportReviewPromotionValidationRepository } from "./import-review-promotion-validation.repo.js";
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
    ImportReviewRepairInvalidPromotedBatchesResponse,
    ImportReviewStartPublishBatchPromotionResponse,
    ImportReviewStartPublishBatchValidationResponse,
} from "./import-review-promotion.types.js";
import type {
    ImportReviewPromotionBatchEligibilityQuery,
    ImportReviewPromotionBatchesListQuery,
    ImportReviewPromotionReadyCandidatesQuery,
    ImportReviewPromotionReadyQuery,
    PostImportReviewPromotionBatchBody,
    PostImportReviewPromotionBatchPromoteBody,
} from "./import-review-promotion.schema.js";
import { DEFAULT_PUBLISH_ENTITY_FAMILIES, resolvePublishEntityFamilies } from "./import-review-promotion-config.js";
import { IMPORT_REVIEW_PUBLISH_ITEM_VALIDATION_STAGES } from "./import-review-promotion-validation.types.js";
import { ImportReviewInvalidScopeError } from "./import-review-errors.js";
import { ImportReviewPublishBatchNotFoundError } from "./import-review-promotion.errors.js";
import {
    ImportReviewPublishBatchSummaryRepository,
    applyComputedCountsToBatchSummary,
    type PublishBatchComputedSummary,
} from "./import-review-publish-batch-summary.js";
import { ImportReviewReviewBatchSummaryRepository } from "./import-review-review-batch-summary.js";
import {
    createImportReviewPromotionRoadDryRunService,
    ImportReviewPromotionRoadDryRunService,
} from "./import-review-promotion-road-dry-run.service.js";
import type { ImportReviewPromotionRoadDryRunResult } from "./import-review-promotion-road-dry-run.types.js";
import type { PostImportReviewPromotionRoadDryRunBody } from "./import-review-promotion-road-dry-run.schema.js";

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
        review_overrides: row.review_overrides,
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
                    valid: Number(b.valid ?? 0),
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
        outcome: o.outcome === "blocked" ? "blocked" : "passed",
        can_promote: o.can_promote === false ? false : true,
        requires_warning_confirmation: o.requires_warning_confirmation === true,
        valid_count: typeof o.valid_count === "number" ? o.valid_count : 0,
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
    const ef = (details as Record<string, unknown>).entity_family;
    return typeof ef === "string" ? ef : null;
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
    private readonly publishSummaryRepo: ImportReviewPublishBatchSummaryRepository;
    private readonly reviewSummaryRepo: ImportReviewReviewBatchSummaryRepository;
    private readonly roadDryRunService: ImportReviewPromotionRoadDryRunService;

    constructor(
        private readonly repo: ImportReviewPromotionRepository,
        private readonly validationRepo: ImportReviewPromotionValidationRepository,
        private readonly promoteRepo: ImportReviewPromotionPromoteRepository
    ) {
        this.validationRunner = new ImportReviewPromotionValidationRunner(this.validationRepo);
        this.promoteRunner = new ImportReviewPromotionPromoteRunner(this.promoteRepo);
        const prisma = this.validationRepo.getPrismaClient();
        this.publishSummaryRepo = new ImportReviewPublishBatchSummaryRepository(prisma);
        this.reviewSummaryRepo = new ImportReviewReviewBatchSummaryRepository(prisma);
        this.roadDryRunService = createImportReviewPromotionRoadDryRunService(prisma);
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
        return {
            ...mapBatchSummary(row, computed),
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
            throw new ImportReviewInvalidScopeError(
                err instanceof Error ? err.message : "Invalid entity_families"
            );
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
        const scope = await this.repo.resolveScope(body);
        let families;
        try {
            families = resolvePublishEntityFamilies(
                body.entity_families,
                body.allow_high_risk_families ?? false
            );
        } catch (err) {
            throw new ImportReviewInvalidScopeError(
                err instanceof Error ? err.message : "Invalid entity_families"
            );
        }
        resolveMs = Date.now() - resolveStart;

        const options = {
            includeWarnings: body.include_warnings ?? false,
            includeMerged: body.include_merged ?? false,
        };
        const batchName =
            body.batch_name?.trim() ||
            `dry-run-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}`;

        if (body.dry_run) {
            const eligibilityStart = Date.now();
            const preview = await this.repo.dryRunPublishBatchMultiFamily({
                scope,
                batchName,
                families,
                options,
            });
            const eligibilityMs = Date.now() - eligibilityStart;
            const totalMs = Date.now() - totalStart;
            const timing_ms = {
                resolve_ms: resolveMs,
                eligibility_ms: eligibilityMs,
                payload_ms: 0,
                transaction_ms: 0,
                total_ms: totalMs,
            };
            const by_entity = Object.fromEntries(
                preview.byFamily.map((f) => [f.entity_family, f.included])
            );
            log?.info(
                {
                    create_batch_timing: timing_ms,
                    dry_run: true,
                    review_batch_id: scope.reviewBatchId.toString(),
                    total_selected: preview.totals.included,
                },
                `create_batch_timing eligibility_ms=${eligibilityMs} transaction_ms=0 total_ms=${totalMs}`
            );
            return {
                dry_run: true,
                batch_name: preview.batchName,
                entity_families: preview.entityFamilies,
                totals: preview.totals,
                by_family: preview.byFamily,
                total_selected: preview.totals.included,
                by_entity,
                skipped: preview.totals.skipped,
                timing_ms,
                stages: [
                    {
                        stage_key: "resolve_scope",
                        stage_label: "Resolve scope",
                        message: `Scope resolved for review_batch_id=${scope.reviewBatchId.toString()}.`,
                        counts: {},
                    },
                    {
                        stage_key: "count_eligible",
                        stage_label: "Count eligible candidates",
                        message: `${preview.totals.included} candidate(s) would be included.`,
                        counts: preview.totals,
                    },
                ],
                message: "Dry-run complete. No database rows were changed.",
            };
        }

        const { batch, itemsAdded, candidatesMarked, byFamily, timing, totalSelected } =
            await this.repo.createPublishBatchMultiFamily({
                scope,
                batchName: body.batch_name!.trim(),
                note: body.note?.trim() || null,
                families,
                options,
                createdByUserId: reviewedByUserId(user),
            });

        const detail = await this.getBatchById(batch.id);
        const buildingsMarked =
            byFamily.find((f) => f.entity_family === "buildings")?.marked_batched ?? 0;
        const familyLabels = families.map((f) => f.entityFamily).join(", ");
        const skipped = byFamily.reduce(
            (sum, f) => sum + f.skipped_reasons.reduce((s, r) => s + r.count, 0),
            0
        );
        const by_entity = Object.fromEntries(byFamily.map((f) => [f.entity_family, f.items_added]));
        const timing_ms = {
            resolve_ms: resolveMs + timing.resolve_ms,
            eligibility_ms: timing.eligibility_ms,
            payload_ms: timing.payload_ms,
            transaction_ms: timing.transaction_ms,
            total_ms: Date.now() - totalStart,
        };

        log?.info(
            {
                create_batch_timing: timing_ms,
                dry_run: false,
                batch_id: batch.id.toString(),
                review_batch_id: scope.reviewBatchId.toString(),
                total_selected: totalSelected,
            },
            `create_batch_timing eligibility_ms=${timing_ms.eligibility_ms} transaction_ms=${timing_ms.transaction_ms} total_ms=${timing_ms.total_ms}`
        );

        return {
            message: `Created publish batch "${batch.batch_name}" with ${itemsAdded} item(s) across [${familyLabels}]. Candidates marked promotion_status=batched. No core writes were performed.`,
            batch: detail,
            batch_id: batch.id.toString(),
            status: batch.status,
            items_added: itemsAdded,
            total_selected: totalSelected,
            candidates_marked_batched: candidatesMarked,
            by_family: byFamily,
            by_entity,
            skipped,
            timing_ms,
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

        const computed = await this.publishSummaryRepo.computePublishBatchSummary(batchId);

        const logs = await this.validationRepo.listStageLogs(batchId);
        const running = logs.find((l) => l.stage_status === "running");
        const lastFinished = [...logs].reverse().find((l) => l.finished_at != null);

        const current = running ?? lastFinished ?? null;

        const workflow = workflowForStatus(batch.status);
        const promotionSummary = parsePromotionResult(batch.summary);
        const validationSummary = parseLogsSummary(batch.summary, "validation_logs_summary");
        const promotionLogsSummary = parseLogsSummary(batch.summary, "promotion_logs_summary");
        const totalItemCount = computed?.item_counts.total ?? batch.validation_total;
        const itemProcessedCount = Math.min(batch.validation_done, totalItemCount);

        return {
            batch_id: batchId.toString(),
            status: batch.status,
            derived_status: computed?.derived_status ?? batch.status,
            derived_status_reason: computed?.derived_status_reason ?? null,
            stored_status_recommendation: computed?.stored_status_recommendation ?? null,
            status_note: computed?.derived_status_reason ?? null,
            workflow,
            validation_total: batch.validation_total,
            validation_done: itemProcessedCount,
            validation_percent: batch.validation_percent,
            total_item_count: totalItemCount,
            item_processed_count: itemProcessedCount,
            stage_count: IMPORT_REVIEW_PUBLISH_ITEM_VALIDATION_STAGES.length,
            validated_at: batch.validated_at ? batch.validated_at.toISOString() : null,
            current_stage_key: current?.stage_key ?? null,
            current_stage_label: current?.stage_label ?? null,
            current_stage_status: current?.stage_status ?? null,
            current_entity_family: current ? currentEntityFamilyFromLog(current.details) : null,
            current_message:
                computed?.derived_status === "invalid_empty_promoted"
                    ? (computed.derived_status_reason ??
                      "This batch was marked promoted but no items were promoted.")
                    : (current?.message ??
                      (workflow === "promotion" ? promotionLogsSummary : validationSummary)),
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
            confirmWarnings: body.confirm_warnings,
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

    async runRoadDryRun(
        batchId: bigint,
        body: PostImportReviewPromotionRoadDryRunBody
    ): Promise<ImportReviewPromotionRoadDryRunResult> {
        return this.roadDryRunService.runDryRun(batchId, body);
    }

    async getRoadDryRun(batchId: bigint): Promise<ImportReviewPromotionRoadDryRunResult> {
        return this.roadDryRunService.getDryRunResult(batchId);
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
