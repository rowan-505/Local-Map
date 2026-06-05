import {
    IMPORT_REVIEW_ROAD_PROMOTION_MAX_ITEMS,
    isImportReviewRoadApiBulkPromotionEnabled,
    isImportReviewRoadBulkPromotionEnabled,
    isImportReviewRoadPromotionEnabled,
    ROAD_API_BULK_PROMOTION_ENV_VAR,
    ROAD_SQL_BULK_PROMOTION_READY_THRESHOLD,
} from "./import-review-config.js";
import type { ImportReviewRoadDryRunSummary } from "./import-review-road-dry-run-summary.types.js";
import type { ImportReviewRoadRoutingReadinessSummary } from "./import-review-road-routing-readiness.types.js";
import type { ImportReviewPromotionRoadDryRunResult } from "./import-review-promotion-road-dry-run.types.js";
import type { PromotionPreflightValidation } from "./import-review-promotion-promote-api.js";
import {
    parsePublishBatchDryRunResultFromSummary,
    publishBatchDryRunPassed,
    type PublishBatchDryRunResult,
} from "./import-review-publish-batch-dry-run.js";
import {
    batchValidatedForPromotion,
    validationSummaryAllowsPromotion,
} from "./import-review-promotion-promote-readiness.js";

export type RoadPromotionGateId =
    | "env_enabled"
    | "env_bulk_enabled"
    | "road_validation_passed"
    | "road_dry_run_completed"
    | "routing_readiness_validation_completed";

export const ROAD_PROMOTION_ENV_VAR = "ENABLE_IMPORT_REVIEW_ROAD_PROMOTION=true";
export const ROAD_BULK_PROMOTION_ENV_VAR = "ENABLE_IMPORT_REVIEW_ROAD_BULK_PROMOTION=true";
const ROAD_PROMOTION_ENV_SETUP_HINT = "Set it in apps/api/.env and restart the API.";

/** @deprecated Use routing_readiness_validation_completed */
export type LegacyRoadPromotionGateId = RoadPromotionGateId | "routing_validation_completed";

export type RoadPromotionGateCheck = {
    id: RoadPromotionGateId;
    label: string;
    satisfied: boolean;
    detail: string;
    helper?: string;
};

export type RoadPromotionGatesResult = {
    applies: boolean;
    can_promote: boolean;
    road_item_count: number;
    roads_ready_count: number;
    recommend_sql_bulk_promotion: boolean;
    api_bulk_promotion_allowed: boolean;
    sql_bulk_promotion_ready_threshold: number;
    sql_bulk_promote_script: string;
    sql_bulk_validate_script: string;
    env_enabled: boolean;
    gates: RoadPromotionGateCheck[];
    primary_blocker: RoadPromotionGateId | null;
    primary_blocker_message: string | null;
};

export type RoadPromoteRequestConfirmations = {
    allow_high_risk_families: boolean;
    confirm_large_batch: boolean;
};

export type EvaluateRoadPromotionGatesInput = {
    road_item_count: number;
    validation_percent: number;
    validation: PromotionPreflightValidation | null;
    /** When set (POST promote only), applies API promote confirmation + env rules. */
    promote_request?: RoadPromoteRequestConfirmations;
    /** Publish batch lifecycle status (e.g. dry_run_passed). */
    batch_status?: string | null;
    /** summary.dry_run_result from batch POST /dry-run. */
    publish_batch_dry_run?: PublishBatchDryRunResult | null;
    /** Raw batch summary when only publish_batch_dry_run is needed. */
    batch_summary?: unknown;
    road_dry_run: ImportReviewRoadDryRunSummary | null;
    routing_readiness_validation: ImportReviewRoadRoutingReadinessSummary | null;
    /** Legacy detailed road dry-run payload (optional; display / large batches). */
    dry_run?: ImportReviewPromotionRoadDryRunResult | null;
    roads_ready_at_validation?: number;
};

export { publishBatchDryRunPassed, parsePublishBatchDryRunResultFromSummary };

export const ROUTING_READINESS_GATE_HELPER =
    "Checks DB road fields needed for future Valhalla build. Does not rebuild Valhalla.";

export function roadValidationPassedAtBatch(input: EvaluateRoadPromotionGatesInput): boolean {
    const batchOk =
        batchValidatedForPromotion({
            status: input.batch_status ?? "ready",
            validation_percent: input.validation_percent,
            validated_at: input.validation_percent >= 100 ? new Date() : null,
        }) && validationSummaryAllowsPromotion(input.validation);

    if (!batchOk) {
        return false;
    }

    const roadsReady = input.roads_ready_at_validation ?? 0;
    if (roadsReady > 0) {
        return true;
    }

    const promotable = input.validation?.promotable_count ?? 0;
    return promotable > 0 && input.road_item_count > 0;
}

export function roadDryRunPassed(summary: ImportReviewRoadDryRunSummary | null): boolean {
    if (!summary?.ran_at?.trim()) {
        return false;
    }
    if (summary.checked_count <= 0) {
        return false;
    }
    return summary.status === "passed" && summary.failed_count === 0;
}

export function routingReadinessPassed(
    summary: ImportReviewRoadRoutingReadinessSummary | null
): boolean {
    if (!summary?.ran_at?.trim()) {
        return false;
    }
    if (summary.type !== "db_routing_readiness") {
        return false;
    }
    if (summary.checked_count <= 0) {
        return false;
    }
    return summary.status === "passed" && summary.failed_count === 0;
}

/** @deprecated Prefer roadDryRunPassed(summary). */
export function roadDryRunCompleted(
    dryRun: ImportReviewPromotionRoadDryRunResult | null,
    roadItemCount: number
): boolean {
    if (!dryRun?.finished_at?.trim()) {
        return false;
    }
    if (dryRun.total_count <= 0) {
        return false;
    }
    return dryRun.total_count >= roadItemCount || dryRun.items.length >= roadItemCount;
}

/** @deprecated Prefer routingReadinessPassed. Legacy connectivity_summary on dry_run_result. */
export function legacyRoutingValidationCompleted(
    dryRun: ImportReviewPromotionRoadDryRunResult | null
): boolean {
    if (!dryRun?.finished_at?.trim() || dryRun.items.length === 0) {
        return false;
    }

    const needsRoutingCheck = dryRun.items.filter(
        (item) =>
            item.dry_run_status === "safe_to_promote" ||
            item.dry_run_status === "promote_with_warning" ||
            item.dry_run_status === "needs_manual_review"
    );

    if (needsRoutingCheck.length === 0) {
        return true;
    }

    return needsRoutingCheck.every(
        (item) =>
            item.connectivity_summary != null &&
            typeof item.connectivity_summary.validation_mode === "string" &&
            item.connectivity_summary.validation_mode.length > 0
    );
}

export function routingReadinessValidationCompleted(
    summary: ImportReviewRoadRoutingReadinessSummary | null,
    dryRun: ImportReviewPromotionRoadDryRunResult | null
): boolean {
    if (routingReadinessPassed(summary)) {
        return true;
    }
    if (summary == null && dryRun != null) {
        return legacyRoutingValidationCompleted(dryRun);
    }
    return false;
}

function roadBulkPromotionRequired(roadItemCount: number): boolean {
    return roadItemCount > IMPORT_REVIEW_ROAD_PROMOTION_MAX_ITEMS;
}

function resolveRoadsReadyCount(input: EvaluateRoadPromotionGatesInput): number {
    if (input.roads_ready_at_validation != null && input.roads_ready_at_validation > 0) {
        return input.roads_ready_at_validation;
    }
    const ready = input.validation?.ready_count ?? 0;
    return Math.max(0, ready);
}

function recommendSqlBulkPromotion(roadsReadyCount: number): boolean {
    return roadsReadyCount > ROAD_SQL_BULK_PROMOTION_READY_THRESHOLD;
}

function buildRoadPromotionEnvGates(
    roadItemCount: number,
    envEnabled: boolean,
    bulkEnvEnabled: boolean
): RoadPromotionGateCheck[] {
    const bulkRequired = roadBulkPromotionRequired(roadItemCount);
    const bulkSatisfied = !bulkRequired || bulkEnvEnabled;

    return [
        {
            id: "env_enabled",
            label: ROAD_PROMOTION_ENV_VAR,
            satisfied: envEnabled,
            detail: envEnabled
                ? "Road promotion is enabled on the API server."
                : `Set ${ROAD_PROMOTION_ENV_VAR} on the API server. ${ROAD_PROMOTION_ENV_SETUP_HINT}`,
        },
        {
            id: "env_bulk_enabled",
            label: ROAD_BULK_PROMOTION_ENV_VAR,
            satisfied: bulkSatisfied,
            detail: bulkRequired
                ? bulkEnvEnabled
                    ? `Bulk road promotion enabled for ${roadItemCount.toLocaleString()} road item(s).`
                    : `Set ${ROAD_BULK_PROMOTION_ENV_VAR} on the API server (${roadItemCount.toLocaleString()} road items; max ${IMPORT_REVIEW_ROAD_PROMOTION_MAX_ITEMS} without bulk flag). ${ROAD_PROMOTION_ENV_SETUP_HINT}`
                : `Not required for ${roadItemCount.toLocaleString()} road item${roadItemCount === 1 ? "" : "s"} (bulk flag needed above ${IMPORT_REVIEW_ROAD_PROMOTION_MAX_ITEMS}).`,
        },
    ];
}

export function roadPromotionSafetyChecksPassed(gates: RoadPromotionGateCheck[]): boolean {
    return gates
        .filter(
            (g) =>
                g.id === "road_validation_passed" ||
                g.id === "road_dry_run_completed" ||
                g.id === "routing_readiness_validation_completed"
        )
        .every((g) => g.satisfied);
}

export function resolveRoadPromotionPrimaryBlockerMessage(
    gates: RoadPromotionGateCheck[],
    firstUnsatisfied: RoadPromotionGateCheck | null,
    roadItemCount: number
): string | null {
    if (!firstUnsatisfied) {
        return null;
    }

    const safetyPassed = roadPromotionSafetyChecksPassed(gates);

    if (safetyPassed && firstUnsatisfied.id === "env_enabled") {
        return `Road promotion is ready, but API env ${ROAD_PROMOTION_ENV_VAR} is not enabled. ${ROAD_PROMOTION_ENV_SETUP_HINT}`;
    }

    if (safetyPassed && firstUnsatisfied.id === "env_bulk_enabled") {
        return `Road promotion is ready, but API env ${ROAD_BULK_PROMOTION_ENV_VAR} is not enabled (${roadItemCount.toLocaleString()} road items). ${ROAD_PROMOTION_ENV_SETUP_HINT}`;
    }

    return firstUnsatisfied.detail;
}

export function evaluateRoadPromotionGates(
    input: EvaluateRoadPromotionGatesInput
): RoadPromotionGatesResult {
    const roadItemCount = Math.max(0, input.road_item_count);
    const applies = roadItemCount > 0;
    const envEnabled = isImportReviewRoadPromotionEnabled();
    const bulkEnvEnabled = isImportReviewRoadBulkPromotionEnabled();

    if (!applies) {
        return {
            applies: false,
            can_promote: true,
            road_item_count: 0,
            roads_ready_count: 0,
            recommend_sql_bulk_promotion: false,
            api_bulk_promotion_allowed: isImportReviewRoadApiBulkPromotionEnabled(),
            sql_bulk_promotion_ready_threshold: ROAD_SQL_BULK_PROMOTION_READY_THRESHOLD,
            sql_bulk_promote_script:
                "tools/data-pipeline/import-review-bulk/roads_bulk_promote_new_auto.sql",
            sql_bulk_validate_script: "tools/data-pipeline/import-review-bulk/roads_bulk_validate.sql",
            env_enabled: envEnabled,
            gates: [],
            primary_blocker: null,
            primary_blocker_message: null,
        };
    }

    const roadsReadyCount = resolveRoadsReadyCount(input);
    const sqlBulkRecommended = recommendSqlBulkPromotion(roadsReadyCount);
    const apiBulkAllowed = isImportReviewRoadApiBulkPromotionEnabled();

    const validationPassed = roadValidationPassedAtBatch(input);
    const publishBatchDryRun =
        input.publish_batch_dry_run ??
        parsePublishBatchDryRunResultFromSummary(input.batch_summary);
    const batchDryRunDone = publishBatchDryRunPassed(publishBatchDryRun);
    const detailedRoadDryRunDone =
        roadDryRunPassed(input.road_dry_run) ||
        roadDryRunCompleted(input.dry_run ?? null, roadItemCount);
    const dryRunDone = batchDryRunDone || detailedRoadDryRunDone;
    const routingDone =
        batchDryRunDone ||
        routingReadinessValidationCompleted(
            input.routing_readiness_validation,
            input.dry_run ?? null
        );

    const gates: RoadPromotionGateCheck[] = [
        {
            id: "road_validation_passed",
            label: "Road validation passed",
            satisfied: validationPassed,
            detail: validationPassed
                ? "Batch validation is complete with promotable road items."
                : "Run batch validation and resolve blocked road publish items first.",
        },
        {
            id: "road_dry_run_completed",
            label: "Road dry-run completed",
            satisfied: dryRunDone,
            detail: dryRunDone
                ? batchDryRunDone
                    ? `Batch dry-run passed (${publishBatchDryRun?.total ?? roadItemCount} item(s)).`
                    : `Road dry-run passed for ${input.road_dry_run?.checked_count ?? input.dry_run?.total_count ?? 0} road item(s).`
                : "Run batch dry-run after validation before promotion.",
        },
        {
            id: "routing_readiness_validation_completed",
            label: "Routing readiness validation",
            satisfied: routingDone,
            helper: ROUTING_READINESS_GATE_HELPER,
            detail: routingDone
                ? batchDryRunDone && !routingReadinessPassed(input.routing_readiness_validation)
                    ? "Batch dry-run passed; routing readiness optional for this batch size."
                    : `DB routing readiness passed for ${input.routing_readiness_validation?.checked_count ?? 0} item(s).`
                : dryRunDone
                  ? "Re-run road dry-run to refresh routing readiness validation."
                  : "Run batch dry-run after validation first.",
        },
        ...buildRoadPromotionEnvGates(roadItemCount, envEnabled, bulkEnvEnabled),
    ];

    const firstUnsatisfied = gates.find((g) => !g.satisfied) ?? null;
    const safetyAndEnvOk = gates.every((g) => g.satisfied);
    const apiPromoteAllowedLegacy = !sqlBulkRecommended || apiBulkAllowed;

    let primaryBlocker = firstUnsatisfied?.id ?? null;
    let primaryMessage = resolveRoadPromotionPrimaryBlockerMessage(
        gates,
        firstUnsatisfied,
        roadItemCount
    );

    let can_promote: boolean;
    if (input.promote_request) {
        const apiGate = resolveRoadPromoteApiAllowed({
            envEnabled,
            apiBulkAllowed,
            sqlBulkRecommended,
            validationPassed,
            batchDryRunDone: dryRunDone,
            promoteRequest: input.promote_request,
        });
        can_promote = apiGate.allowed;
        if (!apiGate.allowed && apiGate.message) {
            primaryMessage = apiGate.message;
            if (apiGate.message.includes(ROAD_API_BULK_PROMOTION_ENV_VAR)) {
                primaryBlocker = "env_bulk_enabled";
            } else if (apiGate.message.includes("high-risk")) {
                primaryBlocker = "env_enabled";
            } else if (apiGate.message.includes("large-batch")) {
                primaryBlocker = "env_enabled";
            } else if (!validationPassed) {
                primaryBlocker = "road_validation_passed";
            } else if (!dryRunDone) {
                primaryBlocker = "road_dry_run_completed";
            } else if (!envEnabled) {
                primaryBlocker = "env_enabled";
            }
        }
    } else {
        can_promote = safetyAndEnvOk && apiPromoteAllowedLegacy;
        if (safetyAndEnvOk && !apiPromoteAllowedLegacy) {
            primaryBlocker = "env_bulk_enabled";
            primaryMessage = `Large road batches (${roadsReadyCount.toLocaleString()} ready, threshold ${ROAD_SQL_BULK_PROMOTION_READY_THRESHOLD}) should be promoted with SQL bulk scripts, not the dashboard API. Set ${ROAD_API_BULK_PROMOTION_ENV_VAR} only for intentional API smoke tests.`;
        }
    }

    return {
        applies: true,
        can_promote,
        road_item_count: roadItemCount,
        roads_ready_count: roadsReadyCount,
        recommend_sql_bulk_promotion: sqlBulkRecommended,
        api_bulk_promotion_allowed: apiBulkAllowed,
        sql_bulk_promotion_ready_threshold: ROAD_SQL_BULK_PROMOTION_READY_THRESHOLD,
        sql_bulk_promote_script:
            "tools/data-pipeline/import-review-bulk/roads_bulk_promote_new_auto.sql",
        sql_bulk_validate_script: "tools/data-pipeline/import-review-bulk/roads_bulk_validate.sql",
        env_enabled: envEnabled,
        gates,
        primary_blocker: primaryBlocker,
        primary_blocker_message: primaryMessage,
    };
}

export function roadPromotionGateErrorMessage(gates: RoadPromotionGatesResult): string {
    if (!gates.applies || gates.can_promote) {
        return "Road promotion gates are satisfied.";
    }
    return (
        gates.primary_blocker_message ??
        "Road promotion safety checks are not complete."
    );
}

/** API POST /promote gate for road batches (does not affect validation or dry-run endpoints). */
export function resolveRoadPromoteApiAllowed(input: {
    envEnabled: boolean;
    apiBulkAllowed: boolean;
    sqlBulkRecommended: boolean;
    validationPassed: boolean;
    batchDryRunDone: boolean;
    promoteRequest: RoadPromoteRequestConfirmations;
}): { allowed: boolean; message: string | null } {
    if (!input.envEnabled) {
        return {
            allowed: false,
            message: `Road promotion is ready, but API env ${ROAD_PROMOTION_ENV_VAR} is not enabled. ${ROAD_PROMOTION_ENV_SETUP_HINT}`,
        };
    }
    if (!input.validationPassed) {
        return { allowed: false, message: "Run batch validation before promotion." };
    }
    if (!input.batchDryRunDone) {
        return {
            allowed: false,
            message: "Run batch dry-run after validation before promotion.",
        };
    }
    if (!input.promoteRequest.allow_high_risk_families) {
        return { allowed: false, message: "Check high-risk confirmation." };
    }
    if (!input.promoteRequest.confirm_large_batch) {
        return { allowed: false, message: "Check large-batch confirmation." };
    }
    if (input.sqlBulkRecommended && !input.apiBulkAllowed) {
        return {
            allowed: false,
            message: `Large road batches (${ROAD_SQL_BULK_PROMOTION_READY_THRESHOLD}+ ready at validation) should be promoted with SQL bulk scripts, not the dashboard API. Set ${ROAD_API_BULK_PROMOTION_ENV_VAR} only for intentional API smoke tests.`,
        };
    }
    return { allowed: true, message: null };
}

export function logRoadPromoteGateDebug(input: {
    batchId: string;
    readyCount: number;
    isRoadBatch: boolean;
    dryRunPassed: boolean;
    envRoadPromotion: boolean;
    envRoadBulkPromotion: boolean;
    envRoadApiBulkPromotion?: boolean;
    allowHighRisk: boolean;
    confirmLargeBatch: boolean;
    allowed?: boolean;
    message?: string | null;
}): void {
    if (process.env.NODE_ENV === "production") {
        return;
    }
    console.debug("[publish-batch] promote gate", input);
}
