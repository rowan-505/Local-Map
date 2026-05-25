import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    CORE_VERIFICATION_ENTITY_FAMILIES,
    coreVerificationExistsSql,
} from "./import-review-publish-batch-core-verification.js";

describe("publish batch core verification SQL", () => {
    it("covers all promotable entity families without legacy bs.name columns", () => {
        assert.deepEqual(CORE_VERIFICATION_ENTITY_FAMILIES, [
            "buildings",
            "places",
            "landuse",
            "water_lines",
            "water_polygons",
            "bus_routes",
            "bus_route_variants",
            "bus_route_stops",
            "bus_stops",
            "roads",
            "admin_areas",
            "routing_barriers",
        ]);
        for (const family of CORE_VERIFICATION_ENTITY_FAMILIES) {
            const sql = coreVerificationExistsSql(family).strings.join("");
            if (family !== "bus_route_variants" && family !== "bus_route_stops") {
                assert.match(sql, /source_refs->>'publish_batch_id'/);
                assert.match(sql, /source_refs->>'review_candidate_id'/);
            }
            assert.doesNotMatch(sql, /\bbs\.name\b/);
        }
        const adminSql = coreVerificationExistsSql("admin_areas").strings.join("");
        assert.match(adminSql, /core_admin_areas/);
        assert.match(adminSql, /core_admin_area_names/);
        const busRouteSql = coreVerificationExistsSql("bus_routes").strings.join("");
        assert.match(busRouteSql, /core_bus_routes/);
        assert.match(busRouteSql, /core_bus_route_names/);
        const busRouteVariantSql = coreVerificationExistsSql("bus_route_variants").strings.join("");
        assert.match(busRouteVariantSql, /core_bus_route_variants/);
        assert.match(busRouteVariantSql, /ST_LineString/);
        const busRouteStopSql = coreVerificationExistsSql("bus_route_stops").strings.join("");
        assert.match(busRouteStopSql, /core_bus_route_stops/);
        assert.match(busRouteStopSql, /relation_key/);
        const barrierSql = coreVerificationExistsSql("routing_barriers").strings.join("");
        assert.match(barrierSql, /routing_barriers/);
        assert.match(barrierSql, /routing_barrier_dry_run/);
    });
});
