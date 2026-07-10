import { TransportReviewGuardError } from "./transport.errors.js";

/** Shown in merge preview and returned when merge lacks required acknowledgment. */
export const STOP_MERGE_SAME_VARIANT_WARNING =
    "Both stops occur in the same variant. After merge, that physical stop will appear multiple times in the sequence.";

export function buildSameVariantMergeWarning(
    conflictCount: number,
): string | null {
    return conflictCount > 0 ? STOP_MERGE_SAME_VARIANT_WARNING : null;
}

export function assertSameVariantMergeAcknowledged(
    conflictCount: number,
    acknowledged: boolean | undefined,
): void {
    if (conflictCount === 0) {
        return;
    }
    if (acknowledged === true) {
        return;
    }
    throw new TransportReviewGuardError(
        "MERGE_VARIANT_ACK_REQUIRED",
        STOP_MERGE_SAME_VARIANT_WARNING,
        ["same_variant_occurrences_require_acknowledgment"],
    );
}
