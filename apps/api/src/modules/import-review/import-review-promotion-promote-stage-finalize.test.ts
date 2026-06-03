import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    buildPromotionStagePlan,
    PROMOTION_STAGE_FINAL,
    PROMOTION_STAGE_PREFLIGHT,
    PROMOTION_STAGE_UPDATE_SUMMARY,
} from "./import-review-promotion-promote-stages.js";
import {
    buildPromotionStageReconcileUpdates,
    hasUnsettledPromotionStageLogs,
} from "./import-review-promotion-promote-stage-finalize.js";

describe("buildPromotionStageReconcileUpdates", () => {
    it("one-place successful promotion leaves no running/pending promotion stages", () => {
        const plan = buildPromotionStagePlan(["places"]);
        const logs = plan.stages.map((stage) => ({
            stage_key: stage.key,
            stage_status:
                stage.key === "promote_places_to_core"
                    ? "pending"
                    : stage.key === PROMOTION_STAGE_UPDATE_SUMMARY
                      ? "running"
                      : "success",
            finished_at: stage.key === "promote_places_to_core" ? null : new Date(),
            message: null,
        }));

        assert.equal(hasUnsettledPromotionStageLogs(logs, plan), true);

        const updates = buildPromotionStageReconcileUpdates(plan, logs, {
            batchStatus: "promoted",
            promotionLogsSummary: "Promotion completed. 1 item(s) promoted.",
            familyPromotedCounts: { places: 1 },
        });

        assert.equal(updates.length, 2);
        assert.deepEqual(
            updates.map((u) => u.stageKey),
            ["promote_places_to_core", PROMOTION_STAGE_UPDATE_SUMMARY]
        );
        assert.equal(updates[0]?.stageStatus, "success");
        assert.match(updates[0]?.message ?? "", /Promoted 1 place item\(s\)\./);
        assert.equal(updates[1]?.stageStatus, "success");
        assert.equal(updates[1]?.message, "Batch summary updated.");

        const settled = logs.map((log) => {
            const update = updates.find((u) => u.stageKey === log.stage_key);
            return update ? { ...log, stage_status: update.stageStatus } : log;
        });
        assert.equal(hasUnsettledPromotionStageLogs(settled, plan), false);
    });

    it("failed promotion marks current stage failed and later stages skipped", () => {
        const plan = buildPromotionStagePlan(["places"]);
        const logs = plan.stages.map((stage) => ({
            stage_key: stage.key,
            stage_status:
                stage.key === PROMOTION_STAGE_PREFLIGHT
                    ? "success"
                    : stage.key === "promote_places_to_core"
                      ? "running"
                      : "pending",
            finished_at: stage.key === PROMOTION_STAGE_PREFLIGHT ? new Date() : null,
            message: null,
        }));

        const updates = buildPromotionStageReconcileUpdates(plan, logs, {
            batchStatus: "failed",
            failedStageKey: "promote_places_to_core",
            failureMessage: "Promotion failed for place item.",
        });

        const byKey = new Map(updates.map((u) => [u.stageKey, u]));
        assert.equal(byKey.get("promote_places_to_core")?.stageStatus, "failed");
        assert.equal(byKey.get(PROMOTION_STAGE_UPDATE_SUMMARY)?.stageStatus, "skipped");
        assert.equal(byKey.get(PROMOTION_STAGE_FINAL)?.stageStatus, "skipped");
    });

    it("promotion_failed batch settles all running stages", () => {
        const plan = buildPromotionStagePlan(["places"]);
        const logs = plan.stages.map((stage) => ({
            stage_key: stage.key,
            stage_status: stage.key === PROMOTION_STAGE_PREFLIGHT ? "success" : "running",
            finished_at: stage.key === PROMOTION_STAGE_PREFLIGHT ? new Date() : null,
            message: null,
        }));

        const updates = buildPromotionStageReconcileUpdates(plan, logs, {
            batchStatus: "failed",
            promotionLogsSummary:
                "Promotion failed. Create a new retry batch after fixing the error.",
            familyPromotedCounts: { places: 0 },
        });

        assert.ok(updates.length > 0);
        for (const update of updates) {
            assert.notEqual(update.stageStatus, "running");
            assert.notEqual(update.stageStatus, "pending");
        }
        const finalUpdate = updates.find((u) => u.stageKey === PROMOTION_STAGE_FINAL);
        assert.ok(finalUpdate);
        assert.notEqual(finalUpdate?.stageStatus, "running");
        assert.notEqual(finalUpdate?.stageStatus, "pending");
    });
});

describe("buildPromotionStagePlan places-only", () => {
    it("does not create roads/buildings/water stages", () => {
        const plan = buildPromotionStagePlan(["places"]);
        const keys = plan.stages.map((s) => s.key);
        assert.equal(keys.includes("promote_roads_to_core"), false);
        assert.equal(keys.includes("promote_buildings_to_core"), false);
        assert.equal(keys.includes("promote_water_lines_to_core"), false);
        assert.equal(keys.includes("promote_water_polygons_to_core"), false);
        assert.equal(keys.includes("promote_places_to_core"), true);
        assert.equal(keys.includes(PROMOTION_STAGE_PREFLIGHT), true);
        assert.equal(keys.includes(PROMOTION_STAGE_FINAL), true);
    });
});
