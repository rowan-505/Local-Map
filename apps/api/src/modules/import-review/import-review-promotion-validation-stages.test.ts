import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    IMPORT_REVIEW_LEGACY_PUBLISH_ITEM_VALIDATION_STAGES,
    IMPORT_REVIEW_SIMPLE_PUBLISH_VALIDATION_STAGES,
} from "./import-review-promotion-validation-stages.js";
import { IMPORT_REVIEW_PUBLISH_VALIDATION_STAGES } from "./import-review-promotion-validation.types.js";

describe("IMPORT_REVIEW_SIMPLE_PUBLISH_VALIDATION_STAGES", () => {
    it("lists only the five stages executed by the simple runner", () => {
        assert.deepEqual(
            IMPORT_REVIEW_SIMPLE_PUBLISH_VALIDATION_STAGES.map((s) => s.key),
            [
                "load_batch",
                "load_items",
                "group_by_entity",
                "validate_candidate_state",
                "write_validation_summary",
            ]
        );
        assert.equal(IMPORT_REVIEW_PUBLISH_VALIDATION_STAGES.length, 5);
        const validate = IMPORT_REVIEW_SIMPLE_PUBLISH_VALIDATION_STAGES.find(
            (s) => s.key === "validate_candidate_state"
        );
        assert.equal(validate?.label, "Validate items");
        assert.equal(validate?.progressEnd, 90);
    });

    it("keeps legacy item sub-stages separate from seeded batch stages", () => {
        assert.equal(IMPORT_REVIEW_LEGACY_PUBLISH_ITEM_VALIDATION_STAGES.length, 6);
        const seededKeys = new Set<string>(
            IMPORT_REVIEW_SIMPLE_PUBLISH_VALIDATION_STAGES.map((s) => s.key)
        );
        for (const legacy of IMPORT_REVIEW_LEGACY_PUBLISH_ITEM_VALIDATION_STAGES) {
            if (legacy === "validate_candidate_state") {
                continue;
            }
            assert.equal(seededKeys.has(legacy), false);
        }
    });
});
