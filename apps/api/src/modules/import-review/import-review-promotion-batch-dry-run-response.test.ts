import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    buildPublishBatchDryRunApiResponse,
    systemErrorSample,
} from "./import-review-promotion-batch-dry-run-response.js";
import { runPublishBatchDryRun } from "./import-review-promotion-batch-dry-run.service.js";
import type { PrismaClient } from "@prisma/client";
import { mock } from "node:test";

function queryRawSqlText(sql: unknown): string {
    if (sql && typeof sql === "object" && "strings" in sql && Array.isArray((sql as { strings: unknown }).strings)) {
        const tagged = sql as { strings: string[] };
        return tagged.strings.join("?");
    }
    return String(sql);
}

function createMockPrisma(handlers: {
    batchStatus?: string;
    items?: Array<{
        publish_item_id: bigint;
        entity_family: string;
        publish_action: string;
        publish_status: string;
        validation_result: unknown;
    }>;
    throwOnItemQuery?: boolean;
}): PrismaClient {
    let queryCall = 0;
    const prisma = {
        $queryRaw: mock.fn(async (sql: unknown) => {
            queryCall += 1;
            const text = queryRawSqlText(sql);
            if (text.includes("SELECT summary FROM system.system_publish_batches")) {
                return [{ summary: {} }];
            }
            if (text.includes("SELECT id, status, summary")) {
                return [
                    {
                        id: 29n,
                        status: handlers.batchStatus ?? "ready",
                        summary: { validation_result: { ready_count: 10 } },
                    },
                ];
            }
            if (handlers.throwOnItemQuery && text.includes("system_publish_items") && text.includes("publish_action")) {
                throw new Error("simulated db failure");
            }
            if (text.includes("AS issues")) {
                return [];
            }
            if (text.includes("publish_status = 'pending'") && !text.includes("publish_action")) {
                return (handlers.items ?? [])
                    .filter((row) => row.publish_status === "pending")
                    .map((row) => ({
                        publish_item_id: row.publish_item_id,
                        validation_result: row.validation_result,
                    }));
            }
            if (text.includes("publish_action,")) {
                return handlers.items ?? [];
            }
            return [];
        }),
        $executeRaw: mock.fn(async () => 0),
    } as unknown as PrismaClient;
    return prisma;
}

describe("publish batch dry-run API response", () => {
    it("buildPublishBatchDryRunApiResponse always includes status", () => {
        const response = buildPublishBatchDryRunApiResponse({
            batchId: 29n,
            status: "passed",
            entityFamilies: ["roads"],
            total: 10,
            readyCount: 10,
            blockedCount: 0,
            failedCount: 0,
            wouldInsertCount: 10,
            wouldUpdateCount: 0,
            sampleErrors: [],
            batchStatus: "ready",
            message: "ok",
        });
        assert.equal(response.status, "passed");
        assert.equal(response.batch_id, 29);
        assert.equal(response.entity_family, "roads");
        assert.equal(response.summary.dry_run_result.status, "passed");
    });

    it("dry-run success returns status passed for pending ready roads", async () => {
        const items = Array.from({ length: 10 }, (_, i) => ({
            publish_item_id: BigInt(i + 1),
            entity_family: "roads",
            publish_action: "insert",
            publish_status: "pending",
            validation_result: { status: "ready", errors: [], warnings: [] },
        }));
        const prisma = createMockPrisma({ batchStatus: "ready", items });
        const result = await runPublishBatchDryRun({ prisma, batchId: 29n });
        assert.equal(result.status, "passed");
        assert.equal(result.would_insert_count, 10);
        assert.equal(result.entity_family, "roads");
        assert.equal(result.sample_errors.length, 0);
    });

    it("dry-run validation failure returns status failed without throwing", async () => {
        const items = Array.from({ length: 10 }, (_, i) => ({
            publish_item_id: BigInt(i + 1),
            entity_family: "roads",
            publish_action: "insert",
            publish_status: "pending",
            validation_result: { status: "blocked" },
        }));
        const prisma = createMockPrisma({ batchStatus: "ready", items });
        const result = await runPublishBatchDryRun({ prisma, batchId: 29n });
        assert.equal(result.status, "failed");
        assert.ok(Array.isArray(result.sample_errors));
    });

    it("unexpected Error returns JSON with status failed", async () => {
        const items = Array.from({ length: 10 }, (_, i) => ({
            publish_item_id: BigInt(i + 1),
            entity_family: "roads",
            publish_action: "insert",
            publish_status: "pending",
            validation_result: { status: "ready" },
        }));
        const prisma = createMockPrisma({
            batchStatus: "ready",
            items,
            throwOnItemQuery: true,
        });
        const result = await runPublishBatchDryRun({ prisma, batchId: 29n });
        assert.equal(result.status, "failed");
        assert.equal(result.sample_errors[0]?.code, "dry_run_system_error");
        assert.equal(systemErrorSample("x").code, "dry_run_system_error");
    });
});
