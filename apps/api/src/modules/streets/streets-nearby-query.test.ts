import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { streetsNearbyQuerySchema } from "./streets.schema.js";

describe("streetsNearbyQuerySchema", () => {
    it("parses bbox and default limit", () => {
        const parsed = streetsNearbyQuerySchema.safeParse({
            bbox: "96.0,16.5,96.2,16.7",
        });

        assert.equal(parsed.success, true);
        if (parsed.success) {
            assert.deepEqual(parsed.data.bbox, [96, 16.5, 96.2, 16.7]);
            assert.equal(parsed.data.limit, 100);
        }
    });

    it("rejects invalid bbox", () => {
        const parsed = streetsNearbyQuerySchema.safeParse({
            bbox: "96.2,16.7,96.0,16.5",
        });

        assert.equal(parsed.success, false);
    });
});
