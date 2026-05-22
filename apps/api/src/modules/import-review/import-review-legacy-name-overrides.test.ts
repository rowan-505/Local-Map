import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ImportReviewDecisionRuleError } from "./import-review-errors.js";
import {
    buildPersistableReviewOverridesPatch,
    normalizeLegacyNameOverrides,
    reviewOverridesPersistPatch,
} from "./import-review-legacy-name-overrides.js";
import { sanitizeReviewOverridesPatch } from "./import-review-overrides-sanitize.js";
import { assertValidStoredReviewOverrides } from "./import-review-overrides-validator.js";

describe("normalizeLegacyNameOverrides", () => {
    it("maps name_local to name_mm", () => {
        const normalized = normalizeLegacyNameOverrides("bus_stops", {
            name_local: "ဘတ်စ်မှတ်တိုင်",
            stop_code: "A1",
        });
        assert.equal(normalized.name_mm, "ဘတ်စ်မှတ်တိုင်");
        assert.equal(normalized.stop_code, "A1");
        assert.equal("name_local" in normalized, false);
    });

    it("maps Latin name to name_en", () => {
        const normalized = normalizeLegacyNameOverrides("bus_stops", {
            name: "Main Stop",
        });
        assert.equal(normalized.name_en, "Main Stop");
        assert.equal("name" in normalized, false);
    });

    it("maps Myanmar name to name_mm", () => {
        const normalized = normalizeLegacyNameOverrides("bus_stops", {
            name: "မှတ်တိုင် ၁",
        });
        assert.equal(normalized.name_mm, "မှတ်တိုင် ၁");
        assert.equal("name_en" in normalized, false);
    });

    it("keeps name_mm over name_local", () => {
        const normalized = normalizeLegacyNameOverrides("bus_stops", {
            name_mm: "Preferred MM",
            name_local: "Legacy MM",
        });
        assert.equal(normalized.name_mm, "Preferred MM");
        assert.equal("name_local" in normalized, false);
    });

    it("keeps name_en over name", () => {
        const normalized = normalizeLegacyNameOverrides("bus_stops", {
            name_en: "Preferred EN",
            name: "Legacy EN",
        });
        assert.equal(normalized.name_en, "Preferred EN");
        assert.equal("name" in normalized, false);
    });
});

describe("reviewOverridesPersistPatch", () => {
    it("removes legacy keys and writes migrated names", () => {
        const existing = {
            name_local: "ဘတ်စ်မှတ်တိုင်",
            name: "Bus Stop",
            stop_code: "A1",
        };
        const normalized = normalizeLegacyNameOverrides("bus_stops", existing);
        const patch = reviewOverridesPersistPatch(existing, normalized);
        assert.equal(patch.name_local, null);
        assert.equal(patch.name, null);
        assert.equal(patch.name_mm, "ဘတ်စ်မှတ်တိုင်");
        assert.equal(patch.name_en, "Bus Stop");
        assert.equal(patch.stop_code, undefined);
    });
});

describe("legacy name overrides on sanitize + approval validation", () => {
    it("accepts legacy keys in PATCH by migrating them", () => {
        const patch = sanitizeReviewOverridesPatch("bus_stops", {
            name_local: "ဘတ်စ်မှတ်တိုင်",
            name: "Bus Stop",
        });
        assert.equal(patch.name_mm, "ဘတ်စ်မှတ်တိုင်");
        assert.equal(patch.name_en, "Bus Stop");
        assert.equal("name" in patch, false);
        assert.equal("name_local" in patch, false);
    });

    it("allows approval validation after legacy migration", () => {
        const normalized = normalizeLegacyNameOverrides("bus_stops", {
            name_local: "ဘတ်စ်မှတ်တိုင်",
            name: "Bus Stop",
            admin_area_id: 12,
        });
        assert.doesNotThrow(() => assertValidStoredReviewOverrides("bus_stops", normalized));
    });

    it("still rejects truly unsupported fields", () => {
        assert.throws(
            () =>
                sanitizeReviewOverridesPatch("bus_stops", {
                    name_local: "Stop",
                    foo: "bar",
                }),
            (err: unknown) =>
                err instanceof ImportReviewDecisionRuleError &&
                err.message.includes("Unsupported review_overrides field(s)")
        );
    });

    it("builds persist patch that cleans stored legacy keys on save", () => {
        const persistPatch = buildPersistableReviewOverridesPatch(
            "bus_stops",
            { name_local: "Legacy MM", stop_code: "S1" },
            { name_en: "Updated EN" }
        );
        assert.equal(persistPatch.name_local, null);
        assert.equal(persistPatch.name_mm, "Legacy MM");
        assert.equal(persistPatch.name_en, "Updated EN");
    });
});
