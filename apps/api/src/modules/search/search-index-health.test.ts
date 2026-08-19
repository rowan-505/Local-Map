import assert from "node:assert/strict";
import test from "node:test";

import {
    buildFailedSearchIndexHealthReport,
    buildSearchIndexHealthReport,
    hasSearchIndexHealthIssues,
    isSearchIndexFamilyUnhealthy,
    normalizeSearchIndexHealthRow,
    resolveRebuildViewsForHealthFamilies,
} from "./search-index-health.js";

test("isSearchIndexFamilyUnhealthy detects missing, ghost, or stale rows", () => {
    assert.equal(isSearchIndexFamilyUnhealthy({ missing: 0, ghost: 0, stale: 0 }), false);
    assert.equal(isSearchIndexFamilyUnhealthy({ missing: 1, ghost: 0, stale: 0 }), true);
    assert.equal(isSearchIndexFamilyUnhealthy({ missing: 0, ghost: 2, stale: 0 }), true);
    assert.equal(isSearchIndexFamilyUnhealthy({ missing: 0, ghost: 0, stale: 3 }), true);
});

test("resolveRebuildViewsForHealthFamilies maps and dedupes transport route families", () => {
    const views = resolveRebuildViewsForHealthFamilies([
        "transport_stops",
        "transport_routes",
        "transport_route_variants",
        "places",
    ]);

    assert.deepEqual(views, ["bus_routes", "bus_stops", "places"]);
});

test("normalizeSearchIndexHealthRow converts bigint issue counts", () => {
    const row = normalizeSearchIndexHealthRow({
        entity_family: "places",
        search_entity_type: "place",
        canonical_count: 10n,
        indexed_count: 9n,
        missing_count: 1n,
        ghost_count: 0n,
        stale_count: 2n,
        latest_indexed_at: null,
        latest_source_updated_at: null,
    });

    assert.equal(row.missing, 1);
    assert.equal(row.ghost, 0);
    assert.equal(row.stale, 2);
    assert.equal(hasSearchIndexHealthIssues([row]), true);
});

test("buildSearchIndexHealthReport aggregates totals and status", () => {
    const healthy = normalizeSearchIndexHealthRow({
        entity_family: "places",
        search_entity_type: "place",
        canonical_count: 10n,
        indexed_count: 10n,
        missing_count: 0n,
        ghost_count: 0n,
        stale_count: 0n,
        latest_indexed_at: new Date("2026-07-10T00:00:00.000Z"),
        latest_source_updated_at: new Date("2026-07-10T00:00:00.000Z"),
    });
    const unhealthy = normalizeSearchIndexHealthRow({
        entity_family: "addresses",
        search_entity_type: "address",
        canonical_count: 5n,
        indexed_count: 4n,
        missing_count: 1n,
        ghost_count: 0n,
        stale_count: 0n,
        latest_indexed_at: null,
        latest_source_updated_at: null,
    });

    const report = buildSearchIndexHealthReport([healthy, unhealthy], {
        latest: {
            id: 9n,
            status: "failed",
            started_at: new Date("2026-07-09T00:00:00.000Z"),
            finished_at: new Date("2026-07-09T01:00:00.000Z"),
            entity_counts: { place: 10 },
        },
        lastSuccessful: {
            id: 8n,
            status: "completed",
            started_at: new Date("2026-07-08T00:00:00.000Z"),
            finished_at: new Date("2026-07-08T02:00:00.000Z"),
            entity_counts: { place: 10 },
        },
    }, { now: new Date("2026-07-10T12:00:00.000Z") });

    assert.equal(report.overall_status, "unhealthy");
    assert.equal(report.overall_severity, "critical");
    assert.equal(report.health_query_ok, true);
    assert.equal(report.totals.indexed_count, 14);
    assert.equal(report.totals.missing_count, 1);
    assert.equal(report.families[0]?.status, "healthy");
    assert.equal(report.families[0]?.severity, "healthy");
    assert.equal(report.families[1]?.status, "unhealthy");
    assert.equal(report.families[1]?.severity, "critical");
    assert.ok(
        report.families[1]?.severity_reasons.some((reason) => reason.includes("no indexed rows")),
    );
    assert.ok(report.overall_severity_reasons.includes("latest rebuild run failed"));
    assert.equal(report.last_rebuild_run?.status, "failed");
    assert.equal(report.last_successful_run?.id, "8");
    assert.equal(report.last_successful_run?.status, "completed");
});

test("buildSearchIndexHealthReport does not warn when latest rebuild completed", () => {
    const healthy = normalizeSearchIndexHealthRow({
        entity_family: "places",
        search_entity_type: "place",
        canonical_count: 10n,
        indexed_count: 10n,
        missing_count: 0n,
        ghost_count: 0n,
        stale_count: 0n,
        latest_indexed_at: new Date("2026-07-10T00:00:00.000Z"),
        latest_source_updated_at: new Date("2026-07-10T00:00:00.000Z"),
    });
    const finishedAt = new Date("2026-07-10T00:00:00.000Z");

    const report = buildSearchIndexHealthReport([healthy], {
        latest: {
            id: 12n,
            status: "completed",
            started_at: new Date("2026-07-09T22:00:00.000Z"),
            finished_at: finishedAt,
            entity_counts: { place: 10 },
        },
        lastSuccessful: {
            id: 12n,
            status: "completed",
            started_at: new Date("2026-07-09T22:00:00.000Z"),
            finished_at: finishedAt,
            entity_counts: { place: 10 },
        },
    }, { now: new Date("2026-07-10T12:00:00.000Z") });

    assert.equal(report.last_rebuild_run?.status, "completed");
    assert.equal(report.last_successful_run?.status, "completed");
    assert.equal(report.overall_severity, "healthy");
    assert.ok(!report.overall_severity_reasons.includes("no successful rebuild recorded"));
});

test("buildFailedSearchIndexHealthReport marks health query failure as critical", () => {
    const report = buildFailedSearchIndexHealthReport(new Error("connection refused"));
    assert.equal(report.health_query_ok, false);
    assert.equal(report.overall_severity, "critical");
    assert.equal(report.overall_status, "unhealthy");
    assert.equal(report.health_query_error, "connection refused");
});
