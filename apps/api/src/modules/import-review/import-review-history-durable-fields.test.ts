import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    extractDurablePublishItemFields,
    mergePublishItemAfterData,
    mergePublishItemBeforeData,
} from "./import-review-history-durable-fields.js";

describe("extractDurablePublishItemFields", () => {
    it("reads decision and snapshot from before_data candidate summary shape", () => {
        const fields = extractDurablePublishItemFields({
            before_data: {
                review_decision: "replace_existing",
                external_id: "osm:node:1",
                source_snapshot_version: "myanmar-260721",
            },
            after_data: { id: "14", applied_by: "7" },
            validation_result: { eligible: true },
        });
        assert.equal(fields.review_decision, "replace_existing");
        assert.equal(fields.source_snapshot_version, "myanmar-260721");
        assert.equal(fields.applied_by, "7");
    });

    it("prefers first-class columns when present", () => {
        const fields = extractDurablePublishItemFields({
            review_decision: "keep_existing",
            source_snapshot_version: "snap-a",
            applied_by: 9n,
            before_data: { review_decision: "replace_existing" },
            after_data: { applied_by: "1" },
        });
        assert.equal(fields.review_decision, "keep_existing");
        assert.equal(fields.source_snapshot_version, "snap-a");
        assert.equal(fields.applied_by, "9");
    });

    it("reads nested candidate_summary after promote overwrite", () => {
        const fields = extractDurablePublishItemFields({
            before_data: {
                candidate_summary: {
                    review_decision: "merge_fields",
                    source_snapshot_version: "snap-b",
                },
                core_before: { primary_name: "Old" },
            },
            after_data: { id: "3" },
            validation_result: {},
        });
        assert.equal(fields.review_decision, "merge_fields");
        assert.equal(fields.source_snapshot_version, "snap-b");
        assert.deepEqual(fields.before_summary, {
            review_decision: "merge_fields",
            source_snapshot_version: "snap-b",
        });
    });
});

describe("mergePublishItemBeforeData", () => {
    it("wraps core before with candidate summary so decision survives", () => {
        const merged = mergePublishItemBeforeData({
            existingBeforeData: {
                review_decision: "confirm_soft_delete",
                external_id: "osm:way:9",
                source_snapshot_version: "snap",
            },
            coreBeforeData: { id: "12", deleted_at: null },
        });
        assert.deepEqual(merged, {
            candidate_summary: {
                id: null,
                external_id: "osm:way:9",
                match_status: null,
                review_decision: "confirm_soft_delete",
                review_status: null,
                promotion_status: null,
                source_snapshot_version: "snap",
            },
            core_before: { id: "12", deleted_at: null },
        });
    });
});

describe("mergePublishItemAfterData", () => {
    it("stamps decision and applied_by onto after_data", () => {
        const merged = mergePublishItemAfterData({
            afterData: { id: "14" },
            reviewDecision: "insert_separate",
            appliedBy: 3,
            sourceSnapshotVersion: "snap-c",
        });
        assert.deepEqual(merged, {
            id: "14",
            review_decision: "insert_separate",
            applied_by: "3",
            source_snapshot_version: "snap-c",
        });
    });
});
