#!/usr/bin/env npx tsx
/**
 * Stage 9: import one fully matched train route variant into transport.* tables.
 *
 * Input:  tmp/train-import/import-ready/{variant_code}.json
 * Default: dry-run. Pass --execute to commit.
 *
 * Usage:
 *   npx tsx tools/data-pipeline/train-app-import/db/import-train-route.ts --route TRAIN-141-UP
 *   npx tsx tools/data-pipeline/train-app-import/db/import-train-route.ts --route TRAIN-141-UP --execute
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import pg from "pg";

import { loadDatabaseEnv, resolveDatabaseUrl } from "../lib/db.js";
import {
    defaultRunPaths,
    importReadyRoutePathByVariantCode,
    type TrainRunPaths,
} from "../lib/paths.js";
import {
    executeTrainRouteImport,
    runTrainImportExecutorSelfTest,
    type ImportTrainRouteResult,
} from "../lib/train-import-executor.js";
import type { ImportReadyTrainRoute } from "../lib/types.js";

export type ImportTrainRouteOptions = {
    variantCode: string;
    runRoot?: string;
    databaseUrl?: string;
    execute?: boolean;
};

function loadImportReadyRoute(paths: TrainRunPaths, variantCode: string): ImportReadyTrainRoute {
    const filePath = importReadyRoutePathByVariantCode(paths, variantCode);
    if (!fs.existsSync(filePath)) {
        throw new Error(`Import-ready file not found: ${filePath}`);
    }
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as ImportReadyTrainRoute;
}

function printSummary(result: ImportTrainRouteResult): void {
    if (result.dry_run) {
        console.log(`Dry run: ${result.variant_code}`);
    } else {
        console.log(`Imported: ${result.variant_code}`);
    }

    if (result.errors.length > 0) {
        console.log(`Errors: ${result.errors.join("; ")}`);
        return;
    }

    console.log(`Route id: ${result.route_id ?? "(dry-run)"}`);
    console.log(`Variant id: ${result.variant_id ?? "(dry-run)"}`);
    console.log(`Route stop count inserted: ${result.route_stops_inserted}`);
    if (result.dry_run) {
        console.log(`Route stops would delete: ${result.route_stops_deleted}`);
        console.log(`Route action: ${result.plan.route_action}`);
        console.log(`Variant action: ${result.plan.variant_action}`);
    } else {
        console.log(`Route stops deleted: ${result.route_stops_deleted}`);
    }

    if (result.warnings.length > 0) {
        console.log(`Warnings: ${result.warnings.join("; ")}`);
    } else {
        console.log("Warnings: none");
    }
}

/** Import one train route variant (dry-run unless execute=true). */
export async function importTrainRoute(
    options: ImportTrainRouteOptions,
): Promise<ImportTrainRouteResult> {
    const paths = defaultRunPaths(options.runRoot);
    const route = loadImportReadyRoute(paths, options.variantCode);

    loadDatabaseEnv();
    const databaseUrl = resolveDatabaseUrl(options.databaseUrl);
    if (!databaseUrl) {
        throw new Error(
            "No database URL. Set SUPABASE_DIRECT_DATABASE_URL, DATABASE_URL, or LOCAL_DATABASE_URL.",
        );
    }

    const pool = new pg.Pool({
        connectionString: databaseUrl,
        max: 1,
        statement_timeout: 120_000,
    });

    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const result = await executeTrainRouteImport(client, route, {
            dryRun: !options.execute,
        });

        if (result.errors.length > 0) {
            await client.query("ROLLBACK");
            return result;
        }

        if (options.execute) {
            await client.query("COMMIT");
        } else {
            await client.query("ROLLBACK");
        }

        return result;
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

function parseCliArgs(argv: string[]): ImportTrainRouteOptions {
    const options: ImportTrainRouteOptions = {
        variantCode: "",
    };

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        const next = argv[i + 1];

        if (arg === "--route" && next) {
            options.variantCode = next.trim();
            i++;
        } else if ((arg === "--run" || arg === "--run-root") && next) {
            options.runRoot = next.trim();
            i++;
        } else if (arg === "--database-url" && next) {
            options.databaseUrl = next.trim();
            i++;
        } else if (arg === "--execute") {
            options.execute = true;
        }
    }

    if (!options.variantCode) {
        throw new Error('Missing --route TRAIN-<number>-<UP|DOWN>.');
    }

    return options;
}

async function main(): Promise<void> {
    const result = await importTrainRoute(parseCliArgs(process.argv.slice(2)));
    printSummary(result);
    if (result.errors.length > 0) {
        process.exitCode = 1;
    }
}

const isCliEntry = process.argv[1]?.includes("import-train-route.ts");
const isSelfTestEntry =
    process.argv[1]?.includes("import-train-route.ts") && process.argv.includes("--self-test");

if (isSelfTestEntry) {
    runTrainImportExecutorSelfTest();
} else if (isCliEntry) {
    main().catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error(message);
        process.exit(1);
    });
}
