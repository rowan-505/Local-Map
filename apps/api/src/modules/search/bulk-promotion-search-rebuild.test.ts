import assert from "node:assert/strict";
import test from "node:test";

import type { PrismaClient } from "@prisma/client";

import {
    IMPORT_REVIEW_ENTITY_FAMILY_SEARCH_VIEWS,
    resolveSearchViewsForPromotedFamilies,
    rebuildSearchAfterImportReviewBulkPromotion,
    rebuildSearchAfterSplitPromotion,
} from "./bulk-promotion-search-rebuild.js";
import {
    guardDeprecatedSearchRebuildViews,
    rebuildSearchFamilies,
} from "./search-family-rebuild.js";

test("resolveSearchViewsForPromotedFamilies maps families and dedupes views", () => {
    const views = resolveSearchViewsForPromotedFamilies({
        promotedFamilies: ["places", "roads", "places"],
        countsByFamily: {
            places: { success: 10 },
            roads: { success: 5 },
        },
    });

    assert.deepEqual(views, ["places", "street_groups"]);
});

test("resolveSearchViewsForPromotedFamilies skips families with zero promoted rows", () => {
    const views = resolveSearchViewsForPromotedFamilies({
        promotedFamilies: ["places", "roads"],
        countsByFamily: {
            places: { success: 0 },
            roads: { success: 3 },
        },
    });

    assert.deepEqual(views, ["street_groups"]);
});

test("resolveSearchViewsForPromotedFamilies ignores unmapped families", () => {
    const views = resolveSearchViewsForPromotedFamilies({
        promotedFamilies: ["addresses", "routing_barriers", "places"],
        countsByFamily: {
            addresses: { success: 4 },
            routing_barriers: { success: 2 },
            places: { success: 1 },
        },
    });

    assert.deepEqual(views, ["places"]);
});

test("guardDeprecatedSearchRebuildViews removes deprecated street views", () => {
    const views = guardDeprecatedSearchRebuildViews(["places", "streets", "street_groups"]);
    assert.deepEqual(views, ["places", "street_groups"]);
});

test("rebuildSearchFamilies makes one SQL call for multiple views", async () => {
    let callCount = 0;
    const prisma = {
        $transaction: async (
            fn: (tx: { $executeRawUnsafe: () => Promise<void>; $queryRawUnsafe: () => Promise<unknown> }) => Promise<unknown>,
        ) => {
            callCount += 1;
            return fn({
                $executeRawUnsafe: async () => undefined,
                $queryRawUnsafe: async () => [
                    {
                        rebuild_search_documents: {
                            run_id: 42,
                            status: "completed",
                            requested_views: ["places", "street_groups"],
                            entity_counts: { place: 10, street_group: 5 },
                        },
                    },
                ],
            });
        },
    } as unknown as PrismaClient;

    const outcome = await rebuildSearchFamilies(prisma, ["places", "street_groups"]);
    assert.equal(callCount, 1);
    assert.ok(outcome);
    assert.equal(outcome?.success, true);
    assert.equal(outcome?.views.join(","), "places,street_groups");
    assert.equal(outcome?.run_id, 42);
});

test("rebuildSearchAfterImportReviewBulkPromotion skips dry-run style zero promoted count", async () => {
    let called = false;
    const prisma = {
        $transaction: async () => {
            called = true;
            return [];
        },
    } as unknown as PrismaClient;

    const outcome = await rebuildSearchAfterImportReviewBulkPromotion(prisma, {
        workflow: "test",
        promotedCount: 0,
        promotedFamilies: ["places"],
    });
    assert.equal(outcome, null);
    assert.equal(called, false);
});

test("rebuildSearchAfterSplitPromotion rebuilds only requested family views", async () => {
    const viewsSeen: string[][] = [];
    const prisma = {
        $transaction: async (
            fn: (tx: { $executeRawUnsafe: () => Promise<void>; $queryRawUnsafe: (_sql: string, views: string[]) => Promise<unknown> }) => Promise<unknown>,
        ) =>
            fn({
                $executeRawUnsafe: async () => undefined,
                $queryRawUnsafe: async (_sql, views) => {
                    viewsSeen.push(views);
                    return [
                        {
                            rebuild_search_documents: {
                                run_id: 7,
                                status: "completed",
                                requested_views: views,
                                entity_counts: { place: 2 },
                            },
                        },
                    ];
                },
            }),
    } as unknown as PrismaClient;

    await rebuildSearchAfterSplitPromotion(prisma, {
        workflow: "import-review-place-promotion",
        promotedCount: 2,
        views: IMPORT_REVIEW_ENTITY_FAMILY_SEARCH_VIEWS.places ?? [],
    });

    assert.deepEqual(viewsSeen, [["places"]]);
});
