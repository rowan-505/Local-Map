/**
 * Database helpers for GTFS export scripts (pg + DATABASE_URL).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";
import pg from "pg";

import type {
    CoreTransportTableStatus,
    DatabaseHealth,
    ExportBuildSummary,
    GtfsReadinessSummary,
} from "./gtfs-types.js";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..", "..", "..");

const DOTENV_PATH = path.join(REPO_ROOT, ".env");

const CORE_TRANSPORT_TABLES = [
    "operators",
    "routes",
    "route_names",
    "route_variants",
    "stops",
    "stop_names",
    "route_stops",
    "route_paths",
    "service_calendars",
    "frequencies",
] as const;

let envLoaded = false;

export function loadRepoEnv(): void {
    if (envLoaded) {
        return;
    }
    if (fs.existsSync(DOTENV_PATH)) {
        dotenv.config({ path: DOTENV_PATH });
    } else {
        dotenv.config();
    }
    envLoaded = true;
}

export function requireDatabaseUrl(): string {
    const url = process.env.DATABASE_URL?.trim();
    if (!url) {
        throw new Error(
            "Missing DATABASE_URL. Set it in the repo root .env (see .env.example).",
        );
    }
    return url;
}

export function createPool(connectionString?: string): pg.Pool {
    loadRepoEnv();
    return new pg.Pool({
        connectionString: connectionString ?? requireDatabaseUrl(),
        max: 4,
    });
}

export async function closePool(pool: pg.Pool): Promise<void> {
    await pool.end();
}

export async function verifyDatabaseConnection(pool: pg.Pool): Promise<DatabaseHealth> {
    const result = await pool.query<{
        database: string;
        server_time: Date;
        core_transport: boolean;
        gtfs_export: boolean;
    }>(`
        select
            current_database() as database,
            now() as server_time,
            exists (
                select 1 from information_schema.schemata
                where schema_name = 'core_transport'
            ) as core_transport,
            exists (
                select 1 from information_schema.schemata
                where schema_name = 'gtfs_export'
            ) as gtfs_export
    `);

    const row = result.rows[0];
    if (!row) {
        throw new Error("Database health query returned no rows.");
    }

    return {
        database: row.database,
        serverTime: row.server_time.toISOString(),
        coreTransportSchema: row.core_transport,
        gtfsExportSchema: row.gtfs_export,
    };
}

export async function checkCoreTransportTables(
    pool: pg.Pool,
): Promise<CoreTransportTableStatus[]> {
    const result = await pool.query<{ table_name: string; exists: boolean }>(
        `
        select
            t.table_name,
            (i.table_name is not null) as exists
        from unnest($1::text[]) as t (table_name)
        left join information_schema.tables as i
            on i.table_schema = 'core_transport'
           and i.table_name = t.table_name
        order by t.table_name
        `,
        [CORE_TRANSPORT_TABLES],
    );

    return result.rows.map((row) => ({
        tableName: row.table_name,
        exists: row.exists,
    }));
}

export function assertCoreTransportTablesReady(tables: CoreTransportTableStatus[]): void {
    const missing = tables.filter((t) => !t.exists).map((t) => t.tableName);
    if (missing.length > 0) {
        throw new Error(
            `Missing core_transport tables: ${missing.join(", ")}. Apply migration 067 first.`,
        );
    }
}

export async function fetchGtfsReadinessSummary(
    pool: pg.Pool,
): Promise<GtfsReadinessSummary | null> {
    const reg = await pool.query<{ reg: string }>(
        `select to_regclass('core_transport.v_gtfs_readiness_summary')::text as reg`,
    );
    if (!reg.rows[0]?.reg) {
        return null;
    }

    const result = await pool.query<{
        active_routes: string;
        active_variants: string;
        active_stops: string;
        variants_too_few_stops: string;
        duplicate_sequences: string;
        stops_without_names: string;
        variants_without_frequency: string;
        variants_without_path: string;
    }>(`
        select
            active_routes,
            active_variants,
            active_stops,
            variants_too_few_stops,
            duplicate_sequences,
            stops_without_names,
            variants_without_frequency,
            variants_without_path
        from core_transport.v_gtfs_readiness_summary
    `);

    const row = result.rows[0];
    if (!row) {
        return null;
    }

    return {
        activeRoutes: Number(row.active_routes),
        activeVariants: Number(row.active_variants),
        activeStops: Number(row.active_stops),
        variantsTooFewStops: Number(row.variants_too_few_stops),
        duplicateSequences: Number(row.duplicate_sequences),
        stopsWithoutNames: Number(row.stops_without_names),
        variantsWithoutFrequency: Number(row.variants_without_frequency),
        variantsWithoutPath: Number(row.variants_without_path),
    };
}

export async function findExportBuildByCode(
    pool: pg.Pool,
    buildCode: string,
): Promise<ExportBuildSummary | null> {
    const result = await pool.query<{
        id: string;
        build_code: string;
        scope: string;
        status: string;
    }>(
        `
        select id, build_code, scope, status
        from gtfs_export.export_builds
        where build_code = $1
        limit 1
        `,
        [buildCode],
    );

    const row = result.rows[0];
    if (!row) {
        return null;
    }

    return {
        id: Number(row.id),
        buildCode: row.build_code,
        scope: row.scope,
        status: row.status,
    };
}

/**
 * Inserts a draft export_builds row (skeleton only). Caller must pass createBuild=true from CLI.
 */
export async function insertDraftExportBuild(
    pool: pg.Pool,
    input: {
        buildCode: string;
        scope: string;
        outputPath: string;
        notes: string;
    },
): Promise<ExportBuildSummary> {
    const result = await pool.query<{
        id: string;
        build_code: string;
        scope: string;
        status: string;
    }>(
        `
        insert into gtfs_export.export_builds (
            build_code,
            scope,
            status,
            output_path,
            notes,
            started_at
        )
        values ($1, $2, 'draft', $3, $4, now())
        on conflict (build_code) do nothing
        returning id, build_code, scope, status
        `,
        [input.buildCode, input.scope, input.outputPath, input.notes],
    );

    if (result.rows[0]) {
        const row = result.rows[0];
        return {
            id: Number(row.id),
            buildCode: row.build_code,
            scope: row.scope,
            status: row.status,
        };
    }

    const existing = await findExportBuildByCode(pool, input.buildCode);
    if (!existing) {
        throw new Error(`Failed to create or find export_builds row for build_code=${input.buildCode}`);
    }
    return existing;
}

export function parseCliFlag(argv: string[], name: string): string | undefined {
    const prefix = `--${name}=`;
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === `--${name}`) {
            return argv[i + 1];
        }
        if (arg.startsWith(prefix)) {
            return arg.slice(prefix.length);
        }
    }
    return undefined;
}

export function parseCliBoolFlag(argv: string[], name: string): boolean {
    const prefix = `--${name}=`;
    for (const arg of argv) {
        if (arg === `--${name}`) {
            return true;
        }
        if (arg.startsWith(prefix)) {
            const raw = arg.slice(prefix.length).trim().toLowerCase();
            return raw === "1" || raw === "true" || raw === "yes";
        }
    }
    return false;
}

export function requireCliValue(value: string | undefined, flagName: string): string {
    const trimmed = value?.trim();
    if (!trimmed) {
        throw new Error(`Missing required flag: --${flagName}`);
    }
    return trimmed;
}
