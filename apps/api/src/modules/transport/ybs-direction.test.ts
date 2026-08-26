import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { canonicalYbsVariantIdentity, isCanonicalYbsRoute } from "./ybs-direction.js";

describe("canonical YBS direction identity", () => {
    it("maps direction_id 0 and 1 to neutral D0/D1 identities", () => {
        assert.deepEqual(canonicalYbsVariantIdentity("YBS-7-A", 0), {
            directionId: 0,
            directionName: "D0",
            variantCode: "YBS-7-A-D0",
        });
        assert.deepEqual(canonicalYbsVariantIdentity("YBS-7-A", 1), {
            directionId: 1,
            directionName: "D1",
            variantCode: "YBS-7-A-D1",
        });
    });

    it("rejects noncanonical direction ids without assigning geography", () => {
        assert.equal(canonicalYbsVariantIdentity("YBS-1", null), null);
        assert.equal(canonicalYbsVariantIdentity("YBS-1", 2), null);
    });

    it("requires both bus mode and the YBS- route prefix", () => {
        assert.equal(isCanonicalYbsRoute("bus", "YBS-1"), true);
        assert.equal(isCanonicalYbsRoute("train", "YBS-1"), false);
        assert.equal(isCanonicalYbsRoute("bus", "APS-1"), false);
        assert.equal(isCanonicalYbsRoute("express_bus", "YBS-1"), false);
    });
});
