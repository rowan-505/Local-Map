import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { publicTransportStopIdParamsSchema, publicTransportTerminalIdParamsSchema } from "./public-map.schema.js";

describe("publicTransportStopIdParamsSchema", () => {
    it("accepts a valid stop public_id uuid", () => {
        const parsed = publicTransportStopIdParamsSchema.safeParse({
            id: "b441f97a-3a4b-43cb-8a16-1ce88869a1aa",
        });
        assert.equal(parsed.success, true);
    });

    it("rejects an invalid uuid", () => {
        const parsed = publicTransportStopIdParamsSchema.safeParse({
            id: "not-a-valid-uuid",
        });
        assert.equal(parsed.success, false);
    });

    it("accepts numeric internal id for backward compatibility", () => {
        const parsed = publicTransportStopIdParamsSchema.safeParse({ id: "19370" });
        assert.equal(parsed.success, true);
    });
});

describe("publicTransportTerminalIdParamsSchema", () => {
    it("accepts the same lookup ids as stop detail", () => {
        const parsed = publicTransportTerminalIdParamsSchema.safeParse({
            id: "b441f97a-3a4b-43cb-8a16-1ce88869a1aa",
        });
        assert.equal(parsed.success, true);
    });
});
