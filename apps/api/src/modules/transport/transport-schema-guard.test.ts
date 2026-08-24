import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PrismaClient } from "@prisma/client";

import { TransportSchemaUnavailableError } from "./transport.errors.js";
import {
    assertTransportSchemaAvailable,
    resetTransportSchemaGuardForTests,
} from "./transport-schema-guard.js";

function mockPrisma(probe: () => Promise<unknown>): PrismaClient {
    return { $queryRaw: probe } as unknown as PrismaClient;
}

describe("assertTransportSchemaAvailable", () => {
    it("coalesces concurrent probes and caches success", async () => {
        let probes = 0;
        const prisma = mockPrisma(async () => {
            probes += 1;
            await Promise.resolve();
            return [{ ok: 1 }];
        });

        await Promise.all([
            assertTransportSchemaAvailable(prisma),
            assertTransportSchemaAvailable(prisma),
            assertTransportSchemaAvailable(prisma),
        ]);
        await assertTransportSchemaAvailable(prisma);

        assert.equal(probes, 1);
        resetTransportSchemaGuardForTests(prisma);
    });

    it("maps a missing transport relation to the domain error", async () => {
        const prisma = mockPrisma(async () => {
            throw new Error('relation "transport.routes" does not exist');
        });

        await assert.rejects(
            assertTransportSchemaAvailable(prisma),
            TransportSchemaUnavailableError,
        );
        resetTransportSchemaGuardForTests(prisma);
    });

    it("does not cache unrelated database failures", async () => {
        let probes = 0;
        const prisma = mockPrisma(async () => {
            probes += 1;
            if (probes === 1) throw new Error("connection reset");
            return [{ ok: 1 }];
        });

        await assert.rejects(assertTransportSchemaAvailable(prisma), /connection reset/);
        await assert.doesNotReject(assertTransportSchemaAvailable(prisma));
        assert.equal(probes, 2);
        resetTransportSchemaGuardForTests(prisma);
    });
});
