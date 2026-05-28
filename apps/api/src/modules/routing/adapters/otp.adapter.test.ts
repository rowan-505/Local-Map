import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { RoutingEngineNotImplementedError } from "../routing.errors.js";
import { createOtpRoutingEngineAdapter } from "./otp.adapter.js";

describe("OtpRoutingEngineAdapter", () => {
    it("throws NOT_IMPLEMENTED for health and route", async () => {
        const adapter = createOtpRoutingEngineAdapter();

        await assert.rejects(() => adapter.getHealth(), RoutingEngineNotImplementedError);
        await assert.rejects(
            () =>
                adapter.route({
                    origin: { lat: 16.8661, lng: 96.1951 },
                    destination: { lat: 16.8409, lng: 96.1735 },
                    profile: "walk",
                }),
            RoutingEngineNotImplementedError
        );
    });
});
