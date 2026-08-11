import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    extractBuildingNamesFromOsmTags,
    normalizeBuildingNameEntries,
    pickBuildingDisplayName,
} from "./extract-building-osm-names.js";

describe("extractBuildingNamesFromOsmTags", () => {
    it("creates separate Myanmar and English rows", () => {
        const names = extractBuildingNamesFromOsmTags({
            "name:my": "ဈေး",
            "name:en": "Market",
        });
        assert.equal(names.length, 2);
        assert.equal(names.find((n) => n.languageCode === "my")?.name, "ဈေး");
        assert.equal(names.find((n) => n.languageCode === "en")?.name, "Market");
        assert.equal(names.find((n) => n.languageCode === "my")?.isPrimary, true);
        assert.equal(names.find((n) => n.languageCode === "en")?.isPrimary, true);
    });

    it("normalizes name:mm to language_code my", () => {
        const names = extractBuildingNamesFromOsmTags({ "name:mm": "ကျောင်း" });
        assert.equal(names.length, 1);
        assert.equal(names[0]?.languageCode, "my");
        assert.equal(names[0]?.nameType, "imported");
    });

    it("rejects blank and whitespace-only names", () => {
        assert.deepEqual(extractBuildingNamesFromOsmTags({ name: "   ", "name:en": "" }), []);
        assert.deepEqual(extractBuildingNamesFromOsmTags({ "name:my": null as unknown as string }), []);
    });

    it("classifies unsuffixed Myanmar script as my", () => {
        const names = extractBuildingNamesFromOsmTags({ name: "ဘုရား" });
        assert.equal(names[0]?.languageCode, "my");
    });

    it("classifies unsuffixed name equal to name:en as en", () => {
        const names = extractBuildingNamesFromOsmTags({ name: "School", "name:en": "School" });
        assert.equal(names.length, 1);
        assert.equal(names[0]?.languageCode, "en");
    });

    it("marks uncertain latin unsuffixed name as und", () => {
        const names = extractBuildingNamesFromOsmTags({ name: "Bld-12" });
        assert.equal(names[0]?.languageCode, "und");
    });
});

describe("pickBuildingDisplayName", () => {
    it("prefers official primary over imported", () => {
        const display = pickBuildingDisplayName([
            {
                name: "Imported",
                languageCode: "en",
                nameType: "imported",
                isPrimary: true,
                searchWeight: 100,
            },
            {
                name: "Official",
                languageCode: "en",
                nameType: "official",
                isPrimary: true,
                searchWeight: 50,
            },
        ]);
        assert.equal(display, "Official");
    });
});

describe("normalizeBuildingNameEntries", () => {
    it("maps mm to my and drops blanks", () => {
        const names = normalizeBuildingNameEntries([
            { name: "  ", language_code: "my" },
            { name: "Foo", language_code: "mm" },
            { name: "Bar", languageCode: "en", nameType: "local", isPrimary: true },
        ]);
        assert.equal(names.length, 2);
        assert.equal(names[0]?.languageCode, "my");
        assert.equal(names[1]?.nameType, "local");
    });
});
