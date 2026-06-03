import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    IMPORT_REVIEW_PROMOTION_BATCH_INVALID_ROUTE_ID_MESSAGE,
    isValidImportReviewPromotionBatchRouteId,
    parseValidImportReviewPromotionBatchRouteId,
} from "./promotionBatchRouteId.js";

describe("promotionBatchRouteId", () => {
    it("accepts numeric route ids", () => {
        assert.equal(parseValidImportReviewPromotionBatchRouteId("42"), "42");
        assert.equal(isValidImportReviewPromotionBatchRouteId("123"), true);
    });

    it("rejects undefined, null literals, empty, and non-numeric", () => {
        for (const invalid of [
            undefined,
            null,
            "",
            "   ",
            "undefined",
            "UNDEFINED",
            "null",
            "NULL",
            "pb_42",
            "42a",
            "NaN",
        ]) {
            assert.equal(
                parseValidImportReviewPromotionBatchRouteId(invalid as string | null | undefined),
                null,
                `expected invalid: ${String(invalid)}`
            );
            assert.equal(
                isValidImportReviewPromotionBatchRouteId(invalid as string | null | undefined),
                false,
                `expected invalid: ${String(invalid)}`
            );
        }
    });

    it("exposes stable invalid-route message", () => {
        assert.match(
            IMPORT_REVIEW_PROMOTION_BATCH_INVALID_ROUTE_ID_MESSAGE,
            /Invalid promotion batch id/
        );
    });
});
