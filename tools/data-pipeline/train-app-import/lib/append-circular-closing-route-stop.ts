/**
 * Pure plan/build helpers for appending the skipped circular closing route_stop.
 */

import fs from "node:fs";

import {
    dedupeTrainRouteStopsForImport,
    detectClosingDuplicateMetadata,
    isCircularTrainRoute,
} from "./circular-train-route.js";
import {
    buildTrainNormalizedData,
    buildTrainSourceRefs,
    TRAIN_IMPORT_GENERATION,
} from "./train-import-constants.js";
import {
    importReadyRoutePathByVariantCode,
    normalizedRoutePathByVariantCode,
    type TrainRunPaths,
} from "./paths.js";
import type { ImportReadyTrainRoute, NormalizedTrainRoute, NormalizedTrainStation } from "./types.js";

export const CIRCULAR_CLOSING_REPAIR_SCRIPT = "append_circular_closing_route_stop_v1";

export type ClosingOccurrenceTimingSource = "import-ready" | "normalized" | "variant_metadata" | "none";

export type ClosingOccurrenceSourceTiming = {
    source: ClosingOccurrenceTimingSource;
    source_time_text: string | null;
    source_time_type: string | null;
    travel_time_from_previous_seconds: number | null;
    arrival_offset_seconds: number | null;
    departure_offset_seconds: number | null;
};

export type ClosingOccurrenceResolvedTiming = ClosingOccurrenceSourceTiming & {
    closing_timing_needs_review: boolean;
};

export type CircularClosingRepairRouteStopRow = {
    route_stop_id: number;
    stop_id: number;
    stop_sequence: number;
    pickup_type: number;
    drop_off_type: number;
    is_timing_point: boolean;
    arrival_offset_seconds: number | null;
    departure_offset_seconds: number | null;
    travel_time_from_previous_seconds: number | null;
    source_time_text: string | null;
    source_time_type: string | null;
    source_refs: Record<string, unknown> | null;
    normalized_data: Record<string, unknown> | null;
};

export type CircularClosingRepairVariantRow = {
    variant_id: number;
    variant_code: string;
    route_code: string;
    normalized_data: Record<string, unknown> | null;
    route_stops: CircularClosingRepairRouteStopRow[];
    closing_source_timing?: ClosingOccurrenceResolvedTiming | null;
};

export type CircularClosingRepairInsertPayload = {
    route_variant_id: number;
    stop_id: number;
    stop_sequence: number;
    pickup_type: number;
    drop_off_type: number;
    is_timing_point: boolean;
    arrival_offset_seconds: number | null;
    departure_offset_seconds: number | null;
    travel_time_from_previous_seconds: number | null;
    source_time_text: string | null;
    source_time_type: string | null;
    source_refs: Record<string, unknown>;
    normalized_data: Record<string, unknown>;
};

export type CircularClosingRepairPlanItem = {
    route_code: string;
    variant_code: string;
    variant_id: number;
    action: "append" | "skip";
    skip_reason: string | null;
    old_stop_count: number;
    new_stop_count: number | null;
    first_stop_id: number | null;
    appended_sequence: number | null;
    closing_timing_needs_review: boolean | null;
    closing_timing_source: ClosingOccurrenceTimingSource | null;
    insert: CircularClosingRepairInsertPayload | null;
    variant_normalized_data_patch: Record<string, unknown> | null;
};

export type CircularClosingRepairPlan = {
    variant_stop_unique_index_present: boolean;
    items: CircularClosingRepairPlanItem[];
};

function readBoolean(data: Record<string, unknown> | null | undefined, key: string): boolean {
    return data?.[key] === true;
}

function readFiniteCount(data: Record<string, unknown> | null | undefined, key: string): number | null {
    const value = data?.[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
        return Math.trunc(value);
    }
    return null;
}

function readFiniteSeconds(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
        return Math.trunc(value);
    }
    return null;
}

function readFiniteSecondsField(
    data: Record<string, unknown> | null | undefined,
    key: string,
): number | null {
    return readFiniteSeconds(data?.[key]);
}

function trimToNull(value: unknown): string | null {
    if (typeof value !== "string") {
        return null;
    }
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
}

function stationTimingFromSource(
    station: NormalizedTrainStation,
    source: Exclude<ClosingOccurrenceTimingSource, "variant_metadata" | "none">,
): ClosingOccurrenceSourceTiming {
    return {
        source,
        source_time_text: trimToNull(station.source_time_text),
        source_time_type: trimToNull(station.source_time_type),
        travel_time_from_previous_seconds: readFiniteSeconds(station.travel_time_from_previous_seconds),
        arrival_offset_seconds: readFiniteSeconds(station.arrival_offset_seconds),
        // Closing occurrence is the published terminus — never invent a departure offset.
        departure_offset_seconds: null,
    };
}

function findClosingStationInFile(
    stations: readonly NormalizedTrainStation[],
    variantNormalizedData: Record<string, unknown> | null,
): NormalizedTrainStation | null {
    const closingSequence = readFiniteCount(variantNormalizedData, "closing_duplicate_sequence");
    if (closingSequence != null) {
        const bySequence = stations.find((station) => station.sequence === closingSequence);
        if (bySequence) {
            return bySequence;
        }
    }

    const routeStopLike = stations.map((station) => ({
        sequence: station.sequence,
        stop_id: null,
        station_name_en: station.station_name_en,
        station_name_my: station.station_name_my,
        source_time_text: station.source_time_text,
    }));

    if (isCircularTrainRoute(routeStopLike) && stations.length > 0) {
        return stations[stations.length - 1] ?? null;
    }

    const { skipped } = dedupeTrainRouteStopsForImport(routeStopLike);
    const closingMetadata = detectClosingDuplicateMetadata(routeStopLike, skipped);
    if (!closingMetadata) {
        return null;
    }

    return (
        stations.find((station) => station.sequence === closingMetadata.closing_duplicate_sequence) ??
        null
    );
}

function timingFromVariantMetadata(
    variantNormalizedData: Record<string, unknown> | null,
): ClosingOccurrenceSourceTiming {
    return {
        source: "variant_metadata",
        source_time_text: trimToNull(variantNormalizedData?.closing_duplicate_source_time_text),
        source_time_type: trimToNull(variantNormalizedData?.closing_duplicate_source_time_type),
        travel_time_from_previous_seconds: readFiniteSecondsField(
            variantNormalizedData,
            "closing_duplicate_travel_time_from_previous_seconds",
        ),
        arrival_offset_seconds: readFiniteSecondsField(
            variantNormalizedData,
            "closing_duplicate_arrival_offset_seconds",
        ),
        departure_offset_seconds: null,
    };
}

function hasExactClosingSourceTiming(timing: ClosingOccurrenceSourceTiming): boolean {
    return (
        timing.source_time_text != null &&
        timing.travel_time_from_previous_seconds != null &&
        timing.arrival_offset_seconds != null
    );
}

export function resolveClosingOccurrenceTiming(
    timing: ClosingOccurrenceSourceTiming,
): ClosingOccurrenceResolvedTiming {
    const hasSourceClock = timing.source_time_text != null;
    const hasCalculatedFields =
        timing.travel_time_from_previous_seconds != null || timing.arrival_offset_seconds != null;

    if (!hasSourceClock && !hasCalculatedFields) {
        return {
            ...timing,
            source_time_text: null,
            source_time_type: null,
            travel_time_from_previous_seconds: null,
            arrival_offset_seconds: null,
            departure_offset_seconds: null,
            closing_timing_needs_review: true,
        };
    }

    if (hasExactClosingSourceTiming(timing)) {
        return {
            ...timing,
            closing_timing_needs_review: false,
        };
    }

    return {
        source: timing.source,
        source_time_text: timing.source_time_text,
        source_time_type: timing.source_time_type,
        travel_time_from_previous_seconds: null,
        arrival_offset_seconds: null,
        departure_offset_seconds: null,
        closing_timing_needs_review: true,
    };
}

export function loadClosingOccurrenceSourceTiming(
    paths: TrainRunPaths,
    variantCode: string,
    variantNormalizedData: Record<string, unknown> | null,
): ClosingOccurrenceResolvedTiming {
    const importReadyFile = importReadyRoutePathByVariantCode(paths, variantCode);
    if (fs.existsSync(importReadyFile)) {
        const route = JSON.parse(fs.readFileSync(importReadyFile, "utf8")) as ImportReadyTrainRoute;
        const closingStation = findClosingStationInFile(route.stations, variantNormalizedData);
        if (closingStation) {
            return resolveClosingOccurrenceTiming(
                stationTimingFromSource(closingStation, "import-ready"),
            );
        }
    }

    const normalizedFile = normalizedRoutePathByVariantCode(paths, variantCode);
    if (fs.existsSync(normalizedFile)) {
        const route = JSON.parse(fs.readFileSync(normalizedFile, "utf8")) as NormalizedTrainRoute;
        const closingStation = findClosingStationInFile(route.stations, variantNormalizedData);
        if (closingStation) {
            return resolveClosingOccurrenceTiming(stationTimingFromSource(closingStation, "normalized"));
        }
    }

    return resolveClosingOccurrenceTiming(timingFromVariantMetadata(variantNormalizedData));
}

export function sortCircularClosingRouteStops(
    rows: readonly CircularClosingRepairRouteStopRow[],
): CircularClosingRepairRouteStopRow[] {
    return [...rows].sort((a, b) => {
        if (a.stop_sequence !== b.stop_sequence) {
            return a.stop_sequence - b.stop_sequence;
        }
        return a.route_stop_id - b.route_stop_id;
    });
}

export function buildClosingRouteStopProvenance(args: {
    variantCode: string;
    firstStop: CircularClosingRepairRouteStopRow;
    appendedSequence: number;
    variantNormalizedData: Record<string, unknown> | null;
    resolvedTiming: ClosingOccurrenceResolvedTiming;
}): { source_refs: Record<string, unknown>; normalized_data: Record<string, unknown> } {
    const { variantCode, firstStop, appendedSequence, variantNormalizedData, resolvedTiming } = args;

    const source_refs = {
        ...(firstStop.source_refs ?? {}),
        ...buildTrainSourceRefs({
            variant_code: variantCode,
            sequence: appendedSequence,
            stop_id: firstStop.stop_id,
            circular_closing_repair: CIRCULAR_CLOSING_REPAIR_SCRIPT,
            closing_timing_source: resolvedTiming.source,
        }),
    };

    const normalized_data = {
        ...(firstStop.normalized_data ?? {}),
        ...buildTrainNormalizedData({
            sequence: appendedSequence,
            stop_id: firstStop.stop_id,
            circular_closing_occurrence: true,
            closing_duplicate_repaired: true,
            repair_script: CIRCULAR_CLOSING_REPAIR_SCRIPT,
            loop_duplicate_skipped: false,
            closing_duplicate_sequence: appendedSequence,
            closing_duplicate_station_name_en: trimToNull(
                variantNormalizedData?.closing_duplicate_station_name_en,
            ),
            closing_duplicate_station_name_my: trimToNull(
                variantNormalizedData?.closing_duplicate_station_name_my,
            ),
            closing_timing_needs_review: resolvedTiming.closing_timing_needs_review,
            closing_timing_source: resolvedTiming.source,
            closing_timing_restored_from_source: !resolvedTiming.closing_timing_needs_review,
        }),
    };

    return { source_refs, normalized_data };
}

export function buildCircularClosingRepairPlanItem(
    bundle: CircularClosingRepairVariantRow,
    options: { variantStopUniqueIndexPresent: boolean },
): CircularClosingRepairPlanItem {
    const base = {
        route_code: bundle.route_code,
        variant_code: bundle.variant_code,
        variant_id: bundle.variant_id,
        old_stop_count: bundle.route_stops.length,
        new_stop_count: null as number | null,
        first_stop_id: null as number | null,
        appended_sequence: null as number | null,
        closing_timing_needs_review: null as boolean | null,
        closing_timing_source: null as ClosingOccurrenceTimingSource | null,
        insert: null as CircularClosingRepairInsertPayload | null,
        variant_normalized_data_patch: null as Record<string, unknown> | null,
    };

    const normalizedData = bundle.normalized_data;

    if (!readBoolean(normalizedData, "is_circular_route")) {
        return {
            ...base,
            action: "skip",
            skip_reason: "variant is not marked is_circular_route",
        };
    }

    if (!readBoolean(normalizedData, "closing_duplicate_stop_skipped")) {
        return {
            ...base,
            action: "skip",
            skip_reason: "closing_duplicate_stop_skipped is not true",
        };
    }

    if (options.variantStopUniqueIndexPresent) {
        return {
            ...base,
            action: "skip",
            skip_reason:
                "transport_route_stops_variant_stop_unique still exists — apply migration 126 first",
        };
    }

    const ordered = sortCircularClosingRouteStops(bundle.route_stops);
    if (ordered.length === 0) {
        return {
            ...base,
            action: "skip",
            skip_reason: "variant has no route_stops",
        };
    }

    const first = ordered[0]!;
    if (!first.stop_id || first.stop_id <= 0) {
        return {
            ...base,
            action: "skip",
            skip_reason: "first route_stop has no stop_id",
        };
    }

    const closingAlreadyPresent = ordered.some(
        (row) => row.stop_id === first.stop_id && row.route_stop_id !== first.route_stop_id,
    );
    if (closingAlreadyPresent) {
        return {
            ...base,
            action: "skip",
            skip_reason: "closing stop_id occurrence already present",
            first_stop_id: first.stop_id,
        };
    }

    const maxSequence = ordered.reduce((max, row) => Math.max(max, row.stop_sequence), 0);
    const appendedSequence = maxSequence + 1;
    const newStopCount = ordered.length + 1;
    const sourceTotalStations = readFiniteCount(normalizedData, "source_total_stations");
    if (sourceTotalStations != null && newStopCount > sourceTotalStations) {
        return {
            ...base,
            action: "skip",
            skip_reason: `new stop count ${newStopCount} would exceed source_total_stations ${sourceTotalStations}`,
            first_stop_id: first.stop_id,
        };
    }

    const resolvedTiming =
        bundle.closing_source_timing ??
        resolveClosingOccurrenceTiming(timingFromVariantMetadata(normalizedData));

    const provenance = buildClosingRouteStopProvenance({
        variantCode: bundle.variant_code,
        firstStop: first,
        appendedSequence,
        variantNormalizedData: normalizedData,
        resolvedTiming,
    });

    return {
        ...base,
        action: "append",
        skip_reason: null,
        new_stop_count: newStopCount,
        first_stop_id: first.stop_id,
        appended_sequence: appendedSequence,
        closing_timing_needs_review: resolvedTiming.closing_timing_needs_review,
        closing_timing_source: resolvedTiming.source,
        insert: {
            route_variant_id: bundle.variant_id,
            stop_id: first.stop_id,
            stop_sequence: appendedSequence,
            pickup_type: first.pickup_type,
            drop_off_type: first.drop_off_type,
            is_timing_point: first.is_timing_point,
            arrival_offset_seconds: resolvedTiming.arrival_offset_seconds,
            departure_offset_seconds: resolvedTiming.departure_offset_seconds,
            travel_time_from_previous_seconds: resolvedTiming.travel_time_from_previous_seconds,
            source_time_text: resolvedTiming.source_time_text,
            source_time_type: resolvedTiming.source_time_type,
            source_refs: provenance.source_refs,
            normalized_data: provenance.normalized_data,
        },
        variant_normalized_data_patch: {
            closing_duplicate_stop_skipped: false,
            imported_route_stops: newStopCount,
        },
    };
}

export function buildCircularClosingRepairPlan(
    bundles: readonly CircularClosingRepairVariantRow[],
    options: { variantStopUniqueIndexPresent: boolean },
): CircularClosingRepairPlan {
    return {
        variant_stop_unique_index_present: options.variantStopUniqueIndexPresent,
        items: bundles.map((bundle) =>
            buildCircularClosingRepairPlanItem(bundle, {
                variantStopUniqueIndexPresent: options.variantStopUniqueIndexPresent,
            }),
        ),
    };
}

export function runAppendCircularClosingRouteStopSelfTest(): void {
    const baseStops: CircularClosingRepairRouteStopRow[] = Array.from({ length: 38 }, (_, index) => ({
        route_stop_id: 100 + index,
        stop_id: index === 0 ? 145 : 200 + index,
        stop_sequence: index + 1,
        pickup_type: 0,
        drop_off_type: 0,
        is_timing_point: true,
        arrival_offset_seconds: index * 60,
        departure_offset_seconds: index * 60 + 30,
        travel_time_from_previous_seconds: index === 0 ? null : 60,
        source_time_text: null,
        source_time_type: index === 0 ? "departure" : "both",
        source_refs: { generation: TRAIN_IMPORT_GENERATION },
        normalized_data: { generation: TRAIN_IMPORT_GENERATION, sequence: index + 1 },
    }));

    const pendingBundle: CircularClosingRepairVariantRow = {
        variant_id: 614,
        variant_code: "TRAIN-GA-3-CLOCKWISE",
        route_code: "TRAIN-ga-3",
        normalized_data: {
            generation: TRAIN_IMPORT_GENERATION,
            is_circular_route: true,
            closing_duplicate_stop_skipped: true,
            closing_duplicate_sequence: 39,
            source_total_stations: 39,
            imported_route_stops: 38,
        },
        route_stops: baseStops,
        closing_source_timing: {
            source: "import-ready",
            source_time_text: "04:30 PM",
            source_time_type: "arrival",
            travel_time_from_previous_seconds: 180,
            arrival_offset_seconds: 24_300,
            departure_offset_seconds: null,
            closing_timing_needs_review: false,
        },
    };

    const appendPlan = buildCircularClosingRepairPlanItem(pendingBundle, {
        variantStopUniqueIndexPresent: false,
    });
    if (appendPlan.action !== "append") {
        throw new Error(`expected append plan, got ${appendPlan.action}: ${appendPlan.skip_reason}`);
    }
    if (
        appendPlan.old_stop_count !== 38 ||
        appendPlan.new_stop_count !== 39 ||
        appendPlan.first_stop_id !== 145 ||
        appendPlan.appended_sequence !== 39 ||
        appendPlan.insert?.stop_id !== 145 ||
        appendPlan.closing_timing_needs_review !== false ||
        appendPlan.insert?.travel_time_from_previous_seconds !== 180 ||
        appendPlan.insert?.arrival_offset_seconds !== 24_300 ||
        appendPlan.insert?.departure_offset_seconds !== null ||
        appendPlan.insert?.source_time_text !== "04:30 PM"
    ) {
        throw new Error(`unexpected append plan: ${JSON.stringify(appendPlan)}`);
    }

    const needsReviewTiming = resolveClosingOccurrenceTiming({
        source: "variant_metadata",
        source_time_text: "04:30 PM",
        source_time_type: null,
        travel_time_from_previous_seconds: null,
        arrival_offset_seconds: null,
        departure_offset_seconds: null,
    });
    if (
        needsReviewTiming.closing_timing_needs_review !== true ||
        needsReviewTiming.travel_time_from_previous_seconds !== null ||
        needsReviewTiming.arrival_offset_seconds !== null
    ) {
        throw new Error(`expected partial timing to need review: ${JSON.stringify(needsReviewTiming)}`);
    }

    const metadataOnlyBundle: CircularClosingRepairVariantRow = {
        ...pendingBundle,
        closing_source_timing: needsReviewTiming,
    };
    const metadataOnlyPlan = buildCircularClosingRepairPlanItem(metadataOnlyBundle, {
        variantStopUniqueIndexPresent: false,
    });
    if (
        metadataOnlyPlan.action !== "append" ||
        metadataOnlyPlan.closing_timing_needs_review !== true ||
        metadataOnlyPlan.insert?.arrival_offset_seconds !== null ||
        metadataOnlyPlan.insert?.normalized_data.closing_timing_needs_review !== true
    ) {
        throw new Error(`unexpected metadata-only plan: ${JSON.stringify(metadataOnlyPlan)}`);
    }

    const repairedBundle: CircularClosingRepairVariantRow = {
        ...pendingBundle,
        route_stops: [
            ...baseStops,
            {
                route_stop_id: 999,
                stop_id: 145,
                stop_sequence: 39,
                pickup_type: 0,
                drop_off_type: 0,
                is_timing_point: true,
                arrival_offset_seconds: 24_300,
                departure_offset_seconds: null,
                travel_time_from_previous_seconds: 180,
                source_time_text: "04:30 PM",
                source_time_type: "arrival",
                source_refs: { generation: TRAIN_IMPORT_GENERATION },
                normalized_data: {
                    generation: TRAIN_IMPORT_GENERATION,
                    sequence: 39,
                    circular_closing_occurrence: true,
                },
            },
        ],
    };

    const alreadyRepaired = buildCircularClosingRepairPlanItem(repairedBundle, {
        variantStopUniqueIndexPresent: false,
    });
    if (alreadyRepaired.action !== "skip" || alreadyRepaired.skip_reason !== "closing stop_id occurrence already present") {
        throw new Error(`expected repaired skip, got ${JSON.stringify(alreadyRepaired)}`);
    }

    const urbanBundle: CircularClosingRepairVariantRow = {
        ...pendingBundle,
        variant_code: "TRAIN-141-UP",
        normalized_data: {
            generation: TRAIN_IMPORT_GENERATION,
            is_circular_route: false,
            closing_duplicate_stop_skipped: false,
        },
        route_stops: baseStops.slice(0, 5),
    };
    const urbanPlan = buildCircularClosingRepairPlanItem(urbanBundle, {
        variantStopUniqueIndexPresent: false,
    });
    if (urbanPlan.action !== "skip" || urbanPlan.skip_reason !== "variant is not marked is_circular_route") {
        throw new Error(`expected urban skip, got ${JSON.stringify(urbanPlan)}`);
    }

    const indexBlocked = buildCircularClosingRepairPlanItem(pendingBundle, {
        variantStopUniqueIndexPresent: true,
    });
    if (indexBlocked.action !== "skip" || !indexBlocked.skip_reason?.includes("migration 126")) {
        throw new Error(`expected index-blocked skip, got ${JSON.stringify(indexBlocked)}`);
    }

    console.log("ok - append-circular-closing-route-stop self-test");
}
