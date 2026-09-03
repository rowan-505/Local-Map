import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    allowedAdminStatusTargets,
    isAllowedAdminStatusTransition,
    isFieldSurveySource,
} from "./report-admin-status.js";

describe("report admin status transitions", () => {
    it("treats only field_survey as field source", () => {
        assert.equal(isFieldSurveySource("field_survey"), true);
        assert.equal(isFieldSurveySource("public"), false);
        assert.equal(isFieldSurveySource(null), false);
    });

    it("lets public reports go submitted → in_review → accepted", () => {
        assert.deepEqual(allowedAdminStatusTargets("submitted", "public"), ["in_review", "duplicate"]);
        assert.equal(isAllowedAdminStatusTransition("submitted", "in_review", "public"), true);
        assert.equal(isAllowedAdminStatusTransition("in_review", "accepted", "public"), true);
        assert.equal(isAllowedAdminStatusTransition("in_review", "rejected", "public"), true);
        assert.equal(isAllowedAdminStatusTransition("in_review", "resolved", "public"), false);
    });

    it("lets field reports go submitted → in_review → resolved, not accepted", () => {
        assert.deepEqual(allowedAdminStatusTargets("submitted", "field_survey"), ["in_review"]);
        assert.equal(isAllowedAdminStatusTransition("submitted", "duplicate", "field_survey"), false);
        assert.equal(isAllowedAdminStatusTransition("in_review", "resolved", "field_survey"), true);
        assert.equal(isAllowedAdminStatusTransition("in_review", "rejected", "field_survey"), true);
        assert.equal(isAllowedAdminStatusTransition("in_review", "accepted", "field_survey"), false);
    });
});
