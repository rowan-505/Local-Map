/**
 * Database helpers for transport import scripts (pg + DATABASE_URL).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";
import pg from "pg";

import type { DatabaseHealth, ImportBatchSummary } from "./transport-import-types.js";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..", "..", "..");

const DOTENV_PATH = path.join(REPO_ROOT, ".env");

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

export async function verifyDatabaseConnection(pool: pg.Pool): Promise<DatabaseHealth> {
    const result = await pool.query<{
        database: string;
        server_time: Date;
        import_transport: boolean;
        core_transport: boolean;
        gtfs_export: boolean;
    }>(`
        select
            current_database() as database,
            now() as server_time,
            exists (
                select 1
                from information_schema.schemata
                where schema_name = 'import_transport'
            ) as import_transport,
            exists (
                select 1
                from information_schema.schemata
                where schema_name = 'core_transport'
            ) as core_transport,
            exists (
                select 1
                from information_schema.schemata
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
        importTransportSchema: row.import_transport,
        coreTransportSchema: row.core_transport,
        gtfsExportSchema: row.gtfs_export,
    };
}

/**
 * Resolves import batch by batch_name (CLI --batch-code maps here for now).
 */
export async function findImportBatchByCode(
    pool: pg.Pool,
    batchCode: string,
): Promise<ImportBatchSummary | null> {
    const result = await pool.query<{
        id: string;
        batch_name: string;
        import_status: string;
        validation_status: string;
    }>(
        `
        select id, batch_name, import_status, validation_status
        from import_transport.import_batches
        where batch_name = $1
        order by id desc
        limit 1
        `,
        [batchCode],
    );

    const row = result.rows[0];
    if (!row) {
        return null;
    }

    return {
        id: Number(row.id),
        batchName: row.batch_name,
        importStatus: row.import_status,
        validationStatus: row.validation_status,
    };
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

export function parseCliBoolFlag(argv: string[], name: string, defaultValue: boolean): boolean {
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
    return defaultValue;
}

export function requireCliValue(value: string | undefined, flagName: string): string {
    const trimmed = value?.trim();
    if (!trimmed) {
        throw new Error(`Missing required flag: --${flagName}`);
    }
    return trimmed;
}

export async function closePool(pool: pg.Pool): Promise<void> {
    await pool.end();
}
