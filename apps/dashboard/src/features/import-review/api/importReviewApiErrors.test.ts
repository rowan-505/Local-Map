import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    formatImportReviewApiErrorBody,
    parseImportReviewRoadOverridesSaveIssues,
} from "./importReviewApiErrors";

describe("importReviewApiErrors road overrides save", () => {
    it("parses warnings pending response with requires_acknowledgement", () => {
        const data = {
            ok: false,
            error: "ROAD_OVERRIDES_WARNINGS_PENDING",
            message: "Routing continuity warnings detected",
            details: {
                errors: [],
                warnings: ["Road class_id is unset while geometry exists"],
                requires_acknowledgement: true,
            },
        };
        const issues = parseImportReviewRoadOverridesSaveIssues(data);
        assert.ok(issues);
        assert.equal(issues.errors.length, 0);
        assert.equal(issues.warnings.length, 1);
        assert.equal(issues.requiresAcknowledgement, true);

        const formatted = formatImportReviewApiErrorBody(data, "fallback");
        assert.match(formatted, /Road class_id is unset/);
        assert.match(formatted, /⚠/);
    });

    it("parses validation failed response with blocking errors", () => {
        const data = {
            ok: false,
            error: "ROAD_OVERRIDES_VALIDATION_FAILED",
            message: "Road overrides validation failed",
            details: {
                errors: ["Unknown road_class_id=999"],
                warnings: [],
                requires_acknowledgement: false,
            },
        };
        const issues = parseImportReviewRoadOverridesSaveIssues(data);
        assert.ok(issues);
        assert.equal(issues.errors.length, 1);
        assert.equal(issues.requiresAcknowledgement, false);
    });
});
