import { Prisma, type PrismaClient } from "@prisma/client";

import { buildPublishItemValidationResultJson } from "./import-review-promotion-publish-item-validation.js";
import {
    ROAD_DUPLICATE_INSERT_TO_UPDATE_CODE,
    ROAD_DUPLICATE_INSERT_TO_UPDATE_MESSAGE,
} from "./import-review-promotion-road-duplicate-external-id.js";
import type { PublishItemSimpleValidationOutcome } from "./import-review-promotion-simple-batch-validation.js";
import type { PublishItemValidationTarget } from "./import-review-promotion-simple-batch-validation.js";
import { outcomeStatusFromResult } from "./import-review-promotion-simple-batch-validation.js";
import type {
    SimplePromotionValidationIssue,
    SimplePromotionValidationResult,
} from "./import-review-promotion-simple-validation.js";

export type RoadPublishItemValidationSqlRow = {
    publish_item_id: bigint;
    candidate_id: bigint;
    validation_status: string;
    error_code: string | null;
    error_message: string | null;
    validation_warnings: unknown;
};

function parseValidationWarningsJson(raw: unknown): SimplePromotionValidationIssue[] {
    if (!Array.isArray(raw)) {
        return [];
    }
    const warnings: SimplePromotionValidationIssue[] = [];
    for (const entry of raw) {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
            continue;
        }
        const o = entry as Record<string, unknown>;
        const code = typeof o.code === "string" ? o.code : "";
        const message = typeof o.message === "string" ? o.message : "";
        if (code && message) {
            warnings.push({ code, message });
        }
    }
    return warnings;
}

export type RoadPublishItemValidationScope =
    | { publishBatchId: bigint; publishItemIds?: readonly bigint[] }
    | { publishItemIds: readonly bigint[] };

function buildTargetItemsScope(scope: RoadPublishItemValidationScope): Prisma.Sql {
    if ("publishBatchId" in scope && scope.publishBatchId != null) {
        if (scope.publishItemIds && scope.publishItemIds.length > 0) {
            return Prisma.sql`
                spi.publish_batch_id = ${scope.publishBatchId}
                AND spi.entity_family = 'roads'
                AND spi.publish_status = 'pending'
                AND spi.id IN (${Prisma.join(scope.publishItemIds)})
            `;
        }
        return Prisma.sql`
            spi.publish_batch_id = ${scope.publishBatchId}
            AND spi.entity_family = 'roads'
            AND spi.publish_status = 'pending'
        `;
    }

    const itemIds = scope.publishItemIds;
    if (!itemIds || itemIds.length === 0) {
        return Prisma.sql`FALSE`;
    }
    return Prisma.sql`
        spi.id IN (${Prisma.join(itemIds)})
        AND spi.entity_family = 'roads'
        AND spi.publish_status = 'pending'
    `;
}

/**
 * Item-level road publish validation in one set-based statement (no nested spi alias bugs).
 */
export async function validateRoadPublishItemsSql(
    prisma: PrismaClient,
    scope: RoadPublishItemValidationScope
): Promise<RoadPublishItemValidationSqlRow[]> {
    const targetScope = buildTargetItemsScope(scope);

    return prisma.$queryRaw<RoadPublishItemValidationSqlRow[]>`
        WITH target_items AS (
            SELECT
                spi.id AS publish_item_id,
                spi.review_candidate_id AS candidate_id,
                rc.id AS road_candidate_id,
                rc.external_id,
                rc.review_status,
                rc.review_decision,
                rc.promotion_status,
                rc.auto_action,
                rc.match_status,
                rc.matched_core_id,
                rc.road_class_id,
                rc.admin_area_id,
                rc.geom
            FROM system.system_publish_items AS spi
            INNER JOIN import_review.road_candidates AS rc
                ON rc.id = spi.review_candidate_id
            WHERE ${targetScope}
        ),
        validated AS (
            SELECT
                publish_item_id,
                candidate_id,
                CASE
                    WHEN auto_action = 'skip_candidate'
                        OR match_status = 'duplicate_candidate'
                        THEN 'blocked'
                    WHEN review_status IS DISTINCT FROM 'approved'
                        OR review_decision IS DISTINCT FROM 'approved'
                        THEN 'blocked'
                    WHEN promotion_status IS DISTINCT FROM 'batched'
                        THEN 'blocked'
                    WHEN auto_action = 'insert_candidate'
                        AND matched_core_id IS NULL
                        AND nullif(trim(coalesce(external_id, '')), '') IS NOT NULL
                        AND EXISTS (
                            SELECT 1
                            FROM core.core_streets AS c
                            WHERE c.external_id = target_items.external_id
                              AND coalesce(c.is_active, true)
                              AND c.deleted_at IS NULL
                        )
                        THEN 'blocked'
                    WHEN road_class_id IS NULL
                        THEN 'blocked'
                    WHEN admin_area_id IS NULL
                        THEN 'blocked'
                    WHEN geom IS NULL
                        THEN 'blocked'
                    WHEN NOT ST_IsValid(geom)
                        THEN 'blocked'
                    ELSE 'ready'
                END AS validation_status,
                CASE
                    WHEN auto_action = 'skip_candidate'
                        OR match_status = 'duplicate_candidate'
                        THEN 'duplicate_candidate_blocked'
                    WHEN review_status IS DISTINCT FROM 'approved'
                        OR review_decision IS DISTINCT FROM 'approved'
                        THEN 'review_not_approved'
                    WHEN promotion_status IS DISTINCT FROM 'batched'
                        THEN 'not_batched'
                    WHEN auto_action = 'insert_candidate'
                        AND matched_core_id IS NULL
                        AND nullif(trim(coalesce(external_id, '')), '') IS NOT NULL
                        AND EXISTS (
                            SELECT 1
                            FROM core.core_streets AS c
                            WHERE c.external_id = target_items.external_id
                              AND coalesce(c.is_active, true)
                              AND c.deleted_at IS NULL
                        )
                        THEN 'duplicate_external_id_in_core'
                    WHEN road_class_id IS NULL
                        THEN 'missing_road_class'
                    WHEN admin_area_id IS NULL
                        THEN 'missing_admin_area'
                    WHEN geom IS NULL
                        THEN 'missing_geometry'
                    WHEN NOT ST_IsValid(geom)
                        THEN 'invalid_geometry'
                    ELSE NULL
                END AS error_code,
                CASE
                    WHEN auto_action = 'skip_candidate'
                        OR match_status = 'duplicate_candidate'
                        THEN 'Candidate is marked duplicate_candidate and cannot be promoted until reviewed.'
                    WHEN review_status IS DISTINCT FROM 'approved'
                        OR review_decision IS DISTINCT FROM 'approved'
                        THEN 'Candidate must have review_status=approved and review_decision=approved.'
                    WHEN promotion_status IS DISTINCT FROM 'batched'
                        THEN 'Candidate must be promotion_status=batched before validation.'
                    WHEN auto_action = 'insert_candidate'
                        AND matched_core_id IS NULL
                        AND nullif(trim(coalesce(external_id, '')), '') IS NOT NULL
                        AND EXISTS (
                            SELECT 1
                            FROM core.core_streets AS c
                            WHERE c.external_id = target_items.external_id
                              AND coalesce(c.is_active, true)
                              AND c.deleted_at IS NULL
                        )
                        THEN 'Active core street already exists for this external_id; reconcile or approve as update.'
                    WHEN road_class_id IS NULL
                        THEN 'Road class is required.'
                    WHEN admin_area_id IS NULL
                        THEN 'Admin area is required.'
                    WHEN geom IS NULL
                        THEN 'Geometry is required.'
                    WHEN NOT ST_IsValid(geom)
                        THEN 'Geometry is invalid.'
                    ELSE NULL
                END AS error_message,
                CASE
                    WHEN auto_action = 'update_candidate'
                        AND matched_core_id IS NOT NULL
                        AND review_status = 'approved'
                        AND review_decision = 'approved'
                        THEN jsonb_build_array(
                            jsonb_build_object(
                                'code', ${ROAD_DUPLICATE_INSERT_TO_UPDATE_CODE},
                                'message', ${ROAD_DUPLICATE_INSERT_TO_UPDATE_MESSAGE}
                            )
                        )
                    ELSE '[]'::jsonb
                END AS validation_warnings
            FROM target_items
        )
        UPDATE system.system_publish_items AS spi
        SET
            validation_result = jsonb_build_object(
                'status', v.validation_status,
                'errors',
                CASE
                    WHEN v.validation_status = 'blocked' THEN jsonb_build_array(
                        jsonb_build_object(
                            'code', v.error_code,
                            'message', v.error_message
                        )
                    )
                    ELSE '[]'::jsonb
                END,
                'warnings', v.validation_warnings
            ),
            error_message = v.error_message
        FROM validated AS v
        WHERE spi.id = v.publish_item_id
        RETURNING
            spi.id AS publish_item_id,
            v.candidate_id,
            v.validation_status,
            v.error_code,
            v.error_message,
            v.validation_warnings
    `;
}

export function roadValidationSqlRowToOutcome(
    row: RoadPublishItemValidationSqlRow,
    entityFamily = "roads"
): PublishItemSimpleValidationOutcome {
    const validationWarnings = parseValidationWarningsJson(row.validation_warnings);
    const errors =
        row.validation_status === "blocked" && row.error_code && row.error_message
            ? [{ code: row.error_code, message: row.error_message }]
            : [];
    const result: SimplePromotionValidationResult = {
        status:
            row.validation_status === "ready"
                ? validationWarnings.length > 0
                    ? "warning"
                    : "ready"
                : "blocked",
        errors,
        warnings: validationWarnings,
    };
    return {
        publish_item_id: row.publish_item_id,
        entity_family: entityFamily,
        status: outcomeStatusFromResult(result, false),
        skipped: false,
        result,
    };
}

export function roadValidationSqlRowsToOutcomes(
    targets: readonly PublishItemValidationTarget[],
    rows: readonly RoadPublishItemValidationSqlRow[]
): PublishItemSimpleValidationOutcome[] {
    const rowByItemId = new Map(rows.map((r) => [r.publish_item_id.toString(), r]));
    return targets.map((target) => {
        const row = rowByItemId.get(target.publish_item_id.toString());
        if (!row) {
            const result: SimplePromotionValidationResult = {
                status: "blocked",
                errors: [
                    {
                        code: "missing_publish_item",
                        message: "Publish item was not found for road validation.",
                    },
                ],
                warnings: [],
            };
            return {
                publish_item_id: target.publish_item_id,
                entity_family: target.entity_family,
                status: "blocked",
                skipped: false,
                result,
            };
        }
        return roadValidationSqlRowToOutcome(row, target.entity_family);
    });
}

/** Build validation_result JSON for terminal validation SQL failures (persisted before batch cleanup). */
export function buildValidationSystemErrorResultJson(
    errorMessage: string
): Record<string, unknown> {
    return buildPublishItemValidationResultJson({
        status: "blocked",
        errors: [
            {
                code: "VALIDATION_SYSTEM_ERROR",
                message: errorMessage,
            },
        ],
        warnings: [],
    }) as unknown as Record<string, unknown>;
}
