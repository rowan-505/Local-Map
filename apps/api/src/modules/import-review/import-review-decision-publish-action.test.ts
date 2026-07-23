import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    parseFieldChoicesFromReviewNote,
    reviewDecisionToPublishAction,
} from "./import-review-decision-publish-action.js";
import { resolvePlaceMergeFieldValues } from "./import-review-place-merge-fields.js";

describe("import-review-decision-publish-action", () => {
    it("maps conflict decisions to publish actions", () => {
        assert.equal(reviewDecisionToPublishAction("keep_existing", 1), "skip");
        assert.equal(reviewDecisionToPublishAction("ignore_import", 1), "skip");
        assert.equal(reviewDecisionToPublishAction("mark_duplicate", 1), "skip");
        assert.equal(reviewDecisionToPublishAction("insert_separate", 99), "insert");
        assert.equal(reviewDecisionToPublishAction("replace_existing", 5), "update");
        assert.equal(reviewDecisionToPublishAction("replace_existing", null), "insert");
        assert.equal(reviewDecisionToPublishAction("merge_fields", 5), "merge");
        assert.equal(reviewDecisionToPublishAction("needs_more_review", 5), "update");
    });

    it("parses field_choices from review_note", () => {
        const note = "ok\nfield_choices:{\"primary_name\":\"imported\",\"display_name\":\"existing\"}";
        const parsed = parseFieldChoicesFromReviewNote(note);
        assert.equal(parsed.primary_name?.choice, "imported");
        assert.equal(parsed.display_name?.choice, "existing");
    });

    it("applies only selected merge fields", () => {
        const resolved = resolvePlaceMergeFieldValues({
            choices: { primary_name: { choice: "imported" } },
            existing: {
                primary_name: "Old",
                display_name: "Old Display",
                category_id: 1,
                admin_area_id: 2,
                name_mm: null,
                name_en: null,
                plus_code: null,
                lat: 1,
                lng: 2,
                importance_score: 10,
                popularity_score: 10,
                confidence_score: 10,
            },
            imported: {
                primary_name: "New",
                display_name: "New Display",
                category_id: 9,
                admin_area_id: 8,
                name_mm: null,
                name_en: null,
                plus_code: null,
                lat: 3,
                lng: 4,
                importance_score: 20,
                popularity_score: 20,
                confidence_score: 20,
            },
        });
        assert.equal(resolved.primary_name, "New");
        assert.equal(resolved.display_name, "Old Display");
        assert.equal(resolved.category_id, 1);
        assert.deepEqual(resolved.selected_fields, ["primary_name"]);
    });
});
