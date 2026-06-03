import { parseImportReviewApiErrorBody } from "@/src/features/import-review/api/importReviewApiErrors";
import { formatPromotionSelectedCandidateErrorDetails } from "@/src/features/import-review/promotion/formatPromotionSelectedCandidateError";
import { isImportReviewDevTokenConfigured } from "@/src/lib/importReviewDevAccess";

function tryFormatPromotionSelectedCandidateApiMessage(message: string): string | null {
    const jsonStart = message.indexOf("{");
    if (jsonStart < 0) {
        return null;
    }
    try {
        const data = JSON.parse(message.slice(jsonStart)) as Record<string, unknown>;
        const parsed = parseImportReviewApiErrorBody(data);
        if (!parsed || parsed.code !== "PROMOTION_SELECTED_CANDIDATE") {
            return null;
        }
        const details =
            parsed.details && typeof parsed.details === "object" && !Array.isArray(parsed.details)
                ? (parsed.details as Record<string, unknown>)
                : null;
        if (!details) {
            return parsed.message;
        }
        const detailLines = formatPromotionSelectedCandidateErrorDetails({
            reason: typeof details.reason === "string" ? details.reason : undefined,
            review_status:
                typeof details.review_status === "string" ? details.review_status : null,
            review_decision:
                typeof details.review_decision === "string" ? details.review_decision : null,
            promoted_core_id:
                typeof details.promoted_core_id === "string" ? details.promoted_core_id : null,
            promoted_at: typeof details.promoted_at === "string" ? details.promoted_at : null,
            target_table: typeof details.target_table === "string" ? details.target_table : null,
            missing_fields: Array.isArray(details.missing_fields)
                ? details.missing_fields.filter((f): f is string => typeof f === "string")
                : undefined,
            active_publish_batch_id:
                typeof details.active_publish_batch_id === "string"
                    ? details.active_publish_batch_id
                    : null,
            actual_family: typeof details.actual_family === "string" ? details.actual_family : undefined,
            expected_family:
                typeof details.expected_family === "string" ? details.expected_family : undefined,
        });
        if (!detailLines) {
            return parsed.message;
        }
        const headline =
            parsed.message.trim() || "This candidate cannot be added to a promotion batch.";
        return `${headline}\n\n${detailLines}`;
    } catch {
        return null;
    }
}

export function formatImportReviewPromotionError(err: unknown): string {
    if (!(err instanceof Error)) {
        return "Request failed.";
    }
    const selected = tryFormatPromotionSelectedCandidateApiMessage(err.message);
    if (selected) {
        return selected;
    }
    const m = err.message;
    if (m.includes("401") || m.toLowerCase().includes("authentication")) {
        if (isImportReviewDevTokenConfigured()) {
            return "Unauthorized — check NEXT_PUBLIC_IMPORT_REVIEW_ADMIN_TOKEN matches the API IMPORT_REVIEW_ADMIN_TOKEN.";
        }
        return "Unauthorized — sign in as an admin or configure the dev admin token.";
    }
    if (m.includes("403") || m.toLowerCase().includes("forbidden")) {
        return "Forbidden — import review requires admin access.";
    }
    return m;
}
