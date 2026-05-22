import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    BUILDING_TYPE_FALLBACK_CODES,
    IMPORT_REVIEW_BUS_STOP_UNNAMED_NAME_MM,
    IMPORT_REVIEW_DEFAULT_CONFIDENCE_SCORE,
    IMPORT_REVIEW_ESSENTIAL_FIELD_RULES,
    POI_CATEGORY_FALLBACK_CODES,
    ROAD_CLASS_FALLBACK_CODES,
    essentialFieldKeysForFamily,
    isGeometryEssentialForFamily,
} from "./import-review-essential-fields.js";
import {
    deriveImportedNameEn,
    deriveImportedNameMm,
} from "./import-review-name-fields.js";

describe("import-review-essential-fields", () => {
    it("defines bus stop essentials including geometry", () => {
        assert.deepEqual(essentialFieldKeysForFamily("bus_stops"), new Set(["name_mm", "admin_area_id"]));
        assert.equal(isGeometryEssentialForFamily("bus_stops"), true);
    });

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
        assert.ok(BUILDING_TYPE_FALLBACK_CODES.includes("yes"));
        assert.ok(ROAD_CLASS_FALLBACK_CODES.length > 0);
    });

    it("covers scoped entity families", () => {
        for (const family of [
            "bus_stops",
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

describe("bus stop name_mm default chain", () => {
    it("prefers imported Myanmar then English then unnamed label", () => {
        const mm = deriveImportedNameMm({
            canonical_name: "Stop",
            normalized_data: { tags: { name: "ဘတ်စ်မှတ်တိုင်" } },
        });
        assert.equal(mm, "ဘတ်စ်မှတ်တိုင်");

        const enOnly = deriveImportedNameEn({
            normalized_data: { tags: { "name:en": "Main Stop" } },
        });
        assert.equal(enOnly, "Main Stop");

        const fallback =
            deriveImportedNameMm({ normalized_data: { tags: { "name:en": "Main Stop" } } }) ??
            deriveImportedNameEn({ normalized_data: { tags: { "name:en": "Main Stop" } } }) ??
            IMPORT_REVIEW_BUS_STOP_UNNAMED_NAME_MM;
        assert.equal(fallback, "Main Stop");
    });

    it("falls back to unnamed bus stop when no names exist", () => {
        const fallback =
            deriveImportedNameMm({}) ??
            deriveImportedNameEn({}) ??
            IMPORT_REVIEW_BUS_STOP_UNNAMED_NAME_MM;
        assert.equal(fallback, IMPORT_REVIEW_BUS_STOP_UNNAMED_NAME_MM);
    });
});
