import type {
    ImportReviewRoadPromotionGateCheck,
    ImportReviewRoadPromotionGatesResult,
} from "@/src/lib/api";

export const MISSING_ROAD_PROMOTION_GATES_MESSAGE =
    "Road promotion gate status is missing from API progress response.";

export const ROAD_PROMOTION_ENV_VAR = "ENABLE_IMPORT_REVIEW_ROAD_PROMOTION=true";
export const ROAD_BULK_PROMOTION_ENV_VAR = "ENABLE_IMPORT_REVIEW_ROAD_BULK_PROMOTION=true";
export const ROAD_PROMOTION_ENV_SETUP_HINT =
    "Set it in apps/api/.env and restart the API.";
/** Matches API IMPORT_REVIEW_ROAD_PROMOTION_MAX_ITEMS. */
export const ROAD_PROMOTION_BULK_THRESHOLD = 3;

const ROUTING_READINESS_GATE_HELPER =
    "Checks DB road fields needed for future Valhalla build. Does not rebuild Valhalla.";

const SAFETY_GATE_IDS = new Set([
    "road_validation_passed",
    "road_dry_run_completed",
    "routing_readiness_validation_completed",
]);

export type ResolveRoadPromotionGatesInput = {
    apiGates?: ImportReviewRoadPromotionGatesResult | null;
    hasRoadItems?: boolean;
    roadsItemCount?: number;
};

export function isRoadPromotionBatch(input: ResolveRoadPromotionGatesInput): boolean {
    if (input.apiGates?.applies) {
        return true;
    }
    if ((input.roadsItemCount ?? 0) > 0) {
        return true;
    }
    return Boolean(input.hasRoadItems);
}

function estimateRoadItemCount(input: ResolveRoadPromotionGatesInput): number {
    if (input.apiGates != null && input.apiGates.road_item_count > 0) {
        return input.apiGates.road_item_count;
    }
    if ((input.roadsItemCount ?? 0) > 0) {
        return input.roadsItemCount ?? 0;
    }
    return input.hasRoadItems ? 1 : 0;
}

function roadBulkPromotionRequired(roadItemCount: number): boolean {
    return roadItemCount > ROAD_PROMOTION_BULK_THRESHOLD;
}

function buildFallbackEnvGates(roadItemCount: number): ImportReviewRoadPromotionGateCheck[] {
    const bulkRequired = roadBulkPromotionRequired(roadItemCount);
    return [
        {
            id: "env_enabled",
            label: ROAD_PROMOTION_ENV_VAR,
            satisfied: false,
            detail: `Set ${ROAD_PROMOTION_ENV_VAR} on the API server. ${ROAD_PROMOTION_ENV_SETUP_HINT}`,
        },
        {
            id: "env_bulk_enabled",
            label: ROAD_BULK_PROMOTION_ENV_VAR,
            satisfied: !bulkRequired,
            detail: bulkRequired
                ? `Set ${ROAD_BULK_PROMOTION_ENV_VAR} on the API server (${roadItemCount.toLocaleString()} road items; max ${ROAD_PROMOTION_BULK_THRESHOLD} without bulk flag). ${ROAD_PROMOTION_ENV_SETUP_HINT}`
                : `Not required for ${roadItemCount.toLocaleString()} road item${roadItemCount === 1 ? "" : "s"} (bulk flag needed above ${ROAD_PROMOTION_BULK_THRESHOLD}).`,
        },
    ];
}

/** Client-only fallback when progress omits gates; never satisfies promotion. */
export function buildMissingRoadPromotionGatesFallback(
    roadItemCount: number
): ImportReviewRoadPromotionGatesResult {
    const count = Math.max(0, roadItemCount);
    return {
        applies: true,
        can_promote: false,
        road_item_count: count,
        env_enabled: false,
        primary_blocker: "road_dry_run_completed",
        primary_blocker_message: MISSING_ROAD_PROMOTION_GATES_MESSAGE,
        gates: [
            {
                id: "road_dry_run_completed",
                label: "Road dry-run completed",
                satisfied: false,
                detail: "Road dry-run status unknown. Run road dry-run to refresh gate status from the API.",
            },
            {
                id: "routing_readiness_validation_completed",
                label: "Routing readiness validation",
                satisfied: false,
                detail: "Routing readiness status unknown. Run road dry-run to refresh gate status from the API.",
                helper: ROUTING_READINESS_GATE_HELPER,
            },
            ...buildFallbackEnvGates(count),
        ],
    };
}

/**
 * Resolves gates for UI and promote blocking. Uses API gates when present; otherwise a
 * conservative fallback for road batches only (can_promote stays false).
 */
export function resolveRoadPromotionGatesForPromoteUi(
    input: ResolveRoadPromotionGatesInput
): ImportReviewRoadPromotionGatesResult | null {
    if (!isRoadPromotionBatch(input)) {
        return null;
    }
    if (input.apiGates != null) {
        return input.apiGates;
    }
    return buildMissingRoadPromotionGatesFallback(estimateRoadItemCount(input));
}

export function roadPromotionSafetyChecksPassed(
    gates: ImportReviewRoadPromotionGatesResult | null | undefined
): boolean {
    if (!gates?.applies) {
        return false;
    }
    return gates.gates.filter((g) => SAFETY_GATE_IDS.has(g.id)).every((g) => g.satisfied);
}

export function roadPromotionBlocksPromote(
    gates: ImportReviewRoadPromotionGatesResult | null | undefined
): boolean {
    if (!gates?.applies || gates.can_promote) {
        return false;
    }
    if (
        gates.recommend_sql_bulk_promotion === true &&
        gates.api_bulk_promotion_allowed !== true
    ) {
        return false;
    }
    return true;
}

export function roadPromotionPrimaryBlockerMessage(
    gates: ImportReviewRoadPromotionGatesResult | null | undefined
): string | null {
    if (!gates?.applies || gates.can_promote) {
        return null;
    }

    if (gates.primary_blocker_message?.trim()) {
        return gates.primary_blocker_message.trim();
    }

    const firstUnsatisfied = gates.gates.find((g) => !g.satisfied) ?? null;
    if (!firstUnsatisfied) {
        return "Complete road promotion safety checks first.";
    }

    const safetyPassed = roadPromotionSafetyChecksPassed(gates);
    const roadItemCount = gates.road_item_count;

    if (safetyPassed && firstUnsatisfied.id === "env_enabled") {
        return `Road promotion is ready, but API env ${ROAD_PROMOTION_ENV_VAR} is not enabled. ${ROAD_PROMOTION_ENV_SETUP_HINT}`;
    }

    if (safetyPassed && firstUnsatisfied.id === "env_bulk_enabled") {
        return `Road promotion is ready, but API env ${ROAD_BULK_PROMOTION_ENV_VAR} is not enabled (${roadItemCount.toLocaleString()} road items). ${ROAD_PROMOTION_ENV_SETUP_HINT}`;
    }

    return firstUnsatisfied.detail;
}

export function missingRoadPromotionEnvKeys(
    gates: ImportReviewRoadPromotionGatesResult | null | undefined
): string[] {
    if (!gates?.applies) {
        return [];
    }
    const missing: string[] = [];
    const envGate = gates.gates.find((g) => g.id === "env_enabled");
    const bulkGate = gates.gates.find((g) => g.id === "env_bulk_enabled");
    if (envGate && !envGate.satisfied) {
        missing.push(ROAD_PROMOTION_ENV_VAR);
    }
    if (bulkGate && !bulkGate.satisfied && roadBulkPromotionRequired(gates.road_item_count)) {
        missing.push(ROAD_BULK_PROMOTION_ENV_VAR);
    }
    return missing;
}
