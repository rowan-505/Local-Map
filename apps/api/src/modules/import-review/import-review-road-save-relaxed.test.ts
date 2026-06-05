import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PrismaClient } from "@prisma/client";

import {
    assertImportReviewEssentialFieldsMet,
    buildEssentialDefaultOverridesPatch,
} from "./import-review-essential-defaults.js";
import type { ImportReviewEssentialCandidateContext } from "./import-review-essential-defaults.repo.js";
import {
    essentialFieldKeysForFamily,
    isGeometryEssentialForFamily,
} from "./import-review-essential-fields.js";
import { buildImportReviewRoadOverrideOutcome } from "./import-review-road-overrides-validator.js";
import type { StreetsRepository } from "../streets/streets.repo.js";

function roadCtx(
    overrides: Partial<ImportReviewEssentialCandidateContext> = {}
): ImportReviewEssentialCandidateContext {
    return {
        id: 10n,
        review_batch_id: 2n,
        normalized_data: { highway: "residential" },
        name_mm: null,
        name_en: null,
        name: null,
        name_local: null,
        canonical_name: "Test Road",
        primary_name: null,
        display_name: null,
        admin_area_id: null,
        building_type_id: null,
        category_id: null,
        road_class_id: null,
        road_class: null,
        class_code: "unclassified",
        building_type: null,
        confidence_score: 70,
        stop_code: null,
        is_oneway: null,
        has_geometry: true,
        ...overrides,
    };
}

const prismaNoop = {
    $queryRaw: async () => [{ hits: 0n }],
} as unknown as PrismaClient;

const streetsRepoNoop = {
    findNearestStreetPoint: async () => null,
    listStreetGeometryCrossings: async () => [],
} as unknown as StreetsRepository;

const baselineGeom = {
    type: "LineString",
    coordinates: [
        [96.1, 16.8],
        [96.2, 16.81],
    ],
} as const;

describe("import-review road save relaxed essentials", () => {
    it("roads essential keys exclude admin_area_id and road_class_id", () => {
        const keys = essentialFieldKeysForFamily("roads");
        assert.equal(keys.has("admin_area_id"), false);
        assert.equal(keys.has("road_class_id"), false);
        assert.equal(isGeometryEssentialForFamily("roads"), true);
    });

    it("assertImportReviewEssentialFieldsMet passes with null admin and road class when geometry exists", async () => {
        await assertImportReviewEssentialFieldsMet(prismaNoop, "roads", roadCtx(), {
            admin_area_id: null,
            road_class_id: null,
        });
    });

    it("assertImportReviewEssentialFieldsMet fails when geometry is missing", async () => {
        await assert.rejects(
            () =>
                assertImportReviewEssentialFieldsMet(
                    prismaNoop,
                    "roads",
                    roadCtx({ has_geometry: false }),
                    {}
                ),
            /geometry location is required/i
        );
    });

    it("buildEssentialDefaultOverridesPatch does not auto-fill admin or road class on roads", async () => {
        const { overridesPatch } = await buildEssentialDefaultOverridesPatch(
            prismaNoop,
            "roads",
            roadCtx(),
            {}
        );
        assert.equal(overridesPatch.admin_area_id, undefined);
        assert.equal(overridesPatch.road_class_id, undefined);
    });
});

describe("import-review road overrides validator relaxed", () => {
    it("allows patch with null admin_area_id and road_class_id", async () => {
        const outcome = await buildImportReviewRoadOverrideOutcome({
            prisma: prismaNoop,
            streetsRepo: streetsRepoNoop,
            reviewBatchId: 2n,
            roadId: 10n,
            baseline_field_values: {},
            baseline_canonical_name: "Road",
            baseline_road_class_id: null,
            baseline_is_oneway: false,
            baseline_surface: null,
            baseline_geom_geojson: baselineGeom,
            normalized_data: { highway: "unclassified" },
            class_code: "unclassified",
            matched_core_table: null,
            matched_core_id: null,
            patch: {
                admin_area_id: null,
                road_class_id: null,
            },
            routingToleranceMeters: 35,
            effective_road_class_id: null,
            effective_road_class_label: null,
            baselineNoteProvided: false,
            patchProvidedKeys: new Set(["admin_area_id", "road_class_id"]),
            patchReviewNote: null,
        });
        assert.equal(outcome.errors.length, 0);
    });

    it("returns routing warnings without blocking save", async () => {
        const outcome = await buildImportReviewRoadOverrideOutcome({
            prisma: prismaNoop,
            streetsRepo: streetsRepoNoop,
            reviewBatchId: 2n,
            roadId: 10n,
            baseline_field_values: {},
            baseline_canonical_name: "Road",
            baseline_road_class_id: null,
            baseline_is_oneway: false,
            baseline_surface: null,
            baseline_geom_geojson: baselineGeom,
            normalized_data: { highway: "unclassified" },
            class_code: "unclassified",
            matched_core_table: null,
            matched_core_id: null,
            patch: { is_oneway: true },
            routingToleranceMeters: 35,
            effective_road_class_id: null,
            effective_road_class_label: null,
            baselineNoteProvided: false,
            patchProvidedKeys: new Set(["is_oneway"]),
            patchReviewNote: null,
        });
        assert.equal(outcome.errors.length, 0);
        assert.ok(outcome.warnings.length > 0);
    });

    it("rejects invalid speed_kph type", async () => {
        await assert.rejects(
            () =>
                buildImportReviewRoadOverrideOutcome({
                    prisma: prismaNoop,
                    streetsRepo: streetsRepoNoop,
                    reviewBatchId: 2n,
                    roadId: 10n,
                    baseline_field_values: {},
                    baseline_canonical_name: "Road",
                    baseline_road_class_id: null,
                    baseline_is_oneway: null,
                    baseline_surface: null,
                    baseline_geom_geojson: baselineGeom,
                    normalized_data: null,
                    class_code: null,
                    matched_core_table: null,
                    matched_core_id: null,
                    patch: { speed_kph: "fast" as unknown as number },
                    routingToleranceMeters: 35,
                    effective_road_class_id: null,
                    effective_road_class_label: null,
                    baselineNoteProvided: false,
                    patchProvidedKeys: new Set(["speed_kph"]),
                    patchReviewNote: null,
                }),
            /speed_kph/
        );
    });

    it("rejects invalid bridge boolean", async () => {
        await assert.rejects(
            () =>
                buildImportReviewRoadOverrideOutcome({
                    prisma: prismaNoop,
                    streetsRepo: streetsRepoNoop,
                    reviewBatchId: 2n,
                    roadId: 10n,
                    baseline_field_values: {},
                    baseline_canonical_name: "Road",
                    baseline_road_class_id: null,
                    baseline_is_oneway: null,
                    baseline_surface: null,
                    baseline_geom_geojson: baselineGeom,
                    normalized_data: null,
                    class_code: null,
                    matched_core_table: null,
                    matched_core_id: null,
                    patch: { bridge: "maybe" as unknown as boolean },
                    routingToleranceMeters: 35,
                    effective_road_class_id: null,
                    effective_road_class_label: null,
                    baselineNoteProvided: false,
                    patchProvidedKeys: new Set(["bridge"]),
                    patchReviewNote: null,
                }),
            /bridge/
        );
    });
});
