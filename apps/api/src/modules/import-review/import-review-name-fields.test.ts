import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    deriveImportReviewNames,
    deriveImportedNameEn,
    deriveImportedNameMm,
    isMyanmarScript,
    looksLikeExternalRef,
    pickEffectiveNameEn,
    pickEffectiveNameMm,
} from "./import-review-name-fields.js";

describe("import-review-name-fields", () => {
    it("detects Myanmar script", () => {
        assert.equal(isMyanmarScript("Kyauktan"), false);
        assert.equal(isMyanmarScript("ကျောက်တန်း"), true);
    });

    it("derives bus stop Myanmar name from normalized_data tags", () => {
        const mm = deriveImportedNameMm({
            canonical_name: "Stop 1",
            normalized_data: { tags: { name: "မှတ်တိုင် ၁", "name:en": "Stop 1" } },
        });
        assert.equal(mm, "မှတ်တိုင် ၁");
    });

    it("does not use Latin canonical_name for Myanmar name", () => {
        const mm = deriveImportedNameMm({
            canonical_name: "Kyauktan Stop",
            normalized_data: { tags: {} },
        });
        assert.equal(mm, null);
    });

    it("derives English name from tags name:en", () => {
        const en = deriveImportedNameEn({
            canonical_name: "ကျောက်တန်း",
            normalized_data: { tags: { "name:en": "Kyauktan" } },
        });
        assert.equal(en, "Kyauktan");
    });

    it("reads review_overrides.name_mm before legacy keys", () => {
        const mm = pickEffectiveNameMm(
            { name_mm: "Override MM", name_local: "Legacy" },
            { canonical_name: "Imported" }
        );
        assert.equal(mm, "Override MM");
    });

    it("reads review_overrides.name_en before legacy name", () => {
        const en = pickEffectiveNameEn({ name_en: "Override EN", name: "Legacy EN" }, { canonical_name: "Imported EN" });
        assert.equal(en, "Override EN");
    });

    it("derives name_mm from tags name:my", () => {
        const mm = deriveImportedNameMm({
            canonical_name: "osm:W:382363624",
            normalized_data: {
                tags: { "name:my": "မြန်မာလမ်း" },
            },
        });
        assert.equal(mm, "မြန်မာလမ်း");
    });

    it("derives name_en from normalized_data tags name:en", () => {
        const en = deriveImportedNameEn({
            canonical_name: "osm:W:382363624",
            normalized_data: {
                tags: { "name:en": "Tag EN" },
            },
        });
        assert.equal(en, "Tag EN");
    });

    it("does not treat osm external refs as English names", () => {
        const en = deriveImportedNameEn({
            canonical_name: "osm:W:382363624",
            normalized_data: { tags: {} },
        });
        assert.equal(en, null);
    });

    it("detects osm external ref strings", () => {
        assert.equal(looksLikeExternalRef("osm:W:382363624"), true);
        assert.equal(looksLikeExternalRef("Kyauktan Road"), false);
    });

    it("does not use waterway/class values as English names", () => {
        const en = deriveImportedNameEn({
            canonical_name: "river",
            class_code: "river",
            normalized_data: {
                name: "river",
                tags: { waterway: "river" },
            },
        });
        assert.equal(en, null);
    });

    it("does not use landuse class as English name", () => {
        const en = deriveImportedNameEn({
            canonical_name: "industrial",
            class_code: "industrial",
            normalized_data: {
                name: "industrial",
                tags: { landuse: "industrial" },
            },
        });
        assert.equal(en, null);
    });

    it("uses real English tag name for water polygon", () => {
        const { name_mm, name_en } = deriveImportReviewNames({
            canonical_name: "pond",
            class_code: "pond",
            normalized_data: {
                tags: { name: "San Chain Mee Pound", water: "pond" },
            },
        });
        assert.equal(name_en, "San Chain Mee Pound");
        assert.equal(name_mm, null);
    });

    it("derives both bus stop names from tags", () => {
        const { name_mm, name_en } = deriveImportReviewNames({
            normalized_data: {
                tags: { name: "ဘတ်စ်မှတ်တိုင်", "name:en": "Bus Stop" },
            },
        });
        assert.equal(name_mm, "ဘတ်စ်မှတ်တိုင်");
        assert.equal(name_en, "Bus Stop");
    });

    it("derives child name candidates by language_code", () => {
        const { name_mm, name_en } = deriveImportReviewNames({
            normalized_data: {
                bus_stop_name_candidates: [
                    { language_code: "my", name: "မှတ်တိုင်" },
                    { language_code: "en", name: "Stop A" },
                ],
            },
        });
        assert.equal(name_mm, "မှတ်တိုင်");
        assert.equal(name_en, "Stop A");
    });

    it("uses Latin normalized_data.name for landuse feature name_en", () => {
        const { name_mm, name_en } = deriveImportReviewNames({
            canonical_name: "industrial",
            class_code: "industrial",
            normalized_data: {
                name: "CNTIC VPower YG2 Power Plant",
                tags: { landuse: "industrial" },
            },
        });
        assert.equal(name_en, "CNTIC VPower YG2 Power Plant");
        assert.equal(name_mm, null);
    });

    it("does not use import_review.name column when it echoes class_code", () => {
        const { name_en } = deriveImportReviewNames({
            name: "residential",
            class_code: "residential",
            canonical_name: null,
            normalized_data: { tags: { landuse: "residential" } },
        });
        assert.equal(name_en, null);
    });

    it("does not use canonical_name when it is only a landuse class slug", () => {
        const { name_en } = deriveImportReviewNames({
            canonical_name: "military",
            class_code: null,
            normalized_data: { tags: { landuse: "military" } },
        });
        assert.equal(name_en, null);
    });

    it("returns null names for unnamed residential polygon", () => {
        const { name_mm, name_en, name_und } = deriveImportReviewNames({
            name: "residential",
            class_code: "residential",
            canonical_name: null,
            normalized_data: { tags: { landuse: "residential" } },
        });
        assert.equal(name_mm, null);
        assert.equal(name_en, null);
        assert.equal(name_und, null);
    });

    it("derives name_en from name:en and name_mm from name:my", () => {
        const { name_mm, name_en } = deriveImportReviewNames({
            normalized_data: {
                tags: {
                    landuse: "industrial",
                    "name:en": "Power Plant",
                    "name:my": "စက်ရုံ",
                },
            },
        });
        assert.equal(name_en, "Power Plant");
        assert.equal(name_mm, "စက်ရုံ");
    });

    it("preserves unclear tags.name as name_und", () => {
        const { name_mm, name_en, name_und } = deriveImportReviewNames({
            normalized_data: {
                tags: { landuse: "commercial", name: "123 Market Block" },
            },
        });
        assert.equal(name_en, "123 Market Block");
        assert.equal(name_mm, null);
        assert.equal(name_und, null);
    });

    it("reads stored normalized_data.name_und", () => {
        const { name_en, name_und } = deriveImportReviewNames({
            normalized_data: {
                name_und: "Legacy und label",
                tags: { landuse: "commercial" },
            },
        });
        assert.equal(name_en, null);
        assert.equal(name_und, "Legacy und label");
    });
});
