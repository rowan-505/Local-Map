import { describe, expect, it } from "vitest";

import { streetsNearbyQuerySchema } from "./streets.schema.js";

describe("streetsNearbyQuerySchema", () => {
    it("parses bbox and default limit", () => {
        const parsed = streetsNearbyQuerySchema.safeParse({
            bbox: "96.0,16.5,96.2,16.7",
        });

        expect(parsed.success).toBe(true);
        if (parsed.success) {
            expect(parsed.data.bbox).toEqual([96, 16.5, 96.2, 16.7]);
            expect(parsed.data.limit).toBe(100);
        }
    });

    it("rejects invalid bbox", () => {
        const parsed = streetsNearbyQuerySchema.safeParse({
            bbox: "96.2,16.7,96.0,16.5",
        });

        expect(parsed.success).toBe(false);
    });
});
