import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    coreReviewSaveStageLabel,
    CORE_REVIEW_SAVE_STAGE_LABEL,
} from "./coreReviewSaveStage.js";

describe("coreReviewSaveStageLabel", () => {
    it("returns labels for known stages", () => {
        assert.equal(coreReviewSaveStageLabel("checking_geometry"), CORE_REVIEW_SAVE_STAGE_LABEL.checking_geometry);
    });

    it("returns null when idle", () => {
        assert.equal(coreReviewSaveStageLabel(null), null);
    });
});
