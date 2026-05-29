import { Prisma, type PrismaClient } from "@prisma/client";

import {
    getImportTransportFamilyConfig,
    IMPORT_TRANSPORT_FAMILIES,
    qualifiedImportTransportTable,
    type ImportTransportFamily,
} from "./import-transport.config.js";
import type {
    ImportTransportHistoryImportBatchesListQuery,
    ImportTransportHistoryPromotionBatchItemsQuery,
    ImportTransportHistoryPromotionBatchesListQuery,
} from "./import-transport-history.schema.js";
import type {
    ImportTransportHistoryEntityCounts,
    ImportTransportHistoryValidationCounts,
} from "./import-transport-history.types.js";

type ImportBatchHistoryRowDb = {
    id: bigint;
    public_id: string;
    batch_name: string;
    import_status: string;
    validation_status: string;
    source_snapshot_version: string | null;
    source_file_name: string | null;
    source_file_checksum: string | null;
    record_counts: unknown;
    summary: unknown;
    error_message: string | null;
    imported_at: Date | null;
    validated_at: Date | null;
    created_at: Date;
    updated_at: Date;
    source_dataset_id: bigint;
    dataset_code: string;
    dataset_name: string;
    dataset_transport_mode: string;
    dataset_source_format: string;
    dataset_provider_name: string | null;
    dataset_region_code: string | null;
    promotion_batch_count: bigint;
    latest_promoted_at: Date | null;
    latest_validated_at: Date | null;
};

type PromotionBatchHistoryRowDb = {
    id: bigint;
    public_id: string;
    import_batch_id: bigint;
    import_batch_name: string;
    batch_name: string;
    target_schema: string;
    promotion_status: string;
    validation_status: string;
    can_promote: boolean;
    item_counts: unknown;
    summary: unknown;
    error_message: string | null;
    created_at: Date;
    updated_at: Date;
    validated_at: Date | null;
    promoted_at: Date | null;
    dataset_code: string;
    dataset_name: string;
    dataset_transport_mode: string;
    dataset_source_format: string;
    dataset_provider_name: string | null;
    dataset_region_code: string | null;
    import_status: string;
    source_snapshot_version: string | null;
    source_dataset_id: bigint;
};

type PromotionItemHistoryRowDb = {
    id: bigint;
    entity_kind: string;
    raw_entity_id: bigint;
    promotion_status: string;
    item_validation_status: string;
    match_status: string;
    promoted_target_schema: string | null;
    promoted_target_table: string | null;
    promoted_target_id: bigint | null;
    promoted_core_id: bigint | null;
    error_message: string | null;
    created_at: Date;
    updated_at: Date;
};

const SOURCE_DATASET_JOIN = Prisma.sql`
    INNER JOIN import_transport.source_datasets AS sd
        ON sd.id = ib.source_dataset_id
`;

function importBatchListWhere(query: ImportTransportHistoryImportBatchesListQuery): Prisma.Sql {
    const parts: Prisma.Sql[] = [Prisma.sql`ib.import_status IS DISTINCT FROM 'archived'`];
    if (query.import_status) {
        parts.push(Prisma.sql`ib.import_status = ${query.import_status}`);
    }
    if (query.validation_status) {
        parts.push(Prisma.sql`ib.validation_status = ${query.validation_status}`);
    }
    if (query.source_dataset_code) {
        parts.push(Prisma.sql`sd.code = ${query.source_dataset_code}`);
    }
    if (query.source_snapshot_version) {
        parts.push(Prisma.sql`ib.source_snapshot_version = ${query.source_snapshot_version}`);
    }
    if (query.imported_after) {
        parts.push(Prisma.sql`coalesce(ib.imported_at, ib.created_at) >= ${new Date(query.imported_after)}`);
    }
    if (query.imported_before) {
        parts.push(Prisma.sql`coalesce(ib.imported_at, ib.created_at) <= ${new Date(query.imported_before)}`);
    }
    return Prisma.join(parts, " AND ");
}

function promotionBatchListWhere(query: ImportTransportHistoryPromotionBatchesListQuery): Prisma.Sql {
    const parts: Prisma.Sql[] = [Prisma.sql`TRUE`];
    if (query.import_batch_id != null) {
        parts.push(Prisma.sql`pb.import_batch_id = ${query.import_batch_id}`);
    }
    if (query.promotion_status) {
        parts.push(Prisma.sql`pb.promotion_status = ${query.promotion_status}`);
    }
    if (query.validation_status) {
        parts.push(Prisma.sql`pb.validation_status = ${query.validation_status}`);
    }
    if (query.mode) {
        parts.push(Prisma.sql`coalesce(pb.summary->>'mode', '') = ${query.mode}`);
    }
    if (query.entity_family) {
        parts.push(Prisma.sql`coalesce(pb.summary->>'entity_family', '') = ${query.entity_family}`);
    }
    if (query.created_after) {
        parts.push(Prisma.sql`pb.created_at >= ${new Date(query.created_after)}`);
    }
    if (query.created_before) {
        parts.push(Prisma.sql`pb.created_at <= ${new Date(query.created_before)}`);
    }
    return Prisma.join(parts, " AND ");
}

export class ImportTransportHistoryRepository {
    constructor(private readonly prisma: PrismaClient) {}

    async tableExists(qualifiedName: string): Promise<boolean> {
        const rows = await this.prisma.$queryRaw<{ ok: boolean }[]>`
            SELECT to_regclass(${qualifiedName}) IS NOT NULL AS ok
        `;
        return rows[0]?.ok === true;
    }

    async listImportBatches(
        query: ImportTransportHistoryImportBatchesListQuery
    ): Promise<{ rows: ImportBatchHistoryRowDb[]; total: bigint }> {
        if (!(await this.tableExists("import_transport.import_batches"))) {
            return { rows: [], total: 0n };
        }

        const where = importBatchListWhere(query);
        const totalRows = await this.prisma.$queryRaw<{ count: bigint }[]>`
            SELECT count(*)::bigint AS count
            FROM import_transport.import_batches AS ib
            ${SOURCE_DATASET_JOIN}
            WHERE ${where}
        `;

        const rows = await this.prisma.$queryRaw<ImportBatchHistoryRowDb[]>`
            SELECT
                ib.id,
                ib.public_id::text AS public_id,
                ib.batch_name,
                ib.import_status,
                ib.validation_status,
                ib.source_snapshot_version,
                ib.source_file_name,
                ib.source_file_checksum,
                ib.record_counts,
                ib.summary,
                ib.error_message,
                ib.imported_at,
                ib.validated_at,
                ib.created_at,
                ib.updated_at,
                ib.source_dataset_id,
                sd.code AS dataset_code,
                sd.name AS dataset_name,
                sd.transport_mode AS dataset_transport_mode,
                sd.source_format AS dataset_source_format,
                sd.provider_name AS dataset_provider_name,
                sd.region_code AS dataset_region_code,
                coalesce(pub.promotion_batch_count, 0)::bigint AS promotion_batch_count,
                pub.latest_promoted_at,
                pub.latest_validated_at
            FROM import_transport.import_batches AS ib
            ${SOURCE_DATASET_JOIN}
            LEFT JOIN LATERAL (
                SELECT
                    count(*)::bigint AS promotion_batch_count,
                    max(pb.promoted_at) AS latest_promoted_at,
                    max(pb.validated_at) AS latest_validated_at
                FROM import_transport.promotion_batches AS pb
                WHERE pb.import_batch_id = ib.id
            ) AS pub ON true
            WHERE ${where}
            ORDER BY ib.created_at DESC, ib.id DESC
            LIMIT ${query.limit} OFFSET ${query.offset}
        `;

        return { rows, total: totalRows[0]?.count ?? 0n };
    }

    async getImportBatchById(batchId: bigint): Promise<ImportBatchHistoryRowDb | null> {
        const rows = await this.prisma.$queryRaw<ImportBatchHistoryRowDb[]>`
            SELECT
                ib.id,
                ib.public_id::text AS public_id,
                ib.batch_name,
                ib.import_status,
                ib.validation_status,
                ib.source_snapshot_version,
                ib.source_file_name,
                ib.source_file_checksum,
                ib.record_counts,
                ib.summary,
                ib.error_message,
                ib.imported_at,
                ib.validated_at,
                ib.created_at,
                ib.updated_at,
                ib.source_dataset_id,
                sd.code AS dataset_code,
                sd.name AS dataset_name,
                sd.transport_mode AS dataset_transport_mode,
                sd.source_format AS dataset_source_format,
                sd.provider_name AS dataset_provider_name,
                sd.region_code AS dataset_region_code,
                coalesce(pub.promotion_batch_count, 0)::bigint AS promotion_batch_count,
                pub.latest_promoted_at,
                pub.latest_validated_at
            FROM import_transport.import_batches AS ib
            ${SOURCE_DATASET_JOIN}
            LEFT JOIN LATERAL (
                SELECT
                    count(*)::bigint AS promotion_batch_count,
                    max(pb.promoted_at) AS latest_promoted_at,
                    max(pb.validated_at) AS latest_validated_at
                FROM import_transport.promotion_batches AS pb
                WHERE pb.import_batch_id = ib.id
            ) AS pub ON true
            WHERE ib.id = ${batchId}
            LIMIT 1
        `;
        return rows[0] ?? null;
    }

    async fetchEntityCountsForBatch(importBatchId: bigint): Promise<ImportTransportHistoryEntityCounts[]> {
        const results: ImportTransportHistoryEntityCounts[] = [];
        for (const family of IMPORT_TRANSPORT_FAMILIES) {
            results.push(await this.fetchEntityCountsForFamily(family, importBatchId));
        }
        return results;
    }

    async fetchEntityCountsForFamily(
        family: ImportTransportFamily,
        importBatchId: bigint
    ): Promise<ImportTransportHistoryEntityCounts> {
        const qualified = qualifiedImportTransportTable(family);
        if (!(await this.tableExists(qualified))) {
            return emptyEntityCounts(family);
        }

        const cfg = getImportTransportFamilyConfig(family);
        const alias = cfg.alias;
        const reviewExpr =
            family === "route_stops"
                ? `COALESCE(NULLIF(BTRIM(${alias}.review_status), ''), NULLIF(BTRIM(${alias}.match_status), ''), 'pending')`
                : `COALESCE(NULLIF(BTRIM(${alias}.review_status), ''), NULLIF(BTRIM(${alias}.match_status), ''), 'pending')`;

        const rows = await this.prisma.$queryRaw<
            [
                {
                    total: bigint;
                    pending_review: bigint;
                    approved: bigint;
                    promoted: bigint;
                    validation_blocked: bigint;
                    validation_warning: bigint;
                    validation_valid: bigint;
                    validation_not_validated: bigint;
                },
            ]
        >(
            Prisma.sql`
                SELECT
                    count(*)::bigint AS total,
                    count(*) FILTER (
                        WHERE ${Prisma.raw(reviewExpr)} IN ('pending', 'needs_review', 'needs_more_review')
                    )::bigint AS pending_review,
                    count(*) FILTER (
                        WHERE ${Prisma.raw(reviewExpr)} = 'approved'
                    )::bigint AS approved,
                    count(*) FILTER (
                        WHERE ${Prisma.raw(reviewExpr)} = 'promoted'
                           OR coalesce(${Prisma.raw(`${alias}.promotion_status`)}, '') = 'promoted'
                    )::bigint AS promoted,
                    count(*) FILTER (
                        WHERE coalesce(${Prisma.raw(`${alias}.validation_status`)}, 'not_validated') = 'blocked'
                    )::bigint AS validation_blocked,
                    count(*) FILTER (
                        WHERE coalesce(${Prisma.raw(`${alias}.validation_status`)}, 'not_validated') = 'warning'
                    )::bigint AS validation_warning,
                    count(*) FILTER (
                        WHERE coalesce(${Prisma.raw(`${alias}.validation_status`)}, 'not_validated') = 'valid'
                    )::bigint AS validation_valid,
                    count(*) FILTER (
                        WHERE coalesce(${Prisma.raw(`${alias}.validation_status`)}, 'not_validated') IN ('not_validated', 'not_started', 'pending')
                    )::bigint AS validation_not_validated
                FROM ${Prisma.raw(qualified)} AS ${Prisma.raw(alias)}
                WHERE ${Prisma.raw(`${alias}.import_batch_id`)} = ${importBatchId}
            `
        );

        const row = rows[0];
        return {
            entity_family: family,
            total: Number(row?.total ?? 0n),
            pending_review: Number(row?.pending_review ?? 0n),
            approved: Number(row?.approved ?? 0n),
            promoted: Number(row?.promoted ?? 0n),
            validation_blocked: Number(row?.validation_blocked ?? 0n),
            validation_warning: Number(row?.validation_warning ?? 0n),
            validation_valid: Number(row?.validation_valid ?? 0n),
            validation_not_validated: Number(row?.validation_not_validated ?? 0n),
        };
    }

    async fetchValidationCounts(importBatchId: bigint): Promise<ImportTransportHistoryValidationCounts> {
        const entityCounts = await this.fetchEntityCountsForBatch(importBatchId);
        const candidate_blocked_count = entityCounts.reduce((sum, row) => sum + row.validation_blocked, 0);
        const candidate_warning_count = entityCounts.reduce((sum, row) => sum + row.validation_warning, 0);

        if (!(await this.tableExists("import_transport.validation_issues"))) {
            return {
                issue_blocked_count: 0,
                issue_warning_count: 0,
                candidate_blocked_count,
                candidate_warning_count,
            };
        }

        const rows = await this.prisma.$queryRaw<
            [{ issue_blocked_count: bigint; issue_warning_count: bigint }]
        >`
            SELECT
                count(*) FILTER (
                    WHERE severity IN ('error', 'critical')
                      AND issue_status IS DISTINCT FROM 'resolved'
                )::bigint AS issue_blocked_count,
                count(*) FILTER (
                    WHERE severity = 'warning'
                      AND issue_status IS DISTINCT FROM 'resolved'
                )::bigint AS issue_warning_count
            FROM import_transport.validation_issues
            WHERE import_batch_id = ${importBatchId}
        `;

        const row = rows[0];
        return {
            issue_blocked_count: Number(row?.issue_blocked_count ?? 0n),
            issue_warning_count: Number(row?.issue_warning_count ?? 0n),
            candidate_blocked_count,
            candidate_warning_count,
        };
    }

    async listPromotionBatchSummariesForImportBatch(importBatchId: bigint) {
        if (!(await this.tableExists("import_transport.promotion_batches"))) {
            return [];
        }

        const rows = await this.prisma.$queryRaw<
            {
                id: bigint;
                batch_name: string;
                promotion_status: string;
                validation_status: string;
                can_promote: boolean;
                created_at: Date;
                promoted_at: Date | null;
                validated_at: Date | null;
                promoted_count: bigint;
                failed_count: bigint;
                skipped_count: bigint;
            }[]
        >`
            SELECT
                pb.id,
                pb.batch_name,
                pb.promotion_status,
                pb.validation_status,
                pb.can_promote,
                pb.created_at,
                pb.promoted_at,
                pb.validated_at,
                count(*) FILTER (WHERE pi.promotion_status = 'promoted')::bigint AS promoted_count,
                count(*) FILTER (WHERE pi.promotion_status = 'failed')::bigint AS failed_count,
                count(*) FILTER (
                    WHERE pi.promotion_status = 'skipped'
                       OR pi.item_validation_status = 'skipped'
                )::bigint AS skipped_count
            FROM import_transport.promotion_batches AS pb
            LEFT JOIN import_transport.promotion_items AS pi
                ON pi.promotion_batch_id = pb.id
            WHERE pb.import_batch_id = ${importBatchId}
            GROUP BY pb.id
            ORDER BY pb.created_at DESC, pb.id DESC
        `;

        return rows;
    }

    async listPromotionBatches(
        query: ImportTransportHistoryPromotionBatchesListQuery
    ): Promise<{ rows: PromotionBatchHistoryRowDb[]; total: bigint }> {
        if (!(await this.tableExists("import_transport.promotion_batches"))) {
            return { rows: [], total: 0n };
        }

        const where = promotionBatchListWhere(query);
        const totalRows = await this.prisma.$queryRaw<{ count: bigint }[]>`
            SELECT count(*)::bigint AS count
            FROM import_transport.promotion_batches AS pb
            INNER JOIN import_transport.import_batches AS ib ON ib.id = pb.import_batch_id
            INNER JOIN import_transport.source_datasets AS sd ON sd.id = ib.source_dataset_id
            WHERE ${where}
        `;

        const rows = await this.prisma.$queryRaw<PromotionBatchHistoryRowDb[]>`
            SELECT
                pb.id,
                pb.public_id::text AS public_id,
                pb.import_batch_id,
                ib.batch_name AS import_batch_name,
                pb.batch_name,
                pb.target_schema,
                pb.promotion_status,
                pb.validation_status,
                pb.can_promote,
                pb.item_counts,
                pb.summary,
                pb.error_message,
                pb.created_at,
                pb.updated_at,
                pb.validated_at,
                pb.promoted_at,
                sd.code AS dataset_code,
                sd.name AS dataset_name,
                sd.transport_mode AS dataset_transport_mode,
                sd.source_format AS dataset_source_format,
                sd.provider_name AS dataset_provider_name,
                sd.region_code AS dataset_region_code,
                ib.import_status,
                ib.source_snapshot_version,
                ib.source_dataset_id
            FROM import_transport.promotion_batches AS pb
            INNER JOIN import_transport.import_batches AS ib ON ib.id = pb.import_batch_id
            INNER JOIN import_transport.source_datasets AS sd ON sd.id = ib.source_dataset_id
            WHERE ${where}
            ORDER BY pb.created_at DESC, pb.id DESC
            LIMIT ${query.limit} OFFSET ${query.offset}
        `;

        return { rows, total: totalRows[0]?.count ?? 0n };
    }

    async getPromotionBatchById(batchId: bigint): Promise<PromotionBatchHistoryRowDb | null> {
        const rows = await this.prisma.$queryRaw<PromotionBatchHistoryRowDb[]>`
            SELECT
                pb.id,
                pb.public_id::text AS public_id,
                pb.import_batch_id,
                ib.batch_name AS import_batch_name,
                pb.batch_name,
                pb.target_schema,
                pb.promotion_status,
                pb.validation_status,
                pb.can_promote,
                pb.item_counts,
                pb.summary,
                pb.error_message,
                pb.created_at,
                pb.updated_at,
                pb.validated_at,
                pb.promoted_at,
                sd.code AS dataset_code,
                sd.name AS dataset_name,
                sd.transport_mode AS dataset_transport_mode,
                sd.source_format AS dataset_source_format,
                sd.provider_name AS dataset_provider_name,
                sd.region_code AS dataset_region_code,
                ib.import_status,
                ib.source_snapshot_version,
                ib.source_dataset_id
            FROM import_transport.promotion_batches AS pb
            INNER JOIN import_transport.import_batches AS ib ON ib.id = pb.import_batch_id
            INNER JOIN import_transport.source_datasets AS sd ON sd.id = ib.source_dataset_id
            WHERE pb.id = ${batchId}
            LIMIT 1
        `;
        return rows[0] ?? null;
    }

    async fetchPromotionItemStatusCounts(batchId: bigint): Promise<{
        item_total: number;
        promoted_count: number;
        failed_count: number;
        skipped_count: number;
        validation_blocked_count: number;
        validation_warning_count: number;
    }> {
        if (!(await this.tableExists("import_transport.promotion_items"))) {
            return {
                item_total: 0,
                promoted_count: 0,
                failed_count: 0,
                skipped_count: 0,
                validation_blocked_count: 0,
                validation_warning_count: 0,
            };
        }

        const rows = await this.prisma.$queryRaw<
            [
                {
                    item_total: bigint;
                    promoted_count: bigint;
                    failed_count: bigint;
                    skipped_count: bigint;
                    validation_blocked_count: bigint;
                    validation_warning_count: bigint;
                },
            ]
        >`
            SELECT
                count(*)::bigint AS item_total,
                count(*) FILTER (WHERE promotion_status = 'promoted')::bigint AS promoted_count,
                count(*) FILTER (WHERE promotion_status = 'failed')::bigint AS failed_count,
                count(*) FILTER (
                    WHERE promotion_status = 'skipped'
                       OR item_validation_status = 'skipped'
                )::bigint AS skipped_count,
                count(*) FILTER (WHERE item_validation_status = 'blocked')::bigint AS validation_blocked_count,
                count(*) FILTER (WHERE item_validation_status = 'warning')::bigint AS validation_warning_count
            FROM import_transport.promotion_items
            WHERE promotion_batch_id = ${batchId}
        `;

        const row = rows[0];
        return {
            item_total: Number(row?.item_total ?? 0n),
            promoted_count: Number(row?.promoted_count ?? 0n),
            failed_count: Number(row?.failed_count ?? 0n),
            skipped_count: Number(row?.skipped_count ?? 0n),
            validation_blocked_count: Number(row?.validation_blocked_count ?? 0n),
            validation_warning_count: Number(row?.validation_warning_count ?? 0n),
        };
    }

    async listPromotionBatchItems(
        batchId: bigint,
        query: ImportTransportHistoryPromotionBatchItemsQuery
    ): Promise<{ rows: PromotionItemHistoryRowDb[]; total: bigint }> {
        if (!(await this.tableExists("import_transport.promotion_items"))) {
            return { rows: [], total: 0n };
        }

        const filters: Prisma.Sql[] = [Prisma.sql`pi.promotion_batch_id = ${batchId}`];
        if (query.entity_kind) {
            filters.push(Prisma.sql`pi.entity_kind = ${query.entity_kind}`);
        }
        if (query.promotion_status) {
            filters.push(Prisma.sql`pi.promotion_status = ${query.promotion_status}`);
        }
        if (query.item_validation_status) {
            filters.push(Prisma.sql`pi.item_validation_status = ${query.item_validation_status}`);
        }
        const where = Prisma.join(filters, " AND ");

        const totalRows = await this.prisma.$queryRaw<{ count: bigint }[]>`
            SELECT count(*)::bigint AS count
            FROM import_transport.promotion_items AS pi
            WHERE ${where}
        `;

        const rows = await this.prisma.$queryRaw<PromotionItemHistoryRowDb[]>`
            SELECT
                pi.id,
                pi.entity_kind,
                pi.raw_entity_id,
                pi.promotion_status,
                pi.item_validation_status,
                pi.match_status,
                pi.promoted_target_schema,
                pi.promoted_target_table,
                pi.promoted_target_id,
                coalesce(
                    CASE pi.entity_kind
                        WHEN 'route' THEN r.promoted_core_id
                        WHEN 'stop' THEN s.promoted_core_id
                        WHEN 'route_variant' THEN v.promoted_core_id
                        WHEN 'route_stop' THEN rs.promoted_core_id
                    END,
                    pi.promoted_target_id
                ) AS promoted_core_id,
                pi.error_message,
                pi.created_at,
                pi.updated_at
            FROM import_transport.promotion_items AS pi
            LEFT JOIN import_transport.raw_routes AS r
                ON pi.entity_kind = 'route' AND r.id = pi.raw_entity_id
            LEFT JOIN import_transport.raw_stops AS s
                ON pi.entity_kind = 'stop' AND s.id = pi.raw_entity_id
            LEFT JOIN import_transport.raw_route_variants AS v
                ON pi.entity_kind = 'route_variant' AND v.id = pi.raw_entity_id
            LEFT JOIN import_transport.raw_route_stops AS rs
                ON pi.entity_kind = 'route_stop' AND rs.id = pi.raw_entity_id
            WHERE ${where}
            ORDER BY pi.entity_kind ASC, pi.raw_entity_id ASC
            LIMIT ${query.limit} OFFSET ${query.offset}
        `;

        return { rows, total: totalRows[0]?.count ?? 0n };
    }

    async listPromotionBatchLogs(batchId: bigint) {
        if (!(await this.tableExists("import_transport.promotion_stage_logs"))) {
            return [];
        }

        return this.prisma.$queryRaw<
            {
                id: bigint;
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
    }
}

function emptyEntityCounts(family: ImportTransportFamily): ImportTransportHistoryEntityCounts {
    return {
        entity_family: family,
        total: 0,
        pending_review: 0,
        approved: 0,
        promoted: 0,
        validation_blocked: 0,
        validation_warning: 0,
        validation_valid: 0,
        validation_not_validated: 0,
    };
}
