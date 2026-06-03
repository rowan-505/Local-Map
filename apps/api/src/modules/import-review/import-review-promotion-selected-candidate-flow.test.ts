import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    canPromotePublishItem,
    publishItemPromotionBlockReason,
} from "./import-review-promotion-publish-item-validation.js";
import { ImportReviewPromotionPromotePlacesRepository } from "./import-review-promotion-promote-places.repo.js";
import {
    promoteAndCommitImportReviewItem,
} from "./import-review-promotion-promote.repo.js";

type QueryHandler = (query: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;

describe("single selected place promotion flow", () => {
    it("ready publish item passes validation gate for promote", () => {
        assert.equal(
            publishItemPromotionBlockReason(
                { status: "ready", errors: [], warnings: [], issues: [] },
                { confirm_warnings: false }
            ),
            null
        );
        assert.equal(
            canPromotePublishItem({ status: "ready", errors: [], warnings: [] }),
            true
        );
    });

    it("blocked publish item fails validation gate", () => {
        const blocked = {
            status: "blocked",
            errors: [{ code: "place_category_missing", message: "blocked", severity: "error" as const }],
            warnings: [],
            issues: [],
        };
        assert.equal(canPromotePublishItem(blocked), false);
        assert.match(
            publishItemPromotionBlockReason(blocked, { confirm_warnings: false }) ?? "",
            /blocked/i
        );
    });

    it("one selected place promotes inside outer transaction", async () => {
        let outerTxTransactionCalled = false;
        type Tx = {
            $queryRaw: QueryHandler;
            $executeRaw: (query: TemplateStringsArray, ...values: unknown[]) => Promise<number>;
            $transaction?: <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;
        };
        const rootPrisma: Tx & { $transaction: <T>(fn: (tx: Tx) => Promise<T>) => Promise<T> } = {
            $queryRaw: async (query: TemplateStringsArray) => {
                const sql = query.join("?");
                if (sql.includes("UNION ALL") && sql.includes("'places'")) {
                    return [
                        {
                            publish_item_id: 501n,
                            entity_family: "places",
                            target_table: "core.core_places",
                            publish_action: "insert",
                            publish_status: "pending",
                            target_id: null,
                            review_candidate_id: 23n,
                            review_batch_id: 2n,
                            source_snapshot_version: "v1",
                            promotion_status: "batched",
                            promoted_core_id: null,
                            matched_core_id: null,
                            external_id: "osm:node/23",
                            target_schema: "core",
                        },
                    ];
                }
                if (sql.includes("validation_result")) {
                    return [{ validation_result: { status: "ready", errors: [], warnings: [], issues: [] } }];
                }
                if (sql.includes("to_regclass")) {
                    return [{ exists: true }];
                }
                if (sql.includes("INSERT INTO core.core_places")) {
                    return [
                        {
                            id: 9001n,
                            external_id: "osm:node/23",
                            primary_name: "Cafe",
                            display_name: "Cafe",
                            candidate_id: 23n,
                            merged_source_refs: {},
                            source_type_id: 1n,
                        },
                    ];
                }
                if (sql.includes("count(*)")) {
                    return [{ count: 0n }];
                }
                return [];
            },
            $executeRaw: async () => 1,
            $transaction: async <T>(fn: (tx: Tx) => Promise<T>): Promise<T> => {
                const tx: Tx = {
                    $queryRaw: rootPrisma.$queryRaw,
                    $executeRaw: rootPrisma.$executeRaw,
                    $transaction: async () => {
                        outerTxTransactionCalled = true;
                        throw new Error("this.prisma.$transaction is not a function");
                    },
                };
                return fn(tx);
            },
        };

        const result = await promoteAndCommitImportReviewItem(rootPrisma as never, {
            batchId: 77n,
            publishItemId: 501n,
            promotedBy: null,
        });

        assert.equal(outerTxTransactionCalled, false);
        assert.equal(result.outcome, "inserted");
        assert.equal(result.target_id, 9001n);
    });

    it("insertPlaceTx stores failure details when insert guard blocks", async () => {
        const prisma = {
            $queryRaw: async (query: TemplateStringsArray) => {
                const sql = query.join("?");
                if (sql.includes("to_regclass")) {
                    return [{ exists: true }];
                }
                if (sql.includes("INSERT INTO core.core_places")) {
                    return [];
                }
                if (sql.includes("SELECT CASE")) {
                    return [{ reason: "CATEGORY_REQUIRED: typed category_id required." }];
                }
                return [];
            },
            $executeRaw: async () => 0,
        };
        const placesRepo = new ImportReviewPromotionPromotePlacesRepository(prisma as never);
        const result = await placesRepo.insertPlaceTx(prisma as never, 77n, 501n, null);
        assert.equal(result.outcome, "failed");
        assert.match(result.error_message ?? "", /CATEGORY_REQUIRED/);
        assert.equal(result.target_id, null);
    });
});
