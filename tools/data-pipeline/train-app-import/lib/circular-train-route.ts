/**
 * Circular train route helpers — detect loop closing duplicates and build import metadata.
 */

import type { ImportReadyTrainRoute, ImportReadyTrainStation } from "./types.js";

export type TrainRouteStopLike = {
    sequence: number;
    stop_id?: number | null;
    station_name_en?: string | null;
    station_name_my?: string | null;
    source_time_text?: string | null;
};

export type DedupeTrainRouteStopsResult<T extends TrainRouteStopLike> = {
    toInsert: T[];
    skipped: T[];
};

function trimName(value: string | null | undefined): string | null {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
}

export function stationsMatchByStopOrName(
    first: TrainRouteStopLike,
    last: TrainRouteStopLike,
): boolean {
    const firstStopId = first.stop_id ?? 0;
    const lastStopId = last.stop_id ?? 0;
    if (firstStopId > 0 && lastStopId > 0 && firstStopId === lastStopId) {
        return true;
    }

    const firstEn = trimName(first.station_name_en);
    const lastEn = trimName(last.station_name_en);
    if (firstEn && lastEn && firstEn === lastEn) {
        return true;
    }

    const firstMy = trimName(first.station_name_my);
    const lastMy = trimName(last.station_name_my);
    return Boolean(firstMy && lastMy && firstMy === lastMy);
}

export function isCircularTrainRoute(stations: TrainRouteStopLike[]): boolean {
    if (stations.length < 2) {
        return false;
    }
    return stationsMatchByStopOrName(stations[0]!, stations[stations.length - 1]!);
}

/** True when this row is the intentional loop-closing revisit (last row matches first). */
export function isIntentionalCircularClosingOccurrence(
    stations: readonly TrainRouteStopLike[],
    index: number,
): boolean {
    if (stations.length < 2 || index !== stations.length - 1) {
        return false;
    }
    return stationsMatchByStopOrName(stations[0]!, stations[index]!);
}

/**
 * Inserts every source row except accidental mid-route stop_id repeats.
 * Intentional circular closing rows (last matches first) are kept.
 */
export function dedupeTrainRouteStopsForImport<T extends TrainRouteStopLike>(
    stations: T[],
): DedupeTrainRouteStopsResult<T> {
    const seenStopIds = new Set<number>();
    const toInsert: T[] = [];
    const skipped: T[] = [];

    for (let index = 0; index < stations.length; index++) {
        const station = stations[index]!;
        const stopId = station.stop_id ?? 0;
        const isClosingOccurrence = isIntentionalCircularClosingOccurrence(stations, index);

        if (stopId > 0 && seenStopIds.has(stopId) && !isClosingOccurrence) {
            skipped.push(station);
            continue;
        }
        if (stopId > 0 && !isClosingOccurrence) {
            seenStopIds.add(stopId);
        }
        toInsert.push(station);
    }

    return { toInsert, skipped };
}

export type ClosingDuplicateMetadata = {
    closing_duplicate_stop_skipped: true;
    closing_duplicate_sequence: number;
    closing_duplicate_station_name_en: string | null;
    closing_duplicate_station_name_my: string | null;
    closing_duplicate_source_time_text: string | null;
};

export function detectClosingDuplicateMetadata(
    stations: TrainRouteStopLike[],
    skipped: TrainRouteStopLike[],
): ClosingDuplicateMetadata | null {
    if (!isCircularTrainRoute(stations) || stations.length < 2 || skipped.length === 0) {
        return null;
    }

    const last = stations[stations.length - 1]!;
    const first = stations[0]!;
    if (!stationsMatchByStopOrName(first, last)) {
        return null;
    }

    const closingSkipped = skipped.find((station) => station.sequence === last.sequence);
    if (!closingSkipped) {
        return null;
    }

    return {
        closing_duplicate_stop_skipped: true,
        closing_duplicate_sequence: closingSkipped.sequence,
        closing_duplicate_station_name_en: trimName(closingSkipped.station_name_en),
        closing_duplicate_station_name_my: trimName(closingSkipped.station_name_my),
        closing_duplicate_source_time_text: trimName(closingSkipped.source_time_text),
    };
}

export function computeValidationExpectedRouteStops(stations: TrainRouteStopLike[]): number {
    if (stations.length === 0) {
        return 0;
    }

    return dedupeTrainRouteStopsForImport(stations).toInsert.length;
}

export const CIRCULAR_CLOSING_DUPLICATE_WARNING =
    "Legacy circular import skipped the closing station; run append-circular-closing-route-stop repair.";

function readFiniteNormalizedCount(
    data: Record<string, unknown> | null | undefined,
    key: string,
): number | null {
    const value = data?.[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
        return Math.trunc(value);
    }
    return null;
}

export type ResolvedExpectedStopCount = {
    expected_stop_count: number | null;
    expected_stop_count_source: string;
};

/** Resolve DB route_stop count expectation from variant/route normalized_data, then file fallback. */
export function resolveExpectedStopCount(options: {
    routeNormalizedData: Record<string, unknown> | null | undefined;
    variantNormalizedData: Record<string, unknown> | null | undefined;
    normalizedFileFallback: number | null;
    normalizedFileIsCircular?: boolean;
}): ResolvedExpectedStopCount {
    const variant = options.variantNormalizedData ?? null;
    const route = options.routeNormalizedData ?? null;
    const closingDuplicateSkipped = variant?.closing_duplicate_stop_skipped === true;
    const circularFromMetadata =
        closingDuplicateSkipped || variant?.is_circular_route === true || options.normalizedFileIsCircular === true;

    const chain: Array<{ source: string; value: number | null }> = [
        {
            source: "variant.normalized_data.validation_expected_route_stops",
            value: readFiniteNormalizedCount(variant, "validation_expected_route_stops"),
        },
        {
            source: "variant.normalized_data.imported_route_stops",
            value: readFiniteNormalizedCount(variant, "imported_route_stops"),
        },
        {
            source: "variant.normalized_data.total_stations",
            value: closingDuplicateSkipped
                ? null
                : readFiniteNormalizedCount(variant, "total_stations"),
        },
        {
            source: "route.normalized_data.total_stations",
            value: readFiniteNormalizedCount(route, "total_stations"),
        },
    ];

    for (const row of chain) {
        if (row.value == null) {
            continue;
        }

        if (
            circularFromMetadata &&
            options.normalizedFileFallback != null &&
            row.source === "variant.normalized_data.total_stations" &&
            row.value !== options.normalizedFileFallback
        ) {
            return {
                expected_stop_count: options.normalizedFileFallback,
                expected_stop_count_source: "normalized_file",
            };
        }

        return {
            expected_stop_count: row.value,
            expected_stop_count_source: row.source,
        };
    }

    if (options.normalizedFileFallback != null) {
        return {
            expected_stop_count: options.normalizedFileFallback,
            expected_stop_count_source: "normalized_file",
        };
    }

    return {
        expected_stop_count: null,
        expected_stop_count_source: "unknown",
    };
}

export function buildCircularRouteValidationWarnings(
    variantNormalizedData: Record<string, unknown> | null | undefined,
): string[] {
    if (variantNormalizedData?.closing_duplicate_stop_skipped === true) {
        return [CIRCULAR_CLOSING_DUPLICATE_WARNING];
    }
    return [];
}

export function readCircularRouteMetadata(
    variantNormalizedData: Record<string, unknown> | null | undefined,
): {
    is_circular_route: boolean | null;
    closing_duplicate_stop_skipped: boolean | null;
    source_total_stations: number | null;
    imported_route_stops: number | null;
    validation_expected_route_stops: number | null;
} {
    const data = variantNormalizedData ?? null;
    return {
        is_circular_route: typeof data?.is_circular_route === "boolean" ? data.is_circular_route : null,
        closing_duplicate_stop_skipped:
            typeof data?.closing_duplicate_stop_skipped === "boolean"
                ? data.closing_duplicate_stop_skipped
                : null,
        source_total_stations: readFiniteNormalizedCount(data, "source_total_stations"),
        imported_route_stops: readFiniteNormalizedCount(data, "imported_route_stops"),
        validation_expected_route_stops: readFiniteNormalizedCount(
            data,
            "validation_expected_route_stops",
        ),
    };
}

export function buildVariantImportNormalizedData(
    route: ImportReadyTrainRoute,
): Record<string, unknown> {
    const source_total_stations = route.total_stations ?? route.stations.length;
    const { toInsert, skipped } = dedupeTrainRouteStopsForImport(route.stations);
    const imported_route_stops = toInsert.length;
    const is_circular_route = isCircularTrainRoute(route.stations);
    const closingDuplicate = detectClosingDuplicateMetadata(route.stations, skipped);
    const closing_occurrence_imported =
        is_circular_route &&
        toInsert.length === route.stations.length &&
        isIntentionalCircularClosingOccurrence(route.stations, route.stations.length - 1);

    const data: Record<string, unknown> = {
        train_number: route.train_number,
        direction: route.direction,
        travel_duration_seconds: route.travel_duration_seconds ?? null,
        is_circular_route,
        source_total_stations,
        imported_route_stops,
        validation_expected_route_stops: imported_route_stops,
        ...(closing_occurrence_imported ? { closing_occurrence_imported: true } : {}),
    };

    if (closingDuplicate) {
        Object.assign(data, closingDuplicate);
    }

    return data;
}

export function formatAccidentalDuplicateSkipWarning(station: ImportReadyTrainStation): string {
    return (
        `Skipped accidental duplicate stop_id ${station.stop_id} at sequence ${station.sequence} ` +
        `(${station.station_name_en ?? station.station_name_my ?? "unknown"})`
    );
}

/** @deprecated Use formatAccidentalDuplicateSkipWarning */
export function formatClosingDuplicateSkipWarning(station: ImportReadyTrainStation): string {
    return formatAccidentalDuplicateSkipWarning(station);
}

export function runCircularTrainRouteSelfTest(): void {
    const circular: ImportReadyTrainStation[] = [
        {
            sequence: 1,
            station_name_en: "Yangon Central Railway Station",
            station_name_my: "ရန်ကုန် ဘူတာကြီး",
            stop_id: 1394,
            stop_public_id: "stop-a",
            departure_offset_seconds: 0,
            source_time_type: "departure",
        },
        {
            sequence: 2,
            station_name_en: "Middle",
            stop_id: 200,
            stop_public_id: "stop-b",
            source_time_type: "arrival_departure",
        },
        {
            sequence: 3,
            station_name_en: "Yangon Central Railway Station",
            station_name_my: "ရန်ကုန် ဘူတာကြီး",
            stop_id: 1394,
            stop_public_id: "stop-a",
            arrival_offset_seconds: 3600,
            source_time_text: "07:00 AM",
            source_time_type: "arrival",
        },
    ];

    if (!isCircularTrainRoute(circular)) {
        throw new Error("expected circular route detection");
    }

    const { toInsert, skipped } = dedupeTrainRouteStopsForImport(circular);
    if (toInsert.length !== 3 || skipped.length !== 0) {
        throw new Error("expected circular closing occurrence to be imported");
    }

    const metadata = buildVariantImportNormalizedData({
        schema_version: 1,
        prepared_at: "2026-07-09T00:00:00.000Z",
        train_number: "ga-3",
        direction: "CLOCKWISE",
        route_code: "TRAIN-GA-3",
        variant_code: "TRAIN-GA-3-CLOCKWISE",
        route_quality_status: "ready_for_import",
        total_stations: 3,
        stations: circular,
        import_status: "ready",
        source_name: "external_myanmar_train_app",
        source_kind: "visible_app_extraction",
    });

    if (
        metadata.is_circular_route !== true ||
        metadata.source_total_stations !== 3 ||
        metadata.imported_route_stops !== 3 ||
        metadata.validation_expected_route_stops !== 3 ||
        metadata.closing_occurrence_imported !== true ||
        metadata.closing_duplicate_stop_skipped === true
    ) {
        throw new Error(`unexpected circular metadata: ${JSON.stringify(metadata)}`);
    }

    const linear: ImportReadyTrainStation[] = [
        {
            sequence: 1,
            station_name_en: "A",
            stop_id: 1,
            stop_public_id: "stop-1",
            source_time_type: "departure",
        },
        {
            sequence: 2,
            station_name_en: "B",
            stop_id: 2,
            stop_public_id: "stop-2",
            source_time_type: "arrival",
        },
    ];
    const linearMeta = buildVariantImportNormalizedData({
        schema_version: 1,
        prepared_at: "2026-07-09T00:00:00.000Z",
        train_number: "11",
        direction: "UP",
        route_code: "TRAIN-11",
        variant_code: "TRAIN-11-UP",
        route_quality_status: "ready_for_import",
        total_stations: 2,
        stations: linear,
        import_status: "ready",
        source_name: "external_myanmar_train_app",
        source_kind: "visible_app_extraction",
    });

    if (
        linearMeta.is_circular_route !== false ||
        linearMeta.imported_route_stops !== 2 ||
        linearMeta.closing_duplicate_stop_skipped === true
    ) {
        throw new Error("expected linear route metadata without closing duplicate");
    }

    const normalizedLike = circular.map(({ stop_id: _stopId, stop_public_id: _publicId, ...station }) => station);
    if (computeValidationExpectedRouteStops(normalizedLike) !== 3) {
        throw new Error("expected normalized fallback to keep closing occurrence");
    }

    console.log("ok - circular-train-route self-test");
}
