import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ImportReviewRoadDryRunSummary } from "./import-review-road-dry-run-summary.types.js";
import type { ImportReviewRoadRoutingReadinessSummary } from "./import-review-road-routing-readiness.types.js";
import {
    evaluateRoadPromotionGates,
    roadPromotionGateErrorMessage,
} from "./import-review-road-promotion-gates.js";
import type { PromotionPreflightValidation } from "./import-review-promotion-promote-api.js";

describe("promote road gates with routing_readiness_validation", () => {
    it("accepts both summaries passed but still blocks when env flag is false", () => {
        const prev = process.env.ENABLE_IMPORT_REVIEW_ROAD_PROMOTION;
        delete process.env.ENABLE_IMPORT_REVIEW_ROAD_PROMOTION;

        const roadDryRun: ImportReviewRoadDryRunSummary = {
            status: "passed",
            checked_count: 276,
            passed_count: 276,
            failed_count: 0,
            sample_errors: [],
            ran_at: new Date().toISOString(),
        };

        const routingReadiness: ImportReviewRoadRoutingReadinessSummary = {
            status: "passed",
            type: "db_routing_readiness",
            checked_count: 276,
            failed_count: 0,
            warning_count: 0,
            sample_errors: [],
            sample_warnings: [],
            ran_at: new Date().toISOString(),
        };

        const validation: PromotionPreflightValidation = {
            outcome: "passed",
            blocked_count: 0,
            warning_count: 0,
            ready_count: 276,
            promotable_count: 276,
            can_promote: true,
            requires_warning_confirmation: false,
        };

        const gates = evaluateRoadPromotionGates({
            road_item_count: 276,
            validation_percent: 100,
            validation,
            road_dry_run: roadDryRun,
            routing_readiness_validation: routingReadiness,
            roads_ready_at_validation: 276,
        });

        assert.equal(gates.gates.find((g) => g.id === "road_dry_run_completed")?.satisfied, true);
        assert.equal(
            gates.gates.find((g) => g.id === "routing_readiness_validation_completed")?.satisfied,
            true
        );
        assert.equal(gates.can_promote, false);
        assert.equal(gates.primary_blocker, "env_enabled");
        assert.match(roadPromotionGateErrorMessage(gates), /ENABLE_IMPORT_REVIEW_ROAD_PROMOTION/);

        if (prev === undefined) {
            delete process.env.ENABLE_IMPORT_REVIEW_ROAD_PROMOTION;
        } else {
            process.env.ENABLE_IMPORT_REVIEW_ROAD_PROMOTION = prev;
        }
    });
});
