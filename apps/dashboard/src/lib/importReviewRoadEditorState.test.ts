import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ImportReviewBuildingListItem } from "@/src/lib/api";

import {
    resolveRoadClassForSave,
    roadEditorSeedFromRow,
    ROAD_CLASS_REQUIRED_MESSAGE,
} from "./importReviewRoadEditorState";

const REF_OPTIONS = [
    { id: "6", code: "secondary" },
    { id: "12", code: "unclassified" },
] as const;

function minimalRoadRow(
    overrides: Partial<ImportReviewBuildingListItem> = {}
): ImportReviewBuildingListItem {
    return {
        id: "1",
        external_id: "way/1",
        class_code: null,
        normalized_data: null,
        fields: {},
        geometry: {
            type: "LineString",
            coordinates: [
                [96.1, 16.8],
                [96.2, 16.81],
            ],
        },
        ...overrides,
    } as ImportReviewBuildingListItem;
}

describe("resolveRoadClassForSave", () => {
    it("requires road class when geometry exists and no fallback", () => {
        const result = resolveRoadClassForSave({
            roadClassId: "",
            row: minimalRoadRow(),
            roadClassOptions: REF_OPTIONS,
            hasGeometry: true,
        });
        assert.equal(result.ok, false);
        if (!result.ok) {
            assert.equal(result.message, ROAD_CLASS_REQUIRED_MESSAGE);
        }
    });

    it("maps imported class_code to road class id", () => {
        const result = resolveRoadClassForSave({
            roadClassId: "",
            row: minimalRoadRow({ class_code: "secondary" }),
            roadClassOptions: REF_OPTIONS,
            hasGeometry: true,
        });
        assert.equal(result.ok, true);
        if (result.ok) {
            assert.equal(result.roadClassId, "6");
        }
    });

    it("uses road_candidate_class_label fallback for save", () => {
        const result = resolveRoadClassForSave({
            roadClassId: "",
            row: minimalRoadRow({ road_candidate_class_label: "secondary" }),
            roadClassOptions: REF_OPTIONS,
            hasGeometry: true,
        });
        assert.equal(result.ok, true);
        if (result.ok) {
            assert.equal(result.roadClassId, "6");
        }
    });

    it("sends road_class_code when code is not in ref options", () => {
        const result = resolveRoadClassForSave({
            roadClassId: "",
            row: minimalRoadRow({ class_code: "living_street" }),
            roadClassOptions: REF_OPTIONS,
            hasGeometry: true,
        });
        assert.equal(result.ok, true);
        if (result.ok) {
            assert.equal(result.roadClassId, "");
            assert.equal(result.roadClassCode, "living_street");
        }
    });
});

describe("roadEditorSeedFromRow", () => {
    it("initializes dropdown id from road_candidate_class_label", () => {
        const seed = roadEditorSeedFromRow(
            minimalRoadRow({ road_candidate_class_label: "secondary" }),
            REF_OPTIONS
        );
        assert.equal(seed.roadClassId, "6");
        assert.equal(seed.roadClassResolutionSource, "candidate.road_candidate_class_label");
    });
});
