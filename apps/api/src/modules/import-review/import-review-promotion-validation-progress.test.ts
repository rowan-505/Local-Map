import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    buildValidateCandidateStateStageHeartbeatDetails,
    shouldReportValidatePublishBatchProgress,
    VALIDATE_PUBLISH_BATCH_PROGRESS_INTERVAL,
} from "./import-review-promotion-validation-progress.js";

describe("shouldReportValidatePublishBatchProgress", () => {
    it("reports every 25 items and on the final item", () => {
        const interval = VALIDATE_PUBLISH_BATCH_PROGRESS_INTERVAL;
        assert.equal(shouldReportValidatePublishBatchProgress(25, 100, interval), true);
        assert.equal(shouldReportValidatePublishBatchProgress(50, 100, interval), true);
        assert.equal(shouldReportValidatePublishBatchProgress(100, 100, interval), true);
        assert.equal(shouldReportValidatePublishBatchProgress(24, 100, interval), false);
        assert.equal(shouldReportValidatePublishBatchProgress(26, 100, interval), false);
    });

    it("reports final item when total is below interval", () => {
        assert.equal(shouldReportValidatePublishBatchProgress(10, 10), true);
        assert.equal(shouldReportValidatePublishBatchProgress(5, 10), false);
    });
});

describe("buildValidateCandidateStateStageHeartbeatDetails", () => {
    it("includes heartbeat fields required by dashboard", () => {
        const details = buildValidateCandidateStateStageHeartbeatDetails({
            batchId: 17n,
            done: 25,
            total: 1826,
            family: "buildings",
            candidateId: 99n,
            stageKey: "validate_candidate_state",
            message: "Validated 25 / 1,826 publish items (buildings)…",
            elapsedMs: 12_345,
        });
        assert.equal(details.processed_count, 25);
        assert.equal(details.total_item_count, 1826);
        assert.equal(details.current_family, "buildings");
        assert.equal(details.last_candidate_id, "99");
        assert.equal(details.elapsed_ms, 12_345);
        assert.equal(typeof details.last_heartbeat_at, "string");
    });

    it("includes chunk_index when chunk heartbeat provided", () => {
        const details = buildValidateCandidateStateStageHeartbeatDetails(
            {
                batchId: 17n,
                done: 100,
                total: 250,
                family: "buildings",
                candidateId: 99n,
                stageKey: "validate_candidate_state",
                message: "Validated 100 / 250 publish items (buildings)…",
                elapsedMs: 12_345,
            },
            { chunkIndex: 1, chunkSize: 100 }
        );
        assert.equal(details.chunk_index, 1);
        assert.equal(details.chunk_size, 100);
    });
});
