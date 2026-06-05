import type { FastifyBaseLogger } from "fastify";
import type { PrismaClient } from "@prisma/client";

import { buildPublishItemValidationResultJson } from "./import-review-promotion-publish-item-validation.js";
import {
    outcomeStatusFromResult,
    type PublishItemSimpleValidationOutcome,
    type PublishItemValidationTarget,
} from "./import-review-promotion-simple-batch-validation.js";
import type {
    SimplePromotionValidationIssue,
    SimplePromotionValidationResult,
} from "./import-review-promotion-simple-validation.js";
import { resolveSimplePromotionValidationStatus } from "./import-review-promotion-simple-validation.js";
import { reconcileRoadDuplicateExternalIds } from "./import-review-promotion-road-duplicate-external-id.js";
import {
    roadValidationSqlRowsToOutcomes,
    validateRoadPublishItemsSql,
} from "./import-review-promotion-roads-validate-sql.js";
import type { RoadBulkValidationIssueRow } from "./import-review-promotion-roads-bulk-validation.types.js";
import {
    ImportReviewPublishBatchValidationAbortedError,
} from "./import-review-promotion-validation-control.js";

export type ValidateRoadTargetsContext = {
    publishBatchId?: bigint;
    shouldAbort?: () => Promise<boolean>;
    log?: FastifyBaseLogger;
};

function issueFromRow(row: RoadBulkValidationIssueRow): SimplePromotionValidationIssue {
    return {
        code: row.code,
        message: row.message,
        ...(row.field ? { field: row.field } : {}),
    };
}

/** @deprecated Kept for unit tests that assert issue aggregation semantics. */
export function aggregateRoadBulkValidationOutcomes(
    targets: readonly PublishItemValidationTarget[],
    issueRows: readonly RoadBulkValidationIssueRow[]
): PublishItemSimpleValidationOutcome[] {
    const errorsByItem = new Map<string, SimplePromotionValidationIssue[]>();
    const warningsByItem = new Map<string, SimplePromotionValidationIssue[]>();

    for (const row of issueRows) {
        const key = row.publish_item_id.toString();
        const issue = issueFromRow(row);
        if (row.severity === "error") {
            const list = errorsByItem.get(key) ?? [];
            list.push(issue);
            errorsByItem.set(key, list);
        } else {
            const list = warningsByItem.get(key) ?? [];
            list.push(issue);
            warningsByItem.set(key, list);
        }
    }

    return targets.map((target) => {
        const key = target.publish_item_id.toString();
        const errors = errorsByItem.get(key) ?? [];
        const warnings = warningsByItem.get(key) ?? [];
        const result: SimplePromotionValidationResult = {
            status: resolveSimplePromotionValidationStatus(errors, warnings),
            errors,
            warnings,
        };
        return {
            publish_item_id: target.publish_item_id,
            entity_family: target.entity_family,
            status: outcomeStatusFromResult(result, false),
            skipped: false,
            result,
        };
    });
}

export function summarizeRoadBulkValidationOutcomes(
    outcomes: readonly PublishItemSimpleValidationOutcome[],
    elapsedMs: number,
    issueQueryMs: number
): {
    ready_count: number;
    warning_count: number;
    blocked_count: number;
    top_blocked_reasons: { code: string; count: number }[];
    elapsed_ms: number;
    issue_query_ms: number;
} {
    let ready_count = 0;
    let warning_count = 0;
    let blocked_count = 0;
    const blockedReasons = new Map<string, number>();

    for (const outcome of outcomes) {
        if (outcome.status === "ready") {
            ready_count += 1;
        } else if (outcome.status === "warning") {
            warning_count += 1;
        } else if (outcome.status === "blocked") {
            blocked_count += 1;
            for (const err of outcome.result.errors) {
                blockedReasons.set(err.code, (blockedReasons.get(err.code) ?? 0) + 1);
            }
        }
    }

    const top_blocked_reasons = [...blockedReasons.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([code, count]) => ({ code, count }));

    return {
        ready_count,
        warning_count,
        blocked_count,
        top_blocked_reasons,
        elapsed_ms: elapsedMs,
        issue_query_ms: issueQueryMs,
    };
}

export class ImportReviewPromotionRoadsBulkValidation {
    constructor(private readonly prisma: PrismaClient) {}

    async validateRoadTargets(
        targets: readonly PublishItemValidationTarget[],
        ctx: ValidateRoadTargetsContext = {}
    ): Promise<PublishItemSimpleValidationOutcome[]> {
        const startedAt = Date.now();
        const roadTargets = targets.filter((t) => t.entity_family === "roads");
        if (roadTargets.length === 0) {
            return [];
        }

        if (ctx.shouldAbort && (await ctx.shouldAbort())) {
            throw new ImportReviewPublishBatchValidationAbortedError(
                (ctx.publishBatchId ?? 0n).toString(),
                "cancelled",
                "Validation cancelled."
            );
        }

        const issueStartedAt = Date.now();
        const scope =
            ctx.publishBatchId != null
                ? {
                      publishBatchId: ctx.publishBatchId,
                      publishItemIds: roadTargets.map((t) => t.publish_item_id),
                  }
                : { publishItemIds: roadTargets.map((t) => t.publish_item_id) };

        await reconcileRoadDuplicateExternalIds(this.prisma, {
            ...(ctx.publishBatchId != null ? { publishBatchId: ctx.publishBatchId } : {}),
            candidateIds: roadTargets.map((t) => t.review_candidate_id),
        });

        const rows = await validateRoadPublishItemsSql(this.prisma, scope);
        const issueQueryMs = Date.now() - issueStartedAt;

        const outcomes = roadValidationSqlRowsToOutcomes(roadTargets, rows);
        const summary = summarizeRoadBulkValidationOutcomes(
            outcomes,
            Date.now() - startedAt,
            issueQueryMs
        );

        ctx.log?.info(
            {
                publishBatchId: ctx.publishBatchId?.toString(),
                itemCount: roadTargets.length,
                ...summary,
                engine: "import-review-promotion-roads-validate-sql",
            },
            "[import-review] roads bulk validation complete"
        );

        return outcomes;
    }
}

export function toPersistedValidationJsonFromOutcome(
    outcome: PublishItemSimpleValidationOutcome
): Record<string, unknown> {
    if (outcome.skipped) {
        return buildPublishItemValidationResultJson({
            status: "warning",
            errors: [],
            warnings: outcome.result.warnings,
        }) as unknown as Record<string, unknown>;
    }
    return buildPublishItemValidationResultJson({
        status: outcome.result.status,
        errors: outcome.result.errors,
        warnings: outcome.result.warnings,
    }) as unknown as Record<string, unknown>;
}
