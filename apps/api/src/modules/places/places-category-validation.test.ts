import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { placeCategoryValidationError } from "./places-category-validation.js";

describe("placeCategoryValidationError", () => {
    it("includes ref table hint and category id", () => {
        assert.match(placeCategoryValidationError(404n), /ref\.ref_poi_categories/);
        assert.match(placeCategoryValidationError(404n), /id=404/);
    });
});
