#!/usr/bin/env npx tsx
/**
 * One-time backfill: set route_variants.normalized_data.departure_time_text
 * from the first ordered route_stop.source_time_text for train variants.
 *
 * Default: dry-run (transaction rolled back). Pass --execute to commit writes.
 *
 * Usage:
 *   npx tsx tools/data-pipeline/train-app-import/repair/backfill-train-variant-departure-time.ts
 *   npx tsx tools/data-pipeline/train-app-import/repair/backfill-train-variant-departure-time.ts --execute
 *   npx tsx tools/data-pipeline/train-app-import/repair/backfill-train-variant-departure-time.ts --verify
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import assert from "node:assert/strict";

import pg from "pg";

import {
    parseSourceTimeToCanonical,
    validateCanonicalTime,
} from "../../../../packages/transport-timetable/transport-time.ts";
import {
    calculateVariantTimetableSchedule,
    variantTimetableScheduleToOffsets,
} from "../../../../packages/transport-timetable/timetable.ts";
import { loadDatabaseEnv, resolveDatabaseUrl } from "../lib/db.js";
import { defaultRunPaths, ensureRunLayout, reportPath } from "../lib/paths.js";
import { TRAIN_MODE } from "../lib/train-import-constants.js";

const REPORT_FILENAME = "backfill-train-variant-departure-time.json";

export type TrainVariantDepartureCandidateRow = {
    variant_id: number;
    variant_code: string;
    route_code: string;
    is_active: boolean;
    departure_time_text: string | null;
    first_source_time_text: string | null;
    first_source_time_type: string | null;
};

export type TrainVariantDepartureBackfillAction = "update" | "skip" | "error";

export type TrainVariantDepartureBackfillItem = {
    route_code: string;
    variant_code: string;
    original_source_time: string | null;
    canonical_departure_time: string | null;
    action: TrainVariantDepartureBackfillAction;
    reason: string | null;
    variant_id: number;
};

export type TrainVariantDepartureBackfillPlan = {
    items: TrainVariantDepartureBackfillItem[];
    update_count: number;
    skip_count: number;
    error_count: number;
};

export type TrainVariantDepartureBackfillResult = TrainVariantDepartureBackfillPlan & {
    dry_run: boolean;
    executed: boolean;
    applied_count: number;
    offset_repair: TrainVariantOffsetRepairSummary | null;
};

export type TrainVariantDepartureVerification = {
    active_train_variant_count: number;
    with_canonical_departure_count: number;
    missing_departure_count: number;
    invalid_departure_count: number;
    non_target_with_departure_count: number;
    inconsistent_offset_count: number;
    missing_items: Array<{
        route_code: string;
        variant_code: string;
        departure_time_text: string | null;
        first_source_time_text: string | null;
        first_source_time_type: string | null;
    }>;
    invalid_items: Array<{
        route_code: string;
        variant_code: string;
        departure_time_text: string;
    }>;
};

export type TrainVariantOffsetRepairSummary = {
    targeted_variant_count: number;
    repaired_variant_count: number;
    updated_route_stop_count: number;
};

export type BackfillTrainVariantDepartureTimeOptions = {
    runRoot?: string;
    databaseUrl?: string;
    execute?: boolean;
    verifyOnly?: boolean;
};

function trimToNull(value: string | null | undefined): string | null {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
}

export function classifyTrainVariantDepartureBackfillRow(
    row: TrainVariantDepartureCandidateRow,
): TrainVariantDepartureBackfillItem {
    const base = {
        route_code: row.route_code,
        variant_code: row.variant_code,
        variant_id: row.variant_id,
        original_source_time: trimToNull(row.first_source_time_text),
        canonical_departure_time: null as string | null,
    };

    if (!row.is_active) {
        return { ...base, action: "skip", reason: "variant is not active" };
    }

    const existingDeparture = trimToNull(row.departure_time_text);
    if (existingDeparture) {
        return {
            ...base,
            action: "skip",
            reason: "departure_time_text already set",
        };
    }

    const sourceTime = trimToNull(row.first_source_time_text);
    if (!sourceTime) {
        return {
            ...base,
            action: "skip",
            reason: "first route_stop has no source_time_text",
        };
    }

    if (row.first_source_time_type !== "departure") {
        return {
            ...base,
            action: "skip",
            reason: `first route_stop source_time_type is ${row.first_source_time_type ?? "missing"}, expected departure`,
        };
    }

    const canonical = parseSourceTimeToCanonical(sourceTime);
    if (!canonical) {
        return {
            ...base,
            action: "error",
            reason: `invalid first route_stop source_time_text: ${sourceTime}`,
        };
    }

    return {
        ...base,
        canonical_departure_time: canonical,
        action: "update",
        reason: null,
    };
}

export function buildTrainVariantDepartureBackfillPlan(
    rows: readonly TrainVariantDepartureCandidateRow[],
): TrainVariantDepartureBackfillPlan {
    const items = rows.map(classifyTrainVariantDepartureBackfillRow);
    return {
        items,
        update_count: items.filter((item) => item.action === "update").length,
        skip_count: items.filter((item) => item.action === "skip").length,
        error_count: items.filter((item) => item.action === "error").length,
    };
}

async function loadTrainVariantDepartureCandidates(
    client: pg.PoolClient,
): Promise<TrainVariantDepartureCandidateRow[]> {
    const result = await client.query<{
        variant_id: string;
        variant_code: string;
        route_code: string;
        is_active: boolean;
        departure_time_text: string | null;
        first_source_time_text: string | null;
        first_source_time_type: string | null;
    }>(
        `
        SELECT
            v.id::text AS variant_id,
            v.variant_code,
            r.route_code,
            v.is_active,
            NULLIF(BTRIM(v.normalized_data->>'departure_time_text'), '') AS departure_time_text,
            NULLIF(BTRIM(first_rs.source_time_text), '') AS first_source_time_text,
            first_rs.source_time_type AS first_source_time_type
        FROM transport.route_variants AS v
        INNER JOIN transport.routes AS r ON r.id = v.route_id
        LEFT JOIN LATERAL (
            SELECT
                rs.source_time_text,
                rs.source_time_type
            FROM transport.route_stops AS rs
            WHERE rs.route_variant_id = v.id
            ORDER BY rs.stop_sequence ASC
            LIMIT 1
        ) AS first_rs ON true
        WHERE v.deleted_at IS NULL
          AND r.deleted_at IS NULL
          AND r.mode = $1
        ORDER BY r.route_code ASC, v.variant_code ASC
        `,
        [TRAIN_MODE],
    );

    return result.rows.map((row) => ({
        variant_id: Number(row.variant_id),
        variant_code: row.variant_code,
        route_code: row.route_code,
        is_active: row.is_active,
        departure_time_text: row.departure_time_text,
        first_source_time_text: row.first_source_time_text,
        first_source_time_type: row.first_source_time_type,
    }));
}

async function applyTrainVariantDepartureBackfill(
    client: pg.PoolClient,
    item: TrainVariantDepartureBackfillItem,
): Promise<boolean> {
    if (item.action !== "update" || !item.canonical_departure_time) {
        return false;
    }

    const result = await client.query(
        `
        UPDATE transport.route_variants AS v
        SET
            normalized_data = COALESCE(v.normalized_data, '{}'::jsonb)
                || jsonb_build_object('departure_time_text', $2::text),
            updated_at = now()
        FROM transport.routes AS r
        WHERE v.id = $1
          AND r.id = v.route_id
          AND v.deleted_at IS NULL
          AND r.deleted_at IS NULL
          AND r.mode = $3
          AND v.is_active = true
          AND NULLIF(BTRIM(v.normalized_data->>'departure_time_text'), '') IS NULL
        `,
        [item.variant_id, item.canonical_departure_time, TRAIN_MODE],
    );

    return result.rowCount === 1;
}

async function recalculateTrainVariantTimetableOffsets(
    client: pg.PoolClient,
    variantId: number,
): Promise<number> {
    const result = await client.query<{
        id: string;
        travel_time_from_previous_seconds: number | null;
        waiting_time_seconds: number | null;
    }>(
        `
        SELECT
            rs.id::text AS id,
            rs.travel_time_from_previous_seconds,
            rs.waiting_time_seconds
        FROM transport.route_stops AS rs
        WHERE rs.route_variant_id = $1
        ORDER BY rs.stop_sequence ASC
        FOR UPDATE
        `,
        [variantId],
    );

    const stops = result.rows.map((row) => ({
        id: row.id,
        travel_time_from_previous_seconds: row.travel_time_from_previous_seconds,
        waiting_time_seconds: row.waiting_time_seconds,
    }));
    const offsets = variantTimetableScheduleToOffsets(
        calculateVariantTimetableSchedule({
            departureTimeText: null,
            stops,
        }),
    );

    let updated = 0;
    for (let index = 0; index < stops.length; index += 1) {
        const stop = stops[index]!;
        const offset = offsets[index]!;
        const update = await client.query(
            `
            UPDATE transport.route_stops
            SET
                arrival_offset_seconds = $2,
                departure_offset_seconds = $3,
                updated_at = now()
            WHERE id = $1
              AND (
                  arrival_offset_seconds IS DISTINCT FROM $2
                  OR departure_offset_seconds IS DISTINCT FROM $3
              )
            `,
            [stop.id, offset.arrival_offset_seconds, offset.departure_offset_seconds],
        );
        updated += update.rowCount ?? 0;
    }

    return updated;
}

async function repairTrainVariantTimetableOffsets(
    client: pg.PoolClient,
    rows: readonly TrainVariantDepartureCandidateRow[],
): Promise<TrainVariantOffsetRepairSummary> {
    const targets = rows.filter(
        (row) => row.is_active && validateCanonicalTime(trimToNull(row.departure_time_text) ?? ""),
    );

    let repaired_variant_count = 0;
    let updated_route_stop_count = 0;
    for (const row of targets) {
        const updated = await recalculateTrainVariantTimetableOffsets(client, row.variant_id);
        if (updated > 0) {
            repaired_variant_count += 1;
            updated_route_stop_count += updated;
        }
    }

    return {
        targeted_variant_count: targets.length,
        repaired_variant_count,
        updated_route_stop_count,
    };
}

async function countInconsistentTrainTimetableOffsets(client: pg.PoolClient): Promise<number> {
    const result = await client.query<{ inconsistent_offset_count: string }>(
        `
        WITH ordered AS (
            SELECT
                rs.route_variant_id,
                rs.stop_sequence,
                rs.travel_time_from_previous_seconds AS travel,
                rs.waiting_time_seconds AS waiting,
                rs.arrival_offset_seconds AS arrival_offset,
                rs.departure_offset_seconds AS departure_offset,
                LAG(rs.departure_offset_seconds) OVER (
                    PARTITION BY rs.route_variant_id
                    ORDER BY rs.stop_sequence ASC
                ) AS previous_departure_offset,
                ROW_NUMBER() OVER (
                    PARTITION BY rs.route_variant_id
                    ORDER BY rs.stop_sequence ASC
                ) AS row_number,
                COUNT(*) OVER (PARTITION BY rs.route_variant_id) AS row_count
            FROM transport.route_stops AS rs
            INNER JOIN transport.route_variants AS v ON v.id = rs.route_variant_id
            INNER JOIN transport.routes AS r ON r.id = v.route_id
            WHERE v.deleted_at IS NULL
              AND r.deleted_at IS NULL
              AND r.mode = $1
              AND v.is_active = true
              AND NULLIF(BTRIM(v.normalized_data->>'departure_time_text'), '') IS NOT NULL
        )
        SELECT COUNT(*)::text AS inconsistent_offset_count
        FROM ordered
        WHERE
            (row_number = 1 AND (arrival_offset IS NOT NULL OR departure_offset IS DISTINCT FROM 0))
            OR (
                row_number > 1
                AND row_number < row_count
                AND travel IS NOT NULL
                AND previous_departure_offset IS NOT NULL
                AND arrival_offset IS DISTINCT FROM previous_departure_offset + travel
            )
            OR (
                row_number > 1
                AND row_number < row_count
                AND arrival_offset IS NOT NULL
                AND departure_offset IS DISTINCT FROM arrival_offset + COALESCE(waiting, 0)
            )
            OR (
                row_number = row_count
                AND row_count > 1
                AND departure_offset IS NOT NULL
            )
            OR (
                row_number = row_count
                AND row_count > 1
                AND travel IS NOT NULL
                AND previous_departure_offset IS NOT NULL
                AND arrival_offset IS DISTINCT FROM previous_departure_offset + travel
            )
        `,
        [TRAIN_MODE],
    );

    return Number(result.rows[0]?.inconsistent_offset_count ?? 0);
}

async function withTransactionalClient<T>(
    databaseUrl: string,
    execute: boolean,
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
        if (execute) {
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

export async function verifyTrainVariantDepartureTimes(
    client: pg.PoolClient,
): Promise<TrainVariantDepartureVerification> {
    const rows = await loadTrainVariantDepartureCandidates(client);
    const activeRows = rows.filter((row) => row.is_active);

    const missing_items: TrainVariantDepartureVerification["missing_items"] = [];
    const invalid_items: TrainVariantDepartureVerification["invalid_items"] = [];

    let with_canonical_departure_count = 0;

    for (const row of activeRows) {
        const departure = trimToNull(row.departure_time_text);
        if (!departure) {
            missing_items.push({
                route_code: row.route_code,
                variant_code: row.variant_code,
                departure_time_text: row.departure_time_text,
                first_source_time_text: row.first_source_time_text,
                first_source_time_type: row.first_source_time_type,
            });
            continue;
        }

        if (!validateCanonicalTime(departure)) {
            invalid_items.push({
                route_code: row.route_code,
                variant_code: row.variant_code,
                departure_time_text: departure,
            });
            continue;
        }

        with_canonical_departure_count += 1;
    }

    return {
        active_train_variant_count: activeRows.length,
        with_canonical_departure_count,
        missing_departure_count: missing_items.length,
        invalid_departure_count: invalid_items.length,
        non_target_with_departure_count: with_canonical_departure_count,
        inconsistent_offset_count: await countInconsistentTrainTimetableOffsets(client),
        missing_items,
        invalid_items,
    };
}

/** Backfill canonical departure_time_text for eligible active train variants. */
export async function backfillTrainVariantDepartureTime(
    options: BackfillTrainVariantDepartureTimeOptions = {},
): Promise<{ reportPath: string; result: TrainVariantDepartureBackfillResult | null; verification: TrainVariantDepartureVerification | null }> {
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
    const verifyOnly = options.verifyOnly === true;

    if (execute && verifyOnly) {
        throw new Error("Use either --execute or --verify, not both.");
    }

    let result: TrainVariantDepartureBackfillResult | null = null;
    let verification: TrainVariantDepartureVerification | null = null;

    if (verifyOnly) {
        verification = await withTransactionalClient(databaseUrl, false, async (client) =>
            verifyTrainVariantDepartureTimes(client),
        );
    } else {
        result = await withTransactionalClient(databaseUrl, execute, async (client) => {
            const rows = await loadTrainVariantDepartureCandidates(client);
            const plan = buildTrainVariantDepartureBackfillPlan(rows);
            let applied_count = 0;
            let offset_repair: TrainVariantOffsetRepairSummary | null = null;

            if (execute) {
                for (const item of plan.items) {
                    if (item.action !== "update") {
                        continue;
                    }
                    const applied = await applyTrainVariantDepartureBackfill(client, item);
                    if (applied) {
                        applied_count += 1;
                    } else {
                        item.action = "skip";
                        item.reason = "update affected 0 rows; departure_time_text may already be set";
                    }
                }

                const refreshedRows = await loadTrainVariantDepartureCandidates(client);
                offset_repair = await repairTrainVariantTimetableOffsets(client, refreshedRows);
            }

            return {
                ...plan,
                dry_run: !execute,
                executed: execute,
                applied_count,
                offset_repair,
            };
        });

        if (execute) {
            verification = await withTransactionalClient(databaseUrl, false, async (client) =>
                verifyTrainVariantDepartureTimes(client),
            );
        }
    }

    const report = {
        generated_at: new Date().toISOString(),
        mode: TRAIN_MODE,
        result,
        verification,
    };

    const reportOutputPath = reportPath(paths, REPORT_FILENAME);
    fs.writeFileSync(reportOutputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

    return { reportPath: reportOutputPath, result, verification };
}

function parseCliArgs(argv: string[]): BackfillTrainVariantDepartureTimeOptions {
    const options: BackfillTrainVariantDepartureTimeOptions = {};

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
        } else if (arg === "--verify") {
            options.verifyOnly = true;
        }
    }

    return options;
}

function printItem(item: TrainVariantDepartureBackfillItem): void {
    const canonical = item.canonical_departure_time ?? "—";
    const source = item.original_source_time ?? "—";
    const reason = item.reason ? ` (${item.reason})` : "";
    console.log(
        `[${item.action}] ${item.route_code} ${item.variant_code} source=${source} canonical=${canonical}${reason}`,
    );
}

function printSummary(
    reportOutputPath: string,
    result: TrainVariantDepartureBackfillResult | null,
    verification: TrainVariantDepartureVerification | null,
): void {
    console.log(`Report: ${reportOutputPath}`);

    if (result) {
        console.log(result.executed ? "Executed backfill." : "Dry run only (transaction rolled back).");
        console.log(
            `Planned updates: ${result.update_count}, skipped: ${result.skip_count}, errors: ${result.error_count}`,
        );
        if (result.executed) {
            console.log(`Applied updates: ${result.applied_count}`);
            if (result.offset_repair) {
                console.log(
                    `Offset repair: targeted variants ${result.offset_repair.targeted_variant_count}, ` +
                        `repaired variants ${result.offset_repair.repaired_variant_count}, ` +
                        `updated route_stops ${result.offset_repair.updated_route_stop_count}`,
                );
            }
        }

        for (const item of result.items) {
            if (item.action === "update" || item.action === "error") {
                printItem(item);
            }
        }

        const skippedTargets = result.items.filter(
            (item) =>
                item.action === "skip" &&
                item.reason !== "variant is not active" &&
                item.reason !== "departure_time_text already set",
        );
        for (const item of skippedTargets) {
            printItem(item);
        }
    }

    if (verification) {
        console.log("Verification:");
        console.log(`  active train variants: ${verification.active_train_variant_count}`);
        console.log(`  canonical departure_time_text: ${verification.with_canonical_departure_count}`);
        console.log(`  missing departure_time_text: ${verification.missing_departure_count}`);
        console.log(`  invalid departure_time_text: ${verification.invalid_departure_count}`);
        console.log(`  inconsistent route_stop offsets: ${verification.inconsistent_offset_count}`);

        for (const item of verification.missing_items) {
            console.log(
                `  [missing] ${item.route_code} ${item.variant_code} departure=${item.departure_time_text ?? "—"} first_source=${item.first_source_time_text ?? "—"} type=${item.first_source_time_type ?? "—"}`,
            );
        }
        for (const item of verification.invalid_items) {
            console.log(
                `  [invalid] ${item.route_code} ${item.variant_code} departure=${item.departure_time_text}`,
            );
        }
    }
}

export function runBackfillTrainVariantDepartureTimeSelfTest(): void {
    const plan = buildTrainVariantDepartureBackfillPlan([
        {
            variant_id: 1,
            variant_code: "TRAIN-KHA-6-CLOCKWISE",
            route_code: "TRAIN-kha-6",
            is_active: true,
            departure_time_text: null,
            first_source_time_text: "04:45 PM",
            first_source_time_type: "departure",
        },
        {
            variant_id: 2,
            variant_code: "TRAIN-141-UP",
            route_code: "TRAIN-141",
            is_active: true,
            departure_time_text: "16:45",
            first_source_time_text: "04:45 PM",
            first_source_time_type: "departure",
        },
        {
            variant_id: 3,
            variant_code: "TRAIN-BAD",
            route_code: "TRAIN-bad",
            is_active: true,
            departure_time_text: null,
            first_source_time_text: "not a time",
            first_source_time_type: "departure",
        },
        {
            variant_id: 4,
            variant_code: "TRAIN-INACTIVE",
            route_code: "TRAIN-inactive",
            is_active: false,
            departure_time_text: null,
            first_source_time_text: "05:00 AM",
            first_source_time_type: "departure",
        },
        {
            variant_id: 5,
            variant_code: "TRAIN-NO-TYPE",
            route_code: "TRAIN-no-type",
            is_active: true,
            departure_time_text: null,
            first_source_time_text: "05:00 AM",
            first_source_time_type: "arrival",
        },
    ]);

    if (plan.update_count !== 1 || plan.skip_count !== 3 || plan.error_count !== 1) {
        throw new Error(`unexpected plan counts: ${JSON.stringify(plan)}`);
    }

    const update = plan.items.find((item) => item.variant_code === "TRAIN-KHA-6-CLOCKWISE");
    if (!update || update.canonical_departure_time !== "16:45") {
        throw new Error(`unexpected canonical conversion: ${JSON.stringify(update)}`);
    }

    assert.equal(parseSourceTimeToCanonical("12:00 PM"), "12:00");
    assert.equal(parseSourceTimeToCanonical("12:00 AM"), "00:00");
    assert.equal(parseSourceTimeToCanonical("05:00 AM"), "05:00");

    console.log("ok - backfill-train-variant-departure-time self-test");
}

async function main(): Promise<void> {
    const { reportPath: reportOutputPath, result, verification } =
        await backfillTrainVariantDepartureTime(parseCliArgs(process.argv.slice(2)));
    printSummary(reportOutputPath, result, verification);

    if (
        verification &&
        (verification.missing_departure_count > 0 ||
            verification.invalid_departure_count > 0 ||
            verification.inconsistent_offset_count > 0)
    ) {
        process.exitCode = 2;
    }
}

const isCliEntry = process.argv[1]?.includes("backfill-train-variant-departure-time.ts");
const isSelfTestEntry =
    process.argv[1]?.includes("backfill-train-variant-departure-time.ts") &&
    process.argv.includes("--self-test");

if (isSelfTestEntry) {
    runBackfillTrainVariantDepartureTimeSelfTest();
} else if (isCliEntry) {
    main().catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error(message);
        process.exit(1);
    });
}
