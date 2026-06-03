import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { QueryClient } from "@tanstack/react-query";

import { importReviewQueryKeys } from "./importReviewQueryKeys";
import { invalidateImportReviewAfterPromotion } from "./invalidateImportReviewAfterPromotion";

function createMockQueryClient() {
    const calls: { method: string; args: unknown[] }[] = [];
    const queryClient = {
        invalidateQueries: async (...args: unknown[]) => {
            calls.push({ method: "invalidateQueries", args });
        },
    } as unknown as QueryClient;
    return { queryClient, calls };
}

describe("invalidateImportReviewAfterPromotion", () => {
    it("refetches places candidate lists after promotion so default view drops promoted rows", async () => {
        const { queryClient, calls } = createMockQueryClient();

        await invalidateImportReviewAfterPromotion(queryClient, {
            promotedFamilies: ["places"],
            reviewBatchId: "42",
        });

        const candidateInvalidations = calls.filter(
            (c) =>
                c.method === "invalidateQueries" &&
                Array.isArray((c.args[0] as { queryKey?: unknown[] })?.queryKey) &&
                (c.args[0] as { queryKey: unknown[] }).queryKey[0] === "import-review" &&
                (c.args[0] as { queryKey: unknown[] }).queryKey[1] === "candidates" &&
                (c.args[0] as { queryKey: unknown[] }).queryKey[2] === "places"
        );
        assert.ok(candidateInvalidations.length >= 1);
        assert.equal(
            (candidateInvalidations[0]!.args[0] as { refetchType?: string }).refetchType,
            "all"
        );
    });
});

describe("importReviewQueryKeys candidates list", () => {
    it("default list key uses showPromoted false so refetch excludes promoted via API", () => {
        const key = importReviewQueryKeys.candidatesList({
            apiFamily: "places",
            apiScopeQuery: { review_batch_id: "1" },
            limit: 50,
            offset: 0,
            sort: "updated_at_desc",
            filters: {
                match_status: "",
                auto_action: "",
                review_status: "",
                review_decision: "",
                promotion_status: "",
                class_code: "",
            },
            qApplied: "",
            showPromoted: false,
        });
        assert.equal(key[key.length - 1], false);
    });

    it("show promoted list key differs so promoted rows can load with badge", () => {
        const hidden = importReviewQueryKeys.candidatesList({
            apiFamily: "places",
            apiScopeQuery: { review_batch_id: "1" },
            limit: 50,
            offset: 0,
            sort: "updated_at_desc",
            filters: {
                match_status: "",
                auto_action: "",
                review_status: "",
                review_decision: "",
                promotion_status: "",
                class_code: "",
            },
            qApplied: "",
            showPromoted: false,
        });
        const shown = importReviewQueryKeys.candidatesList({
            apiFamily: "places",
            apiScopeQuery: { review_batch_id: "1" },
            limit: 50,
            offset: 0,
            sort: "updated_at_desc",
            filters: {
                match_status: "",
                auto_action: "",
                review_status: "",
                review_decision: "",
                promotion_status: "",
                class_code: "",
            },
            qApplied: "",
            showPromoted: true,
        });
        assert.notDeepEqual(hidden, shown);
        assert.equal(shown[shown.length - 1], true);
    });
});
