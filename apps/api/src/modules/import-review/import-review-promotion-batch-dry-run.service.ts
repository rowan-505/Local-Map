import type { FastifyBaseLogger } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";

import {
    batchStatusForDryRunEligibility,
    mergePublishBatchDryRunResult,
    parsePublishBatchDryRunResultFromSummary,
} from "./import-review-publish-batch-dry-run.js";
import {
    isPublishBatchClosedForReuse,
    normalizePublishBatchStoredStatus,
    publishBatchClosedForReuseMessage,
} from "./import-review-publish-batch-lifecycle.js";
import { classifyPublishItemsForPromotion } from "./import-review-promotion-execution.js";
import { reconcileRoadDuplicateExternalIds } from "./import-review-promotion-road-duplicate-external-id.js";
import {
    buildPublishBatchDryRunApiResponse,
    dryRunPayloadFromSummary,
    systemErrorSample,
} from "./import-review-promotion-batch-dry-run-response.js";
import type {
    ImportReviewPublishBatchDryRunApiResponse,
    PublishBatchDryRunDuplicateSample,
    PublishBatchDryRunExactAction,
    PublishBatchDryRunSampleError,
} from "./import-review-promotion-batch-dry-run.types.js";
import {
    PUBLISH_BATCH_DRY_RUN_SYSTEM_ERROR_CODE,
    releaseBatchedCandidatesForPublishBatch,
} from "./import-review-promotion-batch-failure-cleanup.js";
import { ImportReviewPublishBatchNotFoundError } from "./import-review-promotion.errors.js";
import { parsePublishItemValidationResult } from "./import-review-promotion-publish-item-validation.js";
import {
    fieldChoicesFromOverridesArchive,
    parseFieldChoicesFromReviewNote,
} from "./import-review-decision-publish-action.js";

type DryRunItemRow = {
    publish_item_id: bigint;
    entity_family: string;
    publish_action: string;
    publish_status: string;
    validation_result: unknown;
};

async function persistDryRunSummary(
    prisma: PrismaClient,
    batchId: bigint,
    summary: ImportReviewPublishBatchDryRunApiResponse["summary"]
): Promise<void> {
    const payload = dryRunPayloadFromSummary(summary);
    const rows = await prisma.$queryRaw<{ summary: unknown }[]>`
        SELECT summary FROM system.system_publish_batches WHERE id = ${batchId} LIMIT 1
    `;
    const existing = parsePublishBatchDryRunResultFromSummary(rows[0]?.summary);
    const dryRunPayload = mergePublishBatchDryRunResult(existing, payload);
    const patch = JSON.stringify({ dry_run_result: dryRunPayload });
    await prisma.$executeRaw`
        UPDATE system.system_publish_batches
        SET summary = coalesce(summary, '{}'::jsonb) || ${patch}::jsonb
        WHERE id = ${batchId}
    `;
}

function eligibilityFailureResponse(args: {
    batchId: bigint;
    batchStatus: string;
    code: string;
    message: string;
    entityFamilies?: string[];
}): ImportReviewPublishBatchDryRunApiResponse {
    return buildPublishBatchDryRunApiResponse({
        batchId: args.batchId,
        status: "failed",
        entityFamilies: args.entityFamilies ?? [],
        total: 0,
        readyCount: 0,
        blockedCount: 0,
        failedCount: 0,
        wouldInsertCount: 0,
        wouldUpdateCount: 0,
        duplicateFixedCount: 0,
        duplicateBlockedCount: 0,
        duplicateSamples: [],
        sampleErrors: [
            {
                candidate_id: null,
                external_id: null,
                code: args.code,
                message: args.message,
            },
        ],
        batchStatus: args.batchStatus,
        message: args.message,
    });
}

export async function runPublishBatchDryRun(args: {
    prisma: PrismaClient;
    batchId: bigint;
    log?: FastifyBaseLogger;
}): Promise<ImportReviewPublishBatchDryRunApiResponse> {
    const batchRows = await args.prisma.$queryRaw<
        { id: bigint; status: string; summary: unknown }[]
    >`
        SELECT id, status, summary
        FROM system.system_publish_batches
        WHERE id = ${args.batchId}
        LIMIT 1
    `;
    const batch = batchRows[0];
    if (!batch) {
        throw new ImportReviewPublishBatchNotFoundError(args.batchId.toString());
    }

    const storedStatus = normalizePublishBatchStoredStatus(batch.status);

    if (isPublishBatchClosedForReuse(batch.status)) {
        const response = eligibilityFailureResponse({
            batchId: args.batchId,
            batchStatus: storedStatus,
            code: "batch_closed",
            message: publishBatchClosedForReuseMessage(batch.status),
        });
        await persistDryRunSummary(args.prisma, args.batchId, response.summary);
        return response;
    }

    const pendingValidationRows = await args.prisma.$queryRaw<
        { publish_item_id: bigint; validation_result: unknown }[]
    >`
        SELECT id AS publish_item_id, validation_result
        FROM system.system_publish_items
        WHERE publish_batch_id = ${args.batchId}
          AND publish_status = 'pending'
    `;
    const actualPromotableCount = classifyPublishItemsForPromotion(pendingValidationRows)
        .promotableIds.length;

    if (!batchStatusForDryRunEligibility(batch.status) || actualPromotableCount <= 0) {
        const message =
            actualPromotableCount <= 0
                ? "Dry-run requires at least one pending publish item with validation_status ready."
                : "Dry-run requires batch status ready or partial.";
        const response = eligibilityFailureResponse({
            batchId: args.batchId,
            batchStatus: storedStatus,
            code: "dry_run_not_eligible",
            message,
        });
        await persistDryRunSummary(args.prisma, args.batchId, response.summary);
        return response;
    }

    try {
        const duplicateReconcile = await reconcileRoadDuplicateExternalIds(args.prisma, {
            publishBatchId: args.batchId,
        });
        const duplicate_fixed_count = duplicateReconcile.core_converted_count;
        const duplicate_blocked_count =
            duplicateReconcile.core_blocked_count + duplicateReconcile.in_review_duplicate_count;
        const duplicate_samples: PublishBatchDryRunDuplicateSample[] =
            duplicateReconcile.samples.map((s) => ({
                candidate_id: Number(s.candidate_id),
                external_id: s.external_id,
                action: s.action,
                message: s.message,
                core_street_id: s.core_street_id != null ? Number(s.core_street_id) : null,
            }));

        const itemRows = await args.prisma.$queryRaw<DryRunItemRow[]>`
            SELECT
                id AS publish_item_id,
                entity_family,
                publish_action,
                publish_status,
                validation_result
            FROM system.system_publish_items
            WHERE publish_batch_id = ${args.batchId}
        `;

        let would_insert_count = 0;
        let would_update_count = 0;
        let would_skip_count = 0;
        let blocked_count = 0;
        let failed_count = 0;
        let ready_count = 0;
        const sample_errors: PublishBatchDryRunSampleError[] = [];
        const exact_actions: PublishBatchDryRunExactAction[] = [];

        const readyRoadIds: bigint[] = [];
        const pendingItemRows = itemRows.filter((row) => row.publish_status === "pending");

        for (const row of itemRows) {
            const parsed = parsePublishItemValidationResult(row.validation_result);
            if (parsed.status === "ready" || parsed.status === "valid") {
                ready_count += 1;
            } else if (parsed.status === "blocked") {
                blocked_count += 1;
            } else if (parsed.status === "warning") {
                blocked_count += 1;
            } else if (parsed.status != null) {
                failed_count += 1;
            }
        }

        for (const row of pendingItemRows) {
            const parsed = parsePublishItemValidationResult(row.validation_result);
            if (parsed.status === "ready" || parsed.status === "valid") {
                if (row.publish_action === "skip") {
                    would_skip_count += 1;
                } else if (row.publish_action === "update" || row.publish_action === "merge") {
                    would_update_count += 1;
                } else {
                    would_insert_count += 1;
                }
                if (row.entity_family === "roads") {
                    readyRoadIds.push(row.publish_item_id);
                }
            }
        }

        const placeItemIds = pendingItemRows
            .filter((row) => row.entity_family === "places")
            .map((row) => row.publish_item_id);
        if (placeItemIds.length > 0) {
            const placeRows = await args.prisma.$queryRaw<
                {
                    publish_item_id: bigint;
                    candidate_id: bigint | null;
                    external_id: string | null;
                    review_decision: string | null;
                    matched_core_id: bigint | null;
                    publish_action: string;
                    review_note: string | null;
                    review_overrides_archive: unknown;
                    validation_result: unknown;
                }[]
            >`
                SELECT
                    spi.id AS publish_item_id,
                    p.id AS candidate_id,
                    spi.external_id,
                    coalesce(spi.review_decision, p.review_decision) AS review_decision,
                    p.matched_core_id,
                    spi.publish_action,
                    p.review_note,
                    p.review_overrides_archive,
                    spi.validation_result
                FROM system.system_publish_items AS spi
                LEFT JOIN import_review.place_candidates AS p
                    ON p.id = spi.review_candidate_id
                   AND spi.review_candidate_table = 'import_review.place_candidates'
                WHERE spi.id IN (${Prisma.join(placeItemIds)})
            `;

            for (const place of placeRows) {
                const parsed = parsePublishItemValidationResult(place.validation_result);
                const fromNote = parseFieldChoicesFromReviewNote(place.review_note);
                const fromArchive = fieldChoicesFromOverridesArchive(place.review_overrides_archive);
                const selected_fields = Object.keys({ ...fromArchive, ...fromNote });
                let action: PublishBatchDryRunExactAction["action"] =
                    place.publish_action === "insert" ||
                    place.publish_action === "update" ||
                    place.publish_action === "merge" ||
                    place.publish_action === "skip"
                        ? place.publish_action
                        : "no-op";
                let blocked_reason: string | null = null;
                if (parsed.status !== "ready" && parsed.status !== "valid") {
                    action = "blocked";
                    blocked_reason =
                        parsed.errors?.[0]?.message ??
                        `validation_status=${parsed.status ?? "unknown"}`;
                } else if (
                    place.publish_action === "merge" &&
                    selected_fields.length === 0
                ) {
                    action = "blocked";
                    blocked_reason = "merge_fields requires an explicit field_choices map.";
                } else if (
                    (place.publish_action === "update" || place.publish_action === "merge") &&
                    place.matched_core_id == null
                ) {
                    action = "blocked";
                    blocked_reason = "matched_core_id is required for update/merge.";
                }
                exact_actions.push({
                    publish_item_id: Number(place.publish_item_id),
                    candidate_id: place.candidate_id != null ? Number(place.candidate_id) : null,
                    external_id: place.external_id,
                    review_decision: place.review_decision,
                    core_target_id:
                        place.matched_core_id != null ? Number(place.matched_core_id) : null,
                    action,
                    selected_fields,
                    validation_status: parsed.status,
                    blocked_reason,
                });
            }
        }

        const dryRunFailedIds = new Set<string>();

        if (readyRoadIds.length > 0) {
            const roadIssues = await args.prisma.$queryRaw<
                {
                    publish_item_id: bigint;
                    candidate_id: bigint | null;
                    external_id: string | null;
                    code: string;
                    message: string;
                }[]
            >`
                SELECT publish_item_id, candidate_id, external_id, code, message
                FROM (
                    SELECT spi.id AS publish_item_id, r.id AS candidate_id, r.external_id,
                        'geometry_invalid'::text AS code,
                        'Geometry is not valid (ST_IsValid).'::text AS message
                    FROM system.system_publish_items AS spi
                    INNER JOIN import_review.road_candidates AS r ON r.id = spi.review_candidate_id
                    WHERE spi.id IN (${Prisma.join(readyRoadIds)})
                      AND r.geom IS NOT NULL
                      AND NOT ST_IsValid(r.geom)

                    UNION ALL
                    SELECT spi.id, r.id, r.external_id, 'invalid_geometry_type',
                        'Geometry must be LineString or MultiLineString.'
                    FROM system.system_publish_items AS spi
                    INNER JOIN import_review.road_candidates AS r ON r.id = spi.review_candidate_id
                    WHERE spi.id IN (${Prisma.join(readyRoadIds)})
                      AND r.geom IS NOT NULL
                      AND upper(ST_GeometryType(r.geom)) NOT IN ('ST_LINESTRING', 'ST_MULTILINESTRING')

                    UNION ALL
                    SELECT spi.id, r.id, r.external_id, 'road_class_missing',
                        'road_class_id is required.'
                    FROM system.system_publish_items AS spi
                    INNER JOIN import_review.road_candidates AS r ON r.id = spi.review_candidate_id
                    WHERE spi.id IN (${Prisma.join(readyRoadIds)})
                      AND r.road_class_id IS NULL
                ) AS issues
            `;

            for (const issue of roadIssues) {
                const key = issue.publish_item_id.toString();
                if (dryRunFailedIds.has(key)) {
                    continue;
                }
                dryRunFailedIds.add(key);
                const row = pendingItemRows.find((r) => r.publish_item_id === issue.publish_item_id);
                if (row?.publish_action === "skip") {
                    would_skip_count = Math.max(0, would_skip_count - 1);
                } else if (row?.publish_action === "update" || row?.publish_action === "merge") {
                    would_update_count = Math.max(0, would_update_count - 1);
                } else {
                    would_insert_count = Math.max(0, would_insert_count - 1);
                }
                failed_count += 1;
                if (sample_errors.length < 20) {
                    sample_errors.push({
                        candidate_id:
                            issue.candidate_id != null ? Number(issue.candidate_id) : null,
                        external_id: issue.external_id,
                        code: issue.code,
                        message: issue.message,
                    });
                }
            }
        }

        const promotable = would_insert_count + would_update_count + would_skip_count;
        const dryRunStatus = promotable > 0 ? "passed" : "failed";
        const entityFamilies = [...new Set(itemRows.map((row) => row.entity_family))];
        const message =
            dryRunStatus === "passed"
                ? `Dry-run passed: ${would_insert_count} insert(s), ${would_update_count} update(s), ${would_skip_count} skip(s).`
                : "Dry-run failed. Fix sample errors and re-validate.";

        const response = buildPublishBatchDryRunApiResponse({
            batchId: args.batchId,
            status: dryRunStatus,
            entityFamilies,
            total: itemRows.length,
            readyCount: ready_count,
            blockedCount: blocked_count,
            failedCount: failed_count,
            wouldInsertCount: would_insert_count,
            wouldUpdateCount: would_update_count,
            wouldSkipCount: would_skip_count,
            duplicateFixedCount: duplicate_fixed_count,
            duplicateBlockedCount: duplicate_blocked_count,
            duplicateSamples: duplicate_samples,
            sampleErrors: sample_errors,
            exactActions: exact_actions,
            batchStatus: storedStatus,
            message,
        });

        await persistDryRunSummary(args.prisma, args.batchId, response.summary);

        args.log?.info(
            {
                batchId: args.batchId.toString(),
                status: response.status,
                batch_status: storedStatus,
            },
            "publish_batch_dry_run_complete"
        );

        return response;
    } catch (err) {
        const message = err instanceof Error ? err.message : "Dry-run failed unexpectedly.";
        args.log?.error({ err, batchId: args.batchId.toString() }, "publish_batch_dry_run_error");

        const response = buildPublishBatchDryRunApiResponse({
            batchId: args.batchId,
            status: "failed",
            entityFamilies: [],
            total: 0,
            readyCount: 0,
            blockedCount: 0,
            failedCount: 0,
            wouldInsertCount: 0,
            wouldUpdateCount: 0,
            duplicateFixedCount: 0,
            duplicateBlockedCount: 0,
            duplicateSamples: [],
            sampleErrors: [systemErrorSample(message)],
            batchStatus: storedStatus,
            message,
        });

        try {
            await persistDryRunSummary(args.prisma, args.batchId, response.summary);
        } catch (persistErr) {
            args.log?.error({ persistErr }, "publish_batch_dry_run_persist_failed");
        }

        try {
            await releaseBatchedCandidatesForPublishBatch(args.prisma, args.batchId);
        } catch (releaseErr) {
            args.log?.error(
                { err: releaseErr, batchId: args.batchId.toString() },
                "publish_batch_dry_run_release_candidates_failed"
            );
        }

        args.log?.warn(
            {
                batchId: args.batchId.toString(),
                error_code: PUBLISH_BATCH_DRY_RUN_SYSTEM_ERROR_CODE,
            },
            "publish_batch_dry_run_released_batched_candidates"
        );

        return response;
    }
}
