import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import type { PrismaClient } from "@prisma/client";

import { TransportRepository } from "./transport.repo.js";
import { TransportNotFoundError, TransportStopInUseError } from "./transport.errors.js";

const STOP_PUBLIC_ID = "11111111-1111-4111-8111-111111111111";

type RawHandler = (arg: unknown, ...rest: unknown[]) => Promise<unknown>;

/** Best-effort SQL text from either a tagged-template array or a Prisma.Sql object. */
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

type StopRow = {
    id: bigint;
    public_id: string;
    name: string | null;
    mode: string | null;
    stop_type: string | null;
    is_active: boolean;
};

type TerminalRow = {
    id: bigint;
    public_id: string;
    terminal_code: string | null;
    terminal_role: string | null;
    name: string | null;
    is_active: boolean;
};

/**
 * Builds a mock PrismaClient that routes archive queries by SQL keyword. The
 * `$transaction` runs its callback with the same client (matching the import-review
 * repo test pattern), so tagged-template `$queryRaw` / `$executeRaw` and the
 * Prisma.sql audit inserts all hit these handlers.
 */
function createMockPrisma(scenario: {
    stopRows: StopRow[];
    routeCount: number;
    terminalRows: TerminalRow[];
    executed: string[];
}): PrismaClient {
    const queryRaw: RawHandler = async (arg) => {
        const sql = extractSql(arg);
        if (sql.includes("count(DISTINCT v.route_id)")) {
            return [{ route_count: BigInt(scenario.routeCount) }];
        }
        if (sql.includes("FROM transport.stops")) {
            return scenario.stopRows;
        }
        if (sql.includes("FROM transport.terminals")) {
            return scenario.terminalRows;
        }
        // assertSchemaAvailable: SELECT 1 FROM transport.routes LIMIT 1
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

function makeStopRow(): StopRow {
    return {
        id: 1n,
        public_id: STOP_PUBLIC_ID,
        name: "Sule Stop",
        mode: "bus",
        stop_type: "stop",
        is_active: true,
    };
}

describe("TransportRepository.archiveStopByPublicId", () => {
    it("archives an unused stop with no linked terminal", async () => {
        const executed: string[] = [];
        const prisma = createMockPrisma({
            stopRows: [makeStopRow()],
            routeCount: 0,
            terminalRows: [],
            executed,
        });
        const repo = new TransportRepository(prisma);

        const result = await repo.archiveStopByPublicId(STOP_PUBLIC_ID);

        assert.equal(result.archived, true);
        assert.equal(result.public_id, STOP_PUBLIC_ID);
        assert.equal(result.route_count, 0);
        assert.deepEqual(result.archived_terminals, []);

        // The stop is soft-deleted (deleted_at + is_active) and audited; no terminal update.
        assert.ok(
            executed.some((s) => s.includes("UPDATE transport.stops") && s.includes("deleted_at")),
            "expected a soft-delete UPDATE on transport.stops"
        );
        assert.ok(
            !executed.some((s) => s.includes("UPDATE transport.terminals")),
            "did not expect a terminal update when no terminal is linked"
        );
        assert.ok(
            executed.some((s) => s.includes("transport_audit_logs")),
            "expected an archive audit row"
        );
    });

    it("archives an unused stop with a reason (soft-delete + audit)", async () => {
        const executed: string[] = [];
        const prisma = createMockPrisma({
            stopRows: [makeStopRow()],
            routeCount: 0,
            terminalRows: [],
            executed,
        });
        const repo = new TransportRepository(prisma);

        const result = await repo.archiveStopByPublicId(
            STOP_PUBLIC_ID,
            undefined,
            "test cleanup"
        );

        assert.equal(result.archived, true);
        assert.equal(result.route_count, 0);
        assert.deepEqual(result.archived_terminals, []);
        // A reason must not change the soft-delete behaviour: deleted_at + is_active
        // and the archive audit row are still written.
        assert.ok(
            executed.some((s) => s.includes("UPDATE transport.stops") && s.includes("deleted_at")),
            "expected a soft-delete UPDATE on transport.stops"
        );
        assert.ok(
            executed.some((s) => s.includes("transport_audit_logs")),
            "expected an archive audit row"
        );
    });

    it("archives the linked terminal in the same transaction", async () => {
        const executed: string[] = [];
        const prisma = createMockPrisma({
            stopRows: [makeStopRow()],
            routeCount: 0,
            terminalRows: [
                {
                    id: 10n,
                    public_id: "22222222-2222-4222-8222-222222222222",
                    terminal_code: "T-1",
                    terminal_role: "terminal",
                    name: "Sule Terminal",
                    is_active: true,
                },
            ],
            executed,
        });
        const repo = new TransportRepository(prisma);

        const result = await repo.archiveStopByPublicId(STOP_PUBLIC_ID, undefined, "duplicate");

        assert.equal(result.archived, true);
        assert.deepEqual(result.archived_terminals, ["22222222-2222-4222-8222-222222222222"]);
        assert.ok(
            executed.some(
                (s) => s.includes("UPDATE transport.terminals") && s.includes("deleted_at")
            ),
            "expected a soft-delete UPDATE on transport.terminals"
        );
        assert.ok(
            executed.some((s) => s.includes("UPDATE transport.stops") && s.includes("deleted_at")),
            "expected a soft-delete UPDATE on transport.stops"
        );
    });

    it("rejects archiving a stop still used by routes (409)", async () => {
        const executed: string[] = [];
        const prisma = createMockPrisma({
            stopRows: [makeStopRow()],
            routeCount: 3,
            terminalRows: [],
            executed,
        });
        const repo = new TransportRepository(prisma);

        await assert.rejects(
            () => repo.archiveStopByPublicId(STOP_PUBLIC_ID),
            (error: unknown) => {
                assert.ok(error instanceof TransportStopInUseError);
                assert.equal(error.routeCount, 3);
                assert.match(error.message, /still used by routes/i);
                return true;
            }
        );

        // The stop must NOT be soft-deleted when it is still in use.
        assert.ok(
            !executed.some((s) => s.includes("UPDATE transport.stops")),
            "must not soft-delete a stop that is still used by routes"
        );
    });

    it("returns 404 for a missing (or already archived) stop", async () => {
        const executed: string[] = [];
        const prisma = createMockPrisma({
            stopRows: [],
            routeCount: 0,
            terminalRows: [],
            executed,
        });
        const repo = new TransportRepository(prisma);

        await assert.rejects(
            () => repo.archiveStopByPublicId(STOP_PUBLIC_ID),
            (error: unknown) => {
                assert.ok(error instanceof TransportNotFoundError);
                assert.equal(error.entity, "stop");
                return true;
            }
        );

        assert.equal(executed.length, 0, "no writes should occur for a missing stop");
    });
});
