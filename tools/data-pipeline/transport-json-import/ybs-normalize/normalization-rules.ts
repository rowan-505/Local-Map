/**
 * Phase 5 normalization rules for merged YBS route JSON.
 *
 * Does not touch the database.
 */

import {
    normalizeYbsRouteDisplayNames,
    type RouteDisplayNameReport,
} from "./route-display-names.js";

export {
    buildPrimaryRouteDisplayName,
    buildYbsDisplayCode,
    buildYbsRouteCode,
    isValidCoreMapPrimaryRouteName,
    normalizeYbsRouteDisplayNames,
    parseRouteEndpoints,
    validateStoredRouteDisplayNames,
    YBS_ROUTE_CODE_PATTERN,
    type RouteDisplayNameReport,
} from "./route-display-names.js";

export const NORMALIZATION_SCHEMA_VERSION = 2;
export const MERGED_INPUT_SCHEMA_VERSION = 3;

export const REQUIRED_DIRECTIONS = ["outbound", "inbound"] as const;
export type DirectionKey = (typeof REQUIRED_DIRECTIONS)[number];

export type NormalizationStatus =
    | "ready_for_phase6"
    | "needs_manual_fix"
    | "blocked_invalid_structure"
    | "blocked_dirty_stop_data";

export type NormalizationIssue = {
    code: string;
    message: string;
    direction_key?: DirectionKey | string;
    sequence?: number;
    field?: string;
};

export const BLOCKING_ERROR_CODES = {
    ROUTE_CODE_MISSING: "ROUTE_CODE_MISSING",
    ROUTE_NAME_MY_MISSING: "ROUTE_NAME_MY_MISSING",
    OUTBOUND_MISSING: "OUTBOUND_MISSING",
    INBOUND_MISSING: "INBOUND_MISSING",
    DIRECTION_ZERO_STOPS: "DIRECTION_ZERO_STOPS",
    STOP_SEQUENCE_BROKEN: "STOP_SEQUENCE_BROKEN",
    DIRTY_STOP_NAME_MY_PLACEHOLDER: "DIRTY_STOP_NAME_MY_PLACEHOLDER",
    DIRTY_STOP_NAME_EN_METADATA: "DIRTY_STOP_NAME_EN_METADATA",
} as const;

export const WARNING_CODES = {
    ROUTE_NAME_EN_MISSING: "ROUTE_NAME_EN_MISSING",
    ROUTE_DISPLAY_NAME_WARNING: "ROUTE_DISPLAY_NAME_WARNING",
    OPERATOR_NAME_MISSING: "OPERATOR_NAME_MISSING",
    FARE_MISSING: "FARE_MISSING",
    MIXED_SCRIPT_ENGLISH_AREA: "MIXED_SCRIPT_ENGLISH_AREA",
    APP_TOTAL_STOP_COUNT_MISMATCH: "APP_TOTAL_STOP_COUNT_MISMATCH",
    ADJACENT_DUPLICATE_TERMINAL_STOP: "ADJACENT_DUPLICATE_TERMINAL_STOP",
    EXTRA_VARIANT_DIRECTION_IGNORED: "EXTRA_VARIANT_DIRECTION_IGNORED",
} as const;

const NULL_TEXT_VALUES = new Set(["n/a", "n/a - n/a"]);
const MYANMAR_DIRTY_STOP_PATTERN = /မှတ်တိုင်\s+အမှတ်/;
const MYANMAR_CHAR_PATTERN = /[\u1000-\u109F]/;
const BLOCKED_ENGLISH_STOP_NAMES = new Set(["bus details", "bus stops"]);

const TEXT_STOP_FIELDS = [
    "stop_name_my",
    "stop_name_en",
    "area_text_my",
    "area_text_en",
] as const;

const TEXT_ROUTE_FIELDS = [
    "route_code_candidate",
    "route_display_code",
    "route_name_my",
    "route_name_en",
    "operator_name",
    "fare_text",
] as const;

export type MergedStopInput = {
    sequence?: number;
    stop_name_my?: string | null;
    stop_name_en?: string | null;
    area_text_my?: string | null;
    area_text_en?: string | null;
    area_text_en_script_status?: "mixed_script_from_source_app";
    raw_text_my?: string | null;
    raw_text_en?: string | null;
    raw_text?: string | null;
    merge_match_method?: string;
    merge_confidence?: number;
    [key: string]: unknown;
};

export type MergedVariantInput = {
    direction_key?: string;
    direction_name?: string;
    parser_diagnostics?: Record<string, unknown>;
    stops?: MergedStopInput[];
    [key: string]: unknown;
};

export type MergedRouteInput = {
    extraction_schema_version?: number;
    source?: Record<string, unknown>;
    route_index_identity?: Record<string, unknown> | null;
    route_detail_identity?: Record<string, unknown>;
    route?: Record<string, unknown>;
    variants?: MergedVariantInput[];
    warnings?: string[];
    validation?: Record<string, unknown>;
    extraction?: Record<string, unknown>;
    merge?: Record<string, unknown>;
    [key: string]: unknown;
};

export type NormalizedStop = {
    sequence: number;
    stop_name_my: string | null;
    stop_name_en: string | null;
    area_text_my: string | null;
    area_text_en: string | null;
    area_text_en_script_status?: "mixed_script_from_source_app";
    raw_text_my?: string | null;
    raw_text_en?: string | null;
    raw_text?: string | null;
    merge_match_method?: string;
    merge_confidence?: number;
};

export type NormalizedVariant = {
    direction_key: DirectionKey;
    direction_name: DirectionKey;
    parser_diagnostics?: Record<string, unknown>;
    stops: NormalizedStop[];
    [key: string]: unknown;
};

export type NormalizedRoute = {
    normalization_schema_version: number;
    extraction_schema_version: number;
    normalized_at: string;
    source_merged_path: string;
    normalization_status: NormalizationStatus;
    quality_score: number;
    blocking_errors: NormalizationIssue[];
    warnings: NormalizationIssue[];
    source_warnings: string[];
    source?: Record<string, unknown>;
    route_index_identity?: Record<string, unknown> | null;
    route_detail_identity?: Record<string, unknown>;
    route: Record<string, unknown>;
    route_display_names?: RouteDisplayNameReport;
    variants: NormalizedVariant[];
    validation?: Record<string, unknown>;
    extraction?: Record<string, unknown>;
    merge?: Record<string, unknown>;
};

export function normalizeTextValue(value: unknown): string | null {
    if (value === null || value === undefined) {
        return null;
    }

    if (typeof value !== "string") {
        return null;
    }

    const collapsed = value.trim().replace(/\s+/gu, " ");
    if (!collapsed) {
        return null;
    }

    if (NULL_TEXT_VALUES.has(collapsed.toLowerCase())) {
        return null;
    }

    return collapsed;
}

export function normalizeNumberValue(value: unknown): number | null {
    if (value === null || value === undefined || value === "") {
        return null;
    }

    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }

    if (typeof value === "string") {
        const normalized = value.trim().replace(/,/gu, "");
        if (!normalized) {
            return null;
        }
        const parsed = Number(normalized);
        if (Number.isFinite(parsed)) {
            return parsed;
        }
    }

    return null;
}

function normalizeStop(stop: MergedStopInput): NormalizedStop {
    const normalized: NormalizedStop = {
        sequence: typeof stop.sequence === "number" ? stop.sequence : 0,
        stop_name_my: normalizeTextValue(stop.stop_name_my),
        stop_name_en: normalizeTextValue(stop.stop_name_en),
        area_text_my: normalizeTextValue(stop.area_text_my),
        area_text_en: normalizeTextValue(stop.area_text_en),
    };

    if (stop.area_text_en_script_status === "mixed_script_from_source_app") {
        normalized.area_text_en_script_status = "mixed_script_from_source_app";
    }

    for (const field of ["raw_text_my", "raw_text_en", "raw_text", "merge_match_method"] as const) {
        const value = stop[field];
        if (typeof value === "string" && value.trim()) {
            normalized[field] = field === "raw_text_my" || field === "raw_text_en" || field === "raw_text"
                ? normalizeTextValue(value)
                : value.trim();
        }
    }

    if (typeof stop.merge_confidence === "number" && Number.isFinite(stop.merge_confidence)) {
        normalized.merge_confidence = stop.merge_confidence;
    }

    return normalized;
}

function normalizeRouteFields(route: Record<string, unknown> | undefined): Record<string, unknown> {
    const input = route ?? {};
    const normalized: Record<string, unknown> = { ...input };

    for (const field of TEXT_ROUTE_FIELDS) {
        if (field in input) {
            normalized[field] = normalizeTextValue(input[field]);
        }
    }

    const routeCode =
        normalizeTextValue(input.route_code) ??
        normalizeTextValue(input.route_code_candidate);
    normalized.route_code = routeCode;
    normalized.route_number = normalizeNumberValue(input.route_number);
    normalized.fare_min = normalizeNumberValue(input.fare_min);
    normalized.fare_max = normalizeNumberValue(input.fare_max);
    normalized.app_total_stop_count = normalizeNumberValue(input.app_total_stop_count);

    return normalized;
}

function isBrokenSequence(stops: NormalizedStop[]): boolean {
    if (stops.length === 0) {
        return false;
    }

    const sequences = stops
        .map((stop) => stop.sequence)
        .filter((value): value is number => typeof value === "number" && Number.isFinite(value));

    if (sequences.length !== stops.length) {
        return true;
    }

    const expected = Array.from({ length: stops.length }, (_, index) => index + 1);
    const actual = [...sequences].sort((left, right) => left - right);
    return actual.some((value, index) => value !== expected[index]);
}

function renumberStops(stops: NormalizedStop[]): NormalizedStop[] {
    return stops.map((stop, index) => ({
        ...stop,
        sequence: index + 1,
    }));
}

function stopPairKey(stop: NormalizedStop): string {
    const name = stop.stop_name_my ?? stop.stop_name_en ?? "";
    const area = stop.area_text_my ?? stop.area_text_en ?? "";
    return `${name}||${area}`;
}

function hasMixedScriptEnglishArea(stop: NormalizedStop): boolean {
    if (stop.area_text_en_script_status === "mixed_script_from_source_app") {
        return true;
    }

    return Boolean(stop.area_text_en && MYANMAR_CHAR_PATTERN.test(stop.area_text_en));
}

function hasFare(route: Record<string, unknown>): boolean {
    const fareText = normalizeTextValue(route.fare_text);
    const fareMin = normalizeNumberValue(route.fare_min);
    const fareMax = normalizeNumberValue(route.fare_max);
    return Boolean(fareText) || fareMin !== null || fareMax !== null;
}

function isDirtyStopNameMy(value: string | null): boolean {
    return Boolean(value && MYANMAR_DIRTY_STOP_PATTERN.test(value));
}

function isDirtyStopNameEn(value: string | null): boolean {
    return Boolean(value && BLOCKED_ENGLISH_STOP_NAMES.has(value.toLowerCase()));
}

function hasAdjacentDuplicateTerminalStop(stops: NormalizedStop[]): boolean {
    if (stops.length < 2) {
        return false;
    }

    const last = stops[stops.length - 1];
    const previous = stops[stops.length - 2];
    const lastKey = stopPairKey(last);
    const previousKey = stopPairKey(previous);

    return Boolean(lastKey && lastKey === previousKey);
}

export function resolveNormalizationStatus(
    blockingErrors: NormalizationIssue[],
): NormalizationStatus {
    if (blockingErrors.some((issue) => issue.code === BLOCKING_ERROR_CODES.DIRTY_STOP_NAME_MY_PLACEHOLDER)) {
        return "blocked_dirty_stop_data";
    }
    if (blockingErrors.some((issue) => issue.code === BLOCKING_ERROR_CODES.DIRTY_STOP_NAME_EN_METADATA)) {
        return "blocked_dirty_stop_data";
    }
    if (blockingErrors.length > 0) {
        return "blocked_invalid_structure";
    }
    return "ready_for_phase6";
}

export function computeQualityScore(
    status: NormalizationStatus,
    blockingErrors: NormalizationIssue[],
    normalizationWarnings: NormalizationIssue[],
): number {
    if (status === "blocked_dirty_stop_data") {
        return Math.max(0, 15 - blockingErrors.length * 3);
    }

    if (status === "blocked_invalid_structure") {
        return Math.max(0, 25 - blockingErrors.length * 4);
    }

    if (status === "needs_manual_fix") {
        return Math.max(45, 100 - normalizationWarnings.length * 7);
    }

    if (normalizationWarnings.length > 0) {
        return Math.max(80, 100 - normalizationWarnings.length * 4);
    }

    return 100;
}

export function normalizeMergedRoute(
    input: MergedRouteInput,
    sourcePath: string,
): NormalizedRoute {
    const blockingErrors: NormalizationIssue[] = [];
    const warnings: NormalizationIssue[] = [];
    const normalizedAt = new Date().toISOString();

    const route = normalizeRouteFields(input.route);
    const routeDisplayNames = normalizeYbsRouteDisplayNames({
        route_code:
            normalizeTextValue(route.route_code) ??
            normalizeTextValue(input.route_detail_identity?.route_code_candidate) ??
            normalizeTextValue(input.route_index_identity?.route_code_candidate) ??
            null,
        route_number: normalizeNumberValue(route.route_number),
        route_name_my: normalizeTextValue(route.route_name_my),
        route_name_en:
            normalizeTextValue(route.route_name_en) ??
            normalizeTextValue(input.route_detail_identity?.route_name_en) ??
            null,
        route_title_my:
            normalizeTextValue(input.route_detail_identity?.route_title_my) ??
            normalizeTextValue(input.route_index_identity?.route_title_my) ??
            normalizeTextValue(route.route_name_my),
        route_title_en:
            normalizeTextValue(input.route_detail_identity?.route_title_en) ??
            normalizeTextValue(input.route_index_identity?.route_title_en) ??
            normalizeTextValue(route.route_detail_title_en_raw) ??
            null,
        variants: input.variants,
    });

    if (routeDisplayNames.route_code) {
        route.route_code = routeDisplayNames.route_code;
    }
    if (routeDisplayNames.display_code) {
        route.route_display_code = routeDisplayNames.display_code;
    }
    if (routeDisplayNames.extracted_route_number !== null) {
        route.route_number = routeDisplayNames.extracted_route_number;
    }
    if (routeDisplayNames.primary_name_my) {
        route.route_name_my = routeDisplayNames.primary_name_my;
        route.public_name = routeDisplayNames.public_name;
    }
    if (routeDisplayNames.primary_name_en) {
        route.route_name_en = routeDisplayNames.primary_name_en;
    }
    if (routeDisplayNames.origin_my) {
        route.origin_name_my = routeDisplayNames.origin_my;
    }
    if (routeDisplayNames.destination_my) {
        route.destination_name_my = routeDisplayNames.destination_my;
    }
    if (routeDisplayNames.origin_en) {
        route.origin_name_en = routeDisplayNames.origin_en;
    }
    if (routeDisplayNames.destination_en) {
        route.destination_name_en = routeDisplayNames.destination_en;
    }
    route.origin_name =
        routeDisplayNames.origin_en ?? routeDisplayNames.origin_my ?? null;
    route.destination_name =
        routeDisplayNames.destination_en ?? routeDisplayNames.destination_my ?? null;
    route.route_name_alias_und = routeDisplayNames.alias_und;
    route.source_title_my = routeDisplayNames.source_title_my;
    route.source_title_en = routeDisplayNames.source_title_en;

    for (const message of routeDisplayNames.validation_warnings) {
        warnings.push({
            code: WARNING_CODES.ROUTE_DISPLAY_NAME_WARNING,
            message,
        });
    }

    const routeCode = normalizeTextValue(route.route_code);
    const routeNameMy = normalizeTextValue(route.route_name_my);

    if (!routeCode) {
        blockingErrors.push({
            code: BLOCKING_ERROR_CODES.ROUTE_CODE_MISSING,
            message: "route.route_code is missing after normalization",
        });
    }

    if (!routeNameMy) {
        blockingErrors.push({
            code: BLOCKING_ERROR_CODES.ROUTE_NAME_MY_MISSING,
            message: "route.route_name_my is missing after normalization",
        });
    }

    const inputVariants = input.variants ?? [];
    const outboundInput = inputVariants.find((variant) => variant.direction_key === "outbound");
    const inboundInput = inputVariants.find((variant) => variant.direction_key === "inbound");
    const extraDirections = inputVariants
        .map((variant) => variant.direction_key)
        .filter((direction): direction is string => Boolean(direction))
        .filter((direction) => direction !== "outbound" && direction !== "inbound");

    for (const direction of extraDirections) {
        warnings.push({
            code: WARNING_CODES.EXTRA_VARIANT_DIRECTION_IGNORED,
            message: `Ignored non-standard variant direction: ${direction}`,
            direction_key: direction,
        });
    }

    if (!outboundInput) {
        blockingErrors.push({
            code: BLOCKING_ERROR_CODES.OUTBOUND_MISSING,
            message: "outbound variant is missing",
            direction_key: "outbound",
        });
    }

    if (!inboundInput) {
        blockingErrors.push({
            code: BLOCKING_ERROR_CODES.INBOUND_MISSING,
            message: "inbound variant is missing",
            direction_key: "inbound",
        });
    }

    const variants: NormalizedVariant[] = [];

    for (const direction of REQUIRED_DIRECTIONS) {
        const sourceVariant = direction === "outbound" ? outboundInput : inboundInput;
        if (!sourceVariant) {
            continue;
        }

        const rawStops = (sourceVariant.stops ?? []).map((stop) => normalizeStop(stop));

        if (rawStops.length === 0) {
            blockingErrors.push({
                code: BLOCKING_ERROR_CODES.DIRECTION_ZERO_STOPS,
                message: `${direction} has zero stops`,
                direction_key: direction,
            });
        }

        if (isBrokenSequence(rawStops)) {
            blockingErrors.push({
                code: BLOCKING_ERROR_CODES.STOP_SEQUENCE_BROKEN,
                message: `${direction} stop sequence is not continuous from 1`,
                direction_key: direction,
            });
        }

        for (const stop of rawStops) {
            if (isDirtyStopNameMy(stop.stop_name_my)) {
                blockingErrors.push({
                    code: BLOCKING_ERROR_CODES.DIRTY_STOP_NAME_MY_PLACEHOLDER,
                    message: `Dirty Myanmar placeholder stop name: ${stop.stop_name_my}`,
                    direction_key: direction,
                    sequence: stop.sequence,
                    field: "stop_name_my",
                });
            }

            if (isDirtyStopNameEn(stop.stop_name_en)) {
                blockingErrors.push({
                    code: BLOCKING_ERROR_CODES.DIRTY_STOP_NAME_EN_METADATA,
                    message: `Dirty English metadata stop name: ${stop.stop_name_en}`,
                    direction_key: direction,
                    sequence: stop.sequence,
                    field: "stop_name_en",
                });
            }

            if (hasMixedScriptEnglishArea(stop)) {
                warnings.push({
                    code: WARNING_CODES.MIXED_SCRIPT_ENGLISH_AREA,
                    message: `Mixed-script English area text at sequence ${stop.sequence}`,
                    direction_key: direction,
                    sequence: stop.sequence,
                    field: "area_text_en",
                });
            }
        }

        const stops = renumberStops(rawStops);

        if (hasAdjacentDuplicateTerminalStop(stops)) {
            const terminal = stops[stops.length - 1];
            warnings.push({
                code: WARNING_CODES.ADJACENT_DUPLICATE_TERMINAL_STOP,
                message: `Adjacent duplicate terminal stop: ${terminal.stop_name_my ?? terminal.stop_name_en ?? "unknown"}`,
                direction_key: direction,
                sequence: terminal.sequence,
            });
        }

        const normalizedVariant: NormalizedVariant = {
            ...sourceVariant,
            direction_key: direction,
            direction_name: direction,
            stops,
        };

        if (sourceVariant.parser_diagnostics) {
            normalizedVariant.parser_diagnostics = sourceVariant.parser_diagnostics;
        }

        variants.push(normalizedVariant);
    }

    const routeNameEn = normalizeTextValue(route.route_name_en);
    if (!routeNameEn) {
        warnings.push({
            code: WARNING_CODES.ROUTE_NAME_EN_MISSING,
            message: "route.route_name_en is missing",
        });
    }

    const operatorName = normalizeTextValue(route.operator_name);
    if (!operatorName) {
        warnings.push({
            code: WARNING_CODES.OPERATOR_NAME_MISSING,
            message: "route.operator_name is missing",
        });
    }

    if (!hasFare(route)) {
        warnings.push({
            code: WARNING_CODES.FARE_MISSING,
            message: "route fare fields are all missing",
        });
    }

    const appTotalStopCount = normalizeNumberValue(route.app_total_stop_count);
    const directionStopCountSum = variants.reduce((sum, variant) => sum + variant.stops.length, 0);
    if (appTotalStopCount !== null && appTotalStopCount !== directionStopCountSum) {
        warnings.push({
            code: WARNING_CODES.APP_TOTAL_STOP_COUNT_MISMATCH,
            message: `route.app_total_stop_count (${appTotalStopCount}) does not match outbound+inbound stop count (${directionStopCountSum})`,
        });
    }

    let normalizationStatus = resolveNormalizationStatus(blockingErrors);
    if (normalizationStatus === "ready_for_phase6" && warnings.length > 0) {
        normalizationStatus = "needs_manual_fix";
    }

    const qualityScore = computeQualityScore(
        normalizationStatus,
        blockingErrors,
        warnings,
    );

    return {
        normalization_schema_version: NORMALIZATION_SCHEMA_VERSION,
        extraction_schema_version:
            typeof input.extraction_schema_version === "number"
                ? input.extraction_schema_version
                : MERGED_INPUT_SCHEMA_VERSION,
        normalized_at: normalizedAt,
        source_merged_path: sourcePath,
        normalization_status: normalizationStatus,
        quality_score: qualityScore,
        blocking_errors: blockingErrors,
        warnings,
        source_warnings: [...(input.warnings ?? [])],
        source: input.source,
        route_index_identity: input.route_index_identity ?? null,
        route_detail_identity: input.route_detail_identity,
        route,
        route_display_names: routeDisplayNames,
        variants,
        validation: input.validation,
        extraction: input.extraction,
        merge: input.merge,
    };
}
