import { Prisma, type PrismaClient } from "@prisma/client";

import type { ImportTransportPromoteItemResult } from "./import-transport-promotion-promote.types.js";

const CORE_SCHEMA = "core_transport";
const VALID_CORE_VERIFICATION_STATUSES = [
    "unverified",
    "verified",
    "needs_fix",
    "questionable",
    "rejected_after_core_review",
] as const;

function verificationStatusSql(alias: string): Prisma.Sql {
    const allowed = VALID_CORE_VERIFICATION_STATUSES.map((s) => `'${s}'`).join(", ");
    return Prisma.sql`
        CASE
            WHEN coalesce(nullif(trim(${Prisma.raw(`${alias}.normalized_data`)}->>'verification_status'), ''), '')
                IN (${Prisma.raw(allowed)})
            THEN nullif(trim(${Prisma.raw(`${alias}.normalized_data`)}->>'verification_status'), '')
            ELSE 'unverified'
        END
    `;
}

function mergedSourceRefsSql(alias: string, importBatchId: bigint, promotionBatchId: bigint): Prisma.Sql {
    return Prisma.sql`
        coalesce(${Prisma.raw(`${alias}.source_refs`)}, '{}'::jsonb)
        || jsonb_build_object(
            'import_transport_batch_id', ${importBatchId}::text,
            'promotion_batch_id', ${promotionBatchId}::text,
            'raw_entity_id', ${Prisma.raw(`${alias}.id`)}::text
        )
    `;
}

function locationTypeSql(alias: string): Prisma.Sql {
    return Prisma.sql`
        CASE
            WHEN ${Prisma.raw(`${alias}.location_type`)} ~ '^[0-4]$'
            THEN ${Prisma.raw(`${alias}.location_type`)}::smallint
            ELSE 0::smallint
        END
    `;
}

export class ImportTransportPromotionPromoteRepository {
    constructor(private readonly prisma: PrismaClient) {}

    async listPromotableItems(batchId: bigint, entityKind: string) {
        return this.prisma.$queryRaw<
            {
                id: bigint;
                entity_kind: string;
                raw_entity_id: bigint;
                item_validation_status: string;
                promotion_status: string;
                promoted_target_id: bigint | null;
            }[]
        >`
            SELECT
                id,
                entity_kind,
                raw_entity_id,
                item_validation_status,
                promotion_status,
                promoted_target_id
            FROM import_transport.promotion_items
            WHERE promotion_batch_id = ${batchId}
              AND entity_kind = ${entityKind}
              AND item_validation_status IN ('valid', 'warning')
            ORDER BY raw_entity_id ASC
        `;
    }

    async claimBatchForPromotion(batchId: bigint): Promise<boolean> {
        const rows = await this.prisma.$queryRaw<{ id: bigint }[]>`
            UPDATE import_transport.promotion_batches
            SET promotion_status = 'promoting',
                updated_at = now()
            WHERE id = ${batchId}
              AND promotion_status IN ('ready', 'failed')
            RETURNING id
        `;
        return rows.length > 0;
    }

    async finalizeBatchPromotion(args: {
        batchId: bigint;
        promotionStatus: string;
        summaryPatch: Record<string, unknown>;
        errorMessage?: string | null;
    }): Promise<void> {
        await this.prisma.$executeRaw`
            UPDATE import_transport.promotion_batches
            SET promotion_status = ${args.promotionStatus},
                summary = coalesce(summary, '{}'::jsonb) || ${JSON.stringify(args.summaryPatch)}::jsonb,
                error_message = ${args.errorMessage ?? null},
                promoted_at = CASE WHEN ${args.promotionStatus} = 'promoted' THEN now() ELSE promoted_at END,
                updated_at = now()
            WHERE id = ${args.batchId}
        `;
    }

    async insertItemPromotionLog(args: {
        batchId: bigint;
        stageKey: string;
        stageLabel: string;
        stageStatus: string;
        message: string;
        details: Record<string, unknown>;
    }): Promise<void> {
        await this.prisma.$executeRaw`
            INSERT INTO import_transport.promotion_stage_logs (
                promotion_batch_id,
                stage_key,
                stage_label,
                stage_status,
                message,
                progress_percent,
                details,
                finished_at
            )
            VALUES (
                ${args.batchId},
                ${args.stageKey},
                ${args.stageLabel},
                ${args.stageStatus},
                ${args.message},
                100,
                ${JSON.stringify(args.details)}::jsonb,
                now()
            )
        `;
    }

    async promoteRouteItem(args: {
        promotionBatchId: bigint;
        importBatchId: bigint;
        promotionItemId: bigint;
        rawEntityId: bigint;
    }): Promise<ImportTransportPromoteItemResult> {
        return this.prisma.$transaction(async (tx) => {
            const existing = await tx.$queryRaw<{ promoted_core_id: bigint | null }[]>`
                SELECT promoted_core_id
                FROM import_transport.raw_routes
                WHERE id = ${args.rawEntityId}
                  AND import_batch_id = ${args.importBatchId}
                LIMIT 1
            `;
            const existingCoreId = existing[0]?.promoted_core_id;
            if (existingCoreId != null) {
                const coreExists = await tx.$queryRaw<{ id: bigint }[]>`
                    SELECT id FROM core_transport.routes
                    WHERE id = ${existingCoreId}
                      AND coalesce(is_active, true)
                    LIMIT 1
                `;
                if (coreExists.length > 0) {
                    await this.markItemPromoted(tx, {
                        promotionItemId: args.promotionItemId,
                        coreTable: "routes",
                        coreId: existingCoreId,
                        rawTable: "raw_routes",
                        rawEntityId: args.rawEntityId,
                    });
                    await this.writeItemLog(tx, args.promotionBatchId, "route", args.promotionItemId, "skipped", {
                        reason: "already_promoted",
                        promoted_target_id: existingCoreId.toString(),
                    });
                    return this.itemResult(args, "route", "skipped", existingCoreId, null);
                }
            }

            const inserted = await tx.$queryRaw<{ id: bigint }[]>`
                WITH src AS (
                    SELECT r.*
                    FROM import_transport.raw_routes AS r
                    WHERE r.id = ${args.rawEntityId}
                      AND r.import_batch_id = ${args.importBatchId}
                    LIMIT 1
                ),
                operator AS (
                    SELECT id FROM core_transport.operators
                    WHERE operator_code = 'ybs'
                    LIMIT 1
                ),
                existing_core AS (
                    SELECT c.id
                    FROM core_transport.routes AS c
                    INNER JOIN src ON c.external_id = coalesce(nullif(trim(src.external_id), ''), src.source_route_id)
                    WHERE coalesce(c.is_active, true)
                    LIMIT 1
                ),
                ins AS (
                    INSERT INTO core_transport.routes (
                        operator_id,
                        route_code,
                        public_name,
                        route_type,
                        directionality,
                        external_id,
                        confidence_score,
                        verification_status,
                        source_refs,
                        normalized_data,
                        is_active,
                        is_verified
                    )
                    SELECT
                        operator.id,
                        coalesce(nullif(trim(src.route_code), ''), src.source_route_id),
                        coalesce(nullif(trim(src.public_name), ''), nullif(trim(src.route_name), ''), src.source_route_id),
                        coalesce(nullif(trim(src.route_type), ''), src.transport_mode, 'local_bus'),
                        src.directionality,
                        coalesce(nullif(trim(src.external_id), ''), src.source_route_id),
                        src.confidence_score,
                        ${verificationStatusSql("src")},
                        ${mergedSourceRefsSql("src", args.importBatchId, args.promotionBatchId)},
                        coalesce(src.normalized_data, '{}'::jsonb),
                        true,
                        false
                    FROM src
                    CROSS JOIN operator
                    WHERE NOT EXISTS (SELECT 1 FROM existing_core)
                    RETURNING id
                ),
                chosen AS (
                    SELECT id FROM ins
                    UNION ALL
                    SELECT id FROM existing_core
                )
                SELECT id FROM chosen LIMIT 1
            `;

            const coreId = inserted[0]?.id;
            if (coreId == null) {
                await this.markItemFailed(tx, args.promotionItemId, "Route promotion failed: missing operator or invalid route data.");
                await this.writeItemLog(tx, args.promotionBatchId, "route", args.promotionItemId, "failed", {
                    raw_entity_id: args.rawEntityId.toString(),
                });
                return this.itemResult(
                    args,
                    "route",
                    "failed",
                    null,
                    "Route promotion failed: missing operator or invalid route data."
                );
            }

            await this.markItemPromoted(tx, {
                promotionItemId: args.promotionItemId,
                coreTable: "routes",
                coreId,
                rawTable: "raw_routes",
                rawEntityId: args.rawEntityId,
            });
            await this.writeItemLog(tx, args.promotionBatchId, "route", args.promotionItemId, "success", {
                promoted_target_id: coreId.toString(),
            });
            return this.itemResult(args, "route", "promoted", coreId, null);
        });
    }

    async promoteStopItem(args: {
        promotionBatchId: bigint;
        importBatchId: bigint;
        promotionItemId: bigint;
        rawEntityId: bigint;
    }): Promise<ImportTransportPromoteItemResult> {
        return this.prisma.$transaction(async (tx) => {
            const existing = await tx.$queryRaw<{ promoted_core_id: bigint | null }[]>`
                SELECT promoted_core_id
                FROM import_transport.raw_stops
                WHERE id = ${args.rawEntityId}
                  AND import_batch_id = ${args.importBatchId}
                LIMIT 1
            `;
            const existingCoreId = existing[0]?.promoted_core_id;
            if (existingCoreId != null) {
                const coreExists = await tx.$queryRaw<{ id: bigint }[]>`
                    SELECT id FROM core_transport.stops
                    WHERE id = ${existingCoreId}
                      AND coalesce(is_active, true)
                    LIMIT 1
                `;
                if (coreExists.length > 0) {
                    await this.markItemPromoted(tx, {
                        promotionItemId: args.promotionItemId,
                        coreTable: "stops",
                        coreId: existingCoreId,
                        rawTable: "raw_stops",
                        rawEntityId: args.rawEntityId,
                    });
                    await this.writeItemLog(tx, args.promotionBatchId, "stop", args.promotionItemId, "skipped", {
                        reason: "already_promoted",
                    });
                    return this.itemResult(args, "stop", "skipped", existingCoreId, null);
                }
            }

            const inserted = await tx.$queryRaw<{ id: bigint }[]>`
                WITH src AS (
                    SELECT s.*
                    FROM import_transport.raw_stops AS s
                    WHERE s.id = ${args.rawEntityId}
                      AND s.import_batch_id = ${args.importBatchId}
                    LIMIT 1
                ),
                existing_core AS (
                    SELECT c.id
                    FROM core_transport.stops AS c
                    INNER JOIN src ON c.external_id = coalesce(nullif(trim(src.external_id), ''), src.source_stop_id)
                    WHERE coalesce(c.is_active, true)
                    LIMIT 1
                ),
                ins AS (
                    INSERT INTO core_transport.stops (
                        stop_code,
                        name,
                        name_local,
                        stop_type,
                        location_type,
                        geom,
                        external_id,
                        confidence_score,
                        verification_status,
                        source_refs,
                        normalized_data,
                        is_active,
                        is_verified
                    )
                    SELECT
                        nullif(trim(src.stop_code), ''),
                        coalesce(nullif(trim(src.stop_name), ''), src.source_stop_id),
                        nullif(trim(src.stop_name_local), ''),
                        'bus_stop',
                        ${locationTypeSql("src")},
                        src.geom,
                        coalesce(nullif(trim(src.external_id), ''), src.source_stop_id),
                        src.confidence_score,
                        ${verificationStatusSql("src")},
                        ${mergedSourceRefsSql("src", args.importBatchId, args.promotionBatchId)},
                        coalesce(src.normalized_data, '{}'::jsonb),
                        true,
                        false
                    FROM src
                    WHERE src.geom IS NOT NULL
                      AND ST_IsValid(src.geom)
                      AND NOT ST_IsEmpty(src.geom)
                      AND NOT EXISTS (SELECT 1 FROM existing_core)
                    RETURNING id
                ),
                chosen AS (
                    SELECT id FROM ins
                    UNION ALL
                    SELECT id FROM existing_core
                )
                SELECT id FROM chosen LIMIT 1
            `;

            const coreId = inserted[0]?.id;
            if (coreId == null) {
                const message = "Stop promotion failed: missing or invalid geometry.";
                await this.markItemFailed(tx, args.promotionItemId, message);
                await this.writeItemLog(tx, args.promotionBatchId, "stop", args.promotionItemId, "failed", {
                    raw_entity_id: args.rawEntityId.toString(),
                });
                return this.itemResult(args, "stop", "failed", null, message);
            }

            await this.markItemPromoted(tx, {
                promotionItemId: args.promotionItemId,
                coreTable: "stops",
                coreId,
                rawTable: "raw_stops",
                rawEntityId: args.rawEntityId,
            });
            await this.writeItemLog(tx, args.promotionBatchId, "stop", args.promotionItemId, "success", {
                promoted_target_id: coreId.toString(),
            });
            return this.itemResult(args, "stop", "promoted", coreId, null);
        });
    }

    async promoteVariantItem(args: {
        promotionBatchId: bigint;
        importBatchId: bigint;
        promotionItemId: bigint;
        rawEntityId: bigint;
    }): Promise<ImportTransportPromoteItemResult> {
        return this.prisma.$transaction(async (tx) => {
            const existing = await tx.$queryRaw<{ promoted_core_id: bigint | null }[]>`
                SELECT promoted_core_id
                FROM import_transport.raw_route_variants
                WHERE id = ${args.rawEntityId}
                  AND import_batch_id = ${args.importBatchId}
                LIMIT 1
            `;
            const existingCoreId = existing[0]?.promoted_core_id;
            if (existingCoreId != null) {
                const coreExists = await tx.$queryRaw<{ id: bigint }[]>`
                    SELECT id FROM core_transport.route_variants
                    WHERE id = ${existingCoreId}
                      AND coalesce(is_active, true)
                    LIMIT 1
                `;
                if (coreExists.length > 0) {
                    await this.markItemPromoted(tx, {
                        promotionItemId: args.promotionItemId,
                        coreTable: "route_variants",
                        coreId: existingCoreId,
                        rawTable: "raw_route_variants",
                        rawEntityId: args.rawEntityId,
                    });
                    await this.writeItemLog(tx, args.promotionBatchId, "route_variant", args.promotionItemId, "skipped", {
                        reason: "already_promoted",
                    });
                    return this.itemResult(args, "route_variant", "skipped", existingCoreId, null);
                }
            }

            const inserted = await tx.$queryRaw<{ id: bigint }[]>`
                WITH src AS (
                    SELECT v.*, r.promoted_core_id AS core_route_id
                    FROM import_transport.raw_route_variants AS v
                    INNER JOIN import_transport.raw_routes AS r
                        ON r.id = v.raw_route_id
                       AND r.import_batch_id = v.import_batch_id
                    WHERE v.id = ${args.rawEntityId}
                      AND v.import_batch_id = ${args.importBatchId}
                    LIMIT 1
                ),
                existing_core AS (
                    SELECT rv.id
                    FROM core_transport.route_variants AS rv
                    INNER JOIN src ON rv.route_id = src.core_route_id
                      AND rv.variant_code = coalesce(nullif(trim(src.variant_code), ''), src.source_variant_id)
                    WHERE coalesce(rv.is_active, true)
                    LIMIT 1
                ),
                ins AS (
                    INSERT INTO core_transport.route_variants (
                        route_id,
                        variant_code,
                        direction_name,
                        origin_name,
                        destination_name,
                        geom,
                        distance_m,
                        confidence_score,
                        verification_status,
                        source_refs,
                        normalized_data,
                        is_active,
                        is_verified
                    )
                    SELECT
                        src.core_route_id,
                        coalesce(nullif(trim(src.variant_code), ''), src.source_variant_id),
                        nullif(trim(src.direction_name), ''),
                        nullif(trim(src.origin_name), ''),
                        nullif(trim(src.destination_name), ''),
                        src.geom,
                        src.distance_m,
                        src.confidence_score,
                        ${verificationStatusSql("src")},
                        ${mergedSourceRefsSql("src", args.importBatchId, args.promotionBatchId)},
                        coalesce(src.normalized_data, '{}'::jsonb),
                        true,
                        false
                    FROM src
                    WHERE src.core_route_id IS NOT NULL
                      AND NOT EXISTS (SELECT 1 FROM existing_core)
                    RETURNING id
                ),
                chosen AS (
                    SELECT id FROM ins
                    UNION ALL
                    SELECT id FROM existing_core
                )
                SELECT id FROM chosen LIMIT 1
            `;

            const coreId = inserted[0]?.id;
            if (coreId == null) {
                const message = "Variant promotion failed: parent route is not promoted or variant data is invalid.";
                await this.markItemFailed(tx, args.promotionItemId, message);
                await this.writeItemLog(tx, args.promotionBatchId, "route_variant", args.promotionItemId, "failed", {
                    raw_entity_id: args.rawEntityId.toString(),
                });
                return this.itemResult(args, "route_variant", "failed", null, message);
            }

            await this.markItemPromoted(tx, {
                promotionItemId: args.promotionItemId,
                coreTable: "route_variants",
                coreId,
                rawTable: "raw_route_variants",
                rawEntityId: args.rawEntityId,
            });
            await this.writeItemLog(tx, args.promotionBatchId, "route_variant", args.promotionItemId, "success", {
                promoted_target_id: coreId.toString(),
            });
            return this.itemResult(args, "route_variant", "promoted", coreId, null);
        });
    }

    async promoteRouteStopItem(args: {
        promotionBatchId: bigint;
        importBatchId: bigint;
        promotionItemId: bigint;
        rawEntityId: bigint;
    }): Promise<ImportTransportPromoteItemResult> {
        return this.prisma.$transaction(async (tx) => {
            const existing = await tx.$queryRaw<{ promoted_core_id: bigint | null }[]>`
                SELECT promoted_core_id
                FROM import_transport.raw_route_stops
                WHERE id = ${args.rawEntityId}
                  AND import_batch_id = ${args.importBatchId}
                LIMIT 1
            `;
            const existingCoreId = existing[0]?.promoted_core_id;
            if (existingCoreId != null) {
                const coreExists = await tx.$queryRaw<{ id: bigint }[]>`
                    SELECT id FROM core_transport.route_stops
                    WHERE id = ${existingCoreId}
                    LIMIT 1
                `;
                if (coreExists.length > 0) {
                    await this.markItemPromoted(tx, {
                        promotionItemId: args.promotionItemId,
                        coreTable: "route_stops",
                        coreId: existingCoreId,
                        rawTable: "raw_route_stops",
                        rawEntityId: args.rawEntityId,
                    });
                    await this.writeItemLog(tx, args.promotionBatchId, "route_stop", args.promotionItemId, "skipped", {
                        reason: "already_promoted",
                    });
                    return this.itemResult(args, "route_stop", "skipped", existingCoreId, null);
                }
            }

            const inserted = await tx.$queryRaw<{ id: bigint }[]>`
                WITH src AS (
                    SELECT
                        rs.*,
                        v.promoted_core_id AS core_variant_id,
                        s.promoted_core_id AS core_stop_id
                    FROM import_transport.raw_route_stops AS rs
                    INNER JOIN import_transport.raw_route_variants AS v
                        ON v.id = rs.raw_route_variant_id
                       AND v.import_batch_id = rs.import_batch_id
                    INNER JOIN import_transport.raw_stops AS s
                        ON s.id = rs.raw_stop_id
                       AND s.import_batch_id = rs.import_batch_id
                    WHERE rs.id = ${args.rawEntityId}
                      AND rs.import_batch_id = ${args.importBatchId}
                    LIMIT 1
                ),
                existing_core AS (
                    SELECT rs.id
                    FROM core_transport.route_stops AS rs
                    INNER JOIN src ON rs.route_variant_id = src.core_variant_id
                      AND rs.stop_id = src.core_stop_id
                      AND rs.stop_sequence = src.stop_sequence
                    LIMIT 1
                ),
                ins AS (
                    INSERT INTO core_transport.route_stops (
                        route_variant_id,
                        stop_id,
                        stop_sequence,
                        distance_from_start_m,
                        is_timing_point,
                        source_refs,
                        normalized_data
                    )
                    SELECT
                        src.core_variant_id,
                        src.core_stop_id,
                        src.stop_sequence,
                        src.distance_from_start_m,
                        coalesce(src.is_timing_point, false),
                        ${mergedSourceRefsSql("src", args.importBatchId, args.promotionBatchId)},
                        coalesce(src.normalized_data, '{}'::jsonb)
                    FROM src
                    WHERE src.core_variant_id IS NOT NULL
                      AND src.core_stop_id IS NOT NULL
                      AND NOT EXISTS (SELECT 1 FROM existing_core)
                    RETURNING id
                ),
                chosen AS (
                    SELECT id FROM ins
                    UNION ALL
                    SELECT id FROM existing_core
                )
                SELECT id FROM chosen LIMIT 1
            `;

            const coreId = inserted[0]?.id;
            if (coreId == null) {
                const message =
                    "Route stop promotion failed: parent variant/stop is not promoted or sequence is invalid.";
                await this.markItemFailed(tx, args.promotionItemId, message);
                await this.writeItemLog(tx, args.promotionBatchId, "route_stop", args.promotionItemId, "failed", {
                    raw_entity_id: args.rawEntityId.toString(),
                });
                return this.itemResult(args, "route_stop", "failed", null, message);
            }

            await this.markItemPromoted(tx, {
                promotionItemId: args.promotionItemId,
                coreTable: "route_stops",
                coreId,
                rawTable: "raw_route_stops",
                rawEntityId: args.rawEntityId,
            });
            await this.writeItemLog(tx, args.promotionBatchId, "route_stop", args.promotionItemId, "success", {
                promoted_target_id: coreId.toString(),
            });
            return this.itemResult(args, "route_stop", "promoted", coreId, null);
        });
    }

    private async markItemPromoted(
        tx: Prisma.TransactionClient,
        args: {
            promotionItemId: bigint;
            coreTable: string;
            coreId: bigint;
            rawTable: string;
            rawEntityId: bigint;
        }
    ): Promise<void> {
        await tx.$executeRaw`
            UPDATE import_transport.promotion_items
            SET promotion_status = 'promoted',
                promoted_target_schema = ${CORE_SCHEMA},
                promoted_target_table = ${args.coreTable},
                promoted_target_id = ${args.coreId},
                error_message = NULL,
                updated_at = now()
            WHERE id = ${args.promotionItemId}
        `;
        await tx.$executeRaw(
            Prisma.sql`
                UPDATE import_transport.${Prisma.raw(args.rawTable)}
                SET promotion_status = 'promoted',
                    promoted_core_id = ${args.coreId},
                    review_status = 'promoted',
                    updated_at = now()
                WHERE id = ${args.rawEntityId}
            `
        );
    }

    private async markItemFailed(
        tx: Prisma.TransactionClient,
        promotionItemId: bigint,
        errorMessage: string
    ): Promise<void> {
        await tx.$executeRaw`
            UPDATE import_transport.promotion_items
            SET promotion_status = 'failed',
                error_message = ${errorMessage},
                updated_at = now()
            WHERE id = ${promotionItemId}
        `;
    }

    private async writeItemLog(
        tx: Prisma.TransactionClient,
        batchId: bigint,
        entityKind: string,
        promotionItemId: bigint,
        stageStatus: string,
        details: Record<string, unknown>
    ): Promise<void> {
        await tx.$executeRaw`
            INSERT INTO import_transport.promotion_stage_logs (
                promotion_batch_id,
                stage_key,
                stage_label,
                stage_status,
                message,
                progress_percent,
                details,
                finished_at
            )
            VALUES (
                ${batchId},
                ${`promote_${entityKind}`},
                ${`Promote ${entityKind}`},
                ${stageStatus},
                ${`Promotion item ${promotionItemId.toString()}`},
                100,
                ${JSON.stringify({ promotion_item_id: promotionItemId.toString(), ...details })}::jsonb,
                now()
            )
        `;
    }

    private itemResult(
        args: { promotionItemId: bigint; rawEntityId: bigint },
        entityKind: string,
        outcome: ImportTransportPromoteItemResult["outcome"],
        coreId: bigint | null,
        errorMessage: string | null
    ): ImportTransportPromoteItemResult {
        return {
            promotion_item_id: args.promotionItemId.toString(),
            entity_kind: entityKind,
            raw_entity_id: args.rawEntityId.toString(),
            outcome,
            promoted_target_id: coreId?.toString() ?? null,
            error_message: errorMessage,
        };
    }
}
