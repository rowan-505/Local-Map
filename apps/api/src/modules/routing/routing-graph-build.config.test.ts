import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    isRoutingGraphBulkBuildEnabled,
    isRoutingGraphBuildEnabled,
    ROUTING_GRAPH_BUILD_CONTROLLED_MAX_ROADS,
    ROUTING_GRAPH_BUILD_DEFAULT_MAX_ROADS,
} from "./routing.config.js";

describe("routing graph build config", () => {
    it("requires ENABLE_ROUTING_GRAPH_BUILD", () => {
        const prev = process.env.ENABLE_ROUTING_GRAPH_BUILD;
        process.env.ENABLE_ROUTING_GRAPH_BUILD = "false";
        assert.equal(isRoutingGraphBuildEnabled(), false);
        process.env.ENABLE_ROUTING_GRAPH_BUILD = "true";
        assert.equal(isRoutingGraphBuildEnabled(), true);
        if (prev === undefined) {
            delete process.env.ENABLE_ROUTING_GRAPH_BUILD;
        } else {
            process.env.ENABLE_ROUTING_GRAPH_BUILD = prev;
        }
    });

    it("defaults max roads to 25 with controlled cap 100", () => {
        assert.equal(ROUTING_GRAPH_BUILD_DEFAULT_MAX_ROADS, 25);
        assert.equal(ROUTING_GRAPH_BUILD_CONTROLLED_MAX_ROADS, 100);
        const prev = process.env.ENABLE_ROUTING_GRAPH_BULK_BUILD;
        delete process.env.ENABLE_ROUTING_GRAPH_BULK_BUILD;
        assert.equal(isRoutingGraphBulkBuildEnabled(), false);
        if (prev === undefined) {
            delete process.env.ENABLE_ROUTING_GRAPH_BULK_BUILD;
        } else {
            process.env.ENABLE_ROUTING_GRAPH_BULK_BUILD = prev;
        }
    });
});
