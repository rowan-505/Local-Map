import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PrismaClient } from "@prisma/client";

import {
    aggregateRoadBulkValidationOutcomes,
    ImportReviewPromotionRoadsBulkValidation,
    summarizeRoadBulkValidationOutcomes,
} from "./import-review-promotion-roads-bulk-validation.js";
import type { PublishItemValidationTarget } from "./import-review-promotion-simple-batch-validation.js";
import { ImportReviewPromotionSimpleBatchValidation } from "./import-review-promotion-simple-batch-validation.js";

function prismaForBatchValidation(): PrismaClient {
    return {
        $queryRaw: async () => [],
    } as unknown as PrismaClient;
}

function roadTarget(publishItemId: number, candidateId: number): PublishItemValidationTarget {
    return {
        publish_item_id: BigInt(publishItemId),
        entity_family: "roads",
        review_candidate_id: BigInt(candidateId),
        review_batch_id: 2n,
    };
}

describe("aggregateRoadBulkValidationOutcomes", () => {
    it("marks ready when no issues", () => {
        const targets = [roadTarget(1, 101), roadTarget(2, 102)];
        const outcomes = aggregateRoadBulkValidationOutcomes(targets, []);
        assert.equal(outcomes.length, 2);
        assert.equal(outcomes[0]?.status, "ready");
        assert.equal(outcomes[1]?.status, "ready");
    });

    it("marks blocked on errors and warning when only warnings", () => {
        const targets = [roadTarget(1, 101), roadTarget(2, 102)];
        const outcomes = aggregateRoadBulkValidationOutcomes(targets, [
            {
                publish_item_id: 1n,
                code: "missing_external_id",
                message: "external_id is required",
                severity: "error",
                field: "external_id",
            },
            {
                publish_item_id: 2n,
                code: "admin_area_id_missing",
                message: "admin_area_id is not set",
                severity: "warning",
                field: "admin_area_id",
            },
        ]);
        assert.equal(outcomes[0]?.status, "blocked");
        assert.equal(outcomes[1]?.status, "warning");
    });

    it("summarizes top blocked reasons", () => {
        const targets = [roadTarget(1, 101), roadTarget(2, 102), roadTarget(3, 103)];
        const outcomes = aggregateRoadBulkValidationOutcomes(targets, [
            {
                publish_item_id: 1n,
                code: "geometry_missing",
                message: "geom required",
                severity: "error",
                field: "geom",
            },
            {
                publish_item_id: 2n,
                code: "geometry_missing",
                message: "geom required",
                severity: "error",
                field: "geom",
            },
            {
                publish_item_id: 3n,
                code: "missing_external_id",
                message: "external_id required",
                severity: "error",
                field: "external_id",
            },
        ]);
        const summary = summarizeRoadBulkValidationOutcomes(outcomes, 12, 5);
        assert.equal(summary.blocked_count, 3);
        assert.equal(summary.ready_count, 0);
        assert.equal(summary.top_blocked_reasons[0]?.code, "geometry_missing");
        assert.equal(summary.top_blocked_reasons[0]?.count, 2);
    });
});

describe("ImportReviewPromotionRoadsBulkValidation", () => {
    it("reconciles duplicate external_id before validation SQL", async () => {
        const targets = [roadTarget(1, 101)];
        const sqlCalls: string[] = [];
        const prisma = {
            $queryRaw: async (query: unknown) => {
                sqlCalls.push(
                    query &&
                        typeof query === "object" &&
                        "strings" in query &&
                        Array.isArray((query as { strings: string[] }).strings)
                        ? (query as { strings: string[] }).strings.join("?")
                        : String(query)
                );
                if (sqlCalls.length <= 3) {
                    return [];
                }
                return [
                    {
                        publish_item_id: 1n,
                        candidate_id: 101n,
                        validation_status: "ready",
                        error_code: null,
                        error_message: null,
                        validation_warnings: [],
                    },
                ];
            },
            $executeRaw: async () => 0,
        };
        const svc = new ImportReviewPromotionRoadsBulkValidation(prisma as never);
        await svc.validateRoadTargets(targets, { publishBatchId: 32n });
        assert.equal(sqlCalls.length, 4);
        assert.match(sqlCalls[0] ?? "", /matched_auto_update/);
        assert.match(sqlCalls[3] ?? "", /WITH target_items AS/);
    });

    it("validates 10 road targets in one validation SQL round-trip after reconcile", async () => {
        const targets = Array.from({ length: 10 }, (_, i) => roadTarget(i + 1, 10_000 + i));
        let validationCalls = 0;
        const prisma = {
            $queryRaw: async (query: unknown) => {
                const text =
                    query &&
                    typeof query === "object" &&
                    "strings" in query &&
                    Array.isArray((query as { strings: string[] }).strings)
                        ? (query as { strings: string[] }).strings.join("?")
                        : String(query);
                if (text.includes("WITH target_items AS")) {
                    validationCalls += 1;
                    return targets.map((t) => ({
                        publish_item_id: t.publish_item_id,
                        candidate_id: t.review_candidate_id,
                        validation_status: "ready",
                        error_code: null,
                        error_message: null,
                        validation_warnings: [],
                    }));
                }
                return [];
            },
            $executeRaw: async () => 0,
        };

        const svc = new ImportReviewPromotionRoadsBulkValidation(prisma as never);
        const outcomes = await svc.validateRoadTargets(targets, { publishBatchId: 32n });
        assert.equal(validationCalls, 1);
        assert.equal(outcomes.length, 10);
        assert.equal(outcomes.every((o) => o.status === "ready"), true);
    });

    it("validates 276 road targets in one validation SQL round-trip after reconcile", async () => {
        const targets = Array.from({ length: 276 }, (_, i) => roadTarget(i + 1, 10_000 + i));
        let validationCalls = 0;
        const prisma = {
            $queryRaw: async (query: unknown) => {
                const text =
                    query &&
                    typeof query === "object" &&
                    "strings" in query &&
                    Array.isArray((query as { strings: string[] }).strings)
                        ? (query as { strings: string[] }).strings.join("?")
                        : String(query);
                if (text.includes("WITH target_items AS")) {
                    validationCalls += 1;
                }
                return [];
            },
            $executeRaw: async () => 0,
        };

        const svc = new ImportReviewPromotionRoadsBulkValidation(prisma as never);
        const outcomes = await svc.validateRoadTargets(targets, { publishBatchId: 24n });
        assert.equal(validationCalls, 1);
        assert.equal(outcomes.length, 276);
    });
});

describe("ImportReviewPromotionSimpleBatchValidation roads path", () => {
    it("uses bulk validation for roads instead of per-item loop", async () => {
        const targets = Array.from({ length: 50 }, (_, i) => roadTarget(i + 1, 5000 + i));
        const svc = new ImportReviewPromotionSimpleBatchValidation(prismaForBatchValidation());

        svc.listPublishItemTargets = async () => targets;
        let perItemLoadCalls = 0;
        svc.simpleRepo.loadCandidateRowsBatch = async () => {
            perItemLoadCalls += 1;
            return new Map();
        };

        let bulkCalls = 0;
        const chunkSizes: number[] = [];
        svc.roadsBulkValidation.validateRoadTargets = async (roadTargets) => {
            bulkCalls += 1;
            chunkSizes.push(roadTargets.length);
            return roadTargets.map((t) => ({
                publish_item_id: t.publish_item_id,
                entity_family: "roads",
                status: "ready" as const,
                skipped: false,
                result: { status: "ready" as const, errors: [], warnings: [] },
            }));
        };

        const outcomes = await svc.validatePublishBatch(24n);
        assert.equal(outcomes.length, 50);
        assert.equal(bulkCalls, 2);
        assert.deepEqual(chunkSizes, [25, 25]);
        assert.equal(perItemLoadCalls, 0);
    });
});
