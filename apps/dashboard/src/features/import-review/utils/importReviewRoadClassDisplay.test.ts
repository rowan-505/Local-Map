import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ImportReviewBuildingListItem } from "@/src/lib/api";

import { displayImportReviewRoadClassColumn } from "./importReviewRoadClassDisplay.js";

function roadRow(
    overrides: Partial<ImportReviewBuildingListItem> = {}
): ImportReviewBuildingListItem {
    return {
        id: "932",
        class_code: "unclassified",
        ...overrides,
    } as ImportReviewBuildingListItem;
}

describe("displayImportReviewRoadClassColumn", () => {
    it("shows reviewed road_class instead of imported class_code", () => {
        const label = displayImportReviewRoadClassColumn(
            roadRow({
                road_class_id: "8",
                road_class: "residential",
            })
        );
        assert.equal(label, "residential");
    });

    it("prefers road_class_label from API over class_code", () => {
        const label = displayImportReviewRoadClassColumn(
            roadRow({
                class_code: "unclassified",
                road_class_id: "8",
                road_class: "residential",
                road_class_label: "Residential Street",
            })
        );
        assert.equal(label, "Residential Street");
    });

    it("falls back to class_code when no reviewed class is set", () => {
        const label = displayImportReviewRoadClassColumn(
            roadRow({
                class_code: "secondary",
            })
        );
        assert.equal(label, "secondary");
    });
});
