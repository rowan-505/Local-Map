import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@prisma/client";

import { extractPrismaRawQueryErrorDetails } from "./import-review-prisma-raw-error.js";
import { buildPublishItemValidationResultJson } from "./import-review-promotion-publish-item-validation.js";
import { ImportReviewPromotionValidationRepository } from "./import-review-promotion-validation.repo.js";
import {
    hasPublishBatchValidationControlColumns,
    resetPublishBatchValidationControlColumnsCache,
} from "./import-review-publish-batch-validation-control-columns.js";

describe("import-review promotion validation DB contract", () => {
    it("extractPrismaRawQueryErrorDetails surfaces missing-column SQLSTATE 42703", () => {
        const details = extractPrismaRawQueryErrorDetails(
            new Prisma.PrismaClientKnownRequestError("Raw query failed", {
                code: "P2010",
                clientVersion: "test",
                meta: {
                    code: "42703",
                    message: 'column "validation_heartbeat_at" does not exist',
                },
            })
        );
        assert.ok(details);
        assert.equal(details.prisma_code, "P2010");
        assert.equal(details.sqlstate, "42703");
        assert.equal(details.column_name, "validation_heartbeat_at");
        assert.match(details.database_message ?? "", /does not exist/);
    });

    it("buildPublishItemValidationResultJson stores ready, warning, and blocked in validation_result shape", () => {
        for (const status of ["ready", "warning", "blocked"] as const) {
            const json = buildPublishItemValidationResultJson({
                status,
                errors: status === "blocked" ? [{ code: "x", message: "blocked" }] : [],
                warnings: status === "warning" ? [{ code: "w", message: "warn" }] : [],
            });
            assert.equal(json.status, status);
            const serialized = JSON.stringify(json);
            assert.match(serialized, new RegExp(`"status":"${status}"`));
        }
    });

    it("fetchBatchProgress works when validation control columns are absent (batch-18 progress shape)", async () => {
        const calls: string[] = [];
        const prisma = {
            $queryRaw: async (strings: TemplateStringsArray) => {
                const sql = strings.join("?");
                calls.push(sql);
                if (sql.includes("information_schema.columns")) {
                    return [{ present: false }];
                }
                return [
                    {
                        id: 18n,
                        status: "failed",
                        validation_total: 37,
                        validation_done: 12,
                        validation_percent: 32.4,
                        validated_at: null,
                        validation_heartbeat_at: null,
                        validation_cancel_requested_at: null,
                        promoted_at: null,
                        summary: { validation_error: "chunk failed" },
                    },
                ];
            },
            $executeRaw: async () => undefined,
        } as unknown as import("@prisma/client").PrismaClient;

        resetPublishBatchValidationControlColumnsCache();
        const repo = new ImportReviewPromotionValidationRepository(prisma);
        const row = await repo.fetchBatchProgress(18n);
        assert.equal(row?.status, "failed");
        assert.equal(row?.validation_total, 37);
        assert.equal(row?.validation_heartbeat_at, null);
        assert.equal(row?.validation_cancel_requested_at, null);
        assert.ok(
            calls.some((c) => c.includes("NULL::timestamptz AS validation_heartbeat_at")),
            "progress query must not reference missing columns"
        );
    });

    it("claimBatchForValidation draft→validating without validation control columns", async () => {
        const executeSql: string[] = [];
        const prisma = {
            $queryRaw: async (strings: TemplateStringsArray) => {
                const sql = strings.join("?");
                if (sql.includes("information_schema.columns")) {
                    return [{ present: false }];
                }
                if (sql.trimStart().startsWith("UPDATE")) {
                    executeSql.push(sql);
                    return [{ id: 18n, status: "validating" }];
                }
                return [];
            },
            $executeRaw: async () => undefined,
        } as unknown as import("@prisma/client").PrismaClient;

        resetPublishBatchValidationControlColumnsCache();
        const repo = new ImportReviewPromotionValidationRepository(prisma);
        const claim = await repo.claimBatchForValidation(18n);
        assert.equal(claim.claimed, true);
        assert.equal(claim.status, "validating");
        assert.ok(executeSql.length >= 1);
        assert.ok(!executeSql.some((s) => s.includes("validation_heartbeat_at")));
    });

    it("finalizeBatch uses allowed batch status ready, partial, or blocked", async () => {
        const statuses: string[] = [];
        const prisma = {
            $queryRaw: async () => [{ present: false }],
            $executeRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
                const sql = strings.join("?");
                if (sql.includes("status =")) {
                    statuses.push(String(values[0]));
                }
            },
        } as unknown as import("@prisma/client").PrismaClient;

        resetPublishBatchValidationControlColumnsCache();
        const repo = new ImportReviewPromotionValidationRepository(prisma);
        await repo.finalizeBatch({
            batchId: 18n,
            status: "ready",
            validationTotal: 37,
            summary: { validation_result: { ready_count: 37 } },
        });
        await repo.finalizeBatch({
            batchId: 18n,
            status: "partial",
            validationTotal: 37,
            summary: { validation_result: { blocked_count: 2, promotable_count: 35 } },
        });
        await repo.finalizeBatch({
            batchId: 18n,
            status: "partial",
            validationTotal: 2,
            summary: { validation_result: { blocked_count: 2 } },
        });
        assert.deepEqual(statuses, ["ready", "partial", "partial"]);
    });

    it("hasPublishBatchValidationControlColumns reads information_schema once when cached", async () => {
        let schemaQueries = 0;
        const prisma = {
            $queryRaw: async (strings: TemplateStringsArray) => {
                if (strings.join("?").includes("information_schema.columns")) {
                    schemaQueries += 1;
                    return [{ present: true }];
                }
                return [];
            },
        } as unknown as import("@prisma/client").PrismaClient;

        resetPublishBatchValidationControlColumnsCache();
        assert.equal(await hasPublishBatchValidationControlColumns(prisma), true);
        assert.equal(await hasPublishBatchValidationControlColumns(prisma), true);
        assert.equal(schemaQueries, 1);
        resetPublishBatchValidationControlColumnsCache();
    });
});
