import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    formatStreetGeometrySaveSuccessMessage,
    hasBlockingStreetGeometryErrors,
    hasStreetGeometryTopologyWarnings,
    STREET_GEOMETRY_VALIDATE_TIMEOUT_MS,
    topologyValidationWarningResult,
    TOPOLOGY_VALIDATION_TIMEOUT_WARNING,
} from "./streetGeometrySaveValidation.js";

describe("streetGeometrySaveValidation", () => {
    it("uses a 3s client timeout budget", () => {
        assert.equal(STREET_GEOMETRY_VALIDATE_TIMEOUT_MS, 3000);
    });

    it("blocks only when errors are present", () => {
        assert.equal(
            hasBlockingStreetGeometryErrors({
                isValid: false,
                errors: ["Geometry is not valid"],
                warnings: [],
                startConnection: null,
                endConnection: null,
                crossings: [],
                duplicates: [],
            }),
            true,
        );
        assert.equal(
            hasBlockingStreetGeometryErrors({
                isValid: true,
                errors: [],
                warnings: ["Start point is disconnected from nearby streets."],
                startConnection: null,
                endConnection: null,
                crossings: [],
                duplicates: [],
            }),
            false,
        );
    });

    it("treats timeout warning result as non-blocking", () => {
        const result = topologyValidationWarningResult();
        assert.equal(hasBlockingStreetGeometryErrors(result), false);
        assert.equal(hasStreetGeometryTopologyWarnings(result), true);
        assert.equal(result.warnings[0], TOPOLOGY_VALIDATION_TIMEOUT_WARNING);
    });

    it("formats save success with inline topology warning", () => {
        assert.equal(formatStreetGeometrySaveSuccessMessage("Street", "saved", null), "Street saved successfully.");
        assert.equal(
            formatStreetGeometrySaveSuccessMessage("Street", "saved", topologyValidationWarningResult()),
            `Street saved successfully. Warning: ${TOPOLOGY_VALIDATION_TIMEOUT_WARNING}`,
        );
    });
});
