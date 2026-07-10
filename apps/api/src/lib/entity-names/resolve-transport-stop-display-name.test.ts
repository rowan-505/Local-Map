import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveTransportStopDisplayName } from "./resolve-transport-stop-display-name.js";

describe("resolveTransportStopDisplayName", () => {
    it("prefers selected Myanmar primary name", () => {
        assert.equal(
            resolveTransportStopDisplayName({
                lang: "my",
                name_mm: "ထိပ်",
                name_en: "Tit Htate",
                name_und: null,
                canonical_name: "Sitepyoyay",
            }),
            "ထိပ်",
        );
    });

    it("prefers selected English primary name", () => {
        assert.equal(
            resolveTransportStopDisplayName({
                lang: "en",
                name_mm: "ထိပ်",
                name_en: "Tit Htate",
                name_und: null,
                canonical_name: "Sitepyoyay",
            }),
            "Tit Htate",
        );
    });

    it("falls back my → en → und → canonical when selected language is missing", () => {
        assert.equal(
            resolveTransportStopDisplayName({
                lang: "en",
                name_mm: "မြန်မာ",
                name_en: null,
                name_und: "und-name",
                canonical_name: "raw-cache",
            }),
            "မြန်မာ",
        );

        assert.equal(
            resolveTransportStopDisplayName({
                lang: "my",
                name_mm: null,
                name_en: "English Stop",
                name_und: null,
                canonical_name: "raw-cache",
            }),
            "English Stop",
        );

        assert.equal(
            resolveTransportStopDisplayName({
                lang: "en",
                name_mm: null,
                name_en: null,
                name_und: "und-name",
                canonical_name: "raw-cache",
            }),
            "und-name",
        );

        assert.equal(
            resolveTransportStopDisplayName({
                lang: "my",
                name_mm: null,
                name_en: null,
                name_und: null,
                canonical_name: "raw-cache",
            }),
            "raw-cache",
        );
    });

    it("uses type fallback when no names exist", () => {
        assert.equal(
            resolveTransportStopDisplayName({
                name_mm: null,
                name_en: null,
                name_und: null,
                canonical_name: null,
                typeFallback: "Unnamed bus stop",
            }),
            "Unnamed bus stop",
        );
    });
});
