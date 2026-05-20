import { Prisma, type PrismaClient } from "@prisma/client";

import {
    IMPORT_REVIEW_PUBLISH_VALIDATION_STAGES,
    type ImportReviewPublishBatchProgressRow,
    type ImportReviewPublishStageLogRow,
    type ImportReviewPublishValidationStageKey,
} from "./import-review-promotion-validation.types.js";
import { requireValidPublishStageStatus } from "./import-review-promotion-stage-status.js";

export const IMPORT_REVIEW_VALIDATION_CHUNK_SIZE = Math.max(
    10,
    Number.parseInt(process.env.IMPORT_REVIEW_VALIDATION_CHUNK_SIZE ?? "200", 10) || 200
);

const VALIDATABLE_BATCH_STATUSES = ["draft", "blocked", "failed", "ready"] as const;

export type PublishItemEntityRow = {
    id: bigint;
    entity_family: string;
};

export class ImportReviewPromotionValidationRepository {
    constructor(private readonly prisma: PrismaClient) {}

    getPrismaClient(): PrismaClient {
        return this.prisma;
    }

    async fetchBatchProgress(batchId: bigint): Promise<ImportReviewPublishBatchProgressRow | null> {
        const rows = await this.prisma.$queryRaw<ImportReviewPublishBatchProgressRow[]>`
            SELECT
                id,
                status,
                validation_total,
                validation_done,
                validation_percent::float8 AS validation_percent,
                validated_at,
                summary
            FROM system.system_publish_batches
            WHERE id = ${batchId}
            LIMIT 1
        `;
        return rows[0] ?? null;
    }

    async claimBatchForValidation(batchId: bigint): Promise<{ claimed: boolean; status: string | null }> {
        const rows = await this.prisma.$queryRaw<{ id: bigint; status: string }[]>`
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

    async failBatch(batchId: bigint, message: string): Promise<void> {
        const summary = JSON.stringify({ validation_error: message });
        await this.prisma.$executeRaw`
            UPDATE system.system_publish_batches
            SET status = 'failed', summary = coalesce(summary, '{}'::jsonb) || ${summary}::jsonb
            WHERE id = ${batchId}
        `;
    }

    async finalizeBatch(args: {
        batchId: bigint;
        status: "ready" | "blocked";
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
            issues: unknown[];
            errorMessage: string | null;
        }[]
    ): Promise<void> {
        for (const chunk of chunkArray(results, 100)) {
            for (const row of chunk) {
                const validationJson = JSON.stringify({ status: row.status, issues: row.issues });
                await this.prisma.$executeRaw`
                    UPDATE system.system_publish_items
                    SET
                        validation_result = ${validationJson}::jsonb,
                        error_message = ${row.errorMessage}
                    WHERE id = ${row.publishItemId}
                `;
            }
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
