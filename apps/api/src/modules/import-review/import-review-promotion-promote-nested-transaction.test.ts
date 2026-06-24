import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import {
    classifyPublishItemsForPromotion,
    type PublishItemValidationRow,
} from "./import-review-promotion-execution.js";
import { dedupePromotionFailureSamples } from "./import-review-promotion-failure.js";
import { ImportReviewPromotionPromoteLanduseRepository } from "./import-review-promotion-promote-landuse.repo.js";
import { ImportReviewPromotionPromotePlacesRepository } from "./import-review-promotion-promote-places.repo.js";
import { ImportReviewPromotionPromoteRepository } from "./import-review-promotion-promote.repo.js";
import { ImportReviewPromotionPromoteRoutingBarriersRepository } from "./import-review-promotion-promote-routing-barriers.repo.js";
import { ImportReviewPromotionValidationRepository } from "./import-review-promotion-validation.repo.js";
import {
    ROUTING_BARRIER_TARGET_TABLE,
} from "./import-review-promotion-routing-barrier-dry-run.repo.js";

type QueryHandler = (query: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;

type MockPromotePrisma = {
    $transactionCalled: boolean;
    $queryRaw: QueryHandler;
    $executeRaw: QueryHandler;
    $transaction?: <T>(fn: (tx: MockPromotePrisma) => Promise<T>) => Promise<T>;
};

function createMockPrisma(handlers: {
    queryRaw?: QueryHandler;
    executeRaw?: QueryHandler;
}): MockPromotePrisma {
    const client: MockPromotePrisma = {
        $transactionCalled: false,
        $queryRaw: handlers.queryRaw ?? (async () => []),
        $executeRaw: handlers.executeRaw ?? (async () => 0),
        $transaction: async <T>(fn: (tx: MockPromotePrisma) => Promise<T>): Promise<T> => {
            client.$transactionCalled = true;
            throw new Error("this.prisma.$transaction is not a function");
        },
    };
    return client;
}

describe("promotion family repos avoid nested $transaction", () => {
    it("insertPlaceTx does not call $transaction inside outer commit", async () => {
        const prisma = createMockPrisma({
            queryRaw: async (query) => {
                const sql = query.join("?");
                if (sql.includes("to_regclass")) return [{ exists: true }];
                if (sql.includes("INSERT INTO core.core_places")) {
                    return [
                        {
                            id: 1n,
                            external_id: "e1",
                            primary_name: "A",
                            display_name: "A",
                            source_type_id: 1n,
                            source_refs: {},
                        },
                    ];
                }
                if (sql.includes("count(*)")) return [{ count: 1n }];
                return [];
            },
        });
        const repo = new ImportReviewPromotionPromotePlacesRepository(prisma as never);
        const result = await repo.insertPlaceTx(prisma as never, 18n, 1n, null);
        assert.equal(prisma.$transactionCalled, false);
        assert.equal(result.outcome, "inserted");
    });

    it("insertLanduseTx does not call $transaction inside outer commit", async () => {
        const prisma = createMockPrisma({
            queryRaw: async (query) => {
                const sql = query.join("?");
                if (sql.includes("INSERT INTO core.core_map_landuse")) {
                    return [
                        {
                            id: 2n,
                            external_id: "lu1",
                            source_staging_id: null,
                            name: null,
                            class_code: "farmland",
                            landuse_class_id: 1n,
                            detail_level: "basic",
                            crop_code: null,
                            candidate_id: 10n,
                        },
                    ];
                }
                if (sql.includes("landuse_candidates")) {
                    return [
                        {
                            canonical_name: null,
                            normalized_data: {},
                            external_id: "lu1",
                            class_code: "farmland",
                            name: null,
                            name_mm: null,
                            name_en: null,
                        },
                    ];
                }
                return [];
            },
            executeRaw: async () => 0,
        });
        const repo = new ImportReviewPromotionPromoteLanduseRepository(prisma as never);
        const result = await repo.insertLanduseTx(prisma as never, 18n, 2n);
        assert.equal(prisma.$transactionCalled, false);
        assert.equal(result.outcome, "inserted");
    });

    it("upsertRoutingBarrierTx writes to routing.routing_barriers without nested $transaction", async () => {
        const prisma = createMockPrisma({
            queryRaw: async (query) => {
                const sql = query.join("?");
                if (sql.includes("routing_barrier_candidates")) {
                    return [
                        {
                            publish_item_id: 3n,
                            id: 50n,
                            review_batch_id: 1n,
                            source_snapshot_version: "v1",
                            local_staging_id: 1n,
                            external_id: "rb1",
                            barrier_type: "gate",
                            point_geom: { type: "Point", coordinates: [96.1, 16.8] },
                            source_refs: {},
                            normalized_data: {},
                            matched_core_id: null,
                            promoted_core_id: null,
                        },
                    ];
                }
                if (sql.includes("INSERT INTO routing.routing_barriers")) {
                    assert.match(sql, /routing\.routing_barriers/);
                    return [{ id: 77n, barrier_type: "gate", core_street_id: null }];
                }
                if (sql.includes("jsonb_array_elements")) {
                    return [];
                }
                if (sql.includes("information_schema.columns")) {
                    return [
                        { column_name: "id", is_nullable: "NO", data_type: "bigint", udt_name: "int8", column_default: null },
                        { column_name: "barrier_type", is_nullable: "NO", data_type: "text", udt_name: "text", column_default: null },
                        { column_name: "geom", is_nullable: "YES", data_type: "geometry", udt_name: "geometry", column_default: null },
                    ];
                }
                if (sql.includes("pg_index")) {
                    return [];
                }
                return [];
            },
        });
        const repo = new ImportReviewPromotionPromoteRoutingBarriersRepository(prisma as never);
        const result = await repo.upsertRoutingBarrierTx(prisma as never, 18n, 3n, "insert");
        assert.equal(prisma.$transactionCalled, false);
        assert.equal(result.outcome, "inserted");
        assert.equal(result.target_id, 77n);
    });
});

describe("promoteAndCommitItem uses a single outer transaction", () => {
    it("promotes one place inside outer tx without calling tx.$transaction", async () => {
        let outerTx: MockPromotePrisma | undefined;
        const rootPrisma = {
            $transactionCalled: false,
            $queryRaw: async (query: TemplateStringsArray) => {
                const sql = query.join("?");
                if (sql.includes("UNION ALL") && sql.includes("'places'")) {
                    return [
                        {
                            publish_item_id: 101n,
                            entity_family: "places",
                            target_table: "core.core_places",
                            publish_action: "insert",
                            publish_status: "pending",
                            target_id: null,
                            review_candidate_id: 55n,
                            review_batch_id: 1n,
                            source_snapshot_version: "v1",
                            promotion_status: "pending",
                            promoted_core_id: null,
                            matched_core_id: null,
                            external_id: "osm:node/1",
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
                            external_id: "osm:node/1",
                            primary_name: "Test",
                            display_name: "Test",
                            candidate_id: 55n,
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
            $transaction: async <T>(fn: (tx: MockPromotePrisma) => Promise<T>): Promise<T> => {
                rootPrisma.$transactionCalled = true;
                const tx: MockPromotePrisma = {
                    $transactionCalled: false,
                    $queryRaw: rootPrisma.$queryRaw,
                    $executeRaw: rootPrisma.$executeRaw,
                };
                outerTx = tx;
                return fn(tx);
            },
        };

        const repo = new ImportReviewPromotionPromoteRepository(
            rootPrisma as never,
            new ImportReviewPromotionValidationRepository(rootPrisma as never)
        );
        const result = await repo.promoteAndCommitItem({
            batchId: 18n,
            publishItemId: 101n,
            promotedBy: null,
        });

        assert.equal(rootPrisma.$transactionCalled, true);
        assert.ok(outerTx != null);
        assert.equal(outerTx!.$transactionCalled, false);
        assert.equal(result.outcome, "inserted");
        assert.equal(result.target_id, 9001n);
    });
});

describe("batch place promotion path", () => {
    it("promotes five places via promoteAndCommitItem without nested tx.$transaction", async () => {
        const publishItemIds = [201n, 202n, 203n, 204n, 205n];
        let outerTxNestedCalls = 0;

        const listRow = (publishItemId: bigint) => ({
            publish_item_id: publishItemId,
            entity_family: "places",
            target_table: "core.core_places",
            publish_action: "insert",
            publish_status: "pending",
            target_id: null,
            review_candidate_id: publishItemId - 200n,
            review_batch_id: 2n,
            source_snapshot_version: "v1",
            promotion_status: "batched",
            promoted_core_id: null,
            matched_core_id: null,
            external_id: `osm:node/${publishItemId}`,
            target_schema: "core",
        });

        const rootPrisma = {
            $queryRaw: async (query: TemplateStringsArray) => {
                const sql = query.join("?");
                if (sql.includes("UNION ALL") && sql.includes("'places'")) {
                    return publishItemIds.map(listRow);
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
                            id: 8001n,
                            external_id: "osm:node/x",
                            primary_name: "Place",
                            display_name: "Place",
                            candidate_id: 1n,
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
            $transaction: async <T>(fn: (tx: MockPromotePrisma) => Promise<T>): Promise<T> => {
                const tx: MockPromotePrisma = {
                    $transactionCalled: false,
                    $queryRaw: rootPrisma.$queryRaw,
                    $executeRaw: rootPrisma.$executeRaw,
                    $transaction: async () => {
                        outerTxNestedCalls += 1;
                        throw new Error("this.prisma.$transaction is not a function");
                    },
                };
                return fn(tx);
            },
        };

        const repo = new ImportReviewPromotionPromoteRepository(
            rootPrisma as never,
            new ImportReviewPromotionValidationRepository(rootPrisma as never)
        );

        const outcomes: string[] = [];
        for (const publishItemId of publishItemIds) {
            const result = await repo.promoteAndCommitItem({
                batchId: 18n,
                publishItemId,
                promotedBy: null,
            });
            outcomes.push(result.outcome);
            if (result.outcome === "failed") {
                assert.ok(result.error_message);
                assert.doesNotMatch(
                    result.error_message ?? "",
                    /this\.prisma\.\$transaction is not a function/i
                );
            }
        }

        assert.equal(outerTxNestedCalls, 0);
        assert.equal(outcomes.length, 5);
        assert.ok(outcomes.every((o) => o === "inserted" || o === "failed"));
        assert.ok(outcomes.some((o) => o === "inserted"), "expected at least one successful insert mock");
    });
});

describe("promotion repo source has no nested $transaction", () => {
    const dir = dirname(fileURLToPath(import.meta.url));
    const repoRoot = join(dir, "../../../../..");

    it("check-no-nested-promotion-transactions.mjs passes on family repos", () => {
        const script = join(repoRoot, "tools/import-review/check-no-nested-promotion-transactions.mjs");
        const result = spawnSync(process.execPath, [script], {
            cwd: repoRoot,
            encoding: "utf8",
        });
        assert.equal(
            result.status,
            0,
            result.stderr || result.stdout || "static nested-tx check failed"
        );
    });

    it("family promote repos do not call prisma.$transaction", () => {
        for (const file of [
            "import-review-promotion-promote-places.repo.ts",
            "import-review-promotion-promote-landuse.repo.ts",
            "import-review-promotion-promote-roads.repo.ts",
            "import-review-promotion-promote-admin-areas.repo.ts",
            "import-review-promotion-promote-map.repo.ts",
            "import-review-promotion-promote-routing-barriers.repo.ts",
            "import-review-promotion-promote-addresses.repo.ts",
        ]) {
            const src = readFileSync(join(dir, file), "utf8");
            assert.doesNotMatch(src, /\$transaction\s*\(/);
        }
    });
});

describe("routing_barriers promotion target", () => {
    it("uses routing.routing_barriers as core target table", () => {
        assert.equal(ROUTING_BARRIER_TARGET_TABLE, "routing.routing_barriers");
    });
});

describe("blocked publish items are not promoted", () => {
    function row(id: number, status: string): PublishItemValidationRow {
        return {
            publish_item_id: BigInt(id),
            validation_result: {
                status,
                errors:
                    status === "blocked"
                        ? [{ code: "blocked", message: "blocked", severity: "error" }]
                        : [],
                warnings: [],
                issues: [],
            },
        };
    }

    it("skips blocked and keeps ready ids for a 35+1 style batch", () => {
        const rows = [
            ...Array.from({ length: 35 }, (_, i) => row(i + 1, "ready")),
            row(36, "blocked"),
        ];
        const selection = classifyPublishItemsForPromotion(rows);
        assert.equal(selection.promotableIds.length, 35);
        assert.equal(selection.skipped_blocked_count, 1);
    });
});

describe("dedupePromotionFailureSamples", () => {
    it("returns at most five distinct error codes for stage logs", () => {
        const samples = dedupePromotionFailureSamples(
            [
                {
                    publish_item_id: "1",
                    entity_family: "places",
                    review_candidate_id: "10",
                    external_id: null,
                    target_schema: "core",
                    target_table: "core_places",
                    error_code: "A",
                    error_message: "first",
                    reason: "first",
                },
                {
                    publish_item_id: "2",
                    entity_family: "places",
                    review_candidate_id: "11",
                    external_id: null,
                    target_schema: "core",
                    target_table: "core_places",
                    error_code: "A",
                    error_message: "dup",
                    reason: "dup",
                },
                {
                    publish_item_id: "3",
                    entity_family: "places",
                    review_candidate_id: "12",
                    external_id: null,
                    target_schema: "core",
                    target_table: "core_places",
                    error_code: "B",
                    error_message: "second",
                    reason: "second",
                },
                {
                    publish_item_id: "4",
                    entity_family: "places",
                    review_candidate_id: "13",
                    external_id: null,
                    target_schema: "core",
                    target_table: "core_places",
                    error_code: "C",
                    error_message: "third",
                    reason: "third",
                },
                {
                    publish_item_id: "5",
                    entity_family: "places",
                    review_candidate_id: "14",
                    external_id: null,
                    target_schema: "core",
                    target_table: "core_places",
                    error_code: "D",
                    error_message: "fourth",
                    reason: "fourth",
                },
                {
                    publish_item_id: "6",
                    entity_family: "places",
                    review_candidate_id: "15",
                    external_id: null,
                    target_schema: "core",
                    target_table: "core_places",
                    error_code: "E",
                    error_message: "fifth",
                    reason: "fifth",
                },
                {
                    publish_item_id: "7",
                    entity_family: "places",
                    review_candidate_id: "16",
                    external_id: null,
                    target_schema: "core",
                    target_table: "core_places",
                    error_code: "F",
                    error_message: "sixth",
                    reason: "sixth",
                },
            ],
            5
        );
        assert.equal(samples.length, 5);
        assert.deepEqual(
            samples.map((s) => s.error_code),
            ["A", "B", "C", "D", "E"]
        );
    });
});
