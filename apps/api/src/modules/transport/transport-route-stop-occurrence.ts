import type { RoutingRouteProfileCode } from "../routing/routing.config.js";
import type {
    NormalizedRouteRequest,
    NormalizedRouteResponse,
    RouteGeoJsonLineString,
} from "../routing/routing.types.js";

export type OrderedRouteStopCoordinate = {
    readonly stop_sequence: number;
    readonly lng: number;
    readonly lat: number;
};

export type RouteStopOccurrenceRow = {
    readonly route_stop_id: bigint | number | string;
    readonly stop_id: bigint | number | string;
    readonly stop_sequence: number;
};

function compareStopIds(a: bigint | number | string, b: bigint | number | string): boolean {
    return String(a) === String(b);
}

/**
 * True when stop_sequence values are exactly 1..N with no gaps or duplicates.
 * Matches transport.route_stops UNIQUE (route_variant_id, stop_sequence).
 */
export function isGapFreeUniqueStopSequences(
    rows: readonly { stop_sequence: number }[],
): boolean {
    if (rows.length === 0) {
        return true;
    }
    const sequences = rows.map((row) => row.stop_sequence).sort((a, b) => a - b);
    if (new Set(sequences).size !== sequences.length) {
        return false;
    }
    for (let index = 0; index < sequences.length; index++) {
        if (sequences[index] !== index + 1) {
            return false;
        }
    }
    return true;
}

/**
 * Simulates global merge repoint: replace duplicate stop_id with canonical on every
 * route_stop row without deleting occurrences or changing stop_sequence.
 */
export function repointRouteStopOccurrences<T extends RouteStopOccurrenceRow>(
    rows: readonly T[],
    duplicateStopId: bigint | number | string,
    canonicalStopId: bigint | number | string,
): T[] {
    return rows.map((row) =>
        compareStopIds(row.stop_id, duplicateStopId)
            ? { ...row, stop_id: canonicalStopId }
            : row,
    );
}

/** Removes one occurrence by route_stop_id and resequences remaining rows to 1..N. */
export function removeRouteStopOccurrence<T extends RouteStopOccurrenceRow>(
    rows: readonly T[],
    routeStopId: bigint | number | string,
): T[] {
    const remaining = rows.filter((row) => !compareStopIds(row.route_stop_id, routeStopId));
    return remaining
        .sort((a, b) => a.stop_sequence - b.stop_sequence)
        .map((row, index) => ({ ...row, stop_sequence: index + 1 }));
}

/** Appends a new occurrence at the end of the variant sequence (1..N+1). */
export function appendRouteStopOccurrence<T extends RouteStopOccurrenceRow>(
    rows: readonly T[],
    occurrence: T,
): T[] {
    const nextSequence = rows.length + 1;
    return [
        ...rows,
        {
            ...occurrence,
            stop_sequence: nextSequence,
        },
    ];
}

/** True when route_stops.normalized_data marks an intentional circular closing row. */
export function isCircularClosingRouteStop(normalizedData: unknown): boolean {
    if (!normalizedData || typeof normalizedData !== "object") {
        return false;
    }
    const value = (normalizedData as { circular_closing_occurrence?: unknown }).circular_closing_occurrence;
    return value === true || value === "true";
}

/**
 * Builds [lng, lat] pairs from ordered route_stop rows without deduplicating by stop_id.
 * Every occurrence is kept, including the closing loop row.
 */
export function extractOrderedRouteStopCoordinates(
    stops: readonly OrderedRouteStopCoordinate[],
): [number, number][] {
    const out: [number, number][] = [];
    for (const stop of stops) {
        if (!Number.isFinite(stop.lng) || !Number.isFinite(stop.lat)) {
            continue;
        }
        out.push([stop.lng, stop.lat]);
    }
    return out;
}

const COORD_EPSILON = 1e-7;

export function coordinatesNearlyEqual(
    a: readonly [number, number],
    b: readonly [number, number],
    epsilon = COORD_EPSILON,
): boolean {
    return Math.abs(a[0] - b[0]) <= epsilon && Math.abs(a[1] - b[1]) <= epsilon;
}

/** Merges segment LineStrings into one path, dropping duplicate join vertices. */
export function mergeRouteLineStrings(segments: readonly RouteGeoJsonLineString[]): RouteGeoJsonLineString | null {
    const coordinates: [number, number][] = [];

    for (const segment of segments) {
        for (const [lng, lat] of segment.coordinates) {
            if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
                continue;
            }
            const point: [number, number] = [lng, lat];
            const prev = coordinates[coordinates.length - 1];
            if (prev && coordinatesNearlyEqual(prev, point)) {
                continue;
            }
            coordinates.push(point);
        }
    }

    return coordinates.length >= 2 ? { type: "LineString", coordinates } : null;
}

export function resolveGeneratePathValhallaProfile(routeMode: string): RoutingRouteProfileCode {
    if (routeMode === "walk" || routeMode === "pedestrian") {
        return "walk";
    }
    if (routeMode === "motorcycle") {
        return "motorcycle";
    }
    return "car";
}

export type RouteThroughOrderedCoordinatesResult = {
    geometry: RouteGeoJsonLineString;
    warnings: string[];
    distanceMeters: number;
};

/**
 * Valhalla-snaps each consecutive stop pair, then merges geometries.
 * Duplicate consecutive coordinates are kept as explicit zero-length hops.
 */
export async function routeThroughOrderedCoordinates(
    coordinates: readonly [number, number][],
    profile: RoutingRouteProfileCode,
    routeFn: (request: NormalizedRouteRequest) => Promise<NormalizedRouteResponse>,
): Promise<RouteThroughOrderedCoordinatesResult> {
    if (coordinates.length < 2) {
        throw new Error("At least two stop coordinates are required to generate a path.");
    }

    const warnings: string[] = [];
    const segments: RouteGeoJsonLineString[] = [];
    let distanceMeters = 0;

    for (let i = 0; i < coordinates.length - 1; i++) {
        const from = coordinates[i]!;
        const to = coordinates[i + 1]!;

        if (coordinatesNearlyEqual(from, to)) {
            if (segments.length === 0) {
                segments.push({ type: "LineString", coordinates: [from, to] });
            } else {
                const last = segments[segments.length - 1]!;
                const lastPoint = last.coordinates[last.coordinates.length - 1];
                if (!lastPoint || !coordinatesNearlyEqual(lastPoint, to)) {
                    segments.push({ type: "LineString", coordinates: [from, to] });
                }
            }
            continue;
        }

        const response = await routeFn({
            origin: { lng: from[0], lat: from[1] },
            destination: { lng: to[0], lat: to[1] },
            profile,
        });

        warnings.push(...response.warnings);

        if (response.status !== "ok" || !response.geometry) {
            warnings.push(
                `No Valhalla route for stop pair ${i + 1}→${i + 2}; used straight line.`,
            );
            segments.push({ type: "LineString", coordinates: [from, to] });
            continue;
        }

        distanceMeters += response.summary.distanceMeters;
        segments.push(response.geometry);
    }

    const geometry = mergeRouteLineStrings(segments);
    if (!geometry) {
        throw new Error("Failed to build a route path from ordered stop coordinates.");
    }

    return { geometry, warnings, distanceMeters };
}
