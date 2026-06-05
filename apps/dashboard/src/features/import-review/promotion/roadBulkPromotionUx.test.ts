import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    isRoadSqlBulkPromotionRecommended,
    resolveRoadBulkPromotionUxPolicy,
} from "./roadBulkPromotionUx.js";

describe("roadBulkPromotionUx", () => {
    it("recommends SQL bulk when ready count exceeds 50", () => {
        assert.equal(isRoadSqlBulkPromotionRecommended(51), true);
        assert.equal(isRoadSqlBulkPromotionRecommended(50), false);
    });

    it("warns but does not disable API promote for large road batch", () => {
        const policy = resolveRoadBulkPromotionUxPolicy({
            hasRoadItems: true,
            validationReadyCount: 276,
            currentPromotableCount: 200,
        });
        assert.equal(policy.recommendSqlBulk, true);
        assert.equal(policy.disableApiPromote, false);
        assert.equal(policy.promoteDisabledReason, null);
        assert.match(policy.sqlBulkWarning ?? "", /Promotion may take time/);
    });
});
