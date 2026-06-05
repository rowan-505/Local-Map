import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import type { PrismaClient } from "@prisma/client";

import {
    ROAD_DUPLICATE_INSERT_TO_UPDATE_MESSAGE,
    reconcileRoadDuplicateExternalIds,
    resolveRoadPromotionActionForPublishItem,
} from "./import-review-promotion-road-duplicate-external-id.js";
import { roadValidationSqlRowToOutcome } from "./import-review-promotion-roads-validate-sql.js";

function queryRawSqlText(sql: unknown): string {
    if (
        sql &&
        typeof sql === "object" &&
        "strings" in sql &&
        Array.isArray((sql as { strings: unknown }).strings)
    ) {
        return (sql as { strings: string[] }).strings.join("?");
    }
    return String(sql);
}

function prismaForReconcile(handlers: {
    converted?: Array<{ id: bigint; external_id: string; core_street_id: bigint }>;
    blocked?: Array<{ id: bigint; external_id: string; core_street_id: bigint }>;
    inReviewDup?: Array<{ id: bigint; external_id: string }>;
    syncCount?: number;
}): PrismaClient {
    let call = 0;
    return {
        $queryRaw: mock.fn(async (sql: unknown) => {
            const text = queryRawSqlText(sql);
            call += 1;
            if (text.includes("matched_auto_update")) {
                return handlers.converted ?? [];
            }
            if (text.includes("duplicate_candidate") && text.includes("skip_candidate")) {
                return handlers.blocked ?? [];
            }
            if (text.includes("losers AS")) {
                return handlers.inReviewDup ?? [];
            }
            return [];
        }),
        $executeRaw: mock.fn(async () => handlers.syncCount ?? 0),
    } as unknown as PrismaClient;
}

describe("reconcileRoadDuplicateExternalIds", () => {
    it("converts approved insert_candidate with existing core external_id to update_candidate", async () => {
        const prisma = prismaForReconcile({
            converted: [
                {
                    id: 55n,
                    external_id: "osm:W:605385942",
                    core_street_id: 495n,
                },
            ],
            syncCount: 1,
        });

        const result = await reconcileRoadDuplicateExternalIds(prisma, {
            reviewBatchId: 2n,
            candidateIds: [55n],
        });

        assert.equal(result.core_converted_count, 1);
        assert.equal(result.core_blocked_count, 0);
        assert.equal(result.samples[0]?.action, "converted_to_update");
        assert.equal(result.samples[0]?.message, ROAD_DUPLICATE_INSERT_TO_UPDATE_MESSAGE);
        assert.equal(result.samples[0]?.core_street_id, 495n);
    });

    it("blocks pending insert_candidate when core external_id already exists", async () => {
        const prisma = prismaForReconcile({
            blocked: [
                {
                    id: 580n,
                    external_id: "osm:W:605345640",
                    core_street_id: 496n,
                },
            ],
        });

        const result = await reconcileRoadDuplicateExternalIds(prisma, {
            reviewBatchId: 2n,
            candidateIds: [580n],
        });

        assert.equal(result.core_converted_count, 0);
        assert.equal(result.core_blocked_count, 1);
        assert.equal(result.samples[0]?.action, "blocked_duplicate");
    });
});

describe("resolveRoadPromotionActionForPublishItem", () => {
    it("returns update when active core row exists for candidate external_id", async () => {
        const prisma = {
            $queryRaw: mock.fn(async (sql: unknown) => {
                const text = queryRawSqlText(sql);
                if (text.includes("spi.publish_action")) {
                    return [
                        {
                            publish_action: "insert",
                            auto_action: "insert_candidate",
                            matched_core_id: null,
                        },
                    ];
                }
                if (text.includes("AS exists")) {
                    return [{ exists: true }];
                }
                return [];
            }),
        } as unknown as PrismaClient;

        const action = await resolveRoadPromotionActionForPublishItem(prisma, 33n, 9001n);
        assert.equal(action, "update");
    });

    it("returns insert when no core duplicate and candidate is insert", async () => {
        const prisma = {
            $queryRaw: mock.fn(async (sql: unknown) => {
                const text = queryRawSqlText(sql);
                if (text.includes("spi.publish_action")) {
                    return [
                        {
                            publish_action: "insert",
                            auto_action: "insert_candidate",
                            matched_core_id: null,
                        },
                    ];
                }
                if (text.includes("AS exists")) {
                    return [{ exists: false }];
                }
                return [];
            }),
        } as unknown as PrismaClient;

        const action = await resolveRoadPromotionActionForPublishItem(prisma, 33n, 9002n);
        assert.equal(action, "insert");
    });
});

describe("roadValidationSqlRowToOutcome", () => {
    it("marks duplicate-fixed approved rows ready with conversion warning", () => {
        const outcome = roadValidationSqlRowToOutcome({
            publish_item_id: 1n,
            candidate_id: 55n,
            validation_status: "ready",
            error_code: null,
            error_message: null,
            validation_warnings: [
                {
                    code: "duplicate_insert_converted_to_update",
                    message: ROAD_DUPLICATE_INSERT_TO_UPDATE_MESSAGE,
                },
            ],
        });

        assert.equal(outcome.status, "warning");
        assert.equal(outcome.result.warnings[0]?.message, ROAD_DUPLICATE_INSERT_TO_UPDATE_MESSAGE);
    });

    it("marks duplicate_candidate rows blocked", () => {
        const outcome = roadValidationSqlRowToOutcome({
            publish_item_id: 2n,
            candidate_id: 580n,
            validation_status: "blocked",
            error_code: "duplicate_candidate_blocked",
            error_message: "Candidate is marked duplicate_candidate and cannot be promoted until reviewed.",
            validation_warnings: [],
        });

        assert.equal(outcome.status, "blocked");
    });
});
