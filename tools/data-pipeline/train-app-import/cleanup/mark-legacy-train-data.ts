#!/usr/bin/env npx tsx
/**
 * Stage 12a: mark legacy train routes/variants/paths before or after new import.
 *
 * Marks old train network rows as legacy. Does not delete anything.
 * Does not touch stops, terminals, or non-train modes.
 *
 * Default: dry-run. Pass --execute to write.
 *
 * Usage:
 *   npx tsx tools/data-pipeline/train-app-import/cleanup/mark-legacy-train-data.ts
 *   npx tsx tools/data-pipeline/train-app-import/cleanup/mark-legacy-train-data.ts --execute
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import pg from "pg";

import { loadDatabaseEnv, resolveDatabaseUrl } from "../lib/db.js";
import {
    buildLegacyMarkPatch,
    LEGACY_TRAIN_PATH_SQL,
    LEGACY_TRAIN_ROUTE_SQL,
    LEGACY_TRAIN_VARIANT_SQL,
    runMarkLegacyTrainDataSelfTest,
    summarizeLegacyMarkPlan,
    UPDATE_LEGACY_TRAIN_PATH_SQL,
    UPDATE_LEGACY_TRAIN_ROUTE_SQL,
    UPDATE_LEGACY_TRAIN_VARIANT_SQL,
    type LegacyTrainEntityRow,
    type LegacyTrainMarkPlan,
    type LegacyTrainMarkResult,
} from "../lib/mark-legacy-train-data.js";
import {
    defaultRunPaths,
    ensureRunLayout,
    reportPath,
    type TrainRunPaths,
} from "../lib/paths.js";
import {
    TRAIN_IMPORT_GENERATION,
    TRAIN_LEGACY_REVIEW_STATUS,
    TRAIN_MODE,
} from "../lib/train-import-constants.js";

const REPORT_FILENAME = "mark-legacy-train-data.json";

export type MarkLegacyTrainDataOptions = {
    runRoot?: string;
    databaseUrl?: string;
    execute?: boolean;
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

async function loadLegacyPlan(client: pg.PoolClient): Promise<LegacyTrainMarkPlan> {
    const routes = await client.query<DbEntityRow>(LEGACY_TRAIN_ROUTE_SQL, [
        TRAIN_MODE,
        TRAIN_IMPORT_GENERATION,
    ]);
    const routeIds = routes.rows.map((row) => Number(row.id));

    if (routeIds.length === 0) {
        return { routes: [], variants: [], paths: [] };
    }

    const variants = await client.query<DbEntityRow>(LEGACY_TRAIN_VARIANT_SQL, [routeIds]);
    const variantIds = variants.rows.map((row) => Number(row.id));

    const paths =
        variantIds.length === 0
            ? { rows: [] as DbEntityRow[] }
            : await client.query<DbEntityRow>(LEGACY_TRAIN_PATH_SQL, [variantIds]);

    return {
        routes: mapRows(routes.rows),
        variants: mapRows(variants.rows),
        paths: mapRows(paths.rows),
    };
}

async function applyLegacyMarks(
    client: pg.PoolClient,
    plan: LegacyTrainMarkPlan,
): Promise<void> {
    const patch = buildLegacyMarkPatch("imported_unreviewed");
    const sourceRefsPatch = JSON.stringify(patch.source_refs_patch);
    const normalizedPatch = JSON.stringify(patch.normalized_data_patch);

    if (plan.routes.length > 0) {
        await client.query(UPDATE_LEGACY_TRAIN_ROUTE_SQL, [
            plan.routes.map((row) => row.id),
            TRAIN_LEGACY_REVIEW_STATUS,
            sourceRefsPatch,
            normalizedPatch,
        ]);
    }

    if (plan.variants.length > 0) {
        await client.query(UPDATE_LEGACY_TRAIN_VARIANT_SQL, [
            plan.variants.map((row) => row.id),
            TRAIN_LEGACY_REVIEW_STATUS,
            sourceRefsPatch,
            normalizedPatch,
        ]);
    }

    if (plan.paths.length > 0) {
        await client.query(UPDATE_LEGACY_TRAIN_PATH_SQL, [
            plan.paths.map((row) => row.id),
            TRAIN_LEGACY_REVIEW_STATUS,
            sourceRefsPatch,
            normalizedPatch,
        ]);
    }
}

function writeReport(paths: TrainRunPaths, result: LegacyTrainMarkResult): string {
    const outputPath = reportPath(paths, REPORT_FILENAME);
    const payload = {
        generated_at: new Date().toISOString(),
        dry_run: result.dry_run,
        committed: result.committed,
        routes_affected: result.routes_affected,
        variants_affected: result.variants_affected,
        paths_affected: result.paths_affected,
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

/** Mark legacy train routes, variants, and paths (dry-run unless execute=true). */
export async function markLegacyTrainData(
    options: MarkLegacyTrainDataOptions = {},
): Promise<LegacyTrainMarkResult> {
    const paths = defaultRunPaths(options.runRoot);
    ensureRunLayout(paths);

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
        const plan = await loadLegacyPlan(client);

        if (options.execute) {
            await applyLegacyMarks(client, plan);
            await client.query("COMMIT");
        } else {
            await client.query("ROLLBACK");
        }

        const counts = summarizeLegacyMarkPlan(plan);
        const result: LegacyTrainMarkResult = {
            dry_run: !options.execute,
            committed: Boolean(options.execute),
            routes_affected: counts.routes_affected,
            variants_affected: counts.variants_affected,
            paths_affected: counts.paths_affected,
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

function parseCliArgs(argv: string[]): MarkLegacyTrainDataOptions {
    const options: MarkLegacyTrainDataOptions = {};

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
        }
    }

    return options;
}

function printSummary(result: LegacyTrainMarkResult, reportFile: string): void {
    if (result.dry_run) {
        console.log("Dry run: legacy train data marking");
    } else {
        console.log("Executed: legacy train data marking");
    }
    console.log(`Routes affected: ${result.routes_affected}`);
    console.log(`Variants affected: ${result.variants_affected}`);
    console.log(`Paths affected: ${result.paths_affected}`);
    console.log(`Report: ${reportFile}`);
}

async function main(): Promise<void> {
    const result = await markLegacyTrainData(parseCliArgs(process.argv.slice(2)));
    const reportFile = reportPath(defaultRunPaths(), REPORT_FILENAME);
    printSummary(result, reportFile);
}

const isCliEntry = process.argv[1]?.includes("mark-legacy-train-data.ts");
const isSelfTestEntry =
    process.argv[1]?.includes("mark-legacy-train-data.ts") && process.argv.includes("--self-test");

if (isSelfTestEntry) {
    runMarkLegacyTrainDataSelfTest();
} else if (isCliEntry) {
    main().catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error(message);
        process.exit(1);
    });
}
