import type { FastifyBaseLogger } from "fastify";

import {
    extractPrismaRawQueryErrorDetails,
    type PrismaRawQueryErrorDetails,
} from "./import-review-prisma-raw-error.js";
import { extractPromotionFailureCause, type PromotionFailureCause } from "./import-review-promotion-failure-cause.js";
import type { PromoteItemResult } from "./import-review-promotion-promote.types.js";

/** SQL steps executed during road publish-item promotion (core write path). */
export type RoadPromotionSqlStep =
    | "load_preflight"
    | "insert_core_street"
    | "update_core_street"
    | "explain_insert_blocked"
    | "sync_street_names_lookup"
    | "sync_street_names_insert";

export type RoadPromotionSqlContext = {
    publish_item_id: bigint;
    candidate_id?: bigint | null;
    external_id?: string | null;
    target_id?: bigint | null;
};

export type RoadPromotionSqlFailureDetail = RoadPromotionSqlContext & {
    step: RoadPromotionSqlStep;
    operation: string;
    postgres: PrismaRawQueryErrorDetails | null;
    failure_cause: PromotionFailureCause;
};

export class RoadPromotionSqlStepError extends Error {
    readonly step: RoadPromotionSqlStep;
    readonly operation: string;
    readonly context: RoadPromotionSqlContext;
    readonly postgres: PrismaRawQueryErrorDetails | null;
    readonly failureCause: PromotionFailureCause;

    constructor(args: {
        step: RoadPromotionSqlStep;
        operation: string;
        context: RoadPromotionSqlContext;
        cause: unknown;
    }) {
        const postgres = extractPrismaRawQueryErrorDetails(args.cause);
        const failureCause = extractPromotionFailureCause(args.cause);
        const message =
            postgres?.database_message?.trim() ||
            failureCause.message ||
            (args.cause instanceof Error ? args.cause.message : "Road promotion SQL failed.");
        super(message);
        this.name = "RoadPromotionSqlStepError";
        this.step = args.step;
        this.operation = args.operation;
        this.context = args.context;
        this.postgres = postgres;
        this.failureCause = failureCause;
    }

    toFailureDetail(): RoadPromotionSqlFailureDetail {
        return {
            publish_item_id: this.context.publish_item_id,
            candidate_id: this.context.candidate_id ?? null,
            external_id: this.context.external_id ?? null,
            target_id: this.context.target_id ?? null,
            step: this.step,
            operation: this.operation,
            postgres: this.postgres,
            failure_cause: this.failureCause,
        };
    }
}

export function roadPromotionOperationLabel(step: RoadPromotionSqlStep): string {
    switch (step) {
        case "load_preflight":
            return "load_road_preflight_row";
        case "insert_core_street":
            return "insert_core_streets";
        case "update_core_street":
            return "update_core_streets";
        case "explain_insert_blocked":
            return "explain_road_insert_blocked";
        case "sync_street_names_lookup":
            return "select_core_street_names";
        case "sync_street_names_insert":
            return "insert_core_street_names";
        default:
            return step;
    }
}

export function logRoadPromotionSqlFailure(
    log: FastifyBaseLogger | undefined,
    detail: RoadPromotionSqlFailureDetail
): void {
    log?.error(
        {
            step: detail.step,
            operation: detail.operation,
            publish_item_id: detail.publish_item_id.toString(),
            candidate_id: detail.candidate_id?.toString() ?? null,
            external_id: detail.external_id ?? null,
            target_id: detail.target_id?.toString() ?? null,
            sqlstate: detail.postgres?.sqlstate ?? detail.failure_cause.sqlstate ?? null,
            prisma_code: detail.postgres?.prisma_code ?? detail.failure_cause.prisma_code ?? null,
            database_message:
                detail.postgres?.database_message ?? detail.failure_cause.raw_message ?? null,
            constraint_name: detail.postgres?.constraint_name ?? detail.failure_cause.constraint ?? null,
            table_name: detail.postgres?.table_name ?? null,
            column_name: detail.postgres?.column_name ?? null,
        },
        "road promotion SQL step failed"
    );
}

export async function runRoadPromotionSqlStep<T>(
    step: RoadPromotionSqlStep,
    context: RoadPromotionSqlContext,
    fn: () => Promise<T>
): Promise<T> {
    try {
        return await fn();
    } catch (cause) {
        throw new RoadPromotionSqlStepError({
            step,
            operation: roadPromotionOperationLabel(step),
            context,
            cause,
        });
    }
}

export function promoteItemResultFromRoadSqlStepError(
    publishItemId: bigint,
    err: RoadPromotionSqlStepError
): PromoteItemResult {
    const detail = err.toFailureDetail();
    return {
        publish_item_id: publishItemId,
        outcome: "failed",
        target_id: null,
        error_message: err.message,
        before_data: null,
        after_data: { road_promotion_failure: detail },
        failure_cause: err.failureCause,
    };
}

export function promoteItemResultFromThrownPromotionError(
    publishItemId: bigint,
    err: unknown
): PromoteItemResult {
    if (err instanceof RoadPromotionSqlStepError) {
        return promoteItemResultFromRoadSqlStepError(publishItemId, err);
    }
    const cause = extractPromotionFailureCause(err);
    const postgres = extractPrismaRawQueryErrorDetails(err);
    return {
        publish_item_id: publishItemId,
        outcome: "failed",
        target_id: null,
        error_message: cause.message,
        before_data: null,
        after_data: postgres
            ? { postgres, failure_cause: cause }
            : { failure_cause: cause },
        failure_cause: cause,
    };
}

/** Prefer the first non-aborted Postgres error in a Prisma failure chain. */
export function unwrapAbortedTransactionError(err: unknown): unknown {
    if (!(err instanceof Error)) {
        return err;
    }
    const meta = (err as Error & { meta?: { code?: string; message?: string } }).meta;
    if (meta?.code === "25P02") {
        const cause = (err as Error & { cause?: unknown }).cause;
        if (cause) {
            return unwrapAbortedTransactionError(cause);
        }
    }
    return err;
}
