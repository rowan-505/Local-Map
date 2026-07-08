/**
 * Validate Phase 4 YBS extraction folder layout and route JSON quality.
 *
 * Does not touch the database.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import {
    defaultConfig,
    ensureRunLayout,
    languageRoutesDir,
    reportsDir,
    resolveFromRepo,
    routeIndexPath,
    type ExtractionLanguage,
    type YbsExtractionConfig,
} from "./config.js";
import {
    buildEnglishRouteNameFields,
    generateEnglishRouteNameFromVariants,
    isMyanmarText,
    type EnglishRouteNameVariant,
} from "./english-route-name.js";
import { validateRouteIdentity, type RouteIdentityValidationReport } from "./validate-route-identity.js";
import {
    BLOCKED_STOP_METADATA_IN_STOPS,
    isBlockedStopMetadataText,
} from "./parse-ui-xml.js";
import { MERGED_EXTRACTION_SCHEMA_VERSION } from "./merge-language-routes.js";

export type Phase4ValidationSeverity = "error" | "warning";

export type Phase4ValidationFinding = {
    check_id: string;
    severity: Phase4ValidationSeverity;
    message: string;
    file?: string;
    category?: string;
};

export type Phase4OutputValidationReport = {
    generated_at: string;
    run_root: string;
    summary: {
        error_count: number;
        warning_count: number;
        passed: boolean;
        my_route_count: number;
        en_route_count: number;
        merged_route_count: number;
        files_checked: number;
    };
    layout_checks: Phase4ValidationFinding[];
    route_checks: Phase4ValidationFinding[];
    identity_validation?: RouteIdentityValidationReport;
};

const REQUIRED_DIRS = [
    "route-index",
    "route-index/page-sources",
    "my/routes",
    "my/page-sources",
    "my/screenshots",
    "en/routes",
    "en/page-sources",
    "en/screenshots",
    "merged/routes",
    "reports",
] as const;

const FINAL_REPORT_JSON = "final-phase4-validation.json";
const FINAL_REPORT_MD = "final-phase4-validation.md";

const LATIN_CHAR_PATTERN = /[A-Za-z]/;
const MYANMAR_CHAR_PATTERN = /[\u1000-\u109F]/;

type StopRow = {
    sequence?: unknown;
    stop_name_my?: string | null;
    stop_name_en?: string | null;
    area_text_my?: string | null;
    area_text_en?: string | null;
    raw_text_my?: string | null;
    raw_text_en?: string | null;
};

type VariantRow = {
    direction_key?: string;
    stop_count?: unknown;
    real_stop_count?: unknown;
    loading_placeholder_count?: unknown;
    quality_status?: string;
    loading_placeholders?: Array<Record<string, unknown>>;
    stops?: StopRow[];
};

type RouteFile = {
    extraction_schema_version?: unknown;
    route?: Record<string, unknown>;
    variants?: VariantRow[];
    warnings?: string[];
    validation?: {
        loading_placeholder_count?: unknown;
        quality_status?: string;
    };
    extraction?: {
        extraction_status?: string;
        quality_status?: string;
        loading_placeholder_count?: unknown;
        outbound_stop_count?: unknown;
        inbound_stop_count?: unknown;
    };
};

type MergedRouteFile = RouteFile & {
    merge?: {
        myanmar_source_path?: string;
        english_source_path?: string;
        directions?: Record<string, unknown>;
    };
    myanmar?: RouteFile;
    english?: RouteFile;
    merged?: Record<string, unknown>;
};

const MYANMAR_PLACEHOLDER_STOP_PATTERN = /မှတ်တိုင်\s+အမှတ်/;

function listJsonFiles(dir: string): string[] {
    if (!fs.existsSync(dir)) {
        return [];
    }

    return fs
        .readdirSync(dir)
        .filter((name) => name.endsWith(".json"))
        .map((name) => path.join(dir, name));
}

function readJsonFile<T>(filePath: string): T {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function pushFinding(
    findings: Phase4ValidationFinding[],
    finding: Phase4ValidationFinding,
): void {
    findings.push(finding);
}

function isNullOrEmpty(value: unknown): boolean {
    return value === null || value === undefined || value === "";
}

function isValidNumberOrNull(value: unknown, fieldName: string, filePath: string): Phase4ValidationFinding | null {
    if (value === null || value === undefined) {
        return null;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
        return null;
    }
    return {
        check_id: "invalid_numeric_field",
        severity: "error",
        message: `${fieldName} must be a number or null, got ${typeof value}`,
        file: filePath,
        category: "numeric_fields",
    };
}

function isLatinOrEnglishText(text: string): boolean {
    const latin = (text.match(new RegExp(LATIN_CHAR_PATTERN.source, "g")) ?? []).length;
    const myanmar = (text.match(new RegExp(MYANMAR_CHAR_PATTERN.source, "g")) ?? []).length;

    if (latin > 0) {
        return true;
    }

    return myanmar === 0 && text.trim().length > 0;
}

function validateNumericFields(route: Record<string, unknown>, variants: VariantRow[], filePath: string): Phase4ValidationFinding[] {
    const findings: Phase4ValidationFinding[] = [];
    const routeFields = ["route_number", "fare_min", "fare_max", "app_total_stop_count"] as const;

    for (const field of routeFields) {
        const finding = isValidNumberOrNull(route[field], `route.${field}`, filePath);
        if (finding) {
            pushFinding(findings, finding);
        }
    }

    for (const variant of variants) {
        const variantStopCount = isValidNumberOrNull(
            variant.stop_count,
            `variants.${variant.direction_key ?? "unknown"}.stop_count`,
            filePath,
        );
        if (variantStopCount) {
            pushFinding(findings, variantStopCount);
        }

        for (const stop of variant.stops ?? []) {
            const sequenceFinding = isValidNumberOrNull(stop.sequence, "stop.sequence", filePath);
            if (sequenceFinding) {
                pushFinding(findings, sequenceFinding);
            }
        }
    }

    return findings;
}

function isExtractionFailed(raw: RouteFile): boolean {
    const status = raw.extraction?.extraction_status ?? raw.route?.extraction_status;
    if (status === "failed") {
        return true;
    }

    const warnings = raw.warnings ?? [];
    return warnings.some(
        (warning) =>
            warning.includes('Stopped before extraction because "inbound"') ||
            warning.includes("inbound tab could not be selected") ||
            warning.includes("Final inbound stop list is empty"),
    );
}

function validateDirectionVariants(raw: RouteFile, filePath: string): Phase4ValidationFinding[] {
    const findings: Phase4ValidationFinding[] = [];
    const variants = raw.variants ?? [];
    const outbound = variants.find((variant) => variant.direction_key === "outbound");
    const inbound = variants.find((variant) => variant.direction_key === "inbound");
    const failed = isExtractionFailed(raw);

    if (!outbound) {
        pushFinding(findings, {
            check_id: "missing_outbound_variant",
            severity: "error",
            message: "Route file is missing outbound variant",
            file: filePath,
            category: "direction",
        });
    }

    if (!inbound) {
        pushFinding(findings, {
            check_id: "missing_inbound_variant",
            severity: "error",
            message: "Route file is missing inbound variant",
            file: filePath,
            category: "direction",
        });
    }

    const inboundStopCount =
        typeof inbound?.stop_count === "number"
            ? inbound.stop_count
            : (inbound?.stops?.length ?? 0);

    if (inbound && inboundStopCount === 0 && !failed) {
        pushFinding(findings, {
            check_id: "inbound_stop_count_zero",
            severity: "error",
            message: "inbound.stop_count is 0 but extraction_status is not failed",
            file: filePath,
            category: "direction",
        });
    }

    if (outbound && typeof outbound.stop_count === "number" && outbound.stops) {
        if (outbound.stop_count !== outbound.stops.length) {
            pushFinding(findings, {
                check_id: "outbound_stop_count_mismatch",
                severity: "warning",
                message: `outbound.stop_count (${outbound.stop_count}) does not match stops array length (${outbound.stops.length})`,
                file: filePath,
                category: "direction",
            });
        }
    }

    if (inbound && typeof inbound.stop_count === "number" && inbound.stops) {
        if (inbound.stop_count !== inbound.stops.length) {
            pushFinding(findings, {
                check_id: "inbound_stop_count_mismatch",
                severity: "warning",
                message: `inbound.stop_count (${inbound.stop_count}) does not match stops array length (${inbound.stops.length})`,
                file: filePath,
                category: "direction",
            });
        }
    }

    return findings;
}

function validateBlockedMetadataInStop(stop: StopRow, filePath: string): Phase4ValidationFinding[] {
    const findings: Phase4ValidationFinding[] = [];
    const fields: Array<{ field: string; value: unknown }> = [
        { field: "stop_name_my", value: stop.stop_name_my },
        { field: "stop_name_en", value: stop.stop_name_en },
        { field: "area_text_my", value: stop.area_text_my },
        { field: "area_text_en", value: stop.area_text_en },
    ];

    for (const { field, value } of fields) {
        if (isNullOrEmpty(value)) {
            continue;
        }
        const trimmed = String(value).trim();
        if (isBlockedStopMetadataText(trimmed)) {
            pushFinding(findings, {
                check_id: BLOCKED_STOP_METADATA_IN_STOPS,
                severity: "error",
                message: `Blocked metadata text in stop list (${field}): ${trimmed}`,
                file: filePath,
                category: "stop_metadata",
            });
        }
    }

    return findings;
}

function validateEnglishStopRow(stop: StopRow, filePath: string): Phase4ValidationFinding[] {
    const findings: Phase4ValidationFinding[] = [];
    findings.push(...validateBlockedMetadataInStop(stop, filePath));

    if (!isNullOrEmpty(stop.stop_name_my)) {
        pushFinding(findings, {
            check_id: "english_stop_name_my_not_null",
            severity: "error",
            message: "English extraction stop_name_my must be null",
            file: filePath,
            category: "english_language_fields",
        });
    }

    if (!isNullOrEmpty(stop.area_text_my)) {
        pushFinding(findings, {
            check_id: "english_area_text_my_not_null",
            severity: "error",
            message: "English extraction area_text_my must be null",
            file: filePath,
            category: "english_language_fields",
        });
    }

    if (!isNullOrEmpty(stop.raw_text_my)) {
        pushFinding(findings, {
            check_id: "english_raw_text_my_not_null",
            severity: "error",
            message: "English extraction raw_text_my must be null",
            file: filePath,
            category: "english_language_fields",
        });
    }

    if (!isNullOrEmpty(stop.stop_name_en) && !isLatinOrEnglishText(String(stop.stop_name_en))) {
        pushFinding(findings, {
            check_id: "english_stop_name_en_not_latin",
            severity: "error",
            message: "English extraction stop_name_en must be Latin/English text or null",
            file: filePath,
            category: "english_language_fields",
        });
    }

    if (!isNullOrEmpty(stop.area_text_en) && !isLatinOrEnglishText(String(stop.area_text_en))) {
        pushFinding(findings, {
            check_id: "english_area_text_en_not_latin",
            severity: "error",
            message: "English extraction area_text_en must be Latin/English text or null",
            file: filePath,
            category: "english_language_fields",
        });
    }

    if (!isNullOrEmpty(stop.raw_text_en) && isMyanmarText(String(stop.raw_text_en))) {
        pushFinding(findings, {
            check_id: "english_raw_text_en_myanmar",
            severity: "error",
            message: "English extraction raw_text_en must not be Myanmar-only text",
            file: filePath,
            category: "english_language_fields",
        });
    }

    return findings;
}

function validateMyanmarStopRow(stop: StopRow, filePath: string): Phase4ValidationFinding[] {
    const findings: Phase4ValidationFinding[] = [];
    findings.push(...validateBlockedMetadataInStop(stop, filePath));

    if (!isNullOrEmpty(stop.stop_name_en)) {
        pushFinding(findings, {
            check_id: "myanmar_stop_name_en_not_null",
            severity: "error",
            message: "Myanmar extraction stop_name_en must be null before merge",
            file: filePath,
            category: "myanmar_language_fields",
        });
    }

    if (!isNullOrEmpty(stop.area_text_en)) {
        pushFinding(findings, {
            check_id: "myanmar_area_text_en_not_null",
            severity: "error",
            message: "Myanmar extraction area_text_en must be null before merge",
            file: filePath,
            category: "myanmar_language_fields",
        });
    }

    if (!isNullOrEmpty(stop.raw_text_en)) {
        pushFinding(findings, {
            check_id: "myanmar_raw_text_en_not_null",
            severity: "error",
            message: "Myanmar extraction raw_text_en must be null before merge",
            file: filePath,
            category: "myanmar_language_fields",
        });
    }

    return findings;
}

function validateEnglishRouteNames(raw: RouteFile, filePath: string): Phase4ValidationFinding[] {
    const findings: Phase4ValidationFinding[] = [];
    const route = raw.route ?? {};
    const routeNameEn = route.route_name_en;
    const routeDetailTitleEnRaw = route.route_detail_title_en_raw;
    const routeNameMy = route.route_name_my;

    if (!isNullOrEmpty(routeNameMy)) {
        pushFinding(findings, {
            check_id: "english_route_name_my_not_null",
            severity: "error",
            message: "English extraction route.route_name_my must be null",
            file: filePath,
            category: "route_name",
        });
    }

    if (typeof routeDetailTitleEnRaw === "string" && isMyanmarText(routeDetailTitleEnRaw)) {
        if (routeNameEn === routeDetailTitleEnRaw) {
            pushFinding(findings, {
                check_id: "english_route_name_from_myanmar_title",
                severity: "error",
                message: "route_name_en must not equal Myanmar detail title; use route_detail_title_en_raw only",
                file: filePath,
                category: "route_name",
            });
        }
    }

    const expected = buildEnglishRouteNameFields({
        variants: (raw.variants ?? []) as EnglishRouteNameVariant[],
        detailTitleRaw:
            typeof routeDetailTitleEnRaw === "string"
                ? routeDetailTitleEnRaw
                : typeof route.route_name_my === "string"
                  ? route.route_name_my
                  : null,
    });

    if (routeNameEn !== expected.route_name_en) {
        pushFinding(findings, {
            check_id: "english_route_name_en_mismatch",
            severity: "error",
            message: `route_name_en should be "${expected.route_name_en ?? "null"}" (generated from English endpoints)`,
            file: filePath,
            category: "route_name",
        });
    }

    if (route.route_name_en_source !== expected.route_name_en_source) {
        pushFinding(findings, {
            check_id: "english_route_name_en_source_mismatch",
            severity: "error",
            message: `route_name_en_source should be "${expected.route_name_en_source}"`,
            file: filePath,
            category: "route_name",
        });
    }

    if (route.route_name_en_confidence !== expected.route_name_en_confidence) {
        pushFinding(findings, {
            check_id: "english_route_name_en_confidence_mismatch",
            severity: "warning",
            message: `route_name_en_confidence should be ${expected.route_name_en_confidence}`,
            file: filePath,
            category: "route_name",
        });
    }

    if (route.needs_route_name_review !== expected.needs_route_name_review) {
        pushFinding(findings, {
            check_id: "english_needs_route_name_review_mismatch",
            severity: "warning",
            message: `needs_route_name_review should be ${expected.needs_route_name_review}`,
            file: filePath,
            category: "route_name",
        });
    }

    return findings;
}

function validateMyanmarRouteNames(raw: RouteFile, filePath: string): Phase4ValidationFinding[] {
    const findings: Phase4ValidationFinding[] = [];
    const route = raw.route ?? {};

    if (isNullOrEmpty(route.route_name_my)) {
        pushFinding(findings, {
            check_id: "myanmar_route_name_my_missing",
            severity: "error",
            message: "Myanmar extraction route.route_name_my must be set",
            file: filePath,
            category: "route_name",
        });
    }

    if (!isNullOrEmpty(route.route_name_en)) {
        pushFinding(findings, {
            check_id: "myanmar_route_name_en_not_null",
            severity: "error",
            message: "Myanmar extraction route.route_name_en must be null before merge",
            file: filePath,
            category: "route_name",
        });
    }

    if (!isNullOrEmpty(route.route_detail_title_en_raw)) {
        pushFinding(findings, {
            check_id: "myanmar_route_detail_title_en_raw_set",
            severity: "warning",
            message: "Myanmar extraction should not set route_detail_title_en_raw",
            file: filePath,
            category: "route_name",
        });
    }

    return findings;
}

function validateEnglishRouteFile(filePath: string): Phase4ValidationFinding[] {
    const raw = readJsonFile<RouteFile>(filePath);
    const findings: Phase4ValidationFinding[] = [];

    findings.push(...validateNumericFields(raw.route ?? {}, raw.variants ?? [], filePath));
    findings.push(...validateDirectionVariants(raw, filePath));
    findings.push(...validateEnglishRouteNames(raw, filePath));

    for (const variant of raw.variants ?? []) {
        for (const stop of variant.stops ?? []) {
            findings.push(...validateEnglishStopRow(stop, filePath));
        }
    }

    return findings;
}

function validateMyanmarRouteFile(filePath: string): Phase4ValidationFinding[] {
    const raw = readJsonFile<RouteFile>(filePath);
    const findings: Phase4ValidationFinding[] = [];

    if (!raw.extraction_schema_version && raw.route?.route_code) {
        pushFinding(findings, {
            check_id: "legacy_myanmar_schema",
            severity: "warning",
            message: "File uses legacy schema (route_code, partial extraction). Re-extract with Stage 8.",
            file: filePath,
            category: "schema",
        });
    }

    findings.push(...validateNumericFields(raw.route ?? {}, raw.variants ?? [], filePath));
    findings.push(...validateDirectionVariants(raw, filePath));
    findings.push(...validateMyanmarRouteNames(raw, filePath));

    for (const variant of raw.variants ?? []) {
        for (const stop of variant.stops ?? []) {
            findings.push(...validateMyanmarStopRow(stop, filePath));
        }
    }

    return findings;
}

function validateMergedRouteFile(filePath: string): Phase4ValidationFinding[] {
    const raw = readJsonFile<MergedRouteFile>(filePath);
    const findings: Phase4ValidationFinding[] = [];

    if (raw.myanmar || raw.english || raw.merged) {
        pushFinding(findings, {
            check_id: "merged_legacy_schema",
            severity: "error",
            message:
                "Merged file uses legacy nested schema (myanmar/english/merged). Re-run merge-language-routes.ts.",
            file: filePath,
            category: "merged",
        });
        return findings;
    }

    if (raw.extraction_schema_version !== MERGED_EXTRACTION_SCHEMA_VERSION) {
        pushFinding(findings, {
            check_id: "merged_schema_version",
            severity: "error",
            message: `Merged file extraction_schema_version must be ${MERGED_EXTRACTION_SCHEMA_VERSION}`,
            file: filePath,
            category: "merged",
        });
    }

    if (!Array.isArray(raw.variants) || raw.variants.length === 0) {
        pushFinding(findings, {
            check_id: "merged_missing_variants",
            severity: "error",
            message: "Merged file must include variants[] with outbound and inbound directions",
            file: filePath,
            category: "merged",
        });
        return findings;
    }

    const route = raw.route ?? {};
    const requiredDirections = ["outbound", "inbound"];

    for (const direction of requiredDirections) {
        const variant = raw.variants.find((row) => row.direction_key === direction);
        if (!variant) {
            pushFinding(findings, {
                check_id: "merged_missing_direction",
                severity: "error",
                message: `Merged file missing variant for direction "${direction}"`,
                file: filePath,
                category: "merged",
            });
            continue;
        }

        const mergeStatus = (variant as { merge_status?: string }).merge_status;
        if (mergeStatus === "blocked_count_mismatch") {
            continue;
        }

        if (!Array.isArray(variant.stops) || variant.stops.length === 0) {
            pushFinding(findings, {
                check_id: "merged_variant_missing_stops",
                severity: "error",
                message: `Merged variant "${direction}" must include stops[]`,
                file: filePath,
                category: "merged",
            });
        }
    }

    if (isNullOrEmpty(route.route_name_my)) {
        pushFinding(findings, {
            check_id: "merged_route_name_my_missing",
            severity: "error",
            message: "Merged route.route_name_my must come from Myanmar extraction",
            file: filePath,
            category: "merged",
        });
    }

    if (isNullOrEmpty(route.route_name_en)) {
        pushFinding(findings, {
            check_id: "merged_route_name_en_missing",
            severity: "error",
            message: "Merged route.route_name_en must come from English extraction",
            file: filePath,
            category: "merged",
        });
    }

    const myanmarSourcePath = raw.merge?.myanmar_source_path;
    if (myanmarSourcePath && fs.existsSync(myanmarSourcePath)) {
        const myanmar = readJsonFile<RouteFile>(myanmarSourcePath);
        if (route.route_name_my !== myanmar.route?.route_name_my) {
            pushFinding(findings, {
                check_id: "merged_route_name_my_source",
                severity: "error",
                message: "route.route_name_my must match Myanmar extraction only",
                file: filePath,
                category: "merged",
            });
        }
    }

    const englishSourcePath = raw.merge?.english_source_path;
    if (englishSourcePath && fs.existsSync(englishSourcePath)) {
        const english = readJsonFile<RouteFile>(englishSourcePath);
        if (route.route_name_en !== english.route?.route_name_en) {
            pushFinding(findings, {
                check_id: "merged_route_name_en_source",
                severity: "error",
                message: "route.route_name_en must match English extraction only",
                file: filePath,
                category: "merged",
            });
        }

        if (route.route_detail_title_en_raw !== english.route?.route_detail_title_en_raw) {
            pushFinding(findings, {
                check_id: "merged_route_detail_title_en_raw",
                severity: "error",
                message: "route.route_detail_title_en_raw must match English extraction",
                file: filePath,
                category: "merged",
            });
        }

        if (!english.route_index_identity && raw.route_index_identity) {
            pushFinding(findings, {
                check_id: "english_route_index_identity_missing",
                severity: "warning",
                message:
                    "English route_index_identity is missing; merged file uses Myanmar fallback",
                file: filePath,
                category: "merged",
            });
        }
    }

    const routeDetailIdentity = raw.route_detail_identity ?? {};
    if (isNullOrEmpty(routeDetailIdentity.route_name_en) && !isNullOrEmpty(route.route_name_en)) {
        pushFinding(findings, {
            check_id: "merged_route_detail_identity_route_name_en_missing",
            severity: "warning",
            message: "route_detail_identity.route_name_en should mirror route.route_name_en",
            file: filePath,
            category: "merged",
        });
    }

    const mergedExtraction = (raw as MergedRouteFile & { extraction?: Record<string, unknown> }).extraction;
    if (!mergedExtraction) {
        pushFinding(findings, {
            check_id: "merged_missing_extraction_block",
            severity: "warning",
            message: "Merged file should include extraction provenance from Myanmar and English sources",
            file: filePath,
            category: "merged",
        });
    }

    for (const variant of raw.variants) {
        for (const stop of variant.stops ?? []) {
            const stopNameEn = stop.stop_name_en;
            if (!isNullOrEmpty(stopNameEn) && isBlockedStopMetadataText(String(stopNameEn))) {
                pushFinding(findings, {
                    check_id: BLOCKED_STOP_METADATA_IN_STOPS,
                    severity: "error",
                    message: `Blocked metadata text in merged stop_name_en: ${stopNameEn}`,
                    file: filePath,
                    category: "merged",
                });
            }

            const stopNameMy = stop.stop_name_my;
            if (
                !isNullOrEmpty(stopNameMy) &&
                MYANMAR_PLACEHOLDER_STOP_PATTERN.test(String(stopNameMy))
            ) {
                pushFinding(findings, {
                    check_id: "merged_placeholder_stop_name_my",
                    severity: "error",
                    message: `Placeholder Myanmar stop name in merged stops: ${stopNameMy}`,
                    file: filePath,
                    category: "merged",
                });
            }
        }
    }

    return findings;
}

function validateLayout(runRoot: string): Phase4ValidationFinding[] {
    const findings: Phase4ValidationFinding[] = [];

    for (const relativeDir of REQUIRED_DIRS) {
        const absoluteDir = path.join(runRoot, relativeDir);
        if (!fs.existsSync(absoluteDir)) {
            pushFinding(findings, {
                check_id: "missing_output_dir",
                severity: "error",
                message: `Missing required folder: ${relativeDir}`,
                category: "layout",
            });
        }
    }

    const manifestPath = path.join(runRoot, "raw-extracted.json");
    if (!fs.existsSync(manifestPath)) {
        pushFinding(findings, {
            check_id: "missing_run_manifest",
            severity: "warning",
            message: "Missing run manifest: raw-extracted.json",
            category: "layout",
        });
    }

    return findings;
}

export type ValidatePhase4OutputOptions = {
    runRoot?: string;
    config?: Partial<YbsExtractionConfig>;
    language?: ExtractionLanguage;
    skipIdentityValidation?: boolean;
};

/** Validate Phase 4 folder layout and route JSON files. */
export function validatePhase4Output(
    options: ValidatePhase4OutputOptions = {},
): Phase4OutputValidationReport {
    const config = defaultConfig({
        outputRoot: options.runRoot,
        ...options.config,
    });
    const runRoot = resolveFromRepo(config.outputRoot);
    ensureRunLayout(config);

    const layoutChecks = validateLayout(runRoot);
    const routeChecks: Phase4ValidationFinding[] = [];

    const myRoutesDir = languageRoutesDir(config, "my");
    const enRoutesDir = languageRoutesDir(config, "en");
    const mergedRoutesDir = resolveFromRepo(path.join(config.outputRoot, "merged", "routes"));

    const myRouteFiles = listJsonFiles(myRoutesDir);
    const enRouteFiles = listJsonFiles(enRoutesDir);
    const mergedRouteFiles = listJsonFiles(mergedRoutesDir);

    if (!fs.existsSync(routeIndexPath(config, "my"))) {
        pushFinding(routeChecks, {
            check_id: "missing_route_index_my",
            severity: "warning",
            message: "Missing route-index/route-index-my.json",
            category: "layout",
        });
    }

    if (!fs.existsSync(routeIndexPath(config, "en"))) {
        pushFinding(routeChecks, {
            check_id: "missing_route_index_en",
            severity: "warning",
            message: "Missing route-index/route-index-en.json",
            category: "layout",
        });
    }

    for (const filePath of myRouteFiles) {
        routeChecks.push(...validateMyanmarRouteFile(filePath));
    }

    for (const filePath of enRouteFiles) {
        routeChecks.push(...validateEnglishRouteFile(filePath));
    }

    for (const filePath of mergedRouteFiles) {
        routeChecks.push(...validateMergedRouteFile(filePath));
    }

    let identityValidation: RouteIdentityValidationReport | undefined;
    if (!options.skipIdentityValidation) {
        identityValidation = validateRouteIdentity({
            runRoot: config.outputRoot,
            language: options.language ?? "my",
        });
        for (const finding of identityValidation.findings) {
            pushFinding(routeChecks, {
                check_id: `identity_${finding.check_id}`,
                severity: finding.severity,
                message: finding.message,
                file: finding.file,
                category: "identity",
            });
        }
    }

    const allFindings = [...layoutChecks, ...routeChecks];
    const errorCount = allFindings.filter((finding) => finding.severity === "error").length;
    const warningCount = allFindings.filter((finding) => finding.severity === "warning").length;

    return {
        generated_at: new Date().toISOString(),
        run_root: runRoot,
        summary: {
            error_count: errorCount,
            warning_count: warningCount,
            passed: errorCount === 0,
            my_route_count: myRouteFiles.length,
            en_route_count: enRouteFiles.length,
            merged_route_count: mergedRouteFiles.length,
            files_checked: myRouteFiles.length + enRouteFiles.length + mergedRouteFiles.length,
        },
        layout_checks: layoutChecks,
        route_checks: routeChecks,
        identity_validation: identityValidation,
    };
}

function writeReport(report: Phase4OutputValidationReport, config: YbsExtractionConfig): {
    jsonPath: string;
    mdPath: string;
} {
    const jsonPath = path.join(reportsDir(config), FINAL_REPORT_JSON);
    const mdPath = path.join(reportsDir(config), FINAL_REPORT_MD);

    fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
    fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

    const allFindings = [...report.layout_checks, ...report.route_checks];
    const byCategory = new Map<string, Phase4ValidationFinding[]>();

    for (const finding of allFindings) {
        const category = finding.category ?? "other";
        const bucket = byCategory.get(category) ?? [];
        bucket.push(finding);
        byCategory.set(category, bucket);
    }

    const lines = [
        "# Final Phase 4 validation",
        "",
        `- Run root: \`${report.run_root}\``,
        `- Generated: ${report.generated_at}`,
        `- Passed: ${report.summary.passed ? "yes" : "no"}`,
        `- Errors: ${report.summary.error_count}`,
        `- Warnings: ${report.summary.warning_count}`,
        `- Files checked: ${report.summary.files_checked}`,
        `- Myanmar routes: ${report.summary.my_route_count}`,
        `- English routes: ${report.summary.en_route_count}`,
        `- Merged routes: ${report.summary.merged_route_count}`,
        "",
        "## Checks",
        "",
        "- English extraction: Myanmar stop fields null; English fields Latin/English only",
        "- Myanmar extraction: English stop fields null before merge",
        "- Merged: route_name_my from Myanmar, route_name_en from English endpoints",
        "- Route names: Myanmar detail title on English screen stays in route_detail_title_en_raw",
        "- Directions: outbound + inbound required; inbound.stop_count > 0 unless failed",
        "- Numeric fields: route_number, fare_min, fare_max, app_total_stop_count, stop_count, sequence",
        "",
        "## Findings",
        "",
    ];

    if (allFindings.length === 0) {
        lines.push("- No findings.");
    } else {
        for (const [category, findings] of [...byCategory.entries()].sort(([a], [b]) => a.localeCompare(b))) {
            lines.push(`### ${category}`);
            lines.push("");
            for (const finding of findings) {
                lines.push(
                    `- [${finding.severity}] ${finding.check_id}: ${finding.message}${
                        finding.file ? ` (\`${finding.file}\`)` : ""
                    }`,
                );
            }
            lines.push("");
        }
    }

    fs.writeFileSync(mdPath, `${lines.join("\n")}\n`, "utf8");
    return { jsonPath, mdPath };
}

function parseCliArgs(argv: string[]): ValidatePhase4OutputOptions {
    const options: ValidatePhase4OutputOptions = {};

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        const next = argv[i + 1];

        if ((arg === "--run" || arg === "--output-root") && next) {
            options.runRoot = next;
            i++;
        } else if (arg === "--language" && next) {
            if (next !== "my" && next !== "en") {
                throw new Error('--language must be "my" or "en"');
            }
            options.language = next;
            i++;
        } else if (arg === "--skip-identity") {
            options.skipIdentityValidation = true;
        }
    }

    return options;
}

function main(): void {
    const options = parseCliArgs(process.argv.slice(2));
    const config = defaultConfig({ outputRoot: options.runRoot });
    const report = validatePhase4Output(options);
    const written = writeReport(report, config);

    console.log(`Wrote ${written.jsonPath}`);
    console.log(`Wrote ${written.mdPath}`);
    console.log(
        `Validation ${report.summary.passed ? "passed" : "failed"}: ${report.summary.error_count} error(s), ${report.summary.warning_count} warning(s)`,
    );

    if (!report.summary.passed) {
        process.exit(1);
    }
}

const isMain = resolveFromRepo(
    "tools/data-pipeline/transport-json-import/ybs-extraction/validate-phase4-output.ts",
);
if (process.argv[1] && path.resolve(process.argv[1]) === isMain) {
    try {
        main();
    } catch (error: unknown) {
        console.error(error);
        process.exit(1);
    }
}
