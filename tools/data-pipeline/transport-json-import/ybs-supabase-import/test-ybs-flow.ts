/**
 * Precise YBS import flow test runner from merged JSON to Supabase/dashboard checks.
 *
 * Default mode is dry-run only. Pass --execute-ybs2 to execute only the configured
 * new route. YBS-1/existing route writes are never executed unless a separate
 * future flag is added.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import dotenv from "dotenv";
import pg from "pg";

import { buildStopResolution } from "../ybs-db-prepare/build-stop-resolution.js";
import { prepareGeometry, type RoutesWithGeometryOutput } from "../ybs-db-prepare/prepare-geometry.js";
import { normalizeMergedRoutes, type Phase5NormalizationReport } from "../ybs-normalize/normalize-merged-routes.js";
import { buildDryRunPlan } from "./build-dry-run-plan.js";
import {
    emptyResult,
    executeRouteImport,
    selectRouteActions,
    type DryRunPlan,
    type ImportResult,
    type PlanAction,
} from "./import-executor.js";
import {
    assessRouteExecuteSafetyFromPlan,
    buildImportSafetyReport,
    type ImportSafetyReport,
} from "./import-execute-guards.js";
import {
    validateImportedYbs,
    type RouteValidationReport,
    type VariantRouteStopValidation,
} from "./validate-imported-ybs.js";
import {
    copyFile,
    copyIfExists,
    ensureDir,
    markdownTable,
    phaseMarkdown,
    readJsonFile,
    statusFromBoolean,
    writeJsonFile,
    writeTextFile,
    type PhaseReportSummary,
    type PhaseStatus,
} from "./test-flow-report.js";

type CliOptions = {
    existingRoute: string;
    newRoute: string;
    sourceDir: string;
    runRoot: string;
    executeYbs2: boolean;
    databaseUrl?: string;
};

type MergedRouteShape = {
    extraction_schema_version?: number;
    route?: {
        route_code_candidate?: string | null;
        [key: string]: unknown;
    };
    variants?: Array<{
        direction_key?: string;
        stops?: unknown[];
        [key: string]: unknown;
    }>;
};

type DbRouteRow = {
    route_code: string;
    id: number;
    public_id: string;
    public_name: string | null;
    review_status: string;
    is_active: boolean;
};

type RouteDbState = {
    route_code: string;
    route: DbRouteRow | null;
    counts: {
        routes: number;
        variants: number;
        route_stops: number;
        route_paths: number;
        source_links: number;
        route_names: number;
    };
};

type PreflightReport = {
    generated_at: string;
    safe_to_continue: boolean;
    new_route_condition_failed: boolean;
    source_files: Record<string, { path: string; exists: boolean; shape_errors: string[] }>;
    db_routes: Record<string, RouteDbState>;
    database_url_host: string | null;
};

type RouteDecisionSummary = {
    route_code: string;
    exists_in_supabase: boolean;
    existing_route_id: number | null;
    decision: string;
    blockers: string[];
    planned_counts: Record<string, number>;
    source_link_entity_types: string[];
};

type RouteValidation = {
    route_code: string;
    status: PhaseStatus;
    mode: "current_db_state" | "not_imported_yet" | "executed_validation" | "reference_only";
    route_count: number;
    variant_count: number;
    route_stop_count: number;
    route_path_count: number;
    source_links_missing_count: number;
    sequence_error_count: number;
    geometry_missing_count: number;
    duplicate_route_count: number;
    duplicate_sequence_count: number;
    public_visible: boolean;
    review_status: string | null;
    blockers: string[];
    warnings: string[];
    variant_route_stop_validation?: VariantRouteStopValidation[];
};

type DashboardCheck = {
    route_code: string;
    status: PhaseStatus;
    dashboard_visible: boolean;
    route_id: number | null;
    variants_exist: boolean;
    route_stops_exist: boolean;
    route_paths_exist: boolean;
    source_links_exist: boolean;
    stop_details_loadable: boolean;
    routes_using_stop_queryable: boolean;
    manual_checklist: string[];
};

type PublicCheck = {
    route_code: string;
    status: PhaseStatus;
    dashboard_visible: boolean;
    public_visible: boolean;
    reason_hidden: string | null;
    review_status: string | null;
    is_active: boolean | null;
};

function repoRoot(): string {
    return process.cwd();
}

function resolveFromRepo(filePath: string): string {
    return path.isAbsolute(filePath) ? filePath : path.join(repoRoot(), filePath);
}

function loadDatabaseEnv(): void {
    for (const envPath of [
        path.join(repoRoot(), "apps/api/.env"),
        path.join(repoRoot(), "infrastructure/.env"),
    ]) {
        if (fs.existsSync(envPath)) {
            dotenv.config({ path: envPath, override: false });
        }
    }
}

function resolveDatabaseUrl(explicit?: string): string {
    const url =
        explicit ??
        process.env.SUPABASE_DIRECT_DATABASE_URL ??
        process.env.DATABASE_URL ??
        process.env.LOCAL_DATABASE_URL;
    if (!url) {
        throw new Error(
            "No database URL found. Set SUPABASE_DIRECT_DATABASE_URL, DATABASE_URL, or LOCAL_DATABASE_URL.",
        );
    }
    return url;
}

function databaseHost(databaseUrl: string): string | null {
    try {
        return new URL(databaseUrl).host;
    } catch {
        return null;
    }
}

function parseCliArgs(argv: string[]): CliOptions {
    let existingRoute = "YBS-1";
    let newRoute = "YBS-2";
    let sourceDir = "tmp/transport-imports/ybs-all/merged/routes";
    let runRoot = "tmp/transport-imports/ybs-flow-test-ybs1-ybs2";
    let executeYbs2 = false;
    let databaseUrl: string | undefined;

    for (let index = 0; index < argv.length; index++) {
        const arg = argv[index];
        const next = argv[index + 1];
        if (arg === "--existing-route" && next) {
            existingRoute = next.trim();
            index++;
        } else if (arg === "--new-route" && next) {
            newRoute = next.trim();
            index++;
        } else if (arg === "--source-dir" && next) {
            sourceDir = next.trim();
            index++;
        } else if ((arg === "--run-root" || arg === "--run") && next) {
            runRoot = next.trim();
            index++;
        } else if (arg === "--database-url" && next) {
            databaseUrl = next.trim();
            index++;
        } else if (arg === "--execute-ybs2") {
            executeYbs2 = true;
        }
    }

    return { existingRoute, newRoute, sourceDir, runRoot, executeYbs2, databaseUrl };
}

async function withReadOnlyClient<T>(databaseUrl: string, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const pool = new pg.Pool({ connectionString: databaseUrl, max: 1, statement_timeout: 120_000 });
    const client = await pool.connect();
    try {
        await client.query("BEGIN READ ONLY");
        await client.query("SET TRANSACTION READ ONLY");
        const result = await fn(client);
        await client.query("COMMIT");
        return result;
    } catch (error) {
        try {
            await client.query("ROLLBACK");
        } catch {
            // best effort
        }
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

async function loadRouteStates(databaseUrl: string, routeCodes: string[]): Promise<Record<string, RouteDbState>> {
    return withReadOnlyClient(databaseUrl, async (client) => {
        const routes = await client.query<DbRouteRow>(
            `
            SELECT route_code, id::int, public_id::text, public_name, review_status, is_active
            FROM transport.routes
            WHERE route_code = ANY($1::text[])
            ORDER BY id ASC
            `,
            [routeCodes],
        );

        const states: Record<string, RouteDbState> = {};
        for (const routeCode of routeCodes) {
            const matching = routes.rows.filter((row) => row.route_code === routeCode);
            const first = matching[0] ?? null;
            let counts = {
                routes: matching.length,
                variants: 0,
                route_stops: 0,
                route_paths: 0,
                source_links: 0,
                route_names: 0,
            };
            if (first) {
                const countRows = await client.query<{
                    variants: string;
                    route_stops: string;
                    route_paths: string;
                    source_links: string;
                    route_names: string;
                }>(
                    `
                    SELECT
                      (SELECT count(*) FROM transport.route_variants WHERE route_id = $1 AND deleted_at IS NULL)::text AS variants,
                      (SELECT count(*) FROM transport.route_stops rs JOIN transport.route_variants v ON v.id = rs.route_variant_id WHERE v.route_id = $1)::text AS route_stops,
                      (SELECT count(*) FROM transport.route_paths rp JOIN transport.route_variants v ON v.id = rp.route_variant_id WHERE v.route_id = $1 AND rp.deleted_at IS NULL)::text AS route_paths,
                      (SELECT count(*) FROM transport.source_links WHERE entity_id = $1 AND entity_type = 'route')::text AS source_links,
                      (SELECT count(*) FROM transport.route_names WHERE route_id = $1)::text AS route_names
                    `,
                    [first.id],
                );
                const row = countRows.rows[0];
                counts = {
                    routes: matching.length,
                    variants: Number(row?.variants ?? 0),
                    route_stops: Number(row?.route_stops ?? 0),
                    route_paths: Number(row?.route_paths ?? 0),
                    source_links: Number(row?.source_links ?? 0),
                    route_names: Number(row?.route_names ?? 0),
                };
            }
            states[routeCode] = { route_code: routeCode, route: first, counts };
        }
        return states;
    });
}

function validateMergedShape(filePath: string): string[] {
    if (!fs.existsSync(filePath)) {
        return ["SOURCE_FILE_MISSING"];
    }
    const input = readJsonFile<MergedRouteShape>(filePath);
    const errors: string[] = [];
    if (input.extraction_schema_version !== 3) errors.push("extraction_schema_version must be 3");
    if (!input.route) errors.push("route missing");
    if (!input.route?.route_code_candidate) errors.push("route.route_code_candidate missing");
    if (!Array.isArray(input.variants)) errors.push("variants[] missing");
    const variants = input.variants ?? [];
    const outbound = variants.find((variant) => variant.direction_key === "outbound");
    const inbound = variants.find((variant) => variant.direction_key === "inbound");
    if (!outbound) errors.push("outbound variant missing");
    if (!inbound) errors.push("inbound variant missing");
    for (const direction of ["outbound", "inbound"]) {
        const variant = variants.find((item) => item.direction_key === direction);
        if (!Array.isArray(variant?.stops) || variant.stops.length === 0) {
            errors.push(`${direction} stops[] missing or empty`);
        }
    }
    return errors;
}

async function runPreflight(options: CliOptions, databaseUrl: string, routeCodes: string[]): Promise<PreflightReport> {
    const runRoot = resolveFromRepo(options.runRoot);
    const inputDir = path.join(runRoot, "input");
    const canonicalMergedDir = path.join(runRoot, "merged", "routes");
    ensureDir(inputDir);
    ensureDir(canonicalMergedDir);

    const sourceFiles: PreflightReport["source_files"] = {};
    for (const routeCode of routeCodes) {
        const src = resolveFromRepo(path.join(options.sourceDir, `${routeCode}.json`));
        const inputDest = path.join(inputDir, `${routeCode}.json`);
        const canonicalDest = path.join(canonicalMergedDir, `${routeCode}.json`);
        if (fs.existsSync(src)) {
            copyFile(src, inputDest);
            copyFile(src, canonicalDest);
        }
        sourceFiles[routeCode] = {
            path: src,
            exists: fs.existsSync(src),
            shape_errors: validateMergedShape(src),
        };
    }

    const dbRoutes = await loadRouteStates(databaseUrl, routeCodes);
    const ybs1Exists = Boolean(dbRoutes[options.existingRoute]?.route);
    const ybs2Exists = Boolean(dbRoutes[options.newRoute]?.route);
    const sourceOk = Object.values(sourceFiles).every((file) => file.exists && file.shape_errors.length === 0);
    const report: PreflightReport = {
        generated_at: new Date().toISOString(),
        safe_to_continue: sourceOk && ybs1Exists,
        new_route_condition_failed: ybs2Exists,
        source_files: sourceFiles,
        db_routes: dbRoutes,
        database_url_host: databaseHost(databaseUrl),
    };

    writeJsonFile(path.join(runRoot, "reports/00-preflight.json"), report);
    writeTextFile(
        path.join(runRoot, "reports/00-preflight.md"),
        phaseMarkdown("Step 0 Preflight", [
            `- Database host: ${report.database_url_host ?? "unknown"}`,
            `- Safe to continue: ${report.safe_to_continue ? "yes" : "no"}`,
            `- New route condition failed: ${report.new_route_condition_failed ? "yes" : "no"}`,
            "",
            "## Source files",
            markdownTable(
                ["Route", "Exists", "Shape errors"],
                routeCodes.map((routeCode) => [
                    routeCode,
                    sourceFiles[routeCode]?.exists ? "yes" : "no",
                    sourceFiles[routeCode]?.shape_errors.join("; ") || "none",
                ]),
            ),
            "",
            "## Supabase route state",
            markdownTable(
                ["Route", "Exists", "ID", "Public ID", "Review status", "Active", "Route rows"],
                routeCodes.map((routeCode) => {
                    const state = dbRoutes[routeCode];
                    return [
                        routeCode,
                        state?.route ? "yes" : "no",
                        state?.route?.id ?? "",
                        state?.route?.public_id ?? "",
                        state?.route?.review_status ?? "",
                        state?.route?.is_active === undefined ? "" : String(state.route.is_active),
                        state?.counts.routes ?? 0,
                    ];
                }),
            ),
            "",
            ybs2Exists ? `YBS-2 condition failed. Choose another new route before executing imports.` : "YBS-2 is not present; execute mode may insert it if requested.",
        ]),
    );

    return report;
}

function countActions(actions: PlanAction[]): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const action of actions) {
        counts[action.action] = (counts[action.action] ?? 0) + 1;
    }
    return counts;
}

function routeScopedActions(plan: DryRunPlan, routeCode: string): PlanAction[] {
    const routeActions = selectRouteActions(plan, routeCode);
    const operatorRefs = new Set<string>();
    const stopRefs = new Set<string>();
    const routeStopCandidateIds = new Set<string>();

    for (const action of routeActions) {
        const operatorRef = action.payload.operator_ref;
        if (typeof operatorRef === "string") operatorRefs.add(operatorRef);
        const candidateId = action.payload.candidate_id;
        if (typeof candidateId === "string") routeStopCandidateIds.add(candidateId);
        const stopRef = action.payload.stop_ref;
        if (typeof stopRef === "string") stopRefs.add(stopRef);
    }

    const routeScoped = new Set(routeActions);
    for (const action of plan.actions) {
        if (action.entity_type === "operator" && operatorRefs.has(action.entity_ref)) {
            routeScoped.add(action);
        }
        if (action.entity_type === "stop") {
            const candidateId = action.payload.candidate_id;
            if (
                stopRefs.has(action.entity_ref) ||
                (typeof candidateId === "string" && routeStopCandidateIds.has(candidateId))
            ) {
                routeScoped.add(action);
            }
        }
    }

    return [...routeScoped];
}

function routeImportSlices(plan: DryRunPlan, routeCode: string): { routeActions: PlanAction[]; stopActions: PlanAction[] } {
    const scoped = routeScopedActions(plan, routeCode);
    return {
        routeActions: scoped.filter((action) => action.entity_type !== "stop"),
        stopActions: scoped.filter((action) => action.entity_type === "stop"),
    };
}

function buildDryRunImportResult(routeCode: string, actions: PlanAction[]): ImportResult {
    const result = emptyResult(routeCode);
    result.executed = false;
    result.counts = { planned_actions: { inserted: actions.length, updated: 0, reused: 0, skipped: 0 } };
    for (const action of actions) {
        if (action.action === "blocked_conflict") {
            result.conflicts.push({
                entity_type: action.entity_type,
                external_id: action.external_id,
                action: action.action,
                reason: action.reason ?? "Blocked conflict from dry-run plan.",
            });
        }
    }
    return result;
}

async function executeRouteFromPlan(
    databaseUrl: string,
    plan: DryRunPlan,
    routeCode: string,
): Promise<ImportResult> {
    const pool = new pg.Pool({ connectionString: databaseUrl, max: 1, statement_timeout: 180_000 });
    const client = await pool.connect();
    try {
        const { routeActions, stopActions } = routeImportSlices(plan, routeCode);
        return await executeRouteImport({ client, plan, routeCode, routeActions, stopActions });
    } finally {
        client.release();
        await pool.end();
    }
}

function routeDecision(plan: DryRunPlan, routeCode: string, state: RouteDbState | undefined): RouteDecisionSummary {
    const actions = routeScopedActions(plan, routeCode);
    const routeAction =
        actions.find((action) => action.entity_type === "route" && action.action === "insert_route") ??
        actions.find((action) => action.entity_type === "route" && action.action === "update_unreviewed_route") ??
        actions.find((action) => action.entity_type === "route" && action.action === "skip_protected_route") ??
        actions.find((action) => action.entity_type === "route" && action.action === "blocked_conflict");
    const sourceLinkTypes = [
        ...new Set(
            actions
                .filter((action) => action.action === "insert_source_link" || action.action === "reuse_source_link")
                .map((action) => String(action.payload.entity_type ?? action.entity_type)),
        ),
    ].sort();
    return {
        route_code: routeCode,
        exists_in_supabase: Boolean(state?.route),
        existing_route_id: state?.route?.id ?? null,
        decision: routeAction?.action ?? "no_route_action",
        blockers: plan.blockers.filter((item) => item.route_code === routeCode).map((item) => item.message),
        planned_counts: countActions(actions),
        source_link_entity_types: sourceLinkTypes,
    };
}

function writePhase5Report(runRoot: string, report: Phase5NormalizationReport): PhaseReportSummary {
    const routeRows = report.routes.map((route) => [
        route.route_code ?? "unknown",
        route.normalization_status,
        route.quality_score,
        route.blocking_error_count,
        route.warning_count,
    ]);
    const hasBlockingErrors = report.routes.some((route) => route.blocking_error_count > 0);
    const allReady = report.routes.every((route) => route.normalization_status === "ready_for_phase6");
    const status: PhaseStatus = allReady ? "passed" : hasBlockingErrors ? "failed" : "warning";
    writeTextFile(
        path.join(runRoot, "reports/05-normalization.md"),
        phaseMarkdown("Phase 5 Normalization", [
            `- Status: ${status}`,
            `- Ready routes: ${report.summary.ready_for_phase6}/${report.summary.total_routes}`,
            `- Blocking dirty stop data: ${hasBlockingErrors ? "yes" : "no"}`,
            "",
            markdownTable(["Route", "Status", "Quality", "Blocking errors", "Warnings"], routeRows),
        ]),
    );
    return {
        phase: "05-normalization",
        status,
        summary:
            status === "passed"
                ? "Both routes are ready for Phase 6."
                : status === "warning"
                  ? "Routes have warnings only; no blocking dirty stop data was found."
                  : "One or more routes are blocked before Phase 6.",
        details: report.summary,
    };
}

function writePhase6Report(runRoot: string, routeCodes: string[], phase6: unknown): PhaseReportSummary {
    const report = phase6 as { summary?: Record<string, unknown> };
    const summary = report.summary ?? {};
    const blocked = Number(summary.blocked_conflict ?? 0) + Number(summary.blocked_missing_clean_name ?? 0);
    const ok = Number(summary.unique_stop_candidates ?? 0) > 0 && blocked === 0;
    writeTextFile(
        path.join(runRoot, "reports/06-stop-resolution.md"),
        phaseMarkdown("Phase 6 Stop Resolution", [
            `- Status: ${ok ? "passed" : "failed"}`,
            `- Routes: ${routeCodes.join(", ")}`,
            `- Total stop usages: ${summary.total_stop_usages ?? 0}`,
            `- Unique stop candidates: ${summary.unique_stop_candidates ?? 0}`,
            `- Reuse existing stops: ${summary.reuse_existing_stop ?? 0}`,
            `- Create new stops: ${summary.create_new_stop ?? 0}`,
            `- Merge additional data: ${summary.merge_additional_data_to_existing ?? 0}`,
            `- Geometry anchors available: ${summary.geometry_anchors_available ?? 0}`,
            `- Geometry anchors from merge: ${summary.geometry_anchors_from_merge ?? 0}`,
            `- Matched stops without geometry: ${summary.matched_stops_without_geometry ?? 0}`,
            `- Needs manual review: ${summary.needs_manual_review ?? 0}`,
            `- Blocked conflicts: ${summary.blocked_conflict ?? 0}`,
        ]),
    );
    return {
        phase: "06-stop-resolution",
        status: statusFromBoolean(ok),
        summary: ok ? "Stop resolution plan exists with no blocked conflicts." : "Stop resolution has blockers.",
        details: summary,
    };
}

function writePhase7Report(runRoot: string, routeCodes: string[], geometry: RoutesWithGeometryOutput): PhaseReportSummary {
    const routeRows = routeCodes.map((routeCode) => {
        const variants = geometry.prepared_variants.filter((item) => item.route_code === routeCode);
        const blocked = geometry.blocked_routes.filter((item) => item.route_code === routeCode);
        const variantReports = geometry.variant_geometry_reports.filter(
            (item) => item.route_code === routeCode,
        );
        const placeholderCount = variantReports.reduce(
            (sum, item) => sum + item.generated_stop_points_count,
            0,
        );
        const maxPathKm = variantReports.reduce(
            (max, item) => Math.max(max, item.route_path_length_km ?? 0),
            0,
        );
        return [
            routeCode,
            blocked.length > 0 ? "blocked" : "ready",
            variants.filter((item) => item.geometry_status === "ready").length,
            blocked.length,
            geometry.route_paths.filter((item) => item.route_code === routeCode).length,
            placeholderCount,
            maxPathKm.toFixed(2),
        ];
    });
    const testVariants = geometry.prepared_variants.filter((item) =>
        routeCodes.includes(item.route_code),
    );
    const straightLineOk = testVariants.every(
        (item) =>
            item.placeholder_geometry_mode === "straight_line_review" &&
            item.placeholder_line_created &&
            (item.route_path_length_km ?? 0) >= 3 &&
            (item.route_path_length_km ?? 0) <= 6.5,
    );
    const pathGeometryOk = geometry.route_paths
        .filter((item) => routeCodes.includes(item.route_code))
        .every((item) => item.geometry.coordinates.length === 2);
    const ok =
        testVariants.length > 0 &&
        testVariants.every(
            (item) =>
                item.geometry_status === "ready" &&
                item.missing_geometry_count === 0 &&
                item.route_path_created,
        ) &&
        testVariants.reduce((sum, item) => sum + item.missing_geometry_count, 0) === 0 &&
        straightLineOk &&
        pathGeometryOk;
    writeTextFile(
        path.join(runRoot, "reports/07-geometry.md"),
        phaseMarkdown("Phase 7 Geometry", [
            `- Status: ${ok ? "passed" : "failed"}`,
            `- Resolved stops: ${geometry.resolved_stops.length}`,
            `- Route paths: ${geometry.route_paths.length}`,
            `- Geometry warnings: ${geometry.geometry_warnings.length}`,
            `- Placeholder mode: straight_line_review (2-point path, 3-6 km)`,
            "",
            markdownTable(
                [
                    "Route",
                    "Geometry status",
                    "Ready variants",
                    "Blocked items",
                    "Route paths",
                    "Generated stops",
                    "Max path km",
                ],
                routeRows,
            ),
        ]),
    );
    return {
        phase: "07-geometry",
        status: statusFromBoolean(ok),
        summary: ok
            ? "All test-route variants have straight-line review geometry and route paths."
            : "One or more test-route variants lack straight-line review geometry or route paths.",
        details: {
            resolved_stops: geometry.resolved_stops.length,
            route_paths: geometry.route_paths.length,
            blocked_routes: geometry.blocked_routes,
            variant_geometry_reports: geometry.variant_geometry_reports.filter((item) =>
                routeCodes.includes(item.route_code),
            ),
        },
    };
}

function writePhase8Report(
    runRoot: string,
    decisions: RouteDecisionSummary[],
    existingRoute: string,
    newRoute: string,
    routeReadiness: Array<{
        route_code: string;
        executable: boolean;
        risk_level: string;
        blockers_count: number;
        held_for_review_count: number;
    }> = [],
): PhaseReportSummary {
    const ybs1 = decisions.find((item) => item.route_code === existingRoute);
    const ybs2 = decisions.find((item) => item.route_code === newRoute);
    const ybs1Readiness = routeReadiness.find((item) => item.route_code === existingRoute);
    const ybs2Readiness = routeReadiness.find((item) => item.route_code === newRoute);
    const ybs1Ok =
        ybs1?.exists_in_supabase &&
        ybs1.decision !== "insert_route" &&
        (ybs1Readiness?.executable ?? ybs1.blockers.length === 0);
    const ybs2Ok =
        ybs2 &&
        !ybs2.exists_in_supabase &&
        ybs2.decision === "insert_route" &&
        (ybs2Readiness?.executable ?? ybs2.blockers.length === 0);
    const ok = Boolean(ybs1Ok && ybs2Ok);
    writeTextFile(
        path.join(runRoot, "reports/08-dry-run.md"),
        phaseMarkdown("Phase 8 Supabase Dry-Run Plan", [
            `- Status: ${ok ? "passed" : "failed"}`,
            "",
            markdownTable(
                ["Route", "Exists", "Existing ID", "Decision", "Executable", "Risk", "Blockers"],
                decisions.map((decision) => {
                    const readiness = routeReadiness.find((item) => item.route_code === decision.route_code);
                    return [
                        decision.route_code,
                        decision.exists_in_supabase ? "yes" : "no",
                        decision.existing_route_id ?? "",
                        decision.decision,
                        readiness?.executable ? "yes" : "no",
                        readiness?.risk_level ?? "",
                        decision.blockers.join("; ") || "none",
                    ];
                }),
            ),
        ]),
    );
    return {
        phase: "08-dry-run",
        status: statusFromBoolean(ok),
        summary: ok ? "Existing route is not duplicated and new route is planned for insert." : "Dry-run decisions did not match expectations.",
        details: { decisions },
    };
}

async function runPhase9(
    options: CliOptions,
    databaseUrl: string,
    plan: DryRunPlan,
    preflight: PreflightReport,
): Promise<{ summary: PhaseReportSummary; results: Record<string, unknown> }> {
    const runRoot = resolveFromRepo(options.runRoot);
    const phase9Dir = path.join(runRoot, "phase9-import");
    const results: Record<string, unknown> = {};
    const routeCodes = [options.existingRoute, options.newRoute];

    for (const routeCode of routeCodes) {
        const scoped = routeScopedActions(plan, routeCode);
        const result = buildDryRunImportResult(routeCode, scoped);
        const outputName = routeCode === options.existingRoute ? "dry-run-YBS-1.json" : "dry-run-YBS-2.json";
        writeJsonFile(path.join(phase9Dir, outputName), {
            schema_version: 1,
            mode: "dry_run",
            route_code: routeCode,
            planned_counts: countActions(scoped),
            duplicate_route_insert_prevented:
                routeCode === options.existingRoute
                    ? !scoped.some((action) => action.entity_type === "route" && action.action === "insert_route")
                    : undefined,
            result,
        });
        results[`dry_run_${routeCode}`] = result;
    }

    let executeResult: ImportResult | null = null;
    let idempotencyResult: ImportResult | null = null;
    if (options.executeYbs2) {
        if (preflight.new_route_condition_failed) {
            throw new Error(`${options.newRoute} already exists. Refusing --execute-ybs2.`);
        }
        console.log(`[09-import] Executing ${options.newRoute} database import (may take 1–2 minutes)…`);
        executeResult = await executeRouteFromPlan(databaseUrl, plan, options.newRoute);
        console.log(
            `[09-import] Execute complete: errors=${executeResult.errors.length}, conflicts=${executeResult.conflicts.length}`,
        );
        writeJsonFile(path.join(phase9Dir, "execute-YBS-2.json"), executeResult);

        console.log(`[09-import] Rebuilding import plan for idempotency check…`);
        const rebuilt = await buildDryRunPlan({ runRoot: options.runRoot, databaseUrl });
        console.log(`[09-import] Running idempotency execute…`);
        idempotencyResult = await executeRouteFromPlan(databaseUrl, rebuilt.plan, options.newRoute);
        console.log(
            `[09-import] Idempotency complete: errors=${idempotencyResult.errors.length}, conflicts=${idempotencyResult.conflicts.length}`,
        );
        writeJsonFile(path.join(phase9Dir, "idempotency-YBS-2.json"), idempotencyResult);
    }

    const ybs1DryRun = results[`dry_run_${options.existingRoute}`] as ImportResult;
    const ybs2DryRun = results[`dry_run_${options.newRoute}`] as ImportResult;
    const ybs1Ok = ybs1DryRun.executed === false && ybs1DryRun.conflicts.length >= 0;
    const ybs2Ok = ybs2DryRun.executed === false && ybs2DryRun.conflicts.length === 0;
    const executeOk = !options.executeYbs2 || Boolean(executeResult && executeResult.errors.length === 0);
    const ok = ybs1Ok && ybs2Ok && executeOk;
    writeTextFile(
        path.join(runRoot, "reports/09-import.md"),
        phaseMarkdown("Phase 9 Import", [
            `- Status: ${ok ? "passed" : "failed"}`,
            `- Mode: ${options.executeYbs2 ? "execute YBS-2 only" : "dry-run only"}`,
            `- YBS-1 dry-run conflicts: ${ybs1DryRun.conflicts.length}`,
            `- YBS-2 dry-run conflicts: ${ybs2DryRun.conflicts.length}`,
            `- YBS-2 execute: ${executeResult ? "done" : "not requested"}`,
            `- YBS-2 idempotency: ${idempotencyResult ? "done" : "not requested"}`,
        ]),
    );

    return {
        results,
        summary: {
            phase: "09-import",
            status: statusFromBoolean(ok),
            summary: options.executeYbs2
                ? "YBS-2 execute path ran; idempotency artifact was written."
                : "Dry-run import artifacts were written; no database writes were made.",
            details: {
                execute_ybs2: Boolean(executeResult),
                idempotency_ybs2: Boolean(idempotencyResult),
            },
        },
    };
}

function mapValidationReport(
    report: RouteValidationReport,
    executedNewRoute: boolean,
    referenceOnly = false,
): RouteValidation {
    const baseStatus = report.status === "failed" && referenceOnly ? "warning" : report.status;
    return {
        route_code: report.route_code,
        status: baseStatus,
        mode:
            report.route_count === 0
                ? "not_imported_yet"
                : referenceOnly
                  ? "reference_only"
                  : executedNewRoute
                    ? "executed_validation"
                    : "current_db_state",
        route_count: report.route_count,
        variant_count: report.variant_count,
        route_stop_count: report.route_stop_count,
        route_path_count: report.route_path_count,
        source_links_missing_count: report.source_links_missing_count,
        sequence_error_count: report.sequence_error_count,
        geometry_missing_count: report.geometry_missing_count,
        duplicate_route_count: report.duplicate_route_count,
        duplicate_sequence_count: report.duplicate_route_stop_sequence_count,
        public_visible: report.public_visible,
        review_status: report.review_status,
        blockers: report.blockers.map((item) => item.message),
        warnings: report.warnings.map((item) => item.message),
        variant_route_stop_validation: report.variant_route_stop_validation,
    };
}

async function runValidationPhase(
    options: CliOptions,
    databaseUrl: string,
): Promise<{ summary: PhaseReportSummary; validations: RouteValidation[] }> {
    const runRoot = resolveFromRepo(options.runRoot);
    const validations = [
        mapValidationReport(
            (
                await validateImportedYbs({
                    runRoot: options.runRoot,
                    routeCode: options.existingRoute,
                    databaseUrl,
                })
            )[0],
            false,
            options.executeYbs2,
        ),
        mapValidationReport(
            (
                await validateImportedYbs({
                    runRoot: options.runRoot,
                    routeCode: options.newRoute,
                    databaseUrl,
                })
            )[0],
            options.executeYbs2,
        ),
    ];
    writeJsonFile(path.join(runRoot, "phase10-validation/validation-YBS-1.json"), validations[0]);
    writeJsonFile(path.join(runRoot, "phase10-validation/validation-YBS-2.json"), validations[1]);
    const ok = validationGatePassed(validations, options);
    writeTextFile(
        path.join(runRoot, "reports/10-db-validation.md"),
        phaseMarkdown("Phase 10 DB Validation", [
            `- Status: ${ok ? "passed" : "failed"}`,
            options.executeYbs2
                ? `- Gate: only ${options.newRoute} must pass in execute mode; ${options.existingRoute} is reference-only.`
                : "",
            "",
            markdownTable(
                ["Route", "Mode", "Route count", "Variants", "Stops", "Paths", "Missing source links", "Blockers"],
                validations.map((item) => [
                    item.route_code,
                    item.mode,
                    item.route_count,
                    item.variant_count,
                    item.route_stop_count,
                    item.route_path_count,
                    item.source_links_missing_count,
                    item.blockers.join("; ") || "none",
                ]),
            ),
            "",
            "### Variant route_stop validation",
            "",
            ...validations.flatMap((item) => {
                const rows = item.variant_route_stop_validation ?? [];
                if (rows.length === 0) {
                    return [`- ${item.route_code}: no extraction comparison`];
                }
                return [
                    `- ${item.route_code}`,
                    ...rows.map(
                        (variant) =>
                            `  - ${variant.variant_code}: expected=${variant.expected_stop_count_from_extraction} actual=${variant.actual_route_stop_count} missing=${variant.missing_sequences.length > 0 ? variant.missing_sequences.join(",") : "none"} status=${variant.status}`,
                    ),
                ];
            }),
        ]),
    );
    return {
        validations,
        summary: {
            phase: "10-db-validation",
            status: statusFromBoolean(ok),
            summary: ok ? "DB validation is acceptable for the selected mode." : "DB validation found blockers.",
            details: { validations },
        },
    };
}

async function dashboardCheck(databaseUrl: string, routeCode: string): Promise<DashboardCheck> {
    return withReadOnlyClient(databaseUrl, async (client) => {
        const routes = await client.query<DbRouteRow>(
            `
            SELECT route_code, id::int, public_id::text, public_name, review_status, is_active
            FROM transport.routes
            WHERE route_code = $1 AND deleted_at IS NULL
            ORDER BY id ASC
            `,
            [routeCode],
        );
        const route = routes.rows[0] ?? null;
        if (!route) {
            return {
                route_code: routeCode,
                status: "warning",
                dashboard_visible: false,
                route_id: null,
                variants_exist: false,
                route_stops_exist: false,
                route_paths_exist: false,
                source_links_exist: false,
                stop_details_loadable: false,
                routes_using_stop_queryable: false,
                manual_checklist: dashboardManualChecklist(routeCode),
            };
        }
        const counts = await client.query<{
            variants: string;
            route_stops: string;
            route_paths: string;
            source_links: string;
            stop_details: string;
            routes_using_stop: string;
        }>(
            `
            WITH route_variants AS (
              SELECT id FROM transport.route_variants WHERE route_id = $1 AND deleted_at IS NULL
            ),
            route_stop_rows AS (
              SELECT rs.id, rs.stop_id, rs.route_variant_id
              FROM transport.route_stops rs
              JOIN route_variants v ON v.id = rs.route_variant_id
            ),
            one_stop AS (
              SELECT stop_id FROM route_stop_rows LIMIT 1
            )
            SELECT
              (SELECT count(*) FROM route_variants)::text AS variants,
              (SELECT count(*) FROM route_stop_rows)::text AS route_stops,
              (SELECT count(*) FROM transport.route_paths rp JOIN route_variants v ON v.id = rp.route_variant_id WHERE rp.deleted_at IS NULL)::text AS route_paths,
              (SELECT count(*) FROM transport.source_links WHERE entity_type = 'route' AND entity_id = $1)::text AS source_links,
              (SELECT count(*) FROM transport.stops s JOIN one_stop os ON os.stop_id = s.id)::text AS stop_details,
              (SELECT count(*) FROM route_stop_rows rs JOIN one_stop os ON os.stop_id = rs.stop_id)::text AS routes_using_stop
            `,
            [route.id],
        );
        const c = counts.rows[0];
        const result: DashboardCheck = {
            route_code: routeCode,
            status: "passed",
            dashboard_visible: true,
            route_id: route.id,
            variants_exist: Number(c?.variants ?? 0) > 0,
            route_stops_exist: Number(c?.route_stops ?? 0) > 0,
            route_paths_exist: Number(c?.route_paths ?? 0) > 0,
            source_links_exist: Number(c?.source_links ?? 0) > 0,
            stop_details_loadable: Number(c?.stop_details ?? 0) > 0,
            routes_using_stop_queryable: Number(c?.routes_using_stop ?? 0) > 0,
            manual_checklist: dashboardManualChecklist(routeCode),
        };
        return result;
    });
}

function dashboardManualChecklist(routeCode: string): string[] {
    if (routeCode === "YBS-1") {
        return [
            "Open /dashboard/transport/routes.",
            "Search YBS-1.",
            "Confirm it did not duplicate.",
            "Confirm existing route remains editable.",
        ];
    }
    return [
        "Open /dashboard/transport/routes.",
        "Search YBS-2.",
        "Confirm route appears if executed.",
        "Confirm variants = 2.",
        "Confirm stops > 0.",
        "Confirm path appears.",
        "Open route detail and confirm ordered stops load.",
        "Open one stop and confirm source links.",
    ];
}

async function runDashboardPhase(
    options: CliOptions,
    databaseUrl: string,
): Promise<{ summary: PhaseReportSummary; checks: DashboardCheck[] }> {
    const runRoot = resolveFromRepo(options.runRoot);
    const checks = [
        await dashboardCheck(databaseUrl, options.existingRoute),
        await dashboardCheck(databaseUrl, options.newRoute),
    ];
    writeJsonFile(path.join(runRoot, "phase11-dashboard-check/dashboard-check-YBS-1.json"), checks[0]);
    writeJsonFile(path.join(runRoot, "phase11-dashboard-check/dashboard-check-YBS-2.json"), checks[1]);
    const ok = checks[0].dashboard_visible && (!options.executeYbs2 || checks[1].dashboard_visible);
    writeTextFile(
        path.join(runRoot, "reports/11-dashboard-check.md"),
        phaseMarkdown("Phase 11 Dashboard Check", [
            `- Status: ${ok ? "passed" : "warning"}`,
            "",
            markdownTable(
                ["Route", "Dashboard visible", "Variants", "Stops", "Paths", "Source links"],
                checks.map((item) => [
                    item.route_code,
                    item.dashboard_visible ? "yes" : "no",
                    item.variants_exist ? "yes" : "no",
                    item.route_stops_exist ? "yes" : "no",
                    item.route_paths_exist ? "yes" : "no",
                    item.source_links_exist ? "yes" : "no",
                ]),
            ),
            "",
            "Manual checklist is included in each JSON file.",
        ]),
    );
    return {
        checks,
        summary: {
            phase: "11-dashboard-check",
            status: ok ? "passed" : "warning",
            summary: ok ? "Dashboard DB support checks passed." : "Dashboard checks are partial because route is not executed yet.",
            details: { checks },
        },
    };
}

async function publicCheck(databaseUrl: string, routeCode: string): Promise<PublicCheck> {
    return withReadOnlyClient(databaseUrl, async (client) => {
        const rows = await client.query<DbRouteRow>(
            `
            SELECT route_code, id::int, public_id::text, public_name, review_status, is_active
            FROM transport.routes
            WHERE route_code = $1 AND deleted_at IS NULL
            ORDER BY id ASC
            `,
            [routeCode],
        );
        const route = rows.rows[0] ?? null;
        if (!route) {
            return {
                route_code: routeCode,
                status: "passed",
                dashboard_visible: false,
                public_visible: false,
                reason_hidden: "not_imported_yet",
                review_status: null,
                is_active: null,
            };
        }
        const publicVisible =
            (route.review_status === "reviewed" || route.review_status === "verified") &&
            route.is_active;
        const reasonHidden = publicVisible
            ? null
            : !route.is_active
              ? "inactive"
              : `review_status=${route.review_status}`;
        return {
            route_code: routeCode,
            status: "passed",
            dashboard_visible: true,
            public_visible: publicVisible,
            reason_hidden: reasonHidden,
            review_status: route.review_status,
            is_active: route.is_active,
        };
    });
}

async function runPublicPhase(
    options: CliOptions,
    databaseUrl: string,
): Promise<{ summary: PhaseReportSummary; checks: PublicCheck[] }> {
    const runRoot = resolveFromRepo(options.runRoot);
    const checks = [
        await publicCheck(databaseUrl, options.existingRoute),
        await publicCheck(databaseUrl, options.newRoute),
    ];
    writeJsonFile(path.join(runRoot, "phase12-public-check/public-check-YBS-1.json"), checks[0]);
    writeJsonFile(path.join(runRoot, "phase12-public-check/public-check-YBS-2.json"), checks[1]);
    const ybs2 = checks[1];
    const ok = !options.executeYbs2 || (ybs2.dashboard_visible && !ybs2.public_visible);
    writeTextFile(
        path.join(runRoot, "reports/12-public-check.md"),
        phaseMarkdown("Phase 12 Public Release Safety", [
            `- Status: ${ok ? "passed" : "failed"}`,
            "",
            markdownTable(
                ["Route", "Dashboard visible", "Public visible", "Review status", "Active", "Reason hidden"],
                checks.map((item) => [
                    item.route_code,
                    item.dashboard_visible ? "yes" : "no",
                    item.public_visible ? "yes" : "no",
                    item.review_status ?? "",
                    item.is_active === null ? "" : String(item.is_active),
                    item.reason_hidden ?? "",
                ]),
            ),
        ]),
    );
    return {
        checks,
        summary: {
            phase: "12-public-check",
            status: statusFromBoolean(ok),
            summary: ok ? "Public release safety checks passed for selected mode." : "Public visibility is unsafe.",
            details: { checks },
        },
    };
}

function computeFlowFinalStatus(
    phaseSummaries: PhaseReportSummary[],
    options: CliOptions,
    newRouteValidation: RouteValidation | undefined,
): PhaseStatus {
    if (options.executeYbs2) {
        const blockingFailures = phaseSummaries.filter(
            (phase) => phase.status === "failed" && phase.phase !== "10-db-validation",
        );
        if (blockingFailures.length > 0) {
            return "failed";
        }
        return newRouteValidation?.status === "passed" ? "passed" : "failed";
    }
    return phaseSummaries.some((phase) => phase.status === "failed") ? "failed" : "passed";
}

function writeFinalReports(
    options: CliOptions,
    phaseSummaries: PhaseReportSummary[],
    extra: Record<string, unknown>,
    importSafety: ImportSafetyReport,
    newRouteValidation?: RouteValidation,
): { jsonPath: string; mdPath: string; finalStatus: PhaseStatus } {
    const runRoot = resolveFromRepo(options.runRoot);
    const finalStatus = computeFlowFinalStatus(phaseSummaries, options, newRouteValidation);
    const json = {
        schema_version: 2,
        generated_at: new Date().toISOString(),
        mode: options.executeYbs2 ? "execute_ybs2" : "dry_run",
        final_status: finalStatus,
        new_route_import_status: newRouteValidation?.status ?? null,
        SAFE_TO_EXECUTE_YBS2: importSafety.SAFE_TO_EXECUTE_YBS2,
        SAFE_TO_UPDATE_YBS1: importSafety.SAFE_TO_UPDATE_YBS1,
        SAFE_FOR_BULK_IMPORT: importSafety.SAFE_FOR_BULK_IMPORT,
        import_safety: importSafety,
        routes: {
            existing_route: options.existingRoute,
            new_route: options.newRoute,
        },
        phases: phaseSummaries,
        next_recommended_action:
            importSafety.SAFE_TO_EXECUTE_YBS2 && !options.executeYbs2
                ? `Review the dry-run report. Execute ${options.newRoute} with import-ybs-plan --execute when ready.`
                : finalStatus === "passed" && options.executeYbs2
                  ? `Open the dashboard and review ${options.newRoute} before making it public.`
                  : importSafety.SAFE_TO_UPDATE_YBS1
                    ? `${options.existingRoute} can be updated with an explicit import command only.`
                    : "Fix failed phase blockers before executing imports.",
        ...extra,
    };
    const jsonPath = path.join(runRoot, "reports/FINAL-YBS-1-YBS-2-FLOW-REPORT.json");
    const mdPath = path.join(runRoot, "reports/FINAL-YBS-1-YBS-2-FLOW-REPORT.md");
    writeJsonFile(jsonPath, json);
    writeTextFile(
        mdPath,
        phaseMarkdown("FINAL YBS-1/YBS-2 Flow Report", [
            `- Final status: ${finalStatus}`,
            options.executeYbs2
                ? `- ${options.newRoute} import validation: ${newRouteValidation?.status ?? "unknown"}`
                : "",
            `- Mode: ${options.executeYbs2 ? "execute YBS-2" : "dry-run only"}`,
            `- Existing route: ${options.existingRoute}`,
            `- New route: ${options.newRoute}`,
            "",
            `- SAFE_TO_EXECUTE_YBS2: ${importSafety.SAFE_TO_EXECUTE_YBS2}`,
            `- SAFE_TO_UPDATE_YBS1: ${importSafety.SAFE_TO_UPDATE_YBS1}`,
            `- SAFE_FOR_BULK_IMPORT: ${importSafety.SAFE_FOR_BULK_IMPORT}`,
            "",
            markdownTable(
                ["Phase", "Status", "Summary"],
                phaseSummaries.map((phase) => [phase.phase, phase.status, phase.summary]),
            ),
            "",
            `Bulk import readiness: ${String((extra.phase8_bulk_import_readiness as { overall_status?: string } | undefined)?.overall_status ?? "unknown")}`,
            "",
            `Next recommended action: ${json.next_recommended_action}`,
        ]),
    );
    return { jsonPath, mdPath, finalStatus };
}

function mirrorPhaseOutputs(runRoot: string): void {
    copyIfExists(path.join(runRoot, "db-prep/stop-usages.json"), path.join(runRoot, "phase6-stop-resolution/stop-usages.json"));
    copyIfExists(path.join(runRoot, "db-prep/stop-candidates.json"), path.join(runRoot, "phase6-stop-resolution/stop-candidates.json"));
    copyIfExists(path.join(runRoot, "db-prep/stop-resolution-plan.json"), path.join(runRoot, "phase6-stop-resolution/stop-resolution-plan.json"));
    copyIfExists(path.join(runRoot, "db-prep/routes-with-geometry.json"), path.join(runRoot, "phase7-geometry/routes-with-geometry.json"));
    copyIfExists(path.join(runRoot, "supabase-dry-run/plan.json"), path.join(runRoot, "phase8-dry-run/plan.json"));
}

function formatElapsedMs(ms: number): string {
    return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

async function runWithProgress<T>(phase: string, label: string, fn: () => Promise<T>): Promise<T> {
    const started = Date.now();
    console.log(`[${phase}] ${label}…`);
    try {
        const result = await fn();
        console.log(`[${phase}] done (${formatElapsedMs(Date.now() - started)})`);
        return result;
    } catch (error) {
        console.error(`[${phase}] failed (${formatElapsedMs(Date.now() - started)})`);
        throw error;
    }
}

function validationGatePassed(validations: RouteValidation[], options: CliOptions): boolean {
    if (options.executeYbs2) {
        const newRouteValidation = validations.find((item) => item.route_code === options.newRoute);
        return newRouteValidation?.status === "passed";
    }
    return validations.every((item) => item.status !== "failed");
}

async function main(): Promise<void> {
    loadDatabaseEnv();
    const options = parseCliArgs(process.argv.slice(2));
    const runRoot = resolveFromRepo(options.runRoot);
    const databaseUrl = resolveDatabaseUrl(options.databaseUrl);
    const routeCodes = [options.existingRoute, options.newRoute];
    ensureDir(path.join(runRoot, "reports"));

    console.log(
        `YBS flow test starting (mode: ${options.executeYbs2 ? `execute ${options.newRoute}` : "dry-run only"})`,
    );
    console.log(`Run root: ${options.runRoot}`);
    if (options.executeYbs2) {
        console.log("Long phases (stop resolution, dry-run plan, import) print progress below.");
    }

    const phaseSummaries: PhaseReportSummary[] = [];

    const preflight = await runWithProgress("00-preflight", "Checking source files and DB route state", () =>
        runPreflight(options, databaseUrl, routeCodes),
    );
    phaseSummaries.push({
        phase: "00-preflight",
        status: preflight.safe_to_continue && !preflight.new_route_condition_failed ? "passed" : preflight.safe_to_continue ? "warning" : "failed",
        summary: preflight.new_route_condition_failed
            ? `${options.newRoute} already exists. Execute mode is disabled.`
            : preflight.safe_to_continue
              ? "Source files and expected route existence checks passed."
              : "Preflight found blocking issues.",
        details: {
            new_route_condition_failed: preflight.new_route_condition_failed,
            database_url_host: preflight.database_url_host,
        },
    });
    if (options.executeYbs2 && preflight.new_route_condition_failed) {
        throw new Error(`${options.newRoute} already exists. Refusing --execute-ybs2.`);
    }

    const phase5 = await runWithProgress("05-normalization", "Normalizing merged route JSON", async () =>
        normalizeMergedRoutes({
            runRoot: options.runRoot,
            inputDir: path.join(runRoot, "input"),
            outputDir: path.join(runRoot, "phase5-normalized/routes"),
            reportsDir: path.join(runRoot, "reports/_phase5-original"),
            routeCodes,
        }),
    );
    for (const routeCode of routeCodes) {
        copyFile(path.join(runRoot, "phase5-normalized/routes", `${routeCode}.json`), path.join(runRoot, "normalized/routes", `${routeCode}.json`));
    }
    phaseSummaries.push(writePhase5Report(runRoot, phase5));

    const phase6 = await runWithProgress("06-stop-resolution", "Building stop resolution plan", () =>
        buildStopResolution({ runRoot: options.runRoot, databaseUrl }),
    );
    mirrorPhaseOutputs(runRoot);
    phaseSummaries.push(writePhase6Report(runRoot, routeCodes, phase6));

    const { output: geometry } = await runWithProgress("07-geometry", "Preparing straight-line review geometry", () =>
        prepareGeometry({ runRoot: options.runRoot, databaseUrl }),
    );
    mirrorPhaseOutputs(runRoot);
    phaseSummaries.push(writePhase7Report(runRoot, routeCodes, geometry));

    const { plan, report: phase8Report } = await runWithProgress(
        "08-dry-run",
        "Building Supabase dry-run import plan",
        () => buildDryRunPlan({ runRoot: options.runRoot, databaseUrl }),
    );
    mirrorPhaseOutputs(runRoot);
    const statesAfterPlan = await loadRouteStates(databaseUrl, routeCodes);
    const decisions = routeCodes.map((routeCode) => routeDecision(plan, routeCode, statesAfterPlan[routeCode]));
    phaseSummaries.push(
        writePhase8Report(
            runRoot,
            decisions,
            options.existingRoute,
            options.newRoute,
            phase8Report.route_readiness_reports,
        ),
    );

    const phase9 = await runWithProgress("09-import", options.executeYbs2 ? "Importing route to database" : "Writing dry-run import artifacts", () =>
        runPhase9(options, databaseUrl, plan, preflight),
    );
    phaseSummaries.push(phase9.summary);

    const phase10 = await runWithProgress("10-db-validation", "Validating imported DB state", () =>
        runValidationPhase(options, databaseUrl),
    );
    phaseSummaries.push(phase10.summary);

    const phase11 = await runWithProgress("11-dashboard-check", "Running dashboard support checks", () =>
        runDashboardPhase(options, databaseUrl),
    );
    phaseSummaries.push(phase11.summary);

    const phase12 = await runWithProgress("12-public-check", "Running public visibility checks", () =>
        runPublicPhase(options, databaseUrl),
    );
    phaseSummaries.push(phase12.summary);

    const ybs1Decision = decisions.find((item) => item.route_code === options.existingRoute);
    const ybs2Decision = decisions.find((item) => item.route_code === options.newRoute);
    const ybs1Readiness = phase8Report.route_readiness_reports.find(
        (item) => item.route_code === options.existingRoute,
    );
    const ybs2Readiness = phase8Report.route_readiness_reports.find(
        (item) => item.route_code === options.newRoute,
    );
    const importSafety = buildImportSafetyReport({
        existingRoute: options.existingRoute,
        newRoute: options.newRoute,
        ybs1: assessRouteExecuteSafetyFromPlan({
            routeCode: options.existingRoute,
            existsInSupabase: Boolean(ybs1Decision?.exists_in_supabase),
            planDecision: ybs1Decision?.decision ?? null,
            routeBlockers: ybs1Decision?.blockers ?? [],
            executable: ybs1Readiness?.executable ?? false,
            riskLevel: ybs1Readiness?.risk_level ?? "high",
        }),
        ybs2: assessRouteExecuteSafetyFromPlan({
            routeCode: options.newRoute,
            existsInSupabase: Boolean(ybs2Decision?.exists_in_supabase),
            planDecision: ybs2Decision?.decision ?? null,
            routeBlockers: ybs2Decision?.blockers ?? [],
            executable: ybs2Readiness?.executable ?? false,
            riskLevel: ybs2Readiness?.risk_level ?? "high",
        }),
        bulkImportStatus: phase8Report.bulk_import_readiness.overall_status,
        phase10Passed: validationGatePassed(phase10.validations, options),
    });

    const newRouteValidation = phase10.validations.find((item) => item.route_code === options.newRoute);
    const final = writeFinalReports(
        options,
        phaseSummaries,
        {
            preflight,
            phase8_decisions: decisions,
            phase8_bulk_import_readiness: phase8Report.bulk_import_readiness,
            phase8_route_readiness_reports: phase8Report.route_readiness_reports,
            phase10_validations: phase10.validations,
            phase11_dashboard_checks: phase11.checks,
            phase12_public_checks: phase12.checks,
        },
        importSafety,
        newRouteValidation,
    );

    if (options.executeYbs2 && newRouteValidation?.status === "passed") {
        console.log(`${options.newRoute} import: PASSED`);
    }
    console.log(`YBS flow test ${final.finalStatus.toUpperCase()}`);
    console.log(`Mode: ${options.executeYbs2 ? "execute YBS-2" : "dry-run only"}`);
    console.log(`Final report: ${final.mdPath}`);
    console.log(`Final JSON: ${final.jsonPath}`);
    console.log(`SAFE_TO_EXECUTE_YBS2: ${importSafety.SAFE_TO_EXECUTE_YBS2}`);
    console.log(`SAFE_TO_UPDATE_YBS1: ${importSafety.SAFE_TO_UPDATE_YBS1}`);
    console.log(`SAFE_FOR_BULK_IMPORT: ${importSafety.SAFE_FOR_BULK_IMPORT}`);
    for (const phase of phaseSummaries) {
        console.log(`${phase.phase}: ${phase.status} - ${phase.summary}`);
    }
}

const isMainModule =
    process.argv[1] &&
    path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);

if (isMainModule) {
    main().catch((error) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
    });
}

