import assert from "node:assert/strict";
import test from "node:test";

import type { PrismaClient } from "@prisma/client";

import { UnifiedSearchSyncRepository } from "./unified-search-sync.repo.js";
import {
    refreshUnifiedSearchDocuments,
    scheduleUnifiedSearchDocuments,
} from "./unified-search-sync.js";

function createMockPrisma(handlers: {
    sync?: (entityType: string, entityIds: bigint[]) => Promise<unknown>;
    syncStreet?: (streetId: bigint) => Promise<unknown>;
    refreshAliases?: (entityType: string, entityIds: bigint[]) => Promise<unknown>;
}) {
    return {
        $queryRaw: async (query: unknown) => {
            const sql = Array.isArray(query)
                ? query.join("")
                : typeof query === "string"
                  ? query
                  : JSON.stringify(query);

            if (sql.includes("sync_street_group_for_street")) {
                const streetId = BigInt(42);
                return [{ sync_street_group_for_street: await handlers.syncStreet?.(streetId) }];
            }

            if (sql.includes("refresh_search_aliases")) {
                const entityType = "place";
                const entityIds = [BigInt(7)];
                return [
                    {
                        refresh_search_aliases: await handlers.refreshAliases?.(
                            entityType,
                            entityIds,
                        ),
                    },
                ];
            }

            if (sql.includes("sync_search_documents")) {
                const entityType = "place";
                const entityIds = [BigInt(7)];
                return [
                    {
                        sync_search_documents: await handlers.sync?.(entityType, entityIds),
                    },
                ];
            }

            throw new Error(`unexpected query: ${sql}`);
        },
    } as unknown as PrismaClient;
}

test("refreshUnifiedSearchDocuments syncs create/update lifecycle for one place id", async () => {
    const calls: Array<{ entityType: string; entityIds: bigint[] }> = [];
    const prisma = createMockPrisma({
        sync: async (entityType, entityIds) => {
            calls.push({ entityType, entityIds });
            return { entity_type: entityType, synced: 1, removed: 0, entity_ids: entityIds };
        },
    });

    await refreshUnifiedSearchDocuments(prisma, [
        { entityType: "place", entityId: 7n },
    ]);

    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.entityType, "place");
    assert.deepEqual(calls[0]?.entityIds, [7n]);
});

test("refreshUnifiedSearchDocuments logs and does not throw when sync fails", async () => {
    const warnings: Array<Record<string, unknown>> = [];
    const prisma = createMockPrisma({
        sync: async () => {
            throw new Error("db unavailable");
        },
    });

    await assert.doesNotReject(async () =>
        refreshUnifiedSearchDocuments(
            prisma,
            [{ entityType: "place", entityId: 7n }],
            {
                warn: (obj) => {
                    warnings.push(obj);
                },
            },
        ),
    );

    assert.equal(warnings.length, 1);
    assert.match(String(warnings[0]?.err), /db unavailable/);
});

test("scheduleUnifiedSearchDocuments does not block caller", () => {
    const prisma = createMockPrisma({
        sync: async () => ({ entity_type: "place", synced: 1, removed: 0, entity_ids: [9] }),
    });

    scheduleUnifiedSearchDocuments(prisma, [{ entityType: "place", entityId: 9n }]);
});

test("refreshUnifiedSearchDocuments dedupes specs before SQL call", async () => {
    let callCount = 0;
    const prisma = {
        $queryRaw: async () => {
            callCount += 1;
            return [
                {
                    sync_search_documents: {
                        entity_type: "transport_stop",
                        synced: 1,
                        removed: 0,
                        entity_ids: [1, 2],
                    },
                },
            ];
        },
    } as unknown as PrismaClient;

    await refreshUnifiedSearchDocuments(prisma, [
        { entityType: "transport_stop", entityId: 1n },
        { entityType: "transport_stop", entityId: 1n },
        { entityType: "transport_stop", entityId: 2n },
    ]);
    assert.equal(callCount, 1);
});

test("rename and delete flows call the same incremental sync entrypoint", async () => {
    const entityIds: bigint[] = [];
    const prisma = createMockPrisma({
        sync: async (_entityType, ids) => {
            entityIds.push(...ids);
            return {
                entity_type: "place",
                synced: 0,
                removed: entityIds.length > 1 ? 1 : 0,
                entity_ids: ids,
            };
        },
    });

    await refreshUnifiedSearchDocuments(prisma, [{ entityType: "place", entityId: 7n }]);
    await refreshUnifiedSearchDocuments(prisma, [{ entityType: "place", entityId: 7n }]);
    await refreshUnifiedSearchDocuments(prisma, [{ entityType: "place", entityId: 7n }]);

    assert.deepEqual(entityIds, [7n, 7n, 7n]);
});

test("inactive/delete path removes document when source row is absent", async () => {
    const prisma = createMockPrisma({
        sync: async () => ({
            entity_type: "bus_stop",
            synced: 0,
            removed: 1,
            entity_ids: [99],
        }),
    });

    const repo = new UnifiedSearchSyncRepository(prisma);
    const result = await repo.syncDocuments("transport_stop", [99n]);
    assert.equal(result.removed, 1);
    assert.equal(result.synced, 0);
});

test("refreshSearchAliases calls search.refresh_search_aliases SQL function", async () => {
    const calls: Array<{ entityType: string; entityIds: bigint[] }> = [];
    const prisma = createMockPrisma({
        refreshAliases: async (entityType, entityIds) => {
            calls.push({ entityType, entityIds });
            return {
                entity_type: entityType,
                entity_ids: entityIds.map(String),
                names_removed: 0,
                names_added: 4,
                documents_updated: 1,
            };
        },
    });

    const repo = new UnifiedSearchSyncRepository(prisma);
    const result = await repo.refreshSearchAliases("place", [7n]);

    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.entityType, "place");
    assert.deepEqual(calls[0]?.entityIds, [7n]);
    assert.equal(result.names_added, 4);
    assert.equal(result.documents_updated, 1);
});
