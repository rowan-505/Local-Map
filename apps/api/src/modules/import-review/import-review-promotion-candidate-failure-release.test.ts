import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PROMOTABLE_PUBLISH_FAMILIES } from "./import-review-promotion-config.js";
import { releaseCandidateAfterPromotionFailure } from "./import-review-promotion-candidate-failure-release.js";

function prismaSqlText(query: unknown): string {
    if (
        query &&
        typeof query === "object" &&
        "strings" in query &&
        Array.isArray((query as { strings: string[] }).strings)
    ) {
        return (query as { strings: string[] }).strings.join("");
    }
    return String(query);
}

describe("releaseCandidateAfterPromotionFailure", () => {
    it("updates all promotable families to not_ready without changing review fields", async () => {
        const calls: string[] = [];
        const prisma = {
            $executeRaw: async (query: unknown) => {
                calls.push(prismaSqlText(query));
                return 1;
            },
        };

        for (const family of PROMOTABLE_PUBLISH_FAMILIES) {
            await releaseCandidateAfterPromotionFailure(prisma as never, family, 42n);
        }

        assert.equal(calls.length, PROMOTABLE_PUBLISH_FAMILIES.length);
        for (const sql of calls) {
            assert.match(sql, /promotion_status = 'not_ready'/);
            assert.match(sql, /review_status = 'approved'/);
            assert.match(sql, /review_decision = 'approved'/);
            assert.doesNotMatch(sql, /review_status = 'promotion_failed'/);
        }
    });
});
