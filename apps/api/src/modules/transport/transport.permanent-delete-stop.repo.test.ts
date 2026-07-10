import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import type { PrismaClient } from "@prisma/client";

import { TransportRepository } from "./transport.repo.js";
import {
    TransportNotFoundError,
    TransportStopDeleteBlockedError,
} from "./transport.errors.js";

const STOP_PUBLIC_ID = "11111111-1111-4111-8111-111111111111";

type RawHandler = (arg: unknown, ...rest: unknown[]) => Promise<unknown>;

function extractSql(arg: unknown): string {
    if (Array.isArray(arg)) {
        return arg.join("?");
    }
    if (arg && typeof arg === "object") {
        const obj = arg as Record<string, unknown>;
        if (typeof obj.sql === "string") return obj.sql;
        if (typeof obj.text === "string") return obj.text;
        if (Array.isArray(obj.strings)) return (obj.strings as string[]).join("?");
    }
    return String(arg);
}

type StopDeleteRow = {
    id: bigint;
    public_id: string;
    review_status: string;
    name: string | null;
    mode: string | null;
    stop_type: string | null;
    route_stops_count: bigint;
    variant_endpoints_count: bigint;
    child_stops_count: bigint;
    linked_terminals_count: bigint;
    route_count: bigint;
};

function createMockPrisma(scenario: {
    stopRows: StopDeleteRow[];
    faresStopColumns: boolean;
    fareCount: number;
    executed: string[];
}): PrismaClient {
    const queryRaw: RawHandler = async (arg) => {
        const sql = extractSql(arg);
        if (sql.includes("information_schema.columns")) {
            return [{ exists: scenario.faresStopColumns }];
        }
        if (sql.includes("FROM transport.fares")) {
            return [{ count: BigInt(scenario.fareCount) }];
        }
        if (sql.includes("FROM transport.stops s")) {
            return scenario.stopRows;
        }
        return [];
    };

    const executeRaw: RawHandler = async (arg) => {
        scenario.executed.push(extractSql(arg));
        return 1;
    };

    const client = {
        $queryRaw: mock.fn(queryRaw),
        $executeRaw: mock.fn(executeRaw),
        $transaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn(client),
    };
    return client as unknown as PrismaClient;
}

function makeStopRow(overrides: Partial<StopDeleteRow> = {}): StopDeleteRow {
    return {
        id: 1n,
        public_id: STOP_PUBLIC_ID,
        review_status: "needs_review",
        name: "Sule Stop",
        mode: "bus",
        stop_type: "stop",
        route_stops_count: 0n,
        variant_endpoints_count: 0n,
        child_stops_count: 0n,
        linked_terminals_count: 0n,
        route_count: 0n,
        ...overrides,
    };
}

describe("TransportRepository permanent delete", () => {
    it("reports eligibility when a stop can be deleted", async () => {
        const prisma = createMockPrisma({
            stopRows: [makeStopRow()],
            faresStopColumns: false,
            fareCount: 0,
            executed: [],
        });
        const repo = new TransportRepository(prisma);

        const result = await repo.getStopDeleteEligibilityByPublicId(STOP_PUBLIC_ID);

        assert.equal(result.can_delete, true);
        assert.equal(result.has_route_usage, false);
        assert.deepEqual(result.blockers, []);
    });

    it("blocks verified stops", async () => {
        const prisma = createMockPrisma({
            stopRows: [makeStopRow({ review_status: "verified" })],
            faresStopColumns: false,
            fareCount: 0,
            executed: [],
        });
        const repo = new TransportRepository(prisma);

        const result = await repo.getStopDeleteEligibilityByPublicId(STOP_PUBLIC_ID);

        assert.equal(result.can_delete, false);
        assert.ok(result.blockers.includes("verified"));
        assert.match(result.message, /verified/i);
    });

    it("blocks deletion when route references remain", async () => {
        const prisma = createMockPrisma({
            stopRows: [makeStopRow({ route_stops_count: 2n, route_count: 2n })],
            faresStopColumns: false,
            fareCount: 0,
            executed: [],
        });
        const repo = new TransportRepository(prisma);

        await assert.rejects(
            () => repo.permanentDeleteStopByPublicId(STOP_PUBLIC_ID),
            (error: unknown) => {
                assert.ok(error instanceof TransportStopDeleteBlockedError);
                assert.equal(error.hasRouteUsage, true);
                assert.equal(error.routeCount, 2);
                return true;
            }
        );
    });

    it("hard-deletes an eligible stop and related rows", async () => {
        const executed: string[] = [];
        const prisma = createMockPrisma({
            stopRows: [makeStopRow()],
            faresStopColumns: false,
            fareCount: 0,
            executed,
        });
        const repo = new TransportRepository(prisma);

        const result = await repo.permanentDeleteStopByPublicId(STOP_PUBLIC_ID);

        assert.equal(result.deleted, true);
        assert.equal(result.public_id, STOP_PUBLIC_ID);
        assert.ok(
            executed.some((sql) => sql.includes("DELETE FROM transport.source_links")),
            "expected source_links delete"
        );
        assert.ok(
            executed.some((sql) => sql.includes("DELETE FROM transport.stop_names")),
            "expected stop_names delete"
        );
        assert.ok(
            executed.some((sql) => sql.includes("DELETE FROM transport.stops")),
            "expected stop hard delete"
        );
        assert.ok(
            executed.some((sql) => sql.includes("transport_audit_logs")),
            "expected delete audit row"
        );
    });

    it("returns 404 for a missing stop", async () => {
        const prisma = createMockPrisma({
            stopRows: [],
            faresStopColumns: false,
            fareCount: 0,
            executed: [],
        });
        const repo = new TransportRepository(prisma);

        await assert.rejects(
            () => repo.permanentDeleteStopByPublicId(STOP_PUBLIC_ID),
            (error: unknown) => {
                assert.ok(error instanceof TransportNotFoundError);
                return true;
            }
        );
    });
});
