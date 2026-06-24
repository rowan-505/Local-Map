import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    BUILDING_TYPE_FALLBACK_CODES,
    IMPORT_REVIEW_DEFAULT_CONFIDENCE_SCORE,
    IMPORT_REVIEW_ESSENTIAL_FIELD_RULES,
    POI_CATEGORY_FALLBACK_CODES,
    ROAD_CLASS_FALLBACK_CODES,
    essentialFieldKeysForFamily,
    isGeometryEssentialForFamily,
} from "./import-review-essential-fields.js";

describe("import-review-essential-fields", () => {
    it("defines place name-or and category essentials", () => {
        const keys = essentialFieldKeysForFamily("places");
        assert.equal(keys.has("name_mm"), true);
        assert.equal(keys.has("name_en"), true);
        assert.equal(keys.has("category_id"), true);
        assert.equal(keys.has("admin_area_id"), true);
        assert.equal(isGeometryEssentialForFamily("places"), true);
    });

    it("uses 0-100 default confidence constant", () => {
        assert.equal(IMPORT_REVIEW_DEFAULT_CONFIDENCE_SCORE, 65);
    });

    it("lists safe ref fallback codes without inventing ids", () => {
        assert.ok(POI_CATEGORY_FALLBACK_CODES.includes("unknown"));
        assert.ok(BUILDING_TYPE_FALLBACK_CODES.includes("unknown"));
        assert.ok(ROAD_CLASS_FALLBACK_CODES.length > 0);
    });

    it("covers scoped entity families", () => {
        for (const family of [
            "places",
            "roads",
            "buildings",
            "landuse",
            "water_lines",
            "water_polygons",
        ] as const) {
            assert.ok((IMPORT_REVIEW_ESSENTIAL_FIELD_RULES[family]?.length ?? 0) > 0);
        }
    });
});
