#!/usr/bin/env npx tsx
/**
 * Backfill circular-route metadata on already-imported train variants.
 *
 * Default: dry-run. Pass --execute to commit.
 *
 * Usage:
 *   npx tsx tools/data-pipeline/train-app-import/repair/backfill-circular-route-metadata.ts
 *   npx tsx tools/data-pipeline/train-app-import/repair/backfill-circular-route-metadata.ts --execute
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import pg from "pg";

import { loadDatabaseEnv, resolveDatabaseUrl, withWriteClient } from "../lib/db.js";
import {
    defaultRunPaths,
    ensureRunLayout,
    importReadyRoutePathByVariantCode,
    normalizedRoutePathByVariantCode,
    reportPath,
    type TrainRunPaths,
} from "../lib/paths.js";
import { TRAIN_IMPORT_GENERATION, TRAIN_MODE } from "../lib/train-import-constants.js";
import type { ImportReadyTrainRoute, NormalizedTrainRoute } from "../lib/types.js";

export const KNOWN_CIRCULAR_VARIANT_CODES = [
    "TRAIN-GA-3-CLOCKWISE",
    "TRAIN-GA-6-ANTICLOCKWISE",
    "TRAIN-KA-3-ANTICLOCKWISE",
    "TRAIN-KA-6-ANTICLOCKWISE",
    "TRAIN-KHA-3-CLOCKWISE",
    "TRAIN-KHA-4-ANTICLOCKWISE",
    "TRAIN-KHA-5-CLOCKWISE",
    "TRAIN-KHA-6-CLOCKWISE",
    "TRAIN-ZA-2-ANTICLOCKWISE",
] as const;

export const DEFAULT_SOURCE_TOTAL_STATIONS = 39;
export const DEFAULT_CLOSING_DUPLICATE_SEQUENCE = 39;

export const LOOP_POLICY =
    "skip_closing_duplicate_stop_due_to_unique_variant_stop_constraint";

const REPORT_FILENAME = "backfill-circular-route-metadata.json";

export type CircularFileHints = {
    source: "import-ready" | "normalized" | "hardcoded";
    source_total_stations: number;
    closing_duplicate_sequence: number;
    closing_duplicate_station_name_en: string | null;
    closing_duplicate_station_name_my: string | null;
    closing_duplicate_source_time_text: string | null;
};

export type CircularVariantRow = {
    variant_id: number;
    variant_code: string;
    route_code: string;
    review_status: string;
    is_active: boolean;
    route_stop_count: number;
    normalized_data: Record<string, unknown> | null;
};

export type CircularBackfillPlanItem = {
    variant_code: string;
    variant_id: number;
    route_code: string;
    route_stop_count: number;
    file_hints: CircularFileHints;
    patch: Record<string, unknown>;
    action: "update" | "skip";
    skip_reason: string | null;
};

export type CircularBackfillResult = {
    dry_run: boolean;
    executed: boolean;
    updated_count: number;
    skipped_count: number;
    missing_count: number;
    items: CircularBackfillPlanItem[];
    missing_variant_codes: string[];
};

export type BackfillCircularRouteMetadataOptions = {
    runRoot?: string;
    databaseUrl?: string;
    execute?: boolean;
};

function trimToNull(value: string | null | undefined): string | null {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
}

export function loadCircularFileHints(
    paths: TrainRunPaths,
    variantCode: string,
): CircularFileHints {
    const importReadyFile = importReadyRoutePathByVariantCode(paths, variantCode);
    if (fs.existsSync(importReadyFile)) {
        const route = JSON.parse(fs.readFileSync(importReadyFile, "utf8")) as ImportReadyTrainRoute;
        const last = route.stations.at(-1);
        return {
            source: "import-ready",
            source_total_stations: route.total_stations ?? route.stations.length,
            closing_duplicate_sequence: last?.sequence ?? route.stations.length,
            closing_duplicate_station_name_en: trimToNull(last?.station_name_en),
            closing_duplicate_station_name_my: trimToNull(last?.station_name_my),
            closing_duplicate_source_time_text: trimToNull(last?.source_time_text),
        };
    }

    const normalizedFile = normalizedRoutePathByVariantCode(paths, variantCode);
    if (fs.existsSync(normalizedFile)) {
        const normalized = JSON.parse(fs.readFileSync(normalizedFile, "utf8")) as NormalizedTrainRoute;
        const last = normalized.stations.at(-1);
        return {
            source: "normalized",
            source_total_stations:
                normalized.variant?.total_stations ?? normalized.stations.length,
            closing_duplicate_sequence: last?.sequence ?? normalized.stations.length,
            closing_duplicate_station_name_en: trimToNull(last?.station_name_en),
            closing_duplicate_station_name_my: trimToNull(last?.station_name_my),
            closing_duplicate_source_time_text: trimToNull(last?.source_time_text),
        };
    }

    return {
        source: "hardcoded",
        source_total_stations: DEFAULT_SOURCE_TOTAL_STATIONS,
        closing_duplicate_sequence: DEFAULT_CLOSING_DUPLICATE_SEQUENCE,
        closing_duplicate_station_name_en: null,
        closing_duplicate_station_name_my: null,
        closing_duplicate_source_time_text: null,
    };
}

export function buildCircularBackfillPatch(
    hints: CircularFileHints,
    routeStopCount: number,
): Record<string, unknown> {
    const patch: Record<string, unknown> = {
        is_circular_route: true,
        source_total_stations: hints.source_total_stations,
        imported_route_stops: routeStopCount,
        validation_expected_route_stops: routeStopCount,
        closing_duplicate_stop_skipped: true,
        closing_duplicate_sequence: hints.closing_duplicate_sequence,
        loop_policy: LOOP_POLICY,
    };

    if (hints.closing_duplicate_station_name_en) {
        patch.closing_duplicate_station_name_en = hints.closing_duplicate_station_name_en;
    }
    if (hints.closing_duplicate_station_name_my) {
        patch.closing_duplicate_station_name_my = hints.closing_duplicate_station_name_my;
    }
    if (hints.closing_duplicate_source_time_text) {
        patch.closing_duplicate_source_time_text = hints.closing_duplicate_source_time_text;
    }

    return patch;
}

function patchAlreadyApplied(
    normalizedData: Record<string, unknown> | null,
    patch: Record<string, unknown>,
): boolean {
    if (!normalizedData) {
        return false;
    }

    for (const [key, value] of Object.entries(patch)) {
        if (normalizedData[key] !== value) {
            return false;
        }
    }

    return true;
}

async function loadCircularVariants(
    client: pg.PoolClient,
    variantCodes: readonly string[],
): Promise<CircularVariantRow[]> {
    const result = await client.query<{
        variant_id: string;
        variant_code: string;
        route_code: string;
        review_status: string;
        is_active: boolean;
        route_stop_count: string;
        normalized_data: Record<string, unknown> | null;
    }>(
        `
        SELECT
            v.id::text AS variant_id,
            v.variant_code,
            r.route_code,
            v.review_status,
            v.is_active,
            v.normalized_data,
            (
                SELECT count(*)::text
                FROM transport.route_stops AS rs
                WHERE rs.route_variant_id = v.id
            ) AS route_stop_count
        FROM transport.route_variants AS v
        INNER JOIN transport.routes AS r ON r.id = v.route_id
        WHERE v.variant_code = ANY($1::text[])
          AND v.deleted_at IS NULL
          AND r.deleted_at IS NULL
          AND r.mode = $2
          AND v.normalized_data->>'generation' = $3
        ORDER BY v.variant_code ASC
        `,
        [variantCodes, TRAIN_MODE, TRAIN_IMPORT_GENERATION],
    );

    return result.rows.map((row) => ({
        variant_id: Number(row.variant_id),
        variant_code: row.variant_code,
        route_code: row.route_code,
        review_status: row.review_status,
        is_active: row.is_active,
        route_stop_count: Number(row.route_stop_count),
        normalized_data: row.normalized_data,
    }));
}

async function applyCircularBackfillPatch(
    client: pg.PoolClient,
    variantId: number,
    variantCode: string,
    patch: Record<string, unknown>,
): Promise<void> {
    await client.query(
        `
        UPDATE transport.route_variants AS v
        SET
            normalized_data = v.normalized_data || $2::jsonb,
            updated_at = now()
        FROM transport.routes AS r
        WHERE v.id = $1
          AND r.id = v.route_id
          AND v.variant_code = $3
          AND v.deleted_at IS NULL
          AND r.deleted_at IS NULL
          AND r.mode = $4
          AND v.normalized_data->>'generation' = $5
        `,
        [variantId, JSON.stringify(patch), variantCode, TRAIN_MODE, TRAIN_IMPORT_GENERATION],
    );
}

export function buildCircularBackfillPlan(
    paths: TrainRunPaths,
    rows: CircularVariantRow[],
    variantCodes: readonly string[] = KNOWN_CIRCULAR_VARIANT_CODES,
): CircularBackfillResult {
    const rowsByCode = new Map(rows.map((row) => [row.variant_code, row]));
    const items: CircularBackfillPlanItem[] = [];
    const missing_variant_codes: string[] = [];

    for (const variantCode of variantCodes) {
        const row = rowsByCode.get(variantCode);
        if (!row) {
            missing_variant_codes.push(variantCode);
            continue;
        }

        const fileHints = loadCircularFileHints(paths, variantCode);
        const patch = buildCircularBackfillPatch(fileHints, row.route_stop_count);

        let action: CircularBackfillPlanItem["action"] = "update";
        let skip_reason: string | null = null;

        if (row.route_stop_count <= 0) {
            action = "skip";
            skip_reason = "variant has no route_stops";
        } else if (patchAlreadyApplied(row.normalized_data, patch)) {
            action = "skip";
            skip_reason = "circular metadata already present";
        }

        items.push({
            variant_code: variantCode,
            variant_id: row.variant_id,
            route_code: row.route_code,
            route_stop_count: row.route_stop_count,
            file_hints: fileHints,
            patch,
            action,
            skip_reason,
        });
    }

    return {
        dry_run: true,
        executed: false,
        updated_count: items.filter((item) => item.action === "update").length,
        skipped_count: items.filter((item) => item.action === "skip").length,
        missing_count: missing_variant_codes.length,
        items,
        missing_variant_codes,
    };
}

/** Backfill circular metadata on known imported train variants. */
export async function backfillCircularRouteMetadata(
    options: BackfillCircularRouteMetadataOptions = {},
): Promise<{ reportPath: string; result: CircularBackfillResult }> {
    const paths = defaultRunPaths(options.runRoot);
    ensureRunLayout(paths);

    loadDatabaseEnv();
    const databaseUrl = resolveDatabaseUrl(options.databaseUrl);
    if (!databaseUrl) {
        throw new Error(
            "No database URL. Set SUPABASE_DIRECT_DATABASE_URL, DATABASE_URL, or LOCAL_DATABASE_URL.",
        );
    }

    const execute = options.execute === true;

    const result = await withWriteClient(databaseUrl, async (client) => {
        const rows = await loadCircularVariants(client, KNOWN_CIRCULAR_VARIANT_CODES);
        const plan = buildCircularBackfillPlan(paths, rows);

        if (execute) {
            for (const item of plan.items) {
                if (item.action !== "update") {
                    continue;
                }
                await applyCircularBackfillPatch(
                    client,
                    item.variant_id,
                    item.variant_code,
                    item.patch,
                );
            }
        }

        return {
            ...plan,
            dry_run: !execute,
            executed: execute,
        };
    });

    const report = {
        generated_at: new Date().toISOString(),
        generation: TRAIN_IMPORT_GENERATION,
        mode: TRAIN_MODE,
        ...result,
    };

    const reportOutputPath = reportPath(paths, REPORT_FILENAME);
    fs.writeFileSync(reportOutputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

    return { reportPath: reportOutputPath, result };
}

function parseCliArgs(argv: string[]): BackfillCircularRouteMetadataOptions {
    const options: BackfillCircularRouteMetadataOptions = {};

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

function printSummary(reportOutputPath: string, result: CircularBackfillResult): void {
    console.log(`Report: ${reportOutputPath}`);
    console.log(result.executed ? "Executed backfill." : "Dry run only.");
    console.log(
        `Planned updates: ${result.updated_count}, skipped: ${result.skipped_count}, missing: ${result.missing_count}`,
    );

    for (const item of result.items) {
        if (item.action === "update") {
            console.log(
                `  [update] ${item.variant_code} route_stops=${item.route_stop_count} ` +
                    `source_total=${item.patch.source_total_stations} hints=${item.file_hints.source}`,
            );
        } else {
            console.log(`  [skip] ${item.variant_code}: ${item.skip_reason}`);
        }
    }

    for (const variantCode of result.missing_variant_codes) {
        console.log(`  [missing] ${variantCode}: not found or not simple_train_system_v1 train variant`);
    }
}

export function runBackfillCircularRouteMetadataSelfTest(): void {
    const paths = defaultRunPaths(path.join(process.cwd(), "tmp/train-import-self-test-empty"));
    const hints = loadCircularFileHints(paths, "TRAIN-GA-3-CLOCKWISE");
    if (hints.source !== "hardcoded" || hints.source_total_stations !== DEFAULT_SOURCE_TOTAL_STATIONS) {
        throw new Error("expected hardcoded hints when files are missing");
    }

    const patch = buildCircularBackfillPatch(hints, 38);
    if (
        patch.is_circular_route !== true ||
        patch.source_total_stations !== 39 ||
        patch.imported_route_stops !== 38 ||
        patch.validation_expected_route_stops !== 38 ||
        patch.closing_duplicate_stop_skipped !== true ||
        patch.closing_duplicate_sequence !== 39 ||
        patch.loop_policy !== LOOP_POLICY
    ) {
        throw new Error(`unexpected patch: ${JSON.stringify(patch)}`);
    }

    const plan = buildCircularBackfillPlan(paths, [
        {
            variant_id: 1,
            variant_code: "TRAIN-GA-3-CLOCKWISE",
            route_code: "TRAIN-ga-3",
            review_status: "imported_unreviewed",
            is_active: false,
            route_stop_count: 38,
            normalized_data: { generation: TRAIN_IMPORT_GENERATION },
        },
    ]);
    if (plan.updated_count !== 1 || plan.missing_count !== 8) {
        throw new Error(`unexpected plan counts: ${JSON.stringify(plan)}`);
    }

    const alreadyApplied = buildCircularBackfillPlan(paths, [
        {
            variant_id: 1,
            variant_code: "TRAIN-GA-3-CLOCKWISE",
            route_code: "TRAIN-ga-3",
            review_status: "imported_unreviewed",
            is_active: false,
            route_stop_count: 38,
            normalized_data: {
                generation: TRAIN_IMPORT_GENERATION,
                ...patch,
            },
        },
    ]);
    if (alreadyApplied.updated_count !== 0 || alreadyApplied.skipped_count !== 1) {
        throw new Error("expected already-applied patch to skip");
    }

    console.log("ok - backfill-circular-route-metadata self-test");
}

async function main(): Promise<void> {
    const { reportPath: reportOutputPath, result } = await backfillCircularRouteMetadata(
        parseCliArgs(process.argv.slice(2)),
    );
    printSummary(reportOutputPath, result);
}

const isCliEntry = process.argv[1]?.includes("backfill-circular-route-metadata.ts");
const isSelfTestEntry =
    process.argv[1]?.includes("backfill-circular-route-metadata.ts") &&
    process.argv.includes("--self-test");

if (isSelfTestEntry) {
    runBackfillCircularRouteMetadataSelfTest();
} else if (isCliEntry) {
    main().catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error(message);
        process.exit(1);
    });
}
