#!/usr/bin/env npx tsx
/**
 * Stage 12b: soft-delete marked legacy train routes/variants/paths after v1 import is stable.
 *
 * Does not delete train stops or terminals. No hard deletes.
 *
 * Default: dry-run.
 * DB writes require --execute and --confirm-legacy-train-cleanup.
 *
 * Usage:
 *   npx tsx tools/data-pipeline/train-app-import/cleanup/cleanup-legacy-train-routes.ts
 *   npx tsx tools/data-pipeline/train-app-import/cleanup/cleanup-legacy-train-routes.ts --execute --confirm-legacy-train-cleanup
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import pg from "pg";

import {
    LEGACY_CLEANUP_TRAIN_PATH_SQL,
    LEGACY_CLEANUP_TRAIN_ROUTE_SQL,
    LEGACY_CLEANUP_TRAIN_VARIANT_SQL,
    NEW_TRAIN_ROUTE_EXISTS_SQL,
    runCleanupLegacyTrainRoutesSelfTest,
    SOFT_DELETE_LEGACY_TRAIN_PATH_SQL,
    SOFT_DELETE_LEGACY_TRAIN_ROUTE_SQL,
    SOFT_DELETE_LEGACY_TRAIN_VARIANT_SQL,
    summarizeLegacyCleanupPlan,
    type LegacyTrainCleanupPlan,
    type LegacyTrainCleanupResult,
} from "../lib/cleanup-legacy-train-routes.js";
import type { LegacyTrainEntityRow } from "../lib/mark-legacy-train-data.js";
import { loadDatabaseEnv, resolveDatabaseUrl } from "../lib/db.js";
import {
    defaultRunPaths,
    ensureRunLayout,
    reportPath,
    type TrainRunPaths,
} from "../lib/paths.js";
import {
    TRAIN_IMPORT_GENERATION,
    TRAIN_LEGACY_GENERATION,
    TRAIN_MODE,
} from "../lib/train-import-constants.js";

const REPORT_FILENAME = "cleanup-legacy-train-routes.json";

export type CleanupLegacyTrainRoutesOptions = {
    runRoot?: string;
    databaseUrl?: string;
    execute?: boolean;
    confirmLegacyTrainCleanup?: boolean;
};

type DbEntityRow = {
    id: string;
    code: string;
    review_status: string;
    is_active: boolean;
    generation: string | null;
};

function mapRows(rows: DbEntityRow[]): LegacyTrainEntityRow[] {
    return rows.map((row) => ({
        id: Number(row.id),
        code: row.code,
        review_status: row.review_status,
        is_active: row.is_active,
        generation: row.generation,
    }));
}

async function newTrainRouteExists(client: pg.PoolClient): Promise<boolean> {
    const result = await client.query<{ exists: boolean }>(NEW_TRAIN_ROUTE_EXISTS_SQL, [
        TRAIN_MODE,
        TRAIN_IMPORT_GENERATION,
    ]);
    return Boolean(result.rows[0]?.exists);
}

async function loadCleanupPlan(client: pg.PoolClient): Promise<LegacyTrainCleanupPlan> {
    const routes = await client.query<DbEntityRow>(LEGACY_CLEANUP_TRAIN_ROUTE_SQL, [
        TRAIN_MODE,
        TRAIN_LEGACY_GENERATION,
    ]);
    const variants = await client.query<DbEntityRow>(LEGACY_CLEANUP_TRAIN_VARIANT_SQL, [
        TRAIN_MODE,
        TRAIN_LEGACY_GENERATION,
    ]);
    const paths = await client.query<DbEntityRow>(LEGACY_CLEANUP_TRAIN_PATH_SQL, [
        TRAIN_MODE,
        TRAIN_LEGACY_GENERATION,
    ]);

    return {
        routes: mapRows(routes.rows),
        variants: mapRows(variants.rows),
        paths: mapRows(paths.rows),
    };
}

async function applySoftDeletes(
    client: pg.PoolClient,
    plan: LegacyTrainCleanupPlan,
): Promise<void> {
    if (plan.paths.length > 0) {
        await client.query(SOFT_DELETE_LEGACY_TRAIN_PATH_SQL, [
            plan.paths.map((row) => row.id),
        ]);
    }

    if (plan.variants.length > 0) {
        await client.query(SOFT_DELETE_LEGACY_TRAIN_VARIANT_SQL, [
            plan.variants.map((row) => row.id),
        ]);
    }

    if (plan.routes.length > 0) {
        await client.query(SOFT_DELETE_LEGACY_TRAIN_ROUTE_SQL, [
            plan.routes.map((row) => row.id),
        ]);
    }
}

function writeReport(paths: TrainRunPaths, result: LegacyTrainCleanupResult): string {
    const outputPath = reportPath(paths, REPORT_FILENAME);
    const payload = {
        generated_at: new Date().toISOString(),
        dry_run: result.dry_run,
        committed: result.committed,
        refused: result.refused,
        refusal_reason: result.refusal_reason,
        new_train_route_exists: result.new_train_route_exists,
        routes_affected: result.routes_affected,
        variants_affected: result.variants_affected,
        paths_affected: result.paths_affected,
        route_codes: result.route_codes,
        routes: result.plan.routes.map((row) => ({
            id: row.id,
            route_code: row.code,
            review_status: row.review_status,
            generation: row.generation,
        })),
        variants: result.plan.variants.map((row) => ({
            id: row.id,
            variant_code: row.code,
            review_status: row.review_status,
            generation: row.generation,
        })),
        paths: result.plan.paths.map((row) => ({
            id: row.id,
            code: row.code,
            review_status: row.review_status,
            generation: row.generation,
        })),
    };

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    return outputPath;
}

function printRouteCodes(routeCodes: string[]): void {
    console.log("Affected route codes:");
    if (routeCodes.length === 0) {
        console.log("  (none)");
        return;
    }
    for (const code of routeCodes) {
        console.log(`  - ${code}`);
    }
}

function printSummary(result: LegacyTrainCleanupResult, reportFile: string): void {
    if (result.refused) {
        console.log(`Refused: ${result.refusal_reason ?? "unknown reason"}`);
    } else if (result.dry_run) {
        console.log("Dry run: legacy train route cleanup");
    } else {
        console.log("Executed: legacy train route cleanup");
    }

    console.log(`New train route exists: ${result.new_train_route_exists ? "yes" : "no"}`);
    console.log(`Routes affected: ${result.routes_affected}`);
    console.log(`Variants affected: ${result.variants_affected}`);
    console.log(`Paths affected: ${result.paths_affected}`);
    console.log(`Report: ${reportFile}`);
}

/** Soft-delete marked legacy train routes, variants, and paths. */
export async function cleanupLegacyTrainRoutes(
    options: CleanupLegacyTrainRoutesOptions = {},
): Promise<LegacyTrainCleanupResult> {
    const paths = defaultRunPaths(options.runRoot);
    ensureRunLayout(paths);

    loadDatabaseEnv();
    const databaseUrl = resolveDatabaseUrl(options.databaseUrl);
    if (!databaseUrl) {
        throw new Error(
            "No database URL. Set SUPABASE_DIRECT_DATABASE_URL, DATABASE_URL, or LOCAL_DATABASE_URL.",
        );
    }

    const execute = Boolean(options.execute);
    const confirmLegacyTrainCleanup = Boolean(options.confirmLegacyTrainCleanup);

    if (execute && !confirmLegacyTrainCleanup) {
        const result: LegacyTrainCleanupResult = {
            dry_run: false,
            committed: false,
            refused: true,
            refusal_reason:
                "Execute refused. Pass --confirm-legacy-train-cleanup after reviewing the dry-run report.",
            new_train_route_exists: false,
            routes_affected: 0,
            variants_affected: 0,
            paths_affected: 0,
            route_codes: [],
            plan: { routes: [], variants: [], paths: [] },
        };
        writeReport(paths, result);
        return result;
    }

    const pool = new pg.Pool({
        connectionString: databaseUrl,
        max: 1,
        statement_timeout: 120_000,
    });

    const client = await pool.connect();
    try {
        const hasNewTrainRoute = await newTrainRouteExists(client);
        if (!hasNewTrainRoute) {
            throw new Error(
                `Abort: no active train route with generation=${TRAIN_IMPORT_GENERATION}. Import new train routes before cleanup.`,
            );
        }

        await client.query("BEGIN");
        const plan = await loadCleanupPlan(client);
        const counts = summarizeLegacyCleanupPlan(plan);

        printRouteCodes(counts.route_codes);

        if (execute) {
            await applySoftDeletes(client, plan);
            await client.query("COMMIT");
        } else {
            await client.query("ROLLBACK");
        }

        const result: LegacyTrainCleanupResult = {
            dry_run: !execute,
            committed: execute,
            refused: false,
            refusal_reason: null,
            new_train_route_exists: hasNewTrainRoute,
            routes_affected: counts.routes_affected,
            variants_affected: counts.variants_affected,
            paths_affected: counts.paths_affected,
            route_codes: counts.route_codes,
            plan,
        };

        writeReport(paths, result);
        return result;
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

function parseCliArgs(argv: string[]): CleanupLegacyTrainRoutesOptions {
    const options: CleanupLegacyTrainRoutesOptions = {};

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        const next = argv[i + 1];

        if ((arg === "--run" || arg === "--run-root") && next) {
            options.runRoot = next.trim();
            i++;
        } else if (arg === "--database-url" && next) {
            options.databaseUrl = next.trim();
            i++;
        } else if (arg === "--execute") {
            options.execute = true;
        } else if (arg === "--confirm-legacy-train-cleanup") {
            options.confirmLegacyTrainCleanup = true;
        }
    }

    return options;
}

async function main(): Promise<void> {
    const result = await cleanupLegacyTrainRoutes(parseCliArgs(process.argv.slice(2)));
    const reportFile = reportPath(defaultRunPaths(), REPORT_FILENAME);
    printSummary(result, reportFile);

    if (result.refused) {
        process.exit(1);
    }
}

const isCliEntry = process.argv[1]?.includes("cleanup-legacy-train-routes.ts");
const isSelfTestEntry =
    process.argv[1]?.includes("cleanup-legacy-train-routes.ts") &&
    process.argv.includes("--self-test");

if (isSelfTestEntry) {
    runCleanupLegacyTrainRoutesSelfTest();
} else if (isCliEntry) {
    main().catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error(message);
        process.exit(1);
    });
}
