import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ImportReviewBuildingListItem } from "@/src/lib/api";

import { mergeDirectEditSaveDetailRow } from "./directEditSave.js";

describe("mergeDirectEditSaveDetailRow", () => {
    it("prefers PATCH values for keys in fieldsPatch", () => {
        const patchResponse = {
            id: "23",
            name_en: "test",
            name_mm: "patch-mm",
        } as ImportReviewBuildingListItem;
        const refetched = {
            id: "23",
            name_en: "stale-en",
            name_mm: "refetch-mm",
            normalized_data: { foo: 1 },
        } as ImportReviewBuildingListItem;

        const merged = mergeDirectEditSaveDetailRow(patchResponse, refetched, {
            name_en: "test",
        });

        assert.equal(merged.name_en, "test");
        assert.equal(merged.name_mm, "patch-mm");
        assert.deepEqual((merged as { normalized_data?: { foo: number } }).normalized_data, {
            foo: 1,
        });
    });
});
