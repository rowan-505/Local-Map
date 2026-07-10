#!/usr/bin/env npx tsx
/**
 * Stage 6: merge English + Myanmar raw train route files.
 *
 * Input:  tmp/train-import/raw/en/routes/*.json
 *         tmp/train-import/raw/my/routes/*.json
 * Output: tmp/train-import/merged/{variant_code}.json
 *
 * No database access. No translation.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import {
    defaultRunPaths,
    ensureRunLayout,
    mergedDir,
    mergedRoutePathByVariantCode,
    rawRoutesDir,
    reportPath,
    type TrainRunPaths,
} from "../lib/paths.js";
import type {
    DirectionCode,
    MergeStatus,
    MergedTrainRoute,
    MergedTrainStation,
    RawTrainRouteDetail,
    RawTrainStationRow,
} from "../lib/types.js";
import { TRAIN_MERGED_SCHEMA_VERSION } from "../lib/types.js";
import {
    directionTextFromCode,
    myanmarDirectionLabel,
    translateOperationTextToEnglish,
} from "../lib/yrsmm-web.js";

const WARNING_STATION_COUNT_MISMATCH = "STATION_COUNT_MISMATCH";
const WARNING_SOURCE_TIME_MISMATCH = "SOURCE_TIME_MISMATCH";
const WARNING_MISSING_ENGLISH = "MISSING_ENGLISH_ROUTE";
const WARNING_MISSING_MYANMAR = "MISSING_MYANMAR_ROUTE";

export type MergeLanguageRoutesResult = {
    written: string[];
    skipped: string[];
    summary: {
        merged: number;
        needs_manual_fix: number;
        blocked_missing_language: number;
    };
};

export function normalizeTrainNumber(trainNumber: string): string {
    return trainNumber.trim().replace(/\s+/g, " ");
}

export function mapDirectionCode(directionText: string): DirectionCode {
    const trimmed = directionText.trim();
    const lower = trimmed.toLowerCase();
    if (/^up$/i.test(trimmed) || trimmed === "အဆန်") {
        return "UP";
    }
    if (/^down$/i.test(trimmed) || trimmed === "အစုန်") {
        return "DOWN";
    }
    if (lower === "clockwise" || trimmed === "လက်ယာရစ်") {
        return "CLOCKWISE";
    }
    if (lower === "anticlockwise" || trimmed === "လက်ဝဲရစ်") {
        return "ANTICLOCKWISE";
    }
    return "UNKNOWN";
}

export function buildRouteCode(trainNumber: string): string {
    return `TRAIN-${normalizeTrainNumber(trainNumber)}`;
}

export function buildVariantCode(trainNumber: string, directionCode: DirectionCode): string {
    return `${buildRouteCode(trainNumber)}-${directionCode}`;
}

export function parseVariantCode(
    variantCode: string,
): { trainNumber: string; directionCode: DirectionCode } {
    const match = variantCode.trim().match(/^TRAIN-(.+)-(UP|DOWN|CLOCKWISE|ANTICLOCKWISE|UNKNOWN)$/i);
    if (!match?.[1] || !match[2]) {
        throw new Error(`Invalid variant code: ${variantCode}`);
    }

    return {
        trainNumber: normalizeTrainNumber(match[1]),
        directionCode: match[2].toUpperCase() as DirectionCode,
    };
}

function detailDirectionText(detail: RawTrainRouteDetail): string {
    return (detail.direction_text ?? detail.direction ?? "").trim();
}

function detailStationName(row: RawTrainStationRow | undefined): string | null {
    if (!row) {
        return null;
    }
    return trimToNull(row.name ?? row.station_name_raw);
}

export function routeIdentityKey(detail: RawTrainRouteDetail): string {
    return detail.variant_code.trim().toUpperCase();
}

function trimToNull(value: string | null | undefined): string | null {
    if (value == null) {
        return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

function normalizeComparableTimeText(value: string): string {
    return value.trim().replace(/\s+/g, " ").toUpperCase();
}

export function buildSourceTimeText(row: RawTrainStationRow): string | null {
    const direct = trimToNull(row.time_text ?? null);
    if (direct) {
        return direct;
    }

    const parts = [row.arrival_time_raw, row.departure_time_raw]
        .map((part) => trimToNull(part))
        .filter((part): part is string => part !== null);

    if (parts.length > 0) {
        return parts.join(" / ");
    }

    return trimToNull(row.raw_row_text);
}

function indexRoutesByIdentity(
    routes: RawTrainRouteDetail[],
): Map<string, RawTrainRouteDetail> {
    const map = new Map<string, RawTrainRouteDetail>();

    for (const route of routes) {
        const key = routeIdentityKey(route);
        if (!map.has(key)) {
            map.set(key, route);
        }
    }

    return map;
}

function mergeStationRows(
    english: RawTrainRouteDetail | null,
    myanmar: RawTrainRouteDetail | null,
    warnings: string[],
): MergedTrainStation[] {
    const enBySequence = new Map(
        (english?.stations ?? []).map((station) => [station.sequence, station]),
    );
    const myBySequence = new Map(
        (myanmar?.stations ?? []).map((station) => [station.sequence, station]),
    );

    const sequences = [...new Set([...enBySequence.keys(), ...myBySequence.keys()])].sort(
        (a, b) => a - b,
    );

    return sequences.map((sequence) => {
        const enRow = enBySequence.get(sequence);
        const myRow = myBySequence.get(sequence);

        const enTime = enRow ? buildSourceTimeText(enRow) : null;
        const myTime = myRow ? buildSourceTimeText(myRow) : null;

        let sourceTimeText: string | null = enTime ?? myTime;

        if (
            enTime &&
            myTime &&
            normalizeComparableTimeText(enTime) !== normalizeComparableTimeText(myTime)
        ) {
            sourceTimeText = enTime;
            warnings.push(`${WARNING_SOURCE_TIME_MISMATCH}:seq=${sequence}`);
        }

        return {
            sequence,
            name_en: detailStationName(enRow),
            name_my: detailStationName(myRow),
            source_time_text: sourceTimeText,
        };
    });
}

function pickTravelingTimeText(
    english: RawTrainRouteDetail | null,
    myanmar: RawTrainRouteDetail | null,
): string | null {
    return (
        trimToNull(english?.traveling_time_text) ??
        trimToNull(myanmar?.traveling_time_text) ??
        trimToNull(english?.travel_duration_raw) ??
        trimToNull(myanmar?.travel_duration_raw)
    );
}

function pickTrainModel(
    english: RawTrainRouteDetail | null,
    myanmar: RawTrainRouteDetail | null,
): string | null {
    return (
        trimToNull(english?.train_model) ??
        trimToNull(myanmar?.train_model) ??
        trimToNull(english?.train_model_raw) ??
        trimToNull(myanmar?.train_model_raw)
    );
}

function pickOriginName(detail: RawTrainRouteDetail | null): string | null {
    if (!detail) {
        return null;
    }
    return trimToNull(detail.origin?.name) ?? trimToNull(detail.origin_raw);
}

function pickOperationTextEn(detail: RawTrainRouteDetail | null): string | null {
    if (!detail) {
        return null;
    }
    const direct = trimToNull(detail.operation_text);
    if (direct) {
        return direct;
    }
    return trimToNull(translateOperationTextToEnglish(detail.operation_day_raw ?? ""));
}

function pickOperationTextMy(detail: RawTrainRouteDetail | null): string | null {
    if (!detail) {
        return null;
    }
    return trimToNull(detail.operation_text ?? detail.operation_day_raw);
}

function pickDirectionNameEn(detail: RawTrainRouteDetail | null): string | null {
    if (!detail) {
        return null;
    }
    const parsed = parseVariantCode(detail.variant_code);
    const fromCode = directionTextFromCode(parsed.directionCode);
    if (fromCode) {
        return fromCode;
    }
    return trimToNull(detailDirectionText(detail));
}

function pickDirectionNameMy(detail: RawTrainRouteDetail | null): string | null {
    if (!detail) {
        return null;
    }
    const parsed = parseVariantCode(detail.variant_code);
    const fromCode = myanmarDirectionLabel(parsed.directionCode);
    if (fromCode) {
        return fromCode;
    }
    return trimToNull(detailDirectionText(detail));
}

function removeStaleJsonFiles(dir: string, keepPaths: Set<string>): number {
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

function pickDestinationName(detail: RawTrainRouteDetail | null): string | null {
    if (!detail) {
        return null;
    }
    return trimToNull(detail.destination?.name) ?? trimToNull(detail.destination_raw);
}

export function mergeRoutePair(
    english: RawTrainRouteDetail | null,
    myanmar: RawTrainRouteDetail | null,
): MergedTrainRoute {
    const warnings: string[] = [];
    const anchor = english ?? myanmar;

    if (!anchor) {
        throw new Error("mergeRoutePair requires at least one language route");
    }

    const parsedVariant = parseVariantCode(anchor.variant_code);
    const trainNumber = parsedVariant.trainNumber;
    const directionCode = parsedVariant.directionCode;
    const routeCode = buildRouteCode(trainNumber);
    const variantCode = anchor.variant_code.trim().toUpperCase();

    let mergeStatus: MergeStatus = "merged";

    if (!english || !myanmar) {
        mergeStatus = "blocked_missing_language";
        warnings.push(english ? WARNING_MISSING_MYANMAR : WARNING_MISSING_ENGLISH);
    } else if (english.variant_code.trim().toUpperCase() !== myanmar.variant_code.trim().toUpperCase()) {
        mergeStatus = "needs_manual_fix";
        warnings.push("VARIANT_CODE_MISMATCH");
    } else if (english.stations.length !== myanmar.stations.length) {
        mergeStatus = "needs_manual_fix";
        warnings.push(WARNING_STATION_COUNT_MISMATCH);
    }

    const stations = mergeStationRows(english, myanmar, warnings);

    return {
        schema_version: TRAIN_MERGED_SCHEMA_VERSION,
        merged_at: new Date().toISOString(),
        route_code: routeCode,
        variant_code: variantCode,
        train_number: trainNumber,
        direction_code: directionCode,
        direction_name_en: pickDirectionNameEn(english),
        direction_name_my: pickDirectionNameMy(myanmar),
        origin_name_en: pickOriginName(english),
        origin_name_my: pickOriginName(myanmar),
        destination_name_en: pickDestinationName(english),
        destination_name_my: pickDestinationName(myanmar),
        type_en: trimToNull(english?.type ?? english?.train_type_raw),
        type_my: trimToNull(myanmar?.type ?? myanmar?.train_type_raw),
        way_en: trimToNull(english?.way ?? english?.way_raw),
        way_my: trimToNull(myanmar?.way ?? myanmar?.way_raw),
        train_model: pickTrainModel(english, myanmar),
        operation_text_en: pickOperationTextEn(english),
        operation_text_my: pickOperationTextMy(myanmar),
        source_start_time_text: stations[0]?.source_time_text ?? null,
        source_end_time_text: stations[stations.length - 1]?.source_time_text ?? null,
        total_stations: stations.length,
        traveling_time_text: pickTravelingTimeText(english, myanmar),
        stations,
        warnings,
        merge_status: mergeStatus,
    };
}

function loadRouteFiles(dir: string): RawTrainRouteDetail[] {
    if (!fs.existsSync(dir)) {
        return [];
    }

    return fs
        .readdirSync(dir)
        .filter((name) => name.endsWith(".json"))
        .sort()
        .map((name) => {
            const filePath = path.join(dir, name);
            return JSON.parse(fs.readFileSync(filePath, "utf8")) as RawTrainRouteDetail;
        });
}

export function mergeLanguageRoutes(paths: TrainRunPaths): MergeLanguageRoutesResult {
    ensureRunLayout(paths);

    const englishRoutes = loadRouteFiles(rawRoutesDir(paths, "en"));
    const myanmarRoutes = loadRouteFiles(rawRoutesDir(paths, "my"));

    const englishByIdentity = indexRoutesByIdentity(englishRoutes);
    const myanmarByIdentity = indexRoutesByIdentity(myanmarRoutes);

    const identities = new Set<string>([
        ...englishByIdentity.keys(),
        ...myanmarByIdentity.keys(),
    ]);

    const written: string[] = [];
    const skipped: string[] = [];
    const summary = {
        merged: 0,
        needs_manual_fix: 0,
        blocked_missing_language: 0,
    };

    const mergedOutputs: MergedTrainRoute[] = [];

    for (const identity of [...identities].sort()) {
        const english = englishByIdentity.get(identity) ?? null;
        const myanmar = myanmarByIdentity.get(identity) ?? null;

        if (!english && !myanmar) {
            skipped.push(identity);
            continue;
        }

        const merged = mergeRoutePair(english, myanmar);

        if (merged.merge_status === "blocked_missing_language") {
            summary.blocked_missing_language += 1;
            skipped.push(identity);
            continue;
        }

        const outputPath = mergedRoutePathByVariantCode(paths, merged.variant_code);

        fs.mkdirSync(mergedDir(paths), { recursive: true });
        fs.writeFileSync(outputPath, `${JSON.stringify(merged, null, 2)}\n`, "utf8");

        written.push(outputPath);
        mergedOutputs.push(merged);

        if (merged.merge_status === "merged") {
            summary.merged += 1;
        } else {
            summary.needs_manual_fix += 1;
        }
    }

    const removedStale = removeStaleJsonFiles(mergedDir(paths), new Set(written));
    if (removedStale > 0) {
        console.log(`Removed ${removedStale} stale merged file(s).`);
    }

    const report = {
        generated_at: new Date().toISOString(),
        written_count: written.length,
        skipped_count: skipped.length,
        removed_stale_count: removedStale,
        summary,
        written,
        skipped,
        routes: mergedOutputs.map((route) => ({
            variant_code: route.variant_code,
            merge_status: route.merge_status,
            warning_count: route.warnings.length,
        })),
    };

    fs.writeFileSync(
        reportPath(paths, "merge-language-routes.json"),
        `${JSON.stringify(report, null, 2)}\n`,
        "utf8",
    );

    return { written, skipped, summary };
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
    const english: RawTrainRouteDetail = {
        schema_version: 1,
        language: "en",
        extracted_at: "2026-07-09T00:00:00.000Z",
        variant_code: "TRAIN-11-UP",
        train_number: "11",
        direction_text: "Up",
        direction: "Up",
        route_title: "Yangon - Mandalay Express",
        route_subtitle: null,
        operation_text: "Daily",
        origin: { name: "Yangon", time_text: "05:00 AM" },
        destination: { name: "Mandalay", time_text: "06:30 PM" },
        type: "Express",
        way: "Main Line",
        train_model: "DF/3000",
        total_stations_text: "2",
        traveling_time_text: "13 hr 30 min",
        schedule_complete_marker_seen: true,
        stations: [
            {
                sequence: 1,
                name: "Yangon",
                time_text: "05:00 AM",
                departure_time_raw: "05:00 AM",
            },
            {
                sequence: 2,
                name: "Naypyitaw",
                time_text: "09:00 AM / 09:10 AM",
                arrival_time_raw: "09:00 AM",
                departure_time_raw: "09:10 AM",
            },
        ],
    };

    const myanmar: RawTrainRouteDetail = {
        schema_version: 1,
        language: "my",
        extracted_at: "2026-07-09T00:00:00.000Z",
        variant_code: "TRAIN-11-UP",
        train_number: "11",
        direction_text: "အဆန်",
        direction: "အဆန်",
        route_title: null,
        route_subtitle: null,
        operation_text: "နေ့စဉ်",
        origin: { name: "ရန်ကုန်", time_text: "05:00 AM" },
        destination: { name: "မန္တလေး", time_text: null },
        type: "အမြန်ရထား",
        way: null,
        train_model: null,
        total_stations_text: null,
        traveling_time_text: "၁၃ နာရီ ၃၀ မိနစ်",
        schedule_complete_marker_seen: true,
        stations: [
            {
                sequence: 1,
                name: "ရန်ကုန်",
                time_text: "05:00 AM",
                departure_time_raw: "05:00 AM",
            },
            {
                sequence: 2,
                name: "နေပြည်တော်",
                time_text: "09:05 AM / 09:10 AM",
                arrival_time_raw: "09:05 AM",
                departure_time_raw: "09:10 AM",
            },
            {
                sequence: 3,
                name: "တပ်ကုန်း",
                time_text: "11:00 AM",
                arrival_time_raw: "11:00 AM",
            },
        ],
    };

    const merged = mergeRoutePair(english, myanmar);

    if (merged.variant_code !== "TRAIN-11-UP") {
        throw new Error(`variant_code mismatch: ${merged.variant_code}`);
    }
    if (merged.merge_status !== "needs_manual_fix") {
        throw new Error(`expected needs_manual_fix, got ${merged.merge_status}`);
    }
    if (!merged.warnings.includes(WARNING_STATION_COUNT_MISMATCH)) {
        throw new Error("expected station count warning");
    }
    if (!merged.warnings.some((w) => w.startsWith(WARNING_SOURCE_TIME_MISMATCH))) {
        throw new Error("expected source time mismatch warning");
    }
    if (merged.stations[1]?.source_time_text !== "09:00 AM / 09:10 AM") {
        throw new Error("expected English source time to win");
    }
    if (merged.stations[1]?.name_en !== "Naypyitaw") {
        throw new Error("expected English station name");
    }
    if (merged.stations[1]?.name_my !== "နေပြည်တော်") {
        throw new Error("expected Myanmar station name");
    }

    console.log("ok - mergeRoutePair self-test");
}

function main(): void {
    if (process.argv.includes("--self-test")) {
        runSelfTest();
        return;
    }

    const paths = parseCliArgs(process.argv.slice(2));
    const result = mergeLanguageRoutes(paths);

    console.log(
        `Wrote ${result.written.length} merged route file(s) to ${mergedDir(paths)}`,
    );
    console.log(
        `merged=${result.summary.merged} needs_manual_fix=${result.summary.needs_manual_fix} blocked_missing_language=${result.summary.blocked_missing_language}`,
    );
}

const isCliEntry = process.argv[1]?.includes("merge-language-routes.ts");

if (isCliEntry) {
    main();
}
