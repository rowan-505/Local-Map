import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const servicePath = join(
    dirname(fileURLToPath(import.meta.url)),
    "import-review-promotion.service.ts"
);

describe("import-review promotion eligibility service scope path", () => {
    it("getPromotionEligibility uses promotion scope counts, not batch eligibility aggregation", () => {
        const source = readFileSync(servicePath, "utf8");
        const methodStart = source.indexOf("async getPromotionEligibility(");
        assert.ok(methodStart >= 0);
        const nextMethod = source.indexOf("async getBatchEligibility(", methodStart);
        assert.ok(nextMethod > methodStart);
        const methodBody = source.slice(methodStart, nextMethod);
        assert.match(methodBody, /countFamilyPromotionScope/);
        assert.doesNotMatch(methodBody, /countBatchEligibilityByFamilies/);
        assert.doesNotMatch(methodBody, /buildPromotionEligibilityResponse/);
        assert.match(methodBody, /buildReadonlyPromotionEligibilityResponse/);
        assert.match(methodBody, /buildPromotionScopeEligibilityFamilyRow/);
    });
});
