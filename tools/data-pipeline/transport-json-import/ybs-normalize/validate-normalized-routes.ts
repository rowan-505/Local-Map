/**
 * Validate Phase 5 normalized YBS route JSON files.
 *
 * Does not touch the database.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import {
    MERGED_INPUT_SCHEMA_VERSION,
    NORMALIZATION_SCHEMA_VERSION,
    REQUIRED_DIRECTIONS,
    type NormalizationStatus,
    type NormalizedRoute,
} from "./normalization-rules.js";

export type ValidationSeverity = "error" | "warning";

export type ValidationFinding = {
    check_id: string;
    severity: ValidationSeverity;
    message: string;
    file?: string;
};

export type NormalizedRoutesValidationReport = {
    generated_at: string;
    input_dir: string;
    summary: {
        files_checked: number;
        error_count: number;
        warning_count: number;
        passed: boolean;
        status_counts: Record<NormalizationStatus, number>;
    };
    findings: ValidationFinding[];
};

const ALLOWED_STATUSES = new Set<NormalizationStatus>([
    "ready_for_phase6",
    "needs_manual_fix",
    "blocked_invalid_structure",
    "blocked_dirty_stop_data",
]);

function repoRoot(): string {
    return process.cwd();
}

function resolveFromRepo(relativePath: string): string {
    return path.isAbsolute(relativePath)
        ? relativePath
        : path.join(repoRoot(), relativePath);
}

function listJsonFiles(dir: string): string[] {
    if (!fs.existsSync(dir)) {
        return [];
    }

    return fs
        .readdirSync(dir)
        .filter((name) => name.endsWith(".json"))
        .map((name) => path.join(dir, name))
        .sort((left, right) => left.localeCompare(right));
}

function readJsonFile<T>(filePath: string): T {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function pushFinding(
    findings: ValidationFinding[],
    finding: ValidationFinding,
): void {
    findings.push(finding);
}

function isNullOrEmpty(value: unknown): boolean {
    return value === null || value === undefined || value === "";
}

function validateNormalizedRoute(filePath: string, raw: NormalizedRoute): ValidationFinding[] {
    const findings: ValidationFinding[] = [];

    if (raw.normalization_schema_version !== NORMALIZATION_SCHEMA_VERSION) {
        pushFinding(findings, {
            check_id: "normalization_schema_version_mismatch",
            severity: "error",
            message: `normalization_schema_version must be ${NORMALIZATION_SCHEMA_VERSION}`,
            file: filePath,
        });
    }

    if (raw.extraction_schema_version !== MERGED_INPUT_SCHEMA_VERSION) {
        pushFinding(findings, {
            check_id: "extraction_schema_version_unexpected",
            severity: "warning",
            message: `extraction_schema_version is ${raw.extraction_schema_version}, expected ${MERGED_INPUT_SCHEMA_VERSION}`,
            file: filePath,
        });
    }

    if (!ALLOWED_STATUSES.has(raw.normalization_status)) {
        pushFinding(findings, {
            check_id: "invalid_normalization_status",
            severity: "error",
            message: `Invalid normalization_status: ${String(raw.normalization_status)}`,
            file: filePath,
        });
    }

    if (typeof raw.quality_score !== "number" || raw.quality_score < 0 || raw.quality_score > 100) {
        pushFinding(findings, {
            check_id: "invalid_quality_score",
            severity: "error",
            message: "quality_score must be a number from 0 to 100",
            file: filePath,
        });
    }

    if (!Array.isArray(raw.blocking_errors) || !Array.isArray(raw.warnings)) {
        pushFinding(findings, {
            check_id: "missing_issue_arrays",
            severity: "error",
            message: "blocking_errors and warnings must be arrays",
            file: filePath,
        });
    }

    const routeCode = raw.route?.route_code;
    if (isNullOrEmpty(routeCode)) {
        pushFinding(findings, {
            check_id: "route_code_missing",
            severity: "error",
            message: "route.route_code is missing",
            file: filePath,
        });
    }

    for (const field of ["route_number", "fare_min", "fare_max"] as const) {
        const value = raw.route?.[field];
        if (value !== null && value !== undefined && typeof value !== "number") {
            pushFinding(findings, {
                check_id: "invalid_numeric_route_field",
                severity: "error",
                message: `route.${field} must be a number or null`,
                file: filePath,
            });
        }
    }

    const variants = raw.variants ?? [];
    const directionKeys = variants.map((variant) => variant.direction_key);

    for (const direction of REQUIRED_DIRECTIONS) {
        if (!directionKeys.includes(direction)) {
            pushFinding(findings, {
                check_id: `missing_${direction}_variant`,
                severity: "error",
                message: `Missing ${direction} variant`,
                file: filePath,
            });
        }
    }

    for (const variant of variants) {
        const stops = variant.stops ?? [];
        const expectedSequences = Array.from({ length: stops.length }, (_, index) => index + 1);
        const actualSequences = stops.map((stop) => stop.sequence);

        if (actualSequences.some((sequence) => typeof sequence !== "number")) {
            pushFinding(findings, {
                check_id: "invalid_stop_sequence_type",
                severity: "error",
                message: `Variant ${variant.direction_key} has non-numeric stop.sequence values`,
                file: filePath,
            });
        } else if (actualSequences.join(",") !== expectedSequences.join(",")) {
            pushFinding(findings, {
                check_id: "stop_sequence_not_one_based",
                severity: "error",
                message: `Variant ${variant.direction_key} stop sequence must start at 1 and increase by 1`,
                file: filePath,
            });
        }

        for (const stop of stops) {
            for (const field of ["stop_name_my", "stop_name_en", "area_text_my", "area_text_en"] as const) {
                const value = stop[field];
                if (value !== null && value !== undefined && typeof value !== "string") {
                    pushFinding(findings, {
                        check_id: "invalid_stop_text_field_type",
                        severity: "error",
                        message: `Stop ${stop.sequence} field ${field} must be string or null`,
                        file: filePath,
                    });
                }
            }
        }

        if (!variant.parser_diagnostics && raw.normalization_status !== "blocked_invalid_structure") {
            pushFinding(findings, {
                check_id: "parser_diagnostics_missing",
                severity: "warning",
                message: `Variant ${variant.direction_key} is missing parser_diagnostics`,
                file: filePath,
            });
        }
    }

    if (!Array.isArray(raw.source_warnings)) {
        pushFinding(findings, {
            check_id: "source_warnings_missing",
            severity: "warning",
            message: "source_warnings array from merged source is missing",
            file: filePath,
        });
    }

    const hasBlocking = raw.blocking_errors.length > 0;
    const hasWarnings = raw.warnings.length > 0;

    if (raw.normalization_status === "ready_for_phase6" && (hasBlocking || hasWarnings)) {
        pushFinding(findings, {
            check_id: "ready_status_with_issues",
            severity: "error",
            message: "ready_for_phase6 route must not have blocking errors or warnings",
            file: filePath,
        });
    }

    if (raw.normalization_status === "needs_manual_fix" && (hasBlocking || !hasWarnings)) {
        pushFinding(findings, {
            check_id: "needs_manual_fix_status_mismatch",
            severity: "error",
            message: "needs_manual_fix route must have warnings and no blocking errors",
            file: filePath,
        });
    }

    if (
        (raw.normalization_status === "blocked_invalid_structure" ||
            raw.normalization_status === "blocked_dirty_stop_data") &&
        !hasBlocking
    ) {
        pushFinding(findings, {
            check_id: "blocked_status_without_errors",
            severity: "error",
            message: "Blocked route must have at least one blocking error",
            file: filePath,
        });
    }

    return findings;
}

export function validateNormalizedRoutes(inputDir: string): NormalizedRoutesValidationReport {
    const resolvedInputDir = resolveFromRepo(inputDir);
    const files = listJsonFiles(resolvedInputDir);
    const findings: ValidationFinding[] = [];
    const statusCounts: Record<NormalizationStatus, number> = {
        ready_for_phase6: 0,
        needs_manual_fix: 0,
        blocked_invalid_structure: 0,
        blocked_dirty_stop_data: 0,
    };

    for (const filePath of files) {
        try {
            const raw = readJsonFile<NormalizedRoute>(filePath);
            if (ALLOWED_STATUSES.has(raw.normalization_status)) {
                statusCounts[raw.normalization_status] += 1;
            }
            findings.push(...validateNormalizedRoute(filePath, raw));
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            pushFinding(findings, {
                check_id: "json_parse_failed",
                severity: "error",
                message,
                file: filePath,
            });
        }
    }

    const errorCount = findings.filter((finding) => finding.severity === "error").length;
    const warningCount = findings.filter((finding) => finding.severity === "warning").length;

    return {
        generated_at: new Date().toISOString(),
        input_dir: resolvedInputDir,
        summary: {
            files_checked: files.length,
            error_count: errorCount,
            warning_count: warningCount,
            passed: errorCount === 0,
            status_counts: statusCounts,
        },
        findings,
    };
}

function main(): void {
    let inputDir = "tmp/transport-imports/ybs-all/normalized/routes";

    for (let index = 0; index < process.argv.length; index++) {
        const arg = process.argv[index];
        const next = process.argv[index + 1];
        if ((arg === "--input-dir" || arg === "--run") && next) {
            inputDir =
                arg === "--run"
                    ? path.join(next.trim(), "normalized", "routes")
                    : next.trim();
            index++;
        }
    }

    const report = validateNormalizedRoutes(inputDir);
    const reportPath = path.join(
        resolveFromRepo(path.dirname(path.dirname(inputDir))),
        "reports",
        "phase5-normalized-validation.json",
    );

    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

    console.log(`Validated ${report.summary.files_checked} normalized route file(s).`);
    console.log(`Errors: ${report.summary.error_count}`);
    console.log(`Warnings: ${report.summary.warning_count}`);
    console.log(`Passed: ${report.summary.passed}`);
    console.log(`Report: ${reportPath}`);

    if (!report.summary.passed) {
        process.exitCode = 1;
    }
}

const isMainModule =
    process.argv[1] &&
    path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);

if (isMainModule) {
    main();
}
