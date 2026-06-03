import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { promoteImportReviewItemTx } from "./import-review-promotion-promote-item-tx.js";
import { promoteAndCommitImportReviewItem } from "./import-review-promotion-promote.repo.js";
import { ImportReviewPromotionPromotePlacesRepository } from "./import-review-promotion-promote-places.repo.js";
import { ImportReviewPromotionPromoteRepository } from "./import-review-promotion-promote.repo.js";
import { ImportReviewPromotionValidationRepository } from "./import-review-promotion-validation.repo.js";

type QueryHandler = (query: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;

type MockTx = {
    $transactionCalled: boolean;
    $queryRaw: QueryHandler;
    $executeRaw: QueryHandler;
    $transaction?: <T>(fn: (tx: MockTx) => Promise<T>) => Promise<T>;
};

function listPlaceRow(publishItemId: bigint) {
    return {
        publish_item_id: publishItemId,
        entity_family: "places",
        target_table: "core.core_places",
        publish_action: "insert",
        publish_status: "pending",
        target_id: null,
        review_candidate_id: publishItemId - 500n,
        review_batch_id: 2n,
        source_snapshot_version: "v1",
        promotion_status: "batched",
        promoted_core_id: null,
        matched_core_id: null,
        external_id: `osm:node/${publishItemId}`,
        target_schema: "core",
    };
}

function createPlacePromotionPrisma(): MockTx & {
    $transaction: <T>(fn: (tx: MockTx) => Promise<T>) => Promise<T>;
} {
    const root: MockTx & { $transaction: <T>(fn: (tx: MockTx) => Promise<T>) => Promise<T> } = {
        $transactionCalled: false,
        $queryRaw: async (query: TemplateStringsArray) => {
            const sql = query.join("?");
            if (sql.includes("UNION ALL") && sql.includes("'places'")) {
                return [listPlaceRow(601n)];
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
                        id: 9100n,
                        external_id: "osm:node/601",
                        primary_name: "Cafe",
                        display_name: "Cafe",
                        candidate_id: 101n,
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
        $executeRaw: async (query: TemplateStringsArray) => {
            const sql = query.join("?");
            if (sql.includes("UPDATE system.system_publish_items")) {
                assert.match(sql, /target_id/);
                assert.match(sql, /publish_status = 'success'/);
            }
            if (sql.includes("UPDATE import_review.place_candidates")) {
                assert.match(sql, /promotion_status = 'promoted'/);
                assert.match(sql, /promoted_core_id/);
            }
            return 1;
        },
        $transaction: async <T>(fn: (tx: MockTx) => Promise<T>): Promise<T> => {
            const tx: MockTx = {
                $transactionCalled: false,
                $queryRaw: root.$queryRaw,
                $executeRaw: root.$executeRaw,
                $transaction: async () => {
                    tx.$transactionCalled = true;
                    throw new Error("this.prisma.$transaction is not a function");
                },
            };
            return fn(tx);
        },
    };
    return root;
}

describe("unified single and batch publish promotion path", () => {
    const config = {
        batchId: 88n,
        publishItemId: 601n,
        promotedBy: null as bigint | null,
        confirmWarnings: true,
    };

    it("single action uses promoteAndCommitImportReviewItem → promoteImportReviewItemTx", async () => {
        const prisma = createPlacePromotionPrisma();
        const result = await promoteAndCommitImportReviewItem(prisma as never, config);
        assert.equal(result.outcome, "inserted");
        assert.equal(result.target_id, 9100n);
    });

    it("repository promoteAndCommitItem delegates to the same helper", async () => {
        const prisma = createPlacePromotionPrisma();
        const repo = new ImportReviewPromotionPromoteRepository(
            prisma as never,
            new ImportReviewPromotionValidationRepository(prisma as never)
        );
        const result = await repo.promoteAndCommitItem(config);
        assert.equal(result.outcome, "inserted");
        assert.equal(result.target_id, 9100n);
    });

    it("batch selected path promotes each item via the same helper as single", async () => {
        const publishItemIds = [701n, 702n, 703n];
        let nestedTxCalls = 0;

        const prisma = {
            $queryRaw: async (query: TemplateStringsArray) => {
                const sql = query.join("?");
                if (sql.includes("UNION ALL") && sql.includes("'places'")) {
                    return publishItemIds.map(listPlaceRow);
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
                            id: 9200n,
                            external_id: "osm:batch",
                            primary_name: "Batch Place",
                            display_name: "Batch Place",
                            candidate_id: 201n,
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
            $transaction: async <T>(fn: (tx: MockTx) => Promise<T>): Promise<T> => {
                const tx: MockTx = {
                    $transactionCalled: false,
                    $queryRaw: prisma.$queryRaw,
                    $executeRaw: prisma.$executeRaw,
                    $transaction: async () => {
                        nestedTxCalls += 1;
                        throw new Error("this.prisma.$transaction is not a function");
                    },
                };
                return fn(tx);
            },
        };

        const results = [];
        for (const publishItemId of publishItemIds) {
            results.push(
                await promoteAndCommitImportReviewItem(prisma as never, {
                    batchId: 88n,
                    publishItemId,
                    promotedBy: null,
                })
            );
        }

        assert.equal(nestedTxCalls, 0);
        assert.equal(results.length, 3);
        assert.ok(results.every((r) => r.outcome === "inserted"));
        assert.ok(results.every((r) => r.target_id === 9200n));
    });

    it("promoteImportReviewItemTx uses promotePlaceTx (no nested $transaction in places repo)", async () => {
        const prisma = createPlacesPromotePrismaForTx();
        const repo = new ImportReviewPromotionPromotePlacesRepository(prisma as never);
        const result = await repo.promotePlaceTx(prisma as never, 1n, 2n, "insert", null);
        assert.equal(prisma.$transactionCalled, false);
        assert.equal(result.outcome, "inserted");
    });

    it("direct promoteImportReviewItemTx marks publish item and candidate on success", async () => {
        const prisma = createPlacePromotionPrisma();
        let executeSql = "";
        const tx: MockTx = {
            $transactionCalled: false,
            $queryRaw: prisma.$queryRaw,
            $executeRaw: async (query: TemplateStringsArray) => {
                executeSql += `${query.join("?")};`;
                return prisma.$executeRaw(query);
            },
        };
        const txRepoBound = new ImportReviewPromotionPromoteRepository(
            tx as never,
            new ImportReviewPromotionValidationRepository(tx as never)
        );
        const result = await promoteImportReviewItemTx(txRepoBound, config);
        assert.equal(result.outcome, "inserted");
        assert.match(executeSql, /system\.system_publish_items/);
        assert.match(executeSql, /import_review\.place_candidates/);
        assert.equal(tx.$transactionCalled, false);
    });
});

function createPlacesPromotePrismaForTx(): MockPlacePromotePrisma {
    const client: MockPlacePromotePrisma = {
        $transactionCalled: false,
        $queryRaw: async (query: TemplateStringsArray) => {
            const sql = query.join("?");
            if (sql.includes("to_regclass")) return [{ exists: true }];
            if (sql.includes("INSERT INTO core.core_places")) {
                return [
                    {
                        id: 1n,
                        external_id: "e1",
                        primary_name: "A",
                        display_name: "A",
                        candidate_id: 1n,
                        merged_source_refs: {},
                        source_type_id: 1n,
                    },
                ];
            }
            if (sql.includes("count(*)")) return [{ count: 0n }];
            return [];
        },
        $executeRaw: async () => 0,
        $transaction: async () => {
            client.$transactionCalled = true;
            throw new Error("this.prisma.$transaction is not a function");
        },
    };
    return client;
}

type MockPlacePromotePrisma = {
    $transactionCalled: boolean;
    $queryRaw: QueryHandler;
    $executeRaw: QueryHandler;
    $transaction?: <T>(fn: (tx: MockPlacePromotePrisma) => Promise<T>) => Promise<T>;
};
