import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    deriveSearchIndexFamilySeverity,
    deriveSearchIndexOverallSeverity,
    maxSearchIndexHealthSeverity,
    SEARCH_INDEX_HEALTH_SEVERITY_THRESHOLDS,
    severityToBinaryHealthStatus,
} from "./search-index-health-severity.js";
import { SEARCH_INDEX_RUN_STATUS } from "./search-index-run-status.js";

const NOW = new Date("2026-07-10T12:00:00.000Z");

describe("deriveSearchIndexFamilySeverity", () => {
    it("returns healthy when counts are clean and index is recent", () => {
        const result = deriveSearchIndexFamilySeverity(
            {
                missing_count: 0,
                ghost_count: 0,
                stale_count: 0,
                expected_searchable_count: 10_000,
                latest_indexed_at: new Date("2026-07-09T12:00:00.000Z"),
            },
            NOW,
        );

        assert.equal(result.severity, "healthy");
        assert.deepEqual(result.reasons, []);
    });

    it("treats missing within healthy tolerance as healthy", () => {
        const result = deriveSearchIndexFamilySeverity(
            {
                missing_count: SEARCH_INDEX_HEALTH_SEVERITY_THRESHOLDS.MISSING_HEALTHY_MAX,
                ghost_count: 0,
                stale_count: 0,
                expected_searchable_count: 10_000,
                latest_indexed_at: new Date("2026-07-09T12:00:00.000Z"),
            },
            NOW,
        );

        assert.equal(result.severity, "healthy");
    });

    it("uses expected searchable count for missing percentage, not indexed count", () => {
        const result = deriveSearchIndexFamilySeverity(
            {
                missing_count: 5,
                ghost_count: 0,
                stale_count: 0,
                expected_searchable_count: 10_000,
                latest_indexed_at: new Date("2026-07-09T12:00:00.000Z"),
            },
            NOW,
        );

        assert.equal(result.severity, "warning");
        assert.ok(result.reasons.some((reason) => reason.includes("5 of 10000")));
    });

    it("marks ghost rows as critical", () => {
        const result = deriveSearchIndexFamilySeverity(
            {
                missing_count: 0,
                ghost_count: 1,
                stale_count: 0,
                expected_searchable_count: 100,
                latest_indexed_at: new Date("2026-07-09T12:00:00.000Z"),
            },
            NOW,
        );

        assert.equal(result.severity, "critical");
        assert.ok(result.reasons.some((reason) => reason.includes("ghost")));
    });

    it("marks large missing drift as critical", () => {
        const result = deriveSearchIndexFamilySeverity(
            {
                missing_count: 250,
                ghost_count: 0,
                stale_count: 0,
                expected_searchable_count: 10_000,
                latest_indexed_at: new Date("2026-07-09T12:00:00.000Z"),
            },
            NOW,
        );

        assert.equal(result.severity, "critical");
    });

    it("marks small stale drift as warning", () => {
        const result = deriveSearchIndexFamilySeverity(
            {
                missing_count: 0,
                ghost_count: 0,
                stale_count: 3,
                expected_searchable_count: 10_000,
                latest_indexed_at: new Date("2026-07-09T12:00:00.000Z"),
            },
            NOW,
        );

        assert.equal(result.severity, "warning");
        assert.ok(result.reasons.some((reason) => reason.includes("stale")));
    });

    it("does not apply percent rules to tiny expected families", () => {
        const result = deriveSearchIndexFamilySeverity(
            {
                missing_count: 3,
                ghost_count: 0,
                stale_count: 0,
                expected_searchable_count: 10,
                latest_indexed_at: new Date("2026-07-09T12:00:00.000Z"),
            },
            NOW,
        );

        assert.equal(result.severity, "warning");
    });

    it("marks very old family index as critical when expected rows exist", () => {
        const result = deriveSearchIndexFamilySeverity(
            {
                missing_count: 0,
                ghost_count: 0,
                stale_count: 0,
                expected_searchable_count: 500,
                latest_indexed_at: new Date("2026-04-01T12:00:00.000Z"),
            },
            NOW,
        );

        assert.equal(result.severity, "critical");
        assert.ok(result.reasons.some((reason) => reason.includes("very old")));
    });
});

describe("deriveSearchIndexOverallSeverity", () => {
    it("returns critical when health query failed", () => {
        const result = deriveSearchIndexOverallSeverity(
            {
                family_severities: ["healthy"],
                last_rebuild_status: SEARCH_INDEX_RUN_STATUS.COMPLETED,
                last_successful_rebuild_finished_at: NOW,
                health_query_ok: false,
            },
            NOW,
        );

        assert.equal(result.severity, "critical");
        assert.deepEqual(result.reasons, ["health query failed"]);
    });

    it("returns healthy when latest rebuild completed and rebuild age is recent", () => {
        const result = deriveSearchIndexOverallSeverity(
            {
                family_severities: ["healthy"],
                last_rebuild_status: SEARCH_INDEX_RUN_STATUS.COMPLETED,
                last_successful_rebuild_finished_at: NOW,
                health_query_ok: true,
            },
            NOW,
        );

        assert.equal(result.severity, "healthy");
        assert.ok(!result.reasons.includes("no successful rebuild recorded"));
        assert.ok(!result.reasons.includes("latest rebuild run failed"));
    });

    it("returns critical when latest rebuild failed", () => {
        const result = deriveSearchIndexOverallSeverity(
            {
                family_severities: ["healthy"],
                last_rebuild_status: SEARCH_INDEX_RUN_STATUS.FAILED,
                last_successful_rebuild_finished_at: NOW,
                health_query_ok: true,
            },
            NOW,
        );

        assert.equal(result.severity, "critical");
        assert.ok(result.reasons.includes("latest rebuild run failed"));
    });

    it("returns warning when no rebuild history exists", () => {
        const result = deriveSearchIndexOverallSeverity(
            {
                family_severities: ["healthy"],
                last_rebuild_status: null,
                last_successful_rebuild_finished_at: null,
                health_query_ok: true,
            },
            NOW,
        );

        assert.equal(result.severity, "warning");
        assert.ok(result.reasons.includes("no successful rebuild recorded"));
    });

    it("returns critical when latest rebuild failed even if an older completed run exists", () => {
        const olderCompleted = new Date("2026-07-01T00:00:00.000Z");
        const result = deriveSearchIndexOverallSeverity(
            {
                family_severities: ["healthy"],
                last_rebuild_status: SEARCH_INDEX_RUN_STATUS.FAILED,
                last_successful_rebuild_finished_at: olderCompleted,
                health_query_ok: true,
            },
            NOW,
        );

        assert.equal(result.severity, "critical");
        assert.ok(result.reasons.includes("latest rebuild run failed"));
        assert.ok(!result.reasons.includes("no successful rebuild recorded"));
    });

    it("returns healthy when latest rebuild completed after an older failed run", () => {
        const result = deriveSearchIndexOverallSeverity(
            {
                family_severities: ["healthy"],
                last_rebuild_status: SEARCH_INDEX_RUN_STATUS.COMPLETED,
                last_successful_rebuild_finished_at: NOW,
                health_query_ok: true,
            },
            NOW,
        );

        assert.equal(result.severity, "healthy");
        assert.ok(!result.reasons.includes("latest rebuild run failed"));
        assert.ok(!result.reasons.includes("no successful rebuild recorded"));
    });

    it("returns warning when last successful rebuild is older than warning threshold", () => {
        const old = new Date(
            NOW.getTime() - SEARCH_INDEX_HEALTH_SEVERITY_THRESHOLDS.REBUILD_WARNING_AGE_MS - 1,
        );
        const result = deriveSearchIndexOverallSeverity(
            {
                family_severities: ["healthy"],
                last_rebuild_status: SEARCH_INDEX_RUN_STATUS.COMPLETED,
                last_successful_rebuild_finished_at: old,
                health_query_ok: true,
            },
            NOW,
        );

        assert.equal(result.severity, "warning");
        assert.ok(result.reasons.includes("last successful rebuild exceeds warning age"));
    });

    it("returns critical when last successful rebuild is older than critical threshold", () => {
        const veryOld = new Date(
            NOW.getTime() - SEARCH_INDEX_HEALTH_SEVERITY_THRESHOLDS.REBUILD_CRITICAL_AGE_MS - 1,
        );
        const result = deriveSearchIndexOverallSeverity(
            {
                family_severities: ["healthy"],
                last_rebuild_status: SEARCH_INDEX_RUN_STATUS.COMPLETED,
                last_successful_rebuild_finished_at: veryOld,
                health_query_ok: true,
            },
            NOW,
        );

        assert.equal(result.severity, "critical");
        assert.ok(result.reasons.includes("last successful rebuild is very old"));
    });

    it("uses the worst family severity", () => {
        const result = deriveSearchIndexOverallSeverity(
            {
                family_severities: ["healthy", "warning", "critical"],
                last_rebuild_status: SEARCH_INDEX_RUN_STATUS.COMPLETED,
                last_successful_rebuild_finished_at: NOW,
                health_query_ok: true,
            },
            NOW,
        );

        assert.equal(result.severity, "critical");
    });
});

describe("severity helpers", () => {
    it("maxSearchIndexHealthSeverity picks the worst level", () => {
        assert.equal(maxSearchIndexHealthSeverity("healthy", "warning", "healthy"), "warning");
        assert.equal(maxSearchIndexHealthSeverity("healthy", "critical", "warning"), "critical");
    });

    it("severityToBinaryHealthStatus maps warning and critical to unhealthy", () => {
        assert.equal(severityToBinaryHealthStatus("healthy"), "healthy");
        assert.equal(severityToBinaryHealthStatus("warning"), "unhealthy");
        assert.equal(severityToBinaryHealthStatus("critical"), "unhealthy");
    });
});
