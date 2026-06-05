import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    aggregateRoadDryRunResult,
    resolveItemStatus,
} from "./import-review-promotion-road-dry-run.helpers.js";
import type { RoadDryRunItemResult } from "./import-review-promotion-road-dry-run.types.js";

function makeItem(overrides: Partial<RoadDryRunItemResult> = {}): RoadDryRunItemResult {
    return {
        publish_item_id: "1",
        review_candidate_id: "10",
        external_id: "way/1",
        canonical_name: "Test Road",
        publish_action: "insert",
        dry_run_status: "safe_to_promote",
        blocking_reasons: [],
        warning_codes: [],
        info_codes: [],
        matched_core_id: null,
        geometry_summary: null,
        connectivity_summary: null,
        duplicate_summary: null,
        routing_summary: {
            road_class_code: "primary",
            is_oneway: false,
            surface: "asphalt",
            access: null,
            speed_kph: null,
            bridge: false,
            tunnel: false,
            layer: null,
        },
        can_promote_later: true,
        ...overrides,
    };
}

describe("resolveItemStatus", () => {
    it("returns blocked when blockers exist", () => {
        assert.equal(resolveItemStatus(["geom_missing"], [], false), "blocked");
    });

    it("returns safe_to_promote when clean", () => {
        assert.equal(resolveItemStatus([], [], false), "safe_to_promote");
    });

    it("returns promote_with_warning for routing connectivity warnings without include_warnings", () => {
        assert.equal(resolveItemStatus([], ["ROAD_ISLAND"], false), "promote_with_warning");
    });

    it("returns promote_with_warning for serious warnings with include_warnings", () => {
        assert.equal(resolveItemStatus([], ["ROAD_ISLAND"], true), "promote_with_warning");
    });

    it("returns promote_with_warning for non-serious warnings", () => {
        assert.equal(resolveItemStatus([], ["SURFACE_MISSING"], false), "promote_with_warning");
    });
});

describe("aggregateRoadDryRunResult", () => {
    it("counts classifications and builds code breakdowns", () => {
        const result = aggregateRoadDryRunResult({
            batchId: 99n,
            reviewBatchId: 5n,
            items: [
                makeItem({ dry_run_status: "safe_to_promote" }),
                makeItem({
                    publish_item_id: "2",
                    dry_run_status: "blocked",
                    blocking_reasons: ["geom_missing"],
                    can_promote_later: false,
                }),
                makeItem({
                    publish_item_id: "3",
                    dry_run_status: "promote_with_warning",
                    warning_codes: ["ROAD_ISLAND", "SURFACE_MISSING"],
                }),
            ],
        });

        assert.equal(result.total_count, 3);
        assert.equal(result.safe_to_promote_count, 1);
        assert.equal(result.blocked_count, 1);
        assert.equal(result.promote_with_warning_count, 1);
        assert.equal(result.needs_manual_review_count, 0);
        assert.equal(result.by_error_code.geom_missing, 1);
        assert.equal(result.by_warning_code.ROAD_ISLAND, 1);
        assert.equal(result.by_warning_code.SURFACE_MISSING, 1);
        assert.equal(result.by_road_class.primary, 3);
        assert.equal(result.sample_blocked_items.length, 1);
        assert.equal(result.sample_warning_items.length, 1);
    });
});
