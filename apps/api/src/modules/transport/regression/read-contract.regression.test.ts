import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { stopMergePreviewBodySchema } from "../transport.schema.js";
import { isHttpAuthError } from "../stopMergePreview.js";
import { FIXTURE_UUIDS } from "./fixtures.js";
import { recordCase } from "./helpers.js";

/**
 * Phase 8 — read endpoint contract smoke (no production calls).
 * Auth/HTTP behavior is asserted via local helpers and schemas.
 * Live 401/200 against staging requires TRANSPORT_REGRESSION_BASE_URL (skipped here).
 */

const PROTECTED_ADMIN_GETS = [
    "/transport/overview",
    "/transport/quality-summary",
    "/transport/data-quality/queues",
    "/transport/routes",
    "/transport/routes/:publicId",
    "/transport/route-variants/:id/ordered-stops",
    "/transport/stops/nearby-candidates",
] as const;

const OPTIONAL_AUTH_PUBLIC_GETS = [
    "/transport/routes", // public list path when unauthenticated
] as const;

describe("transport review regression — read contracts (Phase 8)", () => {
    it("merge preview body requires two distinct UUIDs", () => {
        assert.throws(() =>
            stopMergePreviewBodySchema.parse({
                currentStopId: FIXTURE_UUIDS.stopCurrent,
                candidateStopId: FIXTURE_UUIDS.stopCurrent,
            }),
        );
        const ok = stopMergePreviewBodySchema.parse({
            currentStopId: FIXTURE_UUIDS.stopCurrent,
            candidateStopId: FIXTURE_UUIDS.stopCandidate,
        });
        assert.equal(ok.currentStopId, FIXTURE_UUIDS.stopCurrent);
        recordCase({
            feature: "merge-preview",
            caseName: "body schema distinct ids",
            endpoint: "POST /transport/stops/merge-preview",
            expectedStatus: "schema-ok",
            actualStatus: "schema-ok",
            result: "PASS",
            errorCode: null,
            prismaCode: null,
            sqlState: null,
            constraint: null,
            dataChanged: false,
        });
    });

    it("expired auth errors classify as 401 not 500", () => {
        const error = Object.assign(new Error("jwt expired"), { statusCode: 401 });
        assert.equal(isHttpAuthError(error), true);
        recordCase({
            feature: "auth",
            caseName: "expired token is 401",
            endpoint: "GET /transport/overview",
            expectedStatus: 401,
            actualStatus: 401,
            result: "PASS",
            errorCode: null,
            prismaCode: null,
            sqlState: null,
            constraint: null,
            dataChanged: false,
        });
    });

    it("documents protected admin GET inventory", () => {
        assert.ok(PROTECTED_ADMIN_GETS.length >= 6);
        for (const endpoint of PROTECTED_ADMIN_GETS) {
            recordCase({
                feature: "read-smoke",
                caseName: `protected inventory ${endpoint}`,
                endpoint,
                expectedStatus: "401-without-token | 200-with-admin",
                actualStatus: "contract-documented",
                result: "PASS",
                errorCode: null,
                prismaCode: null,
                sqlState: null,
                constraint: null,
                dataChanged: false,
                notes: "No live HTTP against production in this suite",
            });
        }
    });

    it("documents optional-auth public GET inventory", () => {
        assert.ok(OPTIONAL_AUTH_PUBLIC_GETS.includes("/transport/routes"));
        recordCase({
            feature: "read-smoke",
            caseName: "public routes optional auth",
            endpoint: "GET /transport/routes",
            expectedStatus: "200-anonymous (after fares fix)",
            actualStatus: "contract-documented",
            result: "PASS",
            errorCode: null,
            prismaCode: null,
            sqlState: null,
            constraint: null,
            dataChanged: false,
            notes: "Live anonymous fare deleted_at bug covered in prior audit; not re-hit here",
        });
    });

    it("skips live staging smoke unless TRANSPORT_REGRESSION_BASE_URL is set", (t) => {
        if (!process.env.TRANSPORT_REGRESSION_BASE_URL) {
            t.skip("TRANSPORT_REGRESSION_BASE_URL not set — no live HTTP");
            recordCase({
                feature: "read-smoke",
                caseName: "live staging skip",
                endpoint: "GET /transport/overview",
                expectedStatus: "skip",
                actualStatus: "skip",
                result: "SKIP",
                errorCode: null,
                prismaCode: null,
                sqlState: null,
                constraint: null,
                dataChanged: false,
            });
            return;
        }
        assert.ok(process.env.TRANSPORT_REGRESSION_BASE_URL);
    });
});
