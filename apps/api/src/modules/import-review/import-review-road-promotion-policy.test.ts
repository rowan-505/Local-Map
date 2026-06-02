import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    isRoadPromotionBlockingErrorCode,
    isRoadPromotionBlockingStoredIssue,
    ROAD_PROMOTION_NON_BLOCKING_ERROR_CODES,
} from "./import-review-road-promotion-policy.js";
import {
    issuesToStoredJson,
    runImportReviewRoadRoutingValidation,
    type ImportReviewRoadRoutingValidationRow,
} from "./import-review-road-routing-validation.js";
import { StreetsRepository } from "../streets/streets.repo.js";

describe("import-review road promotion policy", () => {
    it("treats missing name, surface, and speed as non-blocking stored issues", () => {
        for (const code of ["NAME_MISSING", "SURFACE_MISSING", "SPEED_KPH_MISSING"] as const) {
            assert.equal(
                isRoadPromotionBlockingStoredIssue({ code, message: "test", severity: "warning" }),
                false,
                `${code} warning must not block`
            );
            assert.equal(
                isRoadPromotionBlockingStoredIssue({ code, message: "test", severity: "error" }),
                false,
                `${code} must not be a promotion blocker even if stored as error`
            );
            assert.ok(
                ROAD_PROMOTION_NON_BLOCKING_ERROR_CODES.includes(code),
                `${code} should be listed as non-blocking`
            );
        }
    });

    it("treats geometry and missing-class codes as blocking", () => {
        assert.equal(isRoadPromotionBlockingErrorCode("GEOMETRY_INVALID"), true);
        assert.equal(isRoadPromotionBlockingErrorCode("ROAD_CLASS_MISSING"), true);
        assert.equal(isRoadPromotionBlockingStoredIssue({ code: "GEOMETRY_INVALID", severity: "error" }), true);
    });

    it("treats demoted routing codes as non-blocking", () => {
        for (const code of ["ROAD_TOO_SHORT", "OUTSIDE_REVIEW_BOUNDARY", "INVALID_ROAD_CLASS_ID"] as const) {
            assert.equal(isRoadPromotionBlockingErrorCode(code), false);
        }
    });

    it("treats string-array warning codes as non-blocking", () => {
        assert.equal(isRoadPromotionBlockingStoredIssue("ROAD_TOO_SHORT"), false);
        assert.equal(isRoadPromotionBlockingStoredIssue("OUTSIDE_REVIEW_BOUNDARY"), false);
    });

    it("treats string-array canonical geometry codes as blocking", () => {
        assert.equal(isRoadPromotionBlockingStoredIssue("GEOMETRY_INVALID"), true);
    });

    it("treats duplicate_unconfirmed as blocked via eligibility excluded, not warnings", () => {
        assert.equal(
            isRoadPromotionBlockingStoredIssue({
                code: "DUPLICATE_EXTERNAL_ID_IN_CORE",
                severity: "error",
            }),
            true
        );
    });
});

function minimalRoadRow(overrides: Partial<ImportReviewRoadRoutingValidationRow> = {}): ImportReviewRoadRoutingValidationRow {
    return {
        id: 1n,
        review_batch_id: 2n,
        external_id: "way/1",
        canonical_name: null,
        class_code: "residential",
        road_class: "residential",
        road_class_id: null,
        surface: null,
        is_oneway: false,
        geom_geojson: {
            type: "LineString",
            coordinates: [
                [96.15, 16.8],
                [96.1501, 16.8001],
            ],
        },
        normalized_data: { highway: "residential" },
        name_mm: null,
        name_en: null,
        access: null,
        speed_kph: null,
        bridge: null,
        tunnel: null,
        layer: null,
        admin_area_id: null,
        review_note: null,
        review_status: "approved",
        review_decision: "approved",
        matched_core_table: null,
        matched_core_id: null,
        boundary_geom: null,
        ...overrides,
    };
}

describe("import-review road routing validation attribute severities", () => {
    it("returns name, surface, and speed gaps as warnings only", async () => {
        const prisma = {
            $queryRaw: async () => {
                return [
                    {
                        ok: true,
                        reason: null,
                        length_m: 120,
                        srid: 4326,
                        geom_type: "ST_LineString",
                        is_empty: false,
                        is_valid: true,
                        coords_in_range: true,
                        is_simple: true,
                    },
                ];
            },
        } as unknown as import("@prisma/client").PrismaClient;

        const streetsRepo = {
            findNearestStreetPoint: async () => null,
            listStreetGeometryCrossings: async () => [],
        } as unknown as StreetsRepository;

        const result = await runImportReviewRoadRoutingValidation({
            prisma,
            streetsRepo,
            row: minimalRoadRow(),
            connectivityThresholdM: 15,
            duplicateThresholdM: 5,
            confirmWarnings: false,
        });

        const errorCodes = result.errors.map((e) => e.code);
        const warningCodes = result.warnings.map((w) => w.code);

        assert.ok(warningCodes.includes("NAME_MISSING"));
        assert.ok(warningCodes.includes("SURFACE_MISSING"));
        assert.ok(!errorCodes.includes("NAME_MISSING"));
        assert.ok(!errorCodes.includes("SURFACE_MISSING"));
        assert.ok(!errorCodes.includes("SPEED_KPH_MISSING"));

        const storedErrors = issuesToStoredJson(result.errors) as { code: string }[];
        const storedWarnings = issuesToStoredJson([...result.warnings, ...result.info]) as { code: string }[];
        assert.ok(!storedErrors.some((e) => e.code === "NAME_MISSING"));
        assert.ok(!storedErrors.some((e) => e.code === "SURFACE_MISSING"));
        assert.ok(storedWarnings.some((w) => w.code === "NAME_MISSING" || w.code === "SPEED_KPH_MISSING"));
    });
});
