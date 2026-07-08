#!/usr/bin/env npx tsx
/**
 * Validate all YBS/bus routes discovered from merged JSON source files.
 *
 * Usage:
 *   npx tsx tools/data-pipeline/transport-json-import/ybs-supabase-import/validate-all-imported-bus.ts \
 *     --source-dir tmp/transport-imports/ybs-all/merged/routes
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import dotenv from "dotenv";
import pg from "pg";

import {
    markdownTable,
    phaseMarkdown,
    writeJsonFile,
    writeTextFile,
} from "./test-flow-report.js";
import {
    listImportedYbsRouteCodes,
    validateImportedYbs,
    type RouteValidationReport,
} from "./validate-imported-ybs.js";
import {
    buildRouteCodeResolutions,
    listMergedRouteJsonFiles,
    resolveSourceRouteFiles,
} from "./workflow-route-selection.js";

type CliOptions = {
    sourceDir: string;
    runRoot?: string;
    databaseUrl?: string;
};

type ValidateAllReport = {
    generated_at: string;
    source_dir: string;
    run_root: string | null;
    total_source_routes: number;
    routes_validated: number;
    routes_passed: number;
    routes_failed: number;
    routes_not_imported: string[];
    imported_routes_not_in_source: string[];
    route_code_map: Array<{
        source_file_key: string;
        route_code: string;
        is_numbered_ybs: boolean;
        is_named_route: boolean;
    }>;
    validations: RouteValidationReport[];
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

function resolveDatabaseUrl(explicit?: string): string {
    const url =
        explicit ??
        process.env.SUPABASE_DIRECT_DATABASE_URL ??
        process.env.DATABASE_URL ??
        process.env.LOCAL_DATABASE_URL;
    if (!url) {
        throw new Error("No database URL. Set SUPABASE_DIRECT_DATABASE_URL or DATABASE_URL.");
    }
    return url;
}

function parseCliArgs(argv: string[]): CliOptions {
    let sourceDir = "tmp/transport-imports/ybs-all/merged/routes";
    let runRoot: string | undefined;
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
        } else if (arg === "--database-url" && next) {
            databaseUrl = next.trim();
            index++;
        }
    }

    return { sourceDir, runRoot, databaseUrl };
}

function defaultRunRootFromSourceDir(sourceDir: string): string | undefined {
    const absolute = resolveFromRepo(sourceDir);
    if (absolute.endsWith(`${path.sep}merged${path.sep}routes`)) {
        return path.dirname(path.dirname(absolute));
    }
    return undefined;
}

function renderMarkdown(report: ValidateAllReport): string {
    return phaseMarkdown("Validate all imported bus routes", [
        `- Source dir: ${report.source_dir}`,
        `- Run root: ${report.run_root ?? "(not set)"}`,
        `- Source routes: ${report.total_source_routes}`,
        `- Validated: ${report.routes_validated}`,
        `- Passed: ${report.routes_passed}`,
        `- Failed: ${report.routes_failed}`,
        "",
        "## Route code map",
        "",
        markdownTable(
            ["Source file", "Route code", "Numbered YBS", "Named route"],
            report.route_code_map.map((row) => [
                row.source_file_key,
                row.route_code,
                row.is_numbered_ybs ? "yes" : "no",
                row.is_named_route ? "yes" : "no",
            ]),
        ),
        "",
        "## Not imported yet",
        "",
        report.routes_not_imported.length === 0
            ? "- None"
            : report.routes_not_imported.map((routeCode) => `- ${routeCode}`).join("\n"),
        "",
        "## Imported routes not in source dir",
        "",
        report.imported_routes_not_in_source.length === 0
            ? "- None"
            : report.imported_routes_not_in_source.map((routeCode) => `- ${routeCode}`).join("\n"),
        "",
        "## Validation results",
        "",
        markdownTable(
            ["Route", "Status", "Route count", "Blockers", "Warnings", "Public visible"],
            report.validations.map((row) => [
                row.route_code,
                row.status,
                row.route_count,
                row.blockers.length,
                row.warnings.length,
                row.public_visible ? "yes" : "no",
            ]),
        ),
        "",
        "## Stop identity metrics (aggregated)",
        "",
        `- cross_route_shared_stop_count: ${report.validations.reduce((sum, row) => sum + row.cross_route_shared_stop_count, 0)}`,
        `- route_internal_duplicate_stop_id_count: ${report.validations.reduce((sum, row) => sum + row.route_internal_duplicate_stop_id_count, 0)}`,
        `- inbound_outbound_shared_stop_count: ${report.validations.reduce((sum, row) => sum + row.inbound_outbound_shared_stop_count, 0)}`,
        `- uncertain_created_separate_stop_count: ${report.validations.reduce((sum, row) => sum + row.uncertain_created_separate_stop_count, 0)}`,
        `- possible_duplicate_stop_count: ${report.validations.reduce((sum, row) => sum + row.possible_duplicate_stop_count, 0)}`,
        `- under_merge_candidate_count: ${report.validations.reduce((sum, row) => sum + row.under_merge_candidate_count, 0)}`,
        `- over_merge_risk_count: ${report.validations.reduce((sum, row) => sum + row.over_merge_risk_count, 0)}`,
    ]);
}

export async function validateAllImportedBus(options: CliOptions): Promise<ValidateAllReport> {
    const sourceDir = resolveFromRepo(options.sourceDir);
    const runRoot = options.runRoot
        ? resolveFromRepo(options.runRoot)
        : defaultRunRootFromSourceDir(options.sourceDir);

    const sourceFiles = resolveSourceRouteFiles(sourceDir, { allRoutes: true });
    const { resolutions } = buildRouteCodeResolutions(sourceFiles, new Map());
    const routeCodes = resolutions.map((row) => row.route_code);

    const validations = await validateImportedYbs({
        runRoot: runRoot ?? "tmp/transport-imports/ybs-all-routes-import",
        routeCodes,
        databaseUrl: options.databaseUrl,
    });

    const routesNotImported = validations
        .filter((row) => row.route_count === 0)
        .map((row) => row.route_code);

    const databaseUrl = resolveDatabaseUrl(options.databaseUrl);
    const pool = new pg.Pool({ connectionString: databaseUrl, max: 1, statement_timeout: 120_000 });
    const client = await pool.connect();
    let importedNotInSource: string[] = [];
    try {
        const importedRouteCodes = await listImportedYbsRouteCodes(client);
        const sourceRouteCodeSet = new Set(routeCodes);
        importedNotInSource = importedRouteCodes
            .filter((routeCode) => !sourceRouteCodeSet.has(routeCode))
            .sort();
    } finally {
        client.release();
        await pool.end();
    }

    const report: ValidateAllReport = {
        generated_at: new Date().toISOString(),
        source_dir: sourceDir,
        run_root: runRoot ?? null,
        total_source_routes: listMergedRouteJsonFiles(sourceDir).length,
        routes_validated: validations.length,
        routes_passed: validations.filter((row) => row.status === "passed").length,
        routes_failed: validations.filter((row) => row.status === "failed").length,
        routes_not_imported: routesNotImported,
        imported_routes_not_in_source: importedNotInSource,
        route_code_map: resolutions,
        validations,
    };

    const reportsDir = runRoot
        ? path.join(runRoot, "reports")
        : path.join(repoRoot(), "tmp/transport-imports/reports");
    fs.mkdirSync(reportsDir, { recursive: true });

    const jsonPath = path.join(reportsDir, "validate-all-imported-bus.json");
    const mdPath = path.join(reportsDir, "validate-all-imported-bus.md");
    writeJsonFile(jsonPath, report);
    writeTextFile(mdPath, renderMarkdown(report));

    return report;
}

async function main(): Promise<void> {
    loadDatabaseEnv();
    const options = parseCliArgs(process.argv.slice(2));
    const report = await validateAllImportedBus(options);

    console.log(`Validate all imported bus routes complete.`);
    console.log(`Source routes: ${report.total_source_routes}`);
    console.log(`Validated: ${report.routes_validated}`);
    console.log(`Passed: ${report.routes_passed} | Failed: ${report.routes_failed}`);
    console.log(`Not imported yet: ${report.routes_not_imported.length}`);
    if (report.routes_not_imported.length > 0) {
        console.log(`  ${report.routes_not_imported.slice(0, 20).join(", ")}${report.routes_not_imported.length > 20 ? " ..." : ""}`);
    }

    if (report.routes_failed > 0) {
        process.exitCode = 1;
    }
}

const isMainModule =
    process.argv[1] &&
    (process.argv[1].endsWith("validate-all-imported-bus.ts") ||
        process.argv[1].endsWith("validate-all-imported-bus.js"));

if (isMainModule) {
    main().catch((error) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
    });
}
