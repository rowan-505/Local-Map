import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { applyReviewOverridesPatch } from "./import-review-overrides-merge.js";
import { assertValidStoredReviewOverrides } from "./import-review-overrides-validator.js";
import { ImportReviewDecisionRuleError } from "./import-review-errors.js";
import { patchImportReviewCandidateOverridesBodySchema } from "./import-review.schema.js";
import { sanitizeReviewOverridesPatch } from "./import-review-overrides-sanitize.js";

describe("patchImportReviewCandidateOverridesBodySchema", () => {
    it("accepts bus stop override patches with name_mm only", () => {
        const parsed = patchImportReviewCandidateOverridesBodySchema.safeParse({
            review_batch_id: "1",
            review_overrides: { name_mm: "မြန်မာအမည်" },
        });
        assert.equal(parsed.success, true);
    });

    it("accepts null values to clear override keys", () => {
        const parsed = patchImportReviewCandidateOverridesBodySchema.safeParse({
            review_batch_id: "1",
            review_overrides: { name_mm: null, name_en: null },
        });
        assert.equal(parsed.success, true);
    });

    it("accepts empty review_overrides object to clear all overrides", () => {
        const parsed = patchImportReviewCandidateOverridesBodySchema.safeParse({
            review_batch_id: "1",
            review_overrides: {},
        });
        assert.equal(parsed.success, true);
    });

    it("migrates legacy name key at sanitize stage", () => {
        const patch = sanitizeReviewOverridesPatch("bus_stops", {
            name: "Legacy Stop",
        });
        assert.equal(patch.name_en, "Legacy Stop");
        assert.equal("name" in patch, false);
    });
});

describe("applyReviewOverridesPatch", () => {
    it("merges values and removes keys when patch value is null", () => {
        const result = applyReviewOverridesPatch(
            { name_mm: "Old", stop_code: "A1" },
            { name_mm: null, name_en: "New EN" }
        );
        assert.deepEqual(result, { name_en: "New EN", stop_code: "A1" });
    });

    it("clears all override keys when patch is empty object", () => {
        const result = applyReviewOverridesPatch({ name_mm: "X", name_en: "Y" }, {});
        assert.deepEqual(result, {});
    });
});

describe("assertValidStoredReviewOverrides", () => {
    it("accepts empty overrides", () => {
        assert.doesNotThrow(() => assertValidStoredReviewOverrides("bus_stops", {}));
    });

    it("accepts bus stop override fields", () => {
        assert.doesNotThrow(() =>
            assertValidStoredReviewOverrides("bus_stops", {
                name_mm: "Stop A",
                name_en: "Stop A EN",
                stop_code: "BS-1",
                admin_area_id: 42,
            })
        );
    });

    it("rejects display-only admin_area text key", () => {
        assert.throws(
            () => assertValidStoredReviewOverrides("bus_stops", { admin_area: "Kyauktan" }),
            (err: unknown) =>
                err instanceof ImportReviewDecisionRuleError &&
                err.message.includes("admin_area_id")
        );
    });

    it("rejects unknown override keys", () => {
        assert.throws(
            () => assertValidStoredReviewOverrides("bus_stops", { foo: "bar" }),
            ImportReviewDecisionRuleError
        );
    });

    it("accepts legacy stored name keys after migration normalization", () => {
        assert.doesNotThrow(() =>
            assertValidStoredReviewOverrides("bus_stops", {
                name_local: "ဘတ်စ်မှတ်တိုင်",
                name: "Bus Stop EN",
                stop_code: "A1",
            })
        );
    });
});

describe("sanitizeReviewOverridesPatch", () => {
    it("accepts numeric admin_area_id for places", () => {
        const patch = sanitizeReviewOverridesPatch("places", {
            name_mm: "Place",
            admin_area_id: 12,
            category_id: 3,
        });
        assert.equal(patch.admin_area_id, 12);
        assert.equal(patch.category_id, 3);
    });

    it("coerces numeric string ids for roads", () => {
        const patch = sanitizeReviewOverridesPatch("roads", {
            road_class_id: "6",
            admin_area_id: "12",
            is_oneway: false,
        });
        assert.equal(patch.road_class_id, 6);
        assert.equal(patch.admin_area_id, 12);
        assert.equal(patch.is_oneway, false);
    });

    it("rejects invalid road_class_id with 400-class error", () => {
        assert.throws(
            () =>
                sanitizeReviewOverridesPatch("roads", {
                    road_class_id: "abc",
                }),
            (err: unknown) =>
                err instanceof ImportReviewDecisionRuleError &&
                err.message.includes("road_class_id")
        );
    });

    it("rejects non-boolean is_oneway for roads", () => {
        assert.throws(
            () =>
                sanitizeReviewOverridesPatch("roads", {
                    is_oneway: "maybe",
                }),
            ImportReviewDecisionRuleError
        );
    });

    it("accepts water line classification fields", () => {
        const patch = sanitizeReviewOverridesPatch("water_lines", {
            name_en: "Creek",
            class_code: "stream",
            waterway_class: "stream",
            intermittent: true,
            confidence_score: 80,
        });
        assert.equal(patch.class_code, "stream");
        assert.equal(patch.waterway_class, "stream");
        assert.equal(patch.intermittent, true);
        assert.equal(patch.confidence_score, 80);
    });

    it("accepts address fields and coerces street_id", () => {
        const patch = sanitizeReviewOverridesPatch("addresses", {
            full_address: "12 Main St",
            street_id: "42",
            admin_area_id: 5,
        });
        assert.equal(patch.street_id, 42);
        assert.equal(patch.admin_area_id, 5);
    });

    it("maps parent_admin_area_id alias to parent_id for admin_areas", () => {
        const patch = sanitizeReviewOverridesPatch("admin_areas", {
            name_en: "Ward 1",
            parent_admin_area_id: "99",
        });
        assert.equal(patch.parent_id, 99);
        assert.equal("parent_admin_area_id" in patch, false);
    });

    it("rejects name matching class_code in same patch", () => {
        assert.throws(
            () =>
                sanitizeReviewOverridesPatch("landuse", {
                    name_en: "industrial",
                    class_code: "industrial",
                }),
            (err: unknown) =>
                err instanceof ImportReviewDecisionRuleError &&
                err.message.includes("must not match classification")
        );
    });

    it("coerces empty strings to null for optional text fields", () => {
        const patch = sanitizeReviewOverridesPatch("bus_stops", {
            name_mm: "  ",
            stop_code: "",
        });
        assert.equal(patch.name_mm, null);
        assert.equal(patch.stop_code, null);
    });

    it("rejects invalid confidence_score with 400-class error", () => {
        assert.throws(
            () =>
                sanitizeReviewOverridesPatch("places", {
                    confidence_score: 150,
                }),
            (err: unknown) =>
                err instanceof ImportReviewDecisionRuleError &&
                err.message.includes("confidence_score")
        );
    });

    it("accepts geom override for landuse", () => {
        const geom = { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] };
        const patch = sanitizeReviewOverridesPatch("landuse", { geom });
        assert.deepEqual(patch.geom, geom);
    });
});
