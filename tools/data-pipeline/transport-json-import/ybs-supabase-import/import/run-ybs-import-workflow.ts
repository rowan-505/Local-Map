#!/usr/bin/env npx tsx
/**
 * YBS import workflow orchestrator (Phases 5–10).
 *
 * Default mode is dry-run. No database writes unless --execute and --confirm-import
 * are both provided. --all-routes execute also requires --confirm-all-routes.
 *
 * See YBS-IMPORT-WORKFLOW.md for command examples.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import dotenv from "dotenv";

import { buildStopResolution } from "../../ybs-db-prepare/build-stop-resolution.js";
import { prepareGeometry } from "../../ybs-db-prepare/prepare-geometry.js";
import {
    normalizeMergedRoutes,
    type Phase5NormalizationReport,
} from "../../ybs-normalize/normalize-merged-routes.js";
import { buildDryRunPlan } from "./build-dry-run-plan.js";
import { runImport } from "./import-ybs-plan.js";
import type { DryRunPlan } from "../lib/import-plan-types.js";
import type { RouteReadinessReport } from "../lib/route-import-policy.js";
import {
    copyFile,
    copyIfExists,
    ensureDir,
    markdownTable,
    phaseMarkdown,
    writeJsonFile,
    writeTextFile,
    type PhaseStatus,
} from "../lib/test-flow-report.js";
import { validateImportedYbs, type RouteValidationReport } from "../validate/validate-imported-ybs.js";
import {
    buildRouteCodeResolutions,
    parseRouteCodesArg,
    resolveSourceRouteFiles,
    type RouteCodeResolution,
    type SourceRouteFile,
} from "../lib/workflow-route-selection.js";

const PHASE5_HARD_BLOCK_STATUSES = new Set([
    "blocked_invalid_structure",
    "blocked_dirty_stop_data",
]);

export type WorkflowMode = "dry_run" | "execute";

export type WorkflowCliOptions = {
    sourceDir: string;
    runRoot: string;
    routeCodes?: string[];
    allRoutes: boolean;
    execute: boolean;
    confirmImport: boolean;
    confirmAllRoutes: boolean;
    allowPlaceholderGeometry: boolean;
    allowHighRisk: boolean;
    databaseUrl?: string;
};

export type WorkflowRouteResult = {
    route_code: string;
    source_file_key: string;
    normalization_status: string | null;
    ready: boolean;
    blocked: boolean;
    executed: boolean;
    validation_status: PhaseStatus | "skipped";
    blockers: string[];
    warnings: string[];
};

export type WorkflowFinalSummary = {
    generated_at: string;
    mode: WorkflowMode;
    source_dir: string;
    run_root: string;
    total_routes_selected: number;
    routes_ready: number;
    routes_blocked: number;
    routes_executed: number;
    routes_validated_passed: number;
    routes_validated_failed: number;
    route_codes: string[];
    named_route_codes: string[];
    numbered_route_codes: string[];
    duplicate_route_code_resolutions: Array<{ route_code: string; source_file_keys: string[] }>;
    route_code_map: RouteCodeResolution[];
    total_variants: number;
    total_route_stops: number;
    total_distinct_stops: number;
    total_review_geom: number;
    total_route_paths: number;
    total_source_links: number;
    public_visible_count: number;
    blockers_by_route: Record<string, string[]>;
    warnings_by_route: Record<string, string[]>;
    execute_refused_reasons: string[];
    route_results: WorkflowRouteResult[];
    report_paths: {
        normalization_json: string;
        normalization_md: string;
        stop_resolution_json: string;
        stop_resolution_md: string;
        geometry_json: string;
        geometry_md: string;
        dry_run_plan_json: string;
        dry_run_plan_md: string;
        import_execute_json: string | null;
        import_execute_md: string | null;
        validation_json: string | null;
        validation_md: string | null;
        final_summary_json: string;
        final_summary_md: string;
    };
};

function repoRoot(): string {
    return process.cwd();
}

function resolveFromRepo(relativePath: string): string {
    return path.isAbsolute(relativePath) ? relativePath : path.join(repoRoot(), relativePath);
}

function loadDatabaseEnv(): void {
    for (const envPath of [
        path.join(repoRoot(), "apps/api/.env"),
        path.join(repoRoot(), "infrastructure/.env"),
        path.join(repoRoot(), ".env"),
    ]) {
        if (fs.existsSync(envPath)) {
            dotenv.config({ path: envPath, override: false });
        }
    }
}

function resolveDatabaseUrl(explicit?: string): string | undefined {
    return (
        explicit ??
        process.env.SUPABASE_DIRECT_DATABASE_URL ??
        process.env.DATABASE_URL ??
        process.env.LOCAL_DATABASE_URL
    );
}

function appendLog(logPath: string, message: string): void {
    ensureDir(path.dirname(logPath));
    const line = `[${new Date().toISOString()}] ${message}\n`;
    fs.appendFileSync(logPath, line, "utf8");
}

function logProgress(logPath: string, message: string): void {
    console.log(message);
    appendLog(logPath, message);
}

function formatElapsedMs(ms: number): string {
    return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

async function runWithProgress<T>(
    logPath: string,
    label: string,
    fn: () => Promise<T> | T,
): Promise<T> {
    const started = Date.now();
    logProgress(logPath, `[workflow] ${label}…`);
    try {
        const result = await fn();
        logProgress(logPath, `[workflow] ${label} done (${formatElapsedMs(Date.now() - started)})`);
        return result;
    } catch (error) {
        logProgress(
            logPath,
            `[workflow] ${label} failed (${formatElapsedMs(Date.now() - started)})`,
        );
        throw error;
    }
}

function stageInputFiles(
    sourceFiles: SourceRouteFile[],
    inputDir: string,
    logPath: string,
): { missing: string[]; staged: string[] } {
    ensureDir(inputDir);
    const missing: string[] = [];
    const staged: string[] = [];

    for (const sourceFile of sourceFiles) {
        const dest = path.join(inputDir, `${sourceFile.source_file_key}.json`);
        if (!fs.existsSync(sourceFile.source_path)) {
            missing.push(sourceFile.source_file_key);
            appendLog(logPath, `MISSING source file: ${sourceFile.source_path}`);
            continue;
        }
        copyFile(sourceFile.source_path, dest);
        staged.push(sourceFile.source_file_key);
        appendLog(logPath, `STAGED ${sourceFile.source_path} -> ${dest}`);
    }

    return { missing, staged };
}

function copyCanonicalReports(runRoot: string): void {
    const reportsDir = path.join(runRoot, "reports");
    copyIfExists(
        path.join(reportsDir, "phase5-normalization-report.json"),
        path.join(reportsDir, "normalization-report.json"),
    );
    copyIfExists(
        path.join(reportsDir, "phase5-normalization-report.md"),
        path.join(reportsDir, "normalization-report.md"),
    );
    copyIfExists(
        path.join(reportsDir, "phase6-stop-resolution-report.json"),
        path.join(reportsDir, "stop-resolution-report.json"),
    );
    copyIfExists(
        path.join(reportsDir, "phase6-stop-resolution-report.md"),
        path.join(reportsDir, "stop-resolution-report.md"),
    );
    copyIfExists(
        path.join(reportsDir, "phase7-geometry-report.json"),
        path.join(reportsDir, "geometry-report.json"),
    );
    copyIfExists(
        path.join(reportsDir, "phase7-geometry-report.md"),
        path.join(reportsDir, "geometry-report.md"),
    );
    copyIfExists(
        path.join(reportsDir, "phase8-supabase-dry-run.json"),
        path.join(reportsDir, "dry-run-plan-report.json"),
    );
    copyIfExists(
        path.join(reportsDir, "phase8-supabase-dry-run.md"),
        path.join(reportsDir, "dry-run-plan-report.md"),
    );

    copyIfExists(
        path.join(runRoot, "db-prep", "routes-with-geometry.json"),
        path.join(runRoot, "geometry", "routes-with-geometry.json"),
    );
    copyIfExists(
        path.join(runRoot, "supabase-dry-run", "plan.json"),
        path.join(runRoot, "plans", "dry-run-plan.json"),
    );
}

function routeReadinessFor(
    plan: DryRunPlan,
    routeCode: string,
): RouteReadinessReport | undefined {
    return (plan.route_readiness_reports ?? []).find((row) => row.route_code === routeCode);
}

function assessRouteImportState(
    routeCode: string,
    phase5: Phase5NormalizationReport,
    plan: DryRunPlan,
    duplicateRouteCodes: Array<{ route_code: string; source_file_keys: string[] }>,
    options: WorkflowCliOptions,
): { blockers: string[]; warnings: string[]; ready: boolean } {
    const blockers: string[] = [];
    const warnings: string[] = [];

    const normalization = (phase5.routes ?? []).find((row) => row.route_code === routeCode);
    if (!normalization) {
        blockers.push(`Route ${routeCode} missing from Phase 5 normalization report.`);
    } else {
        warnings.push(...normalization.warnings.map((item) => item.message));
        if (PHASE5_HARD_BLOCK_STATUSES.has(normalization.normalization_status)) {
            blockers.push(
                `Phase 5 status=${normalization.normalization_status} (${normalization.blocking_error_count} blocking errors).`,
            );
        } else if (normalization.blocking_error_count > 0) {
            blockers.push(
                `Phase 5 has ${normalization.blocking_error_count} blocking error(s).`,
            );
        }
    }

    const duplicate = duplicateRouteCodes.find((row) => row.route_code === routeCode);
    if (duplicate) {
        blockers.push(
            `Duplicate route_code inside batch from source files: ${duplicate.source_file_keys.join(", ")}.`,
        );
    }

    for (const blocker of plan.blockers ?? []) {
        if (blocker.route_code === routeCode) {
            blockers.push(blocker.message);
        }
    }

    const readiness = routeReadinessFor(plan, routeCode);
    if (!readiness) {
        blockers.push("Route missing from Phase 8 readiness report.");
    } else {
        const executeSkipReason = shouldSkipRouteForExecute(readiness, options);
        if (executeSkipReason) {
            blockers.push(executeSkipReason);
        }
    }

    const uniqueBlockers = [...new Set(blockers)];
    const ready = uniqueBlockers.length === 0;

    return { blockers: uniqueBlockers, warnings, ready };
}

function shouldSkipRouteForExecute(
    readiness: RouteReadinessReport,
    options: WorkflowCliOptions,
): string | null {
    if (!readiness.executable) {
        return (readiness.reasons ?? []).join("; ") || "Route is not executable.";
    }
    if (readiness.blockers_count > 0) {
        return `Route has ${readiness.blockers_count} blocker(s).`;
    }
    if (!options.allowHighRisk && readiness.risk_level === "high") {
        return "Route risk_level=high (pass --allow-high-risk).";
    }
    if (!options.allowPlaceholderGeometry && readiness.placeholder_geometry_count > 0) {
        return "Route has placeholder geometry (pass --allow-placeholder-geometry).";
    }
    return null;
}

function aggregatePlanMetrics(plan: DryRunPlan, routeCodes: string[]): {
    total_variants: number;
    total_route_stops: number;
    total_distinct_stops: number;
    total_review_geom: number;
    total_route_paths: number;
    total_source_links: number;
} {
    const readiness = (plan.route_readiness_reports ?? []).filter((row) =>
        routeCodes.includes(row.route_code),
    );
    return {
        total_variants: readiness.length * 2,
        total_route_stops: plan.summary.route_stops_to_insert ?? 0,
        total_distinct_stops: plan.summary.stops_to_create ?? 0,
        total_review_geom: plan.summary.route_stops_to_insert ?? 0,
        total_route_paths: plan.summary.route_paths_to_insert ?? 0,
        total_source_links:
            (plan.summary.source_links_to_create ?? 0) + (plan.summary.source_links_to_reuse ?? 0),
    };
}

function renderFinalSummaryMarkdown(summary: WorkflowFinalSummary): string {
    const routeRows = summary.route_results.map((row) => [
        row.route_code,
        row.source_file_key,
        row.normalization_status ?? "",
        row.ready ? "yes" : "no",
        row.executed ? "yes" : "no",
        row.validation_status,
        row.blockers.length,
        row.warnings.length,
    ]);

    const blockerLines = Object.entries(summary.blockers_by_route).flatMap(([routeCode, blockers]) =>
        blockers.length > 0 ? [`- **${routeCode}**`, ...blockers.map((item) => `  - ${item}`)] : [],
    );

    const warningLines = Object.entries(summary.warnings_by_route).flatMap(([routeCode, warnings]) =>
        warnings.length > 0 ? [`- **${routeCode}**`, ...warnings.slice(0, 5).map((item) => `  - ${item}`)] : [],
    );

    return phaseMarkdown("YBS import workflow final summary", [
        `- Mode: ${summary.mode}`,
        `- Source dir: ${summary.source_dir}`,
        `- Run root: ${summary.run_root}`,
        `- Routes selected: ${summary.total_routes_selected}`,
        `- Routes ready: ${summary.routes_ready}`,
        `- Routes blocked: ${summary.routes_blocked}`,
        `- Routes executed: ${summary.routes_executed}`,
        `- Validation passed: ${summary.routes_validated_passed}`,
        `- Validation failed: ${summary.routes_validated_failed}`,
        `- Public visible count: ${summary.public_visible_count}`,
        "",
        "## Route code map",
        "",
        markdownTable(
            ["Source file", "Route code", "Numbered YBS", "Named route"],
            summary.route_code_map.map((row) => [
                row.source_file_key,
                row.route_code,
                row.is_numbered_ybs ? "yes" : "no",
                row.is_named_route ? "yes" : "no",
            ]),
        ),
        "",
        "## Duplicate route_code resolutions",
        "",
        summary.duplicate_route_code_resolutions.length === 0
            ? "- None"
            : summary.duplicate_route_code_resolutions
                  .map(
                      (row) =>
                          `- ${row.route_code}: ${row.source_file_keys.join(", ")}`,
                  )
                  .join("\n"),
        "",
        "## Totals (plan-level)",
        "",
        `- total variants (planned): ${summary.total_variants}`,
        `- total route_stops (planned): ${summary.total_route_stops}`,
        `- total distinct stops (planned): ${summary.total_distinct_stops}`,
        `- total review_geom (planned): ${summary.total_review_geom}`,
        `- total route_paths (planned): ${summary.total_route_paths}`,
        `- total source_links (planned): ${summary.total_source_links}`,
        "",
        "## Route results",
        "",
        markdownTable(
            ["Route", "Source file", "Phase 5", "Ready", "Executed", "Validation", "Blockers", "Warnings"],
            routeRows,
        ),
        "",
        "## Execute refusal reasons",
        "",
        summary.execute_refused_reasons.length === 0
            ? "- None"
            : summary.execute_refused_reasons.map((item) => `- ${item}`).join("\n"),
        "",
        "## Blockers by route",
        "",
        blockerLines.length > 0 ? blockerLines.join("\n") : "- None",
        "",
        "## Warnings by route",
        "",
        warningLines.length > 0 ? warningLines.join("\n") : "- None",
        "",
    ]);
}

export function parseWorkflowCliArgs(argv: string[]): WorkflowCliOptions {
    let sourceDir = "tmp/transport-imports/ybs-all/merged/routes";
    let runRoot = "tmp/transport-imports/ybs-batch";
    let routeCodes: string[] | undefined;
    let allRoutes = false;
    let execute = false;
    let dryRunExplicit = false;
    let confirmImport = false;
    let confirmAllRoutes = false;
    let allowPlaceholderGeometry = false;
    let allowHighRisk = false;
    let databaseUrl: string | undefined;

    for (let index = 0; index < argv.length; index++) {
        const arg = argv[index];
        const next = argv[index + 1];

        if (arg === "--source-dir" && next) {
            sourceDir = next.trim();
            index++;
        } else if ((arg === "--run-root" || arg === "--run") && next) {
            runRoot = next.trim();
            index++;
        } else if (arg === "--routes" && next) {
            routeCodes = parseRouteCodesArg(next);
            index++;
        } else if (arg === "--all-routes") {
            allRoutes = true;
        } else if (arg === "--execute") {
            execute = true;
        } else if (arg === "--dry-run") {
            dryRunExplicit = true;
        } else if (arg === "--confirm-import") {
            confirmImport = true;
        } else if (arg === "--confirm-all-routes") {
            confirmAllRoutes = true;
        } else if (arg === "--allow-placeholder-geometry") {
            allowPlaceholderGeometry = true;
        } else if (arg === "--allow-high-risk") {
            allowHighRisk = true;
        } else if (arg === "--database-url" && next) {
            databaseUrl = next.trim();
            index++;
        }
    }

    if (execute && dryRunExplicit) {
        throw new Error("Use either --dry-run or --execute, not both.");
    }

    if (!allRoutes && (!routeCodes || routeCodes.length === 0)) {
        throw new Error("Provide --routes YBS-3,YBS-4,YBS-5 or --all-routes.");
    }

    if (allRoutes && routeCodes && routeCodes.length > 0) {
        throw new Error("Use either --routes or --all-routes, not both.");
    }

    return {
        sourceDir,
        runRoot,
        routeCodes,
        allRoutes,
        execute,
        confirmImport,
        confirmAllRoutes,
        allowPlaceholderGeometry,
        allowHighRisk,
        databaseUrl,
    };
}

export async function runYbsImportWorkflow(
    options: WorkflowCliOptions,
): Promise<WorkflowFinalSummary> {
    const runRoot = resolveFromRepo(options.runRoot);
    const sourceDir = resolveFromRepo(options.sourceDir);
    const reportsDir = path.join(runRoot, "reports");
    const logsDir = path.join(runRoot, "logs");
    const logPath = path.join(logsDir, "workflow.log");

    for (const dir of [
        path.join(runRoot, "input"),
        path.join(runRoot, "normalized", "routes"),
        path.join(runRoot, "db-prep"),
        path.join(runRoot, "geometry"),
        path.join(runRoot, "plans"),
        reportsDir,
        logsDir,
        path.join(runRoot, "supabase-dry-run"),
        path.join(runRoot, "supabase-import"),
    ]) {
        ensureDir(dir);
    }

    appendLog(logPath, `Workflow start mode=${options.execute ? "execute" : "dry_run"}`);
    logProgress(
        logPath,
        `[workflow] Progress log: ${logPath}`,
    );
    if (options.execute) {
        logProgress(
            logPath,
            "[workflow] Execute mode: phases 5-8 run first (~5-15s), then each route imports sequentially (often 2-5 min per route).",
        );
    }

    const sourceFiles = resolveSourceRouteFiles(sourceDir, {
        routeCodes: options.routeCodes,
        allRoutes: options.allRoutes,
    });

    const { missing, staged } = stageInputFiles(sourceFiles, path.join(runRoot, "input"), logPath);
    if (missing.length > 0) {
        throw new Error(`Missing merged route JSON file(s): ${missing.join(", ")}`);
    }

    const sourceFileKeys = staged;

    const phase5 = await runWithProgress(logPath, "Phase 5 normalization", () =>
        normalizeMergedRoutes({
            runRoot: options.runRoot,
            inputDir: path.join(runRoot, "input"),
            outputDir: path.join(runRoot, "normalized", "routes"),
            reportsDir,
            routeCodes: sourceFileKeys,
        }),
    );

    const normalizedRouteCodes = new Map<string, string>();
    for (const route of phase5.routes) {
        const sourceKey = path.basename(route.source_path, ".json");
        if (route.route_code) {
            normalizedRouteCodes.set(sourceKey, route.route_code);
        }
    }

    const { resolutions: routeCodeMap, duplicate_route_codes: duplicate_route_code_resolutions } =
        buildRouteCodeResolutions(sourceFiles, normalizedRouteCodes);
    const resolvedRouteCodes = routeCodeMap.map((row) => row.route_code);

    writeJsonFile(path.join(reportsDir, "route-code-map.json"), {
        generated_at: new Date().toISOString(),
        source_dir: sourceDir,
        route_code_map: routeCodeMap,
        duplicate_route_code_resolutions,
    });

    await runWithProgress(logPath, "Phase 6 stop resolution", () =>
        buildStopResolution({
            runRoot: options.runRoot,
            databaseUrl: options.databaseUrl,
        }),
    );

    await runWithProgress(logPath, "Phase 7 geometry preparation", () =>
        prepareGeometry({
            runRoot: options.runRoot,
            databaseUrl: options.databaseUrl,
        }),
    );

    const { plan } = await runWithProgress(logPath, "Phase 8 dry-run plan", () =>
        buildDryRunPlan({
            runRoot: options.runRoot,
            databaseUrl: options.databaseUrl,
        }),
    );

    copyCanonicalReports(runRoot);

    const executeRefusedReasons: string[] = [];
    const routeResults: WorkflowRouteResult[] = [];
    const blockersByRoute: Record<string, string[]> = {};
    const warningsByRoute: Record<string, string[]> = {};

    for (const resolution of routeCodeMap) {
        const assessed = assessRouteImportState(
            resolution.route_code,
            phase5,
            plan,
            duplicate_route_code_resolutions,
            options,
        );
        const normalization = (phase5.routes ?? []).find((row) => row.route_code === resolution.route_code);

        blockersByRoute[resolution.route_code] = assessed.blockers;
        warningsByRoute[resolution.route_code] = assessed.warnings;

        routeResults.push({
            route_code: resolution.route_code,
            source_file_key: resolution.source_file_key,
            normalization_status: normalization?.normalization_status ?? null,
            ready: assessed.ready,
            blocked: !assessed.ready,
            executed: false,
            validation_status: "skipped",
            blockers: assessed.blockers,
            warnings: assessed.warnings,
        });
    }

    const routesReady = routeResults.filter((row) => row.ready).length;
    const routesBlocked = routeResults.filter((row) => row.blocked).length;

    logProgress(
        logPath,
        `[workflow] Batch readiness: ready=${routesReady} blocked=${routesBlocked} (${routeResults.map((row) => `${row.route_code}:${row.ready ? "ready" : "blocked"}`).join(", ")})`,
    );
    for (const routeResult of routeResults.filter((row) => !row.ready)) {
        for (const blocker of routeResult.blockers) {
            logProgress(logPath, `[workflow] BLOCKER ${routeResult.route_code}: ${blocker}`);
        }
    }

    let routesExecuted = 0;
    const importExecuteResults: Array<{
        route_code: string;
        status: "imported" | "dry_run" | "refused" | "failed" | "skipped";
        message: string | null;
    }> = [];

    const wantsExecute = options.execute;
    let executeAllowed = wantsExecute;

    if (wantsExecute && !options.confirmImport) {
        executeAllowed = false;
        executeRefusedReasons.push("Missing --confirm-import.");
    }

    if (wantsExecute && options.allRoutes && !options.confirmAllRoutes) {
        executeAllowed = false;
        executeRefusedReasons.push("Missing --confirm-all-routes for --all-routes execute.");
    }

    if (wantsExecute && routesReady === 0) {
        executeAllowed = false;
        executeRefusedReasons.push(
            `No routes are ready for execute (${routesBlocked} blocked). Fix blockers before execute.`,
        );
    } else if (wantsExecute && routesBlocked > 0) {
        logProgress(
            logPath,
            `[workflow] Execute will skip ${routesBlocked} blocked route(s) and import ${routesReady} ready route(s).`,
        );
    }

    // #region agent log
    fetch("http://127.0.0.1:7897/ingest/25af25f5-9969-4e5e-aa16-dc4a423c4a3e", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "4ed413" },
        body: JSON.stringify({
            sessionId: "4ed413",
            runId: "pre-fix",
            hypothesisId: "A",
            location: "run-ybs-import-workflow.ts:execute-gate",
            message: "Execute gate decision",
            data: {
                wantsExecute,
                executeAllowed,
                routesReady,
                routesBlocked,
                batchRefusePolicy: routesReady === 0 ? "refuse_all" : "skip_blocked",
            },
            timestamp: Date.now(),
        }),
    }).catch(() => {});
    // #endregion

    const globalPlanBlockers = (plan.blockers ?? [])
        .filter((blocker) => !blocker.route_code)
        .map((blocker) => blocker.message);
    if (wantsExecute && globalPlanBlockers.length > 0) {
        executeAllowed = false;
        executeRefusedReasons.push(...globalPlanBlockers);
    }

    if (executeAllowed) {
        const readyRouteResults = routeResults.filter((row) => row.ready);
        for (const routeResult of readyRouteResults) {
            const readiness = routeReadinessFor(plan, routeResult.route_code);
            if (!readiness) {
                executeAllowed = false;
                executeRefusedReasons.push(`${routeResult.route_code}: missing readiness report.`);
                break;
            }

            const skipReason = shouldSkipRouteForExecute(readiness, options);
            if (skipReason) {
                executeAllowed = false;
                executeRefusedReasons.push(`${routeResult.route_code}: ${skipReason}`);
                break;
            }
        }

        // #region agent log
        fetch("http://127.0.0.1:7897/ingest/25af25f5-9969-4e5e-aa16-dc4a423c4a3e", {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "4ed413" },
            body: JSON.stringify({
                sessionId: "4ed413",
                runId: "pre-fix",
                hypothesisId: "B",
                location: "run-ybs-import-workflow.ts:ready-pre-check",
                message: "Ready-route pre-check complete",
                data: {
                    executeAllowed,
                    readyRoutesChecked: readyRouteResults.length,
                    refusedReasonCount: executeRefusedReasons.length,
                },
                timestamp: Date.now(),
            }),
        }).catch(() => {});
        // #endregion
    }

    if (wantsExecute && executeAllowed) {
        logProgress(logPath, "[workflow] Phase 9 execute start");
        const routesToImport = routeResults.filter((row) => row.ready);
        for (const routeResult of routeResults.filter((row) => !row.ready)) {
            importExecuteResults.push({
                route_code: routeResult.route_code,
                status: "skipped",
                message: routeResult.blockers.join("; ") || "Route blocked.",
            });
        }
        for (let index = 0; index < routesToImport.length; index++) {
            const routeResult = routesToImport[index];
            const routeStarted = Date.now();
            logProgress(
                logPath,
                `[workflow] Phase 9 importing ${routeResult.route_code} (${index + 1}/${routesToImport.length}) — may take several minutes…`,
            );
            try {
                const result = await runImport({
                    runRoot: options.runRoot,
                    routeCode: routeResult.route_code,
                    routeCodes: resolvedRouteCodes,
                    execute: true,
                    databaseUrl: options.databaseUrl,
                    allowPlaceholderGeometry: options.allowPlaceholderGeometry,
                    allowHighRisk: options.allowHighRisk,
                    maxRoutes: resolvedRouteCodes.length,
                    maxRoutesExplicit: true,
                    repairImport: false,
                });

                if (result.errors.length > 0) {
                    routeResult.executed = false;
                    importExecuteResults.push({
                        route_code: routeResult.route_code,
                        status: "failed",
                        message: result.errors.map((item) => item.error_message).join("; "),
                    });
                    executeRefusedReasons.push(
                        `${routeResult.route_code}: import failed with ${result.errors.length} error(s). Batch stopped.`,
                    );
                    logProgress(
                        logPath,
                        `Phase 9 execute failed for ${routeResult.route_code}: ${result.errors.length} errors`,
                    );
                    break;
                }

                routeResult.executed = true;
                routesExecuted++;
                importExecuteResults.push({
                    route_code: routeResult.route_code,
                    status: "imported",
                    message: null,
                });
                logProgress(
                    logPath,
                    `[workflow] Phase 9 execute complete for ${routeResult.route_code} (${formatElapsedMs(Date.now() - routeStarted)})`,
                );
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                importExecuteResults.push({
                    route_code: routeResult.route_code,
                    status: "failed",
                    message,
                });
                executeRefusedReasons.push(`${routeResult.route_code}: ${message}. Batch stopped.`);
                logProgress(logPath, `Phase 9 execute exception for ${routeResult.route_code}: ${message}`);
                break;
            }
        }
        logProgress(logPath, "[workflow] Phase 9 execute end");
    } else if (!wantsExecute) {
        logProgress(logPath, "[workflow] Phase 9 dry-run import plans");
        for (const routeResult of routeResults) {
            await runImport({
                runRoot: options.runRoot,
                routeCode: routeResult.route_code,
                routeCodes: resolvedRouteCodes,
                execute: false,
                databaseUrl: options.databaseUrl,
                allowPlaceholderGeometry: options.allowPlaceholderGeometry,
                allowHighRisk: options.allowHighRisk,
                maxRoutes: resolvedRouteCodes.length,
                maxRoutesExplicit: true,
                repairImport: false,
            });
            importExecuteResults.push({
                route_code: routeResult.route_code,
                status: "dry_run",
                message: null,
            });
        }
    } else if (wantsExecute) {
        for (const routeResult of routeResults) {
            importExecuteResults.push({
                route_code: routeResult.route_code,
                status: "refused",
                message: executeRefusedReasons.join("; "),
            });
        }
    }

    const importExecuteJsonPath = path.join(reportsDir, "import-execute-report.json");
    const importExecuteMdPath = path.join(reportsDir, "import-execute-report.md");
    writeJsonFile(importExecuteJsonPath, {
        generated_at: new Date().toISOString(),
        mode: options.execute ? "execute" : "dry_run",
        execute_allowed: executeAllowed,
        execute_refused_reasons: executeRefusedReasons,
        results: importExecuteResults,
    });
    writeTextFile(
        importExecuteMdPath,
        phaseMarkdown("Import execute report", [
            `- Mode: ${options.execute ? "execute" : "dry_run"}`,
            `- Execute allowed: ${executeAllowed ? "yes" : "no"}`,
            "",
            markdownTable(
                ["Route", "Status", "Message"],
                importExecuteResults.map((row) => [row.route_code, row.status, row.message ?? ""]),
            ),
            "",
            "## Refusal reasons",
            "",
            executeRefusedReasons.length === 0
                ? "- None"
                : executeRefusedReasons.map((item) => `- ${item}`).join("\n"),
        ]),
    );

    let validationReports: RouteValidationReport[] = [];
    let routesValidatedPassed = 0;
    let routesValidatedFailed = 0;
    let publicVisibleCount = 0;

    const validationJsonPath = path.join(reportsDir, "validation-report.json");
    const validationMdPath = path.join(reportsDir, "validation-report.md");

    if (routesExecuted > 0) {
        validationReports = await runWithProgress(
            logPath,
            `Phase 10 validation (${routesExecuted} route(s))`,
            () =>
                validateImportedYbs({
                    runRoot: options.runRoot,
                    routeCodes: routeResults.filter((row) => row.executed).map((row) => row.route_code),
                    databaseUrl: options.databaseUrl,
                }),
        );

        for (const report of validationReports) {
            const routeResult = routeResults.find((row) => row.route_code === report.route_code);
            if (!routeResult) {
                continue;
            }
            routeResult.validation_status = report.status;
            if (report.status === "passed") {
                routesValidatedPassed++;
            } else {
                routesValidatedFailed++;
            }
            if (report.public_visible) {
                publicVisibleCount++;
            }
        }

        writeJsonFile(validationJsonPath, {
            generated_at: new Date().toISOString(),
            routes: validationReports,
        });
        writeTextFile(
            validationMdPath,
            phaseMarkdown("Validation report", [
                `- Routes validated: ${validationReports.length}`,
                `- Passed: ${routesValidatedPassed}`,
                `- Failed: ${routesValidatedFailed}`,
                "",
                markdownTable(
                    ["Route", "Status", "Blockers", "Warnings", "Public visible"],
                    validationReports.map((row) => [
                        row.route_code,
                        row.status,
                        row.blockers.length,
                        row.warnings.length,
                        row.public_visible ? "yes" : "no",
                    ]),
                ),
            ]),
        );
        logProgress(
            logPath,
            `[workflow] Phase 10 validation complete: passed=${routesValidatedPassed} failed=${routesValidatedFailed}`,
        );
    }

    const planMetrics = aggregatePlanMetrics(plan, resolvedRouteCodes);

    const summary: WorkflowFinalSummary = {
        generated_at: new Date().toISOString(),
        mode: options.execute ? "execute" : "dry_run",
        source_dir: sourceDir,
        run_root: runRoot,
        total_routes_selected: routeResults.length,
        routes_ready: routesReady,
        routes_blocked: routesBlocked,
        routes_executed: routesExecuted,
        routes_validated_passed: routesValidatedPassed,
        routes_validated_failed: routesValidatedFailed,
        route_codes: resolvedRouteCodes,
        named_route_codes: routeCodeMap.filter((row) => row.is_named_route).map((row) => row.route_code),
        numbered_route_codes: routeCodeMap.filter((row) => row.is_numbered_ybs).map((row) => row.route_code),
        duplicate_route_code_resolutions,
        route_code_map: routeCodeMap,
        total_variants: planMetrics.total_variants,
        total_route_stops: planMetrics.total_route_stops,
        total_distinct_stops: planMetrics.total_distinct_stops,
        total_review_geom: planMetrics.total_review_geom,
        total_route_paths: planMetrics.total_route_paths,
        total_source_links: planMetrics.total_source_links,
        public_visible_count: publicVisibleCount,
        blockers_by_route: blockersByRoute,
        warnings_by_route: warningsByRoute,
        execute_refused_reasons: executeRefusedReasons,
        route_results: routeResults,
        report_paths: {
            normalization_json: path.join(reportsDir, "normalization-report.json"),
            normalization_md: path.join(reportsDir, "normalization-report.md"),
            stop_resolution_json: path.join(reportsDir, "stop-resolution-report.json"),
            stop_resolution_md: path.join(reportsDir, "stop-resolution-report.md"),
            geometry_json: path.join(reportsDir, "geometry-report.json"),
            geometry_md: path.join(reportsDir, "geometry-report.md"),
            dry_run_plan_json: path.join(reportsDir, "dry-run-plan-report.json"),
            dry_run_plan_md: path.join(reportsDir, "dry-run-plan-report.md"),
            import_execute_json: importExecuteJsonPath,
            import_execute_md: importExecuteMdPath,
            validation_json: routesExecuted > 0 ? validationJsonPath : null,
            validation_md: routesExecuted > 0 ? validationMdPath : null,
            final_summary_json: path.join(reportsDir, "final-summary.json"),
            final_summary_md: path.join(reportsDir, "final-summary.md"),
        },
    };

    writeJsonFile(summary.report_paths.final_summary_json, summary);
    writeTextFile(summary.report_paths.final_summary_md, renderFinalSummaryMarkdown(summary));
    appendLog(logPath, `Workflow complete executed=${routesExecuted} blocked=${routesBlocked}`);

    return summary;
}

async function main(): Promise<void> {
    loadDatabaseEnv();
    const options = parseWorkflowCliArgs(process.argv.slice(2));

    if (options.execute && !resolveDatabaseUrl(options.databaseUrl)) {
        throw new Error(
            "DATABASE_URL is required for --execute. Set SUPABASE_DIRECT_DATABASE_URL or DATABASE_URL.",
        );
    }

    console.log(`YBS import workflow (${options.execute ? "execute" : "dry-run"})`);
    console.log(`Source: ${options.sourceDir}`);
    console.log(`Run root: ${options.runRoot}`);
    if (options.allRoutes) {
        console.log("Scope: all routes in source dir");
    } else {
        console.log(`Scope: ${options.routeCodes?.join(", ")}`);
    }

    if (options.execute) {
        console.log("Execute mode: watch [workflow] lines below for per-phase and per-route progress.");
        console.log(`Live log file: tmp/.../${path.relative(process.cwd(), path.join(options.runRoot, "logs/workflow.log"))}`);
    }

    const summary = await runYbsImportWorkflow(options);

    console.log("");
    console.log(`Routes selected: ${summary.total_routes_selected}`);
    console.log(`Ready: ${summary.routes_ready} | Blocked: ${summary.routes_blocked}`);
    console.log(`Executed: ${summary.routes_executed}`);
    if (summary.routes_executed > 0) {
        console.log(
            `Validation: passed=${summary.routes_validated_passed} failed=${summary.routes_validated_failed}`,
        );
    }
    if (summary.execute_refused_reasons.length > 0) {
        console.log("Execute refused:");
        for (const reason of summary.execute_refused_reasons) {
            console.log(`  - ${reason}`);
        }
    }
    console.log(`Final summary: ${summary.report_paths.final_summary_md}`);

    if (summary.routes_blocked > 0 && summary.routes_ready === 0) {
        process.exitCode = 1;
    } else if (options.execute && summary.routes_executed === 0) {
        process.exitCode = 1;
    }
}

const isMainModule =
    process.argv[1] &&
    (process.argv[1].endsWith("run-ybs-import-workflow.ts") ||
        process.argv[1].endsWith("run-ybs-import-workflow.js"));

if (isMainModule) {
    main().catch((error) => {
        if (error instanceof Error) {
            console.error(error.message);
            if (error.stack) {
                console.error(error.stack);
            }
        } else {
            console.error(String(error));
        }
        process.exit(1);
    });
}
