import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    isWithinServiceArea,
    plusCodePinResult,
    plusCodeReferenceRequiredResult,
} from "./public-map.service.js";

describe("isWithinServiceArea", () => {
    it("returns true for a Yangon coordinate", () => {
        // Kyauktan-ish, well inside Myanmar.
        assert.equal(isWithinServiceArea(16.659, 96.3168), true);
    });

    it("returns true near national edges", () => {
        assert.equal(isWithinServiceArea(9.5, 92.5), true);
        assert.equal(isWithinServiceArea(28.5, 101.5), true);
    });

    it("returns false outside Myanmar", () => {
        // London.
        assert.equal(isWithinServiceArea(51.5074, -0.1278), false);
        // Tokyo.
        assert.equal(isWithinServiceArea(35.6762, 139.65), false);
        // Mumbai (west of the envelope).
        assert.equal(isWithinServiceArea(19.076, 72.8777), false);
    });

    it("returns false for non-finite input", () => {
        assert.equal(isWithinServiceArea(Number.NaN, 96), false);
        assert.equal(isWithinServiceArea(16, Number.POSITIVE_INFINITY), false);
    });
});

describe("plusCodeReferenceRequiredResult", () => {
    it("builds a reference-required pin with no center", () => {
        const result = plusCodeReferenceRequiredResult("VMP3+RX");
        assert.equal(result.type, "plus_code");
        assert.equal(result.referenceRequired, true);
        assert.equal(result.reason, "REFERENCE_REQUIRED");
        assert.equal(result.center, null);
        assert.equal(result.lat, null);
        assert.equal(result.lng, null);
        assert.equal(result.hasGeometry, false);
        assert.equal(result.plus_code, "VMP3+RX");
        assert.equal(result.cameraTarget, undefined);
    });
});

describe("plusCodePinResult", () => {
    it("builds a resolved pin with reverse fields and camera target", () => {
        const reverse = {
            nearbyName: "Kyauktan Market",
            nearbyType: "market",
            nearbyDistanceM: 42,
            township: "Kyauktan",
            district: "South Yangon",
            regionState: "Yangon",
            country: "Myanmar",
            confidence: "high",
        };
        const result = plusCodePinResult("6PH58Q9V+XX", 16.659, 96.3168, reverse, false);
        assert.equal(result.type, "plus_code");
        assert.equal(result.geometryType, "Point");
        assert.equal(result.hasGeometry, true);
        assert.equal(result.outsideServiceArea, false);
        assert.equal(result.referenceRequired, false);
        assert.deepEqual(result.center, [96.3168, 16.659]);
        assert.deepEqual(result.cameraTarget, {
            type: "point",
            center: [96.3168, 16.659],
            zoom: 18,
        });
        assert.equal(result.subtitle, "Kyauktan Market");
        assert.deepEqual(result.reverse, reverse);
    });

    it("builds an outside-service-area pin without forcing a nearest place", () => {
        const result = plusCodePinResult("9C3XGV00+00", 51.5074, -0.1278, null, true);
        assert.equal(result.outsideServiceArea, true);
        assert.equal(result.reverse, null);
        assert.equal(result.hasGeometry, true);
        assert.deepEqual(result.center, [-0.1278, 51.5074]);
        assert.equal(result.subtitle, "Plus Code");
    });
});
