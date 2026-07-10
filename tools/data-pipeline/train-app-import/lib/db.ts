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

function repoRoot(): string {
    return process.cwd();
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

export function resolveDatabaseUrl(explicit?: string): string | undefined {
    return (
        explicit ??
        process.env.SUPABASE_DIRECT_DATABASE_URL ??
        process.env.DATABASE_URL ??
        process.env.LOCAL_DATABASE_URL
    );
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
