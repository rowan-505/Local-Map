/**
 * Bulk YBS import runner with safety limits.
 *
 * Default mode is dry-run. Pass --execute to write routes to Supabase.
 *
 * Usage:
 *   npx tsx tools/data-pipeline/transport-json-import/ybs-supabase-import/import/bulk-import-ybs.ts \
 *     --run tmp/transport-imports/ybs-all \
 *     --route-code YBS-2 \
 *     [--execute]
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import dotenv from "dotenv";
import pg from "pg";

import { buildDryRunPlan } from "./build-dry-run-plan.js";
import type { DryRunPlan } from "../lib/import-plan-types.js";
import { runImport, type CliOptions as SingleImportOptions } from "./import-ybs-plan.js";
import type { RouteReadinessReport } from "../lib/route-import-policy.js";
import { rebuildSearchFamiliesPg } from "../../../../search-index/rebuild-search-families-pg.js";

const TRANSPORT_BULK_IMPORT_SEARCH_VIEWS = ["bus_stops", "bus_routes"] as const;

export type BulkImportOptions = {
    runRoot: string;
    routeCodes: string[];
    execute: boolean;
    databaseUrl?: string;
    maxRoutes: number;
    maxRoutesExplicit: boolean;
    skipExistingRoutes: boolean;
    onlyNewRoutes: boolean;
    onlyCleanRoutes: boolean;
    allowPlaceholderGeometry: boolean;
    allowHighRisk: boolean;
    replaceExistingUnreviewedRouteStops: boolean;
    rebuildPlan: boolean;
};

export type BulkImportRouteResult = {
    route_code: string;
    status: "imported" | "dry_run" | "skipped";
    reason: string | null;
    readiness: RouteReadinessReport | null;
};

export type BulkImportReport = {
    generated_at: string;
    run_root: string;
    mode: "execute" | "dry_run";
    overall_status:
        | "READY_FOR_TEST_IMPORT"
        | "READY_FOR_SMALL_BATCH_IMPORT"
        | "NOT_READY_FOR_BULK_IMPORT";
    selected_routes: string[];
    skipped_routes: BulkImportRouteResult[];
    results: BulkImportRouteResult[];
    bulk_import_readiness: DryRunPlan["bulk_import_readiness"] | null;
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

function readJsonFile<T>(filePath: string): T {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function writeJsonFile(filePath: string, data: unknown): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function loadRouteCodesFile(filePath: string): string[] {
    const absolute = resolveFromRepo(filePath);
    const text = fs.readFileSync(absolute, "utf8");
    return text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith("#"));
}

function discoverRouteCodesFromPlan(plan: DryRunPlan): string[] {
    return plan.route_readiness_reports.map((route) => route.route_code);
}

function shouldSkipRoute(
    readiness: RouteReadinessReport,
    options: BulkImportOptions,
): string | null {
    if (!readiness.executable) {
        return readiness.reasons.join("; ") || "Route is not executable.";
    }

    if (options.skipExistingRoutes && readiness.exists_in_supabase) {
        return "Route already exists (--skip-existing-routes).";
    }

    if (options.onlyNewRoutes && readiness.exists_in_supabase) {
        return "Route already exists (--only-new-routes).";
    }

    if (options.onlyCleanRoutes) {
        if (readiness.risk_level !== "low") {
            return `Route risk_level=${readiness.risk_level} (--only-clean-routes).`;
        }
        if (readiness.manual_review_stops_count > 0 || readiness.held_for_review_count > 0) {
            return "Route has manual-review or held stops (--only-clean-routes).";
        }
        if (readiness.blockers_count > 0) {
            return "Route has blockers (--only-clean-routes).";
        }
    }

    if (!options.allowHighRisk && readiness.risk_level === "high") {
        return "Route risk_level=high (pass --allow-high-risk to override).";
    }

    if (!options.allowPlaceholderGeometry && readiness.placeholder_geometry_count > 0) {
        return "Route has placeholder geometry (pass --allow-placeholder-geometry to override).";
    }

    return null;
}

export async function runBulkImport(options: BulkImportOptions): Promise<BulkImportReport> {
    const runRoot = resolveFromRepo(options.runRoot);
    const planPath = path.join(runRoot, "supabase-dry-run/plan.json");
    const databaseUrl = resolveDatabaseUrl(options.databaseUrl);

    let plan: DryRunPlan;
    if (options.rebuildPlan || !fs.existsSync(planPath)) {
        const built = await buildDryRunPlan({
            runRoot: options.runRoot,
            databaseUrl,
            replaceExistingUnreviewedRouteStops: options.replaceExistingUnreviewedRouteStops,
        });
        plan = built.plan;
    } else {
        plan = readJsonFile<DryRunPlan>(planPath);
    }

    const readinessByRoute = new Map(
        plan.route_readiness_reports.map((route) => [route.route_code, route]),
    );

    const requestedRoutes =
        options.routeCodes.length > 0 ? options.routeCodes : discoverRouteCodesFromPlan(plan);

    const selectedRoutes = requestedRoutes.slice(0, options.maxRoutesExplicit ? options.maxRoutes : 5);
    const maxRoutes = options.maxRoutesExplicit ? options.maxRoutes : 5;

    const skipped: BulkImportRouteResult[] = [];
    const results: BulkImportRouteResult[] = [];

    for (const routeCode of requestedRoutes.slice(maxRoutes)) {
        skipped.push({
            route_code: routeCode,
            status: "skipped",
            reason: `Beyond max route limit (${maxRoutes}). Pass --max-routes to raise.`,
            readiness: readinessByRoute.get(routeCode) ?? null,
        });
    }

    for (const routeCode of selectedRoutes) {
        const readiness = readinessByRoute.get(routeCode) ?? null;
        if (!readiness) {
            skipped.push({
                route_code: routeCode,
                status: "skipped",
                reason: "Route not found in Phase 8 readiness report.",
                readiness: null,
            });
            continue;
        }

        const skipReason = shouldSkipRoute(readiness, options);
        if (skipReason) {
            skipped.push({
                route_code: routeCode,
                status: "skipped",
                reason: skipReason,
                readiness,
            });
            continue;
        }

        const singleOptions: SingleImportOptions = {
            runRoot: options.runRoot,
            routeCode,
            execute: options.execute,
            databaseUrl: options.databaseUrl,
            replaceExistingUnreviewedRouteStops: options.replaceExistingUnreviewedRouteStops,
        };

        await runImport(singleOptions);
        results.push({
            route_code: routeCode,
            status: options.execute ? "imported" : "dry_run",
            reason: null,
            readiness,
        });
    }

    const report: BulkImportReport = {
        generated_at: new Date().toISOString(),
        run_root: runRoot,
        mode: options.execute ? "execute" : "dry_run",
        overall_status: plan.bulk_import_readiness?.overall_status ?? "NOT_READY_FOR_BULK_IMPORT",
        selected_routes: selectedRoutes,
        skipped_routes: skipped,
        results,
        bulk_import_readiness: plan.bulk_import_readiness ?? null,
    };

    writeJsonFile(path.join(runRoot, "reports/bulk-import-ybs-report.json"), report);

    const importedCount = results.filter((row) => row.status === "imported").length;
    if (options.execute && importedCount > 0 && databaseUrl) {
        await rebuildSearchFamiliesPg(databaseUrl, TRANSPORT_BULK_IMPORT_SEARCH_VIEWS);
    }

    return report;
}

export function parseBulkImportArgs(argv: string[]): BulkImportOptions {
    let runRoot = "tmp/transport-imports/ybs-all";
    let routeCode = "";
    let routeCodesFile = "";
    let execute = false;
    let databaseUrl: string | undefined;
    let maxRoutes = 5;
    let maxRoutesExplicit = false;
    let skipExistingRoutes = false;
    let onlyNewRoutes = false;
    let onlyCleanRoutes = false;
    let allowPlaceholderGeometry = false;
    let allowHighRisk = false;
    let replaceExistingUnreviewedRouteStops = false;
    let rebuildPlan = false;

    for (let index = 0; index < argv.length; index++) {
        const arg = argv[index];
        const next = argv[index + 1];

        if ((arg === "--run" || arg === "--run-root") && next) {
            runRoot = next.trim();
            index++;
        } else if (arg === "--route-code" && next) {
            routeCode = next.trim();
            index++;
        } else if (arg === "--route-codes-file" && next) {
            routeCodesFile = next.trim();
            index++;
        } else if (arg === "--database-url" && next) {
            databaseUrl = next.trim();
            index++;
        } else if (arg === "--max-routes" && next) {
            maxRoutes = Number(next);
            maxRoutesExplicit = true;
            index++;
        } else if (arg === "--execute") {
            execute = true;
        } else if (arg === "--skip-existing-routes") {
            skipExistingRoutes = true;
        } else if (arg === "--only-new-routes") {
            onlyNewRoutes = true;
        } else if (arg === "--only-clean-routes") {
            onlyCleanRoutes = true;
        } else if (arg === "--allow-placeholder-geometry") {
            allowPlaceholderGeometry = true;
        } else if (arg === "--allow-high-risk") {
            allowHighRisk = true;
        } else if (arg === "--replace-existing-unreviewed-route-stops") {
            replaceExistingUnreviewedRouteStops = true;
        } else if (arg === "--rebuild-plan") {
            rebuildPlan = true;
        }
    }

    const routeCodes = routeCodesFile
        ? loadRouteCodesFile(routeCodesFile)
        : routeCode
          ? [routeCode]
          : [];

    return {
        runRoot,
        routeCodes,
        execute,
        databaseUrl,
        maxRoutes: Number.isFinite(maxRoutes) && maxRoutes > 0 ? maxRoutes : 5,
        maxRoutesExplicit,
        skipExistingRoutes,
        onlyNewRoutes,
        onlyCleanRoutes,
        allowPlaceholderGeometry,
        allowHighRisk,
        replaceExistingUnreviewedRouteStops,
        rebuildPlan,
    };
}

async function main(): Promise<void> {
    loadDatabaseEnv();
    const options = parseBulkImportArgs(process.argv.slice(2));
    const report = await runBulkImport(options);

    console.log(`Bulk YBS import ${report.mode.toUpperCase()}`);
    console.log(`Overall readiness: ${report.overall_status}`);
    console.log(`Selected routes: ${report.selected_routes.join(", ") || "(none)"}`);
    console.log(`Imported/dry-run: ${report.results.length}`);
    console.log(`Skipped: ${report.skipped_routes.length}`);
    for (const row of report.skipped_routes) {
        console.log(`  SKIP ${row.route_code}: ${row.reason}`);
    }
    for (const row of report.results) {
        console.log(`  ${row.status.toUpperCase()} ${row.route_code}`);
    }
}

const isMainModule =
    process.argv[1] &&
    path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);

if (isMainModule) {
    main().catch((error) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    });
}
