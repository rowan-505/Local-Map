import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PrismaClient } from "@prisma/client";

import { TransportRepository } from "./transport.repo.js";
import {
    calculateVariantTimetableSchedule,
    variantTimetableScheduleToOffsets,
} from "./transport-timetable.js";

const VARIANT_ID = 50n;
const VARIANT_PUBLIC_ID = "50b1a519-0a09-44cd-915e-2fde04bee02f";
const TARGET_ROUTE_STOP_ID = 100n;

type TimingRow = {
    id: bigint;
    travel_time_from_previous_seconds: number | null;
    waiting_time_seconds: number | null;
    arrival_offset_seconds: number | null;
    departure_offset_seconds: number | null;
};

function extractSql(arg: unknown): string {
    if (Array.isArray(arg)) return arg.join("?");
    if (arg && typeof arg === "object") {
        const obj = arg as Record<string, unknown>;
        if (typeof obj.sql === "string") return obj.sql;
        if (typeof obj.text === "string") return obj.text;
        if (Array.isArray(obj.strings)) return (obj.strings as string[]).join("?");
    }
    return String(arg);
}

function bulkValues(arg: unknown): unknown[] {
    if (arg && typeof arg === "object" && Array.isArray((arg as { values?: unknown[] }).values)) {
        return (arg as { values: unknown[] }).values;
    }
    return [];
}

function createMockPrisma(initial: TimingRow[]) {
    const rows: TimingRow[] = initial.map((r) => ({ ...r }));
    let schemaChecks = 0;
    let batchOffsetUpdates = 0;
    let singleOffsetUpdates = 0;
    let lastBatchValues: unknown[] = [];

    const queryRaw = async (arg: unknown, ...rest: unknown[]): Promise<unknown> => {
        const sql = extractSql(arg);
        if (sql.includes("FROM transport.routes LIMIT 1") || sql.includes("SELECT 1 FROM transport.routes")) {
            schemaChecks += 1;
            return [{ "?column?": 1 }];
        }
        if (sql.includes("arrival_offset_seconds") && sql.includes("FOR UPDATE") === false && sql.includes("travel_time_from_previous")) {
            // initial lock of single route stop for timing edit
            const id = rest[0] ?? TARGET_ROUTE_STOP_ID;
            const row = rows.find((r) => String(r.id) === String(id));
            if (!row) return [];
            return [
                {
                    id: row.id,
                    route_variant_id: VARIANT_ID,
                    travel_time_from_previous_seconds: row.travel_time_from_previous_seconds,
                    waiting_time_seconds: row.waiting_time_seconds,
                    arrival_offset_seconds: row.arrival_offset_seconds,
                    departure_offset_seconds: row.departure_offset_seconds,
                },
            ];
        }
        if (sql.includes("route_variants") && sql.includes("public_id")) {
            return [{ public_id: VARIANT_PUBLIC_ID }];
        }
        if (sql.includes("ORDER BY stop_sequence ASC") && sql.includes("FOR UPDATE")) {
            return rows.map((r) => ({
                id: r.id,
                travel_time_from_previous_seconds: r.travel_time_from_previous_seconds,
                waiting_time_seconds: r.waiting_time_seconds,
            }));
        }
        if (sql.includes("JOIN transport.stops") || sql.includes("listOrdered") || sql.includes("stop_public_id")) {
            return rows.map((r, idx) => ({
                route_stop_id: String(r.id),
                stop_public_id: `00000000-0000-4000-8000-${String(r.id).padStart(12, "0")}`,
                stop_sequence: idx + 1,
                display_name: `Stop ${r.id}`,
                name_mm: null,
                name_en: `Stop ${r.id}`,
                mode: "bus",
                stop_type: "stop",
                longitude: null,
                latitude: null,
                pickup_type: 0,
                drop_off_type: 0,
                is_timing_point: false,
                travel_time_from_previous_seconds: r.travel_time_from_previous_seconds,
                waiting_time_seconds: r.waiting_time_seconds,
                arrival_offset_seconds: r.arrival_offset_seconds,
                departure_offset_seconds: r.departure_offset_seconds,
            }));
        }
        if (sql.includes("FROM transport.route_stops") && sql.includes("FOR UPDATE")) {
            const id = rest[0] ?? TARGET_ROUTE_STOP_ID;
            const row = rows.find((r) => String(r.id) === String(id));
            if (!row) return [];
            return [
                {
                    id: row.id,
                    route_variant_id: VARIANT_ID,
                    travel_time_from_previous_seconds: row.travel_time_from_previous_seconds,
                    waiting_time_seconds: row.waiting_time_seconds,
                    arrival_offset_seconds: row.arrival_offset_seconds,
                    departure_offset_seconds: row.departure_offset_seconds,
                },
            ];
        }
        if (sql.includes("route_variants")) {
            return [{ id: VARIANT_ID, public_id: VARIANT_PUBLIC_ID, has_path: false }];
        }
        if (sql.includes("count(*)")) {
            return [{ count: BigInt(rows.length) }];
        }
        if (sql.includes("route_paths")) {
            return [];
        }
        return [];
    };

    const executeRaw = async (arg: unknown, ...rest: unknown[]): Promise<number> => {
        const sql = extractSql(arg);
        if (sql.includes("FROM (VALUES") && sql.includes("arrival_offset_seconds")) {
            batchOffsetUpdates += 1;
            lastBatchValues = bulkValues(arg);
            // VALUES are (id, arrival, departure) triples
            for (let i = 0; i + 2 < lastBatchValues.length; i += 3) {
                const id = String(lastBatchValues[i]);
                const arrivalRaw = lastBatchValues[i + 1];
                const departureRaw = lastBatchValues[i + 2];
                const arrival =
                    arrivalRaw === null || arrivalRaw === undefined ? null : Number(arrivalRaw);
                const departure =
                    departureRaw === null || departureRaw === undefined
                        ? null
                        : Number(departureRaw);
                const row = rows.find((r) => String(r.id) === id);
                if (row) {
                    row.arrival_offset_seconds = arrival;
                    row.departure_offset_seconds = departure;
                }
            }
            return rows.length;
        }
        if (sql.includes("arrival_offset_seconds") && sql.includes("WHERE id")) {
            singleOffsetUpdates += 1;
            return 1;
        }
        if (sql.includes("travel_time_from_previous_seconds") || sql.includes("waiting_time_seconds")) {
            const target = rows.find((r) => String(r.id) === String(TARGET_ROUTE_STOP_ID));
            if (target) {
                // best-effort: rest params vary; set from known patch in test
                if (rest.length >= 1 && typeof rest[0] === "number") {
                    target.travel_time_from_previous_seconds = rest[0] as number;
                }
            }
            return 1;
        }
        if (sql.includes("INSERT INTO") && sql.includes("audit")) {
            return 1;
        }
        return 1;
    };

    const client = {
        $queryRaw: queryRaw,
        $executeRaw: executeRaw,
        $transaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn(client),
    };

    return {
        client: client as unknown as PrismaClient,
        rows,
        stats: () => ({
            schemaChecks,
            batchOffsetUpdates,
            singleOffsetUpdates,
            lastBatchValues,
        }),
    };
}

function buildStops(count: number): TimingRow[] {
    return Array.from({ length: count }, (_, i) => ({
        id: BigInt(100 + i),
        travel_time_from_previous_seconds: i === 0 ? 0 : 60,
        waiting_time_seconds: 0,
        arrival_offset_seconds: null,
        departure_offset_seconds: null,
    }));
}

describe("TransportRepository.updateRouteStopTiming batched offsets", () => {
    it("writes all offsets in one VALUES UPDATE for 10 stops", async () => {
        const initial = buildStops(10);
        const expected = variantTimetableScheduleToOffsets(
            calculateVariantTimetableSchedule({
                departureTimeText: null,
                stops: initial.map((r) => ({
                    id: r.id,
                    travel_time_from_previous_seconds: r.travel_time_from_previous_seconds,
                    waiting_time_seconds: r.waiting_time_seconds,
                })),
            }),
        );
        // After patching stop 0 travel time stays same — offsets match initial schedule.
        const mock = createMockPrisma(initial);
        const repo = new TransportRepository(mock.client);

        // Bypass schema probe if needed by stubbing assertSchemaAvailable via a prior call pattern:
        // TransportRepository.assertSchemaAvailable queries transport.routes — mock handles it.
        await repo.updateRouteStopTiming(TARGET_ROUTE_STOP_ID, {
            travel_time_from_previous_seconds: 0,
            waiting_time_seconds: 0,
        });

        const stats = mock.stats();
        assert.equal(stats.batchOffsetUpdates, 1, "expected exactly one batched offset UPDATE");
        assert.equal(stats.singleOffsetUpdates, 0, "must not use per-row offset UPDATEs");
        assert.equal(mock.rows.length, 10);
        for (let i = 0; i < mock.rows.length; i += 1) {
            assert.equal(mock.rows[i]!.arrival_offset_seconds, expected[i]!.arrival_offset_seconds);
            assert.equal(mock.rows[i]!.departure_offset_seconds, expected[i]!.departure_offset_seconds);
        }
    });

    it("batches 50 stops in a single offset UPDATE", async () => {
        const mock = createMockPrisma(buildStops(50));
        const repo = new TransportRepository(mock.client);
        await repo.updateRouteStopTiming(TARGET_ROUTE_STOP_ID, {
            travel_time_from_previous_seconds: 0,
        });
        const stats = mock.stats();
        assert.equal(stats.batchOffsetUpdates, 1);
        assert.equal(stats.singleOffsetUpdates, 0);
        assert.equal(stats.lastBatchValues.length, 50 * 3);
    });
});
