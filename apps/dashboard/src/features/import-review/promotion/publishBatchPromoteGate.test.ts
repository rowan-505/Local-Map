import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    getPublishBatchPromoteGate,
    isLargePromoteBatch,
} from "./publishBatchPromoteGate.js";
import { resolveRoadBulkPromotionUxPolicy } from "./roadBulkPromotionUx.js";

const baseInput = {
    batchId: "36",
    status: "ready",
    validationPercent: 100,
    dryRunResult: { status: "passed", checked_at: "2026-01-01T00:00:00Z" },
    promotableNow: 756,
    totalItems: 756,
    families: ["roads"] as const,
    busy: false,
    highRiskConfirmed: true,
    largeBatchConfirmed: true,
};

describe("getPublishBatchPromoteGate", () => {
    it("road batch ready + dry_run passed + confirmations + 756 ready => canPromote true", () => {
        const gate = getPublishBatchPromoteGate(baseInput);
        assert.equal(gate.canPromote, true);
        assert.equal(gate.reason, null);
    });

    it("road batch ready + dry_run passed does not block on API env (409 comes from API)", () => {
        const gate = getPublishBatchPromoteGate({
            ...baseInput,
            highRiskConfirmed: false,
            largeBatchConfirmed: false,
        });
        assert.equal(gate.canPromote, false);
        assert.equal(gate.reason, "Check high-risk confirmation.");
    });

    it("road batch ready + dry_run missing => canPromote false", () => {
        const gate = getPublishBatchPromoteGate({
            ...baseInput,
            dryRunResult: null,
        });
        assert.equal(gate.canPromote, false);
        assert.equal(gate.reason, "Run dry-run first.");
    });

    it("road batch ready + dry_run passed + high-risk unchecked => false", () => {
        const gate = getPublishBatchPromoteGate({
            ...baseInput,
            highRiskConfirmed: false,
        });
        assert.equal(gate.canPromote, false);
        assert.equal(gate.reason, "Check high-risk confirmation.");
    });

    it("road batch ready + dry_run passed + large-batch unchecked => false", () => {
        const gate = getPublishBatchPromoteGate({
            ...baseInput,
            largeBatchConfirmed: false,
        });
        assert.equal(gate.canPromote, false);
        assert.equal(gate.reason, "Check large-batch confirmation.");
    });

    it("road batch ready + dry_run passed + 0 ready => false", () => {
        const gate = getPublishBatchPromoteGate({
            ...baseInput,
            promotableNow: 0,
        });
        assert.equal(gate.canPromote, false);
        assert.equal(gate.reason, "No pending ready items to promote.");
    });

    it("validation not complete => Run validation first.", () => {
        const gate = getPublishBatchPromoteGate({
            ...baseInput,
            validationPercent: 50,
        });
        assert.equal(gate.canPromote, false);
        assert.equal(gate.reason, "Run validation first.");
    });

    it("busy blocks promote with running message", () => {
        const gate = getPublishBatchPromoteGate({
            ...baseInput,
            busy: true,
            status: "promoting",
        });
        assert.equal(gate.canPromote, false);
        assert.equal(gate.reason, "Promotion already running.");
    });
});

describe("road bulk UX policy", () => {
    it("large road batch (>50 ready) does not disable API promote", () => {
        const policy = resolveRoadBulkPromotionUxPolicy({
            hasRoadItems: true,
            roadsItemCount: 756,
            validationReadyCount: 756,
            currentPromotableCount: 756,
            gates: {
                applies: true,
                can_promote: true,
                road_item_count: 756,
                roads_ready_count: 756,
                recommend_sql_bulk_promotion: true,
                api_bulk_promotion_allowed: false,
                env_enabled: true,
                gates: [],
                primary_blocker: null,
                primary_blocker_message: null,
            },
        });
        assert.equal(policy.disableApiPromote, false);
        assert.equal(policy.promoteDisabledReason, null);
        assert.match(policy.sqlBulkWarning ?? "", /Promotion may take time/);
        assert.equal(isLargePromoteBatch(756, 756), true);
    });
});
