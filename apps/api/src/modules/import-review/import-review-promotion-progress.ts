import { Prisma, type PrismaClient } from "@prisma/client";

import {
    canDryRunPublishBatch,
    canPromotePublishBatch,
    canValidatePublishBatch,
    isPublishBatchClosedForReuse,
    normalizePublishBatchStoredStatus,
} from "./import-review-publish-batch-lifecycle.js";
import {
    parsePublishBatchDryRunResultFromSummary,
    publishBatchDryRunPassed,
} from "./import-review-publish-batch-dry-run.js";
import { requireValidPublishStageStatus, type PublishStageStatus } from "./import-review-promotion-stage-status.js";
import { hasPublishBatchValidationControlColumns } from "./import-review-publish-batch-validation-control-columns.js";
import { isValidationHeartbeatStalled } from "./import-review-promotion-validation-control.js";
import { ImportReviewPublishBatchNotFoundError } from "./import-review-promotion.errors.js";
import {
    isPromotionHeartbeatStalled,
    parsePromotionHeartbeatFromSummary,
} from "./import-review-promotion-promote-progress.js";
import { normalizeIsoDateTime } from "./import-review-promotion-progress-serializer.js";

/** Unified pipeline stages for batch validate → dry-run → promote → verify. */
export const IMPORT_REVIEW_PIPELINE_STAGE_KEYS = [
    "validate_items",
    "dry_run_items",
    "promote_items",
    "verify_items",
] as const;

export type ImportReviewPipelineStageKey = (typeof IMPORT_REVIEW_PIPELINE_STAGE_KEYS)[number];

const PIPELINE_STAGE_LABELS: Record<ImportReviewPipelineStageKey, string> = {
    validate_items: "Validate publish items",
    dry_run_items: "Dry-run publish items",
    promote_items: "Promote publish items",
    verify_items: "Verify promoted items",
};

export type ImportReviewPipelineStageProgressUpdate = {
    processed?: number;
    total?: number;
    percent?: number;
    currentFamily?: string | null;
    currentCandidateId?: bigint | string | number | null;
    successCount?: number;
    failedCount?: number;
    skippedCount?: number;
    message?: string | null;
    heartbeatAt?: string | Date | null;
};

export type ImportReviewPublishBatchPipelineSummary = {
    version: number;
    current_stage: ImportReviewPipelineStageKey;
    current_stage_label: string;
    stage_status: PublishStageStatus;
    percent: number;
    processed_count: number;
    total_item_count: number;
    current_family: string | null;
    current_candidate_id: string | null;
    success_count: number;
    failed_count: number;
    skipped_count: number;
    heartbeat_at: string | null;
    last_error: string | null;
    last_message: string | null;
    last_updated_at: string;
};

export type ImportReviewBatchPipelineProgress = {
    batch_id: string;
    status: string;
    current_stage: ImportReviewPipelineStageKey | null;
    current_stage_label: string | null;
    stage_status: PublishStageStatus | null;
    percent: number;
    processed_count: number;
    total_item_count: number;
    current_family: string | null;
    last_heartbeat_at: string | null;
    last_error: string | null;
    resumable_actions: ImportReviewPipelineResumableAction[];
    pipeline: ImportReviewPublishBatchPipelineSummary | null;
};

export type ImportReviewPipelineResumableAction =
    | "validate"
    | "resume_validation"
    | "cancel_validation"
    | "reset_validation"
    | "dry_run"
    | "resume_dry_run"
    | "promote"
    | "resume_promotion"
    | "cancel_promotion"
    | "reset_promotion"
    | "verify"
    | "resume_verify";

type BatchProgressRow = {
    id: bigint;
    status: string;
    total_item_count: number;
    success_count: number;
    failed_count: number;
    skipped_count: number;
    validation_total: number;
    validation_done: number;
    validation_percent: number;
    validated_at: Date | null;
    validation_heartbeat_at: Date | null;
    summary: unknown;
};

function clampInt(value: unknown, fallback = 0): number {
    const n = Number(value);
    if (!Number.isFinite(n)) {
        return fallback;
    }
    return Math.max(0, Math.floor(n));
}

export function clampPipelinePercent(value: unknown): number {
    const n = Number(value);
    if (!Number.isFinite(n)) {
        return 0;
    }
    return Math.min(100, Math.max(0, Math.round(n * 100) / 100));
}

export function computePipelinePercent(processed: number, total: number, explicit?: number): number {
    if (explicit !== undefined && Number.isFinite(explicit)) {
        return clampPipelinePercent(explicit);
    }
    if (total <= 0) {
        return processed > 0 ? 100 : 0;
    }
    return clampPipelinePercent((processed / total) * 100);
}

export function isPipelineStageKey(value: string): value is ImportReviewPipelineStageKey {
    return (IMPORT_REVIEW_PIPELINE_STAGE_KEYS as readonly string[]).includes(value);
}

export function parsePipelineFromSummary(summary: unknown): ImportReviewPublishBatchPipelineSummary | null {
    if (!summary || typeof summary !== "object" || Array.isArray(summary)) {
        return null;
    }
    const raw = (summary as Record<string, unknown>).pipeline;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return null;
    }
    const o = raw as Record<string, unknown>;
    const stage = typeof o.current_stage === "string" ? o.current_stage.trim() : "";
    if (!isPipelineStageKey(stage)) {
        return null;
    }
    const stageStatus = requireValidPublishStageStatus(
        typeof o.stage_status === "string" ? o.stage_status : "pending"
    );
    const label =
        typeof o.current_stage_label === "string" && o.current_stage_label.trim()
            ? o.current_stage_label.trim()
            : PIPELINE_STAGE_LABELS[stage];

    return {
        version: clampInt(o.version, 1),
        current_stage: stage,
        current_stage_label: label,
        stage_status: stageStatus,
        percent: clampPipelinePercent(o.percent),
        processed_count: clampInt(o.processed_count),
        total_item_count: clampInt(o.total_item_count),
        current_family:
            typeof o.current_family === "string" && o.current_family.trim()
                ? o.current_family.trim()
                : null,
        current_candidate_id:
            o.current_candidate_id != null ? String(o.current_candidate_id) : null,
        success_count: clampInt(o.success_count),
        failed_count: clampInt(o.failed_count),
        skipped_count: clampInt(o.skipped_count),
        heartbeat_at: normalizeIsoDateTime(o.heartbeat_at),
        last_error: typeof o.last_error === "string" ? o.last_error : null,
        last_message: typeof o.last_message === "string" ? o.last_message : null,
        last_updated_at:
            normalizeIsoDateTime(o.last_updated_at) ?? new Date(0).toISOString(),
    };
}

export function buildPipelineSummaryPayload(args: {
    stageKey: ImportReviewPipelineStageKey;
    label: string;
    stageStatus: PublishStageStatus;
    processed: number;
    total: number;
    percent: number;
    currentFamily?: string | null;
    currentCandidateId?: bigint | string | number | null;
    successCount?: number;
    failedCount?: number;
    skippedCount?: number;
    heartbeatAt?: string | null;
    lastError?: string | null;
    message?: string | null;
}): ImportReviewPublishBatchPipelineSummary {
    const nowIso = new Date().toISOString();
    return {
        version: 1,
        current_stage: args.stageKey,
        current_stage_label: args.label,
        stage_status: args.stageStatus,
        percent: clampPipelinePercent(args.percent),
        processed_count: clampInt(args.processed),
        total_item_count: clampInt(args.total),
        current_family: args.currentFamily ?? null,
        current_candidate_id:
            args.currentCandidateId != null ? String(args.currentCandidateId) : null,
        success_count: clampInt(args.successCount),
        failed_count: clampInt(args.failedCount),
        skipped_count: clampInt(args.skippedCount),
        heartbeat_at: args.heartbeatAt ?? nowIso,
        last_error: args.lastError ?? null,
        last_message: args.message ?? null,
        last_updated_at: nowIso,
    };
}

export function buildStageLogDetailsFromPipeline(
    pipeline: ImportReviewPublishBatchPipelineSummary
): Record<string, unknown> {
    return {
        pipeline_version: pipeline.version,
        processed_count: pipeline.processed_count,
        total_item_count: pipeline.total_item_count,
        current_family: pipeline.current_family,
        current_candidate_id: pipeline.current_candidate_id,
        success_count: pipeline.success_count,
        failed_count: pipeline.failed_count,
        skipped_count: pipeline.skipped_count,
        last_heartbeat_at: pipeline.heartbeat_at,
        last_error: pipeline.last_error,
    };
}

export function deriveResumableActions(args: {
    status: string;
    summary?: unknown;
    pipeline: ImportReviewPublishBatchPipelineSummary | null;
    validatedAt: Date | null;
    validationPercent: number;
    pendingPublishItemCount: number;
    promotablePendingCount: number;
    dryRunPassed: boolean;
    validationHeartbeatStale: boolean;
    promotionHeartbeatStale: boolean;
}): ImportReviewPipelineResumableAction[] {
    const status = normalizePublishBatchStoredStatus(args.status);
    const actions: ImportReviewPipelineResumableAction[] = [];
    const pipelineRunning = args.pipeline?.stage_status === "running";
    const pipelineStage = args.pipeline?.current_stage ?? null;
    const dryRunPassed =
        args.dryRunPassed || publishBatchDryRunPassed(parsePublishBatchDryRunResultFromSummary(args.summary));

    if (isPublishBatchClosedForReuse(status)) {
        return actions;
    }

    if (status === "validating") {
        if (args.validationHeartbeatStale || pipelineRunning) {
            actions.push("resume_validation");
        }
        actions.push("cancel_validation");
        return actions;
    }

    if (canValidatePublishBatch(status)) {
        actions.push("validate");
        if (status === "failed" || status === "blocked") {
            actions.push("reset_validation");
        }
    }

    if (status === "promoting") {
        if (args.promotionHeartbeatStale || pipelineRunning) {
            actions.push("resume_promotion");
        }
        actions.push("cancel_promotion", "reset_promotion");
        return actions;
    }

    const validationComplete =
        args.validatedAt != null ||
        args.validationPercent >= 100 ||
        status === "ready" ||
        status === "partial" ||
        status === "blocked";

    if (validationComplete && canDryRunPublishBatch(status, args.promotablePendingCount) && !dryRunPassed) {
        if (pipelineStage === "dry_run_items" && pipelineRunning) {
            actions.push("resume_dry_run");
        } else {
            actions.push("dry_run");
        }
    }

    if (validationComplete && canPromotePublishBatch(status, args.promotablePendingCount, dryRunPassed)) {
        actions.push("promote");
    }

    if (status === "promoted" || status === "partial") {
        if (pipelineStage === "verify_items" && pipelineRunning) {
            actions.push("resume_verify");
        }
        actions.push("verify");
    }

    if (
        args.pipeline?.stage_status === "failed" &&
        pipelineStage === "validate_items" &&
        args.pendingPublishItemCount > 0
    ) {
        actions.push("resume_validation");
    }

    return [...new Set(actions)];
}

export class ImportReviewPromotionProgress {
    private validationControlColumns: boolean | null = null;

    constructor(private readonly prisma: PrismaClient) {}

    private async useValidationControlColumns(): Promise<boolean> {
        if (this.validationControlColumns === null) {
            this.validationControlColumns = await hasPublishBatchValidationControlColumns(this.prisma);
        }
        return this.validationControlColumns;
    }

    private async fetchBatchRow(batchId: bigint): Promise<BatchProgressRow | null> {
        const hasControl = await this.useValidationControlColumns();
        const rows = hasControl
            ? await this.prisma.$queryRaw<BatchProgressRow[]>`
                  SELECT
                      id,
                      status,
                      total_item_count,
                      success_count,
                      failed_count,
                      skipped_count,
                      validation_total,
                      validation_done,
                      validation_percent::float8 AS validation_percent,
                      validated_at,
                      validation_heartbeat_at,
                      summary
                  FROM system.system_publish_batches
                  WHERE id = ${batchId}
                  LIMIT 1
              `
            : await this.prisma.$queryRaw<BatchProgressRow[]>`
                  SELECT
                      id,
                      status,
                      total_item_count,
                      success_count,
                      failed_count,
                      skipped_count,
                      validation_total,
                      validation_done,
                      validation_percent::float8 AS validation_percent,
                      validated_at,
                      NULL::timestamptz AS validation_heartbeat_at,
                      summary
                  FROM system.system_publish_batches
                  WHERE id = ${batchId}
                  LIMIT 1
              `;
        return rows[0] ?? null;
    }

    private async mergePipelineSummary(
        batchId: bigint,
        pipeline: ImportReviewPublishBatchPipelineSummary
    ): Promise<void> {
        const patch = JSON.stringify({ pipeline });
        await this.prisma.$executeRaw`
            UPDATE system.system_publish_batches
            SET summary = coalesce(summary, '{}'::jsonb) || ${patch}::jsonb
            WHERE id = ${batchId}
        `;
    }

    private async touchValidationHeartbeat(batchId: bigint, heartbeatIso: string): Promise<void> {
        if (!(await this.useValidationControlColumns())) {
            return;
        }
        await this.prisma.$executeRaw`
            UPDATE system.system_publish_batches
            SET validation_heartbeat_at = ${heartbeatIso}::timestamptz
            WHERE id = ${batchId}
        `;
    }

    private async syncBatchCountersForStage(
        batchId: bigint,
        stageKey: ImportReviewPipelineStageKey,
        pipeline: ImportReviewPublishBatchPipelineSummary
    ): Promise<void> {
        const percent = pipeline.percent;
        const done = pipeline.processed_count;
        const total = pipeline.total_item_count;

        if (stageKey === "validate_items") {
            await this.prisma.$executeRaw`
                UPDATE system.system_publish_batches
                SET
                    validation_total = ${total},
                    validation_done = ${done},
                    validation_percent = ${percent}
                WHERE id = ${batchId}
            `;
            return;
        }

        if (stageKey === "promote_items") {
            const patch = JSON.stringify({
                promotion_progress_total: total,
                promotion_progress_done: done,
                promotion_heartbeat_at: pipeline.heartbeat_at,
            });
            await this.prisma.$executeRaw`
                UPDATE system.system_publish_batches
                SET
                    success_count = ${pipeline.success_count},
                    failed_count = ${pipeline.failed_count},
                    skipped_count = ${pipeline.skipped_count},
                    summary = coalesce(summary, '{}'::jsonb) || ${patch}::jsonb
                WHERE id = ${batchId}
            `;
        }
    }

    private async upsertStageLog(args: {
        batchId: bigint;
        stageKey: ImportReviewPipelineStageKey;
        label: string;
        stageStatus: PublishStageStatus;
        message: string | null;
        progressPercent: number;
        details: Record<string, unknown>;
        finished?: boolean;
    }): Promise<void> {
        const stageStatus = requireValidPublishStageStatus(args.stageStatus);
        const detailsJson = JSON.stringify(args.details);
        const existing = await this.prisma.$queryRaw<{ id: bigint }[]>`
            SELECT id
            FROM system.system_publish_stage_logs
            WHERE publish_batch_id = ${args.batchId}
              AND stage_key = ${args.stageKey}
              AND finished_at IS NULL
            ORDER BY id DESC
            LIMIT 1
        `;
        if (existing[0]) {
            if (args.finished) {
                await this.prisma.$executeRaw`
                    UPDATE system.system_publish_stage_logs
                    SET
                        stage_status = ${stageStatus},
                        stage_label = ${args.label},
                        message = ${args.message},
                        progress_percent = ${args.progressPercent},
                        details = ${detailsJson}::jsonb,
                        finished_at = now()
                    WHERE id = ${existing[0].id}
                `;
            } else {
                await this.prisma.$executeRaw`
                    UPDATE system.system_publish_stage_logs
                    SET
                        stage_status = ${stageStatus},
                        stage_label = ${args.label},
                        message = ${args.message},
                        progress_percent = ${args.progressPercent},
                        details = ${detailsJson}::jsonb,
                        started_at = CASE WHEN stage_status = 'pending' THEN now() ELSE started_at END
                    WHERE id = ${existing[0].id}
                `;
            }
            return;
        }

        await this.prisma.$executeRaw`
            INSERT INTO system.system_publish_stage_logs (
                publish_batch_id,
                stage_key,
                stage_label,
                stage_status,
                message,
                progress_percent,
                details,
                started_at,
                finished_at
            )
            VALUES (
                ${args.batchId},
                ${args.stageKey},
                ${args.label},
                ${stageStatus},
                ${args.message},
                ${args.progressPercent},
                ${detailsJson}::jsonb,
                now(),
                ${args.finished ? Prisma.sql`now()` : Prisma.sql`NULL`}
            )
        `;
    }

    async startStage(
        batchId: bigint,
        stageKey: ImportReviewPipelineStageKey,
        label: string,
        total: number
    ): Promise<ImportReviewPublishBatchPipelineSummary> {
        const safeTotal = Math.max(0, clampInt(total));
        const heartbeatIso = new Date().toISOString();
        const pipeline = buildPipelineSummaryPayload({
            stageKey,
            label: label.trim() || PIPELINE_STAGE_LABELS[stageKey],
            stageStatus: "running",
            processed: 0,
            total: safeTotal,
            percent: 0,
            heartbeatAt: heartbeatIso,
            message: `Started ${label.trim() || PIPELINE_STAGE_LABELS[stageKey]}.`,
        });

        await this.mergePipelineSummary(batchId, pipeline);
        await this.syncBatchCountersForStage(batchId, stageKey, pipeline);
        if (stageKey === "validate_items") {
            await this.touchValidationHeartbeat(batchId, heartbeatIso);
        }

        await this.upsertStageLog({
            batchId,
            stageKey,
            label: pipeline.current_stage_label,
            stageStatus: "running",
            message: pipeline.last_message,
            progressPercent: 0,
            details: buildStageLogDetailsFromPipeline(pipeline),
        });

        return pipeline;
    }

    async updateStageProgress(
        batchId: bigint,
        stageKey: ImportReviewPipelineStageKey,
        update: ImportReviewPipelineStageProgressUpdate
    ): Promise<ImportReviewPublishBatchPipelineSummary> {
        const row = await this.fetchBatchRow(batchId);
        const existing =
            parsePipelineFromSummary(row?.summary) ??
            buildPipelineSummaryPayload({
                stageKey,
                label: PIPELINE_STAGE_LABELS[stageKey],
                stageStatus: "running",
                processed: 0,
                total: clampInt(update.total ?? row?.validation_total ?? row?.total_item_count),
                percent: 0,
            });

        const total = clampInt(update.total ?? existing.total_item_count);
        const processed = clampInt(update.processed ?? existing.processed_count);
        const percent = computePipelinePercent(processed, total, update.percent);
        const heartbeatIso =
            normalizeIsoDateTime(update.heartbeatAt) ?? new Date().toISOString();

        const pipeline = buildPipelineSummaryPayload({
            stageKey,
            label: existing.current_stage_label,
            stageStatus: "running",
            processed,
            total,
            percent,
            currentFamily: update.currentFamily ?? existing.current_family,
            currentCandidateId: update.currentCandidateId ?? existing.current_candidate_id,
            successCount: update.successCount ?? existing.success_count,
            failedCount: update.failedCount ?? existing.failed_count,
            skippedCount: update.skippedCount ?? existing.skipped_count,
            heartbeatAt: heartbeatIso,
            lastError: existing.last_error,
            message: update.message ?? existing.last_message,
        });

        await this.mergePipelineSummary(batchId, pipeline);
        await this.syncBatchCountersForStage(batchId, stageKey, pipeline);
        if (stageKey === "validate_items") {
            await this.touchValidationHeartbeat(batchId, heartbeatIso);
        }

        await this.upsertStageLog({
            batchId,
            stageKey,
            label: pipeline.current_stage_label,
            stageStatus: "running",
            message: pipeline.last_message,
            progressPercent: percent,
            details: buildStageLogDetailsFromPipeline(pipeline),
        });

        return pipeline;
    }

    async finishStage(
        batchId: bigint,
        stageKey: ImportReviewPipelineStageKey,
        status: PublishStageStatus,
        summary?: Record<string, unknown> | string | null
    ): Promise<ImportReviewPublishBatchPipelineSummary> {
        const row = await this.fetchBatchRow(batchId);
        const existing = parsePipelineFromSummary(row?.summary);
        const total = clampInt(existing?.total_item_count ?? row?.validation_total ?? row?.total_item_count);
        const processed = clampInt(
            existing?.processed_count ?? row?.validation_done ?? total
        );
        const stageStatus = requireValidPublishStageStatus(status);
        const message =
            typeof summary === "string"
                ? summary
                : typeof summary?.message === "string"
                  ? summary.message
                  : (existing?.last_message ?? `${PIPELINE_STAGE_LABELS[stageKey]} finished.`);

        const pipeline = buildPipelineSummaryPayload({
            stageKey,
            label: existing?.current_stage_label ?? PIPELINE_STAGE_LABELS[stageKey],
            stageStatus,
            processed: Math.min(processed, total),
            total,
            percent: stageStatus === "success" || stageStatus === "warning" ? 100 : existing?.percent ?? 100,
            currentFamily: existing?.current_family ?? null,
            currentCandidateId: existing?.current_candidate_id ?? null,
            successCount: existing?.success_count ?? row?.success_count,
            failedCount: existing?.failed_count ?? row?.failed_count,
            skippedCount: existing?.skipped_count ?? row?.skipped_count,
            heartbeatAt: new Date().toISOString(),
            message,
        });

        const extra =
            summary && typeof summary === "object" && !Array.isArray(summary)
                ? (summary as Record<string, unknown>)
                : {};
        const summaryPatch = JSON.stringify({ ...extra, pipeline });
        await this.prisma.$executeRaw`
            UPDATE system.system_publish_batches
            SET summary = coalesce(summary, '{}'::jsonb) || ${summaryPatch}::jsonb
            WHERE id = ${batchId}
        `;
        await this.syncBatchCountersForStage(batchId, stageKey, pipeline);

        await this.upsertStageLog({
            batchId,
            stageKey,
            label: pipeline.current_stage_label,
            stageStatus,
            message: pipeline.last_message,
            progressPercent: pipeline.percent,
            details: {
                ...buildStageLogDetailsFromPipeline(pipeline),
                ...(summary && typeof summary === "object" && !Array.isArray(summary) ? summary : {}),
            },
            finished: true,
        });

        return pipeline;
    }

    async failStage(
        batchId: bigint,
        stageKey: ImportReviewPipelineStageKey,
        error: string | Error
    ): Promise<ImportReviewPublishBatchPipelineSummary> {
        const message = error instanceof Error ? error.message : String(error);
        const row = await this.fetchBatchRow(batchId);
        const existing = parsePipelineFromSummary(row?.summary);
        const pipeline = buildPipelineSummaryPayload({
            stageKey,
            label: existing?.current_stage_label ?? PIPELINE_STAGE_LABELS[stageKey],
            stageStatus: "failed",
            processed: clampInt(existing?.processed_count ?? row?.validation_done),
            total: clampInt(existing?.total_item_count ?? row?.validation_total),
            percent: existing?.percent ?? clampPipelinePercent(row?.validation_percent),
            currentFamily: existing?.current_family ?? null,
            currentCandidateId: existing?.current_candidate_id ?? null,
            successCount: existing?.success_count ?? row?.success_count,
            failedCount: existing?.failed_count ?? row?.failed_count,
            skippedCount: existing?.skipped_count ?? row?.skipped_count,
            heartbeatAt: new Date().toISOString(),
            lastError: message,
            message,
        });

        await this.mergePipelineSummary(batchId, pipeline);
        await this.upsertStageLog({
            batchId,
            stageKey,
            label: pipeline.current_stage_label,
            stageStatus: "failed",
            message,
            progressPercent: pipeline.percent,
            details: buildStageLogDetailsFromPipeline(pipeline),
            finished: true,
        });

        return pipeline;
    }

    private async countPublishItemBuckets(batchId: bigint): Promise<{
        pending: number;
        promotablePending: number;
    }> {
        const rows = await this.prisma.$queryRaw<
            { pending: bigint; promotable_pending: bigint }[]
        >`
            SELECT
                count(*) FILTER (WHERE publish_status = 'pending')::bigint AS pending,
                count(*) FILTER (
                    WHERE publish_status = 'pending'
                      AND coalesce(validation_result->>'status', '') IN ('ready', 'valid', 'warning')
                )::bigint AS promotable_pending
            FROM system.system_publish_items
            WHERE publish_batch_id = ${batchId}
        `;
        return {
            pending: Number(rows[0]?.pending ?? 0n),
            promotablePending: Number(rows[0]?.promotable_pending ?? 0n),
        };
    }

    async getBatchProgress(batchId: bigint): Promise<ImportReviewBatchPipelineProgress> {
        const row = await this.fetchBatchRow(batchId);
        if (!row) {
            throw new ImportReviewPublishBatchNotFoundError(batchId.toString());
        }

        const pipeline = parsePipelineFromSummary(row.summary);
        const itemBuckets = await this.countPublishItemBuckets(batchId);
        const dryRunResult = parsePublishBatchDryRunResultFromSummary(row.summary);
        const dryRunPassed = publishBatchDryRunPassed(dryRunResult);

        const validationHeartbeat = row.validation_heartbeat_at;
        const promotionHeartbeat = parsePromotionHeartbeatFromSummary(row.summary);
        const validationHeartbeatStale =
            row.status === "validating" &&
            isValidationHeartbeatStalled(validationHeartbeat, Date.now());
        const promotionHeartbeatStale =
            row.status === "promoting" &&
            isPromotionHeartbeatStalled(promotionHeartbeat, Date.now());

        const resumable_actions = deriveResumableActions({
            status: row.status,
            summary: row.summary,
            pipeline,
            validatedAt: row.validated_at,
            validationPercent: row.validation_percent,
            pendingPublishItemCount: itemBuckets.pending,
            promotablePendingCount: itemBuckets.promotablePending,
            dryRunPassed,
            validationHeartbeatStale,
            promotionHeartbeatStale,
        });

        const percent =
            pipeline?.percent ??
            (row.validation_percent > 0 || row.validated_at
                ? clampPipelinePercent(row.validation_percent)
                : 0);
        const processed_count = pipeline?.processed_count ?? row.validation_done;
        const total_item_count =
            pipeline?.total_item_count ||
            row.validation_total ||
            row.total_item_count ||
            0;

        const last_heartbeat_at =
            pipeline?.heartbeat_at ??
            (validationHeartbeat ? validationHeartbeat.toISOString() : null) ??
            (promotionHeartbeat ? promotionHeartbeat.toISOString() : null);

        return {
            batch_id: batchId.toString(),
            status: row.status,
            current_stage: pipeline?.current_stage ?? null,
            current_stage_label: pipeline?.current_stage_label ?? null,
            stage_status: pipeline?.stage_status ?? null,
            percent,
            processed_count,
            total_item_count,
            current_family: pipeline?.current_family ?? null,
            last_heartbeat_at,
            last_error: pipeline?.last_error ?? null,
            resumable_actions,
            pipeline,
        };
    }
}
