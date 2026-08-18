import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    isTownshipAdminEntity,
    townshipAdminEntities,
    townshipAdminEntityInferKind,
    townshipAdminEntityGeometryRole,
    TOWNSHIP_ADMIN_ENTITY_SLUGS,
} from "./township-admin-policy.js";

describe("township-admin-policy", () => {
    it("lists township-default core-review slugs", () => {
        assert.deepEqual([...TOWNSHIP_ADMIN_ENTITY_SLUGS], [
            "streets",
            "places",
            "buildings",
            "land-areas",
            "bus-stops",
        ]);
        assert.equal(townshipAdminEntities, TOWNSHIP_ADMIN_ENTITY_SLUGS);
    });

    it("excludes addresses from township-only policy (generic multi-level admin_area_id)", () => {
        assert.equal(isTownshipAdminEntity("addresses"), false);
        assert.equal(isTownshipAdminEntity("water-lines"), false);
        assert.equal(isTownshipAdminEntity("bus-routes"), false);
    });

    it("maps slugs to infer kinds", () => {
        assert.equal(townshipAdminEntityInferKind("streets"), "street");
        assert.equal(townshipAdminEntityInferKind("places"), "place");
        assert.equal(townshipAdminEntityInferKind("bus-stops"), "bus_stop");
        assert.equal(townshipAdminEntityInferKind("buildings"), "building");
        assert.equal(townshipAdminEntityInferKind("land-areas"), "land_area");
    });

    it("maps slugs to geometry roles", () => {
        assert.equal(townshipAdminEntityGeometryRole("streets"), "line");
        assert.equal(townshipAdminEntityGeometryRole("bus-stops"), "point");
        assert.equal(townshipAdminEntityGeometryRole("land-areas"), "polygon");
    });
});
