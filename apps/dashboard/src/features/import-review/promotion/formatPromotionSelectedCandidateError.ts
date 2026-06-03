export type PromotionSelectedCandidateErrorDetails = {
    reason?: string;
    review_status?: string | null;
    review_decision?: string | null;
    promoted_core_id?: string | null;
    promoted_at?: string | null;
    target_table?: string | null;
    missing_fields?: string[];
    active_publish_batch_id?: string | null;
    actual_family?: string;
    expected_family?: string;
};

function reasonLabel(reason: string): string {
    return reason.replaceAll("_", " ");
}

export function formatPromotionSelectedCandidateErrorDetails(
    details: PromotionSelectedCandidateErrorDetails
): string | null {
    const lines: string[] = [];
    if (details.reason?.trim()) {
        lines.push(`Reason: ${reasonLabel(details.reason.trim())}`);
    }
    if (details.review_status != null && String(details.review_status).trim()) {
        lines.push(`Review status: ${String(details.review_status).trim()}`);
    }
    if (details.review_decision != null && String(details.review_decision).trim()) {
        lines.push(`Review decision: ${String(details.review_decision).trim()}`);
    }
    if (details.promoted_core_id?.trim()) {
        const target = details.target_table?.trim();
        lines.push(
            target
                ? `Promoted to ${target} (core id ${details.promoted_core_id.trim()})`
                : `Promoted core id: ${details.promoted_core_id.trim()}`
        );
    }
    if (details.promoted_at?.trim()) {
        lines.push(`Promoted at: ${details.promoted_at.trim()}`);
    }
    if (details.active_publish_batch_id?.trim()) {
        lines.push(`Active publish batch: #${details.active_publish_batch_id.trim()}`);
    }
    if (details.actual_family?.trim() && details.expected_family?.trim()) {
        lines.push(
            `Family: expected ${details.expected_family.trim()}, found ${details.actual_family.trim()}`
        );
    }
    if (Array.isArray(details.missing_fields) && details.missing_fields.length > 0) {
        lines.push(`Missing fields: ${details.missing_fields.join(", ")}`);
    }
    return lines.length > 0 ? lines.join("\n") : null;
}
