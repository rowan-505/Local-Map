import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    resolveValidationStatusFromIssues,
    validateRouteCandidate,
    validateRouteStopCandidate,
    validateStopCandidate,
    validateVariantCandidate,
} from "./import-transport-validation-rules.js";

describe("import-transport validation rules", () => {
    it("returns valid for a clean route record", () => {
        const issues = validateRouteCandidate({
            id: "1",
            route_code: "YBS-12",
            public_name: "Downtown Loop",
            transport_mode: "local_bus",
            confidence_score: 80,
            operator_match_status: "matched",
            has_operator: true,
            duplicate_route_code: false,
        });
        assert.deepEqual(issues, []);
        assert.equal(resolveValidationStatusFromIssues(issues), "valid");
    });

    it("returns warning for a route with missing public name", () => {
        const issues = validateRouteCandidate({
            id: "2",
            route_code: "YBS-13",
            public_name: null,
            transport_mode: "local_bus",
            confidence_score: 70,
            operator_match_status: "matched",
            has_operator: true,
            duplicate_route_code: false,
        });
        assert.equal(resolveValidationStatusFromIssues(issues), "warning");
        assert.ok(issues.some((issue) => issue.issue_code === "public_name_missing"));
    });

    it("returns blocked for a route missing route code", () => {
        const issues = validateRouteCandidate({
            id: "3",
            route_code: "",
            public_name: "Unnamed",
            transport_mode: "local_bus",
            confidence_score: 50,
            operator_match_status: "matched",
            has_operator: true,
            duplicate_route_code: false,
        });
        assert.equal(resolveValidationStatusFromIssues(issues), "blocked");
        assert.ok(issues.some((issue) => issue.issue_code === "route_code_missing"));
    });

    it("returns blocked for a stop missing geometry", () => {
        const issues = validateStopCandidate({
            id: "10",
            stop_code: "S-1",
            stop_name: "Central Stop",
            stop_name_local: null,
            admin_area_code: "YGN",
            confidence_score: 90,
            geometry_present: false,
            geometry_valid: false,
            geometry_srid: null,
            nearby_stop_id: null,
            nearby_stop_distance_m: null,
        });
        assert.equal(resolveValidationStatusFromIssues(issues), "blocked");
        assert.ok(issues.some((issue) => issue.issue_code === "geometry_missing"));
    });

    it("returns warning for a variant missing distance", () => {
        const issues = validateVariantCandidate({
            id: "20",
            raw_route_id: "5",
            parent_route_exists: true,
            variant_code: "A",
            direction_name: "Inbound",
            origin_name: "A",
            destination_name: "B",
            distance_m: null,
            geometry_present: true,
            geometry_valid: true,
            duplicate_variant: false,
        });
        assert.equal(resolveValidationStatusFromIssues(issues), "warning");
        assert.ok(issues.some((issue) => issue.issue_code === "distance_not_calculated"));
    });

    it("returns blocked for duplicate consecutive route stop", () => {
        const issues = validateRouteStopCandidate({
            id: "30",
            raw_route_variant_id: "7",
            raw_stop_id: "10",
            variant_exists: true,
            stop_exists: true,
            stop_sequence: 3,
            distance_from_start_m: 1200,
            duplicate_stop_sequence: false,
            duplicate_consecutive_stop: true,
        });
        assert.equal(resolveValidationStatusFromIssues(issues), "blocked");
        assert.ok(issues.some((issue) => issue.issue_code === "duplicate_consecutive_stop"));
    });
});
