#!/usr/bin/env npx tsx
/**
 * Stage 7: normalize merged train routes to DB-compatible fields.
 *
 * Input:  tmp/train-import/merged/*.json
 * Output: tmp/train-import/normalized/{variant_code}.json
 *
 * Normalizes only important DB-compatible data. Ignores long passage text
 * (except operation day), price text, and images/Favorite/Share content.
 * No database access. No translation.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import {
    defaultRunPaths,
    ensureRunLayout,
    mergedDir,
    normalizedDir,
    reportPath,
    type TrainRunPaths,
} from "../lib/paths.js";
import { buildPublicName, buildPublicNameMy } from "../lib/route-display-names.js";
import { calculateTrainOffsets, parseDurationToMinutes } from "../lib/time.js";
import type {
    DirectionCode,
    DirectionId,
    MergedTrainRoute,
    NormalizationStatus,
    NormalizedTrainRoute,
    NormalizedTrainStation,
    TrainTypeCode,
} from "../lib/types.js";
import {
    TRAIN_NORMALIZED_SCHEMA_VERSION,
    TRAIN_SOURCE_KIND,
    TRAIN_SOURCE_NAME,
} from "../lib/types.js";

const WARNING_STATION_COUNT_MISMATCH = "STATION_COUNT_MISMATCH";
const WARNING_TIMING_PARSE_FAILED = "TIMING_PARSE_FAILED";
const WARNING_NO_STATIONS = "NO_STATIONS";

export type NormalizeTrainRoutesResult = {
    written: string[];
    summary: {
        ready_for_station_match: number;
        needs_manual_fix: number;
    };
};

function trimToNull(value: string | null | undefined): string | null {
    if (value == null) {
        return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

export function directionIdFromCode(directionCode: DirectionCode): DirectionId {
    if (directionCode === "UP") {
        return 0;
    }
    if (directionCode === "DOWN") {
        return 1;
    }
    return null;
}

export function normalizeTrainType(typeText: string | null | undefined): TrainTypeCode {
    const text = (typeText ?? "").toLowerCase();
    if (text.includes("mail")) {
        return "mail";
    }
    if (text.includes("express")) {
        return "express";
    }
    if (text.includes("local")) {
        return "local";
    }
    if (text.includes("urban")) {
        return "urban";
    }
    if (text.includes("demu")) {
        return "demu";
    }
    return "unknown";
}

/**
 * Normalize operation day from visible text (English or Myanmar).
 * Only a small deterministic set is recognized in v1.
 */
export function normalizeOperationDays(
    textEn: string | null | undefined,
    textMy: string | null | undefined,
): string[] {
    const combined = `${textEn ?? ""} ${textMy ?? ""}`.toLowerCase();

    if (/every\s*friday/.test(combined)) {
        return ["friday"];
    }
    if (
        combined.includes("daily") ||
        combined.includes("everyday") ||
        combined.includes("every day") ||
        combined.includes("နေ့စဉ်")
    ) {
        return ["daily"];
    }
    return [];
}

export { buildPublicName, buildPublicNameMy };

function normalizeStations(
    merged: MergedTrainRoute,
): { stations: NormalizedTrainStation[]; timingParseFailed: boolean } {
    const offsets = calculateTrainOffsets(
        merged.stations.map((station) => ({
            sequence: station.sequence,
            source_time_text: station.source_time_text,
        })),
    );

    const offsetBySequence = new Map(offsets.map((row) => [row.sequence, row]));

    let timingParseFailed = false;

    const stations = merged.stations
        .slice()
        .sort((a, b) => a.sequence - b.sequence)
        .map((station) => {
            const offset = offsetBySequence.get(station.sequence);
            const sourceTimeText = trimToNull(station.source_time_text);

            const arrivalOffset = offset?.arrival_offset_seconds ?? null;
            const departureOffset = offset?.departure_offset_seconds ?? null;

            // A station that shows time text but yields no usable offset is a parse failure.
            if (sourceTimeText && arrivalOffset === null && departureOffset === null) {
                timingParseFailed = true;
            }

            return {
                sequence: station.sequence,
                station_name_en: trimToNull(station.name_en),
                station_name_my: trimToNull(station.name_my),
                travel_time_from_previous_seconds:
                    offset?.travel_time_from_previous_seconds ?? null,
                arrival_offset_seconds: arrivalOffset,
                departure_offset_seconds: departureOffset,
                source_time_text: sourceTimeText,
                source_time_type: offset?.source_time_type ?? "unknown",
            } satisfies NormalizedTrainStation;
        });

    return { stations, timingParseFailed };
}

export function normalizeMergedRoute(merged: MergedTrainRoute): NormalizedTrainRoute {
    const warnings: string[] = [];

    const originEn = trimToNull(merged.origin_name_en);
    const originMy = trimToNull(merged.origin_name_my);
    const destinationEn = trimToNull(merged.destination_name_en);
    const destinationMy = trimToNull(merged.destination_name_my);

    const { stations, timingParseFailed } = normalizeStations(merged);

    const durationMinutes = parseDurationToMinutes(merged.traveling_time_text ?? "");
    const travelDurationSeconds =
        durationMinutes === null ? null : durationMinutes * 60;

    if (stations.length === 0) {
        warnings.push(WARNING_NO_STATIONS);
    }

    // Rule: declared total station count must match actual station rows.
    if (merged.total_stations !== stations.length) {
        warnings.push(WARNING_STATION_COUNT_MISMATCH);
    }

    if (timingParseFailed) {
        warnings.push(WARNING_TIMING_PARSE_FAILED);
    }

    const status: NormalizationStatus =
        warnings.length === 0 ? "ready_for_station_match" : "needs_manual_fix";

    return {
        schema_version: TRAIN_NORMALIZED_SCHEMA_VERSION,
        normalized_at: new Date().toISOString(),
        route: {
            route_code: merged.route_code,
            mode: "train",
            route_kind: "rail",
            public_name: buildPublicName(
                merged.train_number,
                originEn ?? originMy,
                destinationEn ?? destinationMy,
            ),
            public_name_my: buildPublicNameMy(
                merged.train_number,
                originMy ?? originEn,
                destinationMy ?? destinationEn,
            ),
            train_number: merged.train_number,
            origin_name_en: originEn,
            origin_name_my: originMy,
            destination_name_en: destinationEn,
            destination_name_my: destinationMy,
            train_type: normalizeTrainType(merged.type_en ?? merged.type_my),
            train_type_raw: trimToNull(merged.type_en ?? merged.type_my),
            train_model: trimToNull(merged.train_model),
            operation_days: normalizeOperationDays(
                merged.operation_text_en,
                merged.operation_text_my,
            ),
            operation_text_en: trimToNull(merged.operation_text_en),
            operation_text_my: trimToNull(merged.operation_text_my),
        },
        variant: {
            variant_code: merged.variant_code,
            direction_code: merged.direction_code,
            direction_id: directionIdFromCode(merged.direction_code),
            direction_name_en: trimToNull(merged.direction_name_en),
            direction_name_my: trimToNull(merged.direction_name_my),
            total_stations: stations.length,
            traveling_time_text: trimToNull(merged.traveling_time_text),
            travel_duration_seconds: travelDurationSeconds,
        },
        stations,
        status: {
            normalization_status: status,
            warnings,
        },
        source: {
            source_name: TRAIN_SOURCE_NAME,
            source_kind: TRAIN_SOURCE_KIND,
            merged_at: merged.merged_at ?? null,
        },
    };
}

function loadMergedRoutes(dir: string): { fileName: string; route: MergedTrainRoute }[] {
    if (!fs.existsSync(dir)) {
        return [];
    }

    return fs
        .readdirSync(dir)
        .filter((name) => name.endsWith(".json"))
        .sort()
        .map((fileName) => ({
            fileName,
            route: JSON.parse(
                fs.readFileSync(path.join(dir, fileName), "utf8"),
            ) as MergedTrainRoute,
        }));
}

export function normalizeTrainRoutes(paths: TrainRunPaths): NormalizeTrainRoutesResult {
    ensureRunLayout(paths);

    const merged = loadMergedRoutes(mergedDir(paths)).filter(
        ({ route }) => route.merge_status === "merged",
    );

    const written: string[] = [];
    const summary = {
        ready_for_station_match: 0,
        needs_manual_fix: 0,
        skipped_non_merged: 0,
    };

    const normalizedOutputs: NormalizedTrainRoute[] = [];
    const skippedNonMerged =
        loadMergedRoutes(mergedDir(paths)).length - merged.length;
    summary.skipped_non_merged = skippedNonMerged;

    for (const { route } of merged) {
        const normalized = normalizeMergedRoute(route);
        const outputPath = path.join(
            normalizedDir(paths),
            `${normalized.variant.variant_code}.json`,
        );

        fs.mkdirSync(normalizedDir(paths), { recursive: true });
        fs.writeFileSync(outputPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");

        written.push(outputPath);
        normalizedOutputs.push(normalized);

        if (normalized.status.normalization_status === "ready_for_station_match") {
            summary.ready_for_station_match += 1;
        } else {
            summary.needs_manual_fix += 1;
        }
    }

    const report = {
        generated_at: new Date().toISOString(),
        written_count: written.length,
        summary,
        routes: normalizedOutputs.map((route) => ({
            variant_code: route.variant.variant_code,
            normalization_status: route.status.normalization_status,
            warnings: route.status.warnings,
        })),
    };

    const removedStale = removeStaleNormalizedFiles(normalizedDir(paths), new Set(written));
    if (removedStale > 0) {
        console.log(`Removed ${removedStale} stale normalized file(s).`);
    }

    const reportWithCleanup = {
        ...report,
        removed_stale_count: removedStale,
    };

    fs.writeFileSync(
        reportPath(paths, "normalize-train-routes.json"),
        `${JSON.stringify(reportWithCleanup, null, 2)}\n`,
        "utf8",
    );

    return { written, summary };
}

function removeStaleNormalizedFiles(dir: string, keepPaths: Set<string>): number {
    if (!fs.existsSync(dir)) {
        return 0;
    }

    let removed = 0;
    for (const name of fs.readdirSync(dir)) {
        if (!name.endsWith(".json")) {
            continue;
        }
        const fullPath = path.join(dir, name);
        if (!keepPaths.has(fullPath)) {
            fs.unlinkSync(fullPath);
            removed += 1;
        }
    }
    return removed;
}

function parseCliArgs(argv: string[]): TrainRunPaths {
    let runRoot = defaultRunPaths().runRoot;

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        const next = argv[i + 1];
        if ((arg === "--run" || arg === "--run-root") && next) {
            runRoot = defaultRunPaths(next.trim()).runRoot;
            i++;
        }
    }

    return { runRoot };
}

function runSelfTest(): void {
    const merged: MergedTrainRoute = {
        schema_version: 1,
        merged_at: "2026-07-09T00:00:00.000Z",
        route_code: "TRAIN-11",
        variant_code: "TRAIN-11-UP",
        train_number: "11",
        direction_code: "UP",
        direction_name_en: "Up",
        direction_name_my: "အဆန်",
        origin_name_en: "Yangon",
        origin_name_my: "ရန်ကုန်",
        destination_name_en: "Mandalay",
        destination_name_my: "မန္တလေး",
        type_en: "Express",
        type_my: "အမြန်ရထား",
        train_model: "AAR",
        operation_text_en: "Daily",
        operation_text_my: "နေ့စဉ်",
        total_stations: 3,
        traveling_time_text: "13 hr 30 min",
        stations: [
            { sequence: 1, name_en: "Yangon", name_my: "ရန်ကုန်", source_time_text: "05:00 AM" },
            {
                sequence: 2,
                name_en: "Naypyitaw",
                name_my: "နေပြည်တော်",
                source_time_text: "09:00 AM / 09:10 AM",
            },
            {
                sequence: 3,
                name_en: "Mandalay",
                name_my: "မန္တလေး",
                source_time_text: "06:30 PM",
            },
        ],
        warnings: [],
        merge_status: "merged",
    };

    const normalized = normalizeMergedRoute(merged);

    if (normalized.route.public_name !== "Train 11 · Yangon ↔ Mandalay") {
        throw new Error(`public_name mismatch: ${normalized.route.public_name}`);
    }
    if (normalized.route.public_name_my !== "ရထား ၁၁ · ရန်ကုန် ↔ မန္တလေး") {
        throw new Error(`public_name_my mismatch: ${normalized.route.public_name_my}`);
    }
    if (normalized.route.mode !== "train" || normalized.route.route_kind !== "rail") {
        throw new Error("mode/route_kind mismatch");
    }
    if (normalized.route.train_type !== "express") {
        throw new Error(`train_type mismatch: ${normalized.route.train_type}`);
    }
    if (JSON.stringify(normalized.route.operation_days) !== JSON.stringify(["daily"])) {
        throw new Error(`operation_days mismatch: ${normalized.route.operation_days}`);
    }
    if (normalized.variant.direction_id !== 0) {
        throw new Error("direction_id mismatch");
    }
    if (normalized.variant.travel_duration_seconds !== (13 * 60 + 30) * 60) {
        throw new Error("travel_duration_seconds mismatch");
    }
    if (normalized.stations[0]?.departure_offset_seconds !== 0) {
        throw new Error("origin departure offset mismatch");
    }
    if (normalized.status.normalization_status !== "ready_for_station_match") {
        throw new Error(`status mismatch: ${normalized.status.normalization_status}`);
    }

    // Count mismatch → needs_manual_fix
    const badCount = normalizeMergedRoute({ ...merged, total_stations: 99 });
    if (badCount.status.normalization_status !== "needs_manual_fix") {
        throw new Error("expected needs_manual_fix on count mismatch");
    }
    if (!badCount.status.warnings.includes(WARNING_STATION_COUNT_MISMATCH)) {
        throw new Error("expected station count warning");
    }

    // Friday operation
    const friday = normalizeMergedRoute({
        ...merged,
        operation_text_en: "Every Friday",
        operation_text_my: null,
    });
    if (JSON.stringify(friday.route.operation_days) !== JSON.stringify(["friday"])) {
        throw new Error("expected friday operation day");
    }

    console.log("ok - normalizeMergedRoute self-test");
}

function main(): void {
    if (process.argv.includes("--self-test")) {
        runSelfTest();
        return;
    }

    const paths = parseCliArgs(process.argv.slice(2));
    const result = normalizeTrainRoutes(paths);

    console.log(
        `Wrote ${result.written.length} normalized route file(s) to ${normalizedDir(paths)}`,
    );
    console.log(
        `ready_for_station_match=${result.summary.ready_for_station_match} needs_manual_fix=${result.summary.needs_manual_fix}`,
    );
}

const isCliEntry = process.argv[1]?.includes("normalize-train-routes.ts");

if (isCliEntry) {
    main();
}
