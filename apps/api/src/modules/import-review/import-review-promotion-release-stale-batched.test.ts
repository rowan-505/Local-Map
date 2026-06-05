import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ImportReviewBatchNotFoundError } from "./import-review-errors.js";
import { ImportReviewInvalidScopeError } from "./import-review-errors.js";
import {
    listStaleBatchedCandidatesForFamily,
    releaseStaleBatchedImportReviewCandidates,
    resolveReleaseStaleBatchedFamilies,
    STALE_BATCHED_RELEASE_ALLOWED_BATCH_STATUSES,
    STALE_BATCHED_RELEASE_ALLOWED_PUBLISH_ITEM_STATUSES,
    STALE_BATCHED_RELEASE_BLOCKED_BATCH_STATUSES,
} from "./import-review-promotion-release-stale-batched.js";

function prismaSqlText(query: unknown): string {
    if (
        query &&
        typeof query === "object" &&
        "strings" in query &&
        Array.isArray((query as { strings: string[] }).strings)
    ) {
        return (query as { strings: string[] }).strings.join("");
    }
    if (Array.isArray(query)) {
        return (query as string[]).join("");
    }
    return String(query);
}

describe("resolveReleaseStaleBatchedFamilies", () => {
    it("defaults to all promotable families", () => {
        const families = resolveReleaseStaleBatchedFamilies();
        assert.ok(families.includes("roads"));
        assert.ok(families.includes("routing_barriers"));
    });

    it("rejects unsupported families", () => {
        assert.throws(
            () => resolveReleaseStaleBatchedFamilies(["roads", "bus_routes"]),
            ImportReviewInvalidScopeError
        );
    });
});

describe("listStaleBatchedCandidatesForFamily SQL guards", () => {
    it("only releases failed items on failed/partial batches and blocks active lifecycle statuses", async () => {
        const queryCalls: string[] = [];
        const prisma = {
            $queryRaw: async (query: unknown) => {
                queryCalls.push(prismaSqlText(query));
                return [];
            },
        };

        await listStaleBatchedCandidatesForFamily(prisma as never, {
            reviewBatchId: 2n,
            entityFamily: "roads",
        });

        assert.equal(queryCalls.length, 1);
        const sql = queryCalls[0] ?? "";
        assert.match(sql, /promotion_status = 'batched'/);
        assert.match(sql, /IS DISTINCT FROM 'promoted'/);
        assert.match(sql, /spb_active\.status IN/);
        assert.deepEqual([...STALE_BATCHED_RELEASE_ALLOWED_PUBLISH_ITEM_STATUSES], ["failed"]);
        assert.deepEqual([...STALE_BATCHED_RELEASE_ALLOWED_BATCH_STATUSES], ["failed", "partial"]);
        assert.ok(STALE_BATCHED_RELEASE_BLOCKED_BATCH_STATUSES.includes("draft"));
        assert.ok(STALE_BATCHED_RELEASE_BLOCKED_BATCH_STATUSES.includes("ready"));
        assert.ok(STALE_BATCHED_RELEASE_BLOCKED_BATCH_STATUSES.includes("validating"));
        assert.ok(STALE_BATCHED_RELEASE_BLOCKED_BATCH_STATUSES.includes("promoting"));
        assert.match(sql, /latest\.publish_status IN/);
        assert.match(sql, /latest\.batch_status IN/);
        assert.match(sql, /publish_status = 'success'/);
        assert.match(sql, /target_id IS NOT NULL/);
    });
});

describe("releaseStaleBatchedImportReviewCandidates", () => {
    const reviewBatchId = 2n;

    function createPrismaMock(options: {
        reviewBatchExists?: boolean;
        staleRows?: Array<{
            candidate_id: bigint;
            publish_batch_id: bigint;
            publish_item_id: bigint;
            publish_status: string;
            batch_status: string;
        }>;
    }) {
        const updateCalls: string[] = [];
        const prisma = {
            $queryRaw: async (query: unknown) => {
                const sql = prismaSqlText(query);
                if (sql.includes("import_review.review_batches")) {
                    return options.reviewBatchExists === false ? [] : [{ id: reviewBatchId }];
                }
                if (sql.includes("UPDATE") && sql.includes("not_ready")) {
                    updateCalls.push(sql);
                    return (options.staleRows ?? []).map((row) => ({ id: row.candidate_id }));
                }
                if (sql.includes("candidate_id")) {
                    return options.staleRows ?? [];
                }
                return [];
            },
        };
        return { prisma: prisma as never, updateCalls };
    }

    it("releases stale failed batched candidate when dry_run is false", async () => {
        const { prisma, updateCalls } = createPrismaMock({
            staleRows: [
                {
                    candidate_id: 101n,
                    publish_batch_id: 29n,
                    publish_item_id: 2901n,
                    publish_status: "failed",
                    batch_status: "failed",
                },
            ],
        });

        const result = await releaseStaleBatchedImportReviewCandidates(prisma, {
            review_batch_id: reviewBatchId,
            families: ["roads"],
            dry_run: false,
        });

        assert.equal(result.status, "success");
        assert.equal(result.dry_run, false);
        assert.equal(result.released_total, 1);
        assert.equal(result.by_family[0]?.entity_family, "roads");
        assert.equal(result.by_family[0]?.eligible_count, 1);
        assert.equal(result.by_family[0]?.released_count, 1);
        assert.equal(updateCalls.length, 1);
        assert.match(updateCalls[0] ?? "", /promotion_status = 'not_ready'/);
        assert.equal(result.samples[0]?.candidate_id, "101");
    });

    it("dry_run previews release without updating candidates", async () => {
        const { prisma, updateCalls } = createPrismaMock({
            staleRows: [
                {
                    candidate_id: 202n,
                    publish_batch_id: 30n,
                    publish_item_id: 3001n,
                    publish_status: "failed",
                    batch_status: "failed",
                },
            ],
        });

        const result = await releaseStaleBatchedImportReviewCandidates(prisma, {
            review_batch_id: reviewBatchId,
            families: ["roads"],
            dry_run: true,
        });

        assert.equal(result.dry_run, true);
        assert.equal(result.released_total, 1);
        assert.equal(result.by_family[0]?.released_count, 0);
        assert.equal(updateCalls.length, 0);
    });

    it("does not release when no stale rows match (e.g. draft batch with pending items)", async () => {
        const { prisma, updateCalls } = createPrismaMock({ staleRows: [] });

        const result = await releaseStaleBatchedImportReviewCandidates(prisma, {
            review_batch_id: reviewBatchId,
            families: ["roads"],
            dry_run: false,
        });

        assert.equal(result.released_total, 0);
        assert.equal(updateCalls.length, 0);
    });

    it("throws when review batch does not exist", async () => {
        const { prisma } = createPrismaMock({ reviewBatchExists: false });
        await assert.rejects(
            () =>
                releaseStaleBatchedImportReviewCandidates(prisma, {
                    review_batch_id: 999n,
                    dry_run: true,
                }),
            ImportReviewBatchNotFoundError
        );
    });
});
