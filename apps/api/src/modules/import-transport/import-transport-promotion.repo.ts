import { Prisma, type PrismaClient } from "@prisma/client";

import { IMPORT_TRANSPORT_FAMILIES, type ImportTransportFamily } from "./import-transport.config.js";
import {
    buildReadyEligibleWhereSql,
    familyAlias,
    familyFromClause,
    isAlreadyBatchedSql,
    isAlreadyPromotedSql,
    isApprovedNotPromotedSql,
    isBlockedValidationSql,
    isWarningEligibleSql,
    notInActivePromotionItemSql,
} from "./import-transport-promotion-ready.js";
import type {
    ImportTransportPromotionBatchDetailResponse,
    ImportTransportPromotionBatchListItem,
    ImportTransportPromotionReadyFamilyCounts,
} from "./import-transport-promotion.types.js";
import { IMPORT_TRANSPORT_FAMILY_ENTITY_KIND } from "./import-transport-validation.types.js";

type PromotionBatchRowDb = {
    id: bigint;
    public_id: string;
    import_batch_id: bigint;
    batch_name: string;
    target_schema: string;
    promotion_status: string;
    validation_status: string;
    can_promote: boolean;
    validation_total: number;
    validation_done: number;
    validation_percent: number;
    validated_at: Date | null;
    item_counts: unknown;
    summary: unknown;
    error_message: string | null;
    created_at: Date;
    updated_at: Date;
};

type PromotionItemRowDb = {
    id: bigint;
    entity_kind: string;
    raw_entity_id: bigint;
    promotion_status: string;
    match_status: string;
    item_validation_status: string;
    promoted_target_id: bigint | null;
    error_message: string | null;
    created_at: Date;
    updated_at: Date;
};

function mapBatchRow(row: PromotionBatchRowDb): ImportTransportPromotionBatchListItem {
    return {
        id: row.id.toString(),
        public_id: row.public_id,
        import_batch_id: row.import_batch_id.toString(),
        batch_name: row.batch_name,
        target_schema: row.target_schema,
        promotion_status: row.promotion_status,
        validation_status: row.validation_status,
        can_promote: row.can_promote,
        validation_total: row.validation_total,
        validation_done: row.validation_done,
        validation_percent: Number(row.validation_percent),
        validated_at: row.validated_at?.toISOString() ?? null,
        item_counts:
            row.item_counts != null && typeof row.item_counts === "object" && !Array.isArray(row.item_counts)
                ? (row.item_counts as Record<string, unknown>)
                : {},
        summary:
            row.summary != null && typeof row.summary === "object" && !Array.isArray(row.summary)
                ? (row.summary as Record<string, unknown>)
                : {},
        error_message: row.error_message,
        created_at: row.created_at.toISOString(),
        updated_at: row.updated_at.toISOString(),
    };
}

export class ImportTransportPromotionRepository {
    constructor(private readonly prisma: PrismaClient) {}

    async tableExists(qualifiedName: string): Promise<boolean> {
        const rows = await this.prisma.$queryRaw<{ ok: boolean }[]>`
            SELECT to_regclass(${qualifiedName}) IS NOT NULL AS ok
        `;
        return rows[0]?.ok === true;
    }

    async fetchFamilyReadyCounts(
        family: ImportTransportFamily,
        importBatchId: bigint,
        includeWarnings: boolean
    ): Promise<ImportTransportPromotionReadyFamilyCounts> {
        const fromClause = familyFromClause(family);
        const alias = familyAlias(family);
        if (!(await this.tableExists(fromClause))) {
            return {
                entity_family: family,
                ready: 0,
                with_warnings: 0,
                blocked: 0,
                already_promoted: 0,
                already_batched: 0,
            };
        }

        const rows = await this.prisma.$queryRaw<
            [
                {
                    ready: bigint;
                    with_warnings: bigint;
                    blocked: bigint;
                    already_promoted: bigint;
                    already_batched: bigint;
                },
            ]
        >(
            Prisma.sql`
                SELECT
                    count(*) FILTER (
                        WHERE ${isApprovedNotPromotedSql(alias)}
                          AND NOT ${isBlockedValidationSql(alias)}
                          AND ${Prisma.raw(`${alias}.validation_status`)} = 'valid'
                          AND ${notInActivePromotionItemSql(family, alias, importBatchId)}
                    )::bigint AS ready,
                    count(*) FILTER (
                        WHERE ${isApprovedNotPromotedSql(alias)}
                          AND NOT ${isBlockedValidationSql(alias)}
                          AND ${isWarningEligibleSql(alias)}
                          AND ${notInActivePromotionItemSql(family, alias, importBatchId)}
                    )::bigint AS with_warnings,
                    count(*) FILTER (
                        WHERE ${isApprovedNotPromotedSql(alias)}
                          AND ${isBlockedValidationSql(alias)}
                    )::bigint AS blocked,
                    count(*) FILTER (
                        WHERE ${isAlreadyPromotedSql(alias)}
                    )::bigint AS already_promoted,
                    count(*) FILTER (
                        WHERE ${isAlreadyBatchedSql(alias)}
                    )::bigint AS already_batched
                FROM ${Prisma.raw(fromClause)} AS ${Prisma.raw(alias)}
                WHERE ${Prisma.raw(`${alias}.import_batch_id`)} = ${importBatchId}
            `
        );

        const row = rows[0];
        return {
            entity_family: family,
            ready: Number(row?.ready ?? 0n),
            with_warnings: Number(row?.with_warnings ?? 0n),
            blocked: Number(row?.blocked ?? 0n),
            already_promoted: Number(row?.already_promoted ?? 0n),
            already_batched: Number(row?.already_batched ?? 0n),
        };
    }

    async insertPromotionItemsForFamily(args: {
        family: ImportTransportFamily;
        importBatchId: bigint;
        promotionBatchId: bigint;
        includeWarnings: boolean;
    }): Promise<{ itemsAdded: number; markedBatched: number }> {
        const fromClause = familyFromClause(args.family);
        const alias = familyAlias(args.family);
        const entityKind = IMPORT_TRANSPORT_FAMILY_ENTITY_KIND[args.family];
        const where = buildReadyEligibleWhereSql(args.family, args.importBatchId, args.includeWarnings);

        const inserted = await this.prisma.$queryRaw<{ count: bigint }[]>`
            WITH selected AS (
                SELECT ${Prisma.raw(`${alias}.id`)} AS raw_entity_id
                FROM ${Prisma.raw(fromClause)} AS ${Prisma.raw(alias)}
                WHERE ${where}
            ),
            inserted AS (
                INSERT INTO import_transport.promotion_items (
                    promotion_batch_id,
                    entity_kind,
                    raw_entity_id,
                    promotion_status,
                    match_status,
                    details
                )
                SELECT
                    ${args.promotionBatchId},
                    ${entityKind},
                    selected.raw_entity_id,
                    'pending',
                    'unmatched',
                    jsonb_build_object('source', 'import_transport_promotion_batch_create')
                FROM selected
                RETURNING raw_entity_id
            )
            SELECT count(*)::bigint AS count FROM inserted
        `;

        const itemsAdded = Number(inserted[0]?.count ?? 0n);
        if (itemsAdded === 0) {
            return { itemsAdded: 0, markedBatched: 0 };
        }

        const marked = await this.prisma.$executeRaw`
            UPDATE ${Prisma.raw(fromClause)} AS ${Prisma.raw(alias)}
            SET promotion_status = 'batched',
                updated_at = now()
            FROM import_transport.promotion_items AS pi
            WHERE pi.promotion_batch_id = ${args.promotionBatchId}
              AND pi.entity_kind = ${entityKind}
              AND pi.raw_entity_id = ${Prisma.raw(`${alias}.id`)}
              AND ${Prisma.raw(`${alias}.import_batch_id`)} = ${args.importBatchId}
        `;

        return { itemsAdded, markedBatched: marked };
    }

    async createPromotionBatchRecord(args: {
        importBatchId: bigint;
        batchName: string;
        itemCounts: Record<string, number>;
        summary: Record<string, unknown>;
    }): Promise<PromotionBatchRowDb> {
        const rows = await this.prisma.$queryRaw<PromotionBatchRowDb[]>`
            INSERT INTO import_transport.promotion_batches (
                import_batch_id,
                batch_name,
                target_schema,
                promotion_status,
                validation_status,
                item_counts,
                summary
            ) VALUES (
                ${args.importBatchId},
                ${args.batchName},
                'core_transport',
                'draft',
                'not_started',
                ${JSON.stringify(args.itemCounts)}::jsonb,
                ${JSON.stringify(args.summary)}::jsonb
            )
            RETURNING
                id,
                public_id::text AS public_id,
                import_batch_id,
                batch_name,
                target_schema,
                promotion_status,
                validation_status,
                can_promote,
                validation_total,
                validation_done,
                validation_percent,
                validated_at,
                item_counts,
                summary,
                error_message,
                created_at,
                updated_at
        `;
        const row = rows[0];
        if (!row) {
            throw new Error("Failed to create promotion batch");
        }
        return row;
    }

    async updatePromotionBatchItemCounts(
        promotionBatchId: bigint,
        itemCounts: Record<string, number>
    ): Promise<void> {
        await this.prisma.$executeRaw`
            UPDATE import_transport.promotion_batches
            SET item_counts = ${JSON.stringify(itemCounts)}::jsonb,
                updated_at = now()
            WHERE id = ${promotionBatchId}
        `;
    }

    async listPromotionBatches(input: {
        importBatchId?: bigint;
        limit: number;
        offset: number;
    }): Promise<{ items: ImportTransportPromotionBatchListItem[]; total: number }> {
        if (!(await this.tableExists("import_transport.promotion_batches"))) {
            return { items: [], total: 0 };
        }

        const filters: Prisma.Sql[] = [];
        if (input.importBatchId != null) {
            filters.push(Prisma.sql`import_batch_id = ${input.importBatchId}`);
        }
        const where = filters.length > 0 ? Prisma.sql`WHERE ${Prisma.join(filters, " AND ")}` : Prisma.empty;

        const totalRows = await this.prisma.$queryRaw<{ count: bigint }[]>`
            SELECT count(*)::bigint AS count
            FROM import_transport.promotion_batches
            ${where}
        `;

        const rows = await this.prisma.$queryRaw<PromotionBatchRowDb[]>`
            SELECT
                id,
                public_id::text AS public_id,
                import_batch_id,
                batch_name,
                target_schema,
                promotion_status,
                validation_status,
                can_promote,
                validation_total,
                validation_done,
                validation_percent,
                validated_at,
                item_counts,
                summary,
                error_message,
                created_at,
                updated_at
            FROM import_transport.promotion_batches
            ${where}
            ORDER BY created_at DESC, id DESC
            LIMIT ${input.limit} OFFSET ${input.offset}
        `;

        return {
            total: Number(totalRows[0]?.count ?? 0n),
            items: rows.map(mapBatchRow),
        };
    }

    async getPromotionBatchById(batchId: bigint): Promise<ImportTransportPromotionBatchDetailResponse | null> {
        if (!(await this.tableExists("import_transport.promotion_batches"))) {
            return null;
        }

        const rows = await this.prisma.$queryRaw<PromotionBatchRowDb[]>`
            SELECT
                id,
                public_id::text AS public_id,
                import_batch_id,
                batch_name,
                target_schema,
                promotion_status,
                validation_status,
                can_promote,
                validation_total,
                validation_done,
                validation_percent,
                validated_at,
                item_counts,
                summary,
                error_message,
                created_at,
                updated_at
            FROM import_transport.promotion_batches
            WHERE id = ${batchId}
            LIMIT 1
        `;
        const batch = rows[0];
        if (!batch) {
            return null;
        }

        const itemRows = await this.prisma.$queryRaw<PromotionItemRowDb[]>`
            SELECT
                id,
                entity_kind,
                raw_entity_id,
                promotion_status,
                match_status,
                item_validation_status,
                promoted_target_id,
                error_message,
                created_at,
                updated_at
            FROM import_transport.promotion_items
            WHERE promotion_batch_id = ${batchId}
            ORDER BY entity_kind ASC, raw_entity_id ASC
            LIMIT 500
        `;

        return {
            ...mapBatchRow(batch),
            items: itemRows.map((row) => ({
                id: row.id.toString(),
                entity_kind: row.entity_kind,
                raw_entity_id: row.raw_entity_id.toString(),
                promotion_status: row.promotion_status,
                match_status: row.match_status,
                item_validation_status: row.item_validation_status,
                promoted_target_id: row.promoted_target_id?.toString() ?? null,
                error_message: row.error_message,
                created_at: row.created_at.toISOString(),
                updated_at: row.updated_at.toISOString(),
            })),
        };
    }

    async importBatchExists(importBatchId: bigint): Promise<boolean> {
        if (!(await this.tableExists("import_transport.import_batches"))) {
            return false;
        }
        const rows = await this.prisma.$queryRaw<{ ok: boolean }[]>`
            SELECT EXISTS (
                SELECT 1 FROM import_transport.import_batches WHERE id = ${importBatchId}
            ) AS ok
        `;
        return rows[0]?.ok === true;
    }

    async deletePromotionBatch(batchId: bigint): Promise<void> {
        await this.prisma.$executeRaw`
            DELETE FROM import_transport.promotion_batches WHERE id = ${batchId}
        `;
    }

    familiesForMode(
        mode: "one_entity" | "all_entities",
        entityFamily: ImportTransportFamily | null
    ): ImportTransportFamily[] {
        if (mode === "one_entity" && entityFamily) {
            return [entityFamily];
        }
        return [...IMPORT_TRANSPORT_FAMILIES];
    }
}
