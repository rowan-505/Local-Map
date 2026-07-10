#!/usr/bin/env npx tsx
/**
 * Bulk-import all import-ready train route variants.
 *
 * Default: dry-run. Pass --execute to commit each route.
 *
 * Usage:
 *   npx tsx tools/data-pipeline/train-app-import/db/import-all-train-routes.ts
 *   npx tsx tools/data-pipeline/train-app-import/db/import-all-train-routes.ts --execute
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { importTrainRoute } from "./import-train-route.js";
import {
    defaultRunPaths,
    importReadyDir,
    reportPath,
    type TrainRunPaths,
} from "../lib/paths.js";

export type ImportAllTrainRoutesOptions = {
    runRoot?: string;
    databaseUrl?: string;
    execute?: boolean;
    limit?: number;
};

type RouteImportSummary = {
    variant_code: string;
    ok: boolean;
    dry_run: boolean;
    route_id: number | null;
    variant_id: number | null;
    route_stops_inserted: number;
    errors: string[];
    warnings: string[];
};

function listImportReadyVariantCodes(paths: TrainRunPaths): string[] {
    const dir = importReadyDir(paths);
    if (!fs.existsSync(dir)) {
        return [];
    }
    return fs
        .readdirSync(dir)
        .filter((name) => name.endsWith(".json"))
        .map((name) => name.replace(/\.json$/, ""))
        .sort();
}

export async function importAllTrainRoutes(
    options: ImportAllTrainRoutesOptions = {},
): Promise<{
    total: number;
    succeeded: number;
    failed: number;
    dry_run: boolean;
    report_path: string;
    results: RouteImportSummary[];
}> {
    const paths = defaultRunPaths(options.runRoot);
    let codes = listImportReadyVariantCodes(paths);
    if (options.limit && options.limit > 0) {
        codes = codes.slice(0, options.limit);
    }

    if (codes.length === 0) {
        throw new Error(`No import-ready routes in ${importReadyDir(paths)}`);
    }

    const results: RouteImportSummary[] = [];

    for (const variantCode of codes) {
        try {
            const result = await importTrainRoute({
                variantCode,
                runRoot: options.runRoot,
                databaseUrl: options.databaseUrl,
                execute: options.execute,
            });

            results.push({
                variant_code: variantCode,
                ok: result.errors.length === 0,
                dry_run: result.dry_run,
                route_id: result.route_id,
                variant_id: result.variant_id,
                route_stops_inserted: result.route_stops_inserted,
                errors: result.errors,
                warnings: result.warnings,
            });

            const status = result.errors.length === 0 ? "ok" : "FAIL";
            console.log(
                `[${status}] ${variantCode} stops=${result.route_stops_inserted}` +
                    (result.errors.length ? ` errors=${result.errors.join("; ")}` : ""),
            );
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            results.push({
                variant_code: variantCode,
                ok: false,
                dry_run: !options.execute,
                route_id: null,
                variant_id: null,
                route_stops_inserted: 0,
                errors: [message],
                warnings: [],
            });
            console.log(`[FAIL] ${variantCode} errors=${message}`);
        }
    }

    const succeeded = results.filter((row) => row.ok).length;
    const failed = results.length - succeeded;
    const report = {
        schema_version: 1,
        generated_at: new Date().toISOString(),
        dry_run: !options.execute,
        total: results.length,
        succeeded,
        failed,
        results,
    };

    const reportFile = reportPath(paths, "import-all-train-routes.json");
    fs.mkdirSync(path.dirname(reportFile), { recursive: true });
    fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");

    return {
        total: results.length,
        succeeded,
        failed,
        dry_run: !options.execute,
        report_path: reportFile,
        results,
    };
}

function parseCliArgs(argv: string[]): ImportAllTrainRoutesOptions {
    const options: ImportAllTrainRoutesOptions = {};
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        const next = argv[i + 1];
        if ((arg === "--run" || arg === "--run-root") && next) {
            options.runRoot = next.trim();
            i++;
        } else if (arg === "--database-url" && next) {
            options.databaseUrl = next.trim();
            i++;
        } else if (arg === "--limit" && next) {
            options.limit = Number(next);
            i++;
        } else if (arg === "--execute") {
            options.execute = true;
        }
    }
    return options;
}

async function main(): Promise<void> {
    const result = await importAllTrainRoutes(parseCliArgs(process.argv.slice(2)));
    console.log("---");
    console.log(result.dry_run ? "Dry run complete" : "Execute complete");
    console.log(`Total: ${result.total}`);
    console.log(`Succeeded: ${result.succeeded}`);
    console.log(`Failed: ${result.failed}`);
    console.log(`Report: ${result.report_path}`);
    if (result.failed > 0) {
        process.exitCode = 1;
    }
}

const isCliEntry = process.argv[1]?.includes("import-all-train-routes.ts");
if (isCliEntry) {
    main().catch((error: unknown) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
    });
}
