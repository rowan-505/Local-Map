import type { PrismaClient } from "@prisma/client";

import { ImportReviewPublishBatchNotFoundError } from "./import-review-promotion.errors.js";
import {
    ImportReviewPromotionRoadDryRunNoItemsError,
    ImportReviewPromotionRoadDryRunNotFoundError,
} from "./import-review-promotion-road-dry-run.errors.js";
import {
    aggregateRoadDryRunResult,
    MAX_ROAD_LENGTH_M,
    resolveItemStatus,
} from "./import-review-promotion-road-dry-run.helpers.js";
import {
    ImportReviewPromotionRoadDryRunRepository,
    type RoadCandidatePromotionRow,
    type RoadPublishItemRow,
} from "./import-review-promotion-road-dry-run.repo.js";
import type { PostImportReviewPromotionRoadDryRunBody } from "./import-review-promotion-road-dry-run.schema.js";
import type {
    ImportReviewPromotionRoadDryRunResult,
    RoadDryRunConnectivitySummary,
    RoadDryRunDuplicateSummary,
    RoadDryRunGeometrySummary,
    RoadDryRunItemResult,
    RoadDryRunRoutingSummary,
} from "./import-review-promotion-road-dry-run.types.js";
import {
    mergeEffectiveRoadState,
    runImportReviewRoadRoutingValidation,
} from "./import-review-road-routing-validation.js";
import { StreetsRepository } from "../streets/streets.repo.js";

const ROUTING_INFO_CODES = new Set([
    "NEW_REGION_NO_CORE_ROADS",
    "CROSSING_ALLOWED_BY_LAYER",
    "SPEED_KPH_MISSING",
    "BOUNDARY_NOT_AVAILABLE",
]);

const GEOMETRY_BLOCKER_CODES = new Set([
    "geom_missing",
    "invalid_geom",
    "invalid_geom_type",
    "zero_length",
    "ROAD_LENGTH_OUTLIER",
    "GEOMETRY_MISSING",
    "GEOMETRY_INVALID",
    "INVALID_GEOMETRY_TYPE",
    "INVALID_SRID",
    "GEOMETRY_EMPTY",
    "ROAD_TOO_SHORT",
    "INVALID_COORDINATES",
]);

function jsonbArrayNonEmpty(value: unknown): boolean {
    if (!value || typeof value !== "object" || !Array.isArray(value)) {
        return false;
    }
    return value.length > 0;
}

function collectCandidateStateBlockers(args: {
    item: RoadPublishItemRow;
    candidate: RoadCandidatePromotionRow | null;
}): string[] {
    const reasons: string[] = [];
    const { item, candidate } = args;

    if (item.review_candidate_id == null || candidate == null) {
        reasons.push("candidate_missing");
        return reasons;
    }

    if (item.publish_action === "protect_manual") {
        reasons.push("manual_protected");
    }
    if (candidate.auto_action === "protect_manual" || candidate.auto_action === "manual_protected") {
        reasons.push("manual_protected");
    }

    if (candidate.review_status !== "approved" || candidate.review_decision !== "approved") {
        reasons.push("not_approved");
    }

    if (candidate.promotion_status === "promoted" || candidate.review_status === "promoted") {
        reasons.push("already_promoted");
    }

    if (
        candidate.confidence_score != null &&
        (candidate.confidence_score < 0 || candidate.confidence_score > 100)
    ) {
        reasons.push("invalid_confidence");
    }

    if (
        !candidate.source_refs ||
        typeof candidate.source_refs !== "object" ||
        Array.isArray(candidate.source_refs) ||
        Object.keys(candidate.source_refs as object).length === 0
    ) {
        reasons.push("empty_source_refs");
    }

    if (jsonbArrayNonEmpty(candidate.validation_errors)) {
        reasons.push("validation_errors_present");
    }

    return [...new Set(reasons)];
}

function collectGeometryIssues(candidate: RoadCandidatePromotionRow | null): {
    blockers: string[];
    warnings: string[];
} {
    const blockers: string[] = [];
    const warnings: string[] = [];

    if (!candidate) {
        return { blockers, warnings };
    }

    if (candidate.geom == null) {
        blockers.push("geom_missing");
        return { blockers, warnings };
    }

    if (candidate.is_valid === false) {
        blockers.push("invalid_geom");
    }
    if (candidate.srid != null && candidate.srid !== 4326) {
        blockers.push("invalid_geom");
    }
    const gt = candidate.geom_type?.toUpperCase() ?? "";
    if (gt && gt !== "ST_LINESTRING" && gt !== "ST_MULTILINESTRING" && gt !== "LINESTRING" && gt !== "MULTILINESTRING") {
        blockers.push("invalid_geom_type");
    }
    if (candidate.length_m != null && candidate.length_m <= 0) {
        blockers.push("zero_length");
    }
    if (candidate.length_m != null && candidate.length_m > MAX_ROAD_LENGTH_M) {
        blockers.push("ROAD_LENGTH_OUTLIER");
    }

    return { blockers, warnings };
}

async function collectReferenceIssues(
    repo: ImportReviewPromotionRoadDryRunRepository,
    candidate: RoadCandidatePromotionRow | null
): Promise<{ blockers: string[]; warnings: string[] }> {
    const blockers: string[] = [];
    const warnings: string[] = [];

    if (!candidate) {
        return { blockers, warnings };
    }

    if (candidate.road_class_id != null) {
        const exists = await repo.roadClassIdExists(candidate.road_class_id);
        if (!exists) {
            blockers.push("INVALID_ROAD_CLASS_ID");
        }
    } else {
        const classCode = candidate.class_code ?? candidate.road_class;
        if (classCode?.trim()) {
            const count = await repo.countRoadClassesByCode(classCode);
            if (count === 0) {
                warnings.push("INVALID_ROAD_CLASS_CODE");
            } else if (count > 1) {
                warnings.push("AMBIGUOUS_ROAD_CLASS_CODE");
            }
        } else {
            warnings.push("ROAD_CLASS_MISSING");
        }
    }

    return { blockers, warnings };
}

export class ImportReviewPromotionRoadDryRunService {
    private readonly prisma: PrismaClient;
    private readonly repo: ImportReviewPromotionRoadDryRunRepository;
    private readonly streetsRepo: StreetsRepository;

    constructor(prisma: PrismaClient) {
        this.prisma = prisma;
        this.repo = new ImportReviewPromotionRoadDryRunRepository(prisma);
        this.streetsRepo = new StreetsRepository(prisma);
    }

    async runDryRun(
        batchId: bigint,
        body: PostImportReviewPromotionRoadDryRunBody
    ): Promise<ImportReviewPromotionRoadDryRunResult> {
        const meta = await this.repo.fetchBatchMeta(batchId);
        if (!meta) {
            throw new ImportReviewPublishBatchNotFoundError(batchId.toString());
        }

        if (!body.revalidate) {
            const cached = await this.repo.readRoadDryRunResult(batchId);
            if (cached) {
                return cached;
            }
        }

        const items = await this.repo.listRoadPublishItems(batchId);
        if (items.length === 0) {
            throw new ImportReviewPromotionRoadDryRunNoItemsError(batchId.toString());
        }

        await this.repo.seedRoadDryRunStageLogs(batchId);
        await this.repo.updateRoadDryRunStageLog({
            batchId,
            stageKey: "road_dry_run_start",
            stageStatus: "running",
            progressPercent: 0,
            message: `Evaluating ${items.length} road publish item(s).`,
        });

        const evaluated: RoadDryRunItemResult[] = [];
        let geometryBlocked = 0;
        let referenceBlocked = 0;
        let duplicateWarnings = 0;
        let connectivityWarnings = 0;
        let routingWarnings = 0;

        for (let i = 0; i < items.length; i += 1) {
            const item = items[i]!;
            const result = await this.evaluateItem(item, body);
            evaluated.push(result);

            if (result.blocking_reasons.some((c) => GEOMETRY_BLOCKER_CODES.has(c))) {
                geometryBlocked += 1;
            }
            if (result.blocking_reasons.includes("INVALID_ROAD_CLASS_ID")) {
                referenceBlocked += 1;
            }
            if (result.warning_codes.some((c) => c.includes("DUPLICATE") || c.includes("duplicate"))) {
                duplicateWarnings += 1;
            }
            if (result.warning_codes.some((c) => c.includes("ENDPOINT") || c.includes("ISLAND") || c.includes("CONNECTION"))) {
                connectivityWarnings += 1;
            }
            if (result.routing_summary != null && result.warning_codes.length > 0) {
                routingWarnings += 1;
            }

            const pct = Math.round(((i + 1) / items.length) * 85);
            await this.repo.updateRoadDryRunStageLog({
                batchId,
                stageKey: "road_geometry_checks",
                stageStatus: "running",
                progressPercent: pct,
                message: `Checked ${i + 1}/${items.length} item(s).`,
                details: { geometry_blocked: geometryBlocked },
            });
        }

        await this.repo.updateRoadDryRunStageLog({
            batchId,
            stageKey: "road_dry_run_start",
            stageStatus: "success",
            progressPercent: 100,
            finished: true,
            message: `Loaded ${items.length} road publish item(s).`,
            details: { total_items: items.length },
        });
        await this.repo.updateRoadDryRunStageLog({
            batchId,
            stageKey: "road_geometry_checks",
            stageStatus: "success",
            progressPercent: 100,
            finished: true,
            message: "Geometry checks complete.",
            details: { geometry_blocked: geometryBlocked },
        });
        await this.repo.updateRoadDryRunStageLog({
            batchId,
            stageKey: "road_reference_checks",
            stageStatus: "success",
            progressPercent: 100,
            finished: true,
            message: "Road class reference checks complete.",
            details: { reference_blocked: referenceBlocked },
        });
        await this.repo.updateRoadDryRunStageLog({
            batchId,
            stageKey: "road_duplicate_checks",
            stageStatus: "success",
            progressPercent: 100,
            finished: true,
            message: "Duplicate checks complete.",
            details: { duplicate_warning_items: duplicateWarnings },
        });
        await this.repo.updateRoadDryRunStageLog({
            batchId,
            stageKey: "road_connectivity_checks",
            stageStatus: "success",
            progressPercent: 100,
            finished: true,
            message: "Connectivity checks complete.",
            details: { connectivity_warning_items: connectivityWarnings },
        });
        await this.repo.updateRoadDryRunStageLog({
            batchId,
            stageKey: "road_routing_attribute_checks",
            stageStatus: "success",
            progressPercent: 100,
            finished: true,
            message: "Routing attribute checks complete.",
            details: { routing_warning_items: routingWarnings },
        });

        const result = aggregateRoadDryRunResult({
            batchId,
            reviewBatchId: meta.source_review_batch_id,
            items: evaluated,
        });

        await this.repo.persistRoadDryRunResult(batchId, result);

        await this.repo.updateRoadDryRunStageLog({
            batchId,
            stageKey: "road_dry_run_summary",
            stageStatus: "success",
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

    async getDryRunResult(batchId: bigint): Promise<ImportReviewPromotionRoadDryRunResult> {
        const meta = await this.repo.fetchBatchMeta(batchId);
        if (!meta) {
            throw new ImportReviewPublishBatchNotFoundError(batchId.toString());
        }
        const cached = await this.repo.readRoadDryRunResult(batchId);
        if (!cached) {
            throw new ImportReviewPromotionRoadDryRunNotFoundError(batchId.toString());
        }
        return cached;
    }

    async countRoadItemsInBatch(batchId: bigint): Promise<number> {
        return this.repo.countRoadItemsInBatch(batchId);
    }

    private async evaluateItem(
        item: RoadPublishItemRow,
        body: PostImportReviewPromotionRoadDryRunBody
    ): Promise<RoadDryRunItemResult> {
        const reviewBatchId = item.review_batch_id;
        let candidate: RoadCandidatePromotionRow | null = null;

        if (item.review_candidate_id != null && reviewBatchId != null) {
            candidate = await this.repo.fetchRoadCandidateForDryRun(
                item.review_candidate_id,
                reviewBatchId
            );
        }

        const routingRow =
            item.review_candidate_id != null && reviewBatchId != null
                ? await this.repo.fetchRoadCandidateRoutingValidationRow(
                      item.review_candidate_id,
                      reviewBatchId
                  )
                : null;

        const blockingReasons: string[] = [];
        const warningCodes: string[] = [];
        const infoCodes: string[] = [];

        blockingReasons.push(...collectCandidateStateBlockers({ item, candidate }));

        const geometryIssues = collectGeometryIssues(candidate);
        blockingReasons.push(...geometryIssues.blockers);
        warningCodes.push(...geometryIssues.warnings);

        const referenceIssues = await collectReferenceIssues(this.repo, candidate);
        blockingReasons.push(...referenceIssues.blockers);
        warningCodes.push(...referenceIssues.warnings);

        let connectivitySummary: RoadDryRunConnectivitySummary | null = null;
        let duplicateSummary: RoadDryRunDuplicateSummary | null = null;
        let routingSummary: RoadDryRunRoutingSummary | null = null;

        const effective =
            routingRow != null
                ? mergeEffectiveRoadState(
                      body.use_review_overrides
                          ? routingRow
                          : { ...routingRow, review_overrides: {} }
                  )
                : null;

        if (effective) {
            routingSummary = {
                road_class_code: effective.road_class_code,
                is_oneway: effective.is_oneway,
                surface: effective.surface,
                access: effective.access,
                speed_kph: effective.speed_kph,
                bridge: effective.bridge,
                tunnel: effective.tunnel,
                layer: effective.layer,
            };
        }

        const preRoutingBlockers = [...new Set(blockingReasons)];

        if (preRoutingBlockers.length === 0 && routingRow != null && reviewBatchId != null) {
            if (
                item.publish_action === "insert" &&
                routingRow.external_id?.trim() &&
                (await this.repo.duplicateExternalIdInCore(routingRow.external_id.trim()))
            ) {
                blockingReasons.push("DUPLICATE_EXTERNAL_ID_IN_CORE");
            }

            const routingResult = await runImportReviewRoadRoutingValidation({
                prisma: this.prisma,
                streetsRepo: this.streetsRepo,
                row: routingRow,
                useReviewOverrides: body.use_review_overrides,
                connectivityThresholdM: body.connectivity_threshold_m,
                duplicateThresholdM: body.duplicate_threshold_m,
                confirmWarnings: body.include_warnings,
            });

            for (const w of routingResult.warnings) {
                if (ROUTING_INFO_CODES.has(w.code)) {
                    infoCodes.push(w.code);
                } else {
                    warningCodes.push(w.code);
                }
            }
            for (const i of routingResult.info) {
                infoCodes.push(i.code);
            }
            for (const e of routingResult.errors) {
                blockingReasons.push(e.code);
            }

            connectivitySummary = {
                validation_mode: routingResult.validation_mode,
                nearby_core_roads: routingResult.stats.nearby_core_roads,
                nearby_review_roads: routingResult.stats.nearby_review_roads,
                connected_endpoints: routingResult.stats.connected_endpoints,
                isolated_endpoints: routingResult.stats.isolated_endpoints,
                possible_unsplit_intersections: routingResult.stats.possible_unsplit_intersections,
            };

            const dupBatchExternal = warningCodes.includes("DUPLICATE_EXTERNAL_ID_IN_REVIEW_BATCH");
            const dupCoreExternal = blockingReasons.includes("DUPLICATE_EXTERNAL_ID_IN_CORE");

            let likelyNameClassDuplicate = false;
            if (
                effective?.geom_geojson &&
                effective.canonical_name?.trim() &&
                reviewBatchId != null &&
                routingRow.id
            ) {
                const nameDupCount = await this.repo.countLikelyNameClassDuplicates({
                    reviewBatchId,
                    candidateId: routingRow.id,
                    canonicalName: effective.canonical_name,
                    roadClassCode: effective.road_class_code,
                    duplicateThresholdM: body.duplicate_threshold_m,
                    geomGeojson: effective.geom_geojson,
                });
                if (nameDupCount > 0) {
                    likelyNameClassDuplicate = true;
                    warningCodes.push("LIKELY_NAME_CLASS_DUPLICATE");
                }
            }

            duplicateSummary = {
                possible_duplicates: routingResult.stats.possible_duplicates,
                duplicate_core_external_id: dupCoreExternal,
                duplicate_batch_external_id: dupBatchExternal,
                likely_name_class_duplicate: likelyNameClassDuplicate,
            };
        }

        const uniqueBlockers = [...new Set(blockingReasons)];
        const uniqueWarnings = [...new Set(warningCodes)];
        const uniqueInfo = [...new Set(infoCodes)];

        const dryRunStatus = resolveItemStatus(uniqueBlockers, uniqueWarnings, body.include_warnings);

        const geometrySummary: RoadDryRunGeometrySummary | null = candidate
            ? {
                  srid: candidate.srid,
                  geom_type: candidate.geom_type,
                  length_m: candidate.length_m,
                  is_valid: candidate.is_valid,
                  part_count: candidate.part_count,
              }
            : null;

        return {
            publish_item_id: item.publish_item_id.toString(),
            review_candidate_id: item.review_candidate_id?.toString() ?? "",
            external_id: candidate?.external_id ?? routingRow?.external_id ?? null,
            canonical_name: candidate?.canonical_name ?? routingRow?.canonical_name ?? null,
            publish_action: item.publish_action,
            dry_run_status: dryRunStatus,
            blocking_reasons: uniqueBlockers,
            warning_codes: uniqueWarnings,
            info_codes: uniqueInfo,
            matched_core_id: candidate?.matched_core_id?.toString() ?? null,
            geometry_summary: geometrySummary,
            connectivity_summary: connectivitySummary,
            duplicate_summary: duplicateSummary,
            routing_summary: routingSummary,
            can_promote_later: dryRunStatus !== "blocked",
        };
    }
}

export function createImportReviewPromotionRoadDryRunService(
    prisma: PrismaClient
): ImportReviewPromotionRoadDryRunService {
    return new ImportReviewPromotionRoadDryRunService(prisma);
}

export { resolveItemStatus, aggregateRoadDryRunResult };
