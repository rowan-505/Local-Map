import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    isRoadEntityAdminAreaKind,
    normalizeEntityAdminAreaKind,
} from "./entity-admin-area-kind.js";
import {
    emptyRoadTownshipRecommendation,
    type RoadTownshipMatchRow,
    type RoadTownshipRecommendationResult,
} from "./entity-admin-area.road-township-recommend.js";
import { EntityAdminAreaService } from "./entity-admin-area.service.js";
import type { EntityAdminAreaRepository } from "./entity-admin-area.repo.js";

const lineGeometry = {
    type: "LineString" as const,
    coordinates: [
        [96.1, 16.8],
        [96.2, 16.9],
    ],
};

function townshipMatch(
    id: bigint,
    canonical_name: string,
    overlap_m: number,
    overlap_pct: number | null = 0.5,
): RoadTownshipMatchRow {
    return {
        id,
        canonical_name,
        name_mm: canonical_name === "Kyauktan" ? "ကျောက်တန်း" : null,
        name_en: canonical_name,
        admin_level_code: "township",
        overlap_m,
        overlap_pct,
    };
}

function recommendationFromMatch(
    match: RoadTownshipMatchRow,
    args?: Partial<RoadTownshipRecommendationResult>,
): RoadTownshipRecommendationResult {
    return {
        recommended: match,
        matches: args?.matches ?? [match],
        commonParent: args?.commonParent ?? null,
        fallback_reason: args?.fallback_reason ?? null,
        distance_m: args?.distance_m ?? null,
        nearest_unfiltered_distance_m: args?.nearest_unfiltered_distance_m ?? null,
        debugReason: args?.debugReason ?? null,
        road_length_m: args?.road_length_m ?? 100,
        geometry_intersects: args?.geometry_intersects ?? true,
    };
}

function roadRepoStub(overrides: Partial<EntityAdminAreaRepository> = {}): EntityAdminAreaRepository {
    return {
        recommendRoadTownshipFromGeoJson: async () =>
            emptyRoadTownshipRecommendation("outside_all_townships", {
                nearest_unfiltered_distance_m: 2500,
            }),
        inferTownshipAdminAreaForRoadGeoJson: async () => null,
        getAdminAreaSummaryAnyStatus: async () => null,
        isTownshipAdminArea: async () => false,
        ...overrides,
    } as unknown as EntityAdminAreaRepository;
}

describe("normalizeEntityAdminAreaKind", () => {
    it("maps road to street", () => {
        assert.equal(normalizeEntityAdminAreaKind("road"), "street");
    });

    it("preserves place, street, building, landuse, and bus_stop", () => {
        assert.equal(normalizeEntityAdminAreaKind("place"), "place");
        assert.equal(normalizeEntityAdminAreaKind("street"), "street");
        assert.equal(normalizeEntityAdminAreaKind("building"), "building");
        assert.equal(normalizeEntityAdminAreaKind("landuse"), "landuse");
        assert.equal(normalizeEntityAdminAreaKind("bus_stop"), "bus_stop");
    });
});

describe("isRoadEntityAdminAreaKind", () => {
    it("is true only for street", () => {
        assert.equal(isRoadEntityAdminAreaKind("street"), true);
        assert.equal(isRoadEntityAdminAreaKind("place"), false);
        assert.equal(isRoadEntityAdminAreaKind("building"), false);
    });
});

describe("EntityAdminAreaService.infer roads", () => {
    it("returns no_match with debugReason when no township matches", async () => {
        const service = new EntityAdminAreaService(roadRepoStub());

        const result = await service.infer({
            kind: "street",
            geometry: lineGeometry,
            current_admin_area_id: "",
        });

        assert.equal(result.status, "no_match");
        assert.equal(result.debugReason, "outside_all_townships");
        assert.equal(result.currentAdminArea?.id, null);
        assert.equal(result.recommendedTownship, null);
        assert.equal(result.nearestTownshipDistanceM, 2500);
        assert.match(result.message ?? "", /outside_all_townships/);
    });

    it("returns no_match with no_township_polygons only when no active township polygons exist", async () => {
        const service = new EntityAdminAreaService(
            roadRepoStub({
                recommendRoadTownshipFromGeoJson: async () =>
                    emptyRoadTownshipRecommendation("no_township_polygons", {
                        road_length_m: 100,
                    }),
            }),
        );

        const result = await service.infer({
            kind: "street",
            geometry: lineGeometry,
        });

        assert.equal(result.status, "no_match");
        assert.equal(result.debugReason, "no_township_polygons");
        assert.equal(result.recommendedTownship, null);
        assert.equal(result.nearestTownshipDistanceM, null);
    });

    it("returns recommendation_found when current is null and geometry matches", async () => {
        const service = new EntityAdminAreaService(
            roadRepoStub({
                recommendRoadTownshipFromGeoJson: async () =>
                    recommendationFromMatch(townshipMatch(42n, "Kyauktan", 120, 0.8)),
            }),
        );

        const result = await service.infer({
            kind: "street",
            geometry: lineGeometry,
        });

        assert.equal(result.status, "recommendation_found");
        assert.equal(result.recommendationMode, "single_overlap");
        assert.equal(result.currentAdminArea?.id, null);
        assert.equal(result.recommendedTownship?.id, "42");
        assert.equal(result.recommendedTownship?.canonical_name, "Kyauktan");
        assert.equal(result.recommendedTownship?.name_mm, "ကျောက်တန်း");
        assert.equal(result.admin_area_id, "42");
        assert.match(result.message ?? "", /Kyauktan/);
    });

    it("returns valid_existing when stored township matches inferred township", async () => {
        const service = new EntityAdminAreaService(
            roadRepoStub({
                recommendRoadTownshipFromGeoJson: async () =>
                    recommendationFromMatch(townshipMatch(42n, "Stored Township", 120, 0.8)),
                getAdminAreaSummaryAnyStatus: async (id) =>
                    id === 42n
                        ? {
                              id: 42n,
                              canonical_name: "Stored Township",
                              admin_level_code: "township",
                              admin_level_name: "Township",
                              is_active: true,
                              deleted_at: null,
                          }
                        : null,
                isTownshipAdminArea: async (id) => id === 42n,
            }),
        );

        const result = await service.infer({
            kind: "street",
            geometry: lineGeometry,
            current_admin_area_id: "42",
        });

        assert.equal(result.status, "valid_existing");
        assert.equal(result.currentAdminArea?.id, "42");
        assert.equal(result.recommendedTownship?.id, "42");
        assert.match(result.message ?? "", /valid/i);
    });

    it("returns recommendation_found when stored township differs from inferred township", async () => {
        const service = new EntityAdminAreaService(
            roadRepoStub({
                recommendRoadTownshipFromGeoJson: async () =>
                    recommendationFromMatch(townshipMatch(99n, "Other Township", 50, 0.3)),
                getAdminAreaSummaryAnyStatus: async (id) =>
                    id === 42n
                        ? {
                              id: 42n,
                              canonical_name: "Stored Township",
                              admin_level_code: "township",
                              admin_level_name: "Township",
                              is_active: true,
                              deleted_at: null,
                          }
                        : null,
                isTownshipAdminArea: async (id) => id === 42n,
            }),
        );

        const result = await service.infer({
            kind: "street",
            geometry: lineGeometry,
            current_admin_area_id: "42",
        });

        assert.equal(result.status, "recommendation_found");
        assert.equal(result.recommendationMode, "single_overlap");
        assert.equal(result.currentAdminArea?.id, "42");
        assert.equal(result.recommendedTownship?.id, "99");
        assert.match(result.message ?? "", /does not match road geometry/i);
        assert.match(result.message ?? "", /Other Township/);
    });

    it("returns multi_overlap with intersecting townships and common parent", async () => {
        const service = new EntityAdminAreaService(
            roadRepoStub({
                recommendRoadTownshipFromGeoJson: async () =>
                    recommendationFromMatch(townshipMatch(1n, "Kyauktan", 500, 0.7), {
                        matches: [
                            townshipMatch(1n, "Kyauktan", 500, 0.7),
                            townshipMatch(2n, "Other", 100, 0.14),
                        ],
                        commonParent: {
                            id: 99n,
                            canonical_name: "Yangon District",
                            admin_level_code: "district",
                            name_mm: null,
                            name_en: null,
                        },
                    }),
            }),
        );

        const result = await service.infer({
            kind: "street",
            geometry: lineGeometry,
            current_admin_area_id: "9",
        });

        assert.equal(result.status, "recommendation_found");
        assert.equal(result.recommendationMode, "multi_overlap");
        assert.equal(result.intersectingTownships?.length, 2);
        assert.equal(result.commonParentAdminArea?.canonical_name, "Yangon District");
        assert.match(result.message ?? "", /multiple townships/i);
    });

    it("returns nearest fallback recommendation", async () => {
        const service = new EntityAdminAreaService(
            roadRepoStub({
                recommendRoadTownshipFromGeoJson: async () =>
                    recommendationFromMatch(townshipMatch(8n, "Near Township", 0, null), {
                        fallback_reason: "nearest_township",
                        distance_m: 850,
                        geometry_intersects: false,
                    }),
            }),
        );

        const result = await service.infer({
            kind: "street",
            geometry: lineGeometry,
        });

        assert.equal(result.status, "recommendation_found");
        assert.equal(result.recommendationMode, "nearest");
        assert.equal(result.fallbackReason, "nearest_township");
        assert.equal(result.nearestTownshipDistanceM, 850);
        assert.match(result.message ?? "", /nearest/i);
    });

    it("classifies inactive and non-township current admin areas", async () => {
        const inactiveService = new EntityAdminAreaService(
            roadRepoStub({
                recommendRoadTownshipFromGeoJson: async () =>
                    emptyRoadTownshipRecommendation("no_township_polygons"),
                getAdminAreaSummaryAnyStatus: async () => ({
                    id: 7n,
                    canonical_name: "Old Township",
                    admin_level_code: "township",
                    admin_level_name: "Township",
                    is_active: false,
                    deleted_at: null,
                }),
            }),
        );

        const inactive = await inactiveService.infer({
            kind: "street",
            geometry: lineGeometry,
            current_admin_area_id: "7",
        });
        assert.equal(inactive.currentAdminArea?.is_active, false);
        assert.equal(inactive.status, "no_match");
        assert.equal(inactive.debugReason, "no_township_polygons");

        const regionService = new EntityAdminAreaService(
            roadRepoStub({
                recommendRoadTownshipFromGeoJson: async () =>
                    recommendationFromMatch(townshipMatch(55n, "Match Township", 200, 0.5)),
                getAdminAreaSummaryAnyStatus: async () => ({
                    id: 3n,
                    canonical_name: "Yangon Region",
                    admin_level_code: "region",
                    admin_level_name: "Region",
                    is_active: true,
                    deleted_at: null,
                }),
                isTownshipAdminArea: async () => false,
            }),
        );

        const nonTownship = await regionService.infer({
            kind: "street",
            geometry: lineGeometry,
            current_admin_area_id: "3",
        });
        assert.equal(nonTownship.currentAdminArea?.level_code, "region");
        assert.equal(nonTownship.status, "recommendation_found");
        assert.equal(nonTownship.recommendedTownship?.id, "55");

        const wardService = new EntityAdminAreaService(
            roadRepoStub({
                recommendRoadTownshipFromGeoJson: async () =>
                    recommendationFromMatch(townshipMatch(55n, "Match Township", 200, 0.5)),
                getAdminAreaSummaryAnyStatus: async () => ({
                    id: 9n,
                    canonical_name: "Ward 1",
                    admin_level_code: "ward",
                    admin_level_name: "Ward",
                    is_active: true,
                    deleted_at: null,
                }),
                isTownshipAdminArea: async () => false,
            }),
        );

        const ward = await wardService.infer({
            kind: "street",
            geometry: lineGeometry,
            current_admin_area_id: "9",
        });
        assert.equal(ward.currentAdminArea?.level_code, "ward");
        assert.equal(ward.status, "recommendation_found");
        assert.equal(ward.recommendedTownship?.id, "55");
    });

    it("returns invalid_geometry when geometry is missing or not a line", async () => {
        const service = new EntityAdminAreaService(roadRepoStub());

        const missing = await service.infer({
            kind: "street",
            current_admin_area_id: "",
        });
        assert.equal(missing.status, "invalid_geometry");
        assert.equal(missing.debugReason, "invalid_geometry");
        assert.match(missing.message ?? "", /invalid/i);

        const point = await service.infer({
            kind: "street",
            geometry: { type: "Point", coordinates: [96.1, 16.8] },
        });
        assert.equal(point.status, "invalid_geometry");
    });

    it("returns landuse infer audit with recommendation_found when polygon matches a township", async () => {
        const service = new EntityAdminAreaService(
            roadRepoStub({
                inferAdminAreaIdForPolygonGeoJson: async () => 42n,
                getActiveAdminAreaSummary: async (id: bigint) =>
                    id === 42n
                        ? {
                              id: 42n,
                              canonical_name: "Kyauktan",
                              admin_level_code: "township",
                              admin_level_name: "Township",
                          }
                        : null,
                geometryMatchesTownshipAdminArea: async () => true,
                getAdminAreaSummaryAnyStatus: async () => null,
            } as unknown as Partial<EntityAdminAreaRepository>),
        );

        const polygon = {
            type: "Polygon" as const,
            coordinates: [
                [
                    [96.1, 16.8],
                    [96.2, 16.8],
                    [96.2, 16.9],
                    [96.1, 16.9],
                    [96.1, 16.8],
                ],
            ],
        };

        const result = await service.infer({
            kind: "landuse",
            geometry: polygon,
            current_admin_area_id: "",
        });

        assert.equal(result.status, "recommendation_found");
        assert.equal(result.recommendedTownship?.id, "42");
        assert.match(result.message ?? "", /Kyauktan/);
    });

    it("returns bus_stop infer audit with recommendation_found when point matches a township", async () => {
        const service = new EntityAdminAreaService(
            roadRepoStub({
                inferAdminAreaIdForPoint: async () => 42n,
                getActiveAdminAreaSummary: async (id: bigint) =>
                    id === 42n
                        ? {
                              id: 42n,
                              canonical_name: "Kyauktan",
                              admin_level_code: "township",
                              admin_level_name: "Township",
                          }
                        : null,
                geometryMatchesTownshipAdminArea: async () => true,
                getAdminAreaSummaryAnyStatus: async () => null,
            } as unknown as Partial<EntityAdminAreaRepository>),
        );

        const result = await service.infer({
            kind: "bus_stop",
            lat: 16.8,
            lng: 96.1,
            current_admin_area_id: "",
        });

        assert.equal(result.status, "recommendation_found");
        assert.equal(result.recommendedTownship?.id, "42");
        assert.match(result.message ?? "", /Kyauktan/);
    });

    it("returns invalid_geometry for bus_stop when point is missing", async () => {
        const service = new EntityAdminAreaService(roadRepoStub());

        const result = await service.infer({
            kind: "bus_stop",
            current_admin_area_id: "",
        });

        assert.equal(result.status, "invalid_geometry");
        assert.match(result.message ?? "", /bus stop/i);
    });

    it("returns invalid_geometry for landuse when polygon is missing", async () => {
        const service = new EntityAdminAreaService(roadRepoStub());

        const result = await service.infer({
            kind: "landuse",
            current_admin_area_id: "",
        });

        assert.equal(result.status, "invalid_geometry");
        assert.match(result.message ?? "", /polygon/i);
    });

    it("does not add road audit fields for places", async () => {
        const service = new EntityAdminAreaService(
            roadRepoStub({
                inferAdminAreaIdForPoint: async () => null,
            } as unknown as Partial<EntityAdminAreaRepository>),
        );

        const result = await service.infer({
            kind: "place",
            lat: 16.8,
            lng: 96.1,
        });

        assert.equal(result.status, undefined);
        assert.equal(result.currentAdminArea, undefined);
        assert.equal(result.recommendedTownship, undefined);
        assert.equal(result.message, undefined);
    });
});
