import type { PrismaClient } from "@prisma/client";

import { ImportReviewPublishBatchNotFoundError } from "./import-review-promotion.errors.js";
import {
    ImportReviewPromotionRoutingBarrierDryRunNoItemsError,
    ImportReviewPromotionRoutingBarrierDryRunNotFoundError,
} from "./import-review-promotion-routing-barrier-dry-run.errors.js";
import {
    aggregateRoutingBarrierDryRunResult,
    resolveRoutingBarrierDryRunStatus,
} from "./import-review-promotion-routing-barrier-dry-run.helpers.js";
import {
    ImportReviewPromotionRoutingBarrierDryRunRepository,
    type RoutingBarrierCandidateDryRunRow,
    type RoutingBarrierPublishItemRow,
} from "./import-review-promotion-routing-barrier-dry-run.repo.js";
import type { PostImportReviewPromotionRoutingBarrierDryRunBody } from "./import-review-promotion-routing-barrier-dry-run.schema.js";
import type {
    ImportReviewPromotionRoutingBarrierDryRunResult,
    RoutingBarrierDryRunItemResult,
} from "./import-review-promotion-routing-barrier-dry-run.types.js";

function jsonbArrayNonEmpty(value: unknown): boolean {
    return Array.isArray(value) && value.length > 0;
}

function sourceRefsEmpty(value: unknown): boolean {
    return !value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length === 0;
}

function collectStateBlockers(item: RoutingBarrierPublishItemRow, candidate: RoutingBarrierCandidateDryRunRow | null): string[] {
    const blockers: string[] = [];
    if (!item.review_candidate_id || !candidate) {
        return ["candidate_missing"];
    }
    if (candidate.review_status !== "approved" || candidate.review_decision !== "approved") {
        blockers.push("not_approved");
    }
    if (candidate.promotion_status === "promoted" || candidate.review_status === "promoted") {
        blockers.push("already_promoted");
    }
    if (candidate.confidence_score != null && (candidate.confidence_score < 0 || candidate.confidence_score > 100)) {
        blockers.push("invalid_confidence");
    }
    if (sourceRefsEmpty(candidate.source_refs)) {
        blockers.push("empty_source_refs");
    }
    if (jsonbArrayNonEmpty(candidate.validation_errors)) {
        blockers.push("validation_errors_present");
    }
    return blockers;
}

function collectGeometryBlockers(candidate: RoutingBarrierCandidateDryRunRow | null): string[] {
    if (!candidate) {
        return [];
    }
    const blockers: string[] = [];
    if (candidate.point_geom == null) {
        blockers.push("geom_missing");
        return blockers;
    }
    if (candidate.is_valid === false) {
        blockers.push("invalid_point_geom");
    }
    if (candidate.srid != null && candidate.srid !== 4326) {
        blockers.push("invalid_srid");
    }
    const type = candidate.geom_type ?? "";
    if (type && type !== "ST_Point") {
        blockers.push("invalid_geom_type");
    }
    return blockers;
}

function collectWarnings(candidate: RoutingBarrierCandidateDryRunRow | null): string[] {
    if (!candidate) {
        return [];
    }
    const warnings: string[] = ["ROUTING_IMPACT_UNCLEAR"];
    if (!candidate.barrier_type?.trim()) {
        warnings.push("BARRIER_TYPE_MISSING");
    } else if (!["gate", "bollard", "block", "barrier", "lift_gate", "stile", "cycle_barrier"].includes(candidate.barrier_type.trim().toLowerCase())) {
        warnings.push("BARRIER_TYPE_UNKNOWN");
    }
    if (candidate.nearby_core_roads === 0) {
        warnings.push("NO_NEARBY_CORE_ROAD");
        warnings.push("CORE_STREET_ID_MISSING");
        warnings.push("FAR_FROM_ROUTABLE_NETWORK");
    }
    if (candidate.nearby_review_roads === 0) {
        warnings.push("NO_NEARBY_REVIEW_ROAD");
    }
    if (candidate.duplicate_nearby_barriers > 0) {
        warnings.push("DUPLICATE_NEARBY_BARRIER_RISK");
    }
    return warnings;
}

export class ImportReviewPromotionRoutingBarrierDryRunService {
    private readonly repo: ImportReviewPromotionRoutingBarrierDryRunRepository;

    constructor(private readonly prisma: PrismaClient) {
        this.repo = new ImportReviewPromotionRoutingBarrierDryRunRepository(prisma);
    }

    async runDryRun(
        batchId: bigint,
        body: PostImportReviewPromotionRoutingBarrierDryRunBody
    ): Promise<ImportReviewPromotionRoutingBarrierDryRunResult> {
        const meta = await this.repo.fetchBatchMeta(batchId);
        if (!meta) {
            throw new ImportReviewPublishBatchNotFoundError(batchId.toString());
        }
        if (!body.revalidate) {
            const cached = await this.repo.readDryRunResult(batchId);
            if (cached) return cached;
        }

        const items = await this.repo.listRoutingBarrierPublishItems(batchId);
        if (items.length === 0) {
            throw new ImportReviewPromotionRoutingBarrierDryRunNoItemsError(batchId.toString());
        }

        await this.repo.seedStageLogs(batchId);
        await this.repo.updateStageLog({
            batchId,
            stageKey: "routing_barrier_dry_run_start",
            stageStatus: "running",
            progressPercent: 0,
            message: `Evaluating ${items.length} routing barrier publish item(s).`,
        });

        const targetExists = await this.repo.targetTableExists();
        const evaluated: RoutingBarrierDryRunItemResult[] = [];

        for (let i = 0; i < items.length; i += 1) {
            evaluated.push(await this.evaluateItem(items[i]!, body, targetExists));
            await this.repo.updateStageLog({
                batchId,
                stageKey: "routing_barrier_geometry_checks",
                stageStatus: "running",
                progressPercent: Math.round(((i + 1) / items.length) * 80),
                message: `Checked ${i + 1}/${items.length} routing barrier item(s).`,
            });
        }

        const result = aggregateRoutingBarrierDryRunResult({
            batchId,
            reviewBatchId: meta.source_review_batch_id,
            items: evaluated,
        });
        await this.repo.persistDryRunResult(batchId, result);

        await this.repo.updateStageLog({
            batchId,
            stageKey: "routing_barrier_dry_run_start",
            stageStatus: "success",
            progressPercent: 100,
            finished: true,
            message: `Loaded ${items.length} routing barrier item(s).`,
        });
        for (const stageKey of [
            "routing_barrier_geometry_checks",
            "routing_barrier_network_checks",
            "routing_barrier_duplicate_checks",
        ] as const) {
            await this.repo.updateStageLog({
                batchId,
                stageKey,
                stageStatus: "success",
                progressPercent: 100,
                finished: true,
                message: "Routing barrier dry-run checks complete.",
            });
        }
        await this.repo.updateStageLog({
            batchId,
            stageKey: "routing_barrier_dry_run_summary",
            stageStatus: result.blocked_count > 0 ? "warning" : "success",
            progressPercent: 100,
            finished: true,
            message: result.message,
            details: {
                total_count: result.total_count,
                safe_to_promote_count: result.safe_to_promote_count,
                promote_with_warning_count: result.promote_with_warning_count,
                needs_manual_review_count: result.needs_manual_review_count,
                blocked_count: result.blocked_count,
            },
        });
        return result;
    }

    async getDryRunResult(batchId: bigint): Promise<ImportReviewPromotionRoutingBarrierDryRunResult> {
        const meta = await this.repo.fetchBatchMeta(batchId);
        if (!meta) {
            throw new ImportReviewPublishBatchNotFoundError(batchId.toString());
        }
        const cached = await this.repo.readDryRunResult(batchId);
        if (!cached) {
            throw new ImportReviewPromotionRoutingBarrierDryRunNotFoundError(batchId.toString());
        }
        return cached;
    }

    private async evaluateItem(
        item: RoutingBarrierPublishItemRow,
        body: PostImportReviewPromotionRoutingBarrierDryRunBody,
        targetExists: boolean
    ): Promise<RoutingBarrierDryRunItemResult> {
        const candidate =
            item.review_candidate_id && item.review_batch_id
                ? await this.repo.fetchCandidateForDryRun({
                      candidateId: item.review_candidate_id,
                      reviewBatchId: item.review_batch_id,
                      nearbyCoreRoadThresholdM: body.nearby_core_road_threshold_m,
                      nearbyReviewRoadThresholdM: body.nearby_review_road_threshold_m,
                      duplicateThresholdM: body.duplicate_threshold_m,
                  })
                : null;
        const blockers = [
            ...collectStateBlockers(item, candidate),
            ...collectGeometryBlockers(candidate),
            ...(targetExists ? [] : ["target_table_missing"]),
        ];
        const warnings = collectWarnings(candidate);
        const info = candidate?.barrier_type ? [] : ["optional_barrier_type_null"];
        const dryRunStatus = resolveRoutingBarrierDryRunStatus(
            [...new Set(blockers)],
            [...new Set(warnings)],
            body.include_warnings
        );

        return {
            publish_item_id: item.publish_item_id.toString(),
            review_candidate_id: item.review_candidate_id?.toString() ?? "",
            external_id: candidate?.external_id ?? null,
            barrier_type: candidate?.barrier_type ?? null,
            publish_action: item.publish_action,
            dry_run_status: dryRunStatus,
            blocking_reasons: [...new Set(blockers)],
            warning_codes: [...new Set(warnings)],
            info_codes: [...new Set(info)],
            matched_core_id: candidate?.matched_core_id?.toString() ?? null,
            core_street_id: candidate?.nearest_core_street_id?.toString() ?? null,
            geometry_summary: candidate
                ? {
                      srid: candidate.srid,
                      geom_type: candidate.geom_type,
                      is_valid: candidate.is_valid,
                  }
                : null,
            network_summary: candidate
                ? {
                      nearby_core_roads: candidate.nearby_core_roads,
                      nearby_review_roads: candidate.nearby_review_roads,
                      nearest_core_street_id: candidate.nearest_core_street_id?.toString() ?? null,
                      nearest_core_road_distance_m: candidate.nearest_core_road_distance_m,
                  }
                : null,
            can_promote_later: dryRunStatus !== "blocked",
        };
    }
}

export function createImportReviewPromotionRoutingBarrierDryRunService(
    prisma: PrismaClient
): ImportReviewPromotionRoutingBarrierDryRunService {
    return new ImportReviewPromotionRoutingBarrierDryRunService(prisma);
}
