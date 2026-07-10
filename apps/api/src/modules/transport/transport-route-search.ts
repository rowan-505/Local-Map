import {
    selectBestForwardOccurrencePair,
    sliceStopsBetweenOccurrencePair,
    type VariantStopOccurrence,
} from "./transport-variant-route-segment.js";
import type {
    RouteSearchCandidateVariantRow,
    RouteSearchVariantStopRow,
} from "./transport-public.repo.js";
import type { PublicTransportRouteSearchCandidate } from "./transport-public.types.js";
import { normalizeTransportNameInput } from "./transport-naming.js";

function groupStopsByVariantId(
    rows: readonly RouteSearchVariantStopRow[],
): Map<string, RouteSearchVariantStopRow[]> {
    const grouped = new Map<string, RouteSearchVariantStopRow[]>();
    for (const row of rows) {
        const key = row.route_variant_id.toString();
        const bucket = grouped.get(key);
        if (bucket) {
            bucket.push(row);
        } else {
            grouped.set(key, [row]);
        }
    }
    return grouped;
}

function toOccurrence(row: RouteSearchVariantStopRow): VariantStopOccurrence {
    return {
        route_stop_id: row.route_stop_id,
        stop_id: row.stop_id,
        stop_sequence: row.stop_sequence,
    };
}

function compareRouteSearchCandidates(
    a: PublicTransportRouteSearchCandidate,
    b: PublicTransportRouteSearchCandidate,
): number {
    const spanCmp = a.forward_stop_count - b.forward_stop_count;
    if (spanCmp !== 0) {
        return spanCmp;
    }
    const routeCmp = a.route_code.localeCompare(b.route_code);
    if (routeCmp !== 0) {
        return routeCmp;
    }
    return a.variant_code.localeCompare(b.variant_code);
}

/**
 * Applies occurrence-pair routing to SQL candidate variants + ordered stops.
 * Skips variants with no valid forward pair.
 */
export function buildRouteSearchCandidates(
    variants: readonly RouteSearchCandidateVariantRow[],
    stopRows: readonly RouteSearchVariantStopRow[],
    originStopId: bigint,
    destinationStopId: bigint,
): PublicTransportRouteSearchCandidate[] {
    const stopsByVariant = groupStopsByVariantId(stopRows);
    const candidates: PublicTransportRouteSearchCandidate[] = [];

    for (const variant of variants) {
        const variantStops = stopsByVariant.get(variant.variant_id.toString()) ?? [];
        const occurrences = variantStops.map(toOccurrence);
        const pair = selectBestForwardOccurrencePair(
            occurrences,
            originStopId,
            destinationStopId,
        );
        if (!pair) {
            continue;
        }

        const segment = sliceStopsBetweenOccurrencePair(occurrences, pair);
        const stopBySequence = new Map(variantStops.map((row) => [row.stop_sequence, row]));

        candidates.push({
            route_id: variant.route_id.toString(),
            route_public_id: variant.route_public_id,
            route_code: variant.route_code,
            public_name: normalizeTransportNameInput(variant.public_name),
            variant_id: variant.variant_id.toString(),
            variant_public_id: variant.variant_public_id,
            variant_code: variant.variant_code,
            direction_name: normalizeTransportNameInput(variant.direction_name),
            origin_name: normalizeTransportNameInput(variant.origin_name),
            destination_name: normalizeTransportNameInput(variant.destination_name),
            origin_stop_sequence: pair.origin.stop_sequence,
            destination_stop_sequence: pair.destination.stop_sequence,
            forward_stop_count: pair.forward_sequence_span,
            stops: segment.map((occurrence) => {
                const row = stopBySequence.get(occurrence.stop_sequence);
                return {
                    route_stop_id: String(occurrence.route_stop_id),
                    stop_id: String(occurrence.stop_id),
                    public_id: row?.stop_public_id ?? "",
                    stop_sequence: occurrence.stop_sequence,
                    name_my: normalizeTransportNameInput(row?.name_mm ?? null),
                    name_en: normalizeTransportNameInput(row?.name_en ?? null),
                };
            }),
        });
    }

    return candidates.sort(compareRouteSearchCandidates);
}
