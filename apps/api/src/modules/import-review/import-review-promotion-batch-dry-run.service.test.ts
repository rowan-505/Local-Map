import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, mock } from "node:test";
import type { PrismaClient } from "@prisma/client";

import { runPublishBatchDryRun } from "./import-review-promotion-batch-dry-run.service.js";

const servicePath = join(
    dirname(fileURLToPath(import.meta.url)),
    "import-review-promotion-batch-dry-run.service.ts"
);

function queryRawSqlText(sql: unknown): string {
    if (sql && typeof sql === "object" && "strings" in sql && Array.isArray((sql as { strings: unknown }).strings)) {
        const tagged = sql as { strings: string[]; values?: unknown[] };
        return tagged.strings.join("?");
    }
    return String(sql);
}

function createMockPrisma(handlers: {
    batchStatus?: string;
    summary?: Record<string, unknown>;
    items?: Array<{
        publish_item_id: bigint;
        entity_family: string;
        publish_action: string;
        publish_status: string;
        validation_result: unknown;
    }>;
}): PrismaClient & { capturedSql: string[] } {
    const capturedSql: string[] = [];
    let queryCall = 0;
    const prisma = {
        $queryRaw: mock.fn(async (sql: unknown) => {
            capturedSql.push(queryRawSqlText(sql));
            queryCall += 1;
            const text = queryRawSqlText(sql);
            if (text.includes("SELECT summary FROM system.system_publish_batches")) {
                return [{ summary: handlers.summary ?? {} }];
            }
            if (text.includes("SELECT id, status, summary")) {
                return [
                    {
                        id: 28n,
                        status: handlers.batchStatus ?? "partial",
                        summary: handlers.summary ?? {
                            validation_result: { ready_count: 10, blocked_count: 0 },
                        },
                    },
                ];
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
        $executeRaw: mock.fn(async (sql: unknown) => {
            capturedSql.push(queryRawSqlText(sql));
            return 0;
        }),
        capturedSql,
    } as unknown as PrismaClient & { capturedSql: string[] };

    return prisma;
}

describe("import-review promotion batch dry-run service", () => {
    it("does not set unsupported batch statuses in source SQL", () => {
        const source = readFileSync(servicePath, "utf8");
        assert.doesNotMatch(source, /\bdry_run_passed\b/);
        assert.doesNotMatch(source, /\bdry_run_running\b/);
        assert.doesNotMatch(source, /\bpartially_promoted\b/);
        assert.doesNotMatch(source, /\bupdated_at\b.*system_publish_batches/s);
    });

    it("runs dry-run for partial batch and returns status passed", async () => {
        const items = Array.from({ length: 10 }, (_, i) => ({
            publish_item_id: BigInt(i + 1),
            entity_family: "roads",
            publish_action: "insert",
            publish_status: i < 8 ? "success" : "pending",
            validation_result: { status: "ready", errors: [], warnings: [] },
        }));

        const prisma = createMockPrisma({
            batchStatus: "partial",
            summary: { validation_result: { ready_count: 10, blocked_count: 0 } },
            items,
        });

        const result = await runPublishBatchDryRun({ prisma, batchId: 28n });

        assert.equal(result.status, "passed");
        assert.equal(result.batch_id, 28);
        assert.equal(result.entity_family, "roads");
        assert.equal(result.total, 10);
        assert.equal(result.would_insert_count, 2);

        const publishBatchSql = prisma.capturedSql
            .filter((s) => s.includes("UPDATE system.system_publish_batches"))
            .join("\n");
        assert.doesNotMatch(publishBatchSql, /\bSET\s+status\s*=/i);
        assert.doesNotMatch(publishBatchSql, /\bupdated_at\b/i);
    });

    it("returns status failed for closed batch without throwing", async () => {
        const prisma = createMockPrisma({
            batchStatus: "failed",
            summary: { validation_result: { ready_count: 2, blocked_count: 8 } },
            items: Array.from({ length: 10 }, (_, i) => ({
                publish_item_id: BigInt(i + 1),
                entity_family: "roads",
                publish_action: "insert",
                publish_status: "failed",
                validation_result: { status: "ready" },
            })),
        });

        const result = await runPublishBatchDryRun({ prisma, batchId: 28n });
        assert.equal(result.status, "failed");
        assert.match(result.sample_errors[0]?.message ?? "", /failed and is closed/i);
    });

    it("returns status failed when validation ready but no pending promotable items", async () => {
        const prisma = createMockPrisma({
            batchStatus: "partial",
            summary: { validation_result: { ready_count: 2, blocked_count: 8 } },
            items: Array.from({ length: 10 }, (_, i) => ({
                publish_item_id: BigInt(i + 1),
                entity_family: "roads",
                publish_action: "insert",
                publish_status: "failed",
                validation_result: { status: i < 2 ? "ready" : "blocked" },
            })),
        });

        const result = await runPublishBatchDryRun({ prisma, batchId: 28n });
        assert.equal(result.status, "failed");
        assert.equal(result.sample_errors[0]?.code, "dry_run_not_eligible");
    });
});
