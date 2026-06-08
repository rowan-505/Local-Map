import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { roadAdminAreaForStreetUpdatePayload } from "./roadAdminAreaPayload.js";

describe("roadAdminAreaForStreetUpdatePayload", () => {
    it("omits admin_area_id when manual override is disabled", () => {
        assert.deepEqual(
            roadAdminAreaForStreetUpdatePayload({
                admin_area_id: "",
                admin_area_manual_override: false,
            }),
            {},
        );
    });

    it("sends null only when manual override is enabled with empty selection", () => {
        assert.deepEqual(
            roadAdminAreaForStreetUpdatePayload({
                admin_area_id: "",
                admin_area_manual_override: true,
            }),
            {
                admin_area_manual_override: true,
                admin_area_id: null,
            },
        );
    });

    it("sends township id when manual override is enabled", () => {
        assert.deepEqual(
            roadAdminAreaForStreetUpdatePayload({
                admin_area_id: "42",
                admin_area_manual_override: true,
            }),
            {
                admin_area_manual_override: true,
                admin_area_id: "42",
            },
        );
    });
});
