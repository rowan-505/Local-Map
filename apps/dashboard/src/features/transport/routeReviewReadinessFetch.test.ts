import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { shouldFetchRouteReviewReadiness } from "./routeReviewReadinessFetch";

describe("shouldFetchRouteReviewReadiness", () => {
    it("skips while route is loading", () => {
        assert.equal(
            shouldFetchRouteReviewReadiness({
                routeLoading: true,
                routePublicId: "aaa",
                lastRequestedPublicId: null,
            }),
            false,
        );
    });

    it("skips without a route public id", () => {
        assert.equal(
            shouldFetchRouteReviewReadiness({
                routeLoading: false,
                routePublicId: null,
                lastRequestedPublicId: null,
            }),
            false,
        );
    });

    it("fetches once for a new public id", () => {
        assert.equal(
            shouldFetchRouteReviewReadiness({
                routeLoading: false,
                routePublicId: "route-1",
                lastRequestedPublicId: null,
            }),
            true,
        );
    });

    it("prevents duplicate requests for the same unchanged route id", () => {
        assert.equal(
            shouldFetchRouteReviewReadiness({
                routeLoading: false,
                routePublicId: "route-1",
                lastRequestedPublicId: "route-1",
            }),
            false,
        );
    });

    it("fetches again when public id changes", () => {
        assert.equal(
            shouldFetchRouteReviewReadiness({
                routeLoading: false,
                routePublicId: "route-2",
                lastRequestedPublicId: "route-1",
            }),
            true,
        );
    });
});
