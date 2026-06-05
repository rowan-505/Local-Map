import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { PromotionPreflightValidation } from "./import-review-promotion-promote-api.js";
import {
    evaluateRoadPromotionGates,
    roadPromotionGateErrorMessage,
} from "./import-review-road-promotion-gates.js";
import { publishBatchDryRunPassed } from "./import-review-publish-batch-dry-run.js";

function validation(overrides: Partial<PromotionPreflightValidation> = {}): PromotionPreflightValidation {
    return {
        outcome: "passed",
        blocked_count: 0,
        warning_count: 0,
        ready_count: 10,
        promotable_count: 10,
        can_promote: true,
        requires_warning_confirmation: false,
        ...overrides,
    };
}

describe("roads batch dry-run → promote gate alignment", () => {
    it("10-road partial batch with dry_run_result passed does not require road dry-run summary", () => {
        const prevRoad = process.env.ENABLE_IMPORT_REVIEW_ROAD_PROMOTION;
        const prevBulk = process.env.ENABLE_IMPORT_REVIEW_ROAD_BULK_PROMOTION;
        process.env.ENABLE_IMPORT_REVIEW_ROAD_PROMOTION = "true";
        process.env.ENABLE_IMPORT_REVIEW_ROAD_BULK_PROMOTION = "true";

        const publish_batch_dry_run = {
            status: "passed",
            checked_at: new Date().toISOString(),
            total: 10,
            entity_families: ["roads"],
            ready_count: 2,
            blocked_count: 8,
        };

        const gates = evaluateRoadPromotionGates({
            road_item_count: 10,
            validation_percent: 100,
            validation: validation({ ready_count: 2, promotable_count: 2 }),
            batch_status: "partial",
            publish_batch_dry_run,
            road_dry_run: null,
            routing_readiness_validation: null,
            roads_ready_at_validation: 2,
        });

        assert.equal(publishBatchDryRunPassed(publish_batch_dry_run), true);
        assert.equal(gates.can_promote, true);
        assert.doesNotMatch(roadPromotionGateErrorMessage(gates), /Run road dry-run before enabling promotion/i);

        if (prevRoad === undefined) {
            delete process.env.ENABLE_IMPORT_REVIEW_ROAD_PROMOTION;
        } else {
            process.env.ENABLE_IMPORT_REVIEW_ROAD_PROMOTION = prevRoad;
        }
        if (prevBulk === undefined) {
            delete process.env.ENABLE_IMPORT_REVIEW_ROAD_BULK_PROMOTION;
        } else {
            process.env.ENABLE_IMPORT_REVIEW_ROAD_BULK_PROMOTION = prevBulk;
        }
    });
});
