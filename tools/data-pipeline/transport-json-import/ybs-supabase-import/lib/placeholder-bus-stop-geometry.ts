/**
 * Shared helpers for YBS placeholder bus stop geometry review and repair.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import dotenv from "dotenv";
import pg from "pg";

import { PLACEHOLDER_GEOMETRY_MODE } from "../../ybs-db-prepare/geometry-rules.js";
import {
    resolveLegacyPipelineDatabaseUrl,
    resolvePipelineDatabaseUrl,
    type PipelineDbTarget,
} from "./resolve-pipeline-db-url.js";
import {
    PROTECTED_REVIEW_STATUSES,
    TRANSPORT_MODE_BUS,
} from "./supabase-schema-map.js";
import { YBS_SOURCE_KIND, YBS_SOURCE_NAME } from "./source-link-utils.js";

export { resolvePipelineDatabaseUrl, type PipelineDbTarget };

export const DEFAULT_BUS_GEOMETRY_RUN_ROOT = "tmp/transport-imports";
export const REVIEWED_STOP_GEOMETRY_FILENAME = "reviewed-stop-geometry.json";
export const PLACEHOLDER_BUS_STOPS_REPORT_JSON = "placeholder-bus-stops-review.json";
export const PLACEHOLDER_BUS_STOPS_REPORT_MD = "placeholder-bus-stops-review.md";
export const UPDATE_PLACEHOLDER_STOP_GEOMETRY_REPORT = "update-placeholder-stop-geometry.json";
export const MANUAL_GEOMETRY_REPAIRED_BY = "update-placeholder-stop-geometry";

/** Approximate Myanmar bounds for manual review input safety. */
export const MYANMAR_LON_MIN = 92;
export const MYANMAR_LON_MAX = 102;
export const MYANMAR_LAT_MIN = 9;
export const MYANMAR_LAT_MAX = 29;

export type BusGeometryRunPaths = {
    runRoot: string;
};

export function repoRoot(): string {
    return process.cwd();
}

export function resolveFromRepo(relativePath: string): string {
    return path.isAbsolute(relativePath)
        ? relativePath
        : path.join(repoRoot(), relativePath);
}

export function defaultBusGeometryRunPaths(runRoot: string = DEFAULT_BUS_GEOMETRY_RUN_ROOT): BusGeometryRunPaths {
    return { runRoot: resolveFromRepo(runRoot) };
}

export function reportsDir(paths: BusGeometryRunPaths): string {
    return path.join(paths.runRoot, "reports");
}

export function reportPath(paths: BusGeometryRunPaths, filename: string): string {
    return path.join(reportsDir(paths), filename);
}

export function reviewedStopGeometryInputPath(
    paths: BusGeometryRunPaths,
    inputFile?: string,
): string {
    if (inputFile) {
        return path.isAbsolute(inputFile) ? inputFile : path.join(paths.runRoot, inputFile);
    }
    return path.join(paths.runRoot, REVIEWED_STOP_GEOMETRY_FILENAME);
}

export function ensureBusGeometryRunLayout(paths: BusGeometryRunPaths): void {
    fs.mkdirSync(paths.runRoot, { recursive: true });
    fs.mkdirSync(reportsDir(paths), { recursive: true });
}

export function loadDatabaseEnv(): void {
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

/** @deprecated Prefer resolvePipelineDatabaseUrl({ target }). Never silent DATABASE_URL. */
export function resolveDatabaseUrl(explicit?: string): string | undefined {
    return resolveLegacyPipelineDatabaseUrl({ explicit });
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

export async function withWriteClient<T>(
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

export function isValidWgs84Coordinate(lon: number, lat: number): boolean {
    return (
        Number.isFinite(lon) &&
        Number.isFinite(lat) &&
        lon >= -180 &&
        lon <= 180 &&
        lat >= -90 &&
        lat <= 90
    );
}

export function isWithinMyanmarBounds(lon: number, lat: number): boolean {
    return (
        lon >= MYANMAR_LON_MIN &&
        lon <= MYANMAR_LON_MAX &&
        lat >= MYANMAR_LAT_MIN &&
        lat <= MYANMAR_LAT_MAX
    );
}

export function isPlaceholderBusStopNormalizedData(
    normalizedData: Record<string, unknown> | null | undefined,
): boolean {
    if (!normalizedData || typeof normalizedData !== "object") {
        return false;
    }

    const geometry =
        normalizedData.geometry && typeof normalizedData.geometry === "object"
            ? (normalizedData.geometry as Record<string, unknown>)
            : null;

    if (!geometry) {
        return false;
    }

    if (geometry.placeholder_geometry_mode === PLACEHOLDER_GEOMETRY_MODE) {
        return true;
    }
    if (geometry.geometry_quality === "placeholder") {
        return true;
    }
    if (geometry.geom_source === "synthetic_even_distribution_placeholder") {
        return true;
    }

    return false;
}

export function buildManualReviewedStopNormalizedDataPatch(input: {
    lon: number;
    lat: number;
    review_note?: string | null;
    reviewedAtIso: string;
}): Record<string, unknown> {
    return {
        geometry_status: "manual_reviewed",
        geometry_reviewed_at: input.reviewedAtIso,
        geometry_review_note: input.review_note ?? null,
        geometry: {
            lng: input.lon,
            lat: input.lat,
            geom_source: "manual_review",
            geometry_quality: "existing",
            public_safe: true,
            do_not_publish: false,
            validator_required: false,
            needs_geometry_review: false,
            placeholder_geometry_mode: null,
        },
    };
}

export function buildManualReviewedRouteStopGeometryData(input: {
    lon: number;
    lat: number;
    stop_id: number;
}): Record<string, unknown> {
    return {
        geom_source: "manual_review",
        geometry_quality: "existing",
        placeholder_geometry_mode: null,
        needs_geometry_review: false,
        validator_required: false,
        public_safe: true,
        repaired_by: MANUAL_GEOMETRY_REPAIRED_BY,
        stop_id: input.stop_id,
        review_lng: input.lon,
        review_lat: input.lat,
    };
}

export function isEligibleBusStopReviewStatus(reviewStatus: string): boolean {
    return !PROTECTED_REVIEW_STATUSES.has(reviewStatus as never);
}

/** SQL fragment: stop has at least one YBS source link. */
export function ybsStopSourceLinkExistsSql(alias = "s"): string {
    return `
        EXISTS (
            SELECT 1
            FROM transport.source_links AS sl
            WHERE sl.entity_type = 'stop'
              AND sl.entity_id = ${alias}.id
              AND sl.source_name = '${YBS_SOURCE_NAME}'
              AND sl.source_kind = '${YBS_SOURCE_KIND}'
              AND sl.external_id LIKE 'stop:ybs_go:%'
        )
    `;
}

/** SQL fragment: stop normalized_data marks straight-line placeholder geometry. */
export function placeholderBusStopGeometrySql(alias = "s"): string {
    return `
        (
            coalesce(${alias}.normalized_data->'geometry'->>'placeholder_geometry_mode', '') = '${PLACEHOLDER_GEOMETRY_MODE}'
            OR coalesce(${alias}.normalized_data->'geometry'->>'geometry_quality', '') = 'placeholder'
            OR coalesce(${alias}.normalized_data->'geometry'->>'geom_source', '') = 'synthetic_even_distribution_placeholder'
            OR coalesce(${alias}.normalized_data->>'geometry_status', '') = 'manual_reviewed'
        )
    `;
}

export const BUS_MODE = TRANSPORT_MODE_BUS;
