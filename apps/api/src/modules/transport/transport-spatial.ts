/**
 * Shared spatial helpers for transport duplicate / nearby checks.
 *
 * Exact distance semantics use geography ST_DWithin (meters). GiST on
 * transport.stops.geom is geometry, so always prefilter with:
 *   candidate.geom && ST_Expand(source.geom, approxExpandDegreesFromMeters(r))
 * before the geography distance predicate (same pattern as stop-quality / nearby-candidates).
 */

/** Radius used by review-readiness and stop-list duplicateStatus=nearby. */
export const DUPLICATE_NEARBY_RADIUS_M = 50;

/**
 * Approximate degree expansion for a meter radius so geometry GiST can prefilter.
 * Matches stop-quality / nearby-candidates (`meters / 90000`).
 */
export function approxExpandDegreesFromMeters(meters: number): number {
    return meters / 90000;
}

/**
 * Normalized SQL fragment (for tests / docs) that must appear in duplicate EXISTS
 * queries: bbox prefilter + exact geography distance.
 */
export function nearbyDuplicateBboxAndDistanceSql(options?: {
    readonly sourceGeomExpr?: string;
    readonly candidateGeomExpr?: string;
    readonly radiusMeters?: number;
}): string {
    const source = options?.sourceGeomExpr ?? "s.geom";
    const candidate = options?.candidateGeomExpr ?? "s2.geom";
    const meters = options?.radiusMeters ?? DUPLICATE_NEARBY_RADIUS_M;
    const deg = approxExpandDegreesFromMeters(meters);
    return [
        `${candidate} && ST_Expand(${source}, ${deg})`,
        `ST_DWithin(${source}::geography, ${candidate}::geography, ${meters})`,
    ].join(" AND ");
}

/**
 * Pure predicate mirroring SQL filters for unit tests (not a substitute for PostGIS).
 * - same stop excluded
 * - deleted excluded
 * - inactive excluded when requireActive
 * - null distance (missing geom) excluded
 * - outside radius excluded
 * - mode mismatch excluded when modes provided and requireSameMode
 */
export function isNearbyDuplicateCandidate(input: {
    readonly sourceStopId: string;
    readonly candidateStopId: string;
    readonly candidateDeleted: boolean;
    readonly candidateActive: boolean;
    readonly distanceMeters: number | null;
    readonly radiusMeters?: number;
    readonly requireActive?: boolean;
    readonly sourceMode?: string;
    readonly candidateMode?: string;
    readonly requireSameMode?: boolean;
}): boolean {
    if (input.sourceStopId === input.candidateStopId) {
        return false;
    }
    if (input.candidateDeleted) {
        return false;
    }
    if ((input.requireActive ?? true) && !input.candidateActive) {
        return false;
    }
    if (
        input.requireSameMode === true &&
        input.sourceMode !== undefined &&
        input.candidateMode !== undefined &&
        input.sourceMode !== input.candidateMode
    ) {
        return false;
    }
    if (input.distanceMeters === null || !Number.isFinite(input.distanceMeters)) {
        return false;
    }
    const radius = input.radiusMeters ?? DUPLICATE_NEARBY_RADIUS_M;
    return input.distanceMeters <= radius;
}
