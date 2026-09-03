import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fieldRouteEditorHref, fieldStopEditorHref } from "./fieldReportLinks.js";

describe("field report deep links", () => {
    it("opens the existing stop editor query", () => {
        assert.equal(
            fieldStopEditorHref("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"),
            "/dashboard/transport/stops?stop=aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
        );
    });

    it("opens the existing route editor query", () => {
        assert.equal(
            fieldRouteEditorHref("11111111-2222-3333-4444-555555555555"),
            "/dashboard/transport/routes?route=11111111-2222-3333-4444-555555555555"
        );
    });
});
