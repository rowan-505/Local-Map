export type PublishBatchPromotionOutcomeStatus =
    | "not_started"
    | "promoting"
    | "promoted"
    | "partially_promoted"
    | "promotion_failed";

export function formatPublishBatchPromotionStatus(
    status: PublishBatchPromotionOutcomeStatus | string | null | undefined
): string {
    switch (status) {
        case "not_started":
            return "Not started";
        case "promoting":
            return "Promoting";
        case "promoted":
            return "Promoted";
        case "partially_promoted":
            return "Partially promoted";
        case "promotion_failed":
            return "Promotion failed";
        default:
            return status?.trim() ? status : "—";
    }
}

export function formatPublishBatchValidationOutcome(
    outcome: string | null | undefined
): string {
    switch (outcome) {
        case "passed":
        case "ready":
            return "Ready";
        case "partial":
            return "Partial";
        case "blocked":
            return "Blocked";
        case "failed":
            return "Failed";
        default:
            return outcome?.trim() ? outcome : "—";
    }
}
