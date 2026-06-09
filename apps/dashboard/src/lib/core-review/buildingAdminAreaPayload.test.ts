import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildingAdminAreaForUpdatePayload } from "./buildingAdminAreaPayload.js";

describe("buildingAdminAreaForUpdatePayload", () => {
    it("omits admin_area_id when user did not apply or manually override", () => {
        assert.deepEqual(
            buildingAdminAreaForUpdatePayload({
                admin_area_id: "42",
                admin_area_manual_override: false,
            }),
            {},
        );
    });

    it("sends township id when recommendation applied or manual override selected", () => {
        assert.deepEqual(
            buildingAdminAreaForUpdatePayload({
                admin_area_id: "42",
                admin_area_manual_override: true,
            }),
            { admin_area_id: "42" },
        );
    });

    it("omits admin_area_id when override is on but selection is empty and not explicitly cleared", () => {
        assert.deepEqual(
            buildingAdminAreaForUpdatePayload({
                admin_area_id: "",
                admin_area_manual_override: true,
                admin_area_explicit_clear: false,
            }),
            {},
        );
    });

    it("sends null only when user explicitly clears township with override enabled", () => {
        assert.deepEqual(
            buildingAdminAreaForUpdatePayload({
                admin_area_id: "",
                admin_area_manual_override: true,
                admin_area_explicit_clear: true,
            }),
            {
                admin_area_id: null,
                explicitClearAdminArea: true,
            },
        );
    });
});
