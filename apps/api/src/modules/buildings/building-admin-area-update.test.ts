import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { EntityAdminAreaRepository } from "../entity-admin-area/entity-admin-area.repo.js";
import { EntityAdminAreaService } from "../entity-admin-area/entity-admin-area.service.js";
import type { BuildingsRepository, BuildingDetailRow } from "./buildings.repo.js";
import { BuildingValidationError, BuildingsService } from "./buildings.service.js";

const TOWNSHIP_ID = 42n;
const WARD_ID = 8n;
const DISTRICT_ID = 12n;

const testUser = { sub: "u1", email: "u@test", roles: ["admin"] as string[] };

const geometry = {
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

function makeEntityAdminAreaRepo(): EntityAdminAreaRepository {
    return {
        isTownshipAdminArea: async (id: bigint | null) => id === TOWNSHIP_ID,
        getActiveAdminAreaSummary: async (id: bigint) => {
            if (id === TOWNSHIP_ID) {
                return {
                    id: TOWNSHIP_ID,
                    canonical_name: "Kyauktan",
                    admin_level_code: "township",
                    admin_level_name: "Township",
                };
            }
            if (id === WARD_ID) {
                return {
                    id: WARD_ID,
                    canonical_name: "Ward 1",
                    admin_level_code: "ward_village_tract",
                    admin_level_name: "Ward Or Village Tract",
                };
            }
            if (id === DISTRICT_ID) {
                return {
                    id: DISTRICT_ID,
                    canonical_name: "Yangon District",
                    admin_level_code: "district",
                    admin_level_name: "District",
                };
            }
            return null;
        },
        inferAdminAreaIdForPolygonGeoJson: async () => 99n,
        geometryMatchesTownshipAdminArea: async () => true,
    } as unknown as EntityAdminAreaRepository;
}

function makeBuildingDetail(adminAreaId: bigint | null): BuildingDetailRow {
    const now = new Date("2026-01-01T00:00:00.000Z");
    return {
        id: "1",
        public_id: "building-1",
        source_staging_id: null,
        external_id: "ext-1",
        admin_area_id: adminAreaId?.toString() ?? null,
        admin_area_row_id: adminAreaId?.toString() ?? null,
        admin_area_canonical_name: null,
        admin_area_slug: null,
        building_type_id: "1",
        ref_bt_id: "1",
        ref_bt_code: "yes",
        ref_bt_name: "yes",
        ref_bt_name_mm: null,
        building_type_code: "yes",
        class_code: "yes",
        fallback_name: null,
        name_mm: null,
        name_en: "Building",
        levels: null,
        height_m: null,
        area_m2: 100,
        confidence_score: "80",
        verification_status: "unverified",
        is_verified: false,
        is_active: true,
        normalized_data: {},
        source_refs: {},
        geometry,
        created_at: now,
        updated_at: now,
        deleted_at: null,
    } as unknown as BuildingDetailRow;
}

function makeBuildingsService(args: {
    existingAdminAreaId: bigint | null;
    onUpdate?: (
        snapshot: { admin_area_id: bigint | null },
        audit?: { editorId: bigint | null; protectAttributes: boolean },
    ) => void;
}) {
    const entityAdminArea = new EntityAdminAreaService(makeEntityAdminAreaRepo());
    const buildingsRepo = {
        getDashboardBuildingByPublicId: async () => makeBuildingDetail(args.existingAdminAreaId),
        updateDashboardBuildingScalars: async (
            _id: string,
            snapshot: { admin_area_id: bigint | null },
            _scope: string,
            audit: { editorId: bigint | null; protectAttributes: boolean },
        ) => {
            args.onUpdate?.(snapshot, audit);
            return makeBuildingDetail(snapshot.admin_area_id);
        },
    } as unknown as BuildingsRepository;

    return new BuildingsService(buildingsRepo, entityAdminArea);
}

describe("BuildingsService.updateBuilding admin_area_id", () => {
    it("preserves existing township when admin_area_id is omitted", async () => {
        let captured: bigint | null | undefined;
        const service = makeBuildingsService({
            existingAdminAreaId: TOWNSHIP_ID,
            onUpdate: (snapshot) => {
                captured = snapshot.admin_area_id;
            },
        });

        await service.updateBuilding("building-1", { name_en: "Updated" }, testUser);
        assert.equal(captured, TOWNSHIP_ID);
    });

    it("preserves null when existing admin_area_id is null and field is omitted", async () => {
        let captured: bigint | null | undefined;
        const service = makeBuildingsService({
            existingAdminAreaId: null,
            onUpdate: (snapshot) => {
                captured = snapshot.admin_area_id;
            },
        });

        await service.updateBuilding("building-1", { name_en: "Updated" }, testUser);
        assert.equal(captured, null);
    });

    it("clears legacy district when admin_area_id is omitted", async () => {
        let captured: bigint | null | undefined;
        const service = makeBuildingsService({
            existingAdminAreaId: DISTRICT_ID,
            onUpdate: (snapshot) => {
                captured = snapshot.admin_area_id;
            },
        });

        await service.updateBuilding("building-1", { name_en: "Updated" }, testUser);
        assert.equal(captured, null);
    });

    it("persists provided township admin_area_id", async () => {
        let captured: bigint | null | undefined;
        const service = makeBuildingsService({
            existingAdminAreaId: null,
            onUpdate: (snapshot) => {
                captured = snapshot.admin_area_id;
            },
        });

        await service.updateBuilding(
            "building-1",
            { admin_area_id: TOWNSHIP_ID, name_en: "Updated" },
            testUser,
        );
        assert.equal(captured, TOWNSHIP_ID);
    });

    it("preserves admin_area_id when null is sent without explicitClearAdminArea", async () => {
        let captured: bigint | null | undefined;
        const service = makeBuildingsService({
            existingAdminAreaId: TOWNSHIP_ID,
            onUpdate: (snapshot) => {
                captured = snapshot.admin_area_id;
            },
        });

        await service.updateBuilding("building-1", { admin_area_id: null, name_en: "Updated" }, testUser);
        assert.equal(captured, TOWNSHIP_ID);
    });

    it("clears admin_area_id only when explicitClearAdminArea is true", async () => {
        let captured: bigint | null | undefined;
        const service = makeBuildingsService({
            existingAdminAreaId: TOWNSHIP_ID,
            onUpdate: (snapshot) => {
                captured = snapshot.admin_area_id;
            },
        });

        await service.updateBuilding(
            "building-1",
            { admin_area_id: null, explicitClearAdminArea: true, name_en: "Updated" },
            testUser,
        );
        assert.equal(captured, null);
    });

    it("preserves legacy district when null is sent without explicitClearAdminArea", async () => {
        let captured: bigint | null | undefined;
        const service = makeBuildingsService({
            existingAdminAreaId: DISTRICT_ID,
            onUpdate: (snapshot) => {
                captured = snapshot.admin_area_id;
            },
        });

        await service.updateBuilding("building-1", { admin_area_id: null, name_en: "Updated" }, testUser);
        assert.equal(captured, DISTRICT_ID);
    });

    it("clears legacy district when explicitClearAdminArea is true", async () => {
        let captured: bigint | null | undefined;
        const service = makeBuildingsService({
            existingAdminAreaId: DISTRICT_ID,
            onUpdate: (snapshot) => {
                captured = snapshot.admin_area_id;
            },
        });

        await service.updateBuilding(
            "building-1",
            { admin_area_id: null, explicitClearAdminArea: true, name_en: "Updated" },
            testUser,
        );
        assert.equal(captured, null);
    });

    it("rejects provided non-township admin_area_id without geometry in patch", async () => {
        const service = makeBuildingsService({ existingAdminAreaId: TOWNSHIP_ID });

        await assert.rejects(
            () => service.updateBuilding("building-1", { admin_area_id: WARD_ID, name_en: "Updated" }, testUser),
            (error: unknown) => {
                assert.ok(error instanceof BuildingValidationError);
                assert.match(error.message, /ward_village_tract/);
                return true;
            },
        );
    });

    it("rejects provided non-township admin_area_id", async () => {
        const service = makeBuildingsService({ existingAdminAreaId: TOWNSHIP_ID });

        await assert.rejects(
            () =>
                service.updateBuilding(
                    "building-1",
                    { admin_area_id: WARD_ID, name_en: "Updated" },
                    testUser,
                ),
            (error: unknown) => {
                assert.ok(error instanceof BuildingValidationError);
                assert.match(error.message, /ward_village_tract/);
                return true;
            },
        );
    });
});

describe("BuildingsService.updateBuilding manual attribute protection", () => {
    it("does not protect imported attributes when the dashboard resends an unchanged value", async () => {
        let captured: { editorId: bigint | null; protectAttributes: boolean } | undefined;
        const service = makeBuildingsService({
            existingAdminAreaId: TOWNSHIP_ID,
            onUpdate: (_snapshot, audit) => {
                captured = audit;
            },
        });

        await service.updateBuilding(
            "building-1",
            { name_en: "Building" },
            { ...testUser, id: "41" },
        );

        assert.deepEqual(captured, {
            editorId: 41n,
            protectAttributes: false,
        });
    });

    it("protects imported attributes when a dashboard value really changes", async () => {
        let captured: { editorId: bigint | null; protectAttributes: boolean } | undefined;
        const service = makeBuildingsService({
            existingAdminAreaId: TOWNSHIP_ID,
            onUpdate: (_snapshot, audit) => {
                captured = audit;
            },
        });

        await service.updateBuilding(
            "building-1",
            { name_en: "Manually renamed building" },
            { ...testUser, id: "41" },
        );

        assert.deepEqual(captured, {
            editorId: 41n,
            protectAttributes: true,
        });
    });
});
