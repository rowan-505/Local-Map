import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ImportReviewRoadDryRunSummary } from "./import-review-road-dry-run-summary.types.js";
import type { ImportReviewRoadRoutingReadinessSummary } from "./import-review-road-routing-readiness.types.js";
import type { ImportReviewPromotionRoadDryRunResult } from "./import-review-promotion-road-dry-run.types.js";
import type { PromotionPreflightValidation } from "./import-review-promotion-promote-api.js";
import {
    evaluateRoadPromotionGates,
    roadDryRunPassed,
    routingReadinessPassed,
    routingReadinessValidationCompleted,
} from "./import-review-road-promotion-gates.js";

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

function roadDryRunSummary(
    overrides: Partial<ImportReviewRoadDryRunSummary> = {}
): ImportReviewRoadDryRunSummary {
    return {
        status: "passed",
        checked_count: 276,
        passed_count: 276,
        failed_count: 0,
        sample_errors: [],
        ran_at: new Date().toISOString(),
        ...overrides,
    };
}

function routingReadinessSummary(
    overrides: Partial<ImportReviewRoadRoutingReadinessSummary> = {}
): ImportReviewRoadRoutingReadinessSummary {
    return {
        status: "passed",
        type: "db_routing_readiness",
        checked_count: 276,
        failed_count: 0,
        warning_count: 0,
        sample_errors: [],
        sample_warnings: [],
        ran_at: new Date().toISOString(),
        ...overrides,
    };
}

describe("routingReadinessPassed", () => {
    it("requires type db_routing_readiness and zero failures", () => {
        assert.equal(routingReadinessPassed(routingReadinessSummary()), true);
        assert.equal(
            routingReadinessPassed(
                routingReadinessSummary({ status: "failed", failed_count: 1 })
            ),
            false
        );
    });
});

describe("evaluateRoadPromotionGates", () => {
    it("places-only batch ignores road gates", () => {
        const prev = process.env.ENABLE_IMPORT_REVIEW_ROAD_PROMOTION;
        delete process.env.ENABLE_IMPORT_REVIEW_ROAD_PROMOTION;

        const gates = evaluateRoadPromotionGates({
            road_item_count: 0,
            validation_percent: 100,
            validation: validation(),
            road_dry_run: null,
            routing_readiness_validation: null,
        });

        assert.equal(gates.applies, false);
        assert.equal(gates.can_promote, true);

        if (prev === undefined) {
            delete process.env.ENABLE_IMPORT_REVIEW_ROAD_PROMOTION;
        } else {
            process.env.ENABLE_IMPORT_REVIEW_ROAD_PROMOTION = prev;
        }
    });

    it("blocks when detailed road dry-run passed but routing readiness missing (no batch dry-run)", () => {
        const prev = process.env.ENABLE_IMPORT_REVIEW_ROAD_PROMOTION;
        process.env.ENABLE_IMPORT_REVIEW_ROAD_PROMOTION = "true";

        const gates = evaluateRoadPromotionGates({
            road_item_count: 5,
            validation_percent: 100,
            validation: validation(),
            road_dry_run: roadDryRunSummary({ checked_count: 5 }),
            routing_readiness_validation: null,
            roads_ready_at_validation: 5,
        });

        assert.equal(gates.can_promote, false);
        assert.equal(
            gates.gates.find((g) => g.id === "routing_readiness_validation_completed")?.satisfied,
            false
        );

        if (prev === undefined) {
            delete process.env.ENABLE_IMPORT_REVIEW_ROAD_PROMOTION;
        } else {
            process.env.ENABLE_IMPORT_REVIEW_ROAD_PROMOTION = prev;
        }
    });

    it("allows promote when batch dry_run_passed even without routing readiness summary", () => {
        const prevRoad = process.env.ENABLE_IMPORT_REVIEW_ROAD_PROMOTION;
        const prevBulk = process.env.ENABLE_IMPORT_REVIEW_ROAD_BULK_PROMOTION;
        process.env.ENABLE_IMPORT_REVIEW_ROAD_PROMOTION = "true";
        process.env.ENABLE_IMPORT_REVIEW_ROAD_BULK_PROMOTION = "true";

        const gates = evaluateRoadPromotionGates({
            road_item_count: 5,
            validation_percent: 100,
            validation: validation({ ready_count: 5, promotable_count: 5 }),
            batch_status: "partial",
            publish_batch_dry_run: {
                status: "passed",
                checked_at: new Date().toISOString(),
                total: 5,
                entity_families: ["roads"],
            },
            road_dry_run: null,
            routing_readiness_validation: null,
            roads_ready_at_validation: 5,
        });

        assert.equal(gates.can_promote, true);
        assert.equal(
            gates.gates.find((g) => g.id === "routing_readiness_validation_completed")?.satisfied,
            true
        );

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

    it("does not pass routing readiness when only road dry-run passed", () => {
        assert.equal(roadDryRunPassed(roadDryRunSummary()), true);
        assert.equal(routingReadinessValidationCompleted(null, null), false);
    });

    it("large roads batch recommends SQL bulk and blocks API promote without dev flag", () => {
        const prevRoad = process.env.ENABLE_IMPORT_REVIEW_ROAD_PROMOTION;
        const prevBulk = process.env.ENABLE_IMPORT_REVIEW_ROAD_BULK_PROMOTION;
        const prevApiBulk = process.env.ENABLE_IMPORT_REVIEW_ROAD_API_BULK_PROMOTION;
        process.env.ENABLE_IMPORT_REVIEW_ROAD_PROMOTION = "true";
        process.env.ENABLE_IMPORT_REVIEW_ROAD_BULK_PROMOTION = "true";
        delete process.env.ENABLE_IMPORT_REVIEW_ROAD_API_BULK_PROMOTION;

        const gates = evaluateRoadPromotionGates({
            road_item_count: 276,
            validation_percent: 100,
            validation: validation({ promotable_count: 276, ready_count: 276 }),
            road_dry_run: roadDryRunSummary(),
            routing_readiness_validation: routingReadinessSummary(),
            roads_ready_at_validation: 276,
        });

        assert.equal(gates.recommend_sql_bulk_promotion, true);
        assert.equal(gates.api_bulk_promotion_allowed, false);
        assert.equal(gates.can_promote, false);
        assert.match(gates.primary_blocker_message ?? "", /SQL bulk/i);

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
        if (prevApiBulk === undefined) {
            delete process.env.ENABLE_IMPORT_REVIEW_ROAD_API_BULK_PROMOTION;
        } else {
            process.env.ENABLE_IMPORT_REVIEW_ROAD_API_BULK_PROMOTION = prevApiBulk;
        }
    });

    it("POST promote allows large road batch when env flags and confirmations are set", () => {
        const prevRoad = process.env.ENABLE_IMPORT_REVIEW_ROAD_PROMOTION;
        const prevBulk = process.env.ENABLE_IMPORT_REVIEW_ROAD_BULK_PROMOTION;
        const prevApiBulk = process.env.ENABLE_IMPORT_REVIEW_ROAD_API_BULK_PROMOTION;
        process.env.ENABLE_IMPORT_REVIEW_ROAD_PROMOTION = "true";
        process.env.ENABLE_IMPORT_REVIEW_ROAD_BULK_PROMOTION = "true";
        process.env.ENABLE_IMPORT_REVIEW_ROAD_API_BULK_PROMOTION = "true";

        const gates = evaluateRoadPromotionGates({
            road_item_count: 756,
            validation_percent: 100,
            validation: validation({ promotable_count: 756, ready_count: 756 }),
            publish_batch_dry_run: {
                status: "passed",
                checked_at: "2026-01-01T00:00:00Z",
                total: 756,
                entity_families: ["roads"],
            },
            road_dry_run: roadDryRunSummary(),
            routing_readiness_validation: routingReadinessSummary(),
            roads_ready_at_validation: 756,
            promote_request: {
                allow_high_risk_families: true,
                confirm_large_batch: true,
            },
        });

        assert.equal(gates.can_promote, true);
        assert.equal(gates.primary_blocker_message, null);

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
        if (prevApiBulk === undefined) {
            delete process.env.ENABLE_IMPORT_REVIEW_ROAD_API_BULK_PROMOTION;
        } else {
            process.env.ENABLE_IMPORT_REVIEW_ROAD_API_BULK_PROMOTION = prevApiBulk;
        }
    });

    it("POST promote blocks large road batch when API bulk env flag is missing", () => {
        const prevRoad = process.env.ENABLE_IMPORT_REVIEW_ROAD_PROMOTION;
        const prevApiBulk = process.env.ENABLE_IMPORT_REVIEW_ROAD_API_BULK_PROMOTION;
        process.env.ENABLE_IMPORT_REVIEW_ROAD_PROMOTION = "true";
        delete process.env.ENABLE_IMPORT_REVIEW_ROAD_API_BULK_PROMOTION;

        const gates = evaluateRoadPromotionGates({
            road_item_count: 756,
            validation_percent: 100,
            validation: validation({ promotable_count: 756, ready_count: 756 }),
            publish_batch_dry_run: {
                status: "passed",
                checked_at: "2026-01-01T00:00:00Z",
                total: 756,
                entity_families: ["roads"],
            },
            road_dry_run: roadDryRunSummary(),
            routing_readiness_validation: routingReadinessSummary(),
            roads_ready_at_validation: 756,
            promote_request: {
                allow_high_risk_families: true,
                confirm_large_batch: true,
            },
        });

        assert.equal(gates.can_promote, false);
        assert.match(gates.primary_blocker_message ?? "", /SQL bulk scripts/i);
        assert.match(gates.primary_blocker_message ?? "", /ENABLE_IMPORT_REVIEW_ROAD_API_BULK_PROMOTION=true/i);

        if (prevRoad === undefined) {
            delete process.env.ENABLE_IMPORT_REVIEW_ROAD_PROMOTION;
        } else {
            process.env.ENABLE_IMPORT_REVIEW_ROAD_PROMOTION = prevRoad;
        }
        if (prevApiBulk === undefined) {
            delete process.env.ENABLE_IMPORT_REVIEW_ROAD_API_BULK_PROMOTION;
        } else {
            process.env.ENABLE_IMPORT_REVIEW_ROAD_API_BULK_PROMOTION = prevApiBulk;
        }
    });

    it("roads batch allows API promotion when dry-run passes and dev API bulk flag set", () => {
        const prevRoad = process.env.ENABLE_IMPORT_REVIEW_ROAD_PROMOTION;
        const prevBulk = process.env.ENABLE_IMPORT_REVIEW_ROAD_BULK_PROMOTION;
        const prevApiBulk = process.env.ENABLE_IMPORT_REVIEW_ROAD_API_BULK_PROMOTION;
        process.env.ENABLE_IMPORT_REVIEW_ROAD_PROMOTION = "true";
        process.env.ENABLE_IMPORT_REVIEW_ROAD_BULK_PROMOTION = "true";
        process.env.ENABLE_IMPORT_REVIEW_ROAD_API_BULK_PROMOTION = "true";

        const gates = evaluateRoadPromotionGates({
            road_item_count: 276,
            validation_percent: 100,
            validation: validation({ promotable_count: 276, ready_count: 276 }),
            road_dry_run: roadDryRunSummary(),
            routing_readiness_validation: routingReadinessSummary(),
            roads_ready_at_validation: 276,
        });

        assert.equal(gates.can_promote, true);
        const routingGate = gates.gates.find(
            (g) => g.id === "routing_readiness_validation_completed"
        );
        assert.equal(routingGate?.satisfied, true);
        assert.match(routingGate?.helper ?? "", /Does not rebuild Valhalla/);
        assert.equal(gates.gates.find((g) => g.id === "env_bulk_enabled")?.satisfied, true);

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
        if (prevApiBulk === undefined) {
            delete process.env.ENABLE_IMPORT_REVIEW_ROAD_API_BULK_PROMOTION;
        } else {
            process.env.ENABLE_IMPORT_REVIEW_ROAD_API_BULK_PROMOTION = prevApiBulk;
        }
    });

    it("uses ready-for-promotion env message when only API env flags block", () => {
        const prevRoad = process.env.ENABLE_IMPORT_REVIEW_ROAD_PROMOTION;
        const prevBulk = process.env.ENABLE_IMPORT_REVIEW_ROAD_BULK_PROMOTION;
        delete process.env.ENABLE_IMPORT_REVIEW_ROAD_PROMOTION;
        delete process.env.ENABLE_IMPORT_REVIEW_ROAD_BULK_PROMOTION;

        const gates = evaluateRoadPromotionGates({
            road_item_count: 276,
            validation_percent: 100,
            validation: validation({ promotable_count: 276, ready_count: 276 }),
            road_dry_run: roadDryRunSummary(),
            routing_readiness_validation: routingReadinessSummary(),
            roads_ready_at_validation: 276,
        });

        assert.equal(gates.can_promote, false);
        assert.equal(gates.primary_blocker, "env_enabled");
        assert.match(gates.primary_blocker_message ?? "", /Road promotion is ready/);
        assert.match(gates.primary_blocker_message ?? "", /ENABLE_IMPORT_REVIEW_ROAD_PROMOTION=true/);
        assert.match(gates.primary_blocker_message ?? "", /apps\/api\/\.env/);

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

    it("blocks bulk env when road item count exceeds max without bulk flag", () => {
        const prevRoad = process.env.ENABLE_IMPORT_REVIEW_ROAD_PROMOTION;
        const prevBulk = process.env.ENABLE_IMPORT_REVIEW_ROAD_BULK_PROMOTION;
        process.env.ENABLE_IMPORT_REVIEW_ROAD_PROMOTION = "true";
        delete process.env.ENABLE_IMPORT_REVIEW_ROAD_BULK_PROMOTION;

        const gates = evaluateRoadPromotionGates({
            road_item_count: 10,
            validation_percent: 100,
            validation: validation({ promotable_count: 10, ready_count: 10 }),
            road_dry_run: roadDryRunSummary({ checked_count: 10 }),
            routing_readiness_validation: routingReadinessSummary({ checked_count: 10 }),
            roads_ready_at_validation: 10,
        });

        assert.equal(gates.can_promote, false);
        assert.equal(gates.primary_blocker, "env_bulk_enabled");
        assert.match(
            gates.primary_blocker_message ?? "",
            /ENABLE_IMPORT_REVIEW_ROAD_BULK_PROMOTION=true/
        );

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
