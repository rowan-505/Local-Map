import { Prisma, type PrismaClient } from "@prisma/client";

import {
    getImportReviewEntityConfig,
    type ImportReviewEntityFamilySlug,
} from "./import-review-config.js";
import {
    getImportReviewPublishFamilyConfig,
    IMPORT_REVIEW_PUBLISH_FAMILY_CONFIG,
} from "./import-review-promotion-config.js";
import type {
    CleanupEvaluatedRow,
    CleanupIneligibleReason,
    CleanupPromotedScope,
} from "./import-review-cleanup-promoted.types.js";

type AlreadyCleanedRow = {
    candidate_id: bigint;
    entity_family: string;
    publish_batch_id: bigint | null;
};

type BatchVerificationRow = {
    id: bigint;
    status: string;
    success_count: number | null;
    core_verified_count: number | null;
};

function coreActiveSql(entityFamily: ImportReviewEntityFamilySlug, alias: string): Prisma.Sql {
    const a = Prisma.raw(alias);
    if (entityFamily === "places") {
        return Prisma.sql`${a}.deleted_at IS NULL`;
    }
    if (
        entityFamily === "bus_stops" ||
        entityFamily === "landuse" ||
        entityFamily === "water_lines" ||
        entityFamily === "water_polygons"
    ) {
        return Prisma.sql`coalesce(${a}.is_active, true)`;
    }
    return Prisma.sql`coalesce(${a}.is_active, true) AND ${a}.deleted_at IS NULL`;
}

function geometryCountSql(entityFamily: ImportReviewEntityFamilySlug, alias: string): Prisma.Sql {
    const entity = getImportReviewEntityConfig(entityFamily);
    const a = Prisma.raw(alias);
    const parts: Prisma.Sql[] = [];
    if (entity.geometryColumns.primary) {
        parts.push(
            Prisma.sql`(CASE WHEN ${a}.${Prisma.raw(entity.geometryColumns.primary)} IS NOT NULL THEN 1 ELSE 0 END)`
        );
    }
    if (entity.geometryColumns.secondary) {
        parts.push(
            Prisma.sql`(CASE WHEN ${a}.${Prisma.raw(entity.geometryColumns.secondary)} IS NOT NULL THEN 1 ELSE 0 END)`
        );
    }
    if (parts.length === 0) {
        return Prisma.sql`0`;
    }
    return Prisma.join(parts, " + ");
}

function olderThanClause(alias: string, olderThanDays: number | undefined): Prisma.Sql {
    if (olderThanDays === undefined) {
        return Prisma.empty;
    }
    return Prisma.sql`AND ${Prisma.raw(alias)}.promoted_at < now() - (${olderThanDays}::int * interval '1 day')`;
}

export class ImportReviewCleanupPromotedRepository {
    constructor(private readonly prisma: PrismaClient) {}

    async reviewBatchExists(reviewBatchId: bigint): Promise<boolean> {
        const rows = await this.prisma.$queryRaw<{ exists: boolean }[]>`
            SELECT EXISTS (
                SELECT 1 FROM import_review.review_batches WHERE id = ${reviewBatchId}
            ) AS exists
        `;
        return rows[0]?.exists === true;
    }

    async publishBatchExists(publishBatchId: bigint): Promise<boolean> {
        const rows = await this.prisma.$queryRaw<{ exists: boolean }[]>`
            SELECT EXISTS (
                SELECT 1 FROM system.system_publish_batches WHERE id = ${publishBatchId}
            ) AS exists
        `;
        return rows[0]?.exists === true;
    }

    async fetchBatchVerificationRows(batchIds: bigint[]): Promise<BatchVerificationRow[]> {
        if (batchIds.length === 0) {
            return [];
        }
        return this.prisma.$queryRaw<BatchVerificationRow[]>`
            SELECT id, status, success_count, core_verified_count
            FROM system.system_publish_batches
            WHERE id IN (${Prisma.join(batchIds)})
        `;
    }

    async listAlreadyCleaned(scope: CleanupPromotedScope): Promise<AlreadyCleanedRow[]> {
        const unions: Prisma.Sql[] = [];
        for (const family of scope.entityFamilies) {
            const cfg = IMPORT_REVIEW_PUBLISH_FAMILY_CONFIG[family];
            unions.push(Prisma.sql`
                SELECT
                    spi.review_candidate_id AS candidate_id,
                    ${family}::text AS entity_family,
                    spi.publish_batch_id
                FROM system.system_publish_items AS spi
                INNER JOIN system.system_publish_batches AS pb
                    ON pb.id = spi.publish_batch_id
                WHERE pb.source_review_batch_id = ${scope.reviewBatchId}
                  AND spi.entity_family = ${family}
                  AND spi.review_candidate_table = ${cfg.candidateTable}
                  AND spi.publish_status = 'success'
                  AND spi.review_candidate_id IS NOT NULL
                  AND (${scope.publishBatchId ?? null}::bigint IS NULL OR spi.publish_batch_id = ${scope.publishBatchId ?? null})
                  AND NOT EXISTS (
                      SELECT 1 FROM ${Prisma.raw(cfg.candidateTable)} AS c
                      WHERE c.id = spi.review_candidate_id
                  )
            `);
        }
        if (unions.length === 0) {
            return [];
        }
        return this.prisma.$queryRaw<AlreadyCleanedRow[]>`
            SELECT candidate_id, entity_family, publish_batch_id
            FROM (${Prisma.join(unions, " UNION ALL ")}) AS cleaned
        `;
    }

    async evaluateFamilyCandidates(
        family: ImportReviewEntityFamilySlug,
        scope: CleanupPromotedScope
    ): Promise<CleanupEvaluatedRow[]> {
        const publishCfg = getImportReviewPublishFamilyConfig(family);
        if (!publishCfg) {
            return [];
        }
        const a = publishCfg.tableAlias;
        const candidateTable = publishCfg.candidateTable;
        const coreTable = publishCfg.coreTargetTable;
        const geomCount = geometryCountSql(family, a);
        const coreActive = coreActiveSql(family, "core");

        const rows = await this.prisma.$queryRaw<
            {
                candidate_id: bigint;
                entity_family: string;
                reason: string | null;
                publish_batch_id: bigint | null;
                promoted_core_id: bigint | null;
                promoted_at: Date | null;
                geometry_count: number;
            }[]
        >`
            WITH candidates AS (
                SELECT ${Prisma.raw(a)}.*
                FROM ${Prisma.raw(candidateTable)} AS ${Prisma.raw(a)}
                WHERE ${Prisma.raw(a)}.review_batch_id = ${scope.reviewBatchId}
                ${olderThanClause(a, scope.olderThanDays)}
            ),
            publish_items AS (
                SELECT
                    spi.review_candidate_id,
                    spi.publish_batch_id,
                    spi.target_id,
                    spi.publish_status,
                    pb.status AS batch_status
                FROM system.system_publish_items AS spi
                INNER JOIN system.system_publish_batches AS pb ON pb.id = spi.publish_batch_id
                WHERE pb.source_review_batch_id = ${scope.reviewBatchId}
                  AND spi.entity_family = ${family}
                  AND spi.review_candidate_table = ${candidateTable}
                  AND (${scope.publishBatchId ?? null}::bigint IS NULL OR spi.publish_batch_id = ${scope.publishBatchId ?? null})
            ),
            best_success AS (
                SELECT DISTINCT ON (pi.review_candidate_id)
                    pi.review_candidate_id,
                    pi.publish_batch_id,
                    pi.target_id,
                    pi.publish_status,
                    pi.batch_status
                FROM publish_items AS pi
                WHERE pi.publish_status = 'success'
                ORDER BY pi.review_candidate_id, pi.publish_batch_id DESC
            ),
            has_failed AS (
                SELECT DISTINCT pi.review_candidate_id, pi.publish_batch_id
                FROM publish_items AS pi
                WHERE pi.publish_status = 'failed'
            )
            SELECT
                c.id AS candidate_id,
                ${family}::text AS entity_family,
                CASE
                    WHEN c.promotion_status IS DISTINCT FROM 'promoted'
                         OR c.review_status IS DISTINCT FROM 'promoted'
                        THEN 'not_promoted'
                    WHEN c.promoted_core_id IS NULL THEN 'missing_promoted_core_id'
                    WHEN bs.review_candidate_id IS NULL THEN 'missing_publish_item'
                    WHEN bs.publish_status IS DISTINCT FROM 'success'
                         OR bs.target_id IS DISTINCT FROM c.promoted_core_id
                        THEN 'publish_item_not_success'
                    WHEN bs.batch_status IS DISTINCT FROM 'promoted' THEN 'publish_batch_not_promoted'
                    WHEN core.id IS NULL OR NOT (${coreActive}) THEN 'core_row_missing'
                    WHEN core.source_refs->>'review_candidate_id' IS NULL
                         OR core.source_refs->>'publish_batch_id' IS NULL
                        THEN 'lineage_missing'
                    WHEN hf.review_candidate_id IS NOT NULL THEN 'failed_item_exists'
                    ELSE NULL
                END AS reason,
                bs.publish_batch_id,
                c.promoted_core_id,
                c.promoted_at,
                ${geomCount}::int AS geometry_count
            FROM candidates AS c
            LEFT JOIN best_success AS bs ON bs.review_candidate_id = c.id
            LEFT JOIN ${Prisma.raw(coreTable)} AS core ON core.id = c.promoted_core_id
            LEFT JOIN has_failed AS hf
                ON hf.review_candidate_id = c.id
               AND hf.publish_batch_id = bs.publish_batch_id
            WHERE c.promotion_status = 'promoted'
               OR c.review_status = 'promoted'
               OR c.promoted_core_id IS NOT NULL
               OR c.promoted_at IS NOT NULL
               OR bs.review_candidate_id IS NOT NULL
        `;

        return rows.map((row) => ({
            candidate_id: row.candidate_id,
            entity_family: family,
            reason: row.reason as CleanupIneligibleReason | null,
            publish_batch_id: row.publish_batch_id,
            promoted_core_id: row.promoted_core_id,
            promoted_at: row.promoted_at,
            geometry_count: Number(row.geometry_count ?? 0),
        }));
    }

    async deleteCandidatesByFamily(
        family: ImportReviewEntityFamilySlug,
        candidateIds: bigint[]
    ): Promise<number> {
        if (candidateIds.length === 0) {
            return 0;
        }
        const cfg = IMPORT_REVIEW_PUBLISH_FAMILY_CONFIG[family];
        const result = await this.prisma.$executeRaw`
            DELETE FROM ${Prisma.raw(cfg.candidateTable)}
            WHERE id IN (${Prisma.join(candidateIds)})
        `;
        return Number(result);
    }
}
