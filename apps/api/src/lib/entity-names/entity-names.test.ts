import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    ENGLISH_LANGUAGE_CODE,
    MYANMAR_LANGUAGE_CODE,
    deriveCoalescedDisplayName,
    trimName,
} from "./derive-display-name.js";
import { BUILDING_NAMES_CONFIG, LAND_AREA_NAMES_CONFIG } from "./sync-primary-names.js";

describe("language code constants", () => {
    it("uses my for Myanmar and en for English", () => {
        assert.equal(MYANMAR_LANGUAGE_CODE, "my");
        assert.equal(ENGLISH_LANGUAGE_CODE, "en");
    });

    it("entity name configs persist Myanmar rows as language_code=my", () => {
        assert.equal(BUILDING_NAMES_CONFIG(1n).namesTable, "core.core_building_names");
        assert.equal(LAND_AREA_NAMES_CONFIG(2n).namesTable, "core.core_land_area_names");
    });
});

describe("deriveCoalescedDisplayName", () => {
    it("prefers Myanmar then English then fallback", () => {
        assert.equal(
            deriveCoalescedDisplayName({
                name_mm: "ကျောက်တန်း",
                name_en: "Kyauktan",
                fallback_name: "imported",
            }),
            "ကျောက်တန်း"
        );
        assert.equal(
            deriveCoalescedDisplayName({
                name_mm: null,
                name_en: "Kyauktan",
                fallback_name: "imported",
            }),
            "Kyauktan"
        );
        assert.equal(
            deriveCoalescedDisplayName({
                name_mm: null,
                name_en: null,
                fallback_name: "imported",
            }),
            "imported"
        );
    });

    it("trimName treats blank as null", () => {
        assert.equal(trimName("  hello  "), "hello");
        assert.equal(trimName(""), null);
        assert.equal(trimName(undefined), null);
    });

    it("edit only Myanmar name: display uses mm", () => {
        assert.equal(
            deriveCoalescedDisplayName({
                name_mm: "မြန်မာ",
                name_en: null,
                fallback_name: "osm-import",
            }),
            "မြန်မာ"
        );
    });

    it("edit only English name: display uses en", () => {
        assert.equal(
            deriveCoalescedDisplayName({
                name_mm: null,
                name_en: "English",
                fallback_name: "osm-import",
            }),
            "English"
        );
    });

    it("edit both: display prefers Myanmar", () => {
        assert.equal(
            deriveCoalescedDisplayName({
                name_mm: "မြန်မာ",
                name_en: "English",
                fallback_name: null,
            }),
            "မြန်မာ"
        );
    });

    it("clear localized names: display falls back to imported column", () => {
        assert.equal(
            deriveCoalescedDisplayName({
                name_mm: null,
                name_en: null,
                fallback_name: "legacy-building-name",
            }),
            "legacy-building-name"
        );
    });
});
