import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    ACTIVE_BUILDING_TYPE_CODES,
    classifyBuildingTypeCode,
    isActiveBuildingTypeCode,
} from "./classify-building-type-code.js";

describe("classifyBuildingTypeCode", () => {
    it("keeps active simple codes unchanged", () => {
        assert.deepEqual(classifyBuildingTypeCode("residential"), {
            code: "residential",
            sourceCode: null,
        });
        assert.equal(isActiveBuildingTypeCode("warehouse_storage"), true);
    });

    it("maps detailed legacy ref codes to flat types", () => {
        assert.deepEqual(classifyBuildingTypeCode("house"), {
            code: "residential",
            sourceCode: "house",
        });
        assert.deepEqual(classifyBuildingTypeCode("shopping_mall"), {
            code: "commercial",
            sourceCode: "shopping_mall",
        });
        assert.deepEqual(classifyBuildingTypeCode("warehouse"), {
            code: "warehouse_storage",
            sourceCode: "warehouse",
        });
        assert.deepEqual(classifyBuildingTypeCode("recreation_entertainment"), {
            code: "recreation",
            sourceCode: "recreation_entertainment",
        });
    });

    it("maps OSM building=yes to unknown", () => {
        assert.deepEqual(classifyBuildingTypeCode("yes"), {
            code: "unknown",
            sourceCode: "yes",
        });
    });

    it("maps amenity-like OSM building tags to structural buckets only", () => {
        assert.deepEqual(classifyBuildingTypeCode("restaurant"), {
            code: "commercial",
            sourceCode: "restaurant",
        });
        assert.deepEqual(classifyBuildingTypeCode("school"), {
            code: "education",
            sourceCode: "school",
        });
    });

    it("maps unknown labels to unknown", () => {
        assert.deepEqual(classifyBuildingTypeCode("spaceship"), {
            code: "unknown",
            sourceCode: "spaceship",
        });
    });

    it("covers every listed active code", () => {
        assert.equal(ACTIVE_BUILDING_TYPE_CODES.length, 16);
    });
});
