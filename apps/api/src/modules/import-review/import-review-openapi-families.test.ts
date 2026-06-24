import assert from "node:assert/strict";
import test from "node:test";

import { IMPORT_REVIEW_ENTITY_FAMILIES } from "./import-review-config.js";
import { getImportReviewFamilyCandidatesSchema } from "./import-review.openapi.js";

test("family route OpenAPI param enum matches IMPORT_REVIEW_ENTITY_FAMILIES", () => {
    const params = getImportReviewFamilyCandidatesSchema.params as {
        properties?: { family?: { enum?: readonly string[] } };
    };
    const enumValues = [...(params?.properties?.family?.enum ?? [])];
    assert.deepEqual([...enumValues].sort(), [...IMPORT_REVIEW_ENTITY_FAMILIES].sort());
});
