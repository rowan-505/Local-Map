import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    IMPORT_REVIEW_ADMIN_AREA_PROMOTION_MAX_ITEMS,
    IMPORT_REVIEW_ROAD_PROMOTION_MAX_ITEMS,
    IMPORT_REVIEW_ROUTING_BARRIER_PROMOTION_MAX_ITEMS,
    isImportReviewAdminAreaBulkPromotionEnabled,
    isImportReviewRoadBulkPromotionEnabled,
    isImportReviewRoadPromotionEnabled,
    isImportReviewRoutingBarrierBulkPromotionEnabled,
    isImportReviewRoutingBarrierPromotionEnabled,
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

    it("defaults admin area bulk promotion gate to max 3 without env flag", () => {
        assert.equal(IMPORT_REVIEW_ADMIN_AREA_PROMOTION_MAX_ITEMS, 3);
        const prev = process.env.ENABLE_IMPORT_REVIEW_ADMIN_AREA_BULK_PROMOTION;
        delete process.env.ENABLE_IMPORT_REVIEW_ADMIN_AREA_BULK_PROMOTION;
        assert.equal(isImportReviewAdminAreaBulkPromotionEnabled(), false);
        process.env.ENABLE_IMPORT_REVIEW_ADMIN_AREA_BULK_PROMOTION = "true";
        assert.equal(isImportReviewAdminAreaBulkPromotionEnabled(), true);
        if (prev === undefined) {
            delete process.env.ENABLE_IMPORT_REVIEW_ADMIN_AREA_BULK_PROMOTION;
        } else {
            process.env.ENABLE_IMPORT_REVIEW_ADMIN_AREA_BULK_PROMOTION = prev;
        }
    });

    it("gates routing barrier promotion and limits controlled batches to 5", () => {
        assert.equal(IMPORT_REVIEW_ROUTING_BARRIER_PROMOTION_MAX_ITEMS, 5);
        const prevPromotion = process.env.ENABLE_IMPORT_REVIEW_ROUTING_BARRIER_PROMOTION;
        const prevBulk = process.env.ENABLE_IMPORT_REVIEW_ROUTING_BARRIER_BULK_PROMOTION;
        delete process.env.ENABLE_IMPORT_REVIEW_ROUTING_BARRIER_PROMOTION;
        delete process.env.ENABLE_IMPORT_REVIEW_ROUTING_BARRIER_BULK_PROMOTION;
        assert.equal(isImportReviewRoutingBarrierPromotionEnabled(), false);
        assert.equal(isImportReviewRoutingBarrierBulkPromotionEnabled(), false);
        process.env.ENABLE_IMPORT_REVIEW_ROUTING_BARRIER_PROMOTION = "true";
        process.env.ENABLE_IMPORT_REVIEW_ROUTING_BARRIER_BULK_PROMOTION = "true";
        assert.equal(isImportReviewRoutingBarrierPromotionEnabled(), true);
        assert.equal(isImportReviewRoutingBarrierBulkPromotionEnabled(), true);
        if (prevPromotion === undefined) {
            delete process.env.ENABLE_IMPORT_REVIEW_ROUTING_BARRIER_PROMOTION;
        } else {
            process.env.ENABLE_IMPORT_REVIEW_ROUTING_BARRIER_PROMOTION = prevPromotion;
        }
        if (prevBulk === undefined) {
            delete process.env.ENABLE_IMPORT_REVIEW_ROUTING_BARRIER_BULK_PROMOTION;
        } else {
            process.env.ENABLE_IMPORT_REVIEW_ROUTING_BARRIER_BULK_PROMOTION = prevBulk;
        }
    });
});
