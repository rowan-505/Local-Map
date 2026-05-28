import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    RoutingModeDisabledError,
    RoutingProfileDisabledError,
} from "./routing.errors.js";
import {
    assertRoutingRouteRequestPolicy,
    postRouteRequestBodySchema,
} from "./routing.schema.js";

const yangonOrigin = { lat: 16.8661, lng: 96.1951 };
const yangonDestination = { lat: 16.8409, lng: 96.1735 };

function parseRouteBody(body: unknown) {
    const parsed = postRouteRequestBodySchema.parse(body);
    assertRoutingRouteRequestPolicy(parsed);
    return parsed;
}

describe("postRouteRequestBodySchema", () => {
    it("rejects identical origin and destination", () => {
        const result = postRouteRequestBodySchema.safeParse({
            origin: yangonOrigin,
            destination: { ...yangonOrigin },
            profile: "walk",
        });
        assert.equal(result.success, false);
    });

    it("accepts a valid walk request shape", () => {
        const parsed = parseRouteBody({
            origin: yangonOrigin,
            destination: yangonDestination,
            profile: "walk",
            preference: "fastest",
        });
        assert.equal(parsed.profile, "walk");
    });

    it("rejects disabled multimodal profile", () => {
        assert.throws(
            () =>
                parseRouteBody({
                    origin: yangonOrigin,
                    destination: yangonDestination,
                    profile: "multimodal",
                }),
            RoutingProfileDisabledError
        );
    });

    it("rejects disabled bus mode in allowedModes", () => {
        assert.throws(
            () =>
                parseRouteBody({
                    origin: yangonOrigin,
                    destination: yangonDestination,
                    profile: "car",
                    allowedModes: ["bus"],
                }),
            RoutingModeDisabledError
        );
    });
});
