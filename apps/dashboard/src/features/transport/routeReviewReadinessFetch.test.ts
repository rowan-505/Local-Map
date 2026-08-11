import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    shouldFetchRouteReviewReadiness,
    shouldReloadReadinessAfterReview,
} from "./routeReviewReadinessFetch";

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

describe("shouldReloadReadinessAfterReview", () => {
    it("skips reload when mutation returned readiness", () => {
        assert.equal(
            shouldReloadReadinessAfterReview({
                readiness: {
                    can_verify: true,
                    can_mark_reviewed: true,
                    blockers: [],
                    mark_reviewed_blockers: [],
                    warnings: [],
                },
            }),
            false,
        );
    });

    it("reloads when readiness is absent", () => {
        assert.equal(shouldReloadReadinessAfterReview({}), true);
        assert.equal(shouldReloadReadinessAfterReview({ readiness: undefined }), true);
    });
});
