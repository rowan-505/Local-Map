import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    classifyPublishItemsForPromotion,
    type PublishItemValidationRow,
} from "./import-review-promotion-execution.js";
import { ImportReviewPromotionPromotePlacesRepository } from "./import-review-promotion-promote-places.repo.js";

type QueryHandler = (query: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;

type MockPlacePromotePrisma = {
    $transactionCalled: boolean;
    $queryRaw: QueryHandler;
    $executeRaw: QueryHandler;
    $transaction?: <T>(fn: (tx: MockPlacePromotePrisma) => Promise<T>) => Promise<T>;
};

function createPlacesPromotePrisma(handlers: {
    queryRaw?: QueryHandler;
    executeRaw?: QueryHandler;
    transaction?: boolean;
}): MockPlacePromotePrisma {
    const client: MockPlacePromotePrisma = {
        $transactionCalled: false,
        $queryRaw: handlers.queryRaw ?? (async () => []),
        $executeRaw: handlers.executeRaw ?? (async () => 0),
        $transaction: async <T>(fn: (tx: MockPlacePromotePrisma) => Promise<T>): Promise<T> => {
            client.$transactionCalled = true;
            if (handlers.transaction === false) {
                throw new Error("this.prisma.$transaction is not a function");
            }
            return fn(client);
        },
    };
    return client;
}

describe("ImportReviewPromotionPromotePlacesRepository.promotePlaceTx", () => {
    it("routes insert action to insertPlaceTx", async () => {
        const prisma = createPlacesPromotePrisma({
            queryRaw: async (query: TemplateStringsArray) => {
                const sql = query.join("?");
                if (sql.includes("to_regclass")) return [{ exists: true }];
                if (sql.includes("INSERT INTO core.core_places")) {
                    return [
                        {
                            id: 3n,
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
        });
        const repo = new ImportReviewPromotionPromotePlacesRepository(prisma as never);
        const result = await repo.promotePlaceTx(prisma as never, 1n, 2n, "insert", null);
        assert.equal(prisma.$transactionCalled, false);
        assert.equal(result.outcome, "inserted");
    });
});

describe("ImportReviewPromotionPromotePlacesRepository.insertPlaceTx", () => {
    it("does not start a nested prisma transaction (safe inside promoteAndCommitItem)", async () => {
        const executed: string[] = [];
        const prisma = createPlacesPromotePrisma({
            transaction: false,
            queryRaw: async (query) => {
                const sql = query.join("?");
                executed.push(sql);
                if (sql.includes("to_regclass")) {
                    return [{ exists: true }];
                }
                if (sql.includes("INSERT INTO core.core_places")) {
                    assert.match(sql, /category_id_ready/);
                    assert.doesNotMatch(sql, /name_local/);
                    return [
                        {
                            id: 9001n,
                            external_id: "osm:node/1",
                            primary_name: "Test Place",
                            display_name: "Test Place",
                            source_type_id: 1n,
                            source_refs: {},
                        },
                    ];
                }
                if (sql.includes("count(*)")) {
                    return [{ count: 2n }];
                }
                return [];
            },
            executeRaw: async (query) => {
                const sql = query.join("?");
                executed.push(sql);
                if (sql.includes("core.core_place_names")) {
                    assert.match(sql, /p\.name_mm/);
                    assert.match(sql, /p\.name_en/);
                    assert.doesNotMatch(sql, /place_name_candidates/);
                }
                return 0;
            },
        });

        const repo = new ImportReviewPromotionPromotePlacesRepository(prisma as never);
        const result = await repo.insertPlaceTx(prisma as never, 18n, 101n, null);

        assert.equal(prisma.$transactionCalled, false);
        assert.equal(result.outcome, "inserted");
        assert.equal(result.target_id, 9001n);
        assert.equal(result.error_message, null);
        assert.ok(executed.some((sql) => sql.includes("core.core_place_names")));
    });

    it("returns readable failure when insert guard blocks", async () => {
        const prisma = createPlacesPromotePrisma({
            queryRaw: async (query) => {
                const sql = query.join("?");
                if (sql.includes("to_regclass")) {
                    return [{ exists: true }];
                }
                if (sql.includes("INSERT INTO core.core_places")) {
                    return [];
                }
                if (sql.includes("SELECT CASE")) {
                    return [{ reason: "CATEGORY_REQUIRED: typed category_id or class_code must map to ref.ref_poi_categories." }];
                }
                return [];
            },
        });

        const repo = new ImportReviewPromotionPromotePlacesRepository(prisma as never);
        const result = await repo.insertPlaceTx(prisma as never, 18n, 102n, null);

        assert.equal(result.outcome, "failed");
        assert.match(result.error_message ?? "", /CATEGORY_REQUIRED/);
        assert.equal(result.target_id, null);
    });

    it("surfaces database errors without nested transaction wrapper", async () => {
        const prisma = createPlacesPromotePrisma({
            queryRaw: async (query) => {
                const sql = query.join("?");
                if (sql.includes("to_regclass")) {
                    return [{ exists: true }];
                }
                if (sql.includes("INSERT INTO core.core_places")) {
                    throw new Error("column \"name_local\" does not exist");
                }
                return [];
            },
        });

        const repo = new ImportReviewPromotionPromotePlacesRepository(prisma as never);
        const result = await repo.insertPlaceTx(prisma as never, 18n, 103n, null);

        assert.equal(result.outcome, "failed");
        assert.match(result.error_message ?? "", /Place promotion failed:.*name_local/);
    });
});

describe("place candidate promoted_core_id update", () => {
    it("markCandidatePromoted SQL targets import_review.place_candidates", async () => {
        const { Prisma } = await import("@prisma/client");
        const { getImportReviewPromotionCandidateTable } = await import(
            "./import-review-promotion-config.js"
        );
        assert.equal(getImportReviewPromotionCandidateTable("places"), "import_review.place_candidates");
        const table = getImportReviewPromotionCandidateTable("places");
        const sql = Prisma.sql`
            UPDATE ${Prisma.raw(table)}
            SET promotion_status = 'promoted',
                promoted_core_id = ${9001n},
                promoted_at = now()
            WHERE id = ${55n}
        `.strings.join("");
        assert.match(sql, /import_review\.place_candidates/);
        assert.match(sql, /promoted_core_id/);
    });
});

describe("publish batch place promotion selection", () => {
    function row(id: number, status: string): PublishItemValidationRow {
        return {
            publish_item_id: BigInt(id),
            validation_result: {
                status,
                errors: status === "blocked" ? [{ code: "place_category_missing", message: "blocked", severity: "error" }] : [],
                warnings: [],
                issues: [],
            },
        };
    }

    it("blocked place publish item is not promoted", () => {
        const selection = classifyPublishItemsForPromotion([row(1, "ready"), row(2, "blocked")]);
        assert.deepEqual(selection.promotableIds, [1n]);
        assert.equal(selection.skipped_blocked_count, 1);
    });
});
