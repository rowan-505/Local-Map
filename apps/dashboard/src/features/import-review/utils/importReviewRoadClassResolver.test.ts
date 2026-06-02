import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ImportReviewBuildingListItem } from "@/src/lib/api";

import { deriveRoadListRoadClass } from "./importReviewRoadListDisplay";
import { resolveImportReviewRoadClassValue } from "./importReviewRoadClassResolver";

const REF_OPTIONS = [
    { id: "6", code: "secondary" },
    { id: "12", code: "unclassified" },
] as const;

function roadRow(
    overrides: Partial<ImportReviewBuildingListItem> = {}
): ImportReviewBuildingListItem {
    return {
        id: "1",
        external_id: "way/1",
        class_code: null,
        fields: {},
        normalized_data: null,
        ...overrides,
    } as ImportReviewBuildingListItem;
}

describe("resolveImportReviewRoadClassValue", () => {
    it("maps class_code=secondary to ref id for list and drawer", () => {
        const row = roadRow({ class_code: "secondary" });
        const resolved = resolveImportReviewRoadClassValue(row, REF_OPTIONS);
        assert.equal(resolved.roadClassId, "6");
        assert.equal(resolved.displayLabel, "secondary");
        assert.equal(resolved.resolutionSource, "candidate.class_code");
        assert.equal(deriveRoadListRoadClass(row, REF_OPTIONS), "secondary");
    });

    it("uses road_candidate_class_label when class_code is empty (list parity)", () => {
        const row = roadRow({
            class_code: null,
            road_candidate_class_label: "unclassified",
        });
        const resolved = resolveImportReviewRoadClassValue(row, REF_OPTIONS);
        assert.equal(resolved.roadClassId, "12");
        assert.equal(resolved.displayLabel, "unclassified");
        assert.equal(deriveRoadListRoadClass(row, REF_OPTIONS), "unclassified");
    });

    it("fields.road_class_id wins over imported class_code", () => {
        const row = roadRow({
            class_code: "secondary",
            fields: { road_class_id: "12" },
        });
        const resolved = resolveImportReviewRoadClassValue(row, REF_OPTIONS);
        assert.equal(resolved.roadClassId, "12");
        assert.equal(resolved.resolutionSource, "fields.road_class_id");
    });

    it("fields.road_class_code wins over candidate class_code", () => {
        const row = roadRow({
            class_code: "secondary",
            fields: { road_class_code: "unclassified" },
        });
        const resolved = resolveImportReviewRoadClassValue(row, REF_OPTIONS);
        assert.equal(resolved.roadClassId, "12");
        assert.equal(resolved.roadClassCode, "unclassified");
    });

    it("returns null when no class exists", () => {
        const resolved = resolveImportReviewRoadClassValue(roadRow(), REF_OPTIONS);
        assert.equal(resolved.roadClassId, null);
        assert.equal(resolved.roadClassCode, null);
        assert.equal(resolved.displayLabel, null);
    });

    it("external_id osm:W:1361455046 — list and drawer agree on secondary", () => {
        const row = roadRow({
            external_id: "osm:W:1361455046",
            class_code: null,
            road_candidate_class_label: "secondary",
            fields: {},
        });
        const resolved = resolveImportReviewRoadClassValue(row, REF_OPTIONS);
        assert.equal(resolved.roadClassId, "6");
        assert.equal(resolved.displayLabel, "secondary");
        assert.equal(deriveRoadListRoadClass(row, REF_OPTIONS), "secondary");
    });

    it("reads highway from normalized_data.tags", () => {
        const row = roadRow({
            normalized_data: { tags: { highway: "secondary" } },
        });
        const resolved = resolveImportReviewRoadClassValue(row, REF_OPTIONS);
        assert.equal(resolved.roadClassId, "6");
        assert.equal(resolved.resolutionSource, "imported.highway");
    });
});
