/**
 * Merge Myanmar and English route extraction files into one import-ready JSON file.
 *
 * Does not touch the database.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import {
    defaultConfig,
    mergedRoutePath,
    reportsDir,
    resolveFromRepo,
    type YbsExtractionConfig,
} from "./config.js";
import { generateEnglishRouteNameFromVariants, isMyanmarText } from "./english-route-name.js";

export const MERGED_EXTRACTION_SCHEMA_VERSION = 3;

export const LANGUAGE_DIRECTION_STOP_COUNT_MISMATCH = "LANGUAGE_DIRECTION_STOP_COUNT_MISMATCH";

const MYANMAR_CHAR_PATTERN = /[\u1000-\u109F]/;
const MYANMAR_PLACEHOLDER_STOP_PATTERN = /မှတ်တိုင်\s+အမှတ်/;
const METADATA_STOP_TEXT_PATTERN = /^(?:Bus Details|Bus Stops|Stops|Share|View on Map|Company|Fare|Outbound|Inbound|All)$/i;
const ENGLISH_STOP_COUNT_PATTERN = /^\d+\s+Stops?$/i;
const ENGLISH_FARE_PATTERN = /^\d[\d,]*\s*Ks(?:\b|$)/i;
const MYANMAR_STOP_COUNT_PATTERN = /\d+\s*မှတ်တိုင်/;
const MYANMAR_FARE_PATTERN = /\d+\s*ကျပ်/;

const REQUIRED_DIRECTIONS = ["outbound", "inbound"] as const;

type DirectionKey = (typeof REQUIRED_DIRECTIONS)[number];

export type LanguageRouteStop = {
    sequence?: number;
    stop_name_my?: string | null;
    stop_name_en?: string | null;
    area_text_my?: string | null;
    area_text_en?: string | null;
    raw_text_my?: string | null;
    raw_text_en?: string | null;
    raw_text?: string;
};

export type LanguageRouteVariant = {
    direction_key?: string;
    direction_name?: string;
    detected_direction?: string;
    stop_count?: number;
    real_stop_count?: number;
    quality_status?: string;
    parser_diagnostics?: Record<string, unknown>;
    stops?: LanguageRouteStop[];
};

export type LanguageRouteFile = {
    extraction_schema_version?: number;
    source?: Record<string, unknown>;
    route?: Record<string, unknown>;
    route_index_identity?: Record<string, unknown> | null;
    route_detail_identity?: Record<string, unknown>;
    variants?: LanguageRouteVariant[];
    warnings?: string[];
    validation?: Record<string, unknown>;
    extraction?: Record<string, unknown>;
};

export type MergeLanguageRoutesOptions = {
    config?: Partial<YbsExtractionConfig>;
    myanmarPath: string;
    englishPath: string;
    outputPath?: string;
    diagnoseOnly?: boolean;
};

export type LanguageMergeDecision =
    | "safe_to_merge"
    | "blocked_count_mismatch"
    | "blocked_dirty_stops"
    | "warning_only";

export type LanguageMergeDiagnosis = {
    generated_at: string;
    route_code: string;
    input_paths: {
        myanmar: string;
        english: string;
    };
    checks: {
        route_code_match: boolean;
        route_number_match: boolean;
        direction_keys_match: boolean;
        myanmar_counts: Record<DirectionKey, number>;
        english_counts: Record<DirectionKey, number>;
        app_total_stop_count: {
            myanmar: number | null;
            english: number | null;
        };
        metadata_rows_found_in_stops: DirtyStopFinding[];
        placeholder_rows_found: DirtyStopFinding[];
        adjacent_exact_duplicates: AdjacentDuplicateFinding[];
        missing_route_index_identity: {
            myanmar: boolean;
            english: boolean;
        };
        missing_fare_operator: {
            myanmar_fare: boolean;
            english_fare: boolean;
            merged_fare: boolean;
            myanmar_operator: boolean;
            english_operator: boolean;
            merged_operator: boolean;
        };
    };
    directions: Record<DirectionKey, DirectionMergeDiagnosis>;
    overall_decision: LanguageMergeDecision;
    warnings: string[];
};

export type DirectionMergeDiagnosis = {
    direction_key: DirectionKey;
    myanmar_stop_count: number;
    english_stop_count: number;
    metadata_rows_found: DirtyStopFinding[];
    placeholder_rows_found: DirtyStopFinding[];
    adjacent_exact_duplicates: AdjacentDuplicateFinding[];
    decision: LanguageMergeDecision;
    warnings: string[];
};

export type DirtyStopFinding = {
    language: "my" | "en";
    direction_key: string;
    sequence: number | null;
    field: string;
    value: string;
    reason: string;
};

export type AdjacentDuplicateFinding = {
    language: "my" | "en";
    direction_key: string;
    first_sequence: number | null;
    second_sequence: number | null;
    stop_name: string;
    area_text: string;
};

export type MergedStopRow = {
    sequence: number;
    stop_name_my: string | null;
    stop_name_en: string | null;
    area_text_my: string | null;
    area_text_en: string | null;
    raw_text_my: string | null;
    raw_text_en: string | null;
    raw_text: string;
    area_text_en_script_status?: "mixed_script_from_source_app";
    merge_match_method: "direction_sequence";
    merge_confidence: 80;
};

export type MergedVariantRow = {
    direction_key: DirectionKey;
    direction_name: DirectionKey;
    detected_direction_myanmar: string | null;
    detected_direction_english: string | null;
    merge_status: "merged_by_sequence" | "blocked_count_mismatch";
    myanmar_stop_count: number;
    english_stop_count: number;
    merged_stop_count: number;
    stop_count: number;
    real_stop_count: number;
    myanmar_quality_status: string | null;
    english_quality_status: string | null;
    quality_status: "success" | "blocked";
    parser_diagnostics: {
        myanmar: Record<string, unknown> | null;
        english: Record<string, unknown> | null;
    };
    stops: MergedStopRow[];
};

function readJsonFile<T>(filePath: string): T {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw) as T;
}

function firstNonEmptyString(...values: unknown[]): string | null {
    for (const value of values) {
        if (typeof value === "string" && value.trim()) {
            return value.trim();
        }
    }
    return null;
}

function firstNonNullNumber(...values: unknown[]): number | null {
    for (const value of values) {
        if (typeof value === "number" && Number.isFinite(value)) {
            return value;
        }
    }
    return null;
}

function routeCodeCandidates(file: LanguageRouteFile, filePath: string): string[] {
    return [
        file.route?.route_code_candidate,
        file.route?.route_code,
        path.basename(filePath, ".json"),
    ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);
}

function routeCodeValue(file: LanguageRouteFile, filePath: string): string | null {
    return routeCodeCandidates(file, filePath)[0]?.trim() ?? null;
}

function routeNumberValue(file: LanguageRouteFile): number | null {
    return firstNonNullNumber(
        file.route?.route_number,
        file.route_detail_identity?.route_number,
        file.route_index_identity?.route_number,
    );
}

function directionKeys(file: LanguageRouteFile): string[] {
    return [...new Set((file.variants ?? []).map((variant) => variant.direction_key).filter(Boolean))].sort() as string[];
}

function inferRouteCode(
    myanmar: LanguageRouteFile,
    english: LanguageRouteFile,
    myanmarPath: string,
    englishPath: string,
): string {
    const candidates = [
        myanmar.route?.route_code_candidate,
        english.route?.route_code_candidate,
        myanmar.route?.route_code,
        english.route?.route_code,
    ];

    for (const candidate of candidates) {
        if (typeof candidate === "string" && candidate.trim()) {
            return candidate.trim();
        }
    }

    const fromMy = path.basename(myanmarPath, ".json");
    const fromEn = path.basename(englishPath, ".json");
    if (fromMy === fromEn) {
        return fromMy;
    }

    return fromMy || fromEn || "YBS-UNKNOWN";
}

function findVariant(
    file: LanguageRouteFile,
    direction: DirectionKey,
): LanguageRouteVariant | undefined {
    return file.variants?.find(
        (variant) => variant.direction_key === direction || variant.direction_name === direction,
    );
}

function variantStopCount(variant: LanguageRouteVariant | undefined): number {
    if (!variant) {
        return 0;
    }

    if (typeof variant.real_stop_count === "number") {
        return variant.real_stop_count;
    }

    if (typeof variant.stop_count === "number") {
        return variant.stop_count;
    }

    return variant.stops?.length ?? 0;
}

function containsMyanmarScript(text: string | null | undefined): boolean {
    if (!text?.trim()) {
        return false;
    }

    return MYANMAR_CHAR_PATTERN.test(text);
}

function normalizedStopName(stop: LanguageRouteStop): string {
    return (stop.stop_name_my ?? stop.stop_name_en ?? "").trim();
}

function normalizedAreaText(stop: LanguageRouteStop): string {
    return (stop.area_text_my ?? stop.area_text_en ?? "").trim();
}

function isRouteTitleLike(text: string): boolean {
    return /^\([၀-၉\d]+\)\s/.test(text.trim());
}

function isMetadataStopText(text: string): boolean {
    const trimmed = text.trim();
    if (!trimmed) {
        return false;
    }
    return (
        METADATA_STOP_TEXT_PATTERN.test(trimmed) ||
        ENGLISH_STOP_COUNT_PATTERN.test(trimmed) ||
        ENGLISH_FARE_PATTERN.test(trimmed) ||
        MYANMAR_STOP_COUNT_PATTERN.test(trimmed) ||
        MYANMAR_FARE_PATTERN.test(trimmed) ||
        isRouteTitleLike(trimmed)
    );
}

function collectMetadataRows(
    file: LanguageRouteFile,
    language: "my" | "en",
    direction?: DirectionKey,
): DirtyStopFinding[] {
    const variants = direction ? [findVariant(file, direction)].filter(Boolean) : file.variants ?? [];
    const findings: DirtyStopFinding[] = [];

    for (const variant of variants) {
        const directionKey = variant?.direction_key ?? variant?.direction_name ?? "unknown";
        for (const stop of variant?.stops ?? []) {
            const fields = [
                ["stop_name_my", stop.stop_name_my],
                ["stop_name_en", stop.stop_name_en],
                ["area_text_my", stop.area_text_my],
                ["area_text_en", stop.area_text_en],
                ["raw_text_my", stop.raw_text_my],
                ["raw_text_en", stop.raw_text_en],
            ] as const;

            for (const [field, value] of fields) {
                if (typeof value !== "string" || !isMetadataStopText(value)) {
                    continue;
                }
                findings.push({
                    language,
                    direction_key: directionKey,
                    sequence: typeof stop.sequence === "number" ? stop.sequence : null,
                    field,
                    value,
                    reason: "metadata_text",
                });
            }
        }
    }

    return findings;
}

function collectPlaceholderRows(
    file: LanguageRouteFile,
    language: "my" | "en",
    direction?: DirectionKey,
): DirtyStopFinding[] {
    const variants = direction ? [findVariant(file, direction)].filter(Boolean) : file.variants ?? [];
    const findings: DirtyStopFinding[] = [];

    for (const variant of variants) {
        const directionKey = variant?.direction_key ?? variant?.direction_name ?? "unknown";
        for (const stop of variant?.stops ?? []) {
            const fields = [
                ["stop_name_my", stop.stop_name_my],
                ["stop_name_en", stop.stop_name_en],
                ["raw_text_my", stop.raw_text_my],
                ["raw_text_en", stop.raw_text_en],
                ["raw_text", stop.raw_text],
            ] as const;

            for (const [field, value] of fields) {
                if (typeof value !== "string" || !MYANMAR_PLACEHOLDER_STOP_PATTERN.test(value)) {
                    continue;
                }
                findings.push({
                    language,
                    direction_key: directionKey,
                    sequence: typeof stop.sequence === "number" ? stop.sequence : null,
                    field,
                    value,
                    reason: "placeholder_stop",
                });
            }
        }
    }

    return findings;
}

function collectAdjacentExactDuplicates(
    file: LanguageRouteFile,
    language: "my" | "en",
    direction?: DirectionKey,
): AdjacentDuplicateFinding[] {
    const variants = direction ? [findVariant(file, direction)].filter(Boolean) : file.variants ?? [];
    const findings: AdjacentDuplicateFinding[] = [];

    for (const variant of variants) {
        const stops = variant?.stops ?? [];
        for (let index = 1; index < stops.length; index++) {
            const prev = stops[index - 1];
            const current = stops[index];
            const prevName = normalizedStopName(prev);
            const prevArea = normalizedAreaText(prev);
            const currentName = normalizedStopName(current);
            const currentArea = normalizedAreaText(current);

            if (!prevName || !prevArea || prevName !== currentName || prevArea !== currentArea) {
                continue;
            }

            findings.push({
                language,
                direction_key: variant?.direction_key ?? variant?.direction_name ?? "unknown",
                first_sequence: typeof prev.sequence === "number" ? prev.sequence : null,
                second_sequence: typeof current.sequence === "number" ? current.sequence : null,
                stop_name: currentName,
                area_text: currentArea,
            });
        }
    }

    return findings;
}

function mergeStopsBySequence(
    myanmarStops: LanguageRouteStop[],
    englishStops: LanguageRouteStop[],
): MergedStopRow[] {
    return myanmarStops.map((myStop, index) => {
        const enStop = englishStops[index];
        const areaTextEn = enStop?.area_text_en ?? null;
        const stopNameMy = myStop.stop_name_my ?? null;
        const areaTextMy = myStop.area_text_my ?? null;
        const rawTextMy = myStop.raw_text_my ?? myStop.raw_text ?? null;
        const stopNameEn = enStop?.stop_name_en ?? null;
        const rawTextEn = enStop?.raw_text_en ?? enStop?.raw_text ?? null;
        const rawText = [rawTextMy, rawTextEn].filter(Boolean).join("\n");

        const merged: MergedStopRow = {
            sequence: index + 1,
            stop_name_my: stopNameMy,
            stop_name_en: stopNameEn,
            area_text_my: areaTextMy,
            area_text_en: areaTextEn,
            raw_text_my: rawTextMy,
            raw_text_en: rawTextEn,
            raw_text: rawText,
            merge_match_method: "direction_sequence",
            merge_confidence: 80,
        };

        if (areaTextEn && containsMyanmarScript(areaTextEn)) {
            merged.area_text_en_script_status = "mixed_script_from_source_app";
        }

        return merged;
    });
}

function mergeDirectionVariant(
    myanmar: LanguageRouteFile,
    english: LanguageRouteFile,
    direction: DirectionKey,
    warnings: string[],
): MergedVariantRow {
    const myVariant = findVariant(myanmar, direction);
    const enVariant = findVariant(english, direction);
    const myanmarStopCount = variantStopCount(myVariant);
    const englishStopCount = variantStopCount(enVariant);
    const parserDiagnostics = {
        myanmar: myVariant?.parser_diagnostics ?? null,
        english: enVariant?.parser_diagnostics ?? null,
    };
    const variantBase = {
        direction_key: direction,
        direction_name: direction,
        detected_direction_myanmar: myVariant?.detected_direction ?? null,
        detected_direction_english: enVariant?.detected_direction ?? null,
        myanmar_stop_count: myanmarStopCount,
        english_stop_count: englishStopCount,
        myanmar_quality_status: myVariant?.quality_status ?? null,
        english_quality_status: enVariant?.quality_status ?? null,
        parser_diagnostics: parserDiagnostics,
    };

    if (myanmarStopCount !== englishStopCount) {
        warnings.push(LANGUAGE_DIRECTION_STOP_COUNT_MISMATCH);
        warnings.push(
            `${direction}: Myanmar has ${myanmarStopCount} stops, English has ${englishStopCount} stops.`,
        );

        return {
            ...variantBase,
            merge_status: "blocked_count_mismatch",
            merged_stop_count: 0,
            stop_count: 0,
            real_stop_count: 0,
            quality_status: "blocked",
            stops: [],
        };
    }

    const myanmarStops = myVariant?.stops ?? [];
    const englishStops = enVariant?.stops ?? [];
    const mergedStops = mergeStopsBySequence(myanmarStops, englishStops);

    return {
        ...variantBase,
        merge_status: "merged_by_sequence",
        merged_stop_count: mergedStops.length,
        stop_count: mergedStops.length,
        real_stop_count: mergedStops.length,
        quality_status: "success",
        stops: mergedStops,
    };
}

function resolveOperatorName(myanmar: LanguageRouteFile, english: LanguageRouteFile): string | null {
    return firstNonEmptyString(
        myanmar.route?.operator_name,
        english.route?.operator_name,
        myanmar.route_detail_identity?.operator_name,
        english.route_detail_identity?.operator_name,
        myanmar.route_index_identity?.operator_name,
        english.route_index_identity?.operator_name,
    );
}

function resolveFareFields(
    myanmar: LanguageRouteFile,
    english: LanguageRouteFile,
    warnings: string[],
): {
    fare_text: string | null;
    fare_min: number | null;
    fare_max: number | null;
    fare_source: string | null;
} {
    const fare_text = firstNonEmptyString(myanmar.route?.fare_text, english.route?.fare_text);
    const fare_min = firstNonNullNumber(myanmar.route?.fare_min, english.route?.fare_min);
    const fare_max = firstNonNullNumber(myanmar.route?.fare_max, english.route?.fare_max);
    const fare_source: string | null =
        fare_text || fare_min !== null || fare_max !== null ? "route_fields" : null;

    if (!fare_text && fare_min === null && fare_max === null) {
        warnings.push("FARE_FIELDS_MISSING");
    }

    return { fare_text, fare_min, fare_max, fare_source };
}

function mergeIdentityRecord(
    myanmarRecord: Record<string, unknown> | null | undefined,
    englishRecord: Record<string, unknown> | null | undefined,
    overrides: Record<string, unknown> = {},
): Record<string, unknown> | null {
    const merged = {
        ...(englishRecord ?? {}),
        ...(myanmarRecord ?? {}),
        ...overrides,
    };

    return Object.keys(merged).length > 0 ? merged : null;
}

function pickField<T>(myanmarValue: T | null | undefined, englishValue: T | null | undefined): T | null {
    if (myanmarValue !== null && myanmarValue !== undefined && myanmarValue !== "") {
        return myanmarValue;
    }
    if (englishValue !== null && englishValue !== undefined && englishValue !== "") {
        return englishValue;
    }
    return null;
}

type ResolvedEnglishRouteNameFields = {
    route_name_en: string | null;
    route_name_en_source: string | null;
    route_name_en_confidence: number | null;
    needs_route_name_review: boolean | null;
};

/** Use English extraction route_name_en, or generate from English variant endpoints. */
function resolveEnglishRouteNameFields(english: LanguageRouteFile): ResolvedEnglishRouteNameFields {
    const fromRoute =
        typeof english.route?.route_name_en === "string" ? english.route.route_name_en.trim() || null : null;

    if (fromRoute) {
        return {
            route_name_en: fromRoute,
            route_name_en_source:
                typeof english.route?.route_name_en_source === "string"
                    ? english.route.route_name_en_source
                    : null,
            route_name_en_confidence:
                typeof english.route?.route_name_en_confidence === "number"
                    ? english.route.route_name_en_confidence
                    : null,
            needs_route_name_review:
                typeof english.route?.needs_route_name_review === "boolean"
                    ? english.route.needs_route_name_review
                    : null,
        };
    }

    const generated = generateEnglishRouteNameFromVariants(english.variants ?? []);
    return {
        route_name_en: generated.route_name_en,
        route_name_en_source: generated.route_name_en_source,
        route_name_en_confidence: generated.route_name_en_confidence,
        needs_route_name_review: generated.needs_route_name_review,
    };
}

/** Prefer a real English app title; otherwise use generated endpoint route name. */
function resolveEnglishDetailRouteTitle(
    english: LanguageRouteFile,
    routeNameEn: string | null,
    routeDetailTitleEnRaw: string | null,
): string | null {
    const candidates = [
        english.route_detail_identity?.route_title_en,
        routeDetailTitleEnRaw,
    ];

    for (const candidate of candidates) {
        if (typeof candidate === "string") {
            const trimmed = candidate.trim();
            if (trimmed && !isMyanmarText(trimmed)) {
                return trimmed;
            }
        }
    }

    return routeNameEn;
}

function resolveEnglishIndexRouteTitle(
    english: LanguageRouteFile,
    routeNameEn: string | null,
): string | null {
    const fromIndex = english.route_index_identity?.route_title_en;
    if (typeof fromIndex === "string") {
        const trimmed = fromIndex.trim();
        if (trimmed && !isMyanmarText(trimmed)) {
            return trimmed;
        }
    }

    return routeNameEn;
}

function resolveRouteIndexIdentity(
    myanmar: LanguageRouteFile,
    english: LanguageRouteFile,
    warnings: string[],
    routeTitleEn: string | null,
): Record<string, unknown> | null {
    if (!english.route_index_identity && myanmar.route_index_identity) {
        warnings.push("ENGLISH_ROUTE_INDEX_IDENTITY_MISSING_MYANMAR_FALLBACK");
    }
    if (!myanmar.route_index_identity && english.route_index_identity) {
        warnings.push("MYANMAR_ROUTE_INDEX_IDENTITY_MISSING_ENGLISH_FALLBACK");
    }

    return mergeIdentityRecord(myanmar.route_index_identity, english.route_index_identity, {
        route_title_my: pickField(
            myanmar.route_index_identity?.route_title_my,
            english.route_index_identity?.route_title_my,
        ),
        route_title_en:
            pickField(
                myanmar.route_index_identity?.route_title_en,
                english.route_index_identity?.route_title_en,
            ) ?? routeTitleEn,
        operator_name: resolveOperatorName(myanmar, english),
        route_code_candidate: pickField(
            myanmar.route_index_identity?.route_code_candidate,
            english.route_index_identity?.route_code_candidate,
        ),
        route_number: pickField(
            myanmar.route_index_identity?.route_number,
            english.route_index_identity?.route_number,
        ),
        route_display_code: pickField(
            myanmar.route_index_identity?.route_display_code,
            english.route_index_identity?.route_display_code,
        ),
        public_name_candidate: pickField(
            myanmar.route_index_identity?.public_name_candidate,
            english.route_index_identity?.public_name_candidate,
        ),
        identity_status: pickField(
            myanmar.route_index_identity?.identity_status,
            english.route_index_identity?.identity_status,
        ),
    });
}

function resolveRouteDetailIdentity(
    myanmar: LanguageRouteFile,
    english: LanguageRouteFile,
    route: Record<string, unknown>,
    routeTitleEn: string | null,
): Record<string, unknown> | null {
    const routeNameEn =
        typeof route.route_name_en === "string" ? route.route_name_en : null;

    return mergeIdentityRecord(myanmar.route_detail_identity, english.route_detail_identity, {
        route_name_my: pickField(myanmar.route?.route_name_my, english.route_detail_identity?.route_name_my),
        route_name_en: routeNameEn,
        route_title_my: pickField(
            myanmar.route_detail_identity?.route_title_my,
            english.route_detail_identity?.route_title_my,
        ),
        route_title_en: routeTitleEn,
        operator_name: typeof route.operator_name === "string" ? route.operator_name : null,
        route_code_candidate: pickField(
            myanmar.route_detail_identity?.route_code_candidate,
            english.route_detail_identity?.route_code_candidate,
        ),
        route_number: pickField(
            myanmar.route_detail_identity?.route_number,
            english.route_detail_identity?.route_number,
        ),
        route_display_code: pickField(
            myanmar.route_detail_identity?.route_display_code,
            english.route_detail_identity?.route_display_code,
        ),
        public_name_candidate: pickField(
            myanmar.route_detail_identity?.public_name_candidate,
            english.route_detail_identity?.public_name_candidate,
        ),
        identity_status: pickField(
            myanmar.route_detail_identity?.identity_status,
            english.route_detail_identity?.identity_status,
        ),
    });
}

function buildMergedRoute(
    myanmar: LanguageRouteFile,
    english: LanguageRouteFile,
    routeCode: string,
    fare: ReturnType<typeof resolveFareFields>,
    englishNameFields: ResolvedEnglishRouteNameFields,
): Record<string, unknown> {
    const operatorName = resolveOperatorName(myanmar, english);
    const routeDetailTitleEnRaw =
        typeof english.route?.route_detail_title_en_raw === "string"
            ? english.route.route_detail_title_en_raw.trim() || null
            : null;

    return {
        route_code_candidate:
            pickField(myanmar.route?.route_code_candidate, english.route?.route_code_candidate) ??
            routeCode,
        route_number: pickField(myanmar.route?.route_number, english.route?.route_number),
        route_display_code: pickField(myanmar.route?.route_display_code, english.route?.route_display_code),
        route_name_my:
            typeof myanmar.route?.route_name_my === "string" ? myanmar.route.route_name_my : null,
        route_detail_title_en_raw: routeDetailTitleEnRaw,
        route_name_en: englishNameFields.route_name_en,
        route_name_en_source: englishNameFields.route_name_en_source,
        route_name_en_confidence: englishNameFields.route_name_en_confidence,
        needs_route_name_review: englishNameFields.needs_route_name_review,
        operator_name: operatorName,
        fare_text: fare.fare_text,
        fare_min: fare.fare_min,
        fare_max: fare.fare_max,
        fare_source: fare.fare_source,
        app_total_stop_count: pickField(
            myanmar.route?.app_total_stop_count,
            english.route?.app_total_stop_count,
        ),
        identity_status: pickField(myanmar.route?.identity_status, english.route?.identity_status),
    };
}

function buildMergedSource(myanmar: LanguageRouteFile, english: LanguageRouteFile): Record<string, unknown> {
    return {
        source_name: "external_ybs_app",
        source_kind: "visible_app_extraction",
        source_method: "adb_uiautomator_xml_language_merge",
        myanmar: myanmar.source ?? null,
        english: english.source ?? null,
    };
}

function buildMergedExtraction(
    myanmar: LanguageRouteFile,
    english: LanguageRouteFile,
    variants: MergedVariantRow[],
    paths: { myanmar: string; english: string },
    qualityStatus: string,
): Record<string, unknown> {
    const outboundVariant = variants.find((variant) => variant.direction_key === "outbound");
    const inboundVariant = variants.find((variant) => variant.direction_key === "inbound");

    return {
        merge_method: "adb_uiautomator_xml_language_merge",
        merged_at: new Date().toISOString(),
        myanmar_source_path: paths.myanmar,
        english_source_path: paths.english,
        myanmar_schema_version: myanmar.extraction_schema_version ?? null,
        english_schema_version: english.extraction_schema_version ?? null,
        myanmar: myanmar.extraction ?? null,
        english: english.extraction ?? null,
        directions_extracted: [...REQUIRED_DIRECTIONS],
        outbound_stop_count: outboundVariant?.merged_stop_count ?? 0,
        inbound_stop_count: inboundVariant?.merged_stop_count ?? 0,
        outbound_real_stop_count: outboundVariant?.real_stop_count ?? 0,
        inbound_real_stop_count: inboundVariant?.real_stop_count ?? 0,
        myanmar_outbound_stop_count: outboundVariant?.myanmar_stop_count ?? 0,
        myanmar_inbound_stop_count: inboundVariant?.myanmar_stop_count ?? 0,
        english_outbound_stop_count: outboundVariant?.english_stop_count ?? 0,
        english_inbound_stop_count: inboundVariant?.english_stop_count ?? 0,
        quality_status: qualityStatus,
    };
}

function buildMergedValidation(
    myanmar: LanguageRouteFile,
    english: LanguageRouteFile,
    variants: MergedVariantRow[],
    appTotalStopCount: number | null,
    directionStopCountSum: number,
    qualityStatus: string,
    mergeReady: boolean,
): Record<string, unknown> {
    const outboundVariant = variants.find((variant) => variant.direction_key === "outbound");
    const inboundVariant = variants.find((variant) => variant.direction_key === "inbound");

    return {
        has_variants: variants.length > 0,
        outbound_merge_status: outboundVariant?.merge_status ?? null,
        inbound_merge_status: inboundVariant?.merge_status ?? null,
        direction_stop_count_sum: directionStopCountSum,
        matches_app_total_stop_count:
            appTotalStopCount === null ? null : directionStopCountSum === appTotalStopCount,
        app_total_stop_count_myanmar: firstNonNullNumber(myanmar.route?.app_total_stop_count),
        app_total_stop_count_english: firstNonNullNumber(english.route?.app_total_stop_count),
        myanmar_direction_stop_count_sum: firstNonNullNumber(myanmar.validation?.direction_stop_count_sum),
        english_direction_stop_count_sum: firstNonNullNumber(english.validation?.direction_stop_count_sum),
        myanmar_quality_status:
            myanmar.validation?.quality_status ?? myanmar.extraction?.quality_status ?? null,
        english_quality_status:
            english.validation?.quality_status ?? english.extraction?.quality_status ?? null,
        myanmar_extraction_status: myanmar.extraction?.extraction_status ?? null,
        english_extraction_status: english.extraction?.extraction_status ?? null,
        quality_status: qualityStatus,
        merge_ready: mergeReady,
        myanmar: myanmar.validation ?? null,
        english: english.validation ?? null,
    };
}

function collectMergedWarnings(
    mergeWarnings: string[],
    myanmar: LanguageRouteFile,
    english: LanguageRouteFile,
): string[] {
    const warnings = [...mergeWarnings];

    for (const warning of myanmar.warnings ?? []) {
        warnings.push(`myanmar:${warning}`);
    }
    for (const warning of english.warnings ?? []) {
        warnings.push(`english:${warning}`);
    }

    return warnings;
}

function diagnosisReportPaths(config: YbsExtractionConfig, routeCode: string): {
    jsonPath: string;
    markdownPath: string;
} {
    const dir = reportsDir(config);
    return {
        jsonPath: path.join(dir, `language-merge-diagnosis-${routeCode}.json`),
        markdownPath: path.join(dir, `language-merge-diagnosis-${routeCode}.md`),
    };
}

function hasFare(file: LanguageRouteFile): boolean {
    return Boolean(
        firstNonEmptyString(file.route?.fare_text) ||
            firstNonNullNumber(file.route?.fare_min, file.route?.fare_max) !== null,
    );
}

function hasOperator(file: LanguageRouteFile): boolean {
    return Boolean(
        firstNonEmptyString(
            file.route?.operator_name,
            file.route_detail_identity?.operator_name,
            file.route_index_identity?.operator_name,
        ),
    );
}

function resolveDirectionDecision(input: {
    countMismatch: boolean;
    dirtyStopCount: number;
    warningCount: number;
}): LanguageMergeDecision {
    if (input.countMismatch) {
        return "blocked_count_mismatch";
    }
    if (input.dirtyStopCount > 0) {
        return "blocked_dirty_stops";
    }
    if (input.warningCount > 0) {
        return "warning_only";
    }
    return "safe_to_merge";
}

function resolveOverallDecision(directions: Record<DirectionKey, DirectionMergeDiagnosis>): LanguageMergeDecision {
    const decisions = REQUIRED_DIRECTIONS.map((direction) => directions[direction].decision);
    if (decisions.includes("blocked_count_mismatch")) {
        return "blocked_count_mismatch";
    }
    if (decisions.includes("blocked_dirty_stops")) {
        return "blocked_dirty_stops";
    }
    if (decisions.includes("warning_only")) {
        return "warning_only";
    }
    return "safe_to_merge";
}

export function diagnoseLanguageMerge(options: MergeLanguageRoutesOptions): {
    diagnosis: LanguageMergeDiagnosis;
    jsonPath: string;
    markdownPath: string;
} {
    const config = defaultConfig(options.config);
    const myanmarPath = resolveFromRepo(options.myanmarPath);
    const englishPath = resolveFromRepo(options.englishPath);
    const myanmar = readJsonFile<LanguageRouteFile>(myanmarPath);
    const english = readJsonFile<LanguageRouteFile>(englishPath);
    const routeCode = inferRouteCode(myanmar, english, myanmarPath, englishPath);
    const paths = diagnosisReportPaths(config, routeCode);

    const warnings: string[] = [];
    const myRouteCode = routeCodeValue(myanmar, myanmarPath);
    const enRouteCode = routeCodeValue(english, englishPath);
    const myRouteNumber = routeNumberValue(myanmar);
    const enRouteNumber = routeNumberValue(english);
    const myDirectionKeys = directionKeys(myanmar);
    const enDirectionKeys = directionKeys(english);
    const directionKeysMatch =
        myDirectionKeys.length === enDirectionKeys.length &&
        myDirectionKeys.every((key, index) => key === enDirectionKeys[index]);

    if (!directionKeysMatch) {
        warnings.push("DIRECTION_KEYS_MISMATCH");
    }
    if (myRouteCode !== enRouteCode) {
        warnings.push("ROUTE_CODE_MISMATCH");
    }
    if (myRouteNumber !== enRouteNumber) {
        warnings.push("ROUTE_NUMBER_MISMATCH");
    }

    const missingRouteIndexIdentity = {
        myanmar: !myanmar.route_index_identity,
        english: !english.route_index_identity,
    };
    if (missingRouteIndexIdentity.myanmar) {
        warnings.push("MYANMAR_ROUTE_INDEX_IDENTITY_MISSING");
    }
    if (missingRouteIndexIdentity.english) {
        warnings.push("ENGLISH_ROUTE_INDEX_IDENTITY_MISSING");
    }

    const fare = resolveFareFields(myanmar, english, warnings);
    const operatorName = resolveOperatorName(myanmar, english);
    const missingFareOperator = {
        myanmar_fare: !hasFare(myanmar),
        english_fare: !hasFare(english),
        merged_fare: !fare.fare_text && fare.fare_min === null && fare.fare_max === null,
        myanmar_operator: !hasOperator(myanmar),
        english_operator: !hasOperator(english),
        merged_operator: !operatorName,
    };

    if (missingFareOperator.merged_operator) {
        warnings.push("MERGED_OPERATOR_MISSING");
    }

    const myanmarCounts = Object.fromEntries(
        REQUIRED_DIRECTIONS.map((direction) => [direction, variantStopCount(findVariant(myanmar, direction))]),
    ) as Record<DirectionKey, number>;
    const englishCounts = Object.fromEntries(
        REQUIRED_DIRECTIONS.map((direction) => [direction, variantStopCount(findVariant(english, direction))]),
    ) as Record<DirectionKey, number>;

    const directions = Object.fromEntries(
        REQUIRED_DIRECTIONS.map((direction) => {
            const metadataRows = [
                ...collectMetadataRows(myanmar, "my", direction),
                ...collectMetadataRows(english, "en", direction),
            ];
            const placeholderRows = [
                ...collectPlaceholderRows(myanmar, "my", direction),
                ...collectPlaceholderRows(english, "en", direction),
            ];
            const adjacentDuplicates = [
                ...collectAdjacentExactDuplicates(myanmar, "my", direction),
                ...collectAdjacentExactDuplicates(english, "en", direction),
            ];
            const directionWarnings: string[] = [];
            const countMismatch = myanmarCounts[direction] !== englishCounts[direction];

            if (countMismatch) {
                directionWarnings.push(LANGUAGE_DIRECTION_STOP_COUNT_MISMATCH);
            }
            if (adjacentDuplicates.length > 0) {
                directionWarnings.push("ADJACENT_EXACT_DUPLICATES_FOUND");
            }

            const diagnosis: DirectionMergeDiagnosis = {
                direction_key: direction,
                myanmar_stop_count: myanmarCounts[direction],
                english_stop_count: englishCounts[direction],
                metadata_rows_found: metadataRows,
                placeholder_rows_found: placeholderRows,
                adjacent_exact_duplicates: adjacentDuplicates,
                decision: resolveDirectionDecision({
                    countMismatch,
                    dirtyStopCount: metadataRows.length + placeholderRows.length,
                    warningCount: directionWarnings.length,
                }),
                warnings: directionWarnings,
            };

            return [direction, diagnosis];
        }),
    ) as Record<DirectionKey, DirectionMergeDiagnosis>;

    const metadataRowsFound = [
        ...collectMetadataRows(myanmar, "my"),
        ...collectMetadataRows(english, "en"),
    ];
    const placeholderRowsFound = [
        ...collectPlaceholderRows(myanmar, "my"),
        ...collectPlaceholderRows(english, "en"),
    ];
    const adjacentExactDuplicates = [
        ...collectAdjacentExactDuplicates(myanmar, "my"),
        ...collectAdjacentExactDuplicates(english, "en"),
    ];

    const diagnosis: LanguageMergeDiagnosis = {
        generated_at: new Date().toISOString(),
        route_code: routeCode,
        input_paths: {
            myanmar: myanmarPath,
            english: englishPath,
        },
        checks: {
            route_code_match: myRouteCode === enRouteCode,
            route_number_match: myRouteNumber === enRouteNumber,
            direction_keys_match: directionKeysMatch,
            myanmar_counts: myanmarCounts,
            english_counts: englishCounts,
            app_total_stop_count: {
                myanmar: firstNonNullNumber(myanmar.route?.app_total_stop_count),
                english: firstNonNullNumber(english.route?.app_total_stop_count),
            },
            metadata_rows_found_in_stops: metadataRowsFound,
            placeholder_rows_found: placeholderRowsFound,
            adjacent_exact_duplicates: adjacentExactDuplicates,
            missing_route_index_identity: missingRouteIndexIdentity,
            missing_fare_operator: missingFareOperator,
        },
        directions,
        overall_decision: resolveOverallDecision(directions),
        warnings,
    };

    fs.mkdirSync(path.dirname(paths.jsonPath), { recursive: true });
    fs.writeFileSync(paths.jsonPath, `${JSON.stringify(diagnosis, null, 2)}\n`, "utf8");
    fs.writeFileSync(paths.markdownPath, `${renderDiagnosisMarkdown(diagnosis)}\n`, "utf8");

    return {
        diagnosis,
        jsonPath: paths.jsonPath,
        markdownPath: paths.markdownPath,
    };
}

function renderDiagnosisMarkdown(diagnosis: LanguageMergeDiagnosis): string {
    const directionRows = REQUIRED_DIRECTIONS.map((direction) => {
        const item = diagnosis.directions[direction];
        return `| ${direction} | ${item.myanmar_stop_count} | ${item.english_stop_count} | ${item.decision} | ${item.metadata_rows_found.length} | ${item.placeholder_rows_found.length} | ${item.adjacent_exact_duplicates.length} |`;
    }).join("\n");

    const warningLines =
        diagnosis.warnings.length > 0
            ? diagnosis.warnings.map((warning) => `- ${warning}`).join("\n")
            : "- None";

    return [
        `# YBS Language Merge Diagnosis: ${diagnosis.route_code}`,
        "",
        `Generated at: ${diagnosis.generated_at}`,
        `Overall decision: ${diagnosis.overall_decision}`,
        "",
        "## Checks",
        "",
        `- Route code match: ${diagnosis.checks.route_code_match}`,
        `- Route number match: ${diagnosis.checks.route_number_match}`,
        `- Direction keys match: ${diagnosis.checks.direction_keys_match}`,
        `- Myanmar app total stop count: ${diagnosis.checks.app_total_stop_count.myanmar ?? "n/a"}`,
        `- English app total stop count: ${diagnosis.checks.app_total_stop_count.english ?? "n/a"}`,
        `- Missing Myanmar route_index_identity: ${diagnosis.checks.missing_route_index_identity.myanmar}`,
        `- Missing English route_index_identity: ${diagnosis.checks.missing_route_index_identity.english}`,
        `- Missing merged fare: ${diagnosis.checks.missing_fare_operator.merged_fare}`,
        `- Missing merged operator: ${diagnosis.checks.missing_fare_operator.merged_operator}`,
        "",
        "## Direction Decisions",
        "",
        "| Direction | Myanmar stops | English stops | Decision | Metadata rows | Placeholder rows | Adjacent duplicates |",
        "|---|---:|---:|---|---:|---:|---:|",
        directionRows,
        "",
        "## Warnings",
        "",
        warningLines,
    ].join("\n");
}

/** Merge one Myanmar file and one English file for the same route key. */
export function mergeLanguageRoutes(options: MergeLanguageRoutesOptions): string {
    const config = defaultConfig(options.config);
    const myanmarPath = resolveFromRepo(options.myanmarPath);
    const englishPath = resolveFromRepo(options.englishPath);
    const myanmar = readJsonFile<LanguageRouteFile>(myanmarPath);
    const english = readJsonFile<LanguageRouteFile>(englishPath);
    const routeCode = inferRouteCode(myanmar, english, myanmarPath, englishPath);
    const outputPath = options.outputPath
        ? resolveFromRepo(options.outputPath)
        : mergedRoutePath(config, routeCode);

    const diagnosisReport = diagnoseLanguageMerge(options);

    const warnings: string[] = [];

    const routeDetailTitleEnRaw =
        typeof english.route?.route_detail_title_en_raw === "string"
            ? english.route.route_detail_title_en_raw.trim() || null
            : null;

    const englishNameFields = resolveEnglishRouteNameFields(english);
    const routeIndexTitleEn = resolveEnglishIndexRouteTitle(english, englishNameFields.route_name_en);
    const routeDetailTitleEn = resolveEnglishDetailRouteTitle(
        english,
        englishNameFields.route_name_en,
        routeDetailTitleEnRaw,
    );

    if (routeDetailTitleEnRaw && isMyanmarText(routeDetailTitleEnRaw)) {
        warnings.push("ENGLISH_DETAIL_TITLE_IS_MYANMAR");
    }

    const fare = resolveFareFields(myanmar, english, warnings);
    const variants = REQUIRED_DIRECTIONS.map((direction) =>
        mergeDirectionVariant(myanmar, english, direction, warnings),
    );

    const outboundVariant = variants.find((variant) => variant.direction_key === "outbound");
    const inboundVariant = variants.find((variant) => variant.direction_key === "inbound");
    const mergedOutboundCount = outboundVariant?.merged_stop_count ?? 0;
    const mergedInboundCount = inboundVariant?.merged_stop_count ?? 0;
    const directionStopCountSum = mergedOutboundCount + mergedInboundCount;
    const appTotalStopCount = firstNonNullNumber(
        myanmar.route?.app_total_stop_count,
        english.route?.app_total_stop_count,
    );

    const allDirectionsMerged = variants.every(
        (variant) => variant.merge_status === "merged_by_sequence",
    );
    const anyBlocked = variants.some(
        (variant) => variant.merge_status === "blocked_count_mismatch",
    );
    const qualityStatus = anyBlocked ? "blocked" : allDirectionsMerged ? "success" : "partial";
    const mergeReady = allDirectionsMerged && variants.every((variant) => variant.stops.length > 0);
    const mergedRoute = buildMergedRoute(myanmar, english, routeCode, fare, englishNameFields);

    const output = {
        extraction_schema_version: MERGED_EXTRACTION_SCHEMA_VERSION,
        source: buildMergedSource(myanmar, english),
        route_index_identity: resolveRouteIndexIdentity(myanmar, english, warnings, routeIndexTitleEn),
        route_detail_identity: resolveRouteDetailIdentity(myanmar, english, mergedRoute, routeDetailTitleEn),
        route: mergedRoute,
        variants,
        extraction: buildMergedExtraction(myanmar, english, variants, {
            myanmar: myanmarPath,
            english: englishPath,
        }, qualityStatus),
        validation: buildMergedValidation(
            myanmar,
            english,
            variants,
            appTotalStopCount,
            directionStopCountSum,
            qualityStatus,
            mergeReady,
        ),
        merge: {
            merged_at: new Date().toISOString(),
            myanmar_source_path: myanmarPath,
            english_source_path: englishPath,
            diagnosis_json_path: diagnosisReport.jsonPath,
            diagnosis_markdown_path: diagnosisReport.markdownPath,
            overall_decision: diagnosisReport.diagnosis.overall_decision,
            source_warnings: {
                myanmar: myanmar.warnings ?? [],
                english: english.warnings ?? [],
            },
            directions: Object.fromEntries(
                variants.map((variant) => [
                    variant.direction_key,
                    {
                        merge_status: variant.merge_status,
                        myanmar_stop_count: variant.myanmar_stop_count,
                        english_stop_count: variant.english_stop_count,
                        merged_stop_count: variant.merged_stop_count,
                        myanmar_quality_status: variant.myanmar_quality_status,
                        english_quality_status: variant.english_quality_status,
                    },
                ]),
            ),
        },
        warnings: collectMergedWarnings(warnings, myanmar, english),
    };

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
    return outputPath;
}

function normalizeCliPath(value: string): string {
    return value.trim().replace(/[,\s]+$/u, "");
}

function parseCliArgs(argv: string[]): MergeLanguageRoutesOptions {
    let myanmarPath = "";
    let englishPath = "";
    let outputPath: string | undefined;
    const configOverrides: Partial<YbsExtractionConfig> = {};

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        const next = argv[i + 1];
        if (arg === "--myanmar" && next) {
            myanmarPath = normalizeCliPath(next);
            i++;
        } else if (arg === "--english" && next) {
            englishPath = normalizeCliPath(next);
            i++;
        } else if (arg === "--output" && next) {
            outputPath = normalizeCliPath(next);
            i++;
        } else if ((arg === "--run" || arg === "--output-root") && next) {
            configOverrides.outputRoot = normalizeCliPath(next);
            i++;
        }
    }

    if (!myanmarPath || !englishPath) {
        throw new Error(
            "Usage: --myanmar <path> --english <path> [--output <path>] [--run <run-root>]",
        );
    }

    return {
        myanmarPath,
        englishPath,
        outputPath,
        config: configOverrides,
        diagnoseOnly: argv.includes("--diagnose-only"),
    };
}

function main(): void {
    const options = parseCliArgs(process.argv.slice(2));
    if (options.diagnoseOnly) {
        const report = diagnoseLanguageMerge(options);
        console.log(`Wrote ${report.markdownPath}`);
        console.log(`Wrote ${report.jsonPath}`);
        console.log(`Overall decision: ${report.diagnosis.overall_decision}`);
        return;
    }

    const outputPath = mergeLanguageRoutes(options);
    console.log(`Wrote ${outputPath}`);
}

const isMain = resolveFromRepo("tools/data-pipeline/transport-json-import/ybs-extraction/merge-language-routes.ts");
if (process.argv[1] && path.resolve(process.argv[1]) === isMain) {
    try {
        main();
    } catch (error: unknown) {
        console.error(error);
        process.exit(1);
    }
}
