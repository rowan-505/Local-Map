import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildRoadReviewOverridesPatch } from "./importReviewRoadOverridesPayload";
import { normalizeNullableNumber, resolveRoadLayerOverride } from "./normalizeNullableNumber";

describe("normalizeNullableNumber", () => {
    it("coerces empty and numeric strings", () => {
        assert.equal(normalizeNullableNumber(""), null);
        assert.equal(normalizeNullableNumber(undefined), null);
        assert.equal(normalizeNullableNumber(null), null);
        assert.equal(normalizeNullableNumber("0"), 0);
        assert.equal(normalizeNullableNumber("1"), 1);
        assert.equal(normalizeNullableNumber("-1"), -1);
        assert.equal(normalizeNullableNumber(2), 2);
    });
});

describe("resolveRoadLayerOverride", () => {
    it("defaults bridge to layer 1 and tunnel to layer -1 when empty", () => {
        assert.equal(
            resolveRoadLayerOverride({ layer: "", bridge: true, tunnel: false }),
            1
        );
        assert.equal(
            resolveRoadLayerOverride({ layer: "", bridge: false, tunnel: true }),
            -1
        );
        assert.equal(
            resolveRoadLayerOverride({ layer: "", bridge: false, tunnel: false }),
            null
        );
    });

    it("keeps explicit layer values", () => {
        assert.equal(
            resolveRoadLayerOverride({ layer: "0", bridge: true, tunnel: false }),
            0
        );
    });
});

describe("buildRoadReviewOverridesPatch", () => {
    const base = {
        nameMm: "",
        nameEn: "",
        roadClassId: "6",
        adminAreaId: null,
        surface: "",
        isOneway: false,
        bridge: false,
        tunnel: false,
        layer: "",
        access: "",
        speedKph: "",
        includeGeom: false,
    };

    it("never sends layer as a string", () => {
        const patch = buildRoadReviewOverridesPatch(base);
        assert.equal(patch.layer, null);
        assert.notEqual(typeof patch.layer, "string");

        const zero = buildRoadReviewOverridesPatch({ ...base, layer: "0" });
        assert.equal(zero.layer, 0);

        const bridge = buildRoadReviewOverridesPatch({ ...base, bridge: true, layer: "" });
        assert.equal(bridge.layer, 1);
    });

    it("omits road_class_id when unset instead of sending null", () => {
        const patch = buildRoadReviewOverridesPatch({ ...base, roadClassId: "" });
        assert.equal("road_class_id" in patch, false);
        assert.equal("road_class_code" in patch, false);
    });

    it("sends road_class_code when id missing but code provided", () => {
        const patch = buildRoadReviewOverridesPatch({
            ...base,
            roadClassId: "",
            roadClassCode: "secondary",
        });
        assert.equal(patch.road_class_code, "secondary");
        assert.equal("road_class_id" in patch, false);
    });
});
