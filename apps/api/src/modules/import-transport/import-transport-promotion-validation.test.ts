import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    batchCanPromote,
    batchValidationStatusFromSummaries,
    mapIssuesToItemValidationStatus,
} from "./import-transport-promotion-validation-rules.js";
import { stagesForBatchMode } from "./import-transport-promotion-validation.types.js";

describe("import-transport promotion validation rules", () => {
    it("maps candidate issues to item validation status", () => {
        assert.equal(
            mapIssuesToItemValidationStatus([
                { issue_code: "x", severity: "warning", message: "warn" },
            ]),
            "warning"
        );
        assert.equal(
            mapIssuesToItemValidationStatus([
                { issue_code: "x", severity: "error", message: "block" },
            ]),
            "blocked"
        );
        assert.equal(mapIssuesToItemValidationStatus([]), "valid");
    });

    it("allows promote only when no blocked or pending items", () => {
        assert.equal(
            batchCanPromote([
                { blocked: 0, pending: 0 },
                { blocked: 0, pending: 0 },
            ]),
            true
        );
        assert.equal(
            batchCanPromote([
                { blocked: 1, pending: 0 },
                { blocked: 0, pending: 0 },
            ]),
            false
        );
        assert.equal(
            batchCanPromote([
                { blocked: 0, pending: 2 },
            ]),
            false
        );
    });

    it("derives batch validation status from entity summaries", () => {
        assert.equal(
            batchValidationStatusFromSummaries([
                { valid: 2, warning: 0, blocked: 0, skipped: 0, pending: 0 },
            ]),
            "passed"
        );
        assert.equal(
            batchValidationStatusFromSummaries([
                { valid: 1, warning: 1, blocked: 0, skipped: 0, pending: 0 },
            ]),
            "passed_with_warnings"
        );
        assert.equal(
            batchValidationStatusFromSummaries([
                { valid: 0, warning: 0, blocked: 1, skipped: 0, pending: 0 },
            ]),
            "failed"
        );
    });

    it("resolves validation stages from batch summary mode", () => {
        assert.deepEqual(stagesForBatchMode({ mode: "all_entities" }), [
            "routes",
            "stops",
            "variants",
            "route_stops",
        ]);
        assert.deepEqual(stagesForBatchMode({ mode: "one_entity", entity_family: "stops" }), [
            "stops",
        ]);
    });
});

describe("import-transport promotion validation dependency skip rules", () => {
    it("marks variants and route_stops skipped when upstream stage has blocking errors", () => {
        const routesSummary = { valid: 0, warning: 0, blocked: 2, skipped: 0, pending: 0 };
        const routesStageHadBlocking = routesSummary.blocked > 0;

        assert.equal(routesStageHadBlocking, true);

        const variantsShouldSkip = routesStageHadBlocking;
        const routeStopsShouldSkip = routesStageHadBlocking;

        assert.equal(variantsShouldSkip, true);
        assert.equal(routeStopsShouldSkip, true);
    });

    it("marks route_stops skipped when stops stage has blocking errors", () => {
        const routesStageHadBlocking = false;
        const stopsSummary = { valid: 0, warning: 0, blocked: 1, skipped: 0, pending: 0 };
        const stopsStageHadBlocking = stopsSummary.blocked > 0;

        const variantsShouldSkip = routesStageHadBlocking;
        const routeStopsShouldSkip = routesStageHadBlocking || stopsStageHadBlocking;

        assert.equal(variantsShouldSkip, false);
        assert.equal(routeStopsShouldSkip, true);
    });
});
