import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    buildPipelineSummaryPayload,
    clampPipelinePercent,
    computePipelinePercent,
    deriveResumableActions,
    parsePipelineFromSummary,
} from "./import-review-promotion-progress.js";

describe("import-review-promotion-progress helpers", () => {
    it("computes percent from processed/total", () => {
        assert.equal(computePipelinePercent(50, 200), 25);
        assert.equal(computePipelinePercent(0, 0), 0);
        assert.equal(computePipelinePercent(10, 20, 99), 99);
        assert.equal(clampPipelinePercent(150), 100);
    });

    it("parses pipeline block from batch summary", () => {
        const pipeline = buildPipelineSummaryPayload({
            stageKey: "validate_items",
            label: "Validate publish items",
            stageStatus: "running",
            processed: 12,
            total: 40,
            percent: 30,
            currentFamily: "roads",
            currentCandidateId: 99n,
        });
        const parsed = parsePipelineFromSummary({ pipeline });
        assert.equal(parsed?.current_stage, "validate_items");
        assert.equal(parsed?.processed_count, 12);
        assert.equal(parsed?.total_item_count, 40);
        assert.equal(parsed?.current_family, "roads");
        assert.equal(parsed?.current_candidate_id, "99");
        assert.equal(parsed?.percent, 30);
    });

    it("deriveResumableActions for validating batch", () => {
        const actions = deriveResumableActions({
            status: "validating",
            summary: {},
            pipeline: buildPipelineSummaryPayload({
                stageKey: "validate_items",
                label: "Validate",
                stageStatus: "running",
                processed: 1,
                total: 10,
                percent: 10,
            }),
            validatedAt: null,
            validationPercent: 10,
            pendingPublishItemCount: 10,
            promotablePendingCount: 0,
            dryRunPassed: false,
            validationHeartbeatStale: true,
            promotionHeartbeatStale: false,
        });
        assert.ok(actions.includes("resume_validation"));
        assert.ok(actions.includes("cancel_validation"));
    });

    it("deriveResumableActions offers dry_run and promote when ready", () => {
        const actions = deriveResumableActions({
            status: "ready",
            summary: { dry_run_result: { status: "passed", checked_at: "2026-01-01T00:00:00Z", total: 5, entity_families: ["roads"] } },
            pipeline: null,
            validatedAt: new Date("2026-01-01T00:00:00Z"),
            validationPercent: 100,
            pendingPublishItemCount: 3,
            promotablePendingCount: 3,
            dryRunPassed: true,
            validationHeartbeatStale: false,
            promotionHeartbeatStale: false,
        });
        assert.ok(actions.includes("promote"));
        assert.ok(!actions.includes("dry_run"));
    });

    it("deriveResumableActions offers dry_run when validation complete and dry-run missing", () => {
        const actions = deriveResumableActions({
            status: "ready",
            summary: {},
            pipeline: null,
            validatedAt: new Date("2026-01-01T00:00:00Z"),
            validationPercent: 100,
            pendingPublishItemCount: 2,
            promotablePendingCount: 2,
            dryRunPassed: false,
            validationHeartbeatStale: false,
            promotionHeartbeatStale: false,
        });
        assert.ok(actions.includes("dry_run"));
        assert.ok(!actions.includes("promote"));
    });
});
