import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    IMPORT_REVIEW_ROAD_PROMOTION_MAX_ITEMS,
    isImportReviewRoadBulkPromotionEnabled,
    isImportReviewRoadPromotionEnabled,
} from "./import-review-config.js";

describe("road promotion env gates", () => {
    it("requires ENABLE_IMPORT_REVIEW_ROAD_PROMOTION for live promote", () => {
        const prev = process.env.ENABLE_IMPORT_REVIEW_ROAD_PROMOTION;
        process.env.ENABLE_IMPORT_REVIEW_ROAD_PROMOTION = "false";
        assert.equal(isImportReviewRoadPromotionEnabled(), false);
        process.env.ENABLE_IMPORT_REVIEW_ROAD_PROMOTION = "true";
        assert.equal(isImportReviewRoadPromotionEnabled(), true);
        if (prev === undefined) {
            delete process.env.ENABLE_IMPORT_REVIEW_ROAD_PROMOTION;
        } else {
            process.env.ENABLE_IMPORT_REVIEW_ROAD_PROMOTION = prev;
        }
    });

    it("defaults controlled batch size to 3 without bulk flag", () => {
        assert.equal(IMPORT_REVIEW_ROAD_PROMOTION_MAX_ITEMS, 3);
        const prev = process.env.ENABLE_IMPORT_REVIEW_ROAD_BULK_PROMOTION;
        delete process.env.ENABLE_IMPORT_REVIEW_ROAD_BULK_PROMOTION;
        assert.equal(isImportReviewRoadBulkPromotionEnabled(), false);
        if (prev === undefined) {
            delete process.env.ENABLE_IMPORT_REVIEW_ROAD_BULK_PROMOTION;
        } else {
            process.env.ENABLE_IMPORT_REVIEW_ROAD_BULK_PROMOTION = prev;
        }
    });
});
