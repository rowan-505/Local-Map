/**
 * Read-only PostgreSQL helpers for train station matching.
 *
 * DB writes belong only in db/import-train-route.ts and cleanup scripts.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import dotenv from "dotenv";
import pg from "pg";

import {
    resolveDbTarget,
    type DbTarget,
    type DbTargetRole,
} from "../../lib/database-target-safety.js";

export type TrainStopPoolRow = {
    stop_id: number;
    public_id: string;
    stop_code: string | null;
    name: string;
    name_mm: string | null;
    name_en: string | null;
    stop_type: string | null;
    has_geom: boolean;
};

export type PipelineDbTarget = DbTarget;

function repoRoot(): string {
    return process.cwd();
}

function env(name: string): string | undefined {
    const v = process.env[name]?.trim();
    return v || undefined;
}

/** Load database env from the same locations as YBS import scripts. */
export function loadDatabaseEnv(): void {
    for (const envPath of [
        path.join(repoRoot(), "apps/api/.env"),
        path.join(repoRoot(), "infrastructure/.env"),
    ]) {
        if (fs.existsSync(envPath)) {
            dotenv.config({ path: envPath, override: false });
        }
    }
}

/**
 * Preferred API: resolve via explicit --target local|production.
 * Defaults role to local for local target, write for production.
 */
export function resolvePipelineDatabaseUrl(options: {
    target: PipelineDbTarget;
    role?: "read" | "write" | "local";
    explicit?: string;
}): string {
    if (options.explicit?.trim()) return options.explicit.trim();
    const role: DbTargetRole =
        options.role ?? (options.target === "local" ? "local" : "write");
    return resolveDbTarget({
        target: options.target,
        role: role === "local" ? "local" : role,
    }).url;
}

/**
 * @deprecated Use resolvePipelineDatabaseUrl with explicit target.
 *
 * Order: explicit → LOCAL_DATABASE_URL → SUPABASE_READ_DATABASE_URL →
 * SUPABASE_WRITE_DATABASE_URL → SUPABASE_DATABASE_URL → SUPABASE_DIRECT_DATABASE_URL.
 * Never silently uses bare DATABASE_URL unless PIPELINE_ALLOW_DATABASE_URL=true.
 */
export function resolveDatabaseUrl(explicit?: string): string | undefined {
    if (explicit?.trim()) return explicit.trim();

    const named =
        env("LOCAL_DATABASE_URL") ??
        env("SUPABASE_READ_DATABASE_URL") ??
        env("SUPABASE_WRITE_DATABASE_URL") ??
        env("SUPABASE_DATABASE_URL") ??
        env("SUPABASE_DIRECT_DATABASE_URL");
    if (named) return named;

    const databaseUrl = env("DATABASE_URL");
    if (databaseUrl) {
        if (process.env.PIPELINE_ALLOW_DATABASE_URL === "true") {
            return databaseUrl;
        }
        throw new Error(
            "DATABASE_URL alone is refused as a pipeline database target. " +
                "Set LOCAL_DATABASE_URL, SUPABASE_READ_DATABASE_URL, or SUPABASE_WRITE_DATABASE_URL " +
                "(or legacy SUPABASE_DATABASE_URL / SUPABASE_DIRECT_DATABASE_URL), " +
                "and prefer resolvePipelineDatabaseUrl({ target: \"local\" | \"production\" }). " +
                "Set PIPELINE_ALLOW_DATABASE_URL=true only for emergency override.",
        );
    }

    return undefined;
}

export async function withReadOnlyClient<T>(
    databaseUrl: string,
    fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
    const pool = new pg.Pool({
        connectionString: databaseUrl,
        max: 1,
        statement_timeout: 120_000,
    });

    const client = await pool.connect();
    try {
        await client.query("BEGIN READ ONLY");
        await client.query("SET TRANSACTION READ ONLY");
        const result = await fn(client);
        await client.query("COMMIT");
        return result;
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

/** Load existing train stop geometry pool (read-only). */
export async function loadTrainStopPool(databaseUrl: string): Promise<TrainStopPoolRow[]> {
    return withReadOnlyClient(databaseUrl, async (client) => {
        const result = await client.query<{
            stop_id: string;
            public_id: string;
            stop_code: string | null;
            name: string;
            name_mm: string | null;
            name_en: string | null;
            stop_type: string | null;
            has_geom: boolean;
        }>(`
            SELECT
                s.id::text AS stop_id,
                s.public_id::text AS public_id,
                s.stop_code,
                s.name,
                s.name_mm,
                s.name_en,
                s.stop_type,
                (s.geom IS NOT NULL) AS has_geom
            FROM transport.stops AS s
            WHERE s.mode = 'train'
              AND s.deleted_at IS NULL
            ORDER BY s.id
        `);

        return result.rows.map((row) => ({
            stop_id: Number(row.stop_id),
            public_id: row.public_id,
            stop_code: row.stop_code,
            name: row.name,
            name_mm: row.name_mm,
            name_en: row.name_en,
            stop_type: row.stop_type,
            has_geom: row.has_geom,
        }));
    });
}

export async function withWriteClient<T>(
    databaseUrl: string,
    fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
    const pool = new pg.Pool({
        connectionString: databaseUrl,
        max: 1,
        statement_timeout: 180_000,
    });

    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const result = await fn(client);
        await client.query("COMMIT");
        return result;
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}
