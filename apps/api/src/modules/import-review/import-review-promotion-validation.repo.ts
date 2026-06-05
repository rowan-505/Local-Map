import { Prisma, type PrismaClient } from "@prisma/client";

import {
    IMPORT_REVIEW_PUBLISH_VALIDATION_STAGES,
    type ImportReviewPublishBatchProgressRow,
    type ImportReviewPublishStageLogRow,
    type ImportReviewPublishValidationStageKey,
} from "./import-review-promotion-validation.types.js";
import { requireValidPublishStageStatus } from "./import-review-promotion-stage-status.js";
import { hasPublishBatchValidationControlColumns } from "./import-review-publish-batch-validation-control-columns.js";
import {
    cleanupPublishBatchTerminalFailure,
    PUBLISH_BATCH_VALIDATION_SYSTEM_ERROR_CODE,
    type PublishBatchTerminalFailureOptions,
} from "./import-review-promotion-batch-failure-cleanup.js";

export const IMPORT_REVIEW_VALIDATION_CHUNK_SIZE = Math.max(
    10,
    Number.parseInt(process.env.IMPORT_REVIEW_VALIDATION_CHUNK_SIZE ?? "200", 10) || 200
);

const VALIDATABLE_BATCH_STATUSES = ["draft", "blocked", "failed", "ready", "partial"] as const;

export type PublishItemEntityRow = {
    id: bigint;
    entity_family: string;
};

export class ImportReviewPromotionValidationRepository {
    private validationControlColumns: boolean | null = null;

    constructor(readonly prisma: PrismaClient) {}

    private async useValidationControlColumns(): Promise<boolean> {
        if (this.validationControlColumns === null) {
            this.validationControlColumns = await hasPublishBatchValidationControlColumns(this.prisma);
        }
        return this.validationControlColumns;
    }

    async fetchBatchProgress(batchId: bigint): Promise<ImportReviewPublishBatchProgressRow | null> {
        const hasControlColumns = await this.useValidationControlColumns();
        const rows = hasControlColumns
            ? await this.prisma.$queryRaw<ImportReviewPublishBatchProgressRow[]>`
                  SELECT
                      id,
                      status,
                      validation_total,
                      validation_done,
                      validation_percent::float8 AS validation_percent,
                      validated_at,
                      validation_heartbeat_at,
                      validation_cancel_requested_at,
                      promoted_at,
                      summary
                  FROM system.system_publish_batches
                  WHERE id = ${batchId}
                  LIMIT 1
              `
            : await this.prisma.$queryRaw<ImportReviewPublishBatchProgressRow[]>`
                  SELECT
                      id,
                      status,
                      validation_total,
                      validation_done,
                      validation_percent::float8 AS validation_percent,
                      validated_at,
                      NULL::timestamptz AS validation_heartbeat_at,
                      NULL::timestamptz AS validation_cancel_requested_at,
                      promoted_at,
                      summary
                  FROM system.system_publish_batches
                  WHERE id = ${batchId}
                  LIMIT 1
              `;
        return rows[0] ?? null;
    }

    async isValidationCancelRequested(batchId: bigint): Promise<boolean> {
        if (!(await this.useValidationControlColumns())) {
            return false;
        }
        const rows = await this.prisma.$queryRaw<{ cancel_requested: boolean }[]>`
            SELECT (validation_cancel_requested_at IS NOT NULL) AS cancel_requested
            FROM system.system_publish_batches
            WHERE id = ${batchId}
            LIMIT 1
        `;
        return rows[0]?.cancel_requested === true;
    }

    async requestValidationCancel(batchId: bigint): Promise<boolean> {
        if (!(await this.useValidationControlColumns())) {
            return false;
        }
        const rows = await this.prisma.$queryRaw<{ id: bigint }[]>`
            UPDATE system.system_publish_batches
            SET validation_cancel_requested_at = now()
            WHERE id = ${batchId}
              AND status = 'validating'
              AND validation_cancel_requested_at IS NULL
            RETURNING id
        `;
        return rows.length > 0;
    }

    async clearValidationCancelFlag(batchId: bigint): Promise<void> {
        if (!(await this.useValidationControlColumns())) {
            return;
        }
        await this.prisma.$executeRaw`
            UPDATE system.system_publish_batches
            SET validation_cancel_requested_at = NULL
            WHERE id = ${batchId}
        `;
    }

    async touchValidationHeartbeat(batchId: bigint): Promise<void> {
        if (!(await this.useValidationControlColumns())) {
            return;
        }
        await this.prisma.$executeRaw`
            UPDATE system.system_publish_batches
            SET validation_heartbeat_at = now()
            WHERE id = ${batchId}
        `;
    }

    async claimBatchForValidation(batchId: bigint): Promise<{ claimed: boolean; status: string | null }> {
        const hasControlColumns = await this.useValidationControlColumns();
        const rows = hasControlColumns
            ? await this.prisma.$queryRaw<{ id: bigint; status: string }[]>`
                  UPDATE system.system_publish_batches
                  SET
                      status = 'validating',
                      validation_done = 0,
                      validation_percent = 0,
                      validation_total = 0,
                      validated_at = NULL,
                      validation_cancel_requested_at = NULL,
                      validation_heartbeat_at = now()
                  WHERE id = ${batchId}
                    AND status IN (${Prisma.join(VALIDATABLE_BATCH_STATUSES.map((s) => Prisma.sql`${s}`))})
                  RETURNING id, status
              `
            : await this.prisma.$queryRaw<{ id: bigint; status: string }[]>`
                  UPDATE system.system_publish_batches
                  SET
                      status = 'validating',
                      validation_done = 0,
                      validation_percent = 0,
                      validation_total = 0,
                      validated_at = NULL
                  WHERE id = ${batchId}
                    AND status IN (${Prisma.join(VALIDATABLE_BATCH_STATUSES.map((s) => Prisma.sql`${s}`))})
                  RETURNING id, status
              `;
        if (rows.length > 0) {
            return { claimed: true, status: "validating" };
        }

        const current = await this.fetchBatchProgress(batchId);
        return { claimed: false, status: current?.status ?? null };
    }

    async clearStageLogs(batchId: bigint): Promise<void> {
        await this.prisma.$executeRaw`
            DELETE FROM system.system_publish_stage_logs
            WHERE publish_batch_id = ${batchId}
        `;
    }

    async seedStageLogs(batchId: bigint): Promise<void> {
        for (const stage of IMPORT_REVIEW_PUBLISH_VALIDATION_STAGES) {
            await this.prisma.$executeRaw`
                INSERT INTO system.system_publish_stage_logs (
                    publish_batch_id,
                    stage_key,
                    stage_label,
                    stage_status,
                    message,
                    progress_percent,
                    details,
                    started_at
                )
                VALUES (
                    ${batchId},
                    ${stage.key},
                    ${stage.label},
                    'pending',
                    NULL,
                    0,
                    '{}'::jsonb,
                    now()
                )
            `;
        }
    }

    async updateStageLog(args: {
        batchId: bigint;
        stageKey: ImportReviewPublishValidationStageKey;
        stageStatus: string;
        message?: string | null;
        progressPercent: number;
        details?: Record<string, unknown>;
        finished?: boolean;
    }): Promise<void> {
        const stageStatus = requireValidPublishStageStatus(args.stageStatus);
        const detailsJson = JSON.stringify(args.details ?? {});
        if (args.finished) {
            await this.prisma.$executeRaw`
                UPDATE system.system_publish_stage_logs
                SET
                    stage_status = ${stageStatus},
                    message = ${args.message ?? null},
                    progress_percent = ${args.progressPercent},
                    details = ${detailsJson}::jsonb,
                    finished_at = now()
                WHERE publish_batch_id = ${args.batchId}
                  AND stage_key = ${args.stageKey}
            `;
        } else {
            await this.prisma.$executeRaw`
                UPDATE system.system_publish_stage_logs
                SET
                    stage_status = ${stageStatus},
                    message = ${args.message ?? null},
                    progress_percent = ${args.progressPercent},
                    details = ${detailsJson}::jsonb,
                    started_at = CASE WHEN stage_status = 'pending' THEN now() ELSE started_at END
                WHERE publish_batch_id = ${args.batchId}
                  AND stage_key = ${args.stageKey}
            `;
        }
    }

    async listStageLogs(batchId: bigint): Promise<ImportReviewPublishStageLogRow[]> {
        return this.prisma.$queryRaw<ImportReviewPublishStageLogRow[]>`
            SELECT
                id,
                publish_batch_id,
                stage_key,
                stage_label,
                stage_status,
                message,
                progress_percent::float8 AS progress_percent,
                details,
                started_at,
                finished_at
            FROM system.system_publish_stage_logs
            WHERE publish_batch_id = ${batchId}
            ORDER BY started_at ASC, id ASC
        `;
    }

    /**
     * Updates batch counters and the running validation stage log in one heartbeat (P0 observability).
     */
    async updateValidationHeartbeat(args: {
        batchId: bigint;
        stageKey: ImportReviewPublishValidationStageKey;
        validationTotal: number;
        validationDone: number;
        validationPercent: number;
        message: string;
        stageLogDetails: Record<string, unknown>;
    }): Promise<void> {
        await this.updateBatchProgress({
            batchId: args.batchId,
            validationTotal: args.validationTotal,
            validationDone: args.validationDone,
            validationPercent: args.validationPercent,
        });
        await this.touchValidationHeartbeat(args.batchId);
        await this.updateStageLog({
            batchId: args.batchId,
            stageKey: args.stageKey,
            stageStatus: "running",
            message: args.message,
            progressPercent: args.validationPercent,
            details: args.stageLogDetails,
        });
    }

    async updateBatchProgress(args: {
        batchId: bigint;
        validationTotal?: number;
        validationDone?: number;
        validationPercent: number;
    }): Promise<void> {
        const validationDone =
            args.validationDone !== undefined && args.validationTotal !== undefined
                ? Math.min(args.validationDone, args.validationTotal)
                : args.validationDone;

        if (args.validationTotal !== undefined && validationDone !== undefined) {
            await this.prisma.$executeRaw`
                UPDATE system.system_publish_batches
                SET
                    validation_total = ${args.validationTotal},
                    validation_done = ${validationDone},
                    validation_percent = ${args.validationPercent}
                WHERE id = ${args.batchId}
            `;
        } else if (validationDone !== undefined) {
            await this.prisma.$executeRaw`
                UPDATE system.system_publish_batches
                SET
                    validation_done = ${validationDone},
                    validation_percent = ${args.validationPercent}
                WHERE id = ${args.batchId}
            `;
        } else {
            await this.prisma.$executeRaw`
                UPDATE system.system_publish_batches
                SET validation_percent = ${args.validationPercent}
                WHERE id = ${args.batchId}
            `;
        }
    }

    async countPublishItems(batchId: bigint): Promise<number> {
        const rows = await this.prisma.$queryRaw<{ count: bigint }[]>`
            SELECT count(*)::bigint AS count
            FROM system.system_publish_items
            WHERE publish_batch_id = ${batchId}
        `;
        return Number(rows[0]?.count ?? 0n);
    }

    async countPendingItems(batchId: bigint): Promise<number> {
        const rows = await this.prisma.$queryRaw<{ count: bigint }[]>`
            SELECT count(*)::bigint AS count
            FROM system.system_publish_items
            WHERE publish_batch_id = ${batchId}
              AND publish_status = 'pending'
        `;
        return Number(rows[0]?.count ?? 0n);
    }

    async listPublishItemsWithEntity(batchId: bigint): Promise<PublishItemEntityRow[]> {
        return this.prisma.$queryRaw<PublishItemEntityRow[]>`
            SELECT id, entity_family
            FROM system.system_publish_items
            WHERE publish_batch_id = ${batchId}
            ORDER BY entity_family ASC, id ASC
        `;
    }

    async countItemsByEntityFamily(batchId: bigint): Promise<{ entity_family: string; count: bigint }[]> {
        return this.prisma.$queryRaw<{ entity_family: string; count: bigint }[]>`
            SELECT entity_family, count(*)::bigint AS count
            FROM system.system_publish_items
            WHERE publish_batch_id = ${batchId}
            GROUP BY entity_family
            ORDER BY entity_family ASC
        `;
    }

    async failBatch(
        batchId: bigint,
        message: string,
        summaryPatch?: Record<string, unknown>,
        options?: PublishBatchTerminalFailureOptions
    ): Promise<void> {
        const summary = JSON.stringify({
            validation_error: message,
            ...summaryPatch,
        });
        const hasControlColumns = await this.useValidationControlColumns();
        if (hasControlColumns) {
            await this.prisma.$executeRaw`
                UPDATE system.system_publish_batches
                SET
                    status = 'failed',
                    validation_cancel_requested_at = NULL,
                    summary = coalesce(summary, '{}'::jsonb) || ${summary}::jsonb
                WHERE id = ${batchId}
            `;
        } else {
            await this.prisma.$executeRaw`
                UPDATE system.system_publish_batches
                SET
                    status = 'failed',
                    summary = coalesce(summary, '{}'::jsonb) || ${summary}::jsonb
                WHERE id = ${batchId}
            `;
        }

        const cleanup = options?.cleanupPublishItemsAndCandidates ?? true;
        if (!cleanup) {
            return;
        }
        const errorCode =
            options?.terminalFailureErrorCode ?? PUBLISH_BATCH_VALIDATION_SYSTEM_ERROR_CODE;
        await cleanupPublishBatchTerminalFailure(this.prisma, batchId, {
            errorCode,
            errorMessage: message,
        });
    }

    async skipPendingValidationStages(batchId: bigint, reason: string): Promise<void> {
        await this.prisma.$executeRaw`
            UPDATE system.system_publish_stage_logs
            SET
                stage_status = 'skipped',
                message = ${reason},
                finished_at = now()
            WHERE publish_batch_id = ${batchId}
              AND stage_status = 'pending'
        `;
    }

    async failRunningValidationStages(
        batchId: bigint,
        reason: "cancelled" | "stale_worker",
        message: string
    ): Promise<void> {
        const detailsJson = JSON.stringify({
            process_state: reason,
            validation_aborted: true,
        });
        await this.prisma.$executeRaw`
            UPDATE system.system_publish_stage_logs
            SET
                stage_status = 'failed',
                message = ${message},
                finished_at = now(),
                details = coalesce(details, '{}'::jsonb) || ${detailsJson}::jsonb
            WHERE publish_batch_id = ${batchId}
              AND stage_status = 'running'
        `;
    }

    async finalizeValidationAborted(
        batchId: bigint,
        reason: "cancelled" | "stale_worker"
    ): Promise<void> {
        const logsSummary =
            reason === "cancelled"
                ? "Validation cancelled."
                : "Validation stopped: no worker heartbeat (stale_worker). Use reset-validation to try again.";
        const summary = JSON.stringify({
            validation_status: reason === "cancelled" ? "cancelled" : "failed",
            validation_outcome: reason,
            validation_cancelled: reason === "cancelled",
            validation_aborted: true,
            validation_logs_summary: logsSummary,
        });
        const stageMessage =
            reason === "cancelled"
                ? "Validation cancelled."
                : "Validation worker stopped responding (stale_worker).";

        await this.failRunningValidationStages(batchId, reason, stageMessage);
        await this.skipPendingValidationStages(batchId, "Skipped (validation aborted).");

        const nextStatus = reason === "cancelled" ? "cancelled" : "failed";
        const hasControlColumns = await this.useValidationControlColumns();
        if (hasControlColumns) {
            await this.prisma.$executeRaw`
                UPDATE system.system_publish_batches
                SET
                    status = ${nextStatus},
                    validation_cancel_requested_at = NULL,
                    summary = coalesce(summary, '{}'::jsonb) || ${summary}::jsonb
                WHERE id = ${batchId}
            `;
        } else {
            await this.prisma.$executeRaw`
                UPDATE system.system_publish_batches
                SET
                    status = ${nextStatus},
                    summary = coalesce(summary, '{}'::jsonb) || ${summary}::jsonb
                WHERE id = ${batchId}
            `;
        }
    }

    async failStaleValidationBatch(batchId: bigint): Promise<void> {
        await this.finalizeValidationAborted(batchId, "stale_worker");
    }

    /** @deprecated Use finalizeValidationAborted(batchId, "cancelled") */
    async finishValidationCancelled(batchId: bigint): Promise<void> {
        await this.finalizeValidationAborted(batchId, "cancelled");
    }

    async resetValidationState(batchId: bigint): Promise<void> {
        await this.prisma.$executeRaw`
            UPDATE system.system_publish_items
            SET
                validation_result = '{}'::jsonb,
                error_message = NULL
            WHERE publish_batch_id = ${batchId}
        `;
        await this.clearStageLogs(batchId);
        const resetDetails = JSON.stringify({
            action: "reset_validation",
            reset_at: new Date().toISOString(),
        });
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
                ${batchId},
                'load_batch',
                'Validation reset',
                'skipped',
                'Validation state was reset to draft.',
                0,
                ${resetDetails}::jsonb,
                now(),
                now()
            )
        `;
        const summaryPatch = JSON.stringify({
            validation_result: null,
            validation_logs_summary: null,
            validation_error: null,
            validation_outcome: null,
            validation_cancelled: null,
            validation_aborted: null,
            promotion_status: null,
            promotion_result: null,
            promotion_logs_summary: null,
        });
        const hasControlColumns = await this.useValidationControlColumns();
        if (hasControlColumns) {
            await this.prisma.$executeRaw`
                UPDATE system.system_publish_batches
                SET
                    status = 'draft',
                    validation_total = 0,
                    validation_done = 0,
                    validation_percent = 0,
                    validated_at = NULL,
                    validation_cancel_requested_at = NULL,
                    validation_heartbeat_at = NULL,
                    promoted_at = NULL,
                    summary = coalesce(summary, '{}'::jsonb) || ${summaryPatch}::jsonb
                WHERE id = ${batchId}
            `;
        } else {
            await this.prisma.$executeRaw`
                UPDATE system.system_publish_batches
                SET
                    status = 'draft',
                    validation_total = 0,
                    validation_done = 0,
                    validation_percent = 0,
                    validated_at = NULL,
                    promoted_at = NULL,
                    summary = coalesce(summary, '{}'::jsonb) || ${summaryPatch}::jsonb
                WHERE id = ${batchId}
            `;
        }
    }

    async finalizeBatch(args: {
        batchId: bigint;
        status: "ready" | "partial" | "blocked" | "failed" | "cancelled";
        validationTotal: number;
        summary: Record<string, unknown>;
    }): Promise<void> {
        const summaryJson = JSON.stringify(args.summary);
        await this.prisma.$executeRaw`
            UPDATE system.system_publish_batches
            SET
                status = ${args.status},
                validation_total = ${args.validationTotal},
                validation_done = ${args.validationTotal},
                validation_percent = 100,
                validated_at = now(),
                summary = coalesce(summary, '{}'::jsonb) || ${summaryJson}::jsonb
            WHERE id = ${args.batchId}
        `;
    }

    async persistItemValidationResults(
        results: {
            publishItemId: bigint;
            status: string;
            validationJson: Record<string, unknown>;
            errorMessage: string | null;
        }[]
    ): Promise<void> {
        if (results.length === 0) {
            return;
        }

        for (const chunk of chunkArray(results, 500)) {
            const payload = chunk.map((row) => ({
                publish_item_id: row.publishItemId.toString(),
                validation_json: row.validationJson,
                error_message: row.errorMessage,
            }));
            await this.prisma.$executeRaw`
                UPDATE system.system_publish_items AS spi
                SET
                    validation_result = rec.validation_json,
                    error_message = rec.error_message
                FROM jsonb_to_recordset(${JSON.stringify(payload)}::jsonb) AS rec(
                    publish_item_id bigint,
                    validation_json jsonb,
                    error_message text
                )
                WHERE spi.id = rec.publish_item_id
            `;
        }
    }

    async fetchItemActionCounts(batchId: bigint): Promise<{
        insert: number;
        update: number;
        merge: number;
        buildings: number;
    }> {
        const rows = await this.prisma.$queryRaw<
            { insert: bigint; update: bigint; merge: bigint; buildings: bigint }[]
        >`
            SELECT
                count(*) FILTER (WHERE publish_action = 'insert')::bigint AS insert,
                count(*) FILTER (WHERE publish_action = 'update')::bigint AS update,
                count(*) FILTER (WHERE publish_action = 'merge')::bigint AS merge,
                count(*) FILTER (WHERE entity_family = 'buildings')::bigint AS buildings
            FROM system.system_publish_items
            WHERE publish_batch_id = ${batchId}
        `;
        const r = rows[0];
        return {
            insert: Number(r?.insert ?? 0n),
            update: Number(r?.update ?? 0n),
            merge: Number(r?.merge ?? 0n),
            buildings: Number(r?.buildings ?? 0n),
        };
    }
}

function chunkArray<T>(arr: T[], size: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += size) {
        out.push(arr.slice(i, i + size));
    }
    return out;
}
