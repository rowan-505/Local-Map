import assert from "node:assert/strict";
import test from "node:test";

import {
    expandSearchEntityTypeFilters,
    normalizeTransportSearchEntityType,
    readTransportSearchDocumentMetadata,
    serializePublicTransportSearchFields,
} from "./transport-search-entity.js";

test("normalizeTransportSearchEntityType maps legacy bus_* aliases", () => {
    assert.equal(normalizeTransportSearchEntityType("bus_stop"), "transport_stop");
    assert.equal(normalizeTransportSearchEntityType("bus_route"), "transport_route");
    assert.equal(normalizeTransportSearchEntityType("bus_route_variant"), "transport_route_variant");
    assert.equal(normalizeTransportSearchEntityType("transport_stop"), "transport_stop");
});

test("expandSearchEntityTypeFilters includes legacy and canonical transport types", () => {
    const expanded = expandSearchEntityTypeFilters(["bus_stop", "transport_route"]);
    assert.ok(expanded.includes("bus_stop"));
    assert.ok(expanded.includes("transport_stop"));
    assert.ok(expanded.includes("bus_route"));
    assert.ok(expanded.includes("transport_route"));
});

test("readTransportSearchDocumentMetadata extracts mode and stop_type", () => {
    const metadata = readTransportSearchDocumentMetadata({
        mode: "train",
        stop_type: "station",
        review_status: "verified",
        verification_status: "verified",
    });
    assert.equal(metadata.mode, "train");
    assert.equal(metadata.stop_type, "station");
    assert.equal(metadata.review_status, "verified");
});

test("serializePublicTransportSearchFields returns canonical entity type and transport fields", () => {
    const fields = serializePublicTransportSearchFields(
        "bus_stop",
        { mode: "ferry", stop_type: "ferry_landing", review_status: "reviewed" },
        "ferry",
    );
    assert.equal(fields.entityType, "transport_stop");
    assert.equal(fields.mode, "ferry");
    assert.equal(fields.stopType, "ferry_landing");
    assert.equal(fields.reviewStatus, "reviewed");
});

test("serializePublicTransportSearchFields supports train station rows", () => {
    const fields = serializePublicTransportSearchFields(
        "transport_stop",
        { mode: "train", stop_type: "station", review_status: "verified", verification_status: "verified" },
        "train",
    );
    assert.equal(fields.entityType, "transport_stop");
    assert.equal(fields.mode, "train");
    assert.equal(fields.stopType, "station");
    assert.equal(fields.verificationStatus, "verified");
});

test("serializePublicTransportSearchFields supports express route rows", () => {
    const fields = serializePublicTransportSearchFields(
        "transport_route",
        {
            mode: "express",
            review_status: "reviewed",
            route_code: "EXP-12",
            origin_name: "Yangon",
            destination_name: "Mandalay",
        },
        "express",
    );
    assert.equal(fields.entityType, "transport_route");
    assert.equal(fields.mode, "express");
    assert.equal(fields.routeCode, "EXP-12");
    assert.equal(fields.originName, "Yangon");
    assert.equal(fields.destinationName, "Mandalay");
});

test("serializePublicTransportSearchFields exposes variant route identity", () => {
    const fields = serializePublicTransportSearchFields(
        "transport_route_variant",
        {
            mode: "bus",
            review_status: "reviewed",
            route_code: "YBS-36",
            parent_route_public_id: "route-abc",
            variant_code: "outbound",
            headsign: "To Downtown",
            direction_name: "Outbound",
        },
        "bus",
    );
    assert.equal(fields.entityType, "transport_route_variant");
    assert.equal(fields.routeCode, "YBS-36");
    assert.equal(fields.parentRoutePublicId, "route-abc");
    assert.equal(fields.headsign, "To Downtown");
    assert.equal(fields.directionName, "Outbound");
});
