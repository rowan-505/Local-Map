import { isAbortError } from "@/src/lib/api";

import { isTransportNetworkError } from "./transportFetchErrors";
import { MERGE_NOT_APPLIED_NOTE } from "./stopMergeResultDisplay";

/** User-facing copy for review-map stop actions. Never surfaces raw API text. */
export function formatReviewMapStopActionError(error: unknown): string {
    if (isAbortError(error)) {
        return "";
    }

    if (isTransportNetworkError(error)) {
        return "Could not reach the API. Check that it is running, then try again.";
    }

    const message = error instanceof Error ? error.message.trim() : "";
    const lowerMessage = message.toLowerCase();

    if (
        lowerMessage.includes("409") ||
        lowerMessage.includes("still used") ||
        lowerMessage.includes("remove it from all routes") ||
        lowerMessage.includes("cannot delete") ||
        lowerMessage.includes("verified stops") ||
        lowerMessage.includes("manual-protected")
    ) {
        return message || "This stop cannot be deleted right now.";
    }

    if (lowerMessage.includes("not found") || lowerMessage.includes("404")) {
        return "That stop is no longer available. Refresh and try again.";
    }

    if (lowerMessage.includes("forbidden") || lowerMessage.includes("403")) {
        return "You do not have permission for that action.";
    }

    return "That action could not be completed. Try again.";
}

/** User-facing merge failure copy. Never surfaces raw SQL or database errors. */
export function formatTransportStopMergeError(error: unknown): string {
    if (isAbortError(error)) {
        return "";
    }

    if (isTransportNetworkError(error)) {
        return "Could not reach the API. Check that it is running, then try again.";
    }

    const message = error instanceof Error ? error.message.trim() : "";
    const lowerMessage = message.toLowerCase();

    if (
        lowerMessage.includes("merge_stale_preview") ||
        lowerMessage.includes("changed since the merge preview") ||
        lowerMessage.includes("refresh the comparison")
    ) {
        return "One or both stops changed since this comparison loaded. Refresh the comparison and try again.";
    }

    if (
        lowerMessage.includes("merge_terminal_conflict") ||
        lowerMessage.includes("both stops are linked to active terminals") ||
        lowerMessage.includes("resolve the terminal conflict")
    ) {
        return "Both stops are linked to terminals. Resolve the terminal relationship first.";
    }

    if (
        lowerMessage.includes("merge_parent_conflict") ||
        lowerMessage.includes("invalid parent-stop cycle")
    ) {
        return "These stops cannot be merged because it would create an invalid parent-stop link.";
    }

    if (
        lowerMessage.includes("merge_variant_ack_required") ||
        lowerMessage.includes("same_variant_occurrences_require_acknowledgment") ||
        lowerMessage.includes(
            "both stops occur in the same variant. after merge, that physical stop will appear multiple times in the sequence",
        )
    ) {
        return "Confirm that the surviving stop may appear multiple times in the same variant sequence.";
    }

    if (
        lowerMessage.includes("same route variant") ||
        lowerMessage.includes("merge_variant_conflict")
    ) {
        return "These stops cannot be merged because both appear on the same route variant.";
    }

    if (
        lowerMessage.includes("same transport mode") ||
        lowerMessage.includes("merge_mode_mismatch")
    ) {
        return "These stops must have the same transport mode before they can be merged.";
    }

    if (
        lowerMessage.includes("manual_protected") ||
        lowerMessage.includes("merge_protected")
    ) {
        return "The duplicate stop is manual-protected and cannot be deleted during merge.";
    }

    if (
        lowerMessage.includes("references remain") ||
        lowerMessage.includes("merge_references_remain")
    ) {
        return "The merge could not finish because duplicate references still remain.";
    }

    if (lowerMessage.includes("not found") || lowerMessage.includes("404")) {
        return "One of the stops is no longer available. Refresh and try again.";
    }

    if (lowerMessage.includes("forbidden") || lowerMessage.includes("403")) {
        return "You do not have permission to merge these stops.";
    }

    return "The stop merge could not be completed.";
}

export function formatTransportStopMergeErrorOverlay(error: unknown): string {
    const reason = formatTransportStopMergeError(error);
    if (!reason) {
        return "";
    }
    return `${reason} ${MERGE_NOT_APPLIED_NOTE}`;
}

export type ReviewMapActionToastState = {
    readonly kind: "success" | "error";
    readonly message: string;
} | null;
