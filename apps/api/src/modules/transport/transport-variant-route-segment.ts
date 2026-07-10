/**
 * Occurrence-aware forward routing on a single route variant.
 *
 * Identity:
 * - physical stop: `stop_id`
 * - occurrence on variant: `route_stop_id` + `stop_sequence`
 *
 * Rules:
 * - valid pair requires destination.stop_sequence > origin.stop_sequence
 * - choose the pair with the smallest forward span (no wrap-around)
 * - one traversal of the variant only (no multi-lap support)
 */

export type VariantStopOccurrence = {
    readonly route_stop_id: bigint | number | string;
    readonly stop_id: bigint | number | string;
    readonly stop_sequence: number;
};

export type VariantOccurrencePair = {
    readonly origin: VariantStopOccurrence;
    readonly destination: VariantStopOccurrence;
    /** destination.stop_sequence - origin.stop_sequence */
    readonly forward_sequence_span: number;
};

function compareStopIds(a: bigint | number | string, b: bigint | number | string): boolean {
    return String(a) === String(b);
}

/** All occurrences of `stopId` on the variant, in ascending stop_sequence order. */
export function findStopOccurrencesOnVariant(
    orderedStops: readonly VariantStopOccurrence[],
    stopId: bigint | number | string,
): VariantStopOccurrence[] {
    return orderedStops.filter((row) => compareStopIds(row.stop_id, stopId));
}

function isBetterForwardPair(
    candidate: VariantOccurrencePair,
    current: VariantOccurrencePair | null,
): boolean {
    if (current === null) {
        return true;
    }
    if (candidate.forward_sequence_span !== current.forward_sequence_span) {
        return candidate.forward_sequence_span < current.forward_sequence_span;
    }
    if (candidate.origin.stop_sequence !== current.origin.stop_sequence) {
        return candidate.origin.stop_sequence > current.origin.stop_sequence;
    }
    return candidate.destination.stop_sequence < current.destination.stop_sequence;
}

/**
 * Picks the best origin/destination occurrence pair for a forward segment on one variant.
 * Returns null when no valid forward pair exists.
 */
export function selectBestForwardOccurrencePair(
    orderedStops: readonly VariantStopOccurrence[],
    originStopId: bigint | number | string,
    destinationStopId: bigint | number | string,
): VariantOccurrencePair | null {
    const originOccurrences = findStopOccurrencesOnVariant(orderedStops, originStopId);
    const destinationOccurrences = compareStopIds(originStopId, destinationStopId)
        ? originOccurrences
        : findStopOccurrencesOnVariant(orderedStops, destinationStopId);

    if (originOccurrences.length === 0 || destinationOccurrences.length === 0) {
        return null;
    }

    let best: VariantOccurrencePair | null = null;

    for (const origin of originOccurrences) {
        for (const destination of destinationOccurrences) {
            if (destination.stop_sequence <= origin.stop_sequence) {
                continue;
            }
            const candidate: VariantOccurrencePair = {
                origin,
                destination,
                forward_sequence_span: destination.stop_sequence - origin.stop_sequence,
            };
            if (isBetterForwardPair(candidate, best)) {
                best = candidate;
            }
        }
    }

    return best;
}

/** Inclusive slice from origin sequence through destination sequence. */
export function sliceStopsBetweenOccurrencePair(
    orderedStops: readonly VariantStopOccurrence[],
    pair: VariantOccurrencePair,
): VariantStopOccurrence[] {
    const minSequence = pair.origin.stop_sequence;
    const maxSequence = pair.destination.stop_sequence;
    return orderedStops.filter(
        (row) => row.stop_sequence >= minSequence && row.stop_sequence <= maxSequence,
    );
}
