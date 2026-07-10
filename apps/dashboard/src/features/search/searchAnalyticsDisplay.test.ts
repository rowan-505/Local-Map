import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    SEARCH_ANALYTICS_EMPTY_LABEL,
    clickedEntityRowLabel,
    formatClickedEntityLabel,
    formatNullableLatencyMs,
    hasAnalyticsLatencyPoints,
} from "./searchAnalyticsDisplay.js";

describe("searchAnalyticsDisplay", () => {
    it("uses a single empty-state label", () => {
        assert.equal(SEARCH_ANALYTICS_EMPTY_LABEL, "No data for this period yet.");
    });

    it("formats fallback clicked-entity labels", () => {
        assert.equal(
            formatClickedEntityLabel("street_group", "12", null),
            "Street group #12",
        );
        assert.equal(
            formatClickedEntityLabel("place", "5", "Central Park"),
            "Central Park",
        );
    });

    it("never returns undefined-like labels from row helper", () => {
        const label = clickedEntityRowLabel({
            entity_type: "admin_area",
            entity_id: "77",
            display_name: null,
        });
        assert.equal(label, "Admin area #77");
        assert.ok(!label.includes("undefined"));
    });

    it("prefers API label when present", () => {
        assert.equal(
            clickedEntityRowLabel({
                label: "Yangon",
                entity_type: "place",
                entity_id: "1",
                display_name: null,
            }),
            "Yangon",
        );
    });

    it("formats nullable latency values", () => {
        assert.equal(formatNullableLatencyMs(null), "—");
        assert.equal(formatNullableLatencyMs(120), "120 ms");
    });

    it("detects when latency charts have no usable points", () => {
        assert.equal(
            hasAnalyticsLatencyPoints([
                { latency_p50_ms: null, latency_p95_ms: null },
            ]),
            false,
        );
        assert.equal(
            hasAnalyticsLatencyPoints([
                { latency_p50_ms: 40, latency_p95_ms: null },
            ]),
            true,
        );
    });
});
