import { Prisma, type PrismaClient } from "@prisma/client";

import type { ImportReviewScopeResolved } from "./import-review-data-repository.js";
import {
    ImportReviewBatchAmbiguousError,
    ImportReviewBatchNotFoundError,
    ImportReviewInvalidScopeError,
} from "./import-review-errors.js";
import {
    ImportReviewPublishBatchNameConflictError,
    ImportReviewPublishBatchNotFoundError,
    ImportReviewPromotionNoEligibleCandidatesError,
} from "./import-review-promotion.errors.js";
import type { ImportReviewPromotionScopeQuery } from "./import-review-promotion.schema.js";
import { logImportReviewBatchResolveHintsDev } from "./import-review-database-url.js";

const BUILDING_CANDIDATE_TABLE = "import_review.building_candidates";
const TARGET_TABLE = "core.core_map_buildings";

export type PublishBatchRowDb = {
    id: bigint;
    public_id: string;
    batch_name: string;
    status: string;
    source_review_batch_id: bigint | null;
    source_snapshot_version: string | null;
    region_code: string | null;
    total_item_count: number;
    success_count: number;
    failed_count: number;
    skipped_count: number;
    note: string | null;
    created_at: Date;
    published_at: Date | null;
    promoted_at: Date | null;
};

function buildingEligibilitySql(reviewBatchId: bigint, includeMerged: boolean): Prisma.Sql {
    const matchClause = includeMerged
        ? Prisma.sql`
              (
                  (
                      b.match_status IN ('new_auto', 'matched_auto_update')
                      AND b.auto_action IN ('insert_candidate', 'update_candidate')
                  )
                  OR (
                      b.match_status = 'duplicate_candidate'
                      AND b.review_decision = 'merged'
                  )
              )
          `
        : Prisma.sql`
              (
                  b.match_status IN ('new_auto', 'matched_auto_update')
                  AND b.auto_action IN ('insert_candidate', 'update_candidate')
              )
          `;

    return Prisma.sql`
        b.review_batch_id = ${reviewBatchId}
        AND b.entity_family = 'buildings'
        AND b.review_decision = 'approved'
        AND b.review_status = 'approved'
        AND (
            b.promotion_status IS NULL
            OR trim(coalesce(b.promotion_status::text, '')) = ''
            OR b.promotion_status IN ('not_ready', 'ready')
        )
        AND coalesce(b.match_status, '') <> 'manual_protected'
        AND coalesce(b.auto_action, '') <> 'protect_manual'
        AND ${matchClause}
        AND NOT EXISTS (
            SELECT 1
            FROM system.system_publish_items AS spi
            INNER JOIN system.system_publish_batches AS spb ON spb.id = spi.publish_batch_id
            WHERE spi.review_candidate_table = ${BUILDING_CANDIDATE_TABLE}
              AND spi.review_candidate_id = b.id
              AND spb.status IN ('draft', 'validating', 'ready', 'promoting')
        )
    `;
}

function jsonbArrayLengthExpr(column: Prisma.Sql): Prisma.Sql {
    return Prisma.sql`
        CASE
            WHEN ${column} IS NULL THEN 0
            WHEN jsonb_typeof(${column}) = 'array' THEN jsonb_array_length(${column})
            ELSE 0
        END
    `;
}

const READY_BUILDING_ORDER_BY: Record<string, Prisma.Sql> = {
    updated_at_desc: Prisma.sql`b.updated_at DESC, b.id DESC`,
    updated_at_asc: Prisma.sql`b.updated_at ASC, b.id ASC`,
    confidence_score_desc: Prisma.sql`b.confidence_score DESC NULLS LAST, b.updated_at DESC`,
    name_asc: Prisma.sql`coalesce(b.name, b.canonical_name, '') ASC, b.id ASC`,
};

export type ReadyBuildingCandidateRowDb = {
    id: bigint;
    public_id: string;
    external_id: string | null;
    name: string | null;
    canonical_name: string | null;
    class_code: string | null;
    building_type: string | null;
    building_type_id: bigint | null;
    confidence_score: unknown;
    match_status: string | null;
    auto_action: string | null;
    review_status: string | null;
    review_decision: string | null;
    promotion_status: string | null;
    validation_warnings_count: number;
    validation_errors_count: number;
    updated_at: Date;
    source_snapshot_version: string;
    review_batch_id: bigint;
    normalized_data: unknown;
    review_overrides: unknown;
    source_refs: unknown;
    geometry: unknown;
};

function publishActionExpr(): Prisma.Sql {
    return Prisma.sql`
        CASE
            WHEN b.match_status = 'duplicate_candidate' AND b.review_decision = 'merged' THEN 'merge'
            WHEN b.auto_action = 'update_candidate' THEN 'update'
            ELSE 'insert'
        END
    `;
}

export class ImportReviewPromotionRepository {
    constructor(private readonly prisma: PrismaClient) {}

    async resolveScope(query: ImportReviewPromotionScopeQuery): Promise<ImportReviewScopeResolved> {
        if (query.review_batch_id != null) {
            const rows = await this.prisma.$queryRaw<
                {
                    id: bigint;
                    source_snapshot_version: string;
                    source_snapshot_id_local: bigint | null;
                    region_code: string | null;
                }[]
            >`
                SELECT id, source_snapshot_version, source_snapshot_id_local, region_code
                FROM import_review.review_batches
                WHERE id = ${query.review_batch_id}
                LIMIT 2
            `;
            if (rows.length === 0) {
                throw new ImportReviewBatchNotFoundError(query.review_batch_id.toString());
            }
            if (rows.length > 1) {
                throw new ImportReviewInvalidScopeError("review_batch_id resolution was ambiguous");
            }
            const row = rows[0]!;
            return {
                reviewBatchId: row.id,
                snapshotVersion: row.source_snapshot_version,
                sourceSnapshotIdLocal: row.source_snapshot_id_local,
            };
        }

        const v = query.source_snapshot_version?.trim();
        if (!v) {
            throw new ImportReviewInvalidScopeError(
                "Provide source_snapshot_version (alias: snapshot_version) or review_batch_id"
            );
        }

        const rows = await this.prisma.$queryRaw<
            {
                id: bigint;
                source_snapshot_version: string;
                source_snapshot_id_local: bigint | null;
                region_code: string | null;
            }[]
        >`
            SELECT id, source_snapshot_version, source_snapshot_id_local, region_code
            FROM import_review.review_batches
            WHERE source_snapshot_version = ${v}
            ORDER BY id DESC
            LIMIT 2
        `;

        if (rows.length === 0) {
            await logImportReviewBatchResolveHintsDev(this.prisma, v);
            throw new ImportReviewBatchNotFoundError(v);
        }
        if (rows.length > 1) {
            throw new ImportReviewBatchAmbiguousError(v);
        }
        const row = rows[0]!;
        return {
            reviewBatchId: row.id,
            snapshotVersion: row.source_snapshot_version,
            sourceSnapshotIdLocal: row.source_snapshot_id_local,
        };
    }

    private async fetchReviewBatchRegion(reviewBatchId: bigint): Promise<string | null> {
        const rows = await this.prisma.$queryRaw<{ region_code: string | null }[]>`
            SELECT region_code FROM import_review.review_batches WHERE id = ${reviewBatchId} LIMIT 1
        `;
        return rows[0]?.region_code ?? null;
    }

    async countPromotionReady(
        scope: ImportReviewScopeResolved,
        includeMerged: boolean
    ): Promise<{
        ready_count: bigint;
        already_batched_count: bigint;
        promoted_count: bigint;
        blocked_in_active_publish_batch_count: bigint;
    }> {
        const eligible = buildingEligibilitySql(scope.reviewBatchId, includeMerged);
        const rows = await this.prisma.$queryRaw<
            {
                ready_count: bigint;
                already_batched_count: bigint;
                promoted_count: bigint;
                blocked_in_active_publish_batch_count: bigint;
            }[]
        >`
            SELECT
                (
                    SELECT count(*)::bigint
                    FROM import_review.building_candidates AS b
                    WHERE ${eligible}
                ) AS ready_count,
                (
                    SELECT count(*)::bigint
                    FROM import_review.building_candidates AS b
                    WHERE b.review_batch_id = ${scope.reviewBatchId}
                      AND b.entity_family = 'buildings'
                      AND b.promotion_status = 'batched'
                ) AS already_batched_count,
                (
                    SELECT count(*)::bigint
                    FROM import_review.building_candidates AS b
                    WHERE b.review_batch_id = ${scope.reviewBatchId}
                      AND b.entity_family = 'buildings'
                      AND b.promotion_status = 'promoted'
                ) AS promoted_count,
                (
                    SELECT count(DISTINCT b.id)::bigint
                    FROM import_review.building_candidates AS b
                    INNER JOIN system.system_publish_items AS spi
                        ON spi.review_candidate_table = ${BUILDING_CANDIDATE_TABLE}
                       AND spi.review_candidate_id = b.id
                    INNER JOIN system.system_publish_batches AS spb
                        ON spb.id = spi.publish_batch_id
                    WHERE b.review_batch_id = ${scope.reviewBatchId}
                      AND b.entity_family = 'buildings'
                      AND spb.status IN ('draft', 'validating', 'ready', 'promoting')
                ) AS blocked_in_active_publish_batch_count
        `;
        return rows[0] ?? {
            ready_count: 0n,
            already_batched_count: 0n,
            promoted_count: 0n,
            blocked_in_active_publish_batch_count: 0n,
        };
    }

    async listReadyBuildingCandidates(args: {
        scope: ImportReviewScopeResolved;
        includeMerged: boolean;
        limit: number;
        offset: number;
        sort: string;
        includeGeometry: boolean;
    }): Promise<{
        rows: ReadyBuildingCandidateRowDb[];
        total: bigint;
        counts: {
            ready_count: bigint;
            already_batched_count: bigint;
            promoted_count: bigint;
            blocked_in_active_publish_batch_count: bigint;
        };
    }> {
        const eligible = buildingEligibilitySql(args.scope.reviewBatchId, args.includeMerged);
        const orderBy = READY_BUILDING_ORDER_BY[args.sort] ?? READY_BUILDING_ORDER_BY.updated_at_desc!;

        const totalRows = await this.prisma.$queryRaw<{ count: bigint }[]>`
            SELECT count(*)::bigint AS count
            FROM import_review.building_candidates AS b
            WHERE ${eligible}
        `;
        const total = totalRows[0]?.count ?? 0n;

        const rows = await this.prisma.$queryRaw<ReadyBuildingCandidateRowDb[]>`
            SELECT
                b.id,
                b.public_id::text AS public_id,
                b.external_id,
                b.name,
                b.canonical_name,
                b.class_code,
                b.building_type,
                b.building_type_id,
                b.confidence_score,
                b.match_status,
                b.auto_action,
                b.review_status,
                b.review_decision,
                b.promotion_status,
                ${jsonbArrayLengthExpr(Prisma.sql`b.validation_warnings`)}::int AS validation_warnings_count,
                ${jsonbArrayLengthExpr(Prisma.sql`b.validation_errors`)}::int AS validation_errors_count,
                b.updated_at,
                b.source_snapshot_version,
                b.review_batch_id,
                b.normalized_data,
                COALESCE(to_jsonb(b.review_overrides), '{}'::jsonb) AS review_overrides,
                b.source_refs,
                CASE
                    WHEN ${args.includeGeometry} THEN ST_AsGeoJSON(b.geom)::json
                    ELSE NULL::json
                END AS geometry
            FROM import_review.building_candidates AS b
            WHERE ${eligible}
            ORDER BY ${orderBy}
            LIMIT ${args.limit} OFFSET ${args.offset}
        `;

        const counts = await this.countPromotionReady(args.scope, args.includeMerged);

        return { rows, total, counts };
    }

    async listPublishBatches(args: {
        scope: ImportReviewScopeResolved;
        limit: number;
        offset: number;
    }): Promise<{ rows: PublishBatchRowDb[]; total: bigint }> {
        const totalRows = await this.prisma.$queryRaw<{ count: bigint }[]>`
            SELECT count(*)::bigint AS count
            FROM system.system_publish_batches AS pb
            WHERE pb.source_review_batch_id = ${args.scope.reviewBatchId}
        `;
        const total = totalRows[0]?.count ?? 0n;

        const rows = await this.prisma.$queryRaw<PublishBatchRowDb[]>`
            SELECT
                pb.id,
                pb.public_id::text AS public_id,
                pb.batch_name,
                pb.status,
                pb.source_review_batch_id,
                pb.source_snapshot_version,
                pb.region_code,
                pb.total_item_count,
                pb.success_count,
                pb.failed_count,
                pb.skipped_count,
                pb.note,
                pb.created_at,
                pb.published_at,
                pb.promoted_at
            FROM system.system_publish_batches AS pb
            WHERE pb.source_review_batch_id = ${args.scope.reviewBatchId}
            ORDER BY pb.created_at DESC, pb.id DESC
            LIMIT ${args.limit} OFFSET ${args.offset}
        `;

        return { rows, total };
    }

    async fetchPublishBatchById(batchId: bigint): Promise<PublishBatchRowDb | null> {
        const rows = await this.prisma.$queryRaw<PublishBatchRowDb[]>`
            SELECT
                pb.id,
                pb.public_id::text AS public_id,
                pb.batch_name,
                pb.status,
                pb.source_review_batch_id,
                pb.source_snapshot_version,
                pb.region_code,
                pb.total_item_count,
                pb.success_count,
                pb.failed_count,
                pb.skipped_count,
                pb.note,
                pb.created_at,
                pb.published_at,
                pb.promoted_at
            FROM system.system_publish_batches AS pb
            WHERE pb.id = ${batchId}
            LIMIT 1
        `;
        return rows[0] ?? null;
    }

    async fetchPublishItemCounts(batchId: bigint): Promise<{
        pending: bigint;
        success: bigint;
        failed: bigint;
        skipped: bigint;
        rolled_back: bigint;
        total: bigint;
    }> {
        const rows = await this.prisma.$queryRaw<
            {
                pending: bigint;
                success: bigint;
                failed: bigint;
                skipped: bigint;
                rolled_back: bigint;
                total: bigint;
            }[]
        >`
            SELECT
                count(*) FILTER (WHERE publish_status = 'pending')::bigint AS pending,
                count(*) FILTER (WHERE publish_status = 'success')::bigint AS success,
                count(*) FILTER (WHERE publish_status = 'failed')::bigint AS failed,
                count(*) FILTER (WHERE publish_status = 'skipped')::bigint AS skipped,
                count(*) FILTER (WHERE publish_status = 'rolled_back')::bigint AS rolled_back,
                count(*)::bigint AS total
            FROM system.system_publish_items
            WHERE publish_batch_id = ${batchId}
        `;
        return (
            rows[0] ?? {
                pending: 0n,
                success: 0n,
                failed: 0n,
                skipped: 0n,
                rolled_back: 0n,
                total: 0n,
            }
        );
    }

    async fetchBuildingPublishItemCounts(batchId: bigint): Promise<{
        pending: bigint;
        success: bigint;
        failed: bigint;
        skipped: bigint;
        rolled_back: bigint;
        total: bigint;
    }> {
        const rows = await this.prisma.$queryRaw<
            {
                pending: bigint;
                success: bigint;
                failed: bigint;
                skipped: bigint;
                rolled_back: bigint;
                total: bigint;
            }[]
        >`
            SELECT
                count(*) FILTER (WHERE publish_status = 'pending')::bigint AS pending,
                count(*) FILTER (WHERE publish_status = 'success')::bigint AS success,
                count(*) FILTER (WHERE publish_status = 'failed')::bigint AS failed,
                count(*) FILTER (WHERE publish_status = 'skipped')::bigint AS skipped,
                count(*) FILTER (WHERE publish_status = 'rolled_back')::bigint AS rolled_back,
                count(*)::bigint AS total
            FROM system.system_publish_items
            WHERE publish_batch_id = ${batchId}
              AND entity_family = 'buildings'
        `;
        return (
            rows[0] ?? {
                pending: 0n,
                success: 0n,
                failed: 0n,
                skipped: 0n,
                rolled_back: 0n,
                total: 0n,
            }
        );
    }

    async createPublishBatchFromBuildings(args: {
        scope: ImportReviewScopeResolved;
        batchName: string;
        note: string | null;
        includeMerged: boolean;
        createdByUserId: bigint | null;
    }): Promise<{ batch: PublishBatchRowDb; itemsAdded: number; buildingsMarked: number }> {
        const regionCode = await this.fetchReviewBatchRegion(args.scope.reviewBatchId);
        const eligible = buildingEligibilitySql(args.scope.reviewBatchId, args.includeMerged);

        return this.prisma.$transaction(async (tx) => {
            const nameConflict = await tx.$queryRaw<{ id: bigint }[]>`
                SELECT id FROM system.system_publish_batches WHERE batch_name = ${args.batchName} LIMIT 1
            `;
            if (nameConflict.length > 0) {
                throw new ImportReviewPublishBatchNameConflictError(args.batchName);
            }

            const readyRows = await tx.$queryRaw<{ count: bigint }[]>`
                SELECT count(*)::bigint AS count
                FROM import_review.building_candidates AS b
                WHERE ${eligible}
            `;
            const readyCount = Number(readyRows[0]?.count ?? 0n);
            if (readyCount === 0) {
                throw new ImportReviewPromotionNoEligibleCandidatesError(
                    0,
                    "No approved building candidates are ready for publish batching. Check review decisions, promotion_status, and active publish batches."
                );
            }

            const batchRows = await tx.$queryRaw<PublishBatchRowDb[]>`
                INSERT INTO system.system_publish_batches (
                    batch_name,
                    created_by,
                    approved_by,
                    status,
                    note,
                    source_review_batch_id,
                    source_snapshot_version,
                    region_code,
                    total_item_count,
                    success_count,
                    failed_count,
                    skipped_count,
                    created_at
                )
                VALUES (
                    ${args.batchName},
                    ${args.createdByUserId},
                    NULL,
                    'draft',
                    ${args.note},
                    ${args.scope.reviewBatchId},
                    ${args.scope.snapshotVersion},
                    ${regionCode},
                    0,
                    0,
                    0,
                    0,
                    now()
                )
                RETURNING
                    id,
                    public_id::text AS public_id,
                    batch_name,
                    status,
                    source_review_batch_id,
                    source_snapshot_version,
                    region_code,
                    total_item_count,
                    success_count,
                    failed_count,
                    skipped_count,
                    note,
                    created_at,
                    published_at,
                    promoted_at
            `;
            const batch = batchRows[0];
            if (!batch) {
                throw new Error("Publish batch insert did not return a row");
            }

            const inserted = await tx.$queryRaw<{ id: bigint }[]>`
                INSERT INTO system.system_publish_items (
                    publish_batch_id,
                    entity_family,
                    entity_id,
                    review_candidate_table,
                    review_candidate_id,
                    external_id,
                    target_schema,
                    target_table,
                    publish_action,
                    publish_status,
                    created_at
                )
                SELECT
                    ${batch.id},
                    'buildings',
                    b.id,
                    ${BUILDING_CANDIDATE_TABLE},
                    b.id,
                    b.external_id,
                    'core',
                    ${TARGET_TABLE},
                    ${publishActionExpr()},
                    'pending',
                    now()
                FROM import_review.building_candidates AS b
                WHERE ${eligible}
                RETURNING id
            `;

            const itemsAdded = inserted.length;
            if (itemsAdded === 0) {
                throw new ImportReviewPromotionNoEligibleCandidatesError(
                    readyCount,
                    "Eligible candidates changed during batch creation (concurrent publish). Retry."
                );
            }

            const marked = await tx.$executeRaw`
                UPDATE import_review.building_candidates AS b
                SET
                    promotion_status = 'batched',
                    updated_at = now()
                WHERE ${eligible}
            `;

            await tx.$executeRaw`
                UPDATE system.system_publish_batches
                SET total_item_count = ${itemsAdded}
                WHERE id = ${batch.id}
            `;

            await tx.$executeRaw`
                UPDATE import_review.review_batches
                SET
                    status = 'publish_batch_created',
                    updated_at = now()
                WHERE id = ${args.scope.reviewBatchId}
                  AND status IN ('uploaded', 'reviewing', 'review_completed')
            `;

            const refreshed = await tx.$queryRaw<PublishBatchRowDb[]>`
                SELECT
                    pb.id,
                    pb.public_id::text AS public_id,
                    pb.batch_name,
                    pb.status,
                    pb.source_review_batch_id,
                    pb.source_snapshot_version,
                    pb.region_code,
                    pb.total_item_count,
                    pb.success_count,
                    pb.failed_count,
                    pb.skipped_count,
                    pb.note,
                    pb.created_at,
                    pb.published_at,
                    pb.promoted_at
                FROM system.system_publish_batches AS pb
                WHERE pb.id = ${batch.id}
                LIMIT 1
            `;

            return {
                batch: refreshed[0] ?? batch,
                itemsAdded,
                buildingsMarked: Number(marked),
            };
        });
    }
}
