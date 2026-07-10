import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    normalizePublicSearchLang,
    resolvePublicSearchDisplayName,
} from "./public-search-language.js";

describe("normalizePublicSearchLang", () => {
    it("accepts supported language codes", () => {
        assert.equal(normalizePublicSearchLang("my"), "my");
        assert.equal(normalizePublicSearchLang("EN"), "en");
        assert.equal(normalizePublicSearchLang(" und "), "und");
    });

    it("rejects unsupported values", () => {
        assert.equal(normalizePublicSearchLang("both"), null);
        assert.equal(normalizePublicSearchLang(""), null);
        assert.equal(normalizePublicSearchLang(undefined), null);
    });
});

describe("resolvePublicSearchDisplayName", () => {
    const names = {
        displayName: "Indexed Display",
        primaryNameMy: "မြန်မာအမည်",
        primaryNameEn: "English Name",
        primaryNameUnd: "Undetermined Name",
    };

    it("prefers Myanmar when lang=my", () => {
        assert.equal(resolvePublicSearchDisplayName("my", names), "မြန်မာအမည်");
    });

    it("prefers English when lang=en", () => {
        assert.equal(resolvePublicSearchDisplayName("en", names), "English Name");
    });

    it("falls back when requested language is missing", () => {
        assert.equal(
            resolvePublicSearchDisplayName("en", {
                displayName: "Indexed Display",
                primaryNameMy: "မြန်မာအမည်",
                primaryNameEn: null,
            }),
            "မြန်မာအမည်",
        );
    });

    it("uses und chain when lang=und", () => {
        assert.equal(resolvePublicSearchDisplayName("und", names), "Undetermined Name");
        assert.equal(
            resolvePublicSearchDisplayName("und", {
                displayName: "Indexed Display",
                primaryNameMy: "မြန်မာအမည်",
                primaryNameEn: "English Name",
                primaryNameUnd: null,
            }),
            "မြန်မာအမည်",
        );
    });

    it("uses default my → en → und → display when lang is omitted", () => {
        assert.equal(resolvePublicSearchDisplayName(null, names), "မြန်မာအမည်");
        assert.equal(
            resolvePublicSearchDisplayName(null, {
                displayName: "Indexed Display",
                primaryNameMy: null,
                primaryNameEn: "English Name",
            }),
            "English Name",
        );
        assert.equal(
            resolvePublicSearchDisplayName(null, {
                displayName: "Indexed Display",
                primaryNameMy: null,
                primaryNameEn: null,
                primaryNameUnd: null,
            }),
            "Indexed Display",
        );
    });

    it("does not invent translations from missing fields", () => {
        assert.equal(
            resolvePublicSearchDisplayName("my", {
                displayName: "Only Display",
                primaryNameMy: null,
                primaryNameEn: null,
                primaryNameUnd: null,
            }),
            "Only Display",
        );
    });
});
