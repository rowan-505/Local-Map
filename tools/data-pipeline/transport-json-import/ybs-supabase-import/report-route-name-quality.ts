#!/usr/bin/env npx tsx
/**
 * Report route name quality for imported YBS/bus routes (read-only).
 *
 * Usage:
 *   npx tsx tools/data-pipeline/transport-json-import/ybs-supabase-import/report-route-name-quality.ts \
 *     --report-dir tmp/transport-imports/route-name-repair
 */

import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

import dotenv from "dotenv";
import pg from "pg";

import { writeJsonFile, writeTextFile } from "./test-flow-report.js";
import {
    assessRouteNameQuality,
    fetchRouteNameRows,
    fetchRouteNamesForRoute,
    loadMergedRouteJson,
    renderRouteNameQualityMarkdown,
    resolveDatabaseUrl,
    type RouteNameQualityRow,
} from "./route-name-repair-lib.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "../../../../");

type CliOptions = {
    reportDir: string;
    routes?: string[];
    includeTrial: boolean;
    mergedSourceDir: string;
    databaseUrl?: string;
};

function loadEnv(): void {
    for (const envPath of [
        join(REPO_ROOT, "apps/api/.env"),
        join(REPO_ROOT, "infrastructure/.env"),
        join(REPO_ROOT, ".env"),
    ]) {
        if (existsSync(envPath)) {
            dotenv.config({ path: envPath, override: false });
        }
    }
}

function parseCliArgs(argv: string[]): CliOptions {
    let reportDir = "tmp/transport-imports/route-name-repair";
    let routes: string[] | undefined;
    let includeTrial = false;
    let mergedSourceDir = "tmp/transport-imports/ybs-all/merged/routes";
    let databaseUrl: string | undefined;

    for (let index = 0; index < argv.length; index++) {
        const arg = argv[index];
        const next = argv[index + 1];

        if (arg === "--report-dir" && next) {
            reportDir = next.trim();
            index++;
        } else if (arg === "--routes" && next) {
            routes = next
                .split(",")
                .map((value) => value.trim())
                .filter(Boolean);
            index++;
        } else if (arg === "--include-trial") {
            includeTrial = true;
        } else if (arg === "--merged-source-dir" && next) {
            mergedSourceDir = next.trim();
            index++;
        } else if (arg === "--database-url" && next) {
            databaseUrl = next.trim();
            index++;
        }
    }

    return { reportDir, routes, includeTrial, mergedSourceDir, databaseUrl };
}

async function main(): Promise<void> {
    loadEnv();
    const options = parseCliArgs(process.argv.slice(2));
    const reportRoot = join(REPO_ROOT, options.reportDir);
    mkdirSync(reportRoot, { recursive: true });

    const client = new pg.Client({ connectionString: resolveDatabaseUrl(options.databaseUrl) });
    await client.connect();

    try {
        const routes = await fetchRouteNameRows(client, {
            routeCodes: options.routes,
            includeTrial: options.includeTrial,
        });

        const rows: RouteNameQualityRow[] = [];
        for (const route of routes) {
            const routeNames = await fetchRouteNamesForRoute(client, route.id);
            const mergedSource = loadMergedRouteJson(REPO_ROOT, route.route_code, options.mergedSourceDir);
            rows.push(
                assessRouteNameQuality({
                    route,
                    routeNames,
                    mergedSource,
                    allowReviewed: false,
                    repairOnlyHighConfidence: true,
                }),
            );
        }

        const report = {
            generated_at: new Date().toISOString(),
            total_routes: rows.length,
            routes_with_issues: rows.filter((row) => row.issue_codes.length > 0).length,
            routes_safe_to_repair: rows.filter((row) => row.safe_to_execute).length,
            rows,
        };

        const jsonPath = join(reportRoot, "route-name-quality-report.json");
        const mdPath = join(reportRoot, "route-name-quality-report.md");
        writeJsonFile(jsonPath, report);
        writeTextFile(mdPath, renderRouteNameQualityMarkdown(report));

        console.log(`Wrote ${jsonPath}`);
        console.log(`Wrote ${mdPath}`);
        console.log(
            `Scanned ${report.total_routes} routes; ${report.routes_with_issues} with issues; ${report.routes_safe_to_repair} safe to repair.`,
        );
    } finally {
        await client.end();
    }
}

main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
});
