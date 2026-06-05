import type { ImportReviewRoadPromotionGatesResult } from "@/src/lib/api";

/** Matches API {@link ROAD_SQL_BULK_PROMOTION_READY_THRESHOLD}. */
export const ROAD_SQL_BULK_PROMOTION_READY_THRESHOLD = 50;

export const ROAD_SQL_BULK_PROMOTE_SCRIPT =
    "tools/data-pipeline/import-review-bulk/roads_bulk_promote_new_auto.sql";

export const ROAD_SQL_BULK_VALIDATE_SCRIPT =
    "tools/data-pipeline/import-review-bulk/roads_bulk_validate.sql";

export const ROAD_API_BULK_PROMOTION_ENV_VAR = "ENABLE_IMPORT_REVIEW_ROAD_API_BULK_PROMOTION=true";

export const ROAD_API_BULK_PROMOTION_PUBLIC_ENV = "NEXT_PUBLIC_ENABLE_IMPORT_REVIEW_ROAD_API_BULK_PROMOTION";

export type RoadBulkPromotionUxPolicy = {
    isRoadBatch: boolean;
    roadsReadyCount: number;
    recommendSqlBulk: boolean;
    apiBulkPromotionAllowed: boolean;
    disableApiPromote: boolean;
    sqlBulkWarning: string | null;
    promoteDisabledReason: string | null;
    promoteButtonLabelWhenDisabled: string;
    nextSteps: string[];
};

export function isRoadApiBulkPromotionEnabled(
    gates?: ImportReviewRoadPromotionGatesResult | null
): boolean {
    if (gates && typeof gates.api_bulk_promotion_allowed === "boolean") {
        return gates.api_bulk_promotion_allowed;
    }
    return process.env.NEXT_PUBLIC_ENABLE_IMPORT_REVIEW_ROAD_API_BULK_PROMOTION === "true";
}

export function resolveRoadsReadyCountForBulkUx(args: {
    gates?: ImportReviewRoadPromotionGatesResult | null;
    validationReadyCount?: number;
}): number {
    const fromGates = args.gates?.roads_ready_count;
    if (fromGates != null && fromGates > 0) {
        return fromGates;
    }
    return Math.max(0, args.validationReadyCount ?? 0);
}

export function isRoadSqlBulkPromotionRecommended(
    roadsReadyCount: number,
    threshold = ROAD_SQL_BULK_PROMOTION_READY_THRESHOLD
): boolean {
    return roadsReadyCount > threshold;
}

export function buildRoadSqlBulkPsqlCommand(args: {
    script: string;
    publishBatchId: string;
    reviewBatchId?: string | null;
    dryRun?: boolean;
    limitRows?: number | null;
}): string {
    const vars = [
        `-v publish_batch_id=${args.publishBatchId}`,
        args.reviewBatchId ? `-v review_batch_id=${args.reviewBatchId}` : null,
        args.dryRun === false ? "-v dry_run=false" : "-v dry_run=true",
        args.limitRows != null ? `-v limit_rows=${args.limitRows}` : "-v limit_rows=",
    ]
        .filter(Boolean)
        .join(" \\\n  ");
    return `psql "$DATABASE_URL" \\\n  ${vars} \\\n  -f ${args.script}`;
}

export function resolveRoadBulkPromotionUxPolicy(input: {
    hasRoadItems?: boolean;
    roadsItemCount?: number;
    gates?: ImportReviewRoadPromotionGatesResult | null;
    validationReadyCount?: number;
    currentPromotableCount?: number;
    publishItemFailedCount?: number;
    publishItemSuccessCount?: number;
    blockedCount?: number;
    canCreateRetryBatch?: boolean;
    failedReadyRetryCount?: number;
}): RoadBulkPromotionUxPolicy {
    const isRoadBatch = Boolean(
        input.gates?.applies ||
            (input.roadsItemCount ?? 0) > 0 ||
            input.hasRoadItems
    );
    const roadsReadyCount = resolveRoadsReadyCountForBulkUx({
        gates: input.gates,
        validationReadyCount: input.validationReadyCount,
    });
    const recommendSqlBulk =
        input.gates?.recommend_sql_bulk_promotion ??
        isRoadSqlBulkPromotionRecommended(roadsReadyCount);
    const apiBulkPromotionAllowed = isRoadApiBulkPromotionEnabled(input.gates);

    const sqlBulkWarning = recommendSqlBulk
        ? "Large road batch. Promotion may take time. Keep this page open."
        : null;

    const nextSteps: string[] = [];
    if (!isRoadBatch) {
        return {
            isRoadBatch: false,
            roadsReadyCount,
            recommendSqlBulk: false,
            apiBulkPromotionAllowed,
            disableApiPromote: false,
            sqlBulkWarning: null,
            promoteDisabledReason: null,
            promoteButtonLabelWhenDisabled: "Promote",
            nextSteps,
        };
    }

    if (recommendSqlBulk) {
        nextSteps.push(
            "1. Run batch validation in the dashboard (or roads_bulk_validate.sql) — do not skip validation."
        );
        nextSteps.push(
            `2. Dry-run SQL promote: ${ROAD_SQL_BULK_PROMOTE_SCRIPT} with dry_run=true and a small limit_rows first.`
        );
        nextSteps.push(
            `3. Commit SQL promote with dry_run=false, then run roads_bulk_promote_verify.sql.`
        );
        if ((input.currentPromotableCount ?? 0) > 0) {
            nextSteps.push(
                `${input.currentPromotableCount!.toLocaleString()} item(s) are still pending-ready in this batch — SQL bulk can finish them without a new publish batch.`
            );
        }
    } else if ((input.currentPromotableCount ?? 0) > 0) {
        nextSteps.push(
            `Small road batch (${roadsReadyCount.toLocaleString()} ready): dashboard API promotion is OK after validation and road dry-run.`
        );
    }

    if ((input.publishItemSuccessCount ?? 0) > 0 && (input.currentPromotableCount ?? 0) > 0) {
        nextSteps.push(
            `Partial promotion: ${input.publishItemSuccessCount!.toLocaleString()} promoted, ${input.currentPromotableCount!.toLocaleString()} still pending-ready — prefer SQL bulk on this batch.`
        );
    }

    if ((input.publishItemFailedCount ?? 0) > 0) {
        nextSteps.push(
            `Review ${input.publishItemFailedCount!.toLocaleString()} failed publish item(s) below — fix blockers, re-validate, then SQL bulk or retry batch.`
        );
    }

    if (input.canCreateRetryBatch && (input.failedReadyRetryCount ?? 0) > 0) {
        nextSteps.push(
            `When no pending-ready items remain, create a retry batch from ${input.failedReadyRetryCount!.toLocaleString()} failed+ready item(s).`
        );
    } else if (
        (input.currentPromotableCount ?? 0) === 0 &&
        (input.publishItemFailedCount ?? 0) > 0 &&
        !input.canCreateRetryBatch
    ) {
        nextSteps.push(
            "No pending-ready items left — fix failed items or use import-review filters; retry batch only when failed+ready items are eligible."
        );
    }

    if ((input.blockedCount ?? 0) > 0) {
        nextSteps.push(
            `${input.blockedCount!.toLocaleString()} blocked at validation stay in import-review — use “View blocked item details”.`
        );
    }

    return {
        isRoadBatch,
        roadsReadyCount,
        recommendSqlBulk,
        apiBulkPromotionAllowed,
        disableApiPromote: false,
        sqlBulkWarning,
        promoteDisabledReason: null,
        promoteButtonLabelWhenDisabled: "Promote",
        nextSteps,
    };
}
