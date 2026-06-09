import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { placeAdminAreaForPayload } from "./placeAdminAreaPayload.js";

describe("placeAdminAreaForPayload", () => {
    it("omits adminAreaId when user did not apply or manually override", () => {
        assert.deepEqual(
            placeAdminAreaForPayload({
                adminAreaId: "42",
                admin_area_manual_override: false,
            }),
            {},
        );
    });

    it("sends township id when recommendation applied or manual override selected", () => {
        assert.deepEqual(
            placeAdminAreaForPayload({
                adminAreaId: "42",
                admin_area_manual_override: true,
            }),
            { adminAreaId: "42" },
        );
    });

    it("omits adminAreaId when override is on but selection is empty and not explicitly cleared", () => {
        assert.deepEqual(
            placeAdminAreaForPayload({
                adminAreaId: "",
                admin_area_manual_override: true,
                admin_area_explicit_clear: false,
            }),
            {},
        );
    });

    it("sends null only when user explicitly clears township with override enabled", () => {
        assert.deepEqual(
            placeAdminAreaForPayload({
                adminAreaId: "",
                admin_area_manual_override: true,
                admin_area_explicit_clear: true,
            }),
            {
                adminAreaId: null,
                explicitClearAdminArea: true,
            },
        );
    });
});
