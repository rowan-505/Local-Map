import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { deriveCoalescedDisplayName, trimName } from "./derive-display-name.js";

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
