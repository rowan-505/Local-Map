import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    buildBuildingTypeRef,
    resolveBuildingTypeCode,
    resolveBuildingTypeName,
} from "./building-type-response.js";

describe("building-type-response", () => {
    it("prefers ref join code over class_code", () => {
        assert.equal(
            resolveBuildingTypeCode({
                building_type_code: "residential",
                class_code: "house",
            }),
            "residential"
        );
    });

    it("falls back to class_code when ref join is missing", () => {
        assert.equal(
            resolveBuildingTypeCode({
                building_type_code: null,
                class_code: "commercial",
            }),
            "commercial"
        );
    });

    it("builds ref from code and building_type_id when name join is missing", () => {
        const ref = buildBuildingTypeRef({
            building_type_id: "42",
            building_type_code: "education",
            building_type_name: null,
            class_code: "school",
        });
        assert.deepEqual(ref, {
            id: "42",
            code: "education",
            name: "education",
            name_mm: null,
            parent_id: null,
        });
    });

    it("uses ref names when present", () => {
        assert.equal(
            resolveBuildingTypeName(
                {
                    building_type_name: "Residential",
                    ref_bt_name: "Ignored",
                },
                "residential"
            ),
            "Residential"
        );
    });
});
