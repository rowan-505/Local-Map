import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildApiErrorResponse } from "../../lib/api-error-response.js";
import { ImportReviewRoadOverridesWarningsPendingError } from "./import-review-errors.js";

describe("import-review road overrides API errors", () => {
    it("warnings pending body includes requires_acknowledgement and empty errors", () => {
        const err = new ImportReviewRoadOverridesWarningsPendingError([
            "Road class_id is unset while geometry exists",
        ]);
        const body = buildApiErrorResponse(
            "ROAD_OVERRIDES_WARNINGS_PENDING",
            "Routing continuity warnings detected — retry with confirm_acknowledge_routing_warnings=true after acknowledging.",
            {
                errors: [],
                warnings: err.warnings,
                requires_acknowledgement: true,
            }
        );
        assert.equal(body.ok, false);
        assert.equal(body.error, "ROAD_OVERRIDES_WARNINGS_PENDING");
        const details = body.details as {
            errors: string[];
            warnings: string[];
            requires_acknowledgement: boolean;
        };
        assert.deepEqual(details.errors, []);
        assert.equal(details.warnings.length, 1);
        assert.equal(details.requires_acknowledgement, true);
    });
});
