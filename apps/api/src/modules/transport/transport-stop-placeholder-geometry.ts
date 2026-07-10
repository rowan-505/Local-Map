export const CREATED_FROM_ROUTE_SEQUENCE_PLACEHOLDER_REASON = "created_from_route_sequence";

export type RouteStopGeometryPoint = {
    route_stop_id: string;
    stop_sequence: number;
    longitude: number | null;
    latitude: number | null;
};

export type ResolvedPlaceholderGeometry = {
    longitude: number;
    latitude: number;
};

function pointOf(
    row: RouteStopGeometryPoint | null | undefined
): ResolvedPlaceholderGeometry | null {
    if (!row || row.longitude === null || row.latitude === null) {
        return null;
    }
    if (!Number.isFinite(row.longitude) || !Number.isFinite(row.latitude)) {
        return null;
    }
    return { longitude: row.longitude, latitude: row.latitude };
}

function midpoint(
    a: ResolvedPlaceholderGeometry | null,
    b: ResolvedPlaceholderGeometry | null
): ResolvedPlaceholderGeometry | null {
    if (a && b) {
        return {
            longitude: (a.longitude + b.longitude) / 2,
            latitude: (a.latitude + b.latitude) / 2,
        };
    }
    return a ?? b ?? null;
}

/**
 * Derives a temporary stop location from the variant's ordered stop geometry.
 *   - start: copy the first stop
 *   - end: copy the last stop
 *   - before/after: midpoint of the neighbouring stops when both exist
 */
export function resolvePlaceholderStopGeometryFromSequence(
    rows: readonly RouteStopGeometryPoint[],
    position: "start" | "end" | "before" | "after",
    anchorRouteStopId?: string
): ResolvedPlaceholderGeometry | null {
    if (rows.length === 0) {
        return null;
    }

    if (position === "start") {
        return pointOf(rows[0]);
    }

    if (position === "end") {
        return pointOf(rows[rows.length - 1]);
    }

    if (!anchorRouteStopId) {
        return null;
    }

    const anchorIndex = rows.findIndex((row) => row.route_stop_id === anchorRouteStopId);
    if (anchorIndex < 0) {
        return null;
    }

    if (position === "before") {
        const previous = anchorIndex > 0 ? pointOf(rows[anchorIndex - 1]) : null;
        const next = pointOf(rows[anchorIndex]);
        return midpoint(previous, next) ?? next;
    }

    const previous = pointOf(rows[anchorIndex]);
    const next = anchorIndex < rows.length - 1 ? pointOf(rows[anchorIndex + 1]) : null;
    return midpoint(previous, next) ?? previous;
}

export function buildCreatedFromRouteSequenceNormalizedData(
    placeholderSource: "route_sequence" | "review_map_center" = "route_sequence"
): Record<string, unknown> {
    return {
        geometry_status: "placeholder",
        placeholder_reason: CREATED_FROM_ROUTE_SEQUENCE_PLACEHOLDER_REASON,
        placeholder_source: placeholderSource,
    };
}

function pointFromCoords(
    longitude: number | undefined,
    latitude: number | undefined
): ResolvedPlaceholderGeometry | null {
    if (longitude === undefined || latitude === undefined) {
        return null;
    }
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
        return null;
    }
    if (longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) {
        return null;
    }
    return { longitude, latitude };
}

/**
 * Sequence-derived geometry first; when the variant has no usable neighbour
 * geometry, fall back to an explicit map point from the review map.
 */
export function resolvePlaceholderStopGeometry(
    rows: readonly RouteStopGeometryPoint[],
    position: "start" | "end" | "before" | "after",
    anchorRouteStopId: string | undefined,
    fallback?: { longitude?: number; latitude?: number }
): { geometry: ResolvedPlaceholderGeometry; source: "route_sequence" | "review_map_center" } | null {
    const fromSequence = resolvePlaceholderStopGeometryFromSequence(
        rows,
        position,
        anchorRouteStopId
    );
    if (fromSequence) {
        return { geometry: fromSequence, source: "route_sequence" };
    }
    const fromMap = pointFromCoords(fallback?.longitude, fallback?.latitude);
    if (fromMap) {
        return { geometry: fromMap, source: "review_map_center" };
    }
    return null;
}
