import { Prisma, type PrismaClient } from "@prisma/client";

import type { ImportTransportFamily } from "./import-transport.config.js";
import {
    IMPORT_TRANSPORT_PROMOTION_VALIDATION_STAGES,
    type ImportTransportPromotionBatchProgressRow,
    type ImportTransportPromotionEntityValidationSummary,
    type ImportTransportPromotionItemValidationStatus,
    type ImportTransportPromotionStageLogRow,
    type ImportTransportPromotionValidationStageKey,
} from "./import-transport-promotion-validation.types.js";

export type PromotionBatchItemRow = {
    id: bigint;
    entity_kind: string;
    raw_entity_id: bigint;
    item_validation_status: string;
};

export type PromotableEntitySets = {
    promotedRoutes: Set<string>;
    promotedStops: Set<string>;
    promotedVariants: Set<string>;
    batchValidRoutes: Set<string>;
    batchValidStops: Set<string>;
    batchValidVariants: Set<string>;
};

const VALIDATABLE_BATCH_STATUSES = ["draft", "not_ready", "ready", "failed"] as const;

function mapStageLogRow(row: {
    id: bigint;
    promotion_batch_id: bigint;
    stage_key: string;
    stage_label: string;
    stage_status: string;
    message: string | null;
    progress_percent: number;
    details: unknown;
    started_at: Date;
    finished_at: Date | null;
}): ImportTransportPromotionStageLogRow {
    return {
        id: row.id.toString(),
        promotion_batch_id: row.promotion_batch_id.toString(),
        stage_key: row.stage_key,
        stage_label: row.stage_label,
        stage_status: row.stage_status,
        message: row.message,
        progress_percent: row.progress_percent,
        details:
            row.details != null && typeof row.details === "object" && !Array.isArray(row.details)
                ? (row.details as Record<string, unknown>)
                : {},
        started_at: row.started_at.toISOString(),
        finished_at: row.finished_at?.toISOString() ?? null,
    };
}

export class ImportTransportPromotionValidationRepository {
    constructor(private readonly prisma: PrismaClient) {}

    async fetchBatchProgress(batchId: bigint): Promise<
        (ImportTransportPromotionBatchProgressRow & {
            import_batch_id: string;
            summary: Record<string, unknown>;
        }) | null
    > {
        const rows = await this.prisma.$queryRaw<
            [
                {
                    id: bigint;
                    import_batch_id: bigint;
                    promotion_status: string;
                    validation_status: string;
                    can_promote: boolean;
                    validation_total: number;
                    validation_done: number;
                    validation_percent: number;
                    validated_at: Date | null;
                    summary: unknown;
                },
            ]
        >`
            SELECT
                id,
                import_batch_id,
                promotion_status,
                validation_status,
                can_promote,
                validation_total,
                validation_done,
                validation_percent::float8 AS validation_percent,
                validated_at,
                summary
            FROM import_transport.promotion_batches
            WHERE id = ${batchId}
            LIMIT 1
        `;
        const row = rows[0];
        if (!row) {
            return null;
        }
        return {
            id: row.id.toString(),
            import_batch_id: row.import_batch_id.toString(),
            promotion_status: row.promotion_status,
            validation_status: row.validation_status,
            can_promote: row.can_promote,
            validation_total: row.validation_total,
            validation_done: row.validation_done,
            validation_percent: Number(row.validation_percent),
            validated_at: row.validated_at?.toISOString() ?? null,
            summary:
                row.summary != null && typeof row.summary === "object" && !Array.isArray(row.summary)
                    ? (row.summary as Record<string, unknown>)
                    : {},
        };
    }

    async claimBatchForValidation(batchId: bigint): Promise<{ claimed: boolean; status: string | null }> {
        const rows = await this.prisma.$queryRaw<{ id: bigint; promotion_status: string }[]>`
            UPDATE import_transport.promotion_batches
            SET
                promotion_status = 'validating',
                validation_status = 'validating',
                validation_done = 0,
                validation_percent = 0,
                can_promote = false,
                validated_at = NULL
            WHERE id = ${batchId}
              AND promotion_status IN (${Prisma.join(VALIDATABLE_BATCH_STATUSES.map((s) => Prisma.sql`${s}`))})
            RETURNING id, promotion_status
        `;
        if (rows.length > 0) {
            return { claimed: true, status: "validating" };
        }
        const current = await this.fetchBatchProgress(batchId);
        return { claimed: false, status: current?.promotion_status ?? null };
    }

    async resetItemValidationStatuses(batchId: bigint): Promise<void> {
        await this.prisma.$executeRaw`
            UPDATE import_transport.promotion_items
            SET item_validation_status = 'pending',
                error_message = NULL,
                updated_at = now()
            WHERE promotion_batch_id = ${batchId}
        `;
    }

    async clearStageLogs(batchId: bigint): Promise<void> {
        await this.prisma.$executeRaw`
            DELETE FROM import_transport.promotion_stage_logs
            WHERE promotion_batch_id = ${batchId}
        `;
    }

    async seedStageLogs(batchId: bigint, stageKeys: ImportTransportPromotionValidationStageKey[]): Promise<void> {
        for (const stage of IMPORT_TRANSPORT_PROMOTION_VALIDATION_STAGES) {
            if (!stageKeys.includes(stage.key)) {
                continue;
            }
            await this.prisma.$executeRaw`
                INSERT INTO import_transport.promotion_stage_logs (
                    promotion_batch_id,
                    stage_key,
                    stage_label,
                    stage_status,
                    message,
                    progress_percent,
                    details
                )
                VALUES (
                    ${batchId},
                    ${stage.key},
                    ${stage.label},
                    'pending',
                    NULL,
                    0,
                    '{}'::jsonb
                )
            `;
        }
    }

    async updateStageLog(args: {
        batchId: bigint;
        stageKey: ImportTransportPromotionValidationStageKey;
        stageStatus: string;
        message?: string | null;
        progressPercent: number;
        details?: Record<string, unknown>;
        finished?: boolean;
    }): Promise<void> {
        const detailsJson = JSON.stringify(args.details ?? {});
        if (args.finished) {
            await this.prisma.$executeRaw`
                UPDATE import_transport.promotion_stage_logs
                SET
                    stage_status = ${args.stageStatus},
                    message = ${args.message ?? null},
                    progress_percent = ${args.progressPercent},
                    details = ${detailsJson}::jsonb,
                    finished_at = now()
                WHERE promotion_batch_id = ${args.batchId}
                  AND stage_key = ${args.stageKey}
            `;
        } else {
            await this.prisma.$executeRaw`
                UPDATE import_transport.promotion_stage_logs
                SET
                    stage_status = ${args.stageStatus},
                    message = ${args.message ?? null},
                    progress_percent = ${args.progressPercent},
                    details = ${detailsJson}::jsonb,
                    started_at = CASE WHEN stage_status = 'pending' THEN now() ELSE started_at END
                WHERE promotion_batch_id = ${args.batchId}
                  AND stage_key = ${args.stageKey}
            `;
        }
    }

    async listStageLogs(batchId: bigint): Promise<ImportTransportPromotionStageLogRow[]> {
        const rows = await this.prisma.$queryRaw<
            {
                id: bigint;
                promotion_batch_id: bigint;
                stage_key: string;
                stage_label: string;
                stage_status: string;
                message: string | null;
                progress_percent: number;
                details: unknown;
                started_at: Date;
                finished_at: Date | null;
            }[]
        >`
            SELECT
                id,
                promotion_batch_id,
                stage_key,
                stage_label,
                stage_status,
                message,
                progress_percent::float8 AS progress_percent,
                details,
                started_at,
                finished_at
            FROM import_transport.promotion_stage_logs
            WHERE promotion_batch_id = ${batchId}
            ORDER BY started_at ASC, id ASC
        `;
        return rows.map(mapStageLogRow);
    }

    async listBatchItems(batchId: bigint, entityKind?: string): Promise<PromotionBatchItemRow[]> {
        if (entityKind) {
            return this.prisma.$queryRaw<PromotionBatchItemRow[]>`
                SELECT id, entity_kind, raw_entity_id, item_validation_status
                FROM import_transport.promotion_items
                WHERE promotion_batch_id = ${batchId}
                  AND entity_kind = ${entityKind}
                ORDER BY raw_entity_id ASC
            `;
        }
        return this.prisma.$queryRaw<PromotionBatchItemRow[]>`
            SELECT id, entity_kind, raw_entity_id, item_validation_status
            FROM import_transport.promotion_items
            WHERE promotion_batch_id = ${batchId}
            ORDER BY entity_kind ASC, raw_entity_id ASC
        `;
    }

    async updatePromotionItemValidation(args: {
        itemId: bigint;
        itemValidationStatus: ImportTransportPromotionItemValidationStatus;
        errorMessage: string | null;
        details?: Record<string, unknown>;
    }): Promise<void> {
        const detailsJson = JSON.stringify(args.details ?? {});
        await this.prisma.$executeRaw`
            UPDATE import_transport.promotion_items
            SET item_validation_status = ${args.itemValidationStatus},
                error_message = ${args.errorMessage},
                details = coalesce(details, '{}'::jsonb) || ${detailsJson}::jsonb,
                updated_at = now()
            WHERE id = ${args.itemId}
        `;
    }

    async skipItemsForEntityKind(batchId: bigint, entityKind: string, message: string): Promise<number> {
        const rows = await this.prisma.$queryRaw<{ count: bigint }[]>`
            WITH updated AS (
                UPDATE import_transport.promotion_items
                SET item_validation_status = 'skipped',
                    error_message = ${message},
                    updated_at = now()
                WHERE promotion_batch_id = ${batchId}
                  AND entity_kind = ${entityKind}
                  AND item_validation_status = 'pending'
                RETURNING id
            )
            SELECT count(*)::bigint AS count FROM updated
        `;
        return Number(rows[0]?.count ?? 0n);
    }

    async fetchPromotableSets(importBatchId: bigint): Promise<PromotableEntitySets> {
        const [routes, stops, variants] = await Promise.all([
            this.prisma.$queryRaw<{ id: bigint }[]>`
                SELECT id FROM import_transport.raw_routes
                WHERE import_batch_id = ${importBatchId}
                  AND promotion_status = 'promoted'
            `,
            this.prisma.$queryRaw<{ id: bigint }[]>`
                SELECT id FROM import_transport.raw_stops
                WHERE import_batch_id = ${importBatchId}
                  AND promotion_status = 'promoted'
            `,
            this.prisma.$queryRaw<{ id: bigint }[]>`
                SELECT id FROM import_transport.raw_route_variants
                WHERE import_batch_id = ${importBatchId}
                  AND promotion_status = 'promoted'
            `,
        ]);
        return {
            promotedRoutes: new Set(routes.map((r) => r.id.toString())),
            promotedStops: new Set(stops.map((s) => s.id.toString())),
            promotedVariants: new Set(variants.map((v) => v.id.toString())),
            batchValidRoutes: new Set(),
            batchValidStops: new Set(),
            batchValidVariants: new Set(),
        };
    }

    async fetchVariantParentRouteId(
        importBatchId: bigint,
        variantId: bigint
    ): Promise<string | null> {
        const rows = await this.prisma.$queryRaw<{ raw_route_id: bigint | null }[]>`
            SELECT raw_route_id
            FROM import_transport.raw_route_variants
            WHERE import_batch_id = ${importBatchId}
              AND id = ${variantId}
            LIMIT 1
        `;
        const id = rows[0]?.raw_route_id;
        return id == null ? null : id.toString();
    }

    async fetchRouteStopParentIds(
        importBatchId: bigint,
        routeStopId: bigint
    ): Promise<{ raw_route_variant_id: string | null; raw_stop_id: string | null }> {
        const rows = await this.prisma.$queryRaw<
            [{ raw_route_variant_id: bigint | null; raw_stop_id: bigint | null }]
        >`
            SELECT raw_route_variant_id, raw_stop_id
            FROM import_transport.raw_route_stops
            WHERE import_batch_id = ${importBatchId}
              AND id = ${routeStopId}
            LIMIT 1
        `;
        const row = rows[0];
        return {
            raw_route_variant_id:
                row?.raw_route_variant_id == null ? null : row.raw_route_variant_id.toString(),
            raw_stop_id: row?.raw_stop_id == null ? null : row.raw_stop_id.toString(),
        };
    }

    async summarizeByEntity(batchId: bigint): Promise<ImportTransportPromotionEntityValidationSummary[]> {
        const rows = await this.prisma.$queryRaw<
            {
                entity_kind: string;
                pending: bigint;
                valid: bigint;
                warning: bigint;
                blocked: bigint;
                skipped: bigint;
            }[]
        >`
            SELECT
                entity_kind,
                count(*) FILTER (WHERE item_validation_status = 'pending')::bigint AS pending,
                count(*) FILTER (WHERE item_validation_status = 'valid')::bigint AS valid,
                count(*) FILTER (WHERE item_validation_status = 'warning')::bigint AS warning,
                count(*) FILTER (WHERE item_validation_status = 'blocked')::bigint AS blocked,
                count(*) FILTER (WHERE item_validation_status = 'skipped')::bigint AS skipped
            FROM import_transport.promotion_items
            WHERE promotion_batch_id = ${batchId}
            GROUP BY entity_kind
            ORDER BY entity_kind ASC
        `;

        const familyOrder: ImportTransportFamily[] = ["routes", "stops", "variants", "route_stops"];
        const kindToFamily: Record<string, ImportTransportFamily> = {
            route: "routes",
            stop: "stops",
            route_variant: "variants",
            route_stop: "route_stops",
        };

        const byFamily = new Map<ImportTransportFamily, ImportTransportPromotionEntityValidationSummary>();
        for (const family of familyOrder) {
            byFamily.set(family, {
                entity_family: family,
                pending: 0,
                valid: 0,
                warning: 0,
                blocked: 0,
                skipped: 0,
            });
        }

        for (const row of rows) {
            const family = kindToFamily[row.entity_kind];
            if (!family) {
                continue;
            }
            byFamily.set(family, {
                entity_family: family,
                pending: Number(row.pending),
                valid: Number(row.valid),
                warning: Number(row.warning),
                blocked: Number(row.blocked),
                skipped: Number(row.skipped),
            });
        }

        return familyOrder.map((family) => byFamily.get(family)!);
    }

    async updateBatchValidationResult(args: {
        batchId: bigint;
        validationTotal: number;
        validationDone: number;
        validationPercent: number;
        validationStatus: string;
        canPromote: boolean;
        promotionStatus: string;
    }): Promise<void> {
        await this.prisma.$executeRaw`
            UPDATE import_transport.promotion_batches
            SET validation_total = ${args.validationTotal},
                validation_done = ${args.validationDone},
                validation_percent = ${args.validationPercent},
                validation_status = ${args.validationStatus},
                can_promote = ${args.canPromote},
                promotion_status = ${args.promotionStatus},
                validated_at = now(),
                updated_at = now()
            WHERE id = ${args.batchId}
        `;
    }

    async countBatchItems(batchId: bigint): Promise<number> {
        const rows = await this.prisma.$queryRaw<{ count: bigint }[]>`
            SELECT count(*)::bigint AS count
            FROM import_transport.promotion_items
            WHERE promotion_batch_id = ${batchId}
        `;
        return Number(rows[0]?.count ?? 0n);
    }

    async listAllBatchItems(batchId: bigint): Promise<
        Array<{ item_validation_status: string; promotion_status: string }>
    > {
        return this.prisma.$queryRaw<
            Array<{ item_validation_status: string; promotion_status: string }>
        >`
            SELECT item_validation_status, promotion_status
            FROM import_transport.promotion_items
            WHERE promotion_batch_id = ${batchId}
        `;
    }
}
