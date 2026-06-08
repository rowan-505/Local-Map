import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { mapCoreReviewStreetCreate, mapCoreReviewStreetPatch } from "./core-review-write.mappers.js";

describe("mapCoreReviewStreetCreate", () => {
    it("maps name_mm to myanmarName and name_en to englishName", () => {
        const mapped = mapCoreReviewStreetCreate({
            geometry: { type: "LineString", coordinates: [[96.1, 16.8], [96.2, 16.9]] },
            name_mm: "မြန်မာလမ်း",
            name_en: "Myanmar Road",
            road_class_id: "1",
        });

        assert.equal(mapped.myanmarName, "မြန်မာလမ်း");
        assert.equal(mapped.englishName, "Myanmar Road");
    });

    it("prefers myanmarName alias over name_mm when both are present", () => {
        const mapped = mapCoreReviewStreetCreate({
            geometry: { type: "LineString", coordinates: [[96.1, 16.8], [96.2, 16.9]] },
            myanmarName: "Alias MM",
            name_mm: "Field MM",
            road_class_id: "1",
        });

        assert.equal(mapped.myanmarName, "Alias MM");
    });
});

describe("mapCoreReviewStreetPatch", () => {
    it("maps name_mm patch to myanmarName for street updates", () => {
        const mapped = mapCoreReviewStreetPatch({
            name_mm: "အမည်ပြင်",
            name_en: "Renamed Road",
        });

        assert.equal(mapped.myanmarName, "အမည်ပြင်");
        assert.equal(mapped.englishName, "Renamed Road");
    });

    it("omits myanmarName when name_mm is not provided", () => {
        const mapped = mapCoreReviewStreetPatch({
            name_en: "English only",
        });

        assert.equal(mapped.myanmarName, undefined);
        assert.equal(mapped.englishName, "English only");
    });
});
