import { Prisma, type PrismaClient } from "@prisma/client";

import {
    extractDurablePublishItemFields,
    mergePublishItemAfterData,
    mergePublishItemBeforeData,
} from "./import-review-history-durable-fields.js";
import type { ImportReviewPublishBatchProgressRow } from "./import-review-promotion-validation.types.js";
import type { PromotionStagePlan, PromotionWorkflowStageDef } from "./import-review-promotion-promote-stages.js";
import {
    buildPromotionStageReconcileUpdates,
    type PromotionStageLogSnapshot,
} from "./import-review-promotion-promote-stage-finalize.js";
import {
    type ImportReviewPublishPromotionStageKey,
    type ImportReviewPublishBatchVerifyResponse,
    type PromoteItemResult,
} from "./import-review-promotion-promote.types.js";
import { ImportReviewPromotionValidationRepository } from "./import-review-promotion-validation.repo.js";
import type { ImportReviewEntityFamilySlug } from "./import-review-config.js";
import {
    buildPromotionItemFailureRecord,
    buildPublishItemFailureAfterData,
    stringifyPromotionPayload,
    dedupePromotionFailureSamples,
    promotionFailureSampleFromRow,
    type PromotionFailureSample,
} from "./import-review-promotion-failure.js";
import { extractPromotionFailureCause } from "./import-review-promotion-failure-cause.js";
import type { PromotionFailureCause } from "./import-review-promotion-failure-cause.js";
import {
    classifyPublishItemsForPromotion,
    type PublishItemValidationRow,
} from "./import-review-promotion-execution.js";
import {
    countPromotableWriteBlockers,
    countPromotionPreflightSkips,
} from "./import-review-promotion-promote-preflight.js";
import {
    parsePromotionCancelRequestedFromSummary,
    parsePromotionHeartbeatFromSummary,
} from "./import-review-promotion-promote-progress.js";
import {
    publishItemPromotionBlockReason,
    type PublishItemPromotionGateInput,
} from "./import-review-promotion-publish-item-validation.js";
import {
    PROMOTABLE_PUBLISH_FAMILIES,
    type PromotablePublishEntityFamily,
    getImportReviewPromotionCandidateTable,
} from "./import-review-promotion-config.js";
import { PUBLISH_BATCH_PROMOTION_SYSTEM_ERROR_CODE } from "./import-review-promotion-batch-failure-cleanup.js";
import { resolveRoadPromotionActionForPublishItem } from "./import-review-promotion-road-duplicate-external-id.js";
import { releaseCandidateAfterPromotionFailure as releaseCandidateAfterPromotionFailureSql } from "./import-review-promotion-candidate-failure-release.js";
import { requireValidPublishStageStatus } from "./import-review-promotion-stage-status.js";
import {
    CORE_PLACES_TABLE,
    ImportReviewPromotionPromotePlacesRepository,
    PLACE_CANDIDATE_TABLE,
} from "./import-review-promotion-promote-places.repo.js";
import {
    ImportReviewPublishBatchSummaryRepository,
} from "./import-review-publish-batch-summary.js";
import { ImportReviewReviewBatchSummaryRepository } from "./import-review-review-batch-summary.js";
import {
    buildVerificationMetadataTracking,
    coreVerificationInsertColumnsSql,
    coreVerificationInsertValuesSql,
    coreVerificationUpdateSetClauseSql,
    getCoreVerificationColumnsForEntity,
} from "./import-review-promotion-core-verification.js";
import {
    ImportReviewPromotionPromoteMapRepository,
    CORE_WATER_LINES_TABLE,
    CORE_WATER_POLYGONS_TABLE,
    WATER_LINE_CANDIDATE_TABLE,
    WATER_POLYGON_CANDIDATE_TABLE,
} from "./import-review-promotion-promote-map.repo.js";
import {
    ImportReviewPromotionPromoteLanduseRepository,
    CORE_LANDUSE_TABLE,
    LANDUSE_CANDIDATE_TABLE,
} from "./import-review-promotion-promote-landuse.repo.js";
import {
    ImportReviewPromotionPromoteRoadsRepository,
    CORE_STREETS_TABLE,
} from "./import-review-promotion-promote-roads.repo.js";
import {
    ADMIN_AREA_CANDIDATE_TABLE,
    CORE_ADMIN_AREAS_TABLE,
    ImportReviewPromotionPromoteAdminAreasRepository,
} from "./import-review-promotion-promote-admin-areas.repo.js";
import { ROAD_CANDIDATE_TABLE, ImportReviewPromotionRoadDryRunRepository } from "./import-review-promotion-road-dry-run.repo.js";
import {
    ImportReviewPromotionPromoteRoutingBarriersRepository,
} from "./import-review-promotion-promote-routing-barriers.repo.js";
import { ImportReviewPromotionPromoteAddressesRepository } from "./import-review-promotion-promote-addresses.repo.js";
import {
    ROUTING_BARRIER_CANDIDATE_TABLE,
    ROUTING_BARRIER_TARGET_TABLE,
    ImportReviewPromotionRoutingBarrierDryRunRepository,
} from "./import-review-promotion-routing-barrier-dry-run.repo.js";
import {
    geomSourceExpr,
    buildingNormalizedDataMergeExpr,
    polygonToMultiPolygonSql,
    sourceRefsMergeExpr,
} from "./import-review-promotion-promote-sql.js";
import {
    promotionBuildingNamesUpsertSql,
    promotionTypedBuildingNameExpr,
} from "./import-review-promotion-typed-promote-sql.js";
import { getPromotionFamilyConfig } from "./import-review-promotion-simple-config.js";
import {
    applyImportReviewPromotionItemBookkeeping,
    promoteImportReviewItemCoreTx,
    promotionResultFromThrownError,
    type PromoteImportReviewItemConfig,
} from "./import-review-promotion-promote-item-tx.js";

export type { PromoteImportReviewItemConfig } from "./import-review-promotion-promote-item-tx.js";
export {
    applyImportReviewPromotionItemBookkeeping,
    promoteImportReviewItemCoreTx,
    promoteImportReviewItemTx,
} from "./import-review-promotion-promote-item-tx.js";

/**
 * Promote one publish item: core write in a transaction, then publish-item / candidate
 * bookkeeping on a clean connection so aborted SQL does not mask the root error.
 */
export async function promoteAndCommitImportReviewItem(
    prisma: PrismaClient,
    config: PromoteImportReviewItemConfig
): Promise<PromoteItemResult> {
    const repo = new ImportReviewPromotionPromoteRepository(
        prisma,
        new ImportReviewPromotionValidationRepository(prisma)
    );

    let coreResult: PromoteItemResult;
    try {
        coreResult = await prisma.$transaction((tx) => {
            const txRepo = new ImportReviewPromotionPromoteRepository(
                tx as PrismaClient,
                new ImportReviewPromotionValidationRepository(tx as PrismaClient)
            );
            return promoteImportReviewItemCoreTx(txRepo, config);
        });
    } catch (err) {
        coreResult = promotionResultFromThrownError(config.publishItemId, err);
    }

    return applyImportReviewPromotionItemBookkeeping(repo, config, coreResult);
}

const BUILDING_CANDIDATE_TABLE = "import_review.building_candidates";

const CORE_TABLE = "core.core_map_buildings";
const BUILDING_VERIFICATION_COLUMNS = getCoreVerificationColumnsForEntity("buildings");

export const DEFAULT_PROMOTE_CHUNK_SIZE = 100;
export const MAX_PROMOTE_CHUNK_SIZE = 500;

export type PromotableItemRow = {
    publish_item_id: bigint;
    entity_family: string;
    target_table: string;
    target_schema?: string;
    publish_action: string;
    publish_status: string;
    target_id: bigint | null;
    review_candidate_id: bigint;
    review_batch_id: bigint;
    source_snapshot_version: string;
    promotion_status: string | null;
    promoted_core_id: bigint | null;
    matched_core_id: bigint | null;
    external_id?: string | null;
};

/** Building candidate columns used for core INSERT/UPDATE (excludes geom to avoid ambiguous aliases). */
const PROMOTE_BUILDING_SRC_COLUMNS = Prisma.sql`
    spi.id AS publish_item_id,
    b.id,
    b.review_batch_id,
    b.source_snapshot_version,
    b.local_staging_id,
    b.external_id,
    b.name_en,
    b.name_mm,
    b.name,
    b.canonical_name,
    b.class_code,
    b.building_type,
    b.normalized_data,
    b.source_refs,
    b.building_type_id,
    b.admin_area_id,
    b.levels,
    b.height_m,
    b.area_m2,
    b.confidence_score,
    b.matched_core_id,
    b.geom AS candidate_geom
`;

const PROMOTE_PREP_ROW = (geomCaseSql: Prisma.Sql) => Prisma.sql`
    r.publish_item_id,
    r.id,
    r.review_batch_id,
    r.source_snapshot_version,
    r.local_staging_id,
    r.external_id,
    r.name_en,
    r.name_mm,
    r.name,
    r.canonical_name,
    r.class_code,
    r.building_type,
    r.normalized_data,
    r.source_refs,
    r.building_type_id,
    r.admin_area_id,
    r.levels,
    r.height_m,
    r.area_m2 AS candidate_area_m2,
    r.confidence_score,
    r.matched_core_id,
    ${geomCaseSql} AS geom
`;

const PROMOTE_READY_ROW = Prisma.sql`
    p.publish_item_id,
    p.id,
    p.review_batch_id,
    p.source_snapshot_version,
    p.local_staging_id,
    p.external_id,
    p.name_en,
    p.name_mm,
    p.name,
    p.canonical_name,
    p.class_code,
    p.building_type,
    p.normalized_data,
    p.source_refs,
    p.building_type_id,
    p.admin_area_id,
    p.levels,
    p.height_m,
    p.confidence_score,
    p.matched_core_id,
    p.geom,
    ST_PointOnSurface(p.geom)::geometry(Point, 4326) AS centroid,
    coalesce(p.candidate_area_m2, ST_Area(p.geom::geography)) AS area_m2
`;

export class ImportReviewPromotionPromoteRepository {
    private readonly placesRepo: ImportReviewPromotionPromotePlacesRepository;
    private readonly mapRepo: ImportReviewPromotionPromoteMapRepository;
    private readonly landuseRepo: ImportReviewPromotionPromoteLanduseRepository;
    private readonly roadsRepo: ImportReviewPromotionPromoteRoadsRepository;
    private readonly adminAreasRepo: ImportReviewPromotionPromoteAdminAreasRepository;
    private readonly routingBarriersRepo: ImportReviewPromotionPromoteRoutingBarriersRepository;
    private readonly addressesRepo: ImportReviewPromotionPromoteAddressesRepository;
    private readonly dryRunRepo: ImportReviewPromotionRoadDryRunRepository;
    private readonly routingBarrierDryRunRepo: ImportReviewPromotionRoutingBarrierDryRunRepository;
    private readonly publishSummaryRepo: ImportReviewPublishBatchSummaryRepository;
    private readonly reviewSummaryRepo: ImportReviewReviewBatchSummaryRepository;

    constructor(
        readonly prisma: PrismaClient,
        private readonly validationRepo: ImportReviewPromotionValidationRepository
    ) {
        this.placesRepo = new ImportReviewPromotionPromotePlacesRepository(prisma);
        this.mapRepo = new ImportReviewPromotionPromoteMapRepository(prisma);
        this.landuseRepo = new ImportReviewPromotionPromoteLanduseRepository(prisma);
        this.roadsRepo = new ImportReviewPromotionPromoteRoadsRepository(prisma);
        this.adminAreasRepo = new ImportReviewPromotionPromoteAdminAreasRepository(prisma);
        this.routingBarriersRepo = new ImportReviewPromotionPromoteRoutingBarriersRepository(prisma);
        this.addressesRepo = new ImportReviewPromotionPromoteAddressesRepository(prisma);
        this.dryRunRepo = new ImportReviewPromotionRoadDryRunRepository(prisma);
        this.routingBarrierDryRunRepo = new ImportReviewPromotionRoutingBarrierDryRunRepository(prisma);
        this.publishSummaryRepo = new ImportReviewPublishBatchSummaryRepository(prisma);
        this.reviewSummaryRepo = new ImportReviewReviewBatchSummaryRepository(prisma);
    }

    async fetchBatchProgress(batchId: bigint): Promise<ImportReviewPublishBatchProgressRow | null> {
        return this.validationRepo.fetchBatchProgress(batchId);
    }

    async readRoadDryRunResult(batchId: bigint) {
        return this.dryRunRepo.readRoadDryRunResult(batchId);
    }

    async readRoadDryRunSummary(batchId: bigint) {
        return this.dryRunRepo.readRoadDryRunSummary(batchId);
    }

    async readRoutingReadinessSummary(batchId: bigint) {
        return this.dryRunRepo.readRoutingReadinessSummary(batchId);
    }

    async readRoutingBarrierDryRunResult(batchId: bigint) {
        return this.routingBarrierDryRunRepo.readDryRunResult(batchId);
    }

    async countRoadPublishItems(batchId: bigint): Promise<number> {
        const rows = await this.prisma.$queryRaw<{ count: bigint }[]>`
            SELECT count(*)::bigint AS count
            FROM system.system_publish_items
            WHERE publish_batch_id = ${batchId}
              AND entity_family = 'roads'
        `;
        return Number(rows[0]?.count ?? 0n);
    }

    async countAdminAreaPublishItems(batchId: bigint): Promise<number> {
        const rows = await this.prisma.$queryRaw<{ count: bigint }[]>`
            SELECT count(*)::bigint AS count
            FROM system.system_publish_items
            WHERE publish_batch_id = ${batchId}
              AND entity_family = 'admin_areas'
        `;
        return Number(rows[0]?.count ?? 0n);
    }

    async countRoutingBarrierPublishItems(batchId: bigint): Promise<number> {
        const rows = await this.prisma.$queryRaw<{ count: bigint }[]>`
            SELECT count(*)::bigint AS count
            FROM system.system_publish_items
            WHERE publish_batch_id = ${batchId}
              AND entity_family = 'routing_barriers'
        `;
        return Number(rows[0]?.count ?? 0n);
    }

    async clearStageLogs(batchId: bigint): Promise<void> {
        return this.validationRepo.clearStageLogs(batchId);
    }

    async seedPromotionStageLogs(
        batchId: bigint,
        stages: readonly PromotionWorkflowStageDef[]
    ): Promise<void> {
        for (const stage of stages) {
            await this.prisma.$executeRaw`
                INSERT INTO system.system_publish_stage_logs (
                    publish_batch_id, stage_key, stage_label, stage_status,
                    message, progress_percent, details, started_at
                )
                VALUES (
                    ${batchId}, ${stage.key}, ${stage.label}, 'pending',
                    NULL, 0, '{}'::jsonb, now()
                )
            `;
        }
    }

    async updateStageLog(args: {
        batchId: bigint;
        stageKey: ImportReviewPublishPromotionStageKey;
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
                SET stage_status = ${stageStatus},
                    message = ${args.message ?? null},
                    progress_percent = ${args.progressPercent},
                    details = ${detailsJson}::jsonb,
                    finished_at = now()
                WHERE publish_batch_id = ${args.batchId} AND stage_key = ${args.stageKey}
            `;
        } else {
            await this.prisma.$executeRaw`
                UPDATE system.system_publish_stage_logs
                SET stage_status = ${stageStatus},
                    message = ${args.message ?? null},
                    progress_percent = ${args.progressPercent},
                    details = ${detailsJson}::jsonb,
                    started_at = CASE WHEN stage_status = 'pending' THEN now() ELSE started_at END
                WHERE publish_batch_id = ${args.batchId} AND stage_key = ${args.stageKey}
            `;
        }
    }

    async listPromotionStageLogs(batchId: bigint): Promise<PromotionStageLogSnapshot[]> {
        const rows = await this.validationRepo.listStageLogs(batchId);
        return rows.map((row) => ({
            stage_key: row.stage_key,
            stage_status: row.stage_status,
            finished_at: row.finished_at,
            message: row.message,
        }));
    }

    async reconcilePromotionStageLogs(args: {
        batchId: bigint;
        stagePlan: PromotionStagePlan;
        batchStatus: string;
        failedStageKey?: string | null;
        failureMessage?: string | null;
        promotionLogsSummary?: string | null;
        familyPromotedCounts?: Readonly<Record<string, number>>;
    }): Promise<number> {
        const logs = await this.listPromotionStageLogs(args.batchId);
        const updates = buildPromotionStageReconcileUpdates(args.stagePlan, logs, {
            batchStatus: args.batchStatus,
            failedStageKey: args.failedStageKey,
            failureMessage: args.failureMessage,
            promotionLogsSummary: args.promotionLogsSummary,
            familyPromotedCounts: args.familyPromotedCounts,
        });
        for (const update of updates) {
            await this.updateStageLog({
                batchId: args.batchId,
                stageKey: update.stageKey,
                stageStatus: update.stageStatus,
                message: update.message,
                progressPercent: update.progressPercent,
                finished: update.finished,
            });
        }
        return updates.length;
    }

    async updateBatchProgress(args: {
        batchId: bigint;
        validationTotal?: number;
        validationDone?: number;
        validationPercent: number;
    }): Promise<void> {
        return this.validationRepo.updateBatchProgress(args);
    }

    async claimBatchForPromotion(
        batchId: bigint,
        promotableTotal: number
    ): Promise<{ claimed: boolean; status: string | null }> {
        const total = Math.max(0, promotableTotal);
        const rows = await this.prisma.$queryRaw<{ id: bigint; status: string }[]>`
            UPDATE system.system_publish_batches
            SET
                status = 'promoting',
                validation_total = ${total},
                validation_done = 0,
                validation_percent = 0
            WHERE id = ${batchId}
              AND status NOT IN ('validating', 'promoting')
              AND validation_percent = 100
              AND validated_at IS NOT NULL
            RETURNING id, status
        `;
        if (rows.length > 0) {
            return { claimed: true, status: "promoting" };
        }
        const current = await this.fetchBatchProgress(batchId);
        return { claimed: false, status: current?.status ?? null };
    }

    parsePromotionHeartbeatAnchor(summary: unknown): Date | null {
        return parsePromotionHeartbeatFromSummary(summary);
    }

    async mergePromotionSummaryPatch(
        batchId: bigint,
        patch: Record<string, unknown>
    ): Promise<void> {
        const patchJson = JSON.stringify(patch);
        await this.prisma.$executeRaw`
            UPDATE system.system_publish_batches
            SET summary = coalesce(summary, '{}'::jsonb) || ${patchJson}::jsonb
            WHERE id = ${batchId}
        `;
    }

    async touchPromotionHeartbeat(
        batchId: bigint,
        args: {
            attemptId: string;
            progressTotal: number;
            progressDone: number;
            stageDetails?: Record<string, unknown>;
        }
    ): Promise<void> {
        const nowIso = new Date().toISOString();
        await this.mergePromotionSummaryPatch(batchId, {
            promotion_attempt_id: args.attemptId,
            promotion_heartbeat_at: nowIso,
            promotion_progress_total: args.progressTotal,
            promotion_progress_done: args.progressDone,
        });
    }

    async isPromotionCancelRequested(batchId: bigint): Promise<boolean> {
        const batch = await this.fetchBatchProgress(batchId);
        if (!batch?.summary) {
            return false;
        }
        return parsePromotionCancelRequestedFromSummary(batch.summary) != null;
    }

    async requestPromotionCancel(batchId: bigint): Promise<void> {
        await this.mergePromotionSummaryPatch(batchId, {
            promotion_cancel_requested_at: new Date().toISOString(),
        });
    }

    async failRunningPromotionStages(batchId: bigint, message: string): Promise<void> {
        const detailsJson = JSON.stringify({
            promotion_aborted: true,
            aborted_at: new Date().toISOString(),
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

    async skipPendingPromotionStages(batchId: bigint, message: string): Promise<void> {
        await this.prisma.$executeRaw`
            UPDATE system.system_publish_stage_logs
            SET
                stage_status = 'skipped',
                message = ${message},
                finished_at = now()
            WHERE publish_batch_id = ${batchId}
              AND stage_status = 'pending'
        `;
    }

    async finalizePromotionAborted(args: {
        batchId: bigint;
        reason: "cancelled" | "stale_worker";
        message: string;
    }): Promise<void> {
        const counts = await this.countPublishItemsByStatus(args.batchId);
        const nextStatus =
            counts.success > 0 ? "partial" : counts.pending > 0 ? "ready" : "failed";
        const logsSummary = args.message;
        const summary = JSON.stringify({
            promotion_status: "promotion_failed",
            promotion_logs_summary: logsSummary,
            promotion_aborted: true,
            promotion_abort_reason: args.reason,
            promotion_cancel_requested_at: null,
        });

        await this.failRunningPromotionStages(args.batchId, args.message);
        await this.skipPendingPromotionStages(args.batchId, "Skipped (promotion aborted).");

        await this.prisma.$executeRaw`
            UPDATE system.system_publish_batches
            SET
                status = ${nextStatus},
                validation_percent = 100,
                validation_done = validation_total,
                summary = coalesce(summary, '{}'::jsonb) || ${summary}::jsonb
            WHERE id = ${args.batchId}
        `;
    }

    async resetPromotionWorkerState(batchId: bigint): Promise<void> {
        const counts = await this.countPublishItemsByStatus(batchId);
        const nextStatus = counts.success > 0 ? "partial" : "ready";
        const patch = JSON.stringify({
            promotion_cancel_requested_at: null,
            promotion_heartbeat_at: null,
            promotion_aborted: false,
            promotion_abort_reason: null,
        });
        await this.failRunningPromotionStages(
            batchId,
            "Promotion worker reset. You can start promotion again for pending ready items."
        );
        await this.skipPendingPromotionStages(batchId, "Skipped (promotion reset).");
        await this.prisma.$executeRaw`
            UPDATE system.system_publish_batches
            SET
                status = ${nextStatus},
                validation_percent = 100,
                validation_done = validation_total,
                summary = coalesce(summary, '{}'::jsonb) || ${patch}::jsonb
            WHERE id = ${batchId}
        `;
    }

    async clearDryRunResult(batchId: bigint): Promise<void> {
        await this.prisma.$executeRaw`
            UPDATE system.system_publish_batches
            SET summary = summary - 'dry_run_result'
            WHERE id = ${batchId}
        `;
    }

    async resetFailedPromotionItems(batchId: bigint): Promise<{ reset_item_count: number }> {
        const failedRows = await this.prisma.$queryRaw<
            {
                id: bigint;
                entity_family: string;
                review_candidate_id: bigint | null;
            }[]
        >`
            SELECT id, entity_family, review_candidate_id
            FROM system.system_publish_items
            WHERE publish_batch_id = ${batchId}
              AND publish_status = 'failed'
            ORDER BY id ASC
        `;

        for (const row of failedRows) {
            if (row.review_candidate_id != null) {
                await this.releaseCandidateAfterPromotionFailure(
                    row.entity_family as ImportReviewEntityFamilySlug,
                    row.review_candidate_id
                );
            }
        }

        const resetCount = failedRows.length;
        if (resetCount === 0) {
            return { reset_item_count: 0 };
        }

        await this.prisma.$executeRaw`
            UPDATE system.system_publish_items
            SET
                publish_status = 'pending',
                error_message = NULL,
                after_data = NULL
            WHERE publish_batch_id = ${batchId}
              AND publish_status = 'failed'
        `;

        const counts = await this.countPublishItemsByStatus(batchId);
        const nextStatus = counts.success > 0 ? "partial" : "ready";
        const summaryPatch = JSON.stringify({
            promotion_status: counts.success > 0 ? "partially_promoted" : null,
            promotion_aborted: false,
            promotion_abort_reason: null,
            promotion_cancel_requested_at: null,
        });

        await this.prisma.$executeRaw`
            UPDATE system.system_publish_batches
            SET
                status = ${nextStatus},
                success_count = ${counts.success},
                failed_count = ${counts.failed},
                skipped_count = ${counts.skipped},
                summary = coalesce(summary, '{}'::jsonb) || ${summaryPatch}::jsonb
            WHERE id = ${batchId}
        `;

        return { reset_item_count: resetCount };
    }

    async countReservedNonPromotableItems(batchId: bigint): Promise<number> {
        const rows = await this.prisma.$queryRaw<{ count: bigint }[]>`
            SELECT count(*)::bigint AS count
            FROM system.system_publish_items
            WHERE publish_batch_id = ${batchId}
              AND entity_family NOT IN (${Prisma.join(PROMOTABLE_PUBLISH_FAMILIES)})
        `;
        return Number(rows[0]?.count ?? 0n);
    }

    async countBlockedPendingItems(batchId: bigint): Promise<number> {
        const rows = await this.prisma.$queryRaw<{ count: bigint }[]>`
            SELECT count(*)::bigint AS count
            FROM system.system_publish_items
            WHERE publish_batch_id = ${batchId}
              AND publish_status = 'pending'
              AND coalesce(validation_result->>'status', '') = 'blocked'
        `;
        return Number(rows[0]?.count ?? 0n);
    }

    async fetchPublishItemValidationResult(
        publishItemId: bigint
    ): Promise<unknown | null> {
        const rows = await this.prisma.$queryRaw<{ validation_result: unknown }[]>`
            SELECT validation_result
            FROM system.system_publish_items
            WHERE id = ${publishItemId}
            LIMIT 1
        `;
        return rows[0]?.validation_result ?? null;
    }

    async listPendingPublishItemValidationRows(
        batchId: bigint
    ): Promise<Array<{ publish_item_id: bigint; validation_result: unknown }>> {
        return this.prisma.$queryRaw<
            { publish_item_id: bigint; validation_result: unknown }[]
        >`
            SELECT id AS publish_item_id, validation_result
            FROM system.system_publish_items
            WHERE publish_batch_id = ${batchId}
              AND publish_status = 'pending'
              AND entity_family IN (${Prisma.join(PROMOTABLE_PUBLISH_FAMILIES)})
        `;
    }

    async listPendingPublishItemEntityFamilies(
        batchId: bigint
    ): Promise<Array<{ publish_item_id: bigint; entity_family: string }>> {
        return this.prisma.$queryRaw<{ publish_item_id: bigint; entity_family: string }[]>`
            SELECT id AS publish_item_id, entity_family::text AS entity_family
            FROM system.system_publish_items
            WHERE publish_batch_id = ${batchId}
              AND publish_status = 'pending'
              AND entity_family IN (${Prisma.join(PROMOTABLE_PUBLISH_FAMILIES)})
        `;
    }

    /**
     * Pending items allowed to promote for this run (publish-item validation_result authority).
     */
    async listPromotablePendingPublishItemIds(
        batchId: bigint,
        gate: PublishItemPromotionGateInput = {}
    ): Promise<bigint[]> {
        return (await this.selectPublishItemsForPromotion(batchId, gate)).promotableIds;
    }

    async selectPublishItemsForPromotion(
        batchId: bigint,
        gate: PublishItemPromotionGateInput = {}
    ) {
        const rows = await this.listPendingPublishItemValidationRows(batchId);
        return classifyPublishItemsForPromotion(rows as PublishItemValidationRow[], gate);
    }

    async countPublishItemsByStatus(batchId: bigint): Promise<{
        pending: number;
        success: number;
        failed: number;
        skipped: number;
        total: number;
    }> {
        const rows = await this.prisma.$queryRaw<
            { pending: bigint; success: bigint; failed: bigint; skipped: bigint; total: bigint }[]
        >`
            SELECT
                count(*) FILTER (WHERE publish_status = 'pending')::bigint AS pending,
                count(*) FILTER (WHERE publish_status = 'success')::bigint AS success,
                count(*) FILTER (WHERE publish_status = 'failed')::bigint AS failed,
                count(*) FILTER (WHERE publish_status = 'skipped')::bigint AS skipped,
                count(*)::bigint AS total
            FROM system.system_publish_items
            WHERE publish_batch_id = ${batchId}
        `;
        const r = rows[0];
        return {
            pending: Number(r?.pending ?? 0n),
            success: Number(r?.success ?? 0n),
            failed: Number(r?.failed ?? 0n),
            skipped: Number(r?.skipped ?? 0n),
            total: Number(r?.total ?? 0n),
        };
    }

    /** @deprecated Use countReservedNonPromotableItems */
    async countNonBuildingItems(batchId: bigint): Promise<number> {
        return this.countReservedNonPromotableItems(batchId);
    }

    async countPendingByEntityFamily(
        batchId: bigint
    ): Promise<Record<PromotablePublishEntityFamily, number>> {
        const rows = await this.prisma.$queryRaw<{ entity_family: string; count: bigint }[]>`
            SELECT entity_family, count(*)::bigint AS count
            FROM system.system_publish_items
            WHERE publish_batch_id = ${batchId}
              AND entity_family IN (${Prisma.join(PROMOTABLE_PUBLISH_FAMILIES)})
              AND publish_status = 'pending'
            GROUP BY entity_family
        `;
        const out = Object.fromEntries(
            PROMOTABLE_PUBLISH_FAMILIES.map((f) => [f, 0])
        ) as Record<PromotablePublishEntityFamily, number>;
        for (const row of rows) {
            if ((PROMOTABLE_PUBLISH_FAMILIES as readonly string[]).includes(row.entity_family)) {
                out[row.entity_family as PromotablePublishEntityFamily] = Number(row.count);
            }
        }
        return out;
    }

    async listPromotableItems(batchId: bigint): Promise<PromotableItemRow[]> {
        return this.prisma.$queryRaw<PromotableItemRow[]>`
            SELECT * FROM (
                SELECT
                    spi.id AS publish_item_id,
                    'buildings'::text AS entity_family,
                    ${CORE_TABLE} AS target_table,
                    spi.publish_action,
                    spi.publish_status,
                    spi.target_id,
                    spi.review_candidate_id,
                    b.review_batch_id,
                    b.source_snapshot_version,
                    b.promotion_status,
                    b.promoted_core_id,
                    b.matched_core_id
                FROM system.system_publish_items AS spi
                INNER JOIN import_review.building_candidates AS b
                    ON b.id = spi.review_candidate_id
                   AND spi.review_candidate_table = ${BUILDING_CANDIDATE_TABLE}
                WHERE spi.publish_batch_id = ${batchId}
                  AND spi.entity_family = 'buildings'
                UNION ALL
                SELECT
                    spi.id AS publish_item_id,
                    'places'::text AS entity_family,
                    ${CORE_PLACES_TABLE} AS target_table,
                    spi.publish_action,
                    spi.publish_status,
                    spi.target_id,
                    spi.review_candidate_id,
                    p.review_batch_id,
                    p.source_snapshot_version,
                    p.promotion_status,
                    p.promoted_core_id,
                    p.matched_core_id
                FROM system.system_publish_items AS spi
                INNER JOIN import_review.place_candidates AS p
                    ON p.id = spi.review_candidate_id
                   AND spi.review_candidate_table = ${PLACE_CANDIDATE_TABLE}
                WHERE spi.publish_batch_id = ${batchId}
                  AND spi.entity_family = 'places'
                UNION ALL
                SELECT
                    spi.id AS publish_item_id,
                    'landuse'::text AS entity_family,
                    ${CORE_LANDUSE_TABLE} AS target_table,
                    spi.publish_action,
                    spi.publish_status,
                    spi.target_id,
                    spi.review_candidate_id,
                    lu.review_batch_id,
                    lu.source_snapshot_version,
                    lu.promotion_status,
                    lu.promoted_core_id,
                    lu.matched_core_id
                FROM system.system_publish_items AS spi
                INNER JOIN import_review.landuse_candidates AS lu
                    ON lu.id = spi.review_candidate_id
                   AND spi.review_candidate_table = ${LANDUSE_CANDIDATE_TABLE}
                WHERE spi.publish_batch_id = ${batchId}
                  AND spi.entity_family = 'landuse'
                UNION ALL
                SELECT
                    spi.id AS publish_item_id,
                    'water_lines'::text AS entity_family,
                    ${CORE_WATER_LINES_TABLE} AS target_table,
                    spi.publish_action,
                    spi.publish_status,
                    spi.target_id,
                    spi.review_candidate_id,
                    wl.review_batch_id,
                    wl.source_snapshot_version,
                    wl.promotion_status,
                    wl.promoted_core_id,
                    wl.matched_core_id
                FROM system.system_publish_items AS spi
                INNER JOIN import_review.water_line_candidates AS wl
                    ON wl.id = spi.review_candidate_id
                   AND spi.review_candidate_table = ${WATER_LINE_CANDIDATE_TABLE}
                WHERE spi.publish_batch_id = ${batchId}
                  AND spi.entity_family = 'water_lines'
                UNION ALL
                SELECT
                    spi.id AS publish_item_id,
                    'water_polygons'::text AS entity_family,
                    ${CORE_WATER_POLYGONS_TABLE} AS target_table,
                    spi.publish_action,
                    spi.publish_status,
                    spi.target_id,
                    spi.review_candidate_id,
                    wp.review_batch_id,
                    wp.source_snapshot_version,
                    wp.promotion_status,
                    wp.promoted_core_id,
                    wp.matched_core_id
                FROM system.system_publish_items AS spi
                INNER JOIN import_review.water_polygon_candidates AS wp
                    ON wp.id = spi.review_candidate_id
                   AND spi.review_candidate_table = ${WATER_POLYGON_CANDIDATE_TABLE}
                WHERE spi.publish_batch_id = ${batchId}
                  AND spi.entity_family = 'water_polygons'
                UNION ALL
                SELECT
                    spi.id AS publish_item_id,
                    'roads'::text AS entity_family,
                    ${CORE_STREETS_TABLE} AS target_table,
                    spi.publish_action,
                    spi.publish_status,
                    spi.target_id,
                    spi.review_candidate_id,
                    r.review_batch_id,
                    r.source_snapshot_version,
                    r.promotion_status,
                    r.promoted_core_id,
                    r.matched_core_id
                FROM system.system_publish_items AS spi
                INNER JOIN import_review.road_candidates AS r
                    ON r.id = spi.review_candidate_id
                   AND spi.review_candidate_table = ${ROAD_CANDIDATE_TABLE}
                WHERE spi.publish_batch_id = ${batchId}
                  AND spi.entity_family = 'roads'
                UNION ALL
                SELECT
                    spi.id AS publish_item_id,
                    'addresses'::text AS entity_family,
                    'core.core_addresses' AS target_table,
                    spi.publish_action,
                    spi.publish_status,
                    spi.target_id,
                    spi.review_candidate_id,
                    a.review_batch_id,
                    a.source_snapshot_version,
                    a.promotion_status,
                    a.promoted_core_id,
                    a.matched_core_id
                FROM system.system_publish_items AS spi
                INNER JOIN import_review.address_candidates AS a
                    ON a.id = spi.review_candidate_id
                   AND spi.review_candidate_table = 'import_review.address_candidates'
                WHERE spi.publish_batch_id = ${batchId}
                  AND spi.entity_family = 'addresses'
                UNION ALL
                SELECT
                    spi.id AS publish_item_id,
                    'admin_areas'::text AS entity_family,
                    ${CORE_ADMIN_AREAS_TABLE} AS target_table,
                    spi.publish_action,
                    spi.publish_status,
                    spi.target_id,
                    spi.review_candidate_id,
                    aa.review_batch_id,
                    aa.source_snapshot_version,
                    aa.promotion_status,
                    aa.promoted_core_id,
                    aa.matched_core_id
                FROM system.system_publish_items AS spi
                INNER JOIN import_review.admin_area_candidates AS aa
                    ON aa.id = spi.review_candidate_id
                   AND spi.review_candidate_table = ${ADMIN_AREA_CANDIDATE_TABLE}
                WHERE spi.publish_batch_id = ${batchId}
                  AND spi.entity_family = 'admin_areas'
                UNION ALL
                SELECT
                    spi.id AS publish_item_id,
                    'routing_barriers'::text AS entity_family,
                    ${ROUTING_BARRIER_TARGET_TABLE} AS target_table,
                    spi.publish_action,
                    spi.publish_status,
                    spi.target_id,
                    spi.review_candidate_id,
                    rb.review_batch_id,
                    rb.source_snapshot_version,
                    rb.promotion_status,
                    rb.promoted_core_id,
                    rb.matched_core_id
                FROM system.system_publish_items AS spi
                INNER JOIN import_review.routing_barrier_candidates AS rb
                    ON rb.id = spi.review_candidate_id
                   AND spi.review_candidate_table = ${ROUTING_BARRIER_CANDIDATE_TABLE}
                WHERE spi.publish_batch_id = ${batchId}
                  AND spi.entity_family = 'routing_barriers'
            ) AS items
            WHERE publish_status = 'pending'
            ORDER BY entity_family ASC, publish_item_id ASC
        `;
    }

    async countPendingPromotableItems(
        batchId: bigint,
        gate: PublishItemPromotionGateInput = {}
    ): Promise<number> {
        const ids = await this.listPromotablePendingPublishItemIds(batchId, gate);
        return ids.length;
    }

    async countByPublishAction(
        batchId: bigint
    ): Promise<{ insert: number; update: number; merge: number }> {
        const rows = await this.prisma.$queryRaw<{ insert: bigint; update: bigint; merge: bigint }[]>`
            SELECT
                count(*) FILTER (WHERE publish_action = 'insert')::bigint AS insert,
                count(*) FILTER (WHERE publish_action = 'update')::bigint AS update,
                count(*) FILTER (WHERE publish_action = 'merge')::bigint AS merge
            FROM system.system_publish_items
            WHERE publish_batch_id = ${batchId}
              AND entity_family IN (${Prisma.join(PROMOTABLE_PUBLISH_FAMILIES)})
        `;
        const r = rows[0];
        return {
            insert: Number(r?.insert ?? 0n),
            update: Number(r?.update ?? 0n),
            merge: Number(r?.merge ?? 0n),
        };
    }

    async runFinalValidationBeforeWrite(
        itemIds: bigint[],
        gate: PublishItemPromotionGateInput = {}
    ): Promise<number> {
        return countPromotableWriteBlockers(this.prisma, itemIds, gate);
    }

    async countPromotionPreflightSkips(batchId: bigint) {
        return countPromotionPreflightSkips(this.prisma, batchId);
    }

    async countByPublishActionForIds(
        batchId: bigint,
        itemIds: readonly bigint[]
    ): Promise<{ insert: number; update: number; merge: number }> {
        if (itemIds.length === 0) {
            return { insert: 0, update: 0, merge: 0 };
        }
        const rows = await this.prisma.$queryRaw<{ insert: bigint; update: bigint; merge: bigint }[]>`
            SELECT
                count(*) FILTER (WHERE publish_action = 'insert')::bigint AS insert,
                count(*) FILTER (WHERE publish_action = 'update')::bigint AS update,
                count(*) FILTER (WHERE publish_action = 'merge')::bigint AS merge
            FROM system.system_publish_items
            WHERE publish_batch_id = ${batchId}
              AND id IN (${Prisma.join(itemIds)})
        `;
        const r = rows[0];
        return {
            insert: Number(r?.insert ?? 0n),
            update: Number(r?.update ?? 0n),
            merge: Number(r?.merge ?? 0n),
        };
    }

    async failBatch(batchId: bigint, message: string): Promise<void> {
        return this.validationRepo.failBatch(batchId, message, { promotion_error: message }, {
            terminalFailureErrorCode: PUBLISH_BATCH_PROMOTION_SYSTEM_ERROR_CODE,
        });
    }

    /**
     * Tx-safe core promotion for one publish item (no publish-item / candidate status writes).
     * Called only from {@link promoteImportReviewItemTx} inside an active transaction.
     */
    async promotePublishItemTx(args: {
        batchId: bigint;
        publishItemId: bigint;
        promotedBy: bigint | null;
        confirmWarnings?: boolean;
        promotionNote?: string;
    }): Promise<PromoteItemResult> {
        const itemRows = await this.listPromotableItems(args.batchId);
        const item = itemRows.find((r) => r.publish_item_id === args.publishItemId);
        if (!item) {
            return {
                publish_item_id: args.publishItemId,
                outcome: "failed",
                target_id: null,
                error_message: "Publish item not found.",
                before_data: null,
                after_data: null,
            };
        }

        if (item.publish_status === "success" && item.target_id != null) {
            const coreExists = await this.checkCoreRowExists(item.entity_family, item.target_id);
            if (coreExists) {
                return {
                    publish_item_id: args.publishItemId,
                    outcome: "skipped",
                    target_id: item.target_id,
                    error_message: null,
                    before_data: null,
                    after_data: { id: item.target_id.toString(), skipped: "already_success" },
                };
            }
        }

        if (item.promotion_status === "promoted" && item.promoted_core_id != null) {
            return {
                publish_item_id: args.publishItemId,
                outcome: "skipped",
                target_id: item.promoted_core_id,
                error_message: null,
                before_data: null,
                after_data: { id: item.promoted_core_id.toString(), skipped: "already_promoted" },
            };
        }

        if (item.publish_action === "merge") {
            if (item.entity_family === "places") {
                return this.placesRepo.promotePlaceTx(
                    this.prisma,
                    args.batchId,
                    args.publishItemId,
                    "merge",
                    args.promotedBy
                );
            }
            return {
                publish_item_id: args.publishItemId,
                outcome: "failed",
                target_id: null,
                error_message: "merge publish_action is only supported for places.",
                before_data: null,
                after_data: null,
            };
        }

        if (item.publish_action === "skip") {
            if (item.entity_family === "places") {
                return this.placesRepo.promotePlaceTx(
                    this.prisma,
                    args.batchId,
                    args.publishItemId,
                    "skip",
                    args.promotedBy
                );
            }
            return {
                publish_item_id: args.publishItemId,
                outcome: "skipped",
                target_id: item.matched_core_id ?? null,
                error_message: null,
                before_data: null,
                after_data: {
                    skipped: true,
                    publish_action: "skip",
                    entity_family: item.entity_family,
                },
            };
        }

        const publishValidation = await this.fetchPublishItemValidationResult(args.publishItemId);
        const promotionGate: PublishItemPromotionGateInput = {
            confirm_warnings: args.confirmWarnings,
            promotion_note: args.promotionNote,
            warning_confirmation_note: args.promotionNote,
            review_note: args.promotionNote,
        };
        const blockReason = publishItemPromotionBlockReason(publishValidation, promotionGate);
        if (blockReason !== null) {
            return {
                publish_item_id: args.publishItemId,
                outcome: "failed",
                target_id: null,
                error_message: blockReason,
                before_data: null,
                after_data: null,
            };
        }

        if (item.publish_action === "insert") {
            if (item.entity_family === "addresses") {
                return this.addressesRepo.promoteFromPublishItemTx(
                    this.prisma,
                    args.batchId,
                    args.publishItemId
                );
            }
            if (item.entity_family === "places") {
                return this.placesRepo.promotePlaceTx(
                    this.prisma,
                    args.batchId,
                    args.publishItemId,
                    "insert",
                    args.promotedBy
                );
            }
            if (item.entity_family === "landuse") {
                return this.landuseRepo.insertLanduseTx(
                    this.prisma,
                    args.batchId,
                    args.publishItemId
                );
            }
            if (item.entity_family === "roads") {
                const roadAction = await resolveRoadPromotionActionForPublishItem(
                    this.prisma,
                    args.batchId,
                    args.publishItemId
                );
                if (roadAction === "update") {
                    return this.roadsRepo.updateRoadForTx(
                        this.prisma,
                        args.batchId,
                        args.publishItemId,
                        args.promotedBy
                    );
                }
                return this.roadsRepo.insertRoadForTx(
                    this.prisma,
                    args.batchId,
                    args.publishItemId,
                    args.promotedBy
                );
            }
            if (item.entity_family === "admin_areas") {
                return this.adminAreasRepo.insertAdminAreaForTx(
                    this.prisma,
                    args.batchId,
                    args.publishItemId,
                    args.promotedBy
                );
            }
            if (item.entity_family === "routing_barriers") {
                return this.routingBarriersRepo.insertRoutingBarrierTx(
                    this.prisma,
                    args.batchId,
                    args.publishItemId
                );
            }
            const mapFamily = item.entity_family as PromotablePublishEntityFamily;
            if (this.mapRepo.isMapEntityFamily(mapFamily)) {
                return this.mapRepo.insertMapEntityTx(
                    this.prisma,
                    mapFamily,
                    args.batchId,
                    args.publishItemId
                );
            }
            return this.insertBuilding(args.batchId, args.publishItemId, args.promotedBy);
        }

        if (item.publish_action === "update") {
            if (item.entity_family === "addresses") {
                return this.addressesRepo.promoteFromPublishItemTx(
                    this.prisma,
                    args.batchId,
                    args.publishItemId
                );
            }
            if (item.entity_family === "places") {
                return this.placesRepo.promotePlaceTx(
                    this.prisma,
                    args.batchId,
                    args.publishItemId,
                    "update",
                    args.promotedBy
                );
            }
            if (item.entity_family === "landuse") {
                const beforeData = await this.landuseRepo.loadLanduseUpdateBeforeData(
                    this.prisma,
                    args.publishItemId
                );
                if (!beforeData) {
                    return {
                        publish_item_id: args.publishItemId,
                        outcome: "failed",
                        target_id: null,
                        error_message: "Update blocked: matched_core_id missing or core row inactive.",
                        before_data: null,
                        after_data: null,
                    };
                }
                try {
                    return await this.landuseRepo.updateLanduseTx(
                        this.prisma,
                        args.batchId,
                        args.publishItemId,
                        beforeData
                    );
                } catch (err) {
                    const message = err instanceof Error ? err.message : String(err);
                    return {
                        publish_item_id: args.publishItemId,
                        outcome: "failed",
                        target_id: null,
                        error_message: `Landuse promotion failed: ${message}`,
                        before_data: beforeData,
                        after_data: null,
                    };
                }
            }
            if (item.entity_family === "roads") {
                return this.roadsRepo.updateRoadForTx(
                    this.prisma,
                    args.batchId,
                    args.publishItemId,
                    args.promotedBy
                );
            }
            if (item.entity_family === "admin_areas") {
                return this.adminAreasRepo.updateAdminAreaForTx(
                    this.prisma,
                    args.batchId,
                    args.publishItemId,
                    args.promotedBy
                );
            }
            if (item.entity_family === "routing_barriers") {
                return this.routingBarriersRepo.updateRoutingBarrierTx(
                    this.prisma,
                    args.batchId,
                    args.publishItemId
                );
            }
            const mapFamily = item.entity_family as PromotablePublishEntityFamily;
            if (this.mapRepo.isMapEntityFamily(mapFamily)) {
                return this.mapRepo.updateMapEntityTx(
                    this.prisma,
                    mapFamily,
                    args.batchId,
                    args.publishItemId
                );
            }
            return this.updateBuilding(args.batchId, args.publishItemId, args.promotedBy);
        }

        return {
            publish_item_id: args.publishItemId,
            outcome: "failed",
            target_id: null,
            error_message: `Unsupported publish_action: ${item.publish_action}`,
            before_data: null,
            after_data: null,
        };
    }

    async promoteAndCommitItem(
        args: PromoteImportReviewItemConfig
    ): Promise<PromoteItemResult> {
        return promoteAndCommitImportReviewItem(this.prisma, args);
    }

    private async checkCoreRowExists(entityFamily: string, targetId: bigint): Promise<boolean> {
        if (entityFamily === "addresses") {
            return this.addressesRepo.checkAddressCoreExists(targetId);
        }
        if (entityFamily === "places") {
            return this.placesRepo.checkPlaceCoreExists(targetId);
        }
        if (entityFamily === "landuse") {
            return this.landuseRepo.checkLanduseCoreExists(targetId);
        }
        if (entityFamily === "roads") {
            return this.roadsRepo.checkRoadCoreExists(targetId);
        }
        if (entityFamily === "admin_areas") {
            return this.adminAreasRepo.checkAdminAreaCoreExists(targetId);
        }
        if (entityFamily === "routing_barriers") {
            return this.routingBarriersRepo.checkRoutingBarrierExists(targetId);
        }
        const mapFamily = entityFamily as PromotablePublishEntityFamily;
        if (this.mapRepo.isMapEntityFamily(mapFamily)) {
            return this.mapRepo.checkMapCoreExists(mapFamily, targetId);
        }
        const rows = await this.prisma.$queryRaw<{ id: bigint }[]>`
            SELECT id FROM core.core_map_buildings
            WHERE id = ${targetId}
              AND coalesce(is_active, true) AND deleted_at IS NULL
            LIMIT 1
        `;
        return rows.length > 0;
    }

    private async insertBuilding(
        batchId: bigint,
        publishItemId: bigint,
        _promotedBy: bigint | null
    ): Promise<PromoteItemResult> {
        const rows = await this.prisma.$queryRaw<
            {
                id: bigint;
                external_id: string | null;
                source_staging_id: bigint | null;
                name: string | null;
                class_code: string;
            }[]
        >`
            WITH src AS (
                SELECT ${PROMOTE_BUILDING_SRC_COLUMNS}
                FROM system.system_publish_items AS spi
                INNER JOIN import_review.building_candidates AS b
                    ON b.id = spi.review_candidate_id
                   AND spi.review_candidate_table = ${BUILDING_CANDIDATE_TABLE}
                WHERE spi.id = ${publishItemId}
                  AND spi.publish_batch_id = ${batchId}
            ),
            raw_geom AS (
                SELECT s.*, ${geomSourceExpr("s", "candidate_geom")} AS g_raw FROM src AS s
            ),
            prep AS (
                SELECT ${PROMOTE_PREP_ROW(polygonToMultiPolygonSql("r"))}
                FROM raw_geom AS r
            ),
            ready AS (
                SELECT ${PROMOTE_READY_ROW}
                FROM prep AS p
                WHERE p.geom IS NOT NULL
                  AND ST_IsValid(p.geom)
                  AND NOT ST_IsEmpty(p.geom)
                  AND ST_SRID(p.geom) = 4326
            ),
            guard AS (
                SELECT r.*
                FROM ready AS r
                WHERE NOT EXISTS (
                    SELECT 1 FROM core.core_map_buildings AS c
                    WHERE coalesce(c.is_active, true) AND c.deleted_at IS NULL
                      AND (
                          (r.external_id IS NOT NULL AND trim(r.external_id) <> '' AND c.external_id = r.external_id)
                          OR (r.local_staging_id IS NOT NULL AND c.source_staging_id = r.local_staging_id)
                      )
                )
            )
            INSERT INTO core.core_map_buildings (
                source_staging_id, external_id, name, normalized_data, source_refs,
                geom, building_type_id, admin_area_id, levels, height_m,
                centroid, area_m2, confidence_score${coreVerificationInsertColumnsSql(BUILDING_VERIFICATION_COLUMNS)}, is_active,
                created_at, updated_at, deleted_at
            )
            SELECT
                g.local_staging_id,
                nullif(trim(g.external_id), ''),
                ${promotionTypedBuildingNameExpr("g")},
                ${buildingNormalizedDataMergeExpr("g", batchId)},
                ${sourceRefsMergeExpr("g", batchId, "buildings")},
                g.geom,
                g.building_type_id,
                g.admin_area_id,
                g.levels,
                g.height_m,
                g.centroid,
                g.area_m2,
                coalesce(g.confidence_score, 80)${coreVerificationInsertValuesSql(BUILDING_VERIFICATION_COLUMNS)},
                true,
                now(),
                now(),
                NULL::timestamptz
            FROM guard AS g
            RETURNING id, external_id, source_staging_id, name, normalized_data->>'class_code' AS class_code
        `;

        if (rows.length === 0) {
            return {
                publish_item_id: publishItemId,
                outcome: "failed",
                target_id: null,
                error_message: "Insert blocked: duplicate core row, invalid geometry, or missing required fields.",
                before_data: null,
                after_data: null,
            };
        }

        const row = rows[0]!;
        await this.upsertBuildingNames(publishItemId, row.id);
        const verificationMeta = buildVerificationMetadataTracking({
            outcome: "inserted",
            beforeData: null,
            entityKey: "buildings",
        });
        return {
            publish_item_id: publishItemId,
            outcome: "inserted",
            target_id: row.id,
            error_message: null,
            before_data: null,
            after_data: {
                id: row.id.toString(),
                external_id: row.external_id,
                source_staging_id: row.source_staging_id?.toString() ?? null,
                name: row.name,
                class_code: row.class_code,
            },
            ...verificationMeta,
        };
    }

    private async updateBuilding(
        batchId: bigint,
        publishItemId: bigint,
        _promotedBy: bigint | null
    ): Promise<PromoteItemResult> {
        const beforeRows = await this.prisma.$queryRaw<{ row_json: unknown }[]>`
            SELECT to_jsonb(c) AS row_json
            FROM system.system_publish_items AS spi
            INNER JOIN import_review.building_candidates AS b
                ON b.id = spi.review_candidate_id
               AND spi.review_candidate_table = ${BUILDING_CANDIDATE_TABLE}
            INNER JOIN core.core_map_buildings AS c ON c.id = b.matched_core_id
            WHERE spi.id = ${publishItemId}
              AND coalesce(c.is_active, true) AND c.deleted_at IS NULL
              AND NOT (c.source_refs @> '{"source":"dashboard"}'::jsonb)
            LIMIT 1
        `;
        const beforeData = beforeRows[0]?.row_json ?? null;
        if (!beforeData) {
            return {
                publish_item_id: publishItemId,
                outcome: "failed",
                target_id: null,
                error_message:
                    "Update blocked: matched_core_id missing, core row inactive, or dashboard-protected target.",
                before_data: null,
                after_data: null,
            };
        }

        const rows = await this.prisma.$queryRaw<
            { id: bigint; external_id: string | null; name: string | null; class_code: string }[]
        >`
            WITH src AS (
                SELECT ${PROMOTE_BUILDING_SRC_COLUMNS}
                FROM system.system_publish_items AS spi
                INNER JOIN import_review.building_candidates AS b
                    ON b.id = spi.review_candidate_id
                   AND spi.review_candidate_table = ${BUILDING_CANDIDATE_TABLE}
                WHERE spi.id = ${publishItemId}
                  AND spi.publish_batch_id = ${batchId}
                  AND b.matched_core_id IS NOT NULL
            ),
            raw_geom AS (
                SELECT s.*, ${geomSourceExpr("s", "candidate_geom")} AS g_raw FROM src AS s
            ),
            prep AS (
                SELECT ${PROMOTE_PREP_ROW(polygonToMultiPolygonSql("r"))}
                FROM raw_geom AS r
            ),
            ready AS (
                SELECT ${PROMOTE_READY_ROW}
                FROM prep AS p
                WHERE p.geom IS NOT NULL AND ST_IsValid(p.geom) AND NOT ST_IsEmpty(p.geom)
            )
            UPDATE core.core_map_buildings AS c
            SET
                source_staging_id = r.local_staging_id,
                external_id = nullif(trim(r.external_id), ''),
                name = ${promotionTypedBuildingNameExpr("r")},
                normalized_data = ${buildingNormalizedDataMergeExpr("r", batchId)},
                source_refs = ${sourceRefsMergeExpr("r", batchId, "buildings")},
                geom = r.geom,
                building_type_id = r.building_type_id,
                admin_area_id = r.admin_area_id,
                levels = r.levels,
                height_m = r.height_m,
                centroid = r.centroid,
                area_m2 = r.area_m2,
                confidence_score = coalesce(r.confidence_score, c.confidence_score)${coreVerificationUpdateSetClauseSql("c", BUILDING_VERIFICATION_COLUMNS)},
                is_active = true,
                deleted_at = NULL,
                updated_at = now()
            FROM ready AS r
            WHERE c.id = r.matched_core_id
              AND coalesce(c.is_active, true) AND c.deleted_at IS NULL
              AND NOT (c.source_refs @> '{"source":"dashboard"}'::jsonb)
            RETURNING c.id, c.external_id, c.name, c.normalized_data->>'class_code' AS class_code
        `;

        if (rows.length === 0) {
            return {
                publish_item_id: publishItemId,
                outcome: "failed",
                target_id: null,
                error_message: "Update failed: geometry invalid or target not updatable.",
                before_data: beforeData,
                after_data: null,
            };
        }

        const row = rows[0]!;
        await this.upsertBuildingNames(publishItemId, row.id);
        const verificationMeta = buildVerificationMetadataTracking({
            outcome: "updated",
            beforeData,
            entityKey: "buildings",
        });
        return {
            publish_item_id: publishItemId,
            outcome: "updated",
            target_id: row.id,
            error_message: null,
            before_data: beforeData,
            after_data: {
                id: row.id.toString(),
                external_id: row.external_id,
                name: row.name,
                class_code: row.class_code,
            },
            ...verificationMeta,
        };
    }

    /** Write approved names to core.core_map_building_names (legacy buildings.name stays NULL). */
    private async upsertBuildingNames(publishItemId: bigint, buildingId: bigint): Promise<void> {
        await this.prisma.$executeRaw(
            promotionBuildingNamesUpsertSql({
                buildingId,
                publishItemId,
                candidateTable: BUILDING_CANDIDATE_TABLE,
            })
        );
    }

    async applyItemSuccess(args: {
        publishItemId: bigint;
        targetId: bigint | null;
        targetTable: string;
        entityFamily?: string;
        beforeData: unknown | null;
        afterData: unknown;
        appliedBy?: bigint | null;
    }): Promise<void> {
        const existingRows = await this.prisma.$queryRaw<
            { before_data: unknown; validation_result: unknown; after_data: unknown }[]
        >`
            SELECT before_data, validation_result, after_data
            FROM system.system_publish_items
            WHERE id = ${args.publishItemId}
            LIMIT 1
        `;
        const existing = existingRows[0] ?? {
            before_data: null,
            validation_result: null,
            after_data: null,
        };
        const durable = extractDurablePublishItemFields(existing);
        const mergedBefore = mergePublishItemBeforeData({
            existingBeforeData: existing.before_data,
            coreBeforeData: args.beforeData,
        });
        const mergedAfter = mergePublishItemAfterData({
            afterData: args.afterData,
            reviewDecision: durable.review_decision,
            appliedBy: args.appliedBy ?? null,
            sourceSnapshotVersion: durable.source_snapshot_version,
        });
        const afterJson = stringifyPromotionPayload(mergedAfter);
        const beforeJson =
            mergedBefore != null ? stringifyPromotionPayload(mergedBefore) : null;
        const familyConfig =
            args.entityFamily ? getPromotionFamilyConfig(args.entityFamily) : null;
        const targetSchema =
            familyConfig?.targetSchema ??
            (args.targetTable.startsWith("routing.") ? "routing" : "core");
        const targetTable =
            familyConfig?.targetTable ??
            (args.targetTable.includes(".") ? args.targetTable.split(".")[1]! : args.targetTable);
        await this.prisma.$executeRaw`
            UPDATE system.system_publish_items
            SET publish_status = 'success',
                target_id = ${args.targetId},
                target_schema = ${targetSchema},
                target_table = ${targetTable},
                before_data = ${beforeJson}::jsonb,
                after_data = ${afterJson}::jsonb,
                error_message = NULL,
                published_at = now(),
                review_decision = coalesce(
                    review_decision,
                    ${durable.review_decision}
                ),
                source_snapshot_version = coalesce(
                    source_snapshot_version,
                    ${durable.source_snapshot_version}
                ),
                applied_by = coalesce(
                    ${args.appliedBy ?? null}::bigint,
                    applied_by
                )
            WHERE id = ${args.publishItemId}
        `;
    }

    async applyItemFailure(args: {
        publishItemId: bigint;
        errorMessage: string;
        entityFamily?: string;
        reviewCandidateId?: bigint;
        externalId?: string | null;
        targetSchema?: string;
        targetTable?: string;
        publishAction?: string;
        technicalDetail?: unknown;
        failureCause?: PromotionFailureCause | null;
    }): Promise<void> {
        const cause =
            args.failureCause ?? extractPromotionFailureCause(new Error(args.errorMessage));
        const failure = buildPromotionItemFailureRecord({
            errorMessage: args.errorMessage,
            entityFamily: args.entityFamily,
            reviewCandidateId: args.reviewCandidateId,
            publishItemId: args.publishItemId,
            externalId: args.externalId,
            targetSchema: args.targetSchema,
            targetTable: args.targetTable,
            publishAction: args.publishAction,
            technicalDetail: args.technicalDetail,
            failureCause: cause,
        });
        const afterPayload = buildPublishItemFailureAfterData(failure, cause);
        const afterJson = stringifyPromotionPayload(afterPayload);
        await this.prisma.$executeRaw`
            UPDATE system.system_publish_items
            SET publish_status = 'failed',
                error_message = ${failure.error_message},
                after_data = ${afterJson}::jsonb
            WHERE id = ${args.publishItemId}
        `;
    }

    async listFailedPublishItemsForFamily(
        batchId: bigint,
        entityFamily: string
    ): Promise<
        {
            review_candidate_id: bigint | null;
            error_message: string | null;
            after_data: unknown;
        }[]
    > {
        return this.prisma.$queryRaw<
            {
                review_candidate_id: bigint | null;
                error_message: string | null;
                after_data: unknown;
            }[]
        >`
            SELECT review_candidate_id, error_message, after_data
            FROM system.system_publish_items
            WHERE publish_batch_id = ${batchId}
              AND entity_family = ${entityFamily}
              AND publish_status = 'failed'
            ORDER BY id ASC
        `;
    }

    async listPromotionFailureSamples(
        batchId: bigint,
        limit = 10
    ): Promise<PromotionFailureSample[]> {
        const capped = Math.min(50, Math.max(1, limit));
        const rows = await this.prisma.$queryRaw<
            {
                id: bigint;
                entity_family: string;
                review_candidate_id: bigint | null;
                external_id: string | null;
                target_schema: string | null;
                target_table: string | null;
                error_message: string | null;
                after_data: unknown;
            }[]
        >`
            SELECT
                id,
                entity_family,
                review_candidate_id,
                external_id,
                target_schema,
                target_table,
                error_message,
                after_data
            FROM system.system_publish_items
            WHERE publish_batch_id = ${batchId}
              AND publish_status = 'failed'
            ORDER BY id ASC
            LIMIT ${capped}
        `;
        const samples = rows.map((row) => promotionFailureSampleFromRow(row));
        return dedupePromotionFailureSamples(samples, Math.min(5, capped));
    }

    async markCandidatePromoted(args: {
        entityFamily: ImportReviewEntityFamilySlug;
        reviewCandidateId: bigint;
        promotedCoreId: bigint | null;
        promotedBy: bigint | null;
    }): Promise<void> {
        const candidateTable = getImportReviewPromotionCandidateTable(args.entityFamily);
        await this.prisma.$executeRaw`
            UPDATE ${Prisma.raw(candidateTable)}
            SET promotion_status = 'promoted',
                promoted_core_id = ${args.promotedCoreId},
                promoted_at = now(),
                promoted_by = ${args.promotedBy},
                review_status = 'promoted',
                updated_at = now()
            WHERE id = ${args.reviewCandidateId}
        `;
    }

    async markCandidateFailed(
        entityFamily: ImportReviewEntityFamilySlug,
        reviewCandidateId: bigint
    ): Promise<void> {
        const candidateTable = getImportReviewPromotionCandidateTable(entityFamily);
        await this.prisma.$executeRaw`
            UPDATE ${Prisma.raw(candidateTable)}
            SET promotion_status = 'failed',
                review_status = 'promotion_failed',
                updated_at = now()
            WHERE id = ${reviewCandidateId}
        `;
    }

    /** Failed publish items: release candidate for retry (not batched / not promotion_failed). */
    async releaseCandidateAfterPromotionFailure(
        entityFamily: ImportReviewEntityFamilySlug,
        reviewCandidateId: bigint
    ): Promise<void> {
        await releaseCandidateAfterPromotionFailureSql(
            this.prisma,
            entityFamily,
            reviewCandidateId
        );
    }

    async verifyCoreRows(
        batchId: bigint
    ): Promise<{ missing: number; invalid_geom: number; missing_names: number }> {
        const buildingRows = await this.prisma.$queryRaw<{ missing: bigint; invalid_geom: bigint }[]>`
            SELECT
                count(*) FILTER (
                    WHERE spi.publish_status = 'success'
                      AND (
                          spi.target_id IS NULL
                          OR c.id IS NULL
                          OR NOT coalesce(c.is_active, true)
                          OR c.deleted_at IS NOT NULL
                      )
                )::bigint AS missing,
                count(*) FILTER (
                    WHERE spi.publish_status = 'success'
                      AND c.id IS NOT NULL
                      AND (c.geom IS NULL OR NOT ST_IsValid(c.geom) OR ST_SRID(c.geom) <> 4326)
                )::bigint AS invalid_geom
            FROM system.system_publish_items AS spi
            LEFT JOIN core.core_map_buildings AS c ON c.id = spi.target_id
            WHERE spi.publish_batch_id = ${batchId}
              AND spi.entity_family = 'buildings'
        `;
        const placeRows = await this.prisma.$queryRaw<{ missing: bigint; invalid_geom: bigint; missing_names: bigint }[]>`
            SELECT
                count(*) FILTER (
                    WHERE spi.publish_status = 'success'
                      AND (
                          spi.target_id IS NULL
                          OR p.id IS NULL
                          OR p.deleted_at IS NOT NULL
                      )
                )::bigint AS missing,
                count(*) FILTER (
                    WHERE spi.publish_status = 'success'
                      AND p.id IS NOT NULL
                      AND (
                          p.point_geom IS NULL
                          OR NOT ST_IsValid(p.point_geom)
                          OR ST_SRID(p.point_geom) <> 4326
                      )
                )::bigint AS invalid_geom,
                count(*) FILTER (
                    WHERE spi.publish_status = 'success'
                      AND p.id IS NOT NULL
                      AND NOT EXISTS (
                          SELECT 1 FROM core.core_place_names AS pn WHERE pn.place_id = p.id
                      )
                )::bigint AS missing_names
            FROM system.system_publish_items AS spi
            LEFT JOIN core.core_places AS p ON p.id = spi.target_id
            WHERE spi.publish_batch_id = ${batchId}
              AND spi.entity_family = 'places'
        `;
        const mapPolygonRows = await this.prisma.$queryRaw<{ missing: bigint; invalid_geom: bigint }[]>`
            SELECT
                count(*) FILTER (
                    WHERE spi.publish_status = 'success'
                      AND (
                          spi.target_id IS NULL
                          OR c.id IS NULL
                          OR NOT coalesce(c.is_active, true)
                          OR c.source_refs->>'review_candidate_id' IS NULL
                          OR c.source_refs->>'publish_batch_id' IS NULL
                      )
                )::bigint AS missing,
                count(*) FILTER (
                    WHERE spi.publish_status = 'success'
                      AND c.id IS NOT NULL
                      AND (
                          c.geom IS NULL
                          OR NOT ST_IsValid(c.geom)
                          OR ST_SRID(c.geom) <> 4326
                          OR ST_GeometryType(c.geom) NOT IN ('ST_Polygon', 'ST_MultiPolygon')
                      )
                )::bigint AS invalid_geom
            FROM system.system_publish_items AS spi
            LEFT JOIN core.core_map_landuse AS c ON c.id = spi.target_id
            WHERE spi.publish_batch_id = ${batchId}
              AND spi.entity_family = 'landuse'
        `;
        const waterLineRows = await this.prisma.$queryRaw<{ missing: bigint; invalid_geom: bigint }[]>`
            SELECT
                count(*) FILTER (
                    WHERE spi.publish_status = 'success'
                      AND (
                          spi.target_id IS NULL
                          OR c.id IS NULL
                          OR NOT coalesce(c.is_active, true)
                          OR c.source_refs->>'review_candidate_id' IS NULL
                          OR c.source_refs->>'publish_batch_id' IS NULL
                      )
                )::bigint AS missing,
                count(*) FILTER (
                    WHERE spi.publish_status = 'success'
                      AND c.id IS NOT NULL
                      AND (
                          c.geom IS NULL
                          OR NOT ST_IsValid(c.geom)
                          OR ST_SRID(c.geom) <> 4326
                          OR ST_GeometryType(c.geom) NOT IN ('ST_LineString', 'ST_MultiLineString')
                      )
                )::bigint AS invalid_geom
            FROM system.system_publish_items AS spi
            LEFT JOIN core.core_map_water_lines AS c ON c.id = spi.target_id
            WHERE spi.publish_batch_id = ${batchId}
              AND spi.entity_family = 'water_lines'
        `;
        const waterPolygonRows = await this.prisma.$queryRaw<{ missing: bigint; invalid_geom: bigint }[]>`
            SELECT
                count(*) FILTER (
                    WHERE spi.publish_status = 'success'
                      AND (
                          spi.target_id IS NULL
                          OR c.id IS NULL
                          OR NOT coalesce(c.is_active, true)
                          OR c.source_refs->>'review_candidate_id' IS NULL
                          OR c.source_refs->>'publish_batch_id' IS NULL
                      )
                )::bigint AS missing,
                count(*) FILTER (
                    WHERE spi.publish_status = 'success'
                      AND c.id IS NOT NULL
                      AND (
                          c.geom IS NULL
                          OR NOT ST_IsValid(c.geom)
                          OR ST_SRID(c.geom) <> 4326
                          OR ST_GeometryType(c.geom) NOT IN ('ST_Polygon', 'ST_MultiPolygon')
                      )
                )::bigint AS invalid_geom
            FROM system.system_publish_items AS spi
            LEFT JOIN core.core_map_water_polygons AS c ON c.id = spi.target_id
            WHERE spi.publish_batch_id = ${batchId}
              AND spi.entity_family = 'water_polygons'
        `;
        const roadRows = await this.prisma.$queryRaw<{ missing: bigint; invalid_geom: bigint }[]>`
            SELECT
                count(*) FILTER (
                    WHERE spi.publish_status = 'success'
                      AND (
                          spi.target_id IS NULL
                          OR s.id IS NULL
                          OR NOT coalesce(s.is_active, true)
                          OR s.deleted_at IS NOT NULL
                          OR s.source_refs->>'review_candidate_id' IS NULL
                          OR s.source_refs->>'publish_batch_id' IS NULL
                      )
                )::bigint AS missing,
                count(*) FILTER (
                    WHERE spi.publish_status = 'success'
                      AND s.id IS NOT NULL
                      AND (
                          s.geom IS NULL
                          OR NOT ST_IsValid(s.geom)
                          OR ST_SRID(s.geom) <> 4326
                          OR upper(ST_GeometryType(s.geom)) <> 'ST_LINESTRING'
                      )
                )::bigint AS invalid_geom
            FROM system.system_publish_items AS spi
            LEFT JOIN core.core_streets AS s ON s.id = spi.target_id
            WHERE spi.publish_batch_id = ${batchId}
              AND spi.entity_family = 'roads'
        `;
        const adminAreaRows = await this.prisma.$queryRaw<{ missing: bigint; invalid_geom: bigint; missing_names: bigint }[]>`
            SELECT
                count(*) FILTER (
                    WHERE spi.publish_status = 'success'
                      AND (
                          spi.target_id IS NULL
                          OR a.id IS NULL
                          OR NOT coalesce(a.is_active, true)
                          OR a.deleted_at IS NOT NULL
                          OR a.source_refs->>'review_candidate_id' IS NULL
                          OR a.source_refs->>'publish_batch_id' IS NULL
                      )
                )::bigint AS missing,
                count(*) FILTER (
                    WHERE spi.publish_status = 'success'
                      AND a.id IS NOT NULL
                      AND (
                          a.geom IS NULL
                          OR NOT ST_IsValid(a.geom)
                          OR ST_SRID(a.geom) <> 4326
                          OR ST_GeometryType(a.geom) <> 'ST_MultiPolygon'
                          OR a.centroid IS NULL
                          OR NOT ST_IsValid(a.centroid)
                          OR ST_SRID(a.centroid) <> 4326
                      )
                )::bigint AS invalid_geom,
                count(*) FILTER (
                    WHERE spi.publish_status = 'success'
                      AND a.id IS NOT NULL
                      AND NOT EXISTS (
                          SELECT 1 FROM core.core_admin_area_names AS n
                          WHERE n.admin_area_id = a.id
                      )
                )::bigint AS missing_names
            FROM system.system_publish_items AS spi
            LEFT JOIN core.core_admin_areas AS a ON a.id = spi.target_id
            WHERE spi.publish_batch_id = ${batchId}
              AND spi.entity_family = 'admin_areas'
        `;
        const routingBarrierRows = await this.prisma.$queryRaw<{ missing: bigint; invalid_geom: bigint }[]>`
            SELECT
                count(*) FILTER (
                    WHERE spi.publish_status = 'success'
                      AND (
                          spi.target_id IS NULL
                          OR rb.id IS NULL
                          OR NOT coalesce(rb.is_active, true)
                          OR rb.source_refs->>'review_candidate_id' IS NULL
                          OR rb.source_refs->>'publish_batch_id' IS NULL
                      )
                )::bigint AS missing,
                count(*) FILTER (
                    WHERE spi.publish_status = 'success'
                      AND rb.id IS NOT NULL
                      AND (
                          rb.geom IS NULL
                          OR NOT ST_IsValid(rb.geom)
                          OR ST_SRID(rb.geom) <> 4326
                          OR ST_GeometryType(rb.geom) <> 'ST_Point'
                      )
                )::bigint AS invalid_geom
            FROM system.system_publish_items AS spi
            LEFT JOIN routing.routing_barriers AS rb ON rb.id = spi.target_id
            WHERE spi.publish_batch_id = ${batchId}
              AND spi.entity_family = 'routing_barriers'
        `;
        return {
            missing:
                Number(buildingRows[0]?.missing ?? 0n) +
                Number(placeRows[0]?.missing ?? 0n) +
                Number(mapPolygonRows[0]?.missing ?? 0n) +
                Number(waterLineRows[0]?.missing ?? 0n) +
                Number(waterPolygonRows[0]?.missing ?? 0n) +
                Number(roadRows[0]?.missing ?? 0n) +
                Number(adminAreaRows[0]?.missing ?? 0n) +
                Number(routingBarrierRows[0]?.missing ?? 0n),
            invalid_geom:
                Number(buildingRows[0]?.invalid_geom ?? 0n) +
                Number(placeRows[0]?.invalid_geom ?? 0n) +
                Number(mapPolygonRows[0]?.invalid_geom ?? 0n) +
                Number(waterLineRows[0]?.invalid_geom ?? 0n) +
                Number(waterPolygonRows[0]?.invalid_geom ?? 0n) +
                Number(roadRows[0]?.invalid_geom ?? 0n) +
                Number(adminAreaRows[0]?.invalid_geom ?? 0n) +
                Number(routingBarrierRows[0]?.invalid_geom ?? 0n),
            missing_names:
                Number(placeRows[0]?.missing_names ?? 0n) +
                Number(adminAreaRows[0]?.missing_names ?? 0n),
        };
    }

    async countMarkedPromoted(batchId: bigint): Promise<number> {
        const rows = await this.prisma.$queryRaw<{ count: bigint }[]>`
            SELECT count(*)::bigint AS count
            FROM (
                SELECT spi.id
                FROM system.system_publish_items AS spi
                INNER JOIN import_review.building_candidates AS b
                    ON b.id = spi.review_candidate_id
                   AND spi.review_candidate_table = ${BUILDING_CANDIDATE_TABLE}
                WHERE spi.publish_batch_id = ${batchId}
                  AND spi.publish_status = 'success'
                  AND b.promotion_status = 'promoted'
                  AND b.promoted_core_id IS NOT NULL
                UNION ALL
                SELECT spi.id
                FROM system.system_publish_items AS spi
                INNER JOIN import_review.place_candidates AS p
                    ON p.id = spi.review_candidate_id
                   AND spi.review_candidate_table = ${PLACE_CANDIDATE_TABLE}
                WHERE spi.publish_batch_id = ${batchId}
                  AND spi.publish_status = 'success'
                  AND p.promotion_status = 'promoted'
                  AND p.promoted_core_id IS NOT NULL
                UNION ALL
                SELECT spi.id
                FROM system.system_publish_items AS spi
                INNER JOIN import_review.landuse_candidates AS lu
                    ON lu.id = spi.review_candidate_id
                   AND spi.review_candidate_table = ${LANDUSE_CANDIDATE_TABLE}
                WHERE spi.publish_batch_id = ${batchId}
                  AND spi.publish_status = 'success'
                  AND lu.promotion_status = 'promoted'
                  AND lu.promoted_core_id IS NOT NULL
                UNION ALL
                SELECT spi.id
                FROM system.system_publish_items AS spi
                INNER JOIN import_review.water_line_candidates AS wl
                    ON wl.id = spi.review_candidate_id
                   AND spi.review_candidate_table = ${WATER_LINE_CANDIDATE_TABLE}
                WHERE spi.publish_batch_id = ${batchId}
                  AND spi.publish_status = 'success'
                  AND wl.promotion_status = 'promoted'
                  AND wl.promoted_core_id IS NOT NULL
                UNION ALL
                SELECT spi.id
                FROM system.system_publish_items AS spi
                INNER JOIN import_review.water_polygon_candidates AS wp
                    ON wp.id = spi.review_candidate_id
                   AND spi.review_candidate_table = ${WATER_POLYGON_CANDIDATE_TABLE}
                WHERE spi.publish_batch_id = ${batchId}
                  AND spi.publish_status = 'success'
                  AND wp.promotion_status = 'promoted'
                  AND wp.promoted_core_id IS NOT NULL
                UNION ALL
                SELECT spi.id
                FROM system.system_publish_items AS spi
                INNER JOIN import_review.road_candidates AS r
                    ON r.id = spi.review_candidate_id
                   AND spi.review_candidate_table = ${ROAD_CANDIDATE_TABLE}
                WHERE spi.publish_batch_id = ${batchId}
                  AND spi.publish_status = 'success'
                  AND r.promotion_status = 'promoted'
                  AND r.promoted_core_id IS NOT NULL
                UNION ALL
                SELECT spi.id
                FROM system.system_publish_items AS spi
                INNER JOIN import_review.admin_area_candidates AS aa
                    ON aa.id = spi.review_candidate_id
                   AND spi.review_candidate_table = ${ADMIN_AREA_CANDIDATE_TABLE}
                WHERE spi.publish_batch_id = ${batchId}
                  AND spi.publish_status = 'success'
                  AND aa.promotion_status = 'promoted'
                  AND aa.promoted_core_id IS NOT NULL
                UNION ALL
                SELECT spi.id
                FROM system.system_publish_items AS spi
                INNER JOIN import_review.routing_barrier_candidates AS rb
                    ON rb.id = spi.review_candidate_id
                   AND spi.review_candidate_table = ${ROUTING_BARRIER_CANDIDATE_TABLE}
                WHERE spi.publish_batch_id = ${batchId}
                  AND spi.publish_status = 'success'
                  AND rb.promotion_status = 'promoted'
                  AND rb.promoted_core_id IS NOT NULL
            ) AS marked
        `;
        return Number(rows[0]?.count ?? 0n);
    }

    async finalizePromotionBatch(args: {
        batchId: bigint;
        status: string;
        successCount: number;
        failedCount: number;
        skippedCount: number;
        totalItemCount: number;
        promotedBy: bigint | null;
        setPromotedAt: boolean;
        summary: Record<string, unknown>;
    }): Promise<void> {
        const summaryJson = JSON.stringify(args.summary);
        await this.prisma.$executeRaw`
            UPDATE system.system_publish_batches
            SET
                status = ${args.status},
                success_count = ${args.successCount},
                failed_count = ${args.failedCount},
                skipped_count = ${args.skippedCount},
                total_item_count = ${args.totalItemCount},
                validation_done = ${args.totalItemCount},
                validation_percent = 100,
                promoted_at = CASE WHEN ${args.setPromotedAt} THEN now() ELSE NULL END,
                promoted_by = CASE WHEN ${args.setPromotedAt} THEN ${args.promotedBy} ELSE promoted_by END,
                summary = coalesce(summary, '{}'::jsonb) || ${summaryJson}::jsonb
            WHERE id = ${args.batchId}
        `;
    }

    async syncPublishBatchSummary(batchId: bigint) {
        return this.publishSummaryRepo.syncPublishBatchSummary(batchId);
    }

    async syncReviewBatchStatusForPublishBatch(batchId: bigint) {
        const rows = await this.prisma.$queryRaw<{ source_review_batch_id: bigint | null }[]>`
            SELECT source_review_batch_id
            FROM system.system_publish_batches
            WHERE id = ${batchId}
            LIMIT 1
        `;
        const reviewBatchId = rows[0]?.source_review_batch_id;
        if (reviewBatchId == null) {
            return null;
        }
        return this.reviewSummaryRepo.syncReviewBatchStatus(reviewBatchId);
    }

    async getBatchVerify(batchId: bigint): Promise<ImportReviewPublishBatchVerifyResponse> {
        const itemCounts = await this.prisma.$queryRaw<
            {
                success: bigint;
                failed: bigint;
                pending: bigint;
                skipped: bigint;
                success_missing_target: bigint;
            }[]
        >`
            SELECT
                count(*) FILTER (WHERE publish_status = 'success')::bigint AS success,
                count(*) FILTER (WHERE publish_status = 'failed')::bigint AS failed,
                count(*) FILTER (WHERE publish_status = 'pending')::bigint AS pending,
                count(*) FILTER (WHERE publish_status = 'skipped')::bigint AS skipped,
                count(*) FILTER (WHERE publish_status = 'success' AND target_id IS NULL)::bigint AS success_missing_target
            FROM system.system_publish_items
            WHERE publish_batch_id = ${batchId}
        `;
        const ic = itemCounts[0] ?? {
            success: 0n,
            failed: 0n,
            pending: 0n,
            skipped: 0n,
            success_missing_target: 0n,
        };

        const buildingCoreIssues = await this.prisma.$queryRaw<
            { missing: bigint; inactive: bigint; lineage: bigint; geom: bigint }[]
        >`
            SELECT
                count(*) FILTER (WHERE spi.publish_status = 'success' AND c.id IS NULL)::bigint AS missing,
                count(*) FILTER (
                    WHERE spi.publish_status = 'success'
                      AND c.id IS NOT NULL
                      AND (NOT coalesce(c.is_active, true) OR c.deleted_at IS NOT NULL)
                )::bigint AS inactive,
                count(*) FILTER (
                    WHERE spi.publish_status = 'success'
                      AND c.id IS NOT NULL
                      AND (
                          c.source_refs->>'review_candidate_id' IS NULL
                          OR c.source_refs->>'publish_batch_id' IS NULL
                      )
                )::bigint AS lineage,
                count(*) FILTER (
                    WHERE spi.publish_status = 'success'
                      AND c.id IS NOT NULL
                      AND (c.geom IS NULL OR NOT ST_IsValid(c.geom) OR ST_SRID(c.geom) <> 4326)
                )::bigint AS geom
            FROM system.system_publish_items AS spi
            LEFT JOIN core.core_map_buildings AS c ON c.id = spi.target_id
            WHERE spi.publish_batch_id = ${batchId} AND spi.entity_family = 'buildings'
        `;
        const placeCoreIssues = await this.prisma.$queryRaw<
            { missing: bigint; inactive: bigint; lineage: bigint; geom: bigint; missing_names: bigint }[]
        >`
            SELECT
                count(*) FILTER (WHERE spi.publish_status = 'success' AND p.id IS NULL)::bigint AS missing,
                count(*) FILTER (
                    WHERE spi.publish_status = 'success'
                      AND p.id IS NOT NULL
                      AND p.deleted_at IS NOT NULL
                )::bigint AS inactive,
                count(*) FILTER (
                    WHERE spi.publish_status = 'success'
                      AND p.id IS NOT NULL
                      AND (
                          p.source_refs->>'review_candidate_id' IS NULL
                          OR p.source_refs->>'publish_batch_id' IS NULL
                      )
                )::bigint AS lineage,
                count(*) FILTER (
                    WHERE spi.publish_status = 'success'
                      AND p.id IS NOT NULL
                      AND (
                          p.point_geom IS NULL
                          OR NOT ST_IsValid(p.point_geom)
                          OR ST_SRID(p.point_geom) <> 4326
                      )
                )::bigint AS geom,
                count(*) FILTER (
                    WHERE spi.publish_status = 'success'
                      AND p.id IS NOT NULL
                      AND NOT EXISTS (
                          SELECT 1 FROM core.core_place_names AS pn WHERE pn.place_id = p.id
                      )
                )::bigint AS missing_names
            FROM system.system_publish_items AS spi
            LEFT JOIN core.core_places AS p ON p.id = spi.target_id
            WHERE spi.publish_batch_id = ${batchId} AND spi.entity_family = 'places'
        `;
        const adminAreaCoreIssues = await this.prisma.$queryRaw<
            { missing: bigint; inactive: bigint; lineage: bigint; geom: bigint; missing_names: bigint }[]
        >`
            SELECT
                count(*) FILTER (WHERE spi.publish_status = 'success' AND a.id IS NULL)::bigint AS missing,
                count(*) FILTER (
                    WHERE spi.publish_status = 'success'
                      AND a.id IS NOT NULL
                      AND (NOT coalesce(a.is_active, true) OR a.deleted_at IS NOT NULL)
                )::bigint AS inactive,
                count(*) FILTER (
                    WHERE spi.publish_status = 'success'
                      AND a.id IS NOT NULL
                      AND (
                          a.source_refs->>'review_candidate_id' IS NULL
                          OR a.source_refs->>'publish_batch_id' IS NULL
                      )
                )::bigint AS lineage,
                count(*) FILTER (
                    WHERE spi.publish_status = 'success'
                      AND a.id IS NOT NULL
                      AND (
                          a.geom IS NULL
                          OR NOT ST_IsValid(a.geom)
                          OR ST_SRID(a.geom) <> 4326
                          OR ST_GeometryType(a.geom) <> 'ST_MultiPolygon'
                          OR a.centroid IS NULL
                          OR NOT ST_IsValid(a.centroid)
                          OR ST_SRID(a.centroid) <> 4326
                      )
                )::bigint AS geom,
                count(*) FILTER (
                    WHERE spi.publish_status = 'success'
                      AND a.id IS NOT NULL
                      AND NOT EXISTS (
                          SELECT 1 FROM core.core_admin_area_names AS n
                          WHERE n.admin_area_id = a.id
                      )
                )::bigint AS missing_names
            FROM system.system_publish_items AS spi
            LEFT JOIN core.core_admin_areas AS a ON a.id = spi.target_id
            WHERE spi.publish_batch_id = ${batchId} AND spi.entity_family = 'admin_areas'
        `;
        const bi = buildingCoreIssues[0] ?? { missing: 0n, inactive: 0n, lineage: 0n, geom: 0n };
        const pi = placeCoreIssues[0] ?? {
            missing: 0n,
            inactive: 0n,
            lineage: 0n,
            geom: 0n,
            missing_names: 0n,
        };
        const aai = adminAreaCoreIssues[0] ?? {
            missing: 0n,
            inactive: 0n,
            lineage: 0n,
            geom: 0n,
            missing_names: 0n,
        };

        const candMissing = await this.prisma.$queryRaw<{ count: bigint }[]>`
            SELECT count(*)::bigint AS count
            FROM (
                SELECT spi.id
                FROM system.system_publish_items AS spi
                INNER JOIN import_review.building_candidates AS b ON b.id = spi.review_candidate_id
                WHERE spi.publish_batch_id = ${batchId}
                  AND spi.publish_status = 'success'
                  AND b.promotion_status = 'promoted'
                  AND b.promoted_core_id IS NULL
                UNION ALL
                SELECT spi.id
                FROM system.system_publish_items AS spi
                INNER JOIN import_review.place_candidates AS p ON p.id = spi.review_candidate_id
                WHERE spi.publish_batch_id = ${batchId}
                  AND spi.publish_status = 'success'
                  AND p.promotion_status = 'promoted'
                  AND p.promoted_core_id IS NULL
                UNION ALL
                SELECT spi.id
                FROM system.system_publish_items AS spi
                INNER JOIN import_review.admin_area_candidates AS aa ON aa.id = spi.review_candidate_id
                WHERE spi.publish_batch_id = ${batchId}
                  AND spi.publish_status = 'success'
                  AND aa.promotion_status = 'promoted'
                  AND aa.promoted_core_id IS NULL
            ) AS missing_candidates
        `;

        const issues: ImportReviewPublishBatchVerifyResponse["issues"] = [];
        const missingCore =
            Number(bi.missing ?? 0n) +
            Number(pi.missing ?? 0n) +
            Number(aai.missing ?? 0n);
        const missingTarget = Number(ic.success_missing_target ?? 0n);
        const lineage =
            Number(bi.lineage ?? 0n) +
            Number(pi.lineage ?? 0n) +
            Number(aai.lineage ?? 0n);
        const geom =
            Number(bi.geom ?? 0n) +
            Number(pi.geom ?? 0n) +
            Number(aai.geom ?? 0n);
        const missingNames =
            Number(pi.missing_names ?? 0n) +
            Number(aai.missing_names ?? 0n);
        const cand = Number(candMissing[0]?.count ?? 0n);

        if (missingTarget > 0) {
            issues.push({
                code: "success_missing_target_id",
                message: `${missingTarget} success item(s) missing target_id.`,
                severity: "error",
            });
        }
        if (missingCore > 0) {
            issues.push({
                code: "core_row_missing",
                message: `${missingCore} success item(s) reference missing core rows.`,
                severity: "error",
            });
        }
        if (cand > 0) {
            issues.push({
                code: "candidate_missing_promoted_core_id",
                message: `${cand} promoted candidate(s) missing promoted_core_id.`,
                severity: "error",
            });
        }
        if (lineage > 0) {
            issues.push({
                code: "lineage_incomplete",
                message: `${lineage} core row(s) missing review_candidate_id or publish_batch_id in source_refs.`,
                severity: "warning",
            });
        }
        if (geom > 0) {
            issues.push({
                code: "geometry_invalid",
                message: `${geom} core row(s) have invalid or missing geometry.`,
                severity: "warning",
            });
        }
        if (missingNames > 0) {
            issues.push({
                code: "core_names_missing",
                message: `${missingNames} promoted place or admin area row(s) missing name rows in core.`,
                severity: "error",
            });
        }

        const hasError = issues.some((i) => i.severity === "error");
        const hasWarning = issues.some((i) => i.severity === "warning");
        const verification_status = hasError ? "failed" : hasWarning ? "warning" : "passed";

        return {
            batch_id: batchId.toString(),
            verification_status,
            publish_items: {
                success: Number(ic.success ?? 0n),
                failed: Number(ic.failed ?? 0n),
                pending: Number(ic.pending ?? 0n),
                skipped: Number(ic.skipped ?? 0n),
                success_missing_target_id: missingTarget,
            },
            core_rows_missing: missingCore,
            core_rows_inactive:
                Number(bi.inactive ?? 0n) +
                Number(pi.inactive ?? 0n) +
                Number(aai.inactive ?? 0n),
            candidates_promoted_missing_core_id: cand,
            lineage_warnings: lineage,
            geometry_warnings: geom,
            issues,
        };
    }
}
