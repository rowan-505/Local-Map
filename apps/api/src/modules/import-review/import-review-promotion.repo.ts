import { Prisma, type PrismaClient } from "@prisma/client";

import { getImportReviewEntityConfig } from "./import-review-config.js";
import { effectiveBuildingTypeIdExpr } from "./import-review-candidate-sql.js";

import type { ImportReviewScopeQuery, ImportReviewScopeResolved } from "./import-review-data-repository.js";
import { resolveImportReviewBatchScope } from "./import-review-batch-resolver.js";
import {
    ImportReviewPublishBatchNameConflictError,
    ImportReviewPublishBatchNotFoundError,
    ImportReviewPublishBatchCreationTimeoutError,
    ImportReviewPromotionNoEligibleCandidatesError,
    type ImportReviewPromotionFamilySkipSummary,
    type ImportReviewPromotionSkippedReasonCount,
} from "./import-review-promotion.errors.js";
import type { ImportReviewPublishFamilyConfig } from "./import-review-promotion-config.js";
import {
    getImportReviewPublishFamilyConfig,
} from "./import-review-promotion-config.js";
import {
    buildFamilyEligibilityCountSql,
    buildInsertPublishItemsByIdsSql,
    buildMarkBatchedByIdsSql,
    buildSelectEligibleCandidateIdsSql,
    type FamilyEligibilityCountDb,
    type PublishEligibilityOptions,
} from "./import-review-promotion-eligibility.js";
import { requireValidPublishStageStatus } from "./import-review-promotion-stage-status.js";

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
    building_type_code: string | null;
    building_type_name: string | null;
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

const CREATION_STAGE_DEFS = [
    { key: "resolve_scope", label: "Resolve scope" },
    { key: "count_eligible", label: "Count eligible candidates" },
    { key: "create_batch", label: "Create publish batch" },
    { key: "insert_items", label: "Insert publish items" },
    { key: "mark_batched", label: "Mark candidates batched" },
    { key: "write_summary", label: "Write creation summary" },
] as const;

const PUBLISH_ITEM_INSERT_CHUNK_SIZE = 500;

const CREATE_BATCH_TX_OPTIONS = {
    timeout: 15_000,
    maxWait: 5_000,
} as const;

export type CreateBatchTimingMs = {
    resolve_ms: number;
    eligibility_ms: number;
    payload_ms: number;
    transaction_ms: number;
    total_ms: number;
};

function mapSkippedReasons(row: FamilyEligibilityCountDb): ImportReviewPromotionSkippedReasonCount[] {
    const out: ImportReviewPromotionSkippedReasonCount[] = [];
    const push = (reason: string, count: bigint) => {
        const n = Number(count);
        if (n > 0) {
            out.push({ reason, count: n });
        }
    };
    push("has_validation_errors", row.has_validation_errors);
    push("manual_protected", row.manual_protected);
    push("duplicate_unconfirmed", row.duplicate_unconfirmed);
    push("rejected_decision", row.rejected_decision);
    return out;
}

export type MultiFamilyBatchCreateResult = {
    batch: PublishBatchRowDb;
    itemsAdded: number;
    candidatesMarked: number;
    byFamily: Array<{
        entity_family: string;
        items_added: number;
        marked_batched: number;
        skipped_reasons: ImportReviewPromotionSkippedReasonCount[];
    }>;
    timing: CreateBatchTimingMs;
    totalSelected: number;
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

    async resolveScope(query: ImportReviewScopeQuery): Promise<ImportReviewScopeResolved> {
        return resolveImportReviewBatchScope(this.prisma, query);
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

        const buildingConfig = getImportReviewEntityConfig("buildings");
        const effectiveBtId = effectiveBuildingTypeIdExpr(buildingConfig);

        const rows = await this.prisma.$queryRaw<ReadyBuildingCandidateRowDb[]>`
            SELECT
                b.id,
                b.public_id::text AS public_id,
                b.external_id,
                b.name,
                b.canonical_name,
                b.class_code,
                b.building_type,
                ${effectiveBtId} AS building_type_id,
                bt.code AS building_type_code,
                bt.name AS building_type_name,
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
            LEFT JOIN ref.ref_building_types AS bt ON bt.id = ${effectiveBtId}
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

    async pgRegclassExists(fullyQualifiedName: string): Promise<boolean> {
        const rows = await this.prisma.$queryRaw<{ ok: boolean }[]>`
            SELECT to_regclass(${fullyQualifiedName}) IS NOT NULL AS ok
        `;
        return rows[0]?.ok === true;
    }

    async countFamilyEligibility(
        config: ImportReviewPublishFamilyConfig,
        reviewBatchId: bigint,
        options: PublishEligibilityOptions
    ): Promise<FamilyEligibilityCountDb | null> {
        if (!(await this.pgRegclassExists(config.candidateTable))) {
            return null;
        }
        const sql = buildFamilyEligibilityCountSql(config, reviewBatchId, options);
        const rows = await this.prisma.$queryRaw<FamilyEligibilityCountDb[]>`${sql}`;
        return rows[0] ?? null;
    }

    async countBatchEligibilityByFamilies(args: {
        scope: ImportReviewScopeResolved;
        families: ImportReviewPublishFamilyConfig[];
        options: PublishEligibilityOptions;
    }): Promise<FamilyEligibilityCountDb[]> {
        const out: FamilyEligibilityCountDb[] = [];
        for (const config of args.families) {
            const row = await this.countFamilyEligibility(config, args.scope.reviewBatchId, args.options);
            if (row) {
                out.push(row);
            }
        }
        return out;
    }

    async dryRunPublishBatchMultiFamily(args: {
        scope: ImportReviewScopeResolved;
        batchName: string;
        families: ImportReviewPublishFamilyConfig[];
        options: PublishEligibilityOptions;
    }): Promise<{
        batchName: string;
        entityFamilies: string[];
        totals: { included: number; excluded: number; skipped: number };
        byFamily: Array<{
            entity_family: string;
            included: number;
            excluded: number;
            skipped: number;
            skipped_reasons: ImportReviewPromotionSkippedReasonCount[];
        }>;
    }> {
        const counts = await this.countBatchEligibilityByFamilies({
            scope: args.scope,
            families: args.families,
            options: args.options,
        });

        let included = 0;
        let excluded = 0;
        let skipped = 0;
        const byFamily = counts.map((row) => {
            const inc = Number(row.approved_ready);
            const exc = Number(row.excluded);
            const sk =
                Number(row.blocked) +
                Number(row.already_promoted) +
                Number(row.with_warnings);
            included += inc;
            excluded += exc;
            skipped += sk;
            return {
                entity_family: row.entity_family,
                included: inc,
                excluded: exc,
                skipped: sk,
                skipped_reasons: mapSkippedReasons(row),
            };
        });

        return {
            batchName: args.batchName,
            entityFamilies: args.families.map((f) => f.entityFamily),
            totals: { included, excluded, skipped },
            byFamily,
        };
    }

    private buildNoEligibleError(
        counts: FamilyEligibilityCountDb[]
    ): ImportReviewPromotionNoEligibleCandidatesError {
        const byFamily: ImportReviewPromotionFamilySkipSummary[] = counts.map((row) => ({
            entity_family: row.entity_family,
            included: Number(row.approved_ready),
            skipped_reasons: mapSkippedReasons(row),
        }));
        const readyCount = byFamily.reduce((sum, f) => sum + f.included, 0);
        return new ImportReviewPromotionNoEligibleCandidatesError(
            readyCount,
            "No eligible candidates for publish batch creation. Review per-family skipped reasons.",
            byFamily
        );
    }

    async batchNameExists(batchName: string): Promise<boolean> {
        const rows = await this.prisma.$queryRaw<{ id: bigint }[]>`
            SELECT id FROM system.system_publish_batches WHERE batch_name = ${batchName} LIMIT 1
        `;
        return rows.length > 0;
    }

    async selectEligibleCandidateIds(
        config: ImportReviewPublishFamilyConfig,
        reviewBatchId: bigint,
        options: PublishEligibilityOptions
    ): Promise<bigint[]> {
        if (!(await this.pgRegclassExists(config.candidateTable))) {
            return [];
        }
        const sql = buildSelectEligibleCandidateIdsSql(config, reviewBatchId, options);
        const rows = await this.prisma.$queryRaw<{ id: bigint }[]>`${sql}`;
        return rows.map((r) => r.id);
    }

    private async insertPublishItemsByIdsChunked(
        tx: Prisma.TransactionClient,
        config: ImportReviewPublishFamilyConfig,
        batchId: bigint,
        candidateIds: bigint[]
    ): Promise<number> {
        if (candidateIds.length === 0) {
            return 0;
        }
        let inserted = 0;
        for (let i = 0; i < candidateIds.length; i += PUBLISH_ITEM_INSERT_CHUNK_SIZE) {
            const chunk = candidateIds.slice(i, i + PUBLISH_ITEM_INSERT_CHUNK_SIZE);
            const rows = await tx.$queryRaw<{ id: bigint }[]>`
                ${buildInsertPublishItemsByIdsSql(config, batchId, chunk)}
                RETURNING id
            `;
            inserted += rows.length;
        }
        return inserted;
    }

    private async markCandidatesBatchedByIdsChunked(
        tx: Prisma.TransactionClient,
        config: ImportReviewPublishFamilyConfig,
        candidateIds: bigint[]
    ): Promise<number> {
        if (candidateIds.length === 0) {
            return 0;
        }
        let marked = 0;
        for (let i = 0; i < candidateIds.length; i += PUBLISH_ITEM_INSERT_CHUNK_SIZE) {
            const chunk = candidateIds.slice(i, i + PUBLISH_ITEM_INSERT_CHUNK_SIZE);
            const count = await tx.$executeRaw`${buildMarkBatchedByIdsSql(config, chunk)}`;
            marked += Number(count);
        }
        return marked;
    }

    async createPublishBatchMultiFamily(args: {
        scope: ImportReviewScopeResolved;
        batchName: string;
        note: string | null;
        families: ImportReviewPublishFamilyConfig[];
        options: PublishEligibilityOptions;
        createdByUserId: bigint | null;
    }): Promise<MultiFamilyBatchCreateResult> {
        const totalStart = Date.now();
        let resolveMs = 0;
        let eligibilityMs = 0;
        let payloadMs = 0;

        const resolveStart = Date.now();
        const regionCode = await this.fetchReviewBatchRegion(args.scope.reviewBatchId);
        if (await this.batchNameExists(args.batchName)) {
            throw new ImportReviewPublishBatchNameConflictError(args.batchName);
        }
        resolveMs = Date.now() - resolveStart;

        const eligibilityStart = Date.now();
        const preCounts = await this.countBatchEligibilityByFamilies({
            scope: args.scope,
            families: args.families,
            options: args.options,
        });
        const readyCount = preCounts.reduce((sum, row) => sum + Number(row.approved_ready), 0);
        if (readyCount === 0) {
            throw this.buildNoEligibleError(preCounts);
        }

        const countsByFamily = new Map(preCounts.map((row) => [row.entity_family, row]));
        const familyCandidateIds: Array<{
            config: ImportReviewPublishFamilyConfig;
            candidateIds: bigint[];
            skippedReasons: ImportReviewPromotionSkippedReasonCount[];
        }> = [];

        for (const config of args.families) {
            const countRow = countsByFamily.get(config.entityFamily);
            if (!countRow || Number(countRow.approved_ready) === 0) {
                continue;
            }
            const candidateIds = await this.selectEligibleCandidateIds(
                config,
                args.scope.reviewBatchId,
                args.options
            );
            familyCandidateIds.push({
                config,
                candidateIds,
                skippedReasons: mapSkippedReasons(countRow),
            });
        }
        eligibilityMs = Date.now() - eligibilityStart;

        const payloadStart = Date.now();
        const totalSelected = familyCandidateIds.reduce((sum, f) => sum + f.candidateIds.length, 0);
        if (totalSelected === 0) {
            throw this.buildNoEligibleError(preCounts);
        }

        const preByFamily = familyCandidateIds.map((f) => ({
            entity_family: f.config.entityFamily,
            items_added: f.candidateIds.length,
            marked_batched: f.candidateIds.length,
            skipped_reasons: f.skippedReasons,
        }));

        const creationSummary = {
            entity_families: args.families.map((f) => f.entityFamily),
            totals: {
                included: totalSelected,
                marked_batched: totalSelected,
            },
            by_family: preByFamily,
        };
        payloadMs = Date.now() - payloadStart;

        const transactionStart = Date.now();
        let transactionMs = 0;

        try {
            const writeResult = await this.prisma.$transaction(async (tx) => {
                const nameConflict = await tx.$queryRaw<{ id: bigint }[]>`
                    SELECT id FROM system.system_publish_batches WHERE batch_name = ${args.batchName} LIMIT 1
                `;
                if (nameConflict.length > 0) {
                    throw new ImportReviewPublishBatchNameConflictError(args.batchName);
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

                let itemsAdded = 0;
                let candidatesMarked = 0;
                const byFamily: MultiFamilyBatchCreateResult["byFamily"] = [];

                for (const { config, candidateIds, skippedReasons } of familyCandidateIds) {
                    const familyItems = await this.insertPublishItemsByIdsChunked(
                        tx,
                        config,
                        batch.id,
                        candidateIds
                    );
                    const marked = await this.markCandidatesBatchedByIdsChunked(
                        tx,
                        config,
                        candidateIds
                    );

                    itemsAdded += familyItems;
                    candidatesMarked += marked;
                    byFamily.push({
                        entity_family: config.entityFamily,
                        items_added: familyItems,
                        marked_batched: marked,
                        skipped_reasons: skippedReasons,
                    });
                }

                if (itemsAdded === 0) {
                    throw new ImportReviewPromotionNoEligibleCandidatesError(
                        readyCount,
                        "Eligible candidates changed during batch creation (concurrent publish). Retry.",
                        byFamily.map((f) => ({
                            entity_family: f.entity_family,
                            included: f.items_added,
                            skipped_reasons: f.skipped_reasons,
                        }))
                    );
                }

                await tx.$executeRaw`
                    UPDATE system.system_publish_batches
                    SET
                        total_item_count = ${itemsAdded},
                        summary = jsonb_set(
                            coalesce(summary, '{}'::jsonb),
                            '{creation_result}',
                            ${JSON.stringify(creationSummary)}::jsonb,
                            true
                        )
                    WHERE id = ${batch.id}
                `;

                const creationStageStatus = requireValidPublishStageStatus("success");

                for (const stage of CREATION_STAGE_DEFS) {
                    await tx.$executeRaw`
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
                            ${batch.id},
                            ${stage.key},
                            ${stage.label},
                            ${creationStageStatus},
                            ${stage.key === "write_summary" ? "Publish batch creation summary written." : null},
                            100,
                            ${JSON.stringify(
                                stage.key === "insert_items" || stage.key === "mark_batched"
                                    ? { by_family: byFamily }
                                    : stage.key === "count_eligible"
                                      ? { ready_count: readyCount, total_selected: totalSelected }
                                      : {}
                            )}::jsonb,
                            now(),
                            now()
                        )
                    `;
                }

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
                    candidatesMarked,
                    byFamily,
                };
            }, CREATE_BATCH_TX_OPTIONS);

            transactionMs = Date.now() - transactionStart;

            return {
                ...writeResult,
                totalSelected,
                timing: {
                    resolve_ms: resolveMs,
                    eligibility_ms: eligibilityMs,
                    payload_ms: payloadMs,
                    transaction_ms: transactionMs,
                    total_ms: Date.now() - totalStart,
                },
            };
        } catch (err) {
            if (
                err instanceof Prisma.PrismaClientKnownRequestError &&
                err.code === "P2028"
            ) {
                throw new ImportReviewPublishBatchCreationTimeoutError();
            }
            throw err;
        }
    }

    async createPublishBatchFromBuildings(args: {
        scope: ImportReviewScopeResolved;
        batchName: string;
        note: string | null;
        includeMerged: boolean;
        createdByUserId: bigint | null;
    }): Promise<{ batch: PublishBatchRowDb; itemsAdded: number; buildingsMarked: number }> {
        const buildings = getImportReviewPublishFamilyConfig("buildings");
        if (!buildings) {
            throw new Error("Buildings publish config missing");
        }
        const result = await this.createPublishBatchMultiFamily({
            scope: args.scope,
            batchName: args.batchName,
            note: args.note,
            families: [buildings],
            options: { includeWarnings: false, includeMerged: args.includeMerged },
            createdByUserId: args.createdByUserId,
        });
        const buildingsSlice = result.byFamily.find((f) => f.entity_family === "buildings");
        return {
            batch: result.batch,
            itemsAdded: result.itemsAdded,
            buildingsMarked: buildingsSlice?.marked_batched ?? result.candidatesMarked,
        };
    }
}
