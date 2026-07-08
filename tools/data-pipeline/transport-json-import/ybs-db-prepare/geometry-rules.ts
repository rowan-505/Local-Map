/**
 * Phase 7 geometry rules for YBS import preparation.
 *
 * Does not touch the database.
 */

export const PHASE7_SCHEMA_VERSION = 4;

export const INTERPOLATED_GEOM_CONFIDENCE_SCORE = 20;
export const PLACEHOLDER_GEOM_CONFIDENCE_SCORE = 5;
/** @deprecated Use INTERPOLATED_GEOM_CONFIDENCE_SCORE */
export const GENERATED_GEOM_CONFIDENCE_SCORE = INTERPOLATED_GEOM_CONFIDENCE_SCORE;

export const GENERATED_REVIEW_STATUS = "needs_review";
export const INTERPOLATED_GEOM_SOURCE = "generated_route_sequence_estimate";
/** @deprecated Use INTERPOLATED_GEOM_SOURCE */
export const GENERATED_GEOM_SOURCE = INTERPOLATED_GEOM_SOURCE;
export const SYNTHETIC_STOP_GEOM_SOURCE = "synthetic_even_distribution_placeholder";
export const SYNTHETIC_PATH_GEOM_SOURCE = "synthetic_straight_line_review_placeholder";
/** @deprecated Use SYNTHETIC_PATH_GEOM_SOURCE */
export const LEGACY_SYNTHETIC_PATH_GEOM_SOURCE = "synthetic_straight_line_placeholder";
export const EXISTING_GEOM_SOURCE = "existing_supabase_stop";
export const ROUTE_PATH_KIND = "corridor_estimate";
export const BLOCK_CODE_GEOMETRY_NOT_READY = "GEOMETRY_NOT_READY";
export const PLACEHOLDER_GEOMETRY_MODE = "straight_line_review";
export const TARGET_REVIEW_LINE_LENGTH_MIN_M = 3_000;
export const TARGET_REVIEW_LINE_LENGTH_MAX_M = 6_000;
export const VARIANT_PARALLEL_OFFSET_M = 300;
export const MAX_PLACEHOLDER_JITTER_METERS = 10;

export const YANGON_REVIEW_BBOX = {
    minLng: 96.05,
    maxLng: 96.25,
    minLat: 16.75,
    maxLat: 16.92,
} as const;

export type Coordinate = [number, number];

export type GeoJsonPoint = {
    type: "Point";
    coordinates: Coordinate;
};

export type GeoJsonLineString = {
    type: "LineString";
    coordinates: Coordinate[];
};

export type LngLat = {
    lng: number;
    lat: number;
};

export type StopGeometryMetadata = {
    geom_source: string;
    geometry_quality: "existing" | "interpolated" | "placeholder";
    placeholder_geometry_mode?: typeof PLACEHOLDER_GEOMETRY_MODE;
    needs_geometry_review: boolean;
    validator_required: boolean;
    generated_from: string;
    public_safe: boolean;
    do_not_publish?: boolean;
};

export type ReviewGeometryMetadata = {
    review_lng: number;
    review_lat: number;
    geometry_quality: "placeholder";
    placeholder_geometry_mode: typeof PLACEHOLDER_GEOMETRY_MODE;
};

export type StraightLineReviewVariantLine = {
    start: LngLat;
    end: LngLat;
    length_m: number;
    expected_visual_line_length_km: number;
};

export type SequenceStopGeometryInput = {
    sequence: number;
    candidate_id: string;
    geometry: LngLat | null;
    geom_source: string | null;
};

export type ResolvedSequenceStopGeometry = {
    sequence: number;
    candidate_id: string;
    geometry: LngLat;
    geom_source: string;
    geometry_quality: StopGeometryMetadata["geometry_quality"];
    confidence_score: number;
    /** Ideal review position on straight-line placeholder (may differ from geometry for reused stops). */
    review_geometry?: LngLat;
};

export function isValidLngLat(point: LngLat | null | undefined): point is LngLat {
    if (!point) {
        return false;
    }

    return (
        Number.isFinite(point.lng) &&
        Number.isFinite(point.lat) &&
        point.lng >= -180 &&
        point.lng <= 180 &&
        point.lat >= -90 &&
        point.lat <= 90
    );
}

export function deterministicHash(input: string): number {
    let hash = 2_166_136_261;
    for (let index = 0; index < input.length; index++) {
        hash ^= input.charCodeAt(index);
        hash = Math.imul(hash, 16_777_619);
    }
    return hash >>> 0;
}

export function deterministicUnit(input: string): number {
    return deterministicHash(input) / 4_294_967_295;
}

export function toGeoJsonPoint(point: LngLat): GeoJsonPoint {
    return {
        type: "Point",
        coordinates: [point.lng, point.lat],
    };
}

export function fromGeoJsonPoint(geometry: GeoJsonPoint): LngLat {
    return {
        lng: geometry.coordinates[0],
        lat: geometry.coordinates[1],
    };
}

export function interpolateLngLat(start: LngLat, end: LngLat, fraction: number): LngLat {
    const clamped = Math.min(1, Math.max(0, fraction));
    return {
        lng: start.lng + (end.lng - start.lng) * clamped,
        lat: start.lat + (end.lat - start.lat) * clamped,
    };
}

export function toRadians(value: number): number {
    return (value * Math.PI) / 180;
}

export function haversineDistanceMeters(start: LngLat, end: LngLat): number {
    const earthRadiusM = 6_371_000;
    const dLat = toRadians(end.lat - start.lat);
    const dLng = toRadians(end.lng - start.lng);
    const lat1 = toRadians(start.lat);
    const lat2 = toRadians(end.lat);

    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return earthRadiusM * c;
}

export function estimateLineStringDistanceMeters(points: LngLat[]): number | null {
    if (points.length < 2) {
        return null;
    }

    let total = 0;
    for (let index = 1; index < points.length; index++) {
        total += haversineDistanceMeters(points[index - 1], points[index]);
    }

    return Number(total.toFixed(2));
}

export function buildLineStringFromPoints(points: LngLat[]): GeoJsonLineString | null {
    const validPoints = points.filter(isValidLngLat);
    if (validPoints.length < 2) {
        return null;
    }

    return {
        type: "LineString",
        coordinates: validPoints.map((point) => [point.lng, point.lat]),
    };
}

export function bearingBetween(start: LngLat, end: LngLat): number {
    const lat1 = toRadians(start.lat);
    const lat2 = toRadians(end.lat);
    const dLng = toRadians(end.lng - start.lng);
    const y = Math.sin(dLng) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
    const bearing = (Math.atan2(y, x) * 180) / Math.PI;
    return (bearing + 360) % 360;
}

export function destinationPointFromBearing(
    start: LngLat,
    bearingDeg: number,
    distanceM: number,
): LngLat {
    const earthRadiusM = 6_371_000;
    const bearing = toRadians(bearingDeg);
    const lat1 = toRadians(start.lat);
    const lng1 = toRadians(start.lng);
    const angularDistance = distanceM / earthRadiusM;

    const lat2 = Math.asin(
        Math.sin(lat1) * Math.cos(angularDistance) +
            Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearing),
    );
    const lng2 =
        lng1 +
        Math.atan2(
            Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat1),
            Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2),
        );

    return {
        lng: Number((((lng2 * 180) / Math.PI)).toFixed(8)),
        lat: Number((((lat2 * 180) / Math.PI)).toFixed(8)),
    };
}

export function offsetLineParallel(
    start: LngLat,
    end: LngLat,
    offsetMeters: number,
): { start: LngLat; end: LngLat } {
    const bearing = bearingBetween(start, end);
    const perpBearing = bearing + 90;
    return {
        start: destinationPointFromBearing(start, perpBearing, offsetMeters),
        end: destinationPointFromBearing(end, perpBearing, offsetMeters),
    };
}

export function sequenceFraction(
    sequence: number,
    minSequence: number,
    maxSequence: number,
): number {
    if (maxSequence <= minSequence) {
        return 0;
    }
    return (sequence - minSequence) / (maxSequence - minSequence);
}

export function buildStraightLineReviewVariantLine(
    routeCode: string,
    directionKey: string,
): StraightLineReviewVariantLine {
    const routeUnit = deterministicUnit(routeCode);
    const variantUnit = deterministicUnit(`${routeCode}:${directionKey}`);
    const lengthUnit = deterministicUnit(`${routeCode}:${directionKey}:length`);
    const bearingUnit = deterministicUnit(`${routeCode}:${directionKey}:bearing`);

    const targetLengthM =
        TARGET_REVIEW_LINE_LENGTH_MIN_M +
        lengthUnit * (TARGET_REVIEW_LINE_LENGTH_MAX_M - TARGET_REVIEW_LINE_LENGTH_MIN_M);
    const bearingDeg = 25 + bearingUnit * 130;

    const lngSpan = YANGON_REVIEW_BBOX.maxLng - YANGON_REVIEW_BBOX.minLng;
    const latSpan = YANGON_REVIEW_BBOX.maxLat - YANGON_REVIEW_BBOX.minLat;

    const baseStart = {
        lng: Number(
            (YANGON_REVIEW_BBOX.minLng + lngSpan * (0.12 + routeUnit * 0.58)).toFixed(8),
        ),
        lat: Number(
            (YANGON_REVIEW_BBOX.minLat + latSpan * (0.18 + variantUnit * 0.42)).toFixed(8),
        ),
    };
    const baseEnd = destinationPointFromBearing(baseStart, bearingDeg, targetLengthM);

    const parallelOffset =
        directionKey === "inbound" ? VARIANT_PARALLEL_OFFSET_M : -VARIANT_PARALLEL_OFFSET_M;
    const shifted = offsetLineParallel(baseStart, baseEnd, parallelOffset);

    const lengthM = haversineDistanceMeters(shifted.start, shifted.end);

    return {
        start: shifted.start,
        end: shifted.end,
        length_m: Number(lengthM.toFixed(2)),
        expected_visual_line_length_km: Number((lengthM / 1000).toFixed(3)),
    };
}

/** @deprecated Use buildStraightLineReviewVariantLine */
export function buildSyntheticVariantLine(
    routeCode: string,
    directionKey: string,
): { start: LngLat; end: LngLat } {
    const line = buildStraightLineReviewVariantLine(routeCode, directionKey);
    return { start: line.start, end: line.end };
}

export function applyDeterministicJitter(
    point: LngLat,
    routeCode: string,
    directionKey: string,
    sequence: number,
    maxMeters: number = MAX_PLACEHOLDER_JITTER_METERS,
): LngLat {
    const seed = deterministicUnit(`${routeCode}:${directionKey}:${sequence}`);
    const seed2 = deterministicUnit(`${routeCode}:${directionKey}:${sequence}:lat`);
    const jitterLngMeters = (seed - 0.5) * 2 * maxMeters;
    const jitterLatMeters = (seed2 - 0.5) * 2 * maxMeters;
    const latRadians = toRadians(point.lat);
    const jitterLng = jitterLngMeters / (111_320 * Math.cos(latRadians));
    const jitterLat = jitterLatMeters / 111_320;

    return {
        lng: Number((point.lng + jitterLng).toFixed(8)),
        lat: Number((point.lat + jitterLat).toFixed(8)),
    };
}

export function placeStopOnReviewLine(
    line: StraightLineReviewVariantLine,
    fraction: number,
    routeCode: string,
    directionKey: string,
    sequence: number,
): LngLat {
    const base = interpolateLngLat(line.start, line.end, fraction);
    return applyDeterministicJitter(base, routeCode, directionKey, sequence);
}

export function buildStraightLineReviewRoutePath(
    routeCode: string,
    directionKey: string,
): { geometry: GeoJsonLineString; line: StraightLineReviewVariantLine } | null {
    const line = buildStraightLineReviewVariantLine(routeCode, directionKey);
    const geometry = buildLineStringFromPoints([line.start, line.end]);
    if (!geometry) {
        return null;
    }
    return { geometry, line };
}

export function interpolateStopGeometriesBetweenAnchors(
    stops: SequenceStopGeometryInput[],
): ResolvedSequenceStopGeometry[] {
    const sorted = [...stops].sort((left, right) => left.sequence - right.sequence);
    const anchors = sorted.filter((stop) => isValidLngLat(stop.geometry));

    if (anchors.length < 2) {
        return [];
    }

    const generated: ResolvedSequenceStopGeometry[] = [];

    for (let anchorIndex = 0; anchorIndex < anchors.length - 1; anchorIndex++) {
        const left = anchors[anchorIndex];
        const right = anchors[anchorIndex + 1];
        const leftPoint = left.geometry as LngLat;
        const rightPoint = right.geometry as LngLat;

        if (right.sequence <= left.sequence) {
            continue;
        }

        const between = sorted.filter(
            (stop) =>
                stop.sequence > left.sequence &&
                stop.sequence < right.sequence &&
                !isValidLngLat(stop.geometry),
        );

        for (const stop of between) {
            const fraction = (stop.sequence - left.sequence) / (right.sequence - left.sequence);
            generated.push({
                sequence: stop.sequence,
                candidate_id: stop.candidate_id,
                geometry: interpolateLngLat(leftPoint, rightPoint, fraction),
                geom_source: INTERPOLATED_GEOM_SOURCE,
                geometry_quality: "interpolated",
                confidence_score: INTERPOLATED_GEOM_CONFIDENCE_SCORE,
            });
        }
    }

    return generated;
}

export function distributeStopsEvenlyBetweenEndpoints(
    stops: SequenceStopGeometryInput[],
    start: LngLat,
    end: LngLat,
): ResolvedSequenceStopGeometry[] {
    const sorted = [...stops].sort((left, right) => left.sequence - right.sequence);
    const missing = sorted.filter((stop) => !isValidLngLat(stop.geometry));
    if (missing.length === 0) {
        return [];
    }

    const minSequence = sorted[0]?.sequence ?? 1;
    const maxSequence = sorted[sorted.length - 1]?.sequence ?? minSequence;
    const span = Math.max(1, maxSequence - minSequence);

    return missing.map((stop) => {
        const fraction = (stop.sequence - minSequence) / span;
        return {
            sequence: stop.sequence,
            candidate_id: stop.candidate_id,
            geometry: interpolateLngLat(start, end, fraction),
            geom_source: INTERPOLATED_GEOM_SOURCE,
            geometry_quality: "interpolated",
            confidence_score: INTERPOLATED_GEOM_CONFIDENCE_SCORE,
        };
    });
}

export function generateSyntheticPlaceholderStops(
    stops: SequenceStopGeometryInput[],
    routeCode: string,
    directionKey: string,
): ResolvedSequenceStopGeometry[] {
    const sorted = [...stops].sort((left, right) => left.sequence - right.sequence);
    const missing = sorted.filter((stop) => !isValidLngLat(stop.geometry));
    if (missing.length === 0) {
        return [];
    }

    const line = buildSyntheticVariantLine(routeCode, directionKey);
    const minSequence = sorted[0]?.sequence ?? 1;
    const maxSequence = sorted[sorted.length - 1]?.sequence ?? minSequence;
    const span = Math.max(1, maxSequence - minSequence);

    return missing.map((stop) => {
        const fraction = (stop.sequence - minSequence) / span;
        const base = interpolateLngLat(line.start, line.end, fraction);
        return {
            sequence: stop.sequence,
            candidate_id: stop.candidate_id,
            geometry: applyDeterministicJitter(base, routeCode, directionKey, stop.sequence),
            geom_source: SYNTHETIC_STOP_GEOM_SOURCE,
            geometry_quality: "placeholder",
            confidence_score: PLACEHOLDER_GEOM_CONFIDENCE_SCORE,
        };
    });
}

export function resolveStraightLineReviewStopGeometries(options: {
    stops: SequenceStopGeometryInput[];
    routeCode: string;
    directionKey: string;
}): {
    line: StraightLineReviewVariantLine;
    resolved: Map<string, ResolvedSequenceStopGeometry>;
    reused_existing_stop_count: number;
    generated_stop_points_count: number;
    existing_reused_stops_not_moved_count: number;
    reused_existing_geometry_count: number;
    interpolated_geometry_count: number;
    synthetic_placeholder_geometry_count: number;
} {
    const { stops, routeCode, directionKey } = options;
    const sorted = [...stops].sort((left, right) => left.sequence - right.sequence);
    const line = buildStraightLineReviewVariantLine(routeCode, directionKey);
    const minSequence = sorted[0]?.sequence ?? 1;
    const maxSequence = sorted[sorted.length - 1]?.sequence ?? minSequence;
    const resolved = new Map<string, ResolvedSequenceStopGeometry>();

    let reusedExistingStopCount = 0;
    let generatedStopPointsCount = 0;
    let existingReusedNotMovedCount = 0;

    for (const stop of sorted) {
        const fraction = sequenceFraction(stop.sequence, minSequence, maxSequence);
        const reviewPoint = placeStopOnReviewLine(
            line,
            fraction,
            routeCode,
            directionKey,
            stop.sequence,
        );
        const key = `${stop.candidate_id}:${stop.sequence}`;
        const hasExisting =
            isValidLngLat(stop.geometry) &&
            stop.geom_source === EXISTING_GEOM_SOURCE;

        if (hasExisting) {
            reusedExistingStopCount++;
            existingReusedNotMovedCount++;
            resolved.set(key, {
                sequence: stop.sequence,
                candidate_id: stop.candidate_id,
                geometry: stop.geometry as LngLat,
                geom_source: EXISTING_GEOM_SOURCE,
                geometry_quality: "existing",
                confidence_score: INTERPOLATED_GEOM_CONFIDENCE_SCORE,
                review_geometry: reviewPoint,
            });
            continue;
        }

        generatedStopPointsCount++;
        resolved.set(key, {
            sequence: stop.sequence,
            candidate_id: stop.candidate_id,
            geometry: reviewPoint,
            geom_source: SYNTHETIC_STOP_GEOM_SOURCE,
            geometry_quality: "placeholder",
            confidence_score: PLACEHOLDER_GEOM_CONFIDENCE_SCORE,
        });
    }

    return {
        line,
        resolved,
        reused_existing_stop_count: reusedExistingStopCount,
        generated_stop_points_count: generatedStopPointsCount,
        existing_reused_stops_not_moved_count: existingReusedNotMovedCount,
        reused_existing_geometry_count: reusedExistingStopCount,
        interpolated_geometry_count: 0,
        synthetic_placeholder_geometry_count: generatedStopPointsCount,
    };
}

export function resolveVariantStopGeometries(options: {
    stops: SequenceStopGeometryInput[];
    routeCode: string;
    directionKey: string;
}): {
    resolved: Map<string, ResolvedSequenceStopGeometry>;
    reused_existing_geometry_count: number;
    interpolated_geometry_count: number;
    synthetic_placeholder_geometry_count: number;
} {
    const { stops, routeCode, directionKey } = options;
    const sorted = [...stops].sort((left, right) => left.sequence - right.sequence);
    const resolved = new Map<string, ResolvedSequenceStopGeometry>();

    for (const stop of sorted) {
        if (!isValidLngLat(stop.geometry) || !stop.geom_source) {
            continue;
        }

        resolved.set(`${stop.candidate_id}:${stop.sequence}`, {
            sequence: stop.sequence,
            candidate_id: stop.candidate_id,
            geometry: stop.geometry,
            geom_source: stop.geom_source,
            geometry_quality: "existing",
            confidence_score: INTERPOLATED_GEOM_CONFIDENCE_SCORE,
        });
    }

    const mergeResolved = (rows: ResolvedSequenceStopGeometry[]): void => {
        for (const row of rows) {
            const key = `${row.candidate_id}:${row.sequence}`;
            if (!resolved.has(key)) {
                resolved.set(key, row);
            }
        }
    };

    mergeResolved(interpolateStopGeometriesBetweenAnchors(sorted));

    const anchors = sorted
        .map((stop) => {
            const key = `${stop.candidate_id}:${stop.sequence}`;
            const existing = resolved.get(key);
            return existing ? { sequence: stop.sequence, point: existing.geometry } : null;
        })
        .filter((value): value is { sequence: number; point: LngLat } => value !== null)
        .sort((left, right) => left.sequence - right.sequence);

    if (anchors.length >= 2) {
        const stillMissing = sorted.filter(
            (stop) => !resolved.has(`${stop.candidate_id}:${stop.sequence}`),
        );
        mergeResolved(
            distributeStopsEvenlyBetweenEndpoints(
                stillMissing,
                anchors[0].point,
                anchors[anchors.length - 1].point,
            ),
        );
    }

    mergeResolved(generateSyntheticPlaceholderStops(sorted, routeCode, directionKey));

    let reused_existing_geometry_count = 0;
    let interpolated_geometry_count = 0;
    let synthetic_placeholder_geometry_count = 0;

    for (const stop of sorted) {
        const row = resolved.get(`${stop.candidate_id}:${stop.sequence}`);
        if (!row) {
            continue;
        }

        if (row.geometry_quality === "existing") {
            reused_existing_geometry_count++;
        } else if (row.geometry_quality === "interpolated") {
            interpolated_geometry_count++;
        } else if (row.geometry_quality === "placeholder") {
            synthetic_placeholder_geometry_count++;
        }
    }

    return {
        resolved,
        reused_existing_geometry_count,
        interpolated_geometry_count,
        synthetic_placeholder_geometry_count,
    };
}

export function buildReviewGeometryMetadata(point: LngLat): ReviewGeometryMetadata {
    return {
        review_lng: point.lng,
        review_lat: point.lat,
        geometry_quality: "placeholder",
        placeholder_geometry_mode: PLACEHOLDER_GEOMETRY_MODE,
    };
}

/** JSON stored on transport.route_stops.review_geometry_data for placeholder imports. */
export function buildRouteStopReviewGeometryData(): Record<string, unknown> {
    return {
        geom_source: SYNTHETIC_STOP_GEOM_SOURCE,
        geometry_quality: "placeholder",
        placeholder_geometry_mode: PLACEHOLDER_GEOMETRY_MODE,
        needs_geometry_review: true,
        validator_required: true,
        public_safe: false,
        generated_from: "route_stop_sequence",
    };
}

export function buildStopGeometryMetadata(
    geomSource: string,
    geometryQuality: StopGeometryMetadata["geometry_quality"],
): StopGeometryMetadata {
    if (geometryQuality === "existing") {
        return {
            geom_source: geomSource,
            geometry_quality: "existing",
            needs_geometry_review: false,
            validator_required: false,
            generated_from: "existing_supabase_stop",
            public_safe: true,
        };
    }

    if (geometryQuality === "interpolated") {
        return {
            geom_source: geomSource,
            geometry_quality: "interpolated",
            needs_geometry_review: true,
            validator_required: true,
            generated_from: "route_stop_sequence",
            public_safe: false,
            do_not_publish: true,
        };
    }

    return {
        geom_source: SYNTHETIC_STOP_GEOM_SOURCE,
        geometry_quality: "placeholder",
        placeholder_geometry_mode: PLACEHOLDER_GEOMETRY_MODE,
        needs_geometry_review: true,
        validator_required: true,
        generated_from: "route_stop_sequence",
        public_safe: false,
        do_not_publish: true,
    };
}

export function buildInterpolatedStopNormalizedData(
    variantCode: string,
    sequence: number,
): Record<string, unknown> {
    return {
        geometry: buildStopGeometryMetadata(INTERPOLATED_GEOM_SOURCE, "interpolated"),
        ybs_go: {
            variant_code: variantCode,
            sequence,
            geometry_note: "Estimated from route stop sequence between known anchor stops.",
        },
    };
}

export function buildPlaceholderStopNormalizedData(
    variantCode: string,
    sequence: number,
    reviewPoint?: LngLat,
): Record<string, unknown> {
    return {
        geometry: buildStopGeometryMetadata(SYNTHETIC_STOP_GEOM_SOURCE, "placeholder"),
        ...(reviewPoint ? { review_geometry: buildReviewGeometryMetadata(reviewPoint) } : {}),
        ybs_go: {
            variant_code: variantCode,
            sequence,
            geometry_note: "Synthetic placeholder geometry on straight-line review path.",
        },
    };
}

export function buildStraightLineReviewStopNormalizedData(
    variantCode: string,
    sequence: number,
    reviewPoint: LngLat,
): Record<string, unknown> {
    return buildPlaceholderStopNormalizedData(variantCode, sequence, reviewPoint);
}

/** @deprecated Use buildInterpolatedStopNormalizedData */
export function buildGeneratedStopNormalizedData(
    variantCode: string,
    sequence: number,
): Record<string, unknown> {
    return buildInterpolatedStopNormalizedData(variantCode, sequence);
}

export function buildExistingStopNormalizedData(
    matchedStopId: number,
    variantCode: string,
    sequence: number,
    reviewPoint?: LngLat,
): Record<string, unknown> {
    return {
        geometry: buildStopGeometryMetadata(EXISTING_GEOM_SOURCE, "existing"),
        ...(reviewPoint ? { review_geometry: buildReviewGeometryMetadata(reviewPoint) } : {}),
        ybs_go: {
            matched_stop_id: matchedStopId,
            variant_code: variantCode,
            sequence,
            ...(reviewPoint
                ? {
                      geometry_note:
                          "Existing stop geometry kept; review_geometry shows ideal straight-line review position.",
                  }
                : {}),
        },
    };
}

export function buildStraightLineReviewRoutePathNormalizedData(): Record<string, unknown> {
    return {
        geometry: {
            geom_source: SYNTHETIC_PATH_GEOM_SOURCE,
            geometry_quality: "placeholder",
            placeholder_geometry_mode: PLACEHOLDER_GEOMETRY_MODE,
            needs_geometry_review: true,
            validator_required: true,
            public_safe: false,
            generated_from: "route_stop_sequence",
            do_not_publish: true,
        },
        path_kind: ROUTE_PATH_KIND,
        geometry_note:
            "Straight-line review placeholder path; not derived from mixed stop coordinates.",
    };
}

export function buildRoutePathNormalizedData(
    usesPlaceholderStops: boolean,
): Record<string, unknown> {
    if (usesPlaceholderStops) {
        return buildStraightLineReviewRoutePathNormalizedData();
    }

    return {
        geometry: {
            geom_source: INTERPOLATED_GEOM_SOURCE,
            geometry_quality: "interpolated",
            needs_geometry_review: true,
            validator_required: true,
            public_safe: false,
            do_not_publish: true,
        },
        path_kind: ROUTE_PATH_KIND,
        geometry_note: "Corridor estimate from ordered stop points.",
    };
}

export function validateStopSequences(stops: Array<{ sequence: number }>): string | null {
    if (stops.length === 0) {
        return "Variant has no stops.";
    }

    const sequences = stops.map((stop) => stop.sequence);
    if (sequences.some((sequence) => !Number.isFinite(sequence) || sequence < 1)) {
        return "Stop sequence must be a positive number.";
    }

    const unique = new Set(sequences);
    if (unique.size !== sequences.length) {
        return "Duplicate stop sequence values are not allowed.";
    }

    return null;
}
