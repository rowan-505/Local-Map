#!/usr/bin/env npx tsx
/**
 * Append the skipped circular closing route_stop for true circular train variants.
 *
 * Targets only variants where:
 *   - route mode = train
 *   - variant.normalized_data.is_circular_route = true
 *   - variant.normalized_data.closing_duplicate_stop_skipped = true
 *
 * Default: dry-run. Pass --execute to commit.
 *
 * Usage:
 *   npx tsx tools/data-pipeline/train-app-import/repair/append-circular-closing-route-stop.ts
 *   npx tsx tools/data-pipeline/train-app-import/repair/append-circular-closing-route-stop.ts --execute
 */

import fs from "node:fs";
import process from "node:process";

import type pg from "pg";

import {
    buildCircularClosingRepairPlan,
    CIRCULAR_CLOSING_REPAIR_SCRIPT,
    loadClosingOccurrenceSourceTiming,
    runAppendCircularClosingRouteStopSelfTest,
    type CircularClosingRepairPlanItem,
    type CircularClosingRepairRouteStopRow,
    type CircularClosingRepairVariantRow,
} from "../lib/append-circular-closing-route-stop.js";
import { loadDatabaseEnv, resolveDatabaseUrl, withWriteClient } from "../lib/db.js";
import { defaultRunPaths, ensureRunLayout, reportPath } from "../lib/paths.js";
import { TRAIN_MODE } from "../lib/train-import-constants.js";

const REPORT_FILENAME = "append-circular-closing-route-stop.json";

export type AppendCircularClosingRouteStopOptions = {
    runRoot?: string;
    databaseUrl?: string;
    execute?: boolean;
};

export type AppendCircularClosingRouteStopResult = {
    dry_run: boolean;
    executed: boolean;
    variant_stop_unique_index_present: boolean;
    append_count: number;
    skipped_count: number;
    items: CircularClosingRepairPlanItem[];
};

async function loadVariantStopUniqueIndexPresent(client: pg.PoolClient): Promise<boolean> {
    const result = await client.query<{ exists: boolean }>(`
        SELECT EXISTS (
            SELECT 1
            FROM pg_indexes
            WHERE schemaname = 'transport'
              AND tablename = 'route_stops'
              AND indexname = 'transport_route_stops_variant_stop_unique'
        ) AS exists
    `);
    return result.rows[0]?.exists === true;
}

async function loadTargetVariants(
    client: pg.PoolClient,
    paths: ReturnType<typeof defaultRunPaths>,
): Promise<CircularClosingRepairVariantRow[]> {
    const variants = await client.query<{
        variant_id: string;
        variant_code: string;
        route_code: string;
        normalized_data: Record<string, unknown> | null;
    }>(
        `
        SELECT
            v.id::text AS variant_id,
            v.variant_code,
            r.route_code,
            v.normalized_data
        FROM transport.route_variants AS v
        INNER JOIN transport.routes AS r ON r.id = v.route_id
        WHERE v.deleted_at IS NULL
          AND r.deleted_at IS NULL
          AND r.mode = $1
          AND coalesce(v.normalized_data->>'is_circular_route', 'false') = 'true'
          AND coalesce(v.normalized_data->>'closing_duplicate_stop_skipped', 'false') = 'true'
        ORDER BY r.route_code ASC, v.variant_code ASC
        `,
        [TRAIN_MODE],
    );

    if (variants.rows.length === 0) {
        return [];
    }

    const variantIds = variants.rows.map((row) => Number(row.variant_id));
    const stopRows = await client.query<{
        variant_id: string;
        route_stop_id: string;
        stop_id: string;
        stop_sequence: number;
        pickup_type: number;
        drop_off_type: number;
        is_timing_point: boolean;
        arrival_offset_seconds: number | null;
        departure_offset_seconds: number | null;
        travel_time_from_previous_seconds: number | null;
        source_time_text: string | null;
        source_time_type: string | null;
        source_refs: Record<string, unknown> | null;
        normalized_data: Record<string, unknown> | null;
    }>(
        `
        SELECT
            rs.route_variant_id::text AS variant_id,
            rs.id::text AS route_stop_id,
            rs.stop_id::text AS stop_id,
            rs.stop_sequence,
            rs.pickup_type,
            rs.drop_off_type,
            rs.is_timing_point,
            rs.arrival_offset_seconds,
            rs.departure_offset_seconds,
            rs.travel_time_from_previous_seconds,
            rs.source_time_text,
            rs.source_time_type,
            rs.source_refs,
            rs.normalized_data
        FROM transport.route_stops AS rs
        WHERE rs.route_variant_id = ANY($1::bigint[])
        ORDER BY rs.route_variant_id ASC, rs.stop_sequence ASC, rs.id ASC
        `,
        [variantIds],
    );

    const stopsByVariant = new Map<number, CircularClosingRepairRouteStopRow[]>();
    for (const row of stopRows.rows) {
        const variantId = Number(row.variant_id);
        const bucket = stopsByVariant.get(variantId) ?? [];
        bucket.push({
            route_stop_id: Number(row.route_stop_id),
            stop_id: Number(row.stop_id),
            stop_sequence: row.stop_sequence,
            pickup_type: row.pickup_type,
            drop_off_type: row.drop_off_type,
            is_timing_point: row.is_timing_point,
            arrival_offset_seconds: row.arrival_offset_seconds,
            departure_offset_seconds: row.departure_offset_seconds,
            travel_time_from_previous_seconds: row.travel_time_from_previous_seconds,
            source_time_text: row.source_time_text,
            source_time_type: row.source_time_type,
            source_refs: row.source_refs,
            normalized_data: row.normalized_data,
        });
        stopsByVariant.set(variantId, bucket);
    }

    return variants.rows.map((row) => ({
        variant_id: Number(row.variant_id),
        variant_code: row.variant_code,
        route_code: row.route_code,
        normalized_data: row.normalized_data,
        route_stops: stopsByVariant.get(Number(row.variant_id)) ?? [],
        closing_source_timing: loadClosingOccurrenceSourceTiming(
            paths,
            row.variant_code,
            row.normalized_data,
        ),
    }));
}

async function applyCircularClosingRepairItem(
    client: pg.PoolClient,
    item: CircularClosingRepairPlanItem,
): Promise<void> {
    if (item.action !== "append" || !item.insert || !item.variant_normalized_data_patch) {
        return;
    }

    const insert = item.insert;
    await client.query(
        `
        INSERT INTO transport.route_stops (
            route_variant_id,
            stop_id,
            stop_sequence,
            pickup_type,
            drop_off_type,
            is_timing_point,
            arrival_offset_seconds,
            departure_offset_seconds,
            travel_time_from_previous_seconds,
            source_time_text,
            source_time_type,
            source_refs,
            normalized_data
        )
        VALUES (
            $1, $2, $3, $4, $5, $6,
            $7, $8, $9, $10, $11, $12::jsonb, $13::jsonb
        )
        `,
        [
            insert.route_variant_id,
            insert.stop_id,
            insert.stop_sequence,
            insert.pickup_type,
            insert.drop_off_type,
            insert.is_timing_point,
            insert.arrival_offset_seconds,
            insert.departure_offset_seconds,
            insert.travel_time_from_previous_seconds,
            insert.source_time_text,
            insert.source_time_type,
            JSON.stringify(insert.source_refs),
            JSON.stringify(insert.normalized_data),
        ],
    );

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
          AND r.route_code = $4
          AND v.deleted_at IS NULL
          AND r.deleted_at IS NULL
          AND r.mode = $5
        `,
        [
            item.variant_id,
            JSON.stringify(item.variant_normalized_data_patch),
            item.variant_code,
            item.route_code,
            TRAIN_MODE,
        ],
    );
}

export async function appendCircularClosingRouteStop(
    options: AppendCircularClosingRouteStopOptions = {},
): Promise<{ reportPath: string; result: AppendCircularClosingRouteStopResult }> {
    loadDatabaseEnv();
    const databaseUrl = resolveDatabaseUrl(options.databaseUrl);
    if (!databaseUrl) {
        throw new Error("DATABASE_URL (or SUPABASE_DIRECT_DATABASE_URL) is required.");
    }

    const paths = defaultRunPaths(options.runRoot);
    ensureRunLayout(paths);

    const execute = options.execute === true;

    const result = await withWriteClient(databaseUrl, async (client) => {
        const variantStopUniqueIndexPresent = await loadVariantStopUniqueIndexPresent(client);
        const bundles = await loadTargetVariants(client, paths);
        const plan = buildCircularClosingRepairPlan(bundles, { variantStopUniqueIndexPresent });

        if (execute) {
            for (const item of plan.items) {
                if (item.action === "append") {
                    await applyCircularClosingRepairItem(client, item);
                }
            }
        }

        const append_count = plan.items.filter((item) => item.action === "append").length;
        const skipped_count = plan.items.filter((item) => item.action === "skip").length;

        return {
            dry_run: !execute,
            executed: execute,
            variant_stop_unique_index_present: variantStopUniqueIndexPresent,
            append_count,
            skipped_count,
            items: plan.items,
        };
    });

    const report = {
        generated_at: new Date().toISOString(),
        repair_script: CIRCULAR_CLOSING_REPAIR_SCRIPT,
        mode: TRAIN_MODE,
        ...result,
    };

    const reportOutputPath = reportPath(paths, REPORT_FILENAME);
    fs.writeFileSync(reportOutputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

    return { reportPath: reportOutputPath, result };
}

function parseCliArgs(argv: string[]): AppendCircularClosingRouteStopOptions {
    const options: AppendCircularClosingRouteStopOptions = {};

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

function printSummary(reportOutputPath: string, result: AppendCircularClosingRouteStopResult): void {
    console.log(`Report: ${reportOutputPath}`);
    console.log(result.executed ? "Executed repair." : "Dry run only.");
    if (result.variant_stop_unique_index_present) {
        console.log(
            "Note: transport_route_stops_variant_stop_unique is still present. Apply migration 126 before --execute.",
        );
    }
    console.log(`Planned appends: ${result.append_count}, skipped: ${result.skipped_count}`);

    for (const item of result.items) {
        if (item.action === "append") {
            console.log(
                `  [append] ${item.route_code} ${item.variant_code} ` +
                    `old=${item.old_stop_count} new=${item.new_stop_count} ` +
                    `first_stop_id=${item.first_stop_id} appended_sequence=${item.appended_sequence} ` +
                    `timing_source=${item.closing_timing_source} ` +
                    `closing_timing_needs_review=${item.closing_timing_needs_review}`,
            );
        } else {
            console.log(
                `  [skip] ${item.route_code} ${item.variant_code} ` +
                    `old=${item.old_stop_count} reason=${item.skip_reason}`,
            );
        }
    }
}

async function main(): Promise<void> {
    const { reportPath: reportOutputPath, result } = await appendCircularClosingRouteStop(
        parseCliArgs(process.argv.slice(2)),
    );
    printSummary(reportOutputPath, result);
}

const isCliEntry = process.argv[1]?.includes("append-circular-closing-route-stop.ts");
const isSelfTestEntry =
    process.argv[1]?.includes("append-circular-closing-route-stop.ts") &&
    process.argv.includes("--self-test");

if (isSelfTestEntry) {
    runAppendCircularClosingRouteStopSelfTest();
} else if (isCliEntry) {
    main().catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error(message);
        process.exit(1);
    });
}
