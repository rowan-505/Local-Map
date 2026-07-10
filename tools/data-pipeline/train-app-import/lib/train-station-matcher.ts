/**
 * Pure train station matching against transport.stops (mode = train).
 * No database access.
 */

import type { TrainStopPoolRow } from "./db.js";
import {
    englishAliasKeys,
    myanmarAliasKeys,
} from "./station-aliases.js";
import {
    normalizeExactEnglishKey,
    normalizeExactMyanmarKey,
    normalizedEnglishKey,
    normalizedMyanmarKey,
    trimToNull,
} from "./text-normalize.js";
import type {
    NormalizedTrainRoute,
    NormalizedTrainStation,
    StationMatchConfidence,
    TrainRouteMatchQuality,
} from "./types.js";

export type TrainStationMatchMethod =
    | "manual_override"
    | "exact_name_en"
    | "exact_name_my"
    | "normalized_name_en"
    | "normalized_name_my"
    | "alias_name_en"
    | "alias_name_my"
    | "ambiguous"
    | "unmatched";

export type { TrainRouteMatchQuality } from "./types.js";

export type ManualOverrideEntry = {
    variant_code: string;
    sequence: number;
    stop_id: number;
};

export type ManualOverridesFile = {
    schema_version?: number;
    overrides?: ManualOverrideEntry[];
    /** Map form: { "TRAIN-11-UP": { "2": 42 } } */
    by_variant?: Record<string, Record<string, number>>;
};

export type TrainStationMatchRow = {
    sequence: number;
    station_name_en: string | null;
    station_name_my: string | null;
    matched_stop_id: number | null;
    matched_stop_public_id: string | null;
    match_method: TrainStationMatchMethod;
    match_score: number;
    match_confidence: StationMatchConfidence | "ambiguous";
    candidate_stop_ids: number[];
};

export type TrainRouteAutoMatch = {
    variant_code: string;
    route_code: string;
    train_number: string;
    direction_code: string;
    route_quality_status: TrainRouteMatchQuality;
    matched_count: number;
    unmatched_count: number;
    ambiguous_count: number;
    stations: TrainStationMatchRow[];
    warnings: string[];
};

type StopCatalog = {
    stopsById: Map<number, TrainStopPoolRow>;
    exactEn: Map<string, number[]>;
    exactMy: Map<string, number[]>;
    normEn: Map<string, number[]>;
    normMy: Map<string, number[]>;
};

const MATCH_SCORE: Record<TrainStationMatchMethod, number> = {
    manual_override: 100,
    exact_name_en: 98,
    exact_name_my: 98,
    normalized_name_en: 88,
    normalized_name_my: 88,
    alias_name_en: 80,
    alias_name_my: 80,
    ambiguous: 0,
    unmatched: 0,
};

/** Prefer station over platform/halt; if still tied, pick lowest id (shared reuse). */
function preferStationCandidates(
    catalog: StopCatalog,
    candidates: number[],
): { ids: number[]; autoPicked: boolean } {
    if (candidates.length <= 1) {
        return { ids: candidates, autoPicked: false };
    }

    const stations = candidates.filter((id) => {
        const stop = catalog.stopsById.get(id);
        return (stop?.stop_type ?? "").toLowerCase() === "station";
    });
    const pool = stations.length > 0 ? stations : candidates;
    if (pool.length === 1) {
        return { ids: pool, autoPicked: pool[0] !== candidates[0] || candidates.length > 1 };
    }

    // Near-duplicate stations: reuse the lowest id so all routes share one stop.
    const sorted = [...pool].sort((a, b) => a - b);
    return { ids: [sorted[0]!], autoPicked: true };
}

function addToIndex(map: Map<string, number[]>, key: string, stopId: number): void {
    if (!key) {
        return;
    }
    const bucket = map.get(key) ?? [];
    if (!bucket.includes(stopId)) {
        bucket.push(stopId);
    }
    map.set(key, bucket);
}

export function buildTrainStopCatalog(stops: TrainStopPoolRow[]): StopCatalog {
    const stopsById = new Map<number, TrainStopPoolRow>();
    const exactEn = new Map<string, number[]>();
    const exactMy = new Map<string, number[]>();
    const normEn = new Map<string, number[]>();
    const normMy = new Map<string, number[]>();

    for (const stop of stops) {
        stopsById.set(stop.stop_id, stop);

        for (const value of [stop.name_en, stop.name]) {
            const trimmed = trimToNull(value);
            if (!trimmed) {
                continue;
            }
            addToIndex(exactEn, normalizeExactEnglishKey(trimmed), stop.stop_id);
            addToIndex(normEn, normalizedEnglishKey(trimmed), stop.stop_id);
        }

        for (const value of [stop.name_mm, stop.name]) {
            const trimmed = trimToNull(value);
            if (!trimmed) {
                continue;
            }
            addToIndex(exactMy, normalizeExactMyanmarKey(trimmed), stop.stop_id);
            addToIndex(normMy, normalizedMyanmarKey(trimmed), stop.stop_id);
        }
    }

    return { stopsById, exactEn, exactMy, normEn, normMy };
}

export function parseManualOverrides(raw: unknown): Map<string, number> {
    const map = new Map<string, number>();
    if (!raw || typeof raw !== "object") {
        return map;
    }

    const file = raw as ManualOverridesFile;

    if (Array.isArray(file.overrides)) {
        for (const entry of file.overrides) {
            if (!entry?.variant_code || !entry.sequence || !entry.stop_id) {
                continue;
            }
            map.set(`${entry.variant_code}::${entry.sequence}`, entry.stop_id);
        }
    }

    if (file.by_variant && typeof file.by_variant === "object") {
        for (const [variantCode, sequences] of Object.entries(file.by_variant)) {
            if (!sequences || typeof sequences !== "object") {
                continue;
            }
            for (const [sequenceText, stopId] of Object.entries(sequences)) {
                const sequence = Number(sequenceText);
                if (!Number.isFinite(sequence) || !stopId) {
                    continue;
                }
                map.set(`${variantCode}::${sequence}`, stopId);
            }
        }
    }

    return map;
}

function resolveCandidates(
    catalog: StopCatalog,
    method: TrainStationMatchMethod,
    station: NormalizedTrainStation,
): number[] {
    switch (method) {
        case "exact_name_en": {
            const key = trimToNull(station.station_name_en);
            return key ? [...(catalog.exactEn.get(normalizeExactEnglishKey(key)) ?? [])] : [];
        }
        case "exact_name_my": {
            const key = trimToNull(station.station_name_my);
            return key ? [...(catalog.exactMy.get(normalizeExactMyanmarKey(key)) ?? [])] : [];
        }
        case "normalized_name_en": {
            const key = trimToNull(station.station_name_en);
            return key ? [...(catalog.normEn.get(normalizedEnglishKey(key)) ?? [])] : [];
        }
        case "normalized_name_my": {
            const key = trimToNull(station.station_name_my);
            return key ? [...(catalog.normMy.get(normalizedMyanmarKey(key)) ?? [])] : [];
        }
        case "alias_name_en": {
            const ids = new Set<number>();
            for (const key of englishAliasKeys(station.station_name_en)) {
                for (const id of catalog.normEn.get(key) ?? []) {
                    ids.add(id);
                }
            }
            return [...ids];
        }
        case "alias_name_my": {
            const ids = new Set<number>();
            for (const key of myanmarAliasKeys(station.station_name_my)) {
                for (const id of catalog.normMy.get(key) ?? []) {
                    ids.add(id);
                }
            }
            return [...ids];
        }
        default:
            return [];
    }
}

function matchConfidenceForMethod(
    method: TrainStationMatchMethod,
): StationMatchConfidence | "ambiguous" {
    if (method === "ambiguous") {
        return "ambiguous";
    }
    if (method === "unmatched") {
        return "none";
    }
    if (method === "manual_override" || method.startsWith("exact_")) {
        return "exact";
    }
    return "fuzzy";
}

export function matchTrainStation(options: {
    catalog: StopCatalog;
    station: NormalizedTrainStation;
    variantCode: string;
    manualOverrides: Map<string, number>;
}): TrainStationMatchRow {
    const stationNameEn = trimToNull(options.station.station_name_en);
    const stationNameMy = trimToNull(options.station.station_name_my);
    const overrideKey = `${options.variantCode}::${options.station.sequence}`;
    const overrideStopId = options.manualOverrides.get(overrideKey);

    if (overrideStopId) {
        const stop = options.catalog.stopsById.get(overrideStopId);
        return {
            sequence: options.station.sequence,
            station_name_en: stationNameEn,
            station_name_my: stationNameMy,
            matched_stop_id: overrideStopId,
            matched_stop_public_id: stop?.public_id ?? null,
            match_method: "manual_override",
            match_score: MATCH_SCORE.manual_override,
            match_confidence: "exact",
            candidate_stop_ids: [overrideStopId],
        };
    }

    const methods: TrainStationMatchMethod[] = [
        "exact_name_en",
        "exact_name_my",
        "normalized_name_en",
        "normalized_name_my",
        "alias_name_en",
        "alias_name_my",
    ];

    for (const method of methods) {
        const rawCandidates = resolveCandidates(options.catalog, method, options.station);
        const preferred = preferStationCandidates(options.catalog, rawCandidates);
        const candidates = preferred.ids;
        if (candidates.length === 1) {
            const stopId = candidates[0]!;
            const stop = options.catalog.stopsById.get(stopId);
            const resolvedMethod: TrainStationMatchMethod =
                preferred.autoPicked && rawCandidates.length > 1 ? method : method;
            return {
                sequence: options.station.sequence,
                station_name_en: stationNameEn,
                station_name_my: stationNameMy,
                matched_stop_id: stopId,
                matched_stop_public_id: stop?.public_id ?? null,
                match_method: resolvedMethod,
                match_score: MATCH_SCORE[resolvedMethod],
                match_confidence: matchConfidenceForMethod(resolvedMethod),
                candidate_stop_ids: preferred.autoPicked ? rawCandidates : candidates,
            };
        }
        if (candidates.length > 1) {
            return {
                sequence: options.station.sequence,
                station_name_en: stationNameEn,
                station_name_my: stationNameMy,
                matched_stop_id: null,
                matched_stop_public_id: null,
                match_method: "ambiguous",
                match_score: MATCH_SCORE.ambiguous,
                match_confidence: "ambiguous",
                candidate_stop_ids: candidates,
            };
        }
    }

    return {
        sequence: options.station.sequence,
        station_name_en: stationNameEn,
        station_name_my: stationNameMy,
        matched_stop_id: null,
        matched_stop_public_id: null,
        match_method: "unmatched",
        match_score: MATCH_SCORE.unmatched,
        match_confidence: "none",
        candidate_stop_ids: [],
    };
}

export function matchTrainRoute(options: {
    route: NormalizedTrainRoute;
    catalog: StopCatalog;
    manualOverrides: Map<string, number>;
}): TrainRouteAutoMatch {
    const warnings = [...(options.route.status.warnings ?? [])];
    if (options.route.status.normalization_status !== "ready_for_station_match") {
        warnings.push("NORMALIZATION_NOT_READY");
    }

    const stations = options.route.stations.map((station) =>
        matchTrainStation({
            catalog: options.catalog,
            station,
            variantCode: options.route.variant.variant_code,
            manualOverrides: options.manualOverrides,
        }),
    );

    const matched_count = stations.filter((row) => row.matched_stop_id !== null).length;
    const ambiguous_count = stations.filter((row) => row.match_method === "ambiguous").length;
    const unmatched_count = stations.filter((row) => row.match_method === "unmatched").length;

    const route_quality_status: TrainRouteMatchQuality =
        matched_count === stations.length &&
        ambiguous_count === 0 &&
        unmatched_count === 0 &&
        options.route.status.normalization_status === "ready_for_station_match"
            ? "ready_for_import"
            : "needs_station_match_review";

    return {
        variant_code: options.route.variant.variant_code,
        route_code: options.route.route.route_code,
        train_number: options.route.route.train_number,
        direction_code: options.route.variant.direction_code,
        route_quality_status,
        matched_count,
        unmatched_count,
        ambiguous_count,
        stations,
        warnings,
    };
}

export function runTrainStationMatcherSelfTest(): void {
    const catalog = buildTrainStopCatalog([
        {
            stop_id: 1,
            public_id: "stop-yangon",
            stop_code: "YG",
            name: "Yangon",
            name_mm: "ရန်ကုန်",
            name_en: "Yangon Railway Station",
            stop_type: "station",
            has_geom: true,
        },
        {
            stop_id: 2,
            public_id: "stop-npt",
            stop_code: "NPT",
            name: "နေပြည်တော်",
            name_mm: "နေပြည်တော်",
            name_en: "Naypyitaw",
            stop_type: "station",
            has_geom: true,
        },
        {
            stop_id: 3,
            public_id: "stop-yangon-dup",
            stop_code: "YG2",
            name: "ရန်ကုန်",
            name_mm: "ရန်ကုန်",
            name_en: "Yangon",
            stop_type: "station",
            has_geom: true,
        },
    ]);

    const exactEn = matchTrainStation({
        catalog,
        manualOverrides: new Map(),
        variantCode: "TRAIN-11-UP",
        station: { sequence: 1, station_name_en: "Yangon Railway Station", station_name_my: null },
    });
    if (exactEn.match_method !== "exact_name_en" || exactEn.matched_stop_id !== 1) {
        throw new Error("exact English match failed");
    }

    const normMy = matchTrainStation({
        catalog,
        manualOverrides: new Map(),
        variantCode: "TRAIN-11-UP",
        station: { sequence: 2, station_name_en: null, station_name_my: "နေပြည်တော်ဘူတာ" },
    });
    if (normMy.match_method !== "normalized_name_my" || normMy.matched_stop_id !== 2) {
        throw new Error("normalized Myanmar match failed");
    }

    const ambiguous = matchTrainStation({
        catalog,
        manualOverrides: new Map(),
        variantCode: "TRAIN-11-UP",
        station: { sequence: 3, station_name_en: null, station_name_my: "ရန်ကုန်" },
    });
    // Near-duplicate names auto-pick the lowest stop id for shared reuse.
    if (ambiguous.matched_stop_id !== 1 && ambiguous.matched_stop_id !== 3) {
        throw new Error(`expected auto-picked Yangon stop, got ${ambiguous.matched_stop_id}`);
    }

    const override = matchTrainStation({
        catalog,
        manualOverrides: new Map([["TRAIN-11-UP::4", 2]]),
        variantCode: "TRAIN-11-UP",
        station: { sequence: 4, station_name_en: "Unknown", station_name_my: null },
    });
    if (override.match_method !== "manual_override" || override.matched_stop_id !== 2) {
        throw new Error("manual override failed");
    }

    console.log("ok - train-station-matcher self-test");
}
