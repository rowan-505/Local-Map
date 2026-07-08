/**
 * Phase 5: normalize merged YBS route JSON files.
 *
 * Does not touch the database.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import {
    normalizeMergedRoute,
    type MergedRouteInput,
    type NormalizationIssue,
    type NormalizationStatus,
    type NormalizedRoute,
    type RouteDisplayNameReport,
} from "./normalization-rules.js";

export type NormalizeMergedRoutesOptions = {
    runRoot: string;
    inputDir?: string;
    outputDir?: string;
    reportsDir?: string;
    routeCodes?: string[];
};

export type RouteNormalizationSummary = {
    route_code: string | null;
    source_path: string;
    output_path: string | null;
    normalization_status: NormalizationStatus;
    quality_score: number;
    blocking_error_count: number;
    warning_count: number;
    blocking_errors: NormalizationIssue[];
    warnings: NormalizationIssue[];
    route_display_names?: RouteDisplayNameReport;
    error?: string;
};

export type Phase5NormalizationReport = {
    generated_at: string;
    run_root: string;
    input_dir: string;
    output_dir: string;
    summary: {
        total_routes: number;
        ready_for_phase6: number;
        needs_manual_fix: number;
        blocked_invalid_structure: number;
        blocked_dirty_stop_data: number;
        failed_to_read: number;
        top_warning_types: Array<{ code: string; count: number }>;
        top_blocking_error_types: Array<{ code: string; count: number }>;
    };
    routes: RouteNormalizationSummary[];
};

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

function countByCode(issues: NormalizationIssue[]): Array<{ code: string; count: number }> {
    const counts = new Map<string, number>();

    for (const issue of issues) {
        counts.set(issue.code, (counts.get(issue.code) ?? 0) + 1);
    }

    return [...counts.entries()]
        .map(([code, count]) => ({ code, count }))
        .sort((left, right) => right.count - left.count || left.code.localeCompare(right.code));
}

function renderReportMarkdown(report: Phase5NormalizationReport): string {
    const warningLines =
        report.summary.top_warning_types.length > 0
            ? report.summary.top_warning_types
                  .map((item) => `- ${item.code}: ${item.count}`)
                  .join("\n")
            : "- None";

    const blockingLines =
        report.summary.top_blocking_error_types.length > 0
            ? report.summary.top_blocking_error_types
                  .map((item) => `- ${item.code}: ${item.count}`)
                  .join("\n")
            : "- None";

    const routeLines = report.routes
        .map((route) => {
            const code = route.route_code ?? path.basename(route.source_path, ".json");
            return `| ${code} | ${route.normalization_status} | ${route.quality_score} | ${route.blocking_error_count} | ${route.warning_count} |`;
        })
        .join("\n");

    const nameReportLines = report.routes
        .filter((route) => route.route_display_names)
        .map((route) => {
            const names = route.route_display_names!;
            const code = route.route_code ?? "unknown";
            return [
                `### ${code}`,
                "",
                `- source_title_my: ${names.source_title_my ?? "—"}`,
                `- source_title_en: ${names.source_title_en ?? "—"}`,
                `- route_number: ${names.extracted_route_number ?? "—"}`,
                `- route_code: ${names.route_code ?? "—"}`,
                `- display_code: ${names.display_code ?? "—"}`,
                `- origin_my: ${names.origin_my ?? "—"}`,
                `- destination_my: ${names.destination_my ?? "—"}`,
                `- origin_en: ${names.origin_en ?? "—"}`,
                `- destination_en: ${names.destination_en ?? "—"}`,
                `- public_name: ${names.public_name ?? "—"}`,
                `- primary_name_my: ${names.primary_name_my ?? "—"}`,
                `- primary_name_en: ${names.primary_name_en ?? "—"}`,
                `- alias_und: ${names.alias_und ?? "—"}`,
                names.validation_warnings.length > 0
                    ? `- warnings: ${names.validation_warnings.join("; ")}`
                    : "- warnings: none",
                names.validation_errors.length > 0
                    ? `- errors: ${names.validation_errors.join("; ")}`
                    : "- errors: none",
                "",
            ].join("\n");
        })
        .join("\n");

    return [
        "# Phase 5 YBS Normalization Report",
        "",
        `Generated at: ${report.generated_at}`,
        `Run root: ${report.run_root}`,
        `Input: ${report.input_dir}`,
        `Output: ${report.output_dir}`,
        "",
        "## Summary",
        "",
        `- Total routes: ${report.summary.total_routes}`,
        `- ready_for_phase6: ${report.summary.ready_for_phase6}`,
        `- needs_manual_fix: ${report.summary.needs_manual_fix}`,
        `- blocked_invalid_structure: ${report.summary.blocked_invalid_structure}`,
        `- blocked_dirty_stop_data: ${report.summary.blocked_dirty_stop_data}`,
        `- failed_to_read: ${report.summary.failed_to_read}`,
        "",
        "## Top warning types",
        "",
        warningLines,
        "",
        "## Top blocking error types",
        "",
        blockingLines,
        "",
        "## Routes",
        "",
        "| Route | Status | Quality | Blocking errors | Warnings |",
        "|---|---|---:|---:|---:|",
        routeLines || "| n/a | n/a | n/a | n/a | n/a |",
        "",
        "## Route display names",
        "",
        nameReportLines || "- None",
        "",
    ].join("\n");
}

export function normalizeMergedRoutes(options: NormalizeMergedRoutesOptions): Phase5NormalizationReport {
    const runRoot = resolveFromRepo(options.runRoot);
    const inputDir = options.inputDir
        ? resolveFromRepo(options.inputDir)
        : path.join(runRoot, "merged", "routes");
    const outputDir = options.outputDir
        ? resolveFromRepo(options.outputDir)
        : path.join(runRoot, "normalized", "routes");
    const reportsDirectory = options.reportsDir
        ? resolveFromRepo(options.reportsDir)
        : path.join(runRoot, "reports");

    fs.mkdirSync(outputDir, { recursive: true });
    fs.mkdirSync(reportsDirectory, { recursive: true });

    const allFiles = listJsonFiles(inputDir);
    const selectedFiles =
        options.routeCodes && options.routeCodes.length > 0
            ? options.routeCodes.map((routeCode) => path.join(inputDir, `${routeCode}.json`))
            : allFiles;

    const routes: RouteNormalizationSummary[] = [];
    const allWarnings: NormalizationIssue[] = [];
    const allBlockingErrors: NormalizationIssue[] = [];

    for (const sourcePath of selectedFiles) {
        if (!fs.existsSync(sourcePath)) {
            routes.push({
                route_code: path.basename(sourcePath, ".json"),
                source_path: sourcePath,
                output_path: null,
                normalization_status: "blocked_invalid_structure",
                quality_score: 0,
                blocking_error_count: 1,
                warning_count: 0,
                blocking_errors: [
                    {
                        code: "INPUT_FILE_MISSING",
                        message: `Merged route file not found: ${sourcePath}`,
                    },
                ],
                warnings: [],
                error: "INPUT_FILE_MISSING",
            });
            allBlockingErrors.push({
                code: "INPUT_FILE_MISSING",
                message: `Merged route file not found: ${sourcePath}`,
            });
            continue;
        }

        try {
            const input = readJsonFile<MergedRouteInput>(sourcePath);
            const normalized = normalizeMergedRoute(input, sourcePath);
            const routeCode =
                typeof normalized.route.route_code === "string"
                    ? normalized.route.route_code
                    : path.basename(sourcePath, ".json");
            const outputPath = path.join(outputDir, `${routeCode}.json`);

            fs.writeFileSync(outputPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");

            routes.push({
                route_code: routeCode,
                source_path: sourcePath,
                output_path: outputPath,
                normalization_status: normalized.normalization_status,
                quality_score: normalized.quality_score,
                blocking_error_count: normalized.blocking_errors.length,
                warning_count: normalized.warnings.length,
                blocking_errors: normalized.blocking_errors,
                warnings: normalized.warnings,
                route_display_names: normalized.route_display_names,
            });

            allWarnings.push(...normalized.warnings);
            allBlockingErrors.push(...normalized.blocking_errors);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            routes.push({
                route_code: path.basename(sourcePath, ".json"),
                source_path: sourcePath,
                output_path: null,
                normalization_status: "blocked_invalid_structure",
                quality_score: 0,
                blocking_error_count: 1,
                warning_count: 0,
                blocking_errors: [
                    {
                        code: "INPUT_PARSE_FAILED",
                        message,
                    },
                ],
                warnings: [],
                error: message,
            });
            allBlockingErrors.push({
                code: "INPUT_PARSE_FAILED",
                message,
            });
        }
    }

    const report: Phase5NormalizationReport = {
        generated_at: new Date().toISOString(),
        run_root: runRoot,
        input_dir: inputDir,
        output_dir: outputDir,
        summary: {
            total_routes: routes.length,
            ready_for_phase6: routes.filter((route) => route.normalization_status === "ready_for_phase6").length,
            needs_manual_fix: routes.filter((route) => route.normalization_status === "needs_manual_fix").length,
            blocked_invalid_structure: routes.filter(
                (route) => route.normalization_status === "blocked_invalid_structure",
            ).length,
            blocked_dirty_stop_data: routes.filter(
                (route) => route.normalization_status === "blocked_dirty_stop_data",
            ).length,
            failed_to_read: routes.filter((route) => route.error).length,
            top_warning_types: countByCode(allWarnings),
            top_blocking_error_types: countByCode(allBlockingErrors),
        },
        routes,
    };

    const reportJsonPath = path.join(reportsDirectory, "phase5-normalization-report.json");
    const reportMarkdownPath = path.join(reportsDirectory, "phase5-normalization-report.md");

    fs.writeFileSync(reportJsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    fs.writeFileSync(reportMarkdownPath, `${renderReportMarkdown(report)}\n`, "utf8");

    return report;
}

function parseCliArgs(argv: string[]): NormalizeMergedRoutesOptions {
    let runRoot = "tmp/transport-imports/ybs-all";
    let inputDir: string | undefined;
    let outputDir: string | undefined;
    let reportsDir: string | undefined;
    let routeCodes: string[] | undefined;

    for (let index = 0; index < argv.length; index++) {
        const arg = argv[index];
        const next = argv[index + 1];

        if ((arg === "--run" || arg === "--run-root") && next) {
            runRoot = next.trim();
            index++;
        } else if (arg === "--input-dir" && next) {
            inputDir = next.trim();
            index++;
        } else if (arg === "--output-dir" && next) {
            outputDir = next.trim();
            index++;
        } else if (arg === "--reports-dir" && next) {
            reportsDir = next.trim();
            index++;
        } else if ((arg === "--routes" || arg === "--route") && next) {
            routeCodes = next
                .split(",")
                .map((value) => value.trim())
                .filter(Boolean);
            index++;
        }
    }

    return {
        runRoot,
        inputDir,
        outputDir,
        reportsDir,
        routeCodes,
    };
}

function main(): void {
    const report = normalizeMergedRoutes(parseCliArgs(process.argv.slice(2)));

    console.log(`Phase 5 normalization complete.`);
    console.log(`Total routes: ${report.summary.total_routes}`);
    console.log(`ready_for_phase6: ${report.summary.ready_for_phase6}`);
    console.log(`needs_manual_fix: ${report.summary.needs_manual_fix}`);
    console.log(`blocked_invalid_structure: ${report.summary.blocked_invalid_structure}`);
    console.log(`blocked_dirty_stop_data: ${report.summary.blocked_dirty_stop_data}`);

    if (report.summary.top_warning_types.length > 0) {
        console.log(`Top warning types:`);
        for (const item of report.summary.top_warning_types.slice(0, 10)) {
            console.log(`  ${item.code}: ${item.count}`);
        }
    }

    if (report.summary.top_blocking_error_types.length > 0) {
        console.log(`Top blocking error types:`);
        for (const item of report.summary.top_blocking_error_types.slice(0, 10)) {
            console.log(`  ${item.code}: ${item.count}`);
        }
    }
}

const isMainModule =
    process.argv[1] &&
    path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);

if (isMainModule) {
    main();
}
