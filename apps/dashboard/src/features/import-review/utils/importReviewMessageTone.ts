export type ImportReviewStatusBannerTone = "info" | "success" | "warning" | "error";

/** Infer banner tone from free-form status text. */
export function importReviewMessageTone(message: string | null | undefined): ImportReviewStatusBannerTone {
    if (!message?.trim()) {
        return "info";
    }
    const lower = message.toLowerCase();
    if (
        lower.includes("fail") ||
        lower.includes("error") ||
        lower.includes("cannot") ||
        lower.includes("invalid") ||
        lower.includes("not found")
    ) {
        return "error";
    }
    if (
        lower.includes("saved") ||
        lower.includes("success") ||
        lower.includes("completed") ||
        lower.includes("applied:") ||
        lower.includes("updated") ||
        lower.match(/^\s*preview:/)
    ) {
        return lower.includes("preview:") ? "info" : "success";
    }
    if (lower.includes("warning") || lower.includes("blocked")) {
        return "warning";
    }
    return "info";
}
